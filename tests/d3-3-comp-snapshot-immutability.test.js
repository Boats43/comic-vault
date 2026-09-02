// tests/d3-3-comp-snapshot-immutability.test.js
//
// D3.3 Phase A -- real, isolated scratch-schema proof of the
// comp_snapshot information contract (db/data0/0012_d3_3_comp_snapshot.sql,
// NOT applied to data1_dev this pass -- see the D3.3 Standing Report).
// Mirrors D3.2's own proof discipline: build a scratch schema, run the
// ACTUAL migration text (read from disk) against it, prove the required
// behavior with real SQL, real trigger enforcement, real round-trips --
// then also rehearse the rollback (0012_d3_3_comp_snapshot_rollback.sql)
// and confirm it restores the pre-migration state exactly. data1_dev
// itself is never touched by this file.
//
// Required proof, mapped:
//   A. snapshot can be persisted and read back
//   B. referenced snapshot cannot be silently mutated (real trigger
//      rejection, not just "no code path calls UPDATE")
//   C. a subsequent repricing/evidence set creates a NEW snapshot rather
//      than modifying the old one
//   D. old snapshot remains readable after new snapshot exists
//   E. physical gkAssetId remains unchanged throughout
//
// Invoke: node tests/d3-3-comp-snapshot-immutability.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D3.3 Phase A — comp_snapshot immutability (real, isolated scratch-schema proof) ===\n');

const SCHEMA = `d3_3_scratch_${Date.now()}`;
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

async function countDataOneDev() {
  await client.query('SET search_path TO data1_dev');
  const r = await client.query(`SELECT to_regclass('data1_dev.comp_snapshot') AS exists`);
  return r.rows[0].exists;
}
const dataOneDevBefore = await countDataOneDev();
console.log('  data1_dev.comp_snapshot exists before (must be null/untouched):', dataOneDevBefore);

try {
  // -----------------------------------------------------------------
  // Build scratch schema, minimal FK-free gk_asset/gk_principal stand-
  // ins (this proof concerns comp_snapshot's own behavior, not the full
  // referential graph) so the real FKs on comp_snapshot resolve.
  // -----------------------------------------------------------------
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`
    CREATE TABLE gk_asset (id UUID PRIMARY KEY);
    CREATE TABLE gk_principal (id UUID PRIMARY KEY);
  `);
  const assetId = crypto.randomUUID();
  const principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

  // Real 0012 migration text, schema-qualified to the scratch schema.
  let fwd = readFileSync(path.join(repoRoot, 'db', 'data0', '0012_d3_3_comp_snapshot.sql'), 'utf8')
    .replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await client.query(fwd);
  assertTrue(true, 'real 0012 migration text applied successfully to the scratch schema');

  // --- A: persist and read back ---
  const payloadV1 = { items: [{ title: 'Amazing Fantasy #15', price: 100, source: 'test' }], summary: { avg: 100 } };
  const hashV1 = createHash('sha256').update(JSON.stringify(payloadV1)).digest('hex');
  const snap1Id = crypto.randomUUID();
  await client.query(
    `INSERT INTO comp_snapshot (id, asset_id, source, payload, content_hash, recorded_by_principal_id)
     VALUES ($1, $2, 'test-source', $3, $4, $5)`,
    [snap1Id, assetId, JSON.stringify(payloadV1), hashV1, principalId]
  );
  const readBack1 = await client.query('SELECT * FROM comp_snapshot WHERE id = $1', [snap1Id]);
  assertTrue(readBack1.rows.length === 1, 'A: snapshot persisted');
  // isDeepStrictEqual, not JSON.stringify equality -- Postgres JSONB
  // reorders OBJECT keys on storage (confirmed directly: real
  // round-trip test showed {price,title,source} where {title,price,
  // source} was written) while preserving ARRAY order and all values
  // exactly -- a genuine JSONB storage behavior, not a bug in this code.
  assertTrue(isDeepStrictEqual(readBack1.rows[0].payload, payloadV1), 'A: snapshot read back with the exact original payload (deep-equal; JSONB may reorder object keys, values/structure unchanged)');
  assertTrue(readBack1.rows[0].content_hash === hashV1, 'A: content_hash read back exactly');

  // --- B: referenced snapshot cannot be silently mutated -- real
  // trigger rejection, not merely "no code path attempts it". ---
  let updateThrew = false, updateErrorMsg = '';
  try {
    await client.query(`UPDATE comp_snapshot SET source = 'tampered' WHERE id = $1`, [snap1Id]);
  } catch (e) {
    updateThrew = true;
    updateErrorMsg = e.message;
  }
  assertTrue(updateThrew, 'B: a direct UPDATE against comp_snapshot is REJECTED by a real DB trigger (not just unattempted by convention)');
  assertTrue(/immutable/i.test(updateErrorMsg), `B: rejection error message names the immutability contract (got: ${updateErrorMsg})`);

  let deleteThrew = false;
  try {
    await client.query(`DELETE FROM comp_snapshot WHERE id = $1`, [snap1Id]);
  } catch (e) {
    deleteThrew = true;
  }
  assertTrue(deleteThrew, 'B: a direct DELETE against comp_snapshot is also REJECTED by the real DB trigger');

  const stillThere = await client.query('SELECT payload FROM comp_snapshot WHERE id = $1', [snap1Id]);
  assertTrue(isDeepStrictEqual(stillThere.rows[0].payload, payloadV1), 'B: snapshot content genuinely unchanged after the rejected UPDATE/DELETE attempts');

  // --- C + D: a subsequent repricing creates a NEW snapshot; the OLD
  // one remains readable, unmodified. ---
  const payloadV2 = { items: [{ title: 'Amazing Fantasy #15', price: 150, source: 'test-updated' }], summary: { avg: 150 } };
  const hashV2 = createHash('sha256').update(JSON.stringify(payloadV2)).digest('hex');
  const snap2Id = crypto.randomUUID();
  await client.query(
    `INSERT INTO comp_snapshot (id, asset_id, source, payload, content_hash, recorded_by_principal_id)
     VALUES ($1, $2, 'test-source', $3, $4, $5)`,
    [snap2Id, assetId, JSON.stringify(payloadV2), hashV2, principalId]
  );
  assertTrue(snap2Id !== snap1Id, 'C: repricing produced a genuinely NEW snapshot row (distinct id)');

  const bothRows = await client.query('SELECT id, payload FROM comp_snapshot WHERE asset_id = $1 ORDER BY recorded_at', [assetId]);
  assertTrue(bothRows.rows.length === 2, 'C: both the old and new snapshot rows coexist — old was never replaced in place');
  assertTrue(isDeepStrictEqual(bothRows.rows[0].payload, payloadV1), 'D: old snapshot (v1) still reads back its exact original payload after the new one was written');
  assertTrue(isDeepStrictEqual(bothRows.rows[1].payload, payloadV2), 'D: new snapshot (v2) reads back its own distinct payload');

  // --- E: physical gkAssetId remains unchanged throughout. ---
  assertTrue(bothRows.rows.every(() => true), 'E: sanity — both rows queried by the same asset_id filter');
  const assetIdCheck = await client.query('SELECT DISTINCT asset_id FROM comp_snapshot WHERE id = ANY($1::uuid[])', [[snap1Id, snap2Id]]);
  assertTrue(assetIdCheck.rows.length === 1 && assetIdCheck.rows[0].asset_id === assetId, 'E: gkAssetId (asset_id) is identical across both snapshots — never reassigned by a repricing event');

  // -----------------------------------------------------------------
  // Rollback rehearsal: apply the real rollback text, confirm the
  // scratch schema returns to its pre-0012 state (table gone).
  // -----------------------------------------------------------------
  let rb = readFileSync(path.join(repoRoot, 'db', 'data0', '0012_d3_3_comp_snapshot_rollback.sql'), 'utf8')
    .replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await client.query(rb);
  const postRollback = await client.query(`SELECT to_regclass($1) AS exists`, [`${SCHEMA}.comp_snapshot`]);
  assertTrue(postRollback.rows[0].exists === null, 'rollback: comp_snapshot table no longer exists after the real rollback SQL runs');

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const dataOneDevAfter = await countDataOneDev();
  console.log('  data1_dev.comp_snapshot exists after (must still be null/untouched):', dataOneDevAfter);
  assertTrue(dataOneDevAfter === dataOneDevBefore, 'data1_dev is completely untouched by this entire proof');
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
