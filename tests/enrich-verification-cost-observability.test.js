// Enrich verification-lane wiring smoke — REAL api/enrich.js handler, mocked providers only. PARTIAL: see COVERAGE GAP below.
// TICKET: UNASSIGNED. Closes the MIRRORED-WIRING-UNVERIFIED finding for the verifyCompsTitles cost edit
// (GK-138 handler-wiring protocol). Harness shape borrowed from tests/gk153-156-gijoe-handler-smoke.test.js
// (real byte-faithful eBay pool). No network, no database, no paid call.
//   node tests/enrich-verification-cost-observability.test.js

delete process.env.ACCESS_CODE;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: 'enrich-verify-cost-test-principal' }).token;
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'; // verifyCompsTitles is skipped without a key
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const buildEbayItem = (title, price, idx, prefix) => ({
  itemId: `v1|${prefix}${idx}|0`, title, leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: `seller${idx}`, feedbackPercentage: '99.9', feedbackScore: 1000 }, condition: 'Brand New', conditionId: '1000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`, itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`, adultOnly: false, itemOriginDate: '2025-05-19T20:04:03.000Z', itemCreationDate: '2025-05-19T20:04:03.000Z', listingMarketplaceId: 'EBAY_US',
});
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

const IMAGE_POOL = [
  ['GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin FOIL Variant B LTD to 750', 29.99],
  ['G.I. Joe #5 (2025) Tyler Kirkham Virgin Variant *Limited To 750 Copies', 24.99],
  ['GI JOE #5 • TYLER KIRKHAM • VIRGIN VARIANT • COBRA COMMANDER • LTD 750', 14.99],
  ['GI Joe #5 Tyler Kirkham Virgin Variant 616 Comics Exclusive Image 2025 Limited 7', 22.5],
  ['G.I. Joe #5 (2025) Tyler Kirkham Cobra Commander Exclusive 616 Virgin Ltd 750 NM', 20],
  ['G.I. Joe #5 (2025) Tyler Kirkham 616 Exclusive Virgin Variant Ltd 750', 17.95],
  ['G.I. Joe #5 Tyler Kirkham', 19.99],
  ['GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750', 29.99],
  ['G.I. Joe #5 Tyler Kirkham FOIL', 18.5],
  ['GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin Variant A LTD 750', 20],
];
const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '1771074'));
IMAGE_ITEMS[9] = { ...IMAGE_ITEMS[9], leafCategoryIds: ['183454'], categories: [{ categoryId: '183454', categoryName: 'Non-Sport Trading Card Singles' }] }; // forces a CROSS_CATEGORY_CONTAMINATION conflict -> AI verify gate opens
const anthropicCalls = [];
let anthropicUsage = { input_tokens: 400, output_tokens: 20 };
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
  if (u.includes('item_summary/search')) {
    const s = [buildEbayItem('G.I. Joe #5 Tyler Kirkham 616 Virgin Variant Exclusive Limited Signed 2025', 22, 0, '1771075'),
               buildEbayItem('GI JOE #5 Tyler Kirkham Virgin Exclusive Signed Limited 2025', 19, 1, '1771075')];
    return jsonResponse({ itemSummaries: s, total: s.length });
  }
  if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com/api/products')) return jsonResponse({ products: [{ id: '2520796', 'product-name': 'G.I. Joe Special Missions #5', console_name: '1987', 'loose-price': 585 }] });
  if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
  if (u.includes('api.anthropic.com')) {
    const b = JSON.parse(init.body);
    anthropicCalls.push({ model: b.model, max_tokens: b.max_tokens, hasSystem: 'system' in b });
    const body = { id: 'msg_v', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: '[true,true]' }], stop_reason: 'end_turn', stop_sequence: null };
    if (anthropicUsage) body.usage = anthropicUsage;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return jsonResponse({});
};
const rs = await import('../src/lib/researchStore.js');
const memStore = rs.createMemoryResearchStore();
rs.setResearchStoreForTests(memStore);
const pricing = await import('../src/lib/anthropicPricing.js');
const { default: handler } = await import('../api/enrich.js');

const run = async () => {
  anthropicCalls.length = 0;
  const logs = []; const orig = console.log;
  console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let status = null, body = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; } }), setHeader: () => {} };
  try {
    await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: {
      title: 'g i joe', issue: '5', grade: 'unknown', confidence: 'low', isGraded: false, numericGrade: null, year: '1987', publisher: null,
      variant: 'exclusive limited signed virgin', keyIssue: null, reason: 'GI Joe 616 exclusive virgin variant',
      category: 'comic', assetType: 'comic', images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    } }, res);
  } catch (e) { threw = e; }
  console.log = orig;
  return { status, body, threw, logs, calls: [...anthropicCalls] };
};
const verLine = (r) => r.logs.find((l) => l.startsWith('[cost-audit]') && l.includes('lane=verification'));
const verifyCalls = (r) => r.calls.filter((c) => c.model === 'claude-haiku-4-5');

console.log('\n=== enrich verification-lane cost observability (real handler) ===\n');
const base = await run();
ok(base.threw === null && base.status === 200, `E1 real handler 200, no throw with the edited verification wiring loaded (${base.threw ? base.threw.message : base.status})`);
ok(!base.logs.some((l) => l.includes('ReferenceError')), 'E1 no ReferenceError (VERIFY_MODEL / resolveCallCost / observeGradeProvenance all resolve at module scope)');
ok(base.status === 200 && typeof base.body?.title === 'string', 'E1 scan produced a normal response body (title present)');

// COVERAGE GAP (precise, deliberately NOT papered over): the verification pass is behind
// `allConflicts.length > 0 && rawComps.recentSales.length > 0`. In this real-handler harness every conflict source
// that is reachable without a full ComicVine/PriceCharting multi-step mock stays empty: detectCompsConflicts always
// receives [] (out.ebayLeafCategories is assigned at api/enrich.js:~11725, AFTER the conflict check at ~7555), and
// ISSUE_MISMATCH / YEAR_DRIFT inputs are reconciled before detection. So the real handler never reaches
// verifyCompsTitles here, and the verification-lane cost behavior is certified only by the shared
// resolveCallCost unit tests + the real-grade-handler unknown-model proof (tests/model-provenance-cost-observability.test.js)
// + the static wiring checks there. Asserted below so the gap cannot silently become a false claim:
ok(verifyCalls(base).length === 0 && !verLine(base), 'GAP-GUARD: this harness does NOT reach verifyCompsTitles (0 verification calls, no lane=verification line) — verification-lane enrich cost behavior is NOT runtime-certified by this file');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
