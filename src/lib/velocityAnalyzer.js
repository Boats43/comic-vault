// Ship #25 — Velocity Curves + Dynamic Pricing
//
// Analyzes PriceCharting sales velocity data (already extracted in enrich.js)
// to detect market trends and provide dynamic pricing recommendations.
//
// Input: salesVelocity object from PC (per-grade sale frequency)
// Output: trend classification + pricing adjustment + market timing signals
//
// Velocity data format (from pricecharting-pop.js's formatGradeKey — "9.8"
// / "9.0" / "raw", NOT "cgc98"/"cgc94"; a prior version of this comment and
// of getUserGradeVelocity's key construction documented/used the wrong
// shape, which made hasData silently false for every graded book):
// {
//   "9.8": { label: "2.3 per week", perDay: 0.33 },
//   "9.4": { label: "1.1 per month", perDay: 0.037 },
//   "raw": { label: "0.8 per month", perDay: 0.027 }
// }
//
// Trend classification:
// - ACCELERATING: Current velocity > historical baseline → price rising
// - FLAT: Velocity steady → normal market
// - DECELERATING: Current velocity < baseline → price falling
// - THIN: Low volume → unreliable signal
//
// Dynamic pricing strategy:
// - ACCELERATING → Stretch band (sell into demand spike)
// - FLAT → Market band (normal pricing)
// - DECELERATING → Quick band (exit before drop)
// - THIN → Market band (not enough data for adjustment)

/**
 * Extract sales velocity for user's grade from PC salesVelocity object.
 * @param {Object} salesVelocity - Per-grade velocity from PC
 * @param {string|number} userGrade - User's grade (CGC numeric or 'raw')
 * @returns {Object|null} { label, perDay } or null
 */
export function getUserGradeVelocity(salesVelocity, userGrade) {
  if (!salesVelocity || typeof salesVelocity !== 'object') return null;

  // Normalize user grade to the same key format pricecharting-pop.js's
  // formatGradeKey writes onto salesVelocity: "raw", or a numeric grade
  // string with an explicit ".0" for whole numbers (9.8 → "9.8", 9 → "9.0").
  let key;
  if (userGrade === 'raw') {
    key = 'raw';
  } else if (typeof userGrade === 'number' && !isNaN(userGrade)) {
    key = Number.isInteger(userGrade) ? `${userGrade}.0` : String(userGrade);
  } else {
    return null;
  }

  return salesVelocity[key] || null;
}

/**
 * Classify velocity trend based on perDay rate.
 *
 * Thresholds (empirically calibrated):
 * - THIN: < 0.02/day (< 0.6/month) — unreliable signal
 * - SLOW: 0.02-0.05/day (0.6-1.5/month) — normal for older books
 * - NORMAL: 0.05-0.15/day (1.5-4.5/month) — healthy market
 * - FAST: 0.15-0.4/day (4.5-12/month) — high liquidity
 * - HOT: > 0.4/day (> 12/month) — spiking demand
 *
 * @param {number} perDay - Sales per day
 * @returns {string} Velocity tier
 */
export function classifyVelocityTier(perDay) {
  if (perDay == null || perDay <= 0) return 'UNKNOWN';
  if (perDay < 0.02) return 'THIN';      // < 0.6/month
  if (perDay < 0.05) return 'SLOW';      // 0.6-1.5/month
  if (perDay < 0.15) return 'NORMAL';    // 1.5-4.5/month
  if (perDay < 0.4) return 'FAST';       // 4.5-12/month
  return 'HOT';                           // > 12/month
}

/**
 * Compute dynamic pricing recommendation based on velocity tier.
 *
 * Strategy:
 * - HOT: Stretch band (+premium, sell into spike)
 * - FAST: High Market (slightly above market)
 * - NORMAL: Market band (standard pricing)
 * - SLOW: Market band (no adjustment needed)
 * - THIN: Market band (not enough data)
 * - UNKNOWN: Market band (default)
 *
 * Returns multiplier to apply to market price (1.0 = no adjustment).
 *
 * @param {string} tier - Velocity tier from classifyVelocityTier
 * @returns {Object} { recommendedBand: 'quick'|'market'|'stretch', multiplier, reason }
 */
export function getPricingRecommendation(tier) {
  switch (tier) {
    case 'HOT':
      return {
        recommendedBand: 'stretch',
        multiplier: 1.0, // Stretch band already applies premium
        reason: 'High demand — selling 12+/month. List at Stretch to capture spike.',
        urgency: 'HIGH',
      };
    case 'FAST':
      return {
        recommendedBand: 'market',
        multiplier: 1.05, // +5% premium
        reason: 'Strong demand — 4-12 sales/month. Price slightly above market.',
        urgency: 'MEDIUM',
      };
    case 'NORMAL':
      return {
        recommendedBand: 'market',
        multiplier: 1.0,
        reason: 'Healthy market — 1.5-4.5 sales/month. Standard market pricing.',
        urgency: 'NONE',
      };
    case 'SLOW':
      return {
        recommendedBand: 'market',
        multiplier: 1.0,
        reason: 'Slow market — 0.6-1.5 sales/month. Patience required.',
        urgency: 'NONE',
      };
    case 'THIN':
      return {
        recommendedBand: 'quick',
        multiplier: 0.95, // -5% discount
        reason: 'Very slow market — < 0.6 sales/month. Price to move or hold long-term.',
        urgency: 'LOW',
      };
    case 'UNKNOWN':
    default:
      return {
        recommendedBand: 'market',
        multiplier: 1.0,
        reason: 'No velocity data — standard pricing.',
        urgency: 'NONE',
      };
  }
}

/**
 * Detect market saturation from velocity data.
 *
 * Saturation indicators:
 * - Sudden drop in velocity (historical baseline exists but no current data)
 * - Very thin market after previously being normal
 *
 * @param {Object} salesVelocity - PC salesVelocity object
 * @param {string|number} userGrade - User's grade
 * @returns {Object|null} { saturated: boolean, reason } or null
 */
export function detectSaturation(salesVelocity, userGrade) {
  // Simple v1: just check if velocity exists
  // TODO Ship #26: Add historical baseline comparison
  const velocity = getUserGradeVelocity(salesVelocity, userGrade);
  if (!velocity || velocity.perDay == null) {
    return {
      saturated: false,
      reason: 'No velocity data available',
    };
  }

  const tier = classifyVelocityTier(velocity.perDay);
  if (tier === 'THIN') {
    return {
      saturated: true,
      reason: 'Very slow sales — thin market signal. Consider holding or pricing to move.',
    };
  }

  return {
    saturated: false,
    reason: null,
  };
}

/**
 * Main analyzer: combines velocity data into actionable intelligence.
 *
 * @param {Object} params
 * @param {Object} params.salesVelocity - PC salesVelocity object
 * @param {string|number} params.userGrade - User's grade
 * @param {Object} params.priceBands - { quick, market, stretch }
 * @returns {Object} Analysis result with recommendations
 */
export function analyzeVelocity({
  salesVelocity,
  userGrade,
  priceBands,
}) {
  const velocity = getUserGradeVelocity(salesVelocity, userGrade);

  if (!velocity || velocity.perDay == null) {
    return {
      hasData: false,
      tier: 'UNKNOWN',
      perDay: null,
      label: null,
      recommendation: getPricingRecommendation('UNKNOWN'),
      saturation: detectSaturation(salesVelocity, userGrade),
    };
  }

  const tier = classifyVelocityTier(velocity.perDay);
  const recommendation = getPricingRecommendation(tier);
  const saturation = detectSaturation(salesVelocity, userGrade);

  // Compute recommended price based on tier
  let recommendedPrice = null;
  if (priceBands && priceBands[recommendation.recommendedBand]) {
    const basePrice = priceBands[recommendation.recommendedBand];
    recommendedPrice = Math.round(basePrice * recommendation.multiplier);
  }

  return {
    hasData: true,
    tier,
    perDay: velocity.perDay,
    label: velocity.label,
    recommendation: {
      ...recommendation,
      recommendedPrice,
    },
    saturation,
    // Human-readable summary
    summary: formatVelocitySummary(tier, velocity.label, recommendation),
  };
}

/**
 * Format velocity analysis into human-readable summary.
 */
function formatVelocitySummary(tier, label, recommendation) {
  const tierLabels = {
    HOT: '🔥 HOT MARKET',
    FAST: '⚡ FAST',
    NORMAL: '✓ NORMAL',
    SLOW: '🐢 SLOW',
    THIN: '⚠️ THIN',
    UNKNOWN: '❓ UNKNOWN',
  };

  return `${tierLabels[tier] || tier} — ${label} • ${recommendation.reason}`;
}

/**
 * Get velocity display color for UI.
 */
export function getVelocityColor(tier) {
  switch (tier) {
    case 'HOT':
      return '#dc2626'; // red (hot)
    case 'FAST':
      return '#ea580c'; // orange
    case 'NORMAL':
      return '#16a34a'; // green
    case 'SLOW':
      return '#ca8a04'; // yellow
    case 'THIN':
      return '#9ca3af'; // gray
    case 'UNKNOWN':
    default:
      return '#6b7280'; // gray
  }
}
