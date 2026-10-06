// src/lib/collectionSync.js — GrailKey Clean Account/Collection Cutover
// (2026-09-17). Thin client for the server-authoritative /api/collection
// contract. Every call goes through authFetch (grailkeySession.js) —
// returns null when there is no valid session or the server is
// unreachable, exactly like every other authFetch caller in this file;
// never throws. Callers treat null as "legacy local cache stands,
// nothing to hydrate/sync this time," never as a fatal error — per the
// standing rule that a server-cutover failure must never touch, block,
// or lose local data.
//
// `images` (base64 data URLs) is sent as its own top-level sibling
// field, kept OUT of `attributes` — api/collection.js is the one place
// that isn't opaque about it: it uploads each photo through the media
// module's content-addressed blob store and writes only the resulting
// URL into attributes.remoteImages before persisting. The raw base64
// bytes themselves never reach the collection_item JSONB column (still
// true to the original rationale — a JSONB column is not a blob store —
// see db/data0/0026_collection_item.sql's own header and
// api/collection.js's own comment for the full design). This is what
// makes a synced item's photo visible on a second device that never
// scanned it locally (getComicPhotos()'s remoteImages fallback,
// src/App.jsx) without ever storing a large blob in Postgres.
//
// Excludes `_syncStatus` (collectionPersistence.js) — a local
// cache/UI-status marker, never a real collection-item attribute; it
// must never round-trip into the server's own attributes JSONB.
//
// Excludes `_pendingEvidenceAppends` (GK-227,
// src/lib/physicalMediaAppend.js) for the same reason `images` itself
// gets special top-level handling rather than living in `attributes`:
// it holds raw base64 photo bytes (queued physical-asset evidence not
// yet durably appended to the kernel media table) — sending it as an
// ordinary attribute would write raw photo bytes straight into the
// collection_item JSONB column, exactly what 0026's own design forbids
// for `images`. This field is local-only retry scratch state; the
// durable fact it targets (a media row) is written via
// /api/asset-media-append, never via /api/collection.

import { authFetch } from "./grailkeySession.js";
import { isSupportedAssetCategory } from "./assetCategories.js";

export async function fetchServerCollection() {
  try {
    const res = await authFetch("/api/collection");
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.items) ? body.items : null;
  } catch {
    return null;
  }
}

// GK-234 (2026-09-20) — COLLECTION DELETE RESURRECTION fix. Unlike
// pushCollectionItem (best-effort, fire-and-forget-safe by design —
// losing a create/update sync attempt just means the record stays
// pending and gets retried), a DELETE is destructive and irreversible on
// the server, and this repo's own login-rehydration path is
// unconditionally additive (App.jsx, GrailKey Clean Account/Collection
// Cutover comment) — it will silently resurrect ANY row the server still
// has on the very next authenticated reload, including a plain page
// refresh. This function therefore does NOT swallow failures into null;
// callers MUST distinguish success from failure and must never remove a
// synced item locally on a failed server call. A 404 (already gone, or
// never existed server-side) is treated as SUCCESS — the end state the
// caller wants (no server row) already holds.
export async function deleteServerCollectionItem(id) {
  const res = await authFetch(`/api/collection?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res) {
    throw new Error("Could not reach the server (no session or network unavailable) — item was NOT deleted server-side.");
  }
  if (res.status === 404) {
    return { id, deleted: true, alreadyGone: true };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Server delete failed (HTTP ${res.status})`);
  }
  return await res.json().catch(() => ({ id, deleted: true }));
}

// Best-effort, fire-and-forget-safe: callers must NEVER let this block
// or fail the local save it accompanies (server becomes authoritative
// over time, but a network blip must never lose a scan taken in hand).
// DUPLICATE ENTRY RELEASE CERTIFICATION — the one place that tells a server "operator must choose
// SAME COPY / ANOTHER COPY" (409 PHYSICAL_COPY_DECISION_REQUIRED) apart from every other failure.
// Returns { result, decisionRequired, candidates }. `result` is exactly what pushCollectionItem has
// always returned (the server row, or null on ANY failure incl. this 409), so no caller changes.
export async function pushCollectionItemDetailed(entry) {
  try {
    // U4 — assetCategory is read from the entry itself (defaulting to
    // 'comic', unchanged for every pre-existing caller that never sets
    // this field) rather than hardcoded, so a generic-asset catalogue
    // record syncs with its real category instead of being silently
    // relabeled 'comic' on every push.
    // GK-261 — _gradeReceiptId is the OPAQUE handle /api/grade returned; it is sent as its
    // own top-level field (never inside attributes) and the server derives the model
    // baseline from its own receipt record. No model/grade authority value is ever sent.
    const { images, _syncStatus, _pendingEvidenceAppends, _gradeReceiptId, assetCategory, ...attributes } = entry || {};
    // U1 — NO DEFAULT CATEGORY. An entry with no explicit supported category is never pushed
    // (it stays pending locally); it is never relabeled 'comic' on its way to the server.
    if (!isSupportedAssetCategory(assetCategory)) return { result: null, decisionRequired: false, candidates: [] };
    const res = await authFetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        assetCategory,
        attributes,
        images: Array.isArray(images) && images.length > 0 ? images : undefined,
        gradeReceiptId: typeof _gradeReceiptId === "string" ? _gradeReceiptId : undefined,
      }),
    });
    if (res && res.status === 409) {
      const b409 = await res.json().catch(() => null);
      if (b409 && b409.error === "PHYSICAL_COPY_DECISION_REQUIRED") {
        return { result: null, decisionRequired: true, candidates: Array.isArray(b409.candidates) ? b409.candidates : [] };
      }
      return { result: null, decisionRequired: false, candidates: [] };
    }
    if (!res || !res.ok) return { result: null, decisionRequired: false, candidates: [] };
    return { result: await res.json().catch(() => null), decisionRequired: false, candidates: [] };
  } catch {
    return { result: null, decisionRequired: false, candidates: [] };
  }
}

export async function pushCollectionItem(entry) {
  return (await pushCollectionItemDetailed(entry)).result;
}
