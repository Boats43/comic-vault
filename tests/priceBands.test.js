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
import { verifySoldComps } from '../src/lib/soldVerification.js';

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

// ─────────────────────────────────────────────────────────────────
// EX-A (Q109 greenlight) — variant-fallback tier cap + divergence cap
// ─────────────────────────────────────────────────────────────────
// Row shapes in (a) are drawn from a REAL production casualty captured in
// comic-vault-log-export-2026-07-14T18-53-55.csv, requestId
// 65bqn-1784055155870-a678e4c14ad1 ("Invincible #1" foil variant — 30 raw
// sold rows, 100% variantMismatch, fallback kept 10/30). Titles copied
// verbatim from that request's [sold-reject] lines.

const INVINCIBLE_FOIL_TITLES = [
  'Invincible #1 CGC Graded 9.0 (2003) First Full Appearance 1st Print Image Comics',
  'Image INVINCIBLE #1 CGC 9.0 White Pages 2003 1st Print First Full Appearance 2003',
  'Invincible #1 Cory Walker Cover / Art CGC 9.0 2003',
  'INVINCIBLE #1 CGC 9.0 WHITE PAGES // IMAGE COMICS 2003',
  'Invincible #1 Image Comics 2023 1st Appearance Omni-Man Invincible PSA 9.0',
  'Invincible #1 CGC 9.0 1st Print High Grade! 1st Invincible Omni Man 2003 Image 2003',
  'Invincible 1 Cgc 9.0 Image 2004 1st Print First Prt 2004 #1',
  'INVINCIBLE #1 (2003) CGC 9.0 WHITE PAGES ROBERT KIRKMAN STORY 1ST INVINCIBLE 2003',
];

test('EX-A(a) — 100% variantMismatch fallback pool caps at Tier 2, never Tier 1, regardless of fresh count (real Invincible #1 row shapes)', () => {
  // 8 rows, all within 90d (would-be freshCount=8 under pre-EX-A code —
  // comfortably over the old freshCount>=5 Tier-1 bar), all reject on
  // variantMismatch:user_has_comp_none (no "foil" token in any title).
  const rawRows = INVINCIBLE_FOIL_TITLES.map((title, i) => ({
    price: 1900 + i * 40,
    title,
    daysAgo: 10 + i * 3,
    grade: '9.0',
    year: '2003',
  }));
  const verifyResult = verifySoldComps(rawRows, {
    title: 'invincible', issue: '1', variant: 'foil', bookYear: '2003', userGradeKey: '9.0',
  });
  assert(verifyResult.variantAdjusted === true, 'precondition: fallback fired');
  assert(verifyResult.verified.length > 0, 'precondition: fallback re-admitted rows');

  // No active pool supplied — isolates the tier-cap (change #2) from the
  // divergence cap (change #3), which requires an active anchor to fire.
  const bands = computePriceBands({
    soldComps: verifyResult.verified,
    activeComps: null,
    pcBase: 0,
    gradeMultiplier: 1,
    title: 'invincible',
    issue: '1',
    variant: 'foil',
    variantAdjusted: verifyResult.variantAdjusted,
    soldVerifyResult: verifyResult,
  });

  assert(bands.tier !== 1, `Tier must not be 1, got tier=${bands.tier}`);
  assert(bands.tier === 2, `expected tier=2 (fallback-capped, no active anchor), got tier=${bands.tier}`);
  assert(bands.source !== 'tier1_recency_weighted', `source must not be tier1, got ${bands.source}`);
});

test('EX-A(b) — mixed pool: only variantVerified:false rows excluded from Tier-1 count AND price, real rows untouched', () => {
  // 5 real (variantVerified:true) rows @ $100, all fresh — enough to earn
  // Tier 1 on their own. 4 fallback (variantVerified:false) rows @ $1,
  // also tagged 'fresh', mixed into the SAME soldVerifyResult.verified
  // array. If exclusion only worked at the counting level (not also the
  // weighted-price level), the $1 rows would drag market down to ~$56.
  const realRows = Array.from({ length: 5 }, (_, i) => ({
    price: 100, title: 'Test Comic #1 CGC 9.0', daysAgo: 10 + i,
    recencyBand: 'fresh', variantVerified: true,
  }));
  const fallbackRows = Array.from({ length: 4 }, (_, i) => ({
    price: 1, title: 'Test Comic #1 Wrong Variant CGC 9.0', daysAgo: 5 + i,
    recencyBand: 'fresh', variantVerified: false,
  }));
  const soldVerifyResult = {
    verified: [...realRows, ...fallbackRows],
    variantAdjusted: false, // NOT all-fallback — verifySoldComps never actually
                             // produces a mixed array (all-or-nothing fallback),
                             // this directly unit-tests priceBands.js's own
                             // defensive handling of variantVerified in isolation.
  };

  const bands = computePriceBands({
    soldComps: soldVerifyResult.verified,
    activeComps: null,
    pcBase: 0,
    gradeMultiplier: 1,
    title: 'Test Comic',
    issue: '1',
    variant: null,
    variantAdjusted: false,
    soldVerifyResult,
  });

  assert(bands.tier === 1, `real freshCount=5 should still earn Tier 1, got tier=${bands.tier}`);
  assert(bands.count === 5, `count should reflect only the 5 real rows, got ${bands.count}`);
  assert(bands.market === 100, `market must come from the 5 real $100 rows only, got $${bands.market}`);
  assert(bands.quick === 100, `quick (soldLow) must come from real rows only, got $${bands.quick}`);
});

test('EX-A(c) — divergence cap fires at exactly the I9 threshold (>2x pool avg), not an approximation: 1.99x does not cap', () => {
  // activeAvg=$70 (1 active row). soldPrice=$169 → tier-2 blended market =
  // 169×0.7 + 70×0.3 = $139.30 = activeAvg×1.99 exactly. Must NOT cap.
  const soldVerifyResult = {
    verified: [{ price: 169, title: 'Boundary Test #1 Wrong Variant', daysAgo: 10, recencyBand: 'fresh', variantVerified: false }],
    variantAdjusted: true,
  };
  const bands = computePriceBands({
    soldComps: soldVerifyResult.verified,
    activeComps: { prices: [{ price: 70, title: 'Boundary Test #1 Right Variant' }] },
    pcBase: 0,
    gradeMultiplier: 1,
    title: 'Boundary Test',
    issue: '1',
    variant: 'Right Variant',
    variantAdjusted: true,
    soldVerifyResult,
  });
  assert(bands.market === 139.3, `market should be $139.30 (1.99x activeAvg), got $${bands.market}`);
  assert(!bands.variantFallbackCapped, 'must NOT cap at 1.99x — below the >2x I9 threshold');
  assert(bands.tier === 2, `tier should remain 2 (uncapped), got ${bands.tier}`);
});

test('EX-A(c) — divergence cap fires at exactly the I9 threshold (>2x pool avg): 2.01x caps to active-anchored price', () => {
  // GK-21 (2026-08-07 dispatch) — this fixture was originally a single
  // active comp. Under the new MIN_POOL_FOR_OVERRIDE=3 floor (Bone #1
  // class: a 1-comp pool must not be trusted to override/cap a
  // sold-derived result), a 1-comp active pool no longer reaches the cap
  // logic at all — see the new "GK-21 floor" test below for that case.
  // Widened to 3 active comps (same $70 average, so the 2.01x boundary
  // math this test exists to pin is unchanged) to keep testing the
  // threshold itself, now on a pool large enough to legitimately clear
  // the floor. Deliberately does NOT reuse "Right Variant" in the added
  // comps' titles: isActivePoolVariantConfirmed (priceBands.js:297)
  // would then treat a >=3-comp, >=70%-matching active pool as
  // GK-31/activeAnchoredOverFallbackSold-eligible and route straight to
  // Tier 3 before Tier 2's divergence-cap logic (this test's actual
  // target) ever runs — confirmed by running into that branch directly
  // while drafting this fixture. Same setup otherwise, soldPrice=$171 →
  // blended market = 171×0.7 + 70×0.3 = $140.70 = activeAvg×2.01 exactly.
  // Must cap (I9 fires at price > poolAvg×2, i.e. strictly more than
  // 100% over — $140.70 > $140.00 satisfies that).
  const soldVerifyResult = {
    verified: [{ price: 171, title: 'Boundary Test #1 Wrong Variant', daysAgo: 10, recencyBand: 'fresh', variantVerified: false }],
    variantAdjusted: true,
  };
  const bands = computePriceBands({
    soldComps: soldVerifyResult.verified,
    activeComps: { prices: [
      { price: 70, title: 'Boundary Test #1 Standard Cover' },
      { price: 70, title: 'Boundary Test #1 Standard Cover' },
      { price: 70, title: 'Boundary Test #1 Standard Cover' },
    ] },
    pcBase: 0,
    gradeMultiplier: 1,
    title: 'Boundary Test',
    issue: '1',
    variant: 'Right Variant',
    variantAdjusted: true,
    soldVerifyResult,
  });
  assert(bands.variantFallbackCapped === true, 'must cap at 2.01x — above the >2x I9 threshold, with a pool large enough to clear MIN_POOL_FOR_OVERRIDE');
  assert(bands.market === 70, `capped market should equal activeAvg $70.00, got $${bands.market}`);
  assert(bands.quick === 59.5, `capped quick should be activeAvg×0.85=$59.50, got $${bands.quick}`);
  assert(bands.stretch === 80.5, `capped stretch should be activeAvg×1.15=$80.50, got $${bands.stretch}`);
  assert(bands.tier === 3, `capped tier should be max(2,3)=3, got ${bands.tier}`);
  assert(bands.source === 'variant_fallback_capped', `source should be variant_fallback_capped, got ${bands.source}`);
});

test('GK-21 (2026-08-07) — a 1-comp active pool must NOT cap/override a sold-derived result, even at a huge divergence ratio', () => {
  // Same $171 sold price / $70 active price as the fixture above (2.01x,
  // previously capped) but with only 1 active comp instead of 3. Confirms
  // applyVariantFallbackDivergenceCap's MIN_POOL_FOR_OVERRIDE=3 floor
  // (priceBands.js:423) actually gates the cap — this is the exact
  // shape of the GK-21 defect (a single active listing overriding 28
  // solds in production) reproduced at unit scale.
  const soldVerifyResult = {
    verified: [{ price: 171, title: 'Boundary Test #1 Wrong Variant', daysAgo: 10, recencyBand: 'fresh', variantVerified: false }],
    variantAdjusted: true,
  };
  const bands = computePriceBands({
    soldComps: soldVerifyResult.verified,
    activeComps: { prices: [{ price: 70, title: 'Boundary Test #1 Right Variant' }] },
    pcBase: 0,
    gradeMultiplier: 1,
    title: 'Boundary Test',
    issue: '1',
    variant: 'Right Variant',
    variantAdjusted: true,
    soldVerifyResult,
  });
  assert(!bands.variantFallbackCapped, 'a 1-comp active pool must not cap — below MIN_POOL_FOR_OVERRIDE regardless of divergence ratio');
  assert(bands.market === 140.7, `market should stay the uncapped 2.01x blend $140.70, got $${bands.market}`);
  assert(bands.tier === 2, `tier should stay 2 (uncapped) with a thin active pool, got ${bands.tier}`);
});

test('EX-A(d) — regression: normal Tier-1 pool (zero variantMismatch rejections) produces the pre-EX-A exact expected output', () => {
  // Deterministic snapshot of the untouched normal path — same shape as
  // the pre-fix behavior (5 identical, uniformly-fresh, fully title/issue/
  // variant-matched sold rows, no rejections, no fallback). If this ever
  // drifts, a future edit to the tier-1/tier-selection path broke the
  // normal (non-fallback) case that EX-A was required to leave untouched.
  const rawRows = Array.from({ length: 5 }, (_, i) => ({
    price: 500, title: 'Regression Comic #1 CGC 9.4', daysAgo: 10 + i, grade: '9.4', year: '2020',
  }));
  const verifyResult = verifySoldComps(rawRows, {
    title: 'Regression Comic', issue: '1', variant: null, bookYear: '2020', userGradeKey: '9.4',
  });
  assert(!verifyResult.variantAdjusted, 'precondition: normal path, no fallback');
  assert(verifyResult.verified.length === 5, `precondition: all 5 rows verified, got ${verifyResult.verified.length}`);
  assert(verifyResult.verified.every(r => r.variantVerified === true), 'precondition: all rows tagged variantVerified:true');

  const bands = computePriceBands({
    soldComps: verifyResult.verified,
    activeComps: null,
    pcBase: 0,
    gradeMultiplier: 1,
    title: 'Regression Comic',
    issue: '1',
    variant: null,
    variantAdjusted: verifyResult.variantAdjusted,
    soldVerifyResult: verifyResult,
  });

  assert(bands.tier === 1, `expected tier=1, got ${bands.tier}`);
  assert(bands.source === 'tier1_recency_weighted', `expected tier1_recency_weighted, got ${bands.source}`);
  assert(bands.market === 500, `expected market=$500.00, got $${bands.market}`);
  assert(bands.quick === 500, `expected quick=$500.00, got $${bands.quick}`);
  assert(bands.stretch === 575, `expected stretch=$575.00 (500×1.15), got $${bands.stretch}`);
  assert(bands.count === 5, `expected count=5, got ${bands.count}`);
  assert(!bands.variantFallbackCapped, 'normal path must never carry variantFallbackCapped');
});

// Run all tests
run();
