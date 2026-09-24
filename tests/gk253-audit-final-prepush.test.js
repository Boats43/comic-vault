// tests/gk253-audit-final-prepush.test.js
//
// GK-253 FINAL PRE-PUSH UNIVERSAL AUTHORITY AUDIT (2026-09-24) — originally
// a TEST-ONLY commit (d6cedbd) proving two real, distinct gaps in GK-253's
// original durable-category-authority mechanism via genuine execution,
// per the governing audit's "DO NOT MODIFY APPLICATION CODE DURING THIS
// AUDIT" instruction. Both gaps were FIXED by GK-254 (2026-09-24,
// api/enrich.js) — this file is UPDATED, not rewritten, to prove the fix:
// the narrative below documents what was originally found (kept verbatim
// as the historical record), and every assertion now proves the CURRENT,
// fixed behavior rather than the original bug.
//
// GAP 1 (originally: Section 1 of the audit — auth plumbing). ORIGINAL
// FINDING: the durable-authority resolution block required a valid Bearer
// token to ever run at all. The real client session token has a fixed 12h
// TTL with no refresh mechanism (src/modules/auth/token.js:31,
// src/lib/grailkeySession.js's own header comment) and the top-level
// `grailkeyAuthed` React state that gates the whole app is only set once
// at mount / on explicit logout -- it does NOT re-check on every request.
// A real owned Book, refreshed after the session token had silently
// expired mid-session, sent collectionItemId with NO usable Authorization
// header -- the durable override silently never attempted the DB read,
// falling through to the pre-GK-253 vulnerable behavior. GK-254 FIX:
// ownedRefresh/ownedReidentify requests with unresolvable auth now FAIL
// CLOSED (ownedAssetAuthRequired:true, refusedToPrice:true), never fall
// through.
//
// GAP 2 (originally: Section 3 of the audit — asymmetric protection).
// ORIGINAL FINDING: GK-253's override only fired when the resolved
// durable category was non-'comic' -- a real, established Comic's own
// pre-existing, independent book-vs-comic derivation
// (api/enrich.js:3828-3847) could still flip out.assetType to 'book' for
// one request, REFUSING a real Comic's economics, with zero protection in
// the other direction. GK-254 FIX: for ownedRefresh, durable authority is
// now PINNED before that speculative derivation ever runs, in either
// direction (durableAuthorityPinned guards both derivation sites).
//
// Same real-Development-DB / real-principal-and-token / real-handler
// convention as tests/gk253-durable-category-authority.test.js.
//
// Invoke: node tests/gk253-audit-final-prepush.test.js

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

console.log('\n=== GK-253 FINAL AUDIT — real gap proofs (real Development DB) ===\n');

const TAG = `gk253-audit-${Date.now()}`;
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

async function runOnce({ label, requestBody, bearer, pool }) {
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

  return { body: capturedBody, logs: capturedLogs };
}

try {
  // ═══════════════════════════════════════════════════════════════════
  // GAP 1 — auth-plumbing hole: real durable Book, no Authorization header
  // ═══════════════════════════════════════════════════════════════════
  {
    const id = `${TAG}-gap1`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists', author: 'Test Author' });

    // The real refreshMarketData-shaped request, INCLUDING the ownedRefresh
    // flag GK-254 introduced, but with NO Authorization header at all --
    // exactly what getVaultHeaders() sends once the 12h session token has
    // expired while grailkeyAuthed (React state) remains stuck true.
    const { body, logs } = await runOnce({
      label: 'GAP1 (FIXED) durable book, expired/missing session token',
      bearer: null, // no Bearer token, even though this targets a REAL durable Book row
      pool: [],
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
    });

    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] FAIL CLOSED')), 'FIXED: fails closed and logs it, rather than silently falling through');
    assertTrue(body?.ownedAssetAuthRequired === true, 'FIXED: ownedAssetAuthRequired stamped for the client to detect and force re-login');
    assertTrue(body?.refusedToPrice === true, 'FIXED: refused outright -- a real owned Book can no longer reach comic-calibrated economics merely because its session quietly expired');
    assertEq(body?.contract?.listable, false, 'FIXED: listable stays false');
  }

  // Control: the SAME durable book row, SAME request, but WITH a valid
  // token -- proves the pin still works correctly when auth is present.
  {
    const id = `${TAG}-gap1-control`;
    await makeCollectionItem(id, 'book', { title: 'The Rationalists', author: 'Test Author' });
    const { body, logs } = await runOnce({
      label: 'GAP1 control -- same request, valid token present',
      bearer: TOKEN,
      pool: [],
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        skipImageSearch: true, collectionItemId: id, ownedRefresh: true,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] pinning')), 'control: the pin DOES fire with a valid token -- confirms Gap 1\'s fix is specifically about the auth precondition, not a defect in the resolution logic itself');
    assertEq(body?.assetType, 'book', 'control: stays book with a valid token');
    assertTrue(body?.refusedToPrice === true, 'control: correctly refused with a valid token');
  }

  // ═══════════════════════════════════════════════════════════════════
  // GAP 2 — asymmetric protection: durable Comic can still flip to Book
  // from this request's OWN fresh image-search evidence (real,
  // pre-existing api/enrich.js:3828-3847 mechanism, independent of any
  // client-supplied assetType), because GK-253's override never fires for
  // a durable 'comic' value.
  // ═══════════════════════════════════════════════════════════════════
  {
    const id = `${TAG}-gap2`;
    await makeCollectionItem(id, 'comic', { title: 'Amazing Spider-Man', issue: '300' });

    // A real reIdentifyBook-shaped request: no skipImageSearch (a genuine
    // fresh image-search pass runs), no assetType in the body (matches the
    // real reIdentifyBook request shape exactly). The mocked eBay pool is
    // deliberately >=50% "Books & Magazines" category -- exactly the real,
    // pre-existing ebaySaysBook threshold this dispatch did not touch.
    const BOOK_DOMINANT_POOL = [
      { itemId: 'v1|1|0', title: 'Some Random Book', leafCategoryIds: ['267'], categories: [{ categoryId: '267', categoryName: 'Books & Magazines' }], image: { imageUrl: 'https://i.ebayimg.com/x.jpg' }, price: { value: '9.99', currency: 'USD' }, itemHref: 'https://api.ebay.com/buy/browse/v1/item/v1%7C1%7C0', seller: { username: 'x', feedbackPercentage: '99', feedbackScore: 100 }, condition: 'Good', conditionId: '3000', buyingOptions: ['FIXED_PRICE'], itemWebUrl: 'https://www.ebay.com/itm/1', itemLocation: { postalCode: '000**', country: 'US' } },
      { itemId: 'v1|2|0', title: 'Another Random Book', leafCategoryIds: ['267'], categories: [{ categoryId: '267', categoryName: 'Books & Magazines' }], image: { imageUrl: 'https://i.ebayimg.com/y.jpg' }, price: { value: '12.99', currency: 'USD' }, itemHref: 'https://api.ebay.com/buy/browse/v1/item/v1%7C2%7C0', seller: { username: 'x', feedbackPercentage: '99', feedbackScore: 100 }, condition: 'Good', conditionId: '3000', buyingOptions: ['FIXED_PRICE'], itemWebUrl: 'https://www.ebay.com/itm/2', itemLocation: { postalCode: '000**', country: 'US' } },
    ];

    const { body, logs } = await runOnce({
      label: 'GAP2 durable comic, fresh image-search evidence says book',
      bearer: TOKEN,
      pool: BOOK_DOMINANT_POOL,
      requestBody: {
        title: 'Amazing Spider-Man', issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel',
        images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
        collectionItemId: id, ownedReidentify: true,
      },
    });

    // NOTE (found during audit, still true post-fix): the eBay-category
    // vector (ebaySaysBook) is ALREADY blocked by a real, pre-existing,
    // unrelated hard-reject filter -- `[visual-identity-filter]` rejects
    // rows with reasons.MARKETPLACE_BOOK_CATEGORY BEFORE parsedVisualRows
    // is even populated for the book-derivation check, so this specific
    // vector never reproduced the hypothesized flip, before or after
    // GK-254. Left in as a negative control; the title-signal vector
    // (titleSaysBook, GAP2b below) is the one that genuinely needed the
    // GK-254 fix.
    assertFalse(!!logs.find((l) => l.startsWith('[assetType-derive] book detected')), 'NEGATIVE CONTROL: the eBay-category book-derivation vector does NOT fire here -- a real, pre-existing, unrelated filter (visual-identity-filter, MARKETPLACE_BOOK_CATEGORY) already hard-rejects book-category marketplace rows before they reach this check');
    assertEq(body?.assetType, 'comic', 'stays comic -- this specific vector was never a real gap (pre-existing filter already protects it)');
  }

  // ═══════════════════════════════════════════════════════════════════
  // GAP 2b — the OTHER vector: detectBookSignals reads the TITLE TEXT
  // ONLY (api/enrich.js:3838 never passes `reason`), so a Vision
  // misread/OCR of a hardcover/omnibus reprint's own cover text -- NOT
  // marketplace evidence at all -- can independently trigger
  // titleSaysBook. Tests whether THIS vector (unrelated to the eBay
  // pool) can still flip a durable-comic row.
  // ═══════════════════════════════════════════════════════════════════
  {
    const id = `${TAG}-gap2b`;
    await makeCollectionItem(id, 'comic', { title: 'Amazing Spider-Man', issue: '300' });

    const { body, logs } = await runOnce({
      label: 'GAP2b durable comic, title text itself trips detectBookSignals',
      bearer: TOKEN,
      pool: [], // empty -- proves this vector needs no marketplace evidence at all
      requestBody: {
        // A plausible real Vision misread: an omnibus/hardcover reprint's
        // own cover text genuinely contains "Hardcover"/"Collected Edition".
        title: 'Amazing Spider-Man Omnibus Collected Edition Hardcover',
        issue: '300', grade: 'Very Fine', confidence: 'high',
        isGraded: false, numericGrade: null, year: '1988', publisher: 'Marvel',
        images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
        collectionItemId: id, ownedReidentify: true,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[assetType-derive] book detected')), 'the title-signal (titleSaysBook) vector still genuinely fires this request\'s own fresh derivation -- 2+ BOOK_SIGNALS keywords in the title text alone ("edition", "hardcover")');
    assertTrue(!!logs.find((l) => l.startsWith('[owned-asset-authority] RE-IDENTIFY CONFLICT')), 'FIXED: GK-254 detects the conflict between durable "comic" and this request\'s freshly-derived "book"');
    assertEq(body?.assetType, 'comic', 'FIXED: durable "comic" authority is PRESERVED -- no longer silently flips to "book" from a title misread alone');
    assertEq(body?.categoryConflict?.durable, 'comic', 'categoryConflict.durable records the preserved value');
    assertEq(body?.categoryConflict?.freshlyDerived, 'book', 'categoryConflict.freshlyDerived records what this request actually derived, for operator review');
    assertTrue(body?.refusedToPrice === true, 'held/refused pending review, per Section E -- normal Comic economics do not silently continue under an unresolved conflict either');
    assertEq(body?.pricingSource, 'refused-category-reidentify-conflict', 'the dedicated conflict pricingSource');
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
