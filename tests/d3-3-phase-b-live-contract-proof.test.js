// tests/d3-3-phase-b-live-contract-proof.test.js
//
// D3.3 Phase B — real, live proof of the complete durable
// snapshot->valuation contract against real, now-migrated data1_dev.
// Uses the real service.js/repository.js functions (recordCompSnapshot,
// recordValuation, createPhysicalAsset) directly — safe now that 0012
// (amended, R1/R2) is applied and schema-verified.
//
// IMPORTANT — comp_snapshot is genuinely DELETE-protected (a real DB
// trigger, not a convention). This means any comp_snapshot row this
// test creates CANNOT be removed at the end, by design — that IS the
// invariant being proven. Because comp_snapshot.asset_id is a real FK
// to gk_asset(id), the test's own gk_asset row also cannot be deleted
// once a comp_snapshot references it; because gk_asset.mint_basis_id is
// a real FK to entity_mint_basis(id), that row is transitively pinned
// too. This test does NOT disable/drop the triggers to force cleanup —
// it deletes everything that CAN be cleanly removed (valuation_event,
// domain_event/outbox, ownership_event/current_owner, mint_event,
// idempotency_key rows) and explicitly reports the small, structurally-
// forced permanent footprint (exactly 1 gk_asset + 1 entity_mint_basis +
// 2 comp_snapshot rows) as classified controlled test artifacts, with
// exact IDs and before/after counts — never a false byte-identical
// count claim for the tables that genuinely gained permanent rows.
//
// Invoke: node tests/d3-3-phase-b-live-contract-proof.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const { createPhysicalAsset, recordCompSnapshot, recordValuation, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));
const mapping = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D3.3 Phase B — live snapshot→valuation contract proof (real data1_dev) ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TEST_TAG = `d3-3-phaseb-${Date.now()}`;
const idempotencyKeysUsed = [];

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

async function counts() {
  const r = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM gk_asset) AS gk_asset,
      (SELECT COUNT(*)::int FROM entity_mint_basis) AS entity_mint_basis,
      (SELECT COUNT(*)::int FROM comp_snapshot) AS comp_snapshot,
      (SELECT COUNT(*)::int FROM valuation_event) AS valuation_event,
      (SELECT COUNT(*)::int FROM mint_event) AS mint_event,
      (SELECT COUNT(*)::int FROM ownership_event) AS ownership_event,
      (SELECT COUNT(*)::int FROM current_owner) AS current_owner,
      (SELECT COUNT(*)::int FROM domain_event) AS domain_event,
      (SELECT COUNT(*)::int FROM outbox) AS outbox,
      (SELECT COUNT(*)::int FROM idempotency_key) AS idempotency_key
  `);
  return r.rows[0];
}
const before = await counts();
console.log('  pre-test table counts:', JSON.stringify(before));

let assetId = null;
let s1Id = null;
let s2Id = null;
try {
  // --- G-support: mint a real test asset (permanent asset identity is
  // never redefined by anything below — gkAssetId minted once here). ---
  const basis = mapping.buildCaptureBasis(JIMMY_PRINCIPAL_ID, { correlationId: `${TEST_TAG}-session`, scanlogKey: `${TEST_TAG}-sl`, book: { title: 'D3.3 Phase B test book' } });
  const mint = await createPhysicalAsset({
    principalId: JIMMY_PRINCIPAL_ID, captureBasis: basis, assetClass: 'comic',
    source: 'd3-3-phase-b-test', idempotencyKey: `${TEST_TAG}:mint`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:mint`);
  assetId = mint.assetId;
  assertTrue(mint.outcome === 'minted-new', 'setup: real test asset minted (gkAssetId established)');

  // --- A: Persist S1, read back faithfully. ---
  const payloadS1 = {
    items: [
      { title: 'Amazing Fantasy #15', price: 800, soldDate: '2026-01-03', listingDate: '2025-12-20', source: 'ebay-browse-api' },
      { title: 'Amazing Fantasy #15', price: 950, soldDate: '2025-11-11', source: 'pricecharting-scrape' }, // no listingDate -- absence preserved
    ],
    summary: { avg: 875 },
  };
  const snapResult1 = await recordCompSnapshot({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: assetId, source: 'ebay-browse-api', payload: payloadS1,
    idempotencyKey: `${TEST_TAG}:snap1`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:snap1`);
  s1Id = snapResult1.compSnapshotId;
  const s1Read = await client.query('SELECT payload, asset_id FROM comp_snapshot WHERE id = $1', [s1Id]);
  assertTrue(s1Read.rows.length === 1, 'A: S1 persisted via the real recordCompSnapshot function');
  assertTrue(isDeepStrictEqual(s1Read.rows[0].payload, payloadS1), 'A: S1 reads back with the exact original payload (deep-equal, real function)');

  // --- B: Link V1 -> S1, read back, prove durable resolution. ---
  const val1 = await recordValuation({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: assetId, valueAmount: 875, method: 'engine-computed',
    buildSha: 'test-sha-b', idempotencyKey: `${TEST_TAG}:val1`, compSnapshotId: s1Id,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:val1`);
  const v1Read = await client.query(
    `SELECT ve.comp_snapshot_id, cs.payload FROM valuation_event ve JOIN comp_snapshot cs ON cs.id = ve.comp_snapshot_id WHERE ve.id = $1`,
    [val1.valuationEventId]
  );
  assertTrue(v1Read.rows.length === 1 && v1Read.rows[0].comp_snapshot_id === s1Id, 'B: V1 durably resolves to S1 via a real JOIN through comp_snapshot_id (real recordValuation function)');
  assertTrue(isDeepStrictEqual(v1Read.rows[0].payload, payloadS1), 'B: resolving V1 -> S1 yields the exact original evidence payload');

  // --- C: referential integrity -- a nonexistent snapshot UUID is rejected. ---
  let danglingThrew = false;
  try {
    await recordValuation({
      principalId: JIMMY_PRINCIPAL_ID, gkAssetId: assetId, valueAmount: 1, method: 'operator-override',
      buildSha: 'test-sha-c', idempotencyKey: `${TEST_TAG}:val-dangling`, compSnapshotId: crypto.randomUUID(),
    });
  } catch (e) {
    danglingThrew = true;
  }
  assertTrue(danglingThrew, 'C: recordValuation with a nonexistent random snapshot UUID is rejected by the real FK constraint, through the real application code path');

  // --- D: snapshot immutability -- direct UPDATE/DELETE on S1 rejected. ---
  let s1UpdateThrew = false, s1DeleteThrew = false;
  try { await client.query(`UPDATE comp_snapshot SET source='tampered' WHERE id=$1`, [s1Id]); } catch { s1UpdateThrew = true; }
  try { await client.query(`DELETE FROM comp_snapshot WHERE id=$1`, [s1Id]); } catch { s1DeleteThrew = true; }
  assertTrue(s1UpdateThrew, 'D: direct UPDATE of S1 rejected by the real live trigger');
  assertTrue(s1DeleteThrew, 'D: direct DELETE of S1 rejected by the real live trigger');

  // --- E: repricing -- S2/V2, distinct from S1/V1. ---
  const payloadS2 = {
    items: [
      { title: 'Amazing Fantasy #15', price: 1200, soldDate: '2026-02-28', source: 'ebay-browse-api' },
    ],
    summary: { avg: 1200 },
  };
  const snapResult2 = await recordCompSnapshot({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: assetId, source: 'ebay-browse-api', payload: payloadS2,
    idempotencyKey: `${TEST_TAG}:snap2`,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:snap2`);
  s2Id = snapResult2.compSnapshotId;
  assertTrue(s2Id !== s1Id, 'E: repricing produced a genuinely new, distinct snapshot (S2 != S1)');

  const val2 = await recordValuation({
    principalId: JIMMY_PRINCIPAL_ID, gkAssetId: assetId, valueAmount: 1200, method: 'engine-computed',
    buildSha: 'test-sha-e', idempotencyKey: `${TEST_TAG}:val2`, compSnapshotId: s2Id,
  });
  idempotencyKeysUsed.push(`${TEST_TAG}:val2`);

  const linkCheck = await client.query(
    `SELECT id, comp_snapshot_id FROM valuation_event WHERE id = ANY($1::uuid[]) ORDER BY recorded_at`,
    [[val1.valuationEventId, val2.valuationEventId]]
  );
  assertTrue(
    linkCheck.rows[0].comp_snapshot_id === s1Id && linkCheck.rows[1].comp_snapshot_id === s2Id,
    'E: V1.comp_snapshot_id = S1.id and V2.comp_snapshot_id = S2.id, independently and correctly'
  );

  // --- F: historical preservation -- S1/V1 still resolve correctly after S2/V2. ---
  const s1StillReadable = await client.query('SELECT payload FROM comp_snapshot WHERE id = $1', [s1Id]);
  assertTrue(isDeepStrictEqual(s1StillReadable.rows[0].payload, payloadS1), 'F: S1 remains readable with its exact original payload after S2 was written');
  const v1StillResolves = await client.query('SELECT comp_snapshot_id FROM valuation_event WHERE id = $1', [val1.valuationEventId]);
  assertTrue(v1StillResolves.rows[0].comp_snapshot_id === s1Id, 'F: V1 still resolves to S1 (unchanged) after the repricing event');
  const v2Resolves = await client.query('SELECT comp_snapshot_id FROM valuation_event WHERE id = $1', [val2.valuationEventId]);
  assertTrue(v2Resolves.rows[0].comp_snapshot_id === s2Id, 'F: V2 resolves to S2');

  // --- G: physical gkAssetId unchanged throughout. ---
  const assetCheck = await client.query('SELECT DISTINCT asset_id FROM comp_snapshot WHERE id = ANY($1::uuid[])', [[s1Id, s2Id]]);
  assertTrue(assetCheck.rows.length === 1 && assetCheck.rows[0].asset_id === assetId, 'G: gkAssetId identical across S1/S2/V1/V2 — never reassigned by repricing');

  // --- H: temporal evidence -- exact preservation, recorded_at independence. ---
  const s1Temporal = await client.query('SELECT payload, recorded_at FROM comp_snapshot WHERE id = $1', [s1Id]);
  const items = s1Temporal.rows[0].payload.items;
  assertTrue(items[0].soldDate === '2026-01-03' && items[0].listingDate === '2025-12-20', 'H: item 0 both temporal fields preserved exactly');
  assertTrue(items[1].soldDate === '2025-11-11' && !('listingDate' in items[1]), 'H: item 1 soldDate preserved, missing listingDate preserved as genuinely absent, not defaulted');
  assertTrue(
    s1Temporal.rows[0].recorded_at.getTime() !== new Date('2026-01-03').getTime() && s1Temporal.rows[0].recorded_at.getTime() !== new Date('2025-12-20').getTime(),
    'H: comp_snapshot.recorded_at is independent persistence metadata, never substituted for either per-item evidence date'
  );

  // --- I: legacy soft reference untouched/independent. ---
  const refCheck = await client.query('SELECT comp_snapshot_ref, comp_snapshot_id FROM valuation_event WHERE id = ANY($1::uuid[])', [[val1.valuationEventId, val2.valuationEventId]]);
  assertTrue(refCheck.rows.every(r => r.comp_snapshot_ref === null), 'I: neither V1 nor V2 has comp_snapshot_ref populated — the new durable linkage used comp_snapshot_id exclusively, comp_snapshot_ref was never touched or required');

  // --- J: pre-existing historical valuation rows remain NULL. ---
  const histNullCheck = await client.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE comp_snapshot_id IS NULL)::int AS null_count
     FROM valuation_event WHERE id != ALL($1::uuid[])`,
    [[val1.valuationEventId, val2.valuationEventId]]
  );
  assertTrue(
    histNullCheck.rows[0].total === histNullCheck.rows[0].null_count,
    `J: all ${histNullCheck.rows[0].total} pre-existing valuation_event rows (excluding this test's own V1/V2) have comp_snapshot_id IS NULL — no manufactured historical linkage`
  );

} finally {
  // --- K: cleanup -- delete everything that CAN be cleanly removed.
  // comp_snapshot (S1, S2), and everything transitively pinned by the
  // real FK/trigger chain, is explicitly NOT deleted -- see file header.
  if (assetId) {
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key = ANY($1::text[])`, [idempotencyKeysUsed]);
    await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
    await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
    await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM mint_event WHERE entity_id = $1`, [assetId]);

    // gk_asset and entity_mint_basis CANNOT be deleted -- comp_snapshot
    // (S1, S2, immutable, never deleted) FK-references gk_asset(id);
    // gk_asset itself FK-references entity_mint_basis(id). Confirm this
    // is a real, expected rejection, not silently skipped.
    let assetDeleteThrew = false, basisDeleteThrew = false;
    const mintBasisRow = await client.query('SELECT mint_basis_id FROM gk_asset WHERE id = $1', [assetId]).catch(() => ({ rows: [] }));
    try { await client.query('DELETE FROM gk_asset WHERE id = $1', [assetId]); } catch { assetDeleteThrew = true; }
    if (mintBasisRow.rows[0]) {
      try { await client.query('DELETE FROM entity_mint_basis WHERE id = $1', [mintBasisRow.rows[0].mint_basis_id]); } catch { basisDeleteThrew = true; }
    }
    assertTrue(assetDeleteThrew, 'K: gk_asset delete correctly rejected — permanently pinned by the immutable comp_snapshot rows referencing it (structural consequence of the invariant just proven, not a bug)');
    assertTrue(basisDeleteThrew, 'K: entity_mint_basis delete correctly rejected — permanently pinned because gk_asset (above) could not be removed either');

    console.log(`\n  RETAINED CONTROLLED TEST ARTIFACTS (cannot be removed by design — comp_snapshot is DELETE-protected):`);
    console.log(`    gk_asset.id = ${assetId}`);
    console.log(`    entity_mint_basis.id = (see gk_asset.mint_basis_id, pinned transitively)`);
    console.log(`    comp_snapshot.id = ${s1Id} (S1)`);
    console.log(`    comp_snapshot.id = ${s2Id} (S2)`);
    console.log(`    Provenance: D3.3 Phase B live contract proof, this dispatch, 2026-09-02. Not production data.`);
  }

  const after = await counts();
  console.log('\n  post-cleanup table counts:', JSON.stringify(after));
  console.log('  pre-test table counts:     ', JSON.stringify(before));

  // Tables that MUST return to baseline (nothing structurally pins them).
  for (const tbl of ['valuation_event', 'ownership_event', 'current_owner', 'mint_event', 'domain_event', 'outbox', 'idempotency_key']) {
    assertTrue(after[tbl] === before[tbl], `K: ${tbl} count returned to exact baseline (${before[tbl]} before, ${after[tbl]} after) — fully cleaned`);
  }
  // Tables with an honest, reported, structurally-forced delta — never
  // falsely claimed byte-identical.
  assertTrue(after.gk_asset === before.gk_asset + 1, `K: gk_asset count is baseline+1 (${before.gk_asset} -> ${after.gk_asset}) — 1 row PERMANENTLY RETAINED as a controlled test artifact, reported honestly, not hidden`);
  assertTrue(after.entity_mint_basis === before.entity_mint_basis + 1, `K: entity_mint_basis count is baseline+1 (${before.entity_mint_basis} -> ${after.entity_mint_basis}) — 1 row PERMANENTLY RETAINED, same reason`);
  assertTrue(after.comp_snapshot === before.comp_snapshot + 2, `K: comp_snapshot count is baseline+2 (${before.comp_snapshot} -> ${after.comp_snapshot}) — 2 rows (S1, S2) PERMANENTLY RETAINED by the real immutability invariant this proof exists to demonstrate`);

  await client.end();
  await closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
