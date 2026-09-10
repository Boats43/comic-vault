// tests/gk184-cache-provenance-integration.test.js
//
// GK-184 — TRUE MARKET-EVIDENCE RETRIEVAL TIME.
//
// Proves P1-P4 and N2 against the REAL kv-cache.js contract (kvGet/kvSet's
// exact async signature) plus the REAL src/lib/evidenceObservedAt.js
// helpers — the only thing substituted is the storage medium itself,
// because this repo's local environment has no live Upstash credentials
// (confirmed absent — same documented constraint as
// tests/perf-kv-dedup-and-oauth-cache.test.js, whose own header explains
// why cv:/pc:/ac:/bc:/ph: hit-behavior can't be proven against the real
// remote store from this environment). The substitute store below
// round-trips every value through real JSON.stringify/JSON.parse (the
// same serialization boundary Upstash's REST client crosses), so it
// exercises the exact byte-representation risk this dispatch cares about
// (P6's integration-level twin), not just object-identity retention.
//
// Each block below is a byte-for-byte MIRROR of the real call-site control
// flow this dispatch edited (api/enrich.js's cv:/pc:/ac: sites,
// api/comps.js's bc: site, api/pricecharting-pop.js's fetchPCProductHtml)
// — verified against the real, currently-committed source at the line
// ranges cited in each block's own comment. If a future edit to any of
// those real call sites changes this control flow, this mirror must be
// re-verified against the new source (same discipline the pre-existing
// perf test already documents for its own Fix 1 mirror).
//
// Invoke: node tests/gk184-cache-provenance-integration.test.js

import {
  captureEvidenceObservedAt,
  stampEvidenceObservedAt,
} from '../src/lib/evidenceObservedAt.js';

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

console.log('\n=== GK-184 — cache-provenance integration (P1-P4, N2) ===\n');

// ─────────────────────────────────────────────────────────────────────
// Real-shaped fake store: same async get/set contract as api/kv-cache.js
// exports (kvGet(key) -> value|null, kvSet(key, value, ttl) -> void),
// with a REAL JSON round trip on every write (matching what the Upstash
// REST client actually does over the wire) so a shape bug would surface
// here exactly as it would against the real store.
// ─────────────────────────────────────────────────────────────────────
const makeFakeKvStore = () => {
  const store = new Map();
  return {
    kvGet: async (key) => {
      const raw = store.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    kvSet: async (key, value, _ttlSeconds) => {
      store.set(key, JSON.stringify(value));
    },
    _rawSize: () => store.size,
  };
};

// ═══════════════════════════════════════════════════════════════════════
// Mirror A — object-envelope cache MECHANICS (read-cache/on-MISS-fetch/
// write-cache) are identical across cv:/pc:/ac:/bc:, and that shared
// mechanic is what this mirror actually exercises. The STAMP STEP shown
// below is verified accurate for cv:/pc: only (api/enrich.js's cv: site,
// lines ~4173-4185 post-GK-184: stamp happens at the call site, right
// after the single lookupX() resolves).
//
// CORRECTION (2026-09-09, GK-184 closure dispatch): ac:/bc: are NOT an
// exact match to this shape for the stamp step specifically. Both are
// backed by fetchComps() (api/comps.js), which runs an internal
// multi-attempt query LADDER (sequential real eBay fetches, discarding
// every attempt before the one whose post-filter survivors are
// non-empty). fetchComps() now stamps evidenceObservedAt INTERNALLY, at
// the exact moment the WINNING attempt's own raw response arrived --
// before any filtering runs on it -- and the ac:/bc: call sites
// (api/enrich.js's active-comps section, api/comps.js's own handler)
// were corrected to NOT re-stamp afterward, since doing so would
// silently overwrite that precise value with a later one. See
// tests/gk184-comps-ladder-timestamp.test.js for the dedicated real-
// function proof of that internal threading -- this generic mirror
// below (demonstrated once with a `cv:` key) still correctly proves the
// shared cache-hit/miss MECHANICS for all four namespaces; it does not
// claim to model ac:/bc:'s own stamp-placement internals.
//
//   const cached = await kvGet(kvKey);
//   if (cached) return cached;
//   const result = await lookupX(...);
//   if (result) stampEvidenceObservedAt(result, captureEvidenceObservedAt());
//   await kvSet(kvKey, result, ttl);
//   return result;
// ═══════════════════════════════════════════════════════════════════════
console.log('Mirror A — object-envelope provider evidence (cv:/pc:/ac:/bc: shape)\n');

const mirrorObjectFetchCycle = async ({ kvGet, kvSet, key, ttl, fetchFn, nowFn, fetchSpy }) => {
  const cached = await kvGet(key);
  if (cached) return cached;
  const result = await fetchFn();
  if (fetchSpy) fetchSpy();
  if (result) stampEvidenceObservedAt(result, captureEvidenceObservedAt(nowFn));
  await kvSet(key, result, ttl);
  return result;
};

{
  const { kvGet, kvSet } = makeFakeKvStore();
  const KEY = 'cv:v2:amazing spider-man|1|marvel|1963|null';
  let networkFetchCount = 0;

  // ── P1 — fresh fetch at T1 ──
  const T1 = '2026-09-03T10:00:00.000Z';
  const r1 = await mirrorObjectFetchCycle({
    kvGet, kvSet, key: KEY, ttl: 86400,
    fetchFn: async () => ({ productName: 'Amazing Spider-Man #1', price: 4037.25 }),
    nowFn: () => new Date(T1),
    fetchSpy: () => { networkFetchCount++; },
  });
  assertEq(r1.evidenceObservedAt, T1, 'GK184-P1: fresh network fetch stamps result.evidenceObservedAt = T1');
  assertEq(networkFetchCount, 1, 'GK184-P1: exactly one real fetch happened for the fresh call');

  // ── P2 — cache hit at T2, must still read back T1 ──
  const T2 = '2026-09-05T10:00:00.000Z'; // two days later
  const r2 = await mirrorObjectFetchCycle({
    kvGet, kvSet, key: KEY, ttl: 86400,
    fetchFn: async () => { throw new Error('POISON: fetchFn must not be called on a cache HIT'); },
    nowFn: () => new Date(T2),
    fetchSpy: () => { networkFetchCount++; },
  });
  assertEq(r2.evidenceObservedAt, T1, 'GK184-P2: cache HIT at T2 returns the ORIGINAL T1, not T2');
  assertEq(networkFetchCount, 1, 'GK184-N2: no new network fetch occurred on the cache hit (poison fetchFn never fired, count unchanged)');

  // ── P3 — repeated cache hits at T3, T4 ──
  const T3 = '2026-09-06T00:00:00.000Z';
  const T4 = '2026-09-07T00:00:00.000Z';
  const r3 = await mirrorObjectFetchCycle({ kvGet, kvSet, key: KEY, ttl: 86400, fetchFn: async () => { throw new Error('POISON'); }, nowFn: () => new Date(T3) });
  const r4 = await mirrorObjectFetchCycle({ kvGet, kvSet, key: KEY, ttl: 86400, fetchFn: async () => { throw new Error('POISON'); }, nowFn: () => new Date(T4) });
  assertEq(r3.evidenceObservedAt, T1, 'GK184-P3: 2nd repeated cache hit (T3) still returns T1');
  assertEq(r4.evidenceObservedAt, T1, 'GK184-P3: 3rd repeated cache hit (T4) still returns T1');

  // ── P4 — refresh: simulate TTL expiry (real Redis eviction removes the
  // key entirely; the real kv-cache.js has no explicit "expire" API to
  // call from a test, so a brand-new empty store is the faithful
  // equivalent of "the TTL elapsed and the key is gone") ──
  const { kvGet: kvGetAfterExpiry, kvSet: kvSetAfterExpiry } = makeFakeKvStore();
  const TREFRESH = '2026-09-10T12:00:00.000Z';
  let refreshFetchCount = 0;
  const r5 = await mirrorObjectFetchCycle({
    kvGet: kvGetAfterExpiry, kvSet: kvSetAfterExpiry, key: KEY, ttl: 86400,
    fetchFn: async () => ({ productName: 'Amazing Spider-Man #1', price: 4200.00 }),
    nowFn: () => new Date(TREFRESH),
    fetchSpy: () => { refreshFetchCount++; },
  });
  assertEq(r5.evidenceObservedAt, TREFRESH, 'GK184-P4: post-expiry refresh fetch stamps the NEW retrieval instant, not the old T1');
  assertTrue(r5.evidenceObservedAt !== T1, 'GK184-P4: refreshed evidenceObservedAt is provably different from the original fetch');
  assertEq(refreshFetchCount, 1, 'GK184-P4: exactly one real fetch happened for the refresh');
}

// ═══════════════════════════════════════════════════════════════════════
// Mirror B — string-to-envelope cache (ph: shape, verified against
// api/pricecharting-pop.js's fetchPCProductHtml post-GK-184):
//
//   const cached = await kvGet(key);
//   if (cached) {
//     if (typeof cached === 'string') return { html: cached, evidenceObservedAt: null };
//     return cached;
//   }
//   const html = await fetch(...).then(r => r.text());
//   const entry = { html, evidenceObservedAt: captureEvidenceObservedAt() };
//   await kvSet(key, entry, ttl);
//   return entry;
// ═══════════════════════════════════════════════════════════════════════
console.log('\nMirror B — string-to-envelope provider evidence (ph: shape)\n');

const mirrorHtmlFetchCycle = async ({ kvGet, kvSet, key, ttl, fetchHtmlFn, nowFn, fetchSpy }) => {
  const cached = await kvGet(key);
  if (cached) {
    if (typeof cached === 'string') return { html: cached, evidenceObservedAt: null };
    return cached;
  }
  const html = await fetchHtmlFn();
  if (fetchSpy) fetchSpy();
  const entry = { html, evidenceObservedAt: captureEvidenceObservedAt(nowFn) };
  await kvSet(key, entry, ttl);
  return entry;
};

{
  const { kvGet, kvSet } = makeFakeKvStore();
  const KEY = 'ph:2314818';
  let fetchCount = 0;

  const T1 = '2026-09-03T08:00:00.000Z';
  const r1 = await mirrorHtmlFetchCycle({
    kvGet, kvSet, key: KEY, ttl: 604800,
    fetchHtmlFn: async () => '<html>VGPC.pop_data = {"cgc":[1,2,3]};</html>',
    nowFn: () => new Date(T1),
    fetchSpy: () => { fetchCount++; },
  });
  assertEq(r1.evidenceObservedAt, T1, 'GK184-P1 (ph:): fresh HTML fetch stamps evidenceObservedAt = T1');
  assertTrue(r1.html.includes('pop_data'), 'GK184-P1 (ph:): the html field itself is intact');

  const T2 = '2026-09-04T08:00:00.000Z';
  const r2 = await mirrorHtmlFetchCycle({
    kvGet, kvSet, key: KEY, ttl: 604800,
    fetchHtmlFn: async () => { throw new Error('POISON'); },
    nowFn: () => new Date(T2),
    fetchSpy: () => { fetchCount++; },
  });
  assertEq(r2.evidenceObservedAt, T1, 'GK184-P2 (ph:): cache HIT returns original T1, not T2');
  assertEq(r2.html, r1.html, 'GK184-P2 (ph:): cached HTML content itself round-trips unchanged');
  assertEq(fetchCount, 1, 'GK184-N2 (ph:): no new fetch on the cache hit');

  // Legacy shape: a bare string was written under the OLD (pre-GK-184)
  // contract. Confirms Section 5's compatibility ruling: read back as
  // evidenceObservedAt = null (UNKNOWN), never fabricated.
  const legacyStore = makeFakeKvStore();
  await legacyStore.kvSet(KEY, '<html>legacy raw string entry</html>', 604800);
  const legacyRead = await mirrorHtmlFetchCycle({
    kvGet: legacyStore.kvGet, kvSet: legacyStore.kvSet, key: KEY, ttl: 604800,
    fetchHtmlFn: async () => { throw new Error('POISON: legacy hit must not re-fetch'); },
  });
  assertEq(legacyRead.evidenceObservedAt, null, 'GK-184 Section 5: a legacy pre-dispatch bare-string cache entry reads back as evidenceObservedAt=null (UNKNOWN), never now()');
  assertTrue(legacyRead.html.includes('legacy raw string entry'), 'legacy HTML content is still served correctly despite the shape migration');
}

// ═══════════════════════════════════════════════════════════════════════
// GK184-N2 (explicit, direct) — a poisoned capture spy on the read path
// itself: the mirror's cache-HIT branch must never call
// captureEvidenceObservedAt at all, proven by counting invocations, not
// merely inferring it from the value happening to match.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nN2 (direct) — cache-hit branch never invokes captureEvidenceObservedAt\n');

{
  const { kvGet, kvSet } = makeFakeKvStore();
  const KEY = 'ac:v9:amazing spider-man|1|deadbeef';
  let captureCallCount = 0;
  const countingNowFn = () => { captureCallCount++; return new Date('2026-09-03T00:00:00.000Z'); };

  await mirrorObjectFetchCycle({
    kvGet, kvSet, key: KEY, ttl: 3600,
    fetchFn: async () => ({ count: 5, prices: [10, 20, 30] }),
    nowFn: countingNowFn,
  });
  assertEq(captureCallCount, 1, 'exactly one capture on the fresh fetch');

  await mirrorObjectFetchCycle({ kvGet, kvSet, key: KEY, ttl: 3600, fetchFn: async () => { throw new Error('POISON'); }, nowFn: countingNowFn });
  await mirrorObjectFetchCycle({ kvGet, kvSet, key: KEY, ttl: 3600, fetchFn: async () => { throw new Error('POISON'); }, nowFn: countingNowFn });
  assertEq(captureCallCount, 1, 'GK184-N2: after 2 more cache hits, capture count is STILL 1 — the read path never calls captureEvidenceObservedAt');
}

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
