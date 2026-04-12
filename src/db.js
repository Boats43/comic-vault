// Minimal IndexedDB wrapper for the Comic Vault catalogue.
// One database, one object store keyed by `id`, with a `timestamp` index
// so we can return items newest-first without sorting the whole array.

const DB_NAME = "comic-vault";
const DB_VERSION = 2;
const STORE = "comics";
const SNAPSHOTS_STORE = "valueSnapshots";
const ANALYSIS_STORE = "analysisCache";
const LEGACY_KEY = "cv_catalogue";

let dbPromise = null;

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
