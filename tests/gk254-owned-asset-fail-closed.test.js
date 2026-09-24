// tests/gk254-owned-asset-fail-closed.test.js
//
// GK-254 — owned-asset authority fail-closed + symmetric category
// continuity. Closes the two real gaps GK-253's own final pre-push audit
// (commit d6cedbd) found and proved: (1) an owned-asset refresh/
// re-identify with missing/expired auth silently fell through to
// stateless category derivation instead of failing closed; (2) durable
// category protection only ever worked in the non-'comic' direction, so
// a real Comic's own fresh, per-request book/merchandise derivation could
// still flip it, incorrectly refusing normal Comic economics.
//
// Sections F, G, H from the governing GK-254 dispatch, proven through REAL
// execution: real Development gk_principal + real collection_item rows
// (the real collection module), a real signed HMAC token, and the real,
// unmodified api/enrich.js handler invoked directly. No hand-constructed
// terminal safety objects — every REFUSED/conflict/economic-proceeding
// state here is produced by the real handler's own code paths.
//
// Invoke: node tests/gk254-owned-asset-fail-closed.test.js

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

function mintExpiredTestToken(principalId) {
  // A genuinely EXPIRED token (exp in the past), HMAC-valid otherwise --
  // proves the server rejects it on expiry, not merely on a missing
  // header (distinct failure mode from "no bearer at all").
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now - 13 * 60 * 60 * 1000, exp: now - 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

console.log('\n=== GK-254 — owned-asset fail-closed + symmetric category continuity (real Development DB) ===\n');

const TAG = `gk254-${Date.now()}`;
const PRINCIPAL = randomUUID();
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL, `${TAG}-fixture`]);
const TOKEN = mintTestToken(PRINCIPAL);
const EXPIRED_TOKEN = mintExpiredTestToken(PRINCIPAL);
const createdIds = [];

async function makeCollectionItem(id, assetCategory, attributes) {
  createdIds.push(id);
  await createCollectionItem({ principalId: PRINCIPAL, id, assetCategory, attributes });
}

async function readAssetCategory(id) {
  const res = await client.query('SELECT asset_category FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, id]);
  return res.rows[0]?.asset_category ?? null;
}

async function runOnce({ label, requestBody, bearer, pool = [], expectFetchComps = false, expectPriceCharting = null }) {
  console.log(`\n--- ${label} ---`);
  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 200));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: pool, total: pool.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: pool, total: pool.length });
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
  if (expectFetchComps) assertTrue(compsSearchCalls.length > 0, `fetchComps DID execute, as expected (count=${compsSearchCalls.length})`);
  else assertTrue(compsSearchCalls.length === 0, `fetchComps did NOT execute (H — no economic output created)`);

  return { body: capturedBody, logs: capturedLogs, fetchLog };
}

try {
  // ═══════════════════════════════════════════════════════════════════
  // SECTION F — auth failure real-path tests
  // ═══════════════════════════════════════════════════════════════════

  // F1 — Persisted owned Book + Refresh Market Data + valid auth -> durable Book resolved -> remains Book -> fresh REFUSED
  {
    const id = `${TAG}-f1`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const { body } = await runOnce({
      label: 'F1 owned Book, valid auth, ordinary refresh',
      bearer: TOKEN,
      requestBody: { title: 'The Rationalists', grade: 'Very Good', confidence: 'high', isGraded: false, numericGrade: null, skipImageSearch: true, collectionItemId: id, ownedRefresh: true },
    });
    assertEq(body?.assetType, 'book', 'remains Book');
    assertTrue(body?.refusedToPrice === true, 'fresh REFUSED');
    assertEq(body?.contract?.state, 'REFUSED', 'contract.state REFUSED');
  }

  // F2 — Persisted owned Book + Refresh + missing auth -> fail closed, no stateless derivation, no comps/pricing/decision
  {
    const id = `${TAG}-f2`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const { body, logs } = await runOnce({
      label: 'F2 owned Book, MISSING auth, ordinary refresh -> fail closed',
      bearer: null,
      requestBody: { title: 'The Rationalists', grade: 'Very Good', confidence: 'high', isGraded: false, numericGrade: null, skipImageSearch: true, collectionItemId: id, ownedRefresh: true },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] FAIL CLOSED')), 'fails closed');
    assertTrue(body?.ownedAssetAuthRequired === true, 'ownedAssetAuthRequired stamped');
    assertTrue(body?.refusedToPrice === true, 'refused');
    assertEq(body?.price, null, 'no price');
    assertEq(body?.comps, null, 'no comps');
    assertFalse(String(body?.decision?.action || '').startsWith('LIST'), 'no LIST decision');
    assertEq(body?.contract?.listable, false, 'not listable');
  }

  // F2b — same, but EXPIRED (not merely absent) token -- distinct failure mode
  {
    const id = `${TAG}-f2b`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const { body, logs } = await runOnce({
      label: 'F2b owned Book, EXPIRED auth, ordinary refresh -> fail closed',
      bearer: EXPIRED_TOKEN,
      requestBody: { title: 'The Rationalists', grade: 'Very Good', confidence: 'high', isGraded: false, numericGrade: null, skipImageSearch: true, collectionItemId: id, ownedRefresh: true },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] FAIL CLOSED')), 'fails closed on a genuinely expired (not merely absent) token');
    assertTrue(body?.ownedAssetAuthRequired === true, 'ownedAssetAuthRequired stamped');
  }

  // F3 — Persisted owned COMIC + Refresh + missing auth -> ALSO fails closed (does not reinterpret category, does not silently fall through to normal comic economics either)
  {
    const id = `${TAG}-f3`;
    await makeCollectionItem(id, 'comic', { title: 'Amazing Spider-Man', issue: '300' });
    const { body, logs, fetchLog } = await runOnce({
      label: 'F3 owned Comic, MISSING auth, ordinary refresh -> fails closed too',
      bearer: null,
      requestBody: { title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high', isGraded: false, numericGrade: null, skipImageSearch: true, collectionItemId: id, ownedRefresh: true },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] FAIL CLOSED')), 'fails closed for a COMIC too -- server cannot verify authority without auth, regardless of what the category would have turned out to be');
    assertTrue(body?.ownedAssetAuthRequired === true, 'ownedAssetAuthRequired stamped');
    const compsSearchCalls = fetchLog.filter((u) => u.includes('item_summary/search') && !u.includes('search_by_image'));
    assertEq(compsSearchCalls.length, 0, 'no comps fetch attempted even though the underlying item is a real Comic');
  }

  // F4 — Re-identify Book + missing auth -> fails closed before durable authority can be bypassed
  {
    const id = `${TAG}-f4`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const { body, logs } = await runOnce({
      label: 'F4 owned Book, MISSING auth, re-identify -> fails closed before any conflict logic runs',
      bearer: null,
      requestBody: { title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high', isGraded: false, numericGrade: null, publisher: 'Marvel', collectionItemId: id, ownedReidentify: true },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] FAIL CLOSED')), 'fails closed');
    assertFalse(!!logs.find((l) => l.startsWith('[owned-asset-authority] RE-IDENTIFY CONFLICT')), 'the conflict-check never runs -- auth failure is checked first, unconditionally');
    assertTrue(body?.ownedAssetAuthRequired === true, 'ownedAssetAuthRequired stamped');
  }

  // F5 — Fresh normal Scan + missing auth -> UNCHANGED (Section A's explicit scope decision: neither flag is ever set by a real fresh-scan call site, so this new logic must never even attempt to apply)
  {
    const { body, logs } = await runOnce({
      label: 'F5 fresh normal Scan, missing auth -> completely unaffected (Section A scope)',
      bearer: null,
      requestBody: { title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high', isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel' }, // no collectionItemId, no ownedRefresh/ownedReidentify -- the real gradeBlob-without-a-saved-item shape
      expectFetchComps: true,
    });
    assertFalse(!!logs.find((l) => l.startsWith('[owned-asset-authority]')), 'GK-254 logic never even attempted for a fresh scan');
    assertFalse(body?.ownedAssetAuthRequired === true, 'ownedAssetAuthRequired never stamped');
    assertEq(body?.assetType, 'comic', 'ordinary comic scan proceeds exactly as before this dispatch');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION G — symmetric category tests
  // ═══════════════════════════════════════════════════════════════════

  // G1 — Durable Book + fresh Comic evidence on ordinary refresh -> final category Book, new REFUSED
  {
    const id = `${TAG}-g1`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const before = await readAssetCategory(id);
    const { body } = await runOnce({
      label: 'G1 durable Book, ordinary refresh with comic-shaped request text',
      bearer: TOKEN,
      // A comic-shaped title+issue, but this is an ORDINARY REFRESH
      // (ownedRefresh), not a re-identify -- the durable pin must apply
      // BEFORE any speculative per-request derivation even has a chance
      // to disagree.
      requestBody: { title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high', isGraded: false, numericGrade: null, publisher: 'Marvel', skipImageSearch: true, collectionItemId: id, ownedRefresh: true },
    });
    assertEq(body?.assetType, 'book', 'final category is Book -- durable authority wins outright on ordinary refresh');
    assertTrue(body?.refusedToPrice === true, 'new REFUSED');
    const after = await readAssetCategory(id);
    assertEq(after, before, 'collection_item.asset_category itself is byte-unchanged by this refresh (G5)');
  }

  // G2 — Durable Comic + fresh Book title evidence on ordinary refresh -> final category Comic, ordinary Comic economics remain available
  {
    const id = `${TAG}-g2`;
    await makeCollectionItem(id, 'comic', { title: 'Amazing Spider-Man', issue: '300' });
    const before = await readAssetCategory(id);
    const { body } = await runOnce({
      label: 'G2 durable Comic, ordinary refresh with book-signal title text',
      bearer: TOKEN,
      requestBody: {
        title: 'Amazing Spider-Man Omnibus Collected Edition Hardcover', issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, publisher: 'Marvel', skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
      expectFetchComps: true, // final category is Comic -- ordinary economics proceed
    });
    assertEq(body?.assetType, 'comic', 'final category is Comic -- durable authority wins outright, the speculative title-signal derivation never even runs (durableAuthorityPinned guard)');
    assertFalse(body?.pricingSource === 'refused-category-pricing-not-authorized', 'not refused by the category allowlist');
    const after = await readAssetCategory(id);
    assertEq(after, before, 'collection_item.asset_category itself is byte-unchanged (G5)');
  }

  // G3 — Durable Book + Re-identify derives Comic -> durable Book retained, conflict state, economics held/refused
  {
    const id = `${TAG}-g3`;
    await makeCollectionItem(id, 'book', { title: 'Some Confused Scan' });
    const { body } = await runOnce({
      label: 'G3 durable Book, re-identify derives Comic',
      bearer: TOKEN,
      requestBody: { title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high', isGraded: false, numericGrade: null, publisher: 'Marvel', collectionItemId: id, ownedReidentify: true },
      expectPriceCharting: true,
    });
    assertEq(body?.assetType, 'book', 'durable Book retained');
    assertEq(body?.categoryConflict?.durable, 'book', 'conflict recorded');
    assertEq(body?.categoryConflict?.freshlyDerived, 'comic', 'freshlyDerived recorded');
    assertTrue(body?.refusedToPrice === true, 'held/refused');
  }

  // G4 — Durable Comic + Re-identify derives Book -> durable Comic retained, conflict state, economics held/refused
  {
    const id = `${TAG}-g4`;
    await makeCollectionItem(id, 'comic', { title: 'Amazing Spider-Man', issue: '300' });
    const { body } = await runOnce({
      label: 'G4 durable Comic, re-identify derives Book',
      bearer: TOKEN,
      requestBody: {
        title: 'Amazing Spider-Man Omnibus Collected Edition Hardcover', issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, publisher: 'Marvel', collectionItemId: id, ownedReidentify: true,
      },
    });
    assertEq(body?.assetType, 'comic', 'durable Comic retained');
    assertEq(body?.categoryConflict?.durable, 'comic', 'conflict recorded');
    assertEq(body?.categoryConflict?.freshlyDerived, 'book', 'freshlyDerived recorded');
    assertTrue(body?.refusedToPrice === true, 'held/refused -- normal Comic economics do NOT silently continue under an unresolved conflict');
  }

  // G6 — No request-body assetType can override durable authority (ownedReidentify variant; ownedRefresh variant already covered in gk253-durable-category-authority.test.js's J4)
  {
    const id = `${TAG}-g6`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists' });
    const { body } = await runOnce({
      label: 'G6 client-tampering on a re-identify request',
      bearer: TOKEN,
      requestBody: {
        title: 'The Rationalists', grade: 'Very Good', confidence: 'high', isGraded: false, numericGrade: null,
        assetType: 'comic', // tampering attempt
        collectionItemId: id, ownedReidentify: true,
      },
    });
    assertEq(body?.assetType, 'book', 'durable authority wins over the client-supplied assetType');
    assertTrue(body?.refusedToPrice === true, 'refused -- no self-authorized economics');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION H — economic consequence check, valid-auth durable Comic control
  // ═══════════════════════════════════════════════════════════════════
  {
    const id = `${TAG}-h-control`;
    await makeCollectionItem(id, 'comic', { title: 'Amazing Spider-Man', issue: '300' });
    const POOL = [
      { itemId: 'v1|1|0', title: 'Amazing Spider-Man #300', leafCategoryIds: ['63'], categories: [{ categoryId: '63', categoryName: 'Comics & Graphic Novels' }], image: { imageUrl: 'https://i.ebayimg.com/x.jpg' }, price: { value: '150.00', currency: 'USD' }, itemHref: 'https://api.ebay.com/buy/browse/v1/item/v1%7C1%7C0', seller: { username: 'x', feedbackPercentage: '99', feedbackScore: 100 }, condition: 'Used', conditionId: '3000', buyingOptions: ['FIXED_PRICE'], itemWebUrl: 'https://www.ebay.com/itm/1', itemLocation: { postalCode: '000**', country: 'US' } },
    ];
    const { body } = await runOnce({
      label: 'H control -- valid-auth durable Comic refresh, existing economics unchanged',
      bearer: TOKEN,
      pool: POOL,
      requestBody: { title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high', isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel', skipImageSearch: true, collectionItemId: id, ownedRefresh: true },
      expectFetchComps: true,
    });
    assertEq(body?.assetType, 'comic', 'stays comic');
    assertFalse(body?.pricingSource === 'refused-category-pricing-not-authorized', 'not refused by the category allowlist');
    assertFalse(body?.pricingSource === 'refused-owned-asset-auth-required', 'not refused for auth reasons -- valid token');
    assertFalse(body?.pricingSource === 'refused-category-reidentify-conflict', 'not a conflict refusal -- this is ordinary refresh, not re-identify');
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
