// GET /api/ebay-connection — GK-264. Metadata-only connection status.
//
// Uses GK-263's getMarketplaceConnection, which already strips every
// credential field before returning — this handler adds no additional
// fields that could leak credential material and never reads the raw
// database row itself. No row maps cleanly to NOT_CONNECTED.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { getMarketplaceConnection, AuthorizationFailedError } from "../src/modules/marketplace/index.js";
import { checkRateLimit } from "./rate-limit.js";
import {
  resolveEbayUserAccessToken,
  EbayConnectionRequiredError,
  EbayReconnectRequiredError,
  EbayTemporaryFailureError,
} from "../src/lib/ebayPrincipalToken.js";
import { resolveEbayAccountDetailsFromUserToken } from "../src/lib/ebayIdentityProof.js";

const extractBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
};

const isVerifyRequest = (req) => {
  const v = req.query ? req.query.verify : new URL(req.url || "/", "http://x").searchParams.get("verify");
  return v === "1" || v === 1 || v === "true";
};

// Constant-shape comparison of two identifier strings; both must be
// non-empty strings.
const sameIdentifier = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.length > 0 && a === b;

async function handleVerify(res, principalId) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  let accessToken;
  let storedProviderUserId;
  try {
    ({ accessToken, providerUserId: storedProviderUserId } = await resolveEbayUserAccessToken({ principalId }));
  } catch (e) {
    if (e instanceof EbayConnectionRequiredError) {
      res.status(503).json({ verification: "FAILED", reason: "EBAY_CONNECTION_REQUIRED" });
      return;
    }
    if (e instanceof EbayReconnectRequiredError) {
      res.status(503).json({ verification: "FAILED", reason: "EBAY_RECONNECT_REQUIRED" });
      return;
    }
    if (e instanceof EbayTemporaryFailureError) {
      res.status(502).json({ verification: "FAILED", reason: "EBAY_TEMPORARY_FAILURE" });
      return;
    }
    console.error("[ebay-connection] verify: token resolution fault:", e?.code || e?.name || "unknown");
    res.status(500).json({ verification: "FAILED", reason: "INTERNAL_ERROR" });
    return;
  }

  let account;
  try {
    account = await resolveEbayAccountDetailsFromUserToken(accessToken);
  } catch (e) {
    console.error("[ebay-connection] verify: GetUser failed");
    res.status(502).json({ verification: "FAILED", reason: "EBAY_GETUSER_FAILED" });
    return;
  }

  if (!sameIdentifier(account.eiasToken, storedProviderUserId)) {
    // GetUser succeeded but the stable account id disagrees with the stored connection: fail closed.
    // userId is deliberately withheld � it is not proven to belong to this connection.
    res.status(409).json({ verification: "MISMATCH", eiasMatchesStored: false });
    return;
  }

  res.status(200).json({
    verification: "VERIFIED",
    userId: account.userId,
    site: account.site,
    eiasMatchesStored: true,
  });
}

export default async function handler(req, res) {
  if (isVerifyRequest(req)) res.setHeader("Cache-Control", "no-store, max-age=0");
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

  if (isVerifyRequest(req)) {
    await handleVerify(res, principalId);
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
