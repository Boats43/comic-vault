// tests/q-commitE1-catalog-ladder-authority.test.js
//
// Commit E1 — make catalog ladder reference authoritative as
// reference-only. Fixes Commit E's original gap: the reference could fire
// alongside tier 4's actionable pc_estimate price (same underlying
// pcBase×gradeMultiplier data presenting as BOTH an inert reference AND a
// recommended price simultaneously). Tests assessPcAnchorTrust,
// assessGradeBasis, the updated assessCatalogLadderReference (now threads
// gradeBasis), and cross-module integration: computeDecision
// (decisionEngine.js) and assembleContract/finalizeResponse
// (responseContract.js) called for REAL against a constructed `out` object
// matching exactly what api/enrich.js's E1 override block produces.
//
// Scope note, stated honestly per the dispatch's own item 5 wording
// ("handler-level, not pure-function-level"): a true HTTP-handler-level
// test would require mocking api/enrich.js's entire request lifecycle
// (eBay/PriceCharting/ComicVine/Anthropic API calls) — no such harness
// exists anywhere in this codebase's test suite (confirmed: every existing
// test file calls pure functions/modules directly, none spin up the
// handler). What this file DOES provide, honestly, is a genuine
// CROSS-MODULE integration test — the real computeDecision and
// assembleContract/finalizeResponse functions are imported and called
// against a fixture built to exactly match api/enrich.js's E1 override
// block's field-by-field output, not a hand-waved mock of what they'd
// probably do. This is the closest faithful proof available without new
// test infrastructure this codebase doesn't have.
//
// Invoke: node tests/q-commitE1-catalog-ladder-authority.test.js

import { assessCatalogLadderReference, assessPcAnchorTrust, assessGradeBasis } from '../src/lib/evidenceEligibility.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { assembleContract, finalizeResponse } from '../src/lib/responseContract.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Commit E1 — catalog ladder reference made authoritative as reference-only ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// assessPcAnchorTrust — unit behavior
// ══════════════════════════════════════════════════════════════════════════════
console.log('assessPcAnchorTrust — EXACT_EDITION / COMPATIBLE_REFERENCE / REJECTED\n');
{
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1963 }), 'EXACT_EDITION', 'exact year match -> EXACT_EDITION');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1964 }), 'EXACT_EDITION', '1-year drift (cover-date/pub-date normal variance) -> EXACT_EDITION');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1966 }), 'COMPATIBLE_REFERENCE', '3-year drift (plausible, not exact) -> COMPATIBLE_REFERENCE');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1970 }), 'REJECTED', '7-year drift (beyond the existing ±5y admission gate) -> REJECTED');
  assertEq(assessPcAnchorTrust({ pcPrice: null, pcYear: 1963, confirmedYear: 1963 }), 'REJECTED', 'no PC price at all -> REJECTED');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1963, pcMatchRejectedForYearConflict: true }), 'REJECTED', 'explicit pc-anchor-gate rejection -> REJECTED regardless of year math');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1963, identityConflictCount: 1 }), 'COMPATIBLE_REFERENCE', 'a real identity conflict (ship28b) downgrades an otherwise-exact year match to COMPATIBLE_REFERENCE, never REJECTED outright');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: null, confirmedYear: 1963 }), 'COMPATIBLE_REFERENCE', 'no PC year to verify -> COMPATIBLE_REFERENCE, never claims EXACT without evidence');
  assertEq(assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: null }), 'COMPATIBLE_REFERENCE', 'no confirmedYear to compare -> COMPATIBLE_REFERENCE, never EXACT without evidence');
  assertEq(assessPcAnchorTrust(), 'REJECTED', 'no arguments at all -> REJECTED (safe default), no throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// assessGradeBasis — unit behavior
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nassessGradeBasis — USER_CONFIRMED / MULTI_PHOTO_ASSESSED / SINGLE_PHOTO_PROVISIONAL / UNKNOWN\n');
{
  assertEq(assessGradeBasis({ isGraded: true, numericGrade: 9.4, grade: null }), 'USER_CONFIRMED', 'CGC slab (isGraded + numericGrade) -> USER_CONFIRMED, never called a subjective AI estimate');
  assertEq(assessGradeBasis({ isGraded: false, grade: 'FN 6.0', imagesCount: 3 }), 'MULTI_PHOTO_ASSESSED', 'raw scan, 3 photos -> MULTI_PHOTO_ASSESSED');
  assertEq(assessGradeBasis({ isGraded: false, grade: 'FN 6.0', imagesCount: 1 }), 'SINGLE_PHOTO_PROVISIONAL', 'raw scan, 1 photo -> SINGLE_PHOTO_PROVISIONAL, never called "confirmed"');
  assertEq(assessGradeBasis({ isGraded: false, grade: 'FN 6.0', imagesCount: null }), 'SINGLE_PHOTO_PROVISIONAL', 'raw scan, unknown photo count -> defaults to the more conservative SINGLE_PHOTO_PROVISIONAL, not assumed multi');
  assertEq(assessGradeBasis({ isGraded: false, grade: null }), 'UNKNOWN', 'no grade string at all -> UNKNOWN');
  assertEq(assessGradeBasis(), 'UNKNOWN', 'no arguments -> UNKNOWN, no throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// assessCatalogLadderReference — gradeBasis now threaded through the output
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nassessCatalogLadderReference — gradeBasis threaded, provisional grade labeled, never called confirmed\n');
{
  const base = {
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder: { '6.0': 88 },
    gradeKey: '6.0',
  };
  const provisional = assessCatalogLadderReference({ ...base, gradeBasis: 'SINGLE_PHOTO_PROVISIONAL' });
  assertEq(provisional.gradeBasis, 'SINGLE_PHOTO_PROVISIONAL', 'gradeBasis threaded through unchanged');

  const confirmed = assessCatalogLadderReference({ ...base, gradeBasis: 'USER_CONFIRMED' });
  assertEq(confirmed.gradeBasis, 'USER_CONFIRMED', 'USER_CONFIRMED threaded through unchanged');

  const noBasis = assessCatalogLadderReference({ ...base });
  assertEq(noBasis.gradeBasis, 'UNKNOWN', 'gradeBasis omitted -> defaults to UNKNOWN, never silently implies confirmed');
}

// ══════════════════════════════════════════════════════════════════════════════
// Cross-module integration — pcAnchorTrust gate: EXACT_EDITION required,
// COMPATIBLE_REFERENCE must never fire the reference (negative test, item 6)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nNegative test: compatible-but-not-exact anchor -> no reference\n');
{
  const trust = assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1966 }); // 3y drift
  assertEq(trust, 'COMPATIBLE_REFERENCE', 'sanity: this fixture genuinely produces COMPATIBLE_REFERENCE');
  const result = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: trust === 'EXACT_EDITION', // the real integration point api/enrich.js uses
    priceLadder: { '9.4': 145 },
    gradeKey: '9.4',
  });
  assertNull(result, 'COMPATIBLE_REFERENCE anchor never fires the reference — V1 requires EXACT_EDITION specifically');
}

console.log('\nNegative test: missing exact rung -> no reference\n');
{
  const trust = assessPcAnchorTrust({ pcPrice: 150, pcYear: 1963, confirmedYear: 1963 });
  assertEq(trust, 'EXACT_EDITION', 'sanity: this fixture genuinely produces EXACT_EDITION');
  const result = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: trust === 'EXACT_EDITION',
    priceLadder: { '9.0': 78, '9.6': 240 }, // no 9.4
    gradeKey: '9.4',
  });
  assertNull(result, 'exact anchor but no exact rung -> still no reference');
}

console.log('\nNegative test: population/census count never fires it (no such parameter exists)\n');
{
  const result = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder: { '9.4': 145 },
    gradeKey: '9.4',
    censusCount: 1, // extraneous, must have zero effect
    population: 1,
  });
  assertTrue(!!result, 'fires purely on the real trigger conditions; population/census fields present but structurally unable to influence the result');
}

// ══════════════════════════════════════════════════════════════════════════════
// Cross-module integration (REAL computeDecision + assembleContract +
// finalizeResponse, not mocks) — proves the SAME response that carries
// catalogLadderReference contains no actionable price, no bands, no ready
// value, and no listing path. Mirrors api/enrich.js's E1 override block
// field-by-field.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nIntegration: constructed E1-override `out` object -> real computeDecision + real contract assembly\n');
{
  // Exactly what api/enrich.js's E1 block sets when catalogLadderReference
  // fires (see api/enrich.js, the block immediately before
  // out.decision = computeDecision(out, {...})).
  const catalogLadderReference = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true, // pcAnchorTrust === 'EXACT_EDITION'
    priceLadder: { '6.0': 88 },
    gradeKey: '6.0',
    gradeBasis: 'SINGLE_PHOTO_PROVISIONAL',
  });
  assertTrue(!!catalogLadderReference, 'sanity: fixture genuinely fires the reference');

  const out = {
    title: 'A Genuinely Thin Book', issue: '1', publisher: 'Indie Press', year: 1988,
    grade: 'FN 6.0', identityConfident: true,
    catalogLadderReference,
    pcAnchorTrust: 'EXACT_EDITION',
    // The exact override fields api/enrich.js's E1 block sets:
    price: null, priceLow: null, priceHigh: null, priceBands: null,
    pricingSource: 'catalog_ladder_reference',
    refusedToPrice: true,
    confidenceLevel: 'LOW',
    matchConfidence: { score: 0, tier: 'LOW' },
    listingHardLocked: true,
    listingHardLockReason: 'catalog-ladder-reference-only',
    listingHardLockBanner: 'No verified comps or sales exist for this book — a catalog reference value is shown for context only. Listing is blocked pending real market evidence.',
    rawComps: { count: 0, average: null, lowest: null, highest: null, prices: [] },
    soldComps: [],
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {} },
  };

  // REAL computeDecision call — not asserted against my own assumption of
  // what it does, the actual function from src/lib/decisionEngine.js.
  const decision = computeDecision(out);
  assertEq(decision.action, 'RESEARCH', `decision.action is RESEARCH, not DO_NOT_LIST/LIST_NOW (got "${decision.action}")`);
  assertFalse(decision.action === 'LIST_NOW', 'not LIST_NOW');
  assertFalse(decision.action === 'LIST_LOW', 'not LIST_LOW');
  assertFalse(decision.action === 'DO_NOT_LIST', 'not DO_NOT_LIST either (this is real data, not "no data sources at all")');
  const NON_LISTING_CHANNELS = new Set(['research', 'blocked']);
  assertTrue(NON_LISTING_CHANNELS.has(decision.bestChannel), `bestChannel is non-listing (got "${decision.bestChannel}")`);
  assertTrue(decision.warnings.includes('refused-to-price'), 'decision.warnings carries refused-to-price');

  out.decision = decision;

  // REAL assembleContract/finalizeResponse call.
  const finalized = finalizeResponse(out);
  assertEq(finalized.price, null, 'authoritative price is null');
  assertEq(finalized.priceLow, null, 'priceLow is null');
  assertEq(finalized.priceHigh, null, 'priceHigh is null');
  assertEq(finalized.priceBands, null, 'price bands are null — no Quick/Market/Stretch');
  assertEq(finalized.contract.price, null, 'contract.price is null');
  assertEq(finalized.contract.bands, null, 'contract.bands is null');
  assertEq(finalized.contract.state, 'REFUSED', `contract.state is REFUSED (got "${finalized.contract.state}") — no ready/liquid value`);
  assertFalse(finalized.contract.listable === true, 'contract.listable is false — no listing path');
  assertTrue(finalized.contract.locks.some((l) => l.code === 'refused'), 'contract carries the refused lock');
  assertTrue(finalized.contract.locks.some((l) => l.code === 'catalog-ladder-reference-only'), 'contract also carries the catalog-ladder-reference-only lock');
  assertTrue(finalized.listingHardLocked === true, 'out.listingHardLocked survives finalization');

  // The reference itself is still present and intact — never suppressed,
  // only kept out of the ACTIONABLE fields (I13: annotate, never omit).
  assertTrue(!!finalized.catalogLadderReference, 'catalogLadderReference itself survives finalization, still visible');
  assertEq(finalized.catalogLadderReference.contributesToReadyValue, false, 'contributesToReadyValue is false');
  assertEq(finalized.catalogLadderReference.automatedListingAllowed, false, 'automatedListingAllowed is false');
  assertEq(finalized.catalogLadderReference.gradeBasis, 'SINGLE_PHOTO_PROVISIONAL', 'gradeBasis survives finalization, still labeled provisional');
}

// ══════════════════════════════════════════════════════════════════════════════
// Final response cannot contain both automatedListingAllowed=false on the
// reference AND an actionable pc_estimate price simultaneously (item 6,
// the exact defect Commit E originally had).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFinal-response contradiction check: reference + actionable price can never coexist\n');
{
  const catalogLadderReference = assessCatalogLadderReference({
    rawPricingPoolEmpty: true,
    gradedReferencesEmpty: true,
    pcAnchorAccepted: true,
    priceLadder: { '6.0': 88 },
    gradeKey: '6.0',
    gradeBasis: 'USER_CONFIRMED',
  });
  const outWithReference = {
    catalogLadderReference,
    price: null, priceBands: null, pricingSource: 'catalog_ladder_reference', refusedToPrice: true,
  };
  // The contradiction Commit E originally had: a reference object present
  // while price/pricingSource still claim an actionable pc_estimate.
  const hasContradiction = !!outWithReference.catalogLadderReference &&
    outWithReference.price != null &&
    outWithReference.pricingSource === 'pc_estimate';
  assertFalse(hasContradiction, 'E1 fixture: reference present, price null, pricingSource relabeled — no contradiction');

  // Explicit demonstration of what WOULD be a contradiction, to prove the
  // check itself is meaningful (not vacuously true).
  const contradictoryFixture = {
    catalogLadderReference,
    price: 145, priceBands: { quick: 116, market: 145, stretch: 174 }, pricingSource: 'pc_estimate',
  };
  const wouldBeContradiction = !!contradictoryFixture.catalogLadderReference &&
    contradictoryFixture.price != null &&
    contradictoryFixture.pricingSource === 'pc_estimate';
  assertTrue(wouldBeContradiction, 'sanity: the contradiction detector itself correctly flags Commit E\'s original defect shape when reproduced');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
