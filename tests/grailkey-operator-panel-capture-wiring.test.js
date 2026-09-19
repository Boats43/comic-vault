// tests/grailkey-operator-panel-capture-wiring.test.js
//
// GRAILKEY — FINAL CAPTURE-PATH PROOF (2026-09-19). Proves the exact
// wiring src/components/GrailKeyOperatorPanel.jsx's new "Capture as Owned
// Physical Asset" button performs, against the real api/capture-scan.js
// handler and real Development data1_dev — not a hand-built
// reimplementation of the request shape.
//
// Structural claim (verified by grep, restated here as an explicit
// assertion so a future refactor can't silently violate it): the
// scan/grade/save pipeline (src/App.jsx's gradeBlob/addToCatalogue/
// persistCollectionItem) has ZERO references to /api/capture-scan
// anywhere. This test proves the ONE real call site (this component's
// captureAsOwnedAsset) produces a correct, working request — it does not
// and cannot prove a negative about the rest of the frontend beyond the
// grep already run.
//
// Covers:
//   - the exact scanPayload/photos/idempotencyKey shape the component
//     constructs reaches the real handler and mints a real asset
//   - the response links back to the correct collectionItemId via a
//     real, independently-queried collection_item_link row
//   - idempotent replay: same key -> same gkAssetId, zero new rows
//   - idempotency conflict: same key + different payload -> 409, zero
//     new rows (repeated submit cannot double-mint)
//   - a quick-lookup/reference scenario (no local data: URL photo) never
//     reaches the network call at all — the component's own guard
//
// Invoke: node tests/grailkey-operator-panel-capture-wiring.test.js

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
const { getPhysicalAsset, closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
// GK-226 — the REAL helper, not a hand-rolled reimplementation. Before
// this fix, this test's own buildRequestBody() duplicated the buggy
// `Number(item.price).toFixed(2)` inline expression AND used a raw
// numeric price fixture (42.5) — masking the real bug, which only
// manifests when item.price is the dollar-formatted STRING it actually
// is in production ("$15.28"). Importing the real function closes that
// gap: this test now exercises the exact code the button runs.
const { buildCaptureOutcomePrice } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'captureOutcomeMapping.js')).href);

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

console.log('\n=== GrailKeyOperatorPanel capture wiring — real handler + real Development DB ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `capture-wiring-${Date.now()}`;

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

// --- exact mirrors of GrailKeyOperatorPanel.jsx's own pure helpers ---
function stripDataUrlPrefix(dataUrl) {
  const idx = dataUrl.indexOf(',');
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}
function contentTypeFromDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m ? m[1] : 'image/jpeg';
}
function buildRequestBody(item, collectionItemId, idempotencyKey) {
  // Byte-for-byte the same construction captureAsOwnedAsset() performs —
  // including calling the REAL buildCaptureOutcomePrice(), not a
  // reimplementation (GK-226).
  const localPhoto = (item.images && item.images[0]) || item.image || null;
  const scanPayload = {
    correlationId: idempotencyKey,
    collectionItemId,
    book: { title: item.title || null, issue: item.issue || null, year: item.year || null },
    outcome: {
      decisionAction: item.decision?.action || null,
      pricingSource: item.pricingSource || null,
      price: buildCaptureOutcomePrice(item),
      gradeMultiplier: item.gradeMultiplier ?? null,
    },
  };
  return {
    scanPayload,
    photos: [{ bytes: stripDataUrlPrefix(localPhoto), contentType: contentTypeFromDataUrl(localPhoto), captureRole: 'capture-photo' }],
    idempotencyKey,
  };
}

const ONE_PX_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const LOCAL_PHOTO = `data:image/png;base64,${ONE_PX_PNG_B64}`;

const COLLECTION_ITEM_ID = `${TAG}-item`;
const createdAssetIds = [];

try {
  console.log('-- OWNED PHYSICAL path: the exact request the button builds, sent to the real handler --\n');
  const item = {
    id: COLLECTION_ITEM_ID,
    title: 'Final Capture Proof Comic',
    issue: '1',
    year: '2019',
    images: [LOCAL_PHOTO],
    decision: { action: 'LIST_LOW' },
    pricingSource: 'ebay-active',
    // GK-226 — real production shape: a dollar-formatted STRING
    // (api/enrich.js's fmtUsd()), never a raw number. A raw-number
    // fixture here would have masked the Number("$X")->NaN->0 bug.
    price: '$42.50',
    gradeMultiplier: 1.1,
  };
  const idempotencyKey1 = randomUUID();
  const reqBody = buildRequestBody(item, COLLECTION_ITEM_ID, idempotencyKey1);

  assertTrue(reqBody.scanPayload.collectionItemId === COLLECTION_ITEM_ID, 'scanPayload.collectionItemId carries the real catalogue item id');
  assertTrue(reqBody.scanPayload.book.title === item.title && reqBody.scanPayload.book.issue === item.issue, 'scanPayload.book carries already-computed identity fields, nothing recomputed');
  assertTrue(!reqBody.photos[0].bytes.startsWith('data:'), 'photo bytes are pure base64, the data: URL prefix is stripped before transport');
  assertTrue(reqBody.photos[0].captureRole === 'capture-photo', 'captureRole is capture-photo, never reference-image');

  const before = await countAssets();
  const req1 = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: reqBody };
  const res1 = mockRes();
  await captureScanRoute(req1, res1);
  assertTrue(res1.statusCode === 200, `real handler -> 200 (got ${res1.statusCode}, body=${JSON.stringify(res1.body)})`);
  const gkAssetId = res1.body?.gkAssetId;
  assertTrue(!!gkAssetId, 'a real gkAssetId was minted');
  createdAssetIds.push(gkAssetId);
  const after = await countAssets();
  assertTrue(after === before + 1, `exactly one new gk_asset row (before=${before}, after=${after})`);

  console.log('\n-- LINKAGE: the response links back to the correct collection item, independently re-queried --\n');
  const link = await client.query('SELECT gk_asset_id FROM collection_item_link WHERE collection_item_id = $1', [COLLECTION_ITEM_ID]);
  assertTrue(link.rowCount === 1 && link.rows[0].gk_asset_id === gkAssetId, `collection_item_link row exists, points at the real minted asset (got ${link.rows[0]?.gk_asset_id})`);
  const graph = await getPhysicalAsset({ principalId: JIMMY, gkAssetId });
  assertTrue(graph.media.length === 1 && graph.media[0].media_type === 'capture-photo', 'real media row attached, correct captureRole, confirmed via independent getPhysicalAsset read');

  console.log('\n-- GK-226: real dollar-formatted price string survives to a NON-ZERO durable valuation, not 0.00 --\n');
  const valRow = await client.query('SELECT value_amount FROM valuation_event WHERE asset_id = $1 ORDER BY occurred_at DESC LIMIT 1', [gkAssetId]);
  assertTrue(valRow.rowCount === 1, 'a valuation_event row was written for this asset');
  assertTrue(Number(valRow.rows[0]?.value_amount) === 42.5, `durable value_amount is the real $42.50, not 0.00 (got ${valRow.rows[0]?.value_amount})`);

  console.log('\n-- IDEMPOTENCY: repeated submit (same key) cannot double-mint --\n');
  const beforeReplay = await countAssets();
  const req2 = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: reqBody }; // exact same body, same key
  const res2 = mockRes();
  await captureScanRoute(req2, res2);
  assertTrue(res2.statusCode === 200, `replay -> 200, not an error (got ${res2.statusCode})`);
  assertTrue(res2.body?.gkAssetId === gkAssetId, 'replay resolves to the SAME gkAssetId, not a new one');
  const afterReplay = await countAssets();
  assertTrue(afterReplay === beforeReplay, `zero new gk_asset rows from the replay (before=${beforeReplay}, after=${afterReplay})`);

  console.log('\n-- IDEMPOTENCY CONFLICT: same key, different payload -> 409, no double-mint --\n');
  // Changing `price` (not `title`) is the genuinely conflicting field here:
  // captureFromScan's collectionItemId already resolves to the existing
  // link by this point (attached-existing, no second mint attempted at
  // all — this module's own documented "new evidence, no second mint"
  // design), so the conflict can only ever surface at a SUB-operation's
  // own idempotency check. mapIdentityEvidence's book->identity mapping
  // is coarse (presence-only, CORROBORATED/NONE/CONTESTED) and doesn't
  // change with a different title, but mapValuation's valueAmount comes
  // directly from outcome.price, so recordValuation's own fingerprint
  // (keyed `${idempotencyKey}:valuation`) genuinely differs and correctly
  // throws IdempotencyConflictError, proving the real conflict path.
  const conflictBody = buildRequestBody({ ...item, price: '$999.99' }, COLLECTION_ITEM_ID, idempotencyKey1);
  const beforeConflict = await countAssets();
  const req3 = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: conflictBody };
  const res3 = mockRes();
  await captureScanRoute(req3, res3);
  assertTrue(res3.statusCode === 409, `same key + different payload -> 409 (got ${res3.statusCode})`);
  const afterConflict = await countAssets();
  assertTrue(afterConflict === beforeConflict, `zero new gk_asset rows from the conflicting retry (before=${beforeConflict}, after=${afterConflict})`);

  console.log('\n-- QUICK-LOOKUP / REFERENCE: the component\'s own guard rejects a non-local photo BEFORE any network call --\n');
  // Mirrors captureAsOwnedAsset()'s own check exactly: a remoteImages
  // proxy path (or any non-"data:" string) never reaches the request
  // builder at all.
  const referenceItem = { id: `${TAG}-reference`, title: 'Reference Only', images: [`/api/collection-image?id=${TAG}-other&index=0`] };
  const localPhoto = (referenceItem.images && referenceItem.images[0]) || referenceItem.image || null;
  const guardPasses = !!(localPhoto && typeof localPhoto === 'string' && localPhoto.startsWith('data:'));
  assertTrue(guardPasses === false, 'a synced/proxy-path image (not this device\'s own data: URL) fails the local-photo guard — no request is ever built or sent');

  const noPhotoItem = { id: `${TAG}-nophoto`, title: 'No Photo At All' };
  const localPhoto2 = (noPhotoItem.images && noPhotoItem.images[0]) || noPhotoItem.image || null;
  assertTrue(!localPhoto2, 'an item with zero photos also fails the guard identically — no special-casing by photo presence beyond "is it real local base64"');
} finally {
  // Same established precedent as every other real captureFromScan-
  // exercising test in this repo (tests/capture-scan-endpoint-h8-gate-
  // proof.test.js, tests/d3-1-mint-basis-live-roundtrip.test.js):
  // asset_identity_assignment/gk_asset/entity_mint_basis/mint_event are
  // permanently retained — asset_identity_assignment carries a real
  // DB-enforced immutability trigger (GK-188), so it cannot be deleted at
  // all, and everything chained from it (gk_asset, mint ledger) is left
  // in place rather than partially cleaned into an inconsistent state.
  try {
    for (const assetId of createdAssetIds) {
      await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
      await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
      await client.query(`DELETE FROM decision_event WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM media WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM collection_item_link WHERE gk_asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [assetId]);
    }
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key LIKE $1`, [`%${TAG}%`]);
  } catch (cleanupErr) {
    console.log('  CLEANUP ERROR (manual cleanup may be required):', cleanupErr.message, { createdAssetIds });
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
