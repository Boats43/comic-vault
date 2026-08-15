// tests/grailkey-directive-ah-sold-fallback-authority.test.js
//
// GrailKey Directive AH — GK-111, third false-READY.
//
// Production shape (2026-08-15 00:33, build f52c92f), tier-2 blend, not
// GK-96's tier-4 or GK-101's tier-3-active: the operator's actual book
// ("...NYCC Foil LTD 50 By Dan Parent...", $24.99, SOLD) was rejected as a
// variantMismatch by src/lib/soldVerification.js's own variant fallback,
// then silently RESTORED (variantVerified:false) and blended against a
// DIFFERENT book's single active ask ("...Pink Lava Foil...LTD 5",
// $109.95) that matched only on the shared tokens "Dan Parent NYCC" —
// reaching marketStanding=EXACT_CURRENT / actionAuthority=READY / a live
// $65.88 List button.
//
// Two independent, additive fixes (never touching pricing math, C2):
//
// (2a) The sold-path variant fallback was never stamped anywhere
// out.variantApplicability (AB/GK-101) could see — a second, independent
// "measuring coherence against the wrong population" site, sold-verify's
// sibling to Filter 1c on the active side. src/lib/priceBands.js now
// computes soldPoolFallbackConsumed (scoped to whether THIS tier's own
// `market` value actually folded a variant-fallback sold pool in, never a
// global "a fallback exists somewhere" rule — Fixture 3b is the required
// proof this scoping is real) and api/enrich.js folds it into the SAME
// variantApplicability field AB already wired into deriveMarketStanding —
// zero changes to that function. A new out.variantApplicabilitySoldFallback
// own-property distinguishes which of the two independent mechanisms fired,
// for reason-code precision only (src/lib/responseContract.js).
//
// (2b) marketStanding=EXACT_CURRENT carries no pool-size floor at all —
// deliberately left alone (a real N=1 exact/current comp IS exact and
// current; demoting the LABEL to force a lock would make it dishonest).
// A new, tier-independent 'single-comp-pool' soft lock
// (src/lib/responseContract.js) gates actionAuthority separately whenever
// an EXACT_CURRENT-standing price is backed by fewer than 2 total comps —
// deliberately NOT keyed to matchConfidence.tier the way the pre-existing
// low-tier-thin-pool lock is (that one requires tier==='LOW' AND
// totalComps<3; this dispatch's own production case scored LOW at
// totalComps===3 exactly, one comp above that lock's own floor, and a
// MEDIUM/HIGH-confidence book with the same thin pool would clear it
// untouched — the same tier-dependency shape GK-96 already named).
//
// Server boundary (1f): tracing api/list-ebay.js's synthetic re-derivation
// found variantApplicability was NEVER actually included in the single-item
// listing request body (src/App.jsx) despite the server already reading
// `item.variantApplicability` since Directive Z/AB shipped — every listing
// request has silently sent undefined for it. Fixed alongside this
// dispatch's own new field (same raw-evidence-field convention, never a
// client-computed verdict) — without this, Fixture 7 could not pass at all
// regardless of any other change here.
//
// GK-112 (matcher looseness — logged, NOT fixed here, C6): the active-side
// variant match that let the Pink Lava comp in was `orMatch(['nycc'])` —
// classifyVariantTokens never recognized "Dan"/"Parent" as registry tokens
// at all (not a variant-taxonomy concept, a creator name), so the ENTIRE
// match reduced to bare substring "nycc" ⊂ title — print-run tokens
// ("LTD 5"/"LTD 50") and finish tokens are absent from the registry this
// matcher consults, structurally unable to distinguish loose from strict.
//
// Invoke: node tests/grailkey-directive-ah-sold-fallback-authority.test.js

import { verifySoldComps } from '../src/lib/soldVerification.js';
import { computePriceBands, TIER_SOURCE_MAP } from '../src/lib/priceBands.js';
import { deriveMarketStanding, deriveIdentityStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';

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

console.log('\n=== GrailKey Directive AH — sold-path applicability + sufficiency floor (GK-111) ===\n');

// Reusable: the exact api/enrich.js glue between computePriceBandsFromSold's
// output and out.variantApplicability (api/enrich.js, the
// "out.variantApplicability = soldFallbackConsumed ? 'UNVERIFIED' : ..."
// block added by this dispatch) — MIRRORED, since that block is inline
// handler code, not an exported function. Reproduced byte-faithful to the
// real source rather than paraphrased.
const applyEnrichGlue = (out, priceBandsRaw, activeVariantApplicability) => {
  const soldFallbackConsumed = priceBandsRaw?.soldPoolFallbackConsumed === true;
  out.variantApplicability = soldFallbackConsumed ? 'UNVERIFIED' : (activeVariantApplicability ?? null);
  out.variantApplicabilitySoldFallback = soldFallbackConsumed;
  out.pricingSource = TIER_SOURCE_MAP[priceBandsRaw.source] || 'pc_estimate';
};

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — the exact production shape. SHIP-BLOCKING.
//
// PROVENANCE:
//   DIRECT   — verifySoldComps, computePriceBands, deriveLocks,
//              deriveActionAuthority are all real exported functions,
//              called with real inputs, in the real order api/enrich.js
//              calls them.
//   MIRRORED — applyEnrichGlue above (api/enrich.js's own inline
//              variantApplicability-folding block, not independently
//              invocable) and the synthetic `out` shape's non-pricing
//              fields (matchConfidence/decision), which in production are
//              assembled from many upstream steps this fixture does not
//              re-run — stated plainly, not labeled DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: Sabrina production shape — PRE-AH READY, POST-AH REVIEW\n');
{
  const soldRows = [
    { price: 24.99, title: 'Sabrina Annual Spectacular #1 2024 NM Archie', daysAgo: 5, grade: '9.8', year: '2024' },
    { price: 21.50, title: 'Sabrina Annual Spectacular #1 2024 NM Archie', daysAgo: 12, grade: '9.8', year: '2024' },
  ];
  // Real confirmedVariant text differs slightly from production's literal
  // "Dan Parent NYCC variant" (adds "Foil" so src/lib/soldVerification.js's
  // OWN axis-based token registry — a taxonomy independent from
  // classifyVariantTokens, see GK-112 note above — actually registers a
  // token to mismatch on; confirmed by direct execution that the literal
  // production string produces zero variantMismatch signal against
  // generic-titled comps in this registry, a separate drifted-taxonomy
  // observation, not chased here per C6) — the MECHANISM under test
  // (sold-fallback re-admits wrong-edition rows, tagged variantVerified:
  // false, consumed into a blend) is unchanged and reproduces the real
  // defect precisely.
  const confirmedVariant = 'Dan Parent NYCC Foil variant';
  const soldVerifyResult = verifySoldComps(soldRows, {
    title: 'Sabrina Annual Spectacular', issue: '1', variant: confirmedVariant, bookYear: '2024', userGradeKey: '9.8',
  });
  assertTrue(soldVerifyResult.variantAdjusted, 'DIRECT: verifySoldComps fallback fired (variantAdjusted=true)');
  assertEq(soldVerifyResult.verified.length, 2, 'DIRECT: fallback re-admits both sold rows');
  assertTrue(soldVerifyResult.verified.every((r) => r.variantVerified === false), 'DIRECT: every re-admitted row tagged variantVerified:false');

  // The active pool: a DIFFERENT book (Pink Lava Foil LTD 5) that matched
  // only on shared tokens — this fixture does not re-run api/comps.js's
  // Filter 1c itself (out of scope, C6/GK-112); it supplies the pool
  // Filter 1c is already known (production log, this dispatch's own trace)
  // to have returned, with matched:true (wrongly).
  const activeComps = {
    count: 1,
    prices: [{ price: 109.95, title: 'Sabrina Annual Spectacular #1 Dan Parent NYCC Pink Lava Foil Variant LTD 5' }],
  };

  const priceBandsRaw = computePriceBands({
    soldComps: soldVerifyResult.verified, activeComps, pcBase: null, gradeMultiplier: 1,
    title: 'Sabrina Annual Spectacular', issue: '1', year: '2024', variant: confirmedVariant,
    variantAdjusted: soldVerifyResult.variantAdjusted || false, soldVerifyResult,
  });
  assertEq(priceBandsRaw.tier, 2, 'DIRECT: computePriceBands lands on tier 2 (matches production trace)');
  assertEq(TIER_SOURCE_MAP[priceBandsRaw.source], 'sold_active_blend_30', 'DIRECT: mapped pricingSource is sold_active_blend_30 (matches production)');
  assertTrue(priceBandsRaw.soldPoolFallbackConsumed, 'DIRECT: soldPoolFallbackConsumed=true — the fallback pool genuinely fed this market value');

  const out = {
    rawComps: { count: 1, variantApplicability: 'CONFIRMED' }, // Filter 1c's own (wrong) verdict — matched:true on bare "nycc"
    soldComps: soldVerifyResult.verified,
    matchConfidence: { tier: 'LOW', score: 59 },
    decision: { action: 'LIST_LOW', blockers: [] },
  };
  applyEnrichGlue(out, priceBandsRaw, out.rawComps.variantApplicability);

  assertEq(out.pricingSource, 'sold_active_blend_30', 'MIRRORED (enrich glue): out.pricingSource set');
  assertEq(out.variantApplicability, 'UNVERIFIED', 'MIRRORED (enrich glue): sold-fallback consumption floors variantApplicability, overriding the active side\'s wrong CONFIRMED');
  assertTrue(out.variantApplicabilitySoldFallback, 'MIRRORED (enrich glue): variantApplicabilitySoldFallback=true — sold-side is the cause');

  // PRE-AH: reproduce the OLD behavior — variantApplicability sourced from
  // the active side alone (AB's original, un-extended line), no sold-fallback
  // awareness, no sufficiency floor.
  const preAhOut = { ...out, variantApplicability: out.rawComps.variantApplicability };
  const preAhMarketStanding = deriveMarketStanding(preAhOut);
  assertEq(preAhMarketStanding, 'EXACT_CURRENT', 'PRE-AH BUG: marketStanding reads EXACT_CURRENT (active side alone said CONFIRMED)');
  const preAhLocks = []; // low-tier-thin-pool requires totalComps<3; here totalComps===3 (2 sold + 1 active) — does NOT fire, confirmed below
  const preAhTotalComps = (preAhOut.soldComps?.length || 0) + (preAhOut.rawComps?.count || 0);
  assertEq(preAhTotalComps, 3, 'confirmed root cause precondition: totalComps===3, one above the EXISTING low-tier-thin-pool <3 floor — that lock structurally cannot catch this shape');
  const preAhAuthority = deriveActionAuthority(preAhOut, preAhLocks, preAhOut.decision);
  assertEq(preAhAuthority.state, 'READY', 'PRE-AH BUG, reproduced: actionAuthority.state=READY — the exact defect this dispatch fixes');

  // POST-AH: the real, currently-shipped deriveLocks/deriveActionAuthority,
  // fed the real (post-fix) out.variantApplicability/variantApplicabilitySoldFallback.
  const postAhLocks = deriveLocks(out);
  const postAhAuthority = deriveActionAuthority(out, postAhLocks, out.decision);
  assertEq(deriveMarketStanding(out), 'SIMILAR_ONLY', 'POST-AH: marketStanding demoted to SIMILAR_ONLY');
  assertTrue(postAhLocks.some((l) => l.code === 'market-standing-sold-variant-fallback'), 'POST-AH: SOLD_VARIANT_FALLBACK_POOL lock present');
  assertEq(postAhAuthority.state, 'REVIEW', 'POST-AH: actionAuthority.state=REVIEW');
  assertTrue(postAhAuthority.reasonCodes.includes('SOLD_VARIANT_FALLBACK_POOL'), 'POST-AH: reasonCodes include SOLD_VARIANT_FALLBACK_POOL');
  console.log(`  RESOLVED AUTHORITY: state=${postAhAuthority.state} reasonCodes=[${postAhAuthority.reasonCodes.join(',')}]`);
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — sufficiency floor, isolated. A clean, non-fallback, single
// real sold comp — no variant confirmed at all, so applicability is a
// structural no-op here; only the sufficiency floor is under test.
// DIRECT (real functions, real single-comp shape verified to actually
// reach EXACT_CURRENT via 'verified_sold').
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: sufficiency floor isolated — marketStanding stays EXACT_CURRENT (honest label)\n');
{
  const soldRows = [{ price: 40, title: 'Ordinary Comic #1 2024 CGC 9.8 White Pages', daysAgo: 5, grade: '9.8', year: '2024' }];
  const soldVerifyResult = verifySoldComps(soldRows, { title: 'Ordinary Comic', issue: '1', variant: null, bookYear: '2024', userGradeKey: '9.8' });
  assertTrue(!soldVerifyResult.variantAdjusted, 'DIRECT: no fallback fired (clean pool)');

  const priceBandsRaw = computePriceBands({
    soldComps: soldVerifyResult.verified, activeComps: { count: 0, prices: [] }, pcBase: null, gradeMultiplier: 1,
    title: 'Ordinary Comic', issue: '1', year: '2024', variant: null,
    variantAdjusted: false, soldVerifyResult,
  });
  assertEq(TIER_SOURCE_MAP[priceBandsRaw.source], 'verified_sold', 'DIRECT: single real fresh sold row reaches verified_sold (EXACT_CURRENT-eligible)');
  assertEq(priceBandsRaw.soldPoolFallbackConsumed, false, 'DIRECT: soldPoolFallbackConsumed=false (no fallback exists in this fixture)');

  const out = { rawComps: { count: 0, variantApplicability: null }, soldComps: soldVerifyResult.verified, matchConfidence: { tier: 'HIGH', score: 90 }, decision: { action: 'LIST_NOW', blockers: [] } };
  applyEnrichGlue(out, priceBandsRaw, out.rawComps.variantApplicability);

  const marketStanding = deriveMarketStanding(out);
  assertEq(marketStanding, 'EXACT_CURRENT', 'marketStanding stays EXACT_CURRENT — the label is honest, not corrupted to force a lock (C1/2b requirement)');

  const locks = deriveLocks(out);
  assertTrue(locks.some((l) => l.code === 'single-comp-pool'), 'single-comp-pool lock present (totalComps=1 < 2)');
  const authority = deriveActionAuthority(out, locks, out.decision);
  assertEq(authority.state, 'REVIEW', 'actionAuthority.state=REVIEW — sufficiency gates READY without corrupting the applicability label');
  assertTrue(authority.reasonCodes.includes('SINGLE_COMP_POOL'), 'reasonCodes include SINGLE_COMP_POOL');
  assertTrue(!authority.reasonCodes.includes('VARIANT_UNMATCHED_POOL') && !authority.reasonCodes.includes('SOLD_VARIANT_FALLBACK_POOL'), 'no applicability reason code fires — this is purely a sufficiency case');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — fallback demotion, isolated. Many comps (sold fallback pool
// n=5, consumed; active n=2) — proves 2a stands alone, independent of 2b's
// sufficiency floor (totalComps=7, comfortably clears it).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: fallback demotion isolated from the sufficiency floor\n');
{
  const soldRows = Array.from({ length: 5 }, (_, i) => ({
    price: 25 + i, title: `Generic Comic #1 2024 grade sale ${i}`, daysAgo: 5 + i, grade: '9.8', year: '2024',
  }));
  const soldVerifyResult = verifySoldComps(soldRows, { title: 'Generic Comic', issue: '1', variant: 'Foil variant', bookYear: '2024', userGradeKey: '9.8' });
  assertTrue(soldVerifyResult.variantAdjusted, 'DIRECT: fallback fired');
  assertEq(soldVerifyResult.verified.length, 5, 'DIRECT: all 5 rows re-admitted by fallback');

  const activeComps = { count: 2, prices: [{ price: 30, title: 'Generic Comic #1 Foil active ask A' }, { price: 32, title: 'Generic Comic #1 Foil active ask B' }] };
  const priceBandsRaw = computePriceBands({
    soldComps: soldVerifyResult.verified, activeComps, pcBase: null, gradeMultiplier: 1,
    title: 'Generic Comic', issue: '1', year: '2024', variant: 'Foil variant',
    variantAdjusted: soldVerifyResult.variantAdjusted || false, soldVerifyResult,
  });
  assertTrue(priceBandsRaw.soldPoolFallbackConsumed, 'DIRECT: soldPoolFallbackConsumed=true (blend, many-comp pool)');

  const out = { rawComps: { count: 2, variantApplicability: 'CONFIRMED' }, soldComps: soldVerifyResult.verified, matchConfidence: { tier: 'HIGH', score: 90 }, decision: { action: 'LIST_NOW', blockers: [] } };
  applyEnrichGlue(out, priceBandsRaw, out.rawComps.variantApplicability);
  const totalComps = (out.soldComps?.length || 0) + (out.rawComps?.count || 0);
  assertEq(totalComps, 7, 'sufficiency floor is comfortably cleared — this fixture isolates 2a from 2b');

  const locks = deriveLocks(out);
  assertTrue(locks.some((l) => l.code === 'market-standing-sold-variant-fallback'), 'SOLD_VARIANT_FALLBACK_POOL lock fires despite a large, otherwise-healthy pool');
  assertTrue(!locks.some((l) => l.code === 'single-comp-pool'), 'single-comp-pool does NOT fire — 2a and 2b are independent locks, not one lock tested twice');
  const authority = deriveActionAuthority(out, locks, out.decision);
  assertEq(authority.state, 'REVIEW', 'actionAuthority.state=REVIEW via the applicability axis alone');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3b — negative control: unconsumed fallback must NOT fire.
// SHIP-BLOCKING for the scoping claim in 2a. A fallback pool EXISTS
// (variantAdjusted=true) but this tier's `market` never used it
// (soldPoolTooThinToOverride — sold demoted to reference, active anchors).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3b: fallback exists but UNCONSUMED — must not demote (scoping proof for 2a)\n');
{
  const soldRows = [{ price: 200, title: 'Generic Comic #1 2024 grade sale', daysAgo: 5, grade: '9.8', year: '2024' }];
  const soldVerifyResult = verifySoldComps(soldRows, { title: 'Generic Comic', issue: '1', variant: 'Foil variant', bookYear: '2024', userGradeKey: '9.8' });
  assertTrue(soldVerifyResult.variantAdjusted, 'DIRECT: fallback pool EXISTS (variantAdjusted=true)');

  const activeComps = { count: 3, prices: [
    { price: 9, title: 'Generic Comic #1 active ask A' },
    { price: 10, title: 'Generic Comic #1 active ask B' },
    { price: 11, title: 'Generic Comic #1 active ask C' },
  ] };
  const priceBandsRaw = computePriceBands({
    soldComps: soldVerifyResult.verified, activeComps, pcBase: null, gradeMultiplier: 1,
    title: 'Generic Comic', issue: '1', year: '2024', variant: 'Foil variant',
    variantAdjusted: soldVerifyResult.variantAdjusted || false, soldVerifyResult,
  });
  assertTrue(priceBandsRaw.soldPoolTreatedAsReference, 'DIRECT: sold pool demoted to reference (GK-34, soldPoolTooThinToOverride) — I13: still shown, never used as pricing evidence');
  assertEq(priceBandsRaw.soldPoolFallbackConsumed, false, 'DIRECT: soldPoolFallbackConsumed=false — the fallback pool exists but this tier\'s market did NOT use it (active-dominant discount instead)');

  const out = { rawComps: { count: 3, variantApplicability: 'CONFIRMED' }, soldComps: soldVerifyResult.verified, matchConfidence: { tier: 'HIGH', score: 90 }, decision: { action: 'LIST_NOW', blockers: [] } };
  applyEnrichGlue(out, priceBandsRaw, out.rawComps.variantApplicability);

  assertEq(out.variantApplicability, 'CONFIRMED', 'variantApplicability is NOT demoted — the global "a fallback exists anywhere" rule this dispatch explicitly rejects would have fired here and did not');
  assertTrue(!out.variantApplicabilitySoldFallback, 'variantApplicabilitySoldFallback=false');
  const locks = deriveLocks(out);
  assertTrue(!locks.some((l) => l.code === 'market-standing-sold-variant-fallback'), 'SOLD_VARIANT_FALLBACK_POOL does NOT fire — scoping to consumption confirmed, not merely existence');
  const authority = deriveActionAuthority(out, locks, out.decision);
  assertEq(authority.state, 'READY', 'actionAuthority.state=READY — an unconsumed fallback must not poison an otherwise-clean, sufficient, applicable pool');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — monotonicity, all four required routes.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: monotonicity\n');
{
  const baseOut = {
    rawComps: { count: 3, variantApplicability: 'CONFIRMED' },
    soldComps: [{}, {}],
    variantApplicability: 'CONFIRMED',
    variantApplicabilitySoldFallback: false,
    pricingSource: 'sold_active_blend_30',
    matchConfidence: { tier: 'HIGH', score: 90 },
    decision: { action: 'LIST_NOW', blockers: [] },
  };
  const baseLocks = deriveLocks(baseOut);
  const baseAuthority = deriveActionAuthority(baseOut, baseLocks, baseOut.decision);
  assertEq(baseAuthority.state, 'READY', 'baseline: clean, sufficient, applicable pool reaches READY');

  // 4a — raise grade. Neither deriveMarketStanding, deriveIdentityStanding,
  // nor deriveLocks/deriveActionAuthority read grade/numericGrade at all
  // (grep-confirmed: zero references in src/lib/actionAuthority.js) —
  // authority CANNOT rise (or fall) from a grade change because no channel
  // exists for grade to reach this axis at all, the strongest possible
  // form of "cannot rise."
  const gradeRaised = { ...baseOut, grade: '9.8', numericGrade: 9.8 };
  const gradeLocks = deriveLocks(gradeRaised);
  const gradeAuthority = deriveActionAuthority(gradeRaised, gradeLocks, gradeRaised.decision);
  assertEq(gradeAuthority.state, baseAuthority.state, '4a: raising grade — authority unchanged (grade is not an input to this axis at all)');

  // 4b — raise price/blend value. Same reasoning: price magnitude is not
  // read by deriveMarketStanding/deriveActionAuthority at all.
  const priceRaised = { ...baseOut, price: '$999.00' };
  const priceLocks = deriveLocks(priceRaised);
  const priceAuthority = deriveActionAuthority(priceRaised, priceLocks, priceRaised.decision);
  assertEq(priceAuthority.state, baseAuthority.state, '4b: raising price — authority unchanged (price is not an input to this axis at all)');

  // 4c — add a negative applicability signal. Authority may only STAY or FALL.
  const negativeAdded = { ...baseOut, variantApplicability: 'UNVERIFIED', variantApplicabilitySoldFallback: true };
  const negativeLocks = deriveLocks(negativeAdded);
  const negativeAuthority = deriveActionAuthority(negativeAdded, negativeLocks, negativeAdded.decision);
  assertTrue(negativeAuthority.state !== 'READY', '4c: adding a negative applicability signal — authority FELL (READY → ' + negativeAuthority.state + '), never rose');

  // 4d — the upward route: from Fixture 1's REVIEW shape, a clean
  // variant-matched pool above the sufficiency floor with no consumed
  // fallback DOES reach READY. This is the demonstrated route upward —
  // without it this would be a wall, not a boundary.
  const upwardInput = { ...negativeAdded, variantApplicability: 'CONFIRMED', variantApplicabilitySoldFallback: false };
  const upwardLocks = deriveLocks(upwardInput);
  const upwardAuthority = deriveActionAuthority(upwardInput, upwardLocks, upwardInput.decision);
  assertEq(upwardAuthority.state, 'READY', '4d: clearing the negative signal (variant re-confirmed, no consumed fallback) — authority ROSE to READY');
  console.log('  UPWARD ROUTE: variantApplicability UNVERIFIED->CONFIRMED, variantApplicabilitySoldFallback true->false');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 5 — no over-fire. An ordinary healthy book still reaches
// EXACT_CURRENT and READY normally.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 5: no over-fire on an ordinary healthy book\n');
{
  const soldRows = Array.from({ length: 5 }, (_, i) => ({ price: 40 + i, title: `Healthy Comic #1 2024 CGC 9.8 White Pages ${i}`, daysAgo: 5 + i, grade: '9.8', year: '2024' }));
  const soldVerifyResult = verifySoldComps(soldRows, { title: 'Healthy Comic', issue: '1', variant: null, bookYear: '2024', userGradeKey: '9.8' });
  assertTrue(!soldVerifyResult.variantAdjusted, 'DIRECT: no fallback (clean pool)');
  const activeComps = { count: 3, prices: [{ price: 45, title: 'Healthy Comic #1 A' }, { price: 46, title: 'Healthy Comic #1 B' }, { price: 47, title: 'Healthy Comic #1 C' }] };
  const priceBandsRaw = computePriceBands({
    soldComps: soldVerifyResult.verified, activeComps, pcBase: null, gradeMultiplier: 1,
    title: 'Healthy Comic', issue: '1', year: '2024', variant: null, variantAdjusted: false, soldVerifyResult,
  });
  const out = { rawComps: { count: 3, variantApplicability: null }, soldComps: soldVerifyResult.verified, matchConfidence: { tier: 'HIGH', score: 92 }, decision: { action: 'LIST_NOW', blockers: [] } };
  applyEnrichGlue(out, priceBandsRaw, out.rawComps.variantApplicability);
  assertEq(deriveMarketStanding(out), 'EXACT_CURRENT', 'marketStanding=EXACT_CURRENT (healthy pool, no variant to check)');
  const locks = deriveLocks(out);
  assertEq(locks.length, 0, 'zero locks — no over-fire from either 2a or 2b');
  const authority = deriveActionAuthority(out, locks, out.decision);
  assertEq(authority.state, 'READY', 'actionAuthority.state=READY');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 6 — AB's active-path lock unregressed, and correctly
// discriminated from this dispatch's new sold-path lock.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 6: AB active-path applicability lock unregressed\n');
{
  // Active-side unverified (Filter 1c fell back), sold side never fired a
  // fallback at all — variantApplicabilitySoldFallback absent (undefined),
  // matching every pre-AH catalogue item/response shape exactly.
  const out = { rawComps: { count: 4, variantApplicability: 'UNVERIFIED' }, soldComps: [], variantApplicability: 'UNVERIFIED', pricingSource: 'sold_active_blend_30', matchConfidence: { tier: 'HIGH', score: 85 }, decision: { action: 'LIST_LOW', blockers: [] } };
  assertEq(deriveMarketStanding(out), 'SIMILAR_ONLY', 'AB\'s floor still fires (unchanged, zero changes to deriveMarketStanding for this axis)');
  const locks = deriveLocks(out);
  assertTrue(locks.some((l) => l.code === 'market-standing-variant-unmatched'), 'the ORIGINAL market-standing-variant-unmatched lock fires (not the new sold-fallback one)');
  assertTrue(!locks.some((l) => l.code === 'market-standing-sold-variant-fallback'), 'the NEW sold-fallback lock does NOT fire — correctly discriminated, out.variantApplicabilitySoldFallback is absent/falsy');
  const authority = deriveActionAuthority(out, locks, out.decision);
  assertTrue(authority.reasonCodes.includes('VARIANT_UNMATCHED_POOL'), 'reasonCodes include the ORIGINAL VARIANT_UNMATCHED_POOL code, unchanged');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 7 — the server listing boundary. SHIP-BLOCKING.
//
// PROVENANCE: DIRECT for deriveLocks/deriveActionAuthority (the real
// exported functions api/list-ebay.js imports and calls). MIRRORED for
// syntheticOut's construction (api/list-ebay.js:791-817, inline handler
// code, not an exported function — reproduced byte-faithful to the real
// source, including this dispatch's own variantApplicability/
// variantApplicabilitySoldFallback additions there).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 7: server independently re-derives non-READY for the Sabrina evidence shape\n');
{
  // The REQUEST — includes a forged/stale client-sent actionAuthority
  // (never read by the server, C3/GK-103's existing verdict-forgery
  // protection) and, per this dispatch's own finding, the client's
  // variantApplicability/variantApplicabilitySoldFallback fields THIS
  // dispatch newly added to the request body (src/App.jsx) — proving the
  // "normal Sabrina evidence shape" (not a hand-forged one) genuinely
  // reaches and is denied by the server.
  const item = {
    decision: { action: 'LIST_LOW', blockers: [] },
    pricingSource: 'sold_active_blend_30',
    matchConfidence: { tier: 'LOW', score: 59 },
    rawComps: { count: 1 },
    soldComps: 2, // client sends a bare count, not the array — see api/list-ebay.js:805-810
    variantApplicability: 'UNVERIFIED',
    variantApplicabilitySoldFallback: true,
    identityConfident: true,
    refusedToPrice: false,
    manualReviewRequired: false,
    gradeExceedsMap: false,
    claudeCheckBlocker: null,
    tier0Locked: false,
    actionAuthority: { state: 'READY' }, // forged/stale — must have zero effect
    priorLockCodes: [],
  };

  // MIRRORED: api/list-ebay.js:791-817's syntheticOut construction,
  // reproduced field-for-field against the real, currently-committed source.
  const syntheticOut = {
    decision: item.decision || null,
    pricingSource: item.pricingSource || null,
    matchConfidence: item.matchConfidence || null,
    rawComps: item.rawComps || null,
    variantApplicability: item.variantApplicability || null,
    variantApplicabilitySoldFallback: item.variantApplicabilitySoldFallback === true,
    soldComps: new Array(typeof item.soldComps === 'number' ? item.soldComps : 0).fill({}),
    identityConfident: item.identityConfident,
    refusedToPrice: item.refusedToPrice === true,
    manualReviewRequired: item.manualReviewRequired === true,
    gradeExceedsMap: item.gradeExceedsMap === true,
    claudeCheckBlocker: item.claudeCheckBlocker || null,
    tier0Locked: item.tier0Locked === true,
  };

  // DIRECT — the real functions, exactly as api/list-ebay.js:818-821 calls them.
  const freshLocks = deriveLocks(syntheticOut);
  const priorLockCodes = Array.isArray(item.priorLockCodes) ? item.priorLockCodes : [];
  const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
  const serverReady = authority.state === 'READY' && priorLockCodes.length === 0;

  assertTrue(!serverReady, 'server independently denies READY for the real Sabrina evidence shape');
  assertTrue(freshLocks.some((l) => l.code === 'market-standing-sold-variant-fallback'), 'server-side freshLocks include market-standing-sold-variant-fallback');
  assertEq(authority.state, 'REVIEW', 'server-derived authority.state=REVIEW (would 403 ACTION_AUTHORITY_NOT_READY without a valid Q41 ack, per api/list-ebay.js:823-839)');
  console.log(`  SERVER VERDICT: state=${authority.state} would403=${!serverReady} (client-forged actionAuthority.state=READY had zero effect)`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
