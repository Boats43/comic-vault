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
function applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted) {
  if (!result || !variantAdjusted) return result;

  const activePrices = (verifiedActive || [])
    .map(v => (typeof v === 'number' ? v : v?.price))
    .filter(p => p > 0);
  if (activePrices.length === 0) return result; // no trustworthy anchor to check against

  const activeAvg = activePrices.reduce((a, b) => a + b, 0) / activePrices.length;
  if (!(activeAvg > 0) || !(result.market > activeAvg * 2)) return result;

  console.log(`[variant-fallback-cap] market $${result.market.toFixed(2)} > activeAvg×2 ($${(activeAvg * 2).toFixed(2)}) — capping to active-anchored price (I9-style)`);

  return {
    ...result,
    quick: Math.round(Math.min(result.quick, activeAvg * 0.85) * 100) / 100,
    market: Math.round(activeAvg * 100) / 100,
    stretch: Math.round(activeAvg * 1.15 * 100) / 100,
    source: 'variant_fallback_capped',
    tier: Math.max(result.tier, 3),
    variantFallbackCapped: true,
    variantFallbackCapReason: `sold-fallback market $${result.market.toFixed(2)} exceeded active-avg×2 ($${(activeAvg * 2).toFixed(2)})`,
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
  if (soldPoolIsAllVariantFallback) {
    // EX-A: fallback pool never earns Tier 1/2.5 (both trust sold data at
    // full weight with no active grounding) — cap at Tier 2, which forces
    // the 70/30 active blend, or fall through to active-only/PC-estimate
    // tiers when no sold rows even survived the fallback.
    tier = soldPrices.length >= 1 ? 2 : (verifiedActive.length >= 3 ? 3 : 4);
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

    const result = {
      quick: Math.round(soldLow * 100) / 100,
      market: Math.round(recencyWeighted * 100) / 100,
      stretch: Math.round(recencyWeighted * 1.15 * 100) / 100,
      source: 'tier1_recency_weighted',
      count: tier1Prices.length,
      tier: 1,
      sanityCeilingWarning,
      variantAdjusted: variantAdjusted || false,
    };

    console.log(`[tier-1] recencyWeighted=$${recencyWeighted.toFixed(2)} soldLow=$${soldLow.toFixed(2)}`);
    return applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted);
  }

  // TIER 2: 70/30 blend (soldAvg × 0.7 + activeAvg × 0.3)
  if (tier === 2) {
    const soldAvg = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length;
    // Q61: Extract price from object rows (Q53 fix made verifiedActive contain objects)
    const activePrices = verifiedActive.map(v => typeof v === 'number' ? v : v?.price).filter(p => p > 0);
    const activeAvg = activePrices.length > 0
      ? activePrices.reduce((a, b) => a + b, 0) / activePrices.length
      : 0;

    let market;
    if (activeAvg > 0) {
      market = (soldAvg * 0.7) + (activeAvg * 0.3);
    } else {
      // Sold-only: use soldAvg raw (no bump needed — Tier 2 already conservative)
      market = soldAvg;
    }

    const soldLow = Math.min(...soldPrices);

    const result = {
      quick: Math.round(soldLow * 100) / 100,
      market: Math.round(market * 100) / 100,
      stretch: Math.round(market * 1.15 * 100) / 100,
      source: activeAvg > 0 ? 'tier2_blend_70_30' : 'tier2_sold_only',
      count: soldPrices.length + verifiedActive.length,
      tier: 2,
      variantAdjusted: variantAdjusted || false,
    };

    console.log(`[tier-2] soldAvg=$${soldAvg.toFixed(2)} activeAvg=$${activeAvg.toFixed(2)} blend=$${market.toFixed(2)}`);
    return applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted);
  }

  // TIER 2.5: All-stale sold pool (≥5 comps, 100% stale >90d) — Q64
  // Apply 0.85 discount to stale average (market staleness penalty).
  // Cap decision action to LIST_LOW (not LIST_NOW) due to data staleness.
  if (tier === 2.5) {
    const staleAvg = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length;
    const discounted = staleAvg * 0.85;
    const staleLow = Math.min(...soldPrices);

    const result = {
      quick: Math.round(staleLow * 0.85 * 100) / 100,
      market: Math.round(discounted * 100) / 100,
      stretch: Math.round(discounted * 1.15 * 100) / 100,
      source: 'verified_sold_stale',
      count: soldPrices.length,
      tier: 2.5,
      staleWarning: 'All sold comps >90 days old — verify current market before listing',
      variantAdjusted: variantAdjusted || false,
    };

    console.log(`[tier-2.5] staleAvg=$${staleAvg.toFixed(2)} discounted=$${discounted.toFixed(2)} (all ${staleCount} stale)`);
    return applyVariantFallbackDivergenceCap(result, verifiedActive, variantAdjusted);
  }

  // TIER 3: Active-only × 0.85 discount
  if (tier === 3) {
    // Q61: Extract price from object rows (Q53 fix made verifiedActive contain objects)
    const activePrices = verifiedActive.map(v => typeof v === 'number' ? v : v?.price).filter(p => p > 0);
    const activeAvg = activePrices.reduce((a, b) => a + b, 0) / activePrices.length;
    const discounted = activeAvg * 0.85;
    const activeLow = Math.min(...activePrices);

    const result = {
      quick: Math.round(activeLow * 0.85 * 100) / 100,
      market: Math.round(discounted * 100) / 100,
      stretch: Math.round(discounted * 1.15 * 100) / 100,
      source: 'tier3_active_discounted',
      count: verifiedActive.length,
      tier: 3,
      askDerivedWarning: 'ask-derived pricing — verify before listing',
    };

    console.log(`[tier-3] activeAvg=$${activeAvg.toFixed(2)} discounted=$${discounted.toFixed(2)}`);
    return result;
  }

  // TIER 4: PC estimate (last resort)
  if (pcBase && pcBase > 0) {
    let basePrice = pcBase * gradeMultiplier;

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
          basePrice = compsAvg;
          sanityCapped = true;
        }
      }
    }

    const result = {
      quick: Math.round(basePrice * 0.8 * 100) / 100,
      market: Math.round(basePrice * 100) / 100,
      stretch: Math.round(basePrice * 1.2 * 100) / 100,
      source: 'tier4_pc_estimate',
      count: 0,
      tier: 4,
      sanityCapped,
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
