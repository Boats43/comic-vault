// tests/d5d-valuation-writer.test.js
//
// D5D isolated-writer-design dispatch. Real, isolated Postgres SCRATCH
// schema (0014-0017 applied fresh, exactly mirroring the D5A/B/C
// migration-contract tests' own discipline) -- NEVER real data1_dev.
// src/modules/valuation/'s db.js/idempotency.js read VALUATION_SCHEMA
// from process.env, set here BEFORE the module is ever dynamically
// imported, so every query this module issues targets the scratch
// schema, not production.
//
// Covers: atomic transaction correctness, F10 idempotency (W-F8/W-F10),
// legitimate reevaluation (W-F9), transaction failure/rollback
// (W-F5/W-F6), the GK-192 integration-level negative proof (W-F7),
// concurrency (two racing identical-idempotencyKey calls), write
// batching (round-trip count, not N), and the M3 reconstruction proof.
//
// Invoke: node tests/d5d-valuation-writer.test.js

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
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 130)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== D5D -- isolated valuation writer proof (real, isolated scratch schema) ===\n');

const setupClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await setupClient.connect();
const { rows: [{ pid: sessionPid }] } = await setupClient.query('SELECT pg_backend_pid() AS pid');
console.log('  setup client backend PID:', sessionPid);

async function assertScratchTarget(client, expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s');
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

const SCHEMA = `d5d_writer_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);

let principalId, principalId2, assetId, identityAssignmentId;

try {
  await setupClient.query(`CREATE SCHEMA ${SCHEMA}`);
  await setupClient.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(setupClient, SCHEMA, 'post-setup');

  await setupClient.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY)`);
  await setupClient.query(`CREATE TABLE gk_principal (id UUID PRIMARY KEY)`);
  await setupClient.query(`
    CREATE TABLE asset_identity_assignment (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES gk_asset(id),
      catalog_entity_id UUID, authority TEXT NOT NULL CHECK (authority IN ('NONE','CONTESTED','CORROBORATED')),
      source TEXT NOT NULL CHECK (source IN ('vision','operator-correction','unresolved')),
      occurred_at TIMESTAMPTZ, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by UUID REFERENCES asset_identity_assignment(id)
    );
    CREATE INDEX ON asset_identity_assignment (asset_id, recorded_at);
  `);
  // Real idempotency_key table -- same generic shape GK-163 already
  // ratified (db/data0/0005_data1b_idempotency.sql), needed here since
  // this module's own idempotency.js targets it via the same SCHEMA var.
  await setupClient.query(`
    CREATE TABLE idempotency_key (
      id UUID PRIMARY KEY, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      principal_id UUID NOT NULL, result_snapshot JSONB, request_fingerprint TEXT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (operation, idempotency_key)
    );
  `);
  await setupClient.query(`CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql`).catch(async () => {
    await setupClient.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await setupClient.query(`CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql`);
  });

  await setupClient.query(qualify(read('0014_d5a_market_observation.sql')));
  await setupClient.query(qualify(read('0015_d1_identity_assignment_immutability.sql')));
  await setupClient.query(qualify(read('0016_d5b_valuation_question_applicability.sql')));
  await setupClient.query(qualify(read('0017_d5c_market_population.sql')));
  console.log('  setup: 0014-0017 applied cleanly to scratch schema');

  principalId = crypto.randomUUID();
  principalId2 = crypto.randomUUID();
  await setupClient.query('INSERT INTO gk_principal (id) VALUES ($1), ($2)', [principalId, principalId2]);
  assetId = crypto.randomUUID();
  await setupClient.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  identityAssignmentId = crypto.randomUUID();
  await setupClient.query(`INSERT INTO asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source) VALUES ($1,$2,NULL,'CORROBORATED','vision')`, [identityAssignmentId, assetId]);

  // CRITICAL ORDERING: set VALUATION_SCHEMA BEFORE dynamically importing
  // the module -- repository.js/idempotency.js read it once at
  // module-load time.
  process.env.VALUATION_SCHEMA = SCHEMA;
  const val = await load('src/modules/valuation/index.js');
  const repoDirect = await load('src/modules/valuation/repository.js'); // WHITE-BOX use, test-only -- see W-F7 section below for why

  const makeObservation = (tag, price, verdict = 'APPLICABLE', memberStatus = 'SELECTED', exclusionReason = null) => ({
    marketObservation: {
      provider: 'ebay', providerItemId: `item-${tag}`, listingKind: 'sold', priceAmount: price,
      currency: 'USD', conditionText: 'near mint', gradeNumeric: 9.4, gradeBasis: 'cgc',
      occurredOn: null, occurredAt: '2026-06-14T00:00:00.000Z',
      observedAt: new Date().toISOString(), // GK-184: real provider-retrieval time, caller-supplied
    },
    applicability: { verdict, confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null },
    memberStatus, exclusionReason,
  });

  const basePayload = () => ({
    principalId, gkAssetId: assetId, identityAssignmentId,
    targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', variantScope: null, targetYear: '2026',
    populationRuleVersion: 'comp-population-v1',
    observations: [makeObservation('a', 66), makeObservation('b', 70), makeObservation('c', 100, 'NOT_APPLICABLE', 'EXCLUDED', 'price outlier')],
  });

  // ===================================================================
  // Atomic transaction correctness + M3 reconstruction proof
  // ===================================================================
  console.log('\n-- atomic transaction + M3 reconstruction proof --\n');

  const r1 = await val.evaluateMarketPopulation({ ...basePayload(), idempotencyKey: 'eval-1', correlationId: crypto.randomUUID() });
  assertTrue(r1.outcome === 'evaluated' && r1.memberCount === 3, `evaluation succeeds, 3 members recorded (actual: ${JSON.stringify(r1)})`);

  const reconstructed = await val.getEvaluatedPopulation({ populationId: r1.populationId });
  assertTrue(reconstructed.members.length === 3, 'M3: exact membership reconstructable from durable rows alone (3 members)');
  assertTrue(reconstructed.members.filter((m) => m.member_status === 'SELECTED').length === 2, 'M3: 2 SELECTED members, matching input');
  assertTrue(reconstructed.members.filter((m) => m.member_status === 'EXCLUDED').length === 1, 'M3: 1 EXCLUDED member, matching input');
  assertTrue(reconstructed.members.find((m) => m.member_status === 'EXCLUDED').exclusion_reason === 'price outlier', 'M3: exclusion_reason recovered exactly');
  assertTrue(reconstructed.population.population_rule_version === 'comp-population-v1', 'M3: population_rule_version recovered exactly');

  // ===================================================================
  // W-F8/W-F10 -- F10 idempotency: same idempotencyKey, same payload,
  // replayed -- recovers the ORIGINAL evaluation, creates nothing new.
  // ===================================================================
  console.log('\n-- W-F8/W-F10: F10 idempotency (retry after commit) --\n');

  const countBeforeReplay = (await setupClient.query('SELECT count(*)::int AS n FROM market_population')).rows[0].n;
  const r1Replay = await val.evaluateMarketPopulation({ ...basePayload(), idempotencyKey: 'eval-1', correlationId: crypto.randomUUID() });
  const countAfterReplay = (await setupClient.query('SELECT count(*)::int AS n FROM market_population')).rows[0].n;
  assertTrue(r1Replay.populationId === r1.populationId, `W-F10: retry with the SAME idempotencyKey recovers the SAME populationId, not a new one (original=${r1.populationId}, replay=${r1Replay.populationId})`);
  assertTrue(countAfterReplay === countBeforeReplay, 'W-F8: zero new market_population rows created by the replay');

  // Concurrency variant of W-F10: two SIMULTANEOUS calls with the SAME
  // idempotencyKey (genuine race, not a sequential retry).
  console.log('\n-- concurrency: two simultaneous identical-idempotencyKey evaluations --\n');
  const racePayload = { ...basePayload(), populationRuleVersion: 'comp-population-race-test', idempotencyKey: 'eval-race-1', correlationId: crypto.randomUUID() };
  const [raceA, raceB] = await Promise.all([
    val.evaluateMarketPopulation({ ...racePayload }),
    val.evaluateMarketPopulation({ ...racePayload }),
  ]);
  assertTrue(raceA.populationId === raceB.populationId, `concurrency: two simultaneous calls under the SAME idempotencyKey resolve to the SAME populationId (a=${raceA.populationId}, b=${raceB.populationId})`);
  const raceCount = await setupClient.query(`SELECT count(*)::int AS n FROM market_population WHERE population_rule_version = 'comp-population-race-test'`);
  assertTrue(raceCount.rows[0].n === 1, `concurrency: exactly ONE market_population row exists for the raced rule version, not two (actual: ${raceCount.rows[0].n})`);

  // ===================================================================
  // W-F9 -- legitimate reevaluation: DIFFERENT idempotencyKey, DIFFERENT
  // population-rule-version -- must NOT be blocked.
  // ===================================================================
  console.log('\n-- W-F9: legitimate reevaluation is not blocked --\n');
  const r2 = await val.evaluateMarketPopulation({ ...basePayload(), populationRuleVersion: 'comp-population-v2', idempotencyKey: 'eval-2', correlationId: crypto.randomUUID() });
  assertTrue(r2.populationId !== r1.populationId, 'W-F9: a changed population-rule-version produces a genuinely NEW population, not blocked by any uniqueness rule');
  assertTrue(r2.questionId === r1.questionId, 'W-F9: the SAME ValuationQuestion is correctly reused (identical assumptions, resolve-or-create)');
  assertTrue(
    JSON.stringify([...r2.observationIds].sort()) === JSON.stringify([...r1.observationIds].sort()),
    'W-F9: the SAME MarketObservations are correctly reused too (identical real-world facts, resolve-or-create) -- only the population differs'
  );

  // ===================================================================
  // W-F5/W-F6 -- transaction failure -> full rollback, no orphan state
  // ===================================================================
  console.log('\n-- W-F5/W-F6: forced transaction failure -> full rollback --\n');

  const beforeFailureCounts = await setupClient.query(`
    SELECT (SELECT count(*)::int FROM market_observation) AS mo, (SELECT count(*)::int FROM applicability) AS ap,
           (SELECT count(*)::int FROM market_population) AS mp, (SELECT count(*)::int FROM market_population_member) AS mpm`);

  const brokenPayload = {
    ...basePayload(),
    populationRuleVersion: 'comp-population-forced-failure',
    idempotencyKey: 'eval-forced-failure',
    correlationId: crypto.randomUUID(),
    observations: [
      makeObservation('forced-1', 55),
      { ...makeObservation('forced-2', 60), applicability: { verdict: 'BOGUS_VERDICT', confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null } }, // will fail the verdict CHECK constraint
    ],
  };
  const wrapped = await val.attemptDurablePersistence(brokenPayload, { buildSha: 'test-sha' });
  assertTrue(wrapped.ok === false, 'W1: attemptDurablePersistence NEVER throws -- returns { ok: false, error } instead of propagating the exception');
  assertTrue(wrapped.error?.stage === 'd5-evaluation' && typeof wrapped.error?.message === 'string', `W1: structured diagnostic present (stage, message) -- actual: ${JSON.stringify(wrapped.error)}`);

  const afterFailureCounts = await setupClient.query(`
    SELECT (SELECT count(*)::int FROM market_observation) AS mo, (SELECT count(*)::int FROM applicability) AS ap,
           (SELECT count(*)::int FROM market_population) AS mp, (SELECT count(*)::int FROM market_population_member) AS mpm`);
  assertTrue(
    JSON.stringify(beforeFailureCounts.rows[0]) === JSON.stringify(afterFailureCounts.rows[0]),
    `W-F5/W-F6: FULL rollback -- zero orphan rows from the failed evaluation, including the FIRST observation that would have succeeded in isolation (before=${JSON.stringify(beforeFailureCounts.rows[0])}, after=${JSON.stringify(afterFailureCounts.rows[0])})`
  );
  // Confirm the failed idempotencyKey was never claimed (a failed
  // attempt must not poison future retries with a "replay" of nothing).
  const failedKeyClaimed = await setupClient.query(`SELECT 1 FROM idempotency_key WHERE idempotency_key = 'eval-forced-failure'`);
  assertTrue(failedKeyClaimed.rows.length === 0, 'W-F5: the failed attempt\'s idempotencyKey was never claimed -- a real retry can still succeed later');

  // ===================================================================
  // W-F7 / Section 17 -- GK-192 integration-level negative proof.
  // White-box: uses repository.js directly (test-only escape hatch,
  // same precedent as the D5C migration-contract test's own direct SQL
  // use -- tests/ is outside the module-boundary walk's scope, same as
  // it is for assets-module-boundary.test.js) to deliberately construct
  // a cross-question member -- proving the DB itself rejects it even
  // when a caller bypasses service.js's own safe construction entirely.
  // service.js's own normal path can never produce this shape (it
  // always derives questionId from the SAME resolved question for
  // every judgment in one call) -- this test proves the guarantee does
  // NOT depend on that discipline.
  // ===================================================================
  console.log('\n-- W-F7: GK-192 integration-level negative proof (white-box, deliberate misuse) --\n');

  const otherPopResult = await val.evaluateMarketPopulation({ ...basePayload(), populationRuleVersion: 'comp-population-other-question-test', idempotencyKey: 'eval-other-q', correlationId: crypto.randomUUID() });
  // A second, genuinely different ValuationQuestion (different target grade),
  // carrying its OWN probe observation ('gk192-probe') never evaluated
  // under question A -- required so the malicious (market_population_id,
  // observation_id) pair below has NEVER existed as a legitimate member
  // row. Reusing basePayload()'s shared 'a'/'b'/'c' observations here
  // would resolve, via content-hash dedup, to the SAME market_observation
  // rows already inserted as otherPopResult's own legitimate members --
  // the bulkInsertMembers `ON CONFLICT (market_population_id,
  // observation_id) DO NOTHING` would then silently swallow the probe
  // row on the DUPLICATE-KEY path before the composite FK is ever
  // evaluated, masking the very check this test exists to prove (the
  // same class of dedup-key/FK-isolation confound already fixed once in
  // tests/d5c-market-population-migration-contract.test.js).
  const otherQPayload = {
    ...basePayload(), targetGrade: '2.0', populationRuleVersion: 'comp-population-other-question-test-2',
    observations: [...basePayload().observations, makeObservation('gk192-probe', 555)],
    idempotencyKey: 'eval-other-q-2', correlationId: crypto.randomUUID(),
  };
  const otherQResult = await val.evaluateMarketPopulation(otherQPayload);
  assertTrue(otherQResult.questionId !== otherPopResult.questionId, 'setup: two genuinely different ValuationQuestions exist for this negative proof');

  const probeObservationId = otherQResult.observationIds[otherQResult.observationIds.length - 1];
  const probeApplicabilityId = otherQResult.applicabilityIds[otherQResult.applicabilityIds.length - 1];

  const client2 = await (await load('src/modules/valuation/db.js')).acquireConnection();
  try {
    await assertRejected(
      () => repoDirect.bulkInsertMembers(client2, [{
        marketPopulationId: otherPopResult.populationId, // belongs to question A, and has NEVER had the probe observation as a member
        observationId: probeObservationId, // exists only under question B
        applicabilityId: probeApplicabilityId, // belongs to question B
        valuationQuestionId: otherPopResult.questionId, // claims question A
        memberStatus: 'SELECTED', exclusionReason: null,
      }]),
      'W-F7: a member row citing a population from question A but an applicability judgment from question B is REJECTED by the real composite FK, even via direct repository-level misuse (GK-192 closed at the DB, not by writer discipline)',
      'foreign key'
    );
  } finally {
    client2.release();
  }

  // ===================================================================
  // Write batching -- round-trip count, not N (Section 12)
  // ===================================================================
  console.log('\n-- write batching: round-trip count for N=20 observations --\n');

  const bigObservations = Array.from({ length: 20 }, (_, i) => makeObservation(`batch-${i}`, 50 + i));
  const bigPayload = { ...basePayload(), populationRuleVersion: 'comp-population-batch-test', observations: bigObservations, idempotencyKey: 'eval-batch-test', correlationId: crypto.randomUUID() };

  // Instrument via a counting proxy around the pool's own query method,
  // scoped to this one call only.
  const dbModule = await load('src/modules/valuation/db.js');
  const pool = dbModule.getPool();
  let queryCount = 0;
  const originalConnect = pool.connect.bind(pool);
  pool.connect = async (...args) => {
    const c = await originalConnect(...args);
    const originalQuery = c.query.bind(c);
    c.query = (...qargs) => { queryCount++; return originalQuery(...qargs); };
    return c;
  };
  const batchResult = await val.evaluateMarketPopulation(bigPayload);
  pool.connect = originalConnect;
  console.log(`  N=20 observations -> ${queryCount} total SQL statements issued (BEGIN/COMMIT/idempotency/etc. included)`);
  assertTrue(batchResult.memberCount === 20, 'batch evaluation recorded all 20 members');
  assertTrue(queryCount < 20, `write batching: total round trips (${queryCount}) is LESS than N=20 -- not "for each observation: await INSERT" (bulk INSERT+bulk SELECT per table, not per-row)`);

} finally {
  await setupClient.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log(`\n  scratch schema ${SCHEMA} dropped -- data1_dev untouched throughout`);
  await setupClient.end();
  const dbModule = await load('src/modules/valuation/db.js').catch(() => null);
  if (dbModule) await dbModule.closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
