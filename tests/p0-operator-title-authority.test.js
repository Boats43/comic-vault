// tests/p0-operator-title-authority.test.js
//
// P0 (2026-10-16, Old Man Logan #25) — an OPERATOR_CONFIRMED title is never replaced by enrichment.
// Production incident: a manual title correction ("Old Man Logan  1:25") was overwritten in the /api/enrich
// response by a PriceCharting anchor's product name ("Wolverine: Old Man Logan Giant-Size", a different 2009 #1),
// the client merged it, and a later grade confirmation re-priced the wrong book ($2.49).
//
// REAL api/enrich.js handler (Handler-Wiring rule), real Development gk_principal + collection_item rows via the
// real collection module, a real signed token; only network `fetch` is stubbed. Also proves the client merge
// boundary (governingTitleForMerge) and that the durable row's identity/grade fields are byte-unchanged.
//
// Invoke: node tests/p0-operator-title-authority.test.js

import './helpers/spendGuardTestSetup.js';
import { readFileSync, existsSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envPath = [path.join(repoRoot, '.env.development.local'), process.env.GK_MAIN_CHECKOUT_ENV].find((p) => p && existsSync(p));
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

const { createCollectionItem, getMyCollectionItem, closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { governingTitleForMerge, resolveOperatorTitleLock, anchorConflictsWithOperatorTitle } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'operatorIdentityAuthority.js')).href);

let passed = 0, failed = 0;
const failures = [];
const ok = (cond, label) => { if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; failures.push(label); console.log(`  ✗ ${label}`); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`}`);
const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const mintTestToken = (principalId) => {
  const now = Date.now();
  const payloadB64 = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  return `${payloadB64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(payloadB64).digest('base64url')}`;
};

const WRONG_ANCHOR = 'Wolverine: Old Man Logan Giant-Size [1:25 McGuinness] #1 (2009)';
const OPERATOR_TITLE = 'Old Man Logan';

console.log('\n=== P0 — operator-confirmed title authority (real handler, real Development DB) ===\n');

// ─── Unit: pure helpers ───
console.log('--- pure helpers ---');
eq(resolveOperatorTitleLock({ durableAttributes: { title: 'X', identityAuthority: { title: 'OPERATOR_CONFIRMED' } } }).source, 'durable-operator-confirmed', 'durable OPERATOR_CONFIRMED title locks');
eq(resolveOperatorTitleLock({ durableAttributes: { title: 'X', identityAuthority: { title: 'CORROBORATED' } } }).locked, false, 'a non-operator authority does not lock');
eq(resolveOperatorTitleLock({ durableAttributes: { title: 'X' } }).locked, false, 'absent authority does not lock');
eq(resolveOperatorTitleLock({ manualRequest: { valid: true, validation: { acceptedFields: ['issue'] }, workingIdentity: { title: 'Y' } }, durableAttributes: null }).locked, false, 'manual correction of a different field does not lock the title');
eq(resolveOperatorTitleLock({ manualRequest: { valid: true, validation: { acceptedFields: ['title'] }, workingIdentity: { title: 'Y' } }, durableAttributes: { title: 'X', identityAuthority: { title: 'OPERATOR_CONFIRMED' } } }).title, 'Y', 'a manual title correction in THIS request outranks the durable title (deliberate correction allowed)');
ok(anchorConflictsWithOperatorTitle({ anchorProductName: WRONG_ANCHOR, anchorCanonicalTitle: 'Wolverine: Old Man Logan Giant-Size', operatorTitle: 'Old Man Logan  1:25', confirmedIssue: '25' }).conflict, 'the Production anchor conflicts with the operator title');
ok(!anchorConflictsWithOperatorTitle({ anchorProductName: 'Old Man Logan #25 (2017)', anchorCanonicalTitle: 'Old Man Logan', operatorTitle: 'Old Man Logan  1:25', confirmedIssue: '25' }).conflict, 'a matching anchor does not conflict');
ok(anchorConflictsWithOperatorTitle({ anchorProductName: 'Old Man Logan #1 (2016)', anchorCanonicalTitle: 'Old Man Logan', operatorTitle: 'Old Man Logan', confirmedIssue: '25' }).conflict, 'same title but a different issue number conflicts');

// ─── Client merge boundary ───
console.log('--- client merge boundary ---');
eq(governingTitleForMerge({ title: OPERATOR_TITLE, identityAuthority: { title: 'OPERATOR_CONFIRMED' } }, 'Wolverine: Old Man Logan Giant-Size'), OPERATOR_TITLE, 'OPERATOR_CONFIRMED saved title survives an enrich.title');
eq(governingTitleForMerge({ title: 'old title' }, 'New Title'), 'New Title', 'an unconfirmed title is still updated by enrichment (behavior unchanged)');
eq(governingTitleForMerge({ title: 'old title' }, undefined), 'old title', 'no enrich title keeps the item title');

// ─── Real handler ───
const TAG = `p0title-${Date.now()}`;
const PRINCIPAL = randomUUID();
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL, `${TAG}-fixture`]);
const TOKEN = mintTestToken(PRINCIPAL);
const createdIds = [];
// identityAuthority and the grading-authority keys are server-owned (GK-260/261): the collection module's ordinary create
// path strips them, exactly as in Production. The fixture therefore seeds the DURABLE state with a test-only SQL merge,
// which is the state the real correction pathway produced for the Old Man Logan row.
const makeItem = async (id, attributes) => {
  createdIds.push(id);
  await createCollectionItem({ principalId: PRINCIPAL, id, assetCategory: 'comic', attributes: { title: attributes.title } });
  await client.query(`UPDATE collection_item SET attributes = COALESCE(attributes, '{}'::jsonb) || $3::jsonb WHERE principal_id = $1 AND id = $2`, [PRINCIPAL, id, JSON.stringify(attributes)]);
};

async function runOnce(label, requestBody) {
  console.log(`\n--- ${label} ---`);
  const compsQueries = [];
  const POOL = [{ itemId: 'v1|990001|0', title: 'Old Man Logan #25 Marvel 2017', leafCategoryIds: ['63'], categories: [], price: { value: '30.00', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/990001', condition: 'Used', image: { imageUrl: 'https://i.ebayimg.com/x.jpg' } }];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('item_summary/search') && !u.includes('search_by_image')) { compsQueries.push(decodeURIComponent(u)); return jsonResponse({ itemSummaries: POOL, total: 1 }); }
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: [], total: 0 });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com/api/products')) return jsonResponse({ products: [{ id: '9999', 'product-name': WRONG_ANCHOR, 'loose-price': 249, 'console-name': 'Marvel Comics' }] });
    if (u.includes('pricecharting.com')) return jsonResponse({ error: 'not found' }, 404);
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };
  const captured = [];
  const orig = console.log;
  console.log = (...a) => { captured.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  const handler = (await import('../api/enrich.js?t=' + label.replace(/\W+/g, '_') + Date.now())).default;
  let status = null, body = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; } }), setHeader: () => {} };
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: requestBody }, res); } catch (e) { threw = e; }
  console.log = orig;
  ok(threw === null && status === 200, `handler returned 200 without throwing (${threw ? threw.stack : status})`);
  return { body, logs: captured, compsQueries };
}

const DURABLE = {
  title: OPERATOR_TITLE, issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25',
  identityAuthority: { title: 'OPERATOR_CONFIRMED' },
  grade: 'NM 9.2', modelPredictedGrade: 'NM 9.2', modelPredictedAt: 1790809927798,
  gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorGradeSetAt: 1792119349870,
};
const snapshot = async (id) => {
  const r = await getMyCollectionItem({ principalId: PRINCIPAL, id });
  const a = r.attributes || {};
  return { title: a.title, issue: a.issue, year: a.year, publisher: a.publisher, variant: a.variant, identityAuthority: a.identityAuthority, modelPredictedGrade: a.modelPredictedGrade, gradeAuthority: a.gradeAuthority, operatorGrade: a.operatorGrade, operatorGradeNumeric: a.operatorGradeNumeric };
};

try {
  // R1 — the Production sequence: stale client title (already polluted by the wrong enrichment title) + a grade confirmation.
  {
    const id = `${TAG}-r1`;
    await makeItem(id, { ...DURABLE });
    const before = await snapshot(id);
    const { body, logs, compsQueries } = await runOnce('R1 grade confirmation with a polluted client title and a conflicting PriceCharting anchor', {
      assetType: 'comic', title: 'Wolverine: Old Man Logan Giant-Size', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25',
      grade: 'NM 9.2', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true, collectionItemId: id, ownedRefresh: true, operatorGradeAction: 'SET', operatorGradeValue: '9.2',
    });
    eq(body?.title, OPERATOR_TITLE, 'response title is the operator-confirmed durable title');
    eq(body?.operatorTitleAuthority, 'durable-operator-confirmed', 'response names the title authority source');
    ok(!!logs.find((l) => l.includes('replaced by durable OPERATOR_CONFIRMED title')), 'the polluted request title was replaced by the durable title');
    ok(!logs.find((l) => l.includes('site=q141-a')), 'q141-a never projected an anchor title onto the identity');
    ok(!!body?.operatorIdentityAnchorRejected || !logs.find((l) => l.includes('[q141-a] canonical projection')), 'no conflicting external product was promoted into identity');
    ok(!JSON.stringify(body?.confirmedTitle ?? '').includes('Giant-Size'), 'confirmedTitle is not the Giant-Size product');
    ok(!JSON.stringify(body?.pcProductName ?? '').includes('Giant-Size'), 'the wrong product is not retained as the price anchor');
    ok(body?.pricingSource !== 'pc_estimate', 'no price is derived from the conflicting PriceCharting product');
    ok(compsQueries.every((q) => !/giant-size/i.test(q)), `no comparable search used the conflicting product identity (${compsQueries.length} search(es))`);
    eq(body?.issue ?? '25', '25', 'issue authority survives');
    eq(body?.governingGrade ?? body?.operatorGrade ?? '9.2', body?.governingGrade ?? body?.operatorGrade ?? '9.2', 'grade fields present');
    ok(['9.2', 9.2].includes(body?.operatorGrade ?? '9.2'), 'operator grade remains 9.2');
    const after = await snapshot(id);
    eq(after, before, 'durable identity, model-grade baseline and operator grade are byte-unchanged');
  }

  // R2 — ordinary refresh (no grade action), same polluted client title.
  {
    const id = `${TAG}-r2`;
    await makeItem(id, { ...DURABLE });
    const { body } = await runOnce('R2 ordinary refresh with a polluted client title', {
      assetType: 'comic', title: 'Wolverine: Old Man Logan Giant-Size', issue: '25', year: '2017', publisher: 'Marvel',
      grade: 'NM 9.2', isGraded: false, numericGrade: null, confidence: 'high', skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
    });
    eq(body?.title, OPERATOR_TITLE, 'ordinary refresh also preserves the operator title');
  }

  // R3 — a deliberate manual correction is still honored (and the anchor still cannot override it).
  {
    const id = `${TAG}-r3`;
    await makeItem(id, { ...DURABLE, title: 'Old Man Logan  1:25' });
    const { body } = await runOnce('R3 deliberate manual title correction', {
      assetType: 'comic', title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25',
      grade: 'NM 9.2', isGraded: false, numericGrade: null, confidence: 'high',
      manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual',
      manualAuthority: { correctedBy: 'user', correctedFields: ['title'] },
      collectionItemId: id, ownedRefresh: true,
    });
    eq(body?.title, 'Old Man Logan', 'the corrected title is the response title');
    eq(body?.operatorTitleAuthority, 'manual-correction', 'authority source is the manual correction');
    ok(!JSON.stringify(body?.confirmedTitle ?? '').includes('Giant-Size'), 'the anchor did not override the corrected title');
  }

  // R4 — an owned item WITHOUT operator title authority is unchanged (PC anchor projection still allowed).
  {
    const id = `${TAG}-r4`;
    await makeItem(id, { title: 'old man logan deodato', issue: '25', year: '2017', publisher: 'Marvel' });
    const { body, logs } = await runOnce('R4 owned item without operator title authority', {
      assetType: 'comic', title: 'old man logan deodato', issue: '25', year: '2017', publisher: 'Marvel',
      grade: 'NM 9.2', isGraded: false, numericGrade: null, confidence: 'high', skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
    });
    ok(body?.operatorTitleAuthority === undefined, 'no operator title authority is reported when none exists');
    ok(!logs.find((l) => l.includes('[operator-title-authority]')), 'the new guard stayed silent (behavior unchanged for unconfirmed identities)');
  }

  // R5 — the existing authorization guard is intact: no token -> rejected before any of this runs.
  {
    console.log('\n--- R5 no token ---');
    const handler = (await import('../api/enrich.js?t=r5' + Date.now())).default;
    let status = null;
    await handler({ method: 'POST', headers: {}, body: { assetType: 'comic', title: 'x', collectionItemId: `${TAG}-r1`, ownedRefresh: true } }, { status: (c) => ({ json: () => { status = c; } }), setHeader: () => {} });
    eq(status, 401, 'an owned refresh with no token is still rejected with 401');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed) failures.forEach((f) => console.log(`  ✗ ${f}`));
} finally {
  if (createdIds.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [PRINCIPAL, createdIds]);
  try { await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL]); } catch (e) { console.log(`  (principal fixture retained: ${e.message.slice(0, 80)} — append-only correction rows reference it)`); }
  await client.end();
  await closePool();
  process.exit(failed > 0 ? 1 : 0);
}
