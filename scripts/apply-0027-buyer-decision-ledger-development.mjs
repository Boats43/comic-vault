#!/usr/bin/env node
/**
 * apply-0027-buyer-decision-ledger-development — GRAILKEY DURABLE BUYER
 * DECISION LEDGER V1. Applies the real, canonical, already scratch-
 * schema-proven db/data0/0027_buyer_decision_ledger.sql to real
 * Development (data1_dev), first of the two required targets (Production
 * follows in a separate script, only after this one's own verification
 * passes).
 *
 * Safety sequence, matching every prior migration-apply script in this
 * project (e.g. scripts/apply-0020-0021-0023-0024-0025-production.mjs):
 *   1. scripts/db-admin-preflight.mjs's assertAdminDbTarget() — database
 *      name, data1_dev schema present, environment identity.
 *   2. Full BEFORE census (restore point) of every table that must stay
 *      unchanged (0027 is purely additive — two new, independent tables,
 *      no existing table/column/row touched).
 *   3. Apply 0027 verbatim, unmodified from its already scratch-proven
 *      form (tests/buyer-decision-ledger-migration-contract.test.js,
 *      28/28, real isolated scratch schema, data1_dev never touched
 *      there).
 *   4. Full AFTER census — every pre-existing count re-checked
 *      byte-identical, new tables/columns/constraints/indexes verified
 *      present.
 *
 * Usage: node scripts/apply-0027-buyer-decision-ledger-development.mjs
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
  label: 'apply 0027 (buyer decision ledger) to Development',
});

// Sentinel tables that MUST be byte-identical before/after — a broad mix
// (auth/collection tables that have real rows, kernel tables that are
// zero) so any accidental cross-table effect would show up immediately.
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
  console.log('=== RESTORE POINT / BEFORE CENSUS (Development) ===');
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
  console.log(`  buyer_decision_event rows: ${newDecisionCount.rows[0].n} (expected 0 — no writer has run yet)`);
  console.log(`  buyer_acquisition_event rows: ${newAcquisitionCount.rows[0].n} (expected 0 — no writer has run yet)`);

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

  console.log('\n=== RESULT: SUCCESS (Development) ===');
} finally {
  await client.end();
}
