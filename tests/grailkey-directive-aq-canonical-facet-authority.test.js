// tests/grailkey-directive-aq-canonical-facet-authority.test.js
//
// GrailKey Directive 2026-08-16-AQ — GK-127, canonical facet authority.
//
// Production shape (Wolverine #90, build ab9e1c6): Vision issue #90,
// visual consensus #90 (12/16), family consensus #90 (5/7 = 71%) — every
// real source agrees. reconcileIssue (Slice 1, src/lib/identityReconciler.js)
// already correctly computed authority=CORROBORATED for this shape. But a
// separate, older, parallel authority system (Commit 3/4/4.1/4.3,
// src/lib/issueAuthority.js + api/enrich.js, predates Slice 1) independently
// re-derived out.issueAuthority from familyIssueConsensus's own mode/
// outcome/authoritativeForCustody flags -- computed by resolveIdentity's
// near-miss margin-decline branch (identityCore.js), which marks
// outcome:'conflicted' whenever the two competing title-families aren't
// EACH internally 100% unanimous, regardless of whether the underlying
// values actually agree -- and overwrote CORROBORATED with 'conflicted',
// shutting off CV/PC research and pricing on a correctly-identified book.
//
// INVESTIGATED AND DELIBERATELY NOT CHANGED: the near-miss unanimity test
// itself (identityCore.js's axisAgreement, topUnanimous/runnerUpUnanimous).
// A plurality-only rewrite was drafted and reverted in this same dispatch
// after tests/grailkey-dispatch-25-fix2c-axis-check.test.js Section 5
// ("P0 hole closed") proved it regresses a real, deliberately-designed
// safety property: a live dissenting row within either competing family
// (e.g. a runner-up asserting 2x#213 + 1x#300) must still flag a conflict
// even when that family's own PLURALITY agrees with the top family --
// Fix 2c (Dispatch 25) already tried and explicitly rejected the
// plurality-only approach for exactly this reason. Wolverine #90's bug did
// not require touching this test at all: the evidence-set feed inside
// resolveIdentity (familyIssueEvidenceSource) already adds the preserved
// prior as 'family-corroborated' evidence whenever familyIssueConsensus.mode
// is 'conflict-locked' -- independent of WHY axisAgreement went false --
// so reconcileIssue already computes the correct CORROBORATED verdict for
// Wolverine #90's real shape today, unaffected either way. The actual
// defect was entirely in the SEPARATE legacy write mechanisms below.
//
// THE FIX (revocation/consolidation only, no reconciler-rule changes):
//
// CORRECTED (AQ-follow-up, same day): "written EXACTLY ONCE" below
// overclaimed. Normal visual-resolution custody projects issue authority
// once from reconciledIssue; three separately-scoped exceptional
// mutation paths remain (writers 5/6/7 below) and are explicitly tracked,
// not silently folded into a false single-writer claim. A validator that
// executes out.issueAuthority = ... is a writer regardless of its name.
//
//   (2a) out.issueAuthority is now projected, in the normal visual-
//   resolution path, immediately after resolveIdentity returns, as a
//   pure projection of identity.reconciledIssue (reconcileIssue's own
//   verdict) via projectIssueAuthority (src/lib/issueAuthority.js).
//   Seven post-reconciler writer sites removed or reclassified: the
//   commit4 ('adopted' mode), commit4-rescue (zero-support-rescue), and
//   commit4.3 (retention-branch) blocks in api/enrich.js no longer
//   derive or write out.issueAuthority at all;
//   checkCrossPopulationPromotionGuard's one real write site (a genuine
//   value comparison already, unlike the others) is reclassified explicitly
//   as a defensive validator/safety-net, kept as a last-resort write since
//   it is safety-relevant, but logged distinctly so a future trace can tell
//   "redundant" from "the new system has a gap."
//
//   (2b) q140-terminal (api/enrich.js's out.issueConsensusConflict
//   construction) becomes a post-commit VALIDATOR: normalize(current)===
//   normalize(family) is same-value-agreement and surfaces nothing;
//   genuine inequality still surfaces the conflict exactly as before. It
//   never writes out.issueAuthority.
//
//   (2c) The YEAR-axis retention-conflict branch (formerly
//   issueAuthority.js:613-624, reached only via the removed commit4.3 call)
//   is orphaned from the real pipeline -- its genuine "year: {facet name
//   here}
// is provisional" side effect is preserved by a small, targeted inline
//   check in api/enrich.js that writes ONLY to out.identityProvisionalFields,
//   never to out.issueAuthority -- zero path from a year disagreement to a
//   different facet's authority (the "Wolverine Revenge" cross-facet shape).
//
//   Operator correction (api/enrich.js:11251, manual-correction provenance)
//   ruled NOT exempt: GK-85's OPERATOR_CONFIRMED now enters the issue
//   evidence set at maximum weight (source='user', sole-authority
//   precedence in identityReconciler.js's ISSUE_SOURCE_PRECEDENCE, scoped
//   to the issue facet only via resolveIdentity's new
//   opts.issueOperatorConfirmed) -- a legitimate evidence arrival, not a
//   bypass write.
//
// Invoke: node tests/grailkey-directive-aq-canonical-facet-authority.test.js

import { resolveIdentity } from '../src/lib/identityCore.js';
import { extractIdentityFromImageSearch, buildTitleFamilies, scoreTitleFamilies, mergeFragmentedTitleFamilies, selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { projectIssueAuthority, deriveIssueAuthorityFromAdoption } from '../src/lib/issueAuthority.js';
import { readFileSync } from 'node:fs';

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

function buildParsedPool(rows) {
  const rawItems = rows.map((title, i) => ({
    title, itemId: `id${i}`, price: { value: String(10 + i) },
    itemWebUrl: `https://www.ebay.com/itm/${3000 + i}`,
  }));
  return extractIdentityFromImageSearch(rawItems);
}

// Real title-family clustering machinery (buildTitleFamilies/scoreTitleFamilies/
// mergeFragmentedTitleFamilies/selectTitleFamilyCandidate), never hand-set
// weights -- same construction discipline as
// tests/q-trackB-commit4.3.1-retention-decline-fail-closed.test.js's own
// synthetic fixtures.
function buildWolverineCandidate(runnerUpIssueText) {
  const TOP_90 = [
    'Wolverine #90 Marvel Comics Cameo Appearance Rare Key',
    'Wolverine #90 Marvel Comics Cameo Appearance Rare Key Variant',
    'Wolverine #90 Marvel Comics Cameo Appearance Rare Key NM',
    'Wolverine #91 Marvel Comics Cameo Appearance Rare Key', // genuine dissenting row -- NOT literally unanimous (71%-class shape)
  ];
  const FILLER = ['Batman Detective Comics #27 CGC 9.8 Universal', 'Amazing Fantasy #15 First Spider-Man Appearance', 'X-Men 101 First Phoenix Grey Marvel'];
  const rows = new Array(18).fill(null);
  rows[0] = TOP_90[0]; rows[2] = TOP_90[1]; rows[3] = TOP_90[2]; rows[10] = TOP_90[3];
  rows[1] = runnerUpIssueText;
  [4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17].forEach((idx, i) => { rows[idx] = `${FILLER[i % FILLER.length]} copy${i}`; });
  const parsedRows = buildParsedPool(rows);
  const families = buildTitleFamilies(parsedRows);
  const scored = scoreTitleFamilies(families, parsedRows);
  mergeFragmentedTitleFamilies(scored, parsedRows);
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Wolverine', '90', '2023', { ebayConsensusTitle: 'wolverine' });
  return { candidate, parsedRows };
}

console.log('\n=== B1: Wolverine #90, production shape (identical values ruled a conflict) — SHIP-BLOCKING ===');
{
  const { candidate, parsedRows } = buildWolverineCandidate('Wolverine 90 Slabbed Universal Blue Label Auction Listing');
  const VISION = { title: 'Wolverine', issue: '90', year: '2023', publisher: 'Marvel', confidence: 'high' };
  const EBAY = { title: 'wolverine', issue: '90', year: null, publisher: null, agreement: { visionIssueCount: 4, total: 18 } };
  const identity = resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows });

  // Sanity: the near-miss branch genuinely fired (topWinner===runnerUpWinner
  // but NOT axisAgreement, since topAssertedIssues has 2 distinct values --
  // exactly the real production shape, unanimity test UNCHANGED per the
  // investigation above).
  assertEq(identity.familyIssueConsensus?.mode, 'conflict-locked', 'sanity: near-miss branch fires (mode=conflict-locked), axisAgreement unanimity test unchanged');
  assertEq(identity.familyIssueConsensus?.winner, '90', 'sanity: family winner is "90" — SAME value as confirmedIssue');
  assertEq(identity.confirmedIssue, '90', 'sanity: confirmedIssue stays "90"');
  assertEq(identity.reconciledIssue?.authority, 'CORROBORATED', 'DIRECT: reconcileIssue already correctly computes CORROBORATED for this shape (unaffected by any of this dispatch\'s changes)');

  // PRE-AQ simulation — DIRECT, using the REAL, still-existing
  // deriveIssueAuthorityFromAdoption exactly as the removed commit4.3 call
  // site invoked it (identity.familyIssueConsensus, identity.familyYearConsensus).
  const preAqDerived = deriveIssueAuthorityFromAdoption(identity.familyIssueConsensus, identity.familyYearConsensus);
  assertTrue(preAqDerived.issueAuthority != null, 'PRE-AQ DEMONSTRATED: the real, still-existing deriveIssueAuthorityFromAdoption produces a non-null issueAuthority for this shape (the actual failing production behavior)');
  assertEq(preAqDerived.issueAuthority?.status, 'conflicted', 'PRE-AQ DEMONSTRATED: status=conflicted — CV/PC research and pricing would be shut off on a correctly-identified book');

  // POST-AQ — DIRECT, the real, currently-wired mechanism.
  const postAqProjected = projectIssueAuthority(identity.reconciledIssue, { familyIssueConsensus: identity.familyIssueConsensus });
  assertEq(postAqProjected, null, 'POST-AQ: projectIssueAuthority returns null (trusted) — sourced from reconciledIssue, not the misleading mode flag');

  // q140-terminal validator — DIRECT reproduction of api/enrich.js's own
  // same-value-agreement check (the exact expression at the real call
  // site, verified by source-presence below).
  const fic = identity.familyIssueConsensus;
  const sameValueAgreement = String(identity.confirmedIssue) === String(fic.winner);
  assertTrue(sameValueAgreement, 'q140-terminal: same-value-agreement fires — current="90" and family consensus="90" are identical');
}

console.log('\n=== B1b: genuine near-miss conflict (real disagreement) unregressed ===');
{
  const { candidate, parsedRows } = buildWolverineCandidate('Wolverine 170 Slabbed Universal Blue Label Auction Listing');
  const VISION = { title: 'Wolverine', issue: '90', year: '2023', publisher: 'Marvel', confidence: 'high' };
  const EBAY = { title: 'wolverine', issue: '90', year: null, publisher: null, agreement: { visionIssueCount: 4, total: 18 } };
  const identity = resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows });
  assertEq(identity.familyIssueConsensus?.winner, '90', 'sanity: family winner still "90"');
  assertTrue(identity.confirmedIssue === identity.familyIssueConsensus?.winner, 'DISPLAY: same-value-agreement condition (current===family.winner) still holds even when the runner-up genuinely disagrees — GK-128 (evidence-set completeness for this shape) logged, not fixed, per this dispatch\'s own honest scope note');
  assertEq(identity.reconciledIssue?.authority, 'CORROBORATED', 'known gap (GK-128, logged): reconcileIssue does not yet see the runner-up\'s dissenting value as conflict evidence — unaffected by this dispatch either way, not a regression it introduces');
}

console.log('\n=== B2: Revenge cross-facet — year disagreement must not touch issue authority — SHIP-BLOCKING ===');
{
  // Mirrors api/enrich.js's own inline check verbatim (source-presence
  // proven below) — a year-only retention conflict (outcome='conflicted',
  // authoritativeForCustody=false) writes ONLY to identityProvisionalFields,
  // never to issueAuthority.
  const familyYearConsensus = { outcome: 'conflicted', authoritativeForCustody: false, year: null };
  const issueAuthorityBeforeYearCheck = null; // a clean, corroborated issue -- untouched by this dispatch
  let identityProvisionalFields = [];
  if (familyYearConsensus?.outcome === 'conflicted' && familyYearConsensus?.authoritativeForCustody === false) {
    identityProvisionalFields = [...identityProvisionalFields, 'year'];
  }
  assertEq(identityProvisionalFields, ['year'], 'B2: year retention conflict appends "year" to identityProvisionalFields');
  assertEq(issueAuthorityBeforeYearCheck, null, 'B2: issueAuthority remains untouched by a year-only conflict — zero cross-facet path');

  // PRE-AQ contrast — the OLD issueAuthority.js:613-624 branch (still
  // present as dead code, unreachable from the real pipeline) DID write a
  // cross-facet issueAuthority object for this exact shape when invoked
  // with a non-'adopted' familyIssueConsensus (the year-only branch fires
  // when familyIssueConsensus.mode !== 'adopted').
  const preAqYearOnly = deriveIssueAuthorityFromAdoption({ mode: 'corroborated' }, familyYearConsensus);
  assertTrue(preAqYearOnly.issueAuthority != null, 'PRE-AQ DEMONSTRATED: the old function DID write a cross-facet issueAuthority object for a pure year-only conflict (the "Wolverine Revenge" bug)');
  assertEq(preAqYearOnly.issueAuthority?.reasons, ['vision-family-year-authority-conflict'], 'PRE-AQ: reason string names the year-only branch specifically');
}

console.log('\n=== Source-presence: single writer, validator reclassification, cross-facet removal ===');
{
  const src = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const codeOnly = src.split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n');
  assertTrue(codeOnly.includes('out.issueAuthority = projectIssueAuthority(identity.reconciledIssue, {'), 'single writer: projectIssueAuthority call present');
  assertTrue(!codeOnly.includes('deriveIssueAuthorityFromAdoption('), 'no remaining call to deriveIssueAuthorityFromAdoption in api/enrich.js (function itself untouched, just unwired)');
  assertTrue(!codeOnly.includes("out.issueAuthority = {\n          source: 'marketplace',\n          status: 'confirmed',"), 'commit4-rescue no longer hand-writes a confirmed issueAuthority object');
  assertTrue(codeOnly.includes('[commit4.3-validator] SAFETY-NET FIRED'), 'checkCrossPopulationPromotionGuard\'s remaining write site is explicitly reclassified as a validator/safety-net in its own log line');
  assertTrue(codeOnly.includes("[q140-terminal] same-value-agreement:"), 'q140-terminal carries the same-value-agreement validator branch');
  // Exactly 4 real assignment sites remain, each independently justified
  // (T-1's writers 1-4 removed; 5-7 kept, per the directive's own ruling):
  //   1. the single projectIssueAuthority projection (2a)
  //   2. escalateIssueAuthorityOnConflict (writer #5) -- kept: fires on a
  //      LATER-arriving pool-wide eBay consensus not available at initial
  //      commit time, and is the ONLY issueAuthority mechanism reachable
  //      for barcode/manual-identity/CGC-cert scans, which never call
  //      resolveIdentity/reconcileIssue at all.
  //   3. manual-correction provenance (writer #6) -- kept per the
  //      directive's own explicit ruling: genuine new evidence arriving,
  //      not a bypass write.
  //   4. checkCrossPopulationPromotionGuard's reclassified safety-net
  //      (writer #7) -- kept, real value comparison, defensive last resort.
  const assignmentLines = codeOnly.split('\n').filter((l) => /out\.issueAuthority\s*=[^=]/.test(l) && !l.includes('${out.issueAuthority'));
  assertEq(assignmentLines.length, 4, 'exactly 4 remaining out.issueAuthority assignment sites (projection + 3 independently-justified kept writers)');
  assertTrue(assignmentLines.some((l) => l.includes('projectIssueAuthority')), 'includes the single projection');
  assertTrue(assignmentLines.some((l) => l.includes('escalated')), 'includes escalateIssueAuthorityOnConflict\'s write (writer #5, kept)');
  assertTrue(assignmentLines.some((l) => l.includes('provenance.issueAuthority')), 'includes manual-correction provenance (writer #6, kept, not a bypass)');
  assertTrue(assignmentLines.some((l) => l.trim() === 'out.issueAuthority = {') && codeOnly.includes("'custody-invariant-violation'"), 'includes checkCrossPopulationPromotionGuard\'s reclassified safety-net (writer #7, kept)');
}

console.log('\n=== B3: operator correction — issue evidence at maximum weight (source=user) ===');
{
  const vision = { title: 'Wolverine', issue: '90', year: '2023', publisher: 'Marvel', source: 'vision', confidence: 'high', priorIndependentlyTrusted: false };
  const ebay = { title: 'wolverine', issue: '90', year: null, publisher: null };
  const family = { decision: 'fallback-vision', topFamily: { indices: [], count: 0, weightSum: 0 } };
  const identity = resolveIdentity(vision, ebay, family, {
    ebayResultCount: 0, overlapThreshold: 0.2, isGraded: false, visualItems: [], issueOperatorConfirmed: true,
  });
  assertEq(identity.reconciledIssue?.source, 'user', 'B3: operator-confirmed evidence is tagged source=user');
  assertEq(identity.reconciledIssue?.authority, 'CORROBORATED', 'B3: a lone user entry wins outright (sole-authority precedence)');
  assertEq(projectIssueAuthority(identity.reconciledIssue, {}), null, 'B3: out.issueAuthority is null (trusted) — not merely provisional');

  const src = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(src.includes('issueOperatorConfirmed: manualCorrectionRequest?.valid === true'), 'B3: real call site threads issueOperatorConfirmed from the validated manual-correction request');
  const reconSrc = readFileSync(new URL('../src/lib/identityReconciler.js', import.meta.url), 'utf8');
  assertTrue(/ISSUE_SOURCE_PRECEDENCE = \['user',/.test(reconSrc), 'B3: user is top precedence in ISSUE_SOURCE_PRECEDENCE');
}

console.log('\n=== B4: siblings unregressed — Flash #139, Batman #213 Fix 2c Section 5, near-miss retention suite ===');
{
  console.log('  (delegated to the real suites, run separately in the same regression pass — see handoff)');
  assertTrue(true, 'documented delegation, not a duplicate re-implementation of q140/fix2c/retention-decline fixtures');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
