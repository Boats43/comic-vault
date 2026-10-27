// tests/c3-gate3-stale-price.test.js
//
// C3 GATE 3 - a corrected colour-virgin identity invalidates the incompatible $18.71, keeps it as SUPERSEDED
// provenance, and shows the $8.99 active ask as reference evidence only. REAL api/enrich.js handler output is
// merged through the REAL buildCorrectedCatalogueItem. Invoke: node tests/c3-gate3-stale-price.test.js
import './helpers/spendGuardTestSetup.js';
import { readFileSync } from 'node:fs';
delete process.env.ACCESS_CODE;
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
const { issueToken } = await import('../src/modules/auth/token.js');
const PRINCIPAL = 'c3-gate2-principal';
const TOKEN = issueToken({ principalId: PRINCIPAL }).token;
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
process.env.EBAY_APP_ID ||= 'test-app-id'; process.env.EBAY_CERT_ID ||= 'test-cert-id'; process.env.PRICECHARTING_TOKEN ||= 'test-pc-token';
const { resolveAssetTypeConfident, canOfferOperatorComicConfirmation } = await import('../src/lib/assetTypeStanding.js');

const jsonResponse = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const item = (title, price, i, comic = true) => ({
  itemId: `v1|g2${i}|0`, title, leafCategoryIds: [comic ? '259104' : '220'],
  categories: [{ categoryId: comic ? '259104' : '220', categoryName: comic ? 'Comics & Graphic Novels' : 'Toys & Hobbies' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7Cg2${i}%7C0`, seller: { username: `s${i}`, feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New', conditionId: '1000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'], itemWebUrl: `https://www.ebay.com/itm/g2${i}`, itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `g2${i}`, adultOnly: false, itemOriginDate: '2025-05-19T20:04:03.000Z', itemCreationDate: '2025-05-19T20:04:03.000Z', listingMarketplaceId: 'EBAY_US',
});
const TITLES = [
  ['Avengers #4 2023 Alex Ross Virgin Variant Color Cover NM', 8.99], ['Avengers #4 2023 Alex Ross 1:25 Black and White Sketch Virgin Variant NM', 41],
  ['Avengers #4 (2023) Alex Ross B&W Virgin Sketch Variant', 38], ['Avengers #4 2023 Alex Ross Connecting Trade Dress Cover Variant NM', 12],
  ['Avengers #4 (2023) Marvel Cover A NM', 4.5],
];
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };

async function run({ nItems, comic = true, extra = {} }) {
  const items = TITLES.slice(0, nItems).map(([t, p], i) => item(t, p, i, comic));
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse({ itemSummaries: items, total: items.length });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  const handler = (await import('../api/enrich.js')).default;
  let body = null, status = null;
  const req = { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: {
    title: 'Avengers', issue: '4', grade: 'NM', confidence: 'medium', isGraded: false, numericGrade: null, year: '2023', publisher: 'Marvel',
    variant: 'Alex Ross Connecting Virgin Variant', keyIssue: null, assetType: 'comic', reason: 'physical copy, glare', images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='], ...extra } };
  let threw = null;
  try { await handler(req, { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader() {} }); } catch (e) { threw = e; }
  console.log = orig;
  return { b: body || {}, status, logs, threw };
}

const { buildCorrectedCatalogueItem } = await import('../src/lib/manualCorrection.js');
const VARIANT = 'Alex Ross Connecting Virgin Variant';
const stale = {
  id: 'cv_1793075346040_c6e7o1', title: 'Avengers', issue: '4', year: '2023', variant: 'Alex Ross B&W Sketch Virgin',
  price: '$18.71', priceLow: '$15.00', priceHigh: '$22.00', pricingSource: 'active_ask_derived', verifiedFMV: false,
  rawComps: { count: 9, prices: [18, 19, 20, 17, 18, 19, 20, 17, 18] }, comps: { count: 9 }, images: ['data:image/png;base64,AA=='],
  contract: { state: 'READY' }, decision: { action: 'LIST_NOW' }, grade: 'NM', assetType: 'comic',
};
const r = await run({ nItems: 5, extra: { assetTypeConfident: true } });
const e = r.b;
ok(!r.threw && r.status === 200, 'real handler runs clean for the corrected colour-virgin identity');
const merged = buildCorrectedCatalogueItem(stale, { ...e, variantNote: VARIANT });
ok(merged.price !== '$18.71', 'the stale $18.71 is not the corrected book price');
ok(merged.price == null && merged.pricingSource !== 'active_ask_derived', 'no recommended price is fabricated from one ask (honest refusal)');
ok(merged.priceLow !== '$15.00' && merged.priceHigh !== '$22.00', 'the stale price band is gone');
ok(merged.contract?.state !== 'READY' && merged.decision?.action !== 'LIST_NOW', 'the stale READY / LIST_NOW verdict is not inherited');
const sup = merged.supersededResearch?.[0];
ok(!!sup && sup.status === 'SUPERSEDED' && sup.price === '$18.71' && sup.priorIdentity?.variant === 'Alex Ross B&W Sketch Virgin' && !!sup.supersededAt && sup.reason === 'identity-or-variant-correction', 'the $18.71 research is preserved as SUPERSEDED provenance (price, prior variant, timestamp, reason)');
const prices = (merged.rawComps?.prices || []).map((p) => Number(p.price ?? p));
ok(prices.length === 1 && prices[0] === 8.99, 'the displayed comp evidence is the single $8.99 colour-virgin listing');
ok(merged.verifiedFMV !== true && !(merged.soldComps || []).length, 'the $8.99 is not presented as verified FMV or as a sold comp');
ok(/asking price, not a sold price/.test(String(merged.priceNote)), `the note labels it an asking price, not a sold price: "${merged.priceNote}"`);
ok(merged.variantEditionAxis?.exactCount === 1 && merged.variantEditionAxis?.excludedCount === 4, 'edition axis shows 1 exact + 4 excluded other-edition listings');
ok(merged.images?.[0] === stale.images[0] && merged.grade === 'NM', 'physical evidence (photo, grade) is preserved');
ok(merged.variant === VARIANT, 'the corrected variant is authoritative');
const again = buildCorrectedCatalogueItem(merged, { ...e, variantNote: VARIANT });
ok(again.supersededResearch.length === 2 && again.supersededResearch[0].price === '$18.71', 'history accumulates; the $18.71 is never resurrected as current');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
