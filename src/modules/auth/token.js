// src/modules/auth/token.js — PRIVATE. Never imported outside
// src/modules/auth/ — enforced by tests/auth-module-boundary.test.js.
//
// A stateless, HMAC-signed bearer token — no JWT library, no new
// dependency: node:crypto's createHmac/timingSafeEqual are stdlib and
// sufficient for the ONE thing this token needs to prove (this payload
// was issued by us and hasn't been tampered with), matching T1's
// "no auth SaaS unless the evidence argues for it" instruction — at ONE
// principal, a stateless signed token needs no session-store
// infrastructure at all.
//
// Format: "<base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>"
// Payload: { principalId, iat, exp } — no other claims. No refresh/
// rotation mechanism in v1 (see docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md,
// T1's "what is NOT built" section) — a token simply expires and the
// caller logs in again.

import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h, fixed, no rotation in v1

function secret() {
  const s = process.env.GRAILKEY_SESSION_SECRET;
  if (!s) {
    throw new Error(
      '[auth/token] GRAILKEY_SESSION_SECRET is not set in process.env. This module never ' +
      'reads .env files itself — the caller (a local script, or Vercel\'s own env injection) ' +
      'must populate process.env before use.'
    );
  }
  return s;
}

function sign(payloadB64) {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

export function issueToken({ principalId }) {
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt: payload.exp };
}

// Returns { principalId, iat, exp } on a genuinely valid, unexpired,
// correctly-signed token — null on ANY failure (missing, malformed, bad
// signature, expired). Never throws — the caller (auth/service.js)
// decides how to surface "invalid" as a typed error.
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  let expectedSig;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return null; // secret() threw — NOT_PROVISIONED is the service layer's concern, not this pure check's
  }
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.principalId !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;

  return { principalId: payload.principalId, iat: payload.iat, exp: payload.exp };
}
