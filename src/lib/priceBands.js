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
 */
export function buildVerifiedActivePool(comps, { title, issue }) {
  if (!comps || !comps.prices || comps.prices.length === 0) {
    return [];
  }

  // Q53-FIX: Evidence-locked from Howard #11 trace. Rows are OBJECTS
  // {price, title, url}, not bare numbers. Predicate `p > 0` on object = false
  // → 100% rejection. Extract price from object OR use number directly.
  // Add title-overlap + lot-exclusion for object rows.
  const titleLower = String(title || '').toLowerCase();
  const lotRe = /\b(lot|bundle|complete set|full run|comic library|comic collection)\b/i;

  const filtered = comps.prices.filter(p => {
    // Extract price (handle both number and object)
    const price = typeof p === 'number' ? p : p?.price;
    if (!price || price <= 0) return false;

    // For object rows: verify title overlap + exclude lots
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
  variant,
  variantAdjusted = false,
  soldVerifyResult = null,
}) {
  // Build verified pools
  const verifiedSolds = buildVerifiedSoldPool(soldComps, { title, issue, variant });
  const soldPrices = verifiedSolds.map(s => s.price);
  const verifiedActive = buildVerifiedActivePool(activeComps, { title, issue });

  // Extract recency band counts from LIVE soldVerifyResult
  let freshCount = 0;
  let recentCount = 0;
  let staleCount = 0;

  if (soldVerifyResult?.verified && Array.isArray(soldVerifyResult.verified)) {
    soldVerifyResult.verified.forEach(s => {
      const band = s.recencyBand;
      if (band === 'fresh') freshCount++;
      else if (band === 'recent') recentCount++;
      else if (band === 'stale') staleCount++;
    });
  }

  // TIER SELECTION
  // Q64: Added tier 2.5 — soldPool ≥5 all-stale → staleAvg×0.85, LIST_LOW cap
  let tier = 4; // default: no data
  if (freshCount >= 5) tier = 1;
  else if (freshCount >= 1 && freshCount <= 4) tier = 2;
  else if (freshCount === 0 && soldPrices.length >= 5 && staleCount === soldPrices.length) tier = 2.5;
  else if (freshCount === 0 && verifiedActive.length >= 3) tier = 3;

  console.log(`[price-trace] tier=${tier} fresh=${freshCount} recent=${recentCount} stale=${staleCount} soldPool=${soldPrices.length} activePool=${verifiedActive.length}`);

  // TIER 1: Recency-weighted sold avg
  if (tier === 1) {
    const weights = { fresh: 1.0, recent: 0.6, stale: 0.25 };
    let weightedSum = 0;
    let weightSum = 0;

    soldVerifyResult.verified.forEach(s => {
      const band = s.recencyBand;
      const weight = weights[band] || 0.25;
      weightedSum += s.price * weight;
      weightSum += weight;
    });

    const recencyWeighted = weightSum > 0 ? weightedSum / weightSum : 0;
    const soldLow = Math.min(...soldPrices);

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
      count: soldPrices.length,
      tier: 1,
      sanityCeilingWarning,
      variantAdjusted: variantAdjusted || false,
    };

    console.log(`[tier-1] recencyWeighted=$${recencyWeighted.toFixed(2)} soldLow=$${soldLow.toFixed(2)}`);
    return result;
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
    return result;
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
    return result;
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
    let sanityCapped = false;
    if (verifiedActive.length > 0) {
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
