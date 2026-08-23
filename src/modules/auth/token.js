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
// Payload: { principalId, iat, exp, epoch } — no other claims. No
// refresh/rotation mechanism in v1 (see
// docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md, T1's "what is NOT built"
// section) — a token simply expires and the caller logs in again.
//
// DATA-1D correction pass (H2) — `epoch` added. A stolen/disclosed
// credential invalidates itself once rotated (a new passphrase issues
// new tokens, but pre-existing outstanding tokens are signed with a
// SEPARATE secret and don't care that the passphrase changed — they'd
// stay valid for up to their full 12h TTL otherwise). `epoch` is a
// second, independent revocation lever: bump `GRAILKEY_SESSION_EPOCH`
// and every token issued before that moment stops verifying immediately,
// without needing to also rotate GRAILKEY_SESSION_SECRET (which would
// have the same effect but is a blunter, harder-to-reason-about tool —
// this gives an explicit, purpose-built "kill all sessions" switch).

import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h, fixed, no rotation in v1
const MIN_SECRET_LENGTH = 32; // characters — fail closed on an obviously-weak secret rather than sign with it

function secret() {
  const s = process.env.GRAILKEY_SESSION_SECRET;
  if (!s) {
    throw new Error(
      '[auth/token] GRAILKEY_SESSION_SECRET is not set in process.env. This module never ' +
      'reads .env files itself — the caller (a local script, or Vercel\'s own env injection) ' +
      'must populate process.env before use.'
    );
  }
  if (s.length < MIN_SECRET_LENGTH) {
    // Never logs the value — length alone is enough to prove the check ran.
    throw new Error(
      `[auth/token] GRAILKEY_SESSION_SECRET is ${s.length} chars, below the required ` +
      `${MIN_SECRET_LENGTH}-char floor. Refusing to sign/verify with a weak secret. ` +
      'Generate a new one (e.g. node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))") ' +
      'and set it in the real environment (never commit it).'
    );
  }
  return s;
}

// Current session epoch — bump GRAILKEY_SESSION_EPOCH to invalidate every
// outstanding token at once (e.g. after a credential-disclosure incident).
// Unset/missing epoch defaults to '1', matching every token issued before
// this mechanism existed — a real production token embeds a real epoch
// value going forward, so this default only ever matters for env parity
// (dev/prod both reading the same unset-epoch default), never as a way to
// silently defeat the check.
function currentEpoch() {
  return process.env.GRAILKEY_SESSION_EPOCH || '1';
}

function sign(payloadB64) {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

export function issueToken({ principalId }) {
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + SESSION_TTL_MS, epoch: currentEpoch() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt: payload.exp };
}

// Returns { principalId, iat, exp } on a genuinely valid, unexpired,
// correctly-signed, current-epoch token — null on ANY failure (missing,
// malformed, bad signature, expired, stale epoch). Never throws — the
// caller (auth/service.js) decides how to surface "invalid" as a typed
// error.
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
    return null; // secret() threw (unset or too weak) — NOT_PROVISIONED is the service layer's concern, not this pure check's
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
  // A token signed under a since-revoked epoch is rejected even if its
  // signature and expiry both still check out — this is the mechanism
  // H2's "credential rotation invalidates all outstanding tokens" rests on.
  if (String(payload.epoch || '1') !== String(currentEpoch())) return null;

  return { principalId: payload.principalId, iat: payload.iat, exp: payload.exp };
}
