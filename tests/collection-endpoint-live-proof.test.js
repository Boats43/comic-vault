// tests/collection-endpoint-live-proof.test.js
//
// GrailKey Clean Account/Collection Cutover (2026-09-17) — real
// Development DB, real HMAC tokens, real /api/collection handler
// invocation (mirrors tests/p0a-rescan-continuity-handler-proof.test.js
// and tests/capture-scan-endpoint-h8-gate-proof.test.js's exact
// convention). Proves the full CRUD contract, principal-scoping, and
// cross-principal isolation using a genuinely SECOND gk_principal row
// (provisioned here, one-off, the same way the real operator credential
// itself was provisioned — a direct row insert, never a signup
// endpoint — per the operator's explicit "do not build signup, use the
// existing admin/script path" instruction).
//
// Does not touch Jimmy's real principal/collection rows, Creepy's asset
// history, or any physical-asset table. Cleans up every row it creates.
//
// Invoke: node tests/collection-endpoint-live-proof.test.js

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

const collectionRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href)).default;
const { closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);

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

console.log('\n=== /api/collection — live proof (real Development DB) ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba'; // real, live gk_principal row (Principal A)
const TAG = `coll-ep-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

// Principal B — provisioned by a one-off direct row insert, exactly the
// documented shape of db/data0/0008_principal_credential.sql's own "a
// credential is provisioned by a one-off local script, never a public
// endpoint" precedent (no credential row needed here — only a valid
// signed token, minted the identical way every other test in this repo
// mints one, is required to exercise the authenticated API surface).
const PRINCIPAL_B = randomUUID();
await client.query(
  `INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`,
  [PRINCIPAL_B, `${TAG}-principal-b-test-fixture`]
);

const tokenA = mintTestToken(JIMMY);
const tokenB = mintTestToken(PRINCIPAL_B);

const createdIdsA = [];
const createdIdsB = [];

try {
  console.log('-- unauthenticated GET -> 401 --\n');
  {
    const req = { method: 'GET', headers: {}, query: {} };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 401, `no token -> 401 (got ${res.statusCode})`);
  }

  console.log('\n-- create (POST) as Principal A --\n');
  const ITEM_A1 = `${TAG}-a1`;
  createdIdsA.push(ITEM_A1);
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${tokenA}` }, query: {},
      body: { id: ITEM_A1, assetCategory: 'comic', attributes: { title: 'Brave and the Bold', issue: '141', year: '1978' } },
    };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `create -> 200 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
    assertTrue(res.body?.id === ITEM_A1, 'returned item carries the caller-supplied id');
    assertTrue(res.body?.attributes?.title === 'Brave and the Bold', 'attributes round-trip verbatim');
  }

  console.log('\n-- "desktop login, same account" simulation: LIST as Principal A shows the item just created via a SEPARATE request --\n');
  {
    const req = { method: 'GET', headers: { authorization: `Bearer ${tokenA}` }, query: {} };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `list -> 200 (got ${res.statusCode})`);
    const found = (res.body?.items || []).find((i) => i.id === ITEM_A1);
    assertTrue(!!found, 'the item created under Principal A is visible from a fresh, independent authenticated request — cross-device durability proof');
  }

  console.log('\n-- get single item (GET ?id=) as Principal A --\n');
  {
    const req = { method: 'GET', headers: { authorization: `Bearer ${tokenA}` }, query: { id: ITEM_A1 } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200 && res.body?.id === ITEM_A1, `get one -> 200, correct item (got ${res.statusCode})`);
  }

  console.log('\n-- update (PUT ?id=) as Principal A --\n');
  {
    const req = {
      method: 'PUT', headers: { authorization: `Bearer ${tokenA}` }, query: { id: ITEM_A1 },
      body: { attributes: { title: 'Brave and the Bold', issue: '141', year: '1978', price: '$8.93' } },
    };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200 && res.body?.attributes?.price === '$8.93', `update -> 200, new attributes persisted (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
  }

  console.log('\n-- retry create with the SAME id + same attributes (idempotent, no duplicate row) --\n');
  {
    const before = (await client.query('SELECT COUNT(*)::int AS n FROM collection_item WHERE principal_id = $1', [JIMMY])).rows[0].n;
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${tokenA}` }, query: {},
      body: { id: ITEM_A1, assetCategory: 'comic', attributes: { title: 'Brave and the Bold', issue: '141', year: '1978', price: '$8.93' } },
    };
    const res = mockRes();
    await collectionRoute(req, res);
    const after = (await client.query('SELECT COUNT(*)::int AS n FROM collection_item WHERE principal_id = $1', [JIMMY])).rows[0].n;
    assertTrue(res.statusCode === 200, `replayed create -> 200, not an error (got ${res.statusCode})`);
    assertTrue(after === before, `zero new rows from the replay (before=${before}, after=${after})`);
  }

  console.log('\n-- fresh-browser recovery simulation: brand-new principal with ZERO prior writes -> empty list, no cross-contamination --\n');
  const FRESH_PRINCIPAL = randomUUID();
  await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [FRESH_PRINCIPAL, `${TAG}-fresh-device-fixture`]);
  {
    const tokenFresh = mintTestToken(FRESH_PRINCIPAL);
    const req = { method: 'GET', headers: { authorization: `Bearer ${tokenFresh}` }, query: {} };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200 && Array.isArray(res.body?.items) && res.body.items.length === 0, `fresh principal, zero local state -> empty list, not Principal A's items (got ${res.statusCode}, ${res.body?.items?.length} items)`);
  }
  await client.query('DELETE FROM gk_principal WHERE id = $1', [FRESH_PRINCIPAL]);

  console.log('\n-- cross-principal isolation: Principal B creates its own item --\n');
  const ITEM_B1 = `${TAG}-b1`;
  createdIdsB.push(ITEM_B1);
  {
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${tokenB}` }, query: {},
      body: { id: ITEM_B1, assetCategory: 'comic', attributes: { title: 'Principal B Secret Comic', issue: '1', year: '2000' } },
    };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200 && res.body?.id === ITEM_B1, `Principal B create -> 200 (got ${res.statusCode})`);
  }

  console.log('\n-- Principal A cannot see Principal B\'s item in their own list --\n');
  {
    const req = { method: 'GET', headers: { authorization: `Bearer ${tokenA}` }, query: {} };
    const res = mockRes();
    await collectionRoute(req, res);
    const leaked = (res.body?.items || []).some((i) => i.id === ITEM_B1);
    assertTrue(!leaked, 'Principal A\'s list does NOT contain Principal B\'s item');
  }

  console.log('\n-- Principal A cannot GET Principal B\'s item directly by id (404, not 200) --\n');
  {
    const req = { method: 'GET', headers: { authorization: `Bearer ${tokenA}` }, query: { id: ITEM_B1 } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 404, `Principal A GET on Principal B's id -> 404 (got ${res.statusCode}, body=${JSON.stringify(res.body)})`);
  }

  console.log('\n-- Principal A cannot UPDATE Principal B\'s item (404, and the row is provably untouched) --\n');
  {
    const before = await client.query('SELECT attributes, updated_at FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL_B, ITEM_B1]);
    const req = {
      method: 'PUT', headers: { authorization: `Bearer ${tokenA}` }, query: { id: ITEM_B1 },
      body: { attributes: { title: 'HIJACKED BY PRINCIPAL A' } },
    };
    const res = mockRes();
    await collectionRoute(req, res);
    const after = await client.query('SELECT attributes, updated_at FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL_B, ITEM_B1]);
    assertTrue(res.statusCode === 404, `Principal A UPDATE on Principal B's id -> 404 (got ${res.statusCode})`);
    assertTrue(JSON.stringify(before.rows[0].attributes) === JSON.stringify(after.rows[0].attributes), 'Principal B\'s row is byte-identical before/after the rejected cross-principal update attempt');
  }

  console.log('\n-- Principal A cannot DELETE Principal B\'s item (404, row still exists) --\n');
  {
    const req = { method: 'DELETE', headers: { authorization: `Bearer ${tokenA}` }, query: { id: ITEM_B1 } };
    const res = mockRes();
    await collectionRoute(req, res);
    const still = await client.query('SELECT 1 FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL_B, ITEM_B1]);
    assertTrue(res.statusCode === 404, `Principal A DELETE on Principal B's id -> 404 (got ${res.statusCode})`);
    assertTrue(still.rowCount === 1, 'Principal B\'s row still exists after the rejected cross-principal delete attempt');
  }

  console.log('\n-- Principal A CAN delete their own item --\n');
  {
    const req = { method: 'DELETE', headers: { authorization: `Bearer ${tokenA}` }, query: { id: ITEM_A1 } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200 && res.body?.deleted === true, `Principal A deletes their own item -> 200 (got ${res.statusCode})`);
    const gone = await client.query('SELECT 1 FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, ITEM_A1]);
    assertTrue(gone.rowCount === 0, 'row genuinely removed');
    createdIdsA.length = 0; // already deleted, nothing left to clean up
  }
} finally {
  if (createdIdsA.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [JIMMY, createdIdsA]);
  if (createdIdsB.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [PRINCIPAL_B, createdIdsB]);
  await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL_B]);
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
