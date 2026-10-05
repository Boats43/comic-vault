// src/lib/legacyLocalClaim.js — evidence-gated handling of PRE-FIX,
// UNSCOPED local data (LIVE EXPOSURE CLOSURE, 2026-10-04).
//
// Before this dispatch every account on a browser shared one IndexedDB
// database named `comic-vault` and unscoped localStorage keys. Those rows
// have NO recorded owner. REQUIRED INVARIANT: AMBIGUOUS LOCAL OWNERSHIP IS
// NEVER SILENTLY ASSIGNED.
//
// Rules (UNIVERSAL U1, 2026-10-05 — AMBIGUOUS LEGACY LOCAL DATA IS UNCLAIMED,
// NOT OPERATOR-CLAIMABLE):
//   * The legacy database is opened READ-ONLY (no version bump, never
//     created, never written, never deleted).
//   * The ONLY path across the boundary is the proof-gated auto-claim: a
//     legacy catalogue row is copied into the authenticated principal's
//     scoped database iff that principal's OWN server collection holds a row
//     with the same id AND the same identity (title/issue/year/publisher) AND
//     no gkAssetId disagreement. Local ids are `cv_<ts>_<rand>`, not UUIDs, so
//     an id match ALONE is deliberately not trusted.
//   * A claimed row is written `_syncStatus:'synced'` — the principal's own
//     server row is the truth (hydrate overwrites its attributes) — so a
//     claimed legacy row is NEVER pending and can never be retried/pushed.
//   * Everything else stays in the legacy database untouched: not copied,
//     not exposed, not retried, not deleted.
//   * There is deliberately NO manual "claim" function. The earlier explicit
//     claim copied rows with their original `_syncStatus:'pending'`, so a
//     click was sufficient to push another person's local data to the server
//     under the claimer's token. A human click is not proof of ownership.
//   * Copies never overwrite an existing scoped row (idempotent).

import { LEGACY_DB_NAME, getAllComics, putComic } from "../db.js";
import { getPrincipalScope } from "./grailkeySession.js";

const norm = (v) => String(v ?? "").trim().toLowerCase();

// PURE: split legacy catalogue rows into provable-for-this-principal vs
// ambiguous, given this principal's own server collection rows.
export function classifyLegacyComics(legacyComics, serverItems) {
  const byId = new Map((serverItems || []).filter((s) => s && s.id).map((s) => [s.id, s]));
  const provable = [];
  const ambiguous = [];
  for (const local of legacyComics || []) {
    if (!local || !local.id) continue;
    const server = byId.get(local.id);
    if (server && identityMatches(local, server)) provable.push(local);
    else ambiguous.push(local);
  }
  return { provable, ambiguous };
}

function identityMatches(local, server) {
  const a = server.attributes || {};
  for (const f of ["title", "issue", "year", "publisher"]) {
    if (norm(local[f]) !== norm(a[f])) return false;
  }
  const lg = local.gkAssetId;
  const sg = a.gkAssetId;
  if (lg && sg && lg !== sg) return false;
  return true;
}

async function legacyDbExists() {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return false;
    const dbs = await indexedDB.databases();
    return (dbs || []).some((d) => d && d.name === LEGACY_DB_NAME);
  } catch {
    return false;
  }
}

// Read-only open: never creates the database, never upgrades it.
function openLegacyReadOnly() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onupgradeneeded = () => {
      try { req.transaction.abort(); } catch { /* no-op */ }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("legacy database open blocked"));
  });
}

function readAll(db, storeName) {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

// READ-ONLY snapshot of everything in the legacy database.
export async function readLegacyRows() {
  const empty = { comics: [], fixtures: [], drafts: [], snapshots: [] };
  if (!(await legacyDbExists())) return empty;
  let db;
  try {
    db = await openLegacyReadOnly();
  } catch {
    return empty;
  }
  try {
    return {
      comics: await readAll(db, "comics"),
      fixtures: await readAll(db, "fixtureBank"),
      drafts: await readAll(db, "genericCaptureDrafts"),
      snapshots: await readAll(db, "valueSnapshots"),
    };
  } finally {
    try { db.close(); } catch { /* no-op */ }
  }
}

// Copy the provable legacy catalogue rows into this principal's scoped DB.
// Returns { claimed, ambiguous } where `ambiguous` is the number of legacy
// rows that remain quarantined (not already present in the scoped DB).
export async function autoClaimProvableLegacy(serverItems) {
  if (!getPrincipalScope() || !Array.isArray(serverItems)) return { claimed: 0, ambiguous: 0 };
  const legacy = await readLegacyRows();
  if (legacy.comics.length === 0) return { claimed: 0, ambiguous: 0 };
  const { provable, ambiguous } = classifyLegacyComics(legacy.comics, serverItems);
  const existing = new Set((await getAllComics()).map((c) => c.id));
  let claimed = 0;
  for (const row of provable) {
    if (existing.has(row.id)) continue;
    await putComic({ ...row, _syncStatus: "synced" }); // corroborated by the principal's own server row; never pending
    existing.add(row.id);
    claimed++;
  }
  return { claimed, ambiguous: ambiguous.filter((r) => !existing.has(r.id)).length };
}

// How many legacy catalogue rows are still unclaimed (absent from this
// principal's scoped DB). Pure read.
export async function countUnclaimedLegacy() {
  if (!getPrincipalScope()) return 0;
  const legacy = await readLegacyRows();
  if (legacy.comics.length === 0) return 0;
  const existing = new Set((await getAllComics()).map((c) => c.id));
  return legacy.comics.filter((r) => r && r.id && !existing.has(r.id)).length;
}
