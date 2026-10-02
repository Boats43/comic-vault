// tests/outcome1-runtime-bridge-unit.test.js
//
// Outcome #1 / GK-276 — pure-logic proof of src/lib/outcome1RuntimeBridge.js. No
// database — recordEconomicDecision/resolveCollectionItemLink are injected fakes,
// proving the bridge's own gating (Development flag, Production asset allowlist,
// explicit intent, real build identity, server-owned inputs), mapping, and
// server-derived semantic fingerprint (SAME vs MATERIALLY NEW economic decision).
//
// Invoke: node tests/outcome1-runtime-bridge-unit.test.js

import {
  attemptOutcome1, attemptOutcome1Production, parseFmtUsd, buildDecisionReasonCodes, OUTCOME1_DECLINE_REASONS,
  parseOutcome1ProductionAllowlist, isOutcome1ProductionAssetAllowed, isRealBuildSha, computeEconomicDecisionFingerprint,
} from '../src/lib/outcome1RuntimeBridge.js';
import fs from 'node:fs';

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

console.log('\n=== Outcome #1 runtime bridge (GK-276) — deterministic unit proof ===\n');

console.log('-- parseFmtUsd --\n');
assertEq(parseFmtUsd('$61.41'), 61.41, 'simple dollar string');
assertEq(parseFmtUsd('$1,234.56'), 1234.56, 'thousands-separator string');
assertEq(parseFmtUsd(null), null, 'null -> null');
assertEq(parseFmtUsd('not a price'), null, 'garbage -> null, never NaN');
assertEq(parseFmtUsd('$0.00'), 0, 'zero is a valid parsed value');

console.log('\n-- buildDecisionReasonCodes --\n');
assertEq(buildDecisionReasonCodes({ blockers: ['b'], warnings: ['w1', 'w2'] }), [
  { type: 'blocker', code: 'b' }, { type: 'warning', code: 'w1' }, { type: 'warning', code: 'w2' },
], 'blockers first, then warnings, verbatim');
assertEq(buildDecisionReasonCodes(null), [], 'null decision -> []');

const GK = '01a0c104-00ee-7055-bb95-359233761f53';
const OTHER = '01a0bb24-c806-7a63-aa86-ce26fe8eed83';
const decision = () => ({ action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: ['thin-pool'], timestamp: 1789000000000 });
const calls = [];
const fakeRecord = async (args) => { calls.push(args); return { valuationEventId: 've-1', decisionEventId: 'de-1', replayed: false }; };
const baseProd = () => ({
  environment: 'production', allowlistRaw: GK, explicitIntent: true, principalId: 'p-1', gkAssetId: GK,
  priceString: '$61.41', decision: decision(), gradeAssumption: 4.0, evidenceKey: 'ebay-active|HIGH',
  buildSha: 'abc1234', correlationId: 'corr-1', recordEconomicDecision: fakeRecord,
});

console.log('\n-- allowlist parsing: exact UUIDs only, no wildcard / "all" --\n');
assertEq([...parseOutcome1ProductionAllowlist(undefined)], [], 'absent -> empty');
assertEq([...parseOutcome1ProductionAllowlist('')], [], 'empty string -> empty');
assertEq([...parseOutcome1ProductionAllowlist('*')], [], 'wildcard "*" is not an entry');
assertEq([...parseOutcome1ProductionAllowlist('all')], [], '"all" is not an entry');
assertEq([...parseOutcome1ProductionAllowlist(`all, * , ${GK} ,junk`)], [GK], 'mixed list keeps ONLY the valid exact UUID; "all"/"*" never widen it');
assertTrue(isOutcome1ProductionAssetAllowed(` ${GK.toUpperCase()} `, GK), 'matching is exact (case/whitespace-insensitive on the same UUID)');
assertTrue(!isOutcome1ProductionAssetAllowed(GK, OTHER), 'a different asset is not allowed');
assertTrue(!isOutcome1ProductionAssetAllowed(GK.slice(0, 20), GK), 'a prefix/partial id is not allowed');

console.log('\n-- build identity --\n');
assertTrue(isRealBuildSha('abc1234') && isRealBuildSha('b7d24d6'), 'a git sha prefix is a real build identity');
assertTrue(!isRealBuildSha('unknown') && !isRealBuildSha(null) && !isRealBuildSha('') && !isRealBuildSha('GK-226-manual'), "'unknown'/null/empty/non-sha are not");

console.log('\n-- Development path (unchanged gating) --\n');
{
  assertEq(await attemptOutcome1({ enabled: false, environment: 'development' }), { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.DISABLED }, 'dev: disabled flag declines');
  const r = await attemptOutcome1({ ...baseProd(), environment: 'development', enabled: true, allowlistRaw: undefined, explicitIntent: undefined, buildSha: 'unknown' });
  assertTrue(r.attempted === true && !r.declineReason, 'dev: enabled flag writes WITHOUT an allowlist/intent/real-sha (Development behavior unchanged)');
  assertEq((await attemptOutcome1({ enabled: true, environment: 'preview' })).declineReason, OUTCOME1_DECLINE_REASONS.WRONG_ENVIRONMENT, 'any other environment declines');
}

console.log('\n-- Production gates --\n');
{
  calls.length = 0;
  assertEq((await attemptOutcome1({ ...baseProd(), allowlistRaw: undefined })).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'absent allowlist -> no Production write');
  assertEq((await attemptOutcome1({ ...baseProd(), allowlistRaw: '' })).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'EMPTY allowlist -> no Production write');
  assertEq((await attemptOutcome1({ ...baseProd(), allowlistRaw: '*' })).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'wildcard -> no Production write');
  assertEq((await attemptOutcome1({ ...baseProd(), allowlistRaw: OTHER })).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'WRONG gkAssetId -> no Production write');
  assertEq((await attemptOutcome1({ ...baseProd(), enabled: true, allowlistRaw: undefined })).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'the Development flag does NOT open Production');
  assertEq((await attemptOutcome1({ ...baseProd(), explicitIntent: false })).declineReason, OUTCOME1_DECLINE_REASONS.NO_EXPLICIT_INTENT, 'allowlisted asset but no explicit intent (a plain refresh) -> no write');
  assertEq((await attemptOutcome1({ ...baseProd(), buildSha: 'unknown' })).declineReason, OUTCOME1_DECLINE_REASONS.BUILD_IDENTITY_UNAVAILABLE, "build 'unknown' -> durable write REFUSED");
  assertEq((await attemptOutcome1({ ...baseProd(), principalId: null })).declineReason, OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT, 'no principal -> no write');
  assertEq((await attemptOutcome1({ ...baseProd(), priceString: null })).declineReason, OUTCOME1_DECLINE_REASONS.NO_PREDICTION, 'refused-to-price (null price) -> no fabricated record');
  assertEq(calls.length, 0, 'NONE of the declined cases called the writer');
}

console.log('\n-- exact allowlisted asset: the write, and what it carries --\n');
{
  calls.length = 0;
  const r = await attemptOutcome1(baseProd());
  assertTrue(r.attempted === true && r.result?.valuationEventId === 've-1' && r.result?.decisionEventId === 'de-1', 'exact allowlisted asset is eligible and writes one atomic pair');
  assertEq(calls.length, 1, 'exactly ONE writer call (one atomic valuation+decision operation, not two)');
  const a = calls[0];
  assertTrue(a.principalId === 'p-1' && a.gkAssetId === GK && a.valueAmount === 61.41 && a.buildSha === 'abc1234' && a.recommendation === 'LIST_LOW', 'server-owned values reach the writer');
  assertTrue(!('provenance' in a) && !('idempotencyKey' in a), 'no provenance and no client idempotencyKey parameter exists on the call (writer hard-codes SERVER_DERIVED, key is the fingerprint)');
  assertTrue(typeof a.semanticFingerprint === 'string' && a.semanticFingerprint.startsWith('econ-v1:'), 'server-derived semantic fingerprint is passed');
  assertEq(a.occurredAt, new Date(1789000000000).toISOString(), 'occurredAt = decision.timestamp');
  const failing = await attemptOutcome1({ ...baseProd(), recordEconomicDecision: async () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); } });
  assertEq(failing.declineReason, OUTCOME1_DECLINE_REASONS.ECONOMIC_WRITE_FAILED, 'a write failure is ONE structured decline (no half-written state to report)');
}

console.log('\n-- SAME vs MATERIALLY NEW economic decision (fingerprint) --\n');
{
  const base = { principalId: 'p-1', gkAssetId: GK, valueAmount: 61.41, gradeAssumption: 4, evidenceKey: 'ebay-active|HIGH', recommendation: 'LIST_LOW', reasonCodes: [{ type: 'warning', code: 'thin-pool' }], buildSha: 'abc1234' };
  const f0 = computeEconomicDecisionFingerprint(base);
  assertEq(computeEconomicDecisionFingerprint({ ...base }), f0, 'identical semantics -> identical fingerprint (a retry replays)');
  assertEq(computeEconomicDecisionFingerprint({ ...base, timestamp: 1, traceId: 'x', listPrice: 999, clientKey: 'k' }), f0, 'timestamps / trace ids / client list price / client keys are not inputs');
  const two = { ...base, reasonCodes: [{ type: 'warning', code: 'a' }, { type: 'warning', code: 'b' }] };
  assertEq(computeEconomicDecisionFingerprint({ ...two, reasonCodes: [...two.reasonCodes].reverse() }), computeEconomicDecisionFingerprint(two), 'reason-code ORDER does not matter');
  for (const [k, v] of Object.entries({ valueAmount: 62.41, gradeAssumption: 6, evidenceKey: 'ebay-active|LOW', recommendation: 'LIST_NOW', reasonCodes: [], buildSha: 'def5678', principalId: 'p-2', gkAssetId: OTHER })) {
    assertTrue(computeEconomicDecisionFingerprint({ ...base, [k]: v }) !== f0, `a changed ${k} is a MATERIALLY NEW decision (different fingerprint)`);
  }
}

console.log('\n-- attemptOutcome1Production: the whole canary decision --\n');
{
  const durable = { title: 'Old Man Logan', issue: '25' };
  const args = (over = {}) => ({
    environment: 'production', recordDurableDecision: true, allowlistRaw: GK, ownedRefresh: true,
    principalId: 'p-1', collectionItemId: 'ci-1', durableAttributes: durable, requestIdentity: { title: 'OLD MAN LOGAN', issue: '#25' },
    priceString: '$15.28', decision: decision(), gradeAssumption: 9.2, evidenceKey: 'ebay-active|MEDIUM', buildSha: 'abc1234', correlationId: 'c',
    resolveCollectionItemLink: async () => ({ gkAssetId: GK }), recordEconomicDecision: fakeRecord, ...over,
  });
  calls.length = 0;
  assertEq(await attemptOutcome1Production(args({ environment: 'development' })), { skipped: true }, 'not Production -> skipped entirely');
  assertEq(await attemptOutcome1Production(args({ recordDurableDecision: undefined })), { skipped: true }, 'no explicit recordDurableDecision -> skipped (a refresh alone never writes)');
  assertEq((await attemptOutcome1Production(args({ allowlistRaw: undefined }))).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'absent allowlist declines before any DB call');
  assertEq((await attemptOutcome1Production(args({ ownedRefresh: false }))).declineReason, OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT, 'not an owned-item flow -> no write');
  assertEq((await attemptOutcome1Production(args({ principalId: null }))).declineReason, OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT, 'principal not verified/owner-confirmed -> no write (cross-principal attempt)');
  assertEq((await attemptOutcome1Production(args({ requestIdentity: { title: 'Some Other Book', issue: '25' } }))).declineReason, OUTCOME1_DECLINE_REASONS.INPUTS_NOT_SERVER_OWNED, 'request identity differs from the durable owned item -> declined');
  assertEq((await attemptOutcome1Production(args({ requestIdentity: { title: 'Old Man Logan', issue: '26' } }))).declineReason, OUTCOME1_DECLINE_REASONS.INPUTS_NOT_SERVER_OWNED, 'different issue -> declined');
  assertEq((await attemptOutcome1Production(args({ durableAttributes: {} }))).declineReason, OUTCOME1_DECLINE_REASONS.INPUTS_NOT_SERVER_OWNED, 'durable item with no title -> declined');
  assertEq((await attemptOutcome1Production(args({ resolveCollectionItemLink: async () => null }))).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'item with no collection_item_link (no physical asset) -> no write, no fake asset');
  assertEq((await attemptOutcome1Production(args({ resolveCollectionItemLink: async () => ({ gkAssetId: OTHER }) }))).declineReason, OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED, 'linked asset not on the allowlist -> no write (unrelated Production asset cannot write)');
  assertEq(calls.length, 0, 'every declined case left the writer uncalled');
  const ok = await attemptOutcome1Production(args());
  assertTrue(ok.attempted === true && calls.length === 1 && calls[0].gkAssetId === GK, 'allowlisted + owned + identity-consistent + explicit intent + real build -> exactly one atomic write');
}

console.log('\n-- static: the bridge and enrich wiring contain no client economic input --\n');
{
  const bridge = fs.readFileSync(new URL('../src/lib/outcome1RuntimeBridge.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assertTrue(!/d5dIdempotencyKey/.test(bridge) && !/idempotencyKey/.test(bridge), 'bridge references no client idempotency key at all');
  assertTrue(!/provenance/.test(bridge), 'bridge never sets provenance (the writer hard-codes SERVER_DERIVED)');
  const enrich = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(!/idempotencyKey: req\.body\?\.d5dIdempotencyKey \|\| null,\s*\n\s*correlationId: pipelineTraceId \|\| null,\s*\n\s*recordValuation/.test(enrich), 'enrich no longer feeds a client key to the Outcome #1 writer');
  const m = enrich.match(/attemptOutcome1Production\(\{[\s\S]*?\n      \}\);/);
  assertTrue(!!m && !/req\.body\??\.(price|value|valuation|decision|listPrice)/.test(m[0]), 'the Production canary call reads no client price/value/valuation/decision from the request');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed) { failures.forEach((f) => console.log(f)); process.exit(1); }
process.exit(0);
