// tests/d3-2-application-wiring-live-proof.test.js
//
// D3.2 Phase B — real, live proof of the occurredAt write/read contract
// against the REAL, now-migrated data1_dev (migration 0011 applied
// 2026-09-02; see docs/DATABASE-MIGRATION-STATUS.md for the full
// pre/post evidence). This test uses the real service.js/repository.js
// functions directly — safe now that the live schema matches what they
// expect (see tests/d3-2-true-event-time-live-roundtrip.test.js's own
// header for the earlier, real error this exact combination produced
// against the pre-migration schema).
//
// A real test asset is minted (via createPhysicalAsset, Jimmy's real
// principal) to satisfy the real FK constraints ownership_event/
// acquisition_event/valuation_event/decision_event/media/
// asset_identity_assignment all carry on asset_id — then every relevant
// writer is exercised through its real public signature. Everything
// this test creates is deleted at the end; table counts are verified
// identical before/after.
//
// Invoke: node tests/d3-2-application-wiring-live-proof.test.js

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

const { createPhysicalAsset, recordAcquisition, recordValuation, recordDecision, assignIdentity, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));
const mapping = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D3.2 Phase B — application-wiring live proof (real data1_dev, post-migration) ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TEST_TAG = `d3-2-appwiring-${Date.now()}`;
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
      (SELECT COUNT(*)::int FROM acquisition_event) AS acquisition_event,
      (SELECT COUNT(*)::int FROM valuation_event) AS valuation_event,
      (SELECT COUNT(*)::int FROM decision_event) AS decision_event,
      (SELECT COUNT(*)::int FROM asset_identity_assignment) AS asset_identity_assignment,
      (SELECT COUNT(*)::int FROM domain_event) AS domain_event,
      (SELECT COUNT(*)::int FROM current_owner) AS current_owner,
      (SELECT COUNT(*)::int FROM outbox) AS outbox,
      (SELECT COUNT(*)::int FROM idempotency_key) AS idempotency_key
  `);
  return r.rows[0];
}

const before = await countAll();
console.log('  pre-test table counts:', JSON.stringify(before));

const pastDate = new Date('2015-06-15T12:00:00.000Z');
const futureDate = new Date('2099-01-01T00:00:00.000Z');

try {
  // Mint a real test asset (satisfies the real FK constraints below).
  const basis = mapping.buildCaptureBasis(JIMMY_PRINCIPAL_ID, { correlationId: `${TEST_TAG}-session`, scanlogKey: `${TEST_TAG}-sl`, book: { title: 'D3.2 test book' } });
  const mint = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basis, assetClass: 'comic',
    source: 'd3-2-test', idempotencyKey: `${TEST_TAG}:mint`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint`);
  createdAssetId = mint.assetId;
  assertTrue(mint.outcome === 'minted-new', 'setup: real test asset minted');

  // C: explicit past occurredAt round-trips exactly (recordAcquisition).
  const acq = await recordAcquisition({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, costAmount: 5, source: 'purchase',
    idempotencyKey: `${TEST_TAG}:acq`, occurredAt: pastDate,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:acq`);
  {
    const r = await client.query('SELECT occurred_at, recorded_at FROM acquisition_event WHERE id = $1', [acq.acquisitionEventId]);
    assertTrue(r.rows[0].occurred_at.getTime() === pastDate.getTime(), 'C: recordAcquisition — explicit past occurredAt persisted exactly, real repository.js function');
    assertTrue(r.rows[0].recorded_at !== null && r.rows[0].occurred_at.getTime() !== r.rows[0].recorded_at.getTime(), 'C: recorded_at independently generated, distinct from occurred_at');
  }

  // D: NULL occurredAt succeeds and remains NULL (recordValuation, omitted).
  const val = await recordValuation({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, valueAmount: 10, method: 'engine-computed',
    buildSha: 'test-sha', idempotencyKey: `${TEST_TAG}:val`,
    // occurredAt omitted on purpose
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:val`);
  {
    const r = await client.query('SELECT occurred_at, recorded_at FROM valuation_event WHERE id = $1', [val.valuationEventId]);
    assertTrue(r.rows[0].occurred_at === null, 'D: recordValuation — omitted occurredAt -> NULL, never "now", real function');
    assertTrue(r.rows[0].recorded_at !== null, 'D: recorded_at still populated');
  }

  // E: occurred_at > recorded_at succeeds (recordDecision, future date).
  const dec = await recordDecision({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, recommendation: 'RESEARCH',
    idempotencyKey: `${TEST_TAG}:dec`, occurredAt: futureDate,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:dec`);
  {
    const r = await client.query('SELECT occurred_at, recorded_at FROM decision_event WHERE id = $1', [dec.decisionEventId]);
    assertTrue(r.rows[0].occurred_at.getTime() === futureDate.getTime(), 'E: recordDecision — occurred_at > recorded_at (future-dated) accepted, no error, real function');
    assertTrue(r.rows[0].occurred_at.getTime() > r.rows[0].recorded_at.getTime(), 'E: confirmed occurred_at genuinely greater than recorded_at');
  }

  // F: legacy caller with no occurredAt succeeds (assignIdentity, no 8th field at all).
  const ident = await assignIdentity({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: createdAssetId, catalogEntityId: null,
    evidence: { authority: 'NONE', source: 'unresolved' }, idempotencyKey: `${TEST_TAG}:ident`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:ident`);
  {
    const r = await client.query('SELECT occurred_at, recorded_at FROM asset_identity_assignment WHERE id = $1', [ident.assignmentId]);
    assertTrue(r.rows[0].occurred_at === null && r.rows[0].recorded_at !== null, 'F: assignIdentity — legacy call (no occurredAt param at all) succeeds, occurred_at NULL, real function');
  }

  // G: no SQL/application chronology rejection anywhere -- both the
  // future-dated (E) and past-dated (C) inserts above succeeded with no
  // thrown error; re-confirm no CHECK constraint exists live.
  {
    const checks = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'data1_dev'::regnamespace AND contype = 'c'`
    );
    const chrono = checks.rows.find(r => /occurred_at/i.test(r.def) && /recorded_at/i.test(r.def));
    assertTrue(chrono === undefined, `G: no chronology CHECK constraint exists live (${checks.rows.length} CHECK constraints scanned), and no application code threw on past- or future-dated occurredAt above`);
  }
} finally {
  // Cleanup: delete exactly what this test created.
  if (createdAssetId) {
    await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [createdAssetId]);
    await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [createdAssetId]);
    await client.query(`DELETE FROM asset_identity_assignment WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM decision_event WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM acquisition_event WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [createdAssetId]);
    const mintBasis = await client.query(`SELECT mint_basis_id FROM gk_asset WHERE id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM mint_event WHERE entity_id = $1`, [createdAssetId]);
    await client.query(`DELETE FROM gk_asset WHERE id = $1`, [createdAssetId]);
    if (mintBasis.rows[0]) {
      await client.query(`DELETE FROM entity_mint_basis WHERE id = $1`, [mintBasis.rows[0].mint_basis_id]);
    }
  }
  if (idempotencyKeysUsed.length > 0) {
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key = ANY($1::text[])`, [idempotencyKeysUsed]);
  }

  const after = await countAll();
  console.log('  post-cleanup table counts:', JSON.stringify(after));
  assertTrue(
    JSON.stringify(after) === JSON.stringify(before),
    `I: cleanup restored all table counts to the exact pre-test baseline (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`
  );

  await client.end();
  await closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
