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

import { putComic, getAllComics, getStorageScope, NoPrincipalScopeError, putCopyReviewHeld, getAllCopyReviewHeld } from "../db.js";
import { pushCollectionItemDetailed } from "./collectionSync.js";
import { HELD_KIND, HELD_REASON, buildHeldRecord, syncHeldId } from "./copyReviewHeld.js";

// LIVE EXPOSURE CLOSURE (2026-10-04) — a local row may only ever be pushed
// under the principal whose scoped database holds it. The scope is captured
// BEFORE the first local write and re-checked before every network push and
// every post-push write: if the signed-in principal changed in between
// (logout/login as someone else mid-flight), the operation REFUSES — the
// row stays `_syncStatus:'pending'` in its OWNER's database (retried when
// that owner signs back in) and is never pushed under, or re-written into,
// another principal's scope. The server still derives the principal only
// from the bearer token; this guard exists so the CLIENT never hands the
// server another user's data under a fresh token.
const scopeChanged = (scope) => getStorageScope() !== scope;

export async function persistCollectionItem(entry) {
  const scope = getStorageScope();
  if (!scope) throw new NoPrincipalScopeError();
  await putComic({ ...entry, _syncStatus: "pending" });
  if (scopeChanged(scope)) return { ...entry, _syncStatus: "pending", _refusedScopeChanged: true };
  const pushed = await pushCollectionItemDetailed(entry);
  if (pushed.decisionRequired) {
    // DUPLICATE ENTRY RELEASE CERTIFICATION — the SERVER says this account already owns a plausible
    // physical copy and the operator has not yet chosen SAME COPY / ANOTHER COPY. That is not a sync
    // failure to retry forever: it becomes ONE durable held-copy-review record (deterministic id, so a
    // repeat 409 never duplicates it) and the local row moves to its own `copy-review` state, which the
    // pending-retry loop never touches. The held record is written FIRST: a crash between the two
    // writes leaves the row `pending`, which simply converts again on the next 409.
    const finalHeld = { ...entry, _syncStatus: "copy-review" };
    await holdSyncConflict(finalHeld, pushed.candidates, scope);
    if (scopeChanged(scope)) return { ...finalHeld, _refusedScopeChanged: true };
    await putComic(finalHeld);
    return finalHeld;
  }
  const finalEntry = { ...entry, _syncStatus: pushed.result ? "synced" : "pending" };
  if (scopeChanged(scope)) return { ...finalEntry, _refusedScopeChanged: true };
  await putComic(finalEntry);
  return finalEntry;
}

async function holdSyncConflict(entry, candidates, scope) {
  const id = syncHeldId(entry.id);
  let prior = null;
  try { prior = (await getAllCopyReviewHeld()).find((r) => r.id === id) || null; } catch { prior = null; }
  const fresh = buildHeldRecord({
    kind: HELD_KIND.COLLECTION_SYNC, reason: HELD_REASON.SERVER_DECISION_REQUIRED, principal: scope,
    entry, candidates, candidatesVerified: true,
  });
  // Keep an in-progress attempt's ids and error text if this item was already held.
  await putCopyReviewHeld({ ...fresh, id, createdAt: prior?.createdAt ?? fresh.createdAt, presetId: prior?.presetId ?? fresh.presetId, decisionKey: prior?.decisionKey ?? fresh.decisionKey });
  try { if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("cv:copy-review-changed")); } catch { /* UI nudge only */ }
}

export async function retryPendingCollectionItems(items) {
  const scope = getStorageScope();
  if (!scope) return [];
  // OWNERSHIP = presence in the CURRENT principal's own scoped database.
  // `items` is only a hint of ids to consider: a stale list captured under
  // another principal is filtered down to rows this principal actually owns
  // locally, and the row pushed is the one STORED in this scope, never the
  // caller-supplied object.
  const stored = new Map((await getAllComics()).map((c) => [c.id, c]));
  const pending = (items || [])
    .filter((i) => i && stored.get(i.id)?._syncStatus === "pending")
    .map((i) => stored.get(i.id));
  const results = [];
  for (const item of pending) {
    if (scopeChanged(scope)) break; // stale retry from another principal refuses
    results.push(await persistCollectionItem(item));
  }
  return results;
}
