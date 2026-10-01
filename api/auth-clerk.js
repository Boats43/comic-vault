// POST /api/auth-clerk
//
// BETA-1A, extended by GK-268 AUTH LAUNCH (2026-09-30) — Clerk identity
// adapter, now GrailKey's sole public login surface. Accepts a Clerk
// SESSION token (obtained client-side via Clerk's own useAuth().getToken()
// — never a principal/user ID typed in directly) and verifies it
// server-side against Clerk's own keys (@clerk/backend's verifyToken,
// CLERK_SECRET_KEY never sent to or readable by the client). The verified
// `sub` claim (Clerk's own user ID, a standard JWT claim, stable across
// however the end user authenticated into Clerk — Google included) is the
// ONLY identity value carried forward out of the token — never anything
// else it contains, never anything from the request body.
//
// That verified subject resolves-or-creates exactly one GrailKey principal
// via loginWithExternalIdentity() (src/modules/auth/service.js) against
// principal_external_identity (db/data0/0022_beta1a_clerk_identity_mapping.sql,
// live in both environments). GK-268 retired the prior invite-only
// boundary: a verified subject with no existing mapping now gets a
// brand-new principal auto-created, atomically, rather than a
// NotProvisionedError — see service.js's own header for the full
// before/after. A genuinely UNVERIFIABLE token (bad signature, expired,
// malformed) still fails closed with the same undifferentiated 401 a
// wrong passphrase gets.
//
// Best-effort, non-fatal profile fetch (Clerk's own management API, same
// CLERK_SECRET_KEY) supplies a human-readable displayName for a BRAND NEW
// principal only — loginWithExternalIdentity ignores it entirely once a
// principal already exists. A failed profile fetch never blocks login.
//
// On success this issues the SAME session token issueToken() already
// produces for the passphrase path — the resulting Authorization: Bearer
// token is indistinguishable from one auth-login.js issued, so every
// existing authenticated endpoint (assets.js, asset-media.js,
// operator-action.js) needs zero changes to accept a Clerk-originated
// session. Same rate limiter as auth-login.js.

import { verifyToken as verifyClerkToken, createClerkClient } from '@clerk/backend';
import { loginWithExternalIdentity, InvalidCredentialError, InvalidTokenError, NotProvisionedError } from '../src/modules/auth/index.js';
import { checkRateLimit } from './rate-limit.js';

export default async function handler(req, res) {
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clerkToken = req.body?.clerkToken;
  if (!clerkToken || typeof clerkToken !== 'string') {
    return res.status(400).json({ error: 'clerkToken required' });
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error('[auth-clerk] CLERK_SECRET_KEY is not set');
    return res.status(500).json({ error: 'Internal error' });
  }

  let clerkSubject;
  try {
    const claims = await verifyClerkToken(clerkToken, { secretKey });
    clerkSubject = claims?.sub;
    if (!clerkSubject || typeof clerkSubject !== 'string') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch {
    // Any verification failure (bad signature, expired, wrong audience,
    // malformed) — same undifferentiated 401 a wrong passphrase gets.
    // Never leaks which specific check failed.
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Best-effort profile fetch for a brand-new principal's display name
  // only. Never printed/logged beyond this; never blocks login on failure.
  let displayName = null;
  try {
    const clerkClient = createClerkClient({ secretKey });
    const clerkUser = await clerkClient.users.getUser(clerkSubject);
    displayName =
      clerkUser?.primaryEmailAddress?.emailAddress ||
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
      null;
  } catch (e) {
    console.warn('[auth-clerk] profile fetch failed (non-fatal, login proceeds):', e?.message || e);
  }

  try {
    const { token, expiresAt } = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: clerkSubject, displayName });
    return res.status(200).json({ token, expiresAt });
  } catch (e) {
    if (e instanceof InvalidCredentialError || e instanceof NotProvisionedError || e instanceof InvalidTokenError) {
      // Deliberately the SAME shape/status auth-login.js uses for a wrong
      // passphrase / no provisioned credential — a verified-but-unmapped
      // Clerk account gets an identical response, never a hint that
      // Clerk verification itself succeeded.
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.error('[auth-clerk] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
