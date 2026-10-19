// V1 CERTIFICATION — real api/enrich.js handler invocation (GK-138 Handler-Wiring Verification) over the REAL
// 29-listing Street Fighter #1 active pool captured from Production on 2026-10-18.
//
// Proves, through the real handler (stubbed network, no KV, no provider spend):
//   * the skipped claude-check is reported SKIPPED / verified:null — never verified:true
//   * an ask-derived price is labelled "active asks (not sold-verified)", never "verified comps"
//   * the $19 derivation is activeAvg x 0.85 (the grade multiplier does not enter)
//   * a Vision foreignEdition claim leaves the edition UNRESOLVED and identityStanding is no longer CONFIRMED
//   * NO_SOLD_EVIDENCE still locks the contract (REVIEW, not listable)
// Invoke: node tests/v1-enrich-handler-truthfulness.test.js

delete process.env.ACCESS_CODE;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const TEST_PRINCIPAL = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
// Production base has the durable spend guard: name the test principal as the operator so spend-consuming
// requests are admitted (the in-memory store is only ever allowed off Vercel, in a tests/*.test.js process).
process.env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS = TEST_PRINCIPAL;
const researchStore = await import('../src/lib/researchStore.js');
researchStore.setResearchStoreForTests(researchStore.createMemoryResearchStore());
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: TEST_PRINCIPAL }).token;
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const { STREET_FIGHTER_REAL_ACTIVE_POOL } = await import('./fixtures/street-fighter-1-active-pool-2026-10-18.mjs');

const buildEbayItem = (title, price, idx) => ({
  itemId: `v1|40000000000${idx}|0`, title, leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C40000000000${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'], itemWebUrl: `https://www.ebay.com/itm/40000000000${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `40000000000${idx}`,
  adultOnly: false, itemOriginDate: '2026-09-01T18:07:04.000Z', itemCreationDate: '2026-09-01T18:07:04.000Z',
  listingMarketplaceId: 'EBAY_US',
});
const ITEMS = STREET_FIGHTER_REAL_ACTIVE_POOL.map(([t, p], i) => buildEbayItem(t, p, i));
const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const originalFetch = global.fetch;
let anthropicCalls = 0;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse({ itemSummaries: ITEMS, total: ITEMS.length });
  if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return jsonResponse({ error: 'not found' }, 404);
  if (u.includes('api.anthropic.com')) { anthropicCalls++; return jsonResponse({ content: [{ type: 'text', text: '{}' }] }); }
  return jsonResponse({});
};

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.log(`  ✗ ${m}`); } };
const originalLog = console.log; const captured = [];
console.log = (...a) => { captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); originalLog(...a); };

const handler = (await import('../api/enrich.js')).default;
let status = null, body = null;
const res = { status: (c) => ({ json: (d) => { status = c; body = d; return { statusCode: c, body: d }; } }), setHeader: () => {} };
let threw = null;
try {
  await handler({
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` },
    body: {
      assetType: 'comic', title: 'street fighter', issue: '1', year: '1993', publisher: null, variant: null,
      grade: 'VG 4.0', confidence: 'medium', isGraded: false, numericGrade: null, keyIssue: null,
      foreignEdition: true, editionType: 'original',
      reason: 'Street Fighter #1 in raw condition.',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  }, res);
} catch (e) { threw = e; }
console.log = originalLog;
global.fetch = originalFetch;

console.log('\n=== V1 enrich handler truthfulness — real handler, real Street Fighter #1 pool ===\n');
ok(threw === null, `no exception escaped the handler (${threw ? threw.message : 'none'})`);
ok(!captured.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
ok(status === 200, `HTTP 200 (got ${status})`);
if (body) {
  originalLog(`  price=${body.price} pricingSource=${body.pricingSource} priceNote=${JSON.stringify(body.priceNote)} claudeCheck=${JSON.stringify(body.claudeCheck)}`);
  ok(body.pricingSource === 'active_ask_derived', `pricingSource is active_ask_derived (got ${body.pricingSource})`);
  ok(body.claudeCheck && body.claudeCheck.status === 'SKIPPED' && body.claudeCheck.verified === null, `skipped claude-check is SKIPPED / verified:null (got ${JSON.stringify(body.claudeCheck)})`);
  ok(body.verified !== true, 'top-level out.verified is not true');
  ok(anthropicCalls === 0, 'no AI call was made (the skip is real)');
  ok(typeof body.priceNote === 'string' && /active asks \(not sold-verified\)/.test(body.priceNote) && !/verified comps/.test(body.priceNote), `priceNote says "active asks (not sold-verified)", never "verified comps" (got ${JSON.stringify(body.priceNote)})`);
  const avg = body.comps?.averageNum ?? body.rawComps?.average;
  ok(Math.abs(avg - 22.34758620689656) < 1e-6, `active average is the real $22.3476 (got ${avg})`);
  const priceNum = Number(String(body.price).replace(/[^0-9.]/g, ''));
  ok(Math.abs(priceNum - Math.round(avg * 0.85 * 100) / 100) < 0.011, `price is activeAvg x 0.85 = $19.00 (got ${body.price}); the grade multiplier does not enter`);
  ok(body.editionStanding === 'UNRESOLVED', `Vision foreignEdition claim -> editionStanding UNRESOLVED (got ${body.editionStanding})`);
  ok(body.contract?.actionAuthority?.identityStanding !== 'CONFIRMED', `identityStanding is NOT CONFIRMED while the edition claim is unresolved (got ${body.contract?.actionAuthority?.identityStanding})`);
  ok(body.contract?.listable === false && body.contract?.actionAuthority?.state !== 'READY', 'still REVIEW / not listable');
  ok((body.contract?.locks || []).some((l) => l.code === 'market-standing-no-sold-evidence') || (body.contract?.actionAuthority?.reasonCodes || []).length > 0, 'a no-sold-evidence / review lock is present');
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
