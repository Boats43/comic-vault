// tests/launch1b-protected-collection-image.test.js
//
// GK-L1B (2026-10-11) -- PROTECTED collection display images. Real handlers (api/collection-image-v2.js,
// api/collection-image.js), real Development Postgres (two EXISTING principals; throwaway collection_item rows tagged
// and deleted at the end), real localfs media store, real HMAC link signing. Only fetch/IndexedDB are faked where the
// client library is exercised.
//
// Proves: item id alone authorizes nothing; lookup is principal_id AND id (COLLIDING ids across two principals
// resolve to each owner's OWN bytes); cross-principal denial and no enumeration; forged / re-targeted / expired /
// epoch-revoked links; deleted item; no public/immutable caching; retired endpoint is 410 and touches nothing; eBay
// publishing is independent of the display-image path; the client cache is principal-scoped and fail-soft; offline
// and expired-link recovery; the service worker never caches /api responses.
//
// Invoke: node tests/launch1b-protected-collection-image.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(root, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET || process.env.GRAILKEY_SESSION_SECRET.length < 32) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.GRAILKEY_SESSION_EPOCH = process.env.GRAILKEY_SESSION_EPOCH || '1';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const link = await imp('src/lib/collectionImageUrl.js');
const { default: v2 } = await imp('api/collection-image-v2.js');
const { default: retired } = await imp('api/collection-image.js');
const media = await imp('src/modules/media/index.js');
const { verifyToken } = await imp('src/modules/auth/token.js');

const mkRes = () => { const r = { code: null, body: null, buf: null, h: {} }; r.setHeader = (k, v) => { r.h[String(k).toLowerCase()] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.send = (b) => { r.buf = b; return r; }; return r; };
const call = async (fn, { method = 'GET', headers = {}, query = {}, body } = {}) => { const res = mkRes(); await fn({ method, headers, query, body, socket: {} }, res); return res; };
const sessionToken = (principalId) => { const now = Date.now(); const p = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH })).toString('base64url'); return `${p}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(p).digest('base64url')}`; };
const bearer = (pid) => ({ authorization: `Bearer ${sessionToken(pid)}` });
const tokenOf = (path_) => new URL(path_, 'http://x').searchParams.get('t');

// ── DB setup (Development only, verified) ──
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const marker = (await db.query('select app_env from data1_dev.environment_marker limit 1')).rows[0]?.app_env;
if (marker !== 'development') { console.error(`REFUSING: environment marker is "${marker}", not development`); process.exit(2); }
const principals = (await db.query("select id::text id from data1_dev.gk_principal where kind in ('operator','user') order by created_at limit 3")).rows.map((r) => r.id);
if (principals.length < 2) { console.error('need two existing Development principals'); process.exit(2); }
const [A, B] = principals;
const TAG = `l1b-${Date.now()}`;
const COLLIDE = `${TAG}-collide`;
const A_ONLY = `${TAG}-a-only`;
const B_ONLY = `${TAG}-b-only`;
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const PNG_B = Buffer.concat([PNG_A, Buffer.from('B-ONLY-TRAILER')]); // different bytes -> different content address
const putA = await media.put({ bytes: PNG_A, contentType: 'image/png' });
const putB = await media.put({ bytes: PNG_B, contentType: 'image/png' });
const insert = (pid, id, uri) => db.query('insert into data1_dev.collection_item (id, principal_id, asset_category, attributes) values ($1,$2,$3,$4)', [id, pid, 'comic', JSON.stringify({ title: 'L1B', remoteImages: [uri] })]);
try {
  await insert(A, COLLIDE, putA.objectUri); await insert(B, COLLIDE, putB.objectUri); // SAME id, two principals, different images
  await insert(A, A_ONLY, putA.objectUri); await insert(B, B_ONLY, putB.objectUri);

  console.log('\n[1] retired endpoint: 410, no data, touches nothing');
  for (const method of ['GET', 'POST', 'HEAD']) {
    const r = await call(retired, { method, query: { id: COLLIDE, index: '0' } });
    ok(r.code === 410 && r.buf === null && r.body?.error === 'GONE', `${method} /api/collection-image -> 410 GONE, no bytes`);
    ok(r.h['cache-control'] === 'no-store', `${method}: Cache-Control no-store (a cache cannot hold the retirement)`);
  }
  const src = readFileSync(path.join(root, 'api/collection-image.js'), 'utf8');
  ok(!/\bimport\b/.test(src), 'retired handler imports nothing (no DB, no media store)');

  console.log('\n[2] mint requires authentication; unauthenticated GET has no path to bytes');
  ok((await call(v2, { method: 'POST', body: { ids: [A_ONLY] } })).code === 401, 'POST without a session -> 401');
  ok((await call(v2, { method: 'POST', headers: { authorization: 'Bearer garbage' }, body: { ids: [A_ONLY] } })).code === 401, 'POST with a garbage bearer -> 401');
  ok((await call(v2, { method: 'GET', query: { id: A_ONLY, index: '0' } })).code === 403, 'GET by raw item id (the old attack) -> 403, no bytes');
  ok((await call(v2, { method: 'GET', query: { t: 'x.y' } })).code === 403, 'GET with a junk token -> 403');
  ok((await call(v2, { method: 'GET', query: {} })).buf === null, 'GET with nothing -> no bytes');

  console.log('\n[3] COLLIDING ids: each principal gets its OWN image, never the other\'s');
  const mintA = await call(v2, { method: 'POST', headers: bearer(A), body: { ids: [COLLIDE, A_ONLY, B_ONLY] } });
  const mintB = await call(v2, { method: 'POST', headers: bearer(B), body: { ids: [COLLIDE, A_ONLY, B_ONLY] } });
  ok(mintA.code === 200 && mintB.code === 200, 'both principals can mint');
  ok(mintA.h['cache-control'] === 'no-store', 'mint response is no-store');
  ok(Array.isArray(mintA.body.urls[COLLIDE]) && mintA.body.urls[COLLIDE].length === 1, 'A gets a link for the colliding id');
  ok(mintA.body.urls[A_ONLY]?.length === 1 && !(B_ONLY in mintA.body.urls), 'A gets A_ONLY and is told NOTHING about B_ONLY (no enumeration)');
  ok(mintB.body.urls[B_ONLY]?.length === 1 && !(A_ONLY in mintB.body.urls), 'B gets B_ONLY and nothing about A_ONLY');
  const getA = await call(v2, { query: { t: tokenOf(mintA.body.urls[COLLIDE][0]) } });
  const getB = await call(v2, { query: { t: tokenOf(mintB.body.urls[COLLIDE][0]) } });
  ok(getA.code === 200 && Buffer.compare(getA.buf, PNG_A) === 0, 'A\'s link on the colliding id returns A\'s bytes');
  ok(getB.code === 200 && Buffer.compare(getB.buf, PNG_B) === 0, 'B\'s link on the colliding id returns B\'s bytes (not A\'s)');

  console.log('\n[4] caching and response hygiene');
  const cc = getA.h['cache-control'] || '';
  ok(/^private, max-age=\d+$/.test(cc) && !/public|immutable/.test(cc) && Number(cc.match(/max-age=(\d+)/)[1]) <= 300, `Cache-Control is private and short (${cc})`);
  ok(getA.h['referrer-policy'] === 'no-referrer' && getA.h['x-content-type-options'] === 'nosniff', 'no-referrer + nosniff');
  ok(String(getA.h['content-type'] || '').startsWith('image/'), `content-type is an image type from the stored object (${getA.h['content-type']})`);
  const bad = await call(v2, { query: { t: 'x.y' } });
  ok(bad.h['cache-control'] === 'no-store', 'error responses are no-store');

  console.log('\n[5] forged / re-targeted links');
  const tA = tokenOf(mintA.body.urls[A_ONLY][0]);
  const [pl, sg] = tA.split('.');
  const pay = JSON.parse(Buffer.from(pl, 'base64url').toString());
  const forge = (mut) => `${Buffer.from(JSON.stringify({ ...pay, ...mut })).toString('base64url')}.${sg}`;
  for (const [label, mut] of [['principal swapped to B', { p: B }], ['item swapped to B_ONLY', { i: B_ONLY }], ['index changed', { n: 1 }], ['expiry extended', { e: pay.e + 86400e3 }]]) {
    const r = await call(v2, { query: { t: forge(mut) } });
    ok(r.code === 403 && r.body?.error === 'IMAGE_LINK_INVALID' && r.buf === null, `forged link (${label}) -> 403 IMAGE_LINK_INVALID`);
  }
  ok((await call(v2, { query: { t: `${pl}.${sg.slice(0, -2)}AA` } })).code === 403, 'tampered signature -> 403');
  ok((await call(v2, { query: { t: tA, id: B_ONLY, index: '0', principal: B } })).buf && Buffer.compare((await call(v2, { query: { t: tA, id: B_ONLY, index: '0', principal: B } })).buf, PNG_A) === 0, 'extra query params (id/index/principal) are ignored: only the signed payload decides');
  ok(verifyToken(tA) === null, 'an image link is NOT a valid session token');
  ok(!link.verifyImageLink(sessionToken(A)).ok, 'a session token is NOT a valid image link');

  console.log('\n[6] expiry and recovery');
  const old = link.mintImageLink({ principalId: A, itemId: A_ONLY, index: 0, now: Date.now() - 20 * 60e3 });
  const exp = await call(v2, { query: { t: old.token } });
  ok(exp.code === 403 && exp.body?.error === 'IMAGE_LINK_EXPIRED' && exp.buf === null, 'expired link -> 403 IMAGE_LINK_EXPIRED, no bytes');
  const reminted = await call(v2, { method: 'POST', headers: bearer(A), body: { ids: [A_ONLY] } });
  const again = await call(v2, { query: { t: tokenOf(reminted.body.urls[A_ONLY][0]) } });
  ok(again.code === 200 && Buffer.compare(again.buf, PNG_A) === 0, 'recovery: re-minting after expiry yields a working link');
  ok(link.IMAGE_LINK_TTL_MS === 600000, 'links live 10 minutes');

  console.log('\n[7] session epoch revokes outstanding links');
  const before = process.env.GRAILKEY_SESSION_EPOCH;
  process.env.GRAILKEY_SESSION_EPOCH = `${before}-revoked`;
  ok((await call(v2, { query: { t: tA } })).code === 403, 'bumping GRAILKEY_SESSION_EPOCH invalidates every outstanding image link');
  process.env.GRAILKEY_SESSION_EPOCH = before;
  ok((await call(v2, { query: { t: tA } })).code === 200, 'and restoring it restores nothing it should not (same epoch -> valid again)');

  console.log('\n[8] fail-closed signing');
  const savedSecret = process.env.GRAILKEY_SESSION_SECRET;
  process.env.GRAILKEY_SESSION_SECRET = 'short';
  let threw = false; try { link.mintImageLink({ principalId: A, itemId: A_ONLY, index: 0 }); } catch { threw = true; }
  ok(threw, 'weak secret: mint throws');
  ok(link.verifyImageLink(tA).ok === false, 'weak secret: verify refuses');
  ok((await call(v2, { query: { t: tA } })).code === 503, 'weak secret: handler answers 503, never serves');
  process.env.GRAILKEY_SESSION_SECRET = savedSecret;

  console.log('\n[9] deleted item: the previously valid link stops working');
  const live = tokenOf(mintA.body.urls[A_ONLY][0]);
  ok((await call(v2, { query: { t: live } })).code === 200, 'link works while the item exists');
  await db.query('delete from data1_dev.collection_item where principal_id=$1 and id=$2', [A, A_ONLY]);
  const gone = await call(v2, { query: { t: live } });
  ok(gone.code === 404 && gone.buf === null, 'after the item is deleted the same link -> 404, no bytes');
  const afterDel = await call(v2, { method: 'POST', headers: bearer(A), body: { ids: [A_ONLY] } });
  ok(!(A_ONLY in afterDel.body.urls), 'and it can no longer be minted');

  console.log('\n[10] input validation');
  ok((await call(v2, { method: 'POST', headers: bearer(A), body: { ids: [] } })).code === 400, 'empty ids -> 400');
  ok((await call(v2, { method: 'POST', headers: bearer(A), body: { ids: Array.from({ length: 101 }, (_, i) => `x${i}`) } })).code === 400, '101 ids -> 400');
  ok((await call(v2, { method: 'POST', headers: bearer(A), body: { ids: [123] } })).code === 400, 'non-string id -> 400');
  ok((await call(v2, { method: 'PUT', headers: bearer(A) })).code === 405, 'PUT -> 405');

  console.log('\n[11] eBay media independence');
  const { assertSourceImages } = await imp('src/lib/listingPhotoGuard.js');
  const signed = mintA.body.urls[COLLIDE][0];
  let rejected = false; try { assertSourceImages({ images: [signed], assetMediaHashes: new Set() }); } catch { rejected = true; }
  ok(rejected, 'a signed display-image URL is rejected as a publish source (publishing requires the original data: photo hashed to the asset)');
  for (const f of ['api/list-ebay.js', 'api/asset-media-append.js', 'src/lib/ebayMediaApi.js', 'src/lib/listingPhotoGuard.js', 'api/asset-media.js']) {
    const t = readFileSync(path.join(root, f), 'utf8');
    ok(!/collectionImageUrl|protectedImages|collection-image-v2/.test(t.replace(/\/\/.*$/gm, '')), `${f} does not use the display-image path`);
  }

  console.log('\n[12] unscoped lookup is gone; module + static guarantees');
  const idx = readFileSync(path.join(root, 'src/modules/collection/index.js'), 'utf8');
  ok(!/\bgetRemoteImageUri\b(?!ForPrincipal)/.test(idx.replace(/\/\/.*$/gm, '')), 'collection module no longer exports the unscoped getRemoteImageUri');
  const repo = readFileSync(path.join(root, 'src/modules/collection/repository.js'), 'utf8');
  ok(!/WHERE id = \$1 LIMIT 1/.test(repo.replace(/\/\/.*$/gm, '')), 'no `WHERE id = $1 LIMIT 1` image lookup remains in the repository');
  ok(/WHERE principal_id = \$1 AND id = \$2/.test(repo.slice(repo.indexOf('getRemoteImageUriForPrincipal'))), 'the image lookup binds principal_id AND id');
  const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  ok(!/\/api\//.test(sw), 'service worker never intercepts or caches /api responses (signed links are never SW-cached)');
  const app = readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
  ok(!/\/api\/collection-image\?id=/.test(app.replace(/\/\/.*$/gm, '')), 'App.jsx builds no id-only image URL');
  ok(/getProtectedImageUrl\(comic\.id, i\)/.test(app), 'getComicPhotos resolves remote images through signed links');
  ok(/if \(Array\.isArray\(comic\.images\) && comic\.images\.length > 0\)[\s\S]{0,200}return comic\.images\.filter\(Boolean\)/.test(app), 'local base64 images still take priority (offline on the capturing device)');

} finally {
  await db.query('delete from data1_dev.collection_item where id like $1', [`${TAG}%`]);
  const left = (await db.query('select count(*)::int n from data1_dev.collection_item where id like $1', [`${TAG}%`])).rows[0].n;
  ok(left === 0, 'cleanup: throwaway Development rows removed');
  await db.end();
}

// ── client library ──
console.log('\n[13] client cache: batching, principal scoping, expiry, backoff, offline, recovery');
const pi = await imp('src/lib/protectedImages.js');
const mkTransport = (impl) => { const calls = []; return { calls, fn: async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body) }); return impl(calls[calls.length - 1]); } }; };
const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });
let t = 1_000_000; pi.setProtectedImagesClock(() => t);
let who = 'principal-A'; pi.setProtectedImagesScopeFn(() => who);
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
{
  pi.resetProtectedImages();
  const tr = mkTransport((c) => okJson({ urls: Object.fromEntries(c.body.ids.map((id) => [id, [`/api/collection-image-v2?t=${who}.${id}.0`]])), expiresAt: t + 600000 }));
  pi.setProtectedImagesTransport(tr.fn);
  let notified = 0; const un = pi.subscribeProtectedImages(() => { notified += 1; });
  ok(pi.getProtectedImageUrl('i1', 0) === null && pi.getProtectedImageUrl('i2', 0) === null && pi.getProtectedImageUrl('i1', 0) === null, 'first call returns null (never blocks a render)');
  await settle();
  ok(tr.calls.length === 1 && tr.calls[0].body.ids.length === 2, 'many calls in one tick -> ONE batched, deduplicated POST');
  ok(notified === 1, 'subscribers notified once when links arrive');
  ok(pi.getProtectedImageUrl('i1', 0)?.includes('principal-A'), 'then the cached link is returned synchronously');
  ok(pi.getProtectedImageUrl('i1', 5) === null, 'an index with no link is null (no crash)');
  // principal switch: B must never see A's links
  who = 'principal-B';
  ok(pi.getProtectedImageUrl('i1', 0) === null, 'principal switch: A\'s cached link is NOT handed to B');
  await settle();
  ok(pi.getProtectedImageUrl('i1', 0)?.includes('principal-B'), 'B receives its OWN freshly minted link');
  who = 'principal-A';
  // expiry: advance past exp -> refresh
  t += 600001;
  ok(pi.getProtectedImageUrl('i1', 0) === null, 'after expiry the stale link is not returned');
  await settle();
  ok(pi.getProtectedImageUrl('i1', 0) !== null, 'and a fresh one arrives (background refresh)');
  // near expiry: still returned, refresh requested
  const callsBefore = tr.calls.length; t += 600000 - 60000;
  ok(pi.getProtectedImageUrl('i1', 0) !== null, 'within the refresh margin the (still valid) link keeps rendering');
  await settle();
  ok(tr.calls.length === callsBefore + 1, '...and exactly one background refresh is requested');
  un();
}
{
  // no session -> no request, no cache
  pi.resetProtectedImages(); who = null;
  const tr = mkTransport(() => okJson({ urls: {}, expiresAt: t + 1 }));
  pi.setProtectedImagesTransport(tr.fn);
  ok(pi.getProtectedImageUrl('i1', 0) === null, 'no session -> null');
  await settle();
  ok(tr.calls.length === 0, 'no session -> no request is ever made');
  who = 'principal-A';
}
{
  // offline / failures: no throw, bounded retries
  pi.resetProtectedImages();
  let n = 0; pi.setProtectedImagesTransport(async () => { n += 1; throw new TypeError('Failed to fetch'); });
  let threw = false; try { pi.getProtectedImageUrl('i1', 0); await settle(); pi.getProtectedImageUrl('i1', 0); } catch { threw = true; }
  ok(!threw, 'offline (transport throws): never throws');
  ok(pi.getProtectedImageUrl('i1', 0) === null, 'offline: renders absent, no broken link');
  await settle(); const afterFirst = n;
  for (let i = 0; i < 20; i += 1) { pi.getProtectedImageUrl('i1', 0); await settle(); }
  ok(n === afterFirst, `failure backoff: 20 more renders caused 0 more requests (${n} total)`);
  t += pi.FAILURE_BACKOFF_MS + 1; pi.getProtectedImageUrl('i1', 0); await settle();
  ok(n === afterFirst + 1, 'after the backoff window one retry is allowed (online again)');
  pi.setProtectedImagesTransport(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  pi.resetProtectedImages(); pi.getProtectedImageUrl('z', 0); await settle();
  ok(pi.getProtectedImageUrl('z', 0) === null, 'non-ok answer: null, no crash');
}
{
  // not-yours / no image: negative cache, no hammering
  pi.resetProtectedImages(); let n = 0;
  pi.setProtectedImagesTransport(async () => { n += 1; return okJson({ urls: {}, expiresAt: t + 1 }); });
  pi.getProtectedImageUrl('ghost', 0); await settle();
  for (let i = 0; i < 10; i += 1) { pi.getProtectedImageUrl('ghost', 0); await settle(); }
  ok(n === 1, 'an id the server does not return is negatively cached (1 request for 11 renders)');
}
{
  // expired-link recovery through a capturing error listener
  pi.resetProtectedImages();
  const tr = mkTransport((c) => okJson({ urls: Object.fromEntries(c.body.ids.map((id) => [id, [`/api/collection-image-v2?t=${Buffer.from(JSON.stringify({ i: id })).toString('base64url')}.sig`]])), expiresAt: t + 600000 }));
  pi.setProtectedImagesTransport(tr.fn);
  pi.getProtectedImageUrl('item-r', 0); await settle();
  const url = pi.getProtectedImageUrl('item-r', 0);
  const docListeners = {}; const winListeners = {};
  const fakeDoc = { visibilityState: 'visible', addEventListener: (e, f, c) => { docListeners[e] = { f, c }; }, removeEventListener: (e) => { delete docListeners[e]; } };
  const fakeWin = { document: fakeDoc, addEventListener: (e, f) => { winListeners[e] = f; }, removeEventListener: (e) => { delete winListeners[e]; }, setInterval: () => 1, clearInterval: () => {} };
  const un = pi.installImageRecovery(fakeWin);
  ok(docListeners.error?.c === true, 'recovery uses a CAPTURING document error listener (img errors do not bubble)');
  const before = tr.calls.length;
  docListeners.error.f({ target: { tagName: 'IMG', getAttribute: () => url } });
  await settle();
  ok(tr.calls.length === before + 1 && tr.calls[tr.calls.length - 1].body.ids[0] === 'item-r', 'a failed protected <img> triggers a refresh of THAT item');
  docListeners.error.f({ target: { tagName: 'IMG', getAttribute: () => url } }); await settle();
  ok(tr.calls.length === before + 1, 'a second failure inside the window does not storm the endpoint');
  docListeners.error.f({ target: { tagName: 'IMG', getAttribute: () => '/somewhere/else.png' } }); await settle();
  ok(tr.calls.length === before + 1, 'unrelated <img> errors are ignored');
  winListeners['grailkey:session-expired']?.();
  who = 'principal-A';
  ok(pi.getProtectedImageUrl('item-r', 0) === null, 'session expiry clears every cached link');
  un();
  ok(Object.keys(docListeners).length === 0 && Object.keys(winListeners).length === 0, 'uninstall removes every listener');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
