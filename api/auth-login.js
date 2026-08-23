// POST /api/auth-login
//
// DATA-1D, T3 — the first real authenticated endpoint. Single-operator
// era: no username, just a passphrase — there is exactly one operator
// principal to log in as (src/modules/auth/repository.js's own
// getOperatorPrincipal). Registration is explicitly not built; a
// credential is provisioned by a one-off local admin script, never
// through this or any other public endpoint.
//
// Rate-limited via the SAME shared mechanism api/enrich.js already uses
// (api/rate-limit.js) — a login endpoint is exactly the kind of surface
// brute-force attempts target, and this project already has a real,
// working rate limiter; reusing it here is a real re-use, not a new
// half-built one.

import { login, InvalidCredentialError, InvalidTokenError, NotProvisionedError } from '../src/modules/auth/index.js';
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

  const passphrase = req.body?.passphrase;
  if (!passphrase) {
    return res.status(400).json({ error: 'passphrase required' });
  }

  try {
    const { token, expiresAt } = await login({ passphrase });
    return res.status(200).json({ token, expiresAt });
  } catch (e) {
    if (e instanceof InvalidCredentialError) {
      // Deliberately the SAME message/status as a missing credential
      // (NotProvisionedError, below) would give a caller with a valid
      // passphrase against an unprovisioned system — never leak "does a
      // credential exist yet" to an unauthenticated caller via a
      // different error shape.
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (e instanceof NotProvisionedError) {
      console.error('[auth-login] NOT_PROVISIONED:', e.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (e instanceof InvalidTokenError) {
      // Unreachable in this handler (login() never returns a token to
      // verify) — kept only so this file's error handling stays a
      // complete, honest match to the module's real error taxonomy.
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.error('[auth-login] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
