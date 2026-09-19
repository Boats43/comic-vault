/**
 * MAX BUY — pure inversion of Buyer Mode's existing net-profit economics.
 *
 * BidCalculator (src/App.jsx) already computes:
 *   netProfit = marketValue - (marketValue * feePct/100) - supplies - labor - price
 *   shouldBuy = netProfit >= targetProfit
 *
 * MAX BUY is the same linear equation solved for `price` given a required
 * targetProfit, instead of a second, parallel cost model:
 *   maxBuy = marketValue - (marketValue * feePct/100) - supplies - labor - targetProfit
 *
 * By construction, price <= maxBuy  <=>  netProfit(price) >= targetProfit —
 * the two are always consistent because they share one equation.
 *
 * Shipping and any other cost the calculator has never modeled are
 * deliberately NOT included here — disclosed omission, not invented.
 */

export function computeFeeAmount(marketValue, feePct) {
  const mv = Number(marketValue);
  const fp = Number(feePct);
  if (!Number.isFinite(mv) || mv <= 0) return 0;
  if (!Number.isFinite(fp)) return 0;
  return mv * (fp / 100);
}

export function computeNetProfit({ marketValue, feePct, supplies, labor, price }) {
  const mv = Number(marketValue);
  const p = Number(price);
  if (!Number.isFinite(mv) || mv <= 0 || !Number.isFinite(p)) return null;
  const feeAmt = computeFeeAmount(mv, feePct);
  const s = Number.isFinite(Number(supplies)) ? Number(supplies) : 0;
  const l = Number.isFinite(Number(labor)) ? Number(labor) : 0;
  return mv - feeAmt - s - l - p;
}

/**
 * @returns {{ maxBuy: number|null, feeAmt: number, totalNonBidCosts: number, valid: boolean, achievable: boolean, reason?: string }}
 */
export function computeMaxBuy({ marketValue, feePct, supplies, labor, targetProfit }) {
  const mv = Number(marketValue);
  const tp = Number(targetProfit);

  if (!Number.isFinite(mv) || mv <= 0) {
    return { maxBuy: null, feeAmt: 0, totalNonBidCosts: 0, valid: false, achievable: false, reason: 'missing_market_value' };
  }
  if (!Number.isFinite(tp)) {
    return { maxBuy: null, feeAmt: 0, totalNonBidCosts: 0, valid: false, achievable: false, reason: 'invalid_target_profit' };
  }

  const feeAmt = computeFeeAmount(mv, feePct);
  const s = Number.isFinite(Number(supplies)) ? Number(supplies) : 0;
  const l = Number.isFinite(Number(labor)) ? Number(labor) : 0;
  const totalNonBidCosts = feeAmt + s + l;
  const maxBuy = mv - totalNonBidCosts - tp;

  return { maxBuy, feeAmt, totalNonBidCosts, valid: true, achievable: maxBuy >= 0 };
}

/**
 * Compares a contemplated acquisition price against a previously computed
 * MAX BUY. Boundary is inclusive (price === maxBuy -> BUY), matching
 * BidCalculator's existing `netProfit >= minProfit` (inclusive) rule.
 *
 * @returns {{ decision: 'BUY'|'PASS'|null, delta: number|null }}
 */
export function evaluateAgainstMaxBuy({ maxBuy, price }) {
  if (maxBuy == null || price == null) {
    return { decision: null, delta: null };
  }
  const mb = Number(maxBuy);
  const p = Number(price);
  if (!Number.isFinite(mb) || !Number.isFinite(p)) {
    return { decision: null, delta: null };
  }
  const delta = mb - p; // positive => price is below MAX BUY; negative => above
  return { decision: delta >= 0 ? 'BUY' : 'PASS', delta };
}
