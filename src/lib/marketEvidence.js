// GK-271 — Multi-source market evidence foundation.
//
// A source-neutral vocabulary for market evidence, so every provider
// (today: PriceCharting rows, eBay active asks, PC ladder, mega-key floor,
// Vision's price guess; tomorrow: anything else) enters ONE truthful model
// and the UI copy is derived from what evidence actually exists — never
// from a hardcoded "eBay sales" assumption.
//
// PURE and presentation-side: this module reads fields the pipeline has
// already computed and custodied on a scan result. It does NOT admit,
// reject, re-price, or re-derive anything (no pricing math, no filter
// changes). "Unknown remains unknown": a field a source does not supply
// is null, never guessed.

export const EVIDENCE_CLASS = Object.freeze({
  REALIZED_SALE: 'REALIZED_SALE',               // completed transaction with price + date
  STRUCTURED_HISTORICAL: 'STRUCTURED_HISTORICAL', // historical index / guide ladder (not itself a sale)
  ACTIVE_ASK: 'ACTIVE_ASK',                     // current listing / asking price
  AUCTION_STATE: 'AUCTION_STATE',               // current bid / estimate, not a final result
  REFERENCE: 'REFERENCE',                       // curated reference (e.g. mega-key floor)
  AI_CONTEXT: 'AI_CONTEXT',                     // model knowledge — context only
});

const MARKETPLACE_TO_PROVIDER = Object.freeze({
  ebay: 'EBAY',
  heritage: 'HERITAGE',
});

const EBAY_ITEM_URL_RE = /\/itm\/(?:[^/?]*\/)?(\d{9,})/i;
const SLAB_COMPANY_RE = /\b(CGC|CBCS|PGX)\b/i;
const HRN_RE = /\bH\.?\s?R\.?\s?N\.?\s*#?\s*(\d{1,3})\b/i;

const numOrNull = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Title-text facts are TITLE-TEXT claims by a seller/aggregator row, never
// confirmed edition truth about OUR book. They describe the comp row only.
const titleFacts = (title) => {
  const t = String(title || '');
  const slab = t.match(SLAB_COMPANY_RE);
  const hrn = t.match(HRN_RE);
  return {
    gradingCompany: slab ? slab[1].toUpperCase() : null,
    rawOrSlabbed: slab ? 'SLABBED' : (t ? 'RAW_OR_UNSTATED' : null),
    country: /\bcanad(?:a|ian)\b/i.test(t) ? 'CANADA' : (/\b(?:uk|british|pence)\b/i.test(t) ? 'UK' : null),
    hrn: hrn ? hrn[1] : null,
  };
};

const blank = () => ({
  provider: null,
  sourceThrough: null,
  providerRecordId: null,
  url: null,
  evidenceClass: null,
  price: null,
  currency: 'USD',
  saleDate: null,
  grade: null,
  gradingCompany: null,
  rawOrSlabbed: null,
  edition: null,
  printing: null,
  country: null,
  hrn: null,
  variant: null,
  title: null,
  matchStanding: 'UNKNOWN',     // EXACT | SIMILAR | UNKNOWN
  admissionStanding: 'UNKNOWN', // ADMITTED | REJECTED | NOT_APPLICABLE | UNKNOWN
  rejectionReason: null,
});

// A PriceCharting completed-sales row (api/pricecharting-pop.js
// extractTabRows → {price,date,title,url,marketplace}). The row is an
// actual completed sale with a price and a date, so it is REALIZED_SALE.
// Provenance stays truthful: provider is the marketplace the row says it
// came from; sourceThrough records that PriceCharting is the aggregator.
export const normalizePcSoldRow = (row, { admitted = null, rejectionReason = null, matchStanding = 'UNKNOWN' } = {}) => {
  const r = blank();
  const mk = String(row?.marketplace || '').toLowerCase();
  r.provider = MARKETPLACE_TO_PROVIDER[mk] || 'UNATTRIBUTED';
  r.sourceThrough = 'PRICECHARTING';
  r.evidenceClass = EVIDENCE_CLASS.REALIZED_SALE;
  r.price = numOrNull(row?.price);
  r.saleDate = row?.date || null;
  r.title = row?.title || null;
  r.url = row?.url || null;
  const idMatch = r.url ? String(r.url).match(EBAY_ITEM_URL_RE) : null;
  r.providerRecordId = idMatch ? idMatch[1] : null;
  r.grade = row?.gradeKey ?? row?.grade ?? null;
  Object.assign(r, titleFacts(r.title));
  r.matchStanding = matchStanding;
  r.admissionStanding = admitted === true ? 'ADMITTED' : admitted === false ? 'REJECTED' : 'UNKNOWN';
  r.rejectionReason = rejectionReason;
  return r;
};

// An eBay Browse listing — an asking price. NEVER a realized sale, even
// when a legacy field names it "recentSales".
export const normalizeActiveAsk = (row) => {
  const r = blank();
  r.provider = 'EBAY';
  r.evidenceClass = EVIDENCE_CLASS.ACTIVE_ASK;
  r.price = numOrNull(row?.price);
  r.saleDate = null; // an ask has no sale date; row.date/endTime is listing end, not a sale
  r.title = row?.title || null;
  r.url = row?.url || row?.itemWebUrl || null;
  Object.assign(r, titleFacts(r.title));
  r.admissionStanding = 'NOT_APPLICABLE';
  return r;
};

// PriceCharting's per-grade price ladder: a guide/index. It is NOT a
// realized sale unless the underlying evidence proves it — and the row
// carries no such proof — so it is STRUCTURED_HISTORICAL.
export const normalizeLadderEntry = (gradeKey, price) => {
  const r = blank();
  r.provider = 'PRICECHARTING';
  r.evidenceClass = EVIDENCE_CLASS.STRUCTURED_HISTORICAL;
  r.price = numOrNull(price);
  r.grade = gradeKey;
  r.admissionStanding = 'NOT_APPLICABLE';
  return r;
};

export const normalizeMegaKeyReference = (result) => {
  const r = blank();
  r.provider = 'GRAILKEY_MEGA_KEY_MAP';
  r.evidenceClass = EVIDENCE_CLASS.REFERENCE;
  r.price = null; // the floor figure is a curated reference, surfaced elsewhere; not re-published as a comp
  r.admissionStanding = 'NOT_APPLICABLE';
  r.title = result?.megaKeyName || null;
  return r;
};

export const normalizeAiContext = (result) => {
  const r = blank();
  r.provider = 'VISION_MODEL';
  r.evidenceClass = EVIDENCE_CLASS.AI_CONTEXT;
  r.price = numOrNull(result?.priceLow) ?? numOrNull(result?.priceHigh);
  r.admissionStanding = 'NOT_APPLICABLE';
  return r;
};

const rowKey = (x) => `${String(x?.title || '').slice(0, 60)}|${x?.date || ''}|${numOrNull(x?.price)}`;

const num0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Build the full evidence inventory for a scan result. Every count is
// derived from a field the pipeline already produced.
export const MARKET_EVIDENCE_VERSION = 1;

// Rows kept in a payload are capped (the catalogue persists this object);
// the inventory counts always reflect the FULL pools.
const ROW_CAPS = Object.freeze({ notAdmittedSold: 20, activeAsks: 10 });

export const buildMarketEvidence = (result) => {
  const res = result || {};
  const rows = [];

  // 1. Realized sales — admitted (verified pool) vs not admitted (raw pool).
  const admitted = Array.isArray(res.soldComps) ? res.soldComps : [];
  const admittedKeys = new Set(admitted.map(rowKey));
  // Admitted rows passed the verification chain, but "exact" additionally
  // needs the edition facet not to be disputed/unverified — the same
  // custody signals deriveMarketStanding already floors on.
  const editionDisputed = ['UNVERIFIED', 'UNRESOLVED', 'CONTESTED'].includes(res.variantApplicability);
  for (const s of admitted) {
    rows.push(normalizePcSoldRow(s, { admitted: true, matchStanding: editionDisputed ? 'SIMILAR' : 'EXACT' }));
  }
  const raw = Array.isArray(res.soldCompsRaw) ? res.soldCompsRaw : [];
  // verifySoldComps keeps per-row reasons for a sample of rejected rows
  // (diagnostics.rejectedSamples, {title, price, reason}). Use them when
  // present; otherwise the reason stays honestly generic.
  const samples = Array.isArray(res.soldCompDiagnostics?.rejectedSamples) ? res.soldCompDiagnostics.rejectedSamples : [];
  const reasonByRow = new Map(samples.map((x) => [`${String(x?.title || '').slice(0, 60)}|${numOrNull(x?.price)}`, x?.reason]));
  const DIFFERENT_EDITION_REASONS = new Set(['printingMismatch', 'variantMismatch']);
  for (const s of raw) {
    if (admittedKeys.has(rowKey(s))) continue;
    const reason = s?.rejectReason || s?.rejectionReason || reasonByRow.get(`${String(s?.title || '').slice(0, 60)}|${numOrNull(s?.price)}`) || 'not-admitted-by-verification-chain';
    rows.push(normalizePcSoldRow(s, {
      admitted: false,
      rejectionReason: reason,
      matchStanding: DIFFERENT_EDITION_REASONS.has(reason) ? 'SIMILAR' : 'UNKNOWN',
    }));
  }

  // 2. Active asks. comps.recentSales is built from Browse listings
  // (comps.source 'browse_api'); only a Finding-API source would be sold.
  const compsSource = String(res.comps?.source || res.rawComps?.source || '');
  const recent = Array.isArray(res.comps?.recentSales) ? res.comps.recentSales : [];
  const rawPool = Array.isArray(res.rawComps?.prices) ? res.rawComps.prices.filter((p) => p && typeof p === 'object') : [];
  const askSource = rawPool.length > 0 ? rawPool : (/finding/i.test(compsSource) ? [] : recent);
  // The container name ("recentSales") says nothing about semantics: every
  // row from either container is an ACTIVE_ASK by construction, even when a
  // legacy field carries a date.
  const askRows = askSource.map(normalizeActiveAsk);
  rows.push(...askRows.slice(0, ROW_CAPS.activeAsks));

  // 3. Structured historical: PC ladder.
  const ladder = res.priceLadder && typeof res.priceLadder === 'object' ? res.priceLadder : {};
  for (const [g, p] of Object.entries(ladder)) rows.push(normalizeLadderEntry(g, p));

  // 4. Reference + AI context.
  const hasMegaKeyRef = res.isMegaKey === true || res.megaKeyFloorVerified != null || res.megaKeyFloorApplied === true;
  if (hasMegaKeyRef) rows.push(normalizeMegaKeyReference(res));
  const hasAiContext = !!(res.priceLow || res.priceHigh) && admitted.length === 0 && askSource.length === 0 && Object.keys(ladder).length === 0;
  if (hasAiContext) rows.push(normalizeAiContext(res));

  const dx = res.soldCompDiagnostics || {};
  const reasons = dx.reasons && typeof dx.reasons === 'object' ? dx.reasons : {};
  // Rows rejected specifically because they are a DIFFERENT printing /
  // edition / variant are the only ones that honestly count as "similar".
  const similarEditionCount = num0(reasons.printingMismatch) + num0(reasons.variantMismatch);
  const rawCount = typeof dx.rawCount === 'number' ? dx.rawCount : null;
  const verifiedCount = typeof dx.verifiedCount === 'number' ? dx.verifiedCount : admitted.length;

  const count = (cls, pred = () => true) => rows.filter((r) => r.evidenceClass === cls && pred(r)).length;
  const inventory = {
    exactRealized: count(EVIDENCE_CLASS.REALIZED_SALE, (r) => r.admissionStanding === 'ADMITTED' && r.matchStanding === 'EXACT'),
    admittedSimilarRealized: count(EVIDENCE_CLASS.REALIZED_SALE, (r) => r.admissionStanding === 'ADMITTED' && r.matchStanding === 'SIMILAR'),
    notAdmittedRealized: count(EVIDENCE_CLASS.REALIZED_SALE, (r) => r.admissionStanding === 'REJECTED'),
    similarEditionRealized: similarEditionCount,
    rawSoldCandidates: rawCount,
    verifiedSold: verifiedCount,
    newestSoldDaysAgo: typeof dx.newestDaysAgo === 'number' ? dx.newestDaysAgo : null,
    activeAsks: askRows.length,
    structuredReferences: count(EVIDENCE_CLASS.STRUCTURED_HISTORICAL),
    hasReference: count(EVIDENCE_CLASS.REFERENCE) > 0,
    hasAiContext,
    heritageThroughPriceCharting: rows.filter((r) => r.provider === 'HERITAGE' && r.sourceThrough === 'PRICECHARTING').length,
  };
  // Cap persisted rows (inventory above already reflects the full pools).
  let notAdmittedSeen = 0;
  const cappedRows = rows.filter((r) => {
    if (r.evidenceClass === EVIDENCE_CLASS.REALIZED_SALE && r.admissionStanding === 'REJECTED') {
      notAdmittedSeen += 1;
      return notAdmittedSeen <= ROW_CAPS.notAdmittedSold;
    }
    return true;
  });
  return { version: MARKET_EVIDENCE_VERSION, rows: cappedRows, inventory };
};

// Structural invariants any evidence payload must satisfy, wherever it was
// built. Returns a list of violations (empty = clean).
export const evidenceIntegrityViolations = (rows) => {
  const bad = [];
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    if (r?.evidenceClass === EVIDENCE_CLASS.REALIZED_SALE && (r.saleDate == null || r.price == null)) bad.push({ i, why: 'REALIZED_SALE requires saleDate and price' });
    if (r?.evidenceClass === EVIDENCE_CLASS.ACTIVE_ASK && r.saleDate != null) bad.push({ i, why: 'ACTIVE_ASK must not carry a saleDate' });
    if (r?.evidenceClass === EVIDENCE_CLASS.STRUCTURED_HISTORICAL && r.saleDate != null) bad.push({ i, why: 'STRUCTURED_HISTORICAL is not a sale' });
    if (r?.provider === 'HERITAGE' && r.sourceThrough == null) bad.push({ i, why: 'HERITAGE row without sourceThrough would read as a direct integration' });
  });
  return bad;
};

// The server payload is authoritative. A legacy result without it (an old
// catalogue item, a cached response) falls back to local derivation.
export const getMarketEvidence = (result) => {
  const me = result?.normalizedEvidence;
  if (me && me.version === MARKET_EVIDENCE_VERSION && Array.isArray(me.rows) && me.inventory) return me;
  return buildMarketEvidence(result);
};

const LINES = Object.freeze({
  EXACT_CURRENT: 'Recent exact-market sold evidence found.',
  EXACT_STALE: 'Exact-market sold evidence exists but is not recent.',
  SIMILAR_ONLY: 'Recent sales exist for similar printings or editions.',
  SIMILAR_DETAIL: 'No realized sale is confirmed for this exact printing.',
  NO_SOLD: 'No recent realized sales confirmed for this exact printing.',
  ACTIVE_ONLY: 'Current asking prices found; no exact realized sale confirmed.',
  STRUCTURED_ONLY: 'A structured price reference exists; no realized sale is confirmed for this exact printing.',
  AI_ONLY: 'No verified market transaction evidence found.',
});

// Copy that FOLLOWS the evidence. `standing` is the pipeline's own
// marketStanding when present (contract.actionAuthority.marketStanding);
// the inventory only ever makes the copy MORE conservative, never grants
// exactness the pipeline did not.
export const deriveMarketCopy = (result) => {
  const { inventory: inv } = getMarketEvidence(result);
  const standing = result?.contract?.actionAuthority?.marketStanding || result?.marketStanding || null;

  let state;
  if (standing === 'EXACT_CURRENT' && inv.exactRealized > 0) state = 'EXACT_CURRENT';
  else if (standing === 'EXACT_STALE' && inv.exactRealized > 0) state = 'EXACT_STALE';
  else if (inv.similarEditionRealized > 0 || inv.admittedSimilarRealized > 0 || standing === 'SIMILAR_ONLY') state = 'SIMILAR_ONLY';
  else if (inv.activeAsks > 0) state = 'ACTIVE_ONLY';
  else if (inv.structuredReferences > 0) state = 'STRUCTURED_ONLY';
  else if (inv.hasAiContext) state = 'AI_ONLY';
  else state = 'NO_SOLD';

  const headline = {
    EXACT_CURRENT: LINES.EXACT_CURRENT,
    EXACT_STALE: LINES.EXACT_STALE,
    SIMILAR_ONLY: LINES.SIMILAR_ONLY,
    ACTIVE_ONLY: LINES.ACTIVE_ONLY,
    STRUCTURED_ONLY: LINES.STRUCTURED_ONLY,
    AI_ONLY: LINES.AI_ONLY,
    NO_SOLD: LINES.NO_SOLD,
  }[state];
  const detail = state === 'SIMILAR_ONLY' ? LINES.SIMILAR_DETAIL : null;

  const footers = {
    EXACT_CURRENT: 'Estimate based on admitted recent sold-market evidence — not an appraisal or financial advice.',
    EXACT_STALE: 'Estimate based on older sold-market evidence — not an appraisal or financial advice.',
    SIMILAR_ONLY: 'Similar sold evidence exists, but exact-edition pricing is not verified — not an appraisal or financial advice.',
    ACTIVE_ONLY: 'Current asking prices are not sold prices; no recommended price is produced from asking prices alone.',
    STRUCTURED_ONLY: 'Reference figures are guides, not confirmed sales — not an appraisal or financial advice.',
    AI_ONLY: 'No recommended price is produced from AI estimates alone.',
    NO_SOLD: 'No recommended price produced from sold-market evidence.',
  };
  return {
    state,
    headline,
    detail,
    footer: footers[state],
    // AI context may be shown, but only ever labelled as AI context.
    aiRangeLabel: inv.hasAiContext ? 'AI context (unverified)' : null,
    inventory: inv,
  };
};

// App-level footer when no scan is in view: states what the numbers ARE,
// without claiming a single source.
export const NEUTRAL_MARKET_FOOTER =
  'Market figures shown on each card state their own evidence class (realized sales, price references, active asks). They are estimates — not appraisals or financial advice.';
