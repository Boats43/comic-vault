// tests/grailkey-dispatch-27-fix27a-covertype-consensus.test.js
//
// GrailKey Dispatch 27 (2026-08-08) — Fix 27-A, coverType consensus
// backfill.
//
// Root problem: a real production scan (Spawn #351 Cover C Brett Booth
// Virgin Variant) had 16/20 raw-pool listings tagged "virgin"
// (imageSearchIdentity.js's own instrumentation proved the signal was in
// the pipeline), yet `variantIdentity.js`'s `extractConfirmedVariant`
// never collected a coverType/finish category at all — only convention,
// exclusive, artist, limitation, authentication. The artist-ratio gate
// (Q109-FIX-A) was NOT the defect; it correctly suppressed "Brett Booth"
// as non-distinguishing (an artist name is always true of every copy of
// a single-cover book). The actual defect: "virgin" was never a
// candidate for suppression OR adoption — categorically uncollected.
// `soldVerification.js`'s own axis-aware Filter 8 (Commit D3) then
// rejected all 11 real virgin sold comps as `variantMismatch:
// comp_has_user_none` on the `coverType` axis, because
// `confirmedVariant` was null and Case (a) — "comp has coverType tokens,
// user has none anywhere at all" — correctly fires on a genuinely empty
// user variant. The book priced at ~$5.49 (Cover A) instead of ~$21-26
// (the real virgin range already present in its own sold-comp pool).
//
// Vocabulary (GrailKey Dispatch 27, STEP B) — verified by direct
// execution, not assumed: extracting from `imageSearchIdentity.js`'s
// richer 'finish' list (10 tokens) would silently fail to round-trip for
// 4 of them (holographic/glow-in-dark/embossed/metallic — none contain
// the bare substrings foil/virgin/sketch `compHygiene.js`'s narrower
// `extractVariantTokensByAxis` checks for). `soldVerification.js` only
// ever reads the narrower list. Fix 27-A reads from that SAME function —
// guaranteeing the round-trip by construction, not by agreement. See
// Pattern Library GK-40 (three independently-drifted variant-token
// vocabularies; this reads exactly one on purpose, does not consolidate
// the other two).
//
// Predicate: 5 conditions (uniqueRows>=4, exact unanimity, no runnerUp,
// distinct itemId+seller via the newly-exported checkDistinctItemIdAndSeller,
// evaluateTitleTextIndependence >=3 clusters) — deliberately NOT 6:
// weightSum omitted, argued and greenlit (Pattern Library, same entry) —
// computing a rank-weight from a re-indexed, already-filtered population
// would be a sixth "wrong population" instance, self-inflicted.
//
// Tests assert OUTCOMES, not fields, per explicit instruction (the exact
// gap Fix 4's own test suite left open): confirmedVariant contains
// 'virgin' AND the real soldVerification filter chain — not a
// description of it — lets the 11 previously-rejected virgin comps
// survive AND the wiring to fetchComps' variant parameter is proven to
// exist end-to-end.
//
// Invoke: node tests/grailkey-dispatch-27-fix27a-covertype-consensus.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';
import { extractConfirmedVariant, tallyCoverTypeConsensus, evaluateCoverTypeConsensusPromotion } from '../src/lib/variantIdentity.js';
import { extractVariantTokensByAxis } from '../src/lib/compHygiene.js';
import { extractVariantTokens as isiExtractVariantTokens } from '../src/lib/imageSearchIdentity.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';
import { checkDistinctItemIdAndSeller } from '../src/lib/issueAuthority.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Dispatch 27 — Fix 27-A, coverType consensus backfill ===\n');

const REPRO_TITLES = [
  'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM',
  'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
  'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN [key] CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)',
];

const buildVisualItems = (titles) => titles.map((rawTitle, i) => ({
  rawTitle, itemId: `i${i}`, sellerUsername: `seller${i}`, issue: '351',
}));

// ══════════════ Section 1 — vocabulary round-trip (STEP B evidence, made permanent) ══════════════

console.log('-- Section 1: vocabulary round-trip — why compHygiene.js, not imageSearchIdentity.js --');
{
  const richTokens = ['virgin', 'sketch', 'foil', 'gold foil', 'silver foil', 'holofoil', 'holographic', 'glow-in-dark', 'embossed', 'metallic'];
  const roundTripFailures = richTokens.filter((tok) => extractVariantTokensByAxis(tok).coverType.length === 0);
  assertEq(roundTripFailures, ['holographic', 'glow-in-dark', 'embossed', 'metallic'], 'exactly these 4 of imageSearchIdentity\'s 10 "finish" tokens fail to round-trip through compHygiene\'s narrower coverType axis');
  assertTrue(isiExtractVariantTokens(REPRO_TITLES[0]).includes('virgin'), 'sanity: imageSearchIdentity\'s richer list DOES see "virgin" (proves the signal exists in the pipeline, per the real scan\'s own instrumentation)');
  assertTrue(extractVariantTokensByAxis(REPRO_TITLES[0].toLowerCase()).coverType.includes('virgin'), 'compHygiene\'s narrower list ALSO sees "virgin" on this specific repro — the list Fix 27-A actually reads from');
}

// ══════════════ Section 2 — tallyCoverTypeConsensus + evaluateCoverTypeConsensusPromotion, direct ══════════════

console.log('\n-- Section 2: predicate primitives, direct --');
{
  const items = buildVisualItems(REPRO_TITLES);
  const tally = tallyCoverTypeConsensus(items);
  assertEq(tally.winner, 'virgin', 'tally winner is "virgin"');
  assertEq(tally.support, 4, 'support=4 (all 4 rows assert virgin)');
  assertEq(tally.uniqueRows, 4, 'uniqueRows=4');
  assertEq(tally.runnerUp, null, 'no competing coverType token');

  const promotion = evaluateCoverTypeConsensusPromotion(tally, items);
  assertTrue(promotion.promote, 'promotes: uniqueRows=4, exact unanimity, no runnerUp, distinct itemId/seller');
  assertEq(promotion.declineReason, null, 'no decline reason on promote');

  // Tie-handling — mirrors resolveFamilyIssueConsensus: a tie never wins.
  const tiedItems = [
    { rawTitle: 'Spawn #351 Virgin Cover', itemId: 'a', sellerUsername: 'sa', issue: '351' },
    { rawTitle: 'Spawn #351 Virgin Cover B', itemId: 'b', sellerUsername: 'sb', issue: '351' },
    { rawTitle: 'Spawn #351 Sketch Cover', itemId: 'c', sellerUsername: 'sc', issue: '351' },
    { rawTitle: 'Spawn #351 Sketch Cover B', itemId: 'd', sellerUsername: 'sd', issue: '351' },
  ];
  const tiedTally = tallyCoverTypeConsensus(tiedItems);
  assertEq(tiedTally.winner, null, 'a genuine 2-2 tie never masquerades as a winner');
  assertEq(tiedTally.support, 0, 'support=0 on a tie');

  // Each of the five conditions declines independently.
  assertEq(evaluateCoverTypeConsensusPromotion({ uniqueRows: 3, support: 3, runnerUp: null, assertingIndices: [0, 1, 2] }, items).declineReason, 'uniqueRows<4', 'uniqueRows<4 declines');
  assertEq(evaluateCoverTypeConsensusPromotion({ uniqueRows: 4, support: 3, runnerUp: null, assertingIndices: [0, 1, 2, 3] }, items).declineReason, 'not-exact-unanimity', 'non-exact support declines, even at 75%');
  assertEq(evaluateCoverTypeConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: 'foil', assertingIndices: [0, 1, 2, 3] }, items).declineReason, 'runnerUp-present', 'a real runnerUp declines, even with exact unanimity on the winner');
  const dupSellerItems = buildVisualItems(REPRO_TITLES).map((it, i) => (i === 1 ? { ...it, sellerUsername: 'seller0' } : it));
  assertEq(evaluateCoverTypeConsensusPromotion(tallyCoverTypeConsensus(dupSellerItems), dupSellerItems).declineReason, 'duplicate-or-missing-seller', 'duplicate seller declines — reuses the REAL checkDistinctItemIdAndSeller, not a re-implementation');

  // Confirm it's really the same exported function, not a parallel copy.
  const directCheck = checkDistinctItemIdAndSeller([0, 1, 2, 3], items);
  assertTrue(directCheck.distinct, 'checkDistinctItemIdAndSeller, called directly (the same import variantIdentity.js uses), agrees');
}

// ══════════════ Section 3 — extractConfirmedVariant end-to-end (FIRE) ══════════════

console.log('\n-- Section 3: extractConfirmedVariant — FIRE, confirmedVariant contains "virgin" --');
let firedResult;
{
  const items = buildVisualItems(REPRO_TITLES);
  firedResult = extractConfirmedVariant(items, null, 2024, 'high');
  assertTrue(firedResult !== null, 'a result is returned (not the "no consensus" null)');
  assertEq(firedResult.confirmedVariant, 'virgin', 'confirmedVariant is exactly "virgin" — no artist appended (still correctly suppressed by the untouched 70% ratio gate)');
  assertEq(firedResult.consensus.coverType, 'virgin', 'consensus.coverType records the win');
  assertTrue(!firedResult.consensus.artist, 'consensus.artist stays unset — Q109-FIX-A\'s ratio gate is untouched by this fix');
}

// ══════════════ Section 4 — THE OUTCOME THAT MATTERS: real soldVerification, real comps ══════════════

console.log('\n-- Section 4: verifySoldComps — the 11 previously-rejected virgin comps, driven through the REAL filter chain --');
{
  // Mirrors the REAL production pool shape (29 total: 18 Cover A survive
  // the OTHER filters, 11 virgin comps rejected on variantMismatch) —
  // not an isolated single-variant fixture. This matters mechanically:
  // verifySoldComps has a genuine, DELIBERATE "variant fallback" safety
  // net (line ~934: `if (working.length === 0 && reasons.variantMismatch
  // > 0 ...)`) that resurrects ALL rejected comps, unfiltered, when
  // variant filtering would otherwise reject 100% of the pool (a real,
  // correct feature for thin-market variants with zero exact matches —
  // NOT a bug). An all-virgin or all-Cover-A fixture would trigger that
  // fallback and mask the exact discrimination this test exists to
  // prove — confirmed directly: an earlier, all-virgin-only draft of
  // this fixture produced a false pass via that exact fallback path
  // before being corrected to this mixed shape.
  const coverARows = Array.from({ length: 18 }, (_, i) => ({
    price: 5.00 + i * 0.1,
    title: `SPAWN #351 CVR A NM ${i}`,
    daysAgo: 5 + i,
    grade: '9.6',
  }));
  const virginSoldRows = Array.from({ length: 11 }, (_, i) => ({
    price: 21.25 + i * 0.5,
    title: `SPAWN #351 CVR C BRETT BOOTH VIRGIN VARIANT NM ${i}`,
    daysAgo: 10 + i,
    grade: '9.6',
  }));
  const mixedPool = [...coverARows, ...virginSoldRows];

  console.log('   BEFORE (confirmedVariant=null, the real production shape):');
  const before = verifySoldComps(mixedPool, {
    title: 'Spawn', issue: '351', variant: null, bookYear: 2024, userGradeKey: '9.6',
  });
  assertEq(before.verified.length, 18, 'BEFORE the fix: only the 18 Cover A comps survive — the 11 virgin comps rejected, reproducing the real production log (soldInput=29, rawPricingEligible=18) exactly');
  assertEq(before.diagnostics.reasons.variantMismatch, 11, 'BEFORE: variantMismatch counter is exactly 11 — matches the real log\'s codes={"WRONG_VARIANT":11}');
  assertFalse(before.verified.some((v) => /VIRGIN/i.test(v.title)), 'BEFORE: zero virgin comps in the surviving set — confirms this is real discrimination, not the 100%-reject fallback (which would have resurrected them unfiltered)');

  console.log('   AFTER (confirmedVariant="virgin", Fix 27-A\'s actual output from Section 3):');
  const after = verifySoldComps(mixedPool, {
    title: 'Spawn', issue: '351', variant: firedResult.confirmedVariant, bookYear: 2024, userGradeKey: '9.6',
  });
  const survivingVirgin = after.verified.filter((v) => /VIRGIN/i.test(v.title));
  const survivingCoverA = after.verified.filter((v) => /CVR A/i.test(v.title));
  assertEq(survivingVirgin.length, 11, 'AFTER the fix: all 11 SAME virgin comps now survive — the actual fix, not a description of it');
  assertEq(survivingCoverA.length, 0, 'AFTER the fix: the 18 Cover A comps are now correctly rejected — proves this is discrimination working correctly on the NOW-confirmed variant, not "stopped filtering variant at all"');
  assertEq(after.diagnostics.reasons.variantMismatch, 18, 'AFTER: variantMismatch counter is 18 (the Cover A rows) — the rejection axis flipped to the correct side, not disabled');
}

// ══════════════ Section 5 — fetchComps wiring, end-to-end source proof ══════════════

console.log('\n-- Section 5: confirmedVariant -> fetchComps\' variant parameter — the full chain, source-verified --');
{
  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(enrichSource.includes('variant: confirmedVariant'), 'fetchComps call sites still pass variant: confirmedVariant — pre-existing, unconditional, unchanged by Fix 27-A (this fix touches variantIdentity.js only, never enrich.js)');
  assertTrue(enrichSource.includes("writeConfirmed('confirmedVariant', confirmedVariant, variantCheck.confirmedVariant"), 'the real call site assigns confirmedVariant FROM variantCheck.confirmedVariant — the exact field extractConfirmedVariant returns (Section 3) — proving Fix 27-A\'s "virgin" reaches this assignment with no new plumbing needed');
}

// ══════════════ Section 6 — decline paths, unchanged safe behavior ══════════════

console.log('\n-- Section 6: decline paths — confirmedVariant stays unaffected, current (safe) behavior holds --');
{
  // Title collapse on the coverType-asserting population — mirrors
  // Fix 4/4b's own Section 4/10 decline shape.
  const collapsedTitles = [
    'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
    'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024) copy',
    'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
    'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024) NM',
  ];
  const collapsedResult = extractConfirmedVariant(buildVisualItems(collapsedTitles), null, 2024, 'high');
  assertTrue(collapsedResult === null || !collapsedResult.consensus.coverType, 'title-collapse (condition 6 fails) — coverType never adopted');

  // Thin population (< 4 asserting rows).
  const thinItems = buildVisualItems(REPRO_TITLES.slice(0, 2));
  const thinResult = extractConfirmedVariant(thinItems, null, 2024, 'high');
  assertTrue(thinResult === null || !thinResult.consensus.coverType, 'uniqueRows<4 — coverType never adopted, whatever else the pool agrees on');

  // Dissenting population — genuine conflict, no winner.
  const dissentingItems = [
    { rawTitle: 'Spawn #351 Virgin A', itemId: 'a', sellerUsername: 'sa', issue: '351' },
    { rawTitle: 'Spawn #351 Virgin B', itemId: 'b', sellerUsername: 'sb', issue: '351' },
    { rawTitle: 'Spawn #351 Virgin C', itemId: 'c', sellerUsername: 'sc', issue: '351' },
    { rawTitle: 'Spawn #351 Sketch D', itemId: 'd', sellerUsername: 'sd', issue: '351' },
  ];
  const dissentTally = tallyCoverTypeConsensus(dissentingItems);
  assertEq(dissentTally.winner, 'virgin', 'sanity: 3/4 virgin still computes a plurality winner');
  const dissentPromotion = evaluateCoverTypeConsensusPromotion(dissentTally, dissentingItems);
  assertFalse(dissentPromotion.promote, 'but 3/4 is NOT exact unanimity — declines, never adopts a plurality (same discipline as the issue/year axes)');
  assertEq(dissentPromotion.declineReason, 'not-exact-unanimity', 'correct decline reason');
}

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
