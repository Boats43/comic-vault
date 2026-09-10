// tests/outcome1-recordvaluation-idempotency-live-proof.test.js
//
// Outcome #1 — real, live proof (real data1_dev) that adding
// marketPopulationId to recordValuation's GK-163 request fingerprint
// (src/modules/assets/service.js) behaves correctly under the SAME
// class-wide idempotency law already proven elsewhere in this repo:
//   - same idempotencyKey + same marketPopulationId -> replay, zero
//     duplicate row.
//   - same idempotencyKey + a DIFFERENT marketPopulationId -> throws
//     IdempotencyConflictError, per GK-163's own law ("same key +
//     different payload throws"), never a silent wrong-answer replay.
//
// References Chain #1's own already-committed, real, permanent
// market_population row (ced6a0b1-f5cb-4b5f-a449-786da65bc7d2,
// D5D Chain #1, 2026-09-09) as the REAL evidence basis — read-only,
// never mutated. A second real market_population id is minted fresh
// via the isolated D5D writer module for the "different evidence"
// half of the proof, then both are left exactly as this test found
// them (this test creates and cleans up only its OWN valuation_event/
// decision_event/idempotency_key rows).
//
// Invoke: node tests/outcome1-recordvaluation-idempotency-live-proof.test.js

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

const { recordValuation, IdempotencyConflictError, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Outcome #1 -- recordValuation marketPopulationId idempotency, real data1_dev live proof ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN1_POPULATION_ID = 'ced6a0b1-f5cb-4b5f-a449-786da65bc7d2';
const TEST_TAG = `outcome1-idem-${Date.now()}`;

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

async function countAll() {
  const r = await client.query(`SELECT COUNT(*)::int AS c FROM valuation_event WHERE asset_id = $1`, [CREEPY_ASSET_ID]);
  return r.rows[0].c;
}

const before = await countAll();
const createdValuationEventIds = [];

try {
  console.log('-- same idempotencyKey + same marketPopulationId -> replay, zero duplicate row --\n');
  const key1 = `${TEST_TAG}:same`;
  const r1 = await recordValuation({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, valueAmount: 61.41, method: 'engine-computed',
    marketPopulationId: CHAIN1_POPULATION_ID, buildSha: TEST_TAG, idempotencyKey: key1,
  });
  createdValuationEventIds.push(r1.valuationEventId);
  const r2 = await recordValuation({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, valueAmount: 61.41, method: 'engine-computed',
    marketPopulationId: CHAIN1_POPULATION_ID, buildSha: TEST_TAG, idempotencyKey: key1,
  });
  assertTrue(r1.valuationEventId === r2.valuationEventId, 'identical (key, marketPopulationId) replays the SAME valuationEventId, not a new one');
  const afterSame = await countAll();
  assertTrue(afterSame === before + 1, 'exactly one new valuation_event row exists after two identical calls (no duplicate)');

  console.log('\n-- same idempotencyKey + DIFFERENT marketPopulationId -> IdempotencyConflictError, never a silent replay --\n');
  const key2 = `${TEST_TAG}:conflict`;
  const r3 = await recordValuation({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, valueAmount: 61.41, method: 'engine-computed',
    marketPopulationId: CHAIN1_POPULATION_ID, buildSha: TEST_TAG, idempotencyKey: key2,
  });
  createdValuationEventIds.push(r3.valuationEventId);
  let conflictThrown = false, isRightErrorClass = false;
  try {
    await recordValuation({
      principalId: JIMMY_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, valueAmount: 61.41, method: 'engine-computed',
      marketPopulationId: null, // DIFFERENT evidence basis, same key -- must conflict, not replay
      buildSha: TEST_TAG, idempotencyKey: key2,
    });
  } catch (e) {
    conflictThrown = true;
    isRightErrorClass = e instanceof IdempotencyConflictError;
  }
  assertTrue(conflictThrown, 'a different marketPopulationId under the same idempotencyKey throws, does not silently succeed');
  assertTrue(isRightErrorClass, 'the thrown error is the real IdempotencyConflictError class, not a generic/raw DB error');
  const afterConflict = await countAll();
  assertTrue(afterConflict === before + 2, 'the rejected conflicting call created NO row (only the first key2 call + the key1 call exist)');
} finally {
  if (createdValuationEventIds.length > 0) {
    await client.query(`DELETE FROM valuation_event WHERE id = ANY($1::uuid[])`, [createdValuationEventIds]);
  }
  await client.query(`DELETE FROM idempotency_key WHERE operation = 'recordValuation' AND idempotency_key LIKE $1`, [`${TEST_TAG}:%`]);
  const after = await countAll();
  console.log(`\n  cleanup: valuation_event count restored to baseline (${before} -> ${after})`);
  await client.end();
  await closePool();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
