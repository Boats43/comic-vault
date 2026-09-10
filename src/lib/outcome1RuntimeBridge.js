// src/lib/outcome1RuntimeBridge.js — Outcome #1: durable
// prediction/recommendation wiring.
//
// Reuses the EXISTING, already-built recordValuation/recordDecision
// primitives (src/modules/assets/service.js, valuation_event/
// decision_event tables, live since 0004) rather than inventing a new
// table -- this dispatch's own audit found these functions fully
// implemented, idempotent (GK-163 class-wide law), and asset-linked,
// but with ZERO real call sites (every existing row in both tables is
// fixture/test data, confirmed live-queried, GK-180). This module's
// only job is the narrow mapping from a real enrich.js response
// (out.price, out.decision, out.numericGrade) onto those two
// functions' existing parameter shapes, plus one additive linkage
// (marketPopulationId, db/data0/0020) into D5's own structured
// evidence chain (valuation_question -> market_population ->
// market_observation/applicability).
//
// Semantic separation (non-negotiable, this dispatch's own ruling):
// this module records ONLY what GrailKey predicted and recommended.
// It must NEVER record what the operator chose -- no accepted/
// rejected field, no listing/sale/disposition field, anywhere in this
// file. valuation_result (this module) != operator_action (a later,
// separate dispatch).

export const OUTCOME1_DECLINE_REASONS = Object.freeze({
  DISABLED: 'outcome1-disabled',
  WRONG_ENVIRONMENT: 'wrong-environment',
  NO_AUTH_CONTEXT: 'no-auth-context',
  NO_PREDICTION: 'no-prediction', // out.price/out.decision absent -- a refusal (refused-to-price, merchandise hard block, ID_REQUIRED) is a legitimate state, never fabricated into a fake result
  VALUATION_WRITE_FAILED: 'valuation-write-failed',
  DECISION_WRITE_FAILED: 'decision-write-failed',
});

// out.price is always a fmtUsd()-formatted string ("$1,234.56") or
// null (src/lib/pricingEngine.js:14) -- never a raw number. This is
// the exact inverse parse, factored out here (not duplicated ad hoc
// at the call site) so it carries its own unit proof.
export function parseFmtUsd(str) {
  if (str == null) return null;
  const stripped = String(str).replace(/[^0-9.-]/g, '');
  // Number('') === 0 in JS -- a string with no digits at all (garbage,
  // not a price) must decline, never silently become a fabricated $0.
  if (stripped === '' || stripped === '-') return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

// Maps decisionEngine.js's own live output shape
// (action/confidence/blockers/warnings/reason/nextStep,
// src/lib/decisionEngine.js) onto decision_event.reason_codes.
// Preserves the blocker-vs-warning distinction as a JSONB array of
// {type, code} pairs -- decisionEngine.js's own vocabulary, verbatim,
// never invented or reworded here.
export function buildDecisionReasonCodes(decision) {
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers : [];
  const warnings = Array.isArray(decision?.warnings) ? decision.warnings : [];
  return [
    ...blockers.map((code) => ({ type: 'blocker', code })),
    ...warnings.map((code) => ({ type: 'warning', code })),
  ];
}

// attemptOutcome1 — the single entry point. Dependency-injected
// (recordValuation/recordDecision passed in by the caller, mirroring
// d5dRuntimeBridge.js's own attemptChain1 shape) so this file is
// unit-testable without a real Postgres connection. Never throws for
// a decline outcome; a write failure from either injected function
// surfaces as a structured declineReason, never propagates raw.
export async function attemptOutcome1({
  enabled,
  environment,
  principalId,
  gkAssetId,
  marketPopulationId,
  priceString, // out.price, fmtUsd-formatted
  decision, // out.decision
  gradeAssumption, // out.numericGrade
  buildSha, // the SAME resolvable build identity already in api/enrich.js's own x-cv-build header (VERCEL_GIT_COMMIT_SHA / CV_BUILD_ID)
  idempotencyKey,
  correlationId,
  recordValuation, // injected: src/modules/assets/index.js's recordValuation
  recordDecision, // injected: src/modules/assets/index.js's recordDecision
} = {}) {
  if (!enabled) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.DISABLED };
  }
  if (environment !== 'development') {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.WRONG_ENVIRONMENT };
  }
  if (!principalId || !gkAssetId) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT };
  }

  const valueAmount = parseFmtUsd(priceString);
  if (valueAmount == null || !decision?.action) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.NO_PREDICTION };
  }

  // decision.timestamp (decisionEngine.js's own Date.now(), set at the
  // exact instant the recommendation was computed) is the true
  // occurredAt -- never persistence time, never a re-derivation.
  const occurredAt = decision.timestamp ? new Date(decision.timestamp).toISOString() : null;

  let valuationEventId;
  try {
    const r = await recordValuation({
      principalId,
      gkAssetId,
      valueAmount,
      valueCurrency: 'USD',
      method: 'engine-computed',
      marketPopulationId: marketPopulationId ?? null,
      gradeAssumption: gradeAssumption ?? null,
      buildSha,
      idempotencyKey,
      correlationId,
      occurredAt,
    });
    valuationEventId = r.valuationEventId;
  } catch (e) {
    return {
      attempted: true,
      declineReason: OUTCOME1_DECLINE_REASONS.VALUATION_WRITE_FAILED,
      error: { message: e?.message ?? String(e), pgErrorCode: e?.code ?? null },
    };
  }

  const reasonCodes = buildDecisionReasonCodes(decision);
  try {
    const r = await recordDecision({
      principalId,
      gkAssetId,
      recommendation: decision.action,
      reasonCodes,
      valuationEventId,
      idempotencyKey,
      correlationId,
      occurredAt,
    });
    return { attempted: true, result: { valuationEventId, decisionEventId: r.decisionEventId } };
  } catch (e) {
    return {
      attempted: true,
      declineReason: OUTCOME1_DECLINE_REASONS.DECISION_WRITE_FAILED,
      valuationEventId, // the valuation DID commit even though the paired decision failed -- surfaced, not hidden
      error: { message: e?.message ?? String(e), pgErrorCode: e?.code ?? null },
    };
  }
}
