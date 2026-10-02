// tests/gk276-economic-decision-live-proof.test.js
//
// GK-276 — real, live proof (real data1_dev, a fresh disposable asset) of
// recordEconomicDecision: ONE atomic valuation_event + decision_event,
// provenance hard-coded SERVER_DERIVED, idempotency keyed by the
// server-derived semantic fingerprint.
//
// valuation_event/decision_event are DB-immutable (0034): this test's rows
// are RETAINED (never deleted). All counts are scoped to this run's own
// fresh asset, so they are unaffected by older rows. Known pre-existing
// Development contaminants (stale test valuations from earlier dispatches,
// on OTHER assets) are listed in the output and excluded by construction.
//
// Invoke: node tests/gk276-economic-decision-live-proof.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));
const { createPhysicalAsset, recordEconomicDecision, getPhysicalAsset, closePool } = assets;
const mapping = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));
const bridge = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'outcome1RuntimeBridge.js')));
const scoring = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'predictionErrorScoring.js')));

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `gk276-econ-${Date.now()}`;
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

console.log('\n=== GK-276 — recordEconomicDecision (atomic, SERVER_DERIVED, fingerprint-idempotent), real data1_dev ===\n');

const contaminants = await client.query(`SELECT v.id, i.idempotency_key FROM valuation_event v JOIN idempotency_key i ON i.operation='recordValuation' AND i.result_snapshot->>'valuationEventId' = v.id::text WHERE i.idempotency_key LIKE 'reconciler-test-valuation%' ORDER BY v.id`);
console.log('  known pre-existing Development test-valuation contaminants (other assets, excluded by asset-scoping):');
for (const r of contaminants.rows) console.log(`    ${r.id}  key=${r.idempotency_key}`);

const rowsFor = async (assetId) => ({
  v: (await client.query('SELECT id, provenance, build_sha, method, value_amount::text amt FROM valuation_event WHERE asset_id=$1 ORDER BY id', [assetId])).rows,
  d: (await client.query('SELECT id, valuation_event_id, recommendation FROM decision_event WHERE asset_id=$1 ORDER BY id', [assetId])).rows,
});
const fp = (over = {}) => bridge.computeEconomicDecisionFingerprint({
  principalId: JIMMY, gkAssetId: assetId, valueAmount: 42.5, gradeAssumption: 4, evidenceKey: 'ebay-active|HIGH',
  recommendation: 'LIST_LOW', reasonCodes: [{ type: 'warning', code: 'thin-pool' }], buildSha: 'abc1234', ...over,
});
let assetId = null;

try {
  const basis = mapping.buildCaptureBasis(JIMMY, { correlationId: `${TAG}-s`, scanlogKey: `${TAG}-sl`, book: { title: 'GK-276 econ test book' } });
  const mint = await createPhysicalAsset({ principalId: JIMMY, captureBasis: basis, assetClass: 'comic', source: 'gk276-test', idempotencyKey: `${TAG}:mint` });
  assetId = mint.assetId;
  ok(mint.outcome === 'minted-new', 'setup: fresh disposable asset minted');
  ok((await rowsFor(assetId)).v.length === 0, 'setup: zero valuation rows on the fresh asset');

  const write = (over = {}, fpOver = {}) => recordEconomicDecision({
    principalId: JIMMY, gkAssetId: assetId, valueAmount: 42.5, valueCurrency: 'USD', method: 'engine-computed', gradeAssumption: 4,
    buildSha: 'abc1234', recommendation: 'LIST_LOW', reasonCodes: [{ type: 'warning', code: 'thin-pool' }],
    semanticFingerprint: fp(fpOver), correlationId: `${TAG}-c`, ...over,
  });

  console.log('\n-- first write: ONE valuation + ONE decision, SERVER_DERIVED, decision -> exact valuation --\n');
  const w1 = await write();
  const s1 = await rowsFor(assetId);
  ok(w1.replayed === false && s1.v.length === 1 && s1.d.length === 1, 'exactly 1 valuation_event and 1 decision_event created');
  ok(s1.v[0].provenance === 'SERVER_DERIVED' && s1.v[0].build_sha === 'abc1234' && s1.v[0].amt === '42.50', 'valuation: provenance SERVER_DERIVED, real build sha, correct value');
  ok(s1.d[0].valuation_event_id === s1.v[0].id && s1.d[0].id === w1.decisionEventId && s1.v[0].id === w1.valuationEventId, 'decision references the exact valuation created in the same transaction');

  console.log('\n-- retry: the SAME economic decision -> zero new rows (idempotent replay) --\n');
  const w2 = await write();
  const s2 = await rowsFor(assetId);
  ok(w2.replayed === true && w2.valuationEventId === w1.valuationEventId && w2.decisionEventId === w1.decisionEventId, 'replay returns the original ids');
  ok(s2.v.length === 1 && s2.d.length === 1, 'ZERO additional valuation rows and ZERO additional decision rows');

  console.log('\n-- MATERIALLY NEW decision -> exactly one new pair --\n');
  const w3 = await write({ valueAmount: 55, recommendation: 'LIST_NOW' }, { valueAmount: 55, recommendation: 'LIST_NOW' });
  const s3 = await rowsFor(assetId);
  ok(w3.replayed === false && s3.v.length === 2 && s3.d.length === 2, 'a changed value+recommendation appends exactly one new valuation+decision pair');
  ok(s3.v.every((v) => v.provenance === 'SERVER_DERIVED') && s3.d.find((d) => d.id === w3.decisionEventId).valuation_event_id === w3.valuationEventId, 'the new pair is itself SERVER_DERIVED and internally linked');
  ok(JSON.stringify(s3.v[0]) === JSON.stringify(s1.v[0]), 'history is not rewritten: the first valuation row is byte-identical');

  console.log('\n-- injected partial failure: NEITHER row persists (atomic) --\n');
  const circular = {}; circular.self = circular; // JSON.stringify(reasonCodes) throws AFTER the valuation INSERT inside the transaction
  let threw = false;
  const failFp = fp({ valueAmount: 77, recommendation: 'RESEARCH' });
  try { await write({ valueAmount: 77, recommendation: 'RESEARCH', reasonCodes: [circular] }, { valueAmount: 77, recommendation: 'RESEARCH' }); } catch { threw = true; }
  const s4 = await rowsFor(assetId);
  ok(threw, 'the failing write threw');
  ok(s4.v.length === 2 && s4.d.length === 2, 'NO orphan valuation: counts unchanged (2 valuations, 2 decisions) after a failure between the two inserts');
  const claimed = await client.query(`SELECT 1 FROM idempotency_key WHERE operation='recordEconomicDecision' AND idempotency_key = $1`, [failFp]);
  ok(claimed.rowCount === 0, 'the failed attempt claimed no idempotency key (a corrected retry is a normal first write)');
  const w5 = await write({ valueAmount: 77, recommendation: 'RESEARCH' }, { valueAmount: 77, recommendation: 'RESEARCH' });
  const s5 = await rowsFor(assetId);
  ok(w5.replayed === false && s5.v.length === 3 && s5.d.length === 3, 'the corrected retry then writes cleanly (one pair)');

  console.log('\n-- cross-principal / non-existent principal: no write --\n');
  const other = await client.query(`SELECT id FROM gk_principal WHERE id <> $1 LIMIT 1`, [JIMMY]);
  const outsider = other.rows[0]?.id || '00000000-0000-7000-8000-000000000001';
  let blocked = false;
  try { await write({ principalId: outsider, valueAmount: 99 }, { principalId: outsider, valueAmount: 99 }); } catch { blocked = true; }
  const s6 = await rowsFor(assetId);
  ok(blocked && s6.v.length === 3 && s6.d.length === 3, 'a principal that does not own the asset cannot write; zero rows added');

  console.log('\n-- input contract --\n');
  let rejected = false;
  try { await write({ semanticFingerprint: 'client-supplied-key' }); } catch { rejected = true; }
  ok(rejected, 'a client-style idempotency key (not an econ-v1 server fingerprint) is rejected');
  let noProv = true;
  try { await recordEconomicDecision({ principalId: JIMMY, gkAssetId: assetId, valueAmount: 1, buildSha: 'abc1234', recommendation: 'RESEARCH', semanticFingerprint: fp({ valueAmount: 1 }), provenance: 'CLIENT_ASSERTED' }); } catch { noProv = false; }
  const s7 = await rowsFor(assetId);
  ok(s7.v.filter((v) => v.provenance !== 'SERVER_DERIVED').length === 0, 'a caller-supplied provenance parameter has no effect: every row is SERVER_DERIVED');

  console.log('\n-- the written pair is scoreable as an ENGINE prediction (SERVER_DERIVED) --\n');
  const hist = await assets.getHistoricalValuationForDecision({ principalId: JIMMY, gkAssetId: assetId, decisionEventId: w1.decisionEventId });
  const anchor = scoring.resolveHistoricalAnchor({ decisionEventId: w1.decisionEventId, anchor: hist });
  ok(anchor.ok === true && anchor.pins.valuationProvenance === 'SERVER_DERIVED' && anchor.predictedValue === 42.5, 'GK-274 historical anchor accepts it: SERVER_DERIVED, the historical $42.50 (not the later $55)');

  const graph = await getPhysicalAsset({ principalId: JIMMY, gkAssetId: assetId });
  ok(graph.valuations.every((v) => v.provenance === 'SERVER_DERIVED'), 'the asset graph exposes provenance on every valuation');
} catch (e) {
  failed++; failures.push('FATAL ' + (e.stack || e.message)); console.log('  ✗ FATAL:', e.stack || e.message);
} finally {
  // gk_asset + its immutable economic rows are retained by design (0034). Mutable residue only:
  try {
    if (assetId) {
      await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
      await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
    }
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key LIKE $1`, [`%${TAG}%`]);
  } catch (e) { console.log('  cleanup note:', e.message); }
  await client.end();
  await closePool();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed) { failures.forEach((f) => console.log('  ✗', f)); process.exit(1); }
  process.exit(0);
}
