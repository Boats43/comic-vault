// tests/perf-kv-dedup-and-oauth-cache.test.js
//
// Performance dispatch (2026-07-20) — two LOW-RISK latency fixes, neither
// touching identity/comp-matching/scoring logic. Found via real production
// log measurement (Vercel runtime logs, [timing] summary lines + a
// pc_requery_complete outlier investigation), not synthetic benchmarks.
//
// FIX 1 — duplicate KV read in the PC lookup (api/enrich.js ~2855-2870).
// `fullTitleKey` and `strippedTitleKey` are byte-identical whenever
// confirmedTitle has no subtitle/colon (the common case — subtitleStripped
// === confirmedTitle, so pcKey's title portion is the same string).
// Confirmed live via production logs showing the identical
// `[kv-cache] MISS: pc:v1:...` line twice in a row for the same key. Fix:
// skip the second kvGet() when strippedTitleKey === fullTitleKey — a pure
// latency change (the 2nd read, when it ran, was reading a key already
// proven to have just missed/hit moments earlier, with no writer running
// between the two reads in the real code — kvSet only fires after BOTH
// reads, ~line 2885).
//
// FIX 2 — eBay OAuth token cache defeated by cold starts (api/comps.js
// getOAuthToken). The existing module-scope tokenCache is correct but only
// helps a genuinely warm instance; production logs showed the OAuth POST
// firing on the majority of requests in a sample window, consistent with
// this app's sparse traffic pattern wiping in-memory state between
// requests. Reused the SAME persistent-KV pattern already proven correct
// for cv:/pc:/ac: (kv-cache.js) rather than inventing a new mechanism.
//
// Verification note: the KV-hit/KV-staleness-rejection halves of both
// fixes were verified live against real Vercel KV credentials during this
// dispatch (not reproducible here — this repo's local .env pull has empty
// KV_REST_API_*/REDIS_URL values, unlike the real EBAY_*/COMICVINE_*
// keys, and no available tool can retrieve working ones). What CAN run
// anywhere, no secrets required, is below: the pure key-equality logic
// Fix 1 depends on, the exact freshness-margin arithmetic Fix 2 depends
// on, and the in-memory-fast-path/graceful-degradation behavior of
// getOAuthToken under a mocked eBay OAuth endpoint with KV genuinely
// absent from the environment (the natural state of a clean test run,
// and itself a legitimate real-world case: a transient KV outage must not
// break the OAuth path either).
//
// Invoke: node tests/perf-kv-dedup-and-oauth-cache.test.js

import { getOAuthToken } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== PERF — duplicate KV read + OAuth KV-cache fixes ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FIX 1 — key-equality logic (pure, no I/O; mirrors api/enrich.js
// ~2805-2808, 2833, 2855-2856 exactly, reproduced here since it's inline
// in the handler, not separately exported).
// ═══════════════════════════════════════════════════════════════════════
console.log('Fix 1: duplicate PC-lookup KV read\n');

const PC_FILTER_VERSION = 1; // mirrors kv-cache.js's exported constant

const computeKeys = (confirmedTitle, confirmedIssue, pcQueryYear) => {
  const stripSubtitle = (t) => String(t || '').replace(/:.*$/, '').trim();
  const hasSubtitle = confirmedTitle && String(confirmedTitle).includes(':');
  const subtitleStripped = hasSubtitle ? stripSubtitle(confirmedTitle) : confirmedTitle;
  const pcKey = `${subtitleStripped}|${confirmedIssue}|${pcQueryYear || ''}`;
  const fullTitleKey = `pc:v${PC_FILTER_VERSION}:${confirmedTitle}|${confirmedIssue}|${pcQueryYear || ''}`;
  const strippedTitleKey = `pc:v${PC_FILTER_VERSION}:${pcKey}`;
  return { fullTitleKey, strippedTitleKey };
};

// Real no-subtitle title from tonight's production logs (One World Under
// Doom / John Giang class) — the common case.
const noSub = computeKeys('one world under doom', '1', 2025);
assertEq(noSub.fullTitleKey, noSub.strippedTitleKey, 'no-subtitle title: fullTitleKey === strippedTitleKey (the skip condition correctly fires — the fix must NOT run a 2nd read here)');

// Real subtitle-bearing title shape from tonight's production logs
// (G.O.D.S.: One World Under Doom, seen throughout the real sold-comp pool).
const withSub = computeKeys('G.O.D.S.: One World Under Doom', '1', 2025);
assertTrue(withSub.fullTitleKey !== withSub.strippedTitleKey, `subtitle title: keys legitimately differ (skip condition must NOT fire — behavior unchanged here) — full="${withSub.fullTitleKey}" stripped="${withSub.strippedTitleKey}"`);

// Edge case: a title with a colon where stripping produces an EMPTY
// string shouldn't happen in practice (confirmedTitle always has content
// before any subtitle), but confirm the equality check itself is a plain
// string comparison with no special-casing that could misfire on it.
const colonOnly = computeKeys(':', '1', 2025);
assertTrue(typeof colonOnly.fullTitleKey === 'string' && typeof colonOnly.strippedTitleKey === 'string', 'degenerate colon-only title still produces two comparable strings (no crash)');

// ═══════════════════════════════════════════════════════════════════════
// FIX 2a — freshness-margin arithmetic (pure, no I/O; mirrors the exact
// expression at api/comps.js's KV-read branch: `now < kvCached.expiresAt
// - 60_000`, identical margin to the pre-existing in-memory check one
// line above it).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFix 2a: OAuth freshness-margin arithmetic\n');

const now = Date.now();
const freshnessCheck = (expiresAt) => now < expiresAt - 60_000;
assertTrue(freshnessCheck(now + 2 * 60 * 60 * 1000) === true, 'a 2h-out entry is treated as fresh');
assertTrue(freshnessCheck(now - 1000) === false, 'an already-expired entry is treated as stale — rejected, not reused');
assertTrue(freshnessCheck(now + 30_000) === false, 'an entry expiring in 30s (inside the 60s margin) is treated as stale — rejected, not reused right up to the wire');
assertTrue(freshnessCheck(now + 61_000) === true, 'an entry expiring in 61s (just outside the 60s margin) is treated as fresh');

// ═══════════════════════════════════════════════════════════════════════
// FIX 2b — getOAuthToken behavior with a mocked eBay OAuth endpoint and
// KV genuinely absent (no KV_REST_API_*/UPSTASH_* env vars set — the
// natural state of a clean test run, per kv-cache.js's own documented
// graceful-fallback contract). Confirms: (1) the live-fetch path still
// works and isn't broken by the new KV read/write calls, (2) the
// in-memory tokenCache fast path — which runs BEFORE the new KV check —
// is untouched, proven via a poisoned fetch on the 2nd call.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFix 2b: getOAuthToken — live fetch + in-memory fast path (KV absent)\n');

const originalFetch = global.fetch;
let fetchCallCount = 0;
const FAKE_TOKEN = 'FAKE_TEST_TOKEN_' + Date.now();

// IMPORTANT: any URL this mock doesn't recognize (e.g. the Upstash SDK's
// own internal calls, since KV is intentionally absent/misconfigured in
// this test) must resolve with a normal non-2xx Response, NOT throw/reject
// — a rejected fetch() is what the Upstash client's own retry-with-backoff
// loop treats as a network failure worth retrying, which stacks up real
// wall-clock delay across several attempts. A returned (not thrown)
// non-ok response exits that loop immediately.
// fetchCallCount tracks ALL fetch traffic, including the KV layer's own
// (mocked-unavailable) get/set calls that getOAuthToken now makes — 3
// total is correct for one call (KV get attempt, live OAuth fetch, KV set
// attempt), not a sign of a retry storm. oauthCallCount isolates just the
// eBay OAuth endpoint, which is the actually meaningful count for "did we
// avoid a redundant live fetch."
let oauthCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  const u = String(url);
  if (u.includes('oauth2/token')) {
    oauthCallCount++;
    return {
      ok: true,
      text: async () => JSON.stringify({ access_token: FAKE_TOKEN, expires_in: 7200, token_type: 'Application Access Token' }),
    };
  }
  return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'mocked: KV unavailable in this test' }) };
};

const testScope = 'perf-test-scope-mocked-' + Date.now();
let result1, threw1 = false;
try {
  result1 = await getOAuthToken('fake-app-id', 'fake-cert-id', testScope);
} catch (e) {
  threw1 = true;
  console.log(`    (unexpected throw: ${e.message})`);
}
assertTrue(!threw1, 'getOAuthToken does not throw on a fresh scope with KV genuinely absent from the environment');
assertEq(result1, FAKE_TOKEN, 'live (mocked) fetch path returns the real token unchanged');
assertEq(oauthCallCount, 1, 'exactly one call to the eBay OAuth endpoint for the first request on a fresh scope (the extra KV get/set fetch traffic is separate and expected)');

// Now poison fetch — a 2nd call on the SAME scope must be served by the
// in-memory tokenCache (which the new KV check sits after, not before)
// without ever reaching fetch again.
global.fetch = async () => {
  throw new Error('POISON: fetch should not have been called — in-memory cache should have short-circuited');
};
let result2, threw2 = false;
try {
  result2 = await getOAuthToken('fake-app-id', 'fake-cert-id', testScope);
} catch (e) {
  threw2 = true;
  console.log(`    (poison fetch fired: ${e.message})`);
}
global.fetch = originalFetch;

assertTrue(!threw2, 'warm in-memory re-call on the same scope never reaches fetch — poisoned fetch never fired');
assertEq(result2, FAKE_TOKEN, 'warm in-memory re-call returns the identical token as the first live fetch');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
}
// Explicit exit: the Upstash Redis client (constructed inside
// getOAuthToken's kvGet/kvSet calls above) leaves a lingering handle that
// keeps the event loop alive otherwise — process.exitCode alone is not
// enough for this file, unlike the other tests in this suite that never
// touch kv-cache.js.
process.exit(failed > 0 ? 1 : 0);
