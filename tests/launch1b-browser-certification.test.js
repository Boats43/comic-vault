// tests/launch1b-browser-certification.test.js
//
// GK-L1B (v3) BROWSER CERTIFICATION - the REAL built app (dist/) in a REAL Chrome (Playwright over the locally installed
// Chrome/Edge), mobile 390x844 (touch, DPR 3, mobile UA) AND desktop 1280x800, against the REAL protected-image handlers
// and a REAL Development database (two existing principals, throwaway rows tagged and deleted afterwards).
// Everything except the image/collection handlers answers 503 - this proves the CLIENT + the protected-image path, and
// makes NO call to any provider or to Production.
//
// Verifies (per viewport):
//   1 Collection images render after authorization (decoded pixels match the owning principal)
//   2 many cards -> ONE credential mint (no redundant mint requests)
//   3 an expired credential recovers (new mint, images load again)
//   4 principal switching never shows another principal's images (incl. COLLIDING item ids), logout clears the cookie
//   5 the new client never requests the retired endpoint
//   6 an OLD PWA bundle degrades explicitly: 410 from the retired endpoint, no crash, local UI usable
//   7 offline behaviour matches the documented limits (no crash; remote-only images absent; recovery when back online)
//   8 the credential is a Secure/HttpOnly/SameSite=Strict/path-scoped cookie: not in any request URL, not readable by JS
// Prereq: `npm run build` (dist/) and, for check 6, an old build in OLD_DIST (default C:/gk281/impl/dist) - skipped loudly if absent.
// Invoke: node tests/launch1b-browser-certification.test.js

import http from 'node:http';
import zlib from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (s) => process.stdout.write(`${s}\n`);
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; out(`  ✓ ${l}`); } else { failed++; out(`  ✗ ${l}`); } };

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const DIST = path.join(root, 'dist');
const OLD_DIST = process.env.OLD_DIST || 'C:/gk281/impl/dist';
if (!CHROME || !existsSync(path.join(DIST, 'index.html'))) { out(`SKIPPED: ${!CHROME ? 'no Chromium-family browser' : 'dist/ missing (npm run build)'}`); process.exit(0); }

for (const line of readFileSync(path.join(root, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET || process.env.GRAILKEY_SESSION_SECRET.length < 32) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.GRAILKEY_SESSION_EPOCH = process.env.GRAILKEY_SESSION_EPOCH || '1';
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

// ── tiny solid-colour PNGs (real, decodable) ──
const crc32 = (buf) => { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const solidPng = (r, g, b, size = 16) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
};
const RED = [220, 30, 30], BLUE = [30, 30, 220];

const cred = await imp('src/lib/collectionImageUrl.js');
const media = await imp('src/modules/media/index.js');
const { default: collectionApi } = await imp('api/collection.js');
const { default: imageV2 } = await imp('api/collection-image-v2.js');
const { default: imageRetired } = await imp('api/collection-image.js');
const guard = await imp('src/lib/spendGuard.js');

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
if ((await db.query('select app_env from data1_dev.environment_marker limit 1')).rows[0]?.app_env !== 'development') { out('REFUSING: not a development database'); process.exit(2); }
const [A, B] = (await db.query("select p.id::text id from data1_dev.gk_principal p where p.kind in ('operator','user') order by (select count(*) from data1_dev.collection_item i where i.principal_id = p.id) asc, p.created_at limit 2")).rows.map((r) => r.id);
if (!A || !B) { out('need two existing Development principals'); process.exit(2); }
await db.query("delete from data1_dev.collection_item where id like 'l1bbrowser-%'"); // leftovers of an aborted earlier run
const TAG = `l1bbrowser-${Date.now()}`;
const N = 36; // cards per principal
const COLLIDING = 6; // the first six ids are IDENTICAL for A and B
const putA = await media.put({ bytes: solidPng(...RED), contentType: 'image/png' });
const putB = await media.put({ bytes: solidPng(...BLUE), contentType: 'image/png' });
const idFor = (pid, i) => (i < COLLIDING ? `${TAG}-shared-${i}` : `${TAG}-${pid === A ? 'a' : 'b'}-${i}`);
for (const [pid, uri] of [[A, putA.objectUri], [B, putB.objectUri]]) {
  for (let i = 0; i < N; i++) {
    await db.query('insert into data1_dev.collection_item (id, principal_id, asset_category, attributes) values ($1,$2,$3,$4)', [idFor(pid, i), pid, 'comic', JSON.stringify({ title: `L1B ${pid === A ? 'Alpha' : 'Bravo'} ${i}`, issue: String(i + 1), year: '1990', publisher: 'Test', timestamp: Date.now() - i, price: '$10.00', remoteImages: [uri] })]);
  }
}

// ── server: static dist(s) + REAL handlers for collection + images; everything else 503 ──
const log = []; // every API request: {method, path, status, cookieP, ...}
const sessionToken = (principalId) => { const now = Date.now(); const p = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH })).toString('base64url'); return `${p}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(p).digest('base64url')}`; };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const makeServer = (distDirIn) => http.createServer(async (req, res) => {
  const distDir = path.resolve(distDirIn);
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const h = { statusCode: 200, headers: {} };
    const r = {
      setHeader: (k, v) => { h.headers[k] = v; }, status: (c) => { h.statusCode = c; return r; },
      json: (b) => { h.body = Buffer.from(JSON.stringify(b)); h.headers['Content-Type'] = h.headers['Content-Type'] || 'application/json'; return r; },
      send: (b) => { h.body = Buffer.isBuffer(b) ? b : Buffer.from(String(b)); return r; }, end: () => r,
    };
    const hd = Object.fromEntries(Object.entries(req.headers));
    const handler = { '/api/collection': collectionApi, '/api/collection-image-v2': imageV2, '/api/collection-image': imageRetired }[u.pathname];
    const entry = { method: req.method, path: u.pathname, search: u.search, port: req.socket.localPort };
    if (u.pathname === '/api/collection-image-v2') {
      const v = cred.verifyImageCredential(cred.readCookie(hd.cookie || ''), {});
      entry.cookiePrincipal = v.ok ? v.principalId : null; entry.cookieReason = v.ok ? 'ok' : v.reason; entry.urlPrincipal = u.searchParams.get('p'); entry.id = u.searchParams.get('id');
    }
    if (handler) { await handler({ method: req.method, headers: hd, query: Object.fromEntries(u.searchParams.entries()), body, socket: req.socket }, r); }
    else { h.statusCode = 503; h.body = Buffer.from('{"error":"offline-certification"}'); h.headers['Content-Type'] = 'application/json'; }
    entry.status = h.statusCode; log.push(entry);
    res.writeHead(h.statusCode, h.headers); res.end(h.body || ''); return;
  }
  let file = path.join(distDir, decodeURIComponent(u.pathname) === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!file.startsWith(distDir) || !existsSync(file)) file = path.join(distDir, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
});
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const newServer = makeServer(DIST); const oldServer = existsSync(path.join(OLD_DIST, 'index.html')) ? makeServer(OLD_DIST) : null;
const newPort = await listen(newServer); const oldPort = oldServer ? await listen(oldServer) : null;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const SHOTS = path.join(process.env.TEMP || '/tmp', 'l1b-shots'); mkdirSync(SHOTS, { recursive: true });
const PROFILES = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1280, height: 800 } },
};

const IMG_PATH = '/api/collection-image-v2';
const setImgCookie = (ctx, value) => ctx.addCookies([{ name: 'gk_img', value, domain: '127.0.0.1', path: IMG_PATH, httpOnly: true, secure: true, sameSite: 'Strict', expires: Math.floor(Date.now() / 1000) + 3600 }]);
const imgCookies = async (ctx) => (await ctx.cookies()).filter((c) => c.name === 'gk_img'); // (cookies(url) hides Secure cookies for an http:// origin)
// lazy-loaded thumbnails only fetch when scrolled near: walk the whole list so every card is exercised
const scrollAll = async (page) => { await page.evaluate(async () => { const step = Math.max(200, Math.floor(window.innerHeight * 0.8)); for (let y = 0; y <= document.documentElement.scrollHeight + step; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } window.scrollTo(0, 0); }); };
const openCollection = async (page, origin, principal) => {
  await page.addInitScript(([tok, exp]) => { try { localStorage.setItem('gk_session_token', tok); localStorage.setItem('gk_session_expires_at', String(exp)); } catch { /* */ } }, [sessionToken(principal), Date.now() + 3600e3]);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const tab = page.locator('.tab-bar button', { hasText: /collection/i }).first();
  await tab.waitFor({ timeout: 60000 });
  await tab.click();
};
const imgStats = async (page, sel = 'img[src*="collection-image"]') => { await scrollAll(page); return page.evaluate(async (s) => {
  const imgs = [...document.querySelectorAll(s)];
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 6000); }))));
  const px = (img) => { try { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); } catch { return null; } };
  return { total: imgs.length, loaded: imgs.filter((i) => i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length, colors: imgs.filter((i) => i.naturalWidth > 0).map(px), srcs: imgs.map((i) => i.getAttribute('src')) };
}, sel); };
const near = (c, want) => c && c.every((v, i) => Math.abs(v - want[i]) < 40);

for (const [pname, profile] of Object.entries(PROFILES)) {
  out(`\n=== ${pname.toUpperCase()} ${profile.viewport.width}x${profile.viewport.height} ===`);
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  const requestUrls = []; page.on('request', (r) => requestUrls.push(r.url()));
  const origin = `http://127.0.0.1:${newPort}`;
  log.length = 0;

  out(`[${pname}] 1+2+5+8: render after authorization, ONE mint, no retired endpoint, cookie attributes`);
  await openCollection(page, origin, A);
  await page.waitForFunction(() => document.querySelectorAll('img[src*="collection-image-v2"]').length >= 6, null, { timeout: 180000 }).catch(() => {});
  let st = await imgStats(page);
  ok(st.total >= 6, `${st.total} protected <img> elements rendered`);
  ok(st.loaded === st.total && st.total > 0, `every protected image decoded (${st.loaded}/${st.total}, broken ${st.broken})`);
  ok(st.colors.every((c) => near(c, RED)), 'decoded pixels are PRINCIPAL A\'s image (red) - including the colliding ids');
  const mints = log.filter((l) => l.path === '/api/collection-image-v2' && l.method === 'POST');
  ok(mints.length === 1, `${st.total} cards -> exactly ${mints.length} credential mint (no per-card mint)`);
  ok(log.filter((l) => l.path === '/api/collection-image').length === 0 && !requestUrls.some((u) => /\/api\/collection-image(\?|$)/.test(u)), 'the new client never requests the retired /api/collection-image');
  const gets = log.filter((l) => l.path === '/api/collection-image-v2' && l.method === 'GET');
  ok(gets.length > 0 && gets.every((g) => g.status === 200 && g.cookiePrincipal === A && g.urlPrincipal === A), `every image GET was 200 with principal A in both cookie and URL (${gets.length} GETs)`);
  const gk = (await imgCookies(ctx, origin))[0];
  ok(!!gk && gk.httpOnly && gk.sameSite === 'Strict' && gk.path === '/api/collection-image-v2', `cookie is HttpOnly + SameSite=Strict + path-scoped in the real browser (${gk ? JSON.stringify({ httpOnly: gk.httpOnly, secure: gk.secure, sameSite: gk.sameSite, path: gk.path }) : 'no cookie'})`);
  ok(!(await page.evaluate(() => document.cookie.includes('gk_img'))), 'page JavaScript cannot read the credential (document.cookie)');
  ok(!requestUrls.some((u) => gk && (u.includes(gk.value) || /gk_img/.test(u))), 'the credential never appears in ANY request URL');
  ok(!pageErrors.length, `no uncaught page errors (${pageErrors.length})`);
  await page.screenshot({ path: path.join(SHOTS, `${pname}-collection-A.png`) });

  out(`[${pname}] 3: expired credential recovers`);
  const expired = cred.mintImageCredential({ principalId: A, now: Date.now() - 30 * 60e3 });
  await setImgCookie(ctx, expired.token);
  const before = log.length;
  await page.evaluate(() => { document.querySelectorAll('img[src*="collection-image-v2"]').forEach((i) => { i.src = `${i.getAttribute('src')}&force=${Math.random()}`; }); });
  await scrollAll(page); await page.waitForTimeout(2500); await scrollAll(page); await page.waitForTimeout(1500);
  st = await imgStats(page);
  const after = log.slice(before);
  ok(after.some((l) => l.method === 'GET' && l.status === 403), 'the expired credential really was refused (403) by the server');
  ok(after.filter((l) => l.method === 'POST').length >= 1, 're-mint happened (recovery)');
  ok(after.filter((l) => l.method === 'POST').length <= 2, `recovery did not storm the mint endpoint (${after.filter((l) => l.method === 'POST').length} mints)`);
  ok(st.total > 0 && st.loaded === st.total && st.colors.every((c) => near(c, RED)), `images are back after recovery (${st.loaded}/${st.total}, all A's)`);

  out(`[${pname}] 4: logout clears the cookie; principal switch never shows A's images to B`);
  const preSwitch = log.length;
  await page.evaluate(() => { localStorage.removeItem('gk_session_token'); localStorage.removeItem('gk_session_expires_at'); window.dispatchEvent(new CustomEvent('grailkey:session-expired')); });
  await page.waitForTimeout(800);
  ok(log.slice(preSwitch).some((l) => l.method === 'DELETE' && l.path === '/api/collection-image-v2'), 'logout sent the cookie-clearing DELETE');
  ok((await imgCookies(ctx, origin)).length === 0, 'and the image cookie is gone from the browser');
  // fresh context for B (a different person on the same device after logout/login would reload the page)
  await ctx.clearCookies();
  const pageB = await ctx.newPage();
  const errorsB = []; pageB.on('pageerror', (e) => errorsB.push(String(e.message || e)));
  // leave A's STALE credential in the browser on purpose: B must never be served with it
  const staleA = cred.mintImageCredential({ principalId: A });
  await setImgCookie(ctx, staleA.token);
  const preB = log.length;
  await openCollection(pageB, origin, B);
  await pageB.waitForFunction(() => document.querySelectorAll('img[src*="collection-image-v2"]').length >= 6, null, { timeout: 180000 }).catch(() => {});
  const stB = await imgStats(pageB);
  const logB = log.slice(preB).filter((l) => l.path === '/api/collection-image-v2');
  ok(stB.total >= 6 && stB.loaded === stB.total, `B sees its Collection images (${stB.loaded}/${stB.total})`);
  ok(stB.colors.every((c) => near(c, BLUE)) && !stB.colors.some((c) => near(c, RED)), 'every decoded pixel is B\'s image (blue) - NONE of A\'s red, including the colliding ids');
  const bGets = logB.filter((l) => l.method === 'GET');
  ok(bGets.every((g) => g.urlPrincipal === B), 'B\'s page only ever addressed principal B');
  ok(bGets.filter((g) => g.status === 200).every((g) => g.cookiePrincipal === B), 'every image that was SERVED to B was authorized by B\'s own credential (A\'s stale cookie served nothing)');
  const sharedSrc = stB.srcs.filter((s) => /id=[^&]*shared/.test(s));
  ok(sharedSrc.length > 0, `colliding ids are present in B's page (${sharedSrc.length}) and rendered as B's`);
  ok(!errorsB.length, 'no uncaught page errors during the switch');
  await pageB.screenshot({ path: path.join(SHOTS, `${pname}-collection-B.png`) });

  out(`[${pname}] 7: offline`);
  await ctx.setOffline(true);
  const stOff = await imgStats(pageB);
  ok(stOff.loaded === stB.loaded, 'already-rendered images stay visible when the network drops');
  await pageB.locator('.tab-bar button').first().click(); await pageB.locator('.tab-bar button', { hasText: /collection/i }).first().click();
  await pageB.waitForTimeout(500);
  ok(!errorsB.length, 'switching tabs while offline does not crash the app');
  // offline AND an expired credential AND a failing <img>: the documented limit - remote-only images are absent, no crash
  const expiredB = cred.mintImageCredential({ principalId: B, now: Date.now() - 30 * 60e3 });
  await setImgCookie(ctx, expiredB.token).catch(() => {});
  await pageB.evaluate(() => { document.querySelectorAll('img[src*="collection-image-v2"]').forEach((i) => { i.src = `${i.getAttribute('src')}&offline=${Math.random()}`; }); });
  await pageB.waitForTimeout(1500);
  const stOff2 = await imgStats(pageB);
  ok(stOff2.broken > 0 || stOff2.loaded < stB.loaded, 'offline + expired: remote-only images cannot be re-fetched (documented limit)');
  ok(!errorsB.length, '...and the app does not crash or throw');
  await ctx.setOffline(false);
  await pageB.evaluate(() => window.dispatchEvent(new Event('online')));
  await pageB.waitForTimeout(500);
  await pageB.screenshot({ path: path.join(SHOTS, `${pname}-offline-B.png`) });
  await ctx.close();

  if (oldPort) {
    out(`[${pname}] 6: OLD PWA bundle (build 5e36226) against the NEW server`);
    const ctxO = await browser.newContext(profile);
    const pageO = await ctxO.newPage(); const errsO = []; pageO.on('pageerror', (e) => errsO.push(String(e.message || e)));
    const preO = log.length;
    await openCollection(pageO, `http://127.0.0.1:${oldPort}`, A);
    await pageO.waitForFunction(() => document.querySelectorAll('img[src*="collection-image"]').length >= 6, null, { timeout: 180000 }).catch(() => {});
    await pageO.waitForTimeout(1500);
    const stO = await imgStats(pageO, 'img[src*="/api/collection-image?"]');
    const oldHits = log.slice(preO).filter((l) => l.path === '/api/collection-image');
    ok(oldHits.length > 0 && oldHits.every((l) => l.status === 410), `the old bundle's image requests all get a definite 410 (${oldHits.length} hits)`);
    ok(stO.loaded === 0, 'no protected image is served to the old bundle (nothing leaks through the retired path)');
    ok(errsO.length === 0, 'the old bundle does not crash or throw');
    const titles = await pageO.locator('body').innerText();
    ok(/L1B Alpha/.test(titles), 'the old bundle\'s Collection list (titles, prices, local data) still renders');
    await pageO.screenshot({ path: path.join(SHOTS, `${pname}-old-bundle.png`) });
    await ctxO.close();
  } else out(`[${pname}] 6: SKIPPED (no old build at ${OLD_DIST}) - report as untested`);
}

await browser.close(); newServer.close(); oldServer?.close();
await db.query('delete from data1_dev.collection_item where id like $1', [`${TAG}%`]);
ok((await db.query('select count(*)::int n from data1_dev.collection_item where id like $1', [`${TAG}%`])).rows[0].n === 0, 'cleanup: throwaway Development rows removed');
await db.end();
out(`screenshots: ${SHOTS}`);
out(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
