// POST /api/auth-clerk
//
// BETA-1A — Clerk identity adapter. Accepts a Clerk SESSION token
// (obtained client-side via Clerk's own useAuth().getToken() — never a
// principal/user ID typed in directly) and verifies it server-side
// against Clerk's own keys (@clerk/backend's verifyToken, CLERK_SECRET_KEY
// never sent to or readable by the client). The verified `sub` claim
// (Clerk's own user ID, a standard JWT claim) is the ONLY value carried
// forward out of the token — never anything else it contains, never
// anything from the request body.
//
// That verified subject is resolved to a GrailKey principal via
// loginWithExternalIdentity() (src/modules/auth/service.js) against
// principal_external_identity (db/data0/0022_beta1a_clerk_identity_mapping.sql,
// PROPOSED — not yet applied to data1_dev, so this endpoint 500s with a
// clear DB error until that migration is live AND a mapping row exists;
// it does not silently authenticate anyone in the meantime). An
// unrecognized-but-verified subject fails closed exactly like a wrong
// passphrase does in api/auth-login.js — NotProvisionedError, same 401,
// same message, no hint that Clerk verification itself succeeded. This
// endpoint can NEVER authenticate as the operator principal for a
// subject with no explicit mapping row; there is no fallback path.
//
// On success this issues the SAME session token issueToken() already
// produces for the passphrase path — the resulting Authorization: Bearer
// token is indistinguishable from one auth-login.js issued, so every
// existing authenticated endpoint (assets.js, asset-media.js,
// operator-action.js) needs zero changes to accept a Clerk-originated
// session. Same rate limiter as auth-login.js.

import { verifyToken as verifyClerkToken } from '@clerk/backend';
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

  try {
    const { token, expiresAt } = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: clerkSubject });
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
