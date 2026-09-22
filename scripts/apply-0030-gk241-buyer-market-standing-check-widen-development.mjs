#!/usr/bin/env node
/**
 * apply-0030-gk241-buyer-market-standing-check-widen-development — GK-241.
 * Applies db/data0/0030_gk241_buyer_market_standing_check_widen.sql to
 * real Development (data1_dev), scratch-schema-proven first
 * (tests/gk241-0030-migration-contract.test.js, 24/24).
 *
 * Development ONLY. Production DB target identity remains unresolved
 * (GK-235) — this script must never be pointed at Production. Confirmed
 * via db-admin-preflight.mjs's environment_marker check (a value stored
 * inside the database itself), not derived from hostname/env-var naming.
 *
 * Usage: node scripts/apply-0030-gk241-buyer-market-standing-check-widen-development.mjs
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
  label: 'apply 0030 (GK-241 market_standing widen) to Development',
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

  const beforeConstraint = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'buyer_decision_event_market_standing_check'
    AND conrelid = 'data1_dev.buyer_decision_event'::regclass
  `);
  console.log('\nBEFORE constraint definition:', beforeConstraint.rows[0]?.def || '(not found)');

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0030_gk241_buyer_market_standing_check_widen.sql'), 'utf8');
  console.log('\n--- applying 0030_gk241_buyer_market_standing_check_widen.sql verbatim ---');
  await client.query(sql);
  console.log('--- 0030 applied, no error ---\n');

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

  const afterConstraint = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'buyer_decision_event_market_standing_check'
    AND conrelid = 'data1_dev.buyer_decision_event'::regclass
  `);
  console.log('\nAFTER constraint definition:', afterConstraint.rows[0]?.def || '(not found)');

  console.log('\n=== RESULT: SUCCESS (Development) ===');
} finally {
  await client.end();
}
