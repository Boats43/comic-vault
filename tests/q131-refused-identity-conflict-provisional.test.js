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
// Invoke: node tests/q131-refused-identity-conflict-provisional.test.js

import { resolveIdentity, buildIdentityRefusedFallbackPool } from '../src/lib/identityCore.js';
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

const visionGuess = { title: 'He-Man and the Masters of the Universe', issue: '1', year: null, publisher: null };

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

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
