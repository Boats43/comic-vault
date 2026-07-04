#!/usr/bin/env node
/**
 * Q37 Dual-Number Probe Scan
 *
 * Test adjacency-aware fix against UK weekly comps BEFORE committing.
 * Checks: MWOM #198, Sgt Rock #343, Thor #186, Annual #14
 */

import { hasIssueNumber, hasMultipleDistinctIssues } from '../src/lib/compHygiene.js';

// Test cases from Q37 verification doc
const TEST_CASES = [
  {
    title: 'MWOM no.198 featuring Hulk no.181',
    issue: '198',
    expectedResult: true, // Should KEEP (198 is the weekly issue)
    comment: 'UK weekly: MWOM issue before featured title issue'
  },
  {
    title: 'Mighty World of Marvel #198 Hulk #181 1976',
    issue: '198',
    expectedResult: true,
    comment: 'UK weekly variant format'
  },
  {
    title: 'Sgt Rock #343 1980',
    issue: '343',
    expectedResult: true,
    comment: 'UK weekly solo issue'
  },
  {
    title: 'Thor #186 1971',
    issue: '186',
    expectedResult: true,
    comment: 'UK weekly solo issue'
  },
  {
    title: 'Annual #14 features ASM #181',
    issue: '14',
    expectedResult: true,
    comment: 'US annual referencing other issue'
  },
  {
    title: 'Batman #222 DC Comics 1970',
    issue: '222',
    expectedResult: true,
    comment: 'US single-issue control (should ALWAYS pass)'
  },
  {
    title: 'Avengers #100 and #101 lot',
    issue: '100',
    expectedResult: false,
    comment: 'Multi-issue lot (should REJECT)'
  }
];

console.log('=== Q37 DUAL-NUMBER PROBE SCAN ===\n');

let passCount = 0;
let failCount = 0;

for (const test of TEST_CASES) {
  // Current behavior: hasMultipleDistinctIssues → hasIssueNumber returns false
  const hasIssueMatch = hasIssueNumber(test.title, test.issue);
  const hasMultiple = hasMultipleDistinctIssues(test.title);

  const currentResult = hasIssueMatch;
  const passed = currentResult === test.expectedResult;

  if (passed) {
    passCount++;
    console.log(`✓ PASS: "${test.title}"`);
  } else {
    failCount++;
    console.log(`✗ FAIL: "${test.title}"`);
    console.log(`  Expected: ${test.expectedResult} | Got: ${currentResult}`);
    console.log(`  hasIssueMatch=${hasIssueMatch}, hasMultiple=${hasMultiple}`);
  }
  console.log(`  Comment: ${test.comment}\n`);
}

console.log('=== RESULTS ===');
console.log(`PASS: ${passCount}/${TEST_CASES.length}`);
console.log(`FAIL: ${failCount}/${TEST_CASES.length}`);

if (failCount > 0) {
  console.log('\n⚠ FAILURES DETECTED — adjacency-aware fix required');
  process.exit(1);
} else {
  console.log('\n✓ ALL TESTS PASSED');
  process.exit(0);
}
