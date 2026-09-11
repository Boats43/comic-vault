// src/lib/accessGate.js — the legacy shared-secret access gate (A3,
// ACCESS_CODE/x-vault-key), factored out of api/enrich.js, api/comps.js,
// api/grade.js (all three carried a byte-identical copy of this function
// before BETA-1A.1). Pre-existing purpose, unchanged: a single shared
// invite code protecting the cost-incurring AI/scrape endpoints
// (Claude Vision, PriceCharting, eBay) before any real per-user
// authentication existed. GK-151 (docs/TICKET-REGISTRY.md) already names
// this as a shared-secret gate distinct from GrailKey's own real
// per-principal authorization — it is not touched or replaced here.
//
// BETA-1A.1 — a genuinely verified GrailKey session (Authorization:
// Bearer, checked via src/modules/auth/'s real verifyToken(), the SAME
// function api/assets.js and api/operator-action.js already rely on) is
// now an ALTERNATE valid credential alongside the existing shared vault
// key. This ADDS a path; it does not remove, weaken, or bypass the
// original one — ACCESS_CODE/x-vault-key still works exactly as before
// for any caller without a GrailKey session (scripts, admin tooling).
// A missing, malformed, or forged Authorization header is rejected by
// the real verifyToken() exactly as it always has been (InvalidTokenError)
// and simply falls through to the original vault-key check below — there
// is no separate, weaker check invented for this path. An unauthenticated
// caller with neither a valid session nor a matching vault key still
// fails closed with the identical 401 shape as before.
import { verifyToken } from '../modules/auth/index.js';

export function checkAccessGate(req) {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) return null; // Gate disabled when env var not set

  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      verifyToken(authHeader.slice('Bearer '.length).trim());
      return null; // genuinely verified GrailKey principal — gate passes
    } catch {
      // Invalid/expired/forged token — fall through to the vault-key
      // check below exactly as if no Authorization header were sent.
    }
  }

  const clientKey = req.headers['x-vault-key']?.trim();

  // DIAGNOSTIC: Log comparison without exposing full value
  const match = clientKey === accessCode;
  console.log(`[access] received_len=${clientKey?.length ?? 0} expected_len=${accessCode?.length ?? 0} match=${match}`);

  if (!match) {
    return { error: 'Access denied. Contact the vault administrator for an access code.', status: 401 };
  }
  return null;
}
