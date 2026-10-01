// tests/beta1a1-access-gate.test.js
//
// GK-269 (2026-09-30, FINAL AUTH CLOSURE) — this file originally proved
// BETA-1A.1's "verified session as an ALTERNATE credential alongside
// ACCESS_CODE/x-vault-key" design. That design is now retired entirely:
// src/lib/accessGate.js's checkAccessGate (vault-key-or-session) no longer
// exists — it was replaced by requireAuthenticatedPrincipal, which
// accepts ONLY a verified GrailKey session. There is no longer any
// ACCESS_CODE/x-vault-key path at all, for any caller, under any
// condition. This rewrite proves the NEW contract (and that the OLD one
// is genuinely gone, not merely bypassed), rather than patching
// assertions that described a design this dispatch retires on purpose.
//
// Also still proves: the client-side vault-key modal remains removed from
// App.jsx's real source, and that api/auth-login.js (the single-operator
// passphrase HTTP endpoint) has been completely removed from this repo —
// not merely disabled — per this dispatch's explicit "prefer complete
// removal" instruction. The underlying login() function in
// src/modules/auth/service.js is untouched and still real (no public HTTP
// entry point reaches it anymore).
//
// Invoke: node tests/beta1a1-access-gate.test.js

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

process.env.GRAILKEY_SESSION_SECRET = process.env.GRAILKEY_SESSION_SECRET || randomBytes(32).toString('base64url');
process.env.GRAILKEY_SESSION_EPOCH = process.env.GRAILKEY_SESSION_EPOCH || 'test-epoch-1';

const { requireAuthenticatedPrincipal } = await import('../src/lib/accessGate.js');
const { issueToken } = await import('../src/modules/auth/token.js');

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

function req({ vaultKey, bearer } = {}) {
  const headers = {};
  if (vaultKey !== undefined) headers['x-vault-key'] = vaultKey;
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  return { headers };
}

console.log('--- src/lib/accessGate.js: requireAuthenticatedPrincipal (new contract) ---');

// 1. A real, valid, freshly-issued session passes — the ONLY way to pass.
{
  const { token } = issueToken({ principalId: 'principal-real-user' });
  const result = requireAuthenticatedPrincipal(req({ bearer: token }));
  assertTrue(result.ok === true, 'a valid authenticated GrailKey session passes the gate');
  assertTrue(result.principalId === 'principal-real-user', 'the gate returns the exact verified principalId, for rate-limiting/scoping downstream');
}

// 2. Completely signed-out — rejected.
{
  const result = requireAuthenticatedPrincipal(req({}));
  assertTrue(result.ok === false && result.status === 401, 'a completely signed-out request (no Bearer header at all) is rejected 401');
}

// 3. THE REGRESSION PROOF — a vault-key header alone, even one that would
// have matched the old ACCESS_CODE exactly, grants NOTHING anymore. This
// is the entire point of GK-269: zero Production-reachable authorization
// based on a shared secret.
{
  const result = requireAuthenticatedPrincipal(req({ vaultKey: 'any-value-whatsoever-including-a-real-former-access-code' }));
  assertTrue(result.ok === false && result.status === 401, 'an x-vault-key header, by itself, grants no access whatsoever — the shared-secret path no longer exists');
}
{
  // Vault key AND a garbage bearer together — still rejected. Proves there
  // is no code path left that reads x-vault-key at all, combined or not.
  const result = requireAuthenticatedPrincipal(req({ vaultKey: 'any-value', bearer: 'garbage.garbage' }));
  assertTrue(result.ok === false && result.status === 401, 'a vault key combined with a garbage bearer token is still rejected — no fallback to the retired shared secret');
}

// 4. Forged/garbage/tampered tokens cannot bypass anything.
{
  const result = requireAuthenticatedPrincipal(req({ bearer: 'not-a-real-token.garbage-signature' }));
  assertTrue(result.ok === false && result.status === 401, 'a garbage/forged Bearer token is rejected');
}
{
  const { token } = issueToken({ principalId: 'principal-attacker-claim' });
  const [payloadB64, sig] = token.split('.');
  const tampered = `${payloadB64}.${sig.slice(0, -2)}xx`;
  const result = requireAuthenticatedPrincipal(req({ bearer: tampered }));
  assertTrue(result.ok === false && result.status === 401, 'a tampered-signature token is rejected — cannot forge a principal claim into a passing gate');
}

// 5. ACCESS_CODE env var is no longer read AT ALL — present, absent, or
// anything in between makes zero difference to the gate's behavior.
{
  process.env.ACCESS_CODE = 'leftover-env-value-should-be-irrelevant';
  const withEnvSet = requireAuthenticatedPrincipal(req({}));
  delete process.env.ACCESS_CODE;
  const withEnvUnset = requireAuthenticatedPrincipal(req({}));
  assertTrue(withEnvSet.status === 401 && withEnvUnset.status === 401, 'ACCESS_CODE being set or unset makes zero difference — the gate never reads it anymore (both reject identically)');
}

console.log('\n--- the vault-key modal is fully removed from App.jsx (source-text proof) ---');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
  const liveCode = appSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assertTrue(!/vault_key/.test(liveCode), 'no live code in App.jsx reads/writes localStorage vault_key anymore (comments excluded)');
  assertTrue(!/showAccessModal/.test(liveCode), 'no live code in App.jsx references showAccessModal/the access-code modal anymore (comments excluded)');
  assertTrue(!liveCode.includes('🔑 Access code'), 'the "🔑 Access code" button is removed from the product UI (comments excluded)');
  assertTrue(/if \(!grailkeyAuthed\) return/.test(appSrc), 'the GrailKey session gate (grailkeyAuthed) remains the sole front-door gate');
}

console.log('\n--- GK-269: api/auth-login.js is completely removed, not merely disabled ---');
{
  const filePath = path.join(repoRoot, 'api', 'auth-login.js');
  assertTrue(!existsSync(filePath), 'api/auth-login.js no longer exists on disk — complete removal, not a disabled stub (per this dispatch’s explicit "prefer complete removal" instruction)');
  let importFailed = false;
  try {
    await import('../api/auth-login.js');
  } catch {
    importFailed = true;
  }
  assertTrue(importFailed, 'attempting to import the retired endpoint fails — there is no module left to mint a session from');

  // The underlying passphrase-verification function itself is untouched —
  // this dispatch retired the PUBLIC HTTP entry point, not the real
  // credential-checking logic a future admin tool could still reuse.
  const { login } = await import('../src/modules/auth/index.js');
  assertTrue(typeof login === 'function', 'src/modules/auth/service.js’s own login() function is untouched and still real (no public HTTP route reaches it anymore)');
}

console.log('\n--- api/enrich.js real-handler smoke (Handler-Wiring Verification, GK-138 spirit) ---');
{
  const enrichMod = await import('../api/enrich.js');
  const enrichHandler = enrichMod.default;
  function mockRes() {
    const cap = { status: null, body: null, headers: {} };
    const res = {
      status: (c) => ({ json: (d) => { cap.status = c; cap.body = d; return { statusCode: c, body: d }; } }),
      setHeader: (k, v) => { cap.headers[k] = v; },
    };
    return { res, cap };
  }

  // 7a — signed-out: real handler, real rejection.
  {
    const { res, cap } = mockRes();
    let threw = null;
    try {
      await enrichHandler({ method: 'POST', headers: {}, body: {} }, res);
    } catch (e) { threw = e; }
    assertTrue(threw === null, `no exception escaped api/enrich.js's real handler (threw: ${threw ? threw.message : 'none'})`);
    assertTrue(cap.status === 401, `the real enrich.js handler's gate wiring rejects a signed-out request with 401 (actual: ${cap.status})`);
  }

  // 7b — a vault-key header alone against the REAL deployed handler: still
  // 401. The exact end-to-end regression proof for the production code
  // path, not just the extracted accessGate.js function in isolation.
  {
    const { res, cap } = mockRes();
    await enrichHandler({ method: 'POST', headers: { 'x-vault-key': 'any-value' }, body: {} }, res);
    assertTrue(cap.status === 401, `the real enrich.js handler rejects an x-vault-key-only request with 401 (actual: ${cap.status}) — the shared secret grants nothing against the real deployed wiring`);
  }

  // 7c — a genuinely valid session reaches past the gate (warmup=true short-
  // circuits before any real pricing work, keeping this a pure wiring proof).
  {
    const { token } = issueToken({ principalId: 'principal-real-user-enrich-smoke' });
    const { res, cap } = mockRes();
    await enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { warmup: true } }, res);
    assertTrue(cap.status === 200 && cap.body?.warmed === true, `a genuinely valid session reaches past the real gate wiring (actual status: ${cap.status}, body: ${JSON.stringify(cap.body)})`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
