// POST /api/ebay-connect — GK-264. Step 1 of the eBay Connect flow.
//
// authenticated POST -> verify GrailKey session -> derive principalId
// server-side -> generate a signed, session-bound OAuth state -> return
// {authorizationUrl} only. Never accepts principalId from the request
// body/query (there is none read here at all). No secret ever appears
// in the response.
//
// Deliberately NOT a browser-navigation GET that 302s directly to eBay:
// GrailKey authentication depends on an authenticated client request
// (Authorization: Bearer), which a plain browser navigation cannot be
// assumed to carry.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { getMarketplaceConnection, AuthorizationFailedError } from "../src/modules/marketplace/index.js";
import { createOAuthState, OAuthStateError } from "../src/lib/oauthState.js";
import { buildConsentUrl, CONNECT_SCOPES } from "../src/lib/ebayUserOAuth.js";
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
      console.error("[ebay-connect] unexpected token-verification error:", e?.message || e);
    }
    res.status(401).json({ error: "Missing, invalid, or expired token" });
    return;
  }

  // Verify the principal is still a real, active gk_principal row (a
  // signature/expiry-valid token proves nothing about that on its own)
  // and inspect any existing EBAY connection metadata — a bare read,
  // it has no bearing on whether a fresh connect attempt is allowed
  // (reconnect always uses the same one-row-per-principal-provider
  // design, GK-263).
  try {
    await getMarketplaceConnection({ principalId, provider: "EBAY" });
  } catch (e) {
    if (e instanceof AuthorizationFailedError) {
      res.status(401).json({ error: "Missing, invalid, or expired token" });
      return;
    }
    console.error("[ebay-connect] unexpected error inspecting existing connection:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  let state;
  try {
    ({ state } = createOAuthState({ principalId, sessionToken: bearerToken }));
  } catch (e) {
    if (e instanceof OAuthStateError) {
      console.error(`[ebay-connect] could not create OAuth state (${e.code}):`, e.message);
      res.status(503).json({ error: "eBay connect is not configured yet." });
      return;
    }
    console.error("[ebay-connect] unexpected state-creation error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  let authorizationUrl;
  try {
    authorizationUrl = buildConsentUrl({ scopes: CONNECT_SCOPES, state });
  } catch (e) {
    console.error("[ebay-connect] could not build authorization URL:", e?.message || e);
    res.status(503).json({ error: "eBay connect is not configured yet." });
    return;
  }

  res.status(200).json({ authorizationUrl });
}
