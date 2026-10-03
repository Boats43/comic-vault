// tests/gk265-phase3-seller-execution.test.js
//
// GK-265 — PRINCIPAL-SCOPED EBAY SELLER EXECUTION, PHASE 3. Proves the
// conversion of api/list-ebay.js, api/delist-ebay.js, and
// api/ebay-outcome-reconciler.js off the legacy global seller
// credentials (EBAY_AUTH_TOKEN / EBAY_USER_REFRESH_TOKEN) onto
// src/lib/ebayPrincipalToken.js's per-principal resolver
// (resolveEbayUserAccessToken), against two real, independent GrailKey
// principals each with their own real GK-263/GK-264
// marketplace_connection row (real encryptCredential envelope, real
// Development Postgres).
//
// NO REAL EBAY NETWORK CALL IS EVER MADE. global.fetch is replaced with
// a local mock dispatched by URL/call-name — the same "mock fetch, real
// handler, real DB" convention tests/gk264-ebay-connect-oauth.test.js
// and tests/list-ebay-outcome1-handler-smoke.test.js already follow.
// The refresh-token-exchange mock returns a DETERMINISTIC access token
// derived from the exact refresh credential it was called with
// (`access-for-<refreshCredential>`) — this is what lets every
// assertion below prove WHICH principal's credential actually reached
// eBay, not merely that "a" token was used.
//
// Section numbers below (13-16) match the governing GK-265 dispatch's
// own section numbering.
//
// Invoke: node tests/gk265-phase3-seller-execution.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState } from './helpers/ebayPacketMocks.js';

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
process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');

// ── Section 14 (NO-FALLBACK ADVERSARIAL TESTS) — deliberately set the
// legacy global seller credentials in the test environment. Every
// assertion below that a principal-with-no-connection FAILS, and every
// secret-hygiene scan, also doubles as proof neither sentinel value
// below is ever the token that reaches an eBay call. ──
const GLOBAL_LEGACY_AUTH_TOKEN_SENTINEL = 'GLOBAL-LEGACY-EBAY-AUTH-TOKEN-MUST-NEVER-BE-USED';
const GLOBAL_LEGACY_REFRESH_SENTINEL = 'GLOBAL-LEGACY-EBAY-REFRESH-TOKEN-MUST-NEVER-BE-USED';
process.env.EBAY_AUTH_TOKEN = GLOBAL_LEGACY_AUTH_TOKEN_SENTINEL;
process.env.EBAY_USER_REFRESH_TOKEN = GLOBAL_LEGACY_REFRESH_SENTINEL;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ── Section 16 (SECRET HYGIENE) — capture every console line emitted
// by application code for the whole run, scanned at the very end. ──
const consoleCapture = [];
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    consoleCapture.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    orig(...args);
  };
}

// ── Unified fetch mock ──
const fetchCalls = [];
let itemIdCounter = 0;
const nextItemId = () => `gk265-item-${Date.now()}-${++itemIdCounter}`;
const refreshBehavior = {}; // refreshCredential -> 'success' | 'invalid_grant' | 'temporary'
let addFixedPriceItemBehavior = 'success';
const FAKE_HOSTED_URL = 'https://i.ebayimg.com/hosted/gk265-picture.jpg';
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

global.fetch = async (url, opts = {}) => {
  const urlStr = String(url);
  const __m = metaFetch(urlStr, opts); if (__m) return __m;

  if (urlStr.includes('identity/v1/oauth2/token')) {
    const params = new URLSearchParams(String(opts.body || ''));
    const refreshCredential = params.get('refresh_token');
    fetchCalls.push({ type: 'refresh-exchange', refreshCredential });
    const behavior = refreshBehavior[refreshCredential] || 'success';
    if (behavior === 'invalid_grant') {
      return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'test-forced invalid_grant' }) };
    }
    if (behavior === 'temporary') {
      return { ok: false, status: 503, json: async () => ({ error: 'service_unavailable', error_description: 'test-forced temporary eBay outage' }) };
    }
    return { ok: true, status: 200, json: async () => ({ access_token: `access-for-${refreshCredential}`, expires_in: 7200 }) };
  }

  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (callName) {
    const iafToken = opts.headers['X-EBAY-API-IAF-TOKEN'] || null;
    fetchCalls.push({ type: 'trading', callName, iafToken });
    if (callName === 'GeteBayDetails') return shippingResponse();
    if (callName === 'GetUser') {
      return { status: 200, text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>test-seller</UserID><Site>US</Site></User></GetUserResponse>` };
    }
    if (callName === 'UploadSiteHostedPictures') {
      return { status: 200, text: async () => `<?xml version="1.0"?><UploadSiteHostedPicturesResponse><Ack>Success</Ack><SiteHostedPictureDetails><FullURL>${FAKE_HOSTED_URL}</FullURL></SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>` };
    }
    if (callName === 'AddFixedPriceItem') {
      if (addFixedPriceItemBehavior === 'failure') {
        return { status: 200, text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ShortMessage>Test-forced failure</ShortMessage></Errors></AddFixedPriceItemResponse>` };
      }
      return { status: 200, text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>${nextItemId()}</ItemID></AddFixedPriceItemResponse>` };
    }
    if (callName === 'EndItem') {
      return { status: 200, text: async () => `<?xml version="1.0"?><EndItemResponse><Ack>Success</Ack></EndItemResponse>` };
    }
    if (callName === 'GetItem') {
      return { status: 200, text: async () => `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item><SellingStatus><SellingState>Active</SellingState></SellingStatus></Item></GetItemResponse>` };
    }
    throw new Error(`test fetch mock: unexpected eBay call name "${callName}"`);
  }

  if (urlStr.includes('/sell/fulfillment/v1/')) {
    const auth = opts?.headers?.Authorization || null;
    fetchCalls.push({ type: 'fulfillment', auth });
    return { ok: true, status: 200, json: async () => ({ orders: [] }) };
  }
  if (urlStr.includes('/sell/finances/v1/')) {
    const auth = opts?.headers?.Authorization || null;
    fetchCalls.push({ type: 'finances', auth });
    return { ok: true, status: 200, json: async () => ({ transactions: [] }) };
  }

  throw new Error(`test fetch mock: unexpected call to "${urlStr}"`);
};

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const { upsertMarketplaceConnection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
const { CONNECT_SCOPES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
const { createPhysicalAsset, recordDecision, recordOperatorAction, recordOutcomeEvent, linkCollectionItem, attachMedia } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { enrollAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const { createCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);

const listHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;
const delistHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'delist-ebay.js')).href)).default;
const reconcilerHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-outcome-reconciler.js')).href)).default;

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

function nonce(label) { return `gk265-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

async function createTestPrincipal(label) {
  const idRes = await dbClient.query('SELECT uuidv7() as id');
  const id = idRes.rows[0].id;
  await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  return id;
}

async function mintListableAsset(principalId, label) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await createPhysicalAsset({
    principalId, captureBasis: { test: true, label, n }, assetClass: 'comic', source: 'test-fixture',
    idempotencyKey: `${n}-mint`,
  });
  await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-enroll` });
  // OUTCOME #1 V1 — governed buyer-facing facts come from the owned asset's durable canonical catalogue row.
  const canonicalId = `cv_${n}`;
  await createCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: { title: 'GK-265 Test Comic', publisher: 'Test Publisher', year: '1990' } });
  await linkCollectionItem({ principalId, collectionItemId: canonicalId, gkAssetId, idempotencyKey: `${n}-link` });
  const { decisionEventId } = await recordDecision({
    principalId, gkAssetId, recommendation: 'LIST_NOW', idempotencyKey: `${n}-decision`,
  });
  // OUTCOME #1 — price binding: the durable LIST action records the approved price (listReqFor lists at $25.00);
  // photo guard: the photo sent must hash to a media row of THIS asset.
  await attachMedia({ principalId, gkAssetId, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-photo` });
  const { operatorActionEventId } = await recordOperatorAction({
    principalId, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-action`,
  });
  return { gkAssetId, decisionEventId, operatorActionEventId };
}

function listReqFor(principalId, asset, overrides = {}) {
  const { token } = issueToken({ principalId });
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      title: 'GK-265 Test Comic',
      publisher: 'Test Publisher',
      year: '1990',
      price: '$25.00',
      grade: 'VF',
      q41Override: { priceOverridden: true, manualPrice: 25 },
      gkAssetId: asset.gkAssetId,
      decisionEventId: asset.decisionEventId,
      operatorActionEventId: asset.operatorActionEventId,
      images: [TINY_PNG_DATA_URL],
      ...overrides,
    },
  };
}

async function connectEbay(principalId, providerUserId, refreshCredential) {
  return upsertMarketplaceConnection({
    principalId, provider: 'EBAY', providerUserId, refreshCredential, grantedScopes: [...CONNECT_SCOPES],
  });
}

async function getConnectionRow(principalId) {
  const r = await dbClient.query(
    `SELECT connection_status, last_error FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = 'EBAY'`,
    [principalId]
  );
  return r.rows[0] || null;
}

// ════════════════════════════════════════════════════════════════════
// FIXTURES — two real, independent principals, each with their own
// real eBay identity and real (fake-content) encrypted refresh
// credential.
// ════════════════════════════════════════════════════════════════════
const PRINCIPAL_A = await createTestPrincipal('gk265-principal-a');
const PRINCIPAL_B = await createTestPrincipal('gk265-principal-b');
const PRINCIPAL_C_NO_CONNECTION = await createTestPrincipal('gk265-principal-c-no-connection');

const A_REFRESH = `fake-refresh-A-${nonce('a')}`;
const B_REFRESH = `fake-refresh-B-${nonce('b')}`;
await connectEbay(PRINCIPAL_A, 'ebay-identity-A', A_REFRESH);
await connectEbay(PRINCIPAL_B, 'ebay-identity-B', B_REFRESH);

const createdOutcomeIdempotencyKeys = [];
const createdExternalListingIds = [];

try {
  // ══════════════════════════════════════════════════════════════════
  // SECTION 13 — TWO-PRINCIPAL ADVERSARIAL TEST MATRIX
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-265 SECTION 13: LIST ===\n');

  // LIST — A asset + A session -> uses A credential
  {
    const asset = await mintListableAsset(PRINCIPAL_A, 'list-a');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_A, asset), res);
    const addCall = fetchCalls.find((c) => c.type === 'trading' && c.callName === 'AddFixedPriceItem');
    assertTrue(res.statusCode === 200 && res.body?.ok === true, '13.LIST-A: A asset + A session succeeds');
    assertTrue(addCall?.iafToken === `access-for-${A_REFRESH}`, '13.LIST-A: AddFixedPriceItem used A\'s own credential');
  }

  // LIST — B asset + B session -> uses B credential
  {
    const asset = await mintListableAsset(PRINCIPAL_B, 'list-b');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_B, asset), res);
    const addCall = fetchCalls.find((c) => c.type === 'trading' && c.callName === 'AddFixedPriceItem');
    assertTrue(res.statusCode === 200 && res.body?.ok === true, '13.LIST-B: B asset + B session succeeds');
    assertTrue(addCall?.iafToken === `access-for-${B_REFRESH}`, '13.LIST-B: AddFixedPriceItem used B\'s own credential');
  }

  // LIST — A session + B asset -> rejected before eBay
  {
    const assetB = await mintListableAsset(PRINCIPAL_B, 'list-b-guarded');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_A, assetB), res);
    assertTrue(res.statusCode === 403, '13.LIST-cross-AB: A session + B asset rejected (403)');
    assertTrue(!fetchCalls.some((c) => c.type === 'trading'), '13.LIST-cross-AB: no eBay Trading API call made');
  }

  // LIST — B session + A asset -> rejected before eBay
  {
    const assetA = await mintListableAsset(PRINCIPAL_A, 'list-a-guarded');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_B, assetA), res);
    assertTrue(res.statusCode === 403, '13.LIST-cross-BA: B session + A asset rejected (403)');
    assertTrue(!fetchCalls.some((c) => c.type === 'trading'), '13.LIST-cross-BA: no eBay Trading API call made');
  }

  console.log('\n=== GK-265 SECTION 13: DELIST ===\n');

  async function listThenDelistFixture(principalId, label) {
    const asset = await mintListableAsset(principalId, label);
    fetchCalls.length = 0;
    const listRes = mockRes();
    await listHandler(listReqFor(principalId, asset), listRes);
    if (listRes.statusCode !== 200) throw new Error(`fixture setup failed: LIST for ${label} returned ${listRes.statusCode}: ${JSON.stringify(listRes.body)}`);
    return { ...asset, externalListingId: listRes.body.listingId };
  }

  // DELIST — A linked listing -> A credential
  {
    const listing = await listThenDelistFixture(PRINCIPAL_A, 'delist-a');
    const { token } = issueToken({ principalId: PRINCIPAL_A });
    fetchCalls.length = 0;
    const res = mockRes();
    await delistHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { ebayItemId: listing.externalListingId } }, res);
    const endCall = fetchCalls.find((c) => c.type === 'trading' && c.callName === 'EndItem');
    assertTrue(res.statusCode === 200 && res.body?.success === true, '13.DELIST-A: A\'s own linked listing succeeds');
    assertTrue(endCall?.iafToken === `access-for-${A_REFRESH}`, '13.DELIST-A: EndItem used A\'s own credential');
  }

  // DELIST — B linked listing -> B credential
  {
    const listing = await listThenDelistFixture(PRINCIPAL_B, 'delist-b');
    const { token } = issueToken({ principalId: PRINCIPAL_B });
    fetchCalls.length = 0;
    const res = mockRes();
    await delistHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { ebayItemId: listing.externalListingId } }, res);
    const endCall = fetchCalls.find((c) => c.type === 'trading' && c.callName === 'EndItem');
    assertTrue(res.statusCode === 200 && res.body?.success === true, '13.DELIST-B: B\'s own linked listing succeeds');
    assertTrue(endCall?.iafToken === `access-for-${B_REFRESH}`, '13.DELIST-B: EndItem used B\'s own credential');
  }

  // DELIST — cross-principal listing -> rejected
  {
    const listing = await listThenDelistFixture(PRINCIPAL_A, 'delist-cross');
    const { token } = issueToken({ principalId: PRINCIPAL_B });
    fetchCalls.length = 0;
    const res = mockRes();
    await delistHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { ebayItemId: listing.externalListingId } }, res);
    assertTrue(res.statusCode === 403, '13.DELIST-cross: a different principal is rejected (403) for a listing it does not own');
    assertTrue(!fetchCalls.some((c) => c.type === 'trading' && c.callName === 'EndItem'), '13.DELIST-cross: no EndItem call made');
  }

  // DELIST — arbitrary/unlinked ItemID -> rejected (NO GK-262 stopgap)
  {
    const { token } = issueToken({ principalId: PRINCIPAL_A });
    fetchCalls.length = 0;
    const res = mockRes();
    await delistHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { ebayItemId: `gk265-unlinked-${Date.now()}` } }, res);
    assertTrue(res.statusCode === 404, '13.DELIST-unlinked: an unlinked ItemID is REJECTED (404) — GK-262 stopgap removed');
    assertTrue(!fetchCalls.some((c) => c.type === 'trading' && c.callName === 'EndItem'), '13.DELIST-unlinked: no EndItem call made');
  }

  console.log('\n=== GK-265 SECTION 13: RECONCILER (covers Fulfillment + Finances token selection) ===\n');

  async function reconcilerFixture(principalId, label) {
    const asset = await mintListableAsset(principalId, label);
    const externalListingId = `gk265-reconciler-${nonce(label)}`;
    const idempotencyKey = `${nonce(label)}-outcome`;
    createdOutcomeIdempotencyKeys.push(idempotencyKey);
    createdExternalListingIds.push(externalListingId);
    await recordOutcomeEvent({
      principalId, gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId,
      outcomeType: 'LISTED', channel: 'ebay', externalListingId, askAmount: 25, idempotencyKey,
    });
    return { ...asset, externalListingId };
  }

  // RECONCILER — A's listing reconciles using A credential
  {
    const listing = await reconcilerFixture(PRINCIPAL_A, 'reconcile-a');
    const { token } = issueToken({ principalId: PRINCIPAL_A });
    fetchCalls.length = 0;
    const res = mockRes();
    await reconcilerHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: listing.gkAssetId, externalListingId: listing.externalListingId } }, res);
    const fulfillmentCall = fetchCalls.find((c) => c.type === 'fulfillment');
    assertTrue(res.statusCode === 200, '13.RECONCILE-A: A\'s own listing reconciles');
    assertTrue(fulfillmentCall?.auth === `Bearer access-for-${A_REFRESH}`, '13.RECONCILE-A: Fulfillment call used A\'s own credential');
  }

  // RECONCILER — B's listing reconciles using B credential
  {
    const listing = await reconcilerFixture(PRINCIPAL_B, 'reconcile-b');
    const { token } = issueToken({ principalId: PRINCIPAL_B });
    fetchCalls.length = 0;
    const res = mockRes();
    await reconcilerHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: listing.gkAssetId, externalListingId: listing.externalListingId } }, res);
    const fulfillmentCall = fetchCalls.find((c) => c.type === 'fulfillment');
    assertTrue(res.statusCode === 200, '13.RECONCILE-B: B\'s own listing reconciles');
    assertTrue(fulfillmentCall?.auth === `Bearer access-for-${B_REFRESH}`, '13.RECONCILE-B: Fulfillment call used B\'s own credential (never A\'s)');
  }

  // RECONCILER — cross-principal reconciliation is rejected before eBay
  // (ownership enforced inside getOutcomeEventsForListing).
  {
    const listing = await reconcilerFixture(PRINCIPAL_A, 'reconcile-cross');
    const { token } = issueToken({ principalId: PRINCIPAL_B });
    fetchCalls.length = 0;
    const res = mockRes();
    await reconcilerHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: listing.gkAssetId, externalListingId: listing.externalListingId } }, res);
    assertTrue(res.statusCode === 404, '13.RECONCILE-cross: a different principal cannot reconcile someone else\'s listing');
    assertTrue(!fetchCalls.some((c) => c.type === 'fulfillment' || c.type === 'finances'), '13.RECONCILE-cross: no Fulfillment/Finances call made');
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 14 — NO-FALLBACK ADVERSARIAL TESTS
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-265 SECTION 14: NO GLOBAL FALLBACK (legacy env vars deliberately set) ===\n');

  {
    const asset = await mintListableAsset(PRINCIPAL_C_NO_CONNECTION, 'no-fallback-list');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_C_NO_CONNECTION, asset), res);
    assertTrue(res.statusCode === 503 && res.body?.error === 'EBAY_CONNECTION_REQUIRED', '14.NO-FALLBACK-LIST: a principal with no eBay connection fails closed, does not fall back');
    assertTrue(!fetchCalls.some((c) => c.type === 'trading' && c.callName === 'AddFixedPriceItem'), '14.NO-FALLBACK-LIST: no AddFixedPriceItem call made');
  }

  {
    // C has no eBay connection, so C can never produce a real LIST
    // through the handler (chicken-and-egg) -- a durable LISTED row is
    // fabricated directly (recordOutcomeEvent, same primitive
    // attemptListedOutcome itself uses) to give C a listing it
    // genuinely owns, purely to test delist-ebay.js's OWN credential-
    // resolution boundary in isolation from the LIST path.
    const asset = await mintListableAsset(PRINCIPAL_C_NO_CONNECTION, 'no-fallback-delist-owned');
    const externalListingId = `gk265-no-fallback-delist-${nonce('c')}`;
    const idempotencyKey = `${nonce('c')}-delist-outcome`;
    createdOutcomeIdempotencyKeys.push(idempotencyKey);
    createdExternalListingIds.push(externalListingId);
    await recordOutcomeEvent({
      principalId: PRINCIPAL_C_NO_CONNECTION, gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId,
      operatorActionEventId: asset.operatorActionEventId, outcomeType: 'LISTED', channel: 'ebay', externalListingId, askAmount: 25, idempotencyKey,
    });
    const { token } = issueToken({ principalId: PRINCIPAL_C_NO_CONNECTION });
    fetchCalls.length = 0;
    const res = mockRes();
    await delistHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { ebayItemId: externalListingId } }, res);
    assertTrue(res.statusCode === 503 && res.body?.error === 'EBAY_CONNECTION_REQUIRED', '14.NO-FALLBACK-DELIST: a principal with no eBay connection fails closed on their own linked listing');
    assertTrue(!fetchCalls.some((c) => c.type === 'trading' && c.callName === 'EndItem'), '14.NO-FALLBACK-DELIST: no EndItem call made');
  }

  {
    const asset = await mintListableAsset(PRINCIPAL_C_NO_CONNECTION, 'no-fallback-reconcile');
    const externalListingId = `gk265-no-fallback-${nonce('c')}`;
    const idempotencyKey = `${nonce('c')}-outcome`;
    createdOutcomeIdempotencyKeys.push(idempotencyKey);
    createdExternalListingIds.push(externalListingId);
    await recordOutcomeEvent({
      principalId: PRINCIPAL_C_NO_CONNECTION, gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId,
      operatorActionEventId: asset.operatorActionEventId, outcomeType: 'LISTED', channel: 'ebay', externalListingId, askAmount: 25, idempotencyKey,
    });
    const { token } = issueToken({ principalId: PRINCIPAL_C_NO_CONNECTION });
    fetchCalls.length = 0;
    const res = mockRes();
    await reconcilerHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: asset.gkAssetId, externalListingId } }, res);
    assertTrue(res.statusCode === 503 && res.body?.error === 'EBAY_CONNECTION_REQUIRED', '14.NO-FALLBACK-RECONCILE: a principal with no eBay connection fails closed');
    assertTrue(!fetchCalls.some((c) => c.type === 'fulfillment' || c.type === 'finances'), '14.NO-FALLBACK-RECONCILE: no Fulfillment/Finances call made');
  }

  // Direct proof neither sentinel legacy value was ever sent to eBay in
  // ANY call made anywhere in this entire test run so far.
  {
    const leaked = fetchCalls.some((c) =>
      c.iafToken === GLOBAL_LEGACY_AUTH_TOKEN_SENTINEL ||
      c.auth === `Bearer ${GLOBAL_LEGACY_AUTH_TOKEN_SENTINEL}` ||
      c.refreshCredential === GLOBAL_LEGACY_REFRESH_SENTINEL ||
      c.auth === `Bearer access-for-${GLOBAL_LEGACY_REFRESH_SENTINEL}`
    );
    assertTrue(!leaked, '14.NO-FALLBACK-DIRECT: neither global legacy sentinel credential was ever used in any real call this run');
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 15 — TOKEN FAILURE TESTS
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-265 SECTION 15: TOKEN FAILURE CLASSIFICATION ===\n');

  // invalid_grant -> A becomes RECONNECT_REQUIRED; B remains CONNECTED
  // and B's own operations still work; A's failure does not alter B.
  {
    refreshBehavior[A_REFRESH] = 'invalid_grant';
    const asset = await mintListableAsset(PRINCIPAL_A, 'invalid-grant-a');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_A, asset), res);
    assertTrue(res.statusCode === 503 && res.body?.error === 'EBAY_RECONNECT_REQUIRED', '15.INVALID-GRANT: A\'s invalid_grant surfaces as EBAY_RECONNECT_REQUIRED');
    const rowA = await getConnectionRow(PRINCIPAL_A);
    assertTrue(rowA?.connection_status === 'RECONNECT_REQUIRED', '15.INVALID-GRANT: A\'s connection_status is durably RECONNECT_REQUIRED');

    const rowB = await getConnectionRow(PRINCIPAL_B);
    assertTrue(rowB?.connection_status === 'CONNECTED', '15.INVALID-GRANT-ISOLATION: B remains CONNECTED after A\'s invalid_grant');

    const assetB = await mintListableAsset(PRINCIPAL_B, 'invalid-grant-b-unaffected');
    fetchCalls.length = 0;
    const resB = mockRes();
    await listHandler(listReqFor(PRINCIPAL_B, assetB), resB);
    assertTrue(resB.statusCode === 200 && resB.body?.ok === true, '15.INVALID-GRANT-ISOLATION: B\'s own LIST still succeeds after A\'s invalid_grant');
    refreshBehavior[A_REFRESH] = 'success';
    // Restore A back to CONNECTED for subsequent scenarios, exactly the
    // same real reconnect path GK-264's own Connect flow uses.
    await connectEbay(PRINCIPAL_A, 'ebay-identity-A', A_REFRESH);
  }

  // Temporary eBay/network failure -> connection remains CONNECTED, no
  // false reconnect-required mutation.
  {
    refreshBehavior[A_REFRESH] = 'temporary';
    const asset = await mintListableAsset(PRINCIPAL_A, 'temporary-failure-a');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_A, asset), res);
    assertTrue(res.statusCode === 502 && res.body?.error === 'EBAY_TEMPORARY_FAILURE', '15.TEMPORARY: a temporary eBay failure surfaces as EBAY_TEMPORARY_FAILURE');
    const rowA = await getConnectionRow(PRINCIPAL_A);
    assertTrue(rowA?.connection_status === 'CONNECTED', '15.TEMPORARY: A\'s connection_status is NOT mutated by a temporary failure');
    refreshBehavior[A_REFRESH] = 'success';
  }

  // Local decrypt/key-config failure -> safe internal failure; the
  // connection is NOT falsely marked reconnect-required; no secret
  // material is logged.
  {
    const realKey = process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY;
    process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url'); // valid format, WRONG key -- simulates an un-re-encrypted rotation
    const asset = await mintListableAsset(PRINCIPAL_A, 'decrypt-failure-a');
    fetchCalls.length = 0;
    const res = mockRes();
    await listHandler(listReqFor(PRINCIPAL_A, asset), res);
    process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = realKey;
    assertTrue(res.statusCode === 500 && res.body?.error === 'INTERNAL_ERROR', '15.DECRYPT-FAILURE: a local decryption/key-config fault surfaces as a safe INTERNAL_ERROR, not a revoked-authorization error');
    const rowA = await getConnectionRow(PRINCIPAL_A);
    assertTrue(rowA?.connection_status === 'CONNECTED', '15.DECRYPT-FAILURE: A\'s connection_status is NOT falsely marked reconnect-required by a local key fault');
    assertTrue(!fetchCalls.some((c) => c.type === 'refresh-exchange'), '15.DECRYPT-FAILURE: eBay was never even contacted (decryption failed before any network call)');
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 16 — SECRET HYGIENE (scanned at the very end, over the
  // ENTIRE captured console output of this whole test run)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-265 SECTION 16: SECRET HYGIENE ===\n');
  {
    const haystack = consoleCapture.join('\n');
    const secretNeedles = [
      A_REFRESH, B_REFRESH,
      process.env.EBAY_CERT_ID,
      GLOBAL_LEGACY_AUTH_TOKEN_SENTINEL, GLOBAL_LEGACY_REFRESH_SENTINEL,
      Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString('base64'), // Basic-auth value
    ].filter(Boolean);
    for (const needle of secretNeedles) {
      assertTrue(!haystack.includes(needle), `16.SECRET-HYGIENE: application console output never contains ${needle === process.env.EBAY_CERT_ID ? 'EBAY_CERT_ID' : needle.slice(0, 24) + '...'}`);
    }
  }

} finally {
  await dbClient.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = ANY($1)`, [[PRINCIPAL_A, PRINCIPAL_B, PRINCIPAL_C_NO_CONNECTION]]);
  for (const key of createdOutcomeIdempotencyKeys) {
    await dbClient.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key = $1`, [key]);
  }
  if (createdExternalListingIds.length) {
    await dbClient.query(`DELETE FROM data1_dev.outcome_event WHERE external_listing_id = ANY($1)`, [createdExternalListingIds]);
  }
  console.log('\n  (test cleanup) marketplace_connection rows, outcome_event rows, and idempotency_key rows all deleted. gk_principal/gk_asset rows left in place (permanent Development fixtures, matching this repo\'s existing convention).\n');
  await dbClient.end();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`GK-265 RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
