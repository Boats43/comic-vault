#!/usr/bin/env node
/**
 * apply-0033-valuation-provenance -- GK-276. Applies
 * db/data0/0033_valuation_event_provenance.sql (add column -> deterministic
 * backfill -> CHECK + NOT NULL) to ONE environment, with before/after census.
 *
 * Usage: node scripts/apply-0033-valuation-provenance.mjs <development|production>
 *
 * Refuses unless the target's environment_marker matches the argument
 * (db-admin-preflight). Reads connection values from the local env file
 * in-process; never prints them. Refuses to run twice (column must not exist).
 * This script performs UPDATEs on valuation_event (the backfill); the 0034
 * immutability triggers must NOT be installed yet -- it verifies that.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2];
if (!['development', 'production'].includes(target)) { console.error('usage: node scripts/apply-0033-valuation-provenance.mjs <development|production>'); process.exit(2); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envFile = target === 'production' ? '.env.production-secrets.local' : '.env.development.local';
for (const line of readFileSync(path.join(repoRoot, envFile), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
if (target === 'production') process.env.GRAILKEY_CATALOG_ENVIRONMENT = process.env.GRAILKEY_CATALOG_ENVIRONMENT || 'production';

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const client = await assertAdminDbTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: `apply 0033 (GK-276 valuation_event.provenance) to ${target}`,
});

try {
  const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker LIMIT 1')).rows[0]?.app_env;
  if (marker !== target) throw new Error(`ABORT -- environment_marker.app_env=${marker}, expected ${target}`);
  console.log(`environment_marker confirms: ${marker}`);

  const utc = (await client.query("SELECT now() AT TIME ZONE 'UTC' AS t")).rows[0].t;
  console.log('RESTORE POINT (UTC):', utc.toISOString());

  const col = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name='valuation_event' AND column_name='provenance'`);
  if (col.rowCount) throw new Error('ABORT -- valuation_event.provenance already exists; refusing to re-apply blindly.');
  const trig = await client.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'data1_dev.valuation_event'::regclass AND NOT tgisinternal`);
  if (trig.rowCount) throw new Error(`ABORT -- triggers already exist on valuation_event (${trig.rows.map((r) => r.tgname).join(',')}); the backfill must precede immutability.`);
  console.log('PRE-FLIGHT: no provenance column, no triggers on valuation_event.');

  const SENT = ['gk_asset', 'media', 'collection_item_link', 'ownership_event', 'valuation_event', 'decision_event', 'operator_action_event', 'outcome_event', 'domain_event', 'idempotency_key'];
  const census = async () => { const o = {}; for (const t of SENT) { const r = await client.query(`SELECT to_regclass('data1_dev.${t}') reg`); o[t] = r.rows[0].reg ? (await client.query(`SELECT count(*)::int n FROM data1_dev.${t}`)).rows[0].n : 'MISSING'; } return o; };
  const before = await census();
  const beforeVals = (await client.query(`SELECT id, asset_id, value_amount::text, method, build_sha, recorded_at FROM data1_dev.valuation_event ORDER BY id`)).rows;
  console.log('BEFORE census:', JSON.stringify(before));

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0033_valuation_event_provenance.sql'), 'utf8');
  await client.query('BEGIN');
  try { await client.query(sql); await client.query('COMMIT'); } catch (e) { await client.query('ROLLBACK'); throw e; }
  console.log('0033 applied (single transaction).');

  const after = await census();
  for (const t of SENT) if (before[t] !== after[t]) throw new Error(`ABORT -- ${t} count changed ${before[t]} -> ${after[t]}`);
  console.log('AFTER census identical (no row added/removed anywhere).');

  const afterVals = (await client.query(`SELECT id, asset_id, value_amount::text, method, build_sha, recorded_at, provenance FROM data1_dev.valuation_event ORDER BY id`)).rows;
  for (let i = 0; i < beforeVals.length; i++) {
    const b = beforeVals[i], a = afterVals[i];
    for (const k of ['id', 'asset_id', 'value_amount', 'method', 'build_sha']) if (String(b[k]) !== String(a[k])) throw new Error(`ABORT -- ${k} changed on ${b.id}`);
    if (new Date(b.recorded_at).getTime() !== new Date(a.recorded_at).getTime()) throw new Error(`ABORT -- recorded_at changed on ${b.id}`);
  }
  console.log('Every pre-existing valuation row unchanged except the new provenance column (method strings untouched).');

  const counts = (await client.query(`SELECT provenance, count(*)::int n FROM data1_dev.valuation_event GROUP BY 1 ORDER BY 1`)).rows;
  console.log('PROVENANCE COUNTS:', JSON.stringify(counts));
  if (target === 'production') {
    for (const r of afterVals) console.log('  prod row', r.id, r.value_amount, r.method, '->', r.provenance);
  }
  const cons = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='data1_dev.valuation_event'::regclass AND conname='valuation_event_provenance_check'`);
  const nn = await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name='valuation_event' AND column_name='provenance'`);
  console.log('CHECK present:', cons.rowCount === 1, '| is_nullable:', nn.rows[0].is_nullable);
  if (cons.rowCount !== 1 || nn.rows[0].is_nullable !== 'NO') throw new Error('ABORT -- constraint/NOT NULL missing');
  console.log(`\nRESULT: SUCCESS (${target})`);
} finally {
  await client.end();
}
