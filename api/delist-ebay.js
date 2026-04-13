// POST /api/delist-ebay
//
// Ends an eBay listing via the Trading API (EndItem).
// Requires the same env vars as list-ebay.js.

const EBAY_ENDPOINT = "https://api.ebay.com/ws/api.dll";
const COMPAT_LEVEL = "1193";
const SITE_ID = "0";

const extractTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  return m ? m[1] : null;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { ebayItemId } = req.body || {};
  if (!ebayItemId) {
    res.status(400).json({ error: "ebayItemId required" });
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
      res.status(200).json({ success: true });
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
