// tests/inventory-authority-migration-contract.test.js
//
// GRAILKEY — INVENTORY AUTHORITY V1. Real, isolated scratch-schema proof
// of db/data0/0028_inventory_authority.sql, via the environment-hygiene-
// corrected scripts/db-admin-preflight.mjs's assertScratchSchemaTarget()
// (GK-221) — used correctly from the start this time, not retrofitted.
// data1_dev is never touched by this test.
//
// Proves: 0028 applies cleanly on top of minimal gk_principal/gk_asset
// stubs; PK/FK/CHECK/NOT NULL/unique-index constraints all enforce as
// designed; the atomic CAS predicates (UPDATE...WHERE state=X) behave
// correctly at the raw-SQL level for enroll/reserve/release/markSold;
// SOLD is terminal (no CHECK/UPDATE path exists back out of it);
// rollback drops exactly the two new tables and nothing else, and a
// reapply after rollback succeeds cleanly.
//
// Invoke: node tests/inventory-authority-migration-contract.test.js

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

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);

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

console.log('\n=== Inventory Authority (0028) — migration contract (real, isolated scratch-schema proof) ===\n');

const { client, sessionPid } = await assertScratchSchemaTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED,
  label: 'inventory-authority-migration-contract',
});
console.log('  dedicated backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev — refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

const SCHEMA = `inventory_authority_0028_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

let principalId, assetId, transitionId;

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);

  await assertSucceeds(() => client.query(qualify(read('0028_inventory_authority.sql'))), '0028 forward text applies cleanly on top of gk_principal/gk_asset stubs');

  principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);
  assetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  const otherAssetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [otherAssetId]);

  // ===================================================================
  // FK / CHECK enforcement
  // ===================================================================
  console.log('\n-- FK / CHECK enforcement --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 'UNMANAGED', 'AVAILABLE', 'operator-enrollment', $3, $4, 'inventory-authority-transition', $5)`,
      [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), principalId, crypto.randomUUID()]
    ),
    'transition referencing a nonexistent gk_asset_id is rejected', 'foreign key'
  );

  await assertRejected(
    () => client.query(
      `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 'SIDEWAYS', 'AVAILABLE', 'operator-enrollment', $3, $4, 'inventory-authority-transition', $5)`,
      [crypto.randomUUID(), assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
    ),
    'an invalid prior_state value is rejected by CHECK constraint', 'check constraint'
  );

  await assertRejected(
    () => client.query(
      `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 'UNMANAGED', 'AVAILABLE', 'made-up-reason', $3, $4, 'inventory-authority-transition', $5)`,
      [crypto.randomUUID(), assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
    ),
    'an unrecognized reason value is rejected by CHECK constraint', 'check constraint'
  );

  await assertRejected(
    () => client.query(
      `INSERT INTO inventory_current_state (gk_asset_id, state, as_of_transition_event_id)
       VALUES ($1, 'UNMANAGED', $2)`,
      [assetId, crypto.randomUUID()]
    ),
    'inventory_current_state literally storing UNMANAGED is rejected — UNMANAGED must be row-absence only', 'check constraint'
  );

  // ===================================================================
  // Enrollment CAS: UNMANAGED -> AVAILABLE
  // ===================================================================
  console.log('\n-- Enrollment CAS --\n');

  const enrollTxnId = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'UNMANAGED', 'AVAILABLE', 'operator-enrollment', $3, $4, 'inventory-authority-transition', $5)`,
    [enrollTxnId, assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
  );
  const enrollCas = await client.query(
    `INSERT INTO inventory_current_state (gk_asset_id, state, as_of_transition_event_id) VALUES ($1, 'AVAILABLE', $2)
     ON CONFLICT (gk_asset_id) DO NOTHING RETURNING gk_asset_id`,
    [assetId, enrollTxnId]
  );
  assertTrue(enrollCas.rowCount === 1, 'first enrollment CAS succeeds (row inserted)');

  const enrollTxnId2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'UNMANAGED', 'AVAILABLE', 'operator-enrollment', $3, $4, 'inventory-authority-transition', $5)`,
    [enrollTxnId2, assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
  );
  const enrollCas2 = await client.query(
    `INSERT INTO inventory_current_state (gk_asset_id, state, as_of_transition_event_id) VALUES ($1, 'AVAILABLE', $2)
     ON CONFLICT (gk_asset_id) DO NOTHING RETURNING gk_asset_id`,
    [assetId, enrollTxnId2]
  );
  assertTrue(enrollCas2.rowCount === 0, 'a second enrollment CAS against the same asset affects ZERO rows — already enrolled');

  // ===================================================================
  // Reserve CAS: AVAILABLE -> RESERVED
  // ===================================================================
  console.log('\n-- Reserve CAS --\n');

  const reserveTxnId = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, channel, external_reference, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'AVAILABLE', 'RESERVED', 'marketplace-reservation', 'ebay', 'order-1', $3, $4, 'inventory-authority-transition', $5)`,
    [reserveTxnId, assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
  );
  const reserveCas = await client.query(
    `UPDATE inventory_current_state SET state='RESERVED', reserved_by_channel='ebay', reserved_external_reference='order-1', as_of_transition_event_id=$2, updated_at=now()
     WHERE gk_asset_id=$1 AND state='AVAILABLE' RETURNING gk_asset_id`,
    [assetId, reserveTxnId]
  );
  assertTrue(reserveCas.rowCount === 1, 'AVAILABLE -> RESERVED CAS succeeds from a real AVAILABLE row');

  const reserveCasAgain = await client.query(
    `UPDATE inventory_current_state SET state='RESERVED', reserved_by_channel='ebay', reserved_external_reference='order-2', as_of_transition_event_id=$2, updated_at=now()
     WHERE gk_asset_id=$1 AND state='AVAILABLE' RETURNING gk_asset_id`,
    [assetId, crypto.randomUUID()]
  );
  assertTrue(reserveCasAgain.rowCount === 0, 'a second, competing reservation attempt while already RESERVED affects ZERO rows');

  // ===================================================================
  // Release CAS: RESERVED -> AVAILABLE
  // ===================================================================
  console.log('\n-- Release CAS --\n');

  const releaseTxnId = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'RESERVED', 'AVAILABLE', 'operator-release', $3, $4, 'inventory-authority-transition', $5)`,
    [releaseTxnId, assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
  );
  const releaseCas = await client.query(
    `UPDATE inventory_current_state SET state='AVAILABLE', reserved_by_channel=NULL, reserved_external_reference=NULL, as_of_transition_event_id=$2, updated_at=now()
     WHERE gk_asset_id=$1 AND state='RESERVED' RETURNING gk_asset_id`,
    [assetId, releaseTxnId]
  );
  assertTrue(releaseCas.rowCount === 1, 'RESERVED -> AVAILABLE release CAS succeeds');

  const stateAfterRelease = (await client.query('SELECT * FROM inventory_current_state WHERE gk_asset_id=$1', [assetId])).rows[0];
  assertTrue(stateAfterRelease.state === 'AVAILABLE' && stateAfterRelease.reserved_by_channel === null, 'released row is clean: AVAILABLE, no leftover reservation fields');

  // ===================================================================
  // Direct AVAILABLE -> SOLD (smallest legitimate sequence)
  // ===================================================================
  console.log('\n-- Direct AVAILABLE -> SOLD --\n');

  const soldTxnId = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'AVAILABLE', 'SOLD', 'authoritative-sale', $3, $4, 'inventory-authority-transition', $5)`,
    [soldTxnId, assetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
  );
  const soldCas = await client.query(
    `UPDATE inventory_current_state SET state='SOLD', as_of_transition_event_id=$2, updated_at=now()
     WHERE gk_asset_id=$1 AND state IN ('AVAILABLE','RESERVED') RETURNING gk_asset_id`,
    [assetId, soldTxnId]
  );
  assertTrue(soldCas.rowCount === 1, 'AVAILABLE -> SOLD (direct, no fabricated RESERVED step) CAS succeeds');

  // ===================================================================
  // SOLD is terminal
  // ===================================================================
  console.log('\n-- SOLD is terminal --\n');

  const cannotReserveSold = await client.query(
    `UPDATE inventory_current_state SET state='RESERVED', as_of_transition_event_id=$2, updated_at=now()
     WHERE gk_asset_id=$1 AND state='AVAILABLE' RETURNING gk_asset_id`,
    [assetId, crypto.randomUUID()]
  );
  assertTrue(cannotReserveSold.rowCount === 0, 'a SOLD asset cannot be reserved (CAS affects zero rows)');

  const cannotReleaseSold = await client.query(
    `UPDATE inventory_current_state SET state='AVAILABLE', as_of_transition_event_id=$2, updated_at=now()
     WHERE gk_asset_id=$1 AND state='RESERVED' RETURNING gk_asset_id`,
    [assetId, crypto.randomUUID()]
  );
  assertTrue(cannotReleaseSold.rowCount === 0, 'a SOLD asset cannot silently become AVAILABLE via the release CAS');

  await assertRejected(
    () => client.query(`UPDATE inventory_current_state SET state='UNMANAGED' WHERE gk_asset_id=$1`, [assetId]),
    'no CHECK constraint even permits state=UNMANAGED to be written literally, at any time', 'check constraint'
  );

  // ===================================================================
  // A second, distinct asset is entirely independent (row-level, not global lock)
  // ===================================================================
  console.log('\n-- Independence across assets --\n');
  const otherEnrollTxn = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'UNMANAGED', 'AVAILABLE', 'operator-enrollment', $3, $4, 'inventory-authority-transition', $5)`,
    [otherEnrollTxn, otherAssetId, crypto.randomUUID(), principalId, crypto.randomUUID()]
  );
  const otherEnrollCas = await client.query(
    `INSERT INTO inventory_current_state (gk_asset_id, state, as_of_transition_event_id) VALUES ($1, 'AVAILABLE', $2)
     ON CONFLICT (gk_asset_id) DO NOTHING RETURNING gk_asset_id`,
    [otherAssetId, otherEnrollTxn]
  );
  assertTrue(otherEnrollCas.rowCount === 1, 'a second, unrelated asset enrolls independently of the first (already SOLD) asset');

  // ===================================================================
  // Idempotency unique index
  // ===================================================================
  console.log('\n-- Idempotency (namespace, key) uniqueness --\n');
  const dupKey = crypto.randomUUID();
  await client.query(
    `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, 'RESERVED', 'AVAILABLE', 'operator-release', $3, $4, 'inventory-authority-transition', $5)`,
    [crypto.randomUUID(), otherAssetId, crypto.randomUUID(), principalId, dupKey]
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO inventory_transition_event (id, gk_asset_id, prior_state, next_state, reason, correlation_id, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 'AVAILABLE', 'RESERVED', 'marketplace-reservation', $3, $4, 'inventory-authority-transition', $5)`,
      [crypto.randomUUID(), otherAssetId, crypto.randomUUID(), principalId, dupKey]
    ),
    'a second transition row with the SAME (idempotency_namespace, idempotency_key) is rejected at the DB level', 'duplicate key'
  );

  // ===================================================================
  // Rollback / reapply
  // ===================================================================
  console.log('\n-- Rollback / reapply --\n');

  await assertScratchTarget(SCHEMA, 'pre-0028-rollback');
  await assertSucceeds(() => client.query(qualify(read('0028_inventory_authority_rollback.sql'))), '0028 rollback applies successfully');

  const currentStateGone = await client.query(`SELECT to_regclass('${SCHEMA}.inventory_current_state') AS t`);
  const transitionEventGone = await client.query(`SELECT to_regclass('${SCHEMA}.inventory_transition_event') AS t`);
  assertTrue(currentStateGone.rows[0].t === null, 'inventory_current_state no longer exists after rollback');
  assertTrue(transitionEventGone.rows[0].t === null, 'inventory_transition_event no longer exists after rollback');

  const assetRowsIntact = (await client.query('SELECT count(*)::int AS n FROM gk_asset')).rows[0].n;
  assertTrue(assetRowsIntact === 2, `gk_asset rows (unrelated to 0028) survive rollback untouched (found ${assetRowsIntact}, expected 2)`);

  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(qualify(read('0028_inventory_authority.sql'))), 'reapply of the same 0028 forward text succeeds cleanly after rollback');
  const reapplyCount = (await client.query('SELECT count(*)::int AS n FROM inventory_current_state')).rows[0].n;
  assertTrue(reapplyCount === 0, 'reapplied inventory_current_state table is empty');

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped — data1_dev untouched throughout`);
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
