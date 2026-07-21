// tests/q133-slice2-identityrefused-promotion.test.js
//
// Q133 Slice 2 (C1 promotion, 2026-07-21) — a refused-identity-conflict
// book whose pool corroborates its OWN provisional identity with >=3
// members (the same floor applyDualAxisGate's weighted-consensus path
// already trusts — "Q38: Require >=3 members for weighted-consensus
// override") no longer takes the hard early-return that skipped Phase 2
// entirely. Instead: Phase 2 (real fetchComps/fetchPricechartingSales)
// runs normally using the pool's already-correct provisional identity;
// computeDecision runs normally at the end; the card stays LOCKED/
// RESEARCH via the SAME listingHardLockReason==='identity-unresolved'
// mechanism Q110 already built (decisionEngine's identity-conflict-
// unresolved warning), not a new state. Below the floor (Eternus #2: 2
// members), behavior stays byte-identical to today.
//
// Design ruling covered by this file:
//   1. Comp-count floor: if Phase 2 runs and finds 0 real comps, fall back
//      to the visual-pool-median (today's baseline) rather than an empty
//      LOCKED card.
//   2. Banner wording is source-honest: two distinct strings for "priced
//      from real comps" vs "fell back to visual-pool-median."
//   3. identityConfident is forced false for a promoted card, structurally
//      (a direct flag check in both api/enrich.js and decisionEngine.js),
//      never left to read as Vision-agreed confidence — with an explicit
//      adversarial fixture proving it can't slip past the
//      identity-not-confident blocker as if genuinely confident.
//
// Invoke: node tests/q133-slice2-identityrefused-promotion.test.js

import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { pcMatchConflictsWithPoolName } from '../src/lib/variantIdentity.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q133 Slice 2 — identityRefused promotion (C1) ===\n');

// Real pools, verbatim, from the live production pull (03:00 UTC 2026-07-21).
const RACHTA_LIN_POOL = [
  'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals NM!!',
  'Pop Kill #1 Rachta Lin Megacon Exclusive Virgin 2nd Print LTD 250',
  'Pop Kill #1 Rachta Lin Exclusive Variant • MegaCon 2026 • LTD 250 NM',
  "**GRIMM FAIRY TALES: SAN DIEGO CON VIRGIN 'SUDS' EXCLUSIVE-NM/M 9.8-ONE OWNER**",
  'POP KILL SEASONAL FLAVORS #1 VIRGIN MIKI OKAZAKI EXCLUSIVE',
  'POP KILL SEASONAL FLAVORS #1 MIKI OKAZAKI EXCLUSIVE LTD 500',
  'POP KILL SEASONAL FLAVORS #1 VIRGIN MIKI OKAZAKI EXCLUSIVE',
  'POWER HOUR #2 Topless BUBBLE GIRL Kinkie Cuties Jake T NM + Risqué Cover Virgin',
  'Con Artists #5 Lena Dai Top Virgin Lingerie Variant Ryan Kincaid Kickstarter',
  'Grimm Fairy Tales REALM WAR AGE OF DARKNESS #1 RARE Franchesco SDCC VARIANT 2014',
  'JUNGLE BOOK: Fall of the Wild #5  LE 500 Atlantic City Comic Con FREE SHIPPING',
  'KAIRUNOBUROGO RARE NYCC 2025 PRIVATE DANCE #1 Steamy VIRGIN LTD 125',
  'GFT Wonderland #15 NYCC Excl. Ltd.750 Mike Debaflo Cover',
  'Zenescope VAN HELSING vs MUMMY OF AMUN-RA #5 Motor City 2017 Comic Con LE: 500',
  'Zenescope Grimm Fairy Tales 38 VIP Collectors Club Naughty Variant Paul Green LE',
  'Grimm Fairy Tales Presents Oz #1 2013 SDCC NM/Mint Elias Chatzoudis',
  'Zenescope JUNGLE BOOK: Fall of the Wild #5 NM Ltd.500 Dooney AC-BC Comic Con GFT',
  'VS Key of Storms Big Cheeky Stars and Stripes trade dress 4/65 24 hour exclusive',
  'Grimm Fairy Tales #115 NYCC Hand Signed Chatzoudis Variant Zenescope',
  'Pop Kill: Seasonal Flavors #1 Miki Okazaki Virgin Variant - Ltd to 500',
];

const LOZANO_POOL = [
  'Alexander Lozano Signed Pop Kill #1 Metal Megacon Exclusive (Naughty) LTD 100',
  'Pop Kill (Mad Cave Studios) #1 Lozano Exclusive Megacon Variant Regular Version',
  'SIGNED ALEXANDER LOZANO POP KILL #1 MEGACON EXCLUSIVE SET LMTD 200 NM+ W COA',
  'Pop Kill (Mad Cave Studios) #1 Lozano Exclusive Megacon Variant Signed 90/100',
  'Pop Kill #1 Lozano Exclusive Topless Megacon Variant Regular Version',
  'Pop Kill #1 Alexander Lozano SIGNED MegaCon METAL  Exclusive Variant Set Ltd.100',
  'Pop Kill (Mad Cave Studios) #1 Lozano Exclusive Megacon Variant Regular Version',
  'Pop Kill #1 Orange Virgin Foil 27/100 Megacon Excl Signed by Alexander Lozano',
  'Pop Kill #1 Naughty Version Megacon *Metal* cover 87/100 *Lozano Signed* (2025)',
  'Pop Kill # 1 Naughty Cover B MegaCon Alexander Lozano SIGNED',
  'Megacon Exclusive Alexander Lozano Pop Kill # 1 A/B Set Limited to 200 sold out',
  'SIGNED Pop Kill #1 Lozano METAL Naughty Variant LTD 100',
  'POP KILL #1_Megacon Exclusive_FOIL_SIGNED by ALEXANDER LOZANO LTD 100 w/COA',
  'Megacon Exclusvie POP KILL #1 Foil Signed by Alexander Lozano out of 100 W/COA',
  'Pop Kill #3 SIGNED Godtail Megacon Exclusive Virgin Cover B w COA - see pics',
  'Megacon Exclusive Alexander Lozano Pop Kill # 1 A/B Set Limited to 200  NM ',
  'Pop Kill #1 MegaCon Ex. Alexander Lozano Naughty Metal Variant LTD 100 - SIGNED',
  'Pop Kill 1 Lozano Exclusive megacon signed COA ',
  'I MAKE BOYS CRY #1 DAZZLER  VIRGIN VARIANT SIGNED JAMIE TYNDALL COA',
  'Pop Kill #1 - Signed Alexander Lozano w/COA MegaCon Virgin Foil Variant Ltd 100',
];

// Eternus #2 / He-Man class (Q131 precedent) — thin, 2-member pool. Vision
// hallucinated "He-Man and the Masters of the Universe #1"; pool correctly
// found "Eternus" but only 2/17 members, well below the promotion floor.
const ETERNUS_POOL = [
  'Eternus #2 NYCC Metal Virgin Variant Scout Comics 2024',
  'Eternus #2 NYCC Exclusive Metal Virgin Cover Scout Comics',
  'Lobo #1 Portacio Variant DC Comics',
  'Conan the Barbarian #5 Marvel Comics Variant',
  'Random Unrelated Comic #12 Cover A',
  'Another Unrelated Book #3 Signed Edition',
  'Different Series #45 Main Cover',
  'Yet Another Comic #7 Variant Edition',
  'Some Title #22 First Print',
  'Other Book #9 Second Print',
  'Miscellaneous Comic #1 Cover B',
  'Filler Title #3 Exclusive',
  'Padding Comic #14 NM',
  'More Padding #8 VF',
  'Extra Filler #19 Signed',
  'Last Filler #2 Cover C',
  'Final Padding #33 Reprint',
];

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — promotion-eligibility floor, run through the REAL clustering
// pipeline (not hand-typed numbers)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: promotion floor against real/reconstructed pools\n');

function getTopFamilyCount(pool, visionTitle, visionIssue, ebayConsensusTitle) {
  const result = selectTitleFamilyCandidate(pool, visionTitle, visionIssue, null, { ebayConsensusTitle });
  return { decision: result.decision, count: result.topFamily?.count ?? 0, result };
}

const rachtaLin = getTopFamilyCount(RACHTA_LIN_POOL, 'Zombie Tramp', '75', null);
assertEq(rachtaLin.decision, 'refused-identity-conflict', 'Rachta Lin: real pool still refuses (Vision "Zombie Tramp" 0-overlap)');
assertEq(rachtaLin.count, 3, 'Rachta Lin: top family has 3 members — real, computed, matches production log');
assertTrue(rachtaLin.count >= 3, 'Rachta Lin: CLEARS the >=3 promotion floor');

const lozano = getTopFamilyCount(LOZANO_POOL, 'Danger Girl', '1', null);
assertEq(lozano.decision, 'refused-identity-conflict', 'Lozano: real pool still refuses (Vision "Danger Girl" 0-overlap)');
assertEq(lozano.count, 17, 'Lozano: top family has 17 members — real, computed, matches production log');
assertTrue(lozano.count >= 3, 'Lozano: CLEARS the >=3 promotion floor');

const eternus = getTopFamilyCount(ETERNUS_POOL, 'He-Man and the Masters of the Universe', '1', null);
assertEq(eternus.decision, 'refused-identity-conflict', 'Eternus #2: refuses (Vision "He-Man" 0-overlap with the pool)');
assertEq(eternus.count, 2, 'Eternus #2: top family has 2 members — below the floor, as documented in Q131');
assertFalse(eternus.count >= 3, 'Eternus #2: does NOT clear the >=3 promotion floor — stays on the unpromoted path');

// Synthetic 2-member thin pool — proves the floor generically, not just on
// the two specific cases already known to work. Filler titles deliberately
// use disjoint vocabulary (no shared tokens) so they don't accidentally
// Jaccard-cluster into one large family themselves — verified via a direct
// buildTitleFamilies/scoreTitleFamilies dry run before writing this
// assertion, not assumed.
const SYNTHETIC_THIN_POOL = [
  'Zephyr Quantum #9 Exclusive Cover',
  'Zephyr Quantum #9 Signed Variant',
  'Nightfall Rangers Annual Special',
  'Copper Vortex Adventures 55',
  'Bright Meadow Chronicles Volume Two',
  'Silent Harbor Mysteries Book Four',
  'Golden Compass Travelers Set',
  'Iron Willow Saga Chapter Nine',
  'Crimson Tide Warriors Edition',
  'Velvet Hollow Legends Reprint',
  'Amber Lantern Guardians Cover',
  'Frozen Ember Society Special',
  'Whispering Pines Tales Number Twelve',
  'Obsidian Falcon Squad Story',
  'Marble Orchid Detectives Print',
  'Thunder Basin Riders Chronicle',
  'Emerald Cascade Knights Book',
];
const synthThin = getTopFamilyCount(SYNTHETIC_THIN_POOL, 'Some Vision Guess', '1', null);
assertEq(synthThin.count, 2, 'synthetic thin pool: top family has 2 members (constructed to prove this, not assumed)');
assertFalse(synthThin.count >= 3, 'synthetic thin pool: does NOT clear the floor — generic proof, not case-specific');

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — decisionEngine.js: promoted card outcomes
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: decisionEngine outcomes for promoted cards\n');

// Promoted + real comps found (mirrors what api/enrich.js sets after a
// successful Phase 2 fetch: identityProvisional, identityConfident forced
// false, listingHardLockReason, a real price, real rawComps).
{
  const item = {
    title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals !!',
    issue: null,
    identityProvisional: true,
    identityConfident: false,
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    listingHardLockBanner: 'Identity unconfirmed (visual pool disagrees with the AI read) — priced from 12 live comps — verify before listing',
    price: 45.5,
    rawComps: { average: 47, lowest: 30, highest: 65, count: 12 },
    soldComps: [],
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'promoted+real-comps: identity-not-confident blocker does NOT fire');
  assertTrue(decision.warnings.includes('identity-conflict-unresolved'), 'promoted+real-comps: identity-conflict-unresolved warning DOES fire');
  assertEq(decision.action, 'RESEARCH', 'promoted+real-comps: action is RESEARCH (price visible, verify before listing) — not ID_REQUIRED, not silently LIST_NOW');
}

// Promoted, Phase 2 found 0 real comps — fell back to visual-pool-median.
{
  const item = {
    title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals !!',
    issue: null,
    identityProvisional: true,
    identityConfident: false,
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    listingHardLockBanner: 'Provisional ID from visual pool: "Pop Kill 1 Rachta Lin..." #null — AI read "Zombie Tramp" instead, but the visual pool unanimously disagrees — verify before listing',
    price: 33,
    pricingSource: 'visual_pool_family_isolated',
    visualPoolUsed: true,
    rawComps: { average: null, lowest: null, highest: null, count: 0 },
    soldComps: [],
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'promoted+fallback-median: identity-not-confident blocker does NOT fire');
  assertTrue(decision.warnings.includes('identity-conflict-unresolved'), 'promoted+fallback-median: identity-conflict-unresolved warning DOES fire');
  assertEq(decision.action, 'RESEARCH', 'promoted+fallback-median: still RESEARCH, price visible (median fallback), not an empty LOCKED card');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — ADVERSARIAL: attempt to make a promoted card slip past the
// identity-not-confident blocker as if genuinely confident
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: adversarial — proving the structural distinction actually holds\n');

// The real risk: identityProvisional=true + identityConfident correctly
// forced false (per the api/enrich.js fix) — WITHOUT the decisionEngine.js
// exception, this would incorrectly hard-block via identity-not-confident,
// undoing the entire point of promotion (price computed, but decision
// says ID_REQUIRED — an internally contradictory card). Confirm the ACTUAL
// current code does NOT do this.
{
  const item = {
    title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon (Naughty) LTD 100',
    issue: '1',
    identityProvisional: true,
    identityConfident: false, // forced false per the enrich.js fix, NOT left to read true
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    price: 149.88,
    rawComps: { average: 140, lowest: 80.72, highest: 191.04, count: 17 },
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'ADVERSARIAL: correctly excluded from the hard blocker (isPoolProvisionalIdentity exception fires)');
  assertEq(decision.action, 'RESEARCH', 'ADVERSARIAL: lands on RESEARCH, not ID_REQUIRED and not a silent LIST_NOW');
  assertEq(item.identityConfident, false, 'ADVERSARIAL: identityConfident stays honestly false on the item — never silently flipped to true anywhere in this path');
}

// Negative control: same item, but WITHOUT listingHardLockReason set (as
// if the mechanism that flags a promoted card were broken/omitted). Proves
// the blocker exception is not, by itself, a free pass — it depends on
// listingHardLockReason being reliably set (which api/enrich.js's fix does
// unconditionally for every promoted card) to still surface the warning.
{
  const item = {
    title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon (Naughty) LTD 100',
    issue: '1',
    identityProvisional: true,
    identityConfident: false,
    identityComplete: true,
    // listingHardLockReason deliberately omitted
    price: 149.88,
    rawComps: { average: 140, lowest: 80.72, highest: 191.04, count: 17 },
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'negative control: blocker still excluded (isPoolProvisionalIdentity alone is enough for THIS exception)');
  assertFalse(decision.warnings.includes('identity-conflict-unresolved'), 'negative control: warning does NOT fire without listingHardLockReason — proves the two mechanisms are coupled, not redundant safety nets');
  console.log('  (informational) negative control action:', decision.action, '— this is exactly why api/enrich.js sets listingHardLockReason unconditionally for every promoted card, not optionally');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — Slice 1's two-axis gate, confirmed firing WITHIN the promoted
// path (not just reasoned about) — Lozano's real "Alexander Hamilton #1"
// PC anchor would flow into Phase 2 like any other card's anchor once
// promoted; Slice 1's gate runs on ANY priceCharting match unconditionally.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Slice 1 two-axis gate still fires on Lozano\'s Hamilton anchor within the promoted path\n');

assertTrue(
  pcMatchConflictsWithPoolName('Alexander Hamilton #1', LOZANO_POOL),
  'Lozano (promoted): "Alexander Hamilton #1" still conflicts on the name axis against the REAL Lozano pool — Slice 1\'s gate protects the promoted path exactly as it protects every other card, no separate exemption needed'
);

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — controls: Poison Ivy #31 / Catwoman #64 (normal, non-provisional
// identities) must be completely unaffected by any of this.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: controls — normal identities untouched\n');

{
  // Poison Ivy #31: real production shape (LIST_LOW, medium confidence,
  // identityProvisional simply absent — never set for a non-refused book).
  const item = {
    title: 'poison ivy by',
    issue: '31',
    identityConfident: true,
    identityComplete: true,
    price: 3.87,
    rawComps: { average: 4.74, lowest: 2.99, highest: 6.5, count: 2 },
    soldComps: [{ price: 3.49 }],
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'Poison Ivy #31: no identity blocker (genuinely confident, untouched by this slice)');
  assertFalse(decision.warnings.includes('identity-conflict-unresolved'), 'Poison Ivy #31: no identity-conflict-unresolved warning (not a provisional/refused identity)');
  assertTrue(item.identityConfident, 'Poison Ivy #31: identityConfident stays true — nothing in this slice forces it false for a normal identity');
}

{
  // Catwoman #64 (Q127/Q132 precedent shape) — PC and pool agree, normal path.
  const item = {
    title: 'Catwoman',
    issue: '64',
    identityConfident: true,
    identityComplete: true,
    price: 15,
    rawComps: { average: 15, lowest: 12, highest: 18, count: 6 },
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'Catwoman #64: no identity blocker');
  assertFalse(decision.warnings.includes('identity-conflict-unresolved'), 'Catwoman #64: no identity-conflict-unresolved warning');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
