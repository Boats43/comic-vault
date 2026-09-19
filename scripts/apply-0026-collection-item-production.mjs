#!/usr/bin/env node
/**
 * apply-0026-collection-item-production — one-time, additive-only
 * migration apply.
 *
 * GRAILKEY cross-device sync investigation (2026-09-18): a real two-
 * device operator proof (phone + desktop, same account, both able to
 * log in/out independently) found the Collection tab never
 * synchronizes between devices. Root cause, confirmed via a direct
 * read-only query against the real Production database: the
 * db/data0/0026_collection_item.sql migration (GK-216, "Clean
 * Account/Collection Cutover") was written and its application code
 * (api/collection.js, src/modules/collection/) shipped and deployed,
 * but the DDL itself was never actually run against the real
 * Production data1_dev schema — `SELECT to_regclass('data1_dev.
 * collection_item')` returns NULL there today. Both
 * POST /api/collection (phone write) and GET /api/collection (desktop
 * read) throw "relation does not exist" against real Production; both
 * failures are swallowed client-side by design (collectionSync.js
 * never lets a server failure block/lose a local save), so nothing
 * ever looked broken — each device was silently local-only.
 *
 * This script applies db/data0/0026_collection_item.sql, verbatim, to
 * the real Production database — CREATE TABLE IF NOT EXISTS + CREATE
 * INDEX IF NOT EXISTS only. Purely additive: never drops, alters, or
 * touches any existing table or row. Paired rollback file already
 * exists: db/data0/0026_collection_item_rollback.sql.
 *
 * Goes through db-admin-preflight.mjs's assertAdminDbTarget() FIRST —
 * the same hard gate (database name, data1_dev schema present,
 * environment identity == GRAILKEY_CATALOG_ENVIRONMENT) every other
 * admin script in this directory uses. Refuses to run if that fails.
 * Never prints the connection string.
 *
 * Usage:
 *   node scripts/apply-0026-collection-item-production.mjs
 *
 * Env resolution: uses GRAILKEY_CATALOG_DATABASE_URL /
 * GRAILKEY_CATALOG_ENVIRONMENT from process.env if already set,
 * otherwise falls back to reading them from
 * .env.production-secrets.local (gitignored, local-only) — same
 * fallback shape pg-dump-development.mjs uses for
 * .env.development.local, just pointed at the Production file.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

for (const v of ['GRAILKEY_CATALOG_DATABASE_URL', 'GRAILKEY_CATALOG_ENVIRONMENT']) {
  if (process.env[v]) continue;
  const text = readFileSync(path.join(repoRoot, '.env.production-secrets.local'), 'utf8');
  const m = text.match(new RegExp(`^${v}=(.+)$`, 'm'));
  if (m) process.env[v] = m[1].trim().replace(/^["']|["']$/g, '');
}

if (process.env.GRAILKEY_CATALOG_ENVIRONMENT !== 'production') {
  console.log(`[apply-0026] ABORT — GRAILKEY_CATALOG_ENVIRONMENT="${process.env.GRAILKEY_CATALOG_ENVIRONMENT}", expected "production". This script only ever targets Production. Refusing to proceed.`);
  process.exit(1);
}

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(__dirname, 'db-admin-preflight.mjs')));

const client = await assertAdminDbTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'apply 0026_collection_item.sql to Production',
});

try {
  const before = await client.query("SELECT to_regclass('data1_dev.collection_item') AS reg");
  console.log('[apply-0026] collection_item exists BEFORE apply:', before.rows[0].reg !== null);

  const sqlPath = path.join(repoRoot, 'db', 'data0', '0026_collection_item.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  console.log('[apply-0026] applying db/data0/0026_collection_item.sql verbatim…');
  await client.query(sql);
  console.log('[apply-0026] apply complete, no error.');

  const after = await client.query("SELECT to_regclass('data1_dev.collection_item') AS reg");
  console.log('[apply-0026] collection_item exists AFTER apply:', after.rows[0].reg !== null);

  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'data1_dev' AND tablename = 'collection_item'`
  );
  console.log('[apply-0026] indexes on collection_item:', idx.rows.map((r) => r.indexname));

  const count = await client.query('SELECT count(*) AS n FROM data1_dev.collection_item');
  console.log('[apply-0026] row count (expect 0, brand-new table):', count.rows[0].n);

  console.log('[apply-0026] RESULT: SUCCESS');
} finally {
  await client.end();
}
