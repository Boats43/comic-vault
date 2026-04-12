// POST /api/sold
//
// Fetches completed/sold listing data for a comic. Two strategies:
// 1. eBay Marketplace Insights API (real sold prices — requires approved scope)
// 2. eBay Browse API with filter for completed items (fallback)
//
// Results cached in-memory for 6 hours.

const OAUTH_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token";
const INSIGHTS_ENDPOINT =
  "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const CATEGORY_ID = "259104";
const INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

const CACHE = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

const tokenCache = {};

const getOAuthToken = async (appId, certId, scope) => {
  const now = Date.now();
  const cached = tokenCache[scope];
  if (cached && now < cached.expiresAt - 60_000) return cached.token;

  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const res = await fetch(OAUTH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope,
    }).toString(),
  });
  if (!res.ok) {
    console.error(`[sold] oauth HTTP ${res.status}`);
    return null;
  }
  const json = await res.json();
  if (!json.access_token) return null;
  const ttlMs = (json.expires_in || 7200) * 1000;
  tokenCache[scope] = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
};

export const fetchSold = async ({ title, issue, year }) => {
  const parts = [];
  if (title) parts.push(String(title).replace(/#\s*\d+/, "").trim());
  if (issue) parts.push(`#${issue}`);
  if (year) parts.push(String(year));
  const query = parts.filter(Boolean).join(" ");
  if (!query) return [];

  const cacheKey = `sold:${query.toLowerCase()}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId) {
    CACHE.set(cacheKey, { ts: Date.now(), data: [] });
    return [];
  }

  try {
    const token = await getOAuthToken(appId, certId, INSIGHTS_SCOPE);
    if (!token) {
      console.log("[sold] no token — insights scope not available");
      CACHE.set(cacheKey, { ts: Date.now(), data: [] });
      return [];
    }

    const url =
      `${INSIGHTS_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&category_ids=${CATEGORY_ID}&limit=5`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[sold] insights HTTP ${res.status}: ${body.slice(0, 200)}`);
      CACHE.set(cacheKey, { ts: Date.now(), data: [] });
      return [];
    }

    const json = await res.json();
    const itemSales = Array.isArray(json?.itemSales) ? json.itemSales : [];

    const items = itemSales
      .map((it) => {
        const price =
          it?.lastSoldPrice?.value != null
            ? parseFloat(it.lastSoldPrice.value)
            : NaN;
        if (isNaN(price) || price <= 0) return null;

        const soldDate = it?.lastSoldDate || null;
        let dateStr = null;
        let daysAgo = null;
        if (soldDate) {
          const d = new Date(soldDate);
          if (!isNaN(d.getTime())) {
            dateStr = d.toISOString().slice(0, 10);
            daysAgo = Math.max(
              0,
              Math.floor((Date.now() - d.getTime()) / 86400000)
            );
          }
        }

        return {
          price,
          priceFormatted: `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
          date: dateStr,
          daysAgo,
          title: it?.title || null,
          url: it?.itemWebUrl || null,
          type: "SOLD",
        };
      })
      .filter(Boolean)
      .slice(0, 5);

    console.log(`[sold] ${query}: ${items.length} sold items found`);
    CACHE.set(cacheKey, { ts: Date.now(), data: items });
    return items;
  } catch (err) {
    console.error(`[sold] error: ${err?.message || err}`);
    CACHE.set(cacheKey, { ts: Date.now(), data: [] });
    return [];
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { title, issue, year } = req.body || {};
  const issueNum =
    issue || (title && String(title).match(/#\s*(\d+)/)?.[1]) || null;
  const results = await fetchSold({ title, issue: issueNum, year });
  res.status(200).json(results);
}
