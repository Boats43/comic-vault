#!/usr/bin/env node
/**
 * apply-0036-corpus-exclusion -- GK-278B. Applies db/data0/0036_learning_corpus_exclusion.sql to
 * Development or Production (additive, rerunnable). Prints a before/after census of
 * every sentinel table to prove no pre-existing row changed.
 *
 * Usage: node scripts/apply-0036-corpus-exclusion.mjs <development|production> [--dry-run]
 *   --dry-run applies inside a transaction and ROLLS BACK (syntax/constraint proof only).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2];
if (target !== 'development' && target !== 'production') { console.error('usage: apply-0036-corpus-exclusion.mjs <development|production> [--dry-run]'); process.exit(2); }
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
const client = await assertAdminDbTarget({ connectionString: env.GRAILKEY_CATALOG_DATABASE_URL, label: `apply 0036 (corpus exclusion) to ${target}` });

const SENTINELS = ['gk_principal', 'collection_item', 'gk_asset', 'media', 'collection_item_link', 'valuation_event', 'decision_event', 'operator_action_event', 'outcome_event', 'outcome_economics_component'];
async function census() {
  const out = {};
  for (const t of SENTINELS) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
    out[t] = reg.rows[0].reg === null ? 'MISSING' : (await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.${t}`)).rows[0].n;
  }
  return out;
}

try {
  console.log(`=== ${target}${dryRun ? ' (DRY RUN, rolls back)' : ''} -- UTC ${(await client.query("SELECT now() AT TIME ZONE 'UTC' AS t")).rows[0].t.toISOString()} ===`);
  const before = await census();
  console.log('BEFORE', JSON.stringify(before));
  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0036_learning_corpus_exclusion.sql'), 'utf8');
  if (dryRun) await client.query('BEGIN');
  await client.query(sql);
  if (dryRun) {
    const reg = await client.query(`SELECT to_regclass('data1_dev.learning_corpus_exclusion') AS a, to_regclass('data1_dev.operator_correction_event') AS b`);
    console.log('inside txn: learning_corpus_exclusion', reg.rows[0].a, 'operator_correction_event', reg.rows[0].b);
    await client.query('ROLLBACK');
    console.log('rolled back (dry run)');
  } else {
    console.log('0036 applied, no error');
    const after = await census();
    let same = true;
    for (const t of SENTINELS) { if (before[t] !== after[t]) same = false; }
    console.log('AFTER ', JSON.stringify(after));
    console.log(same ? 'ALL PRE-EXISTING COUNTS UNCHANGED' : 'COUNT MISMATCH -- INVESTIGATE');
    for (const t of ['learning_corpus_exclusion']) {
      const reg = await client.query(`SELECT to_regclass('data1_dev.${t}') AS reg`);
      const n = reg.rows[0].reg ? (await client.query(`SELECT COUNT(*)::int AS n FROM data1_dev.${t}`)).rows[0].n : 'MISSING';
      console.log(`${t}: rows=${n}`);
    }
    const trg = await client.query(`SELECT tgrelid::regclass AS t, tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('learning_corpus_exclusion') ORDER BY 1,2`);
    for (const r of trg.rows) console.log('  trigger', r.t, r.tgname);
  }
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
