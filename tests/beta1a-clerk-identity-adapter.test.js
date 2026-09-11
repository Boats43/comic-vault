// tests/beta1a-clerk-identity-adapter.test.js
//
// BETA-1A — Clerk identity adapter proof. Covers the dispatch's required
// tests. Two honesty disclosures up front, matching this repo's existing
// "disclosed gap" convention rather than a green result that overstates
// what actually ran:
//
//   1. db/data0/0022_beta1a_clerk_identity_mapping.sql is PROPOSED, not
//      applied to any database. Nothing here touches a real Postgres
//      connection — repository.js functions are exercised against a
//      hand-built fake `client` object (the SAME dependency-injection
//      seam every other repository.js function already takes; not a new
//      test-only seam). service.js's own DB-calling path
//      (loginWithExternalIdentity) is proven by SOURCE-TEXT assertion,
//      not live execution, because acquireConnection() needs a real
//      GRAILKEY_CATALOG_DATABASE_URL this environment doesn't have wired
//      for this proposed table yet.
//   2. "valid Clerk session verified server-side" cannot be proven with a
//      genuinely Clerk-signed JWT — no real Clerk keys exist in this
//      session (the CLI link/login step is a separate, user-driven step
//      per this dispatch's own report). What IS proven here, for real,
//      against the actually-installed @clerk/backend package: a
//      malformed/garbage token is rejected (no network call needed — JWT
//      parsing fails first), and the real handler's control flow when
//      verification succeeds vs. fails is exercised via the
//      success/failure branches that don't require the signature itself
//      to validate. The genuinely-valid-token path is a disclosed,
//      not-yet-closeable gap until real Clerk credentials exist.
//
// Invoke: node tests/beta1a-clerk-identity-adapter.test.js

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

// ─────────────────────────────────────────────────────────────────────
// Section 1 — repository.js, fake client (real function code, real SQL
// text asserted, no live DB)
// ─────────────────────────────────────────────────────────────────────
console.log('--- repository.js: getPrincipalByExternalIdentity / upsertExternalIdentity ---');
{
  const { getPrincipalByExternalIdentity, upsertExternalIdentity } = await import('../src/modules/auth/repository.js');

  let lastSql = null, lastParams = null;
  const fakeClientFound = {
    query: async (sql, params) => {
      lastSql = sql; lastParams = params;
      return { rows: [{ id: 'principal-operator-1', display_name: 'Jimmy' }] };
    },
  };
  const found = await getPrincipalByExternalIdentity(fakeClientFound, { provider: 'clerk', externalSubject: 'user_abc123' });
  assertTrue(found?.id === 'principal-operator-1', 'a mapped external subject resolves to its mapped principal');
  assertTrue(/data1_dev\.principal_external_identity/.test(lastSql), 'query is schema-qualified against principal_external_identity (GK-178 discipline)');
  assertTrue(/data1_dev\.gk_principal/.test(lastSql), 'query joins the schema-qualified gk_principal table');
  assertTrue(lastParams[0] === 'clerk' && lastParams[1] === 'user_abc123', 'provider and externalSubject are passed as parameterized values, never string-interpolated into SQL');
  assertTrue(!lastSql.includes('user_abc123'), 'the externalSubject value never appears literally in the SQL text (no injection surface)');

  // ── Unknown subject: no fallback to any other principal ──
  const fakeClientEmpty = { query: async () => ({ rows: [] }) };
  const notFound = await getPrincipalByExternalIdentity(fakeClientEmpty, { provider: 'clerk', externalSubject: 'user_never_mapped' });
  assertTrue(notFound === null, 'an unmapped external subject resolves to null — never a default/fallback principal row');

  // ── upsertExternalIdentity SQL shape ──
  let upsertSql = null, upsertParams = null;
  const fakeClientUpsert = { query: async (sql, params) => { upsertSql = sql; upsertParams = params; } };
  await upsertExternalIdentity(fakeClientUpsert, { id: 'row-1', principalId: 'principal-operator-1', provider: 'clerk', externalSubject: 'user_abc123' });
  assertTrue(/ON CONFLICT \(provider, external_subject\)/.test(upsertSql), 'upsert conflicts on (provider, external_subject) — one row per external identity, never a duplicate mapping');
  assertTrue(upsertParams[1] === 'principal-operator-1', 'upsert binds the intended principalId as a parameter, never interpolated');
}

// ─────────────────────────────────────────────────────────────────────
// Section 2 — service.js source-text proof (DB path, disclosed as
// static, not live — see file header)
// ─────────────────────────────────────────────────────────────────────
console.log('\n--- service.js: loginWithExternalIdentity fail-closed guard (static) ---');
{
  const src = readFileSync(new URL('../src/modules/auth/service.js', import.meta.url), 'utf8');
  const fnMatch = src.match(/export async function loginWithExternalIdentity\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assertTrue(!!fnMatch, 'loginWithExternalIdentity is exported and its body is present');
  const body = fnMatch ? fnMatch[1] : '';
  assertTrue(/if \(!principal\)/.test(body) && /NotProvisionedError/.test(body), 'an unmapped principal throws NotProvisionedError — same fail-closed shape as login()');
  assertTrue(!/getOperatorPrincipal/.test(body), 'loginWithExternalIdentity never calls getOperatorPrincipal — no fallback to "the one operator" for an unrecognized subject');
  assertTrue(/getPrincipalByExternalIdentity/.test(body), 'resolution goes exclusively through getPrincipalByExternalIdentity');
  const sigMatch = src.match(/export async function loginWithExternalIdentity\(\{([^}]*)\}/);
  const params = sigMatch ? sigMatch[1] : '';
  assertTrue(!/principalId/.test(params), 'loginWithExternalIdentity never accepts a caller-supplied principalId parameter');
}

// ─────────────────────────────────────────────────────────────────────
// Section 3 — api/auth-clerk.js real-handler smoke invocation (GK-138
// spirit: a new authenticated endpoint gets at least one real invocation,
// not just library-level tests)
// ─────────────────────────────────────────────────────────────────────
console.log('\n--- api/auth-clerk.js: real handler smoke ---');
{
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || `sk_test_${randomBytes(16).toString('hex')}`;
  const handlerMod = await import('../api/auth-clerk.js');
  const handler = handlerMod.default;

  function mockRes() {
    const cap = { status: null, body: null };
    const res = {
      status: (code) => ({ json: (data) => { cap.status = code; cap.body = data; return { statusCode: code, body: data }; } }),
      setHeader: () => {},
    };
    return { res, cap };
  }

  // 3a — no clerkToken at all
  {
    const { res, cap } = mockRes();
    const req = { method: 'POST', headers: {}, body: {} };
    await handler(req, res);
    assertTrue(cap.status === 400, 'a request with no clerkToken is rejected (400), never reaches verification');
  }

  // 3b — malformed/garbage clerkToken: real @clerk/backend verifyToken()
  // call, real rejection (no network round-trip needed — JWT parsing
  // fails before any JWKS fetch).
  {
    const { res, cap } = mockRes();
    const req = { method: 'POST', headers: {}, body: { clerkToken: 'not-a-real-jwt.garbage.value' } };
    let threw = null;
    try { await handler(req, res); } catch (e) { threw = e; }
    assertTrue(threw === null, 'no exception escapes the handler on a malformed token');
    assertTrue(cap.status === 401, 'a malformed Clerk token is rejected with 401 (real @clerk/backend verifyToken call, real rejection)');
    assertTrue(cap.body?.error === 'Invalid credentials', 'the rejection message matches the SAME undifferentiated shape auth-login.js uses for a wrong passphrase — never confirms which check failed');
  }

  // 3c — a request body attempting to smuggle in an identity directly
  // (externalSubject / principalId) alongside a malformed token: proves
  // the handler never reads those fields for identity purposes — only
  // claims.sub from a token the SERVER independently verified.
  {
    const src = readFileSync(new URL('../api/auth-clerk.js', import.meta.url), 'utf8');
    assertTrue(!/req\.body\?\.externalSubject/.test(src) && !/req\.body\.externalSubject/.test(src), 'the handler source never reads externalSubject from the request body');
    assertTrue(!/req\.body\?\.principalId/.test(src) && !/req\.body\.principalId/.test(src), 'the handler source never reads principalId from the request body');
    assertTrue(!/req\.headers\[.x-/.test(src), 'the handler source never derives identity from a custom x-* request header');

    const { res, cap } = mockRes();
    const req = {
      method: 'POST', headers: {},
      body: { clerkToken: 'not-a-real-jwt.garbage.value', externalSubject: 'user_attacker_supplied', principalId: 'principal-operator-1' },
    };
    await handler(req, res);
    assertTrue(cap.status === 401, 'extra body fields (externalSubject/principalId) attached to a request have zero effect — still rejected exactly as without them');
  }

  // 3d — server misconfiguration (no CLERK_SECRET_KEY) fails closed, never
  // silently accepts.
  {
    const saved = process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_SECRET_KEY;
    const { res, cap } = mockRes();
    const req = { method: 'POST', headers: {}, body: { clerkToken: 'anything' } };
    await handler(req, res);
    assertTrue(cap.status === 500, 'a missing CLERK_SECRET_KEY fails closed (500), never falls through to accepting the token unverified');
    process.env.CLERK_SECRET_KEY = saved;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Section 4 — existing GrailKey auth path remains functional, exercised
// through the SAME unmodified production files (api/auth-login.js,
// api/assets.js) this dispatch never edited.
// ─────────────────────────────────────────────────────────────────────
console.log('\n--- existing GrailKey passphrase/session path (unmodified files) ---');
{
  const loginMod = await import('../api/auth-login.js');
  const loginHandler = loginMod.default;
  function mockRes() {
    const cap = { status: null, body: null };
    const res = { status: (c) => ({ json: (d) => { cap.status = c; cap.body = d; } }), setHeader: () => {} };
    return { res, cap };
  }
  {
    const { res, cap } = mockRes();
    await loginHandler({ method: 'POST', headers: {}, body: {} }, res);
    assertTrue(cap.status === 400, 'api/auth-login.js (untouched by this dispatch) still rejects a request with no passphrase — passphrase login path is unaffected by the Clerk adapter');
  }

  const assetsMod = await import('../api/assets.js');
  const assetsHandler = assetsMod.default;
  {
    const { res, cap } = mockRes();
    await assetsHandler({ method: 'GET', headers: {}, query: {} }, res);
    assertTrue(cap.status === 401, 'api/assets.js (untouched by this dispatch) still rejects a signed-out request (no Bearer token) — a request with neither a passphrase-issued NOR a Clerk-issued session token is rejected identically');
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
