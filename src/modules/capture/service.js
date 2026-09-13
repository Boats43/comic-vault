// src/modules/capture/service.js — the public surface implementation.
// Orchestrates the Task-1 mapping (docs/adr/DATA-1-CAPTURE-INTEGRATION.md)
// through the Asset Service's PUBLIC contract only
// (src/modules/assets/index.js) — this file issues ZERO SQL and holds NO
// database connection of its own. Every mutation below is a call to an
// already-transactional, already-idempotent Asset Service operation;
// this orchestration layer adds no transaction of its own, matching the
// existing DATA-1B/1C precedent that a caller composing several service
// calls does not need a wrapping meta-transaction (each call is already
// atomic and independently idempotent via its own derived
// idempotencyKey — see below).
//
// Derived idempotency: every sub-operation call gets a key derived
// deterministically from the ONE caller-supplied idempotencyKey
// (`${idempotencyKey}:mint`, `:identity`, `:media:<i>`, `:valuation`,
// `:decision`, `:acquisition`, `:link`) — replaying the exact same
// captureFromScan call (same idempotencyKey) makes every underlying
// operation hit its own replay path, so the WHOLE orchestration is
// idempotent end to end (P2), not idempotent-by-accident.

import {
  createPhysicalAsset, assignIdentity, attachMedia, recordValuation,
  recordDecision, recordAcquisition, linkCollectionItem, resolveCollectionItemLink,
  ValidationFailedError,
} from '../assets/index.js';
import * as mapping from './mapping.js';

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

export async function captureFromScan({ principalId, scanPayload, photos = [], idempotencyKey } = {}) {
  requireFields({ principalId, scanPayload, idempotencyKey }, ['principalId', 'scanPayload', 'idempotencyKey']);
  if (!scanPayload.correlationId && !scanPayload.scanlogKey) {
    throw new ValidationFailedError(
      'scanPayload must carry a correlationId or scanlogKey — the capture-basis identity (Task 1a)'
    );
  }

  // 1a — collectionItemId routing. A scan carrying a collectionItemId
  // that already resolves to an asset ATTACHES to it (new evidence, no
  // second mint). A scan without one — or with one never seen before —
  // mints fresh, UNLESS the caller asserts rescan continuity (below).
  // collectionItemId != gkAssetId, always (GK-145's law): this lookup
  // only decides WHERE new evidence goes, never asserts physical
  // identity on its own.
  //
  // P0-A (rescan-link-drift) — scanPayload.priorCollectionItemId is an
  // OPTIONAL, explicit continuity assertion from the caller: "the
  // browser/catalogue id changed, but this is the same physical asset
  // as the one already linked under priorCollectionItemId." Without
  // this, a genuinely fresh browser-side id for an already-captured
  // physical book has NO way to be distinguished from a genuinely new
  // physical book — there is no perceptual/photo-identity signal
  // anywhere in this codebase, and building one is out of scope here.
  // This is therefore a caller-asserted fact, not an inference; a wrong
  // assertion is a caller bug, exactly as a wrong collectionItemId would
  // be today. Resolution order: collectionItemId's OWN link wins first
  // (unchanged, backward compatible); only when that's absent does
  // priorCollectionItemId get consulted. An unresolvable
  // priorCollectionItemId fails closed (ValidationFailedError) rather
  // than silently minting fresh — a caller that asserts continuity and
  // is wrong about the id must be told, never quietly ignored.
  let gkAssetId, mintOutcome, linkOutcome = null;

  const existingLink = scanPayload.collectionItemId
    ? await resolveCollectionItemLink({ principalId, collectionItemId: scanPayload.collectionItemId })
    : null;

  let continuityLink = null;
  if (!existingLink && scanPayload.priorCollectionItemId) {
    continuityLink = await resolveCollectionItemLink({
      principalId, collectionItemId: scanPayload.priorCollectionItemId,
    });
    if (!continuityLink) {
      throw new ValidationFailedError(
        `priorCollectionItemId "${scanPayload.priorCollectionItemId}" does not resolve to an ` +
        `existing linked asset for this principal — cannot assert rescan continuity`
      );
    }
  }

  if (existingLink) {
    gkAssetId = existingLink.gkAssetId;
    mintOutcome = 'attached-existing-via-link';
  } else if (continuityLink) {
    gkAssetId = continuityLink.gkAssetId;
    mintOutcome = 'attached-existing-via-continuity-alias';
  } else {
    const captureBasis = mapping.buildCaptureBasis(principalId, scanPayload);
    const mint = await createPhysicalAsset({
      principalId, captureBasis, assetClass: 'comic',
      source: 'capture-integration',
      correlationId: scanPayload.correlationId,
      idempotencyKey: `${idempotencyKey}:mint`,
    });
    gkAssetId = mint.assetId;
    mintOutcome = mint.outcome;
  }

  // Link the CALLER'S collectionItemId to gkAssetId whenever it doesn't
  // already point there — covers both the fresh-mint case (unchanged)
  // and the continuity-alias case (new collectionItemId, pre-existing
  // asset): collection_item_link has no uniqueness on gk_asset_id, so
  // multiple collectionItemIds legitimately alias to one asset; the OLD
  // collectionItemId's own row is never touched or removed, so it stays
  // independently resolvable too (aliases accumulate, never replace).
  if (scanPayload.collectionItemId && !existingLink) {
    const link = await linkCollectionItem({
      principalId, collectionItemId: scanPayload.collectionItemId, gkAssetId,
      idempotencyKey: `${idempotencyKey}:link`,
      correlationId: scanPayload.correlationId,
    });
    linkOutcome = link.outcome;
  }

  // 1b — identity translation. Ruling 10: the asset never waits for
  // identity — an ID_REQUIRED-shaped payload still mints and still gets
  // an identity assignment, just NONE/unresolved.
  const identityEvidence = mapping.mapIdentityEvidence(scanPayload);
  const identity = await assignIdentity({
    principalId, gkAssetId, catalogEntityId: null, evidence: identityEvidence,
    idempotencyKey: `${idempotencyKey}:identity`,
    correlationId: scanPayload.correlationId,
  });

  // 1c — media mapping. Real bytes (or an honestly-labeled substitute,
  // per C6) in, real stored objects + media rows out — via the Asset
  // Service's own attachMedia (DATA-1C), unmodified here.
  const media = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const attach = await attachMedia({
      principalId, gkAssetId, bytes: photo.bytes, contentType: photo.contentType,
      captureRole: photo.captureRole || 'capture-photo',
      idempotencyKey: `${idempotencyKey}:media:${i}`,
      correlationId: scanPayload.correlationId,
    });
    media.push(attach);
  }

  // 1d — economics mapping. Each sub-mapping is conditional on the real
  // scanPayload actually carrying the relevant field — never fabricated
  // when absent.
  let valuation = null;
  if (mapping.hasValuation(scanPayload)) {
    valuation = await recordValuation({
      principalId, gkAssetId, ...mapping.mapValuation(scanPayload),
      idempotencyKey: `${idempotencyKey}:valuation`,
      correlationId: scanPayload.correlationId,
    });
  }

  let decision = null;
  if (mapping.hasDecision(scanPayload)) {
    decision = await recordDecision({
      principalId, gkAssetId, ...mapping.mapDecision(scanPayload, valuation),
      idempotencyKey: `${idempotencyKey}:decision`,
      correlationId: scanPayload.correlationId,
    });
  }

  let acquisition = null;
  if (mapping.hasAcquisition(scanPayload)) {
    acquisition = await recordAcquisition({
      principalId, gkAssetId, ...mapping.mapAcquisition(scanPayload),
      idempotencyKey: `${idempotencyKey}:acquisition`,
      correlationId: scanPayload.correlationId,
    });
  }

  return { gkAssetId, mintOutcome, linkOutcome, identity, media, valuation, decision, acquisition };
}
