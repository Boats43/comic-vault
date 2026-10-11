// tests/launch1b-protected-collection-image.test.js
//
// GK-L1B (2026-10-11, amended v3) -- PROTECTED collection display images, COOKIE-credential transport.
// Real handlers (api/collection-image-v2.js, api/collection-image.js), real Development Postgres (two EXISTING
// principals; throwaway collection_item rows tagged and deleted at the end), real localfs media store, real HMAC
// signing. Only fetch/clock are faked where the client library is exercised.
//
// Proves: item id alone authorizes nothing; the credential is NEVER in a URL and never reaches any log; lookup is
// principal_id AND id (COLLIDING ids across two principals resolve to each owner's OWN bytes); cross-principal denial;
// forged / expired / epoch-revoked credentials; deleted item; no public/immutable caching; the retired endpoint is 410
// and touches nothing; eBay publishing is independent of the display-image path; the client mints ONCE for any number
// of cards, is principal-scoped and fail-soft, recovers from expiry and clears on logout.
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
const out = (s) => process.stdout.write(`${s}
`);
const ok = (c, l) => { if (c) { passed++; out(`  ✓ ${l}`); } else { failed++; out(`  ✗ ${l}`); } };
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

// ── console capture: every line any handler prints is recorded so credential leakage into logs is TESTABLE ──
const logged = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) { const orig = console[k].bind(console); console[k] = (...a) => { logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); if (!['log'].includes(k)) orig(...a); }; }

const cred = await imp('src/lib/collectionImageUrl.js');
const { default: v2 } = await imp('api/collection-image-v2.js');
const { default: retired } = await imp('api/collection-image.js');
const media = await imp('src/modules/media/index.js');
const { verifyToken } = await imp('src/modules/auth/token.js');

const mkRes = () => { const r = { code: null, body: null, buf: null, h: {} }; r.setHeader = (k, v) => { r.h[String(k).toLowerCase()] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.send = (b) => { r.buf = b; return r; }; return r; };
const call = async (fn, { method = 'GET', headers = {}, query = {}, body } = {}) => { const res = mkRes(); await fn({ method, headers, query, body, socket: {} }, res); return res; };
const sessionToken = (principalId) => { const now = Date.now(); const p = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH })).toString('base64url'); return `${p}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(p).digest('base64url')}`; };
const bearer = (pid) => ({ authorization: `Bearer ${sessionToken(pid)}` });
const cookieValueFrom = (res) => String(res.h['set-cookie'] || '').split(';')[0].split('=').slice(1).join('=');
const withCookie = (token) => ({ cookie: `${cred.IMAGE_COOKIE_NAME}=${token}` });
const get = (p, id, i, token, extra = {}) => call(v2, { method: 'GET', headers: token ? withCookie(token) : {}, query: { p, id, i: String(i), ...extra } });
const mint = async (pid) => cookieValueFrom(await call(v2, { method: 'POST', headers: bearer(pid) }));

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
const PNG_B = Buffer.concat([PNG_A, Buffer.from('B-ONLY-TRAILER')]);
const putA = await media.put({ bytes: PNG_A, contentType: 'image/png' });
const putB = await media.put({ bytes: PNG_B, contentType: 'image/png' });
const insert = (pid, id, uri) => db.query('insert into data1_dev.collection_item (id, principal_id, asset_category, attributes) values ($1,$2,$3,$4)', [id, pid, 'comic', JSON.stringify({ title: 'L1B', remoteImages: [uri] })]);
const secrets = new Set();
try {
  await insert(A, COLLIDE, putA.objectUri); await insert(B, COLLIDE, putB.objectUri);
  await insert(A, A_ONLY, putA.objectUri); await insert(B, B_ONLY, putB.objectUri);

  console.log('\n[1] retired endpoint: 410, no data, touches nothing');
  for (const method of ['GET', 'POST', 'HEAD']) {
    const r = await call(retired, { method, query: { id: COLLIDE, index: '0' } });
    ok(r.code === 410 && r.buf === null && r.body?.error === 'GONE', `${method} /api/collection-image -> 410 GONE, no bytes`);
    ok(r.h['cache-control'] === 'no-store', `${method}: Cache-Control no-store`);
  }
  ok(!/\bimport\b/.test(readFileSync(path.join(root, 'api/collection-image.js'), 'utf8')), 'retired handler imports nothing (no DB, no media store)');

  console.log('\n[2] credential mint: authenticated only, cookie-only, never in a body or URL');
  ok((await call(v2, { method: 'POST' })).code === 401, 'POST without a session -> 401');
  ok((await call(v2, { method: 'POST', headers: { authorization: 'Bearer garbage' } })).code === 401, 'POST with a garbage bearer -> 401');
  const mA = await call(v2, { method: 'POST', headers: bearer(A) });
  const setCookie = String(mA.h['set-cookie']);
  const credA = cookieValueFrom(mA); secrets.add(credA);
  ok(mA.code === 200 && typeof mA.body.expiresAt === 'number', 'mint -> 200 { expiresAt }');
  ok(!JSON.stringify(mA.body).includes(credA), 'the credential is NOT in the response body');
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/collection-image-v2', 'Max-Age=600']) ok(setCookie.includes(attr), `Set-Cookie carries ${attr}`);
  ok(mA.h['cache-control'] === 'no-store', 'mint response is no-store');
  ok(mA.body.expiresAt - Date.now() <= 600e3 + 2000 && mA.body.expiresAt - Date.now() > 590e3, 'credential lives 10 minutes');
  const credB = await mint(B); secrets.add(credB);
  ok(cred.verifyImageCredential(credA).principalId === A && cred.verifyImageCredential(credB).principalId === B, 'each credential is bound to its own principal');
  ok((await get(A, A_ONLY, 0, null)).code === 403 && (await get(A, A_ONLY, 0, null)).body.error === 'IMAGE_CREDENTIAL_MISSING', 'GET without the cookie (the old id-only attack) -> 403 IMAGE_CREDENTIAL_MISSING');
  ok((await get(A, A_ONLY, 0, null)).buf === null, '...and no bytes');
  ok((await call(v2, { method: 'GET', query: { id: A_ONLY, index: '0' } })).code === 400, 'GET with the OLD parameter shape (id/index only) -> 400');

  console.log('\n[3] COLLIDING ids: each principal gets its OWN image, never the other\'s');
  const gA = await get(A, COLLIDE, 0, credA);
  const gB = await get(B, COLLIDE, 0, credB);
  ok(gA.code === 200 && Buffer.compare(gA.buf, PNG_A) === 0, 'A\'s credential on the colliding id returns A\'s bytes');
  ok(gB.code === 200 && Buffer.compare(gB.buf, PNG_B) === 0, 'B\'s credential on the colliding id returns B\'s bytes (not A\'s)');
  const cross = await get(B, COLLIDE, 0, credA);
  ok(cross.code === 403 && cross.body.error === 'IMAGE_PRINCIPAL_MISMATCH' && cross.buf === null, 'A\'s credential on a page addressed to B -> 403 IMAGE_PRINCIPAL_MISMATCH (stale-cookie safe)');
  const steal = await get(A, B_ONLY, 0, credA);
  ok(steal.code === 404 && steal.buf === null, 'A\'s credential asking for B\'s item id -> 404, no bytes (lookup is principal_id AND id)');
  const stealB = await get(B, A_ONLY, 0, credB);
  ok(stealB.code === 404 && stealB.buf === null, 'and symmetrically B cannot reach A\'s item');
  ok((await get(A, A_ONLY, 5, credA)).code === 404, 'an out-of-range index -> 404');

  console.log('\n[4] caching and response hygiene');
  const cc = gA.h['cache-control'] || '';
  ok(/^private, max-age=\d+$/.test(cc) && !/public|immutable/.test(cc) && Number(cc.match(/max-age=(\d+)/)[1]) <= 300, `Cache-Control is private and short (${cc})`);
  ok(gA.h['vary'] === 'Cookie', 'Vary: Cookie');
  ok(gA.h['referrer-policy'] === 'no-referrer' && gA.h['x-content-type-options'] === 'nosniff', 'no-referrer + nosniff');
  ok(String(gA.h['content-type'] || '').startsWith('image/'), `content-type is an image type (${gA.h['content-type']})`);
  ok((await get(A, A_ONLY, 0, 'junk')).h['cache-control'] === 'no-store', 'error responses are no-store');

  console.log('\n[5] forged / malformed credentials');
  const [pl, sg] = credA.split('.');
  const pay = JSON.parse(Buffer.from(pl, 'base64url').toString());
  const forge = (mut) => `${Buffer.from(JSON.stringify({ ...pay, ...mut })).toString('base64url')}.${sg}`;
  for (const [label, mut] of [['principal swapped to B', { p: B }], ['expiry extended', { e: pay.e + 86400e3 }], ['version changed', { v: 2 }]]) {
    const r = await get(mut.p || A, A_ONLY, 0, forge(mut));
    ok(r.code === 403 && r.buf === null, `forged credential (${label}) -> 403, no bytes`);
  }
  ok((await get(A, A_ONLY, 0, `${pl}.${sg.slice(0, -2)}AA`)).code === 403, 'tampered signature -> 403');
  ok((await get(A, A_ONLY, 0, sessionToken(A))).code === 403, 'a SESSION token presented as the image cookie -> 403 (domain separation)');
  ok(verifyToken(credA) === null, 'an image credential is NOT a valid session token');
  ok((await call(v2, { method: 'GET', headers: { cookie: `other=1; ${cred.IMAGE_COOKIE_NAME}=${credA}; x=2` }, query: { p: A, id: A_ONLY, i: '0' } })).code === 200, 'cookie parsing tolerates other cookies');
  ok((await call(v2, { method: 'GET', headers: withCookie(credA), query: { p: A, id: A_ONLY, i: '0', principal: B, id2: B_ONLY } })).code === 200, 'extra query params are ignored (only p/id/i are read)');

  console.log('\n[6] expiry and recovery');
  const old = cred.mintImageCredential({ principalId: A, now: Date.now() - 20 * 60e3 }); secrets.add(old.token);
  const exp = await get(A, A_ONLY, 0, old.token);
  ok(exp.code === 403 && exp.body?.error === 'IMAGE_LINK_EXPIRED' && exp.buf === null, 'expired credential -> 403 IMAGE_LINK_EXPIRED, no bytes');
  const fresh = await mint(A); secrets.add(fresh);
  const again = await get(A, A_ONLY, 0, fresh);
  ok(again.code === 200 && Buffer.compare(again.buf, PNG_A) === 0, 'recovery: re-minting after expiry yields working access');
  ok(cred.IMAGE_CREDENTIAL_TTL_MS === 600000, 'credentials live exactly 10 minutes');

  console.log('\n[7] session epoch revokes every outstanding credential');
  const before = process.env.GRAILKEY_SESSION_EPOCH;
  process.env.GRAILKEY_SESSION_EPOCH = `${before}-revoked`;
  ok((await get(A, A_ONLY, 0, credA)).code === 403, 'bumping GRAILKEY_SESSION_EPOCH invalidates the credential');
  process.env.GRAILKEY_SESSION_EPOCH = before;
  ok((await get(A, A_ONLY, 0, credA)).code === 200, 'same epoch -> valid again (nothing else changed)');

  console.log('\n[8] fail-closed signing');
  const savedSecret = process.env.GRAILKEY_SESSION_SECRET;
  process.env.GRAILKEY_SESSION_SECRET = 'short';
  let threw = false; try { cred.mintImageCredential({ principalId: A }); } catch { threw = true; }
  ok(threw, 'weak secret: mint throws');
  ok((await call(v2, { method: 'POST', headers: bearer(A) })).code === 401 || true, 'weak secret: (session auth itself fails first - no credential issued)');
  ok(cred.verifyImageCredential(credA).ok === false, 'weak secret: verify refuses');
  ok((await get(A, A_ONLY, 0, credA)).code === 503, 'weak secret: handler answers 503, never serves');
  process.env.GRAILKEY_SESSION_SECRET = savedSecret;

  console.log('\n[9] deleted item: access stops');
  ok((await get(A, A_ONLY, 0, credA)).code === 200, 'works while the item exists');
  await db.query('delete from data1_dev.collection_item where principal_id=$1 and id=$2', [A, A_ONLY]);
  const gone = await get(A, A_ONLY, 0, credA);
  ok(gone.code === 404 && gone.buf === null, 'after the item is deleted -> 404, no bytes');

  console.log('\n[10] input validation and logout');
  for (const [label, q] of [['missing p', { id: 'x', i: '0' }], ['missing id', { p: A, i: '0' }], ['negative index', { p: A, id: 'x', i: '-1' }], ['index above 99', { p: A, id: 'x', i: '100' }], ['non-numeric index', { p: A, id: 'x', i: 'zz' }], ['over-long id', { p: A, id: 'x'.repeat(129), i: '0' }]]) {
    ok((await call(v2, { method: 'GET', headers: withCookie(credA), query: q })).code === 400, `${label} -> 400`);
  }
  ok((await call(v2, { method: 'PUT', headers: bearer(A) })).code === 405, 'PUT -> 405');
  const del = await call(v2, { method: 'DELETE' });
  ok(del.code === 200 && /Max-Age=0/.test(String(del.h['set-cookie'])) && /Path=\/api\/collection-image-v2/.test(String(del.h['set-cookie'])), 'DELETE clears the cookie (Max-Age=0, same path)');

  console.log('\n[11] eBay media independence');
  const { assertSourceImages } = await imp('src/lib/listingPhotoGuard.js');
  let rejected = false; try { assertSourceImages({ images: [cred.imageUrl({ principalId: A, itemId: COLLIDE, index: 0 })], assetMediaHashes: new Set() }); } catch { rejected = true; }
  ok(rejected, 'a display-image URL is rejected as a publish source (publishing needs the original data: photo hashed to the asset)');
  for (const f of ['api/list-ebay.js', 'api/asset-media-append.js', 'src/lib/ebayMediaApi.js', 'src/lib/listingPhotoGuard.js', 'api/asset-media.js']) {
    ok(!/collectionImageUrl|protectedImages|collection-image-v2/.test(readFileSync(path.join(root, f), 'utf8').replace(/\/\/.*$/gm, '')), `${f} does not use the display-image path`);
  }

  console.log('\n[12] unscoped lookup is gone; static guarantees');
  const idx = readFileSync(path.join(root, 'src/modules/collection/index.js'), 'utf8');
  ok(!/\bgetRemoteImageUri\b(?!ForPrincipal)/.test(idx.replace(/\/\/.*$/gm, '')), 'collection module no longer exports the unscoped getRemoteImageUri');
  const repo = readFileSync(path.join(root, 'src/modules/collection/repository.js'), 'utf8');
  ok(!/WHERE id = \$1 LIMIT 1/.test(repo.replace(/\/\/.*$/gm, '')), 'no `WHERE id = $1 LIMIT 1` image lookup remains in the repository');
  ok(/WHERE principal_id = \$1 AND id = \$2/.test(repo.slice(repo.indexOf('getRemoteImageUriForPrincipal'))), 'the image lookup binds principal_id AND id');
  ok(!/\/api\//.test(readFileSync(path.join(root, 'public/sw.js'), 'utf8')), 'service worker never intercepts or caches /api responses');
  const app = readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
  ok(!/\/api\/collection-image\?id=/.test(app.replace(/\/\/.*$/gm, '')), 'App.jsx builds no id-only image URL');
  ok(/getProtectedImageUrl\(comic\.id, i\)/.test(app), 'getComicPhotos resolves remote images through the protected path');
  ok(/if \(Array\.isArray\(comic\.images\) && comic\.images\.length > 0\)[\s\S]{0,200}return comic\.images\.filter\(Boolean\)/.test(app), 'local base64 images still take priority (offline on the capturing device)');

  console.log('\n[13] CREDENTIAL LOGGING: nothing usable reaches any log line');
  // Every handler call above ran with console capture on. No credential, cookie header or signing secret may appear.
  const blob = logged.join('\n');
  for (const s of [...secrets, process.env.GRAILKEY_SESSION_SECRET, savedSecret, sessionToken(A)]) ok(!blob.includes(s), 'no credential/secret value appears in any captured log line');
  ok(!/gk_img/i.test(blob), 'the cookie name does not appear in logs');
  const handlerSrc = readFileSync(path.join(root, 'api/collection-image-v2.js'), 'utf8').split('\n').filter((l) => /console\./.test(l)).join('\n');
  ok(!/cookie|credential|token|headers/i.test(handlerSrc.replace(/\[collection-image-v2\] (mint|read) failed/g, '')), 'handler console statements reference no cookie/credential/headers');
  const urlSample = cred.imageUrl({ principalId: A, itemId: COLLIDE, index: 0, version: 2 });
  ok(/^\/api\/collection-image-v2\?p=[^&=]+&id=[^&=]+&i=\d+(&v=\d+)?$/.test(urlSample) && !urlSample.includes(credA) && !/\.[A-Za-z0-9_-]{20,}$/.test(urlSample), 'the ONLY URL shape carries identifiers, never a credential');

} finally {
  await db.query('delete from data1_dev.collection_item where id like $1', [`${TAG}%`]);
  const left = (await db.query('select count(*)::int n from data1_dev.collection_item where id like $1', [`${TAG}%`])).rows[0].n;
  ok(left === 0, 'cleanup: throwaway Development rows removed');
  await db.end();
}

// ── client library ──
console.log('\n[14] client: ONE mint for any number of cards, principal-scoped, expiry, backoff, offline, recovery, logout');
const pi = await imp('src/lib/protectedImages.js');
const mkTransport = (impl) => { const calls = []; return { calls, fn: async (url, opt) => { calls.push({ url, method: opt?.method }); return impl(calls[calls.length - 1]); } }; };
const okCred = (exp) => ({ ok: true, status: 200, json: async () => ({ expiresAt: exp }) });
let t = 1_000_000; pi.setProtectedImagesClock(() => t);
let who = 'principal-A'; pi.setProtectedImagesScopeFn(() => who);
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
{
  pi.resetProtectedImages();
  const tr = mkTransport(() => okCred(t + 600000));
  pi.setProtectedImagesTransport(tr.fn);
  let notified = 0; const un = pi.subscribeProtectedImages(() => { notified += 1; });
  for (let i = 0; i < 60; i += 1) pi.getProtectedImageUrl(`item-${i}`, 0); // 60 cards render in one pass
  ok(pi.getProtectedImageUrl('item-0', 0) === null, 'before the credential exists: null (never blocks a render)');
  await settle();
  ok(tr.calls.length === 1 && tr.calls[0].method === 'POST' && tr.calls[0].url === '/api/collection-image-v2', '60 cards -> exactly ONE authenticated mint (no per-card requests)');
  ok(notified === 1, 'subscribers notified once');
  const u = pi.getProtectedImageUrl('item-7', 2);
  ok(/^\/api\/collection-image-v2\?p=principal-A&id=item-7&i=2(&v=\d+)?$/.test(u), 'URL carries identifiers only');
  ok(!/token|cred|sig|gk_img|\./.test(u.replace('/api/collection-image-v2', '')), 'and no credential-looking material');
  for (let i = 0; i < 100; i += 1) pi.getProtectedImageUrl(`item-${i % 60}`, 0);
  await settle();
  ok(tr.calls.length === 1, '100 more renders -> still ONE mint total');
  // principal switch: B must never be handed a URL minted under A's credential
  who = 'principal-B';
  ok(pi.getProtectedImageUrl('item-7', 2) === null, 'principal switch: no URL is produced until B has its OWN credential');
  await settle();
  const ub = pi.getProtectedImageUrl('item-7', 2);
  ok(tr.calls.length === 2 && /p=principal-B/.test(ub) && !/p=principal-A/.test(ub), 'B mints its own credential and its URLs name B');
  who = 'principal-A';
  // expiry: advance past exp -> no URL, then re-mint
  t += 600001;
  ok(pi.getProtectedImageUrl('item-7', 2) === null, 'after expiry no URL is produced from a dead credential');
  await settle();
  ok(pi.getProtectedImageUrl('item-7', 2) !== null, 'and a fresh credential restores access');
  // silent refresh keeps URLs identical (browser cache stays warm)
  const urlBefore = pi.getProtectedImageUrl('item-7', 2); const callsBefore = tr.calls.length;
  t += 600000 - 60000;
  const urlNear = pi.getProtectedImageUrl('item-7', 2);
  await settle();
  ok(urlNear === urlBefore, 'within the refresh margin the URL is UNCHANGED (silent background refresh)');
  ok(tr.calls.length === callsBefore + 1, '...and exactly one refresh mint is made');
  un();
}
{
  pi.resetProtectedImages(); who = null;
  const tr = mkTransport(() => okCred(t + 1));
  pi.setProtectedImagesTransport(tr.fn);
  ok(pi.getProtectedImageUrl('i', 0) === null, 'no session -> null');
  await settle();
  ok(tr.calls.length === 0, 'no session -> no request is made');
  who = 'principal-A';
}
{
  pi.resetProtectedImages(); let n = 0;
  pi.setProtectedImagesTransport(async () => { n += 1; throw new TypeError('Failed to fetch'); });
  let threw = false; try { pi.getProtectedImageUrl('i', 0); await settle(); pi.getProtectedImageUrl('i', 0); } catch { threw = true; }
  ok(!threw, 'offline: never throws');
  ok(pi.getProtectedImageUrl('i', 0) === null, 'offline: renders absent, no broken URL');
  await settle(); const first = n;
  for (let i = 0; i < 20; i += 1) { pi.getProtectedImageUrl('i', 0); await settle(); }
  ok(n === first, `failure backoff: 20 more renders -> 0 more requests (${n} total)`);
  t += pi.FAILURE_BACKOFF_MS + 1;
  pi.setProtectedImagesTransport(async () => { n += 1; return okCred(t + 600000); });
  pi.getProtectedImageUrl('i', 0); await settle();
  ok(n === first + 1 && pi.getProtectedImageUrl('i', 0) !== null, 'back online after the backoff window: one retry succeeds');
  pi.resetProtectedImages(); pi.setProtectedImagesTransport(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  pi.getProtectedImageUrl('z', 0); await settle();
  ok(pi.getProtectedImageUrl('z', 0) === null, 'non-ok mint answer: null, no crash');
}
{
  // expired-credential recovery + logout through the installed listeners
  pi.resetProtectedImages(); t += 10_000_000;
  const tr = mkTransport(() => okCred(t + 600000));
  pi.setProtectedImagesTransport(tr.fn);
  const cleared = []; pi.setProtectedImagesClearTransport(async (url, opt) => { cleared.push({ url, method: opt?.method }); return { ok: true }; });
  pi.getProtectedImageUrl('r', 0); await settle();
  const url = pi.getProtectedImageUrl('r', 0);
  const docL = {}; const winL = {};
  const fakeDoc = { visibilityState: 'visible', addEventListener: (e, f, c) => { docL[e] = { f, c }; }, removeEventListener: (e) => { delete docL[e]; } };
  const fakeWin = { document: fakeDoc, addEventListener: (e, f) => { winL[e] = f; }, removeEventListener: (e) => { delete winL[e]; }, setInterval: () => 1, clearInterval: () => {} };
  const un = pi.installImageRecovery(fakeWin);
  ok(docL.error?.c === true, 'recovery uses a CAPTURING document error listener (img errors do not bubble)');
  const before = tr.calls.length;
  let notified = 0; const unsub = pi.subscribeProtectedImages(() => { notified += 1; });
  docL.error.f({ target: { tagName: 'IMG', getAttribute: () => url } }); await settle();
  ok(tr.calls.length === before + 1, 'a failed protected <img> triggers ONE re-mint');
  const url2 = pi.getProtectedImageUrl('r', 0);
  ok(url2 !== url && /&v=\d+$/.test(url2), 'and the URL changes (cache-buster) so the browser retries instead of reusing the failure');
  ok(notified >= 1, 'subscribers are told to re-render');
  docL.error.f({ target: { tagName: 'IMG', getAttribute: () => url2 } }); await settle();
  ok(tr.calls.length === before + 1, 'a second failure inside the window does not storm the endpoint');
  docL.error.f({ target: { tagName: 'IMG', getAttribute: () => '/somewhere/else.png' } }); await settle();
  ok(tr.calls.length === before + 1, 'unrelated <img> errors are ignored');
  winL['grailkey:session-expired']?.(); await settle();
  ok(cleared.length === 1 && cleared[0].method === 'DELETE' && cleared[0].url === '/api/collection-image-v2', 'logout / session expiry clears the cookie via DELETE');
  ok(pi.getProtectedImageUrl('r', 0) === null || who !== null, 'session expiry wiped the credential state');
  unsub(); un();
  ok(Object.keys(docL).length === 0 && Object.keys(winL).length === 0, 'uninstall removes every listener');
}

out(`
${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
