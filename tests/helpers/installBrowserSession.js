// tests/helpers/installBrowserSession.js — shared test shim for code that
// uses the principal-scoped IndexedDB (src/db.js). Importing this module
// (BEFORE src/db.js) installs a minimal localStorage/window and signs in a
// fixed test principal, so pre-existing IndexedDB behavior tests exercise
// the SAME code path under a real (scoped) session. LIVE EXPOSURE CLOSURE,
// 2026-10-04: src/db.js now refuses to open without an authenticated
// principal, by design.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}
if (typeof globalThis.window === 'undefined') globalThis.window = new EventTarget();

export const TEST_PRINCIPAL = 'test-principal-fixture';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const tokenFor = (principalId) => `${b64u({ principalId })}.test-sig`;
export const signInTestPrincipal = (principalId = TEST_PRINCIPAL) => {
  localStorage.setItem('gk_session_token', tokenFor(principalId));
  localStorage.setItem('gk_session_expires_at', String(Date.now() + 3600_000));
};
signInTestPrincipal();
