// tests/gk184-comps-ladder-timestamp.test.js
//
// GK-184 CORRECTION (2026-09-09) — fetchComps() (api/comps.js) issues a
// query-LADDER of sequential real eBay fetches (most-specific attempt
// first, falling through on empty post-filter survivors). Stamping
// evidenceObservedAt only AFTER the whole function resolves would risk
// attributing the WRONG attempt's retrieval instant to the returned
// pool, or attributing "after synchronous filtering finished" instead
// of "when the winning attempt's raw response arrived" -- processing
// time wearing a retrieval label. This test exercises the REAL
// fetchComps function (not a mirror/reimplementation) with a mocked
// global.fetch that forces a real multi-attempt ladder: attempt 1
// returns zero results (discarded), attempt 2 (with a real, measurable
// delay before it resolves) returns real listings and wins.
//
// Proves: the returned evidenceObservedAt matches attempt 2's own
// resolution instant, not attempt 1's (deliberately much earlier) and
// not some later "after filtering finished" instant either (bounded
// tightly against attempt 2's own resolution time).
//
// Invoke: node tests/gk184-comps-ladder-timestamp.test.js

const OAUTH_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_ENDPOINT = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-184 correction — fetchComps() ladder-timestamp threading (real function, mocked fetch) ===\n');

const browseResolvedAtMs = [];
let browseCallCount = 0;
const attempt1ResolvedAt = { ms: null };
const attempt2ResolvedAt = { ms: null };

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const urlStr = String(url);
  if (urlStr.startsWith(OAUTH_ENDPOINT)) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'fake-token-for-test', expires_in: 7200 }),
    };
  }
  if (urlStr.startsWith(BROWSE_ENDPOINT)) {
    browseCallCount++;
    const thisCall = browseCallCount;
    if (thisCall === 1) {
      // Attempt 1: resolves immediately, empty results -- must be
      // discarded by the ladder and its timing must NOT leak into the
      // final evidenceObservedAt.
      attempt1ResolvedAt.ms = Date.now();
      return { ok: true, status: 200, json: async () => ({ itemSummaries: [] }) };
    }
    // Attempt 2+: a real, measurable delay (150ms) before resolving with
    // real data -- this is the winning attempt. The delay exists purely
    // so attempt1ResolvedAt and attempt2ResolvedAt are unambiguously,
    // non-flakily distinguishable (not relying on sub-millisecond timing).
    await new Promise((resolve) => setTimeout(resolve, 150));
    attempt2ResolvedAt.ms = Date.now();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        itemSummaries: [
          { price: { value: '49.99' }, itemEndDate: '2026-09-01T00:00:00.000Z', title: 'Amazing Spider-Man #1 CGC 9.4', itemWebUrl: 'https://ebay.com/x' },
          { price: { value: '52.00' }, itemEndDate: '2026-09-02T00:00:00.000Z', title: 'Amazing Spider-Man #1 CGC 9.4', itemWebUrl: 'https://ebay.com/y' },
        ],
      }),
    };
  }
  throw new Error(`Unexpected fetch URL in test: ${urlStr}`);
};

try {
  const { fetchComps } = await import('../api/comps.js');

  const beforeCall = Date.now();
  const comps = await fetchComps({
    title: 'Amazing Spider-Man',
    issue: '1',
    grade: 'CGC 9.4',
    isGraded: true,
    numericGrade: 9.4,
    year: null,
    appId: 'test-app-id',
    certId: 'test-cert-id',
  });
  const afterCall = Date.now();

  assertTrue(browseCallCount >= 2, `real multi-attempt ladder actually occurred (browseCallCount=${browseCallCount}, need >= 2 to prove the discard case)`);
  assertTrue(comps && comps.count > 0, `fetchComps returned a non-empty pool (count=${comps?.count})`);
  assertTrue(!!comps.evidenceObservedAt, 'comps.evidenceObservedAt is present on the winning result');

  if (comps.evidenceObservedAt && attempt1ResolvedAt.ms && attempt2ResolvedAt.ms) {
    const stampedMs = new Date(comps.evidenceObservedAt).getTime();

    assertTrue(
      stampedMs > attempt1ResolvedAt.ms + 100,
      `evidenceObservedAt (${comps.evidenceObservedAt}) is well AFTER attempt 1's discarded resolution (+100ms margin) — proves it did not leak attempt 1's time`
    );
    assertTrue(
      Math.abs(stampedMs - attempt2ResolvedAt.ms) < 50,
      `evidenceObservedAt (${stampedMs}) is within 50ms of attempt 2's actual resolution instant (${attempt2ResolvedAt.ms}) — proves it was captured at the true winning-fetch boundary, not "whenever fetchComps finished"`
    );
    assertTrue(
      stampedMs <= afterCall,
      'evidenceObservedAt does not exceed the wall-clock instant fetchComps actually returned (sanity bound)'
    );
    assertTrue(
      stampedMs >= beforeCall,
      'evidenceObservedAt is not before the call even started (sanity bound)'
    );
  } else {
    failed++;
    failures.push('  ✗ could not compare timestamps — one or more capture points never fired');
    console.log('  ✗ could not compare timestamps — one or more capture points never fired');
  }
} finally {
  global.fetch = realFetch;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
// Force exit regardless of any dangling handle from imported modules
// (e.g. api/kv-cache.js's Upstash client) — all real work above is
// already complete by this point.
process.exit(failed > 0 ? 1 : 0);
