// tests/dispatch-42-comicvine-kill.test.js
//
// Dispatch 42 — ComicVine safe-kill, targeted regression suite.
// Covers Tasks 1-5's actual code changes. App.jsx/db.js contain
// browser-only code (JSX / the `indexedDB` global) not importable by this
// repo's plain-Node test runner — those two are verified via source-shape
// (readFileSync + string checks), the same established pattern already used
// by tests/grailkey-commit-c/e/f/g/p for App.jsx-touching dispatches.
// Everything importable (cacheKeys.js, compHygiene.js, api/enrich.js's two
// ComicVine functions, the volume-label era-rescue mechanism) is exercised
// with real function calls, not reproductions.
//
// Invoke: node tests/dispatch-42-comicvine-kill.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildFilterContextFingerprint, buildActiveCompCacheKey } from '../src/lib/cacheKeys.js';
import { COMP_FILTER_VERSION, getEraYearTolerance, evaluateEraYearMatch } from '../src/lib/compHygiene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Dispatch 42 — ComicVine safe-kill regression suite ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Task 2 — cvVolumeStartYear fingerprint gap
// ═══════════════════════════════════════════════════════════════════════
console.log('Task 2: cvVolumeStartYear fingerprint gap\n');
{
  assertEq(COMP_FILTER_VERSION, 11, 'COMP_FILTER_VERSION bumped 10 -> 11');

  const base = { grade: 'FN/VF 7.0', year: '1976', isGraded: false, assetType: 'comic' };
  const withCv = buildFilterContextFingerprint({ ...base, cvVolumeStartYear: 1976 });
  const withoutCv = buildFilterContextFingerprint({ ...base, cvVolumeStartYear: null });
  const withDifferentCv = buildFilterContextFingerprint({ ...base, cvVolumeStartYear: 1991 });
  assertTrue(withCv !== withoutCv, 'changing ONLY cvVolumeStartYear (present vs absent) changes the fingerprint');
  assertTrue(withCv !== withDifferentCv, 'changing ONLY cvVolumeStartYear (1976 vs 1991) changes the fingerprint');

  // Old-shape key (COMP_FILTER_VERSION was 10 when this fingerprint's 7-field
  // predecessor was live) can never collide with any key this build
  // constructs — proven two independent ways: version prefix AND fingerprint.
  const oldV10Key = `v10:Witching Hour|66|${withoutCv}`;
  const realKey = buildActiveCompCacheKey(COMP_FILTER_VERSION, 'Witching Hour', '66', withoutCv);
  assertTrue(realKey.startsWith('v11:'), 'real active-comp cache key now uses the v11 prefix');
  assertTrue(realKey !== oldV10Key, 'a v10-shaped key can never match the real v11 key');

  // Regression guard: existing fingerprint behavior (7-field semantics)
  // must be unaffected when cvVolumeStartYear is omitted on both sides —
  // Task 2 must not change behavior for any pre-existing caller.
  const legacyA = buildFilterContextFingerprint({ numericGrade: 8, year: '2016', isGraded: true, assetType: 'comic' });
  const legacyB = buildFilterContextFingerprint({ grade: 'VF 8.0', year: 2016, isGraded: true, assetType: 'comic' });
  assertEq(legacyA, legacyB, 'pre-existing semantic-equivalence behavior (numericGrade vs parsed grade) unaffected by the new field');
}

// ═══════════════════════════════════════════════════════════════════════
// Task 5 — ComicVine adapter disabled (real function calls, fetch spied)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTask 5: ComicVine adapter disabled — no network call, graceful null\n');
{
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { fetchCalls++; throw new Error('fetch() must not be called with ComicVine disabled: ' + JSON.stringify(args[0])); };

  const { lookupComicVineByUPC, lookupComicVine } = await import('../api/enrich.js');

  let threw = false;
  let upcResult, searchResult;
  try {
    upcResult = await lookupComicVineByUPC('076194130066');
    searchResult = await lookupComicVine({ title: 'The Witching Hour', issue: '66', year: '1976', publisher: 'DC' });
  } catch (e) {
    threw = true;
  }
  globalThis.fetch = realFetch;

  assertTrue(!threw, 'lookupComicVineByUPC / lookupComicVine do not throw when disabled');
  assertEq(upcResult, null, 'lookupComicVineByUPC returns null with COMICVINE_ENABLED=false');
  assertEq(searchResult, null, 'lookupComicVine returns null with COMICVINE_ENABLED=false');
  assertEq(fetchCalls, 0, 'zero fetch() calls made by either function — ComicVine is genuinely unreachable, not just failing after a request');
}

// ═══════════════════════════════════════════════════════════════════════
// Task 3 — barcode fallback source-shape (api/enrich.js)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTask 3: barcode fallback — no 404, identifier retained\n');
{
  const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');
  assertTrue(
    !enrichSrc.includes('res.status(404).json({ error: "Barcode not found in ComicVine database" })'),
    'the hard 404 on unresolved barcode has been removed'
  );
  assertTrue(
    enrichSrc.includes('out.scannedBarcode = barcode || null;'),
    'out.scannedBarcode retains the raw identifier unconditionally'
  );
  assertTrue(
    enrichSrc.includes('confirmedTitle = barcodeIdentity.title;') &&
    enrichSrc.includes('if (barcodeIdentity) {'),
    'confirmedTitle/Issue writes from barcode remain gated behind a truthy barcodeIdentity (a bare/unresolved UPC cannot write confirmedIssue)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Task 1 — IndexedDB migration + merge-path source-shape (App.jsx / db.js
// are browser-only; not importable — verified as source shape, matching
// tests/grailkey-commit-c/e/f/g/p's established pattern for this repo)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTask 1: IndexedDB stale-CV migration — source shape\n');
{
  const dbSrc = readFileSync(path.join(repoRoot, 'src/db.js'), 'utf8');
  assertTrue(dbSrc.includes('export const migrateComicVineRemoval'), 'migrateComicVineRemoval is exported from db.js');
  assertTrue(dbSrc.includes('const { comicVine, ...rest } = item;'), 'migration strips the comicVine key rather than nulling it in place');
  assertTrue(dbSrc.includes('CV_MIGRATION_FLAG'), 'migration is idempotent (one-shot flag), safe to call on every load per the migrateFromLocalStorage precedent');

  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const bootOrderRe = /await migrateFromLocalStorage\(\);\s*\n\s*await migrateComicVineRemoval\(\);/;
  assertTrue(bootOrderRe.test(appSrc), 'migration runs at boot, right after the existing legacy migration, before catalogue render');

  const staleFallbackPatterns = [
    'enrich.comicVine || cur.comicVine || null',
    'enrich.comicVine || s.comicVine || null',
    'enrich.comicVine || item.comicVine || null',
  ];
  for (const p of staleFallbackPatterns) {
    assertTrue(!appSrc.includes(p), `stale fallback pattern removed: "${p}"`);
  }
  // 7 merge paths total, not 6 — Dispatch 41's original trace missed the
  // 7th (line ~12862, "idGatedDup" duplicate-confirm path), caught by this
  // suite's first run (a real gap, not a hypothetical) and fixed alongside it.
  const comicVineAssignments = (appSrc.match(/comicVine: enrich\.comicVine \|\| null/g) || []).length +
    (appSrc.match(/comicVine: enrich\.polybagDetected \? null : \(enrich\.comicVine \|\| null\)/g) || []).length;
  assertEq(comicVineAssignments, 7, 'all 7 merge paths now assign comicVine with no cur/s/item fallback (no resurrection path)');
}

// ═══════════════════════════════════════════════════════════════════════
// Task 4 — volume-label era rescue loss, release gate (formalized as a
// permanent regression case: real production evidence, Q128 dispatch,
// Harley Quinn #62, dpl_FcaXCbwE3J9HrwWysu7ZfLM2FY2X)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTask 4: volume-label era rescue loss — release gate (frozen evidence)\n');
{
  // The REAL production case does not depend on the CV rescue at all —
  // kept via ordinary tolerance either way (diff=3 clears +/-3 on its own).
  const realCaseTol = getEraYearTolerance(2019);
  const realCaseWithCv = evaluateEraYearMatch(2016, 2019, realCaseTol, 2016);
  const realCaseWithoutCv = evaluateEraYearMatch(2016, 2019, realCaseTol, null);
  assertTrue(realCaseWithCv.keep === true && realCaseWithoutCv.keep === true, 'REAL Harley Quinn #62 production case unaffected by CV kill (kept via base tolerance both ways)');
  assertEq(realCaseWithoutCv.matchedVia, 'confirmed-year', 'still attributed to ordinary tolerance post-kill, not a phantom rescue');

  // The one genuinely CV-rescue-dependent case in the available evidence
  // (q128 test file's own constructed near-miss) — must degrade to
  // REJECTED (throughput cost), never to a false ACCEPT (safety regression).
  const nearMissTol = getEraYearTolerance(2020);
  const nearMissWithCv = evaluateEraYearMatch(2016, 2020, nearMissTol, 2016);
  const nearMissWithoutCv = evaluateEraYearMatch(2016, 2020, nearMissTol, null);
  assertTrue(nearMissWithCv.keep === true && nearMissWithCv.matchedVia === 'volume-label', 'near-miss case is genuinely CV-rescue-dependent today (sanity check on the fixture itself)');
  assertEq(nearMissWithoutCv.keep, false, 'post-kill: near-miss case is REJECTED, not falsely accepted (THROUGHPUT COST, not SAFETY REGRESSION)');

  // Contamination control must reject both ways — CV kill must not make
  // the mechanism MORE permissive by accident.
  const contamTol = getEraYearTolerance(2002);
  const contamWithCv = evaluateEraYearMatch(2024, 2002, contamTol, 1940);
  const contamWithoutCv = evaluateEraYearMatch(2024, 2002, contamTol, null);
  assertEq(contamWithCv.keep, false, 'genuine contamination rejected with CV enabled (control)');
  assertEq(contamWithoutCv.keep, false, 'genuine contamination still rejected with CV killed (no new false-permissiveness)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
