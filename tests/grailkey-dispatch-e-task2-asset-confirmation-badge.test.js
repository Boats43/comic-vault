// tests/grailkey-dispatch-e-task2-asset-confirmation-badge.test.js
//
// GrailKey Directive 2026-08-11-D found a GK-39-class recurrence: src/App.jsx's
// identity-provenance line rendered "✓ comic confirmed" as the bare else-branch
// of a ternary keyed only on item.assetType === 'book' -- no failure mode for
// the thing it claimed to verify. Vision's own real "is this genuinely a
// comic" signal (assetTypeConfident, api/enrich.js:2488, already a
// RESEARCH-tier warning in decisionEngine.js) was never wired to it. All 15
// cards in a real production batch rendered "✓ comic confirmed", including
// Spawn #351, whose own condition text read "not an actual comic book cover."
//
// Directive 2026-08-11-E, Task 2 fixes this with a three-state pure helper,
// src/lib/assetConfirmationBadge.js's getAssetConfirmationBadge(item), wired
// into App.jsx's render site in place of the old ternary.

import { getAssetConfirmationBadge } from '../src/lib/assetConfirmationBadge.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

// The OLD render-site logic, verbatim, as it shipped before this fix
// (src/App.jsx:4183 prior to Directive E, Task 2). Reconstructed inline so
// this suite can demonstrate the real defect directly, rather than assert
// against a description of it.
function oldAssetWarning(item) {
  return item.assetType === 'book' ? '⚠ book detected' : '✓ comic confirmed';
}

test('DEFECT DEMONSTRATION: the old ternary renders the confirmed string even when Vision flagged assetTypeConfident=false', () => {
  // The real Spawn #351 shape: Vision's own condition text said "not an
  // actual comic book cover," which sets assetTypeConfident=false --
  // assetType itself stays 'comic' (the default) because nothing in the
  // pipeline ever demotes it to a distinct "not a comic" category.
  const spawn351 = { assetType: 'comic', assetTypeConfident: false };
  assertEqual(oldAssetWarning(spawn351), '✓ comic confirmed',
    'This assertion documents the real, shipped defect: the old code rendered the confirmed string here. If this ever fails, the "old" reconstruction itself has drifted from what actually shipped.');
});

test('FIX: assetTypeConfident=false renders the uncertain state, not the confirmed string', () => {
  const spawn351 = { assetType: 'comic', assetTypeConfident: false };
  const badge = getAssetConfirmationBadge(spawn351);
  if (badge.text === '✓ comic confirmed') {
    throw new Error(`Must not render the confirmed string when Vision flagged assetTypeConfident=false. Got: "${badge.text}"`);
  }
  assertEqual(badge.state, 'uncertain', 'Should be the uncertain state');
});

test('FIX: a genuinely confirmed comic still renders the confirmed string', () => {
  const item = { assetType: 'comic', assetTypeConfident: true };
  const badge = getAssetConfirmationBadge(item);
  assertEqual(badge.text, '✓ comic confirmed', 'A real, Vision-confirmed comic should still show confirmed');
  assertEqual(badge.state, 'confirmed', 'Should be the confirmed state');
});

test('FIX: assetTypeConfident undefined (older records, pre-field) defaults to confirmed, not uncertain', () => {
  // Only an EXPLICIT false should demote to uncertain -- an older
  // catalogue record that predates this field must not regress to a
  // false alarm just because the field is absent.
  const item = { assetType: 'comic' };
  const badge = getAssetConfirmationBadge(item);
  assertEqual(badge.state, 'confirmed', 'Absent assetTypeConfident must not be treated as uncertain');
});

test('FIX: book detection still takes priority over asset-type confidence', () => {
  const item = { assetType: 'book', assetTypeConfident: true };
  const badge = getAssetConfirmationBadge(item);
  assertEqual(badge.text, '⚠ book detected', 'Book detection must still win over a confirmed comic read');
  assertEqual(badge.state, 'book', 'Should be the book state');
});

test('FIX: the uncertain state is visually distinct from the confirmed state (not the same color)', () => {
  const confirmed = getAssetConfirmationBadge({ assetType: 'comic', assetTypeConfident: true });
  const uncertain = getAssetConfirmationBadge({ assetType: 'comic', assetTypeConfident: false });
  if (confirmed.color === uncertain.color) {
    throw new Error(`Uncertain state must be visually distinct from confirmed. Both rendered color: "${confirmed.color}"`);
  }
});

// ─────────────────────────────────────────────────────────────────

console.log('\n=== GrailKey Directive E, Task 2 — asset confirmation badge ===\n');
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
    failed++;
  }
}
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
