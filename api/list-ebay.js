// POST /api/list-ebay
//
// Creates a real eBay fixed-price listing via the Trading API (AddFixedPriceItem).
// Requires these env vars on Vercel:
//   EBAY_APP_ID     — your Trading API App ID (client id)
//   EBAY_CERT_ID    — your Trading API Cert ID (client secret)
//   EBAY_DEV_ID     — your Trading API Dev ID
//   EBAY_AUTH_TOKEN — user auth token ("Auth'n'Auth" / eBayAuthToken) for the seller account
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

const parsePriceNumber = (p) => {
  if (p == null) return null;
  const m = String(p).replace(/,/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

// Map CGC grade → eBay ConditionID.
// eBay Comics condition IDs: 2750 = Graded, 4000 = Very Good, 5000 = Good, etc.
// Safest for a graded book is 2750 (Graded). Raw/ungraded → 4000.
const conditionIdFor = (grade) => (grade ? "2750" : "4000");

// Match the frontend showKeyIssue() check.
const showKeyIssue = (k) => {
  if (!k) return false;
  const s = k.toLowerCase().trim();
  if (["no", "n/a", "none", "false", "not a key",
    "non-key", "non key", "not key"]
    .some((x) => s.includes(x))) return false;
  return s.length > 2;
};

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

const buildTitle = (item) => {
  // T1-2: Use Claude's suggested title if HIGH confidence
  if (item.claudeCheck?.confidence === 'HIGH' &&
      item.claudeCheck?.suggestedListingTitle) {
    return item.claudeCheck.suggestedListingTitle.substring(0, 80);
  }

  // Fallback to existing logic
  const gradeStr =
    item.isGraded === true && item.numericGrade != null
      ? `CGC ${item.numericGrade}`
      : item.grade || "";
  const parts = [
    item.title,
    item.issue ? `#${item.issue}` : null,
    variantForTitle(item.variant),
    gradeStr,
    item.publisher,
    item.year,
    showKeyIssue(item.keyIssue) ? "KEY" : null,
  ].filter(Boolean);
  const joined = parts.join(" ").trim();
  // eBay title hard limit: 80 chars.
  return joined.length > 80 ? joined.slice(0, 80) : joined || "Comic Book";
};

const eraFromYear = (y) => {
  const n = parseInt(y, 10);
  if (!n || isNaN(n)) return "";
  if (n < 1956) return "Golden Age";
  if (n <= 1970) return "Silver Age";
  if (n <= 1984) return "Bronze Age";
  if (n <= 1991) return "Copper Age";
  return "Modern Age";
};

// T1-1: Era for Item Specifics (eBay-friendly labels)
const getEra = (y) => {
  const n = parseInt(y, 10);
  if (!n || isNaN(n)) return "Modern Age";
  if (n < 1938) return "Victorian/Platinum Age";
  if (n < 1956) return "Golden Age";
  if (n < 1970) return "Silver Age";
  if (n < 1985) return "Bronze Age";
  if (n < 1991) return "Copper Age";
  if (n < 2000) return "Modern Age (1991-1999)";
  return "Modern Age";
};

// T1-1: Extract character for Item Specifics
const extractCharacter = (item) => {
  return (
    item.firstAppearanceCharacters?.[0] ||
    item.comicVine?.characterCredits?.[0]?.name ||
    null
  );
};

const buildBundleTitle = (items) => {
  const issues = items
    .map((it) => it.issue)
    .filter(Boolean)
    .map((v) => `#${v}`);
  const titles = [...new Set(items.map((it) => it.title).filter(Boolean))];
  const series = titles.length === 1 ? titles[0] : "Comic";
  const variants = [...new Set(items.map((it) => variantForTitle(it.variant)).filter(Boolean))];
  const variantStr = variants.length === 1 ? variants[0] : "";
  const years = items.map((it) => parseInt(it.year, 10)).filter((n) => n && !isNaN(n));
  const minYear = years.length ? Math.min(...years) : null;
  const publishers = [...new Set(items.map((it) => it.publisher).filter(Boolean))];
  const pub = publishers.length === 1 ? publishers[0] : "";
  const era = minYear ? eraFromYear(minYear) : "";
  const parts = [
    series,
    issues.join(" "),
    variantStr,
    "Lot",
    minYear || "",
    pub,
    era,
  ].filter(Boolean);
  const joined = parts.join(" ").trim();
  return joined.length > 80 ? joined.slice(0, 80).trim() : joined || "Comic Book Lot";
};

const buildBundleDescription = (items) => {
  const lines = [];
  const titles = [...new Set(items.map((it) => it.title).filter(Boolean))];
  const header =
    titles.length === 1
      ? `${titles[0]} — ${items.length}-Book Lot`
      : `${items.length}-Book Comic Lot`;
  lines.push(`<h2>${xmlEscape(header)}</h2>`);
  lines.push(`<p><strong>Contents (${items.length} books):</strong></p>`);
  lines.push("<ul>");
  for (const it of items) {
    const gradeStr =
      it.isGraded === true && it.numericGrade != null
        ? `CGC ${it.numericGrade}`
        : it.grade || "Raw";
    const issuePart = it.issue ? ` #${it.issue}` : "";
    const yearPart = it.year ? ` (${it.year})` : "";
    const keyPart = showKeyIssue(it.keyIssue) ? ` — KEY: ${xmlEscape(it.keyIssue)}` : "";
    const notePart = it.reason ? ` — ${xmlEscape(String(it.reason).slice(0, 160))}` : "";
    lines.push(
      `<li><strong>${xmlEscape(it.title || "Comic")}${issuePart}</strong>${yearPart} — ${xmlEscape(gradeStr)}${keyPart}${notePart}</li>`
    );
  }
  lines.push("</ul>");
  lines.push("<p>Bundle priced at 18% off combined market value.</p>");
  lines.push("<p>Ships via USPS Media Mail. 30-day returns accepted.</p>");
  return lines.join("\n");
};

const buildBundleXml = (items, authToken, pictureUrls) => {
  const title = buildBundleTitle(items);
  const description = buildBundleDescription(items);
  const sum = items.reduce((acc, it) => {
    const p = parsePriceNumber(it.price) ?? parsePriceNumber(it.priceHigh) ?? parsePriceNumber(it.priceLow) ?? 0;
    return acc + p;
  }, 0);
  const price = Math.round(sum * 0.82 * 100) / 100;
  if (price <= 0) throw new Error("No valid bundle price — cannot list");
  const conditionId = items.every((it) => it.isGraded === true) ? "2750" : "4000";
  const pictureBlock = (pictureUrls && pictureUrls.length)
    ? `    <PictureDetails>\n${pictureUrls
        .map((u) => `      <PictureURL>${xmlEscape(u)}</PictureURL>`)
        .join("\n")}\n    </PictureDetails>\n`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${xmlEscape(authToken)}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${xmlEscape(title)}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${CATEGORY_ID}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="USD">${price.toFixed(2)}</StartPrice>
    <ConditionID>${conditionId}</ConditionID>
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

const buildDescription = (item) => {
  const lines = [];

  // T3-3: Flags disclosure (if any)
  if (item.claudeCheck?.flags && item.claudeCheck.flags.length > 0) {
    lines.push("<p><strong>NOTES</strong></p>");
    item.claudeCheck.flags.forEach(flag => {
      lines.push(`<p>• ${xmlEscape(flag)}</p>`);
    });
    lines.push("<br>");
  }

  if (item.title) lines.push(`<h2>${xmlEscape(item.title)}</h2>`);
  const meta = [item.publisher, item.year].filter(Boolean).join(" · ");
  if (meta) lines.push(`<p><strong>${xmlEscape(meta)}</strong></p>`);

  if (item.grade) {
    const gradeLabel =
      item.isGraded === true && item.numericGrade != null
        ? `CGC ${xmlEscape(item.grade)}`
        : xmlEscape(item.grade);
    lines.push(`<p>Grade: <strong>${gradeLabel}</strong></p>`);
  }

  if (item.keyIssue) lines.push(`<p>Key Issue: ${xmlEscape(item.keyIssue)}</p>`);
  if (item.reason) lines.push(`<p>${xmlEscape(item.reason)}</p>`);

  // T2-2: Story (expanded from 500 to 1000 chars)
  if (item.comicVine?.description) {
    const storyText = String(item.comicVine.description).substring(0, 1000);
    lines.push(`<p><strong>STORY</strong></p>`);
    lines.push(`<div>${storyText}</div>`);
  }

  // T2-2: Creators section
  if (item.comicVine?.personCredits && item.comicVine.personCredits.length > 0) {
    const creatorList = item.comicVine.personCredits
      .map(p => `${xmlEscape(p.name)}${p.role ? ` (${xmlEscape(p.role)})` : ''}`)
      .join(', ');
    lines.push(`<p><strong>CREATORS</strong></p>`);
    lines.push(`<p>${creatorList}</p>`);
  }

  // T2-2: Characters section
  if (item.comicVine?.characterCredits && item.comicVine.characterCredits.length > 0) {
    const characterList = item.comicVine.characterCredits
      .slice(0, 5)
      .map(c => xmlEscape(c.name))
      .join(', ');
    lines.push(`<p><strong>CHARACTERS</strong></p>`);
    lines.push(`<p>${characterList}</p>`);
  }

  // Legacy first appearance field (keep if no characterCredits)
  if (Array.isArray(item.comicVine?.firstAppearanceCharacters) &&
      item.comicVine.firstAppearanceCharacters.length > 0 &&
      (!item.comicVine?.characterCredits || item.comicVine.characterCredits.length === 0)) {
    lines.push(
      `<p><strong>First appearance:</strong> ${xmlEscape(item.comicVine.firstAppearanceCharacters.join(", "))}</p>`
    );
  }

  // T1-3: Market proof section
  if (item.priceBands) {
    lines.push(`<p><strong>MARKET DATA</strong></p>`);
    const pb = item.priceBands;
    if (pb.quick && pb.stretch && pb.market) {
      lines.push(
        `<p>Recent verified sales: $${pb.quick.toFixed(2)}–$${pb.stretch.toFixed(2)} ` +
        `(${pb.count || 0} comps)</p>`
      );
      lines.push(
        `<p>Market value: $${pb.market.toFixed(2)} ` +
        `(${xmlEscape(pb.source || 'estimated')})</p>`
      );
    }
    if (item.pop?.total > 0) {
      lines.push(`<p>CGC census: ${item.pop.total} copies graded</p>`);
    }
  }

  // T2-2: Demand section
  if (item.demandSignals) {
    const ds = item.demandSignals;
    const demandEmoji = ds.demandLevel === 'HIGH' ? '🔥' : ds.demandLevel === 'LOW' ? '📉' : '➡️';
    const trendIcon = ds.trend === 'RISING' ? '↑' : ds.trend === 'DECLINING' ? '↓' : '→';
    lines.push(`<p><strong>DEMAND</strong></p>`);
    lines.push(
      `<p>${demandEmoji} ${xmlEscape(ds.demandLevel || 'NORMAL')} demand · ` +
      `${trendIcon} ${xmlEscape(ds.trend || 'FLAT')} price trend · ` +
      `${xmlEscape(ds.liquidity || 'NORMAL')} mover</p>`
    );
  }

  // T1-4: Enhanced pack details footer
  lines.push("<p><strong>SHIPPING</strong></p>");
  lines.push(
    "<p>Packed in Gemini mailer with cardboard backing and top loader for protection. " +
    "Ships within 3 business days via USPS Media Mail. Combined shipping available.</p>"
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
// Returns the hosted FullURL or throws.
const uploadSiteHostedPicture = async (base64Image, authToken, headers) => {
  const { bytes, mimeType } = decodeDataUrl(base64Image);
  if (!bytes || bytes.length === 0) throw new Error("Empty image payload");

  const uploadXml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${xmlEscape(authToken)}</eBayAuthToken>
  </RequesterCredentials>
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

const buildXml = (item, authToken, pictureUrls) => {
  const title = buildTitle(item);
  const description = buildDescription(item);
  const price = parsePriceNumber(item.price) ?? parsePriceNumber(item.priceHigh) ?? parsePriceNumber(item.priceLow);
  if (price == null || price <= 0) {
    throw new Error("No valid price on item — cannot list");
  }
  const conditionId = conditionIdFor(item.grade);

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

  // T1-1: Item Specifics
  const character = extractCharacter(item);
  const itemSpecifics = `    <ItemSpecifics>
      <NameValueList>
        <Name>Publisher</Name>
        <Value>${xmlEscape(item.publisher || 'Unknown')}</Value>
      </NameValueList>
      <NameValueList>
        <Name>Series Title</Name>
        <Value>${xmlEscape(item.title || 'Unknown')}</Value>
      </NameValueList>
${item.issue ? `      <NameValueList>
        <Name>Issue Number</Name>
        <Value>${xmlEscape(item.issue)}</Value>
      </NameValueList>
` : ''}      <NameValueList>
        <Name>Era</Name>
        <Value>${xmlEscape(getEra(item.year))}</Value>
      </NameValueList>
      <NameValueList>
        <Name>Grade Certification</Name>
        <Value>${xmlEscape(item.slabNumber ? (item.slabCompany || 'CGC') : 'Raw/Ungraded')}</Value>
      </NameValueList>
${item.numericGrade ? `      <NameValueList>
        <Name>Numeric Grade</Name>
        <Value>${xmlEscape(item.numericGrade)}</Value>
      </NameValueList>
` : ''}      <NameValueList>
        <Name>Format</Name>
        <Value>${xmlEscape(item.isTPB ? 'Trade Paperback' : item.isMagazine ? 'Magazine' : 'Single Issue')}</Value>
      </NameValueList>
      <NameValueList>
        <Name>Language</Name>
        <Value>English</Value>
      </NameValueList>
${character ? `      <NameValueList>
        <Name>Character</Name>
        <Value>${xmlEscape(character)}</Value>
      </NameValueList>
` : ''}${item.variant ? `      <NameValueList>
        <Name>Variant</Name>
        <Value>${xmlEscape(item.variant)}</Value>
      </NameValueList>
` : ''}    </ItemSpecifics>
`;

  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${xmlEscape(authToken)}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${xmlEscape(title)}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="USD">${price.toFixed(2)}</StartPrice>
    <ConditionID>${conditionId}</ConditionID>
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
${itemSpecifics}    <BestOfferDetails>
      <BestOfferEnabled>true</BestOfferEnabled>
    </BestOfferDetails>
    <ListingDetails>
      <BestOfferAutoAcceptPrice>${autoAcceptPrice}</BestOfferAutoAcceptPrice>
      <MinimumBestOfferPrice>${minBestOfferPrice}</MinimumBestOfferPrice>
    </ListingDetails>
  </Item>
</AddFixedPriceItemRequest>`;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID, EBAY_AUTH_TOKEN } = process.env;
  if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_DEV_ID || !EBAY_AUTH_TOKEN) {
    res.status(500).json({
      error:
        "Missing eBay credentials. Set EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID, EBAY_AUTH_TOKEN in Vercel env.",
    });
    return;
  }

  try {
    const item = req.body || {};

    const ebayHeaders = {
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-DEV-NAME": EBAY_DEV_ID,
      "X-EBAY-API-APP-NAME": EBAY_APP_ID,
      "X-EBAY-API-CERT-NAME": EBAY_CERT_ID,
      "X-EBAY-API-SITEID": SITE_ID,
    };

    // Bundle branch: combined lot listing for multiple comics.
    if (item.bundle === true) {
      const items = Array.isArray(item.items) ? item.items : [];
      if (items.length < 2) {
        res.status(400).json({ error: "Bundle requires at least 2 items" });
        return;
      }
      const bundleImages = items
        .map((it) => (Array.isArray(it.images) && it.images[0]) || it.image || null)
        .filter(Boolean)
        .slice(0, 12);
      const pictureUrls = [];
      for (const img of bundleImages) {
        try {
          const url = await uploadSiteHostedPicture(img, EBAY_AUTH_TOKEN, ebayHeaders);
          if (url) pictureUrls.push(url);
        } catch (imgErr) {
          console.error("[ebay] bundle picture upload failed:", imgErr.message);
        }
      }
      const xml = buildBundleXml(items, EBAY_AUTH_TOKEN, pictureUrls);
      console.log("[ebay] AddFixedPriceItem (bundle) request XML:\n" + redactToken(xml));
      const ebayRes = await fetch(EBAY_ENDPOINT, {
        method: "POST",
        headers: {
          ...ebayHeaders,
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

    // T2-1: Multi-image upload for singles (up to 12 images)
    // Gate: only upload all images when confidence is not LOW
    const shouldUploadMultiple =
      item.matchConfidence?.tier !== 'LOW' &&
      item.claudeCheck?.confidence !== 'LOW';

    const imagesToUpload = shouldUploadMultiple
      ? (item.images || []).filter(Boolean).slice(0, 12)
      : [(item.images?.[0] || item.image || null)].filter(Boolean);

    const pictureUrls = [];
    for (const img of imagesToUpload) {
      try {
        const url = await uploadSiteHostedPicture(img, EBAY_AUTH_TOKEN, ebayHeaders);
        if (url) pictureUrls.push(url);
      } catch (imgErr) {
        // Don't hard-fail the whole listing on image upload issues — log and continue without.
        console.error("Picture upload failed:", imgErr.message);
      }
    }

    // Step 2: create the listing, including the hosted picture URLs.
    const xml = buildXml(item, EBAY_AUTH_TOKEN, pictureUrls);
    console.log("[ebay] AddFixedPriceItem request XML:\n" + redactToken(xml));

    const ebayRes = await fetch(EBAY_ENDPOINT, {
      method: "POST",
      headers: {
        ...ebayHeaders,
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

    res.status(200).json({
      ok: true,
      listingId: itemId,
      listingUrl: `https://www.ebay.com/itm/${itemId}`,
      pictureCount: pictureUrls.length,
      ack: ack || "Success",
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
