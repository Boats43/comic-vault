// src/lib/accessGate.js — authentication gate for the AI/scrape
// cost-incurring endpoints (api/enrich.js, api/comps.js, api/grade.js,
// api/chat.js, api/manage.js).
//
// GK-269 (2026-09-30, FINAL AUTH CLOSURE) — retires the legacy shared
// ACCESS_CODE/x-vault-key secret (BETA-1A.1's own "alternate credential"
// framing) entirely. Authentication is now EXCLUSIVELY a verified
// GrailKey session (Authorization: Bearer, src/modules/auth's own
// verifyToken()) — the exact same credential every other authenticated
// endpoint (assets.js, collection.js, operator-action.js, ...) already
// requires. There is no shared-secret fallback of any kind; a missing,
// malformed, forged, or expired token is rejected the same way a
// completely absent Authorization header is.
//
// Cost control (burst/abuse rate limiting) is a SEPARATE, orthogonal
// concern — see api/rate-limit.js, now keyed on the verified principalId
// this function returns, not on the retired shared secret. Conflating
// "who is allowed to call this at all" with "how much can they call it"
// was the original design flaw this split corrects.
import { verifyToken } from '../modules/auth/index.js';

export function requireAuthenticatedPrincipal(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Sign in to continue — a GrailKey session is required.' };
  }
  try {
    const { principalId } = verifyToken(authHeader.slice('Bearer '.length).trim());
    return { ok: true, principalId };
  } catch {
    // Missing, malformed, bad signature, expired — same undifferentiated
    // 401 as no Authorization header at all (never leaks which check
    // failed, matching this codebase's existing auth-rejection discipline).
    return { ok: false, status: 401, error: 'Sign in to continue — a GrailKey session is required.' };
  }
}
