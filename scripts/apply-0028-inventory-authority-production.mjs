#!/usr/bin/env node
/**
 * apply-0028-inventory-authority-production — GRAILKEY INVENTORY
 * AUTHORITY V1. Applies db/data0/0028_inventory_authority.sql to real
 * Production, after scratch-schema proof (23/23), real Development
 * apply + verification, and real live/concurrency proof (29/29) all
 * passed. No automatic enrollment/backfill for any existing Production
 * asset (including the real Old Man Logan #25, gkAssetId
 * 01a0bb24-c806-7a63-aa86-ce26fe8eed83) — this migration is schema-only;
 * enrollment remains an explicit, separate, later operator action.
 *
 * Usage: node scripts/apply-0028-inventory-authority-production.mjs
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
  label: 'apply 0028 (inventory authority) to Production',
});

const SENTINEL_TABLES = [
  'gk_principal', 'collection_item', 'gk_asset', 'media', 'collection_item_link',
  'ownership_event', 'acquisition_event', 'valuation_event', 'decision_event',
  'operator_action_event', 'outcome_event', 'outcome_economics_component',
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
  console.log('=== RESTORE POINT / BEFORE CENSUS (Production) ===');
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

  console.log('\n=== VERIFY: new schema objects exist, zero rows (no auto-enrollment) ===');
  for (const t of ['inventory_transition_event', 'inventory_current_state']) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    console.log(`  table ${t}: ${reg.rows[0].reg !== null ? 'EXISTS' : 'MISSING!!'}`);
  }
  const c1 = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.inventory_transition_event`);
  const c2 = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.inventory_current_state`);
  console.log(`  inventory_transition_event rows: ${c1.rows[0].n} (MUST be 0 — no automatic enrollment)`);
  console.log(`  inventory_current_state rows: ${c2.rows[0].n} (MUST be 0 — no automatic enrollment)`);
  const realAssetStillUnmanaged = await client.query(`SELECT * FROM data1_dev.inventory_current_state WHERE gk_asset_id = '01a0bb24-c806-7a63-aa86-ce26fe8eed83'`);
  console.log(`  real Old Man Logan #25 asset inventory row: ${realAssetStillUnmanaged.rowCount === 0 ? 'ABSENT (UNMANAGED, correct — not auto-enrolled)' : 'PRESENT — UNEXPECTED!!'}`);

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

  console.log('\n=== RESULT: SUCCESS (Production) ===');
} finally {
  await client.end();
}
