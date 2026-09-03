// tests/d5c-market-population-migration-contract.test.js
//
// D5C -- real, isolated scratch-schema proof of the MarketPopulation
// substrate (db/data0/0017_d5c_market_population.sql, NOT applied to
// data1_dev this pass). Applies the real, already-LIVE-shaped
// prerequisite chain fresh in scratch (0014, 0015, 0016) then 0017 on
// top, mirroring D5A/D5B/live-apply-gate's own proof discipline
// exactly. data1_dev is never touched.
//
// Covers: MP-NP1 (population -> nonexistent ValuationQuestion
// rejected), MP-NP2 (membership -> nonexistent MarketObservation
// rejected), MP-NP3 (membership cannot silently reference a mismatched
// Applicability judgment, observation dimension), MP-NP3b/N1 (GK-192
// declarative closure -- membership cannot silently reference a
// judgment belonging to a DIFFERENT ValuationQuestion than the one the
// population itself answers, even when the observation matches -- both
// composite-FK directions proven independently), MP-NP4 (changed rule
// version produces a new historical population), MP-NP5 (a later
// population does not overwrite an earlier one), MP-NP6 (duplicate
// execution dedups), MP-NP7 (legitimate reevaluation not blocked),
// MP-NP12 (no population operation mutates MarketObservation/
// ValuationQuestion/historical Applicability).
//
// Invoke: node tests/d5c-market-population-migration-contract.test.js

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
const mp = await load('src/lib/marketPopulationHash.js');

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
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 110)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== D5C -- MarketPopulation migration contract (real, isolated scratch-schema proof) ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated unpooled backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

{
  await client.query('SET search_path TO data1_dev');
  let refused = false;
  try { await assertScratchTarget('some-scratch-schema', 'negative proof'); }
  catch (e) { refused = /SAFETY ABORT/.test(e.message) && /data1_dev/.test(e.message); }
  assertTrue(refused, 'D0: intentionally pointing this client at data1_dev causes the guard to refuse before any DDL');
}

const SCHEMA = `d5c_0017_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

let assetId, principalId, identityAssignmentId, questionId, observationId1, observationId2, applicabilityId1, applicabilityId2;

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await client.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await client.query(`
    CREATE TABLE asset_identity_assignment (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES gk_asset(id),
      catalog_entity_id UUID, authority TEXT NOT NULL CHECK (authority IN ('NONE','CONTESTED','CORROBORATED')),
      source TEXT NOT NULL CHECK (source IN ('vision','operator-correction','unresolved')),
      occurred_at TIMESTAMPTZ, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by UUID REFERENCES asset_identity_assignment(id)
    );
    CREATE INDEX ON asset_identity_assignment (asset_id, recorded_at);
  `);

  await assertSucceeds(() => client.query(qualify(read('0014_d5a_market_observation.sql'))), 'setup: 0014 applies cleanly');
  await assertSucceeds(() => client.query(qualify(read('0015_d1_identity_assignment_immutability.sql'))), 'setup: 0015 (D1 repair) applies cleanly');
  await assertSucceeds(() => client.query(qualify(read('0016_d5b_valuation_question_applicability.sql'))), 'setup: 0016 (D5B) applies cleanly');

  principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);
  assetId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  identityAssignmentId = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1,$2,NULL,'CORROBORATED','vision')`, [identityAssignmentId, assetId]);

  const vqFields = vq.canonicalizeValuationQuestionFields({ assetId, identityAssignmentId, targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', variantScope: null, targetYear: '2026' });
  questionId = crypto.randomUUID();
  await client.query(
    `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [questionId, assetId, identityAssignmentId, '9.4', 'cgc', 'graded', null, 2026, principalId, vq.computeValuationQuestionHash(vqFields)]
  );

  observationId1 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, grade_basis, occurred_on, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'ebay','item-1','sold',66.0000,'USD','near mint',9.4,'cgc',NULL,'2026-06-14T00:00:00.000Z',$2,$3,$4,'hash-fixture-1')`,
    [observationId1, new Date().toISOString(), principalId, crypto.randomUUID()]
  );
  observationId2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, grade_basis, occurred_on, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,'ebay','item-2','sold',70.0000,'USD','near mint',9.4,'cgc',NULL,'2026-06-15T00:00:00.000Z',$2,$3,$4,'hash-fixture-2')`,
    [observationId2, new Date().toISOString(), principalId, crypto.randomUUID()]
  );

  const j1Fields = ap.canonicalizeApplicabilityFields({ observationId: observationId1, questionId, verdict: 'APPLICABLE', confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null });
  applicabilityId1 = crypto.randomUUID();
  await client.query(
    `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [applicabilityId1, observationId1, questionId, j1Fields.verdict, j1Fields.confidenceTier, j1Fields.ruleId, j1Fields.ruleVersion, j1Fields.modelVersion, j1Fields.sourceType, j1Fields.reason, principalId, crypto.randomUUID(), ap.computeApplicabilityHash(j1Fields)]
  );
  const j2Fields = ap.canonicalizeApplicabilityFields({ observationId: observationId2, questionId, verdict: 'APPLICABLE', confidenceTier: 'MEDIUM', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null });
  applicabilityId2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [applicabilityId2, observationId2, questionId, j2Fields.verdict, j2Fields.confidenceTier, j2Fields.ruleId, j2Fields.ruleVersion, j2Fields.modelVersion, j2Fields.sourceType, j2Fields.reason, principalId, crypto.randomUUID(), ap.computeApplicabilityHash(j2Fields)]
  );

  // ===================================================================
  // Apply 0017
  // ===================================================================
  await assertScratchTarget(SCHEMA, 'pre-0017-apply');
  await assertSucceeds(() => client.query(qualify(read('0017_d5c_market_population.sql'))), 'D15-style: real 0017 forward text applies cleanly on top of 0014/0015/0016');

  // ===================================================================
  // MP-NP1 -- population cannot reference nonexistent ValuationQuestion
  // ===================================================================
  console.log('\n-- MP-NP1: population -> nonexistent ValuationQuestion --\n');
  await assertRejected(
    () => client.query(
      `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,'comp-population-v1',$3,$4,'bogus-hash-1')`,
      [crypto.randomUUID(), crypto.randomUUID(), principalId, crypto.randomUUID()]
    ),
    'MP-NP1: population referencing a nonexistent ValuationQuestion is rejected', 'foreign key'
  );

  // ===================================================================
  // Real population + members (baseline for the rest)
  // ===================================================================
  const pop1Fields = mp.canonicalizeMarketPopulationFields({
    valuationQuestionId: questionId, populationRuleVersion: 'comp-population-v1',
    members: [{ observationId: observationId1, memberStatus: 'SELECTED' }, { observationId: observationId2, memberStatus: 'SELECTED' }],
  });
  const pop1Id = crypto.randomUUID(), pop1Corr = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [pop1Id, questionId, 'comp-population-v1', principalId, pop1Corr, mp.computeMarketPopulationHash(pop1Fields)]
  );
  const member1Id = crypto.randomUUID(), member2Id = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      [member1Id, pop1Id, observationId1, applicabilityId1, questionId]
    ),
    'baseline: valid SELECTED member row succeeds'
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      [member2Id, pop1Id, observationId2, applicabilityId2, questionId]
    ),
    'baseline: second valid SELECTED member row succeeds'
  );

  // ===================================================================
  // MP-NP2 -- membership cannot reference nonexistent MarketObservation
  // ===================================================================
  console.log('\n-- MP-NP2: membership -> nonexistent MarketObservation --\n');
  await assertRejected(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      [crypto.randomUUID(), pop1Id, crypto.randomUUID(), applicabilityId1, questionId]
    ),
    'MP-NP2: membership referencing a nonexistent MarketObservation is rejected', 'foreign key'
  );

  // ===================================================================
  // MP-NP3 -- membership cannot silently reference a mismatched
  // Applicability judgment (composite FK: applicability_id must judge
  // the SAME observation_id the member row itself names).
  // ===================================================================
  console.log('\n-- MP-NP3: membership cannot reference a mismatched Applicability judgment --\n');
  // Dedicated fresh population for this negative proof -- reusing pop1Id
  // (which already has a member row for observationId1) would confound
  // this composite-FK proof with the (market_population_id,
  // observation_id) dedup unique index, which would fire first.
  const mismatchTestPopFields = mp.canonicalizeMarketPopulationFields({
    valuationQuestionId: questionId, populationRuleVersion: 'comp-population-mismatch-test',
    members: [{ observationId: observationId1, memberStatus: 'SELECTED' }],
  });
  const mismatchTestPopId = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [mismatchTestPopId, questionId, 'comp-population-mismatch-test', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(mismatchTestPopFields)]
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      [crypto.randomUUID(), mismatchTestPopId, observationId1, applicabilityId2, questionId] // applicabilityId2 judged observationId2, not observationId1 -- question matches, only the observation dimension is wrong
    ),
    'MP-NP3: a member row naming observation_id=O1 but citing an Applicability judgment that actually judged O2 is REJECTED at the DB level (composite FK), in a population with no prior member for O1 (isolated from the dedup-key confound)', 'foreign key'
  );

  // ===================================================================
  // MP-NP3b / N1 -- GK-192 declarative closure: membership cannot
  // silently reference a judgment belonging to a DIFFERENT
  // ValuationQuestion than the one the population itself answers, even
  // when the OBSERVATION matches correctly.
  // ===================================================================
  console.log('\n-- MP-NP3b / N1: membership cannot reference a judgment belonging to a DIFFERENT question (GK-192 declarative closure) --\n');
  const assetId2 = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId2]);
  const identityAssignmentId2 = crypto.randomUUID();
  await client.query(`INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1,$2,NULL,'CORROBORATED','vision')`, [identityAssignmentId2, assetId2]);
  const vqFields2 = vq.canonicalizeValuationQuestionFields({ assetId: assetId2, identityAssignmentId: identityAssignmentId2, targetGrade: '5.0', gradeBasis: null, disposition: 'raw', variantScope: null, targetYear: null });
  const questionId2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO valuation_question (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [questionId2, assetId2, identityAssignmentId2, '5.0', null, 'raw', null, null, principalId, vq.computeValuationQuestionHash(vqFields2)]
  );
  // A judgment of the SAME observation (observationId1), but under the
  // DIFFERENT question (questionId2) -- legitimate on its own (an
  // observation can genuinely be judged against multiple questions).
  const jQ2Fields = ap.canonicalizeApplicabilityFields({ observationId: observationId1, questionId: questionId2, verdict: 'APPLICABLE', confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null });
  const applicabilityIdQ2 = crypto.randomUUID();
  await client.query(
    `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [applicabilityIdQ2, observationId1, questionId2, jQ2Fields.verdict, jQ2Fields.confidenceTier, jQ2Fields.ruleId, jQ2Fields.ruleVersion, jQ2Fields.modelVersion, jQ2Fields.sourceType, jQ2Fields.reason, principalId, crypto.randomUUID(), ap.computeApplicabilityHash(jQ2Fields)]
  );
  // Dedicated fresh population under the ORIGINAL question (questionId),
  // no prior member for observationId1 -- isolates this proof from the
  // dedup-key confound.
  const crossQuestionTestPopFields = mp.canonicalizeMarketPopulationFields({
    valuationQuestionId: questionId, populationRuleVersion: 'comp-population-cross-question-test',
    members: [{ observationId: observationId1, memberStatus: 'SELECTED' }],
  });
  const crossQuestionTestPopId = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [crossQuestionTestPopId, questionId, 'comp-population-cross-question-test', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(crossQuestionTestPopFields)]
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      // observation_id=O1 correctly matches applicabilityIdQ2's own
      // observation -- ONLY the question dimension is wrong (population
      // answers questionId, cited judgment actually judged questionId2).
      [crypto.randomUUID(), crossQuestionTestPopId, observationId1, applicabilityIdQ2, questionId]
    ),
    'MP-NP3b/N1: a population belonging to Q1 citing a judgment that actually belongs to Q2 (same observation, different question) is REJECTED at the DB level -- GK-192 closed declaratively, not delegated to a future writer', 'foreign key'
  );
  await assertRejected(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      // Same attempt, but also lying about valuation_question_id itself
      // (claiming Q2 while market_population_id still points at the Q1
      // population) -- must be rejected by the OTHER composite FK
      // (market_population_id, valuation_question_id).
      [crypto.randomUUID(), crossQuestionTestPopId, observationId1, applicabilityIdQ2, questionId2]
    ),
    'MP-NP3b/N1: a member row cannot lie about its own valuation_question_id either -- rejected by the population-side composite FK when it disagrees with the population\'s actual question', 'foreign key'
  );

  // Excluded-member pairing CHECK.
  await assertRejected(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status, exclusion_reason)
       VALUES ($1,$2,$3,$4,$5,'SELECTED','should not be allowed')`,
      [crypto.randomUUID(), pop1Id, observationId1, applicabilityId1, questionId]
    ),
    'a SELECTED row carrying a non-null exclusion_reason is rejected (CHECK pairing)', 'violates check constraint'
  );
  // Dedicated population for this isolated shape check -- reusing
  // pop1Id/observationId1 would confound this proof with the dedup
  // unique index (market_population_id, observation_id), tested
  // separately below.
  const shapeCheckPopFields = mp.canonicalizeMarketPopulationFields({
    valuationQuestionId: questionId, populationRuleVersion: 'comp-population-shape-check',
    members: [{ observationId: observationId1, memberStatus: 'EXCLUDED' }],
  });
  const shapeCheckPopId = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [shapeCheckPopId, questionId, 'comp-population-shape-check', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(shapeCheckPopFields)]
  );
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status, exclusion_reason)
       VALUES ($1,$2,$3,$4,$5,'EXCLUDED','dedup: near-identical listing, lower price kept')`,
      [crypto.randomUUID(), shapeCheckPopId, observationId1, applicabilityId1, questionId]
    ),
    'EXCLUDED row with a non-null exclusion_reason is a legal shape (M2: population-level selection information Applicability alone cannot express)'
  );

  // ===================================================================
  // MP-NP4/MP-NP6/MP-NP7 -- rule-version change / duplicate execution /
  // legitimate reevaluation
  // ===================================================================
  console.log('\n-- MP-NP4/MP-NP6/MP-NP7: rule-version change, duplicate execution, legitimate reevaluation --\n');

  await assertRejected(
    () => client.query(
      `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), questionId, 'comp-population-v1', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(pop1Fields)]
    ),
    'MP-NP6: duplicate execution (identical question/rule-version/member-set) is REJECTED by the dedup unique index', 'duplicate key'
  );

  const pop2Fields = mp.canonicalizeMarketPopulationFields({
    valuationQuestionId: questionId, populationRuleVersion: 'comp-population-v2', // rule version bump
    members: [{ observationId: observationId1, memberStatus: 'SELECTED' }, { observationId: observationId2, memberStatus: 'SELECTED' }],
  });
  const pop2Id = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [pop2Id, questionId, 'comp-population-v2', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(pop2Fields)]
    ),
    'MP-NP4: changed population-rule version (same members) produces a NEW historical population -- not blocked'
  );

  const pop3Fields = mp.canonicalizeMarketPopulationFields({
    valuationQuestionId: questionId, populationRuleVersion: 'comp-population-v1', // SAME rule version as pop1
    members: [{ observationId: observationId1, memberStatus: 'SELECTED' }], // DIFFERENT member set (o2 no longer applicable, say)
  });
  const pop3Id = crypto.randomUUID();
  await assertSucceeds(
    () => client.query(
      `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [pop3Id, questionId, 'comp-population-v1', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(pop3Fields)]
    ),
    'MP-NP7: same rule version, DIFFERENT resulting membership (legitimate reevaluation) is NOT blocked by the uniqueness constraint'
  );

  // ===================================================================
  // MP-NP5 -- a later population does not overwrite the earlier one
  // ===================================================================
  console.log('\n-- MP-NP5: a later population does not overwrite an earlier one --\n');
  const allPops = await client.query('SELECT id, population_rule_version FROM market_population WHERE valuation_question_id = $1 ORDER BY recorded_at', [questionId]);
  assertTrue(allPops.rows.length === 6, `MP-NP5: all 6 population header rows (pop1 v1, mismatch-test, cross-question-test, shape-check, pop2 v2, pop3 v1-reeval) coexist -- none overwritten (actual: ${allPops.rows.length})`);
  const pop1StillIntact = await client.query('SELECT population_rule_version FROM market_population WHERE id = $1', [pop1Id]);
  assertTrue(pop1StillIntact.rows[0].population_rule_version === 'comp-population-v1', 'MP-NP5: the ORIGINAL pop1 row remains exactly as recorded');

  // Immutability, both tables.
  await assertRejected(() => client.query(`UPDATE market_population SET population_rule_version = 'tampered' WHERE id = $1`, [pop1Id]), 'market_population UPDATE rejected', 'immutable once written');
  await assertRejected(() => client.query(`DELETE FROM market_population WHERE id = $1`, [pop1Id]), 'market_population DELETE rejected', 'immutable once written');
  await assertRejected(() => client.query(`UPDATE market_population_member SET member_status = 'EXCLUDED' WHERE id = $1`, [member1Id]), 'market_population_member UPDATE rejected', 'immutable once written');
  await assertRejected(() => client.query(`DELETE FROM market_population_member WHERE id = $1`, [member1Id]), 'market_population_member DELETE rejected', 'immutable once written');

  // ===================================================================
  // MP-NP12 -- no population operation mutates MarketObservation,
  // ValuationQuestion, or historical Applicability
  // ===================================================================
  console.log('\n-- MP-NP12: upstream immutability unaffected by population operations --\n');
  await assertRejected(() => client.query(`DELETE FROM market_observation WHERE id = $1`, [observationId1]), 'MP-NP12: market_observation immutability trigger (0014) still rejects DELETE after population operations', 'immutable once written');
  await assertRejected(() => client.query(`UPDATE valuation_question SET target_grade = 1.0 WHERE id = $1`, [questionId]), 'MP-NP12: valuation_question immutability trigger (0016) still rejects UPDATE after population operations', 'immutable once written');
  await assertRejected(() => client.query(`UPDATE applicability SET confidence_tier = 'LOW' WHERE id = $1`, [applicabilityId1]), 'MP-NP12: applicability immutability trigger (0016) still rejects UPDATE after population operations', 'immutable once written');

  // ===================================================================
  // Section 13 -- real measured WAL (same method as A3/Amendment
  // A3-E3), replacing the pure-projection hypothesis for the header row
  // and, at a smaller scale (member-row FK setup cost), the membership
  // row.
  // ===================================================================
  console.log('\n-- Section 13: real measured WAL (header rows, then member rows) --\n');

  const lsnDiffBytes = async (fn) => {
    const before = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    await fn();
    const after = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    return Number((await client.query('SELECT pg_wal_lsn_diff($1, $2) AS d', [after, before])).rows[0].d);
  };
  let ruleCounter = 0;
  const insertHeaderRow = async () => {
    const rv = `wal-header-${ruleCounter++}`;
    const fields = mp.canonicalizeMarketPopulationFields({ valuationQuestionId: questionId, populationRuleVersion: rv, members: [{ observationId: observationId1, memberStatus: 'SELECTED' }] });
    await client.query(
      `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), questionId, rv, principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(fields)]
    );
  };
  for (let i = 0; i < 20; i++) await insertHeaderRow(); // priming
  const headerSamples = [];
  for (let s = 0; s < 3; s++) headerSamples.push(await lsnDiffBytes(async () => { for (let i = 0; i < 20; i++) await insertHeaderRow(); }));
  headerSamples.sort((a, b) => a - b);
  const headerMedianPerRow = headerSamples[1] / 20;
  console.log(`  market_population header row, steady-state median WAL bytes/row (N=20x3 samples): ${headerMedianPerRow.toFixed(1)}`);
  assertTrue(headerMedianPerRow > 0, 'Section 13: FACT, real measured header-row WAL cost -- not estimated');

  // Member-row WAL: needs its own valid (observation, applicability)
  // FK targets -- build 20 fresh pairs, all against the same question,
  // referencing a single dedicated population header.
  const memberWalPopFields = mp.canonicalizeMarketPopulationFields({ valuationQuestionId: questionId, populationRuleVersion: 'wal-member-measurement', members: [] });
  const memberWalPopId = crypto.randomUUID();
  await client.query(
    `INSERT INTO market_population (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [memberWalPopId, questionId, 'wal-member-measurement', principalId, crypto.randomUUID(), mp.computeMarketPopulationHash(memberWalPopFields)]
  );
  const buildObservationApplicabilityPair = async (tag) => {
    const obsId = crypto.randomUUID();
    await client.query(
      `INSERT INTO market_observation (id, provider, provider_item_id, listing_kind, price_amount, currency, condition_text, grade_numeric, grade_basis, occurred_on, occurred_at, observed_at, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,'ebay',$2,'sold',10.0000,'USD',NULL,NULL,NULL,NULL,'2026-06-14T00:00:00.000Z',$3,$4,$5,$6)`,
      [obsId, `wal-member-obs-${tag}`, new Date().toISOString(), principalId, crypto.randomUUID(), `hash-wal-member-obs-${tag}`]
    );
    const apFields = ap.canonicalizeApplicabilityFields({ observationId: obsId, questionId, verdict: 'APPLICABLE', confidenceTier: 'MEDIUM', ruleId: 'wal-measurement', ruleVersion: String(tag), modelVersion: null, sourceType: 'automated', reason: null });
    const apId = crypto.randomUUID();
    await client.query(
      `INSERT INTO applicability (id, observation_id, question_id, verdict, confidence_tier, rule_id, rule_version, model_version, source_type, reason, recorded_by_principal_id, correlation_id, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [apId, obsId, questionId, apFields.verdict, apFields.confidenceTier, apFields.ruleId, apFields.ruleVersion, apFields.modelVersion, apFields.sourceType, apFields.reason, principalId, crypto.randomUUID(), ap.computeApplicabilityHash(apFields)]
    );
    return { obsId, apId };
  };
  // 20 priming pairs first (warm pages past Postgres's one-time
  // full-page-image WAL cost), then 3 measured batches of 20 fresh
  // pairs each -- dedup key is (market_population_id, observation_id),
  // so every member row in the SAME population needs a DISTINCT
  // observation_id.
  for (let i = 0; i < 20; i++) {
    const pair = await buildObservationApplicabilityPair(`prime-${i}`);
    await client.query(
      `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
       VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
      [crypto.randomUUID(), memberWalPopId, pair.obsId, pair.apId, questionId]
    );
  }
  const measureMemberBatch = async (n, label) => {
    const batchPairs = [];
    for (let i = 0; i < n; i++) batchPairs.push(await buildObservationApplicabilityPair(`${label}-${i}`));
    return lsnDiffBytes(async () => {
      for (const { obsId, apId } of batchPairs) {
        await client.query(
          `INSERT INTO market_population_member (id, market_population_id, observation_id, applicability_id, valuation_question_id, member_status)
           VALUES ($1,$2,$3,$4,$5,'SELECTED')`,
          [crypto.randomUUID(), memberWalPopId, obsId, apId, questionId]
        );
      }
    });
  };
  const memberSamples = [];
  for (let s = 0; s < 3; s++) memberSamples.push((await measureMemberBatch(20, `m-s${s}`)) / 20);
  memberSamples.sort((a, b) => a - b);
  const memberMedianPerRow = memberSamples[1];
  console.log(`  market_population_member row, steady-state median WAL bytes/row (N=20x3 samples, includes each sample's own fresh market_observation+applicability rows in the SAME measured window -- an upper bound on the member row's own marginal cost, disclosed): ${memberMedianPerRow.toFixed(1)}`);
  assertTrue(memberMedianPerRow > 0, 'Section 13: FACT, real measured member-row WAL cost (upper bound, includes co-created FK-target rows in the measured window) -- not estimated');

  // ===================================================================
  // Rollback -> verify -> reapply -> verify
  // ===================================================================
  console.log('\n-- rollback / reapply --\n');
  // Snapshot counts immediately BEFORE rollback -- the Section 13 WAL
  // measurement above created many more applicability/market_observation
  // rows than the earlier fixed-count assertions anticipated; comparing
  // before/after (rather than a stale hardcoded total) proves 0017's
  // rollback touches neither table regardless of how many rows exist.
  const appCountBeforeRollback = (await client.query('SELECT count(*)::int AS n FROM applicability WHERE question_id = $1', [questionId])).rows[0].n;
  const moCountBeforeRollback = (await client.query('SELECT count(*)::int AS n FROM market_observation')).rows[0].n;

  await assertScratchTarget(SCHEMA, 'pre-0017-rollback');
  await assertSucceeds(() => client.query(qualify(read('0017_d5c_market_population_rollback.sql'))), '0017 rollback applies successfully');

  const memberTableGone = await client.query(`SELECT to_regclass('${SCHEMA}.market_population_member') AS t`);
  const popTableGone = await client.query(`SELECT to_regclass('${SCHEMA}.market_population') AS t`);
  assertTrue(memberTableGone.rows[0].t === null, 'market_population_member no longer exists after rollback');
  assertTrue(popTableGone.rows[0].t === null, 'market_population no longer exists after rollback');
  const appUkGone = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND conname = 'applicability_id_observation_question_uk'`, [`${SCHEMA}.applicability`]);
  assertTrue(appUkGone.rows.length === 0, 'applicability_id_observation_question_uk constraint (added by 0017) removed by rollback');
  // market_population's own market_population_id_question_uk constraint
  // cannot be independently checked post-rollback -- the table itself
  // is dropped (popTableGone above already proves this), so the
  // constraint is necessarily gone with it.

  const appRowsIntact = await client.query('SELECT count(*)::int AS n FROM applicability WHERE question_id = $1', [questionId]);
  assertTrue(appRowsIntact.rows[0].n === appCountBeforeRollback, `applicability rows (0016, unrelated to 0017) survive rollback completely untouched (before=${appCountBeforeRollback}, after=${appRowsIntact.rows[0].n})`);
  const moRowsIntact = await client.query('SELECT count(*)::int AS n FROM market_observation');
  assertTrue(moRowsIntact.rows[0].n === moCountBeforeRollback, `market_observation rows (0014) survive rollback completely untouched (before=${moCountBeforeRollback}, after=${moRowsIntact.rows[0].n})`);

  await assertScratchTarget(SCHEMA, 'pre-reapply');
  await assertSucceeds(() => client.query(qualify(read('0017_d5c_market_population.sql'))), 'reapply of the same 0017 forward text succeeds cleanly after rollback');
  const reapplyCount = await client.query('SELECT count(*)::int AS n FROM market_population');
  assertTrue(reapplyCount.rows[0].n === 0, 'reapplied market_population table is empty');

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
