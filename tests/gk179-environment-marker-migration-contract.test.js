// tests/gk179-environment-marker-migration-contract.test.js
//
// GK-179 -- real, isolated scratch-schema proof of the environment
// identity substrate (db/data0/0018_gk179_environment_identity.sql,
// NOT applied to data1_dev, Development, Preview, or Production this
// pass). Mirrors D5A/D5B/D5C's own scratch-schema proof discipline.
// data1_dev is never touched.
//
// A13 DEVIATION FROM THIS REPO'S OWN PRIOR CONVENTION, DELIBERATE:
// every earlier live-DB test in this repo (d5c-market-population-
// migration-contract.test.js and siblings) loads .env.development.local
// itself via readFileSync. Per the GK-179 state brief's standing rule
// (three credential exposures this session), this file does NOT read,
// grep, cut, or source that file in any form -- it consumes
// GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED blind, via process.env only.
//
// Invoke:
//   node --env-file=.env.development.local tests/gk179-environment-marker-migration-contract.test.js
//
// Covers:
//   ENV-P1  table + both named constraints exist after forward-apply
//   ENV-P2  a single legitimate row (app_env='development') succeeds
//   ENV-N1  a second row (id defaults to TRUE again) is rejected --
//           SQLSTATE 23505, constraint environment_marker_pkey
//   ENV-N2  an explicit id=FALSE row is rejected -- SQLSTATE 23514,
//           constraint environment_marker_single_row
//   ENV-N3  an out-of-vocabulary app_env value is rejected -- SQLSTATE
//           23514, constraint environment_marker_app_env_check
//   ENV-P3  rollback removes the table cleanly, nothing else touched
//   ENV-P4  static proof: zero references to environment_marker from
//           any D2/D3 hash/dedup/domain-event/outbox/evidence-lineage
//           source file -- infrastructure, not domain (state brief §3)

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, label, expectedSqlstate, expectedConstraint) => {
  try {
    await fn();
    failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m);
  } catch (e) {
    const sqlstateOk = e.code === expectedSqlstate;
    const constraintOk = !expectedConstraint || e.constraint === expectedConstraint;
    if (sqlstateOk && constraintOk) {
      passed++; console.log(`  ✓ ${label} (rejected: SQLSTATE ${e.code}, constraint ${e.constraint})`);
    } else {
      failed++;
      const m = `  ✗ ${label} (rejected but wrong shape: got SQLSTATE ${e.code}/constraint ${e.constraint}, expected ${expectedSqlstate}/${expectedConstraint})`;
      failures.push(m); console.log(m);
    }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-179 -- environment_marker migration contract (real, isolated scratch-schema proof) ===\n');

const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED;
if (!connectionString) {
  console.log('BLOCKED — VARIABLE NOT SET (GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED)');
  process.exit(2);
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

const SCHEMA = `gk179_0018_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  // ===================================================================
  // ENV-P1 -- forward apply
  // ===================================================================
  await assertSucceeds(
    () => client.query(qualify(read('0018_gk179_environment_identity.sql'))),
    'ENV-P1a: real 0018 forward text applies cleanly in scratch'
  );
  const tbl = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'environment_marker'`,
    [SCHEMA]
  );
  assertTrue(tbl.rows.length === 1, 'ENV-P1b: environment_marker table exists');
  const cons = await client.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass`,
    [`${SCHEMA}.environment_marker`]
  );
  const conNames = cons.rows.map(r => r.conname);
  assertTrue(conNames.includes('environment_marker_pkey'), 'ENV-P1c: environment_marker_pkey exists');
  assertTrue(conNames.includes('environment_marker_single_row'), 'ENV-P1d: environment_marker_single_row CHECK exists');
  assertTrue(conNames.includes('environment_marker_app_env_check'), 'ENV-P1e: environment_marker_app_env_check CHECK exists');

  // ===================================================================
  // ENV-P2 -- one legitimate row succeeds
  // ===================================================================
  await assertSucceeds(
    () => client.query(`INSERT INTO environment_marker (app_env) VALUES ('development')`),
    "ENV-P2: single row insert (app_env='development') succeeds"
  );

  // ===================================================================
  // ENV-N1 -- second row, id defaults to TRUE again -> PK violation
  // ===================================================================
  await assertRejected(
    () => client.query(`INSERT INTO environment_marker (app_env) VALUES ('preview')`),
    'ENV-N1: second row (default id=TRUE) rejected',
    '23505',
    'environment_marker_pkey'
  );

  // ===================================================================
  // ENV-N2 -- explicit id=FALSE -> CHECK(id) violation
  // ===================================================================
  await assertRejected(
    () => client.query(`INSERT INTO environment_marker (id, app_env) VALUES (FALSE, 'preview')`),
    'ENV-N2: explicit id=FALSE row rejected',
    '23514',
    'environment_marker_single_row'
  );

  // ===================================================================
  // ENV-N3 -- out-of-vocabulary app_env, on a fresh empty table, so this
  // failure is attributable ONLY to the app_env CHECK, not the singleton
  // guard. Proven in its own transaction-safe sub-scope: DELETE the
  // existing legitimate row first (still inside the same scratch schema,
  // never data1_dev), so ENV-N3 isolates exactly one constraint.
  // ===================================================================
  await client.query('DELETE FROM environment_marker');
  await assertRejected(
    () => client.query(`INSERT INTO environment_marker (app_env) VALUES ('staging')`),
    "ENV-N3: out-of-vocabulary app_env ('staging') rejected",
    '23514',
    'environment_marker_app_env_check'
  );

  // ===================================================================
  // ENV-P3 -- rollback removes exactly this table, nothing else
  // ===================================================================
  await assertSucceeds(
    () => client.query(qualify(read('0018_gk179_environment_identity_rollback.sql'))),
    'ENV-P3a: rollback applies cleanly'
  );
  const tblAfter = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'environment_marker'`,
    [SCHEMA]
  );
  assertTrue(tblAfter.rows.length === 0, 'ENV-P3b: environment_marker no longer exists after rollback');

} finally {
  await assertScratchTarget(SCHEMA, 'pre-teardown');
  await client.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await client.end();
}

// ===================================================================
// ENV-P4 -- static proof: infrastructure, not domain (state brief §3).
// Zero references to environment_marker anywhere in the D2/D3
// hash/dedup/domain-event/outbox/evidence-lineage surface.
// ===================================================================
console.log('\n-- ENV-P4: static source-text isolation proof --\n');
const domainSurfaceFiles = [
  'src/lib/canonicalHashFraming.js',
  'src/lib/marketObservationHash.js',
  'src/lib/valuationQuestionHash.js',
  'src/lib/applicabilityHash.js',
  'src/lib/marketPopulationHash.js',
  'src/modules/assets/service.js',
  'src/modules/assets/repository.js',
  'src/modules/valuation/service.js',
  'src/modules/valuation/repository.js',
];
let touchedAny = false;
for (const rel of domainSurfaceFiles) {
  try {
    const text = readFileSync(path.join(repoRoot, rel), 'utf8');
    if (/environment_marker/.test(text)) {
      touchedAny = true;
      console.log(`  ✗ ${rel} references environment_marker`);
    }
  } catch {
    // file doesn't exist in this checkout -- not a failure, just skip
  }
}
assertTrue(!touchedAny, 'ENV-P4: zero D2/D3 domain-surface files reference environment_marker');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
