/**
 * Data Quality Write-Back Guard
 * Principle 2: Better data never replaced by worse
 *
 * Prevents quality degradation when re-scanning books.
 * A verified_sold price ($13.18) should never be overwritten
 * by browse_api ($32) on refresh.
 */

const PRICE_RANK = {
  'verified_sold': 1,
  'verified_active': 2,
  'browse_api': 3,
  'pc_estimate': 4,
  'gocollect': 4,
  'web_search_fallback': 5,
  'ai_estimate': 6,
  'image_search_fallback': 7,
  'refused-no-data-sources': 8,
  'refused-reprint-thin-pool': 8,
  'refused-identity-conflict': 8,
  'refused-claude-gate': 8,
  'refused': 8,
  'identity-required': 9,
  null: 9,
  undefined: 9
};

const GRADE_RANK = {
  'high': 1,
  'HIGH': 1,
  'medium': 2,
  'MEDIUM': 2,
  'low': 3,
  'LOW': 3,
  null: 4,
  undefined: 4
};

/**
 * Choose between incoming and current price based on quality rank.
 * Lower rank = better quality. Preserves current if incoming is worse.
 *
 * @param {object} incoming - new data from enrich API
 * @param {object} current - existing data in catalogue
 * @returns {object} { price, pricingSource, preserved }
 */
export function chooseBetterPrice(incoming, current) {
  const inRank = PRICE_RANK[incoming?.pricingSource] ?? 9;
  const curRank = PRICE_RANK[current?.pricingSource] ?? 9;

  // Lower rank = better. Keep current if incoming is worse.
  if (inRank > curRank && current?.price != null) {
    console.log('[data-guard] PRESERVE', current.pricingSource,
      '$' + current.price, '— rejected', incoming?.pricingSource);
    return {
      price: current.price,
      priceLow: current.priceLow,
      priceHigh: current.priceHigh,
      pricingSource: current.pricingSource,
      priceNote: current.priceNote,
      preserved: true
    };
  }

  return {
    price: incoming?.price ?? current?.price,
    priceLow: incoming?.priceLow ?? current?.priceLow,
    priceHigh: incoming?.priceHigh ?? current?.priceHigh,
    pricingSource: incoming?.pricingSource ?? current?.pricingSource,
    priceNote: incoming?.priceNote ?? current?.priceNote,
    preserved: false
  };
}

/**
 * Choose between incoming and current grade based on confidence rank.
 * Lower rank = better confidence. Preserves current if incoming is worse.
 *
 * @param {object} incoming - new data from enrich API
 * @param {object} current - existing data in catalogue
 * @returns {object} { grade, gradeConfidence, preserved }
 */
export function chooseBetterGrade(incoming, current) {
  const inRank = GRADE_RANK[incoming?.confidenceLevel] ?? 4;
  const curRank = GRADE_RANK[current?.confidenceLevel] ?? 4;

  if (inRank > curRank && current?.grade) {
    console.log('[data-guard] PRESERVE grade', current.grade,
      current.confidenceLevel, '— rejected', incoming?.confidenceLevel);
    return {
      grade: current.grade,
      confidenceLevel: current.confidenceLevel,
      preserved: true
    };
  }

  return {
    grade: incoming?.grade ?? current?.grade,
    confidenceLevel: incoming?.confidenceLevel ?? current?.confidenceLevel,
    preserved: false
  };
}
