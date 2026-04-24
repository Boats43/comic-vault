// POST /api/comps
//
// Fetches comp data from eBay via (1) Finding API findCompletedItems
// (real sold data, no OAuth needed), or (2) Browse API as a fallback
// using the standard api_scope that every production app has.
//
// Env vars:
//   EBAY_APP_ID  — OAuth client id (also used as SECURITY-APPNAME)
//   EBAY_CERT_ID — OAuth client secret (Browse fallback only)
//
// All failures fall through silently (empty comps) so the UI can show
// its AI-estimate fallback instead of erroring out the grade flow.

const FINDING_ENDPOINT =
  "https://svcs.ebay.com/services/search/FindingService/v1";
const OAUTH_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_ENDPOINT =
  "https://api.ebay.com/buy/browse/v1/item_summary/search";
const CATEGORY_ID = "259104"; // Comics > Comic Books > Single Issues
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

export const getOAuthToken = async (appId, certId, scope) => {
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
  console.log(`[comps][diag] oauth url=${OAUTH_ENDPOINT} scope=${scope} appId=${appId?.slice(0,10)}... status=${res.status} body=${text.slice(0,300)}`);
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

// In-memory cache for Finding Service results (per-instance, 5 min TTL).
const findingCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// eBay Finding API has been returning 500 errorId 10001 100% of the
// time as of late April 2026 — wasting 2.5s per attempt (1s call + 2s
// backoff + 1s retry that also fails). Bypass it entirely and go
// straight to Browse. Set EBAY_USE_FINDING=true in env to re-enable
// (e.g. if eBay restores the endpoint or for diagnostic comparison).
const USE_FINDING = process.env.EBAY_USE_FINDING === 'true';

// Try the Finding API findCompletedItems (real sold data, no OAuth needed).
// Returns parsed results array on success, or null on any failure so the
// caller can fall back to Browse API.
// Adds: 500ms pre-call spacing, 5-min in-memory cache, and one retry with
// 2s backoff when eBay returns 500 + errorId 10001 (rate-limit).
const tryFindCompleted = async ({ appId, query }) => {
  const cacheKey = String(query || '').trim().toLowerCase();
  if (cacheKey && findingCache.has(cacheKey)) {
    const cached = findingCache.get(cacheKey);
    if (Date.now() - cached.ts < CACHE_TTL) {
      console.log(`[comps] finding cache hit for "${cacheKey}"`);
      return cached.data;
    }
    findingCache.delete(cacheKey);
  }

  const url =
    `${FINDING_ENDPOINT}?` +
    `OPERATION-NAME=findCompletedItems` +
    `&SERVICE-VERSION=1.0.0` +
    `&SECURITY-APPNAME=${encodeURIComponent(appId)}` +
    `&RESPONSE-DATA-FORMAT=JSON` +
    `&keywords=${encodeURIComponent(query)}` +
    `&categoryId=63` +
    `&itemFilter(0).name=SoldItemsOnly` +
    `&itemFilter(0).value=true` +
    `&sortOrder=EndTimeSoonest` +
    `&paginationInput.entriesPerPage=20`;

  const doFetch = async () => {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(url);
    const body = res.ok ? null : await res.text();
    return { res, body };
  };

  try {
    console.log(`[comps] finding url=${url}`);
    let { res, body } = await doFetch();
    console.log(`[comps] finding http status=${res.status}`);

    if (!res.ok) {
      const isRateLimit = res.status === 500 && /"errorId"\s*:\s*\[?\s*"?10001"?/i.test(body || '');
      if (isRateLimit) {
        console.warn(`[comps] finding 500 errorId 10001 — backoff 2s then retry once`);
        await new Promise((r) => setTimeout(r, 2000));
        ({ res, body } = await doFetch());
        console.log(`[comps] finding retry http status=${res.status}`);
        if (!res.ok) {
          console.warn(`[comps] finding retry failed — skipping, using Browse`);
          return null;
        }
      } else {
        console.error(`[comps] finding non-OK body:\n${body}`);
        return null;
      }
    }

    const json = await res.json();
    const items =
      json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item;
    if (!Array.isArray(items) || items.length === 0) {
      console.log(`[comps] finding items=0`);
      if (cacheKey) findingCache.set(cacheKey, { ts: Date.now(), data: null });
      return null;
    }
    console.log(`[comps] finding items=${items.length}`);
    const parsed = items
      .map((it) => {
        const price = parseFloat(
          it?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__
        );
        if (isNaN(price) || price <= 0) return null;
        return {
          price,
          endTime: it?.listingInfo?.[0]?.endTime || null,
          title: it?.title?.[0] || null,
          url: it?.viewItemURL?.[0] || null,
        };
      })
      .filter(Boolean);
    if (cacheKey) findingCache.set(cacheKey, { ts: Date.now(), data: parsed });
    return parsed;
  } catch (err) {
    console.error(`[comps] finding error: ${err?.message || err}`);
    return null;
  }
};

// Fall back to the Browse API (active listings, not true sold data).
// Uses the standard api_scope which every production app has. Returns
// parsed results or null on failure.
const tryBrowse = async ({ appId, certId, query }) => {
  try {
    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    // Pool expansion:
    //  - limit=100 (5x the prior 20) so we see a representative slice of
    //    large markets like modern Image/DC/Marvel #1s.
    //  - buyingOptions includes AUCTION so real market bids count.
    //  - sort=bestMatch returns relevance-ranked results instead of
    //    stale end-of-listing relists that bias the top 20 toward junk.
    const url =
      `${BROWSE_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&category_ids=${CATEGORY_ID}` +
      `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE|AUCTION}")}` +
      `&limit=100&sort=bestMatch`;
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

// Reprints, facsimiles, anniversary variants, and nth printings pollute Browse
// API results for any high-demand key (e.g. ASM #300 constantly surfaces
// "True Believers" reprints, and "2nd ptg" listings skew first-print comps).
// F3 extension (commit Tier-0): added Millennium Edition, DC Classics Library,
// Marvel Milestones, Masterworks, reproduction, replica edition, premiere
// edition, archive edition — all observed poisoning B&B #28 / TMNT #1 /
// similar Silver-Age-and-older reprint-contamination vectors.
const REPRINT_RE = /true believers|reprint|facsimile|replica|anniversary edition|2nd\s*p(?:rint|tg)|3rd\s*p(?:rint|tg)|4th\s*p(?:rint|tg)|5th\s*p(?:rint|tg)|second\s*print|third\s*print|fourth\s*print|\bptg\b|millennium edition|dc classics library|marvel milestones|masterworks|reproduction|replica edition|premiere edition|archive edition/i;

// For raw (ungraded) searches, exclude any listing that mentions a grading
// slab. Require an explicit slab indicator followed by an optional letter
// tier and a numeric grade. Bare "9.4" in a raw seller's self-grade no
// longer triggers the filter. Covers CGC, CBCS, PGX, PSA (Pro Sports
// Authenticator also grades comics), EGS, HGA, generic "slab/graded/
// universal", CGC Signature Series, "verified" / "qualified" tier tags.
const SLAB_RE = /\b(?:cgc|cbcs|pgx|psa|egs|hga|slab|graded|universal|signature\s+series|verified|qualified)\s*(?:ss|signature\s+series|mt|nm\/mt|nm\+|nm-|nm|vf\/nm|vf\+|vf-|vf|fn\/vf|fn\+|fn-|fn|vg\/fn|vg\+|vg-|vg|gd\/vg|gd\+|gd-|gd|fr\/gd|fr|pr)?\s*\d+(?:\.\d+)?/i;

// For graded searches, require the title to mention CGC or CBCS.
const GRADED_RE = /\bCGC\b|\bCBCS\b/i;

// Variant contamination. Hard-reject markers when our book is NOT a variant.
// Also re-used as a guard inside the creator-match filter so creator
// preference never selects a variant listing (even in variant-fallback mode).
// Ship #13 Bug 4: exported so enrich.js can compute variant composition
// ratio for the homogeneous-pool damping check.
export const VARIANT_CONTAM_RE = /\bvariant\b|\bvirgin\b|\bfoil\b|\bratio\b|\b1:\d+\b|\bincentive\b|\bnewsstand\b|\bwhitman\b|\bprice\s+variant\b|\btype\s+1|\bexclusive\b|\bsketch\b|\bexcl\.?\b/i;

// Ship #13 Bug 3: signed / autographed / signature-series / yellow-label /
// green-label / remarked listings command a premium over standard copies.
// Reject when our book is NOT a signed variant (gated at call site).
// Skips bare `SS` per Q3 decision — too many false positives (SS-Squadron,
// Steel & Soul, character names). Multi-word "signature series" catches
// the real CGC SS cases. Blue label intentionally omitted — blue = Universal
// (standard, not signed). Yellow = CGC Signature Series, Green = Qualified
// (signed but not witnessed) — both signed.
export const SIGNED_RE = /\b(?:signed|signature\s+series|autographed?|yellow\s*label|green\s*label|remarked?)\b/i;

// TPB / collected-edition format markers. When our title contains one of
// these, we know we're pricing a TPB / hardcover / omnibus / compendium —
// floppy single-issue listings must be filtered out (they vastly outnumber
// rare collected editions on eBay and poison the avg).
const TPB_MARKER_RE =
  /\b(?:tpb|trade\s*paperback|hardcover|hc|omnibus|compendium|deluxe(?:\s*edition)?|absolute(?:\s*edition)?|treasury(?:\s*edition)?|collected\s*edition|graphic\s*novel|gn)\b/i;

// Parse a numeric grade from a listing title. Recognizes CGC X.X slab grades
// and raw letter grades (NM, VF+, GD-, etc). Returns null when no grade is
// detectable — caller should keep those listings (can't prove mismatch).
const parseListingGrade = (title) => {
  const t = String(title || '');
  const cgc = t.match(/CGC\s*([\d.]+)/i);
  if (cgc) return parseFloat(cgc[1]);
  const gradeMap = [
    ['nm/mt', 9.8], ['nm+', 9.6], ['nm-', 9.2],
    ['nm', 9.4], ['vf/nm', 9.0], ['vf+', 8.5],
    ['vf-', 7.5], ['vf', 8.0], ['fn/vf', 7.0],
    ['fn+', 6.5], ['fn-', 5.5], ['fn', 6.0],
    ['vg/fn', 5.0], ['vg+', 4.5], ['vg-', 3.5],
    ['vg', 4.0], ['gd/vg', 3.0], ['gd+', 2.5],
    ['gd-', 1.8], ['gd', 2.0], ['fr/gd', 1.5],
    ['fr', 1.0], ['pr', 0.5]
  ];
  for (const [abbr, val] of gradeMap) {
    const re = new RegExp(
      '(?:^|[\\s#(])' +
      abbr.replace('/', '\\/') +
      '(?:[\\s)$]|\\d)', 'i');
    if (re.test(t)) return val;
  }
  return null;
};

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

// Stop-words excluded from title-similarity tokens. These all appear so
// commonly across comic listings (publisher names, format words, common
// English particles) that matching on them produces noise. They stay in
// the eBay search query — only the similarity-match step ignores them.
// Without this filter "Tip Top Comics" tokenizes to ["comics"] only,
// which matches every comic listing on eBay.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or',
  'in', 'on', 'at', 'to', 'for', 'with',
  'comic', 'comics', 'comicbook', 'issue', 'volume', 'vol',
  'marvel', 'dc', 'image', 'dark', 'horse', 'idw',
]);
const MIN_TOKEN_LEN = 2;

// Tokenize a title for similarity matching. Lowercases, strips the issue#
// hash, splits on non-alphanumerics, drops stop-words and pure-digit
// tokens (years, raw numbers carry no series-name signal).
const tokenizeTitle = (title) => {
  const words = String(title || "")
    .toLowerCase()
    .replace(/#\s*\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) =>
      w.length >= MIN_TOKEN_LEN &&
      !STOP_WORDS.has(w) &&
      !/^\d+$/.test(w)
    );
  return words;
};

// Require ≥50% of our non-stop-word tokens to appear in the listing's
// non-stop-word tokens. "Tip Top Comics" → ["tip","top"] (comics is
// stop-word), Dell listing "Tip Top #219 Dell" → ["tip","top","dell"]
// → 2/2 overlap → match. Fantastic Four → ["fantastic","four"] →
// 0/2 overlap with ["tip","top"] → reject. When our tokens are all
// stop-words (e.g. "Dark Horse Comics") we have no signal — return true
// and let other filters (issue#, slab, etc.) handle it.
const hasSufficientTitleOverlap = (listingTitle, searchTokens) => {
  if (!searchTokens || searchTokens.length === 0) return true;
  const listingSet = new Set(tokenizeTitle(listingTitle));
  if (listingSet.size === 0) return false;
  let matches = 0;
  for (const t of searchTokens) {
    if (listingSet.has(t)) matches++;
  }
  return matches / searchTokens.length >= 0.5;
};

// Listing must contain the issue number as "#N" with a word boundary after
// (so "#1710" and "#21" don't match "#1"). Also rejects lot listings with
// commas-between-digits, "lot" keyword, or multiple distinct #N patterns
// (multi-issue compound listings like "#1 + #4 variant set").
export const hasIssueNumber = (listingTitle, issueNum) => {
  if (!issueNum) return true;
  const t = String(listingTitle || "");
  // Reject lot listings (multiple issues bundled together)
  if (/\blot\b/i.test(t) || /\d+\s*,\s*\d+/.test(t)) return false;
  // Exact issue match: require # prefix, word boundary after
  const escaped = String(issueNum).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`#\\s*${escaped}\\b`, "i").test(t)) return false;
  // Ship #13 Bug 1: multi-issue compound detection. When more than one
  // distinct #N pattern appears in the title, the listing is a bundle
  // whose price can't be attributed to our issue — reject. Catches
  // "Absolute Batman #4 + #1 variant" and "#1 and #4 set" which the
  // basic lot filter missed (no comma between digits, no "lot" word).
  return !hasMultipleDistinctIssues(t);
};

// Ship #13 Bug 1: helper to count distinct #N patterns in a title.
// Returns true when ≥2 different issue numbers are present. Used inside
// hasIssueNumber above but also exported for direct regression testing.
export const hasMultipleDistinctIssues = (listingTitle) => {
  const distinct = new Set();
  for (const m of String(listingTitle || "").matchAll(/#\s*(\d+)\b/gi)) {
    distinct.add(m[1]);
    if (distinct.size > 1) return true;
  }
  return false;
};

// Ship #13 Bug 2: detect series-extension markers in a title — Roman
// numerals II-X, Vol/Volume N, Re-/Pre- prefix words, Part N, Book N.
// Returns an array of normalized marker strings like
// ['roman-ii', 'vol-2', 're-evolution']. Empty array = no markers.
// Used to reject "Last Ronin II Re-Evolution #4" from "Last Ronin #4"
// search (same issue number, different series via sequel markers).
export const detectSeriesMarkers = (title) => {
  const t = String(title || '');
  const markers = [];
  // Roman numerals II-X, collected via matchAll so a leading "X-Men" /
  // "V-Wars" / "X-Factor" in the title doesn't eat the match slot before
  // we reach a real sequel marker. `(?<![\w-])` and `(?![\w-])` exclude
  // hyphenated adjacency (so X-Men / V-Wars' X / V are ignored) while
  // still accepting standalone V / X when the title actually uses them
  // as sequel markers. `VI{0,3}` covers V/VI/VII/VIII in one atom.
  for (const m of t.matchAll(/(?<![\w-])(III|II|IV|VI{0,3}|IX|X)(?![\w-])/g)) {
    markers.push(`roman-${m[1].toLowerCase()}`);
  }
  // Vol / Volume N
  const volMatch = t.match(/\bVol(?:\.|ume)?\s*(\d+)\b/i);
  if (volMatch) markers.push(`vol-${volMatch[1]}`);
  // Re- / Pre- prefix followed by a capitalized word. Requires cap letter
  // so "re-read" / "pre-order" (seller flavor text) don't match.
  const reMatch = t.match(/\b(Re|Pre)[-\s]([A-Z][a-z]+)\b/);
  if (reMatch) markers.push(`${reMatch[1].toLowerCase()}-${reMatch[2].toLowerCase()}`);
  // Part N
  const partMatch = t.match(/\bPart\s+(\d+)\b/i);
  if (partMatch) markers.push(`part-${partMatch[1]}`);
  // Book N
  const bookMatch = t.match(/\bBook\s+(\d+)\b/i);
  if (bookMatch) markers.push(`book-${bookMatch[1]}`);
  return markers;
};

// Clean a comic title for eBay search: strip articles and special chars.
const cleanTitleForSearch = (title) => {
  if (!title) return "";
  let t = String(title).trim();
  t = t.replace(/^(The|A|An)\s+/i, "");
  t = t
    .replace(/\(.*?\)/g, "")
    .replace(/:/g, "")
    // Replace apostrophes/quotes/!/? with a SPACE (not empty) so "D'Orc"
    // tokenizes on eBay as "D Orc" rather than collapsing to "DOrc".
    .replace(/['"!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
};

// Normalize a publisher string for search queries. Brackets/quotes/slashes/
// ampersands/question marks break eBay's query parser or truncate the match,
// so they're replaced with spaces and collapsed. Preserves all word tokens —
// "Hollywood Comics (Walt Disney)" → "Hollywood Comics Walt Disney".
export const cleanPublisher = (p) => {
  if (!p) return "";
  return String(p)
    .replace(/[()[\]{}"'\/\\&?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

// computeMatchConfidence — DISPLAY-only signal that scores how well our
// final comp set matches the book we're pricing. NEVER influences the
// pricing math chain (gradeMult / sanity / floor / variant / key); the
// score is surfaced via out.matchConfidence so the UI can warn the user
// when comps are loose substitutes rather than exact matches.
//
// Per-comp checklist (compMax floats based on which fields the caller
// supplied — variant/creator add max only when present):
//   title presence (substring or ≥50% token overlap) +20
//   issue#                                            +20
//   year                                              +15
//   variant first-15-chars                            +20 (only if variant)
//   creator                                           +15 (only if creator)
//   print match (1st-print vs reprint alignment)      +10
//
// Final score = round(avg(perCompScore/perCompMax) * 100). Tier:
//   ≥85 HIGH, ≥65 MEDIUM, else LOW.
export const computeMatchConfidence = (comps, opts = {}) => {
  if (!Array.isArray(comps) || comps.length === 0) {
    return {
      score: 0,
      tier: 'LOW',
      displayMessage: 'No eBay comps found — AI estimate only',
    };
  }
  const { title, issue, year, variant, creator } = opts;
  const titleLower = String(title || '').toLowerCase().trim();
  const issueStr = issue != null ? String(issue).trim() : '';
  const variantLower = variant ? String(variant).toLowerCase() : '';
  const creatorLower = creator ? String(creator).toLowerCase().trim() : '';
  const escIssue = issueStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const issueRe = escIssue ? new RegExp(`#?${escIssue}\\b`) : null;
  const yearRe = year ? new RegExp(`\\b${String(year)}\\b`) : null;
  const our1stPrint = !variantLower.includes('print');
  const reprintRe = /\b(?:2nd|3rd|4th|second|third|fourth)\s*print/i;
  const ourTitleTokens = titleLower
    ? titleLower.split(/\s+/).filter((w) => w.length >= 3)
    : [];

  let totalNorm = 0;
  for (const comp of comps) {
    const t = String(comp.title || '').toLowerCase();
    let s = 0;
    let max = 0;

    // Title
    max += 20;
    if (titleLower && t.includes(titleLower)) {
      s += 20;
    } else if (ourTitleTokens.length > 0) {
      const matched = ourTitleTokens.filter((w) => t.includes(w)).length;
      if (matched / ourTitleTokens.length >= 0.5) s += 14; // partial credit
    }

    // Issue#
    if (issueRe) {
      max += 20;
      if (issueRe.test(t)) s += 20;
    }

    // Year
    if (yearRe) {
      max += 15;
      if (yearRe.test(t)) s += 15;
    }

    // Variant (first 15 chars to avoid over-strict full-string match)
    if (variantLower) {
      max += 20;
      if (t.includes(variantLower.slice(0, 15))) s += 20;
    }

    // Creator
    if (creatorLower && creatorLower.length >= 3) {
      max += 15;
      if (t.includes(creatorLower)) s += 15;
    }

    // Print alignment
    max += 10;
    const isReprint = reprintRe.test(t);
    if (our1stPrint && !isReprint) s += 10;
    else if (!our1stPrint && isReprint) s += 10;

    totalNorm += max > 0 ? s / max : 0;
  }

  const avg = totalNorm / comps.length;
  const rawScore = Math.round(avg * 100);

  // Thin-data caps: 1 comp can't earn HIGH/MEDIUM confidence; 2 comps cap at MEDIUM.
  // Prevents "100 ✓ Verified" badges when there's nothing to verify against.
  if (comps.length === 1) {
    return {
      score: Math.min(rawScore, 60),
      tier: 'LOW',
      displayMessage: 'Only 1 comp found — limited data',
    };
  }
  if (comps.length === 2) {
    const capped = Math.min(rawScore, 75);
    return {
      score: capped,
      tier: capped >= 65 ? 'MEDIUM' : 'LOW',
      displayMessage: 'Limited comps — verify before listing',
    };
  }

  const tier = avg >= 0.85 ? 'HIGH' : avg >= 0.65 ? 'MEDIUM' : 'LOW';
  return { score: rawScore, tier };
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
  variant,
  creator,
  publisher,
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
  console.log('[comps] title=', title, 'issue=', issue, 'cleanTitle=', cleanTitle);

  // Grade suffix appended to every attempt query.
  const gradeSuffix =
    isGraded === true && numericTarget != null && !isNaN(numericTarget)
      ? ` CGC ${numericTarget}`
      : "";

  // Extract a short variant keyword for search queries.
  const VARIANT_SHORT = {
    'gold': 'gold',
    '2nd print': '2nd print',
    'second print': '2nd print',
    'newsstand': 'newsstand',
    'whitman': 'whitman',
    'virgin': 'virgin',
    '1:25': '1:25',
    '1:50': '1:50',
    '1:100': '1:100',
    '35 cent': '35 cent',
    '30 cent': '30 cent',
  };
  const shortVariant = variant
    ? Object.entries(VARIANT_SHORT).find(([k]) => String(variant).toLowerCase().includes(k))?.[1] || null
    : null;
  const variantKeyword = shortVariant ? ` ${shortVariant}` : "";

  // Build publisher keyword for most-specific attempt.
  // Atlas/Timely are pre-Marvel — eBay sellers use both terms interchangeably.
  // Strip brackets/special chars so "Hollywood Comics (Walt Disney)" preserves
  // both imprint and parent words in the eBay query.
  const pubClean = publisher ? cleanPublisher(publisher) : null;
  let pubKeyword = "";
  if (pubClean) {
    const pubLower = pubClean.toLowerCase();
    if (pubLower.includes("atlas") || pubLower.includes("timely")) {
      pubKeyword = " Atlas Marvel";
    } else if (pubLower.includes("marvel")) {
      pubKeyword = " Marvel";
    } else if (pubLower.length <= 35) {
      pubKeyword = ` ${pubClean}`;
    }
  }

  // Full variant string for most-specific attempt (not just the short keyword).
  const fullVariant = variant ? String(variant).trim() : "";

  // Build ordered list of query attempts — most specific to least.
  const attempts = [];
  // Attempt 0: most specific — cleanTitle #issue fullVariant year publisher (+ grade suffix)
  if (iss && yr) {
    const a0Parts = [cleanTitle, `#${iss}`, fullVariant, yr, pubKeyword.trim()].filter(Boolean);
    const a0 = a0Parts.join(' ').trim().slice(0, 100);
    attempts.push({ q: a0, n: 0, useGrade: true });
  }
  // Attempt 1: full — cleanTitle #issue variant year (+ grade suffix)
  if (iss && yr) {
    attempts.push({ q: `${cleanTitle} #${iss}${variantKeyword} ${yr}`, n: 1, useGrade: true });
  }
  // Attempt 2: no year — cleanTitle #issue variant (+ grade suffix)
  if (iss) {
    attempts.push({ q: `${cleanTitle} #${iss}${variantKeyword}`, n: 2, useGrade: true });
  }
  // Attempt 3: no issue — cleanTitle year (+ grade suffix)
  if (yr) {
    attempts.push({ q: `${cleanTitle} ${yr}`, n: 3, useGrade: true });
  }
  // Attempt 4: title only — cleanTitle (no grade suffix)
  attempts.push({ q: cleanTitle, n: 4, useGrade: false });
  // Attempt 5: first significant word + issue (no grade suffix)
  if (iss) {
    const sig = firstSignificantWord(cleanTitle);
    if (sig) {
      attempts.push({ q: `${sig} #${iss}`, n: 5, useGrade: false });
    }
  }

  // Dell Four Color alias: Dell's "Four Color" anthology ran issues 1-1354
  // (1939-1962), each issue a different character. Sellers list these
  // three ways — (a) "Chilly Willy #1017" (already covered above), (b)
  // "Four Color #1017 Chilly Willy", (c) "Dell Four Color 1017". Add
  // explicit aliases for (b) and (c) so comps pick up both listing styles.
  // Guard on publisher="Dell" + issue > 100 to avoid polluting unrelated
  // Dell titles.
  const isDellFourColor =
    pubClean &&
    /dell/i.test(pubClean) &&
    iss &&
    parseInt(iss, 10) > 100;
  if (isDellFourColor) {
    // Let alias-style listings (which may omit the character name) survive
    // the title-similarity filter by seeding "four"/"color" tokens.
    if (!searchTokens.includes('four')) searchTokens.push('four');
    if (!searchTokens.includes('color')) searchTokens.push('color');
    const fcAliases = [];
    if (yr) fcAliases.push(`Four Color #${iss} ${cleanTitle} ${yr}`);
    fcAliases.push(`Four Color #${iss} ${cleanTitle}`);
    fcAliases.push(`Dell Four Color ${iss}`);
    for (const q of fcAliases) {
      attempts.push({ q: q.trim().slice(0, 100), n: attempts.length, useGrade: true });
    }
    console.log('[comps] Dell Four Color aliases added:', fcAliases);
  }

  // Artist-specific variant priority: when the variant names a known
  // cover artist (Skan virgin, Rapoza virgin, Momoko, etc.), try the
  // EXACT artist+variant comp before falling through to generic-virgin /
  // variantKeyword queries. Other artist-virgin copies trade at very
  // different prices than ours, so mixing them poisons the average.
  // Falls through gracefully when nothing matches — caller flags
  // artistFallback so the UI can warn the user.
  const ARTIST_PATTERNS = [
    // Multi-word patterns first (first-match-wins via break) so they
    // capture the longer, more specific name before single-word fallbacks.
    /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i,
    /frank cho/i, /frank miller/i, /windsor.?smith/i, /dell'?otto/i,
    // Single-word patterns
    /skan/i, /rapoza/i, /quash/i, /momoko/i, /ross/i, /adams/i,
    /kirkham/i, /bean/i, /andolfo/i, /browne/i, /forstner/i,
    /howard/i, /corona/i, /stegman/i, /ottley/i,
    /jimenez/i, /mcfarlane/i, /campbell/i, /artgerm/i, /nakayama/i,
    /hughes/i, /byrne/i, /perez/i, /kirby/i, /ditko/i, /mele/i,
    /albuquerque/i, /hama/i,
  ];
  let artistName = null;
  if (variant) {
    for (const pattern of ARTIST_PATTERNS) {
      const m = String(variant).match(pattern);
      if (m) {
        artistName = m[0];
        const isVirgin = /virgin/i.test(variant);
        const artistParts = [
          cleanTitle,
          iss ? `#${iss}` : null,
          artistName,
          isVirgin ? 'virgin' : null,
          yr,
          pubKeyword.trim(),
        ].filter(Boolean);
        const artistQuery = artistParts.join(' ').trim().slice(0, 100);
        attempts.unshift({
          q: artistQuery,
          n: -1,
          label: 'artist-specific',
          useGrade: true,
        });
        console.log('[comps] artist-specific attempt:', artistQuery);
        break;
      }
    }
  }

  // ARROW 1: TPB-aware attempt. When our title contains a TPB/collected-
  // edition marker, prepend an attempt that DROPS `#issue` (TPBs aren't
  // sold by issue number) so eBay's relevance ranker stops biasing to
  // floppies. Marker is appended only if cleanTitle doesn't already
  // contain it (avoids "Collected Edition Collected Edition" duplication).
  const tpbMatch = String(title || '').match(TPB_MARKER_RE);
  const isTPB = !!tpbMatch;
  const tpbMarker = isTPB ? tpbMatch[0] : null;
  if (isTPB) {
    const titleHasMarker = TPB_MARKER_RE.test(cleanTitle);
    const tpbParts = [
      cleanTitle,
      titleHasMarker ? null : tpbMarker,
      yr,
      pubKeyword.trim(),
    ].filter(Boolean);
    const tpbQ = tpbParts.join(' ').trim().slice(0, 100);
    attempts.unshift({ q: tpbQ, n: -2, label: 'tpb-aware', useGrade: true });
    console.log('[comps] tpb-aware attempt:', tpbQ, '(marker:', tpbMarker, ')');
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
    let attemptUsed = 0;
    let attemptLabel = null;
    let parsed = [];
    let reprintFallback = false;
    let variantFallback = false;
    let fellBack = false;
    let eraFilterBypassed = false;
    let multiIssueRejected = 0;
    let sequelRejected = 0;
    let signedRejected = 0;

    // Full filter chain on a single raw result set. Called inside the
    // attempt loop so we can move on to the next (broader) query when
    // filters wipe everything — prevents a too-specific query from
    // matching junk listings that survive into raw but all die in
    // filters, starving the broader fallback queries.
    const applyFilterChain = (raw) => {
      let p = raw.slice().sort(
        (a, b) => new Date(b.endTime || 0) - new Date(a.endTime || 0)
      );
      let _reprintFallback = false;
      let _variantFallback = false;
      let _fellBack = false;
      let _eraFilterBypassed = false;
      let _multiIssueRejected = 0;
      let _sequelRejected = 0;
      let _signedRejected = 0;

      // Filter 0a: issue-number enforcement. RELAXED for TPBs — TPB
      // listings typically lack a `#1` token (sellers write "TPB Vol 1"
      // or omit issue numbers since a TPB is a single-volume product).
      // When isTPB, accept listings that have EITHER the issue number
      // OR a TPB-format marker; otherwise the standard #issue check.
      // Ship #13 Bug 1: multi-issue compound rejection embedded in
      // hasIssueNumber. Count separately for observability.
      if (issueNum) {
        const before = p.length;
        p = p.filter((it) => {
          const t = String(it.title || '');
          // TPB bypass — accept TPB format listings without strict #N
          if (isTPB && TPB_MARKER_RE.test(t)) return true;
          // Bug 1: multi-issue detection. Counted separately before the
          // standard #N check so the observability counter reflects
          // actual compound rejections.
          if (hasMultipleDistinctIssues(t)) {
            _multiIssueRejected++;
            console.log('[issue-filter] multi-issue rejected:', t.slice(0, 55));
            return false;
          }
          return hasIssueNumber(t, issueNum);
        });
        if (p.length < before) {
          console.log(`[comps] issue# filter removed ${before - p.length}`);
        }
      }

      // Filter 0b: title similarity.
      if (searchTokens.length > 0) {
        const before = p.length;
        p = p.filter((it) => hasSufficientTitleOverlap(it.title, searchTokens));
        if (p.length < before) {
          console.log(`[comps] title similarity filter removed ${before - p.length}`);
        }
      }

      // Ship #13 Bug 2: sequel / volume / extension asymmetry filter.
      // Token overlap alone (filter 0b) can't tell "Last Ronin II
      // Re-Evolution #4" from "Last Ronin #4" — both share "last" + "ronin".
      // Detect Roman numerals II-X, Vol N, Re-/Pre- prefix, Part N, Book N
      // in each listing and reject when listing has a marker our title does
      // NOT. Graceful wipe-out fallback: keep all if filter removes every
      // listing (e.g. user scanned a Vol 2 book but didn't type "Vol 2").
      {
        const ourMarkers = detectSeriesMarkers(title);
        const beforeSeq = p.length;
        let localSequelRejected = 0;
        const sequelFiltered = p.filter((it) => {
          const theirMarkers = detectSeriesMarkers(it.title);
          for (const m of theirMarkers) {
            if (!ourMarkers.includes(m)) {
              localSequelRejected++;
              console.log('[sequel-filter] series asymmetry detected:',
                String(it.title || '').slice(0, 55), `(marker: ${m})`);
              return false;
            }
          }
          return true;
        });
        if (sequelFiltered.length === 0 && beforeSeq > 0) {
          console.log('[sequel-filter] bypassed — all', beforeSeq,
            'comps had sequel markers, keeping all');
        } else {
          p = sequelFiltered;
          _sequelRejected = localSequelRejected;
          if (localSequelRejected > 0) {
            console.log(`[comps] sequel filter removed ${localSequelRejected}`);
          }
        }
      }

      // Filter 0c: era consistency (F2). Reject listings whose year
      // differs from our confirmedYear (passed in as `year`) by more than
      // the era's tolerance. Catches clean reprint listings that don't
      // match REPRINT_RE (e.g. DC Classics Library issues retaining the
      // original's #issue number without explicit "reprint" token).
      // Tolerance:
      //   <1970 (Golden/early Silver): ±5y — volatile cover dating
      //   1970-1985 (Bronze):          ±3y — tight
      //   ≥1985 (Modern):              ±3y — deep comp pools, collision risk
      // Graceful wipe-out fallback: if filter removes every listing, keep
      // all and flag eraFilterBypassed so UI can warn user.
      if (year) {
        const yearNum = parseInt(String(year), 10);
        if (!isNaN(yearNum)) {
          const tolerance =
            yearNum < 1970 ? 5 :
            yearNum < 1985 ? 3 :
            3;
          const extractYear = (t) => {
            const m = String(t || '').match(/\b(19|20)\d{2}\b/);
            return m ? parseInt(m[0], 10) : null;
          };
          const beforeEra = p.length;
          const eraFiltered = p.filter((it) => {
            const ly = extractYear(it.title);
            if (ly == null) return true;
            const diff = Math.abs(ly - yearNum);
            if (diff > tolerance) {
              console.log('[era-filter] rejected:',
                String(it.title || '').slice(0, 55),
                `(year ${ly} vs ${yearNum}, tol ±${tolerance})`);
              return false;
            }
            return true;
          });
          if (eraFiltered.length === 0 && beforeEra > 0) {
            console.log('[era-filter] bypassed — all', beforeEra,
              'comps failed, keeping all');
            _eraFilterBypassed = true;
          } else {
            p = eraFiltered;
            if (p.length < beforeEra) {
              console.log(`[comps] era filter removed ${beforeEra - p.length}`);
            }
          }
        }
      }

      // Filter 1: reprints / facsimiles / anniversary variants / nth printings.
      const isNthPrint = (variant || '').toLowerCase().match(/\d+(?:st|nd|rd|th)\s*p(?:rint|tg)/);
      if (!isNthPrint) {
        const beforeReprint = p;
        const afterReprint = p.filter((it) => !REPRINT_RE.test(String(it.title || "")));
        if (afterReprint.length === 0 && beforeReprint.length > 0) {
          console.log('[comps] reprint fallback: all comps were reprints, keeping all');
          _reprintFallback = true;
        } else {
          p = afterReprint;
          if (p.length < beforeReprint.length) {
            console.log(`[comps] reprint filter removed ${beforeReprint.length - p.length}`);
          }
        }
      } else {
        console.log(`[comps] reprint filter skipped — book is ${variant}`);
      }

      // Filter 1b: variant contamination. Hard reject when our book is NOT
      // a variant. VARIANT_CONTAM_RE hoisted to module scope so the
      // creator-match filter below can re-apply it as a hard guard.
      if (!variant) {
        const beforeVariant = p;
        const afterVariant = p.filter((it) => !VARIANT_CONTAM_RE.test(String(it.title || "")));
        if (afterVariant.length === 0 && beforeVariant.length > 0) {
          console.log('[comps] variant fallback: all comps were variants, keeping all');
          _variantFallback = true;
        } else {
          p = afterVariant;
          if (p.length < beforeVariant.length) {
            console.log(`[comps] variant filter removed ${beforeVariant.length - p.length}`);
          }
        }
      }

      // Filter 1c: variant preference.
      if (variant && p.length > 0) {
        const varWords = String(variant).toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['variant', 'cover', 'print', 'edition'].includes(w));
        if (varWords.length > 0) {
          const variantMatches = p.filter(it => {
            const t = String(it.title || '').toLowerCase();
            return varWords.some(w => t.includes(w));
          });
          if (variantMatches.length >= 2) {
            console.log(`[comps] variant preference: ${variantMatches.length}/${p.length} match "${variant}" words [${varWords.join(',')}]`);
            p = variantMatches;
          } else {
            console.log(`[comps] variant preference: only ${variantMatches.length} match — keeping all ${p.length}`);
          }
        }
      }

      // Filter 1d: cover-letter matching. Cover A, B, C, D are separate
      // books with separate prices — never compare across cover letters.
      //  - Our book has no variant OR is Cover A OR is just "1st print":
      //    drop any listing with Cover B/C/D/E+ in the title.
      //  - Our book has a specific cover letter (B/C/...): keep ONLY
      //    listings matching that letter; fall back to all if zero match
      //    (prefer weak comp over no comp).
      {
        const ourVariant = String(variant || '').toLowerCase();
        const ourCoverMatch = ourVariant.match(/\b(?:cover|cvr)\s*([a-z])\b/);
        const ourCoverLetter = ourCoverMatch ? ourCoverMatch[1].toLowerCase() : null;
        const isCoverAorStandard =
          !ourVariant ||
          ourCoverLetter === 'a' ||
          ourVariant.includes('1st print') ||
          ourVariant.includes('first print');

        if (isCoverAorStandard) {
          const OTHER_COVER_RE = /\bcover\s*[b-z]\b|\bcvr\s*[b-z]\b/i;
          const before = p.length;
          p = p.filter((item) => {
            if (OTHER_COVER_RE.test(String(item.title || ''))) {
              console.log('[other-cover] rejected:',
                String(item.title || '').slice(0, 50));
              return false;
            }
            return true;
          });
          if (p.length < before) {
            console.log(`[comps] other-cover filter removed ${before - p.length}`);
          }
        } else if (ourCoverLetter) {
          const OUR_COVER_RE = new RegExp(
            `\\b(?:cover|cvr)\\s*${ourCoverLetter}\\b`, 'i'
          );
          const before = p.length;
          const matched = p.filter((item) => OUR_COVER_RE.test(String(item.title || '')));
          if (matched.length > 0) {
            p = matched;
            console.log(`[comps] our-cover filter kept ${matched.length}/${before} with cover ${ourCoverLetter}`);
          } else {
            console.log(`[comps] our-cover filter: no listings match cover ${ourCoverLetter} — keeping all`);
          }
        }
      }

      // Filter 1e: lot / set / bundle / multi-book filter. Multi-book
      // listings inflate single-book averages (e.g. Dark Horse Comics #1
      // showed $33.72 comp that was actually "#1-5" 5-book lot). Skip
      // when our book itself is a lot/set listing. The "\d+ book/issue/
      // comic" alternation REQUIRES a "lot|set" qualifier — without it,
      // "1 Issue Comic Book" (common single-issue title fragment) would
      // falsely match. The naked `#N-M` issue-range alternation was
      // moved to `isValidIssueRange()` below — the bare regex was
      // killing valid singles like "Konga #2 - FN- (5.5) - Charlton
      // 1961 - 10 Cents" (matched "1961-10") and "Marvel Super Heroes
      // #1 - 1966" (matched "1-1966").
      {
        const ourVariantStr = String(variant || '').toLowerCase();
        const isOurBookALot = /\b(?:lot|set|bundle)\b/.test(ourVariantStr);
        if (!isOurBookALot) {
          const LOT_RE =
            /\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection)\b|\bset\s*of\s*\d+\b|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b/i;
          const isValidIssueRange = (title) => {
            const re = /#?(\d+(?:\.\d+)?)\s*[-–—]\s*#?(\d+(?:\.\d+)?)/g;
            for (const m of title.matchAll(re)) {
              const firstStr = m[1];
              const secondStr = m[2];
              const first = parseFloat(firstStr);
              const second = parseFloat(secondStr);
              if (second >= 1800 && second <= 2050) continue; // year
              if (second <= 10 && secondStr.includes('.')) continue; // grade
              if (first >= second) continue; // not ascending
              if (
                Number.isInteger(first) &&
                Number.isInteger(second) &&
                second < 1000
              ) {
                return true;
              }
            }
            return false;
          };
          const before = p.length;
          p = p.filter((item) => {
            const t = String(item.title || '');
            if (LOT_RE.test(t) || isValidIssueRange(t)) {
              console.log('[lot-filter] rejected:', t.slice(0, 55));
              return false;
            }
            return true;
          });
          if (p.length < before) {
            console.log(`[comps] lot filter removed ${before - p.length}`);
          }
        }
      }

      // Filter 1f: half-issue / ashcan / promo filter. Books like Fathom
      // #1 (1998 Wizard World Chicago Exclusive) were getting Fathom #1/2
      // (2001 Wizard promo) as comps — different books that pass the
      // issue-number filter because "#1/2" contains "#1" before the slash.
      // Skip when our book IS a half-issue / fraction (Spawn #½, Fathom
      // #1/2, etc.). Tightened from spec: `#` prefix REQUIRED on the
      // `#N/M` and `#N.M` alternations — otherwise grades like "9.4" or
      // date strings like "9/2026" would match and wipe legitimate comps.
      {
        const issueStr = String(issue || '');
        const isOurBookHalfIssue =
          issueStr.includes('/') ||
          issueStr.includes('.') ||
          issueStr.includes('½');
        if (!isOurBookHalfIssue) {
          const HALF_ISSUE_RE =
            /#\s*\d+\s*\/\s*\d+\b|#\s*\d+\.\d+\b|\b½\b|\bhalf[-\s]*issue\b|\b1\/2\s*issue\b|\bashcan\b|\bpromo(?:tional)?\b/i;
          const before = p.length;
          p = p.filter((item) => {
            const t = String(item.title || '');
            if (HALF_ISSUE_RE.test(t)) {
              console.log('[half-issue] rejected:', t.slice(0, 50));
              return false;
            }
            return true;
          });
          if (p.length < before) {
            console.log(`[comps] half-issue filter removed ${before - p.length}`);
          }
        }
      }

      // Filter 1g: TPB / collected-edition format match. ARROW 2 of the
      // TPB fix. When our title contains a TPB marker (tpb, hardcover,
      // omnibus, compendium, collected edition, etc.), require comp
      // listing titles to also contain a TPB marker — otherwise floppy
      // single issues poison the avg (e.g. Batman vs Predator Collected
      // Edition was getting $8.97 floppy avg vs ~$30 real TPB market).
      // Graceful fallback to keeping all if zero TPB-format matches.
      if (isTPB && p.length > 0) {
        const before = p.length;
        const tpbFiltered = p.filter((item) => TPB_MARKER_RE.test(String(item.title || '')));
        if (tpbFiltered.length > 0) {
          console.log(`[tpb-format] kept ${tpbFiltered.length} of ${before} (marker required)`);
          p = tpbFiltered;
        } else {
          console.log(`[tpb-format] 0 TPB matches — keeping all ${before} (graceful fallback)`);
        }
      }

      // Filter 2: raw-vs-graded title separation.
      if (rawOnly) {
        const before = p.length;
        p = p.filter((it) => !SLAB_RE.test(String(it.title || "")));
        if (p.length < before) {
          console.log(`[comps] slab filter removed ${before - p.length}`);
        }
      } else if (gradedOnly) {
        const before = p.length;
        p = p.filter((it) => GRADED_RE.test(String(it.title || "")));
        if (p.length < before) {
          console.log(`[comps] non-graded filter removed ${before - p.length}`);
        }
      }

      // Ship #13 Bug 3 (Filter 2b): signed / autographed / signature-series
      // exclusion. Signed books command a premium over standard copies —
      // pollutes both raw pools ("2X signed" seller listings) and graded
      // pools (CGC SS yellow-label slabs). Gate: skip when our book is
      // itself a signed variant (detected via variant string).
      {
        const ourVariantStr = String(variant || '').toLowerCase();
        const isOurBookSigned =
          /\b(?:signed|signature|autograph(?:ed)?|\bauto\b|remarked?|yellow\s*label|green\s*label)\b/.test(ourVariantStr);
        if (!isOurBookSigned) {
          const before = p.length;
          p = p.filter((it) => {
            if (SIGNED_RE.test(String(it.title || ''))) {
              _signedRejected++;
              console.log('[signed-filter] SS listing rejected:',
                String(it.title || '').slice(0, 55));
              return false;
            }
            return true;
          });
          if (p.length < before) {
            console.log(`[comps] signed filter removed ${before - p.length}`);
          }
        }
      }

      // Filter 3: ±1.5 grade proximity.
      if (p.length > 0 && numericTarget != null && !isNaN(numericTarget)) {
        const filtered = p.filter((it) => {
          const listingGrade = parseListingGrade(it.title);
          if (listingGrade === null) return true;
          const diff = Math.abs(listingGrade - numericTarget);
          if (diff > 1.5) {
            console.log('[grade-filter] rejected:',
              String(it.title || '').slice(0, 50),
              'grade:', listingGrade,
              'vs our:', numericTarget);
            return false;
          }
          return true;
        });
        if (filtered.length > 0) {
          p = filtered;
        } else {
          _fellBack = true;
        }
      }

      // Filter 3b (creator-aware soft preference, moved from 1b-creator):
      // When no variant is set but grade.js reported a main cover artist,
      // prefer comps whose titles mention that creator. Runs AFTER all
      // hard filters (variant/cover/lot/half-issue/TPB/slab/grade) so we
      // only pick among listings that already passed those rejects.
      // Re-applies VARIANT_CONTAM_RE as a hard guard so creator preference
      // never selects a variant — even when variant fallback kept the
      // pool (e.g. Usagi Yojimbo #1 Cover A where Eastman-branded RI-C
      // Variant was slipping through because Eastman matched the creator).
      if (!variant && creator && p.length > 0) {
        const creatorLower = String(creator).toLowerCase().trim();
        if (creatorLower.length >= 3) {
          const creatorMatches = p.filter((it) => {
            const t = String(it.title || '').toLowerCase();
            if (VARIANT_CONTAM_RE.test(t)) return false;
            return t.includes(creatorLower);
          });
          if (creatorMatches.length >= 2) {
            console.log(`[creator-match] kept ${creatorMatches.length} of ${p.length} matching creator "${creator}"`);
            p = creatorMatches;
          } else {
            console.log(`[creator-match] only ${creatorMatches.length} match creator "${creator}" — keeping all ${p.length}`);
          }
        }
      }

      // Filter 4: median-based price sanity.
      {
        const before = p.length;
        p = applyPriceSanity(p);
        if (p.length < before) {
          console.log(`[comps] price sanity removed ${before - p.length}`);
        }
      }

      // Filter 5: dedup near-identical listings.
      {
        const before = p.length;
        const seenListings = new Set();
        p = p.filter((item) => {
          const key =
            String(item.price || '0') + '|' +
            String(item.title || '').toLowerCase().slice(0, 35);
          if (seenListings.has(key)) {
            console.log('[dedup] removed duplicate:',
              String(item.title || '').slice(0, 40));
            return false;
          }
          seenListings.add(key);
          return true;
        });
        if (p.length < before) {
          console.log(`[comps] dedup removed ${before - p.length}`);
        }
      }

      return {
        parsed: p,
        reprintFallback: _reprintFallback,
        variantFallback: _variantFallback,
        fellBack: _fellBack,
        eraFilterBypassed: _eraFilterBypassed,
        multiIssueRejected: _multiIssueRejected,
        sequelRejected: _sequelRejected,
        signedRejected: _signedRejected,
      };
    };

    // Iterate attempts most-specific → least. Break on the FIRST attempt
    // whose filtered survivors are non-empty — not just on non-empty raw
    // results, because a too-specific query can match junk that all gets
    // filtered out, and we want to fall through to the broader queries.
    for (let i = 0; i < uniqueAttempts.length; i++) {
      const attempt = uniqueAttempts[i];
      query = attempt.q + (attempt.useGrade ? gradeSuffix : "");
      let raw = null;
      if (USE_FINDING) {
        source = "finding_api";
        raw = await tryFindCompleted({ appId, query });
      }
      if (!raw || raw.length === 0) {
        source = "browse_api";
        raw = await tryBrowse({ appId, certId, query });
      }
      const rawCount = raw ? raw.length : 0;
      console.log(`[comps] attempt ${attempt.n} query="${query}" raw=${rawCount}`);
      if (rawCount === 0) continue;

      const filtered = applyFilterChain(raw);
      console.log(`[comps] attempt ${attempt.n} post-filter=${filtered.parsed.length}`);
      if (filtered.parsed.length > 0) {
        parsed = filtered.parsed;
        reprintFallback = filtered.reprintFallback;
        variantFallback = filtered.variantFallback;
        fellBack = filtered.fellBack;
        eraFilterBypassed = filtered.eraFilterBypassed;
        multiIssueRejected = filtered.multiIssueRejected;
        sequelRejected = filtered.sequelRejected;
        signedRejected = filtered.signedRejected;
        attemptUsed = attempt.n;
        attemptLabel = attempt.label || null;
        break;
      }
      if (i < uniqueAttempts.length - 1) {
        console.log(`[comps] attempt ${attempt.n} post-filter empty, trying next`);
      }
    }

    if (parsed.length === 0) {
      return { ...emptyComps(query, "no sales after filters"), attemptUsed: 0 };
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
        title: p.title || null,
        date: p.endTime,
        daysAgo,
        itemWebUrl: p.url || null,
      };
    });

    // Artist fallback: we queued an artist-specific attempt but the
    // winning query doesn't actually contain the artist name — i.e. we
    // fell through to a generic virgin/variant comp set.
    const winningQuery = String(query || '').toLowerCase();
    const artistFallback =
      !!artistName &&
      !winningQuery.includes(String(artistName).toLowerCase());

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
      reprintFallback,
      variantFallback,
      eraFilterBypassed,
      artistFallback,
      compBasis: artistFallback ? 'generic-variant-fallback' : null,
      multiIssueRejected,
      sequelRejected,
      signedRejected,
      attemptUsed,
      attemptLabel,
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
