// tests/grailkey-dispatch-g-task2-pc-anchor-authority.test.js
//
// GrailKey Directive F traced the Bone #1 class: Last Sold, Price Ladder,
// and CGC Population were fetched off bare priceCharting.id presence
// (api/enrich.js:6174-6184) with zero edition-trust gate. The one
// classifier built to catch an edition mismatch, assessPcAnchorTrust
// (src/lib/evidenceEligibility.js:979-999), was only ever persisted to
// out.pcAnchorTrust inside the catalog-ladder-reference branch
// (api/enrich.js, requires the comp pool to be COMPLETELY empty) --
// exactly the opposite of Bone's case (a real 23-comp pool, PC drift=5y).
// out.pcAnchorTrust was undefined on that response; nothing in src/App.jsx
// read it even when it did exist.
//
// Directive G, Task 2:
//   1. api/enrich.js now stamps out.pcAnchorTrust (+ out.pcAnchorYear)
//      unconditionally whenever priceCharting is present, still computed
//      against confirmedYear (never poolYearHint) -- assessPcAnchorTrust
//      itself, assessCatalogLadderReference, and pcMatchConflictsWithPoolYear
//      are all untouched.
//   2. src/lib/pcAnchorAuthority.js (new, pure, no pricing math) gates
//      App.jsx's Last Sold / Price Ladder / CGC Population render
//      surfaces: authoritative only when pcAnchorTrust === 'EXACT_EDITION'.
//      Missing/undefined defaults to annotated, never authoritative.
//
// This suite proves (a) assessPcAnchorTrust's own math on Bone's real
// numbers, unchanged, still returns COMPATIBLE_REFERENCE (not REJECTED --
// drift is exactly 5, and the REJECTED threshold is drift > 5, confirmed
// in Directive F); and (b) the new render-gate helper correctly refuses
// to treat COMPATIBLE_REFERENCE, REJECTED, and missing/undefined as
// authoritative, while EXACT_EDITION renders unannotated.

import { assessPcAnchorTrust } from '../src/lib/evidenceEligibility.js';
import { isPcAnchorExact, pcEditionCaveat } from '../src/lib/pcAnchorAuthority.js';

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

// ─────────────────────────────────────────────────────────────────
// (a) assessPcAnchorTrust's own math, untouched -- Bone #1's real shape.
// ─────────────────────────────────────────────────────────────────

test('Bone #1 shape: confirmedYear 1996, PC year 1991 (drift=5) -> COMPATIBLE_REFERENCE, not REJECTED', () => {
  const trust = assessPcAnchorTrust({
    pcPrice: 1710,
    pcYear: 1991,
    confirmedYear: 1996,
    pcMatchRejectedForYearConflict: false,
    identityConflictCount: 0,
  });
  assertEqual(trust, 'COMPATIBLE_REFERENCE',
    'drift=5 is not > 5 (REJECTED threshold) and not <= 1 (EXACT_EDITION threshold) -- falls to COMPATIBLE_REFERENCE. ' +
    'This is exactly why gating render authority on `!== REJECTED` would fail to catch Bone; only `=== EXACT_EDITION` catches it.');
});

test('assessPcAnchorTrust thresholds are unmodified: drift=1 still EXACT_EDITION, drift=6 still REJECTED', () => {
  assertEqual(
    assessPcAnchorTrust({ pcPrice: 10, pcYear: 1995, confirmedYear: 1996, pcMatchRejectedForYearConflict: false, identityConflictCount: 0 }),
    'EXACT_EDITION', 'drift=1 must still be EXACT_EDITION'
  );
  assertEqual(
    assessPcAnchorTrust({ pcPrice: 10, pcYear: 1990, confirmedYear: 1996, pcMatchRejectedForYearConflict: false, identityConflictCount: 0 }),
    'REJECTED', 'drift=6 must still be REJECTED'
  );
});

// ─────────────────────────────────────────────────────────────────
// (b) The render-gate helper.
// ─────────────────────────────────────────────────────────────────

test('PRE-FIX SHAPE: Bone #1 with no pcAnchorTrust stamped at all (the actual production shape before this dispatch) is NOT treated as authoritative', () => {
  // Directive F evidence: out.pcAnchorTrust was undefined on the real Bone
  // #1 response (assessCatalogLadderReference's rawPricingPoolEmpty gate
  // never passed with a 23-comp pool). This is the exact shape that
  // rendered Last Sold/Ladder/Population as authoritative pre-fix -- the
  // render gate must refuse it.
  const boneResponsePreFix = { title: 'Bone', issue: '1', confirmedYear: 1996 }; // no pcAnchorTrust field at all
  assertEqual(isPcAnchorExact(boneResponsePreFix), false, 'undefined pcAnchorTrust must never read as EXACT_EDITION');
  const caveat = pcEditionCaveat(boneResponsePreFix);
  if (!caveat) throw new Error('Missing pcAnchorTrust must produce a caveat, not silently pass through as authoritative');
});

test('POST-FIX SHAPE: Bone #1 with pcAnchorTrust=COMPATIBLE_REFERENCE + pcAnchorYear=1991 renders annotated, showing the PC year', () => {
  const boneResponsePostFix = { pcAnchorTrust: 'COMPATIBLE_REFERENCE', pcAnchorYear: 1991 };
  assertEqual(isPcAnchorExact(boneResponsePostFix), false, 'COMPATIBLE_REFERENCE must never be treated as authoritative');
  const caveat = pcEditionCaveat(boneResponsePostFix);
  if (!caveat || !caveat.includes('1991')) {
    throw new Error(`Expected an annotation naming the PC record's own year (1991). Got: ${JSON.stringify(caveat)}`);
  }
  if (caveat.toLowerCase().includes('this copy') && !caveat.toLowerCase().includes('not confirmed')) {
    throw new Error(`Caveat must not read as confirming this is the operator's own copy. Got: "${caveat}"`);
  }
});

test('REJECTED verdict also renders annotated, never authoritative', () => {
  const item = { pcAnchorTrust: 'REJECTED', pcAnchorYear: 1938 };
  assertEqual(isPcAnchorExact(item), false, 'REJECTED must never be treated as authoritative');
  if (!pcEditionCaveat(item)) throw new Error('REJECTED must produce a caveat');
});

test('EXACT_EDITION renders authoritative with no caveat -- the gate must not suppress good data', () => {
  const item = { pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  assertEqual(isPcAnchorExact(item), true, 'EXACT_EDITION must be treated as authoritative');
  assertEqual(pcEditionCaveat(item), null, 'EXACT_EDITION must not carry a caveat');
});

test('missing pcAnchorYear still produces a caveat (no PC record at all is never confused with EXACT_EDITION)', () => {
  const item = { pcAnchorTrust: 'REJECTED' };
  const caveat = pcEditionCaveat(item);
  if (!caveat) throw new Error('A REJECTED/missing-year item must still produce a caveat string');
});

// ─────────────────────────────────────────────────────────────────

console.log('\n=== GrailKey Directive G, Task 2 -- PC anchor authority ===\n');
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
