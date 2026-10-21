// GATE B (2026-10-21) -- DURABLE PRICING PERSISTENCE / READBACK for the Old Man Logan #25 class.
//
// REAL: the /api/enrich handler (only the network is stubbed: eBay Browse returns the scenario pool, every other host returns nothing, KV/Anthropic keys removed), the /api/collection
// handler, the Development Postgres collection_item row, and the pure merge functions the client composes (mergePricingBundle, chooseBetterPrice).
// MIRRORED (disclosed): App.jsx's refreshMarketData itself is a React closure and is NOT executed here. `clientRefreshMerge` below composes the same pure functions in the same way the
// App merge sites do for the pricing fields (bundle via mergePricingBundle; scalar price via chooseBetterPrice; contract/variant from the response). A divergence between this
// composition and App.jsx would not be caught by this file -- label any result MIRRORED-CLIENT-MERGE.
// A throwaway `user` principal is provisioned and removed; no real principal, collection row, asset, or eBay call is touched. Environment is forced to development and the DB module's own
// environment-identity guard fails closed on a mismatch.
//
//   1. ORIGINAL: the obsolete $4.18 / 16-regular-cover bundle is saved to the server and read back (the Production OML #25 shape).
//   2. REFUSAL: a confirmed 1:25 with only regular covers -> refusal; the old price/bands are NOT current, the old bundle is kept as HISTORICAL; server readback + fresh reload agree.
//   3. NEW EVIDENCE: 5 genuine 1:25 asks -> $15.29 replaces the bundle as one generation; server readback + fresh reload agree.
//   4. STALE RESPONSE: replaying the OLD response over the corrected row -- reported (see KNOWN GAP), not hidden.
// Invoke: GK_ENV_FILE=<path to .env.development.local> node tests/gate-b-pricing-persistence-readback.test.js
import './helpers/spendGuardTestSetup.js';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.GK_ENV_FILE || path.join(repoRoot, '.env.development.local');
const envRaw = readFileSync(envFile, 'utf8'); // a missing file throws: this test must FAIL, never skip
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!/development|dev/i.test(String(process.env.GRAILKEY_CATALOG_ENVIRONMENT))) throw new Error('refusing: not a development target');
if (!process.env.GRAILKEY_SESSION_SECRET || process.env.GRAILKEY_SESSION_SECRET.length < 32) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
// No provider key may survive into this process: the only network is the stub below.
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'ANTHROPIC_API_KEY', 'XIMILAR_API_TOKEN', 'COMICVINE_API_KEY', 'GOCOLLECT_API', 'EBAY_AUTH_TOKEN', 'EBAY_DEV_ID']) delete process.env[k];
process.env.EBAY_APP_ID = 'test-app-id'; process.env.EBAY_CERT_ID = 'test-cert-id'; process.env.PRICECHARTING_TOKEN = 'test-pc-token';

const REGULAR = [
  [5.99, 'Old Man Logan #25 Mike Deodato Jr. (Marvel Comics August 2017)'], [2.5, 'Old Man Logan: Days of Anger #25 - Marvel 2017 Mike Deodato Jr. (Wolverine) VFNM'],
  [10, 'OLD MAN LOGAN #25 1st Print vs MAESTRO Marvel Comics 2017 WOLVERINE'], [4.24, 'Old Man Logan (2nd Series) #25 NM 9.4 2017  Mike Deodato Jr. Cover'],
  [4.24, 'Old Man Logan #25 NM+ 2017 Marvel Comics'], [3.35, 'OLD MAN LOGAN #25 MARVEL COMICS "B3"'], [3.99, 'OLD MAN LOGAN #25'], [9.99, 'Old Man Logan #25 Marvel Comics'],
  [3.3, 'Old Man Logan #25 NM (2017) Marvel Comics'], [3.96, 'OLD MAN LOGAN (2016 MARVEL) #25'], [2.99, 'Old Man Logan #25 (2017) NM Ed Brisson Marvel Comics'],
  [2.99, 'Old Man Logan #25 (2017) Old Man Logan Mint'], [4.63, 'OLD MAN LOGAN #25 (MARVEL 2017) "NEW UNREAD"'], [5, 'Old Man Logan #25 Main Cover 2017, Marvel NM'],
  [6.58, 'Old Man Logan #25 (NM) `17 Brisson/ Deodato  (1st Print)'], [4.92, 'Old Man Logan #25 Marvel Comics'],
];
const VARIANT = [
  [15, 'Marvel Comics OLD MAN LOGAN #25 Mike Deodato 1:25 Variant Cover 2017 NM!'], [14.99, 'OLD MAN LOGAN #25 - Marvel Comics Mike Deodato Jr 1:25 Variant Cover'],
  [19.99, 'Old Man Logan #25 1:25 Mike Deodato Variant Marvel 2016 VF/NM'], [14.99, 'Old Man Logan #25 1:25 Deodato Teaser Variant 2017 NM-/NM'],
  [24.99, 'Old Man Logan #25 - 1:25 Mike Deodato variant Cover - Maestro app - NM- - Marvel'],
];
const ebayItem = ([price, title], i) => ({
  itemId: `v1|4000000000${i}|0`, title, leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C4000000000${i}%7C0`, seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/4000000000${i}`, itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `4000000000${i}`, adultOnly: false,
  itemOriginDate: '2026-10-10T18:07:04.000Z', itemCreationDate: '2026-10-10T18:07:04.000Z', listingMarketplaceId: 'EBAY_US',
});
let POOL = [];
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
const realFetch = global.fetch;
const touchedHosts = new Set();
global.fetch = async (url) => {
  const u = String(url); try { touchedHosts.add(new URL(u).host); } catch { touchedHosts.add(u.slice(0, 40)); }
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('item_summary/search') || u.includes('search_by_image')) return json({ itemSummaries: POOL.map(ebayItem), total: POOL.length });
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ error: 'not found' }, 404);
  return json({});
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const realLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = realLog; } };

const { issueToken } = await import('../src/modules/auth/token.js');
const enrichHandler = (await import('../api/enrich.js')).default;
const collectionRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href)).default;
const { closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { mergePricingBundle } = await import('../src/lib/pricingBundleMerge.js');
const { chooseBetterPrice, isPriceInvalidatingRefusal } = await import('../src/lib/dataQualityGuard.js');
const { EXECUTION_AUTHORITY_KEYS } = await import('../src/lib/authorityReceipt.js');

const mockRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
// The enrich response's authorityReceipt is signed FOR the principal on the enrich token, and /api/collection discards it for any other principal. The real flow is one signed-in
// principal doing both, so the enrich call uses the SAME throwaway principal as the saves (assigned below once it exists).
let enrichToken = null;

async function enrich(rows, { variant, confirm }) {
  POOL = rows; const res = mockRes();
  await quiet(() => enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${enrichToken}` }, body: {
    assetType: 'comic', title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant, grade: 'NM-', numericGrade: null, isGraded: false,
    confidence: 'high', reason: 'persist-proof', skipImageSearch: true, images: [],
    ...(confirm ? { manualAuthority: { correctedBy: 'user', correctedFields: ['variant'] }, manualIdentity: true, skipVision: true, identitySource: 'manual' } : {}),
  } }, res));
  return res.body;
}

// MIRRORED client composition of the pricing fields (see header). The server owns the execution-deciding keys (EXECUTION_AUTHORITY_KEYS: contract, pricingSource, refusedToPrice, decision...):
// a plain client write cannot change them, only a write carrying the server's own authorityReceipt from the enrich response can (src/modules/collection/repository.js). So the client
// forwards the response's execution keys AND its authorityReceipt exactly as App.jsx does (`authorityReceipt: enrich.contract ? enrich.authorityReceipt : cur.authorityReceipt`).
function clientRefreshMerge(cur, e) {
  const p = chooseBetterPrice(e, cur);
  const exec = {}; for (const k of EXECUTION_AUTHORITY_KEYS) if (Object.prototype.hasOwnProperty.call(e, k)) exec[k] = e[k];
  return {
    ...cur, ...exec, authorityReceipt: e.contract ? (e.authorityReceipt ?? null) : (cur.authorityReceipt ?? null), ...mergePricingBundle(cur, e),
    price: p.price, priceLow: p.priceLow, priceHigh: p.priceHigh, pricingSource: p.pricingSource, priceNote: p.priceNote,
    refusedToPrice: e.refusedToPrice === true, contract: e.contract ?? cur.contract ?? null, variant: Object.prototype.hasOwnProperty.call(e, 'variantNote') ? e.variantNote : cur.variant,
  };
}

const env = process.env;
const client = new Client({ connectionString: env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const PRINCIPAL = randomUUID();
const ITEM_ID = `gateb-persist-${Date.now()}`;
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL, `${ITEM_ID}-throwaway-fixture`]);
const now = Date.now();
const payloadB64 = Buffer.from(JSON.stringify({ principalId: PRINCIPAL, iat: now, exp: now + 3600000, epoch: env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
const TOKEN = `${payloadB64}.${createHmac('sha256', env.GRAILKEY_SESSION_SECRET).update(payloadB64).digest('base64url')}`;
enrichToken = issueToken({ principalId: PRINCIPAL }).token;
const call = async (method, query, body) => { const res = mockRes(); await quiet(() => collectionRoute({ method, headers: { authorization: `Bearer ${TOKEN}` }, query, body }, res)); return res; };
const save = async (item) => { const { id, assetCategory, ...attributes } = item; return call('POST', {}, { id: ITEM_ID, assetCategory: 'comic', attributes }); };
const readback = async () => { const r = await call('GET', { id: ITEM_ID }); if (r.statusCode !== 200) throw new Error('readback ' + r.statusCode); return r.body.attributes; };
const freshReload = async () => { const r = await call('GET', {}); const it = (r.body?.items || []).find((x) => x.id === ITEM_ID); if (!it) throw new Error('item missing on reload'); return it.attributes; };
const money = (v) => Number(String(v ?? '').replace(/[$,]/g, ''));

realLog('\n=== GATE B pricing persistence / readback (real enrich + real /api/collection + Development DB) ===\n');
try {
  // 1. ORIGINAL -- the obsolete bundle
  const R0 = await enrich(REGULAR, { variant: '', confirm: false });
  ok(R0 && money(R0.price) === 4.18 && R0.priceBands && R0.priceBands.count === 16, `1: the OBSOLETE response is the Production shape ($4.18 from 16 regular covers): ${R0 && R0.price}, count ${R0 && R0.priceBands && R0.priceBands.count}`);
  let row = { id: ITEM_ID, assetCategory: 'comic', title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: null, ...clientRefreshMerge({}, R0) };
  const s0 = await save(row);
  ok(s0.statusCode === 200, `1: original row saved (HTTP ${s0.statusCode})`);
  const a0 = await readback();
  ok(money(a0.price) === 4.18 && money(a0.priceBands && a0.priceBands.market) === 4.18 && a0.rawComps && a0.rawComps.count === 16 && !!a0.priceDerivationTrace, '1: server readback holds the original obsolete bundle ($4.18, 16-listing pool, trace)');
  const originalBands = a0.priceBands;

  // 2. REFUSAL -- confirmed 1:25, only regular covers available
  const R1 = await enrich(REGULAR, { variant: '1:25', confirm: true });
  ok(R1 && R1.refusedToPrice === true && R1.pricingSource === 'refused-variant-evidence-insufficient' && R1.price == null && !R1.priceBands, `2: real handler refuses (${R1 && R1.pricingSource}, price ${R1 && R1.price})`);
  ok(isPriceInvalidatingRefusal(R1), '2: the refusal is classified as invalidating the prior price');
  row = { ...clientRefreshMerge(a0, R1), id: ITEM_ID };
  ok((await save(row)).statusCode === 200, '2: refused state saved');
  for (const [name, a] of [['server readback', await readback()], ['fresh client reload', await freshReload()]]) {
    ok(a.priceBands == null, `2 ${name}: no band is current`);
    ok(a.price == null && a.priceLow == null && a.priceHigh == null, `2 ${name}: the old $4.18 scalar price is NOT resurrected (price ${JSON.stringify(a.price)})`);
    ok(a.pricingSource === 'refused-variant-evidence-insufficient' && a.refusedToPrice === true, `2 ${name}: the refusal is what is stored`);
    ok(a.contract && a.contract.state === 'REFUSED' && a.contract.listable !== true, `2 ${name}: contract REFUSED and not listable (${a.contract && a.contract.state})`);
    ok(a.pricingBundleStatus === 'REFUSED_OR_OMITTED', `2 ${name}: bundle status ${a.pricingBundleStatus}`);
    const h = a.historicalPricingEvidence;
    ok(h && h.authoritative === false && h.status === 'HISTORICAL' && h.priceBands && h.priceBands.market === originalBands.market && h.rawComps && h.rawComps.count === 16, `2 ${name}: the obsolete bundle is preserved separately as non-authoritative HISTORICAL ($${h && h.priceBands && h.priceBands.market}, ${h && h.rawComps && h.rawComps.count} listings)`);
    ok(a.variant === '1:25', `2 ${name}: confirmed variant stored (${a.variant})`);
  }

  // 3. NEW EVIDENCE -- genuine 1:25 asks
  const cur2 = await readback();
  const R2 = await enrich(VARIANT, { variant: '1:25', confirm: true });
  ok(R2 && money(R2.price) === 15.29 && R2.priceBands && R2.priceBands.count === 5 && R2.priceBands.variantEvidence && R2.priceBands.variantEvidence.applicable === 5, `3: real handler prices from the 5 genuine asks ($${R2 && R2.price}, evidence ${R2 && R2.priceBands && JSON.stringify(R2.priceBands.variantEvidence)})`);
  row = { ...clientRefreshMerge(cur2, R2), id: ITEM_ID };
  ok((await save(row)).statusCode === 200, '3: corrected state saved');
  for (const [name, a] of [['server readback', await readback()], ['fresh client reload', await freshReload()]]) {
    ok(money(a.price) === 15.29 && money(a.priceBands.market) === 15.29 && a.priceBands.count === 5, `3 ${name}: price and band agree at $15.29 from 5 listings`);
    ok(a.rawComps && a.rawComps.count === 5, `3 ${name}: the pool is the 5-listing generation (no mixed-generation bundle; count ${a.rawComps && a.rawComps.count})`);
    ok(a.priceDerivationTrace && money(a.priceDerivationTrace.finalPrice) === 15.29, `3 ${name}: the trace belongs to the same generation (finalPrice ${a.priceDerivationTrace && a.priceDerivationTrace.finalPrice})`);
    ok(a.pricingBundleStatus === 'CURRENT' && a.pricingSource === 'active_ask_derived', `3 ${name}: CURRENT, labelled an ask-derived price (${a.pricingSource})`);
    ok(a.contract && a.contract.listable !== true, `3 ${name}: asks-only evidence is still not listable (state ${a.contract && a.contract.state})`);
    ok(JSON.stringify(a).includes('4.18') === false || a.historicalPricingEvidence == null, `3 ${name}: the obsolete $4.18 is not present as current (the merge rule clears history on a fresh good result)`);
  }

  // 4. STALE RESPONSE -- replaying the OLD response over the corrected row
  const corrected = await readback();
  const replay = clientRefreshMerge(corrected, R0);
  const gap = money(replay.priceBands && replay.priceBands.market) === 4.18;
  realLog(`  KNOWN GAP (reported, not asserted): replaying the OLD 16-cover response over the corrected row ${gap ? 'RESTORES the obsolete $4.18 band as CURRENT' : 'is rejected'} (an older response carries a positive band, so the merge rule treats it as new evidence; there is no response ordering/generation check). Fixing it needs an ordering authority (e.g. a monotonic evidenceObservedAt/generation compare) -- a design decision, not made here.`);
  ok(touchedHosts.size > 0 && [...touchedHosts].every((h) => h.endsWith('ebay.com') || h.endsWith('pricecharting.com') || h.endsWith('comicvine.gamespot.com') || h.startsWith('/')), `network containment: every fetch went to the stub; requested only ${[...touchedHosts].join(', ')} (no real provider reachable; KV/Anthropic keys removed)`);
} finally {
  global.fetch = realFetch;
  await client.query('DELETE FROM collection_item WHERE principal_id = $1', [PRINCIPAL]);
  await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL]);
  const left = await client.query('SELECT (SELECT count(*) FROM collection_item WHERE principal_id = $1) AS items, (SELECT count(*) FROM gk_principal WHERE id = $1) AS principals', [PRINCIPAL]);
  ok(Number(left.rows[0].items) === 0 && Number(left.rows[0].principals) === 0, 'cleanup: throwaway rows removed');
  await client.end(); await closePool().catch(() => {});
  realLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}
