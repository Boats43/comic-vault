#!/usr/bin/env node
/**
 * apply-0032-marketplace-connection-provider-identity-permanent-development
 * — GK-263 invariant-review correction. Applies
 * db/data0/0032_marketplace_connection_provider_identity_permanent.sql
 * to real Development (data1_dev): replaces 0031's active-scoped partial
 * provider-identity unique index with a plain, permanent one — a
 * disconnect must never free a provider account for a different
 * principal (see the migration's own header for the reproduced defect).
 *
 * Development ONLY, same as 0031 itself.
 *
 * Usage: node scripts/apply-0032-marketplace-connection-provider-identity-permanent-development.mjs
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
  label: 'apply 0032 (GK-263 provider-identity permanent uniqueness) to Development',
});

try {
  const utcNow = await client.query("SELECT now() AT TIME ZONE 'UTC' AS utc_now");
  console.log('=== RESTORE POINT (Development) ===');
  console.log('UTC timestamp:', utcNow.rows[0].utc_now.toISOString());

  const rowCountBefore = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.marketplace_connection`);
  console.log('BEFORE: marketplace_connection row count =', rowCountBefore.rows[0].n);

  const beforeIndexes = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'data1_dev' AND tablename = 'marketplace_connection'
    ORDER BY indexname
  `);
  console.log('\nBEFORE indexes:');
  beforeIndexes.rows.forEach((r) => console.log(`  ${r.indexname}: ${r.indexdef}`));

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0032_marketplace_connection_provider_identity_permanent.sql'), 'utf8');
  console.log('\n--- applying 0032_marketplace_connection_provider_identity_permanent.sql verbatim ---');
  await client.query(sql);
  console.log('--- 0032 applied, no error ---\n');

  const rowCountAfter = await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.marketplace_connection`);
  console.log('AFTER: marketplace_connection row count =', rowCountAfter.rows[0].n, rowCountAfter.rows[0].n === rowCountBefore.rows[0].n ? '(unchanged, OK)' : '(CHANGED!! investigate)');

  const afterIndexes = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'data1_dev' AND tablename = 'marketplace_connection'
    ORDER BY indexname
  `);
  console.log('\nAFTER indexes:');
  afterIndexes.rows.forEach((r) => console.log(`  ${r.indexname}: ${r.indexdef}`));

  console.log('\n=== RESULT: SUCCESS (Development) ===');
} finally {
  await client.end();
}
