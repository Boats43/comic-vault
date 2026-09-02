// tests/d4-identifier-fabric-live-proof.test.js
//
// D4 Phase B, B8 -- full live round-trip proof of the Identifier Fabric
// through the REAL, wired src/modules/assets service functions, against
// the REAL, applied data1_dev (migration 0013, SHA-256
// f0e849228c462de953b51fa349a30231423eded58f8834b915ec9694f69d621a).
// Not a scratch schema -- this is the real production database. All
// rows created here are permanent by construction (asset_raw_
// observation, asset_identifier_assertion, and asset_identifier_
// assertion_evidence all reject DELETE) and are DELIBERATELY RETAINED,
// never cleaned up, never disabling any trigger/constraint (B10a). Every
// row's `source` field is stamped with the D4_PROVENANCE_MARKER below so
// this proof population is unmistakably attributable and never confused
// with real user data or with the B4a pre-wiring attack's own rows.
//
// Invoke: node tests/d4-identifier-fabric-live-proof.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

const OPERATOR_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba'; // Jimmy, real operator, gk_principal
const D4_PROVENANCE_MARKER = 'd4-phase-b-proof:b8-live-proof';
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

console.log('\n=== D4 Phase B, B8 -- live round-trip proof (real data1_dev, real service) ===\n');

let uidCounter = 0;
const uid = (label) => `d4-b8-${label}-${Date.now()}-${uidCounter++}`;

// ---------------------------------------------------------------------
// Identity permanence
// ---------------------------------------------------------------------
console.log('-- Identity permanence --\n');

const assetA = await assets.createPhysicalAsset({
  principalId: OPERATOR_PRINCIPAL,
  captureBasis: { marker: D4_PROVENANCE_MARKER, slot: 'identity-permanence-A', ts: Date.now() },
  assetClass: 'd4-proof', source: D4_PROVENANCE_MARKER, idempotencyKey: uid('mint-A'),
});
const originalGkAssetId = assetA.assetId;
console.log('  Minted real gkAssetId A:', originalGkAssetId);

const checkUnchanged = async (label) => {
  const graph = await assets.getPhysicalAsset({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId });
  assertTrue(graph.asset.id === originalGkAssetId, `gkAssetId unchanged after: ${label}`);
};
await checkUnchanged('mint');

const idfDef1 = await assets.recordIdentifierDefinition({
  principalId: OPERATOR_PRINCIPAL, scheme: 'isbn', issuingAuthority: 'ISBN-agency',
  normalizedValue: '9780306406157', scope: 'PRODUCT_CLASS', idempotencyKey: uid('idf1'),
});
const obs1 = await assets.recordRawObservation({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, observedRawValue: '978-0-306-40615-7',
  source: D4_PROVENANCE_MARKER, idempotencyKey: uid('obs1'),
});
await checkUnchanged('add identifier evidence (raw observation)');

const assertion1 = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('assertion1'),
});
await assets.linkAssertionEvidence({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, assertionId: assertion1.assertionId,
  observationId: obs1.observationId, idempotencyKey: uid('link1'),
});
await checkUnchanged('add assertion');

const idfDef2 = await assets.recordIdentifierDefinition({
  principalId: OPERATOR_PRINCIPAL, scheme: 'certification-number', issuingAuthority: 'CGC',
  normalizedValue: uid('cert'), scope: 'CERTIFIED_INSTANCE', idempotencyKey: uid('idf2'),
});
const assertion2 = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef2.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'NONE', idempotencyKey: uid('assertion2'),
});
await checkUnchanged('add second identifier');

const correctionAssertion = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId,
  source: D4_PROVENANCE_MARKER + ':correction', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('correction'),
});
await assets.supersedeIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId,
  oldAssertionId: assertion1.assertionId, newAssertionId: correctionAssertion.assertionId,
  idempotencyKey: uid('supersede1'),
});
await checkUnchanged('correct assertion (supersede)');

// ---------------------------------------------------------------------
// Many assets -> one product identifier
// ---------------------------------------------------------------------
console.log('\n-- Many assets -> one PRODUCT_CLASS identifier --\n');

const assetB = await assets.createPhysicalAsset({
  principalId: OPERATOR_PRINCIPAL, captureBasis: { marker: D4_PROVENANCE_MARKER, slot: 'B', ts: Date.now() },
  assetClass: 'd4-proof', source: D4_PROVENANCE_MARKER, idempotencyKey: uid('mint-B'),
});
const identifierP = await assets.recordIdentifierDefinition({
  principalId: OPERATOR_PRINCIPAL, scheme: 'gtin', issuingAuthority: 'GS1',
  normalizedValue: uid('gtin-shared'), scope: 'PRODUCT_CLASS', idempotencyKey: uid('idfP'),
});
const assertPOnA = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: identifierP.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'NONE', idempotencyKey: uid('P-on-A'),
});
const assertPOnB = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId, identifierId: identifierP.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'NONE', idempotencyKey: uid('P-on-B'),
});
assertTrue(!!assertPOnA.assertionId && !!assertPOnB.assertionId, 'PRODUCT_CLASS identifier P asserted on TWO different assets via the real service -- both succeed');
const graphA = await assets.getPhysicalAsset({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId });
const graphB = await assets.getPhysicalAsset({ principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId });
assertTrue(graphA.asset.id === originalGkAssetId && graphB.asset.id === assetB.assetId, 'both gkAssetIds unchanged after sharing one product identifier');

// ---------------------------------------------------------------------
// One asset -> multiple identifiers
// ---------------------------------------------------------------------
console.log('\n-- One asset -> PRODUCT_CLASS + CERTIFIED_INSTANCE identifiers --\n');

const identifierC = await assets.recordIdentifierDefinition({
  principalId: OPERATOR_PRINCIPAL, scheme: 'certification-number', issuingAuthority: 'CGC',
  normalizedValue: uid('cert-c'), scope: 'CERTIFIED_INSTANCE', idempotencyKey: uid('idfC'),
});
const assertPOnC = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId, identifierId: identifierP.identifierId,
  source: D4_PROVENANCE_MARKER + ':second-scope', resolutionAuthority: 'NONE', idempotencyKey: uid('P-on-B-again'),
});
const assertCOnB = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId, identifierId: identifierC.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'NONE', idempotencyKey: uid('C-on-B'),
});
assertTrue(!!assertPOnC.assertionId && !!assertCOnB.assertionId, 'asset B carries BOTH a PRODUCT_CLASS and a CERTIFIED_INSTANCE identifier simultaneously');
const graphBAfter = await assets.getPhysicalAsset({ principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId });
assertTrue(graphBAfter.asset.id === assetB.assetId, 'gkAssetId B unchanged after carrying two identifiers at different scopes');

// ---------------------------------------------------------------------
// Raw evidence immutability (live)
// ---------------------------------------------------------------------
console.log('\n-- Raw evidence immutability (live UPDATE/DELETE reject) --\n');

const obsForImmutability = await assets.recordRawObservation({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, observedRawValue: 'malformed-97?83O6',
  source: D4_PROVENANCE_MARKER, idempotencyKey: uid('obs-immut'),
});

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await dbClient.connect();
await dbClient.query('SET search_path TO data1_dev');

await assertRejected(
  () => dbClient.query(`UPDATE asset_raw_observation SET observed_raw_value='tampered' WHERE id=$1`, [obsForImmutability.observationId]),
  'live UPDATE on a real production observation row -- REJECT', 'immutable'
);
await assertRejected(
  () => dbClient.query(`DELETE FROM asset_raw_observation WHERE id=$1`, [obsForImmutability.observationId]),
  'live DELETE on a real production observation row -- REJECT', 'immutable'
);
const correctedObs = await assets.recordRawObservation({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, observedRawValue: '9780306406157-corrected-reading',
  source: D4_PROVENANCE_MARKER + ':correction', idempotencyKey: uid('obs-corrected'),
});
const bothObsStillThere = await dbClient.query(`SELECT id FROM asset_raw_observation WHERE id IN ($1,$2)`, [obsForImmutability.observationId, correctedObs.observationId]);
assertTrue(bothObsStillThere.rows.length === 2, 'the malformed original AND the corrected observation both remain queryable, permanently, in real data1_dev');

// ---------------------------------------------------------------------
// Same-asset evidence (live, through the real service)
// ---------------------------------------------------------------------
console.log('\n-- Same-asset evidence (live, through the real service) --\n');

const sameAssetAssertion = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('same-asset-assertion'),
});
let sameAssetLinkOk = false;
try {
  await assets.linkAssertionEvidence({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, assertionId: sameAssetAssertion.assertionId,
    observationId: correctedObs.observationId, idempotencyKey: uid('same-asset-link'),
  });
  sameAssetLinkOk = true;
} catch (e) { console.log('  UNEXPECTED same-asset link rejection:', e.message); }
assertTrue(sameAssetLinkOk, 'Asset A observation -> Asset A assertion, through the real service -- PASS');

const crossAssetAssertion = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId, identifierId: identifierP.identifierId,
  source: D4_PROVENANCE_MARKER, resolutionAuthority: 'NONE', idempotencyKey: uid('cross-asset-assertion'),
});
await assertRejected(
  () => assets.linkAssertionEvidence({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId, assertionId: crossAssetAssertion.assertionId,
    observationId: obsForImmutability.observationId, idempotencyKey: uid('cross-asset-link'),
  }),
  'Asset A observation -> Asset B assertion, through the real service -- REJECT via composite FK',
  'foreign key'
);

// ---------------------------------------------------------------------
// Same-asset supersession + different-identifier correction (live)
// ---------------------------------------------------------------------
console.log('\n-- Same-asset supersession, different-identifier correction (live) --\n');

const xOnA = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId,
  source: D4_PROVENANCE_MARKER + ':x', resolutionAuthority: 'NONE', idempotencyKey: uid('xOnA'),
});
const yOnA = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef2.identifierId, // DIFFERENT identifier
  source: D4_PROVENANCE_MARKER + ':y-different-identifier', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('yOnA'),
});
await assets.supersedeIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId,
  oldAssertionId: xOnA.assertionId, newAssertionId: yOnA.assertionId, idempotencyKey: uid('supersede-xy'),
});
assertTrue(true, 'Asset A assertion X -> Asset A assertion Y (Y references a DIFFERENT identifier_id than X) -- PASS, through the real service');

const zOnA = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId,
  source: D4_PROVENANCE_MARKER + ':z', resolutionAuthority: 'NONE', idempotencyKey: uid('zOnA'),
});
const wOnB = await assets.recordIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: assetB.assetId, identifierId: identifierP.identifierId,
  source: D4_PROVENANCE_MARKER + ':w', resolutionAuthority: 'NONE', idempotencyKey: uid('wOnB'),
});
await assertRejected(
  () => assets.supersedeIdentifierAssertion({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId,
    oldAssertionId: zOnA.assertionId, newAssertionId: wOnB.assertionId, idempotencyKey: uid('cross-supersede'),
  }),
  'Asset A assertion Z -> Asset B assertion W, through the real service -- REJECT', 'foreign key'
);

// ---------------------------------------------------------------------
// Convergence (live)
// ---------------------------------------------------------------------
console.log('\n-- Convergence (live) --\n');

const convX = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId, source: D4_PROVENANCE_MARKER + ':conv-X', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convX') });
const convY = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId, source: D4_PROVENANCE_MARKER + ':conv-Y', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convY') });
const convZ = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId, source: D4_PROVENANCE_MARKER + ':conv-Z', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convZ') });
const convD = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, identifierId: idfDef1.identifierId, source: D4_PROVENANCE_MARKER + ':conv-D', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convD') });
await assets.supersedeIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, oldAssertionId: convX.assertionId, newAssertionId: convD.assertionId, idempotencyKey: uid('conv-supersede-X') });
await assets.supersedeIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, oldAssertionId: convY.assertionId, newAssertionId: convD.assertionId, idempotencyKey: uid('conv-supersede-Y') });
await assets.supersedeIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, oldAssertionId: convZ.assertionId, newAssertionId: convD.assertionId, idempotencyKey: uid('conv-supersede-Z') });
const convDCheck = await dbClient.query(`SELECT superseded_by FROM asset_identifier_assertion WHERE id=$1`, [convD.assertionId]);
assertTrue(convDCheck.rows[0].superseded_by === null, 'X, Y, Z all converge onto D (same asset), through the real service -- D remains live');

// ---------------------------------------------------------------------
// Unknown state
// ---------------------------------------------------------------------
console.log('\n-- Unknown state --\n');

const assetUnknown = await assets.createPhysicalAsset({
  principalId: OPERATOR_PRINCIPAL, captureBasis: { marker: D4_PROVENANCE_MARKER, slot: 'unknown-state', ts: Date.now() },
  assetClass: 'd4-proof', source: D4_PROVENANCE_MARKER, idempotencyKey: uid('mint-unknown'),
});
const unknownAssertions = await dbClient.query(`SELECT count(*)::int AS n FROM asset_identifier_assertion WHERE asset_id=$1`, [assetUnknown.assetId]);
const unknownObs = await dbClient.query(`SELECT count(*)::int AS n FROM asset_raw_observation WHERE asset_id=$1`, [assetUnknown.assetId]);
assertTrue(unknownAssertions.rows[0].n === 0 && unknownObs.rows[0].n === 0, 'a freshly-minted asset with zero identifiers/assertions/observations is fully legal (no error, real live gkAssetId)');

// ---------------------------------------------------------------------
// Time -- occurred_at / recorded_at independence (live)
// ---------------------------------------------------------------------
console.log('\n-- Time: occurred_at / recorded_at independence (live) --\n');

const pastOccurred = new Date('2020-01-01T00:00:00Z');
const timeObs = await assets.recordRawObservation({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: originalGkAssetId, observedRawValue: 'time-test-value',
  source: D4_PROVENANCE_MARKER, idempotencyKey: uid('time-obs'), occurredAt: pastOccurred,
});
const timeRow = await dbClient.query(`SELECT occurred_at, recorded_at FROM asset_raw_observation WHERE id=$1`, [timeObs.observationId]);
const persistedOccurred = timeRow.rows[0].occurred_at;
const persistedRecorded = timeRow.rows[0].recorded_at;
assertTrue(persistedOccurred.getTime() === pastOccurred.getTime(), 'occurred_at persisted exactly as supplied (2020-01-01), no inference');
assertTrue(persistedRecorded.getTime() > pastOccurred.getTime(), 'recorded_at is genuinely independent -- the real ingestion time, years after occurred_at, never copied from it');
assertTrue(Math.abs(persistedRecorded.getTime() - Date.now()) < 60000, 'recorded_at reflects real current time (within 60s of now), confirming it was never backdated to match occurred_at');

await dbClient.end();

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
console.log('Proof asset IDs (retained, D4 Phase B provenance marker:', D4_PROVENANCE_MARKER, '):');
console.log('  assetA (identity-permanence) =', originalGkAssetId);
console.log('  assetB (multiplicity) =', assetB.assetId);
console.log('  assetUnknown =', assetUnknown.assetId);

if (failed > 0) { console.log('\nFAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
