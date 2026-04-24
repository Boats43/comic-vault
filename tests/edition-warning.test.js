// Unit tests for Ship #19 MVP — AI-CROSS-LAYER-DISCONNECT edition warning.
//
// Helper: detectEditionWarning(reasonText)
//   Scans Vision's free-form reason text for reprint / later-print /
//   facsimile signals. Returns { detected, signals, source } or null.
//
// MVP scope: detection only. Pricing math untouched. Phase 2 (Ship
// #19b) handles comp filtering + recalibration.
//
// Invoke: node tests/edition-warning.test.js
// Exit: 0 all-pass, 1 any failure.

import { detectEditionWarning } from '../api/grade.js';

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

const assertFires = (result, expectedKinds, label) => {
  const normalize = (arr) => [...(arr || [])].sort();
  const actualKinds = result?.signals;
  if (
    result &&
    result.detected === true &&
    JSON.stringify(normalize(actualKinds)) === JSON.stringify(normalize(expectedKinds))
  ) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected signals: ${JSON.stringify(expectedKinds)}\n    actual: ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertFiresAny = (result, mustIncludeKind, label) => {
  if (result && result.detected === true && Array.isArray(result.signals) && result.signals.includes(mustIncludeKind)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected to include: ${mustIncludeKind}\n    actual: ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #19 MVP — EDITION WARNING DETECTION ===\n');

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof detectEditionWarning, 'function', 'detectEditionWarning exported');
assertNull(detectEditionWarning(null), 'null → null');
assertNull(detectEditionWarning(undefined), 'undefined → null');
assertNull(detectEditionWarning(''), 'empty string → null');
assertNull(detectEditionWarning('   '), 'whitespace-only → null');
assertNull(detectEditionWarning(42), 'non-string (number) → null');
assertNull(detectEditionWarning({}), 'non-string (object) → null');

// ─── Star Wars #1 fixture — the bug that triggered this ship ────────
console.log('\nStar Wars #1 fixture (3-signal match):');
const starWarsReason =
  'This is the Star Wars #1 35 cent REPRINT edition, NOT the rare ' +
  '35 cent first print variant. The reprint is significantly less valuable.';
const sw = detectEditionWarning(starWarsReason);
assertEq(sw?.detected, true, 'Star Wars #1 reason → detected=true');
assertEq(sw?.source, 'vision-condition-report', 'Star Wars #1 source correct');
// Expected kinds: reprint (from "REPRINT edition"), not-first-print (from
// "NOT the rare 35 cent first print"), not-original (from case-sensitive
// "NOT the rare"), less-valuable (from "significantly less valuable").
assertFiresAny(sw, 'reprint', 'Star Wars #1 → "reprint" signal');
assertFiresAny(sw, 'not-first-print', 'Star Wars #1 → "not-first-print" signal');
assertFiresAny(sw, 'not-original', 'Star Wars #1 → "not-original" signal (case-sensitive NOT)');
assertFiresAny(sw, 'less-valuable', 'Star Wars #1 → "less-valuable" signal');

// ─── Positive cases per pattern ─────────────────────────────────────
console.log('\nPositive cases:');
assertFiresAny(
  detectEditionWarning('This is a reprint edition from 2010'),
  'reprint',
  '"reprint edition" → reprint signal'
);
assertFiresAny(
  detectEditionWarning('This is a facsimile edition published in 2019'),
  'facsimile',
  '"facsimile" → facsimile signal'
);
assertFiresAny(
  detectEditionWarning('Later printing — not a first print'),
  'later-printing',
  '"Later printing" → later-printing signal'
);
assertFiresAny(
  detectEditionWarning('This is 2nd print — not the original release'),
  'second-print',
  '"2nd print" → second-print signal'
);
assertFiresAny(
  detectEditionWarning('Third printing variant'),
  'third-print',
  '"Third printing" → third-print signal'
);
assertFiresAny(
  detectEditionWarning('Note: not the first print — later reissue'),
  'not-first-print',
  '"not the first print" → not-first-print signal'
);
assertFiresAny(
  detectEditionWarning('This is NOT the original book'),
  'not-original',
  '"NOT the original" (case-sensitive caps) → not-original signal'
);
assertFiresAny(
  detectEditionWarning('This version is significantly less valuable than the original'),
  'less-valuable',
  '"significantly less valuable" → less-valuable signal'
);

// ─── Negative cases — clean reason shouldn't trigger ────────────────
console.log('\nNegative cases — normal condition reports:');
assertNull(
  detectEditionWarning('Mint condition first print, 1977'),
  'first print (no negation) → no fire'
);
assertNull(
  detectEditionWarning('This is the original printing — excellent condition'),
  '"original printing" (no not) → no fire'
);
assertNull(
  detectEditionWarning('Spine tick minor, corners square, clean cover'),
  'standard condition report → no fire'
);
assertNull(
  detectEditionWarning('CGC 9.8 slabbed — white pages'),
  'slab/grade report → no fire'
);
assertNull(
  detectEditionWarning('Valuable key issue in high grade'),
  '"valuable" alone → no fire (without "less valuable")'
);

// ─── Word-boundary enforcement ──────────────────────────────────────
console.log('\nWord-boundary enforcement:');
assertNull(
  detectEditionWarning('The book was reprinted elsewhere'),
  '"reprinted" (different word form) does NOT match "reprint" pattern'
);
assertNull(
  detectEditionWarning('Original unprinted proof copy'),
  '"unprinted" does NOT match'
);

// ─── Case sensitivity — case-sensitive "NOT" pattern ────────────────
console.log('\nCase sensitivity for "NOT":');
// Case-sensitive pattern requires all-caps NOT. Lowercase "not" won't
// trigger "not-original" (but "not the first print" still triggers
// the case-insensitive not-first-print pattern).
const notOriginalLower = detectEditionWarning('This is not the original');
assertEq(notOriginalLower, null,
  '"not the original" (lowercase) → case-sensitive NOT-the does NOT fire');

// Uppercase NOT fires.
assertFiresAny(
  detectEditionWarning('This is NOT the original'),
  'not-original',
  '"NOT the original" (uppercase) → fires'
);

// Mixed — "NOT the rare" also fires (case-sensitive pattern).
assertFiresAny(
  detectEditionWarning('Vision sees: NOT the rare first print variant'),
  'not-original',
  '"NOT the rare" (uppercase) → fires'
);

// ─── Signal dedup — same kind reported once per reason ──────────────
console.log('\nSignal dedup:');
// Multiple reprint mentions → single "reprint" entry.
const twoReprints = detectEditionWarning('reprint — confirmed reprint edition');
assertEq(
  twoReprints?.signals?.filter((s) => s === 'reprint').length,
  1,
  'two "reprint" mentions → single signal entry (dedup)'
);

// ─── Multi-signal ordering ──────────────────────────────────────────
console.log('\nMulti-signal ordering:');
// Signals should follow pattern array order, not input order.
const multi = detectEditionWarning('2nd print facsimile reprint');
assertEq(
  Array.isArray(multi?.signals) && multi.signals.length >= 3,
  true,
  'multi-signal: 3+ kinds detected'
);
assertFiresAny(multi, 'reprint', 'multi-signal includes reprint');
assertFiresAny(multi, 'facsimile', 'multi-signal includes facsimile');
assertFiresAny(multi, 'second-print', 'multi-signal includes second-print');

// ─── Return shape ───────────────────────────────────────────────────
console.log('\nReturn shape:');
const shape = detectEditionWarning('reprint edition');
assertEq(typeof shape, 'object', 'positive return is object');
assertEq(shape.detected, true, 'detected=true on fire');
assertEq(Array.isArray(shape.signals), true, 'signals is array');
assertEq(shape.source, 'vision-condition-report', 'source set correctly');

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
