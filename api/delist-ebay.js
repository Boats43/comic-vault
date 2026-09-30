// POST /api/delist-ebay
//
// Ends an eBay listing via the Trading API (EndItem).
//
// GK-262 — CLOSES PUBLIC UNAUTHENTICATED DESTRUCTIVE ACCESS. A genuinely
// verified GrailKey session (Authorization: Bearer, checked via
// src/modules/auth's real verifyToken -- the SAME function api/assets.js,
// api/list-ebay.js, and api/ebay-outcome-reconciler.js already rely on)
// is required before any EndItem call.
//
// GK-265 PHASE 3 — principal-scoped seller execution. The GK-262
// "AUTHENTICATED STOPGAP" for an ebayItemId with no durable GrailKey
// linkage is REMOVED on this multi-user path: once seller execution is
// converted to per-principal eBay connections, "valid GrailKey user +
// arbitrary public eBay ItemID -> EndItem" is no longer acceptable --
// there is no way to know WHOSE connection should even service the
// call without durable ownership. Ownership is now required
// unconditionally (src/modules/assets' resolveOwnedAssetForListing,
// reading the SAME outcome_event ledger api/list-ebay.js's
// attemptListedOutcome writes to at LIST time); a listing with no
// durable LISTED row fails closed before any eBay call, full stop. The
// eBay call itself now uses that SAME owning principal's own eBay User
// access token (src/lib/ebayPrincipalToken.js) via
// X-EBAY-API-IAF-TOKEN -- never the legacy global EBAY_AUTH_TOKEN /
// RequesterCredentials path, and never any other seller's credential.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { resolveOwnedAssetForListing, AuthorizationFailedError } from "../src/modules/assets/index.js";
import {
  resolveEbayUserAccessToken,
  EbayConnectionRequiredError,
  EbayReconnectRequiredError,
  EbayTemporaryFailureError,
  EbayTokenResolutionInternalError,
} from "../src/lib/ebayPrincipalToken.js";
import { checkRateLimit } from "./rate-limit.js";

const EBAY_ENDPOINT = "https://api.ebay.com/ws/api.dll";
const COMPAT_LEVEL = "1193";
const SITE_ID = "0";

const extractTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  return m ? m[1] : null;
};

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

  let principalId;
  try {
    ({ principalId } = verifyToken(extractBearerToken(req)));
  } catch (e) {
    if (!(e instanceof InvalidTokenError)) {
      console.error("[delist] unexpected token-verification error:", e?.message || e);
    }
    res.status(401).json({ error: "Missing, invalid, or expired token" });
    return;
  }

  const { ebayItemId } = req.body || {};
  if (!ebayItemId) {
    res.status(400).json({ error: "ebayItemId required" });
    return;
  }

  // GK-265 PHASE 3 -- ownership is now REQUIRED unconditionally. A
  // found:false result (no durable outcome_event LISTED row for this
  // ebayItemId) is no longer an accepted stopgap on this path -- there
  // is structurally no principal whose eBay connection could safely
  // service the call, so this fails closed before any eBay network call.
  let gkAssetId;
  try {
    const resolved = await resolveOwnedAssetForListing({
      principalId,
      externalListingId: String(ebayItemId),
      channel: "ebay",
    });
    if (!resolved.found) {
      console.warn(
        `[delist] REJECTED before EndItem -- no durable GrailKey linkage exists for ebayItemId ${ebayItemId} (GK-262's authenticated stopgap removed, GK-265 Phase 3)`
      );
      res.status(404).json({ error: "EBAY_LISTING_NOT_LINKED", message: "No durable GrailKey linkage exists for this listing -- cannot determine whose eBay connection should service this request." });
      return;
    }
    gkAssetId = resolved.gkAssetId;
  } catch (e) {
    if (e instanceof AuthorizationFailedError) {
      console.warn(
        `[delist] REJECTED before EndItem -- principalId ${principalId} does not own the GrailKey asset linked to ebayItemId ${ebayItemId}`
      );
      res.status(403).json({ error: "Not authorized to end this listing" });
      return;
    }
    console.error("[delist] unexpected ownership-resolution error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  // GK-265 PHASE 3 -- the OWNING principal's own eBay User access token.
  // principalId here already equals the verified owner of gkAssetId
  // (resolveOwnedAssetForListing throws AuthorizationFailedError above
  // otherwise) -- never a different seller's credential.
  let accessToken;
  try {
    ({ accessToken } = await resolveEbayUserAccessToken({ principalId }));
  } catch (e) {
    if (e instanceof EbayConnectionRequiredError) {
      res.status(503).json({ error: "EBAY_CONNECTION_REQUIRED", message: "No eBay connection exists for this principal -- Connect eBay before ending a listing.", gkAssetId });
      return;
    }
    if (e instanceof EbayReconnectRequiredError) {
      res.status(503).json({ error: "EBAY_RECONNECT_REQUIRED", message: "This principal's eBay connection requires reconnection.", gkAssetId });
      return;
    }
    if (e instanceof EbayTemporaryFailureError) {
      res.status(502).json({ error: "EBAY_TEMPORARY_FAILURE", message: "eBay was temporarily unavailable -- try again shortly." });
      return;
    }
    if (e instanceof EbayTokenResolutionInternalError) {
      console.error("[delist] internal token-resolution fault:", e?.message || e);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not resolve an eBay access token due to a server-side fault." });
      return;
    }
    console.error("[delist] unexpected token-resolution error:", e?.message || e);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  try {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${ebayItemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;

    const ebayRes = await fetch(EBAY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
        "X-EBAY-API-CALL-NAME": "EndItem",
        "X-EBAY-API-SITEID": SITE_ID,
        "X-EBAY-API-APP-NAME": process.env.EBAY_APP_ID || "",
        "X-EBAY-API-DEV-NAME": process.env.EBAY_DEV_ID || "",
        "X-EBAY-API-CERT-NAME": process.env.EBAY_CERT_ID || "",
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body: xml,
    });

    const responseXml = await ebayRes.text();
    const ack = extractTag(responseXml, "Ack");

    if (ack && /Success/i.test(ack)) {
      // ownershipBound is always true on this path now (GK-265 Phase 3
      // removed the unlinked-listing stopgap above) -- kept in the
      // response shape for backward compatibility with existing callers.
      res.status(200).json({ success: true, ownershipBound: true, gkAssetId });
    } else {
      const errorMsg = extractTag(responseXml, "ShortMessage") || extractTag(responseXml, "LongMessage") || "EndItem failed";
      console.error(`[delist] EndItem failed: ${errorMsg}`);
      res.status(400).json({ error: errorMsg });
    }
  } catch (err) {
    console.error(`[delist] error: ${err?.message || err}`);
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
