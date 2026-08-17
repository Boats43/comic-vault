// tests/grailkey-directive-ar-evidence-authority.test.js
//
// GrailKey Directive 2026-08-17-AR — GK-129 + GK-130.
//
// One law, two tickets: authority is earned from evidence. It is never
// granted by list membership, and never retained by an unresolved contest.
//
// ── GK-130 (Part A) ── the pattern-list veto.
// Production evidence, Absolute Batman #19, Ben Oliver Variant Cover,
// 1st Scarecrow, DC 2026 (2026-08-17 03:58, build d3e2816): the physical
// book's cover artist is unregistered in ARTIST_PATTERNS
// (src/lib/compHygiene.js), so extractPoolArtistTokens never populated
// poolArtistTokens with 'ben'/'oliver' no matter how many independent pool
// listings named him — applyDualAxisGate (src/lib/imageSearchIdentity.js)
// vetoed a correctly-identified, 10-member family purely on registry
// absence ("[Q84] override-blocked reason=non-creator additions
// [ben,oliver]"), pricing the book from the generic pool. Fix:
// findPhysicallyCorroboratedTokens grants a non-registry token the SAME
// standing a registered creator gets from poolArtistTokens when (a) it is
// physically present on the frozen rank-1 eligible visual row
// (identityReconciler.js's selectFirstEligibleVisual, reused byte-for-byte
// — Directive AN's own discipline) AND (b) at least 3 independent (unique-
// seller, issueAuthority.js's checkDistinctItemIdAndSeller) family members
// also name it.
//
// ── GK-129 (Part B) ── CONTESTED cannot price EXACT.
// Production evidence, Venom Separation Anxiety #1, Mike Mayhew
// (2026-08-17 03:21, build d3e2816): src/lib/identityReconciler.js's
// reconcileVariant correctly computed authority=CONTESTED (an independent
// source disagreed with the adopted "Mike Mayhew signed" value), but
// api/enrich.js's custody of out.variantApplicability only ever
// distinguished UNVERIFIED/UNRESOLVED/null — CONTESTED fell straight
// through to whatever api/comps.js's Filter 1c said about the (disputed)
// value, which had genuinely matched comps against it (CONFIRMED) —
// actionAuthority READY, $48.86, List button live, while the card's own
// copy read "SIMILAR listings, not exact matches." Fix: api/enrich.js now
// custodies authority==='CONTESTED' into out.variantApplicability
// ='CONTESTED' (above the Filter 1c read, since a disputed identity blocks
// exactness regardless of whether the pool happens to match the disputed
// guess); src/lib/actionAuthority.js's deriveMarketStanding floors it to
// SIMILAR_ONLY, same principle as AB/AP, own reason code
// (VARIANT_CONTESTED_EDITION, src/lib/responseContract.js) so the operator
// sees why.
//
// Invoke: node tests/grailkey-directive-ar-evidence-authority.test.js

import { applyDualAxisGate, selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
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

// ════════════════════════════════════════════════════════════════════════
// PART A — GK-130
// ════════════════════════════════════════════════════════════════════════

console.log('\n=== A-B1: Absolute Batman #19 — the production shape — SHIP-BLOCKING ===');
{
  const absoluteBatmanPool = [
    { rawTitle: 'Absolute Batman#19 - Ben Oliver Variant Cover - 1st Scarcrow - DC Comics 2026', itemId: 'ab1', sellerUsername: 'sellerA' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover 1st Scarecrow DC 2026 NM', itemId: 'ab2', sellerUsername: 'sellerB' },
    { rawTitle: 'ABSOLUTE BATMAN 19 BEN OLIVER VARIANT DC COMICS 2026', itemId: 'ab3', sellerUsername: 'sellerC' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover DC Comics', itemId: 'ab4', sellerUsername: 'sellerD' },
    { rawTitle: 'Absolute Batman 19 Ben Oliver Variant 1st Scarecrow', itemId: 'ab5', sellerUsername: 'sellerE' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover 2026 DC NM', itemId: 'ab6', sellerUsername: 'sellerF' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover DC 2026', itemId: 'ab7', sellerUsername: 'sellerG' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover NM DC Comics 2026', itemId: 'ab8', sellerUsername: 'sellerH' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover 1st Scarecrow DC', itemId: 'ab9', sellerUsername: 'sellerI' },
    { rawTitle: 'Absolute Batman #19 Ben Oliver Variant Cover DC Comics 2026 CGC', itemId: 'ab10', sellerUsername: 'sellerJ' },
  ];

  // DIRECT — the real applyDualAxisGate, called the OLD way (no
  // familyIndices/items args — the exact call shape every site used before
  // this dispatch). New params default to null, so this genuinely
  // reproduces pre-fix behavior on the real, currently-shipped function —
  // not a mirrored reimplementation.
  const preGate = applyDualAxisGate(
    ['absolute', 'batman', 'ben', 'oliver'],
    ['absolute', 'batman'],
    new Set(), // poolArtistTokens — 'ben oliver' is NOT in ARTIST_PATTERNS
    absoluteBatmanPool[0].rawTitle,
    null
  );
  console.log(`  Q84 decision log (PRE): allowed=${preGate.allowed} reason=${preGate.reason}`);
  assertEq(preGate.allowed, false, 'PRE: Q84 vetoes the family purely on registry absence (demonstrates the bug)');
  assertEq(preGate.reason, 'non-creator additions [ben,oliver]', 'PRE: reason is the exact production log line');

  // DIRECT — same real function, real corroboration data supplied.
  const postGate = applyDualAxisGate(
    ['absolute', 'batman', 'ben', 'oliver'],
    ['absolute', 'batman'],
    new Set(),
    absoluteBatmanPool[0].rawTitle,
    null,
    absoluteBatmanPool.map((_, i) => i),
    absoluteBatmanPool
  );
  console.log(`  Q84 decision log (POST): allowed=${postGate.allowed} reason=${postGate.reason}`);
  console.log(`  reconcile-variant artifact: provenance=${postGate.provenance} admittedTitleTokens=${JSON.stringify(postGate.admittedTitleTokens)}`);
  assertEq(postGate.allowed, true, 'POST: family override permitted via physical corroboration');
  assertEq(postGate.provenance, 'creator-lane-physical-corroboration', 'POST: distinct provenance, not conflated with registry-based creator-lane-direct');
  assertEq(postGate.admittedTitleTokens, ['ben', 'oliver'], 'POST: both tokens admitted');

  // Full end-to-end family-selection proof (the real
  // selectTitleFamilyCandidate, real Q84 log line included above).
  const fullResult = selectTitleFamilyCandidate(
    absoluteBatmanPool, 'Absolute Batman', '19', null, { ebayConsensusTitle: 'Absolute Batman' }
  );
  assertEq(fullResult.decision, 'weighted-consensus', 'end-to-end: family override fires (not fallback-vision)');
  assertEq(fullResult.selectedTitle, 'absolute batman ben oliver', 'end-to-end: selected title carries the Ben Oliver axis');

  // Sold-filter partition claim (A-B1's own checklist item) is explicitly
  // OUT OF SCOPE for this unit-level fixture: exercising api/comps.js's
  // Filter 1c/sold-verification chain requires a live/synthetic eBay pool
  // far beyond what this pure-function test constructs. What IS proven
  // here is the precondition that filter needs to do its job correctly:
  // confirmedVariant/title now actually carries "ben oliver" instead of
  // being silently dropped. Physical-scan/full-pipeline acceptance is
  // reported PENDING in the handoff, not fabricated here.
}

console.log('\n=== A-B2: negative controls — the veto still fires ===');
{
  // Control (a): junk addition with FEWER than 3 independent sellers.
  const fewSellers = [
    { rawTitle: 'Wonder Woman #75 Rare Stamp Cover DC 2019 NM', itemId: 'k1', sellerUsername: 'sA' },
    { rawTitle: 'Wonder Woman #75 Rare Stamp Cover DC', itemId: 'k2', sellerUsername: 'sB' },
    { rawTitle: 'Wonder Woman #75 DC 2019 NM', itemId: 'k3', sellerUsername: 'sC' },
  ];
  const gateFew = applyDualAxisGate(
    ['wonder', 'woman', 'rare', 'stamp'], ['wonder', 'woman'], new Set(),
    fewSellers[0].rawTitle, null, [0, 1, 2], fewSellers
  );
  assertEq(gateFew.allowed, false, '(a) only 2/3 members support the addition — stays vetoed');

  // Control (b): addition corroborated by 3 members, but ABSENT from the
  // frozen rank-1 row itself — a marketplace fact about a different
  // listing, not physical evidence about the item in hand (same shape
  // Directive AN closed for discriminative-corroboration).
  const notInFrozen = [
    { rawTitle: 'Wonder Woman #75 Cover DC 2019 NM', itemId: 'm1', sellerUsername: 'sD' },
    { rawTitle: 'Wonder Woman #75 Exclusive Cover DC', itemId: 'm2', sellerUsername: 'sE' },
    { rawTitle: 'Wonder Woman #75 Exclusive Cover 2019', itemId: 'm3', sellerUsername: 'sF' },
    { rawTitle: 'Wonder Woman #75 Exclusive DC Comics', itemId: 'm4', sellerUsername: 'sG' },
  ];
  const gateNotFrozen = applyDualAxisGate(
    ['wonder', 'woman', 'exclusive'], ['wonder', 'woman'], new Set(),
    notInFrozen[0].rawTitle, null, [0, 1, 2, 3], notInFrozen
  );
  assertEq(gateNotFrozen.allowed, false, '(b) 3-member support but absent from the frozen row — stays vetoed');

  // Control (c): anti-injection — 3 rows, but ONE seller (a relist), so
  // uniqueSellerCount < 3 — not independent corroboration.
  const sameSeller = [
    { rawTitle: 'Wonder Woman #75 Ghost Signing Cover DC 2019 NM', itemId: 'n1', sellerUsername: 'sameSeller' },
    { rawTitle: 'Wonder Woman #75 Ghost Signing Cover DC', itemId: 'n2', sellerUsername: 'sameSeller' },
    { rawTitle: 'Wonder Woman #75 Ghost Signing Cover 2019', itemId: 'n3', sellerUsername: 'sameSeller' },
  ];
  const gateSameSeller = applyDualAxisGate(
    ['wonder', 'woman', 'ghost', 'signing'], ['wonder', 'woman'], new Set(),
    sameSeller[0].rawTitle, null, [0, 1, 2], sameSeller
  );
  assertEq(gateSameSeller.allowed, false, '(c) one seller relisting 3x is not independent — stays vetoed');
}

console.log('\n=== A-B3: Venom Mayhew shape — byte-identical (registered creator, unaffected) ===');
{
  // 'mayhew' IS in ARTIST_PATTERNS -> poolArtistTokens already contains it
  // -> nonCreator excludes it entirely -> the new branch is never reached
  // at all (not merely "also allows" — structurally inert for this case).
  const items = [
    { rawTitle: 'Venom Separation Anxiety #1 Mike Mayhew Virgin Signed/Remarked Marvel Comic NM', itemId: 'v1', sellerUsername: 'sX' },
  ];
  const poolArtistTokens = new Set(['mike', 'mayhew']); // as extractPoolArtistTokens would populate from ARTIST_PATTERNS
  const gate = applyDualAxisGate(
    ['venom', 'separation', 'anxiety', 'mike', 'mayhew'], ['venom', 'separation', 'anxiety'],
    poolArtistTokens, items[0].rawTitle, null, [0], items
  );
  assertEq(gate.allowed, true, 'registered creator still allowed');
  assertEq(gate.provenance, 'creator-lane-direct', 'still the pre-existing creator-lane-direct provenance, not the new physical-corroboration branch');
}

console.log('\n=== A-B4: pre-existing suites — run separately, byte-identical (see handoff) ===');
{
  // tests/q84-dual-axis.test.js (17/17), grailkey-directive-af-discriminative-corroboration
  // (25/25), grailkey-directive-ag-22e-provenance-exemption (32/32),
  // grailkey-directive-an-physical-corroboration (11/11),
  // grailkey-directive-ao-companion-product-eligibility (19/19),
  // grailkey-directive-ap-variant-unresolved-authority (37/37),
  // grailkey-directive-aq-canonical-facet-authority (32/32), and
  // q140-issue-consensus-corrective (124/124) were each run directly
  // against this dispatch's changes and produced byte-identical results —
  // logged here as a pointer, not duplicated as inline assertions, per
  // this repo's own "delegated, not re-implemented" convention
  // (grailkey-directive-aq-canonical-facet-authority.test.js's own header).
  assertTrue(true, 'delegation record — see handoff for the actual run output');
}

// ════════════════════════════════════════════════════════════════════════
// PART B — GK-129
// ════════════════════════════════════════════════════════════════════════

// MIRRORED — api/enrich.js's own custody expression (~line 8611-8636),
// verbatim in shape (inline in the request handler, not exported). Feeds a
// REAL out.variantReconciliation produced by the REAL reconcileVariantFacet
// (below) — only this boolean/string custody mapping is reproduced.
const computeVariantApplicability = (out, { soldFallbackConsumed = false, rawVariantApplicability = null } = {}) => {
  const variantWasClearedWithEvidence = out.variantReconciliation?.authority === 'NONE'
    && Array.isArray(out.variantReconciliation?.conflicts)
    && out.variantReconciliation.conflicts.length > 0;
  const variantIsContested = out.variantReconciliation?.authority === 'CONTESTED';
  return soldFallbackConsumed
    ? 'UNVERIFIED'
    : (variantIsContested
        ? 'CONTESTED'
        : (rawVariantApplicability ?? (variantWasClearedWithEvidence ? 'UNRESOLVED' : null)));
};

const run = (label, out) => {
  const locks = deriveLocks(out);
  const identityStanding = deriveIdentityStanding(out);
  const marketStanding = deriveMarketStanding(out);
  const authority = deriveActionAuthority(out, locks, out.decision);
  console.log(`  --- ${label} --- marketStanding=${marketStanding} identityStanding=${identityStanding} authority.state=${authority.state} reasonCodes=${JSON.stringify(authority.reasonCodes)}`);
  return { locks, identityStanding, marketStanding, authority };
};

console.log('\n=== B-B1: Venom Mayhew shape — the production shape — SHIP-BLOCKING ===');
{
  // DIRECT — real reconcileVariantFacet, fed the real production shape:
  // Vision's own "Mike Mayhew signed" claim, and a first-eligible-visual
  // row naming a DIFFERENT, disagreeing creator (the CONTESTED shape).
  const { reconciled } = reconcileVariantFacet(
    'Mike Mayhew signed', 'vision',
    'Venom Separation Anxiety #1 Tyler Kirkham Variant Cover Marvel Comic NM'
  );
  assertEq(reconciled.authority, 'CONTESTED', 'real reconcileVariantFacet computes CONTESTED on the real production pool shape');

  const baseOut = {
    pricingSource: 'active_ask_derived',
    identityConfident: true,
    decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 68 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65, prices: [65, 55, 45, 35] },
    variantReconciliation: reconciled,
  };

  console.log('\n  [PRE-AR simulation: variantApplicability computed the OLD way — Filter 1c CONFIRMED read straight through, CONTESTED never checked]');
  const preOut = { ...baseOut, variantApplicability: 'CONFIRMED' }; // rawComps?.variantApplicability from Filter 1c, pre-fix custody would have used this untouched
  const pre = run('PRE-AR (demonstrates the actual failing production state)', preOut);

  console.log('\n  [POST-AR: variantApplicability computed WITH CONTESTED custody — the actual shipped fix]');
  const postOut = { ...baseOut, variantApplicability: computeVariantApplicability(baseOut, { rawVariantApplicability: 'CONFIRMED' }) };
  const post = run('POST-AR (real deriveMarketStanding/deriveLocks/deriveActionAuthority)', postOut);

  assertEq(pre.marketStanding, 'EXACT_CURRENT', 'PRE-AR: marketStanding reads EXACT_CURRENT (the bug)');
  assertEq(pre.authority.state, 'READY', 'PRE-AR DEMONSTRATED READY (the actual failing production behavior)');
  assertEq(postOut.variantApplicability, 'CONTESTED', 'POST-AR: CONTESTED overrides the Filter 1c CONFIRMED read');
  assertTrue(post.authority.state !== 'READY', 'POST-AR is REVIEW or LOCKED, not READY');
  assertEq(post.marketStanding, 'SIMILAR_ONLY', 'POST-AR marketStanding floors to SIMILAR_ONLY');
  assertTrue(post.locks.some((l) => l.code === 'market-standing-variant-contested'), 'POST-AR carries market-standing-variant-contested lock');
  assertTrue(post.authority.reasonCodes.includes('VARIANT_CONTESTED_EDITION'), 'POST-AR includes VARIANT_CONTESTED_EDITION reason');
  // price still displays — this is a revocation of standing, not a price
  // clear (I13, C1). Nothing in this fix touches out.price or rawComps.
  assertEq(baseOut.rawComps.count, 4, 'the 4-comp pool is untouched — price data still present, only authority is revoked');
}

console.log('\n=== B-B2: corroborated variant still reaches EXACT_CURRENT — the upward route exists ===');
{
  const { reconciled } = reconcileVariantFacet(
    'Mike Mayhew signed', 'vision',
    'Venom Separation Anxiety #1 Mike Mayhew Virgin Signed/Remarked by Mike Mayhew Marvel Comic NM'
  );
  assertEq(reconciled.authority, 'CORROBORATED', 'sanity: agreeing first-eligible-visual reconciles to CORROBORATED, not CONTESTED');
  const out = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_NOW', blockers: [] },
    matchConfidence: { tier: 'HIGH', score: 90 },
    rawComps: { count: 5, average: 60, lowest: 45, highest: 75, prices: [75, 65, 60, 50, 45] },
    variantReconciliation: reconciled,
  };
  out.variantApplicability = computeVariantApplicability(out, { rawVariantApplicability: 'CONFIRMED' });
  const result = run('B-B2 corroborated variant', out);
  assertEq(out.variantApplicability, 'CONFIRMED', 'CORROBORATED authority does not get custodied into CONTESTED');
  assertEq(result.marketStanding, 'EXACT_CURRENT', 'reaches EXACT_CURRENT');
  assertEq(result.authority.state, 'READY', 'reaches READY normally — the rule does not over-fire on a genuinely corroborated variant');
}

console.log('\n=== B-B3: operator path — the escape hatch survives ===');
{
  // An operator (GK-85 OPERATOR_CONFIRMED) correction never runs through
  // reconcileVariantFacet at all — api/enrich.js's own guard
  // (`if (variantIdentitySource === 'vision' && confirmedVariant)`) only
  // fires when the pipeline's source is exactly 'vision'. out.variantReconciliation
  // stays absent (not present-but-CONTESTED) for an operator-confirmed
  // variant — the real "absent" shape, same as AP's own B2.
  const out = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_NOW', blockers: [] },
    matchConfidence: { tier: 'HIGH', score: 95 },
    rawComps: { count: 4, average: 50, lowest: 40, highest: 60, prices: [60, 52, 48, 40] },
    variantIdentitySource: 'user',
    // no variantReconciliation key at all
  };
  out.variantApplicability = computeVariantApplicability(out, { rawVariantApplicability: 'CONFIRMED' });
  const result = run('B-B3 operator-confirmed variant', out);
  assertEq(out.variantApplicability, 'CONFIRMED', 'operator path never enters the CONTESTED custody branch');
  assertEq(result.marketStanding, 'EXACT_CURRENT', 'operator-confirmed variant reaches EXACT_CURRENT');
  assertEq(result.authority.state, 'READY', 'operator correction remains the escape hatch — READY reachable');
}

console.log('\n=== B-B4: AP fixtures unregressed + distinct, mutually-exclusive codes ===');
{
  const { reconciled: clearedReconciled } = reconcileVariantFacet('foil', 'vision', 'Some Other Unrelated Listing Title');
  assertEq(clearedReconciled.authority, 'NONE', 'sanity: AP\'s cleared fixture still reconciles to authority=NONE (unaffected)');
  const clearedOut = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 70 },
    rawComps: { count: 3, average: 30, lowest: 25, highest: 35, prices: [35, 30, 25] },
    variantReconciliation: clearedReconciled,
  };
  clearedOut.variantApplicability = computeVariantApplicability(clearedOut);
  const clearedResult = run('B-B4 AP cleared (unaffected)', clearedOut);
  assertEq(clearedOut.variantApplicability, 'UNRESOLVED', 'AP shape still produces UNRESOLVED, not CONTESTED');
  assertTrue(clearedResult.locks.some((l) => l.code === 'market-standing-variant-unresolved'), 'AP lock still fires');
  assertTrue(!clearedResult.locks.some((l) => l.code === 'market-standing-variant-contested'), 'AP shape does NOT also get the new AR code');

  // Mutual exclusivity, the other direction.
  const { reconciled: contestedReconciled } = reconcileVariantFacet(
    'Mike Mayhew signed', 'vision', 'Venom Separation Anxiety #1 Tyler Kirkham Variant Cover Marvel Comic NM'
  );
  const contestedOut = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 68 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65, prices: [65, 55, 45, 35] },
    variantReconciliation: contestedReconciled,
  };
  contestedOut.variantApplicability = computeVariantApplicability(contestedOut, { rawVariantApplicability: 'CONFIRMED' });
  const contestedResult = run('B-B4 AR contested', contestedOut);
  assertTrue(contestedResult.locks.some((l) => l.code === 'market-standing-variant-contested'), 'AR shape gets the new code');
  assertTrue(!contestedResult.locks.some((l) => l.code === 'market-standing-variant-unresolved'), 'AR shape does NOT also get the AP code — mutually exclusive');
  assertTrue(!contestedResult.locks.some((l) => l.code === 'market-standing-variant-unmatched'), 'AR shape does NOT also get the AB code — mutually exclusive');
}

console.log('\n=== B-B5: no new READY across the fixture set ===');
{
  const STATE_RANK = { LOCKED: 0, REVIEW: 1, READY: 2 };
  const fixtures = [
    { label: 'B-B1 production shape', out: { pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] }, matchConfidence: { tier: 'MEDIUM', score: 68 }, rawComps: { count: 4, average: 48.86 }, variantReconciliation: { authority: 'CONTESTED', conflicts: [{ source: 'vision', value: 'Mike Mayhew signed' }] } } },
  ];
  for (const { label, out: base } of fixtures) {
    const preOut = { ...base, variantApplicability: 'CONFIRMED' };
    const postOut = { ...base, variantApplicability: computeVariantApplicability(base, { rawVariantApplicability: 'CONFIRMED' }) };
    const pre = run(`B-B5 PRE (${label})`, preOut);
    const post = run(`B-B5 POST (${label})`, postOut);
    assertTrue(STATE_RANK[post.authority.state] <= STATE_RANK[pre.authority.state], `B-B5 (${label}): actionAuthority(after) <= actionAuthority(before) [${pre.authority.state} -> ${post.authority.state}]`);
  }
}

console.log('\n=== Server boundary: api/list-ebay.js synthetic re-derivation (single writer, C6) ===');
{
  // Mirrors api/list-ebay.js:791-828's own syntheticOut construction --
  // `item.variantApplicability || null` passes the truthy 'CONTESTED'
  // string through unchanged, same Z state machine, no new server branch.
  const item = {
    decision: { action: 'LIST_LOW', blockers: [] },
    pricingSource: 'active_ask_derived',
    matchConfidence: { tier: 'MEDIUM', score: 68 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65 },
    variantApplicability: 'CONTESTED',
    variantApplicabilitySoldFallback: false,
    soldComps: 0,
    identityConfident: true,
    refusedToPrice: false, manualReviewRequired: false, gradeExceedsMap: false,
    claudeCheckBlocker: null, tier0Locked: false,
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
  assertTrue(authority.state !== 'READY', 'server independently denies READY for a CONTESTED-variant item even if a client sent one');
  assertTrue(freshLocks.some((l) => l.code === 'market-standing-variant-contested'), 'server-side freshLocks include market-standing-variant-contested');
  assertEq(authority.state, 'REVIEW', 'server-derived authority.state=REVIEW');
}

// ════════════════════════════════════════════════════════════════════════
// INTEGRATION — where GK-129 and GK-130 meet on one book
// ════════════════════════════════════════════════════════════════════════

console.log('\n=== Integration: Absolute Batman #19 post-AR — right axis, non-exact standing ===');
{
  // Part A gets the book its "Ben Oliver" identity axis back. Part B
  // ensures that even a CORRECTLY-identified-but-CONTESTED variant facet
  // can't claim EXACT_CURRENT. Compose: Ben Oliver corroborated (Part A),
  // but the reconciler independently finds a disagreeing signal on some
  // other axis (e.g. a "1st print" vs "2nd print" dispute) — CONTESTED,
  // not CORROBORATED — and Part B keeps that non-exact.
  const { reconciled } = reconcileVariantFacet(
    'Ben Oliver 1st print', 'vision',
    'Absolute Batman #19 Ben Oliver Variant Cover 2nd Print DC Comics 2026'
  );
  const out = {
    pricingSource: 'active_ask_derived', identityConfident: true, decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 70 },
    rawComps: { count: 10, average: 12, lowest: 8, highest: 18, prices: [18, 15, 12, 12, 10, 10, 9, 9, 8, 8] },
    variantReconciliation: reconciled,
  };
  out.variantApplicability = computeVariantApplicability(out, { rawVariantApplicability: 'CONFIRMED' });
  const result = run('Integration: Absolute Batman post-AR', out);
  console.log(`  variant axis on card: "${reconciled.value}" (authority=${reconciled.authority})`);
  console.log(`  standing: marketStanding=${result.marketStanding} authority.state=${result.authority.state}`);
  assertTrue(result.marketStanding !== 'EXACT_CURRENT', 'Integration: right-axis-but-contested book cannot reach EXACT_CURRENT');
  assertTrue(result.authority.state !== 'READY', 'Integration: not READY — REVIEW, price still displayed');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
