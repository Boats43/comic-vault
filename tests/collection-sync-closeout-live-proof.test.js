// tests/collection-sync-closeout-live-proof.test.js
//
// GrailKey Collection Sync Closeout (2026-09-18) — proves the REAL
// client persistence helper (src/lib/collectionPersistence.js), the
// REAL client sync wrapper (src/lib/collectionSync.js), the REAL
// session helper (src/lib/grailkeySession.js), and the REAL server
// handler (api/collection.js) working together, end to end, against
// the real Development database. No test doubles of application logic
// — the only things stubbed are the two browser globals this code
// depends on (IndexedDB, localStorage) via minimal, honest in-memory
// implementations, and the network TRANSPORT (global.fetch is wired
// in-process directly to the real api/collection.js handler function,
// the same "call the real handler, skip the real socket" convention
// this repo's own handler-smoke tests already use — never a fake
// response, never mocked business logic). A separate flag lets one
// test simulate the network being genuinely unreachable (fetch throws)
// without touching the real handler at all for those calls.
//
// Covers, all against real data1_dev:
//   - phone creates -> a separate "desktop" read sees it (two
//     independent calls, real DB round-trip both times)
//   - phone edits -> desktop reload sees the edited state
//   - server unreachable -> local record survives, correctly marked
//     _syncStatus:'pending' (never silently swallowed, never marked
//     synced) -> retry later succeeds -> a second "device" read sees
//     the final state
//   - retry is idempotent (retrying with nothing pending is a no-op;
//     retrying a real pending item never creates a duplicate row)
//   - existing-local-cache convergence: a legacy local-only record
//     (no `_syncStatus` field at all) is never touched, never pushed,
//     and remains visible after the hydrate+retry cycle — proving
//     additive hydration's exact behavior directly, not by inference
//
// Invoke: node tests/collection-sync-closeout-live-proof.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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

let SIMULATE_OFFLINE = false;
const realFetch = global.fetch;

const { default: collectionRoute } = await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href);

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// The only transport shim in this file: routes a call to /api/collection
// directly into the REAL handler function (in-process, no socket) —
// same technique as every other handler-smoke test in this repo.
// Everything else about the request/response is real.
global.fetch = async (url, options = {}) => {
  if (SIMULATE_OFFLINE) {
    throw new TypeError('simulated network failure — server unreachable');
  }
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
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      json: async () => res.body,
    };
  }
  return realFetch(url, options);
};

const { setSession } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'grailkeySession.js')).href);
const { fetchServerCollection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'collectionSync.js')).href);
const { persistCollectionItem, retryPendingCollectionItems } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'collectionPersistence.js')).href);
const { getAllComics, putComic } = await import(pathToFileURL(path.join(repoRoot, 'src', 'db.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Collection Sync Closeout — client+server live proof (real Development DB) ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `sync-closeout-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
setSession(mintTestToken(JIMMY), Date.now() + 12 * 60 * 60 * 1000);

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();
await dbClient.query('SET search_path TO data1_dev');

const ITEM_ID = `${TAG}-item1`;
const LEGACY_ID = `${TAG}-legacy-untouched`;

try {
  console.log('-- phone creates item (persistCollectionItem, real local write + real server round-trip) --\n');
  const v1 = { id: ITEM_ID, title: 'Brave and the Bold', issue: '141', year: '1978', grade: 'VG 4.0', images: ['fake-photo-data'] };
  const savedV1 = await persistCollectionItem(v1);
  assertTrue(savedV1._syncStatus === 'synced', `create -> _syncStatus: 'synced' (got ${savedV1._syncStatus})`);
  {
    const row = await dbClient.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, ITEM_ID]);
    assertTrue(row.rowCount === 1 && row.rows[0].attributes.grade === 'VG 4.0', 'real data1_dev row exists with the created attributes');
    assertTrue(row.rows[0].attributes.images === undefined, 'images never reached the server attributes JSONB');
  }

  console.log('\n-- "desktop login" simulation: a SEPARATE fetchServerCollection() call sees the item --\n');
  {
    const serverItems = await fetchServerCollection();
    const found = (serverItems || []).find((i) => i.id === ITEM_ID);
    assertTrue(!!found && found.attributes.grade === 'VG 4.0', 'independent read sees the item, correct state');
  }

  console.log('\n-- phone changes grade/title -> server receives updated state --\n');
  const v2 = { ...v1, grade: 'FN 6.0', title: 'Brave and the Bold (corrected)' };
  const savedV2 = await persistCollectionItem(v2);
  assertTrue(savedV2._syncStatus === 'synced', `update -> _syncStatus: 'synced' (got ${savedV2._syncStatus})`);

  console.log('\n-- desktop reload sees the updated state (not the original) --\n');
  {
    const serverItems = await fetchServerCollection();
    const found = (serverItems || []).find((i) => i.id === ITEM_ID);
    assertTrue(found?.attributes.grade === 'FN 6.0' && found?.attributes.title === 'Brave and the Bold (corrected)', `desktop sees V2, not V1 (got grade=${found?.attributes.grade})`);
  }

  console.log('\n-- server temporarily unavailable: local record survives, marked pending, never falsely synced --\n');
  const v3 = { ...v2, grade: 'NM 9.0', title: 'Brave and the Bold (final)' };
  SIMULATE_OFFLINE = true;
  const savedV3 = await persistCollectionItem(v3);
  SIMULATE_OFFLINE = false;
  assertTrue(savedV3._syncStatus === 'pending', `server unreachable -> _syncStatus: 'pending', not falsely 'synced' (got ${savedV3._syncStatus})`);
  {
    const local = (await getAllComics()).find((i) => i.id === ITEM_ID);
    assertTrue(local?.grade === 'NM 9.0' && local?._syncStatus === 'pending', 'local IndexedDB record survives with V3 content, correctly marked pending');
    const serverRow = await dbClient.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, ITEM_ID]);
    assertTrue(serverRow.rows[0].attributes.grade === 'FN 6.0', 'real server row is UNCHANGED (still V2) while the outage was simulated — never a lost or corrupted write');
  }

  console.log('\n-- retry succeeds later: idempotent, resolves the pending item --\n');
  {
    const localItems = await getAllComics();
    const retried = await retryPendingCollectionItems(localItems);
    assertTrue(retried.length === 1 && retried[0]._syncStatus === 'synced', `retry resolves the one pending item to 'synced' (got ${JSON.stringify(retried.map(r => r._syncStatus))})`);
  }

  console.log('\n-- retry is idempotent: running it again with nothing pending is a safe no-op --\n');
  {
    const localItems = await getAllComics();
    const retried = await retryPendingCollectionItems(localItems);
    assertTrue(retried.length === 0, `no pending items left -> retry touches nothing (got ${retried.length})`);
  }

  console.log('\n-- second device receives the final (V3) state after retry --\n');
  {
    const serverItems = await fetchServerCollection();
    const found = (serverItems || []).find((i) => i.id === ITEM_ID);
    assertTrue(found?.attributes.grade === 'NM 9.0' && found?.attributes.title === 'Brave and the Bold (final)', `second device sees V3, the final state (got grade=${found?.attributes.grade})`);
    const serverRow = await dbClient.query('SELECT COUNT(*)::int AS n FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, ITEM_ID]);
    assertTrue(serverRow.rows[0].n === 1, 'still exactly one row for this id -- the outage+retry sequence never created a duplicate');
  }

  console.log('\n-- existing-local-cache convergence: a legacy local-only record (no _syncStatus) is never touched --\n');
  {
    await putComic({ id: LEGACY_ID, title: 'Some Pre-Cutover Legacy Comic', issue: '1', year: '1990' });
    // Simulate the App.jsx login-hydrate + retry cycle directly.
    const serverItems = await fetchServerCollection();
    if (serverItems) {
      for (const item of serverItems) await putComic({ id: item.id, ...item.attributes, _syncStatus: 'synced' });
    }
    const localBefore = await getAllComics();
    await retryPendingCollectionItems(localBefore);
    const localAfter = await getAllComics();
    const legacy = localAfter.find((i) => i.id === LEGACY_ID);
    assertTrue(!!legacy, 'legacy local-only record is STILL VISIBLE after the hydrate+retry cycle -- additive hydration never removes it');
    assertTrue(legacy._syncStatus === undefined, 'legacy record was never tagged _syncStatus -- confirms it was never attempted for sync, matching the "no legacy migration" ruling');
    const serverRow = await dbClient.query('SELECT 1 FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, LEGACY_ID]);
    assertTrue(serverRow.rowCount === 0, 'legacy record was never pushed to the server at all');
  }
} finally {
  await dbClient.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = $2', [JIMMY, ITEM_ID]);
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
