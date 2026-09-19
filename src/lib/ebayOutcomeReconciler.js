// src/lib/ebayOutcomeReconciler.js — GRAILKEY AUTOMATIC EBAY OUTCOME
// RECONCILER V1. The ONE chain: GrailKey listing -> eBay ItemID ->
// Fulfillment order -> SOLD outcome_event -> Finances transactions ->
// outcome_economics_component -> realized net -> PredictionError.
//
// Reuses, never rebuilds: src/lib/ebayUserOAuth.js (User OAuth token),
// src/lib/ebayFulfillmentFinances.js (order lookup, transaction
// normalization, evaluateOrderSaleEvidence), src/modules/assets/index.js
// (recordOutcomeEvent/recordEconomicsComponent/getOutcomeEconomics/
// getOutcomeEventsForListing/getLatestValuation — the SAME writers
// api/list-ebay.js's GK-207 gate and scripts/ingest-outcome1-
// financials.mjs already use), src/lib/predictionErrorScoring.js
// (scorePrediction, pure, no I/O).
//
// SOLD EVIDENCE RULE (binding): a listing disappearing, ending, or
// becoming unavailable is NEVER sufficient evidence of SOLD. SOLD
// requires: (1) a real Fulfillment order whose line items name the
// GrailKey-linked eBay ItemID (evaluateOrderSaleEvidence's own NO_ORDER
// check plus findOrderByLegacyItemId's own client-side line-item match),
// (2) order.cancelStatus.cancelState is NOT CANCEL_REQUESTED/
// CANCEL_CLOSED, (3) order.orderPaymentStatus is PAID, PARTIALLY_REFUNDED,
// or FULLY_REFUNDED (a refund is evidence a sale occurred, not evidence
// it didn't). Any other/missing payment status is AMBIGUOUS -> no SOLD,
// unknown stays unknown, never guessed either direction.
//
// IDEMPOTENCY: every write below reuses recordOutcomeEvent's/
// recordEconomicsComponent's own class-wide GK-163 idempotency law
// (same key+same payload replays; same key+different payload throws).
// Keys here are derived from eBay's own real IDs (orderId, transactionId)
// — a repeated reconciliation run over the exact same marketplace data
// is a structural no-op, not a best-effort one.
//
// NEVER: writes a second SOLD row for a listing that already has one
// (checked before any order lookup even happens); fabricates a $0
// economics component for a field the API did not return; marks SOLD
// from a cancelled or ambiguous-payment order; treats a listing that
// already has a durable DELISTED/EXPIRED_UNSOLD row as still eligible
// for SOLD (an ended-unsold listing is never re-opened for evaluation);
// makes any eBay WRITE call (GET only, throughout).

import { findOrderByLegacyItemId, getFinancialTransactionsForOrder, normalizeTransactionToComponents, evaluateOrderSaleEvidence } from './ebayFulfillmentFinances.js';
import { recordOutcomeEvent, recordEconomicsComponent, getOutcomeEconomics, getOutcomeEventsForListing, getLatestValuation } from '../modules/assets/index.js';
import { scorePrediction } from './predictionErrorScoring.js';
import { markSold as markInventorySold, ConflictError as InventoryConflictError } from '../modules/inventory/index.js';

export const DEFAULT_LOOKBACK_DAYS = 180;
const TERMINAL_UNSOLD_TYPES = new Set(['DELISTED', 'EXPIRED_UNSOLD']);

/**
 * classifyEconomicsCompleteness — never claims certainty a refund/credit
 * cannot still arrive; only distinguishes what has actually been recorded.
 *   PENDING — zero components beyond order_reference (gross unknown)
 *   PARTIAL — gross known, fees not yet
 *   KNOWN   — gross AND fees both known (the strongest state this system
 *             claims; shipping/refund/credit may still post later)
 */
export function classifyEconomicsCompleteness(economics) {
  if (!economics?.hasAnyComponent) return 'PENDING';
  const types = new Set((economics.components || []).map((c) => c.component_type));
  if (types.has('gross') && types.has('fees')) return 'KNOWN';
  return 'PARTIAL';
}

/**
 * ingestFinancialTransactionsForOutcome — the ONE transaction-ingestion
 * loop, shared by a fresh SOLD write and by re-enrichment of an
 * already-SOLD outcome. Never writes a second 'gross' component if one
 * already exists for this outcome_event (Trading-API-sourced or a prior
 * Finances-sourced one) — a disclosed, deliberate skip, not silent data
 * loss (the original gross fact is untouched either way).
 */
export async function ingestFinancialTransactionsForOutcome({ principalId, outcomeEventId, orderId, accessToken }) {
  const before = await getOutcomeEconomics({ principalId, outcomeEventId });
  const alreadyHasGross = before.components.some((c) => c.component_type === 'gross');

  let transactions;
  try {
    transactions = await getFinancialTransactionsForOrder({ accessToken, orderId });
  } catch (e) {
    return { written: 0, skippedGross: 0, transactionsSeen: 0, error: e.message };
  }

  let written = 0;
  let skippedGross = 0;
  for (const txn of transactions) {
    for (const c of normalizeTransactionToComponents(txn)) {
      if (c.componentType === 'gross' && alreadyHasGross) { skippedGross += 1; continue; }
      await recordEconomicsComponent({
        principalId, outcomeEventId, componentType: c.componentType, amount: c.amount, currency: c.currency,
        source: 'api-sourced', sourceReference: c.sourceReference, externalOrderId: c.externalOrderId,
        idempotencyKey: c.idempotencyKey, occurredAt: c.occurredAt || undefined,
      });
      written += 1;
    }
  }
  return { written, skippedGross, transactionsSeen: transactions.length };
}

/**
 * scoreOutcomePrediction — PredictionError integration. Never called
 * unless real realized-gross evidence exists (economicsStatus !==
 * 'PENDING') — while economics are pending, this returns an explicit
 * non-score state distinct from CENSORED (which means "still listed,
 * right-censored" per predictionErrorScoring.js's own contract — a
 * confirmed-but-unsettled sale is a different fact and must not borrow
 * that label).
 */
async function scoreOutcomePrediction({ principalId, gkAssetId, listedRow, soldOccurredAt, economics, economicsStatus }) {
  if (economicsStatus === 'PENDING') {
    return { status: 'ECONOMICS_PENDING', reason: 'sale confirmed but no realized-gross economics component recorded yet — not eligible for scoring' };
  }
  const askAmount = listedRow.ask_amount != null ? Number(listedRow.ask_amount) : null;
  if (askAmount == null) {
    return { status: 'NOT_ELIGIBLE', reason: 'LISTED row carries no ask_amount — scorePrediction requires it' };
  }
  const valuation = await getLatestValuation({ principalId, gkAssetId });
  if (!valuation) {
    return { status: 'NOT_ELIGIBLE', reason: 'no valuation_event exists for this asset — original predicted value unknown' };
  }
  // economics.realizedNet is a SUM over whatever components exist, with
  // any missing component type COALESCEd to 0 by getRealizedEconomics —
  // a true net figure only once fees are ALSO known (economicsStatus
  // 'KNOWN'), never when only gross is known ('PARTIAL') — otherwise a
  // still-unknown fee would silently read as "$0 in fees," exactly the
  // fabrication this dispatch's own instruction forbids. realizedGross
  // itself is always trustworthy once economicsStatus is not 'PENDING' —
  // a real gross component exists by construction.
  const realizedNet = economicsStatus === 'KNOWN' ? economics.realizedNet : null;
  const scored = scorePrediction({
    predictedValue: valuation.valueAmount,
    askAmount,
    realizedGross: economics.gross,
    realizedNet,
    listedAt: listedRow.occurred_at,
    realizedAt: soldOccurredAt,
    isCensored: false,
  });
  return { status: scored.status, predictedValue: valuation.valueAmount, ...scored };
}

/**
 * attemptInventoryMarkSold — GRAILKEY INVENTORY AUTHORITY V1 wiring.
 * Best-effort, NEVER throws and NEVER blocks the outcome ledger itself
 * — outcome_event is the authoritative marketplace-execution record
 * regardless of whether the asset was ever enrolled in Inventory
 * Authority (an UNMANAGED asset can still have real outcome history;
 * the two systems are related, not one gated by the other). Idempotent
 * by construction (same order id -> same idempotencyKey), so calling it
 * again on every enrichment poll is always safe and self-healing if an
 * earlier attempt failed.
 *
 * SOLD CONSISTENCY CLOSEOUT: a failure here (this function returning
 * applied:false) is NOT a data-loss risk — src/lib/inventoryListingPreflight.js
 * independently consults the durable outcome_event SOLD record directly
 * (never this function's own success/failure), so a stale
 * inventory_current_state projection can never make a truly SOLD asset
 * listable again. This function's only job is to keep the PROJECTION
 * eventually consistent; it is exported so a repeated reconciler call
 * (or a dedicated repair invocation, proven in
 * tests/inventory-authority-sold-consistency.test.js) can retry it
 * idempotently until it applies.
 */
export async function attemptInventoryMarkSold({ principalId, gkAssetId, channel, orderId }) {
  try {
    const result = await markInventorySold({
      principalId, gkAssetId, reason: 'authoritative-sale', channel, externalReference: orderId,
      idempotencyKey: `inventory-authority-${orderId}-SOLD`,
    });
    return { attempted: true, applied: true, state: result.state };
  } catch (e) {
    if (e instanceof InventoryConflictError) {
      // Not enrolled (UNMANAGED) or already SOLD via some other path —
      // a real, expected, non-fatal outcome, not a bug in the ledger.
      return { attempted: true, applied: false, reason: e.message };
    }
    return { attempted: true, applied: false, reason: `unexpected error: ${e.message}` };
  }
}

/**
 * reconcileEbayOutcome — the single entry point. Never determines SOLD
 * from listing status; always from real Fulfillment order evidence.
 * Idempotent: safe to call repeatedly for the same externalListingId at
 * any point in its lifecycle.
 */
export async function reconcileEbayOutcome({ principalId, gkAssetId, externalListingId, accessToken, lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const { events } = await getOutcomeEventsForListing({ principalId, gkAssetId, externalListingId });

  const listedRow = events.find((e) => e.outcome_type === 'LISTED');
  if (!listedRow) {
    return { status: 'NO_LISTED_ROW', reason: 'no durable LISTED outcome_event exists for this listing — nothing to reconcile against' };
  }

  const soldRow = events.find((e) => e.outcome_type === 'SOLD');
  if (soldRow) {
    const economicsBefore = await getOutcomeEconomics({ principalId, outcomeEventId: soldRow.id });
    const orderId = economicsBefore.externalOrderId;
    if (!orderId) {
      // A SOLD row with no order_reference component should not happen
      // via this reconciler's own write path, but is handled safely —
      // nothing to enrich against without a real order id.
      return { status: 'ALREADY_SOLD_NO_ORDER_REFERENCE', outcomeEventId: soldRow.id };
    }
    const ingestResult = await ingestFinancialTransactionsForOutcome({ principalId, outcomeEventId: soldRow.id, orderId, accessToken });
    const economics = await getOutcomeEconomics({ principalId, outcomeEventId: soldRow.id });
    const economicsStatus = classifyEconomicsCompleteness(economics);
    const predictionError = await scoreOutcomePrediction({ principalId, gkAssetId, listedRow, soldOccurredAt: soldRow.occurred_at, economics, economicsStatus });
    const inventory = await attemptInventoryMarkSold({ principalId, gkAssetId, channel: soldRow.channel, orderId });
    return { status: 'ALREADY_SOLD_ENRICHED', outcomeEventId: soldRow.id, orderId, ...ingestResult, economicsStatus, economics, predictionError, inventory };
  }

  const terminalUnsold = events.find((e) => TERMINAL_UNSOLD_TYPES.has(e.outcome_type));
  if (terminalUnsold) {
    return { status: 'ALREADY_TERMINAL_UNSOLD', reason: `listing already has a durable ${terminalUnsold.outcome_type} row — never re-evaluated for SOLD`, outcomeType: terminalUnsold.outcome_type };
  }

  const untilDate = new Date();
  const listedAt = new Date(listedRow.occurred_at);
  const windowStart = new Date(Math.max(listedAt.getTime(), untilDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000));
  const sinceIso = windowStart.toISOString();
  const untilIso = untilDate.toISOString();

  let order;
  try {
    order = await findOrderByLegacyItemId({ accessToken, legacyItemId: externalListingId, sinceIso, untilIso });
  } catch (e) {
    return { status: 'ORDER_LOOKUP_FAILED', reason: e.message };
  }

  const evidence = evaluateOrderSaleEvidence(order);
  if (evidence.verdict === 'NO_ORDER') {
    return { status: 'NO_ORDER_YET', reason: evidence.reason, window: { sinceIso, untilIso } };
  }
  if (evidence.verdict === 'CANCELLED') {
    return { status: 'CANCELLED_NOT_SOLD', reason: evidence.reason, orderId: order.orderId };
  }
  if (evidence.verdict === 'AMBIGUOUS') {
    return { status: 'AMBIGUOUS_NOT_SOLD', reason: evidence.reason, orderId: order.orderId };
  }

  // CONFIRMED_SALE
  const occurredAt = order.creationDate ? new Date(order.creationDate) : new Date();
  // outcome_event.days_to_sale is an INT column — round, never pass a
  // float (Postgres rejects it outright; caught live by this dispatch's
  // own proof, the same latent shape exists unrounded in
  // scripts/observe-outcome1-listing.mjs, fixed there too, see its header).
  const daysToSale = Math.round((occurredAt.getTime() - listedAt.getTime()) / (24 * 60 * 60 * 1000));
  const grossFromOrder = order.pricingSummary?.total?.value != null ? parseFloat(order.pricingSummary.total.value) : null;

  const soldResult = await recordOutcomeEvent({
    principalId, gkAssetId,
    decisionEventId: listedRow.decision_event_id, operatorActionEventId: listedRow.operator_action_event_id,
    outcomeType: 'SOLD', channel: listedRow.channel, externalListingId,
    grossAmount: grossFromOrder, daysToSale,
    idempotencyKey: `outcome1-reconciler-${order.orderId}-SOLD`,
    occurredAt,
  });

  await recordEconomicsComponent({
    principalId, outcomeEventId: soldResult.outcomeEventId,
    componentType: 'order_reference', amount: null, source: 'api-sourced',
    sourceReference: `eBay Fulfillment order ${order.orderId}`, externalOrderId: order.orderId,
    idempotencyKey: `outcome1-reconciler-${order.orderId}-order-reference`,
  });

  const ingestResult = await ingestFinancialTransactionsForOutcome({ principalId, outcomeEventId: soldResult.outcomeEventId, orderId: order.orderId, accessToken });
  const economics = await getOutcomeEconomics({ principalId, outcomeEventId: soldResult.outcomeEventId });
  const economicsStatus = classifyEconomicsCompleteness(economics);
  const predictionError = await scoreOutcomePrediction({ principalId, gkAssetId, listedRow, soldOccurredAt: occurredAt, economics, economicsStatus });
  const inventory = await attemptInventoryMarkSold({ principalId, gkAssetId, channel: listedRow.channel, orderId: order.orderId });

  return {
    status: 'SOLD_CONFIRMED', outcomeEventId: soldResult.outcomeEventId, orderId: order.orderId,
    ...ingestResult, economicsStatus, economics, predictionError, inventory,
  };
}
