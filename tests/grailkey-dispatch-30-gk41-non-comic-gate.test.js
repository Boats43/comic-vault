// tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js
//
// GrailKey Dispatch 30 (2026-08-08) — GK-41, non-comic rejection gate
// (src/App.jsx gradeBlob + handleBulkImport).
//
// Same-day production regression from Dispatch 29's Fix 3a: a bulk
// import of a real Spawn #351 virgin variant returned "0 added, 1
// failed... not a comic". The wording fix (see the updated Section 2 in
// tests/grailkey-dispatch-29-fix3a-vision-prompt.test.js) addresses the
// assetTypeConfident misclassification, but code-reading proved that
// fix ALONE would not have resolved the reported symptom: the actual
// hard-reject predicate at both call sites is
//   (!data.publisher && !data.year && !data.issue)
// which is fully independent of assetTypeConfident. On a genuine virgin
// variant, Vision now correctly returns null for all three — because
// Dispatch 29's issue-null and year-null clauses are working exactly as
// designed. The old year-guessing sentence Dispatch 29 removed was
// accidentally load-bearing for this gate: a fabricated "1992" kept the
// three-null clause from ever firing. Removing the fabrication —
// correctly — exposed a downstream consumer that had never seen an
// empty value before. Named class: "a consumer depending on a
// fabricated value fails when the value becomes honest" (Pattern
// Library).
//
// CANNOT-VERIFY note: client-side bulk-import rejections never reach
// /api/enrich, so there is no server-side log trace of the specific
// reported failure (s-l1600.webp) — the browser-only `[bulk] grade
// result:` console.log that would show the raw Vision fields is not
// accessible server-side. The evidence for this fix is the code read
// (the byte-identical three-null predicate at both call sites), not a
// reproduced production log line. Stating this plainly per instruction,
// rather than implying log confirmation that doesn't exist.
//
// GK-41 fix: the three-null clause is bypassed when Vision itself
// affirms assetTypeConfident===true. Not also re-gated on data.title —
// !data.title already forces rejection via the first clause in the same
// || chain, so repeating it would be dead logic (the exact shape GK-40's
// duplicated-vocabulary drift warns about: a redundant guard that reads
// as protection and isn't).
//
// Slipped-through case, deliberately accepted as bounded: Vision wrongly
// asserts assetTypeConfident=true on a genuine non-comic object AND
// simultaneously returns zero identity signal. Narrower than today's
// blanket rejection of every zero-metadata cover, and it degrades
// honestly downstream — identityGate.assessIdentityConfidence still
// requires missingFields.length===0, so a book that reaches the
// pipeline with null issue/year/publisher lands on ID_REQUIRED, not a
// fabricated price.
//
// GK-43 (logged only, not fixed): the two call sites' 'unknown' title
// checks have always differed — gradeBlob uses .includes('unknown'),
// handleBulkImport uses an exact `=== 'unknown'` match. Pre-existing,
// unrelated to GK-41, deliberately left alone here (touching it inside
// an urgent fix is how unrelated regressions get bought). Section 3
// below asserts this divergence is real and UNCHANGED by this diff, not
// closed by it.
//
// Test approach: App.jsx's non-comic gate is an inline conditional in a
// React callback, not an exported function — there is no unit-test
// harness for embedded UI logic in this repo (see CLAUDE.md's known
// test suites, all of which test exported src/lib or api functions).
// Rather than hand-retype the predicate (which would silently drift
// from the shipped code — exactly the risk this fix exists to close),
// each site's actual `if (...)` condition text is extracted directly
// from the live App.jsx source via anchored regex and evaluated as real
// JavaScript against fixture data. This exercises the literal shipped
// expression, not a paraphrase of it.
//
// Invoke: node tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Dispatch 30 — GK-41, non-comic rejection gate ===\n');

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// ═══════════════════════════════════════════════════════════════════════
// Extract the REAL shipped condition text from both call sites.
// ═══════════════════════════════════════════════════════════════════════

const gradeBlobBlockMatch = appSource.match(
  /\/\/ FIX 2: Non-comic rejection\. GK-41[\s\S]*?if \(([\s\S]*?)\)\s*\{\s*\n\s*setError\("No comic detected\. Try again\."\);/
);
assertTrue(!!gradeBlobBlockMatch, 'gradeBlob non-comic gate is found and isolated for extraction');
const gradeBlobCond = gradeBlobBlockMatch?.[1] || 'false';

const bulkBlockMatch = appSource.match(
  /\/\/ Non-comic rejection \(mirrors gradeBlob :3844-3852\)\. GK-41[\s\S]*?const titleLower = \(data\.title \|\| ''\)\.toLowerCase\(\);\s*\n\s*if \(([\s\S]*?)\)\s*\{\s*\n\s*console\.warn\('\[bulk\] not a comic, skipping:'/
);
assertTrue(!!bulkBlockMatch, 'handleBulkImport non-comic gate is found and isolated for extraction');
const bulkCond = bulkBlockMatch?.[1] || 'false';

// Compile each extracted condition as real JS, evaluated against fixture
// data — this runs the literal shipped expression, not a hand-copy of it.
const gradeBlobRejects = new Function('data', `return (${gradeBlobCond});`);
const bulkRejects = new Function('data', `const titleLower = (data.title || '').toLowerCase(); return (${bulkCond});`);

// ═══════════════════════════════════════════════════════════════════════
// Section 1 — THE REGRESSION FIX: a real virgin-variant shape (title
// present, assetTypeConfident=true, publisher/year/issue all honestly
// null) must be ACCEPTED at both call sites, not rejected.
// ═══════════════════════════════════════════════════════════════════════
console.log('-- Section 1: virgin-variant shape (assetTypeConfident=true, all three null) is ACCEPTED --');
{
  const virginVariant = { title: 'Spawn', publisher: null, year: null, issue: null, assetTypeConfident: true };
  assertEq(gradeBlobRejects(virginVariant), false, 'gradeBlob: virgin-variant shape (assetTypeConfident=true) is NOT rejected — the actual regression this dispatch fixes');
  assertEq(bulkRejects(virginVariant), false, 'handleBulkImport: virgin-variant shape (assetTypeConfident=true) is NOT rejected — the actual regression this dispatch fixes');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 2 — the gate still does its job: a genuinely-uncertain
// zero-metadata scan (assetTypeConfident false or absent) still rejects,
// and outright garbage (no title, or "not a comic" title) still rejects
// regardless of assetTypeConfident.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 2: the gate still protects against genuine garbage --');
{
  const sameShapeButNotConfident = { title: 'Spawn', publisher: null, year: null, issue: null, assetTypeConfident: false };
  assertEq(gradeBlobRejects(sameShapeButNotConfident), true, 'gradeBlob: identical zero-metadata shape with assetTypeConfident=false still REJECTS — the bypass is gated on the flag, not on any zero-metadata shape');
  assertEq(bulkRejects(sameShapeButNotConfident), true, 'handleBulkImport: identical zero-metadata shape with assetTypeConfident=false still REJECTS');

  const undefinedFlag = { title: 'Something', publisher: null, year: null, issue: null };
  assertEq(gradeBlobRejects(undefinedFlag), true, 'gradeBlob: assetTypeConfident undefined (older/other response shapes) behaves like false — still REJECTS, backward compatible');
  assertEq(bulkRejects(undefinedFlag), true, 'handleBulkImport: assetTypeConfident undefined still REJECTS');

  const noTitle = { title: null, publisher: null, year: null, issue: null, assetTypeConfident: true };
  assertEq(gradeBlobRejects(noTitle), true, 'gradeBlob: no title at all REJECTS even with assetTypeConfident=true — !data.title fires independently, first in the || chain');
  assertEq(bulkRejects(noTitle), true, 'handleBulkImport: no title at all REJECTS even with assetTypeConfident=true');

  const notAComicTitle = { title: 'Not a Comic', publisher: null, year: null, issue: null, assetTypeConfident: true };
  assertEq(gradeBlobRejects(notAComicTitle), true, 'gradeBlob: title contains "not a comic" REJECTS regardless of assetTypeConfident');
  assertEq(bulkRejects(notAComicTitle), true, 'handleBulkImport: title contains "not a comic" REJECTS regardless of assetTypeConfident');

  const normalBook = { title: 'Amazing Spider-Man', publisher: 'Marvel', year: '2018', issue: '1', assetTypeConfident: true };
  assertEq(gradeBlobRejects(normalBook), false, 'gradeBlob: an ordinary fully-identified book is NOT rejected (unchanged baseline behavior)');
  assertEq(bulkRejects(normalBook), false, 'handleBulkImport: an ordinary fully-identified book is NOT rejected (unchanged baseline behavior)');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 3 — GK-43 (logged only): the pre-existing 'unknown' title
// divergence between the two sites is real and UNCHANGED by this diff.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 3: GK-43 pre-existing unknown-check divergence — confirmed real, confirmed untouched --');
{
  // gradeBlob uses .includes('unknown') — a substring match, so any title
  // containing "unknown" anywhere trips it, even with real identity data.
  // handleBulkImport uses an exact `=== 'unknown'` match — a longer title
  // that merely contains "unknown" does NOT trip it there.
  const containsUnknown = { title: 'Unknown Origins Annual', publisher: 'Marvel', year: '2020', issue: '1', assetTypeConfident: true };
  assertEq(gradeBlobRejects(containsUnknown), true, 'gradeBlob: title containing "unknown" as a substring REJECTS (.includes match) — real, pre-existing behavior');
  assertEq(bulkRejects(containsUnknown), false, 'handleBulkImport: the SAME title does NOT reject (exact === match only) — confirms the GK-43 divergence is real and left untouched by this diff');
}

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
