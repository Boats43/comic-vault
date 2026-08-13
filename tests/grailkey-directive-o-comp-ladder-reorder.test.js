// tests/grailkey-directive-o-comp-ladder-reorder.test.js
//
// GrailKey Directive 2026-08-13-O — comp query ladder ordering fix.
//
// Predecessor: Directive N1 (identity-resolution trace) proved Defect A —
// the image-search attempt (n=-1, api/comps.js, Ship #20a.6.7b.3) is
// variant-blind by ship12/Q141 design and was pushed unconditionally FIRST
// in the attempts array, ahead of attempt 0 (the first attempt that carries
// a confirmed variant in its query text). The attempt loop breaks on the
// FIRST attempt with any post-filter survivor — so for a book with generic
// copies coexisting with a real variant, the broad variant-blind query wins
// before the variant-bearing query ever runs.
//
// Real production evidence: Sabrina scan, build 11d70aa, 16:16 —
// confirmedVariant="Dan Parent NYCC variant" (the physical book: Sabrina
// Annual Spectacular 2024 #1, Dan Parent NYCC Foil, 11/50, real comp ~$50).
// attempt -1 ("Sabrina the Teenage Witch #1", no variant) returned 84 raw /
// 11 final survivors off generic 1997 copies; attempt 0 (which carries "Dan
// Parent NYCC variant" in its query) never ran. Priced $9.56, wrong book.
//
// Fix (this dispatch): ORDER ONLY. When a confirmed variant exists, the
// already-built image-search attempt is moved to run immediately after the
// last variant-bearing attempt (n 0-2) instead of unconditionally first.
// No query string changed. No-variant behavior is untouched (structural
// non-regression, not merely aspirational — the reorder block is a no-op
// whenever `variant` is falsy or no variant-bearing attempt exists at all).
//
// This file demonstrates the PRE-FIX failure DIRECTLY against the real
// git-HEAD version of api/comps.js (via a git-stash dance the harness
// script below performs, see run-directive-o-test.sh), not a mirrored
// predicate — the attempt-array construction lives entirely inside the
// non-exported body of fetchComps() and is not independently constructible
// as a separate pure function, so the only way to test it directly is to
// run the real fetchComps() itself, pre-fix and post-fix, against a mocked
// eBay Browse API that returns different pools for different query text.
//
// Invoke: node tests/grailkey-directive-o-comp-ladder-reorder.test.js
// (run once against git HEAD's original api/comps.js, once against the
// working-tree fixed version — see the directive's own stash-and-compare
// protocol; this file's assertions differ by which POOL SHAPE won, which
// is exactly the signal that distinguishes pre-fix from post-fix.)

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

console.log('\n=== GrailKey Directive O — comp query ladder reorder (Sabrina / Dan Parent NYCC class) ===\n');

const OAUTH_RESPONSE = JSON.stringify({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });

// Generic 1997-shaped pool — no year token in the title (real sellers
// routinely omit it; keeps this test isolated from the era-filter/year
// defect, which is explicitly out of scope for this dispatch), no variant
// descriptor, no format-word asymmetry vs. our confirmed title, no
// reprint/slab/signed/lot/TPB markers. Mirrors the real incident's
// "abundant generic copies" shape.
const GENERIC_POOL = [
  { title: 'Sabrina the Teenage Witch #1 Comic Book NM Regular Cover', price: 9.99 },
  { title: 'Sabrina the Teenage Witch #1 Standard Edition VF', price: 8.5 },
  { title: 'Sabrina the Teenage Witch #1 Comic NM Plus', price: 11.0 },
];

// The real variant — only returned when the query text actually names it.
const VARIANT_POOL = [
  { title: 'Sabrina the Teenage Witch #1 Dan Parent NYCC Foil Variant LE 50', price: 50.0 },
  { title: 'Sabrina the Teenage Witch #1 NYCC Foil Dan Parent Variant', price: 55.0 },
];

// Query-differentiated mock: proves WHICH attempt's query text actually
// reached the (mocked) eBay Browse API, not just that "some pool" won.
const makeMockFetch = ({ variantPool = VARIANT_POOL, genericPool = GENERIC_POOL } = {}) => async (url, opts) => {
  const u = String(url);
  if (u.includes('oauth2/token')) {
    return { ok: true, status: 200, text: async () => OAUTH_RESPONSE, json: async () => JSON.parse(OAUTH_RESPONSE) };
  }
  if (u.includes('item_summary/search')) {
    const q = String(u).toLowerCase();
    const isVariantQuery = q.includes('dan') && q.includes('parent');
    const pool = isVariantQuery ? variantPool : genericPool;
    const itemSummaries = pool.map((it, i) => ({
      itemId: `v1|${isVariantQuery ? 'variant' : 'generic'}-${i}|0`,
      title: it.title,
      price: { value: String(it.price), currency: 'USD' },
      itemWebUrl: `https://www.ebay.com/itm/${isVariantQuery ? 'variant' : 'generic'}-${i}`,
      condition: 'Ungraded',
    }));
    return { ok: true, status: 200, json: async () => ({ itemSummaries }) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const baseParams = {
  title: 'Sabrina the Teenage Witch',
  issue: '1',
  grade: 'NM',
  isGraded: false,
  numericGrade: 9.4,
  year: '2024',
  variant: 'Dan Parent NYCC variant',
  imageSearchTitle: 'Sabrina the Teenage Witch #1', // real incident's own attempt -1 text, variant-free by ship12/Q141 design
  appId: 'test-app-id',
  certId: 'test-cert-id',
  categoryId: '259104',
  assetType: 'comic',
  publisher: 'Archie Comics',
};

const originalFetch = globalThis.fetch;

const run = async () => {
  // ---------------------------------------------------------------------
  // Scenario A — the real Sabrina shape: confirmed variant + abundant
  // generic copies. This is the scenario whose PRE-FIX/POST-FIX behavior
  // differs; run against HEAD and against the working tree to see the
  // before/after (see the dispatch's own stash protocol for how this file
  // is invoked twice).
  // ---------------------------------------------------------------------
  globalThis.fetch = makeMockFetch();
  const resultA = await fetchComps(baseParams);
  // Check recentSales[].title text, not price substrings — "8.50" contains
  // the literal digits "50" once formatted with two decimals, which made an
  // earlier draft of this assertion a false positive. Titles are
  // unambiguous: only VARIANT_POOL rows mention "Dan Parent" / "NYCC".
  const titlesA = (resultA.recentSales || []).map((r) => String(r.title || '').toLowerCase());
  const wonVariant = resultA.count > 0 && titlesA.some((t) => t.includes('dan parent'));
  const wonGeneric = resultA.count > 0 && titlesA.some((t) => t.includes('regular cover') || t.includes('standard edition'));
  console.log(`  [scenario A] count=${resultA.count} titles=${JSON.stringify(titlesA)} wonVariant=${wonVariant} wonGeneric=${wonGeneric}`);
  assertTrue(
    wonVariant,
    'Scenario A: the confirmed-variant pool ("Dan Parent NYCC", $50/$55) wins the priced pool — ' +
    'the variant-bearing attempt ran and its survivors reached pricing (this assertion is the one ' +
    'that flips between pre-fix FAIL and post-fix PASS)'
  );
  assertTrue(
    !wonGeneric,
    'Scenario A: the generic 1997-shaped pool ($8.50-$11.00) does NOT reach pricing when a real ' +
    'variant-bearing attempt is available'
  );

  // ---------------------------------------------------------------------
  // Scenario B — fall-through still works: variant-bearing query returns
  // NOTHING (mocked as an empty variant pool), generic image-search query
  // returns real survivors. The ladder must still broaden and use the
  // generic result rather than returning empty — the reorder must not
  // break the existing broaden-on-failure direction.
  // ---------------------------------------------------------------------
  globalThis.fetch = makeMockFetch({ variantPool: [] });
  const resultB = await fetchComps(baseParams);
  const titlesB = (resultB.recentSales || []).map((r) => String(r.title || '').toLowerCase());
  assertTrue(
    resultB.count > 0,
    'Scenario B (variant query returns nothing): ladder still falls through to the generic ' +
    'image-search attempt rather than returning empty'
  );
  assertTrue(
    titlesB.some((t) => t.includes('regular cover') || t.includes('standard edition')),
    'Scenario B: the generic pool\'s listings are present when they are genuinely the only source'
  );

  // ---------------------------------------------------------------------
  // Scenario C — no-variant case is structurally unchanged. Same generic/
  // variant pools, but `variant: null` — the reorder block must be a
  // no-op, and image-search (attempt -1) must win exactly as it always
  // has for a book with no confirmed variant.
  // ---------------------------------------------------------------------
  globalThis.fetch = makeMockFetch();
  const resultC = await fetchComps({ ...baseParams, variant: null });
  const titlesC = (resultC.recentSales || []).map((r) => String(r.title || '').toLowerCase());
  assertTrue(
    resultC.count > 0 && titlesC.some((t) => t.includes('regular cover') || t.includes('standard edition')),
    'Scenario C (no confirmed variant): the variant-blind image-search attempt still wins first, ' +
    'unchanged from pre-dispatch behavior — no-variant books are not affected by this fix'
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
};

run();
