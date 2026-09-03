// src/modules/valuation/repository.js — PRIVATE. Every SQL statement in
// this module lives here and nowhere else. Never imported outside
// src/modules/valuation/ -- enforced by
// tests/valuation-module-boundary.test.js. service.js is the ONLY file
// permitted to import this one (mirrors src/modules/assets/'s own
// discipline exactly).
//
// Every function here takes an already-open `client` (mid-transaction)
// -- this file never opens a connection, never manages BEGIN/COMMIT/
// ROLLBACK; that stays entirely in service.js.
//
// CRITICAL, non-obvious constraint (found while designing this file,
// not assumed): market_observation (0014), valuation_question (0016),
// applicability (0016), and market_population/market_population_member
// (0017) ALL carry UNCONDITIONAL immutability triggers -- every one of
// them rejects ANY UPDATE, including a logically-no-op
// `ON CONFLICT ... DO UPDATE SET x = EXCLUDED.x` (the common Postgres
// "upsert with RETURNING on conflict" idiom). That idiom is UNUSABLE
// here -- it would fire a real UPDATE statement and be rejected by the
// exact trigger this whole train spent three migrations proving live.
// Bulk resolve-or-create below therefore always uses `ON CONFLICT ...
// DO NOTHING` (never DO UPDATE) followed by a SEPARATE bulk SELECT
// keyed on content_hash to recover ids for rows that already existed --
// two round trips per table regardless of batch size, not N.
//
// SCHEMA (D5D isolated-writer-design dispatch, own addition, deliberate
// divergence from src/modules/assets/repository.js's own bare
// `data1_dev.` literals): this module has no production call site yet
// and every negative/failure/concurrency/reconstruction proof required
// by this dispatch must run against a REAL, isolated, disposable
// scratch schema -- never real data1_dev (0 rows there today, and the
// D5C live-gate dispatch's own MP-PA18 proof depends on that staying
// true until Milestone Ten authorizes runtime wiring). Every query
// below is qualified against a configurable SCHEMA constant
// (VALUATION_SCHEMA env var, defaulting to 'data1_dev' for the
// eventual real target) rather than a hardcoded literal -- this is NOT
// a session-scoped `SET search_path` (the exact GK-178 hazard class);
// it is a fixed, module-load-time JS string substituted directly into
// the query text itself, immune to pooled-connection/PgBouncer
// session-state loss by construction, identical in spirit to how
// db/data0/0014-0017's own migration files parameterize `SET
// search_path TO ${SCHEMA}` for their own scratch-schema test runs.

import { randomUUID } from 'node:crypto';

const SCHEMA = process.env.VALUATION_SCHEMA || 'data1_dev';

// ─────────────────────────────────────────────────────────────────────
// Identity-anchor reads (no mutation)
// ─────────────────────────────────────────────────────────────────────

export async function assertPrincipalExists(client, principalId) {
  const res = await client.query(`SELECT id FROM ${SCHEMA}.gk_principal WHERE id = $1`, [principalId]);
  return res.rows.length > 0;
}

export async function getAssetById(client, gkAssetId) {
  const res = await client.query(`SELECT id FROM ${SCHEMA}.gk_asset WHERE id = $1`, [gkAssetId]);
  return res.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────
// MarketObservation -- bulk resolve-or-create
// ─────────────────────────────────────────────────────────────────────

// bulkResolveOrCreateMarketObservations -- canonicalFields is an array
// of already-canonicalized field objects (each already carries its own
// contentHash, computed by the caller via marketObservationHash.js).
// Returns a Map<contentHash, id> covering EVERY input row, whether
// newly inserted or already existing. Two round trips total, not N.
export async function bulkResolveOrCreateMarketObservations(client, rows) {
  if (rows.length === 0) return new Map();

  const cols = [
    'id', 'provider', 'provider_item_id', 'listing_kind', 'price_amount', 'currency',
    'condition_text', 'grade_numeric', 'grade_basis', 'occurred_on', 'occurred_at',
    'observed_at', 'recorded_by_principal_id', 'correlation_id', 'content_hash',
  ];
  const values = [];
  const placeholders = rows.map((r, i) => {
    const base = i * cols.length;
    values.push(
      randomUUID(), r.provider, r.providerItemId, r.listingKind, r.priceAmount, r.currency,
      r.conditionText, r.gradeNumeric, r.gradeBasis, r.occurredOn, r.occurredAt,
      r.observedAt, r.recordedByPrincipalId, r.correlationId, r.contentHash
    );
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
  }).join(',');

  await client.query(
    `INSERT INTO ${SCHEMA}.market_observation (${cols.join(',')}) VALUES ${placeholders}
     ON CONFLICT (provider, provider_item_id, content_hash) DO NOTHING`,
    values
  );

  const hashes = rows.map((r) => r.contentHash);
  const resolved = await client.query(
    `SELECT id, content_hash FROM ${SCHEMA}.market_observation WHERE content_hash = ANY($1::text[])`,
    [hashes]
  );
  const byHash = new Map();
  for (const row of resolved.rows) byHash.set(row.content_hash, row.id);
  return byHash;
}

// ─────────────────────────────────────────────────────────────────────
// ValuationQuestion -- singular resolve-or-create (one per evaluation)
// ─────────────────────────────────────────────────────────────────────

export async function resolveOrCreateValuationQuestion(client, f) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO ${SCHEMA}.valuation_question
       (id, asset_id, identity_assignment_id, target_grade, grade_basis, disposition, variant_scope, target_year, recorded_by_principal_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (content_hash) DO NOTHING`,
    [id, f.assetId, f.identityAssignmentId, f.targetGrade, f.gradeBasis, f.disposition, f.variantScope, f.targetYear, f.recordedByPrincipalId, f.contentHash]
  );
  const resolved = await client.query(
    `SELECT id FROM ${SCHEMA}.valuation_question WHERE content_hash = $1`,
    [f.contentHash]
  );
  return resolved.rows[0].id;
}

// ─────────────────────────────────────────────────────────────────────
// Applicability -- bulk resolve-or-create
// ─────────────────────────────────────────────────────────────────────

export async function bulkResolveOrCreateApplicability(client, rows) {
  if (rows.length === 0) return new Map();

  const cols = [
    'id', 'observation_id', 'question_id', 'verdict', 'confidence_tier', 'rule_id',
    'rule_version', 'model_version', 'source_type', 'reason', 'recorded_by_principal_id',
    'correlation_id', 'content_hash',
  ];
  const values = [];
  const placeholders = rows.map((r, i) => {
    const base = i * cols.length;
    values.push(
      randomUUID(), r.observationId, r.questionId, r.verdict, r.confidenceTier, r.ruleId,
      r.ruleVersion, r.modelVersion, r.sourceType, r.reason, r.recordedByPrincipalId,
      r.correlationId, r.contentHash
    );
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
  }).join(',');

  await client.query(
    `INSERT INTO ${SCHEMA}.applicability (${cols.join(',')}) VALUES ${placeholders}
     ON CONFLICT (content_hash) DO NOTHING`,
    values
  );

  const hashes = rows.map((r) => r.contentHash);
  const resolved = await client.query(
    `SELECT id, content_hash, observation_id, question_id FROM ${SCHEMA}.applicability WHERE content_hash = ANY($1::text[])`,
    [hashes]
  );
  const byHash = new Map();
  for (const row of resolved.rows) byHash.set(row.content_hash, { id: row.id, observationId: row.observation_id, questionId: row.question_id });
  return byHash;
}

// ─────────────────────────────────────────────────────────────────────
// MarketPopulation -- singular resolve-or-create (one header per evaluation)
// ─────────────────────────────────────────────────────────────────────

export async function resolveOrCreateMarketPopulation(client, f) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO ${SCHEMA}.market_population
       (id, valuation_question_id, population_rule_version, recorded_by_principal_id, correlation_id, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (content_hash) DO NOTHING`,
    [id, f.valuationQuestionId, f.populationRuleVersion, f.recordedByPrincipalId, f.correlationId, f.contentHash]
  );
  const resolved = await client.query(
    `SELECT id FROM ${SCHEMA}.market_population WHERE content_hash = $1`,
    [f.contentHash]
  );
  return resolved.rows[0].id;
}

// ─────────────────────────────────────────────────────────────────────
// MarketPopulationMember -- bulk insert-or-skip (never referenced
// downstream within the same transaction, so no id needs to be
// recovered for conflicted rows -- a plain DO NOTHING is sufficient,
// no follow-up SELECT needed).
// ─────────────────────────────────────────────────────────────────────

export async function bulkInsertMembers(client, rows) {
  if (rows.length === 0) return 0;

  const cols = [
    'id', 'market_population_id', 'observation_id', 'applicability_id',
    'valuation_question_id', 'member_status', 'exclusion_reason',
  ];
  const values = [];
  const placeholders = rows.map((r, i) => {
    const base = i * cols.length;
    values.push(
      randomUUID(), r.marketPopulationId, r.observationId, r.applicabilityId,
      r.valuationQuestionId, r.memberStatus, r.exclusionReason ?? null
    );
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
  }).join(',');

  const result = await client.query(
    `INSERT INTO ${SCHEMA}.market_population_member (${cols.join(',')}) VALUES ${placeholders}
     ON CONFLICT (market_population_id, observation_id) DO NOTHING`,
    values
  );
  return result.rowCount;
}

// ─────────────────────────────────────────────────────────────────────
// Reconstruction reads (Section 9 / zero-to-one proof) -- pure SELECTs,
// no mutation. Proves membership is reconstructable from durable rows
// alone, without re-executing any population/dedup/ranking logic.
// ─────────────────────────────────────────────────────────────────────

export async function getPopulationWithMembers(client, populationId) {
  const pop = await client.query(
    `SELECT id, valuation_question_id, population_rule_version, recorded_at, content_hash
     FROM ${SCHEMA}.market_population WHERE id = $1`,
    [populationId]
  );
  if (!pop.rows[0]) return null;
  const members = await client.query(
    `SELECT mpm.id, mpm.observation_id, mpm.applicability_id, mpm.member_status, mpm.exclusion_reason,
            a.verdict, a.confidence_tier, a.rule_id, a.rule_version, a.model_version, a.source_type,
            mo.provider, mo.provider_item_id, mo.price_amount, mo.currency
     FROM ${SCHEMA}.market_population_member mpm
     JOIN ${SCHEMA}.applicability a ON a.id = mpm.applicability_id
     JOIN ${SCHEMA}.market_observation mo ON mo.id = mpm.observation_id
     WHERE mpm.market_population_id = $1
     ORDER BY mpm.observation_id`,
    [populationId]
  );
  return { population: pop.rows[0], members: members.rows };
}
