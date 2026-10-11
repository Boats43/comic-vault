// tests/launch1a-refusal-screen-browser.test.js
//
// GK-L1A v4 - the REAL built app in REAL Chrome (Playwright, locally installed Chrome/Edge), mobile 390x844 and desktop
// 1280x800: the scan-refusal screens.
//   * daily-capacity refusals (principal / shared pool / global): NO "Try again"; an "OK" control; the reset time shown in
//     the VIEWER'S timezone (proved by running the same refusal under two emulated timezones); never "UTC".
//   * configuration refusal: NO "Try again", never implies a reset time, tells the viewer nothing was charged.
//   * a recoverable failure (SPEND_GUARD_UNAVAILABLE): "Try again" is KEPT.
// Only /api/grade is stubbed (it returns the refusal); every other API answers a harmless 503/empty. No provider call, no
// Production call, no database.
//
// Prereq: `npm run build`. Skips loudly if no Chromium-family browser. Invoke: node tests/launch1a-refusal-screen-browser.test.js

import http from 'node:http';
import zlib from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (s) => process.stdout.write(`${s}\n`);
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; out(`  ✓ ${l}`); } else { failed++; out(`  ✗ ${l}`); } };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const DIST = path.join(root, 'dist');
if (!CHROME || !existsSync(path.join(DIST, 'index.html'))) { out(`SKIPPED: ${!CHROME ? 'no Chromium-family browser' : 'dist/ missing (npm run build)'}`); process.exit(0); }

const SECRET = 'r'.repeat(40);
const crc = (b) => { let c, r = ~0; for (let n = 0; n < b.length; n++) { c = (r ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; r = (r >>> 8) ^ c; } return ~r >>> 0; };
const ck = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (w, h) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ck('IHDR', ih), ck('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), ck('IEND', Buffer.alloc(0))]); };
const TMP = path.join(process.env.TEMP || '/tmp', 'l1a-refusal'); mkdirSync(TMP, { recursive: true });
const IMG = path.join(TMP, 'cover.png'); writeFileSync(IMG, png(600, 900));

const RESET = new Date(Date.now() + 5 * 3600e3).toISOString();
const REFUSALS = {
  ordinary: { status: 429, body: { error: 'SPEND_PRINCIPAL_DAILY_CAP', message: 'Daily usage limit reached for this account. It resets at 00:00 UTC.', retryAfter: 3600, resetAt: RESET }, retry: false, re: /used today's allowance/ },
  pool: { status: 429, body: { error: 'SPEND_NONOPERATOR_DAILY_CAP', message: 'GrailKey is at its daily capacity for shared accounts. Please try again after 00:00 UTC.', retryAfter: 3600, resetAt: RESET }, retry: false, re: /shared capacity for today is used up/ },
  global: { status: 429, body: { error: 'SPEND_GLOBAL_DAILY_CAP', message: 'GrailKey is at its daily capacity. Please try again after 00:00 UTC.', retryAfter: 3600, resetAt: RESET }, retry: false, re: /at its daily capacity/ },
  misconfigured: { status: 503, body: { error: 'SPEND_GUARD_MISCONFIGURED', reason: 'absent', message: 'Paid features are paused: usage accounting is not configured correctly on this deployment. Nothing was charged. The operator must fix the spend-guard operator configuration.', retryAfter: 300, resetAt: null }, retry: false, re: /Paid features are paused while GrailKey is being set up/ },
  unavailable: { status: 503, body: { error: 'SPEND_GUARD_UNAVAILABLE', message: 'Usage accounting is temporarily unavailable - please try again shortly.', retryAfter: 30, resetAt: null }, retry: true, re: /temporarily unavailable/ },
};
let current = 'pool';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const chunks = []; for await (const c of req) chunks.push(c); let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* */ }
  if (u.pathname === '/api/grade') { if (body.warmup) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); } const r = REFUSALS[current]; res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify(r.body)); }
  if (u.pathname.startsWith('/api/')) { res.writeHead(u.pathname === '/api/collection' ? 200 : 503, { 'content-type': 'application/json' }); return res.end(u.pathname === '/api/collection' ? '{"items":[]}' : '{}'); }
  let f = path.join(DIST, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)); if (!f.startsWith(DIST) || !existsSync(f)) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${srv.address().port}`;
const token = () => { const n = Date.now(); const p = Buffer.from(JSON.stringify({ principalId: 'refusal-screen-demo', iat: n, exp: n + 3600e3, epoch: '1' })).toString('base64url'); return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`; };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const PROFILES = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};
const scan = async (profile, name, timezoneId = 'America/Los_Angeles') => {
  current = name;
  const ctx = await browser.newContext({ ...profile, locale: 'en-US', timezoneId });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.addInitScript(([t, e]) => { localStorage.setItem('gk_session_token', t); localStorage.setItem('gk_session_expires_at', String(e)); }, [token(), Date.now() + 3600e3]);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.tab-bar button', { hasText: /scan/i }).first().click();
  await page.locator('input[type=file]').first().setInputFiles(IMG);
  await page.locator('.error-card').first().waitFor({ timeout: 30000 });
  const card = page.locator('.error-card').first();
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  const buttons = (await card.locator('button').allInnerTexts()).map((x) => x.trim());
  return { ctx, page, text, buttons, errs };
};

for (const [pname, profile] of Object.entries(PROFILES)) {
  out(`\n=== ${pname.toUpperCase()} ${profile.viewport.width}x${profile.viewport.height} ===`);
  for (const [name, spec] of Object.entries(REFUSALS)) {
    const r = await scan(profile, name);
    ok(spec.re.test(r.text), `[${name}] shows the readable message: "${r.text.slice(0, 110)}"`);
    if (spec.retry) {
      ok(r.buttons.includes('Try again') && !r.buttons.includes('OK'), `[${name}] RECOVERABLE failure keeps "Try again" (${JSON.stringify(r.buttons)})`);
    } else {
      ok(!r.buttons.some((b) => /try again/i.test(b)) && r.buttons.includes('OK'), `[${name}] NO "Try again" - only ${JSON.stringify(r.buttons)}`);
    }
    if (name === 'misconfigured') {
      ok(!/resets|midnight|00:00|UTC|tomorrow|try again/i.test(r.text) && /Nothing was charged/.test(r.text) && /contact the operator/i.test(r.text), `[${name}] never implies a reset time; says nothing was charged; points to the operator`);
    } else if (!spec.retry) {
      ok(/It resets at \w{3}, \d{1,2}:\d{2} (AM|PM) P[SD]T/.test(r.text) && !/UTC/.test(r.text), `[${name}] reset time is in the viewer's timezone (PT) and never says UTC`);
    }
    ok(r.errs.length === 0, `[${name}] no uncaught page errors`);
    if (name === 'pool' || name === 'misconfigured') await r.page.screenshot({ path: path.join(TMP, `${pname}-${name}.png`) });
    if (!spec.retry) { // OK dismisses the card and the screen is usable again
      await r.page.locator('.error-card button', { hasText: /^OK$/ }).first().click();
      ok((await r.page.locator('.error-card').count()) === 0, `[${name}] "OK" dismisses the refusal card`);
    }
    await r.ctx.close();
  }
  // the SAME instant under two timezones proves it is the viewer's own
  const la = await scan(profile, 'ordinary', 'America/Los_Angeles'); const tk = await scan(profile, 'ordinary', 'Asia/Tokyo');
  const grab = (t) => (t.match(/resets at ([^.]+)\./) || [])[1];
  ok(grab(la.text) && grab(tk.text) && grab(la.text) !== grab(tk.text), `the same refusal shows "${grab(la.text)}" for a Los Angeles viewer and "${grab(tk.text)}" for a Tokyo viewer`);
  await la.ctx.close(); await tk.ctx.close();
}
await browser.close(); srv.close();
out(`screenshots: ${TMP}`);
out(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
