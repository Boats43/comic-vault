// src/lib/marketplaceOperatorGate.js -- GK-P0 (2026-10-13): the OPERATOR-ONLY gate for every route that can mutate the
// marketplace (api/list-ebay.js -- single, bundle, status -- and api/delist-ebay.js).
//
// WHY: until this gate, api/list-ebay.js accepted any authenticated principal that owned an asset and held its own eBay
// connection, and docs/B1-RELEASE-SEQUENCING-FINAL.md said "no non-operator marketplace write until GK-283/GK-294/GK-295
// close" -- a control that existed only in the documents. This turns that rule into a server-enforced one.
//
// THE AUTHORITY (the same one api/operator-reconcile.js uses -- nothing new is invented): the verified GrailKey session
// token names a principal (HMAC-signed, src/modules/auth/token.js); that principal must be a REAL operator-kind row in
// data1_dev.gk_principal (isOperatorPrincipal -> `kind = 'operator'`). Nothing the client sends (a role field, a principal
// id, an operator flag, a header other than the Bearer token) is read.
//
// FAIL CLOSED, in this order:
//   no / invalid / expired / revoked token                    -> 401 GRAILKEY_AUTH_REQUIRED
//   token verification itself failed unexpectedly              -> 503 MARKETPLACE_OPERATOR_AUTHORITY_UNAVAILABLE
//   operator status cannot be established (database config absent / empty / malformed / unreachable, environment identity
//     guard refuses, marker mismatch, query error)              -> 503 MARKETPLACE_OPERATOR_AUTHORITY_UNAVAILABLE
//   authenticated principal that is not an operator            -> 403 MARKETPLACE_OPERATOR_ONLY
//   operator                                                   -> { ok: true, principalId }
// Only a strict boolean `true` from isOperatorPrincipal passes. There is no environment-variable bypass, no "disabled"
// switch and no default: a missing configuration can never silently turn this control off.
//
// This runs BEFORE any marketplace mutation and BEFORE the durable operator-authority / attempt-ledger write.
import { verifyToken, InvalidTokenError, isOperatorPrincipal } from '../modules/auth/index.js';

export const MARKETPLACE_GATE_CODES = Object.freeze({
  AUTH_REQUIRED: 'GRAILKEY_AUTH_REQUIRED',
  OPERATOR_ONLY: 'MARKETPLACE_OPERATOR_ONLY',
  UNAVAILABLE: 'MARKETPLACE_OPERATOR_AUTHORITY_UNAVAILABLE',
});

function extractBearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization;
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

const unavailable = () => ({
  ok: false, status: 503,
  body: {
    error: MARKETPLACE_GATE_CODES.UNAVAILABLE,
    message: 'Marketplace actions are paused: operator authority could not be established on this deployment. Nothing was sent to the marketplace.',
  },
});

/**
 * @param {object} req  the HTTP request (only the Authorization header is read)
 * @param {{label?: string}} [opts]
 * @returns {Promise<{ok:true, principalId:string} | {ok:false, status:number, body:object}>}
 */
export async function requireMarketplaceOperator(req, { label = 'marketplace' } = {}) {
  let principalId;
  try {
    ({ principalId } = verifyToken(extractBearerToken(req)));
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return { ok: false, status: 401, body: { error: MARKETPLACE_GATE_CODES.AUTH_REQUIRED, message: 'A valid GrailKey operator session is required.' } };
    }
    console.error(`[${label}] operator gate: unexpected token-verification error:`, e?.message || e);
    return unavailable();
  }
  if (typeof principalId !== 'string' || !principalId) {
    return { ok: false, status: 401, body: { error: MARKETPLACE_GATE_CODES.AUTH_REQUIRED, message: 'A valid GrailKey operator session is required.' } };
  }

  let isOperator;
  try {
    isOperator = await isOperatorPrincipal({ principalId });
  } catch (e) {
    // database configuration absent / empty / malformed / unreachable, environment-identity refusal, query failure ...
    console.error(`[${label}] operator gate: operator status could not be established -- refusing:`, e?.reason || e?.code || e?.name, e?.message || e);
    return unavailable();
  }
  if (isOperator !== true) {
    return { ok: false, status: 403, body: { error: MARKETPLACE_GATE_CODES.OPERATOR_ONLY, message: 'Marketplace actions are restricted to the operator account.' } };
  }
  return { ok: true, principalId };
}
