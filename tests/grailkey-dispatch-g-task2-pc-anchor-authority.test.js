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
//
// CORRECTION (Directive H, Item 2, 2026-08-11): this suite's original
// "shown failing pre-fix" evidence was `src/lib/pcAnchorAuthority.js`
// temporarily moved aside, producing ERR_MODULE_NOT_FOUND. That proves a
// missing module breaks an import -- it proves nothing about whether the
// actual PRIOR render conditions in src/App.jsx violated the invariant.
// The `preFixRenderCondition*` block below replaces that evidence with a
// direct mirror of the real pre-fix conditions (verified against
// `26d5cf6~1:src/App.jsx`, i.e. the commit immediately before Task 2
// landed): `result.priceLadder && Object.keys(result.priceLadder).length
// > 0` (Price Ladder), `item.pop && item.pop.total > 0` (CGC Population),
// `Array.isArray(result.soldComps) && result.soldComps.length > 0` (Last
// Sold) -- bare presence checks, zero pcAnchorTrust dependency, run
// against Bone's real shape (comp pool present, drift=5). The original
// ERR_MODULE_NOT_FOUND run is still accurate as evidence that the render
// GATE HELPER itself (isPcAnchorExact/pcEditionCaveat) did not exist
// before this dispatch -- it is not evidence about what the old render
// conditions did with data present.

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

test('SAFETY PROPERTY: an old-shaped response with no pcAnchorTrust field at all is never treated as authoritative', () => {
  // NOT "shown failing pre-fix" evidence (see file header correction,
  // Directive H Item 2) -- this proves the NEW gate handles an
  // old-shaped (field-absent) input safely, which matters for any book
  // scanned before this dispatch shipped and not yet re-scanned.
  const boneResponsePreFix = { title: 'Bone', issue: '1', confirmedYear: 1996 }; // no pcAnchorTrust field at all
  assertEqual(isPcAnchorExact(boneResponsePreFix), false, 'undefined pcAnchorTrust must never read as EXACT_EDITION');
  const caveat = pcEditionCaveat(boneResponsePreFix);
  if (!caveat) throw new Error('Missing pcAnchorTrust must produce a caveat, not silently pass through as authoritative');
});

// ─────────────────────────────────────────────────────────────────
// Directive H, Item 2 -- the actual pre-fix vs. post-fix RENDER
// CONDITION, mirrored literally (not independently importable; these are
// inline JSX guards in src/App.jsx). Verified byte-for-byte against
// `git show 26d5cf6~1:src/App.jsx` before writing these mirrors.
// ─────────────────────────────────────────────────────────────────

function preFixPriceLadderRenders(item) {
  // src/App.jsx (pre-26d5cf6): `{result.priceLadder && Object.keys(result.priceLadder).length > 0 && (...)}`
  return !!(item.priceLadder && Object.keys(item.priceLadder).length > 0);
}
function preFixPopRenders(item) {
  // src/App.jsx (pre-26d5cf6): `{item.pop && item.pop.total > 0 && (...)}`
  return !!(item.pop && item.pop.total > 0);
}
function preFixLastSoldRenders(item) {
  // src/App.jsx (pre-26d5cf6): `{Array.isArray(result.soldComps) && result.soldComps.length > 0 && (...)}`
  return Array.isArray(item.soldComps) && item.soldComps.length > 0;
}

function boneProductionShape() {
  // Directive F evidence, build 25c3cd8, 2026-08-11 23:43:35: 23-comp
  // active pool, PC year 1991, confirmedYear 1996 (drift=5, COMPATIBLE_REFERENCE).
  return {
    confirmedYear: 1996,
    priceLadder: { '10.0': 14926, '9.8': 11481.55, raw: 1619.99 },
    pop: { total: 406, universal: 300 },
    soldComps: [{ price: 1619.99, daysAgo: 11, marketplace: 'ebay' }],
    pcAnchorTrust: 'COMPATIBLE_REFERENCE', // this dispatch's own field -- absent pre-Task-2
    pcAnchorYear: 1991,
  };
}

test('PRE-FIX RENDER CONDITION: all three surfaces render on Bone\'s real data with zero pcAnchorTrust dependency (the actual violation)', () => {
  const bone = boneProductionShape();
  if (!preFixPriceLadderRenders(bone)) throw new Error('Expected the pre-fix Price Ladder condition to render on this data');
  if (!preFixPopRenders(bone)) throw new Error('Expected the pre-fix CGC Population condition to render on this data');
  if (!preFixLastSoldRenders(bone)) throw new Error('Expected the pre-fix Last Sold condition to render on this data');
  // The pre-fix conditions have no caveat mechanism at all -- there was
  // nothing to check, which is precisely the violation: a
  // COMPATIBLE_REFERENCE (non-exact) PC match rendered exactly as
  // unannotated as an EXACT_EDITION one would have.
});

test('POST-FIX: the same Bone data now carries a caveat naming the PC record\'s own year (1991)', () => {
  const bone = boneProductionShape();
  // Post-fix, presence alone is no longer the render authority question --
  // isPcAnchorExact/pcEditionCaveat gate whether the surface presents as
  // this copy's own data. The presence conditions above still gate
  // whether the panel renders AT ALL (unchanged, I13 -- never hide data
  // that exists); pcEditionCaveat gates whether it renders as authoritative.
  assertEqual(isPcAnchorExact(bone), false, 'COMPATIBLE_REFERENCE must not be authoritative');
  const caveat = pcEditionCaveat(bone);
  if (!caveat || !caveat.includes('1991')) {
    throw new Error(`Expected a caveat naming PC's own year (1991). Got: ${JSON.stringify(caveat)}`);
  }
});

test('POST-FIX positive control: an EXACT_EDITION Bone (drift<=1) renders with no caveat -- the fix does not over-suppress good data', () => {
  const bone = boneProductionShape();
  bone.confirmedYear = 1991;
  bone.pcAnchorTrust = 'EXACT_EDITION';
  bone.pcAnchorYear = 1991;
  assertEqual(isPcAnchorExact(bone), true, 'EXACT_EDITION must be authoritative');
  assertEqual(pcEditionCaveat(bone), null, 'EXACT_EDITION must not carry a caveat');
  if (!preFixPriceLadderRenders(bone) || !preFixPopRenders(bone) || !preFixLastSoldRenders(bone)) {
    throw new Error('Presence-gated panels must still render for a good-data book');
  }
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
