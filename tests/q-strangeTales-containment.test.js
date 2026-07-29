// tests/q-strangeTales-containment.test.js
//
// Strange Tales consolidated containment campaign — Commits A/B/C/D.
// Real production defect: a "Strange Tales" scan resolved confirmedIssue
// = null (genuinely unresolved identity) but the comps query still fired
// as "Strange Tales #1" (a stale pre-null provisional value), the
// evidence classifier's negative-only model let every comp row pass the
// issue axis unconditionally once target.issue was null, a photocopy
// listing voted in identity clustering, and a series-start/range year
// ("1951-76") was treated as if it were a specific issue's own
// publication year.
//
// Invoke: node tests/q-strangeTales-containment.test.js

import {
  classifyEvidenceRow, buildEvidencePopulations, classifyYearEvidence, assessPhotoAuthority,
  buildPricingEligibleRows, isPricingMathEligible, PRICING_GATE_CODES,
} from '../src/lib/evidenceEligibility.js';
import { enforceQueryIssueAuthority, resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { buildTitleFamilies } from '../src/lib/imageSearchIdentity.js';
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

console.log('\n=== Strange Tales containment campaign — Commits A/B/C/D ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT A — null-issue single authority
// ══════════════════════════════════════════════════════════════════════════════
console.log('Commit A.1/A.3: enforceQueryIssueAuthority\n');
{
  assertNull(enforceQueryIssueAuthority('Strange Tales #1 Marvel 1963', null), 'confirmedIssue null + query embeds "#1" -> stripped entirely (returns null)');
  assertEq(enforceQueryIssueAuthority('Strange Tales Marvel 1963', null), 'Strange Tales Marvel 1963', 'confirmedIssue null + query has NO issue term -> passes through unchanged');
  assertEq(enforceQueryIssueAuthority('Strange Tales #15 Marvel', '15'), 'Strange Tales #15 Marvel', 'confirmedIssue="15" + query agrees -> passes through');
  assertNull(enforceQueryIssueAuthority('Strange Tales #1 Marvel', '15'), 'confirmedIssue="15" + query embeds a DIFFERENT issue "#1" -> stripped (defensive, not just the null case)');
  assertEq(enforceQueryIssueAuthority(null, null), null, 'null query text -> null, no throw');
}

console.log('\nCommit A.2/A.4: classifier default when confirmedIssue is null\n');
{
  const target = { issue: null, seriesTitle: 'Strange Tales', confirmedYear: 1965, publisher: 'Marvel', isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const rows = [
    { title: 'Strange Tales #1 Marvel 1963 VF', price: 200, marketState: 'active' },
    { title: 'Strange Tales Annual Marvel', price: 50, marketState: 'sold' },
    { title: 'Strange Tales #142 Marvel', price: 30, marketState: 'active' }, // even a well-formed, correctly-numbered row
  ];
  rows.forEach((row, i) => {
    const c = classifyEvidenceRow(row, target);
    assertFalse(c.rawPricingEligible, `row ${i + 1}: rawPricingEligible=false (target.issue is null — no explicit mismatch is NOT the same as passing)`);
    assertFalse(c.floorEligible, `row ${i + 1}: floorEligible=false`);
    assertTrue(c.referenceOnly, `row ${i + 1}: referenceOnly=true`);
    assertTrue(c.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), `row ${i + 1}: rejectionCodes includes TARGET_ISSUE_UNRESOLVED`);
    assertEq(c.comparabilityStatus, 'SIMILAR_TITLE_REFERENCE', `row ${i + 1}: comparabilityStatus is SIMILAR_TITLE_REFERENCE`);
    // Deliberately identityEligible=false here (unlike D1.1's
    // UNCONFIRMED_EDITION, which keeps identityEligible=true): there the
    // TARGET's issue/title were already confirmed and only the row's YEAR
    // evidence was missing, a narrower axis. Here the entire ISSUE axis
    // itself is unresolved -- a more fundamental gap. "SIMILAR_TITLE_
    // REFERENCE" deliberately hedges (it never claims to BE the same
    // book), consistent with identityEligible=false.
    assertFalse(c.identityEligible, `row ${i + 1}: identityEligible=false (a more fundamental gap than D1.1's UNCONFIRMED_EDITION -- the whole issue axis is unresolved, not just year)`);
  });

  const pops = buildEvidencePopulations(rows, target);
  assertEq(pops.rawPricingPool.length, 0, 'rawPricingPool=[] for ALL rows, numbered or not');
  assertEq(pops.similarTitleReferences.length, 3, 'all 3 rows retained under similarTitleReferences');
  assertEq(pops.rejectionCodeCounts.TARGET_ISSUE_UNRESOLVED, 3, 'bounded rejectionCodeCounts: TARGET_ISSUE_UNRESOLVED=3');
}

// Control: confirmedIssue present and matching -> normal eligibility, not
// suppressed by this new mechanism.
{
  const target = { issue: '139', seriesTitle: 'The Flash', confirmedYear: 1963, publisher: 'DC Comics', isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const row = { title: 'The Flash #139 1963 VF', price: 200, year: 1963, marketState: 'active' };
  const c = classifyEvidenceRow(row, target);
  assertTrue(c.rawPricingEligible, 'control: confirmedIssue present + row matches -> rawPricingEligible=true (unaffected by Commit A)');
  assertFalse(c.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), 'control: no TARGET_ISSUE_UNRESOLVED code');
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT B — cache separation + market-evidence authority (contract test)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nCommit B: full refusal-contract integration (real computeDecision + real contract assembly)\n');
{
  // Mirrors exactly what api/enrich.js's Commit B override block sets when
  // confirmedIssue is null and a hypothetical price had been computed.
  const out = {
    title: 'Strange Tales', issue: null, publisher: 'Marvel', year: 1965,
    identityConfident: true, identityComplete: true, // isolates Commit B's OWN mechanism from the pre-existing, separate identity-incomplete hard blocker (comics require issue for identityComplete by unrelated, pre-existing design — noted in the delivery report)
    exactMarketEvidenceCount: 0,
    marketEvidenceReady: false,
    hypotheticalReferenceEstimate: 41,
    authoritativeRecommendation: null,
    price: null, priceLow: null, priceHigh: null, priceBands: null,
    pricingSource: 'hypothetical-reference-issue-unresolved',
    refusedToPrice: true,
    confidenceLevel: 'LOW',
    matchConfidence: { score: 0, tier: 'LOW' },
    listingHardLocked: true,
    listingHardLockReason: 'target-issue-unresolved',
    listingHardLockBanner: 'The specific issue number could not be confirmed for this book — similar-title references are shown for context only. Listing is blocked pending identification.',
    rawComps: { count: 0, average: null, lowest: null, highest: null, prices: [] },
    soldComps: [],
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {} },
  };

  assertEq(out.exactMarketEvidenceCount, 0, 'exactMarketEvidenceCount=0');
  assertFalse(out.marketEvidenceReady, 'marketEvidenceReady=false');
  assertNull(out.authoritativeRecommendation, 'authoritativeRecommendation=null (never mirrors the hypothetical estimate)');
  assertEq(out.hypotheticalReferenceEstimate, 41, 'the $41 value survives, but ONLY under hypotheticalReferenceEstimate, never as "recommended"');

  const decision = computeDecision(out);
  out.decision = decision;
  const finalized = finalizeResponse(out);

  assertNull(finalized.price, 'price=null');
  assertNull(finalized.priceBands, 'priceBands=null');
  assertEq(finalized.contract.state, 'REFUSED', `contract.state is REFUSED (got "${finalized.contract.state}")`);
  assertFalse(finalized.contract.listable === true, 'contract.listable=false');
  assertEq(finalized.contract.price, null, 'contract.price=null -> $0 portfolio contribution (portfolio value is always derived from contract.price, never a hidden hypothetical field)');
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT C.1 — photocopy hard-rejected from identity clustering, even when
// ranked first
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nCommit C.1: photocopy row excluded from identity clustering entirely, even ranked first\n');
{
  // Real production title, ranked FIRST (idx 0 — the highest possible
  // rank weight) among 4 genuine "Strange Tales" rows.
  const items = [
    { rawTitle: 'Strange Tales #7 Photocopy Comic Book' },
    { rawTitle: 'Strange Tales #142 Marvel VG' },
    { rawTitle: 'Strange Tales #142 Marvel FN' },
    { rawTitle: 'Strange Tales #142 Marvel GD' },
    { rawTitle: 'Strange Tales #142 Marvel VF' },
  ];
  const families = buildTitleFamilies(items);
  assertTrue(families.length > 0, 'sanity: clustering produced at least one family');
  const photocopyInAnyFamily = families.some((f) => f.indices.includes(0));
  assertFalse(photocopyInAnyFamily, 'the photocopy row (idx 0, ranked first) never appears in ANY family\'s indices');
  const genuineFamily = families.find((f) => f.indices.includes(1));
  assertTrue(!!genuineFamily, 'the 4 genuine rows still cluster together normally');
  assertEq(genuineFamily.indices.filter((i) => i !== 0).length, genuineFamily.indices.length, 'genuine family contains zero trace of the excluded photocopy index');

  // resolveFamilyIssueConsensus — denominator must not count it either,
  // even if a caller passed its index in explicitly.
  const consensusWithPhotocopy = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3, 4]);
  const consensusWithoutPhotocopy = resolveFamilyIssueConsensus(null, items, [1, 2, 3, 4]);
  assertEq(consensusWithPhotocopy.uniqueRows, consensusWithoutPhotocopy.uniqueRows, 'uniqueRows identical whether or not the photocopy index is included — it never counts');
  assertEq(consensusWithPhotocopy.uniqueRows, 4, 'uniqueRows=4 (the 4 genuine rows only)');
  assertEq(consensusWithPhotocopy.issue, '142', 'consensus correctly resolves #142 from the 4 genuine rows, unpolluted by the photocopy row');
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT C.2 — series-start-year / series-range vs issue-publication-year
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nCommit C.2: year-evidence semantics\n');
{
  assertEq(classifyYearEvidence('Strange Tales #142 (1951-76 1st Series) Marvel').class, 'SERIES_RANGE', '"(1951-76 1st Series)" classifies as SERIES_RANGE, not an issue year');
  assertEq(classifyYearEvidence('Strange Tales #76 1951-1976 Marvel').class, 'SERIES_RANGE', '"1951-1976" (4-digit end year) also classifies as SERIES_RANGE');
  assertEq(classifyYearEvidence('Strange Tales #76 1951 series Marvel').class, 'SERIES_START_YEAR', '"1951 series" classifies as SERIES_START_YEAR');
  assertEq(classifyYearEvidence('Amazing Spider-Man since 1963').class, 'SERIES_START_YEAR', '"since 1963" classifies as SERIES_START_YEAR');
  assertEq(classifyYearEvidence('Strange Tales #101 (1963) Marvel').class, 'ISSUE_PUBLICATION_YEAR', 'a genuine single-issue cover date still classifies as ISSUE_PUBLICATION_YEAR');
  assertEq(classifyYearEvidence('Strange Tales #101 (1963) Marvel').year, '1963', 'ISSUE_PUBLICATION_YEAR carries the correct year');
  assertEq(classifyYearEvidence('Strange Tales Marvel VF').class, 'SELLER_CONTEXT_UNKNOWN', 'no year at all -> SELLER_CONTEXT_UNKNOWN');
  assertEq(classifyYearEvidence('').class, 'SELLER_CONTEXT_UNKNOWN', 'empty title -> SELLER_CONTEXT_UNKNOWN');

  // Wired into classifyEvidenceRow: a SERIES_RANGE/SERIES_START_YEAR text
  // must NOT satisfy the exact issue-year check — this is exactly why
  // #142 and #76 survived era filtering in the real production case
  // (Strange Tales/Marvel, vintage -> collisionRisk=high ->
  // publicationIdentity required).
  const target = {
    issue: '142', seriesTitle: 'Strange Tales', confirmedYear: 1965, publisher: 'Marvel',
    isGraded: false, userGradeKey: 'raw', assetType: 'comic',
  };
  const rangeRow = { title: 'Strange Tales #142 (1951-76 1st Series) Marvel', price: 30, marketState: 'active' };
  const c = classifyEvidenceRow(rangeRow, target);
  assertFalse(c.rejectionCodes.includes('WRONG_YEAR'), '"(1951-76)" never produces WRONG_YEAR — it was never treated as an exact issue-year claim to begin with');
  assertTrue(c.rejectionCodes.includes('UNCONFIRMED_EDITION'), 'instead correctly falls through as UNCONFIRMED_EDITION — "no year evidence," same treatment as a genuinely undated row, on this vintage-Marvel (collision-risk) target');
  assertFalse(c.rawPricingEligible, 'not eligible for pricing either way');

  // Control: a genuine single-issue cover date on the SAME target, close
  // to confirmedYear, DOES pass the year axis normally.
  const genuineRow = { title: 'Strange Tales #142 (1966) Marvel', price: 30, marketState: 'active' };
  const c2 = classifyEvidenceRow(genuineRow, target);
  assertFalse(c2.rejectionCodes.includes('WRONG_YEAR'), 'control: a genuine close cover date does not trigger WRONG_YEAR');
  assertFalse(c2.rejectionCodes.includes('UNCONFIRMED_EDITION'), 'control: a genuine ISSUE_PUBLICATION_YEAR match does not need the UNCONFIRMED_EDITION fallback');
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT C.3 — reference/catalog-image condition-authority
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nCommit C.3: reference-image condition-authority\n');
{
  const refImage = assessPhotoAuthority('Strange Tales #142 - stock photo, actual item may vary');
  assertTrue(refImage.identityPhotoEligible, 'a detected reference image can still corroborate WHICH book this is');
  assertFalse(refImage.conditionPhotoEligible, 'condition confidence suppressed');
  assertFalse(refImage.listingPhotoEligible, 'listing-photo-readiness suppressed');
  assertFalse(refImage.ownershipEvidence, 'ownership/owned-copy evidence suppressed');

  const genuine = assessPhotoAuthority('Strange Tales #142 Marvel VG — my own scan, front and back shown');
  assertTrue(genuine.identityPhotoEligible, 'genuine listing: identityPhotoEligible true');
  assertTrue(genuine.conditionPhotoEligible, 'genuine listing: conditionPhotoEligible true');
  assertTrue(genuine.listingPhotoEligible, 'genuine listing: listingPhotoEligible true');
  assertTrue(genuine.ownershipEvidence, 'genuine listing: ownershipEvidence true');
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT D.1 — blocker text consumes identityGate.missing directly
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nCommit D.1: identity-not-confident blocker text uses the real missing-fields list\n');
{
  // Import describeBlocker directly to test the exact string produced.
}
{
  const { describeBlocker } = await import('../src/lib/decisionEngine.js');
  const issueOnly = describeBlocker('identity-not-confident', { identityMissingFields: ['issue'] });
  assertTrue(issueOnly.includes('issue number'), 'missing=["issue"] -> text names the issue, not a generic field list');
  assertFalse(issueOnly.includes('publisher'), 'missing=["issue"] only -> publisher is NOT mentioned as missing');
  assertFalse(issueOnly.includes('title'), 'missing=["issue"] only -> title is NOT mentioned as missing');

  const multi = describeBlocker('identity-not-confident', { identityMissingFields: ['issue', 'publisher'] });
  assertTrue(multi.includes('issue number'), 'multi-field case still names issue');
  assertTrue(multi.includes('publisher'), 'multi-field case correctly names publisher too, when it genuinely IS missing');

  const noField = describeBlocker('identity-not-confident', {});
  assertTrue(noField.length > 0, 'no identityMissingFields at all -> graceful fallback text, no throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// TRACK B PHASE 0, COMMIT 1 — PRICING_GATE_CODES gains TARGET_ISSUE_UNRESOLVED,
// verified via the REAL exported composition (buildPricingEligibleRows),
// not a test-local mirror of api/comps.js:2062's inline filter
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTrack B Phase 0 Commit 1: TARGET_ISSUE_UNRESOLVED now gates pricing math\n');
{
  assertTrue(PRICING_GATE_CODES.includes('TARGET_ISSUE_UNRESOLVED'), 'PRICING_GATE_CODES includes TARGET_ISSUE_UNRESOLVED');

  const target = { issue: null, seriesTitle: 'Strange Tales', confirmedYear: 1965, publisher: 'Marvel', isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const rows = [
    { title: 'Strange Tales #1 Marvel 1963 VF', price: 200, marketState: 'active' },
    { title: 'Strange Tales Annual Marvel', price: 50, marketState: 'sold' },
    { title: 'Strange Tales #142 Marvel', price: 30, marketState: 'active' },
  ];

  rows.forEach((row, i) => {
    const c = classifyEvidenceRow(row, target);
    assertTrue(c.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), `row ${i + 1}: still classified TARGET_ISSUE_UNRESOLVED`);
    assertFalse(isPricingMathEligible(c), `row ${i + 1}: isPricingMathEligible=false now that the code is gated (previously true before this commit)`);
  });

  // The real exported composition production calls at api/comps.js:2062 —
  // not a mirrored filter written in this test file. Closes the exact
  // "mirrored composition passes while the real call site drifts" gap
  // this commit's own dispatch named.
  const eligible = buildPricingEligibleRows(rows, target);
  assertEq(eligible.length, 0, 'buildPricingEligibleRows (the real production export) excludes all 3 rows when target.issue is null');
}

// Control: target.issue resolved and matching — confirms this commit does
// not over-narrow a normal, healthy pool.
{
  const target = { issue: '139', seriesTitle: 'The Flash', confirmedYear: 1963, publisher: 'DC Comics', isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const rows = [
    { title: 'The Flash #139 1963 VF', price: 200, year: 1963, marketState: 'active' },
  ];
  const eligible = buildPricingEligibleRows(rows, target);
  assertEq(eligible.length, 1, 'control: resolved issue + matching row -> buildPricingEligibleRows keeps it (unaffected by this commit)');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
