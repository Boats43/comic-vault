// tests/gk276-0034-immutability-contract.test.js
//
// GK-276 -- (A) real scratch-schema proof of db/data0/0034_economic_ledger_immutability.sql:
// UPDATE/DELETE/TRUNCATE rejected on valuation_event and decision_event, INSERT works,
// and the migration REFUSES to install before 0033's backfill is complete.
// (B) the same triggers verified against real data1_dev (each mutation attempt runs
// inside a transaction that is rolled back; nothing is ever changed).
// Invoke: node tests/gk276-0034-immutability-contract.test.js
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const rejected = async (client, sql, params, l, frag) => {
  await client.query('SAVEPOINT s');
  try { await client.query(sql, params); ok(false, `${l} (NOT rejected)`); await client.query('ROLLBACK TO s'); }
  catch (e) { ok(!frag || e.message.includes(frag), `${l} (rejected: ${e.message.slice(0, 80)})`); await client.query('ROLLBACK TO s'); }
};

console.log('\n=== GK-276 -- 0034 economic ledger immutability ===\n');
const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client } = await assertScratchSchemaTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'gk276-0034-immutability-contract' });
const SCHEMA = `gk276_0034_${crypto.randomBytes(4).toString('hex')}`;
const id = () => crypto.randomUUID();
const sqlText = readFileSync(path.join(repoRoot, 'db', 'data0', '0034_economic_ledger_immutability.sql'), 'utf8').replace(/SET search_path TO data1_dev;/, `SET search_path TO ${SCHEMA};`);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  const cur = (await client.query('SELECT current_schema() s')).rows[0].s;
  if (cur !== SCHEMA) throw new Error('ABORT wrong schema ' + cur);
  for (const t of ['valuation_event', 'decision_event']) await client.query(`CREATE TABLE ${SCHEMA}.${t} (LIKE data1_dev.${t} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  const asset = id(), principal = id();
  const vid = id(), did = id();

  console.log('-- ORDERING GUARD: refuses before the backfill is complete --');
  await client.query(`ALTER TABLE ${SCHEMA}.valuation_event ALTER COLUMN provenance DROP NOT NULL`);
  await client.query(`INSERT INTO ${SCHEMA}.valuation_event (id, asset_id, value_amount, value_currency, method, build_sha, provenance, recorded_by_principal_id) VALUES ($1,$2,5,'USD','engine-computed','b',NULL,$3)`, [vid, asset, principal]);
  await client.query('BEGIN');
  let refusedUnclassified = false;
  try { await client.query(sqlText); } catch (e) { refusedUnclassified = /unclassified|incomplete/.test(e.message); }
  await client.query('ROLLBACK');
  ok(refusedUnclassified, '0034 refuses to install while any valuation row has NULL provenance');
  await client.query(`ALTER TABLE ${SCHEMA}.valuation_event DROP COLUMN provenance`);
  await client.query('BEGIN');
  let refusedNoCol = false;
  try { await client.query(sqlText); } catch (e) { refusedNoCol = /provenance does not exist/.test(e.message); }
  await client.query('ROLLBACK');
  ok(refusedNoCol, '0034 refuses to install when 0033 (provenance column) has not been applied');
  const trgPre = await client.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = '${SCHEMA}.valuation_event'::regclass AND NOT tgisinternal`);
  ok(trgPre.rows[0].n === 0, 'a refused install leaves no trigger behind');

  console.log('\n-- backfilled state -> install --');
  await client.query(`ALTER TABLE ${SCHEMA}.valuation_event ADD COLUMN provenance TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN'`);
  await client.query(sqlText);
  ok(true, '0034 installs once provenance exists and is fully populated');
  const trg = await client.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN ('${SCHEMA}.valuation_event'::regclass,'${SCHEMA}.decision_event'::regclass) AND NOT tgisinternal`);
  ok(trg.rows[0].n === 6, 'six triggers installed (UPDATE/DELETE/TRUNCATE x 2 tables)');

  await client.query('BEGIN');
  await client.query(`INSERT INTO ${SCHEMA}.decision_event (id, asset_id, recommendation, valuation_event_id) VALUES ($1,$2,'LIST_LOW',$3)`, [did, asset, vid]);
  ok(true, 'INSERT into valuation_event/decision_event still works');
  await rejected(client, `UPDATE ${SCHEMA}.valuation_event SET value_amount = 999 WHERE id = $1`, [vid], 'UPDATE valuation_event rejected', 'append-only');
  await rejected(client, `DELETE FROM ${SCHEMA}.valuation_event WHERE id = $1`, [vid], 'DELETE valuation_event rejected', 'append-only');
  await rejected(client, `UPDATE ${SCHEMA}.decision_event SET recommendation = 'LIST_NOW' WHERE id = $1`, [did], 'UPDATE decision_event rejected', 'append-only');
  await rejected(client, `DELETE FROM ${SCHEMA}.decision_event WHERE id = $1`, [did], 'DELETE decision_event rejected', 'append-only');
  await rejected(client, `TRUNCATE ${SCHEMA}.valuation_event`, [], 'TRUNCATE valuation_event rejected', 'append-only');
  await rejected(client, `TRUNCATE ${SCHEMA}.decision_event`, [], 'TRUNCATE decision_event rejected', 'append-only');
  await rejected(client, `UPDATE ${SCHEMA}.valuation_event SET provenance = 'SERVER_DERIVED' WHERE id = $1`, [vid], 'provenance can never be rewritten after the fact (UPDATE rejected)', 'append-only');
  const still = await client.query(`SELECT value_amount::text a FROM ${SCHEMA}.valuation_event WHERE id=$1`, [vid]);
  ok(still.rows[0].a === '5.00', 'the row is byte-unchanged after every rejected mutation');
  await client.query('COMMIT');
  const bypass = readFileSync(path.join(repoRoot, 'db', 'data0', '0034_economic_ledger_immutability.sql'), 'utf8').replace(/--.*$/gm, '');
  ok(!/current_setting|session_replication_role|app\.bypass|DISABLE TRIGGER/i.test(bypass), 'no bypass flag / session setting / escape hatch exists in the trigger function');
} catch (e) {
  failed++; failures.push('FATAL ' + e.message); console.log('  ✗ FATAL:', e.message);
  try { await client.query('ROLLBACK'); } catch (e2) { /* ignore */ }
}

console.log('\n-- (B) real data1_dev (only if 0034 is installed there; every attempt rolled back) --');
try {
  await client.query('SET search_path TO data1_dev');
  const live = await client.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN ('data1_dev.valuation_event'::regclass,'data1_dev.decision_event'::regclass) AND NOT tgisinternal`);
  if (live.rows[0].n === 6) {
    const cnt = async () => (await client.query('SELECT (SELECT count(*) FROM data1_dev.valuation_event)::int v, (SELECT count(*) FROM data1_dev.decision_event)::int d')).rows[0];
    const before = await cnt();
    for (const [l, sql] of [
      ['live UPDATE valuation_event', 'UPDATE data1_dev.valuation_event SET build_sha = build_sha WHERE id = (SELECT id FROM data1_dev.valuation_event LIMIT 1)'],
      ['live DELETE valuation_event', 'DELETE FROM data1_dev.valuation_event WHERE id = (SELECT id FROM data1_dev.valuation_event LIMIT 1)'],
      ['live UPDATE decision_event', 'UPDATE data1_dev.decision_event SET recommendation = recommendation WHERE id = (SELECT id FROM data1_dev.decision_event LIMIT 1)'],
      ['live DELETE decision_event', 'DELETE FROM data1_dev.decision_event WHERE id = (SELECT id FROM data1_dev.decision_event LIMIT 1)'],
    ]) { await client.query('BEGIN'); await rejected(client, sql, [], `${l} rejected`, 'append-only'); await client.query('ROLLBACK'); }
    const after = await cnt();
    ok(before.v === after.v && before.d === after.d, 'live row counts unchanged');
  } else console.log('  (0034 not installed in data1_dev yet -- live half skipped)');
} catch (e) { failed++; failures.push('FATAL live ' + e.message); console.log('  ✗ FATAL live:', e.message); }
finally {
  try { await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } catch (e) { console.log('cleanup error', e.message); }
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}
