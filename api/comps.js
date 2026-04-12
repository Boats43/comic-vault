// POST /api/comps
//
// Fetches comp data from eBay via (1) Marketplace Insights API when the
// app is approved for the limited-release scope, or (2) Browse API as a
// fallback using the standard api_scope that every production app has.
//
// Env vars:
//   EBAY_APP_ID  — OAuth client id
//   EBAY_CERT_ID — OAuth client secret
//
// All failures fall through silently (empty comps) so the UI can show
// its AI-estimate fallback instead of erroring out the grade flow.

const OAUTH_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token";
const INSIGHTS_ENDPOINT =
  "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const BROWSE_ENDPOINT =
  "https://api.ebay.com/buy/browse/v1/item_summary/search";
const CATEGORY_ID = "259104"; // Comics > Comic Books > Single Issues
const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

// Log presence + first 20 chars of credentials once per cold start so we
// can confirm both env vars are actually loaded in this function.
const _appIdPreview = process.env.EBAY_APP_ID
  ? `${process.env.EBAY_APP_ID.slice(0, 20)}… (len=${process.env.EBAY_APP_ID.length})`
  : "MISSING";
const _certIdPreview = process.env.EBAY_CERT_ID
  ? `${process.env.EBAY_CERT_ID.slice(0, 20)}… (len=${process.env.EBAY_CERT_ID.length})`
  : "MISSING";
console.log(`[comps] env EBAY_APP_ID=${_appIdPreview}`);
console.log(`[comps] env EBAY_CERT_ID=${_certIdPreview}`);

const formatUsd = (n) =>
  n == null || isNaN(n)
    ? null
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
};

const emptyComps = (query, reason) => ({
  count: 0,
  prices: [],
  recentSales: [],
  average: null,
  lowest: null,
  highest: null,
  lastSoldDate: null,
  query: query || null,
  fellBack: false,
  reason: reason || null,
  source: null,
});

// Module-scope OAuth token cache, keyed by scope. Tokens are valid ~2h;
// we refresh when the cache is within 60s of expiry.
const tokenCache = {};

const getOAuthToken = async (appId, certId, scope) => {
  const now = Date.now();
  const cached = tokenCache[scope];
  if (cached && now < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope,
  }).toString();

  const res = await fetch(OAUTH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  console.log(`[comps] oauth status=${res.status}`);
  if (!res.ok) {
    console.error(`[comps] oauth failed body=${text}`);
    throw new Error(`eBay OAuth HTTP ${res.status}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("eBay OAuth returned non-JSON");
  }
  if (!json.access_token) throw new Error("eBay OAuth missing access_token");

  const ttlMs = (json.expires_in || 7200) * 1000;
  tokenCache[scope] = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
};

// Try the Marketplace Insights API (true sold data). Returns parsed results
// array on success, or null on any failure so the caller can fall back.
const tryInsights = async ({ appId, certId, query }) => {
  try {
    const token = await getOAuthToken(appId, certId, INSIGHTS_SCOPE);
    const url =
      `${INSIGHTS_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&category_ids=${CATEGORY_ID}&limit=20`;
    console.log(`[comps] insights url=${url}`);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        Accept: "application/json",
      },
    });
    console.log(`[comps] insights http status=${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      console.error(`[comps] insights non-OK body:\n${body}`);
      return null;
    }
    const json = await res.json();
    const itemSales = Array.isArray(json?.itemSales) ? json.itemSales : [];
    console.log(`[comps] insights itemSales=${itemSales.length}`);
    if (itemSales.length === 0) return null;
    return itemSales
      .map((it) => {
        const price = it?.lastSoldPrice?.value != null ? parseFloat(it.lastSoldPrice.value) : NaN;
        if (isNaN(price) || price <= 0) return null;
        return {
          price,
          endTime: it?.lastSoldDate || null,
          title: it?.title || null,
          url: it?.itemWebUrl || null,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error(`[comps] insights error: ${err?.message || err}`);
    return null;
  }
};

// Fall back to the Browse API (active listings, not true sold data).
// Uses the standard api_scope which every production app has. Returns
// parsed results or null on failure.
const tryBrowse = async ({ appId, certId, query }) => {
  try {
    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    const url =
      `${BROWSE_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&category_ids=${CATEGORY_ID}` +
      `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}` +
      `&limit=20&sort=endingSoonest`;
    console.log(`[comps] browse url=${url}`);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        Accept: "application/json",
      },
    });
    console.log(`[comps] browse http status=${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      console.error(`[comps] browse non-OK body:\n${body}`);
      return null;
    }
    const json = await res.json();
    const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
    console.log(`[comps] browse itemSummaries=${items.length}`);
    if (items.length === 0) return null;
    return items
      .map((it) => {
        const price = it?.price?.value != null ? parseFloat(it.price.value) : NaN;
        if (isNaN(price) || price <= 0) return null;
        return {
          price,
          endTime: it?.itemEndDate || null,
          title: it?.title || null,
          url: it?.itemWebUrl || null,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error(`[comps] browse error: ${err?.message || err}`);
    return null;
  }
};

// Reprints, facsimiles, and anniversary variants pollute Browse API results
// for any high-demand key (e.g. ASM #300 constantly surfaces "True Believers"
// reprints). Drop these regardless of graded/raw.
const REPRINT_RE = /true believers|reprint|facsimile|replica|anniversary edition/i;

// For raw (ungraded) searches, exclude any listing that mentions a grading
// slab or a common graded tier in the title.
const SLAB_RE = /\bCGC\b|\bCBCS\b|\bPGX\b|graded|slab|\b9\.8\b|\b9\.6\b|\b9\.4\b/i;

// For graded searches, require the title to mention CGC or CBCS.
const GRADED_RE = /\bCGC\b|\bCBCS\b/i;

// Remove price outliers: anything above 3x median or below 25% of median.
// Kills signed/variant copies from contaminating the average on searches
// that otherwise look clean. Requires at least 3 items to be meaningful.
const applyPriceSanity = (items) => {
  if (!Array.isArray(items) || items.length < 3) return items;
  const sorted = items.map((p) => p.price).slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (!median || median <= 0) return items;
  const lo = median * 0.25;
  const hi = median * 3;
  return items.filter((p) => p.price >= lo && p.price <= hi);
};

// Extract issue number from a title like "Comic Reader #171" → "171".
const extractIssueNumber = (title) => {
  const m = String(title || "").match(/#\s*(\d+)/);
  return m ? m[1] : null;
};

// Tokenize a title into lowercase words of 4+ characters, dropping the
// issue-number hash fragment since issue# is matched separately.
const tokenizeTitle = (title) =>
  String(title || "")
    .toLowerCase()
    .replace(/#\s*\d+/g, "")
    .match(/[a-z]{4,}/g) || [];

// Require at least 2 of the search tokens to appear in the listing title
// (case-insensitive substring). Falls back to "all tokens must match"
// when the search title has fewer than 2 scorable tokens.
const hasSufficientTitleOverlap = (listingTitle, searchTokens) => {
  if (!searchTokens || searchTokens.length === 0) return true;
  const listing = String(listingTitle || "").toLowerCase();
  const threshold = Math.min(2, searchTokens.length);
  let hits = 0;
  for (const t of searchTokens) {
    if (listing.includes(t)) {
      hits++;
      if (hits >= threshold) return true;
    }
  }
  return false;
};

// Listing must contain the issue number as "#N" or as a standalone N
// (word-bounded so "1710" and "2171" don't match "171").
const hasIssueNumber = (listingTitle, issueNum) => {
  if (!issueNum) return true;
  const escaped = String(issueNum).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`#\\s*${escaped}\\b|\\b${escaped}\\b`, "i").test(
    String(listingTitle || "")
  );
};

// Clean a comic title for eBay search: strip articles and special chars.
const cleanTitleForSearch = (title) => {
  if (!title) return "";
  let t = String(title).trim();
  t = t.replace(/^(The|A|An)\s+/i, "");
  t = t
    .replace(/:/g, "")
    .replace(/['"!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t;
};

// Extract the first "significant" word from a cleaned title — skips
// one-letter words and common prefixes so "Amazing Adventures" → "Adventures".
const firstSignificantWord = (cleanTitle) => {
  const words = cleanTitle.split(/\s+/);
  for (const w of words) {
    if (w.length >= 4) return w;
  }
  return words[words.length - 1] || "";
};

const buildKeywords = (title, { issue, isGraded, numericGrade, year } = {}) => {
  if (!title) return "";
  const cleanTitle = cleanTitleForSearch(title);
  const parts = [cleanTitle];
  if (issue) {
    const iss = String(issue).trim();
    if (iss) parts.push(`#${iss}`);
  }
  if (isGraded === true && numericGrade != null && !isNaN(numericGrade)) {
    parts.push("CGC", String(numericGrade));
  }
  if (year) {
    const y = String(year).trim();
    if (y) parts.push(y);
  }
  return parts.filter(Boolean).join(" ").trim();
};

// Core fetcher — exported so api/grade.js can reuse it without an HTTP hop.
// Always resolves (never throws): failures return an empty comps object so
// the grade flow can fall through to the AI estimate path.
export const fetchComps = async ({
  title,
  issue,
  grade,
  isGraded,
  numericGrade,
  year,
  appId,
  certId,
}) => {
  if (!appId || !certId) {
    return emptyComps(null, "missing eBay credentials");
  }
  if (!title) {
    return emptyComps(null, "title required");
  }

  // Prefer explicit numericGrade, fall back to parsing the legacy `grade` field.
  const numericTarget =
    numericGrade != null && !isNaN(Number(numericGrade))
      ? Number(numericGrade)
      : grade != null && !isNaN(parseFloat(grade))
      ? parseFloat(grade)
      : null;
  const rawOnly = isGraded === false;
  const gradedOnly = isGraded === true;

  // Precompute relevance helpers once per request.
  const searchTokens = tokenizeTitle(title);
  // Issue number: prefer explicit `issue` param, fall back to extracting from title.
  const issueNum = issue ? String(issue).trim() : extractIssueNumber(title);

  const cleanTitle = cleanTitleForSearch(title);
  const iss = issue ? String(issue).trim() : null;
  const yr = year ? String(year).trim() : null;

  // Grade suffix appended to every attempt query.
  const gradeSuffix =
    isGraded === true && numericTarget != null && !isNaN(numericTarget)
      ? ` CGC ${numericTarget}`
      : "";

  // Build ordered list of query attempts — most specific to least.
  const attempts = [];
  // Attempt 1: full — cleanTitle #issue year
  if (iss && yr) {
    attempts.push({ q: `${cleanTitle} #${iss} ${yr}`, n: 1 });
  }
  // Attempt 2: no year — cleanTitle #issue
  if (iss) {
    attempts.push({ q: `${cleanTitle} #${iss}`, n: 2 });
  }
  // Attempt 3: no issue — cleanTitle year
  if (yr) {
    attempts.push({ q: `${cleanTitle} ${yr}`, n: 3 });
  }
  // Attempt 4: title only — cleanTitle
  attempts.push({ q: cleanTitle, n: 4 });
  // Attempt 5: first significant word + issue
  if (iss) {
    const sig = firstSignificantWord(cleanTitle);
    if (sig) {
      attempts.push({ q: `${sig} #${iss}`, n: 5 });
    }
  }

  // Deduplicate (e.g. if no year was provided, attempts 1 & 2 are identical).
  const seen = new Set();
  const uniqueAttempts = attempts.filter(({ q }) => {
    const key = q.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  try {
    let query = "";
    let source = "";
    let raw = null;
    let attemptUsed = 0;

    for (const attempt of uniqueAttempts) {
      query = attempt.q + gradeSuffix;
      // Try Insights first, then Browse.
      source = "marketplace_insights";
      raw = await tryInsights({ appId, certId, query });
      if (!raw || raw.length === 0) {
        source = "browse_api";
        raw = await tryBrowse({ appId, certId, query });
      }
      const count = raw ? raw.length : 0;
      console.log(`[comps] attempt ${attempt.n} query="${query}" results=${count}`);
      if (count > 0) {
        attemptUsed = attempt.n;
        break;
      }
    }

    if (!raw || raw.length === 0) {
      return { ...emptyComps(query, "no sales"), attemptUsed: 0 };
    }

    let parsed = raw.sort(
      (a, b) => new Date(b.endTime || 0) - new Date(a.endTime || 0)
    );

    // Filter 0a: issue-number enforcement. If we know the issue number,
    // any listing not containing it is a false positive (wrong book).
    if (issueNum) {
      const before = parsed.length;
      parsed = parsed.filter((it) => hasIssueNumber(it.title, issueNum));
      if (parsed.length < before) {
        console.log(
          `[comps] issue# filter removed ${before - parsed.length}`
        );
      }
    }

    // Filter 0b: title similarity. Require at least 2 of the search title's
    // 4+ character tokens to appear in the listing title. Kills "Avengers
    // #171" matches when you were searching "Comic Reader #171".
    if (searchTokens.length > 0) {
      const before = parsed.length;
      parsed = parsed.filter((it) =>
        hasSufficientTitleOverlap(it.title, searchTokens)
      );
      if (parsed.length < before) {
        console.log(
          `[comps] title similarity filter removed ${before - parsed.length}`
        );
      }
    }

    // Filter 1: reprints / facsimiles / anniversary variants.
    {
      const before = parsed.length;
      parsed = parsed.filter((it) => !REPRINT_RE.test(String(it.title || "")));
      if (parsed.length < before) {
        console.log(
          `[comps] reprint filter removed ${before - parsed.length}`
        );
      }
    }

    // Filter 2: raw-vs-graded title separation.
    if (rawOnly) {
      const before = parsed.length;
      parsed = parsed.filter((it) => !SLAB_RE.test(String(it.title || "")));
      if (parsed.length < before) {
        console.log(`[comps] slab filter removed ${before - parsed.length}`);
      }
    } else if (gradedOnly) {
      const before = parsed.length;
      parsed = parsed.filter((it) => GRADED_RE.test(String(it.title || "")));
      if (parsed.length < before) {
        console.log(
          `[comps] non-graded filter removed ${before - parsed.length}`
        );
      }
    }

    // Filter 3: ±1.0 grade proximity for graded searches (or any caller that
    // passed a legacy `grade` without isGraded=false).
    let fellBack = false;
    if (
      parsed.length > 0 &&
      !rawOnly &&
      numericTarget != null &&
      !isNaN(numericTarget)
    ) {
      const filtered = parsed.filter((it) => {
        const m = String(it.title || "").match(/CGC\s*([\d.]+)/i);
        if (!m) return true;
        const g = parseFloat(m[1]);
        if (isNaN(g)) return true;
        return Math.abs(g - numericTarget) <= 1.0;
      });
      if (filtered.length > 0) {
        parsed = filtered;
      } else {
        fellBack = true;
      }
    }

    // Filter 4: median-based price sanity. Drop anything > 3x median or
    // < 25% of median to kill signed/variant outliers (e.g. Stan Lee
    // signed copies skewing a raw ASM #300 search).
    {
      const before = parsed.length;
      parsed = applyPriceSanity(parsed);
      if (parsed.length < before) {
        console.log(
          `[comps] price sanity removed ${before - parsed.length}`
        );
      }
    }

    if (parsed.length === 0) {
      return { ...emptyComps(query, "filtered empty"), attemptUsed };
    }

    const priceNums = parsed.map((p) => p.price);
    const sum = priceNums.reduce((a, b) => a + b, 0);
    const average = sum / priceNums.length;
    const lowest = Math.min(...priceNums);
    const highest = Math.max(...priceNums);
    const lastSoldDate = parsed[0].endTime;

    const now = Date.now();
    const recentSales = parsed.slice(0, 5).map((p) => {
      const t = p.endTime ? new Date(p.endTime).getTime() : NaN;
      const daysAgo = isNaN(t) ? null : Math.max(0, Math.round((now - t) / 86400000));
      return {
        price: p.price,
        priceFormatted: formatUsd(p.price),
        date: p.endTime,
        daysAgo,
        itemWebUrl: p.url || null,
      };
    });

    return {
      count: parsed.length,
      prices: parsed,
      recentSales,
      average,
      averageFormatted: formatUsd(average),
      lowest,
      lowestFormatted: formatUsd(lowest),
      highest,
      highestFormatted: formatUsd(highest),
      lastSoldDate,
      lastSoldDateFormatted: formatDate(lastSoldDate),
      query,
      fellBack,
      attemptUsed,
      source,
    };
  } catch (err) {
    console.error(`[comps] error: ${err?.message || err}`);
    return { ...emptyComps(query || cleanTitle, err?.message || "fetch failed"), attemptUsed: 0 };
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { EBAY_APP_ID, EBAY_CERT_ID } = process.env;

  try {
    const { title, issue, grade, isGraded, numericGrade, year } = req.body || {};
    if (!title) {
      res.status(400).json({ error: "title required" });
      return;
    }
    const comps = await fetchComps({
      title,
      issue,
      grade,
      isGraded,
      numericGrade,
      year,
      appId: EBAY_APP_ID,
      certId: EBAY_CERT_ID,
    });
    res.status(200).json(comps);
  } catch (err) {
    // fetchComps shouldn't throw, but guard anyway.
    res.status(200).json({
      count: 0,
      prices: [],
      recentSales: [],
      reason: err?.message || "Server error",
    });
  }
}
