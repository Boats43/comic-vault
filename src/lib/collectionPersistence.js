// src/lib/collectionPersistence.js — GrailKey Collection Sync Closeout
// (2026-09-18). The one narrow, reused helper for every account-backed
// catalogue write: local-first, server-aware, never silently swallows a
// failed server write.
//
// Contract:
//   1. The local IndexedDB write ALWAYS happens first and ALWAYS
//      succeeds independent of network — a shop-floor scan is never at
//      risk because the server happens to be unreachable. Successful
//      local persistence never depends on network availability.
//   2. A server push is then attempted (best-effort, via
//      pushCollectionItem — collectionSync.js — which already swallows
//      its own network/auth errors and returns null on any failure).
//      Success -> the local record is re-tagged `_syncStatus: 'synced'`.
//      Failure -> the local record stays `_syncStatus: 'pending'`,
//      explicitly and visibly, never silently dropped.
//   3. `_syncStatus` is the one new field this introduces on a
//      catalogue item. It is a local cache/UI-status marker only.
//
// Retry (retryPendingCollectionItems) is deliberately scoped to items
// that ALREADY carry a `_syncStatus` field — i.e., items THIS system
// itself already attempted to sync at least once. A pre-cutover legacy
// record (no `_syncStatus` field at all, never touched by
// persistCollectionItem) is never picked up here, matching the standing
// "no legacy migration" ruling (GrailKey Clean Account/Collection
// Cutover, 2026-09-17). This is a safe second chance for writes this
// system already tried to make, not a generalized distributed-sync
// engine — idempotent because pushCollectionItem's server-side upsert
// already is (same id + same attributes never creates a duplicate row).

import { putComic } from "../db.js";
import { pushCollectionItem } from "./collectionSync.js";

export async function persistCollectionItem(entry) {
  await putComic({ ...entry, _syncStatus: "pending" });
  const serverResult = await pushCollectionItem(entry);
  const finalEntry = { ...entry, _syncStatus: serverResult ? "synced" : "pending" };
  await putComic(finalEntry);
  return finalEntry;
}

export async function retryPendingCollectionItems(items) {
  const pending = (items || []).filter((i) => i && i._syncStatus === "pending");
  const results = [];
  for (const item of pending) {
    results.push(await persistCollectionItem(item));
  }
  return results;
}
