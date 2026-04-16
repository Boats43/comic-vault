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
  if (item.comicVine?.description) {
    // ComicVine descriptions are pre-sanitized HTML from their API.
    lines.push(`<div>${item.comicVine.description}</div>`);
  }
  if (Array.isArray(item.comicVine?.firstAppearanceCharacters) && item.comicVine.firstAppearanceCharacters.length > 0) {
    lines.push(
      `<p><strong>First appearance:</strong> ${xmlEscape(item.comicVine.firstAppearanceCharacters.join(", "))}</p>`
    );
  }
  lines.push("<p>Ships via USPS Media Mail. 30-day returns accepted.</p>");
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

const buildXml = (item, authToken, pictureUrl) => {
  const title = buildTitle(item);
  const description = buildDescription(item);
  const price = parsePriceNumber(item.price) ?? parsePriceNumber(item.priceHigh) ?? parsePriceNumber(item.priceLow);
  if (price == null || price <= 0) {
    throw new Error("No valid price on item — cannot list");
  }
  const conditionId = conditionIdFor(item.grade);
  const pictureBlock = pictureUrl
    ? `    <PictureDetails>
      <PictureURL>${xmlEscape(pictureUrl)}</PictureURL>
    </PictureDetails>
`
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
        <ShippingServiceCost>4.99</ShippingServiceCost>
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

    // Step 1: upload the cover image (if provided) to eBay's picture service.
    const coverImage = item.images?.[0] || item.image || null;
    let pictureUrl = null;
    if (coverImage) {
      try {
        pictureUrl = await uploadSiteHostedPicture(coverImage, EBAY_AUTH_TOKEN, ebayHeaders);
      } catch (imgErr) {
        // Don't hard-fail the whole listing on image upload issues — log and continue without.
        console.error("Picture upload failed:", imgErr.message);
      }
    }

    // Step 2: create the listing, including the hosted picture URL if we have one.
    const xml = buildXml(item, EBAY_AUTH_TOKEN, pictureUrl);
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
      pictureUrl,
      ack: ack || "Success",
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
