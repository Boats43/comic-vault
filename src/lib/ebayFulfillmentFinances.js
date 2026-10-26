// src/lib/ebayFulfillmentFinances.js — automatic Outcome #1 economics
// ingestion, read-only eBay REST callers.
//
// Requires a real eBay USER access token (src/lib/ebayUserOAuth.js) — the
// sell.fulfillment.readonly / sell.finances scopes are unreachable via the
// client_credentials application token api/comps.js already uses for
// Browse API. Never makes a write call to eBay. Never touches
// api/list-ebay.js's Trading API listing path.
//
// GRAILKEY AUTOMATIC EBAY OUTCOME RECONCILER V1 (2026-09-20) —
// evaluateOrderSaleEvidence(), below, is now the AUTHORITATIVE SOLD
// evidence rule, used by src/lib/ebayOutcomeReconciler.js. A listing
// disappearing, ending, or becoming unavailable (Trading API GetItem's
// own signal) is explicitly insufficient evidence of a real sale — SOLD
// requires a real Fulfillment order with a confirmed, non-cancelled
// payment state. This supersedes, in evidentiary strength, the older
// scripts/observe-outcome1-listing.mjs SOLD branch (GetItem
// QuantitySold>0 on a Completed listing) — that script is UNCHANGED by
// this dispatch (out of scope to modify) and its own SOLD branch remains
// live, but any new SOLD outcome should be produced by the reconciler's
// stronger order-based evidence going forward; this is a disclosed,
// known duplication of authority, not silently resolved. Both writers
// share the SAME "already has a SOLD row" idempotent short-circuit
// (checked by the reconciler before ever writing), so the two scripts
// cannot race into two SOLD rows for the same listing regardless of
// which one runs first.
//
// FABRICATION DISCIPLINE (binding for every function below): a field eBay's
// response does not contain is simply absent from the return value — never
// defaulted to 0, never inferred from a sibling field. Callers must treat
// "absent" as UNKNOWN, not as "confirmed zero."

const FULFILLMENT_BASE = 'https://api.ebay.com/sell/fulfillment/v1';
// OUTCOME #1 FIRST SALE (2026-10-26): eBay documents the Finances API on the apiz host
// (developer.ebay.com Finances API getTransactions: GET https://apiz.ebay.com/sell/finances/v1/transaction); the
// previous api.ebay.com host was never confirmed against a live call. Fulfillment stays on api.ebay.com.
export const FINANCES_BASE = 'https://apiz.ebay.com/sell/finances/v1';

// Documented paging: getOrders limit default 50, max 200, offset-based, response carries total/next; getTransactions
// limit default 20, max 1000. Every loop below is BOUNDED (page cap), de-duplicated by the provider's own ids, and stops
// on a page that adds nothing new instead of looping.
export const FULFILLMENT_PAGE_LIMIT = 200;
export const MAX_ORDER_PAGES = 25;
export const FINANCES_PAGE_LIMIT = 200;
export const MAX_TRANSACTION_PAGES = 10;

async function ebayGet(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || res.statusText || 'unknown error';
    throw new Error(`eBay API GET ${url.split('?')[0]} failed (HTTP ${res.status}): ${msg}`);
  }
  return json;
}

/**
 * searchOrdersForListing -- bounded, paginated Fulfillment order search for ONE eBay listing.
 *
 * MATCH RULE: an order qualifies as a candidate ONLY when one of its lineItems has legacyItemId EXACTLY equal to the
 * listing's ItemID. Title, SKU, price, buyer, similar comics are never consulted -- another order for the same comic
 * title is not this listing's order.
 *
 * COMPLETENESS IS EXPLICIT. `complete: true` means the provider's own paging said the window was exhausted. A failed page,
 * the page cap, or a no-progress page yields `complete: false` with a reason; the caller must NEVER read an incomplete
 * search that found nothing as "no order" (NO_ORDER_YET) -- it is a verification failure.
 *
 * @returns {{ matches: object[], complete: boolean, failed: boolean, reason: string|null, pagesFetched: number, ordersScanned: number, total: number|null }}
 */
export async function searchOrdersForListing({ accessToken, legacyItemId, sinceIso, untilIso, limit = FULFILLMENT_PAGE_LIMIT, maxPages = MAX_ORDER_PAGES } = {}) {
  const wanted = String(legacyItemId ?? '').trim();
  const out = { matches: [], complete: false, failed: false, reason: null, pagesFetched: 0, ordersScanned: 0, total: null };
  if (!wanted) return { ...out, failed: true, reason: 'no legacyItemId supplied' };
  const filter = encodeURIComponent(`creationdate:[${sinceIso}..${untilIso}]`);
  const seen = new Set();
  const matchedIds = new Set();
  let offset = 0;
  for (;;) {
    if (out.pagesFetched >= maxPages) return { ...out, reason: `page cap (${maxPages}) reached before the order window was exhausted` };
    let json;
    try {
      json = await ebayGet(`${FULFILLMENT_BASE}/order?filter=${filter}&limit=${limit}&offset=${offset}`, accessToken);
    } catch (e) {
      return { ...out, failed: true, reason: `order page ${out.pagesFetched + 1} failed: ${e.message}` };
    }
    out.pagesFetched += 1;
    const orders = Array.isArray(json?.orders) ? json.orders : [];
    const t = Number(json?.total);
    if (json?.total != null && Number.isFinite(t)) out.total = t;
    let fresh = 0;
    for (const order of orders) {
      const id = order && order.orderId;
      if (!id || seen.has(id)) continue; // an order with no id can be neither evidence nor de-duplicated
      seen.add(id); fresh += 1; out.ordersScanned += 1;
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
      if (lineItems.some((li) => String(li?.legacyItemId ?? '').trim() === wanted) && !matchedIds.has(id)) {
        matchedIds.add(id); out.matches.push(order);
      }
    }
    const exhausted = orders.length === 0
      || (out.total != null && offset + orders.length >= out.total)
      || (out.total == null && !json?.next && orders.length < limit);
    if (exhausted) return { ...out, complete: true };
    if (fresh === 0) return { ...out, reason: 'pagination made no progress (a page of already-seen orders) -- stopped instead of looping' };
    offset += orders.length; // advance by what the provider actually returned
  }
}

/**
 * findOrderByLegacyItemId -- legacy single-order wrapper (scripts/ingest-outcome1-financials.mjs). Returns the first
 * matching order or null, but THROWS when the search was incomplete and found nothing, so no caller can mistake a failed
 * search for "no order".
 */
export async function findOrderByLegacyItemId(args) {
  const r = await searchOrdersForListing(args);
  if (r.matches.length === 0 && !r.complete) throw new Error(`order search incomplete: ${r.reason}`);
  return r.matches[0] ?? null;
}

/**
 * fetchFinancialTransactionsForOrder -- bounded, paginated Finances read for one real orderId, de-duplicated by the
 * provider's transactionId. `complete:false` means the transaction list may be missing rows (economics must then stay
 * pending/incomplete, never be presented as final).
 */
export async function fetchFinancialTransactionsForOrder({ accessToken, orderId, limit = FINANCES_PAGE_LIMIT, maxPages = MAX_TRANSACTION_PAGES } = {}) {
  const out = { transactions: [], complete: false, reason: null, pagesFetched: 0 };
  const filter = encodeURIComponent(`orderId:{${orderId}}`);
  const seen = new Set();
  let offset = 0;
  for (;;) {
    if (out.pagesFetched >= maxPages) return { ...out, reason: `page cap (${maxPages}) reached before the transactions were exhausted` };
    let json;
    try {
      json = await ebayGet(`${FINANCES_BASE}/transaction?filter=${filter}&limit=${limit}&offset=${offset}`, accessToken);
    } catch (e) {
      return { ...out, reason: `transaction page ${out.pagesFetched + 1} failed: ${e.message}` };
    }
    out.pagesFetched += 1;
    const txns = Array.isArray(json?.transactions) ? json.transactions : [];
    const total = Number.isFinite(Number(json?.total)) && json?.total != null ? Number(json.total) : null;
    let fresh = 0;
    for (const txn of txns) {
      const id = txn && txn.transactionId;
      if (!id || seen.has(id)) continue;
      seen.add(id); fresh += 1; out.transactions.push(txn);
    }
    const exhausted = txns.length === 0 || (total != null && offset + txns.length >= total) || (total == null && !json?.next && txns.length < limit);
    if (exhausted) return { ...out, complete: true };
    if (fresh === 0) return { ...out, reason: 'transaction pagination made no progress -- stopped instead of looping' };
    offset += txns.length;
  }
}

/** getFinancialTransactionsForOrder -- legacy wrapper; throws when the list may be incomplete. */
export async function getFinancialTransactionsForOrder(args) {
  const r = await fetchFinancialTransactionsForOrder(args);
  if (!r.complete) throw new Error(`transactions incomplete: ${r.reason}`);
  return r.transactions;
}

/**
 * normalizeTransactionToComponents — pure, no I/O. Maps ONE real eBay
 * Finances transaction object to zero or more economics-component
 * candidates in this repo's own vocabulary (outcome_economics_component's
 * CHECK constraint: gross/fees/shipping/refund/credit/order_reference —
 * this function never emits 'order_reference', that comes from the order
 * object itself, not a transaction).
 *
 * Every candidate carries a deterministic idempotencyKey derived from
 * eBay's own transactionId plus a stable sub-key, so ingesting the same
 * transaction on a repeated poll always produces the same key —
 * recordEconomicsComponent's class-wide idempotency law (GK-163) then
 * naturally no-ops the duplicate write rather than this module needing
 * its own dedup logic.
 */
export function normalizeTransactionToComponents(txn) {
  if (!txn || !txn.transactionId) return [];
  const candidates = [];
  const type = txn.transactionType;

  if (type === 'SALE' && txn.amount?.value != null) {
    candidates.push({
      componentType: 'gross',
      amount: Math.abs(parseFloat(txn.amount.value)),
      currency: txn.amount.currency || 'USD',
      subKey: 'sale-amount',
      sourceReference: `eBay Finances transaction ${txn.transactionId} (SALE)`,
    });
  }
  if (type === 'REFUND' && txn.amount?.value != null) {
    candidates.push({
      componentType: 'refund',
      amount: Math.abs(parseFloat(txn.amount.value)),
      currency: txn.amount.currency || 'USD',
      subKey: 'refund-amount',
      sourceReference: `eBay Finances transaction ${txn.transactionId} (REFUND)`,
    });
  }
  // POSTAGE = eBay-purchased shipping LABEL transactions only. NON_SALE_CHARGE (ad/subscription-style charges not tied to
  // a sale) was previously mapped to shipping: that would have booked a non-postage charge as postage, so it is no longer.
  // A label whose bookingEntry is CREDIT is a label REFUND coming back to the seller, never a cost.
  if (type === 'SHIPPING_LABEL' && txn.amount?.value != null) {
    const isLabelRefund = txn.bookingEntry === 'CREDIT';
    candidates.push({
      componentType: isLabelRefund ? 'credit' : 'shipping',
      amount: Math.abs(parseFloat(txn.amount.value)),
      currency: txn.amount.currency || 'USD',
      subKey: isLabelRefund ? 'shipping-label-refund-credit' : 'shipping-label-amount',
      sourceReference: `eBay Finances transaction ${txn.transactionId} (SHIPPING_LABEL${isLabelRefund ? ' refund' : ''})`,
    });
  }
  if (type === 'CREDIT' && txn.amount?.value != null) {
    candidates.push({
      componentType: 'credit',
      amount: Math.abs(parseFloat(txn.amount.value)),
      currency: txn.amount.currency || 'USD',
      subKey: 'credit-amount',
      sourceReference: `eBay Finances transaction ${txn.transactionId} (CREDIT)`,
    });
  }

  // Marketplace fees — real, itemized, per orderLineItem. Only emitted
  // when the API actually returned a marketplaceFee entry; never
  // synthesized from totalFeeAmount as a fallback guess, and
  // totalFeeAmount itself is never used here for exactly that reason.
  const lineItems = Array.isArray(txn.orderLineItems) ? txn.orderLineItems : [];
  lineItems.forEach((li, liIdx) => {
    const fees = Array.isArray(li.marketplaceFee) ? li.marketplaceFee : [];
    fees.forEach((fee, feeIdx) => {
      if (fee?.amount?.value == null) return;
      candidates.push({
        componentType: 'fees',
        amount: Math.abs(parseFloat(fee.amount.value)),
        currency: fee.amount.currency || 'USD',
        subKey: `fee-li${liIdx}-${feeIdx}-${fee.feeType || 'unknown'}`,
        sourceReference: `eBay Finances transaction ${txn.transactionId}, lineItem ${liIdx}, fee ${fee.feeType || 'unknown'}`,
      });
    });
  });

  return candidates.map((c) => ({
    ...c,
    externalOrderId: txn.orderId || null,
    occurredAt: txn.transactionDate ? new Date(txn.transactionDate) : null,
    idempotencyKey: `outcome1-finances-${txn.transactionId}-${c.subKey}`,
  }));
}

// Payment states that confirm a real, executed transaction actually
// happened — including a since-refunded one (a refund is itself
// evidence a sale occurred; it is a LATER, separate economic fact, never
// evidence the sale itself didn't happen). PENDING/FAILED, or any future/
// unrecognized value, are deliberately NOT in this set — ambiguous or
// no-payment states never confirm a sale.
const CONFIRMED_SALE_PAYMENT_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED']);

/**
 * evaluateOrderSaleEvidence — pure, no I/O. The single authoritative
 * gate between "a Fulfillment order object exists" and "this GrailKey
 * listing may be marked SOLD." Real eBay Sell Fulfillment API Order
 * resource fields only (order.cancelStatus.cancelState,
 * order.orderPaymentStatus) — never inferred from lineItem/listing state.
 *
 * @returns {{ verdict: 'NO_ORDER'|'CANCELLED'|'AMBIGUOUS'|'CONFIRMED_SALE', reason: string }}
 */
export function evaluateOrderSaleEvidence(order) {
  if (!order || !order.orderId) {
    return { verdict: 'NO_ORDER', reason: 'no real Fulfillment order object supplied' };
  }
  const cancelState = order.cancelStatus?.cancelState;
  if (cancelState === 'CANCEL_REQUESTED' || cancelState === 'CANCEL_CLOSED') {
    return { verdict: 'CANCELLED', reason: `order.cancelStatus.cancelState=${cancelState}` };
  }
  const paymentStatus = order.orderPaymentStatus;
  if (!paymentStatus) {
    return { verdict: 'AMBIGUOUS', reason: 'order.orderPaymentStatus missing from the real API response — never treated as a sale' };
  }
  if (!CONFIRMED_SALE_PAYMENT_STATUSES.has(paymentStatus)) {
    // PENDING, FAILED, or any value this evaluator does not recognize.
    return { verdict: 'AMBIGUOUS', reason: `order.orderPaymentStatus="${paymentStatus}" does not confirm a legitimate sale` };
  }
  return { verdict: 'CONFIRMED_SALE', reason: `orderPaymentStatus=${paymentStatus}, cancelState=${cancelState || 'NONE_REQUESTED'}` };
}
