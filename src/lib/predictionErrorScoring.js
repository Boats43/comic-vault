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
