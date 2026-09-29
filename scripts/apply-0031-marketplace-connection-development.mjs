#!/usr/bin/env node
/**
 * apply-0031-marketplace-connection-development — GK-263 Phase 1.
 * Applies db/data0/0031_marketplace_connection.sql to real Development
 * (data1_dev). Additive only — one new, fully independent table, no
 * existing kernel table altered.
 *
 * Development ONLY. This dispatch does not authorize a Production
 * migration — that requires separate authorization per standing
 * procedure. Confirmed via db-admin-preflight.mjs's environment_marker
 * check (a value stored inside the database itself), not derived from
 * hostname/env-var naming.
 *
 * Usage: node scripts/apply-0031-marketplace-connection-development.mjs
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
  label: 'apply 0031 (GK-263 marketplace_connection) to Development',
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

try {
  const utcNow = await client.query("SELECT now() AT TIME ZONE 'UTC' AS utc_now");
  console.log('=== RESTORE POINT / BEFORE CENSUS (Development) ===');
  console.log('UTC timestamp:', utcNow.rows[0].utc_now.toISOString());
  const before = await census();
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const beforeTable = await client.query(`SELECT to_regclass('data1_dev.marketplace_connection') AS reg`);
  console.log('\nBEFORE: data1_dev.marketplace_connection =', beforeTable.rows[0].reg);

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0031_marketplace_connection.sql'), 'utf8');
  console.log('\n--- applying 0031_marketplace_connection.sql verbatim ---');
  await client.query(sql);
  console.log('--- 0031 applied, no error ---\n');

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

  const afterTable = await client.query(`SELECT to_regclass('data1_dev.marketplace_connection') AS reg`);
  const rowCount = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.marketplace_connection`);
  console.log('\nAFTER: data1_dev.marketplace_connection =', afterTable.rows[0].reg, '| rows =', rowCount.rows[0].n);

  const constraints = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'data1_dev.marketplace_connection'::regclass
    ORDER BY conname
  `);
  console.log('\nConstraints on marketplace_connection:');
  constraints.rows.forEach((r) => console.log(`  ${r.conname}: ${r.def}`));

  const indexes = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'data1_dev' AND tablename = 'marketplace_connection'
    ORDER BY indexname
  `);
  console.log('\nIndexes on marketplace_connection:');
  indexes.rows.forEach((r) => console.log(`  ${r.indexname}: ${r.indexdef}`));

  console.log('\n=== RESULT: SUCCESS (Development) ===');
} finally {
  await client.end();
}
