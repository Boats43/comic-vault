// Unit tests for Ship #14 — price-engine sanity recalibration.
//
// Fix 4.1: compsAvg gate dropped from > 5 to > 1. Closes Bug 1
// (modern overpricing when avg < $5 — Deadpool/Wolverine #2, ASM Extra! #1).
//
// Fix 4.3: Silver/Bronze (1970–1984) low-side threshold 0.5× → 0.6×.
// Closes Bug 2 (Silver Age key underpricing — FF #61 at ratio 0.53).
//
// Unchanged:
//   - Modern high-side (1.5×), Modern low-side (0.5×)
//   - Golden high-side (3.0×), Golden low-side (0.5×)
//   - lowCompsCount / isMixedFallback → 1.25× high
//
// Invoke: node tests/sanity-thresholds.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { computeSanityFallback } from '../api/enrich.js';

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

const assertFire = (result, shouldFire, label) => {
  if (result && result.shouldFire === shouldFire) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: fire=${shouldFire}\n    actual:   ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const nearly = (a, b, tol = 0.01) => Math.abs(a - b) < tol;
const assertNear = (actual, expected, label, tol = 0.01) => {
  if (typeof actual === 'number' && nearly(actual, expected, tol)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ≈${expected}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #14 — SANITY THRESHOLD RECALIBRATION ===\n');

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof computeSanityFallback, 'function', 'computeSanityFallback exported');
assertNull(
  computeSanityFallback(undefined, undefined),
  'no-args → null'
);
assertNull(
  computeSanityFallback(0, 0),
  'zero pcNum and compsAvg → null'
);

// ─── Fix 4.1: Drop compsAvg > 5 gate ────────────────────────────────
console.log('\nFix 4.1 — compsAvg > 1 gate (was > 5):');

// Previously this compsAvg would have been gated out entirely.
// Now it runs through threshold logic.
assertFire(
  computeSanityFallback(9.81, 3.54, { bookYear: 2024, lowCompsCount: false, isMixedFallback: false }),
  'high',
  'DP/Wolverine #2 (2024, $9.81 vs $3.54) — modern 1.5× fires now that $5 gate is gone'
);
assertFire(
  computeSanityFallback(11.00, 4.83, { bookYear: 2008, lowCompsCount: false, isMixedFallback: false }),
  'high',
  'ASM Extra! #1 (2008, $11 vs $4.83) — modern 1.5× fires'
);

// Floor below $1 still skipped for null safety.
assertNull(
  computeSanityFallback(3.0, 0.50, { bookYear: 2020 }),
  'compsAvg=$0.50 (below $1 floor) → null'
);
assertNull(
  computeSanityFallback(3.0, 1.0, { bookYear: 2020 }),
  'compsAvg=$1.00 (not > 1) → null'
);

// Just above $1 gate now runs.
const justAboveGate = computeSanityFallback(10, 1.01, { bookYear: 2020 });
assertFire(justAboveGate, 'high', 'compsAvg=$1.01 (just above gate) → runs, fires high');

// Null / undefined compsAvg always skips.
assertNull(computeSanityFallback(10, null, { bookYear: 2020 }), 'null compsAvg → null');
assertNull(computeSanityFallback(10, undefined, { bookYear: 2020 }), 'undefined compsAvg → null');

// Null / zero pcNum always skips.
assertNull(computeSanityFallback(null, 10, { bookYear: 2020 }), 'null pcNum → null');
assertNull(computeSanityFallback(0, 10, { bookYear: 2020 }), 'zero pcNum → null');

// ─── Bug 1 — Modern overpricing cases ───────────────────────────────
console.log('\nBug 1 — Modern overpricing fires correctly:');

// DP/Wolverine #2: $9.81 > 3.54 × 1.5 = $5.31 → high fires, fallback = 3.54 × 1.15 ≈ $4.07
const dpw = computeSanityFallback(9.81, 3.54, { bookYear: 2024, lowCompsCount: false, isMixedFallback: false });
assertFire(dpw, 'high', 'DP/Wolverine #2 → high');
assertNear(dpw.fallbackPrice, 3.54 * 1.15, 'DP/Wolverine #2 fallbackPrice = compsAvg × 1.15');
assertEq(dpw.priceNote, 'PC outlier — eBay avg used', 'DP/Wolverine #2 priceNote');

// ASM Extra! #1: $11 > 4.83 × 1.5 = $7.24 → high fires, fallback = 4.83 × 1.15 ≈ $5.55
const asmExtra = computeSanityFallback(11.00, 4.83, { bookYear: 2008, lowCompsCount: false, isMixedFallback: false });
assertFire(asmExtra, 'high', 'ASM Extra! #1 → high');
assertNear(asmExtra.fallbackPrice, 4.83 * 1.15, 'ASM Extra! #1 fallbackPrice');

// ─── Bug 2 — Silver Age key underpricing ────────────────────────────
console.log('\nBug 2 — Silver/Bronze low-side 0.6× (Fix 4.3):');

// FF #61: $17.86 < 33.99 × 0.6 = $20.39 → low fires, fallback = $33.99
const ff61 = computeSanityFallback(17.86, 33.99, { bookYear: 1967, lowCompsCount: false, isMixedFallback: false });
assertFire(ff61, 'low', 'FF #61 (1967, $17.86 vs $33.99, ratio 0.53) → low');
assertNear(ff61.fallbackPrice, 33.99, 'FF #61 fallbackPrice = compsAvg (no uplift on low)');
assertEq(ff61.priceNote, 'PC too low — eBay avg used', 'FF #61 priceNote');

// Would NOT have fired at old 0.5× threshold (0.53 > 0.50):
// Reasonable guard — sanity check: 0.53 < 0.60, so at new 0.60× it fires.
// Old threshold would have required pcNum < 33.99 × 0.5 = $17.00;
// $17.86 > $17.00 → old threshold misses. Confirmed by firing now.

// Bronze boundary: 1984 Silver/Bronze threshold 0.6×.
const bronze1984 = computeSanityFallback(10, 20, { bookYear: 1984 });
assertFire(bronze1984, 'low', '1984 at ratio 0.50 → low fires (0.6× threshold)');

// Silver community start — 1956 boundary.
assertNull(
  computeSanityFallback(6.00, 10, { bookYear: 1956 }),
  '1956 at exact ratio 0.60 → null (not strictly less than)'
);
assertFire(
  computeSanityFallback(5.99, 10, { bookYear: 1956 }),
  'low',
  '1956 at ratio 0.599 → low fires'
);
// Just below 1956 boundary: pre-Silver / true Golden → 0.5× low-side.
assertNull(
  computeSanityFallback(5.99, 10, { bookYear: 1955 }),
  '1955 (pre-Silver / true Golden) at ratio 0.599 → null at 0.5× low-side'
);
assertFire(
  computeSanityFallback(4.99, 10, { bookYear: 1955 }),
  'low',
  '1955 at ratio 0.499 → low fires at Golden 0.5×'
);

// ─── Era boundaries — high-side ─────────────────────────────────────
console.log('\nEra boundaries — high-side:');

// Year 1969 → Golden → 3×
assertNull(
  computeSanityFallback(29, 10, { bookYear: 1969 }),
  '1969 (Golden) $29 vs $10 (ratio 2.9) → null at 3× threshold'
);
assertFire(
  computeSanityFallback(31, 10, { bookYear: 1969 }),
  'high',
  '1969 (Golden) $31 vs $10 (ratio 3.1) → high fires at 3×'
);

// Year 1970 → Silver → 1.75×
assertFire(
  computeSanityFallback(18, 10, { bookYear: 1970 }),
  'high',
  '1970 (Silver) $18 vs $10 (ratio 1.8) → high fires at 1.75×'
);
assertNull(
  computeSanityFallback(17, 10, { bookYear: 1970 }),
  '1970 (Silver) $17 vs $10 (ratio 1.7) → null at 1.75×'
);

// Year 1984 → still Silver/Bronze → 1.75×
assertFire(
  computeSanityFallback(18, 10, { bookYear: 1984 }),
  'high',
  '1984 (Bronze) $18 vs $10 → high fires at 1.75×'
);

// Year 1985 → Modern → 1.5×
assertFire(
  computeSanityFallback(16, 10, { bookYear: 1985 }),
  'high',
  '1985 (Modern) $16 vs $10 (ratio 1.6) → high fires at 1.5×'
);
assertNull(
  computeSanityFallback(14, 10, { bookYear: 1985 }),
  '1985 (Modern) $14 vs $10 (ratio 1.4) → null at 1.5×'
);

// ─── Era boundaries — low-side ──────────────────────────────────────
console.log('\nEra boundaries — low-side:');

// 1969 — engine's high-side still calls this Golden (3×), but low-side
// now treats it as Silver (>=1956 && <1985 → 0.6×).
assertFire(
  computeSanityFallback(5.99, 10, { bookYear: 1969 }),
  'low',
  '1969 $5.99 vs $10 (ratio 0.599) → low fires at Silver low 0.6× (FF #61 class)'
);
assertNull(
  computeSanityFallback(6.01, 10, { bookYear: 1969 }),
  '1969 $6.01 vs $10 (ratio 0.601) → null at Silver 0.6×'
);

// True Golden (pre-1956) — 0.5× preserved.
assertFire(
  computeSanityFallback(4, 10, { bookYear: 1940 }),
  'low',
  '1940 (true Golden) $4 vs $10 (ratio 0.4) → low fires at 0.5×'
);
assertNull(
  computeSanityFallback(5.01, 10, { bookYear: 1940 }),
  '1940 (true Golden) $5.01 vs $10 (ratio 0.501) → null at 0.5×'
);

// Silver (1970) → 0.6× (Fix 4.3)
assertFire(
  computeSanityFallback(5.5, 10, { bookYear: 1970 }),
  'low',
  '1970 (Silver) $5.50 vs $10 (ratio 0.55) → low fires at 0.6×'
);
// Old 0.5× would have rejected; new 0.6× accepts.

// Bronze (1984) → 0.6×
assertFire(
  computeSanityFallback(5.5, 10, { bookYear: 1984 }),
  'low',
  '1984 (Bronze) $5.50 vs $10 (ratio 0.55) → low fires at 0.6×'
);

// Modern (1985) → 0.5× (unchanged)
assertNull(
  computeSanityFallback(5.5, 10, { bookYear: 1985 }),
  '1985 (Modern) $5.50 vs $10 (ratio 0.55) → null at 0.5×'
);
assertFire(
  computeSanityFallback(4.9, 10, { bookYear: 1985 }),
  'low',
  '1985 (Modern) $4.90 vs $10 (ratio 0.49) → low fires at 0.5×'
);

// ─── lowCompsCount + isMixedFallback behavior pinned ────────────────
console.log('\nlowCompsCount / isMixedFallback → 1.25× (pinned):');

// lowCompsCount dominates era.
assertFire(
  computeSanityFallback(13, 10, { bookYear: 2020, lowCompsCount: true }),
  'high',
  'lowCompsCount=true, modern, $13 vs $10 (ratio 1.3) → high fires at 1.25×'
);
// At modern 1.5×, 1.3 would NOT fire. Pinned: lowCompsCount tightens.

assertFire(
  computeSanityFallback(13, 10, { bookYear: 2020, isMixedFallback: true }),
  'high',
  'isMixedFallback=true, modern, $13 vs $10 → high fires at 1.25×'
);

// lowCompsCount wins over era even for Golden.
assertFire(
  computeSanityFallback(13, 10, { bookYear: 1960, lowCompsCount: true }),
  'high',
  'lowCompsCount=true, Golden, $13 vs $10 → high fires at 1.25× (overrides Golden 3×)'
);

// ─── Regression pins — production books that must STAY unchanged ────
console.log('\nRegression pins — known books stay unchanged:');

// Avengers #20 (2025) NM 9.4 post-Ship-#11: $3.19 after modern damping.
// Assume typical modern comp avg matches PC × 1.35 closely → no fire.
// We test: pcNum=3.19, compsAvg=3.00 (realistic close alignment). Ratio 1.06.
assertNull(
  computeSanityFallback(3.19, 3.00, { bookYear: 2025 }),
  'Avengers #20 (2025) — PC×mult ≈ comps avg, no sanity fire'
);

// Biker Mice #1 (2024) thin pool — count=1 triggers lowCompsCount.
// Ship #13.1 thin-pool anchor catches this downstream. Here: sanity fires
// at 1.25× lowCompsCount threshold IF ratio > 1.25. Biker Mice: $8.23 vs
// $7.16 avg (ratio 1.15) → null (below lowCompsCount 1.25×).
assertNull(
  computeSanityFallback(8.23, 7.16, { bookYear: 2024, lowCompsCount: true }),
  'Biker Mice #1 (thin pool, ratio 1.15) → null at 1.25× — thin-pool anchor handles this'
);

// FF #52 (1966) — Silver Age, clean PC. Typical: PC × 0.85 ≈ comps.
// Ratio near 1.0 should not fire.
assertNull(
  computeSanityFallback(300, 295, { bookYear: 1966 }),
  'FF #52 (Silver clean) — PC ≈ comps, no fire'
);

// Dark Horse #1 (1992) VF+ 8.5 post-Ship-#11 modern damping.
assertNull(
  computeSanityFallback(6.72, 5.80, { bookYear: 1992 }),
  'Dark Horse #1 (1992 modern, ratio 1.16) → null at modern 1.5×'
);

// ─── Null / undefined year handling ─────────────────────────────────
console.log('\nNull / undefined / invalid year → vintage default:');

// Null year → year=0 → 0 < 1970 → Golden (3× high, 0.5× low).
assertNull(
  computeSanityFallback(18, 10, { bookYear: null }),
  'null year $18 vs $10 (ratio 1.8) → null at Golden 3× threshold'
);
assertFire(
  computeSanityFallback(31, 10, { bookYear: null }),
  'high',
  'null year $31 vs $10 (ratio 3.1) → high fires at Golden 3× threshold'
);
assertNull(
  computeSanityFallback(5.5, 10, { bookYear: null }),
  'null year $5.50 vs $10 (ratio 0.55) → null at Golden 0.5× threshold'
);

// Undefined / empty string / garbage year.
assertFire(
  computeSanityFallback(31, 10, { bookYear: undefined }),
  'high',
  'undefined year → Golden default, fires at 3.1 ratio'
);
assertFire(
  computeSanityFallback(31, 10, { bookYear: '' }),
  'high',
  'empty-string year → Golden default'
);
assertFire(
  computeSanityFallback(31, 10, { bookYear: 'garbage' }),
  'high',
  'non-numeric year → parseInt NaN → Golden default'
);

// String-year numeric input.
assertFire(
  computeSanityFallback(16, 10, { bookYear: '1985' }),
  'high',
  'string-year "1985" → Modern 1.5×, fires at ratio 1.6'
);

// ─── opts-missing graceful defaults ─────────────────────────────────
console.log('\nMissing opts graceful defaults:');

// No opts at all — defaults year=0 → Golden, flags falsy.
assertFire(
  computeSanityFallback(31, 10),
  'high',
  'no opts → year=0 (Golden), fires at 3× threshold'
);
assertNull(
  computeSanityFallback(18, 10),
  'no opts → Golden 3× threshold, ratio 1.8 doesn\'t fire'
);

// Empty opts object.
assertFire(
  computeSanityFallback(31, 10, {}),
  'high',
  'empty opts → Golden default'
);

// ─── Return shape ───────────────────────────────────────────────────
console.log('\nReturn shape:');

const highShape = computeSanityFallback(20, 10, { bookYear: 2020 });
assertEq(highShape.shouldFire, 'high', 'high shape: shouldFire');
assertEq(typeof highShape.fallbackPrice, 'number', 'high shape: fallbackPrice is number');
assertEq(typeof highShape.fallbackPriceLow, 'number', 'high shape: fallbackPriceLow is number');
assertEq(typeof highShape.fallbackPriceHigh, 'number', 'high shape: fallbackPriceHigh is number');
assertEq(typeof highShape.threshold, 'number', 'high shape: threshold is number');
assertEq(typeof highShape.thresholdMult, 'number', 'high shape: thresholdMult is number');
assertEq(typeof highShape.priceNote, 'string', 'high shape: priceNote is string');
assertEq(highShape.thresholdMult, 1.5, 'high shape: thresholdMult reflects modern 1.5×');
assertNear(highShape.fallbackPrice, 10 * 1.15, 'high shape: fallbackPrice = compsAvg × 1.15');

const lowShape = computeSanityFallback(4, 10, { bookYear: 1980 });
assertEq(lowShape.shouldFire, 'low', 'low shape: shouldFire');
assertEq(lowShape.thresholdMult, 0.6, 'low shape: thresholdMult = 0.6 for Silver/Bronze');
assertNear(lowShape.fallbackPrice, 10, 'low shape: fallbackPrice = compsAvg (no uplift)');
assertEq(lowShape.priceNote, 'PC too low — eBay avg used', 'low shape: priceNote');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
