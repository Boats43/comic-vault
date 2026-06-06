/**
 * Pricing Engine — Universal pricing helpers
 *
 * Pure functions for asset pricing logic. Format-agnostic core helpers
 * extracted from api/enrich.js (Step 1 of AssetCore extraction).
 *
 * Functions here are domain-agnostic. Comic-specific logic (CGC multipliers,
 * test-market variants, key-issue patterns) remains in ComicAdapter.
 */

/**
 * Format a number as USD ("$1,234.56") or null.
 */
export const fmtUsd = (n) =>
  n == null || isNaN(n)
    ? null
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/**
 * Median of a numeric array. Used for mixed-print/variant comp fallbacks
 * where the mean is meaningless (e.g. 1st prints @ $200 mixed with 4th
 * prints @ $3 averages to $100). Median filters outlier prints better.
 */
export const median = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Ship #13.1 — thin-comp-pool anchor as a pure, testable helper.
 * Safety cap applied AFTER all pricing math (variant/key mult, sanity,
 * floor) to prevent the engine from recommending more than 5% above the
 * highest actual comp when the pool is too thin (<3 comps) to validate
 * a higher number. Ship #13 gated this on isFromPC, but that misses the
 * exact case it was designed for — PC outlier sanity-flipped into a
 * browse_api price that still overshoots the lone comp (Biker Mice #1).
 *
 * Returns { anchorCap, shouldAnchor: true } when the cap should apply,
 * or null when anchor is not warranted. Pure — no side effects.
 *
 * Skip conditions:
 *   isMegaKey        → floor map at api/mega-keys.js is authoritative
 *   compsExhausted   → no trusted comps to anchor against
 *   rawComps missing / count≤1 / count≥3 → no thin-pool situation
 *   highest missing / ≤0                  → no upper bound to cap against
 *   currentPrice missing / ≤0             → nothing to cap
 *   currentPrice ≤ anchorCap              → already within cap (no-op)
 *
 * Ship #20a.6.11: threshold raised to count≤1 (was count≤0). Single-comp
 * pools are too unreliable to anchor (Sensation #1 Crowley 9.4 case where
 * 1 wrong-book comp set a $1,250 floor). Anchor now fires only at count=2.
 *
 * Ship #20a.6.13: floor guard added. Thin-pool anchor runs AFTER floor guard
 * in the pricing pipeline (line 1906 vs 1704), but has no floor awareness —
 * can override floor and lower price below it. Avengers #20 (2025) case: floor
 * enforced $3.19, anchor capped at $2.68, recommended ended up below floor.
 * Conservative guard: suppress anchor when anchorCap < rawComps.lowest.
 */
export const computeThinPoolAnchor = (currentPrice, rawComps, opts = {}) => {
  const { isMegaKey, compsExhausted } = opts;
  if (isMegaKey || compsExhausted) return null;
  if (!rawComps || typeof rawComps.count !== 'number') return null;
  if (rawComps.count <= 1 || rawComps.count >= 3) return null;
  if (typeof rawComps.highest !== 'number' || rawComps.highest <= 0) return null;
  if (typeof currentPrice !== 'number' || !(currentPrice > 0)) return null;
  const anchorCap = rawComps.highest * 1.05;

  // Never anchor below floor. Floor guard runs before anchor (line 1704) but
  // anchor has no floor awareness. If anchorCap would lower price below
  // grade-filtered floor, suppress the anchor entirely.
  // Fix C (Phase 1): use grade-filtered lowest for floor comparison.
  const floorValue = rawComps.gradeFilteredLowest ?? rawComps.lowest;
  const floor = typeof floorValue === 'number' && floorValue > 0
    ? floorValue : 0;
  if (floor > 0 && anchorCap < floor) {
    console.log(`[thin-pool] anchorCap $${anchorCap.toFixed(2)} < floor $${floor.toFixed(2)} — anchor suppressed`);
    return null;
  }

  if (currentPrice <= anchorCap) return null;
  return { anchorCap, shouldAnchor: true };
};

/**
 * Ship #14 — price-engine sanity fallback as a pure, testable helper.
 * Compares the PC × grade-mult output (pcNum) against the comp-derived
 * market signal (compsAvg) and returns a fallback when PC diverges too
 * far in either direction. Era-aware thresholds:
 *
 *   High-side (PC > market):
 *     lowCompsCount (<3)      → 1.25×
 *     isMixedFallback         → 1.25×
 *     Golden <1970            → 3.0×
 *     Silver/Bronze 1970–1984 → 1.75×
 *     Modern 1985+            → 1.5×
 *
 *   Low-side (PC < market):
 *     Silver + Bronze 1956–1984 → 0.6× (Ship #14 Fix 4.3)
 *     True Golden <1956, Modern 1985+, unknown year → 0.5×
 *
 * The 1956 boundary uses the comic-community Silver Age start (Showcase
 * #4, Oct 1956). The engine's high-side bucketing uses <1970 / <1985 for
 * calibration reasons — low-side needs the wider Silver window to catch
 * FF #61 (1967) class of keys where PC base lags recent run-ups.
 *
 * Floor gate (Ship #14 Fix 4.1): `compsAvg > 1` — was `> 5`, which
 * blocked modern mid-grade books at $3–5 from ever getting comp-checked
 * (Deadpool/Wolverine #2, ASM Extra! #1 overpricing class). `> 1`
 * preserves null-safety without masking real modern comps.
 *
 * Returns { shouldFire: 'high' | 'low', fallbackPrice, fallbackPriceLow,
 * fallbackPriceHigh, threshold, thresholdMult, priceNote } on fire, or
 * null when PC is within the acceptable band. Pure — no side effects.
 *
 * Era boundaries (Golden<1970, Silver/Bronze 1970-1984, Modern 1985+) are
 * comic-specific — revisit in ComicAdapter Step 5.
 */
export const computeSanityFallback = (pcNum, compsAvg, opts = {}) => {
  const { bookYear, lowCompsCount, isMixedFallback } = opts;
  if (!(compsAvg > 1)) return null;
  if (!(pcNum > 0)) return null;

  const year = parseInt(bookYear, 10) || 0;
  const highMult =
    lowCompsCount ? 1.25 :
    isMixedFallback ? 1.25 :
    year < 1970 ? 3 :
    year < 1985 ? 1.75 :
    1.5;
  const lowMult = (year >= 1956 && year < 1985) ? 0.6 : 0.5;

  if (pcNum > compsAvg * highMult) {
    return {
      shouldFire: 'high',
      fallbackPrice: compsAvg * 1.15,
      fallbackPriceLow: compsAvg * 0.75,
      fallbackPriceHigh: compsAvg * 1.5,
      threshold: compsAvg * highMult,
      thresholdMult: highMult,
      priceNote: 'PC outlier — eBay avg used',
    };
  }
  if (pcNum < compsAvg * lowMult) {
    return {
      shouldFire: 'low',
      fallbackPrice: compsAvg,
      fallbackPriceLow: compsAvg * 0.75,
      fallbackPriceHigh: compsAvg * 1.5,
      threshold: compsAvg * lowMult,
      thresholdMult: lowMult,
      priceNote: 'PC too low — eBay avg used',
    };
  }
  return null;
};

/**
 * Ship #17 — bottom-of-census low-grade floor as a pure, testable helper.
 * When PriceCharting pop data confirms the user's grade is at the bottom
 * of CGC census (no copies graded lower) AND pricing fell back to
 * browse_api (sanity LOW lifted to compsAvg, or no-PC fallback used
 * rawComps.average directly), re-anchor `out.price` to rawComps.lowest.
 * The census says the user IS the market floor, so the bottom of the
 * at-grade comp pool is a more honest anchor than the average.
 *
 * Conservative scope (Ship #17 Q1):
 *   - Only fires when pricingSource === 'browse_api'.
 *     PC × grade-mult outputs are calibrated and preserved — the
 *     bottom-of-census signal alone does not override calibrated
 *     grade-aware pricing.
 *
 * Skip conditions (matches Ship #13.1 / Ship #14 helpers):
 *   isMegaKey       → mega-key floor is authoritative (one-way raise
 *                     downstream re-corrects anyway, but skip to avoid
 *                     pointless price thrash and observability noise)
 *   compsExhausted  → AI verify rejected 100% of comps; rawComps.lowest
 *                     is null and compsFromEbay.lowest is contaminated
 *   pop missing / pop.total === 0  → no signal
 *   pop.belowGrade !== 0           → not bottom (covers null/undefined too)
 *   rawComps missing / lowest <= 0 → no anchor available
 *   currentPrice <= rawComps.lowest → already at/below floor
 *
 * Returns { anchor, shouldAnchor: true } when the re-anchor should
 * apply, or null when it should not. Pure — no side effects.
 */
export const computeLowGradeFloor = (currentPrice, rawComps, pop, opts = {}) => {
  const { isMegaKey, compsExhausted, pricingSource } = opts;
  if (isMegaKey || compsExhausted) return null;
  if (pricingSource !== 'browse_api') return null;
  if (!pop || !(Number(pop.total) > 0)) return null;
  if (pop.belowGrade !== 0) return null;
  if (!rawComps) return null;
  // Fix C (Phase 1): use grade-filtered lowest instead of global lowest.
  // Prevents VG 4.0 books from anchoring floor to FR 1.0 listings.
  // Falls back to global lowest when grade filter wasn't applied.
  const lowest = Number(rawComps.gradeFilteredLowest ?? rawComps.lowest);
  if (!(lowest > 0)) return null;
  if (typeof currentPrice !== 'number' || !(currentPrice > 0)) return null;
  if (currentPrice <= lowest) return null;
  return { anchor: lowest, shouldAnchor: true };
};

/**
 * Get era classification for a year.
 *
 * @param {number} year - Year to classify
 * @param {number} boundary - Era boundary (default 1985 for comics)
 * @returns {'vintage' | 'modern'}
 */
export const getEra = (year, boundary = 1985) => {
  const y = parseInt(year, 10);
  if (!y || y <= 0) return 'vintage';
  return y >= boundary ? 'modern' : 'vintage';
};

/**
 * Enforce floor on price.
 * Returns max(price, floor) when floor exists, otherwise returns price.
 *
 * @param {number} price - Price to enforce floor on
 * @param {number} floor - Minimum price
 * @returns {number} Price with floor enforced
 */
export const enforceFloor = (price, floor) => {
  if (price == null || price <= 0) return price;
  if (floor == null || floor <= 0) return price;
  return Math.max(price, floor);
};

/**
 * Compute price bands (low/high/floor) from a base price.
 *
 * @param {number} price - Base price
 * @param {object} opts - Multipliers (lowMult, highMult, floorMult)
 * @returns {object} { low, high, floor }
 */
export const computePriceBands = (price, opts = {}) => {
  const { lowMult = 0.75, highMult = 1.25, floorMult = 0.85 } = opts;
  if (price == null || price <= 0) {
    return { low: null, high: null, floor: null };
  }
  return {
    low: price * lowMult,
    high: price * highMult,
    floor: price * floorMult,
  };
};
