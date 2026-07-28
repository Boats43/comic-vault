// tests/q-commitD1-evidence-eligibility.test.js
//
// Commit D1 — "Classify first, then derive." Tests classifyEvidenceRow /
// buildEvidencePopulations (src/lib/evidenceEligibility.js) directly, plus
// the wiring into verifySoldComps (src/lib/soldVerification.js) and
// fetchComps (api/comps.js) via the 5 mandatory fixtures named in the D1
// dispatch, plus the zero-eligible-pool safe-default acceptance criterion
// (same failure class as Commit C's filterByCategory <5 safety gate).
//
// Invoke: node tests/q-commitD1-evidence-eligibility.test.js

import { classifyEvidenceRow, buildEvidencePopulations, INCOMPLETE_COPY_RE, RESTORED_TITLE_RE } from '../src/lib/evidenceEligibility.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const includes = (arr, v) => Array.isArray(arr) && arr.includes(v);

console.log('\n=== Commit D1 — evidence-eligibility classification ===\n');

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture 1 — Batman #15 incomplete sold row
// ══════════════════════════════════════════════════════════════════════════════
console.log('Fixture 1: Batman #15 incomplete sold row — real production title\n');
{
  const row = {
    title: 'Batman 15 missing CF 2 CF loose 1/3 BC missing 1943 Chewed Bottom Corner',
    price: 250, year: 1943, marketState: 'sold',
  };
  const target = {
    issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, variant: null,
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const c = classifyEvidenceRow(row, target);
  assertFalse(c.rawPricingEligible, 'incomplete row: rawPricingEligible=false');
  assertFalse(c.floorEligible, 'incomplete row: floorEligible=false');
  assertTrue(c.referenceOnly, 'incomplete row: referenceOnly=true');
  assertTrue(includes(c.rejectionCodes, 'INCOMPLETE_COPY'), 'rejectionCodes includes INCOMPLETE_COPY');

  const pops = buildEvidencePopulations([row], target);
  assertEq(pops.rawPricingPool.length, 0, 'excluded from rawPricingPool');
  assertEq(pops.incompleteReferences.length, 1, 'retained in incompleteReferences');
  assertEq(pops.incompleteReferences[0].title, row.title, 'sanitized record preserves title');
  assertFalse('seller' in pops.incompleteReferences[0], 'sanitized record has no seller field');
}

// Do not assign INCOMPLETE_COPY merely for a loose-but-present centerfold.
{
  const looseOnly = { title: 'Batman #15 1943 GD 2.0 centerfold loose but present', price: 200, year: 1943, marketState: 'sold' };
  assertFalse(INCOMPLETE_COPY_RE.test(looseOnly.title), 'INCOMPLETE_COPY_RE does not fire on "loose" alone');
  const target = { issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const c = classifyEvidenceRow(looseOnly, target);
  assertFalse(includes(c.rejectionCodes, 'INCOMPLETE_COPY'), 'loose-but-present centerfold: no INCOMPLETE_COPY code');
}

// ══════════════════════════════════════════════════════════════════════════════
// Fixture 2 — Flash #139 graded active row
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: Flash #139 graded active row (evades SLAB_RE’s number-before-CGC ordering)\n');
{
  const row = { title: 'Flash #139 2.5 Cgc Menace Of The Reverse Flash', price: 300, year: 1963, marketState: 'active' };
  const target = {
    issue: '139', seriesTitle: 'The Flash', confirmedYear: 1963, variant: null,
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const c = classifyEvidenceRow(row, target);
  assertFalse(c.rawPricingEligible, 'graded row vs raw target: rawPricingEligible=false');
  assertTrue(c.gradedPricingEligible, 'graded row vs raw target: gradedPricingEligible=true');
  assertFalse(c.floorEligible, 'graded row vs raw target: floorEligible=false');
  assertTrue(c.referenceOnly, 'graded row vs raw target: referenceOnly=true');
  assertTrue(includes(c.rejectionCodes, 'FORMAT_MISMATCH_RAW_VS_SLAB'), 'rejectionCodes includes FORMAT_MISMATCH_RAW_VS_SLAB');

  const pops = buildEvidencePopulations([row], target);
  assertEq(pops.rawPricingPool.length, 0, 'excluded from raw active pool');
  assertEq(pops.gradedPricingReferences.length, 1, 'retained in gradedPricingReferences');
}

// ══════════════════════════════════════════════════════════════════════════════
// Fixture 3 — Batman #15 incompatible active market
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: Batman #15 incompatible active market ($2.99-$9.79 generic listings)\n');
{
  // Representative of the class this fixture targets: reprint/facsimile-
  // labeled compilations and an explicitly modern-dated relaunch listing.
  // Real production titles for the specific live pool were not captured in
  // application logs (no per-item title dump exists at that point in
  // api/comps.js today) — this fixture is verified against the LIVE
  // re-scan after deploy per the Delivery section, not claimed closed here
  // beyond what these signals can prove synthetically.
  const rows = [
    { title: 'Batman #15 DC Classics Library Reproduction Edition', price: 3.99, year: null, marketState: 'active' },
    { title: 'Batman #15 (2017) VF/NM Modern Run', price: 5.99, year: 2017, marketState: 'active' },
    { title: 'Batman The Golden Age Omnibus Vol 2 facsimile reprint #15 story', price: 9.79, year: null, marketState: 'active' },
    { title: 'Batman #15 1943 GD 2.0 WWII Machine Gun Cover', price: 650, year: 1943, marketState: 'active' }, // genuine, must survive
  ];
  const target = {
    issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, variant: null,
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 1, 'only the genuine 1943 row survives to rawPricingPool');
  assertEq(pops.rawPricingPool[0].price, 650, 'surviving row is the genuine $650 comp, not a $3.99-$9.79 one');
  assertTrue(pops.incompatibleEditionReferences.length >= 2, 'reprint/wrong-year listings retained as incompatibleEditionReferences, not silently blended');
  const rejectedTitles = pops.incompatibleEditionReferences.map((r) => r.title);
  assertTrue(rejectedTitles.some((t) => t.includes('Reproduction')), 'reproduction-edition listing excluded with a code, not vanished');
  assertTrue(rejectedTitles.some((t) => t.includes('2017')), 'wrong-year 2017 listing excluded with a code, not vanished');
}

// ══════════════════════════════════════════════════════════════════════════════
// Fixture 4 — existing Batman slab-only fallback (CGC 0.5 active listing)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: slab-only pool for a raw target — the slab cannot become the sole comp\n');
{
  const rows = [
    { title: 'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover', price: 650, year: 1943, marketState: 'active' },
  ];
  const target = {
    issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, variant: null,
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 0, 'lone CGC row never becomes the raw pricing pool');
  assertEq(pops.gradedPricingReferences.length, 1, 'lone CGC row demoted to a graded reference instead');
  // This is the exact shape api/comps.js's fetchComps now checks
  // (evidencePopulations.rawPricingPool.length === 0) to return emptyComps
  // instead of letting a v0-I-admitted slab become the sole comp — verified
  // by source-presence below (D1 acceptance criterion), not re-simulated
  // here (fetchComps needs live eBay credentials to exercise end-to-end).
}

// ══════════════════════════════════════════════════════════════════════════════
// Fixture 5 — Absolute Batman mixed editions (target: #1 second printing)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture 5: Absolute Batman #1 second printing — no wrong issue or incompatible edition blends in\n');
{
  const rows = [
    { title: 'Absolute Batman #1 second printing NM', price: 20, year: 2024, marketState: 'active' },  // matches target exactly
    { title: 'Absolute Batman #2 second printing NM', price: 15, year: 2024, marketState: 'active' },  // wrong issue
    { title: 'Absolute Batman #1 first printing NM', price: 45, year: 2024, marketState: 'active' },    // wrong printing (target IS 2nd print)
    { title: 'Absolute Batman #1 foil variant', price: 80, year: 2024, marketState: 'active' },         // wrong variant
    { title: 'Absolute Batman #1 virgin foil', price: 150, year: 2024, marketState: 'active' },         // wrong variant
    { title: 'Absolute Batman #1 second printing', price: 22, year: 2024, marketState: 'active' },      // second genuine match
  ];
  const target = {
    issue: '1', seriesTitle: 'Absolute Batman', confirmedYear: 2024, variant: 'second printing',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 2, 'only the two genuine "second printing" #1 rows survive');
  assertTrue(pops.rawPricingPool.every((r) => r.price === 20 || r.price === 22), 'surviving prices are exactly the two genuine rows ($20, $22)');
  const excludedTitles = [
    ...pops.incompatibleEditionReferences,
    ...pops.rejectedEvidence,
  ].map((r) => r.title);
  assertTrue(excludedTitles.some((t) => t.includes('#2 second printing')), 'wrong-issue #2 excluded');
  assertTrue(excludedTitles.some((t) => t.includes('first printing')), 'wrong-printing (1st print vs 2nd-print target) excluded');
  assertTrue(excludedTitles.some((t) => t === 'Absolute Batman #1 foil variant'), 'foil variant excluded');
  assertTrue(excludedTitles.some((t) => t === 'Absolute Batman #1 virgin foil'), 'virgin foil excluded');
  assertEq(pops.rawPricingPool.length + pops.gradedPricingReferences.length + pops.incompleteReferences.length + pops.incompatibleEditionReferences.length + pops.rejectedEvidence.length, rows.length, 'every row lands in exactly one bucket — none silently dropped');
}

// ══════════════════════════════════════════════════════════════════════════════
// D1 additional acceptance criterion — zero-eligible-pool routes to a safe
// default, never a fallback that resurrects rejected evidence (same
// failure class as Commit C's filterByCategory <5 safety gate).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nD1 acceptance criterion: all-ineligible pool never resurrects rejected evidence\n');
{
  const rows = [
    { title: 'Batman 15 missing CF 2 CF loose 1/3 BC missing 1943', price: 250, year: 1943, marketState: 'sold' },
    { title: 'Batman #15 restored professional restoration 1943', price: 400, year: 1943, marketState: 'sold' },
  ];
  const target = { issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 0, 'all-ineligible pool: rawPricingPool is empty');
  assertEq(pops.incompleteReferences.length, 2, 'both rows retained as sanitized incomplete/restored references, not discarded');
  assertFalse(RESTORED_TITLE_RE.test('unrestored'), 'RESTORED_TITLE_RE word-boundary: does not false-positive on "unrestored"');
}

// verifySoldComps end-to-end wiring: classification-caught rows are
// excluded from `verified` even when the existing filter chain has no
// detector for them at all.
{
  const rawRows = [
    { title: 'Batman #15 (DC, 1943) GD 2.0 Condition: GD', price: 250, daysAgo: 30, grade: null, year: 1943 },
    { title: 'Batman 15 missing CF 2 CF loose 1/3 BC missing 1943 Chewed Bottom Corner', price: 418, daysAgo: 45, grade: null, year: 1943 },
  ];
  const result = verifySoldComps(rawRows, {
    title: 'Batman', issue: '15', variant: null, bookYear: 1943, userGradeKey: 'raw', assessedGrade: 'GD 2.0',
  });
  assertEq(result.verified.length, 1, 'verifySoldComps: incomplete row excluded even though no existing filter caught it');
  assertFalse(result.verified.some((r) => r.price === 418), '$418 incomplete-copy row is not among verified sold comps');
  assertTrue(!!result.evidence, 'verifySoldComps return carries evidence populations');
  assertEq(result.evidence.incompleteReferences.length, 1, 'evidence.incompleteReferences carries the excluded row');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
