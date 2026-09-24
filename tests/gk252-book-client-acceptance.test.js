// tests/gk252-book-client-acceptance.test.js
//
// GK-252 (U6.0D) — Book-aware client acceptance gate, App.jsx:12052-12092
// (gradeBlob's post-/api/grade rejection check). The real logic is embedded
// in a React useCallback closure with many hook/ref dependencies, not a
// standalone exported function, so this file does two things: (1) a
// faithful, hand-reproduced mirror of the exact predicate (cited to the
// real file:line, matching this repo's own established static-proof
// convention, e.g. GK-142's NO_PREMIUM parity test), and (2) a static
// source-text presence check confirming the real source still contains the
// exact expected condition strings, to catch drift between the mirror and
// the real code.
//
// Fixtures include the two ACTUAL real Production /api/grade response
// shapes captured for "The Rationalists" (2026-09-24, build dca47d5,
// requests 03:06:16 and 03:07:56 UTC) — not synthetic guesses.
//
// Invoke: node tests/gk252-book-client-acceptance.test.js

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-252 — U6.0D Book-aware client acceptance gate ===\n');

// ─── Faithful mirror of App.jsx:12052-12092's real logic ─────────────
// Returns 'ACCEPT_BOOK' | 'ACCEPT_COMIC' | 'REJECT'.
function classify(data) {
  const isUsableBookTitle = data.title &&
    data.title.trim() &&
    !data.title.toLowerCase().includes('not a comic') &&
    !data.title.toLowerCase().includes('unknown');
  if (data.assetType === 'book' && isUsableBookTitle) {
    return 'ACCEPT_BOOK';
  } else if (
    !data.title ||
    data.title.toLowerCase().includes('not a comic') ||
    data.title.toLowerCase().includes('unknown') ||
    (!data.publisher && !data.year && !data.issue && data.assetTypeConfident !== true)
  ) {
    return 'REJECT';
  }
  return 'ACCEPT_COMIC';
}

// ─── Static source-text drift guard ───────────────────────────────────
console.log('Static source-text presence (drift guard):');
{
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assertTrue(src.includes("data.assetType === 'book' && isUsableBookTitle"), 'the real source still contains the book-acceptance condition verbatim');
  assertTrue(src.includes('!data.publisher && !data.year && !data.issue && data.assetTypeConfident !== true'), 'the real source still contains the ORIGINAL, byte-identical comic-rejection condition verbatim');
}

// ─── Real Production response shapes (not synthetic) ──────────────────
console.log('\nReal Production Rationalists scans (2026-09-24, build dca47d5):');
{
  // 03:06:16 UTC -- [grade][book-first-fire] title="The Rationalists"
  // authorPresent=true publisherPresent=false yearPresent=false
  // isbnPresent=false editionPresent=false formatPresent=true
  // assetType="book" triggerSource=ebayPoolBookSignal
  const scan1 = { title: 'The Rationalists', author: 'x', publisher: null, year: null, isbn: null, edition: null, format: 'Paperback', assetType: 'book' };
  assertEq(classify(scan1), 'ACCEPT_BOOK', 'real scan 1 (03:06:16, authorPresent=true) is now accepted -- was "No comic detected" before this fix');

  // 03:07:56 UTC -- same title, authorPresent=false this time.
  const scan2 = { title: 'The Rationalists', author: null, publisher: null, year: null, isbn: null, edition: null, format: 'Paperback', assetType: 'book' };
  assertEq(classify(scan2), 'ACCEPT_BOOK', 'real scan 2 (03:07:56, authorPresent=false) is now accepted -- was "No comic detected" before this fix');
}

// ─── Valid book / title-only acceptance ────────────────────────────────
console.log('\nValid Book acceptance, minimal evidence:');
{
  assertEq(classify({ title: 'Some Real Book', assetType: 'book' }), 'ACCEPT_BOOK', 'title-only book (no author/publisher/year/isbn/edition/format) still accepts');
  assertEq(classify({ title: '  Some Real Book  ', assetType: 'book' }), 'ACCEPT_BOOK', 'whitespace-padded title still accepts (trimmed check)');
}

// ─── Invalid Book title rejection ──────────────────────────────────────
console.log('\nInvalid Book title rejection:');
{
  assertEq(classify({ title: null, assetType: 'book' }), 'REJECT', 'null title with assetType=book still rejects');
  assertEq(classify({ title: '', assetType: 'book' }), 'REJECT', 'empty-string title with assetType=book still rejects');
  assertEq(classify({ title: '   ', assetType: 'book' }), 'REJECT', 'whitespace-only title with assetType=book still rejects');
  assertEq(classify({ title: 'Unknown', assetType: 'book' }), 'REJECT', '"Unknown" placeholder title with assetType=book still rejects');
  assertEq(classify({ title: 'This is not a comic', assetType: 'book' }), 'REJECT', '"not a comic" placeholder title with assetType=book still rejects');
}

// ─── Failed comic unchanged (byte-identical rejection logic) ──────────
console.log('\nFailed comic — unchanged rejection:');
{
  assertEq(classify({ title: null, assetType: 'comic' }), 'REJECT', 'null title, comic: rejects (unchanged)');
  assertEq(classify({ title: 'Not a comic', assetType: 'comic' }), 'REJECT', '"not a comic" title, comic: rejects (unchanged)');
  assertEq(classify({ title: 'Unknown', assetType: 'comic' }), 'REJECT', '"unknown" title, comic: rejects (unchanged)');
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', publisher: null, year: null, issue: null, assetTypeConfident: false }), 'REJECT', 'comic with all three null + assetTypeConfident=false: rejects (unchanged)');
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', publisher: null, year: null, issue: null, assetTypeConfident: undefined }), 'REJECT', 'comic with all three null + assetTypeConfident undefined: rejects (unchanged)');
}

// ─── Successful comic unchanged ────────────────────────────────────────
console.log('\nSuccessful comic — unchanged acceptance:');
{
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', publisher: 'Marvel', year: null, issue: null, assetTypeConfident: false }), 'ACCEPT_COMIC', 'comic with publisher present: accepts (unchanged)');
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', publisher: null, year: '1990', issue: null, assetTypeConfident: false }), 'ACCEPT_COMIC', 'comic with year present: accepts (unchanged)');
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', publisher: null, year: null, issue: '300', assetTypeConfident: false }), 'ACCEPT_COMIC', 'comic with issue present: accepts (unchanged)');
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', publisher: null, year: null, issue: null, assetTypeConfident: true }), 'ACCEPT_COMIC', 'comic with assetTypeConfident=true (virgin/sketch cover, all three null): accepts (unchanged, GK-41)');
  // A comic scan never carries assetType='book' -- confirm the book branch
  // never accidentally intercepts a genuine comic missing publisher/year/
  // issue but WITH assetTypeConfident=true (the GK-41 virgin-cover case).
  assertEq(classify({ title: 'Amazing Spider-Man', assetType: 'comic', assetTypeConfident: true }), 'ACCEPT_COMIC', 'GK-41 virgin-cover comic case unaffected by the new book branch');
}

// ─── Client -> /api/enrich handoff proof ───────────────────────────────
console.log('\nClient -> /api/enrich handoff (assetType threading):');
{
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  // Confirms the existing, unmodified enrichBody construction (App.jsx,
  // gradeBlob) already threads assetType through to /api/enrich for an
  // accepted Book -- this was already correct before U6.0D; this test
  // only confirms U6.0D's new gate didn't disturb it.
  assertTrue(src.includes("assetType: data.assetType || 'comic'"), 'gradeBlob\'s enrichBody still threads assetType through to /api/enrich unchanged');
}

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
