// src/lib/q41Authority.js -- the Q41 price-acknowledgement rules, extracted VERBATIM from the inline click handlers in
// src/App.jsx (CollectionDetail) so the existing buttons AND the one-action "Approve & List" orchestrator use ONE implementation.
//
// Q41 (ruled 2026-07-12): an operator who explicitly sets and verifies their own price may list a non-READY book. Lock taxonomy:
//   * insufficiency-class locks (engine lacks data)  -> acknowledgeable WHEN the operator set a manual price (priceOverridden)
//   * integrity-class locks (book / identity / evidence suspect) -> NEVER acknowledgeable (no control exists)
//   * a lockless RESEARCH / !listable card           -> acknowledgeable ("research-not-listable")
//   * REFUSED                                        -> NEVER acknowledgeable (contract law, GK-250)
// The acknowledgement is PRICE-BOUND: a changed price invalidates it. The server (api/list-ebay.js assertQ41PriceBinding +
// assertListActionPriceBinding) re-checks the acknowledged amount against the outgoing price and the durable LIST action.
//
// Pure. No I/O. This module CREATES nothing with authority: it describes what the existing rules require and builds the exact
// payload the existing buttons built.

const PRICE_EPSILON = 0.011;

export const Q41_KIND = Object.freeze({
  NONE: 'NONE',                               // READY / listable (or no contract): no acknowledgement needed
  INSUFFICIENCY: 'INSUFFICIENCY',             // insufficiency-class locks, acknowledgeable with a manual price
  RESEARCH_NOT_LISTABLE: 'RESEARCH_NOT_LISTABLE', // lockless RESEARCH card
  BLOCKED: 'BLOCKED',                         // REFUSED or an integrity-class lock: never acknowledgeable
});

/** Is the stored acknowledgement bound to exactly this price? */
export function isQ41AckPriceValid(q41Ack, price) {
  return q41Ack != null && Math.abs((q41Ack.price ?? -1) - Number(price)) < PRICE_EPSILON;
}

/**
 * What does Q41 require for this card at this price?
 * @returns {{ kind: string, required: boolean, acknowledged: boolean, canAcknowledge: boolean, blockedReason: string|null, locks: object[], decision: string|null }}
 */
export function deriveQ41Requirement({ contract, priceOverridden, q41Ack, price }) {
  const p = Number(price) || 0;
  const locks = Array.isArray(contract?.locks) ? contract.locks : [];
  const none = { kind: Q41_KIND.NONE, required: false, acknowledged: false, canAcknowledge: false, blockedReason: null, locks, decision: null };
  if (!contract) return none;
  if (contract.state === 'REFUSED') {
    return { ...none, kind: Q41_KIND.BLOCKED, blockedReason: 'The pricing contract is REFUSED; a refusal can never be acknowledged into a listing.' };
  }
  const ackValid = isQ41AckPriceValid(q41Ack, p);
  if (locks.length > 0) {
    if (!locks.every((l) => l.class === 'insufficiency')) {
      return { ...none, kind: Q41_KIND.BLOCKED, blockedReason: `Integrity lock: ${String(locks.find((l) => l.class !== 'insufficiency')?.code || 'listing-locked')} cannot be acknowledged.` };
    }
    return { kind: Q41_KIND.INSUFFICIENCY, required: true, acknowledged: !!priceOverridden && ackValid, canAcknowledge: !!priceOverridden && p > 0, blockedReason: null, locks, decision: contract.decision?.action || null };
  }
  if (contract.listable) return none;
  return { kind: Q41_KIND.RESEARCH_NOT_LISTABLE, required: true, acknowledged: ackValid, canAcknowledge: p > 0, blockedReason: null, locks, decision: contract.decision?.action || 'REVIEW' };
}

/**
 * The acknowledgement payload, byte-identical to what the inline buttons produced.
 *   INSUFFICIENCY          -> { title, issue, state, decision, manualPrice, priceOverridden:true, lockClassAcknowledged:'insufficiency', locks:[codes] }
 *   RESEARCH_NOT_LISTABLE  -> { title, issue, state, decision, manualPrice, priceOverridden, lockClassAcknowledged:'research-not-listable', locks:[] }
 */
export function buildQ41Payload({ kind, item, price }) {
  const contract = item?.contract || null;
  if (kind === Q41_KIND.INSUFFICIENCY) {
    return {
      title: item.title,
      issue: item.issue || null,
      state: contract?.state || null,
      decision: contract?.decision?.action || null,
      manualPrice: price,
      priceOverridden: true,
      lockClassAcknowledged: 'insufficiency',
      locks: (contract?.locks || []).map((l) => l.code),
    };
  }
  if (kind === Q41_KIND.RESEARCH_NOT_LISTABLE) {
    return {
      title: item.title,
      issue: item.issue || null,
      state: contract?.state || null,
      decision: contract?.decision?.action || 'REVIEW',
      manualPrice: price,
      priceOverridden: !!item.priceOverridden,
      lockClassAcknowledged: 'research-not-listable',
      locks: [],
    };
  }
  throw new Error(`buildQ41Payload: kind ${kind} has no acknowledgement payload`);
}

/** The value stored on the item as `q41Ack`. */
export function buildQ41Ack({ price, payload, at = Date.now() }) {
  return { price, at, payload };
}

/** The `q41Override` carried on a publish request (handleList's exact construction). */
export function buildQ41Override({ item, overridePrice, displayPrice }) {
  if (!(item?.q41Ack?.payload && item.contract && !item.contract.listable)) return null;
  return { ...item.q41Ack.payload, listedPrice: overridePrice > 0 ? overridePrice : displayPrice };
}
