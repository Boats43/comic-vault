// Unit tests for Ship #22 — GoCollect FMV API integration.
//
// Helper: lookupGoCollect({ title, issue, year, publisher })
//   Queries GoCollect API for CGC Fair Market Values at grades 9.0-9.8.
//   Returns null when GOCOLLECT_API_TOKEN not set or no match found.
//   Returns FMV object with grade-specific prices when match found.
//
// Invoke: node tests/gocollect.test.js
// Exit: 0 all-pass, 1 any failure.

import { lookupGoCollect } from '../api/gocollect.js';

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

const assertTruthy = (actual, label) => {
  if (actual) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: truthy\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertGte = (actual, expected, label) => {
  if (actual >= expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: >=${expected}\n    actual:   ${actual}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #22 — GOCOLLECT FMV INTEGRATION ===\n');

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof lookupGoCollect, 'function', 'lookupGoCollect exported');

// ─── Null safety (no API key set) ──────────────────────────────────
console.log('\nNull safety (no API key):');
const savedKey = process.env.GOCOLLECT_API_TOKEN;
delete process.env.GOCOLLECT_API_TOKEN;

const noKeyResult = await lookupGoCollect({
  title: 'Amazing Spider-Man',
  issue: '1',
  year: 1963,
  publisher: 'Marvel'
});
assertNull(noKeyResult, 'no API key → returns null');

// ─── Input validation ──────────────────────────────────────────────
console.log('\nInput validation:');
if (savedKey) {
  process.env.GOCOLLECT_API_TOKEN = savedKey;

  const noTitle = await lookupGoCollect({ issue: '1', year: 1963, publisher: 'Marvel' });
  assertNull(noTitle, 'missing title → returns null');

  const noIssue = await lookupGoCollect({ title: 'Amazing Spider-Man', year: 1963, publisher: 'Marvel' });
  assertNull(noIssue, 'missing issue → returns null');

  // Year and publisher are optional
  const minimalInput = await lookupGoCollect({ title: 'Amazing Spider-Man', issue: '300' });
  // Result depends on API, but should not crash
  assertEq(typeof minimalInput, 'object', 'minimal input (title+issue) → returns object or null');
}

// ─── Response shape validation ─────────────────────────────────────
console.log('\nResponse shape validation:');
if (savedKey) {
  // Mock a successful API response by testing with a well-known comic
  const result = await lookupGoCollect({
    title: 'Amazing Spider-Man',
    issue: '300',
    year: 1988,
    publisher: 'Marvel'
  });

  if (result) {
    // FMV fields
    assertEq(typeof result.fmv98, 'number', 'fmv98 is number when present');
    assertEq(typeof result.fmv96, 'number', 'fmv96 is number when present');
    assertEq(typeof result.fmv94, 'number', 'fmv94 is number when present');

    // Source metadata
    assertEq(result.source, 'gocollect', 'source field is "gocollect"');
    assertTruthy(result.matchTitle, 'matchTitle present when matched');

    // Census data (may or may not be present)
    if (result.census !== null) {
      assertEq(typeof result.census, 'number', 'census is number when present');
      assertGte(result.census, 0, 'census is non-negative');
    }

    // Submit recommendation
    assertEq(typeof result.submitRecommended, 'boolean', 'submitRecommended is boolean');
    if (result.submitGap) {
      assertEq(typeof result.submitGap, 'number', 'submitGap is number when present');
      assertGte(result.submitGap, 0, 'submitGap is non-negative');
    }
  } else {
    console.log('  ⚠ API returned null (no match or API issue) — skipping shape validation');
  }
}

// ─── Year matching tolerance ───────────────────────────────────────
console.log('\nYear matching tolerance:');
if (savedKey) {
  // Test that year matching allows reasonable tolerance (±5 years per code)
  const result1 = await lookupGoCollect({
    title: 'Amazing Spider-Man',
    issue: '1',
    year: 1963,
    publisher: 'Marvel'
  });

  const result2 = await lookupGoCollect({
    title: 'Amazing Spider-Man',
    issue: '1',
    year: 1965, // 2 years off
    publisher: 'Marvel'
  });

  // Both should match or both fail
  assertEq(
    result1 === null,
    result2 === null,
    'year tolerance: ±2 years matches same as exact'
  );
}

// ─── Report ────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
