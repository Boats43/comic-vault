// tests/d5b-live-apply-gate-a1-rehearsal.test.js
//
// D5B live-apply gate dispatch, A1 -- migration/rollback domain
// isolation. A1 ruled SPLIT (docs/D5B-LIVE-APPLY-REPORT.md): the
// original combined "0015_d5b_valuation_question_applicability.sql"
// was split into two independent migrations --
//   0015 -- db/data0/0015_d1_identity_assignment_immutability.sql (D1
//           repair to the EXISTING asset_identity_assignment table)
//   0016 -- db/data0/0016_d5b_valuation_question_applicability.sql (the
//           two NEW tables, depends on 0015)
// This file rehearses A1-R1 (independent baseline->forward->verify->
// rollback->verify per migration), A1-R2 (deterministic structural
// comparison, not just "table exists/doesn't"), and A1-R3 (cross-domain
// rollback isolation -- including the real, expected FK-dependency
// failure when rolling back 0015 while 0016 is still applied, proven
// directly rather than assumed).
//
// No generic reusable structural-snapshot comparator exists elsewhere
// in this repo (checked: D3.2's own "78/78 post-migration checks",
// docs/DATABASE-MIGRATION-STATUS.md:91, was a bespoke one-off script
// for that migration's specific column changes, not a committed,
// reusable comparator) -- snapshotStructure() below is written fresh,
// using the same direct information_schema/pg_catalog introspection
// style already used throughout this repo's own migration-contract
// tests, deterministic (sorted) so two snapshots of the identical state
// always deep-equal regardless of query result ordering.
//
// data1_dev is never touched.
//
// Invoke: node tests/d5b-live-apply-gate-a1-rehearsal.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

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
const assertDeepEqual = (a, b, label) => {
  try { assert.deepStrictEqual(a, b); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (structural mismatch: ${e.message.slice(0, 300)})`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, label, expectedFragment) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = !expectedFragment || String(e.message).includes(expectedFragment);
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 140)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== D5B live-apply gate, A1 -- migration/rollback domain isolation rehearsal ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated unpooled backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  const { s: actualSchema, pid: actualPid } = r.rows[0];
  if (actualPid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script -- refusing to execute DDL`);
  if (actualSchema === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (actualSchema !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected scratch schema "${expectedSchema}" but got "${actualSchema}" -- refusing to execute DDL`);
  return actualSchema;
}

// snapshotStructure -- deterministic structural snapshot of a set of
// tables (columns/constraints/indexes/triggers) plus a set of functions
// (by name, via pg_get_functiondef so the body is included, not just
// existence) in the given schema. Every sub-list is sorted so two
// snapshots of identical underlying state always deep-equal regardless
// of catalog query result ordering.
async function snapshotStructure(schema, { tables, functions }) {
  const snap = { tables: {}, functions: {} };
  for (const table of tables) {
    const exists = (await client.query(`SELECT to_regclass($1) AS t`, [`${schema}.${table}`])).rows[0].t;
    if (!exists) { snap.tables[table] = null; continue; }
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2
       ORDER BY column_name`,
      [schema, table]
    );
    const cons = await client.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
      [`${schema}.${table}`]
    );
    const idxs = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
      [schema, table]
    );
    const trigs = await client.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
       WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`,
      [`${schema}.${table}`]
    );
    snap.tables[table] = {
      columns: cols.rows,
      constraints: cons.rows,
      indexes: idxs.rows,
      triggers: trigs.rows.map(r => ({ tgname: r.tgname, def: r.def.replace(/ ON [\w.]+ /, ' ON <table> ') })),
    };
  }
  for (const fn of functions) {
    const r = await client.query(
      `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = $1 AND pronamespace = $2::regnamespace`,
      [fn, schema]
    );
    snap.functions[fn] = r.rows[0]?.def ?? null;
  }
  return snap;
}

const SCHEMA = `d5b_a1_rehearsal_${Date.now()}`;
const fwd0014Raw = readFileSync(path.join(repoRoot, 'db', 'data0', '0014_d5a_market_observation.sql'), 'utf8');
const fwd0015Raw = readFileSync(path.join(repoRoot, 'db', 'data0', '0015_d1_identity_assignment_immutability.sql'), 'utf8');
const rb0015Raw = readFileSync(path.join(repoRoot, 'db', 'data0', '0015_d1_identity_assignment_immutability_rollback.sql'), 'utf8');
const fwd0016Raw = readFileSync(path.join(repoRoot, 'db', 'data0', '0016_d5b_valuation_question_applicability.sql'), 'utf8');
const rb0016Raw = readFileSync(path.join(repoRoot, 'db', 'data0', '0016_d5b_valuation_question_applicability_rollback.sql'), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`
    CREATE TABLE asset_identity_assignment (
      id                  UUID PRIMARY KEY,
      asset_id            UUID NOT NULL REFERENCES gk_asset(id),
      catalog_entity_id   UUID,
      authority           TEXT NOT NULL CHECK (authority IN ('NONE', 'CONTESTED', 'CORROBORATED')),
      source              TEXT NOT NULL CHECK (source IN ('vision', 'operator-correction', 'unresolved')),
      occurred_at         TIMESTAMPTZ,
      recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by       UUID REFERENCES asset_identity_assignment(id)
    );
    CREATE INDEX ON asset_identity_assignment (asset_id, recorded_at);
  `);
  const assetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  const identityId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1, $2, NULL, 'CORROBORATED', 'vision')`, [identityId, assetId]);

  const fwd0014 = qualify(fwd0014Raw);
  await assertSucceeds(() => client.query(fwd0014), 'setup: 0014 applies cleanly (market_observation substrate for 0016)');

  // ===================================================================
  // A1-R1/R2 -- 0015 (D1 repair) independently: baseline -> forward ->
  // verify delta -> rollback -> verify EXACT structural restoration.
  // ===================================================================
  console.log('\n-- A1-R1/R2: 0015 (D1 repair) independent rehearsal --\n');

  const baseline0015 = await snapshotStructure(SCHEMA, { tables: ['asset_identity_assignment'], functions: ['asset_identity_assignment_guard'] });
  assertTrue(baseline0015.functions.asset_identity_assignment_guard === null, 'A1-R1: baseline has no asset_identity_assignment_guard function (pre-0015 state)');
  assertTrue(baseline0015.tables.asset_identity_assignment.constraints.every(c => c.conname !== 'asset_identity_assignment_id_asset_uk'), 'A1-R1: baseline has no asset_identity_assignment_id_asset_uk constraint');

  await assertScratchTarget(SCHEMA, 'pre-0015-forward');
  await assertSucceeds(() => client.query(qualify(fwd0015Raw)), 'A1-R1: 0015 forward text applies cleanly (baseline -> forward)');

  const afterForward0015 = await snapshotStructure(SCHEMA, { tables: ['asset_identity_assignment'], functions: ['asset_identity_assignment_guard'] });
  assertTrue(afterForward0015.functions.asset_identity_assignment_guard !== null, 'A1-R1: forward delta -- asset_identity_assignment_guard function now exists');
  assertTrue(afterForward0015.tables.asset_identity_assignment.constraints.some(c => c.conname === 'asset_identity_assignment_id_asset_uk'), 'A1-R1: forward delta -- UNIQUE(id, asset_id) constraint now exists');
  assertTrue(afterForward0015.tables.asset_identity_assignment.triggers.length === 2, 'A1-R1: forward delta -- exactly 2 triggers now exist (no_update, no_delete)');
  assertDeepEqual(
    afterForward0015.tables.asset_identity_assignment.columns, baseline0015.tables.asset_identity_assignment.columns,
    'A1-R1: 0015 adds ZERO columns to asset_identity_assignment -- column set is byte-identical before/after (pure constraint+trigger addition)'
  );

  await assertScratchTarget(SCHEMA, 'pre-0015-rollback');
  await assertSucceeds(() => client.query(qualify(rb0015Raw)), 'A1-R1: 0015 rollback text applies cleanly (forward -> rollback)');

  const afterRollback0015 = await snapshotStructure(SCHEMA, { tables: ['asset_identity_assignment'], functions: ['asset_identity_assignment_guard'] });
  assertDeepEqual(afterRollback0015, baseline0015, 'A1-R2: 0015 FORWARD -> ROLLBACK -> BASELINE IDENTICAL (full deterministic structural snapshot, not just table-exists)');

  const rowsStillIntact = await client.query('SELECT id, authority FROM asset_identity_assignment WHERE id = $1', [identityId]);
  assertTrue(rowsStillIntact.rows.length === 1 && rowsStillIntact.rows[0].authority === 'CORROBORATED', 'A1-R1: pre-existing row data survives 0015 forward+rollback cycle completely untouched');

  // Reapply 0015 -- required prerequisite for 0016's own rehearsal below.
  await assertSucceeds(() => client.query(qualify(fwd0015Raw)), 'setup: 0015 reapplied (prerequisite for 0016 rehearsal)');

  // ===================================================================
  // A1-R1/R2 -- 0016 (D5B) independently: baseline (0015 already
  // applied) -> forward -> verify delta -> rollback -> verify EXACT
  // structural restoration to the "0015-applied, 0016 absent" baseline.
  // ===================================================================
  console.log('\n-- A1-R1/R2: 0016 (D5B) independent rehearsal --\n');

  const baseline0016 = await snapshotStructure(SCHEMA, {
    tables: ['valuation_question', 'applicability', 'asset_identity_assignment'],
    functions: ['valuation_question_immutable', 'applicability_immutable', 'asset_identity_assignment_guard'],
  });
  assertTrue(baseline0016.tables.valuation_question === null, 'A1-R1: 0016 baseline -- valuation_question does not exist yet');
  assertTrue(baseline0016.tables.applicability === null, 'A1-R1: 0016 baseline -- applicability does not exist yet');
  assertTrue(baseline0016.functions.asset_identity_assignment_guard !== null, 'A1-R1: 0016 baseline still has 0015\'s function (0015 stays applied throughout this rehearsal)');

  await assertScratchTarget(SCHEMA, 'pre-0016-forward');
  await assertSucceeds(() => client.query(qualify(fwd0016Raw)), 'A1-R1: 0016 forward text applies cleanly on top of 0015 (baseline -> forward)');

  const afterForward0016 = await snapshotStructure(SCHEMA, {
    tables: ['valuation_question', 'applicability', 'asset_identity_assignment'],
    functions: ['valuation_question_immutable', 'applicability_immutable', 'asset_identity_assignment_guard'],
  });
  assertTrue(afterForward0016.tables.valuation_question !== null && afterForward0016.tables.applicability !== null, 'A1-R1: 0016 forward delta -- both new tables now exist');
  assertDeepEqual(
    afterForward0016.tables.asset_identity_assignment, baseline0016.tables.asset_identity_assignment,
    'A1-R1: 0016 forward apply leaves asset_identity_assignment (0015\'s own object) byte-identical -- 0016 never touches it'
  );

  await assertScratchTarget(SCHEMA, 'pre-0016-rollback');
  await assertSucceeds(() => client.query(qualify(rb0016Raw)), 'A1-R1: 0016 rollback text applies cleanly (forward -> rollback)');

  const afterRollback0016 = await snapshotStructure(SCHEMA, {
    tables: ['valuation_question', 'applicability', 'asset_identity_assignment'],
    functions: ['valuation_question_immutable', 'applicability_immutable', 'asset_identity_assignment_guard'],
  });
  assertDeepEqual(afterRollback0016, baseline0016, 'A1-R2: 0016 FORWARD -> ROLLBACK -> BASELINE IDENTICAL (full deterministic structural snapshot)');

  // ===================================================================
  // A1-R3 -- cross-domain rollback isolation
  // ===================================================================
  console.log('\n-- A1-R3: cross-domain rollback isolation --\n');

  // (a) Roll back D5B (0016) only -- 0015 must remain live and untouched.
  await assertSucceeds(() => client.query(qualify(fwd0016Raw)), 'A1-R3 setup: 0016 reapplied for the cross-domain test');
  const before0016OnlyRollback = await snapshotStructure(SCHEMA, { tables: ['asset_identity_assignment'], functions: ['asset_identity_assignment_guard'] });
  await assertSucceeds(() => client.query(qualify(rb0016Raw)), 'A1-R3(a): rolling back D5B (0016) ONLY succeeds');
  const after0016OnlyRollback = await snapshotStructure(SCHEMA, { tables: ['asset_identity_assignment'], functions: ['asset_identity_assignment_guard'] });
  assertDeepEqual(after0016OnlyRollback, before0016OnlyRollback, 'A1-R3(a): rolling back D5B (0016) alone leaves 0015\'s asset_identity_assignment protection BYTE-IDENTICAL -- untouched, not merely "still present"');

  // (b) Attempt to roll back D1 repair (0015) while D5B (0016) is still
  // applied -- expect a REAL, LOUD Postgres dependency failure, never a
  // silent success or partial corruption. Wrapped in an explicit
  // transaction so a failed multi-statement rollback script cannot
  // leave partial DDL applied.
  await assertSucceeds(() => client.query(qualify(fwd0016Raw)), 'A1-R3 setup: 0016 reapplied so 0015 has a live dependent for the negative proof');
  const before0015AttemptWhile0016Live = await snapshotStructure(SCHEMA, {
    tables: ['asset_identity_assignment', 'valuation_question', 'applicability'],
    functions: ['asset_identity_assignment_guard', 'valuation_question_immutable', 'applicability_immutable'],
  });
  await assertRejected(
    async () => {
      await client.query('BEGIN');
      try {
        await client.query(qualify(rb0015Raw));
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    },
    'A1-R3(b): rolling back D1 repair (0015) WHILE D5B (0016) is still applied is REJECTED -- a real Postgres FK-dependency error (0016\'s valuation_question composite FK still depends on 0015\'s UNIQUE constraint), not a silent success',
    'other objects depend on it'
  );
  const after0015AttemptWhile0016Live = await snapshotStructure(SCHEMA, {
    tables: ['asset_identity_assignment', 'valuation_question', 'applicability'],
    functions: ['asset_identity_assignment_guard', 'valuation_question_immutable', 'applicability_immutable'],
  });
  assertDeepEqual(
    after0015AttemptWhile0016Live, before0015AttemptWhile0016Live,
    'A1-R3(b): the FAILED 0015 rollback attempt leaves EVERYTHING byte-identical -- no partial damage from the rejected attempt (transaction-wrapped, real ROLLBACK executed)'
  );

  // (c) Proper order -- 0016 then 0015 -- fully tears down to the
  // ORIGINAL pre-0015 baseline.
  await assertSucceeds(() => client.query(qualify(rb0016Raw)), 'A1-R3(c): proper-order teardown -- 0016 rolled back first, succeeds');
  await assertSucceeds(() => client.query(qualify(rb0015Raw)), 'A1-R3(c): proper-order teardown -- 0015 rolled back second (now safe, 0016 already gone), succeeds');
  const finalState = await snapshotStructure(SCHEMA, { tables: ['asset_identity_assignment'], functions: ['asset_identity_assignment_guard'] });
  assertDeepEqual(finalState, baseline0015, 'A1-R3(c): full proper-order teardown (0016 then 0015) restores the ORIGINAL pre-0015 baseline exactly -- the split migrations compose to a clean, complete, order-respecting rollback');

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

console.log('\nA1 PASS -- SPLIT: both migrations independently forward/rollback-clean, structurally proven byte-identical to baseline after their own rollback, and cross-domain rollback isolation holds in both directions (0016-alone rollback leaves 0015 untouched; 0015-while-0016-live rollback is REJECTED by a real FK-dependency error, never silently succeeds).');
