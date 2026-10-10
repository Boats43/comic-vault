// GK-280A — pure decision policy for associating a server-recorded grade prediction with a collection item.
// No I/O: the collection module gathers the facts (inside one transaction, under an advisory lock on the
// event) and this function decides. Keeping it pure makes every refusal reason deterministically testable.
//
// RULES (the client-supplied item id is only a TARGET; it never proves anything):
//   R1  An event is bound to at most ONE item per principal (boundElsewhere => REFUSE CROSS_ITEM).
//   R2  A proof issued for a re-grade of a named item (targetItemId) may only be claimed for that item.
//   R3  Same item + same event again (current pointer or its history) => idempotent NOOP.
//   R4  A FRESH-SCAN proof (no targetItemId) associates only in the request that CREATES the row.
//       Claiming it into a row that already existed is refused (this is the cross-item defect).
//   R5  A RE-GRADE proof (targetItemId === id) requires the row to exist, and may move the pointer only
//       to a strictly NEWER event than the current pointer's. History is only ever appended to.
//   R6  An event-less receipt (the durable event write failed) may only seed a baseline on a newly created row.

export const GRADE_CLAIM_STATUS = Object.freeze({ ASSOCIATED: 'ASSOCIATED', ALREADY_ASSOCIATED: 'ALREADY_ASSOCIATED', REFUSED: 'REFUSED' });

export const GRADE_CLAIM_CODE = Object.freeze({
  CROSS_ITEM: 'GRADE_CLAIM_CROSS_ITEM',               // event already bound to a different item
  TARGET_MISMATCH: 'GRADE_CLAIM_TARGET_MISMATCH',     // proof names another item
  NOT_NEW_ITEM: 'GRADE_CLAIM_NOT_NEW_ITEM',           // fresh-scan proof presented for a pre-existing row
  TARGET_NOT_EXISTING: 'GRADE_CLAIM_TARGET_NOT_EXISTING',
  STALE_TRANSITION: 'GRADE_CLAIM_STALE_TRANSITION',   // re-grade proof is not newer than the current pointer
  PRINCIPAL_MISMATCH: 'GRADE_CLAIM_PRINCIPAL_MISMATCH',
  INPUT_HASH_MISMATCH: 'GRADE_CLAIM_INPUT_HASH_MISMATCH',
  EVENT_MISMATCH: 'GRADE_CLAIM_EVENT_MISMATCH',       // durable event missing / wrong surface / wrong result
  PROOF_INVALID: 'GRADE_CLAIM_PROOF_INVALID',         // signature / expiry / malformed / unavailable
  RECEIPT_INVALID: 'GRADE_CLAIM_RECEIPT_INVALID',     // legacy receipt missing / expired / foreign
});

const refuse = (code) => ({ action: 'REFUSE', status: GRADE_CLAIM_STATUS.REFUSED, code });

/**
 * @param {object} f facts
 * @param {string} f.id                    the item the request writes (a target, not proof)
 * @param {boolean} f.existedBefore        row existed before THIS request's write
 * @param {object|null} f.currentPointer   the row's current currentGradePrediction (server-owned) or null
 * @param {boolean} f.boundElsewhere       the event is already referenced by a DIFFERENT item of this principal
 * @param {object} f.claim { eventId|null, targetItemId|null, eventCreatedAtMs|null }
 */
export function decideGradeClaim({ id, existedBefore, currentPointer, boundElsewhere, claim }) {
  const eventId = claim?.eventId ?? null;
  const target = claim?.targetItemId ?? null;

  if (!eventId) {                                   // R6
    return existedBefore ? refuse(GRADE_CLAIM_CODE.NOT_NEW_ITEM) : { action: 'BASELINE_ONLY', status: GRADE_CLAIM_STATUS.ASSOCIATED, code: null };
  }
  if (boundElsewhere) return refuse(GRADE_CLAIM_CODE.CROSS_ITEM);                       // R1
  if (target && target !== id) return refuse(GRADE_CLAIM_CODE.TARGET_MISMATCH);         // R2

  const hist = Array.isArray(currentPointer?.history) ? currentPointer.history : [];
  if (currentPointer && (currentPointer.predictionEventId === eventId || hist.includes(eventId))) {
    return { action: 'NOOP', status: GRADE_CLAIM_STATUS.ALREADY_ASSOCIATED, code: null }; // R3
  }
  if (!target) {                                                                         // R4
    if (existedBefore) return refuse(GRADE_CLAIM_CODE.NOT_NEW_ITEM);
    return { action: 'ASSOCIATE', status: GRADE_CLAIM_STATUS.ASSOCIATED, code: null };
  }
  if (!existedBefore) return refuse(GRADE_CLAIM_CODE.TARGET_NOT_EXISTING);               // R5
  if (currentPointer) {
    const cur = Number(currentPointer.eventCreatedAtMs);
    const nxt = Number(claim?.eventCreatedAtMs);
    if (!Number.isFinite(nxt) || (Number.isFinite(cur) && nxt <= cur)) return refuse(GRADE_CLAIM_CODE.STALE_TRANSITION);
  }
  return { action: 'ASSOCIATE', status: GRADE_CLAIM_STATUS.ASSOCIATED, code: null };
}

export const GRADE_POINTER_HISTORY_CAP = 50;

/** Builds the next pointer value (server-owned). History only ever grows (capped), newest last. */
export function buildGradePointer({ previous, eventId, resultId, eventCreatedAtMs, via, now = Date.now() }) {
  const prevHist = Array.isArray(previous?.history) ? previous.history : [];
  const history = previous?.predictionEventId ? [...prevHist, previous.predictionEventId] : [...prevHist];
  return {
    v: 1,
    predictionEventId: eventId,
    resultId,
    eventCreatedAtMs: Number.isFinite(eventCreatedAtMs) ? eventCreatedAtMs : null,
    associatedAt: new Date(now).toISOString(),
    via,
    history: history.slice(-GRADE_POINTER_HISTORY_CAP),
  };
}
