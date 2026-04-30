/**
 * Demand Signals - Ship #21
 *
 * Calculates market demand indicators from sales data.
 */

/**
 * Calculate sales velocity signal.
 * HIGH: 3+ sales in 90 days
 * MEDIUM: 1-2 sales in 90 days
 * LOW: no sales in 90 days
 */
export function calculateVelocity(soldComps) {
  if (!soldComps || soldComps.length === 0) return 'LOW';

  const now = Date.now();
  const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);

  const recentSales = soldComps.filter(s => {
    if (!s.daysAgo) return false;
    const saleDate = now - (s.daysAgo * 24 * 60 * 60 * 1000);
    return saleDate >= ninetyDaysAgo;
  });

  if (recentSales.length >= 3) return 'HIGH';
  if (recentSales.length >= 1) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate price trend.
 * Compare most recent sold vs oldest sold.
 * Rising: recent > oldest by 15%+
 * Declining: recent < oldest by 15%+
 * Flat: within ±15%
 */
export function calculatePriceTrend(soldComps) {
  if (!soldComps || soldComps.length < 2) return 'FLAT';

  // soldComps are already sorted by recency (most recent first)
  const mostRecent = soldComps[0];
  const oldest = soldComps[soldComps.length - 1];

  if (!mostRecent?.price || !oldest?.price) return 'FLAT';

  const change = (mostRecent.price - oldest.price) / oldest.price;

  if (change > 0.15) return 'RISING';
  if (change < -0.15) return 'DECLINING';
  return 'FLAT';
}

/**
 * Calculate liquidity score.
 * Fast: active/sold ratio < 2 (low inventory relative to sales)
 * Normal: ratio 2-5
 * Slow: ratio > 5 (high inventory, low sales)
 */
export function calculateLiquidity(activeCount, soldCount) {
  if (!soldCount || soldCount === 0) return 'SLOW';
  if (!activeCount || activeCount === 0) return 'FAST';

  const ratio = activeCount / soldCount;

  if (ratio < 2) return 'FAST';
  if (ratio <= 5) return 'NORMAL';
  return 'SLOW';
}

/**
 * Main demand signals calculator.
 * Returns all demand indicators from sales data.
 */
export function computeDemandSignals({ soldComps, activeComps }) {
  const velocity = calculateVelocity(soldComps);
  const trend = calculatePriceTrend(soldComps);
  const activeCount = activeComps?.count || 0;
  const soldCount = soldComps?.length || 0;
  const liquidity = calculateLiquidity(activeCount, soldCount);

  // Overall demand score
  let demandScore = 0;
  if (velocity === 'HIGH') demandScore += 3;
  else if (velocity === 'MEDIUM') demandScore += 2;
  else demandScore += 1;

  if (trend === 'RISING') demandScore += 2;
  else if (trend === 'FLAT') demandScore += 1;

  if (liquidity === 'FAST') demandScore += 2;
  else if (liquidity === 'NORMAL') demandScore += 1;

  // 7-9 = HIGH, 4-6 = NORMAL, 1-3 = LOW
  const demandLevel = demandScore >= 7 ? 'HIGH' : demandScore >= 4 ? 'NORMAL' : 'LOW';

  return {
    velocity,
    trend,
    liquidity,
    demandLevel,
    demandScore
  };
}
