// tests/u1-0039-migration-contract.test.js
//
// UNIVERSAL U1 -- real, isolated scratch-schema proof of
// db/data0/0039_u1_remove_silent_comic_defaults.sql and its rollback.
// Clones the REAL data1_dev.gk_asset and data1_dev.collection_item tables
// (LIKE ... INCLUDING ALL) into a scratch schema and proves:
//   * BEFORE: an omitted category silently becomes 'comic' (the defect);
//   * AFTER: an omitted category is a loud NOT NULL violation; only
//     comic|book|generic insert; anything else is a CHECK violation;
//   * HISTORICAL ROWS ARE NEVER REWRITTEN (a legacy 'd4-proof' row survives
//     byte-identical; the CHECKs are NOT VALID);
//   * re-runnable; rollback restores the defaults and drops the checks.
// data1_dev is never touched (same backend-PID + current_schema() guard as
// the other scratch proofs).
//
// Invoke: node tests/u1-0039-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};
const rejectsWith = async (fn, code, label) => {
  try { await fn(); ok(false, `${label} (did NOT reject)`); }
  catch (e) { ok(e.code === code, `${label} (rejected ${e.code}${e.code === code ? '' : ', wanted ' + code}: ${String(e.message).slice(0, 80)})`); }
};
const succeeds = async (fn, label) => {
  try { await fn(); ok(true, label); } catch (e) { ok(false, `${label} (unexpectedly rejected: ${e.message})`); }
};

console.log('\n=== UNIVERSAL U1 -- 0039 remove silent comic defaults (real, isolated scratch-schema proof) ===\n');

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client, sessionPid } = await assertScratchSchemaTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'u1-0039-migration-contract',
});

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

const SCHEMA = `u1_0039_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
// Pooler-safe (GK-178): the Neon pooler does not preserve session search_path between statements,
// so the migration text is rewritten to schema-qualify every table reference explicitly.
const qualify = (raw) => raw
  .replace(/SET search_path TO data1_dev;/g, '')
  .replace(/ALTER TABLE (gk_asset|collection_item)/g, `ALTER TABLE ${SCHEMA}.$1`)
  .replace(/conrelid = '(gk_asset|collection_item)'::regclass/g, `conrelid = '${SCHEMA}.$1'::regclass`);

const newAsset = (cls) => client.query(
  cls === undefined
    ? `INSERT INTO ${SCHEMA}.gk_asset (id, mint_basis_id) VALUES ($1, $2) RETURNING asset_class`
    : `INSERT INTO ${SCHEMA}.gk_asset (id, mint_basis_id, asset_class) VALUES ($1, $2, $3) RETURNING asset_class`,
  cls === undefined ? [crypto.randomUUID(), crypto.randomUUID()] : [crypto.randomUUID(), crypto.randomUUID(), cls]
);
const newItem = (cat) => client.query(
  cat === undefined
    ? `INSERT INTO ${SCHEMA}.collection_item (id, principal_id, attributes) VALUES ($1, $2, '{}') RETURNING asset_category`
    : `INSERT INTO ${SCHEMA}.collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, $3, '{}') RETURNING asset_category`,
  cat === undefined ? [crypto.randomUUID(), crypto.randomUUID()] : [crypto.randomUUID(), crypto.randomUUID(), cat]
);
const defaults = async () => (await client.query(
  `SELECT table_name, column_default FROM information_schema.columns WHERE table_schema = $1 AND ((table_name='gk_asset' AND column_name='asset_class') OR (table_name='collection_item' AND column_name='asset_category')) ORDER BY 1`,
  [SCHEMA])).rows;

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');
  await client.query(`CREATE TABLE ${SCHEMA}.gk_asset (LIKE data1_dev.gk_asset INCLUDING ALL)`);
  await client.query(`CREATE TABLE ${SCHEMA}.collection_item (LIKE data1_dev.collection_item INCLUDING ALL)`);
  // The real tables may ALREADY be migrated (Development is), so reconstruct the PRE-migration state
  // explicitly: restore the historical DEFAULT 'comic' and drop any copied supported-category CHECK.
  await client.query(`ALTER TABLE ${SCHEMA}.gk_asset DROP CONSTRAINT IF EXISTS gk_asset_asset_class_supported_check`);
  await client.query(`ALTER TABLE ${SCHEMA}.collection_item DROP CONSTRAINT IF EXISTS collection_item_asset_category_supported_check`);
  await client.query(`ALTER TABLE ${SCHEMA}.gk_asset ALTER COLUMN asset_class SET DEFAULT 'comic'`);
  await client.query(`ALTER TABLE ${SCHEMA}.collection_item ALTER COLUMN asset_category SET DEFAULT 'comic'`);
  console.log('1. BEFORE the migration (the defect, reproduced)');
  const d0 = await defaults();
  ok(d0.every((r) => /'comic'/.test(r.column_default || '')), "both columns carry the silent DEFAULT 'comic'");
  ok((await newAsset(undefined)).rows[0].asset_class === 'comic', 'an omitted asset_class SILENTLY becomes comic (the exposure)');
  ok((await newItem(undefined)).rows[0].asset_category === 'comic', 'an omitted asset_category SILENTLY becomes comic (the exposure)');
  // historical, unsupported rows that must survive untouched
  const legacyId = crypto.randomUUID();
  await client.query(`INSERT INTO ${SCHEMA}.gk_asset (id, mint_basis_id, asset_class) VALUES ($1, $2, 'd4-proof')`, [legacyId, crypto.randomUUID()]);
  const legacyBefore = (await client.query(`SELECT * FROM ${SCHEMA}.gk_asset WHERE id = $1`, [legacyId])).rows[0];
  const histCounts = (await client.query(`SELECT (SELECT COUNT(*)::int FROM ${SCHEMA}.gk_asset) AS a, (SELECT COUNT(*)::int FROM ${SCHEMA}.collection_item) AS c`)).rows[0];

  console.log('\n2. apply 0039');
  await succeeds(() => client.query(qualify(read('0039_u1_remove_silent_comic_defaults.sql'))), '0039 applies cleanly');
  await succeeds(() => client.query(qualify(read('0039_u1_remove_silent_comic_defaults.sql'))), '0039 is re-runnable (idempotent)');
  const d1 = await defaults();
  ok(d1.every((r) => r.column_default === null), 'BOTH defaults are gone');
  const cons = (await client.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('gk_asset_asset_class_supported_check','collection_item_asset_category_supported_check') AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1) ORDER BY 1`, [SCHEMA])).rows;
  ok(cons.length === 2 && cons.every((r) => r.convalidated === false), 'both supported-category CHECKs exist and are NOT VALID (history not validated or rewritten)');

  console.log('\n3. AFTER: omission is loud, only comic|book|generic are writable');
  await rejectsWith(() => newAsset(undefined), '23502', 'an omitted asset_class is a NOT NULL violation (no silent comic)');
  await rejectsWith(() => newItem(undefined), '23502', 'an omitted asset_category is a NOT NULL violation (no silent comic)');
  for (const c of ['comic', 'book', 'generic']) {
    await succeeds(() => newAsset(c), `asset_class '${c}' inserts`);
    await succeeds(() => newItem(c), `asset_category '${c}' inserts`);
  }
  await rejectsWith(() => newAsset('toaster'), '23514', "asset_class 'toaster' (unsupported) is refused by the CHECK");
  await rejectsWith(() => newItem('merchandise'), '23514', "asset_category 'merchandise' (unsupported) is refused by the CHECK");
  await rejectsWith(() => newAsset(''), '23514', 'an empty asset_class is refused');
  await rejectsWith(() => newItem('COMIC'), '23514', "case variants are not the vocabulary ('COMIC' refused)");

  console.log('\n4. HISTORY IS NEVER REWRITTEN');
  const legacyAfter = (await client.query(`SELECT * FROM ${SCHEMA}.gk_asset WHERE id = $1`, [legacyId])).rows[0];
  ok(JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore), "the legacy 'd4-proof' row is byte-identical after the migration");
  const histAfter = (await client.query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.gk_asset WHERE asset_class IN ('d4-proof') OR asset_class IS NULL`)).rows[0].n;
  ok(histAfter === 1, 'no historical row was reclassified (still exactly one non-supported row)');
  ok(histCounts.a >= 2 && histCounts.c >= 1, 'pre-migration fixture counts were non-trivial (sanity)');

  console.log('\n5. ROLLBACK restores the previous behavior exactly');
  await succeeds(() => client.query(qualify(read('0039_u1_remove_silent_comic_defaults_rollback.sql'))), 'rollback applies cleanly');
  const d2 = await defaults();
  ok(d2.every((r) => /'comic'/.test(r.column_default || '')), "rollback restores DEFAULT 'comic' on both columns");
  ok((await client.query(`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname IN ('gk_asset_asset_class_supported_check','collection_item_asset_category_supported_check') AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)`, [SCHEMA])).rows[0].n === 0, 'rollback drops both CHECKs');
  ok((await client.query(`SELECT * FROM ${SCHEMA}.gk_asset WHERE id = $1`, [legacyId])).rows[0].asset_class === 'd4-proof', 'rollback also leaves history untouched');
  await succeeds(() => client.query(qualify(read('0039_u1_remove_silent_comic_defaults.sql'))), 'forward re-apply after rollback works');
} finally {
  try { await client.query('SET search_path TO public'); await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } catch { /* best effort */ }
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
