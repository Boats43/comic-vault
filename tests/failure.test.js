// Failure Test — Edge Cases & Error Handling
//
// Tests how the system handles:
// - Network failures
// - Malformed data
// - Missing fields
// - Null/undefined values
// - Boundary conditions
// - Concurrent operations
//
// Invoke: node tests/failure.test.js

import { alignIdentity } from '../src/lib/identityAlignment.js';

let passed = 0;
let failed = 0;
const failures = [];

const assert = (condition, label) => {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertNoThrow = (fn, label) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failed++;
    const msg = `  ✗ ${label} — THREW: ${err.message}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== FAILURE TEST — EDGE CASES & ERROR HANDLING ===\n');

// ─── Test 1: Null/Undefined Inputs ─────────────────────────────────
console.log('TEST 1 — Null/Undefined Inputs:');

assertNoThrow(() => {
  const result = alignIdentity({
    visionTitle: null,
    visionIssue: null,
    visionYear: null,
    visionPublisher: null,
    visionConfidence: null,
    ebayImageResults: null,
    pcProductName: null,
    pcIssue: null,
    pcYear: null,
    cvVolumeName: null,
    cvIssue: null,
    cvYear: null,
    cvPublisher: null,
    cgcTitle: null,
    cgcIssue: null,
  });
  assert(result != null, 'T1.1: Returns result even with all null inputs');
}, 'T1: All null inputs handled gracefully');

assertNoThrow(() => {
  const result = alignIdentity({
    visionTitle: undefined,
    visionIssue: undefined,
    visionYear: undefined,
    visionPublisher: undefined,
    visionConfidence: undefined,
  });
  assert(result != null, 'T1.2: Returns result with undefined inputs');
}, 'T1: Undefined inputs handled gracefully');

// ─── Test 2: Empty Strings ──────────────────────────────────────────
console.log('\nTEST 2 — Empty Strings:');

assertNoThrow(() => {
  const result = alignIdentity({
    visionTitle: '',
    visionIssue: '',
    visionYear: '',
    visionPublisher: '',
    visionConfidence: '',
    ebayImageResults: [],
    pcProductName: '',
    pcYear: '',
    cvVolumeName: '',
    cvIssue: '',
    cvYear: '',
    cvPublisher: '',
  });
  assert(result != null, 'T2.1: Empty strings handled');
}, 'T2: Empty string inputs handled gracefully');

// ─── Test 3: Malformed Data Types ──────────────────────────────────
console.log('\nTEST 3 — Malformed Data Types:');

assertNoThrow(() => {
  const result = alignIdentity({
    visionTitle: 12345, // Should be string
    visionIssue: true, // Should be string
    visionYear: '1988', // String instead of number
    visionPublisher: ['Marvel'], // Array instead of string
    visionConfidence: 0.95, // Number instead of string
    ebayImageResults: 'not an array',
  });
  assert(result != null, 'T3.1: Malformed types coerced/handled');
}, 'T3: Type mismatches handled gracefully');

// ─── Test 4: Boundary Values ────────────────────────────────────────
console.log('\nTEST 4 — Boundary Values:');

// Year boundaries
assertNoThrow(() => {
  alignIdentity({ visionYear: 1800, visionTitle: 'Test' }); // Very old
}, 'T4.1: Year 1800 (lower boundary)');

assertNoThrow(() => {
  alignIdentity({ visionYear: 2050, visionTitle: 'Test' }); // Future
}, 'T4.2: Year 2050 (upper boundary)');

assertNoThrow(() => {
  alignIdentity({ visionYear: 0, visionTitle: 'Test' }); // Zero
}, 'T4.3: Year 0 handled');

assertNoThrow(() => {
  alignIdentity({ visionYear: -100, visionTitle: 'Test' }); // Negative
}, 'T4.4: Negative year handled');

// Issue number boundaries
assertNoThrow(() => {
  alignIdentity({ visionIssue: '0', visionTitle: 'Test' });
}, 'T4.5: Issue #0 handled');

assertNoThrow(() => {
  alignIdentity({ visionIssue: '99999', visionTitle: 'Test' });
}, 'T4.6: Very large issue number handled');

// ─── Test 5: Special Characters ────────────────────────────────────
console.log('\nTEST 5 — Special Characters:');

const specialCharTitles = [
  "D'Orc #1",
  "Crow: Dead Time",
  "Spider-Man/Venom",
  "X-Men (1991)",
  "Fantastic Four [2018]",
  "Batman & Robin",
  "Green Lantern/Green Arrow",
  "Thor: God of Thunder",
  "100% #1",
  "Y: The Last Man",
];

specialCharTitles.forEach((title, i) => {
  assertNoThrow(() => {
    alignIdentity({ visionTitle: title });
  }, `T5.${i+1}: Special chars in title: "${title}"`);
});

// ─── Test 6: Unicode & Emoji ────────────────────────────────────────
console.log('\nTEST 6 — Unicode & Emoji:');

assertNoThrow(() => {
  alignIdentity({ visionTitle: 'Pokémon Adventures' });
}, 'T6.1: Unicode characters (é)');

assertNoThrow(() => {
  alignIdentity({ visionTitle: '進撃の巨人 (Attack on Titan)' });
}, 'T6.2: Japanese characters');

assertNoThrow(() => {
  alignIdentity({ visionTitle: 'Batman 🦇 #1' });
}, 'T6.3: Emoji in title');

// ─── Test 7: Very Long Strings ─────────────────────────────────────
console.log('\nTEST 7 — Very Long Strings:');

const longTitle = 'A'.repeat(1000);
assertNoThrow(() => {
  const result = alignIdentity({ visionTitle: longTitle });
  assert(result != null, 'T7.1: Very long title handled');
}, 'T7: 1000-character title');

const longIssue = '9'.repeat(100);
assertNoThrow(() => {
  alignIdentity({ visionIssue: longIssue });
}, 'T7.2: Very long issue number');

// ─── Test 8: Array Edge Cases ──────────────────────────────────────
console.log('\nTEST 8 — Array Edge Cases:');

assertNoThrow(() => {
  alignIdentity({ ebayImageResults: [] });
}, 'T8.1: Empty array');

assertNoThrow(() => {
  const result = alignIdentity({
    ebayImageResults: Array(1000).fill({ title: 'Test', rawTitle: 'Test #1' })
  });
  assert(result != null, 'T8.2: Very large array (1000 items)');
}, 'T8: Large eBay results array');

assertNoThrow(() => {
  alignIdentity({ ebayImageResults: [null, undefined, {}, []] });
}, 'T8.3: Array with malformed entries');

// ─── Test 9: Conflicting Data ──────────────────────────────────────
console.log('\nTEST 9 — Conflicting Data:');

assertNoThrow(() => {
  const result = alignIdentity({
    visionTitle: 'Amazing Spider-Man',
    visionIssue: '300',
    visionYear: 1988,
    pcProductName: 'Spectacular Spider-Man #300', // Different title
    pcYear: 1989, // Different year
    cvVolumeName: 'Web of Spider-Man', // Another different title
    cvIssue: '301', // Different issue
    cvYear: 1987, // Different year
  });
  assert(result.conflicts.length > 0, 'T9.1: Conflicts detected');
  assert(result.needsReview === true, 'T9.2: Review flagged');
}, 'T9: All sources disagree');

// ─── Test 10: Circular References ──────────────────────────────────
console.log('\nTEST 10 — Circular References:');

const circular = { title: 'Test' };
circular.self = circular;

assertNoThrow(() => {
  // alignIdentity doesn't accept circular refs, but test JSON handling
  try {
    JSON.stringify(circular);
    assert(false, 'T10.1: Circular ref should fail JSON.stringify');
  } catch (err) {
    assert(err.message.includes('circular'), 'T10.1: Circular ref detected');
  }
}, 'T10: Circular reference handling');

// ─── Test 11: Concurrent Calls ─────────────────────────────────────
console.log('\nTEST 11 — Concurrent Operations:');

assertNoThrow(async () => {
  const promises = Array(10).fill(null).map((_, i) =>
    Promise.resolve(alignIdentity({
      visionTitle: `Comic ${i}`,
      visionIssue: String(i),
      visionYear: 2020 + i,
      visionConfidence: 'high',
    }))
  );

  const results = await Promise.all(promises);
  assert(results.length === 10, 'T11.1: All concurrent calls completed');
  assert(results.every(r => r != null), 'T11.2: All results valid');
}, 'T11: 10 concurrent alignIdentity calls');

// ─── Test 12: Missing Required Fields ──────────────────────────────
console.log('\nTEST 12 — Missing Required Fields:');

assertNoThrow(() => {
  const result = alignIdentity({}); // Empty object
  assert(result != null, 'T12.1: Empty input object handled');
}, 'T12: No fields provided');

assertNoThrow(() => {
  const result = alignIdentity(); // No argument
  assert(result != null, 'T12.2: Undefined argument handled');
}, 'T12: Undefined input');

// ─── Test 13: Whitespace Edge Cases ────────────────────────────────
console.log('\nTEST 13 — Whitespace:');

assertNoThrow(() => {
  alignIdentity({ visionTitle: '   ' }); // Only spaces
}, 'T13.1: Title with only spaces');

assertNoThrow(() => {
  alignIdentity({ visionTitle: '\t\n\r' }); // Tabs/newlines
}, 'T13.2: Title with tabs/newlines');

assertNoThrow(() => {
  alignIdentity({ visionTitle: '  Amazing  Spider-Man  ' }); // Extra spaces
}, 'T13.3: Title with extra whitespace');

// ─── Test 14: Case Sensitivity ─────────────────────────────────────
console.log('\nTEST 14 — Case Sensitivity:');

assertNoThrow(() => {
  const lower = alignIdentity({ visionTitle: 'amazing spider-man', visionIssue: '1' });
  const upper = alignIdentity({ visionTitle: 'AMAZING SPIDER-MAN', visionIssue: '1' });
  const mixed = alignIdentity({ visionTitle: 'Amazing Spider-Man', visionIssue: '1' });

  assert(lower != null && upper != null && mixed != null, 'T14.1: All case variations handled');
}, 'T14: Case variations');

// ─── Test 15: Numeric String Coercion ──────────────────────────────
console.log('\nTEST 15 — Numeric String Coercion:');

assertNoThrow(() => {
  alignIdentity({ visionYear: '1988' }); // String year
}, 'T15.1: String year coerced');

assertNoThrow(() => {
  alignIdentity({ visionIssue: 300 }); // Number issue
}, 'T15.2: Numeric issue handled');

assertNoThrow(() => {
  alignIdentity({ visionYear: '1988.5' }); // Decimal year
}, 'T15.3: Decimal year string');

// ─── Test 16: Boolean Coercion ─────────────────────────────────────
console.log('\nTEST 16 — Boolean Coercion:');

assertNoThrow(() => {
  alignIdentity({ visionConfidence: true });
}, 'T16.1: Boolean confidence');

assertNoThrow(() => {
  alignIdentity({ visionConfidence: false });
}, 'T16.2: False confidence');

// ─── Test 17: Floating Point Precision ─────────────────────────────
console.log('\nTEST 17 — Floating Point Precision:');

assertNoThrow(() => {
  alignIdentity({ visionYear: 1988.999999999999 });
}, 'T17.1: High precision float');

assertNoThrow(() => {
  alignIdentity({ visionYear: 0.1 + 0.2 }); // Classic float issue
}, 'T17.2: Float arithmetic');

// ─── Test 18: Object Property Access ───────────────────────────────
console.log('\nTEST 18 — Safe Property Access:');

assertNoThrow(() => {
  const result = alignIdentity({
    visionTitle: 'Test',
    ebayImageResults: [
      { /* missing title */ rawTitle: 'Test #1' },
      { title: null, rawTitle: 'Test #2' },
      { title: undefined },
    ],
  });
  assert(result != null, 'T18.1: Missing properties handled');
}, 'T18: Malformed eBay results with missing props');

// ─── Test 19: Prototype Pollution Defense ──────────────────────────
console.log('\nTEST 19 — Prototype Pollution:');

assertNoThrow(() => {
  const malicious = JSON.parse('{"__proto__": {"polluted": true}, "title": "Test"}');
  alignIdentity(malicious);
  assert(typeof {}.polluted === 'undefined', 'T19.1: Prototype not polluted');
}, 'T19: __proto__ injection blocked');

// ─── Test 20: Memory Leak Detection ────────────────────────────────
console.log('\nTEST 20 — Memory Leak Detection:');

assertNoThrow(() => {
  const before = process.memoryUsage().heapUsed;

  // Run 100 alignIdentity calls
  for (let i = 0; i < 100; i++) {
    alignIdentity({
      visionTitle: `Comic ${i}`,
      visionIssue: String(i),
      visionYear: 2020,
      ebayImageResults: Array(10).fill({ title: 'Test', rawTitle: 'Test #1' }),
    });
  }

  // Force GC (if available)
  if (global.gc) global.gc();

  const after = process.memoryUsage().heapUsed;
  const growth = after - before;
  const growthMB = (growth / 1024 / 1024).toFixed(2);

  // Memory growth should be reasonable (<10MB for 100 calls)
  assert(growth < 10 * 1024 * 1024, `T20.1: Memory growth acceptable (${growthMB}MB)`);
}, 'T20: 100 calls memory check');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  console.log('\n⚠️  ERROR HANDLING ISSUES DETECTED');
  process.exit(1);
}
console.log('✅ All edge cases handled gracefully.\n');
process.exit(0);
