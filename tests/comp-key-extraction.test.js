// Unit tests for Ship #12a — FR-D7 multi-key attribution from comp titles.
// Display-only feature: pattern-match eBay listing titles, surface
// consensus (hits >= 2) detections on keyFromComps and singletons on
// keyFromCompsSingleton. No pricing math change.
//
// Invoke: node tests/comp-key-extraction.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  COMP_KEY_PATTERNS,
  extractKeyFromComps,
  titleCaseKeyPhrase,
} from '../api/enrich.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== SHIP #12a — COMP KEY EXTRACTION ===\n');

// ─── Pattern catalog sanity ─────────────────────────────────────────
console.log('Pattern catalog:');
assertEq(COMP_KEY_PATTERNS.length, 8, '8 patterns registered');
const kinds = COMP_KEY_PATTERNS.map((p) => p.kind).sort();
assertEq(kinds.join(','),
  ['cameo', 'death', 'first-appearance', 'first-cover', 'first-told',
    'intro', 'origin', 'second-appearance'].join(','),
  'all 8 kinds present');

// ─── titleCaseKeyPhrase ─────────────────────────────────────────────
console.log('\ntitleCaseKeyPhrase:');
assertEq(titleCaseKeyPhrase('DEATH OF DRACULA'), 'Death of Dracula',
  'ALL CAPS → Title Case, "of" lowered');
assertEq(titleCaseKeyPhrase('1ST TOLD DEATH OF MA & PA KENT'),
  '1st Told Death of Ma & Pa Kent', 'complex phrase with & preserved');
assertEq(titleCaseKeyPhrase('intro of mr. tawky tawny & mr. mind'),
  'Intro of Mr. Tawky Tawny & Mr. Mind', 'mixed lowercase → Title Case');
assertEq(titleCaseKeyPhrase('origin of the silver surfer'),
  'Origin of the Silver Surfer', '"the" lowered mid-phrase');
assertEq(titleCaseKeyPhrase(''), '', 'empty string → empty');
assertEq(titleCaseKeyPhrase(null), null, 'null → null');

// ─── Empty / guard cases ────────────────────────────────────────────
console.log('\nGuards & edge cases:');
const empty = extractKeyFromComps([]);
assertEq(empty.consensus.length, 0, 'empty array → no consensus');
assertEq(empty.singletons.length, 0, 'empty array → no singletons');

const notArray = extractKeyFromComps(null);
assertEq(notArray.consensus.length, 0, 'null input → safe { consensus:[] }');
assertEq(notArray.singletons.length, 0, 'null input → safe { singletons:[] }');

const notArrayUndef = extractKeyFromComps(undefined);
assertEq(notArrayUndef.consensus.length, 0, 'undefined input → safe');

const badTypes = extractKeyFromComps([null, 42, {}, '', undefined]);
assertEq(badTypes.consensus.length, 0, 'mixed non-string input → safe skip');
assertEq(badTypes.singletons.length, 0, 'mixed non-string input → no singletons');

// ─── Individual pattern coverage ────────────────────────────────────
console.log('\nPattern — first-appearance:');
const faResults = extractKeyFromComps([
  'Amazing Spider-Man #300 1st appearance of Venom CGC 9.8',
  'ASM 300 1ST APP VENOM NM',
]);
assertEq(faResults.consensus.length + faResults.singletons.length >= 1, true,
  'both titles produce at least one detection');
const faKinds = [...faResults.consensus, ...faResults.singletons]
  .map((e) => e.kind);
assertTrue(faKinds.includes('first-appearance'), 'first-appearance kind detected');

console.log('\nPattern — origin:');
const originResults = extractKeyFromComps([
  'Iron Man #1 Origin of Iron Man VF 8.0',
  'Tales of Suspense #39 ORIGIN OF IRON MAN CGC 7.0',
]);
assertTrue(
  originResults.consensus.concat(originResults.singletons)
    .some((e) => e.kind === 'origin'),
  'origin kind detected'
);

console.log('\nPattern — death:');
const deathResults = extractKeyFromComps([
  'Frankenstein Monster #9 Death of Dracula CGC 9.4',
  'FRANKENSTEIN MONSTER 9 DEATH OF DRACULA VF',
  'Frankenstein Monster 9 death of dracula CBCS 8.5',
]);
assertTrue(deathResults.consensus.some((e) => e.kind === 'death'),
  'death kind in consensus (3 hits)');
assertEq(deathResults.consensus[0].hits, 3, '3 hits counted');
assertEq(deathResults.consensus[0].phrase, 'Death of Dracula',
  'phrase title-cased on output');

console.log('\nPattern — intro:');
const introResults = extractKeyFromComps([
  'Shazam! #2 Intro of Mr. Tawky Tawny & Mr. Mind CGC 9.0',
  'Shazam 2 INTRO OF MR TAWKY TAWNY VF',
]);
assertTrue(
  introResults.consensus.concat(introResults.singletons)
    .some((e) => e.kind === 'intro'),
  'intro kind detected');

console.log('\nPattern — first-told:');
const toldResults = extractKeyFromComps([
  'Superman #161 1ST TOLD DEATH OF MA & PA KENT CGC 6.0',
  'Superman 161 1st told Death Of Ma & Pa Kent VF',
]);
assertTrue(toldResults.consensus.some((e) => e.kind === 'first-told'),
  'first-told in consensus (2 hits)');
// Same title hits BOTH first-told and death — both should register
assertTrue(toldResults.consensus.some((e) => e.kind === 'death'),
  'death also detected from same titles (separate entry)');

console.log('\nPattern — cameo:');
const cameoResults = extractKeyFromComps([
  'Hulk #180 cameo of Wolverine CGC 9.6',
  'Hulk 180 CAMEO OF WOLVERINE VF',
]);
assertTrue(cameoResults.consensus.some((e) => e.kind === 'cameo'),
  'cameo in consensus');

console.log('\nPattern — second-appearance:');
const secondResults = extractKeyFromComps([
  'Hulk #181 2nd appearance of Wolverine CGC 9.4',
  'Hulk 181 2ND APPEARANCE WOLVERINE',
]);
assertTrue(
  secondResults.consensus.concat(secondResults.singletons)
    .some((e) => e.kind === 'second-appearance'),
  'second-appearance kind detected');

console.log('\nPattern — first-cover:');
const coverResults = extractKeyFromComps([
  'Fantastic Four #5 1st cover appearance of Doctor Doom CGC 7.5',
  'FF 5 1ST COVER DR DOOM',
]);
assertTrue(
  coverResults.consensus.concat(coverResults.singletons)
    .some((e) => e.kind === 'first-cover'),
  'first-cover kind detected');

// ─── Consensus threshold ────────────────────────────────────────────
console.log('\nConsensus threshold (hits >= 2):');
const single = extractKeyFromComps([
  'Frankenstein Monster #9 Death of Dracula CGC 9.4',
]);
assertEq(single.consensus.length, 0, '1 hit → not in consensus');
assertEq(single.singletons.length, 1, '1 hit → in singletons');
assertEq(single.singletons[0].hits, 1, 'singleton hits===1');

const double = extractKeyFromComps([
  'Frankenstein Monster #9 Death of Dracula CGC 9.4',
  'Frankenstein Monster 9 DEATH OF DRACULA',
]);
assertEq(double.consensus.length, 1, '2 hits → in consensus');
assertEq(double.singletons.length, 0, '2 hits → not in singletons');

// ─── Dedup: same phrase different case → one entry ──────────────────
console.log('\nDedup (case-insensitive, by kind+phrase):');
const dedupResults = extractKeyFromComps([
  'Comic #1 death of DRACULA CGC 9.4',
  'Comic 1 DEATH OF Dracula 8.5',
  'Comic 1 death of dracula VF',
]);
assertEq(dedupResults.consensus.length, 1,
  'same kind+phrase (case-insensitive) → 1 entry');
assertEq(dedupResults.consensus[0].hits, 3, '3 hits on same entry');

// Different phrases of same kind → separate entries
const diffPhrases = extractKeyFromComps([
  'Comic #1 death of Dracula',
  'Comic #1 death of Dracula',
  'Comic #2 death of Blade',
  'Comic #2 death of Blade',
]);
assertEq(diffPhrases.consensus.length, 2,
  'different phrases of death → separate entries');

// ─── Negative cases ─────────────────────────────────────────────────
console.log('\nNegative cases (should NOT match):');
const neg1 = extractKeyFromComps([
  'Amazing Spider-Man #300 1st print CGC 9.4',
  'ASM 300 1st print VF',
]);
assertEq(neg1.consensus.length, 0,
  '"1st print" NOT matched as first-appearance');
assertEq(neg1.singletons.length, 0, '"1st print" NOT matched as singleton');

const neg2 = extractKeyFromComps([
  'Dark Nights Death Metal #1 CGC 9.8',
  'Death Metal #2 NM',
]);
assertEq(neg2.consensus.length, 0, '"Death Metal" (no "of") NOT matched');

const neg3 = extractKeyFromComps([
  'Amazing Spider-Man #300',
  'ASM #300 Marvel 1988',
]);
assertEq(neg3.consensus.length, 0, 'bare title → no detections');
assertEq(neg3.singletons.length, 0, 'bare title → no singleton detections');

// ─── Sources capped at 3 ────────────────────────────────────────────
console.log('\nSources array (capped at 3):');
const manyHits = extractKeyFromComps([
  'Book #1 death of Dracula CGC 9.4',
  'Book #1 death of Dracula CGC 9.2',
  'Book #1 DEATH OF DRACULA VF',
  'Book #1 death of dracula FN',
  'Book #1 DEATH of DRACULA 5.5',
]);
assertEq(manyHits.consensus[0].hits, 5, 'all 5 hits counted');
assertEq(manyHits.consensus[0].sources.length, 3,
  'sources array capped at 3 (memory/payload discipline)');

// ─── Noise stripping (grade, year, CGC suffix) ──────────────────────
console.log('\nNoise stripping in captured phrase:');
const noisy = extractKeyFromComps([
  'Frank Monster #9 Death of Dracula CGC 9.4',
  'Frank Monster 9 Death of Dracula 1974',
]);
assertEq(noisy.consensus[0].phrase, 'Death of Dracula',
  'grade/year stripped from phrase');

// ─── Weight field ───────────────────────────────────────────────────
console.log('\nWeight field (for future promotion logic):');
const weightResults = extractKeyFromComps([
  'Book Origin of X CGC 9.4',
  'Book Origin of X VF',
  'Book Death of Y NM',
  'Book Death of Y CGC 9.6',
]);
const origin = weightResults.consensus.find((e) => e.kind === 'origin');
const death = weightResults.consensus.find((e) => e.kind === 'death');
assertEq(origin?.weight, 'major', 'origin carries weight=major');
assertEq(death?.weight, 'minor', 'death carries weight=minor');

// ─── Sort by hits DESC ──────────────────────────────────────────────
console.log('\nSort order (hits desc):');
const sorted = extractKeyFromComps([
  'Book 1st app of Venom CGC 9.4',
  'Book 1st app of Venom NM',
  'Book 1st app of Venom VF',
  'Book death of Dracula',
  'Book death of Dracula',
]);
assertTrue(sorted.consensus.length >= 2,
  'sort fixture produces 2+ consensus entries');
assertEq(sorted.consensus[0].hits >= sorted.consensus[1].hits, true,
  'first entry has highest hit count');

// ─── Confirmed production misses (validation) ───────────────────────
console.log('\nConfirmed misses from production scanning:');

// Superman #161 — "1st told death of Ma & Pa Kent"
const supe161 = extractKeyFromComps([
  'Superman #161 1ST TOLD DEATH OF MA & PA KENT CGC 6.0',
  'Superman 161 1st Told Death of Ma & Pa Kent VF',
]);
assertTrue(supe161.consensus.some((e) => e.kind === 'first-told'),
  'Superman #161 — first-told detected');
assertTrue(supe161.consensus.some((e) => e.kind === 'death'),
  'Superman #161 — death detected (double-trigger from same title)');

// Frankenstein Monster #9 — "Death of Dracula"
const frank = extractKeyFromComps([
  'Frankenstein Monster #9 Death of Dracula CGC 9.4',
  'Frank Monster 9 Death of Dracula',
]);
assertTrue(frank.consensus.some((e) => e.kind === 'death'),
  'Frankenstein Monster #9 — death detected');

// Shazam! #2 — "Intro of Mr. Tawky Tawny & Mr. Mind"
const shazam = extractKeyFromComps([
  'Shazam! #2 Intro of Mr. Tawky Tawny & Mr. Mind CGC 9.0',
  'Shazam 2 Intro of Mr Tawky Tawny Mr Mind',
]);
assertTrue(
  shazam.consensus.concat(shazam.singletons)
    .some((e) => e.kind === 'intro'),
  'Shazam! #2 — intro detected');

// Superman #201 — "Clark Kent Abandons Superman" (OUT OF SCOPE for 12a)
const supe201 = extractKeyFromComps([
  'Superman #201 Clark Kent Abandons Superman CGC 9.0',
  'Superman 201 Clark Kent Abandons Superman',
]);
assertEq(supe201.consensus.length, 0,
  'Superman #201 narrative event NOT matched (deferred per Q1)');
assertEq(supe201.singletons.length, 0,
  'Superman #201 narrative event NOT matched as singleton');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
