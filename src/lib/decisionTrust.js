// GK-277 -- the trust standing of a durable decision_event, derived ONLY from the
// authority chain it is anchored to: decision_event.valuation_event_id ->
// valuation_event.provenance (0033). Pure, no I/O.
//
// HISTORICAL EXISTENCE != TRUSTED AUTHORITY. A decision row that exists is not
// thereby a trusted recommendation: before GK-277 the capture path wrote
// client-supplied recommendations (anchored to client-asserted valuations, or to
// nothing). Those rows stay as history; they are labelled, never promoted.
//
//   SERVER_DERIVED          anchored to a SERVER_DERIVED valuation (the certified GK-180 writer)
//   OPERATOR_ANCHORED       anchored to an OPERATOR_OVERRIDE valuation (operator judgment, not engine)
//   CLIENT_ORIGIN_UNTRUSTED anchored to a CLIENT_ASSERTED / LEGACY_UNKNOWN / unrecorded valuation
//   UNANCHORED_UNTRUSTED    carries no valuation_event_id at all

export const DECISION_TRUST = Object.freeze({
  SERVER_DERIVED: 'SERVER_DERIVED',
  OPERATOR_ANCHORED: 'OPERATOR_ANCHORED',
  CLIENT_ORIGIN_UNTRUSTED: 'CLIENT_ORIGIN_UNTRUSTED',
  UNANCHORED_UNTRUSTED: 'UNANCHORED_UNTRUSTED',
});

export function decisionTrustStanding(decision, valuations) {
  if (!decision || !decision.valuation_event_id) return DECISION_TRUST.UNANCHORED_UNTRUSTED;
  const v = (Array.isArray(valuations) ? valuations : []).find((x) => x && x.id === decision.valuation_event_id);
  const prov = v?.provenance ?? null;
  if (prov === 'SERVER_DERIVED') return DECISION_TRUST.SERVER_DERIVED;
  if (prov === 'OPERATOR_OVERRIDE') return DECISION_TRUST.OPERATOR_ANCHORED;
  return DECISION_TRUST.CLIENT_ORIGIN_UNTRUSTED;
}

// Short operator-facing label for a non-trusted standing; null when trusted.
export function decisionTrustLabel(standing) {
  if (standing === DECISION_TRUST.SERVER_DERIVED) return null;
  if (standing === DECISION_TRUST.OPERATOR_ANCHORED) return 'operator-anchored, not engine';
  return 'client-origin, not authoritative';
}
