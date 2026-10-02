// src/lib/predictionErrorScoring.js — GK-209 Outcome #1 CLOSER.
//
// Pure, deterministic scoring: how far off was the original prediction
// from what actually happened. NEVER fabricates a realized outcome —
// when no realized price exists yet (ACTIVE_AT_CUTOFF, or simply not
// sold yet), every realized-price-dependent field is explicitly
// CENSORED, never a guessed or defaulted number.
//
// Four distinct facts, never conflated (this dispatch's own explicit
// instruction):
//   predictedValue  — the original engine valuation (e.g. $61.41)
//   askAmount       — the actual price the listing went up at (e.g. $75.00)
//   realizedGross   — the actual sale price, once (if ever) sold
//   realizedNet     — realizedGross minus fees/shipping/refunds plus credits
//
// No I/O, no DB — a pure function over already-durable facts.

export const SCORE_STATUS = Object.freeze({
  SCORED: 'SCORED',
  CENSORED: 'CENSORED', // ACTIVE_AT_CUTOFF or otherwise not yet realized — no invented number
  REFUSED: 'REFUSED', // GK-274 — the historical decision/valuation anchor is missing; no score is produced, no fallback
});

function signedAndPercentError(predicted, realized) {
  const signedError = realized - predicted;
  // percentage error is relative to the PREDICTION (the thing being
  // scored), the conventional framing for a forecast-accuracy metric —
  // undefined (null) if predicted is exactly zero, never a divide-by-zero NaN.
  const percentError = predicted !== 0 ? (signedError / predicted) * 100 : null;
  return { signedError, percentError };
}

// scorePrediction — the single entry point.
// Inputs (all already-durable facts, never re-derived here):
//   predictedValue: number (e.g. valuation_event.value_amount)
//   askAmount: number (e.g. outcome_event.ask_amount for the LISTED row)
//   realizedGross: number | null (outcome_economics_component 'gross' sum, or null if unsold)
//   realizedNet: number | null (getRealizedEconomics().realizedNet, or null if unsold/no components yet)
//   listedAt: Date | string | null (the LISTED row's occurred_at)
//   realizedAt: Date | string | null (the SOLD row's occurred_at, or null if unsold)
//   isCensored: boolean — true for ACTIVE_AT_CUTOFF (or any other non-terminal/right-censored state)
export function scorePrediction({
  predictedValue, askAmount, realizedGross, realizedNet, listedAt, realizedAt, isCensored,
} = {}) {
  if (predictedValue == null || askAmount == null) {
    throw new Error('scorePrediction requires predictedValue and askAmount — both are always known at LISTED time');
  }

  const askVsPredicted = signedAndPercentError(predictedValue, askAmount);

  const hasRealized = !isCensored && realizedGross != null;
  if (!hasRealized) {
    return {
      status: isCensored ? SCORE_STATUS.CENSORED : SCORE_STATUS.CENSORED,
      predictedValue, askAmount,
      askVsPredictedSignedError: askVsPredicted.signedError,
      askVsPredictedPercentError: askVsPredicted.percentError,
      grossSignedError: null,
      grossPercentError: null,
      netSignedError: null,
      netPercentError: null,
      actualTimeToSaleDays: null,
      censoredReason: isCensored ? 'ACTIVE_AT_CUTOFF (right-censored — still listed at the observation cutoff, no sale to score)' : 'no realized sale recorded yet',
    };
  }

  const gross = signedAndPercentError(predictedValue, realizedGross);
  const netKnown = realizedNet != null;
  const net = netKnown ? signedAndPercentError(predictedValue, realizedNet) : { signedError: null, percentError: null };

  let actualTimeToSaleDays = null;
  if (listedAt && realizedAt) {
    const ms = new Date(realizedAt).getTime() - new Date(listedAt).getTime();
    actualTimeToSaleDays = ms / (24 * 60 * 60 * 1000);
  }

  return {
    status: SCORE_STATUS.SCORED,
    predictedValue, askAmount,
    askVsPredictedSignedError: askVsPredicted.signedError,
    askVsPredictedPercentError: askVsPredicted.percentError,
    grossSignedError: gross.signedError,
    grossPercentError: gross.percentError,
    netSignedError: net.signedError,
    netPercentError: net.percentError,
    actualTimeToSaleDays,
    censoredReason: null,
  };
}

// ───────────────────────── GK-274 — historical anchor ─────────────────────────
//
// HISTORICAL DECISION SCORING MUST USE THE HISTORICAL VALUATION THE DECISION
// ACTUALLY USED. The score of an earlier decision must never change because
// a LATER valuation was appended (a re-valuation, an operator correction, a
// refresh). The anchor is:
//   outcome_event.decision_event_id
//     -> decision_event.valuation_event_id
//       -> that exact valuation_event row.
// Never the latest valuation, never current collection state, never a
// "best available" valuation. Any break in the chain REFUSES — no fallback,
// no $0 substitution, no best-effort number.
//
// Bump when the scoring semantics change so a stored/compared score always
// names the rule that produced it.
// v2 (GK-276): adds the valuation-PROVENANCE gate on top of v1's historical anchor.
export const SCORING_RULE_VERSION = 'pe-historical-anchor-v2';

export const REFUSAL_CODES = Object.freeze({
  DECISION_ANCHOR_MISSING: 'DECISION_ANCHOR_MISSING',       // the LISTED outcome row carries no decision_event_id
  DECISION_ROW_MISSING: 'DECISION_ROW_MISSING',             // decision_event_id points at no decision for this asset
  VALUATION_ANCHOR_MISSING: 'VALUATION_ANCHOR_MISSING',     // the decision carries no valuation_event_id
  VALUATION_ROW_MISSING: 'VALUATION_ROW_MISSING',           // the referenced valuation row does not exist for this asset
  VALUATION_VALUE_MISSING: 'VALUATION_VALUE_MISSING',       // the referenced valuation has no usable value
  VALUATION_PROVENANCE_UNTRUSTED: 'VALUATION_PROVENANCE_UNTRUSTED', // CLIENT_ASSERTED / LEGACY_UNKNOWN / unrecorded provenance
  VALUATION_OPERATOR_OVERRIDE_NOT_ENGINE: 'VALUATION_OPERATOR_OVERRIDE_NOT_ENGINE', // an operator judgment is not engine accuracy
});

const refuse = (code, reason, extra = {}) => ({
  status: SCORE_STATUS.REFUSED,
  refusalCode: code,
  reason,
  scoringRuleVersion: SCORING_RULE_VERSION,
  ...extra,
});

/**
 * Pure resolution of the historical anchor from what the decision lookup
 * returned. `anchor` is getHistoricalValuationForDecision's result (or null).
 * Returns {ok:true, predictedValue, ...pins} or {ok:false, refusal}.
 */
export function resolveHistoricalAnchor({ decisionEventId, anchor } = {}) {
  if (!decisionEventId) {
    return { ok: false, refusal: refuse(REFUSAL_CODES.DECISION_ANCHOR_MISSING, 'the LISTED outcome row has no decision_event_id — the historical decision this outcome belongs to is unknown') };
  }
  if (!anchor) {
    return { ok: false, refusal: refuse(REFUSAL_CODES.DECISION_ROW_MISSING, 'decision_event_id does not resolve to a decision for this asset', { decisionEventId }) };
  }
  if (!anchor.valuationEventId) {
    return { ok: false, refusal: refuse(REFUSAL_CODES.VALUATION_ANCHOR_MISSING, 'the decision carries no valuation_event_id — what it valued is unknown', { decisionEventId }) };
  }
  if (!anchor.valuation) {
    return { ok: false, refusal: refuse(REFUSAL_CODES.VALUATION_ROW_MISSING, 'the valuation_event the decision references does not exist for this asset', { decisionEventId, valuationEventId: anchor.valuationEventId }) };
  }
  // GK-276 — PRECISE POINTER + UNTRUSTED PROVENANCE = REFUSED. Provenance
  // outranks the legacy `method` string: method='engine-computed' with
  // provenance CLIENT_ASSERTED is still CLIENT_ASSERTED. No fallback.
  const prov = anchor.valuation.provenance ?? null;
  if (prov === 'OPERATOR_OVERRIDE') {
    return { ok: false, refusal: refuse(REFUSAL_CODES.VALUATION_OPERATOR_OVERRIDE_NOT_ENGINE, 'the anchored valuation is an operator override — it may be evaluated as operator judgment, never as engine/model accuracy', { decisionEventId, valuationEventId: anchor.valuationEventId, valuationProvenance: prov }) };
  }
  if (prov !== 'SERVER_DERIVED') {
    return { ok: false, refusal: refuse(REFUSAL_CODES.VALUATION_PROVENANCE_UNTRUSTED, `the anchored valuation's provenance is ${prov ?? 'unrecorded'} — only SERVER_DERIVED valuations can be scored as engine predictions`, { decisionEventId, valuationEventId: anchor.valuationEventId, valuationProvenance: prov }) };
  }
  const v = anchor.valuation.valueAmount;
  if (v == null || !Number.isFinite(v)) {
    return { ok: false, refusal: refuse(REFUSAL_CODES.VALUATION_VALUE_MISSING, 'the referenced valuation has no usable value_amount', { decisionEventId, valuationEventId: anchor.valuationEventId }) };
  }
  return {
    ok: true,
    predictedValue: v,
    pins: {
      scoringRuleVersion: SCORING_RULE_VERSION,
      decisionEventId,
      valuationEventId: anchor.valuation.valuationEventId,
      valuationBuildSha: anchor.valuation.buildSha ?? null,
      valuationMethod: anchor.valuation.method ?? null,
      valuationProvenance: prov,
      valuationOccurredAt: anchor.valuation.occurredAt ?? null,
      valuationRecordedAt: anchor.valuation.recordedAt ?? null,
      gradeAssumption: anchor.valuation.gradeAssumption ?? null,
    },
  };
}
