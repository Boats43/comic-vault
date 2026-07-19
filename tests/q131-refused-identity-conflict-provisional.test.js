// Q131 — title-family refusal fallback defaulted to Vision's guess instead
// of the visual pool's own signal, even when the pool is coherent and
// Vision is demonstrably wrong.
//
// Production case, reconstructed from real Vercel runtime logs — TWO
// independent scans of the identical photo (builds 993a807 and 7d0d28d),
// both misidentifying it as "He-Man and the Masters of the Universe/
// Multiverse" #1 (Vision inconsistent with ITSELF across rescans). The
// real book: Eternus #2 - NYCC Metal Virgin Variant Cover, $150 comps.
//
//   [visual] consensus: none — pool=20 (below issueOk>=50% coherence gate)
//   [top-rank-guard] insufficient forward overlap (0/7 = 0% < 50%)
//   [title-family] decision=refused-identity-conflict
//   [title-family] top family: "eternus cover" (weight 9.0, 2 members)
//   [phase1] eBay visual insufficient (17 results), using Vision title  <- BUG
//   [22c] convergence=100 tier=HIGH                                     <- BUG
//   [phase2] identity-refused fallback: 17 visual-pool prices           <- BUG
//     → median=$7.25 (blends 2 real $150 Eternus comps with Lobo/Conan/junk)
//
// Root cause: three independent consumers of familyCandidate.decision,
// none checking the 'refused-identity-conflict' case:
//   1. resolveIdentity (identityCore.js) — fell through to its generic
//      "insufficient data" branch, indistinguishable from genuinely-thin
//      pools, and blindly trusted Vision even though the pool had already
//      PROVEN zero overlap with it.
//   2. [22c] convergence scorer (api/enrich.js) — computed HIGH confidence
//      on confirmedTitle moments after the refusal, with no awareness of it.
//   3. Ship-11 fallback pricing (api/enrich.js) — blended the full raw
//      17-item pool instead of isolating to the 2 real, unanimous Eternus
//      comps the pipeline had already identified.
//
// Fix: surface the pool's own top family as a PROVISIONAL identity
// (identitySource='title-family-refused-provisional'), strongly flagged,
// requiring >=2 unanimous members (genuine corroboration, not one
// listing) — same principle as Q130's Giang fix (a real, corroborated
// signal beats a closed-set/single-source guess). All three consumers
// fixed together (not half-fixed): resolveIdentity surfaces it,
// applyIdentityConflictDemotion caps convergence, and
// buildIdentityRefusedFallbackPool isolates the fallback price.
//
// FOLLOW-UP (same dispatch family) — a FOURTH consumer surfaced only once
// this fix went live: Ship #22e's assembly-integrity check
// (checkAssemblyIntegrity) validates the assembled title against the FULL
// raw comp pool (>=60% token support required) — an assumption that's
// false by construction here, since the Eternus family is only 2/17≈12%
// of the raw pool (100% of its OWN family, 12% of the whole). 22e was
// reverting Fix 1's correct provisional title straight back to Vision.
// Fixed by shouldSkipAssemblyIntegrityCheck(familyDecision) — exempts
// refused-identity-conflict from 22e entirely, since that identity is an
// intentional departure from Vision, not an assembly bug 22e should catch.
//
// Invoke: node tests/q131-refused-identity-conflict-provisional.test.js

import {
  resolveIdentity,
  buildIdentityRefusedFallbackPool,
  checkAssemblyIntegrity,
  shouldSkipAssemblyIntegrityCheck,
} from '../src/lib/identityCore.js';
import { applyIdentityConflictDemotion } from '../src/lib/convergenceScore.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Real production data: the refused-identity-conflict result shape
// selectTitleFamilyCandidate actually returned for this scan.
const eternusFamilyCandidate = {
  decision: 'refused-identity-conflict',
  selectedTitle: null,
  rawTitle: null,
  reason: 'Visual pool families lack overlap with Vision (best: 0/2 tokens)',
  topFamily: {
    title: 'eternus cover',
    rawTitle: 'Eternus #2 - NYCC Metal Virgin Variant Cover',
    weightSum: 9.0,
    count: 2,
    indices: [0, 1],
  },
  runnerUp: {
    title: 'lobo lee bermejo var',
    rawTitle: 'LOBO #1 COVER E LEE BERMEJO FOIL VARIANT DC NEXT LEVEL 2026 NEW NM- OR BETTER',
    weightSum: 4.5,
    count: 6,
    indices: [5, 6, 7, 8, 10, 17],
  },
  families: [],
};

// Q131 follow-up NOTE: the original visionGuess fixture used
// year:null, publisher:null — which meant the original 24-assertion
// suite could NOT have caught the confirmedPublisher/confirmedYear bug
// this follow-up fixes (both `|| null` fallbacks are indistinguishable
// from `|| vision.X` when vision.X is already null). Fixed here with
// realistic non-null values matching what the real Vision call actually
// returns for a "He-Man" guess (a real DC property, so Vision plausibly
// also guessed publisher="DC Comics", year="2021") — this is what
// exposes the bug for real.
const visionGuess = { title: 'He-Man and the Masters of the Universe', issue: '1', year: '2021', publisher: 'DC Comics' };

// ── 1. resolveIdentity — provisional Eternus identity surfaces ──────
console.log('\n── resolveIdentity: refused-conflict + unanimous topFamily ──');
{
  const identity = resolveIdentity(visionGuess, null, eternusFamilyCandidate, { ebayResultCount: 17 });
  check(identity.identitySource === 'title-family-refused-provisional',
    `identitySource flags provisional (got "${identity.identitySource}")`);
  check(/eternus/i.test(identity.confirmedTitle),
    `confirmedTitle surfaces "Eternus", not "He-Man" (got "${identity.confirmedTitle}")`);
  check(!/he-?man/i.test(identity.confirmedTitle),
    `confirmedTitle does NOT confidently assert the disproven Vision guess`);
  check(identity.confirmedIssue === '2',
    `confirmedIssue adopts the pool's own #2, not Vision's #1 (got "${identity.confirmedIssue}")`);
  // Q131 follow-up (2026-07-19, Eternus #2 / Scout Comics class) — the
  // real production bug: confirmedPublisher silently stayed "DC Comics"
  // (Vision's He-Man guess) even after the title correctly resolved to
  // Eternus. No publisher signal exists in this pool (topFamily carries
  // only title/rawTitle) — honest null, not the disproven Vision guess.
  check(identity.confirmedPublisher !== 'DC Comics',
    `confirmedPublisher does NOT silently keep Vision's disproven "DC Comics" guess (got "${identity.confirmedPublisher}")`);
  check(identity.confirmedPublisher === null,
    `confirmedPublisher is honestly null (no signal available), not fabricated (got "${identity.confirmedPublisher}")`);
  check(identity.confirmedYear !== '2021',
    `confirmedYear does NOT silently keep Vision's disproven "2021" guess (got "${identity.confirmedYear}")`);
  check(identity.confirmedYear === null,
    `confirmedYear is honestly null (no signal available) (got "${identity.confirmedYear}")`);
}

// ── 1b. resolveIdentity — ebay consensus year/publisher DOES get used ──
console.log('\n── resolveIdentity: ebay.year/publisher signal still honored when present ──');
{
  // When a genuine eBay-consensus year/publisher DOES exist alongside a
  // refused-identity-conflict decision (rare, but the code path exists —
  // ebay?.year || null), it must still be used. Confirms the fix is
  // "don't trust Vision specifically," not "never resolve year/publisher."
  const ebayWithYearPublisher = { year: '2023', publisher: 'Scout Comics' };
  const identity = resolveIdentity(visionGuess, ebayWithYearPublisher, eternusFamilyCandidate, { ebayResultCount: 17 });
  check(identity.confirmedYear === '2023', `ebay.year used when present (got "${identity.confirmedYear}")`);
  check(identity.confirmedPublisher === 'Scout Comics', `ebay.publisher used when present (got "${identity.confirmedPublisher}")`);
}

// ── 1c. resolveIdentity — issue fallback also doesn't leak vision.issue ──
console.log('\n── resolveIdentity: issue fallback (no #N in rawTitle) does not leak vision.issue ──');
{
  const noIssueFamily = {
    ...eternusFamilyCandidate,
    topFamily: { ...eternusFamilyCandidate.topFamily, rawTitle: 'Eternus NYCC Metal Virgin Variant Cover (no issue number)' },
  };
  const identity = resolveIdentity(visionGuess, null, noIssueFamily, { ebayResultCount: 17 });
  check(identity.confirmedIssue !== '1',
    `confirmedIssue does NOT fall back to Vision's disproven "#1" when topFamily has no issue# (got "${identity.confirmedIssue}")`);
  check(identity.confirmedIssue === null, `confirmedIssue is honestly null (got "${identity.confirmedIssue}")`);
}

// ── 2. Guard: single-listing "family" is not corroboration ──────────
console.log('\n── resolveIdentity: refused-conflict but topFamily.count=1 (guard) ──');
{
  const thinFamily = {
    ...eternusFamilyCandidate,
    topFamily: { ...eternusFamilyCandidate.topFamily, count: 1 },
  };
  const identity = resolveIdentity(visionGuess, null, thinFamily, { ebayResultCount: 17 });
  check(identity.identitySource !== 'title-family-refused-provisional',
    `single-listing family does NOT trigger provisional override (got "${identity.identitySource}")`);
  check(identity.confirmedTitle === visionGuess.title,
    `falls through to Vision, same as pre-fix behavior for a genuinely thin pool`);
}

// ── 3. Guard: fallback-vision (not refused-identity-conflict) unaffected ─
console.log('\n── resolveIdentity: fallback-vision decision unaffected ──');
{
  const fallbackVisionCandidate = { ...eternusFamilyCandidate, decision: 'fallback-vision' };
  const identity = resolveIdentity(visionGuess, null, fallbackVisionCandidate, { ebayResultCount: 17 });
  check(identity.identitySource !== 'title-family-refused-provisional',
    `fallback-vision decision does not trigger the new branch (got "${identity.identitySource}")`);
}

// ── 4. applyIdentityConflictDemotion — HIGH capped to LOW ────────────
console.log('\n── applyIdentityConflictDemotion ──');
{
  const highConvergence = { convergenceScore: 100, tier: 'HIGH', axes: {} };
  const demoted = applyIdentityConflictDemotion(highConvergence, 'refused-identity-conflict');
  check(demoted.tier === 'LOW', `HIGH demoted to LOW (got "${demoted.tier}")`);
  check(demoted.convergenceScore <= 69, `score capped below MEDIUM floor (got ${demoted.convergenceScore})`);
  check(demoted.preDemotionTier === 'HIGH' && demoted.preDemotionScore === 100,
    `pre-demotion values preserved for debugging (${demoted.preDemotionTier}, ${demoted.preDemotionScore})`);
  check(demoted.identityConflictDemoted === true, `flagged explicitly, never silent`);
  check(highConvergence.tier === 'HIGH', `input object untouched (pure function)`);

  const mediumConvergence = { convergenceScore: 78, tier: 'MEDIUM', axes: {} };
  const demotedMedium = applyIdentityConflictDemotion(mediumConvergence, 'refused-identity-conflict');
  check(demotedMedium.tier === 'LOW', `MEDIUM also demoted to LOW (got "${demotedMedium.tier}")`);

  const unaffected = applyIdentityConflictDemotion({ convergenceScore: 100, tier: 'HIGH', axes: {} }, 'top-rank-protection');
  check(unaffected.tier === 'HIGH' && !unaffected.identityConflictDemoted,
    `non-refused decisions never demoted (got "${unaffected.tier}")`);

  const alreadyLow = { convergenceScore: 40, tier: 'LOW', axes: {} };
  const stillLow = applyIdentityConflictDemotion(alreadyLow, 'refused-identity-conflict');
  check(!stillLow.identityConflictDemoted,
    `already-LOW convergence is not spuriously flagged as demoted`);
}

// ── 5. buildIdentityRefusedFallbackPool — isolates to the real comps ─
console.log('\n── buildIdentityRefusedFallbackPool: real 17-item pool ──');
{
  // Reconstructed from the production [visual] titles list — 17 items
  // post category-gate (3 merch dropped from the raw 20). Prices are
  // representative: the 2 genuine Eternus comps at $150-ish (index 0
  // confirmed exactly from the log; index 1 not logged in full, given a
  // plausible neighboring price), Lobo/Conan/junk at typical low-$ active
  // listing noise that would otherwise drag the blended median to ~$7.
  const visualItems = [
    { rawTitle: 'Eternus #2 - NYCC Metal Virgin Variant Cover', price: 150.00 },       // idx 0 — real, logged
    { rawTitle: 'Eternus #2 - NYCC Virgin Variant Cover', price: 139.99 },              // idx 1 — Eternus family
    { rawTitle: 'Anime Video Game Darksiders Ii Gaming Mat Desk 10167', price: 12.99 }, // idx 2 — junk
    { rawTitle: 'Conan the Barbarian #9 FOC Deodato Virgin Titan 2024 NM+', price: 8.5 },
    { rawTitle: 'metaphysical Sila djinn male powerful brings wishes', price: 5.0 },
    { rawTitle: 'LOBO #1 COVER E LEE BERMEJO FOIL VARIANT DC NEXT LEVEL 2026', price: 9.99 },
    { rawTitle: '8x10 Horned Storm Sorcerer With Purple Lightning Art Print', price: 4.5 },
    { rawTitle: 'LOBO #1 - LEE BERMEJO COVER E FOIL VARIANT', price: 6.99 },
    { rawTitle: 'LOBO #1 CVR E BERMEJO FOIL VAR', price: 6.49 },
    { rawTitle: 'metaphysical ELITE MARID DJINN KING dark Egyptian', price: 5.5 },
    { rawTitle: 'LOBO #1 CVR E LEE BERMEJO FOIL VAR IN STOCK 2026', price: 7.25 },
    { rawTitle: 'metaphysical DARK IFRIT EFRIT DJINN JINN GENIE', price: 5.25 },
    { rawTitle: 'Conan The Barbarian #27 Cover E Doug Braithwaite Full Art', price: 9.0 },
    { rawTitle: 'LOBO #1 Cvr E Lee Bermejo FOIL SHIPS 3/18/26', price: 6.75 },
    { rawTitle: '8x10 Red moon warrior woman at standing stones', price: 4.25 },
    { rawTitle: 'Lobo #1 Cvr E Lee Bermejo Foil Virgin Var (Pre-Order)', price: 55.55 },
    { rawTitle: 'LOBO #1 LEE BERMEJO FOIL VAR 3/18/26 NM', price: 6.49 },
  ];

  const isolated = buildIdentityRefusedFallbackPool(visualItems, eternusFamilyCandidate);
  check(isolated.isolatedToFamily === true, 'isolates to the topFamily (2-member Eternus cluster)');
  check(isolated.fallbackPoolSize === 2, `pool size is exactly the 2 Eternus comps (got ${isolated.fallbackPoolSize})`);
  check(isolated.fallbackPrice >= 139 && isolated.fallbackPrice <= 150,
    `median reflects the real $140-150 comps, not a $7 blend (got $${isolated.fallbackPrice})`);
  check(isolated.familyTitle === 'eternus cover', `familyTitle surfaced for the UI label`);

  // Confirm the OLD behavior is what a naive full-pool blend would have
  // produced — proves the fix materially changes the number, not just labels.
  const naiveMedian = [...visualItems].map((i) => i.price).sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  check(pct(naiveMedian, 0.5) < 10,
    `sanity: the OLD unfiltered-pool median really was single-digit (was $${pct(naiveMedian, 0.5)}) — confirms the bug was real, not just theoretical`);
}

// ── 6. buildIdentityRefusedFallbackPool — guards / fallback behavior ─
console.log('\n── buildIdentityRefusedFallbackPool: guards ──');
{
  const genericPool = Array.from({ length: 8 }, (_, i) => ({ price: 5 + i }));

  check(buildIdentityRefusedFallbackPool(genericPool, null).isolatedToFamily === false,
    'no familyCandidate → falls back to raw-pool behavior (unaffected)');

  const singleMemberFamily = { topFamily: { title: 'x', indices: [0], count: 1 } };
  check(buildIdentityRefusedFallbackPool(genericPool, singleMemberFamily).isolatedToFamily === false,
    'single-index family (no corroboration) → falls back to raw pool');

  const thinIsolated = { topFamily: { title: 'x', indices: [0, 1], count: 2 } };
  const thinPool = [{ price: 20 }, { price: null }]; // 2nd has no usable price
  const thinResult = buildIdentityRefusedFallbackPool(thinPool, thinIsolated);
  check(thinResult.fallbackPrice === null,
    `isolated pool with <2 VALID prices produces no price, not a fabricated one (got ${JSON.stringify(thinResult)})`);

  // Raw-pool path still requires >=5 (unchanged pre-existing behavior)
  const tinyRawPool = [{ price: 5 }, { price: 6 }, { price: 7 }];
  check(buildIdentityRefusedFallbackPool(tinyRawPool, null).fallbackPrice === null,
    'raw-pool path still needs >=5 valid prices (pre-existing threshold, unchanged)');
}

// Real production comp titles (post category-gate, 17 of the 20 raw
// results) — same pool used in section 5 above, as rawTitle strings for
// checkAssemblyIntegrity's compTitles param.
const eternusRawPoolTitles = [
  'Eternus #2 - NYCC Metal Virgin Variant Cover',
  'Eternus #2 - NYCC Virgin Variant Cover',
  'Anime Video Game Darksiders Ii Gaming Mat Desk 10167',
  'Conan the Barbarian #9 FOC Deodato Virgin Titan 2024 NM+',
  'metaphysical Sila djinn male powerful brings wishes',
  'LOBO #1 COVER E LEE BERMEJO FOIL VARIANT DC NEXT LEVEL 2026',
  '8x10 Horned Storm Sorcerer With Purple Lightning Art Print',
  'LOBO #1 - LEE BERMEJO COVER E FOIL VARIANT',
  'LOBO #1 CVR E BERMEJO FOIL VAR',
  'metaphysical ELITE MARID DJINN KING dark Egyptian',
  'LOBO #1 CVR E LEE BERMEJO FOIL VAR IN STOCK 2026',
  'metaphysical DARK IFRIT EFRIT DJINN JINN GENIE',
  'Conan The Barbarian #27 Cover E Doug Braithwaite Full Art',
  'LOBO #1 Cvr E Lee Bermejo FOIL SHIPS 3/18/26',
  '8x10 Red moon warrior woman at standing stones',
  'Lobo #1 Cvr E Lee Bermejo Foil Virgin Var (Pre-Order)',
  'LOBO #1 LEE BERMEJO FOIL VAR 3/18/26 NM',
];

// ── 7. shouldSkipAssemblyIntegrityCheck — the exemption predicate ───
console.log('\n── shouldSkipAssemblyIntegrityCheck ──');
{
  check(shouldSkipAssemblyIntegrityCheck('refused-identity-conflict') === true,
    'refused-identity-conflict is skipped');
  check(shouldSkipAssemblyIntegrityCheck('fallback-vision') === false,
    'fallback-vision is NOT skipped (unrelated decision)');
  check(shouldSkipAssemblyIntegrityCheck('top-rank-protection') === false,
    'top-rank-protection is NOT skipped (normal path, must stay protected)');
  check(shouldSkipAssemblyIntegrityCheck('weighted-consensus') === false,
    'weighted-consensus is NOT skipped (normal path, must stay protected)');
  check(shouldSkipAssemblyIntegrityCheck(undefined) === false,
    'no familyCandidate (undefined decision) is NOT skipped');
}

// ── 8. The bug, proven at the function level (why the skip is needed) ──
console.log('\n── checkAssemblyIntegrity: the Eternus case WOULD revert without the skip ──');
{
  const provisionalTitle = 'Eternus #2 - NYCC Metal Virgin Variant';
  const result = checkAssemblyIntegrity(
    'He-Man and the Masters of the Universe',
    provisionalTitle,
    eternusRawPoolTitles
  );
  check(result.shouldFallback === true,
    `checkAssemblyIntegrity alone WOULD force Vision back (reason=${result.reason}) — ` +
    `confirms this is a real bug the enrich.js-level skip must prevent, not theoretical`);
}

// ── 9. Requirement #2 — 22e's original protected case still fires ───
console.log('\n── checkAssemblyIntegrity: Captain Marvel / X-Men Angel class UNCHANGED ──');
{
  // Classic 22e-LOSS case: Q54 protects ["x","men"] but assembly drops "x"
  // ("The X-Men #44 Angel" -> assembled "men timeless"). "x-men" IS
  // well-supported in the comp pool (unlike the Eternus case above, where
  // Vision's tokens have ZERO pool support) — this is exactly the class
  // 22e must keep reverting. Not touched by this fix (shouldSkipAssembly-
  // IntegrityCheck only exempts refused-identity-conflict; this scenario's
  // familyCandidate.decision would be 'top-rank-protection' or
  // 'weighted-consensus', never refused-identity-conflict).
  const xmenPoolTitles = [
    'X-Men #44 Angel NM', 'X-Men #44 Angel VF', 'X-Men #44 Angel FN',
    'X-Men #44 Angel GD', 'X-Men #44 Angel Marvel Comics',
  ];
  const xmenResult = checkAssemblyIntegrity('The X-Men #44 Angel', 'men timeless', xmenPoolTitles);
  check(xmenResult.shouldFallback === true,
    `X-Men #44 Angel compound-drop still correctly forces Vision back (reason=${xmenResult.reason})`);
  check(shouldSkipAssemblyIntegrityCheck('top-rank-protection') === false,
    'this class runs under a decision the exemption never touches — confirmed not skipped');

  // Spider-Versity class (the carve-out's OWN original purpose): Vision's
  // token has ZERO pool support AND the assembled title IS pool-corroborated
  // (>=60%) — must still correctly DEFER to the pool, not force Vision.
  // Confirms the exemption didn't accidentally break the carve-out itself.
  const spiderPool = [
    'Spider-Verse Team-Up #1 NM', 'Spider-Verse Team-Up #1 VF',
    'Spider-Verse Team-Up #1 FN', 'Spider-Verse Team-Up #1 Marvel',
  ];
  const spiderResult = checkAssemblyIntegrity('Spider-Versity', 'Spider-Verse Team-Up', spiderPool);
  check(spiderResult.shouldFallback === false,
    `zero-support defer (Spider-Versity class) still works unmodified (reason=${spiderResult.reason || 'intact'})`);
}

// ── 10. Requirement #3 — thin/no topFamily case is a true no-op ─────
console.log('\n── thin/no topFamily: exemption changes nothing ──');
{
  // When Fix 1's count>=2 guard doesn't fire, resolveIdentity leaves
  // confirmedTitle === vision.title. checkAssemblyIntegrity on identical
  // vision/assembled strings has nothing to revert either way.
  const sameTitle = 'He-Man and the Masters of the Universe';
  const withoutSkip = checkAssemblyIntegrity(sameTitle, sameTitle, eternusRawPoolTitles);
  check(withoutSkip.shouldFallback === false,
    `identical vision/assembled title is already intact regardless of the skip (reason=${withoutSkip.reason || 'intact'})`);
  check(shouldSkipAssemblyIntegrityCheck('refused-identity-conflict') === true,
    'skip WOULD still apply for this decision, but changes nothing observable — true no-op confirmed');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
