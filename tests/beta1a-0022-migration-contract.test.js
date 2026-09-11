// tests/beta1a-0022-migration-contract.test.js
//
// BETA-1A -- real, isolated scratch-schema proof of the Clerk
// identity-mapping substrate (db/data0/0022_beta1a_clerk_identity_mapping.sql).
// Mirrors the D5C/D5B scratch-proof discipline exactly (same connection
// pattern, same backend-PID + current_schema() safety guard refusing to
// ever touch data1_dev). data1_dev is never touched by this file.
//
// Covers: NP1 (FK rejects a nonexistent principal_id), NP2 (CHECK rejects
// a provider outside the ('clerk') vocabulary), NP3 (UNIQUE(provider,
// external_subject) rejects a duplicate mapping), NP4 (one principal MAY
// hold more than one external identity row -- principal_id itself is not
// uniquely constrained), rollback/reapply symmetry, and that rollback
// touches nothing but this one table.
//
// Invoke: node tests/beta1a-0022-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

// Load .env.development.local into process.env WITHOUT ever printing it —
// same mechanism the D5B/D5C scratch-proof scripts already use.
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

console.log('\n=== BETA-1A -- 0022 Clerk identity-mapping migration contract (real, isolated scratch-schema proof) ===\n');

// NOTE (BETA-1A live gate, 2026-09-11): GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED
// (the variant D5B/D5C's own scratch-proof precedent used) was found THIS
// pass to resolve to a completely different, unrelated Neon database
// ("bookforge") in the current Development environment -- a real,
// previously-undisclosed env-var routing hazard, same class as GK-179 but
// a different variable. GRAILKEY_CATALOG_DATABASE_URL (pooled, no suffix)
// was independently verified this pass to resolve to the correct
// database (neondb/data1_dev, environment_marker confirms "development")
// AND to hold search_path state correctly across separate sequential
// calls on one pg.Client (empirically tested, not assumed) -- safe for
// this script's pattern of many discrete client.query() calls sharing one
// SET search_path. Using it here instead of _UNPOOLED until the routing
// hazard itself is fixed.
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated unpooled backend PID for this entire script:', sessionPid);

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

const SCHEMA = `beta1a_0022_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

let principalA, principalB;

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  // Minimal stub of the one real prerequisite 0022 references.
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);

  await assertSucceeds(() => client.query(qualify(read('0022_beta1a_clerk_identity_mapping.sql'))), 'setup: 0022 applies cleanly');

  principalA = crypto.randomUUID();
  principalB = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1), ($2)', [principalA, principalB]);

  // ===================================================================
  // Positive path
  // ===================================================================
  const row1Id = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO principal_external_identity (id, principal_id, provider, external_subject) VALUES ($1,$2,'clerk',$3)`,
      [row1Id, principalA, 'user_test_subject_1']
    ),
    'a valid (principal, provider, external_subject) row inserts cleanly'
  );

  const lookup = await client.query(
    `SELECT p.id FROM principal_external_identity pei JOIN gk_principal p ON p.id = pei.principal_id WHERE pei.provider = 'clerk' AND pei.external_subject = $1`,
    ['user_test_subject_1']
  );
  assertTrue(lookup.rows[0]?.id === principalA, 'the mapping resolves back to the correct principal via the same JOIN shape repository.js uses');

  // ===================================================================
  // NP1 -- FK rejects a nonexistent principal_id
  // ===================================================================
  await assertRejected(
    () => client.query(
      `INSERT INTO principal_external_identity (id, principal_id, provider, external_subject) VALUES ($1,$2,'clerk',$3)`,
      [crypto.randomUUID(), crypto.randomUUID(), 'user_orphan']
    ),
    'NP1: a row referencing a nonexistent principal_id is rejected',
    'foreign key'
  );

  // ===================================================================
  // NP2 -- CHECK rejects a provider outside ('clerk')
  // ===================================================================
  await assertRejected(
    () => client.query(
      `INSERT INTO principal_external_identity (id, principal_id, provider, external_subject) VALUES ($1,$2,'google',$3)`,
      [crypto.randomUUID(), principalA, 'user_wrong_provider']
    ),
    'NP2: a provider outside the (\'clerk\') vocabulary is rejected',
    'check constraint'
  );

  // ===================================================================
  // NP3 -- UNIQUE(provider, external_subject) rejects a duplicate mapping
  // (even pointed at a DIFFERENT principal -- this is the whole safety
  // property this table exists for: one verified external subject can
  // never resolve to two different principals).
  // ===================================================================
  await assertRejected(
    () => client.query(
      `INSERT INTO principal_external_identity (id, principal_id, provider, external_subject) VALUES ($1,$2,'clerk',$3)`,
      [crypto.randomUUID(), principalB, 'user_test_subject_1']
    ),
    'NP3: a second row for the SAME external_subject (even under a different principal_id) is rejected',
    'duplicate key'
  );

  // ===================================================================
  // NP4 -- one principal MAY hold more than one external identity row.
  // principal_id itself carries no uniqueness constraint.
  // ===================================================================
  await assertSucceeds(
    () => client.query(
      `INSERT INTO principal_external_identity (id, principal_id, provider, external_subject) VALUES ($1,$2,'clerk',$3)`,
      [crypto.randomUUID(), principalA, 'user_test_subject_2']
    ),
    'NP4: the SAME principal can hold a second, distinct external_subject mapping'
  );

  const countForPrincipalA = await client.query('SELECT count(*)::int AS n FROM principal_external_identity WHERE principal_id = $1', [principalA]);
  assertTrue(countForPrincipalA.rows[0].n === 2, 'principal A now has exactly 2 mapped external identities');

  // ===================================================================
  // Index proof
  // ===================================================================
  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'principal_external_identity'`,
    [SCHEMA]
  );
  const idxNames = idx.rows.map(r => r.indexname);
  assertTrue(idxNames.some(n => n.includes('principal_id')), `an index on principal_id exists (found: ${idxNames.join(', ')})`);

  const rowCountBeforeRollback = (await client.query('SELECT count(*)::int AS n FROM principal_external_identity')).rows[0].n;
  const principalCountBeforeRollback = (await client.query('SELECT count(*)::int AS n FROM gk_principal')).rows[0].n;

  // ===================================================================
  // Rollback / reapply symmetry
  // ===================================================================
  await assertScratchTarget(SCHEMA, 'pre-0022-rollback');
  await assertSucceeds(() => client.query(qualify(read('0022_beta1a_clerk_identity_mapping_rollback.sql'))), '0022 rollback applies successfully');

  const tableGone = await client.query(`SELECT to_regclass('${SCHEMA}.principal_external_identity') AS t`);
  assertTrue(tableGone.rows[0].t === null, 'principal_external_identity no longer exists after rollback');

  const principalRowsIntact = await client.query('SELECT count(*)::int AS n FROM gk_principal');
  assertTrue(principalRowsIntact.rows[0].n === principalCountBeforeRollback, `gk_principal rows (the one existing table 0022 references) survive rollback completely untouched (before=${principalCountBeforeRollback}, after=${principalRowsIntact.rows[0].n})`);

  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(qualify(read('0022_beta1a_clerk_identity_mapping.sql'))), 'reapply of the same 0022 forward text succeeds cleanly after rollback');
  const reapplyCount = await client.query('SELECT count(*)::int AS n FROM principal_external_identity');
  assertTrue(reapplyCount.rows[0].n === 0, 'reapplied principal_external_identity table is empty');
  assertTrue(rowCountBeforeRollback === 2, `sanity: exactly 2 rows existed pre-rollback (both under principal A — NP3's duplicate-subject attempt under principal B was correctly rejected, not counted) — actual: ${rowCountBeforeRollback}`);

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
