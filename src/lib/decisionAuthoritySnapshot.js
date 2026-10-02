// src/lib/decisionAuthoritySnapshot.js -- GK-278. PURE builder for
// decision_event.authority_snapshot: the minimum governed facts and authority standings
// GrailKey relied on when it made an economic decision.
//
// SERVER-CONSTRUCTED ONLY. The input is the server's own pipeline result (`out`) and the
// durable owned-item attributes; the output is an explicit whitelist projection. It never
// spreads a request body, never copies the collection row wholesale, and never accepts a
// pre-built snapshot from a caller. The exact valuation anchor stays decision_event.
// valuation_event_id -- values are NOT duplicated here.
//
// Historical decisions keep authority_snapshot = NULL (no backfill, no inference).

export const AUTHORITY_SNAPSHOT_VERSION = 'das-v1';

const nz = (v) => (v === undefined ? null : v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * @param {object} out - server pipeline result at decision time
 * @param {object} durable - durable owned collection_item attributes (server-read), may be null
 * @param {object} ctx - { buildSha, gradeAssumption, reasonCodes, decisionAction }
 */
export function buildDecisionAuthoritySnapshot(out, durable, ctx = {}) {
  const o = out && typeof out === 'object' ? out : {};
  const d = durable && typeof durable === 'object' ? durable : {};
  const idAuth = d.identityAuthority && typeof d.identityAuthority === 'object' && !Array.isArray(d.identityAuthority) ? d.identityAuthority : {};
  const sold = o.soldCompDiagnostics && typeof o.soldCompDiagnostics === 'object' ? o.soldCompDiagnostics : null;
  return {
    snapshotVersion: AUTHORITY_SNAPSHOT_VERSION,
    buildSha: nz(ctx.buildSha) && ctx.buildSha !== 'unknown' ? ctx.buildSha : null,
    identity: {
      title: nz(o.title), issue: nz(o.issue), year: nz(o.year), publisher: nz(o.publisher), variant: nz(o.variantNote),
      identityAuthority: { ...idAuth },
      issueAuthorityStatus: o.issueAuthority && typeof o.issueAuthority === 'object' ? nz(o.issueAuthority.status) : null,
    },
    grade: {
      governingGrade: nz(o.governingGrade),
      governingGradeSource: nz(o.governingGradeSource),
      gradeAuthority: nz(o.gradeAuthority),
      governingIsGraded: nz(o.governingIsGraded),
      governingGradingFormatSource: nz(o.governingGradingFormatSource),
      gradeAssumption: num(ctx.gradeAssumption),
    },
    category: {
      assetType: nz(o.assetType),
      durableCategoryAuthority: nz(ctx.durableCategoryAuthority ?? o.durableCategoryAuthority),
    },
    market: {
      pricingSource: nz(o.pricingSource),
      matchTier: o.matchConfidence && typeof o.matchConfidence === 'object' ? nz(o.matchConfidence.tier) : null,
      soldEvidence: sold ? {
        rawCount: num(sold.rawCount), verifiedCount: num(sold.verifiedCount), newestDaysAgo: num(sold.newestDaysAgo),
      } : null,
    },
    decision: {
      action: nz(ctx.decisionAction),
      reasonCodes: Array.isArray(ctx.reasonCodes) ? ctx.reasonCodes.filter((c) => typeof c === 'string') : [],
    },
    references: {
      // The server-owned link from the item to the model prediction it started from.
      modelPredictionEventId: nz(d.modelPredictedProvenance && d.modelPredictedProvenance.predictionEventId),
    },
  };
}
