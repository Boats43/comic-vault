// tests/buyer-decision-ledger-migration-contract.test.js
//
// GRAILKEY — DURABLE BUYER DECISION LEDGER V1. Real, isolated
// scratch-schema proof of db/data0/0027_buyer_decision_ledger.sql, via
// scripts/db-admin-preflight.mjs's assertScratchSchemaTarget() — the
// environment-hygiene-corrected (2026-09-20) successor to the D5B/D5C/D5D
// series' own ad hoc, independently-duplicated "assertScratchTarget"
// (dedicated backend PID pin + SAFETY ABORT on data1_dev), now ALSO
// independently verifying current_database() up front, closing the gap
// that let GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED's real-then-fixed
// "bookforge" misconfiguration go undetected by every one of those prior
// copies. data1_dev is never touched by this test.
//
// Proves: 0027 applies cleanly on top of minimal gk_principal/gk_asset
// stubs; PK/FK/CHECK/NOT NULL/unique-index constraints all enforce as
// designed; BUY and PASS are stored with identical fidelity (no
// PASS-specific data loss); buyer_acquisition_event never requires or
// mutates any buyer_decision_event column; the idempotency unique index
// rejects a duplicate (namespace, key) pair; rollback drops exactly the
// two new tables and nothing else, and a reapply after rollback succeeds
// cleanly.
//
// Invoke: node tests/buyer-decision-ledger-migration-contract.test.js

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

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);

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
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 110)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== Buyer Decision Ledger (0027) — migration contract (real, isolated scratch-schema proof) ===\n');

// GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED was independently found and
// fixed this same pass (was resolving to an unrelated "bookforge"
// database, corrected to the real Neon project's direct-connect
// endpoint — see docs/TICKET-REGISTRY.md, environment-hygiene entry).
// assertScratchSchemaTarget() re-verifies current_database() itself
// before returning a client, so this is now fail-closed regardless of
// whether that env value ever drifts again.
const { client, sessionPid } = await assertScratchSchemaTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED,
  label: 'buyer-decision-ledger-migration-contract',
});
console.log('  dedicated unpooled backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev — refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

{
  await client.query('SET search_path TO data1_dev');
  let refused = false;
  try { await assertScratchTarget('some-scratch-schema', 'negative proof'); }
  catch (e) { refused = /SAFETY ABORT/.test(e.message) && /data1_dev/.test(e.message); }
  assertTrue(refused, 'D0: intentionally pointing this client at data1_dev causes the guard to refuse before any DDL');
}

const SCHEMA = `buyer_decision_0027_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

let principalId, assetId, decisionId;

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);

  await assertScratchTarget(SCHEMA, 'pre-0027-apply');
  await assertSucceeds(() => client.query(qualify(read('0027_buyer_decision_ledger.sql'))), '0027 forward text applies cleanly on top of gk_principal/gk_asset stubs');

  principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);
  assetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);

  const baseDecisionFields = () => ({
    id: crypto.randomUUID(),
    marketValue: 100, fee: 10, supplies: 3, labor: 5, target: 25, maxBuy: 57, netProfit: 12,
  });

  // ===================================================================
  // FK / NOT NULL enforcement
  // ===================================================================
  console.log('\n-- FK / NOT NULL enforcement --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO buyer_decision_event (id, principal_id, session_id, market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, decision, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, $3, 100, 45, 10, 3, 5, 25, 'BUY', $2, 'buyer-decision-sync', $4)`,
      [crypto.randomUUID(), crypto.randomUUID() /* nonexistent principal */, crypto.randomUUID(), crypto.randomUUID()]
    ),
    'buyer_decision_event referencing a nonexistent principal_id is rejected', 'foreign key'
  );

  await assertRejected(
    () => client.query(
      `INSERT INTO buyer_decision_event (id, principal_id, session_id, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, decision, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, $3, 45, 10, 3, 5, 25, 'BUY', $2, 'buyer-decision-sync', $4)`,
      [crypto.randomUUID(), principalId, crypto.randomUUID(), crypto.randomUUID()]
      // market_value_amount omitted entirely
    ),
    'buyer_decision_event missing market_value_amount (NOT NULL) is rejected', 'null value'
  );

  await assertRejected(
    () => client.query(
      `INSERT INTO buyer_decision_event (id, principal_id, session_id, market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, decision, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, $3, 100, 45, 10, 3, 5, 25, 'MAYBE', $2, 'buyer-decision-sync', $4)`,
      [crypto.randomUUID(), principalId, crypto.randomUUID(), crypto.randomUUID()]
    ),
    'buyer_decision_event with decision NOT IN (BUY, PASS) is rejected by CHECK constraint', 'check constraint'
  );

  await assertRejected(
    () => client.query(
      `INSERT INTO buyer_decision_event (id, principal_id, session_id, market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, decision, market_standing, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, $3, 100, 45, 10, 3, 5, 25, 'BUY', 'APPROXIMATELY_CURRENT', $2, 'buyer-decision-sync', $4)`,
      [crypto.randomUUID(), principalId, crypto.randomUUID(), crypto.randomUUID()]
    ),
    'buyer_decision_event with an invalid market_standing value is rejected by CHECK constraint', 'check constraint'
  );

  // ===================================================================
  // BUY and PASS are stored with identical fidelity
  // ===================================================================
  console.log('\n-- BUY and PASS durability parity --\n');

  const buyId = crypto.randomUUID();
  const buySessionId = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO buyer_decision_event (
         id, principal_id, session_id, observed_title, observed_issue, observed_publisher, observed_year, observed_variant, observed_grade,
         market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, max_buy_amount, net_profit_amount,
         decision, pricing_source, price_bands_source, market_standing, sold_comp_count, active_comp_count, total_comp_count, verified_comp_count,
         match_confidence_tier, match_confidence_score, recorded_by_principal_id, idempotency_namespace, idempotency_key
       ) VALUES (
         $1, $2, $3, 'Amazing Spider-Man', '300', 'Marvel', '1988', NULL, 'CGC 9.4',
         100, 45, 10, 3, 5, 25, 57, 12,
         'BUY', 'verified_sold_recency', 'tier1_recency_weighted', 'EXACT_CURRENT', 16, 4, 16, NULL,
         'HIGH', 82.5, $2, 'buyer-decision-sync', $4
       )`,
      [buyId, principalId, buySessionId, crypto.randomUUID()]
    ),
    'BUY row with full provenance inserts cleanly'
  );

  const passId = crypto.randomUUID();
  const passSessionId = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO buyer_decision_event (
         id, principal_id, session_id, observed_title, observed_issue, observed_publisher, observed_year, observed_variant, observed_grade,
         market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, max_buy_amount, net_profit_amount,
         decision, pricing_source, price_bands_source, market_standing, sold_comp_count, active_comp_count, total_comp_count, verified_comp_count,
         match_confidence_tier, match_confidence_score, recorded_by_principal_id, idempotency_namespace, idempotency_key
       ) VALUES (
         $1, $2, $3, 'Incredible Hulk', '273', 'Marvel', '1982', NULL, 'raw VF',
         69, 60, 10, 2, 4, 20, 44, -20,
         'PASS', 'active_ask_derived', 'tier3_active_discounted', 'SIMILAR_ONLY', 0, 1, 1, NULL,
         'LOW', 40, $2, 'buyer-decision-sync', $4
       )`,
      [passId, principalId, passSessionId, crypto.randomUUID()]
    ),
    'PASS row (MAX BUY $44 < seller ask $60) inserts cleanly with the SAME field set as a BUY row'
  );
  decisionId = buyId;

  const rows = (await client.query(
    `SELECT decision, max_buy_amount, contemplated_price_amount, market_standing, total_comp_count, verified_comp_count
     FROM buyer_decision_event WHERE id IN ($1, $2) ORDER BY decision`,
    [buyId, passId]
  )).rows;
  const buyRow = rows.find(r => r.decision === 'BUY');
  const passRow = rows.find(r => r.decision === 'PASS');
  assertTrue(!!buyRow && !!passRow, 'both BUY and PASS rows are independently retrievable — neither discarded nor merged');
  assertTrue(Number(passRow.max_buy_amount) === 44 && Number(passRow.contemplated_price_amount) === 60, 'PASS row preserves MAX BUY ($44) and seller ask ($60) exactly, same as the directive\'s own worked example');
  assertTrue(passRow.market_standing === 'SIMILAR_ONLY', 'PASS row preserves its own market_standing provenance value');
  assertTrue(passRow.verified_comp_count === null, 'verified_comp_count is NULL (UNKNOWN), never fabricated as 0, on a PASS row exactly as on a BUY row');
  assertTrue(buyRow.verified_comp_count === null, 'verified_comp_count is NULL (UNKNOWN), never fabricated, on the BUY row too — no field this pricing system cannot supply is invented');

  // ===================================================================
  // Idempotency unique index
  // ===================================================================
  console.log('\n-- Idempotency (namespace, key) uniqueness --\n');

  const dupKey = crypto.randomUUID();
  await client.query(
    `INSERT INTO buyer_decision_event (id, principal_id, session_id, market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, decision, recorded_by_principal_id, idempotency_namespace, idempotency_key)
     VALUES ($1, $2, $3, 10, 5, 10, 1, 1, 1, 'PASS', $2, 'buyer-decision-sync', $4)`,
    [crypto.randomUUID(), principalId, crypto.randomUUID(), dupKey]
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO buyer_decision_event (id, principal_id, session_id, market_value_amount, contemplated_price_amount, fee_pct, supplies_amount, labor_amount, target_profit_amount, decision, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, $3, 20, 8, 10, 1, 1, 1, 'BUY', $2, 'buyer-decision-sync', $4)`,
      [crypto.randomUUID(), principalId, crypto.randomUUID(), dupKey]
    ),
    'a second row with the SAME (idempotency_namespace, idempotency_key) is rejected at the DB level (unique index)', 'duplicate key'
  );

  // ===================================================================
  // buyer_acquisition_event — separate table, never a decision-row mutation
  // ===================================================================
  console.log('\n-- buyer_acquisition_event: separate, non-mutating fact --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO buyer_acquisition_event (id, buyer_decision_event_id, actual_purchase_price_amount, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 42, $3, 'buyer-acquisition-sync', $4)`,
      [crypto.randomUUID(), crypto.randomUUID() /* nonexistent decision */, principalId, crypto.randomUUID()]
    ),
    'buyer_acquisition_event referencing a nonexistent buyer_decision_event_id is rejected', 'foreign key'
  );

  const beforeDecisionRow = (await client.query('SELECT * FROM buyer_decision_event WHERE id = $1', [buyId])).rows[0];
  await assertSucceeds(
    () => client.query(
      `INSERT INTO buyer_acquisition_event (id, buyer_decision_event_id, actual_purchase_price_amount, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 42, $3, 'buyer-acquisition-sync', $4)`,
      [crypto.randomUUID(), buyId, principalId, crypto.randomUUID()]
    ),
    'a real buyer_acquisition_event ($42 actual, vs. $45 originally contemplated) inserts cleanly, referencing the real BUY decision'
  );
  const afterDecisionRow = (await client.query('SELECT * FROM buyer_decision_event WHERE id = $1', [buyId])).rows[0];
  assertTrue(
    JSON.stringify(beforeDecisionRow) === JSON.stringify(afterDecisionRow),
    'recording an acquisition leaves EVERY column of the original buyer_decision_event row byte-identical — max_buy_amount, contemplated_price_amount, decision, all provenance columns, all untouched'
  );
  assertTrue(Number(beforeDecisionRow.contemplated_price_amount) === 45, 'the original contemplated price ($45) remains the original contemplated price after a $42 actual purchase is recorded — never overwritten');

  // A second, later acquisition row (e.g. a correction) is legal — itself
  // just another appended row, never an edit of the first.
  await assertSucceeds(
    () => client.query(
      `INSERT INTO buyer_acquisition_event (id, buyer_decision_event_id, actual_purchase_price_amount, recorded_by_principal_id, idempotency_namespace, idempotency_key)
       VALUES ($1, $2, 40, $3, 'buyer-acquisition-sync', $4)`,
      [crypto.randomUUID(), buyId, principalId, crypto.randomUUID()]
    ),
    'a second, distinct buyer_acquisition_event for the same decision (a correction) is legal — appended, not an edit'
  );
  const acqCount = (await client.query('SELECT count(*)::int AS n FROM buyer_acquisition_event WHERE buyer_decision_event_id = $1', [buyId])).rows[0].n;
  assertTrue(acqCount === 2, `both acquisition facts persist independently (found ${acqCount}, expected 2) — neither overwrote the other`);

  // A PASS decision requires NO acquisition event to remain fully
  // queryable and durable.
  const passStillThere = (await client.query('SELECT decision, max_buy_amount FROM buyer_decision_event WHERE id = $1', [passId])).rows[0];
  assertTrue(passStillThere.decision === 'PASS' && Number(passStillThere.max_buy_amount) === 44, 'the PASS decision remains fully durable and queryable with zero buyer_acquisition_event rows — none required or expected');

  // ===================================================================
  // Structural column-set proof: buyer_acquisition_event cannot express
  // any of the original decision's economics — it is structurally
  // incapable of mutating them, not merely disciplined not to.
  // ===================================================================
  const acqCols = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'buyer_acquisition_event'`,
    [SCHEMA]
  )).rows.map(r => r.column_name);
  const forbidden = ['market_value_amount', 'max_buy_amount', 'contemplated_price_amount', 'decision', 'fee_pct', 'supplies_amount', 'labor_amount', 'target_profit_amount', 'pricing_source'];
  const leaked = forbidden.filter(c => acqCols.includes(c));
  assertTrue(leaked.length === 0, `buyer_acquisition_event has NO column overlapping the decision's own economics/valuation fields (checked: ${forbidden.join(', ')})`);

  // ===================================================================
  // Rollback / reapply
  // ===================================================================
  console.log('\n-- Rollback / reapply --\n');

  await assertScratchTarget(SCHEMA, 'pre-0027-rollback');
  await assertSucceeds(() => client.query(qualify(read('0027_buyer_decision_ledger_rollback.sql'))), '0027 rollback applies successfully');

  const decisionTableGone = await client.query(`SELECT to_regclass('${SCHEMA}.buyer_decision_event') AS t`);
  const acquisitionTableGone = await client.query(`SELECT to_regclass('${SCHEMA}.buyer_acquisition_event') AS t`);
  assertTrue(decisionTableGone.rows[0].t === null, 'buyer_decision_event no longer exists after rollback');
  assertTrue(acquisitionTableGone.rows[0].t === null, 'buyer_acquisition_event no longer exists after rollback');

  const principalRowsIntact = (await client.query('SELECT count(*)::int AS n FROM gk_principal')).rows[0].n;
  assertTrue(principalRowsIntact === 1, `gk_principal rows (unrelated to 0027) survive rollback untouched (found ${principalRowsIntact}, expected 1)`);

  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(qualify(read('0027_buyer_decision_ledger.sql'))), 'reapply of the same 0027 forward text succeeds cleanly after rollback');
  const reapplyCount = (await client.query('SELECT count(*)::int AS n FROM buyer_decision_event')).rows[0].n;
  assertTrue(reapplyCount === 0, 'reapplied buyer_decision_event table is empty');

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped — data1_dev untouched throughout`);
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
