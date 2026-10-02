// GK-273 — client-safe presentation helpers for Research the Market.
// Pure: no network, no crypto. Research evidence is NEVER presented as
// structured/provider-certified data and never alters price or authority.

// Offer the escalation when the structured pipeline did not produce exact,
// current sold evidence, or the decision is RESEARCH, or the market is thin.
export const shouldOfferResearch = (item) => {
  if (!item) return false;
  const standing = item.contract?.actionAuthority?.marketStanding || item.marketStanding || null;
  if (['NO_SOLD_EVIDENCE', 'SIMILAR_ONLY', 'FALLBACK_ONLY', 'NONE', 'EXACT_STALE'].includes(standing)) return true;
  if (item.decision?.action === 'RESEARCH') return true;
  const asks = item.comps?.count ?? 0;
  const sold = Array.isArray(item.soldComps) ? item.soldComps.length : 0;
  return sold === 0 && asks < 3;
};

const bySection = (rows, pred) => rows.filter(pred);

// Five required sections plus a separate non-final auction-state group.
export const groupResearchRows = (record) => {
  const rows = Array.isArray(record?.rows) ? record.rows : [];
  const realized = (r) => r.evidenceClass === 'REALIZED_SALE';
  return {
    confirmedRealized: bySection(rows, (r) => realized(r) && r.authorityStatus === 'CONFIRMED'),
    candidateRealized: bySection(rows, (r) => realized(r) && r.authorityStatus === 'CANDIDATE'),
    similarRealized: bySection(rows, (r) => realized(r) && r.authorityStatus === 'SIMILAR'),
    activeAsks: bySection(rows, (r) => r.evidenceClass === 'ACTIVE_ASK'),
    auctionStates: bySection(rows, (r) => r.evidenceClass === 'AUCTION_STATE'),
    references: bySection(rows, (r) => r.evidenceClass === 'REFERENCE'),
  };
};

export const SECTION_TITLES = Object.freeze({
  confirmedRealized: 'CONFIRMED REALIZED',
  candidateRealized: 'CANDIDATE REALIZED',
  similarRealized: 'SIMILAR REALIZED',
  activeAsks: 'ACTIVE ASKS',
  auctionStates: 'CURRENT AUCTION STATE (NOT FINAL)',
  references: 'REFERENCES',
});

export const AUTHORITY_LABEL = Object.freeze({
  CONFIRMED: 'Confirmed',
  CANDIDATE: 'Candidate — unverified web research',
  SIMILAR: 'Similar — different printing/edition/grade',
  REJECTED: 'Rejected',
});

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatRange = (r) => (r ? (r.low === r.high ? money(r.low) : `${money(r.low)}–${money(r.high)}`) : null);

// Deterministic conclusion from the counts — not the model's prose.
export const researchConclusion = (record) => {
  if (!record) return null;
  const c = record.counts || {};
  const parts = [];
  if (c.confirmedRealized) parts.push(`${c.confirmedRealized} confirmed realized`);
  if (c.candidateRealized) parts.push(`${c.candidateRealized} candidate realized sale${c.candidateRealized === 1 ? '' : 's'}`);
  if (c.similarRealized) parts.push(`${c.similarRealized} similar realized`);
  if (c.activeAsks) parts.push(`${c.activeAsks} active ask${c.activeAsks === 1 ? '' : 's'}`);
  if (c.auctionStates) parts.push(`${c.auctionStates} auction state${c.auctionStates === 1 ? '' : 's'}`);
  if (c.references) parts.push(`${c.references} reference${c.references === 1 ? '' : 's'}`);
  const found = parts.length ? `Found: ${parts.join(', ')}.` : 'No usable evidence found.';
  const verdict = record.sufficiency === 'SUFFICIENT'
    ? 'Candidate evidence exists; it is unverified web research, not provider-certified data.'
    : 'Evidence is insufficient to support a research range.';
  return `${found} ${verdict}`;
};

// What automated pricing authority says — read from the item, never changed.
export const describePricingAuthority = (item) => {
  const aa = item?.contract?.actionAuthority;
  return {
    state: aa?.state || item?.contract?.state || 'UNKNOWN',
    marketStanding: aa?.marketStanding || null,
    identityStanding: aa?.identityStanding || null,
    recommended: '—',
  };
};
