// tests/d5d-runtime-bridge-unit.test.js
//
// D5D Chain #1 — pure-logic proof of src/lib/d5dRuntimeBridge.js. No
// database, no real valuation module — resolveEligibleSubject and
// attemptDurablePersistence are injected fakes, proving the bridge's own
// decision logic (decline-reason enumeration, GK-184 evidence-time
// audit, GK-182 retention audit, dry-run assembly) in isolation.
//
// Invoke: node tests/d5d-runtime-bridge-unit.test.js

import { attemptChain1, auditGk182Retention, auditEvidenceTime, D5D_DECLINE_REASONS } from '../src/lib/d5dRuntimeBridge.js';

let passed = 0, failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejects = async (fn, label) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did not throw)`; failures.push(m); console.log(m); }
  catch { passed++; console.log(`  ✓ ${label}`); }
};

console.log('\n=== D5D Chain #1 runtime bridge — deterministic unit proof ===\n');

const validObservation = () => ({
  marketObservation: {
    provider: 'ebay', providerItemId: '123', listingKind: 'asking',
    priceAmount: 49.99, currency: 'USD', conditionText: null,
    gradeNumeric: null, gradeBasis: null,
    occurredOn: null, occurredAt: '2026-09-01T00:00:00.000Z',
    observedAt: '2026-09-09T12:00:00.000Z',
  },
  applicability: { verdict: 'APPLICABLE', confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null },
  memberStatus: 'SELECTED',
});

const fakeEligible = async () => ({ eligible: true, gkAssetId: 'asset-1', identityAssignmentId: 'ia-1' });
const fakeIneligible = async () => ({ eligible: false, reason: 'SKIP_UNLINKED_SUBJECT' });
const fakeWriteOk = async () => ({ ok: true, result: { outcome: 'evaluated', populationId: 'pop-1' }, elapsedMs: 5 });
const fakeWriteFail = async () => ({ ok: false, error: { message: 'boom', pgErrorCode: null } });

console.log('-- decline: disabled --\n');
{
  const r = await attemptChain1({ enabled: false });
  assertEq(r.attempted, false, 'not attempted when disabled');
  assertEq(r.declineReason, D5D_DECLINE_REASONS.DISABLED, 'declineReason=d5d-disabled');
}

console.log('\n-- decline: wrong environment --\n');
{
  const r = await attemptChain1({ enabled: true, environment: 'production' });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.WRONG_ENVIRONMENT, 'declineReason=wrong-environment even though enabled=true');
}
{
  const r = await attemptChain1({ enabled: true, environment: 'preview' });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.WRONG_ENVIRONMENT, 'preview also declines');
}

console.log('\n-- decline: no auth context --\n');
{
  const r = await attemptChain1({ enabled: true, environment: 'development', principalId: null, collectionItemId: 'ci-1' });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.NO_AUTH_CONTEXT, 'missing principalId declines');
}
{
  const r = await attemptChain1({ enabled: true, environment: 'development', principalId: 'p-1', collectionItemId: null });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.NO_AUTH_CONTEXT, 'missing collectionItemId declines');
}

console.log('\n-- decline: ineligible (no link) --\n');
{
  const r = await attemptChain1({
    enabled: true, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeIneligible,
  });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.INELIGIBLE_NO_LINK, 'declineReason=ineligible-no-link');
  assertTrue(!!r.eligibility, 'eligibility detail attached for diagnostics');
}

console.log('\n-- decline: no observations built --\n');
{
  const r = await attemptChain1({
    enabled: true, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeEligible,
    buildObservations: () => ({ observations: [] }),
  });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.NO_OBSERVATIONS, 'empty observations array declines');
}

console.log('\n-- decline: evidence time missing (legacy/absent) --\n');
{
  const obs = validObservation();
  obs.marketObservation.observedAt = null;
  const r = await attemptChain1({
    enabled: true, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeEligible,
    buildObservations: () => ({ targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', observations: [obs] }),
  });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.EVIDENCE_TIME_MISSING_LEGACY, 'null observedAt -> evidence-time-missing-legacy');
}

console.log('\n-- decline: evidence time malformed --\n');
{
  const obs = validObservation();
  obs.marketObservation.observedAt = '2026-09-09'; // not full ISO-ms-UTC
  const r = await attemptChain1({
    enabled: true, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeEligible,
    buildObservations: () => ({ targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', observations: [obs] }),
  });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.EVIDENCE_TIME_MISSING_MALFORMED, 'malformed observedAt -> evidence-time-missing-malformed');
}

console.log('\n-- GK-182 retention: throws on a disallowed field --\n');
{
  const obs = validObservation();
  obs.marketObservation.title = 'Amazing Spider-Man #1 CGC 9.4'; // prohibited raw field
  await assertRejects(
    () => attemptChain1({
      enabled: true, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
      resolveEligibleSubject: fakeEligible,
      buildObservations: () => ({ targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', observations: [obs] }),
      attemptDurablePersistence: fakeWriteOk,
    }),
    'a disallowed marketObservation.title field throws (caller defect, not a decline)'
  );
}
{
  const audit = auditGk182Retention([{ marketObservation: { provider: 'ebay', priceAmount: 1, currency: 'USD', observedAt: 'x' } }]);
  assertTrue(audit.compliant, 'auditGk182Retention: an all-allowed-field observation is compliant');
}
{
  const audit = auditGk182Retention([{ marketObservation: { provider: 'ebay', url: 'https://ebay.com/itm/123' } }]);
  assertTrue(!audit.compliant && audit.violations.length > 0, 'auditGk182Retention: a url field is flagged');
}

console.log('\n-- dry run: assembles payload, never calls the writer --\n');
{
  let writerCalled = false;
  const r = await attemptChain1({
    enabled: true, dryRun: true, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeEligible,
    buildObservations: () => ({ targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', observations: [validObservation()] }),
    attemptDurablePersistence: async () => { writerCalled = true; return fakeWriteOk(); },
  });
  assertTrue(r.attempted && r.dryRun === true, 'dry run reports attempted=true, dryRun=true');
  assertTrue(!!r.payload && r.payload.gkAssetId === 'asset-1', 'dry run payload carries the resolved gkAssetId');
  assertTrue(!writerCalled, 'dry run NEVER calls attemptDurablePersistence');
}

console.log('\n-- real write: success --\n');
{
  const r = await attemptChain1({
    enabled: true, dryRun: false, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeEligible,
    buildObservations: () => ({ targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', observations: [validObservation()] }),
    attemptDurablePersistence: fakeWriteOk,
  });
  assertTrue(r.attempted && r.dryRun === false, 'real write reports attempted=true, dryRun=false');
  assertEq(r.result?.populationId, 'pop-1', 'real write returns the writer result');
}

console.log('\n-- real write: writer failure surfaces as write-failed, not a throw --\n');
{
  const r = await attemptChain1({
    enabled: true, dryRun: false, environment: 'development', principalId: 'p-1', collectionItemId: 'ci-1',
    resolveEligibleSubject: fakeEligible,
    buildObservations: () => ({ targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', observations: [validObservation()] }),
    attemptDurablePersistence: fakeWriteFail,
  });
  assertEq(r.declineReason, D5D_DECLINE_REASONS.WRITE_FAILED, 'writer ok:false surfaces as declineReason=write-failed');
}

console.log('\n-- auditEvidenceTime, direct --\n');
{
  const audit = auditEvidenceTime([validObservation(), { marketObservation: { observedAt: null } }]);
  assertTrue(!audit.allAdmissible, 'mixed valid/absent -> not all admissible');
  assertEq(audit.results[0].admissible, true, 'first observation (valid) is admissible');
  assertEq(audit.results[1].admissible, false, 'second observation (absent) is not admissible');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
