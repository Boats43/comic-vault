// src/modules/valuation/service.js — the public surface implementation.
// D5D isolated-writer-design dispatch. ZERO production call sites --
// nothing under api/ imports this module (tests/valuation-module-
// boundary.test.js proves it). Runtime wiring is explicitly HOLD until
// Milestone Ten's phone proof closes (CLAUDE.md).
//
// Two public entry points:
//   resolveEligibleSubject  -- W2: collectionItemId -> already-linked
//     gkAssetId + its live identity_assignment_id, via the assets
//     module's OWN public functions (resolveCollectionItemLink,
//     getLiveIdentityAssignment) -- never mints, never resolve-or-
//     creates a gk_asset. Returns a typed skip result, never throws,
//     when no durable subject exists (Section 1's required outcomes).
//   evaluateMarketPopulation -- the atomic D5 write: one short
//     synchronous transaction (W3: inline, not outbox, for this
//     zero-to-one slice), MarketObservation(s) -> ValuationQuestion ->
//     Applicability judgment(s) -> MarketPopulation -> Member rows,
//     wrapped in this module's own idempotency law (F10).
//
// attemptDurablePersistence -- the W1 fail-safe wrapper: NEVER throws,
// always returns a discriminated result. This is the shape a FUTURE
// real-handler integration (not this dispatch, not authorized until
// Milestone Ten) would call -- built and proven here against isolated/
// test entry points only.

import { randomUUID } from 'node:crypto';
import * as repo from './repository.js';
import { acquireConnection } from './db.js';
import { checkIdempotencyReplay, claimIdempotencyKey, computeRequestFingerprint } from './idempotency.js';
import { NotFoundError, ValidationFailedError, AuthorizationFailedError, SKIP_REASONS } from './errors.js';
import * as assets from '../assets/index.js';
import * as mo from '../../lib/marketObservationHash.js';
import * as vq from '../../lib/valuationQuestionHash.js';
import * as ap from '../../lib/applicabilityHash.js';
import * as mp from '../../lib/marketPopulationHash.js';

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

async function assertPrincipalActive(client, principalId) {
  if (!principalId) throw new AuthorizationFailedError('principalId is required');
  const exists = await repo.assertPrincipalExists(client, principalId);
  if (!exists) throw new AuthorizationFailedError(`principalId ${principalId} does not resolve to a real gk_principal row`);
}

const newCorrelationId = () => randomUUID();

// ─────────────────────────────────────────────────────────────────────
// W2 -- asset-source route. Reads only src/modules/assets/'s PUBLIC
// surface (resolveCollectionItemLink, getLiveIdentityAssignment) --
// never queries data1_dev.collection_item_link or asset_identity_
// assignment directly; that would cross this module's own boundary the
// same way it would be wrong for another module to reach into assets/
// repository.js. Never mints a gk_asset, never resolve-or-creates one,
// never invokes D6/capture behavior, never weakens
// valuation_question.asset_id NOT NULL, never fabricates a synthetic
// asset id.
// ─────────────────────────────────────────────────────────────────────
export async function resolveEligibleSubject({ principalId, collectionItemId } = {}) {
  requireFields({ principalId }, ['principalId']);

  if (!collectionItemId) {
    return { eligible: false, reason: SKIP_REASONS.NO_DURABLE_SUBJECT };
  }

  const link = await assets.resolveCollectionItemLink({ principalId, collectionItemId });
  if (!link) {
    return { eligible: false, reason: SKIP_REASONS.UNLINKED_SUBJECT };
  }

  const identity = await assets.getLiveIdentityAssignment({ principalId, gkAssetId: link.gkAssetId });
  if (!identity) {
    // A linked asset with no live identity assignment yet -- still a
    // real, named skip case (D1's own anchor requires a specific,
    // existing identity_assignment_id; none exists to anchor to).
    return { eligible: false, reason: SKIP_REASONS.UNLINKED_SUBJECT };
  }

  return { eligible: true, gkAssetId: link.gkAssetId, identityAssignmentId: identity.identityAssignmentId };
}

// ─────────────────────────────────────────────────────────────────────
// evaluateMarketPopulation -- the atomic D5 write. ALL external work
// (identity/comps/pricing/selection) must already be resolved by the
// caller before this function is invoked -- this function issues zero
// HTTP/provider/model calls, only Postgres statements, so its own
// latency is measurable and bounded (W3/Section 11).
// ─────────────────────────────────────────────────────────────────────
export async function evaluateMarketPopulation({
  principalId, gkAssetId, identityAssignmentId,
  targetGrade, gradeBasis, disposition, variantScope, targetYear,
  observations, populationRuleVersion,
  idempotencyKey, correlationId,
} = {}) {
  requireFields(
    { principalId, gkAssetId, identityAssignmentId, populationRuleVersion, observations },
    ['principalId', 'gkAssetId', 'identityAssignmentId', 'populationRuleVersion', 'observations']
  );
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new ValidationFailedError('observations must be a non-empty array');
  }

  const operation = 'd5-evaluation:evaluateMarketPopulation';
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      // ── F10: execution-level idempotency, computed over the FULL
      // semantic payload (not just one row's content) ──
      const vqCanonical = vq.canonicalizeValuationQuestionFields({
        assetId: gkAssetId, identityAssignmentId, targetGrade, gradeBasis, disposition, variantScope, targetYear,
      });
      const vqContentHash = vq.computeValuationQuestionHash(vqCanonical);

      const moCanonicalList = observations.map((o) => mo.canonicalizeMarketObservationFields(o.marketObservation));
      const moContentHashes = moCanonicalList.map((f) => mo.computeMarketObservationHash(f));

      const requestFingerprint = computeRequestFingerprint({
        gkAssetId, identityAssignmentId, vqContentHash, populationRuleVersion,
        observationContentHashes: [...moContentHashes].sort(),
      });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      // ── Resolve-or-create ValuationQuestion ──
      const questionId = await repo.resolveOrCreateValuationQuestion(client, {
        assetId: gkAssetId, identityAssignmentId,
        targetGrade: vqCanonical.targetGrade, gradeBasis: vqCanonical.gradeBasis,
        disposition: vqCanonical.disposition, variantScope: vqCanonical.variantScope, targetYear: vqCanonical.targetYear,
        recordedByPrincipalId: principalId, contentHash: vqContentHash,
      });

      const batchCorrelationId = correlationId || newCorrelationId();

      // ── Bulk resolve-or-create MarketObservations ──
      // GK-184: observed_at MUST be the caller's own real
      // provider-retrieval timestamp -- this module never defaults it
      // to now() at persistence time (that would manufacture false
      // freshness on a cache-hit path, the exact hazard GK-184 names).
      // Deliberately NOT part of moCanonicalList (marketObservationHash
      // .js's own canonicalizeMarketObservationFields correctly excludes
      // it -- provenance/timing metadata, never hash content) --
      // threaded through here from the caller's raw input instead.
      for (const o of observations) {
        if (!o.marketObservation?.observedAt) {
          throw new ValidationFailedError('Each observation.marketObservation.observedAt is required (the real provider-retrieval time, GK-184 -- never defaulted)');
        }
      }
      const moRows = observations.map((o, i) => ({
        ...moCanonicalList[i],
        observedAt: o.marketObservation.observedAt,
        contentHash: moContentHashes[i],
        recordedByPrincipalId: principalId,
        correlationId: batchCorrelationId,
      }));
      const moIdByHash = await repo.bulkResolveOrCreateMarketObservations(client, moRows);

      // ── Bulk resolve-or-create Applicability judgments ──
      const apCanonicalList = observations.map((o, i) => ap.canonicalizeApplicabilityFields({
        ...o.applicability,
        observationId: moIdByHash.get(moContentHashes[i]),
        questionId,
      }));
      const apContentHashes = apCanonicalList.map((f) => ap.computeApplicabilityHash(f));
      const apRows = apCanonicalList.map((f, i) => ({ ...f, contentHash: apContentHashes[i], recordedByPrincipalId: principalId, correlationId: batchCorrelationId }));
      const apByHash = await repo.bulkResolveOrCreateApplicability(client, apRows);

      // ── Resolve-or-create MarketPopulation header ──
      const memberInputs = observations.map((o, i) => ({
        observationId: moIdByHash.get(moContentHashes[i]),
        memberStatus: o.memberStatus,
      }));
      const mpFields = mp.canonicalizeMarketPopulationFields({
        valuationQuestionId: questionId, populationRuleVersion, members: memberInputs,
      });
      const mpContentHash = mp.computeMarketPopulationHash(mpFields);
      const populationId = await repo.resolveOrCreateMarketPopulation(client, {
        valuationQuestionId: questionId, populationRuleVersion,
        recordedByPrincipalId: principalId, correlationId: batchCorrelationId, contentHash: mpContentHash,
      });

      // ── Bulk insert MarketPopulationMember rows (insert-or-skip) ──
      const memberRows = observations.map((o, i) => {
        const apHash = apContentHashes[i];
        const apResolved = apByHash.get(apHash);
        return {
          marketPopulationId: populationId,
          observationId: apResolved.observationId,
          applicabilityId: apResolved.id,
          valuationQuestionId: questionId,
          memberStatus: o.memberStatus,
          exclusionReason: o.exclusionReason ?? null,
        };
      });
      const insertedMemberCount = await repo.bulkInsertMembers(client, memberRows);

      const result = {
        outcome: 'evaluated',
        questionId, populationId,
        observationIds: [...moIdByHash.values()],
        applicabilityIds: [...apByHash.values()].map((v) => v.id),
        memberCount: memberRows.length,
        insertedMemberCount,
      };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      // W-F10 concurrency variant: two SIMULTANEOUS calls under the
      // SAME idempotencyKey both pass checkIdempotencyReplay (neither
      // has committed yet when the other checks -- an inherent
      // check-then-act race under READ COMMITTED), both do the full
      // resolve-or-create work (which safely CONVERGES to the same
      // underlying rows regardless of which transaction "wins" --
      // every table's own content-hash dedup guarantees that), and then
      // race on claimIdempotencyKey itself. The LOSER hits a real
      // idempotency_key UNIQUE(operation, idempotency_key) violation --
      // this is NOT a caller error and must not propagate as one:
      // recover the WINNER's now-durably-committed result and return it
      // exactly as an ordinary replay would, rather than surfacing a
      // raw Postgres error for what is, from the caller's perspective,
      // still "my execution was recovered, not duplicated."
      if (e?.code === '23505' && idempotencyKey && String(e.message).includes('idempotency_key')) {
        // Reuse checkIdempotencyReplay itself -- it is just the read
        // half of the same claim, and re-running it post-rollback finds
        // the winner's now-committed row. Skip its own fingerprint
        // check here (pass undefined): the two racing calls share the
        // exact same requestFingerprint by construction (same payload,
        // same idempotencyKey), so a mismatch here would mean this
        // recovery path caught an unrelated 23505 -- fall through to
        // the raw rethrow instead of masking that with a wrong result.
        const winnerResult = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint: undefined });
        if (winnerResult) return winnerResult;
      }
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// getEvaluatedPopulation -- Section 9/M3 reconstruction proof, exposed
// publicly (read-only, no mutation) so a test file can prove exact
// historical membership is recoverable from durable rows alone WITHOUT
// importing repository.js directly (which would violate this module's
// own boundary the same way it would for any other caller).
// ─────────────────────────────────────────────────────────────────────
export async function getEvaluatedPopulation({ populationId } = {}) {
  requireFields({ populationId }, ['populationId']);
  const client = await acquireConnection();
  try {
    const result = await repo.getPopulationWithMembers(client, populationId);
    if (!result) throw new NotFoundError(`market_population ${populationId} does not exist`);
    return result;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// W1 -- fail-safe wrapper. NEVER throws. This is the ONLY function a
// future real-handler integration is meant to call directly (not this
// dispatch -- no caller exists anywhere yet). Structured diagnostic on
// failure, never secrets/provider payloads, never a caller-facing
// exception.
// ─────────────────────────────────────────────────────────────────────
export async function attemptDurablePersistence(payload, { buildSha } = {}) {
  const startedAt = Date.now();
  try {
    const result = await evaluateMarketPopulation(payload);
    return { ok: true, result, elapsedMs: Date.now() - startedAt };
  } catch (e) {
    const diagnostic = {
      requestId: payload?.correlationId ?? null,
      buildSha: buildSha ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      collectionItemId: payload?.collectionItemId ?? null,
      gkAssetId: payload?.gkAssetId ?? null,
      stage: 'd5-evaluation',
      pgErrorCode: e?.code ?? null,
      retryable: e?.code === '40P01' || e?.code === '40001',
      errorClass: e?.name ?? 'UnknownError',
      message: e?.message ?? String(e),
      elapsedMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };
    return { ok: false, error: diagnostic };
  }
}
