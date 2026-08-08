// tests/q140-coherent-content-token-lane.test.js
//
// GrailKey Dispatch 32 (2026-08-08) — the Q140 coherent-content-token lane
// (2026-07-22) is DELETED. Real-corpus audit (47 real production scans)
// found it fired 15 times and produced a beneficial title correction in
// ZERO of them — every firing was marketplace SEO copy, seller-listing
// boilerplate, or story/character content, never the product-identifying-
// edition-word shape it was built for (the one real motivating incident,
// Adventure Time Summer Special SDCC, is itself not in the 47-scan corpus
// and stays a named, explicitly unresolved gap — see Part 2 below). Full
// writeup: docs/PATTERN-LIBRARY.md, "coherent-content lane deletion" and
// "SDCC-fix-scope-correction" entries.
//
// This file now verifies the deletion is real (Part 1: the lane's own
// admission branch can never fire again, regardless of member support)
// and exercises its replacement — a STANDALONE typed event/imprint
// routing mechanism (matchKnownPublisherImprintEventTokens,
// KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES) that answers a narrower question:
// not "may this token enter the title," but "may this token, if it's a
// KNOWN named event/imprint AND family-corroborated, route to
// confirmedVariant as a side channel while the title itself stays
// blocked." CLASSIFICATION IS NOT AUTHORITY — matching a known phrase
// only answers what KIND a token is; the >=3-member floor is what answers
// whether it's authoritative for this specific family. Both are required.
//
// Part 3 (X-Men Anniversary Special, family-scoped issue adoption) and
// Part 4 (Captain Marvel #17/Q119, Batman lot/LOT_RE, Eternus thin-pool)
// are UNCHANGED from the original Q140 dispatch — none of those mechanisms
// depended on the deleted lane, confirmed by this file itself staying
// green on them throughout this rewrite.
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
// Part 1 — applyDualAxisGate: the lane is gone, the typed replacement works
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: applyDualAxisGate — lane deleted, standalone typed routing\n');

{
  // The lane's own admission case, restated as a deletion proof: every
  // added token corroborated by 5/5 members, NONE of them a known event/
  // imprint phrase → must stay BLOCKED now, regardless of how high member
  // support climbs. This is the exact fixture the deleted lane used to
  // admit — it is the reintroduction guard for the lane itself.
  const memberTokens = Array.from({ length: 5 }, () => ['adventure', 'time', 'summer', 'special']);
  const g = applyDualAxisGate(['adventure', 'time', 'summer', 'special'], ['adventure', 'time'], new Set(), null, memberTokens);
  assertFalse(g.allowed, `high member support (5/5) no longer admits a non-creator, non-event addition — lane is gone (${g.reason})`);
  assertFalse(/coherent-content tokens/.test(g.reason), `reason string never cites the deleted lane again (${g.reason})`);
  assertEq(g.admittedVariantTokens.length, 0, 'no known event/imprint phrase present — nothing routed to variant either');
}

{
  // Gears of War #1 class, real corpus shape — mixed addition: "wildstorm"
  // is a KNOWN imprint (classification) AND corroborated 4/6 (authority);
  // "reader"/"collecting" are neither. Title must stay blocked in full;
  // ONLY the classified+corroborated token routes to admittedVariantTokens.
  const memberTokens = [
    ['gears', 'of', 'war', 'wildstorm', 'reader', 'collecting'],
    ['gears', 'of', 'war', 'wildstorm', 'reader', 'collecting'],
    ['gears', 'of', 'war', 'wildstorm', 'reader', 'collecting'],
    ['gears', 'of', 'war', 'wildstorm', 'reader', 'collecting'],
    ['gears', 'of', 'war'],
    ['gears', 'of', 'war'],
  ];
  const g = applyDualAxisGate(
    ['gears', 'of', 'war', 'wildstorm', 'reader', 'collecting'], ['gears', 'of', 'war'],
    new Set(), null, memberTokens
  );
  assertFalse(g.allowed, `title stays blocked even though "wildstorm" is a known, corroborated imprint (${g.reason})`);
  assertEq(g.admittedTitleTokens.length, 0, '"reader"/"collecting" do NOT enter admittedTitleTokens — no canonical-title promotion by marketplace repetition');
  assertTrue(g.admittedVariantTokens.length === 1 && g.admittedVariantTokens[0] === 'wildstorm', `"wildstorm" alone routes to admittedVariantTokens (got [${g.admittedVariantTokens.join(',')}])`);
}

{
  // CLASSIFICATION IS NOT AUTHORITY: "sdcc" is on the known-event list
  // (classification) but only 2/5 member support (fails authority) → must
  // NOT route to variant. A token being a recognized type of claim does
  // not by itself establish it belongs to this family.
  const memberTokens = [
    ['adventure', 'time', 'sdcc'],
    ['adventure', 'time', 'sdcc'],
    ['adventure', 'time'],
    ['adventure', 'time'],
    ['adventure', 'time'],
  ];
  const g = applyDualAxisGate(['adventure', 'time', 'sdcc'], ['adventure', 'time'], new Set(), null, memberTokens);
  assertFalse(g.allowed, `classified-but-uncorroborated event token stays blocked from title (${g.reason})`);
  assertEq(g.admittedVariantTokens.length, 0, '"sdcc" classified as EVENT type but only 2/5 support — classification alone does not grant authority, nothing routed');
}

{
  // Inverse control: "sdcc" corroborated 5/5 — classification AND
  // authority both clear → routes to variant, title still blocked (title
  // promotion by marketplace repetition is gone regardless of corroboration
  // strength; only the typed variant side-channel survives).
  const memberTokens = Array.from({ length: 5 }, () => ['adventure', 'time', 'sdcc']);
  const g = applyDualAxisGate(['adventure', 'time', 'sdcc'], ['adventure', 'time'], new Set(), null, memberTokens);
  assertFalse(g.allowed, `title stays blocked even at full 5/5 corroboration — no title-admission path exists anymore (${g.reason})`);
  assertTrue(g.admittedVariantTokens.length === 1 && g.admittedVariantTokens[0] === 'sdcc', `"sdcc" — classified AND corroborated — routes to variant (got [${g.admittedVariantTokens.join(',')}])`);
}

{
  // annual/giant-size/summer special/special deliberately excluded from
  // the known-phrase list (see KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES'
  // own comment) — even at full corroboration, these never classify as
  // EVENT type, so they can never route to variant. Two real corpus books
  // (giant size doctor strange #1, Marvel 85th Anniversary Special #1)
  // have these as CANONICAL title content, not routable descriptors.
  const memberTokens = Array.from({ length: 5 }, () => ['giant', 'size']);
  const g = applyDualAxisGate(['giant', 'size'], ['doctor', 'strange'], new Set(), null, memberTokens);
  assertEq(g.admittedVariantTokens.length, 0, '"giant"/"size" never classify as EVENT type — not on the list, never routed, at any corroboration level');
}

{
  // No familyMemberTokens passed at all → typed routing disabled too,
  // pre-Q140 behavior preserved exactly.
  const g = applyDualAxisGate(['flash', 'gorilla', 'grodd'], ['the', 'flash'], new Set());
  assertFalse(g.allowed, `omitting familyMemberTokens preserves pre-Q140 block (${g.reason})`);
  assertEq(g.admittedVariantTokens.length, 0, 'no familyMemberTokens → no typed routing either');
}

{
  // Creator-pair recovery still takes priority (Q132 unaffected) —
  // recovered tokens never reach the typed-routing check at all.
  const memberTokens = Array.from({ length: 5 }, () => ['wonder', 'woman', 'jenny', 'frison']);
  const g = applyDualAxisGate(
    ['wonder', 'woman', 'david', 'nakayama'], ['wonder', 'woman'],
    new Set(['nakayama']), 'Wonder Woman David Nakayama Variant', memberTokens
  );
  assertTrue(g.allowed && /adjacent-pair recovered/.test(g.reason), `creator-pair recovery still wins first (${g.reason})`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — Adventure Time Summer Special (SDCC) — NAMED, EXPLICITLY
// UNRESOLVED gap. Real production incident, not in the 47-scan audit
// corpus. "sdcc"/"convention"/"exclusive" ARE on the typed event/imprint
// list now (GrailKey Dispatch 32) — but "summer"/"special" are NOT (they
// are the book's real, canonical PriceCharting product-name content —
// see giant size doctor strange #1 / Marvel 85th Anniversary Special #1
// in the frozen 15-case corpus, both real corpus books where a word from
// this same excluded set is genuinely canonical). Routing sdcc/exclusive
// alone would produce a partial, misleading fix; this dispatch does not
// ship one. Fixing this book for real requires the post-catalog title
// finalization project (docs/PATTERN-LIBRARY.md, named open
// infrastructure project) — reconciling "summer special" against CV/PC's
// own catalog name, not marketplace-pool repetition. Every assertion
// below is against the REAL exported functions, matching the verified
// trace recorded in GrailKey Dispatch 32.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: Adventure Time Summer Special (SDCC) — reopened, named, unresolved\n');

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
assertEq(atResult.decision, 'fallback-vision', `title-admission gap is real and named, not silently fixed (got ${atResult.decision})`);
assertEq(atResult.selectedTitle, null, 'selectedTitle is null — falls through to Vision\'s own bare "Adventure Time" downstream, never the SDCC pollution');
assertTrue(atResult.titleAxisOnlyBlock === true, 'genuine title-axis-only block — Commit 4.3\'s qualified-family-retention branch gets a chance to independently rescue issue/year');
// Real, verified weight data (GrailKey Dispatch 32 reachability trace) —
// the SDCC family (14.0, 5 members) does NOT dominate the KaBOOM runner-up
// (5.0, 5 members) by the required 3x margin (14 < 15, a one-point miss).
// This is a genuine, narrow gap in Commit 4.3's rescue, NOT grounds to
// tune the 3x margin — see docs/PATTERN-LIBRARY.md's "3x margin" entry.
assertEq(atResult.topFamily?.weightSum, 14, 'topFamily weightSum matches the verified real trace (14.0)');
assertEq(atResult.runnerUp?.weightSum, 5, 'runnerUp weightSum matches the verified real trace (5.0) — margin required is 15, actual is 14');

// resolveIdentity, with a realistic ebayResultCount (the real production
// pool size) and a deliberately adversarial wrong pool-wide ebay.issue
// vote ('5', reflecting the KaBOOM family) — matches GrailKey Dispatch
// 32's own verified trace exactly.
const atIdentity = resolveIdentity(
  { title: 'Adventure Time', issue: null, year: null, publisher: null },
  { title: 'Adventure Time', issue: '5', year: 2016, publisher: null },
  atResult,
  { visualItems: ADVENTURE_TIME_POOL, ebayResultCount: 20 }
);
assertEq(atIdentity.confirmedTitle, 'Adventure Time', 'confirmedTitle is the CLEAN bare stem — no SDCC pollution, no KaBOOM pollution either');
assertEq(atIdentity.confirmedIssue, null, 'confirmedIssue is HONEST NULL — not the wrong pool-wide vote "5", not a fabricated "1" either. Margin miss means Commit 4.3 does not rescue this book, but the failure mode is honest-incomplete, not confidently-wrong: the exact acceptable class this codebase has ruled non-launch-blocking every time it has come up.');

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
