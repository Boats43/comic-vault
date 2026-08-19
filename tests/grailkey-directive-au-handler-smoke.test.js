// tests/grailkey-directive-au-handler-smoke.test.js
//
// GrailKey Directive AU fix-forward, GK-138 — mandatory handler-level
// smoke invocation. The GK-136/GK-137 library functions were never
// broken; the wiring into api/enrich.js's handler was (a real production
// 500, ReferenceError: variantSourceItems is not defined, build 1d23069,
// confirmed on two live requests 2026-08-19 01:06/01:08). Library-function
// unit tests (grailkey-directive-au-dellotto-1963.test.js) cannot catch a
// lexical-scope wiring bug — only invoking the real handler can. This file
// is the standing artifact GK-138 requires: any dispatch that edits
// api/enrich.js wiring ships with at least one real-handler smoke
// invocation.
//
// Reproduces the real ghmn7 pool verbatim (captured from production
// runtime logs) via a global fetch stub — deterministic, no live network
// calls, no risk of writing to the real production KV cache (UPSTASH env
// vars deliberately left unset here so kv-cache.js's own documented
// graceful-degradation path handles every kvGet/kvSet as a no-op MISS,
// exactly as it does in production when Upstash is unreachable).
//
// Invoke: node tests/grailkey-directive-au-handler-smoke.test.js

// ACCESS_CODE deliberately left unset — checkAccessGate (api/enrich.js)
// returns null (gate disabled) when the env var isn't set, so no
// x-vault-key header is needed.
delete process.env.ACCESS_CODE;
// KV deliberately left unset — see file header.
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

// ── Real ghmn7 pool, verbatim from production runtime logs ─────────────
const REAL_POOL_TITLES = [
  ["THE AMAZING SPIDERMAN #1 DEL O'TT  VARIANT VIRGIN COVER COMIC KINGDON CANADA BB4", 14.00],
  ["Amazing Spider-Man #1 Dellotto Virgin Art Variant Marvel Comic Book NM 2022", 29.99],
  ["AMAZING SPIDERMAN 1 GABRIELLE DELL OTTO VIRGIN VARIANT NM EXCLUSIVE vol 6 2022", 35.00],
  ["SPIDER-MAN #1 THE AMAZING MARVEL 616 & BTC COMICS EXCLUSIVE VIRGIN COVER NM+", 20.00],
  ["AMAZING SPIDERMAN 1 GABRIELLE DELL OTTO VIRGIN VARIANT NM EXCLUSIVE vol 6 2022", 35.00],
  ["The Amazing Spider-Man #8  1:100 ratio Virgin Gabriele Dell'Otto cover NM", 250.00],
  ["Spider-Man #5 Vol 3 Unknown Comics Gabriele Del'Otto Virgin Variant 2023 UNREAD", 40.00],
  ["AMAZING SPIDERMAN 798 GABRIELLE DELL OTTO COMICXPOSURE VIRGIN VARIANT NM", 45.00],
  ["AMAZING SPIDER-MAN #8 9.4 NM 2025 1:100 GABRIELE DELL'OTTO VIRGIN VARIANT MARVEL", 71.96],
  ["BLOOD HUNT #5 (Marvel 2024) 1:100 Gabriele Dell'Otto virgin, Gemini mailer, NM", 60.00],
  ["Amazing Spider Man #1 (2022) Lucio Parrillo Virgin Variant NM", 25.00],
  ["Amazing Spider-Man #45 Dell'Otto Virgin Variant Exclusive ASM 2020", 30.00],
  ["Amazing Spider-Man #8B Virgin Marvel 2025 1:100 Incentive Gabriele Dell'Otto", 65.00],
  ["Spider-Man #5 Unknown Comics Dell'Otto Exclusive Var (02/15/2023)", 38.00],
  ["BLOOD HUNT #5 | GABRIELLE DELL’OTTO 1:100 VIRGIN VARIANT: SPIDER-MAN", 55.00],
  ["Spider-Man #5 Vol 3 Unknown Comics Gabriele Del'Otto Virgin Variant 2023 UNREAD", 40.00],
  ["Amazing Spiderman #7 Lucio Parrillo Virgin Cover Debute of Oscorp Spiderman Suit", 12.00],
  ["AMAZING SPIDER-MAN #7 LUCIO PARRILLO EXCLUSIVE VIRGIN 2022 MARVEL CHECK PHOTOS", 9.99],
  ["Marvel Comics Amazing Spider-Man #46 Dell'Otto Unknown Comics Virgin Edition", 29.99],
  ["Amazing Spider-Man #48 Dell'Otto VIRGIN Variant Cover ASM 2020", 27.00],
];

const buildEbayItem = (title, price, idx) => ({
  itemId: `v1|30000000000${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C30000000000${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New',
  conditionId: '1000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/30000000000${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `30000000000${idx}`,
  adultOnly: false,
  itemOriginDate: '2024-08-16T18:07:04.000Z',
  itemCreationDate: '2024-08-16T18:07:04.000Z',
  listingMarketplaceId: 'EBAY_US',
});

const EBAY_IMAGE_SEARCH_ITEMS = REAL_POOL_TITLES.map(([t, p], i) => buildEbayItem(t, p, i));

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const originalFetch = global.fetch;
let fetchLog = [];

global.fetch = async (url, opts) => {
  const u = String(url);
  fetchLog.push(u.slice(0, 120));

  // eBay OAuth token (any host/path shape) — used by lookupEbayVisual.
  if (u.includes('oauth2/token') || u.includes('/oauth/')) {
    return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
  }
  // eBay image search — the pool that drives everything downstream.
  if (u.includes('search_by_image')) {
    return jsonResponse({ itemSummaries: EBAY_IMAGE_SEARCH_ITEMS, total: EBAY_IMAGE_SEARCH_ITEMS.length });
  }
  // eBay regular text search (comps fetch) — reuse the same pool, format-compatible.
  if (u.includes('item_summary/search')) {
    return jsonResponse({ itemSummaries: EBAY_IMAGE_SEARCH_ITEMS, total: EBAY_IMAGE_SEARCH_ITEMS.length });
  }
  // ComicVine — no match, gracefully caught by the caller's own .catch(() => null).
  if (u.includes('comicvine.gamespot.com')) {
    return jsonResponse({ results: [], status_code: 1, error: 'OK' });
  }
  // PriceCharting product search — the real matched product, verbatim id/name.
  if (u.includes('pricecharting.com/api/products')) {
    return jsonResponse({
      products: [
        { id: '2314818', 'product-name': 'Amazing Spider-Man #1 (1963)', 'loose-price': 403725 },
      ],
    });
  }
  // PriceCharting single-product / pop / sales scrape endpoints — already
  // wrapped in .catch(() => null) at every call site (verified during the
  // AU trace); a 404 degrades gracefully, no need to replicate scrape HTML.
  if (u.includes('pricecharting.com')) {
    return jsonResponse({ error: 'not found' }, 404);
  }
  // Anthropic (claude-check) — real trace shows this scan hits zero
  // CRITICAL conflicts and skips the AI call deterministically; this stub
  // exists only as a safety net in case that ever changes.
  if (u.includes('api.anthropic.com')) {
    return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
  }
  // Anything else: benign empty-ish JSON rather than a hard network error,
  // so an unanticipated call degrades instead of throwing.
  return jsonResponse({});
};

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

const capturedLogs = [];
const originalConsoleLog = console.log;
console.log = (...args) => {
  capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  originalConsoleLog(...args);
};

async function main() {
  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;

  const req = {
    method: 'POST',
    headers: {},
    body: {
      title: 'Amazing Spider-Man',
      issue: null,
      grade: 'NM 9.4',
      confidence: 'medium',
      isGraded: false,
      numericGrade: null,
      year: null,
      publisher: 'Marvel Comics',
      variant: 'Gabriele Dell’Otto virgin variant',
      keyIssue: null,
      reason: 'Amazing Spider-Man virgin variant cover',
      // A 1x1 PNG data URI — real bytes are never inspected once the
      // eBay image-search fetch itself is stubbed above. images[] is the
      // real request field; visualBase64 is derived internally from
      // images[0] (api/enrich.js:2541-2545) — using the wrong field name
      // here silently produced 0 image-search results in an earlier run.
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };

  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({
      json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; },
    }),
    setHeader: () => {},
  };

  console.log('\n=== GK-138 handler-level smoke invocation, ghmn7-shaped pool ===\n');

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }

  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (threw: ${threw ? threw.message : 'none'})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged anywhere in the handler run');
  assertTrue(!capturedLogs.some((l) => l.includes('variantSourceItems is not defined')), 'the specific GK-136 wiring bug does not reproduce');
  assertTrue(capturedStatus === 200, `HTTP status is 200 (actual: ${capturedStatus})`);

  const reconcileVariantLine = capturedLogs.find((l) => l.startsWith('[reconcile-variant]'));
  assertTrue(!!reconcileVariantLine, '[reconcile-variant] line was emitted');
  if (reconcileVariantLine) {
    console.log('  ' + reconcileVariantLine);
    assertTrue(!reconcileVariantLine.includes('value=null'), 'reconciled value is not null');
    assertTrue(reconcileVariantLine.includes("source=first-eligible-visual") || reconcileVariantLine.includes('source=vision'),
      'source is first-eligible-visual (physical evidence won) or vision (fallback)');
    const hasPoolRowEvidence = reconcileVariantLine.includes('ebay-pool-row-');
    assertTrue(hasPoolRowEvidence, 'third-entry-path evidence (ebay-pool-row-N source) appears in justifiedBy/conflicts — GK-136 4a-ii is live in the real handler, not just the library');
  }

  if (capturedBody) {
    console.log(`  response price/decision: price=${capturedBody.price} decision=${capturedBody.decision?.action} variant=${capturedBody.variant || capturedBody.confirmedVariant}`);
  }
  console.log(`  fetch calls made: ${fetchLog.length} (${[...new Set(fetchLog.map(u => u.split('?')[0].split('/').slice(0,5).join('/')))].join(', ')})`);

  global.fetch = originalFetch;

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.log = originalConsoleLog;
  console.error('FATAL:', err);
  process.exit(1);
});
