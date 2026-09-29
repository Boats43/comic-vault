// GET /api/ebay-connection — GK-264. Metadata-only connection status.
//
// Uses GK-263's getMarketplaceConnection, which already strips every
// credential field before returning — this handler adds no additional
// fields that could leak credential material and never reads the raw
// database row itself. No row maps cleanly to NOT_CONNECTED.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { getMarketplaceConnection, AuthorizationFailedError } from "../src/modules/marketplace/index.js";
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

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const bearerToken = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(bearerToken));
  } catch (e) {
    if (!(e instanceof InvalidTokenError)) {
      console.error("[ebay-connection] unexpected token-verification error:", e?.message || e);
    }
    res.status(401).json({ error: "Missing, invalid, or expired token" });
    return;
  }

  try {
    const conn = await getMarketplaceConnection({ principalId, provider: "EBAY" });
    if (!conn) {
      res.status(200).json({ provider: "EBAY", status: "NOT_CONNECTED", connected: false });
      return;
    }
    res.status(200).json({
      provider: conn.provider,
      status: conn.connectionStatus,
      connected: conn.connectionStatus === "CONNECTED",
      grantedScopes: conn.grantedScopes,
      connectedAt: conn.connectedAt,
      updatedAt: conn.updatedAt,
    });
  } catch (e) {
    if (e instanceof AuthorizationFailedError) {
      res.status(401).json({ error: "Missing, invalid, or expired token" });
      return;
    }
    console.error("[ebay-connection] unexpected error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
  }
}
