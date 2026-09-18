// tests/capture-scan-endpoint-h8-gate-proof.test.js
//
// GrailKey Capture Endpoint Implementation Authorization (2026-09-17).
// Proves the NEW api/capture-scan.js route through its real request/
// response/auth boundary (mirrors tests/p0a-rescan-continuity-handler-
// proof.test.js's exact convention: real minted token, real mockRes(),
// real handler invocation — not a bare call to captureFromScan with
// hand-built arguments).
//
// Scope: this route wraps src/lib/captureScanHandler.js's handleCaptureScan
// unmodified (auth/rate-limit/error-mapping all pre-existing) and adds
// exactly one new thing — the H8 Production fail-closed gate — plus the
// base64->Buffer photo-transport decode JSON requires. Nothing else about
// captureFromScan/createPhysicalAsset is touched by this dispatch.
//
// Does not touch Creepy (01a02d23-1acb-72e8-aae3-8f851308e9cf) or any of
// its real history — every asset created here is fresh and disposable,
// cleaned up in the finally block, and this suite runs only against the
// real Development database (GRAILKEY_CATALOG_ENVIRONMENT=development),
// never Production.
//
// Invoke: node tests/capture-scan-endpoint-h8-gate-proof.test.js

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

const captureScanRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'capture-scan.js')).href)).default;
const { getPhysicalAsset, closePool } =
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

console.log('\n=== Capture endpoint (api/capture-scan.js) — H8 gate + contract proof ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `cap-ep-${Date.now()}`;

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

const createdAssetIds = [];
const createdCollectionItemIds = [];
const idempotencyKeysUsed = [];

async function countAssets() {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM gk_asset`);
  return r.rows[0].n;
}

try {
  console.log('-- unauthenticated request -> 401, before H8/DB is ever reached --\n');
  {
    const req = { method: 'POST', headers: {}, body: {} };
    const res = mockRes();
    await captureScanRoute(req, res);
    assertTrue(res.statusCode === 401, `no token -> 401 (got ${res.statusCode})`);
  }

  console.log('\n-- auth-order security fix: unauthenticated + Production + H8 unproven -> 401, NEVER 403 --\n');
  {
    // The information-leak this proves closed: before the auth-order
    // fix, an unauthenticated caller in this exact state got 403 with
    // PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN — revealing the endpoint
    // exists, that Production capture is gated, and the internal
    // milestone name, all without ever proving who they were. Auth must
    // now run first regardless of environment/H8 state.
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'production';
    const req = { method: 'POST', headers: {}, body: {} };
    const res = mockRes();
    await captureScanRoute(req, res);
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
    assertTrue(res.statusCode === 401, `unauthenticated + Production + H8 unproven -> 401, not 403 (got ${res.statusCode})`);
    assertTrue(res.body?.error !== 'PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN', 'response never names the H8 gate to an unauthenticated caller');
  }

  console.log('\n-- malformed request (missing scanPayload/idempotencyKey) -> 400 --\n');
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: {} };
    const res = mockRes();
    await captureScanRoute(req, res);
    assertTrue(res.statusCode === 400, `missing required fields -> 400 (got ${res.statusCode})`);
  }

  console.log('\n-- PRODUCTION + H8 not proven -> 403, fail-closed BEFORE any DB work --\n');
  {
    const before = await countAssets();
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'production';
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: `${TAG}-prod-blocked`, correlationId: randomUUID() }, idempotencyKey: `${TAG}:prodblock` },
    };
    const res = mockRes();
    await captureScanRoute(req, res);
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
    const after = await countAssets();
    assertTrue(res.statusCode === 403, `Production, H8 unproven -> 403 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
    assertTrue(res.body?.error === 'PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN', 'error code names the H8 gate explicitly');
    assertTrue(after === before, `zero gk_asset rows created by the blocked Production attempt (before=${before}, after=${after})`);
  }

  console.log('\n-- authenticated + PRODUCTION + H8 PASS explicitly recorded -> gate opens (still Development DB in this test) --\n');
  {
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'production';
    process.env.MILESTONE_TEN_H8_PASS = 'true';
    // A valid, authenticated token this time — proving the GATE (not
    // auth) is what previously blocked, and that it now opens once H8 is
    // recorded PASS. Empty body -> falls through past auth and the gate
    // into handleCaptureScan's own validation (400), never 403/401.
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: {} };
    const res = mockRes();
    await captureScanRoute(req, res);
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
    delete process.env.MILESTONE_TEN_H8_PASS;
    assertTrue(res.statusCode === 400, `authenticated + H8 PASS recorded -> gate no longer blocks, reaches business validation (got ${res.statusCode})`);
  }

  console.log('\n-- Development (non-Production) request with a real operator-captured photo -> 200, asset + media created --\n');
  const CID = `${TAG}-classic`;
  createdCollectionItemIds.push(CID);
  let mintedAssetId;
  {
    const photoBytes = Buffer.from('fake-jpeg-bytes-for-test-only', 'utf8');
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {
        scanPayload: { collectionItemId: CID, correlationId: randomUUID(), book: { title: 'Brave and the Bold', issue: '141', year: '1978' } },
        photos: [{ bytes: photoBytes.toString('base64'), contentType: 'image/jpeg', captureRole: 'capture-photo' }],
        idempotencyKey: `${TAG}:cap1`,
      },
    };
    idempotencyKeysUsed.push(`${TAG}:cap1:mint`, `${TAG}:cap1:link`, `${TAG}:cap1:identity`, `${TAG}:cap1:media:0`);
    const res = mockRes();
    await captureScanRoute(req, res);
    assertTrue(res.statusCode === 200, `permitted non-Production request -> 200 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
    assertTrue(res.body?.mintOutcome === 'minted-new', 'physical asset minted exactly once (mintOutcome=minted-new)');
    assertTrue(!!res.body?.gkAssetId, 'new gkAssetId returned');
    assertTrue(Array.isArray(res.body?.media) && res.body.media.length === 1, `media array returned with 1 entry (got ${JSON.stringify(res.body?.media)})`);
    mintedAssetId = res.body.gkAssetId;
    createdAssetIds.push(mintedAssetId);

    const graph = await getPhysicalAsset({ principalId: JIMMY, gkAssetId: mintedAssetId });
    assertTrue(graph.media.length === 1, 'media linked to the asset, confirmed via a real, independent getPhysicalAsset read (not the write response alone)');
    assertTrue(graph.media[0].media_type === 'capture-photo', `linked media carries the operator-supplied captureRole, not a reference-imagery label (got ${graph.media[0].media_type})`);
  }

  console.log('\n-- unauthenticated media role cannot masquerade as operator physical evidence (invalid captureRole -> 400) --\n');
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {
        scanPayload: { collectionItemId: `${TAG}-refcontam`, correlationId: randomUUID() },
        photos: [{ bytes: Buffer.from('x').toString('base64'), contentType: 'image/jpeg', captureRole: 'reference-image' }],
        idempotencyKey: `${TAG}:refcontam`,
      },
    };
    idempotencyKeysUsed.push(`${TAG}:refcontam:mint`, `${TAG}:refcontam:link`, `${TAG}:refcontam:identity`);
    createdCollectionItemIds.push(`${TAG}-refcontam`);
    const res = mockRes();
    await captureScanRoute(req, res);
    assertTrue(res.statusCode === 400, `'reference-image' captureRole rejected by the enum guard, never silently persisted as physical evidence (got ${res.statusCode})`);
    // The asset mint itself still succeeded before the media step failed —
    // record it for cleanup and confirm it exists, exactly documenting
    // that a rejected photo does not retroactively unmake the asset it
    // was attached to (attachMedia's own contract: media rejection is not
    // asset rejection).
    const r = await client.query(`SELECT gk_asset_id FROM collection_item_link WHERE collection_item_id = $1`, [`${TAG}-refcontam`]);
    if (r.rows[0]) createdAssetIds.push(r.rows[0].gk_asset_id);
  }

  console.log('\n-- retry: same idempotencyKey + same payload -> identical result, no duplicate asset --\n');
  {
    const before = await countAssets();
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {
        scanPayload: { collectionItemId: CID, correlationId: randomUUID(), book: { title: 'Brave and the Bold', issue: '141', year: '1978' } },
        idempotencyKey: `${TAG}:cap1`,
      },
    };
    // collectionItemId already resolves via existingLink -> the mint
    // sub-call is never reached on replay (same as a fresh call would
    // behave); this specifically re-proves the OUTER capture call itself
    // is safe to retry end-to-end through the real route.
    const res = mockRes();
    await captureScanRoute(req, res);
    const after = await countAssets();
    assertTrue(res.statusCode === 200, `replay -> 200, not an error (got ${res.statusCode})`);
    assertTrue(res.body?.gkAssetId === mintedAssetId, 'replay resolves to the SAME gkAssetId, not a new one');
    assertTrue(after === before, `zero new gk_asset rows from the replay (before=${before}, after=${after})`);
  }

  console.log('\n-- retry: same idempotencyKey + DIFFERENT payload -> 409, safely rejected, no duplicate asset --\n');
  {
    const CORR = randomUUID();
    const CID2 = `${TAG}-conflict`;
    createdCollectionItemIds.push(CID2);
    const before = await countAssets();

    const req1 = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: CID2, correlationId: CORR, book: { title: 'Original Title', issue: '1', year: '2000' } }, idempotencyKey: `${TAG}:conflict` },
    };
    idempotencyKeysUsed.push(`${TAG}:conflict:mint`, `${TAG}:conflict:link`, `${TAG}:conflict:identity`);
    const res1 = mockRes();
    await captureScanRoute(req1, res1);
    assertTrue(res1.statusCode === 200, `first call under this key -> 200 (got ${res1.statusCode})`);
    createdAssetIds.push(res1.body?.gkAssetId);

    // Same top-level idempotencyKey, same correlationId (so captureBasis's
    // `key` is identical), but a different book -> captureBasis differs
    // -> createPhysicalAsset's own request fingerprint differs ->
    // IdempotencyConflictError, mapped to 409.
    const req2 = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: `${TAG}-conflict-2`, correlationId: CORR, book: { title: 'Different Title', issue: '2', year: '1999' } }, idempotencyKey: `${TAG}:conflict` },
    };
    const res2 = mockRes();
    await captureScanRoute(req2, res2);
    const after = await countAssets();
    assertTrue(res2.statusCode === 409, `same key, different semantic payload -> 409, never a silent wrong-answer replay and never a raw 500 (got ${res2.statusCode}, body=${JSON.stringify(res2.body)})`);
    assertTrue(after === before + 1, `still exactly one new gk_asset row total — the conflicting retry created nothing (before=${before}, after=${after})`);
  }
} finally {
  for (const assetId of createdAssetIds.filter(Boolean)) {
    await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
    await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
    await client.query(`DELETE FROM media WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM collection_item_link WHERE gk_asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [assetId]);
    // asset_identity_assignment/gk_asset/entity_mint_basis/mint_event are
    // permanently retained -- same GK-188 precedent as every other real
    // captureFromScan-exercising test in this repo.
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
