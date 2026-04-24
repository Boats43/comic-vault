// Unit tests for Ship #17 — FR-LOW-GRADE-FLOOR.
//
// Helper: computeLowGradeFloor(currentPrice, rawComps, pop, opts)
//   Fires when bottom-of-census + browse_api pricing + comp.lowest > 0
//   + currentPrice > comp.lowest. Re-anchors to comp.lowest.
//
// Conservative gate: only when pricingSource === 'browse_api'. PC ×
// grade-mult outputs preserved. JLA #62 class still caught (sanity LOW
// fired = browse_api source).
//
// Invoke: node tests/low-grade-floor.test.js
// Exit: 0 all-pass, 1 any failure.

import { computeLowGradeFloor } from '../api/enrich.js';

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

const assertNull = (actual, label) => assertEq(actual, null, label);

const assertFires = (result, expectedAnchor, label) => {
  if (result && result.shouldAnchor === true && result.anchor === expectedAnchor) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: { anchor: ${expectedAnchor}, shouldAnchor: true }\n    actual:   ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #17 — LOW-GRADE FLOOR ANCHOR ===\n');

// Reusable fixture: bottom-of-census condition.
const browsePricing = { pricingSource: 'browse_api' };
const popBottom = { total: 65, belowGrade: 0, atGrade: 1, aboveGrade: 64 };
const compsCheap = { lowest: 8 };

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof computeLowGradeFloor, 'function', 'computeLowGradeFloor exported');
assertNull(computeLowGradeFloor(), 'no-args → null');
assertNull(computeLowGradeFloor(0, null, null), 'all-null → null');

// ─── Bottom-of-census fires (JLA #62 fixture) ────────────────────────
console.log('\nBottom-of-census fires:');

// JLA #62 (1968) GD 2.0 — sanity LOW fired, lifted to compsAvg=$30,
// pop says belowGrade=0. Re-anchor to comp.lowest=$8.
assertFires(
  computeLowGradeFloor(30, compsCheap, popBottom, browsePricing),
  8,
  'JLA #62 fixture ($30 vs comp.lowest $8) → fires anchor=$8'
);

// Different anchor amounts.
assertFires(
  computeLowGradeFloor(50, { lowest: 5 }, popBottom, browsePricing),
  5,
  '$50 → comp.lowest $5 → fires anchor=$5'
);

// Single-copy census (atGrade=1, above=0, below=0) → user IS the floor.
assertFires(
  computeLowGradeFloor(20, { lowest: 6 }, { total: 1, belowGrade: 0, atGrade: 1, aboveGrade: 0 }, browsePricing),
  6,
  'single-copy census → fires anchor=$6'
);

// Large gap (rare, but valid).
assertFires(
  computeLowGradeFloor(100, { lowest: 5 }, popBottom, browsePricing),
  5,
  'large gap $100 → $5 → fires (correct conservative direction)'
);

// User grade below entire census (user CGC 1.0 in CGC-4+ tracked book).
assertFires(
  computeLowGradeFloor(15, { lowest: 4 }, { total: 50, belowGrade: 0, atGrade: 0, aboveGrade: 50 }, browsePricing),
  4,
  'user grade entirely below census → still belowGrade=0, fires'
);

// ─── Q1 conservative gate — pricingSource must be browse_api ────────
console.log('\nConservative gate — pricingSource gate:');

assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, { pricingSource: 'pricecharting' }),
  'pricingSource=pricecharting → null (calibration preserved)'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, { pricingSource: undefined }),
  'pricingSource undefined → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, { pricingSource: null }),
  'pricingSource null → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, {}),
  'no pricingSource opt → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, { pricingSource: 'fallback' }),
  'pricingSource=other-string → null'
);

// ─── Skip flags (matches existing helper pattern) ───────────────────
console.log('\nSkip flags:');

assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, { ...browsePricing, isMegaKey: true }),
  'isMegaKey → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, popBottom, { ...browsePricing, compsExhausted: true }),
  'compsExhausted → null'
);

// ─── Pop data variations ────────────────────────────────────────────
console.log('\nPop data variations:');

assertNull(
  computeLowGradeFloor(30, compsCheap, null, browsePricing),
  'pop null → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, undefined, browsePricing),
  'pop undefined → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, { total: 0, belowGrade: null }, browsePricing),
  'pop.total=0 → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, { total: 65, belowGrade: 1 }, browsePricing),
  'pop.belowGrade=1 (mid-census) → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, { total: 65, belowGrade: 100 }, browsePricing),
  'pop.belowGrade=100 (top-of-census) → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, { total: 65, belowGrade: null }, browsePricing),
  'pop.belowGrade=null → null'
);
assertNull(
  computeLowGradeFloor(30, compsCheap, { total: 65, belowGrade: undefined }, browsePricing),
  'pop.belowGrade=undefined → null'
);

// belowGrade exactly 0 must fire — strict equality on the integer.
assertFires(
  computeLowGradeFloor(30, compsCheap, { total: 65, belowGrade: 0 }, browsePricing),
  8,
  'pop.belowGrade exactly 0 → fires'
);

// ─── rawComps variations ────────────────────────────────────────────
console.log('\nrawComps variations:');

assertNull(
  computeLowGradeFloor(30, null, popBottom, browsePricing),
  'rawComps null → null'
);
assertNull(
  computeLowGradeFloor(30, undefined, popBottom, browsePricing),
  'rawComps undefined → null'
);
assertNull(
  computeLowGradeFloor(30, { lowest: 0 }, popBottom, browsePricing),
  'rawComps.lowest=0 → null'
);
assertNull(
  computeLowGradeFloor(30, { lowest: null }, popBottom, browsePricing),
  'rawComps.lowest=null → null'
);
assertNull(
  computeLowGradeFloor(30, { lowest: -5 }, popBottom, browsePricing),
  'rawComps.lowest negative → null'
);
assertNull(
  computeLowGradeFloor(30, {}, popBottom, browsePricing),
  'rawComps with no lowest field → null'
);

// ─── currentPrice variations ────────────────────────────────────────
console.log('\ncurrentPrice variations:');

assertNull(
  computeLowGradeFloor(0, compsCheap, popBottom, browsePricing),
  'currentPrice=0 → null'
);
assertNull(
  computeLowGradeFloor(null, compsCheap, popBottom, browsePricing),
  'currentPrice=null → null'
);
assertNull(
  computeLowGradeFloor(undefined, compsCheap, popBottom, browsePricing),
  'currentPrice=undefined → null'
);
assertNull(
  computeLowGradeFloor(NaN, compsCheap, popBottom, browsePricing),
  'currentPrice=NaN → null'
);
assertNull(
  computeLowGradeFloor(-10, compsCheap, popBottom, browsePricing),
  'currentPrice negative → null'
);
assertNull(
  computeLowGradeFloor('30', compsCheap, popBottom, browsePricing),
  'currentPrice string (not number) → null'
);

// ─── Already at/below floor — skip ──────────────────────────────────
console.log('\ncurrentPrice <= comp.lowest — skip (already at/below):');

assertNull(
  computeLowGradeFloor(8, compsCheap, popBottom, browsePricing),
  'currentPrice = comp.lowest exactly → null'
);
assertNull(
  computeLowGradeFloor(7.99, compsCheap, popBottom, browsePricing),
  'currentPrice just below comp.lowest → null'
);
assertNull(
  computeLowGradeFloor(5, compsCheap, popBottom, browsePricing),
  'currentPrice well below comp.lowest → null'
);
// Just above fires.
assertFires(
  computeLowGradeFloor(8.01, compsCheap, popBottom, browsePricing),
  8,
  'currentPrice just above comp.lowest → fires'
);

// ─── Return shape ───────────────────────────────────────────────────
console.log('\nReturn shape:');

const shape = computeLowGradeFloor(30, compsCheap, popBottom, browsePricing);
assertEq(typeof shape, 'object', 'returns object on fire');
assertEq(typeof shape.anchor, 'number', 'anchor is number');
assertEq(shape.shouldAnchor, true, 'shouldAnchor is true');
assertEq(shape.anchor, 8, 'anchor matches comp.lowest');

// ─── Numeric coercion for rawComps.lowest ───────────────────────────
console.log('\nNumeric coercion:');

assertFires(
  computeLowGradeFloor(30, { lowest: '8' }, popBottom, browsePricing),
  8,
  'rawComps.lowest as string "8" → coerced via Number(), fires'
);
assertNull(
  computeLowGradeFloor(30, { lowest: 'garbage' }, popBottom, browsePricing),
  'rawComps.lowest non-numeric string → null'
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
