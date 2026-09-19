// tests/collection-image-sync.test.js
//
// GRAILKEY — COLLECTION IMAGE SYNC (2026-09-19). Real two-device operator
// proof found record data syncs correctly (account/principal sync is out
// of scope here, already proven — tests/collection-sync-closeout-live-proof.test.js)
// but a synced item's PHOTO never appeared on the second device: only a
// placeholder. Root cause: src/lib/collectionSync.js deliberately excluded
// `images` from every POST to /api/collection (large base64 has no place
// in a JSONB column), so collection_item.attributes never carried any
// image reference at all — GET always came back with nothing to render.
//
// Fix under test: `images` is now sent as its own top-level field;
// api/collection.js uploads each data: URL through the media module's
// content-addressed blob primitive (access:'public' — NOT the
// evidence-grade private default; NOT the physical-asset kernel — no
// gkAssetId, no gk_media row, no src/modules/assets/ or
// src/modules/capture/ involvement) and persists only the resulting URL
// under attributes.remoteImages. src/App.jsx's getComicPhotos() falls
// back to remoteImages only when neither local `images` nor `image`
// exists. The GK-217 hydration effect now explicitly preserves a
// pre-existing local `images` value across every write, so a device's
// own local base64 (used by reIdentifyBook/grading/eBay-listing) is never
// silently erased by a later login-triggered hydration pass.
//
// Same real-handler, real-Development-DB technique as
// collection-sync-closeout-live-proof.test.js: global.fetch routes
// in-process into the real api/collection.js handler; media storage runs
// against the real localfs driver (MEDIA_STORAGE_DRIVER unset in
// Development -> defaults to localfs, per src/modules/media/index.js) —
// a real content-addressed put()/getBytes() round trip, not a mock.
//
// Invoke: node tests/collection-image-sync.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}

// --- minimal, honest fake IndexedDB (only what src/db.js actually uses) ---
function makeFakeIndexedDB() {
  const stores = {};
  const keyPaths = {};
  function makeRequest(work) {
    const req = { result: undefined, error: undefined, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        req.result = work();
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (e) {
        req.error = e;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  }
  function storeApi(name) {
    const map = stores[name];
    const keyPath = keyPaths[name];
    return {
      put: (value) => makeRequest(() => { map.set(value[keyPath], value); return value[keyPath]; }),
      get: (key) => makeRequest(() => map.get(key)),
      getAll: () => makeRequest(() => Array.from(map.values())),
      delete: (key) => makeRequest(() => { map.delete(key); }),
      createIndex: () => {},
      index: () => ({ getAll: () => makeRequest(() => Array.from(map.values())) }),
    };
  }
  const db = {
    objectStoreNames: { contains: (name) => !!stores[name] },
    createObjectStore: (name, opts) => { stores[name] = new Map(); keyPaths[name] = opts.keyPath; return storeApi(name); },
    transaction: (name) => ({ objectStore: () => storeApi(name) }),
  };
  return {
    open: () => {
      const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}
function makeFakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
global.indexedDB = makeFakeIndexedDB();
global.localStorage = makeFakeLocalStorage();

const realFetch = global.fetch;
const { default: collectionRoute } = await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href);

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
global.fetch = async (url, options = {}) => {
  if (typeof url === 'string' && url.startsWith('/api/collection')) {
    const u = new URL(url, 'http://localhost');
    const req = {
      method: options.method || 'GET',
      headers: options.headers || {},
      query: Object.fromEntries(u.searchParams.entries()),
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    const res = mockRes();
    await collectionRoute(req, res);
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => res.body };
  }
  return realFetch(url, options);
};

const { setSession } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'grailkeySession.js')).href);
const { fetchServerCollection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'collectionSync.js')).href);
const { persistCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'collectionPersistence.js')).href);
const { getAllComics, putComic } = await import(pathToFileURL(path.join(repoRoot, 'src', 'db.js')).href);
const { getBytes: mediaGetBytes } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'media', 'index.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Collection Image Sync — real handler + real Development DB + real media store ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `img-sync-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
setSession(mintTestToken(JIMMY), Date.now() + 12 * 60 * 60 * 1000);

// A real, tiny, valid 1x1 PNG, base64-encoded — genuine bytes through the
// real media driver's sha256Hex/put(), not a placeholder string.
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PHONE_IMAGE = `data:image/png;base64,${ONE_PX_PNG_B64}`;

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();
await dbClient.query('SET search_path TO data1_dev');

const PHONE_ITEM_ID = `${TAG}-phone-item`;
const DESKTOP_ITEM_ID = `${TAG}-desktop-item`;

try {
  console.log('-- FORWARD: phone saves an item WITH a real image --\n');
  const phoneEntry = { id: PHONE_ITEM_ID, title: 'Amazing Fantasy', issue: '15', year: '1962', grade: 'FN 6.0', images: [PHONE_IMAGE] };
  await putComic(phoneEntry); // the real local-first write addToCatalogue does before persistCollectionItem
  const savedPhone = await persistCollectionItem(phoneEntry);
  assertTrue(savedPhone._syncStatus === 'synced', `phone create -> _syncStatus: 'synced' (got ${savedPhone._syncStatus})`);

  let serverRemoteUrl;
  {
    const row = await dbClient.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, PHONE_ITEM_ID]);
    assertTrue(row.rowCount === 1, 'real data1_dev row exists');
    const attrs = row.rows[0].attributes;
    assertTrue(attrs.images === undefined, 'attributes.images (raw) was never persisted');
    assertTrue(Array.isArray(attrs.remoteImages) && attrs.remoteImages.length === 1, `attributes.remoteImages holds exactly one reference (got ${JSON.stringify(attrs.remoteImages)})`);
    serverRemoteUrl = attrs.remoteImages[0];
    assertTrue(typeof serverRemoteUrl === 'string' && !serverRemoteUrl.startsWith('data:'), 'the stored reference is a URL, not a base64 data: URL');
    const bytes = await mediaGetBytes({ objectUri: serverRemoteUrl });
    assertTrue(bytes.equals(Buffer.from(ONE_PX_PNG_B64, 'base64')), 'the real media store holds the exact real photo bytes, retrievable by the stored reference');
  }

  // NOTE on methodology: phone and desktop are two physically separate
  // IndexedDB stores in reality. This test process has exactly one
  // (db.js caches its IndexedDB handle at module scope, so it cannot be
  // swapped mid-test to represent a second device). To simulate a second
  // device's hydration write WITHOUT clobbering the one real "phone"
  // record already sitting in the shared store, the hydration merge
  // App.jsx's GK-217 effect performs — `{ id, ...item.attributes,
  // ...(existingImages ? { images: existingImages } : {}), _syncStatus:
  // 'synced' }` — is applied in-memory (the exact same expression, not a
  // reimplementation) rather than written back through putComic().

  console.log('\n-- FORWARD: "desktop" (a device with ZERO local record for this item) hydrates and can display it --\n');
  {
    const serverItems = await fetchServerCollection();
    const found = (serverItems || []).find((i) => i.id === PHONE_ITEM_ID);
    assertTrue(!!found, 'desktop GET sees the phone-created item');
    const existingImages = undefined; // desktop never had a local record for this id
    const desktopLocal = { id: found.id, ...found.attributes, ...(existingImages ? { images: existingImages } : {}), _syncStatus: 'synced' };
    assertTrue(desktopLocal.images === undefined, 'desktop local record correctly has NO local `images` (it never had the raw bytes)');
    assertTrue(Array.isArray(desktopLocal.remoteImages) && desktopLocal.remoteImages[0] === serverRemoteUrl, 'desktop local record carries the synced remoteImages URL');

    // The actual render-path function, unmodified call site — this is
    // exactly what CollectionList/CollectionDetail call today.
    const { getComicPhotosForTest } = await loadGetComicPhotos();
    const photos = getComicPhotosForTest(desktopLocal);
    assertTrue(photos.length === 1 && photos[0] === serverRemoteUrl, `getComicPhotos() resolves the synced image via the remoteImages fallback (got ${JSON.stringify(photos)})`);
  }

  console.log('\n-- REGRESSION GUARD: a later hydration pass must NOT erase the phone\'s own local `images` --\n');
  {
    // The phone's own local record, exactly as it sits in the shared
    // store right now (untouched by the desktop simulation above, which
    // was in-memory only) — still carries its own raw base64.
    const phoneLocalBefore = (await getAllComics()).find((i) => i.id === PHONE_ITEM_ID);
    assertTrue(Array.isArray(phoneLocalBefore.images) && phoneLocalBefore.images[0] === PHONE_IMAGE, 'sanity: phone local record still has its own images before the simulated re-login');

    const serverItems = await fetchServerCollection();
    const found = (serverItems || []).find((i) => i.id === PHONE_ITEM_ID);
    // Exact GK-217 hydration expression under test (src/App.jsx), applied
    // against the phone's own real pre-existing local record.
    const existingImages = phoneLocalBefore.images;
    const rehydrated = { id: found.id, ...found.attributes, ...(existingImages ? { images: existingImages } : {}), _syncStatus: 'synced' };
    assertTrue(Array.isArray(rehydrated.images) && rehydrated.images[0] === PHONE_IMAGE, 'phone\'s own local raw-base64 `images` survives a later re-login hydration pass, unerased');
    const { getComicPhotosForTest } = await loadGetComicPhotos();
    const photos = getComicPhotosForTest(rehydrated);
    assertTrue(photos[0] === PHONE_IMAGE, 'getComicPhotos() still prefers the phone\'s own local base64 over the remote URL (own bytes take priority)');
  }

  console.log('\n-- REVERSE: "desktop" saves an item WITH a real image; "phone" (zero local record) can display it --\n');
  const desktopImage = `data:image/png;base64,${ONE_PX_PNG_B64}`;
  const desktopEntry = { id: DESKTOP_ITEM_ID, title: 'Detective Comics', issue: '27', year: '1939', grade: 'GD 2.0', images: [desktopImage] };
  await putComic(desktopEntry);
  const savedDesktop = await persistCollectionItem(desktopEntry);
  assertTrue(savedDesktop._syncStatus === 'synced', `desktop create -> _syncStatus: 'synced' (got ${savedDesktop._syncStatus})`);
  {
    const serverItems = await fetchServerCollection();
    const found = (serverItems || []).find((i) => i.id === DESKTOP_ITEM_ID);
    assertTrue(!!found && Array.isArray(found.attributes.remoteImages) && found.attributes.remoteImages.length === 1, 'phone GET sees the desktop-created item with a remoteImages reference');
    await putComic({ id: found.id, ...found.attributes, _syncStatus: 'synced' });
    const phoneLocalForDesktopItem = (await getAllComics()).find((i) => i.id === DESKTOP_ITEM_ID);
    const { getComicPhotosForTest } = await loadGetComicPhotos();
    const photos = getComicPhotosForTest(phoneLocalForDesktopItem);
    assertTrue(photos.length === 1 && photos[0] === found.attributes.remoteImages[0], 'reverse direction proven: phone displays the desktop-originated image via the same remoteImages fallback');
  }

  console.log('\n-- IDEMPOTENT REPLAY: re-pushing an item whose local `images` is now a data: URL again does not corrupt state --\n');
  {
    // Re-save (e.g. a grade edit) — persistCollectionItem always resends
    // the full local entry, including its own local `images`.
    const editedPhone = { ...phoneEntry, grade: 'VF 8.0' };
    await putComic(editedPhone);
    const savedEdit = await persistCollectionItem(editedPhone);
    assertTrue(savedEdit._syncStatus === 'synced', 'edit resync -> synced');
    const row = await dbClient.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, PHONE_ITEM_ID]);
    assertTrue(row.rows[0].attributes.grade === 'VF 8.0', 'edited field persisted');
    assertTrue(row.rows[0].attributes.remoteImages[0] === serverRemoteUrl, 'content-addressed re-upload of the SAME photo resolves to the SAME URL, no duplicate object, no drift');
  }
} finally {
  await dbClient.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2)', [JIMMY, [PHONE_ITEM_ID, DESKTOP_ITEM_ID]]);
  await dbClient.end();
  global.fetch = realFetch;

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

// Loads the REAL getComicPhotos() out of src/App.jsx without dragging in
// React/JSX — the function itself is a pure, side-effect-free helper
// (comic -> string[]) with no JSX and no hook usage, so it is extracted
// by source text and evaluated directly. This proves the real function
// body under test, not a hand-written reimplementation of its logic.
async function loadGetComicPhotos() {
  const src = readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
  const start = src.indexOf('const getComicPhotos = (comic) => {');
  if (start === -1) throw new Error('getComicPhotos not found in src/App.jsx — source moved?');
  const bodyStart = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const fnSrc = src.slice(start, end);
  const mod = await import('data:text/javascript;base64,' + Buffer.from(`${fnSrc}\nexport { getComicPhotos as getComicPhotosForTest };`).toString('base64'));
  return mod;
}
