// tests/q140-coherent-content-token-lane.test.js
//
// Q140 dispatch (2026-07-22) — the coherent-content-token lane, the one
// LAUNCH-BLOCKING item identified in docs/LAUNCH-AUDIT.md Section 2.
// Adventure Time Summer Special #1 (SDCC) class: Vision and the eBay
// visual pool both agreed on the bare stem "Adventure Time" (dual-axis
// agreement, Q84), but the family's own consensus additions
// (summer/special/sdcc/convention/exclusive — real, corroborated PRODUCT-
// identifying words, not creator names) were blocked wholesale by the
// existing Q84/Q132 gate, which only ever had a creator-token lane. The
// override fell back to bare "Adventure Time," and downstream PC/CV
// queries anchored to a wrong, different "Adventure Time" product each
// rescan (anchor drift across three different wrong products on an
// ambiguous stem) — a confidently-wrong price with no honest-null/RESEARCH
// safety net to catch it, since every upstream signal agreed.
//
// Fix (two parts):
//   1. applyDualAxisGate (imageSearchIdentity.js) — a still-blocked
//      addition is allowed when EVERY token in it is independently
//      corroborated by >=3 distinct family members (reusing Q38/Q133-
//      Slice-2's existing ">=3 members = this family is real" floor, not a
//      new number). A single scattered/1-2-member token anywhere in the
//      set keeps the WHOLE addition blocked, byte-identical to pre-Q140.
//      Evaluated strictly AFTER Q119's narrower whitelist-verified compound
//      completion has had its chance (Captain Marvel #17 class: "kamala"/
//      "khan" also clear the >=3-member floor by a wide margin, but they
//      describe story CONTENT true of every copy of the issue, not which
//      PRODUCT this is — adopting them into the title would corrupt the
//      PC/CV query for a book whose real name is just "Captain Marvel";
//      Q119's narrow single-word recovery is the correct, existing answer
//      for that shape and must keep priority).
//   2. resolveIdentity (identityCore.js) — family-scoped issue adoption.
//      The FAMILY_OVERRIDE_DECISIONS branch always backfilled confirmedIssue
//      from the POOL-WIDE ebay.issue vote; on an ambiguous stem that vote
//      can reflect a DIFFERENT family than the one that just won the
//      override. Now extracts "#N" from the winning family's own
//      topFamily.rawTitle first (same pool-mode mechanism the refused-
//      identity-conflict branch already used), falling back to the old
//      ebay.issue/vision.issue chain only when the family's own rawTitle
//      carries no issue token (X-Men Anniversary Special class, Q12c's
//      original case).
//
// Invoke: node tests/q140-coherent-content-token-lane.test.js

import {
  selectTitleFamilyCandidate,
  scoreTitleFamilies,
  buildTitleFamilies,
  applyDualAxisGate,
  extractPoolArtistTokens,
} from '../src/lib/imageSearchIdentity.js';
import { resolveIdentity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q140 — coherent-content-token lane ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — applyDualAxisGate unit behavior
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: applyDualAxisGate — coherent vs scattered\n');

{
  // Every added token corroborated by >=3 of 5 members → allowed.
  const memberTokens = Array.from({ length: 5 }, () => ['adventure', 'time', 'summer', 'special']);
  const g = applyDualAxisGate(['adventure', 'time', 'summer', 'special'], ['adventure', 'time'], new Set(), null, memberTokens);
  assertTrue(g.allowed, `coherent addition (5/5 support each) allowed (${g.reason})`);
  assertTrue(/coherent-content tokens/.test(g.reason), `reason cites coherent-content lane (${g.reason})`);
}

{
  // "special" only corroborated by 2/5 members → whole addition stays blocked.
  const memberTokens = [
    ['adventure', 'time', 'summer', 'special'],
    ['adventure', 'time', 'summer', 'special'],
    ['adventure', 'time', 'summer'],
    ['adventure', 'time', 'summer'],
    ['adventure', 'time'],
  ];
  const g = applyDualAxisGate(['adventure', 'time', 'summer', 'special'], ['adventure', 'time'], new Set(), null, memberTokens);
  assertFalse(g.allowed, `scattered token (2/5 support) keeps the WHOLE addition blocked (${g.reason})`);
  assertTrue(/non-creator additions/.test(g.reason), `block reason unchanged (${g.reason})`);
}

{
  // No familyMemberTokens passed at all → lane disabled, pre-Q140 behavior.
  const g = applyDualAxisGate(['flash', 'gorilla', 'grodd'], ['the', 'flash'], new Set());
  assertFalse(g.allowed, `omitting familyMemberTokens preserves pre-Q140 block (${g.reason})`);
}

{
  // Creator-pair recovery still takes priority over the coherent-content
  // lane (Q132 unaffected) — recovered tokens never reach the coherence
  // check at all.
  const memberTokens = Array.from({ length: 5 }, () => ['wonder', 'woman', 'jenny', 'frison']);
  const g = applyDualAxisGate(
    ['wonder', 'woman', 'david', 'nakayama'], ['wonder', 'woman'],
    new Set(['nakayama']), 'Wonder Woman David Nakayama Variant', memberTokens
  );
  assertTrue(g.allowed && /adjacent-pair recovered/.test(g.reason), `creator-pair recovery still wins first (${g.reason})`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — Adventure Time Summer Special (SDCC) — representative
// reconstruction of the real bug class. Not a byte-exact replay of the
// full 20-item production pool (not available in this context) — a
// smaller pool with the same structural shape: dual-axis agreement on the
// bare stem, a >=3-member coherent family carrying real product-
// identifying words the pre-Q140 gate blocked wholesale.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: Adventure Time Summer Special (SDCC) — representative reconstruction\n');

const ADVENTURE_TIME_POOL = [
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 VF',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 High Grade',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 In Hand',
  // A different, unrelated "Adventure Time" product — the wrong-anchor
  // class this bug actually produced in production (PC/CV matched THIS
  // shape, not the SDCC special).
  'Adventure Time #1 KaBOOM 2012',
  'Adventure Time #1 KaBOOM 2012 NM',
  'Adventure Time #1 KaBOOM Comics',
  'Adventure Time #1 VF 2012',
  'Adventure Time #1 2012 High Grade',
];

const atResult = selectTitleFamilyCandidate(ADVENTURE_TIME_POOL, 'Adventure Time', null, null, {
  ebayConsensusTitle: 'Adventure Time',
});
assertEq(atResult.decision, 'weighted-consensus', `resolves via weighted-consensus, not fallback-vision (got ${atResult.decision})`);
assertTrue(/summer/i.test(atResult.selectedTitle || ''), `selectedTitle carries "summer" (got "${atResult.selectedTitle}")`);
assertTrue(/special/i.test(atResult.selectedTitle || ''), `selectedTitle carries "special" (got "${atResult.selectedTitle}")`);
assertFalse(/kaboom|2012/i.test(atResult.selectedTitle || ''), `selectedTitle does NOT pick up the wrong-anchor family's own tokens (got "${atResult.selectedTitle}")`);
assertEq(atResult.topFamily?.rawTitle, 'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013', 'winning family is the SDCC cluster, not the KaBOOM cluster');

// Family-scoped issue adoption (Part 2 of the fix) — simulate the
// pool-wide ebay.issue vote reflecting the WRONG (KaBOOM) family, as the
// real anchor-drift evidence suggests happens on this ambiguous stem.
// Q140 corrective dispatch (2026-07-23) — opts.visualItems must be passed
// (the real ADVENTURE_TIME_POOL, matching production's call shape where
// resolveIdentity always receives opts.visualItems: parsedVisualRows) so
// the aggregate consensus can actually read the winning family's member
// rows. The single-row topFamily.rawTitle shortcut this test originally
// exercised no longer exists — see resolveFamilyIssueConsensus.
const atIdentity = resolveIdentity(
  { title: 'Adventure Time', issue: null, year: null, publisher: null },
  { title: 'Adventure Time', issue: '5', year: 2016, publisher: null }, // wrong pool-wide anchor
  atResult,
  { visualItems: ADVENTURE_TIME_POOL }
);
assertTrue(/summer/i.test(atIdentity.confirmedTitle) && /special/i.test(atIdentity.confirmedTitle),
  `resolveIdentity title carries the SDCC family's own identity (got "${atIdentity.confirmedTitle}")`);
assertEq(atIdentity.confirmedIssue, '1', `family-scoped issue adoption: "#1" from aggregate consensus across the WINNING family's own 5 rows, not the wrong pool-wide vote "5" (got "${atIdentity.confirmedIssue}")`);

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — family-scoped issue adoption: X-Men Anniversary Special
// control (Q12c's original case — family's own rawTitle has NO issue
// token at all; must still fall back to the pool-wide ebay.issue, exactly
// as before Q140).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: family-scoped issue adoption — X-Men Anniversary Special control\n');

{
  const family = {
    decision: 'weighted-consensus',
    selectedTitle: 'X-Men Anniversary Special',
    topFamily: { rawTitle: 'X-Men Anniversary Special Marvel 1994', count: 6 },
  };
  const identity = resolveIdentity(
    { title: 'X-Men', issue: '1', year: 1994, publisher: 'Marvel' },
    { title: 'X-Men Anniversary Special', issue: '325', year: 1994, publisher: 'Marvel' },
    family,
    {}
  );
  assertEq(identity.confirmedIssue, '325', `no issue token in family's own rawTitle → falls back to pool-wide ebay.issue "325" (got "${identity.confirmedIssue}")`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — mandatory regression gate: cases that MUST still block
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: mandatory regression — must still block\n');

{
  // Q119 Captain Marvel #17 class — covered fully in its own dedicated
  // suite (tests/q119-compound-title-consolidation.test.js); re-verified
  // here as a compact inline control that the coherent-content lane does
  // NOT intercept it ahead of Q119's narrower compound-completion answer.
  const pool = [
    'Captain Marvel #17 1st Kamala Khan (in costume) Cover 2ND PRINT VF+',
    'Captain Marvel #17 1st Appearance of Kamala Khan!! Cover 2ND PRINT VF+',
    'Captain Marvel #17 2nd print CBCS 9.8, Kamala Khan, not CGC',
    'CAPTAIN MARVEL #17 2ND KAMALA KHAN APPEARANCE MARVEL 2014',
    'Captain Marvel #17 2nd Print CGC 9.6 1st App Of Kamala Khan',
    'Captain Marvel #17 Marvel Comics 2014 2nd Appearance Kamala Khan CGC 9.6',
  ];
  const r = selectTitleFamilyCandidate(pool, 'captain', '17', null, { ebayConsensusTitle: 'captain' });
  assertEq(r.selectedTitle, 'Captain Marvel', `Captain Marvel #17: Q119 compound completion still wins over the coherent-content lane (got "${r.selectedTitle}")`);
  assertFalse(/kamala/i.test(r.selectedTitle || ''), '"kamala" still NOT adopted into the title');
}

{
  // Batman #423 / Venom-lot noise class — a bulk-listing title reaching
  // the weighted-consensus path. Guarded by isLotFamily (LOT_RE), a
  // completely separate mechanism from the Q84 gate this dispatch
  // touches — confirms the coherent-content lane cannot accidentally
  // bypass it (LOT_RE short-circuits before q84Gate is ever called).
  const lotPool = [
    'Batman 125 Lot Huge Run DC Comics Bundle',
    'Batman 125 Lot Huge Run DC Comics Bundle NM',
    'Batman 125 Lot Huge Run DC Comics Bundle VF',
    'Batman #423 DC Comics 1988',
    'Batman #423 DC 1988 NM',
  ];
  const r = selectTitleFamilyCandidate(lotPool, 'Batman', '423', 1988, { ebayConsensusTitle: 'Batman' });
  assertFalse(/lot|huge|run|bundle/i.test(r.selectedTitle || ''), `LOT_RE guard unaffected by Q140 (got decision=${r.decision}, selected="${r.selectedTitle}")`);
}

{
  // Eternus #2 class — 2-member family, below the >=3 promotion floor
  // both mechanisms (Q133 Slice 2's identityRefusedPromotionEligible AND
  // Q140's coherent-content lane) reuse. Routed through selectTitleFamily
  // Candidate directly to confirm refused-identity-conflict / thin-pool
  // behavior is untouched by this dispatch (Q140 only ever engages inside
  // the weighted-consensus/top-rank-protection branches).
  const thinPool = [
    'Eternus #2 - NYCC Metal Virgin Variant Cover',
    'Eternus #2 NYCC Metal Virgin Variant',
    'He-Man #2 DC Comics 2023',
    'He-Man #2 DC 2023 NM',
    'He-Man #2 DC Comics 2023 VF',
  ];
  const r = selectTitleFamilyCandidate(thinPool, 'He-Man', '2', 2023, { ebayConsensusTitle: 'He-Man' });
  assertTrue(r.topFamily?.count < 3 || r.decision !== 'weighted-consensus' || !/eternus/i.test(r.selectedTitle || ''),
    `Eternus 2-member family stays below promotion floor / does not win via Q140 (decision=${r.decision}, selected="${r.selectedTitle}")`);
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
