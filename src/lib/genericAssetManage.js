// src/lib/genericAssetManage.js — UNIVERSAL U1: basic management of a Generic
// physical asset (edit name/notes, add photos, read inventory state).
//
// A Generic asset is a FIRST-CLASS physical asset, not a photo card, but it has
// NO automated economics: nothing here grades, prices, fetches comps, or lists.
// Every write is local-first (the principal-scoped IndexedDB) and then synced
// through the same reused persistCollectionItem every catalogue write uses, so
// it inherits the principal-scoping, stale-session and mid-flight-account-switch
// guards. Extra photos additionally become durable kernel `media` rows on the
// asset via /api/asset-media-append (captureView 'DETAIL'), the only bridge from
// operator-supplied bytes to the kernel; a failed append is queued locally in
// `_pendingEvidenceAppends` (never synced) and retried on the next login by the
// existing retryPendingPhysicalMediaAppends — never silently dropped.

import { persistCollectionItem } from "./collectionPersistence.js";
import { appendPhysicalMediaEvidence } from "./physicalMediaAppend.js";
import { authFetch } from "./grailkeySession.js";

function assertGeneric(item) {
  if (!item || item.assetCategory !== "generic") {
    throw new Error("genericAssetManage only operates on an explicit Generic asset");
  }
}

// Edit the operator-supplied name and/or notes. The name may be cleared (empty):
// it is never replaced by a placeholder identity.
export async function updateGenericFields(item, { name, description } = {}) {
  assertGeneric(item);
  const next = {
    ...item,
    title: name !== undefined ? String(name).trim() : (item.title || ""),
    description: description !== undefined ? String(description) : (item.description || ""),
  };
  return persistCollectionItem(next);
}

// Add another photo of the same physical asset. `photoDataUrl` MUST be this
// device's own freshly captured data: URL (never a remote/proxy path).
export async function addGenericPhoto(item, photoDataUrl) {
  assertGeneric(item);
  if (typeof photoDataUrl !== "string" || !photoDataUrl.startsWith("data:")) {
    throw new Error("addGenericPhoto requires a local data: URL");
  }
  const images = [...(Array.isArray(item.images) ? item.images : []), photoDataUrl];
  let next = { ...item, images };
  let kernel = "not-linked";
  if (item.gkAssetId) {
    const idempotencyKey = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `generic-photo-${item.id}-${Date.now()}`;
    const appended = await appendPhysicalMediaEvidence({
      gkAssetId: item.gkAssetId, dataUrl: photoDataUrl, captureView: "DETAIL", idempotencyKey,
    });
    if (appended && appended.mediaId) {
      kernel = "appended";
    } else {
      kernel = "pending";
      next = {
        ...next,
        _pendingEvidenceAppends: [
          ...(Array.isArray(item._pendingEvidenceAppends) ? item._pendingEvidenceAppends : []),
          { gkAssetId: item.gkAssetId, captureView: "DETAIL", dataUrl: photoDataUrl, idempotencyKey },
        ],
      };
    }
  }
  const entry = await persistCollectionItem(next);
  return { entry, kernel };
}

// Read the Inventory Authority state for a Generic asset. Returns
// 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'UNMANAGED' | null (unknown/unreachable).
export async function fetchGenericInventoryState(gkAssetId) {
  if (!gkAssetId) return null;
  try {
    const res = await authFetch(`/api/assets?gkAssetId=${encodeURIComponent(gkAssetId)}`);
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || !Object.prototype.hasOwnProperty.call(body, "inventoryState")) return null;
    return body.inventoryState === null ? "UNMANAGED" : body.inventoryState;
  } catch {
    return null;
  }
}
