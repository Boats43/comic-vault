// tests/grailkey-gk143-title-corruption.test.js
//
// GK-143 — production request r5v6b, build 938dfdb. Two log points, same
// field: intact at [reconcile-title] ("...Jorge Jiménez"), corrupted at the
// confirmed-identity write ("...Jorge énez" — "Jorge Jim", 9 characters,
// missing). Traced (Phase 0.3, 2026-08-21): sanitizeSeriesTitle's
// NOISE_PATTERNS[0] (src/lib/identityCore.js) is built from
// LEGACY_CREATOR_NOISE_WORDS (includes bare "jim", from "Jim Lee") using a
// plain `\b(...)\b` regex. JS's \b is defined relative to the ASCII-only \w
// class ([A-Za-z0-9_]) — "é" (U+00E9) is not \w, so JS reads the m→é
// transition in "Jiménez" as a legitimate word BOUNDARY, and "jim" false-
// positive-matches inside "Jiménez" ("Jim" | "énez") and gets stripped.
// Nothing to do with charset/encoding (the GCD MySQL utf8mb3/utf8mb4
// finding, DATA-0B-1, is a different data source/pipeline entirely and is
// explicitly NOT the cause here) — this is a pure JS regex-engine behavior
// on a short, deliberately-broad noise-word list (see the list's own
// module comment: bare first names are intentional, by design).
//
// Fix: NOISE_PATTERNS[0]'s boundary is rebuilt with Unicode-aware
// lookarounds — (?<![\p{L}\p{N}_])...(?![\p{L}\p{N}_]) with the 'u' flag —
// so any Unicode letter (not just ASCII) counts as a word character. "é"
// now correctly reads as a word character, so "m"→"é" is no longer a
// boundary and the false match cannot occur. Genuine bare-word matches
// ("Jim Lee", surrounded by whitespace) are unaffected. Narrowest possible
// fix at the one proven site — the other 6 NOISE_PATTERNS entries carry the
// same latent ASCII-\b risk class but are NOT touched here (out of scope;
// none is proven to have fired in production — flagged, not fixed).
//
// Invoke: node tests/grailkey-gk143-title-corruption.test.js

import { sanitizeSeriesTitle } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEqual = (actual, expected, label) => {
  const ok = actual === expected;
  assertTrue(ok, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
};

console.log('\n=== Part 1: fail-first repro — the exact production string, byte-for-byte ===\n');

{
  const PROD_TITLE = 'Detective Comics Batman Corner Box Jorge Jiménez';
  const CORRUPTED_PROD_VALUE = 'Detective Comics Batman Corner Box Jorge énez'; // r5v6b, pre-fix, for the record only — not asserted on
  const result = sanitizeSeriesTitle(PROD_TITLE);
  console.log(`  input:  ${JSON.stringify(PROD_TITLE)}`);
  console.log(`  output: ${JSON.stringify(result)}`);
  assertTrue(result.includes('Jorge Jiménez'), 'SHIP-BLOCKING: "Jorge Jiménez" survives sanitizeSeriesTitle intact on the real production string');
  assertTrue(!result.includes('énez') || result.includes('Jiménez'), 'SHIP-BLOCKING: the corrupted r5v6b shape ("...Jorge énez") does not reproduce');
  assertTrue(result !== CORRUPTED_PROD_VALUE, 'output is not byte-identical to the pre-fix corrupted production value');
}

{
  const result = sanitizeSeriesTitle('Jorge Jiménez');
  assertEqual(result, 'Jorge Jiménez', 'bare "Jorge Jiménez" (no surrounding title text) survives intact');
}

console.log('\n=== Part 2: é/ü/ñ/\' round-trip control corpus — same path, same function ===\n');

{
  const CONTROLS = [
    ['José García', 'José García'],
    ['Müller', 'Müller'],
    ["O'Neil", "O'Neil"],
    ['O’Neil', 'O’Neil'], // curly apostrophe
    ["Dell'Otto", "Dell'Otto"],
    ['Peña', 'Peña'],
  ];
  for (const [input, expected] of CONTROLS) {
    const result = sanitizeSeriesTitle(input);
    assertEqual(result, expected, `control corpus: "${input}" unaffected by the boundary fix`);
  }
}

console.log('\n=== Part 3: negative control — genuine bare-word noise stripping still fires ===\n');

{
  // "Jim Lee" surrounded by whitespace is a REAL noise-word match this
  // pattern is supposed to catch — the fix must not over-correct into
  // never stripping "jim"/"lee" at all.
  const result = sanitizeSeriesTitle('Batman Jim Lee Variant');
  assertTrue(!result.toLowerCase().includes('jim'), 'genuine bare-word "Jim" (surrounded by whitespace) still stripped — fix does not over-suppress');
  assertTrue(!result.toLowerCase().includes(' lee'), 'genuine bare-word "Lee" still stripped');
  assertTrue(result.includes('Batman'), 'unrelated title content untouched');
}

{
  // A different LEGACY_CREATOR_NOISE_WORDS entry ("alan"), embedded before
  // a non-ASCII letter the same way "jim" was inside "Jiménez" — proves the
  // fix is the boundary logic itself, not a one-off carve-out for "jim".
  const result = sanitizeSeriesTitle('Alanís Morissette');
  assertTrue(result.includes('Alanís'), 'SHIP-BLOCKING: same boundary-collision mechanism, different noise word ("alan" inside "Alanís") — also fixed, not a single-string patch');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
