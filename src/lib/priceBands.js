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
  if (!comps || !comps.prices || comps.prices.length === 0) return [];

  // Active comps don't have individual titles in prices array,
  // but filter was already applied in fetchComps.
  // This is a sanity check that we have actual prices.
  return comps.prices.filter(p => p != null && p > 0);
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
 * Main price bands engine.
 * Returns price bands with source attribution.
 *
 * STEP 1: Try verified sold pool (min 2)
 * STEP 2: Try verified active pool (min 2)
 * STEP 3: Fall to PC base estimate
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
}) {
  // STEP 1 — VERIFIED SOLD POOL
  const verifiedSolds = buildVerifiedSoldPool(soldComps, { title, issue, variant });
  const soldPrices = verifiedSolds.map(s => s.price);

  if (verifiedSolds.length >= 2) {
    const recencyData = verifiedSolds.map(s => ({ daysAgo: s.daysAgo }));
    const bands = calculatePriceBands(soldPrices, 'verified_sold', recencyData);

    if (bands) {
      const result = applyGradeMultiplierToBands(bands, gradeMultiplier);
      console.log('[price-bands] soldPool=', soldPrices.length,
        'activePool=', activeComps?.prices?.length || 0,
        'source=', result?.source,
        'market=', result?.market,
        variantAdjusted ? '| VARIANT-ADJUSTED' : '');
      // Flag variant-adjusted pricing for UI warning
      if (variantAdjusted) {
        result.variantAdjusted = true;
      }
      return result;
    }
  }

  // STEP 2 — VERIFIED ACTIVE POOL
  const verifiedActive = buildVerifiedActivePool(activeComps, { title, issue });

  if (verifiedActive.length >= 2) {
    // Check for contamination
    const soldMedian = verifiedSolds.length >= 2
      ? percentile([...verifiedSolds.map(s => s.price)].sort((a,b) => a-b), 50)
      : null;
    const activeMedian = percentile([...verifiedActive].sort((a,b) => a-b), 50);

    if (isActiveContaminated(soldMedian, activeMedian)) {
      // Skip active, it's contaminated
      // Fall through to PC
    } else {
      const bands = calculatePriceBands(verifiedActive, 'verified_active');
      if (bands) {
        const result = applyGradeMultiplierToBands(bands, gradeMultiplier);
        console.log('[price-bands] soldPool=', soldPrices.length,
          'activePool=', verifiedActive.length,
          'source=', result?.source,
          'market=', result?.market);
        return result;
      }
    }
  }

  // STEP 3 — PC BASE (last resort)
  if (pcBase && pcBase > 0) {
    const basePrice = pcBase * gradeMultiplier;
    const result = {
      quick: Math.round(basePrice * 0.8 * 100) / 100,   // 80% of base
      market: Math.round(basePrice * 100) / 100,        // base
      stretch: Math.round(basePrice * 1.2 * 100) / 100, // 120% of base
      source: 'pc_estimate',
      count: 0,
      recencyDays: null
    };
    console.log('[price-bands] soldPool=', soldPrices.length,
      'activePool=', verifiedActive?.length || 0,
      'source=', result?.source,
      'market=', result?.market);
    return result;
  }

  // No data available
  console.log('[price-bands] soldPool=', soldPrices.length,
    'activePool=', 0,
    'source=null (no data)');
  return null;
}

/**
 * Enforce floor on recommended price.
 * Recommended never below floor.
 */
export function enforceFloor(recommendedPrice, floor) {
  if (!floor || !recommendedPrice) return recommendedPrice;
  if (recommendedPrice >= floor) return recommendedPrice;
  return floor;
}
