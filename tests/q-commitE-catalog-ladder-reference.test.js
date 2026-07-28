// tests/q-commitE-catalog-ladder-reference.test.js
//
// Commit E — catalog ladder reference. Tests assessCatalogLadderReference
// (src/lib/evidenceEligibility.js) directly — a new, aggregate reference
// bucket in the same family as buildEvidencePopulations' per-row buckets,
// fired ONLY when there is zero comp-based evidence at all (both
// rawPricingPool and gradedPricingReferences empty, active AND sold sides),
// an exact PriceCharting anchor was accepted, and the ladder has an EXACT
// value at the confirmed-grade key (no interpolation, no nearest-neighbor).
//
// Per instruction, this suite does NOT use Batman #15 (retired for this
// layer, Commit D close entry) — a synthetic fixture is constructed
// instead: exact PC anchor accepted, a real grade rung present, zero
// eligible rawPricingPool AND zero eligible gradedPricingReferences.
//
// Invoke: node tests/q-commitE-catalog-ladder-reference.test.js

import { assessCatalogLadderReference } from '../src/lib/evidenceEligibility.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Commit E — catalog ladder reference ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Synthetic fixture — a genuinely thin book: low print run, rarely traded,
// not thin because contamination was correctly removed. Exact PC anchor
// accepted, a real grade rung present (9.4), zero eligible rawPricingPool
// AND zero eligible gradedPricingReferences post-classification.
// ══════════════════════════════════════════════════════════════════════════════
console.log('Fixture: synthetic thin book — exact PC anchor + direct grade rung, zero comp evidence\n');
{
  const priceLadder = { raw: 12.50, '8.0': 45, '9.0': 78, '9.4': 145, '9.6': 240, '9.8': 410 };
  const base = {
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder,
    gradeKey: '9.4',
  };
  const result = assessCatalogLadderReference(base);
  assertTrue(!!result, 'fires when all 4 trigger conditions are met');
  assertEq(result.pricingSource, 'catalog_ladder_reference', 'pricingSource is catalog_ladder_reference');
  assertEq(result.valuationAuthority, 'compatible-reference', 'valuationAuthority is compatible-reference');
  assertEq(result.automatedListingAllowed, false, 'automatedListingAllowed is false');
  assertEq(result.contributesToReadyValue, false, 'contributesToReadyValue is false');
  assertEq(result.rungProvenance, 'unknown', 'rungProvenance is "unknown" — PriceCharting\'s scraped ladder carries no direct-vs-interpolated signal');
  assertEq(result.rungGrade, '9.4', 'rungGrade is the exact confirmed-grade key');
  assertEq(result.rungValue, 145, 'rungValue is the exact ladder price at that key');
}

// ══════════════════════════════════════════════════════════════════════════════
// Each of the 4 trigger conditions independently gates — flipping any ONE
// of them off must suppress the reference entirely.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nEach trigger condition independently required\n');
{
  const priceLadder = { '9.4': 145 };
  const fullTrigger = {
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder,
    gradeKey: '9.4',
  };
  assertTrue(!!assessCatalogLadderReference(fullTrigger), 'sanity: full trigger fires');

  assertNull(assessCatalogLadderReference({ ...fullTrigger, rawPricingPoolEmpty: false }), 'rawPricingPool NOT empty -> does not fire (real comps exist, no reference needed)');
  assertNull(assessCatalogLadderReference({ ...fullTrigger, gradedReferencesEmpty: false }), 'gradedPricingReferences NOT empty -> does not fire (a graded reference already exists)');
  assertNull(assessCatalogLadderReference({ ...fullTrigger, pcAnchorAccepted: false }), 'no PC anchor accepted -> does not fire (no trustworthy product match)');
  assertNull(assessCatalogLadderReference({ ...fullTrigger, priceLadder: null }), 'no price ladder at all -> does not fire');
  assertNull(assessCatalogLadderReference({ ...fullTrigger, priceLadder: {} }), 'empty price ladder -> does not fire');
  assertNull(assessCatalogLadderReference({ ...fullTrigger, gradeKey: null }), 'no grade key derivable -> does not fire');
}

// ══════════════════════════════════════════════════════════════════════════════
// No interpolation in V1 — a book whose confirmed grade has no EXACT rung,
// even with adjacent rungs present on both sides, must return null, not a
// synthesized/interpolated value.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nNo interpolation between rungs\n');
{
  const priceLadder = { '9.0': 78, '9.6': 240 }; // no 9.4 entry
  const result = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder,
    gradeKey: '9.4',
  });
  assertNull(result, 'confirmed grade 9.4 has no exact rung (only 9.0 and 9.6 present) -> null, never interpolated');
}

// The bare "raw"/"Ungraded" bucket is never substituted for a specific
// numeric grade key that has no exact match.
{
  const priceLadder = { raw: 12.50, '9.0': 78 };
  const result = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder,
    gradeKey: '9.4',
  });
  assertNull(result, 'no fallback to the "raw" bucket when the specific numeric grade key is absent');
}

// ══════════════════════════════════════════════════════════════════════════════
// Population/census count must never be used as a proxy trigger — this
// function doesn't even accept a population/census parameter at all,
// confirming the contract cannot be violated by construction.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nPopulation/census count is not a recognized input (cannot be used as a proxy by construction)\n');
{
  const priceLadder = { '9.4': 145 };
  // Passing a population/census-shaped field has no effect — the function
  // only reads the 5 named parameters.
  const result = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder,
    gradeKey: '9.4',
    population: 2, // extraneous — must be ignored, not consulted
    censusCount: 2,
  });
  assertTrue(!!result, 'fires purely on the 4 real trigger conditions, population/census fields present but unused');
}

// Missing/undefined args entirely -> null, no throw.
{
  assertNull(assessCatalogLadderReference(), 'no arguments at all -> null, no throw');
  assertNull(assessCatalogLadderReference({}), 'empty object -> null, no throw');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
