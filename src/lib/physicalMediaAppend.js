// src/lib/physicalMediaAppend.js — GK-227. Client-side bridge to
// /api/asset-media-append. Best-effort, fire-and-forget-safe (mirrors
// src/lib/collectionSync.js's pushCollectionItem contract exactly):
// callers must never let this block or fail the local photo-add it
// accompanies. Never throws — returns the parsed success body, or null
// on any failure (network, auth, validation, conflict).
//
// This module NEVER fetches a URL on the caller's behalf — it only ever
// transmits the exact `dataUrl` bytes it is given. The one and only
// provenance rule this file enforces client-side: it will not even
// attempt to send something that isn't a real local data: URL (the same
// guard GrailKeyOperatorPanel.jsx's captureAsOwnedAsset() already uses
// for the original capture photo) — a synced remoteImages proxy path or
// any other non-data: string is refused before any network call, same as
// server-side (api/asset-media-append.js's own base64-charset check is
// the second, independent layer of the same discipline).

import { authFetch } from "./grailkeySession.js";

function stripDataUrlPrefix(dataUrl) {
  const idx = dataUrl.indexOf(",");
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}
function contentTypeFromDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m ? m[1] : "image/jpeg";
}

export const CAPTURE_VIEWS = ["FRONT", "BACK", "SPINE", "PAGES", "DETAIL"];

// dataUrl MUST be this device's own real local data: URL — never a
// remoteImages proxy path, never a marketplace/reference URL.
export async function appendPhysicalMediaEvidence({ gkAssetId, dataUrl, captureView, idempotencyKey }) {
  if (!gkAssetId || !captureView || !idempotencyKey) return null;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  try {
    const res = await authFetch("/api/asset-media-append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gkAssetId,
        bytes: stripDataUrlPrefix(dataUrl),
        contentType: contentTypeFromDataUrl(dataUrl),
        captureView,
        idempotencyKey,
      }),
    });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function pendingKey(itemId, captureView) {
  return `grailkey_evidence_pending_v1:${itemId}:${captureView}`;
}

export function getOrCreateEvidenceIdempotencyKey(itemId, captureView) {
  const storageKey = pendingKey(itemId, captureView);
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const fresh = crypto.randomUUID ? crypto.randomUUID() : `${itemId}-${captureView}-${Date.now()}`;
    localStorage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID ? crypto.randomUUID() : `${itemId}-${captureView}-${Date.now()}`;
  }
}

export function retireEvidenceIdempotencyKey(itemId, captureView) {
  try {
    localStorage.removeItem(pendingKey(itemId, captureView));
  } catch {
    // no-op
  }
}

// Retried on every authenticated reconnect, same trigger point as
// retryPendingCollectionItems/retryPendingBuyerDecisions. Each catalogue
// item may carry `_pendingEvidenceAppends: [{gkAssetId, captureView,
// dataUrl, idempotencyKey}]` — local-only scratch state, NEVER synced to
// the server's collection_item.attributes (src/lib/collectionSync.js
// explicitly excludes this field). Retries using the EXACT ORIGINAL
// bytes stored in that entry — never re-derives from item.images (which
// may have been reordered/trimmed since), never reconstructs from a URL.
export async function retryPendingPhysicalMediaAppends(items, onResolved) {
  for (const item of items || []) {
    const pending = item?._pendingEvidenceAppends;
    if (!Array.isArray(pending) || pending.length === 0) continue;
    const stillPending = [];
    for (const entry of pending) {
      const result = await appendPhysicalMediaEvidence(entry);
      if (result?.mediaId) {
        retireEvidenceIdempotencyKey(item.id, entry.captureView);
      } else {
        stillPending.push(entry);
      }
    }
    if (stillPending.length !== pending.length && typeof onResolved === "function") {
      onResolved(item.id, stillPending);
    }
  }
}
