// src/lib/listingPriceBinding.js — Outcome #1: Q41 ACKNOWLEDGED PRICE MUST EQUAL THE
// OUTBOUND MARKETPLACE PRICE (exactly, in integer cents).
//
// Q41 is an EXECUTION acknowledgement only: it writes no valuation, creates no new
// economic authority, and never turns uncertain market evidence into SERVER_DERIVED
// evidence. But an acknowledgement of price X is meaningless if a different price Y can
// be sent. This module closes that boundary:
//   * toCents(): currency-safe parsing — never floating-point equality; a value with
//     more than 2 fractional digits (unless the extra digits are zero) is NOT a valid
//     USD amount and returns null (=> refusal, never silent rounding).
//   * assertQ41PriceBinding(): Q41-acknowledged cents === outgoing StartPrice cents.
//   * assertListActionPriceBinding(): the durable LIST operator action's recorded
//     approved price (operator_action_event.action_value_amount) === outgoing price, so a
//     later write cannot substitute another price. Required on the Q41 path.
// Stable refusal codes: MANUAL_PRICE_ACK_MISMATCH, LIST_ACTION_PRICE_MISMATCH,
// LIST_ACTION_PRICE_NOT_RECORDED. All fire BEFORE any eBay call.

export class PriceBindingError extends Error {
  constructor(code, message) { super(message); this.name = 'PriceBindingError'; this.code = code; }
}

// "$263.80" | "263.8" | 263.8 | "1,263.80" -> integer cents, or null if not a valid USD amount.
export function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[\s$,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null; // sub-cent precision is not a USD price
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export const formatCents = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

export function assertQ41PriceBinding({ q41Override, outgoingPrice }) {
  const ack = toCents(q41Override?.manualPrice);
  const out = toCents(outgoingPrice);
  if (ack === null || out === null || ack !== out) {
    throw new PriceBindingError(
      'MANUAL_PRICE_ACK_MISMATCH',
      `The acknowledged manual price (${ack === null ? 'invalid' : '$' + formatCents(ack)}) does not exactly equal the price being listed (${out === null ? 'invalid' : '$' + formatCents(out)}) — nothing was listed.`
    );
  }
  return { ackCents: ack, outgoingCents: out };
}

export function assertListActionPriceBinding({ actionValueAmount, outgoingPrice, requireRecorded }) {
  const out = toCents(outgoingPrice);
  const rec = toCents(actionValueAmount);
  if (actionValueAmount === null || actionValueAmount === undefined) {
    if (requireRecorded) {
      throw new PriceBindingError('LIST_ACTION_PRICE_NOT_RECORDED',
        'The durable LIST action does not record an approved price, so the list price cannot be bound to it — record the LIST action after acknowledging the price.');
    }
    return { recorded: false };
  }
  if (rec === null || out === null || rec !== out) {
    throw new PriceBindingError('LIST_ACTION_PRICE_MISMATCH',
      `The durable LIST action approved ${rec === null ? 'an invalid price' : '$' + formatCents(rec)} but the outgoing price is ${out === null ? 'invalid' : '$' + formatCents(out)} — nothing was listed.`);
  }
  return { recorded: true, cents: rec };
}
