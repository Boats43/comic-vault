// tests/gk278c-corpus-exclusion-and-truncate.test.js
//
// GK-278B --
//  PART 1: certification artifacts are EXCLUDED FROM THE ORGANIC PROJECTION, not deleted from
//          history (real Development DB, real registration script).
//  PART 2: the append-only TRUNCATE protection is enforced by the TRIGGER itself, not merely by an
//          incidental foreign key (disposable scratch schemas, GK-223 guard pattern).
//
// Part 1 leaves append-only rows in Development by design (Development is NOT a clean organic corpus).
//
// Invoke: node tests/gk278c-corpus-exclusion-and-truncate.test.js

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

console.log('\n=== GK-278B -- corpus exclusion projection + direct TRUNCATE trigger proof ===\n');

const learning = await import('../src/modules/learning/index.js');
const collection = await import('../src/modules/collection/index.js');
const TAG = `gk278c-${Date.now()}`;
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query('SET search_path TO data1_dev');

try {
  console.log('-- PART 1: exclusion is a projection, not a deletion --\n');
  const P = randomUUID();
  await db.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [P, TAG]);
  const ITEM = `${TAG}-cert-item`;
  await db.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic','{"title":"cert"}')`, [ITEM, P]);
  // mirror the Production certification shape: ONE inference -> 3 prediction events, then ONE correction linking to the GRADE one
  const rid = randomUUID();
  const mk = (surface) => learning.recordModelPrediction({ principalId: P, surface, resultId: rid, prediction: { s: surface }, provider: 'anthropic', model: 'm' });
  const g = await mk('GRADE'); const c = await mk('CONDITION'); const i = await mk('IDENTITY');
  await db.query(`UPDATE collection_item SET attributes = attributes || $3::jsonb WHERE principal_id=$1 AND id=$2`, [P, ITEM, JSON.stringify({ modelPredictedProvenance: { predictionEventId: g.eventId } })]);
  const patch = await collection.applyGradingAuthorityPatch({ principalId: P, id: ITEM, patch: { operatorGrade: 'VF 8.0', operatorGradeNumeric: 8, operatorGradeSetAt: Date.now(), gradeAuthority: 'OPERATOR_CONFIRMED' }, correction: { source: 'cert' } });
  const corrId = patch.correctionEventIds[0];
  // an ORGANIC event from another inference
  const organic = await learning.recordModelPrediction({ principalId: P, surface: 'GRADE', resultId: randomUUID(), prediction: { organic: true }, provider: 'anthropic', model: 'm' });
  const four = [g.eventId, c.eventId, i.eventId, corrId];

  const rawBefore = (await db.query('SELECT (SELECT count(*) FROM model_prediction_event WHERE principal_id=$1)::int p, (SELECT count(*) FROM operator_correction_event WHERE principal_id=$1)::int c', [P])).rows[0];
  eq(rawBefore, { p: 4, c: 1 }, 'setup: raw history holds 3+1 certification-shaped events plus 1 organic prediction');
  const orgBefore = (await db.query('SELECT (SELECT count(*) FROM organic_model_prediction_event WHERE principal_id=$1)::int p, (SELECT count(*) FROM organic_operator_correction_event WHERE principal_id=$1)::int c', [P])).rows[0];
  eq(orgBefore, { p: 4, c: 1 }, 'before registration the organic projection (correctly) contains everything: nothing is excluded by inference');

  const run = (extra) => spawnSync(process.execPath, ['scripts/register-corpus-exclusion.mjs', 'development', '--ticket', 'GK-278', '--reason', 'PRODUCTION CERTIFICATION ARTIFACT -- NOT ORGANIC USER DATA', '--date', '2026-10-02', '--item', ITEM, ...extra], { cwd: repoRoot, encoding: 'utf8' });
  const dry = run([]);
  ok(/DRY RUN/.test(dry.stdout) && /4 event/.test(dry.stdout), 'registration script lists exactly the 4 events by default (dry run)');
  eq((await db.query('SELECT count(*)::int n FROM learning_corpus_exclusion WHERE source_collection_item_id=$1', [ITEM])).rows[0].n, 0, 'the dry run registered nothing');
  const real = run(['--apply']);
  ok(/registered 4 new exclusion row/.test(real.stdout), 'registration with --apply registered the 4 rows');
  const again = run(['--apply']);
  ok(/registered 0 new exclusion row/.test(again.stdout), 're-registration is idempotent (no duplicates)');

  const rawAfter = (await db.query('SELECT (SELECT count(*) FROM model_prediction_event WHERE principal_id=$1)::int p, (SELECT count(*) FROM operator_correction_event WHERE principal_id=$1)::int c', [P])).rows[0];
  eq(rawAfter, rawBefore, 'RAW immutable history still contains ALL events (exclusion deleted nothing)');
  const rawIds = new Set([...(await db.query('SELECT id FROM model_prediction_event WHERE principal_id=$1', [P])).rows, ...(await db.query('SELECT id FROM operator_correction_event WHERE principal_id=$1', [P])).rows].map((r) => r.id));
  ok(four.every((x) => rawIds.has(x)), 'raw history contains all four registered events');
  const orgIds = new Set([...(await db.query('SELECT id FROM organic_model_prediction_event WHERE principal_id=$1', [P])).rows, ...(await db.query('SELECT id FROM organic_operator_correction_event WHERE principal_id=$1', [P])).rows].map((r) => r.id));
  ok(four.every((x) => !orgIds.has(x)), 'ORGANIC projection contains NONE of the four');
  ok(orgIds.has(organic.eventId) && orgIds.size === 1, 'the unregistered organic event remains in the organic projection (exclusion is explicit, not inferred)');
  ok(/append-only/.test((await rejects(() => db.query(`UPDATE learning_corpus_exclusion SET reason='x' WHERE source_collection_item_id=$1`, [ITEM])))?.message || ''), 'the exclusion registry itself is append-only (UPDATE rejected)');
  ok(/append-only/.test((await rejects(() => db.query(`DELETE FROM learning_corpus_exclusion WHERE source_collection_item_id=$1`, [ITEM])))?.message || ''), 'the exclusion registry itself is append-only (DELETE rejected)');
  ok(!!(await rejects(() => db.query(`INSERT INTO learning_corpus_exclusion (event_table,event_id,reason_code,reason,ticket) VALUES ('decision_event',$1,'CERTIFICATION_ARTIFACT','x','GK')`, [randomUUID()]))), 'only the two learning event tables can be registered');
  ok(!!(await rejects(() => db.query(`INSERT INTO learning_corpus_exclusion (event_table,event_id,reason_code,reason,ticket) VALUES ('model_prediction_event',$1,'GUESSED','x','GK')`, [randomUUID()]))), 'reason_code is a closed vocabulary (no free-form guessed exclusion)');

  console.log('\n-- PART 2: TRUNCATE protection enforced by the trigger itself (scratch schemas) --\n');
  const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
  const { client: sc } = await assertScratchSchemaTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'GK-278B scratch TRUNCATE proof' });
  const migration = readFileSync(path.join(repoRoot, 'db', 'data0', '0035_learning_spine.sql'), 'utf8');
  const build = async (suffix) => {
    const schema = `gk278c_${suffix}_${Date.now()}`;
    await sc.query(`CREATE SCHEMA ${schema}`);
    await sc.query(`SET search_path TO ${schema}`);
    await sc.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY); CREATE TABLE gk_asset (id UUID PRIMARY KEY);
      CREATE TABLE collection_item (id TEXT NOT NULL, principal_id UUID NOT NULL REFERENCES gk_principal(id), attributes JSONB, PRIMARY KEY (principal_id,id));
      CREATE TABLE collection_item_link (collection_item_id TEXT PRIMARY KEY, gk_asset_id UUID NOT NULL REFERENCES gk_asset(id));
      CREATE TABLE decision_event (id UUID PRIMARY KEY DEFAULT uuidv7());`);
    await sc.query(migration.split('data1_dev').join(schema));
    await sc.query(`SET search_path TO ${schema}`);
    return schema;
  };
  const schemas = [];
  try {
    // A. prediction table with ZERO correction references (the correction table, and with it the FK, is absent)
    const sA = await build('a'); schemas.push(sA);
    await sc.query(`DROP TABLE operator_correction_event`);
    const pa = randomUUID();
    await sc.query(`INSERT INTO gk_principal VALUES ($1)`, [pa]);
    await sc.query(`INSERT INTO model_prediction_event (principal_id,surface,result_id,prediction,payload_hash,idempotency_key) VALUES ($1,'GRADE',$2,'{}','h','k1')`, [pa, randomUUID()]);
    const fkRefs = (await sc.query(`SELECT count(*)::int n FROM pg_constraint WHERE confrelid = 'model_prediction_event'::regclass AND contype='f'`)).rows[0].n;
    eq(fkRefs, 0, 'A setup: NO foreign key references model_prediction_event');
    const eA = await rejects(() => sc.query('TRUNCATE model_prediction_event'));
    ok(eA && /append-only/.test(eA.message) && !/foreign key/.test(eA.message), `A: TRUNCATE refused by the TRIGGER itself (${eA?.message})`);
    eq((await sc.query('SELECT count(*)::int n FROM model_prediction_event')).rows[0].n, 1, 'A: the row survived');

    // B. predictions + corrections present; CASCADE
    const sB = await build('b'); schemas.push(sB);
    const pb = randomUUID();
    await sc.query(`INSERT INTO gk_principal VALUES ($1)`, [pb]);
    await sc.query(`INSERT INTO collection_item (id, principal_id, attributes) VALUES ('ci1',$1,'{}')`, [pb]);
    const pe = (await sc.query(`INSERT INTO model_prediction_event (principal_id,surface,result_id,prediction,payload_hash,idempotency_key) VALUES ($1,'GRADE',$2,'{}','h','k2') RETURNING id`, [pb, randomUUID()])).rows[0].id;
    await sc.query(`INSERT INTO operator_correction_event (principal_id,collection_item_id,surface,action,before_value,after_value,authority_before,authority_after,related_prediction_event_id,idempotency_key) VALUES ($1,'ci1','GRADE','SET','{}','{}','{}','{}',$2,'kc')`, [pb, pe]);
    const eBplain = await rejects(() => sc.query('TRUNCATE model_prediction_event'));
    ok(!!eBplain, `B0: plain TRUNCATE refused (${eBplain?.message}) -- this refusal is the incidental FK`);
    const eB = await rejects(() => sc.query('TRUNCATE model_prediction_event CASCADE'));
    ok(eB && /append-only/.test(eB.message), `B: TRUNCATE ... CASCADE refused by the append-only TRIGGER, not by FK semantics (${eB?.message})`);
    eq([(await sc.query('SELECT count(*)::int n FROM model_prediction_event')).rows[0].n, (await sc.query('SELECT count(*)::int n FROM operator_correction_event')).rows[0].n], [1, 1], 'B: neither table lost a row');

    // C. correction table
    const eC = await rejects(() => sc.query('TRUNCATE operator_correction_event'));
    ok(eC && /append-only/.test(eC.message), `C: TRUNCATE operator_correction_event refused by its trigger (${eC?.message})`);
    const eC2 = await rejects(() => sc.query('TRUNCATE operator_correction_event CASCADE'));
    ok(eC2 && /append-only/.test(eC2.message), 'C: ... CASCADE refused too');
  } finally {
    for (const s of schemas) await sc.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await sc.query('RESET search_path');
    await sc.end();
  }
  const left = (await db.query(`SELECT count(*)::int n FROM pg_namespace WHERE nspname LIKE 'gk278c_%'`)).rows[0].n;
  eq(left, 0, 'no scratch schema left behind');
} finally {
  await db.end();
  await collection.closePool();
  await learning.closePool();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
}
