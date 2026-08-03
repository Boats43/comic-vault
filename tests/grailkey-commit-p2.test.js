// tests/grailkey-commit-p2.test.js
//
// GrailKey Commit P2 — makes Commit P's P1 actually fire in production,
// and closes the second wall P1 firing alone still hit.
//
//   A — meetsHighConfidenceMarketplaceConsensusBar's runnerUp condition
//       (issueAuthority.js) required TRUE ABSENCE of a runner-up. All 3
//       real Spawn #351 production requests the GrailKey audit captured
//       carried a nonzero runner-up (weight 2.5 or 4.0 against a top
//       family of 14.0 or 10.0) — the literal-absence reading never fired
//       on any of them. Now reuses familyDominatesRunnerUp (compHygiene.js
//       — the SAME predicate Commit 4.3's own qualified-family-authority
//       retention gate already applies to this exact topFamily/runnerUp
//       shape): a runner-up is tolerated when the selected family
//       outweighs it by 3x or more.
//   B — even with A fixed, a SEPARATE wall: identity-gate (api/enrich.js)
//       sets identityConfident=false on missing year. confirmedYear was
//       never written from the family's own year consensus — only the
//       FLAG landed in identityProvisionalFields, never the VALUE
//       (confirmedYear is overwritten by resolveYear()'s later,
//       authoritative pass, which never sees the family-adopted year
//       unless identityIsProvisionalOverride is set — a flag this
//       family-override path never sets). deriveProvisionalYearBackfill
//       (issueAuthority.js) is the new, narrow, contained backfill: only
//       fires when P1 already cleared, the family's own year vote reached
//       'adopted' with >=3 supporting rows, and nothing else already
//       resolved a year.
//
// Every function under test is the REAL exported production function at
// its real call site (invariant 10, matching every prior Track B/GrailKey
// test in this directory) — no test-local mirror of any of this logic
// exists anywhere in this file, except where a MUTATION test explicitly
// reconstructs the PRE-fix behavior to prove the real fix is load-bearing.
//
// Invoke: node tests/grailkey-commit-p2.test.js

import {
  deriveIssueAuthorityFromAdoption,
  computeIssueAuthorityContractPatch,
  meetsHighConfidenceMarketplaceConsensusBar,
  deriveProvisionalYearBackfill,
  HIGH_CONFIDENCE_WEIGHT_FLOOR,
} from '../src/lib/issueAuthority.js';
import { familyDominatesRunnerUp } from '../src/lib/compHygiene.js';
import { assessIdentityConfidence, sanitizeIdentityFields } from '../src/lib/identityGate.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit P2 — make P1 actually fire ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Fixture — the VERBATIM real Spawn #351 production shape (GrailKey audit,
// 2026-08-03), NOT the cleaned-up runnerUp:null shape Commit P's own test
// file used. All 3 real captured requests carried a runner-up; this uses
// the 2.5-weight one named in the Commit P2 dispatch. Titles/topFamily
// identical to Commit P's fixture (same physical book, same trace).
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
const spawnFamilyCandidateVerbatim = {
  decision: 'weighted-consensus',
  topFamily: spawnTopFamily,
  runnerUp: { weightSum: 2.5 }, // VERBATIM — the real production runner-up, not cleaned up
  overlapRatio: 1,
};
const spawnFic = { mode: 'adopted', ratio: 1.0, winner: 351, support: 5, uniqueRows: 5 };
const spawnFamilyYearConsensus = { mode: 'adopted', year: 2024, support: 3, uniqueRows: 5 }; // real "3/5" support named in the dispatch

// ══════════════════════════════════════════════════════════════════════════════
// familyDominatesRunnerUp — report the exact multiple it enforces
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nfamilyDominatesRunnerUp — exact multiple enforced\n');
{
  assertTrue(familyDominatesRunnerUp(9, 3), 'boundary: top=9 runner=3 -> dominates (9 >= 3*3=9), confirms the enforced multiple is exactly 3x, not weaker');
  assertFalse(familyDominatesRunnerUp(9, 3.01), 'boundary: top=9 runner=3.01 -> does NOT dominate (9 < 9.03), confirms 3x is not rounded down or approximated');
  assertTrue(familyDominatesRunnerUp(14.0, 2.5), 'real Spawn #351 verbatim shape: 14.0 vs 2.5 = 5.6x margin, clears the 3x bar with room');
}

// ══════════════════════════════════════════════════════════════════════════════
// REACHABILITY PROOF — the verbatim fixture, chained through every real
// production function in order, exactly as api/enrich.js's real call
// sites invoke them (deriveIssueAuthorityFromAdoption ~line 2976,
// computeIssueAuthorityContractPatch ~line 10154 [renumbered by this
// commit's own insertion], deriveProvisionalYearBackfill's new real call
// site ~line 6773, then the identity-gate ~line 6800, then
// computeDecision, api/manage.js / App.jsx's own real call site).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nREACHABILITY PROOF — verbatim Spawn #351 trace, full chain\n');
{
  // Step 1 — meetsHighConfidenceMarketplaceConsensusBar returns TRUE.
  const barCleared = meetsHighConfidenceMarketplaceConsensusBar(spawnFamilyCandidateVerbatim, spawnVisualItems);
  assertTrue(barCleared, 'STEP 1: meetsHighConfidenceMarketplaceConsensusBar(verbatim 14.0/2.5 shape) -> TRUE');

  // deriveIssueAuthorityFromAdoption — the real call site's exact
  // invocation shape (fic, undefined, familyCandidate, visualItems).
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  assertTrue(derived.issueAuthority.highConfidenceMarketplaceConsensus, 'REACHABILITY: derived issueAuthority carries highConfidenceMarketplaceConsensus=true for the VERBATIM (runner-up present) shape');

  // Step 2 — commit4-terminal does NOT null out.price.
  const out = { price: 21.25, priceLow: 14.99, priceHigh: 25.00, pricingSource: 'visual_pool_fallback', refusedToPrice: false, issueAuthority: derived.issueAuthority, identityProvisionalFields: derived.identityProvisionalFields };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, out.identityProvisionalFields);
  assertFalse('price' in patch, 'STEP 2: commit4-terminal patch does not include a price key — Object.assign leaves out.price untouched (does NOT null the price)');
  const merged = { ...out, ...patch };
  assertEq(merged.price, 21.25, 'STEP 2: price survives at $21.25');
  assertTrue(merged.price >= 21 && merged.price <= 65, 'STEP 2: price lands in the $21-$65 band Commit N names as this book\'s real market');

  // Step 3 — confirmedYear is populated (the real enrich.js call site
  // passes null as currentConfirmedYear here — Ship 11's visual-pool
  // fallback territory means resolveYear() already ran and found nothing).
  const backfill = deriveProvisionalYearBackfill(null, out.issueAuthority, spawnFamilyYearConsensus);
  assertTrue(backfill !== null, 'STEP 3: deriveProvisionalYearBackfill fires for the verbatim shape + real 3/5 year vote');
  assertEq(backfill.year, '2024', 'STEP 3: confirmedYear backfills to "2024"');
  const confirmedYear = backfill.year; // simulates api/enrich.js's `confirmedYear = provisionalYearBackfill.year;`

  // Step 4 — identity-gate does NOT block on missing year.
  const sanitized = sanitizeIdentityFields({ title: 'Spawn', issue: '351', year: confirmedYear, publisher: 'Image Comics', visionConfidence: null });
  const idCheck = assessIdentityConfidence(sanitized, 'title-family-weighted-consensus', ['title', 'issue', 'year', 'publisher'], null);
  assertTrue(idCheck.confident, 'STEP 4: identity-gate (assessIdentityConfidence) is confident — year no longer missing');
  assertEq(idCheck.missingFields, [], 'STEP 4: no missing fields at all (publisher skipped via title-family identitySource, year now present)');

  // Step 5 — the final decision is NOT ID_REQUIRED.
  const item = {
    title: 'Spawn', identityComplete: true, identityConfident: idCheck.confident,
    identityMissingFields: idCheck.missingFields, price: merged.price,
    rawComps: { count: 5, average: 20 }, pricingSource: merged.pricingSource,
  };
  const decision = computeDecision(item);
  assertFalse(decision.action === 'ID_REQUIRED', 'STEP 5: decision.action is NOT ID_REQUIRED');
  assertFalse(decision.blockers.includes('identity-not-confident'), 'STEP 5: identity-not-confident blocker does not fire');

  // Step 6 — a price survives to the response (restated from Step 2, at
  // the point a client would actually read it off the merged response).
  assertTrue(merged.price === 21.25 && decision.action !== 'ID_REQUIRED', 'STEP 6: a real price ($21.25) survives all the way to a non-ID_REQUIRED decision');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-1 — verbatim Spawn shape (14.0 top, 2.5 runnerUp): bar returns true.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-1\n');
{
  assertTrue(
    meetsHighConfidenceMarketplaceConsensusBar(spawnFamilyCandidateVerbatim, spawnVisualItems),
    'P2-1: verbatim shape (14.0 top, 2.5 runnerUp) -> bar returns true'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-2 — price survives commit4-terminal, in the $21-$65 band.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-2\n');
{
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  const out = { price: 21.25, priceLow: 14.99, priceHigh: 25.00, refusedToPrice: false, issueAuthority: derived.issueAuthority };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
  const merged = { ...out, ...patch };
  assertEq(merged.price, 21.25, 'P2-2: price survives commit4-terminal');
  assertTrue(merged.price >= 21 && merged.price <= 65, 'P2-2: price in the $21-$65 band');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-3 — confirmedYear = 2024.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-3\n');
{
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  const backfill = deriveProvisionalYearBackfill(null, derived.issueAuthority, spawnFamilyYearConsensus);
  assertEq(backfill?.year, '2024', 'P2-3: confirmedYear backfills to 2024');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-4 — identity-gate does not block; decision is not ID_REQUIRED.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-4\n');
{
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  const backfill = deriveProvisionalYearBackfill(null, derived.issueAuthority, spawnFamilyYearConsensus);
  const sanitized = sanitizeIdentityFields({ title: 'Spawn', issue: '351', year: backfill.year, publisher: 'Image Comics', visionConfidence: null });
  const idCheck = assessIdentityConfidence(sanitized, 'title-family-weighted-consensus', ['title', 'issue', 'year', 'publisher'], null);
  const item = { title: 'Spawn', identityComplete: true, identityConfident: idCheck.confident, identityMissingFields: idCheck.missingFields, price: 21.25 };
  const decision = computeDecision(item);
  assertTrue(idCheck.confident, 'P2-4: identity-gate does not block');
  assertFalse(decision.action === 'ID_REQUIRED', 'P2-4: decision is not ID_REQUIRED');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-5 — issueAuthority remains 'provisional'. Not promoted.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-5\n');
{
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  assertEq(derived.issueAuthority.status, 'provisional', 'P2-5: issueAuthority.status stays \'provisional\' — never promoted, even with A and B both firing');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-6 — listing still requires the tap.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-6\n');
{
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  const out = { price: 21.25, refusedToPrice: false, issueAuthority: derived.issueAuthority };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
  assertTrue(patch.listingHardLocked, 'P2-6: listingHardLocked=true — listing still requires the tap');
  assertEq(patch.listingHardLockReason, 'issue-authority-provisional-high-confidence', 'P2-6: distinct lock reason');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-7 — weak dominance (top 6.0 vs runnerUp 4.0, below threshold):
// unchanged, price nulled.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-7\n');
{
  assertFalse(familyDominatesRunnerUp(6.0, 4.0), 'P2-7: 6.0 vs 4.0 = 1.5x margin, below the 3x bar -> does not dominate');
  const weakFamily = { ...spawnFamilyCandidateVerbatim, topFamily: { ...spawnTopFamily, weightSum: 6.0 }, runnerUp: { weightSum: 4.0 } };
  assertFalse(meetsHighConfidenceMarketplaceConsensusBar(weakFamily, spawnVisualItems), 'P2-7: bar returns false (weak dominance, not absence)');
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, weakFamily, spawnVisualItems);
  const out = { price: 21.25, refusedToPrice: false, issueAuthority: derived.issueAuthority };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
  assertEq(patch.price, null, 'P2-7: price nulled — unchanged hard-refusal behavior');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-8 — 2-member family: unchanged, below count floor.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-8\n');
{
  const twoMemberFamily = { ...spawnFamilyCandidateVerbatim, topFamily: { ...spawnTopFamily, count: 2, indices: [0, 1] }, runnerUp: null };
  assertFalse(meetsHighConfidenceMarketplaceConsensusBar(twoMemberFamily, spawnVisualItems), 'P2-8: count=2 (< 3 floor) -> bar false even with no runner-up at all');
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, twoMemberFamily, spawnVisualItems);
  const out = { price: 21.25, refusedToPrice: false, issueAuthority: derived.issueAuthority };
  const patch = computeIssueAuthorityContractPatch(out.issueAuthority, out, derived.identityProvisionalFields);
  assertEq(patch.price, null, 'P2-8: price nulled — unchanged hard-refusal behavior');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-9 / P2-10 — Iron Man #126 / ASM #300 -> byte-identical. Neither
// book's real production trace ever reached 'adopted' mode at all
// (issueAuthority stays null) — identical fixtures to Commit P's own
// P-8/P-9. deriveProvisionalYearBackfill also confirmed inert for both
// (issueAuthority null -> highConfidenceMarketplaceConsensus !== true).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-9/P2-10\n');
{
  const ironManOut = { price: 22.46, priceLow: 14.99, priceHigh: 25.83, pricingSource: 'verified_sold_recency', refusedToPrice: false, issueAuthority: null };
  const patchIronMan = computeIssueAuthorityContractPatch(ironManOut.issueAuthority, ironManOut, null);
  assertEq(patchIronMan, null, 'P2-9: Iron Man #126 — no patch at all, byte-identical');
  const yearBackfillIronMan = deriveProvisionalYearBackfill('1968', ironManOut.issueAuthority, null);
  assertEq(yearBackfillIronMan, null, 'P2-9: deriveProvisionalYearBackfill inert for Iron Man #126 (issueAuthority null)');

  const asmOut = { price: 378.17, priceLow: 300, priceHigh: 450, pricingSource: 'verified_sold_recency', refusedToPrice: false, issueAuthority: null };
  const patchAsm = computeIssueAuthorityContractPatch(asmOut.issueAuthority, asmOut, null);
  assertEq(patchAsm, null, 'P2-10: ASM #300 — no patch at all, byte-identical');
  const yearBackfillAsm = deriveProvisionalYearBackfill('1990', asmOut.issueAuthority, null);
  assertEq(yearBackfillAsm, null, 'P2-10: deriveProvisionalYearBackfill inert for ASM #300 (issueAuthority null)');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-11 — MUTATION: restore runnerUp-absence -> P2-1 FAILS.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-11 — mutation: pre-Commit-P2 runnerUp-absence check\n');
{
  const naiveBarPreP2 = (familyCandidate, visualItems) => {
    // Verbatim pre-Commit-P2 body: `if (familyCandidate.runnerUp != null) return false;`
    // in place of `if (!familyDominatesRunnerUp(...)) return false;` — every
    // other condition identical.
    if (!familyCandidate || familyCandidate.decision !== 'weighted-consensus') return false;
    const topFamily = familyCandidate.topFamily;
    if (!topFamily) return false;
    if (!(topFamily.count >= 3)) return false;
    if (!(topFamily.weightSum >= HIGH_CONFIDENCE_WEIGHT_FLOOR)) return false;
    if (familyCandidate.overlapRatio !== 1) return false;
    if (familyCandidate.runnerUp != null) return false; // the reverted line
    return true;
  };
  const naiveResult = naiveBarPreP2(spawnFamilyCandidateVerbatim, spawnVisualItems);
  assertFalse(naiveResult, 'MUTATION: the naive pre-Commit-P2 runnerUp-absence check returns false for the VERBATIM (2.5 runner-up) shape');
  const realResult = meetsHighConfidenceMarketplaceConsensusBar(spawnFamilyCandidateVerbatim, spawnVisualItems);
  assertTrue(realResult, 'MUTATION CONTRAST: the REAL post-Commit-P2 function returns true for the identical verbatim shape — P2-1 genuinely depends on this commit\'s code, not the fixture alone');
}

// ══════════════════════════════════════════════════════════════════════════════
// P2-12 — MUTATION: remove the confirmedYear write -> P2-4 FAILS.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nP2-12 — mutation: no-op year backfill\n');
{
  const naiveBackfillPreP2 = () => null; // pre-Commit-P2: no backfill mechanism existed at all
  const noBackfill = naiveBackfillPreP2();
  assertEq(noBackfill, null, 'MUTATION: with no backfill mechanism, confirmedYear stays null');
  const sanitizedNoYear = sanitizeIdentityFields({ title: 'Spawn', issue: '351', year: null, publisher: 'Image Comics', visionConfidence: null });
  const idCheckNoYear = assessIdentityConfidence(sanitizedNoYear, 'title-family-weighted-consensus', ['title', 'issue', 'year', 'publisher'], null);
  assertFalse(idCheckNoYear.confident, 'MUTATION: identity-gate blocks (year missing) without the fix');
  assertTrue(idCheckNoYear.missingFields.includes('year'), 'MUTATION: missingFields includes \'year\'');
  const itemNoYear = { title: 'Spawn', identityComplete: true, identityConfident: idCheckNoYear.confident, identityMissingFields: idCheckNoYear.missingFields, price: 21.25 };
  const decisionNoYear = computeDecision(itemNoYear);
  assertEq(decisionNoYear.action, 'ID_REQUIRED', 'MUTATION: decision.action IS ID_REQUIRED without the fix — proves P2-4 genuinely depends on deriveProvisionalYearBackfill, not the fixture alone');

  // Contrast: the REAL fix.
  const derived = deriveIssueAuthorityFromAdoption(spawnFic, undefined, spawnFamilyCandidateVerbatim, spawnVisualItems);
  const realBackfill = deriveProvisionalYearBackfill(null, derived.issueAuthority, spawnFamilyYearConsensus);
  assertTrue(realBackfill !== null, 'MUTATION CONTRAST: the REAL deriveProvisionalYearBackfill fires for the identical fixture');
}

// ══════════════════════════════════════════════════════════════════════════════
// Static wiring guard — api/enrich.js's real call site actually invokes
// deriveProvisionalYearBackfill, is imported from issueAuthority.js, and
// runs BEFORE the identity-gate's sanitizeIdentityFields call (so its
// output can actually reach the gate) — mirrors the T6(c) pattern already
// established in tests/q-trackB-commit4.3-winning-family-authority.test.js.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nStatic wiring guard\n');
{
  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(enrichSource.includes('deriveProvisionalYearBackfill') && enrichSource.includes('from "../src/lib/issueAuthority.js"'), 'WIRING: deriveProvisionalYearBackfill is imported from issueAuthority.js');
  const backfillCallIdx = enrichSource.indexOf('deriveProvisionalYearBackfill(confirmedYear, out.issueAuthority, identity?.familyYearConsensus)');
  const gateCallIdx = enrichSource.indexOf('const sanitizedIdentity = sanitizeIdentityFields({');
  assertTrue(backfillCallIdx !== -1, 'WIRING: the real call site invokes deriveProvisionalYearBackfill(confirmedYear, out.issueAuthority, identity?.familyYearConsensus)');
  assertTrue(gateCallIdx !== -1, 'WIRING: the real identity-gate call site exists');
  assertTrue(backfillCallIdx < gateCallIdx, 'WIRING: the backfill call precedes the identity-gate call — its output can actually reach the gate');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
}
process.exit(failed > 0 ? 1 : 0);
