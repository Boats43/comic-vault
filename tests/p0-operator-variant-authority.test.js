// tests/p0-operator-variant-authority.test.js
//
// P0 (2026-10-16, Old Man Logan #25) — an OPERATOR-CONFIRMED variant survives enrichment.
// Production: the operator's variant "1:25" was accepted and stored, but api/enrich.js seeded its source as 'vision', so the
// Directive-AM F-3 reconciler judged it an uncorroborated Vision claim and CLEARED it ("[reconcile-variant] CLEARING
// confirmedVariant "1:25" -> null"). The card lost the variant and sold-evidence variant filtering ran with userVariant:null.
//
// REAL api/enrich.js handler, real Development rows, real signed token; only network fetch is stubbed.
//
// Invoke: node tests/p0-operator-variant-authority.test.js

import './helpers/spendGuardTestSetup.js';
import { readFileSync, existsSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = [path.join(root, '.env.development.local'), process.env.GK_MAIN_CHECKOUT_ENV].find((p) => p && existsSync(p));
if (!envPath) throw new Error('.env.development.local not found (set GK_MAIN_CHECKOUT_ENV)');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
for (const k of ['ACCESS_CODE', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const { createCollectionItem, getMyCollectionItem, closePool } = await import(pathToFileURL(path.join(root, 'src', 'modules', 'collection', 'index.js')).href);

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`}`);
const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const mintTestToken = (principalId) => {
  const now = Date.now();
  const b = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`;
};

console.log('\n=== P0 — operator-confirmed variant authority (real handler, real Development DB) ===\n');

const TAG = `p0variant-${Date.now()}`;
const PRINCIPAL = randomUUID();
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL, `${TAG}-fixture`]);
const TOKEN = mintTestToken(PRINCIPAL);
const createdIds = [];
// identityAuthority is server-owned (GK-261): seed the DURABLE state with a test-only SQL merge, as the real correction pathway produced.
const makeItem = async (id, attributes) => {
  createdIds.push(id);
  await createCollectionItem({ principalId: PRINCIPAL, id, assetCategory: 'comic', attributes: { title: attributes.title } });
  await client.query(`UPDATE collection_item SET attributes = COALESCE(attributes, '{}'::jsonb) || $3::jsonb WHERE principal_id = $1 AND id = $2`, [PRINCIPAL, id, JSON.stringify(attributes)]);
};

async function runOnce(label, requestBody) {
  console.log(`\n--- ${label} ---`);
  const POOL = [{ itemId: 'v1|990001|0', title: 'Old Man Logan #25 Marvel 2017', leafCategoryIds: ['63'], categories: [], price: { value: '30.00', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/990001', condition: 'Used', image: { imageUrl: 'https://i.ebayimg.com/x.jpg' } }];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('item_summary/search') || u.includes('search_by_image')) return jsonResponse({ itemSummaries: POOL, total: 1 });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };
  const captured = [];
  const orig = console.log;
  console.log = (...a) => { captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  const handler = (await import('../api/enrich.js?t=' + label.replace(/\W+/g, '_') + Date.now())).default;
  let status = null, body = null, threw = null;
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: requestBody }, { status: (c) => ({ json: (d) => { status = c; body = d; } }), setHeader: () => {} }); } catch (e) { threw = e; }
  console.log = orig;
  ok(threw === null && status === 200, `handler returned 200 without throwing (${threw ? threw.stack : status})`);
  return { body, logs: captured };
}

const DURABLE = { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25', identityAuthority: { title: 'OPERATOR_CONFIRMED', variant: 'OPERATOR_CONFIRMED' } };
const clearing = (logs) => logs.some((l) => l.includes('[reconcile-variant] CLEARING'));
const base = { assetType: 'comic', title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', grade: 'NM 9.2', isGraded: false, numericGrade: null, confidence: 'high' };

try {
  {
    const id = `${TAG}-v1`;
    await makeItem(id, { ...DURABLE });
    const before = (await getMyCollectionItem({ principalId: PRINCIPAL, id })).attributes;
    const { body, logs } = await runOnce('V1 ordinary refresh, durable OPERATOR_CONFIRMED variant', { ...base, variant: '1:25', skipImageSearch: true, collectionItemId: id, ownedRefresh: true });
    eq(body?.variantNote, '1:25', 'the operator-confirmed variant is on the response (the card keeps it)');
    ok(!clearing(logs), 'the reconciler did not clear the operator-confirmed variant');
    eq(body?.operatorVariantAuthority, 'durable-operator-confirmed', 'the variant authority source is reported');
    eq(body?.title, 'Old Man Logan', 'title authority still holds alongside');
    const after = (await getMyCollectionItem({ principalId: PRINCIPAL, id })).attributes;
    eq({ v: after.variant, ia: after.identityAuthority, t: after.title }, { v: before.variant, ia: before.identityAuthority, t: before.title }, 'the durable variant, authority and title are unchanged');
  }
  {
    const id = `${TAG}-v2`;
    await makeItem(id, { ...DURABLE });
    const { body, logs } = await runOnce('V2 a stale/wrong client variant cannot displace the confirmed one', { ...base, variant: '1/25', skipImageSearch: true, collectionItemId: id, ownedRefresh: true });
    eq(body?.variantNote, '1:25', 'the durable confirmed variant wins over the stale client value');
    ok(!clearing(logs), 'no clearing');
  }
  {
    const id = `${TAG}-v3`;
    await makeItem(id, { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: '1/25', identityAuthority: { variant: 'OPERATOR_CONFIRMED' } });
    const { body, logs } = await runOnce('V3 a deliberate manual variant correction is honored and not cleared', {
      ...base, variant: '1:25', manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual',
      manualAuthority: { correctedBy: 'user', correctedFields: ['variant'] }, collectionItemId: id, ownedRefresh: true,
    });
    eq(body?.variantNote, '1:25', 'the corrected variant is on the response');
    eq(body?.operatorVariantAuthority, 'manual-correction', 'authority source is the manual correction');
    ok(!clearing(logs), 'the reconciler did not clear the freshly corrected variant');
  }
  {
    const id = `${TAG}-v4`;
    await makeItem(id, { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel' });
    const { body, logs } = await runOnce('V4 control: an UNCONFIRMED Vision variant with no corroboration is still cleared (behavior unchanged)', { ...base, variant: 'Gold Foil', skipImageSearch: true, collectionItemId: id, ownedRefresh: true });
    ok(clearing(logs), 'the Directive-AM reconciler still clears an uncorroborated Vision variant');
    ok(body?.operatorVariantAuthority === undefined, 'no operator variant authority is reported when none exists');
  }
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
} finally {
  if (createdIds.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [PRINCIPAL, createdIds]);
  try { await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL]); } catch (e) { console.log(`  (principal fixture retained: ${e.message.slice(0, 60)})`); }
  await client.end();
  await closePool();
  process.exit(failed > 0 ? 1 : 0);
}
