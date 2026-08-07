// tests/grailkey-dispatch-19-vision-confidence-leak.test.js
//
// GrailKey Dispatch 19 (2026-08-07) — item 4, "Vision confidence string
// leak," traced and fixed.
//
// Real production evidence (Spawn #351, 2026-08-07 20:40:36 UTC, POST
// /api/enrich): a genuine "not a comic book" scan returned
// `confidence: "High that this is NOT a comic book"` from Vision — an
// asset-type verdict sentence, not one of the three instructed
// low/medium/high tiers. It flowed unchecked into the match-conf log
// (`[match-conf] ... vision=high that this is not a comic book`) and
// every downstream `=== 'low'`/`=== 'medium'` comparison, silently never
// matching any of them.
//
// Root cause was two-layered, both fixed:
//   1. api/grade.js's STANDARD_PROMPT/WATCH_PROMPT never actually
//      instructed Vision on confidence's format (unlike the separately,
//      correctly-specified buildGradeOnlyPrompt) — despite
//      normalizeVisionConfidence's own doc comment (identityCore.js)
//      previously claiming they did. Fixed with an explicit sentence in
//      both prompts (verified by direct grep below, not just prose).
//   2. normalizeVisionConfidence (identityCore.js) blindly lowercased
//      whatever string came back with zero validation — and THREE
//      independent inline duplicates of the identical unchecked pattern
//      existed in api/enrich.js (lines ~4049, ~4232, ~8667 pre-fix),
//      none of them routed through the one centralized function. Fixed:
//      the shared function now validates against the fixed set,
//      defaulting to 'medium' with a loud [vision-confidence-invalid]
//      log line (never silent) on anything else; all three inline
//      duplicates now call the shared function instead of re-deriving it.

import { normalizeVisionConfidence } from '../src/lib/identityCore.js';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

function captureWarn(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => { lines.push(args.join(' ')); };
  let result;
  try { result = fn(); } finally { console.warn = original; }
  return { result, lines };
}

console.log('\n=== GrailKey Dispatch 19 — Vision confidence string leak (normalizeVisionConfidence) ===\n');

// ─── SECTION 1 — the real Spawn #351 production string, verbatim ───
console.log('-- Section 1: the exact real production string --');
{
  const { result, lines } = captureWarn(() => normalizeVisionConfidence('High that this is NOT a comic book'));
  assertEq(result, 'medium', 'the exact asset-type sentence from the real scan is rejected, never passed through as a confidence tier');
  assertTrue(lines.some(l => l.includes('[vision-confidence-invalid]')), 'the rejection is logged, never silent');
  assertTrue(lines.some(l => l.includes('High that this is NOT a comic book')), 'the log line preserves the actual offending value for diagnosis');
}

// ─── SECTION 2 — the three real, valid values still work, case-insensitively ───
console.log('\n-- Section 2: real enum values pass through normalized --');
{
  assertEq(normalizeVisionConfidence('HIGH'), 'high', '"HIGH" → "high"');
  assertEq(normalizeVisionConfidence('Medium'), 'medium', '"Medium" → "medium"');
  assertEq(normalizeVisionConfidence('low'), 'low', '"low" → "low" (already normalized)');
  assertEq(normalizeVisionConfidence('  high  '), 'high', 'surrounding whitespace tolerated');
}

// ─── SECTION 3 — absent/empty input still defaults safely, unchanged behavior ───
console.log('\n-- Section 3: absent input — unchanged default behavior --');
{
  const { result: r1 } = captureWarn(() => normalizeVisionConfidence(null));
  assertEq(r1, 'medium', 'null → "medium", same as before this fix');
  const { result: r2 } = captureWarn(() => normalizeVisionConfidence(undefined));
  assertEq(r2, 'medium', 'undefined → "medium", same as before this fix');
  const { result: r3 } = captureWarn(() => normalizeVisionConfidence(''));
  assertEq(r3, 'medium', 'empty string → "medium", same as before this fix');
}

// ─── SECTION 4 — other plausible free-text leaks, same shape as the real bug ───
console.log('\n-- Section 4: other plausible free-text leaks --');
{
  const { result: r1, lines: l1 } = captureWarn(() => normalizeVisionConfidence('Very confident this is a comic book'));
  assertEq(r1, 'medium', 'a different free-text sentence — also rejected, not just the one exact string from the real scan');
  assertTrue(l1.some(x => x.includes('[vision-confidence-invalid]')), 'also logged');
  const { result: r2 } = captureWarn(() => normalizeVisionConfidence('n/a'));
  assertEq(r2, 'medium', '"n/a" — also rejected');
}

// ─── SECTION 5 — root-cause prompt fix: both prompts now instruct the format ───
console.log('\n-- Section 5: api/grade.js prompts carry the explicit instruction --');
{
  const gradeSource = readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');
  const standardPromptMatch = gradeSource.match(/const STANDARD_PROMPT =\s*`([\s\S]*?)`;/);
  const watchPromptMatch = gradeSource.match(/const WATCH_PROMPT =\s*`([\s\S]*?)`;/);
  assertTrue(!!standardPromptMatch, 'STANDARD_PROMPT found in source (sanity check on the regex itself)');
  assertTrue(!!watchPromptMatch, 'WATCH_PROMPT found in source (sanity check on the regex itself)');
  const standardHasInstruction = /confidence must always be exactly one of the three words "low", "medium", or "high"/.test(standardPromptMatch?.[1] || '');
  const watchHasInstruction = /confidence must always be exactly one of the three words "low", "medium", or "high"/.test(watchPromptMatch?.[1] || '');
  assertTrue(standardHasInstruction, 'STANDARD_PROMPT explicitly instructs the low/medium/high format — the gap normalizeVisionConfidence\'s own comment previously (wrongly) claimed was already closed');
  assertTrue(watchHasInstruction, 'WATCH_PROMPT explicitly instructs the low/medium/high format — same gap, same fix');
  // buildGradeOnlyPrompt was ALREADY correctly specified before this fix — confirm it still is, untouched.
  const gradeOnlyHasInstruction = /confidence:\s*"low",\s*"medium",\s*or\s*"high"/.test(gradeSource);
  assertTrue(gradeOnlyHasInstruction, 'buildGradeOnlyPrompt\'s pre-existing, already-correct instruction is untouched by this fix');
}

// ─── SECTION 6 — consolidation: no stray unvalidated duplicates remain in api/enrich.js ───
console.log('\n-- Section 6: api/enrich.js has zero remaining unvalidated inline duplicates --');
{
  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const strayDuplicates = (enrichSource.match(/String\(confidence \|\| 'medium'\)\.toLowerCase\(\)/g) || []).length;
  assertEq(strayDuplicates, 0, 'zero raw String(confidence || \'medium\').toLowerCase() call sites remain — all three real ones now route through the shared, validating normalizeVisionConfidence');
  const importsSharedFn = /normalizeVisionConfidence/.test(enrichSource);
  assertTrue(importsSharedFn, 'api/enrich.js references the shared function (imported and called, not just coincidentally present)');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
