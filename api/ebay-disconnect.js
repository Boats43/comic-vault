// POST /api/ebay-disconnect — GK-264.
//
// verify GrailKey session -> derive principalId -> resolve THAT
// principal's EBAY connection -> obtain credential server-side if
// usable -> attempt remote revocation (disclosed best-effort, see
// attemptRemoteRevocationBestEffort's own header) -> ALWAYS make the
// credential unusable locally via GK-263's disconnectMarketplaceConnection
// (status DISCONNECTED, ciphertext cleared) regardless of remote
// revocation outcome. Disconnecting an already-disconnected/no-connection
// state is safe and returns a well-defined NOT_CONNECTED result rather
// than an error. Principal A can never disconnect Principal B — every
// lookup here is scoped by principalId+provider, never a connection id.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import {
  resolveMarketplaceRefreshCredential,
  disconnectMarketplaceConnection,
  NotFoundError,
  AuthorizationFailedError,
} from "../src/modules/marketplace/index.js";
import { attemptRemoteRevocationBestEffort } from "../src/lib/ebayUserOAuth.js";
import { checkRateLimit } from "./rate-limit.js";

const extractBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
};

export default async function handler(req, res) {
  const rateCheck = checkRateLimit(req);
  res.setHeader("x-ratelimit-remaining", String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader("retry-after", String(rateCheck.reset));
    res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const bearerToken = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(bearerToken));
  } catch (e) {
    if (!(e instanceof InvalidTokenError)) {
      console.error("[ebay-disconnect] unexpected token-verification error:", e?.message || e);
    }
    res.status(401).json({ error: "Missing, invalid, or expired token" });
    return;
  }

  // Best-effort: obtain the credential server-side (if any is currently
  // usable) so a remote revocation attempt has something to act on.
  // Absence of a usable credential (already disconnected, or
  // RECONNECT_REQUIRED) is not an error here — disconnect still proceeds.
  let refreshCredential = null;
  try {
    const resolved = await resolveMarketplaceRefreshCredential({ principalId, provider: "EBAY" });
    refreshCredential = resolved.refreshCredential;
  } catch {
    // No usable credential to revoke — fine, fall through to disconnect.
  }

  if (refreshCredential) {
    await attemptRemoteRevocationBestEffort(refreshCredential);
  }

  try {
    const conn = await disconnectMarketplaceConnection({ principalId, provider: "EBAY" });
    res.status(200).json({ status: conn.connectionStatus, connected: false });
  } catch (e) {
    if (e instanceof NotFoundError) {
      // Disconnecting an already-disconnected/no-connection state is
      // safe and well-defined, not an error.
      res.status(200).json({ status: "NOT_CONNECTED", connected: false });
      return;
    }
    if (e instanceof AuthorizationFailedError) {
      res.status(401).json({ error: "Missing, invalid, or expired token" });
      return;
    }
    console.error("[ebay-disconnect] unexpected error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
  }
}
