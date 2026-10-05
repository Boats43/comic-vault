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
import { authFetch, getPrincipalScope } from "./grailkeySession.js";
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

// PRESENTATION-ONLY label for a Generic asset with no operator-supplied name.
// UNIVERSAL U1: the operator's name is OPTIONAL. When absent we NEVER store a
// placeholder as identity ("Unidentified asset" is not a title): the entry's
// `title` stays empty, and this derived label is computed at render time only,
// from durable metadata (capture time + the stable asset id), so several
// unnamed assets stay visually distinct. It must never be written as title
// truth, used for duplicate detection, or reach marketplace copy.
export function genericDisplayLabel(item) {
  const name = typeof item?.title === "string" ? item.title.trim() : "";
  if (name) return name;
  const t = Number(item?.timestamp) || Date.parse(item?.createdAt || "") || 0;
  const day = t
    ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "undated";
  const tag = String(item?.id || "").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
  return `Unidentified asset · ${day}${tag ? ` · #${tag}` : ""}`;
}

// The submit step — UNIVERSAL U1, GK-266-CORRECT ORDER.
//
// BEFORE (broken since GK-266): capture-scan (physical mint) ran FIRST, then the
// collection_item was written. GK-266's assertCollectionItemLinkable correctly
// refuses to link a physical asset to a collection_item that does not yet exist
// server-side, so every Generic capture was rejected.
//
// NOW (GK-266 is not weakened and has no Generic exception):
//   1. durable local entry, then the authoritative server Collection row FIRST
//      (assetCategory 'generic', via the same local-first persistCollectionItem
//      every other catalogue write uses). If that cannot be confirmed 'synced',
//      NOTHING is minted — the draft stays for a safe retry.
//   2. only then POST /api/capture-scan with collectionItemId = the now-durable
//      row's id: mint gk_asset (asset_class 'generic'), attach the photo, link
//      the row, record acquisition if supplied, and initialize Inventory
//      Authority (server-side, existing neutral state).
//   3. record the gkAssetId back onto the Collection row, retire the draft.
// draft.id is the collection item id AND the capture idempotency key throughout,
// so a reload/retry at ANY step is byte-for-byte the same request.
//
// Returns { ok: true, entry, gkAssetId } or { ok: false, ambiguous: true } /
// { ok: false, error }. The draft is deleted ONLY on a confirmed success.
export async function submitGenericCapture(draft) {
  if (!draft?.photoDataUrl) return { ok: false, error: "A photo is required." };

  // MID-FLIGHT ACCOUNT SWITCH: the principal that started this submit owns every write below. If the
  // signed-in account changes at any await, the flow FAILS CLOSED — it never writes the other
  // account's scope and never re-attributes the capture (the draft stays in the STARTING principal's
  // own database and is retried, idempotently, when that account signs back in).
  const startedAs = getPrincipalScope();
  if (!startedAs) return { ok: false, error: "Not signed in." };
  const switched = () => getPrincipalScope() !== startedAs;
  const switchedResult = { ok: false, scopeChanged: true, error: "The signed-in account changed while saving — nothing was saved under the other account. Sign back in to finish." };

  await updateGenericCaptureDraft(draft.id, { status: "submitting" });

  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  const entry = {
    id: draft.id,
    assetCategory: "generic",
    title: name, // may be empty: never a placeholder-as-identity
    description: draft.description || "",
    purchasePrice: draft.acquisitionCost ?? null,
    images: [draft.photoDataUrl],
    timestamp: draft.createdAt || Date.now(),
  };

  // STEP 1 — the authoritative Collection row exists server-side BEFORE any mint.
  let synced;
  try {
    await putComic(entry);
    synced = await persistCollectionItem(entry);
  } catch {
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, ambiguous: true };
  }
  if (switched()) return switchedResult;
  if (!synced || synced._syncStatus !== "synced") {
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, ambiguous: true };
  }

  // STEP 2 — physical mint, linked to the now-durable row.
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

  if (switched()) return switchedResult;
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
    // Definitive rejection — the SAME draft (same id, same bytes) can still be
    // safely retried; discard is left to the operator, never automatic.
    await updateGenericCaptureDraft(draft.id, { status: "draft" });
    return { ok: false, error: captureBody.detail || captureBody.error || `Capture failed (${captureRes.status})` };
  }

  if (switched()) return switchedResult;
  const gkAssetId = captureBody.gkAssetId || null;

  // STEP 3 — record the durable asset id on the Collection row (local-first,
  // best-effort server sync; the capture link is already the durable truth).
  const linked = gkAssetId ? { ...entry, gkAssetId } : entry;
  await putComic(linked);
  const final = await persistCollectionItem(linked).catch(() => ({ ...linked, _syncStatus: "pending" }));

  // Only a fully-recorded durable asset (gkAssetId present) retires the draft.
  if (gkAssetId && !switched()) {
    await discardGenericCaptureDraft(draft.id);
  }

  return { ok: true, entry: final || linked, gkAssetId, inventory: captureBody.inventory || null };
}
