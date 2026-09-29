// tests/gk262-public-surface-blockers.test.js
//
// GK-262 — closes the three internet-reachable public-surface blockers
// found by the pilot-preflight trace: api/delist-ebay.js made a real,
// unauthenticated, destructive EndItem call reachable by anyone;
// api/chat.js and api/manage.js made unauthenticated Anthropic calls
// with zero rate limiting. Bounded security patch only — no per-user
// eBay OAuth, no session-lifecycle work, no GK-259, no schema/migration,
// no quarantine/scratch touched.
//
// NO REAL EXTERNAL EBAY OR ANTHROPIC CALL IS EVER MADE HERE. global.fetch
// is replaced with a local mock dispatched by call shape (the same
// GK-138 convention tests/list-ebay-outcome1-handler-smoke.test.js
// already follows for eBay: "mock fetch, real handler, real DB where the
// dispatch's own writer touches it"). Anthropic's SDK uses the platform
// fetch by default (verified against node_modules/@anthropic-ai/sdk),
// so intercepting global.fetch by URL is the same technique, not a new
// one.
//
// DELIST scenarios exercise the real handler, the real verifyToken/
// ownership-check chain, and a real transient outcome_event row this
// test creates and deletes (mirrors the same "real, transient, deleted
// immediately after" convention) against the real Development Postgres.
//
// Invoke: node tests/gk262-public-surface-blockers.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
process.env.ACCESS_CODE = process.env.ACCESS_CODE || 'gk262-test-vault-code';
process.env.EBAY_AUTH_TOKEN = process.env.EBAY_AUTH_TOKEN || 'test-ebay-token';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app';
process.env.EBAY_DEV_ID = process.env.EBAY_DEV_ID || 'test-dev';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key-unused';

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

// ── Unified fetch mock — NEVER reaches the real network. Dispatches by
// call shape: eBay Trading API calls carry X-EBAY-API-CALL-NAME; every
// other call in this file is an Anthropic Messages API call. ──
const fetchCalls = [];
let endItemBehavior = 'success';
let anthropicChatReply = { response: 'test response', actions: [], metrics: [], signals: [] };
let anthropicManageReply = { trending: [], listNow: [], stagnant: [], bundleGroups: [], gradeFirst: [], marketSummary: 'test summary', totalValue: 0, valueChange: 0 };

function anthropicResponse(bodyObj) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      id: 'gk262-test-msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: JSON.stringify(bodyObj) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    text: async () => JSON.stringify(bodyObj),
  };
}

global.fetch = async (url, opts) => {
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (callName) {
    fetchCalls.push(callName);
    if (callName === 'EndItem') {
      if (endItemBehavior === 'failure') {
        return { status: 200, text: async () => `<?xml version="1.0"?><EndItemResponse><Ack>Failure</Ack><Errors><ShortMessage>Test-forced failure</ShortMessage></Errors></EndItemResponse>` };
      }
      return { status: 200, text: async () => `<?xml version="1.0"?><EndItemResponse><Ack>Success</Ack></EndItemResponse>` };
    }
    throw new Error(`test fetch mock: unexpected eBay call name "${callName}"`);
  }

  const urlStr = String(url);
  if (urlStr.includes('anthropic.com')) {
    fetchCalls.push('anthropic-messages-create');
    const isManageCall = urlStr.includes('/v1/messages') && JSON.stringify(opts?.body || '').includes('comic book dealer');
    return anthropicResponse(isManageCall ? anthropicManageReply : anthropicChatReply);
  }
  throw new Error(`test fetch mock: unexpected call to "${urlStr}"`);
};

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN2_DECISION_EVENT_ID = '01a0895e-f93b-708d-9530-3a58555bf75c';
const CREEPY_LIST_OPERATOR_ACTION_EVENT_ID = '01a097a1-6e78-71c9-9309-1ed9344c40db';

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

// ════════════════════════════════════════════════════════════════════
// PART 1 — /api/delist-ebay
// ════════════════════════════════════════════════════════════════════
console.log('\n=== GK-262 PART 1: /api/delist-ebay ===\n');

const delistHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'delist-ebay.js')).href)).default;

// D1 — unauthenticated request rejected before EndItem
{
  const req = { method: 'POST', headers: {}, body: { ebayItemId: 'gk262-unauth-test-item' } };
  const res = mockRes();
  fetchCalls.length = 0;
  await delistHandler(req, res);
  assertTrue(res.statusCode === 401, 'D1: unauthenticated delist request rejected with 401');
  assertTrue(fetchCalls.length === 0, 'D1: no EndItem call made for an unauthenticated request');
}

// Real, transient LISTED outcome_event row: a fresh test-only
// externalListingId linked to the real Creepy asset (owned by JIMMY),
// reusing Creepy's own real LIST operator_action_event/decision_event
// (no NEW rows on those tables — only a new outcome_event row).
const TEST_LISTING_ID = `gk262-test-listing-${Date.now()}`;
const TEST_IDEMPOTENCY_KEY = `gk262-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const { recordOutcomeEvent } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

await recordOutcomeEvent({
  principalId: JIMMY,
  gkAssetId: CREEPY_ASSET_ID,
  decisionEventId: CHAIN2_DECISION_EVENT_ID,
  operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
  outcomeType: 'LISTED',
  channel: 'ebay',
  externalListingId: TEST_LISTING_ID,
  askAmount: 61.41,
  idempotencyKey: TEST_IDEMPOTENCY_KEY,
});
console.log(`  (test setup) real transient outcome_event LISTED row written for ${TEST_LISTING_ID} -> Creepy, deleted in cleanup\n`);

let secondPrincipalId = null;
try {
  // D2 — authenticated legitimate path (real owner, real durable
  // linkage found) remains functional; full ownership bind reported.
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${issueToken({ principalId: JIMMY }).token}` }, body: { ebayItemId: TEST_LISTING_ID } };
    const res = mockRes();
    fetchCalls.length = 0;
    endItemBehavior = 'success';
    await delistHandler(req, res);
    assertTrue(res.statusCode === 200 && res.body?.success === true, 'D2: authenticated owner delist with durable linkage succeeds');
    assertTrue(res.body?.ownershipBound === true, 'D2: response reports the FULL ownership bind for a linked listing');
    assertTrue(fetchCalls.includes('EndItem'), 'D2: EndItem was actually called for the legitimate path');
  }

  // D3 — a real, different, existing gk_principal (not Creepy's owner)
  // is rejected BEFORE EndItem for the SAME ebayItemId that has durable
  // GrailKey linkage. A fresh, real, transient gk_principal row is
  // created and deleted here, so this is a genuine "Principal A +
  // Principal B's ebayItemId" proof, not a forged/nonexistent id.
  {
    const idRes = await dbClient.query('SELECT uuidv7() as id');
    secondPrincipalId = idRes.rows[0].id;
    await dbClient.query(
      `INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`,
      [secondPrincipalId, 'gk262-test-principal-b']
    );

    const req = { method: 'POST', headers: { authorization: `Bearer ${issueToken({ principalId: secondPrincipalId }).token}` }, body: { ebayItemId: TEST_LISTING_ID } };
    const res = mockRes();
    fetchCalls.length = 0;
    await delistHandler(req, res);
    assertTrue(res.statusCode === 403, 'D3: a real, different principal is rejected (403) for an asset it does not own');
    assertTrue(fetchCalls.length === 0, 'D3: no EndItem call made for the cross-principal attempt');
  }

  // D4 — authenticated request for an ebayItemId with NO durable
  // linkage proceeds as the disclosed AUTHENTICATED STOPGAP
  // (ownershipBound:false) — the real, current shape of every
  // historical listing (0 outcome_event rows in Production today per
  // GK-215/216) — proving the existing real UI caller keeps working.
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${issueToken({ principalId: JIMMY }).token}` }, body: { ebayItemId: `gk262-unlinked-${Date.now()}` } };
    const res = mockRes();
    fetchCalls.length = 0;
    endItemBehavior = 'success';
    await delistHandler(req, res);
    assertTrue(res.statusCode === 200 && res.body?.success === true, 'D4: authenticated delist with NO durable linkage still succeeds (stopgap)');
    assertTrue(res.body?.ownershipBound === false, 'D4: response discloses ownershipBound:false for an unlinked listing');
    assertTrue(fetchCalls.includes('EndItem'), 'D4: EndItem was actually called for the stopgap path');
  }

  // D5 — a real EndItem failure from eBay is still surfaced correctly;
  // the auth/ownership machinery doesn't swallow a genuine eBay-side
  // failure.
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${issueToken({ principalId: JIMMY }).token}` }, body: { ebayItemId: TEST_LISTING_ID } };
    const res = mockRes();
    fetchCalls.length = 0;
    endItemBehavior = 'failure';
    await delistHandler(req, res);
    assertTrue(res.statusCode === 400 && !!res.body?.error, 'D5: a real EndItem failure is still surfaced as a 400 with the eBay error message');
    endItemBehavior = 'success';
  }
} finally {
  await dbClient.query(`DELETE FROM data1_dev.outcome_event WHERE external_listing_id = $1`, [TEST_LISTING_ID]);
  await dbClient.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key = $1`, [TEST_IDEMPOTENCY_KEY]);
  if (secondPrincipalId) {
    await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [secondPrincipalId]);
  }
  console.log('  (test cleanup) transient outcome_event row, idempotency_key row, and principal-B row all deleted\n');
}

// ════════════════════════════════════════════════════════════════════
// PART 2 — /api/chat
// ════════════════════════════════════════════════════════════════════
console.log('=== GK-262 PART 2: /api/chat ===\n');

const chatHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'chat.js')).href)).default;

// C1 — unauthenticated request rejected before any Anthropic call.
{
  const req = { method: 'POST', headers: {}, body: { message: 'what should I sell?' } };
  const res = mockRes();
  fetchCalls.length = 0;
  await chatHandler(req, res);
  assertTrue(res.statusCode === 401, 'C1: unauthenticated chat request rejected with 401');
  assertTrue(!fetchCalls.includes('anthropic-messages-create'), 'C1: no Anthropic call made for an unauthenticated request');
}

// C2 — valid gated request (matching vault key) reaches the normal
// handler path; the mocked Anthropic call is reached and its parsed
// response is returned.
{
  const req = { method: 'POST', headers: { 'x-vault-key': process.env.ACCESS_CODE }, body: { message: 'what should I sell?', collection: [] } };
  const res = mockRes();
  fetchCalls.length = 0;
  await chatHandler(req, res);
  assertTrue(res.statusCode === 200 && res.body?.response === anthropicChatReply.response, 'C2: a validly gated chat request reaches the normal handler path and returns the (mocked) Claude response');
  assertTrue(fetchCalls.includes('anthropic-messages-create'), 'C2: Anthropic was actually called for the valid gated request');
}

// C3 — a valid GrailKey Bearer session also passes the gate (the
// alternate credential accessGate.js already supports).
{
  const { token } = issueToken({ principalId: JIMMY });
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { message: 'hi', collection: [] } };
  const res = mockRes();
  fetchCalls.length = 0;
  await chatHandler(req, res);
  assertTrue(res.statusCode === 200, 'C3: a valid GrailKey session Bearer token also passes the gate');
}

// ════════════════════════════════════════════════════════════════════
// PART 3 — /api/manage
// ════════════════════════════════════════════════════════════════════
console.log('\n=== GK-262 PART 3: /api/manage ===\n');

const manageHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'manage.js')).href)).default;

// M1 — unauthenticated request rejected before any Anthropic call.
{
  const req = { method: 'POST', headers: {}, body: { comics: [{ id: '1', title: 'Test Comic', price: '$10' }] } };
  const res = mockRes();
  fetchCalls.length = 0;
  await manageHandler(req, res);
  assertTrue(res.statusCode === 401, 'M1: unauthenticated manage request rejected with 401');
  assertTrue(!fetchCalls.includes('anthropic-messages-create'), 'M1: no Anthropic call made for an unauthenticated request');
}

// M2 — valid gated request reaches the normal handler path.
{
  const req = { method: 'POST', headers: { 'x-vault-key': process.env.ACCESS_CODE }, body: { comics: [{ id: '1', title: 'Test Comic', price: '$10' }] } };
  const res = mockRes();
  fetchCalls.length = 0;
  await manageHandler(req, res);
  assertTrue(res.statusCode === 200 && res.body?.marketSummary === anthropicManageReply.marketSummary, 'M2: a validly gated manage request reaches the normal handler path and returns the (mocked) Claude analysis');
  assertTrue(fetchCalls.includes('anthropic-messages-create'), 'M2: Anthropic was actually called for the valid gated request');
}

// ════════════════════════════════════════════════════════════════════
await dbClient.end();

console.log(`\n${'='.repeat(60)}`);
console.log(`GK-262 RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
