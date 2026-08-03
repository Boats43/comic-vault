// tests/grailkey-commit-p.test.js
//
// GrailKey Commit P — rescoped from the GrailKey full-pipeline audit
// (2026-08-03). Three findings, three fixes, tested here:
//
//   P1 — commit4-terminal (issueAuthority.js:computeIssueAuthorityContractPatch,
//        consumed api/enrich.js ~10039-10098) nulled out.price the instant
//        issueAuthority.status was 'provisional', regardless of how strong
//        the underlying marketplace consensus actually was. Real Spawn #351
//        production trace: 5-member family, weight 14.0, 100% token
//        overlap, no competing family — a genuinely computed $21.25
//        (Ship 11) discarded anyway. meetsHighConfidenceMarketplaceConsensusBar
//        (issueAuthority.js) now gates whether that specific gate fires;
//        issueAuthority.status itself is untouched (still 'provisional').
//   P2a — hypotheticalReferenceEstimate reached the API response (issueAuthority.js
//        line ~408, `if (priorOut?.price != null) patch.hypotheticalReferenceEstimate
//        = priorOut.price;`) but was never threaded through any client
//        merge path or rendered — a REFUSED card showed a blank price with
//        no indication the pipeline had actually estimated one.
//   P2b — identityProvisionalFields carried the bare fact "year is
//        provisional" but never the year value or vote strength behind it
//        (that data existed only in a console.log line, api/enrich.js
//        ~2993-2996). buildIdentityProvisionalYearDetail (issueAuthority.js)
//        now also assigns it onto out.identityProvisionalYearDetail.
//   P3  — bullion/silver-ingot collectibles ("1 oz superman #1 summer 1939
//        agoro foil...", "...1oz Silver Foil Agoro 2026 .999 LE 1000...")
//        had zero filter pattern anywhere in the codebase, on either the
//        identity-pool side (categoryClassifier.js) or the comps side
//        (compHygiene.js) — confirmed by repo-wide search during the
//        audit. Two such listings entered a real Superman #1 facsimile
//        scan's identity pool.
//
// Every function under test is the REAL exported production function at
// its real call site (invariant 10, matching every prior Track B test in
// this directory) — no test-local mirror of any of this logic exists
// anywhere in this file.
//
// Invoke: node tests/grailkey-commit-p.test.js

import {
  deriveIssueAuthorityFromAdoption,
  computeIssueAuthorityContractPatch,
  meetsHighConfidenceMarketplaceConsensusBar,
  hasFamilySeriesMarkerAsymmetry,
  buildIdentityProvisionalYearDetail,
  HIGH_CONFIDENCE_WEIGHT_FLOOR,
} from '../src/lib/issueAuthority.js';
import { MERCH_RE } from '../src/lib/compHygiene.js';
import { filterVisualIdentityPool } from '../src/lib/categoryClassifier.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit P — P1/P2a/P2b/P3 ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Fixture — the real Spawn #351 production shape (GrailKey audit,
// 2026-08-03): a 5-member weighted-consensus family, indices [0,1,2,3,5]
// (index 4 deliberately NOT a family member, matching the real trace where
// 6 rows shared issue #351 but only 5 clustered into the winning family),
// weightSum 14.0 (matches getRankWeight(0)+getRankWeight(1)+getRankWeight(2)
// +getRankWeight(3)+getRankWeight(5) = 5+4+3+1+1 = 14), no runner-up, 100%
// overlap, decision='weighted-consensus'. Titles are simplified real
// listing text (same physical book, same production trace) — no
// LOT_RE/REPRINT_RE/SLAB_RE/GRADED_RE/SIGNED_RE/TPB_MARKER_RE contamination,
// no series-marker asymmetry (no roman numerals/Vol/Part/Book/Annual).
// ══════════════════════════════════════════════════════════════════════════════
const spawnVisualItems = [
  { rawTitle: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)' },
  { rawTitle: 'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)' },
  { rawTitle: 'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)' },
  { rawTitle: 'Spawn #351 Cover C Brett Booth Virgin Variant' },
  { rawTitle: 'Spawn Comic Book Capullo Cover Artwork Superheroes Color Edition' }, // idx 4 — NOT a family member
  { rawTitle: 'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM' },
];
const spawnTopFamily = { count: 5, weightSum: 14.0, indices: [0, 1, 2, 3, 5], rawTitle: spawnVisualItems[0].rawTitle };
const spawnFamilyCandidateQualifying = {
  decision: 'weighted-consensus',
  topFamily: spawnTopFamily,
  runnerUp: null,
  overlapRatio: 1,
};
const spawnFic = { mode: 'adopted', ratio: 1.0, winner: 351, support: 5, uniqueRows: 5 };

// ══════════════════════════════════════════════════════════════════════════════
// meetsHighConfidenceMarketplaceConsensusBar — the gate predicate itself
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nmeetsHighConfidenceMarketplaceConsensusBar\n');
{
  assertTrue(
    meetsHighConfidenceMarketplaceConsensusBar(spawnFamilyCandidateQualifying, spawnVisualItems),
    'Spawn #351 reference shape (5 members, weight 14.0, 100% overlap, no runner-up) qualifies'
  );
  assertEq(HIGH_CONFIDENCE_WEIGHT_FLOOR, 12, 'weight floor is 12 — top 3 eBay ranks (5+4+3), the max weight 3 members could carry at the minimum required count');

  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar(null, spawnVisualItems),
    'null familyCandidate -> false, no throw'
  );
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar(undefined, undefined),
    'undefined familyCandidate/visualItems -> false, no throw (real call site behavior for non-adopted-mode books)'
  );
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar({ ...spawnFamilyCandidateQualifying, decision: 'top-rank-protection' }, spawnVisualItems),
    'decision=top-rank-protection (not the tested/reference shape) -> false, scoped narrowly on purpose'
  );
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar({ ...spawnFamilyCandidateQualifying, topFamily: { ...spawnTopFamily, count: 2, indices: [0, 1] } }, spawnVisualItems),
    'count=2 (< 3 floor) -> false'
  );
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar({ ...spawnFamilyCandidateQualifying, topFamily: { ...spawnTopFamily, weightSum: 11.9 } }, spawnVisualItems),
    'weightSum=11.9 (just under the 12 floor) -> false'
  );
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar({ ...spawnFamilyCandidateQualifying, overlapRatio: 0.99 }, spawnVisualItems),
    'overlapRatio=0.99 (not exactly 100%) -> false'
  );
  // GrailKey Commit P2 (Part A, 2026-08-03) — CORRECTED. This assertion
  // originally used runnerUp weightSum=0.5 to prove "any runner-up present
  // at all -> false" (the strict-absence reading). That reading made this
  // gate dead code against all 3 real Spawn #351 production requests (see
  // tests/grailkey-commit-p2.test.js). Now reuses familyDominatesRunnerUp
  // (3x margin) — a weightSum=0.5 runner-up against a 14.0 top family is a
  // 28x margin, which DOES dominate and now correctly QUALIFIES. This
  // assertion is inverted (was assertFalse, now assertTrue) to match the
  // corrected semantics; the genuine "present but not dominated" case is
  // covered by the weightSum=6.0 case immediately below (2.33x, does not
  // dominate) and by tests/grailkey-commit-p2.test.js's P2-7.
  assertTrue(
    meetsHighConfidenceMarketplaceConsensusBar({ ...spawnFamilyCandidateQualifying, runnerUp: { weightSum: 0.5 } }, spawnVisualItems),
    'GrailKey Commit P2: runner-up present but overwhelmingly dominated (14.0 vs 0.5 = 28x) -> true (3x-domination reading, not strict absence)'
  );
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar({ ...spawnFamilyCandidateQualifying, runnerUp: { weightSum: 6.0 } }, spawnVisualItems),
    'GrailKey Commit P2: runner-up present and NOT dominated by 3x (14.0 vs 6.0 = 2.33x) -> false'
  );
  const contaminatedItems = spawnVisualItems.map((r, i) => (i === 1 ? { rawTitle: 'Spawn #350 & #351 Comic Lot Image Comics' } : r));
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar(spawnFamilyCandidateQualifying, contaminatedItems),
    'a lot-listing member (hasContaminatedMember) -> false'
  );
  const asymmetricItems = spawnVisualItems.map((r, i) => (i === 2 ? { rawTitle: 'Spawn #351 Vol. 2 Cover C Brett Booth Virgin' } : r));
  assertFalse(
    meetsHighConfidenceMarketplaceConsensusBar(spawnFamilyCandidateQualifying, asymmetricItems),
    'a series-marker asymmetry among members (one carries "Vol. 2", others don\'t) -> false'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// hasFamilySeriesMarkerAsymmetry — reuses detectSeriesMarkers directly
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nhasFamilySeriesMarkerAsymmetry\n');
{
  assertFalse(
    hasFamilySeriesMarkerAsymmetry(spawnVisualItems, [0, 1, 2, 3, 5]),
    'no member carries any series marker -> no asymmetry (the common case)'
  );
  assertTrue(
    hasFamilySeriesMarkerAsymmetry(
      [{ rawTitle: 'Foo #1 Part 2' }, { rawTitle: 'Foo #1 Part 3' }],
      [0, 1]
    ),
    'Part 2 vs Part 3 -> asymmetry (different specific markers)'
  );
  assertFalse(
    hasFamilySeriesMarkerAsymmetry(
      [{ rawTitle: 'Foo Annual #1' }, { rawTitle: 'Foo Annual #1' }],
      [0, 1]
    ),
    'identical markers on every member -> no asymmetry'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// P-1 / P-2 / P-3 — the qualifying shape survives commit4-terminal
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-1/P-2/P-3 — qualifying shape\n');
{
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateQualifying, spawnVisualItems);
  assertTrue(derived.issueAuthority.highConfidenceMarketplaceConsensus, 'derived issueAuthority carries highConfidenceMarketplaceConsensus=true');
  // P-2: status stays 'provisional' — never promoted.
  assertEq(derived.issueAuthority.status, 'provisional', 'P-2: issueAuthority.status remains \'provisional\' — this predicate never promotes it');
  assertEq(derived.issueAuthority.reasons, ['marketplace-only-adoption'], 'reasons unchanged — still marketplace-only-adoption');

  // Simulate the real api/enrich.js sequence: Ship 11 already computed a
  // real price ($21.25, the real Spawn #351 median) onto out BEFORE
  // commit4-terminal runs.
  const out = { price: 21.25, priceLow: 14.99, priceHigh: 25.00, pricingSource: 'visual_pool_fallback', refusedToPrice: false, issueAuthority: derived.issueAuthority };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
  assertTrue(patch !== null, 'a patch is still returned (listing still locks — P1 does not make this a no-op)');

  // P-1: price survives.
  assertFalse('price' in patch, 'P-1: the soft patch does not include a price key at all — Object.assign leaves out.price untouched');
  assertFalse('priceLow' in patch, 'P-1: priceLow untouched');
  assertFalse('priceHigh' in patch, 'P-1: priceHigh untouched');
  assertFalse('refusedToPrice' in patch, 'P-1: refusedToPrice not set — decisionEngine\'s ID_REQUIRED path never triggers off this patch');
  assertFalse('identityConfident' in patch, 'P-1: identityConfident not forced false by this patch');
  const merged = { ...out, ...patch };
  assertEq(merged.price, 21.25, 'P-1: final price after Object.assign is the real Ship-11 estimate, $21.25');
  assertTrue(merged.price >= 21 && merged.price <= 65, 'P-1: price lands in the $21-$65 band Commit N\'s own commit message names as this book\'s real market');

  // P-3: listing still requires the tap.
  assertTrue(patch.listingHardLocked, 'P-3: listingHardLocked=true — listing still requires manual confirmation');
  assertEq(patch.listingHardLockReason, 'issue-authority-provisional-high-confidence', 'P-3: distinct lock reason from the ordinary provisional-refusal case');
  assertTrue(typeof patch.listingHardLockBanner === 'string' && patch.listingHardLockBanner.length > 0, 'P-3: a real banner string is set');
}

// ══════════════════════════════════════════════════════════════════════════════
// P-4 — weak consensus shapes: price still nulled, unchanged behavior
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-4 — weak consensus stays unchanged\n');
{
  const weakShapes = [
    { label: '2 members (below floor)', familyCandidate: { ...spawnFamilyCandidateQualifying, topFamily: { ...spawnTopFamily, count: 2, weightSum: 9, indices: [0, 1] } } },
    // GrailKey Commit P2 (Part A) — CORRECTED from weightSum: 2.5 (14.0 vs
    // 2.5 = 5.6x, which now DOMINATES under the corrected 3x-margin
    // semantics and would no longer be a "weak" shape). weightSum: 6.0
    // (14.0 vs 6.0 = 2.33x) is the genuine below-3x-margin weak case.
    { label: 'runner-up present, not dominated (2.33x)', familyCandidate: { ...spawnFamilyCandidateQualifying, runnerUp: { weightSum: 6.0 } } },
    { label: '<100% overlap (80%)', familyCandidate: { ...spawnFamilyCandidateQualifying, overlapRatio: 0.8 } },
  ];
  for (const { label, familyCandidate } of weakShapes) {
    const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, familyCandidate, spawnVisualItems);
    assertFalse(derived.issueAuthority.highConfidenceMarketplaceConsensus, `${label}: does not qualify`);
    const out = { price: 21.25, refusedToPrice: false, issueAuthority: derived.issueAuthority };
    const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
    assertEq(patch.price, null, `${label}: price nulled — same hard-refusal behavior as before this commit`);
    assertEq(patch.refusedToPrice, true, `${label}: refusedToPrice=true — unchanged`);
    assertTrue('hypotheticalReferenceEstimate' in patch, `${label}: hypotheticalReferenceEstimate still preserved on the hard-refusal path (I13 — this was already correct, untouched by P1)`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// P-5 — hypotheticalReferenceEstimate reaches out on the hard-refusal path.
// Client render is at src/App.jsx (the REFUSED contract-state banner,
// `item.contract.state === 'REFUSED' && item.hypotheticalReferenceEstimate
// != null`) — not independently invokable here (no JSX-transform harness
// in this test suite, same limitation the pre-existing Commit 4 test file
// documents for App.jsx's getListingReadiness). Asserted here is the REAL,
// exported upstream signal that deterministically drives it.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-5 — hypotheticalReferenceEstimate reaches the response body\n');
{
  // GrailKey Commit P2 (Part A) — CORRECTED from weightSum: 2.5 (now
  // dominates at 5.6x under the corrected margin semantics). weightSum:
  // 6.0 (2.33x) is the genuine non-dominating weak shape — see P-4 above.
  const derivedWeak = deriveIssueAuthorityFromAdoption(
    spawnFic, undefined,
    { ...spawnFamilyCandidateQualifying, runnerUp: { weightSum: 6.0 } },
    spawnVisualItems
  );
  const out = { price: 21.25, refusedToPrice: false, issueAuthority: derivedWeak.issueAuthority };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derivedWeak.identityProvisionalFields);
  assertEq(patch.hypotheticalReferenceEstimate, 21.25, 'P-5: the real, already-computed price is preserved as hypotheticalReferenceEstimate, not silently discarded');
  assertEq(patch.price, null, 'P-5: while the displayed price is genuinely null (this is the REFUSED case the banner renders for)');

  const outNoPrice = { price: null, refusedToPrice: false, issueAuthority: derivedWeak.issueAuthority };
  const patchNoPrice = computeIssueAuthorityContractPatch(outNoPrice.issueAuthority, outNoPrice, derivedWeak.identityProvisionalFields);
  assertFalse('hypotheticalReferenceEstimate' in patchNoPrice, 'P-5: no fabricated estimate when no price existed to preserve in the first place');
}

// ══════════════════════════════════════════════════════════════════════════════
// P-6 — identityProvisionalFields year renders with support ratio.
// Client render is at src/App.jsx (`item.identityProvisionalFields.includes
// ('year') && item.identityProvisionalYearDetail`) — same App.jsx-harness
// limitation as P-5; asserted here is the real upstream signal.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-6 — identityProvisionalYearDetail\n');
{
  const familyYearConsensus = { mode: 'adopted', year: 2024, support: 3, uniqueRows: 5 };
  assertEq(
    buildIdentityProvisionalYearDetail(familyYearConsensus),
    { year: 2024, support: 3, population: 5 },
    'P-6: real Spawn #351 year vote (year=2024, support=3/5) shapes into the exact structure App.jsx renders as "Year 2024 (3 of 5 listings) — confirm"'
  );
  assertEq(buildIdentityProvisionalYearDetail(null), null, 'null familyYearConsensus -> null, no throw');
  assertEq(buildIdentityProvisionalYearDetail(undefined), null, 'undefined familyYearConsensus -> null, no throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// P-7 — bullion/silver-foil listing excluded from BOTH the identity pool
// and the comps chain, via the SAME pattern text (categoryClassifier.js /
// compHygiene.js).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-7 — bullion/silver-foil excluded, both sides\n');
{
  // Real production listing titles (Superman #1 facsimile scan, GrailKey
  // audit) — verbatim.
  const bullionItems = [
    { title: '1 oz superman #1 summer 1939 agoro foil DC limited edition 2026 agoro comics', leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }] },
    { title: 'Superman #1 Comic Cover 1oz Silver Foil Agoro 2026 .999 LE 1000  DC Comics', leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }] },
  ];
  const genuineComic = { title: 'COMIC BOOK | SUPERMAN #1: VARIANT EXCLUSIVE by Pablo Villalobos', leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }] };
  const { eligible, rejectedVisualEvidence } = filterVisualIdentityPool([...bullionItems, genuineComic]);
  assertEq(eligible.length, 1, 'P-7: identity pool — both bullion listings excluded, the genuine comic survives');
  assertTrue(eligible[0].title.includes('Villalobos'), 'P-7: the survivor is the genuine comic, not a bullion listing');
  assertEq(rejectedVisualEvidence.length, 2, 'P-7: both bullion listings recorded as rejected evidence (I13 — never silently dropped)');
  assertTrue(
    rejectedVisualEvidence.every((r) => r.classification === 'MERCHANDISE'),
    'P-7: both rejected as MERCHANDISE (the classification this commit\'s pattern extension feeds)'
  );

  assertTrue(MERCH_RE.test(bullionItems[0].title), 'P-7: comps chain — "1 oz...agoro foil" matches MERCH_RE (troy-ounce weight marker)');
  assertTrue(MERCH_RE.test(bullionItems[1].title), 'P-7: comps chain — "1oz Silver Foil...999" matches MERCH_RE (.999 purity marker)');
  assertFalse(MERCH_RE.test(genuineComic.title), 'P-7: comps chain — the genuine comic does NOT match MERCH_RE');

  // Deliberately does NOT reject a genuine silver-foil COVER comic variant
  // — "silver foil" alone (no oz/.999/bullion/ingot) is a legitimate
  // comic cover-finish descriptor elsewhere in this codebase.
  assertFalse(
    MERCH_RE.test('Amazing Spider-Man #1 Silver Foil Variant Cover NM'),
    'P-7: a genuine silver-foil-COVER comic variant (no oz/.999/bullion/ingot) is NOT rejected — narrower than a blanket "silver foil" ban'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// P-8 / P-9 — Iron Man #126 / ASM #300 byte-identical. Neither book's real
// production trace ever reached the 'adopted' mode at all (Iron Man #126:
// identitySource=vision, thin pool, no family clustering attempted; ASM
// #300: identitySource=title-family-top-rank-protection, Vision and eBay
// agreed) — issueAuthority stays null/absent for both, exactly as before
// this commit. P1 only adds a new branch INSIDE the issueProvisional
// check; it is structurally unreachable when issueAuthority is null.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-8/P-9 — unaffected books stay byte-identical\n');
{
  const ironManOut = { price: 22.46, priceLow: 14.99, priceHigh: 25.83, pricingSource: 'verified_sold_recency', refusedToPrice: false, issueAuthority: null };
  const patchIronMan = computeIssueAuthorityContractPatch(ironManOut.issueAuthority, ironManOut, null);
  assertEq(patchIronMan, null, 'P-8: Iron Man #126 (issueAuthority=null, identityProvisionalFields=null) — no patch at all, byte-identical to pre-commit behavior');

  const asmOut = { price: 378.17, priceLow: 300, priceHigh: 450, pricingSource: 'verified_sold_recency', refusedToPrice: false, issueAuthority: null };
  const patchAsm = computeIssueAuthorityContractPatch(asmOut.issueAuthority, asmOut, null);
  assertEq(patchAsm, null, 'P-9: ASM #300 (issueAuthority=null, identityProvisionalFields=null) — no patch at all, byte-identical to pre-commit behavior');
}

// ══════════════════════════════════════════════════════════════════════════════
// P-10 — MUTATION: a "naive" reimplementation of the PRE-Commit-P behavior
// (unconditional provisional-nulls-price, no high-confidence check at all
// — the literal function body before this commit) run against the SAME
// qualifying Spawn #351 fixture, to prove P-1's non-null result isn't a
// vacuous default. Mirrors the TEETH-PROOF pattern already established in
// tests/q-trackB-commit4-adoption-provisional.test.js.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP-10 — mutation: pre-Commit-P behavior would have failed P-1\n');
{
  const naivePatch = (issueAuthority, priorOut) => {
    // Verbatim pre-Commit-P body of computeIssueAuthorityContractPatch's
    // issueProvisional branch — no highConfidenceMarketplaceConsensus
    // check existed at all.
    if (issueAuthority?.status !== 'provisional') return null;
    const patch = { price: null, priceLow: null, priceHigh: null, priceBands: null, refusedToPrice: true, identityConfident: false, listingHardLocked: true };
    if (priorOut?.price != null) patch.hypotheticalReferenceEstimate = priorOut.price;
    return patch;
  };
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateQualifying, spawnVisualItems);
  const out = { price: 21.25, refusedToPrice: false, issueAuthority: derived.issueAuthority };
  const naiveResult = naivePatch(out.issueAuthority, out);
  assertEq(naiveResult.price, null, 'MUTATION: the naive (pre-fix) implementation nulls price even for the qualifying Spawn #351 shape — proves the real fix is load-bearing, not a no-op');

  const realPatch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
  assertTrue(realPatch.price === undefined, 'MUTATION CONTRAST: the REAL post-fix function does not null price for the identical fixture — P-1 genuinely depends on this commit\'s code, not on the fixture alone');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
}
process.exit(failed > 0 ? 1 : 0);
