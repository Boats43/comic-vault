// tests/q144a-family-discriminator-gate.test.js
//
// Q144A dispatch (2026-07-22, Adventure Time Summer Special SDCC class) —
// third PC-anchor axis: family-required discriminator. Q140 already
// resolves the winning title family correctly ("Adventure Time Summer
// Special #1 SDCC Convention Exclusive 2013"), but PC's own search still
// anchors to the plain, generic "Adventure Time Comics #1 (2012)" /
// "Adventure Time #1 (2016)" (drifting across rescans). The existing name
// axis (pcMatchConflictsWithPoolName) checks against the WHOLE
// undifferentiated visual pool — mixing the winning SDCC family with the
// competing plain-series family — so the shared stem "adventure time"
// gives the wrong PC candidate a passing overlap ratio. The new axis
// (pcMatchMissingFamilyDiscriminator, variantIdentity.js) checks against
// the WINNING family's own member titles: reject when a >=60%-adopted
// series-marker phrase ("summer special") is reflected nowhere in the PC
// product name.
//
// False-positive guards (both explicitly verified below):
//   - Kamala Khan class: "kamala khan"/"1st appearance"/"2nd print"
//     dominate the real Captain Marvel #17 pool but describe story content
//     / copy state, not a different product — candidacy is restricted to
//     phrases anchored on detectSeriesMarkers or classifyVariantTokens
//     specific registries, and ONLY series-marker phrases can reject.
//   - Variant-cover-pool class (G.O.D.S. / One World Under Doom quadrant
//     d): a MegaCon/SDCC-exclusive pool legitimately anchors to the plain
//     base PC product — convention/exclusive tokens anchor candidacy and
//     corroborate on the accept side but never reject alone.
//
// Invoke: node tests/q144a-family-discriminator-gate.test.js

import {
  pcMatchMissingFamilyDiscriminator,
  pcMatchConflictsWithPoolName,
  pcMatchConflictsWithPoolYear,
} from '../src/lib/variantIdentity.js';
import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q144A — family-required discriminator PC-anchor gate ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — unit behavior: guards and floors
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: unit behavior — guards and floors\n');

assertFalse(pcMatchMissingFamilyDiscriminator(null, ['Adventure Time Summer Special #1']), 'no PC name → no conflict (nothing to check)');
assertFalse(pcMatchMissingFamilyDiscriminator('Adventure Time #1 (2016)', null), 'null family titles → no conflict (no crash)');
assertFalse(pcMatchMissingFamilyDiscriminator('Adventure Time #1 (2016)', []), 'empty family titles → no conflict');
assertFalse(pcMatchMissingFamilyDiscriminator('Adventure Time #1 (2016)', [null, undefined, '']), 'all-junk family titles → no conflict (no crash)');
assertFalse(
  pcMatchMissingFamilyDiscriminator('Adventure Time #1 (2016)', [
    'Adventure Time Summer Special #1 SDCC 2013',
    'Adventure Time Summer Special #1 SDCC 2013 NM',
  ]),
  '2-member family below the >=3 "family is real" floor (Q38/Q133-Slice-2/Q140 convention) → no conflict'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — the real Adventure Time Summer Special SDCC case. Pool shape
// reused exactly from tests/q140-coherent-content-token-lane.test.js
// (ADVENTURE_TIME_POOL) — the closest available reconstruction of the
// real production pool. The winning-family member titles are derived the
// SAME way api/enrich.js derives them: selectTitleFamilyCandidate →
// topFamily.indices → mapped back into the pool.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: Adventure Time Summer Special #1 SDCC — the real case\n');

const ADVENTURE_TIME_POOL = [
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 VF',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 High Grade',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 In Hand',
  'Adventure Time #1 KaBOOM 2012',
  'Adventure Time #1 KaBOOM 2012 NM',
  'Adventure Time #1 KaBOOM Comics',
  'Adventure Time #1 VF 2012',
  'Adventure Time #1 2012 High Grade',
];

const atFamily = selectTitleFamilyCandidate(ADVENTURE_TIME_POOL, 'Adventure Time', null, null, {
  ebayConsensusTitle: 'Adventure Time',
});
const atWinningTitles = (atFamily?.topFamily?.indices || [])
  .map((idx) => ADVENTURE_TIME_POOL[idx])
  .filter(Boolean);

assertEq(atFamily.decision, 'weighted-consensus', `Q140 baseline intact: family resolves via weighted-consensus (got ${atFamily.decision})`);
assertEq(atWinningTitles.length, 5, `topFamily.indices reconstructs exactly the 5 SDCC member titles (got ${atWinningTitles.length})`);
assertTrue(atWinningTitles.every((t) => /summer special/i.test(t)), 'every reconstructed member title is from the SDCC family, not the KaBOOM family');

// Root-cause documentation: the EXISTING name axis passes the wrong PC
// candidate — against the whole mixed pool AND even against the winning
// family's own titles (shared "adventure time" stem overlaps fully) —
// proving a new axis was needed, not just pool narrowing.
assertFalse(
  pcMatchConflictsWithPoolName('Adventure Time Comics #1 (2012)', ADVENTURE_TIME_POOL),
  'root cause: existing name axis PASSES the wrong PC candidate against the whole mixed pool'
);
assertFalse(
  pcMatchConflictsWithPoolName('Adventure Time Comics #1 (2012)', atWinningTitles),
  'root cause: existing name axis PASSES the wrong PC candidate even against the winning family alone (stem fully overlaps) — pool narrowing alone would not have fixed this'
);

// Fixture 1 — wrong generic PC anchors REJECTED.
assertTrue(
  pcMatchMissingFamilyDiscriminator('Adventure Time Comics #1 (2012)', atWinningTitles),
  'fixture 1a: PC "Adventure Time Comics #1 (2012)" rejected — misses the family\'s "summer special" discriminator'
);
assertTrue(
  pcMatchMissingFamilyDiscriminator('Adventure Time #1 (2016)', atWinningTitles),
  'fixture 1b: PC "Adventure Time #1 (2016)" (the drift target) rejected on the same discriminator'
);

// Fixture 2 — the genuinely-correct PC product ACCEPTED.
assertFalse(
  pcMatchMissingFamilyDiscriminator('Adventure Time Summer Special #1 (2013)', atWinningTitles),
  'fixture 2: PC "Adventure Time Summer Special #1 (2013)" accepted — carries the discriminator'
);
// Convention-lane corroboration: a PC product named by its convention
// rather than its "Summer Special" moniker must also be accepted (PC
// product names are terse — they encode the edition through ONE marker).
assertFalse(
  pcMatchMissingFamilyDiscriminator('Adventure Time SDCC #1 (2013)', atWinningTitles),
  'fixture 2b: PC "Adventure Time SDCC #1 (2013)" accepted — convention token corroborates even without the "summer special" wording'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — G.O.D.S. / One World Under Doom controls (pools reused exactly
// from tests/q139-godds-acronym-tokenizer.test.js). The new axis must not
// misfire in either direction: quadrants (a)/(b) keep rejecting via the
// existing acronym directions, quadrants (c)/(d) keep accepting — the new
// axis stays inert on all four (no series-marker phrases anywhere).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: G.O.D.S. controls — combined 3-axis outcomes byte-identical\n');

const oneWorldPool = [
  'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM',
  'ONE WORLD UNDER DOOM #1 John Giang Signed with COA Megacon 2025 Secret Drop',
  'One World Under Doom #1 John Giang MegaCon Secret Drop Signed Remarked LTD 500',
  'One World Under Doom #1 John Giang MegaCon Exclusive Virgin (unsigned)',
];
const godsPool = [
  'G.O.D.S. #1 One World Under Doom Tie-In Marvel 2025 NM',
  'G.O.D.S #1 (2025) Marvel One World Under Doom',
  'GODS 1 Marvel Comics 2025 One World Under Doom Tie In',
  'G.O.D.S. One World Under Doom #1 Marvel NM',
];

const threeAxis = (pcName, pool, familyTitles) =>
  pcMatchConflictsWithPoolName(pcName, pool) || pcMatchMissingFamilyDiscriminator(pcName, familyTitles);

// New axis alone: inert on every quadrant (convention/exclusive tokens
// dominate the MegaCon pool but can never reject alone — that is the
// variant-cover-pool false-positive guard).
assertFalse(pcMatchMissingFamilyDiscriminator('G.O.D.S.: One World Under Doom #1 (2025)', oneWorldPool), 'quadrant (a): new axis inert (existing acronym direction owns this rejection)');
assertFalse(pcMatchMissingFamilyDiscriminator('One World Under Doom #1 (2025)', godsPool), 'quadrant (b): new axis inert (existing pool-consensus acronym direction owns this rejection)');
assertFalse(pcMatchMissingFamilyDiscriminator('G.O.D.S.: One World Under Doom #1 (2025)', godsPool), 'quadrant (c): new axis inert — correct match stays accepted');
assertFalse(pcMatchMissingFamilyDiscriminator('One World Under Doom #1 (2025)', oneWorldPool), 'quadrant (d): new axis inert — MegaCon variant-cover pool does NOT strip the base-product anchor (the critical variant-pool guard)');

// Combined 3-axis outcomes match q139 exactly.
assertTrue(threeAxis('G.O.D.S.: One World Under Doom #1 (2025)', oneWorldPool, oneWorldPool), 'combined quadrant (a): still REJECTED — exactly as q139');
assertTrue(threeAxis('One World Under Doom #1 (2025)', godsPool, godsPool), 'combined quadrant (b): still REJECTED — exactly as q139');
assertFalse(threeAxis('G.O.D.S.: One World Under Doom #1 (2025)', godsPool, godsPool), 'combined quadrant (c): still ACCEPTED — exactly as q139');
assertFalse(threeAxis('One World Under Doom #1 (2025)', oneWorldPool, oneWorldPool), 'combined quadrant (d): still ACCEPTED — exactly as q139');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — Kamala Khan / Captain Marvel #17 (2014): the critical false-
// positive control. Pool reused exactly from tests/q140-coherent-content-
// token-lane.test.js lines ~192-199 (real production shape). "captain
// marvel"/"kamala khan" (6/6), "2nd print" (4/6) all clear a naive 60%
// bigram floor — none may reject the genuinely-correct plain PC anchor.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Kamala Khan control — content/copy-state phrases never reject\n');

const kamalaPool = [
  'Captain Marvel #17 1st Kamala Khan (in costume) Cover 2ND PRINT VF+',
  'Captain Marvel #17 1st Appearance of Kamala Khan!! Cover 2ND PRINT VF+',
  'Captain Marvel #17 2nd print CBCS 9.8, Kamala Khan, not CGC',
  'CAPTAIN MARVEL #17 2ND KAMALA KHAN APPEARANCE MARVEL 2014',
  'Captain Marvel #17 2nd Print CGC 9.6 1st App Of Kamala Khan',
  'Captain Marvel #17 Marvel Comics 2014 2nd Appearance Kamala Khan CGC 9.6',
];
assertFalse(
  pcMatchMissingFamilyDiscriminator('Captain Marvel #17 (2014)', kamalaPool),
  'Captain Marvel #17: plain PC anchor ACCEPTED — "kamala khan" (story content, no registry anchor) and "2nd print" (printing category, non-rejecting) never fire the gate'
);
assertFalse(
  threeAxis('Captain Marvel #17 (2014)', kamalaPool, kamalaPool),
  'Captain Marvel #17: combined 3-axis check still accepts (no regression from any axis)'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — benign metadata omission control: seller boilerplate ("Near
// Mint," "With COA") at 100% adoption, PC candidate mentions none of it —
// must NOT reject ('coa' is an authentication token so the phrase IS a
// candidate, but authentication describes a physical copy, not a product
// line; only series-marker phrases reject).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: benign metadata omission control\n');

const benignPool = [
  'Batman #423 DC Comics 1988 Near Mint With COA',
  'Batman #423 DC 1988 Near Mint With COA McFarlane Cover',
  'Batman #423 DC Comics Near Mint With COA High Grade',
];
assertFalse(
  pcMatchMissingFamilyDiscriminator('Batman #423 (1988)', benignPool),
  'benign control: PC missing "near mint"/"with coa" boilerplate (100% adoption) → still ACCEPTED'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 6 — end-to-end call-site simulation (mirrors the extended
// api/enrich.js gate — same convention as q133's simulateGate, with the
// third axis added exactly as wired).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: extended gate — end-to-end call-site simulation\n');

function simulateGate({ priceCharting, poolYearHint, poolRawTitles, familyMemberTitles, confirmedYearMeta, confirmedYear }) {
  const out = {
    pcProductId: priceCharting?.id ?? null,
    pcProductName: priceCharting?.productName ?? null,
    confirmedYearMeta,
  };
  let pc = priceCharting;
  let cy = confirmedYear;
  if (pc) {
    const yearConflict = pcMatchConflictsWithPoolYear(pc.year, poolYearHint);
    const nameConflict = pcMatchConflictsWithPoolName(pc.productName, poolRawTitles);
    const discriminatorConflict = pcMatchMissingFamilyDiscriminator(pc.productName, familyMemberTitles);
    if (yearConflict || nameConflict || discriminatorConflict) {
      out.pcMatchRejectedForYearConflict = {
        rejectedProductName: pc.productName,
        conflictAxes: [yearConflict && 'year', nameConflict && 'name', discriminatorConflict && 'discriminator'].filter(Boolean).join('+'),
      };
      out.pcProductId = null;
      out.pcProductName = null;
      pc = null;
      if (poolYearHint?.year != null && confirmedYearMeta?.source === 'pricecharting') {
        cy = String(poolYearHint.year);
        out.confirmedYearMeta = { value: cy, source: 'pc-anchor-rejected-corrected', confidence: 'proven' };
      }
    }
  }
  return { out, priceCharting: pc, confirmedYear: cy };
}

// The real Adventure Time shape: wrong plain-series PC anchor, winning
// family = the 5 SDCC titles, poolYearHint 2013 (the SDCC family's own
// year), confirmedYear wrongly derived from the rejected PC match.
{
  const r = simulateGate({
    priceCharting: { id: 555001, productName: 'Adventure Time Comics #1 (2012)', year: 2012 },
    poolYearHint: { year: 2013, agreement: 1.0, sampleSize: 5 },
    poolRawTitles: ADVENTURE_TIME_POOL,
    familyMemberTitles: atWinningTitles,
    confirmedYearMeta: { source: 'pricecharting' },
    confirmedYear: 2012,
  });
  assertEq(r.priceCharting, null, 'Adventure Time: PC anchor rejected end-to-end');
  assertEq(r.out.pcMatchRejectedForYearConflict.conflictAxes, 'discriminator', 'Adventure Time: rejected specifically and only on the NEW discriminator axis (year drift 1y — year axis inert; name axis passes on the shared stem)');
  assertEq(r.out.pcProductName, null, 'Adventure Time: out.pc* fields cleared, same disposition as the existing axes');
  assertEq(r.confirmedYear, '2013', 'Adventure Time: confirmedYear corrected 2012 → 2013 (poolYearHint present, source was pricecharting) — correction path works identically for the new axis');
}

// Discriminator rejection with a non-PC confirmedYear source: year must be
// left untouched (same discipline as the existing name-axis Lozano case).
{
  const r = simulateGate({
    priceCharting: { id: 555002, productName: 'Adventure Time #1 (2016)', year: 2016 },
    poolYearHint: null,
    poolRawTitles: ADVENTURE_TIME_POOL,
    familyMemberTitles: atWinningTitles,
    confirmedYearMeta: { source: 'comicvine' },
    confirmedYear: 2013,
  });
  assertEq(r.priceCharting, null, 'Adventure Time (drift target, no poolYearHint): still rejected on discriminator axis');
  assertEq(r.confirmedYear, 2013, 'Adventure Time: confirmedYear untouched — no poolYearHint AND source was comicvine');
}

// Agreeing control (real Poison Ivy #31 values from q133): all three axes
// inert — byte-identical accept.
{
  const poisonIvy31Pool = [
    'Poison Ivy #31 Variant Signed by Jenny Frison 2025 w/COA..',
    'Poison Ivy #31 Variant Cover B SIGNED by Jenny Frison WITH COA 2025 NM',
    'Poison Ivy #31 Signed By Jennie Frison With Coa',
  ];
  const r = simulateGate({
    priceCharting: { id: 8756158, productName: 'Poison Ivy #31 (2025)', year: 2025 },
    poolYearHint: { year: 2024, agreement: 0.55, sampleSize: 11 },
    poolRawTitles: poisonIvy31Pool,
    familyMemberTitles: poisonIvy31Pool,
    confirmedYearMeta: { source: 'pc-cv-agreement' },
    confirmedYear: 2024,
  });
  assertTrue(!!r.priceCharting, 'Poison Ivy #31: PC match kept — all three axes agree, byte-identical to q133');
  assertEq(r.out.pcMatchRejectedForYearConflict, undefined, 'Poison Ivy #31: no rejection annotation');
}

// No family at all (familyCandidate null / topFamily null — enrich derives
// an empty title list): new axis inert, existing axes unaffected.
{
  const batmanPool = ['Batman #608 (2002) Jim Lee Hush Cover A', 'Batman #608 Hush Part 1 2002'];
  const r = simulateGate({
    priceCharting: { id: 999001, productName: 'Batman #608 (2002)', year: 2002 },
    poolYearHint: null,
    poolRawTitles: batmanPool,
    familyMemberTitles: [],
    confirmedYearMeta: { source: 'pricecharting' },
    confirmedYear: 2002,
  });
  assertTrue(!!r.priceCharting, 'Batman #608 (no family titles derived): PC match kept — new axis inert on an empty family list');
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
