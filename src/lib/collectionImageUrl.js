// src/lib/collectionImageUrl.js - GK-L1B (2026-10-11, amended v3): SHORT-LIVED COLLECTION-IMAGE CREDENTIAL.
//
// Why: the former /api/collection-image served any item's display image to ANY caller that knew the item id
// (unauthenticated, unscoped, year-long public cache). A plain <img src> cannot send an Authorization header.
//
// TRANSPORT (amended after the v3 credential-logging review): the image credential travels in a COOKIE, never in the
// URL. A signed token placed in a query string or path would be part of the request URL, and request URLs are what
// CDNs, platform request logs, browser history, Referer headers and proxies record - we cannot prove none of them
// keeps it, so it is not allowed to be there at all. The URL carries only the non-secret identifiers the lookup
// needs (principal, item, index).
//
//   cookie  gk_img = base64url(JSON{v,p,e,ep}) "." base64url(HMAC-SHA256(derivedKey, payloadB64))
//     p  principal id   e  absolute expiry (ms, 10 minutes after mint)   ep  session epoch
//   attributes: HttpOnly; Secure; SameSite=Strict; Path=/api/collection-image-v2; Max-Age=600
//
// * HttpOnly: page JavaScript (and any injected script) can never read it. Secure: HTTPS only.
//   SameSite=Strict: a cross-site page can never make the browser attach it (no cross-site <img> read, no CSRF).
//   Path-scoped: it is sent to this one endpoint only - never to /api/grade, /api/collection, logs of other routes...
// * The signing key is DERIVED from GRAILKEY_SESSION_SECRET with a domain-separation label, so a session token can
//   never be replayed as an image credential and vice versa. GRAILKEY_SESSION_EPOCH is bound in: bumping it
//   revokes every outstanding credential at once.
// * The lookup is ALWAYS `principal_id AND id` with the principal taken from the VERIFIED cookie; the `p` in the URL is
//   only a consistency check (a stale cookie from another account can never serve this account's page).
// * Fail closed: a missing/weak secret throws on mint and verifies as unavailable - never a fallback.
// * Nothing here ever logs a token, a cookie header or a secret.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const IMAGE_CREDENTIAL_TTL_MS = 10 * 60 * 1000;
export const IMAGE_CREDENTIAL_VERSION = 3;
export const IMAGE_COOKIE_NAME = 'gk_img';
export const IMAGE_ENDPOINT_V2 = '/api/collection-image-v2';
const MIN_SECRET_LENGTH = 32;
const KEY_LABEL = 'grailkey/collection-image-credential/v3';

function derivedKey() {
  const s = process.env.GRAILKEY_SESSION_SECRET;
  if (!s || s.length < MIN_SECRET_LENGTH) throw new Error('[collectionImageUrl] GRAILKEY_SESSION_SECRET missing or below the 32-char floor');
  return createHmac('sha256', s).update(KEY_LABEL).digest();
}
const epoch = () => process.env.GRAILKEY_SESSION_EPOCH || '1';
const sign = (payloadB64) => createHmac('sha256', derivedKey()).update(payloadB64).digest('base64url');

export function mintImageCredential({ principalId, now = Date.now(), ttlMs = IMAGE_CREDENTIAL_TTL_MS } = {}) {
  if (typeof principalId !== 'string' || !principalId) throw new Error('principalId required');
  const payload = { v: IMAGE_CREDENTIAL_VERSION, p: principalId, e: now + ttlMs, ep: epoch() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt: payload.e, maxAgeSeconds: Math.max(1, Math.floor(ttlMs / 1000)) };
}

/** @returns {{ok:true, principalId, expiresAt} | {ok:false, reason:'missing'|'malformed'|'signature'|'expired'|'epoch'|'unavailable'}} */
export function verifyImageCredential(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing' };
  if (token.length > 2048) return { ok: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected;
  try { expected = sign(payloadB64); } catch { return { ok: false, reason: 'unavailable' }; }
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };
  let p;
  try { p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!p || p.v !== IMAGE_CREDENTIAL_VERSION || typeof p.p !== 'string' || !p.p || typeof p.e !== 'number') return { ok: false, reason: 'malformed' };
  if (p.ep !== epoch()) return { ok: false, reason: 'epoch' };
  if (now > p.e) return { ok: false, reason: 'expired' };
  return { ok: true, principalId: p.p, expiresAt: p.e };
}

/** Reads one cookie value from a raw Cookie header. Never throws. */
export function readCookie(header, name = IMAGE_COOKIE_NAME) {
  if (typeof header !== 'string' || !header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

const ATTRS = `Path=${IMAGE_ENDPOINT_V2}; HttpOnly; Secure; SameSite=Strict`;
export const buildSetCookie = (token, maxAgeSeconds) => `${IMAGE_COOKIE_NAME}=${token}; ${ATTRS}; Max-Age=${maxAgeSeconds}`;
export const buildClearCookie = () => `${IMAGE_COOKIE_NAME}=; ${ATTRS}; Max-Age=0`;

/** The ONLY image URL shape: identifiers only, no credential. `v` is a client-side cache-buster after a recovery. */
export const imageUrl = ({ principalId, itemId, index, version = 0 }) =>
  `${IMAGE_ENDPOINT_V2}?p=${encodeURIComponent(principalId)}&id=${encodeURIComponent(itemId)}&i=${index}${version ? `&v=${version}` : ''}`;
