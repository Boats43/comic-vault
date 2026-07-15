// Ship #25 — Velocity Curves + Dynamic Pricing Tests
//
// Tests sales velocity analysis and dynamic pricing recommendations.
//
// Invoke: node tests/ship25-velocity.test.js

import {
  getUserGradeVelocity,
  classifyVelocityTier,
  getPricingRecommendation,
  analyzeVelocity,
  getVelocityColor,
} from '../src/lib/velocityAnalyzer.js';

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
const assertNotNull = (actual, label) => {
  if (actual != null) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: not null\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #25 — VELOCITY CURVES + DYNAMIC PRICING ===\n');

// ─── getUserGradeVelocity ───────────────────────────────────────
console.log('getUserGradeVelocity:');

// Q-audit COMMIT 3 — keys match pricecharting-pop.js's real formatGradeKey
// output ("9.8"/"9.4"/"raw"), not the "cgc98"/"cgc94" shape this fixture
// used before the bug fix (that shape never existed on a real response).
const mockVelocity = {
  '9.8': { label: '2.3 per week', perDay: 0.33 },
  '9.4': { label: '1.1 per month', perDay: 0.037 },
  raw: { label: '0.8 per month', perDay: 0.027 },
};

const cgc98 = getUserGradeVelocity(mockVelocity, 9.8);
assertEq(cgc98?.perDay, 0.33, 'CGC 9.8 → perDay 0.33');
assertEq(cgc98?.label, '2.3 per week', 'CGC 9.8 → label correct');

const cgc94 = getUserGradeVelocity(mockVelocity, 9.4);
assertEq(cgc94?.perDay, 0.037, 'CGC 9.4 → perDay 0.037');

const raw = getUserGradeVelocity(mockVelocity, 'raw');
assertEq(raw?.perDay, 0.027, 'raw → perDay 0.027');

const missing = getUserGradeVelocity(mockVelocity, 8.0);
assertEq(missing, null, 'Missing grade → null');

const noData = getUserGradeVelocity(null, 9.8);
assertEq(noData, null, 'null salesVelocity → null');

// ─── classifyVelocityTier ──────────────────────────────────────
console.log('\nclassifyVelocityTier:');

assertEq(classifyVelocityTier(0.5), 'HOT', '0.5/day → HOT (> 0.4)');
assertEq(classifyVelocityTier(0.4), 'HOT', '0.4/day → HOT (boundary)');
assertEq(classifyVelocityTier(0.3), 'FAST', '0.3/day → FAST');
assertEq(classifyVelocityTier(0.15), 'FAST', '0.15/day → FAST (boundary)');
assertEq(classifyVelocityTier(0.1), 'NORMAL', '0.1/day → NORMAL');
assertEq(classifyVelocityTier(0.05), 'NORMAL', '0.05/day → NORMAL (boundary)');
assertEq(classifyVelocityTier(0.03), 'SLOW', '0.03/day → SLOW');
assertEq(classifyVelocityTier(0.02), 'SLOW', '0.02/day → SLOW (boundary)');
assertEq(classifyVelocityTier(0.01), 'THIN', '0.01/day → THIN (< 0.02)');
assertEq(classifyVelocityTier(0), 'UNKNOWN', '0/day → UNKNOWN');
assertEq(classifyVelocityTier(null), 'UNKNOWN', 'null → UNKNOWN');

// ─── getPricingRecommendation ──────────────────────────────────
console.log('\ngetPricingRecommendation:');

const hotRec = getPricingRecommendation('HOT');
assertEq(hotRec.recommendedBand, 'stretch', 'HOT → stretch band');
assertEq(hotRec.multiplier, 1.0, 'HOT → 1.0 multiplier (stretch is already premium)');
assertEq(hotRec.urgency, 'HIGH', 'HOT → HIGH urgency');
assertNotNull(hotRec.reason, 'HOT → reason provided');

const fastRec = getPricingRecommendation('FAST');
assertEq(fastRec.recommendedBand, 'market', 'FAST → market band');
assertEq(fastRec.multiplier, 1.05, 'FAST → 1.05 multiplier (+5%)');
assertEq(fastRec.urgency, 'MEDIUM', 'FAST → MEDIUM urgency');

const normalRec = getPricingRecommendation('NORMAL');
assertEq(normalRec.recommendedBand, 'market', 'NORMAL → market band');
assertEq(normalRec.multiplier, 1.0, 'NORMAL → 1.0 multiplier');
assertEq(normalRec.urgency, 'NONE', 'NORMAL → NONE urgency');

const slowRec = getPricingRecommendation('SLOW');
assertEq(slowRec.recommendedBand, 'market', 'SLOW → market band');
assertEq(slowRec.multiplier, 1.0, 'SLOW → 1.0 multiplier');

const thinRec = getPricingRecommendation('THIN');
assertEq(thinRec.recommendedBand, 'quick', 'THIN → quick band');
assertEq(thinRec.multiplier, 0.95, 'THIN → 0.95 multiplier (-5%)');
assertEq(thinRec.urgency, 'LOW', 'THIN → LOW urgency');

const unknownRec = getPricingRecommendation('UNKNOWN');
assertEq(unknownRec.recommendedBand, 'market', 'UNKNOWN → market band');
assertEq(unknownRec.multiplier, 1.0, 'UNKNOWN → 1.0 multiplier');

// ─── analyzeVelocity ───────────────────────────────────────────
console.log('\nanalyzeVelocity:');

const hotAnalysis = analyzeVelocity({
  salesVelocity: { '9.8': { label: '15 per month', perDay: 0.5 } },
  userGrade: 9.8,
  priceBands: { quick: 850, market: 920, stretch: 1050 },
});

assertTrue(hotAnalysis.hasData, 'HOT analysis → hasData true');
assertEq(hotAnalysis.tier, 'HOT', 'HOT analysis → tier HOT');
assertEq(hotAnalysis.perDay, 0.5, 'HOT analysis → perDay 0.5');
assertEq(hotAnalysis.recommendation.recommendedBand, 'stretch', 'HOT analysis → stretch band');
assertEq(hotAnalysis.recommendation.recommendedPrice, 1050, 'HOT analysis → price = stretch (1050)');
assertNotNull(hotAnalysis.summary, 'HOT analysis → summary provided');

const normalAnalysis = analyzeVelocity({
  salesVelocity: { raw: { label: '2 per month', perDay: 0.067 } },
  userGrade: 'raw',
  priceBands: { quick: 50, market: 60, stretch: 75 },
});

assertEq(normalAnalysis.tier, 'NORMAL', 'NORMAL analysis → tier NORMAL');
assertEq(normalAnalysis.recommendation.recommendedBand, 'market', 'NORMAL analysis → market band');
assertEq(normalAnalysis.recommendation.recommendedPrice, 60, 'NORMAL analysis → price = market (60)');

const thinAnalysis = analyzeVelocity({
  salesVelocity: { '9.4': { label: '0.5 per month', perDay: 0.017 } },
  userGrade: 9.4,
  priceBands: { quick: 200, market: 250, stretch: 300 },
});

assertEq(thinAnalysis.tier, 'THIN', 'THIN analysis → tier THIN');
assertEq(thinAnalysis.recommendation.recommendedBand, 'quick', 'THIN analysis → quick band');
assertEq(thinAnalysis.recommendation.recommendedPrice, 190, 'THIN analysis → price = quick * 0.95 (190)');
assertTrue(thinAnalysis.saturation.saturated, 'THIN analysis → saturated true');

const noDataAnalysis = analyzeVelocity({
  salesVelocity: {},
  userGrade: 9.8,
  priceBands: { quick: 100, market: 120, stretch: 150 },
});

assertFalse(noDataAnalysis.hasData, 'No data analysis → hasData false');
assertEq(noDataAnalysis.tier, 'UNKNOWN', 'No data analysis → tier UNKNOWN');
assertEq(noDataAnalysis.perDay, null, 'No data analysis → perDay null');

// ─── getVelocityColor ──────────────────────────────────────────
console.log('\ngetVelocityColor:');

assertEq(getVelocityColor('HOT'), '#dc2626', 'HOT → red');
assertEq(getVelocityColor('FAST'), '#ea580c', 'FAST → orange');
assertEq(getVelocityColor('NORMAL'), '#16a34a', 'NORMAL → green');
assertEq(getVelocityColor('SLOW'), '#ca8a04', 'SLOW → yellow');
assertEq(getVelocityColor('THIN'), '#9ca3af', 'THIN → gray');
assertEq(getVelocityColor('UNKNOWN'), '#6b7280', 'UNKNOWN → gray');

// ─── Edge Cases ────────────────────────────────────────────────
console.log('\nEdge Cases:');

// FAST with +5% multiplier
const fastWithPremium = analyzeVelocity({
  salesVelocity: { '9.8': { label: '5 per month', perDay: 0.167 } },
  userGrade: 9.8,
  priceBands: { quick: 900, market: 1000, stretch: 1200 },
});

assertEq(fastWithPremium.tier, 'FAST', 'FAST tier (0.167/day)');
assertEq(fastWithPremium.recommendation.recommendedPrice, 1050, 'FAST → market * 1.05 (1050)');

// Boundary between NORMAL and FAST (0.15/day)
const boundaryAnalysis = analyzeVelocity({
  salesVelocity: { raw: { label: '4.5 per month', perDay: 0.15 } },
  userGrade: 'raw',
  priceBands: { quick: 40, market: 50, stretch: 60 },
});

assertEq(boundaryAnalysis.tier, 'FAST', 'Boundary 0.15/day → FAST');

// ─── Summary ────────────────────────────────────────────────────
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
