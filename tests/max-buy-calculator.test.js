// tests/max-buy-calculator.test.js
//
// MAX BUY V1 — pure-function proof for src/lib/maxBuyCalculator.js.
// MAX BUY is a direct algebraic inversion of Buyer Mode's existing
// BidCalculator economics (App.jsx), not a parallel pricing model:
//   netProfit = marketValue - fee - supplies - labor - price
//   maxBuy    = marketValue - fee - supplies - labor - targetProfit
// so price <= maxBuy  <=>  netProfit(price) >= targetProfit, by construction.
//
// Invoke: node tests/max-buy-calculator.test.js

import {
  computeFeeAmount,
  computeNetProfit,
  computeMaxBuy,
  evaluateAgainstMaxBuy,
} from '../src/lib/maxBuyCalculator.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(desc, fn) {
  tests.push({ desc, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `expected ${expected}, got ${actual}`);
  }
}

function run() {
  console.log('='.repeat(60));
  console.log('MAX BUY V1 — Calculator Tests');
  console.log('='.repeat(60));

  tests.forEach(({ desc, fn }) => {
    try {
      fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  });

  console.log('');
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// Directive's own worked example (GRAILKEY — MAX BUY V1):
//   Estimated value: $100 · Costs/fees: $18 · Target profit: $25
//   => MAX BUY: $57 · Seller asks $45 => BUY, $12 below MAX BUY
// feePct chosen so fee ($10) + supplies ($3) + labor ($5) = $18 total.
// ─────────────────────────────────────────────────────────────────

test('worked example: MAX BUY = $57 (marketValue=100, fee=10%, supplies=3, labor=5, target=25)', () => {
  const r = computeMaxBuy({ marketValue: 100, feePct: 10, supplies: 3, labor: 5, targetProfit: 25 });
  assert(r.valid, 'expected a valid result');
  assertEqual(r.feeAmt, 10, `expected feeAmt 10, got ${r.feeAmt}`);
  assertEqual(r.totalNonBidCosts, 18, `expected totalNonBidCosts 18, got ${r.totalNonBidCosts}`);
  assertEqual(r.maxBuy, 57, `expected maxBuy 57, got ${r.maxBuy}`);
  assert(r.achievable, 'expected achievable=true');
});

test('worked example: $45 ask is $12 below MAX BUY => BUY', () => {
  const { maxBuy } = computeMaxBuy({ marketValue: 100, feePct: 10, supplies: 3, labor: 5, targetProfit: 25 });
  const { decision, delta } = evaluateAgainstMaxBuy({ maxBuy, price: 45 });
  assertEqual(decision, 'BUY', `expected BUY, got ${decision}`);
  assertEqual(delta, 12, `expected delta 12, got ${delta}`);
});

// ─────────────────────────────────────────────────────────────────
// Monotonicity
// ─────────────────────────────────────────────────────────────────

test('increasing fees lowers MAX BUY', () => {
  const base = { marketValue: 200, supplies: 2, labor: 3, targetProfit: 20 };
  const low = computeMaxBuy({ ...base, feePct: 10 });
  const high = computeMaxBuy({ ...base, feePct: 20 });
  assert(high.maxBuy < low.maxBuy, `expected higher-fee maxBuy (${high.maxBuy}) < lower-fee maxBuy (${low.maxBuy})`);
});

test('increasing target profit lowers MAX BUY', () => {
  const base = { marketValue: 200, feePct: 10, supplies: 2, labor: 3 };
  const low = computeMaxBuy({ ...base, targetProfit: 10 });
  const high = computeMaxBuy({ ...base, targetProfit: 50 });
  assert(high.maxBuy < low.maxBuy, `expected higher-target maxBuy (${high.maxBuy}) < lower-target maxBuy (${low.maxBuy})`);
});

test('increasing expected sale value (marketValue) raises MAX BUY', () => {
  const base = { feePct: 10, supplies: 2, labor: 3, targetProfit: 20 };
  const low = computeMaxBuy({ ...base, marketValue: 100 });
  const high = computeMaxBuy({ ...base, marketValue: 300 });
  assert(high.maxBuy > low.maxBuy, `expected higher-marketValue maxBuy (${high.maxBuy}) > lower-marketValue maxBuy (${low.maxBuy})`);
});

test('increasing supplies lowers MAX BUY (existing cost, not a new model)', () => {
  const base = { marketValue: 200, feePct: 10, labor: 3, targetProfit: 20 };
  const low = computeMaxBuy({ ...base, supplies: 1 });
  const high = computeMaxBuy({ ...base, supplies: 10 });
  assert(high.maxBuy < low.maxBuy, 'expected higher supplies to lower maxBuy');
});

test('increasing labor lowers MAX BUY (existing cost, not a new model)', () => {
  const base = { marketValue: 200, feePct: 10, supplies: 2, targetProfit: 20 };
  const low = computeMaxBuy({ ...base, labor: 1 });
  const high = computeMaxBuy({ ...base, labor: 10 });
  assert(high.maxBuy < low.maxBuy, 'expected higher labor to lower maxBuy');
});

// ─────────────────────────────────────────────────────────────────
// BUY/PASS decision boundary
// ─────────────────────────────────────────────────────────────────

test('price below MAX BUY produces BUY', () => {
  const { decision } = evaluateAgainstMaxBuy({ maxBuy: 57, price: 50 });
  assertEqual(decision, 'BUY');
});

test('price above MAX BUY produces PASS', () => {
  const { decision } = evaluateAgainstMaxBuy({ maxBuy: 57, price: 60 });
  assertEqual(decision, 'PASS');
});

test('exact-boundary price (price === maxBuy) is deterministic (BUY, inclusive)', () => {
  const { decision, delta } = evaluateAgainstMaxBuy({ maxBuy: 57, price: 57 });
  assertEqual(decision, 'BUY', 'boundary should resolve to BUY, matching BidCalculator\'s existing >= rule');
  assertEqual(delta, 0);
});

test('boundary is stable across repeated evaluation (deterministic, no floating drift injected)', () => {
  const a = evaluateAgainstMaxBuy({ maxBuy: 33.33, price: 33.33 });
  const b = evaluateAgainstMaxBuy({ maxBuy: 33.33, price: 33.33 });
  assertEqual(a.decision, b.decision);
  assertEqual(a.delta, b.delta);
});

// ─────────────────────────────────────────────────────────────────
// Fail-safe behavior on missing/invalid inputs
// ─────────────────────────────────────────────────────────────────

test('missing marketValue fails safely (valid=false, no throw, no NaN)', () => {
  const r = computeMaxBuy({ marketValue: null, feePct: 10, supplies: 1, labor: 1, targetProfit: 10 });
  assertEqual(r.valid, false);
  assertEqual(r.maxBuy, null);
});

test('zero/negative marketValue fails safely', () => {
  const r1 = computeMaxBuy({ marketValue: 0, feePct: 10, supplies: 1, labor: 1, targetProfit: 10 });
  const r2 = computeMaxBuy({ marketValue: -50, feePct: 10, supplies: 1, labor: 1, targetProfit: 10 });
  assertEqual(r1.valid, false);
  assertEqual(r2.valid, false);
});

test('NaN/undefined targetProfit fails safely', () => {
  const r1 = computeMaxBuy({ marketValue: 100, feePct: 10, supplies: 1, labor: 1, targetProfit: NaN });
  const r2 = computeMaxBuy({ marketValue: 100, feePct: 10, supplies: 1, labor: 1, targetProfit: undefined });
  assertEqual(r1.valid, false);
  assertEqual(r2.valid, false);
});

test('missing/invalid feePct, supplies, labor default to 0 rather than throwing', () => {
  const r = computeMaxBuy({ marketValue: 100, feePct: undefined, supplies: null, labor: NaN, targetProfit: 10 });
  assert(r.valid, 'expected a valid result despite missing cost inputs');
  assertEqual(r.maxBuy, 90, `expected maxBuy 90 (100 - 0 - 0 - 0 - 10), got ${r.maxBuy}`);
});

test('unreachable target profit (maxBuy < 0) is flagged, not silently clamped or thrown', () => {
  const r = computeMaxBuy({ marketValue: 50, feePct: 10, supplies: 5, labor: 5, targetProfit: 100 });
  assert(r.valid, 'still a valid computation');
  assert(!r.achievable, 'expected achievable=false when maxBuy would be negative');
  assert(r.maxBuy < 0, 'maxBuy itself remains the true (negative) value, not clamped, for callers that need it');
});

test('evaluateAgainstMaxBuy fails safely on non-finite inputs', () => {
  const r1 = evaluateAgainstMaxBuy({ maxBuy: null, price: 10 });
  const r2 = evaluateAgainstMaxBuy({ maxBuy: 10, price: NaN });
  assertEqual(r1.decision, null);
  assertEqual(r2.decision, null);
});

// ─────────────────────────────────────────────────────────────────
// Regression: existing Buyer Mode net-profit math is unchanged, and the
// MAX BUY inversion is always consistent with it (shared equation).
// ─────────────────────────────────────────────────────────────────

test('computeNetProfit matches the pre-existing BidCalculator formula exactly', () => {
  // Pre-existing inline formula from App.jsx (unchanged):
  //   whatnotFeeAmt = marketValue * (feePct/100)
  //   netProfit = marketValue - whatnotFeeAmt - supplies - labor - bidNum
  const marketValue = 150, feePct = 12, supplies = 1.5, labor = 2.5, price = 80;
  const expectedFee = marketValue * (feePct / 100);
  const expectedNetProfit = marketValue - expectedFee - supplies - labor - price;

  const feeAmt = computeFeeAmount(marketValue, feePct);
  const netProfit = computeNetProfit({ marketValue, feePct, supplies, labor, price });

  assertEqual(feeAmt, expectedFee);
  assertEqual(netProfit, expectedNetProfit);
});

test('invariant holds across a spread of prices: price <= maxBuy iff netProfit(price) >= targetProfit', () => {
  const marketValue = 275, feePct = 15, supplies = 4, labor = 6, targetProfit = 30;
  const { maxBuy } = computeMaxBuy({ marketValue, feePct, supplies, labor, targetProfit });

  for (const price of [0, 10, 50, 100, maxBuy - 1, maxBuy, maxBuy + 1, 150, 200]) {
    const netProfit = computeNetProfit({ marketValue, feePct, supplies, labor, price });
    const viaNetProfit = netProfit >= targetProfit;
    const viaMaxBuy = price <= maxBuy;
    assertEqual(
      viaMaxBuy, viaNetProfit,
      `price=${price}: netProfit-based=${viaNetProfit} but maxBuy-based=${viaMaxBuy} (maxBuy=${maxBuy}, netProfit=${netProfit})`
    );
  }
});

test('shouldBuy-equivalent: evaluateAgainstMaxBuy(price) decision matches netProfit>=targetProfit at several prices', () => {
  const marketValue = 90, feePct = 10, supplies = 0.75, labor = 2, targetProfit = 5; // matches DEFAULT_BUYER_SETTINGS shape
  const { maxBuy } = computeMaxBuy({ marketValue, feePct, supplies, labor, targetProfit });

  [10, 40, 62, 62.75, 70, 90].forEach((price) => {
    const netProfit = computeNetProfit({ marketValue, feePct, supplies, labor, price });
    const expectedDecision = netProfit >= targetProfit ? 'BUY' : 'PASS';
    const { decision } = evaluateAgainstMaxBuy({ maxBuy, price });
    assertEqual(decision, expectedDecision, `price=${price}: expected ${expectedDecision}, got ${decision}`);
  });
});

run();
