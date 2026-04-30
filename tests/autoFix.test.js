// Ship #20a.6.22 — Autofix engine tests

import { runAutoFix } from '../src/lib/autoFix.js';

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
  console.log('Ship #20a.6.22 — Autofix Engine Tests');
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
// Fix 1: Sold >> Active gap (3× rule)
// ─────────────────────────────────────────────────────────────────

test('Fix 1: soldMedian=400 activeAvg=25 → anchor to sold', () => {
  const item = {
    soldComps: [
      { price: 350 },
      { price: 400 },
      { price: 450 },
    ],
    comps: {
      averageNum: 25,
    },
    gradeMultiplier: 0.5,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('sold-over-active-anchor'), 'should fire sold-over-active-anchor');
  assert(updated.price === '$200.00', `price should be $200.00, got ${updated.price}`);
  assert(updated.priceNote === 'sold-anchor (active comps contaminated)', 'priceNote mismatch');
});

test('Fix 1: soldMedian=100 activeAvg=80 → no anchor (gap < 3×)', () => {
  const item = {
    soldComps: [
      { price: 90 },
      { price: 100 },
      { price: 110 },
    ],
    comps: {
      averageNum: 80,
    },
    gradeMultiplier: 1.0,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('sold-over-active-anchor'), 'should NOT fire');
  assert(updated.price === undefined, 'price should remain unchanged');
});

test('Fix 1: only 1 sold comp → no anchor (need ≥2)', () => {
  const item = {
    soldComps: [{ price: 500 }],
    comps: { averageNum: 50 },
    gradeMultiplier: 1.0,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('sold-over-active-anchor'), 'should NOT fire with 1 sold comp');
});

// ─────────────────────────────────────────────────────────────────
// Fix 2: Wrong issue in active comps
// ─────────────────────────────────────────────────────────────────

test('Fix 2: book=#152 comp="#130" → needsExactIssueRequery', () => {
  const item = {
    issue: '152',
    comps: {
      prices: [
        { title: 'Amazing Spider-Man #130' },
        { title: 'Amazing Spider-Man #131' },
      ],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('wrong-issue-comps'), 'should fire wrong-issue-comps');
  assert(updated.needsExactIssueRequery === true, 'should set needsExactIssueRequery');
});

test('Fix 2: book=#15 comps include #15 → OK', () => {
  const item = {
    issue: '15',
    comps: {
      prices: [
        { title: 'X-Men #14' },
        { title: 'X-Men #15' },
        { title: 'X-Men #16' },
      ],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('wrong-issue-comps'), 'should NOT fire');
  assert(updated.needsExactIssueRequery !== true, 'should not set flag');
});

test('Fix 2: no issue → skip check', () => {
  const item = {
    issue: null,
    comps: {
      prices: [{ title: 'X-Men #14' }],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('wrong-issue-comps'), 'should skip when no issue');
});

// ─────────────────────────────────────────────────────────────────
// Fix 3: Sold/active series mismatch
// ─────────────────────────────────────────────────────────────────

test('Fix 3: sold="Spider-Man" active="Team-Up" → mismatch', () => {
  const item = {
    soldComps: [{ title: 'Amazing Spider-Man #100' }],
    comps: {
      prices: [{ title: 'Marvel Team-Up #50' }],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('sold-active-series-mismatch'), 'should fire mismatch');
  assert(updated.needsSoldRequery === true, 'should set needsSoldRequery');
});

test('Fix 3: sold="Spider-Man" active="Spider-Man" → match', () => {
  const item = {
    soldComps: [{ title: 'Amazing Spider-Man #100' }],
    comps: {
      prices: [{ title: 'Spider-Man #101' }],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('sold-active-series-mismatch'), 'should NOT fire');
  assert(updated.needsSoldRequery !== true, 'should not set flag');
});

test('Fix 3: no sold comps → skip check', () => {
  const item = {
    soldComps: [],
    comps: {
      prices: [{ title: 'X-Men #1' }],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('sold-active-series-mismatch'), 'should skip when no sold');
});

// ─────────────────────────────────────────────────────────────────
// Fix 4: Magazine format
// ─────────────────────────────────────────────────────────────────

test('Fix 4: reason="magazine" → isMagazine=true', () => {
  const item = {
    reason: 'Howard the Duck magazine issue',
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('magazine-format-detected'), 'should fire magazine detection');
  assert(updated.isMagazine === true, 'should set isMagazine');
  assert(updated.needsMagazineRequery === true, 'should set needsMagazineRequery');
});

test('Fix 4: reason="comic book" → not magazine', () => {
  const item = {
    reason: 'Standard comic book format',
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('magazine-format-detected'), 'should NOT fire');
  assert(updated.isMagazine !== true, 'should not set flag');
});

// ─────────────────────────────────────────────────────────────────
// Fix 5: Grade multiplier mismatch
// ─────────────────────────────────────────────────────────────────

test('Fix 5: grade=2.0 mult=0.65 → corrected to 0.45', () => {
  const item = {
    numericGrade: 2.0,
    gradeMultiplier: 0.65,
    price: '$100.00',
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('grade-multiplier-corrected'), 'should fire correction');
  assert(updated.gradeMultiplier === 0.45, `mult should be 0.45, got ${updated.gradeMultiplier}`);
  // price should be adjusted: 100 * (0.45 / 0.65) ≈ 69.23
  const expectedPrice = 100 * (0.45 / 0.65);
  assert(updated.price.includes('69.23'), `price should be ~$69.23, got ${updated.price}`);
});

test('Fix 5: grade=9.4 mult=1.35 → within range, no correction', () => {
  const item = {
    numericGrade: 9.4,
    gradeMultiplier: 1.35,
    price: '$100.00',
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('grade-multiplier-corrected'), 'should NOT fire');
  assert(updated.gradeMultiplier === 1.35, 'mult should remain unchanged');
});

test('Fix 5: grade=0 → skip check', () => {
  const item = {
    numericGrade: 0,
    gradeMultiplier: 0.65,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('grade-multiplier-corrected'), 'should skip when grade=0');
});

// ─────────────────────────────────────────────────────────────────
// Fix 6: Modern contamination on vintage
// ─────────────────────────────────────────────────────────────────

test('Fix 6: year=1941 comp="Action MCU 2024" → filtered', () => {
  const item = {
    year: 1941,
    comps: {
      prices: [
        { title: 'Action Comics #7 1941' },
        { title: 'Action Comics MCU Variant 2024' },
        { title: 'Action Comics #8 1941' },
      ],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('modern-contamination-removed'), 'should fire contamination removal');
  assert(updated.comps.prices.length === 2, `should have 2 comps, got ${updated.comps.prices.length}`);
  assert(!updated.comps.prices.some(c => c.title.includes('MCU')), 'MCU comp should be removed');
});

test('Fix 6: year=2022 comp="MCU 2024" → no filter (modern book)', () => {
  const item = {
    year: 2022,
    comps: {
      prices: [
        { title: 'Amazing Spider-Man MCU 2024' },
      ],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('modern-contamination-removed'), 'should NOT fire for modern book');
  assert(updated.comps.prices.length === 1, 'comps should remain unchanged');
});

test('Fix 6: all comps modern → no filter (would leave empty)', () => {
  const item = {
    year: 1970,
    comps: {
      prices: [
        { title: 'X-Men MCU 2024' },
        { title: 'X-Men Taylor Swift Variant 2025' },
      ],
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('modern-contamination-removed'), 'should NOT filter all comps');
  assert(updated.comps.prices.length === 2, 'should keep all comps when all contaminated');
});

// ─────────────────────────────────────────────────────────────────
// Fix 7: Pre-1985 newsstand penalty removal
// ─────────────────────────────────────────────────────────────────

test('Fix 7: year=1979 newsstand varMult=0.65 → reset 1.0', () => {
  const item = {
    year: 1979,
    variant: 'newsstand',
    variantMultiplier: 0.65,
    price: '$65.00',
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('newsstand-penalty-removed-pre1985'), 'should fire penalty removal');
  assert(updated.variantMultiplier === 1.0, `varMult should be 1.0, got ${updated.variantMultiplier}`);
  // price should be adjusted: 65 / 0.65 = 100
  assert(updated.price === '$100.00', `price should be $100.00, got ${updated.price}`);
});

test('Fix 7: year=1990 newsstand varMult=0.65 → keep penalty (post-1985)', () => {
  const item = {
    year: 1990,
    variant: 'newsstand',
    variantMultiplier: 0.65,
    price: '$65.00',
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('newsstand-penalty-removed-pre1985'), 'should NOT fire for post-1985');
  assert(updated.variantMultiplier === 0.65, 'varMult should remain');
});

test('Fix 7: year=1980 variant="gold" varMult=0.8 → no change (not newsstand)', () => {
  const item = {
    year: 1980,
    variant: 'gold foil',
    variantMultiplier: 0.8,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('newsstand-penalty-removed-pre1985'), 'should NOT fire for non-newsstand');
});

test('Fix 7: year=1980 newsstand varMult=1.3 → no change (premium, not penalty)', () => {
  const item = {
    year: 1980,
    variant: 'newsstand',
    variantMultiplier: 1.3,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('newsstand-penalty-removed-pre1985'), 'should NOT fire for premium mult');
});

// ─────────────────────────────────────────────────────────────────
// Fix 8: Single comp false warning suppression
// ─────────────────────────────────────────────────────────────────

test('Fix 8: comps.count=1 → suppressAboveMarketWarning', () => {
  const item = {
    comps: {
      count: 1,
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('single-comp-warning-suppressed'), 'should fire warning suppression');
  assert(updated.suppressAboveMarketWarning === true, 'should set suppressAboveMarketWarning');
});

test('Fix 8: comps.count=3 → no suppression', () => {
  const item = {
    comps: {
      count: 3,
    },
  };
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('single-comp-warning-suppressed'), 'should NOT fire');
  assert(updated.suppressAboveMarketWarning !== true, 'should not set flag');
});

test('Fix 8: no comps → no suppression', () => {
  const item = {};
  const { updated, fixes } = runAutoFix(item);
  assert(!fixes.includes('single-comp-warning-suppressed'), 'should NOT fire');
});

// ─────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────

test('Empty item → no fixes', () => {
  const item = {};
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.length === 0, `should return 0 fixes, got ${fixes.length}`);
  assert(Object.keys(updated).length === 0, 'updated should be empty');
});

test('Multiple fixes can fire together', () => {
  const item = {
    soldComps: [{ price: 400 }, { price: 500 }],
    comps: { averageNum: 50, count: 1 },
    gradeMultiplier: 0.5,
  };
  const { updated, fixes } = runAutoFix(item);
  assert(fixes.includes('sold-over-active-anchor'), 'fix 1 should fire');
  assert(fixes.includes('single-comp-warning-suppressed'), 'fix 8 should fire');
  assert(fixes.length === 2, `should have 2 fixes, got ${fixes.length}`);
});

run();
