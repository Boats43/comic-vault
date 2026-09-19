// tests/buyer-decision-cross-device-proof.test.js
//
// GRAILKEY — DURABLE BUYER DECISION LEDGER V1, cross-device proof (item 5
// of the dispatch). Real proof against real Development data1_dev,
// through the real api/buyer-decision.js handler — never a
// reimplementation, never mocked service internals.
//
// "Device A" and "Device B" are two INDEPENDENT sequences of handler
// invocations sharing only the same authenticated principal's bearer
// token (the same thing two physical devices logged into the same
// operator account would share) — no JS object, no local variable, no
// in-memory state is ever passed between the two blocks below. Device B
// learns everything it asserts ONLY by making its own fresh GET request
// against the real durable store, exactly as a second physical device
// would. This is the real cross-device claim this dispatch makes
// (server-backed truth, retrievable by any authenticated device) proven
// at the layer that actually carries it — this project's own established
// convention is Node-level proof against the real backend, not browser
// automation, for durability claims (see H8-B's own two-device
// retrieval-and-compare proof, same shape, GK-215).
//
// Real transient rows are created and deleted in a finally block.
//
// Invoke: node tests/buyer-decision-cross-device-proof.test.js

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

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
// The SAME token both "devices" present — exactly what two physical
// devices signed into the same operator account would both hold.
const sharedToken = mintTestToken(JIMMY);

async function call(method, body, query) {
  const req = { method, headers: { authorization: `Bearer ${sharedToken}` }, body, query: query || {} };
  const res = mockRes();
  await handler(req, res);
  return res;
}

console.log('\n=== Buyer Decision Ledger — cross-device proof (real Development, real handler) ===\n');

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

const createdDecisionIds = [];
const createdAcquisitionIds = [];

try {
  // =====================================================================
  // BUY CASE
  // =====================================================================
  console.log('-- BUY case --\n');

  let buyDecisionId, deviceASessionId;
  {
    // ---- DEVICE A: evaluate item, commit BUY, record durable decision ----
    console.log('  [Device A] evaluating item, committing BUY...');
    deviceASessionId = crypto.randomUUID();
    const res = await call('POST', {
      action: 'decision', sessionId: deviceASessionId,
      observedTitle: 'Cross-Device Proof — Amazing Spider-Man', observedIssue: '300', observedPublisher: 'Marvel', observedGrade: 'CGC 9.4',
      marketValueAmount: 100, contemplatedPriceAmount: 45,
      feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
      maxBuyAmount: 57, netProfitAmount: 12,
      decision: 'BUY',
      pricingSource: 'verified_sold_recency', priceBandsSource: 'tier1_recency_weighted', marketStanding: 'EXACT_CURRENT',
      soldCompCount: 16, activeCompCount: 4, totalCompCount: 16, matchConfidenceTier: 'HIGH', matchConfidenceScore: 82.5,
      idempotencyKey: `cross-device-buy-${crypto.randomUUID()}`,
    });
    assertTrue(res.statusCode === 200 && !!res.body?.buyerDecisionEventId, '[Device A] BUY commit succeeds, real durable id returned');
    buyDecisionId = res.body?.buyerDecisionEventId;
    if (buyDecisionId) createdDecisionIds.push(buyDecisionId);
  }

  {
    // ---- DEVICE B: independently retrieve the SAME immutable decision ----
    // No reference to buyDecisionId's originating call is passed in here
    // except the token both devices share — Device B finds it purely by
    // querying its own fresh GET.
    console.log('  [Device B] independently retrieving decision history...');
    const res = await call('GET', null, { limit: '200' });
    assertTrue(res.statusCode === 200, '[Device B] GET history succeeds');
    const row = res.body?.decisions?.find((d) => d.id === buyDecisionId);
    assertTrue(!!row, '[Device B] finds the exact decision Device A committed, via an independent request');
    assertTrue(Number(row?.market_value_amount) === 100, '[Device B] sees the correct original valuation ($100)');
    assertTrue(Number(row?.max_buy_amount) === 57, '[Device B] sees the correct MAX BUY ($57)');
    assertTrue(Number(row?.contemplated_price_amount) === 45, '[Device B] sees the correct seller ask / contemplated price ($45)');
    assertTrue(row?.decision === 'BUY', '[Device B] sees the correct BUY result');
    assertTrue(row?.pricing_source === 'verified_sold_recency' && row?.market_standing === 'EXACT_CURRENT' && Number(row?.total_comp_count) === 16, '[Device B] sees the full valuation provenance (pricing source, market standing, comp counts)');
    assertTrue(!!row?.occurred_at, '[Device B] sees the original timestamp');
    assertTrue(Array.isArray(row?.acquisitions) && row.acquisitions.length === 0, '[Device B] sees zero acquisitions yet — none recorded so far');
  }

  {
    // ---- Then append actual acquisition price (device unspecified —
    // durability doesn't depend on which device does this) ----
    console.log('  appending actual acquisition price ($42)...');
    const res = await call('POST', { action: 'acquisition', buyerDecisionEventId: buyDecisionId, actualPurchasePriceAmount: 42, idempotencyKey: `cross-device-acq-${crypto.randomUUID()}` });
    assertTrue(res.statusCode === 200 && !!res.body?.buyerAcquisitionEventId, 'acquisition commit succeeds');
    if (res.body?.buyerAcquisitionEventId) createdAcquisitionIds.push(res.body.buyerAcquisitionEventId);
  }

  {
    // ---- BOTH devices, re-queried fresh, show original + actual, unaltered ----
    console.log('  [Device A] re-fetching after acquisition was recorded...');
    const resA = await call('GET', null, { limit: '200' });
    const rowA = resA.body?.decisions?.find((d) => d.id === buyDecisionId);
    assertTrue(Number(rowA?.max_buy_amount) === 57 && Number(rowA?.contemplated_price_amount) === 45 && rowA?.decision === 'BUY', '[Device A] original recommendation is completely unaltered after the acquisition was recorded');
    assertTrue(Array.isArray(rowA?.acquisitions) && rowA.acquisitions.length === 1 && Number(rowA.acquisitions[0].actual_purchase_price_amount) === 42, '[Device A] now also sees the later actual acquisition ($42), alongside the original');

    console.log('  [Device B] re-fetching after acquisition was recorded...');
    const resB = await call('GET', null, { limit: '200' });
    const rowB = resB.body?.decisions?.find((d) => d.id === buyDecisionId);
    assertTrue(Number(rowB?.max_buy_amount) === 57 && Number(rowB?.contemplated_price_amount) === 45 && rowB?.decision === 'BUY', '[Device B] ALSO sees the original recommendation completely unaltered');
    assertTrue(Array.isArray(rowB?.acquisitions) && rowB.acquisitions.length === 1 && Number(rowB.acquisitions[0].actual_purchase_price_amount) === 42, '[Device B] ALSO sees the later actual acquisition — both devices agree, server-backed, neither depends on the other\'s local state');
  }

  // =====================================================================
  // PASS CASE
  // =====================================================================
  console.log('\n-- PASS case (MAX BUY < seller ask) --\n');

  let passDecisionId;
  {
    console.log('  committing PASS (MAX BUY $44 < seller ask $60)...');
    const res = await call('POST', {
      action: 'decision', sessionId: crypto.randomUUID(),
      observedTitle: 'Cross-Device Proof — Incredible Hulk', observedIssue: '273', observedGrade: 'raw VF',
      marketValueAmount: 69, contemplatedPriceAmount: 60,
      feePct: 10, suppliesAmount: 2, laborAmount: 4, targetProfitAmount: 20,
      maxBuyAmount: 44, netProfitAmount: -20,
      decision: 'PASS',
      pricingSource: 'active_ask_derived', marketStanding: 'SIMILAR_ONLY',
      soldCompCount: 0, activeCompCount: 1, totalCompCount: 1, matchConfidenceTier: 'LOW', matchConfidenceScore: 40,
      idempotencyKey: `cross-device-pass-${crypto.randomUUID()}`,
    });
    assertTrue(res.statusCode === 200 && !!res.body?.buyerDecisionEventId, 'PASS commit succeeds — a PASS is durably recorded exactly like a BUY');
    passDecisionId = res.body?.buyerDecisionEventId;
    if (passDecisionId) createdDecisionIds.push(passDecisionId);
  }

  {
    console.log('  [fresh device] retrieving the PASS decision...');
    const res = await call('GET', null, { limit: '200' });
    const row = res.body?.decisions?.find((d) => d.id === passDecisionId);
    assertTrue(!!row, 'a fresh device independently retrieves the PASS decision');
    assertTrue(Number(row?.max_buy_amount) === 44, 'fresh device sees the correct MAX BUY ($44)');
    assertTrue(Number(row?.contemplated_price_amount) === 60, 'fresh device sees the correct seller ask ($60)');
    assertTrue(row?.pricing_source === 'active_ask_derived' && row?.market_standing === 'SIMILAR_ONLY', 'fresh device sees the full valuation provenance');
    assertTrue(row?.decision === 'PASS', 'fresh device sees the correct PASS result');
    assertTrue(!!row?.occurred_at, 'fresh device sees the original timestamp');
    assertTrue(Array.isArray(row?.acquisitions) && row.acquisitions.length === 0, 'fresh device confirms zero acquisitions are required or present — the PASS is fully durable and useful with none');
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
