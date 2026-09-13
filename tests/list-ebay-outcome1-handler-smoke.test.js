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
import { createHmac, randomBytes } from 'node:crypto';
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

// ── Mock fetch — intercepts by X-EBAY-API-CALL-NAME, never reaches the
// real network. Recorded call log lets tests assert call ORDER (the
// GetUser safety check must run before AddFixedPriceItem). ──
const fetchCalls = [];
let addFixedPriceItemBehavior = 'success'; // 'success' | 'failure'
const FAKE_ITEM_ID = `test-item-${Date.now()}`;

// GK-208 — the zero-photo precall gate now blocks before any eBay call
// unless at least one image was successfully uploaded, so every
// scenario here that expects to reach AddFixedPriceItem must supply a
// real image and a working UploadSiteHostedPictures mock. A real,
// standard, non-sensitive 1x1 transparent PNG data URL -- never a real
// photo, never printed.
const FAKE_HOSTED_PICTURE_URL = 'https://i.ebayimg.example/hosted/outcome1-smoke.jpg';
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

global.fetch = async (url, opts) => {
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'] || '(unknown)';
  fetchCalls.push(callName);
  if (callName === 'GetUser') {
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>test-seller</UserID><Site>US</Site></User></GetUserResponse>`,
    };
  }
  if (callName === 'UploadSiteHostedPictures') {
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><UploadSiteHostedPicturesResponse><Ack>Success</Ack><SiteHostedPictureDetails><FullURL>${FAKE_HOSTED_PICTURE_URL}</FullURL></SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>`,
    };
  }
  if (callName === 'AddFixedPriceItem') {
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

const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;

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
const CREEPY_LIST_OPERATOR_ACTION_EVENT_ID = '01a097a1-6e78-71c9-9309-1ed9344c40db';
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
    images: [TINY_PNG_DATA_URL],
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

console.log('-- real success: valid token + gkAssetId + decisionEventId + LIST operatorActionEventId --\n');
{
  fetchCalls.length = 0;
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

console.log('-- PRE-PUBLISH HARDENING: attaching to the HOLD row (not LIST) must be rejected BEFORE any eBay call is ever made --\n');
{
  fetchCalls.length = 0;
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
  fetchCalls.length = 0;
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
  fetchCalls.length = 0;
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
  fetchCalls.length = 0;
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
  fetchCalls.length = 0;
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
  fetchCalls.length = 0;
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

await client.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
