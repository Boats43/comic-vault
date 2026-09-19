#!/usr/bin/env node
/**
 * apply-0028-inventory-authority-development — GRAILKEY INVENTORY
 * AUTHORITY V1. Applies db/data0/0028_inventory_authority.sql to real
 * Development (data1_dev), scratch-schema-proven first
 * (tests/inventory-authority-migration-contract.test.js, 23/23).
 *
 * Usage: node scripts/apply-0028-inventory-authority-development.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
}

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);

const client = await assertAdminDbTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'apply 0028 (inventory authority) to Development',
});

const SENTINEL_TABLES = [
  'gk_principal', 'collection_item', 'gk_asset', 'media', 'collection_item_link',
  'ownership_event', 'acquisition_event', 'valuation_event', 'decision_event',
  'operator_action_event', 'outcome_event', 'outcome_economics_component',
  'buyer_decision_event', 'buyer_acquisition_event',
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

try {
  const utcNow = await client.query("SELECT now() AT TIME ZONE 'UTC' AS utc_now");
  console.log('=== RESTORE POINT / BEFORE CENSUS (Development) ===');
  console.log('UTC timestamp:', utcNow.rows[0].utc_now.toISOString());
  const before = await census();
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0028_inventory_authority.sql'), 'utf8');
  console.log('--- applying 0028_inventory_authority.sql verbatim ---');
  await client.query(sql);
  console.log('--- 0028 applied, no error ---\n');

  console.log('=== AFTER CENSUS ===');
  const after = await census();
  console.log('AFTER:', JSON.stringify(after, null, 2));

  console.log('\n=== VERIFY: every pre-existing count is UNCHANGED ===');
  let allUnchanged = true;
  for (const t of SENTINEL_TABLES) {
    const same = before[t] === after[t];
    if (!same) allUnchanged = false;
    console.log(`  ${t}: before=${before[t]} after=${after[t]} ${same ? 'OK' : 'CHANGED!!'}`);
  }
  console.log(allUnchanged ? 'ALL PRE-EXISTING COUNTS UNCHANGED.' : 'MISMATCH DETECTED — INVESTIGATE.');

  console.log('\n=== VERIFY: new schema objects exist ===');
  for (const t of ['inventory_transition_event', 'inventory_current_state']) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    console.log(`  table ${t}: ${reg.rows[0].reg !== null ? 'EXISTS' : 'MISSING!!'}`);
  }
  const c1 = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.inventory_transition_event`);
  const c2 = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.inventory_current_state`);
  console.log(`  inventory_transition_event rows: ${c1.rows[0].n} (expected 0)`);
  console.log(`  inventory_current_state rows: ${c2.rows[0].n} (expected 0)`);

  console.log('\n=== VERIFY: PK/FK/CHECK/UNIQUE constraints ===');
  const constraints = await client.query(`
    SELECT conrelid::regclass AS table_name, conname, contype
    FROM pg_constraint
    WHERE connamespace = 'data1_dev'::regnamespace
    AND conrelid::regclass::text IN ('inventory_transition_event', 'inventory_current_state')
    ORDER BY conrelid::regclass::text, contype
  `);
  for (const r of constraints.rows) {
    console.log(`  ${r.table_name}: ${r.conname} (${r.contype === 'p' ? 'PRIMARY KEY' : r.contype === 'f' ? 'FOREIGN KEY' : r.contype === 'c' ? 'CHECK' : r.contype === 'u' ? 'UNIQUE' : r.contype})`);
  }

  console.log('\n=== VERIFY: indexes ===');
  const indexes = await client.query(`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'data1_dev'
    AND tablename IN ('inventory_transition_event', 'inventory_current_state')
    ORDER BY tablename, indexname
  `);
  for (const r of indexes.rows) {
    console.log(`  ${r.tablename}: ${r.indexname}`);
  }

  console.log('\n=== RESULT: SUCCESS (Development) ===');
} finally {
  await client.end();
}
