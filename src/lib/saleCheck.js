// src/lib/saleCheck.js -- OUTCOME #1 FIRST SALE (2026-10-26). Pure, no I/O.
//
// Turns the response of POST /api/ebay-outcome-reconciler into what the operator sees and the (possibly empty) patch the
// catalogue card may take. THE RULES THIS ENCODES:
//   * Only a verified paid order (SOLD_CONFIRMED / ALREADY_SOLD_ENRICHED) may change sale state. Every other outcome
//     returns patch === null: no field of the card changes.
//   * "No paid order found" (NO_ORDER_YET) leaves the listing LISTED.
//   * A provider/lookup/search failure is a RETRYABLE verification error. It is never worded as "no order" and never
//     changes the card.
//   * An ended listing is never a sale: ALREADY_TERMINAL_UNSOLD is reported as "ended without a sale".
//   * Money is shown as an amount only when KNOWN; UNKNOWN is shown as "Unknown", never $0 (src/lib/economicsView.js).

import { buildEconomicsView } from './economicsView.js';

const ERROR_CODES = {
  EBAY_CONNECTION_REQUIRED: 'Connect your eBay account first, then try again.',
  EBAY_RECONNECT_REQUIRED: 'Your eBay connection needs to be reconnected, then try again.',
  EBAY_TEMPORARY_FAILURE: 'eBay is temporarily unavailable. Nothing was changed — try again shortly.',
};

export const VERIFY_ERROR_MESSAGE = "Couldn't verify with eBay. Nothing was changed — try again.";

/**
 * @param {number|null} httpStatus
 * @param {object|null} body
 * @param {number} [now]
 * @returns {{ kind: string, tone: 'ok'|'info'|'warn'|'error', message: string, retryable: boolean, patch: object|null, economicsView: object|null }}
 */
export function interpretSaleCheck(httpStatus, body, now = Date.now()) {
  const out = (kind, tone, message, extra = {}) => ({ kind, tone, message, retryable: false, patch: null, economicsView: null, ...extra });
  if (httpStatus === 401) return out('SIGN_IN', 'warn', 'Sign in again to check for a sale.');
  if (httpStatus === 404) return out('NOT_FOUND', 'error', 'This listing is not linked to your physical asset, so a sale cannot be checked from here.');
  if (body && typeof body.error === 'string' && ERROR_CODES[body.error]) {
    return out('VERIFY_ERROR', 'error', ERROR_CODES[body.error], { retryable: body.error === 'EBAY_TEMPORARY_FAILURE' });
  }
  if (!httpStatus || httpStatus >= 400 || !body || typeof body.status !== 'string') {
    return out('VERIFY_ERROR', 'error', VERIFY_ERROR_MESSAGE, { retryable: true });
  }

  switch (body.status) {
    case 'SOLD_CONFIRMED':
    case 'ALREADY_SOLD_ENRICHED': {
      const view = body.economicsView || (body.economics ? buildEconomicsView(body.economics) : null);
      return out('SOLD', 'ok', `Sold — verified eBay order ${body.orderId}`, {
        economicsView: view,
        patch: {
          status: 'sold',
          soldOutcomeEventId: body.outcomeEventId,
          soldOrderId: body.orderId,
          saleVerifiedAt: now,
          ...(body.soldAt ? { soldAt: body.soldAt } : {}),
          ...(view ? { economicsView: view } : {}),
        },
      });
    }
    case 'NO_ORDER_YET':
      return out('NO_PAID_ORDER', 'info', 'No paid order found');
    case 'ORDER_LOOKUP_FAILED':
    case 'ORDER_SEARCH_INCOMPLETE':
      return out('VERIFY_ERROR', 'error', VERIFY_ERROR_MESSAGE, { retryable: true });
    case 'AMBIGUOUS_NOT_SOLD':
      return out('ORDER_NOT_PAID', 'info', 'An order exists but eBay has not confirmed payment yet. Still listed — check again later.');
    case 'CANCELLED_NOT_SOLD':
      return out('CANCELLED', 'info', 'The order for this listing was cancelled. Not recorded as a sale.');
    case 'MULTIPLE_PAID_ORDERS':
      return out('REVIEW', 'warn', 'More than one paid order names this listing. Nothing was recorded — needs review.');
    case 'ALREADY_TERMINAL_UNSOLD':
      return out('ENDED_UNSOLD', 'info', 'This listing already ended without a sale.');
    case 'NO_LISTED_ROW':
      return out('NOT_FOUND', 'error', 'No recorded eBay listing exists for this asset.');
    default:
      return out('VERIFY_ERROR', 'error', VERIFY_ERROR_MESSAGE, { retryable: true });
  }
}

/** money cell: an amount only when KNOWN. */
export function formatKnownAmount(line) {
  if (!line || line.status !== 'KNOWN' || line.amount === null || line.amount === undefined) return 'Unknown';
  return `$${Number(line.amount).toFixed(2)}`;
}

/** The operator-entered postage request body (POST /api/outcome-economics). Deterministic key => entered once. */
export function buildPostageRequest({ outcomeEventId, orderId, amount, reference }) {
  const ref = String(reference ?? '').trim();
  // A blank, null or whitespace amount is NOT zero: Number('') === 0 would silently fabricate a verified $0.
  const rawAmount = amount === null || amount === undefined ? '' : String(amount).trim();
  const n = rawAmount === '' ? NaN : Number(rawAmount);
  if (!outcomeEventId) return { error: 'This sale has no recorded outcome yet.' };
  if (!ref) return { error: 'A receipt or tracking reference is required.' };
  if (!Number.isFinite(n) || n < 0) return { error: 'Enter the postage amount you actually paid (0 only if you truly paid nothing).' };
  const cents = Math.round(n * 100);
  const normRef = ref.toLowerCase().replace(/\s+/g, ' ');
  return {
    body: {
      outcomeEventId,
      componentType: 'shipping',
      amount: cents / 100,
      currency: 'USD',
      sourceReference: `Receipt: ${ref}`,
      externalOrderId: orderId || undefined,
      evidenceNote: 'Operator-entered off-eBay postage',
      idempotencyKey: `operator-postage-${outcomeEventId}-${normRef}`,
    },
  };
}
