// tests/c3-avengers4-handler-smoke.test.js
//
// C3 targeted correction - REAL api/enrich.js handler, stubbed network, Avengers #4 (2023) Alex Ross
// Connecting Virgin variant (COLOR). Reproduces the Production failure shape:
//   * PriceCharting matched the 1964 Avengers #4 (a different book) -> the pc-anchor-gate rejects it, but the
//     year reconciliation had already recorded 1964 as a disagreeing 'catalog' source -> YEAR_CONTESTED (R5)
//   * the comp pool mixes the COLOR virgin ($8.99) with B&W/sketch virgin and trade-dress listings (R4)
//   * the model's advisory assetTypeConfident:false is lifted by the server's Q32 comic-category consensus (R6)
// Per the Handler-Wiring Verification protocol (GK-138) this proves the wiring, not only the library units.
//
// Invoke: node tests/c3-avengers4-handler-smoke.test.js

import './helpers/spendGuardTestSetup.js';
delete process.env.ACCESS_CODE;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { issueToken: __issueToken } = await import('../src/modules/auth/token.js');
const __testToken = __issueToken({ principalId: 'c3-test-principal' }).token;
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

const buildEbayItem = (title, price, idx, prefix) => ({
  itemId: `v1|${prefix}${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: `seller${idx}`, feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New',
  conditionId: '1000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`,
  adultOnly: false,
  itemOriginDate: '2025-05-19T20:04:03.000Z',
  itemCreationDate: '2025-05-19T20:04:03.000Z',
  listingMarketplaceId: 'EBAY_US',
});

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  PASS ${label}`); }
  else { failed++; const msg = `  FAIL ${label}`; failures.push(msg); console.log(msg); }
};

const POOL = [
  ['Avengers #4 2023 Alex Ross Virgin Variant Color Cover NM', 8.99],
  ['Avengers #4 2023 Alex Ross 1:25 Black and White Sketch Virgin Variant NM', 41],
  ['Avengers #4 (2023) Alex Ross B&W Virgin Sketch Variant', 38],
  ['Avengers #4 2023 Alex Ross Connecting Trade Dress Cover Variant NM', 12],
  ['Avengers #4 (2023) Marvel Cover A NM', 4.5],
];

async function main() {
  const ITEMS = POOL.map(([t, p], i) => buildEbayItem(t, p, i, '9001'));
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: ITEMS, total: ITEMS.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: ITEMS, total: ITEMS.length });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com/api/products')) {
      return jsonResponse({ products: [{ id: '1640004', 'product-name': 'Avengers #4 (1964)', console_name: 'Marvel Comics', 'loose-price': 450 }] });
    }
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };
  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handler = (await import('../api/enrich.js')).default;
  const req = {
    method: 'POST', headers: { authorization: `Bearer ${__testToken}` },
    body: {
      title: 'Avengers', issue: '4', grade: 'NM', confidence: 'medium', isGraded: false, numericGrade: null,
      year: null, publisher: 'Marvel', variant: 'Alex Ross Connecting Virgin Variant', keyIssue: null,
      assetType: 'comic', assetTypeConfident: false,
      reason: 'Physical comic held in hand, glare on bag, backing board visible',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null; let capturedBody = null;
  const res = { status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }), setHeader: () => {} };
  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  console.log('\n=== C3 Avengers #4 (2023) Alex Ross Connecting Virgin (COLOR) - real handler ===\n');
  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);
  const b = capturedBody || {};
  const ax = b.variantEditionAxis;
  const summary = {
    title: b.title, confirmedYear: b.confirmedYear, yearAuthority: b.yearAuthority, price: b.price,
    pricingSource: b.pricingSource, assetTypeConfident: b.assetTypeConfident, override: b.assetTypeConfidentOverride,
    listingHardLocked: b.listingHardLocked, pcRejected: !!b.pcMatchRejectedForYearConflict,
    yearConflicts: b.yearReconciliation?.conflicts,
    axis: ax ? { kind: ax.kind, exact: ax.exactCount, nearby: ax.nearbyCount, excluded: ax.excludedCount } : null,
    compPrices: b.rawComps?.prices,
  };
  console.log('  SUMMARY ' + JSON.stringify(summary));
  console.log(capturedLogs.filter((l) => /year-anchor|pc-anchor-gate|reconcile-year|edition-axis|Q32|asset-type/.test(l)).map((l) => '  LOG ' + l.slice(0, 260)).join('\n'));

  // R5 - the rejected 1964 anchor cannot create a year conflict.
  assertTrue(!!b.pcMatchRejectedForYearConflict || capturedLogs.some((l) => l.includes('[year-anchor-gate]')), 'the 1964 PriceCharting anchor was rejected (visible, I13)');
  assertTrue(b.yearAuthority !== 'CONTESTED', `R5: yearAuthority is not CONTESTED by a rejected anchor (actual: ${b.yearAuthority})`);
  assertTrue(!(b.yearReconciliation?.conflicts || []).some((c) => String(c.value) === '1964'), 'R5: 1964 is not recorded as a year conflict');
  assertTrue(String(b.confirmedYear ?? b.year) === '2023', `R5: golden year 2023 (actual: ${b.confirmedYear ?? b.year})`);
  // R4 - exact pool is the colour virgin only.
  assertTrue(!!ax && ax.kind === 'COLOR_VIRGIN', 'R4: target edition is COLOR_VIRGIN and the axis is surfaced on the response');
  assertTrue(!!ax && ax.excludedCount >= 3, 'R4: B&W/sketch + trade-dress listings are excluded from the exact pool');
  assertTrue(!(b.rawComps?.prices || []).some((p) => [41, 38, 12].includes(Number(p))), 'R4: no other-edition price is in the priced pool');

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) { failures.forEach((f) => console.log(f)); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
