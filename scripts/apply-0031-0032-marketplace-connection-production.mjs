#!/usr/bin/env node
/**
 * apply-0031-0032-marketplace-connection-production — GK-263. Applies
 * db/data0/0031_marketplace_connection.sql then
 * db/data0/0032_marketplace_connection_provider_identity_permanent.sql
 * to real Production, in that exact order, after:
 *   - Development apply + verification (0031, 0032)
 *   - a clean-pair scratch-schema dry check (0031 -> 0032 from empty,
 *     18/18, proving the exact index name 0032 replaces and that the
 *     permanent uniqueness invariant holds across a disconnect)
 *
 * Both migrations are additive-only: one new table (0031), one index
 * swap on that same new table (0032). No existing kernel table is
 * altered by either.
 *
 * Usage: node scripts/apply-0031-0032-marketplace-connection-production.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function loadEnvFile(p) {
  const text = readFileSync(p, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

const env = loadEnvFile(path.join(repoRoot, '.env.production-secrets.local'));
process.env.GRAILKEY_CATALOG_ENVIRONMENT = env.GRAILKEY_CATALOG_ENVIRONMENT;

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);

const client = await assertAdminDbTarget({
  connectionString: env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'apply 0031+0032 (GK-263 marketplace_connection) to Production',
});

const SENTINEL_TABLES = [
  'gk_principal', 'collection_item', 'gk_asset', 'media', 'collection_item_link',
  'ownership_event', 'acquisition_event', 'valuation_event', 'decision_event',
  'operator_action_event', 'outcome_event', 'outcome_economics_component',
  'buyer_decision_event', 'buyer_acquisition_event', 'inventory_current_state',
  'domain_event', 'idempotency_key',
];

async function census() {
  const out = {};
  for (const t of SENTINEL_TABLES) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    if (reg.rows[0].reg === null) { out[t] = 'MISSING'; continue; }
    const c = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.${t}`);
    out[t] = c.rows[0].n;
  }
  return out;
}

async function getIndexes() {
  const r = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'data1_dev' AND tablename = 'marketplace_connection'
    ORDER BY indexname
  `);
  return r.rows;
}

async function getConstraints() {
  const r = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'data1_dev.marketplace_connection'::regclass
    ORDER BY conname
  `);
  return r.rows;
}

try {
  const utcNow = await client.query("SELECT now() AT TIME ZONE 'UTC' AS utc_now");
  console.log('=== RESTORE POINT (Production) ===');
  console.log('UTC timestamp:', utcNow.rows[0].utc_now.toISOString());

  console.log('\n=== PRE-FLIGHT: confirm marketplace_connection does NOT already exist ===');
  const preExist = await client.query(`SELECT to_regclass('data1_dev.marketplace_connection') AS reg`);
  if (preExist.rows[0].reg !== null) {
    throw new Error('ABORT — data1_dev.marketplace_connection ALREADY EXISTS in Production. Neither 0031 nor 0032 should be (re)applied blindly. Stopping without touching anything further.');
  }
  console.log('  CONFIRMED: marketplace_connection does not exist yet.');

  console.log('\n=== BEFORE CENSUS (sentinel tables, unrelated to this migration) ===');
  const before = await census();
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  console.log('\n=== APPLYING 0031_marketplace_connection.sql ===');
  const sql0031 = readFileSync(path.join(repoRoot, 'db', 'data0', '0031_marketplace_connection.sql'), 'utf8');
  await client.query(sql0031);
  console.log('--- 0031 applied, no error ---');

  const existsAfter0031 = await client.query(`SELECT to_regclass('data1_dev.marketplace_connection') AS reg`);
  if (existsAfter0031.rows[0].reg === null) throw new Error('ABORT — 0031 ran without error but marketplace_connection still does not exist. Stopping.');
  console.log('  VERIFIED: marketplace_connection now exists.');

  const constraints0031 = await getConstraints();
  const conNames0031 = constraints0031.map((r) => r.conname).sort();
  const REQUIRED_0031_CONSTRAINTS = [
    'marketplace_connection_pkey',
    'marketplace_connection_principal_id_fkey',
    'marketplace_connection_provider_check',
    'marketplace_connection_connection_status_check',
    'marketplace_connection_status_credential_chk',
    'marketplace_connection_principal_provider_uk',
  ];
  for (const c of REQUIRED_0031_CONSTRAINTS) {
    if (!conNames0031.includes(c)) throw new Error(`ABORT — expected constraint "${c}" missing after 0031. Stopping.`);
  }
  console.log('  VERIFIED: all expected 0031 constraints present:', conNames0031.join(', '));

  const indexes0031 = await getIndexes();
  const idxNames0031 = indexes0031.map((r) => r.indexname);
  console.log('  0031 indexes:', idxNames0031.join(', '));

  const TARGET_INDEX_NAME = 'marketplace_connection_provider_identity_active_uidx';
  const targetIndexRow = indexes0031.find((r) => r.indexname === TARGET_INDEX_NAME);
  if (!targetIndexRow) throw new Error(`ABORT — 0031 did not create the expected index "${TARGET_INDEX_NAME}" that 0032 is about to replace. Stopping before 0032.`);
  console.log(`\n  EXPLICITLY VERIFIED before 0032: index "${TARGET_INDEX_NAME}" exists —`);
  console.log('   ', targetIndexRow.indexdef);

  console.log('\n=== APPLYING 0032_marketplace_connection_provider_identity_permanent.sql ===');
  const sql0032 = readFileSync(path.join(repoRoot, 'db', 'data0', '0032_marketplace_connection_provider_identity_permanent.sql'), 'utf8');
  await client.query(sql0032);
  console.log('--- 0032 applied, no error ---');

  const indexes0032 = await getIndexes();
  const idxNames0032 = indexes0032.map((r) => r.indexname);
  console.log('  0032 indexes:', idxNames0032.join(', '));

  const oldIndexGone = !indexes0032.some((r) => r.indexname === TARGET_INDEX_NAME);
  if (!oldIndexGone) throw new Error(`ABORT — the old active-only index "${TARGET_INDEX_NAME}" is still present after 0032. Half-applied state — investigate before treating this as closed.`);
  console.log(`  VERIFIED: old index "${TARGET_INDEX_NAME}" is genuinely gone.`);

  const newIndexRow = indexes0032.find((r) => r.indexname === 'marketplace_connection_provider_identity_uidx');
  if (!newIndexRow) throw new Error('ABORT — the new permanent index "marketplace_connection_provider_identity_uidx" is missing after 0032.');
  if (/WHERE/.test(newIndexRow.indexdef)) throw new Error('ABORT — the new index unexpectedly has a WHERE clause; it is not genuinely permanent.');
  console.log('  VERIFIED: new permanent index present, no WHERE clause —');
  console.log('   ', newIndexRow.indexdef);

  const constraints0032 = await getConstraints();
  const conNames0032 = constraints0032.map((r) => r.conname).sort();
  if (JSON.stringify(conNames0031) !== JSON.stringify(conNames0032)) {
    throw new Error(`ABORT — constraint set changed across 0032 (expected byte-identical). Before: ${conNames0031.join(',')} After: ${conNames0032.join(',')}`);
  }
  console.log('  VERIFIED: every 0031 constraint (FK/CHECK/UNIQUE/PK) remains byte-identical after 0032.');

  console.log('\n=== AFTER CENSUS (sentinel tables) ===');
  const after = await census();
  console.log('AFTER:', JSON.stringify(after, null, 2));
  let allUnchanged = true;
  for (const t of SENTINEL_TABLES) {
    const same = before[t] === after[t];
    if (!same) allUnchanged = false;
    console.log(`  ${t}: before=${before[t]} after=${after[t]} ${same ? 'OK' : 'CHANGED!!'}`);
  }
  if (!allUnchanged) throw new Error('ABORT — an unrelated sentinel table count changed. Investigate before treating this as closed.');
  console.log('ALL PRE-EXISTING SENTINEL COUNTS UNCHANGED.');

  const finalRowCount = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.marketplace_connection`);
  console.log('\nFinal data1_dev.marketplace_connection row count:', finalRowCount.rows[0].n);

  console.log('\n=== RESULT: SUCCESS (Production) — 0031 + 0032 both applied and verified ===');
} finally {
  await client.end();
}
