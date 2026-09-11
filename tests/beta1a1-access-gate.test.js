// tests/beta1a1-access-gate.test.js
//
// BETA-1A.1 — proves the legacy shared-secret access gate
// (src/lib/accessGate.js, used by api/enrich.js, api/comps.js,
// api/grade.js) now accepts a genuinely verified GrailKey session as an
// ALTERNATE credential alongside the pre-existing ACCESS_CODE/x-vault-key
// path, without weakening it: an unauthenticated caller still fails
// closed, and a forged/garbage Authorization header cannot bypass
// anything (it falls through to the exact same vault-key check that
// already existed). Also proves the client-side mount-time modal
// predicate (App.jsx) no longer forces the prompt open for an
// authenticated session, and that the pre-existing passphrase login path
// (api/auth-login.js) is unmodified and still functioning.
//
// Invoke: node tests/beta1a1-access-gate.test.js

import { randomBytes } from 'node:crypto';

process.env.GRAILKEY_SESSION_SECRET = process.env.GRAILKEY_SESSION_SECRET || randomBytes(32).toString('base64url');
process.env.GRAILKEY_SESSION_EPOCH = process.env.GRAILKEY_SESSION_EPOCH || 'test-epoch-1';
process.env.ACCESS_CODE = 'test-vault-code-xyz';

const { checkAccessGate } = await import('../src/lib/accessGate.js');
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

console.log('--- src/lib/accessGate.js: checkAccessGate ---');

// 1. Authenticated principal → access-code gate NOT shown (passes with
// zero vault key, a real, freshly-issued, genuinely-verifiable token).
{
  const { token } = issueToken({ principalId: 'principal-real-user' });
  const result = checkAccessGate(req({ bearer: token }));
  assertTrue(result === null, 'a valid authenticated GrailKey session passes the gate with NO vault key at all');
}

// 2. Signed-out user → cannot reach application (no token, no vault key).
{
  const result = checkAccessGate(req({}));
  assertTrue(result !== null && result.status === 401, 'a completely signed-out request (no Bearer, no vault key) is rejected 401');
}
{
  const result = checkAccessGate(req({ vaultKey: 'totally-wrong-code' }));
  assertTrue(result !== null && result.status === 401, 'a wrong vault key with no Bearer token is still rejected 401');
}

// 3. Forged client auth state cannot bypass server authorization.
{
  const result = checkAccessGate(req({ bearer: 'not-a-real-token.garbage-signature' }));
  assertTrue(result !== null && result.status === 401, 'a garbage/forged Bearer token is rejected — falls through to the vault-key check, which also fails with none supplied');
}
{
  // A tampered-but-real-shaped token (valid structure, wrong signature).
  const { token } = issueToken({ principalId: 'principal-attacker-claim' });
  const [payloadB64, sig] = token.split('.');
  const tampered = `${payloadB64}.${sig.slice(0, -2)}xx`;
  const result = checkAccessGate(req({ bearer: tampered }));
  assertTrue(result !== null && result.status === 401, 'a tampered-signature token is rejected — cannot forge a principal claim into a passing gate');
}
{
  // Forged token PLUS a wrong vault key together — still rejected, proving
  // the two checks are independent, neither weakens the other.
  const result = checkAccessGate(req({ bearer: 'garbage.garbage', vaultKey: 'wrong' }));
  assertTrue(result !== null && result.status === 401, 'a forged token combined with a wrong vault key is still rejected');
}

// 4. The pre-existing shared-secret path is fully preserved, unweakened —
// still works standalone with no GrailKey session at all (e.g. an
// external script or admin tool with no principal).
{
  const result = checkAccessGate(req({ vaultKey: 'test-vault-code-xyz' }));
  assertTrue(result === null, 'the original x-vault-key === ACCESS_CODE path still passes on its own, unmodified, no Bearer token involved');
}

// 5. Gate fully disabled when ACCESS_CODE is unset — unchanged prior behavior.
{
  delete process.env.ACCESS_CODE;
  const result = checkAccessGate(req({}));
  assertTrue(result === null, 'gate is a no-op when ACCESS_CODE is unset, exactly as before this change');
  process.env.ACCESS_CODE = 'test-vault-code-xyz';
}

console.log('\n--- App.jsx mount-time modal predicate (client-side, logic-level proof) ---');
{
  function makeLocalStorageShim() {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  }
  globalThis.localStorage = makeLocalStorageShim();
  const { setSession, clearSession, isAuthenticated } = await import('../src/lib/grailkeySession.js');

  // The exact predicate now used in App.jsx: `if (!key && !isAuthenticated()) setShowAccessModal(true)`
  function wouldShowModal() {
    const key = localStorage.getItem('vault_key');
    return !key && !isAuthenticated();
  }

  clearSession();
  localStorage.removeItem('vault_key');
  assertTrue(wouldShowModal() === true, 'signed-out, no vault key -> modal WOULD show (fail closed for a genuinely unauthenticated browser)');

  setSession('a-real-grailkey-session-token', Date.now() + 60_000);
  assertTrue(wouldShowModal() === false, 'authenticated GrailKey session (Clerk OR passphrase — grailkeySession.js does not distinguish), no vault key -> modal does NOT show');

  clearSession();
  localStorage.setItem('vault_key', 'some-legacy-code');
  assertTrue(wouldShowModal() === false, 'legacy vault key alone (no GrailKey session) still suppresses the modal — unrelated administrative path unchanged');

  localStorage.removeItem('vault_key');
  clearSession();
}

console.log('\n--- existing passphrase login path (unmodified file) ---');
{
  const loginMod = await import('../api/auth-login.js');
  const loginHandler = loginMod.default;
  const cap = { status: null, body: null };
  const res = { status: (c) => ({ json: (d) => { cap.status = c; cap.body = d; } }), setHeader: () => {} };
  await loginHandler({ method: 'POST', headers: {}, body: {} }, res);
  assertTrue(cap.status === 400, 'api/auth-login.js (untouched by BETA-1A.1) still functions correctly — rejects a request with no passphrase');
}

console.log('\n--- api/enrich.js real-handler smoke (Handler-Wiring Verification, GK-138 spirit) ---');
{
  // enrich.js's inline checkAccessGate was moved to an import this pass —
  // a real invocation of the actual handler proves the wiring itself
  // (not just the extracted function in isolation) still works, exactly
  // the class of bug library-only tests cannot catch.
  const enrichMod = await import('../api/enrich.js');
  const enrichHandler = enrichMod.default;
  const cap = { status: null, body: null };
  const res = { status: (c) => ({ json: (d) => { cap.status = c; cap.body = d; return { statusCode: c, body: d }; } }), setHeader: () => {} };
  let threw = null;
  try {
    await enrichHandler({ method: 'POST', headers: {}, body: {} }, res);
  } catch (e) { threw = e; }
  assertTrue(threw === null, `no exception escaped api/enrich.js's real handler (threw: ${threw ? threw.message : 'none'})`);
  assertTrue(cap.status === 401, `the real enrich.js handler's gate wiring rejects a signed-out, no-vault-key request with 401 (actual: ${cap.status})`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
