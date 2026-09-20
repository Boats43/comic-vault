// tests/gk229-content-unverified-handler-smoke.test.js
//
// GK-229 (2026-09-20) — GK-138 real-handler proof for the api/enrich.js
// wiring change at the `out.contentVerified` assignment (~line 11640).
//
// P1 finding this proof depends on: ComicVine is NOT merely "sometimes
// thin" — it is categorically DISABLED in the current handler.
// `lookupComicVine` (api/enrich.js:648, the sole producer of `out.comicVine`)
// gates on `COMICVINE_ENABLED` (api/enrich.js:587), a hardcoded `false` set
// by commit 9ca0b9a "Dispatch 42: ComicVine safe-kill Tasks 1-5" on
// 2026-08-09 — six+ weeks before this dispatch, independent of
// COMICVINE_API_KEY. The only way `out.comicVine` could be non-null today
// is a KV cache hit from an entry written before that commit; no TTL in
// this codebase is documented anywhere near six weeks, so in practice
// `out.comicVine` is unconditionally null on every fresh scan. Under the
// OLD code (`verifyStory(null)` → `!comicVine?.description` → `false`,
// unconditionally), `content-unverified` fired on effectively EVERY scan,
// 100% of the time — not a "wide net," a structurally always-on condition.
// This smoke test therefore does not need to mock a ComicVine response at
// all: the real handler's real (disabled) ComicVine path is exercised
// as-is, proving the fix end-to-end against the actual current production
// shape, not a hypothetical re-enabled one.
//
// Invoke: node tests/gk229-content-unverified-handler-smoke.test.js

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';
process.env.COMICVINE_API_KEY = process.env.COMICVINE_API_KEY || 'test-cv-key';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
const buildEbayItem = (title, price, idx, prefix) => ({
  itemId: `v1|${prefix}${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Ungraded',
  conditionId: '4000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`,
  adultOnly: false,
  itemOriginDate: '2026-04-06T14:26:54.000Z',
  itemCreationDate: '2026-04-06T14:26:54.000Z',
  listingMarketplaceId: 'EBAY_US',
});

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assertTrue(a === e, `${label} (expected ${e}, actual ${a})`);
};

async function runOne({ label, title, issue, grade, year, publisher }) {
  // Real, clean, identity-confident active comps pool — 5 unanimous rows,
  // clearing priceBands.js's own tier-3 threshold, so a real price is
  // computed and there is something for a wrongful content-unverified
  // LIST_LOW downgrade to actually damage.
  const COMPS_POOL = [
    [`${title} #${issue}`, 28],
    [`${title} #${issue}`, 30],
    [`${title} #${issue}`, 32],
    [`${title} #${issue}`, 34],
    [`${title} #${issue}`, 36],
  ];
  const COMPS_ITEMS = COMPS_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '4900000000'));

  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 160));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: [], total: 0 });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: COMPS_ITEMS, total: COMPS_ITEMS.length });
    // Deliberately NOT mocking a real ComicVine match — see file header:
    // COMICVINE_ENABLED=false means lookupComicVine never issues this
    // fetch at all in the real handler; any response returned here would
    // never actually be consumed. Returning empty results is honest either
    // way (proves the real short-circuit, doesn't fake a match).
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  console.warn = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      title, issue, grade, confidence: 'high',
      isGraded: false, numericGrade: null, year, publisher,
      variant: null, keyIssue: null, reason: `${title} #${issue}`,
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;

  console.log(`\n=== GK-229 handler-level smoke — ${label} ===\n`);
  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  // The real, current-production wiring: ComicVine categorically disabled.
  assertTrue(capturedBody?.comicVine == null, 'out.comicVine is null/undefined — the real, current (COMICVINE_ENABLED=false) production shape, not a hypothetical');
  assertEq(capturedBody?.contentVerified, null, 'SHIP-BLOCKING (GK-229): out.contentVerified is null (unknown), never false, when comicVine is unavailable');
  assertTrue(
    !Array.isArray(capturedBody?.decision?.warnings) || !capturedBody.decision.warnings.includes('content-unverified'),
    'SHIP-BLOCKING (GK-229): decision.warnings does NOT include content-unverified merely because ComicVine metadata is unavailable'
  );
  assertTrue(capturedBody?.decision?.action !== 'LIST_LOW' || !JSON.stringify(capturedBody?.decision?.reason || '').toLowerCase().includes('story'), 'if LIST_LOW fires for any OTHER reason, it is not attributed to story metadata');
  console.log(`  (out.decision.action=${JSON.stringify(capturedBody?.decision?.action)} out.decision.warnings=${JSON.stringify(capturedBody?.decision?.warnings)})`);
  console.log(`  fetch calls made: ${fetchLog.length}`);
}

async function main() {
  await runOne({ label: 'Amazing Spider-Man #91 (FN 6.0, ask path)', title: 'Amazing Spider-Man', issue: '91', grade: 'FN 6.0', year: '1970', publisher: 'Marvel' });
  await runOne({ label: 'New Mutants #98 (VG 4.0, sold path)', title: 'New Mutants', issue: '98', grade: 'VG 4.0', year: '1991', publisher: 'Marvel' });

  console.log(`\n${'='.repeat(60)}\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
