// tests/grailkey-dispatch-19-fix6-year-rescue.test.js
//
// GrailKey Dispatch 19 (2026-08-07) — Fix 6, corrected and shipped.
//
// Real production scan: Spawn #351 Cover C Brett Booth Virgin,
// 2026-08-07 20:40:36 UTC, POST /api/enrich, dep=dpl_4mwr6MwTQZ7m4CxsZQFdjoaXr1SW.
// Commit 4.1 adopted year=2024 (family-scoped, support=3/4=75%) —
// `[commit4.1] identityProvisionalFields += 'year' (family-scoped
// adoption): year=2024 support=3/4` — but `resolveYear` fell through to
// Vision's own literal "Unknown" sentinel (yearSource='vision-fallback',
// not JS null) and overwrote it: `[identity-write] field=confirmedYear
// from="2024" (source=unknown) to="Unknown" (source=vision-fallback)
// site=resolve-year`. `deriveProvisionalYearBackfill`/commit-p2 did not
// rescue it: its `currentConfirmedYear != null` guard fails on the
// literal string "Unknown" (not null), and its
// `highConfidenceMarketplaceConsensus` gate was also false on this exact
// scan (weightSum=11 vs HIGH_CONFIDENCE_WEIGHT_FLOOR=12 — see the
// Pattern Library "commit-p near-miss" entry, item 2 of this same
// dispatch). `rescueYearFromVisionFallback` (src/lib/issueAuthority.js)
// closes this independently of both of those gates.
//
// Also regression-corrects Dispatch 15/16's own misreading of this log
// shape: the originally-queued Fix 6 design ("thread poolYearHint into
// resolveYear") conflated `[commit4.1]`'s "year=2024 support=3/4" line
// (a DIFFERENT signal — family-scoped adoption) with `poolYearHint`
// (which was "2020 agreement=50% (3/6)" on this same real scan — a
// different, wrong number). This function reads familyYearConsensus
// only; poolYearHint is not a parameter.

import { rescueYearFromVisionFallback } from '../src/lib/issueAuthority.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertNull = (actual, label) => assertEq(actual, null, label);

console.log('\n=== GrailKey Dispatch 19 — Fix 6 (rescueYearFromVisionFallback) ===\n');

// ─── SECTION 1 — the real Spawn #351 fixture, verbatim from the scan ───
const REAL_FAMILY_YEAR_CONSENSUS = { mode: 'adopted', year: 2024, support: 3, uniqueRows: 4 };

console.log('-- Section 1: real Spawn #351 production shape (20:40:36 scan) --');
{
  const result = rescueYearFromVisionFallback('vision-fallback', REAL_FAMILY_YEAR_CONSENSUS);
  assertEq(result?.year, '2024', 'fires and returns the family-scoped year, not Vision\'s "Unknown"');
  assertEq(result?.meta?.source, 'family-consensus-vision-fallback-rescue', 'meta.source identifies the rescue distinctly from commit-p2\'s own source string');
  assertEq(result?.meta?.confidence, 'provisional', 'confidence stays provisional — never promoted to proven by a marketplace-only vote');
}

// ─── SECTION 2 — never fires when resolveYear found ANY real corroboration ───
console.log('\n-- Section 2: any independent corroboration must NOT be overridden --');
{
  const independentSources = [
    'ebay-consensus', 'pc-cv-agreement', 'pricecharting', 'comicvine',
    'pricecharting-fallback', 'comicvine-fallback', 'vision-rejected-override',
    'pc-product-tolerated', 'comp-consensus-backfill', 'family-consensus-provisional',
  ];
  for (const src of independentSources) {
    assertNull(rescueYearFromVisionFallback(src, REAL_FAMILY_YEAR_CONSENSUS), `yearSource="${src}" — declines, resolveYear already had something better`);
  }
}

// ─── SECTION 3 — never fires without a genuine family-scoped adoption ───
console.log('\n-- Section 3: no qualifying family year consensus --');
{
  assertNull(rescueYearFromVisionFallback('vision-fallback', null), 'null familyYearConsensus — declines');
  assertNull(rescueYearFromVisionFallback('vision-fallback', undefined), 'undefined familyYearConsensus — declines');
  assertNull(rescueYearFromVisionFallback('vision-fallback', { mode: 'no-consensus', year: 2024, support: 3, uniqueRows: 4 }), 'mode=no-consensus — declines (Q140 standing constraint: never adopt on anything but a real vote)');
  assertNull(rescueYearFromVisionFallback('vision-fallback', { mode: 'conflict-locked', year: 2024, support: 3, uniqueRows: 4 }), 'mode=conflict-locked — declines, a locked conflict is never silently resolved');
  assertNull(rescueYearFromVisionFallback('vision-fallback', { mode: 'corroborated', year: 2024, support: 3, uniqueRows: 4 }), 'mode=corroborated — declines (this function is for ADOPTED-mode gaps specifically, matching commit-p2\'s own scope)');
}

// ─── SECTION 4 — support floor, exactly matching commit-p2's own bar ───
console.log('\n-- Section 4: support >= 3 floor (same bar as commit-p2, validated by this real 3/4=75% case) --');
{
  assertNull(rescueYearFromVisionFallback('vision-fallback', { mode: 'adopted', year: 2024, support: 2, uniqueRows: 3 }), 'support=2 — below the floor, declines');
  const atFloor = rescueYearFromVisionFallback('vision-fallback', { mode: 'adopted', year: 2024, support: 3, uniqueRows: 5 });
  assertEq(atFloor?.year, '2024', 'support=3 (the real scan\'s own value) — clears the floor, fires');
  const aboveFloor = rescueYearFromVisionFallback('vision-fallback', { mode: 'adopted', year: 2019, support: 5, uniqueRows: 5 });
  assertEq(aboveFloor?.year, '2019', 'support=5 — well above the floor, fires');
}

// ─── SECTION 5 — yearSource must be the exact string 'vision-fallback' ───
console.log('\n-- Section 5: yearSource gate is exact-match, not a loose truthy check --');
{
  assertNull(rescueYearFromVisionFallback(null, REAL_FAMILY_YEAR_CONSENSUS), 'null yearSource — declines');
  assertNull(rescueYearFromVisionFallback(undefined, REAL_FAMILY_YEAR_CONSENSUS), 'undefined yearSource — declines');
  assertNull(rescueYearFromVisionFallback('', REAL_FAMILY_YEAR_CONSENSUS), 'empty-string yearSource — declines');
  assertNull(rescueYearFromVisionFallback('vision', REAL_FAMILY_YEAR_CONSENSUS), '"vision" (the plain default, not the fallback branch) — declines, only the literal fallback string qualifies');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
