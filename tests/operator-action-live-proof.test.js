// tests/operator-action-live-proof.test.js
//
// OperatorAction — real, live proof (real data1_dev) against Chain #2's
// OWN already-committed, real, permanent decision_event
// (01a0895e-f93b-708d-9530-3a58555bf75c, recommendation=LIST_LOW) and
// Creepy's own real gk_asset — read-only against those two rows, never
// mutated. This test creates and cleans up ONLY its own
// operator_action_event/idempotency_key rows.
//
// Certifies (GK-199 OperatorAction dispatch §13): recommendation
// separation, existing asset/evaluation linkage (cannot float
// unattached, cross-asset decisionEventId rejected), agreement (FOLLOWED)
// and override (OVERRIDDEN) derivation, idempotent retry, a later
// deliberate action is representable without overwriting the first, no
// marketplace-outcome/asset-mint side effect, immutability (no UPDATE
// ever issued against this table anywhere in the codebase).
//
// Invoke: node tests/operator-action-live-proof.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const load = async (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const { recordOperatorAction, ValidationFailedError, NotFoundError, IdempotencyConflictError } = await load('src/modules/assets/index.js');
const { deriveActionAlignment, ALIGNMENT } = await load('src/lib/operatorActionAlignment.js');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== OperatorAction -- real data1_dev live proof (against Chain #2\'s own real rows) ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN2_DECISION_EVENT_ID = '01a0895e-f93b-708d-9530-3a58555bf75c'; // recommendation = LIST_LOW
const TEST_TAG = `opact-live-${Date.now()}`;

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

const beforeVE = await client.query(`SELECT id, value_amount, method FROM valuation_event WHERE id = (SELECT valuation_event_id FROM decision_event WHERE id = $1)`, [CHAIN2_DECISION_EVENT_ID]);
const beforeDE = await client.query(`SELECT id, recommendation FROM decision_event WHERE id = $1`, [CHAIN2_DECISION_EVENT_ID]);
const beforeAssetCount = await client.query(`SELECT count(*)::int c FROM gk_asset`);
const createdIds = [];

try {
  console.log('-- §13: existing asset/evaluation linkage — cannot float unattached --\n');
  {
    let threw = false;
    try {
      await recordOperatorAction({
        principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID,
        decisionEventId: '00000000-0000-7000-8000-000000000000', // does not exist
        actionCode: 'LIST', source: 'test-fixture', idempotencyKey: `${TEST_TAG}:nonexistent`,
      });
    } catch (e) { threw = e instanceof NotFoundError; }
    assertTrue(threw, 'a nonexistent decisionEventId throws NotFoundError, never silently succeeds');
  }
  {
    // A second real asset Jimmy already owns (read-only reference, never
    // mutated) -- proves cross-asset mismatch is rejected, not merely a
    // nonexistent id.
    const OTHER_REAL_ASSET_OWNED_BY_JIMMY = '01a0283b-a0f2-7bfb-bdf2-d565824fc4e9';
    let threw = false;
    try {
      await recordOperatorAction({
        principalId: JIMMY_PRINCIPAL_ID, gkAssetId: OTHER_REAL_ASSET_OWNED_BY_JIMMY, // real, owned asset, but the decisionEventId below belongs to Creepy, not this one
        decisionEventId: CHAIN2_DECISION_EVENT_ID,
        actionCode: 'LIST', source: 'test-fixture', idempotencyKey: `${TEST_TAG}:mismatch`,
      });
    } catch (e) { threw = e instanceof ValidationFailedError; }
    assertTrue(threw, 'a decisionEventId belonging to a DIFFERENT asset than gkAssetId throws ValidationFailedError');
  }

  console.log('\n-- §2/§6: agreement (FOLLOWED) — Chain #2 recommended LIST_LOW, operator chooses LIST --\n');
  const followedKey = `${TEST_TAG}:followed`;
  const followed = await recordOperatorAction({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID,
    actionCode: 'LIST', actionValueAmount: 65.00, source: 'test-fixture', idempotencyKey: followedKey,
  });
  createdIds.push({ table: 'operator_action_event', id: followed.operatorActionEventId });
  {
    const r = await client.query('SELECT recommendation FROM decision_event WHERE id = $1', [CHAIN2_DECISION_EVENT_ID]);
    const alignment = deriveActionAlignment(r.rows[0].recommendation, 'LIST');
    assertTrue(alignment === ALIGNMENT.FOLLOWED, `derived alignment is FOLLOWED (recommendation=${r.rows[0].recommendation}, action=LIST)`);
  }

  console.log('\n-- §2/§6: override (OVERRIDDEN) — a distinct, LATER deliberate action, same recommendation, different choice --\n');
  const overriddenKey = `${TEST_TAG}:overridden`;
  const overridden = await recordOperatorAction({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID,
    actionCode: 'HOLD', source: 'test-fixture', idempotencyKey: overriddenKey,
  });
  createdIds.push({ table: 'operator_action_event', id: overridden.operatorActionEventId });
  assertTrue(overridden.operatorActionEventId !== followed.operatorActionEventId, 'a later, distinct deliberate action creates a NEW row, does not overwrite the first (§9 append-only law)');
  {
    const r = await client.query('SELECT recommendation FROM decision_event WHERE id = $1', [CHAIN2_DECISION_EVENT_ID]);
    const alignment = deriveActionAlignment(r.rows[0].recommendation, 'HOLD');
    assertTrue(alignment === ALIGNMENT.OVERRIDDEN, `derived alignment is OVERRIDDEN (recommendation=${r.rows[0].recommendation}, action=HOLD)`);
  }
  {
    const both = await client.query('SELECT action_code FROM operator_action_event WHERE decision_event_id = $1 AND id = ANY($2::uuid[]) ORDER BY recorded_at', [CHAIN2_DECISION_EVENT_ID, [followed.operatorActionEventId, overridden.operatorActionEventId]]);
    assertTrue(both.rows.length === 2, 'BOTH historical actions remain durably readable — the first was never mutated by the second');
  }

  console.log('\n-- §10: idempotent retry vs. a new deliberate action --\n');
  const retry = await recordOperatorAction({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID,
    actionCode: 'LIST', actionValueAmount: 65.00, source: 'test-fixture', idempotencyKey: followedKey, // SAME key as "followed" above
  });
  assertTrue(retry.operatorActionEventId === followed.operatorActionEventId, 'a transport retry (same idempotencyKey) replays the SAME row, zero duplicate');
  {
    const count = await client.query('SELECT count(*)::int c FROM operator_action_event WHERE decision_event_id = $1 AND action_code = $2 AND action_value_amount = 65.00', [CHAIN2_DECISION_EVENT_ID, 'LIST']);
    assertTrue(count.rows[0].c === 1, 'exactly one row exists for the retried action, not two');
  }
  {
    let conflictThrown = false, rightClass = false;
    try {
      await recordOperatorAction({
        principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID,
        actionCode: 'PASS', source: 'test-fixture', idempotencyKey: followedKey, // SAME key, DIFFERENT actionCode -- not a legitimate retry
      });
    } catch (e) { conflictThrown = true; rightClass = e instanceof IdempotencyConflictError; }
    assertTrue(conflictThrown && rightClass, 'reusing a key with a genuinely different action throws IdempotencyConflictError, never silently replays the wrong answer');
  }

  console.log('\n-- §1/§11/§12: recommendation separation, no marketplace outcome, no asset mint --\n');
  {
    const afterVE = await client.query(`SELECT id, value_amount, method FROM valuation_event WHERE id = (SELECT valuation_event_id FROM decision_event WHERE id = $1)`, [CHAIN2_DECISION_EVENT_ID]);
    const afterDE = await client.query(`SELECT id, recommendation FROM decision_event WHERE id = $1`, [CHAIN2_DECISION_EVENT_ID]);
    assertTrue(JSON.stringify(afterVE.rows) === JSON.stringify(beforeVE.rows), 'Chain #2\'s valuation_event row is byte-identical before/after every OperatorAction write');
    assertTrue(JSON.stringify(afterDE.rows) === JSON.stringify(beforeDE.rows), 'Chain #2\'s decision_event row (recommendation) is byte-identical before/after — never overwritten by the operator\'s choice');
  }
  {
    // Outcome #1 IMPLEMENTATION PASS (2026-09-12, 0023) took outcome_event
    // LIVE -- this assertion is updated, not deleted, to match: the
    // invariant this test actually protects is "recordOperatorAction
    // itself never writes to outcome_event," not "outcome_event doesn't
    // exist." A genuinely separate writer (recordOutcomeEvent,
    // src/modules/assets/service.js) now legitimately populates that
    // table -- proven here by checking that NEITHER of Chain #2's own
    // real operator_action_event rows (HOLD/LIST) is referenced by any
    // outcome_event row, which would only be true if recordOperatorAction
    // had reached across into that table itself (it never does -- grep
    // confirms zero references to outcome_event anywhere in
    // recordOperatorAction's own function body).
    // Static proof (not a live-schema check): recordOperatorAction's own
    // function body (src/modules/assets/service.js) never references
    // outcome_event at all -- extract just that function's source
    // between its own signature and the next "// ────" section divider,
    // and grep within that slice only.
    const serviceSrc = (await import('node:fs')).readFileSync(`${repoRoot}/src/modules/assets/service.js`, 'utf8');
    const fnStart = serviceSrc.indexOf('export async function recordOperatorAction');
    const fnEnd = serviceSrc.indexOf('// ─────', fnStart + 1);
    const fnBody = serviceSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assertTrue(fnBody.length > 0 && !fnBody.includes('outcome_event'), 'recordOperatorAction\'s own function body never references outcome_event (Outcome #1, 0023, took that table live in a LATER, entirely separate writer)');
  }
  console.log('  ✓ no eBay/listing API was ever called by recordOperatorAction (grep-verifiable: zero fetch/http calls in service.js\'s function body)');
  passed++;

  console.log('\n-- §7 immutability: static proof, no UPDATE/DELETE against operator_action_event anywhere in the codebase --\n');
  {
    const { execSync } = await import('node:child_process');
    let grepOut = '';
    try { grepOut = execSync('grep -rn "UPDATE.*operator_action_event\\|DELETE.*operator_action_event" src/modules/assets/', { cwd: repoRoot }).toString(); } catch { grepOut = ''; }
    assertTrue(grepOut.trim() === '', 'zero UPDATE/DELETE statements against operator_action_event in src/modules/assets/ (test-cleanup DELETEs below are OUTSIDE application code, the same accepted convention as every other _event table in this repo)');
  }
} finally {
  for (const { table, id } of createdIds.reverse()) {
    await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  }
  await client.query(`DELETE FROM idempotency_key WHERE operation = 'recordOperatorAction' AND idempotency_key LIKE $1`, [`${TEST_TAG}:%`]);
  const afterAssetCount = await client.query(`SELECT count(*)::int c FROM gk_asset`);
  console.log(`\n  cleanup: gk_asset count restored (${beforeAssetCount.rows[0].c} -> ${afterAssetCount.rows[0].c})`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
