#!/usr/bin/env node
// Ship #28b Conflict Detector Accuracy Test
// Validate conflict detection across known contamination scenarios

import { detectCompsConflicts, detectPricingConflicts } from '../src/lib/conflictDetector.js';

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║      Ship #28b Conflict Detector Accuracy Test — Contamination           ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const scenarios = [
  {
    name: 'Scenario A: MTG cards in comp pool',
    test: () => {
      const comps = { count: 3 };
      const leafCategories = ['38395', '38395', '38395']; // all MTG
      const conflicts = detectCompsConflicts(comps, leafCategories);
      const hasCrossCategory = conflicts.some(c => c.type === 'CROSS_CATEGORY_CONTAMINATION');
      return {
        passed: hasCrossCategory,
        conflicts,
        expected: 'CROSS_CATEGORY conflict detected',
        got: hasCrossCategory ? 'CROSS_CATEGORY detected' : 'No conflicts',
      };
    },
  },
  {
    name: 'Scenario B: Clean comic comps',
    test: () => {
      const comps = { count: 3 };
      const leafCategories = ['259104', '259104', '259104']; // all comics
      const conflicts = detectCompsConflicts(comps, leafCategories);
      return {
        passed: conflicts.length === 0,
        conflicts,
        expected: '0 conflicts',
        got: `${conflicts.length} conflicts`,
      };
    },
  },
  {
    name: 'Scenario C: Mixed pool (2 MTG + 1 comic)',
    test: () => {
      const comps = { count: 3 };
      const leafCategories = ['38395', '38395', '259104']; // 2 MTG, 1 comic
      const conflicts = detectCompsConflicts(comps, leafCategories);
      const hasCrossCategory = conflicts.some(c => c.type === 'CROSS_CATEGORY_CONTAMINATION');
      // NOTE: Filter happens in comps.js, not conflictDetector
      // Conflict detector only flags contamination, doesn't filter
      return {
        passed: hasCrossCategory,
        conflicts,
        expected: 'CROSS_CATEGORY detected, filter in comps.js handles cleanup',
        got: hasCrossCategory ? 'CROSS_CATEGORY detected ✓' : 'No conflicts ✗',
      };
    },
  },
  {
    name: 'Scenario D: Price inflation (active >> sold)',
    test: () => {
      const sold = { median: 15, count: 3 };
      const active = { median: 175, count: 3 };
      const conflicts = detectPricingConflicts(sold, active, null, null);
      const hasInflation = conflicts.some(c => c.type === 'PRICE_INFLATION');
      const ratio = active.median / sold.median; // 11.67x
      return {
        passed: hasInflation && ratio > 2.5,
        conflicts,
        expected: 'PRICE_INFLATION conflict (active > sold × 2.5)',
        got: hasInflation ? `PRICE_INFLATION detected (${ratio.toFixed(1)}x)` : 'No conflicts',
      };
    },
  },
  {
    name: 'Scenario E: Liquidity crisis (active << sold)',
    test: () => {
      const sold = { median: 100, count: 5 };
      const active = { median: 50, count: 3 };
      const conflicts = detectPricingConflicts(sold, active, null, null);
      const hasCrisis = conflicts.some(c => c.type === 'LIQUIDITY_CRISIS');
      const ratio = active.median / sold.median; // 0.5
      return {
        passed: hasCrisis && ratio < 0.6,
        conflicts,
        expected: 'LIQUIDITY_CRISIS conflict (active < sold × 0.6)',
        got: hasCrisis ? `LIQUIDITY_CRISIS detected (${ratio.toFixed(2)}x)` : 'No conflicts',
      };
    },
  },
  {
    name: 'Scenario F: FMV divergence (PC vs GC)',
    test: () => {
      const sold = null;
      const active = null;
      const pcGuide = { '9.8': 500 };
      const gcFmv = { '9.8': 800 };
      const conflicts = detectPricingConflicts(sold, active, pcGuide, gcFmv);
      const hasDivergence = conflicts.some(c => c.type === 'FMV_DIVERGENCE');
      const gap = Math.abs(pcGuide['9.8'] - gcFmv['9.8']) / Math.max(pcGuide['9.8'], gcFmv['9.8']);
      return {
        passed: hasDivergence && gap > 0.3,
        conflicts,
        expected: 'FMV_DIVERGENCE conflict (>30% gap)',
        got: hasDivergence ? `FMV_DIVERGENCE detected (${Math.round(gap * 100)}% gap)` : 'No conflicts',
      };
    },
  },
  {
    name: 'Scenario G: Edge case - empty categories',
    test: () => {
      const comps = { count: 3 };
      const leafCategories = [];
      const conflicts = detectCompsConflicts(comps, leafCategories);
      return {
        passed: conflicts.length === 0,
        conflicts,
        expected: '0 conflicts (no metadata to check)',
        got: `${conflicts.length} conflicts`,
      };
    },
  },
  {
    name: 'Scenario H: Edge case - Collections category (valid)',
    test: () => {
      const comps = { count: 3 };
      const leafCategories = ['171228', '171228']; // Collections (valid for bundles)
      const conflicts = detectCompsConflicts(comps, leafCategories);
      return {
        passed: conflicts.length === 0,
        conflicts,
        expected: '0 conflicts (171228 is valid comic category)',
        got: `${conflicts.length} conflicts`,
      };
    },
  },
];

let passCount = 0;
let failCount = 0;

console.log('Running conflict detector accuracy tests...\n');

scenarios.forEach((scenario, idx) => {
  const result = scenario.test();

  if (result.passed) {
    passCount++;
    console.log(`✅ TEST ${idx + 1}: ${scenario.name}`);
    console.log(`   Expected: ${result.expected}`);
    console.log(`   Got: ${result.got}`);
  } else {
    failCount++;
    console.log(`❌ TEST ${idx + 1}: ${scenario.name}`);
    console.log(`   Expected: ${result.expected}`);
    console.log(`   Got: ${result.got}`);
    console.log(`   Conflicts:`, JSON.stringify(result.conflicts, null, 2));
  }
  console.log();
});

console.log('═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log(`✅ PASSED: ${passCount}/${scenarios.length}`);
console.log(`❌ FAILED: ${failCount}/${scenarios.length}`);

if (failCount === 0) {
  console.log('\n🎉 ALL CONFLICT DETECTOR TESTS PASSED');
  console.log('✅ MTG contamination detected');
  console.log('✅ Price inflation/crisis detected');
  console.log('✅ FMV divergence detected');
  console.log('✅ Clean comps pass validation');
  process.exit(0);
} else {
  console.log('\n⚠️  SOME TESTS FAILED — Fix before proceeding');
  process.exit(1);
}
