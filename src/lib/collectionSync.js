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

// Best-effort, fire-and-forget-safe: callers must NEVER let this block
// or fail the local save it accompanies (server becomes authoritative
// over time, but a network blip must never lose a scan taken in hand).
export async function pushCollectionItem(entry) {
  try {
    const { images, _syncStatus, _pendingEvidenceAppends, ...attributes } = entry || {};
    const res = await authFetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        assetCategory: "comic",
        attributes,
        images: Array.isArray(images) && images.length > 0 ? images : undefined,
      }),
    });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}
