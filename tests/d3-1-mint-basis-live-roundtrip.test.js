// tests/d3-1-mint-basis-live-roundtrip.test.js
//
// D3.1 — real, live round-trip against data1_dev proving the
// candidate-safe mint basis actually prevents/allows collision through
// the REAL mint mechanism (repository.js's mintAsset, entity_mint_basis's
// live UNIQUE (basis_namespace, basis_key) constraint) — not just pure-
// function determinism (see tests/d3-1-candidate-safe-mint-basis.test.js
// for that half). Uses the real principal (Jimmy) already live in
// data1_dev; creates a small number of real rows under a clearly-marked
// test correlationId, verifies the three required behaviors, then
// deletes exactly what it created and re-verifies table counts return to
// their pre-test baseline — this repo's own D2.3 orphan-reconciler pass
// already found and flagged leftover fixture rows from earlier ad-hoc
// test scripts as a contamination-risk signal; this file does not add to
// that pattern.
//
// Requires GRAILKEY_CATALOG_DATABASE_URL — loaded here from
// .env.development.local (this module does not read .env files itself;
// see src/modules/assets/db.js's own header comment).
//
// Invoke: node tests/d3-1-mint-basis-live-roundtrip.test.js

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

const { createPhysicalAsset, closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));
const { buildCaptureBasis } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D3.1 — candidate-safe mint basis (real data1_dev round-trip) ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba'; // real, live gk_principal row (confirmed this dispatch)
const TEST_TAG = `d3-1-roundtrip-${Date.now()}`;
const createdAssetIds = [];
const createdBasisIds = [];
const idempotencyKeysUsed = [];

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
      (SELECT COUNT(*)::int FROM domain_event) AS domain_event,
      (SELECT COUNT(*)::int FROM current_owner) AS current_owner,
      (SELECT COUNT(*)::int FROM outbox) AS outbox,
      (SELECT COUNT(*)::int FROM idempotency_key) AS idempotency_key
  `);
  return r.rows[0];
}

const before = await countAll();
console.log('  pre-test table counts:', JSON.stringify(before));

try {

  // --- Requirement A: same observation + same discriminator -> deterministic
  // replay through the REAL mint mechanism (second call resolves to the
  // SAME assetId, outcome='resolved-existing'). Two distinct idempotencyKeys
  // deliberately used so it's entity_mint_basis's own UNIQUE constraint being
  // proven here, not the idempotency_key replay layer. ---
  const scanPayloadA = { correlationId: `${TEST_TAG}-session`, scanlogKey: `${TEST_TAG}-scanlog`, book: { title: 'Test Book A' } };
  const basisA = buildCaptureBasis(JIMMY_PRINCIPAL_ID, scanPayloadA, 0);

  const mint1 = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basisA, assetClass: 'comic',
    source: 'd3-1-test', idempotencyKey: `${TEST_TAG}:mint1`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint1`);
  createdAssetIds.push(mint1.assetId);
  createdBasisIds.push(mint1.basisId);
  assertTrue(mint1.outcome === 'minted-new', `A: first mint of discriminator=0 -> minted-new (got ${mint1.outcome})`);

  const mint2 = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basisA, assetClass: 'comic',
    source: 'd3-1-test', idempotencyKey: `${TEST_TAG}:mint2`, // different idempotency key on purpose
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint2`);
  assertTrue(mint2.outcome === 'resolved-existing', `A: same observation + same discriminator(0), different idempotencyKey -> resolved-existing (got ${mint2.outcome})`);
  assertTrue(mint2.assetId === mint1.assetId, 'A: replay resolves to the SAME real gk_asset.id as the first mint');
  if (mint2.assetId !== mint1.assetId) createdAssetIds.push(mint2.assetId); // safety net for cleanup if this ever fails

  // --- Requirement B: same observation + DIFFERENT discriminator -> a
  // genuinely distinct gk_asset, not a collision onto candidate 0's asset. ---
  const basisB = buildCaptureBasis(JIMMY_PRINCIPAL_ID, scanPayloadA, 1); // same scanPayloadA (same session), discriminator=1
  const mint3 = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basisB, assetClass: 'comic',
    source: 'd3-1-test', idempotencyKey: `${TEST_TAG}:mint3`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint3`);
  createdAssetIds.push(mint3.assetId);
  createdBasisIds.push(mint3.basisId);
  assertTrue(mint3.outcome === 'minted-new', `B: discriminator=1 under the SAME observation -> minted-new, a real second entity_mint_basis row (got ${mint3.outcome})`);
  assertTrue(mint3.assetId !== mint1.assetId, 'B: candidate 1 gets a genuinely different gk_asset.id than candidate 0 — no collision');

  // --- Requirement C: existing single-object (no discriminator) behavior
  // remains fully functional end-to-end through the real mechanism —
  // mint once, replay once, same asset both times, exactly like before D3.1. ---
  const scanPayloadC = { correlationId: `${TEST_TAG}-legacy-session`, scanlogKey: `${TEST_TAG}-legacy-scanlog`, book: { title: 'Test Book C' } };
  const basisC = buildCaptureBasis(JIMMY_PRINCIPAL_ID, scanPayloadC); // no 3rd arg — legacy call
  const mint4 = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basisC, assetClass: 'comic',
    source: 'd3-1-test', idempotencyKey: `${TEST_TAG}:mint4`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint4`);
  createdAssetIds.push(mint4.assetId);
  createdBasisIds.push(mint4.basisId);
  assertTrue(mint4.outcome === 'minted-new', `C: legacy no-discriminator call still mints a real new asset (got ${mint4.outcome})`);

  const mint5 = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basisC, assetClass: 'comic',
    source: 'd3-1-test', idempotencyKey: `${TEST_TAG}:mint5`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint5`);
  assertTrue(mint5.outcome === 'resolved-existing' && mint5.assetId === mint4.assetId, 'C: legacy no-discriminator replay still resolves to the same asset, exactly like before D3.1');

  // Real row check: 3 distinct assets, 3 distinct basis rows, all live.
  const liveCheck = await client.query(
    `SELECT id FROM gk_asset WHERE id = ANY($1::uuid[])`,
    [createdAssetIds]
  );
  assertTrue(liveCheck.rows.length === createdAssetIds.length, `all ${createdAssetIds.length} created gk_asset rows are genuinely live in data1_dev`);
} finally {
  // --- Cleanup: delete exactly what this test created, in dependency
  // order, then verify counts return to the pre-test baseline. ---
  try {
    if (createdAssetIds.length > 0) {
      await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = ANY($1::uuid[]))`, [createdAssetIds]);
      await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = ANY($1::uuid[])`, [createdAssetIds]);
      await client.query(`DELETE FROM current_owner WHERE asset_id = ANY($1::uuid[])`, [createdAssetIds]);
      await client.query(`DELETE FROM ownership_event WHERE asset_id = ANY($1::uuid[])`, [createdAssetIds]);
      await client.query(`DELETE FROM mint_event WHERE entity_id = ANY($1::uuid[])`, [createdAssetIds]);
      await client.query(`DELETE FROM gk_asset WHERE id = ANY($1::uuid[])`, [createdAssetIds]);
    }
    if (createdBasisIds.length > 0) {
      await client.query(`DELETE FROM entity_mint_basis WHERE id = ANY($1::uuid[])`, [createdBasisIds]);
    }
    if (idempotencyKeysUsed.length > 0) {
      await client.query(`DELETE FROM idempotency_key WHERE idempotency_key = ANY($1::text[])`, [idempotencyKeysUsed]);
    }
  } catch (cleanupErr) {
    console.log('  CLEANUP ERROR (manual cleanup may be required):', cleanupErr.message, 'asset ids:', createdAssetIds, 'basis ids:', createdBasisIds);
  }

  const after = await countAll();
  console.log('  post-cleanup table counts:', JSON.stringify(after));
  assertTrue(
    JSON.stringify(after) === JSON.stringify(before),
    `cleanup restored all 8 table counts to the exact pre-test baseline (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
}
await client.end();
await closePool();
process.exit(failed > 0 ? 1 : 0);
