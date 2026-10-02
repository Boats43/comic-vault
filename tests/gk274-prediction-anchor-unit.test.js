// GK-274 — PredictionError historical anchor (no database).
// HISTORICAL DECISION SCORING MUST USE THE HISTORICAL VALUATION THE DECISION
// ACTUALLY USED. Run: node tests/gk274-prediction-anchor-unit.test.js
import fs from 'node:fs';
import { scoreOutcomePrediction } from '../src/lib/ebayOutcomeReconciler.js';
import { resolveHistoricalAnchor, SCORING_RULE_VERSION, SCORE_STATUS, REFUSAL_CODES } from '../src/lib/predictionErrorScoring.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// A tiny in-memory ledger standing in for valuation_event / decision_event.
const makeLedger = () => {
  const valuations = []; // {id, assetId, value, buildSha, occurredAt}
  const decisions = [];  // {id, assetId, valuationId}
  return {
    addValuation: (id, assetId, value, buildSha, occurredAt) => valuations.push({ id, assetId, value, buildSha, occurredAt }),
    addDecision: (id, assetId, valuationId) => decisions.push({ id, assetId, valuationId }),
    // The NEW lookup: through the decision, same asset only.
    byDecision: async ({ gkAssetId, decisionEventId }) => {
      const d = decisions.find((x) => x.id === decisionEventId && x.assetId === gkAssetId);
      if (!d) return null;
      const v = d.valuationId ? valuations.find((x) => x.id === d.valuationId && x.assetId === d.assetId) : null;
      return {
        decisionEventId: d.id, recommendation: 'LIST_NOW', valuationEventId: d.valuationId ?? null,
        valuation: v ? { valuationEventId: v.id, valueAmount: v.value, method: 'engine-computed', gradeAssumption: '4.0', buildSha: v.buildSha, occurredAt: v.occurredAt, recordedAt: v.occurredAt } : null,
      };
    },
    // The OLD (defective) behaviour, kept only as the control.
    latest: (assetId) => valuations.filter((x) => x.assetId === assetId).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))[0] || null,
  };
};

const economics = { gross: 75, fees: 9, realizedNet: 66 };
const listed = (decisionEventId) => ({ decision_event_id: decisionEventId, ask_amount: '80.00', occurred_at: '2026-10-01T00:00:00Z' });
const score = (L, row, over = {}) => scoreOutcomePrediction(
  { principalId: 'p1', gkAssetId: 'A1', listedRow: row, soldOccurredAt: '2026-10-05T00:00:00Z', economics, economicsStatus: 'KNOWN', ...over },
  { getHistoricalValuationForDecision: L.byDecision }
);

console.log('\n=== GK-274 PredictionError historical anchor ===\n');

console.log('— the required scenario: V1 → D1 → later V2 —');
{
  const L = makeLedger();
  L.addValuation('V1', 'A1', 61.41, 'build-v1', '2026-09-30T00:00:00Z');
  L.addDecision('D1', 'A1', 'V1');
  const before = await score(L, listed('D1'));
  L.addValuation('V2', 'A1', 999.99, 'build-v2', '2026-10-03T00:00:00Z'); // a LATER valuation (refresh / correction)
  const after = await score(L, listed('D1'));
  ok(before.status === 'SCORED' && before.predictedValue === 61.41, 'D1 scored against V1 ($61.41)');
  ok(after.predictedValue === 61.41 && after.status === 'SCORED', 'after a later V2 ($999.99) is appended, the SAME decision still scores against V1');
  ok(JSON.stringify(before) === JSON.stringify(after), 'the entire score is byte-identical before and after V2 (history is not rewritten)');
  ok(after.valuationEventId === 'V1' && after.decisionEventId === 'D1', 'result pins the exact valuation_event and decision_event ids');
  ok(after.valuationBuildSha === 'build-v1', 'result pins the valuation build_sha that produced the prediction');
  ok(after.scoringRuleVersion === SCORING_RULE_VERSION && typeof SCORING_RULE_VERSION === 'string', 'result carries scoring_rule_version');
  ok(L.latest('A1').id === 'V2' && L.latest('A1').value !== after.predictedValue, 'CONTROL: the OLD "latest valuation" lookup would have returned V2 — the test is discriminating');
  ok(after.grossSignedError === 75 - 61.41, 'errors are computed from V1 (gross − predicted), not from V2');
}

console.log('\n— REFUSED, no fallback —');
{
  const L = makeLedger();
  L.addValuation('V1', 'A1', 61.41, 'b', '2026-09-30T00:00:00Z');
  L.addDecision('D1', 'A1', 'V1');
  L.addDecision('D_NOVAL', 'A1', null);
  L.addDecision('D_DANGLING', 'A1', 'V_DOES_NOT_EXIST');
  L.addValuation('V_NULL', 'A1', null, 'b', '2026-09-30T00:00:00Z');
  L.addDecision('D_NULLVAL', 'A1', 'V_NULL');
  L.addValuation('V_OTHER', 'A2', 500, 'b', '2026-09-30T00:00:00Z');
  L.addDecision('D_XASSET', 'A1', 'V_OTHER'); // decision on A1 pointing at another asset's valuation

  let lookupCalls = 0;
  const counting = { getHistoricalValuationForDecision: async (a) => { lookupCalls++; return L.byDecision(a); } };
  const args = (row) => ({ principalId: 'p1', gkAssetId: 'A1', listedRow: row, soldOccurredAt: 'x', economics, economicsStatus: 'KNOWN' });

  const noId = await scoreOutcomePrediction(args(listed(null)), counting);
  ok(noId.status === 'REFUSED' && noId.refusalCode === REFUSAL_CODES.DECISION_ANCHOR_MISSING, 'missing decision_event_id → REFUSED');
  ok(lookupCalls === 0, 'no lookup at all is attempted without a decision id (no "best available" search)');
  ok(noId.predictedValue === undefined && !('grossSignedError' in noId), 'a REFUSED result has no predictedValue and no error numbers (no $0, no best-effort score)');

  const noDecRow = await scoreOutcomePrediction(args(listed('D_GHOST')), counting);
  ok(noDecRow.status === 'REFUSED' && noDecRow.refusalCode === REFUSAL_CODES.DECISION_ROW_MISSING, 'decision_event_id that resolves to no decision → REFUSED');

  const noValId = await scoreOutcomePrediction(args(listed('D_NOVAL')), counting);
  ok(noValId.status === 'REFUSED' && noValId.refusalCode === REFUSAL_CODES.VALUATION_ANCHOR_MISSING, 'decision with no valuation_event_id → REFUSED (V1 exists for the asset but is NOT substituted)');

  const dangling = await scoreOutcomePrediction(args(listed('D_DANGLING')), counting);
  ok(dangling.status === 'REFUSED' && dangling.refusalCode === REFUSAL_CODES.VALUATION_ROW_MISSING, 'referenced valuation row missing → REFUSED');

  const nullVal = await scoreOutcomePrediction(args(listed('D_NULLVAL')), counting);
  ok(nullVal.status === 'REFUSED' && nullVal.refusalCode === REFUSAL_CODES.VALUATION_VALUE_MISSING, 'referenced valuation with no usable value → REFUSED (not scored as $0)');

  const xasset = await scoreOutcomePrediction(args(listed('D_XASSET')), counting);
  ok(xasset.status === 'REFUSED' && xasset.refusalCode === REFUSAL_CODES.VALUATION_ROW_MISSING, 'a valuation belonging to a DIFFERENT asset is not accepted as the anchor');
  ok(['REFUSED'].every((x) => SCORE_STATUS[x] === x), 'REFUSED is a first-class score status');
  ok([noId, noDecRow, noValId, dangling, nullVal, xasset].every((r) => r.scoringRuleVersion === SCORING_RULE_VERSION), 'every REFUSED result still names the scoring rule version');
}

console.log('\n— economics / ask behaviour around the anchor —');
{
  const L = makeLedger();
  L.addValuation('V1', 'A1', 61.41, 'b', '2026-09-30T00:00:00Z');
  L.addDecision('D1', 'A1', 'V1');
  const pending = await score(L, listed('D1'), { economicsStatus: 'PENDING' });
  ok(pending.status === 'ECONOMICS_PENDING' && pending.predictedValue === 61.41 && pending.valuationEventId === 'V1', 'economics PENDING stays its own state and still pins the anchor');
  const noAnchorPending = await score(L, listed(null), { economicsStatus: 'PENDING' });
  ok(noAnchorPending.status === 'REFUSED', 'a missing anchor REFUSES even while economics are pending (a permanent defect is not hidden behind a temporary one)');
  const noAsk = await score(L, { decision_event_id: 'D1', ask_amount: null, occurred_at: 'x' });
  ok(noAsk.status === 'NOT_ELIGIBLE' && noAsk.valuationEventId === 'V1', 'no ask_amount stays NOT_ELIGIBLE (unchanged)');
  const partial = await score(L, listed('D1'), { economicsStatus: 'PARTIAL' });
  ok(partial.status === 'SCORED' && partial.netSignedError == null, 'PARTIAL economics: gross scored, net not fabricated (unchanged)');
}

console.log('\n— pure anchor resolution —');
ok(resolveHistoricalAnchor({ decisionEventId: 'D', anchor: { valuationEventId: 'V', valuation: { valuationEventId: 'V', valueAmount: 10, buildSha: 'x' } } }).ok === true, 'a complete chain resolves');
ok(resolveHistoricalAnchor({ decisionEventId: 'D', anchor: { valuationEventId: 'V', valuation: { valuationEventId: 'V', valueAmount: 0, buildSha: 'x' } } }).ok === true, 'a genuine $0 valuation is a real recorded value, not a "missing" one (never substituted, never refused for being zero)');

console.log('\n— static: no latest-valuation path remains in the scorer; same-asset, ownership-checked, read-only —');
const rec = read('../src/lib/ebayOutcomeReconciler.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/getLatestValuation\b/.test(rec), 'the reconciler no longer imports or calls getLatestValuation');
const repo = read('../src/modules/assets/repository.js');
const fn = repo.slice(repo.indexOf('export async function getDecisionWithValuation'), repo.indexOf('export async function getLatestValuationEvent'));
ok(/LEFT JOIN data1_dev\.valuation_event v ON v\.id = d\.valuation_event_id AND v\.asset_id = d\.asset_id/.test(fn), 'SQL joins the valuation through decision_event.valuation_event_id, on the same asset');
ok(!/ORDER BY/i.test(fn) && !/LIMIT/i.test(fn), 'SQL has no ORDER BY / LIMIT recency selection');
ok(/WHERE d\.id = \$1 AND d\.asset_id = \$2/.test(fn), 'SQL is keyed by the specific decision id and asset');
const svc = read('../src/modules/assets/service.js');
const sfn = svc.slice(svc.indexOf('export async function getHistoricalValuationForDecision'), svc.indexOf('// getOutcomeEventsForListing'));
ok(/assertPrincipalOwnsAsset/.test(sfn) && /assertPrincipalActive/.test(sfn) && !/BEGIN|INSERT|UPDATE|DELETE/.test(sfn), 'service is principal-checked and read-only (no write, no schema change)');
const script = read('../scripts/ingest-outcome1-financials.mjs');
ok(!/ORDER BY occurred_at DESC LIMIT 1/.test(script) && /decision_event_id/.test(script), 'the manual ingest script uses the same historical anchor');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
