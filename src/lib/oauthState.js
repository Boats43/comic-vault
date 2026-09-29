// src/lib/oauthState.js — GK-264. Versioned, HMAC-authenticated,
// session-bound OAuth state for the eBay Connect flow. No DB, no
// external call — pure, stateless, mirrors src/modules/auth/token.js's
// own construction (stdlib node:crypto only, no JWT library).
//
// State alone is NEVER authorization — every verifyOAuthState() failure
// mode below is a distinct, typed OAuthStateError so a caller can log
// (and a test can assert) exactly why a state was rejected, all BEFORE
// any eBay token exchange is ever attempted.
//
// sessionBinding proves the OAuth attempt belongs to the EXACT GrailKey
// session (bearer token) that initiated it, not merely to any future
// session belonging to the same principal — the raw session token is
// NEVER placed inside the state itself, only a one-way, context-
// separated HMAC of it. "Context-separated" means the state signature
// and the session binding are each computed with their own domain-
// separation label under the SAME secret, so a value computed for one
// purpose can never be replayed as the other.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000; // ~10 minutes
const MIN_SECRET_LENGTH = 32;
const PROVIDER = 'EBAY';
const STATE_VERSION = 1;
const CLOCK_SKEW_ALLOWANCE_MS = 60 * 1000;

const CONTEXT_STATE_SIG = 'grailkey-ebay-oauth-state-sig-v1';
const CONTEXT_SESSION_BINDING = 'grailkey-ebay-oauth-session-binding-v1';

export class OAuthStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OAuthStateError';
    this.code = code;
  }
}

function secret() {
  const s = process.env.GRAILKEY_OAUTH_STATE_SECRET;
  if (!s) {
    throw new OAuthStateError(
      'STATE_SECRET_NOT_CONFIGURED',
      '[oauthState] GRAILKEY_OAUTH_STATE_SECRET is not set in process.env.'
    );
  }
  if (s.length < MIN_SECRET_LENGTH) {
    throw new OAuthStateError(
      'STATE_SECRET_TOO_SHORT',
      `[oauthState] GRAILKEY_OAUTH_STATE_SECRET is ${s.length} chars, below the required ${MIN_SECRET_LENGTH}-char floor. Refusing to sign/verify with a weak secret.`
    );
  }
  return s;
}

function hmac(context, input) {
  return createHmac('sha256', secret()).update(`${context}:${input}`).digest('base64url');
}

// computeSessionBinding — a one-way, context-separated HMAC of the
// caller's own GrailKey bearer token. Never reversible, never places
// the raw token anywhere else.
export function computeSessionBinding(sessionToken) {
  if (!sessionToken || typeof sessionToken !== 'string') {
    throw new OAuthStateError('MISSING_SESSION_TOKEN', '[oauthState] a session token is required to compute a session binding.');
  }
  return hmac(CONTEXT_SESSION_BINDING, sessionToken);
}

// createOAuthState — the ONE thing api/ebay-connect.js returns embedded
// in the eBay authorization URL. Never contains the raw session token,
// a client secret, or any credential material.
export function createOAuthState({ principalId, sessionToken }) {
  if (!principalId || typeof principalId !== 'string') {
    throw new OAuthStateError('MISSING_PRINCIPAL', '[oauthState] principalId is required.');
  }
  const sessionBinding = computeSessionBinding(sessionToken);
  const now = Date.now();
  const payload = {
    v: STATE_VERSION,
    provider: PROVIDER,
    principalId,
    nonce: randomBytes(16).toString('base64url'),
    iat: now,
    exp: now + STATE_TTL_MS,
    sessionBinding,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(CONTEXT_STATE_SIG, payloadB64);
  return { state: `${payloadB64}.${sig}`, expiresAt: payload.exp };
}

// verifyOAuthState — throws a typed OAuthStateError on ANY failure;
// returns the decoded, verified payload only on complete success. The
// caller (api/ebay-callback.js) must call this BEFORE any eBay network
// call — state alone proves nothing else.
export function verifyOAuthState({ state, principalId, sessionToken }) {
  if (!state || typeof state !== 'string') {
    throw new OAuthStateError('MALFORMED_STATE', '[oauthState] state is missing or not a string.');
  }
  const dot = state.indexOf('.');
  if (dot < 0) throw new OAuthStateError('MALFORMED_STATE', '[oauthState] state is not in the expected format.');
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!payloadB64 || !sig) throw new OAuthStateError('MALFORMED_STATE', '[oauthState] state payload or signature segment is empty.');

  const expectedSig = hmac(CONTEXT_STATE_SIG, payloadB64);
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new OAuthStateError('BAD_SIGNATURE', '[oauthState] state signature does not verify.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new OAuthStateError('MALFORMED_STATE', '[oauthState] state payload is not valid JSON.');
  }
  if (!payload || typeof payload !== 'object') throw new OAuthStateError('MALFORMED_STATE', '[oauthState] state payload is not an object.');
  if (payload.v !== STATE_VERSION) throw new OAuthStateError('MALFORMED_STATE', `[oauthState] unrecognized state version ${payload.v}.`);
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new OAuthStateError('MALFORMED_STATE', '[oauthState] state is missing iat/exp.');
  }

  if (payload.provider !== PROVIDER) {
    throw new OAuthStateError('WRONG_PROVIDER', `[oauthState] state provider "${payload.provider}" does not match expected "${PROVIDER}".`);
  }

  const now = Date.now();
  if (payload.iat > now + CLOCK_SKEW_ALLOWANCE_MS) {
    throw new OAuthStateError('INVALID_TIMESTAMP', '[oauthState] state iat is in the future.');
  }
  if (now > payload.exp) {
    throw new OAuthStateError('EXPIRED', '[oauthState] state has expired.');
  }

  if (payload.principalId !== principalId) {
    throw new OAuthStateError('PRINCIPAL_MISMATCH', '[oauthState] state was not issued for the current principal.');
  }

  const expectedBinding = computeSessionBinding(sessionToken);
  const bindBuf = Buffer.from(String(payload.sessionBinding || ''), 'utf8');
  const expBindBuf = Buffer.from(expectedBinding, 'utf8');
  if (bindBuf.length !== expBindBuf.length || !timingSafeEqual(bindBuf, expBindBuf)) {
    throw new OAuthStateError('SESSION_BINDING_MISMATCH', '[oauthState] state was not issued for the current session.');
  }

  return { principalId: payload.principalId, nonce: payload.nonce, iat: payload.iat, exp: payload.exp };
}
