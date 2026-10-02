// tests/gk276-0033-provenance-migration-contract.test.js
//
// GK-276 -- real, isolated scratch-schema proof of
// db/data0/0033_valuation_event_provenance.sql (add column -> deterministic
// backfill -> CHECK + NOT NULL). data1_dev is only READ (structure clone via
// LIKE); nothing in it is ever written.
//
// Proves: classification is deterministic from durable evidence only;
// provenance outranks the legacy method string; unknown stays unknown;
// the backfill is re-runnable; CHECK/NOT NULL are enforced afterwards.
//
// Invoke: node tests/gk276-0033-provenance-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`  ✗ ${label}`); console.log(`  ✗ ${label}`); }
};
const rejects = async (fn, label) => {
  try { await fn(); failed++; failures.push(`  ✗ ${label} (did NOT reject)`); console.log(`  ✗ ${label} (did NOT reject)`); }
  catch (e) { passed++; console.log(`  ✓ ${label} (rejected: ${String(e.message).slice(0, 90)})`); }
};

console.log('\n=== GK-276 -- 0033 valuation_event.provenance migration contract (scratch schema) ===\n');

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client } = await assertScratchSchemaTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'gk276-0033-provenance-migration-contract',
});

const SCHEMA = `gk276_0033_${crypto.randomBytes(4).toString('hex')}`;
const id = () => crypto.randomUUID();

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  const cur = (await client.query('SELECT current_schema() AS s')).rows[0].s;
  if (cur !== SCHEMA || cur === 'data1_dev') throw new Error(`ABORT -- search_path is ${cur}, expected ${SCHEMA}`);

  // Structurally faithful pre-0033 copies of the two real tables.
  await client.query(`CREATE TABLE ${SCHEMA}.valuation_event (LIKE data1_dev.valuation_event INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  await client.query(`ALTER TABLE ${SCHEMA}.valuation_event DROP COLUMN IF EXISTS provenance`);
  await client.query(`CREATE TABLE ${SCHEMA}.idempotency_key (LIKE data1_dev.idempotency_key INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  // drop FKs/checks that reference other tables are not copied by LIKE; nothing else to do.

  const principal = id();
  const asset = id();
  const insVal = async (method, buildSha = 'b') => {
    const vid = id();
    await client.query(
      `INSERT INTO ${SCHEMA}.valuation_event (id, asset_id, value_amount, value_currency, method, build_sha, recorded_by_principal_id)
       VALUES ($1,$2,$3,'USD',$4,$5,$6)`, [vid, asset, 10, method, buildSha, principal]);
    return vid;
  };
  const insKey = async (vid, key) => {
    await client.query(
      `INSERT INTO ${SCHEMA}.idempotency_key (id, operation, idempotency_key, principal_id, result_snapshot, request_fingerprint)
       VALUES ($4, 'recordValuation', $1, $2, $3::jsonb, 'fp')`, [key, principal, JSON.stringify({ valuationEventId: vid }), id()]);
  };

  // legacy-shaped fixtures
  const captureRow = await insVal('engine-computed', 'unknown');   // capture writer: client price labelled engine-computed
  await insKey(captureRow, `${id()}:valuation`);
  const gk226Row = await insVal('engine-computed', 'GK-226-manual-valuation-correction-2026-09-20');
  await insKey(gk226Row, 'gk226-oml25-valuation-correction-2026-09-20');
  const overrideMethodRow = await insVal('operator-override');
  const lookalikeRow = await insVal('engine-computed', 'plausible-looking-build');   // old, "reasonable" number, no provable origin
  const keylessRow = await insVal('engine-computed');                                 // no idempotency key at all
  const testKeyRow = await insVal('engine-computed');
  await insKey(testKeyRow, 'reconciler-test-valuation-xyz');                          // fixture key: origin not deterministic

  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0033_valuation_event_provenance.sql'), 'utf8')
    .replace(/SET search_path TO data1_dev;/, `SET search_path TO ${SCHEMA};`);
  ok(!/data1_dev/.test(sql.replace(/--.*$/gm, '')), 'migration text contains no hard data1_dev reference outside the search_path line');

  console.log('\n-- STEP A/B: add column + deterministic backfill --\n');
  await client.query(sql);
  const prov = async (vid) => (await client.query(`SELECT provenance FROM ${SCHEMA}.valuation_event WHERE id=$1`, [vid])).rows[0].provenance;
  ok(await prov(captureRow) === 'CLIENT_ASSERTED', 'capture-writer row (<uuid>:valuation key) -> CLIENT_ASSERTED');
  ok(await prov(gk226Row) === 'OPERATOR_OVERRIDE', 'the known GK-226 manual-correction row -> OPERATOR_OVERRIDE');
  ok(await prov(overrideMethodRow) === 'OPERATOR_OVERRIDE', "method='operator-override' row -> OPERATOR_OVERRIDE");
  ok(await prov(lookalikeRow) === 'LEGACY_UNKNOWN', "engine-computed row with no provable origin stays LEGACY_UNKNOWN (never promoted to SERVER_DERIVED)");
  ok(await prov(keylessRow) === 'LEGACY_UNKNOWN', 'row with no idempotency key stays LEGACY_UNKNOWN');
  ok(await prov(testKeyRow) === 'LEGACY_UNKNOWN', 'fixture/test-keyed row stays LEGACY_UNKNOWN (origin not deterministic)');
  const any = await client.query(`SELECT count(*)::int n FROM ${SCHEMA}.valuation_event WHERE provenance = 'SERVER_DERIVED'`);
  ok(any.rows[0].n === 0, 'NO historical row was classified SERVER_DERIVED');

  console.log('\n-- PROVENANCE OUTRANKS LEGACY method; no destructive method rewrite --\n');
  const m = await client.query(`SELECT method FROM ${SCHEMA}.valuation_event WHERE id=$1`, [captureRow]);
  ok(m.rows[0].method === 'engine-computed' && await prov(captureRow) === 'CLIENT_ASSERTED', "method string left untouched ('engine-computed') while provenance says CLIENT_ASSERTED");

  console.log('\n-- constraints enforced afterwards --\n');
  await rejects(() => client.query(`INSERT INTO ${SCHEMA}.valuation_event (id, asset_id, value_amount, value_currency, method, build_sha, recorded_by_principal_id) VALUES ($1,$2,1,'USD','engine-computed','b',$3)`, [id(), asset, principal]), 'INSERT without provenance is rejected (NOT NULL, no default)');
  await rejects(() => client.query(`INSERT INTO ${SCHEMA}.valuation_event (id, asset_id, value_amount, value_currency, method, build_sha, provenance, recorded_by_principal_id) VALUES ($1,$2,1,'USD','engine-computed','b','TRUSTED_BY_ME',$3)`, [id(), asset, principal]), 'INSERT with an out-of-vocabulary provenance is rejected (CHECK)');
  await client.query(`INSERT INTO ${SCHEMA}.valuation_event (id, asset_id, value_amount, value_currency, method, build_sha, provenance, recorded_by_principal_id) VALUES ($1,$2,1,'USD','engine-computed','b','SERVER_DERIVED',$3)`, [id(), asset, principal]);
  ok(true, 'INSERT with SERVER_DERIVED works');

  console.log('\n-- re-runnable (idempotent) --\n');
  const before = (await client.query(`SELECT id, provenance FROM ${SCHEMA}.valuation_event ORDER BY id`)).rows;
  await client.query(sql);
  const after = (await client.query(`SELECT id, provenance FROM ${SCHEMA}.valuation_event ORDER BY id`)).rows;
  ok(JSON.stringify(before) === JSON.stringify(after), 're-running 0033 changes no row');

  console.log('\n-- ordering law: this migration contains NO trigger; backfill precedes immutability --\n');
  ok(!/CREATE\s+TRIGGER/i.test(sql), '0033 installs no trigger (0034 must follow, never precede)');
} catch (e) {
  failed++; failures.push(`  ✗ FATAL: ${e.message}`); console.log('  ✗ FATAL:', e.message);
} finally {
  try { await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } catch (e) { console.log('cleanup error', e.message); }
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed) { failures.forEach((f) => console.log(f)); process.exit(1); }
  process.exit(0);
}
