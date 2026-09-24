// tests/gk253-audit-final-prepush.test.js
//
// GK-253 FINAL PRE-PUSH UNIVERSAL AUTHORITY AUDIT (2026-09-24) — TEST ONLY,
// per the governing audit's own explicit "DO NOT MODIFY APPLICATION CODE
// DURING THIS AUDIT" instruction and its allowance for a test-only commit
// when a real gap must be proven rather than asserted. This file proves two
// real, distinct gaps in GK-253's own durable-category-authority mechanism
// (api/enrich.js, the block introduced in commit 5b358e2) via genuine
// execution against the real Development DB and the real, unmodified
// api/enrich.js handler — not hand-constructed shapes.
//
// GAP 1 (Section 1 of the audit — auth plumbing): the durable-authority
// resolution block requires a valid Bearer token to ever run at all. The
// real client session token has a fixed 12h TTL with no refresh mechanism
// (src/modules/auth/token.js:31, src/lib/grailkeySession.js's own header
// comment) and the top-level `grailkeyAuthed` React state that gates the
// whole app is only set once at mount / on explicit logout -- it does NOT
// re-check on every request. A real owned Book, refreshed after the
// session token has silently expired mid-session (a realistic 12h+ usage
// window, not an adversarial contrivance), sends collectionItemId with NO
// usable Authorization header -- the durable override silently never
// attempts the DB read, and the request falls through to the exact
// pre-GK-253 vulnerable behavior (pipeline-derived assetType defaults to
// 'comic' for a bare title with no book signal).
//
// GAP 2 (Section 3 of the audit — asymmetric protection): GK-253's override
// (api/enrich.js ~6649) only fires when the resolved durable category is
// non-'comic'. It does nothing when the durable category IS 'comic' --
// meaning a real, established Comic's own pre-existing, independent
// book-vs-comic derivation (api/enrich.js:3828-3847, `ebaySaysBook`/
// `titleSaysBook` from a genuine image-search pass, e.g. on a real
// reIdentifyBook call which never sends skipImageSearch) can still flip
// out.assetType to 'book' for one request, REFUSING a real Comic's
// economics -- the "permanent law" requires this to be symmetric
// (established authority in EITHER direction survives an ordinary
// refresh), which the current code does not provide.
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

    // A real refreshMarketData-shaped request (skipImageSearch:true, no
    // assetType, bare title, collectionItemId present) but with NO
    // Authorization header at all -- exactly what getVaultHeaders() sends
    // once the 12h session token has expired while grailkeyAuthed (React
    // state) remains stuck true.
    const { body, logs } = await runOnce({
      label: 'GAP1 durable book, expired/missing session token',
      bearer: null, // <-- the gap: no Bearer token, even though this targets a REAL durable Book row
      pool: [],
      requestBody: {
        title: 'The Rationalists', issue: null, grade: 'Very Good', confidence: 'high',
        isGraded: false, numericGrade: null, year: '2020', publisher: null,
        skipImageSearch: true, collectionItemId: id,
      },
    });

    assertFalse(!!logs.find((l) => l.startsWith('[category-authority] durable authority overrides')), 'CONFIRMED GAP: no durable override attempted -- no Bearer token means the server never even tries the DB read');
    assertEq(body?.assetType, 'comic', 'CONFIRMED GAP: assetType falls through to the pipeline default (comic) for this real, durably-owned Book -- identical to the pre-GK-253 vulnerable behavior');
    assertFalse(body?.refusedToPrice === true, 'CONFIRMED GAP: the economic allowlist does NOT refuse this request -- a real owned Book can reach comic-calibrated economics whenever its session has quietly expired');
  }

  // Control: the SAME durable book row, SAME request, but WITH a valid
  // token -- proves the override DOES work when auth is present (isolates
  // the gap to the auth precondition specifically, not the resolution
  // logic itself).
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
        skipImageSearch: true, collectionItemId: id,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[category-authority] durable authority overrides')), 'control: override DOES fire with a valid token -- confirms Gap 1 is specifically the missing-auth precondition, not a defect in the resolution logic itself');
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
        collectionItemId: id,
      },
    });

    // NOTE (found during audit): the eBay-category vector (ebaySaysBook) is
    // ALREADY blocked by a real, pre-existing, unrelated hard-reject filter
    // -- `[visual-identity-filter]` rejects rows with
    // reasons.MARKETPLACE_BOOK_CATEGORY BEFORE parsedVisualRows is even
    // populated for the book-derivation check, so this specific vector
    // does NOT reproduce the hypothesized flip. Left in as a negative
    // control (see assertions below), and the title-signal vector
    // (titleSaysBook) is tested separately next, since it is unrelated to
    // marketplace evidence entirely.
    assertFalse(!!logs.find((l) => l.startsWith('[assetType-derive] book detected')), 'NEGATIVE CONTROL: the eBay-category book-derivation vector does NOT fire here -- a real, pre-existing, unrelated filter (visual-identity-filter, MARKETPLACE_BOOK_CATEGORY) already hard-rejects book-category marketplace rows before they reach this check');
    assertEq(body?.assetType, 'comic', 'stays comic -- this specific vector is not a real gap (pre-existing filter already protects it)');
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
        collectionItemId: id,
      },
    });
    assertTrue(!!logs.find((l) => l.startsWith('[assetType-derive] book detected')), 'the title-signal (titleSaysBook) vector genuinely fires -- 2+ BOOK_SIGNALS keywords in the title text alone ("edition", "hardcover")');
    assertFalse(!!logs.find((l) => l.startsWith('[category-authority]') && l.includes('overrides')), 'CONFIRMED GAP 2: GK-253\'s override never fires for a durable "comic" value -- it does not protect established Comic authority');
    assertEq(body?.assetType, 'book', 'CONFIRMED GAP 2: out.assetType flips to "book" for a REAL, established, durably-owned Comic, purely from THIS request\'s own title-text reading -- no marketplace evidence involved at all, so the pre-existing visual-identity-filter cannot protect against this vector');
    assertTrue(body?.refusedToPrice === true, 'CONFIRMED GAP 2: a real owned Comic\'s normal economics are incorrectly REFUSED -- category authority changed asymmetrically, in violation of the permanent law\'s symmetric requirement');
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
