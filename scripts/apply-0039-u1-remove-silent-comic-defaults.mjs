#!/usr/bin/env node
/**
 * apply-0039-u1-remove-silent-comic-defaults -- Universal U1. Applies
 * db/data0/0039_u1_remove_silent_comic_defaults.sql (rerunnable). Prints a
 * before/after census of every sentinel table to prove no pre-existing row
 * changed, and proves the defaults are gone.
 *
 * Usage: node scripts/apply-0039-u1-remove-silent-comic-defaults.mjs <development|production> [--dry-run]
 *   --dry-run applies inside a transaction and ROLLS BACK (syntax/constraint proof only).
 *
 * PRODUCTION IS NOT AUTHORIZED BY THE U1 DISPATCH THAT CREATED THIS FILE; it
 * is a separate, explicitly-approved operator step.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2];
if (target !== 'development' && target !== 'production') { console.error('usage: apply-0039-u1-remove-silent-comic-defaults.mjs <development|production> [--dry-run]'); process.exit(2); }
const dryRun = process.argv.includes('--dry-run');
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(p) {
  const out = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}
const env = loadEnvFile(path.join(repoRoot, target === 'production' ? '.env.production-secrets.local' : '.env.development.local'));
process.env.GRAILKEY_CATALOG_ENVIRONMENT = target === 'production' ? 'production' : 'development';

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const client = await assertAdminDbTarget({ connectionString: env.GRAILKEY_CATALOG_DATABASE_URL, label: `apply 0039 (U1 remove silent comic defaults) to ${target}` });

const SENTINELS = ['gk_principal', 'collection_item', 'gk_asset', 'media', 'collection_item_link', 'valuation_event', 'decision_event', 'operator_action_event', 'outcome_event', 'outcome_economics_component', 'inventory_current_state'];
async function census() {
  const out = {};
  for (const t of SENTINELS) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    out[t] = reg.rows[0].reg === null ? 'MISSING' : (await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.${t}`)).rows[0].n;
  }
  return out;
}
async function categoryDistribution() {
  const a = await client.query('SELECT asset_class AS v, COUNT(*)::int AS n FROM data1_dev.gk_asset GROUP BY 1 ORDER BY 1');
  const c = await client.query('SELECT asset_category AS v, COUNT(*)::int AS n FROM data1_dev.collection_item GROUP BY 1 ORDER BY 1');
  return { gk_asset: a.rows, collection_item: c.rows };
}
async function defaults() {
  const r = await client.query(`SELECT table_name, column_name, column_default FROM information_schema.columns WHERE table_schema='data1_dev' AND ((table_name='gk_asset' AND column_name='asset_class') OR (table_name='collection_item' AND column_name='asset_category')) ORDER BY 1`);
  return r.rows;
}

try {
  console.log(`=== ${target}${dryRun ? ' (DRY RUN, rolls back)' : ''} -- UTC ${(await client.query(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t`)).rows[0].t} ===`);
  const before = await census();
  const distBefore = await categoryDistribution();
  console.log('BEFORE counts      ', JSON.stringify(before));
  console.log('BEFORE categories  ', JSON.stringify(distBefore));
  console.log('BEFORE defaults    ', JSON.stringify(await defaults()));
  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0039_u1_remove_silent_comic_defaults.sql'), 'utf8');
  if (dryRun) await client.query('BEGIN');
  await client.query(sql);
  if (dryRun) {
    console.log('AFTER (in-txn) defaults', JSON.stringify(await defaults()));
    await client.query('ROLLBACK');
    console.log('rolled back (dry run)');
  } else {
    console.log('0039 applied, no error');
    const after = await census();
    const distAfter = await categoryDistribution();
    console.log('AFTER counts       ', JSON.stringify(after));
    console.log('AFTER categories   ', JSON.stringify(distAfter));
    console.log('AFTER defaults     ', JSON.stringify(await defaults()));
    const same = SENTINELS.every((t) => before[t] === after[t]) && JSON.stringify(distBefore) === JSON.stringify(distAfter);
    console.log(same ? 'ALL PRE-EXISTING COUNTS AND CATEGORY VALUES UNCHANGED (no historical row rewritten)' : 'MISMATCH -- INVESTIGATE');
    const k = await client.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('gk_asset_asset_class_supported_check','collection_item_asset_category_supported_check') ORDER BY 1`);
    for (const r of k.rows) console.log('  constraint', r.conname, 'validated=', r.convalidated);
  }
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
