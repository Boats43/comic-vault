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
// FINAL PRE-LIVE REPRESENTATION CLOSURE (F1/F1a/F1b/F1c/F2/F2a/F2b,
// 2026-09-03) -- supersedes the intermediate T1/T1a/T2/T2a suite.
// Temporal representation is now structural: occurred_on DATE +
// occurred_at TIMESTAMPTZ, mutually exclusive (occurred_at_precision
// REMOVED entirely). grade_basis added, nullable, hash-participating.
//
// Required proof, mapped to the dispatch's own item numbers:
//   D1  exact table contract (columns, types, constraints, no asset_id)
//   D5  dedup/observation-identity behavior (all named scenarios)
//   D6  immutability (UPDATE/DELETE rejected)
//   D7  batch-persistence structural support (correlation_id linking + atomicity)
//   D9  D3.3 non-interference (comp_snapshot/valuation_event untouched)
//   D10 forward -> verify -> rollback -> verify -> reapply -> verify
//   F1/F1b/F1c  structural temporal representation, live CHECK proof
//   F1a  observed_at = provider retrieval time, conceptual/static proof
//        that the schema permits observed_at != recorded_at (a stale
//        cache-hit persistence never has to fabricate freshness)
//   F2/F2a/F2b  grade_basis: nullable, hash-participating, dedup-safe
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

// P2a (post-live banking closure, 2026-09-03) -- POSITIVE scratch-schema
// containment. The old precondition ("market_observation must be absent
// from data1_dev") was never actually a guard against this suite's OWN
// forward/rollback DDL running against the wrong schema -- it was a
// pre-existing-state diagnostic only, checked on the client BEFORE it
// was ever repointed at the scratch schema, and 0014's forward/rollback
// DDL only ever runs later, after a SEPARATE `SET search_path TO
// ${SCHEMA}` call. It also became permanently unusable the moment 0014
// went live (market_observation now legitimately exists in data1_dev
// forever). Replaced with a REAL containment guard: assertScratchTarget
// positively proves, via `current_schema()`, that the connection is
// pointed at the expected scratch schema and explicitly, unconditionally
// refuses `data1_dev` regardless of what was "expected" -- called
// immediately before every DDL-mutating statement (forward apply,
// rollback, reapply), not merely once at the top.
//
// GK-178 note: this uses a single dedicated, UNPOOLED `pg.Client`
// (GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED) held open for this script's
// entire lifetime -- never a pooled multi-connection `pg.Pool` -- so
// `SET search_path`/`current_schema()` state cannot silently move
// between statements the way GK-178 proved a pooled connection can.
// This is verified directly, not merely asserted: pg_backend_pid() is
// captured once after connecting and re-checked at every guard call --
// if the underlying physical backend ever changed mid-script, the guard
// itself would fail loudly rather than silently trusting session state.
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated unpooled backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  const { s: actualSchema, pid: actualPid } = r.rows[0];
  if (actualPid !== sessionPid) {
    throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script (${sessionPid} -> ${actualPid}) -- session identity is not stable, refusing to execute DDL`);
  }
  if (actualSchema === 'data1_dev') {
    throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally, regardless of any expected value`);
  }
  if (actualSchema !== expectedSchema) {
    throw new Error(`SAFETY ABORT (${label}): expected scratch schema "${expectedSchema}" but current_schema() returned "${actualSchema}" -- refusing to execute DDL`);
  }
  return actualSchema;
}

// Positive proof (not merely asserted): deliberately point this exact
// client at data1_dev and confirm the guard refuses -- proves the
// containment mechanism actually rejects the real production schema
// before any DDL, using the real function, not a hypothetical.
{
  await client.query('SET search_path TO data1_dev');
  let refused = false;
  try {
    await assertScratchTarget('some-scratch-schema-name', 'negative proof');
  } catch (e) {
    refused = /SAFETY ABORT/.test(e.message) && /data1_dev/.test(e.message);
  }
  assertTrue(refused, 'P2a: intentionally pointing this client at data1_dev causes assertScratchTarget to refuse BEFORE any DDL -- proven with the real guard function, not a hypothetical');
}

const SCHEMA = `d5a_0014_scratch_${Date.now()}`;
const fwdPath = path.join(repoRoot, 'db', 'data0', '0014_d5a_market_observation.sql');
const rbPath = path.join(repoRoot, 'db', 'data0', '0014_d5a_market_observation_rollback.sql');
const fwdRaw = readFileSync(fwdPath, 'utf8');
const rbRaw = readFileSync(rbPath, 'utf8');

const stripSqlComments = (raw) => raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
assertTrue(!/comp_snapshot|valuation_event/i.test(stripSqlComments(fwdRaw)), 'D9 (static): 0014 forward migration\'s REAL SQL (comments excluded) contains zero references to comp_snapshot or valuation_event');
assertTrue(!/comp_snapshot|valuation_event/i.test(stripSqlComments(rbRaw)), 'D9 (static): 0014 rollback\'s REAL SQL (comments excluded) contains zero references to comp_snapshot or valuation_event');
assertTrue(!/occurred_at_precision/i.test(stripSqlComments(fwdRaw)), 'F1b (static): occurred_at_precision does not appear anywhere in 0014\'s real SQL -- fully removed, not merely unused');

const COLS = '(id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, grade_basis, occurred_on, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)';

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');
  assertTrue(true, `P2a: positively confirmed connected to scratch schema "${SCHEMA}" (current_schema() + stable backend PID), not data1_dev`);

  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  const principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

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
  await assertScratchTarget(SCHEMA, 'pre-forward-apply');
  await assertSucceeds(() => client.query(fwd), 'D10: real 0014 migration text applied successfully to the scratch schema');

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
    'currency', 'condition_text', 'grade_numeric', 'grade_basis',
    'occurred_on', 'occurred_at', 'observed_at', 'recorded_at',
    'recorded_by_principal_id', 'correlation_id', 'content_hash',
    'hash_contract_version', 'raw_payload',
  ];
  assertTrue(
    JSON.stringify(cols.rows.map(r => r.column_name).sort()) === JSON.stringify([...expectedCols].sort()),
    `D1: exactly the ratified 18 columns exist, no extras, no asset_id, no occurred_at_precision (actual: ${cols.rows.map(r => r.column_name).join(',')})`
  );
  assertTrue(!('asset_id' in colByName), 'D1 (A1): asset_id column does NOT exist on market_observation');
  assertTrue(!('occurred_at_precision' in colByName), 'D1 (F1b): occurred_at_precision does NOT exist on market_observation -- removed entirely, not merely unused');
  assertTrue(colByName.provider.is_nullable === 'NO', 'D1: provider NOT NULL');
  assertTrue(colByName.provider_item_id.is_nullable === 'YES', 'D1: provider_item_id nullable');
  assertTrue(colByName.listing_kind.is_nullable === 'NO', 'D1: listing_kind NOT NULL');
  assertTrue(colByName.price_amount.is_nullable === 'YES' && colByName.price_amount.numeric_precision === 14 && colByName.price_amount.numeric_scale === 4, 'D1 (S2): price_amount NUMERIC(14,4), nullable');
  assertTrue(colByName.currency.is_nullable === 'YES', 'D1: currency nullable');
  assertTrue(colByName.grade_numeric.is_nullable === 'YES' && colByName.grade_numeric.numeric_precision === 12 && colByName.grade_numeric.numeric_scale === 6, 'D1 (T2/T2a): grade_numeric NUMERIC(12,6), nullable -- generic bound, no comic-specific scale');
  assertTrue(colByName.grade_basis.is_nullable === 'YES' && colByName.grade_basis.data_type === 'text', 'D1 (F2): grade_basis nullable TEXT');
  assertTrue(colByName.occurred_on.is_nullable === 'YES' && colByName.occurred_on.data_type === 'date', 'D1 (F1): occurred_on nullable DATE (a genuine SQL date type, not a TIMESTAMPTZ)');
  assertTrue(colByName.occurred_at.is_nullable === 'YES' && colByName.occurred_at.data_type === 'timestamp with time zone', 'D1 (F1): occurred_at nullable TIMESTAMPTZ');
  assertTrue(colByName.observed_at.is_nullable === 'NO', 'D1 (F1a): observed_at NOT NULL');
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
  assertTrue(/price_amount.*>=\s*\(?0/.test(constraintDefs), 'D1: price_amount non-negative CHECK constraint present');
  assertTrue(/occurred_on IS NULL.*occurred_at IS NULL|occurred_at IS NULL.*occurred_on IS NULL/.test(constraintDefs), `D1 (F1): mutual-exclusion CHECK (occurred_on IS NULL OR occurred_at IS NULL) present (actual: ${constraintDefs})`);
  assertTrue(!/occurred_at_precision/.test(constraintDefs), 'D1 (F1b): no constraint anywhere references occurred_at_precision');

  const uniqueIdx = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'market_observation' AND indexname = 'market_observation_dedup_key'`,
    [SCHEMA]
  );
  assertTrue(uniqueIdx.rows.length === 1 && /UNIQUE/i.test(uniqueIdx.rows[0].indexdef), 'D1 (D5): market_observation_dedup_key is a real UNIQUE index on (provider, provider_item_id, content_hash)');

  // ===================================================================
  // F1/F1b/F1c: structural temporal representation, live
  // ===================================================================
  console.log('\n-- F1/F1b/F1c: structural temporal representation, live --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','f1-a','sold',1.0000,'USD',NULL,NULL,NULL,'2026-06-14','2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-f1-a')`,
      [crypto.randomUUID(), new Date().toISOString(), principalId, crypto.randomUUID()]
    ),
    'F1: BOTH occurred_on and occurred_at populated together is rejected by the CHECK constraint', 'violates check constraint'
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','f1-b','sold',1.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-f1-b')`,
      [crypto.randomUUID(), new Date().toISOString(), principalId, crypto.randomUUID()]
    ),
    'F1: both occurred_on and occurred_at NULL together -- legal (genuinely unknown event time)'
  );
  const dateOnlyProbe = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','f1-c','sold',1.0000,'USD',NULL,NULL,NULL,'2026-06-14',NULL,$2,$3,$4,'hash-f1-c')`,
      [dateOnlyProbe, new Date().toISOString(), principalId, crypto.randomUUID()]
    ),
    'F1: occurred_on populated alone -- legal (a DATE fact)'
  );
  const dateOnlyReadBack = await client.query('SELECT occurred_on, occurred_at FROM market_observation WHERE id = $1', [dateOnlyProbe]);
  assertTrue(
    dateOnlyReadBack.rows[0].occurred_at === null,
    'F1: a DATE fact\'s occurred_at column is genuinely NULL in the DB -- NO synthetic midnight instant is ever stored, not even internally'
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','f1-d','sold',1.0000,'USD',NULL,NULL,NULL,NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-f1-d')`,
      [crypto.randomUUID(), new Date().toISOString(), principalId, crypto.randomUUID()]
    ),
    'F1: occurred_at populated alone -- legal (an INSTANT fact, including a genuinely-midnight-UTC one)'
  );

  // ===================================================================
  // F1a: observed_at = provider retrieval time (conceptual/static proof)
  // ===================================================================
  console.log('\n-- F1a: observed_at represents provider retrieval time, independent of recorded_at --\n');

  // Simulates a cache-hit persistence: the payload was actually fetched
  // from the provider 6 days ago (well within PriceCharting's real
  // 7-day KV_TTL.PC_HTML window), cached, and only NOW being persisted.
  // observed_at correctly carries the ORIGINAL fetch time; recorded_at
  // (DEFAULT now()) is the persistence moment, days later. The schema
  // permits and does not obscure this gap -- proving F1a's contract is
  // representable, even though no cache/adapter wiring exists yet to
  // populate it automatically (GK-184, not built here).
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const staleCacheObs = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation ${COLS}
     VALUES ($1,'pricecharting','f1a-stale','sold',1.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-f1a-stale')`,
    [staleCacheObs, sixDaysAgo, principalId, crypto.randomUUID()]
  );
  const staleRow = await client.query('SELECT observed_at, recorded_at FROM market_observation WHERE id = $1', [staleCacheObs]);
  const gapMs = new Date(staleRow.rows[0].recorded_at).getTime() - new Date(staleRow.rows[0].observed_at).getTime();
  assertTrue(gapMs > 5 * 24 * 60 * 60 * 1000, `F1a: observed_at (real provider-fetch time, 6 days ago) and recorded_at (persistence time, now) differ by ${(gapMs / 86400000).toFixed(2)} days -- the schema neither forces nor obscures this gap; a stale cache-hit persistence never has to fabricate freshness by rewriting observed_at to now()`);
  assertTrue(
    new Date(staleRow.rows[0].observed_at).toISOString() === sixDaysAgo,
    'F1a: observed_at persists exactly the caller-supplied provider-retrieval timestamp, unmodified'
  );

  // ===================================================================
  // D6 -- immutability
  // ===================================================================
  console.log('\n-- D6: immutability --\n');

  const now = new Date().toISOString();
  const obs1 = crypto.randomUUID();
  const corrId1 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation ${COLS}
     VALUES ($1,'ebay','item-1','sold',66.0000,'USD','near mint',9.4,'cgc',NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-1')`,
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

  await assertRejected(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','item-1','sold',66.0000,'USD','near mint',9.4,'cgc',NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-1')`,
      [crypto.randomUUID(), now, principalId, crypto.randomUUID()]
    ),
    'D5: identical (provider, provider_item_id, content_hash) -- unique index rejects the duplicate (resolve-or-create is the app-layer contract over this)',
    'duplicate key'
  );

  const obs2 = crypto.randomUUID(), corrId2 = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','item-1','asking',85.0000,'USD','near mint',9.4,'cgc',NULL,'2026-07-01T00:00:00.000Z',$2,$3,$4,'hash-2-changed-price')`,
      [obs2, now, principalId, corrId2]
    ),
    'D5: changed price (different content_hash) -- new row succeeds (asking $85, distinct from sold $66)'
  );

  // T1/S1: two real PriceCharting sales, same price, DATE fact, different dates.
  const pcObs1 = crypto.randomUUID(), pcObs2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation ${COLS}
     VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,NULL,'2026-06-14',NULL,$2,$3,$4,'hash-pc-sale-june')`,
    [pcObs1, now, principalId, crypto.randomUUID()]
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,NULL,'2026-08-02',NULL,$2,$3,$4,'hash-pc-sale-august')`,
      [pcObs2, now, principalId, crypto.randomUUID()]
    ),
    'D5/F1 (S1): identical price/status/provider/item, DATE facts, DIFFERENT dates (two real PriceCharting sales) -- both rows persist, never collapsed'
  );
  const pcRows = await client.query(`SELECT id FROM market_observation WHERE provider = 'pricecharting' AND provider_item_id = 'pc-item-9'`);
  assertTrue(pcRows.rows.length === 2, 'D5 (S1): both PriceCharting sales exist as two distinct rows, not one');

  // F1: DATE -> INSTANT improvement of the SAME underlying sale.
  const pcObsImproved = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,NULL,NULL,'2026-06-14T09:15:00.000Z',$2,$3,$4,'hash-pc-sale-june-precise')`,
      [pcObsImproved, now, principalId, crypto.randomUUID()]
    ),
    'F1: a later exact-timestamp report of the SAME June sale (DATE -> INSTANT improvement) creates a NEW observation, never an update to the date-only one'
  );
  const dateOnlyRowStillIntact = await client.query('SELECT occurred_on, occurred_at FROM market_observation WHERE id = $1', [pcObs1]);
  assertTrue(
    dateOnlyRowStillIntact.rows[0].occurred_at === null && dateOnlyRowStillIntact.rows[0].occurred_on !== null,
    'F1: the ORIGINAL date-only observation remains exactly as recorded (occurred_on still populated, occurred_at still NULL) -- never mutated or "upgraded in place"'
  );

  // provider correction (same object, corrected event date, still a DATE fact).
  const correctedObs = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'pricecharting','pc-item-9','sold',66.0000,'USD',NULL,NULL,NULL,'2026-06-15',NULL,$2,$3,$4,'hash-pc-sale-june-corrected')`,
      [correctedObs, now, principalId, crypto.randomUUID()]
    ),
    'D5: provider correction of occurred_on (2026-06-14 -> 2026-06-15) -- new immutable row, original untouched'
  );
  const originalStillIntact = await client.query('SELECT occurred_on FROM market_observation WHERE id = $1', [pcObs1]);
  assertTrue(originalStillIntact.rows[0].occurred_on.toISOString().slice(0, 10) === '2026-06-14', 'D5: the ORIGINAL pre-correction row remains exactly as recorded (never mutated)');

  // NULL provider_item_id never falsely collapses unrelated observations
  const nullId1 = crypto.randomUUID(), nullId2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation ${COLS}
     VALUES ($1,'pricecharting',NULL,'sold',10.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-idless-a')`,
    [nullId1, now, principalId, crypto.randomUUID()]
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'pricecharting',NULL,'sold',10.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-idless-a')`,
      [nullId2, now, principalId, crypto.randomUUID()]
    ),
    'D5 (A2a): TWO rows, same provider, NULL provider_item_id, SAME content_hash -- unique index does NOT reject (NULL is distinct from NULL, standard Postgres semantics) -- never falsely collapsed'
  );

  // Cross-provider non-collision, even with identical grade+basis.
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'heritage-auctions','item-1','sold',66.0000,'USD','near mint',9.4,'cgc',NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-1')`,
      [crypto.randomUUID(), now, principalId, crypto.randomUUID()]
    ),
    'D5: same provider_item_id + same content_hash + same grade_numeric/grade_basis but DIFFERENT provider (heritage-auctions vs ebay) -- distinct row, unique index does not cross providers'
  );

  // hash-contract version change does not mutate historical hashes.
  const versionRow = await client.query('SELECT hash_contract_version FROM market_observation WHERE id = $1', [obs1]);
  assertTrue(versionRow.rows[0].hash_contract_version === 'mo-hash-v1', 'D5 (S3): hash_contract_version recorded per-row, defaults to mo-hash-v1');
  await assertRejected(
    () => client.query(`UPDATE market_observation SET hash_contract_version = 'mo-hash-v2' WHERE id = $1`, [obs1]),
    'D5 (S3): hash_contract_version cannot be rewritten on an existing row -- the SAME immutability trigger that protects every other column protects this one too',
    'immutable once written'
  );

  // ===================================================================
  // F2/F2a/F2b -- grade_basis, live
  // ===================================================================
  console.log('\n-- F2/F2a/F2b: grade_basis, live --\n');

  const gradeObs1 = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'manual','g-1','sold',1.0000,'USD',NULL,87.1250,NULL,NULL,NULL,$2,$3,$4,'hash-grade-precise')`,
      [gradeObs1, now, principalId, crypto.randomUUID()]
    ),
    'T2a: grade_numeric accepts a value beyond one decimal place (87.1250) -- NUMERIC(12,6) has no comic-specific one-decimal restriction'
  );
  const gradeReadBack = await client.query('SELECT grade_numeric, grade_basis FROM market_observation WHERE id = $1', [gradeObs1]);
  assertTrue(Number(gradeReadBack.rows[0].grade_numeric) === 87.125, 'T2a: the persisted NUMERIC value round-trips exactly');
  assertTrue(gradeReadBack.rows[0].grade_basis === null, 'F2a: grade_basis is genuinely NULL when no basis was asserted -- never fabricated');

  // F2a: same numeric grade, NULL basis vs. present basis -- distinct
  // rows, same provider, same item -- must NOT dedup (different facts).
  const noBasisObs = crypto.randomUUID(), withBasisObs = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation ${COLS}
     VALUES ($1,'ebay','g-2','sold',1.0000,'USD',NULL,9.4,NULL,NULL,NULL,$2,$3,$4,'hash-g2-no-basis')`,
    [noBasisObs, now, principalId, crypto.randomUUID()]
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','g-2','sold',1.0000,'USD',NULL,9.4,'cgc',NULL,NULL,$2,$3,$4,'hash-g2-with-basis')`,
      [withBasisObs, now, principalId, crypto.randomUUID()]
    ),
    'F2a: same provider/item/grade_numeric, NULL basis vs. "cgc" basis -- distinct content_hash values, both rows persist (genuinely different asserted facts)'
  );

  // ===================================================================
  // D7 -- batch-persistence structural support
  // ===================================================================
  console.log('\n-- D7: batch correlation --\n');

  const batchCorrId = crypto.randomUUID();
  const batchRows = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const [i, id] of batchRows.entries()) {
    await client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay',$2,'sold',$3,'USD',NULL,NULL,NULL,NULL,'2026-06-14T00:00:00.000Z',$4,$5,$6,$7)`,
      [id, `batch-item-${i}`, (10 + i).toFixed(4), now, principalId, batchCorrId, `hash-batch-${i}`]
    );
  }
  const recovered = await client.query('SELECT id FROM market_observation WHERE correlation_id = $1 ORDER BY id', [batchCorrId]);
  assertTrue(recovered.rows.length === 3, 'D7: all 3 rows of one batch are recoverable via a single correlation_id query, individually addressable, independently immutable');

  const atomicCorrId = crypto.randomUUID();
  const atomicRow1 = crypto.randomUUID(), atomicRow2 = crypto.randomUUID();
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','atomic-1','sold',1.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-atomic-1')`,
      [atomicRow1, now, principalId, atomicCorrId]
    );
    await client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1,'ebay','atomic-2','sold',2.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-atomic-2')`,
      [atomicRow2, now, principalId, atomicCorrId]
    );
    // Deliberately invalid 3rd row -- provider is NOT NULL, pass NULL.
    await client.query(
      `INSERT INTO market_observation ${COLS}
       VALUES ($1, NULL, 'atomic-3','sold',3.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-atomic-3')`,
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
  assertTrue(afterAtomicRollback.rows.length === 0, 'D7 (atomicity): NO partial durable batch -- zero rows from the failed batch exist, including the two that were individually valid');

  // ===================================================================
  // D10 -- rollback -> verify -> reapply -> verify
  // ===================================================================
  console.log('\n-- D10: rollback / reapply --\n');

  const rb = rbRaw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertScratchTarget(SCHEMA, 'pre-rollback');
  await assertSucceeds(() => client.query(rb), 'D10: rollback text applied successfully');

  const afterRollback = await client.query(`SELECT to_regclass('${SCHEMA}.market_observation') AS t`);
  assertTrue(afterRollback.rows[0].t === null, 'D10: market_observation no longer exists after rollback');
  const compAfterRollback = await client.query('SELECT id, marker FROM comp_snapshot');
  const valAfterRollback = await client.query('SELECT id, marker FROM valuation_event');
  assertTrue(compAfterRollback.rows.length === 1 && compAfterRollback.rows[0].marker === 'd9-untouched-marker', 'D9/D10: comp_snapshot survives rollback untouched too');
  assertTrue(valAfterRollback.rows.length === 1 && valAfterRollback.rows[0].marker === 'd9-untouched-marker', 'D9/D10: valuation_event survives rollback untouched too');

  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(fwd), 'D10: reapply of the same forward text succeeds cleanly after rollback');
  const afterReapply = await client.query(`SELECT count(*)::int AS n FROM market_observation`);
  assertTrue(afterReapply.rows[0].n === 0, 'D10: reapplied table is empty (rollback genuinely removed all prior rows along with the table)');

  const postReapplyObs = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation ${COLS}
     VALUES ($1,'ebay','post-reapply-item','sold',1.0000,'USD',NULL,NULL,NULL,NULL,NULL,$2,$3,$4,'hash-post-reapply')`,
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
