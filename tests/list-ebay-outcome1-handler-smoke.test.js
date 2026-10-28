// tests/list-ebay-outcome1-handler-smoke.test.js
//
// GK-138 Handler-Wiring Verification — Outcome #1 IMPLEMENTATION PASS
// wired new GrailKey linkage + a durable outcome_event write into
// api/list-ebay.js's real handler. A real invocation is required, not
// just unit tests of recordOutcomeEvent/attemptListedOutcome in
// isolation, per the exact same rule tests/operator-action-handler-
// smoke.test.js and tests/gk184-handler-smoke.test.js already follow.
//
// NO REAL EBAY NETWORK CALL IS EVER MADE HERE — global.fetch is
// replaced with a local mock that intercepts by X-EBAY-API-CALL-NAME
// and returns canned XML. The real handler, the real authority gate,
// and (for the success/reject cases) the real Development Postgres
// connection are all exercised for real — only the external eBay call
// itself is faked, exactly the GK-138 convention ("mock fetch, real
// handler, real DB where the dispatch's own writer touches it").
//
// The one real-success case below writes a real, transient
// outcome_event row and deletes it immediately after — this is a
// wiring-verification artifact, never a genuine marketplace outcome
// (mirrors operator-action-handler-smoke.test.js's own disclosed-artifact
// convention exactly).
//
// Invoke: node tests/list-ebay-outcome1-handler-smoke.test.js

import { readFileSync } from 'node:fs';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState, TINY_PNG_B64 } from './helpers/ebayPacketMocks.js';
import { __resetMetadataCachesForTests as resetMetadataCaches } from '../src/lib/ebayListingMetadata.js';

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
// GK-265 PHASE 3 — api/list-ebay.js now resolves a real per-principal
// eBay User access token (src/lib/ebayPrincipalToken.js) instead of a
// global EBAY_AUTH_TOKEN. A real (fake-content) encrypted
// marketplace_connection row for JIMMY is required below.
if (!process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY) {
  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');
}
const JIMMY_EBAY_REFRESH_CREDENTIAL = `fake-refresh-jimmy-${Date.now()}`;

// ── Mock fetch — intercepts by X-EBAY-API-CALL-NAME, never reaches the
// real network. Recorded call log lets tests assert call ORDER (the
// GetUser safety check must run before AddFixedPriceItem). ──
const fetchCalls = [];
let addFixedPriceItemBehavior = 'success'; // 'success' | 'failure'
let lastAddFixedPriceItemBody = '';
let uploadUrlOverride = null; // GK buyer-facing sanitation: the REAL outbound eBay packet
const FAKE_ITEM_ID = `test-item-${Date.now()}`;

// GK-208 — the zero-photo precall gate now blocks before any eBay call
// unless at least one image was successfully uploaded, so every
// scenario here that expects to reach AddFixedPriceItem must supply a
// real image and a working UploadSiteHostedPictures mock. A real,
// standard, non-sensitive 1x1 transparent PNG data URL -- never a real
// photo, never printed.
const FAKE_HOSTED_PICTURE_URL = 'https://i.ebayimg.com/hosted/outcome1-smoke.jpg';
mockState.mediaImageUrl = FAKE_HOSTED_PICTURE_URL; // eBay Media API getImage returns this EPS URL
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

global.fetch = async (url, opts) => {
  const urlStr = String(url);
  const __m = metaFetch(urlStr, opts); if (__m) return __m;
  if (urlStr.includes('identity/v1/oauth2/token')) {
    fetchCalls.push('refresh-exchange');
    return { ok: true, status: 200, json: async () => ({ access_token: `access-for-jimmy-${Date.now()}`, expires_in: 7200 }) };
  }
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'] || '(unknown)';
  fetchCalls.push(callName);
  if (callName === 'GeteBayDetails') return shippingResponse();
  if (callName === 'GetUser') {
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>test-seller</UserID><Site>US</Site></User></GetUserResponse>`,
    };
  }
  if (callName === 'UploadSiteHostedPictures') {
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><UploadSiteHostedPicturesResponse><Ack>Success</Ack><SiteHostedPictureDetails><FullURL>${uploadUrlOverride || FAKE_HOSTED_PICTURE_URL}</FullURL></SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>`,
    };
  }
  if (callName === 'AddFixedPriceItem') {
    lastAddFixedPriceItemBody = String(opts?.body ?? '');
    if (addFixedPriceItemBehavior === 'failure') {
      return {
        status: 200,
        text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ShortMessage>Test-forced failure</ShortMessage></Errors></AddFixedPriceItemResponse>`,
      };
    }
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>${FAKE_ITEM_ID}</ItemID></AddFixedPriceItemResponse>`,
    };
  }
  throw new Error(`test fetch mock: unexpected call name "${callName}"`);
};

const rawHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;
const previewHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'listing-preview.js')).href)).default;
const handler = async (req, res) => { await approveForTest(req); return rawHandler(req, res); };
// V1.1a -- a publish requires the seller's server-signed APPROVAL of the exact listing package. Obtain it from the REAL
// api/listing-preview.js "approve" action (same auth, same durable row + media, same eBay-metadata mock) -- never forged here.
// A request may set `__noApproval = true` for the negative case.
let lastApproveStatus = null;
let previewSeq = 0; // each approval call looks like a distinct client (the preview endpoint rate-limits per principal+IP)
async function approveForTest(req) {
  const b = req.body || {};
  if (!b.gkAssetId || b.listingApproval || req.__noApproval) return;
  const pm = String(b.price ?? b.priceHigh ?? b.priceLow ?? '').replace(/,/g, '').match(/[\d.]+/);
  const res = mockRes();
  await previewHandler({ method: 'POST', headers: { ...req.headers, 'x-forwarded-for': `smoke-preview-${++previewSeq}` }, body: { action: 'approve', gkAssetId: b.gkAssetId, price: pm ? parseFloat(pm[0]) : null } }, res);
  lastApproveStatus = res.statusCode;
  if (res.statusCode === 200 && res.body?.approval) {
    b.listingApproval = res.body.approval;
    // V1.1a Phase 2: photos are resolved server-side from the approved ORDERED hashes; an explicit declaration (even null) is kept as given.
    if (!('approvedPhotoHashes' in b)) b.approvedPhotoHashes = (res.body.package?.photos?.selected || []).map((x) => x.contentHash);
    if (!req.__keepLegacyImages) { delete b.images; delete b.image; }
  }
}


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

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN2_DECISION_EVENT_ID = '01a0895e-f93b-708d-9530-3a58555bf75c';
// Real, current LIST/HOLD rows for Creepy's own Chain #2 decision
// (confirmed live-queried immediately before writing this test — see
// GK-202 for the HOLD row's own prior disclosure; the LIST row is the
// real, later human action this dispatch's own audit found).
let CREEPY_LIST_OPERATOR_ACTION_EVENT_ID = '01a097a1-6e78-71c9-9309-1ed9344c40db'; // replaced below by a PRICED LIST action (Outcome #1 price binding)
const CREEPY_HOLD_OPERATOR_ACTION_EVENT_ID = '01a09767-3179-7f93-ad0e-8d251f3a80ba';

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

// Minimal item payload that clears the authority gate via the existing
// Q41 acknowledged-override path (item.q41Override) — the SAME
// already-shipped recovery path App.jsx's UI already uses — rather than
// reconstructing every field deriveActionAuthority needs for a fresh
// READY state. No images are supplied, so uploadSiteHostedPicture is
// never invoked (no picture-upload fetch call to mock).
function baseItem(overrides = {}) {
  return {
    title: 'Creepy #1',
    publisher: 'Warren Publishing',
    year: '1964',
    price: '$61.41',
    grade: 'VG',
    q41Override: { priceOverridden: true, manualPrice: 61.41 },
    // GK-208 — the zero-photo precall gate requires at least one usable
    // photo to reach AddFixedPriceItem at all; every scenario in this
    // file that's meant to reach that far needs one.
    approvedPhotoHashes: [createHash('sha256').update(Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64')).digest('hex')],
    ...overrides,
  };
}

async function queryOutcomeEventByIdempotencyKey(client, idempotencyKey) {
  const idem = await client.query(
    `SELECT result_snapshot FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key = $1`,
    [idempotencyKey]
  );
  if (!idem.rows[0]) return null;
  const snapshot = idem.rows[0].result_snapshot;
  const outcomeEventId = (typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot)?.outcomeEventId;
  if (!outcomeEventId) return null;
  const row = await client.query(`SELECT * FROM data1_dev.outcome_event WHERE id = $1`, [outcomeEventId]);
  return row.rows[0] || null;
}

async function cleanup(client, idempotencyKey) {
  const row = await queryOutcomeEventByIdempotencyKey(client, idempotencyKey);
  if (row) await client.query(`DELETE FROM data1_dev.outcome_event WHERE id = $1`, [row.id]);
  await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key = $1`, [idempotencyKey]);
}

console.log('\n=== api/list-ebay.js -- Outcome #1 real handler smoke invocation (GK-138) ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// GRAILKEY INVENTORY AUTHORITY V1 (2026-09-20) — api/list-ebay.js's
// single-item path now requires Inventory Authority state AVAILABLE
// before any eBay call. Creepy is UNMANAGED in real Development (never
// enrolled) — enroll it for real here so the scenarios below still
// exercise what they were written to exercise (linkage/outcome-writing),
// then restore Creepy to UNMANAGED in cleanup, exactly as found.
const { enrollAsset, closePool: closeInventoryPool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const inventoryEnrollKey = `list-ebay-smoke-inventory-enroll-${crypto.randomUUID()}`;
// B1-FINAL A5 repairs: (1) Creepy may already be enrolled from an earlier or crashed run (enrollment is only valid from UNMANAGED);
// tolerate that instead of failing at setup. (2) The GK-284 attempt ledger is append-only and rightly blocks a second listing while an
// earlier attempt on the asset is live, but these suites list the SAME asset repeatedly and delete their LISTED outcome rows. Pre-seed
// ONE DELISTED outcome for this run's fake item id so every attempt of this run reads as an ENDED listing (what a real delist does).
try { await enrollAsset({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, idempotencyKey: inventoryEnrollKey }); }
catch (e) { if (e?.code !== 'CONFLICT') throw e; console.log('  (test setup) Creepy is already enrolled in Inventory Authority -- continuing'); }
{ const __assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
  await __assets.recordOutcomeEvent({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, outcomeType: 'DELISTED', channel: 'ebay', externalListingId: FAKE_ITEM_ID, idempotencyKey: `${inventoryEnrollKey}-seed-delisted` }); }
console.log('  (test setup) Creepy enrolled in Inventory Authority: UNMANAGED -> AVAILABLE, real write, restored in cleanup\n');

// GK-265 PHASE 3 — a real, transient EBAY marketplace_connection for
// JIMMY (real encryptCredential envelope), deleted in cleanup.
const { upsertMarketplaceConnection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
await upsertMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY', providerUserId: 'jimmy-test-ebay-identity', refreshCredential: JIMMY_EBAY_REFRESH_CREDENTIAL, grantedScopes: [] });
console.log('  (test setup) real transient EBAY marketplace_connection written for JIMMY, deleted in cleanup\n');

// OUTCOME #1 V1 — buyer-facing identity facts are GOVERNED: the handler reads them from the DURABLE
// canonical catalogue row of the owned asset (fail-closed 409 LISTING_FACTS_UNAVAILABLE otherwise).
// Creepy's Development links point at rows that no longer exist, so transient canonical rows are
// created here (both link ids) and deleted in cleanup.
const { createCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const CREEPY_LINK_IDS = ['cv_1789188155734_itagfk', 'cv_1789271538761_1hsflc'];
const CREEPY_GOVERNED = { title: 'creepy', issue: '1', year: '1964', publisher: 'Warren Publishing' };
for (const id of CREEPY_LINK_IDS) await createCollectionItem({ principalId: JIMMY, id, assetCategory: 'comic', attributes: { ...CREEPY_GOVERNED } });
console.log('  (test setup) transient governed canonical rows created for Creepy\'s links, deleted in cleanup\n');

// OUTCOME #1 — price binding + photo guard fixtures. The durable LIST action must record the approved price
// ($61.41, matching baseItem's Q41 price) and the photo sent must hash to a media row of THIS asset. Both are
// idempotent single appends on the Development Creepy asset.
{
  const assetsMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
  await assetsMod.attachMedia({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: 'list-ebay-smoke-tinypng-evidence-v1' });
  const priced = await assetsMod.recordOperatorAction({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, actionCode: 'LIST', actionValueAmount: 61.41, source: 'test-fixture', idempotencyKey: 'list-ebay-smoke-priced-list-v1' });
  CREEPY_LIST_OPERATOR_ACTION_EVENT_ID = priced.operatorActionEventId;
  console.log('  (test setup) priced LIST action + asset-owned photo evidence ensured (idempotent)\n');
}

// C1 RECEIPT FIXTURES (2026-10-27) -- the publish gate requires a verified authority receipt on the asset's durable canonical row
// (principal + row + asset + current media evidence version). Install GENUINE receipts (real issueAuthorityReceipt, this process's
// own session secret) on the transient rows. Nothing about the gate is relaxed; negative tests below corrupt one dimension at a time.
const receiptFx = await import(pathToFileURL(path.join(repoRoot, 'tests', 'helpers', 'c1ReceiptFixtures.mjs')).href);
const __assetsForReceipts = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
// V1.1a: the Development Creepy asset also owns a real JPEG original; these suites publish the PNG evidence photo, so the seller's
// SELECTION (listingDraft.selectedMediaIds) pins the package to exactly that durable photograph. (The explicit seller choice is the
// feature; nothing is bypassed.)
let TEST_DRAFT = null;
{
  const rows = await __assetsForReceipts.listAssetMediaForListing({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID });
  const pngSha = createHash('sha256').update(Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64')).digest('hex');
  const png = rows.find((r) => r.contentHash === pngSha);
  if (!png) throw new Error('test setup: the PNG evidence photo is not a durable media row of Creepy');
  TEST_DRAFT = { selectedMediaIds: [png.mediaId] };
}
const installReceipts = async (attrs, opts = {}) => receiptFx.installFixtureReceipts({
  client, rowIds: CREEPY_LINK_IDS, principalId: opts.principalId || JIMMY, gkAssetId: CREEPY_ASSET_ID,
  contentHashes: opts.contentHashes || await __assetsForReceipts.getAssetMediaContentHashes({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID }),
  attrs: { ...attrs, listingDraft: opts.draft === undefined ? TEST_DRAFT : opts.draft }, bind: opts.bind, response: opts.response, tamper: opts.tamper,
});
await installReceipts(CREEPY_GOVERNED);
console.log('  (test setup) genuine authority receipts installed on the transient canonical rows\n');

console.log('-- real success: valid token + gkAssetId + decisionEventId + LIST operatorActionEventId --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  const idempotencyKey = `list-ebay-outcome1-smoke-${Date.now()}-a`;
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: baseItem({
      gkAssetId: CREEPY_ASSET_ID,
      decisionEventId: CHAIN2_DECISION_EVENT_ID,
      operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
      outcomeIdempotencyKey: idempotencyKey,
    }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 200, `real handler invocation -> 200 (got ${res.statusCode})`);
  assertTrue(res.body?.listingId === FAKE_ITEM_ID, 'response carries the real (mocked) eBay ItemID as listingId');
  assertTrue(fetchCalls.indexOf('GetUser') !== -1 && fetchCalls.indexOf('GetUser') < fetchCalls.indexOf('AddFixedPriceItem'), 'GetUser (account/token validity check) ran BEFORE AddFixedPriceItem');
  assertTrue(res.body?.outcome?.attempted === true && res.body?.outcome?.ok === true, 'outcome bridge attempted and succeeded');
  assertTrue(!!res.body?.outcome?.outcomeEventId, 'response carries a real outcomeEventId');

  const row = await queryOutcomeEventByIdempotencyKey(client, idempotencyKey);
  assertTrue(!!row, 'a real outcome_event row was durably written');
  assertTrue(row?.outcome_type === 'LISTED', 'outcome_type = LISTED');
  assertTrue(row?.external_listing_id === FAKE_ITEM_ID, 'external_listing_id = the real (mocked) eBay ItemID');
  assertTrue(row?.gk_asset_id === CREEPY_ASSET_ID, 'gk_asset_id = Creepy');
  assertTrue(row?.operator_action_event_id === CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, 'operator_action_event_id attaches to the real LIST row, not HOLD');
  assertTrue(row?.channel === 'ebay', 'channel = ebay');
  assertTrue(Number(row?.ask_amount) === 61.41, 'ask_amount = 61.41 (from item.price) -- the ACTUAL ASK, a distinct fact from Creepy\'s own $61.41 PREDICTED valuation_event.value_amount (same number here by coincidence of this fixture, never the same COLUMN or the same code path)');
  assertTrue(row?.gross_amount === null, 'gross_amount (REALIZED sale proceeds) is NULL -- never set by a LISTED write, only a future genuine SOLD write would set it');
  assertTrue(row?.net_amount === null, 'net_amount is NULL for the same reason');
  assertTrue(!!row?.next_observation_due_at, 'next_observation_due_at is populated (the observation/cutoff policy horizon), set AT WRITE TIME');
  {
    const dueMs = new Date(row.next_observation_due_at).getTime();
    const occurredMs = new Date(row.occurred_at).getTime();
    const days = (dueMs - occurredMs) / (24 * 60 * 60 * 1000);
    assertTrue(Math.abs(days - 30) < 0.01, `next_observation_due_at is occurred_at + 30 days (LISTING_OBSERVATION_WINDOW_DAYS, matching GTC's own renewal cadence), got ${days.toFixed(3)} days`);
  }

  await cleanup(client, idempotencyKey);
  console.log('  (test-artifact outcome_event row deleted -- this proves the CODE PATH works, it is not a genuine marketplace outcome)\n');
}

console.log('-- BUYER-FACING SANITATION: internal reasoning injected into the item NEVER reaches the real outbound eBay packet --\n');
{
  // INTERNAL DECISION REASONING != BUYER-FACING MARKETPLACE COPY. Each injected
  // value goes through the REAL handler -> real buildXml -> the exact
  // AddFixedPriceItem body (captured at the mocked fetch boundary). Raw
  // item.reason, claudeCheck.flags and the pricing-pipeline source label are all
  // internal; none may appear in ANY buyer-facing field.
  const injections = [
    ['A internal marker', 'INTERNAL_TEST_DO_NOT_SHOW_TO_BUYER'],
    ['B authority language', 'REFUSED because price authority missing'],
    ['C internal ids', 'gkAssetId=SECRET_TEST_ID decisionEventId=SECRET_DECISION_ID'],
    ['D model-style text', 'Model said user should list because the comp pool looked strong'],
    ['E html/script', '<script>alert(1)</script><img src=x onerror=alert(2)>'],
    ['F multiline/control', 'line one\nline two\r\n\ttabbed\u0007bell SECRET_CTRL_LINE'],
    ['G json diagnostics', '{"trace":"SECRET_JSON_TRACE","pricingSource":"pc_internal","blockers":["x"]}'],
  ];
  for (const [label, injected] of injections) {
    fetchCalls.length = 0; mockState.mediaCalls.length = 0;
    addFixedPriceItemBehavior = 'success';
    lastAddFixedPriceItemBody = '';
    const idempotencyKey = `list-ebay-sanitation-${Date.now()}-${label[0]}`;
    const req = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: baseItem({
        gkAssetId: CREEPY_ASSET_ID,
        decisionEventId: CHAIN2_DECISION_EVENT_ID,
        operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
        outcomeIdempotencyKey: idempotencyKey,
        reason: injected,
        // client-supplied identity/grade/title text is NOT authoritative — governed durable facts win
        title: 'CLIENT_FORGED_TITLE_DO_NOT_USE', publisher: 'FORGED_PUBLISHER', grade: 'NM 9.8 FORGED_GRADE',
        claudeCheck: { flags: [`INTERNAL_FLAG_DIAG ${injected}`], confidence: 'HIGH', suggestedListingTitle: 'AI_SUGGESTED_TITLE_DO_NOT_USE' },
        priceBands: { quick: 50, stretch: 70, market: 61.41, count: 4, source: 'INTERNAL_SOURCE_TOKEN_pc_sold' },
        keyIssue: 'First appearance of a test character',
      }),
    };
    const res = mockRes();
    await handler(req, res);
    const body = lastAddFixedPriceItemBody;
    assertTrue(res.statusCode === 200 && body.includes('<AddFixedPriceItemRequest'), `[${label}] real handler reached the real AddFixedPriceItem construction (status ${res.statusCode})`);
    const needles = [injected, ...injected.split(/[\n\r]+/).filter((x) => x.length > 6), 'INTERNAL_FLAG_DIAG', 'INTERNAL_SOURCE_TOKEN', 'SECRET_', 'INTERNAL_TEST_DO_NOT_SHOW', 'CLIENT_FORGED_TITLE', 'FORGED_PUBLISHER', 'FORGED_GRADE', 'AI_SUGGESTED_TITLE'];
    const leaked = needles.filter((n) => body.includes(n) || body.includes(n.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')));
    assertTrue(leaked.length === 0, `[${label}] NO injected internal text in any buyer-facing field of the outbound packet${leaked.length ? ' — LEAKED: ' + JSON.stringify(leaked).slice(0, 160) : ''}`);
    assertTrue(!/<NOTES>|<strong>NOTES<\/strong>/.test(body), `[${label}] no AI-verification "NOTES" block`);
    // ordinary safe fields stay intact
    assertTrue(body.includes('<Title>Creepy #1 Warren Publishing 1964</Title>'), `[${label}] DETERMINISTIC governed title from the durable canonical row (not client text, not the AI-suggested title)`);
    assertTrue(body.includes('<h2>Creepy #1</h2>') && body.includes('Warren Publishing · 1964'), `[${label}] governed identity facts in the description`);
    assertTrue(body.includes('Condition: See photos for condition details.') && !body.includes('Grade:'), `[${label}] ungoverned (client/model) grade NOT published; fixed factual condition sentence used`);
    assertTrue(!/Key Issue|Market value|MARKET DATA|Recent verified|DEMAND|CGC census|demand ·/.test(body), `[${label}] no key-issue claim, market-value, sold-sales, demand or census block`);
    assertTrue(body.includes('<StartPrice currencyID="USD">61.41</StartPrice>') && body.includes('<Name>Issue Number</Name>') && body.includes('<Value>Creepy</Value>') && body.includes('<Name>Publication Year</Name>'), `[${label}] price intact; item specifics from governed facts (incl. issue + year)`);
    assertTrue(!body.includes('<ConditionID>'), `[${label}] NO ConditionID emitted (category 259104 condition is optional; never derived from a client/model grade string; any value must come from the authoritative condition policy)`);
    assertTrue(body.includes('<ShippingService>USPSParcel</ShippingService>') && !body.includes('USPSMedia') && !body.includes('Media Mail'), `[${label}] shipping = the token authoritatively resolved from GeteBayDetails (USPS Ground Advantage); Media Mail absent`);
    assertTrue(!body.includes('<BestOfferDetails>') && !body.includes('BestOfferAutoAcceptPrice') && !body.includes('MinimumBestOfferPrice'), `[${label}] Best Offer OFF by default`);
    assertTrue(!body.includes('Grade Certification') && !body.includes('<Name>Language</Name>') && body.includes('<Value>Silver Age (1956-69)</Value>') && body.includes('<Value>Single Issue</Value>'), `[${label}] item specifics: eBay-enum Era resolved from the governed year, enum-valid Format, no invented 'Grade Certification' / Language`);
    await cleanup(client, idempotencyKey);
  }
  console.log('  (test-artifact outcome_event rows deleted)\n');
}

console.log('-- GATE B RAW CONDITION COPY: the REAL handler\'s outbound AddFixedPriceItem body (raw 9.2, slab, missing grade, long/special title, forged variant) --\n');
{
  const RAW_DISCLOSURE = 'Raw copy. GrailKey/operator condition assessment approximately NM- 9.2. Not professionally graded or slabbed.';
  const OML = { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25 Mike Deodato Teaser Variant' };
  // Grade-authority keys are server-protected from ordinary collection writes (GK-260/261, correctly), so this fixture sets the
  // governed attributes directly on the test's OWN transient canonical rows (created above, deleted in cleanup).
  const setGoverned = (attrs) => installReceipts(attrs); // same governed attrs, each with a genuine receipt matching that identity
  const runWith = async (label, governedAttrs, clientOverrides = {}) => {
    await setGoverned(governedAttrs);
    fetchCalls.length = 0; mockState.mediaCalls.length = 0; addFixedPriceItemBehavior = 'success'; lastAddFixedPriceItemBody = '';
    const idempotencyKey = `list-ebay-gateb-raw-${Date.now()}-${label}`;
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: baseItem({
      gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
      outcomeIdempotencyKey: idempotencyKey, ...clientOverrides }) }, res);
    const body = lastAddFixedPriceItemBody;
    await cleanup(client, idempotencyKey);
    return { res, body };
  };
  const common = (label, { res, body }) => {
    assertTrue(res.statusCode === 200 && body.includes('<AddFixedPriceItemRequest'), `[${label}] real handler reached the real AddFixedPriceItem construction (status ${res.statusCode})`);
    assertTrue(body.includes('<StartPrice currencyID="USD">61.41</StartPrice>') && !body.includes('<ConditionID>') && !body.includes('<BestOfferDetails>'), `[${label}] price authority (61.41), no ConditionID, Best Offer OFF -- all unchanged by the copy fix`);
    assertTrue(body.includes('<PictureURL>https://i.ebayimg.com/hosted/outcome1-smoke.jpg</PictureURL>') && body.includes('<Quantity>1</Quantity>'), `[${label}] photo-integrity result and quantity 1 unchanged`);
  };

  // 1. RAW 9.2 (operator-confirmed) -- the exact required identity and disclosure. Client forges a slab + a different variant.
  {
    const r = await runWith('raw92', { ...OML, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false },
      { variant: 'FORGED CLIENT VARIANT', grade: 'CGC 9.8', isGraded: true, numericGrade: 9.8, claudeCheck: { suggestedListingTitle: 'AI_SUGGESTED_TITLE', confidence: 'HIGH', flags: [] } });
    common('raw 9.2', r);
    assertTrue(r.body.includes('<Title>Old Man Logan #25 1:25 Mike Deodato Teaser Variant Marvel 2017 Raw NM-</Title>'), '[raw 9.2] EXACT required title: "Old Man Logan #25 1:25 Mike Deodato Teaser Variant Marvel 2017 Raw NM-"');
    assertTrue(r.body.includes(RAW_DISCLOSURE), '[raw 9.2] description carries the EXACT required raw disclosure');
    assertTrue(!r.body.includes('Grade:') && !r.body.includes('CGC') && !r.body.includes('Slabbed Grade'), '[raw 9.2] no "Grade:" line, no CGC claim, even though the client forged isGraded/CGC 9.8');
    assertTrue(!r.body.includes('FORGED CLIENT VARIANT') && !r.body.includes('AI_SUGGESTED_TITLE'), '[raw 9.2] a forged client variant / AI-suggested title is never substituted for the governed variant');
  }
  // 2. Same governed row but NO governed variant: the client's variant must not appear (no incorrect variant substitution).
  {
    const r = await runWith('novariant', { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false }, { variant: '1:25 Mike Deodato Teaser Variant' });
    common('no governed variant', r);
    assertTrue(r.body.includes('<Title>Old Man Logan #25 Marvel 2017 Raw NM-</Title>') && !r.body.includes('Deodato'), '[no governed variant] the variant is NOT invented from the client request');
  }
  // 3. Professional slab: unchanged behavior.
  {
    const r = await runWith('slab', { title: 'Batman', issue: '1', year: '1940', publisher: 'DC', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'CGC', operatorIsGraded: true, operatorGradeNumeric: 7.5 });
    common('slab', r);
    assertTrue(r.body.includes('<Title>Batman #1 CGC 7.5 DC 1940</Title>') && r.body.includes('Grade: <strong>CGC 7.5</strong>') && !r.body.includes('Raw copy') && !/>[^<]*\bRaw\b/.test(r.body.match(/<Title>[^<]*<\/Title>/)[0]), '[slab] professionally graded title + "Grade: CGC 7.5" preserved; no raw wording');
  }
  // 4. Missing grade authority: fixed factual sentence, no raw claim.
  {
    const r = await runWith('nograde', { ...CREEPY_GOVERNED, operatorGrade: '9.2' });
    common('missing grade authority', r);
    assertTrue(r.body.includes('Condition: See photos for condition details.') && !r.body.includes('Raw copy') && r.body.includes('<Title>Creepy #1 Warren Publishing 1964</Title>'), '[missing grade authority] an operator grade WITHOUT OPERATOR_CONFIRMED is not published: fixed sentence, no raw claim');
  }
  // 5. Long title + special characters: title <= 80 and still ends with "Raw NM-"; markup is escaped in XML and in the CDATA description.
  {
    const r = await runWith('longspecial', { title: 'AT&T <Super> "Comics" ' + 'X'.repeat(70), issue: '7', year: '2017', publisher: 'Marvel', variant: "1:25 O'Brien <B&W> Variant", gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false });
    common('long/special', r);
    const t = (r.body.match(/<Title>([^<]*)<\/Title>/) || [])[1] || '';
    const unesc = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    assertTrue(unesc.length <= 80 && unesc.endsWith(' Raw NM-') && !/<[A-Za-z]/.test(t), `[long/special] title <= 80 chars (${unesc.length}), ends with "Raw NM-", no raw markup in the XML title`);
    assertTrue(!/<script|<Super>|<B&W>/.test(r.body) && r.body.includes(RAW_DISCLOSURE), '[long/special] no unescaped markup anywhere in the packet; disclosure intact');
  }
  // restore the governed rows exactly as the rest of the suite expects
  await setGoverned(CREEPY_GOVERNED);
  console.log('  (test artifact) governed Creepy rows restored\n');
}

console.log('-- BUYER-FACING SANITATION (bundle): per-book internal reasoning never reaches the real bundle packet --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  lastAddFixedPriceItemBody = '';
  const mk = (title, issue, reason, extra = {}) => ({
    title, issue, year: '1975', publisher: 'Test Pub', price: '$20.00', grade: 'VF', approvedPhotoHashes: [createHash('sha256').update(Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64')).digest('hex')],
    reason, claudeCheck: { flags: ['INTERNAL_FLAG_DIAG bundle'] }, keyIssue: 'No', ...extra,
  });
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      bundle: true,
      items: [
        mk('Sanitation Series', '1', 'INTERNAL_TEST_DO_NOT_SHOW_TO_BUYER REFUSED because price authority missing', { keyIssue: 'First appearance of Test Hero' }),
        mk('Sanitation Series', '2', 'gkAssetId=SECRET_TEST_ID <script>alert(1)</script>\nSECRET_CTRL_LINE'),
      ],
    },
  };
  const res = mockRes();
  await handler(req, res);
  // V1.1a closeout (GK-216): bundle publication is fail-closed in every environment, so the bundle packet is never built. The bundle-copy projection
  // itself (no internal reason / flag / id / script text) stays covered at the unit level in tests/buyer-safe-listing-copy.test.js.
  assertTrue(res.statusCode === 503 && res.body?.error === 'BUNDLE_LISTING_DISABLED', `bundle publication is refused fail-closed (status ${res.statusCode} ${res.body?.error})`);
  assertTrue(lastAddFixedPriceItemBody === '' && !fetchCalls.includes('AddFixedPriceItem') && mockState.mediaCalls.length === 0, 'bundle refusal: zero provider writes (no AddFixedPriceItem, no picture upload)');
}

console.log('-- GOVERNED FACTS fail-closed: no resolvable durable canonical row -> NOTHING reaches eBay --\n');
{
  await client.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1) AND principal_id = $2`, [CREEPY_LINK_IDS, JIMMY]);
  fetchCalls.length = 0; mockState.mediaCalls.length = 0; lastAddFixedPriceItemBody = '';
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: baseItem({
    gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
    outcomeIdempotencyKey: `list-ebay-governed-failclosed-${Date.now()}`,
  }) }, res);
  assertTrue(res.statusCode === 409 && res.body?.error === 'LISTING_FACTS_UNAVAILABLE', `missing governed facts -> 409 LISTING_FACTS_UNAVAILABLE (got ${res.statusCode} ${res.body?.error})`);
  assertTrue(!fetchCalls.includes('AddFixedPriceItem') && mockState.mediaCalls.length === 0 && !fetchCalls.includes('UploadSiteHostedPictures') && lastAddFixedPriceItemBody === '', 'no picture upload and no AddFixedPriceItem attempted — never lists on client-supplied facts');
  for (const id of CREEPY_LINK_IDS) await createCollectionItem({ principalId: JIMMY, id, assetCategory: 'comic', attributes: { ...CREEPY_GOVERNED } });
  // C1: the recreated rows must carry genuine receipts again (a bare createCollectionItem has none -> every later scenario would 403).
  await installReceipts(CREEPY_GOVERNED);
}

console.log('-- OUTCOME #1 PACKET SAFETY: price binding / shipping / photo last-mile — all refuse BEFORE AddFixedPriceItem --\n');
{
  const base = (over = {}) => baseItem({
    gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
    outcomeIdempotencyKey: `list-ebay-packet-safety-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...over,
  });
  const run = async (body, opts = {}) => { fetchCalls.length = 0; mockState.mediaCalls.length = 0; lastAddFixedPriceItemBody = ''; const r = mockRes(); await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body, ...(opts.keepLegacy ? { __keepLegacyImages: true } : {}) }, r); return r; };
  const noEbayWrite = () => !fetchCalls.includes('AddFixedPriceItem');

  // --- PRICE (B/C: ack != packet) ---
  let r = await run(base({ price: '$61.42' })); // Q41 ack 61.41, packet 61.42
  assertTrue(r.statusCode === 409 && r.body?.error === 'MANUAL_PRICE_ACK_MISMATCH' && noEbayWrite() && mockState.mediaCalls.length === 0 && !fetchCalls.includes('UploadSiteHostedPictures'), `Q41 $61.41 + packet $61.42 -> 409 MANUAL_PRICE_ACK_MISMATCH before any eBay call (got ${r.statusCode} ${r.body?.error})`);
  r = await run(base({ price: '$360.59', priceHigh: '$414.68' }));
  assertTrue(r.statusCode === 409 && r.body?.error === 'MANUAL_PRICE_ACK_MISMATCH' && noEbayWrite(), 'Q41 $61.41 + the legacy catalogue price ($360.59-style) -> refused, nothing sent');
  r = await run(base({ price: '$61.409' }));
  assertTrue(r.statusCode === 400 && r.body?.error === 'LIST_PRICE_INVALID' && noEbayWrite(), 'a sub-cent price is not a valid USD amount -> 400 LIST_PRICE_INVALID before any eBay call (never silently rounded)');
  // --- PRICE (D: REVIEW without Q41) ---
  r = await run(base({ q41Override: null }));
  assertTrue(r.statusCode === 403 && r.body?.error === 'ACTION_AUTHORITY_NOT_READY' && noEbayWrite(), 'standing REVIEW without a Q41 acknowledgement -> 403 ACTION_AUTHORITY_NOT_READY (unchanged)');
  // --- V1 CERTIFICATION / GK-240: forged READY evidence + omitted soldCompDiagnostics, NO Q41 ack ---
  // Before the fix the real authority functions returned READY for exactly this request shape, so the
  // endpoint would have proceeded toward AddFixedPriceItem with no acknowledgement. It must now refuse.
  // C1: this scenario is specifically "the durable row carries NO verifying server receipt" -- remove the fixture receipts for it
  // (negative control), and reinstall them right after so the rest of the suite runs against a genuinely receipt-backed row.
  await installReceipts(CREEPY_GOVERNED, { tamper: () => undefined });
  r = await run(base({
    q41Override: null,
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] },
    pricingSource: 'active_ask_derived',
    matchConfidence: { tier: 'HIGH', score: 100 },
    rawComps: { count: 29 },
    identityConfident: true,
    // soldCompDiagnostics deliberately OMITTED; priorLockCodes empty
  }));
  assertTrue(r.statusCode === 403 && r.body?.error === 'ACTION_AUTHORITY_NOT_READY' && noEbayWrite() && mockState.mediaCalls.length === 0 && !fetchCalls.includes('UploadSiteHostedPictures'),
    `forged LIST_NOW decision + omitted soldCompDiagnostics + no Q41 -> 403 ACTION_AUTHORITY_NOT_READY, zero eBay writes (got ${r.statusCode} ${r.body?.error})`);
  assertTrue(Array.isArray(r.body?.actionAuthority?.reasonCodes) && (r.body.actionAuthority.reasonCodes.includes('NO_SOLD_EVIDENCE') || r.body.actionAuthority.reasonCodes.includes('NO_MARKET_EVIDENCE')) && r.body.authorityReceipt === 'UNVERIFIED:absent', 'the refusal names the missing evidence AND says no verifying server receipt backed it (failed closed, not skipped)');
  await installReceipts(CREEPY_GOVERNED); // reinstall genuine receipts for the remaining scenarios
  // --- PRICE: durable LIST action cannot be substituted ---
  const unpriced = await (await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href)).recordOperatorAction({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, actionCode: 'LIST', source: 'test-fixture', idempotencyKey: 'list-ebay-packet-safety-unpriced-list-v1' });
  r = await run(base({ operatorActionEventId: unpriced.operatorActionEventId }));
  assertTrue(r.statusCode === 409 && r.body?.error === 'LIST_ACTION_PRICE_NOT_RECORDED' && noEbayWrite(), 'a LIST action that recorded NO approved price cannot back a Q41 listing -> LIST_ACTION_PRICE_NOT_RECORDED');
  const other = await (await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href)).recordOperatorAction({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, actionCode: 'LIST', actionValueAmount: 99.99, source: 'test-fixture', idempotencyKey: 'list-ebay-packet-safety-priced-9999-v1' });
  r = await run(base({ operatorActionEventId: other.operatorActionEventId }));
  assertTrue(r.statusCode === 409 && r.body?.error === 'LIST_ACTION_PRICE_MISMATCH' && noEbayWrite(), 'a LIST action that approved a DIFFERENT price ($99.99) cannot be used to list at $61.41 -> LIST_ACTION_PRICE_MISMATCH');

  // --- SHIPPING (E/F) ---
  mockState.shippingFails = true;
  r = await run(base());
  mockState.shippingFails = false;
  assertTrue(r.statusCode === 409 && r.body?.error === 'SHIPPING_SERVICE_UNRESOLVED' && noEbayWrite() && mockState.mediaCalls.length === 0 && !fetchCalls.includes('UploadSiteHostedPictures'), 'authoritative shipping metadata unavailable -> 409 SHIPPING_SERVICE_UNRESOLVED before any picture upload / eBay write; no Media Mail fallback');
  resetMetadataCaches(); // module-level caches would otherwise mask the outage
  mockState.metaDown = true;
  r = await run(base());
  mockState.metaDown = false;
  resetMetadataCaches();
  assertTrue(r.statusCode === 503 && r.body?.error === 'LISTING_METADATA_UNAVAILABLE' && noEbayWrite(), 'authoritative aspect/condition metadata unavailable -> 503 LISTING_METADATA_UNAVAILABLE (fail-closed)');

  // --- PHOTO last-mile (N/O/P/Q/R/S) ---
  r = await run(base({ images: [], image: null, approvedPhotoHashes: null }));
  assertTrue(r.statusCode === 400 && r.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO' && noEbayWrite(), 'N. missing photo -> PUBLISH_BLOCKED_NO_PHOTO');
  mockState.mediaImageUrl = 'https://i.ebayimg.example/PLACEHOLDER-picture.jpg';
  r = await run(base());
  mockState.mediaImageUrl = FAKE_HOSTED_PICTURE_URL;
  assertTrue(r.statusCode === 502 && r.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO' && noEbayWrite(), 'O. Media API returns a placeholder / non-approved-host image URL -> 502 PUBLISH_BLOCKED_NO_PHOTO (media-response-malformed), no listing');
  mockState.mediaImageUrl = 'http://i.ebayimg.com/insecure.jpg';
  r = await run(base());
  mockState.mediaImageUrl = FAKE_HOSTED_PICTURE_URL;
  assertTrue(r.statusCode === 502 && r.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO' && noEbayWrite(), 'Media API returns a non-HTTPS image URL -> 502 PUBLISH_BLOCKED_NO_PHOTO, no listing');
  mockState.picture = 'unreachable';
  r = await run(base());
  assertTrue(r.statusCode === 400 && r.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO' && noEbayWrite(), 'P. unreachable hosted URL -> PUBLISH_BLOCKED_NO_PHOTO');
  mockState.picture = 'not-image';
  r = await run(base());
  assertTrue(r.statusCode === 400 && r.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO' && noEbayWrite(), 'Q. non-image content-type -> PUBLISH_BLOCKED_NO_PHOTO');
  mockState.picture = 'ok';
  const otherPng = 'data:image/png;base64,' + Buffer.from('not-this-assets-photo-' + Date.now()).toString('base64');
  r = await run(base({ approvedPhotoHashes: [createHash('sha256').update(otherPng).digest('hex')] }));
  assertTrue(r.statusCode === 400 && r.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO' && r.body?.reason === 'media-not-for-this-asset' && noEbayWrite(), 'R. a declared hash that is NOT a media row of this gkAssetId -> PUBLISH_BLOCKED_NO_PHOTO');
  r = await run(base({ images: [otherPng], image: otherPng }), { keepLegacy: true });
  assertTrue(r.statusCode === 400 && r.body?.error === 'LEGACY_CLIENT_PHOTOS_REJECTED' && noEbayWrite(), 'R2. client-supplied photo bytes are rejected outright (no verification-bypassing legacy path)');
  r = await run(base());
  assertTrue(r.statusCode === 200 && lastAddFixedPriceItemBody.includes('<PictureURL>https://i.ebayimg.com/hosted/outcome1-smoke.jpg</PictureURL>'), 'S. a valid hosted image of THIS asset proceeds to AddFixedPriceItem');
  // eBay-write packet: exact price-bound, Best Offer opt-in works but is OFF by default
  assertTrue(lastAddFixedPriceItemBody.includes('<StartPrice currencyID="USD">61.41</StartPrice>') && !lastAddFixedPriceItemBody.includes('<BestOfferDetails>'), 'packet price == acknowledged price == durable LIST price; Best Offer absent');
  // a listing for this asset is now (test-)active; clear it so the opt-in run is not blocked by the duplicate-listing preflight
  await client.query(`DELETE FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND external_listing_id = $2 AND outcome_type = 'LISTED' AND occurred_at > now() - interval '5 minutes'`, [CREEPY_ASSET_ID, FAKE_ITEM_ID]);
  r = await run(base({ bestOffer: true }));
  assertTrue(r.statusCode === 200 && lastAddFixedPriceItemBody.includes('<BestOfferEnabled>true</BestOfferEnabled>'), 'Best Offer remains available as an EXPLICIT opt-in (functionality not removed)');
  // outcome rows written by the two successful runs are test artifacts — remove them
  const stale = await client.query(`SELECT id FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND external_listing_id = $2 AND outcome_type = 'LISTED' AND occurred_at > now() - interval '5 minutes'`, [CREEPY_ASSET_ID, FAKE_ITEM_ID]);
  for (const row of stale.rows) await client.query('DELETE FROM data1_dev.outcome_event WHERE id = $1', [row.id]);
  await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key LIKE 'list-ebay-packet-safety-%'`);
  console.log('  (test-artifact outcome rows deleted)\n');
}

console.log('-- PRE-PUBLISH HARDENING: attaching to the HOLD row (not LIST) must be rejected BEFORE any eBay call is ever made --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  const idempotencyKey = `list-ebay-outcome1-smoke-${Date.now()}-b`;
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: baseItem({
      gkAssetId: CREEPY_ASSET_ID,
      decisionEventId: CHAIN2_DECISION_EVENT_ID,
      operatorActionEventId: CREEPY_HOLD_OPERATOR_ACTION_EVENT_ID, // HOLD, not LIST
      outcomeIdempotencyKey: idempotencyKey,
    }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 422, `attach-to-HOLD is rejected pre-flight -> 422 GRAILKEY_LINKAGE_INVALID (got ${res.statusCode})`);
  assertTrue(res.body?.error === 'GRAILKEY_LINKAGE_INVALID', 'error code = GRAILKEY_LINKAGE_INVALID');
  assertTrue(res.body?.listingId === undefined, 'NO listingId in the response -- no real eBay listing was ever attempted');
  assertTrue(fetchCalls.length === 0, `ZERO eBay calls were made -- linkage validation ran and failed BEFORE GetUser/AddFixedPriceItem (fetchCalls: [${fetchCalls.join(', ')}])`);

  const row = await queryOutcomeEventByIdempotencyKey(client, idempotencyKey);
  assertTrue(!row, 'NO outcome_event row was fabricated for the rejected attach-to-HOLD attempt');
  await cleanup(client, idempotencyKey);
}

console.log('\n-- PRE-PUBLISH HARDENING: GrailKey linkage attempted but Authorization header missing -> aborts BEFORE any eBay call --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  const idempotencyKey = `list-ebay-outcome1-smoke-${Date.now()}-c`;
  const req = {
    method: 'POST',
    headers: {}, // no Authorization header at all, but GrailKey fields ARE present
    body: baseItem({
      gkAssetId: CREEPY_ASSET_ID,
      decisionEventId: CHAIN2_DECISION_EVENT_ID,
      operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
      outcomeIdempotencyKey: idempotencyKey,
    }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 401, `attempted linkage with no bearer token -> 401 GRAILKEY_AUTH_REQUIRED, real listing NEVER attempted (got ${res.statusCode})`);
  assertTrue(res.body?.error === 'GRAILKEY_AUTH_REQUIRED', 'error code = GRAILKEY_AUTH_REQUIRED');
  assertTrue(fetchCalls.length === 0, 'ZERO eBay calls were made');

  const row = await queryOutcomeEventByIdempotencyKey(client, idempotencyKey);
  assertTrue(!row, 'no outcome_event row written');
}

console.log('\n-- PRE-PUBLISH HARDENING: PARTIAL linkage (gkAssetId present, decisionEventId/operatorActionEventId missing) -> aborts BEFORE any eBay call --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: baseItem({ gkAssetId: CREEPY_ASSET_ID }), // decisionEventId/operatorActionEventId deliberately omitted
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 400, `partial GrailKey linkage -> 400 GRAILKEY_LINKAGE_INCOMPLETE (got ${res.statusCode})`);
  assertTrue(res.body?.error === 'GRAILKEY_LINKAGE_INCOMPLETE', 'error code = GRAILKEY_LINKAGE_INCOMPLETE');
  assertTrue(fetchCalls.length === 0, 'ZERO eBay calls were made');
}

console.log('\n-- GK-207 CORRECTION: the legacy no-linkage fallback is REMOVED -- ZERO GrailKey fields at all now BLOCKS before any eBay call, never publishes --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  const req = {
    method: 'POST',
    headers: {}, // no Authorization, no GrailKey fields whatsoever
    body: baseItem(),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 401, `a caller sending NO GrailKey fields at all is now REJECTED before any eBay call -> 401 GRAILKEY_AUTH_REQUIRED (got ${res.statusCode})`);
  assertTrue(res.body?.error === 'GRAILKEY_AUTH_REQUIRED', 'error code = GRAILKEY_AUTH_REQUIRED');
  assertTrue(res.body?.listingId === undefined, 'NO listingId -- no real eBay listing was ever attempted');
  assertTrue(fetchCalls.length === 0, `ZERO eBay calls were made (fetchCalls: [${fetchCalls.join(', ')}])`);
}

console.log('\n-- AddFixedPriceItem itself fails (no ItemID) -> 502, and NO LISTED row is ever fabricated --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'failure';
  const idempotencyKey = `list-ebay-outcome1-smoke-${Date.now()}-d`;
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: baseItem({
      gkAssetId: CREEPY_ASSET_ID,
      decisionEventId: CHAIN2_DECISION_EVENT_ID,
      operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
      outcomeIdempotencyKey: idempotencyKey,
    }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 502, `eBay failure (no ItemID) -> 502, unchanged existing behavior (got ${res.statusCode})`);
  assertTrue(res.body?.outcome === undefined, 'the outcome bridge is never even reached when eBay itself fails');

  const row = await queryOutcomeEventByIdempotencyKey(client, idempotencyKey);
  assertTrue(!row, 'no outcome_event row exists -- failure before eBay acknowledgment never fabricates a LISTED fact');
  addFixedPriceItemBehavior = 'success';
}

console.log('\n-- idempotent replay: the SAME idempotencyKey twice returns the SAME outcomeEventId, zero duplicate row --\n');
{
  fetchCalls.length = 0; mockState.mediaCalls.length = 0;
  addFixedPriceItemBehavior = 'success';
  const idempotencyKey = `list-ebay-outcome1-smoke-${Date.now()}-e`;
  const req1 = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: baseItem({ gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, outcomeIdempotencyKey: idempotencyKey }),
  };
  const res1 = mockRes();
  await handler(req1, res1);
  const req2 = { ...req1, body: { ...req1.body } };
  const res2 = mockRes();
  await handler(req2, res2);

  assertTrue(res1.body?.outcome?.outcomeEventId === res2.body?.outcome?.outcomeEventId, 'replay returns the identical outcomeEventId');

  const count = await client.query(`SELECT count(*)::int AS n FROM data1_dev.outcome_event WHERE id = $1`, [res1.body.outcome.outcomeEventId]);
  assertTrue(count.rows[0].n === 1, 'exactly one durable row exists, not two');

  await cleanup(client, idempotencyKey);
}

console.log('-- C1 PUBLICATION-RECEIPT GATE, LIVE (real handler + real Development rows): every invalid receipt is refused BEFORE any eBay call --\n');
{
  const OTHER_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-000000000c1c';
  const noEbay = () => !fetchCalls.includes('GetUser') && !fetchCalls.includes('AddFixedPriceItem') && !fetchCalls.includes('UploadSiteHostedPictures') && mockState.mediaCalls.length === 0 && lastAddFixedPriceItemBody === '';
  const attempt = async (label, installOpts, expectedReason, { reqToken = token } = {}) => {
    if (installOpts) await installReceipts(CREEPY_GOVERNED, installOpts);
    fetchCalls.length = 0; mockState.mediaCalls.length = 0; addFixedPriceItemBehavior = 'success'; lastAddFixedPriceItemBody = '';
    const key = `list-ebay-c1-live-${label}-${Date.now()}`;
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${reqToken}` }, body: baseItem({
      gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, outcomeIdempotencyKey: key }) }, res);
    const leaked = await queryOutcomeEventByIdempotencyKey(client, key);
    if (leaked) await cleanup(client, key);
    return { res, noEbay: noEbay(), leaked: !!leaked, expectedReason };
  };
  const expectRefusal = (label, r) => {
    assertTrue(r.res.statusCode === 403 && r.res.body?.error === 'ACTION_AUTHORITY_NOT_READY' && r.res.body?.refusalReason === r.expectedReason,
      `[C1 live: ${label}] refused 403 ACTION_AUTHORITY_NOT_READY with ${r.expectedReason} (got ${r.res.statusCode} ${r.res.body?.refusalReason})`);
    assertTrue(r.noEbay && !r.leaked, `[C1 live: ${label}] ZERO eBay calls, no media upload, no outcome row written`);
  };
  const badSig = (r) => ({ ...r, sig: r.sig.slice(0, -4) + (r.sig.endsWith('AAAA') ? 'BBBB' : 'AAAA') });

  // POSITIVE (fixtures installed above): a verified receipt lets the same request reach AddFixedPriceItem (first success block, plus):
  {
    await installReceipts(CREEPY_GOVERNED);
    fetchCalls.length = 0; mockState.mediaCalls.length = 0; addFixedPriceItemBehavior = 'success'; lastAddFixedPriceItemBody = '';
    const key = `list-ebay-c1-live-positive-${Date.now()}`;
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: baseItem({
      gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, outcomeIdempotencyKey: key }) }, res);
    assertTrue(res.statusCode === 200 && res.body?.listingId === FAKE_ITEM_ID, `[C1 live: valid receipt] authorized publication reaches the mocked AddFixedPriceItem (got ${res.statusCode})`);
    assertTrue(fetchCalls.indexOf('GetUser') !== -1 && fetchCalls.indexOf('GetUser') < fetchCalls.indexOf('AddFixedPriceItem'), '[C1 live: valid receipt] GetUser precedes AddFixedPriceItem');
    await cleanup(client, key);
  }
  // POSITIVE (READY standing, no Q41 acknowledgement): the receipt alone is sufficient authority when the signed evidence is READY.
  {
    await installReceipts(CREEPY_GOVERNED, { response: receiptFx.readyResponse() });
    fetchCalls.length = 0; mockState.mediaCalls.length = 0; addFixedPriceItemBehavior = 'success'; lastAddFixedPriceItemBody = '';
    const key = `list-ebay-c1-live-ready-${Date.now()}`;
    const res = mockRes();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: baseItem({
      q41Override: null, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, outcomeIdempotencyKey: key }) }, res);
    assertTrue(res.statusCode === 200 && res.body?.listingId === FAKE_ITEM_ID, `[C1 live: READY receipt, no Q41] publishes via the READY path (got ${res.statusCode} ${res.body?.error || ''} ${res.body?.refusalReason || ''})`);
    await cleanup(client, key);
  }

  // NEGATIVES: one corrupted dimension at a time. Each refuses before ANY eBay call.
  expectRefusal('absent receipt', await attempt('absent', { tamper: () => undefined }, 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT'));
  expectRefusal('forged signature', await attempt('forged', { tamper: badSig }, 'AUTHORITY_RECEIPT_UNVERIFIED_BAD_SIGNATURE'));
  expectRefusal('malformed body', await attempt('malformed', { tamper: (r) => ({ ...r, body: 12345 }) }, 'AUTHORITY_RECEIPT_UNVERIFIED_MALFORMED'));
  expectRefusal('unsupported version', await attempt('version', { tamper: (r) => ({ ...r, v: 99 }) }, 'AUTHORITY_RECEIPT_UNVERIFIED_VERSION'));
  expectRefusal('receipt re-labelled to another principal', await attempt('relabel', { tamper: (r) => ({ ...r, principalId: OTHER_PRINCIPAL }) }, 'AUTHORITY_RECEIPT_UNVERIFIED_PRINCIPAL_MISMATCH'));
  expectRefusal('receipt genuinely issued for another principal', await attempt('otherprincipal', { tamper: (r, id) => receiptFx.issueFixtureReceipt({
    principalId: OTHER_PRINCIPAL, collectionItemId: id, gkAssetId: CREEPY_ASSET_ID, contentHashes: [], identity: CREEPY_GOVERNED }) }, 'AUTHORITY_RECEIPT_UNVERIFIED_PRINCIPAL_MISMATCH'));
  expectRefusal('identity mismatch (receipt for a different book)', await attempt('identity', { tamper: (r, id) => receiptFx.issueFixtureReceipt({
    principalId: JIMMY, collectionItemId: id, gkAssetId: CREEPY_ASSET_ID, contentHashes: [], identity: { title: 'Batman', issue: '9', year: '1940' } }) }, 'AUTHORITY_RECEIPT_IDENTITY_MISMATCH'));
  expectRefusal('unbound receipt (no asset)', await attempt('unbound', { bind: { gkAssetId: null } }, 'AUTHORITY_RECEIPT_UNBOUND'));
  expectRefusal('receipt bound to another asset', await attempt('otherasset', { bind: { gkAssetId: '01a0aaaa-0000-7000-8000-00000000dead' } }, 'AUTHORITY_RECEIPT_ASSET_MISMATCH'));
  expectRefusal('receipt bound to another catalogue row (cross-row replay)', await attempt('otherrow', { bind: { collectionItemId: 'cv_not_this_row' } }, 'AUTHORITY_RECEIPT_ASSET_MISMATCH'));
  expectRefusal('stale media evidence version', await attempt('stale', { bind: { evidenceVersion: 'deadbeefdeadbeefdeadbeefdeadbeef' } }, 'AUTHORITY_RECEIPT_EVIDENCE_VERSION_STALE'));
  expectRefusal('receipt signed before ANY media existed (null evidence version)', await attempt('noevidence', { bind: { evidenceVersion: null } }, 'AUTHORITY_RECEIPT_EVIDENCE_VERSION_STALE'));

  // PRINCIPAL ISOLATION: another principal's valid session cannot publish JIMMY's asset, with or without receipts.
  {
    await installReceipts(CREEPY_GOVERNED);
    const r = await attempt('isolation', null, null, { reqToken: mintTestToken(OTHER_PRINCIPAL) });
    assertTrue(r.res.statusCode >= 400 && r.res.statusCode < 500 && r.res.statusCode !== 200 && r.noEbay && !r.leaked,
      `[C1 live: principal isolation] another principal cannot publish this asset (got ${r.res.statusCode} ${r.res.body?.error || ''}); zero eBay calls, no outcome row`);
  }
  // Restore the genuine receipts for anything that runs after this block.
  await installReceipts(CREEPY_GOVERNED);
}

console.log('-- V1.1a LISTING PACKAGE (real preview + real publish handlers, real Development rows): approval binds to the SAME package that publishes --\n');
{
  const OTHER_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-000000000c1d';
  const assetsMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
  const mediaRows = await assetsMod.listAssetMediaForListing({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID });
  const jpeg = mediaRows.find((r) => r.contentType === 'image/jpeg');
  const noEbayWrites = () => !fetchCalls.includes('GetUser') && !fetchCalls.includes('AddFixedPriceItem') && !fetchCalls.includes('UploadSiteHostedPictures') && mockState.mediaCalls.length === 0 && lastAddFixedPriceItemBody === '';
  const callPreview = async (action, extra = {}, tok = token) => {
    const r = mockRes();
    await previewHandler({ method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `smoke-preview-${++previewSeq}` }, body: { action, gkAssetId: CREEPY_ASSET_ID, price: 61.41, ...extra } }, r);
    return r;
  };
  const publishWith = async (label, { bodyOver = {}, noApproval = false, approval } = {}) => {
    fetchCalls.length = 0; mockState.mediaCalls.length = 0; addFixedPriceItemBehavior = 'success'; lastAddFixedPriceItemBody = '';
    const key = `list-ebay-v11a-${label}-${Date.now()}`;
    const res = mockRes();
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: baseItem({
      gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, outcomeIdempotencyKey: key, ...bodyOver }) };
    if (approval !== undefined) req.body.listingApproval = approval;
    if (noApproval) req.__noApproval = true;
    await handler(req, res);
    const row = await queryOutcomeEventByIdempotencyKey(client, key); if (row) await cleanup(client, key);
    return { res, body: lastAddFixedPriceItemBody };
  };

  // 1. PREVIEW: the exact package, from durable rows only.
  let r = await callPreview('preview');
  const pk = r.body?.package;
  assertTrue(r.statusCode === 200 && !!pk, `[V1.1a preview] 200 with a package (got ${r.statusCode})`);
  assertTrue(pk?.title === 'Creepy #1 Warren Publishing 1964' && pk?.titleSource === 'governed', `[V1.1a preview] governed title (got "${pk?.title}")`);
  assertTrue(pk?.photos?.selected?.length === 1 && pk.photos.selected[0].contentType === 'image/png' && pk.photos.candidates.length === mediaRows.length, '[V1.1a preview] exactly the seller-selected durable photograph publishes; every other durable photo stays a listed candidate');
  assertTrue(pk?.photos?.missingViews?.join() === 'FRONT,BACK,SPINE,PAGES', '[V1.1a preview] no view is labelled, so every required view is reported missing (nothing manufactured)');
  assertTrue(pk?.approvable === true && !!pk?.packageHash && pk?.price?.amount === 61.41, '[V1.1a preview] approvable, hashed, price bound');
  assertTrue(/See photos for condition details/.test(pk?.descriptionHtml || '') && /Not photographed:/.test(pk?.descriptionHtml || ''), '[V1.1a preview] no operator grade => "See photos"; unphotographed views disclosed');
  { const u = mockRes(); await previewHandler({ method: 'POST', headers: {}, body: { action: 'preview', gkAssetId: CREEPY_ASSET_ID } }, u); assertTrue(u.statusCode === 401, `[V1.1a preview] unauthenticated -> 401 (got ${u.statusCode})`); }
  { const o = await callPreview('preview', {}, mintTestToken(OTHER_PRINCIPAL)); assertTrue(o.statusCode >= 400 && o.statusCode < 500 && !o.body?.package, `[V1.1a preview] another principal cannot preview this asset (got ${o.statusCode})`); }

  // 2. NO APPROVAL / FORGED APPROVAL: refused before ANY eBay call.
  let p = await publishWith('noapproval', { noApproval: true });
  assertTrue(p.res.statusCode === 409 && p.res.body?.error === 'LISTING_PACKAGE_APPROVAL_REQUIRED' && p.res.body?.reason === 'absent' && noEbayWrites(), `[V1.1a approval] no approval -> 409 LISTING_PACKAGE_APPROVAL_REQUIRED, zero eBay calls (got ${p.res.statusCode} ${p.res.body?.reason})`);
  const good = (await callPreview('approve')).body?.approval;
  assertTrue(!!good, '[V1.1a approval] the real approve action signs the package');
  p = await publishWith('forged', { noApproval: true, approval: { ...good, sig: good.sig.slice(0, -3) + (good.sig.endsWith('AAA') ? 'BBB' : 'AAA') } });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'invalid:bad-signature' && noEbayWrites(), `[V1.1a approval] forged signature refused (got ${p.res.body?.reason})`);
  const { issueListingApproval } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'listingApproval.js')).href);
  p = await publishWith('otherasset', { noApproval: true, approval: issueListingApproval({ principalId: JIMMY, gkAssetId: '01a0aaaa-0000-7000-8000-00000000beef', packageHash: pk.packageHash }) });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'asset-mismatch' && noEbayWrites(), `[V1.1a approval] an approval for another asset is refused (got ${p.res.body?.reason})`);

  // 3. A VALID approval publishes; the package that publishes is the package that was approved.
  p = await publishWith('approved', { noApproval: true, approval: good });
  assertTrue(p.res.statusCode === 200 && p.res.body?.listingId === FAKE_ITEM_ID, `[V1.1a approval] the signed approval publishes (got ${p.res.statusCode} ${p.res.body?.error || ''} ${p.res.body?.reason || ''})`);
  assertTrue(p.body.includes('<Title>Creepy #1 Warren Publishing 1964</Title>') && (p.body.match(/<PictureURL>/g) || []).length === 1, '[V1.1a approval] the approved title and exactly the approved single photograph reach AddFixedPriceItem');
  assertTrue(p.body.includes('Not photographed:') && p.body.includes('SHIPPING'), '[V1.1a approval] the factual photo disclosure and the fixed shipping block both publish');

  // 4. A SELLER CORRECTION invalidates the old approval, persists, and reaches the XML once re-approved.
  await installReceipts(CREEPY_GOVERNED, { draft: { ...TEST_DRAFT, conditionNote: 'Light wear at the staples.' } });
  p = await publishWith('stale', { noApproval: true, approval: good });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'stale-package' && noEbayWrites(), `[V1.1a correction] an approval for the PREVIOUS package is stale after a correction (got ${p.res.body?.reason})`);
  const again = await callPreview('preview'); const again2 = await callPreview('preview');
  assertTrue(again.body?.draft?.conditionNote === 'Light wear at the staples.' && again.body.package.packageHash === again2.body.package.packageHash, '[V1.1a correction] the saved correction persists on the durable row and the hash is stable across reads');
  p = await publishWith('corrected'); // the harness auto-approves the NEW package through the real approve action
  assertTrue(p.res.statusCode === 200 && p.body.includes('Seller note: Light wear at the staples.'), `[V1.1a correction] the corrected package publishes with the seller note (got ${p.res.statusCode})`);
  assertTrue(!/flawless|mint condition|no defects/i.test(p.body), '[V1.1a correction] no unsupported condition claim in the outbound packet');

  // 5. Seller TITLE override: used when valid, blocked when it contradicts the verified facts.
  await installReceipts(CREEPY_GOVERNED, { draft: { ...TEST_DRAFT, titleOverride: 'Creepy #1 (1964) Warren Publishing Raw' } });
  p = await publishWith('title');
  assertTrue(p.res.statusCode === 200 && p.body.includes('<Title>Creepy #1 (1964) Warren Publishing Raw</Title>'), '[V1.1a title] a valid seller title publishes verbatim');
  await installReceipts(CREEPY_GOVERNED, { draft: { ...TEST_DRAFT, titleOverride: 'Creepy Magazine Warren 1999' } });
  r = await callPreview('approve');
  assertTrue(r.statusCode === 409 && r.body?.error === 'LISTING_PACKAGE_NOT_APPROVABLE' && r.body.package.unresolved.some((u) => u.field === 'title' && u.severity === 'blocking'), '[V1.1a title] a title that drops the issue / changes the year cannot be approved');
  p = await publishWith('badtitle');
  assertTrue(p.res.statusCode === 409 && p.res.body?.error === 'LISTING_PACKAGE_APPROVAL_REQUIRED' && noEbayWrites(), '[V1.1a title] and cannot publish without an approval');

  // 6. UNSUPPORTED CLAIMS block approval (and therefore publication).
  await installReceipts(CREEPY_GOVERNED, { draft: { ...TEST_DRAFT, conditionNote: 'Flawless, signed, CGC 9.8 candidate' } });
  r = await callPreview('approve');
  assertTrue(r.statusCode === 409 && r.body.package.unsupportedClaims.length >= 3, `[V1.1a claims] flawless / signed / CGC claims block approval (got ${r.body?.package?.unsupportedClaims?.length})`);
  p = await publishWith('claims');
  assertTrue(p.res.statusCode === 409 && noEbayWrites(), '[V1.1a claims] nothing publishes');

  // 7. PHOTO SET: approved = durable selection; sending different bytes is refused before any upload.
  if (jpeg) {
    await installReceipts(CREEPY_GOVERNED, { draft: { selectedMediaIds: [...TEST_DRAFT.selectedMediaIds, jpeg.mediaId] } });
    r = await callPreview('approve');
    assertTrue(r.statusCode === 200 && r.body.package.photos.selected.length === 2, '[V1.1a photos] a second durable photograph can be approved into the package');
    p = await publishWith('photomismatch', { noApproval: true, approval: r.body.approval }); // the request still carries only the PNG
    assertTrue(p.res.statusCode === 409 && p.res.body?.error === 'LISTING_PACKAGE_PHOTO_MISMATCH' && noEbayWrites(), `[V1.1a photos] sending fewer photographs than approved is refused before any upload (got ${p.res.body?.error})`);
  }
  // reference / foreign media can never enter the package
  await installReceipts(CREEPY_GOVERNED, { draft: { selectedMediaIds: ['00000000-0000-7000-8000-00000000ffff'] } });
  r = await callPreview('preview');
  assertTrue(r.body?.package?.photos?.selected?.length === 0 && r.body.package.unresolved.some((u) => u.field === 'photos' && u.severity === 'blocking'), "[V1.1a photos] a media id that is not this asset's durable photo selects nothing (no substitution)");

  // 8. FULL NEGATIVE MATRIX (each presents an approval that must NOT authorize this publication; every one: zero eBay writes).
  await installReceipts(CREEPY_GOVERNED);
  const baseline = (await callPreview('approve')).body?.approval;
  const baselineHash = JSON.parse(baseline.body).packageHash;
  assertTrue(!!baseline, '[V1.1a negatives] a fresh, valid approval exists for the current package');
  p = await publishWith('wrongprincipal', { noApproval: true, approval: issueListingApproval({ principalId: OTHER_PRINCIPAL, gkAssetId: CREEPY_ASSET_ID, packageHash: baselineHash }) });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'invalid:principal-mismatch' && noEbayWrites(), `[V1.1a negatives] another principal's approval is refused (got ${p.res.body?.reason})`);
  p = await publishWith('expired', { noApproval: true, approval: issueListingApproval({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, packageHash: baselineHash, now: Date.now() - 25 * 60 * 60 * 1000 }) });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'expired' && noEbayWrites(), `[V1.1a negatives] an expired approval (25h) is refused even though the package is unchanged (got ${p.res.body?.reason})`);
  p = await publishWith('price', { noApproval: true, approval: baseline, bodyOver: { price: '$61.42' } });
  assertTrue(p.res.statusCode === 409 && noEbayWrites(), `[V1.1a negatives] a modified price cannot ride on the old approval (got ${p.res.statusCode} ${p.res.body?.error})`);
  // modified title (valid seller title) / governed facts (publisher => specifics, description, title) / condition (operator grade)
  await installReceipts(CREEPY_GOVERNED, { draft: { ...TEST_DRAFT, titleOverride: 'Creepy #1 (1964) Warren Publishing' } });
  p = await publishWith('modtitle', { noApproval: true, approval: baseline });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'stale-package' && noEbayWrites(), `[V1.1a negatives] a modified TITLE makes the old approval stale (got ${p.res.body?.reason})`);
  await installReceipts({ ...CREEPY_GOVERNED, publisher: 'Eerie Publications' });
  p = await publishWith('modspecifics', { noApproval: true, approval: baseline });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'stale-package' && noEbayWrites(), `[V1.1a negatives] modified governed facts make it stale (got ${p.res.body?.reason})`);
  await installReceipts({ ...CREEPY_GOVERNED, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '8.0', operatorGradeNumeric: 8, operatorIsGraded: false });
  p = await publishWith('modcondition', { noApproval: true, approval: baseline });
  assertTrue(p.res.statusCode === 409 && p.res.body?.reason === 'stale-package' && noEbayWrites(), `[V1.1a negatives] a modified CONDITION (operator grade) makes it stale (got ${p.res.body?.reason})`);
  await installReceipts(CREEPY_GOVERNED);

  // 9. DUPLICATE PUBLICATION is NOT asserted in this suite: it pre-seeds a DELISTED outcome for its fake ItemID (so the same asset can be
  //    re-listed run after run), and the duplicate guard treats any terminal row for an ItemID as "ended" -- so here the guard is off by
  //    construction. The duplicate proof, including re-presenting the SAME valid approval, lives in tests/gkp0-listing-live.test.js
  //    (fresh listing ids) and tests/gkp0-failure-injection-live.test.js.

  await installReceipts(CREEPY_GOVERNED); // genuine receipts + the default PNG selection for everything after this block
}

// Restore Creepy to UNMANAGED, exactly as found before this test ran.
await client.query('DELETE FROM data1_dev.inventory_current_state WHERE gk_asset_id = $1', [CREEPY_ASSET_ID]);
await client.query('DELETE FROM data1_dev.inventory_transition_event WHERE gk_asset_id = $1', [CREEPY_ASSET_ID]);
await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'enrollAsset' AND idempotency_key = $1`, [inventoryEnrollKey]);
console.log('  (test cleanup) Creepy restored to UNMANAGED in Inventory Authority');
await client.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1) AND principal_id = $2`, [CREEPY_LINK_IDS, JIMMY]);
await closeInventoryPool();

await client.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = 'EBAY'`, [JIMMY]);
console.log('  (test cleanup) JIMMY\'s transient EBAY marketplace_connection deleted');

await client.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
