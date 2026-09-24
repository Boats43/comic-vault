// tests/gk250-book-enrich-handler-smoke.test.js
//
// GK-250 (U6.0C), Section F — real end-to-end proof that a Book-shaped
// payload reaches /api/enrich's real handler and gets REFUSED by the new
// economic allowlist gate BEFORE any comps/pricing work executes. Per the
// standing Handler-Wiring Verification protocol (GK-138) and this
// dispatch's own explicit standing rule ("A safety-state test must PRODUCE
// the state through the real code path... hand-constructing the expected
// safety shape does not prove that the pipeline actually reaches it"), this
// file imports the real api/enrich.js default export and drives a real
// request through it -- refusedToPrice/contract.state are never set
// directly in the fixture; only the real handler can produce them here.
//
// Same fetch-mocking convention as tests/gk152-handler-smoke.test.js.
//
// Invoke: node tests/gk250-book-enrich-handler-smoke.test.js

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertFalse = (cond, label) => assertTrue(!cond, label);
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

const buildEbayItem = (title, price, idx, prefix, categoryId = '259104', categoryName = 'Comics & Graphic Novels') => ({
  itemId: `v1|${prefix}${idx}|0`,
  title,
  leafCategoryIds: [categoryId],
  categories: [{ categoryId, categoryName }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New',
  conditionId: '1000',
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

// Real-shaped eBay pool -- book-category listings, none carrying a comic
// issue-number signal, mirroring the actual Rationalists production log
// evidence traced earlier in this dispatch chain ("Philosophy book plus
// coraline bundle", "...Paperback...").
const BOOK_POOL = [
  ['The Rationalists Philosophy Book Paperback', 12.99],
  ['The Rationalists by Test Author Paperback Good Condition', 9.5],
  ['Philosophy book plus coraline bundle', 4.9],
];

async function runOnce({ label, requestBody, expectFetchComps, expectPriceCharting }) {
  console.log(`\n=== ${label} ===\n`);

  const BOOK_ITEMS = BOOK_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '9900000000', '267', 'Books & Magazines'));
  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 200));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) {
      return jsonResponse({ itemSummaries: BOOK_ITEMS, total: BOOK_ITEMS.length });
    }
    if (u.includes('item_summary/search')) {
      return jsonResponse({ itemSummaries: BOOK_ITEMS, total: BOOK_ITEMS.length });
    }
    if (u.includes('comicvine.gamespot.com')) {
      return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    }
    if (u.includes('pricecharting.com')) {
      return jsonResponse({ products: [] });
    }
    if (u.includes('api.anthropic.com')) {
      return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    }
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  const handlerModule = await import('../api/enrich.js?t=' + label.replace(/\s+/g, '_'));
  const handler = handlerModule.default;
  const req = { method: 'POST', headers: {}, body: requestBody };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  const allowlistLine = capturedLogs.find((l) => l.startsWith('[economic-allowlist]'));
  assertTrue(!!allowlistLine, `[economic-allowlist] fires — the new gate genuinely ran inside the real handler (${allowlistLine || 'NOT FOUND'})`);

  // 1. category routing occurred / identity survives
  assertEq(capturedBody?.assetType, requestBody.assetType, 'out.assetType matches the request (category routing occurred)');
  assertTrue(!!capturedBody?.title, `identity survives — out.title is present (${JSON.stringify(capturedBody?.title)})`);

  // 2-4. economic authorization gate executes, REFUSED produced by the pipeline
  assertTrue(capturedBody?.refusedToPrice === true, 'out.refusedToPrice === true, produced by the real handler');
  assertEq(capturedBody?.pricingSource, 'refused-category-pricing-not-authorized', 'out.pricingSource is the new honest, category-neutral refusal reason');
  assertEq(capturedBody?.contract?.state, 'REFUSED', 'contract.state === "REFUSED" (assembled by the real responseContract.js from out.refusedToPrice)');

  // 5-7. refusal before comps/pricing; price/bands remain null
  assertEq(capturedBody?.price, null, 'automated out.price remains null');
  assertEq(capturedBody?.contract?.price, null, 'contract.price remains null');
  assertEq(capturedBody?.contract?.bands, null, 'contract.bands remains null');

  // 8-9. no LIST_NOW/LIST_LOW, listable false
  assertFalse(String(capturedBody?.decision?.action || '').startsWith('LIST'), `decision.action does not start with LIST (actual: ${JSON.stringify(capturedBody?.decision?.action)})`);
  assertEq(capturedBody?.contract?.listable, false, 'contract.listable === false');

  // Whether fetchComps/PriceCharting actually executed -- the real proof
  // that refusal happens BEFORE the economic paths, not merely that the
  // final response hides them. The text-search comps endpoint
  // ("item_summary/search", comps.js's fetchComps) and PriceCharting are
  // both PRICING-ONLY calls; search_by_image (identity phase, runs earlier
  // in the handler regardless of category) is expected and not checked.
  // item_summary/search_by_image (identity phase) is a substring of
  // "item_summary/search" -- exclude it explicitly so this only counts the
  // TEXT-based comps query (comps.js's fetchComps), never the image-search
  // identity call that legitimately runs earlier regardless of category.
  const compsSearchCalls = fetchLog.filter((u) => u.includes('item_summary/search') && !u.includes('search_by_image'));
  const pcCalls = fetchLog.filter((u) => u.includes('pricecharting.com'));
  if (expectFetchComps) {
    assertTrue(compsSearchCalls.length > 0, `fetchComps (item_summary/search) DID execute, as expected for this case (count=${compsSearchCalls.length})`);
  } else {
    assertTrue(compsSearchCalls.length === 0, `fetchComps (item_summary/search) did NOT execute — the allowlist gate genuinely prevented it, not just hid its result (fetchLog sample: ${JSON.stringify(fetchLog.slice(0, 5))})`);
  }
  if (expectPriceCharting) {
    assertTrue(pcCalls.length > 0, `PriceCharting DID execute, as expected for this case (count=${pcCalls.length})`);
  } else {
    assertTrue(pcCalls.length === 0, 'PriceCharting did NOT execute');
  }

  return capturedBody;
}

async function main() {
  console.log('\n=== GK-250 Section F — real end-to-end Book /api/enrich proof ===');

  // ─── Book-shaped payload, real handler execution ───────────────────
  await runOnce({
    label: 'book payload',
    requestBody: {
      title: 'The Rationalists', author: 'Test Author', year: '2020', assetType: 'book',
      grade: 'Very Good', confidence: 'high', isGraded: false, numericGrade: null,
      publisher: 'Test Press', variant: null, keyIssue: null,
      reason: 'A paperback philosophy book, moderate shelf wear.',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
    expectFetchComps: false,
    expectPriceCharting: false,
  });

  // ─── Merchandise-shaped payload, proving the allowlist is category-general ───
  await runOnce({
    label: 'merchandise payload',
    requestBody: {
      title: 'Test Merchandise Item', assetType: 'merchandise',
      grade: null, confidence: 'high', isGraded: false, numericGrade: null,
      publisher: null, variant: null, keyIssue: null, reason: 'A non-comic collectible.',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
    expectFetchComps: false,
    expectPriceCharting: false,
  });

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
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
