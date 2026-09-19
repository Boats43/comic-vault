// src/lib/ebayFulfillmentFinances.js — automatic Outcome #1 economics
// ingestion, read-only eBay REST callers.
//
// Requires a real eBay USER access token (src/lib/ebayUserOAuth.js) — the
// sell.fulfillment.readonly / sell.finances scopes are unreachable via the
// client_credentials application token api/comps.js already uses for
// Browse API. Never makes a write call to eBay. Never touches
// api/list-ebay.js's Trading API listing path.
//
// SOLD determination is NOT this module's job — scripts/observe-outcome1-
// listing.mjs already owns that (real Trading API GetItem, QuantitySold>0)
// and this module never re-derives or second-guesses it. This module only
// ever runs AFTER a real SOLD outcome_event already exists, to attach the
// real financial facts (fees/shipping/refund/credit/order linkage) that
// the Trading API's GetItem call never had access to.
//
// FABRICATION DISCIPLINE (binding for every function below): a field eBay's
// response does not contain is simply absent from the return value — never
// defaulted to 0, never inferred from a sibling field. Callers must treat
// "absent" as UNKNOWN, not as "confirmed zero."

const FULFILLMENT_BASE = 'https://api.ebay.com/sell/fulfillment/v1';
const FINANCES_BASE = 'https://api.ebay.com/sell/finances/v1';

async function ebayGet(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || res.statusText || 'unknown error';
    throw new Error(`eBay API GET ${url} failed (HTTP ${res.status}): ${msg}`);
  }
  return json;
}

/**
 * findOrderByLegacyItemId — the Fulfillment API has no documented "by
 * ItemID" filter, so this lists orders in a creation-date window (real,
 * documented `creationdate:[from..to]` filter) and searches the returned
 * orders' lineItems for a matching legacyItemId client-side. Returns the
 * real, unmodified eBay order object, or null (NOT an error) if no match
 * falls inside the given window — a real order may simply not exist yet,
 * or the window may need widening; the caller decides which.
 */
export async function findOrderByLegacyItemId({ accessToken, legacyItemId, sinceIso, untilIso, limit = 50 }) {
  const filter = `creationdate:[${sinceIso}..${untilIso}]`;
  const url = `${FULFILLMENT_BASE}/order?filter=${encodeURIComponent(filter)}&limit=${limit}`;
  const json = await ebayGet(url, accessToken);
  const orders = Array.isArray(json?.orders) ? json.orders : [];
  for (const order of orders) {
    const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
    if (lineItems.some((li) => li.legacyItemId === legacyItemId)) {
      return order;
    }
  }
  return null;
}

/** getFinancialTransactionsForOrder — real Finances API call for one real orderId. */
export async function getFinancialTransactionsForOrder({ accessToken, orderId, limit = 50 }) {
  const filter = `orderId:{${orderId}}`;
  const url = `${FINANCES_BASE}/transaction?filter=${encodeURIComponent(filter)}&limit=${limit}`;
  const json = await ebayGet(url, accessToken);
  return Array.isArray(json?.transactions) ? json.transactions : [];
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
  if ((type === 'SHIPPING_LABEL' || type === 'NON_SALE_CHARGE') && txn.amount?.value != null) {
    candidates.push({
      componentType: 'shipping',
      amount: Math.abs(parseFloat(txn.amount.value)),
      currency: txn.amount.currency || 'USD',
      subKey: 'shipping-label-amount',
      sourceReference: `eBay Finances transaction ${txn.transactionId} (${type})`,
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
