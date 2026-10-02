#!/usr/bin/env node
/**
 * apply-0034-economic-ledger-immutability -- GK-276. Installs the
 * UPDATE/DELETE/TRUNCATE-blocking triggers on valuation_event/decision_event
 * in ONE environment, only after 0033's backfill is verified there.
 *
 * Usage: node scripts/apply-0034-economic-ledger-immutability.mjs <development|production>
 *
 * Post-install proof is read-only in effect: each mutation attempt runs in
 * a savepoint that is rolled back, and is EXPECTED to be rejected. No row
 * is ever changed. No INSERT is performed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2];
if (!['development', 'production'].includes(target)) { console.error('usage: node scripts/apply-0034-economic-ledger-immutability.mjs <development|production>'); process.exit(2); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envFile = target === 'production' ? '.env.production-secrets.local' : '.env.development.local';
for (const line of readFileSync(path.join(repoRoot, envFile), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
if (target === 'production') process.env.GRAILKEY_CATALOG_ENVIRONMENT = process.env.GRAILKEY_CATALOG_ENVIRONMENT || 'production';
const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: `apply 0034 (GK-276 economic ledger immutability) to ${target}` });

try {
  const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker LIMIT 1')).rows[0]?.app_env;
  if (marker !== target) throw new Error(`ABORT -- environment_marker.app_env=${marker}, expected ${target}`);
  console.log(`environment_marker confirms: ${marker}`);
  console.log('RESTORE POINT (UTC):', (await client.query("SELECT now() AT TIME ZONE 'UTC' t")).rows[0].t.toISOString());

  const nulls = await client.query(`SELECT count(*)::int n FROM data1_dev.valuation_event WHERE provenance IS NULL`);
  if (nulls.rows[0].n) throw new Error('ABORT -- unclassified valuation rows exist; backfill incomplete');
  const existing = await client.query(`SELECT tgname FROM pg_trigger WHERE tgrelid IN ('data1_dev.valuation_event'::regclass,'data1_dev.decision_event'::regclass) AND NOT tgisinternal`);
  if (existing.rowCount) throw new Error(`ABORT -- triggers already present: ${existing.rows.map((r) => r.tgname).join(',')}`);

  const counts = async () => ({
    valuation: (await client.query('SELECT count(*)::int n FROM data1_dev.valuation_event')).rows[0].n,
    decision: (await client.query('SELECT count(*)::int n FROM data1_dev.decision_event')).rows[0].n,
  });
  const before = await counts();
  console.log('BEFORE counts:', JSON.stringify(before));

  await client.query('BEGIN');
  try { await client.query(readFileSync(path.join(repoRoot, 'db', 'data0', '0034_economic_ledger_immutability.sql'), 'utf8')); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  console.log('0034 applied.');

  const trg = await client.query(`SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgrelid IN ('data1_dev.valuation_event'::regclass,'data1_dev.decision_event'::regclass) AND NOT t.tgisinternal ORDER BY 1,2`);
  console.log('TRIGGERS:', trg.rows.map((r) => `${r.relname}.${r.tgname}`).join(', '));
  if (trg.rowCount !== 6) throw new Error('ABORT -- expected 6 triggers');

  const attempts = [
    ['valuation UPDATE', `UPDATE data1_dev.valuation_event SET build_sha = build_sha WHERE id = (SELECT id FROM data1_dev.valuation_event LIMIT 1)`],
    ['valuation DELETE', `DELETE FROM data1_dev.valuation_event WHERE id = (SELECT id FROM data1_dev.valuation_event LIMIT 1)`],
    ['decision UPDATE', `UPDATE data1_dev.decision_event SET recommendation = recommendation WHERE id = (SELECT id FROM data1_dev.decision_event LIMIT 1)`],
    ['decision DELETE', `DELETE FROM data1_dev.decision_event WHERE id = (SELECT id FROM data1_dev.decision_event LIMIT 1)`],
    ['valuation TRUNCATE', `TRUNCATE data1_dev.valuation_event`],
    ['decision TRUNCATE', `TRUNCATE data1_dev.decision_event`],
  ];
  for (const [label, sql] of attempts) {
    await client.query('BEGIN');
    let rejected = false, msg = '';
    try { await client.query(sql); } catch (e) { rejected = true; msg = e.message; }
    await client.query('ROLLBACK');
    console.log(`  ${label}: ${rejected ? 'REJECTED' : 'NOT REJECTED!!'} ${rejected ? '(' + msg.slice(0, 80) + ')' : ''}`);
    if (!rejected) throw new Error(`ABORT -- ${label} was not rejected`);
  }
  const after = await counts();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('ABORT -- counts changed');
  console.log('AFTER counts identical:', JSON.stringify(after));
  console.log(`\nRESULT: SUCCESS (${target})`);
} finally { await client.end(); }
