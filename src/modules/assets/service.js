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

import { createHash } from 'node:crypto';
import * as repo from './repository.js';
import { acquireConnection } from './db.js';
import { checkIdempotencyReplay, claimIdempotencyKey, computeRequestFingerprint } from './idempotency.js';
import { NotFoundError, ConflictError, ValidationFailedError, AuthorizationFailedError } from './errors.js';
import * as media from '../media/index.js';

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

// DATA-1D, T2 — the authorization chain: authenticated principal ->
// OWNED/AUTHORIZED asset -> authorized action. Ruling 13 steps 2-4 were
// explicitly deferred by DATA-1B ("reserved for DATA-1D") — this closes
// step 2 (asset authorization) using the ownership model that already
// exists (current_owner, materialized from ownership_event since
// DATA-1A). In the current single-operator era every asset's owner IS
// the one operator principal (createPhysicalAsset always sets the
// minting principal as initial owner) — this check always passes today,
// but it is a REAL, enforced query against current_owner, never a
// rubber stamp, so it is already correct the moment a second principal
// exists. A bootstrap-parameter caller (a valid gk_principal row that
// simply isn't THIS asset's owner) is rejected here, not silently
// allowed through — the exact gap DATA-1B's own "parameter contract, not
// an auth system" note named as future work.
async function assertPrincipalOwnsAsset(client, principalId, gkAssetId) {
  const ownerId = await repo.getAssetOwner(client, gkAssetId);
  if (!ownerId) {
    throw new AuthorizationFailedError(`gk_asset ${gkAssetId} has no current_owner row — cannot authorize any principal`);
  }
  if (ownerId !== principalId) {
    throw new AuthorizationFailedError(`principalId ${principalId} is not authorized for gk_asset ${gkAssetId} (not the current owner)`);
  }
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
      // GK-163 — semantic payload: what asset this call is minting, from
      // what capture basis, as what class, via what source. Two calls
      // under the same idempotencyKey but a different captureBasis are
      // NOT the same request.
      const requestFingerprint = computeRequestFingerprint({ captureBasis, assetClass, source });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
    await assertAssetExists(client, gkAssetId);
    await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
    return await repo.getAssetGraph(client, gkAssetId);
  } finally {
    client.release();
  }
}

// DATA-1D, T3 — list every asset the authenticated principal owns
// (cross-device retrieval needs a "what's mine" entry point, not just
// "fetch this one gkAssetId I already somehow know"). A thin,
// authorization-scoped read: repo.listAssetsByOwner is itself already
// scoped to principalId — there is no unauthorized branch to guard
// against here the way single-asset reads need (a caller can only ever
// list THEIR OWN principalId's assets, by construction of the query).
export async function listMyAssets({ principalId } = {}) {
  requireFields({ principalId }, ['principalId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    return await repo.listAssetsByOwner(client, principalId);
  } finally {
    client.release();
  }
}

// DATA-1D, T3 — fetch one media row's real object_uri, authorization-
// checked against the media's OWNING asset (not the media row's own
// recorded_by_principal_id, which is provenance, not authorization).
// The one new read this dispatch's asset-media endpoint needs — media
// bytes themselves are never fetched here (that's src/modules/media/'s
// job, called directly by the endpoint after this authorizes the read).
export async function getMediaById({ principalId, mediaId } = {}) {
  requireFields({ principalId, mediaId }, ['principalId', 'mediaId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const mediaRow = await repo.getMediaById(client, mediaId);
    if (!mediaRow) throw new NotFoundError(`media ${mediaId} does not exist`);
    await assertAssetExists(client, mediaRow.asset_id);
    await assertPrincipalOwnsAsset(client, principalId, mediaRow.asset_id);
    return mediaRow;
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
      // GK-163 — semantic payload: which asset, to which catalog entity,
      // asserted with what authority/source. Not the mediaId/evidence
      // internals beyond what actually changes the assertion's meaning.
      const requestFingerprint = computeRequestFingerprint({
        gkAssetId, catalogEntityId, authority: evidence.authority, source: evidence.source,
      });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
      // GK-163 — semantic payload: asset+assignment, per the ticket's own
      // wording — which asset, corrected to which new catalog entity.
      // `reason` is audit-trail text about WHY, not part of WHAT is being
      // asserted, so it's deliberately excluded (matches correctIdentity's
      // own asset+assignment spec exactly).
      const requestFingerprint = computeRequestFingerprint({ gkAssetId, newCatalogEntityId: newCatalogEntityId ?? null });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
      // GK-163 — semantic payload: which asset, what evidence (type +
      // content hash + where it lives). Two calls under the same key
      // describing different bytes/location are NOT the same request.
      const requestFingerprint = computeRequestFingerprint({
        gkAssetId, mediaType: mediaFields.mediaType, contentHash: mediaFields.contentHash, objectUri: mediaFields.objectUri ?? null,
      });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
      const mediaId = await repo.insertMedia(client, {
        assetId: gkAssetId, mediaType: mediaFields.mediaType, contentHash: mediaFields.contentHash,
        objectUri: mediaFields.objectUri, contentType: mediaFields.contentType, recordedByPrincipalId: principalId,
      });
      await repo.writeDomainEvent(client, {
        eventType: 'media.recorded', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { mediaId, mediaType: mediaFields.mediaType },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { mediaId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
// attachMedia — DATA-1C, Task 3, CORRECTED by the DATA-1C review (D3/D4/
// D5). Real bytes in, a real stored object + a real media row out.
// Distinct from attachMediaMetadata (DATA-1B, above), which only ever
// recorded metadata a CALLER already resolved elsewhere — this function
// is the one that actually calls the storage adapter.
//
// D3 — evidence-row semantics, corrected. SHA256 dedupes the STORED
// OBJECT ONLY (src/modules/media/'s content addressing) — it never
// dedupes the EVIDENCE (media) ROW. Two distinct attachMedia calls
// (distinct idempotencyKey) for the identical (asset, role, bytes)
// ALWAYS produce two distinct media rows: two grading sessions that
// happen to photograph the identical page are two legitimate, separate
// evidence events, not one. The ONLY thing that collapses to one row is
// a genuine REPLAY — the same idempotencyKey used again.
//
// D4 — idempotencyKey is now REQUIRED (was optional). A caller-omitted
// key made "was this the same command or a new one" undecidable, which
// D3's row-per-call semantics can no longer tolerate. A request
// fingerprint (sha256 of {gkAssetId, captureRole, sha256}) is checked on
// every replay hit: same key + same semantic request -> the original
// result, verbatim; same key + a DIFFERENT asset/role/content -> a typed
// error, never a silent wrong-answer replay.
//
// GK-163 UPDATE (docs/TICKET-REGISTRY.md) — this was originally the ONE
// operation with this protection, hand-rolled inline (fingerprint stored
// inside result_snapshot JSONB, since no shared column existed yet).
// checkIdempotencyReplay/claimIdempotencyKey (idempotency.js) now carry
// this as a class-wide law (a real `request_fingerprint` column,
// migration 0010) — this function was migrated onto that same shared
// mechanism rather than staying a bespoke tenth copy, so the whole
// module has exactly ONE idempotency-conflict implementation, not one
// original plus nine new ones.
//
// D5 — ordering, corrected. A non-transactional preflight (principal +
// asset existence) runs BEFORE the storage PUT; the PUT itself runs
// with no DB transaction open at all; the same invariants are re-run
// around the actual transactional write (matching every other DATA-1B
// operation's own "assertPrincipalActive right before BEGIN" + the
// asset check now genuinely re-verified again just before the insert,
// not merely trusted from the earlier preflight). A DB transaction is
// never held open across the remote storage I/O.
// ─────────────────────────────────────────────────────────────────────
export async function attachMedia({ principalId, gkAssetId, bytes, contentType, captureRole, idempotencyKey, correlationId } = {}) {
  requireFields(
    { principalId, gkAssetId, bytes, contentType, captureRole, idempotencyKey },
    ['principalId', 'gkAssetId', 'bytes', 'contentType', 'captureRole', 'idempotencyKey']
  );
  requireEnum(captureRole, ['capture-photo', 'grading-photo', 'document'], 'captureRole');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ValidationFailedError('bytes must be a non-empty Buffer/Uint8Array');
  }

  // C5 — the SERVICE computes the hash from the actual received bytes.
  // This is the value written to media.content_hash; the media adapter's
  // own internal hash check (src/modules/media/) is a second, independent
  // computation from the same real bytes — defense in depth, never a
  // caller-declared value trusted for storage.
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // GK-163 — semantic payload: which asset, what role, what content.
  const requestFingerprint = computeRequestFingerprint({ gkAssetId, captureRole, sha256 });

  // D5 — non-transactional preflight, strictly BEFORE any storage I/O.
  const preflight = await acquireConnection();
  try {
    await assertPrincipalActive(preflight, principalId);
    await assertAssetExists(preflight, gkAssetId);
    await assertPrincipalOwnsAsset(preflight, principalId, gkAssetId);
  } finally {
    preflight.release();
  }

  // Storage I/O with NO DB transaction open — a slow/hanging remote PUT
  // must never pin a Postgres connection+transaction for its duration.
  // Content-addressing means an orphaned-but-unreferenced object here
  // (e.g. the transactional write below later fails) is NOT identity
  // corruption — the object is still correctly addressed by its own
  // hash, nothing is ever misattributed — but it IS a real storage/
  // retention leak: bytes billed and held with no media row pointing at
  // them. Reconciliation/GC for orphaned objects is pre-production media
  // debt, not solved by this dispatch (see docs/adr/
  // DATA-1C-MEDIA-DESIGN.md, Task 3).
  const stored = await media.put({ bytes, contentType, sha256 });

  const client = await acquireConnection();
  try {
    // Re-run the invariant this function already checked in the
    // preflight above — the same "assertPrincipalActive right before
    // BEGIN" convention every other DATA-1B operation in this file
    // already follows, genuinely re-executed here, not assumed to still
    // hold from the earlier read.
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'attachMedia';
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      // Re-verified again here, not just trusted from the preflight —
      // the asset could have changed state in the window between the
      // preflight read and this transactional write.
      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);

      const mediaId = await repo.insertMedia(client, {
        assetId: gkAssetId, mediaType: captureRole, contentHash: sha256,
        objectUri: stored.objectUri, contentType, recordedByPrincipalId: principalId,
      });
      const outcome = stored.created ? 'created' : 'existing-blob-new-row';
      await repo.writeDomainEvent(client, {
        eventType: 'media.attached', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { mediaId, captureRole, sha256, objectUri: stored.objectUri, outcome },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const publicResult = { mediaId, objectUri: stored.objectUri, sha256, outcome };
      await claimIdempotencyKey(client, {
        operation, idempotencyKey, principalId, result: publicResult, requestFingerprint,
      });
      await client.query('COMMIT');
      return publicResult;
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
      // GK-163 — semantic payload: asset+destination+type+reason, per the
      // ticket's own wording.
      const requestFingerprint = computeRequestFingerprint({ gkAssetId, toPrincipalId, type, reason });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
// linkCollectionItem / resolveCollectionItemLink — CAPTURE-INT (Task 1a).
// A routing lookup, never an identity claim: collectionItemId !=
// gkAssetId (GK-145's law, formalized). linkCollectionItem throws
// ConflictError rather than silently repointing an existing link to a
// different asset — a genuine "relink" need is a named, unsolved open
// item (see db/data0/0007_capture_integration_linkage.sql), not
// defaulted to either "overwrite" or "reject silently."
// ─────────────────────────────────────────────────────────────────────
export async function linkCollectionItem({ principalId, collectionItemId, gkAssetId, idempotencyKey, correlationId } = {}) {
  requireFields({ principalId, collectionItemId, gkAssetId }, ['principalId', 'collectionItemId', 'gkAssetId']);

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'linkCollectionItem';
      // GK-163 — semantic payload: which collectionItemId, to which asset.
      const requestFingerprint = computeRequestFingerprint({ collectionItemId, gkAssetId });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
      const existing = await repo.getCollectionItemLink(client, { collectionItemId });
      if (existing) {
        if (existing.gk_asset_id !== gkAssetId) {
          throw new ConflictError(
            `collectionItemId "${collectionItemId}" is already linked to a different gkAssetId ` +
            `(${existing.gk_asset_id}) — cannot relink to ${gkAssetId} (no relink mechanism in v1)`
          );
        }
        const result = { collectionItemId, gkAssetId, outcome: 'already-linked' };
        await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
        await client.query('COMMIT');
        return result;
      }

      await repo.insertCollectionItemLink(client, { collectionItemId, gkAssetId, principalId });
      await repo.writeDomainEvent(client, {
        eventType: 'collection-item.linked', actorPrincipalId: principalId, actorKind: 'user',
        subjectType: 'gk_asset', subjectId: gkAssetId,
        payload: { collectionItemId },
        correlationId: correlationId || await newCorrelationId(client),
      });

      const result = { collectionItemId, gkAssetId, outcome: 'linked' };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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

// Read-only, no transaction — mirrors getPhysicalAsset's own shape.
// DATA-1D, T2: a link resolving to an asset the CALLER doesn't own
// returns null (as if the link didn't exist) rather than leaking "this
// collectionItemId belongs to someone's real asset" cross-principal.
export async function resolveCollectionItemLink({ principalId, collectionItemId } = {}) {
  requireFields({ principalId, collectionItemId }, ['principalId', 'collectionItemId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const link = await repo.getCollectionItemLink(client, { collectionItemId });
    if (!link) return null;
    const ownerId = await repo.getAssetOwner(client, link.gk_asset_id);
    if (ownerId !== principalId) return null;
    return { gkAssetId: link.gk_asset_id };
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
      // GK-163 — semantic payload: what was acquired, for how much, from
      // where, out of which lot.
      const requestFingerprint = computeRequestFingerprint({
        gkAssetId, costAmount, costCurrency, source, lotReference: lotReference ?? null,
      });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
      // GK-163 — semantic payload: asset+amount+currency+basis, per the
      // ticket's own wording ("basis" = the valuation method).
      const requestFingerprint = computeRequestFingerprint({ gkAssetId, valueAmount, valueCurrency, method });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
      // GK-163 — semantic payload: asset+decision semantics, per the
      // ticket's own wording (recommendation + reasonCodes + which
      // valuation it's grounded in).
      const requestFingerprint = computeRequestFingerprint({
        gkAssetId, recommendation, reasonCodes, valuationEventId: valuationEventId ?? null,
      });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertAssetExists(client, gkAssetId);
      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
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
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
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
