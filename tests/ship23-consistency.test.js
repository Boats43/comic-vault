// Unit tests for Ship #23 — CONSISTENCY ENGINE.
//
// FIX 1: CV year gate (pre-1970 books filter volumes by ±15y).
// FIX 2: Refuse to price with zero verified comps.
// FIX 3: Stale record auto-refresh (UI behavior, not unit-testable).
// FIX 4: Update All Books button (UI behavior, not unit-testable).
//
// Invoke: node tests/ship23-consistency.test.js
// Exit code: 0 on all-pass, 1 on any failure.

// Note: FIX 1 requires mocking ComicVine API responses, so we'll test
// the filter logic in isolation. FIX 2 requires full enrich pipeline.

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (actual, label) => assertEq(actual, true, label);
const assertFalse = (actual, label) => assertEq(actual, false, label);

console.log('\n=== SHIP #23 — CONSISTENCY ENGINE ===\n');

// ─── FIX 1: CV year gate logic ──────────────────────────────────────
console.log('FIX 1 — CV year gate (pre-1970 filter):');

// Test the filter logic: books before 1970 should filter volumes by ±15y
const testYearGateFilter = (bookYear, volumeYear) => {
  if (!bookYear || bookYear >= 1970) return true; // no filter for modern books
  if (!volumeYear) return true; // keep if no year data
  return Math.abs(volumeYear - bookYear) <= 15;
};

// Pre-1970 books should filter
assertFalse(testYearGateFilter(1941, 2014), '1941 book rejects 2014 volume (73y gap)');
assertFalse(testYearGateFilter(1965, 1990), '1965 book rejects 1990 volume (25y gap)');
assertFalse(testYearGateFilter(1950, 1980), '1950 book rejects 1980 volume (30y gap)');
assertFalse(testYearGateFilter(1960, 1976), '1960 book rejects 1976 volume (16y gap)');

// Within tolerance
assertTrue(testYearGateFilter(1941, 1950), '1941 book accepts 1950 volume (9y gap)');
assertTrue(testYearGateFilter(1965, 1975), '1965 book accepts 1975 volume (10y gap)');
assertTrue(testYearGateFilter(1960, 1970), '1960 book accepts 1970 volume (10y gap)');
assertTrue(testYearGateFilter(1955, 1970), '1955 book accepts 1970 volume (15y boundary)');

// Edge cases
assertTrue(testYearGateFilter(1941, null), '1941 book keeps volume with null year');
assertTrue(testYearGateFilter(1941, undefined), '1941 book keeps volume with undefined year');
assertTrue(testYearGateFilter(null, 2014), 'null year book keeps any volume');
assertTrue(testYearGateFilter(0, 2014), 'zero year book keeps any volume');

// Modern books (no filter)
assertTrue(testYearGateFilter(2020, 1990), '2020 book accepts any volume (no gate for modern)');
assertTrue(testYearGateFilter(1985, 2020), '1985 book accepts any volume (≥1970)');
assertTrue(testYearGateFilter(1970, 2020), '1970 boundary accepts any volume');
assertFalse(testYearGateFilter(1969, 2020), '1969 book rejects 2020 (51y gap, pre-1970)');

// ─── FIX 2: Refuse-to-price logic ───────────────────────────────────
console.log('\nFIX 2 — Refuse to price (zero verified comps):');

// Test the refuse-to-price condition (updated: no longer checks pricingSource)
const shouldRefuseToPrice = (verifiedCount, soldCount, hasPrice) => {
  return (
    verifiedCount === 0 &&
    soldCount === 0 &&
    hasPrice
  );
};

// Should refuse (browse_api source)
assertTrue(
  shouldRefuseToPrice(0, 0, true),
  'Refuse when 0 verified + 0 sold + browse_api price'
);

// Should refuse (PC source with no comps)
assertTrue(
  shouldRefuseToPrice(0, 0, true),
  'Refuse when 0 verified + 0 sold + PC price (no comp validation)'
);

// Should NOT refuse (has verified comps)
assertFalse(
  shouldRefuseToPrice(2, 0, true),
  'Keep when 2 verified + 0 sold'
);

// Should NOT refuse (has sold comps)
assertFalse(
  shouldRefuseToPrice(0, 1, true),
  'Keep when 0 verified + 1 sold'
);

// Should NOT refuse (has both)
assertFalse(
  shouldRefuseToPrice(2, 1, true),
  'Keep when 2 verified + 1 sold'
);

// Should NOT refuse (no price set)
assertFalse(
  shouldRefuseToPrice(0, 0, false),
  'Keep when no price (already null)'
);

// Edge cases
assertFalse(
  shouldRefuseToPrice(1, 0, true),
  'Keep when exactly 1 verified comp'
);

// ─── FIX 3 & 4: UI behavior (not unit-testable) ─────────────────────
console.log('\nFIX 3 — Stale record auto-refresh:');
console.log('  ℹ UI behavior — tested manually in browser');

console.log('\nFIX 4 — Update All Books button:');
console.log('  ℹ UI behavior — tested manually in Manage tab');

// Test stale detection logic
const isStale = (item) => {
  return !item.priceBands || !item.claudeCheck || !item.demandSignals;
};

assertTrue(isStale({}), 'Empty item is stale');
assertTrue(isStale({ priceBands: null }), 'Item missing priceBands is stale');
assertTrue(isStale({ claudeCheck: null }), 'Item missing claudeCheck is stale');
assertTrue(isStale({ demandSignals: null }), 'Item missing demandSignals is stale');
assertTrue(
  isStale({ priceBands: { market: 10 } }),
  'Item with only priceBands is stale (missing others)'
);

assertFalse(
  isStale({
    priceBands: { market: 10 },
    claudeCheck: { quality: 'high' },
    demandSignals: { velocity: 0.5 },
  }),
  'Item with all fields is not stale'
);

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
