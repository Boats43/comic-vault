// Ship #21 — Demand Signals Tests

import {
  calculateVelocity,
  calculatePriceTrend,
  calculateLiquidity,
  computeDemandSignals
} from '../src/lib/demandSignals.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(desc, fn) {
  tests.push({ desc, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function run() {
  console.log('='.repeat(60));
  console.log('Ship #21 — Demand Signals Tests');
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
// Velocity Tests
// ─────────────────────────────────────────────────────────────────

test('calculateVelocity - HIGH (3+ sales in 90 days)', () => {
  const soldComps = [
    { price: 100, daysAgo: 10 },
    { price: 110, daysAgo: 30 },
    { price: 120, daysAgo: 60 },
  ];
  const result = calculateVelocity(soldComps);
  assert(result === 'HIGH', `expected HIGH, got ${result}`);
});

test('calculateVelocity - MEDIUM (1-2 sales in 90 days)', () => {
  const soldComps = [
    { price: 100, daysAgo: 10 },
    { price: 110, daysAgo: 120 },
  ];
  const result = calculateVelocity(soldComps);
  assert(result === 'MEDIUM', `expected MEDIUM, got ${result}`);
});

test('calculateVelocity - LOW (no sales in 90 days)', () => {
  const soldComps = [
    { price: 100, daysAgo: 120 },
    { price: 110, daysAgo: 150 },
  ];
  const result = calculateVelocity(soldComps);
  assert(result === 'LOW', `expected LOW, got ${result}`);
});

test('calculateVelocity - empty array', () => {
  const result = calculateVelocity([]);
  assert(result === 'LOW', 'empty array should return LOW');
});

// ─────────────────────────────────────────────────────────────────
// Price Trend Tests
// ─────────────────────────────────────────────────────────────────

test('calculatePriceTrend - RISING (>15% increase)', () => {
  const soldComps = [
    { price: 120, daysAgo: 10 },  // most recent
    { price: 100, daysAgo: 90 },  // oldest
  ];
  const result = calculatePriceTrend(soldComps);
  assert(result === 'RISING', `expected RISING, got ${result}`);
});

test('calculatePriceTrend - DECLINING (>15% decrease)', () => {
  const soldComps = [
    { price: 80, daysAgo: 10 },   // most recent
    { price: 100, daysAgo: 90 },  // oldest
  ];
  const result = calculatePriceTrend(soldComps);
  assert(result === 'DECLINING', `expected DECLINING, got ${result}`);
});

test('calculatePriceTrend - FLAT (within ±15%)', () => {
  const soldComps = [
    { price: 105, daysAgo: 10 },  // most recent
    { price: 100, daysAgo: 90 },  // oldest
  ];
  const result = calculatePriceTrend(soldComps);
  assert(result === 'FLAT', `expected FLAT, got ${result}`);
});

test('calculatePriceTrend - less than 2 comps', () => {
  const soldComps = [{ price: 100, daysAgo: 10 }];
  const result = calculatePriceTrend(soldComps);
  assert(result === 'FLAT', 'should return FLAT for < 2 comps');
});

// ─────────────────────────────────────────────────────────────────
// Liquidity Tests
// ─────────────────────────────────────────────────────────────────

test('calculateLiquidity - FAST (ratio < 2)', () => {
  const result = calculateLiquidity(10, 10);
  assert(result === 'FAST', `expected FAST, got ${result}`);
});

test('calculateLiquidity - NORMAL (ratio 2-5)', () => {
  const result = calculateLiquidity(20, 5);
  assert(result === 'NORMAL', `expected NORMAL, got ${result}`);
});

test('calculateLiquidity - SLOW (ratio > 5)', () => {
  const result = calculateLiquidity(30, 5);
  assert(result === 'SLOW', `expected SLOW, got ${result}`);
});

test('calculateLiquidity - no sold comps', () => {
  const result = calculateLiquidity(10, 0);
  assert(result === 'SLOW', 'no sold should return SLOW');
});

// ─────────────────────────────────────────────────────────────────
// Integrated Tests
// ─────────────────────────────────────────────────────────────────

test('computeDemandSignals - HIGH demand book', () => {
  const soldComps = [
    { price: 120, daysAgo: 10 },
    { price: 110, daysAgo: 30 },
    { price: 105, daysAgo: 60 },
    { price: 100, daysAgo: 90 },
  ];
  const activeComps = { count: 5 };

  const result = computeDemandSignals({ soldComps, activeComps });

  assert(result.velocity === 'HIGH', 'velocity should be HIGH');
  assert(result.trend === 'RISING', 'trend should be RISING');
  assert(result.liquidity === 'FAST', 'liquidity should be FAST');
  assert(result.demandLevel === 'HIGH', 'overall demand should be HIGH');
});

test('computeDemandSignals - LOW demand book', () => {
  const soldComps = [
    { price: 80, daysAgo: 120 },
    { price: 100, daysAgo: 180 },
  ];
  const activeComps = { count: 20 };

  const result = computeDemandSignals({ soldComps, activeComps });

  assert(result.velocity === 'LOW', 'velocity should be LOW');
  assert(result.trend === 'DECLINING', 'trend should be DECLINING');
  assert(result.liquidity === 'SLOW', 'liquidity should be SLOW');
  assert(result.demandLevel === 'LOW', 'overall demand should be LOW');
});

test('computeDemandSignals - NORMAL demand book', () => {
  const soldComps = [
    { price: 100, daysAgo: 30 },
    { price: 95, daysAgo: 120 },
  ];
  const activeComps = { count: 8 };

  const result = computeDemandSignals({ soldComps, activeComps });

  assert(result.velocity === 'MEDIUM', 'velocity should be MEDIUM');
  assert(result.trend === 'FLAT', 'trend should be FLAT');
  assert(result.liquidity === 'NORMAL', 'liquidity should be NORMAL');
  assert(result.demandLevel === 'NORMAL', 'overall demand should be NORMAL');
});

// Run all tests
run();
