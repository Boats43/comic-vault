// src/lib/legacyLocalClaim.js — evidence-gated handling of PRE-FIX,
// UNSCOPED local data (LIVE EXPOSURE CLOSURE, 2026-10-04).
//
// Before this dispatch every account on a browser shared one IndexedDB
// database named `comic-vault` and unscoped localStorage keys. Those rows
// have NO recorded owner. REQUIRED INVARIANT: AMBIGUOUS LOCAL OWNERSHIP IS
// NEVER SILENTLY ASSIGNED.
//
// Rules:
//   * The legacy database is opened READ-ONLY (no version bump, never
//     created, never written, never deleted). Legacy data is never removed
//     by anything in this file. ROLLBACK = ignore/delete the scoped
//     database; the legacy database is untouched, so nothing is lost.
//   * AUTO-CLAIM only with proof: a legacy catalogue row is copied into the
//     authenticated principal's scoped database iff that principal's OWN
//     server collection holds a row with the same id AND the same identity
//     (title/issue/year/publisher) AND no gkAssetId disagreement (server
//     rows are principal-scoped by (principal_id, id) primary key, so a
//     matching row owned by this principal is server-side proof the local
//     copy is theirs). Local ids are `cv_<ts>_<rand>`, not UUIDs, so an id
//     match ALONE is deliberately not trusted.
//   * Everything else stays quarantined in the legacy database, counted
//     and reported, invisible to every principal, until a human explicitly
//     confirms `claimAllLegacy()` for the CURRENT signed-in principal. That
//     explicit action is the only other path across the boundary.
//   * Copies never overwrite an existing scoped row (idempotent).

import { LEGACY_DB_NAME, getAllComics, putComic, putFixture, putGenericCaptureDraft, putSnapshot } from "../db.js";
import { getPrincipalScope } from "./grailkeySession.js";
import { scopedGet, scopedSet } from "./principalStorage.js";

// Unscoped localStorage keys that held user-owned data pre-fix.
export const LEGACY_LOCALSTORAGE_KEYS = [
  "cv_buyer_sessions",
  "cv_trade_piles",
  "cv_listing_packets",
  "cv_buyer_settings",
  "cv_buyer_budget",
];

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
    await putComic(row);
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

// EXPLICIT, human-confirmed claim for the CURRENT signed-in principal. The
// only path (besides the proof-gated auto-claim above) by which unscoped
// legacy data enters a principal's scope. Copy-only; never deletes the
// legacy database or its localStorage keys.
export async function claimAllLegacy() {
  if (!getPrincipalScope()) throw new Error("claimAllLegacy requires an authenticated principal");
  const legacy = await readLegacyRows();
  const existing = new Set((await getAllComics()).map((c) => c.id));
  const out = { comics: 0, fixtures: 0, drafts: 0, snapshots: 0, localStorageKeys: 0 };
  for (const row of legacy.comics) {
    if (row?.id && !existing.has(row.id)) { await putComic(row); out.comics++; }
  }
  for (const row of legacy.fixtures) {
    if (row?.traceId) { await putFixture(row); out.fixtures++; }
  }
  for (const row of legacy.drafts) {
    if (row?.id) { await putGenericCaptureDraft(row); out.drafts++; }
  }
  for (const row of legacy.snapshots) {
    if (row?.date) { await putSnapshot(row); out.snapshots++; }
  }
  for (const key of LEGACY_LOCALSTORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null && scopedGet(key) == null && scopedSet(key, raw)) out.localStorageKeys++;
    } catch { /* no-op */ }
  }
  return out;
}
