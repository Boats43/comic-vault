// tests/p0a-rescan-continuity-handler-proof.test.js
//
// P0-A closure — proves rescan/link-drift continuity through the REAL
// HTTP-shaped request/response/auth boundary (src/lib/captureScanHandler.js's
// handleCaptureScan), not a bare direct call to captureFromScan with
// hand-built arguments (tests/p0a-rescan-asset-continuity.test.js already
// covers that service-only level). Mirrors the exact GK-138 handler-smoke
// convention (tests/operator-action-handler-smoke.test.js): a real minted
// token, a real mockRes(), a real handler invocation — proves the CODE PATH
// works end to end, including auth extraction and HTTP status mapping.
//
// Does NOT create a live api/ endpoint or touch App.jsx — see
// src/lib/captureScanHandler.js's own header for why: production
// scanner/capture wiring remains explicitly gated on Milestone Ten, not
// granted by this proof. This is the harness the eventual real
// api/capture-scan.js endpoint would be a copy of.
//
// Does not touch Creepy (01a02d23-1acb-72e8-aae3-8f851308e9cf) or its real
// Chain #2/OperatorAction history — a fresh, disposable asset is used.
//
// Invoke: node tests/p0a-rescan-continuity-handler-proof.test.js

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

const { handleCaptureScan } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'captureScanHandler.js')).href);
const { resolveCollectionItemLink, getPhysicalAsset, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

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

console.log('\n=== P0-A closure — rescan continuity through the real handler boundary ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `p0a-handler-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

console.log('-- no token -> 401 --\n');
{
  const req = { method: 'POST', headers: {}, body: {} };
  const res = mockRes();
  await handleCaptureScan(req, res);
  assertTrue(res.statusCode === 401, `missing token -> 401 (got ${res.statusCode})`);
}

console.log('\n-- wrong method -> 405 --\n');
{
  const req = { method: 'GET', headers: {}, body: {} };
  const res = mockRes();
  await handleCaptureScan(req, res);
  assertTrue(res.statusCode === 405, `GET -> 405 (got ${res.statusCode})`);
}

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

const idempotencyKeysUsed = [];
const createdAssetIds = [];
const createdCollectionItemIds = [];
let originalGkAssetId = null;

try {
  console.log('\n-- real handler call #1: fresh scan (OLD collectionItemId), through the real req/res boundary --\n');
  const OLD_ID = `${TAG}-classic-old`;
  createdCollectionItemIds.push(OLD_ID);
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: OLD_ID, correlationId: randomUUID() }, idempotencyKey: `${TAG}:cap1` },
    };
    idempotencyKeysUsed.push(`${TAG}:cap1:mint`, `${TAG}:cap1:link`, `${TAG}:cap1:identity`);
    const res = mockRes();
    await handleCaptureScan(req, res);
    assertTrue(res.statusCode === 200, `handler call #1 -> 200 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
    assertTrue(res.body?.mintOutcome === 'minted-new', 'handler call #1: mintOutcome=minted-new, fresh asset minted through the real handler');
    originalGkAssetId = res.body?.gkAssetId;
    createdAssetIds.push(originalGkAssetId);
  }

  console.log('\n-- real handler call #2: rescan asserting priorCollectionItemId, through the real req/res boundary --\n');
  const NEW_ID = `${TAG}-classic-new`;
  createdCollectionItemIds.push(NEW_ID);
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: NEW_ID, priorCollectionItemId: OLD_ID, correlationId: randomUUID() }, idempotencyKey: `${TAG}:cap2` },
    };
    idempotencyKeysUsed.push(`${TAG}:cap2:link`, `${TAG}:cap2:identity`);
    const res = mockRes();
    await handleCaptureScan(req, res);
    assertTrue(res.statusCode === 200, `handler call #2 -> 200 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
    assertTrue(
      res.body?.mintOutcome === 'attached-existing-via-continuity-alias' && res.body?.gkAssetId === originalGkAssetId,
      `handler call #2: attaches to the SAME gkAssetId via continuity alias, through the real handler (got mintOutcome=${res.body?.mintOutcome}, gkAssetId=${res.body?.gkAssetId})`
    );
  }

  console.log('\n-- both catalogue ids independently resolve to the SAME gkAssetId (real service call, real DB) --\n');
  {
    const resolveOld = await resolveCollectionItemLink({ principalId: JIMMY, collectionItemId: OLD_ID });
    const resolveNew = await resolveCollectionItemLink({ principalId: JIMMY, collectionItemId: NEW_ID });
    assertTrue(resolveOld?.gkAssetId === originalGkAssetId, 'OLD collectionItemId resolves to the original gkAssetId (alias preserved)');
    assertTrue(resolveNew?.gkAssetId === originalGkAssetId, 'NEW collectionItemId resolves to the SAME gkAssetId (new alias)');
  }

  console.log('\n-- ownership/valuation/decision/operator-action history stays attached under the same gkAssetId --\n');
  {
    // Attach real economic/decision/operator-action history via the
    // (already-proven, service.js-level) real writers, then re-run the
    // handler-boundary rescan a second time to prove the SAME history
    // remains reachable afterward too, not just the bare mint/link facts.
    const { recordValuation, recordDecision, recordOperatorAction } =
      await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
    const val = await recordValuation({ principalId: JIMMY, gkAssetId: originalGkAssetId, valueAmount: 77, method: 'engine-computed', buildSha: 'p0a-handler-test', idempotencyKey: `${TAG}:val` });
    idempotencyKeysUsed.push(`${TAG}:val`);
    const dec = await recordDecision({ principalId: JIMMY, gkAssetId: originalGkAssetId, recommendation: 'LIST_LOW', valuationEventId: val.valuationEventId, idempotencyKey: `${TAG}:dec` });
    idempotencyKeysUsed.push(`${TAG}:dec`);
    const opAction = await recordOperatorAction({ principalId: JIMMY, gkAssetId: originalGkAssetId, decisionEventId: dec.decisionEventId, actionCode: 'HOLD', source: 'test-fixture', idempotencyKey: `${TAG}:opact` });
    idempotencyKeysUsed.push(`${TAG}:opact`);

    // A THIRD real handler call — a second rescan (yet another new
    // browser-side id) asserting continuity against NEW_ID this time —
    // proves the chain survives a SECOND hop, not just one.
    const NEW_ID_2 = `${TAG}-classic-new-2`;
    createdCollectionItemIds.push(NEW_ID_2);
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: NEW_ID_2, priorCollectionItemId: NEW_ID, correlationId: randomUUID() }, idempotencyKey: `${TAG}:cap3` },
    };
    idempotencyKeysUsed.push(`${TAG}:cap3:link`, `${TAG}:cap3:identity`);
    const res = mockRes();
    await handleCaptureScan(req, res);
    assertTrue(
      res.statusCode === 200 && res.body?.gkAssetId === originalGkAssetId,
      `second hop rescan through the handler still resolves to the same gkAssetId (got status=${res.statusCode}, gkAssetId=${res.body?.gkAssetId})`
    );

    const graph = await getPhysicalAsset({ principalId: JIMMY, gkAssetId: originalGkAssetId });
    assertTrue(graph.currentOwner?.owner_principal_id === JIMMY, 'ownership survives two rescan hops, unchanged');
    assertTrue(graph.valuations.some(v => v.id === val.valuationEventId), 'valuation_event survives two rescan hops, still attached');
    assertTrue(graph.decisions.some(d => d.id === dec.decisionEventId), 'decision_event survives two rescan hops, still attached');
    const opCheck = await client.query('SELECT id FROM operator_action_event WHERE id = $1 AND gk_asset_id = $2', [opAction.operatorActionEventId, originalGkAssetId]);
    assertTrue(opCheck.rowCount === 1, 'operator_action_event survives two rescan hops, still attached to the same gkAssetId (never orphaned)');

    const resolveOld = await resolveCollectionItemLink({ principalId: JIMMY, collectionItemId: OLD_ID });
    const resolveMid = await resolveCollectionItemLink({ principalId: JIMMY, collectionItemId: NEW_ID });
    const resolveNew2 = await resolveCollectionItemLink({ principalId: JIMMY, collectionItemId: NEW_ID_2 });
    assertTrue(
      resolveOld?.gkAssetId === originalGkAssetId && resolveMid?.gkAssetId === originalGkAssetId && resolveNew2?.gkAssetId === originalGkAssetId,
      'all THREE catalogue ids across the two rescan hops independently resolve to the same gkAssetId (aliases accumulate, none replaced)'
    );
  }

  console.log('\n-- real handler call: unresolvable priorCollectionItemId fails closed through the real boundary --\n');
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: `${TAG}-classic-bogus`, priorCollectionItemId: `${TAG}-never-existed`, correlationId: randomUUID() }, idempotencyKey: `${TAG}:capbogus` },
    };
    const res = mockRes();
    await handleCaptureScan(req, res);
    assertTrue(res.statusCode === 400, `unresolvable priorCollectionItemId -> HTTP 400 through the real handler, never a silent mint (got ${res.statusCode})`);
  }
} finally {
  for (const assetId of createdAssetIds) {
    await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
    await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
    await client.query(`DELETE FROM operator_action_event WHERE gk_asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM decision_event WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM collection_item_link WHERE gk_asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [assetId]);
    // asset_identity_assignment/gk_asset/entity_mint_basis/mint_event are
    // permanently retained -- same GK-188 precedent as every other real
    // captureFromScan-exercising test in this repo (assignIdentity runs
    // unconditionally on every capture call and its rows are immutable).
  }
  if (createdCollectionItemIds.length > 0) {
    await client.query(`DELETE FROM collection_item_link WHERE collection_item_id = ANY($1::text[])`, [createdCollectionItemIds]);
  }
  if (idempotencyKeysUsed.length > 0) {
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key = ANY($1::text[])`, [idempotencyKeysUsed]);
  }
  await client.end();
  await closePool();

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
