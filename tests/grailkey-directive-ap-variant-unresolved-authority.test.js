// tests/grailkey-directive-ap-variant-unresolved-authority.test.js
//
// GrailKey Directive 2026-08-16-AP — GK-124, fourth false-READY.
//
// cleared / unknown variant != base edition.
//
// Production shape (2026-08-16 20:23, build ab9e1c6): Amazing Spider-Man #1,
// Dell'Otto virgin variant, CGC SS 9.6. Vision's own "virgin variant" claim
// was CLEARED by reconcileVariantFacet (src/lib/identityCore.js) for lack of
// corroboration — authority=NONE, conflicts=[{source:'vision', value:
// "virgin variant"}] (F-3, GrailKey Directive AM). That clear was correct.
// What was NOT correct: downstream, a cleared (authority=NONE) variant and a
// NEVER-CLAIMED variant both collapsed to the same `out.variantApplicability
// === null` value at the custody site (api/enrich.js), so
// deriveMarketStanding (src/lib/actionAuthority.js) read the null as "plain
// base edition" and granted EXACT_CURRENT to a 4-comp active pool (Kith
// variant / a variant LOT / Crain SS / base-edition — zero Dell'Otto comps)
// — actionAuthority READY, List button live.
//
// Sibling to two shipped locks, not a regression of either: AB/GK-101 fires
// on confirmedVariant PRESENT + zero pool match (out.variantApplicability
// ==='UNVERIFIED'); AH/GK-111 fires on a consumed sold-variant fallback.
// Both require a confirmed variant to exist — clearing it walks under both.
//
// Fix (revocation only, C1; no pricing math, C2; reconciler/F-3 untouched,
// C3; single writer through Z's existing state machine, C6):
//
//   (2a) custody — api/enrich.js:8602-8626 reads the ALREADY-WRITTEN
//   out.variantReconciliation (unconditional since the reconciler ran,
//   AM/F-3) and, when authority==='NONE' with a recorded conflict, sets
//   out.variantApplicability = 'UNRESOLVED' instead of leaving it null.
//   Never re-scans evidence — pure custody of a value already computed at
//   the ONE place the clear happens.
//
//   (2b) gate — src/lib/actionAuthority.js's deriveMarketStanding floors
//   'UNRESOLVED' to SIMILAR_ONLY, identical floor to AB's 'UNVERIFIED'
//   branch immediately above it, same principle, new reason code
//   (VARIANT_UNRESOLVED_EDITION, src/lib/responseContract.js) so the soft
//   lock is explicable. READY already requires marketStanding===
//   EXACT_CURRENT, so authority falls to REVIEW through the EXISTING state
//   machine — no parallel denial path.
//
// Invoke: node tests/grailkey-directive-ap-variant-unresolved-authority.test.js

import { reconcileVariantFacet } from '../src/lib/identityCore.js';
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

// MIRRORED — this is api/enrich.js:8602-8626's own custody expression,
// verbatim in shape (not independently invocable: it is inline in the
// request handler, not exported). Feeding it a REAL out.variantReconciliation
// produced by the REAL reconcileVariantFacet (below) keeps the hard part —
// evidence generation — DIRECT; only this trivial boolean-to-string mapping
// is reproduced rather than invoked.
const computeVariantApplicability = (out, { soldFallbackConsumed = false, rawVariantApplicability = null } = {}) => {
  const variantWasClearedWithEvidence = out.variantReconciliation?.authority === 'NONE'
    && Array.isArray(out.variantReconciliation?.conflicts)
    && out.variantReconciliation.conflicts.length > 0;
  return soldFallbackConsumed ? 'UNVERIFIED' : (rawVariantApplicability ?? (variantWasClearedWithEvidence ? 'UNRESOLVED' : null));
};

const run = (label, out) => {
  const locks = deriveLocks(out);
  const identityStanding = deriveIdentityStanding(out);
  const marketStanding = deriveMarketStanding(out);
  const authority = deriveActionAuthority(out, locks, out.decision);
  console.log(`  --- ${label} --- marketStanding=${marketStanding} identityStanding=${identityStanding} authority.state=${authority.state} reasonCodes=${JSON.stringify(authority.reasonCodes)}`);
  return { locks, identityStanding, marketStanding, authority };
};

console.log('\n=== B1: production shape (Dell\'Otto ASM #1 SS 9.6) — SHIP-BLOCKING ===');
{
  // DIRECT — real reconcileVariantFacet, fed the real production pool
  // shape: Vision's bare claim, and a first-eligible-visual row that names
  // NEITHER a registered creator nor a specific-axis token matching
  // "virgin variant" (the real pool's rank-1-ish rows: Kith anniversary /
  // a variant lot / Crain SS / base — none of them Dell'Otto), so the
  // candidate carries no discriminative signal and is never admitted as
  // evidence (identityCore.js:1019-1023) — reconciler sees ONLY Vision's
  // lone, uncorroborated claim, exactly the real production log:
  //   [reconcile-variant] CLEARING confirmedVariant "virgin variant" -> null
  //   (authority=NONE — no independent evidence corroborates or
  //   contradicts the bare Vision claim)
  const { reconciled } = reconcileVariantFacet('virgin variant', 'vision', 'Kith Marvel ASM #1 60th Anniversary CGC 9.6');
  assertEq(reconciled.authority, 'NONE', 'real reconcileVariantFacet clears (authority=NONE) on the real production pool shape');
  assertTrue(Array.isArray(reconciled.conflicts) && reconciled.conflicts.length > 0 && reconciled.conflicts[0].source === 'vision', 'reconciled.conflicts records the bare vision claim');

  const baseOut = {
    pricingSource: 'active_ask_derived',
    identityConfident: true,
    decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 68 },
    rawComps: { count: 4, average: 141.25, lowest: 90, highest: 175, prices: [175, 149.99, 150, 90] },
    variantReconciliation: reconciled,
  };

  console.log('\n  [PRE-AP simulation: variantApplicability computed the OLD way — rawComps?.variantApplicability alone, no custody]');
  const preOut = { ...baseOut, variantApplicability: null };
  const pre = run('PRE-AP (demonstrates the actual failing production state)', preOut);

  console.log('\n  [POST-AP: variantApplicability computed WITH custody — the actual shipped fix]');
  const postOut = { ...baseOut, variantApplicability: computeVariantApplicability(baseOut) };
  const post = run('POST-AP (real deriveMarketStanding/deriveLocks/deriveActionAuthority)', postOut);

  assertEq(pre.marketStanding, 'EXACT_CURRENT', 'PRE-AP: marketStanding reads EXACT_CURRENT (the bug)');
  assertEq(pre.authority.state, 'READY', 'PRE-AP DEMONSTRATED READY (the actual failing production behavior)');
  assertTrue(post.authority.state !== 'READY', 'POST-AP is REVIEW or LOCKED, not READY');
  assertEq(post.marketStanding, 'SIMILAR_ONLY', 'POST-AP marketStanding floors to SIMILAR_ONLY');
  assertTrue(post.locks.some((l) => l.code === 'market-standing-variant-unresolved'), 'POST-AP carries market-standing-variant-unresolved lock');
  assertTrue(post.authority.reasonCodes.includes('VARIANT_UNRESOLVED_EDITION'), 'POST-AP includes VARIANT_UNRESOLVED_EDITION reason');
}

console.log('\n=== B2: genuine base edition, no over-fire — SHIP-BLOCKING ===');
{
  // No confirmedVariant ever claimed at all -> api/enrich.js's own guard
  // (`if (variantIdentitySource === 'vision' && confirmedVariant)`) never
  // even calls reconcileVariantFacet. out.variantReconciliation is absent
  // (not present-but-null) -- the real "absent" shape.
  const out = {
    pricingSource: 'active_ask_derived',
    identityConfident: true,
    decision: { action: 'LIST_NOW', blockers: [] },
    matchConfidence: { tier: 'HIGH', score: 92 },
    rawComps: { count: 3, average: 45, lowest: 38, highest: 52, prices: [52, 45, 38] },
  };
  out.variantApplicability = computeVariantApplicability(out);
  const result = run('B2 genuine base edition (no reconciliation ran)', out);
  assertEq(out.variantApplicability, null, 'variantApplicability stays null when reconciler never ran');
  assertEq(result.marketStanding, 'EXACT_CURRENT', 'reaches EXACT_CURRENT');
  assertEq(result.authority.state, 'READY', 'reaches READY normally — the rule does not over-fire on a genuine base edition');
}

console.log('\n=== B3: cleared vs absent, isolated ===');
{
  const { reconciled: clearedReconciled } = reconcileVariantFacet('foil', 'vision', 'Some Other Unrelated Listing Title');
  assertEq(clearedReconciled.authority, 'NONE', 'sanity: cleared fixture reconciles to authority=NONE');

  const clearedOut = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 70 },
    rawComps: { count: 3, average: 30, lowest: 25, highest: 35, prices: [35, 30, 25] },
    variantReconciliation: clearedReconciled,
  };
  clearedOut.variantApplicability = computeVariantApplicability(clearedOut);
  const clearedResult = run('B3 cleared (conflict present)', clearedOut);

  const absentOut = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_NOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 70 },
    rawComps: { count: 3, average: 30, lowest: 25, highest: 35, prices: [35, 30, 25] },
  };
  absentOut.variantApplicability = computeVariantApplicability(absentOut);
  const absentResult = run('B3 absent (no reconciliation at all)', absentOut);

  assertEq(clearedOut.variantApplicability, 'UNRESOLVED', 'cleared -> UNRESOLVED');
  assertEq(absentOut.variantApplicability, null, 'absent -> null');
  assertTrue(clearedResult.marketStanding !== absentResult.marketStanding, 'marketStanding differs: cleared is demoted, absent is not');
  assertEq(clearedResult.marketStanding, 'SIMILAR_ONLY', 'cleared floors to SIMILAR_ONLY');
  assertEq(absentResult.marketStanding, 'EXACT_CURRENT', 'absent reaches EXACT_CURRENT');
  assertTrue(clearedResult.authority.state !== 'READY' && absentResult.authority.state === 'READY', 'distinction is structural, not incidental — only the cleared fixture is denied READY');
}

console.log('\n=== B4: monotonicity ===');
{
  const lockedBase = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 68 },
    rawComps: { count: 4, average: 141.25, lowest: 90, highest: 175, prices: [175, 149.99, 150, 90] },
    grade: 'VF', variantApplicability: 'UNRESOLVED',
  };
  const b0 = run('B4 baseline (locked, variant-unresolved)', lockedBase);
  assertTrue(b0.authority.state !== 'READY', 'baseline is not READY');

  // 1. raise grade -- authority cannot rise. Neither deriveMarketStanding
  // nor deriveLocks nor deriveActionAuthority read grade at all -- the
  // lock is keyed purely on variantApplicability/pricingSource.
  const raisedGrade = { ...lockedBase, grade: 'NM' };
  const b1g = run('B4a raise grade VF->NM', raisedGrade);
  assertTrue(b1g.authority.state !== 'READY', 'B4a: raising grade does not raise authority');
  assertEq(b1g.authority.state, b0.authority.state, 'B4a: authority.state unchanged by grade');

  // 2. raise ask price -- authority cannot rise.
  const raisedPrice = { ...lockedBase, rawComps: { ...lockedBase.rawComps, average: 500, highest: 600 } };
  const b2p = run('B4b raise ask price avg 141->500', raisedPrice);
  assertTrue(b2p.authority.state !== 'READY', 'B4b: raising price does not raise authority');
  assertEq(b2p.authority.state, b0.authority.state, 'B4b: authority.state unchanged by price');

  // 3. add a negative signal -- may only stay or fall, never rise.
  const negativeSignal = { ...lockedBase, matchConfidence: { tier: 'LOW', score: 40 } };
  const b3n = run('B4c add negative signal (matchConfidence -> LOW)', negativeSignal);
  assertTrue(b3n.authority.state !== 'READY', 'B4c: negative signal does not raise authority (stays REVIEW/LOCKED)');

  // 4. supply a corroborated variant + matching pool -- variantApplicability
  // CONFIRMED (api/comps.js's own real value when Filter 1c positively
  // matches, AB/GK-101), the only upward route out of the AP lock. DIRECT
  // proof the reconciler itself can escape NONE: a first-eligible-visual
  // row that DOES name the confirmed creator/variant clears the "no
  // discriminative signal" gate and reconciles to non-NONE authority.
  const { reconciled: corroborated } = reconcileVariantFacet(
    'virgin variant',
    'vision',
    "Amazing Spider-Man #1 Gabriele Dell'Otto Virgin Variant CGC SS 9.6"
  );
  assertTrue(corroborated.authority !== 'NONE', 'DIRECT: a matching first-eligible-visual row reconciles to non-NONE authority (escapes the clear)');

  const resolvedOut = { ...lockedBase, variantReconciliation: corroborated, variantApplicability: 'CONFIRMED' };
  const b4 = run('B4d resolved + matching pool (CONFIRMED)', resolvedOut);
  assertEq(b4.marketStanding, 'EXACT_CURRENT', 'B4d: CONFIRMED reaches EXACT_CURRENT');
  assertEq(b4.authority.state, 'READY', 'B4d: the only fixture in this block that reaches READY — the upward route exists and is demonstrated');
}

console.log('\n=== B5: AB (GK-101) and AH (GK-111) fixtures unregressed ===');
{
  // AB/GK-101 shape: confirmedVariant WAS confirmed, Filter 1c ran, found
  // no matching comp -- variantApplicability='UNVERIFIED', NOT the new
  // 'UNRESOLVED' code. Mirrors tests/grailkey-directive-ab-evidence-applicability.test.js's own fixture shape.
  const abOut = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 70 },
    rawComps: { count: 14, average: 40, lowest: 20, highest: 60, prices: new Array(14).fill(40) },
    variantApplicability: 'UNVERIFIED',
  };
  const abResult = run('AB (GK-101) shape: variantApplicability=UNVERIFIED', abOut);
  assertEq(abResult.marketStanding, 'SIMILAR_ONLY', 'AB still floors to SIMILAR_ONLY');
  assertTrue(abResult.locks.some((l) => l.code === 'market-standing-variant-unmatched'), 'AB still gets market-standing-variant-unmatched (not the new AP code)');
  assertTrue(!abResult.locks.some((l) => l.code === 'market-standing-variant-unresolved'), 'AB does NOT get the new AP code');

  // AH/GK-111 shape: sold-variant-fallback consumed.
  const ahOut = {
    pricingSource: 'sold_active_blend_30', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 65 },
    soldComps: [{}, {}, {}], rawComps: { count: 1, average: 65, lowest: 65, highest: 65, prices: [65] },
    variantApplicability: 'UNVERIFIED', variantApplicabilitySoldFallback: true,
  };
  const ahResult = run('AH (GK-111) shape: soldFallbackConsumed', ahOut);
  assertTrue(ahResult.locks.some((l) => l.code === 'market-standing-sold-variant-fallback'), 'AH still gets market-standing-sold-variant-fallback');
  assertTrue(!ahResult.locks.some((l) => l.code === 'market-standing-variant-unresolved'), 'AH does NOT get the new AP code');
}

console.log('\n=== B6: no new READY across the fixture set (PRE-AP vs POST-AP) ===');
{
  const STATE_RANK = { LOCKED: 0, REVIEW: 1, READY: 2 };
  const fixtures = [
    { label: 'B1 production shape', out: { pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] }, matchConfidence: { tier: 'MEDIUM', score: 68 }, rawComps: { count: 4, average: 141.25 }, variantReconciliation: { authority: 'NONE', conflicts: [{ source: 'vision', value: 'virgin variant' }] } } },
    { label: 'B3 cleared', out: { pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] }, matchConfidence: { tier: 'MEDIUM', score: 70 }, rawComps: { count: 3, average: 30 }, variantReconciliation: { authority: 'NONE', conflicts: [{ source: 'vision', value: 'foil' }] } } },
  ];
  for (const { label, out: base } of fixtures) {
    const preOut = { ...base, variantApplicability: null };
    const postOut = { ...base, variantApplicability: computeVariantApplicability(base) };
    const pre = run(`B6 PRE (${label})`, preOut);
    const post = run(`B6 POST (${label})`, postOut);
    assertTrue(STATE_RANK[post.authority.state] <= STATE_RANK[pre.authority.state], `B6 (${label}): actionAuthority(after) <= actionAuthority(before) [${pre.authority.state} -> ${post.authority.state}]`);
  }
}

console.log('\n=== Server boundary: api/list-ebay.js synthetic re-derivation (single writer, C6) ===');
{
  // Mirrors api/list-ebay.js:791-828's own syntheticOut construction --
  // proves 'UNRESOLVED' threads through the client-item -> server
  // re-derivation boundary unchanged (item.variantApplicability || null
  // passes any truthy string through), same Z state machine, no new
  // server-side branch needed.
  const item = {
    decision: { action: 'LIST_LOW', blockers: [] },
    pricingSource: 'active_ask_derived',
    matchConfidence: { tier: 'MEDIUM', score: 68 },
    rawComps: { count: 4, average: 141.25, lowest: 90, highest: 175 },
    variantApplicability: 'UNRESOLVED',
    variantApplicabilitySoldFallback: false,
    soldComps: 0,
    identityConfident: true,
    refusedToPrice: false, manualReviewRequired: false, gradeExceedsMap: false,
    claudeCheckBlocker: null, tier0Locked: false,
    priorLockCodes: [],
  };
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
  const freshLocks = deriveLocks(syntheticOut);
  const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
  const serverReady = authority.state === 'READY' && item.priorLockCodes.length === 0;

  assertTrue(!serverReady, 'server independently denies READY for an UNRESOLVED-variant item even if a client sent one');
  assertTrue(freshLocks.some((l) => l.code === 'market-standing-variant-unresolved'), 'server-side freshLocks include market-standing-variant-unresolved');
  assertEq(authority.state, 'REVIEW', 'server-derived authority.state=REVIEW');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
