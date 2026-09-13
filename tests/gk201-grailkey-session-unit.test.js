// tests/gk201-grailkey-session-unit.test.js
//
// CODE CERTIFICATION — src/lib/grailkeySession.js, the client-side token
// holder the new login gate and operator panel both depend on. Plain Node
// has no localStorage; a minimal in-memory shim is installed on globalThis
// before the module is imported (the module reads it lazily inside each
// function call, never at import time, so this ordering is sufficient).
//
// Invoke: node tests/gk201-grailkey-session-unit.test.js

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

const { getSession, setSession, clearSession, isAuthenticated, authFetch, getPrincipalScope } = await import('../src/lib/grailkeySession.js');

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

assertTrue(getSession() === null, 'no session initially');
assertTrue(isAuthenticated() === false, 'isAuthenticated false with no session');

setSession('tok-123', Date.now() + 60_000);
const s = getSession();
assertTrue(s !== null && s.token === 'tok-123', 'setSession then getSession round-trips the token');
assertTrue(isAuthenticated() === true, 'isAuthenticated true after a valid session is set');

clearSession();
assertTrue(getSession() === null, 'clearSession removes the session');

setSession('expired-tok', Date.now() - 1000);
assertTrue(getSession() === null, 'an already-expired session reads back as null');
assertTrue(localStorage.getItem('gk_session_token') === null, 'reading an expired session also clears it from storage');

// authFetch: no session -> no network call, returns null.
setSession('fetch-tok', Date.now() + 60_000);
let fetchCalledWith = null;
globalThis.fetch = async (url, opts) => { fetchCalledWith = { url, opts }; return { ok: true, status: 200 }; };
const res = await authFetch('/api/assets?gkAssetId=x');
assertTrue(res && res.status === 200, 'authFetch performs the request when a session exists');
assertTrue(fetchCalledWith.opts.headers.Authorization === 'Bearer fetch-tok', 'authFetch attaches the Bearer header from the stored token');

clearSession();
const res2 = await authFetch('/api/assets?gkAssetId=x');
assertTrue(res2 === null, 'authFetch returns null (never calls fetch) when there is no session');

// getPrincipalScope: decodes the (unencrypted, HMAC-signed-only) payload
// segment of the REAL token format token.js issues — no server call needed.
clearSession();
assertTrue(getPrincipalScope() === null, 'no session -> no principal scope');

function fakeToken(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.fake-signature-not-verified-client-side`;
}

setSession(fakeToken({ principalId: 'principal-xyz', iat: Date.now(), exp: Date.now() + 60_000, epoch: '1' }), Date.now() + 60_000);
assertTrue(getPrincipalScope() === 'principal-xyz', 'decodes principalId out of a genuine token payload shape');

setSession('not-even-base64.garbage', Date.now() + 60_000);
assertTrue(getPrincipalScope() === null, 'a malformed token yields null, never throws');

setSession(fakeToken({ iat: Date.now(), exp: Date.now() + 60_000 }), Date.now() + 60_000); // no principalId field
assertTrue(getPrincipalScope() === null, 'a payload with no principalId field yields null, not a garbage value');

clearSession();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
