// tests/outcome1-runtime-bridge-unit.test.js
//
// Outcome #1 — pure-logic proof of src/lib/outcome1RuntimeBridge.js. No
// database — recordValuation/recordDecision are injected fakes, proving
// the bridge's own mapping/decision logic (parseFmtUsd, decline-reason
// enumeration, decision-reason-code mapping, semantic separation from
// operator behavior) in isolation.
//
// Invoke: node tests/outcome1-runtime-bridge-unit.test.js

import { attemptOutcome1, parseFmtUsd, buildDecisionReasonCodes, OUTCOME1_DECLINE_REASONS } from '../src/lib/outcome1RuntimeBridge.js';

let passed = 0, failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Outcome #1 runtime bridge — deterministic unit proof ===\n');

console.log('-- parseFmtUsd (out.price is always a fmtUsd()-formatted string) --\n');
assertEq(parseFmtUsd('$61.41'), 61.41, 'simple dollar string');
assertEq(parseFmtUsd('$1,234.56'), 1234.56, 'thousands-separator string');
assertEq(parseFmtUsd(null), null, 'null passes through as null');
assertEq(parseFmtUsd(undefined), null, 'undefined passes through as null');
assertEq(parseFmtUsd('not a price'), null, 'non-numeric garbage returns null, never NaN');
assertEq(parseFmtUsd('$0.00'), 0, 'zero is a valid parsed value, not falsy-null');

console.log('\n-- buildDecisionReasonCodes (decisionEngine.js vocabulary, verbatim) --\n');
{
  const codes = buildDecisionReasonCodes({ blockers: ['missing-title'], warnings: ['thin-pool', 'reprint-fallback'] });
  assertEq(codes, [
    { type: 'blocker', code: 'missing-title' },
    { type: 'warning', code: 'thin-pool' },
    { type: 'warning', code: 'reprint-fallback' },
  ], 'blockers first, then warnings, type-tagged, codes verbatim');
}
assertEq(buildDecisionReasonCodes({}), [], 'no blockers/warnings -> empty array, never throws');
assertEq(buildDecisionReasonCodes(null), [], 'null decision -> empty array, never throws');

const validDecision = () => ({ action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: ['thin-pool'], timestamp: 1789000000000 });
const fakeRecordValuationOk = async (args) => ({ valuationEventId: 've-1', __args: args });
const fakeRecordDecisionOk = async (args) => ({ decisionEventId: 'de-1', __args: args });

console.log('\n-- decline: disabled --\n');
{
  const r = await attemptOutcome1({ enabled: false });
  assertEq(r, { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.DISABLED }, 'not attempted when disabled');
}

console.log('\n-- decline: wrong environment --\n');
{
  const r = await attemptOutcome1({ enabled: true, environment: 'production' });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.WRONG_ENVIRONMENT, 'production declines even though enabled=true');
}
{
  const r = await attemptOutcome1({ enabled: true, environment: 'preview' });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.WRONG_ENVIRONMENT, 'preview also declines');
}

console.log('\n-- decline: no auth context --\n');
{
  const r = await attemptOutcome1({ enabled: true, environment: 'development', principalId: null, gkAssetId: 'asset-1' });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT, 'missing principalId declines');
}
{
  const r = await attemptOutcome1({ enabled: true, environment: 'development', principalId: 'p-1', gkAssetId: null });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT, 'missing gkAssetId declines');
}

console.log('\n-- decline: no prediction (a refusal is a legitimate state, never fabricated) --\n');
{
  const r = await attemptOutcome1({
    enabled: true, environment: 'development', principalId: 'p-1', gkAssetId: 'asset-1',
    priceString: null, decision: validDecision(),
  });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.NO_PREDICTION, 'null out.price (refused-to-price) declines, never records a fake $0');
}
{
  const r = await attemptOutcome1({
    enabled: true, environment: 'development', principalId: 'p-1', gkAssetId: 'asset-1',
    priceString: '$61.41', decision: { action: null },
  });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.NO_PREDICTION, 'missing decision.action declines');
}

console.log('\n-- success: calls recordValuation then recordDecision with the exact real mapping --\n');
{
  const calls = [];
  const r = await attemptOutcome1({
    enabled: true, environment: 'development', principalId: 'p-1', gkAssetId: 'asset-1',
    marketPopulationId: 'pop-1', priceString: '$61.41', decision: validDecision(),
    gradeAssumption: 4.0, buildSha: 'abc1234', idempotencyKey: 'outcome1-test-key', correlationId: 'corr-1',
    recordValuation: async (args) => { calls.push(['recordValuation', args]); return fakeRecordValuationOk(args); },
    recordDecision: async (args) => { calls.push(['recordDecision', args]); return fakeRecordDecisionOk(args); },
  });
  assertTrue(r.attempted && !r.declineReason, 'success: attempted=true, no decline');
  assertEq(r.result, { valuationEventId: 've-1', decisionEventId: 'de-1' }, 'returns both durable IDs');
  assertEq(calls[0][0], 'recordValuation', 'recordValuation called first');
  assertEq(calls[0][1], {
    principalId: 'p-1', gkAssetId: 'asset-1', valueAmount: 61.41, valueCurrency: 'USD',
    method: 'engine-computed', marketPopulationId: 'pop-1', gradeAssumption: 4.0, buildSha: 'abc1234',
    idempotencyKey: 'outcome1-test-key', correlationId: 'corr-1', occurredAt: new Date(1789000000000).toISOString(),
  }, 'recordValuation receives the exact real mapping (price parsed, populationId threaded, buildSha resolvable, occurredAt = decision.timestamp)');
  assertEq(calls[1][0], 'recordDecision', 'recordDecision called second, after valuation commits');
  assertEq(calls[1][1], {
    principalId: 'p-1', gkAssetId: 'asset-1', recommendation: 'LIST_LOW',
    reasonCodes: [{ type: 'warning', code: 'thin-pool' }],
    valuationEventId: 've-1', idempotencyKey: 'outcome1-test-key', correlationId: 'corr-1',
    occurredAt: new Date(1789000000000).toISOString(),
  }, 'recordDecision links to the just-created valuationEventId and carries the recommendation verbatim');

  console.log('\n  -- semantic separation (non-negotiable): no operator-action field anywhere in either call --\n');
  const FORBIDDEN_KEYS = ['accepted', 'rejected', 'listed', 'sold', 'disposition', 'manualPrice', 'operatorChoice', 'listingId'];
  for (const [name, args] of calls) {
    for (const k of FORBIDDEN_KEYS) {
      assertTrue(!(k in args), `${name} args do not carry a "${k}" operator-action field`);
    }
  }
}

console.log('\n-- valuation write failure surfaces as valuation-write-failed, never throws --\n');
{
  const r = await attemptOutcome1({
    enabled: true, environment: 'development', principalId: 'p-1', gkAssetId: 'asset-1',
    priceString: '$61.41', decision: validDecision(),
    recordValuation: async () => { throw Object.assign(new Error('constraint violation'), { code: '23514' }); },
    recordDecision: fakeRecordDecisionOk,
  });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.VALUATION_WRITE_FAILED, 'declineReason=valuation-write-failed');
  assertEq(r.error?.pgErrorCode, '23514', 'real Postgres error code surfaced in diagnostic');
}

console.log('\n-- decision write failure surfaces valuationEventId (the valuation DID commit) --\n');
{
  const r = await attemptOutcome1({
    enabled: true, environment: 'development', principalId: 'p-1', gkAssetId: 'asset-1',
    priceString: '$61.41', decision: validDecision(),
    recordValuation: fakeRecordValuationOk,
    recordDecision: async () => { throw new Error('boom'); },
  });
  assertEq(r.declineReason, OUTCOME1_DECLINE_REASONS.DECISION_WRITE_FAILED, 'declineReason=decision-write-failed');
  assertEq(r.valuationEventId, 've-1', 'the already-committed valuationEventId is surfaced, not hidden');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
