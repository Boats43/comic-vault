// tests/c3-gate2-asset-type.test.js
//
// C3 GATE 2 - SCREEN_SUSPECTED (advisory) vs genuinely unresolved asset type (operator-confirmable).
// REAL api/enrich.js handler, stubbed network. Invoke: node tests/c3-gate2-asset-type.test.js
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

console.log('\n--- SCREEN_SUSPECTED is advisory (with Q32 consensus: 5/5 comic votes) ---');
const base = await run({ nItems: 5, extra: { assetTypeConfident: true } });
const screen = await run({ nItems: 5, extra: { assetTypeConfident: true, captureAuthenticity: { status: 'SCREEN_SUSPECTED', verified: false }, referenceOnly: true } });
ok(!base.threw && !screen.threw && screen.status === 200, 'handler runs clean with SCREEN_SUSPECTED present');
ok(screen.b.title === base.b.title && screen.b.issue === base.b.issue && screen.b.confirmedYear === base.b.confirmedYear, 'identification identical with and without SCREEN_SUSPECTED');
ok(screen.b.variantEditionAxis?.exactCount === base.b.variantEditionAxis?.exactCount && JSON.stringify(screen.b.rawComps?.prices) === JSON.stringify(base.b.rawComps?.prices), 'market research (comp pool) identical with and without SCREEN_SUSPECTED');
ok(screen.b.price === base.b.price && screen.b.pricingSource === base.b.pricingSource, 'valuation identical with and without SCREEN_SUSPECTED');
const screenModelFalseQ32 = await run({ nItems: 5, extra: { assetTypeConfident: false, captureAuthenticity: { status: 'SCREEN_SUSPECTED' } } });
ok(screenModelFalseQ32.b.assetTypeConfidentOverride === true && screenModelFalseQ32.b.listingHardLockReason !== 'asset-type-uncertain', 'SCREEN_SUSPECTED + model doubt + Q32 consensus: lock lifted by the server');

console.log('\n--- genuinely unresolved asset type (NO Q32 consensus: 4 comic votes < 5) ---');
const unresolved = await run({ nItems: 4, extra: { assetTypeConfident: false } });
ok(unresolved.b.assetTypeConfident === false && !unresolved.b.assetTypeConfidentOverride, 'no Q32 consensus: uncertainty stays unresolved');
ok(unresolved.b.listingHardLocked === true && unresolved.b.listingHardLockReason === 'asset-type-uncertain', 'unresolved: listing locked as asset-type-uncertain');
ok((unresolved.b.decision?.warnings || []).includes('asset-type-uncertain'), 'unresolved: decision carries the asset-type-uncertain warning');
ok(canOfferOperatorComicConfirmation({ assetType: 'comic', ...unresolved.b }) === true, 'unresolved: the "This is a comic" action is offered');
const screenUnresolved = await run({ nItems: 4, extra: { assetTypeConfident: false, captureAuthenticity: { status: 'SCREEN_SUSPECTED' } } });
ok(screenUnresolved.b.listingHardLockReason === 'asset-type-uncertain', 'SCREEN_SUSPECTED + model doubt + NO Q32: still unresolved (the two flags are separate)');

console.log('\n--- after explicit operator confirmation ---');
const confirmed = await run({ nItems: 4, extra: { assetTypeConfident: false, operatorAssetTypeConfirmed: true } });
const c = confirmed.b;
ok(c.assetTypeConfident === true && c.assetTypeOperatorConfirmation?.classification === 'comic', 'asset-type uncertainty resolved by an explicit operator classification');
ok(c.assetTypeOperatorConfirmation?.principalId === PRINCIPAL && c.assetTypeOperatorConfirmation?.basis === 'operator-explicit' && !!c.assetTypeOperatorConfirmation?.confirmedAt, 'the classification is attributable (principal, basis, timestamp)');
ok(c.listingHardLockReason !== 'asset-type-uncertain' && !(c.decision?.warnings || []).includes('asset-type-uncertain'), 'comic-specific research and pricing are no longer withheld for asset-type doubt');
ok(c.variantEditionAxis?.kind === 'COLOR_VIRGIN' && !(c.rawComps?.prices || []).some((p) => [41, 38, 12].includes(Number(p.price ?? p))), 'variant matching and evidence requirements still apply (colour virgin pool only)');
ok(!c.gkAssetId && !c.ownershipAttestation, 'confirmation creates no ownership authority and no asset');
const listSrc = readFileSync(new URL('../api/list-ebay.js', import.meta.url), 'utf8');
ok(/validateOutcomeAttachment/.test(listSrc) && !/assetTypeOperatorConfirmation/.test(listSrc), 'eBay publication gates do not consume the confirmation (unchanged)');
ok(resolveAssetTypeConfident({ assetTypeConfident: false, assetTypeOperatorConfirmation: { classification: 'comic' } }) === false, 'the stored record alone does not flip the raw flag client-side (the server must re-apply it on refresh)');

console.log('\n--- negative controls ---');
const book = await run({ nItems: 4, extra: { assetType: 'book', assetTypeConfident: false, operatorAssetTypeConfirmed: true } });
ok(!book.b.assetTypeOperatorConfirmation, 'a non-comic category request cannot be confirmed as a comic');
const noFlag = await run({ nItems: 4, extra: { assetTypeConfident: false } });
ok(!noFlag.b.assetTypeOperatorConfirmation, 'no confirmation is recorded unless the operator action is sent');
const merch = await run({ nItems: 4, comic: false, extra: { assetTypeConfident: false, operatorAssetTypeConfirmed: true } });
ok(merch.b.refusedToPrice === true || merch.b.price == null || String(merch.b.pricingSource).startsWith('refused'), `a merchandise-category pool is still hard-blocked after confirmation (pricingSource=${merch.b.pricingSource}, price=${merch.b.price})`);

console.log('\n--- persistence ---');
const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
ok(/assetTypeOperatorConfirmation: enrich\.assetTypeOperatorConfirmation \?\? item\.assetTypeOperatorConfirmation/.test(src), 'the refresh merge keeps the stored classification');
ok(/item\.assetTypeOperatorConfirmation\?\.classification === 'comic'\) \? true : undefined/.test(src), 'the stored classification is re-sent to the server on every refresh');
const sync = readFileSync(new URL('../src/lib/collectionSync.js', import.meta.url), 'utf8');
ok(!/assetTypeOperatorConfirmation/.test(sync) && /\.\.\.attributes/.test(sync), 'collection sync persists it durably inside attributes (not stripped)');
const { IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE } = await import('../src/lib/manualCorrection.js');
ok(IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes('assetTypeOperatorConfirmation'), 'a manual identity correction preserves the operator classification');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
