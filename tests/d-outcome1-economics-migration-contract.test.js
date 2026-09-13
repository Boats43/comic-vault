// tests/d-outcome1-economics-migration-contract.test.js
//
// GK-209 Outcome #1 CLOSER — real isolated-scratch-schema proof of
// db/data0/0025_outcome1_economics_components.sql BEFORE it is ever
// applied to data1_dev. Never touches data1_dev. Creates a throwaway
// schema, applies 0025 (plus its own minimal prerequisite tables:
// gk_principal, gk_asset, outcome_event — copied structurally, not the
// full 0004/0023 migrations, since this test only needs the FK targets
// to exist), proves the CHECK/FK constraints for real, then drops the
// scratch schema.
//
// Invoke: node tests/d-outcome1-economics-migration-contract.test.js

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
async function assertThrows(fn, label, matchCode) {
  try {
    await fn();
    failed++; console.log(`  ✗ ${label} (did not throw)`);
  } catch (e) {
    const ok = !matchCode || e.code === matchCode;
    if (ok) { passed++; console.log(`  ✓ ${label}`); }
    else { failed++; console.log(`  ✗ ${label} (wrong error code: ${e.code}, expected ${matchCode})`); }
  }
}

const SCHEMA = `gk209_econ_scratch_${Date.now()}`;
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log(`\n=== 0025 economics-component migration contract (scratch schema "${SCHEMA}") ===\n`);

await client.query(`CREATE SCHEMA ${SCHEMA}`);
await client.query(`SET search_path TO ${SCHEMA}`);

// Minimal structural prerequisites (FK targets only — not the real
// tables' full definitions, just enough for 0025's own FKs to attach to).
await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
await client.query(`CREATE TABLE decision_event (id UUID PRIMARY KEY, asset_id UUID)`);
await client.query(`CREATE TABLE operator_action_event (id UUID PRIMARY KEY, gk_asset_id UUID, decision_event_id UUID, action_code TEXT)`);
await client.query(`CREATE TABLE outcome_event (
  id UUID PRIMARY KEY, gk_asset_id UUID NOT NULL REFERENCES gk_asset(id),
  decision_event_id UUID REFERENCES decision_event(id), operator_action_event_id UUID REFERENCES operator_action_event(id),
  outcome_type TEXT NOT NULL, channel TEXT NOT NULL, external_listing_id TEXT,
  recorded_by_principal_id UUID NOT NULL REFERENCES gk_principal(id), occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

const migrationSql = readFileSync(path.join(repoRoot, 'db', 'data0', '0025_outcome1_economics_components.sql'), 'utf8')
  .replace(/^SET search_path TO data1_dev;/m, `SET search_path TO ${SCHEMA};`);
await client.query(migrationSql);
console.log('  0025 applied to scratch schema successfully.\n');

const PRINCIPAL = '00000000-0000-0000-0000-000000000001';
const ASSET = '00000000-0000-0000-0000-000000000002';
const OUTCOME = '00000000-0000-0000-0000-000000000003';
await client.query(`INSERT INTO gk_principal (id) VALUES ($1)`, [PRINCIPAL]);
await client.query(`INSERT INTO gk_asset (id) VALUES ($1)`, [ASSET]);
await client.query(`INSERT INTO outcome_event (id, gk_asset_id, outcome_type, channel, recorded_by_principal_id) VALUES ($1,$2,'SOLD','ebay',$3)`, [OUTCOME, ASSET, PRINCIPAL]);

console.log('-- valid rows insert cleanly --\n');
await client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), $1, 'gross', 75.00, 'api-sourced', $2, gen_random_uuid())`,
  [OUTCOME, PRINCIPAL]
);
assertTrue(true, 'a valid api-sourced gross component inserts cleanly');

await client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, source_reference, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), $1, 'fees', -8.25, 'operator-entered', 'manual note', $2, gen_random_uuid())`,
  [OUTCOME, PRINCIPAL]
);
assertTrue(true, 'a valid operator-entered fees component inserts cleanly (negative amount permitted — sign convention is the caller\'s, this table stores facts, not a forced-positive convention)');

await client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, external_order_id, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), $1, 'order_reference', NULL, 'api-sourced', '12-34567-89012', $2, gen_random_uuid())`,
  [OUTCOME, PRINCIPAL]
);
assertTrue(true, 'order_reference component with NULL amount inserts cleanly');

console.log('\n-- constraints reject invalid rows --\n');
await assertThrows(() => client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), $1, 'not-a-real-type', 5.00, 'api-sourced', $2, gen_random_uuid())`,
  [OUTCOME, PRINCIPAL]
), 'an invalid component_type is rejected', '23514');

await assertThrows(() => client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), $1, 'gross', 5.00, 'human-vibes', $2, gen_random_uuid())`,
  [OUTCOME, PRINCIPAL]
), 'an invalid source value is rejected', '23514');

await assertThrows(() => client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), $1, 'gross', NULL, 'api-sourced', $2, gen_random_uuid())`,
  [OUTCOME, PRINCIPAL]
), 'a NULL amount on a non-order_reference component is rejected', '23514');

await assertThrows(() => client.query(
  `INSERT INTO outcome_economics_component (id, outcome_event_id, component_type, amount, source, recorded_by_principal_id, correlation_id)
   VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000099', 'gross', 5.00, 'api-sourced', $1, gen_random_uuid())`,
  [PRINCIPAL]
), 'a nonexistent outcome_event_id is rejected (FK)', '23503');

console.log('\n-- realized net derivation (SUM, never a stored field) --\n');
const netQuery = await client.query(
  `SELECT
     COALESCE(SUM(amount) FILTER (WHERE component_type = 'gross'), 0)
     - COALESCE(SUM(amount) FILTER (WHERE component_type = 'fees'), 0)
     - COALESCE(SUM(amount) FILTER (WHERE component_type = 'shipping'), 0)
     - COALESCE(SUM(amount) FILTER (WHERE component_type = 'refund'), 0)
     + COALESCE(SUM(amount) FILTER (WHERE component_type = 'credit'), 0) AS realized_net
   FROM outcome_economics_component WHERE outcome_event_id = $1`,
  [OUTCOME]
);
// gross 75.00, fees -8.25 (stored as a negative fee amount here to prove
// the table itself imposes no sign convention) -> net = 75.00 - (-8.25) = 83.25
assertTrue(Number(netQuery.rows[0].realized_net) === 83.25, `realized net correctly derived from summed components (got ${netQuery.rows[0].realized_net})`);

console.log('\n-- rollback drops cleanly, nothing else touched --\n');
const rollbackSql = readFileSync(path.join(repoRoot, 'db', 'data0', '0025_outcome1_economics_components_rollback.sql'), 'utf8')
  .replace(/^SET search_path TO data1_dev;/m, `SET search_path TO ${SCHEMA};`);
await client.query(rollbackSql);
const tableCheck = await client.query(
  `SELECT count(*)::int c FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'outcome_economics_component'`,
  [SCHEMA]
);
assertTrue(tableCheck.rows[0].c === 0, 'rollback drops the table cleanly');
const outcomeEventStillThere = await client.query(`SELECT count(*)::int c FROM outcome_event WHERE id = $1`, [OUTCOME]);
assertTrue(outcomeEventStillThere.rows[0].c === 1, 'rollback did NOT touch outcome_event or any other table');

await client.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
await client.end();
console.log(`\n  scratch schema "${SCHEMA}" dropped.\n`);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
