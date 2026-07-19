// tests/q127-variant-pool-year-conflict.test.js
//
// Q127 dispatch (2026-07-19, Catwoman #64 Szerdy-variant class) — a NEW
// visual-pool contamination shape, distinct from Q115's Batman #608 class.
// Confirmed via direct Vercel production log reconstruction (deployment
// dpl_4bjJVXMgwLzfxS8ASWY2HFsRMi2B, build 993a807, 17:38:12Z): the physical
// book is the real 2007 Catwoman #64 ("The Paperweight, Part 2" — confirmed
// via PriceCharting anchor id=2402224 and 29 sold comps that are 100%
// "...Adam Hughes cover... 2007"), but the eBay reverse-image-search visual
// pool feeding identity/variant extraction is 20/20 items (100%) a
// different product: a 2024 Nathan Szerdy exclusive trade-dress homage
// variant that happens to share the exact same title string ("Catwoman")
// AND the exact same issue number ("64").
//
// Q115's filterItemsByIssue is a structural no-op here — every
// contaminating item's `.issue` genuinely is "64", identical to the real
// confirmed issue. The only signal separating the two books is YEAR:
// poolYearHint (api/enrich.js) already independently derives 2024 at 100%
// agreement (6/6 explicit year mentions in the pool) — completely
// decoupled from ComicVine, computed from the same visual pool this
// request already fetched. confirmedYear resolves separately (2007, via
// PriceCharting) later in the same request. Nothing previously cross-
// checked these two already-computed values against each other.
//
// Fix: detectVariantPoolYearConflict (src/lib/variantIdentity.js) — a
// pool-level (not item-level) gate, deliberately: only 6/20 of the real
// contaminating listings even mentioned a year at all in the confirmed
// case; the other 14 ("Nathan Szerdy DC Comics Trade Dress Variant A
// /3000 Homage Cover") carry no year and would survive a per-item filter
// untouched. When poolYearHint conflicts with confirmedYear beyond
// tolerance, the call site (api/enrich.js) suppresses BOTH the
// extractConfirmedVariant recomputation AND the client-forwarded
// req.body.variant (which is where this exact bug lived — grade.js's own
// eBay-first path, api/grade.js:353, produced "exclusive limited signed"
// from an equally-contaminated separate pool fetch of the same photo, and
// extractConfirmedVariant's own gates never fired to correct it).
//
// Invoke: node tests/q127-variant-pool-year-conflict.test.js

import { extractConfirmedVariant, filterItemsByIssue, detectVariantPoolYearConflict } from '../src/lib/variantIdentity.js';

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
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q127 — VARIANT-POOL YEAR-CONFLICT GATE (Catwoman #64 Szerdy-variant class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — detectVariantPoolYearConflict: pure unit tests
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: detectVariantPoolYearConflict unit behavior\n');

assertNull(detectVariantPoolYearConflict(null, 2007), 'no poolYearHint at all → no conflict (nothing to check against)');
assertNull(detectVariantPoolYearConflict({ year: 2024, agreement: 1.0, sampleSize: 6 }, null), 'no confirmedYear yet → no conflict (nothing to check against)');
assertNull(detectVariantPoolYearConflict({ year: 2019, agreement: 0.8, sampleSize: 5 }, 2019), 'pool year matches confirmedYear exactly → no conflict');
assertNull(detectVariantPoolYearConflict({ year: 2019, agreement: 0.8, sampleSize: 5 }, 2021), 'pool year within tolerance (2y) of confirmedYear → no conflict');
assertNull(detectVariantPoolYearConflict({ year: 2019, agreement: 0.8, sampleSize: 5 }, 2024), 'pool year exactly at tolerance boundary (5y) → no conflict');

const conflict = detectVariantPoolYearConflict({ year: 2024, agreement: 1.0, sampleSize: 6 }, 2007);
assertTrue(!!conflict, 'pool year 17y beyond confirmedYear (the real Catwoman #64 case) → conflict detected');
assertEq(conflict?.poolYear, 2024, 'conflict object carries poolYear');
assertEq(conflict?.confirmedYear, 2007, 'conflict object carries confirmedYear');
assertEq(conflict?.drift, 17, 'conflict object carries correct drift');
assertEq(conflict?.poolAgreement, 1.0, 'conflict object carries poolAgreement');
assertEq(conflict?.poolSampleSize, 6, 'conflict object carries poolSampleSize');

const justOverTolerance = detectVariantPoolYearConflict({ year: 2013, agreement: 0.6, sampleSize: 4 }, 2007);
assertTrue(!!justOverTolerance, 'pool year 6y beyond confirmedYear (just past 5y tolerance) → conflict detected');
assertEq(justOverTolerance?.drift, 6, 'drift computed correctly just past the boundary');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — End-to-end reconstruction: the real Catwoman #64 case
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: Catwoman #64 — real production pool, end-to-end call-site simulation\n');

// Reconstructed from the real 20-item pool (production log, 17:38:12Z) —
// every item's issue is genuinely "64" (Q115's filter is a no-op here);
// 6/20 explicitly mention a year, and all 6 say 2024.
const catwoman64Pool = [
  { rawTitle: '🔥 CATWOMAN #64 NATHAN SZERDY 616 BALENT Homage Trade Variant A LTD 3000', issue: '64', year: null },
  { rawTitle: 'Catwoman #64 - Nathan Szerdy Exclusive Trade Dress Variant (LTD 3000)', issue: '64', year: null },
  { rawTitle: 'Catwoman #64 Nathan Szerdy DC Comics Trade Dress Variant A /3000 Homage Cover', issue: '64', year: null },
  { rawTitle: 'Catwoman #64 Nathan Szerdy Balent Homage Trade Variant A LTD 3000', issue: '64', year: null },
  { rawTitle: "Catwoman #64 (RARE Nathan Szerdy Balent Homage Trade Dress Variant Cover)", issue: '64', year: null },
  { rawTitle: 'Catwoman #64 - Nathan Szerdy Exclusive Trade Dress Variant (LTD 3000)', issue: '64', year: null },
  { rawTitle: 'Catwoman #64 Nathan Szerdy 2024 Exclusive Trade Variant (Balent Homage) LTD 3000', issue: '64', year: '2024' },
  { rawTitle: 'DC Catwoman #64 Nathan Szerdy Exclusive Variant Cover Single Issue Comic Book', issue: '64', year: null },
  { rawTitle: 'CATWOMAN #64 (NATHAN SZERDY EXCLUSIVE VARIANT) COMIC BOOK ~ DC 2024 Nine Lives 6', issue: '64', year: '2024' },
  { rawTitle: 'CATWOMAN #64 Howard Nathan Szerdy DC Comics Selina Kyle Superhero', issue: '64', year: null },
  { rawTitle: 'CATWOMAN #64 NATHAN SZERDY EXCLUSIVE VARIANT, Signed By Nathan Szerdy. NM', issue: '64', year: null },
  { rawTitle: 'Catwoman #64 Szerdy Trade Homage Variant, Ltd 3000, NM 9.4, 1st Print, 2024', issue: '64', year: '2024' },
  { rawTitle: 'Catwoman #64 Nathan Szerdy Trade Variant Homage 2024 DC Comics', issue: '64', year: '2024' },
  { rawTitle: 'Catwoman #64 Nathan Szerdy Exclusive Trade Variant Homage 2024 DC ~ LTD 3000', issue: '64', year: '2024' },
  { rawTitle: 'Catwoman #64 | 616 Comics Exclusive Variant A | Nathan Szerdy SIGNED | NM | 2024', issue: '64', year: '2024' },
  { rawTitle: 'Catwoman #64 Trade Dress Variant (Balent Homage) Nathan Szerdy Brand New', issue: '64', year: null },
  { rawTitle: 'DC Comics Catwoman #64 (2024) CGC 9.8 Nathan Szerdy Variant Cover A', issue: '64', year: null },
  { rawTitle: 'Catwoman #64 Nathan Szerdy Trade Dress Varaint NM', issue: '64', year: null },
  { rawTitle: 'CATWOMAN 64 NATHAN SZERDY COVER EXCLUSIVE VARIANT LIMITED TO 3000 DC COMICS', issue: '64', year: null },
  { rawTitle: "CATWOMAN #64 (NATHAN SZERDY EXCLUSIVE TRADE/VIRGIN VARIANT SET) ~ DC", issue: '64', year: null },
];

assertEq(catwoman64Pool.length, 20, 'pool has all 20 real production items');
assertEq(catwoman64Pool.filter((i) => i.issue === '64').length, 20, 'every item genuinely matches issue 64 — confirms Q115\'s filter is a structural no-op here');

// Confirm filterItemsByIssue really is a no-op — the pre-existing Q115 fix
// does nothing against this contamination shape (as the report predicted).
const q115Filtered = filterItemsByIssue(catwoman64Pool, '64');
assertEq(q115Filtered.length, 20, 'Q115 filterItemsByIssue removes 0/20 — confirms it cannot catch this contamination shape alone');

// Confirm the pre-fix bug reproduces: extractConfirmedVariant backfills a
// contaminated variant from the (issue-filter-unhelped) pool.
const preFixVariant = extractConfirmedVariant(catwoman64Pool, null, 2007, 'high');
assertTrue(!!preFixVariant, 'PRE-FIX: backfill fires on the unfiltered-by-year pool — reproduces the real bug');
assertTrue(
  (preFixVariant?.confirmedVariant || '').toLowerCase().includes('exclusive'),
  `PRE-FIX: confirmedVariant wrongly includes contamination-derived tokens (got "${preFixVariant?.confirmedVariant}")`
);

// THE FIX — poolYearHint (as enrich.js would have computed it from this
// exact pool: 6/20 explicit years, 100% agreement on 2024) vs the real
// confirmedYear (2007, from PriceCharting).
const poolYearHint = { year: 2024, agreement: 1.0, sampleSize: 6 };
const confirmedYear = 2007;
const yearConflict = detectVariantPoolYearConflict(poolYearHint, confirmedYear);
assertTrue(!!yearConflict, 'detectVariantPoolYearConflict fires on the real pool/confirmedYear pair (17y drift)');

// Simulates the exact api/enrich.js call-site logic post-fix.
{
  const reqBodyVariant = 'exclusive limited signed'; // what grade.js's eBay-first path actually sent
  let confirmedVariant = yearConflict ? null : (reqBodyVariant || null);
  assertNull(confirmedVariant, 'POST-FIX: confirmedVariant is null, not the contaminated client-forwarded string');

  const variantSourceItems = yearConflict ? [] : filterItemsByIssue(catwoman64Pool, '64');
  const variantCheck = yearConflict ? null : extractConfirmedVariant(variantSourceItems, reqBodyVariant, confirmedYear, 'high');
  assertNull(variantCheck, 'POST-FIX: extractConfirmedVariant is skipped entirely, never recomputes from the same pool');
  if (variantCheck) confirmedVariant = variantCheck.confirmedVariant; // (dead branch — documents the real call site's shape)
  assertNull(confirmedVariant, 'POST-FIX: confirmedVariant stays null through to the end of the block');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — Regression: Batman #608 / Captain Marvel #17 class must remain
// fixed (different contamination shape — issue mismatch, not year
// mismatch — already fixed by Q115/Q119/Q120/Q121, must be unaffected by
// this new, additive gate).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: regression — Batman #608 class (issue-mismatch shape) unaffected\n');

// Real Batman #608 pool has no coherent single-year hint strong enough to
// clear poolYearHint's own >=50% agreement bar (a genuinely scattered mix
// of 2006/1940/2024/2025/null across the 20 items) — so in production,
// poolYearHint itself would likely be null here, and this new gate simply
// doesn't engage; Q115's pre-existing issue-based filter (already
// regression-tested in tests/q115-variant-issue-filter.test.js) remains
// the mechanism that closes this case. Confirm the gate is inert absent a
// poolYearHint, i.e. it never fabricates a false conflict when there's no
// hint to conflict with.
assertNull(detectVariantPoolYearConflict(null, 2002), 'no poolYearHint for Batman #608 shape → gate stays inert, does not interfere with Q115\'s fix');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — Regression: a genuine SAME-year multi-variant book must not be
// blocked by this gate (Captain America #25 / Skottie Young class, from
// Q109/Q115's own test suite — confirmedYear and poolYearHint agree).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: regression — genuine same-year variant pool is not blocked\n');

const cap25Pool = [
  { rawTitle: 'Captain America #25 Skottie Young Variant Cover NM 2019', issue: '25', year: '2019' },
  { rawTitle: 'Captain America #25 Skottie Young Variant NM/M 2019', issue: '25', year: '2019' },
];
const cap25PoolYearHint = { year: 2019, agreement: 1.0, sampleSize: 2 };
const cap25Conflict = detectVariantPoolYearConflict(cap25PoolYearHint, 2019);
assertNull(cap25Conflict, 'poolYearHint (2019) agrees with confirmedYear (2019) → no conflict, gate does not engage');

const cap25Filtered = filterItemsByIssue(cap25Pool, '25');
const cap25Variant = extractConfirmedVariant(cap25Filtered, null, 2019, 'medium');
assertTrue(!!cap25Variant, 'genuine variant backfill still fires normally when the gate does not engage');
assertTrue(
  (cap25Variant?.confirmedVariant || '').toLowerCase().includes('skottie young'),
  `genuine "Skottie Young" variant is preserved, not suppressed (got "${cap25Variant?.confirmedVariant}")`
);

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
