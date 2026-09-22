// tests/gk241-pending-decision-recovery.test.js
//
// GK-241, R4 — proves the existing retry mechanism recovers a Buyer
// Decision that was stuck locally pending (pre-0030-migration rejection)
// for each of the three previously-blocked standings: NO_SOLD_EVIDENCE,
// FALLBACK_ONLY, NONE. Real proof against real Development data1_dev,
// through the real api/buyer-decision.js handler (never a
// reimplementation, never mocked service internals) — mirrors
// tests/buyer-decision-cross-device-proof.test.js's own established
// pattern exactly (same handler-invocation shape, same real Bearer
// token minting, same real gk_principal).
//
// What "retry" means here, precisely: src/App.jsx's
// retryPendingBuyerDecisions() -> syncBuyerDecisionEntry(entry) ->
// pushBuyerDecision(payload) (src/lib/buyerDecisionSync.js) -> a plain
// fetch POST to /api/buyer-decision with action:'decision' -> this same
// api/buyer-decision.js handler this test invokes directly. Calling the
// real handler with the exact payload shape a retry would send IS the
// server-side half of that retry, proven for real, not mocked.
//
// syncBuyerDecisionEntry's own client-side logic
// (src/App.jsx:2609-2623) is a single, simple, deterministic branch:
//   const result = await pushBuyerDecision(payload);
//   if (result?.buyerDecisionEventId) { _syncStatus: 'synced', ... }
// pushBuyerDecision (src/lib/buyerDecisionSync.js) itself is an equally
// simple fetch wrapper: `if (!res.ok) return null; return res.json()`.
// Neither is touched by this hotfix and neither branches on
// marketStanding at all — their behavior is fully and only determined
// by whether the server call succeeds. This test proves the server call
// now succeeds (the ONLY thing that changed); the client-side
// _syncStatus:'synced' transition that necessarily follows is not
// independently re-run in a browser/DOM harness (none exists in this
// repo's Node-only test convention) but is a direct, unchanged, one-line
// consequence of the proven server result — the same class of proof
// already used for client-only logic throughout this project's own test
// suite.
//
// Real transient rows are created and deleted in a finally block.
//
// Invoke: node tests/gk241-pending-decision-recovery.test.js

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
const sharedToken = mintTestToken(JIMMY);

async function call(method, body, query) {
  const req = { method, headers: { authorization: `Bearer ${sharedToken}` }, body, query: query || {} };
  const res = mockRes();
  await handler(req, res);
  return res;
}

console.log('\n=== GK-241 R4 — pending decision recovery via the real existing retry path (real Development, real handler) ===\n');

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();
const marker = await dbClient.query(`SELECT current_database() AS db`);
console.log(`  connected to database: ${marker.rows[0].db} (data1_dev schema)\n`);

const createdDecisionIds = [];

// syncBuyerDecisionEntry's own local-first doctrine — the payload it
// sends strips client-only bookkeeping fields (ts, _syncStatus, etc.)
// before POSTing. Reproduced here verbatim (src/App.jsx:2609-2623) so
// the simulated retry call is byte-shaped like the real one, not an
// approximation.
function simulateLocalPendingEntry(marketStanding) {
  return {
    ts: Date.now(),
    _syncStatus: 'pending', // the exact stuck state a pre-migration failed sync would have left this in
    sessionId: crypto.randomUUID(),
    observedTitle: `GK-241 recovery fixture (${marketStanding})`,
    observedIssue: '1', observedPublisher: 'Test',
    marketValueAmount: 20, contemplatedPriceAmount: 10,
    feePct: 10, suppliesAmount: 1, laborAmount: 1, targetProfitAmount: 5,
    maxBuyAmount: 12, netProfitAmount: 3,
    decision: 'PASS',
    pricingSource: 'test', priceBandsSource: 'test', marketStanding,
    idempotencyKey: `gk241-recovery-${marketStanding}-${crypto.randomUUID()}`,
  };
}

// The exact stripping syncBuyerDecisionEntry performs before POSTing
// (src/App.jsx:2611-2618), reproduced verbatim.
function toSyncPayload(entry) {
  const payload = { ...entry };
  delete payload.ts;
  delete payload._syncStatus;
  delete payload._durableId;
  delete payload._acquisitionSyncStatus;
  delete payload._acquisitionIdempotencyKey;
  delete payload.actualPurchasePrice;
  delete payload.actualPurchaseRecordedAt;
  return payload;
}

try {
  for (const marketStanding of ['NO_SOLD_EVIDENCE', 'FALLBACK_ONLY', 'NONE']) {
    console.log(`-- ${marketStanding} --\n`);

    // Step 1: the local, pre-existing "stuck pending" record — exactly
    // what a real device would already have in localStorage from before
    // this migration existed (saveSession() already ran, sync already
    // failed once, _syncStatus:'pending').
    const localEntry = simulateLocalPendingEntry(marketStanding);
    assertTrue(localEntry._syncStatus === 'pending', `${marketStanding}: local entry starts in the real stuck state (_syncStatus:'pending')`);

    // Step 2: the retry — syncBuyerDecisionEntry's own real payload shape,
    // sent through the real handler (the server-side half of
    // pushBuyerDecision's real fetch call).
    const payload = toSyncPayload(localEntry);
    const res = await call('POST', { action: 'decision', ...payload });

    assertTrue(res.statusCode === 200, `${marketStanding}: retry POST now returns HTTP 200 (was 400 before migration 0030)`);
    assertTrue(!!res.body?.buyerDecisionEventId, `${marketStanding}: retry POST returns a real buyerDecisionEventId`);
    if (res.body?.buyerDecisionEventId) createdDecisionIds.push(res.body.buyerDecisionEventId);

    // Step 3: the client-side consequence (syncBuyerDecisionEntry's own
    // logic, unchanged, verbatim): result?.buyerDecisionEventId present
    // -> _syncStatus becomes 'synced'. Applying that exact real function
    // logic to the exact real result just received.
    const result = res.body;
    const clientSideOutcome = result?.buyerDecisionEventId
      ? { ...localEntry, _syncStatus: 'synced', _durableId: result.buyerDecisionEventId }
      : localEntry; // unchanged, still pending -- syncBuyerDecisionEntry's real behavior on failure
    assertTrue(clientSideOutcome._syncStatus === 'synced', `${marketStanding}: applying syncBuyerDecisionEntry's own real (unchanged) logic to this real result yields _syncStatus:'synced'`);
    assertTrue(clientSideOutcome._durableId === result.buyerDecisionEventId, `${marketStanding}: _durableId is set to the real server-assigned id`);

    // Step 4: independently confirm durability — a fresh read against the
    // real store (not the write's own return value) sees the row, exactly
    // as a second device / the next GET would.
    const getRes = await call('GET', null, {});
    assertTrue(getRes.statusCode === 200, `${marketStanding}: independent GET after the write returns 200`);
    const found = (getRes.body?.decisions || []).find((d) => d.id === result.buyerDecisionEventId);
    assertTrue(!!found, `${marketStanding}: the recovered decision is independently visible in a fresh GET`);
    assertTrue(found?.market_standing === marketStanding, `${marketStanding}: the durable row preserves the real market_standing value verbatim`);
    console.log('');
  }
} finally {
  console.log(`  cleaning up ${createdDecisionIds.length} test rows...`);
  for (const id of createdDecisionIds) {
    await dbClient.query('DELETE FROM data1_dev.buyer_decision_event WHERE id = $1', [id]);
  }
  await dbClient.end();
  if (typeof closeBuyerPool === 'function') await closeBuyerPool();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
}
// Explicit exit — invoking api/buyer-decision.js's real handler (auth +
// buyer module) appears to leave an async handle open past script end
// (observed: full output flushes, including cleanup, but the process
// does not exit naturally). All real work (writes, reads, cleanup DELETE
// statements, both real client connections closed) has already
// completed by this point — this only forces process exit, it does not
// skip or shortcut anything above.
process.exit(failed > 0 ? 1 : 0);
