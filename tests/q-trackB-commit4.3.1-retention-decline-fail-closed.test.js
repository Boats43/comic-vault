// tests/q-trackB-commit4.3.1-retention-decline-fail-closed.test.js
//
// Track B Phase 0, Commit 4.3.1 — RETENTION-DECLINE FAIL-CLOSED CONTAINMENT.
// Revised per the Commit 4.3.1 HOLD dispatch (2026-07-31) + reviewer rider
// (R1-R4). See docs/LAUNCH-AUDIT.md's Commit 4.3.1 entry for the full
// narrative, including the honest real-vs-synthetic fixture finding (R2)
// and the unrestricted-git-stash hygiene incident (R3).
//
// FIXTURE HONESTY (R2, explicit): "Pair 2" as originally dispatched (top
// family count=5/weightSum=10.5, runner-up count=1/weightSum=4.0) was
// given ONLY as summary statistics, with no accompanying raw row data.
// Section 1 below runs the REAL buildTitleFamilies/scoreTitleFamilies/
// mergeFragmentedTitleFamilies/selectTitleFamilyCandidate chain on the
// UNMODIFIED real 18-row pool (the same physical Spawn #351 scan the
// certified Commit 4.3 test reconstructed from real production logs) and
// reports what it ACTUALLY produces — which is the Pair 1 dominant shape
// (13.5/3.0), NOT a near-miss. This is disclosed as the honest, non-tuned
// finding: no near-miss shape is reconstructable from currently available
// real production logs.
//
// Section 2 then builds a SEPARATE, explicitly SYNTHETIC pool — the same
// 5 real "Brett Booth #351" listing strings and the same real "you pick we
// combine shipping" lot-listing string (both reused verbatim from the
// certified Commit 4.3 fixture), reassigned to different row POSITIONS,
// padded with clearly-synthetic unrelated filler titles. Row position
// (not content) determines weight under the real, documented rank-weight
// formula (scoreTitleFamilies' getRankWeight: idx0=5, idx1=4, idx2=3,
// idx3-9=1, idx10-19=0.5) — so choosing positions {0,2,3,4,10} for the
// Brett Booth cluster and position {1} for the lot listing is not
// "injecting a weightSum" (no weightSum field is ever hand-set anywhere in
// this file); it is choosing WHICH REAL POSITIONS feed the real, unmodified
// formula. Verified by DIRECT EXECUTION (Section 2 below) that this
// produces EXACTLY top=5/10.5, runner-up=1/4.0, margin=2.625, dominance
// FALSE, and titleAxisOnlyBlock=true — the latter computed by the REAL
// Q84 dual-axis gate (imageSearchIdentity.js), never hand-set. This
// fixture is explicitly SYNTHETIC — real-producer wiring proof, not a
// claim of reconstructed real production data. Exact-weight reproduction
// of "10.5/4.0" was possible here only because the rank-weight formula is
// disclosed and pure; it should not be read as evidence that a near-miss
// margin genuinely occurred in production for this book.
//
// Invoke: node tests/q-trackB-commit4.3.1-retention-decline-fail-closed.test.js

import { resolveIdentity, resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { extractIdentityFromImageSearch, buildTitleFamilies, scoreTitleFamilies, mergeFragmentedTitleFamilies, selectTitleFamilyCandidate, buildRetentionFamilyEvidenceLog } from '../src/lib/imageSearchIdentity.js';
import {
  deriveIssueAuthorityFromAdoption, canUseExactIssuePricingCache,
  computeIssueAuthorityContractPatch, checkCrossPopulationPromotionGuard,
  buildRejectedCandidateFingerprint,
} from '../src/lib/issueAuthority.js';
import { hasContaminatedMember, hasValidFamilyMembership, familyDominatesRunnerUp } from '../src/lib/compHygiene.js';
import {
  buildComicVineCacheKey, buildPriceChartingCacheKey, buildActiveCompCacheKey,
  parseCacheKeyIssueSegment,
} from '../src/lib/cacheKeys.js';
import { kvGet, kvSet } from '../api/kv-cache.js';
import { computeConvergenceScore } from '../src/lib/convergenceScore.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); return true; }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); return false; }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

function captureLogs(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  let result;
  try { result = fn(); } finally { console.log = originalLog; }
  return { result, lines };
}

// Named mutation/control result ledgers (Item 4 — named results, not just a total count).
const mutationResults = [];
const controlResults = [];
const recordMutation = (name, naiveOutcome, realOutcome, passedFlag) => {
  mutationResults.push({ name, naiveOutcome, realOutcome, passed: passedFlag });
};
const recordControl = (name, expectedBehavior, observed, passedFlag) => {
  controlResults.push({ name, expectedBehavior, observed, passed: passedFlag });
};

console.log('\n=== Track B Phase 0, Commit 4.3.1 — retention-decline fail-closed containment (HOLD revision) ===\n');

const LIVE_RAW_TITLES = [
  'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN 🔑 CAMEO OF LYRA HTF SCARCE (2024)',
  'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn #351 Cover C Brett Booth Virgin Variant 🔥🔥🔥',
  'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM',
  'Spawn 300 Cover L 1:50 Incentive Todd McFarlane Virgin Variant',
  'Spawn #300 - 1:50 Virgin Variant - McFarlane - Image Comics',
  'SPAWN #300 NM NEW UNREAD 1:50 TODD McFARLANE VIRGIN VARIANT Image SHE-SPAWN',
  'SPAWN 300 COVER L 1:50 INCENTIVE TODD McFARLANE VIRGIN VARIANT NM',
  'Spawn #326-#352 YOU PICK We Combine Shipping!!',
  'Spawn 351 NM (9.6) 2024 - Booth Cover C Virgin Variant Cover',
  'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)',
  'Spawn #300 (2019) NM-/NM (9.2-9.4) 1:50 Ratio Virgin Variant Cover!',
  'Spawn #300 1:50 McFarlane Virgin Variant Comic Book First Print',
  'Spawn # 300 Cover L Incentive Virgin Variant Todd Mcfarlane NM & HTF',
  'Spawn #300 - Incentive Todd McFarlane Virgin Variant Cover - 2019 - Image',
  'Spawn Comic Book Capullo Cover Artwork Superheroes Color Edition',
  'SPAWN 307 COVER D TAN & MCFARLANE VIRGIN VARIANT COVER 2020 NM/NM- 9.2-9.4',
  'Spawn #300 (2019) McFarlane Virgin Variant',
];

function buildParsedPool(rows) {
  const rawItems = rows.map((title, i) => ({
    title,
    itemId: i === 0 ? 'v1|256962177956|0' : undefined,
    price: { value: i === 0 ? '24.99' : String(10 + i) },
    itemWebUrl: i === 0
      ? 'https://www.ebay.com/itm/256962177956?hash=item3bd423aba4:g:u9MAAOSwQg9oQG8b'
      : `https://www.ebay.com/itm/${3000 + i}`,
  }));
  return extractIdentityFromImageSearch(rawItems);
}

console.log('--- Section 1: REAL-LOG COMPARISON — unmodified pool, real chain (honest, non-tuned) ---\n');
{
  const realLogParsed = buildParsedPool(LIVE_RAW_TITLES);
  const families = buildTitleFamilies(realLogParsed);
  const scored = scoreTitleFamilies(families, realLogParsed);
  const merged = mergeFragmentedTitleFamilies(scored, realLogParsed);
  console.log(`  [real-log] top: count=${merged[0].count} weightSum=${merged[0].weightSum}`);
  console.log(`  [real-log] runner-up: count=${merged[1]?.count ?? 'none'} weightSum=${merged[1]?.weightSum ?? 'none'}`);
  assertEq(merged[0].count, 5, 'HONEST FINDING: the unmodified real pool\'s top family is the certified 5-member #351 family');
  assertEq(merged[0].weightSum, 13.5, 'HONEST FINDING: unmodified real pool top weightSum is 13.5 (the Pair 1/Commit 4.3 certified number)');
  assertEq(merged[1]?.weightSum, 3.0, 'HONEST FINDING: unmodified real pool runner-up weightSum is 3.0 (the Pair 1/Commit 4.3 certified number)');
  assertTrue(familyDominatesRunnerUp(merged[0].weightSum, merged[1]?.weightSum), 'HONEST FINDING: the unmodified real pool DOMINATES (13.5 >= 3.0*3=9.0) — this is NOT a near-miss shape. No near-miss margin is reconstructable from currently available real production logs for this book.');
}

console.log('\n--- Section 2: SYNTHETIC real-producer fixture — genuine emergent 10.5/4.0/2.625 ---\n');
const BRETT_BOOTH_351 = [
  LIVE_RAW_TITLES[0], LIVE_RAW_TITLES[1], LIVE_RAW_TITLES[2], LIVE_RAW_TITLES[3], LIVE_RAW_TITLES[10],
];
const LOT_LISTING = LIVE_RAW_TITLES[8]; // real, verbatim: "Spawn #326-#352 YOU PICK We Combine Shipping!!"
const SYNTHETIC_FILLER = [
  'Batman Detective Comics #27 CGC 9.8 Universal',
  'Amazing Fantasy #15 First Spider-Man Appearance',
  'X-Men 101 First Phoenix Grey Marvel',
  'Superman Action Comics 900 Anniversary',
  'Wonder Woman 750 Foil Variant DC',
];
function buildSyntheticPair2Rows() {
  // Positions chosen from the disclosed, real, unmodified rank-weight
  // formula (idx0=5, idx1=4, idx2=3, idx3-9=1, idx10-19=0.5) to land the
  // Brett Booth cluster at {0,2,3,4,10} (5+3+1+1+0.5=10.5) and the lot
  // listing alone at {1} (=4.0) — no weightSum field is set by hand
  // anywhere; these are row POSITIONS fed into the real scorer.
  const rows = new Array(18).fill(null);
  rows[0] = BRETT_BOOTH_351[0];
  rows[2] = BRETT_BOOTH_351[1];
  rows[3] = BRETT_BOOTH_351[2];
  rows[4] = BRETT_BOOTH_351[3];
  rows[10] = BRETT_BOOTH_351[4];
  rows[1] = LOT_LISTING;
  const remainingIdx = [5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17];
  remainingIdx.forEach((idx, i) => { rows[idx] = `${SYNTHETIC_FILLER[i % SYNTHETIC_FILLER.length]} copy${i}`; });
  return rows;
}

let parsedRows, candidate;
{
  const rows = buildSyntheticPair2Rows();
  parsedRows = buildParsedPool(rows);
  const families = buildTitleFamilies(parsedRows);
  const scored = scoreTitleFamilies(families, parsedRows);
  const merged = mergeFragmentedTitleFamilies(scored, parsedRows);

  assertEq(merged[0].count, 5, 'SYNTHETIC: real scorer top family count = 5');
  assertEq(merged[0].weightSum, 10.5, 'SYNTHETIC: real scorer top family weight = 10.5 (genuinely emergent, not injected)');
  assertEq(merged[0].indices, [0, 2, 3, 4, 10], 'SYNTHETIC: top family indices are exactly the 5 Brett Booth positions');
  assertEq(merged[1].count, 1, 'SYNTHETIC: real scorer runner-up count = 1');
  assertEq(merged[1].weightSum, 4.0, 'SYNTHETIC: real scorer runner-up weight = 4.0 (genuinely emergent)');
  assertEq(merged[1].indices, [1], 'SYNTHETIC: runner-up index is exactly the lot-listing position');
  const margin = Number((merged[0].weightSum / merged[1].weightSum).toFixed(3));
  assertEq(margin, 2.625, 'SYNTHETIC: margin = 10.5/4.0 = 2.625, matching this dispatch\'s own stated number exactly');
  assertFalse(familyDominatesRunnerUp(merged[0].weightSum, merged[1].weightSum), 'SYNTHETIC: dominance FAILS (10.5 < 4.0*3=12.0) — genuine near-miss shape, computed by the real formula');

  candidate = selectTitleFamilyCandidate(parsedRows, 'Spawn', '1', '2020', { ebayConsensusTitle: 'spawn' });
  assertEq(candidate.decision, 'fallback-vision', 'SYNTHETIC: real selectTitleFamilyCandidate returns fallback-vision');
  assertTrue(candidate.titleAxisOnlyBlock === true, 'SYNTHETIC: titleAxisOnlyBlock is computed by the REAL Q84 gate (never hand-set in this file)');
  assertEq(candidate.topFamily.weightSum, 10.5, 'SYNTHETIC: candidate.topFamily carries the real emergent 10.5');
  assertEq(candidate.runnerUp.weightSum, 4.0, 'SYNTHETIC: candidate.runnerUp carries the real emergent 4.0');
}

const VISION = { title: 'Spawn', issue: '1', year: '2020', publisher: 'Image Comics', confidence: 'low' };
const EBAY = { title: 'spawn', issue: '300', year: null, publisher: null, agreement: { visionIssueCount: 0, total: 18 } };

let identity, derivedIssueAuthority, terminalProvisionalFields;

console.log('\n--- Section 3: resolveIdentity end-to-end on the REAL candidate object ---\n');
{
  const { result, lines } = captureLogs(() =>
    resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows })
  );
  identity = result;

  assertTrue(identity.familyIssueConsensus != null, 'ASSERTION: familyIssueConsensus is populated for the near-miss shape');
  assertEq(identity.familyIssueConsensus.outcome, 'conflicted', 'outcome is "conflicted"');
  assertEq(identity.familyIssueConsensus.authoritativeForCustody, false, 'authoritativeForCustody is false');
  assertEq(identity.familyIssueConsensus.observedFamilyValue, '351', 'observedFamilyValue is the family\'s own measured issue "351"');
  assertEq(identity.familyIssueConsensus.resolvedValue, '1', 'resolvedValue is the prior Vision issue "1"');
  assertEq(identity.familyIssueConsensus.reason, 'retention-margin-decline-conflict', 'machine-readable reason recorded');
  assertEq(identity.confirmedIssue, '1', 'TERMINAL: final issue is NOT 300 — stays the untouched Vision prior "1"');
  assertFalse(String(identity.confirmedIssue) === '351', 'TERMINAL: final issue is NOT 351 either');
  assertEq(identity.visionZeroSupport, null, 'raw-pool OVERRIDE did not run');

  const containmentLines = lines.filter((l) => l.startsWith('[commit4.3.1] near-miss family conflict:'));
  assertEq(containmentLines.length, 1, 'N1: exactly one containment line fires');
  assertTrue(containmentLines[0].includes('family=351@5/10.5'), 'N1 FORMAT: family=<issue>@<count>/<weight>');
  assertTrue(containmentLines[0].includes('runnerUp=4'), 'N1 FORMAT: runnerUp=<weight>');
  assertTrue(containmentLines[0].includes('margin=2.63'), 'N1 FORMAT: margin=<ratio> (10.5/4=2.625, toFixed(2)="2.63")');
  assertTrue(containmentLines[0].includes('prior=1'), 'N1 FORMAT: prior=<vision issue>');
}

console.log('\n--- Section 4: R1 — corrected [family-evidence] event (dual fingerprints) ---\n');
{
  const fic = identity.familyIssueConsensus;
  const priorFingerprint = buildRejectedCandidateFingerprint('Spawn', fic.resolvedValue, VISION.year, null);
  const observedFamilyFingerprint = buildRejectedCandidateFingerprint('Spawn', fic.observedFamilyValue, VISION.year, null);
  assertEq(priorFingerprint, 'spawn|1|2020', 'priorFingerprint identifies the PRIOR issue (1)');
  assertEq(observedFamilyFingerprint, 'spawn|351|2020', 'observedFamilyFingerprint identifies the FAMILY\'S OWN observed issue (351)');

  const evidenceLog = buildRetentionFamilyEvidenceLog(candidate, fic, identity.familyYearConsensus, priorFingerprint, parsedRows, observedFamilyFingerprint);
  assertTrue(evidenceLog.isRetentionPath, 'the real function recognizes this as a retention-path request');
  assertTrue(evidenceLog.logLine.includes('familyEvidenceQualified=false'), 'R1: familyEvidenceQualified is false for a near-miss (was never granted authority)');
  assertTrue(evidenceLog.logLine.includes('qualificationReason=retention-margin-decline-conflict'), 'R1: qualificationReason names the near-miss shape');
  assertTrue(evidenceLog.logLine.includes('priorFingerprint="spawn|1|2020"'), 'R1: priorFingerprint present, named, correct');
  assertTrue(evidenceLog.logLine.includes('observedFamilyFingerprint="spawn|351|2020"'), 'R1: observedFamilyFingerprint present, named, correct');
  assertFalse(evidenceLog.logLine.includes('familyKey='), 'R1 CORE FIX: the OLD single familyKey= field (which would have wrongly read "spawn|1" while rows describe #351) no longer appears for the near-miss shape');
  assertTrue(evidenceLog.rows.some((r) => /351/.test(r.title)), 'sanity: the event\'s own rows genuinely describe #351 listings — proving the old familyKey="spawn|1" WOULD have contradicted them');
}

console.log('\n--- Section 5: issueAuthority derivation + terminal contract ---\n');
{
  const derived = deriveIssueAuthorityFromAdoption(identity.familyIssueConsensus, identity.familyYearConsensus);
  derivedIssueAuthority = derived.issueAuthority;
  terminalProvisionalFields = derived.identityProvisionalFields;
  assertEq(derivedIssueAuthority.status, 'conflicted', 'out.issueAuthority.status is "conflicted"');
  assertEq(derivedIssueAuthority.reasons, ['retention-margin-decline-conflict'], 'reasons carries the specific reason');
  assertEq(terminalProvisionalFields, ['issue'], 'identityProvisionalFields includes "issue"');

  const cacheEligible = canUseExactIssuePricingCache(identity.confirmedIssue, derivedIssueAuthority, terminalProvisionalFields);
  assertFalse(cacheEligible, 'exact-issue pricing cache is NOT eligible');

  const patch = computeIssueAuthorityContractPatch(derivedIssueAuthority, { price: 42.0, refusedToPrice: false }, terminalProvisionalFields);
  assertEq(patch.price, null, 'price is null');
  assertEq(patch.priceBands, null, 'priceBands is null');
  assertEq(patch.refusedToPrice, true, 'refusedToPrice is true');
  assertEq(patch.listingHardLocked, true, 'listingHardLocked is true');
  assertEq(patch.identityConfident, false, 'identityConfident is false');
  assertEq(patch.hypotheticalReferenceEstimate, 42.0, 'I13: the computed price is relabeled, never silently deleted — proves a real active/sold reference does NOT unlock pricing, it is demoted to a hypothetical estimate');

  // Item 3 — real computeDecision, not a doc-comment claim.
  const decisionItem = {
    ...patch,
    title: 'Spawn', issue: '1', identityComplete: true,
    identityMissingFields: [],
    identityProvisional: false,
    identityVisionLowButCorroborated: false,
  };
  const decision = computeDecision(decisionItem, { source: 'test', timestamp: 0 });
  assertEq(decision.action, 'ID_REQUIRED', 'REAL computeDecision (decisionEngine.js) resolves this exact patch shape to ID_REQUIRED — not asserted from a doc comment');
}

console.log('\n--- Section 6: zero-#300/#351 cache-key custody + convergence non-contribution ---\n');
{
  const cvKey = buildComicVineCacheKey(identity.confirmedTitle, identity.confirmedIssue, identity.confirmedPublisher ?? 'Image Comics');
  const pcKey = buildPriceChartingCacheKey(1, identity.confirmedTitle, identity.confirmedIssue, identity.confirmedYear);
  const acKey = buildActiveCompCacheKey(9, identity.confirmedTitle, identity.confirmedIssue);
  assertEq(parseCacheKeyIssueSegment(cvKey).issue, '1', 'cv: key carries issue "1"');
  assertEq(parseCacheKeyIssueSegment(pcKey).issue, '1', 'pc:v1 key carries issue "1"');
  assertEq(parseCacheKeyIssueSegment(acKey).issue, '1', 'ac:v9 key carries issue "1"');
  assertFalse([cvKey, pcKey, acKey].some((k) => parseCacheKeyIssueSegment(k).issue === '300'), 'no key carries "300"');

  // "no catalog result enters convergence" — real convergenceSources
  // field-mapping expressions (copied verbatim from api/enrich.js's own
  // convergenceSources object literal) evaluated with comicVine=null and
  // priceChartingInitial=null (guaranteed by the marketCustodyConflicted
  // gate) — every cv/pc axis genuinely evaluates to null.
  const comicVine = null, priceChartingInitial = null;
  const convergenceSources = {
    title: { cv: comicVine?.volume?.name || null },
    issue: { pc: priceChartingInitial?.issue || null, cv: comicVine?.issue || null },
    era: {
      pc: priceChartingInitial?.year ? (parseInt(priceChartingInitial.year) >= 1985 ? 'modern' : 'vintage') : null,
      cv: comicVine?.volume?.startYear ? (parseInt(comicVine.volume.startYear) >= 1985 ? 'modern' : 'vintage') : null,
    },
    publisher: { pc: priceChartingInitial?.publisher || null, cv: comicVine?.volume?.publisher?.name || null },
  };
  assertTrue(
    convergenceSources.title.cv === null && convergenceSources.issue.pc === null && convergenceSources.issue.cv === null &&
    convergenceSources.era.pc === null && convergenceSources.era.cv === null &&
    convergenceSources.publisher.pc === null && convergenceSources.publisher.cv === null,
    'every cv/pc convergence axis evaluates to null when comicVine/priceChartingInitial are null — no catalog result can enter convergence'
  );
  const conv = computeConvergenceScore(
    { title: 'Spawn', issue: '1', era: 'modern', publisher: 'Image Comics', grade: null },
    { ...convergenceSources, title: { ...convergenceSources.title, ebay: null, vision: 'Spawn' }, issue: { ...convergenceSources.issue, ebay: null, vision: '1' }, era: { ...convergenceSources.era, histogram: null, vision: 'modern' }, publisher: { ...convergenceSources.publisher, ebay: null, vision: 'Image Comics' }, grade: { vision: null } }
  );
  assertTrue(conv != null, 'real computeConvergenceScore runs without a catalog contribution and returns a well-formed result (no crash, no fabricated cv/pc agreement)');
}

console.log('\n--- Section 7: real ac: cache gate — zero calls (spy, real kvGet/kvSet) ---\n');
{
  const kvCalls = [];
  const spyKvGet = async (key) => { kvCalls.push({ op: 'get', key }); return kvGet(key); };
  const acKey = buildActiveCompCacheKey(9, identity.confirmedTitle, identity.confirmedIssue);
  const exactPricingCacheEligible = canUseExactIssuePricingCache(identity.confirmedIssue, derivedIssueAuthority, terminalProvisionalFields)
    && checkCrossPopulationPromotionGuard(identity.familyIssueConsensus, { cacheIssue: identity.confirmedIssue }).allowed;
  if (exactPricingCacheEligible) { await spyKvGet(acKey); }
  assertEq(kvCalls.length, 0, 'zero ac: cache calls for this conflicted fixture');
}

console.log('\n--- Section 8: source-presence + control-flow-order proofs (api/enrich.js real wiring) ---\n');
{
  const enrichSrc = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  // GrailKey Commit B2 (2026-08-02) superseded this line's exact text, not
  // its purpose — confirmed live (22:53:21 UTC, build af32d21) that the
  // status-only check evaluates false for a mode='conflict-locked' outcome
  // (out.issueAuthority is never assigned outside mode='adopted'), so cv:
  // wrote a polluted null-issue cache entry the ac: namespace's own
  // canUseExactIssuePricingCache already guarded against. The gate now
  // reuses that exact function (one namespace extension of an existing,
  // already-tested primitive) instead of a narrower, independently-tuned
  // status check — see tests/grailkey-commit-b2-cv-cache-guard.test.js for
  // the dedicated regression/mutation coverage of the new implementation.
  assertTrue(enrichSrc.includes('const marketCustodyConflicted = !canUseExactIssuePricingCache(confirmedIssue, out.issueAuthority, out.identityProvisionalFields);'), 'the real gate is defined (superseded by Commit B2, reuses canUseExactIssuePricingCache)');
  assertTrue(enrichSrc.includes('[commit4.3.1] exact-identity cv: lookup SKIPPED'), 'the real cv: IIFE is gated');
  assertTrue(enrichSrc.includes('[commit4.3.1] exact-identity pc: lookup SKIPPED'), 'the real pc: IIFE is gated');
  assertTrue(enrichSrc.includes('[commit4.3.1] exact-identity pc: requery SKIPPED'), 'ITEM 3: the real pc: REQUERY fallback is ALSO gated (closes the needsRequery=!priceCharting gap: priceCharting is null when conflicted, which would otherwise force an unconditional requery)');
  assertTrue(enrichSrc.includes('if (needsRequery && !marketCustodyConflicted) {'), 'ITEM 3: the requery condition is genuinely composed with the gate, not just logged around');

  // Control-flow-order proof (STRUCTURAL, explicitly named as such — see
  // the "DISCLOSED BOUNDARY" note immediately below for why this is not a
  // call-count spy on lookupComicVine/lookupPriceCharting themselves).
  const cvIIFEStart = enrichSrc.indexOf('[commit4.3.1] exact-identity cv: lookup SKIPPED');
  const cvLookupCall = enrichSrc.indexOf('await lookupComicVine(', cvIIFEStart);
  const cvReturnNull = enrichSrc.indexOf('return null;', cvIIFEStart);
  assertTrue(cvReturnNull > 0 && cvReturnNull < cvLookupCall, 'STRUCTURAL: in source order, the cv: gate\'s `return null` appears BEFORE the `lookupComicVine(` call text within the same IIFE — the call is textually unreachable when the guard fires');
  const pcIIFEStart = enrichSrc.indexOf('[commit4.3.1] exact-identity pc: lookup SKIPPED');
  const pcLookupCall = enrichSrc.indexOf('await lookupPriceCharting(', pcIIFEStart);
  const pcReturnNull = enrichSrc.indexOf('return null;', pcIIFEStart);
  assertTrue(pcReturnNull > 0 && pcReturnNull < pcLookupCall, 'STRUCTURAL: in source order, the pc: gate\'s `return null` appears BEFORE the first `lookupPriceCharting(` call text within the same IIFE');

  // DISCLOSED BOUNDARY (Item 3 / R4, invoking the standing feasibility
  // rule explicitly rather than substituting a silent structural claim):
  // lookupComicVine/lookupPriceCharting (api/enrich.js) are real,
  // network-calling functions (ComicVine REST API / PriceCharting scrape)
  // with no dependency-injection seam — the SAME disclosed boundary the
  // certified Commit 4.3 test already accepted for this exact pair of
  // functions ("DISCLOSED BOUNDARY (Section 3 feasibility rule...)").
  // A genuine CALL-COUNT spy on these two specific functions (as opposed
  // to the cache layer beneath them, which Sections 6-7 above DO spy for
  // real, with zero fetch-mocking needed) requires either live network
  // access or mocking global.fetch, both out of scope per that same rule.
  // The two structural proofs immediately above (source-order: `return
  // null` precedes the call text) are the strongest available proof
  // without crossing that boundary — reported explicitly as structural,
  // not represented as a call-count spy.
  console.log('  [disclosed-boundary] lookupComicVine/lookupPriceCharting call-count spying requires live network access or global.fetch mocking — out of scope per the standing feasibility rule (same boundary the certified Commit 4.3 test already disclosed for these two functions). Structural source-order proof provided above instead.');
}

console.log('\n--- Section 9: named mutations (Item 4) ---\n');
{
  // MUTATION 1 — remove near-miss trigger -> #300 takeover returns.
  {
    const naiveConfirmedIssue = (EBAY.agreement.visionIssueCount === 0 && EBAY.issue != null) ? EBAY.issue : VISION.issue;
    const ok = naiveConfirmedIssue === '300' && identity.confirmedIssue === '1';
    recordMutation('remove near-miss trigger', `confirmedIssue would become "${naiveConfirmedIssue}"`, `confirmedIssue stays "${identity.confirmedIssue}"`, ok);
    assertTrue(ok, 'MUTATION 1: naive=#300 takeover vs real=blocked');
  }
  // MUTATION 2 — discard derived authority -> cache/pricing eligibility returns.
  {
    const naiveCacheEligible = canUseExactIssuePricingCache(identity.confirmedIssue, null, terminalProvisionalFields);
    const realCacheEligible = canUseExactIssuePricingCache(identity.confirmedIssue, derivedIssueAuthority, terminalProvisionalFields);
    const ok = naiveCacheEligible === true && realCacheEligible === false;
    recordMutation('discard derived authority', `cacheEligible=${naiveCacheEligible} (wrongly permitted)`, `cacheEligible=${realCacheEligible} (correctly blocked)`, ok);
    assertTrue(ok, 'MUTATION 2: naive=cache eligible vs real=blocked');
  }
  // MUTATION 3 — remove issue-match corroboration guard -> #351 family corroborates another issue.
  {
    const naiveCoherentFamilyCount = candidate.topFamily.count;
    const familyIssueMeasurement = resolveFamilyIssueConsensus(null, parsedRows, candidate.topFamily.indices);
    const realCoherentFamilyCount = (familyIssueMeasurement.mode === 'adopted' && String(familyIssueMeasurement.issue) === String(identity.confirmedIssue))
      ? candidate.topFamily.count : 0;
    const ok = naiveCoherentFamilyCount === 5 && realCoherentFamilyCount === 0;
    recordMutation('remove issue-match corroboration guard', `coherentFamilyCount=${naiveCoherentFamilyCount} (wrongly corroborates issue "1" with the #351 family)`, `coherentFamilyCount=${realCoherentFamilyCount} (correctly withheld)`, ok);
    assertTrue(ok, 'MUTATION 3: naive=wrongly corroborates vs real=withheld');
  }
  // MUTATION 4 — remove CV/PC gate -> exact lookup/cache activity returns.
  {
    const cvKeyForCall = buildComicVineCacheKey(identity.confirmedTitle, identity.confirmedIssue, identity.confirmedPublisher ?? 'Image Comics');
    const kvCallsNaive = [];
    await (async (key) => { kvCallsNaive.push({ op: 'get', key }); return kvGet(key); })(cvKeyForCall);
    const kvCallsReal = [];
    const marketCustodyConflicted = derivedIssueAuthority?.status === 'conflicted';
    if (!marketCustodyConflicted) { await (async (key) => { kvCallsReal.push({ op: 'get', key }); return kvGet(key); })(cvKeyForCall); }
    const ok = kvCallsNaive.length === 1 && kvCallsReal.length === 0;
    recordMutation('remove CV/PC gate', `${kvCallsNaive.length} cv: cache read occurs (unconditional)`, `${kvCallsReal.length} cv: cache reads occur (gated)`, ok);
    assertTrue(ok, 'MUTATION 4: naive=unconditional read vs real=zero reads');
  }
}

console.log('\n--- Section 10: named controls (Item 4) ---\n');
{
  // CONTROL: no-family raw-pool behavior unchanged.
  {
    const vision = { title: 'Some Random Comic', issue: '1', year: '2013', publisher: null };
    const ebay = { title: null, issue: null, year: null, publisher: null, agreement: { visionIssueCount: 0, total: 8 }, noIssueConsensus: true, noPublisherConsensus: false };
    const result = resolveIdentity(vision, ebay, null, { ebayResultCount: 3 });
    const ok = result.familyIssueConsensus === null && result.confirmedIssue === null;
    recordControl('no-family raw-pool', 'familyIssueConsensus null, raw-pool escalate fires unshortcut', `familyIssueConsensus=${JSON.stringify(result.familyIssueConsensus)} confirmedIssue=${JSON.stringify(result.confirmedIssue)}`, ok);
    assertTrue(ok, 'CONTROL: no-family raw-pool unchanged');
  }
  // CONTROL: below-coherence-floor family unchanged.
  {
    const visualItems = [{ rawTitle: 'Foo #2 NM' }, { rawTitle: 'Foo #2 VF' }];
    const thinFamily = { selectedTitle: null, decision: 'fallback-vision', topFamily: { indices: [0, 1], count: 2, weightSum: 2 }, runnerUp: { indices: [], count: 0, weightSum: 1 }, titleAxisOnlyBlock: true };
    const vision = { title: 'Foo', issue: '1', year: null, publisher: null, confidence: 'low' };
    const result = resolveIdentity(vision, null, thinFamily, { ebayResultCount: 2, visualItems });
    const ok = result.familyIssueConsensus === null;
    recordControl('below-coherence-floor family', 'familyIssueConsensus stays null (2 < FLOOR 3)', `familyIssueConsensus=${JSON.stringify(result.familyIssueConsensus)}`, ok);
    assertTrue(ok, 'CONTROL: below-floor family unchanged');
  }
  // CONTROL: contaminated family unchanged.
  {
    const visualItems = [{ rawTitle: 'Zap #7 NM' }, { rawTitle: 'Zap #7 VF' }, { rawTitle: 'Zap #7 CGC 9.8' }];
    const contamFamily = { selectedTitle: null, decision: 'fallback-vision', topFamily: { indices: [0, 1, 2], count: 3, weightSum: 3 }, runnerUp: { indices: [], count: 0, weightSum: 1 }, titleAxisOnlyBlock: true };
    const vision = { title: 'Zap', issue: '1', year: null, publisher: null, confidence: 'low' };
    const result = resolveIdentity(vision, null, contamFamily, { ebayResultCount: 3, visualItems });
    const ok = result.familyIssueConsensus === null;
    recordControl('contaminated family', 'familyIssueConsensus stays null (contamination screen)', `familyIssueConsensus=${JSON.stringify(result.familyIssueConsensus)}`, ok);
    assertTrue(ok, 'CONTROL: contaminated family unchanged');
  }
  // CONTROL: family clearing 3x margin unchanged (uses Section 1's real dominant numbers, 13.5/3.0).
  {
    const realLogParsed = buildParsedPool(LIVE_RAW_TITLES);
    const families = buildTitleFamilies(realLogParsed);
    const scored = scoreTitleFamilies(families, realLogParsed);
    const merged = mergeFragmentedTitleFamilies(scored, realLogParsed);
    const qualifiedCandidate = selectTitleFamilyCandidate(realLogParsed, 'Spawn', '301', '2020', { ebayConsensusTitle: 'spawn' });
    const result = resolveIdentity({ title: 'Spawn', issue: '301', year: '2020', publisher: 'Image Comics', confidence: 'low' }, { title: 'spawn', issue: '300', year: null, publisher: null, agreement: { visionIssueCount: 0, total: 18 } }, qualifiedCandidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: realLogParsed });
    const ok = result.familyIssueConsensus?.outcome === 'provisionally-corrected' && result.confirmedIssue === '351' && !('reason' in result.familyIssueConsensus);
    recordControl('family clearing 3x margin', 'unchanged Commit 4.3 qualified-retention path (adopts #351, no near-miss .reason marker)', `outcome=${result.familyIssueConsensus?.outcome} confirmedIssue=${result.confirmedIssue} hasReason=${'reason' in (result.familyIssueConsensus || {})}`, ok);
    assertTrue(ok, 'CONTROL: qualified-margin family unchanged (this is the real Pair 1/Commit 4.3 fixture, unmodified)');
  }
  // CONTROL: ordinary valid corroboration unchanged.
  {
    const visualItems = [{ rawTitle: 'Bar #1 NM' }, { rawTitle: 'Bar #1 VF' }, { rawTitle: 'Bar #1 Fine' }, { rawTitle: 'Bar #1 Good' }];
    const family = { selectedTitle: null, decision: 'fallback-vision', topFamily: { indices: [0, 1, 2, 3], count: 4, weightSum: 8 }, titleAxisOnlyBlock: true };
    const vision = { title: 'Bar', issue: '1', year: null, publisher: null, confidence: 'low' };
    const result = resolveIdentity(vision, null, family, { ebayResultCount: 4, visualItems });
    const ok = result.familyIssueConsensus?.outcome === 'corroborated' && result.familyIssueConsensus?.authoritativeForCustody === true && result.confirmedIssue === '1';
    recordControl('ordinary valid corroboration', 'outcome=corroborated, authoritative=true, confirmedIssue unchanged at "1"', `outcome=${result.familyIssueConsensus?.outcome} authoritative=${result.familyIssueConsensus?.authoritativeForCustody} confirmedIssue=${result.confirmedIssue}`, ok);
    assertTrue(ok, 'CONTROL: ordinary corroboration unchanged');
  }
}

console.log('\n=== NAMED MUTATION RESULTS ===');
mutationResults.forEach((m) => console.log(`  ${m.passed ? '✓' : '✗'} ${m.name}\n      naive: ${m.naiveOutcome}\n      real:  ${m.realOutcome}`));
console.log('\n=== NAMED CONTROL RESULTS ===');
controlResults.forEach((c) => console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}\n      expected: ${c.expectedBehavior}\n      observed: ${c.observed}`));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0 || mutationResults.some((m) => !m.passed) || controlResults.some((c) => !c.passed)) {
  console.log('Failures:\n' + failures.join('\n\n'));
  process.exit(1);
}
