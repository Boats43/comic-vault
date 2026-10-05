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
  createPhysicalAsset, assignIdentity, attachMedia,
  recordAcquisition, linkCollectionItem, assertCollectionItemLinkable, resolveCollectionItemLink,
  resolvePhysicalCopyChoice, recordPhysicalCopyDecision, getPhysicalCopyDecisionForKey,
  assessTransientDuplicate, retireTransientDuplicate, isServerProvenContinuity, hasAnotherCopyDecisionForItem,
  PhysicalCopyDecisionRequiredError,
  findPhysicalCopyCandidatesForBook, validatePhysicalCopyChoiceForBook,
  ValidationFailedError, ConflictError,
} from '../assets/index.js';
import * as mapping from './mapping.js';
import { enrollAsset, ConflictError as InventoryConflictError } from '../inventory/index.js';
import { claimGradeReceipt, restoreGradeReceipt } from '../../lib/gradeReceipt.js';
import { SUPPORTED_ASSET_CATEGORIES, isSupportedAssetCategory } from '../../lib/assetCategories.js';

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

// U4.2 / U1 — the only durable asset classes this orchestrator will ever
// mint (comic | book | generic). Deliberately NOT free-text: exposing arbitrary
// asset_class values here would let a caller invent categories with no adapter,
// no render path, and no A2 background-path exclusion behind them. U1: there is
// NO DEFAULT — a missing or unknown assetClass is refused, never minted as comic.
const ALLOWED_ASSET_CLASSES = SUPPORTED_ASSET_CATEGORIES;

async function captureFromScanOnce({
  principalId, scanPayload, photos = [], idempotencyKey, assetClass, copyDisposition,
} = {}) {
  requireFields({ principalId, scanPayload, idempotencyKey }, ['principalId', 'scanPayload', 'idempotencyKey']);
  if (!isSupportedAssetCategory(assetClass)) {
    throw new ValidationFailedError(
      `assetClass is required and must be one of ${ALLOWED_ASSET_CLASSES.join('|')} (no default), got: ${assetClass === undefined ? 'undefined' : JSON.stringify(assetClass)}`
    );
  }
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

  // GK-279 — a SAME_COPY backstop that already retired its transient row:
  // a retry finds no collection row any more. Replay from the durable
  // decision (never re-adjudicate, never 400 on the now-missing row).
  if (scanPayload.collectionItemId && !existingLink) {
    const prior = await getPhysicalCopyDecisionForKey({ principalId, captureIdempotencyKey: idempotencyKey });
    if (prior && prior.choice === 'SAME_COPY' && prior.incoming_retired) {
      if (copyDisposition?.choice && (copyDisposition.choice !== 'SAME_COPY' || copyDisposition.selectedGkAssetId !== prior.selected_gk_asset_id)) {
        throw new ConflictError(`capture idempotencyKey "${idempotencyKey}" already recorded a different physical-copy decision`);
      }
      const media = [];
      for (let i = 0; i < photos.length; i++) {
        media.push(await attachMedia({
          principalId, gkAssetId: prior.resulting_gk_asset_id, bytes: photos[i].bytes, contentType: photos[i].contentType,
          captureRole: photos[i].captureRole || 'capture-photo',
          idempotencyKey: `${idempotencyKey}:media:${i}`, correlationId: scanPayload.correlationId,
        }));
      }
      return {
        gkAssetId: prior.resulting_gk_asset_id, mintOutcome: 'same-copy-confirmed-existing', linkOutcome: null,
        identity: null, media, valuation: null, decision: null, acquisition: null,
        copyDecision: { choice: 'SAME_COPY', canonicalCollectionItemId: prior.canonical_collection_item_id, retired: true, replayed: true },
      };
    }
  }

  // GK-266 — CONTINUITY HARDENING. A collectionItemId with no existing
  // link is about to drive a fresh gkAsset mint + media attach + link
  // creation below. Prove the referenced collection_item durably exists
  // and belongs to this principal FIRST — a bad/stale/nonexistent
  // reference must produce ZERO new physical state (no gkAsset, no
  // media, no link), not merely fail at the link-creation step after
  // resources are already spent. This is an optimization on top of
  // linkCollectionItem's own unconditional server-side check, below —
  // that check remains the authoritative defense (defense in depth,
  // never relying on this call site alone).
  if (scanPayload.collectionItemId && !existingLink) {
    await assertCollectionItemLinkable({ principalId, collectionItemId: scanPayload.collectionItemId, expectedCategory: assetClass });
  }

  let continuityLink = null;
  if (!existingLink && scanPayload.priorCollectionItemId) {
    const claimed = await resolveCollectionItemLink({
      principalId, collectionItemId: scanPayload.priorCollectionItemId,
    });
    // Nonexistent and foreign ids are indistinguishable (resolveCollectionItemLink
    // returns null for both) -> one refusal, no information leak.
    if (!claimed) {
      throw new ValidationFailedError(
        `priorCollectionItemId "${scanPayload.priorCollectionItemId}" does not resolve to an ` +
        `existing linked asset for this principal — cannot assert rescan continuity`
      );
    }
    // GK-279 — CONTINUITY MUST BE SERVER-PROVEN. priorCollectionItemId is a CLIENT
    // assertion; the server never validated that it is really this row's
    // predecessor. It bypasses duplicate discovery ONLY when a durable operator
    // SAME_COPY decision names this incoming row and resolves to the same asset.
    // Otherwise it is IGNORED as a bypass and the candidate guard below applies.
    if (scanPayload.collectionItemId
        && await isServerProvenContinuity({ principalId, collectionItemId: scanPayload.collectionItemId, priorGkAssetId: claimed.gkAssetId })) {
      continuityLink = claimed;
    }
  }

  // GK-279 — PHYSICAL COPY DISAMBIGUATION. Only a would-be FRESH MINT is
  // gated: an existing link / explicit continuity alias already names its
  // asset. Catalogue similarity to an owned asset never decides anything —
  // it only forces the operator to choose SAME_COPY or ANOTHER_COPY
  // BEFORE any gkAssetId is minted (throws PhysicalCopyDecisionRequiredError
  // with the candidates when no choice was supplied). No candidate ->
  // the normal mint path, unchanged, no prompt.
  let copyChoice = null;
  let transientAssessment = null;
  if (!existingLink && !continuityLink && scanPayload.collectionItemId && assetClass !== 'generic') {
    copyChoice = await resolvePhysicalCopyChoice({
      principalId, collectionItemId: scanPayload.collectionItemId,
      book: scanPayload.book, disposition: copyDisposition,
      captureIdempotencyKey: idempotencyKey,
    });
  }

  if (existingLink) {
    gkAssetId = existingLink.gkAssetId;
    mintOutcome = 'attached-existing-via-link';
  } else if (continuityLink) {
    gkAssetId = continuityLink.gkAssetId;
    mintOutcome = 'attached-existing-via-continuity-alias';
  } else if (copyChoice?.choice === 'SAME_COPY') {
    // SAME COPY: NO new gkAssetId, NO second ownership identity, NO second
    // collection_item_link (the existing asset's canonical link stands), NO
    // second identity assignment / acquisition (no duplicated history). The
    // new photo is still new evidence of the same physical object and is
    // appended below through the existing attachMedia mechanism.
    gkAssetId = copyChoice.selected.gkAssetId;
    mintOutcome = 'same-copy-confirmed-existing';
    // BACKSTOP ONLY (the save-time prompt is the normal surface). The
    // incoming catalogue row is already durable and would otherwise remain
    // as a duplicate card. It is retired ONLY when every condition holds
    // (unlinked, no correction history, evidence fully preserved by the
    // photo in this request); otherwise SAME_COPY is refused BEFORE any
    // write — never a forced delete, never a weakened immutability.
    const assess = await assessTransientDuplicate({ principalId, collectionItemId: scanPayload.collectionItemId });
    const reasons = [...assess.reasons];
    if (!Array.isArray(photos) || photos.length < 1) reasons.push('no photo supplied to preserve as evidence');
    if (reasons.length > 0) {
      throw new ConflictError(`SAME_COPY_UNAVAILABLE: this catalogue entry cannot be safely retired (${reasons.join('; ')})`);
    }
    transientAssessment = assess;
    await recordPhysicalCopyDecision({
      principalId, collectionItemId: scanPayload.collectionItemId,
      candidateGkAssetIds: copyChoice.candidates.map((c) => c.gkAssetId),
      choice: 'SAME_COPY', selectedGkAssetId: gkAssetId, resultingGkAssetId: gkAssetId,
      captureIdempotencyKey: idempotencyKey, surface: 'CAPTURE',
      relatedPredictionEventId: assess.predictionEventId,
      canonicalCollectionItemId: copyChoice.selected.collectionItemId, incomingRetired: true,
    });
  } else {
    const captureBasis = mapping.buildCaptureBasis(principalId, scanPayload);
    const mint = await createPhysicalAsset({
      principalId, captureBasis, assetClass,
      source: 'capture-integration',
      correlationId: scanPayload.correlationId,
      idempotencyKey: `${idempotencyKey}:mint`,
    });
    gkAssetId = mint.assetId;
    mintOutcome = mint.outcome;
    if (copyChoice?.choice === 'ANOTHER_COPY') {
      // Operator explicitly overrode catalogue similarity: a distinct
      // physical copy. Durable, and says nothing about grade/value equality.
      await recordPhysicalCopyDecision({
        principalId, collectionItemId: scanPayload.collectionItemId,
        candidateGkAssetIds: copyChoice.candidates.map((c) => c.gkAssetId),
        choice: 'ANOTHER_COPY', selectedGkAssetId: null, resultingGkAssetId: gkAssetId,
        captureIdempotencyKey: idempotencyKey,
      });
    }
  }
  const sameCopy = mintOutcome === 'same-copy-confirmed-existing';

  // 1c — media mapping. Real bytes (or an honestly-labeled substitute,
  // per C6) in, real stored objects + media rows out — via the Asset
  // Service's own attachMedia (DATA-1C), unmodified here.
  //
  // U3-ratify (Ruling 45) — media is attached BEFORE the collection_item
  // link is created: gk_asset -> media -> collection_item_link ->
  // collection_item. Media only ever depends on gkAssetId (already
  // resolved above), never on the link, so this reorder changes nothing
  // about what data is available at this point — it only changes the
  // order two independent, already-idempotent writes happen in.
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

  // Link the CALLER'S collectionItemId to gkAssetId whenever it doesn't
  // already point there — covers both the fresh-mint case (unchanged)
  // and the continuity-alias case (new collectionItemId, pre-existing
  // asset): collection_item_link has no uniqueness on gk_asset_id, so
  // multiple collectionItemIds legitimately alias to one asset; the OLD
  // collectionItemId's own row is never touched or removed, so it stays
  // independently resolvable too (aliases accumulate, never replace).
  if (scanPayload.collectionItemId && !existingLink && !sameCopy) {
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
  const identity = sameCopy ? null : await assignIdentity({
    principalId, gkAssetId, catalogEntityId: null, evidence: identityEvidence,
    idempotencyKey: `${idempotencyKey}:identity`,
    correlationId: scanPayload.correlationId,
  });

  // 1d — economics mapping. Each sub-mapping is conditional on the real
  // scanPayload actually carrying the relevant field — never fabricated
  // when absent.
  // GK-276 — CLIENT-SUPPLIED PRICE/VALUE IS NOT valuation_event AUTHORITY.
  // This path used to persist scanPayload.outcome.price into valuation_event
  // labelled method='engine-computed' although the server never computed it
  // (an authenticated client could assert any dollar value). It no longer
  // writes a valuation at all: valuation_event is written only by governed
  // writers (server-derived economic engine / operator override).
  const valuation = null;

  // GK-277 -- CLIENT RECOMMENDATION != DURABLE ECONOMIC DECISION AUTHORITY.
  // This path used to persist scanPayload.outcome.decisionAction as a durable,
  // now-immutable decision_event (a client-asserted recommendation, anchored to
  // nothing once GK-276 stopped writing a valuation). It no longer writes a
  // decision at all: decision_event is written only by the certified
  // server-owned path (recordEconomicDecision, GK-180). A client may display or
  // request a recommendation; it can never mint one.
  const decision = null;

  let acquisition = null;
  if (!sameCopy && mapping.hasAcquisition(scanPayload)) {
    acquisition = await recordAcquisition({
      principalId, gkAssetId, ...mapping.mapAcquisition(scanPayload),
      idempotencyKey: `${idempotencyKey}:acquisition`,
      correlationId: scanPayload.correlationId,
    });
  }

  // UNIVERSAL U1 — a newly captured GENERIC asset enters the EXISTING neutral Inventory
  // Authority AVAILABLE state (no Generic-only state exists or is created). The operator's
  // explicit Save-as-Generic / Capture-Generic action IS the enrollment authorization; it is
  // never inferred for comic/book captures. Idempotent via a derived key; an asset that is
  // already enrolled (a replay under another key) is treated as already-enrolled, not an error.
  let inventory = null;
  if (assetClass === 'generic' && !sameCopy) {
    try {
      inventory = await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${idempotencyKey}:inventory` });
    } catch (e) {
      if (e instanceof InventoryConflictError) inventory = { gkAssetId, state: 'AVAILABLE', alreadyEnrolled: true };
      else throw e;
    }
  }

  let retired = false;
  if (sameCopy && transientAssessment) {
    // Evidence (photo) is durably on the existing asset and the decision
    // (with the prediction link) is recorded — only now retire the transient row.
    const r = await retireTransientDuplicate({ principalId, collectionItemId: scanPayload.collectionItemId });
    retired = r.retired || r.alreadyGone === true;
  }

  return {
    gkAssetId, mintOutcome, linkOutcome, identity, media, valuation, decision, acquisition,
    ...(inventory ? { inventory } : {}),
    ...(copyChoice?.choice ? {
      copyDecision: {
        choice: copyChoice.choice,
        canonicalCollectionItemId: sameCopy ? copyChoice.selected.collectionItemId : (scanPayload.collectionItemId ?? null),
        ...(sameCopy ? { retired } : {}),
      },
    } : {}),
  };
}

// GK-279 — concurrent identical requests (same idempotencyKey) race on the
// idempotency / link unique constraints. The loser's unique-violation is not
// a double-mint (the constraint is exactly what prevents one) but it must not
// surface as a 500: every sub-operation is idempotent, so re-running replays
// the winner's committed work and converges on the same asset.
const RACE_CONSTRAINTS = new Set(['idempotency_key_unique', 'collection_item_link_pkey']);
async function retryOnIdempotencyRace(fn) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e?.code === '23505' && RACE_CONSTRAINTS.has(e?.constraint)) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function captureFromScan(args = {}) {
  return retryOnIdempotencyRace(() => captureFromScanOnce(args));
}

// ─────────────────────────────────────────────────────────────────────
// GK-279 — SAVE-TIME physical-copy adjudication (the ONE operator prompt).
// All three entry points are server-authoritative: candidates come from the
// server, the choice is validated against them, and the durable result is
// established here — never by the client. Nothing here creates a collection
// row or mints a gkAssetId.
// ─────────────────────────────────────────────────────────────────────
export async function listSaveTimeCopyCandidates({ principalId, book } = {}) {
  requireFields({ principalId, book }, ['principalId', 'book']);
  return findPhysicalCopyCandidatesForBook({ principalId, book });
}

// SAME COPY at save: NO second collection row, NO second asset. The new scan's
// photo is appended to the existing asset; the model inference the operator
// just made is linked to the decision from the SERVER-claimed grade receipt.
async function confirmSameCopyAtSaveOnce({ principalId, book, selectedGkAssetId, gradeReceiptId, photo, idempotencyKey } = {}) {
  requireFields({ principalId, book, selectedGkAssetId, idempotencyKey }, ['principalId', 'book', 'selectedGkAssetId', 'idempotencyKey']);
  const { candidates, selected } = await validatePhysicalCopyChoiceForBook({
    principalId, book, disposition: { choice: 'SAME_COPY', selectedGkAssetId },
  });

  let replayed = false;
  const prior = await getPhysicalCopyDecisionForKey({ principalId, captureIdempotencyKey: idempotencyKey });
  if (prior) {
    if (prior.choice !== 'SAME_COPY' || prior.selected_gk_asset_id !== selected.gkAssetId) {
      throw new ConflictError(`idempotencyKey "${idempotencyKey}" already recorded a different physical-copy decision`);
    }
    replayed = true;
  } else {
    let claim = { ok: false };
    if (typeof gradeReceiptId === 'string') claim = await claimGradeReceipt({ principalId, receiptId: gradeReceiptId });
    // A concurrent identical request may have just consumed the (single-use)
    // receipt and be about to record the decision WITH the prediction link.
    // Give it a bounded moment so the link is never lost to a race; whoever
    // inserts first defines the immutable row.
    if (!claim.ok && typeof gradeReceiptId === 'string') {
      for (let i = 0; i < 20 && !replayed; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (await getPhysicalCopyDecisionForKey({ principalId, captureIdempotencyKey: idempotencyKey })) replayed = true;
      }
    }
    if (!replayed) try {
      await recordPhysicalCopyDecision({
        principalId, collectionItemId: null,
        candidateGkAssetIds: candidates.map((c) => c.gkAssetId),
        choice: 'SAME_COPY', selectedGkAssetId: selected.gkAssetId, resultingGkAssetId: selected.gkAssetId,
        captureIdempotencyKey: idempotencyKey, surface: 'SAVE',
        relatedPredictionEventId: claim.ok ? (claim.baseline?.modelPredictedProvenance?.predictionEventId ?? null) : null,
        canonicalCollectionItemId: selected.collectionItemId, incomingRetired: false,
      });
    } catch (e) {
      if (claim.ok) await restoreGradeReceipt({ receiptId: gradeReceiptId, record: claim.record });
      throw e;
    }
  }

  let media = null;
  if (photo && photo.bytes) {
    media = await attachMedia({
      principalId, gkAssetId: selected.gkAssetId, bytes: photo.bytes, contentType: photo.contentType,
      captureRole: 'capture-photo', idempotencyKey: `${idempotencyKey}:media:0`,
    });
  }
  return { gkAssetId: selected.gkAssetId, canonicalCollectionItemId: selected.collectionItemId, media, replayed };
}

// ANOTHER COPY at save: durable, idempotent record; the row/asset are created
// by the ordinary save + the explicit Capture action (which will NOT ask again).
async function recordAnotherCopyAtSaveOnce({ principalId, book, collectionItemId, idempotencyKey } = {}) {
  requireFields({ principalId, book, collectionItemId, idempotencyKey }, ['principalId', 'book', 'collectionItemId', 'idempotencyKey']);
  const { candidates } = await validatePhysicalCopyChoiceForBook({ principalId, book, disposition: { choice: 'ANOTHER_COPY' } });
  const rec = await recordPhysicalCopyDecision({
    principalId, collectionItemId,
    candidateGkAssetIds: candidates.map((c) => c.gkAssetId),
    choice: 'ANOTHER_COPY', selectedGkAssetId: null, resultingGkAssetId: null,
    captureIdempotencyKey: idempotencyKey, surface: 'SAVE',
  });
  return { decisionId: rec.decisionId, outcome: rec.outcome };
}

export async function confirmSameCopyAtSave(args = {}) {
  return retryOnIdempotencyRace(() => confirmSameCopyAtSaveOnce(args));
}
export async function recordAnotherCopyAtSave(args = {}) {
  return retryOnIdempotencyRace(() => recordAnotherCopyAtSaveOnce(args));
}

// GK-279 — SERVER-OWNED candidate standing at the durable WRITE boundary
// (POST /api/collection, creating a NEW row). The client cannot assert "no
// candidates", skip a preflight, or omit anything: the standing is computed
// here from durable state. ZERO candidates => allowed. Candidates + no
// operator decision for this exact row => PhysicalCopyDecisionRequiredError.
// Check failure => PhysicalCopyCandidateCheckUnavailableError (fail-closed).
// Nothing is written by this function.
export async function assertPhysicalCopySaveAllowed({ principalId, id, attributes, assetCategory } = {}) {
  requireFields({ principalId, id, attributes }, ['principalId', 'id', 'attributes']);
  // U1 — physical-copy discovery is comic/book IDENTITY similarity (title/issue/year). A Generic
  // asset has no catalogue identity (its name is optional, operator-supplied, and never identity
  // authority), so it must never be matched against — or prompt as a duplicate of — anything.
  if (assetCategory === 'generic') return { standing: 'NOT_APPLICABLE_GENERIC' };
  const candidates = await findPhysicalCopyCandidatesForBook({
    principalId,
    book: { title: attributes.title ?? null, issue: attributes.issue ?? null, year: attributes.year ?? null },
  });
  if (candidates.length === 0) return { standing: 'ZERO_CANDIDATES' };
  if (await hasAnotherCopyDecisionForItem({ principalId, collectionItemId: id })) {
    return { standing: 'DECISION_RECORDED' };
  }
  throw new PhysicalCopyDecisionRequiredError(
    'This book resembles a physical copy you already own — choose SAME_COPY or ANOTHER_COPY before it is saved',
    candidates
  );
}
