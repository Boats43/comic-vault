// src/lib/collectionImageUrl.js - GK-L1B (2026-10-11): SHORT-LIVED SIGNED COLLECTION-IMAGE LINKS.
//
// Why: the former /api/collection-image served any item's display image to ANY caller that knew the item id
// (unauthenticated, unscoped, year-long public cache). A plain <img src> cannot send an Authorization header, and
// putting the session bearer token in a URL would expose a credential that authorizes the whole account. So an
// AUTHENTICATED call (api/collection-image-v2.js POST) mints a link that authorizes exactly ONE image:
//
//   token = base64url(JSON{v,p,i,n,e,ep}) "." base64url(HMAC-SHA256(derivedKey, payloadB64))
//     p  principal id  (the lookup is ALWAYS principal_id AND item id - the token never widens it)
//     i  item id       n  image index       e  absolute expiry (ms)       ep  session epoch
//
// * The signing key is DERIVED from GRAILKEY_SESSION_SECRET with a domain-separation label, so a session token can
//   never be replayed as an image link and an image link can never be replayed as a session token.
// * GRAILKEY_SESSION_EPOCH is bound in: bumping it revokes every outstanding image link (and every session) at once.
// * Fail closed: a missing/weak secret throws on mint and verifies as invalid - it never signs or accepts with a
//   fallback.
// * verify() never throws: it returns {ok:false, reason} so a handler maps it to a stable response.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const IMAGE_LINK_TTL_MS = 10 * 60 * 1000;
export const IMAGE_LINK_VERSION = 2;
const MIN_SECRET_LENGTH = 32;
const KEY_LABEL = 'grailkey/collection-image-link/v2';

function derivedKey() {
  const s = process.env.GRAILKEY_SESSION_SECRET;
  if (!s || s.length < MIN_SECRET_LENGTH) throw new Error('[collectionImageUrl] GRAILKEY_SESSION_SECRET missing or below the 32-char floor');
  return createHmac('sha256', s).update(KEY_LABEL).digest();
}
const epoch = () => process.env.GRAILKEY_SESSION_EPOCH || '1';
const sign = (payloadB64) => createHmac('sha256', derivedKey()).update(payloadB64).digest('base64url');

export function mintImageLink({ principalId, itemId, index, now = Date.now(), ttlMs = IMAGE_LINK_TTL_MS } = {}) {
  if (typeof principalId !== 'string' || !principalId) throw new Error('principalId required');
  if (typeof itemId !== 'string' || !itemId) throw new Error('itemId required');
  if (!Number.isInteger(index) || index < 0) throw new Error('index must be a non-negative integer');
  const payload = { v: IMAGE_LINK_VERSION, p: principalId, i: itemId, n: index, e: now + ttlMs, ep: epoch() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt: payload.e };
}

/** @returns {{ok:true, principalId, itemId, index, expiresAt} | {ok:false, reason:'malformed'|'signature'|'expired'|'epoch'|'unavailable'}} */
export function verifyImageLink(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return { ok: false, reason: 'malformed' };
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
  if (!p || p.v !== IMAGE_LINK_VERSION || typeof p.p !== 'string' || typeof p.i !== 'string' || !Number.isInteger(p.n) || p.n < 0 || typeof p.e !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (p.ep !== epoch()) return { ok: false, reason: 'epoch' };
  if (now > p.e) return { ok: false, reason: 'expired' };
  return { ok: true, principalId: p.p, itemId: p.i, index: p.n, expiresAt: p.e };
}

export const IMAGE_ENDPOINT_V2 = '/api/collection-image-v2';
export const imageLinkPath = (token) => `${IMAGE_ENDPOINT_V2}?t=${encodeURIComponent(token)}`;
