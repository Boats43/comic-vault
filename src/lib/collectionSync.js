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
// Deliberately excludes `images` from what it sends to the server —
// large base64 photo blobs have no place in a JSONB attributes column;
// see db/data0/0026_collection_item.sql's own header for the full
// rationale. Photos remain local-only (IndexedDB) for this pass.
//
// Also excludes `_syncStatus` (collectionPersistence.js) — a local
// cache/UI-status marker, never a real collection-item attribute; it
// must never round-trip into the server's own attributes JSONB.

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
    const { images, _syncStatus, ...attributes } = entry || {};
    const res = await authFetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, assetCategory: "comic", attributes }),
    });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}
