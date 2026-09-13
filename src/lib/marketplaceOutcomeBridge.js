// src/lib/marketplaceOutcomeBridge.js — Outcome #1: durable
// marketplace-execution wiring for api/list-ebay.js.
//
// Mirrors outcome1RuntimeBridge.js's own shape exactly: a single,
// dependency-injected entry point (recordOutcomeEvent passed in by the
// caller, never imported here) so this file is unit-testable without a
// real Postgres connection, and NEVER throws -- a decline is always a
// typed result, never an exception that could interrupt the real eBay
// response the caller already has in hand.
//
// GK-151 note: api/list-ebay.js carries no mandatory GrailKey auth --
// that endpoint is still reachable with the legacy shared ACCESS_CODE
// gate alone (acceptable today, single-operator prototype, GK-151's own
// text). This bridge is therefore OPTIONAL/ADDITIVE by construction: a
// caller with no Bearer token, no gkAssetId, or no real prediction
// simply declines -- the eBay listing itself is never blocked or
// altered by anything in this file.
//
// Semantic separation (non-negotiable): this module records ONLY what
// actually happened in the real marketplace (a LISTED row with the
// REAL eBay ItemID, written only AFTER eBay's own AddFixedPriceItem
// response is confirmed to carry one) -- it must never be called
// before that confirmation, and a failure to persist must never be
// reported as if the eBay listing itself failed.

export const OUTCOME_LISTED_DECLINE_REASONS = Object.freeze({
  NO_AUTH_CONTEXT: 'no-auth-context',
  NO_ASSET_CONTEXT: 'no-asset-context',
  WRITE_FAILED: 'outcome-write-failed',
});

// Outcome #1 PRE-PUBLISH HARDENING — the observation/cutoff policy,
// defined and documented HERE (not invented later): api/list-ebay.js
// always lists with ListingDuration=GTC, which auto-renews roughly
// every 30 days rather than carrying a natural fixed EndTime. This is
// the fixed policy window a LISTED row's own next_observation_due_at is
// derived from, AT WRITE TIME — see db/data0/0024's own header for the
// full rationale and the "never invented after the fact" rule this
// constant exists to satisfy.
export const LISTING_OBSERVATION_WINDOW_DAYS = 30;

// attemptListedOutcome — the single entry point. Call ONLY after eBay's
// AddFixedPriceItem response has already been parsed and a real ItemID
// confirmed present; this function issues no eBay call of its own.
export async function attemptListedOutcome({
  principalId,
  gkAssetId,
  decisionEventId,
  operatorActionEventId,
  externalListingId, // the real eBay ItemID, already confirmed present by the caller
  askAmount,
  idempotencyKey,
  correlationId,
  recordOutcomeEvent, // injected: src/modules/assets/index.js's recordOutcomeEvent
} = {}) {
  if (!principalId) {
    return { attempted: false, declineReason: OUTCOME_LISTED_DECLINE_REASONS.NO_AUTH_CONTEXT };
  }
  if (!gkAssetId || !externalListingId) {
    return { attempted: false, declineReason: OUTCOME_LISTED_DECLINE_REASONS.NO_ASSET_CONTEXT };
  }

  try {
    // Three-price separation (this dispatch's own instruction): this
    // function only ever sets askAmount (the REAL price this listing
    // was sent to eBay at). It never reads or writes a predicted value
    // (that lives on valuation_event, reachable via
    // decision_event.valuation_event_id — a separate table, never
    // copied here) and never sets grossAmount/netAmount (those stay
    // NULL until a real SOLD outcome is recorded, a separate, future
    // write this function does not perform).
    const nowMs = Date.now();
    const nextObservationDueAt = new Date(nowMs + LISTING_OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const r = await recordOutcomeEvent({
      principalId,
      gkAssetId,
      decisionEventId: decisionEventId ?? null,
      operatorActionEventId: operatorActionEventId ?? null,
      outcomeType: 'LISTED',
      channel: 'ebay',
      externalListingId,
      askAmount: askAmount ?? null,
      askCurrency: 'USD',
      nextObservationDueAt,
      idempotencyKey,
      correlationId,
    });
    return { attempted: true, ok: true, outcomeEventId: r.outcomeEventId };
  } catch (e) {
    return {
      attempted: true,
      ok: false,
      declineReason: OUTCOME_LISTED_DECLINE_REASONS.WRITE_FAILED,
      error: { message: e?.message ?? String(e), code: e?.code ?? null },
    };
  }
}
