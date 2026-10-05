// tests/second-principal-capture-certification.test.js
//
// LIVE EXPOSURE CLOSURE (2026-10-04) — deterministic DEVELOPMENT
// certification that a SECOND, ordinary ('user'-kind) principal can:
//   authenticate -> mint a physical asset -> own it server-side -> keep local
//   state isolated -> logout/relogin -> see the same principal-owned asset ->
//   never see another principal's local or server state.
//
// REAL client libraries (src/lib/collectionPersistence.js, the principal-scoped
// src/db.js on fake-indexeddb, grailkeySession), REAL handlers
// (api/capture-scan.js, api/collection.js, api/assets.js) and REAL Development
// Postgres. The only stub is `fetch`, which routes the client's relative
// /api/* calls straight into those handlers. NOT a Production proof and creates
// NO fake Production person — it only exercises Development.
//
// Cleanup follows this repo's Development convention (gk265/gk266): tagged
// collection_item/link rows are deleted; append-only gk_asset/gk_principal
// rows stay as permanent Development fixtures.
//
// Invoke: node tests/second-principal-capture-certification.test.js

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

// ── browser shims ──
const lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => { lsMap.set(k, String(v)); },
  removeItem: (k) => { lsMap.delete(k); },
};
globalThis.window = new EventTarget();

const mintToken = (principalId) => {
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 3600_000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b64).digest('base64url')}`;
};

// ── fetch -> real handlers ──
const captureScan = (await import(pathToFileURL(path.join(repoRoot, 'api', 'capture-scan.js')).href)).default;
const collectionApi = (await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href)).default;
const assetsApi = (await import(pathToFileURL(path.join(repoRoot, 'api', 'assets.js')).href)).default;
const ROUTES = { '/api/capture-scan': captureScan, '/api/collection': collectionApi, '/api/assets': assetsApi };
let routed = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url), 'http://local.test');
  const handler = ROUTES[u.pathname];
  if (!handler) throw new Error(`unrouted fetch in test: ${u.pathname}`);
  const headers = {};
  for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
  headers['x-forwarded-for'] = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const req = {
    method: opts.method || 'GET', headers,
    query: Object.fromEntries(u.searchParams.entries()),
    body: opts.body ? JSON.parse(opts.body) : undefined,
  };
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  await handler(req, res);
  routed.push({ path: u.pathname, status: res.statusCode });
  return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => res.body };
};

const session = await import(new URL('../src/lib/grailkeySession.js', import.meta.url).href);
const db = await import(new URL('../src/db.js', import.meta.url).href);
const generic = await import(new URL('../src/lib/genericAssetCapture.js', import.meta.url).href);
const persistence = await import(new URL('../src/lib/collectionPersistence.js', import.meta.url).href);

const login = (principalId) => session.setSession(mintToken(principalId), Date.now() + 12 * 3600_000);
const logout = () => session.clearSession();

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

const TAG = `second-principal-${Date.now()}`;
const createPrincipal = async (label) => {
  const id = randomUUID();
  await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [id, `${TAG}-${label}`]);
  return id;
};
const P_FIRST = await createPrincipal('first');
const P_SECOND = await createPrincipal('second');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

console.log('=== second-principal capture certification (real client libs + real handlers + real Development DB) ===\n');
const createdItemIds = [];

// The OWNED-capture path the app actually uses (GrailKeyOperatorPanel): the
// catalogue item is saved + synced FIRST (persistCollectionItem), then the
// operator taps Capture, which POSTs /api/capture-scan with the exact payload
// shape the button builds. (src/lib/genericAssetCapture.js does it in the
// opposite order and is currently rejected by GK-266 — see FINDING PROBE.)
const stripPrefix = (d) => d.slice(d.indexOf(',') + 1);
async function captureOwned(title, issue, year) {
  const id = `${TAG}-${randomUUID().slice(0, 8)}`;
  createdItemIds.push(id);
  const entry = { id, timestamp: Date.now(), title, issue, year, images: [PNG] };
  await db.putComic(entry);
  const synced = await persistence.persistCollectionItem(entry);
  const key = randomUUID();
  const res = await session.authFetch('/api/capture-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scanPayload: { correlationId: key, collectionItemId: id, book: { title, issue, year }, outcome: { decisionAction: null, pricingSource: null, price: null, gradeMultiplier: null } },
      photos: [{ bytes: stripPrefix(PNG), contentType: 'image/png', captureRole: 'capture-photo' }],
      idempotencyKey: key,
    }),
  });
  const body = await res.json();
  if (res.ok && body.gkAssetId) await db.putComic({ ...entry, gkAssetId: body.gkAssetId, _syncStatus: synced._syncStatus });
  return { id, synced, status: res.status, body, gkAssetId: body.gkAssetId };
}
const bearer = (p) => ({ Authorization: `Bearer ${mintToken(p)}` });
const isEmpty = (v) => Array.isArray(v) && v.length === 0;

try {
  console.log('1. FIRST user authenticates and captures an owned physical asset');
  login(P_FIRST);
  const cap1 = await captureOwned(`${TAG} Hulk`, '180', '1974');
  ok(cap1.synced._syncStatus === 'synced', "first user's item synced to the server Collection");
  ok(cap1.status === 200 && !!cap1.gkAssetId, `first user minted a physical asset through the real client + handler path (HTTP ${cap1.status}${cap1.status === 200 ? '' : ' ' + JSON.stringify(cap1.body).slice(0, 160)})`);
  const GK_FIRST = cap1.gkAssetId;
  if (!GK_FIRST) throw new Error('first capture failed — cannot continue the certification');

  console.log("\n2. SECOND user authenticates; first user's state is invisible");
  logout();
  ok(isEmpty(await db.getAllComics()), 'logged out: no local rows readable');
  login(P_SECOND);
  ok(isEmpty(await db.getAllComics()), "second user sees ZERO of the first user's local Collection rows");
  ok(isEmpty(await generic.listGenericCaptureDrafts()), "second user sees none of the first user's capture drafts");
  const secondCollection = await (await fetch('/api/collection', { headers: bearer(P_SECOND) })).json();
  ok(Array.isArray(secondCollection.items) && secondCollection.items.length === 0, "second user's SERVER collection is empty (no leakage of the first user's item)");
  const crossRead = await fetch(`/api/assets?gkAssetId=${GK_FIRST}`, { headers: bearer(P_SECOND) });
  ok(crossRead.status === 404, `second user cannot read the first user's asset (HTTP ${crossRead.status})`);

  console.log('\n3. SECOND user mints their OWN physical asset');
  const cap2 = await captureOwned(`${TAG} Batman`, '1', '1940');
  ok(cap2.status === 200 && !!cap2.gkAssetId && cap2.gkAssetId !== GK_FIRST, `second principal minted a distinct physical asset (HTTP ${cap2.status})`);
  const GK_SECOND = cap2.gkAssetId;
  const own2 = await client.query('SELECT owner_principal_id FROM current_owner WHERE asset_id = $1', [GK_SECOND]);
  ok(own2.rowCount === 1 && own2.rows[0].owner_principal_id === P_SECOND, 'server-side: the second user owns the asset (current_owner)');
  const link2 = await client.query('SELECT gk_asset_id FROM collection_item_link WHERE collection_item_id = $1', [cap2.id]);
  ok(link2.rowCount === 1 && link2.rows[0].gk_asset_id === GK_SECOND, "collection_item_link joins the second user's item to their asset");
  const media2 = await client.query('SELECT count(*)::int AS n FROM media WHERE asset_id = $1', [GK_SECOND]);
  ok(media2.rows[0].n === 1, "the second user's photo persisted as a durable media row");
  const own1 = await client.query('SELECT owner_principal_id FROM current_owner WHERE asset_id = $1', [GK_FIRST]);
  ok(own1.rowCount === 1 && own1.rows[0].owner_principal_id === P_FIRST, "the first user's asset is still owned by the first user");
  const secondLocal = await db.getAllComics();
  ok(secondLocal.length === 1 && secondLocal[0].id === cap2.id, "second user's local scope holds only their own row");

  console.log('\n4. logout / relogin — each principal gets exactly their own state back');
  logout();
  login(P_FIRST);
  const firstLocal = await db.getAllComics();
  ok(firstLocal.length === 1 && firstLocal[0].id === cap1.id && firstLocal[0].gkAssetId === GK_FIRST, 'first user relogs in: sees only their own local row, same gkAssetId');
  const reread = await (await fetch(`/api/assets?gkAssetId=${GK_FIRST}`, { headers: bearer(P_FIRST) })).json();
  ok(!!reread.asset, 'first user reads the SAME asset from the server after relogin');
  logout();
  login(P_SECOND);
  const secondAgain = await db.getAllComics();
  ok(secondAgain.length === 1 && secondAgain[0].gkAssetId === GK_SECOND, 'second user relogs in: sees only their own row, same gkAssetId');
  const secondServer = await (await fetch('/api/collection', { headers: bearer(P_SECOND) })).json();
  ok(secondServer.items.length === 1 && secondServer.items[0].id === cap2.id, "second user's server collection returns exactly their one item");

  console.log('\n5. no cross-principal retry, no client-chosen principal');
  const pendingId = `${TAG}-stale-pending`;
  createdItemIds.push(pendingId);
  await db.putComic({ timestamp: Date.now(), id: pendingId, title: 'second pending', _syncStatus: 'pending' });
  const staleList = await db.getAllComics();
  logout();
  login(P_FIRST);
  routed = [];
  const stale = await persistence.retryPendingCollectionItems(staleList);
  ok(stale.length === 0 && routed.length === 0, "first user cannot retry the second user's pending row from a stale list (no request made)");
  const forgedId = `${TAG}-forged`;
  createdItemIds.push(forgedId);
  const forge = await fetch('/api/collection', { method: 'POST', headers: { ...bearer(P_FIRST), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: forgedId, assetCategory: 'comic', principalId: P_SECOND, principal_id: P_SECOND, attributes: { title: 'forged' } }) });
  const forged = await client.query('SELECT principal_id FROM collection_item WHERE id = $1', [forgedId]);
  ok(forge.ok && forged.rowCount === 1 && forged.rows[0].principal_id === P_FIRST, 'a body-supplied principalId is ignored: the row lands under the authenticated principal');
  ok((await client.query('SELECT 1 FROM collection_item WHERE id = $1 AND principal_id = $2', [forgedId, P_SECOND])).rowCount === 0, 'nothing was written under the named victim principal');
  logout();

  console.log('\nFINDING PROBE (informational, not a pass/fail assertion) — Generic capture ordering:');
  login(P_SECOND);
  const gd = await generic.createGenericCaptureDraft({ photoDataUrl: PNG, name: `${TAG} generic`, description: '', acquisitionCost: null });
  createdItemIds.push(gd.id);
  const gres = await generic.submitGenericCapture(gd);
  console.log(`    submitGenericCapture -> ${gres.ok ? 'OK (ordering defect no longer present)' : 'REJECTED: ' + String(gres.error || JSON.stringify(gres)).slice(0, 150)}`);
  logout();
} finally {
  for (const id of createdItemIds) {
    await client.query('DELETE FROM collection_item_link WHERE collection_item_id = $1', [id]).catch(() => {});
    await client.query('DELETE FROM collection_item WHERE id = $1', [id]).catch(() => {});
  }
  console.log(`\n  (cleanup) ${TAG}-tagged collection_item/link rows removed; gk_asset/gk_principal rows kept as permanent Development fixtures (repo convention).`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); }
process.exit(failed ? 1 : 0);
