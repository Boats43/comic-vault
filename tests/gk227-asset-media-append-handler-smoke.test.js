// tests/gk227-asset-media-append-handler-smoke.test.js
//
// GK-227 — POST-CAPTURE PHYSICAL MEDIA APPEND V1. Real handler
// invocation (api/asset-media-append.js) against real Development
// data1_dev. Mints one fresh real test asset via the real
// api/capture-scan.js handler (same convention as
// grailkey-operator-panel-capture-wiring.test.js), then exercises the
// new append endpoint against it.
//
// Invoke: node tests/gk227-asset-media-append-handler-smoke.test.js

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
const appendRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'asset-media-append.js')).href)).default;
const { closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

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

console.log('\n=== GK-227 — /api/asset-media-append real handler + real Development DB ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `gk227-append-${Date.now()}`;

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

// Production-shaped fixture — a real JPEG SOI/EOI-bounded ~48KB buffer of
// pseudo-random bytes, NOT the toy 1x1 PNG this repo's other tests use.
// Not a real decodable photo, but a realistic SIZE/shape, not an
// idealized 68-byte stub.
function realisticJpegBase64(seedByte) {
  const body = Buffer.alloc(48000, seedByte);
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), body, Buffer.from([0xff, 0xd9])]);
  return buf.toString('base64');
}

const createdAssetIds = [];

try {
  console.log('-- setup: mint one real test asset via the real capture-scan handler --\n');
  const collectionItemId = `${TAG}-item`;
  const mintBody = {
    scanPayload: {
      correlationId: randomUUID(),
      collectionItemId,
      book: { title: 'GK-227 Append Test Comic', issue: '1', year: '2020' },
      outcome: { decisionAction: 'RESEARCH', pricingSource: 'ebay-active', price: '$10.00', gradeMultiplier: 1 },
    },
    photos: [{ bytes: realisticJpegBase64(0x01), contentType: 'image/jpeg', captureRole: 'capture-photo' }],
    idempotencyKey: randomUUID(),
  };
  const mintReq = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: mintBody };
  const mintRes = mockRes();
  await captureScanRoute(mintReq, mintRes);
  assertTrue(mintRes.statusCode === 200, `mint -> 200 (got ${mintRes.statusCode}, body=${JSON.stringify(mintRes.body)})`);
  const gkAssetId = mintRes.body?.gkAssetId;
  assertTrue(!!gkAssetId, 'a real gkAssetId was minted for this test');
  createdAssetIds.push(gkAssetId);

  const originalMediaCount = (await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [gkAssetId])).rows[0].n;
  assertTrue(originalMediaCount === 1, `exactly 1 original capture-time media row exists before any append (got ${originalMediaCount})`);

  function req(body) { return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body }; }

  console.log('\n-- append FRONT / BACK / SPINE / PAGES, each a distinct real role --\n');
  const roleResults = {};
  for (const role of ['FRONT', 'BACK', 'SPINE', 'PAGES']) {
    const res = mockRes();
    await appendRoute(req({
      gkAssetId, bytes: realisticJpegBase64(role.charCodeAt(0)), contentType: 'image/jpeg',
      captureView: role, idempotencyKey: `${TAG}-${role}`,
    }), res);
    assertTrue(res.statusCode === 200, `append ${role} -> 200 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
    assertTrue(res.body?.captureView === role, `response echoes captureView=${role}`);
    roleResults[role] = res.body;
  }
  const countAfter4 = (await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [gkAssetId])).rows[0].n;
  assertTrue(countAfter4 === 5, `5 total media rows now exist (1 original + 4 appended) (got ${countAfter4})`);

  console.log('\n-- role remains explicit and queryable (real column read-back) --\n');
  const roleRows = await client.query('SELECT capture_view, content_hash, object_uri FROM media WHERE id = $1', [roleResults.FRONT.mediaId]);
  assertTrue(roleRows.rows[0]?.capture_view === 'FRONT', 'the real durable row carries capture_view=FRONT, independently re-read');

  console.log('\n-- durable byte length/hash can be independently re-read --\n');
  const expectedBuf = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(48000, 'F'.charCodeAt(0)), Buffer.from([0xff, 0xd9])]);
  const { createHash } = await import('node:crypto');
  const expectedHash = createHash('sha256').update(expectedBuf).digest('hex');
  assertTrue(roleRows.rows[0]?.content_hash === expectedHash, 'the durable content_hash matches an independently-recomputed sha256 of the exact bytes sent');

  console.log('\n-- existing original capture media preserved, untouched --\n');
  const originalStillThere = await client.query('SELECT capture_view FROM media WHERE asset_id = $1 AND recorded_at = (SELECT min(recorded_at) FROM media WHERE asset_id = $1)', [gkAssetId]);
  assertTrue(originalStillThere.rows[0]?.capture_view === null, 'the original capture-time media row still has capture_view=NULL — never retroactively assigned a role');

  console.log('\n-- IDEMPOTENCY: duplicate retry (same bytes + same key) does not duplicate --\n');
  const beforeReplay = countAfter4;
  const replayRes = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: realisticJpegBase64('F'.charCodeAt(0)), contentType: 'image/jpeg',
    captureView: 'FRONT', idempotencyKey: `${TAG}-FRONT`,
  }), replayRes);
  assertTrue(replayRes.statusCode === 200, `replay -> 200, not an error (got ${replayRes.statusCode})`);
  assertTrue(replayRes.body?.mediaId === roleResults.FRONT.mediaId, 'replay resolves to the SAME mediaId, not a new one');
  const afterReplay = (await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [gkAssetId])).rows[0].n;
  assertTrue(afterReplay === beforeReplay, `zero new media rows from the replay (before=${beforeReplay}, after=${afterReplay})`);

  console.log('\n-- different real bytes append separately (new idempotencyKey + new bytes -> new row) --\n');
  const detailRes = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: realisticJpegBase64(0x99), contentType: 'image/jpeg',
    captureView: 'DETAIL', idempotencyKey: `${TAG}-DETAIL-1`,
  }), detailRes);
  assertTrue(detailRes.statusCode === 200, `first DETAIL append -> 200 (got ${detailRes.statusCode})`);
  const detailRes2 = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: realisticJpegBase64(0x77), contentType: 'image/jpeg',
    captureView: 'DETAIL', idempotencyKey: `${TAG}-DETAIL-2`,
  }), detailRes2);
  assertTrue(detailRes2.statusCode === 200, `second, different DETAIL append -> 200 (got ${detailRes2.statusCode})`);
  assertTrue(detailRes2.body?.mediaId !== detailRes.body?.mediaId, 'two genuinely different DETAIL photos produce two distinct media rows');
  const countAfterDetails = (await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [gkAssetId])).rows[0].n;
  assertTrue(countAfterDetails === 7, `7 total media rows now (1 original + 4 roles + 2 distinct DETAILs) (got ${countAfterDetails})`);

  console.log('\n-- PROVENANCE: reference URL only is rejected --\n');
  const urlRes = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: 'https://example.com/some-photo.jpg', contentType: 'image/jpeg',
    captureView: 'DETAIL', idempotencyKey: `${TAG}-url-attempt`,
  }), urlRes);
  assertTrue(urlRes.statusCode === 400 && urlRes.body?.error === 'REFERENCE_IMAGE_REJECTED', `a bare URL as "bytes" is rejected with REFERENCE_IMAGE_REJECTED (got ${urlRes.statusCode}, ${JSON.stringify(urlRes.body)})`);

  console.log('\n-- PROVENANCE: synced-proxy path without raw bytes is rejected --\n');
  const proxyRes = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: `/api/collection-image?id=${collectionItemId}&index=0`, contentType: 'image/jpeg',
    captureView: 'DETAIL', idempotencyKey: `${TAG}-proxy-attempt`,
  }), proxyRes);
  assertTrue(proxyRes.statusCode === 400 && proxyRes.body?.error === 'REFERENCE_IMAGE_REJECTED', `a synced-proxy path as "bytes" is rejected (got ${proxyRes.statusCode}, ${JSON.stringify(proxyRes.body)})`);

  console.log('\n-- PROVENANCE: marketplace/downloaded-reference path cannot be promoted --\n');
  const marketplaceRes = mockRes();
  await appendRoute(req({
    // Realistic-shaped eBay image CDN URL, not a live one.
    gkAssetId, bytes: 'https://i.ebayimg.com/images/g/AbCDeFgHiJk123/s-l1600.jpg', contentType: 'image/jpeg',
    captureView: 'BACK', idempotencyKey: `${TAG}-marketplace-attempt`,
  }), marketplaceRes);
  assertTrue(marketplaceRes.statusCode === 400 && marketplaceRes.body?.error === 'REFERENCE_IMAGE_REJECTED', `a realistic eBay CDN image URL cannot be promoted to evidence (got ${marketplaceRes.statusCode}, ${JSON.stringify(marketplaceRes.body)})`);
  const countAfterRejections = (await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [gkAssetId])).rows[0].n;
  assertTrue(countAfterRejections === 7, `none of the 3 rejected attempts created any media row (still ${countAfterRejections})`);

  console.log('\n-- CAPTURE VIEW: unknown/missing role fails closed --\n');
  const unknownRoleRes = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: realisticJpegBase64(0x11), contentType: 'image/jpeg',
    captureView: 'COVER', idempotencyKey: `${TAG}-unknown-role`,
  }), unknownRoleRes);
  assertTrue(unknownRoleRes.statusCode === 400 && unknownRoleRes.body?.error === 'CAPTURE_VIEW_REQUIRED', `an unrecognized role ("COVER") fails closed (got ${unknownRoleRes.statusCode}, ${JSON.stringify(unknownRoleRes.body)})`);
  const missingRoleRes = mockRes();
  await appendRoute(req({
    gkAssetId, bytes: realisticJpegBase64(0x11), contentType: 'image/jpeg',
    idempotencyKey: `${TAG}-missing-role`,
  }), missingRoleRes);
  assertTrue(missingRoleRes.statusCode === 400 && missingRoleRes.body?.error === 'CAPTURE_VIEW_REQUIRED', `an OMITTED role also fails closed, never defaulted (got ${missingRoleRes.statusCode})`);

  console.log('\n-- AUTHORIZATION: wrong principal is rejected --\n');
  const strangerToken = mintTestToken(randomUUID());
  const wrongPrincipalRes = mockRes();
  await appendRoute({ method: 'POST', headers: { authorization: `Bearer ${strangerToken}` }, body: {
    gkAssetId, bytes: realisticJpegBase64(0x22), contentType: 'image/jpeg', captureView: 'DETAIL', idempotencyKey: `${TAG}-wrong-principal`,
  } }, wrongPrincipalRes);
  assertTrue(wrongPrincipalRes.statusCode === 404, `a principal who does not own this asset gets 404, never confirming existence (got ${wrongPrincipalRes.statusCode})`);
  const countAfterWrongPrincipal = (await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [gkAssetId])).rows[0].n;
  assertTrue(countAfterWrongPrincipal === 7, 'the wrong-principal attempt created no media row');

  console.log('\n-- NONEXISTENT ASSET: rejected --\n');
  const nonexistentRes = mockRes();
  await appendRoute(req({
    gkAssetId: randomUUID(), bytes: realisticJpegBase64(0x33), contentType: 'image/jpeg',
    captureView: 'DETAIL', idempotencyKey: `${TAG}-nonexistent-asset`,
  }), nonexistentRes);
  assertTrue(nonexistentRes.statusCode === 404, `a nonexistent gkAssetId gets 404 (got ${nonexistentRes.statusCode})`);

  console.log('\n-- unauthenticated request is rejected before any DB touch --\n');
  const noAuthRes = mockRes();
  await appendRoute({ method: 'POST', headers: {}, body: { gkAssetId, bytes: realisticJpegBase64(0x44), contentType: 'image/jpeg', captureView: 'DETAIL', idempotencyKey: `${TAG}-noauth` } }, noAuthRes);
  assertTrue(noAuthRes.statusCode === 401, `no Bearer token -> 401 (got ${noAuthRes.statusCode})`);

} finally {
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
