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
import { resolveListingAuthorityEvidence } from "../src/lib/listingAuthorityEvidence.js";
import { computeEvidenceVersion, verifyAuthorityReceipt } from "../src/lib/authorityReceipt.js";
import { buildPricingBasis, pricingBasisRefuses } from "../src/lib/pricingBasisSnapshot.js";
import { deriveActionAuthority } from "../src/lib/actionAuthority.js";
import { toBuyerSafeListingFacts, buildGovernedListingTitle, rawConditionDisclosure } from "../src/lib/buyerSafeListingCopy.js";
import { getMyCollectionItem, NotFoundError as CollectionNotFoundError } from "../src/modules/collection/index.js";
import { toCents, assertQ41PriceBinding, assertListActionPriceBinding, PriceBindingError } from "../src/lib/listingPriceBinding.js";
import { getAspectMetadata, getItemConditionPolicy, buildItemSpecificsFromMetadata, resolveDomesticShippingService } from "../src/lib/ebayListingMetadata.js";
import { buildListingPackage, appendShippingAndReturns } from "../src/lib/listingPackage.js";
import { checkListingApproval } from "../src/lib/listingApproval.js";
import { assertPublishPhotos, assertSourceImages, PhotoGuardError } from "../src/lib/listingPhotoGuard.js";
import { uploadImageViaMediaApi, MediaApiError, hasMediaScope } from "../src/lib/ebayMediaApi.js";

// Outcome #1 — OPTIONAL, ADDITIVE GrailKey linkage. Neither import below
// changes this endpoint's existing, still-mandatory behavior for a
// caller that sends none of the new fields (gkAssetId/decisionEventId/
// operatorActionEventId/idempotencyKey/Authorization) — see
// src/lib/marketplaceOutcomeBridge.js's own header (GK-151: this
// endpoint has no mandatory GrailKey auth today, and this dispatch does
// not add one).
import { verifyToken, InvalidTokenError } from "../src/modules/auth/index.js";
import { listAssetMediaForListing } from "../src/modules/assets/index.js";
import { acquirePublicationMutex, getPublicationIdentity, recordOutcomeEvent, validateOutcomeAttachment, resolveOwnedAssetForListing, resolveCollectionItemLink, getCanonicalCollectionItemIdForAsset, getOperatorActionForListing, getAssetMediaContentHashes, authorizeOperatorManualListing, recordMarketplaceAttemptPhase, ListingAttemptBlockedError, AuthorizationFailedError as AssetAuthorizationFailedError, NotFoundError, ValidationFailedError } from "../src/modules/assets/index.js";
import { sanitizeQ41Ack, buildAckWarnings, classifyAddItemResponse } from "../src/lib/operatorAuthority.js";
import { attemptListedOutcome } from "../src/lib/marketplaceOutcomeBridge.js";
import { parseDuplicateUuidError, parseListingIdentity, evaluateRecoveredListing } from "../src/lib/ebayPublicationIdentity.js";
import { assertListingAuthorized, ListingPreflightFailedError } from "../src/lib/inventoryListingPreflight.js";
// GK-P0 -- the OPERATOR-ONLY gate for every marketplace-mutating route (see src/lib/marketplaceOperatorGate.js).
import { requireMarketplaceOperator } from "../src/lib/marketplaceOperatorGate.js";
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

  if (f.isRaw) {
    // RAW copy: state it explicitly; never present an operator grade as a professional certification.
    lines.push(`<p><strong>${xmlEscape(rawConditionDisclosure(f))}</strong></p>`);
  } else if (f.publicGrade) {
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
  // V1.1a: when a seller-approved listing package exists, its title and description body are what publish (the fixed shipping /
  // returns block is appended here because the shipping service is resolved at publish time). Otherwise the legacy builders.
  const title = plan.title != null ? plan.title : buildTitle(item);
  const description = plan.descriptionBody != null
    ? appendShippingAndReturns(plan.descriptionBody, plan.shippingService.description)
    : buildDescription(item, plan.shippingService.description);
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

  // GK-284 / B1-FINAL A3 -- attempt-linked provider correlation (only for an OPERATOR_MANUAL attempt). Item.UUID is eBay's ITEM ORDER: eBay's ItemType is an xs:sequence in which UUID precedes SKU (schema v1487), so they are emitted in that relative order.
  // documented duplicate-listing defence (a resend with the same UUID yields error 488 + the existing ItemID, KB 1462);
  // Item.SKU is a seller-visible custom label so the listing can be recognised in Seller Hub and in GetMyeBaySelling.
  const correlationBlock = plan.correlation && plan.correlation.uuid && plan.correlation.sku
    ? `    <UUID>${xmlEscape(plan.correlation.uuid)}</UUID>
    <SKU>${xmlEscape(plan.correlation.sku)}</SKU>
`
    : '';

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
${correlationBlock}    <Site>US</Site>
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

// GK-P0 PROVIDER IDEMPOTENCY -- read-only GetItem used ONLY to authenticate a listing that a duplicate-UUID (488)
// refusal points at. Returns the parsed identity, or throws on transport failure (caller treats that as unverified).
const fetchListingIdentity = async (ebayItemId, headers) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${xmlEscape(ebayItemId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;
  const r = await fetch(EBAY_ENDPOINT, {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": "GetItem" },
    body: xml,
  });
  return parseListingIdentity(await r.text());
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

// GK-P0 READY-RACE -- every exit path of the real handler (return, throw) passes through here, so a publication
// mutex taken inside is ALWAYS released. The handler body below is unchanged apart from taking it.
export default async function handler(req, res) {
  const ctx = { publicationMutex: null };
  try {
    return await handleListEbay(req, res, ctx);
  } finally {
    if (ctx.publicationMutex) { try { await ctx.publicationMutex.release(); } catch { /* never masks the response */ } }
  }
}

async function handleListEbay(req, res, ctx) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // GK-P0 (2026-10-13) -- OPERATOR-ONLY. Runs before ANY other work in this handler: before the application-credential
  // check, before the optional-auth block below, before the status / bundle / single-item branches, before any picture
  // upload (Media API or UploadSiteHostedPictures), before GetUser / AddFixedPriceItem, and before the durable
  // OPERATOR_MANUAL authority or attempt-ledger write. 401 unauthenticated, 403 not an operator, 503 operator authority
  // cannot be established. Nothing the client sends (role, principal id, operator flag) is read. The B1 protections
  // below (Q41, price binding, inventory authority, attempt ledger, reconciliation) are unchanged.
  const operatorGate = await requireMarketplaceOperator(req, { label: "list-ebay" });
  if (!operatorGate.ok) {
    res.status(operatorGate.status).json(operatorGate.body);
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
      // DISTINCT linkage failures (all before any eBay call; all keep the established GRAILKEY_LINKAGE_INCOMPLETE code, plus a machine-readable `reason`):
      //   GK_ASSET_ID_MISSING -> (new) PHYSICAL_ASSET_NOT_LINKED when the caller proves, as the AUTHENTICATED OWNER of a named Collection row, that the row has no link;
      //   DECISION_EVENT_MISSING / OPERATOR_ACTION_MISSING -> the asset is known but an event id is absent.
      // Linkage-specific information is returned ONLY after the caller is shown to own the Collection row (getMyCollectionItem is principal-scoped); for a row that
      // is not theirs or does not exist the response is the generic one, so linkage state of other principals' rows can never be probed. Nothing here mints,
      // links, attests ownership, writes authority, or calls eBay.
      if (!item.gkAssetId) {
        const cid = typeof item.collectionItemId === 'string' && item.collectionItemId ? item.collectionItemId : null;
        if (cid) {
          let owned = false;
          try { owned = !!(await getMyCollectionItem({ principalId: grailkeyPrincipalId, id: cid })); } catch { owned = false; }
          if (owned) {
            let linked = null;
            try { linked = await resolveCollectionItemLink({ principalId: grailkeyPrincipalId, collectionItemId: cid }); } catch { linked = undefined; }
            if (linked === null) {
              res.status(409).json({
                error: 'PHYSICAL_ASSET_NOT_LINKED',
                message: 'This Collection record is not linked to a physical asset. Nothing was listed. Use "Capture as Owned Physical Asset" on this record if you own this copy.',
              });
              return;
            }
          }
        }
        res.status(400).json({ error: 'GRAILKEY_LINKAGE_INCOMPLETE', reason: 'GK_ASSET_ID_MISSING', message: 'gkAssetId, decisionEventId, and operatorActionEventId are all required to publish.' });
        return;
      }
      const reason = !item.decisionEventId ? 'DECISION_EVENT_MISSING' : 'OPERATOR_ACTION_MISSING';
      res.status(400).json({ error: 'GRAILKEY_LINKAGE_INCOMPLETE', reason, message: 'gkAssetId, decisionEventId, and operatorActionEventId are all required to publish.' });
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
    let governedCanonicalId = null;
    try {
      const canonicalId = await getCanonicalCollectionItemIdForAsset({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId });
      if (!canonicalId) throw new CollectionNotFoundError('asset has no canonical catalogue row');
      governedCanonicalId = canonicalId;
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
    // V1 CERTIFICATION / GK-240 — critical authority evidence is resolved from the OWNED ASSET'S DURABLE
    // canonical row first (the request can only fill what the durable row lacks), and MISSING sold-evidence
    // diagnostics fail closed (NO_SOLD_EVIDENCE floor) instead of skipping the check. See
    // src/lib/listingAuthorityEvidence.js. A forged request decision / an omitted soldCompDiagnostics can no
    // longer reach READY.
    // Current evidence version = hash of THIS asset's durable media content hashes, read server-side now. A lookup failure yields a
    // sentinel that can match no signed version (fail closed).
    const currentEvidenceVersion = async () => {
      try { return computeEvidenceVersion(await getAssetMediaContentHashes({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId })); }
      catch { return 'EVIDENCE_UNAVAILABLE'; }
    };
    const evidenceVersionNow = await currentEvidenceVersion();
    const { evidence: authEv, priorLockCodes: governedPriorLockCodes, sources: authSources } =
      resolveListingAuthorityEvidence(item, governedFacts, {
        principalId: grailkeyPrincipalId,
        gkAssetId: item.gkAssetId,
        collectionItemId: governedCanonicalId,
        evidenceVersion: evidenceVersionNow,
      });
    console.log('[ebay] authority evidence sources:', JSON.stringify(authSources));
    const syntheticOut = {
      decision: authEv.decision,
      pricingSource: authEv.pricingSource,
      matchConfidence: authEv.matchConfidence,
      rawComps: authEv.rawComps,
      // GrailKey Directive AB (GK-101) — out.rawComps is a narrowed
      // reconstruction (api/enrich.js, average/lowest/highest/count/prices
      // only — see that file's Ship v0-B comment) that never carried
      // comps.js's other computed flags either (premiumVariantIsolated,
      // variantCompsExcludedByEra, etc. are all separate top-level out.*
      // fields for the same reason) — variantApplicability is threaded
      // through the same way, as its own top-level synthetic field, not
      // nested under rawComps.
      variantApplicability: authEv.variantApplicability,
      // GrailKey Directive AH (GK-111) — same raw-evidence-field trust
      // boundary as variantApplicability itself (GK-103's own documented,
      // deliberately-unfixed gap: the server trusts client-SENT evidence,
      // never a client-sent VERDICT — this is the former, not the latter).
      // Reason-code precision only: gating already happens via
      // variantApplicability==='UNVERIFIED' above regardless of this
      // field's value, identically to the enrich-time path.
      variantApplicabilitySoldFallback: authEv.variantApplicabilitySoldFallback,
      // item.soldComps arrives as a bare COUNT (App.jsx sends
      // item.soldComps.length, not the array itself) — deriveLocks'
      // low-tier-thin-pool check only reads .length, so a same-length
      // placeholder array reproduces that check exactly without needing
      // the full sold-comp payload over the wire.
      soldComps: new Array(authEv.soldCompCount).fill({}),
      // GK-238 (2026-09-21, Authority Truthfulness Hotfix) — same raw-
      // evidence-field trust boundary as every other line here. Only the
      // three scalar fields deriveMarketStanding actually reads (never the
      // full reasons/rejectedSamples payload) — matches the existing
      // rawComps stripped-to-{count} convention just above. Absent on the
      // client (older cached item, or a field this endpoint's caller never
      // set) means deriveMarketStanding's presence-gated checks are simply
      // not evaluated, identical to its enrich-time behavior before this
      // fix — never a fabricated demotion from missing data.
      // V1 CERTIFICATION (supersedes the "absence never fabricates a demotion" note above for THIS
      // endpoint): absent diagnostics now fail closed inside resolveListingAuthorityEvidence.
      soldCompDiagnostics: authEv.soldCompDiagnostics,
      identityConfident: authEv.identityConfident,
      refusedToPrice: authEv.refusedToPrice,
      manualReviewRequired: authEv.manualReviewRequired,
      gradeExceedsMap: authEv.gradeExceedsMap,
      claudeCheckBlocker: authEv.claudeCheckBlocker,
      tier0Locked: authEv.tier0Locked,
    };
    const freshLocks = deriveLocks(syntheticOut);
    const priorLockCodes = governedPriorLockCodes;
    const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
    const serverReady = authority.state === 'READY' && priorLockCodes.length === 0;

    // C1 (2026-10-23) -- PUBLICATION REQUIRES A VERIFIED AUTHORITY RECEIPT, INDEPENDENT OF Q41.
    // Q41 is an operator's exact-price acknowledgement, never evidence: it must not stand in for a server-signed
    // receipt that verifies for THIS principal, names THIS catalogue row and asset, matches the row's identity and
    // carries the CURRENT media evidence version. Anything else (absent / malformed / forged / wrong principal /
    // identity mismatch / unbound / other asset or row / stale evidence) refuses here, before any price binding,
    // photo work, token exchange, ledger or inventory write, or eBay call. Same refusal shape and code as the
    // not-READY refusal below, with the explicit AUTHORITY_RECEIPT_* reason.
    if (authSources.receipt !== 'VERIFIED') {
      const receiptRefusalReason = `AUTHORITY_RECEIPT_${String(authSources.receipt).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
      console.error(`[ebay] ${receiptRefusalReason} — verified authority receipt required; aborting before any eBay call`);
      res.status(403).json({
        error: 'ACTION_AUTHORITY_NOT_READY',
        message: 'A verified authority receipt for this asset is required to list, with or without an acknowledged price — nothing was listed.',
        actionAuthority: authority,
        authorityReceipt: authSources.receipt,
        refusalReason: receiptRefusalReason,
      });
      return;
    }

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
          // V1 P0 — why the server could not rely on the stored evidence: VERIFIED | IDENTITY_MISMATCH | UNVERIFIED:<reason>
          authorityReceipt: authSources.receipt,
          // distinct, machine-readable: the receipt is why standing could not be established (absent / unbound / stale / mismatch / invalid) vs an ordinary insufficiency
          refusalReason: authSources.receipt === 'VERIFIED' ? 'AUTHORITY_INSUFFICIENT' : `AUTHORITY_RECEIPT_${String(authSources.receipt).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`,
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

    // EBAY MEDIA API CUTOVER — SOURCE MEDIA VALIDATION, before ANY eBay network call (reads included).
    // Every photo must be a real image data URL, in a format the Media API accepts, whose bytes match its declared
    // format and hash to a media row of THIS gkAssetId. Invalid source => PUBLISH_BLOCKED_NO_PHOTO with ZERO eBay calls.
    // T2-1: up to 12 images; only upload them all when confidence is not LOW.
    const shouldUploadMultiple =
      item.matchConfidence?.tier !== 'LOW' &&
      item.claudeCheck?.confidence !== 'LOW';
    const imagesToUpload = (shouldUploadMultiple || item.listingApproval)
      ? (item.images || []).filter(Boolean).slice(0, 12)
      : [(item.images?.[0] || item.image || null)].filter(Boolean);
    let assetMediaHashes, sourcePhotos;
    try {
      assetMediaHashes = await getAssetMediaContentHashes({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId });
      sourcePhotos = assertSourceImages({ images: imagesToUpload, assetMediaHashes });
    } catch (e) {
      if (e instanceof PhotoGuardError) {
        console.error(`[ebay] source media refused (${e.reason}) — aborting before any eBay call`);
        res.status(400).json({ error: 'PUBLISH_BLOCKED_NO_PHOTO', reason: e.reason, message: e.message });
        return;
      }
      console.error('[ebay] source media validation failed unexpectedly — aborting before any eBay call:', e?.message || e);
      res.status(400).json({ error: 'PUBLISH_BLOCKED_NO_PHOTO', reason: 'source-validation-error', message: 'PUBLISH BLOCKED — NO VALID EBAY PHOTO (the photo could not be verified against this asset).' });
      return;
    }

    // GATE-B-COHERENCE-BEGIN -- listing-time detection of an internally inconsistent pricing bundle (src/lib/pricingBundleCoherence.js). PARTIAL control: see that file's header.
    // Placed AFTER every pre-existing local gate (authority, ack, price binding, inventory, duplicate and attempt guards) so their responses are unchanged, and BEFORE the operator
    // authority row is written and before every eBay network call. No existing guard is disabled or reordered.
    const coherenceReceipt = verifyAuthorityReceipt(governedFacts.authorityReceipt, grailkeyPrincipalId);
    const coherenceReceiptPayload = coherenceReceipt.ok ? coherenceReceipt.payload : null;
    const pricingBasisForAuthority = buildPricingBasis({
      durable: governedFacts, receiptPayload: coherenceReceiptPayload, receiptBody: coherenceReceipt.ok ? governedFacts.authorityReceipt.body : null,
      receiptBindingState: authSources.receipt === 'VERIFIED' ? 'BOUND' : String(authSources.receipt || 'NOT_CHECKED'), evidenceVersion: evidenceVersionNow,
    });
    if (pricingBasisRefuses(pricingBasisForAuthority)) {
      console.error('[ebay] PRICING_BUNDLE_INCOHERENT — aborting before any eBay call:', JSON.stringify(pricingBasisForAuthority.coherence.violations));
      res.status(409).json({
        error: 'PRICING_BUNDLE_INCOHERENT',
        message: 'The stored pricing evidence for this asset is internally inconsistent, so nothing was listed. Refresh the market data and review the card.',
        violations: pricingBasisForAuthority.coherence.violations, protection: 'PARTIAL',
      });
      return;
    }
    // GATE-B-COHERENCE-END
    // GK-P0 READY-RACE -- PUBLICATION MUTEX. Every local gate above is a READ; two simultaneous requests for one asset
    // could both pass them. The Q41 path was already serialised by the attempt ledger (per-asset lock + AUTHORIZED row),
    // but the READY path writes no ledger row and had nothing. Take a Postgres-level mutex for (asset, channel) here --
    // after every gate, before the first provider write -- for BOTH paths (a client can steer a request onto the Q41
    // path via priorLockCodes, so a READY and a Q41 request can race each other). Try-lock: a loser is refused at once
    // with zero provider calls. The duplicate / sold / inventory preflight is then RE-RUN under the mutex, so a request
    // that waited behind a completed publication sees its LISTED outcome and is refused as a duplicate.
    try {
      ctx.publicationMutex = await acquirePublicationMutex({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId, channel: 'ebay' });
    } catch (e) {
      console.error('[ebay] publication mutex could not be taken — aborting before any eBay call:', e?.code || e?.name, e?.message || e);
      res.status(503).json({ error: 'PUBLICATION_LOCK_UNAVAILABLE', message: 'The publication lock could not be taken, so nothing was listed. Please retry.' });
      return;
    }
    if (!ctx.publicationMutex.acquired) {
      ctx.publicationMutex = null;
      console.error('[ebay] PUBLICATION_IN_PROGRESS — another publication for this asset holds the mutex; aborting before any eBay call');
      res.status(409).json({ error: 'PUBLICATION_IN_PROGRESS', message: 'A publication for this asset is already in progress, so nothing was listed. Check its status before trying again.' });
      return;
    }
    try {
      await assertListingAuthorized({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId, channel: 'ebay', outcomeIdempotencyKey: item.outcomeIdempotencyKey || null });
    } catch (e) {
      console.error('[ebay] under-mutex preflight FAILED — aborting before any eBay call:', e?.message || e);
      if (e instanceof ListingPreflightFailedError) { res.status(409).json({ error: e.code, message: e.message }); return; }
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Inventory Authority check failed unexpectedly.' });
      return;
    }
    // GK-P0 PROVIDER IDEMPOTENCY -- the durable Item.UUID/SKU for THIS logical publication: a pure function of
    // (asset, channel, listing generation). Identical across crashes, lost responses and new HTTP requests; changes
    // only after the previous listing is terminal. Fail closed: no identity, no provider call.
    let publicationIdentity;
    try {
      publicationIdentity = await getPublicationIdentity({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId, channel: 'ebay' });
    } catch (e) {
      console.error('[ebay] publication identity could not be derived — aborting before any eBay call:', e?.code || e?.name, e?.message || e);
      res.status(503).json({ error: 'PUBLICATION_IDENTITY_UNAVAILABLE', message: 'The durable publication identity could not be derived, so nothing was listed. Please retry.' });
      return;
    }
    // GK-284 -- DURABLE OPERATOR_MANUAL AUTHORITY. When the engine's own authority is NOT READY, the only
    // way to reach a marketplace write is the operator's exact-price acknowledgment (Q41). That approval is
    // recorded durably HERE -- after every local precondition (ownership, inventory, duplicate and attempt
    // guards, price binding, source media) and BEFORE the first eBay network call -- bound to the asset,
    // principal, LIST operator action and exact approved price, with the original engine recommendation
    // (read, never changed) and the evidence the operator was shown. If it cannot be recorded, nothing is sent.
    let manualAttempt = null;
    if (!serverReady) {
      try {
        manualAttempt = await authorizeOperatorManualListing({
          principalId: grailkeyPrincipalId,
          gkAssetId: item.gkAssetId,
          decisionEventId: item.decisionEventId,
          operatorActionEventId: item.operatorActionEventId,
          outgoingAmount: outgoingPrice,
          ackPayload: sanitizeQ41Ack(item.q41Override),
          ackWarnings: buildAckWarnings({ authority, priorLockCodes, freshLockCodes: Array.isArray(freshLocks) ? freshLocks.map((l) => l && l.code) : [] }),
          durableAttrs: governedFacts,
          presentedAttrs: { pricingSource: item.pricingSource || null, soldCompDiagnostics: item.soldCompDiagnostics || null },
          pricingBasis: pricingBasisForAuthority,
        });
      } catch (e) {
        console.error('[ebay] OPERATOR_MANUAL authority could not be recorded — aborting before any eBay call:', e?.code || e?.name, e?.message || e);
        if (e instanceof ListingAttemptBlockedError) { res.status(409).json({ error: e.guardCode, message: e.message, blockingAttemptId: e.blockingAttemptId }); return; }
        if (e instanceof AssetAuthorizationFailedError) { res.status(403).json({ error: 'OPERATOR_AUTHORITY_FORBIDDEN', message: 'This principal cannot authorize a listing for this asset. Nothing was listed.' }); return; }
        if (e instanceof NotFoundError) { res.status(404).json({ error: 'OPERATOR_AUTHORITY_INVALID', message: e.message }); return; }
        if (e instanceof ValidationFailedError) {
          const code = (String(e.message).match(/^(MANUAL_PRICE_ACK_MISMATCH|LIST_ACTION_PRICE_MISMATCH|LIST_ACTION_PRICE_NOT_RECORDED)/) || [])[1] || 'OPERATOR_AUTHORITY_INVALID';
          res.status(409).json({ error: code, message: e.message }); return;
        }
        res.status(503).json({ error: 'OPERATOR_AUTHORITY_UNAVAILABLE', message: 'The operator authorization could not be recorded, so nothing was listed. Please retry.' });
        return;
      }
    }
    // Records one attempt phase; returns false (never throws) so a ledger fault AFTER the provider call
    // cannot change what the operator is told about the real listing.
    const recordAttempt = async (phase, extra = {}) => {
      if (!manualAttempt) return true;
      try {
        await recordMarketplaceAttemptPhase({ principalId: grailkeyPrincipalId, attemptId: manualAttempt.attemptId, phase, ...extra });
        return true;
      } catch (e) {
        console.error(`[ebay] attempt ledger write failed (${phase}):`, e?.code || e?.name, e?.message || e);
        return false;
      }
    };

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
      correlation: manualAttempt ? manualAttempt.providerCorrelation : publicationIdentity, // GK-284 / A3 (Q41: attempt-derived) | GK-P0 (READY: asset+channel+generation-derived): Item.UUID + Item.SKU
    };

    // V1.1a -- SELLER-APPROVED LISTING PACKAGE. The package is rebuilt HERE from the durable governed row, the durable media rows and the
    // outgoing price (the same pure builder the preview uses). A generated package is not permission to publish: the request must carry
    // the server-signed approval for EXACTLY this package (title, description body, specifics, ordered photo hashes, price), else
    // nothing is uploaded and nothing is published. Any correction, new photo or price change invalidates a prior approval.
    let listingPkg;
    try {
      const mediaRows = await listAssetMediaForListing({ principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId });
      listingPkg = buildListingPackage({
        governed: governedFacts, draft: governedFacts.listingDraft, media: mediaRows, price: outgoingPrice, pricingSource: authEv.pricingSource,
        aspectMeta, conditionPolicy, isTPB: item.isTPB === true, isMagazine: item.isMagazine === true,
      });
    } catch (e) {
      console.error('[ebay] listing package could not be built — aborting before any eBay write:', e?.message || e);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'The listing package could not be built; nothing was listed.' });
      return;
    }
    {
      const approvalCheck = checkListingApproval(item.listingApproval, {
        principalId: grailkeyPrincipalId, gkAssetId: item.gkAssetId, currentPackageHash: listingPkg.approvable ? listingPkg.packageHash : null,
      });
      if (!approvalCheck.ok) {
        console.error(`[ebay] LISTING_PACKAGE_APPROVAL_REQUIRED (${approvalCheck.reason}) — aborting before any eBay write`);
        res.status(409).json({
          error: 'LISTING_PACKAGE_APPROVAL_REQUIRED', reason: approvalCheck.reason,
          message: 'Review and approve the listing package before publishing; nothing was listed.',
          blocking: listingPkg.unresolved.filter((u) => u.severity === 'blocking'),
        });
        return;
      }
      // The photographs sent must be EXACTLY the approved, hash-bound set; publish them in the approved order (FRONT first).
      const approvedOrder = listingPkg.photos.selected.map((p) => p.contentHash);
      const sentByHash = new Map(sourcePhotos.map((p) => [p.sha256, p]));
      if (sentByHash.size !== approvedOrder.length || !approvedOrder.every((h) => sentByHash.has(h))) {
        console.error('[ebay] LISTING_PACKAGE_PHOTO_MISMATCH — photographs sent differ from the approved package; aborting before any eBay write');
        res.status(409).json({ error: 'LISTING_PACKAGE_PHOTO_MISMATCH', message: 'The photographs sent do not match the approved package; nothing was listed.', approved: approvedOrder.length, sent: sentByHash.size });
        return;
      }
      sourcePhotos = approvedOrder.map((h) => sentByHash.get(h));
      listingPlan.title = listingPkg.title;
      listingPlan.descriptionBody = listingPkg.descriptionBody;
      listingPlan.specifics = listingPkg.specifics;
    }

    // GK-265 PHASE 3 — the authenticated, ownership-verified principal's own eBay User access token
    // (src/lib/ebayPrincipalToken.js); no global fallback. Source media is already validated (>=1 owned photo).
    // The Media API needs the sell.inventory scope. A refresh token's scopes are fixed at consent, so a connection
    // made before that scope was requested is refused HERE, before any eBay write, with reconnect guidance.
    let singleAccessToken, singleScopes;
    try {
      ({ accessToken: singleAccessToken, scopes: singleScopes } = await resolveEbayUserAccessToken({ principalId: grailkeyPrincipalId }));
    } catch (e) {
      respondEbayTokenError(res, e, 'publishing this listing');
      return;
    }
    if (!hasMediaScope(singleScopes)) {
      console.error('[ebay] seller connection lacks the sell.inventory scope required by the Media API — aborting before any eBay write');
      res.status(409).json({ error: 'EBAY_MEDIA_PERMISSION_REQUIRED', message: 'Your eBay connection predates image-upload permission. Reconnect eBay to grant it, then try again. Nothing was listed.' });
      return;
    }
    const singleHeaders = { ...ebayHeaders, "X-EBAY-API-IAF-TOKEN": singleAccessToken };

    // OUTCOME #1 — domestic shipping service resolved from eBay's own GeteBayDetails (authoritative);
    // Media Mail is never selectable. Unresolvable => fail closed BEFORE any picture upload.
    try {
      listingPlan.shippingService = await resolveDomesticShippingService({ headers: singleHeaders });
    } catch (e) {
      console.error('[ebay] shipping service resolution failed — aborting before any eBay write:', e?.message || e);
    }
    if (!listingPlan.shippingService) {
      res.status(409).json({ error: 'SHIPPING_SERVICE_UNRESOLVED', message: 'An eligible shipping service could not be verified with eBay (Media Mail is not permitted), so nothing was listed.' });
      return;
    }

    // EBAY MEDIA API (createImageFromFile) — the ONLY single-listing upload path; there is no fallback to
    // UploadSiteHostedPictures. All-or-nothing: any failed or malformed upload aborts the publish BEFORE
    // verifySellerAccount / AddFixedPriceItem (a listing with fewer photos than the operator sent is never created silently).
    const pictureUrls = [];
    const uploadedPhotos = []; // { bytes, url } — fed to the last-mile photo guard
    for (const photo of sourcePhotos) {
      try {
        const url = await uploadImageViaMediaApi({ bytes: photo.bytes, mimeType: photo.mimeType, accessToken: singleAccessToken });
        pictureUrls.push(url);
        uploadedPhotos.push({ bytes: photo.bytes, url });
      } catch (mediaErr) {
        if (mediaErr instanceof MediaApiError && mediaErr.code === 'MEDIA_PERMISSION') {
          console.error('[ebay] Media API refused the seller token — aborting before AddFixedPriceItem:', mediaErr.message);
          res.status(409).json({ error: 'EBAY_MEDIA_PERMISSION_REQUIRED', message: 'eBay refused image upload for this connection. Reconnect eBay to grant image-upload permission, then try again. Nothing was listed.' });
          return;
        }
        const reason = mediaErr instanceof MediaApiError && mediaErr.code === 'MEDIA_RESPONSE_MALFORMED' ? 'media-response-malformed' : 'media-upload-failed';
        console.error(`[ebay] Media API upload failed (${reason}) — aborting before AddFixedPriceItem:`, mediaErr?.message || mediaErr);
        res.status(502).json({ error: 'PUBLISH_BLOCKED_NO_PHOTO', reason, message: 'PUBLISH BLOCKED — NO VALID EBAY PHOTO. eBay did not accept the photo upload, so nothing was listed. Please retry.' });
        return;
      }
    }

    // ZERO-PHOTO PRECALL GATE (GK-208) — unreachable with validated sources, kept as a defensive invariant.
    if (pictureUrls.length === 0 || pictureUrls.length !== sourcePhotos.length) {
      res.status(400).json({ error: 'PUBLISH_BLOCKED_NO_PHOTO', reason: 'no-hosted-url', message: 'PUBLISH BLOCKED — NO VALID EBAY PHOTO.' });
      return;
    }

    // OUTCOME #1 — LAST-MILE PHOTO GUARD (immediately before the eBay write): every photo must
    // (a) hash to a media row belonging to THIS gkAssetId, (b) be an https, approved-host,
    // non-placeholder URL, (c) be reachable and serve image/*. Anything else => PUBLISH_BLOCKED_NO_PHOTO.
    try {
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
    const sellerAccount = await verifySellerAccount(singleHeaders);

    // Step 2: create the listing, including the hosted picture URLs.
    const xml = buildXml(item, pictureUrls, listingPlan);
    console.log("[ebay] AddFixedPriceItem request XML:\n" + redactToken(xml));

    // GK-284 -- the SUBMITTED phase is written immediately BEFORE the provider write. If the ledger
    // cannot record it, nothing is sent (a call with no durable record of intent is never made).
    // A concurrent second attempt for this asset is refused here, by the ledger, under a per-asset lock.
    if (manualAttempt) {
      try {
        await recordMarketplaceAttemptPhase({ principalId: grailkeyPrincipalId, attemptId: manualAttempt.attemptId, phase: 'SUBMITTED' });
      } catch (e) {
        console.error('[ebay] attempt SUBMITTED could not be recorded — aborting before AddFixedPriceItem:', e?.code || e?.name, e?.message || e);
        if (e instanceof ListingAttemptBlockedError) { res.status(409).json({ error: e.guardCode, message: e.message, blockingAttemptId: e.blockingAttemptId }); return; }
        res.status(503).json({ error: 'ATTEMPT_LEDGER_UNAVAILABLE', message: 'The listing attempt could not be recorded, so nothing was listed. Please retry.' });
        return;
      }
    }

    let ebayRes = null, responseXml = null, providerNetworkError = null;
    try {
      ebayRes = await fetch(EBAY_ENDPOINT, {
        method: "POST",
        headers: {
          ...singleHeaders,
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
        },
        body: xml,
      });
      responseXml = await ebayRes.text();
    } catch (e) {
      providerNetworkError = e;
    }
    // Unchanged behavior for the engine-READY path: a transport failure surfaces exactly as before.
    if (providerNetworkError && !manualAttempt) throw providerNetworkError;
    const attemptClass = manualAttempt
      ? classifyAddItemResponse({ networkError: providerNetworkError, httpStatus: ebayRes ? ebayRes.status : null, responseXml })
      : null;
    // GK-P0 PROVIDER IDEMPOTENCY -- error 488 "Duplicate UUID used." means a listing for THIS publication identity
    // already exists at eBay (a lost response, a crash after the provider call, a retry). It is NOT proof by itself:
    // the ItemID is taken from the documented structured ErrorParameters, then the listing is read back and must
    // belong to the expected seller, carry this identity's SKU, and be Active. Only then is the ORIGINAL listing
    // reconciled and persisted. Anything else is preserved as AMBIGUOUS and no second publication is attempted.
    let recovered = null;
    const duplicateUuid = (!providerNetworkError && responseXml && !extractTag(responseXml, 'ItemID')) ? parseDuplicateUuidError(responseXml) : { isDuplicateUuid: false };
    if (duplicateUuid.isDuplicateUuid) {
      let verdict;
      if (!duplicateUuid.itemId) {
        verdict = { verified: false, reason: duplicateUuid.reason };
      } else {
        let readBack = null;
        try { readBack = await fetchListingIdentity(duplicateUuid.itemId, singleHeaders); }
        catch (e) { console.error('[ebay] duplicate-UUID read-back (GetItem) failed:', e?.message || e); }
        verdict = evaluateRecoveredListing({ expectedItemId: duplicateUuid.itemId, expectedSellerUserId: sellerAccount?.userId, expectedSku: listingPlan.correlation.sku, identity: readBack });
      }
      if (verdict.verified) {
        recovered = { itemId: duplicateUuid.itemId, reason: verdict.reason };
        console.warn(`[ebay] duplicate-UUID (488) RECOVERED: existing listing ${duplicateUuid.itemId} verified (${verdict.reason}) — no new listing created`);
      } else {
        console.error(`[ebay] duplicate-UUID (488) NOT verified (${verdict.reason}) — preserving AMBIGUOUS, refusing a blind second publication`);
        await recordAttempt('AMBIGUOUS', { detail: { reason: `duplicate-uuid-unverified:${verdict.reason}`, httpStatus: ebayRes ? ebayRes.status : undefined, errorCodes: ['488'] } });
        res.status(502).json({
          error: 'LISTING_OUTCOME_UNKNOWN',
          code: 'DUPLICATE_UUID_UNVERIFIED',
          message: 'eBay reports a listing already exists for this publication, but it could not be verified as yours. Nothing new was listed. Check Seller Hub for the label below before trying again.',
          reason: verdict.reason,
          correlation: { sku: listingPlan.correlation.sku },
          ...(manualAttempt ? { attemptId: manualAttempt.attemptId } : {}),
        });
        return;
      }
    }
    if (manualAttempt && !recovered && attemptClass.kind === 'AMBIGUOUS') {
      // The provider may or may not have created the listing. Record that explicitly; a retry is BLOCKED
      // by the ledger until the attempt is reconciled with the marketplace.
      console.error(`[ebay] AddFixedPriceItem outcome UNKNOWN (${attemptClass.reason}) — attempt ${manualAttempt.attemptId} marked AMBIGUOUS; retry blocked until reconciled`);
      await recordAttempt('AMBIGUOUS', { detail: { reason: attemptClass.reason, httpStatus: ebayRes ? ebayRes.status : undefined, errorCodes: attemptClass.errorCodes } });
      res.status(502).json({
        error: 'LISTING_OUTCOME_UNKNOWN',
        message: 'eBay did not give a definite answer. The listing may or may not exist — check eBay before trying again. A new attempt is blocked until this one is reconciled.',
        attemptId: manualAttempt.attemptId,
        // Recovery: look for this label in Seller Hub (Active, Scheduled, Sold, Unsold), then record an operator reconciliation.
        correlation: { sku: manualAttempt.providerCorrelation.sku },
      });
      return;
    }

    const ack = recovered ? "Success" : extractTag(responseXml, "Ack");
    const itemId = recovered ? recovered.itemId : extractTag(responseXml, "ItemID");
    const severity = recovered ? "Info" : extractTag(responseXml, "SeverityCode");

    // Success if eBay returned an ItemID, regardless of warnings.
    // Fail only when no ItemID came back (true Failure / PartialFailure with no item).
    if (!itemId) {
      if (manualAttempt) await recordAttempt('FAILED_DEFINITIVE', { detail: { reason: attemptClass.reason, httpStatus: ebayRes ? ebayRes.status : undefined, errorCodes: attemptClass.errorCodes } });
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
        ...(manualAttempt ? { attemptId: manualAttempt.attemptId } : {}),
        ...(process.env.NODE_ENV !== "production" ? { raw: responseXml } : {}),
      });
      return;
    }

    // GK-284 -- the provider returned a listing id: record the confirmed phase. A ledger fault here never
    // changes the real listing's response; the attempt then stays SUBMITTED, which BLOCKS a retry (safe).
    if (manualAttempt) await recordAttempt('LISTED_CONFIRMED', { externalListingId: itemId });

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
      ...(manualAttempt ? { authority: { type: manualAttempt.authorityType, attemptId: manualAttempt.attemptId, authorityEventId: manualAttempt.authorityEventId, engineRecommendation: manualAttempt.engineRecommendation, approvedAmount: manualAttempt.approvedAmount } } : {}),
      pictureCount: pictureUrls.length,
      ack: ack || "Success",
      ...(recovered ? { recovered: true, recoveredVia: 'duplicate-uuid-488', recoveryEvidence: recovered.reason } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
