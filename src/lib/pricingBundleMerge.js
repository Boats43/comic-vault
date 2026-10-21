// src/lib/pricingBundleMerge.js -- GATE B (2026-10-20): ONE merge rule for the pricing-evidence bundle on every client site that adopts an /api/enrich result.
//
// THE DEFECT (a latent one, proven from the code): each site merged the bundle member by member with `enrich.X || cur.X`. A response that REFUSED to price (api/enrich.js
// returns priceBands null on its refusal paths) or simply omitted the field therefore kept the OLD bands/pool as if current, while the same merge advanced the contract and price
// from the new response. Stale pricing survived exactly when the system had just declared it could not establish new pricing. Fields no site merged (priceDerivationTrace,
// authoritativeRecommendation) were never replaced at all (they ride in on `...cur`).
// HONEST SCOPE: on the Production Old Man Logan #25 row (a $4.18 band, a 16-listing regular-cover pool and trace sitting beside a $15.10 contract built from six 1:25 asks) the
// runtime logs show the final 03:58:34Z pass was NOT a refusal -- it returned fresh tier-3 bands ($15.10, count 6) and a trace -- so this rule does not by itself explain that row.
// The server-side cause (regular covers priced as the variant) is fixed in src/lib/priceBands.js; why the final response's bundle did not replace the stored one is NOT established.
//
// THE RULE (three cases, never two):
//   NEW EVIDENCE PRESENT -- the response carries a band with a positive market value: priceBands, rawComps, priceDerivationTrace and authoritativeRecommendation are ALL
//     taken from the response as one bundle (a member the response lacks becomes null; it is never filled from the old row). No mixing of generations.
//   REFUSED / OMITTED (null, undefined)  -- there is no current band. The row shows none (priceBands null). Members the response did carry are taken as the current
//     generation; the previous bundle is NOT kept as current -- it is moved, whole, into `historicalPricingEvidence`, marked authoritative:false.
//   EMPTY ({} or no positive market) -- an empty bundle is not a result and is never stored as one (no fabricated empty pricing state). Handled as REFUSED, with its own status.
// Nothing reads `historicalPricingEvidence` for display, pricing, authority or listing; it exists only so evidence is not destroyed (I13: data is annotated, not vaporized).
// Pure. No I/O. `now` is injectable for tests.

export const PRICING_BUNDLE_MEMBERS = Object.freeze(['priceBands', 'rawComps', 'priceDerivationTrace', 'authoritativeRecommendation']);

const money = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** A band counts as a RESULT only when it carries a positive market value. `{}`, null, undefined and zero-valued shells do not. */
export function isPricingBandResult(bands) {
  if (!bands || typeof bands !== 'object' || Array.isArray(bands)) return false;
  const m = money(bands.market);
  return m != null && m > 0;
}

const isNonEmpty = (v) => v != null && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) && !(Array.isArray(v) && v.length === 0);
const norm = (v) => String(v ?? '').trim().toLowerCase();

export function mergePricingBundle(prior, enrich, { now = Date.now } = {}) {
  const p = prior && typeof prior === 'object' ? prior : {};
  const e = enrich && typeof enrich === 'object' ? enrich : {};

  if (isPricingBandResult(e.priceBands)) {
    return {
      priceBands: e.priceBands,
      rawComps: e.rawComps ?? null,
      priceDerivationTrace: e.priceDerivationTrace ?? null,
      authoritativeRecommendation: e.authoritativeRecommendation ?? null,
      pricingBundleStatus: 'CURRENT',
      historicalPricingEvidence: null,
    };
  }

  const emptyObject = e.priceBands != null && typeof e.priceBands === 'object' && !Array.isArray(e.priceBands) && Object.keys(e.priceBands).length === 0;
  const status = emptyObject ? 'EMPTY_REJECTED' : 'REFUSED_OR_OMITTED';
  const hadCurrent = PRICING_BUNDLE_MEMBERS.some((k) => isNonEmpty(p[k]));
  let historical = p.historicalPricingEvidence ?? null;
  if (hadCurrent) {
    const nextTitle = e.title ?? p.title;
    const nextVariant = e.variant ?? e.confirmedVariant ?? p.variant;
    historical = {
      authoritative: false,
      status: 'HISTORICAL',
      reason: emptyObject ? 'refresh-returned-empty-bands' : 'refresh-returned-no-bands',
      supersededAt: new Date(typeof now === 'function' ? now() : now).toISOString(),
      observedUnder: { title: p.title ?? null, variant: p.variant ?? null, issue: p.issue ?? null, year: p.year ?? null, publisher: p.publisher ?? null },
      identityChangedSinceObserved: norm(nextTitle) !== norm(p.title) || norm(nextVariant) !== norm(p.variant),
      priceBands: p.priceBands ?? null,
      rawComps: p.rawComps ?? null,
      priceDerivationTrace: p.priceDerivationTrace ?? null,
      authoritativeRecommendation: p.authoritativeRecommendation ?? null,
    };
  }
  return {
    priceBands: null,
    rawComps: e.rawComps ?? null,
    priceDerivationTrace: e.priceDerivationTrace ?? null,
    authoritativeRecommendation: e.authoritativeRecommendation ?? null,
    pricingBundleStatus: status,
    historicalPricingEvidence: historical,
  };
}
