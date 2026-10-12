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

import { deriveMarketStanding } from './actionAuthority.js';

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

// GK-288 -- DECISION GOVERNANCE (additive; decisionTrustStanding above is unchanged).
//
// decisionTrustStanding answers "where did the anchoring valuation come from". It does NOT answer
// "is this decision currently a governed, evidence-supported authority". The real New Mutants #98
// Production row shows the gap: a LIST_NOW decision anchored to a SERVER_DERIVED valuation reads as
// fully trusted, yet it carries NO authority_snapshot (written before GK-278), empty reason codes,
// and the durable catalogue row for the same book records zero verified sold comparables, a RESEARCH
// decision, and a different price. Historical rows are never rewritten; they are LABELLED.
//
// A decision is GOVERNED only when ALL hold: engine-anchored (SERVER_DERIVED), it carries a
// recognised authority_snapshot, a LIST_* recommendation's snapshot records verified sold evidence,
// and no supplied durable-catalogue fact contradicts it. Contradictions can only DEMOTE; nothing here
// ever promotes a decision. Pure, no I/O. No pricing math; no change to the decision engine.
export const DECISION_GOVERNANCE = Object.freeze({
  GOVERNED: 'GOVERNED',
  NOT_ENGINE_ANCHORED: 'NOT_ENGINE_ANCHORED',
  LEGACY_UNSNAPSHOTTED: 'LEGACY_UNSNAPSHOTTED',
  SNAPSHOT_UNRECOGNIZED: 'SNAPSHOT_UNRECOGNIZED',
  EVIDENCE_NOT_SUPPORTING: 'EVIDENCE_NOT_SUPPORTING',
  CONTRADICTED_BY_CATALOGUE: 'CONTRADICTED_BY_CATALOGUE',
  NO_DECISION: 'NO_DECISION',
});

const centsOf = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[\s$,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * @param {object|null} decision    decision_event row (recommendation, reason_codes, authority_snapshot, valuation_event_id)
 * @param {object[]}   valuations   valuation_event rows of the same asset
 * @param {object|null} catalogue   OPTIONAL durable collection_item.attributes (server-held), used only to DEMOTE
 * @returns {{governed:boolean, standing:string, flags:string[], label:string|null}}
 */
export function decisionGovernance(decision, valuations, catalogue = null) {
  if (!decision) return { governed: false, standing: DECISION_GOVERNANCE.NO_DECISION, flags: [], label: null };
  const flags = [];
  const rec = String(decision.recommendation || '');
  const isList = /^LIST_/.test(rec);
  const trust = decisionTrustStanding(decision, valuations);
  let standing = DECISION_GOVERNANCE.GOVERNED;
  const snap = decision.authority_snapshot && typeof decision.authority_snapshot === 'object' ? decision.authority_snapshot : null;

  if (trust !== DECISION_TRUST.SERVER_DERIVED) {
    standing = DECISION_GOVERNANCE.NOT_ENGINE_ANCHORED;
    flags.push(trust);
  } else if (!snap) {
    standing = DECISION_GOVERNANCE.LEGACY_UNSNAPSHOTTED;
    flags.push('NO_AUTHORITY_SNAPSHOT');
  } else if (snap.snapshotVersion !== 'das-v1') {
    standing = DECISION_GOVERNANCE.SNAPSHOT_UNRECOGNIZED;
    flags.push('SNAPSHOT_VERSION_UNRECOGNIZED');
  } else if (isList) {
    const verified = snap.market && snap.market.soldEvidence ? snap.market.soldEvidence.verifiedCount : null;
    if (!(typeof verified === 'number' && verified > 0)) {
      standing = DECISION_GOVERNANCE.EVIDENCE_NOT_SUPPORTING;
      flags.push('NO_VERIFIED_SOLD_IN_SNAPSHOT');
    }
  }

  // Durable-catalogue contradictions: flag + demote, never promote.
  const contradictions = [];
  if (catalogue && typeof catalogue === 'object') {
    const catAction = catalogue.decision && catalogue.decision.action;
    if (catAction && rec && catAction !== rec) contradictions.push('CATALOGUE_DECISION_DISAGREES');
    const dx = catalogue.soldCompDiagnostics;
    if (isList && dx && typeof dx.verifiedCount === 'number' && dx.verifiedCount === 0) contradictions.push('NO_VERIFIED_SOLD_EVIDENCE');
    const v = (Array.isArray(valuations) ? valuations : []).find((x) => x && x.id === decision.valuation_event_id);
    const catCents = centsOf(catalogue.price);
    const valCents = v ? centsOf(v.value_amount) : null;
    if (catCents !== null && valCents !== null && catCents !== valCents) contradictions.push('PRICE_DISAGREES_WITH_VALUATION');
    const claimed = catalogue.contract && catalogue.contract.actionAuthority && catalogue.contract.actionAuthority.marketStanding;
    if (claimed === 'EXACT_CURRENT') {
      const rederived = deriveMarketStanding({ pricingSource: catalogue.pricingSource, soldCompDiagnostics: dx, variantApplicability: catalogue.variantApplicability });
      if (rederived !== 'EXACT_CURRENT') contradictions.push('STALE_CATALOGUE_STANDING');
    }
  }
  flags.push(...contradictions);
  if (contradictions.length && standing === DECISION_GOVERNANCE.GOVERNED) standing = DECISION_GOVERNANCE.CONTRADICTED_BY_CATALOGUE;

  const governed = standing === DECISION_GOVERNANCE.GOVERNED;
  const label = governed ? null
    : standing === DECISION_GOVERNANCE.LEGACY_UNSNAPSHOTTED || standing === DECISION_GOVERNANCE.CONTRADICTED_BY_CATALOGUE
      ? 'historical decision — evidence not recorded; not a current authorization'
      : 'not a governed authorization';
  return { governed, standing, flags, label };
}
