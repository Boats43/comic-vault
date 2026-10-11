// src/lib/protectedImages.js - GK-L1B client half: signed, short-lived collection-image links.
//
// getComicPhotos() (App.jsx) is SYNCHRONOUS and used at ~15 render/packet sites, so this module keeps that contract:
// getProtectedImageUrl(itemId, index) returns the cached signed link or null, and - as a side effect - schedules ONE
// batched, authenticated POST /api/collection-image-v2 for every item id seen during that tick. When links arrive the
// subscribers (App root) are notified once and re-render, so images fill in; nothing ever blocks a render.
//
//   * AUTHENTICATED MINT ONLY: the request goes through apiFetch (Bearer). No session -> no request, no cache.
//   * PRINCIPAL-SCOPED CACHE: the cache is dropped the moment the session principal changes or the session expires
//     ('grailkey:session-expired'), so account B can never be handed account A's links.
//   * EXPIRY: links live 10 minutes; they are refreshed in the background once < 3 minutes remain. An <img> that
//     still fails (expired in a suspended tab, epoch revoked) triggers a one-shot refresh via a capturing 'error'
//     listener, rate-limited per item - no broken-image dead end and no refresh storm.
//   * OFFLINE: nothing is cached across reloads and nothing is persisted (links are credentials of a sort). A device
//     that holds the original photo locally never reaches this code (getComicPhotos prefers local `images`/`image`).
//     A remote-only image simply renders absent offline and fills in when the network and session return.
//   * FAILURE BACKOFF: a failed mint or a "not yours / no image" answer is remembered briefly so a render loop can't
//     hammer the endpoint.

import { apiFetch, getPrincipalScope } from './grailkeySession.js';

export const IMAGE_ENDPOINT_V2 = '/api/collection-image-v2';
export const REFRESH_MARGIN_MS = 3 * 60 * 1000;
export const NEGATIVE_TTL_MS = 60 * 1000;
export const FAILURE_BACKOFF_MS = 30 * 1000;
export const ERROR_REFRESH_MIN_GAP_MS = 20 * 1000;
const MAX_BATCH = 100;

let transport = (url, options) => apiFetch(url, options);
export const setProtectedImagesTransport = (fn) => { transport = fn || ((url, options) => apiFetch(url, options)); };
let clock = () => Date.now();
export const setProtectedImagesClock = (fn) => { clock = fn || (() => Date.now()); };
let scopeFn = () => getPrincipalScope();
export const setProtectedImagesScopeFn = (fn) => { scopeFn = fn || (() => getPrincipalScope()); };

let scope = null;
const cache = new Map(); // itemId -> { urls: string[], exp: number }
const wanted = new Set();
const inflight = new Set();
const backoff = new Map(); // itemId -> until
const lastErrorRefresh = new Map();
const listeners = new Set();
let scheduled = false;

const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* a bad subscriber must not break image loading */ } } };

export function resetProtectedImages() {
  cache.clear(); wanted.clear(); inflight.clear(); backoff.clear(); lastErrorRefresh.clear(); scope = null; scheduled = false;
}

function currentScope() {
  const s = scopeFn();
  if (s !== scope) { cache.clear(); wanted.clear(); inflight.clear(); backoff.clear(); lastErrorRefresh.clear(); scope = s; }
  return s;
}

async function flush() {
  scheduled = false;
  if (!currentScope()) { wanted.clear(); return; }
  const ids = [...wanted].filter((id) => !inflight.has(id)).slice(0, MAX_BATCH);
  for (const id of ids) wanted.delete(id);
  if (ids.length === 0) return;
  for (const id of ids) inflight.add(id);
  const startedScope = scope;
  let changed = false;
  try {
    const res = await transport(IMAGE_ENDPOINT_V2, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (scope !== startedScope) return; // principal changed mid-flight: discard (never cache another account's links)
    if (res && res.ok) {
      const body = await res.json();
      if (scope !== startedScope) return;
      const now = clock();
      const urls = body?.urls && typeof body.urls === 'object' ? body.urls : {};
      for (const id of ids) {
        const list = Array.isArray(urls[id]) ? urls[id].filter((u) => typeof u === 'string') : [];
        if (list.length) cache.set(id, { urls: list, exp: Number(body.expiresAt) || now + 9 * 60 * 1000 });
        else cache.set(id, { urls: [], exp: now + NEGATIVE_TTL_MS });
      }
      changed = true;
    } else {
      const until = clock() + FAILURE_BACKOFF_MS;
      for (const id of ids) backoff.set(id, until);
    }
  } catch {
    const until = clock() + FAILURE_BACKOFF_MS;
    for (const id of ids) backoff.set(id, until);
  } finally {
    for (const id of ids) inflight.delete(id);
  }
  if (changed) notify();
}

function request(itemId) {
  if (inflight.has(itemId)) return;
  const until = backoff.get(itemId);
  if (until && clock() < until) return;
  wanted.add(itemId);
  if (!scheduled) { scheduled = true; Promise.resolve().then(flush); }
}

/** Cached signed link for (itemId, index), or null. Never throws, never blocks. */
export function getProtectedImageUrl(itemId, index) {
  if (typeof itemId !== 'string' || !itemId || !Number.isInteger(index) || index < 0) return null;
  if (!currentScope()) return null;
  const now = clock();
  const e = cache.get(itemId);
  if (e && e.exp > now) {
    if (e.exp - now < REFRESH_MARGIN_MS && e.urls.length) request(itemId);
    return e.urls[index] ?? null;
  }
  request(itemId);
  return null;
}

export function subscribeProtectedImages(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const itemIdFromImageSrc = (src) => {
  try {
    const u = new URL(src, 'http://local');
    if (u.pathname !== IMAGE_ENDPOINT_V2) return null;
    const t = u.searchParams.get('t');
    const payloadB64 = t && t.split('.')[0];
    if (!payloadB64) return null;
    const std = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(std + '='.repeat((4 - (std.length % 4)) % 4)));
    return typeof p.i === 'string' ? p.i : null;
  } catch { return null; }
};

/** Wires expired-link recovery + lifecycle. Returns an uninstall function. */
export function installImageRecovery(win = (typeof window !== 'undefined' ? window : null)) {
  if (!win) return () => {};
  const doc = win.document;
  const onImgError = (ev) => {
    const el = ev?.target;
    if (!el || el.tagName !== 'IMG') return;
    const id = itemIdFromImageSrc(el.getAttribute('src') || '');
    if (!id) return;
    const now = clock();
    if (now - (lastErrorRefresh.get(id) || 0) < ERROR_REFRESH_MIN_GAP_MS) return; // one recovery per window - no storm
    lastErrorRefresh.set(id, now);
    cache.delete(id); backoff.delete(id);
    request(id);
  };
  const onExpired = () => { resetProtectedImages(); notify(); };
  const refreshSoon = () => { notify(); }; // re-render -> getProtectedImageUrl refreshes anything stale
  doc?.addEventListener?.('error', onImgError, true);
  win.addEventListener?.('grailkey:session-expired', onExpired);
  win.addEventListener?.('online', refreshSoon);
  doc?.addEventListener?.('visibilitychange', refreshSoon);
  const timer = win.setInterval ? win.setInterval(() => {
    if (doc && doc.visibilityState === 'hidden') return;
    const now = clock();
    let any = false;
    for (const [id, e] of cache) if (e.urls.length && e.exp - now < REFRESH_MARGIN_MS) { request(id); any = true; }
    if (!any) return;
  }, 60 * 1000) : null;
  return () => {
    doc?.removeEventListener?.('error', onImgError, true);
    win.removeEventListener?.('grailkey:session-expired', onExpired);
    win.removeEventListener?.('online', refreshSoon);
    doc?.removeEventListener?.('visibilitychange', refreshSoon);
    if (timer && win.clearInterval) win.clearInterval(timer);
  };
}
