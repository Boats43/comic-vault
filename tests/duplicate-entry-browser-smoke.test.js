// tests/duplicate-entry-browser-smoke.test.js — DUPLICATE ENTRY RELEASE CERTIFICATION, panel smoke.
//
// There is no browser/e2e harness in this repo, so this is the CLOSEST real thing without adding a
// framework: it serves the production build in dist/, drives the locally installed headless Chrome/Edge
// over the DevTools protocol (Node's built-in WebSocket), and exercises the REAL app + REAL IndexedDB:
//   - a principal's existing v4 database upgrades to v5 without losing its row
//   - held records render (count, candidate -> SAME COPY, ANOTHER COPY, neutral discard wording)
//   - a reload ("restart") still shows the held items
//   - resolving one held item updates the count, and the removal itself survives a reload
//   - no uncaught exception / React error is raised
// /api/* answers 503 (no server): this smoke proves the CLIENT surface only, never a Production call.
//
// Prereq: `npm run build` (reads dist/). Skips (exit 0, loudly) if no Chromium-family browser is installed.
// Invoke: node tests/duplicate-entry-browser-smoke.test.js

import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
let passed = 0, failed = 0;
const failures = [];
const ok = (cond, label) => { if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; failures.push(label); console.log(`  ✗ ${label}`); } };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
if (!CHROME || !existsSync(path.join(dist, 'index.html'))) {
  console.log(`SKIPPED: ${!CHROME ? 'no Chromium-family browser found' : 'dist/ missing (run npm run build)'}`);
  process.exit(0);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"offline-smoke"}'); return; }
  let file = path.join(dist, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(dist) || !existsSync(file)) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(path.join(tmpdir(), 'cv-smoke-'));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await new Promise((r) => setTimeout(r, 400)); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
const fail = async (e) => { console.log('SMOKE ERROR:', e?.message || e); await cleanup(); process.exit(1); };

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

const ws = new WebSocket(await targetWs().catch(fail));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); }).catch(fail);
let nextId = 0; const pending = new Map(); const exceptions = []; const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
};
const cdp = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result?.result?.value;
};
const waitFor = async (expr, label, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalJs(expr)) return true; } catch { /* page navigating */ } await new Promise((r) => setTimeout(r, 200)); }
  throw new Error(`timed out waiting for: ${label}`);
};
const navigate = async (url) => { await cdp('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 400)); await waitFor('document.readyState === "complete"', 'page load'); };

const PRINCIPAL = 'smoke-principal-1';
const DB_NAME = `comic-vault--p-${encodeURIComponent(PRINCIPAL)}`;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64u({ principalId: PRINCIPAL })}.test-sig`;
const heldRec = (id, title, cands) => ({
  id, v: 1, kind: 'BULK_SCAN', reason: 'CATALOGUE_MATCH', principal: PRINCIPAL, fileName: `${id}.jpg`, createdAt: Date.now(),
  book: { title, issue: '1', year: '1976' }, incoming: { title, issue: '1', year: '1976', assetType: 'comic' },
  image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', entry: null, localMatchIds: ['cv_existing'],
  candidates: cands, candidatesVerified: true, presetId: null, decisionKey: null, lastError: null,
});

try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await navigate(origin + '/');

  // 1. A principal's EXISTING v4 database (the real shape of a phone before this release).
  await evalJs(`new Promise((res, rej) => {
    const q = indexedDB.open(${JSON.stringify(DB_NAME)}, 4);
    q.onupgradeneeded = () => { const d = q.result;
      const s = d.createObjectStore('comics', { keyPath: 'id' }); s.createIndex('timestamp', 'timestamp', { unique: false });
      d.createObjectStore('valueSnapshots', { keyPath: 'date' }); d.createObjectStore('analysisCache', { keyPath: 'key' });
      const f = d.createObjectStore('fixtureBank', { keyPath: 'traceId' }); f.createIndex('capturedAt', 'capturedAt', { unique: false });
      d.createObjectStore('genericCaptureDrafts', { keyPath: 'id' }); };
    q.onsuccess = () => { const tx = q.result.transaction('comics', 'readwrite');
      tx.objectStore('comics').put({ id: 'cv_v4_row', title: 'Existing v4 Comic', issue: '7', year: '1990', timestamp: 1, assetCategory: 'comic', _syncStatus: 'synced' });
      tx.oncomplete = () => { q.result.close(); res(true); }; tx.onerror = () => rej(tx.error); };
    q.onerror = () => rej(q.error); })`);
  await evalJs(`localStorage.setItem('gk_session_token', ${JSON.stringify(TOKEN)}); localStorage.setItem('gk_session_expires_at', String(Date.now() + 3600000)); true`);

  // 2. App boots authenticated -> upgrades the DB to v5.
  await navigate(origin + '/');
  await waitFor(`(async () => { const dbs = await indexedDB.databases(); return dbs.some(d => d.name === ${JSON.stringify(DB_NAME)} && d.version === 5); })()`, 'DB v5');
  console.log('\nApp start + DB upgrade:');
  const info = await evalJs(`new Promise((res) => { const q = indexedDB.open(${JSON.stringify(DB_NAME)}); q.onsuccess = () => { const d = q.result;
    const names = Array.from(d.objectStoreNames); const v = d.version;
    const tx = d.transaction('comics', 'readonly'); const g = tx.objectStore('comics').getAll();
    g.onsuccess = () => { const ids = g.result.map(x => x.id); d.close(); res({ v, names, ids }); }; }; })`);
  ok(info.v === 5, 'the real app opened the principal\'s database at v5');
  ok(info.names.includes('copyReviewHeld'), 'the copyReviewHeld store exists after the upgrade');
  ok(info.ids.includes('cv_v4_row'), 'the existing v4 catalogue row survived the upgrade');

  // 3. Seed two held records (one with a server candidate, one verified-zero), reload as a "restart".
  await evalJs(`new Promise((res, rej) => { const q = indexedDB.open(${JSON.stringify(DB_NAME)}); q.onsuccess = () => { const d = q.result;
    const tx = d.transaction('copyReviewHeld', 'readwrite'); const st = tx.objectStore('copyReviewHeld');
    st.put(${JSON.stringify(heldRec('held_smoke_1', 'Howard the Duck', [{ gkAssetId: 'gk-A', collectionItemId: 'cv_A', title: 'Howard the Duck', issue: '1', year: '1976', grade: 'VG 4.0' }]))});
    st.put(${JSON.stringify(heldRec('held_smoke_2', 'Batman', []))});
    tx.oncomplete = () => { d.close(); res(true); }; tx.onerror = () => rej(tx.error); }; })`);
  await navigate(origin + '/');
  await waitFor(`document.body.innerText.includes('held for copy review')`, 'held panel');
  const text = () => evalJs('document.body.innerText');
  console.log('\nHeld-review panel render:');
  let t = await text();
  ok(/2 items held for copy review/.test(t), 'held count renders: "2 items held for copy review"');
  ok(t.includes('Howard the Duck #1 (1976)') && t.includes('Batman #1 (1976)'), 'each held record renders its book');
  const buttons = await evalJs(`Array.from(document.querySelectorAll('[data-testid="copy-review-panel"] button')).map(b => b.textContent.trim())`);
  ok(buttons.includes('Same Copy'), 'SAME COPY control renders for the server candidate');
  ok(buttons.filter((b) => b === 'Another Copy').length === 2, 'ANOTHER COPY control renders on every held item');
  ok(buttons.filter((b) => b === 'Discard this item').length === 1, 'neutral "Discard this item" renders ONLY for the verified-zero-candidate record');
  ok(!buttons.some((b) => /same book/i.test(b)), 'the misleading "Same book — discard" wording is gone');

  console.log('\nRefresh / restart persistence:');
  await navigate(origin + '/');
  await waitFor(`document.body.innerText.includes('held for copy review')`, 'held panel after reload');
  t = await text();
  ok(/2 items held for copy review/.test(t), 'after a reload the 2 held items are still there');

  console.log('\nResolving one item:');
  await evalJs(`(() => { const b = Array.from(document.querySelectorAll('[data-testid="copy-review-panel"] button')).find(x => x.textContent.trim() === 'Discard this item'); b.click(); return true; })()`);
  await waitFor(`document.body.innerText.includes('1 item held for copy review')`, 'count -> 1');
  t = await text();
  ok(/1 item held for copy review/.test(t) && !t.includes('Batman #1 (1976)'), 'explicit discard removed that one item; count updated to 1');
  await navigate(origin + '/');
  await waitFor(`document.body.innerText.includes('held for copy review')`, 'panel after second reload');
  t = await text();
  ok(/1 item held for copy review/.test(t) && t.includes('Howard the Duck #1 (1976)'), 'the removal is durable and the unresolved item is still held after another reload');
  const rowStill = await evalJs(`new Promise((res) => { const q = indexedDB.open(${JSON.stringify(DB_NAME)}); q.onsuccess = () => { const d = q.result; const g = d.transaction('comics').objectStore('comics').getAll(); g.onsuccess = () => { d.close(); res(g.result.map(x => x.id)); }; }; })`);
  ok(rowStill.includes('cv_v4_row'), 'the original catalogue row is still intact after all of that');

  console.log('\nRuntime health:');
  const reactish = [...exceptions, ...consoleErrors].filter((e) => /React|hook|Hooks|Rendered (more|fewer)|Minified|Uncaught|TypeError|ReferenceError/i.test(String(e)));
  ok(exceptions.length === 0, `no uncaught page exception (${exceptions.length})`);
  ok(reactish.length === 0, `no React hook/order/render error in the console (${reactish.length})`);
  if (reactish.length) console.log('   ', reactish.slice(0, 3));
} catch (e) {
  await fail(e);
}
await cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log(failures.join('\n'));
process.exit(failed ? 1 : 0);
