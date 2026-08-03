// tests/q-trackB-commit4-adoption-provisional.test.js
//
// Track B Phase 0, Commit 4 — adoption-from-null ALWAYS provisional +
// explicit server-side contract transition.
//
// Corrected invariant: when resolveFamilyIssueConsensus (identityCore.js)
// returns mode:'adopted' — only reachable when priorIssue was null, i.e.
// no Vision/user issue existed to corroborate or conflict with — the
// resulting issue number is ALWAYS provisional, never silently promoted to
// a confirmed value just because nothing contradicted it. Absence of
// contradiction is not corroboration.
//
// Every function under test here is the REAL exported production function
// at its real call site (invariant 10):
//   - resolveFamilyIssueConsensus, detectVisualIssueDivergence (identityCore.js)
//   - deriveIssueAuthorityFromAdoption, escalateIssueAuthorityOnConflict,
//     computeIssueAuthorityContractPatch (src/lib/issueAuthority.js —
//     api/enrich.js's own real call sites, verified by reading the diff)
//   - computeDecision (decisionEngine.js)
//   - finalizeResponse / assembleContract (responseContract.js)
// No test-local mirror of any of this logic exists anywhere in this file.
//
// Note on readiness (eight-joint-assertion point 5): src/App.jsx's
// getListingReadiness is not an exported function (no test in this
// campaign imports from App.jsx — it has no JSX-transform test harness),
// so it cannot be invoked directly here. Instead this file asserts the two
// REAL, exported upstream signals that deterministically drive it, with
// the causal chain verified by direct reading of the current App.jsx
// source (cited by line number below) rather than assumed:
//   - identityConfirmed tri-state (App.jsx ~line 439): `isUnresolved =
//     decision.action === 'ID_REQUIRED' || ...` — asserted via the REAL
//     out.decision.action from computeDecision.
//   - priceReady (App.jsx ~line 453): `status: price > 0 ? 'pass' : 'fail'`,
//     where price derives from getDisplayPrice, whose FIRST branch
//     (App.jsx ~line 229-231) is `item.contract && !item.priceOverridden
//     ? item.contract.price ?? 0 : ...` — asserted via the REAL
//     out.contract.price from finalizeResponse/assembleContract.
//
// Invoke: node tests/q-trackB-commit4-adoption-provisional.test.js

import { resolveFamilyIssueConsensus, detectVisualIssueDivergence } from '../src/lib/identityCore.js';
import {
  deriveIssueAuthorityFromAdoption,
  escalateIssueAuthorityOnConflict,
  computeIssueAuthorityContractPatch,
  mapConfidenceRatioToTier,
  canUseExactIssuePricingCache,
} from '../src/lib/issueAuthority.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { finalizeResponse, assembleContract } from '../src/lib/responseContract.js';
import { classifyEvidenceRow, buildEvidencePopulations, buildPricingEligibleRows, buildEvidenceForResponse, EVIDENCE_RESPONSE_BUCKETS, PRICING_GATE_CODES } from '../src/lib/evidenceEligibility.js';
import { getCorrectableFields, prepareManualCorrectionRequest, buildManualCorrectionProvenance, buildManualCorrectionPayload, applyManualCorrectionResult } from '../src/lib/manualCorrection.js';
import { fetchComps } from '../api/comps.js';
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

console.log('\n=== Track B Phase 0, Commit 4 — adoption-from-null ALWAYS provisional ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Fixture builders — a real, reconstructible 5-row pool where 4/5 rows agree
// on "#12" with no marketing-fluff/reprint contamination, priorIssue=null
// (no Vision/user issue existed). Clears the real adoption bar
// (uniqueRows>=3, ratio>=0.6, clear lead) via the REAL resolveFamilyIssueConsensus.
// ══════════════════════════════════════════════════════════════════════════════
function buildAdoptedPoolFixture() {
  const visualItems = [
    { itemId: '1', rawTitle: 'Test Family Comics #12 CGC 9.6' },
    { itemId: '2', rawTitle: 'Test Family Comics #12 VF/NM' },
    { itemId: '3', rawTitle: 'Test Family Comics #12 raw copy' },
    { itemId: '4', rawTitle: 'Test Family Comics #12 1st print' },
    { itemId: '5', rawTitle: 'Test Family Comics #9 lot' }, // dissenting row
  ];
  const indices = [0, 1, 2, 3, 4];
  return { visualItems, indices };
}

// The "adopting marketplace rows" for joint-assertion (7) — an active/sold
// comp-pool population (the DIFFERENT population evidenceEligibility.js
// actually prices from) carrying the same underlying marketplace-listing
// title text pattern that produced the #12 adoption above. Genuinely
// matches target.issue='12' by title (hasIssueNumber would pass them) —
// the point of the TARGET_ISSUE_PROVISIONAL_AUTHORITY gate is that a row
// textually matching an unconfirmed number is still not evidence the
// number is right, so these must be excluded from pricing-eligible
// populations purely on issueAuthorityStatus, independent of their own
// title match.
function buildAdoptingCompPoolFixture() {
  // Deliberately no grading-service text (CGC/CBCS) in any title — a
  // graded-looking row would ALSO trip FORMAT_MISMATCH_RAW_VS_SLAB
  // (a real, unrelated classification axis that outranks
  // TARGET_ISSUE_PROVISIONAL_AUTHORITY in buildEvidencePopulations'
  // display-bucket routing priority), which would be a genuine second
  // reason for exclusion, not a clean single-axis proof of this gate.
  return [
    { title: 'Test Family Comics #12 near mint raw', price: 52, marketState: 'active' },
    { title: 'Test Family Comics #12 VF/NM raw', price: 45, marketState: 'active' },
    { title: 'Test Family Comics #12 1st print', price: 38, marketState: 'sold' },
  ];
}

function buildOutFixture(issueAuthorityBundle) {
  return {
    title: 'Test Family Comics',
    issue: '12',
    publisher: 'Test Publisher',
    identityComplete: true,
    identityConfident: true, // pre-transition: pricing engine ran normally, thought identity was fine
    manualReviewRequired: false,
    claudeCheckBlocker: null,
    megaKey: null,
    editionWarning: null,
    isPolybagPricing: false,
    pricingSource: 'active_ask_derived',
    price: '$45.00',
    priceLow: '$38.00',
    priceHigh: '$52.00',
    priceBands: { quick: 38, market: 45, stretch: 52 },
    matchConfidence: { score: 82, tier: 'HIGH' },
    confidenceLevel: 'HIGH',
    rawComps: { count: 5, average: 45, lowest: 38, highest: 52, prices: [38, 40, 45, 50, 52] },
    soldComps: [{ price: '$44.00', daysAgo: 12 }],
    issueAuthority: issueAuthorityBundle.issueAuthority,
    identityProvisionalFields: issueAuthorityBundle.identityProvisionalFields,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TEETH-PROOF A — resolveFamilyIssueConsensus genuinely reaches mode:'adopted'
// on this fixture (not assumed) and deriveIssueAuthorityFromAdoption is the
// ONLY thing standing between 'adopted' and a naive silent-confirm. A naive
// implementation that skips this function entirely (the bug class this
// commit closes) would leave issueAuthority unset — demonstrated below,
// then contrasted with the real function's output.
// ══════════════════════════════════════════════════════════════════════════════
console.log('Teeth-proof A: resolveFamilyIssueConsensus reaches \'adopted\'; deriveIssueAuthorityFromAdoption is load-bearing\n');
{
  const { visualItems, indices } = buildAdoptedPoolFixture();
  const fic = resolveFamilyIssueConsensus(null, visualItems, indices);
  assertEq(fic.mode, 'adopted', 'real resolveFamilyIssueConsensus reaches mode=adopted on this fixture (4/5=0.8 ratio, clear lead, priorIssue=null)');
  assertEq(fic.winner, '12', 'winner is #12');
  assertEq(fic.uniqueRows, 5, 'uniqueRows=5');

  // Naive stand-in for "this commit was never written" — a caller that
  // just does nothing with an 'adopted' mode result (the historical,
  // pre-Commit-4 shape: familyIssueConsensus was computed and consumed
  // for confirmedIssue, but nothing ever downgraded confidence for it).
  const naiveIssueAuthority = undefined; // what out.issueAuthority would be with no Commit 4 code at all
  assertFalse(naiveIssueAuthority?.status === 'provisional', 'TEETH-PROOF: without this commit, issueAuthority is never set — a naive card would display fully confirmed');

  const derived = deriveIssueAuthorityFromAdoption(fic);
  assertEq(derived.issueAuthority.status, 'provisional', 'TEETH-PROOF: the REAL deriveIssueAuthorityFromAdoption sets status=provisional — confirms the naive check above is not vacuous, this function is what closes the gap');
  assertEq(derived.issueAuthority.source, 'marketplace', 'source=marketplace');
  assertEq(derived.issueAuthority.reasons, ['marketplace-only-adoption'], 'reasons=[marketplace-only-adoption]');
  assertEq(derived.issueAuthority.confidence, 'high', 'confidence is a string tier (\'high\', matching Commit 3\'s manualCorrection.js:602 \'high\' — same field, same type, no drift)');
  assertEq(derived.issueAuthority.supportRatio, 0.8, 'supportRatio carries the real adoption ratio (4/5=0.8) verbatim — no information lost by moving confidence to a tier string');
  assertEq(derived.identityProvisionalFields, ['issue'], 'identityProvisionalFields=[issue] (activates Commit 3\'s getCorrectableFields union-rendering)');
}

// ══════════════════════════════════════════════════════════════════════════════
// EIGHT JOINT ASSERTIONS — one pool-only-adoption fixture, asserted together.
// Mirrors the real api/enrich.js pipeline order: identity resolution ->
// issueAuthority derivation -> (pricing engine already ran, produced a
// price) -> Commit 4 terminal contract-patch -> computeDecision ->
// finalizeResponse.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nEight joint assertions: pool-only-adoption fixture\n');
{
  const { visualItems, indices } = buildAdoptedPoolFixture();
  const fic = resolveFamilyIssueConsensus(null, visualItems, indices);
  const derived = deriveIssueAuthorityFromAdoption(fic);
  const out = buildOutFixture(derived);

  // Preserve pre-transition snapshots for the I13 custody check below.
  const rawCompsBefore = JSON.stringify(out.rawComps);
  const soldCompsBefore = JSON.stringify(out.soldComps);

  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out);
  assertTrue(patch !== null, 'computeIssueAuthorityContractPatch returns a real patch for a provisional-from-adoption card');
  Object.assign(out, patch);

  out.decision = computeDecision(out, { source: 'test', timestamp: 1753747200000 });
  finalizeResponse(out);

  // (1)
  assertEq(out.issueAuthority.status, 'provisional', '(1) issueAuthority.status === provisional');
  // (2)
  assertEq(out.contract.state, 'ID_REQUIRED', '(2) contract identity state is blocked (ID_REQUIRED — same class as REFUSED, per deriveState precedence)');
  // (3)
  assertEq(out.contract.price, null, '(3a) no final price');
  assertEq(out.contract.bands, null, '(3b) no final price bands');
  // (4) — zero portfolio/liquid-value contribution: cites the REAL
  // App.jsx getDisplayPrice first branch verbatim (line ~230):
  // `item.contract && !item.priceOverridden ? item.contract.price ?? 0 : ...`
  assertEq(out.contract.price ?? 0, 0, '(4) zero portfolio/liquid-value contribution — getDisplayPrice\'s real first branch (item.contract.price ?? 0) evaluates to 0');
  // (5) — readiness: neither identity-confirmed nor price-ready. Cites the
  // REAL App.jsx getListingReadiness conditions verbatim (see file header).
  assertEq(out.decision.action, 'ID_REQUIRED', '(5a) decision.action === ID_REQUIRED — drives getListingReadiness isUnresolved=true (identityConfirmed !== pass)');
  assertEq(out.contract.price ?? 0, 0, '(5b) contract.price is not > 0 — drives getListingReadiness priceReady=fail');
  // (6)
  assertTrue(out.contract.listable === false, '(6a) contract.listable === false — listing is locked');
  assertTrue(out.listingHardLocked === true, '(6b) out.listingHardLocked === true');

  // (7) — the adopting marketplace rows are absent from every
  // pricing-eligible population, kept only as reference-only custody with
  // source/reason (I13). Real target shape via the REAL evidenceEligibility
  // exports (classifyEvidenceRow/buildEvidencePopulations/
  // buildPricingEligibleRows) — the SAME functions api/comps.js and
  // soldVerification.js's real call sites invoke, with issueAuthorityStatus
  // threaded through exactly as those real call sites do.
  const compPool = buildAdoptingCompPoolFixture();
  const evidenceTarget = {
    issue: out.issue,
    seriesTitle: out.title,
    assetType: 'comic',
    issueAuthorityPresent: out.issueAuthority != null,
    issueAuthorityStatus: out.issueAuthority.status,
  };
  const classifications = compPool.map((row) => classifyEvidenceRow(row, evidenceTarget));
  assertTrue(classifications.every((c) => c.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY')), '(7a) every adopting-marketplace row carries the TARGET_ISSUE_PROVISIONAL_AUTHORITY reason code, despite genuinely matching #12 by title');
  assertTrue(classifications.every((c) => c.rawPricingEligible === false), '(7b) every adopting-marketplace row is rawPricingEligible=false');
  const populations = buildEvidencePopulations(compPool, evidenceTarget);
  assertEq(populations.rawPricingPool.length, 0, '(7c) zero adopting-marketplace rows in the pricing-eligible population');
  assertEq(populations.provisionalAuthorityReferences.length, 3, '(7d) all 3 rows land in provisionalAuthorityReferences — reference-only custody, not deleted');
  assertTrue(
    populations.provisionalAuthorityReferences.every((r) => r.comparabilityStatus === 'PROVISIONAL_ISSUE_REFERENCE' && r.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY')),
    '(7e) each reference-only row carries its source/reason (comparabilityStatus + rejectionCodes), never a bare silent drop'
  );
  const pricingEligibleRows = buildPricingEligibleRows(compPool, evidenceTarget);
  assertEq(pricingEligibleRows.length, 0, '(7f) buildPricingEligibleRows (the real api/comps.js/soldVerification.js gate) excludes all 3 rows');
  assertTrue(PRICING_GATE_CODES.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), '(7g) TARGET_ISSUE_PROVISIONAL_AUTHORITY is a real pricing-math gate code, not display-only');

  // (8) — exact-cache read/write ineligible via the real exported guard.
  assertFalse(canUseExactIssuePricingCache(out.issue, out.issueAuthority), '(8) canUseExactIssuePricingCache returns false — exact-pricing cache read/write ineligible');

  // I13 custody — comp pool never nulled/altered, only the derived price.
  assertEq(JSON.stringify(out.rawComps), rawCompsBefore, 'I13 custody: out.rawComps byte-identical, never nulled');
  assertEq(JSON.stringify(out.soldComps), soldCompsBefore, 'I13 custody: out.soldComps byte-identical, never nulled');
  // GrailKey Commit Q (Q0, 2026-08-03) — corrected. This fixture's out.price
  // is the fmtUsd-formatted string '$45.00' (line ~123), matching what most
  // real api/enrich.js pricing writers actually produce. Pre-Commit-Q,
  // computeIssueAuthorityContractPatch copied it into
  // hypotheticalReferenceEstimate verbatim as that same string — which is
  // exactly the shape that produced the live "$NaN" render bug
  // (App.jsx: Number('$45.00').toFixed(2) === 'NaN'). Commit Q coerces at
  // the write site with parsePriceNumber (responseContract.js), so the
  // field now holds the genuine number 45, never the pre-formatted string.
  // "Preserved verbatim" was never actually the intended contract — I13
  // custody requires the VALUE survive, not its display formatting; this
  // assertion was asserting the bug's own byproduct.
  assertEq(out.hypotheticalReferenceEstimate, 45, 'I13: the pipeline\'s computed price ($45.00) is preserved as the number 45 (coerced, not the raw "$45.00" string), not silently deleted');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEETH-PROOF B — computeIssueAuthorityContractPatch is genuinely
// load-bearing for the contract transition: with issueAuthority.status left
// at a naive 'confirmed'/undefined (simulating a regression where Commit
// 4's early write never ran), the patch is null and the ORIGINAL price
// flows straight through to a PRICED/ESTIMATED contract — contrasted with
// the real provisional case above, which blocks it.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTeeth-proof B: computeIssueAuthorityContractPatch is load-bearing for the contract transition\n');
{
  const naiveOut = buildOutFixture({ issueAuthority: undefined, identityProvisionalFields: undefined });
  const naivePatch = computeIssueAuthorityContractPatch(naiveOut.issueAuthority, naiveOut);
  assertEq(naivePatch, null, 'no issueAuthority set -> no patch -> nothing blocks this card');
  naiveOut.decision = computeDecision(naiveOut, { source: 'test', timestamp: 1753747200000 });
  finalizeResponse(naiveOut);
  assertFalse(naiveOut.contract.state === 'ID_REQUIRED' || naiveOut.contract.state === 'REFUSED', 'TEETH-PROOF: without a provisional/conflicted issueAuthority, this same $45 card prices normally (PRICED/ESTIMATED) — confirms the eight-joint-assertion block above is not vacuous, Commit 4\'s patch is what blocks it');
  assertTrue(naiveOut.contract.price != null, 'TEETH-PROOF: naive card shows a real, non-null price');
}

// ══════════════════════════════════════════════════════════════════════════════
// FULL-RESULT 10x DETERMINISM — the same synthetic adoption-from-null input
// produces a byte-identical COMPLETE result on all ten runs: the authority
// object (including supportRatio and reasons IN ORDER), provisional fields,
// contract state, price/reference treatment, cache eligibility, and listing
// eligibility — not just issueAuthority.status in isolation. Runs the same
// real-export chain as the eight-joint-assertion block above, once per
// iteration, fresh fixtures each time (no shared mutable state that could
// mask non-determinism).
// ══════════════════════════════════════════════════════════════════════════════
function runFullPipelineOnce() {
  const { visualItems, indices } = buildAdoptedPoolFixture();
  const fic = resolveFamilyIssueConsensus(null, visualItems, indices);
  const derived = deriveIssueAuthorityFromAdoption(fic);
  const out = buildOutFixture(derived);

  const cacheEligible = canUseExactIssuePricingCache(out.issue, out.issueAuthority);

  const compPool = buildAdoptingCompPoolFixture();
  const evidenceTarget = { issue: out.issue, seriesTitle: out.title, assetType: 'comic', issueAuthorityPresent: out.issueAuthority != null, issueAuthorityStatus: out.issueAuthority.status };
  const populations = buildEvidencePopulations(compPool, evidenceTarget);

  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out);
  if (patch) Object.assign(out, patch);
  out.decision = computeDecision(out, { source: 'test', timestamp: 1753747200000 });
  finalizeResponse(out);

  // A deliberately complete, deterministically-ordered snapshot — every
  // field named in the dispatch (authority incl. supportRatio, reasons
  // AND their order, provisional fields, contract state, price/reference
  // treatment, cache eligibility, listing eligibility), nothing omitted.
  return {
    issueAuthority: out.issueAuthority,
    identityProvisionalFields: out.identityProvisionalFields,
    contractState: out.contract.state,
    contractPrice: out.contract.price,
    contractBands: out.contract.bands,
    contractListable: out.contract.listable,
    hypotheticalReferenceEstimate: out.hypotheticalReferenceEstimate,
    cacheEligible,
    pricingEligiblePoolSize: populations.rawPricingPool.length,
    provisionalAuthorityReferenceCount: populations.provisionalAuthorityReferences.length,
    listingHardLocked: out.listingHardLocked,
    listingHardLockReason: out.listingHardLockReason,
    decisionAction: out.decision.action,
  };
}

console.log('\nFull-result 10x determinism\n');
{
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(runFullPipelineOnce());
  }
  assertEq(results.length, 10, 'ran 10 times');
  const serialized = results.map((r) => JSON.stringify(r));
  assertEq(new Set(serialized).size, 1, 'full-result 10x determinism: all 10 complete results are byte-identical (deep-equal), not just status');
  // Sanity: the shared shape is actually the expected one, not 10 identical
  // wrong answers.
  assertEq(results[0].issueAuthority.status, 'provisional', 'the shared full result has status=provisional');
  assertEq(results[0].issueAuthority.reasons, ['marketplace-only-adoption'], 'the shared full result has the expected reasons array, in order');
  assertEq(results[0].issueAuthority.supportRatio, 0.8, 'the shared full result has the expected supportRatio');
  assertEq(results[0].contractState, 'ID_REQUIRED', 'the shared full result has the expected contract state');
  assertEq(results[0].pricingEligiblePoolSize, 0, 'the shared full result has the expected pricing-eligible pool size');
  assertEq(results[0].cacheEligible, false, 'the shared full result has the expected cache eligibility');
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTRADICTION-FIRED CASE — a LATER, differently-scoped marketplace
// population (the pool-wide eBay visual consensus, as opposed to the
// family-scoped adoption vote above) disagreeing escalates provisional ->
// conflicted, preserving all reasons. This is same-source (marketplace)
// disagreement, not independent corroboration — it can only ever escalate
// uncertainty, never promote toward 'confirmed' (that requires a genuinely
// independent source: Vision, physical indicia/fingerprint, or an explicit
// user correction, Commit 3).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nContradiction-detector-fired case: escalates to conflicted, preserves all reasons\n');
{
  const { visualItems, indices } = buildAdoptedPoolFixture();
  const fic = resolveFamilyIssueConsensus(null, visualItems, indices);
  const derived = deriveIssueAuthorityFromAdoption(fic);
  assertEq(derived.issueAuthority.status, 'provisional', 'starts provisional');

  // Real detectVisualIssueDivergence call — confirmedIssue (#12, adopted
  // above) vs a LATER, differently-scoped pool-wide eBay visual-consensus
  // value that disagrees (#9 — the same dissenting issue the pool fixture
  // itself contains a minority vote for). Same marketplace evidence class
  // as the adoption itself, not an independent source.
  const divergence = detectVisualIssueDivergence('12', '9');
  assertTrue(divergence !== null, 'real detectVisualIssueDivergence detects the #12 vs #9 divergence');
  const issueConsensusConflict = {
    currentIssue: divergence.confirmedIssue,
    consensusIssue: divergence.visualIssue,
    currentSource: 'title-family-top-rank-protection',
    support: null,
    population: null,
    ratio: null,
    decision: 'locked',
  };

  const escalated = escalateIssueAuthorityOnConflict(derived.issueAuthority, issueConsensusConflict);
  assertEq(escalated.status, 'conflicted', 'status escalates provisional -> conflicted');
  assertEq(escalated.reasons, ['marketplace-only-adoption', 'visual-pool-issue-divergence'], 'ALL reasons preserved — original reason kept, new one appended, none dropped');
  assertTrue(escalated !== derived.issueAuthority, 'pure function: returns a NEW object, does not mutate the input');
  assertEq(derived.issueAuthority.status, 'provisional', 'original object unmutated — still provisional');

  // No-conflict case: escalation must be a genuine no-op (same reference).
  const notEscalated = escalateIssueAuthorityOnConflict(derived.issueAuthority, null);
  assertTrue(notEscalated === derived.issueAuthority, 'no issueConsensusConflict -> no escalation -> same reference returned (referential no-op)');

  // Full pipeline for the escalated (conflicted) case — contract still blocks.
  const out = buildOutFixture({ issueAuthority: escalated, identityProvisionalFields: ['issue'] });
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out);
  assertTrue(patch !== null, 'conflicted status also produces a patch');
  assertEq(patch.pricingSource, 'refused-issue-authority-conflicted', 'pricingSource reflects the conflicted-specific slug');
  assertEq(patch.listingHardLockReason, 'issue-authority-conflicted', 'listingHardLockReason reflects the conflicted-specific slug');
  Object.assign(out, patch);
  out.decision = computeDecision(out, { source: 'test', timestamp: 1753747200000 });
  finalizeResponse(out);
  assertEq(out.contract.state, 'ID_REQUIRED', 'conflicted case also routes to the ID_REQUIRED-class contract state');
  assertEq(out.contract.price, null, 'conflicted case also nulls price');
}

// ══════════════════════════════════════════════════════════════════════════════
// Behavior matrix sanity — modes this commit does NOT touch stay inert.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nBehavior matrix: untouched modes stay inert\n');
{
  assertEq(deriveIssueAuthorityFromAdoption({ mode: 'corroborated', ratio: 1 }).issueAuthority, null, 'mode=corroborated -> no issueAuthority written by this function');
  assertEq(deriveIssueAuthorityFromAdoption({ mode: 'conflict-locked', ratio: 0.8 }).issueAuthority, null, 'mode=conflict-locked -> no issueAuthority written by this function (out.issueConsensusConflict is the pre-existing, untouched mechanism for this mode)');
  assertEq(deriveIssueAuthorityFromAdoption({ mode: 'no-consensus', ratio: 0 }).issueAuthority, null, 'mode=no-consensus -> inert');
  assertEq(deriveIssueAuthorityFromAdoption(null).issueAuthority, null, 'null familyIssueConsensus -> inert, no throw');
  assertEq(deriveIssueAuthorityFromAdoption(undefined).issueAuthority, null, 'undefined familyIssueConsensus -> inert, no throw');
}

// ══════════════════════════════════════════════════════════════════════════════
// mapConfidenceRatioToTier — boundary behavior. resolveFamilyIssueConsensus's
// own adoption bar (ratio>=0.6) makes 'low' structurally unreachable via the
// real 'adopted' path, but the mapping itself is tested across its full
// domain, not just the reachable slice.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nmapConfidenceRatioToTier boundaries\n');
{
  assertEq(mapConfidenceRatioToTier(1.0), 'high', 'ratio=1.0 -> high');
  assertEq(mapConfidenceRatioToTier(0.8), 'high', 'ratio=0.8 (boundary) -> high');
  assertEq(mapConfidenceRatioToTier(0.79), 'medium', 'ratio=0.79 (just under high boundary) -> medium');
  assertEq(mapConfidenceRatioToTier(0.6), 'medium', 'ratio=0.6 (the real adoption-bar minimum) -> medium');
  assertEq(mapConfidenceRatioToTier(0.59), 'low', 'ratio=0.59 (just under the adoption bar, structurally unreachable via \'adopted\' but tested anyway) -> low');
  assertEq(mapConfidenceRatioToTier(0), 'low', 'ratio=0 -> low');
}

// ══════════════════════════════════════════════════════════════════════════════
// FAIL-CLOSED INVERSION (review round, fix 2) — canUseExactIssuePricingCache
// and the TARGET_ISSUE_PROVISIONAL_AUTHORITY gate must ALLOWLIST known-safe
// shapes (absent issueAuthority, or status='confirmed'), not blocklist
// known-bad ones. An unrecognized/future status value must be treated as
// not-yet-trustworthy by both surfaces, never silently pass through.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFail-closed inversion: unknown/future issueAuthority.status values\n');
{
  const unknownAuthority = { source: 'some-future-source', status: 'pending-external-review', reasons: [], priorObservations: [] };
  assertFalse(canUseExactIssuePricingCache('12', unknownAuthority), 'canUseExactIssuePricingCache: an unrecognized status value is ineligible (fail-closed), not silently cached');
  assertTrue(canUseExactIssuePricingCache('12', undefined), 'canUseExactIssuePricingCache: no issueAuthority at all (legacy shape) stays eligible — allowlist, not a blanket new restriction');
  assertTrue(canUseExactIssuePricingCache('12', { status: 'confirmed' }), 'canUseExactIssuePricingCache: status=confirmed stays eligible');

  const row = { title: 'Test Family Comics #12 raw copy', price: 40, marketState: 'active' };
  const targetUnknownAuthority = { issue: '12', seriesTitle: 'Test Family Comics', assetType: 'comic', issueAuthorityPresent: true, issueAuthorityStatus: 'pending-external-review' };
  const cUnknown = classifyEvidenceRow(row, targetUnknownAuthority);
  assertTrue(cUnknown.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), 'classifyEvidenceRow: an unrecognized issueAuthorityStatus value (present=true) is gated (fail-closed), not silently treated as confirmed');
  assertFalse(cUnknown.rawPricingEligible, 'classifyEvidenceRow: unrecognized status -> rawPricingEligible=false');

  // Presence-threading correction's own reason for existing: an authority
  // object that GENUINELY EXISTS (issueAuthorityPresent=true) but whose own
  // .status is itself null/undefined (a malformed present record) must be
  // gated — NOT treated the same as "no authority tracking at all." Before
  // this correction, both cases collapsed to the identical bare `null` one
  // layer up (api/enrich.js's `out.issueAuthority?.status || null`) and
  // were indistinguishable by the time they reached this function.
  const targetPresentButStatusless = { issue: '12', seriesTitle: 'Test Family Comics', assetType: 'comic', issueAuthorityPresent: true, issueAuthorityStatus: null };
  const cPresentStatusless = classifyEvidenceRow(row, targetPresentButStatusless);
  assertTrue(cPresentStatusless.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), 'classifyEvidenceRow: issueAuthorityPresent=true with a null/malformed status is gated — presence alone (not status) is what distinguishes this from the truly-absent case');
  assertFalse(cPresentStatusless.rawPricingEligible, 'classifyEvidenceRow: present-but-statusless -> rawPricingEligible=false');

  const targetNoAuthority = { issue: '12', seriesTitle: 'Test Family Comics', assetType: 'comic' };
  const cNone = classifyEvidenceRow(row, targetNoAuthority);
  assertFalse(cNone.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), 'classifyEvidenceRow: no issueAuthorityPresent/Status at all -> gate does not fire (legacy shape unaffected)');
  assertTrue(cNone.rawPricingEligible, 'classifyEvidenceRow: truly-absent authority -> rawPricingEligible unaffected by this gate (genuinely different outcome from the present-but-statusless case directly above, same row, same issue, same title)');
}

// ══════════════════════════════════════════════════════════════════════════════
// Guard: a more fundamental prior refusal is never double-fired over.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nGuard: already-refused card is not double-patched\n');
{
  const out = { issueAuthority: { status: 'provisional', reasons: ['marketplace-only-adoption'] }, refusedToPrice: true, price: null };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out);
  assertEq(patch, null, 'priorOut.refusedToPrice===true -> no double-patch, one refusal reason per card');
}

// ══════════════════════════════════════════════════════════════════════════════
// ANTI-OVERCORRECTION CONTROLS — Commit 4's mechanism must be inert for
// every case that already had real authority, through the real exports
// each case actually depends on. A gate that demotes everything looks
// "safe" but is a different bug; these controls prove it doesn't.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nAnti-overcorrection controls\n');

// (a) prior confirmed issue + agreeing pool stays confirmed — never demoted.
{
  const agreeingVisualItems = [
    { itemId: '1', rawTitle: 'Test Family Comics #12 CGC 9.6' },
    { itemId: '2', rawTitle: 'Test Family Comics #12 VF/NM' },
    { itemId: '3', rawTitle: 'Test Family Comics #12 raw copy' },
    { itemId: '4', rawTitle: 'Test Family Comics #12 1st print' },
    { itemId: '5', rawTitle: 'Test Family Comics #12 lot' },
  ];
  const fic = resolveFamilyIssueConsensus('12', agreeingVisualItems, [0, 1, 2, 3, 4]);
  assertEq(fic.mode, 'corroborated', 'a prior issue (#12) agreeing with a 5/5 unanimous pool -> mode=corroborated, not adopted');
  const derived = deriveIssueAuthorityFromAdoption(fic);
  assertEq(derived.issueAuthority, null, "(a) deriveIssueAuthorityFromAdoption has nothing to say about 'corroborated' — issueAuthority stays whatever it already was, never demoted to provisional");

  // Full pipeline: no issueAuthority was ever set for this card (the
  // pre-Commit-4, legacy shape every already-confirmed card has) ->
  // computeIssueAuthorityContractPatch must be a genuine no-op -> price
  // flows through normally, exactly as it did before this commit existed.
  const out = buildOutFixture({ issueAuthority: undefined, identityProvisionalFields: undefined });
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out);
  assertEq(patch, null, '(a) no patch — a corroborated/already-confirmed card is never touched by Commit 4\'s contract transition');
  out.decision = computeDecision(out, { source: 'test', timestamp: 1753747200000 });
  finalizeResponse(out);
  assertFalse(out.contract.state === 'ID_REQUIRED' || out.contract.state === 'REFUSED', '(a) corroborated case: contract state is NOT ID_REQUIRED/REFUSED — never demoted');
  assertTrue(out.contract.price != null, '(a) corroborated case: real, non-null price survives');
}

// (b) Commit 3 user-confirmed authority stays confirmed.
{
  const body = {
    manualAuthority: { correctedFields: ['issue'] },
    manualIdentity: true,
    skipVision: true,
    skipImageSearch: true,
    identitySource: 'manual',
    title: 'Test Family Comics',
    issue: '12',
    year: '2001',
    publisher: 'Test Publisher',
  };
  // priorIdentity: the client's own snapshot of the card BEFORE correction
  // — here, a genuinely Commit-4-provisional card (source:'marketplace',
  // status:'provisional'), proving the two commits compose correctly: a
  // real user correction promotes a marketplace-only-provisional issue to
  // user-confirmed, not the other way around.
  const priorIdentity = { issue: '9', issueAuthority: { source: 'marketplace', status: 'provisional', confidence: 'high', supportRatio: 0.8, reasons: ['marketplace-only-adoption'], priorObservations: [] } };
  const prepared = prepareManualCorrectionRequest(body, 2026);
  assertTrue(prepared.valid, '(b) real prepareManualCorrectionRequest accepts this correction request');
  const provenance = buildManualCorrectionProvenance(prepared.validation, priorIdentity);
  assertEq(provenance.issueAuthority.status, 'confirmed', "(b) Commit 3's real buildManualCorrectionProvenance sets status=confirmed for a user correction");
  assertEq(provenance.issueAuthority.source, 'user', '(b) source=user');
  assertEq(provenance.issueAuthority.priorObservations[0].status, 'provisional', '(b) prior observation honestly records the marketplace-provisional status it superseded');

  const patch = computeIssueAuthorityContractPatch(provenance.issueAuthority, { price: '$45.00', refusedToPrice: false });
  assertEq(patch, null, '(b) computeIssueAuthorityContractPatch is a no-op for status=confirmed — user-confirmed authority is never demoted back to provisional/ID_REQUIRED');
}

// (c) a provisional issue activates getCorrectableFields -> ['issue'], and
// the correction submit path uses Commit 3's real helpers end-to-end.
{
  const { visualItems, indices } = buildAdoptedPoolFixture();
  const fic = resolveFamilyIssueConsensus(null, visualItems, indices);
  const derived = deriveIssueAuthorityFromAdoption(fic);
  const item = { id: 'card-provisional-1', title: 'Test Family Comics', issue: '12', identityMissingFields: [], identityProvisionalFields: derived.identityProvisionalFields, issueAuthority: derived.issueAuthority };

  assertEq(getCorrectableFields(item), ['issue'], "(c) real getCorrectableFields(item) returns ['issue'] for a Commit-4-provisional card — activates the correction form (App.jsx) via the same union rule Commit 3 shipped");

  // Real submit path: buildManualCorrectionPayload (the exact request body
  // App.jsx's submitManualCorrection constructs) -> prepareManualCorrectionRequest
  // (server-side validation) -> buildManualCorrectionProvenance -> applyManualCorrectionResult
  // (collection replacement). All Commit 3 exports, none re-implemented here.
  const correctedValues = { issue: '3' };
  const payload = buildManualCorrectionPayload(item, correctedValues, ['issue']);
  assertEq(payload.manualAuthority.correctedFields, ['issue'], '(c) real buildManualCorrectionPayload payload carries the corrected field');
  assertEq(payload.priorIdentity.issueAuthority, derived.issueAuthority, "(c) real payload's priorIdentity snapshot carries the actual provisional issueAuthority forward, honestly");
  const submitBody = { ...payload, manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual' };
  const preparedC = prepareManualCorrectionRequest(submitBody, 2026);
  assertTrue(preparedC.valid, '(c) real prepareManualCorrectionRequest accepts the submitted correction');
  const enrichData = { title: 'Test Family Comics', issue: '3', year: '2001', publisher: 'Test Publisher' };
  const { updatedCatalogue, correctedItem } = applyManualCorrectionResult([item], item, enrichData);
  assertEq(updatedCatalogue.length, 1, '(c) real applyManualCorrectionResult keeps collection length unchanged (replace, not append)');
  assertEq(correctedItem.issue, '3', '(c) corrected item carries the new issue');
  assertEq(correctedItem.id, 'card-provisional-1', '(c) same collection ID survives the correction');
}

// (d) no-issue-axis assets (tpb/book/collected) unaffected by issueAuthorityStatus.
{
  const row = { title: 'Test Family Comics: The Complete Collection TPB', price: 30, marketState: 'active' };
  const targetWithoutAuthority = { issue: '12', seriesTitle: 'Test Family Comics', assetType: 'tpb' };
  const targetWithProvisionalAuthority = { ...targetWithoutAuthority, issueAuthorityPresent: true, issueAuthorityStatus: 'provisional' };
  const cWithout = classifyEvidenceRow(row, targetWithoutAuthority);
  const cWith = classifyEvidenceRow(row, targetWithProvisionalAuthority);
  assertFalse(cWith.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), '(d) TPB target: TARGET_ISSUE_PROVISIONAL_AUTHORITY never fires — no issue axis to gate');
  assertEq(cWith.rawPricingEligible, cWithout.rawPricingEligible, '(d) TPB target: rawPricingEligible identical with or without issueAuthorityStatus=provisional — genuinely unaffected, not coincidentally equal');
  assertEq(JSON.stringify(cWith), JSON.stringify(cWithout), '(d) TPB target: the FULL classification is byte-identical with or without issueAuthorityStatus set');
}

// ══════════════════════════════════════════════════════════════════════════════
// RESPONSE-SHAPE COMPLETENESS (review round, structural upgrade) — iterates
// the SAME exported EVIDENCE_RESPONSE_BUCKETS list the real
// buildEvidenceForResponse (api/comps.js's real call sites) uses, covering
// BOTH sides App.jsx actually reads: activeEvidence (api/comps.js's
// evidence, via buildEvidenceForResponse) and soldEvidence
// (soldVerification.js's evidence, the raw buildEvidencePopulations
// result) — App.jsx:7010-7011 reads `item.activeEvidence?.similarTitleReferences`
// and `item.soldEvidence?.similarTitleReferences`, so a response-shape
// proof covering only one side would miss half the real regression surface.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nResponse-shape completeness: EVIDENCE_RESPONSE_BUCKETS on both activeEvidence and soldEvidence shapes\n');
{
  const { visualItems, indices } = buildAdoptedPoolFixture();
  const fic = resolveFamilyIssueConsensus(null, visualItems, indices);
  const derived = deriveIssueAuthorityFromAdoption(fic);
  const compPool = buildAdoptingCompPoolFixture();
  const evidenceTarget = { issue: '12', seriesTitle: 'Test Family Comics', assetType: 'comic', issueAuthorityPresent: derived.issueAuthority != null, issueAuthorityStatus: derived.issueAuthority.status };
  const populations = buildEvidencePopulations(compPool, evidenceTarget);

  // activeEvidence shape — api/comps.js's real construction.
  const activeEvidence = buildEvidenceForResponse(populations, [{ title: 'era-rejected sample', reason: 'era-year-mismatch:test' }]);
  for (const bucket of EVIDENCE_RESPONSE_BUCKETS) {
    assertTrue(Array.isArray(activeEvidence[bucket]), `activeEvidence.${bucket} is an array (never undefined/missing) — matches App.jsx's real item.activeEvidence?.${bucket} read`);
  }
  assertEq(activeEvidence.provisionalAuthorityReferences.length, 3, 'activeEvidence.provisionalAuthorityReferences carries the 3 adopting-marketplace rows');
  assertEq(activeEvidence.eraRejectedReferenceRows.length, 1, 'activeEvidence.eraRejectedReferenceRows carries the era-rejected sample passed in separately');

  // soldEvidence shape — soldVerification.js's real construction (`evidence:
  // evidencePopulations`, the raw object, no buildEvidenceForResponse call).
  // Confirmed by direct reading of the real file (src/lib/soldVerification.js,
  // all 3 return sites): it already carries every bucket in this list
  // EXCEPT eraRejectedReferenceRows, which has no sold-side equivalent stage
  // at all (documented, not silently missing) — asserted explicitly below,
  // not just skipped.
  const soldEvidence = populations;
  for (const bucket of EVIDENCE_RESPONSE_BUCKETS) {
    if (bucket === 'eraRejectedReferenceRows') continue;
    assertTrue(Array.isArray(soldEvidence[bucket]), `soldEvidence.${bucket} is an array (never undefined/missing) — matches App.jsx's real item.soldEvidence?.${bucket} read`);
  }
  assertEq(soldEvidence.eraRejectedReferenceRows, undefined, 'soldEvidence has no eraRejectedReferenceRows field at all — documented absence (no sold-side era pre-filter stage), not a silent gap');
  assertEq(soldEvidence.similarTitleReferences, [], 'soldEvidence.similarTitleReferences present and empty for this fixture (no TARGET_ISSUE_UNRESOLVED rows) — confirms the pre-existing App.jsx-consumed field was never actually missing on the sold side');
  assertEq(soldEvidence.provisionalAuthorityReferences.length, 3, 'soldEvidence.provisionalAuthorityReferences carries the 3 adopting-marketplace rows — identical population, both shapes agree');
}

// ══════════════════════════════════════════════════════════════════════════════
// FETCHCOMPS INTEGRATION TEST (review round) — the real HTTP-layer
// api/comps.js:fetchComps, with global.fetch mocked. Same established
// pattern as tests/q-trackB-commit2-era-classification.test.js /
// tests/q141-v0i-slab-exclusion.test.js / tests/q120-cv-year-penalty-and-marvel-tokenize.test.js /
// tests/q-batman222-cv-zero-score.test.js / tests/perf-kv-dedup-and-oauth-cache.test.js
// — no new harness. Proves the TARGET_ISSUE_PROVISIONAL_AUTHORITY gate and
// the evidenceForResponse/Fix-1 wiring hold end-to-end through the REAL
// production consumer, not just at the classifyEvidenceRow/
// buildEvidencePopulations unit level (everything above this point tests
// pure functions directly; fetchComps itself — the function Fix 1 actually
// patched — was never exercised end-to-end until this section).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nfetchComps integration test (mocked eBay Browse API)\n');

const OAUTH_RESPONSE_C4 = JSON.stringify({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });
const makeMockFetchC4 = (browseItems) => async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token')) {
    return { ok: true, status: 200, text: async () => OAUTH_RESPONSE_C4, json: async () => JSON.parse(OAUTH_RESPONSE_C4) };
  }
  if (u.includes('item_summary/search')) {
    const itemSummaries = browseItems.map((it, i) => ({
      itemId: `v1|c4test-${i}|0`,
      title: it.title,
      price: { value: String(it.price), currency: 'USD' },
      itemWebUrl: `https://www.ebay.com/itm/c4test-${i}`,
      condition: 'Ungraded',
    }));
    return { ok: true, status: 200, json: async () => ({ itemSummaries }) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const baseParamsC4 = {
  title: 'Test Family Comics',
  issue: '12',
  grade: 'VF 8.0',
  isGraded: false,
  numericGrade: 8,
  year: '2001',
  imageSearchTitle: null,
  appId: 'test-app-id',
  certId: 'test-cert-id',
  categoryId: '259104',
  assetType: 'comic',
};

const GENUINE_ROWS_C4 = [
  { title: 'Test Family Comics #12 (2001) Test Publisher', price: 40 },
  { title: 'Test Family Comics #12 2001 raw copy', price: 45 },
  { title: 'Test Family Comics #12 near mint 2001', price: 50 },
];

const originalFetchC4 = globalThis.fetch;

// Sorted structured comparison — ordering through classification/population
// construction is NOT a contractual guarantee (push order happens to match
// input order today, but nothing in classifyEvidenceRow/buildEvidencePopulations
// documents or enforces that), so exact-content assertions sort by title
// first rather than relying on array index correspondence.
const sortedTitlePrice = (rows) =>
  [...rows].map((r) => ({ title: r.title, price: r.price })).sort((a, b) => a.title.localeCompare(b.title));

const runFetchCompsIntegration = async () => {
  // --- Control: NO issueAuthorityStatus — the same genuine pool prices
  // normally. Establishes the baseline this fixture would price at, so the
  // provisional case below is a genuine A/B, not just "count is 0" in
  // isolation (which could mean the fixture never priced at all).
  globalThis.fetch = makeMockFetchC4(GENUINE_ROWS_C4);
  const resultControl = await fetchComps({ ...baseParamsC4, issueAuthorityPresent: false, issueAuthorityStatus: null });
  assertTrue(resultControl.count > 0, 'CONTROL: issueAuthorityPresent=false -> genuine pool prices normally (count > 0), proving the fixture is a real, otherwise-valid comp pool');
  assertEq(resultControl.evidence.provisionalAuthorityReferences.length, 0, 'CONTROL: evidence.provisionalAuthorityReferences is empty — the gate never fires without a present, non-confirmed authority');

  // --- Provisional case: SAME pool, issueAuthorityPresent:true +
  // issueAuthorityStatus:'provisional' — every row demoted, count collapses
  // to 0 via the real zero-eligible early return (Fix 1's own target),
  // evidence preserved (not dropped).
  globalThis.fetch = makeMockFetchC4(GENUINE_ROWS_C4);
  const resultProvisional = await fetchComps({ ...baseParamsC4, issueAuthorityPresent: true, issueAuthorityStatus: 'provisional' });
  assertEq(resultProvisional.count, 0, 'PROVISIONAL: same genuine pool -> count=0 through the real TARGET_ISSUE_PROVISIONAL_AUTHORITY gate, via the real fetchComps zero-eligible early return');
  assertTrue(resultProvisional.evidence !== undefined, 'PROVISIONAL: evidence is present on the zero-eligible early return (Fix 1) — was previously dropped entirely by the bare emptyComps() spread');
  // Item 1 (evidence-only completion pass) — EXACT response assertions,
  // not just count/length. emptyComps() itself always sets prices/
  // recentSales to bare empty arrays; asserted explicitly here (not just
  // inferred from count===0) so a future regression that repopulated
  // either from the wrong pool would be caught directly.
  assertEq(resultProvisional.prices, [], 'PROVISIONAL: resultProvisional.prices is exactly []');
  assertEq(resultProvisional.recentSales, [], 'PROVISIONAL: resultProvisional.recentSales is exactly []');
  assertEq(resultProvisional.evidence.provisionalAuthorityReferences.length, 3, 'PROVISIONAL: provisionalAuthorityReferences contains exactly the three input rows (count)');
  assertEq(
    sortedTitlePrice(resultProvisional.evidence.provisionalAuthorityReferences),
    sortedTitlePrice(GENUINE_ROWS_C4),
    'PROVISIONAL: provisionalAuthorityReferences carries the exact input titles AND exact numeric prices (sorted structured comparison — ordering is not asserted as contractual)'
  );
  assertTrue(
    resultProvisional.evidence.provisionalAuthorityReferences.every((r) => r.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY') && r.comparabilityStatus === 'PROVISIONAL_ISSUE_REFERENCE'),
    'PROVISIONAL: every preserved row carries both TARGET_ISSUE_PROVISIONAL_AUTHORITY (rejectionCodes) and PROVISIONAL_ISSUE_REFERENCE (comparabilityStatus)'
  );
  for (const bucket of EVIDENCE_RESPONSE_BUCKETS) {
    assertTrue(Array.isArray(resultProvisional.evidence[bucket]), `PROVISIONAL: evidence.${bucket} is present as an array on the real fetchComps zero-eligible return — full bucket set, not a partial object`);
  }

  // --- Conflicted case: same mechanism, different status value.
  globalThis.fetch = makeMockFetchC4(GENUINE_ROWS_C4);
  const resultConflicted = await fetchComps({ ...baseParamsC4, issueAuthorityPresent: true, issueAuthorityStatus: 'conflicted' });
  assertEq(resultConflicted.count, 0, 'CONFLICTED: same gate fires for status=conflicted');
  assertEq(resultConflicted.evidence.provisionalAuthorityReferences.length, 3, 'CONFLICTED: all 3 rows preserved as reference-only');

  // --- Presence-threading control, through the real HTTP-layer function:
  // issueAuthorityPresent=true with a null status (a malformed present
  // record) must ALSO collapse to count=0 — the exact new distinction this
  // correction introduces, proven end-to-end, not just at the
  // classifyEvidenceRow unit level above.
  globalThis.fetch = makeMockFetchC4(GENUINE_ROWS_C4);
  const resultPresentStatusless = await fetchComps({ ...baseParamsC4, issueAuthorityPresent: true, issueAuthorityStatus: null });
  assertEq(resultPresentStatusless.count, 0, 'PRESENT-BUT-STATUSLESS: issueAuthorityPresent=true with a null status also collapses to count=0 through the real fetchComps — presence alone, not status, drives the gate');
  // Item 1 (evidence-only completion pass) — essential empty-pricing
  // assertions repeated for this case too, not just count/length.
  assertEq(resultPresentStatusless.prices, [], 'PRESENT-BUT-STATUSLESS: resultPresentStatusless.prices is exactly []');
  assertEq(resultPresentStatusless.recentSales, [], 'PRESENT-BUT-STATUSLESS: resultPresentStatusless.recentSales is exactly []');
  assertEq(resultPresentStatusless.evidence.provisionalAuthorityReferences.length, 3, 'PRESENT-BUT-STATUSLESS: all 3 rows preserved as reference-only, same as the provisional/conflicted cases');
  assertEq(
    sortedTitlePrice(resultPresentStatusless.evidence.provisionalAuthorityReferences),
    sortedTitlePrice(GENUINE_ROWS_C4),
    'PRESENT-BUT-STATUSLESS: provisionalAuthorityReferences carries the exact input titles AND exact numeric prices (sorted structured comparison)'
  );
  assertTrue(
    resultPresentStatusless.evidence.provisionalAuthorityReferences.every((r) => r.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY') && r.comparabilityStatus === 'PROVISIONAL_ISSUE_REFERENCE'),
    'PRESENT-BUT-STATUSLESS: every preserved row carries both TARGET_ISSUE_PROVISIONAL_AUTHORITY and PROVISIONAL_ISSUE_REFERENCE'
  );

  globalThis.fetch = originalFetchC4;
};

await runFetchCompsIntegration();

// ══════════════════════════════════════════════════════════════════════════════
// ITEM 3 (evidence-only completion pass) — EXECUTE THE SOLD PRODUCTION PATH.
// The real exported verifySoldComps (src/lib/soldVerification.js), called
// directly with an otherwise-valid sold-row fixture — no mock, no mirror.
// Cases A (issueAuthorityPresent:true, status:'provisional') and B
// (issueAuthorityPresent:true, status:null) each assert: no row enters the
// verified/pricing output, every input row survives in
// evidence.provisionalAuthorityReferences, and rejection code +
// comparability status are preserved. Plus a legacy absent-authority
// control confirming the SAME fixture remains eligible under the existing
// sold rules untouched by this commit.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nItem 3: execute the real verifySoldComps production path\n');
{
  const SOLD_ROWS = [
    { title: 'Test Family Comics #12 (2001) Test Publisher', price: 40, endTime: '2026-06-01' },
    { title: 'Test Family Comics #12 2001 raw copy', price: 45, endTime: '2026-06-05' },
    { title: 'Test Family Comics #12 near mint 2001', price: 50, endTime: '2026-06-10' },
  ];
  const baseCtx = {
    title: 'Test Family Comics', issue: '12', variant: null, publisher: 'Test Publisher',
    bookYear: '2001', userGradeKey: 'raw', assessedGrade: 'NM 9.4',
  };

  // Legacy control — absent authority (no issueAuthorityPresent/Status at
  // all), the SAME fixture, remains eligible under the pre-existing sold
  // rules this commit does not touch.
  const resultLegacy = verifySoldComps(SOLD_ROWS, baseCtx);
  assertEq(resultLegacy.diagnostics.verifiedCount, 3, 'LEGACY CONTROL: absent authority — all 3 rows verified/eligible under the existing sold rules, unaffected by this commit');
  assertEq(resultLegacy.evidence.provisionalAuthorityReferences.length, 0, 'LEGACY CONTROL: evidence.provisionalAuthorityReferences is empty — the gate never fires without a present, non-confirmed authority');

  // Case A — issueAuthorityPresent:true, issueAuthorityStatus:'provisional'.
  const resultA = verifySoldComps(SOLD_ROWS, { ...baseCtx, issueAuthorityPresent: true, issueAuthorityStatus: 'provisional' });
  assertEq(resultA.diagnostics.verifiedCount, 0, 'CASE A (provisional): no row enters the verified/pricing output');
  assertEq(resultA.verified.length, 0, 'CASE A (provisional): verified array is exactly empty');
  assertEq(resultA.evidence.provisionalAuthorityReferences.length, 3, 'CASE A (provisional): every input row survives in evidence.provisionalAuthorityReferences');
  assertEq(
    sortedTitlePrice(resultA.evidence.provisionalAuthorityReferences),
    sortedTitlePrice(SOLD_ROWS),
    'CASE A (provisional): provisionalAuthorityReferences carries the exact input titles AND exact numeric prices (sorted structured comparison)'
  );
  assertTrue(
    resultA.evidence.provisionalAuthorityReferences.every((r) => r.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY') && r.comparabilityStatus === 'PROVISIONAL_ISSUE_REFERENCE'),
    'CASE A (provisional): rejection code (TARGET_ISSUE_PROVISIONAL_AUTHORITY) and comparability status (PROVISIONAL_ISSUE_REFERENCE) preserved on every row'
  );

  // Case B — issueAuthorityPresent:true, issueAuthorityStatus:null (present
  // but malformed/statusless).
  const resultB = verifySoldComps(SOLD_ROWS, { ...baseCtx, issueAuthorityPresent: true, issueAuthorityStatus: null });
  assertEq(resultB.diagnostics.verifiedCount, 0, 'CASE B (present-but-statusless): no row enters the verified/pricing output');
  assertEq(resultB.verified.length, 0, 'CASE B (present-but-statusless): verified array is exactly empty');
  assertEq(resultB.evidence.provisionalAuthorityReferences.length, 3, 'CASE B (present-but-statusless): every input row survives in evidence.provisionalAuthorityReferences');
  assertEq(
    sortedTitlePrice(resultB.evidence.provisionalAuthorityReferences),
    sortedTitlePrice(SOLD_ROWS),
    'CASE B (present-but-statusless): provisionalAuthorityReferences carries the exact input titles AND exact numeric prices (sorted structured comparison)'
  );
  assertTrue(
    resultB.evidence.provisionalAuthorityReferences.every((r) => r.rejectionCodes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY') && r.comparabilityStatus === 'PROVISIONAL_ISSUE_REFERENCE'),
    'CASE B (present-but-statusless): rejection code and comparability status preserved on every row'
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
}
globalThis.fetch = originalFetchC4;
// fetchComps' kv-cache layer initializes an Upstash Redis client with a
// keep-alive HTTP agent even when unconfigured (fails closed per-call, but
// the client object itself lingers) — explicit exit so this script
// terminates instead of hanging on a dangling handle (same established
// pattern as q141-v0i-slab-exclusion.test.js / q-trackB-commit2-era-classification.test.js).
process.exit(failed > 0 ? 1 : 0);
