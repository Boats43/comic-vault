// tests/grailkey-dispatch-26-fix4-zero-support-rescue.test.js
//
// GrailKey Dispatch 26 (2026-08-08) — Fix 4, zero-support unanimous
// rescue.
//
// Root problem: decideFieldAuthority's Rule D (identityCore.js, GrailKey
// Dispatch 25) correctly refuses to let a qualified, unanimous family
// silently overwrite a CONFIDENT Vision assertion — that protection is
// untouched by this fix. But Rule D has no visibility into the RAW,
// unclustered pool: a Vision issue with ZERO support anywhere in the raw
// pool, not just inside one family, is not "confident with weak
// corroboration" — it is confident with NO corroboration at all, the
// "confident and wrong" shape the standing product principle exists to
// prevent. The real repro (Spawn #351 Cover C Brett Booth Virgin
// Variant, request 2q7wv-1786150781648-36737bd17c6e, 2026-08-08 00:59
// UTC): Vision confidently asserted "#1, 1992" on a virgin variant with
// no printed issue number; the winning family unanimously asserted #351
// (4/4=100%, weightSum 13.0); the raw pool showed 0/20 support for
// Vision's "1". Before this fix, decideFieldAuthority's own Rule D
// (correctly, by design) declined to auto-adopt the family's value given
// Vision's confidence, but the vision-zero-support ESCALATE branch
// further downstream never re-consulted the family's own answer — it
// checked only the raw pool's OWN, unrelated plurality, found nothing,
// and forced ID_REQUIRED, discarding a fully-computed unanimous
// alternate.
//
// Six required conditions, ALL of, verified by direct trace during
// scoping before any code was written (not assumed):
//   1. Rule D produced outcome:'conflicted', authoritativeForCustody:false.
//   2. vision.priorIndependentlyTrusted === false (a user correction or
//      barcode read can never reach resolveIdentity in production at
//      all — verified: api/enrich.js's barcode/manual/cgc-identity
//      branches are mutually exclusive with the resolveIdentity call
//      site — checked here anyway as defense in depth).
//   3. Raw-pool zero support (isIssueZeroSupport, the SAME helper/floor
//      the pre-existing vision-zero-support block uses).
//   4/5. evaluateUnanimousConsensusPromotion (issueAuthority.js) — the
//      SAME predicate Fix 2 uses, reused verbatim: uniqueRows>=4, exact
//      unanimity, no issue-tally runner-up, weightSum>=8, distinct
//      itemId AND distinct sellerUsername.
//   6. evaluateTitleTextIndependence — >=3 distinct title-wording
//      clusters (Jaccard >=0.7) among the asserting rows. Closes a gap
//      condition 4/5 alone cannot: checkDistinctItemIdAndSeller proves
//      listings were independently POSTED, not independently IDENTIFIED
//      — eBay sellers routinely copy a competitor's listing title
//      verbatim for search-ranking reasons, which produces N distinct
//      sellers all carrying ONE propagated mislabeling error. See
//      Pattern Library, "independent posting is not independent
//      identification."
//
// Threshold (Jaccard >=0.7) and the bare ">=3 clusters, no margin" rule
// were fixed BEFORE being run against this real repro — verified here
// (Section 1) to reproduce the EXACT numbers reported during scoping:
// one copy-propagated pair at 0.929, every other pairing 0.368-0.538,
// landing at exactly 3 clusters (the floor, not with margin). No margin
// requirement was added after seeing that — see the Pattern Library
// entry for why (deferred pending telemetry, not closed).
//
// Invoke: node tests/grailkey-dispatch-26-fix4-zero-support-rescue.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';
import { resolveIdentity } from '../src/lib/identityCore.js';
import { evaluateTitleTextIndependence, escalateIssueAuthorityOnConflict, computeIssueAuthorityContractPatch } from '../src/lib/issueAuthority.js';
import { getEraYearTolerance, evaluateEraYearMatch } from '../src/lib/compHygiene.js';

// GrailKey Dispatch 26, Fix 4b (2026-08-08) — appended to the SAME file
// as Fix 4, not a separate one: they ship in one commit, and Fix 4b
// exists specifically because Fix 4 alone would have been a net
// regression on this exact book (issue confirmed while confirmedYear
// stayed at Vision's fabricated "1992" — an honest ID_REQUIRED block
// turning into a confident-and-wrong price). Sections 8-11 below.

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Dispatch 26 — Fix 4, zero-support unanimous rescue ===\n');

// The real Spawn #351 repro's four winning-family title strings, verbatim.
const REPRO_TITLES = [
  'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM',
  'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
  'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN [key] CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)',
];

// ══════════════ Section 1 — condition 6 primitive, direct ══════════════

console.log('-- Section 1: evaluateTitleTextIndependence — the real repro, condition 6 in isolation --');
{
  const result = evaluateTitleTextIndependence(REPRO_TITLES);
  assertTrue(result.pass, 'the real repro clears >=3 distinct clusters');
  assertEq(result.assertingRows, 4, 'all 4 rows are asserting (none silent/unparseable)');
  assertEq(result.distinctClusters, 3, 'exactly 3 clusters — the floor, not comfortable margin (reported during scoping, not tuned after)');
  assertEq(result.largestClusterSize, 2, 'the largest cluster is the 2 copy-propagated rows');
  assertTrue(Math.abs(result.maxPairwiseJaccard - 0.9285714285714286) < 1e-9, 'max pairwise Jaccard matches the copy-propagated pair (13/14)');
  assertTrue(Math.abs(result.minPairwiseJaccard - 0.3684210526315789) < 1e-9, 'min pairwise Jaccard matches the most-divergent pair (7/19)');
}

console.log('\n-- Section 2: evaluateTitleTextIndependence — sanity fixtures --');
{
  const allSame = evaluateTitleTextIndependence([REPRO_TITLES[1], REPRO_TITLES[1], REPRO_TITLES[1], REPRO_TITLES[1]]);
  assertFalse(allSame.pass, '4 verbatim-identical titles collapse to 1 cluster — fails regardless of row count');
  assertEq(allSame.distinctClusters, 1, 'exactly 1 cluster for identical text');

  const allDifferent = evaluateTitleTextIndependence([
    'Batman 608 CGC 9.8',
    'Amazing Spider-Man Annual',
    'X-Men First Class Giant Size',
    'Fantastic Four 4 Origin Story',
  ]);
  assertTrue(allDifferent.pass, '4 wildly different titles cleanly pass');
  assertEq(allDifferent.distinctClusters, 4, 'each row is its own cluster');

  const tooFew = evaluateTitleTextIndependence(['Spawn 351 Brett Booth', 'Spawn 351 Cover C']);
  assertFalse(tooFew.pass, 'only 2 asserting rows can never reach 3 clusters, regardless of wording');

  const gradeNormalized = evaluateTitleTextIndependence([
    'Spawn 351 Brett Booth NM',
    'Spawn 351 Brett Booth near mint',
  ]);
  assertEq(gradeNormalized.maxPairwiseJaccard, 1, 'grade/condition tokens (NM vs "near mint") are stripped — these two are identical once normalized');
}

// ══════════════ Section 3 — full end-to-end through resolveIdentity ══════════════

const buildFamily = (overrides = {}) => ({
  selectedTitle: 'Spawn Brett Booth Cameo Of Lyra Htf Scarce',
  decision: 'fallback-vision', // Q84-blocked on the TITLE axis, per the real repro
  titleAxisOnlyBlock: true,
  topFamily: { indices: [0, 1, 2, 3], weightSum: 13.0, count: 4 },
  runnerUp: { indices: [4, 5], weightSum: 2.5, count: 2 },
  ...overrides,
});

const buildVisualItems = (titles) => [
  ...titles.map((rawTitle, i) => ({ rawTitle, itemId: `i${i}`, sellerUsername: `seller${i}` })),
  { rawTitle: 'Spawn Incentive Todd McFarlane Variant #351', itemId: 'i4', sellerUsername: 'sellerE' },
  { rawTitle: 'Spawn Incentive Todd McFarlane Variant #351 NM', itemId: 'i5', sellerUsername: 'sellerF' },
];

const buildVision = (overrides = {}) => ({
  title: 'Spawn', issue: '1', year: '1992', publisher: 'Image',
  confidence: 'high', source: 'vision', priorIndependentlyTrusted: false,
  ...overrides,
});

const buildEbay = () => ({
  title: 'Spawn', issue: null, noIssueConsensus: true,
  agreement: { visionIssueCount: 0, total: 20 },
});

console.log('\n-- Section 3: full repro — FIRE, both parallel symptoms resolve --');
{
  const identity = resolveIdentity(
    buildVision(), buildEbay(), buildFamily(),
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems: buildVisualItems(REPRO_TITLES) }
  );
  assertEq(identity.confirmedIssue, '351', 'confirmedIssue rescued from Vision\'s wrong "1" to the family\'s "351"');
  assertEq(identity.identityEscalation, null, 'identityEscalation stays null — NOT forced to ID_REQUIRED (the book stays priceable)');
  assertEq(identity.familyIssueConsensus?.mode, 'unanimous-zero-support-rescue', 'mode is the new, distinct sentinel — neither "conflict-locked" nor "adopted"');
  assertEq(identity.matchConfidenceDemote, true, 'match confidence demoted one tier, same treatment as override/escalate');
  assertEq(identity.visionZeroSupport?.mode, 'rescue', 'visionZeroSupport surfaces mode="rescue" for the card UI');
  assertEq(identity.visionZeroSupport?.visionIssue, '1', 'visionZeroSupport records the overridden Vision value');
  assertEq(identity.visionZeroSupport?.adoptedIssue, '351', 'visionZeroSupport records the adopted value');
  assertTrue(identity.identitySource.includes('zero_support_unanimous_rescue'), 'identitySource tags the rescue');
}

console.log('\n-- Section 4: condition 6 alone declines (title collapse to 1 cluster) — ESCALATE stands, unchanged --');
{
  const collapsedTitles = [
    'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
    'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024) copy',
    'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
    'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024) NM',
  ];
  const identity = resolveIdentity(
    buildVision(), buildEbay(), buildFamily(),
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems: buildVisualItems(collapsedTitles) }
  );
  assertEq(identity.confirmedIssue, null, 'confirmedIssue nulled — the rescue correctly declined, current ESCALATE behavior unchanged');
  assertEq(identity.identityEscalation, 'ID_REQUIRED', 'ID_REQUIRED still forced — a single condition failing changes nothing');
  assertEq(identity.familyIssueConsensus?.mode, 'conflict-locked', 'mode stays the pre-Fix-4 "conflict-locked" — no silent partial state');
}

console.log('\n-- Section 5: priorIndependentlyTrusted=true never fires (defense in depth) --');
{
  const identity = resolveIdentity(
    buildVision({ priorIndependentlyTrusted: true }), buildEbay(), buildFamily(),
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems: buildVisualItems(REPRO_TITLES) }
  );
  assertFalse(identity.familyIssueConsensus?.mode === 'unanimous-zero-support-rescue', 'rescue never fires for a trusted prior, even with every other condition favorable');
  // NOTE: not asserted here — a trusted prior with authoritativeForCustody
  // already true still gets overwritten by the pre-existing (pre-Fix-4)
  // vision-zero-support ESCALATE branch afterward, because that branch's
  // familyAuthoritySkip only recognizes mode 'adopted'/'corroborated'/the
  // new rescue sentinel, not a legacy 'conflict-locked' mode that actually
  // carried authoritativeForCustody:true. This is a PRE-EXISTING gap,
  // unrelated to and untouched by Fix 4 (confirmed: identical behavior
  // with Fix 4's own new branch never entering, since its first condition
  // requires authoritativeForCustody===false). Currently unreachable in
  // production (priorIndependentlyTrusted is hardcoded false on the only
  // real resolveIdentity call site) — flagged, not fixed, out of scope.
}

console.log('\n-- Section 6: promotion.promote declines (weightSum too thin) — ESCALATE stands --');
{
  const thinFamily = buildFamily({ topFamily: { indices: [0, 1, 2, 3], weightSum: 7.9, count: 4 } });
  const identity = resolveIdentity(
    buildVision(), buildEbay(), thinFamily,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems: buildVisualItems(REPRO_TITLES) }
  );
  assertEq(identity.confirmedIssue, null, 'weightSum=7.9 < 8.0 declines evaluateUnanimousConsensusPromotion — rescue never fires, ESCALATE stands');
  assertEq(identity.identityEscalation, 'ID_REQUIRED', 'ID_REQUIRED still forced');
}

// ══════════════ Section 7 — escalateIssueAuthorityOnConflict, V4-class guard ══════════════

console.log('\n-- Section 7: escalateIssueAuthorityOnConflict recognizes the NEW, distinct rescue reason string --');
{
  const rescuedAuthority = {
    source: 'marketplace', status: 'confirmed', confidence: 'high', supportRatio: 1,
    reasons: ['unanimous-marketplace-consensus-zero-support-rescue'],
    priorObservations: [],
  };
  const conflict = { currentIssue: '351', consensusIssue: '9999', decision: 'divergence' };
  const escalated = escalateIssueAuthorityOnConflict(rescuedAuthority, conflict);
  assertEq(escalated.status, 'conflicted', 'a rescued+confirmed row DOES re-escalate on a later real contradiction — the V4 gap, not reintroduced for Fix 4\'s own reason string');
  assertTrue(escalated.reasons.includes('visual-pool-issue-divergence'), 'divergence reason appended');
  assertTrue(escalated.reasons.includes('unanimous-marketplace-consensus-zero-support-rescue'), 'original provenance reason preserved, never dropped');

  const noConflict = escalateIssueAuthorityOnConflict(rescuedAuthority, null);
  assertEq(noConflict, rescuedAuthority, 'no conflict signal — referential no-op, stays confirmed');

  // Fix 2's OWN reason string must still work too — this extension is
  // additive, not a replacement.
  const fix2Authority = { ...rescuedAuthority, reasons: ['unanimous-marketplace-consensus'] };
  const fix2Escalated = escalateIssueAuthorityOnConflict(fix2Authority, conflict);
  assertEq(fix2Escalated.status, 'conflicted', 'Fix 2\'s own reason string still escalates correctly — unchanged by this extension');
}

// ══════════════ Section 8-11 — Fix 4b, year-axis rescue ══════════════

const buildVisualItemsWithYear = (titles, year) => [
  ...titles.map((rawTitle, i) => ({ rawTitle, itemId: `i${i}`, sellerUsername: `seller${i}`, year })),
  { rawTitle: 'Spawn Incentive Todd McFarlane Variant #351', itemId: 'i4', sellerUsername: 'sellerE', year },
  { rawTitle: 'Spawn Incentive Todd McFarlane Variant #351 NM', itemId: 'i5', sellerUsername: 'sellerF', year },
];

console.log('\n-- Section 8: Fix 4b — full repro WITH structured year data — year rescue FIRES --');
let fix4bFiredIdentity;
{
  fix4bFiredIdentity = resolveIdentity(
    buildVision(), buildEbay(), buildFamily(),
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems: buildVisualItemsWithYear(REPRO_TITLES, 2024) }
  );
  assertEq(fix4bFiredIdentity.confirmedIssue, '351', 'issue still rescued (sanity — Fix 4 unaffected by year data being present)');
  assertEq(fix4bFiredIdentity.confirmedYear, '2024', 'confirmedYear corrected from Vision\'s fabricated "1992" to the family\'s "2024"');
  assertEq(fix4bFiredIdentity.familyYearConsensus?.mode, 'unanimous-year-zero-support-rescue', 'year mode is the new, distinct sentinel — neither "conflict-locked" nor "adopted"');
  assertTrue(fix4bFiredIdentity.identitySource.includes('year_zero_support_unanimous_rescue'), 'identitySource tags the year rescue');
}

console.log('\n-- Section 9: COMPS SURVIVE THE ERA FILTER — not just that confirmedYear changed --');
{
  // Reproduces the original dispatch log line mechanically: a real 2024
  // comp, rejected against the wrong year at this codebase's own shared
  // tolerance primitive (Modern era, ±3y).
  const realComp2024 = 2024;
  const beforeFix = evaluateEraYearMatch(realComp2024, 1992, getEraYearTolerance(1992), null);
  assertFalse(beforeFix.keep, 'BEFORE the fix: a real 2024 comp is rejected against confirmedYear=1992 — reproduces "[era-filter] rejected: Spawn #352A VF 2024 (year 2024 vs 1992, tol ±3)" verbatim');

  const rescuedYear = Number(fix4bFiredIdentity.confirmedYear);
  const afterFix = evaluateEraYearMatch(realComp2024, rescuedYear, getEraYearTolerance(rescuedYear), null);
  assertTrue(afterFix.keep, 'AFTER the fix: the SAME real 2024 comp survives against the rescued confirmedYear=2024 — the book can actually price, not just carry a corrected label');
  assertEq(afterFix.matchedVia, 'confirmed-year', 'kept via a direct year match, not the volume-label fallback — genuinely correct, not a lucky accident of a different carve-out');
}

console.log('\n-- Section 10: Fix 4b DECLINE — HARD CONSTRAINT keeps the book blocked, not priced against 1992 --');
{
  // Isolate a year-only decline: issue wording stays distinct (issue
  // rescue fires normally) but one row dissents on the YEAR value itself
  // — breaks evaluateUnanimousYearConsensusPromotion's exact-unanimity
  // requirement specifically, independent of Section 4's title-collapse
  // decline shape.
  const dissentingYearItems = buildVisualItemsWithYear(REPRO_TITLES, 2024);
  dissentingYearItems[1].year = 2023;
  const declineIdentity = resolveIdentity(
    buildVision(), buildEbay(), buildFamily(),
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems: dissentingYearItems }
  );
  assertEq(declineIdentity.confirmedIssue, '351', 'issue rescue still fires — title wording is fine, only the year dissents');
  assertEq(declineIdentity.confirmedYear, '1992', 'confirmedYear stays at Vision\'s unverified value — year rescue declined on dissent, never silently adopted a majority');
  assertEq(declineIdentity.familyYearConsensus?.mode, 'conflict-locked', 'year mode stays conflict-locked — the exact signal api/enrich.js reads to keep the gate shut');

  // Prove the HARD CONSTRAINT mechanism itself, using the REAL, shipped
  // function — not asserted by description. api/enrich.js's rescue branch
  // sets identityProvisionalFields=['year'] whenever it observes exactly
  // this mode; feed that combination into the actual gate.
  const declinedAuthority = { source: 'marketplace', status: 'confirmed', confidence: 'high', supportRatio: 1, reasons: ['unanimous-marketplace-consensus-zero-support-rescue'], priorObservations: [] };
  const blockedPatch = computeIssueAuthorityContractPatch(declinedAuthority, {}, ['year']);
  assertTrue(blockedPatch !== null, 'a patch IS produced — the book does not silently price on an unresolved year');
  assertEq(blockedPatch.refusedToPrice, true, 'refusedToPrice=true — price withheld');
  assertEq(blockedPatch.price, null, 'price nulled');
  assertEq(blockedPatch.priceBands, null, 'priceBands nulled');
  assertEq(blockedPatch.listingHardLocked, true, 'listing hard-locked pending year verification');
  assertEq(blockedPatch.pricingSource, 'refused-year-authority-provisional', 'pricingSource correctly attributes the block to the YEAR specifically, not the issue (issueAuthority.status is confirmed the whole time)');

  // Contrast: the FIRE case (Section 8) must NOT produce a patch.
  const firedAuthority = { ...declinedAuthority };
  const noPatch = computeIssueAuthorityContractPatch(firedAuthority, {}, undefined);
  assertEq(noPatch, null, 'no patch when the year was genuinely rescued (identityProvisionalFields never carries \'year\' for that case) — pricing proceeds normally');
}

console.log('\n-- Section 11: pcQueryYear / yearForResolution — the narrow-sentinel threading itself --');
{
  // Source-presence: confirms the narrow sentinel shipped at exactly the
  // two call sites the audit proved necessary — not
  // identityIsProvisionalOverride reused broadly (GrailKey Dispatch 26:
  // 5 of 7 consumers audited and found NOT to need this signal; reusing
  // the broad flag would have silently inherited behavior built for the
  // title-override/refused-identity-conflict shapes it actually serves).
  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const sentinelPattern = "identity?.familyYearConsensus?.mode === 'unanimous-year-zero-support-rescue'";
  const occurrences = enrichSource.split(sentinelPattern).length - 1;
  assertEq(occurrences, 2, 'the narrow sentinel check appears at exactly 2 call sites in enrich.js — pcQueryYear and yearForResolution, matching the audit, no silent third site');

  // Behavioral replica of the exact ternary shipped at both sites:
  // `(identityIsProvisionalOverride || identity?.familyYearConsensus?.mode === 'unanimous-year-zero-support-rescue') ? confirmedYear : year`
  const threadedValue = (identityIsProvisionalOverride, familyYearConsensusMode, confirmedYear, rawYear) =>
    (identityIsProvisionalOverride || familyYearConsensusMode === 'unanimous-year-zero-support-rescue') ? confirmedYear : rawYear;

  assertEq(threadedValue(false, 'unanimous-year-zero-support-rescue', '2024', '1992'), '2024', 'rescued year wins over the raw (still-fabricated) request field — this is what makes pcQueryYear/yearForResolution carry the corrected year');
  assertEq(threadedValue(false, 'conflict-locked', '1992', '1992'), '1992', 'declined rescue: falls through to the raw year');
  assertEq(threadedValue(false, 'conflict-locked', '2024-would-be-wrong-to-use-here', '1992'), '1992', 'declined rescue does NOT use confirmedYear even if it held something else — raw year wins whenever the sentinel is absent, exactly as before Fix 4b for every non-rescue case (zero blast radius on normal identification)');
  assertEq(threadedValue(true, null, '2024', '1992'), '2024', 'identityIsProvisionalOverride alone still works on its own pre-existing cases — additive, not a replacement');
}

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
