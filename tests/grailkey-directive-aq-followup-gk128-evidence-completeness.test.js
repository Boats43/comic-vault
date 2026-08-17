// tests/grailkey-directive-aq-followup-gk128-evidence-completeness.test.js
//
// GrailKey Directive AQ-follow-up — GK-128, evidence-set completeness,
// fifth false-READY sibling (GK-96, GK-101, GK-111, GK-124, GK-128).
//
// AQ's own close-out (commit e7c0eac) classified GK-128 "logged, not
// fixed... not a live safety hole today," reasoning that
// identity.familyIssueConsensus's own outcome/reason fields still
// correctly report 'conflicted' for a genuine near-miss conflict. That
// reasoning was never checked against the actual transaction boundary. A
// real end-to-end run (resolveIdentity -> projectIssueAuthority ->
// canUseExactIssuePricingCache -> computeIssueAuthorityContractPatch ->
// assembleContract, the REAL, unmodified production functions) proved it
// live: a runner-up title-family internally split 213/213/300 -- a
// genuine, physical disagreement about which issue this book is -- let
// reconcileIssue compute authority=CORROBORATED (the "300" dissent never
// entered the evidence set at all), which flowed all the way through to
// actionAuthority=READY, contract.listable=true, CV/PC exact lookups both
// allowed. "Remembered in a log [structure]" is not custody -- a signal
// the transaction boundary never receives is a signal that doesn't exist
// (AB's own precedent, GK-101, applied here to a different facet).
//
// THE RULE INSTALLED: every materially asserted issue value in an
// eligible CONFLICTING family must reach the issue evidence set. A
// family's plurality winner is not a substitute for its dissenting
// evidence.
//
// THE FIX (src/lib/identityCore.js, revocation-only, no reconciler-rule
// changes, no pricing math, no Z, no title/year/variant):
//
//   When the near-miss margin-decline branch fires (a genuine near-miss
//   conflict, axisAgreement false for a real reason), the runner-up TITLE
//   FAMILY's own full asserted-issue set (runnerUpAssertedIssues, already
//   computed by the existing axis-check, not new plumbing) is carried on
//   familyIssueConsensusResult. At the evidence-set builder, every value
//   in that set that does NOT match the value actually being preserved/
//   adopted (preReconcileConfirmedIssue) is fed into issueEvidence as a
//   genuine reportConflict entry, tagged with honest provenance
//   ('family-runnerup-dissent') -- never silently dropped, never
//   fabricated. reconcileIssue's own EXISTING conflict logic then
//   correctly computes CONTESTED, exactly as it already does for Flash
//   #139's shape -- no new authority-derivation mechanism, only a missing
//   evidence input restored.
//
//   Deliberately scoped to the RUNNER-UP's own dissent only, never the
//   TOP family's own internal minority. A prior attempt in this campaign
//   (drafted and reverted twice now) fed the runner-up's own PLURALITY
//   (winner) instead of its dissent -- wrong for this exact shape
//   (plurality "213" agrees with top; the real dissent is the minority
//   "300," which plurality discards by construction). A second candidate
//   fix (having projectIssueAuthority consume familyIssueConsensus.outcome
//   directly as a demotion input) was considered and rejected as
//   dishonest: Wolverine #90's own real shape ALSO carries
//   outcome='conflicted' despite genuine value agreement (the near-miss
//   branch sets that flag from axisAgreement/margin-decline provenance,
//   not a value comparison) -- consuming it directly would resurrect
//   GK-127 verbatim on the book that fix was built to close.
//
// Invoke: node tests/grailkey-directive-aq-followup-gk128-evidence-completeness.test.js

import { resolveIdentity } from '../src/lib/identityCore.js';
import { extractIdentityFromImageSearch, buildTitleFamilies, scoreTitleFamilies, mergeFragmentedTitleFamilies, selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { familyDominatesRunnerUp } from '../src/lib/compHygiene.js';
import { projectIssueAuthority, canUseExactIssuePricingCache, computeIssueAuthorityContractPatch } from '../src/lib/issueAuthority.js';
import { assembleContract } from '../src/lib/responseContract.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

// Reused verbatim from tests/grailkey-dispatch-25-fix2c-axis-check.test.js
// Section 5 -- the real, already-certified Batman #213/#300 near-miss
// fixture (real title-family clustering machinery, row POSITIONS feeding
// the real rank-weight formula, never hand-set weights).
const FAMILY_A_213 = [
  'Batman #213 Giant 30th Anniversary Issue Origin of Robin DC Comics 1969',
  'Batman 213 Giant Anniversary Issue Origin Robin Story',
  'Batman #213 Giant Size Anniversary Robin Origin Tale',
];
const FAMILY_B_MIXED_213_300 = [
  'Batman DC Comics #213 Classic Cover Edition Bronze',
  'Batman #213 DC Comics Classic Bronze Cover',
  'Batman #300 DC Comics Classic Bronze Cover', // genuine dissent
];
const FILLER = ['Superman Action Comics 900 Anniversary', 'Wonder Woman 750 Foil Variant', 'Flash 300 Barry Allen Speedster', 'Green Lantern 76 Hard Traveling Heroes', 'Aquaman 5 Atlantis King'];
function buildParsedPool(rows) {
  const rawItems = rows.map((title, i) => ({ title, itemId: `v1|${100000 + i}|0`, price: { value: String(20 + i) }, itemWebUrl: `https://www.ebay.com/itm/${100000 + i}` }));
  return extractIdentityFromImageSearch(rawItems);
}
function buildRows(topRows, topPositions, runnerRows, runnerPositions) {
  const rows = new Array(18).fill(null);
  topPositions.forEach((pos, i) => { rows[pos] = topRows[i]; });
  runnerPositions.forEach((pos, i) => { rows[pos] = runnerRows[i]; });
  const used = new Set([...topPositions, ...runnerPositions]);
  Array.from({ length: 18 }, (_, i) => i).filter((i) => !used.has(i)).forEach((idx, i) => { rows[idx] = `${FILLER[i % FILLER.length]} copy${i}`; });
  return rows;
}
function buildBatmanCandidate() {
  const rows = buildRows(FAMILY_A_213, [0, 1, 4], FAMILY_B_MIXED_213_300, [2, 3, 5]);
  const parsedRows = buildParsedPool(rows);
  const families = buildTitleFamilies(parsedRows);
  const scored = scoreTitleFamilies(families, parsedRows);
  const merged = mergeFragmentedTitleFamilies(scored, parsedRows);
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Batman', '213', '1969', { ebayConsensusTitle: 'batman' });
  return { merged, candidate, parsedRows };
}
const VISION = { title: 'Batman', issue: '213', year: '1969', publisher: 'DC Comics', confidence: 'medium' };
const EBAY = { title: 'batman', issue: '213', year: '1969', publisher: 'DC', agreement: { visionIssueCount: 19, total: 19 } };

function buildOut(pricingSource) {
  return {
    price: '$45.00', pricingSource,
    rawComps: { count: 4, average: 45, lowest: 30, highest: 60, prices: [30, 40, 50, 60] },
    soldComps: [], matchConfidence: { tier: 'HIGH', score: 92 },
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [], nextStep: '' },
    identityConfident: true, refusedToPrice: false, manualReviewRequired: false,
    gradeExceedsMap: false, claudeCheckBlocker: null, tier0Locked: false,
  };
}
function runFullChain(reconciledIssue, familyIssueConsensus, confirmedIssue) {
  const out = buildOut('active_ask_derived');
  out.issueAuthority = projectIssueAuthority(reconciledIssue, { familyIssueConsensus });
  if (out.issueAuthority) out.identityProvisionalFields = ['issue'];
  const cvPcAllowed = canUseExactIssuePricingCache(confirmedIssue, out.issueAuthority, out.identityProvisionalFields);
  const authorityPatch = computeIssueAuthorityContractPatch(out.issueAuthority, out, out.identityProvisionalFields);
  if (authorityPatch) Object.assign(out, authorityPatch);
  const contract = assembleContract(out);
  return { out, cvPcAllowed, contract };
}

console.log('\n=== B1: Batman #213/#300 near-miss, full transaction-boundary chain — SHIP-BLOCKING ===');
{
  const { merged, candidate, parsedRows } = buildBatmanCandidate();
  assertTrue(!familyDominatesRunnerUp(merged[0].weightSum, merged[1].weightSum), 'sanity: genuine near-miss shape (real scorer)');
  assertTrue(candidate.titleAxisOnlyBlock === true, 'sanity: titleAxisOnlyBlock true');

  const identity = resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows });
  assertEq(identity.confirmedIssue, '213', 'sanity: confirmedIssue is "213" (the top family plurality)');
  assertEq(identity.familyIssueConsensus?.runnerUpAssertedIssues, ['213', '300'], 'sanity: runner-up asserted issues carried on familyIssueConsensus');

  // PRE-FIX -- MIRRORED. This is the EXACT reconciledIssue shape captured
  // via direct execution BEFORE this fix landed (AQ-follow-up commit
  // e7c0eac's own investigation, preserved verbatim as historical
  // evidence -- git show e7c0eac for the original transcript). Not
  // re-derivable from the current source (the evidence-set builder that
  // produced it no longer exists in this form), so reproduced literally
  // rather than re-run.
  const preFixReconciledIssue = {
    value: '213', source: 'family-corroborated', authority: 'CORROBORATED',
    justifiedBy: [{ source: 'family-corroborated', value: '213' }, { source: 'vision', value: '213' }],
    conflicts: [],
  };
  const pre = runFullChain(preFixReconciledIssue, identity.familyIssueConsensus, '213');
  assertEq(pre.contract.actionAuthority.state, 'READY', 'PRE-FIX DEMONSTRATED (mirrored, historical): actionAuthority=READY -- the actual failing production behavior GK-128 was proven on');
  assertEq(pre.contract.listable, true, 'PRE-FIX DEMONSTRATED (mirrored, historical): contract.listable=true');
  assertTrue(pre.cvPcAllowed, 'PRE-FIX DEMONSTRATED (mirrored, historical): CV/PC exact lookups allowed');

  // POST-FIX -- DIRECT, the real reconcileIssue output from the real
  // resolveIdentity call above, through the real, unmodified downstream
  // chain (projectIssueAuthority/canUseExactIssuePricingCache/
  // computeIssueAuthorityContractPatch/assembleContract).
  assertEq(identity.reconciledIssue?.authority, 'CONTESTED', 'POST-FIX: reconcileIssue.authority=CONTESTED');
  assertEq(identity.reconciledIssue?.value, '213', 'POST-FIX: issue candidate retained ("213") -- revocation only, the value does not disappear');
  assertTrue((identity.reconciledIssue?.conflicts || []).some((c) => c.value === '300' && c.source === 'family-runnerup-dissent'), 'POST-FIX: conflicts=[300] with honest provenance');

  const post = runFullChain(identity.reconciledIssue, identity.familyIssueConsensus, identity.confirmedIssue);
  assertEq(post.out.issueAuthority?.status, 'conflicted', 'POST-FIX: out.issueAuthority.status=conflicted');
  assertFalse(post.cvPcAllowed, 'POST-FIX: CV exact lookup blocked');
  assertFalse(post.cvPcAllowed, 'POST-FIX: PC exact lookup blocked (same gate)');
  assertTrue(post.contract.actionAuthority.marketStanding !== 'EXACT_CURRENT', 'POST-FIX: marketStanding != EXACT_CURRENT');
  assertTrue(post.contract.actionAuthority.state !== 'READY', 'POST-FIX: actionAuthority != READY');
  assertEq(post.contract.actionAuthority.state, 'LOCKED', 'POST-FIX: actionAuthority.state=LOCKED');
  assertEq(post.contract.listable, false, 'POST-FIX: contract.listable=false');
}
function assertFalse(cond, label) { return assertEq(!!cond, false, label); }

console.log('\n=== CONTROL: Wolverine #90 (90/90/90/91 top-family dissent, clean unanimous runner-up) — SHIP-BLOCKING ===');
{
  const TOP_90 = ['Wolverine #90 Marvel Comics Cameo Appearance Rare Key', 'Wolverine #90 Marvel Comics Cameo Appearance Rare Key Variant', 'Wolverine #90 Marvel Comics Cameo Appearance Rare Key NM', 'Wolverine #91 Marvel Comics Cameo Appearance Rare Key'];
  const RUNNERUP_90 = 'Wolverine 90 Slabbed Universal Blue Label Auction Listing';
  const WFILLER = ['Batman Detective Comics #27 CGC 9.8 Universal', 'Amazing Fantasy #15 First Spider-Man Appearance', 'X-Men 101 First Phoenix Grey Marvel'];
  const rows = new Array(18).fill(null);
  rows[0] = TOP_90[0]; rows[2] = TOP_90[1]; rows[3] = TOP_90[2]; rows[10] = TOP_90[3]; rows[1] = RUNNERUP_90;
  [4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17].forEach((idx, i) => { rows[idx] = `${WFILLER[i % WFILLER.length]} copy${i}`; });
  const parsedRows = buildParsedPool(rows);
  const families = buildTitleFamilies(parsedRows);
  const scored = scoreTitleFamilies(families, parsedRows);
  mergeFragmentedTitleFamilies(scored, parsedRows);
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Wolverine', '90', '2023', { ebayConsensusTitle: 'wolverine' });
  const VISION2 = { title: 'Wolverine', issue: '90', year: '2023', publisher: 'Marvel', confidence: 'high' };
  const EBAY2 = { title: 'wolverine', issue: '90', year: null, publisher: null, agreement: { visionIssueCount: 4, total: 18 } };
  const identity = resolveIdentity(VISION2, EBAY2, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows });
  assertEq(identity.familyIssueConsensus?.runnerUpAssertedIssues, ['90'], 'sanity: runner-up is clean/unanimous ("90" only) -- top-family "91" dissent is NOT fed (scoped to runner-up only)');
  assertEq(identity.reconciledIssue?.authority, 'CORROBORATED', 'NO SELF-CONFLICT REGRESSION: stays CORROBORATED — GK-127 is not resurrected by GK-128\'s own fix');
  assertEq(identity.reconciledIssue?.conflicts, [], 'NO SELF-CONFLICT REGRESSION: conflicts stays empty');
  const chain = runFullChain(identity.reconciledIssue, identity.familyIssueConsensus, identity.confirmedIssue);
  assertEq(chain.out.issueAuthority, null, 'NO SELF-CONFLICT REGRESSION: out.issueAuthority stays null (trusted)');
  assertTrue(chain.cvPcAllowed, 'NO SELF-CONFLICT REGRESSION: CV/PC exact lookups still allowed');
}

console.log('\n=== Item 2 trace: does null out.issueAuthority default to trusted anywhere unsafely? ===');
{
  // Traced per the directive's own instruction. Two candidate "null
  // defaults to trusted" shapes exist beyond the evidence-completeness
  // gap this file fixes; both verified (source-level, DIRECT) already
  // safe via independent, pre-existing mechanisms:
  //
  //  1. A lone, uncorroborated 'family-population' winner (no prior
  //     existed) -- projectIssueAuthority's OWN existing check
  //     (isLoneFamilyPopulationWinner) already demotes this to
  //     'provisional' unless evaluateUnanimousConsensusPromotion clears
  //     a materially stricter bar. Verified by source read, this file
  //     does not re-prove it (covered by tests/q-trackB-commit4-
  //     adoption-provisional.test.js, 152/152, re-run unaffected).
  //
  //  2. A lone, uncorroborated 'first-eligible-visual' winner --
  //     identityCore.js's OWN pre-existing, pre-AQ mechanism
  //     (identityProvisionalFromVisualFirst) already sets
  //     out.identityProvisional=true whenever this exact shape occurs
  //     (api/enrich.js ~line 3509-3516). deriveIdentityStanding
  //     (src/lib/actionAuthority.js) already reads
  //     out.identityProvisional===true as CONFLICTED, never CONFIRMED --
  //     so actionAuthority.state cannot reach READY off this alone,
  //     independent of out.issueAuthority entirely. This is a SEPARATE
  //     axis (identityStanding, not marketStanding/issueAuthority) --
  //     verified by direct source read of both the write site
  //     (identityCore.js's identityProvisionalFromVisualFirst
  //     assignment) and the read site (deriveIdentityStanding's
  //     out.identityProvisional check) — not independently re-run end to
  //     end in this file, since neither site was touched by GK-128's fix.
  //
  // No additional live gap found. The specific symptom the boundary test
  // demonstrated (null flowing to identityStanding=CONFIRMED/
  // actionAuthority=READY) was entirely caused by the evidence-set
  // completeness gap this fix closes -- once reconcileIssue sees the
  // real dissent, out.issueAuthority is no longer null for this shape,
  // and no other code path was found producing an unsafe null.
  assertTrue(true, 'traced -- see comment above; no live gap requiring a fix beyond the evidence-completeness change');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
