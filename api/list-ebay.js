// POST /api/list-ebay
//
// Creates a real eBay fixed-price listing via the Trading API (AddFixedPriceItem).
// Also handles status sync: { checkStatus: true, ebayItemId } calls GetItem to detect sold/ended.
//
// Requires these env vars on Vercel (application identity only — see
// GK-265 PHASE 3 note below for the per-principal seller credential):
//   EBAY_APP_ID  — your Trading API App ID (client id)
//   EBAY_CERT_ID — your Trading API Cert ID (client secret)
//   EBAY_DEV_ID  — your Trading API Dev ID
//
// GK-265 PHASE 3 — principal-scoped seller execution. The legacy global
// EBAY_AUTH_TOKEN ("Auth'n'Auth" eBayAuthToken) is GONE from this file.
// Every Trading API call now authenticates the SELLER via
// X-EBAY-API-IAF-TOKEN, a short-lived OAuth User access token resolved
// per request from the authenticated GrailKey principal's OWN GK-263/
// GK-264 eBay connection (src/lib/ebayPrincipalToken.js). There is no
// global seller-token fallback: a principal with no usable connection
// gets a safe, typed failure, never a call made on someone else's
// behalf.
//
// Notes:
//  - Category 63 = Comics (US site).
//  - GTC = Good 'Til Cancelled listing duration.
//  - Shipping: USPSMediaMail flat $4.99.
//  - Returns: 30 days, seller pays return shipping.
//  - Images: the client sends a base64 data URL. We first POST it to
//    UploadSiteHostedPictures (multipart/form-data) to get an eBay-hosted
//    picture URL, then include that URL in <PictureDetails> on the
//    AddFixedPriceItem call.

// GrailKey Directive Z, C3 — server-side, INDEPENDENT re-derivation of
// transaction authority. Neither function is ever handed a client-
// computed verdict (item.actionAuthority is never read anywhere in this
// file) — both are recomputed here from the raw evidence fields the
// client echoes in the request, using the SAME pure functions
// api/enrich.js's finalizeResponse already uses at enrich time.
import { deriveLocks } from "../src/lib/responseContract.js";
import { deriveActionAuthority } from "../src/lib/actionAuthority.js";
import { toBuyerSafeListingFacts, buildGovernedListingTitle } from "../src/lib/buyerSafeListingCopy.js";
import { getMyCollectionItem, NotFoundError as CollectionNotFoundError } from "../src/modules/collection/index.js";
import { toCents, assertQ41PriceBinding, assertListActionPriceBinding, PriceBindingError } from "../src/lib/listingPriceBinding.js";
import { getAspectMetadata, getItemConditionPolicy, buildItemSpecificsFromMetadata, resolveDomesticShippingService } from "../src/lib/ebayListingMetadata.js";
import { assertPublishPhotos, PhotoGuardError } from "../src/lib/listingPhotoGuard.js";

// Outcome #1 — OPTIONAL, ADDITIVE GrailKey linkage. Neither import below
// changes this endpoint's existing, still-mandatory behavior for a
// caller that sends none of the new fields (gkAssetId/decisionEventId/
// operatorActionEventId/idempotencyKey/Authorization) — see
// src/lib/marketplaceOutcomeBridge.js's own header (GK-151: this
// endpoint has no mandatory GrailKey auth today, and this dispatch does
// not add one).
import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { recordOutcomeEvent, validateOutcomeAttachment, resolveOwnedAssetForListing, getCanonicalCollectionItemIdForAsset, getOperatorActionForListing, getAssetMediaContentHashes, AuthorizationFailedError as AssetAuthorizationFailedError, NotFoundError, ValidationFailedError } from "../src/modules/assets/index.js";
import { attemptListedOutcome } from "../src/lib/marketplaceOutcomeBridge.js";
import { assertListingAuthorized, ListingPreflightFailedError } from "../src/lib/inventoryListingPreflight.js";
// GK-265 PHASE 3 -- principal-scoped eBay seller execution. Every real
// Trading API call in this file (GetItem, UploadSiteHostedPictures,
// GetUser, AddFixedPriceItem, EndItem via delist-ebay.js) now uses the
// AUTHENTICATED PRINCIPAL's own eBay User access token
// (X-EBAY-API-IAF-TOKEN), resolved fresh per request. NO global
// EBAY_AUTH_TOKEN fallback exists anywhere below this line.
import {
  resolveEbayUserAccessToken,
  EbayConnectionRequiredError,
  EbayReconnectRequiredError,
  EbayTemporaryFailureError,
  EbayTokenResolutionInternalError,
} from "../src/lib/ebayPrincipalToken.js";

const EBAY_ENDPOINT = "https://api.ebay.com/ws/api.dll";
const COMPAT_LEVEL = "1193";
const SITE_ID = "0"; // US
const CATEGORY_ID = "259104"; // Comics > Comic Books > Single Issues (leaf)

// Escape text for inclusion inside XML text nodes.
const xmlEscape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// The ONE definition of the outbound list price (buildXml AND the Q41 price-binding preflight
// both use it, so the acknowledged amount is compared to exactly what would be sent).
const resolveOutgoingPrice = (item) => {
  for (const c of [item.price, item.priceHigh, item.priceLow]) {
    const n = parsePriceNumber(c);
    if (n != null) return n;
  }
  return null;
};

const parsePriceNumber = (p) => {
  if (p == null) return null;
  const m = String(p).replace(/,/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

// (ConditionID is no longer derived from a grade string: it is emitted only when validated against
// eBay's authoritative category condition policy, see src/lib/ebayListingMetadata.js. For category
// 259104 the condition is optional and is omitted.)

const NO_TITLE_VARIANTS = [
  'corner box', 'masterpieces', 'design variant',
  'cover a', 'cover b', 'cover c', 'cover d', 'headshot',
];

const variantForTitle = (variant) => {
  if (!variant) return null;
  const v = String(variant).trim();
  if (!v) return null;
  if (NO_TITLE_VARIANTS.some(nv => v.toLowerCase().includes(nv))) return null;
  return v;
};

// OUTCOME #1 V1 — the eBay title is built DETERMINISTICALLY from governed
// catalogue facts only (src/lib/buyerSafeListingCopy.js). The model-suggested
// claudeCheck.suggestedListingTitle is NOT authoritative public copy and is never
// used; there is no key-issue marketing token and no unverified grade.
const buildTitle = (rawItem) => buildGovernedListingTitle(toBuyerSafeListingFacts(rawItem));

const eraFromYear = (y) => {
  const n = parseInt(y, 10);
  if (!n || isNaN(n)) return "";
  if (n < 1956) return "Golden Age";
  if (n <= 1970) return "Silver Age";
  if (n <= 1984) return "Bronze Age";
  if (n <= 1991) return "Copper Age";
  return "Modern Age";
};

const buildBundleTitle = (rawItems) => {
  const items = rawItems.map((it) => toBuyerSafeListingFacts(it));
  const issues = items.map((it) => it.issue).filter(Boolean).map((v) => `#${v}`);
  const titles = [...new Set(items.map((it) => it.title).filter(Boolean))];
  const series = titles.length === 1 ? titles[0] : "Comic";
  const variants = [...new Set(items.map((it) => variantForTitle(it.variant)).filter(Boolean))];
  const variantStr = variants.length === 1 ? variants[0] : "";
  const years = items.map((it) => parseInt(it.year, 10)).filter((n) => n && !isNaN(n));
  const minYear = years.length ? Math.min(...years) : null;
  const publishers = [...new Set(items.map((it) => it.publisher).filter(Boolean))];
  const pub = publishers.length === 1 ? publishers[0] : "";
  const era = minYear ? eraFromYear(minYear) : "";
  const parts = [series, issues.join(" "), variantStr, "Lot", minYear || "", pub, era].filter(Boolean);
  const joined = parts.join(" ").trim();
  return joined.length > 80 ? joined.slice(0, 80).trim() : joined || "Comic Book Lot";
};

const buildBundleDescription = (items) => {
  const lines = [];
  const titles = [...new Set(items.map((it) => toBuyerSafeListingFacts(it).title).filter(Boolean))];
  const header =
    titles.length === 1
      ? `${titles[0]} — ${items.length}-Book Lot`
      : `${items.length}-Book Comic Lot`;
  lines.push(`<h2>${xmlEscape(header)}</h2>`);
  lines.push(`<p><strong>Contents (${items.length} books):</strong></p>`);
  lines.push("<ul>");
  // Each bundled book goes through the SAME buyer-safe projection as a single
  // listing. No raw item (and therefore no item.reason / decision reasoning /
  // routing rationale) is ever in scope here.
  for (const rawIt of items) {
    const it = toBuyerSafeListingFacts(rawIt);
    const issuePart = it.issue ? ` #${it.issue}` : "";
    const yearPart = it.year ? ` (${it.year})` : "";
    const gradePart = it.publicGrade ? ` — ${xmlEscape(it.publicGrade)}` : "";
    lines.push(
      `<li><strong>${xmlEscape(it.title || "Comic")}${issuePart}</strong>${yearPart}${gradePart}</li>`
    );
  }
  lines.push("</ul>");
  lines.push("<p>See photos for condition details.</p>");
  lines.push("<p>Ships via USPS Media Mail. 30-day returns accepted.</p>");
  return lines.join("\n");
};

const buildBundleXml = (items, pictureUrls) => {
  const title = buildBundleTitle(items);
  const description = buildBundleDescription(items);
  const sum = items.reduce((acc, it) => {
    const p = parsePriceNumber(it.price) ?? parsePriceNumber(it.priceHigh) ?? parsePriceNumber(it.priceLow) ?? 0;
    return acc + p;
  }, 0);
  const price = Math.round(sum * 0.82 * 100) / 100;
  if (price <= 0) throw new Error("No valid bundle price — cannot list");
  // ConditionID omitted (category 259104 condition is optional; no grade-derived enum).
  const pictureBlock = (pictureUrls && pictureUrls.length)
    ? `    <PictureDetails>\n${pictureUrls
        .map((u) => `      <PictureURL>${xmlEscape(u)}</PictureURL>`)
        .join("\n")}\n    </PictureDetails>\n`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${xmlEscape(title)}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${CATEGORY_ID}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="USD">${price.toFixed(2)}</StartPrice>
    <Location>Phoenix, AZ</Location>
    <Country>US</Country>
    <PostalCode>85033</PostalCode>
    <Currency>USD</Currency>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Quantity>1</Quantity>
    <Site>US</Site>
    <DispatchTimeMax>3</DispatchTimeMax>
${pictureBlock}    <ShipToLocations>US</ShipToLocations>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSMedia</ShippingService>
        <ShippingServiceCost>6.99</ShippingServiceCost>
        <FreeShipping>false</FreeShipping>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Seller</ShippingCostPaidByOption>
    </ReturnPolicy>
  </Item>
</AddFixedPriceItemRequest>`;
};

const buildDescription = (rawItem, shippingDescription = 'USPS Ground Advantage') => {
  // BUYER-FACING COPY (Outcome #1 V1): built ONLY from the explicit buyer-safe
  // projection of GOVERNED catalogue facts. Allowed: identity facts, a GOVERNED
  // public grade, the fixed condition/photo sentence, approved shipping/returns.
  // NOT allowed (and structurally unreachable here): reason / model rationale /
  // decision rationale / IDs / authority status / market-value, "recent verified
  // sales", demand, census, pricing-source labels / promotional claims.
  const f = toBuyerSafeListingFacts(rawItem);
  const lines = [];

  if (f.title) lines.push(`<h2>${xmlEscape(f.title)}${f.issue ? ` #${xmlEscape(f.issue)}` : ""}</h2>`);
  const meta = [f.publisher, f.year].filter(Boolean).join(" · ");
  if (meta) lines.push(`<p><strong>${xmlEscape(meta)}</strong></p>`);
  if (f.variant) lines.push(`<p>Variant: ${xmlEscape(f.variant)}</p>`);

  if (f.publicGrade) {
    lines.push(`<p>Grade: <strong>${xmlEscape(f.publicGrade)}</strong></p>`);
  } else {
    lines.push(`<p>Condition: See photos for condition details.</p>`);
  }

  lines.push("<p><strong>SHIPPING</strong></p>");
  lines.push(
    "<p>Packed in Gemini mailer with cardboard backing and top loader for protection. " +
    `Ships within 3 business days via ${shippingDescription}. Combined shipping available.</p>`
  );
  lines.push("<p><strong>RETURNS</strong></p>");
  lines.push("<p>30-day returns accepted. Professional grading available.</p>");

  return lines.join("\n");
};

// Extract the first occurrence of a simple <Tag>value</Tag>.
const extractTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
};

// Strip the eBay auth token out of a blob of XML before logging.
// Prevents leaking the seller credential into Vercel logs.
const redactToken = (xml) =>
  String(xml).replace(
    /<eBayAuthToken>[\s\S]*?<\/eBayAuthToken>/g,
    "<eBayAuthToken>[REDACTED]</eBayAuthToken>"
  );

// Decode a data URL ("data:image/jpeg;base64,....") into { bytes, mimeType }.
const decodeDataUrl = (dataUrl) => {
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) {
    // Assume raw base64 if no data URL prefix.
    return { bytes: Buffer.from(String(dataUrl), "base64"), mimeType: "image/jpeg" };
  }
  return { bytes: Buffer.from(m[2], "base64"), mimeType: m[1] };
};

// Upload a base64 image to eBay's picture service via UploadSiteHostedPictures.
// Returns the hosted FullURL or throws. `headers` must already carry
// X-EBAY-API-IAF-TOKEN (the principal's own eBay User access token) --
// this function no longer embeds a RequesterCredentials/eBayAuthToken
// block in the XML body (GK-265 Phase 3).
const uploadSiteHostedPicture = async (base64Image, headers) => {
  const { bytes, mimeType } = decodeDataUrl(base64Image);
  if (!bytes || bytes.length === 0) throw new Error("Empty image payload");

  const uploadXml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <PictureName>comic-vault-${Date.now()}</PictureName>
  <PictureSet>Supersize</PictureSet>
  <ExtensionInDays>30</ExtensionInDays>
</UploadSiteHostedPicturesRequest>`;

  // Trading API expects a specific multipart/form-data layout:
  //   part 1: name="XML Payload", Content-Type: text/xml — the request XML
  //   part 2: name="dummy", filename="image.jpg", Content-Type: <mime>,
  //           Content-Transfer-Encoding: binary — the raw image bytes
  const boundary = `----comicvault${Date.now().toString(16)}`;
  const CRLF = "\r\n";
  const ext = mimeType.split("/")[1] || "jpg";

  const preamble = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="XML Payload"${CRLF}` +
      `Content-Type: text/xml;charset=utf-8${CRLF}${CRLF}` +
      uploadXml +
      `${CRLF}--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="dummy"; filename="image.${ext}"${CRLF}` +
      `Content-Transfer-Encoding: binary${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`,
    "utf8"
  );
  const closing = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf8");
  const body = Buffer.concat([preamble, bytes, closing]);

  console.log("[ebay] UploadSiteHostedPictures request XML:\n" + redactToken(uploadXml));

  const res = await fetch(EBAY_ENDPOINT, {
    method: "POST",
    headers: {
      ...headers,
      "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  const text = await res.text();
  const ack = extractTag(text, "Ack");
  const fullUrl = extractTag(text, "FullURL");
  if (!fullUrl || (ack && /Failure/i.test(ack))) {
    console.error(
      `[ebay] UploadSiteHostedPictures failed (HTTP ${res.status}, ack=${ack}). Full response:\n` +
        redactToken(text)
    );
    const msg =
      extractTag(text, "ShortMessage") ||
      extractTag(text, "LongMessage") ||
      "UploadSiteHostedPictures failed";
    throw new Error(`Image upload failed: ${msg}`);
  }
  return fullUrl;
};

// plan = { shippingService:{token,description}, specifics:[{name,value}], conditionId:null|string, bestOffer:boolean }
// — every marketplace enum/value in it was resolved from authoritative eBay metadata (see
// src/lib/ebayListingMetadata.js); there are NO hard-coded shipping tokens, condition ids or aspect enums here.
const buildXml = (item, pictureUrls, plan) => {
  if (!plan?.shippingService?.token) throw new Error('No authoritatively resolved shipping service — cannot list');
  const title = buildTitle(item);
  const description = buildDescription(item, plan.shippingService.description);
  const price = resolveOutgoingPrice(item);
  if (price == null || price <= 0) {
    throw new Error("No valid price on item — cannot list");
  }
  // ConditionID is emitted ONLY when plan.conditionId was validated against the authoritative category
  // condition policy (never derived from a grade string; never a remembered enum).
  const conditionId = plan.conditionId || null;

  // T2-1: Multi-image support
  const pictureBlock = (pictureUrls && pictureUrls.length > 0)
    ? `    <PictureDetails>
${pictureUrls.map(url => `      <PictureURL>${xmlEscape(url)}</PictureURL>`).join('\n')}
    </PictureDetails>
`
    : "";

  // T2-3: Dynamic category
  const categoryId = item.isTPB ? '267' :
                     item.isMagazine ? '180' :
                     CATEGORY_ID;

  // T2-4: Free shipping for $50+
  const isFreeShipping = price >= 50;
  const shippingCost = isFreeShipping ? '0.00' : '4.99';
  const freeShippingFlag = isFreeShipping ? 'true' : 'false';

  // T3-2: Best Offer thresholds
  const autoAcceptPrice = (price * 0.95).toFixed(2);
  const minBestOfferPrice = (price * 0.75).toFixed(2);

  // Item specifics: ONLY entries that passed provenance classification (src/lib/ebayListingMetadata.js
  // buildItemSpecificsFromMetadata) — governed catalogue facts or eBay-enum-validated values; anything
  // unprovable was already omitted there.
  const itemSpecifics = plan.specifics.length ? `    <ItemSpecifics>
${plan.specifics.map((x) => `      <NameValueList>
        <Name>${xmlEscape(x.name)}</Name>
        <Value>${xmlEscape(x.value)}</Value>
      </NameValueList>
`).join('')}    </ItemSpecifics>
` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${xmlEscape(title)}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="USD">${price.toFixed(2)}</StartPrice>
${conditionId ? `    <ConditionID>${xmlEscape(conditionId)}</ConditionID>\n` : ''}    <Location>Phoenix, AZ</Location>
    <Country>US</Country>
    <PostalCode>85033</PostalCode>
    <Currency>USD</Currency>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Quantity>1</Quantity>
    <Site>US</Site>
    <DispatchTimeMax>3</DispatchTimeMax>
${pictureBlock}    <ShipToLocations>US</ShipToLocations>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>${xmlEscape(plan.shippingService.token)}</ShippingService>
        <ShippingServiceCost>${shippingCost}</ShippingServiceCost>
        <FreeShipping>${freeShippingFlag}</FreeShipping>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Seller</ShippingCostPaidByOption>
    </ReturnPolicy>
${itemSpecifics}${plan.bestOffer === true ? `    <BestOfferDetails>
      <BestOfferEnabled>true</BestOfferEnabled>
    </BestOfferDetails>
    <ListingDetails>
      <BestOfferAutoAcceptPrice>${autoAcceptPrice}</BestOfferAutoAcceptPrice>
      <MinimumBestOfferPrice>${minBestOfferPrice}</MinimumBestOfferPrice>
    </ListingDetails>
` : ''}  </Item>
</AddFixedPriceItemRequest>`;
};

// Check listing status via GetItem API. `headers` must already carry
// X-EBAY-API-IAF-TOKEN — no eBayAuthToken is embedded in the XML body
// (GK-265 Phase 3).
// Returns { status: "sold"|"ended"|"active", soldPrice?, soldAt?, buyerFeedback? }
const checkListingStatus = async (ebayItemId, headers) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${xmlEscape(ebayItemId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;

  console.log("[ebay] GetItem request for ItemID:", ebayItemId);

  const ebayRes = await fetch(EBAY_ENDPOINT, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetItem",
    },
    body: xml,
  });

  const responseXml = await ebayRes.text();
  const ack = extractTag(responseXml, "Ack");

  if (!ack || /Failure/i.test(ack)) {
    const shortMsg =
      extractTag(responseXml, "ShortMessage") ||
      extractTag(responseXml, "LongMessage") ||
      "GetItem failed";
    console.error(`[ebay] GetItem failed (ack=${ack}): ${shortMsg}`);
    throw new Error(shortMsg);
  }

  // Parse SellingStatus
  const sellingState = extractTag(responseXml, "SellingState");
  const currentPrice = extractTag(responseXml, "CurrentPrice");
  const quantitySold = extractTag(responseXml, "QuantitySold");
  const endTime = extractTag(responseXml, "EndTime");

  // Parse buyer feedback (if sold)
  const buyerFeedbackScore = extractTag(responseXml, "FeedbackScore");

  console.log(
    `[ebay] GetItem result: state=${sellingState}, price=${currentPrice}, qtySold=${quantitySold}, endTime=${endTime}`
  );

  // SellingState values: Active, Ended, Sold
  // Ended includes expired/cancelled/out-of-stock
  const isSold =
    sellingState === "Ended" && parseInt(quantitySold || "0", 10) > 0;
  const isEnded = sellingState === "Ended" && !isSold;
  const isActive = sellingState === "Active";

  const result = {
    status: isSold ? "sold" : isEnded ? "ended" : "active",
  };

  if (isSold) {
    result.soldPrice = currentPrice ? parseFloat(currentPrice) : null;
    result.soldAt = endTime ? new Date(endTime).getTime() : Date.now();
    if (buyerFeedbackScore) {
      result.buyerFeedback = parseInt(buyerFeedbackScore, 10);
    }
  } else if (isEnded) {
    result.endedAt = endTime ? new Date(endTime).getTime() : Date.now();
  }

  return result;
};

// EBAY PUBLISH SAFETY (Outcome #1 dispatch) — a real, read-only Trading
// API GetUser call, run IMMEDIATELY BEFORE any AddFixedPriceItem call
// this file makes. Confirms the token is genuinely valid and identifies
// the real seller account an about-to-be-created listing will belong
// to. Never logs the token itself (redactToken already covers the
// request XML; GetUser's own request carries the same
// <eBayAuthToken> element). Read-only by construction — GetUser creates,
// modifies, or deletes nothing on eBay's side; a failure here throws
// and the caller aborts BEFORE ever reaching AddFixedPriceItem.
const verifySellerAccount = async (headers) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
</GetUserRequest>`;

  const res = await fetch(EBAY_ENDPOINT, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetUser",
    },
    body: xml,
  });

  const text = await res.text();
  const ack = extractTag(text, "Ack");
  const userId = extractTag(text, "UserID");
  const site = extractTag(text, "Site");

  if (!ack || /Failure/i.test(ack) || !userId) {
    console.error(
      `[ebay] GetUser (account/token validity check) FAILED (HTTP ${res.status}, ack=${ack}). Full response:\n` +
        redactToken(text)
    );
    const msg =
      extractTag(text, "ShortMessage") ||
      extractTag(text, "LongMessage") ||
      "eBay account/token validation failed";
    throw new Error(`eBay account/token validation failed: ${msg}`);
  }

  console.log(`[ebay] GetUser account/token validity check PASSED (site=${site || "?"}).`);
  return { userId, site };
};

const extractBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
};

// GK-265 PHASE 3 — maps a resolveEbayUserAccessToken() failure to the
// correct safe HTTP response. Every branch writes a response; callers
// must `return` immediately after calling this.
const respondEbayTokenError = (res, e, context) => {
  if (e instanceof EbayConnectionRequiredError) {
    res.status(503).json({ error: "EBAY_CONNECTION_REQUIRED", message: `No eBay connection exists for this principal — Connect eBay before ${context}.` });
    return;
  }
  if (e instanceof EbayReconnectRequiredError) {
    res.status(503).json({ error: "EBAY_RECONNECT_REQUIRED", message: "This principal's eBay connection requires reconnection." });
    return;
  }
  if (e instanceof EbayTemporaryFailureError) {
    res.status(502).json({ error: "EBAY_TEMPORARY_FAILURE", message: "eBay was temporarily unavailable — try again shortly." });
    return;
  }
  if (e instanceof EbayTokenResolutionInternalError) {
    console.error("[ebay] internal token-resolution fault:", e?.message || e);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not resolve an eBay access token due to a server-side fault." });
    return;
  }
  console.error("[ebay] unexpected token-resolution error:", e?.message || e);
  res.status(500).json({ error: "Internal error" });
};

// Outcome #1 readiness: lets a dry-run construct the REAL outbound AddFixedPriceItem
// XML for review WITHOUT invoking the handler (no auth, no eBay call, no DB write).
// The handler calls these exact same builders.
export const __dryRunBuildListingXml = (item, pictureUrls, plan) => buildXml(item, pictureUrls, plan);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // GK-265 PHASE 3 — EBAY_AUTH_TOKEN (the legacy global Auth'n'Auth
  // seller credential) is NO LONGER read anywhere in this file. App/Dev/
  // Cert IDs remain required — they identify the APPLICATION on every
  // Trading API call, orthogonal to the per-principal SELLER identity
  // now carried by X-EBAY-API-IAF-TOKEN (resolved per request, below).
  const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID } = process.env;
  if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_DEV_ID) {
    res.status(500).json({
      error:
        "Missing eBay application credentials. Set EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID in Vercel env.",
    });
    return;
  }

  try {
    const item = req.body || {};

    // Q41 (ruled 2026-07-12): acknowledged-override listings log their
    // audit payload server-side so [Q41-override] shows in the CLI log
    // capture (book, engine state, manual price, lock class acknowledged).
    if (item.q41Override) {
      console.log('[Q41-override]', JSON.stringify(item.q41Override));
    }

    const ebayHeaders = {
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-DEV-NAME": EBAY_DEV_ID,
      "X-EBAY-API-APP-NAME": EBAY_APP_ID,
      "X-EBAY-API-CERT-NAME": EBAY_CERT_ID,
      "X-EBAY-API-SITEID": SITE_ID,
    };

    // Outcome #1 — OPTIONAL GrailKey auth context. A missing/invalid
    // token never rejects the request (this endpoint has no mandatory
    // auth today, GK-151) — it only means the durable outcome write
    // below declines, the real eBay listing is completely unaffected.
    let grailkeyPrincipalId = null;
    const bearerToken = extractBearerToken(req);
    if (bearerToken) {
      try {
        ({ principalId: grailkeyPrincipalId } = verifyToken(bearerToken));
      } catch (e) {
        if (!(e instanceof InvalidTokenError)) {
          console.error("[ebay] unexpected token-verification error:", e?.message || e);
        }
        grailkeyPrincipalId = null;
      }
    }

    // Status check branch: { checkStatus: true, ebayItemId }
    // GK-265 PHASE 3 — GetItem now runs with the OWNING principal's own
    // eBay User access token, never a global one. Requires a verified
    // GrailKey session AND durable GrailKey linkage for this ebayItemId
    // (same resolveOwnedAssetForListing api/delist-ebay.js uses) —
    // fails closed otherwise, exactly like the other seller-user paths
    // in this file.
    if (item.checkStatus === true) {
      if (!item.ebayItemId) {
        res.status(400).json({ error: "ebayItemId required for status check" });
        return;
      }
      if (!grailkeyPrincipalId) {
        res.status(401).json({ error: 'GRAILKEY_AUTH_REQUIRED', message: 'A valid GrailKey session is required to check listing status.' });
        return;
      }
      let statusGkAssetId;
      try {
        const resolved = await resolveOwnedAssetForListing({ principalId: grailkeyPrincipalId, externalListingId: String(item.ebayItemId), channel: 'ebay' });
        if (!resolved.found) {
          res.status(404).json({ error: 'EBAY_LISTING_NOT_LINKED', message: 'No durable GrailKey linkage exists for this listing.' });
          return;
        }
        statusGkAssetId = resolved.gkAssetId;
      } catch (e) {
        if (e instanceof AssetAuthorizationFailedError) {
          res.status(403).json({ error: 'Not authorized to check this listing' });
          return;
        }
        console.error('[ebay] unexpected ownership-resolution error (checkStatus):', e?.message || e);
        res.status(500).json({ error: 'Internal error' });
        return;
      }
      let statusAccessToken;
      try {
        ({ accessToken: statusAccessToken } = await resolveEbayUserAccessToken({ principalId: grailkeyPrincipalId }));
      } catch (e) {
        respondEbayTokenError(res, e, 'checking listing status');
        return;
      }
      const statusResult = await checkListingStatus(
        item.ebayItemId,
        { ...ebayHeaders, "X-EBAY-API-IAF-TOKEN": statusAccessToken }
      );
      res.status(200).json({ ...statusResult, gkAssetId: statusGkAssetId });
      return;
    }

    // Bundle branch: combined lot listing for multiple comics.
    if (item.bundle === true) {
      // GRAILKEY INVENTORY AUTHORITY V1 (item 7) — the bundle path has
      // zero GrailKey linkage of any kind (no gkAssetId/decisionEventId/
      // operatorActionEventId per item), so it cannot independently
      // prove GK-207 linkage, Inventory Authority state, or duplicate-
      // listing safety for each physical asset without a real redesign
      // of the bundle feature — explicitly out of this dispatch's scope
      // ("do not redesign bundle listing"). Per this dispatch's own
      // explicit instruction, the smallest safe response when that
      // proof cannot be built cleanly is to disable Production bundle
      // writes entirely, fail-closed, until a future dispatch builds
      // real per-item linkage. Development is unaffected (no durable
      // Production asset has ever been part of a bundle listing; this
      // closes GK-216's own previously-disclosed bundle bypass).
      if (process.env.GRAILKEY_CATALOG_ENVIRONMENT === 'production') {
        res.status(503).json({
          error: 'BUNDLE_LISTING_DISABLED_PRODUCTION',
          message: 'Bundle listing is disabled in Production until it can independently prove GK-207 linkage, Inventory Authority state, and duplicate-listing safety for every item (GK-216\'s disclosed gap).',
        });
        return;
      }
      const items = Array.isArray(item.items) ? item.items : [];
      if (items.length < 2) {
        res.status(400).json({ error: "Bundle requires at least 2 items" });
        return;
      }
      // U4/A4 — same fail-closed rule as the single-item path above,
      // applied per-member: a generic asset must never reach a real
      // eBay call through the bundle path either (Development-only,
      // Production bundle writes are already disabled above).
      if (items.some((it) => it?.assetCategory === 'generic')) {
        res.status(400).json({
          error: 'GENERIC_ASSET_NOT_LISTABLE',
          message: 'Generic assets do not support eBay listing (bundle contains a generic asset).',
        });
        return;
      }
      // GK-265 PHASE 3 — no global seller token exists any more, so the
      // bundle path (like every other seller-user call in this file) now
      // REQUIRES a verified GrailKey principal and uses that principal's
      // own eBay User access token. This does NOT close the pre-existing,
      // disclosed per-item-linkage gap (GK-216) — it only removes the
      // global-credential fallback. Bundle listing remains Production-
      // disabled above regardless.
      if (!grailkeyPrincipalId) {
        res.status(401).json({ error: 'GRAILKEY_AUTH_REQUIRED', message: 'A valid GrailKey session is required to create a bundle listing.' });
        return;
      }
      let bundleAccessToken;
      try {
        ({ accessToken: bundleAccessToken } = await resolveEbayUserAccessToken({ principalId: grailkeyPrincipalId }));
      } catch (e) {
        respondEbayTokenError(res, e, 'creating a bundle listing');
        return;
      }
      const bundleHeaders = { ...ebayHeaders, "X-EBAY-API-IAF-TOKEN": bundleAccessToken };

      const bundleImages = items
        .map((it) => (Array.isArray(it.images) && it.images[0]) || it.image || null)
        .filter(Boolean)
        .slice(0, 12);
      const pictureUrls = [];
      for (const img of bundleImages) {
        try {
          const url = await uploadSiteHostedPicture(img, bundleHeaders);
          if (url) pictureUrls.push(url);
        } catch (imgErr) {
          console.error("[ebay] bundle picture upload failed:", imgErr.message);
        }
      }
      // EBAY PUBLISH SAFETY — read-only account/token validity check,
      // immediately before the real AddFixedPriceItem call below.
      await verifySellerAccount(bundleHeaders);

      const xml = buildBundleXml(items, pictureUrls);
      console.log("[ebay] AddFixedPriceItem (bundle) request XML:\n" + redactToken(xml));
      const ebayRes = await fetch(EBAY_ENDPOINT, {
        method: "POST",
        headers: {
          ...bundleHeaders,
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
        },
        body: xml,
      });
      const responseXml = await ebayRes.text();
      const ack = extractTag(responseXml, "Ack");
      const itemId = extractTag(responseXml, "ItemID");
      if (!itemId) {
        console.error(
          `[ebay] bundle listing failed (HTTP ${ebayRes.status}, ack=${ack}). Full response:\n` +
            redactToken(responseXml)
        );
        const shortMsg =
          extractTag(responseXml, "ShortMessage") ||
          extractTag(responseXml, "LongMessage") ||
          "eBay bundle listing failed";
        res.status(502).json({ error: shortMsg, ack });
        return;
      }
      res.status(200).json({
        ok: true,
        bundle: true,
        listingId: itemId,
        listingUrl: `https://www.ebay.com/itm/${itemId}`,
        pictureCount: pictureUrls.length,
        ack: ack || "Success",
      });
      return;
    }

    // U4/A4 (Generic Asset Mode) — a generic asset has no adapter, no
    // automated pricing, and no marketplace-listing shape. Fail closed
    // server-side regardless of what the client UI does or doesn't show
    // — the authoritative gate this dispatch requires, independent of
    // the client-side check in src/App.jsx's listOnEbay.
    if (item.assetCategory === 'generic') {
      res.status(400).json({
        error: 'GENERIC_ASSET_NOT_LISTABLE',
        message: 'Generic assets do not support eBay listing.',
      });
      return;
    }

    if (!item.title) {
      res.status(400).json({ error: "title required" });
      return;
    }

    // T3-1: Confidence gate — block LOW confidence listings
    if (item.claudeCheck?.confidence === 'LOW' ||
        item.matchConfidence?.tier === 'LOW') {
      res.status(400).json({
        error: 'LOW_CONFIDENCE',
        message: 'Identity confidence too low to list. Use Re-identify to improve accuracy first.',
        flags: item.claudeCheck?.flags || []
      });
      return;
    }

    // Outcome #1 PRE-PUBLISH HARDENING (GK-207 correction, 2026-09-12) —
    // durable-linkage pre-flight, now UNCONDITIONAL for this single-item
    // publish path. Runs BEFORE any eBay network call this handler makes
    // (image upload, GetUser, AddFixedPriceItem).
    //
    // CORRECTION FROM THE PRIOR (GK-203/205) DESIGN: this used to be
    // conditional on the caller having supplied ANY of gkAssetId/
    // decisionEventId/operatorActionEventId (GK-151's "no mandatory auth
    // today" carve-out) — meaning an unauthenticated caller, or one whose
    // catalogue item simply had no resolvable GrailKey graph, silently
    // fell through to a legacy publish with NO durable linkage at all.
    // That is now judged an unacceptable gap for this endpoint: a live
    // eBay listing without a durable GrailKey execution row is always a
    // partial failure, not something that should ever be reachable
    // silently. This gate is therefore now unconditional — every
    // single-item publish through this endpoint requires a valid
    // Authorization bearer token AND a complete, valid gkAssetId +
    // decisionEventId + operatorActionEventId (resolving to a real LIST
    // action for an asset this principal owns) before ANY eBay call.
    // A catalogue item with no GrailKey asset at all (never captured via
    // DATA-1D) can no longer be published through this endpoint until it
    // has one — disclosed scope change, not silently narrowed.
    if (!grailkeyPrincipalId) {
      res.status(401).json({
        error: 'GRAILKEY_AUTH_REQUIRED',
        message: 'A valid GrailKey session (Authorization bearer token) is required to publish. Log in before listing.',
      });
      return;
    }
    if (!item.gkAssetId || !item.decisionEventId || !item.operatorActionEventId) {
      res.status(400).json({
        error: 'GRAILKEY_LINKAGE_INCOMPLETE',
        message: 'gkAssetId, decisionEventId, and operatorActionEventId are all required to publish.',
      });
      return;
    }
    try {
      await validateOutcomeAttachment({
        principalId: grailkeyPrincipalId,
        gkAssetId: item.gkAssetId,
        decisionEventId: item.decisionEventId,
        operatorActionEventId: item.operatorActionEventId,
        outcomeType: 'LISTED',
      });
    } catch (e) {
      console.error("[ebay] pre-flight GrailKey linkage validation FAILED — aborting before any eBay call:", e?.message || e);
      // GK-265 PHASE 3 — validateOutcomeAttachment's own
      // assertPrincipalOwnsAsset throws AssetAuthorizationFailedError
      // for a cross-principal gkAssetId (the exact "A session + B
      // asset" case this dispatch's own governing authority law
      // requires rejecting before any eBay call). Previously
      // unclassified here, it fell into the generic 500 branch — still
      // rejected before any eBay call, but mislabeled as a server
      // fault rather than an authorization failure. Found while proving
      // Section 13's cross-principal LIST matrix; fixed, not left as a
      // disclosed gap, since it's directly load-bearing for this same
      // dispatch's authority law.
      const status = (e instanceof NotFoundError) ? 404
        : (e instanceof ValidationFailedError) ? 422
        : (e instanceof AssetAuthorizationFailedError) ? 403
        : 500;
      res.status(status).json({
        error: 'GRAILKEY_LINKAGE_INVALID',
        message: e?.message || 'GrailKey linkage validation failed.',
      });
      return;
    }

    // GRAILKEY INVENTORY AUTHORITY V1 — fail-closed preflight, additive
    // to GK-207's own linkage gate above, never a replacement for it.
    // Requires Inventory Authority state AVAILABLE (UNMANAGED, RESERVED,
    // SOLD, missing, or ambiguous all reject) AND no existing active
    // listing for this asset on this channel — both checked BEFORE any
    // eBay network call. This gate does not reserve anything; it only
    // reads state. Reservation (AVAILABLE -> RESERVED) is a separate,
    // manual/API-driven operation in V1 (src/modules/inventory).
    try {
      await assertListingAuthorized({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId, channel: 'ebay', outcomeIdempotencyKey: item.outcomeIdempotencyKey || null });
    } catch (e) {
      console.error("[ebay] pre-flight Inventory Authority check FAILED — aborting before any eBay call:", e?.message || e);
      if (e instanceof ListingPreflightFailedError) {
        res.status(409).json({ error: e.code, message: e.message });
        return;
      }
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Inventory Authority check failed unexpectedly.' });
      return;
    }

    // OUTCOME #1 V1 — GOVERNED buyer-facing facts. The listing's identity/grade
    // facts come from the DURABLE canonical catalogue row of the OWNED asset
    // (server-held, principal-scoped), never from client-sent title/issue/grade
    // text. Fail-closed BEFORE any eBay call if they cannot be resolved. Price is
    // NOT touched here (pricing authority is unchanged).
    let governedFacts;
    try {
      const canonicalId = await getCanonicalCollectionItemIdForAsset({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId });
      if (!canonicalId) throw new CollectionNotFoundError('asset has no canonical catalogue row');
      const row = await getMyCollectionItem({ principalId: grailkeyPrincipalId, id: canonicalId });
      governedFacts = row?.attributes || null;
      if (!governedFacts || !governedFacts.title) throw new CollectionNotFoundError('canonical row has no title');
    } catch (e) {
      console.error('[ebay] governed listing facts unavailable — aborting before any eBay call:', e?.name || e);
      res.status(409).json({ error: 'LISTING_FACTS_UNAVAILABLE', message: 'The governed catalogue facts for this asset could not be resolved, so nothing was listed.' });
      return;
    }
    // Replace ONLY the buyer-facing identity/grade inputs the builders read with
    // the governed durable values; every other request field is untouched.
    Object.assign(item, {
      title: governedFacts.title, issue: governedFacts.issue ?? null, year: governedFacts.year ?? null,
      publisher: governedFacts.publisher ?? null, variant: governedFacts.variant ?? null,
      gradeAuthority: governedFacts.gradeAuthority ?? null, operatorGrade: governedFacts.operatorGrade ?? null,
      operatorIsGraded: governedFacts.operatorIsGraded ?? null, operatorGradeNumeric: governedFacts.operatorGradeNumeric ?? null,
    });

    // GrailKey Directive Z (GK-95/96) — the transaction-authority gate.
    // Independently RE-DERIVED from raw evidence fields (never a client-
    // computed verdict — item.actionAuthority is never read at all). A
    // synthetic `out`-shaped object is assembled from exactly the fields
    // the client sent above; deriveLocks/deriveActionAuthority are the
    // SAME pure functions responseContract.js runs at enrich time.
    //
    // Known, documented limitation (not silently glossed over): raw
    // identityProvisional/listingHardLockReason booleans aren't reliably
    // present client-side (never merged at any App.jsx merge site — see
    // src/lib/actionAuthority.js's own header). item.priorLockCodes (the
    // LAST real enrich response's own contract.locks codes, which IS
    // reliably merged) is checked as defense-in-depth alongside the
    // freshly-recomputed locks, not as a substitute for them — READY
    // requires BOTH the fresh re-derivation to agree AND the last known
    // snapshot to have carried zero locks. This is genuine independent
    // re-derivation for pricingSource/decision/matchConfidence/comp-count
    // /refusal/manual-review/grade-exceeds-map/claude-gate/tier0 — not
    // yet for the two fields flagged above, which remains open (logged).
    const syntheticOut = {
      decision: item.decision || null,
      pricingSource: item.pricingSource || null,
      matchConfidence: item.matchConfidence || null,
      rawComps: item.rawComps || null,
      // GrailKey Directive AB (GK-101) — out.rawComps is a narrowed
      // reconstruction (api/enrich.js, average/lowest/highest/count/prices
      // only — see that file's Ship v0-B comment) that never carried
      // comps.js's other computed flags either (premiumVariantIsolated,
      // variantCompsExcludedByEra, etc. are all separate top-level out.*
      // fields for the same reason) — variantApplicability is threaded
      // through the same way, as its own top-level synthetic field, not
      // nested under rawComps.
      variantApplicability: item.variantApplicability || null,
      // GrailKey Directive AH (GK-111) — same raw-evidence-field trust
      // boundary as variantApplicability itself (GK-103's own documented,
      // deliberately-unfixed gap: the server trusts client-SENT evidence,
      // never a client-sent VERDICT — this is the former, not the latter).
      // Reason-code precision only: gating already happens via
      // variantApplicability==='UNVERIFIED' above regardless of this
      // field's value, identically to the enrich-time path.
      variantApplicabilitySoldFallback: item.variantApplicabilitySoldFallback === true,
      // item.soldComps arrives as a bare COUNT (App.jsx sends
      // item.soldComps.length, not the array itself) — deriveLocks'
      // low-tier-thin-pool check only reads .length, so a same-length
      // placeholder array reproduces that check exactly without needing
      // the full sold-comp payload over the wire.
      soldComps: new Array(typeof item.soldComps === 'number' ? item.soldComps : 0).fill({}),
      // GK-238 (2026-09-21, Authority Truthfulness Hotfix) — same raw-
      // evidence-field trust boundary as every other line here. Only the
      // three scalar fields deriveMarketStanding actually reads (never the
      // full reasons/rejectedSamples payload) — matches the existing
      // rawComps stripped-to-{count} convention just above. Absent on the
      // client (older cached item, or a field this endpoint's caller never
      // set) means deriveMarketStanding's presence-gated checks are simply
      // not evaluated, identical to its enrich-time behavior before this
      // fix — never a fabricated demotion from missing data.
      soldCompDiagnostics: item.soldCompDiagnostics ? {
        rawCount: typeof item.soldCompDiagnostics.rawCount === 'number' ? item.soldCompDiagnostics.rawCount : null,
        verifiedCount: typeof item.soldCompDiagnostics.verifiedCount === 'number' ? item.soldCompDiagnostics.verifiedCount : null,
        newestDaysAgo: typeof item.soldCompDiagnostics.newestDaysAgo === 'number' ? item.soldCompDiagnostics.newestDaysAgo : null,
      } : null,
      identityConfident: item.identityConfident,
      refusedToPrice: item.refusedToPrice === true,
      manualReviewRequired: item.manualReviewRequired === true,
      gradeExceedsMap: item.gradeExceedsMap === true,
      claudeCheckBlocker: item.claudeCheckBlocker || null,
      tier0Locked: item.tier0Locked === true,
    };
    const freshLocks = deriveLocks(syntheticOut);
    const priorLockCodes = Array.isArray(item.priorLockCodes) ? item.priorLockCodes : [];
    const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
    const serverReady = authority.state === 'READY' && priorLockCodes.length === 0;

    if (!serverReady) {
      // Q41 acknowledged-override: an operator who explicitly set and
      // verified their own price may still list a non-READY book — the
      // EXISTING, already-shipped recovery path (App.jsx Q41 UI), now
      // genuinely server-checked rather than merely logged. Requires a
      // real acknowledgment payload with a manually-set price, not a bare
      // flag.
      const hasValidAck = item.q41Override?.priceOverridden === true &&
        typeof item.q41Override?.manualPrice === 'number' &&
        item.q41Override.manualPrice > 0;
      if (!hasValidAck) {
        res.status(403).json({
          error: 'ACTION_AUTHORITY_NOT_READY',
          message: 'Transaction authority is not READY — insufficient identity/market standing to list without acknowledgment.',
          actionAuthority: authority,
        });
        return;
      }
    }

    // OUTCOME #1 — PRICE BINDING (before any picture upload / eBay call). On the Q41 path the
    // operator-acknowledged price must EXACTLY equal the price about to be listed, and the durable
    // LIST action must record that same approved price (a later write cannot substitute another).
    // Q41 stays execution-only: no valuation is written or changed here.
    const outgoingPrice = resolveOutgoingPrice(item);
    if (outgoingPrice == null || !(outgoingPrice > 0) || toCents(outgoingPrice) === null) {
      res.status(400).json({ error: 'LIST_PRICE_INVALID', message: 'No valid list price — nothing was listed.' });
      return;
    }
    try {
      if (!serverReady) assertQ41PriceBinding({ q41Override: item.q41Override, outgoingPrice });
      const listAction = await getOperatorActionForListing({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId, operatorActionEventId: item.operatorActionEventId });
      assertListActionPriceBinding({ actionValueAmount: listAction.actionValueAmount, outgoingPrice, requireRecorded: !serverReady });
    } catch (e) {
      if (e instanceof PriceBindingError) {
        console.error(`[ebay] price binding refused (${e.code}) — aborting before any eBay call`);
        res.status(409).json({ error: e.code, message: e.message });
        return;
      }
      console.error('[ebay] price-binding preflight failed unexpectedly — aborting before any eBay call:', e?.message || e);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Price-binding check failed unexpectedly; nothing was listed.' });
      return;
    }

    // OUTCOME #1 — AUTHORITATIVE MARKETPLACE METADATA (before any eBay write). Aspect enums and the
    // category condition policy come from eBay's own selling metadata; unavailable => fail closed.
    let aspectMeta, conditionPolicy;
    try {
      [aspectMeta, conditionPolicy] = await Promise.all([getAspectMetadata(CATEGORY_ID), getItemConditionPolicy(CATEGORY_ID)]);
    } catch (e) {
      console.error('[ebay] authoritative listing metadata unavailable — aborting before any eBay write:', e?.message || e);
      res.status(503).json({ error: 'LISTING_METADATA_UNAVAILABLE', message: 'eBay listing metadata could not be verified, so nothing was listed. Please retry.' });
      return;
    }
    if (conditionPolicy.itemConditionRequired === true) {
      // A condition is mandatory for this category and no governed mapping exists — operator ruling needed.
      res.status(409).json({ error: 'CONDITION_RULING_REQUIRED', message: 'This category requires a condition and no authoritative governed mapping exists — nothing was listed.', conditions: conditionPolicy.itemConditions });
      return;
    }
    const listingPlan = {
      conditionId: null, // required=false for 259104: omitted; never derived from a grade string
      bestOffer: item.bestOffer === true, // explicit opt-in only; default OFF
      specifics: buildItemSpecificsFromMetadata(toBuyerSafeListingFacts(item), aspectMeta, { isTPB: item.isTPB === true, isMagazine: item.isMagazine === true }),
      shippingService: null,
    };

    // T2-1: Multi-image upload for singles (up to 12 images)
    // Gate: only upload all images when confidence is not LOW
    const shouldUploadMultiple =
      item.matchConfidence?.tier !== 'LOW' &&
      item.claudeCheck?.confidence !== 'LOW';

    const imagesToUpload = shouldUploadMultiple
      ? (item.images || []).filter(Boolean).slice(0, 12)
      : [(item.images?.[0] || item.image || null)].filter(Boolean);

    // GK-265 PHASE 3 — the authenticated, ownership-verified principal's
    // own eBay User access token (src/lib/ebayPrincipalToken.js).
    // grailkeyPrincipalId is guaranteed non-null and already verified to
    // own item.gkAssetId by the linkage/Inventory Authority gates above
    // — this is never any other seller's credential, and there is no
    // global EBAY_AUTH_TOKEN fallback if resolution fails. Only resolved
    // when there's actually at least one image to upload — a zero-photo
    // request is about to be rejected by the GK-208 gate below
    // regardless, so this avoids a real, wasted OAuth refresh call on a
    // request that was never going to reach eBay either way.
    let singleHeaders = ebayHeaders;
    if (imagesToUpload.length > 0) {
      let singleAccessToken;
      try {
        ({ accessToken: singleAccessToken } = await resolveEbayUserAccessToken({ principalId: grailkeyPrincipalId }));
      } catch (e) {
        respondEbayTokenError(res, e, 'publishing this listing');
        return;
      }
      singleHeaders = { ...ebayHeaders, "X-EBAY-API-IAF-TOKEN": singleAccessToken };
    }

    // OUTCOME #1 — domestic shipping service resolved from eBay's own GeteBayDetails (authoritative);
    // Media Mail is never selectable. Unresolvable => fail closed BEFORE any picture upload.
    if (imagesToUpload.length > 0) {
      try {
        listingPlan.shippingService = await resolveDomesticShippingService({ headers: singleHeaders });
      } catch (e) {
        console.error('[ebay] shipping service resolution failed — aborting before any eBay write:', e?.message || e);
      }
      if (!listingPlan.shippingService) {
        res.status(409).json({ error: 'SHIPPING_SERVICE_UNRESOLVED', message: 'An eligible shipping service could not be verified with eBay (Media Mail is not permitted), so nothing was listed.' });
        return;
      }
    }

    const pictureUrls = [];
    const uploadedPhotos = []; // { bytes, url } — fed to the last-mile photo guard
    for (const img of imagesToUpload) {
      try {
        const url = await uploadSiteHostedPicture(img, singleHeaders);
        if (url) { pictureUrls.push(url); uploadedPhotos.push({ bytes: decodeDataUrl(img).bytes, url }); }
      } catch (imgErr) {
        // Don't hard-fail the whole listing on image upload issues — log and continue without.
        console.error("Picture upload failed:", imgErr.message);
      }
    }

    // GK-208 ZERO-PHOTO PRECALL GATE — eBay's own Trading API hard-
    // requires at least one PictureURL (ErrorCode 21919136, "eBay
    // requires at least one photo") and rejects AddFixedPriceItem
    // outright otherwise. Previously this handler always attempted the
    // real eBay call regardless, letting eBay itself reject a doomed
    // listing (a real 502 was hit this way when the client sent no
    // usable `images` array — GK-208). Fail closed HERE instead: if,
    // after every upload attempt above, zero usable eBay-hosted picture
    // URLs exist, abort BEFORE verifySellerAccount/AddFixedPriceItem —
    // no eBay call is made, and the operator sees an actionable reason
    // instead of an opaque eBay error surfaced through a generic 502.
    if (pictureUrls.length === 0) {
      res.status(400).json({
        error: 'PUBLISH_BLOCKED_NO_PHOTO',
        message: 'PUBLISH BLOCKED — NO VALID EBAY PHOTO. No usable photo could be uploaded to eBay for this listing (0 of ' + imagesToUpload.length + ' attempted image(s) produced a hosted URL). Add or re-check a photo before publishing.',
      });
      return;
    }

    // OUTCOME #1 — LAST-MILE PHOTO GUARD (immediately before the eBay write): every photo must
    // (a) hash to a media row belonging to THIS gkAssetId, (b) be an https, approved-host,
    // non-placeholder URL, (c) be reachable and serve image/*. Anything else => PUBLISH_BLOCKED_NO_PHOTO.
    try {
      const assetMediaHashes = await getAssetMediaContentHashes({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId });
      await assertPublishPhotos({ sourceImages: uploadedPhotos, assetMediaHashes });
    } catch (e) {
      if (e instanceof PhotoGuardError) {
        console.error(`[ebay] photo guard refused (${e.reason}) — aborting before AddFixedPriceItem`);
        res.status(400).json({ error: 'PUBLISH_BLOCKED_NO_PHOTO', message: e.message });
        return;
      }
      console.error('[ebay] photo guard failed unexpectedly — aborting before AddFixedPriceItem:', e?.message || e);
      res.status(400).json({ error: 'PUBLISH_BLOCKED_NO_PHOTO', message: 'PUBLISH BLOCKED — NO VALID EBAY PHOTO (the photo could not be verified against this asset).' });
      return;
    }

    // EBAY PUBLISH SAFETY — read-only account/token validity check,
    // immediately before the real AddFixedPriceItem call below. Throws
    // (and this handler's outer catch turns it into a 500) if the token
    // is invalid or the account cannot be confirmed — the real listing
    // call below never runs in that case.
    await verifySellerAccount(singleHeaders);

    // Step 2: create the listing, including the hosted picture URLs.
    const xml = buildXml(item, pictureUrls, listingPlan);
    console.log("[ebay] AddFixedPriceItem request XML:\n" + redactToken(xml));

    const ebayRes = await fetch(EBAY_ENDPOINT, {
      method: "POST",
      headers: {
        ...singleHeaders,
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
      },
      body: xml,
    });

    const responseXml = await ebayRes.text();
    const ack = extractTag(responseXml, "Ack");
    const itemId = extractTag(responseXml, "ItemID");
    const severity = extractTag(responseXml, "SeverityCode");

    // Success if eBay returned an ItemID, regardless of warnings.
    // Fail only when no ItemID came back (true Failure / PartialFailure with no item).
    if (!itemId) {
      console.error(
        `[ebay] AddFixedPriceItem failed (HTTP ${ebayRes.status}, ack=${ack}, severity=${severity}). Full response:\n` +
          redactToken(responseXml)
      );
      // Extract the first Error-severity message, skipping Warnings.
      const errorMatch = responseXml.match(
        /<Errors>(?:(?!<\/Errors>)[\s\S])*?<SeverityCode>Error<\/SeverityCode>(?:(?!<\/Errors>)[\s\S])*?<ShortMessage>([\s\S]*?)<\/ShortMessage>(?:(?!<\/Errors>)[\s\S])*?<\/Errors>/
      );
      const shortMsg =
        errorMatch?.[1]?.trim() ||
        extractTag(responseXml, "ShortMessage") ||
        extractTag(responseXml, "LongMessage") ||
        "eBay listing failed";
      res.status(502).json({
        error: shortMsg,
        ack,
        ...(process.env.NODE_ENV !== "production" ? { raw: responseXml } : {}),
      });
      return;
    }

    // ItemID present but eBay returned warnings — log them and continue.
    if (ack && /Warning|PartialFailure/i.test(ack)) {
      console.warn(
        `[ebay] AddFixedPriceItem succeeded with warnings (ack=${ack}). Full response:\n` +
          redactToken(responseXml)
      );
    }

    // Outcome #1 — the durable marketplace-execution write. Runs ONLY
    // here, after itemId is already confirmed present above — never
    // before eBay's own acknowledgment, so a failure earlier in this
    // handler can never produce a false LISTED fact. Never blocks or
    // alters the real eBay response: attemptListedOutcome never throws,
    // and its result is purely additive information on the response body.
    const askAmount = parsePriceNumber(item.price) ?? parsePriceNumber(item.priceHigh) ?? parsePriceNumber(item.priceLow) ?? null;
    const outcome = await attemptListedOutcome({
      principalId: grailkeyPrincipalId,
      gkAssetId: item.gkAssetId || null,
      decisionEventId: item.decisionEventId || null,
      operatorActionEventId: item.operatorActionEventId || null,
      externalListingId: itemId,
      askAmount,
      idempotencyKey: item.outcomeIdempotencyKey || null,
      correlationId: item.correlationId || null,
      recordOutcomeEvent,
    });
    if (outcome.attempted && !outcome.ok) {
      console.error("[ebay] Outcome #1 durable write declined/failed (listing itself succeeded):", outcome.declineReason, outcome.error?.message);
    } else if (outcome.attempted) {
      console.log("[ebay] Outcome #1 durable LISTED row recorded:", outcome.outcomeEventId);
    }

    res.status(200).json({
      ok: true,
      listingId: itemId,
      listingUrl: `https://www.ebay.com/itm/${itemId}`,
      outcome,
      pictureCount: pictureUrls.length,
      ack: ack || "Success",
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
