// tests/grailkey-dispatch-29-fix3a-vision-prompt.test.js
//
// GrailKey Dispatch 29 (2026-08-08) — Fix 3a, Vision prompt corrections
// (api/grade.js STANDARD_PROMPT and WATCH_PROMPT).
//
// Root cause, corrected from an initial "the model hallucinated" instinct
// (see Pattern Library, "the prompt told it to guess"): STANDARD_PROMPT's
// year clause, as shipped through GrailKey Dispatch 28, ended "If year is
// not visible use context clues like art style, cover price, and
// characters." — an explicit, standing instruction to infer a year from
// character/franchise recognition. That sentence produced "Spawn #1,
// 1992, high confidence" on a virgin variant with no printed issue
// number or cover date at all — the exact input Fix 4/4b were built to
// survive downstream. The issue clause had the mirror gap: no absence
// guidance at all.
//
// Three corrections, both prompts:
//   (a) a virgin/sketch/blank-cover variant is a known, legitimate comic
//       shape, recognized by PHYSICAL BOOK CUES (staples, spine,
//       interior page edges) rather than cover text — absence of
//       masthead/price-box/barcode/issue-number is expected on these,
//       not disqualifying. The existing poster/art-print/statue/toy
//       disqualification is untouched; the gate requires POSITIVE
//       physical-book evidence, not merely comic-style art, so a flat
//       print or poster still fails it regardless of rendering style.
//   (b) no fabricated issue/year — absent printed evidence, return
//       null; never infer from character/franchise recognition.
//   (c) confidence describes what is legible in THIS image, not a
//       general hedge — reserved for genuinely illegible images, not
//       routine caution on a clear cover.
//
// This is a prompt-only change with no model in the loop — the honest
// test ceiling here is SOURCE-PRESENCE (do the new instructions exist,
// is the old contradictory instruction gone), not model behavior, which
// can only be verified by a real post-deploy scan (same discipline as
// GrailKey Dispatch 26/27/28). Assertion (b) — the OLD guess-from-
// characters sentence being GONE — matters more than assertion (a) — the
// new sentences being present — because a leftover contradictory
// instruction sitting alongside a new one is the specific failure mode
// this dispatch is about (appending instead of replacing would have left
// Vision free to keep obeying the older, more specific sentence).
//
// Invoke: node tests/grailkey-dispatch-29-fix3a-vision-prompt.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertFalse = (cond, label) => assertTrue(!cond, label);

console.log('\n=== GrailKey Dispatch 29 — Fix 3a, Vision prompt corrections ===\n');

const gradeSource = readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');

// Isolate each prompt's own template-literal line so assertions can
// confirm each correction landed in BOTH prompts independently, not just
// somewhere in the file.
const standardPromptMatch = gradeSource.match(/const STANDARD_PROMPT =\s*\n\s*`([\s\S]*?)`;/);
const watchPromptMatch = gradeSource.match(/const WATCH_PROMPT =\s*\n\s*`([\s\S]*?)`;/);
assertTrue(!!standardPromptMatch, 'STANDARD_PROMPT is found and isolated for targeted assertions');
assertTrue(!!watchPromptMatch, 'WATCH_PROMPT is found and isolated for targeted assertions');
const standardPrompt = standardPromptMatch?.[1] || '';
const watchPrompt = watchPromptMatch?.[1] || '';

// ══════════════ Section 1 — THE ASSERTION THAT MATTERS: the old guess-from-characters instruction is GONE ══════════════

console.log('-- Section 1: the old contradictory instruction is GONE, not just appended-around --');
{
  const oldYearGuessSentence = 'If year is not visible use context clues like art style, cover price, and characters.';
  assertFalse(gradeSource.includes(oldYearGuessSentence), 'the exact sentence that produced "1992" is completely removed from the file, not left alongside the new instruction');
  assertFalse(standardPrompt.includes('context clues like art style'), 'STANDARD_PROMPT no longer instructs inferring year from art style anywhere');
  assertFalse(standardPrompt.toLowerCase().includes('use context clues') && standardPrompt.toLowerCase().includes('characters'), 'no surviving fragment of the guess-from-characters instruction in STANDARD_PROMPT');
}

// ══════════════ Section 2 — the new instructions are present, in BOTH prompts ══════════════

console.log('\n-- Section 2: (a) virgin/sketch/blank-cover recognized as a legitimate comic shape, by physical cues --');
{
  assertTrue(standardPrompt.includes('virgin, sketch, or blank-cover variant is a real, common printing type'), 'STANDARD_PROMPT names virgin/sketch/blank-cover as a known shape');
  assertTrue(standardPrompt.includes('PHYSICAL BOOK CUES'), 'STANDARD_PROMPT directs recognition by physical cues, not cover text');
  assertTrue(standardPrompt.includes('visible staple or staples along the spine edge'), 'STANDARD_PROMPT names the staple/spine cue specifically');
  assertTrue(standardPrompt.includes('interior page edges visible at the trim'), 'STANDARD_PROMPT names the interior-page-edge cue specifically');
  assertTrue(standardPrompt.includes('A single flat art sheet with NO visible staples, spine, or interior pages'), 'STANDARD_PROMPT explicitly keeps a flat print/poster disqualified regardless of art style');
  assertTrue(standardPrompt.includes('bound art portfolio'), 'STANDARD_PROMPT includes the ambiguous-case tiebreaker (ownership of the ambiguity, not a required gate)');

  assertTrue(watchPrompt.includes('virgin/sketch/blank-cover variant intentionally has no masthead'), 'WATCH_PROMPT names virgin/sketch/blank-cover as a known shape');
  assertTrue(watchPrompt.includes('physical cues (visible staples or spine, interior page edges'), 'WATCH_PROMPT directs recognition by physical cues');
  assertTrue(watchPrompt.includes('A flat art sheet with no staples, spine, or pages is a print, not a comic'), 'WATCH_PROMPT explicitly keeps a flat print/poster disqualified');
  assertTrue(watchPrompt.includes('bound art portfolio'), 'WATCH_PROMPT includes the ambiguous-case tiebreaker');

  // Verify the EXISTING disqualification list is untouched — this fix
  // adds a recognized shape, it does not remove or weaken the gate.
  assertTrue(standardPrompt.includes("it's a poster, art print, statue, toy, page scan without a cover, unrelated object"), 'STANDARD_PROMPT\'s original disqualification list is byte-identical, untouched');
  assertTrue(watchPrompt.includes('(poster, print, toy, unrelated object, unclear)'), 'WATCH_PROMPT\'s original disqualification list is byte-identical, untouched');
}

console.log('\n-- Section 3: (b) no fabricated issue/year — both fields --');
{
  assertTrue(standardPrompt.includes('If no printed issue number is visible anywhere on this cover, return issue as null'), 'STANDARD_PROMPT: issue absence guidance added');
  assertTrue(standardPrompt.includes('Do NOT assume "1" because you recognize the character or series'), 'STANDARD_PROMPT: explicit no-first-issue-prior instruction');
  assertTrue(standardPrompt.includes('If no year is visible in a price box, indicia, or copyright notice, return year as null'), 'STANDARD_PROMPT: year absence guidance added');
  assertTrue(standardPrompt.includes("Do NOT infer a year from art style or character recognition"), 'STANDARD_PROMPT: explicit no-franchise-launch-year-prior instruction');
  // THE CHECK: reading a real printed year must still be explicitly
  // instructed and allowed — only INFERENCE from style/character is
  // forbidden. The original "read directly from the price box" sentence
  // must survive untouched.
  assertTrue(standardPrompt.includes('Read the publication year directly from the cover price box, indicia, or copyright notice.'), 'STANDARD_PROMPT: reading a real printed year (including from the price box) is still explicitly instructed and allowed — only inference is forbidden, not observation');

  assertTrue(watchPrompt.includes('If no issue number is visible, return null'), 'WATCH_PROMPT: issue absence guidance added');
  assertTrue(watchPrompt.includes('never assume "1" from character recognition alone'), 'WATCH_PROMPT: explicit no-first-issue-prior instruction');
  assertTrue(watchPrompt.includes('year: read directly from the cover price box, indicia, or copyright notice; return null if not visible'), 'WATCH_PROMPT: year guidance added where none existed before, and still explicitly allows reading a real printed year');
  assertTrue(watchPrompt.includes('never infer from art style or character recognition'), 'WATCH_PROMPT: explicit no-inference instruction');
}

console.log('\n-- Section 4: (c) confidence describes legibility, not a general hedge --');
{
  assertTrue(standardPrompt.includes('confidence describes how legible and complete THIS image is, not a general hedge'), 'STANDARD_PROMPT: confidence calibration instruction added');
  assertTrue(standardPrompt.includes('report confidence as "high" — including for an ordinary, well-known book'), 'STANDARD_PROMPT: explicit instruction that legible + ordinary still means high confidence');

  assertTrue(watchPrompt.includes('Report "low" only when the image itself is hard to read — not as routine caution on a clear, legible cover'), 'WATCH_PROMPT: confidence calibration instruction added');
}

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
