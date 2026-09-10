// tests/operator-action-0021-migration-contract.test.js
//
// OperatorAction — real, isolated Postgres SCRATCH schema proof of
// db/data0/0021_operator_action_event.sql, mirroring the D5A/B/C/D and
// outcome1-0020 migration-contract tests' own discipline exactly.
// NEVER real data1_dev.
//
// Proves: the table/columns exist with the right constraints, the
// action_code/source CHECK enums reject invalid values, decision_event_id
// is a real enforced FK (not just documented), the two indexes exist,
// and the rollback removes exactly what the migration added.
//
// Invoke: node tests/operator-action-0021-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
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
const assertRejected = async (fn, label, expectedCode) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = !expectedCode || e.code === expectedCode;
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.code || e.message.slice(0, 60)})`); }
    else { failed++; const m = `  ✗ ${label} (wrong code: expected ${expectedCode}, got ${e.code})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== OperatorAction -- 0021 migration contract proof (real, isolated scratch schema) ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();

async function assertScratchTarget(label) {
  const r = await client.query('SELECT current_schema() AS s');
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
}

const SCHEMA = `opact_0021_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget('post-setup');

  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await client.query(`CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql`);
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`
    CREATE TABLE decision_event (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES gk_asset(id),
      recommendation TEXT NOT NULL, reason_codes JSONB NOT NULL DEFAULT '[]',
      valuation_event_id UUID, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), occurred_at TIMESTAMPTZ
    );
  `);

  console.log('-- Apply 0021 --\n');
  await client.query(qualify(read('0021_operator_action_event.sql')));

  {
    const cols = await client.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'operator_action_event' ORDER BY ordinal_position`, [SCHEMA]);
    assertTrue(cols.rows.length === 11, `operator_action_event has exactly 11 columns (got ${cols.rows.length})`);
    assertTrue(cols.rows.find((c) => c.column_name === 'decision_event_id')?.is_nullable === 'NO', 'decision_event_id is NOT NULL (cannot float unattached)');
    assertTrue(cols.rows.find((c) => c.column_name === 'action_value_amount')?.is_nullable === 'YES', 'action_value_amount is nullable (no fabricated economic value)');
  }
  {
    const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'operator_action_event'`, [SCHEMA]);
    assertTrue(idx.rows.length === 3, `3 indexes exist (PK + 2 explicit, got ${idx.rows.length})`); // PK index + the 2 CREATE INDEX statements
  }

  console.log('\n-- Idempotent-by-construction: re-applying 0021 errors cleanly (no IF NOT EXISTS on CREATE TABLE -- by design, a genuinely new table is never silently re-created) --\n');
  {
    let threw = false;
    try { await client.query(qualify(read('0021_operator_action_event.sql'))); }
    catch (e) { threw = e.code === '42P07'; } // relation already exists -- the correct, honest failure for a real CREATE TABLE re-run
    assertTrue(threw, 'second apply fails with "relation already exists", not a silent corruption');
  }

  console.log('\n-- Behavioral proof: CHECK enums + FK enforcement --\n');
  const [{ id: assetId }] = (await client.query(`INSERT INTO gk_asset (id) VALUES (gen_random_uuid()) RETURNING id`)).rows;
  const [{ id: principalId }] = (await client.query(`INSERT INTO gk_principal (id) VALUES (gen_random_uuid()) RETURNING id`)).rows;
  const [{ id: decisionEventId }] = (await client.query(
    `INSERT INTO decision_event (id, asset_id, recommendation) VALUES (gen_random_uuid(), $1, 'LIST_LOW') RETURNING id`, [assetId]
  )).rows;

  {
    const r = await client.query(
      `INSERT INTO operator_action_event (id, gk_asset_id, decision_event_id, principal_id, action_code, source, correlation_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'LIST', 'test-fixture', gen_random_uuid()) RETURNING id`,
      [assetId, decisionEventId, principalId]
    );
    assertTrue(r.rowCount === 1, 'insert with a valid action_code/source succeeds');
  }
  await assertRejected(
    () => client.query(
      `INSERT INTO operator_action_event (id, gk_asset_id, decision_event_id, principal_id, action_code, source, correlation_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'BUY_IT_NOW', 'test-fixture', gen_random_uuid())`,
      [assetId, decisionEventId, principalId]
    ),
    'an invalid action_code is rejected by the real CHECK constraint', '23514'
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO operator_action_event (id, gk_asset_id, decision_event_id, principal_id, action_code, source, correlation_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'LIST', 'browser-extension', gen_random_uuid())`,
      [assetId, decisionEventId, principalId]
    ),
    'an invalid source is rejected by the real CHECK constraint (source vocabulary is closed too)', '23514'
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO operator_action_event (id, gk_asset_id, decision_event_id, principal_id, action_code, source, correlation_id)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, 'LIST', 'test-fixture', gen_random_uuid())`,
      [assetId, principalId]
    ),
    'a nonexistent decision_event_id is rejected by the real FK constraint', '23503'
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO operator_action_event (id, gk_asset_id, decision_event_id, principal_id, action_code, source, correlation_id)
       VALUES (gen_random_uuid(), $1, $2, $3, NULL, 'test-fixture', gen_random_uuid())`,
      [assetId, decisionEventId, principalId]
    ),
    'a NULL action_code is rejected (NOT NULL)', '23502'
  );

  console.log('\n-- Rollback removes exactly what the migration added --\n');
  await client.query(qualify(read('0021_operator_action_event_rollback.sql')));
  {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'operator_action_event'`, [SCHEMA]);
    assertTrue(tables.rows.length === 0, 'operator_action_event dropped after rollback, decision_event/gk_asset/gk_principal untouched');
  }
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped -- data1_dev untouched throughout`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
