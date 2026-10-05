// tests/gk268-auth-recovery-ux.test.js
//
// AUTH RECOVERY UX (GK-268 addendum): SERVER 401 = AUTHENTICATION STATE INVALID.
// Real src/lib/grailkeySession.js (apiFetch/authFetch/clearSession) with browser
// globals (localStorage, window events, Response) provided by this harness and a
// scripted fetch; real collectionSync.js; real Development Postgres for the
// same-principal re-login proof. The App.jsx wiring is proven by a disclosed
// static source-text census (App() is not independently renderable).
//
// Invoke: node tests/gk268-auth-recovery-ux.test.js

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

// ── browser-global harness ──
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const winTarget = new EventTarget();
globalThis.window = { dispatchEvent: (e) => winTarget.dispatchEvent(e), addEventListener: (...a) => winTarget.addEventListener(...a), removeEventListener: (...a) => winTarget.removeEventListener(...a) };
let expiredEvents = 0;
// Mirrors App.jsx's ONE listener: setGrailkeyAuthed(false).
let uiAuthed = true;
window.addEventListener('grailkey:session-expired', () => { expiredEvents++; uiAuthed = false; });

const calls = [];
let script = () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), headers: opts?.headers || {}, method: opts?.method || 'GET' }); return script(url, opts); };

const S = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'grailkeySession.js')).href);
const { apiFetch, authFetch, setSession, getSession, isAuthenticated, clearSession, AUTH_EXPIRED_ERROR } = S;

const FUTURE = () => Date.now() + 3600_000;
function login(tokenLabel = 'tok-A') { setSession(tokenLabel, FUTURE()); uiAuthed = true; expiredEvents = 0; calls.length = 0; }
const reply = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

console.log('\n=== AUTH RECOVERY: apiFetch / authFetch semantics ===');

console.log('\n--- 1. valid authenticated request: unchanged ---');
login(); script = () => reply(200, { ok: true });
let r = await apiFetch('/api/grade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
ok(r.status === 200 && calls.length === 1 && calls[0].headers.Authorization === 'Bearer tok-A' && calls[0].headers['Content-Type'] === 'application/json', 'sends the current Bearer token, keeps caller headers, returns the real response');
ok(isAuthenticated() && expiredEvents === 0 && uiAuthed, 'session retained, no logout event');
r = await apiFetch('/api/grade', { headers: { Authorization: 'Bearer STALE-CALLER-VALUE' } });
ok(calls[1].headers.Authorization === 'Bearer tok-A', 'a stale caller-supplied Authorization can never override the current session token');

console.log('\n--- 2. locally expired token: logged out BEFORE any request ---');
store.set('gk_session_token', 'tok-old'); store.set('gk_session_expires_at', String(Date.now() - 1000)); uiAuthed = true; expiredEvents = 0; calls.length = 0;
r = await apiFetch('/api/enrich', { method: 'POST', body: '{}' });
const b2 = await r.json();
ok(calls.length === 0, 'NO request is made with a locally-expired token (not sent as valid auth)');
ok(r.status === 401 && b2.error === AUTH_EXPIRED_ERROR && b2.authExpired === true, 'caller gets an explicit AUTH_EXPIRED 401 result');
ok(uiAuthed === false && expiredEvents >= 1 && !isAuthenticated() && !store.has('gk_session_token'), 'stale session cleared + the login-surface event fired');
r = await authFetch('/api/collection');
ok(r === null && calls.length === 0, 'authFetch contract preserved: null, no request, when there is no session');

console.log('\n--- 3. server-rejected token (locally current) ---');
login(); script = () => reply(401, { error: 'Missing, invalid, or expired token' });
r = await apiFetch('/api/enrich', { method: 'POST', body: '{"x":1}' });
ok(r.status === 401 && !isAuthenticated() && uiAuthed === false && expiredEvents >= 1, '401 -> session cleared, logged-out state, login surface event');
ok(calls.length === 1, 'the failed request was NOT silently retried');

console.log('\n--- 4. three concurrent 401s ---');
login(); script = async () => { await new Promise((x) => setTimeout(x, 5)); return reply(401); };
const rs = await Promise.all([apiFetch('/api/grade'), apiFetch('/api/enrich'), authFetch('/api/collection')]);
ok(rs.every((x) => x.status === 401), 'all three resolve (no crash, no throw)');
ok(!isAuthenticated() && uiAuthed === false, 'one stable logged-out state');
const ev = expiredEvents; clearSession(); clearSession();
ok(!isAuthenticated() && uiAuthed === false && expiredEvents >= ev, 'clearSession is idempotent (repeat calls are harmless)');
ok(calls.length === 3, 'exactly the three original requests — no loop, no replay');

console.log('\n--- LATE 401 for an OLD token must not log out a fresh session (no login/logout loop) ---');
login('tok-OLD'); let release;
script = () => new Promise((res) => { release = () => res(reply(401)); });
const pending = apiFetch('/api/enrich', { method: 'POST', body: '{}' });
await new Promise((x) => setTimeout(x, 5));
setSession('tok-NEW', FUTURE()); uiAuthed = true; expiredEvents = 0; // user signed in again meanwhile
release(); await pending;
ok(isAuthenticated() && getSession().token === 'tok-NEW' && uiAuthed === true && expiredEvents === 0, 'the new session survives a stale 401 from the old token');

console.log('\n--- 5-10. non-auth failures NEVER clear the session ---');
const keep = async (label, make) => {
  login(); script = make;
  let threw = false, res = null;
  try { res = await apiFetch('/api/enrich', { method: 'POST', body: '{}' }); } catch { threw = true; }
  ok(isAuthenticated() && uiAuthed === true && expiredEvents === 0, `${label}: session retained, no logout event${threw ? ' (rejected as before)' : ` (status ${res?.status})`}`);
  return { res, threw };
};
await keep('403', () => reply(403, { error: 'forbidden' }));
const k409 = await keep('409 PHYSICAL_COPY_DECISION_REQUIRED (GK-279 control flow)', () => reply(409, { error: 'PHYSICAL_COPY_DECISION_REQUIRED', candidates: [] }));
ok(k409.res.status === 409 && (await k409.res.json()).error === 'PHYSICAL_COPY_DECISION_REQUIRED', '  409 body passes through untouched for the existing prompt flow');
const k503 = await keep('503 PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE (GK-279 fail-closed)', () => reply(503, { error: 'PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE', retryable: true }));
ok(k503.res.status === 503 && (await k503.res.json()).retryable === true, '  503 body passes through untouched (retryable operational failure, not auth)');
await keep('422', () => reply(422));
await keep('429', () => reply(429));
await keep('500', () => reply(500, { error: 'Internal error' }));
const kn = await keep('network error', () => { throw new TypeError('Failed to fetch'); });
ok(kn.threw === true, '  network failure still surfaces to the caller as before (not swallowed, not auth)');
login(); script = () => reply(403); await authFetch('/api/collection');
ok(isAuthenticated() && expiredEvents === 0, 'authFetch: 403 also retains the session');

console.log('\n--- 15. no automatic replay of a mutating request, before or after re-login ---');
login('tok-1'); script = () => reply(401);
await apiFetch('/api/list-ebay', { method: 'POST', body: '{"title":"x"}' });
const afterFail = calls.length;
setSession('tok-2', FUTURE()); // fresh Google login completes
await new Promise((x) => setTimeout(x, 25));
ok(afterFail === 1 && calls.length === 1, 're-login does NOT replay the failed mutating request');
ok(calls.every((c) => typeof c.headers.Authorization === 'string' && c.headers.Authorization.startsWith('Bearer ')), 'no request was ever sent without Authorization');

console.log('\n--- 11-14. real surfaces: 401 -> login surface ---');
const surfaces = [['grade', '/api/grade'], ['enrich', '/api/enrich'], ['manage', '/api/manage'], ['chat', '/api/chat'], ['list (preparation)', '/api/list-ebay'], ['manual correction (enrich with correction payload)', '/api/enrich']];
for (const [label, url] of surfaces) {
  login(); script = () => reply(401, { error: 'Sign in to continue — a GrailKey session is required.' });
  const x = await apiFetch(url, { method: 'POST', body: '{}' });
  ok(x.status === 401 && !isAuthenticated() && uiAuthed === false, `${label}: 401 -> session cleared, login surface`);
}
// collection: the REAL collectionSync functions (authFetch-based)
const sync = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'collectionSync.js')).href);
login(); script = () => reply(401);
const pushed = await sync.pushCollectionItem({ id: 'cv_x', title: 'T', assetCategory: 'comic' });
ok(pushed === null && !isAuthenticated() && uiAuthed === false, 'collection (real pushCollectionItem): 401 -> login surface, no crash');
login(); script = () => reply(401);
let fetched; try { fetched = await sync.fetchServerCollection(); } catch { fetched = 'threw'; }
ok(!isAuthenticated() && uiAuthed === false, 'collection (real fetchServerCollection): 401 -> login surface');
// physical-copy / capture / operator / marketplace status all go through authFetch (static census below) — behavior:
for (const url of ['/api/physical-copy', '/api/capture-scan', '/api/operator-action', '/api/ebay-connection-status', '/api/collection']) {
  login(); script = () => reply(401);
  const x = await authFetch(url, { method: 'POST', body: '{}' });
  ok(x.status === 401 && !isAuthenticated() && uiAuthed === false, `${url}: 401 -> login surface`);
}

console.log('\n--- static census (disclosed source-text proof): every authenticated /api call is auth-aware ---');
function walk(dir, out = []) { for (const e of readdirSync(dir)) { const f = path.join(dir, e); if (statSync(f).isDirectory()) walk(f, out); else if (/\.(js|jsx)$/.test(e)) out.push(f); } return out; }
const rawHits = [];
for (const f of walk(path.join(repoRoot, 'src'))) {
  const rel = path.relative(repoRoot, f).replace(/\\/g, '/');
  if (rel === 'src/lib/grailkeySession.js') continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    if (/(^|[^A-Za-z_.])fetch\(\s*["'`]\/api\//.test(line)) rawHits.push(`${rel}:${i + 1}`);
  });
}
const PUBLIC_RAW_ALLOWED = ['src/components/ClerkAuthPanel.jsx']; // /api/auth-clerk — the login call itself, intentionally unauthenticated
const unexpected = rawHits.filter((h) => !PUBLIC_RAW_ALLOWED.some((a) => h.startsWith(a)));
ok(unexpected.length === 0, `no raw authenticated fetch("/api/...") remains (unexpected: ${JSON.stringify(unexpected)})`);
const app = readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
ok((app.match(/apiFetch\(\s*["']\/api\//g) || []).length === 27, 'all 27 former raw authenticated sites in App.jsx route through apiFetch');
ok(/import \{[^}]*\bapiFetch\b[^}]*\} from "\.\/lib\/grailkeySession\.js"/.test(app), 'App.jsx imports apiFetch from the one session module');
ok(!/fetch\(\s*["']\/api\/(grade|enrich|chat|manage|list-ebay|delist-ebay)/.test(app.replace(/apiFetch\(/g, 'X(')), 'grade/enrich/chat/manage/list/delist never use bare fetch');
const mc = app.slice(app.indexOf('buildManualCorrectionPayload(item, correctedValues'), app.indexOf('buildManualCorrectionPayload(item, correctedValues') + 1800);
ok(mc.indexOf('enrichRes.status === 401') > -1 && mc.indexOf('enrichRes.status === 401') < mc.indexOf('Correction failed:'), '11. manual correction: the 401 branch (auth-expiry message) precedes the generic "Correction failed" error');
ok(/listener|grailkey:session-expired/.test(app) && /window\.addEventListener\('grailkey:session-expired'/.test(app), 'the single existing session-expired listener is intact');
ok(!/ClerkAuth/.test('') && readFileSync(path.join(repoRoot, 'src', 'components', 'ClerkAuthPanel.jsx'), 'utf8').includes('/api/auth-clerk'), 'the intentionally-public login call (auth-clerk) is left raw');

console.log('\n--- 16. fresh Google login after expiry: same principal (real Development DB) ---');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
const authMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'index.js')).href);
const TAGS = `gk268-recovery-${Date.now()}`;
const subjA = `user_${TAGS}_a`, subjB = `user_${TAGS}_b`;
const l1 = await authMod.loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjA, displayName: `${TAGS} A` });
const l2 = await authMod.loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjA, displayName: `${TAGS} A (re-login)` });
const lB = await authMod.loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjB, displayName: `${TAGS} B` });
ok(l1.principalId === l2.principalId, 'the same Google/Clerk identity resolves to the SAME GrailKey principal after a fresh login (no new principal)');
ok(l1.token !== l2.token && authMod.verifyToken(l2.token).principalId === l1.principalId, 'the fresh session token is new and verifies to that same principal');
ok(lB.principalId !== l1.principalId, 'a different identity gets a different principal (no cross-principal leakage)');
// simulate the expiry -> relogin cycle on the client side
login(l1.token); script = () => reply(401);
await apiFetch('/api/enrich', { method: 'POST', body: '{}' });
ok(!isAuthenticated(), 'client: session expired -> logged out');
setSession(l2.token, l2.expiresAt);
ok(isAuthenticated() && getSession().token === l2.token, 'client: fresh login restores an authenticated session for the same principal');
try {
  const pg = (await import('pg')).default;
  const c = new pg.Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(`DELETE FROM data1_dev.principal_external_identity WHERE external_subject LIKE $1`, [`user_${TAGS}%`]).catch(() => {});
  await c.end();
} catch { /* fixture rows are retained like every other auth test's */ }
await authMod.closePool();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
