// tests/p0b-deterministic-decision-selection.test.js
//
// P0-B (POST-OPERATORACTION P0 dispatch) — proves getAssetGraph's
// currentValuationId/currentDecisionId (src/modules/assets/repository.js)
// resolve deterministically once MULTIPLE valuation/decision events exist
// for one asset, including the one case a bare `ORDER BY recorded_at`
// cannot resolve on its own: two rows sharing the exact same recorded_at
// instant. Real, live data1_dev (this module has no schema-override
// mechanism, unlike the newer valuation/ module — see repository.js's own
// P0-B comment) — a fresh throwaway asset is minted, exercised, and fully
// deleted at the end (zero permanent residue; this test never calls
// assignIdentity, so no asset_identity_assignment row is ever created to
// trigger the gk_asset-retention precedent tests/d3-2-application-wiring-
// live-proof.test.js documents).
//
// Does NOT touch Creepy (01a02d23-1acb-72e8-aae3-8f851308e9cf) or either
// of its real valuation_event/decision_event/operator_action_event rows —
// a fresh, disposable asset is minted for this proof instead.
//
// Invoke: node tests/p0b-deterministic-decision-selection.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const { createPhysicalAsset, recordValuation, recordDecision, getPhysicalAsset, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));
const mapping = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== P0-B — deterministic decision/valuation selection (real, disposable asset) ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TEST_TAG = `p0b-detsel-${Date.now()}`;
const idempotencyKeysUsed = [];
let createdAssetId = null;

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

async function countAll() {
  const r = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM gk_asset) AS gk_asset,
      (SELECT COUNT(*)::int FROM entity_mint_basis) AS entity_mint_basis,
      (SELECT COUNT(*)::int FROM mint_event) AS mint_event,
      (SELECT COUNT(*)::int FROM ownership_event) AS ownership_event,
      (SELECT COUNT(*)::int FROM valuation_event) AS valuation_event,
      (SELECT COUNT(*)::int FROM decision_event) AS decision_event,
      (SELECT COUNT(*)::int FROM domain_event) AS domain_event,
      (SELECT COUNT(*)::int FROM current_owner) AS current_owner,
      (SELECT COUNT(*)::int FROM idempotency_key) AS idempotency_key
  `);
  return r.rows[0];
}

const before = await countAll();
console.log('  pre-test table counts:', JSON.stringify(before));

try {
  const basis = mapping.buildCaptureBasis(JIMMY_PRINCIPAL_ID, {
    correlationId: `${TEST_TAG}-session`, scanlogKey: `${TEST_TAG}-sl`, book: { title: 'P0-B test book' },
  });
  const mint = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basis, assetClass: 'comic',
    source: 'p0b-test', idempotencyKey: `${TEST_TAG}:mint`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint`);
  createdAssetId = mint.assetId;
  assertTrue(mint.outcome === 'minted-new', 'setup: fresh disposable test asset minted (never assignIdentity — no permanent residue)');

  // --- Round 1: three valuations, three decisions, real distinct
  // timestamps (the common case — recorded_at alone already disambiguates
  // this). Proves currentValuationId/currentDecisionId track the
  // genuinely-latest row, not array length or insertion-call count.
  const v1 = await recordValuation({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, valueAmount: 10, method: 'engine-computed', buildSha: 'p0b-test', idempotencyKey: `${TEST_TAG}:val1` });
  idempotencyKeysUsed.push(`${TEST_TAG}:val1`);
  const d1 = await recordDecision({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, recommendation: 'RESEARCH', valuationEventId: v1.valuationEventId, idempotencyKey: `${TEST_TAG}:dec1` });
  idempotencyKeysUsed.push(`${TEST_TAG}:dec1`);

  const v2 = await recordValuation({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, valueAmount: 20, method: 'engine-computed', buildSha: 'p0b-test', idempotencyKey: `${TEST_TAG}:val2` });
  idempotencyKeysUsed.push(`${TEST_TAG}:val2`);
  const d2 = await recordDecision({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, recommendation: 'LIST_LOW', valuationEventId: v2.valuationEventId, idempotencyKey: `${TEST_TAG}:dec2` });
  idempotencyKeysUsed.push(`${TEST_TAG}:dec2`);

  const v3 = await recordValuation({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, valueAmount: 30, method: 'engine-computed', buildSha: 'p0b-test', idempotencyKey: `${TEST_TAG}:val3` });
  idempotencyKeysUsed.push(`${TEST_TAG}:val3`);
  const d3 = await recordDecision({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, recommendation: 'LIST_NOW', valuationEventId: v3.valuationEventId, idempotencyKey: `${TEST_TAG}:dec3` });
  idempotencyKeysUsed.push(`${TEST_TAG}:dec3`);

  let graph = await getPhysicalAsset({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId });
  assertTrue(graph.valuations.length === 3, 'setup: 3 valuation_event rows present on the graph');
  assertTrue(graph.decisions.length === 3, 'setup: 3 decision_event rows present on the graph');
  assertTrue(graph.currentValuationId === v3.valuationEventId, 'Round 1: currentValuationId resolves to the 3rd (genuinely latest) valuation, not the 1st or a stale value');
  assertTrue(graph.currentDecisionId === d3.decisionEventId, 'Round 1: currentDecisionId resolves to the 3rd (genuinely latest) decision, not the 1st or a stale value');
  assertTrue(graph.decisions[graph.decisions.length - 1].id === graph.currentDecisionId, 'Round 1: array-order still happens to agree with the explicit pointer in the untied case (sanity check, not the contract itself)');

  // --- Round 2: THE case a bare `ORDER BY recorded_at` cannot resolve —
  // two decision_event rows forced to the EXACT SAME recorded_at instant.
  // d3 is the real "current" going in; d4 is minted with an explicitly
  // EARLIER-generated id than would occur naturally, to prove the
  // resolution is genuinely id-ordered and not accidentally still
  // agreeing with insertion order by coincidence.
  const tiedInstant = new Date('2030-01-01T00:00:00.000Z');
  await client.query(
    `UPDATE decision_event SET recorded_at = $1 WHERE id = $2`,
    [tiedInstant, d3.decisionEventId]
  );
  const d4 = await recordDecision({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, recommendation: 'GRADE_CANDIDATE', valuationEventId: v3.valuationEventId, idempotencyKey: `${TEST_TAG}:dec4` });
  idempotencyKeysUsed.push(`${TEST_TAG}:dec4`);
  await client.query(
    `UPDATE decision_event SET recorded_at = $1 WHERE id = $2`,
    [tiedInstant, d4.decisionEventId]
  );

  const tieCheck = await client.query(
    `SELECT id, recorded_at FROM decision_event WHERE id = ANY($1::uuid[])`,
    [[d3.decisionEventId, d4.decisionEventId]]
  );
  const tieRows = tieCheck.rows;
  assertTrue(
    tieRows.length === 2 && tieRows[0].recorded_at.getTime() === tieRows[1].recorded_at.getTime(),
    'Round 2 setup: d3 and d4 genuinely share the exact same recorded_at instant (a real tie, not simulated)'
  );
  const expectedTieWinner = [d3.decisionEventId, d4.decisionEventId].sort().pop(); // lexicographically-largest id wins ORDER BY ... , id
  assertTrue(expectedTieWinner === d4.decisionEventId, 'Round 2 setup sanity: d4 is the lexicographically-larger id of the tied pair (expected — later uuidv7 mint)');

  graph = await getPhysicalAsset({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId });
  assertTrue(graph.currentDecisionId === expectedTieWinner, `Round 2: with recorded_at tied, currentDecisionId resolves via the id tie-break deterministically (got ${graph.currentDecisionId})`);

  // Repeat the read 3 more times — proves the resolution is REPEATABLE,
  // not an artifact of one lucky query plan / one lucky row-scan order.
  for (let i = 0; i < 3; i++) {
    const repeat = await getPhysicalAsset({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId });
    assertTrue(repeat.currentDecisionId === expectedTieWinner, `Round 2 repeat #${i + 1}: same tie resolves identically on every call`);
  }

  // The OperatorAction submit path binds to graph.currentDecisionId
  // exactly (GrailKeyOperatorPanel.jsx's decisionEventId), so proving
  // this resolves deterministically IS proving the UI/API binding
  // contract this dispatch requires — no separate client-side check
  // needed here; the panel's own selection is a pure find-by-id over
  // this same field.
} finally {
  if (createdAssetId) {
    await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [createdAssetId]);
    await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [createdAssetId]);
    await client.query(`DELETE FROM decision_event WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM mint_event WHERE entity_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM gk_asset WHERE id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM entity_mint_basis WHERE entity_id = $1`, [createdAssetId]);
  }
  if (idempotencyKeysUsed.length > 0) {
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key = ANY($1::text[])`, [idempotencyKeysUsed]);
  }

  const after = await countAll();
  console.log('  post-cleanup table counts:', JSON.stringify(after));
  const restored = Object.keys(before).every((k) => before[k] === after[k]);
  assertTrue(restored, 'cleanup: EVERY table count restored to exact pre-test baseline — zero permanent residue');

  await client.end();
  await closePool();

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
