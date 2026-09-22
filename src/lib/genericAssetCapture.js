// src/lib/genericAssetCapture.js — U4, Generic Asset Mode.
//
// The ONLY client-side orchestration path in this codebase that can mint
// a gk_asset with assetClass:'generic'. Deliberately separate from
// addToCatalogue/gradeBlob (the comic scan pipeline, src/App.jsx) and
// from GrailKeyOperatorPanel's captureAsOwnedAsset (which captures an
// ALREADY comic-shaped, already-enriched catalogue item) — this path
// never calls /api/grade or /api/enrich, never imports ComicAdapter, and
// never produces a comic-shaped catalogue entry. North star (U4
// dispatch): operator chooses Generic Asset Mode -> physical photo ->
// explicit owned-asset capture -> idempotent gkAssetId -> server-backed
// media evidence -> durable collection_item_link -> Collection
// projection -> optional acquisition/cost.
//
// A1 (capture-key durability) — the SAME id serves three roles at once:
// the local IndexedDB draft key, the capture idempotencyKey/correlationId
// sent to /api/capture-scan, and the collection_item id sent to
// /api/collection. It is generated and persisted to IndexedDB (via
// db.js's genericCaptureDrafts store — the "existing durable mutation
// layer", same transaction.oncomplete-based durability every other
// mutator in that file already uses) BEFORE any network call. A reload,
// crash, or ambiguous-response retry reuses the exact same draft object
// — including its exact photo bytes — rather than re-reading the file
// picker (which could hand back different bytes on a second read) or
// minting a fresh key (which risks a second physical asset). This
// satisfies A1's own required property: capture identity (the MINT
// basis, mapping.js's buildCaptureBasis) never depends on photo bytes at
// all; a retry with the SAME bytes additionally keeps attachMedia's own
// per-photo idempotency fingerprint (which DOES hash the bytes) from
// ever seeing a mismatched replay.

import {
  putGenericCaptureDraft, getGenericCaptureDraft, deleteGenericCaptureDraft,
  getAllGenericCaptureDrafts, putComic,
} from "../db.js";
import { authFetch } from "./grailkeySession.js";
import { persistCollectionItem } from "./collectionPersistence.js";

// Mirrors GrailKeyOperatorPanel.jsx's own isDefinitiveResponseStatus
// contract exactly (src/lib/operatorActionIdempotency.js) — duplicated
// here rather than imported because that module's definitions are keyed
// to the {gkAssetId, decisionEventId, actionCode} operator-action shape,
// which does not fit "before any gkAssetId exists yet" (same reasoning
// GrailKeyOperatorPanel.jsx's own header gives for not reusing it).
function isDefinitiveResponseStatus(status) {
  return status >= 200 && status < 500 && status !== 429;
}

function stripDataUrlPrefix(dataUrl) {
  const idx = dataUrl.indexOf(",");
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}
function contentTypeFromDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m ? m[1] : "image/jpeg";
}

export function isGenericAsset(item) {
  return !!item && item.assetCategory === "generic";
}

function newDraftId() {
  return crypto.randomUUID ? crypto.randomUUID() : `generic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Called the moment the operator has picked a photo — the earliest point
// a draft can exist, and therefore the latest safe point to persist it,
// per A1's "before any network call" requirement (nothing here makes a
// network call at all).
export async function createGenericCaptureDraft({ photoDataUrl, name = "", description = "", acquisitionCost = null }) {
  const draft = {
    id: newDraftId(),
    photoDataUrl,
    name,
    description,
    acquisitionCost,
    createdAt: Date.now(),
    status: "draft", // 'draft' | 'submitting'
  };
  await putGenericCaptureDraft(draft);
  return draft;
}

export async function updateGenericCaptureDraft(id, patch) {
  const existing = await getGenericCaptureDraft(id);
  if (!existing) throw new Error(`No pending generic-capture draft for id ${id}`);
  const updated = { ...existing, ...patch };
  await putGenericCaptureDraft(updated);
  return updated;
}

export async function listGenericCaptureDrafts() {
  return getAllGenericCaptureDrafts();
}

export async function discardGenericCaptureDraft(id) {
  await deleteGenericCaptureDraft(id);
}

// The submit step. Reuses the draft's OWN id as idempotencyKey/
// correlationId/collectionItemId throughout — never generates a second
// identifier at submit time — so a reload-then-retry of the same draft
// is byte-for-byte the same request as the first attempt.
//
// Returns { ok: true, entry } on success (caller is responsible for
// setCatalogue — this module has no React state of its own), or
// { ok: false, ambiguous: true } / { ok: false, error } on failure. The
// draft is deleted ONLY on a confirmed success; every other outcome
// leaves it in IndexedDB untouched, ready for the same retry.
export async function submitGenericCapture(draft) {
  if (!draft?.photoDataUrl) return { ok: false, error: "A photo is required." };
  if (!draft?.name || !draft.name.trim()) return { ok: false, error: "A name is required." };

  await updateGenericCaptureDraft(draft.id, { status: "submitting" });

  const scanPayload = {
    correlationId: draft.id,
    collectionItemId: draft.id,
    book: null, // U4.2 — no comic identity is ever asserted for a generic asset
    ...(draft.acquisitionCost != null
      ? { acquisition: { costAmount: draft.acquisitionCost, costCurrency: "USD", source: "other" } }
      : {}),
  };

  let captureRes;
  try {
    captureRes = await authFetch("/api/capture-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanPayload,
        photos: [{
          bytes: stripDataUrlPrefix(draft.photoDataUrl),
          contentType: contentTypeFromDataUrl(draft.photoDataUrl),
          captureRole: "capture-photo",
        }],
        idempotencyKey: draft.id,
        assetClass: "generic",
      }),
    });
  } catch {
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, ambiguous: true };
  }

  if (!captureRes) {
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, error: "Not signed in." };
  }
  if (!isDefinitiveResponseStatus(captureRes.status)) {
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, ambiguous: true };
  }
  const captureBody = await captureRes.json().catch(() => ({}));
  if (!captureRes.ok) {
    // Definitive rejection (e.g. a validation error) — the SAME draft
    // (same id, same bytes) can still be safely retried once whatever
    // was wrong is fixed; discard is left to the caller/operator, never
    // automatic here.
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, error: captureBody.detail || captureBody.error || `Capture failed (${captureRes.status})` };
  }

  const gkAssetId = captureBody.gkAssetId || null;

  // U4.3 — collection_item projection, via the SAME reused local-first +
  // best-effort-server-sync mechanism every comic catalogue write already
  // uses (persistCollectionItem, collectionPersistence.js). assetCategory
  // now round-trips through pushCollectionItem (see collectionSync.js).
  const entry = {
    id: draft.id,
    assetCategory: "generic",
    title: draft.name.trim(),
    description: draft.description || "",
    purchasePrice: draft.acquisitionCost ?? null,
    images: draft.photoDataUrl ? [draft.photoDataUrl] : [],
    gkAssetId,
    timestamp: Date.now(),
  };

  await putComic(entry);
  const final = await persistCollectionItem(entry).catch(() => ({ ...entry, _syncStatus: "pending" }));

  // Only a fully-recorded durable asset (gkAssetId present) retires the
  // draft — the local catalogue write above already succeeded either
  // way (local-first, matches every other capture path in this app), but
  // A1's replay-safety guarantee only applies while the draft still
  // exists, so an incomplete capture-scan response is never treated as
  // grounds to discard it.
  if (gkAssetId) {
    await discardGenericCaptureDraft(draft.id);
  }

  return { ok: true, entry: final || entry, gkAssetId };
}
