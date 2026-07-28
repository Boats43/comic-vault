// tests/q141-v0i-slab-exclusion.test.js
//
// LAUNCH-PREP TASK 2 (2026-07-28) — api/comps.js query sanitization +
// v0-I emergency-fallback slab exclusion.
//
// CONFIRMED via real production log (deployment dpl_7i72SJ8ZhRCmph6R5ZwNoiEyKrSK,
// build e22e600, request 02:05:20 UTC, Batman #15 / GD 2.0 scan):
//
//   [ship12] using title-family rawTitle: Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover
//   [comps] image-search attempt: "Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover"
//   ... every formal attempt (-1 through 5) ends "post-filter=0" ...
//   [v0-I] era-filter fallback: 7 attempts had raw results
//   [v0-I] best candidate: attempt 5, 83 raw results
//   ... guardrail/title-match/issue-match/year-conflict, NO slab filter ...
//
// The cached re-scan of the same book (02:28:20 UTC) resolved to exactly
// ONE active comp at $650.00 — the exact price of raw item #1 in the pool,
// "Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover" — which became the
// pool's sole comp and drove the floor: "[floor] price 351.13 < floor 650
// (raw 650, cap 920) — enforcing". A CGC 0.5 SLAB became the sole active
// comp pricing a raw GD 2.0 scan.
//
// Two independent fixes, one commit:
//  (a) buildSanitizedComicSearchTitle (src/lib/compHygiene.js) — the
//      title-family-override branch in api/enrich.js now constructs the
//      comps search query from confirmed title+issue+year only, never the
//      raw listing text that carried "CGC 0.5" into the query string.
//  (b) applyRawGradedSeparationFilter (src/lib/compHygiene.js) — the same
//      raw-vs-graded separation every FORMAL comps.js attempt already
//      applies (Filter 2) is now also applied inside the v0-I emergency
//      fallback chain, which previously had no such step at all and
//      processes the raw (pre-filter) candidate pool directly.
//
// This file tests both the extracted pure helpers directly, and an
// integration path through the real exported fetchComps() with global.fetch
// mocked — using the real slab title/price from the production log, plus a
// small number of the real "title-mismatch"-rejected wrong-series titles
// verbatim from the same v0-I trace, for realism and non-regression.
//
// One item in the mocked pool is NOT from the captured log: a plausible
// genuine raw (non-slab) comp, clearly labeled below. The real production
// pool's other ~80 raw items were not individually logged (only titles that
// triggered a guardrail/title-mismatch line were captured), and a live
// re-scan against the NOW-sanitized query text (no "CGC 0.5" in it) would
// not reproduce the OLD query's eBay results anyway — the whole point of
// fix (a) is that eBay sees different, better search text. This addition
// exists to prove the mechanism doesn't collapse to zero when a genuine
// raw comp is available; it is not presented as a replay of real data.
//
// Invoke: node tests/q141-v0i-slab-exclusion.test.js

import {
  buildSanitizedComicSearchTitle,
  applyRawGradedSeparationFilter,
} from '../src/lib/compHygiene.js';
import { fetchComps } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
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

console.log('\n=== Q141 — v0-I slab exclusion + sanitized query text (Batman #15 CGC-0.5-sole-comp class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — buildSanitizedComicSearchTitle (Task 2a)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: buildSanitizedComicSearchTitle\n');

assertEq(
  buildSanitizedComicSearchTitle('batman machine gun', '15', '1943'),
  'batman machine gun #15 1943',
  'title + issue + year joined, no raw listing text'
);
assertTrue(
  !buildSanitizedComicSearchTitle('batman machine gun', '15', '1943').includes('CGC'),
  'sanitized query never contains a grading-service fragment (the real bug: raw title carried "CGC 0.5")'
);
assertEq(
  buildSanitizedComicSearchTitle('Batman', '', ''),
  'Batman',
  'missing issue/year — degrades gracefully to title only, still no raw text'
);
assertEq(buildSanitizedComicSearchTitle('', '15', '1943'), null, 'no title base at all — returns null (fail closed, matches the existing rawTitle-issue-mismatch fallback convention)');
assertEq(buildSanitizedComicSearchTitle(null, null, null), null, 'all-null input — no crash, null');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — applyRawGradedSeparationFilter (Task 2b, unit)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: applyRawGradedSeparationFilter\n');

const REAL_SLAB_ITEM = { title: 'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover', price: 650 };
const RAW_ITEM = { title: 'Batman #15 (1943) DC Comics WWII Machine Gun Cover Good Condition', price: 610 };

assertEq(
  applyRawGradedSeparationFilter([REAL_SLAB_ITEM, RAW_ITEM], { rawOnly: true, gradedOnly: false, assetType: 'comic' }),
  [RAW_ITEM],
  'rawOnly: the real CGC 0.5 slab is excluded, raw comp survives'
);
assertEq(
  applyRawGradedSeparationFilter([REAL_SLAB_ITEM], { rawOnly: true, gradedOnly: false, assetType: 'comic' }),
  [],
  'rawOnly, slab is the ONLY item: filter returns empty, never lets the slab through as a lone survivor'
);
assertEq(
  applyRawGradedSeparationFilter([REAL_SLAB_ITEM, RAW_ITEM], { rawOnly: false, gradedOnly: true, assetType: 'comic' }),
  [REAL_SLAB_ITEM],
  'gradedOnly (user\'s own book IS a slab): inverse holds, only the graded item survives'
);
assertEq(
  applyRawGradedSeparationFilter([REAL_SLAB_ITEM, RAW_ITEM], { rawOnly: true, gradedOnly: false, assetType: 'book' }),
  [REAL_SLAB_ITEM, RAW_ITEM],
  'assetType=book: filter is a no-op (CGC/CBCS slabbing is comic/card-only), matches formal Filter 2 exactly'
);
assertEq(applyRawGradedSeparationFilter([], { rawOnly: true, assetType: 'comic' }), [], 'empty input — no crash, empty output');
assertEq(applyRawGradedSeparationFilter(null, { rawOnly: true, assetType: 'comic' }), null, 'null input — no crash, passthrough');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — integration: fetchComps v0-I path, mocked eBay Browse API
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: fetchComps v0-I integration (mocked eBay Browse API)\n');

// Real title-mismatch rejects, verbatim (lowercased in the source log),
// from the actual v0-I trace for this exact request — wrong-series
// "Absolute Batman" (2024 relaunch) listings that share issue #15 but not
// the "machine gun" family tokens. Included so the test also exercises
// (and does not regress) the pre-existing title-match rejection step.
const REAL_WRONG_SERIES_REJECTS = [
  { title: 'absolute batman #15 cover a nick dragotta first printing', price: 45 },
  { title: 'absolute batman 15 cgc 9.6 1:25 signed &sketch by snyder (unread)', price: 900 },
];

const OAUTH_RESPONSE = JSON.stringify({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });

const makeMockFetch = (browseItems) => async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token')) {
    return { ok: true, status: 200, text: async () => OAUTH_RESPONSE, json: async () => JSON.parse(OAUTH_RESPONSE) };
  }
  if (u.includes('item_summary/search')) {
    const itemSummaries = browseItems.map((it, i) => ({
      itemId: `v1|test-${i}|0`,
      title: it.title,
      price: { value: String(it.price), currency: 'USD' },
      itemWebUrl: `https://www.ebay.com/itm/test-${i}`,
      condition: 'Ungraded',
    }));
    return { ok: true, status: 200, json: async () => ({ itemSummaries }) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const baseParams = {
  title: 'batman machine gun',
  issue: '15',
  grade: 'GD 2.0',
  isGraded: false,
  numericGrade: 2,
  year: '1943',
  imageSearchTitle: null, // Task 2a already stripped this to title+issue+year upstream; comps.js itself is unaffected either way
  appId: 'test-app-id',
  certId: 'test-cert-id',
  categoryId: '259104',
  assetType: 'comic',
};

const originalFetch = globalThis.fetch;

const run = async () => {
  // --- Scenario A: real production shape — the ONLY raw survivor after
  // guardrail/title/issue/year is the CGC 0.5 slab itself. Pre-fix, this
  // slab became the sole active comp ($650). Post-fix, it must not.
  globalThis.fetch = makeMockFetch([REAL_SLAB_ITEM, ...REAL_WRONG_SERIES_REJECTS]);
  const resultA = await fetchComps(baseParams);
  assertEq(resultA.count, 0, 'Scenario A (slab-only survivor, real production shape): comps count is 0, NOT 1 — the CGC 0.5 slab never becomes the sole active comp for this raw-grade scan');
  assertTrue(
    !JSON.stringify(resultA).includes('650'),
    'Scenario A: the slab\'s $650 price does not leak into the result in any form'
  );

  // --- Scenario B: a genuine raw comp is ALSO present in the pool. Confirms
  // the fix does not just fail closed — it surfaces the real comp instead of
  // silently returning nothing when good data exists ("comps search no
  // longer collapses to zero").
  globalThis.fetch = makeMockFetch([REAL_SLAB_ITEM, RAW_ITEM, ...REAL_WRONG_SERIES_REJECTS]);
  const resultB = await fetchComps(baseParams);
  assertTrue(resultB.count > 0, 'Scenario B (genuine raw comp present): comps search does NOT collapse to zero');
  assertEq(resultB.count, 1, 'Scenario B: exactly 1 comp survives — the raw item, not the slab');
  assertTrue(
    !JSON.stringify(resultB).includes('650'),
    'Scenario B: the slab is excluded even though a raw alternative made the pool non-empty — slab never becomes A comp, sole or otherwise'
  );
  assertTrue(
    JSON.stringify(resultB).includes('610'),
    'Scenario B: the genuine raw comp\'s $610 price is present in the result'
  );

  // --- Scenario C: graded book (isGraded=true) — inverse case, confirms the
  // v0-I filter respects gradedOnly the same way Filter 2 does, not just
  // rawOnly. A raw comp must not become the sole comp for a GRADED scan.
  globalThis.fetch = makeMockFetch([REAL_SLAB_ITEM, RAW_ITEM, ...REAL_WRONG_SERIES_REJECTS]);
  const resultC = await fetchComps({ ...baseParams, grade: 'CGC 0.5', isGraded: true, numericGrade: 0.5 });
  assertTrue(resultC.count > 0, 'Scenario C (graded scan): still finds a comp via v0-I');
  assertTrue(
    !JSON.stringify(resultC).includes('610'),
    'Scenario C: the raw (non-slab) comp is excluded for a graded-book scan — gradedOnly branch works symmetrically'
  );

  console.log('\n' + '━'.repeat(59));
  if (failed === 0) {
    console.log(`✓ All tests passed (${passed} assertions)`);
  } else {
    console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  }
  console.log('━'.repeat(59));

  globalThis.fetch = originalFetch;
  // fetchComps' kv-cache layer initializes an Upstash Redis client with a
  // keep-alive HTTP agent even when unconfigured (fails closed per-call,
  // but the client object itself lingers) — explicit exit so this script
  // terminates instead of hanging on a dangling handle.
  process.exit(failed === 0 ? 0 : 1);
};

await run();
