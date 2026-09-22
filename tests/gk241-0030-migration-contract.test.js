// tests/gk241-0030-migration-contract.test.js
//
// GK-241 -- real, isolated scratch-schema proof of
// db/data0/0030_gk241_buyer_market_standing_check_widen.sql. Mirrors the
// gk227-0029/beta1a-0022/buyer-decision-ledger-migration-contract scratch-
// proof discipline exactly (same connection pattern, same backend-PID +
// current_schema() safety guard refusing to ever touch data1_dev).
// data1_dev is never written to by this file.
//
// CORRECTED (2026-09-21, post-0030-apply defect found on re-run): the
// original version of this file built its PRE-migration state via
// `CREATE TABLE buyer_decision_event (LIKE data1_dev.buyer_decision_event
// INCLUDING ALL)` -- cloning the CHECK constraint from the REAL, LIVE
// data1_dev table. Once 0030 was applied to that live table (a real,
// disclosed, permanent Development-side effect of this same dispatch),
// every subsequent run of this test silently inherited the ALREADY-WIDE
// constraint instead of the original 3-value one, and its own
// "PRE-migration: reproduces the real bug" assertions could no longer
// pass -- a real test-durability defect, not a fix defect, confirmed by
// independent re-run. Fixed by building the PRE-migration table from the
// CANONICAL HISTORICAL TEXT of db/data0/0027_buyer_decision_ledger.sql
// itself (same `gk_principal`/`gk_asset` minimal-stub pattern
// buyer-decision-ledger-migration-contract.test.js already established --
// reused verbatim, not re-invented), run inside this test's own isolated
// scratch schema. This makes the PRE state deterministic and completely
// independent of whatever migrations have or haven't been applied to the
// real data1_dev at the time this test happens to run.
//
// Invoke: node tests/gk241-0030-migration-contract.test.js

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
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, label, expectedFragment) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = !expectedFragment || String(e.message).includes(expectedFragment);
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 130)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-241 -- 0030 buyer_decision_event.market_standing widen migration contract (real, isolated scratch-schema proof) ===\n');

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client, sessionPid } = await assertScratchSchemaTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'gk241-0030-migration-contract',
});
console.log('  dedicated backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

{
  await client.query('SET search_path TO data1_dev');
  let refused = false;
  try { await assertScratchTarget('some-scratch-schema', 'negative proof'); }
  catch (e) { refused = /SAFETY ABORT/.test(e.message) && /data1_dev/.test(e.message); }
  assertTrue(refused, 'D0: intentionally pointing this client at data1_dev causes the guard to refuse before any DDL');
}

const SCHEMA = `gk241_0030_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

let principalId;
const insertRow = (marketStanding) => client.query(
  `INSERT INTO buyer_decision_event (
     id, principal_id, session_id, market_value_amount, market_value_currency,
     contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount,
     decision, market_standing, recorded_by_principal_id, idempotency_namespace, idempotency_key
   ) VALUES ($1,$2,$3,10,'USD',5,10,1,1,2,'PASS',$4,$2,'test',$5)`,
  [crypto.randomUUID(), principalId, crypto.randomUUID(), marketStanding, `key-${crypto.randomUUID()}`]
);

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  // PRE-migration table built from the CANONICAL HISTORICAL 0027 TEXT,
  // not cloned from the live data1_dev table -- deterministic regardless
  // of what's currently applied to Development. Same minimal-stub pattern
  // buyer-decision-ledger-migration-contract.test.js already established
  // for exactly this purpose (0027 requires real gk_principal/gk_asset FK
  // targets), reused verbatim rather than re-invented.
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await assertSucceeds(
    () => client.query(qualify(read('0027_buyer_decision_ledger.sql'))),
    'setup: canonical 0027 forward text applies cleanly on top of gk_principal/gk_asset stubs (builds the true PRE-0030 state)'
  );
  principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

  // ===================================================================
  // PRE-migration: reproduce the real bug against a table genuinely built
  // from 0027's own original 3-value CHECK constraint -- the exact three
  // values GK-241 exists to fix are rejected BEFORE 0030 runs, proving
  // this table genuinely starts in the real, historical pre-migration
  // state, independent of whatever data1_dev's own current state is.
  // ===================================================================
  for (const v of ['FALLBACK_ONLY', 'NO_SOLD_EVIDENCE', 'NONE']) {
    await assertRejected(
      () => insertRow(v),
      `PRE-migration: market_standing='${v}' is rejected by the OLD constraint (reproduces the real GK-241 bug)`,
      'check constraint'
    );
  }
  await assertSucceeds(() => insertRow('EXACT_CURRENT'), 'PRE-migration: market_standing=\'EXACT_CURRENT\' (already-legal value) still inserts cleanly');

  await client.query(`DELETE FROM buyer_decision_event`); // clean slate before the migration itself

  // ===================================================================
  // Apply 0030
  // ===================================================================
  await assertSucceeds(() => client.query(qualify(read('0030_gk241_buyer_market_standing_check_widen.sql'))), 'setup: 0030 applies cleanly on top of the canonical 0027-built table');

  // ===================================================================
  // POST-migration: all 6 real values now insert cleanly
  // ===================================================================
  for (const v of ['EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY', 'FALLBACK_ONLY', 'NO_SOLD_EVIDENCE', 'NONE']) {
    await assertSucceeds(() => insertRow(v), `POST-migration: market_standing='${v}' inserts cleanly`);
  }
  await assertSucceeds(() => insertRow(null), 'POST-migration: market_standing=NULL still legal (unpriced/no-standing decisions unaffected)');

  // ===================================================================
  // NP1 -- an out-of-vocabulary value is still rejected after widening
  // ===================================================================
  await assertRejected(
    () => insertRow('TOTALLY_MADE_UP_VALUE'),
    'NP1: an arbitrary out-of-vocabulary market_standing is still rejected after the widen',
    'check constraint'
  );
  await assertRejected(
    () => insertRow('exact_current'),
    'NP2: lowercase \'exact_current\' is rejected -- vocabulary is exact-case, no normalization',
    'check constraint'
  );

  const rowCountBeforeRollback = (await client.query('SELECT count(*)::int AS n FROM buyer_decision_event')).rows[0].n;
  assertTrue(rowCountBeforeRollback === 7, `sanity: exactly 7 rows survived (6 values + 1 NULL), both rejected attempts counted zero -- actual: ${rowCountBeforeRollback}`);

  // ===================================================================
  // Rollback SAFETY -- the rollback's own precondition guard refuses when
  // offending (new-vocabulary) rows exist, rather than silently deleting
  // or rewriting them.
  // ===================================================================
  await assertRejected(
    () => client.query(qualify(read('0030_gk241_buyer_market_standing_check_widen_rollback.sql'))),
    'SAFETY: rollback REFUSES while FALLBACK_ONLY/NO_SOLD_EVIDENCE/NONE rows exist (does not silently delete/rewrite them)',
    'GK-241 rollback refused'
  );
  // Scoped to THIS scratch schema's own table OID -- an unqualified
  // conname match would also hit the real data1_dev.buyer_decision_event's
  // own same-named constraint, a false positive this test must not have.
  const stillGone = await client.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'buyer_decision_event_market_standing_check' AND conrelid = $1::regclass`,
    [`${SCHEMA}.buyer_decision_event`]
  );
  assertTrue(stillGone.rows.length === 1, 'the WIDE constraint is still in place after a refused rollback attempt -- the refused DO block ran before any DROP/ADD, so no partial rollback occurred');
  const rowsIntactAfterRefusal = (await client.query('SELECT count(*)::int AS n FROM buyer_decision_event')).rows[0].n;
  assertTrue(rowsIntactAfterRefusal === rowCountBeforeRollback, `no row was deleted or rewritten by the refused rollback attempt (before=${rowCountBeforeRollback}, after=${rowsIntactAfterRefusal})`);

  // Remove the offending rows (test cleanup, not the rollback's own job)
  // and prove the SAME rollback file now succeeds once none remain.
  await client.query(`DELETE FROM buyer_decision_event WHERE market_standing IN ('FALLBACK_ONLY', 'NO_SOLD_EVIDENCE', 'NONE')`);
  const rowCountAfterCleanup = (await client.query('SELECT count(*)::int AS n FROM buyer_decision_event')).rows[0].n;

  await assertScratchTarget(SCHEMA, 'pre-0030-rollback');
  await assertSucceeds(() => client.query(qualify(read('0030_gk241_buyer_market_standing_check_widen_rollback.sql'))), '0030 rollback succeeds once no offending rows remain');

  await assertRejected(
    () => insertRow('NO_SOLD_EVIDENCE'),
    'after rollback, the OLD narrow constraint is back in force -- NO_SOLD_EVIDENCE is rejected again',
    'check constraint'
  );
  const rowsIntactAfterRollback = (await client.query('SELECT count(*)::int AS n FROM buyer_decision_event')).rows[0].n;
  assertTrue(rowsIntactAfterRollback === rowCountAfterCleanup, `rollback altered only the constraint, not the surviving rows (before=${rowCountAfterCleanup}, after=${rowsIntactAfterRollback})`);

  // ===================================================================
  // Reapply symmetry
  // ===================================================================
  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(qualify(read('0030_gk241_buyer_market_standing_check_widen.sql'))), 'reapply of the same 0030 forward text succeeds cleanly after rollback');
  await assertSucceeds(() => insertRow('NO_SOLD_EVIDENCE'), 'after reapply, NO_SOLD_EVIDENCE inserts cleanly again');

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
