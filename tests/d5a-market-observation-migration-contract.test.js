// tests/d5a-market-observation-migration-contract.test.js
//
// D5A -- real, isolated scratch-schema proof of the MarketObservation
// substrate (db/data0/0014_d5a_market_observation.sql, NOT applied to
// data1_dev this pass). Mirrors D3.3/D4's own proof discipline exactly:
// build a scratch schema, run the ACTUAL migration text (read from disk,
// not retyped) against it, prove the required behavior with real SQL,
// real trigger enforcement, real dedup -- then rehearse the rollback and
// confirm it restores the pre-migration state exactly, then reapply and
// re-run a critical subset. data1_dev is never touched.
//
// Required proof, mapped to the D5A dispatch's own item numbers:
//   D1  exact table contract (columns, types, constraints, no asset_id)
//   D5  dedup/observation-identity behavior (all named scenarios)
//   D6  immutability (UPDATE/DELETE rejected)
//   D7  batch-persistence structural support (correlation_id linking)
//   D9  D3.3 non-interference (comp_snapshot/valuation_event untouched)
//   D10 forward -> verify -> rollback -> verify -> reapply -> verify
//
// Invoke: node tests/d5a-market-observation-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
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
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, label, expectedFragment) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = !expectedFragment || String(e.message).includes(expectedFragment);
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 100)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== D5A -- MarketObservation migration contract (real, isolated scratch-schema proof) ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();

async function marketObservationExistsInDataOneDev() {
  await client.query('SET search_path TO data1_dev');
  const r = await client.query(`SELECT to_regclass('data1_dev.market_observation') AS t`);
  return r.rows[0].t;
}
const beforeState = await marketObservationExistsInDataOneDev();
console.log('  data1_dev.market_observation exists before (must be null):', beforeState);
assertTrue(beforeState === null, 'PRECONDITION: market_observation does not exist in real data1_dev before this proof (this run never touches it)');

const SCHEMA = `d5a_0014_scratch_${Date.now()}`;
const fwdPath = path.join(repoRoot, 'db', 'data0', '0014_d5a_market_observation.sql');
const rbPath = path.join(repoRoot, 'db', 'data0', '0014_d5a_market_observation_rollback.sql');
const fwdRaw = readFileSync(fwdPath, 'utf8');
const rbRaw = readFileSync(rbPath, 'utf8');

// D9 static check -- the committed migration's REAL SQL (comments
// stripped -- the header prose deliberately discusses the D3.3
// relationship in English, which must not count as a code reference)
// never mentions D3.3's tables, before any live proof runs at all.
const stripSqlComments = (raw) => raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
assertTrue(!/comp_snapshot|valuation_event/i.test(stripSqlComments(fwdRaw)), 'D9 (static): 0014 forward migration\'s REAL SQL (comments excluded) contains zero references to comp_snapshot or valuation_event');
assertTrue(!/comp_snapshot|valuation_event/i.test(stripSqlComments(rbRaw)), 'D9 (static): 0014 rollback\'s REAL SQL (comments excluded) contains zero references to comp_snapshot or valuation_event');

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);

  // Minimal prerequisite substrate -- only gk_principal.id is FK-referenced
  // by 0014. D9's non-interference is proven with REAL comp_snapshot/
  // valuation_event stand-ins in this same scratch schema (below), not
  // merely the static text check above.
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  const principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

  // D9 -- minimal real D3.3 stand-ins, populated with a real row each, so
  // "0014 does not touch them" can be proven by exact before/after
  // comparison, not merely by 0014's own text never mentioning them.
  await client.query(`
    CREATE TABLE comp_snapshot (id UUID PRIMARY KEY, marker TEXT NOT NULL);
    CREATE TABLE valuation_event (id UUID PRIMARY KEY, marker TEXT NOT NULL);
  `);
  const compSnapshotId = crypto.randomUUID(), valuationEventId = crypto.randomUUID();
  await client.query('INSERT INTO comp_snapshot (id, marker) VALUES ($1, $2)', [compSnapshotId, 'd9-untouched-marker']);
  await client.query('INSERT INTO valuation_event (id, marker) VALUES ($1, $2)', [valuationEventId, 'd9-untouched-marker']);

  // -------------------------------------------------------------------
  // D10 -- apply the REAL forward migration text, schema-qualified.
  // -------------------------------------------------------------------
  const fwd = fwdRaw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertSucceeds(() => client.query(fwd), 'D10: real 0014 migration text applied successfully to the scratch schema');

  // D9 -- live proof: comp_snapshot/valuation_event completely unaffected.
  const compAfter = await client.query('SELECT id, marker FROM comp_snapshot');
  const valAfter = await client.query('SELECT id, marker FROM valuation_event');
  assertTrue(compAfter.rows.length === 1 && compAfter.rows[0].id === compSnapshotId && compAfter.rows[0].marker === 'd9-untouched-marker', 'D9: comp_snapshot row survives byte-for-byte after 0014 apply (1 row, same id, same marker)');
  assertTrue(valAfter.rows.length === 1 && valAfter.rows[0].id === valuationEventId && valAfter.rows[0].marker === 'd9-untouched-marker', 'D9: valuation_event row survives byte-for-byte after 0014 apply (1 row, same id, same marker)');

  // ===================================================================
  // D1 -- exact table contract
  // ===================================================================
  console.log('\n-- D1: exact table contract --\n');

  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default,
            numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'market_observation'
     ORDER BY ordinal_position`,
    [SCHEMA]
  );
  const colByName = Object.fromEntries(cols.rows.map(r => [r.column_name, r]));
  const expectedCols = [
    'id', 'provider', 'provider_item_id', 'listing_kind', 'price_amount',
    'currency', 'condition_text', 'grade_numeric', 'occurred_at',
    'observed_at', 'recorded_at', 'recorded_by_principal_id',
    'correlation_id', 'content_hash', 'hash_contract_version', 'raw_payload',
  ];
  assertTrue(
    JSON.stringify(cols.rows.map(r => r.column_name).sort()) === JSON.stringify([...expectedCols].sort()),
    `D1: exactly the ratified 16 columns exist, no extras, no asset_id (actual: ${cols.rows.map(r => r.column_name).join(',')})`
  );
  assertTrue(!('asset_id' in colByName), 'D1 (A1): asset_id column does NOT exist on market_observation');
  assertTrue(colByName.provider.is_nullable === 'NO', 'D1: provider NOT NULL');
  assertTrue(colByName.provider_item_id.is_nullable === 'YES', 'D1: provider_item_id nullable');
  assertTrue(colByName.listing_kind.is_nullable === 'NO', 'D1: listing_kind NOT NULL');
  assertTrue(colByName.price_amount.is_nullable === 'YES' && colByName.price_amount.numeric_precision === 14 && colByName.price_amount.numeric_scale === 4, 'D1 (S2): price_amount NUMERIC(14,4), nullable');
  assertTrue(colByName.currency.is_nullable === 'YES', 'D1: currency nullable');
  assertTrue(colByName.grade_numeric.is_nullable === 'YES' && colByName.grade_numeric.numeric_precision === 3 && colByName.grade_numeric.numeric_scale === 1, 'D1 (D2a): grade_numeric NUMERIC(3,1), nullable');
  assertTrue(colByName.occurred_at.is_nullable === 'YES', 'D1 (G7): occurred_at nullable');
  assertTrue(colByName.observed_at.is_nullable === 'NO', 'D1 (G7): observed_at NOT NULL');
  assertTrue(colByName.recorded_at.is_nullable === 'NO' && /now\(\)/.test(colByName.recorded_at.column_default || ''), 'D1 (G7): recorded_at NOT NULL DEFAULT now()');
  assertTrue(colByName.recorded_by_principal_id.is_nullable === 'NO', 'D1: recorded_by_principal_id NOT NULL');
  assertTrue(colByName.correlation_id.is_nullable === 'NO', 'D1 (A4a): correlation_id NOT NULL');
  assertTrue(colByName.content_hash.is_nullable === 'NO', 'D1: content_hash NOT NULL');
  assertTrue(colByName.hash_contract_version.column_default?.includes('mo-hash-v1'), 'D1 (S3): hash_contract_version DEFAULT mo-hash-v1');
  assertTrue(colByName.raw_payload.is_nullable === 'YES' && colByName.raw_payload.data_type === 'jsonb', 'D1 (A3): raw_payload nullable JSONB');

  const constraints = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
    [`${SCHEMA}.market_observation`]
  );
  const constraintDefs = constraints.rows.map(r => r.def).join(' | ');
  assertTrue(/listing_kind = ANY/.test(constraintDefs) || /listing_kind.*IN/.test(constraintDefs), 'D1: listing_kind CHECK constraint present');
  assertTrue(/price_amount.*>=\s*\(?0/.test(constraintDefs), `D1: price_amount non-negative CHECK constraint present (actual: ${constraintDefs})`);

  const uniqueIdx = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'market_observation' AND indexname = 'market_observation_dedup_key'`,
    [SCHEMA]
  );
  assertTrue(uniqueIdx.rows.length === 1 && /UNIQUE/i.test(uniqueIdx.rows[0].indexdef), 'D1 (D5): market_observation_dedup_key is a real UNIQUE index on (provider, provider_item_id, content_hash)');

  // ===================================================================
  // D6 -- immutability
  // ===================================================================
  console.log('\n-- D6: immutability --\n');

  const now = new Date().toISOString();
  const obs1 = crypto.randomUUID();
  const corrId1 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'ebay','item-1','sold',66.0000,'USD','near mint',9.4,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-1')`,
    [obs1, now, principalId, corrId1]
  );
  await assertRejected(
    () => client.query('UPDATE market_observation SET price_amount = 99.0000 WHERE id = $1', [obs1]),
    'D6: UPDATE rejected by the immutability trigger', 'immutable once written'
  );
  await assertRejected(
    () => client.query('DELETE FROM market_observation WHERE id = $1', [obs1]),
    'D6: DELETE rejected by the immutability trigger', 'immutable once written'
  );

  // ===================================================================
  // D5 -- dedup / observation identity
  // ===================================================================
  console.log('\n-- D5: dedup / observation identity --\n');

  // same provider object + unchanged normalized facts -> resolves
  // idempotently (ON CONFLICT DO NOTHING RETURNING + fallback SELECT is
  // an application-layer concern, not built here -- but the DB-level
  // guarantee this depends on IS built here: the unique index rejects a
  // literal duplicate insert attempt).
  await assertRejected(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay','item-1','sold',66.0000,'USD','near mint',9.4,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-1')`,
      [crypto.randomUUID(), now, principalId, crypto.randomUUID()]
    ),
    'D5: identical (provider, provider_item_id, content_hash) -- unique index rejects the duplicate (resolve-or-create is the app-layer contract over this)',
    'duplicate key'
  );

  // changed price -> different hash (app-layer concern) -> new row succeeds
  const obs2 = crypto.randomUUID(), corrId2 = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay','item-1','asking',85.0000,'USD','near mint',9.4,'2026-07-01T00:00:00.000Z',$2,$3,$4,'hash-2-changed-price')`,
      [obs2, now, principalId, corrId2]
    ),
    'D5: changed price (different content_hash) -- new row succeeds (asking $85, distinct from sold $66)'
  );

  // changed listing state (asking -> sold) -> new row
  const obs3 = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay','item-1','sold',72.0000,'USD','near mint',9.4,'2026-08-02T00:00:00.000Z',$2,$3,$4,'hash-3-sold-final')`,
      [obs3, now, principalId, crypto.randomUUID()]
    ),
    'D5: changed listing state + price (asking $85 -> sold $72) -- new row succeeds'
  );

  // changed condition/grade -> new row (different content_hash by app-layer contract)
  const obs4 = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay','item-1','sold',72.0000,'USD','very fine',8.0,'2026-08-02T00:00:00.000Z',$2,$3,$4,'hash-4-different-grade')`,
      [obs4, now, principalId, crypto.randomUUID()]
    ),
    'D5: changed condition/grade -- new row succeeds'
  );

  // changed occurred_at only (S1) -> new row -- the exact PriceCharting
  // two-sales-same-price scenario from the S1 ruling.
  const pcObs1 = crypto.randomUUID(), pcObs2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-pc-sale-june')`,
    [pcObs1, now, principalId, crypto.randomUUID()]
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,'2026-08-02T00:00:00.000Z',$2,$3,$4,'hash-pc-sale-august')`,
      [pcObs2, now, principalId, crypto.randomUUID()]
    ),
    'D5 (S1): identical price/status/provider/item, DIFFERENT occurred_at (two real PriceCharting sales) -- both rows persist, never collapsed'
  );
  const pcRows = await client.query(`SELECT id FROM market_observation WHERE provider = 'pricecharting' AND provider_item_id = 'pc-item-9'`);
  assertTrue(pcRows.rows.length === 2, 'D5 (S1): both PriceCharting sales exist as two distinct rows, not one');

  // provider correction (same object, corrected event date) -> new row,
  // old row remains exactly as originally recorded.
  const correctedObs = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,'2026-06-15T00:00:00.000Z',$2,$3,$4,'hash-pc-sale-june-corrected')`,
      [correctedObs, now, principalId, crypto.randomUUID()]
    ),
    'D5: provider correction of occurred_at (2026-06-14 -> 2026-06-15) -- new immutable row, original untouched'
  );
  const originalStillIntact = await client.query('SELECT occurred_at FROM market_observation WHERE id = $1', [pcObs1]);
  assertTrue(new Date(originalStillIntact.rows[0].occurred_at).toISOString() === '2026-06-14T00:00:00.000Z', 'D5: the ORIGINAL pre-correction row remains exactly as recorded (never mutated)');

  // NULL provider_item_id never falsely collapses unrelated observations
  const nullId1 = crypto.randomUUID(), nullId2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'pricecharting',NULL,'sold',10.0000,'USD',NULL,NULL,NULL,$2,$3,$4,'hash-idless-a')`,
    [nullId1, now, principalId, crypto.randomUUID()]
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'pricecharting',NULL,'sold',10.0000,'USD',NULL,NULL,NULL,$2,$3,$4,'hash-idless-a')`,
      [nullId2, now, principalId, crypto.randomUUID()]
    ),
    'D5 (A2a): TWO rows, same provider, NULL provider_item_id, SAME content_hash -- unique index does NOT reject (NULL is distinct from NULL, standard Postgres semantics) -- never falsely collapsed'
  );

  // provider A and provider B cannot dedup against each other
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'heritage-auctions','item-1','sold',66.0000,'USD','near mint',9.4,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-1')`,
      [crypto.randomUUID(), now, principalId, crypto.randomUUID()]
    ),
    'D5: same provider_item_id + same content_hash but DIFFERENT provider (heritage-auctions vs ebay) -- distinct row, unique index does not cross providers'
  );

  // hash-contract version change does not mutate historical hashes --
  // structural proof: hash_contract_version is stored per-row, never
  // recomputed/rewritten (the immutability trigger already proves no
  // UPDATE is possible on any column, including this one).
  const versionRow = await client.query('SELECT hash_contract_version FROM market_observation WHERE id = $1', [obs1]);
  assertTrue(versionRow.rows[0].hash_contract_version === 'mo-hash-v1', 'D5 (S3): hash_contract_version recorded per-row, defaults to mo-hash-v1');
  await assertRejected(
    () => client.query(`UPDATE market_observation SET hash_contract_version = 'mo-hash-v2' WHERE id = $1`, [obs1]),
    'D5 (S3): hash_contract_version cannot be rewritten on an existing row -- the SAME immutability trigger that protects every other column protects this one too (a future v2 contract can never retroactively relabel v1 history)',
    'immutable once written'
  );

  // ===================================================================
  // D7 -- batch-persistence structural support
  // ===================================================================
  console.log('\n-- D7: batch correlation --\n');

  const batchCorrId = crypto.randomUUID();
  const batchRows = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const [i, id] of batchRows.entries()) {
    await client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay',$2,'sold',$3,'USD',NULL,NULL,'2026-06-14T00:00:00.000Z',$4,$5,$6,$7)`,
      [id, `batch-item-${i}`, (10 + i).toFixed(4), now, principalId, batchCorrId, `hash-batch-${i}`]
    );
  }
  const recovered = await client.query('SELECT id FROM market_observation WHERE correlation_id = $1 ORDER BY id', [batchCorrId]);
  assertTrue(recovered.rows.length === 3, 'D7: all 3 rows of one batch are recoverable via a single correlation_id query, individually addressable, independently immutable');

  // D7 -- batch ATOMICITY: one BEGIN/COMMIT wraps the whole batch (A4a's
  // ratified "1 transaction -> N rows" unit) -- if any one row in the
  // batch is invalid, the WHOLE batch must roll back, never a partial
  // durable batch. Proven directly against this table's own constraints
  // (a NOT NULL violation on the 3rd of 3 rows), not merely asserted.
  const atomicCorrId = crypto.randomUUID();
  const atomicRow1 = crypto.randomUUID(), atomicRow2 = crypto.randomUUID();
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay','atomic-1','sold',1.0000,'USD',NULL,NULL,NULL,$2,$3,$4,'hash-atomic-1')`,
      [atomicRow1, now, principalId, atomicCorrId]
    );
    await client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay','atomic-2','sold',2.0000,'USD',NULL,NULL,NULL,$2,$3,$4,'hash-atomic-2')`,
      [atomicRow2, now, principalId, atomicCorrId]
    );
    // Deliberately invalid 3rd row -- provider is NOT NULL, pass NULL.
    await client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1, NULL, 'atomic-3','sold',3.0000,'USD',NULL,NULL,NULL,$2,$3,$4,'hash-atomic-3')`,
      [crypto.randomUUID(), now, principalId, atomicCorrId]
    );
    await client.query('COMMIT');
    failed++; console.log('  ✗ D7 (atomicity): expected the batch transaction to fail on row 3, but it committed');
    failures.push('D7 (atomicity): batch unexpectedly committed');
  } catch (e) {
    await client.query('ROLLBACK');
    passed++; console.log(`  ✓ D7 (atomicity): batch transaction correctly failed and rolled back on the invalid 3rd row (${e.message.slice(0, 80)})`);
  }
  const afterAtomicRollback = await client.query('SELECT id FROM market_observation WHERE correlation_id = $1', [atomicCorrId]);
  assertTrue(afterAtomicRollback.rows.length === 0, 'D7 (atomicity): NO partial durable batch -- zero rows from the failed batch exist, including the two that were individually valid (rows 1 and 2 did not survive despite being valid on their own)');

  // ===================================================================
  // D10 -- rollback -> verify -> reapply -> verify
  // ===================================================================
  console.log('\n-- D10: rollback / reapply --\n');

  const rb = rbRaw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertSucceeds(() => client.query(rb), 'D10: rollback text applied successfully');

  const afterRollback = await client.query(`SELECT to_regclass('${SCHEMA}.market_observation') AS t`);
  assertTrue(afterRollback.rows[0].t === null, 'D10: market_observation no longer exists after rollback');
  const compAfterRollback = await client.query('SELECT id, marker FROM comp_snapshot');
  const valAfterRollback = await client.query('SELECT id, marker FROM valuation_event');
  assertTrue(compAfterRollback.rows.length === 1 && compAfterRollback.rows[0].marker === 'd9-untouched-marker', 'D9/D10: comp_snapshot survives rollback untouched too');
  assertTrue(valAfterRollback.rows.length === 1 && valAfterRollback.rows[0].marker === 'd9-untouched-marker', 'D9/D10: valuation_event survives rollback untouched too');

  await assertSucceeds(() => client.query(fwd), 'D10: reapply of the same forward text succeeds cleanly after rollback');
  const afterReapply = await client.query(`SELECT count(*)::int AS n FROM market_observation`);
  assertTrue(afterReapply.rows[0].n === 0, 'D10: reapplied table is empty (rollback genuinely removed all prior rows along with the table)');

  // Real row-based re-check (a WHERE-false DELETE would affect zero rows
  // and never fire a FOR EACH ROW trigger at all -- this proves the
  // trigger is genuinely re-attached post-reapply, not a vacuous pass).
  const postReapplyObs = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'ebay','post-reapply-item','sold',1.0000,'USD',NULL,NULL,NULL,$2,$3,$4,'hash-post-reapply')`,
    [postReapplyObs, now, principalId, crypto.randomUUID()]
  );
  await assertRejected(
    () => client.query('DELETE FROM market_observation WHERE id = $1', [postReapplyObs]),
    'D10: immutability trigger genuinely re-attached after reapply (real row, real DELETE attempt, real rejection)',
    'immutable once written'
  );

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped -- data1_dev untouched throughout`);
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
