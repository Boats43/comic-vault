// tests/gk227-0029-migration-contract.test.js
//
// GK-227 -- real, isolated scratch-schema proof of
// db/data0/0029_media_capture_view.sql (additive media.capture_view
// column + CHECK). Mirrors the beta1a-0022/d5a scratch-proof discipline
// exactly (same connection pattern, same backend-PID + current_schema()
// safety guard refusing to ever touch data1_dev). data1_dev is never
// touched by this file.
//
// Since 0029 ALTERs an existing table rather than creating a new one,
// this test clones the real data1_dev.media table's structure
// (`LIKE data1_dev.media INCLUDING ALL`) into the scratch schema first,
// so the migration text runs against a structurally faithful copy, not
// a hand-typed approximation.
//
// Invoke: node tests/gk227-0029-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

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
const assertRejected = async (fn, label, expectedFragment) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = !expectedFragment || String(e.message).includes(expectedFragment);
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 110)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-227 -- 0029 media.capture_view migration contract (real, isolated scratch-schema proof) ===\n');

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client, sessionPid } = await assertScratchSchemaTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'gk227-0029-migration-contract',
});
console.log('  dedicated backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

{
  await client.query('SET search_path TO data1_dev');
  let refused = false;
  try { await assertScratchTarget('some-scratch-schema', 'negative proof'); }
  catch (e) { refused = /SAFETY ABORT/.test(e.message) && /data1_dev/.test(e.message); }
  assertTrue(refused, 'D0: intentionally pointing this client at data1_dev causes the guard to refuse before any DDL');
}

const SCHEMA = `gk227_0029_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  // Structurally faithful clone of the REAL data1_dev.media table,
  // including its existing constraints/indexes -- not a hand-typed
  // approximation.
  await client.query(`CREATE TABLE media (LIKE data1_dev.media INCLUDING ALL)`);

  const beforeCols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'media'`,
    [SCHEMA]
  );
  assertTrue(!beforeCols.rows.some(r => r.column_name === 'capture_view'), 'pre-migration: capture_view does not exist on the cloned table');

  await assertSucceeds(() => client.query(qualify(read('0029_media_capture_view.sql'))), 'setup: 0029 applies cleanly to the cloned table');

  const afterCols = await client.query(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'media' AND column_name = 'capture_view'`,
    [SCHEMA]
  );
  assertTrue(afterCols.rows.length === 1 && afterCols.rows[0].is_nullable === 'YES', 'capture_view column exists and is nullable');

  const principalId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  // Minimal FK targets media.asset_id/recorded_by_principal_id reference
  // in the real table -- clone them here too so inserts are legal.
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`ALTER TABLE media ADD CONSTRAINT media_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES gk_asset(id)`);
  await client.query(`ALTER TABLE media ADD CONSTRAINT media_recorded_by_principal_id_fkey FOREIGN KEY (recorded_by_principal_id) REFERENCES gk_principal(id)`);
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

  // ===================================================================
  // Positive path -- NULL capture_view still legal (pre-existing/historical
  // rows, including the real original capture-time photo on every
  // already-minted asset, never had this concept and must not be
  // retroactively coerced).
  // ===================================================================
  await assertSucceeds(
    () => client.query(
      `INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id) VALUES ($1,$2,'capture-photo',$3,$4)`,
      [crypto.randomUUID(), assetId, 'a'.repeat(64), principalId]
    ),
    'a row with capture_view omitted (NULL) still inserts cleanly -- historical rows are never coerced'
  );

  // ===================================================================
  // Positive path -- each of the 5 real roles inserts cleanly
  // ===================================================================
  for (const role of ['FRONT', 'BACK', 'SPINE', 'PAGES', 'DETAIL']) {
    await assertSucceeds(
      () => client.query(
        `INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id, capture_view) VALUES ($1,$2,'capture-photo',$3,$4,$5)`,
        [crypto.randomUUID(), assetId, crypto.randomBytes(32).toString('hex'), principalId, role]
      ),
      `capture_view='${role}' inserts cleanly`
    );
  }

  // ===================================================================
  // NP1 -- CHECK rejects a role outside the 5-value vocabulary
  // ===================================================================
  await assertRejected(
    () => client.query(
      `INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id, capture_view) VALUES ($1,$2,'capture-photo',$3,$4,'COVER')`,
      [crypto.randomUUID(), assetId, crypto.randomBytes(32).toString('hex'), principalId]
    ),
    `NP1: capture_view='COVER' (not in the 5-value vocabulary) is rejected`,
    'check constraint'
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id, capture_view) VALUES ($1,$2,'capture-photo',$3,$4,'front')`,
      [crypto.randomUUID(), assetId, crypto.randomBytes(32).toString('hex'), principalId]
    ),
    `NP2: lowercase 'front' is rejected -- vocabulary is exact-case, no normalization`,
    'check constraint'
  );

  // ===================================================================
  // NP3 -- pre-existing media_media_type_check (0004) is untouched --
  // this migration adds a SECOND, independent constraint, never replaces
  // the first.
  // ===================================================================
  await assertRejected(
    () => client.query(
      `INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id, capture_view) VALUES ($1,$2,'unknown-type',$3,$4,'FRONT')`,
      [crypto.randomUUID(), assetId, crypto.randomBytes(32).toString('hex'), principalId]
    ),
    'NP3: the pre-existing media_type CHECK (0004) still independently rejects an out-of-vocabulary media_type',
    'check constraint'
  );

  const rowCountBeforeRollback = (await client.query('SELECT count(*)::int AS n FROM media')).rows[0].n;
  assertTrue(rowCountBeforeRollback === 6, `sanity: exactly 6 rows survived (1 NULL + 5 roles), all 3 rejected attempts counted zero -- actual: ${rowCountBeforeRollback}`);

  // ===================================================================
  // Rollback / reapply symmetry
  // ===================================================================
  await assertScratchTarget(SCHEMA, 'pre-0029-rollback');
  await assertSucceeds(() => client.query(qualify(read('0029_media_capture_view_rollback.sql'))), '0029 rollback applies successfully');

  const colGone = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'media' AND column_name = 'capture_view'`,
    [SCHEMA]
  );
  assertTrue(colGone.rows.length === 0, 'capture_view column no longer exists after rollback');

  const rowsIntactAfterRollback = (await client.query('SELECT count(*)::int AS n FROM media')).rows[0].n;
  assertTrue(rowsIntactAfterRollback === rowCountBeforeRollback, `rollback dropped only the column, not the rows themselves (before=${rowCountBeforeRollback}, after=${rowsIntactAfterRollback})`);

  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(qualify(read('0029_media_capture_view.sql'))), 'reapply of the same 0029 forward text succeeds cleanly after rollback');
  const reappliedCol = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'media' AND column_name = 'capture_view'`,
    [SCHEMA]
  );
  assertTrue(reappliedCol.rows.length === 1, 'capture_view column exists again after reapply');
  const reapplyRowCount = (await client.query('SELECT count(*)::int AS n FROM media')).rows[0].n;
  assertTrue(reapplyRowCount === rowCountBeforeRollback, `all pre-rollback rows survived the rollback+reapply cycle untouched (expected ${rowCountBeforeRollback}, got ${reapplyRowCount})`);

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped -- data1_dev untouched throughout`);
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
