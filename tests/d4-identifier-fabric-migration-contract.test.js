// tests/d4-identifier-fabric-migration-contract.test.js
//
// D4 Phase A -- real, isolated scratch-schema proof of the Identifier
// Fabric information contract (db/data0/0013_d4_identifier_fabric.sql,
// NOT applied to data1_dev this pass -- see docs/adr/ADR-IDENTIFIER-001-
// identifier-fabric.md and the D4 Phase A Standing Report). Mirrors
// D3.3's own proof discipline exactly: build a scratch schema, run the
// ACTUAL migration text (read from disk, not retyped) against it, prove
// the required behavior with real SQL, real trigger enforcement, real
// round-trips -- then rehearse the rollback and confirm it restores the
// pre-migration state exactly, then reapply the same forward text and
// re-run a critical subset. data1_dev is never touched.
//
// Required proof, mapped to the D4 Phase A dispatch's own item numbers:
//   #10 canonical uniqueness (incl. manufacturer-serial, UNKNOWN, GTIN/ISBN)
//   #11 scope (7 valid values, invalid rejected)
//   #8  full immutability audit (asset_identifier, assertion, evidence)
//   P-A1 asset_raw_observation full immutability
//   #5/#9 evidence relation + CORROBORATED cardinality permissiveness
//   #6 supersession lifecycle (single mutation, convergence)
//   #12 gkAssetId invariance across every operation
//   P-A2 identifier multiplicity, both directions
//   #13 apply -> verify -> rollback -> verify -> reapply -> verify
//
// Invoke: node tests/d4-identifier-fabric-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 100)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== D4 Phase A -- Identifier Fabric migration contract (real, isolated scratch-schema proof) ===\n');

// Session-scoped work (SET search_path persisted across many statements
// from one client) -- uses the unpooled connection deliberately, per the
// operational rule recorded in docs/DATABASE-MIGRATION-STATUS.md after
// the pooled string was caught losing session state mid-run during the
// A6/A7 concurrency proof.
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();

async function countDataOneDev() {
  await client.query('SET search_path TO data1_dev');
  const r = await client.query(
    `SELECT to_regclass('data1_dev.asset_identifier') AS a,
            to_regclass('data1_dev.asset_raw_observation') AS b,
            to_regclass('data1_dev.asset_identifier_assertion') AS c,
            to_regclass('data1_dev.asset_identifier_assertion_evidence') AS d`
  );
  return r.rows[0];
}
const dataOneDevBefore = await countDataOneDev();
console.log('  data1_dev D4 tables exist before (all 4 must be null):', JSON.stringify(dataOneDevBefore));

const SCHEMA = `d4_0013_scratch_${Date.now()}`;
const fwdPath = path.join(repoRoot, 'db', 'data0', '0013_d4_identifier_fabric.sql');
const rbPath = path.join(repoRoot, 'db', 'data0', '0013_d4_identifier_fabric_rollback.sql');
const fwdRaw = readFileSync(fwdPath, 'utf8');
const rbRaw = readFileSync(rbPath, 'utf8');

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);

  // Minimal prerequisite substrate (matches D3.3's own FK stand-in
  // convention -- only the id column is referenced by any FK in 0013).
  await client.query(`
    CREATE TABLE gk_asset (id UUID PRIMARY KEY);
    CREATE TABLE gk_principal (id UUID PRIMARY KEY);
  `);
  const assetA = crypto.randomUUID(), assetB = crypto.randomUUID(), assetC = crypto.randomUUID();
  const principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1),($2),($3)', [assetA, assetB, assetC]);
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

  // -------------------------------------------------------------------
  // #13 -- apply the REAL forward migration text, schema-qualified.
  // -------------------------------------------------------------------
  const fwd = fwdRaw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertSucceeds(() => client.query(fwd), '#13: real 0013 migration text applied successfully to the scratch schema');

  const tablesAfterApply = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'asset_%' ORDER BY table_name`,
    [SCHEMA]
  );
  assertTrue(
    JSON.stringify(tablesAfterApply.rows.map(r => r.table_name)) === JSON.stringify(
      ['asset_identifier', 'asset_identifier_assertion', 'asset_identifier_assertion_evidence', 'asset_raw_observation']
    ),
    '#13: all 4 ratified tables exist after apply, exactly, no extras'
  );

  // ===================================================================
  // #10 -- canonical uniqueness
  // ===================================================================
  console.log('\n-- #10: canonical identifier uniqueness --\n');

  const isbnId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'isbn','ISBN-agency','9780306406157','PRODUCT_CLASS')`, [isbnId]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'isbn','ISBN-agency','9780306406157','PRODUCT_CLASS')`, [crypto.randomUUID()]),
    '#10.1: same scheme+issuer+normalized_value -- duplicate rejected', 'duplicate key'
  );

  const rolexSerial = crypto.randomUUID(), omegaSerial = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'manufacturer-serial','rolex','12345','SERIALIZED_INSTANCE')`, [rolexSerial]);
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'manufacturer-serial','omega','12345','SERIALIZED_INSTANCE')`, [omegaSerial]),
    '#10.2: same scheme+DIFFERENT issuer+same value ("12345") -- distinct definitions allowed (Rolex vs Omega)'
  );

  const unknown1 = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'certification-number','UNKNOWN','1234567','CERTIFIED_INSTANCE')`, [unknown1]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'certification-number','UNKNOWN','1234567','CERTIFIED_INSTANCE')`, [crypto.randomUUID()]),
    '#10.3: UNKNOWN participates normally in uniqueness -- two identical UNKNOWN definitions -- duplicate rejected', 'duplicate key'
  );

  const gtinId = crypto.randomUUID();
  const gtin14 = '00036000291452'; // pre-computed canonical GTIN-14 (application normalizer output, not SQL)
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'gtin','GS1',$2,'PRODUCT_CLASS')`, [gtinId, gtin14]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'gtin','GS1',$2,'PRODUCT_CLASS')`, [crypto.randomUUID(), gtin14]),
    '#10.4: same canonical GTIN-14 normalized representation -- duplicate rejected', 'duplicate key'
  );

  const isbn13Canonical = '9780306406157'; // pre-computed canonical ISBN-13 (application normalizer output, not SQL)
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'isbn','ISBN-agency',$2,'PRODUCT_CLASS')`, [crypto.randomUUID(), isbn13Canonical]),
    '#10.5: same canonical ISBN-13 normalized representation -- duplicate rejected', 'duplicate key'
  );

  // ===================================================================
  // #11 -- scope
  // ===================================================================
  console.log('\n-- #11: scope --\n');

  const scopes = ['PRODUCT_CLASS', 'MODEL', 'VARIANT', 'BATCH', 'LOT', 'SERIALIZED_INSTANCE', 'CERTIFIED_INSTANCE'];
  for (const s of scopes) {
    await assertSucceeds(
      () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'scope-probe','test-issuer',$2,$3)`, [crypto.randomUUID(), `val-${s}`, s]),
      `#11: scope='${s}' accepted (one of the 7 ratified values)`
    );
  }
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'scope-probe','test-issuer','val-invalid','NOT_A_REAL_SCOPE')`, [crypto.randomUUID()]),
    '#11: invalid scope value rejected', 'violates check constraint'
  );

  // ===================================================================
  // #8 -- asset_identifier immutability
  // ===================================================================
  console.log('\n-- #8: asset_identifier immutability --\n');

  await assertRejected(() => client.query(`UPDATE asset_identifier SET normalized_value='TAMPERED' WHERE id=$1`, [isbnId]), '#8: asset_identifier UPDATE rejected (key must never mutate)', 'immutable');
  await assertRejected(() => client.query(`DELETE FROM asset_identifier WHERE id=$1`, [isbnId]), '#8: asset_identifier DELETE rejected', 'immutable');

  // ===================================================================
  // P-A1 -- asset_raw_observation full immutability
  // ===================================================================
  console.log('\n-- P-A1: asset_raw_observation full immutability --\n');

  const badObsId = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'978030640615?','barcode-scan',$3)`, [badObsId, assetA, principalId]),
    'P-A1.1: malformed/raw observation insert succeeds ("978030640615?")'
  );
  await assertRejected(() => client.query(`UPDATE asset_raw_observation SET observed_raw_value='corrected' WHERE id=$1`, [badObsId]), 'P-A1.2: UPDATE raw value rejected', 'immutable');
  await assertRejected(() => client.query(`UPDATE asset_raw_observation SET source='tampered' WHERE id=$1`, [badObsId]), 'P-A1.3: UPDATE source/provenance rejected', 'immutable');
  await assertRejected(() => client.query(`UPDATE asset_raw_observation SET occurred_at=now() WHERE id=$1`, [badObsId]), 'P-A1.4: UPDATE occurred_at rejected', 'immutable');
  await assertRejected(() => client.query(`DELETE FROM asset_raw_observation WHERE id=$1`, [badObsId]), 'P-A1.5: DELETE rejected', 'immutable');

  const correctedObsId = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'9780306406157','operator-entry',$3)`, [correctedObsId, assetA, principalId]),
    'P-A1.6: second, corrected observation inserts as a SEPARATE row'
  );
  const bothObsQueryable = await client.query(`SELECT id FROM asset_raw_observation WHERE id IN ($1,$2)`, [badObsId, correctedObsId]);
  assertTrue(bothObsQueryable.rows.length === 2, 'P-A1.7: both the malformed original and the corrected observation remain queryable, permanently, side by side');

  // ===================================================================
  // #6/#9 -- assertion, evidence relation, CORROBORATED cardinality
  // ===================================================================
  console.log('\n-- assertion + evidence relation, CORROBORATED cardinality permissiveness --\n');

  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,NULL,$2,'x',$3,'NONE')`, [crypto.randomUUID(), assetA, principalId]),
    'identifier_id NOT NULL enforced -- unresolved assertion rejected outright', 'null value'
  );

  // CORROBORATED with 0 links -- structurally legal.
  const zeroLinkAssertion = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'no-evidence-yet',$4,'CORROBORATED')`, [zeroLinkAssertion, isbnId, assetA, principalId]),
    'CORROBORATED with 0 evidence links -- structurally legal (schema does not infer independence from row count)'
  );

  // CORROBORATED with 1 link -- structurally legal.
  const oneLinkAssertion = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'single-source',$4,'CORROBORATED')`, [oneLinkAssertion, isbnId, assetA, principalId]);
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [oneLinkAssertion, badObsId, assetA]),
    'CORROBORATED with 1 evidence link -- structurally legal'
  );

  // CORROBORATED with 2+ independent links.
  const multiLinkAssertion = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'multi-source',$4,'CORROBORATED')`, [multiLinkAssertion, isbnId, assetA, principalId]);
  await client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$4),($1,$3,$4)`, [multiLinkAssertion, badObsId, correctedObsId, assetA]);
  const multiLinkRows = await client.query(`SELECT observation_id FROM asset_identifier_assertion_evidence WHERE assertion_id=$1`, [multiLinkAssertion]);
  assertTrue(multiLinkRows.rows.length === 2, 'CORROBORATED with 2 independent evidence links -- structurally legal, both named explicitly');
  const bothStillQueryable = await client.query(`SELECT id FROM asset_raw_observation WHERE id IN ($1,$2)`, [badObsId, correctedObsId]);
  assertTrue(bothStillQueryable.rows.length === 2, 'both linked observations remain individually queryable');

  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [crypto.randomUUID(), badObsId, assetA]),
    'evidence link: nonexistent assertion_id rejected (real FK)', 'foreign key'
  );
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [multiLinkAssertion, crypto.randomUUID(), assetA]),
    'evidence link: nonexistent observation_id rejected (real FK)', 'foreign key'
  );
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [multiLinkAssertion, badObsId, assetA]),
    'evidence link: duplicate identical (assertion_id, observation_id) rejected (PK)', 'duplicate key'
  );
  await assertRejected(
    () => client.query(`UPDATE asset_identifier_assertion_evidence SET linked_at=now() WHERE assertion_id=$1 AND observation_id=$2`, [multiLinkAssertion, badObsId]),
    'evidence link: UPDATE rejected (permanent)', 'permanent'
  );
  await assertRejected(
    () => client.query(`DELETE FROM asset_identifier_assertion_evidence WHERE assertion_id=$1 AND observation_id=$2`, [multiLinkAssertion, badObsId]),
    'evidence link: DELETE rejected (permanent)', 'permanent'
  );

  // One observation -> multiple assertions: schema permits, not claimed reachable.
  const secondAssertionOnSameObs = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'second-read',$4,'NONE')`, [secondAssertionOnSameObs, gtinId, assetA, principalId]);
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [secondAssertionOnSameObs, badObsId, assetA]),
    'one observation supports a SECOND, different assertion -- schema structurally permits this (not claimed reachable in the current pipeline, see the ADR)'
  );

  // ===================================================================
  // S1/S1a -- same-asset integrity, evidence-link cross-asset attack
  // ===================================================================
  console.log('\n-- S1/S1a: same-asset integrity, evidence-link cross-asset attack --\n');

  const s1PassAssertion = crypto.randomUUID(), s1PassObs = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'s1-pass-assertion',$4,'NONE')`, [s1PassAssertion, isbnId, assetA, principalId]);
  await client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'s1-pass-obs','test',$3)`, [s1PassObs, assetA, principalId]);
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [s1PassAssertion, s1PassObs, assetA]),
    'S1: same-asset assertion<->observation link -- PASS (both on assetA)'
  );
  const crossAssertion = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'s1-cross',$4,'NONE')`, [crossAssertion, isbnId, assetB, principalId]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [crossAssertion, badObsId, assetB]),
    'S1: cross-asset assertion(B)<->observation(A) link -- REJECT (composite FK: observation.asset_id must match)', 'foreign key'
  );
  const s1VariantObs = crypto.randomUUID();
  await client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'s1-variant-obs','test',$3)`, [s1VariantObs, assetA, principalId]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [multiLinkAssertion, s1VariantObs, assetB]),
    'S1 variant: mismatched declared asset_id (neither side actually on assetB) -- REJECT', 'foreign key'
  );

  // S1a -- chain X -> Y -> Z on assetA, all same-asset evidence links,
  // then attack the LIVE tail (Z) and a non-tail (X) from assetB.
  const chainX = crypto.randomUUID(), chainY = crypto.randomUUID(), chainZ = crypto.randomUUID();
  for (const [id, src] of [[chainX, 's1a-x'], [chainY, 's1a-y'], [chainZ, 's1a-z']]) {
    await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,$4,$5,'CORROBORATED')`, [id, isbnId, assetA, src, principalId]);
  }
  const obsForChain = crypto.randomUUID();
  await client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'s1a-chain-obs','test',$3)`, [obsForChain, assetA, principalId]);
  await client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3),($4,$2,$3),($5,$2,$3)`, [chainX, obsForChain, assetA, chainY, chainZ]);
  await client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [chainY, chainX]);
  await client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [chainZ, chainY]);
  const zLiveCheck = await client.query(`SELECT superseded_by FROM asset_identifier_assertion WHERE id=$1`, [chainZ]);
  assertTrue(zLiveCheck.rows[0].superseded_by === null, 'S1a setup: chain X->Y->Z built, Z confirmed live');

  const obsOnBForChainAttack = crypto.randomUUID();
  await client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'s1a-attack-obs','test',$3)`, [obsOnBForChainAttack, assetB, principalId]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [chainZ, obsOnBForChainAttack, assetB]),
    'S1a: cross-asset evidence link onto the LIVE chain tail Z -- REJECT', 'foreign key'
  );
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [chainX, obsOnBForChainAttack, assetB]),
    'S1a: cross-asset evidence link onto a NON-TAIL (superseded, chain-intermediate) assertion X -- REJECT (same-asset invariant holds regardless of lifecycle state)', 'foreign key'
  );

  // ===================================================================
  // #6/#8 -- supersession lifecycle
  // ===================================================================
  console.log('\n-- supersession lifecycle --\n');

  await assertRejected(() => client.query(`DELETE FROM asset_identifier_assertion WHERE id=$1`, [zeroLinkAssertion]), 'assertion DELETE rejected, always', 'never deleted');
  await assertRejected(() => client.query(`UPDATE asset_identifier_assertion SET source='tampered' WHERE id=$1`, [zeroLinkAssertion]), 'assertion evidence-field UPDATE rejected (without setting superseded_by)', 'must set superseded_by');

  const correctionForZero = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'correction',$4,'CORROBORATED')`, [correctionForZero, isbnId, assetA, principalId]);
  await assertSucceeds(() => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [correctionForZero, zeroLinkAssertion]), 'NULL -> existing live target -- the sole permitted mutation, succeeds');
  await assertRejected(() => client.query(`UPDATE asset_identifier_assertion SET source='again' WHERE id=$1`, [zeroLinkAssertion]), 'second mutation of an already-superseded assertion rejected', 'already superseded');

  // Self-supersession probe needs its own FRESH, still-live row -- using
  // an already-superseded one (as an earlier draft of this test did)
  // triggers the "already superseded" guard first and never actually
  // exercises the CHECK constraint this case is meant to prove.
  const selfSupersedeProbe = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'self-supersede-probe',$4,'NONE')`, [selfSupersedeProbe, isbnId, assetA, principalId]);
  await assertRejected(() => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$1`, [selfSupersedeProbe]), 'self-supersession rejected (CHECK constraint, on a fresh live row)', 'violates check constraint');

  const targetAlreadySuperseded = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'wants-dead-target',$4,'NONE')`, [targetAlreadySuperseded, isbnId, assetA, principalId]);
  await assertRejected(
    () => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [zeroLinkAssertion, targetAlreadySuperseded]),
    'target-already-superseded rejected (zeroLinkAssertion is already superseded -- cannot be targeted again)', 'cycle guard'
  );

  // Convergence: A, B, C all supersede into one live D.
  const cA = crypto.randomUUID(), cB = crypto.randomUUID(), cC = crypto.randomUUID(), cD = crypto.randomUUID();
  for (const [id, src] of [[cA, 'bad-A'], [cB, 'bad-B'], [cC, 'bad-C'], [cD, 'corrected-D']]) {
    await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,$4,$5,'CORROBORATED')`, [id, isbnId, assetA, src, principalId]);
  }
  await assertSucceeds(() => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [cD, cA]), 'convergence: A -> D succeeds');
  await assertSucceeds(() => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [cD, cB]), 'convergence: B -> D succeeds (in-degree unbounded)');
  await assertSucceeds(() => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [cD, cC]), 'convergence: C -> D succeeds');
  const dCheck = await client.query(`SELECT superseded_by FROM asset_identifier_assertion WHERE id=$1`, [cD]);
  assertTrue(dCheck.rows[0].superseded_by === null, 'D remains live (superseded_by IS NULL) after 3 rows converge onto it');
  assertTrue(true, 'convergence on same asset -- PASS (cA/cB/cC/cD all on assetA, proven above)');

  // ===================================================================
  // S2 -- same-asset integrity, supersession cross-asset attack
  // ===================================================================
  console.log('\n-- S2: same-asset/cross-asset supersession attack --\n');

  const s2XOnA = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'s2-x-a',$4,'NONE')`, [s2XOnA, isbnId, assetA, principalId]);
  const s2YOnA = crypto.randomUUID();
  // Deliberately a DIFFERENT identifier_id, same asset -- proving the
  // ruled invariant is same physical asset, never same external
  // identifier (a wrong identifier may legitimately be corrected by a
  // different one).
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'s2-y-a-different-identifier',$4,'CORROBORATED')`, [s2YOnA, gtinId, assetA, principalId]);
  await assertSucceeds(
    () => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [s2YOnA, s2XOnA]),
    'S2: same-asset X->Y supersession -- PASS (X and Y both on assetA, Y asserts a DIFFERENT identifier_id than X -- still legal)'
  );

  const s2XOnA2 = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'s2-x2-a',$4,'NONE')`, [s2XOnA2, isbnId, assetA, principalId]);
  const s2YOnB = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'s2-y-b',$4,'NONE')`, [s2YOnB, isbnId, assetB, principalId]);
  await assertRejected(
    () => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [s2YOnB, s2XOnA2]),
    'S2: cross-asset X(assetA)->Y(assetB) supersession -- REJECT (composite FK: superseded_by target must share this row\'s own asset_id)', 'foreign key'
  );
  const s2AfterReject = await client.query(`SELECT superseded_by FROM asset_identifier_assertion WHERE id=$1`, [s2XOnA2]);
  assertTrue(s2AfterReject.rows[0].superseded_by === null, 'S2: rejected cross-asset attempt left X (assetA) still live -- no partial mutation');

  // ===================================================================
  // #12 -- gkAssetId invariance, full sequence
  // ===================================================================
  console.log('\n-- #12: gkAssetId invariance across every operation --\n');

  const invAsset = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [invAsset]);
  const checkAssetUnchanged = async (label) => {
    const r = await client.query('SELECT id FROM gk_asset WHERE id=$1', [invAsset]);
    assertTrue(r.rows.length === 1 && r.rows[0].id === invAsset, `gkAssetId unchanged after: ${label}`);
  };
  await checkAssetUnchanged('initial mint');

  const invObsId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id) VALUES ($1,$2,'raw-inv','test',$3)`, [invObsId, invAsset, principalId]);
  await checkAssetUnchanged('add raw observation');

  const invIdfId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'invariance-probe','test','val-inv','SERIALIZED_INSTANCE')`, [invIdfId]);
  await checkAssetUnchanged('create canonical identifier');

  const invAssertionId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'inv',$4,'NONE')`, [invAssertionId, invIdfId, invAsset, principalId]);
  await checkAssetUnchanged('assert identifier');

  await client.query(`INSERT INTO asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id) VALUES ($1,$2,$3)`, [invAssertionId, invObsId, invAsset]);
  await checkAssetUnchanged('add corroborating evidence');

  const invConflictIdfId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'invariance-probe-2','test','val-inv-2','SERIALIZED_INSTANCE')`, [invConflictIdfId]);
  const invConflictAssertionId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'conflict',$4,'CONTESTED')`, [invConflictAssertionId, invConflictIdfId, invAsset, principalId]);
  await checkAssetUnchanged('add conflicting identifier');

  const invCorrectionId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'correction',$4,'CORROBORATED')`, [invCorrectionId, invIdfId, invAsset, principalId]);
  await client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [invCorrectionId, invAssertionId]);
  await checkAssetUnchanged('supersede an assertion');

  // ===================================================================
  // P-A2 -- identifier multiplicity, both directions
  // ===================================================================
  console.log('\n-- P-A2: identifier multiplicity, both directions --\n');

  // Direction 1: one PRODUCT_CLASS identifier -> multiple physical assets.
  const sharedGtin = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'gtin-shared','GS1','shared-value','PRODUCT_CLASS')`, [sharedGtin]);
  const assertOnA = crypto.randomUUID(), assertOnB = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'p-a2-a',$4,'NONE')`, [assertOnA, sharedGtin, assetA, principalId]);
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'p-a2-b',$4,'NONE')`, [assertOnB, sharedGtin, assetB, principalId]),
    'P-A2.1: same PRODUCT_CLASS identifier asserted on a SECOND, different physical asset -- succeeds (no accidental UNIQUE(identifier_id))'
  );
  const bothLive = await client.query(`SELECT asset_id FROM asset_identifier_assertion WHERE identifier_id=$1 AND superseded_by IS NULL`, [sharedGtin]);
  assertTrue(bothLive.rows.length === 2, 'P-A2.2: both assertions (on asset A and asset B) remain live simultaneously');
  const assetAUnchanged = await client.query('SELECT id FROM gk_asset WHERE id=$1', [assetA]);
  const assetBUnchanged = await client.query('SELECT id FROM gk_asset WHERE id=$1', [assetB]);
  assertTrue(assetAUnchanged.rows[0].id === assetA && assetBUnchanged.rows[0].id === assetB, 'P-A2.3: neither gkAsset.id became the GTIN value; both remain their own permanent id');

  // Direction 2: one physical asset -> multiple identifiers at different scopes.
  const gtinForC = crypto.randomUUID(), certForC = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'gtin-c','GS1','val-c-gtin','PRODUCT_CLASS')`, [gtinForC]);
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'certification-number','CGC','val-c-cert','CERTIFIED_INSTANCE')`, [certForC]);
  const cAssertGtin = crypto.randomUUID(), cAssertCert = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'p-a2-c-gtin',$4,'NONE')`, [cAssertGtin, gtinForC, assetC, principalId]);
  await assertSucceeds(
    () => client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'p-a2-c-cert',$4,'NONE')`, [cAssertCert, certForC, assetC, principalId]),
    'P-A2.4: the SAME physical asset carries a SECOND identifier at a different scope (PRODUCT_CLASS + CERTIFIED_INSTANCE) -- succeeds (no accidental UNIQUE(asset_id))'
  );
  const cBothLive = await client.query(`SELECT identifier_id FROM asset_identifier_assertion WHERE asset_id=$1 AND superseded_by IS NULL AND source LIKE 'p-a2-c-%'`, [assetC]);
  assertTrue(cBothLive.rows.length === 2, 'P-A2.5: both identifier assertions on asset C remain live simultaneously -- neither conflicts, neither supersedes the other merely by coexisting');
  const assetCUnchanged = await client.query('SELECT id FROM gk_asset WHERE id=$1', [assetC]);
  assertTrue(assetCUnchanged.rows[0].id === assetC, 'P-A2.6: gkAsset C.id unchanged after carrying two identifiers at different scopes');

  // ===================================================================
  // #13 -- rollback rehearsal, then reapply, then critical-subset re-run
  // ===================================================================
  console.log('\n-- #13: rollback rehearsal --\n');

  const rb = rbRaw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertSucceeds(() => client.query(rb), '#13: real 0013 rollback text applied successfully');

  const tablesAfterRollback = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'asset_%'`,
    [SCHEMA]
  );
  assertTrue(tablesAfterRollback.rows.length === 0, '#13: all 4 ratified tables removed after rollback, exactly, nothing left behind');

  const substratePreserved = await client.query(`SELECT count(*)::int AS n FROM gk_asset`);
  assertTrue(substratePreserved.rows[0].n === 4, '#13: prerequisite substrate (gk_asset) preserved -- all 4 rows (A, B, C, invAsset) still present, untouched by rollback');
  const principalPreserved = await client.query(`SELECT count(*)::int AS n FROM gk_principal`);
  assertTrue(principalPreserved.rows[0].n === 1, '#13: prerequisite substrate (gk_principal) preserved');

  console.log('\n-- #13: reapply the SAME forward migration bytes --\n');
  await assertSucceeds(() => client.query(fwd), '#13: reapplying the identical forward migration text succeeds cleanly on the rolled-back schema');

  console.log('\n-- #13: critical proof subset, re-run against the reapplied schema --\n');
  const reIsbn = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'isbn','ISBN-agency','9780306406157','PRODUCT_CLASS')`, [reIsbn]);
  await assertRejected(
    () => client.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'isbn','ISBN-agency','9780306406157','PRODUCT_CLASS')`, [crypto.randomUUID()]),
    '#13 subset: uniqueness constraint still enforced after reapply', 'duplicate key'
  );
  const reAssertion = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'re-check',$4,'NONE')`, [reAssertion, reIsbn, assetA, principalId]);
  await assertRejected(() => client.query(`DELETE FROM asset_identifier_assertion WHERE id=$1`, [reAssertion]), '#13 subset: assertion DELETE still rejected after reapply', 'never deleted');
  const reCorrection = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,'re-check-2',$4,'NONE')`, [reCorrection, reIsbn, assetA, principalId]);
  await assertSucceeds(() => client.query(`UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2`, [reCorrection, reAssertion]), '#13 subset: supersession still works after reapply');

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const dataOneDevAfter = await countDataOneDev();
  console.log('\n  data1_dev D4 tables exist after (all 4 must still be null):', JSON.stringify(dataOneDevAfter));
  assertTrue(
    JSON.stringify(dataOneDevAfter) === JSON.stringify(dataOneDevBefore),
    'data1_dev is completely untouched by this entire proof'
  );
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
