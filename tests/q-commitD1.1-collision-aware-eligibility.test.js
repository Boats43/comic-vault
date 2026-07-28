// tests/q-commitD1.1-collision-aware-eligibility.test.js
//
// Commit D1.1 — collision-aware positive-compatibility gate. Live-confirmed
// defect: [evidence-eligibility] activeInput=5 rawPricingEligible=5
// rejected=0 on Batman #15's real active pool — 5 generic, undated
// listings with zero distinguishing edition information contributed
// unfiltered to the active average/floor/market-high warning because the
// base D1 classifier is a pure negative model (eligible unless an
// explicit mismatch fires) and none of these rows made an explicit false
// claim to reject.
//
// Invoke: node tests/q-commitD1.1-collision-aware-eligibility.test.js

import { classifyEvidenceRow, buildEvidencePopulations, assessCollisionRisk } from '../src/lib/evidenceEligibility.js';

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

console.log('\n=== Commit D1.1 — collision-aware positive-compatibility gate ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// assessCollisionRisk — unit behavior
// ══════════════════════════════════════════════════════════════════════════════
console.log('assessCollisionRisk unit behavior\n');
{
  const r = assessCollisionRisk({ confirmedYear: 1943, publisher: 'DC Comics', issue: '15' });
  assertEq(r.collisionRisk, 'high', 'Batman #15 (1943, DC): collisionRisk=high');
  assertTrue(r.requiredAxes.includes('publicationIdentity'), 'Batman #15: requiredAxes includes publicationIdentity');
  assertTrue(r.collisionReasons.length > 0, 'Batman #15: collisionReasons populated');
}
{
  // Non-vintage, non-major-publisher — low risk, missing year must NOT disqualify.
  const r = assessCollisionRisk({ confirmedYear: 2020, publisher: 'Indie Press', issue: '1' });
  assertEq(r.collisionRisk, 'low', '2020 indie one-shot: collisionRisk=low');
  assertFalse(r.requiredAxes.includes('publicationIdentity'), '2020 indie one-shot: publicationIdentity NOT required');
}
{
  // Modern DC/Marvel — publisher matches but not vintage — still low risk
  // (the collision class is specifically legacy-numbering vintage titles).
  const r = assessCollisionRisk({ confirmedYear: 2024, publisher: 'DC Comics', issue: '1' });
  assertEq(r.collisionRisk, 'low', '2024 DC (not vintage): collisionRisk=low');
}
{
  // No confirmedYear at all — cannot assess vintage, defaults low (never
  // the global "missing year = reject" rule the dispatch explicitly
  // prohibits).
  const r = assessCollisionRisk({ confirmedYear: null, publisher: 'DC Comics', issue: '15' });
  assertEq(r.collisionRisk, 'low', 'no confirmedYear: collisionRisk=low (never a blanket reject)');
}
{
  // Title text must NEVER factor into collision-risk assessment — the A3
  // canonical-title contamination bug is explicitly out of scope for
  // D1.1 and must not be inherited. assessCollisionRisk takes no title
  // field at all; confirm identical output regardless of what a caller
  // might have passed as (contaminated) seriesTitle.
  const clean = assessCollisionRisk({ confirmedYear: 1943, publisher: 'DC Comics', issue: '15', seriesTitle: 'Batman' });
  const contaminated = assessCollisionRisk({ confirmedYear: 1943, publisher: 'DC Comics', issue: '15', seriesTitle: 'batman ww2 machine gun' });
  assertEq(clean.collisionRisk, contaminated.collisionRisk, 'collision risk identical regardless of confirmedTitle contamination');
  assertEq(clean.requiredAxes, contaminated.requiredAxes, 'requiredAxes identical regardless of confirmedTitle contamination');
}

// ══════════════════════════════════════════════════════════════════════════════
// MANDATORY FIXTURE — Batman #15 active (live-confirmed defect)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Batman #15 active — 5 generic undated listings, exact production titles\n');
{
  const rows = [
    { title: 'Batman #15 DC Comics Comic Book', price: 8.49, marketState: 'active' },
    { title: 'BATMAN #15 DC COMICS', price: 4.99, marketState: 'active' },
    { title: 'BATMAN #15', price: 2.99, marketState: 'active' },
    { title: 'Batman #15 DC Universe Comic Book', price: 3.99, marketState: 'active' },
    { title: 'Batman # 15', price: 9.79, marketState: 'active' },
  ];
  const target = {
    issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, publisher: 'DC Comics',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };

  // Individually assert every row.
  rows.forEach((row, i) => {
    const c = classifyEvidenceRow(row, target);
    assertFalse(c.rawPricingEligible, `row ${i + 1} ("${row.title}"): rawPricingEligible=false`);
    assertFalse(c.floorEligible, `row ${i + 1}: floorEligible=false`);
    assertTrue(c.referenceOnly, `row ${i + 1}: referenceOnly=true`);
    assertTrue(includes(c.rejectionCodes, 'UNCONFIRMED_EDITION'), `row ${i + 1}: rejectionCodes includes UNCONFIRMED_EDITION`);
    assertFalse(includes(c.rejectionCodes, 'WRONG_YEAR'), `row ${i + 1}: NOT labeled WRONG_YEAR (made no affirmative false claim)`);
    assertTrue(c.identityEligible, `row ${i + 1}: identityEligible stays true (not asserted to be a different book)`);
  });

  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 0, 'activeInput=5: rawPricingEligible=0');
  assertEq(pops.unconfirmedEditionReferences.length, 5, 'unconfirmedEditionReferences=5');
  assertEq(pops.incompatibleEditionReferences.length, 0, 'none miscategorized as incompatibleEditionReferences (they made no false claim)');
  assertEq(pops.rejectionCodeCounts.UNCONFIRMED_EDITION, 5, 'rejectionCodeCounts.UNCONFIRMED_EDITION=5 (bounded per-code summary)');

  // Price must never serve as identity evidence — the $2.99 row and the
  // $9.79 row must be classified identically (both UNCONFIRMED_EDITION),
  // proving price played no role in the decision.
  const cheap = classifyEvidenceRow(rows[2], target); // $2.99
  const priciest = classifyEvidenceRow(rows[4], target); // $9.79
  assertEq(cheap.rejectionCodes, priciest.rejectionCodes, 'price ($2.99 vs $9.79) plays no role — identical classification');
}

// Control: the SAME 5 rows against a LOW-collision-risk target (non-
// vintage, non-major-publisher) must NOT be excluded — proves this is
// collision-aware, not a blanket "missing year = reject."
{
  const rows = [
    { title: 'Some Comic #1 Indie Press Comic Book', price: 8.49, marketState: 'active' },
    { title: 'SOME COMIC #1', price: 2.99, marketState: 'active' },
  ];
  const target = {
    issue: '1', seriesTitle: 'Some Comic', confirmedYear: 2020, publisher: 'Indie Press',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 2, 'control: non-collision-risk target — undated rows are NOT rejected (no global missing-year rule)');
  assertEq(pops.unconfirmedEditionReferences.length, 0, 'control: zero UNCONFIRMED_EDITION rejections for a non-collision-risk target');
}

// ══════════════════════════════════════════════════════════════════════════════
// MANDATORY FIXTURE — Batman #15 incomplete sold row (deterministic,
// individually asserted — not aggregate-count-only)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Batman #15 incomplete sold row (individually asserted)\n');
{
  const row = {
    title: 'Batman 15 missing CF 2 CF loose 1/3 BC missing 1943 Chewed Bottom Corner',
    price: 418, year: 1943, marketState: 'sold',
  };
  const target = {
    issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, publisher: 'DC Comics',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const c = classifyEvidenceRow(row, target);
  assertTrue(includes(c.rejectionCodes, 'INCOMPLETE_COPY'), 'INCOMPLETE_COPY present');
  assertFalse(c.rawPricingEligible, 'rawPricingEligible=false');
  assertTrue(c.referenceOnly, 'referenceOnly=true');
  // This row DOES carry "1943" — confirms INCOMPLETE_COPY fired on its own
  // merits, not as a side effect of also being UNCONFIRMED_EDITION.
  assertFalse(includes(c.rejectionCodes, 'UNCONFIRMED_EDITION'), 'NOT also flagged UNCONFIRMED_EDITION — this row states its year (1943), the defect is completeness, not edition evidence');
}

// Bounded production summary broken out by rejection code — proves WHICH
// classifications produced a given pool reduction, not just aggregate
// before/after counts.
{
  const rows = [
    { title: 'Batman #15 (DC, 1943) GD 2.0 Condition: GD', price: 250, year: 1943, marketState: 'sold' },
    { title: 'Batman 15 missing CF 2 CF loose 1/3 BC missing 1943 Chewed Bottom Corner', price: 418, year: 1943, marketState: 'sold' },
    { title: 'Batman #15 restored professional restoration 1943', price: 400, year: 1943, marketState: 'sold' },
    { title: 'BATMAN #15 CGC 4.5 1943', price: 900, year: 1943, marketState: 'sold' },
  ];
  const target = {
    issue: '15', seriesTitle: 'Batman', confirmedYear: 1943, publisher: 'DC Comics',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 1, 'bounded summary fixture: 1 genuine row survives (GD 2.0)');
  assertEq(pops.rejectionCodeCounts.INCOMPLETE_COPY, 1, 'rejectionCodeCounts: INCOMPLETE_COPY=1 (the missing-CF row)');
  assertEq(pops.rejectionCodeCounts.RESTORED_COPY, 1, 'rejectionCodeCounts: RESTORED_COPY=1 (the restoration row)');
  assertEq(pops.rejectionCodeCounts.FORMAT_MISMATCH_RAW_VS_SLAB, 1, 'rejectionCodeCounts: FORMAT_MISMATCH_RAW_VS_SLAB=1 (the CGC row)');
  assertFalse('UNCONFIRMED_EDITION' in pops.rejectionCodeCounts, 'no UNCONFIRMED_EDITION here — every row states its year (1943)');
}

// ══════════════════════════════════════════════════════════════════════════════
// MANDATORY FIXTURE — Flash #139 graded row (deterministic regression,
// required regardless of live search results). Flash 1963/DC is ITSELF a
// high-collision-risk target — this fixture proves UNCONFIRMED_EDITION
// does not break the pre-existing D1 gradedPricingEligible=true guarantee.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Flash #139 graded row (deterministic, recorded regardless of live search)\n');
{
  const row = { title: 'Flash #139 2.5 Cgc Menace Of The Reverse Flash', price: 300, marketState: 'active' };
  const target = {
    issue: '139', seriesTitle: 'The Flash', confirmedYear: 1963, publisher: 'DC Comics',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  // Confirm this target IS itself high collision-risk (Flash 1963/DC) —
  // makes the gradedPricingEligible=true assertion below meaningful, not
  // accidental (this row has no year token either, and would be
  // UNCONFIRMED_EDITION on the rawPricing axis too).
  const risk = assessCollisionRisk(target);
  assertEq(risk.collisionRisk, 'high', 'Flash #139 (1963, DC) is itself a high collision-risk target');

  const c = classifyEvidenceRow(row, target);
  assertTrue(includes(c.rejectionCodes, 'FORMAT_MISMATCH_RAW_VS_SLAB'), 'FORMAT_MISMATCH_RAW_VS_SLAB present');
  assertFalse(c.rawPricingEligible, 'rawPricingEligible=false');
  assertTrue(c.gradedPricingEligible, 'gradedPricingEligible=true — NOT broken by the new UNCONFIRMED_EDITION check');
  assertFalse(c.floorEligible, 'floorEligible=false');
  assertTrue(c.referenceOnly, 'referenceOnly=true');

  const pops = buildEvidencePopulations([row], target);
  assertEq(pops.rawPricingPool.length, 0, 'excluded from raw active pool');
  assertEq(pops.gradedPricingReferences.length, 1, 'still retained in gradedPricingReferences (bucket priority: format mismatch wins over unconfirmed-edition for display)');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
