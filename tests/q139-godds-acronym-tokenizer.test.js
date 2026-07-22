// tests/q139-godds-acronym-tokenizer.test.js
//
// G.O.D.S. dispatch (2026-07-22, One World Under Doom / Giang MegaCon
// class) — every tokenizer in this codebase that strips punctuation to
// whitespace before a length floor shares one structural bug: a punctuated
// acronym ("G.O.D.S.", "S.W.O.R.D.", "W.E.B.", "A.X.E.") decomposes into
// isolated single-letter tokens once the punctuation becomes whitespace,
// and every one of those tokens then falls below the length floor and is
// dropped — the acronym contributes ZERO tokens to whatever comparison
// consumes the tokenized output.
//
// Confirmed live: PriceCharting anchored "G.O.D.S.: One World Under Doom
// #1 (2025)" against a pool that is genuinely the plain "One World Under
// Doom #1" — pcMatchConflictsWithPoolName never saw "G.O.D.S." at all.
//
// Two-part fix:
//   1. normalizeAcronyms (compHygiene.js) collapses a punctuated acronym
//      into one joined token BEFORE any consumer's own strip-to-whitespace
//      regex runs — wired into all identified tokenizer functions.
//   2. Recovering the token alone is NOT sufficient — empirically, the
//      ratio/floor logic in pcMatchConflictsWithPoolName and the
//      ComicVine [cv-token-gate] tolerates ONE unaccounted-for token out
//      of several (0.83 ratio, still above the 0.5 floor). A second,
//      narrow, bidirectional "orphan acronym token" hard-reject rule
//      (extractAcronymTokens) closes that gap independently of ratio.
//
// Invoke: node tests/q139-godds-acronym-tokenizer.test.js

import { normalizeAcronyms, extractAcronymTokens, tokenizeTitle } from '../src/lib/compHygiene.js';
import { tokenizeTitleFamily } from '../src/lib/imageSearchIdentity.js';
import { pcMatchConflictsWithPoolName, pcMatchConflictsWithPoolYear } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const assertDeepEq = (actual, expected, label) => assertEq(JSON.stringify(actual), JSON.stringify(expected), label);

console.log('\n=== G.O.D.S. dispatch — acronym tokenizer fix ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — normalizeAcronyms unit behavior
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: normalizeAcronyms unit behavior\n');

assertEq(normalizeAcronyms('G.O.D.S.: One World Under Doom #1 (2025)'), 'GODS: One World Under Doom #1 (2025)', 'dotted-tight form collapses');
assertEq(normalizeAcronyms('G. O. D. S.: One World Under Doom #1'), 'GODS: One World Under Doom #1', 'spaced form collapses to the IDENTICAL result as the dotted form');
assertEq(normalizeAcronyms('G.O.D.S One World Under Doom'), 'GODS One World Under Doom', 'no-trailing-period form still fully collapses');
assertEq(normalizeAcronyms('S.W.O.R.D. #1 2025'), 'SWORD #1 2025', 'S.W.O.R.D. collapses (future-recurrence case named in the dispatch)');
assertEq(normalizeAcronyms('W.E.B. of Spider-Man'), 'WEB of Spider-Man', 'W.E.B. collapses (future-recurrence case named in the dispatch)');
assertEq(normalizeAcronyms('A.X.E. Judgment Day'), 'AXE Judgment Day', 'A.X.E. collapses (future-recurrence case named in the dispatch)');
assertEq(normalizeAcronyms('One World Under Doom #1 (no acronym)'), 'One World Under Doom #1 (no acronym)', 'plain title byte-identical — nothing to collapse');
assertEq(normalizeAcronyms('A. Smith drew this cover'), 'A. Smith drew this cover', 'single initial + ordinary word must NOT collapse (false-positive guard)');
assertEq(normalizeAcronyms('Dr. Strange Vol. 2'), 'Dr. Strange Vol. 2', '"Dr."/"Vol." are not single-letter units — must NOT collapse');
assertEq(normalizeAcronyms('U.S. Agent #1'), 'US Agent #1', 'genuine 2-letter acronym still collapses');
assertEq(normalizeAcronyms('G. I. Joe #1'), 'GI Joe #1', '"G.I. Joe"-style short acronym collapses correctly, leaving "Joe" untouched');
assertEq(normalizeAcronyms('Ms. Marvel #1'), 'Ms. Marvel #1', 'COMPOUND_WHITELIST entry "Ms. Marvel" (compHygiene.js) unaffected — "Ms." is not a single-letter+dot unit');
assertEq(normalizeAcronyms(''), '', 'empty string handled');
assertEq(normalizeAcronyms(null), null, 'null handled');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — extractAcronymTokens unit behavior
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: extractAcronymTokens unit behavior\n');

assertDeepEq(extractAcronymTokens('G.O.D.S.: One World Under Doom #1'), ['gods'], 'extracts the one acronym token');
assertDeepEq(extractAcronymTokens('One World Under Doom #1'), [], 'no acronym present — empty array');
assertDeepEq(extractAcronymTokens('G.O.D.S. #1 and S.W.O.R.D. #2'), ['gods', 'sword'], 'extracts multiple distinct acronyms in order');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — full-pipeline convergence: dotted and spaced forms must
// tokenize to the IDENTICAL token set through both tokenizeTitleFamily
// and tokenizeTitle (fixture-mandatory per the dispatch ruling).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: dotted/spaced convergence through the real tokenizers\n');

assertDeepEq(
  tokenizeTitleFamily('G.O.D.S.: One World Under Doom #1 (2025)'),
  tokenizeTitleFamily('G. O. D. S.: One World Under Doom #1 (2025)'),
  'tokenizeTitleFamily: dotted and spaced forms produce IDENTICAL token sets'
);
assertTrue(
  tokenizeTitleFamily('G.O.D.S.: One World Under Doom #1 (2025)').includes('gods'),
  'tokenizeTitleFamily: "gods" survives as a real token (was silently destroyed pre-fix)'
);
assertDeepEq(
  tokenizeTitle('G.O.D.S.: One World Under Doom #1'),
  tokenizeTitle('G. O. D. S.: One World Under Doom #1'),
  'tokenizeTitle: dotted and spaced forms produce IDENTICAL token sets'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — Q131 compatibility (fixture-mandatory per the dispatch ruling).
// Q131's ARTIST_PATTERNS word-boundary anchoring (the real "lim" matching
// inside "limited" bug, same book — One World Under Doom #1) must still
// hold with normalizeAcronyms now running first in the same pipeline.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Q131 compatibility — ARTIST_PATTERNS word-boundary anchoring unaffected\n');

{
  // The real Q131 collision shape: "Limited to 500" contains "lim" as a
  // bare substring; Q131 anchored /\blim\b/i so it no longer falsely
  // matches inside "limited". Confirm normalizeAcronyms (which now runs
  // BEFORE the ARTIST_PATTERNS-stripping step inside tokenizeTitleFamily)
  // does not reopen this — "Limited" has no periods, so normalizeAcronyms
  // is a pure no-op on it, and the real artist name (Giang) still survives
  // tokenization untouched by the "lim" false-match.
  const tokens = tokenizeTitleFamily('One World Under Doom #1 John Giang MegaCon Secret Drop Limited to 500 Signed');
  assertTrue(tokens.includes('giang') === false, 'ARTIST_PATTERNS strips "giang" from the token stream (expected — tokenizeTitleFamily strips recognized artist names before tokenizing, same as before this dispatch)');
  assertFalse(tokens.some(t => t === 'lim'), 'no false "lim" token leaks through from "Limited" — Q131\'s word-boundary fix still holds with normalizeAcronyms in the pipeline');
  assertTrue(tokens.includes('one') && tokens.includes('world') && tokens.includes('doom'), 'core title tokens survive tokenization unaffected by either Q131 or this dispatch');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — pcMatchConflictsWithPoolName: the 4-quadrant fixture matrix
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: pcMatchConflictsWithPoolName — 4-quadrant matrix\n');

// Real production pool for this book (One World Under Doom #1, Giang MegaCon
// Secret Drop) — genuinely no G.O.D.S. mention anywhere.
const oneWorldPool = [
  'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM',
  'ONE WORLD UNDER DOOM #1 John Giang Signed with COA Megacon 2025 Secret Drop',
  'One World Under Doom #1 John Giang MegaCon Secret Drop Signed Remarked LTD 500',
  'One World Under Doom #1 John Giang MegaCon Exclusive Virgin (unsigned)',
];

// Reconstructed pool for a genuine G.O.D.S. tie-in book (majority mention
// the acronym explicitly — the inverse-shape control).
const godsPool = [
  'G.O.D.S. #1 One World Under Doom Tie-In Marvel 2025 NM',
  'G.O.D.S #1 (2025) Marvel One World Under Doom',
  'GODS 1 Marvel Comics 2025 One World Under Doom Tie In',
  'G.O.D.S. One World Under Doom #1 Marvel NM',
];

// (a) THIS BOOK — pool WITHOUT G.O.D.S., PC WITH it → anchor REJECTED.
assertTrue(
  pcMatchConflictsWithPoolName('G.O.D.S.: One World Under Doom #1 (2025)', oneWorldPool),
  'quadrant (a): PC="G.O.D.S.: One World Under Doom #1", real plain pool → REJECTED'
);

// (b) INVERSE — genuine G.O.D.S. book pool, plain-series PC name → also REJECTED.
assertTrue(
  pcMatchConflictsWithPoolName('One World Under Doom #1 (2025)', godsPool),
  'quadrant (b): PC="One World Under Doom #1" (plain), genuine G.O.D.S. pool → REJECTED'
);

// (c) genuine G.O.D.S. book with correct G.O.D.S. PC anchor → ACCEPTED.
assertFalse(
  pcMatchConflictsWithPoolName('G.O.D.S.: One World Under Doom #1 (2025)', godsPool),
  'quadrant (c): PC="G.O.D.S.: One World Under Doom #1", genuine G.O.D.S. pool → ACCEPTED (correct match)'
);

// (d) no acronym anywhere → byte-identical to today.
assertFalse(
  pcMatchConflictsWithPoolName('One World Under Doom #1 (2025)', oneWorldPool),
  'quadrant (d): PC="One World Under Doom #1" (plain), real plain pool → ACCEPTED, byte-identical to pre-dispatch behavior'
);

// Spaced-acronym-form control: quadrant (a) must reject identically
// whether PC's name uses the dotted or spaced acronym form.
assertTrue(
  pcMatchConflictsWithPoolName('G. O. D. S.: One World Under Doom #1 (2025)', oneWorldPool),
  'quadrant (a), spaced form: "G. O. D. S." rejects identically to the dotted form'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 6 — standing controls, all byte-identical (no acronym involved
// anywhere in any of these — every existing regression must hold)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: standing controls — byte-identical\n');

{
  const poisonIvy31Pool = [
    'Poison Ivy #31 Variant Signed by Jenny Frison 2025 w/COA..',
    'Poison Ivy #31 Variant Cover B SIGNED by Jenny Frison WITH COA 2025 NM',
    'Poison Ivy #31 Signed By Jennie Frison With Coa',
  ];
  assertFalse(pcMatchConflictsWithPoolName('Poison Ivy #31 (2025)', poisonIvy31Pool), 'Poison Ivy #31: no conflict — byte-identical');
}
{
  const catwomanPool = ['Catwoman #64 (2024 Szerdy Homage Variant)', 'Catwoman #64 2024 Nathan Szerdy Trade Dress'];
  assertFalse(pcMatchConflictsWithPoolName('Catwoman #64 (2024 Szerdy)', catwomanPool), 'Catwoman #64: no conflict — byte-identical');
}
{
  const batmanPool = ['Batman #608 (2002) Jim Lee Hush Cover A', 'Batman #608 Hush Part 1 2002'];
  assertFalse(pcMatchConflictsWithPoolName('Batman #608 (2002)', batmanPool), 'Batman #608: no conflict — byte-identical');
}
{
  const asm26Pool = [
    'Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 NM',
    'Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 VF/NM',
  ];
  assertFalse(pcMatchConflictsWithPoolName('Amazing Spider-Man #26 (2001)', asm26Pool), 'ASM #26: name axis alone does not reject (year axis is the one that catches this book, unaffected) — byte-identical');
}
{
  // New standing control (no prior precedent — a plain, no-acronym book
  // added specifically for this dispatch's "no acronym anywhere" quadrant).
  const silverSurferPool = ['Silver Surfer #3 (1968) John Buscema NM', 'Silver Surfer #3 1968 Galactus app'];
  assertFalse(pcMatchConflictsWithPoolName('Silver Surfer #3 (1968)', silverSurferPool), 'Silver Surfer #3 (new control): no conflict — byte-identical');
}
// Real pre-existing gate catches (must still fire — this dispatch adds
// detection power, never removes it):
{
  const invinciblePool = [
    'INVINCIBLE RETURNS #1 EOM MEGACON EXCLUSIVE ATOM EVE VIRGIN VARIANT LTD 1500',
    'INVINCIBLE #1  KYUYONG EOM SIGNED W/COA!',
  ];
  assertTrue(pcMatchConflictsWithPoolName('Invincible Universe: Battle Beast #1 (2025)', invinciblePool), 'Invincible/Battle Beast (Q133 precedent): still rejected on the pre-existing ratio axis — unaffected by this dispatch');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 7 — ComicVine [cv-token-gate] simulation (mirrors api/enrich.js's
// inline logic, same convention as q133-two-axis-pc-anchor-gate.test.js's
// own simulateGate helper for the PC-anchor gate — the real gate lives
// inline in the handler, not exported).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 7: ComicVine [cv-token-gate] — bidirectional acronym-orphan simulation\n');

function tokenizeForGate(str) {
  return normalizeAcronyms(String(str || ''))
    .toLowerCase()
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t))
    .filter(t => !['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with'].includes(t));
}

function simulateCvTokenGate(seriesName, volumeNames) {
  const queryTokens = tokenizeForGate(seriesName);
  const coreTokens = queryTokens.slice(0, 3);
  const queryAcronymTokens = extractAcronymTokens(seriesName);

  return volumeNames.map((volName) => {
    const volTokens = tokenizeForGate(volName);
    const overlap = queryTokens.filter(qt => volTokens.includes(qt)).length;
    const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
    const coreOverlap = coreTokens.filter(ct => volTokens.includes(ct)).length;
    if (coreOverlap === 0 && coreTokens.length > 0) return { volName, kept: false, reason: 'core-fail' };
    if (overlapRatio < 0.5) return { volName, kept: false, reason: 'ratio-fail' };
    const volAcronymTokens = extractAcronymTokens(volName);
    if (volAcronymTokens.some((t) => !queryTokens.includes(t))) return { volName, kept: false, reason: 'orphan-vol-acronym' };
    if (queryAcronymTokens.some((t) => !volTokens.includes(t))) return { volName, kept: false, reason: 'orphan-query-acronym' };
    return { volName, kept: true, reason: null };
  });
}

// (a) our query is plain, candidate volume carries the acronym → REJECTED.
{
  const r = simulateCvTokenGate('One World Under Doom', ['G.O.D.S.: One World Under Doom']);
  assertFalse(r[0].kept, 'CV gate quadrant (a): plain query vs acronym-carrying volume → rejected');
  assertEq(r[0].reason, 'orphan-vol-acronym', 'CV gate quadrant (a): rejected specifically via the orphan-vol-acronym direction');
}
// (b) our query carries the acronym, candidate volume is plain → REJECTED.
{
  const r = simulateCvTokenGate('G.O.D.S.: One World Under Doom', ['One World Under Doom']);
  assertFalse(r[0].kept, 'CV gate quadrant (b): acronym-carrying query vs plain volume → rejected');
  assertEq(r[0].reason, 'orphan-query-acronym', 'CV gate quadrant (b): rejected specifically via the orphan-query-acronym direction');
}
// (c) both carry the acronym → ACCEPTED.
{
  const r = simulateCvTokenGate('G.O.D.S.: One World Under Doom', ['G.O.D.S.: One World Under Doom']);
  assertTrue(r[0].kept, 'CV gate quadrant (c): both query and volume carry the acronym → accepted');
}
// (d) neither carries an acronym → byte-identical (accepted, full overlap).
{
  const r = simulateCvTokenGate('One World Under Doom', ['One World Under Doom']);
  assertTrue(r[0].kept, 'CV gate quadrant (d): no acronym anywhere → accepted, byte-identical');
}
// Control: unrelated volume still correctly rejected by the PRE-EXISTING
// core-token/ratio checks (this dispatch must not weaken those).
{
  const r = simulateCvTokenGate('Batman Gotham War', ['Scorched Earth']);
  assertFalse(r[0].kept, 'CV gate control: unrelated volume still rejected by the pre-existing core-token gate');
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
