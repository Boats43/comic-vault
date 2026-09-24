// tests/gk253-durable-category-authority.test.js
//
// GK-253 — durable category authority / refresh continuity. GK-249-252
// (U6.0B/C/D) made a real book acceptable end-to-end, but left a real,
// proven UNSAFE gap: a persisted Book's category signal was never written
// to the one durable, server-side field purpose-built for it
// (collection_item.asset_category, db/data0/0026_collection_item.sql —
// defaults to 'comic' when nothing sets it), and /api/enrich never
// resolved that field at all (collectionItemId was read but explicitly
// documented as "MEASUREMENT-ONLY... drives no identity, pricing, or
// decision logic"). An ordinary Refresh Market Data / Re-identify call on
// a persisted Book therefore re-derived assetType='comic' server-side and
// could bypass GK-250's economic allowlist, replacing the earlier REFUSED
// contract with a real, unlocked one.
//
// This file proves the fix through REAL execution, not hand-constructed
// shapes, per this repo's own standing rule: a real Development gk_principal
// + real collection_item rows (created via the real collection module,
// src/modules/collection/index.js), a real signed HMAC token (same
// mintTestToken convention as tests/collection-endpoint-live-proof.test.js),
// and the real api/enrich.js default export invoked directly (same
// fetch-mocking convention as tests/gk250-book-enrich-handler-smoke.test.js).
// Every row this file creates is cleaned up in a finally block; nothing
// pre-existing is touched.
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
  // Pool titles mirror the REQUEST's own title/issue so real title-
  // similarity/issue-match filtering in comps.js doesn't reject everything
  // as a wrong-book mismatch -- keeps each case's pricing behavior
  // attributable to the category-authority logic under test, not an
  // incidental comp-pool/title mismatch.
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
    // Refresh Market Data's real shape: skipImageSearch:true, no assetType
    // field at all, no book signals in the bare title -- WITHOUT durable
    // authority this would derive assetType='comic'.
    const { body, logs } = await runOnce({
      label: 'J1 refresh on persisted Book',
      bearer: TOKEN,
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        skipImageSearch: true, collectionItemId: id,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[category-authority]') && l.includes('durable=\"book\"')), 'the [category-authority] override genuinely fired for this request');
    assertEq(body?.assetType, 'book', 'out.assetType forced to durable "book" despite no book signal in this request');
    assertEq(body?.categoryAuthoritySource, 'durable-collection-item', 'out.categoryAuthoritySource marks this as durable-authority-derived');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true');
    assertEq(body?.contract?.state, 'REFUSED', 'contract.state === REFUSED, freshly assembled this request (J8)');
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
        assetType: 'book', collectionItemId: id,
      },
    });
    assertEq(body?.assetType, 'book', 'stays book (pipeline and durable authority agree)');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true');
  }

  // ═══ J3 — Persisted Book -> Re-identify with CONFLICTING Comic classification -> cannot unlock economics ═══
  {
    const id = `${TAG}-j3`;
    await makeCollectionItem(id, 'book', { title: 'Some Confused Scan' });
    const { body, logs } = await runOnce({
      label: 'J3 re-identify conflicts (comic-shaped evidence)',
      bearer: TOKEN,
      // A genuinely comic-shaped identification this time -- title+issue+
      // publisher, no book signals -- what a fresh Vision call disagreeing
      // with the established authority would look like.
      requestBody: {
        title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel',
        collectionItemId: id,
      },
      expectFetchComps: false, // still refused -- durable authority wins, no comic economics unlock
      // PRE-EXISTING, NOT a GK-253 behavior: PriceCharting is queried during
      // IDENTITY/year resolution whenever `issue` is present (CLAUDE.md:
      // "PriceCharting skipped when issue=null"), before GK-250's allowlist
      // gate and independent of category. This call's result never reaches
      // out.price/out.comps for a refused category (both are explicitly
      // nulled by the allowlist gate regardless) -- disclosed in the GK-253
      // report's Section K rather than silently hidden by a wrong
      // expectation here.
      expectPriceCharting: true,
    });
    assertTrue(!!logs.find((l) => l.startsWith('[category-authority]')), 'durable override fired');
    assertEq(body?.assetType, 'book', 'durable "book" authority preserved despite this request\'s own comic-shaped identification');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true -- conflict cannot unlock comic economics');
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
        collectionItemId: id,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[category-authority]')), 'durable override fired against the client-supplied value');
    assertEq(body?.assetType, 'book', 'server-resolved durable authority wins over the client-supplied assetType="comic"');
    assertTrue(body?.refusedToPrice === true, 'refusedToPrice === true -- client cannot self-authorize economics');
    assertEq(body?.contract?.listable, false, 'listable stays false');
  }

  // ═══ J5 — Legacy Production-shaped Comic (asset_category='comic', attributes.assetType=null) -> unchanged ═══
  {
    const id = `${TAG}-j5`;
    await makeCollectionItem(id, 'comic', { title: 'Weird War Tales', issue: '64', author: null });
    const { body } = await runOnce({
      label: 'J5 legacy comic row, ordinary comic request',
      bearer: TOKEN,
      requestBody: {
        title: 'Weird War Tales', issue: '64', grade: 'Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1978', publisher: 'DC',
        collectionItemId: id,
      },
      expectFetchComps: true, // durable='comic' -> no override -> normal comic economics run
      expectPriceCharting: true, // issue present -> PC identity/year-resolution call, unrelated to category
    });
    assertEq(body?.assetType, 'comic', 'stays comic -- durable "comic" authority never overrides anything');
    assertTrue(body?.categoryAuthoritySource === undefined, 'no categoryAuthoritySource stamp -- this was never an override');
    // Same disclosed, pre-existing GK-238 thin-fixture behavior as the
    // final comic-regression case below -- the meaningful proof is that
    // whatever refusal (if any) occurs is NOT the category allowlist and
    // NOT a GK-253 override.
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
        collectionItemId: id,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[category-authority]') && l.includes('durable=\"generic\"')), 'durable "generic" authority resolved and overrides');
    assertEq(body?.assetType, 'generic', 'assetType forced to durable "generic"');
    assertTrue(body?.refusedToPrice === true, 'refused -- generic never reaches comic economics');
  }

  // ═══ J7 — No durable row at all (brand-new scan, race / never persisted) -> falls through safely, merchandise still refused ═══
  {
    const { body, logs } = await runOnce({
      label: 'J7 no durable row (fresh scan race) -- merchandise still refused by GK-250',
      bearer: TOKEN,
      requestBody: {
        title: 'Test Merchandise Item', assetType: 'merchandise', grade: null, confidence: 'high',
        isGraded: false, numericGrade: null, publisher: null,
        collectionItemId: `${TAG}-never-created`, // does not exist -> NotFoundError, caught, non-fatal
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[category-authority] durable resolution unavailable')), 'missing row handled gracefully, logged, non-fatal');
    assertEq(body?.assetType, 'merchandise', 'falls through to pipeline-derived value');
    assertTrue(body?.refusedToPrice === true, 'GK-250s pre-existing allowlist still refuses merchandise on its own');
  }

  // ═══ No bearer token at all -- durable resolution never attempted, existing anonymous behavior unchanged ═══
  {
    const { body, logs } = await runOnce({
      label: 'anonymous request, collectionItemId present but no token -- no DB call attempted',
      bearer: null,
      requestBody: {
        title: 'The Rationalists', assetType: 'book', grade: null, confidence: 'high',
        isGraded: false, numericGrade: null, publisher: null,
        collectionItemId: `${TAG}-j1`, // a REAL row (from J1) -- must NOT be reachable without a token
      },
    });
    assertFalse(!!logs.find((l) => l.startsWith('[category-authority] durable authority overrides')), 'no override attempted without a valid bearer token, even though a real durable row exists under this id');
    assertEq(body?.assetType, 'book', 'still book here only because the request itself already said so (pipeline-derived), not durable authority');
  }

  // ═══ Comic regression: ordinary comic, no collectionItemId at all (the overwhelming majority of traffic) ═══
  {
    const { body } = await runOnce({
      label: 'ordinary comic scan, no collectionItemId',
      bearer: null,
      requestBody: {
        title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel',
      },
      expectFetchComps: true,
      expectPriceCharting: true,
    });
    assertEq(body?.assetType, 'comic', 'ordinary comic scan totally unaffected');
    // The full economic pipeline genuinely ran (fetchComps + PC executed,
    // matchConfidence computed above) -- this thin 1-comp mocked fixture
    // then correctly hits the real, PRE-EXISTING GK-238 "insufficient
    // verified comps" guard (pricingSource='refused-tier-bypass-detected',
    // warnings:['no-sold-candidates']), completely unrelated to category
    // authority. The regression proof that matters here is that this is
    // NOT GK-250's allowlist and NOT a GK-253 override.
    assertTrue(body?.pricingSource !== 'refused-category-pricing-not-authorized', 'refusal (if any) is not from the category allowlist');
    assertTrue(body?.categoryAuthoritySource === undefined, 'no GK-253 override touched this request at all');
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
