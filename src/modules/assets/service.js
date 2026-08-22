// src/modules/assets/service.js — the public surface implementation.
// Orchestrates transactions, calls repository.js, NEVER issues SQL
// directly. This is the only file in this module permitted to import
// repository.js — see tests/assets-module-boundary.test.js (S3-11).
//
// Every mutating operation follows the same shape (docs/adr/
// DATA-1B-ASSET-SERVICE-DESIGN.md, Section 3):
//   1. validate required/enum fields (before touching the DB at all)
//   2. acquire a connection, assertPrincipalActive (read, pre-transaction)
//   3. BEGIN
//   4. check idempotency replay — if hit, COMMIT (no-op) and return the
//      ORIGINAL result verbatim, zero new rows
//   5. verify the referenced gkAssetId (and any other referenced
//      principal) exists
//   6. perform the mutation(s)
//   7. write the domain_event + outbox row
//   8. claim the idempotency key (if one was supplied)
//   9. COMMIT (or ROLLBACK on any thrown error, in a catch)

import * as repo from './repository.js';
import { acquireConnection } from './db.js';
import { checkIdempotencyReplay, claimIdempotencyKey } from './idempotency.js';
import { NotFoundError, ConflictError, ValidationFailedError, AuthorizationFailedError } from './errors.js';

const CONTRACT_VERSION = 'grailkey-data1b-asset-service-v1';
const BASIS_SCHEMA_VERSION = 'asset-capture-event-v1';
const MINT_POLICY_VERSION = 'data1b-asset-service-v1';

const newCorrelationId = async (client) => (await client.query('SELECT uuidv7() as id')).rows[0].id;

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

function requireEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new ValidationFailedError(`${fieldName} must be one of [${allowed.join(', ')}], got: ${JSON.stringify(value)}`);
  }
}

// Authorization parameter (ADR-AUTH-001) — v1 is a parameter contract,
// NOT an auth system: proves principalId is a real, existing gk_principal
// row. Proves nothing about asset/marketplace/mutation authorization
// (Ruling 13 steps 2-4 — reserved for DATA-1D). "Active" is currently
// equivalent to "exists" — gk_principal has no status/deactivation
// column in the live schema (see the design doc, Section 3, for why this
// is a disclosed gap, not silently patched with a new column).
async function assertPrincipalActive(client, principalId) {
  if (!principalId) throw new AuthorizationFailedError('principalId is required');
  const exists = await repo.assertPrincipalExists(client, principalId);
  if (!exists) throw new AuthorizationFailedError(`principalId ${principalId} does not resolve to a real gk_principal row`);
}

async function assertAssetExists(client, gkAssetId) {
  const asset = await repo.getAssetById(client, gkAssetId);
  if (!asset) throw new NotFoundError(`gk_asset ${gkAssetId} does not exist`);
  return asset;
}

// ─────────────────────────────────────────────────────────────────────
// createPhysicalAsset
// ─────────────────────────────────────────────────────────────────────
export async function createPhysicalAsset({ principalId, captureBasis, assetClass = 'comic', source, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, captureBasis }, ['principalId', 'captureBasis']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'createPhysicalAsset';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      const basisKey = typeof captureBasis === 'string' ? captureBasis : JSON.stringify(captureBasis);
      const mint = await repo.mintAsset(client, {
        basisNamespace: 'asset:capture-event',
        basisKey,
        basisSchemaVersion: BASIS_SCHEMA_VERSION,
        mintPolicyVersion: MINT_POLICY_VERSION,
        contractVersion: CONTRACT_VERSION,
        candidateSnapshot: captureBasis,
      });

      if (assetClass && assetClass !== 'comic') {
        await client.query('UPDATE gk_asset SET asset_class = $1 WHERE id = $2', [assetClass, mint.assetId]);
      }

      // Only on a genuine first mint — resolved-existing means this asset
      // already has its initial ownership_event and asset.minted event
      // from whichever call minted it originally; redoing them here would
      // fabricate duplicate history for an asset that didn't just get
      // created (the exact bug S3-4's flat-count proof exists to catch).
      const effectiveCorrelationId = correlationId || await newCorrelationId(client);
      if (mint.outcome === 'minted-new') {
        await repo.insertOwnershipEvent(client, {
          assetId: mint.assetId, ownerPrincipalId: principalId,
          reason: 'initial-mint', recordedByPrincipalId: principalId,
        });
        await repo.writeDomainEvent(client, {
          eventType: 'asset.minted', actorPrincipalId: principalId, actorKind: 'user',
          subjectType: 'gk_asset', subjectId: mint.assetId,
          payload: { outcome: mint.outcome, assetClass, source: source ?? null },
          correlationId: effectiveCorrelationId,
        });
      }

      const result = { assetId: mint.assetId, basisId: mint.basisId, outcome: mint.outcome };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// getPhysicalAsset — read-only, no transaction, emits nothing.
// ─────────────────────────────────────────────────────────────────────
export async function getPhysicalAsset({ principalId, gkAssetId } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    return await repo.getAssetGraph(client, gkAssetId);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// assignIdentity
// ─────────────────────────────────────────────────────────────────────
export async function assignIdentity({ principalId, gkAssetId, catalogEntityId = null, evidence, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, evidence }, ['principalId', 'gkAssetId', 'evidence']);
  requireEnum(evidence.authority, ['NONE', 'CONTESTED', 'CORROBORATED'], 'evidence.authority');
  requireEnum(evidence.source, ['vision', 'unresolved'], 'evidence.source');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'assignIdentity';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const assignmentId = await repo.insertIdentityAssignment(client, {
        assetId: gkAssetId, catalogEntityId, authority: evidence.authority, source: evidence.source,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'identity.assigned', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { assignmentId, catalogEntityId, authority: evidence.authority, source: evidence.source },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { assignmentId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// correctIdentity — requires a prior LIVE assignment to supersede
// (ConflictError otherwise — "correcting" implies something exists to
// correct; a genuinely-unassigned asset should use assignIdentity).
// ─────────────────────────────────────────────────────────────────────
export async function correctIdentity({ principalId, gkAssetId, newCatalogEntityId, reason, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, reason }, ['principalId', 'gkAssetId', 'reason']);

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'correctIdentity';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const priorLive = await repo.getLiveIdentityAssignment(client, gkAssetId);
      if (!priorLive) {
        throw new ConflictError(`gk_asset ${gkAssetId} has no live identity assignment to correct — use assignIdentity for a first assignment`);
      }

      const assignmentId = await repo.insertIdentityAssignment(client, {
        assetId: gkAssetId, catalogEntityId: newCatalogEntityId ?? null,
        authority: 'CORROBORATED', source: 'operator-correction',
      });
      await repo.writeDomainEvent(client, {
        eventType: 'identity.corrected', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { assignmentId, priorAssignmentId: priorLive.id, newCatalogEntityId: newCatalogEntityId ?? null, reason },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { assignmentId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// attachMediaMetadata
// ─────────────────────────────────────────────────────────────────────
export async function attachMediaMetadata({ principalId, gkAssetId, mediaFields, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, mediaFields }, ['principalId', 'gkAssetId', 'mediaFields']);
  requireFields(mediaFields, ['mediaType', 'contentHash']);
  requireEnum(mediaFields.mediaType, ['capture-photo', 'grading-photo', 'document'], 'mediaFields.mediaType');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'attachMediaMetadata';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const mediaId = await repo.insertMedia(client, {
        assetId: gkAssetId, mediaType: mediaFields.mediaType, contentHash: mediaFields.contentHash,
        objectUri: mediaFields.objectUri, recordedByPrincipalId: principalId,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'media.recorded', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { mediaId, mediaType: mediaFields.mediaType },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { mediaId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// transferOwnership
// ─────────────────────────────────────────────────────────────────────
export async function transferOwnership({ principalId, gkAssetId, toPrincipalId, type, reason, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, toPrincipalId, type, reason }, ['principalId', 'gkAssetId', 'toPrincipalId', 'type', 'reason']);
  // v1: only 'ownership' is real — no custody_event table exists in the
  // live schema (see the design doc, Section 2). Rejecting 'custody'
  // rather than silently writing an ownership_event under that label.
  requireEnum(type, ['ownership'], 'type');
  requireEnum(reason, ['transfer', 'correction'], 'reason');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'transferOwnership';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const toExists = await repo.assertPrincipalExists(client, toPrincipalId);
      if (!toExists) throw new NotFoundError(`toPrincipalId ${toPrincipalId} does not resolve to a real gk_principal row`);

      const ownershipEventId = await repo.insertOwnershipEvent(client, {
        assetId: gkAssetId, ownerPrincipalId: toPrincipalId, reason, recordedByPrincipalId: principalId,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'ownership.transferred', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { ownershipEventId, toPrincipalId, reason },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { ownershipEventId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// recordAcquisition
// ─────────────────────────────────────────────────────────────────────
export async function recordAcquisition({ principalId, gkAssetId, costAmount, costCurrency = 'USD', source, lotReference, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, costAmount, source }, ['principalId', 'gkAssetId', 'costAmount', 'source']);
  requireEnum(source, ['purchase', 'gift', 'inherited', 'other'], 'source');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'recordAcquisition';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const acquisitionEventId = await repo.insertAcquisitionEvent(client, {
        assetId: gkAssetId, costAmount, costCurrency, source, lotReference, recordedByPrincipalId: principalId,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'acquisition.recorded', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { acquisitionEventId, costAmount, costCurrency, source },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { acquisitionEventId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// recordValuation
// ─────────────────────────────────────────────────────────────────────
export async function recordValuation({ principalId, gkAssetId, valueAmount, valueCurrency = 'USD', method, compSnapshotRef, gradeAssumption, buildSha, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, valueAmount, method, buildSha }, ['principalId', 'gkAssetId', 'valueAmount', 'method', 'buildSha']);
  requireEnum(method, ['engine-computed', 'operator-override', 'gocollect', 'other'], 'method');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'recordValuation';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const valuationEventId = await repo.insertValuationEvent(client, {
        assetId: gkAssetId, valueAmount, valueCurrency, method, compSnapshotRef, gradeAssumption, buildSha,
        recordedByPrincipalId: principalId,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'valuation.computed', actorPrincipalId: principalId, actorKind: method === 'engine-computed' ? 'system' : 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { valuationEventId, valueAmount, valueCurrency, method, buildSha },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { valuationEventId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// recordDecision
// ─────────────────────────────────────────────────────────────────────
export async function recordDecision({ principalId, gkAssetId, recommendation, reasonCodes = [], valuationEventId, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, gkAssetId, recommendation }, ['principalId', 'gkAssetId', 'recommendation']);

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'recordDecision';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      const decisionEventId = await repo.insertDecisionEvent(client, {
        assetId: gkAssetId, recommendation, reasonCodes, valuationEventId,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'decision.computed', actorPrincipalId: principalId, actorKind: 'system',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { decisionEventId, recommendation, reasonCodes },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { decisionEventId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}
