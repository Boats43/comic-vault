// tests/u1-stale-client-contract.test.js
//
// UNIVERSAL U1 CLOSEOUT — the stale-client / PWA category contract.
// A browser still running a bundle that predates U1 omits the now-mandatory
// category. The server must refuse it with ONE distinct stable code
// (CATEGORY_REQUIRED_CLIENT_OUTDATED) on every site, and the CURRENT client must
// recognize it centrally and say "Update the app and try again." — never "the
// asset is invalid", never clearing the session, never retrying.
//
// No database: auth is token-only on these paths and providers are stubbed.
// Invoke: node tests/u1-stale-client-contract.test.js

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.EBAY_APP_ID = 'test-app-id';
process.env.EBAY_CERT_ID = 'test-cert-id';
process.env.PRICECHARTING_TOKEN = 'test-pc-token';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(repoRoot, f), 'utf8');

const lsMap = new Map();
globalThis.localStorage = { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => { lsMap.set(k, String(v)); }, removeItem: (k) => { lsMap.delete(k); } };
globalThis.window = new EventTarget();
globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });

const contract = await import('../src/lib/clientContract.js');
const { issueToken } = await import('../src/modules/auth/token.js');
const session = await import('../src/lib/grailkeySession.js');
const mkRes = () => {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
let ipN = 0;
const call = async (handler, body, { auth = true } = {}) => {
  const res = mkRes();
  await handler({
    method: 'POST',
    headers: { ...(auth ? { authorization: `Bearer ${issueToken({ principalId: 'stale-client-user' }).token}` } : {}), 'x-forwarded-for': `10.4.${Math.floor(++ipN / 250)}.${ipN % 250}` },
    body,
    query: {},
  }, res);
  return res;
};

console.log('1. the contract constants');
ok(contract.CATEGORY_REQUIRED_CODE === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'the stable code is CATEGORY_REQUIRED_CLIENT_OUTDATED');
ok(contract.OUTDATED_CLIENT_MESSAGE === 'Update the app and try again.', 'the user-facing message is exactly "Update the app and try again."');
ok(!/invalid/i.test(contract.OUTDATED_CLIENT_MESSAGE), 'the message never calls the asset invalid');

console.log('\n2. server: POST /api/collection with NO category -> distinct stable code');
const collection = (await import('../api/collection.js')).default;
{
  const r = await call(collection, { id: 'cv_stale_1', attributes: { title: 'Old bundle comic' } });
  ok(r.statusCode === 400, `HTTP 400 (got ${r.statusCode})`);
  ok(r.body?.error === 'CATEGORY_REQUIRED_CLIENT_OUTDATED' && r.body?.code === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'body carries error + code CATEGORY_REQUIRED_CLIENT_OUTDATED');
  ok(r.headers['x-grailkey-client-contract'] === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'response header marks the client-contract refusal');
  ok(r.body?.message === 'Update the app and try again.' && !/invalid/i.test(JSON.stringify(r.body)), 'message is actionable and never says the asset is invalid');
  const empty = await call(collection, { id: 'cv_stale_2', assetCategory: '', attributes: { title: 'x' } });
  ok(empty.body?.error === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'an EMPTY category is the same client-contract failure');
  const bad = await call(collection, { id: 'cv_stale_3', assetCategory: 'merchandise', attributes: { title: 'x' } });
  ok(bad.statusCode === 400 && bad.body?.error === 'ASSET_CATEGORY_UNSUPPORTED' && !bad.headers['x-grailkey-client-contract'], 'a present-but-UNSUPPORTED value is a different code and carries NO outdated-client marker');
  const noAuth = await call(collection, { id: 'x', attributes: {} }, { auth: false });
  ok(noAuth.statusCode === 401 && !noAuth.headers['x-grailkey-client-contract'], 'unauthenticated is still just 401 (the marker is never a way to probe)');
}

console.log('\n3. server: POST /api/capture-scan with NO assetClass -> the same code');
const capture = (await import('../api/capture-scan.js')).default;
{
  const r = await call(capture, { scanPayload: { correlationId: 'c', collectionItemId: 'cv_stale_1' }, photos: [], idempotencyKey: 'k' });
  ok(r.statusCode === 400 && r.body?.error === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', `HTTP 400 CATEGORY_REQUIRED_CLIENT_OUTDATED (got ${r.statusCode} ${r.body?.error})`);
  ok(r.headers['x-grailkey-client-contract'] === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'response header present');
}

console.log('\n4. server: POST /api/enrich with NO assetType -> marked; with one -> not marked');
const enrich = (await import('../api/enrich.js')).default;
{
  const stale = await call(enrich, { title: 'Amazing Spider-Man', issue: '300', year: '1988', publisher: 'Marvel', skipVision: true, skipImageSearch: true });
  ok(stale.headers['x-grailkey-client-contract'] === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'a missing assetType (not an owned flow) carries the client-contract marker');
  ok(stale.body?.clientContractError === 'CATEGORY_REQUIRED_CLIENT_OUTDATED', 'the enrich body also carries clientContractError = CATEGORY_REQUIRED_CLIENT_OUTDATED');
  console.log(`    (enrich stale-client body: status=${stale.statusCode} clientContractError=${JSON.stringify(stale.body?.clientContractError)} refusedToPrice=${stale.body?.refusedToPrice})`);
  ok(stale.statusCode === 200 && stale.body?.refusedToPrice === true, `HTTP status and refusal-to-price behavior are UNCHANGED (status ${stale.statusCode}, refusedToPrice=${stale.body?.refusedToPrice})`);
  const fresh = await call(enrich, { assetType: 'comic', title: 'Amazing Spider-Man', issue: '300', year: '1988', publisher: 'Marvel', skipVision: true, skipImageSearch: true });
  ok(!fresh.headers['x-grailkey-client-contract'], 'a request that names its category is never marked');
  const warm = await call(enrich, { warmup: true });
  ok(warm.statusCode === 200 && !warm.headers['x-grailkey-client-contract'], 'a warmup is never marked');
}

console.log('\n5. current client: central detection in apiFetch/authFetch');
{
  session.setSession(`${Buffer.from(JSON.stringify({ principalId: 'u' })).toString('base64url')}.sig`, Date.now() + 3600_000);
  let events = 0;
  const onEvt = () => { events++; };
  window.addEventListener('grailkey:client-outdated', onEvt);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'CATEGORY_REQUIRED_CLIENT_OUTDATED' }), { status: 400, headers: { 'content-type': 'application/json', 'x-grailkey-client-contract': 'CATEGORY_REQUIRED_CLIENT_OUTDATED' } });
  const r1 = await session.apiFetch('/api/collection', { method: 'POST' });
  ok(r1.status === 400 && events === 1, 'apiFetch: the marked refusal fires exactly one grailkey:client-outdated event and still returns the response');
  const r2 = await session.authFetch('/api/capture-scan', { method: 'POST' });
  ok(r2.status === 400 && events === 2, 'authFetch: same');
  ok(session.isAuthenticated(), 'the session is NOT cleared by a client-outdated refusal (it is not an auth failure)');
  globalThis.fetch = async () => new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } });
  await session.apiFetch('/api/collection', { method: 'POST' });
  ok(events === 2, 'an ordinary 400 without the marker fires nothing');
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'x-grailkey-client-contract': 'SOMETHING_ELSE' } });
  await session.apiFetch('/api/x');
  ok(events === 2, 'a different header value fires nothing');
  window.removeEventListener('grailkey:client-outdated', onEvt);
}

console.log('\n6. current client UI + build marker (static)');
{
  const app = read('src/App.jsx');
  ok(/addEventListener\('grailkey:client-outdated'/.test(app), 'App listens for grailkey:client-outdated once, centrally');
  ok(/\{clientOutdated && \(/.test(app) && /OUTDATED_CLIENT_MESSAGE/.test(app), 'the banner renders OUTDATED_CLIENT_MESSAGE');
  const bannerSrc = app.slice(app.indexOf('{clientOutdated && ('), app.indexOf('{clientOutdated && (') + 900);
  ok(!/invalid|error saving|couldn't save/i.test(bannerSrc), 'the banner never calls the asset invalid');
  ok(/const CV_BUILD = typeof __CV_BUILD__/.test(app) && /build \{CV_BUILD\}/.test(app), 'a visible "build <sha>" marker is rendered under the app title');
  const vite = read('vite.config.js');
  ok(/define:\s*\{\s*__CV_BUILD__:\s*JSON\.stringify\(resolveBuildId\(\)\)/.test(vite), 'vite defines __CV_BUILD__ from the git/Vercel commit');
  ok(!/version.?handshake|handshake/i.test(read('src/lib/clientContract.js').replace(/\/\/.*$/gm, '')), 'no general version-handshake system was built');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
