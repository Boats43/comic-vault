// tests/buyer-decision-handler-smoke.test.js
//
// GRAILKEY — DURABLE BUYER DECISION LEDGER V1. Handler-Wiring
// Verification (CLAUDE.md standing rule) for the new api/buyer-decision.js
// endpoint — a real invocation of the real exported handler with a mock
// req/res, a real minted bearer token (same HMAC-reconstruction
// convention tests/list-ebay-outcome1-handler-smoke.test.js already
// uses — token.js itself stays module-private, never imported directly),
// and the real Development database. No mocked service layer.
//
// Real transient rows are created and deleted in a finally block — this
// test's synthetic BUY/PASS numbers are not real economic history, never
// left in the durable ledger it is proving.
//
// Invoke: node tests/buyer-decision-handler-smoke.test.js

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
if (!process.env.GRAILKEY_SESSION_SECRET || process.env.GRAILKEY_SESSION_SECRET.length < 32) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}

const { default: handler } = await import(pathToFileURL(path.join(repoRoot, 'api', 'buyer-decision.js')).href);
const { closePool: closeBuyerPool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'buyer', 'index.js')).href);

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

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

// Real gk_principal row used throughout this project's own handler-smoke
// tests (tests/list-ebay-outcome1-handler-smoke.test.js's own JIMMY
// constant) — confirmed real and live in Development this same dispatch.
const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const token = mintTestToken(JIMMY);

console.log('\n=== api/buyer-decision.js — real handler smoke (real Development DB) ===\n');

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

const createdDecisionIds = [];
const createdAcquisitionIds = [];

try {
  // -------------------------------------------------------------------
  // Auth gate
  // -------------------------------------------------------------------
  console.log('-- Auth gate --\n');
  {
    const req = { method: 'GET', headers: {}, query: {} };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 401, `GET with no Authorization header -> 401 (got ${res.statusCode})`);
  }
  {
    const req = { method: 'GET', headers: { authorization: 'Bearer not-a-real-token' }, query: {} };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 401, `GET with a garbage token -> 401 (got ${res.statusCode})`);
  }

  // -------------------------------------------------------------------
  // POST action=decision — BUY
  // -------------------------------------------------------------------
  console.log('\n-- POST action=decision (BUY) --\n');
  const sessionId = crypto.randomUUID();
  const buyKey = `handler-smoke-buy-${crypto.randomUUID()}`;
  let buyDecisionId;
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {
        action: 'decision', sessionId,
        observedTitle: 'Handler Smoke Test Comic', observedGrade: 'CGC 9.4',
        marketValueAmount: 100, contemplatedPriceAmount: 45,
        feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
        maxBuyAmount: 57, netProfitAmount: 12,
        decision: 'BUY',
        pricingSource: 'verified_sold_recency', marketStanding: 'EXACT_CURRENT',
        soldCompCount: 16, totalCompCount: 16,
        idempotencyKey: buyKey,
      },
    };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 200, `POST decision (BUY) -> 200 (got ${res.statusCode}, body ${JSON.stringify(res.body)})`);
    assertTrue(!!res.body?.buyerDecisionEventId, 'response carries a real buyerDecisionEventId');
    buyDecisionId = res.body?.buyerDecisionEventId;
    if (buyDecisionId) createdDecisionIds.push(buyDecisionId);
  }

  // Idempotent retry through the real HTTP handler
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {
        action: 'decision', sessionId,
        marketValueAmount: 100, contemplatedPriceAmount: 45,
        feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
        maxBuyAmount: 57, decision: 'BUY',
        idempotencyKey: buyKey,
      },
    };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 200 && res.body?.buyerDecisionEventId === buyDecisionId, 'a retried POST with the same idempotencyKey replays the same id through the real handler — no duplicate row');
  }

  // -------------------------------------------------------------------
  // POST action=decision — PASS
  // -------------------------------------------------------------------
  console.log('\n-- POST action=decision (PASS) --\n');
  const passSessionId = crypto.randomUUID();
  let passDecisionId;
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {
        action: 'decision', sessionId: passSessionId,
        observedTitle: 'Handler Smoke PASS Comic', marketValueAmount: 69, contemplatedPriceAmount: 60,
        feePct: 10, suppliesAmount: 2, laborAmount: 4, targetProfitAmount: 20,
        maxBuyAmount: 44, netProfitAmount: -20,
        decision: 'PASS', marketStanding: 'SIMILAR_ONLY',
        idempotencyKey: `handler-smoke-pass-${crypto.randomUUID()}`,
      },
    };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 200, `POST decision (PASS) -> 200 (got ${res.statusCode})`);
    passDecisionId = res.body?.buyerDecisionEventId;
    if (passDecisionId) createdDecisionIds.push(passDecisionId);
  }

  // -------------------------------------------------------------------
  // POST action=acquisition
  // -------------------------------------------------------------------
  console.log('\n-- POST action=acquisition --\n');
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { action: 'acquisition', buyerDecisionEventId: buyDecisionId, actualPurchasePriceAmount: 42, idempotencyKey: `handler-smoke-acq-${crypto.randomUUID()}` },
    };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 200, `POST acquisition -> 200 (got ${res.statusCode}, body ${JSON.stringify(res.body)})`);
    if (res.body?.buyerAcquisitionEventId) createdAcquisitionIds.push(res.body.buyerAcquisitionEventId);
  }
  {
    // Missing action entirely -> 400, never a 500
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { foo: 'bar' } };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 400, `POST with no recognized action -> 400 (got ${res.statusCode})`);
  }
  {
    // Missing required field -> 400, never a 500, never a silent write
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { action: 'decision', sessionId: crypto.randomUUID(), decision: 'BUY' /* missing marketValueAmount etc. */ },
    };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 400, `POST decision missing required numeric fields -> 400 (got ${res.statusCode})`);
  }

  // -------------------------------------------------------------------
  // GET history
  // -------------------------------------------------------------------
  console.log('\n-- GET history --\n');
  {
    const req = { method: 'GET', headers: { authorization: `Bearer ${token}` }, query: { limit: '200' } };
    const res = mockRes();
    await handler(req, res);
    assertTrue(res.statusCode === 200 && Array.isArray(res.body?.decisions), `GET -> 200 with a decisions array (got ${res.statusCode})`);
    const buyRow = res.body.decisions.find((d) => d.id === buyDecisionId);
    const passRow = res.body.decisions.find((d) => d.id === passDecisionId);
    assertTrue(!!buyRow, 'the real BUY decision just written is present in the real GET response');
    assertTrue(!!passRow, 'the real PASS decision just written is present in the real GET response — PASS is not filtered out');
    assertTrue(Number(buyRow?.contemplated_price_amount) === 45, 'BUY row in the real GET response preserves its original contemplated price ($45) after the acquisition write');
    assertTrue(Array.isArray(buyRow?.acquisitions) && buyRow.acquisitions.length === 1, 'BUY row in the real GET response carries the real attached acquisition');
    assertTrue(Array.isArray(passRow?.acquisitions) && passRow.acquisitions.length === 0, 'PASS row in the real GET response carries zero acquisitions, durable and complete regardless');
  }

} finally {
  for (const id of createdAcquisitionIds) {
    await dbClient.query('DELETE FROM data1_dev.buyer_acquisition_event WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdDecisionIds) {
    await dbClient.query('DELETE FROM data1_dev.buyer_decision_event WHERE id = $1', [id]).catch(() => {});
  }
  console.log(`\n  cleaned up ${createdAcquisitionIds.length} acquisition row(s) and ${createdDecisionIds.length} decision row(s) this test created`);
  await dbClient.end();
  await closeBuyerPool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
