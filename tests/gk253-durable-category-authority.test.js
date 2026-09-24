// tests/gk253-durable-category-authority.test.js
//
// GK-253 — durable category authority / refresh continuity. GK-249-252
// (U6.0B/C/D) made a real book acceptable end-to-end, but left a real,
// proven UNSAFE gap: a persisted Book's category signal was never written
// to the one durable, server-side field purpose-built for it
// (collection_item.asset_category, db/data0/0026_collection_item.sql —
// defaults to 'comic' when nothing sets it), and /api/enrich never
// resolved that field at all. An ordinary Refresh Market Data / Re-identify
// call on a persisted Book therefore re-derived assetType='comic'
// server-side and could bypass GK-250's economic allowlist.
//
// UPDATED by GK-254 (2026-09-24): GK-253's original mechanism (a bare
// collectionItemId triggered durable-authority resolution) was superseded
// after GK-253's own final pre-push audit (commit d6cedbd) proved two real
// gaps — no auth-failure fail-closed behavior, and asymmetric protection
// (only non-'comic' durable authority was ever protected). The real
// mechanism now lives earlier in api/enrich.js and requires an explicit
// `ownedRefresh`/`ownedReidentify` request-body flag (GK-254 Section A:
// bare collectionItemId presence alone is NOT a safe trigger — bulk
// import's and duplicate-confirm's fire-and-forget post-save enrich calls
// have the exact same shape). This file is updated to match the real,
// current request shapes and log-line prefixes
// (`[owned-asset-authority]`, not the retired `[category-authority]`).
// GK-254's own auth-fail-closed and symmetric-precedence tests live in
// tests/gk254-owned-asset-fail-closed.test.js — this file keeps proving
// GK-253's original scenarios (legacy comic unaffected, missing-row
// fall-through, client-tampering) still hold under the new mechanism.
//
// Real Development gk_principal + real collection_item rows (via the real
// collection module), a real signed HMAC token, and the real
// api/enrich.js default export invoked directly. Every row is cleaned up.
//
// Invoke: node tests/gk253-durable-category-authority.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}
delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const { createCollectionItem, closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertFalse = (cond, label) => assertTrue(!cond, label);
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

console.log('\n=== GK-253 — durable category authority / refresh continuity (real Development DB) ===\n');

const TAG = `gk253-${Date.now()}`;
const PRINCIPAL = randomUUID();
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL, `${TAG}-fixture`]);
const TOKEN = mintTestToken(PRINCIPAL);
const createdIds = [];

async function makeCollectionItem(id, assetCategory, attributes) {
  createdIds.push(id);
  await createCollectionItem({ principalId: PRINCIPAL, id, assetCategory, attributes });
}

async function runOnce({ label, requestBody, bearer, expectFetchComps = false, expectPriceCharting = false }) {
  console.log(`\n--- ${label} ---`);
  const reqTitle = requestBody.title || 'Test Item';
  const reqIssue = requestBody.issue || '';
  const POOL = [
    { itemId: 'v1|990001|0', title: `${reqTitle}${reqIssue ? ` #${reqIssue}` : ''}`.trim(), leafCategoryIds: [requestBody.assetType === 'book' ? '267' : '63'], categories: [{ categoryId: requestBody.assetType === 'book' ? '267' : '63', categoryName: requestBody.assetType === 'book' ? 'Books & Magazines' : 'Comics & Graphic Novels' }], image: { imageUrl: 'https://i.ebayimg.com/x.jpg' }, price: { value: '25.00', currency: 'USD' }, itemHref: 'https://api.ebay.com/buy/browse/v1/item/v1%7C990001%7C0', seller: { username: 'x', feedbackPercentage: '99', feedbackScore: 100 }, condition: 'Good', conditionId: '3000', buyingOptions: ['FIXED_PRICE'], itemWebUrl: 'https://www.ebay.com/itm/990001', itemLocation: { postalCode: '000**', country: 'US' } },
  ];

  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 200));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: POOL, total: POOL.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: POOL, total: POOL.length });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js?t=' + label.replace(/\W+/g, '_') + '_' + Date.now());
  const handler = handlerModule.default;
  const req = { method: 'POST', headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, body: requestBody };
  let capturedStatus = null, capturedBody = null;
  const res = { status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }), setHeader: () => {} };

  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  const compsSearchCalls = fetchLog.filter((u) => u.includes('item_summary/search') && !u.includes('search_by_image'));
  const pcCalls = fetchLog.filter((u) => u.includes('pricecharting.com'));
  if (expectFetchComps) assertTrue(compsSearchCalls.length > 0, `fetchComps DID execute, as expected (count=${compsSearchCalls.length})`);
  else assertTrue(compsSearchCalls.length === 0, `fetchComps did NOT execute (fetchLog sample: ${JSON.stringify(fetchLog.slice(0, 5))})`);
  if (expectPriceCharting) assertTrue(pcCalls.length > 0, `PriceCharting DID execute, as expected (count=${pcCalls.length})`);
  else assertTrue(pcCalls.length === 0, 'PriceCharting did NOT execute');

  return { body: capturedBody, logs: capturedLogs };
}

try {
  // ═══ J1 — Fresh Book -> persist -> reopen -> Refresh Market Data -> remains Book, fresh REFUSED ═══
  {
    const id = `${TAG}-j1`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists', author: 'Test Author', issue: null });
    const { body, logs } = await runOnce({
      label: 'J1 refresh on persisted Book',
      bearer: TOKEN,
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] pinning')), 'the durable-authority pin fired for this request');
    assertEq(body?.assetType, 'book', 'out.assetType forced to durable "book" despite no book signal in this request');
    assertEq(body?.categoryAuthoritySource, 'durable-collection-item', 'out.categoryAuthoritySource marks this as durable-authority-derived');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true');
    assertEq(body?.contract?.state, 'REFUSED', 'contract.state === REFUSED, freshly assembled this request');
    assertEq(body?.price, null, 'price stays null');
    assertEq(body?.contract?.listable, false, 'contract.listable === false');
    assertFalse(String(body?.decision?.action || '').startsWith('LIST'), 'decision.action does not start with LIST');
  }

  // ═══ J2 — Persisted Book -> Re-identify with Book classification -> remains Book ═══
  {
    const id = `${TAG}-j2`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists', author: 'Test Author' });
    const { body } = await runOnce({
      label: 'J2 re-identify agrees (book)',
      bearer: TOKEN,
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        collectionItemId: id, ownedReidentify: true,
      },
    });
    assertEq(body?.assetType, 'book', 'stays book (pipeline and durable authority agree)');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true');
  }

  // ═══ J3 — Persisted Book -> Re-identify with CONFLICTING Comic classification -> held, not silently comic-priced ═══
  {
    const id = `${TAG}-j3`;
    await makeCollectionItem(id, 'book', { title: 'Some Confused Scan' });
    const { body, logs } = await runOnce({
      label: 'J3 re-identify conflicts (comic-shaped evidence)',
      bearer: TOKEN,
      requestBody: {
        title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel',
        collectionItemId: id, ownedReidentify: true,
      },
      expectFetchComps: false,
      expectPriceCharting: true, // pre-existing, unrelated identity/year PC call — see GK-253's own disclosed note
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] RE-IDENTIFY CONFLICT')), 'conflict detected and logged');
    assertEq(body?.assetType, 'book', 'durable "book" authority preserved despite this request\'s own comic-shaped identification');
    assertEq(body?.categoryConflict?.durable, 'book', 'categoryConflict.durable records the preserved value');
    assertEq(body?.categoryConflict?.freshlyDerived, 'comic', 'categoryConflict.freshlyDerived records what this request actually derived');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true -- conflict cannot unlock economics');
    assertEq(body?.pricingSource, 'refused-category-reidentify-conflict', 'the dedicated conflict pricingSource, not the generic allowlist one');
    assertEq(body?.contract?.state, 'REFUSED', 'contract.state === REFUSED (hold/review, not silently comic-priced)');
  }

  // ═══ J4 / H — Persisted Book + client sends assetType:'comic' (tampering attempt) -> server ignores it ═══
  {
    const id = `${TAG}-j4`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const { body, logs } = await runOnce({
      label: 'J4/H client-tampering: assetType=comic in request body',
      bearer: TOKEN,
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        assetType: 'comic', // <-- the tampering attempt
        skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] pinning')), 'durable pin fired against the client-supplied value');
    assertEq(body?.assetType, 'book', 'server-resolved durable authority wins over the client-supplied assetType="comic"');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true -- client cannot self-authorize economics');
    assertEq(body?.contract?.listable, false, 'listable stays false');
  }

  // ═══ J5 — Legacy Production-shaped Comic (asset_category='comic', attributes.assetType=null) -> unchanged ═══
  {
    const id = `${TAG}-j5`;
    await makeCollectionItem(id, 'comic', { title: 'Weird War Tales', issue: '64', author: null });
    const { body } = await runOnce({
      label: 'J5 legacy comic row, ordinary comic refresh',
      bearer: TOKEN,
      requestBody: {
        title: 'Weird War Tales', issue: '64', grade: 'Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1978', publisher: 'DC',
        skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
      expectFetchComps: true,
      expectPriceCharting: true,
    });
    assertEq(body?.assetType, 'comic', 'stays comic -- durable "comic" authority pins to comic, same outcome as before');
    assertEq(body?.categoryAuthoritySource, 'durable-collection-item', 'now DOES stamp categoryAuthoritySource (GK-254 pins symmetrically, unlike the old GK-253 non-comic-only override)');
    assertTrue(body?.pricingSource !== 'refused-category-pricing-not-authorized', 'refusal (if any) is not from the category allowlist');
  }

  // ═══ J6 — Missing-category durable row (asset_category='generic', U4 track) -> NEVER defaults to comic economics ═══
  {
    const id = `${TAG}-j6`;
    await makeCollectionItem(id, 'generic', { title: 'Unidentified Collectible' });
    const { body, logs } = await runOnce({
      label: 'J6 durable generic row -- never defaults to comic',
      bearer: TOKEN,
      requestBody: {
        title: 'Unidentified Collectible', issue: null, grade: null, confidence: 'high',
        isGraded: false, numericGrade: null, year: null, publisher: null,
        skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] pinning')), 'durable "generic" authority resolved and pinned');
    assertEq(body?.assetType, 'generic', 'assetType forced to durable "generic"');
    assertTrue(body?.refusedToPrice === true, 'refused -- generic never reaches comic economics');
  }

  // ═══ J7 — bare collectionItemId, NO ownedRefresh/ownedReidentify flag (bulk-import/duplicate-confirm shape) -> untouched ═══
  {
    const id = `${TAG}-j7`;
    await makeCollectionItem(id, 'book', { title: 'A Real Owned Book' });
    const { body, logs } = await runOnce({
      label: 'J7 bare collectionItemId, no flag -- fresh-save shape, must NOT trigger owned-asset logic',
      bearer: TOKEN,
      requestBody: {
        title: 'A Real Owned Book', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, publisher: null,
        collectionItemId: id, // real durable row exists, but NEITHER flag is set
      },
      expectFetchComps: true, // correctly proceeds as an ordinary comic request -- this IS the desired behavior for a fresh-save shape
    });
    assertFalse(!!logs.find((l) => l.startsWith('[owned-asset-authority]')), 'GK-254 owned-asset logic never even attempted -- this is deliberately the bulk-import/duplicate-confirm/fresh-scan shape, per Section A');
    assertEq(body?.assetType, 'comic', 'falls through entirely to pipeline-derived value (comic default), unaffected by the real durable "book" row');
  }

  // ═══ No bearer token, but ownedRefresh:true and a REAL durable row -- now FAILS CLOSED (GK-254), not silently ignored ═══
  {
    const { body, logs } = await runOnce({
      label: 'ownedRefresh:true, no token -- fails closed (superseded GK-253 behavior)',
      bearer: null,
      requestBody: {
        title: 'The Rationalists', grade: null, confidence: 'high',
        isGraded: false, numericGrade: null, publisher: null,
        skipImageSearch: true, collectionItemId: `${TAG}-j1`, ownedRefresh: true,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] FAIL CLOSED')), 'fails closed, logged');
    assertTrue(body?.ownedAssetAuthRequired === true, 'ownedAssetAuthRequired stamped for the client to detect');
    assertTrue(body?.refusedToPrice === true, 'refused, not merely reverted to pipeline-derived assetType');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
  }
} finally {
  if (createdIds.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [PRINCIPAL, createdIds]);
  await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL]);
  await client.end();
  await closePool();
  process.exit(failed > 0 ? 1 : 0);
}
