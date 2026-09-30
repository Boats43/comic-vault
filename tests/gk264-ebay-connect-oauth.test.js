// tests/gk264-ebay-connect-oauth.test.js
//
// GK-264 — the complete eBay Connect OAuth lifecycle (initiation, state,
// callback authority chain, token exchange, identity proof, storage,
// collision, identity permanence, disconnect, status, secret hygiene).
//
// NO REAL EBAY NETWORK CALL IS EVER MADE. global.fetch is replaced with
// a local mock dispatched by URL (eBay's token endpoint vs. the Trading
// API GetUser endpoint) — the same "mock fetch, real handler, real DB"
// convention tests/gk262-public-surface-blockers.test.js and
// tests/list-ebay-outcome1-handler-smoke.test.js already follow.
//
// Real Development Postgres (transient rows, all cleaned up). Synthetic
// secrets only (GRAILKEY_OAUTH_STATE_SECRET, GRAILKEY_MARKETPLACE_CREDENTIAL_KEY,
// EBAY_CERT_ID). No real eBay credential, code, or token anywhere.
//
// Invoke: node tests/gk264-ebay-connect-oauth.test.js

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

const STATE_SECRET = randomBytes(32).toString('base64url');
process.env.GRAILKEY_OAUTH_STATE_SECRET = STATE_SECRET;
const CREDENTIAL_KEY = randomBytes(32).toString('base64url');
process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = CREDENTIAL_KEY;
process.env.EBAY_APP_ID = 'test-ebay-app-id';
const EBAY_CERT_SECRET = 'test-ebay-cert-secret-VALUE';
process.env.EBAY_CERT_ID = EBAY_CERT_SECRET;
process.env.EBAY_OAUTH_RUNAME = 'test-ru-name-value';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ── Unified fetch mock — dispatched by URL. Never reaches the real network. ──
const fetchCalls = [];
let tokenExchangeBehavior = 'success'; // 'success' | 'error' | 'missing-refresh-token'
let getUserBehavior = 'success'; // 'success' | 'failure' | 'missing-eias'
let currentEiasToken = 'gk264-default-eias';

global.fetch = async (url, opts = {}) => {
  const urlStr = String(url);
  if (urlStr.includes('identity/v1/oauth2/token')) {
    fetchCalls.push({ type: 'token-exchange', url: urlStr, headers: opts.headers || {}, body: String(opts.body) });
    if (tokenExchangeBehavior === 'error') {
      return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'test-forced failure' }) };
    }
    if (tokenExchangeBehavior === 'missing-refresh-token') {
      return { ok: true, status: 200, json: async () => ({ access_token: `test-access-${Date.now()}`, expires_in: 7200 }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        access_token: `test-access-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        refresh_token: `test-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        expires_in: 7200, refresh_token_expires_in: 47304000,
      }),
    };
  }
  if (urlStr.includes('ws/api.dll')) {
    fetchCalls.push({ type: 'get-user', url: urlStr, headers: opts.headers || {}, body: String(opts.body) });
    if (getUserBehavior === 'failure') {
      return { status: 200, text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Failure</Ack><Errors><ShortMessage>test forced failure</ShortMessage></Errors></GetUserResponse>` };
    }
    if (getUserBehavior === 'missing-eias') {
      return { status: 200, text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>somebody</UserID></User></GetUserResponse>` };
    }
    return { status: 200, text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>somebody</UserID><EIASToken>${currentEiasToken}</EIASToken></User></GetUserResponse>` };
  }
  throw new Error(`test fetch mock: unexpected call to "${urlStr}"`);
};

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const { createOAuthState, verifyOAuthState, OAuthStateError } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'oauthState.js')).href);
const { getMarketplaceConnection, resolveMarketplaceRefreshCredential, disconnectMarketplaceConnection, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);

const connectHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-connect.js')).href)).default;
const callbackHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-callback.js')).href)).default;
const connectionHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-connection.js')).href)).default;
const disconnectHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-disconnect.js')).href)).default;

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const jimmyToken = issueToken({ principalId: JIMMY }).token;

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

async function getRawRow(principalId) {
  const r = await dbClient.query(`SELECT * FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = 'EBAY'`, [principalId]);
  return r.rows[0] || null;
}

function authedReq(method, body, token = jimmyToken) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body || {} };
}

function parseState(authorizationUrl) {
  const u = new URL(authorizationUrl);
  return u.searchParams.get('state');
}
function decodeStatePayload(state) {
  const [payloadB64] = state.split('.');
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
}

// A fresh, real, transient second gk_principal.
const idRes = await dbClient.query('SELECT uuidv7() as id');
const PRINCIPAL_B = idRes.rows[0].id;
await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [PRINCIPAL_B, 'gk264-test-principal-b']);
const principalBToken = issueToken({ principalId: PRINCIPAL_B }).token;

try {
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART A: connect initiation ===\n');
  {
    fetchCalls.length = 0;
    const res1 = mockRes();
    await connectHandler(authedReq('POST', {}, null), res1);
    assertTrue(res1.statusCode === 401, 'A1: unauthenticated connect rejected with 401');
    assertTrue(fetchCalls.length === 0, 'A1: no eBay call made for an unauthenticated request');

    const res2 = mockRes();
    await connectHandler(authedReq('POST', {}), res2);
    assertTrue(res2.statusCode === 200 && typeof res2.body?.authorizationUrl === 'string', 'A2: authenticated connect returns an authorizationUrl');

    const res3 = mockRes();
    await connectHandler(authedReq('POST', { principalId: 'evil-principal-should-be-ignored' }), res3);
    const state3 = parseState(res3.body.authorizationUrl);
    const payload3 = decodeStatePayload(state3);
    assertTrue(payload3.principalId === JIMMY, 'A3: a client-supplied principalId in the body is completely ignored — state is bound to the AUTHENTICATED principal');

    const url2 = new URL(res2.body.authorizationUrl);
    const { CONNECT_SCOPES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
    assertTrue(url2.searchParams.get('scope') === CONNECT_SCOPES.join(' '), 'A4: the server-owned scope set is present in the authorization URL, unmodifiable by the client');

    const payload2 = decodeStatePayload(state3);
    const expectedKeys = new Set(['v', 'provider', 'principalId', 'nonce', 'iat', 'exp', 'sessionBinding']);
    assertTrue(Object.keys(payload2).every((k) => expectedKeys.has(k)), 'A5: the decoded state payload contains only the documented fields, no secret material');
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART B: OAuth state validation ===\n');
  {
    const { state } = createOAuthState({ principalId: JIMMY, sessionToken: jimmyToken });
    const ok = verifyOAuthState({ state, principalId: JIMMY, sessionToken: jimmyToken });
    assertTrue(ok.principalId === JIMMY, 'B1: a valid, freshly-issued state is accepted');

    let tampered = null;
    try {
      const badState = state.slice(0, -2) + (state.slice(-2) === 'AA' ? 'BB' : 'AA');
      verifyOAuthState({ state: badState, principalId: JIMMY, sessionToken: jimmyToken });
    } catch (e) { tampered = e; }
    assertTrue(tampered instanceof OAuthStateError && tampered.code === 'BAD_SIGNATURE', 'B2: a tampered signature is rejected (BAD_SIGNATURE)');

    // Manually construct an EXPIRED state using the same construction
    // oauthState.js itself uses (documented duplication, same
    // convention as mintTestToken elsewhere in this repo's tests).
    const { createHmac } = await import('node:crypto');
    const expiredPayload = {
      v: 1, provider: 'EBAY', principalId: JIMMY, nonce: 'test-nonce',
      iat: Date.now() - 20 * 60 * 1000, exp: Date.now() - 10 * 60 * 1000,
      sessionBinding: createHmac('sha256', STATE_SECRET).update(`grailkey-ebay-oauth-session-binding-v1:${jimmyToken}`).digest('base64url'),
    };
    const expiredPayloadB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const expiredSig = createHmac('sha256', STATE_SECRET).update(`grailkey-ebay-oauth-state-sig-v1:${expiredPayloadB64}`).digest('base64url');
    let expiredErr = null;
    try { verifyOAuthState({ state: `${expiredPayloadB64}.${expiredSig}`, principalId: JIMMY, sessionToken: jimmyToken }); } catch (e) { expiredErr = e; }
    assertTrue(expiredErr instanceof OAuthStateError && expiredErr.code === 'EXPIRED', 'B3: an expired state is rejected (EXPIRED)');

    const wrongProviderPayload = { ...expiredPayload, provider: 'PAYPAL', iat: Date.now(), exp: Date.now() + 60000 };
    const wpB64 = Buffer.from(JSON.stringify(wrongProviderPayload)).toString('base64url');
    const wpSig = createHmac('sha256', STATE_SECRET).update(`grailkey-ebay-oauth-state-sig-v1:${wpB64}`).digest('base64url');
    let wrongProviderErr = null;
    try { verifyOAuthState({ state: `${wpB64}.${wpSig}`, principalId: JIMMY, sessionToken: jimmyToken }); } catch (e) { wrongProviderErr = e; }
    assertTrue(wrongProviderErr instanceof OAuthStateError && wrongProviderErr.code === 'WRONG_PROVIDER', 'B4: a state issued for a different provider is rejected (WRONG_PROVIDER)');

    let wrongPrincipalErr = null;
    try { verifyOAuthState({ state, principalId: 'some-other-principal-id', sessionToken: jimmyToken }); } catch (e) { wrongPrincipalErr = e; }
    assertTrue(wrongPrincipalErr instanceof OAuthStateError && wrongPrincipalErr.code === 'PRINCIPAL_MISMATCH', 'B5: a state used by a different principal is rejected pre-exchange (PRINCIPAL_MISMATCH)');

    let wrongBindingErr = null;
    try { verifyOAuthState({ state, principalId: JIMMY, sessionToken: 'a-completely-different-session-token' }); } catch (e) { wrongBindingErr = e; }
    assertTrue(wrongBindingErr instanceof OAuthStateError && wrongBindingErr.code === 'SESSION_BINDING_MISMATCH', 'B6: a state replayed under a different session is rejected pre-exchange (SESSION_BINDING_MISMATCH)');
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART C: callback transport ===\n');
  {
    fetchCalls.length = 0;
    const res1 = mockRes();
    await callbackHandler({ method: 'POST', headers: {}, body: { code: 'x', state: 'y' } }, res1);
    assertTrue(res1.statusCode === 401, 'C1: unauthenticated callback rejected with 401');
    assertTrue(fetchCalls.length === 0, 'C1: no eBay call made for an unauthenticated request');

    const res2 = mockRes();
    await callbackHandler(authedReq('GET', { code: 'x', state: 'y' }), res2);
    assertTrue(res2.statusCode === 405, 'C2: a GET callback completion attempt is rejected (405)');
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART D: token exchange only after complete authority chain ===\n');
  {
    fetchCalls.length = 0;
    const resBadState = mockRes();
    await callbackHandler(authedReq('POST', { code: 'irrelevant', state: 'not-a-real-state' }), resBadState);
    assertTrue(resBadState.statusCode === 400, 'D1: an invalid state is rejected before any eBay call');
    assertTrue(fetchCalls.length === 0, 'D1: NO eBay network call was made for an invalid state');

    const { state: goodState } = createOAuthState({ principalId: JIMMY, sessionToken: jimmyToken });
    tokenExchangeBehavior = 'error';
    fetchCalls.length = 0;
    const resExchangeFail = mockRes();
    await callbackHandler(authedReq('POST', { code: 'test-code-1', state: goodState }), resExchangeFail);
    assertTrue(resExchangeFail.statusCode === 502, 'D2: a real eBay token-exchange failure surfaces as 502');
    assertTrue((await getRawRow(JIMMY)) === null, 'D2: nothing was stored in Production... (Development) DB after a failed exchange');
    tokenExchangeBehavior = 'success';

    const { state: goodState2 } = createOAuthState({ principalId: JIMMY, sessionToken: jimmyToken });
    tokenExchangeBehavior = 'missing-refresh-token';
    const resMissingRefresh = mockRes();
    await callbackHandler(authedReq('POST', { code: 'test-code-2', state: goodState2 }), resMissingRefresh);
    assertTrue(resMissingRefresh.statusCode === 502, 'D3: a token response missing refresh_token fails closed (502)');
    assertTrue((await getRawRow(JIMMY)) === null, 'D3: nothing was stored after a missing-refresh-token response');
    tokenExchangeBehavior = 'success';
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART E: identity proof (GetUser via IAF) + client-authority test ===\n');
  {
    currentEiasToken = 'gk264-eias-real-success-1';
    const { state } = createOAuthState({ principalId: JIMMY, sessionToken: jimmyToken });
    fetchCalls.length = 0;
    const res = mockRes();
    // Adversarial body: forged fields the endpoint must ignore entirely.
    await callbackHandler(authedReq('POST', {
      code: 'test-code-real-1', state,
      principalId: 'forged-principal', providerUserId: 'forged-provider-user',
      grantedScopes: ['forged-scope'], connectionStatus: 'CONNECTED',
      connectedAt: '2000-01-01', updatedAt: '2000-01-01',
      refreshCredential: 'forged-refresh-credential', accessToken: 'forged-access-token',
    }), res);
    assertTrue(res.statusCode === 200 && res.body?.connected === true, 'E0: the real success path returns 200/connected:true despite adversarial extra fields');

    const getUserCall = fetchCalls.find((c) => c.type === 'get-user');
    assertTrue(!!getUserCall, 'E1: GetUser was actually called server-side');
    assertTrue(getUserCall.headers['X-EBAY-API-IAF-TOKEN'] && !getUserCall.body.includes('RequesterCredentials') && !getUserCall.body.includes('eBayAuthToken'), 'E2/E3: GetUser used X-EBAY-API-IAF-TOKEN, never the legacy RequesterCredentials/eBayAuthToken path');

    const raw = await getRawRow(JIMMY);
    assertTrue(raw.provider_user_id === currentEiasToken, 'E4/E5: the stored providerUserId is the server-resolved EIASToken, NEVER the forged body fields');

    currentEiasToken = 'gk264-default-eias'; // restore default for later parts
  }

  console.log('\n-- E6: missing EIASToken fails closed --\n');
  {
    // A fresh, different principal so this doesn't collide with JIMMY's
    // already-established connection above.
    const idResD = await dbClient.query('SELECT uuidv7() as id');
    const PRINCIPAL_D = idResD.rows[0].id;
    await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [PRINCIPAL_D, 'gk264-test-principal-d']);
    const tokenD = issueToken({ principalId: PRINCIPAL_D }).token;
    const { state } = createOAuthState({ principalId: PRINCIPAL_D, sessionToken: tokenD });
    getUserBehavior = 'missing-eias';
    const res = mockRes();
    await callbackHandler(authedReq('POST', { code: 'test-code-missing-eias', state }, tokenD), res);
    assertTrue(res.statusCode === 502, 'E6: a GetUser response with no EIASToken fails closed (502)');
    assertTrue((await getRawRow(PRINCIPAL_D)) === null, 'E6: nothing was stored when EIASToken is absent');
    getUserBehavior = 'success';
    await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [PRINCIPAL_D]);
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART F: storage ===\n');
  {
    const raw = await getRawRow(JIMMY);
    assertTrue(!!raw.encrypted_refresh_credential, 'F1: a real ciphertext envelope is stored');
    // We never learn the real plaintext refresh token value from this
    // test's own perspective (it's generated per-call by the mock), but
    // we CAN assert it's not a bare recognizable JWT/plain string —
    // structural envelope check: our own envelope format is "v1.<iv>.<ct>.<tag>".
    assertTrue(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.encrypted_refresh_credential), 'F2: the stored value is a real versioned AES-GCM envelope, not plaintext');
    const resolved = await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
    assertTrue(!raw.encrypted_refresh_credential.includes(resolved.refreshCredential), 'F2b: the real decrypted plaintext refresh token does not appear as a substring of its own ciphertext envelope');

    const { CONNECT_SCOPES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
    assertTrue(JSON.stringify(raw.granted_scopes.slice().sort()) === JSON.stringify(CONNECT_SCOPES.slice().sort()), 'F3: the server-owned CONNECT_SCOPES set is exactly what was persisted, never anything client-supplied');
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART G: provider-identity collision ===\n');
  {
    const collisionEias = 'gk264-eias-collision-target';
    currentEiasToken = collisionEias;

    // Ensure a clean base: JIMMY currently owns some other eias from
    // Part E — re-verify collision protects THAT identity for a
    // different, fresh principal attempting collisionEias against it.
    const { state: stateB } = createOAuthState({ principalId: PRINCIPAL_B, sessionToken: principalBToken });
    const res1 = mockRes();
    await callbackHandler(authedReq('POST', { code: 'test-code-b-1', state: stateB }, principalBToken), res1);
    assertTrue(res1.statusCode === 200 && res1.body?.connected === true, 'G-setup: Principal B connects a fresh eBay identity for real, first');

    const warnCaptured = [];
    const originalWarn = console.warn;
    console.warn = (...a) => { warnCaptured.push(a.map(String).join(' ')); originalWarn(...a); };

    currentEiasToken = collisionEias; // now make Principal B's OWN identity irrelevant — reuse a value...
    // Actually collide against JIMMY's identity from Part E directly:
    const jimmyRaw = await getRawRow(JIMMY);
    currentEiasToken = jimmyRaw.provider_user_id;

    const { state: stateB2 } = createOAuthState({ principalId: PRINCIPAL_B, sessionToken: principalBToken });
    const beforeBRow = await getRawRow(PRINCIPAL_B);
    const res2 = mockRes();
    await callbackHandler(authedReq('POST', { code: 'test-code-b-2', state: stateB2 }, principalBToken), res2);
    console.warn = originalWarn;

    assertTrue(res2.statusCode === 409, 'G1: Principal B completing real OAuth for JIMMY-owned identity X is rejected (409)');
    assertTrue(res2.body?.error === 'This eBay account cannot be connected.', 'G5: the response is the exact generic, non-disclosing message');
    const afterBRow = await getRawRow(PRINCIPAL_B);
    assertTrue(afterBRow.provider_user_id === beforeBRow.provider_user_id, 'G2/G3: Principal B\'s own PRE-EXISTING row/credential is completely unaffected — no token from the collision attempt was persisted');
    const jimmyRawAfter = await getRawRow(JIMMY);
    assertTrue(jimmyRawAfter.provider_user_id === jimmyRaw.provider_user_id && jimmyRawAfter.updated_at.getTime() === jimmyRaw.updated_at.getTime(), 'G2: JIMMY\'s own row is completely unaffected by the collision attempt');
    assertTrue(warnCaptured.some((l) => l.includes('remote token revocation not attempted')), 'G4: the disclosed best-effort remote-revocation code path was reached (attempted, per its own disclosed semantics)');

    currentEiasToken = 'gk264-default-eias';
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART H: identity permanence (full HTTP surface) ===\n');
  {
    // Fresh principal, fresh identity — fully self-contained.
    const idResE = await dbClient.query('SELECT uuidv7() as id');
    const PRINCIPAL_E = idResE.rows[0].id;
    await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [PRINCIPAL_E, 'gk264-test-principal-e']);
    const tokenE = issueToken({ principalId: PRINCIPAL_E }).token;
    const eiasX = 'gk264-eias-permanence-X';
    const eiasY = 'gk264-eias-permanence-Y';

    currentEiasToken = eiasX;
    const { state: s1 } = createOAuthState({ principalId: PRINCIPAL_E, sessionToken: tokenE });
    const r1 = mockRes();
    await callbackHandler(authedReq('POST', { code: 'e-code-1', state: s1 }, tokenE), r1);
    assertTrue(r1.statusCode === 200, 'H1: A/X connect succeeds');
    const rowAfterH1 = await getRawRow(PRINCIPAL_E);

    // H3 — A/X active -> A/Y fails.
    currentEiasToken = eiasY;
    const { state: s2 } = createOAuthState({ principalId: PRINCIPAL_E, sessionToken: tokenE });
    const r2 = mockRes();
    await callbackHandler(authedReq('POST', { code: 'e-code-2', state: s2 }, tokenE), r2);
    assertTrue(r2.statusCode === 409, 'H3: A/X ACTIVE -> A/Y (different account) fails closed');
    const rowAfterH3 = await getRawRow(PRINCIPAL_E);
    assertTrue(rowAfterH3.provider_user_id === eiasX, 'H3: A\'s row is still bound to X, unaffected');

    // A/X disconnect -> A/X reconnect succeeds, same row.
    const discRes = mockRes();
    await disconnectHandler(authedReq('POST', {}, tokenE), discRes);
    assertTrue(discRes.statusCode === 200 && discRes.body?.status === 'DISCONNECTED', 'H2-setup: A/X disconnects');

    // H4 — A/X disconnected -> A/Y fails.
    currentEiasToken = eiasY;
    const { state: s3 } = createOAuthState({ principalId: PRINCIPAL_E, sessionToken: tokenE });
    const r3 = mockRes();
    await callbackHandler(authedReq('POST', { code: 'e-code-3', state: s3 }, tokenE), r3);
    assertTrue(r3.statusCode === 409, 'H4: A/X DISCONNECTED -> A/Y (different account) still fails closed');

    // H2 — A/X disconnected -> A/X reconnect succeeds, SAME row.
    currentEiasToken = eiasX;
    const { state: s4 } = createOAuthState({ principalId: PRINCIPAL_E, sessionToken: tokenE });
    const r4 = mockRes();
    await callbackHandler(authedReq('POST', { code: 'e-code-4', state: s4 }, tokenE), r4);
    assertTrue(r4.statusCode === 200, 'H2: A/X disconnected -> A/X reconnect succeeds');
    const rowAfterH2 = await getRawRow(PRINCIPAL_E);
    assertTrue(rowAfterH2.id === rowAfterH1.id, 'H2: reconnect reuses the SAME durable row (same id)');

    await dbClient.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1`, [PRINCIPAL_E]);
    await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [PRINCIPAL_E]);
    currentEiasToken = 'gk264-default-eias';
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART: status endpoint ===\n');
  {
    const res1 = mockRes();
    await connectionHandler({ method: 'GET', headers: {} }, res1);
    assertTrue(res1.statusCode === 401, 'STATUS: unauthenticated status request rejected with 401');

    const res2 = mockRes();
    await connectionHandler(authedReq('GET', null), res2);
    assertTrue(res2.statusCode === 200 && res2.body?.status === 'CONNECTED', 'STATUS: authenticated status reflects real CONNECTED state');
    const safeKeys = new Set(['provider', 'status', 'connected', 'grantedScopes', 'connectedAt', 'updatedAt']);
    assertTrue(Object.keys(res2.body).every((k) => safeKeys.has(k)), 'STATUS: response contains ONLY metadata fields, zero credential-shaped keys');

    const idResF = await dbClient.query('SELECT uuidv7() as id');
    const PRINCIPAL_F = idResF.rows[0].id;
    await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [PRINCIPAL_F, 'gk264-test-principal-f']);
    const tokenF = issueToken({ principalId: PRINCIPAL_F }).token;
    const res3 = mockRes();
    await connectionHandler(authedReq('GET', null, tokenF), res3);
    assertTrue(res3.statusCode === 200 && res3.body?.status === 'NOT_CONNECTED' && res3.body?.connected === false, 'STATUS: a principal with no row maps cleanly to NOT_CONNECTED');
    await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [PRINCIPAL_F]);
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART: disconnect ===\n');
  {
    const res1 = mockRes();
    await disconnectHandler({ method: 'POST', headers: {}, body: {} }, res1);
    assertTrue(res1.statusCode === 401, 'DISCONNECT: unauthenticated disconnect rejected with 401');

    // Principal isolation: B disconnecting affects only B, never JIMMY.
    const jimmyBefore = await getRawRow(JIMMY);
    const resB = mockRes();
    await disconnectHandler(authedReq('POST', {}, principalBToken), resB);
    assertTrue(resB.statusCode === 200, 'DISCONNECT: Principal B can disconnect their own connection');
    const jimmyAfterBDisconnect = await getRawRow(JIMMY);
    assertTrue(jimmyAfterBDisconnect.connection_status === jimmyBefore.connection_status, 'DISCONNECT: Principal B disconnecting never touches JIMMY\'s row (principal isolation)');

    // Disconnecting an already-disconnected/no-connection state is safe.
    const resBAgain = mockRes();
    await disconnectHandler(authedReq('POST', {}, principalBToken), resBAgain);
    assertTrue(resBAgain.statusCode === 200 && resBAgain.body?.status === 'DISCONNECTED', 'DISCONNECT: disconnecting an already-disconnected connection is safe and well-defined');

    // Now disconnect JIMMY for real and prove the credential becomes unusable.
    const resJimmy = mockRes();
    await disconnectHandler(authedReq('POST', {}), resJimmy);
    assertTrue(resJimmy.statusCode === 200 && resJimmy.body?.status === 'DISCONNECTED', 'DISCONNECT: JIMMY disconnects successfully');
    let threwAfterDisconnect = null;
    try { await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' }); } catch (e) { threwAfterDisconnect = e; }
    assertTrue(threwAfterDisconnect !== null, 'DISCONNECT: credential is unusable after disconnect');
    const jimmyRawFinal = await getRawRow(JIMMY);
    assertTrue(jimmyRawFinal.encrypted_refresh_credential === null, 'DISCONNECT: ciphertext genuinely cleared');
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== GK-264 PART: secret hygiene (full flow) ===\n');
  {
    const originalLog = console.log, originalError = console.error, originalWarn = console.warn;
    const captured = [];
    const capture = (...a) => captured.push(a.map(String).join(' '));
    console.log = capture; console.error = capture; console.warn = capture;

    try {
      const idResG = await dbClient.query('SELECT uuidv7() as id');
      const PRINCIPAL_G = idResG.rows[0].id;
      await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [PRINCIPAL_G, 'gk264-test-principal-g']);
      const tokenG = issueToken({ principalId: PRINCIPAL_G }).token;
      currentEiasToken = 'gk264-eias-hygiene';
      const { state } = createOAuthState({ principalId: PRINCIPAL_G, sessionToken: tokenG });
      const res = mockRes();
      await callbackHandler(authedReq('POST', { code: 'hygiene-real-code-VALUE', state }, tokenG), res);
      await connectionHandler(authedReq('GET', null, tokenG), mockRes());
      const discRes = mockRes();
      await disconnectHandler(authedReq('POST', {}, tokenG), discRes);
      await dbClient.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1`, [PRINCIPAL_G]);
      await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [PRINCIPAL_G]);
    } finally {
      console.log = originalLog; console.error = originalError; console.warn = originalWarn;
    }

    const allLogText = captured.join('\n');
    assertTrue(!allLogText.includes('hygiene-real-code-VALUE'), 'HYGIENE: the authorization code never appears in any emitted log line');
    assertTrue(!allLogText.includes(EBAY_CERT_SECRET), 'HYGIENE: the eBay client secret never appears in any emitted log line');
    assertTrue(!allLogText.includes(Buffer.from(`test-ebay-app-id:${EBAY_CERT_SECRET}`).toString('base64')), 'HYGIENE: the Basic-auth value never appears in any emitted log line');
    assertTrue(!allLogText.includes(CREDENTIAL_KEY), 'HYGIENE: the marketplace encryption key never appears in any emitted log line');
    assertTrue(!allLogText.includes(STATE_SECRET), 'HYGIENE: the OAuth state secret never appears in any emitted log line');
    // access_token/refresh_token values are randomized per mock call and
    // never captured by this test itself outside the mock's own closure,
    // so a literal-value check isn't meaningful here — the structural
    // envelope check in PART F (never plaintext in the ciphertext
    // column) is the durable proof for the refresh token specifically.
  }

  console.log('\n=== GK-264 PART: boundary — untouched seller-execution files (bounded to GK-264\'s own commit range) ===\n');
  {
    // GK-265 PHASE 3 (a later, separate, explicitly authorized dispatch)
    // DOES intentionally convert these 3 files to principal-scoped
    // credentials -- an open-ended `beforeSha..HEAD` diff would now
    // always be non-empty and this check would misreport a real,
    // authorized later change as a GK-264 boundary violation. Bounded
    // instead to GK-264's OWN commit range (644d157 = HEAD immediately
    // before GK-264 began; 767f254 = GK-264's own last commit, before
    // GK-265 started) -- this preserves the original, still-true
    // historical proof ("GK-264 itself never touched seller execution")
    // without being invalidated by legitimate later work.
    const beforeSha = '644d157ab73754b47bf6d03d56fdd024406f3a74'; // HEAD at the start of GK-264
    const afterSha = '767f25448996fb16f5d343a24d538235896a8e9b'; // GK-264's own last commit, before GK-265 began
    const { execSync } = await import('node:child_process');
    const diff = execSync(`git diff ${beforeSha} ${afterSha} -- api/list-ebay.js api/delist-ebay.js api/ebay-outcome-reconciler.js`, { cwd: repoRoot }).toString();
    assertTrue(diff.trim() === '', 'BOUNDARY: zero diff on list-ebay.js/delist-ebay.js/ebay-outcome-reconciler.js within GK-264\'s own commit range (644d157..767f254) -- GK-265 is a separate, later, authorized dispatch that does convert these files');
  }
} finally {
  // ── Cleanup — real transient rows only. ──
  await dbClient.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id IN ($1, $2)`, [JIMMY, PRINCIPAL_B]);
  await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [PRINCIPAL_B]);
  console.log('\n  (test cleanup) all transient marketplace_connection rows and Principal B deleted\n');
  await dbClient.end();
  await closePool();
}

console.log(`${'='.repeat(60)}`);
console.log(`GK-264 RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
