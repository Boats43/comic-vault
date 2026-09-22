// tests/u4-generic-asset-capture-live-proof.test.js
//
// U4 (Generic Asset Mode) — real Development data1_dev, real handlers.
// Proves the capture-scan side of the U4.6 required test list:
//
//   - captureFromScan rejects an invalid assetClass (structural gate)
//   - generic capture never asserts comic identity (book:null -> NONE)
//   - generic capture with no outcome field never records a
//     valuation_event or decision_event (the structural proof that this
//     path cannot silently produce an automated comic valuation)
//   - assetClass:'generic' actually lands in gk_asset.asset_class
//   - media attaches to the same asset (server-side evidence, verified
//     via a real, independent getPhysicalAsset read)
//   - collection_item_link stores the stable id + gkAssetId
//   - idempotency: same key -> same gkAssetId, zero new rows
//   - reload/retry (a second call, same key, same bytes) -> same
//     gkAssetId, zero new rows
//   - duplicate submit -> exactly one physical asset total
//   - optional acquisition cost survives as a real acquisition_event
//   - /api/collection round-trip: name/description survive as a real
//     collection_item row with asset_category='generic'
//   - Case A (physical orphan): a generic asset minted with NO
//     collectionItemId is detected by listPhysicalOrphans and NOT by
//     listMissingProjections
//   - Case B (missing projection): a real collection_item_link with no
//     collection_item row is detected by listMissingProjections and
//     recovered via /api/asset-recovery (POST recoverProjection),
//     landing a real collection_item row with the CORRECT asset_category
//     derived from the real gk_asset.asset_class, using the SAME
//     collectionItemId already on the link (never a new id)
//
// Invoke: node tests/u4-generic-asset-capture-live-proof.test.js

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
delete process.env.MILESTONE_TEN_H8_PASS;
delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;

const captureScanRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'capture-scan.js')).href)).default;
const assetRecoveryRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'asset-recovery.js')).href)).default;
const collectionRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href)).default;
const { getPhysicalAsset, closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { captureFromScan, ValidationFailedError } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'index.js')).href);
const { closePool: closeCollectionPool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);

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

console.log('\n=== U4 Generic Asset Mode — real handlers + real Development DB ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `u4-generic-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

async function countAssets() {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM gk_asset`);
  return r.rows[0].n;
}

const ONE_PX_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const createdAssetIds = [];
const createdCollectionItemIds = [];

try {
  console.log('-- structural gate: an invalid assetClass is rejected before any DB call --\n');
  let threwForBadClass = false;
  try {
    await captureFromScan({
      principalId: JIMMY, idempotencyKey: randomUUID(), assetClass: 'spaceship',
      scanPayload: { correlationId: randomUUID() },
    });
  } catch (e) {
    threwForBadClass = e instanceof ValidationFailedError;
  }
  assertTrue(threwForBadClass, 'assetClass "spaceship" throws ValidationFailedError, never silently accepted');

  console.log('\n-- generic capture: mint + media + link, no comic identity, no fabricated valuation --\n');
  const collectionItemId1 = `${TAG}-item1`;
  const idempotencyKey1 = randomUUID();
  const reqBody1 = {
    scanPayload: { correlationId: idempotencyKey1, collectionItemId: collectionItemId1, book: null },
    photos: [{ bytes: ONE_PX_PNG_B64, contentType: 'image/png', captureRole: 'capture-photo' }],
    idempotencyKey: idempotencyKey1,
    assetClass: 'generic',
  };
  const before1 = await countAssets();
  const req1 = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: reqBody1 };
  const res1 = mockRes();
  await captureScanRoute(req1, res1);
  assertTrue(res1.statusCode === 200, `real handler -> 200 (got ${res1.statusCode}, body=${JSON.stringify(res1.body)})`);
  const gkAssetId1 = res1.body?.gkAssetId;
  assertTrue(!!gkAssetId1, 'a real gkAssetId was minted');
  createdAssetIds.push(gkAssetId1);
  const after1 = await countAssets();
  assertTrue(after1 === before1 + 1, `exactly one new gk_asset row (before=${before1}, after=${after1})`);

  const assetRow = await client.query('SELECT asset_class FROM gk_asset WHERE id = $1', [gkAssetId1]);
  assertTrue(assetRow.rows[0]?.asset_class === 'generic', `gk_asset.asset_class is 'generic' (got ${assetRow.rows[0]?.asset_class})`);

  assertTrue(res1.body?.identity?.assignmentId != null, 'an identity assignment row was still created (Ruling 10 — asset never waits for identity)');
  const identityRow = await client.query('SELECT authority, source FROM asset_identity_assignment WHERE asset_id = $1 AND superseded_by IS NULL', [gkAssetId1]);
  assertTrue(identityRow.rows[0]?.authority === 'NONE', `identity authority is NONE for a generic asset with book:null (got ${identityRow.rows[0]?.authority})`);

  assertTrue(res1.body?.valuation === null, 'no valuation was computed (scanPayload carried no outcome field)');
  assertTrue(res1.body?.decision === null, 'no decision was computed (scanPayload carried no outcome field)');
  const valRows = await client.query('SELECT COUNT(*)::int AS n FROM valuation_event WHERE asset_id = $1', [gkAssetId1]);
  assertTrue(valRows.rows[0].n === 0, 'zero valuation_event rows exist for this asset — no automated comic valuation was ever computed or persisted');
  const decRows = await client.query('SELECT COUNT(*)::int AS n FROM decision_event WHERE asset_id = $1', [gkAssetId1]);
  assertTrue(decRows.rows[0].n === 0, 'zero decision_event rows exist for this asset');

  const graph1 = await getPhysicalAsset({ principalId: JIMMY, gkAssetId: gkAssetId1 });
  assertTrue(graph1.media.length === 1 && graph1.media[0].media_type === 'capture-photo', 'server-side media row attached, confirmed via independent getPhysicalAsset read (not the write response alone)');

  const link1 = await client.query('SELECT collection_item_id, gk_asset_id FROM collection_item_link WHERE collection_item_id = $1', [collectionItemId1]);
  assertTrue(link1.rowCount === 1 && link1.rows[0].gk_asset_id === gkAssetId1, 'collection_item_link stores the stable collectionItemId + the real gkAssetId');

  console.log('\n-- optional acquisition cost survives as a real acquisition_event --\n');
  const collectionItemId2 = `${TAG}-item2-acq`;
  const idempotencyKey2 = randomUUID();
  const reqBody2 = {
    scanPayload: {
      correlationId: idempotencyKey2, collectionItemId: collectionItemId2, book: null,
      acquisition: { costAmount: 12.5, costCurrency: 'USD', source: 'other' },
    },
    photos: [{ bytes: ONE_PX_PNG_B64, contentType: 'image/png', captureRole: 'capture-photo' }],
    idempotencyKey: idempotencyKey2,
    assetClass: 'generic',
  };
  const req2 = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: reqBody2 };
  const res2 = mockRes();
  await captureScanRoute(req2, res2);
  assertTrue(res2.statusCode === 200, `acquisition capture -> 200 (got ${res2.statusCode})`);
  const gkAssetId2 = res2.body?.gkAssetId;
  createdAssetIds.push(gkAssetId2);
  const acqRows = await client.query('SELECT cost_amount FROM acquisition_event WHERE asset_id = $1', [gkAssetId2]);
  assertTrue(acqRows.rowCount === 1 && Number(acqRows.rows[0].cost_amount) === 12.5, `real acquisition_event row with cost 12.50 (got ${acqRows.rows[0]?.cost_amount})`);

  console.log('\n-- A1 idempotency: same key + same bytes -> same gkAssetId, zero new rows (simulates reload/retry) --\n');
  const beforeReplay = await countAssets();
  const req1b = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: reqBody1 };
  const res1b = mockRes();
  await captureScanRoute(req1b, res1b);
  assertTrue(res1b.statusCode === 200, `replay -> 200 (got ${res1b.statusCode})`);
  assertTrue(res1b.body?.gkAssetId === gkAssetId1, 'replay resolves to the SAME gkAssetId, not a new one');
  const afterReplay = await countAssets();
  assertTrue(afterReplay === beforeReplay, `zero new gk_asset rows from the replay (before=${beforeReplay}, after=${afterReplay})`);

  console.log('\n-- duplicate submit (double-tap) -> exactly one physical asset total --\n');
  const beforeDup = await countAssets();
  const req1c = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: reqBody1 };
  const res1c = mockRes();
  await captureScanRoute(req1c, res1c);
  const afterDup = await countAssets();
  assertTrue(res1c.body?.gkAssetId === gkAssetId1 && afterDup === beforeDup, 'a third identical submit still resolves to the same single asset, zero new rows');

  console.log('\n-- /api/collection round-trip: name/description survive, asset_category=generic --\n');
  const collReqPost = {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: { id: collectionItemId1, assetCategory: 'generic', attributes: { title: 'Vintage brass compass', description: 'Found at an estate sale' } },
  };
  const collResPost = mockRes();
  await collectionRoute(collReqPost, collResPost);
  assertTrue(collResPost.statusCode === 200, `collection_item create -> 200 (got ${collResPost.statusCode}, body=${JSON.stringify(collResPost.body)})`);
  createdCollectionItemIds.push(collectionItemId1);

  const collReqGet = { method: 'GET', headers: { authorization: `Bearer ${token}` }, query: { id: collectionItemId1 } };
  const collResGet = mockRes();
  await collectionRoute(collReqGet, collResGet);
  assertTrue(collResGet.body?.assetCategory === 'generic', `GET round-trips assetCategory='generic' (got ${collResGet.body?.assetCategory})`);
  assertTrue(collResGet.body?.attributes?.title === 'Vintage brass compass', 'GET round-trips the operator-supplied name');
  assertTrue(collResGet.body?.attributes?.description === 'Found at an estate sale', 'GET round-trips the operator-supplied description');

  console.log('\n-- Case A: a generic asset minted with NO collectionItemId is a physical orphan --\n');
  const orphanKey = randomUUID();
  const orphanReq = {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: {
      scanPayload: { correlationId: orphanKey, book: null }, // no collectionItemId -> never linked
      photos: [{ bytes: ONE_PX_PNG_B64, contentType: 'image/png', captureRole: 'capture-photo' }],
      idempotencyKey: orphanKey, assetClass: 'generic',
    },
  };
  const orphanRes = mockRes();
  await captureScanRoute(orphanReq, orphanRes);
  assertTrue(orphanRes.statusCode === 200, `orphan capture -> 200 (got ${orphanRes.statusCode})`);
  const orphanAssetId = orphanRes.body?.gkAssetId;
  createdAssetIds.push(orphanAssetId);
  const linkCheck = await client.query('SELECT COUNT(*)::int AS n FROM collection_item_link WHERE gk_asset_id = $1', [orphanAssetId]);
  assertTrue(linkCheck.rows[0].n === 0, 'confirmed: zero collection_item_link rows for this asset (a genuine orphan)');

  const orphanScanReq = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
  const orphanScanRes = mockRes();
  await assetRecoveryRoute(orphanScanReq, orphanScanRes);
  assertTrue(orphanScanRes.statusCode === 200, `/api/asset-recovery GET -> 200 (got ${orphanScanRes.statusCode})`);
  const orphanFound = (orphanScanRes.body?.physicalOrphans || []).some((o) => o.gkAssetId === orphanAssetId);
  assertTrue(orphanFound, 'listPhysicalOrphans (via /api/asset-recovery GET) detects this exact orphaned asset');
  const orphanFalselyInMissingProjections = (orphanScanRes.body?.missingProjections || []).some((m) => m.gkAssetId === orphanAssetId);
  assertTrue(!orphanFalselyInMissingProjections, 'the orphan (no link at all) is NOT misclassified as a missing-projection case (no link exists to be missing a projection)');

  console.log('\n-- Case B: a real link with no collection_item row is a missing projection, recoverable server-side --\n');
  const missingProjCollectionItemId = `${TAG}-item3-missingproj`;
  const missingProjKey = randomUUID();
  const missingProjReq = {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: {
      scanPayload: { correlationId: missingProjKey, collectionItemId: missingProjCollectionItemId, book: null },
      photos: [{ bytes: ONE_PX_PNG_B64, contentType: 'image/png', captureRole: 'capture-photo' }],
      idempotencyKey: missingProjKey, assetClass: 'generic',
    },
  };
  const missingProjRes = mockRes();
  await captureScanRoute(missingProjReq, missingProjRes);
  const missingProjAssetId = missingProjRes.body?.gkAssetId;
  createdAssetIds.push(missingProjAssetId);
  // Deliberately never call /api/collection for this id — this IS the
  // "capture reached the link step but never reached the projection
  // step" scenario Case B exists for.
  const preRecoveryRow = await client.query('SELECT COUNT(*)::int AS n FROM collection_item WHERE id = $1', [missingProjCollectionItemId]);
  assertTrue(preRecoveryRow.rows[0].n === 0, 'confirmed: no collection_item row exists yet for this id');

  const scanReq2 = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
  const scanRes2 = mockRes();
  await assetRecoveryRoute(scanReq2, scanRes2);
  const missingFound = (scanRes2.body?.missingProjections || []).some((m) => m.collectionItemId === missingProjCollectionItemId && m.gkAssetId === missingProjAssetId);
  assertTrue(missingFound, 'listMissingProjections (via /api/asset-recovery GET) detects this exact case, cross-device (no local storage involved at all)');

  const recoverReq = {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: { action: 'recoverProjection', collectionItemId: missingProjCollectionItemId },
  };
  const recoverRes = mockRes();
  await assetRecoveryRoute(recoverReq, recoverRes);
  assertTrue(recoverRes.statusCode === 200, `/api/asset-recovery POST recoverProjection -> 200 (got ${recoverRes.statusCode}, body=${JSON.stringify(recoverRes.body)})`);
  createdCollectionItemIds.push(missingProjCollectionItemId);
  assertTrue(recoverRes.body?.collectionItem?.id === missingProjCollectionItemId, 'recovered row uses the SAME collectionItemId already on the link — no new id invented');
  assertTrue(recoverRes.body?.collectionItem?.assetCategory === 'generic', `recovered row's asset_category is derived from the real gk_asset.asset_class, not defaulted/guessed (got ${recoverRes.body?.collectionItem?.assetCategory})`);

  const postRecoveryRow = await client.query('SELECT asset_category FROM collection_item WHERE id = $1', [missingProjCollectionItemId]);
  assertTrue(postRecoveryRow.rowCount === 1 && postRecoveryRow.rows[0].asset_category === 'generic', 'a real collection_item row now exists, independently re-queried');

  console.log('\n-- recovery never re-mints: retrying recoverProjection on the same case is idempotent --\n');
  const beforeSecondRecover = await countAssets();
  const recoverRes2 = mockRes();
  await assetRecoveryRoute({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { action: 'recoverProjection', collectionItemId: missingProjCollectionItemId } }, recoverRes2);
  assertTrue(recoverRes2.statusCode === 404, `a second recovery attempt on an already-resolved case -> 404 (no longer a missing projection) (got ${recoverRes2.statusCode})`);
  const afterSecondRecover = await countAssets();
  assertTrue(afterSecondRecover === beforeSecondRecover, 'zero new gk_asset rows from the retried recovery attempt — never re-mints');
} finally {
  try {
    for (const id of createdCollectionItemIds) {
      await client.query(`DELETE FROM collection_item WHERE id = $1`, [id]);
    }
    for (const assetId of createdAssetIds) {
      if (!assetId) continue;
      await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
      await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
      await client.query(`DELETE FROM acquisition_event WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM decision_event WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM media WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM collection_item_link WHERE gk_asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [assetId]);
    }
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key LIKE $1`, [`%${TAG}%`]);
  } catch (cleanupErr) {
    console.log('  CLEANUP ERROR (manual cleanup may be required):', cleanupErr.message, { createdAssetIds, createdCollectionItemIds });
  }
  await client.end();
  await closePool();
  await closeCollectionPool();

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
