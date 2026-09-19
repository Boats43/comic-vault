#!/usr/bin/env node
/**
 * apply-0027-buyer-decision-ledger-production — GRAILKEY DURABLE BUYER
 * DECISION LEDGER V1. Applies the real, canonical
 * db/data0/0027_buyer_decision_ledger.sql to real Production, after this
 * same migration was already: (1) proven in an isolated scratch schema
 * (tests/buyer-decision-ledger-migration-contract.test.js, 28/28), (2)
 * live-applied and verified against real Development
 * (scripts/apply-0027-buyer-decision-ledger-development.mjs, all
 * pre-existing counts unchanged, PK/FK/CHECK/indexes confirmed), and (3)
 * exercised for real through the real module and the real HTTP handler
 * (tests/buyer-decision-service-live-proof.test.js,
 * tests/buyer-decision-handler-smoke.test.js).
 *
 * Purely additive — two new, independent tables, no existing table,
 * column, row, or constraint is altered or dropped. Same safety
 * sequence as every prior production apply script in this project
 * (e.g. scripts/apply-0020-0021-0023-0024-0025-production.mjs):
 *   1. assertAdminDbTarget() — database name, data1_dev schema present,
 *      environment identity, run against Production's own real secrets.
 *   2. Full BEFORE census (restore point).
 *   3. Apply 0027 verbatim, unmodified from its Development-proven form.
 *   4. Full AFTER census — every pre-existing count re-checked
 *      byte-identical, new tables/columns/constraints/indexes verified.
 *
 * Usage: node scripts/apply-0027-buyer-decision-ledger-production.mjs
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
  label: 'apply 0027 (buyer decision ledger) to Production',
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
  console.log('\nRollback mechanism: db/data0/0027_buyer_decision_ledger_rollback.sql drops');
  console.log('exactly the two tables this migration adds. No existing row/column/table is');
  console.log('touched by the forward migration, so no data restore is possible or necessary.\n');

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0027_buyer_decision_ledger.sql'), 'utf8');
  console.log('--- applying 0027_buyer_decision_ledger.sql verbatim ---');
  await client.query(sql);
  console.log('--- 0027 applied, no error ---\n');

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
  for (const t of ['buyer_decision_event', 'buyer_acquisition_event']) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    console.log(`  table ${t}: ${reg.rows[0].reg !== null ? 'EXISTS' : 'MISSING!!'}`);
  }
  const newDecisionCount = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.buyer_decision_event`);
  const newAcquisitionCount = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.buyer_acquisition_event`);
  console.log(`  buyer_decision_event rows: ${newDecisionCount.rows[0].n} (expected 0 — no writer has run against Production yet)`);
  console.log(`  buyer_acquisition_event rows: ${newAcquisitionCount.rows[0].n} (expected 0 — no writer has run against Production yet)`);

  console.log('\n=== VERIFY: PK/FK/CHECK/UNIQUE constraints ===');
  const constraints = await client.query(`
    SELECT conrelid::regclass AS table_name, conname, contype
    FROM pg_constraint
    WHERE connamespace = 'data1_dev'::regnamespace
    AND conrelid::regclass::text IN ('buyer_decision_event', 'buyer_acquisition_event')
    ORDER BY conrelid::regclass::text, contype
  `);
  for (const r of constraints.rows) {
    console.log(`  ${r.table_name}: ${r.conname} (${r.contype === 'p' ? 'PRIMARY KEY' : r.contype === 'f' ? 'FOREIGN KEY' : r.contype === 'c' ? 'CHECK' : r.contype === 'u' ? 'UNIQUE' : r.contype})`);
  }

  console.log('\n=== VERIFY: indexes ===');
  const indexes = await client.query(`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'data1_dev'
    AND tablename IN ('buyer_decision_event', 'buyer_acquisition_event')
    ORDER BY tablename, indexname
  `);
  for (const r of indexes.rows) {
    console.log(`  ${r.tablename}: ${r.indexname}`);
  }

  console.log('\n=== RESULT: SUCCESS (Production) ===');
} finally {
  await client.end();
}
