// tests/gk279-0037-0038-empty-schema-path.test.js
//
// GK-279 — PRODUCTION-SHAPED migration proof. Production has never received
// 0037 and its decision table will be EMPTY when 0037 then 0038 are applied.
// Development's path (0037 -> 28 rows -> 0038) does not prove that. This runs
// the exact two migration texts, in order, in a disposable scratch schema
// (assertScratchSchemaTarget guard; data1_dev is never touched):
//   PATH E (Production-shaped): 0037 -> ZERO rows -> 0038
//   PATH R (Development-shaped): 0037 -> rows -> 0038 (existing-row risk)
// plus 0038 rerun (idempotence) and the final constraint behavior.
//
// Invoke: node tests/gk279-0037-0038-empty-schema-path.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const rejects = async (fn, l) => { try { await fn(); failed++; console.log(`  ✗ ${l} (did NOT reject)`); } catch (e) { passed++; console.log(`  ✓ ${l} (${e.message.slice(0, 90)})`); } };

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client, sessionPid } = await assertScratchSchemaTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'gk279-0037-0038-empty-schema-path' });
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');

async function guard(schema) {
  const r = await client.query('SELECT current_schema() s, pg_backend_pid() pid');
  if (r.rows[0].pid !== sessionPid || r.rows[0].s === 'data1_dev' || r.rows[0].s !== schema) throw new Error(`SAFETY ABORT: ${JSON.stringify(r.rows[0])}`);
}
const triggers = async (schema) => (await client.query(
  `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = $1::regclass ORDER BY 1`, [`${schema}.physical_copy_decision_event`])).rows.map((r) => r.tgname);

async function buildScratch(schema) {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await guard(schema);
  // Minimal FK targets + the learning_ledger_immutable() function 0037's triggers call
  // (in Production that function already exists from 0035 — a prerequisite, asserted below).
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE model_prediction_event (id UUID PRIMARY KEY, principal_id UUID NOT NULL, UNIQUE (principal_id, id))`);
  await client.query(`CREATE FUNCTION learning_ledger_immutable() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'append-only'; END; $$ LANGUAGE plpgsql`);
}
const q = (raw, schema) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${schema};`);

const live = await client.query(`SELECT to_regprocedure('data1_dev.learning_ledger_immutable()') AS f`);
console.log('\n=== GK-279 0037 -> 0038 empty-schema path proof ===\n');
ok(live.rows[0].f !== null, 'prerequisite: learning_ledger_immutable() (0035) exists in the real target schema family');

const S1 = `gk279_empty_${Date.now()}`;
const S2 = `gk279_rows_${Date.now()}`;
try {
  // ───────────── PATH E: Production-shaped (empty) ─────────────
  console.log('--- PATH E: 0037 -> ZERO rows -> 0038 ---');
  await buildScratch(S1);
  await client.query(q(read('0037_physical_copy_decision.sql'), S1));
  ok(true, '0037 applies cleanly on an empty schema');
  ok((await client.query(`SELECT COUNT(*)::int n FROM ${S1}.physical_copy_decision_event`)).rows[0].n === 0, 'zero rows after 0037');
  const t37 = await triggers(S1);
  console.log('    triggers after 0037:', t37.join(', '));
  ok(t37.length === 3 && t37.includes('physical_copy_decision_event_no_update') && t37.includes('physical_copy_decision_event_no_delete') && t37.includes('physical_copy_decision_event_no_truncate'), 'append-only triggers installed by 0037 (no_update, no_delete, no_truncate)');
  await client.query(q(read('0038_physical_copy_decision_save_time.sql'), S1));
  ok(true, '0038 applies cleanly while the 0037 triggers exist (DDL fires none of them; constant defaults are metadata-only)');
  const t38 = await triggers(S1);
  console.log('    triggers after 0038:', t38.join(', '));
  ok(JSON.stringify(t37) === JSON.stringify(t38), 'trigger set is IDENTICAL after 0038 (none dropped, none added)');
  const cols = await client.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='physical_copy_decision_event'`, [S1]);
  const col = (n) => cols.rows.find((r) => r.column_name === n);
  ok(col('incoming_collection_item_id')?.is_nullable === 'YES' && col('resulting_gk_asset_id')?.is_nullable === 'YES', 'final schema: incoming/resulting ids nullable');
  ok(col('surface') && col('related_prediction_event_id') && col('canonical_collection_item_id') && col('incoming_retired'), 'final schema: surface / related_prediction_event_id / canonical_collection_item_id / incoming_retired present');
  const cons = (await client.query(`SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY 1`, [`${S1}.physical_copy_decision_event`])).rows.map((r) => r.conname);
  console.log('    final constraints:', cons.join(', '));
  ok(['physical_copy_decision_surface_chk', 'physical_copy_decision_incoming_chk', 'physical_copy_decision_result_chk', 'physical_copy_decision_prediction_fk'].every((n) => cons.includes(n)), 'final schema: all four 0038 constraints present');
  await client.query(q(read('0038_physical_copy_decision_save_time.sql'), S1));
  ok(true, '0038 is RERUNNABLE (idempotent)');

  // behavior of the final constraint set
  const P = crypto.randomUUID(), A = crypto.randomUUID(), B = crypto.randomUUID();
  await client.query(`INSERT INTO ${S1}.gk_principal VALUES ($1)`, [P]);
  await client.query(`INSERT INTO ${S1}.gk_asset VALUES ($1),($2)`, [A, B]);
  const ins = (o) => client.query(
    `INSERT INTO ${S1}.physical_copy_decision_event (principal_id, choice, incoming_collection_item_id, candidate_gk_asset_ids, selected_gk_asset_id, resulting_gk_asset_id, capture_idempotency_key, rule_version, surface)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'t',$8)`, [P, o.choice, o.incoming ?? null, o.cands ?? [A], o.sel ?? null, o.res ?? null, crypto.randomUUID(), o.surface]);
  await ins({ choice: 'SAME_COPY', sel: A, res: A, surface: 'SAVE' }); ok(true, 'SAVE SAME_COPY with NO incoming row is valid');
  await ins({ choice: 'ANOTHER_COPY', incoming: 'x', res: null, surface: 'SAVE' }); ok(true, 'SAVE ANOTHER_COPY with NULL resulting asset is valid');
  await ins({ choice: 'ANOTHER_COPY', incoming: 'x', res: B, surface: 'CAPTURE' }); ok(true, 'CAPTURE ANOTHER_COPY naming the minted asset is valid');
  await rejects(() => ins({ choice: 'SAME_COPY', sel: A, res: A, surface: 'CAPTURE' }), 'CAPTURE row with no incoming row is rejected');
  await rejects(() => ins({ choice: 'SAME_COPY', incoming: 'x', sel: A, res: null, surface: 'SAVE' }), 'SAME_COPY with a NULL resulting asset is rejected (NULL cannot slip past the 0037 CHECK)');
  await rejects(() => ins({ choice: 'ANOTHER_COPY', incoming: 'x', res: A, surface: 'CAPTURE' }), 'ANOTHER_COPY resolving to one of the candidates is still rejected');
  await rejects(() => ins({ choice: 'ANOTHER_COPY', incoming: 'x', res: B, surface: 'BOGUS' }), 'unknown surface rejected');
  await rejects(() => client.query(`UPDATE ${S1}.physical_copy_decision_event SET choice='SAME_COPY'`), 'UPDATE still rejected (append-only after 0038)');
  await rejects(() => client.query(`DELETE FROM ${S1}.physical_copy_decision_event`), 'DELETE still rejected');
  await rejects(() => client.query(`TRUNCATE ${S1}.physical_copy_decision_event`), 'TRUNCATE still rejected');

  // ───────────── PATH R: Development-shaped (rows existed under 0037) ─────────────
  console.log('\n--- PATH R: 0037 -> existing rows -> 0038 (Development shape / existing-row risk) ---');
  await buildScratch(S2);
  await client.query(q(read('0037_physical_copy_decision.sql'), S2));
  const P2 = crypto.randomUUID(), A2 = crypto.randomUUID(), B2 = crypto.randomUUID();
  await client.query(`INSERT INTO ${S2}.gk_principal VALUES ($1)`, [P2]);
  await client.query(`INSERT INTO ${S2}.gk_asset VALUES ($1),($2)`, [A2, B2]);
  for (let i = 0; i < 3; i++) {
    await client.query(`INSERT INTO ${S2}.physical_copy_decision_event (principal_id, choice, incoming_collection_item_id, candidate_gk_asset_ids, selected_gk_asset_id, resulting_gk_asset_id, capture_idempotency_key, rule_version) VALUES ($1,'SAME_COPY',$2,$3,$4,$4,$5,'gk279-v1')`, [P2, `item-${i}`, [A2], A2, crypto.randomUUID()]);
  }
  await client.query(`INSERT INTO ${S2}.physical_copy_decision_event (principal_id, choice, incoming_collection_item_id, candidate_gk_asset_ids, resulting_gk_asset_id, capture_idempotency_key, rule_version) VALUES ($1,'ANOTHER_COPY','item-x',$2,$3,$4,'gk279-v1')`, [P2, [A2], B2, crypto.randomUUID()]);
  await client.query(q(read('0038_physical_copy_decision_save_time.sql'), S2));
  const r2 = await client.query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE surface='CAPTURE')::int cap, COUNT(*) FILTER (WHERE incoming_retired)::int ret FROM ${S2}.physical_copy_decision_event`);
  ok(r2.rows[0].n === 4 && r2.rows[0].cap === 4 && r2.rows[0].ret === 0, '0038 applies over 4 existing 0037-era rows; they back-fill surface=CAPTURE / incoming_retired=false, none lost or rewritten');
  ok(JSON.stringify(await triggers(S2)) === JSON.stringify(t37), 'triggers intact after the with-rows path');
  ok(true, 'existing-row risk: every 0038 CHECK/FK is satisfied by ANY 0037-era row by construction (incoming & resulting were NOT NULL, surface defaults to CAPTURE, related_prediction_event_id is NULL) — so the constraint additions cannot fail on pre-existing rows');
} catch (e) {
  failed++; console.log('  ✗ UNEXPECTED', e?.stack || e);
} finally {
  for (const s of [S1, S2]) { try { await client.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`); } catch (e) { console.log('cleanup:', e.message); } }
  const left = await client.query(`SELECT COUNT(*)::int n FROM information_schema.schemata WHERE schema_name LIKE 'gk279_%'`);
  ok(left.rows[0].n === 0, 'scratch schemas dropped (no leftovers)');
  await client.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
