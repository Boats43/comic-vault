// GK-276 -- PredictionError provenance gate (no database).
// PRECISE POINTER + UNTRUSTED PROVENANCE = REFUSED. Provenance outranks the
// legacy `method` string. OPERATOR_OVERRIDE is never engine accuracy.
// Run: node tests/gk276-scorer-provenance-gate.test.js
import { scoreOutcomePrediction } from '../src/lib/ebayOutcomeReconciler.js';
import { SCORING_RULE_VERSION, REFUSAL_CODES } from '../src/lib/predictionErrorScoring.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

const mk = (provenance, method = 'engine-computed') => async () => ({
  decisionEventId: 'D1', recommendation: 'LIST_NOW', valuationEventId: 'V1',
  valuation: { valuationEventId: 'V1', valueAmount: 61.41, method, gradeAssumption: '4.0', buildSha: 'real-sha', provenance, occurredAt: 'x', recordedAt: 'x' },
});
const score = (provenance, method) => scoreOutcomePrediction(
  { principalId: 'p', gkAssetId: 'A', listedRow: { decision_event_id: 'D1', ask_amount: '80.00', occurred_at: '2026-10-01T00:00:00Z' }, soldOccurredAt: '2026-10-05T00:00:00Z', economics: { gross: 75, fees: 9, realizedNet: 66 }, economicsStatus: 'KNOWN' },
  { getHistoricalValuationForDecision: mk(provenance, method) }
);

console.log('\n=== GK-276 scorer provenance gate ===\n');
const server = await score('SERVER_DERIVED');
ok(server.status === 'SCORED' && server.predictedValue === 61.41, 'SERVER_DERIVED -> scored');
ok(server.valuationProvenance === 'SERVER_DERIVED' && server.valuationBuildSha === 'real-sha' && server.valuationEventId === 'V1' && server.decisionEventId === 'D1' && server.scoringRuleVersion === SCORING_RULE_VERSION, 'projection pins provenance, build_sha, valuation_event_id, decision_event_id, scoring_rule_version');
ok(SCORING_RULE_VERSION === 'pe-historical-anchor-v2', 'scoring rule version bumped to v2');

const client = await score('CLIENT_ASSERTED', 'engine-computed');
ok(client.status === 'REFUSED' && client.refusalCode === REFUSAL_CODES.VALUATION_PROVENANCE_UNTRUSTED, "CLIENT_ASSERTED (even with method='engine-computed') -> REFUSED: provenance outranks method");
ok(client.predictedValue === undefined && !('grossSignedError' in client), 'REFUSED result carries no predicted value / error numbers (no $0, no best-effort)');

const legacy = await score('LEGACY_UNKNOWN');
ok(legacy.status === 'REFUSED' && legacy.refusalCode === REFUSAL_CODES.VALUATION_PROVENANCE_UNTRUSTED, 'LEGACY_UNKNOWN -> REFUSED');

const unrecorded = await score(null);
ok(unrecorded.status === 'REFUSED' && unrecorded.refusalCode === REFUSAL_CODES.VALUATION_PROVENANCE_UNTRUSTED, 'unrecorded provenance -> REFUSED (fail closed)');

const forged = await score('SERVER-DERIVED-ish');
ok(forged.status === 'REFUSED', 'an out-of-vocabulary provenance string is never accepted');

const override = await score('OPERATOR_OVERRIDE', 'operator-override');
ok(override.status === 'REFUSED' && override.refusalCode === REFUSAL_CODES.VALUATION_OPERATOR_OVERRIDE_NOT_ENGINE, 'OPERATOR_OVERRIDE -> excluded from engine PredictionError (distinct code, never mixed in)');
ok(override.predictedValue === undefined, 'OPERATOR_OVERRIDE result exposes no engine score');

const overrideWithEngineMethod = await score('OPERATOR_OVERRIDE', 'engine-computed');
ok(overrideWithEngineMethod.status === 'REFUSED', "OPERATOR_OVERRIDE with method='engine-computed' is still excluded (provenance outranks method)");

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
