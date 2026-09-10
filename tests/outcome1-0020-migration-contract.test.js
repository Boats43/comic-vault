// tests/outcome1-0020-migration-contract.test.js
//
// Outcome #1 — real, isolated Postgres SCRATCH schema proof of
// db/data0/0020_outcome1_valuation_event_population_link.sql, mirroring
// the D5A/B/C/D migration-contract tests' own discipline exactly.
// NEVER real data1_dev.
//
// Proves: the new market_population_id column exists, is nullable
// (legacy/no-D5-evidence valuations keep working unchanged), is a real
// FK into market_population (a bogus id is rejected), the paired index
// exists, the migration is idempotent-by-construction (safe to re-run),
// and the rollback removes exactly what the migration added.
//
// Invoke: node tests/outcome1-0020-migration-contract.test.js

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
    else { failed++; const m = `  ✗ ${label} (rejected but wrong code: expected ${expectedCode}, got ${e.code})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== Outcome #1 -- 0020 migration contract proof (real, isolated scratch schema) ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();

async function assertScratchTarget(label) {
  const r = await client.query('SELECT current_schema() AS s');
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
}

const SCHEMA = `outcome1_0020_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget('post-setup');

  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await client.query(`CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql`);
  await client.query(`
    CREATE TABLE asset_identity_assignment (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES gk_asset(id),
      catalog_entity_id UUID, authority TEXT NOT NULL CHECK (authority IN ('NONE','CONTESTED','CORROBORATED')),
      source TEXT NOT NULL CHECK (source IN ('vision','operator-correction','unresolved')),
      occurred_at TIMESTAMPTZ, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by UUID REFERENCES asset_identity_assignment(id)
    );
  `);

  // Real D5A/B/C migrations -- gives us a real market_population table
  // and the real FK chain leading to it, not a hand-rolled stand-in.
  await client.query(qualify(read('0014_d5a_market_observation.sql')));
  await client.query(qualify(read('0015_d1_identity_assignment_immutability.sql')));
  await client.query(qualify(read('0016_d5b_valuation_question_applicability.sql')));
  await client.query(qualify(read('0017_d5c_market_population.sql')));

  // Minimal valuation_event mirror -- the real 0004 shape, minus
  // comp_snapshot linkage (out of this migration's scope; 0020 touches
  // nothing about it).
  await client.query(`
    CREATE TABLE valuation_event (
      id UUID PRIMARY KEY,
      asset_id UUID NOT NULL REFERENCES gk_asset(id),
      value_amount NUMERIC(12,2) NOT NULL,
      value_currency TEXT NOT NULL DEFAULT 'USD',
      method TEXT NOT NULL CHECK (method IN ('engine-computed', 'operator-override', 'gocollect', 'other')),
      grade_assumption NUMERIC(3,1),
      build_sha TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      recorded_by_principal_id UUID NOT NULL REFERENCES gk_principal(id),
      occurred_at TIMESTAMPTZ
    );
  `);

  console.log('-- Pre-migration: market_population_id does not exist yet --\n');
  {
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'valuation_event'`, [SCHEMA]);
    assertTrue(!cols.rows.some((r) => r.column_name === 'market_population_id'), 'column absent before migration');
  }

  console.log('\n-- Apply 0020 --\n');
  await client.query(qualify(read('0020_outcome1_valuation_event_population_link.sql')));

  {
    const cols = await client.query(`SELECT column_name, is_nullable, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'valuation_event' AND column_name = 'market_population_id'`, [SCHEMA]);
    assertTrue(cols.rows.length === 1, 'market_population_id column now exists');
    assertTrue(cols.rows[0]?.is_nullable === 'YES', 'column is nullable (legacy/no-D5-evidence valuations unaffected)');
    assertTrue(cols.rows[0]?.udt_name === 'uuid', 'column is UUID-typed');
  }
  {
    const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'valuation_event' AND indexname = 'valuation_event_market_population_idx'`, [SCHEMA]);
    assertTrue(idx.rows.length === 1, 'valuation_event_market_population_idx index exists');
  }

  console.log('\n-- Idempotent-by-construction: re-applying 0020 does not error --\n');
  {
    let threw = false;
    try { await client.query(qualify(read('0020_outcome1_valuation_event_population_link.sql'))); }
    catch { threw = true; }
    assertTrue(!threw, 'second apply of 0020 is a no-op, does not throw');
  }

  console.log('\n-- Behavioral proof: FK enforcement + legacy-null compatibility --\n');
  const [{ id: assetId }] = (await client.query(`INSERT INTO gk_asset (id) VALUES (gen_random_uuid()) RETURNING id`)).rows;
  const [{ id: principalId }] = (await client.query(`INSERT INTO gk_principal (id) VALUES (gen_random_uuid()) RETURNING id`)).rows;
  const [{ id: identityAssignmentId }] = (await client.query(
    `INSERT INTO asset_identity_assignment (id, asset_id, authority, source) VALUES (gen_random_uuid(), $1, 'CORROBORATED', 'vision') RETURNING id`, [assetId]
  )).rows;
  const [{ id: questionId }] = (await client.query(
    `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, recorded_by_principal_id, content_hash)
     VALUES (gen_random_uuid(), $1, $2, 4.0, 'raw-estimate', 'raw', $3, 'test-hash-1') RETURNING id`,
    [assetId, identityAssignmentId, principalId]
  )).rows;
  const [{ id: populationId }] = (await client.query(
    `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES (gen_random_uuid(), $1, 'test-rule-v1', $2, gen_random_uuid(), 'test-pop-hash-1') RETURNING id`,
    [questionId, principalId]
  )).rows;

  {
    const r = await client.query(
      `INSERT INTO valuation_event (id, asset_id, value_amount, method, build_sha, recorded_by_principal_id, market_population_id)
       VALUES (gen_random_uuid(), $1, 61.41, 'engine-computed', 'test-sha', $2, $3) RETURNING id`,
      [assetId, principalId, populationId]
    );
    assertTrue(r.rowCount === 1, 'insert with a REAL market_population_id succeeds');
  }
  {
    const r = await client.query(
      `INSERT INTO valuation_event (id, asset_id, value_amount, method, build_sha, recorded_by_principal_id, market_population_id)
       VALUES (gen_random_uuid(), $1, 45.00, 'operator-override', 'test-sha', $2, NULL) RETURNING id`,
      [assetId, principalId]
    );
    assertTrue(r.rowCount === 1, 'insert with NULL market_population_id still succeeds (legacy/no-D5-evidence shape preserved)');
  }
  await assertRejected(
    () => client.query(
      `INSERT INTO valuation_event (id, asset_id, value_amount, method, build_sha, recorded_by_principal_id, market_population_id)
       VALUES (gen_random_uuid(), $1, 99.00, 'engine-computed', 'test-sha', $2, gen_random_uuid()) RETURNING id`,
      [assetId, principalId]
    ),
    'insert with a BOGUS market_population_id is rejected by the real FK constraint',
    '23503'
  );

  console.log('\n-- Rollback removes exactly what the migration added --\n');
  await client.query(qualify(read('0020_outcome1_valuation_event_population_link_rollback.sql')));
  {
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'valuation_event'`, [SCHEMA]);
    assertTrue(!cols.rows.some((r) => r.column_name === 'market_population_id'), 'column removed after rollback');
    const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'valuation_event'`, [SCHEMA]);
    assertTrue(!idx.rows.some((r) => r.indexname === 'valuation_event_market_population_idx'), 'index removed after rollback');
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
