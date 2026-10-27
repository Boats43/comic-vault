// tests/c3-gate1-real-capture.test.js
//
// C3 GATE 1 - REAL DEVELOPMENT CAPTURE with SCREEN_SUSPECTED present. Real api/capture-scan.js handler,
// real Development Postgres (environment-identity guarded by the assets module). No network, no eBay, no Production.
// Proves: an authenticated, attested capture with an eligible device photo MINTS durable physical evidence even
// when the model flagged SCREEN_SUSPECTED (kept as an UNVERIFIED claim), and that missing attestation, missing
// photo evidence and a wrong principal are still refused with NOTHING minted.
//
// Retained append-only Development fixtures follow the repo convention (gk_asset/identity rows are immutable).

import { readFileSync } from 'node:fs';
import { createHmac, createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
delete process.env.MILESTONE_TEN_H8_PASS;
delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;

const imp = (p) => import(pathToFileURL(path.join(repoRoot, p)).href);
const { buildOwnershipAttestation, OWNERSHIP_ATTESTATION_STATEMENT } = await imp('src/lib/ownershipAttestation.js');
const captureScanRoute = (await imp('api/capture-scan.js')).default;

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  PASS ${m}`); } else { failed++; console.log(`  FAIL ${m}`); } };

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const OTHER = '01a0283a-b1b6-7f90-9b41-000000000c3c';
const tokenFor = (principalId) => {
  const now = Date.now();
  const b64 = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  return `${b64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b64).digest('base64url')}`;
};
const mockRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const post = async (principalId, body) => { const res = mockRes(); await captureScanRoute({ method: 'POST', headers: { authorization: `Bearer ${tokenFor(principalId)}`, 'x-forwarded-for': `c3g1-${randomUUID()}` }, body }, res); return res; };

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const photos = [{ bytes: PNG_B64, contentType: 'image/png', captureRole: 'capture-photo' }];

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const { createCollectionItem } = await imp('src/modules/collection/index.js');
const UNIQUE = Array.from(randomBytes(10), (b) => String.fromCharCode(97 + (b % 26))).join('');
const mkItem = async (tag) => {
  const id = `c3g1-${tag}-${Date.now()}-${UNIQUE}`;
  await createCollectionItem({ principalId: JIMMY, id, assetCategory: 'comic', attributes: { title: `Zqx ${UNIQUE} ${tag}`, issue: '777', year: '2023' } });
  return id;
};
const linkCount = async (itemId) => Number((await client.query('SELECT count(*) FROM collection_item_link WHERE collection_item_id = $1', [itemId])).rows[0].count);
const scanPayload = (itemId, title) => ({
  correlationId: randomUUID(), collectionItemId: itemId,
  captureAuthenticity: { status: 'SCREEN_SUSPECTED', verified: true },
  book: { title, issue: '777', year: '2023' },
  outcome: { decisionAction: null, pricingSource: null },
});

const created = [];
try {
  console.log('\n--- A. authenticated + attested + eligible device photo + SCREEN_SUSPECTED -> MINTS ---');
  const itemA = await mkItem('a'); created.push(itemA);
  const resA = await post(JIMMY, { assetClass: 'comic', ownershipAttestation: buildOwnershipAttestation('operator-panel'), scanPayload: scanPayload(itemA, `Zqx ${UNIQUE} a`), photos, idempotencyKey: randomUUID() });
  ok(resA.statusCode === 200 && !!resA.body?.gkAssetId, `capture mints durable physical evidence (got ${resA.statusCode} ${String(JSON.stringify(resA.body)).slice(0, 100)})`);
  const gk = resA.body?.gkAssetId;
  const ev = await client.query(`SELECT payload FROM domain_event WHERE event_type = 'asset.minted' AND subject->>'entity_id' = $1`, [gk]);
  const prov = ev.rows[0]?.payload?.provenance;
  ok(prov?.captureAuthenticity?.status === 'SCREEN_SUSPECTED' && prov.captureAuthenticity.verified === false && prov.captureAuthenticity.basis === 'model-claim', 'the SCREEN_SUSPECTED read is recorded durably as an UNVERIFIED model claim (a client verified:true is forced false)');
  ok(prov?.ownershipAttestation?.attested === true && prov.ownershipAttestation.statement === OWNERSHIP_ATTESTATION_STATEMENT, 'the operator attestation is recorded as an ASSERTION (not as verified legal ownership)');
  const med = await client.query('SELECT content_hash FROM media WHERE asset_id = $1', [gk]);
  const expected = createHash('sha256').update(Buffer.from(PNG_B64, 'base64')).digest('hex');
  ok(med.rows.length === 1 && med.rows[0].content_hash === expected, 'durable media is hash-bound to the exact photo bytes (SHA-256 match)');
  ok(await linkCount(itemA) === 1, 'exactly one collection_item_link was created for the asset');
  const own = await client.query('SELECT count(*) FROM current_owner WHERE asset_id = $1', [gk]);
  ok(Number(own.rows[0].count) === 1, 'ownership projection belongs to the authenticated principal');

  console.log('\n--- B. negative controls: nothing is minted ---');
  const itemB = await mkItem('b'); created.push(itemB);
  const resB = await post(JIMMY, { assetClass: 'comic', scanPayload: scanPayload(itemB, `Zqx ${UNIQUE} b`), photos, idempotencyKey: randomUUID() });
  ok(resB.statusCode === 400 && resB.body?.code === 'OWNERSHIP_ATTESTATION_REQUIRED' && await linkCount(itemB) === 0, 'missing attestation: refused, nothing minted');
  const resB2 = await post(JIMMY, { assetClass: 'comic', ownershipAttestation: { attested: true }, scanPayload: scanPayload(itemB, `Zqx ${UNIQUE} b`), photos, idempotencyKey: randomUUID() });
  ok(resB2.statusCode === 400 && resB2.body?.code === 'OWNERSHIP_ATTESTATION_REQUIRED' && await linkCount(itemB) === 0, 'bare { attested: true }: refused, nothing minted');
  const resB3 = await post(JIMMY, { assetClass: 'comic', ownershipAttestation: buildOwnershipAttestation('operator-panel'), scanPayload: scanPayload(itemB, `Zqx ${UNIQUE} b`), photos: [], idempotencyKey: randomUUID() });
  ok(resB3.statusCode >= 400 && resB3.statusCode < 500 && await linkCount(itemB) === 0, `missing photo evidence: refused (${resB3.statusCode}), nothing minted`);
  const resB4 = await post(JIMMY, { assetClass: 'comic', ownershipAttestation: buildOwnershipAttestation('operator-panel'), scanPayload: scanPayload(itemB, `Zqx ${UNIQUE} b`), photos: [{ bytes: Buffer.from('not an image at all').toString('base64'), contentType: 'text/plain', captureRole: 'capture-photo' }], idempotencyKey: randomUUID() });
  ok(resB4.statusCode >= 400 && resB4.statusCode < 500 && await linkCount(itemB) === 0, `ineligible (non-image) photo evidence: refused (${resB4.statusCode}), nothing minted`);
  const resB5 = await post(OTHER, { assetClass: 'comic', ownershipAttestation: buildOwnershipAttestation('operator-panel'), scanPayload: scanPayload(itemB, `Zqx ${UNIQUE} b`), photos, idempotencyKey: randomUUID() });
  ok(resB5.statusCode >= 400 && resB5.statusCode < 500 && await linkCount(itemB) === 0, `wrong principal (another account's collection item): refused (${resB5.statusCode}), nothing minted`);
  const resB6 = await post(JIMMY, { ownershipAttestation: buildOwnershipAttestation('operator-panel'), scanPayload: scanPayload(itemB, `Zqx ${UNIQUE} b`), photos, idempotencyKey: randomUUID() });
  ok(resB6.statusCode === 400 && await linkCount(itemB) === 0, 'missing category: refused, nothing minted');
} finally {
  for (const id of created) {
    await client.query('DELETE FROM collection_item WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM collection_item_link WHERE collection_item_id = $1)', [id]).catch(() => {});
  }
  await client.end();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
