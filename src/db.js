// Minimal IndexedDB wrapper for the Comic Vault catalogue.
// One database, one object store keyed by `id`, with a `timestamp` index
// so we can return items newest-first without sorting the whole array.

const DB_NAME = "comic-vault";
const DB_VERSION = 3;
const STORE = "comics";
const SNAPSHOTS_STORE = "valueSnapshots";
const ANALYSIS_STORE = "analysisCache";
// PRODUCTION FIXTURE BANK dispatch (2026-09-20) — diagnostic evidence
// only, never a catalogue/asset store. Keyed by traceId (the same
// pipelineAudit.traceId every /api/enrich response already carries) so
// re-banking the identical scan is a plain overwrite (`put`), never a
// duplicate — the dispatch's own idempotency requirement, satisfied by
// the store's own key, no extra bookkeeping needed.
const FIXTURE_BANK_STORE = "fixtureBank";
const LEGACY_KEY = "cv_catalogue";

let dbPromise = null;

// GK-231 hardening (2026-09-20) — B1/B2. A version-upgrade open() blocks
// (fires NEITHER onupgradeneeded NOR onsuccess NOR onerror — just sits)
// for as long as any OTHER connection to this database, opened at a
// LOWER version, stays alive — reproduced for real in
// tests/gk231-fixture-bank-indexeddb.test.js. Previously this left
// openDb()'s promise pending forever with zero signal, which is capable
// of stranding the Bank Regression Fixture button on "Banking…"
// indefinitely. B1: onblocked now rejects with a bounded, actionable
// error instead of hanging, and resets `dbPromise` so a retry gets a
// genuinely fresh attempt rather than replaying a poisoned promise. B2:
// every successfully opened connection releases itself the instant a
// NEWER tab wants to upgrade (onversionchange -> close()) — this lets a
// tab running the FIXED code get out of a future tab's way; it cannot
// force-close a tab still running OLD pre-fix code (that tab never
// attached this handler), which is exactly why B1's bounded failure path
// is still required as the fallback.
const BLOCKED_MESSAGE = 'GrailKey storage upgrade is blocked by another open GrailKey tab/session. Close other GrailKey tabs and retry.';

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(ANALYSIS_STORE)) {
        db.createObjectStore(ANALYSIS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(FIXTURE_BANK_STORE)) {
        const fixtureStore = db.createObjectStore(FIXTURE_BANK_STORE, { keyPath: "traceId" });
        fixtureStore.createIndex("capturedAt", "capturedAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error(BLOCKED_MESSAGE));
    };
  });
  return dbPromise;
};

const tx = async (mode) => {
  const db = await openDb();
  const transaction = db.transaction(STORE, mode);
  return transaction.objectStore(STORE);
};

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Return all comics newest-first.
export const getAllComics = async () => {
  try {
    const store = await tx("readonly");
    const index = store.index("timestamp");
    const items = await wrap(index.getAll());
    return (items || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch {
    return [];
  }
};

export const putComic = async (entry) => {
  const store = await tx("readwrite");
  await wrap(store.put(entry));
  return entry;
};

export const deleteComic = async (id) => {
  const store = await tx("readwrite");
  await wrap(store.delete(id));
};

// --- Value snapshots (for the trend chart) ---

const txStore = async (storeName, mode) => {
  const db = await openDb();
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
};

export const putSnapshot = async (snapshot) => {
  const store = await txStore(SNAPSHOTS_STORE, "readwrite");
  await wrap(store.put(snapshot));
};

export const getAllSnapshots = async () => {
  try {
    const store = await txStore(SNAPSHOTS_STORE, "readonly");
    const items = await wrap(store.getAll());
    return (items || []).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
};

// --- Analysis cache ---

export const getAnalysis = async () => {
  try {
    const store = await txStore(ANALYSIS_STORE, "readonly");
    return await wrap(store.get("latest"));
  } catch {
    return null;
  }
};

export const putAnalysis = async (data) => {
  const store = await txStore(ANALYSIS_STORE, "readwrite");
  await wrap(store.put({ key: "latest", ...data }));
};

// Dispatch 42 Task 1 — ComicVine kill, IndexedDB migration. Strips the
// `comicVine` object from every stored catalogue record so a disabled
// ComicVine can never resurrect via the App.jsx merge paths' own
// `enrich.comicVine || cur.comicVine || null` fallback (that pattern
// otherwise keeps serving pre-kill CV data on every future re-scan,
// forever — Dispatch 41 Part 1's largest resurrection risk). Only the
// direct CV object is touched; publisher/year/keyIssue/creators are
// mixed-provenance (CV was never their sole source) and are left alone.
// Idempotent via CV_MIGRATION_FLAG — same one-shot idiom as
// migrateFromLocalStorage below, safe to call on every load.
const CV_MIGRATION_FLAG = "cv_migration_v1_done";

export const migrateComicVineRemoval = async () => {
  try {
    if (localStorage.getItem(CV_MIGRATION_FLAG)) return 0;
    const items = await getAllComics();
    let count = 0;
    for (const item of items) {
      if (item && Object.prototype.hasOwnProperty.call(item, "comicVine") && item.comicVine) {
        const { comicVine, ...rest } = item;
        await putComic(rest);
        count++;
      }
    }
    localStorage.setItem(CV_MIGRATION_FLAG, "1");
    return count;
  } catch {
    return 0;
  }
};

// --- Fixture bank (diagnostic regression evidence, never a catalogue/asset store) ---

// GK-231 hardening — B3. Resolves ONLY on transaction.oncomplete (a real,
// durable commit), never on the individual put-request's own onsuccess
// (which fires before the surrounding transaction is guaranteed
// committed — the exact "UI claims Banked before the transaction
// completes" gap this dispatch called out). Rejects on the request's own
// error, the transaction's error, or an abort — whichever actually
// happens is the one propagated, never silently coerced into "success."
export const putFixture = (fixture) => {
  if (!fixture?.traceId) return Promise.reject(new Error("putFixture: fixture.traceId is required (idempotency key)"));
  return openDb().then((db) => new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const transaction = db.transaction(FIXTURE_BANK_STORE, "readwrite");
    const store = transaction.objectStore(FIXTURE_BANK_STORE);
    const putReq = store.put(fixture);
    putReq.onerror = () => fail(putReq.error);
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error || new Error("putFixture: transaction aborted"));
    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(fixture); } };
  }));
};

// GK-231 hardening — B4. A genuinely empty store and a genuine
// open/read/transaction failure must never be indistinguishable. This no
// longer swallows any error into a bare `[]` — every failure propagates
// as a real rejection; callers (App.jsx's exportFixtureCorpus) are
// responsible for telling "No fixtures banked yet" (resolved, length 0)
// apart from "Fixture storage error: <reason>" (rejected).
export const getAllFixtures = () =>
  openDb().then((db) => new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const transaction = db.transaction(FIXTURE_BANK_STORE, "readonly");
    const store = transaction.objectStore(FIXTURE_BANK_STORE);
    const req = store.getAll();
    req.onerror = () => fail(req.error);
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error || new Error("getAllFixtures: transaction aborted"));
    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      const items = req.result || [];
      resolve(items.sort((a, b) => (a.capturedAt || "").localeCompare(b.capturedAt || "")));
    };
  }));

export const deleteFixture = async (traceId) => {
  const store = await txStore(FIXTURE_BANK_STORE, "readwrite");
  await wrap(store.delete(traceId));
};

export const clearFixtureBank = async () => {
  const store = await txStore(FIXTURE_BANK_STORE, "readwrite");
  await wrap(store.clear());
};

// GK-231 — A3 self-reporting diagnostics. Deliberately reads facts ABOUT
// the connection/store (never mutates the fixture schema itself — the
// dispatch's own explicit constraint). window.location.origin and
// buildSha are added by the caller (App.jsx, where `window` and the most
// recent scan result actually live) — kept out of this module so db.js
// stays runnable in a plain Node/IndexedDB-polyfill test environment
// with no DOM.
export const getFixtureBankDiagnostics = () =>
  openDb().then(async (db) => ({
    dbName: DB_NAME,
    dbVersionOpened: db.version,
    objectStoreNames: Array.from(db.objectStoreNames),
    fixtureRecordCount: (await getAllFixtures()).length,
  }));

// One-shot migration: if a legacy `cv_catalogue` array exists in localStorage,
// copy its entries into IndexedDB then drop the key. Safe to call on every load.
export const migrateFromLocalStorage = async () => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return 0;
    }
    // Each putComic opens its own transaction — safe to await in a loop.
    let count = 0;
    for (const item of parsed) {
      if (item && item.id) {
        await putComic(item);
        count++;
      }
    }
    localStorage.removeItem(LEGACY_KEY);
    return count;
  } catch {
    return 0;
  }
};
