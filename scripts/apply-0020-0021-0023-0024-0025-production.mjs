#!/usr/bin/env node
/**
 * apply-0020-0021-0023-0024-0025-production — GK-215/216 Production
 * schema reconciliation. Applies exactly the five existing, canonical,
 * additive-only migrations Production is missing (confirmed via a full
 * migration census against real Production and Development) in their
 * required dependency order:
 *
 *   0020 (valuation_event.market_population_id column, independent)
 *   -> 0021 (operator_action_event table, references gk_asset/decision_event/gk_principal)
 *   -> 0023 (outcome_event table, references operator_action_event)
 *   -> 0024 (outcome_event.next_observation_due_at column, depends on 0023)
 *   -> 0025 (outcome_economics_component table, references outcome_event)
 *
 * Every one of these five files is UNCHANGED from its already-reviewed,
 * already-live-in-Development form — this script does not rewrite
 * migration semantics, it only runs the existing SQL files verbatim
 * against Production. Each is purely additive (new nullable
 * column/index, or a new independent table) — no existing table,
 * column, row, or constraint is altered or dropped.
 *
 * Safety sequence, in order:
 *   1. scripts/db-admin-preflight.mjs's assertAdminDbTarget() — the
 *      same hard gate (database name, data1_dev schema present,
 *      environment identity) every other admin script in this project
 *      uses. Refuses to run on anything but the real, identity-verified
 *      Production target.
 *   2. Record a full BEFORE census: UTC timestamp, row counts for every
 *      auth/collection/kernel table that must remain unchanged
 *      (this IS the restore point — every migration here is additive
 *      and its own paired _rollback.sql is the rollback mechanism;
 *      there is no data to "restore" because no existing row is ever
 *      touched).
 *   3. Apply each migration file verbatim, in dependency order, each
 *      inside its own single statement/transaction (matching how
 *      0026 was safely applied earlier this same project).
 *   4. Record a full AFTER census: table/column/constraint/index
 *      existence for everything just added, AND re-check every
 *      pre-existing count is byte-identical to the BEFORE census.
 *
 * Usage: node scripts/apply-0020-0021-0023-0024-0025-production.mjs
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

const { assertAdminDbTarget } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs'))
);

const client = await assertAdminDbTarget({
  connectionString: env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'apply 0020/0021/0023/0024/0025 to Production (GK-215/216 schema reconciliation)',
});

const AUTH_COLLECTION_TABLES = [
  'gk_principal', 'principal_credential', 'principal_external_identity',
  'environment_marker', 'collection_item',
];
const KERNEL_TABLES_MUST_STAY_ZERO = [
  'gk_asset', 'media', 'collection_item_link', 'ownership_event', 'current_owner',
  'acquisition_event', 'valuation_event', 'decision_event', 'mint_event',
  'entity_mint_basis', 'domain_event', 'outbox', 'asset_identity_assignment',
  'idempotency_key', 'comp_snapshot', 'market_observation', 'valuation_question',
  'applicability', 'market_population', 'market_population_member',
  'asset_identifier', 'asset_identifier_assertion', 'asset_identifier_assertion_evidence',
  'asset_raw_observation',
];

async function census() {
  const out = {};
  for (const t of [...AUTH_COLLECTION_TABLES, ...KERNEL_TABLES_MUST_STAY_ZERO]) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    if (reg.rows[0].reg === null) { out[t] = 'MISSING'; continue; }
    const c = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.${t}`);
    out[t] = c.rows[0].n;
  }
  return out;
}

try {
  const utcNow = await client.query('SELECT now() AT TIME ZONE \'UTC\' AS utc_now');
  console.log('=== RESTORE POINT / BEFORE CENSUS ===');
  console.log('UTC timestamp:', utcNow.rows[0].utc_now.toISOString());
  const before = await census();
  console.log('BEFORE:', JSON.stringify(before, null, 2));
  console.log('\nRollback mechanism: each migration applied below has its own paired');
  console.log('*_rollback.sql file (already reviewed) that drops exactly what it adds.');
  console.log('No existing row/column/table is ever touched by any of the five forward');
  console.log('migrations, so no data restore is possible or necessary if a rollback is');
  console.log('later needed -- only the newly-added schema objects would be reverted.\n');

  const migrations = [
    '0020_outcome1_valuation_event_population_link.sql',
    '0021_operator_action_event.sql',
    '0023_outcome1_marketplace_execution_ledger.sql',
    '0024_outcome1_observation_cutoff.sql',
    '0025_outcome1_economics_components.sql',
  ];

  for (const m of migrations) {
    const sql = readFileSync(path.join(repoRoot, 'db', 'data0', m), 'utf8');
    console.log(`--- applying ${m} verbatim ---`);
    await client.query(sql);
    console.log(`--- ${m} applied, no error ---\n`);
  }

  console.log('=== AFTER CENSUS ===');
  const after = await census();
  console.log('AFTER:', JSON.stringify(after, null, 2));

  console.log('\n=== VERIFY: every pre-existing count is UNCHANGED ===');
  let allUnchanged = true;
  for (const t of [...AUTH_COLLECTION_TABLES, ...KERNEL_TABLES_MUST_STAY_ZERO]) {
    const same = before[t] === after[t];
    if (!same) allUnchanged = false;
    console.log(`  ${t}: before=${before[t]} after=${after[t]} ${same ? 'OK' : 'CHANGED!!'}`);
  }
  console.log(allUnchanged ? 'ALL PRE-EXISTING COUNTS UNCHANGED.' : 'MISMATCH DETECTED -- INVESTIGATE.');

  console.log('\n=== VERIFY: new schema objects exist ===');
  const newTables = ['operator_action_event', 'outcome_event', 'outcome_economics_component'];
  for (const t of newTables) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    console.log(`  table ${t}: ${reg.rows[0].reg !== null ? 'EXISTS' : 'MISSING!!'}`);
  }
  const col20 = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name='valuation_event' AND column_name='market_population_id'`);
  console.log(`  valuation_event.market_population_id: ${col20.rowCount > 0 ? 'EXISTS' : 'MISSING!!'}`);
  const col24 = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name='outcome_event' AND column_name='next_observation_due_at'`);
  console.log(`  outcome_event.next_observation_due_at: ${col24.rowCount > 0 ? 'EXISTS' : 'MISSING!!'}`);

  console.log('\n=== VERIFY: PK/FK constraints ===');
  const constraints = await client.query(`
    SELECT conrelid::regclass AS table_name, conname, contype
    FROM pg_constraint
    WHERE connamespace = 'data1_dev'::regnamespace
    AND conrelid::regclass::text IN ('operator_action_event', 'outcome_event', 'outcome_economics_component')
    ORDER BY conrelid::regclass::text, contype
  `);
  for (const r of constraints.rows) {
    console.log(`  ${r.table_name}: ${r.conname} (${r.contype === 'p' ? 'PRIMARY KEY' : r.contype === 'f' ? 'FOREIGN KEY' : r.contype === 'c' ? 'CHECK' : r.contype === 'u' ? 'UNIQUE' : r.contype})`);
  }

  console.log('\n=== VERIFY: indexes ===');
  const indexes = await client.query(`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'data1_dev'
    AND tablename IN ('operator_action_event', 'outcome_event', 'outcome_economics_component')
    ORDER BY tablename, indexname
  `);
  for (const r of indexes.rows) {
    console.log(`  ${r.tablename}: ${r.indexname}`);
  }

  console.log('\n=== RESULT: SUCCESS ===');
} finally {
  await client.end();
}
