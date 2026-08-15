/**
 * Price Bands Engine - Ship #20b
 *
 * Verified sold-first pricing architecture.
 * Sold comps = primary anchor (when verified).
 * Active comps = fallback (when verified).
 * PC base = last resort.
 *
 * Price bands: Quick (10th), Market (50th), Stretch (90th) percentile.
 */

// GrailKey Commit Q (Q2, 2026-08-03) — reuses hasIssueNumber
// (compHygiene.js), the SAME issue-matching predicate api/comps.js's own
// Filter 0a and soldVerification.js's issue-mismatch check already apply,
// rather than a second, independently-maintained matcher. See
// buildVerifiedActivePool below for why this import exists.
import { hasIssueNumber } from './compHygiene.js';

// GK-21 / GK-34 (2026-08-07 dispatch) — shared minimum pool-size floor for
// any trust decision where one comp pool overrides or dominates the other
// (sold-overrides-active in Tier 2's activePoolSuspect guard, and
// active-overrides-sold in applyVariantFallbackDivergenceCap). Matches the
// pool-size floor already established elsewhere in this file
// (activeAnchoredOverFallbackSold and isActivePoolVariantConfirmed both
// require verifiedActive.length >= 3 / reject < 2) — this is that same
// precedent applied consistently, not new safety logic. A pool below this
// size is never trusted to override the other side outright; see both
// call sites for what happens instead when it's this thin.
const MIN_POOL_FOR_OVERRIDE = 3;

// GrailKey Dispatch 11 (2026-08-07) — canonical, exhaustive list of every
// `source` string computePriceBands()/applyVariantFallbackDivergenceCap()
// can emit. Exists specifically so tests/tier-source-map-completeness.test.js
// can assert api/enrich.js's TIER_SOURCE_MAP has an explicit entry for
// each one — three production incidents (Q109-DISPATCH-1-B, Q109-D,
// GK-34/Dispatch-10) have now hit the identical shape: a new source value
// introduced here with no corresponding entry there, silently falling
// through to a default that's eligible for a second, silent price
// multiplier. MUST be updated in the same commit as any new/renamed
// `source:` literal below — the completeness test can only be as
// trustworthy as this list is exhaustive.
export const PRICE_BANDS_SOURCES = [
  'tier1_recency_weighted',
  'tier2_active_dominant_thin_sold',
  'tier2_sold_only_active_suspect',
  'tier2_blend_70_30',
  'tier2_sold_only',
  'verified_sold_stale',
  'tier3_active_discounted_over_fallback_sold',
  'tier3_active_discounted',
  'tier4_pc_estimate',
  'variant_fallback_capped',
];

// #20b-FIX1 — tier source -> display label map. Consumed by
// api/enrich.js (`out.pricingSource = TIER_SOURCE_MAP[priceBandsRaw.source]
// || 'pc_estimate'`), which also gates variant/key multiplier eligibility
// on the resulting label (VARIANT_MULT_ELIGIBLE_SOURCES). Colocated here
// with PRICE_BANDS_SOURCES, not left in api/enrich.js, for two reasons:
// (1) this file is the single source of truth for what `source` values
// exist, so the map that must cover them lives next to the list, not in
// a separate handler file where the two can drift silently; (2)
// api/enrich.js does not cleanly exit when imported in a bare Node/test
// context, so a completeness test needs this importable from a plain lib
// file (see tests/tier-source-map-completeness.test.js).
//
// Three production incidents of the identical shape (Q109-DISPATCH-1-B,
// Q109-D, GK-34/Dispatch-10) have now hit the same root defect: a NEW
// source value introduced above with no corresponding entry here
// silently falls through to api/enrich.js's 'pc_estimate' default, which
// is VARIANT_MULT_ELIGIBLE_SOURCES-eligible — making an already-adjusted
// price eligible for a second, silent multiplier re-application. "Every
// new tier source is a live pricing hazard until it's mapped" — a
// missing-completeness-check design gap, not a one-off missed entry.
// MUST gain an entry in the SAME commit as any addition to
// PRICE_BANDS_SOURCES above — the completeness test enforces this.
export const TIER_SOURCE_MAP = {
  'tier1_recency_weighted': 'verified_sold_recency',
  'tier2_blend_70_30': 'sold_active_blend_30',
  'tier2_sold_only': 'verified_sold',
  'verified_sold_stale': 'verified_sold_stale',  // Q71: tier-2.5 stale-sold source
  'tier3_active_discounted': 'active_ask_derived',
  // Q109-DISPATCH-1-B (2026-07-16): missing this entry silently fell
  // through to the 'pc_estimate' default — which is IN
  // VARIANT_MULT_ELIGIBLE_SOURCES, so a Tier-3 active-anchored price
  // (already variant-confirmed by construction) got re-multiplied by
  // the newsstand era multiplier as if it were an unverified PC
  // estimate, double-counting the premium (ASM #300: correct $856.51
  // silently overwritten to $513.91). Mirrors its sibling exactly —
  // same reasoning as verified_sold's exclusion above: the pool
  // backing this source is already variant-restricted, so the
  // era-multiplier must not run again on top of it.
  'tier3_active_discounted_over_fallback_sold': 'active_ask_derived',
  // Q109-D [2026-07-17]: same fallthrough class as the entry above —
  // applyVariantFallbackDivergenceCap() (this file) produces this
  // source when it caps an inflated variant-fallback sold price back
  // down to the trustworthy, variant-CORRECT active anchor. Missing
  // here, it fell through to 'pc_estimate' (eligible) and risked the
  // same double-count re-multiply on an already-capped, already
  // active-anchored price. Mapped to its semantic sibling
  // 'active_ask_derived' — active-anchored by construction, not
  // eligible for the era/variant multiplier.
  'variant_fallback_capped': 'active_ask_derived',
  'tier4_pc_estimate': 'pc_estimate',
  // Legacy sources (pre-tier, never actually emitted by this file's
  // computePriceBands — kept for any caller still passing them through
  // directly, not covered by the PRICE_BANDS_SOURCES completeness list).
  // GrailKey Dispatch 13 — 'verified_active' removed from this legacy
  // set: confirmed dead everywhere in api/enrich.js's own multiplier-
  // eligibility gates (never assigned to out.pricingSource, not in
  // PRICE_BANDS_SOURCES) — keeping a pass-through entry for a value that
  // can never arrive as input serves no purpose and is the same landmine
  // shape as the gate references it was removed from alongside.
  'verified_sold': 'verified_sold',
  'verified_sold_active_blend': 'verified_sold_active_blend',
  // Q109-D [2026-07-17]: same fallthrough class — the ASM #17-class
  // franchise-relaunch guard (this file) excludes a contaminated
  // active pool and prices sold-only, tagging this source. Missing
  // here, it also fell through to the eligible 'pc_estimate' default.
  // Mapped to its semantic sibling 'tier2_sold_only' -> 'verified_sold'
  // (already sold-verified via the Ship 18 strict variant filter —
  // explicitly excluded from the multiplier-eligible set above).
  'tier2_sold_only_active_suspect': 'verified_sold',
  // GK-34 (2026-08-07, GrailKey Dispatch 10) — same fallthrough class
  // as the two entries above, confirmed live in production before this
  // fix landed: missing this entry silently fell through to the
  // 'pc_estimate' default, which is IN VARIANT_MULT_ELIGIBLE_SOURCES,
  // risking the identical double-count re-multiply this exact map
  // exists to prevent (ASM #300 / Q109-D history above) on a price
  // that's already active-anchored and ×0.85-discounted by this file's
  // tier2_active_dominant_thin_sold branch. Also an I13 provenance
  // violation independent of the multiplier risk: the card displayed
  // "pc_estimate" for a price that was never a PriceCharting estimate
  // at all. Mapped to its semantic sibling 'active_ask_derived' — same
  // construction as tier3_active_discounted (active pool anchor,
  // ask-derived, already discounted).
  'tier2_active_dominant_thin_sold': 'active_ask_derived',
};

/**
 * Calculate percentile from sorted array of numbers.
 * @param {number[]} sortedValues - array sorted ascending
 * @param {number} percentile - 0-100
 *
 * For small datasets, uses nearest-rank method (returns actual value from array).
 * 10th percentile = lowest value, 50th = median, 90th = highest value.
 */
export function percentile(sortedValues, percentile) {
  if (!sortedValues || sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  if (sortedValues.length === 2) {
    if (percentile <= 50) return sortedValues[0];
    return sortedValues[1];
  }

  // Nearest-rank method for small datasets
  if (sortedValues.length <= 10) {
    if (percentile <= 10) return sortedValues[0];
    if (percentile >= 90) return sortedValues[sortedValues.length - 1];
    if (percentile === 50) {
      const mid = Math.floor(sortedValues.length / 2);
      if (sortedValues.length % 2 === 0) {
        return (sortedValues[mid - 1] + sortedValues[mid]) / 2;
      }
      return sortedValues[mid];
    }
  }

  // Linear interpolation for larger datasets
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Apply recency weighting to a price based on days since sale.
 * <90 days = 1.0x, 90-180 = 0.85x, >180 = 0.70x
 */
export function applyRecencyWeight(price, daysAgo) {
  if (daysAgo == null || daysAgo < 90) return price;
  if (daysAgo < 180) return price * 0.85;
  return price * 0.70;
}

/**
 * Check if comp title matches expected title (normalized comparison).
 */
export function titleMatch(compTitle, expectedTitle) {
  if (!compTitle || !expectedTitle) return false;

  const normalize = (s) => String(s)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const comp = normalize(compTitle);
  const expected = normalize(expectedTitle);

  // Exact match
  if (comp === expected) return true;

  // Substring match (handles "Amazing Spider-Man" vs "The Amazing Spider-Man")
  if (comp.includes(expected) || expected.includes(comp)) {
    const diff = Math.abs(comp.length - expected.length);
    // Allow small prefix/suffix difference (like "The" or "Comics")
    return diff <= 15;
  }

  return false;
}

/**
 * Check if comp has matching issue number.
 * Handles "#123", "123", "No. 123" formats.
 */
export function issueMatch(compTitle, expectedIssue) {
  if (!compTitle || expectedIssue == null) return false;

  const issueStr = String(expectedIssue).trim();
  if (!issueStr) return false;

  // Match patterns: "#123", " 123 ", "No. 123", "Issue 123"
  const patterns = [
    new RegExp(`#${issueStr}\\b`, 'i'),
    new RegExp(`\\bNo\\.?\\s*${issueStr}\\b`, 'i'),
    new RegExp(`\\bIssue\\s*${issueStr}\\b`, 'i'),
    new RegExp(`\\s${issueStr}\\s`, 'i'),
    new RegExp(`^${issueStr}\\s`, 'i'),
    new RegExp(`\\s${issueStr}$`, 'i'),
  ];

  return patterns.some(p => p.test(compTitle));
}

/**
 * Check if comp variant matches expected variant.
 * Handles newsstand, price variants, etc.
 *
 * Returns true if comp matches expected variant.
 * Returns false if comp has a DIFFERENT variant than expected.
 */
export function variantMatch(compTitle, expectedVariant) {
  // If no variant expected, accept any comp (no contamination)
  if (!expectedVariant) return true;

  if (!compTitle) return false;

  const normalize = (s) => String(s).toLowerCase().trim();
  const comp = normalize(compTitle);
  const expected = normalize(expectedVariant);

  // Exact substring match
  if (comp.includes(expected)) return true;

  // Check for variant markers - if comp has any variant marker that
  // doesn't match expected, reject it
  const variantMarkers = [
    'newsstand', 'price variant', '30 cent', '30¢', '35 cent', '35¢',
    'whitman', 'pence', 'canadian', 'mark jewelers', 'type 1a', 'type 1b',
    'jtc', 'virgin', 'sketch', 'exclusive', 'convention', '1:25', '1:50',
    '1:100', 'variant', 'cover a', 'cover b', 'cover c', 'cover d'
  ];

  // If comp has any variant marker, it must match expected
  for (const marker of variantMarkers) {
    if (comp.includes(marker)) {
      // Comp has a variant marker - check if it matches expected
      if (!expected.includes(marker) && !comp.includes(expected)) {
        return false; // Different variant
      }
    }
  }

  return true;
}

/**
 * Build verified sold pool with exact-match filtering.
 * Returns array of verified sold comps with prices.
 *
 * GrailKey Dispatch 28 (2026-08-08) — `variant` (and `title`/`issue`, for
 * that matter) is destructured but never read anywhere in this function
 * body — confirmed by direct read while auditing every consumer of
 * computePriceBands' own `variant` parameter (the exact-match filtering
 * this comment describes already happened upstream, Trust Layer 10,
 * verifySoldComps in soldVerification.js — see the Ship 1.6 comment on
 * the return statement below). A dead parameter, not a bug — noted here
 * so a future reader doesn't assume passing a wrong or stale `variant`
 * here has any effect; it doesn't, for this function specifically.
 */
export function buildVerifiedSoldPool(soldComps, { title, issue, variant }) {
  if (!soldComps || soldComps.length === 0) return [];

  // Ship 1.6 — Trust Layer 10 sold-verify (verifySoldComps in
  // api/enrich.js). Comps reaching this function have already been
  // verified for title/issue/variant/grade match. Re-running stricter
  // regex matchers here was rejecting valid Layer-10 comps and forcing
  // price to fall through to pc_estimate.
  //
  // B&B #28 polybag scan: 16/30 verified at Layer 10, 0 surviving here
  // → source=pc_estimate instead of verified_sold.
  return soldComps.filter(s => {
    if (!s.title || s.price == null) return false;
    const priceNum = typeof s.price === 'number'
      ? s.price
      : parseFloat(String(s.price).replace(/[$,]/g, ''));
    if (!Number.isFinite(priceNum) || priceNum <= 0) return false;
    return true;
  });
}

/**
 * Build verified active pool with exact-match filtering.
 * Returns array of verified active comp prices.
 *
 * Q75 — Era/variant verification for tier-3/tier-4 active pool:
 * Prevents modern variant asks (1:100 sketch, timeless, etc.) from
 * contaminating vintage/standard edition pricing.
 */
export function buildVerifiedActivePool(comps, { title, issue, year, variant }) {
  if (!comps || !comps.prices || comps.prices.length === 0) {
    return [];
  }

  // Q53-FIX: Evidence-locked from Howard #11 trace. Rows are OBJECTS
  // {price, title, url}, not bare numbers. Predicate `p > 0` on object = false
  // → 100% rejection. Extract price from object OR use number directly.
  // Add title-overlap + lot-exclusion for object rows.
  const titleLower = String(title || '').toLowerCase();
  const lotRe = /\b(lot|bundle|complete set|full run|comic library|comic collection)\b/i;

  // Q75 era/variant filters
  const confirmedYear = year ? parseInt(year, 10) : null;
  const scanIsVariant = variant && variant.trim().length > 0;
  const VARIANT_CONTAM_ACTIVE = /\b(1:25|1:50|1:100|1:500|incentive|sketch|virgin|timeless|ratio|exclusive|convention|sdcc|nycc)\b/i;
  const YEAR_TOKEN_RE = /\b(19\d{2}|20\d{2})\b/;

  const filtered = comps.prices.filter(p => {
    // Extract price (handle both number and object)
    const price = typeof p === 'number' ? p : p?.price;
    if (!price || price <= 0) return false;

    // For object rows: verify title overlap + exclude lots + Q75 era/variant
    if (typeof p === 'object' && p.title) {
      const t = String(p.title).toLowerCase();

      // Exclude lot/bundle listings
      if (lotRe.test(t)) return false;

      // Require title overlap (our title substring in listing)
      if (titleLower && !t.includes(titleLower)) {
        // Fallback: check if ≥50% of our words appear
        const ourWords = titleLower.split(/\s+/).filter(w => w.length >= 3);
        const matchCount = ourWords.filter(w => t.includes(w)).length;
        if (ourWords.length === 0 || matchCount / ourWords.length < 0.5) {
          return false;
        }
      }

      // GrailKey Commit Q (Q2, 2026-08-03) — issue-number enforcement.
      // Reuses hasIssueNumber (compHygiene.js) — the SAME predicate
      // api/comps.js's own Filter 0a and soldVerification.js's issue-
      // mismatch check already apply — rather than a second,
      // independently-maintained matcher. Without this, the title-overlap
      // check above is the ONLY gate on series identity: "absolute batman
      // #2 (2024)".includes("absolute batman") is true, so every issue of
      // an ongoing series sharing a stable title (Absolute Batman #2
      // through #15, plus two hardcovers) passed straight into a #1's
      // priced pool — confirmed live, GrailKey full-pipeline audit
      // 2026-08-03 ("filtered 41/41 active comps" removed nothing because
      // there was no issue check to remove anything on). hasIssueNumber
      // itself returns true unconditionally when issue is falsy (books,
      // or a genuinely unresolved issue number) — no separate book/asset
      // guard needed here, matches its own existing convention.
      if (issue && !hasIssueNumber(String(p.title || ''), issue, title)) {
        console.log(`[Q53-buildActive] active rejected: "${p.title?.slice(0, 60)}" reason=issue (want #${issue})`);
        return false;
      }

      // Q75-1: Year token filter (era contamination)
      if (confirmedYear) {
        const yearMatch = t.match(YEAR_TOKEN_RE);
        if (yearMatch) {
          const listingYear = parseInt(yearMatch[0], 10);
          const yearDrift = Math.abs(listingYear - confirmedYear);
          if (yearDrift > 5) {
            console.log(`[Q75] active rejected: "${p.title?.slice(0, 60)}" reason=era (${listingYear} vs ${confirmedYear})`);
            return false;
          }
        }
      }

      // Q75-2: Variant contamination filter
      if (!scanIsVariant && VARIANT_CONTAM_ACTIVE.test(t)) {
        console.log(`[Q75] active rejected: "${p.title?.slice(0, 60)}" reason=variant`);
        return false;
      }
    }

    return true;
  });

  console.log(`[Q53-buildActive] filtered ${filtered.length}/${comps.prices.length} active comps`);
  return filtered;
}

/**
 * Q109-DISPATCH-1-B (2026-07-16, ASM #300 newsstand) — is the ACTIVE pool
 * genuinely variant-matched, not just "whatever survived because nothing
 * matched"? api/comps.js Filter 1c narrows the raw active pool down to
 * listings whose title contains our variant's meaningful words when ≥2
 * match, but falls back to keeping everything when fewer than 2 match — it
 * doesn't stamp that outcome onto the pool it returns, so by the time the
 * pool reaches computePriceBands there's no signal left distinguishing
 * "confirmed" from "fell back to unfiltered." This re-derives the same
 * check locally: same word-extraction rule Filter 1c uses, same 0.7
 * distinguishing ratio Fix A uses for artist consensus (this session's
 * general threshold for "most of the pool agrees" vs "coincidence") —
 * requires a minimum of 2 explicit matches (ratio alone is meaningless on
 * tiny pools, same reasoning as Fix A's MIN_POOL_FOR_RATIO_GATE) AND that
 * matches cover at least 70% of the pool (a handful of matches inside an
 * otherwise-unfiltered large pool isn't confirmation, it's coincidence).
 */
function isActivePoolVariantConfirmed(verifiedActive, variant) {
  if (!variant || !Array.isArray(verifiedActive) || verifiedActive.length < 2) return false;
  const varWords = String(variant).toLowerCase().split(/\s+/)
    .filter(w => w.length > 3 && !['variant', 'cover', 'print', 'edition'].includes(w));
  if (varWords.length === 0) return false;
  const matching = verifiedActive.filter(v => {
    const t = String(typeof v === 'object' ? (v?.title || '') : '').toLowerCase();
    return varWords.some(w => t.includes(w));
  });
  return matching.length >= 2 && (matching.length / verifiedActive.length) >= 0.7;
}

/**
 * Calculate price bands from verified comp pool.
 * Returns { quick, market, stretch, source, count, recencyDays }
 */
export function calculatePriceBands(verifiedPool, source, recencyData = null) {
  if (!verifiedPool || verifiedPool.length < 2) {
    return null;
  }

  // Extract prices and apply recency weighting if available
  let prices;
  if (recencyData && Array.isArray(recencyData)) {
    prices = verifiedPool.map((p, i) => {
      const daysAgo = recencyData[i]?.daysAgo;
      return applyRecencyWeight(p, daysAgo);
    });
  } else {
    prices = verifiedPool.map(p => typeof p === 'object' ? p.price : p);
  }

  // Sort ascending
  prices.sort((a, b) => a - b);

  // Calculate percentiles
  const quick = percentile(prices, 10);
  const market = percentile(prices, 50);
  const stretch = percentile(prices, 90);

  // Calculate most recent sale
  let recencyDays = null;
  if (recencyData && Array.isArray(recencyData) && recencyData.length > 0) {
    const validDays = recencyData.map(r => r?.daysAgo).filter(d => d != null);
    if (validDays.length > 0) {
      recencyDays = Math.min(...validDays);
    }
  }

  return {
    quick: Math.round(quick * 100) / 100,
    market: Math.round(market * 100) / 100,
    stretch: Math.round(stretch * 100) / 100,
    source,
    count: prices.length,
    recencyDays
  };
}

/**
 * D2 (Commit D2) — shared structured derivation trace. One builder, used
 * identically by every tier branch below (1, 2, 2.5, 3, 4) — no per-tier
 * display logic. Each operation: {step, inputValue, operation, factor,
 * outputValue, applied, source}. Reference values (PriceCharting raw /
 * grade multiplier) are recorded separately and never enter `operations`
 * unless they actually controlled the final price (only Tier 4 does) —
 * closes the "pcBase: 150 multiplier: 0.65 afterMult: 205.04" defect
 * (150×0.65=97.50, not 205.04 — afterMult was actually a snapshot of the
 * tier-1 recency-weighted result, an unrelated calculation, mislabeled as
 * if it were pcBase's product).
 */
const roundCurrency = (n) => Math.round(n * 100) / 100;

function buildTraceStep(step, inputValue, operation, factor, outputValue, applied, source) {
  return { step, inputValue, operation, factor, outputValue, applied, source };
}

function buildDerivationTrace(pricingSource, referenceValues, operations, finalPrice) {
  return { pricingSource, referenceValues, operations, finalPrice };
}

/**
 * Detect contaminated active listings.
 * Active contaminated when soldMedian > activeMedian × 3
 */
export function isActiveContaminated(soldMedian, activeMedian) {
  if (!soldMedian || !activeMedian) return false;
  return soldMedian > activeMedian * 3;
}

/**
 * Apply grade multiplier to price bands.
 */
export function applyGradeMultiplierToBands(bands, gradeMultiplier) {
  if (!bands || !gradeMultiplier) return bands;

  return {
    ...bands,
    quick: Math.round(bands.quick * gradeMultiplier * 100) / 100,
    market: Math.round(bands.market * gradeMultiplier * 100) / 100,
    stretch: Math.round(bands.stretch * gradeMultiplier * 100) / 100,
  };
}

/**
 * EX-A (Q109 greenlight) — I9-style divergence cap for variant-fallback
 * sold pools. contract-validator's I9 invariant (src/lib/responseContract.js)
 * already rejects a shipped price >100% over its own pool avg for LIST_NOW/
 * LIST_LOW actions — but only AFTER the full response is assembled, so the
 * card still displayed the inflated recommended price with only the List
 * button locked (Spider-Versity #1: $19.34 rec vs $5.67 real pool avg).
 *
 * This applies the same threshold (price > poolAvg × 2) here, before the
 * price ever reaches the response, using the variant-CORRECT active pool
 * as the trustworthy anchor (the sold pool is the untrusted side — it's
 * only reachable when `variantAdjusted` is true, i.e. every sold row was
 * re-admitted by the soldVerification.js variant fallback). No-ops when
 * the sold pool wasn't fallback-derived, or when there's no active pool
 * to validate against.
 */
function applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted, soldPoolSize = null) {
  if (!result || !variantAdjusted) return result;

  const activePrices = (verifiedActive || [])
    .map(v => (typeof v === 'number' ? v : v?.price))
    .filter(p => p > 0);
  // GK-21 (2026-08-07 dispatch) — a pool this thin is not a trustworthy
  // override anchor either. Was `=== 0` ("not empty" was sufficient for a
  // single active listing to overwrite a much larger sold-derived result);
  // now requires the same MIN_POOL_FOR_OVERRIDE floor GK-34 applies on the
  // mirror-image side of this exact trust decision (Tier 2's
  // activePoolSuspect guard, computePriceBands below) — same defect,
  // same fix, applied consistently rather than invented twice.
  if (activePrices.length < MIN_POOL_FOR_OVERRIDE) return result; // no trustworthy anchor to check against

  const activeAvg = activePrices.reduce((a, b) => a + b, 0) / activePrices.length;
  if (!(activeAvg > 0) || !(result.market > activeAvg * 2)) return result;

  console.log(`[variant-fallback-cap] market $${result.market.toFixed(2)} > activeAvg×2 ($${(activeAvg * 2).toFixed(2)}) — capping to active-anchored price (I9-style)`);

  // Dispatch 06 follow-up (2026-08-07) — n=3 clears MIN_POOL_FOR_OVERRIDE
  // but can still be a poor ratio against a much larger overridden pool
  // (3 actives overriding 28 solds is directionally better than the prior
  // n=1 case, not obviously correct on its own). Log without blocking the
  // override, so production can show whether n=3 is actually sufficient.
  if (soldPoolSize != null && activePrices.length < soldPoolSize / 3) {
    console.log(`[pool-ratio-warn] GK-21 override fired with pool ratio worse than 1:3 — activePool=${activePrices.length} overriding soldPool=${soldPoolSize} (ratio 1:${(soldPoolSize / activePrices.length).toFixed(1)})`);
  }

  const cappedMarket = roundCurrency(activeAvg);
  // D2 — this cap overrides whatever the tier's own trace concluded with;
  // append a step so the trace's finalOperation.outputValue still equals
  // the ACTUAL finalPrice, rather than going stale against a market value
  // that no longer matches.
  const priorTrace = result.derivationTrace;
  const cappedTrace = priorTrace
    ? buildDerivationTrace(
        'variant_fallback_capped',
        priorTrace.referenceValues,
        [
          ...priorTrace.operations,
          buildTraceStep('variant_fallback_cap', priorTrace.finalPrice, 'cap', null, cappedMarket, true, 'eligible_active'),
        ],
        cappedMarket
      )
    : undefined;

  return {
    ...result,
    quick: Math.round(Math.min(result.quick, activeAvg * 0.85) * 100) / 100,
    market: cappedMarket,
    stretch: Math.round(activeAvg * 1.15 * 100) / 100,
    source: 'variant_fallback_capped',
    tier: Math.max(result.tier, 3),
    variantFallbackCapped: true,
    variantFallbackCapReason: `sold-fallback market $${result.market.toFixed(2)} exceeded active-avg×2 ($${(activeAvg * 2).toFixed(2)})`,
    // GrailKey Directive AH (GK-111) — the cap REPLACES market with
    // activeAvg entirely (an already MIN_POOL_FOR_OVERRIDE-gated active
    // anchor); the fallback-sourced sold average no longer feeds the
    // returned price at all, so any soldPoolFallbackConsumed the pre-cap
    // `result` carried is stale and must be overridden false here, not
    // inherited via the ...result spread above.
    soldPoolFallbackConsumed: false,
    ...(cappedTrace && { derivationTrace: cappedTrace }),
  };
}

/**
 * Main price bands engine — Ship #20b Tier Architecture.
 *
 * TIER 1 (soldCount ≥5 fresh): recency-weighted sold avg
 *   - fresh (≤30d) ×1.0, recent (31-90d) ×0.6, stale (>90d) ×0.25
 *   - Actives = SANITY CEILING only (if soldAvg > activeLow → warn)
 *
 * TIER 2 (soldCount 1-4 fresh): 70/30 blend
 *   - (soldAvg × 0.7) + (activeAvg × 0.3)
 *   - Active weight capped at 30%
 *
 * TIER 3 (soldCount=0, activeCount≥3): activeAvg × 0.85
 *   - 15% discount (asks > realized prices)
 *   - Decision cap: LIST_LOW, warning "ask-derived"
 *
 * TIER 4 (no market data): pc_estimate
 *
 * FLOORS: Tier 0 liability + verified-sold low ONLY (never asks)
 */
export function computePriceBands({
  soldComps,
  activeComps,
  pcBase,
  gradeMultiplier = 1,
  title,
  issue,
  year,
  variant,
  variantAdjusted = false,
  soldVerifyResult = null,
}) {
  // Build verified pools
  const verifiedSolds = buildVerifiedSoldPool(soldComps, { title, issue, variant });
  const soldPrices = verifiedSolds.map(s => s.price);
  // Q75: Pass year + variant to active pool builder for era/variant filtering
  const verifiedActive = buildVerifiedActivePool(activeComps, { title, issue, year, variant });

  // Extract recency band counts from LIVE soldVerifyResult.
  // EX-A (Q109 greenlight): rows re-admitted by the soldVerification.js
  // variant fallback (variantVerified === false — wrong-variant sales kept
  // only because variantMismatch rejected 100% of the real pool) are
  // excluded from fresh/recent tier-threshold counting. A pool built
  // entirely from wrong-variant sales must not earn Tier-1 confidence.
  let freshCount = 0;
  let recentCount = 0;
  let staleCount = 0;
  let variantFallbackRowCount = 0;

  if (soldVerifyResult?.verified && Array.isArray(soldVerifyResult.verified)) {
    soldVerifyResult.verified.forEach(s => {
      if (s.variantVerified === false) {
        variantFallbackRowCount++;
        return; // excluded from tier-threshold math
      }
      const band = s.recencyBand;
      if (band === 'fresh') freshCount++;
      else if (band === 'recent') recentCount++;
      else if (band === 'stale') staleCount++;
    });
  }

  const soldPoolIsAllVariantFallback =
    soldVerifyResult?.verified?.length > 0 &&
    variantFallbackRowCount === soldVerifyResult.verified.length;

  // TIER SELECTION
  // Q64: Added tier 2.5 — soldPool ≥5 all-stale → staleAvg×0.85, LIST_LOW cap
  // Q69 FIX 1: Broadened condition from 100%-stale to soldPool≥5 AND fresh=0
  // (recent-only pools still get tier-2.5 treatment — sold data outranks active asks)
  let tier = 4; // default: no data
  let activeAnchoredOverFallbackSold = false;
  if (soldPoolIsAllVariantFallback) {
    // Q109-DISPATCH-1-B (2026-07-16, ASM #300 newsstand): sold is 100%
    // edition-ambiguous fallback (readmitted only because the real variant
    // filters rejected every sold comp) — blending it against a CONFIRMED
    // variant-matched active pool risks landing on a number that's wrong
    // for both real markets at once (a $540 blend when confirmed-newsstand
    // actives run $599-1,599 and the edition-unverified solds run
    // $227-521 — plausible-looking, anchored to neither). When the active
    // pool is itself confirmed (not also a fallback/unfiltered pool) and
    // large enough to trust (≥3, matching Tier 3's existing floor), the
    // active pool is the only side with verified identity — anchor to it
    // (Tier 3) instead of blending. Does NOT fire when active is ALSO
    // ambiguous (both sides unverified — current blend is the best
    // available signal and is unchanged below).
    if (verifiedActive.length >= 3 && isActivePoolVariantConfirmed(verifiedActive, variant)) {
      tier = 3;
      activeAnchoredOverFallbackSold = true;
      console.log(
        `[price-trace] sold pool 100% edition-fallback but active pool confirmed ` +
        `variant-matched (${verifiedActive.length} comps, variant="${variant}") — ` +
        `anchoring Tier 3 active-only instead of blending`
      );
    } else {
      // EX-A: fallback pool never earns Tier 1/2.5 (both trust sold data at
      // full weight with no active grounding) — cap at Tier 2, which forces
      // the 70/30 active blend, or fall through to active-only/PC-estimate
      // tiers when no sold rows even survived the fallback.
      tier = soldPrices.length >= 1 ? 2 : (verifiedActive.length >= 3 ? 3 : 4);
    }
  }
  else if (freshCount >= 5) tier = 1;
  else if (freshCount >= 1 && freshCount <= 4) tier = 2;
  else if (freshCount === 0 && soldPrices.length >= 5) tier = 2.5;
  else if (freshCount === 0 && verifiedActive.length >= 3) tier = 3;

  console.log(`[price-trace] tier=${tier} fresh=${freshCount} recent=${recentCount} stale=${staleCount} soldPool=${soldPrices.length} activePool=${verifiedActive.length}${soldPoolIsAllVariantFallback ? ' variantFallbackPool=true' : ''}`);

  // TIER 1: Recency-weighted sold avg
  if (tier === 1) {
    const weights = { fresh: 1.0, recent: 0.6, stale: 0.25 };
    let weightedSum = 0;
    let weightSum = 0;
    const tier1Prices = [];

    soldVerifyResult.verified.forEach(s => {
      // EX-A (Q109 greenlight): tier selection above already excludes
      // fallback-tagged rows from the freshCount that earns Tier 1 — but a
      // MIXED pool (some real, some variantVerified:false fallback rows)
      // can still land on tier===1 via the real rows alone. Don't let the
      // fallback rows leak into the weighted price itself once here.
      if (s.variantVerified === false) return;
      const band = s.recencyBand;
      const weight = weights[band] || 0.25;
      weightedSum += s.price * weight;
      weightSum += weight;
      tier1Prices.push(s.price);
    });

    const recencyWeighted = weightSum > 0 ? weightedSum / weightSum : 0;
    const soldLow = tier1Prices.length > 0 ? Math.min(...tier1Prices) : Math.min(...soldPrices);

    // Sanity ceiling: warn if soldAvg > activeLow
    let sanityCeilingWarning = null;
    if (verifiedActive.length > 0) {
      // Q61: Extract price from object rows
      const activePrices = verifiedActive.map(v => typeof v === 'number' ? v : v?.price).filter(p => p > 0);
      if (activePrices.length > 0) {
        const activeLow = Math.min(...activePrices);
        if (recencyWeighted > activeLow) {
          sanityCeilingWarning = `sold $${recencyWeighted.toFixed(2)} > activeLow $${activeLow.toFixed(2)}`;
          console.log(`[tier-1-sanity] ${sanityCeilingWarning}`);
        }
      }
    }

    const tier1Market = roundCurrency(recencyWeighted);
    const result = {
      quick: Math.round(soldLow * 100) / 100,
      market: tier1Market,
      stretch: Math.round(recencyWeighted * 1.15 * 100) / 100,
      source: 'tier1_recency_weighted',
      count: tier1Prices.length,
      tier: 1,
      sanityCeilingWarning,
      variantAdjusted: variantAdjusted || false,
      // D2 — pcBase/gradeMultiplier are reference-only here: recency-
      // weighted sold data controls this tier's price entirely, never a
      // PriceCharting product. They must never be displayed as this
      // tier's calculation base (the defect this commit closes).
      derivationTrace: buildDerivationTrace(
        'verified_sold_recency',
        { priceChartingRaw: pcBase ?? null, gradeMultiplier: gradeMultiplier ?? null },
        [
          buildTraceStep('recency_weighted_sold', tier1Prices, 'weighted_average', null, tier1Market, true, 'eligible_verified_sold'),
        ],
        tier1Market
      ),
    };

    console.log(`[tier-1] recencyWeighted=$${recencyWeighted.toFixed(2)} soldLow=$${soldLow.toFixed(2)}`);
    return applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted, tier1Prices.length);
  }

  // TIER 2: 70/30 blend (soldAvg × 0.7 + activeAvg × 0.3)
  if (tier === 2) {
    const soldAvg = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length;
    // Q61: Extract price from object rows (Q53 fix made verifiedActive contain objects)
    const activePrices = verifiedActive.map(v => typeof v === 'number' ? v : v?.price).filter(p => p > 0);
    const activeAvg = activePrices.length > 0
      ? activePrices.reduce((a, b) => a + b, 0) / activePrices.length
      : 0;
    const activeLow = activePrices.length > 0 ? Math.min(...activePrices) : 0;
    const soldLow = Math.min(...soldPrices);

    // ASM #17 [P0, 2026-07-16]: active-vs-sold contradiction flag. A
    // verified sold anchor already exists here — if the active pool sits
    // implausibly far below it, blending it in at 30% weight still drags
    // the price down toward contamination (era/volume-collision: modern
    // relaunch issues, anthology-title reprints, or any future class
    // sharing the same title+issue# — sold $61-$291 vs active $3.95-$4.99
    // from 2015/2025 "Amazing Spider-Man #17" relaunch listings; also
    // reproduced live for Action Comics #33 against its 2014 New 52
    // relaunch). This is a downstream safety net keyed off the divergence
    // itself — it does NOT attempt to identify or fix the contamination
    // source. Generalizes to any franchise with a renumbering history
    // (X-Men, Fantastic Four, Avengers, etc.).
    const activePoolSuspect = activeAvg > 0 && soldAvg > 0 && (
      activeAvg < soldAvg * 0.25 ||
      (activeLow > 0 && activeLow < soldLow * 0.25)
    );

    // GK-34 (2026-08-07 dispatch, Bone #1 class) — activePoolSuspect firing
    // does not by itself mean the sold pool should dominate the price. A
    // sold pool below MIN_POOL_FOR_OVERRIDE (n=1, Bone #1: a single
    // $1,619.99 first-print sale mismatched against a later-printing UK
    // edition) has no more standing to override an 18-comp active pool
    // outright (market=soldAvg) than to dominate a 70/30 blend —
    // 0.7×1619.99 + 0.3×40.50 is still $1,146, still absurd for a $15-40
    // book. When the sold side is this thin, invert the weighting: the
    // active pool carries the price using the same ask-discount formula
    // Tier 3 already uses for active-only pricing (activeAvg × 0.85), and
    // the thin sold pool is demoted to a reference annotation — surfaced
    // per I13 (never vaporized), never treated as the pricing anchor. A
    // sold pool that clears MIN_POOL_FOR_OVERRIDE keeps the original
    // sold-only behavior below — the ASM #17 contamination defense this
    // guard was built for legitimately trusts a real-sized sold pool over
    // a suspect active one; this only changes what happens when the sold
    // side is too thin to have earned that trust.
    const soldPoolTooThinToOverride = activePoolSuspect && soldPrices.length < MIN_POOL_FOR_OVERRIDE;

    // GrailKey Directive AH (GK-111) — evidence applicability custody,
    // sold-path sibling to AB's active-path fix (GK-101). soldVerifyResult's
    // variant fallback (verifySoldComps, src/lib/soldVerification.js) can
    // re-admit sold comps that never matched the confirmed variant/edition
    // at all — soldPoolIsAllVariantFallback is true when every surviving
    // sold row is one of those re-admitted rows. That fact alone is not
    // enough to demote authority (C5/2a): it must be SCOPED to whether THIS
    // tier's own `market` value actually consumed the fallback-sourced sold
    // average, not just "a fallback pool exists somewhere upstream" (the
    // global rule this dispatch explicitly rejects — Fixture 3b). Within
    // Tier 2, `soldPoolTooThinToOverride` is the one sub-branch where sold
    // is demoted to a reference annotation and `market` is computed from
    // activeAvg alone (I13: still shown, never used as pricing evidence) —
    // every other sub-branch (blend, sold-only, sold-only-active-suspect)
    // genuinely folds soldAvg into `market`.
    const soldPoolFallbackConsumed = soldPoolIsAllVariantFallback && !soldPoolTooThinToOverride;

    const blendApplies = !activePoolSuspect && activeAvg > 0;
    let market;
    let quickBase;
    if (soldPoolTooThinToOverride) {
      market = activeAvg * 0.85;
      quickBase = activeLow > 0 ? activeLow * 0.85 : market;
    } else if (activePoolSuspect) {
      // Suspect active data excluded from the blend — sold-only, same as
      // the no-active-data path below.
      market = soldAvg;
      quickBase = soldLow;
    } else if (activeAvg > 0) {
      market = (soldAvg * 0.7) + (activeAvg * 0.3);
      quickBase = soldLow;
    } else {
      // Sold-only: use soldAvg raw (no bump needed — Tier 2 already conservative)
      market = soldAvg;
      quickBase = soldLow;
    }
    const tier2Market = roundCurrency(market);

    const tier2Source = soldPoolTooThinToOverride
      ? 'tier2_active_dominant_thin_sold'
      : (activePoolSuspect
          ? 'tier2_sold_only_active_suspect'
          : (activeAvg > 0 ? 'tier2_blend_70_30' : 'tier2_sold_only'));

    const result = {
      quick: Math.round(quickBase * 100) / 100,
      market: tier2Market,
      stretch: Math.round(market * 1.15 * 100) / 100,
      source: tier2Source,
      count: soldPrices.length + verifiedActive.length,
      tier: 2,
      variantAdjusted: variantAdjusted || false,
      // GrailKey Directive AH (GK-111) — own-property, unconditional (same
      // presence-aware convention AB established for variantApplicability):
      // true only when THIS tier's market value actually consumed a
      // variant-fallback sold pool, never merely "one existed upstream."
      soldPoolFallbackConsumed,
      activePoolSuspect: activePoolSuspect || false,
      activePoolSuspectReason: activePoolSuspect
        ? `active avg $${activeAvg.toFixed(2)} / low $${activeLow.toFixed(2)} < 25% of sold avg $${soldAvg.toFixed(2)} / low $${soldLow.toFixed(2)}`
        : null,
      ...(soldPoolTooThinToOverride && {
        soldPoolTreatedAsReference: true,
        soldPoolReferenceReason: `sold pool n=${soldPrices.length} below MIN_POOL_FOR_OVERRIDE=${MIN_POOL_FOR_OVERRIDE} — shown as reference (I13), active pool (n=${activePrices.length}) used as pricing anchor instead`,
      }),
      // D2 — reference-only pcBase/gradeMultiplier; sold/active averages
      // control this tier entirely.
      derivationTrace: buildDerivationTrace(
        tier2Source,
        { priceChartingRaw: pcBase ?? null, gradeMultiplier: gradeMultiplier ?? null },
        [
          buildTraceStep('sold_average', soldPrices, 'average', null, roundCurrency(soldAvg), true, soldPoolTooThinToOverride ? 'reference_only' : 'eligible_verified_sold'),
          buildTraceStep('active_average', activePrices, 'average', null, activePrices.length > 0 ? roundCurrency(activeAvg) : null, blendApplies || soldPoolTooThinToOverride, 'eligible_active'),
          soldPoolTooThinToOverride
            ? buildTraceStep('active_dominant_thin_sold_discount', roundCurrency(activeAvg), 'multiply', 0.85, tier2Market, true, 'computed')
            : (blendApplies
                ? buildTraceStep('blend_70_30', [roundCurrency(soldAvg), roundCurrency(activeAvg)], 'weighted_blend', { sold: 0.7, active: 0.3 }, tier2Market, true, 'computed')
                : buildTraceStep('sold_only', roundCurrency(soldAvg), 'identity', null, tier2Market, true, 'computed')),
        ],
        tier2Market
      ),
    };

    if (soldPoolTooThinToOverride) {
      console.log(`[tier-2] SOLD POOL TOO THIN TO OVERRIDE — treated as reference, active pool anchors price: ${result.soldPoolReferenceReason}`);
    } else if (activePoolSuspect) {
      console.log(`[tier-2] ACTIVE POOL SUSPECT — excluded from blend: ${result.activePoolSuspectReason}`);
      // Dispatch 06 follow-up (2026-08-07) — n>=3 clears MIN_POOL_FOR_OVERRIDE
      // but can still be a poor ratio against a much larger active pool (3
      // solds overriding 18 actives is directionally better than the prior
      // n=1 case, not obviously correct on its own). Log without blocking
      // the override, so production can show whether n=3 is sufficient.
      if (activePrices.length > 0 && soldPrices.length < activePrices.length / 3) {
        console.log(`[pool-ratio-warn] GK-34 override fired with pool ratio worse than 1:3 — soldPool=${soldPrices.length} overriding activePool=${activePrices.length} (ratio 1:${(activePrices.length / soldPrices.length).toFixed(1)})`);
      }
    }
    console.log(`[tier-2] soldAvg=$${soldAvg.toFixed(2)} activeAvg=$${activeAvg.toFixed(2)} blend=$${market.toFixed(2)}`);
    return applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted, soldPrices.length);
  }

  // TIER 2.5: All-stale sold pool (≥5 comps, 100% stale >90d) — Q64
  // Apply 0.85 discount to stale average (market staleness penalty).
  // Cap decision action to LIST_LOW (not LIST_NOW) due to data staleness.
  if (tier === 2.5) {
    const staleAvg = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length;
    const discounted = staleAvg * 0.85;
    const staleLow = Math.min(...soldPrices);
    const tier25Market = roundCurrency(discounted);

    const result = {
      quick: Math.round(staleLow * 0.85 * 100) / 100,
      market: tier25Market,
      stretch: Math.round(discounted * 1.15 * 100) / 100,
      source: 'verified_sold_stale',
      count: soldPrices.length,
      tier: 2.5,
      staleWarning: 'All sold comps >90 days old — verify current market before listing',
      variantAdjusted: variantAdjusted || false,
      // D2 — reference-only pcBase/gradeMultiplier; stale sold average
      // (discounted for staleness) controls this tier entirely.
      derivationTrace: buildDerivationTrace(
        'verified_sold_stale',
        { priceChartingRaw: pcBase ?? null, gradeMultiplier: gradeMultiplier ?? null },
        [
          buildTraceStep('stale_sold_average', soldPrices, 'average', null, staleAvg, true, 'eligible_verified_sold'),
          buildTraceStep('staleness_discount', staleAvg, 'multiply', 0.85, tier25Market, true, 'computed'),
        ],
        tier25Market
      ),
    };

    console.log(`[tier-2.5] staleAvg=$${staleAvg.toFixed(2)} discounted=$${discounted.toFixed(2)} (all ${staleCount} stale)`);
    return applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted, soldPrices.length);
  }

  // TIER 3: Active-only × 0.85 discount
  if (tier === 3) {
    // Q61: Extract price from object rows (Q53 fix made verifiedActive contain objects)
    const activePrices = verifiedActive.map(v => typeof v === 'number' ? v : v?.price).filter(p => p > 0);
    const activeAvg = activePrices.reduce((a, b) => a + b, 0) / activePrices.length;
    const discounted = activeAvg * 0.85;
    const activeLow = Math.min(...activePrices);
    const tier3Market = roundCurrency(discounted);
    const tier3Source = activeAnchoredOverFallbackSold ? 'tier3_active_discounted_over_fallback_sold' : 'tier3_active_discounted';

    const result = {
      quick: Math.round(activeLow * 0.85 * 100) / 100,
      market: tier3Market,
      stretch: Math.round(discounted * 1.15 * 100) / 100,
      source: tier3Source,
      count: verifiedActive.length,
      tier: 3,
      askDerivedWarning: 'ask-derived pricing — verify before listing',
      ...(activeAnchoredOverFallbackSold && {
        activeAnchoredOverFallbackSold: true,
        activeAnchoredReason: 'sold pool was 100% edition-ambiguous fallback; confirmed variant-matched active pool used as anchor instead of blending',
      }),
      // D2 — reference-only pcBase/gradeMultiplier; active-ask average
      // (discounted for ask-vs-realized gap) controls this tier entirely.
      derivationTrace: buildDerivationTrace(
        tier3Source,
        { priceChartingRaw: pcBase ?? null, gradeMultiplier: gradeMultiplier ?? null },
        [
          buildTraceStep('active_average', activePrices, 'average', null, activeAvg, true, 'eligible_active'),
          buildTraceStep('active_ask_discount', activeAvg, 'multiply', 0.85, tier3Market, true, 'computed'),
        ],
        tier3Market
      ),
    };

    console.log(`[tier-3] activeAvg=$${activeAvg.toFixed(2)} discounted=$${discounted.toFixed(2)}${activeAnchoredOverFallbackSold ? ' (over-fallback-sold anchor)' : ''}`);
    return result;
  }

  // TIER 4: PC estimate (last resort)
  if (pcBase && pcBase > 0) {
    const afterGradeMult = pcBase * gradeMultiplier;
    let basePrice = afterGradeMult;

    // D2 — pcBase DOES control this tier's price (unlike tiers 1/2/2.5/3,
    // where it's reference-only). Traced as a real operation, not a
    // reference value, from the start.
    const traceOps = [
      buildTraceStep('pricecharting_raw', pcBase, 'identity', null, pcBase, true, 'pricecharting_api'),
      buildTraceStep('grade_multiplier', pcBase, 'multiply', gradeMultiplier, roundCurrency(afterGradeMult), true, 'computed'),
    ];

    // T4-CAP [P2]: Sanity cap tier-4 pc_estimate at compsAvg when comps exist.
    // Evidence: FF Invisible Woman $17.08 vs compsAvg $5.69.
    // When verified comps exist (even if <2 for tier pricing), cap PC at compsAvg.
    // Q69 FIX 2: Skip when soldPrices≥5 — verified solds outrank active asks as anchor.
    // Action #33: 15 stale solds $300-565 should NOT be capped by 2 junk actives $18.
    let sanityCapped = false;
    if (verifiedActive.length > 0 && soldPrices.length < 5) {
      // Q61: Extract price from object rows
      const activePrices = verifiedActive.map(v => typeof v === 'number' ? v : v?.price).filter(p => p > 0);
      if (activePrices.length > 0) {
        const compsAvg = activePrices.reduce((a, b) => a + b, 0) / activePrices.length;
        if (basePrice > compsAvg * 1.5) {
          console.log(`[tier-4-sanity] pc_estimate $${basePrice.toFixed(2)} > compsAvg×1.5 ($${(compsAvg * 1.5).toFixed(2)}) → capped to compsAvg $${compsAvg.toFixed(2)}`);
          traceOps.push(buildTraceStep('active_sanity_cap', basePrice, 'cap', null, roundCurrency(compsAvg), true, 'eligible_active'));
          basePrice = compsAvg;
          sanityCapped = true;
        }
      }
    }
    const tier4Market = roundCurrency(basePrice);

    const result = {
      quick: Math.round(basePrice * 0.8 * 100) / 100,
      market: tier4Market,
      stretch: Math.round(basePrice * 1.2 * 100) / 100,
      source: 'tier4_pc_estimate',
      count: 0,
      tier: 4,
      sanityCapped,
      derivationTrace: buildDerivationTrace(
        'tier4_pc_estimate',
        { priceChartingRaw: pcBase, gradeMultiplier },
        traceOps,
        tier4Market
      ),
    };

    console.log(`[tier-4] pc_estimate=$${basePrice.toFixed(2)}${sanityCapped ? ' (sanity-capped)' : ''}`);
    return result;
  }

  // No data available
  console.log('[price-bands] tier=4 no data available');
  return null;
}

/**
 * Enforce floor on recommended price — Ship #20b.
 * Floors: Tier 0 liability table + verified-sold low ONLY.
 * NEVER ask-based floors (active comps do NOT set floor).
 */
export function enforceFloor(recommendedPrice, verifiedSoldLow) {
  if (!verifiedSoldLow || !recommendedPrice) return recommendedPrice;
  if (recommendedPrice >= verifiedSoldLow) return recommendedPrice;

  console.log(`[floor-enforcement] price $${recommendedPrice.toFixed(2)} < soldLow $${verifiedSoldLow.toFixed(2)} → enforced to soldLow`);
  return verifiedSoldLow;
}
