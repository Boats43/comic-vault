// src/lib/protectedImages.js - GK-L1B client half (v3): protected collection images via a short-lived COOKIE credential.
//
// getComicPhotos() (App.jsx) is SYNCHRONOUS and used at ~15 render/packet sites, so this module keeps that contract:
// getProtectedImageUrl(itemId, index) returns a plain same-origin URL that carries ONLY identifiers
// (/api/collection-image-v2?p=<principal>&id=<item>&i=<index>) - never a credential - or null while no credential exists.
//
// CREDENTIAL: ONE authenticated POST /api/collection-image-v2 (Bearer, via apiFetch) makes the server set an HttpOnly,
// Secure, SameSite=Strict, path-scoped cookie valid for 10 minutes. That single mint serves EVERY image on the page
// (no per-card request). The cookie is invisible to this code (HttpOnly) and to any injected script; the URL contains no
// secret, so nothing that records URLs (CDN, platform logs, history, Referer) can capture a usable credential.
//
//   * PRINCIPAL-SCOPED: the URL embeds the principal, the cache is dropped when the session principal changes or the
//     session expires, and the server rejects a cookie whose principal differs from the URL's (stale-cookie safe).
//   * REFRESH: re-minted in the background once < 3 minutes remain. A refresh does NOT change any URL, so the browser's
//     private image cache stays warm.
//   * EXPIRED-CREDENTIAL RECOVERY: an <img> that still fails (suspended tab, revoked epoch, cleared cookie) triggers ONE
//     recovery per window via a capturing 'error' listener: re-mint, bump a cache-buster, re-render. No dead end, no storm.
//   * OFFLINE: nothing is persisted. A device that holds the original photo locally never reaches this code
//     (getComicPhotos prefers local `images`/`image`). A remote-only image renders absent offline and fills in when the
//     network and session return. A failed mint backs off 30 s.
//   * LOGOUT / SESSION EXPIRY: state is wiped and the cookie is cleared (best-effort DELETE).

import { apiFetch, getPrincipalScope } from './grailkeySession.js';

export const IMAGE_ENDPOINT_V2 = '/api/collection-image-v2';
export const CREDENTIAL_TTL_FALLBACK_MS = 9 * 60 * 1000;
export const REFRESH_MARGIN_MS = 3 * 60 * 1000;
export const FAILURE_BACKOFF_MS = 30 * 1000;
export const RECOVERY_MIN_GAP_MS = 20 * 1000;

let transport = (url, options) => apiFetch(url, options);
export const setProtectedImagesTransport = (fn) => { transport = fn || ((url, options) => apiFetch(url, options)); };
let clearTransport = (url, options) => fetch(url, options);
export const setProtectedImagesClearTransport = (fn) => { clearTransport = fn || ((url, options) => fetch(url, options)); };
let clock = () => Date.now();
export const setProtectedImagesClock = (fn) => { clock = fn || (() => Date.now()); };
let scopeFn = () => getPrincipalScope();
export const setProtectedImagesScopeFn = (fn) => { scopeFn = fn || (() => getPrincipalScope()); };

let scope = null;
let credExpiresAt = 0;      // 0 = no credential
let version = 0;            // bumped only by a failure recovery (cache-buster)
let minting = null;         // in-flight mint promise
let backoffUntil = 0;
let lastRecovery = 0;
const listeners = new Set();
export const stats = { mints: 0, recoveries: 0 };

const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* a bad subscriber must not break image loading */ } } };

function wipe() { credExpiresAt = 0; minting = null; backoffUntil = 0; lastRecovery = 0; }

export function resetProtectedImages() { wipe(); scope = null; version = 0; stats.mints = 0; stats.recoveries = 0; }

function currentScope() {
  const s = scopeFn();
  if (s !== scope) { wipe(); scope = s; version += 1; }
  return s;
}

async function mint({ announce }) {
  if (minting) return minting;
  if (clock() < backoffUntil) return null;
  const startedScope = scope;
  minting = (async () => {
    let ok = false;
    try {
      const res = await transport(IMAGE_ENDPOINT_V2, { method: 'POST' });
      if (scope !== startedScope) return; // principal changed mid-flight: discard (never adopt another account's credential)
      if (res && res.ok) {
        const body = await res.json().catch(() => ({}));
        if (scope !== startedScope) return;
        credExpiresAt = Number(body?.expiresAt) || clock() + CREDENTIAL_TTL_FALLBACK_MS;
        stats.mints += 1;
        ok = true;
      } else {
        backoffUntil = clock() + FAILURE_BACKOFF_MS;
      }
    } catch {
      backoffUntil = clock() + FAILURE_BACKOFF_MS; // offline / network error
    } finally {
      minting = null;
    }
    if (ok && announce) notify();
  })();
  return minting;
}

/** URL for (itemId, index) once a credential exists, else null (and a mint is started). Never throws, never blocks. */
export function getProtectedImageUrl(itemId, index) {
  if (typeof itemId !== 'string' || !itemId || !Number.isInteger(index) || index < 0) return null;
  const s = currentScope();
  if (!s) return null;
  const now = clock();
  if (!credExpiresAt || credExpiresAt <= now) {
    mint({ announce: true });
    return null;
  }
  if (credExpiresAt - now < REFRESH_MARGIN_MS) mint({ announce: false }); // silent refresh: URLs unchanged
  return `${IMAGE_ENDPOINT_V2}?p=${encodeURIComponent(s)}&id=${encodeURIComponent(itemId)}&i=${index}${version ? `&v=${version}` : ''}`;
}

export function subscribeProtectedImages(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const isProtectedImageSrc = (src) => {
  try { return new URL(src, 'http://local').pathname === IMAGE_ENDPOINT_V2; } catch { return false; }
};

/** Wires expired-credential recovery + lifecycle. Returns an uninstall function. */
export function installImageRecovery(win = (typeof window !== 'undefined' ? window : null)) {
  if (!win) return () => {};
  const doc = win.document;
  const recover = () => {
    const now = clock();
    if (now - lastRecovery < RECOVERY_MIN_GAP_MS) return; // one recovery per window - no storm
    lastRecovery = now;
    stats.recoveries += 1;
    credExpiresAt = 0; backoffUntil = 0; version += 1;
    mint({ announce: true });
  };
  const onImgError = (ev) => {
    const el = ev?.target;
    if (!el || el.tagName !== 'IMG') return;
    if (!isProtectedImageSrc(el.getAttribute('src') || '')) return;
    if (!currentScope()) return;
    recover();
  };
  const onExpired = () => {
    resetProtectedImages();
    try { clearTransport(IMAGE_ENDPOINT_V2, { method: 'DELETE' })?.catch?.(() => {}); } catch { /* best effort */ }
    notify();
  };
  const refreshSoon = () => { notify(); }; // re-render -> getProtectedImageUrl re-mints anything stale
  doc?.addEventListener?.('error', onImgError, true);
  win.addEventListener?.('grailkey:session-expired', onExpired);
  win.addEventListener?.('online', refreshSoon);
  doc?.addEventListener?.('visibilitychange', refreshSoon);
  const timer = win.setInterval ? win.setInterval(() => {
    if (doc && doc.visibilityState === 'hidden') return;
    if (scope && credExpiresAt && credExpiresAt - clock() < REFRESH_MARGIN_MS) mint({ announce: false });
  }, 60 * 1000) : null;
  return () => {
    doc?.removeEventListener?.('error', onImgError, true);
    win.removeEventListener?.('grailkey:session-expired', onExpired);
    win.removeEventListener?.('online', refreshSoon);
    doc?.removeEventListener?.('visibilitychange', refreshSoon);
    if (timer && win.clearInterval) win.clearInterval(timer);
  };
}
