// GK-272 — real-handler regression for the live Classic Comics #13 HTTP 500.
//
// Production 2026-10-01 19:56:33 (build 2823dcc): POST /api/enrich threw
//   TypeError: Cannot read properties of null (reading 'year')  (enrich.js:3656)
// on the refused-conflict provisional path (Vision "classic comics" #13 vs a
// visual pool whose top family is "classics illustrated dr jekyll mr hyde").
// This reproduces that scan with the REAL eBay pool titles captured in that
// log, through the REAL handler, deterministic (global fetch stub, KV unset).
//
// Invoke: node tests/gk272-classic-comics-refused-conflict-smoke.test.js
// Negative control: GK272_ENRICH_PATH=../api/enrich-head.js (a copy of the
// pre-fix file) must FAIL the "no 500" assertions.

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: 'gk272-test-principal' }).token;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

// Real pool titles from the production log (19 eligible rows).
const TITLES = [
  '[No AI!] Classic Comics (Illustrated)#13 Dr Jekyll & Mr Hyde HRN 28 used in SOTI',
  'Classic Comics #13 Dr Jekyll Mr Hyde Early Printing Cover Detached GD',
  'CLASSIC COMICS # 13  HRN 20 Dr. JEKYLL & Mr. HYDE 1943 stitched  spine (280)',
  'Classic Comics 13 (1946) CGC 7.0 - Dr. Jekyll & Mr. Hyde',
  'vintage comic; CLASSICS ILLUSTRATED; dr Jekyll & Mr. Hyde #13, april 1944',
  'Classics Illustrated #13 Dr. Jekyll and Mr. Hyde vg',
  'Gilberton CLASSICS ILLUSTRATED No. 13 (1944)  DR. JEKYLL and MR. HYDE HRN 112',
  'CLASSICS ILLUSTRATED COMICS #13 Dr Jekyll and Mr. Hyde HRN 62 Higher Grade',
  'Vintage Jekyll And Hyde Comic',
  'vintage comic; CLASSICS ILLUSTRATED; dr Jekyll & Mr. Hyde #13, april 1944',
  'Classics Illustrated Comic Dr.Jekyll and Mr. Hyde 1968',
  'Golden Age CLASSICS ILLUSTRATED #13 - Dr. Jekyll and Mr. Hyde (1944)',
  'Vintage Classics Illustrated #13 Dr. Jekyll and Mr. Hyde by Stevenson',
  'Dr. Jekyll and Mr. Hyde #13 Classics Illustrated By Robert Louis Stevenson',
  'Classics Illustrated DR JEKYLL & MR HYDE #13 HRN 71 Canadian Comic FAIR / GOOD',
  'Classics Illustrated Dr. Jekyll & Mr. Hyde 13 HRN 161 11th Print 1944',
  'Dr. Jekyll and Mr. Hyde #13 Classics Illustrated By Robert Louis Stevenson',
  'CLASSICS ILLUSTRATED COMICS #13 Dr Jekyll and Mr Hyde HRN 169 FN+',
  'Classics Illustrated No. 13 Dr. Jekyll and Mr. Hyde Gilberton 1946 Comic',
];
const ebayItem = (title, i) => ({
  itemId: `v1|5000000000${i}|0`, title, leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(40 + i * 3), currency: 'USD' },
  seller: { username: `seller${i}`, feedbackPercentage: '99', feedbackScore: 500 + i },
  condition: 'Used', conditionId: '3000', buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/5000000000${i}`, legacyItemId: `5000000000${i}`,
  itemLocation: { country: 'US' }, listingMarketplaceId: 'EBAY_US',
});
const ITEMS = TITLES.map(ebayItem);
const jsonResponse = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse({ itemSummaries: ITEMS, total: ITEMS.length });
  if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com/api/products')) return jsonResponse({ products: [] });
  if (u.includes('pricecharting.com')) return jsonResponse({ error: 'not found' }, 404);
  if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
  return jsonResponse({});
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const logs = [];
const origLog = console.log, origErr = console.error;
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a); };
console.error = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origErr(...a); };

const handler = (await import(process.env.GK272_ENRICH_PATH || '../api/enrich.js')).default;
let status = null, body = null, threw = null;
const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: () => {} };
try {
  await handler({
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: {
      title: 'classic comics', issue: '13', grade: 'FR 1.0', confidence: 'medium',
      isGraded: false, numericGrade: null, year: null, publisher: null,
      variant: null, foreignEdition: false, keyIssue: null,
      reason: 'Heavy wear and creasing.',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  }, res);
} catch (e) { threw = e; }
console.log = origLog; console.error = origErr;

origLog('\n=== GK-272 Classic Comics #13 refused-conflict real-handler smoke ===\n');
ok(logs.some((l) => l.includes('decision=refused-identity-conflict')), 'the real refused-conflict identity path was reached (precondition for the regression)');
ok(threw === null, `no exception escaped the handler (${threw ? threw.message : 'none'})`);
ok(status === 200, `HTTP 200, not 500 (actual ${status}${body?.error ? ': ' + body.error : ''})`);
ok(!logs.some((l) => l.includes("reading 'year'")), "the null 'year' dereference does not occur");
ok(!logs.some((l) => l.includes('[enrich-error]')), 'no [enrich-error] logged');
ok(body && body.identityConfident !== undefined || body?.title != null, 'a response body was produced');
ok(body?.contract != null, 'the response contract was assembled');
ok(body?.contract?.price > 0 && body?.contract?.actionAuthority?.state === 'LOCKED' && body?.decision?.action === 'RESEARCH', 'pricing/contract untouched: advisory contract.price still populated under LOCKED + RESEARCH (display authority is a client concern, GK-272B)');
ok(body?.country == null && body?.editionStanding !== 'CONFIRMED_BY_RECONCILER', 'country/edition not asserted from the pool alone');
origLog(`  response: price=${body?.price} pricingSource=${body?.pricingSource} editionStanding=${body?.editionStanding} identityProvisionalFields=${JSON.stringify(body?.identityProvisionalFields)}`);

global.fetch = originalFetch;
origLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
