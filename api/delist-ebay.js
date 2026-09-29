// POST /api/delist-ebay
//
// Ends an eBay listing via the Trading API (EndItem).
// Requires the same env vars as list-ebay.js.
//
// GK-262 — CLOSES PUBLIC UNAUTHENTICATED DESTRUCTIVE ACCESS. A genuinely
// verified GrailKey session (Authorization: Bearer, checked via
// src/modules/auth's real verifyToken -- the SAME function api/assets.js,
// api/list-ebay.js, and api/ebay-outcome-reconciler.js already rely on)
// is now REQUIRED before any EndItem call. Ownership is additionally
// bound whenever a durable GrailKey linkage exists for the given
// ebayItemId (src/modules/assets' resolveOwnedAssetForListing, reading
// the SAME outcome_event ledger api/list-ebay.js's attemptListedOutcome
// already writes to at LIST time) -- cross-principal delist is rejected
// before any eBay call whenever that linkage exists.
//
// DISCLOSED, NOT OVERSTATED: a listing with NO durable outcome_event
// LISTED row (made before this linkage existed, through the
// Production-disabled bundle path, or via a durable-write decline at
// LIST time) has no gkAssetId to check ownership against -- for THAT
// case this endpoint is an AUTHENTICATED STOPGAP ONLY (any real
// GrailKey principal may end it), not a cross-principal-safe bind. This
// is the same disclosed gap GK-216 already named for the bundle path,
// not a new one. The response's `ownershipBound` field tells the caller
// which case applied.

import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { resolveOwnedAssetForListing, AuthorizationFailedError } from "../src/modules/assets/index.js";
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

  let ownershipBound = false;
  try {
    const resolved = await resolveOwnedAssetForListing({
      principalId,
      externalListingId: String(ebayItemId),
      channel: "ebay",
    });
    // resolved.found === false: no durable GrailKey linkage exists for
    // this ebayItemId -- proceed as an authenticated stopgap (see file
    // header). resolved.found === true: ownership was just verified by
    // resolveOwnedAssetForListing itself (it throws below otherwise).
    ownershipBound = resolved.found === true;
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

  const token = process.env.EBAY_AUTH_TOKEN;
  if (!token) {
    res.status(500).json({ error: "eBay auth token not configured" });
    return;
  }

  try {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
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
      },
      body: xml,
    });

    const responseXml = await ebayRes.text();
    const ack = extractTag(responseXml, "Ack");

    if (ack && /Success/i.test(ack)) {
      res.status(200).json({ success: true, ownershipBound });
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
