// POST /api/ebay-callback — GK-264. Step 2 of the eBay Connect flow.
//
// EXACT required ordering, no external eBay call before step 7 passes:
//   1. verify GrailKey session
//   2. derive current principalId
//   3. validate signed OAuth state
//   4. validate provider = EBAY               } all inside
//   5. validate iat/exp                       } verifyOAuthState —
//   6. validate principalId == state.principalId } a single call,
//   7. validate sessionBinding == state.sessionBinding } throws on ANY failure
//   8. ONLY THEN exchange the authorization code with eBay
//
// Rejects a GET (only POST completes this flow). Request body is
// WHITELISTED to exactly {code, state} — nothing else is ever read from
// it. A client cannot assert principalId, providerUserId, grantedScopes,
// connectionStatus, connectedAt, updatedAt, refreshCredential, or
// accessToken through this endpoint; those identifiers are simply never
// destructured from req.body anywhere in this file.
//
// Never logs: the authorization code, the Basic-auth value, the client
// secret, the access token, or the refresh token.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { verifyOAuthState, OAuthStateError } from "../src/lib/oauthState.js";
import { exchangeAuthCodeForToken, attemptRemoteRevocationBestEffort, CONNECT_SCOPES } from "../src/lib/ebayUserOAuth.js";
import { resolveEbayIdentityFromUserToken } from "../src/lib/ebayIdentityProof.js";
import { upsertMarketplaceConnection, ProviderIdentityConflictError, AuthorizationFailedError } from "../src/modules/marketplace/index.js";
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

  // Rejects a GET callback completion outright — this endpoint is
  // authenticated-POST-only, never a browser-navigable link.
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Steps 1-2.
  const bearerToken = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(bearerToken));
  } catch (e) {
    if (!(e instanceof InvalidTokenError)) {
      console.error("[ebay-callback] unexpected token-verification error:", e?.message || e);
    }
    res.status(401).json({ error: "Missing, invalid, or expired token" });
    return;
  }

  // WHITELIST — code/state only. Every other body field is ignored.
  const { code, state } = req.body || {};
  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "code and state are both required" });
    return;
  }

  // Steps 3-7 — ALL inside verifyOAuthState, which throws on any single
  // failure (malformed, bad signature, expired, wrong provider,
  // principal mismatch, session-binding mismatch). No eBay call has
  // happened yet at this point, and none happens if this throws.
  try {
    verifyOAuthState({ state, principalId, sessionToken: bearerToken });
  } catch (e) {
    if (e instanceof OAuthStateError) {
      console.warn(`[ebay-callback] OAuth state rejected (${e.code}) for principalId ${principalId} — no eBay call made.`);
      res.status(400).json({ error: "Your eBay connection attempt could not be verified — please try connecting again." });
      return;
    }
    console.error("[ebay-callback] unexpected state-validation error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  // Step 8 — ONLY NOW does any external eBay call happen.
  let tokenResult;
  try {
    tokenResult = await exchangeAuthCodeForToken(code);
  } catch (e) {
    // exchangeAuthCodeForToken's own error message never embeds the
    // client secret or the code itself (see its own header).
    console.error("[ebay-callback] eBay authorization-code exchange failed:", e?.message || e);
    res.status(502).json({ error: "Could not complete the eBay connection — please try again." });
    return;
  }

  // FAIL CLOSED — store nothing if either token is absent.
  if (!tokenResult?.accessToken || !tokenResult?.refreshToken) {
    console.error("[ebay-callback] eBay token response was missing access_token/refresh_token — failing closed, nothing stored.");
    res.status(502).json({ error: "Could not complete the eBay connection — please try again." });
    return;
  }

  // Identity proof — server-side only, via the NEW User OAuth access
  // token through X-EBAY-API-IAF-TOKEN, never the legacy
  // RequesterCredentials path, never a caller-supplied UserID.
  let eiasToken;
  try {
    ({ eiasToken } = await resolveEbayIdentityFromUserToken(tokenResult.accessToken));
  } catch (e) {
    console.error("[ebay-callback] eBay identity proof (GetUser) failed — failing closed, nothing stored:", e?.message || e);
    await attemptRemoteRevocationBestEffort(tokenResult.refreshToken);
    res.status(502).json({ error: "Could not verify the eBay account — please try again." });
    return;
  }

  // Storage, entirely through the GK-263 module boundary. The refresh
  // credential is encrypted inside upsertMarketplaceConnection itself —
  // this file never touches AES/GCM directly and never persists
  // plaintext. The short-lived access token is never persisted at all.
  try {
    const conn = await upsertMarketplaceConnection({
      principalId,
      provider: "EBAY",
      providerUserId: eiasToken,
      refreshCredential: tokenResult.refreshToken,
      grantedScopes: CONNECT_SCOPES,
    });
    res.status(200).json({
      status: conn.connectionStatus,
      connected: conn.connectionStatus === "CONNECTED",
      connectedAt: conn.connectedAt,
    });
  } catch (e) {
    if (e instanceof ProviderIdentityConflictError) {
      console.warn(`[ebay-callback] provider-identity collision for principalId ${principalId} — refusing, nothing persisted.`);
      await attemptRemoteRevocationBestEffort(tokenResult.refreshToken);
      res.status(409).json({ error: "This eBay account cannot be connected." });
      return;
    }
    if (e instanceof AuthorizationFailedError) {
      res.status(401).json({ error: "Missing, invalid, or expired token" });
      return;
    }
    console.error("[ebay-callback] unexpected storage error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
  }
}
