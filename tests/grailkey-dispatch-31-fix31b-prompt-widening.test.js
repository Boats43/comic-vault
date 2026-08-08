// tests/grailkey-dispatch-31-fix31b-prompt-widening.test.js
//
// GrailKey Dispatch 31 (2026-08-08) — Fix 31-B (prompt) ONLY. See
// tests/grailkey-dispatch-31-fix31a-wrong-axis-removed.test.js for
// Fix 31-A (decision gate) — split into its own file deliberately, so a
// future revert of this prompt fix does not require reverting or
// hand-splitting the decision-gate fix's test coverage.
//
// Dispatch 30's own aspect-ratio/proportion/framing wording backfired
// the same day it shipped. A real re-scan photo was the book on a
// light background with margins; Vision's condition report cited "The
// proportions and presentation suggest this is printed art stock rather
// than a periodical comic book cover" and "The paper stock and framing
// indicate this is likely a standalone art piece or poster." Two
// failures: Vision re-invented paper stock (the exact tiebreaker
// Dispatch 30 explicitly dropped), and IMAGE proportions are not OBJECT
// proportions — the aspect-ratio/framing cue Dispatch 30 added was read
// as evidence AGAINST an ordinary photographed book, backfiring on the
// exact ordinary case it was meant to protect.
//
// FIX: both cues removed entirely (not narrowed) from both prompts; an
// explicit, by-name prohibition on paper-stock/print-stock/material-
// appearance reasoning added instead. Named as GK-44 in the Pattern
// Library: Vision has now reached for an unstated criterion twice (the
// masthead/price-box/barcode checklist, then paper stock and framing)
// — silence reads as "unconstrained," not "not applicable."
//
// This width is EXPLICITLY CONDITIONAL on GK-41 (Dispatch 30) remaining
// in place: before GK-41, a false "is a comic" could reach a hard price
// block; after GK-41, it degrades to ID_REQUIRED (if identity can't
// resolve) or an advisory-locked listing button (if it can't be
// verified) — never a fabricated price or a dead-end rejection. That is
// what makes accepting a wider positive-signal surface defensible here,
// and it is why this file's test coverage must not be reverted
// independently of GK-41's own test coverage without re-examining that
// argument.
//
// Prompt-only change, no model in the loop — the honest test ceiling is
// source-presence (same discipline as Dispatch 29/30). Absence
// assertions matter more than presence ones: the specific failure mode
// this dispatch is about is a leftover misfiring cue, not a missing new
// one.
//
// Invoke: node tests/grailkey-dispatch-31-fix31b-prompt-widening.test.js
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

console.log('\n=== GrailKey Dispatch 31 — Fix 31-B (prompt: paper-stock/framing prohibition) ===\n');

const gradeSource = readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');
const standardPromptMatch = gradeSource.match(/const STANDARD_PROMPT =\s*\n\s*`([\s\S]*?)`;/);
const watchPromptMatch = gradeSource.match(/const WATCH_PROMPT =\s*\n\s*`([\s\S]*?)`;/);
assertTrue(!!standardPromptMatch, 'STANDARD_PROMPT is found and isolated for targeted assertions');
assertTrue(!!watchPromptMatch, 'WATCH_PROMPT is found and isolated for targeted assertions');
const standardPrompt = standardPromptMatch?.[1] || '';
const watchPrompt = watchPromptMatch?.[1] || '';

console.log('\n-- aspect-ratio/proportion/framing language GONE, paper-stock/framing prohibitions PRESENT --');
{
  // "proportion"/"framing" as bare words necessarily still appear once
  // each — inside the prohibition sentence itself ("Do NOT reason from
  // ... proportions ... framing"), which must name what it forbids. The
  // real absence claim is narrower and checked precisely: the OLD
  // positive-signal sentences that used those words to argue FOR
  // assetTypeConfident=true are gone, replaced by a sentence that uses
  // the same words to argue the opposite (forbid reasoning from them).
  assertFalse(standardPrompt.includes('6.6 x 10.2'), 'STANDARD_PROMPT: aspect-ratio figure is gone entirely');
  assertFalse(standardPrompt.includes('at comic-cover proportions'), 'STANDARD_PROMPT: the old positive-signal "at comic-cover proportions" phrase is gone');
  assertFalse(standardPrompt.includes('or for an image whose proportions or framing clearly do not match a periodical cover'), 'STANDARD_PROMPT: the old proportions/framing negative-discriminator clause is gone');
  assertTrue(standardPrompt.includes('Do NOT reason from paper stock, print stock, cardstock thickness, or any other material or texture appearance'), 'STANDARD_PROMPT: explicit, by-name paper-stock prohibition present (GK-44)');
  assertTrue(standardPrompt.includes('Do NOT reason from the proportions, aspect ratio, or framing of the photographed IMAGE itself'), 'STANDARD_PROMPT: explicit, by-name image-proportion/framing prohibition present');

  assertFalse(watchPrompt.includes('6.6 x 10.2'), 'WATCH_PROMPT: aspect-ratio figure is gone entirely');
  assertFalse(watchPrompt.includes('at comic-cover proportions'), 'WATCH_PROMPT: the old positive-signal "at comic-cover proportions" phrase is gone');
  assertFalse(watchPrompt.includes('a poster/art print at non-periodical proportions'), 'WATCH_PROMPT: the old proportions-based disqualification phrase is gone');
  assertTrue(watchPrompt.includes('Do NOT reason from paper stock, print stock, or material appearance'), 'WATCH_PROMPT: explicit, by-name paper-stock prohibition present');
  assertTrue(watchPrompt.includes("Do NOT reason from the photographed image's proportions, aspect ratio, or framing"), 'WATCH_PROMPT: explicit, by-name image-proportion/framing prohibition present');

  // The default-true framing and the genuine non-comic disqualification
  // list survive — this is a narrowing of DISCRIMINATORS, not a
  // reversion of the underlying default-true design from Dispatch 30.
  assertTrue(standardPrompt.includes('is a comic by default'), 'STANDARD_PROMPT: default-true design survives Fix 31-B');
  assertTrue(watchPrompt.includes('is a comic by default'), 'WATCH_PROMPT: default-true design survives Fix 31-B');
  assertTrue(standardPrompt.includes('a statue, a toy, an unrelated object, or an interior page shown without any cover'), 'STANDARD_PROMPT: genuine non-comic disqualification list still present');
  assertTrue(watchPrompt.includes('statue, toy, unrelated object, or an interior page with no cover'), 'WATCH_PROMPT: genuine non-comic disqualification list still present');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
