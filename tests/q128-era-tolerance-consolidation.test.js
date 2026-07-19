// tests/q128-era-tolerance-consolidation.test.js
//
// Q128 dispatch (2026-07-19, Harley Quinn #62 systemic year-tolerance
// audit) — a third, independent instance of the "same title, same issue#,
// different year" contamination shape (Catwoman #64/Q127), this time in
// the ACTIVE comp pool itself (api/comps.js Filter 0c), not the variant-
// consensus computation Q127 fixed.
//
// CONFIRMED via direct production log (deployment dpl_FcaXCbwE3J9HrwWysu7ZfLM2FY2X,
// build fac7b7e, 18:45:26Z): a real Harley Quinn #62 card (confirmedYear
// 2019, ComicVine vol_id 92750) had an active listing "harley quinn #62
// (2016) guillem march 1st print ~ nm" survive Filter 0c and contribute to
// the final $4.95 price. diff=|2016-2019|=3, Filter 0c's modern-era
// tolerance is ±3 — a boundary-inclusive pass, not a wide-bucket or
// missing-year escape valve (both hypotheses checked and ruled out).
//
// SYSTEMIC FINDING: at least two independently-maintained copies of this
// exact tolerance formula existed — api/comps.js Filter 0c (±3 modern) and
// src/lib/soldVerification.js's yearMismatch check (±2 modern, in TWO
// places — main pass and fallback pass) — and soldVerification.js's OWN
// comment claimed to "mirror active Filter 0c" while using a different
// number. Already-drifted, not just theoretically driftable.
//
// PRODUCT QUESTION RESOLVED VIA DIRECT COMICVINE LOOKUP (not guessed):
// queried ComicVine's /volumes/ endpoint directly for vol_id 92750 (the
// exact volume this card's issue #62 resolves to, confirmed via the same
// production log's own "[comicvine] volDetails fetched: 1/1 —
// 92750:Harley Quinn(2016,DC Comics)" line) — ComicVine's own canonical
// record independently confirms start_year=2016 for THIS SPECIFIC volume.
// The "(2016)" comp is therefore NOT wrong-volume contamination — it's a
// legitimate comp using the standard back-issue-seller convention of
// labeling with the series' volume-launch year rather than the specific
// issue's cover date. Blanket-tightening the tolerance (Option 1) was
// explicitly rejected in favor of a corroboration check (Option 2),
// consistent with the Pattern Library's Renumbered-franchise entry, which
// already found a stricter numeric year-tolerance rejects genuinely
// legitimate comps (Fantastic Four #187, 12/98 false rejections).
//
// Fix: getEraYearTolerance + evaluateEraYearMatch (src/lib/compHygiene.js)
// — single source of truth for the tolerance value AND the keep/reject
// decision, reused by api/comps.js Filter 0c and both soldVerification.js
// passes. evaluateEraYearMatch checks confirmedYear tolerance first, then
// falls back to a volume-label match (isVolumeLabelYear, ±1y against the
// confirmed book's own ComicVine volume start year) before rejecting.
//
// Invoke: node tests/q128-era-tolerance-consolidation.test.js

import {
  getEraYearTolerance,
  isVolumeLabelYear,
  evaluateEraYearMatch,
} from '../src/lib/compHygiene.js';

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

console.log('\n=== Q128 — ERA/YEAR TOLERANCE CONSOLIDATION (Harley Quinn #62 systemic audit) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — getEraYearTolerance: single source of truth, matches the
// values both api/comps.js's Filter 0c and (post-fix) soldVerification.js
// now share.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: getEraYearTolerance — consolidated era bands\n');

assertEq(getEraYearTolerance(1940), 5, 'Golden Age (1940) — ±5y');
assertEq(getEraYearTolerance(1965), 5, 'Silver Age (1965) — ±5y');
assertEq(getEraYearTolerance(1969), 5, 'boundary: 1969 (< 1970) — ±5y');
assertEq(getEraYearTolerance(1970), 3, 'boundary: 1970 — ±3y (Bronze)');
assertEq(getEraYearTolerance(1980), 3, 'Bronze Age (1980) — ±3y');
assertEq(getEraYearTolerance(1984), 3, 'boundary: 1984 (< 1985) — ±3y');
assertEq(getEraYearTolerance(1985), 3, 'boundary: 1985 (Modern) — ±3y');
assertEq(getEraYearTolerance(2019), 3, 'Modern (2019) — ±3y, unchanged from comps.js\'s existing value');
assertEq(getEraYearTolerance(null), 3, 'unparseable year — safe default ±3y');
assertEq(getEraYearTolerance('not a year'), 3, 'non-numeric input — safe default ±3y');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — isVolumeLabelYear: the corroboration primitive
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: isVolumeLabelYear — volume-label corroboration\n');

assertTrue(isVolumeLabelYear(2016, 2016), 'exact match to volume start year');
assertTrue(isVolumeLabelYear(2017, 2016), '±1y fuzz on volume start year (some sellers off-by-one)');
assertEq(isVolumeLabelYear(2015, 2016), true, '±1y the other direction');
assertEq(isVolumeLabelYear(2014, 2016), false, '2y off volume start year — not a label match');
assertEq(isVolumeLabelYear(null, 2016), false, 'null listing year — no match');
assertEq(isVolumeLabelYear(2016, null), false, 'null cvVolumeStartYear (no CV resolution) — no match, not a false accept');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — evaluateEraYearMatch: the real Harley Quinn #62 case,
// reconstructed exactly from the production log.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: evaluateEraYearMatch — real Harley Quinn #62 reconstruction\n');

const confirmedYear = 2019;
const cvVolumeStartYear = 2016; // ComicVine vol_id 92750's own start_year, confirmed via direct API lookup
const tolerance = getEraYearTolerance(confirmedYear);
assertEq(tolerance, 3, 'confirmedYear=2019 uses the modern ±3y tolerance');

const realCase = evaluateEraYearMatch(2016, confirmedYear, tolerance, cvVolumeStartYear);
assertTrue(realCase.keep, 'the real "(2016) Guillem March 1st print" comp is KEPT — confirmed legitimate, not contamination');
assertEq(realCase.matchedVia, 'confirmed-year', 'kept via the ORDINARY tolerance check (diff=3 is exactly at ±3, boundary-inclusive) — corroboration not even needed for this exact numeric case');

// A slightly larger drift than the real case (e.g. a book cover-dated
// 2020 rather than 2019) WOULD exceed the ±3 tolerance on its own —
// confirms the corroboration path is real and load-bearing, not dead
// code that happens to never fire for this exact production value.
const largerDriftCase = evaluateEraYearMatch(2016, 2020, getEraYearTolerance(2020), cvVolumeStartYear);
assertTrue(largerDriftCase.keep, 'a 4y drift (2016 vs 2020) exceeds ±3 alone, but is kept via volume-label corroboration');
assertEq(largerDriftCase.matchedVia, 'volume-label', 'this one is genuinely kept BY the corroboration mechanism, not the base tolerance');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — genuine contamination (Batman #608 class) must still reject:
// a year that matches NEITHER confirmedYear tolerance NOR the confirmed
// volume's own start year.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: genuine wrong-volume contamination still rejects\n');

// Batman #608 (2002) — a Dell'Otto-painted, wholly unrelated DC variant
// listing dated 2024 matches neither confirmedYear=2002 nor any real CV
// volume start year for THIS Batman ongoing (which long predates 2024).
const contaminationCase = evaluateEraYearMatch(2024, 2002, getEraYearTolerance(2002), 1940);
assertEq(contaminationCase.keep, false, 'a 2024-dated listing on a 2002 book, with no matching volume label, is correctly rejected');
assertEq(contaminationCase.matchedVia, null, 'no match path — genuine rejection, not a false volume-label accept');

// No CV resolution at all (cvVolumeStartYear null) — must not silently
// admit everything; the mechanism should degrade to ordinary tolerance
// behavior, not become permissive by default.
const noCvCase = evaluateEraYearMatch(2016, 2019, 3, null);
assertTrue(noCvCase.keep, 'without CV data, the real case is STILL kept — because diff=3 already clears the base tolerance on its own');
assertEq(noCvCase.matchedVia, 'confirmed-year', 'correctly attributed to the base tolerance, not a phantom volume-label match');

const noCvContaminationCase = evaluateEraYearMatch(2024, 2002, 3, null);
assertEq(noCvContaminationCase.keep, false, 'without CV data, a genuine contamination case is still correctly rejected (no false permissiveness)');

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — drift-closure proof: soldVerification.js's modern tolerance
// was ±2 (independently drifted from comps.js's ±3, despite its own
// comment claiming to "mirror" it) — post-consolidation, both read from
// the exact same getEraYearTolerance, so the modern band is now
// identical everywhere.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: drift closure — soldVerification.js and comps.js now share one value\n');

// This is the diff that soldVerification.js's OLD inline ±2 would have
// rejected but comps.js's ±3 would have kept — the exact drift gap.
const driftGapDiff = 3;
const driftGapCase = evaluateEraYearMatch(2019 - driftGapDiff, 2019, getEraYearTolerance(2019));
assertTrue(driftGapCase.keep, 'a diff=3 modern-era comp is kept — this is the exact case soldVerification.js\'s old ±2 would have wrongly rejected while comps.js\'s ±3 admitted it');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
