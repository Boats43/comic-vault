// Ship #20b — Price Bands Tests

import {
  percentile,
  applyRecencyWeight,
  titleMatch,
  issueMatch,
  variantMatch,
  buildVerifiedSoldPool,
  buildVerifiedActivePool,
  calculatePriceBands,
  isActiveContaminated,
  applyGradeMultiplierToBands,
  computePriceBands,
  enforceFloor
} from '../src/lib/priceBands.js';

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
  console.log('Ship #20b — Price Bands Tests');
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
// Helpers
// ─────────────────────────────────────────────────────────────────

test('percentile - Action Comics #33 case', () => {
  const values = [300, 439, 565];
  assert(percentile(values, 10) === 300, 'quick should be 300');
  assert(percentile(values, 50) === 439, 'market should be 439');
  assert(percentile(values, 90) === 565, 'stretch should be 565');
});

test('applyRecencyWeight - recent (<90 days)', () => {
  assert(applyRecencyWeight(100, 30) === 100, 'recent should be 1.0x');
});

test('applyRecencyWeight - old (>180 days)', () => {
  assert(applyRecencyWeight(300, 200) === 210, 'old should be 0.7x');
});

test('titleMatch - exact', () => {
  assert(titleMatch('Amazing Spider-Man', 'Amazing Spider-Man'), 'exact match');
});

test('titleMatch - case insensitive', () => {
  assert(titleMatch('AMAZING SPIDER-MAN', 'amazing spider-man'), 'case insensitive');
});

test('titleMatch - different titles', () => {
  assert(!titleMatch('Superman', 'Batman'), 'different titles should not match');
});

test('issueMatch - hash format', () => {
  assert(issueMatch('Amazing Spider-Man #123', '123'), '#123 should match');
});

test('issueMatch - wrong issue', () => {
  assert(!issueMatch('Flash #216', '190'), 'wrong issue should not match');
});

test('variantMatch - newsstand', () => {
  assert(variantMatch('Amazing Spider-Man #1 Newsstand', 'newsstand'), 'newsstand should match');
});

test('variantMatch - mismatch', () => {
  assert(!variantMatch('Nick Fury #1 JTC Variant', '1:25 variant'), 'wrong variant should not match');
});

// ─────────────────────────────────────────────────────────────────
// Verified Pools
// ─────────────────────────────────────────────────────────────────

test('buildVerifiedSoldPool - exact match', () => {
  const soldComps = [
    { title: 'Action Comics #33', price: 300 },
    { title: 'Action Comics #33', price: 439 },
    { title: 'Action Comics #33', price: 565 },
  ];
  const result = buildVerifiedSoldPool(soldComps, {
    title: 'Action Comics',
    issue: '33',
    variant: null
  });
  assert(result.length === 3, `should have 3 verified comps, got ${result.length}`);
});

test('buildVerifiedSoldPool - wrong issue filtered', () => {
  const soldComps = [
    { title: 'Flash #216', price: 100 },
    { title: 'Flash #190', price: 50 }, // wrong issue
  ];
  const result = buildVerifiedSoldPool(soldComps, {
    title: 'Flash',
    issue: '216',
    variant: null
  });
  assert(result.length === 1, `should filter wrong issue, got ${result.length}`);
  assert(result[0].price === 100, 'should keep #216');
});

test('buildVerifiedSoldPool - variant mismatch filtered', () => {
  const soldComps = [
    { title: 'Nick Fury #1 1:25 Variant', price: 28 },
    { title: 'Nick Fury #1 JTC Variant', price: 7.99 }, // wrong variant
  ];
  const result = buildVerifiedSoldPool(soldComps, {
    title: 'Nick Fury',
    issue: '1',
    variant: '1:25'
  });
  assert(result.length === 1, `should filter wrong variant, got ${result.length}`);
  assert(result[0].price === 28, 'should keep 1:25 variant');
});

// ─────────────────────────────────────────────────────────────────
// Price Bands Calculation
// ─────────────────────────────────────────────────────────────────

test('calculatePriceBands - Action Comics #33', () => {
  const prices = [300, 439, 565];
  const bands = calculatePriceBands(prices, 'verified_sold');

  assert(bands.quick === 300, `quick should be 300, got ${bands.quick}`);
  assert(bands.market === 439, `market should be 439, got ${bands.market}`);
  assert(bands.stretch === 565, `stretch should be 565, got ${bands.stretch}`);
  assert(bands.source === 'verified_sold', 'source should be verified_sold');
  assert(bands.count === 3, `count should be 3, got ${bands.count}`);
});

test('calculatePriceBands - requires min 2 comps', () => {
  const prices = [100];
  const bands = calculatePriceBands(prices, 'verified_sold');
  assert(bands === null, 'should return null for < 2 comps');
});

test('isActiveContaminated - contaminated case', () => {
  assert(isActiveContaminated(400, 25), '400 > 25×3 should be contaminated');
});

test('isActiveContaminated - not contaminated', () => {
  assert(!isActiveContaminated(100, 80), '100 < 80×3 should not be contaminated');
});

test('applyGradeMultiplierToBands', () => {
  const bands = {
    quick: 100,
    market: 150,
    stretch: 200,
    source: 'verified_sold',
    count: 3
  };
  const result = applyGradeMultiplierToBands(bands, 2.0);

  assert(result.quick === 200, `quick should be 200, got ${result.quick}`);
  assert(result.market === 300, `market should be 300, got ${result.market}`);
  assert(result.stretch === 400, `stretch should be 400, got ${result.stretch}`);
});

// ─────────────────────────────────────────────────────────────────
// Main Engine
// ─────────────────────────────────────────────────────────────────

test('computePriceBands - STEP 1 verified sold', () => {
  const soldComps = [
    { title: 'Action Comics #33', price: 300, daysAgo: 30 },
    { title: 'Action Comics #33', price: 439, daysAgo: 60 },
    { title: 'Action Comics #33', price: 565, daysAgo: 90 },
  ];

  const bands = computePriceBands({
    soldComps,
    activeComps: null,
    pcBase: 100,
    gradeMultiplier: 1,
    title: 'Action Comics',
    issue: '33',
    variant: null
  });

  assert(bands.source === 'verified_sold', `source should be verified_sold, got ${bands.source}`);
  assert(bands.market === 439, `market should be 439, got ${bands.market}`);
  assert(bands.count === 3, `count should be 3, got ${bands.count}`);
});

test('computePriceBands - STEP 2 verified active (no sold)', () => {
  const activeComps = {
    prices: [14.99, 20.99, 28.00]
  };

  const bands = computePriceBands({
    soldComps: [],
    activeComps,
    pcBase: 15,
    gradeMultiplier: 1,
    title: 'Nick Fury',
    issue: '1',
    variant: '1:25'
  });

  assert(bands.source === 'verified_active', `source should be verified_active, got ${bands.source}`);
  assert(bands.count === 3, `count should be 3, got ${bands.count}`);
});

test('computePriceBands - STEP 3 PC fallback', () => {
  const bands = computePriceBands({
    soldComps: [],
    activeComps: { prices: [] },
    pcBase: 100,
    gradeMultiplier: 1.5,
    title: 'Test',
    issue: '1',
    variant: null
  });

  assert(bands.source === 'pc_estimate', `source should be pc_estimate, got ${bands.source}`);
  assert(bands.market === 150, `market should be 150, got ${bands.market}`);
  assert(bands.quick === 120, `quick should be 120, got ${bands.quick}`);
  assert(bands.stretch === 180, `stretch should be 180, got ${bands.stretch}`);
});

test('enforceFloor - price below floor', () => {
  const recommended = 13.00;
  const floor = 14.99;
  const result = enforceFloor(recommended, floor);
  assert(result === 14.99, `should enforce floor, got ${result}`);
});

test('enforceFloor - price above floor', () => {
  const recommended = 20.00;
  const floor = 14.99;
  const result = enforceFloor(recommended, floor);
  assert(result === 20.00, `should not change price, got ${result}`);
});

// ─────────────────────────────────────────────────────────────────
// Production Cases
// ─────────────────────────────────────────────────────────────────

test('Action Comics #33 - sold $300-$565, rec $186 FIXED', () => {
  const soldComps = [
    { title: 'Action Comics #33', price: 300, daysAgo: 30 },
    { title: 'Action Comics #33', price: 439, daysAgo: 45 },
    { title: 'Action Comics #33', price: 565, daysAgo: 60 },
  ];

  const bands = computePriceBands({
    soldComps,
    activeComps: { prices: [] },
    pcBase: 186,
    gradeMultiplier: 1,
    title: 'Action Comics',
    issue: '33',
    variant: null
  });

  assert(bands.source === 'verified_sold', 'should use verified sold');
  assert(bands.quick === 300, `quick should be 300, got ${bands.quick}`);
  assert(bands.market === 439, `market should be 439, got ${bands.market}`);
  assert(bands.stretch === 565, `stretch should be 565, got ${bands.stretch}`);
});

test('Flash #216 - wrong issue comps rejected', () => {
  const soldComps = [
    { title: 'Flash #216', price: 100, daysAgo: 30 },
    { title: 'Flash #190', price: 50, daysAgo: 45 }, // wrong
  ];

  const verified = buildVerifiedSoldPool(soldComps, {
    title: 'Flash',
    issue: '216',
    variant: null
  });

  assert(verified.length === 1, `should reject wrong issue, got ${verified.length}`);
  assert(verified[0].price === 100, 'should keep #216');
});

// Run all tests
run();
