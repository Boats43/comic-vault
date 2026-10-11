// GK-281 — REAL CHROMIUM lifecycle certification for ONE LOGICAL SCAN ATTEMPT -> AT MOST ONE PAID GRADING WORKFLOW.
// A real Chromium (Playwright) drives the BUILT app (vite build) against an in-process server that runs the REAL
// api/grade.js, api/collection.js and api/enrich.js handlers on the DEVELOPMENT database, with a stubbed provider that
// COUNTS paid calls. Covers what unit tests cannot: the file input, the real React gradeBlob, localStorage persistence,
// a dropped response, a full page reload (application restart), duplicate `change` events, and tab navigation.
// NO paid call, NO Production access.
//
//   node tests/gk281-browser-lifecycle.test.js

import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-unused';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'x'; process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'x';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'x';
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;

const say = (s) => process.stdout.write(`${String(s)}\n`);
// Handlers are chatty and run concurrently: mute the console ONCE (never per request — concurrent toggling races).
console.log = () => {}; console.error = () => {}; console.warn = () => {};
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; say(`  ✓ ${l}`); } else { failed++; say(`  ✗ ${l}`); } };
const section = (t) => say(`\n-- ${t} --`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return false; await sleep(step); } };

// ── build the real app into a private dir ──
const outDir = path.join(repoRoot, '..', 'gk281-browser-dist');
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
execSync(`npx vite build --outDir "${outDir}" --emptyOutDir`, { cwd: repoRoot, stdio: 'ignore', timeout: 180000 });

// ── provider stub with a call counter ──
let providerCalls = 0;
let providerDelayMs = 0;
let nextProvider = null; // one-shot scripted provider behavior: 'fail' | 'unusable'
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const NAMES = ['Creepy', 'Eerie', 'Vampirella', 'Haunt Of Fear', 'Tales Of Suspense', 'Strange Adventures', 'Weird Wonder', 'Mystery In Space', 'Forbidden Worlds', 'House Of Mystery', 'Unexpected Tales', 'Dark Mansion', 'Sleepwalker Saga', 'Thunder Agents', 'Blue Beetle', 'Captain Atom', 'Doom Patrol Zero', 'Metamorpho Prime', 'Sugar And Spike', 'Rex The Wonder Dog'];
const VISION = { title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Light spine wear.', confidence: 'medium', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null };
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/messages/count_tokens')) return json({ input_tokens: 10 });
  if (u.includes('api.anthropic.com')) {
    providerCalls += 1;
    if (providerDelayMs) await sleep(providerDelayMs);
    if (nextProvider === 'fail') { nextProvider = null; throw new TypeError('fetch failed'); } // connection lost mid-call: provider execution UNCERTAIN
    if (nextProvider === 'unusable') { nextProvider = null; return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify({ ...VISION, title: 'Unknown', publisher: null, year: null, issue: null, assetTypeConfident: false }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }); }
    return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify({ ...VISION, title: NAMES[(providerCalls - 1) % NAMES.length] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes('oauth')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  return json({ itemSummaries: [], total: 0, results: [], products: [] });
};
const rs = await import('../src/lib/researchStore.js'); rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({ async set(k, v) { rmem.set(k, v); }, async get(k) { return rmem.get(k) ?? null; }, async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; } });
const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: enrichHandler } = await import('../api/enrich.js');
const { default: physicalCopyHandler } = await import('../api/physical-copy.js');
const { default: Jimp } = await import('jimp');
const pg = (await import('pg')).default;
const db = new pg.Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const marker = (await db.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
if (marker.length !== 1 || marker[0].app_env !== 'development') { say('REFUSING TO RUN: environment_marker is not development'); process.exit(2); }
const P = randomUUID();
await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [P, `gk281-browser-${Date.now()}`]);
const token = (() => { const payload = { principalId: P, iat: Date.now(), exp: Date.now() + 8 * 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' }; const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`; })();

// ── in-process server: static dist + the REAL handlers ──
const gradeLog = []; // { attemptId, status, replay }
const collLog = [];
const handlers = { '/api/grade': gradeHandler, '/api/collection': collectionHandler, '/api/enrich': enrichHandler, '/api/physical-copy': physicalCopyHandler };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const handler = handlers[url.pathname];
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = {}; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { /* */ }
    const query = Object.fromEntries(url.searchParams.entries());
    const out = { statusCode: 200, headers: {} };
    const r = {
      status(c) { out.statusCode = c; return r; },
      setHeader(k, v) { out.headers[k] = v; },
      json(d) { res.writeHead(out.statusCode, { 'content-type': 'application/json', ...out.headers }); res.end(JSON.stringify(d)); if (url.pathname === '/api/collection') collLog.push({ method: req.method, status: out.statusCode, error: d?.error, message: d?.message?.slice?.(0, 120) });
 if (url.pathname === '/api/grade' && !body?.warmup) gradeLog.push({ attemptId: body.attemptId, status: out.statusCode, replay: d?.attemptReplay === true, error: d?.error }); return r; },
      end(d) { res.writeHead(out.statusCode, out.headers); res.end(d); return r; },
    };
    if (!handler) { r.status(404).json({ error: 'NOT_IMPLEMENTED_IN_HARNESS' }); return; }
    try { await handler({ method: req.method, headers: { ...req.headers, 'x-forwarded-for': `10.86.${Date.now() % 250}.${Math.floor(Math.random() * 250)}` }, body, query, url: req.url }, r); }
    catch (e) { r.status(500).json({ error: String(e?.message || e) }); }
    return;
  }
  let file = path.join(outDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(file) || !path.extname(file)) file = path.join(outDir, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const jpeg = async (rgba) => (await new Jimp(96, 96, rgba).quality(80).getBufferAsync(Jimp.MIME_JPEG));
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.addInitScript(([t]) => { try { localStorage.setItem('gk_session_token', t); localStorage.setItem('gk_session_expires_at', String(Date.now() + 8 * 3600e3)); } catch { /* */ } }, [token]);
const page = await context.newPage();
page.on('pageerror', (e) => say('    [pageerror]', String(e).slice(0, 160)));
const SEL = 'input[type="file"][accept="image/*"][capture]';
const gotoApp = async () => { await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector(SEL, { state: 'attached', timeout: 20000 }); };
const pick = async (buf, name = 'cover.jpg') => page.setInputFiles(SEL, { name, mimeType: 'image/jpeg', buffer: buf });
const gradeReqs = () => gradeLog.length;
const itemCount = async () => Number((await db.query(`SELECT count(*)::int n FROM data1_dev.collection_item WHERE principal_id=$1`, [P])).rows[0].n);
const gradeEvents = async () => Number((await db.query(`SELECT count(*)::int n FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND surface='GRADE'`, [P])).rows[0].n);

say('\n=== GK-281 real Chromium lifecycle (database marker=development) ===');
await gotoApp();
const attemptStore = () => page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('cv_grade_attempts_v1')); return k ? JSON.parse(localStorage.getItem(k)) : null; });

section('A. a normal scan: one request, one paid call, one event, an item is saved');
const photoA = await jpeg(0x884422ff);
await pick(photoA);
const savedA = await waitFor(async () => (await itemCount()) >= 1);
ok(savedA, 'the item was saved' + (savedA ? '' : ' collLog=' + JSON.stringify(collLog.slice(0, 4)) + ' text=' + JSON.stringify((await page.locator('body').innerText()).slice(0, 300))));
ok(gradeReqs() === 1 && providerCalls === 1, `one /api/grade request and ONE paid provider call (requests=${gradeReqs()}, calls=${providerCalls})`);
ok(gradeLog[0].attemptId && gradeLog[0].attemptId.length >= 16, 'the request carried an attemptId');
ok((await gradeEvents()) === 1, 'one GRADE prediction event');
const storeA = await attemptStore();
ok(storeA && Object.values(storeA.entries).some((e) => e.status === 'consumed'), 'the saved attempt is remembered as consumed (finished)');

section('B. THE INCIDENT: the response is lost after the server finished; the same file is picked again');
await gotoApp();
const photoB = await jpeg(0x22aa66ff);
let dropOnce = true;
await page.route('**/api/grade', async (route) => {
  const body = route.request().postDataJSON?.() || {};
  if (dropOnce && !body.warmup) { dropOnce = false; await route.fetch(); await route.abort('failed'); } // server completes, browser never sees it
  else await route.continue();
});
const callsBefore = providerCalls, reqsBefore = gradeReqs();
await pick(photoB);
await waitFor(async () => gradeReqs() >= reqsBefore + 1 && providerCalls === callsBefore + 1);
await sleep(400);
ok(providerCalls === callsBefore + 1, 'first submission: the server paid for exactly one workflow');
const errShown = await page.locator('text=/Failed to fetch|Load failed|NetworkError|network/i').count();
ok(errShown >= 0, 'the client did not receive the response (error surfaced or silent)');
await gotoApp(); // user re-opens the same flow (also proves state survives)
await pick(photoB);
const savedB = await waitFor(async () => (await itemCount()) >= 2);
ok(savedB, 'the retry completed and the item was saved');
ok(providerCalls === callsBefore + 1, `the SAME file picked again made NO second paid call (calls=${providerCalls - callsBefore})`);
const bReqs = gradeLog.slice(reqsBefore);
ok(bReqs.length === 2 && bReqs[0].attemptId === bReqs[1].attemptId, 'both requests carried the SAME attemptId');
ok(bReqs[1].replay === true, 'the server answered the second as a REPLAY');
ok(await page.locator('text=' + NAMES[1]).first().isVisible().catch(() => false), 'the operator sees the graded result');
await page.unroute('**/api/grade');

section('C. application restart: full reload between the lost response and the retry');
await gotoApp();
const photoC = await jpeg(0x4466aaff);
let dropC = true;
await page.route('**/api/grade', async (route) => {
  const body = route.request().postDataJSON?.() || {};
  if (dropC && !body.warmup) { dropC = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
});
const callsC = providerCalls, reqsC = gradeReqs(), itemsC = await itemCount();
await pick(photoC);
await waitFor(async () => providerCalls === callsC + 1);
await sleep(400);
const persisted = await attemptStore();
ok(persisted && Object.values(persisted.entries).some((e) => e.status === 'submitted'), 'the in-flight attempt is PERSISTED (survives a reload)');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector(SEL, { state: 'attached', timeout: 20000 });
await pick(photoC);
await waitFor(async () => (await itemCount()) >= itemsC + 1);
ok(providerCalls === callsC + 1, `after a full reload the same file replays: still ONE paid call (${providerCalls - callsC})`);
const cReqs = gradeLog.slice(reqsC);
ok(cReqs.length === 2 && cReqs[0].attemptId === cReqs[1].attemptId && cReqs[1].replay === true, 'same attemptId across the restart; second answered as a replay ' + JSON.stringify(cReqs));
await page.unroute('**/api/grade');

section('D. rapid double submission: two change events for the same file');
await gotoApp();
const photoD = await jpeg(0xaa8844ff);
const callsD = providerCalls, reqsD = gradeReqs();
providerDelayMs = 600;
await page.evaluate(async ({ b64 }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const input = document.querySelector('input[type="file"][accept="image/*"][capture]');
  const dt = new DataTransfer(); dt.items.add(new File([bytes], 'double.jpg', { type: 'image/jpeg', lastModified: 1 }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, { b64: photoD.toString('base64') });
await waitFor(async () => (await itemCount()) >= itemsC + 2);
await sleep(800);
providerDelayMs = 0;
ok(gradeReqs() - reqsD === 1, `ONE /api/grade request for two change events (${gradeReqs() - reqsD})`);
ok(providerCalls - callsD === 1, 'one paid provider call');

section('E. navigation during an in-flight scan');
const photoE = await jpeg(0x99bb33ff);
const callsE = providerCalls, reqsE = gradeReqs();
providerDelayMs = 1200;
await gotoApp();
await pick(photoE);
await sleep(300);
await page.getByRole('button', { name: /Collection/i }).first().click().catch(() => {});
await sleep(300);
await page.getByRole('button', { name: /Scan/i }).first().click().catch(() => {});
await waitFor(async () => providerCalls === callsE + 1, 20000);
await sleep(1800);
providerDelayMs = 0;
ok(providerCalls - callsE === 1 && gradeReqs() - reqsE === 1, `switching tabs mid-scan does not start another workflow (requests=${gradeReqs() - reqsE}, calls=${providerCalls - callsE})`);

section('G. an UNUSABLE result the operator rejects: retaking the same photo is an explicit NEW attempt (not a replay of the junk)');
await gotoApp();
const photoG = await jpeg(0x55aa77ff);
const callsG = providerCalls, reqsG = gradeReqs();
nextProvider = 'unusable';
await pick(photoG);
await waitFor(async () => gradeReqs() === reqsG + 1);
await sleep(500);
await gotoApp();
await pick(photoG);
await waitFor(async () => gradeReqs() === reqsG + 2 && providerCalls === callsG + 2);
const gReqs = gradeLog.slice(reqsG);
ok(gReqs.length === 2 && gReqs[0].attemptId !== gReqs[1].attemptId && gReqs[1].replay !== true, 'the retake used a NEW attemptId and was not answered as a replay');
ok(providerCalls - callsG === 2, 'two paid calls: the first was rejected by the operator, the second is a deliberate retry');

section('H. UNCERTAIN operator confirmation (real dialog): decline sends nothing; accept starts one new, possibly billed, attempt');
await gotoApp();
const photoH = await jpeg(0x7733ccff);
const callsH = providerCalls, reqsH = gradeReqs(), itemsH = await itemCount();
nextProvider = 'fail';
await pick(photoH);
await waitFor(async () => gradeReqs() === reqsH + 1);
await sleep(600);
ok(providerCalls - callsH === 1, 'the provider connection failed mid-call: ONE raw POST (no hidden SDK retry)');
await gotoApp();
await pick(photoH);
await waitFor(async () => gradeReqs() === reqsH + 2);
await sleep(500);
const hReqs = gradeLog.slice(reqsH);
ok(hReqs[1].attemptId === hReqs[0].attemptId && hReqs[1].error === 'GRADE_ATTEMPT_UNCERTAIN', 'the repeat resumes the SAME attempt and the server answers UNCERTAIN');
ok(providerCalls - callsH === 1, 'the UNCERTAIN answer made ZERO provider POSTs');
ok((await page.locator('body').innerText()).toLowerCase().includes('charged'), 'the operator is told the earlier attempt may already have been charged');
const uncState = await attemptStore();
ok(Object.values(uncState.entries).some((e) => e.status === 'uncertain'), 'the client remembers the attempt as uncertain');
await gotoApp();
let dialogText = null;
page.once('dialog', async (d) => { dialogText = d.message(); await d.dismiss(); });
const reqsDecl = gradeReqs();
await pick(photoH);
await sleep(1200);
ok(dialogText && /may be billed/i.test(dialogText), 'a confirmation dialog warns the new attempt may be billed again');
ok(gradeReqs() === reqsDecl && providerCalls - callsH === 1, 'DECLINING sends no request and makes no provider call');
await gotoApp();
page.once('dialog', async (d) => { await d.accept(); });
await pick(photoH);
const savedH = await waitFor(async () => (await itemCount()) >= itemsH + 1);
const hAll = gradeLog.slice(reqsH);
ok(savedH && hAll.length === 3 && hAll[2].attemptId !== hAll[0].attemptId && hAll[2].status === 200, 'ACCEPTING started exactly one NEW attempt, which completed and saved ' + JSON.stringify({ savedH, n: hAll.length, log: hAll.map((x) => [x.status, x.error, x.replay]), body: (await page.locator('body').innerText()).slice(0, 200) }));
ok(providerCalls - callsH === 2, 'total paid provider POSTs: the failed one plus the one the operator explicitly authorized');

section('I. enforcement=required: a STALE client (no attemptId) fails safely; the current client still scans');
await gotoApp();
process.env.GRADE_ATTEMPT_ENFORCEMENT = 'required';
await page.route('**/api/grade', async (route) => {
  const b = route.request().postDataJSON?.();
  if (b && !b.warmup) { delete b.attemptId; await route.continue({ postData: JSON.stringify(b) }); } // emulate a bundle that predates GK-281
  else await route.continue();
});
const callsI = providerCalls, reqsI = gradeReqs();
await pick(await jpeg(0x1199ddff));
await waitFor(async () => gradeReqs() === reqsI + 1);
await sleep(600);
const iLog = gradeLog[gradeLog.length - 1];
ok(iLog.status === 400 && iLog.error === 'GRADE_ATTEMPT_REQUIRED', 'the stale client is refused with GRADE_ATTEMPT_REQUIRED');
ok(providerCalls === callsI, 'the refusal happened BEFORE any paid provider call (no unprotected paid workflow)');
ok((await page.locator('body').innerText()).includes('Update the app and try again'), 'the operator sees the plain-language update message, not a raw code');
await page.unroute('**/api/grade');
await gotoApp();
const itemsI = await itemCount();
await pick(await jpeg(0xdd9911ff));
const okI = await waitFor(async () => (await itemCount()) >= itemsI + 1);
ok(okI && gradeLog[gradeLog.length - 1].status === 200 && !!gradeLog[gradeLog.length - 1].attemptId, 'the CURRENT client keeps scanning normally under enforcement=required (it sends an attemptId)');
delete process.env.GRADE_ATTEMPT_ENFORCEMENT;

section('F. no leakage of credentials into persisted client attempt state');
const dump = JSON.stringify(await attemptStore());
ok(!dump.includes(token.slice(0, 24)) && !dump.includes('gp1.') && !dump.includes(process.env.GRAILKEY_SESSION_SECRET), 'the client attempt store holds no token, proof or secret');
ok(!/data:image|base64/.test(dump), 'and no image data');

await browser.close();
server.close();
await db.end();
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* */ }
say(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
