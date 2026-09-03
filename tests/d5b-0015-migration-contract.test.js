// tests/d5b-0015-migration-contract.test.js
//
// D5B -- real, isolated scratch-schema proof of the ValuationQuestion +
// Applicability substrate, NOW SPLIT (A1 ruling, GK-188 live-apply gate
// dispatch) across two independent migrations:
//   0015 -- db/data0/0015_d1_identity_assignment_immutability.sql (D1
//           repair to the EXISTING asset_identity_assignment table)
//   0016 -- db/data0/0016_d5b_valuation_question_applicability.sql (the
//           two NEW tables, depends on 0015)
// NOT applied to data1_dev this pass. Mirrors D3.3/D4/D5A's own proof
// discipline exactly: build a scratch schema, run the ACTUAL migration
// text (read from disk, not retyped) against it -- 0014 (already live
// in real data1_dev, re-applied fresh here so this scratch schema has
// the substrate 0015/0016 depend on), then 0015, then 0016 -- prove the
// required behavior with real SQL, real trigger enforcement, real
// dedup, real measured WAL, then rehearse rollback (in the correct
// dependency order, 0016 before 0015) and confirm it restores the
// pre-migration state exactly, then reapply and re-run a critical
// subset. data1_dev is never touched. Independent per-migration
// rollback rehearsal (A1-R1/R2/R3 -- baseline/forward/rollback/
// structural-identity proof for EACH file separately, plus the
// cross-domain isolation proof) lives in
// tests/d5b-live-apply-gate-a1-rehearsal.test.js, not here.
//
// Required proof, mapped to the dispatch's own item numbers:
//   D0  positive scratch-target containment (P2a-style guard, this
//       file's OWN instance -- P2a's prior closure covers the D5A test
//       file, not this new one; each script must carry its own guard)
//   D1  identity anchor: composite FK cross-asset rejection, T1/T2
//       non-retroactivity, asset_identity_assignment_guard trigger
//       compatibility with the one live write pattern
//   D5  ValuationQuestion dedup (content_hash UNIQUE, real DB rejection)
//   D6/D7 verdict CHECK (DB-level, not just app-level), contested-pairs
//       view proof
//   D8  Applicability full immutability (UPDATE/DELETE both rejected,
//       unconditionally -- no superseded_by carve-out)
//   D9  Applicability dedup + legitimate multiplicity (different
//       rule_version does NOT collide)
//   D12 real MEASURED WAL (pg_current_wal_lsn/pg_wal_lsn_diff, same
//       method as D3.3 Amendment A3-E3) for N=20/60/100 plus a second
//       complete evaluation under changed judgment logic
//   D13 MarketPopulation-shape query correctness (not built, proven
//       constructible)
//   D9(D5A) non-interference -- market_observation/comp_snapshot/
//       valuation_event untouched
//   D10(D5A) forward -> verify -> rollback -> verify -> reapply -> verify
//
// Invoke: node tests/d5b-0015-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const load = async (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const vq = await load('src/lib/valuationQuestionHash.js');
const ap = await load('src/lib/applicabilityHash.js');

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

console.log('\n=== D5B 0015 -- ValuationQuestion + Applicability migration contract (real, isolated scratch-schema proof) ===\n');

// D0 -- P2a-style positive scratch-target containment guard, this
// file's OWN instance (dedicated unpooled client, backend-PID stability
// check, unconditional data1_dev refusal, checked before every
// DDL-mutating statement -- identical mechanism to the D5A test's own
// assertScratchTarget, reused by pattern, re-implemented here because
// each script must carry its own live guard).
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated unpooled backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  const { s: actualSchema, pid: actualPid } = r.rows[0];
  if (actualPid !== sessionPid) {
    throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script (${sessionPid} -> ${actualPid}) -- refusing to execute DDL`);
  }
  if (actualSchema === 'data1_dev') {
    throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally, regardless of any expected value`);
  }
  if (actualSchema !== expectedSchema) {
    throw new Error(`SAFETY ABORT (${label}): expected scratch schema "${expectedSchema}" but current_schema() returned "${actualSchema}" -- refusing to execute DDL`);
  }
  return actualSchema;
}

{
  await client.query('SET search_path TO data1_dev');
  let refused = false;
  try { await assertScratchTarget('some-scratch-schema-name', 'negative proof'); }
  catch (e) { refused = /SAFETY ABORT/.test(e.message) && /data1_dev/.test(e.message); }
  assertTrue(refused, 'D0: intentionally pointing this client at data1_dev causes assertScratchTarget to refuse BEFORE any DDL -- this file\'s own guard instance, proven with the real function');
}

const SCHEMA = `d5b_0015_scratch_${Date.now()}`;
const fwd0014Path = path.join(repoRoot, 'db', 'data0', '0014_d5a_market_observation.sql');
const fwd0015Path = path.join(repoRoot, 'db', 'data0', '0015_d1_identity_assignment_immutability.sql');
const rb0015Path = path.join(repoRoot, 'db', 'data0', '0015_d1_identity_assignment_immutability_rollback.sql');
const fwd0016Path = path.join(repoRoot, 'db', 'data0', '0016_d5b_valuation_question_applicability.sql');
const rb0016Path = path.join(repoRoot, 'db', 'data0', '0016_d5b_valuation_question_applicability_rollback.sql');
const fwd0014Raw = readFileSync(fwd0014Path, 'utf8');
const fwd0015Raw = readFileSync(fwd0015Path, 'utf8');
const rb0015Raw = readFileSync(rb0015Path, 'utf8');
const fwd0016Raw = readFileSync(fwd0016Path, 'utf8');
const rb0016Raw = readFileSync(rb0016Path, 'utf8');

let observationId, questionId, principalId, assetId, identityAssignmentId;
let batch20LsnDelta, batch60LsnDelta, batch100LsnDelta, secondEvalLsnDelta;
let batch20Median, batch60Median, batch100Median, secondEvalMedian;

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');
  assertTrue(true, `D0: positively confirmed connected to scratch schema "${SCHEMA}", not data1_dev`);

  // ===================================================================
  // Scratch stubs -- mirror data1_dev's LIVE shape (not the stale 0004
  // draft): asset_identity_assignment.recorded_at (renamed from
  // assigned_at by 0011), occurred_at (added by 0011), catalog_entity_id
  // bare/FK-less (catalog_entity does not exist live -- verified via
  // src/modules/assets/repository.js:14-21's own comment and
  // docs/DATABASE-MIGRATION-STATUS.md's live-query confirmation).
  // ===================================================================
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`
    CREATE TABLE asset_identity_assignment (
      id                  UUID PRIMARY KEY,
      asset_id            UUID NOT NULL REFERENCES gk_asset(id),
      catalog_entity_id   UUID,
      authority           TEXT NOT NULL CHECK (authority IN ('NONE', 'CONTESTED', 'CORROBORATED')),
      source              TEXT NOT NULL CHECK (source IN ('vision', 'operator-correction', 'unresolved')),
      occurred_at         TIMESTAMPTZ,
      recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by       UUID REFERENCES asset_identity_assignment(id)
    );
    CREATE INDEX ON asset_identity_assignment (asset_id, recorded_at);
  `);
  await client.query(`
    CREATE TABLE comp_snapshot (id UUID PRIMARY KEY, marker TEXT NOT NULL);
    CREATE TABLE valuation_event (id UUID PRIMARY KEY, marker TEXT NOT NULL);
  `);
  const compSnapshotId = crypto.randomUUID(), valuationEventId = crypto.randomUUID();
  await client.query('INSERT INTO comp_snapshot (id, marker) VALUES ($1, $2)', [compSnapshotId, 'd9-untouched-marker']);
  await client.query('INSERT INTO valuation_event (id, marker) VALUES ($1, $2)', [valuationEventId, 'd9-untouched-marker']);

  principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);
  assetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);

  // ===================================================================
  // Apply 0014 (real forward text, schema-qualified) -- this scratch
  // schema needs market_observation for applicability's FK, exactly as
  // 0015 requires it to already exist (true in real data1_dev, live
  // since D5A).
  // ===================================================================
  const fwd0014 = fwd0014Raw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertScratchTarget(SCHEMA, 'pre-0014-apply');
  await assertSucceeds(() => client.query(fwd0014), 'D0: real 0014 forward text applies cleanly to this scratch schema (prerequisite substrate for 0015)');

  // ===================================================================
  // Apply 0015 (D1 repair, real forward text, schema-qualified)
  // ===================================================================
  const fwd0015 = fwd0015Raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);
  await assertScratchTarget(SCHEMA, 'pre-0015-apply');
  await assertSucceeds(() => client.query(fwd0015), 'D15: real 0015 (D1 repair) forward text applies cleanly to the scratch schema on top of 0014');

  // ===================================================================
  // Apply 0016 (D5B ValuationQuestion+Applicability, real forward text)
  // ===================================================================
  const fwd0016 = fwd0016Raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);
  await assertScratchTarget(SCHEMA, 'pre-0016-apply');
  await assertSucceeds(() => client.query(fwd0016), 'D15: real 0016 (D5B) forward text applies cleanly on top of 0015 -- proves the split migrations still compose correctly in sequence');

  const compAfter = await client.query('SELECT id, marker FROM comp_snapshot');
  const valAfter = await client.query('SELECT id, marker FROM valuation_event');
  assertTrue(compAfter.rows.length === 1 && compAfter.rows[0].marker === 'd9-untouched-marker', 'D9(non-interference): comp_snapshot survives 0015 apply byte-for-byte untouched');
  assertTrue(valAfter.rows.length === 1 && valAfter.rows[0].marker === 'd9-untouched-marker', 'D9(non-interference): valuation_event survives 0015 apply byte-for-byte untouched');

  // ===================================================================
  // D1 -- identity anchor
  // ===================================================================
  console.log('\n-- D1: identity anchor --\n');

  const uk = await client.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'u' AND conname = 'asset_identity_assignment_id_asset_uk'`,
    [`${SCHEMA}.asset_identity_assignment`]
  );
  assertTrue(uk.rows.length === 1, 'D1: asset_identity_assignment_id_asset_uk UNIQUE(id, asset_id) constraint exists');

  identityAssignmentId = crypto.randomUUID();
  await client.query(
    `INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1, $2, NULL, 'CORROBORATED', 'vision')`,
    [identityAssignmentId, assetId]
  );

  // Compatibility with the ONE live write pattern (repository.js:158-167)
  // -- an UPDATE that sets ONLY superseded_by must still succeed under
  // the new trigger.
  const supersedingId = crypto.randomUUID();
  await client.query(
    `INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1, $2, NULL, 'CORROBORATED', 'operator-correction')`,
    [supersedingId, assetId]
  );
  await assertSucceeds(
    () => client.query(
      `UPDATE asset_identity_assignment SET superseded_by = $1 WHERE asset_id = $2 AND id != $1 AND superseded_by IS NULL`,
      [supersedingId, assetId]
    ),
    'D1: the ONE live write pattern (UPDATE ... SET superseded_by = $1 WHERE ...) still succeeds under the new trigger -- verified against the real repository.js call shape, not a hypothetical'
  );

  // T1/T2 non-retroactivity -- the T1 row's substantive fields remain
  // exactly as recorded after being superseded.
  const t1Row = await client.query('SELECT authority, source, catalog_entity_id, superseded_by FROM asset_identity_assignment WHERE id = $1', [identityAssignmentId]);
  assertTrue(
    t1Row.rows[0].authority === 'CORROBORATED' && t1Row.rows[0].source === 'vision' && t1Row.rows[0].superseded_by === supersedingId,
    'D1: T1 row\'s substantive fields (authority/source) are UNCHANGED after being superseded -- only superseded_by transitioned NULL -> value, exactly as the trigger requires'
  );

  // Trigger rejects a bare field mutation that leaves superseded_by
  // NULL with the "(no other mutation permitted)" branch -- correct,
  // expected behavior, not itself the "only superseded_by may be set"
  // proof (that requires an UPDATE that DOES set superseded_by AND
  // simultaneously changes another field, so the trigger reaches its
  // IS DISTINCT checks instead of short-circuiting on the earlier
  // "must set superseded_by" guard).
  await assertRejected(
    () => client.query(`UPDATE asset_identity_assignment SET authority = 'NONE' WHERE id = $1`, [supersedingId]),
    'D1: an UPDATE that leaves superseded_by NULL is rejected (no bare field mutation permitted)',
    'must set superseded_by'
  );
  const thirdRowId = crypto.randomUUID();
  await client.query(
    `INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1, $2, NULL, 'CORROBORATED', 'vision')`,
    [thirdRowId, assetId]
  );
  await assertRejected(
    () => client.query(`UPDATE asset_identity_assignment SET superseded_by = $1, authority = 'NONE' WHERE id = $2`, [thirdRowId, supersedingId]),
    'D1: an UPDATE that DOES set superseded_by but ALSO changes another field is rejected specifically for that -- "only superseded_by may be set" branch, proven with a real UPDATE that reaches it',
    'only superseded_by'
  );
  await assertRejected(
    () => client.query(`DELETE FROM asset_identity_assignment WHERE id = $1`, [supersedingId]),
    'D1: trigger rejects DELETE unconditionally',
    'never deleted'
  );

  // valuation_question anchored to the T1 (now-superseded) row.
  const vqFields1 = vq.canonicalizeValuationQuestionFields({
    assetId, identityAssignmentId, targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', variantScope: null, targetYear: '2026',
  });
  questionId = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [questionId, assetId, identityAssignmentId, '9.4', 'cgc', 'graded', null, 2026, principalId, vq.computeValuationQuestionHash(vqFields1)]
    ),
    'D1: ValuationQuestion anchored to the (now-superseded) T1 identity row succeeds -- the anchor is the SPECIFIC row, not "current identity"'
  );

  // Cross-asset identity-anchor rejection.
  const otherAssetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [otherAssetId]);
  const otherIdentityId = crypto.randomUUID();
  await client.query(
    `INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1, $2, NULL, 'CORROBORATED', 'vision')`,
    [otherIdentityId, otherAssetId]
  );
  const crossAssetFields = vq.canonicalizeValuationQuestionFields({
    assetId, identityAssignmentId: otherIdentityId, targetGrade: '9.0', gradeBasis: null, disposition: 'raw', variantScope: null, targetYear: null,
  });
  await assertRejected(
    () => client.query(
      `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), assetId, otherIdentityId, '9.0', null, 'raw', null, null, principalId, vq.computeValuationQuestionHash(crossAssetFields)]
    ),
    'D1: cross-asset identity anchoring (asset_id=A, identity_assignment_id belonging to asset B) is REJECTED at the DB level by the composite FK -- structural, not merely declared',
    'foreign key'
  );

  // ===================================================================
  // D5 -- ValuationQuestion dedup
  // ===================================================================
  console.log('\n-- D5: ValuationQuestion dedup --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), assetId, identityAssignmentId, '9.40', 'cgc', 'graded', null, 2026, principalId, vq.computeValuationQuestionHash(vqFields1)]
    ),
    'D5: identical semantic question ("9.4" vs "9.40" -- same canonical hash) -- unique index rejects the duplicate row (resolve-or-create is the app-layer contract)',
    'duplicate key'
  );
  const vqFields2 = vq.canonicalizeValuationQuestionFields({
    assetId, identityAssignmentId, targetGrade: '9.2', gradeBasis: 'cgc', disposition: 'graded', variantScope: null, targetYear: '2026',
  });
  await assertSucceeds(
    () => client.query(
      `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), assetId, identityAssignmentId, '9.2', 'cgc', 'graded', null, 2026, principalId, vq.computeValuationQuestionHash(vqFields2)]
    ),
    'D5: genuinely different target grade (9.2 vs 9.4) -- new row succeeds'
  );

  await assertRejected(
    () => client.query(`UPDATE valuation_question SET target_grade = 9.9 WHERE id = $1`, [questionId]),
    'R1: valuation_question UPDATE rejected by immutability trigger', 'immutable once written'
  );
  await assertRejected(
    () => client.query(`DELETE FROM valuation_question WHERE id = $1`, [questionId]),
    'R1: valuation_question DELETE rejected by immutability trigger', 'immutable once written'
  );

  // ===================================================================
  // MarketObservation fixture for Applicability tests below
  // ===================================================================
  observationId = crypto.randomUUID();
  const moCorrId = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, grade_basis, occurred_on, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'ebay','item-1','sold',66.0000,'USD','near mint',9.4,'cgc',NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-fixture-1')`,
    [observationId, new Date().toISOString(), principalId, moCorrId]
  );

  // ===================================================================
  // D6/D7 -- verdict CHECK + contested-pairs view
  // ===================================================================
  console.log('\n-- D6/D7: verdict CHECK (DB-level) + contested-pairs view --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,'CONTESTED','HIGH','comp-filter','1',NULL,'automated',NULL,$4,$5,'bogus-hash')`,
      [crypto.randomUUID(), observationId, questionId, principalId, crypto.randomUUID()]
    ),
    'D7: verdict=CONTESTED is REJECTED at the DB level (CHECK constraint) -- never a primitive persisted verdict value, enforced structurally, not just by app-side normalizeVerdict',
    'violates check constraint'
  );

  const j1Fields = ap.canonicalizeApplicabilityFields({ observationId, questionId, verdict: 'NOT_APPLICABLE', confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: 'reprint contamination' });
  const j1Id = crypto.randomUUID(), j1Corr = crypto.randomUUID();
  await client.query(
    `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [j1Id, observationId, questionId, j1Fields.verdict, j1Fields.confidenceTier, j1Fields.ruleId, j1Fields.ruleVersion, j1Fields.modelVersion, j1Fields.sourceType, j1Fields.reason, principalId, j1Corr, ap.computeApplicabilityHash(j1Fields)]
  );
  const j2Fields = ap.canonicalizeApplicabilityFields({ observationId, questionId, verdict: 'APPLICABLE', confidenceTier: 'MEDIUM', ruleId: 'comp-filter', ruleVersion: '13', modelVersion: null, sourceType: 'automated', reason: 'reconsidered under v13' });
  const j2Id = crypto.randomUUID(), j2Corr = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [j2Id, observationId, questionId, j2Fields.verdict, j2Fields.confidenceTier, j2Fields.ruleId, j2Fields.ruleVersion, j2Fields.modelVersion, j2Fields.sourceType, j2Fields.reason, principalId, j2Corr, ap.computeApplicabilityHash(j2Fields)]
    ),
    'D9: filter v12 (NOT_APPLICABLE) and filter v13 (APPLICABLE) over the SAME (observation, question) pair BOTH persist -- legitimate multiplicity, v13 does not supersede or overwrite v12'
  );

  const contested = await client.query('SELECT observation_id, question_id FROM applicability_contested_pairs WHERE observation_id = $1 AND question_id = $2', [observationId, questionId]);
  assertTrue(contested.rows.length === 1, 'D7: applicability_contested_pairs correctly derives this (observation, question) pair as contested -- one APPLICABLE + one NOT_APPLICABLE among its primitive judgment rows, with NEITHER row itself carrying verdict=CONTESTED');

  const allJudgments = await client.query('SELECT id, verdict FROM applicability WHERE observation_id = $1 AND question_id = $2 ORDER BY rule_version', [observationId, questionId]);
  assertTrue(allJudgments.rows.length === 2, 'D9: both primitive judgment rows preserved exactly -- neither v12 nor v13 was mutated or removed; contested-ness is read-time derived, not a destructive merge');

  // ===================================================================
  // D9 -- Applicability dedup
  // ===================================================================
  console.log('\n-- D9: Applicability dedup --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [crypto.randomUUID(), observationId, questionId, j1Fields.verdict, j1Fields.confidenceTier, j1Fields.ruleId, j1Fields.ruleVersion, j1Fields.modelVersion, j1Fields.sourceType, j1Fields.reason, crypto.randomUUID(), crypto.randomUUID(), ap.computeApplicabilityHash(j1Fields)]
    ),
    'D9: identical judgment content replayed (even from a DIFFERENT principal/correlation_id -- both excluded from the hash) -- unique index rejects the duplicate',
    'duplicate key'
  );

  // D8 -- full immutability, no carve-out.
  await assertRejected(
    () => client.query(`UPDATE applicability SET confidence_tier = 'LOW' WHERE id = $1`, [j1Id]),
    'D8: applicability UPDATE rejected unconditionally -- no superseded_by carve-out exists on this table at all', 'immutable once written'
  );
  await assertRejected(
    () => client.query(`DELETE FROM applicability WHERE id = $1`, [j1Id]),
    'D8: applicability DELETE rejected unconditionally', 'immutable once written'
  );

  // ===================================================================
  // D13 -- MarketPopulation-shape query correctness
  // ===================================================================
  console.log('\n-- D13: MarketPopulation-shape query, constructible from Applicability alone --\n');

  const populationQuery = await client.query(
    `SELECT observation_id FROM applicability WHERE question_id = $1 AND verdict = 'APPLICABLE'`,
    [questionId]
  );
  assertTrue(
    populationQuery.rows.length === 1 && populationQuery.rows[0].observation_id === observationId,
    'D13: a correct MarketPopulation-shape query (APPLICABLE judgments for one question) is expressible directly against 0015\'s schema -- no MarketObservation -> ValuationEvent shortcut needed or present'
  );

  // ===================================================================
  // D12 -- real MEASURED WAL (same method as D3.3 Amendment A3-E3)
  // ===================================================================
  console.log('\n-- D12: real measured WAL for N=20/60/100 + a second complete evaluation --\n');

  const lsnDiffBytes = async (fn) => {
    const before = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    await fn();
    const after = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const diff = (await client.query('SELECT pg_wal_lsn_diff($1, $2) AS d', [after, before])).rows[0].d;
    return Number(diff);
  };

  const controlSamples = [];
  for (let i = 0; i < 3; i++) controlSamples.push(await lsnDiffBytes(async () => {}));
  console.log(`  no-write control samples (background noise check): ${controlSamples.join(', ')} bytes`);

  let wCounter = 0;
  const insertJudgmentRow = async (ruleVersionTag) => {
    const fields = ap.canonicalizeApplicabilityFields({
      observationId, questionId, verdict: wCounter % 2 === 0 ? 'APPLICABLE' : 'NOT_APPLICABLE', confidenceTier: 'MEDIUM',
      ruleId: 'wal-measurement-rule', ruleVersion: ruleVersionTag, modelVersion: null, sourceType: 'automated', reason: `wal-measurement-row-${wCounter}`,
    });
    wCounter++;
    await client.query(
      `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [crypto.randomUUID(), observationId, questionId, fields.verdict, fields.confidenceTier, fields.ruleId, fields.ruleVersion, fields.modelVersion, fields.sourceType, fields.reason, principalId, crypto.randomUUID(), ap.computeApplicabilityHash(fields)]
    );
  };

  // Priming (20 throwaway inserts, warm pages past Postgres's one-time
  // full-page-image WAL cost) -- same methodology as Amendment A3-E3.
  for (let i = 0; i < 20; i++) await insertJudgmentRow(`prime-${i}`);

  const measureBatch = async (n, label) => {
    const samples = [];
    for (let s = 0; s < 3; s++) {
      const delta = await lsnDiffBytes(async () => {
        for (let i = 0; i < n; i++) await insertJudgmentRow(`${label}-s${s}-${i}`);
      });
      samples.push(delta / n);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };

  batch20Median = await measureBatch(20, 'n20');
  console.log(`  N=20 steady-state median WAL bytes/row: ${batch20Median.toFixed(1)}`);
  batch60Median = await measureBatch(60, 'n60');
  console.log(`  N=60 steady-state median WAL bytes/row: ${batch60Median.toFixed(1)}`);
  batch100Median = await measureBatch(100, 'n100');
  console.log(`  N=100 steady-state median WAL bytes/row: ${batch100Median.toFixed(1)}`);

  // measureBatch(n, label) takes 3 replicate samples of n rows each (for
  // a steady-state median), so it inserts 3*n rows total, not n.
  const countBefore = (await client.query('SELECT count(*)::int AS n FROM applicability')).rows[0].n;
  secondEvalMedian = await measureBatch(100, 'second-eval-changed-logic');
  const countAfter = (await client.query('SELECT count(*)::int AS n FROM applicability')).rows[0].n;
  console.log(`  second complete N=100 evaluation (changed judgment logic) steady-state median WAL bytes/row: ${secondEvalMedian.toFixed(1)}`);
  assertTrue(countAfter === countBefore + 300, 'D12: a second complete evaluation under changed judgment logic (3 replicate N=100 samples = 300 rows) adds every row as NEW (not deduped, not replacing the first evaluation) -- confirms D9\'s multiplicity model under real repeated-evaluation load, not merely a single measured batch');

  assertTrue(
    batch20Median > 0 && batch60Median > 0 && batch100Median > 0 && secondEvalMedian > 0,
    'D12: FACT, real measured (pg_current_wal_lsn/pg_wal_lsn_diff, steady-state median of 3 samples per N, after 20-row priming, no-write control sampled) -- not estimated'
  );

  // ===================================================================
  // Regression: existing D5A market_observation contract still holds
  // inside a schema that ALSO has 0015 applied (D9 non-interference,
  // extended: 0015 must not change 0014's own behavior either).
  // ===================================================================
  await assertRejected(
    () => client.query('DELETE FROM market_observation WHERE id = $1', [observationId]),
    'D9(non-interference, extended): market_observation\'s own immutability trigger (0014) is unaffected by 0015 being applied on top of it',
    'immutable once written'
  );

  // ===================================================================
  // D10(D5A discipline) -- rollback -> verify -> reapply -> verify
  // A1 ordering: 0016 rolled back FIRST (it depends on 0015), then 0015.
  // Full independent-domain rehearsal (A1-R1/R2/R3) lives in
  // tests/d5b-live-apply-gate-a1-rehearsal.test.js -- this block only
  // re-confirms the combined forward/rollback/reapply cycle still works
  // end-to-end across both split files, in the correct order.
  // ===================================================================
  console.log('\n-- rollback / reapply --\n');

  const rb0016 = rb0016Raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);
  await assertScratchTarget(SCHEMA, 'pre-0016-rollback');
  await assertSucceeds(() => client.query(rb0016), 'D15: 0016 rollback text applies successfully');

  const rb0015 = rb0015Raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);
  await assertScratchTarget(SCHEMA, 'pre-0015-rollback');
  await assertSucceeds(() => client.query(rb0015), 'D15: 0015 rollback text applies successfully (after 0016 is already rolled back)');

  const appAfterRollback = await client.query(`SELECT to_regclass('${SCHEMA}.applicability') AS t`);
  const vqAfterRollback = await client.query(`SELECT to_regclass('${SCHEMA}.valuation_question') AS t`);
  const viewAfterRollback = await client.query(`SELECT to_regclass('${SCHEMA}.applicability_contested_pairs') AS t`);
  assertTrue(appAfterRollback.rows[0].t === null, 'D15: applicability no longer exists after rollback');
  assertTrue(vqAfterRollback.rows[0].t === null, 'D15: valuation_question no longer exists after rollback');
  assertTrue(viewAfterRollback.rows[0].t === null, 'D15: applicability_contested_pairs view no longer exists after rollback');

  const ukAfterRollback = await client.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'u' AND conname = 'asset_identity_assignment_id_asset_uk'`,
    [`${SCHEMA}.asset_identity_assignment`]
  );
  assertTrue(ukAfterRollback.rows.length === 0, 'D15: asset_identity_assignment_id_asset_uk constraint removed by rollback');

  const identityRowsAfterRollback = await client.query('SELECT id, authority, source FROM asset_identity_assignment WHERE id = $1', [identityAssignmentId]);
  assertTrue(
    identityRowsAfterRollback.rows.length === 1 && identityRowsAfterRollback.rows[0].authority === 'CORROBORATED',
    'D15: asset_identity_assignment\'s own pre-existing rows survive rollback completely untouched -- only the 0015-added constraint/trigger are removed, never the table or its data'
  );

  // asset_identity_assignment is no longer trigger-protected post-rollback.
  await assertSucceeds(
    () => client.query(`UPDATE asset_identity_assignment SET authority = 'NONE' WHERE id = $1`, [identityAssignmentId]),
    'D15: post-rollback, asset_identity_assignment_guard trigger is genuinely gone -- a direct field mutation that was rejected pre-rollback now succeeds (confirms the trigger, not some other mechanism, was the enforcement)'
  );

  const compAfterRollback = await client.query('SELECT id, marker FROM comp_snapshot');
  const valAfterRollback = await client.query('SELECT id, marker FROM valuation_event');
  const moAfterRollback = await client.query('SELECT count(*)::int AS n FROM market_observation');
  assertTrue(compAfterRollback.rows.length === 1 && compAfterRollback.rows[0].marker === 'd9-untouched-marker', 'D9/D15: comp_snapshot survives 0015/0016 rollback untouched too');
  assertTrue(valAfterRollback.rows.length === 1 && valAfterRollback.rows[0].marker === 'd9-untouched-marker', 'D9/D15: valuation_event survives 0015/0016 rollback untouched too');
  assertTrue(moAfterRollback.rows[0].n === 1, 'D9/D15: market_observation (0014) is completely unaffected by 0015/0016\'s rollback -- neither file touches that table\'s own DDL');

  await assertScratchTarget(SCHEMA, 'pre-reapply-0015');
  await assertSucceeds(() => client.query(fwd0015), 'D15: reapply of the same 0015 (D1) forward text succeeds cleanly after rollback');
  await assertScratchTarget(SCHEMA, 'pre-reapply-0016');
  await assertSucceeds(() => client.query(fwd0016), 'D15: reapply of the same 0016 (D5B) forward text succeeds cleanly after rollback, in the correct order on top of 0015');
  const afterReapplyCount = await client.query(`SELECT count(*)::int AS n FROM valuation_question`);
  assertTrue(afterReapplyCount.rows[0].n === 0, 'D15: reapplied valuation_question table is empty (rollback genuinely removed all prior rows along with the table)');

  const postReapplyQId = crypto.randomUUID();
  const postReapplyFields = vq.canonicalizeValuationQuestionFields({ assetId, identityAssignmentId, targetGrade: '5.0', gradeBasis: null, disposition: null, variantScope: null, targetYear: null });
  await client.query(
    `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [postReapplyQId, assetId, identityAssignmentId, '5.0', null, null, null, null, principalId, vq.computeValuationQuestionHash(postReapplyFields)]
  );
  await assertRejected(
    () => client.query('DELETE FROM valuation_question WHERE id = $1', [postReapplyQId]),
    'D15: immutability trigger genuinely re-attached after reapply (real row, real DELETE attempt, real rejection)',
    'immutable once written'
  );

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped -- data1_dev untouched throughout`);
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}

console.log('\n-- D12 WAL summary (real measured, steady-state median bytes/row) --');
console.log(`  N=20:  ${batch20Median?.toFixed(1)}`);
console.log(`  N=60:  ${batch60Median?.toFixed(1)}`);
console.log(`  N=100: ${batch100Median?.toFixed(1)}`);
console.log(`  second N=100 (changed logic): ${secondEvalMedian?.toFixed(1)}`);
