// src/lib/clientContract.js — the stable CLIENT-CONTRACT refusal signal
// (UNIVERSAL U1 closeout, 2026-10-05).
//
// U1 made the category mandatory on every request that creates or prices an
// asset. A browser still running a bundle that predates U1 (an old cached PWA
// tab) omits it. The server refuses those requests, and the refusal carries ONE
// distinct, stable code — never a generic validation error, never a claim that
// the asset itself is invalid:
//
//   CATEGORY_REQUIRED_CLIENT_OUTDATED
//
// It is delivered two ways so the CURRENT client can recognize it centrally
// without parsing every body: a response header (set on all three refusal
// sites, including the HTTP-200 enrich refusal) and the JSON `error`/`code`.
//
// HONEST LIMIT: a bundle that already predates this code does not understand it.
// That first refusal cannot be made intelligible retroactively — only the user
// fully closing and reopening the app (which fetches the new index.html) fixes it.
// There is deliberately NO general version-handshake system.

export const CATEGORY_REQUIRED_CODE = 'CATEGORY_REQUIRED_CLIENT_OUTDATED';
export const CLIENT_CONTRACT_HEADER = 'x-grailkey-client-contract';
export const OUTDATED_CLIENT_MESSAGE = 'Update the app and try again.';

// Server side: mark a response as a client-contract refusal.
export function markClientContractRefusal(res, code = CATEGORY_REQUIRED_CODE) {
  try { res.setHeader(CLIENT_CONTRACT_HEADER, code); } catch { /* header is best-effort; the body code still stands */ }
}

// Client side: does this Response carry the refusal marker?
export function isOutdatedClientResponse(res) {
  try {
    return !!res && typeof res.headers?.get === 'function' && res.headers.get(CLIENT_CONTRACT_HEADER) === CATEGORY_REQUIRED_CODE;
  } catch {
    return false;
  }
}
