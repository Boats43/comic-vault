// src/lib/grailkeySession.js — minimal client-side session holder for the
// DATA-1D bearer-token auth contract (api/auth-login.js / src/modules/auth/).
//
// No refresh mechanism (matches the backend: a token simply expires and the
// caller logs in again — docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md, T1). No
// server-side per-token logout exists either (stateless HMAC tokens) — logout
// here is exactly what it can honestly be: discarding the locally-held token.
//
// Never logs the token or passphrase anywhere in this file.

import { isOutdatedClientResponse } from './clientContract.js';

const TOKEN_KEY = 'gk_session_token';
const EXPIRES_KEY = 'gk_session_expires_at';

export function getSession() {
  let token, expiresAt;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    expiresAt = Number(localStorage.getItem(EXPIRES_KEY));
  } catch {
    return null; // localStorage unavailable (private mode, etc.) — treat as logged out
  }
  if (!token || !expiresAt || Number.isNaN(expiresAt)) return null;
  if (Date.now() >= expiresAt) {
    clearSession();
    return null;
  }
  return { token, expiresAt };
}

export function setSession(token, expiresAt) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  } catch {
    // localStorage unavailable — session simply won't persist across reloads
  }
}

// GK-268 AUTH LAUNCH (2026-09-30) — every call site that already detects a
// stale/invalid/expired session (there were ~6 scattered across App.jsx,
// each independently calling clearSession() then separately flipping its
// own local "authed" state) now gets that second step for free: a
// 'grailkey:session-expired' event fires on every clearSession() call, so
// App.jsx needs exactly ONE listener (mounted once, near grailkeyAuthed's
// own useState) instead of a parallel setGrailkeyAuthed(false) at each
// call site. Dispatched AFTER the localStorage removal succeeds/no-ops, so
// a listener reading getSession()/isAuthenticated() during the event
// always sees the already-cleared state. No-op in a non-browser context
// (no `window`), matching this file's existing defensive try/catch style.
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // no-op
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('grailkey:session-expired'));
    }
  } catch {
    // no-op — a dispatch failure must never prevent the session from
    // being considered cleared.
  }
}

export function isAuthenticated() {
  return getSession() !== null;
}

// getPrincipalScope — the smallest existing client-side identifier for
// namespacing purely-local state (e.g. pending OperatorAction idempotency
// keys, src/lib/operatorActionIdempotency.js) across different operators
// sharing one browser. This is a LOCAL NAMESPACE ONLY — it is never sent to
// the server and never used as authorization; the server continues to
// derive the authenticated principal exclusively from the verified bearer
// token itself (src/modules/auth/token.js's own verifyToken).
//
// Requires no backend change: the token's payload segment is base64url-JSON,
// not encrypted (only HMAC-signed for integrity) — decoding it client-side
// to read the principalId label back out is reading data the client already
// holds, not a new capability. If decoding ever fails, callers get null and
// fall back to an unscoped default themselves.
function decodeTokenPayload(token) {
  try {
    const [payloadB64] = token.split('.');
    const std = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function getPrincipalScope() {
  const session = getSession();
  if (!session) return null;
  const payload = decodeTokenPayload(session.token);
  return (payload && typeof payload.principalId === 'string') ? payload.principalId : null;
}

// ─────────────────────────────────────────────────────────────────────
// AUTH RECOVERY (GK-268 addendum): SERVER 401 = AUTHENTICATION STATE INVALID.
//
// ONE auth-aware path for every authenticated client call:
//   * the current Bearer token is injected (never silently omitted);
//   * a locally-expired / missing session is NEVER sent as valid auth — the
//     request is not made at all, the stale session is cleared (idempotent;
//     fires the one 'grailkey:session-expired' listener -> login screen), and a
//     synthetic 401 { error: 'AUTH_EXPIRED', authExpired: true } is returned;
//   * an HTTP 401 clears the session ONLY IF the token that was sent is still
//     the current one (a late 401 for an OLD token must not log out a session
//     the user has since re-established — no login/logout loop);
//   * 403/409/422/429/503/5xx and network errors NEVER clear the session
//     (GK-279's 409 PHYSICAL_COPY_DECISION_REQUIRED and 503
//     PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE are control flow, not auth);
//   * NOTHING is ever retried or replayed here — a failed mutating request is
//     not re-sent (with or without Authorization); the user deliberately retries
//     after signing in again. No refresh tokens, no silent re-auth.
// ─────────────────────────────────────────────────────────────────────
export const AUTH_EXPIRED_ERROR = 'AUTH_EXPIRED';

// U1 closeout — the server refused a request because THIS app version predates the mandatory-category
// contract (CATEGORY_REQUIRED_CLIENT_OUTDATED). One central event; App.jsx shows "Update the app and try
// again.". Never clears the session, never retries, never says the asset is invalid.
function signalIfOutdatedClient(res) {
  try {
    if (isOutdatedClientResponse(res) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('grailkey:client-outdated'));
    }
  } catch {
    // no-op
  }
}

function authExpiredResponse() {
  return new Response(JSON.stringify({ error: AUTH_EXPIRED_ERROR, authExpired: true, message: 'Your session expired — please sign in again.' }), {
    status: 401, headers: { 'Content-Type': 'application/json', 'x-grailkey-auth-expired': '1' },
  });
}

export function isAuthExpiredResponse(res) {
  return !!res && res.status === 401;
}

function currentToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

// Clears only when `sentToken` is still the session in storage.
function clearSessionIfStillCurrent(sentToken) {
  if (currentToken() === sentToken) clearSession();
}

// apiFetch — for authenticated app calls whose callers expect a Response (they
// already branch on res.ok / res.status). Never returns null.
export async function apiFetch(url, options = {}) {
  const session = getSession(); // clears + emits when locally expired
  if (!session) {
    clearSession(); // idempotent; also syncs UI if storage was emptied elsewhere
    return authExpiredResponse();
  }
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${session.token}` };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) clearSessionIfStillCurrent(session.token);
  signalIfOutdatedClient(res);
  return res;
}

// authFetch — attaches the Bearer token to every call. Returns null (never
// throws, never calls fetch) when there is no valid session, so callers can
// treat "not logged in" and "logged out mid-request" identically without a
// try/catch at every call site. Same 401 semantics as apiFetch.
export async function authFetch(url, options = {}) {
  const session = getSession();
  if (!session) return null;
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${session.token}` };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) clearSessionIfStillCurrent(session.token);
  signalIfOutdatedClient(res);
  return res;
}
