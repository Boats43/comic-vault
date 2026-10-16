// tests/oauth-seller-identity-proof.test.js
//
// P0 OAUTH SELLER IDENTITY PROOF — GET /api/ebay-connection?verify=1.
// Real handler, real principal-scoped token resolver, real Development
// Postgres marketplace_connection rows (real encryptCredential envelope).
// NO REAL EBAY NETWORK CALL: global.fetch is mocked; the mock derives the
// access token from the exact refresh credential it received and answers
// GetUser per access token, so every assertion proves WHICH principal's
// credential reached eBay.
//
// Invoke: node tests/oauth-seller-identity-proof.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');
const LEGACY_SENTINEL = 'GLOBAL-LEGACY-EBAY-AUTH-TOKEN-MUST-NEVER-BE-USED';
process.env.EBAY_AUTH_TOKEN = LEGACY_SENTINEL;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`  ✗ ${label}`); console.log(`  ✗ ${label}`); }
};

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const consoleCapture = [];
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    consoleCapture.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    orig(...args);
  };
}

// ── fetch mock ──
const fetchCalls = [];
const refreshBehavior = {};      // refreshCredential -> 'success' | 'invalid_grant' | 'temporary'
const accountByAccessToken = {}; // access token -> { userId, eias, site } | 'getuser-failure'

global.fetch = async (url, opts = {}) => {
  const urlStr = String(url);
  if (urlStr.includes('identity/v1/oauth2/token')) {
    const refresh = new URLSearchParams(String(opts.body || '')).get('refresh_token');
    fetchCalls.push({ type: 'refresh', refresh });
    const b = refreshBehavior[refresh] || 'success';
    if (b === 'invalid_grant') return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'test-forced invalid_grant' }) };
    if (b === 'temporary') return { ok: false, status: 503, json: async () => ({ error: 'unavailable', error_description: 'forced' }) };
    return { ok: true, status: 200, json: async () => ({ access_token: `access-for-${refresh}`, expires_in: 7200 }) };
  }
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (callName) {
    const iaf = opts.headers['X-EBAY-API-IAF-TOKEN'] || null;
    fetchCalls.push({ type: 'trading', callName, iaf });
    if (callName !== 'GetUser') throw new Error(`test mock: write/unexpected eBay call "${callName}"`);
    const acct = accountByAccessToken[iaf];
    if (acct === 'getuser-failure' || !acct) {
      return { status: 200, text: async () => '<GetUserResponse><Ack>Failure</Ack><Errors><ShortMessage>forced</ShortMessage></Errors></GetUserResponse>' };
    }
    return { status: 200, text: async () => `<GetUserResponse><Ack>Success</Ack><User><UserID>${acct.userId}</UserID><EIASToken>${acct.eias}</EIASToken><Site>${acct.site}</Site></User></GetUserResponse>` };
  }
  throw new Error(`test mock: unexpected call to "${urlStr}"`);
};

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const { upsertMarketplaceConnection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
const { CONNECT_SCOPES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-connection.js')).href)).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

async function newPrincipal(label) {
  const id = (await db.query('SELECT uuidv7() as id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  return id;
}
const reqFor = (principalId, query = { verify: '1' }, method = 'GET') => ({
  method, query, url: '/api/ebay-connection?verify=1',
  headers: principalId ? { authorization: `Bearer ${issueToken({ principalId }).token}` } : {},
});
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const connect = (principalId, providerUserId, refresh) =>
  upsertMarketplaceConnection({ principalId, provider: 'EBAY', providerUserId, refreshCredential: refresh, grantedScopes: [...CONNECT_SCOPES] });
const rowOf = async (pid) => (await db.query(
  `SELECT connection_status, provider_user_id, updated_at FROM data1_dev.marketplace_connection WHERE principal_id=$1 AND provider='EBAY'`, [pid])).rows[0] || null;

const A = await newPrincipal('oauth-id-a'), B = await newPrincipal('oauth-id-b'),
  C_NONE = await newPrincipal('oauth-id-c-none'), D_MISMATCH = await newPrincipal('oauth-id-d-mismatch'),
  E_REVOKED = await newPrincipal('oauth-id-e-revoked'), F_TEMP = await newPrincipal('oauth-id-f-temp'),
  G_GETUSER_FAIL = await newPrincipal('oauth-id-g-getuser');
const EIAS_A = `eias-A-${suffix}`, EIAS_B = `eias-B-${suffix}`;
const R = (l) => `fake-refresh-${l}-${suffix}`;
await connect(A, EIAS_A, R('A'));
await connect(B, EIAS_B, R('B'));
await connect(D_MISMATCH, `eias-D-stored-${suffix}`, R('D'));
await connect(E_REVOKED, `eias-E-${suffix}`, R('E'));
await connect(F_TEMP, `eias-F-${suffix}`, R('F'));
await connect(G_GETUSER_FAIL, `eias-G-${suffix}`, R('G'));
accountByAccessToken[`access-for-${R('A')}`] = { userId: 'seller_alpha', eias: EIAS_A, site: 'US' };
accountByAccessToken[`access-for-${R('B')}`] = { userId: 'seller_bravo', eias: EIAS_B, site: 'US' };
// D: GetUser succeeds but the stable id differs from what is stored
accountByAccessToken[`access-for-${R('D')}`] = { userId: 'seller_other_account', eias: `eias-D-DIFFERENT-${suffix}`, site: 'US' };
accountByAccessToken[`access-for-${R('G')}`] = 'getuser-failure';
refreshBehavior[R('E')] = 'invalid_grant';
refreshBehavior[R('F')] = 'temporary';

try {
  console.log('\n=== valid matching account ===');
  {
    fetchCalls.length = 0;
    const before = await rowOf(A);
    const res = mockRes(); await handler(reqFor(A), res);
    assertTrue(res.statusCode === 200, 'A: 200');
    assertTrue(res.body?.verification === 'VERIFIED' && res.body?.userId === 'seller_alpha' && res.body?.site === 'US' && res.body?.eiasMatchesStored === true, 'A: VERIFIED with userId, site, eiasMatchesStored=true');
    assertTrue(JSON.stringify(Object.keys(res.body).sort()) === JSON.stringify(['eiasMatchesStored', 'site', 'userId', 'verification']), 'A: response carries exactly the four minimum fields');
    assertTrue(/no-store/.test(res.headers['Cache-Control'] || ''), 'A: Cache-Control no-store');
    assertTrue(fetchCalls.filter((c) => c.type === 'trading').every((c) => c.callName === 'GetUser') && fetchCalls.some((c) => c.callName === 'GetUser'), 'A: only read-only GetUser Trading calls');
    assertTrue(fetchCalls.find((c) => c.callName === 'GetUser').iaf === `access-for-${R('A')}`, "A: GetUser used A's own principal-scoped credential");
    assertTrue(JSON.stringify(before) === JSON.stringify(await rowOf(A)), 'A: connection row unchanged (no mutation)');
  }

  console.log('\n=== mismatched account ===');
  {
    const before = await rowOf(D_MISMATCH);
    const res = mockRes(); await handler(reqFor(D_MISMATCH), res);
    assertTrue(res.statusCode === 409 && res.body?.verification === 'MISMATCH' && res.body?.eiasMatchesStored === false, 'D: GetUser success + EIAS disagreement => 409 MISMATCH (not a pass)');
    assertTrue(!('userId' in res.body) && !JSON.stringify(res.body).includes('seller_other_account'), 'D: unproven userId withheld on mismatch');
    assertTrue(JSON.stringify(before) === JSON.stringify(await rowOf(D_MISMATCH)), 'D: connection row unchanged');
  }

  console.log('\n=== expired / revoked / unavailable ===');
  {
    const res = mockRes(); await handler(reqFor(E_REVOKED), res);
    assertTrue(res.statusCode === 503 && res.body?.verification === 'FAILED' && res.body?.reason === 'EBAY_RECONNECT_REQUIRED', 'E: invalid_grant => 503 reconnect required, fail closed');
    assertTrue(!('userId' in res.body), 'E: no identity returned');
    const res2 = mockRes(); await handler(reqFor(F_TEMP), res2);
    assertTrue(res2.statusCode === 502 && res2.body?.verification === 'FAILED' && res2.body?.reason === 'EBAY_TEMPORARY_FAILURE', 'F: eBay temporarily unavailable => 502, fail closed');
    assertTrue((await rowOf(F_TEMP)).connection_status === 'CONNECTED', 'F: temporary failure leaves connection CONNECTED');
    const res3 = mockRes(); await handler(reqFor(G_GETUSER_FAIL), res3);
    assertTrue(res3.statusCode === 502 && res3.body?.reason === 'EBAY_GETUSER_FAILED', 'G: GetUser Ack=Failure => 502, fail closed');
    for (const r of [res, res2, res3]) assertTrue(/no-store/.test(r.headers['Cache-Control'] || ''), 'failure response is no-store');
  }

  console.log('\n=== missing connection ===');
  {
    fetchCalls.length = 0;
    const res = mockRes(); await handler(reqFor(C_NONE), res);
    assertTrue(res.statusCode === 503 && res.body?.reason === 'EBAY_CONNECTION_REQUIRED', 'C: no connection => 503 EBAY_CONNECTION_REQUIRED');
    assertTrue(fetchCalls.length === 0, 'C: no eBay call made; legacy global token is not a fallback');
  }

  console.log('\n=== unauthenticated ===');
  {
    fetchCalls.length = 0;
    const res = mockRes(); await handler(reqFor(null), res);
    assertTrue(res.statusCode === 401 && !res.body?.userId, 'no bearer => 401');
    assertTrue(/no-store/.test(res.headers['Cache-Control'] || ''), '401 on verify is no-store');
    const bad = mockRes(); await handler({ method: 'GET', query: { verify: '1' }, headers: { authorization: 'Bearer not-a-real-token' } }, bad);
    assertTrue(bad.statusCode === 401, 'garbage bearer => 401');
    assertTrue(fetchCalls.length === 0, 'unauthenticated: no eBay call made');
  }

  console.log('\n=== cross-principal isolation ===');
  {
    fetchCalls.length = 0;
    const resA = mockRes(); await handler(reqFor(A), resA);
    const resB = mockRes(); await handler(reqFor(B), resB);
    assertTrue(resA.body?.userId === 'seller_alpha' && resB.body?.userId === 'seller_bravo', 'A and B each see only their own seller account');
    assertTrue(!JSON.stringify(resA.body).includes('bravo') && !JSON.stringify(resB.body).includes('alpha'), "neither response contains the other principal's identity");
    const getUsers = fetchCalls.filter((c) => c.callName === 'GetUser').map((c) => c.iaf);
    assertTrue(getUsers[0] === `access-for-${R('A')}` && getUsers[1] === `access-for-${R('B')}`, "each GetUser carried only its own principal's credential");
    const spoof = mockRes();
    await handler({ ...reqFor(A, { verify: '1', principalId: B, providerUserId: EIAS_B }), body: { principalId: B } }, spoof);
    assertTrue(spoof.body?.userId === 'seller_alpha', 'caller-supplied principalId/providerUserId selectors are ignored');
  }

  console.log('\n=== non-verify behaviour unchanged ===');
  {
    fetchCalls.length = 0;
    const res = mockRes(); await handler(reqFor(A, {}), res);
    assertTrue(res.statusCode === 200 && res.body?.status === 'CONNECTED' && res.body?.connected === true && !('userId' in res.body), 'plain GET still returns metadata-only status');
    assertTrue(fetchCalls.length === 0, 'plain GET makes no eBay call');
    const post = mockRes(); await handler(reqFor(A, { verify: '1' }, 'POST'), post);
    assertTrue(post.statusCode === 405, 'non-GET still 405');
  }

  console.log('\n=== secret hygiene ===');
  {
    const needles = [R('A'), R('B'), R('D'), R('E'), R('F'), R('G'),
      `access-for-${R('A')}`, `access-for-${R('B')}`, `access-for-${R('D')}`,
      LEGACY_SENTINEL, process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY, process.env.EBAY_CERT_ID].filter(Boolean);
    const bodies = [];
    for (const p of [A, B, D_MISMATCH, E_REVOKED, F_TEMP, G_GETUSER_FAIL, C_NONE]) {
      const r = mockRes(); await handler(reqFor(p), r); bodies.push(JSON.stringify(r.body) + JSON.stringify(r.headers));
    }
    const allBodies = bodies.join('\n');
    const logs = consoleCapture.join('\n');
    for (const n of needles) {
      assertTrue(!logs.includes(n), `logs never contain ${n.slice(0, 22)}...`);
      assertTrue(!allBodies.includes(n), `responses/headers never contain ${n.slice(0, 22)}...`);
    }
    assertTrue(!allBodies.includes(EIAS_A) && !allBodies.includes(EIAS_B), 'responses never echo the EIAS identifier');
    assertTrue(!/refresh|access_token|accessToken/i.test(allBodies), 'responses contain no token-named fields');
  }
} finally {
  await db.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = ANY($1)`, [[A, B, C_NONE, D_MISMATCH, E_REVOKED, F_TEMP, G_GETUSER_FAIL]]);
  console.log('\n  (cleanup) marketplace_connection rows deleted; gk_principal fixtures left per repo convention.\n');
  await db.end();
}
console.log(`\nOAUTH-IDENTITY-PROOF RESULTS: ${passed} passed, ${failed} failed`);
failures.forEach((f) => console.log(f));
process.exit(failed > 0 ? 1 : 0);
