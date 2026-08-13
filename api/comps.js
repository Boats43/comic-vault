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

// Issue 6 — Shared grade utilities for numeric extraction
import { extractNumericFromGrade } from '../src/lib/gradeUtils.js';
// FIX 3 — Vercel KV persistent cache (replaces in-memory Map)
import { kvGet, kvSet, KV_TTL } from './kv-cache.js';

// Comp hygiene primitives extracted Ship #20a.6 to src/lib/compHygiene.js
// for reuse by sold-comp verification (src/lib/soldVerification.js).
// Behavior preserved exactly. api/enrich.js + tests continue to import
// VARIANT_CONTAM_RE / SIGNED_RE / cleanPublisher / hasIssueNumber /
// hasMultipleDistinctIssues / detectSeriesMarkers from this module via
// the re-exports below.
import {
  REPRINT_RE,
  SLAB_RE,
  GRADED_RE,
  applyRawGradedSeparationFilter,
  VARIANT_CONTAM_RE,
  SIGNED_RE,
  TPB_MARKER_RE,
  // GrailKey Commit Q (Q1b, 2026-08-03) — used ONLY for the isTPB
  // derivation below (our OWN book's title), not for comp-title matching.
  // TPB_MARKER_RE's bare "absolute"/"deluxe"/"treasury" alternatives
  // collide with DC's real "Absolute" line (launched 2024) — a plain
  // "Absolute Batman" single-issue scan was wrongly classified isTPB=true,
  // which (a) drops #issue from the eBay query attempt (ARROW 1, below)
  // and (b) bypasses Filter 0a's issue-number enforcement for any
  // TPB_MARKER_RE-matching comp title — together the mechanism that let
  // #2-#15 and hardcovers into a #1 active pool (GrailKey full-pipeline
  // audit, 2026-08-03). Every OTHER TPB_MARKER_RE use in this file tests
  // COMP titles under an already-correct isTPB gate and is intentionally
  // left on the looser form — see the Q1c report in that commit for the
  // full per-consumer breakdown of which is which.
  IDENTITY_TPB_MARKER_RE,
  PREMIUM_VARIANT_RE,
  OTHER_COVER_RE,
  OTHER_VARIANT_DESCRIPTOR_RE,
  LOT_RE,
  MERCH_RE,
  HALF_ISSUE_RE,
  COVERLESS_RE,
  TRADING_CARD_RE,
  ARTIST_PATTERNS,
  STOP_WORDS,
  MIN_TOKEN_LEN,
  tokenizeTitle,
  hasSufficientTitleOverlap,
  parseListingGrade,
  getQualitativeGradeCeiling,
  applyPriceSanity,
  extractIssueNumber,
  normalizeIssueFormat,  // Q23 FIX
  hasIssueNumber,
  hasMultipleDistinctIssues,
  hasCrossSeriesSeparator,
  detectSeriesMarkers,
  isValidIssueRange,
  isEnumeratedIssueList,
  extractArtist,
  classifyArtistMatch,
  cleanPublisher,
  getEraYearTolerance,
  evaluateEraYearMatch,
  hasNamedVariantDescriptor,
  detectVariantCompsExcludedByEra,
} from "../src/lib/compHygiene.js";

import { classifyVariantTokens } from "../src/lib/imageSearchIdentity.js";
import { buildEvidencePopulations, buildPricingEligibleRows, buildEvidenceForResponse, classifyYearEvidence } from "../src/lib/evidenceEligibility.js";

export {
  VARIANT_CONTAM_RE,
  SIGNED_RE,
  REPRINT_RE,
  cleanPublisher,
  hasIssueNumber,
  hasMultipleDistinctIssues,
  detectSeriesMarkers,
  emptyComps,
};

import { checkRateLimit } from "./rate-limit.js";

const FINDING_ENDPOINT =
  "https://svcs.ebay.com/services/search/FindingService/v1";
const OAUTH_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_ENDPOINT =
  "https://api.ebay.com/buy/browse/v1/item_summary/search";
const DEFAULT_CATEGORY_ID = "259104"; // Comics > Comic Books > Single Issues (fallback)
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

// Credential cleanup (2026-07-22) — log presence only, never a value
// fragment. The prior version logged the first 20 chars of both
// EBAY_APP_ID/EBAY_CERT_ID plus length on every cold start; enough of a
// production API secret leaks through 20 characters that this counts as
// exposure, not diagnostics. configured=true/false is sufficient to
// confirm both env vars are actually loaded in this function.
console.log(`[comps] env EBAY_APP_ID configured=${!!process.env.EBAY_APP_ID}`);
console.log(`[comps] env EBAY_CERT_ID configured=${!!process.env.EBAY_CERT_ID}`);

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

// GrailKey Directive B, Task 2 — `unavailable` distinguishes "the eBay
// search could not run" (missing credentials, no title to search, a thrown
// fetch error) from "the eBay search ran and genuinely found nothing"
// (filters removed every candidate). Both previously collapsed to an
// identical count===0 shape with no way for anything downstream to tell
// them apart. Defaults to false so every pre-existing call site that
// doesn't pass a third argument keeps its current (genuine-zero) meaning.
const emptyComps = (query, reason, unavailable = false) => ({
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
  unavailable: unavailable === true,
  source: null,
});

// Module-scope OAuth token cache, keyed by scope — a zero-latency fast
// path when the instance is genuinely warm. Tokens are valid ~2h; we
// refresh when the cache is within 60s of expiry.
//
// Perf follow-up (2026-07-20): this in-memory layer only helps a warm
// instance — this app's sparse traffic means most requests hit a cold
// instance with an empty tokenCache, defeating it and forcing a live
// OAuth POST on nearly every request (confirmed via production logs: the
// OAuth POST fired on 6/13 requests in one sample window). Same
// "in-memory doesn't survive cold starts" class already solved for
// cv:/pc:/ac: via the persistent Upstash KV store (kv-cache.js) — the KV
// layer below reuses that exact mechanism rather than inventing a new
// one. Stores the identical {token, expiresAt} shape used in-memory, so
// the same 60s-margin freshness check governs both layers — a KV hit
// can never serve a token the in-memory check would have rejected.
const tokenCache = {};

export const getOAuthToken = async (appId, certId, scope) => {
  const now = Date.now();
  const cached = tokenCache[scope];
  if (cached && now < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const kvKey = `oauth:${scope}`;
  const kvCached = await kvGet(kvKey);
  if (kvCached && kvCached.token && kvCached.expiresAt && now < kvCached.expiresAt - 60_000) {
    tokenCache[scope] = kvCached; // hydrate this instance's fast path with the TRUE expiresAt, not an approximation
    return kvCached.token;
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
  const redacted = text.replace(/"access_token":"[^"]+"/, '"access_token":"[REDACTED]"');
  console.log(`[comps][diag] oauth url=${OAUTH_ENDPOINT} scope=${scope} appIdConfigured=${!!appId} status=${res.status} body=${redacted.slice(0,300)}`);
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
  const entry = { token: json.access_token, expiresAt: now + ttlMs };
  tokenCache[scope] = entry;
  // KV TTL set 60s short of the real expiry so Redis's own eviction
  // enforces the same margin as the in-memory check above — a cold
  // instance can never read back a KV entry the warm-instance check
  // would have already refreshed.
  const kvTtlSeconds = Math.max(60, Math.floor(ttlMs / 1000) - 60);
  await kvSet(kvKey, entry, kvTtlSeconds);
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
const tryBrowse = async ({ appId, certId, query, categoryId, assetType }) => {
  try {
    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    // Pool expansion:
    //  - limit=100 (5x the prior 20) so we see a representative slice of
    //    large markets like modern Image/DC/Marvel #1s.
    //  - buyingOptions includes AUCTION so real market bids count.
    //  - sort=bestMatch returns relevance-ranked results instead of
    //    stale end-of-listing relists that bias the top 20 toward junk.
    const effectiveCategoryId = categoryId || DEFAULT_CATEGORY_ID;
    const url =
      `${BROWSE_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&category_ids=${effectiveCategoryId}` +
      `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE|AUCTION}")}` +
      `&limit=100&sort=bestMatch`;
    console.log(`[comps] assetType=${assetType || 'comic'} category=${effectiveCategoryId} query="${query}" browse url=${url}`);
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
          // TRACK B.2: eBay condition codes
          conditionId: it?.condition || null,
          conditionDisplayName: it?.conditionDisplayName || null,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error(`[comps] browse error: ${err?.message || err}`);
    return null;
  }
};

// REPRINT_RE / SLAB_RE / GRADED_RE / VARIANT_CONTAM_RE / SIGNED_RE moved
// to src/lib/compHygiene.js (Ship #20a.6). Imported + re-exported above.

// TPB_MARKER_RE / parseListingGrade / applyPriceSanity / extractIssueNumber
// / STOP_WORDS / MIN_TOKEN_LEN / tokenizeTitle / hasSufficientTitleOverlap
// / hasIssueNumber / hasMultipleDistinctIssues / detectSeriesMarkers moved
// to src/lib/compHygiene.js (Ship #20a.6). Imported + (where needed)
// re-exported above. Active-comp callers in this file pick them up via
// module-scope binding.

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

// cleanPublisher moved to src/lib/compHygiene.js (Ship #20a.6).
// Imported + re-exported above.

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

/**
 * Filter 1c: variant preference. Extracted as a pure, exported function
 * (2026-07-18, Q111 dispatch, Venomverse #1 class) so it's directly
 * regression-testable without a live eBay fetch — same pattern as
 * hasMultipleDistinctIssues/detectSeriesMarkers below.
 *
 * When our confirmed `variant` carries multiple SPECIFIC tokens
 * (convention/ratio/retailer/exclusive/limitation/authentication — e.g.
 * "sdcc", "1:1000"), require ALL of them (AND-match) rather than any
 * single token, so a comp matching only a co-occurring GENERIC finish
 * descriptor ("foil") doesn't count as a real match — "foil" alone can't
 * distinguish an SDCC 1:1000 exclusive from any other foil printing of the
 * same book. Falls back to the broader any-token OR-match if the AND-match
 * produces zero comps (never silently starves the pool), and reduces to
 * exactly the pre-2026-07-18 OR-match behavior when `variant` has 0 or 1
 * specific tokens (Silk #1 / Magik #1 class — single-token variants are
 * unaffected by this change).
 *
 * Q116 dispatch (2026-07-18, Incredible Hulk #377 class) — classifyVariantTokens
 * (not the raw varWords word-split) is now the primary signal; varWords is
 * only consulted as a fallback when classifyVariantTokens finds zero
 * specific tokens. Previously varWords gated the whole function up front,
 * which silently blocked any multi-word-only specific token whose
 * component words are all short/stoplisted (e.g. "3rd print" — "3rd" is
 * length 3, "print" is an explicit stopword) from ever isolating at all.
 *
 * @param {Array<{title?: string}>} pool - current comp pool
 * @param {string|null} variant - our confirmed variant string
 * @returns {{pool: Array, isolated: boolean, matchMode: string}} isolated
 *   pool (or the original pool, unchanged, if the match count didn't clear
 *   the threshold); isolated=true when Filter 1c narrowed the pool on a
 *   premium/specific signal (drives out.premiumVariantIsolated downstream).
 */
export const applyVariantPreferenceFilter = (pool, variant) => {
  const before = pool.length;
  if (!variant || pool.length === 0) {
    return { pool, isolated: false, matchMode: 'none' };
  }

  const orMatch = (words) => pool.filter(it => {
    const t = String(it.title || '').toLowerCase();
    return words.some(w => t.includes(w));
  });

  const { specific: specificWords } = classifyVariantTokens(variant);

  // Q116 dispatch (2026-07-18, Incredible Hulk #377 class) — classifyVariantTokens
  // is now consulted BEFORE the raw varWords gate, not after it. Previously
  // varWords (a naive length>3 + stopword-excluded word split, stopwords
  // include the literal word "print") gated the ENTIRE function — any
  // multi-word-only specific token whose individual words are all short or
  // stoplisted ("3rd print": "3rd" is length 3, "print" is an explicit
  // stopword) produced an empty varWords and the function early-returned
  // matchMode='none' before classifyVariantTokens was ever consulted,
  // regardless of what it would have found. varWords is now only a
  // fallback for variant text that classifyVariantTokens can't classify at
  // all (unrecognized custom text) — unchanged from its original purpose,
  // just no longer gating a codepath it isn't involved in.
  const varWords = String(variant).toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['variant', 'cover', 'print', 'edition'].includes(w));

  if (specificWords.length === 0 && varWords.length === 0) {
    return { pool, isolated: false, matchMode: 'none' };
  }

  let variantMatches;
  let matchMode;
  if (specificWords.length > 1) {
    const specificMatches = pool.filter(it => {
      const t = String(it.title || '').toLowerCase();
      return specificWords.every(w => t.includes(w));
    });
    if (specificMatches.length > 0) {
      variantMatches = specificMatches;
      matchMode = 'all-specific';
    } else {
      // Defensive fallback (same pattern as every other fix tonight): the
      // narrow AND-match produced nothing, so fall back to the broader
      // single-token match rather than starving the pool — flagged, not silent.
      console.log(`[comps] variant AND-match on [${specificWords.join(',')}] produced 0 comps — falling back to broader single-token match`);
      variantMatches = orMatch(specificWords.length > 0 ? specificWords : varWords);
      matchMode = 'any-fallback';
    }
  } else if (specificWords.length === 1) {
    // Single classified specific token — isolate directly on it rather
    // than the raw varWords split (which may not contain it at all, e.g.
    // "3rd print"). Reduces to identical pre-Q116 behavior whenever the
    // single specific token IS also a varWords survivor (Silk #1 class).
    variantMatches = orMatch(specificWords);
    matchMode = 'any';
  } else {
    // classifyVariantTokens found nothing at all (generic-only, like
    // "virgin"/"foil", or genuinely unrecognized text) — fall back to the
    // raw varWords OR-match, exactly the pre-Q116 behavior for this case.
    variantMatches = orMatch(varWords);
    matchMode = 'any';
  }

  // Premium-variant isolation (2026-07-18, Magik #1 / Silk #1 class):
  // convention-exclusive / retailer-exclusive / virgin / numbered-limited
  // books are a distinct, more valuable market segment than a generic
  // variant cover. The default >=2 threshold starves on thin pools (2-3
  // comps, exactly the scenario these books show up in) and silently falls
  // back to "keep all", blending genuine exclusive comps with generic
  // variant comps and systematically underpricing the book. A thin
  // isolated pool is already handled gracefully elsewhere (Ship #13.1
  // thin-pool anchor), so for premium tokens a single match is enough to
  // isolate rather than blend. An AND-matched pool (mode=all-specific) is
  // already maximally specific — stronger evidence than the premium-keyword
  // heuristic this threshold approximates — so it gets the same 1-match
  // bar regardless of PREMIUM_VARIANT_RE.
  const isPremiumVariant = PREMIUM_VARIANT_RE.test(String(variant));
  const isolatedOnSpecific = isPremiumVariant || matchMode === 'all-specific';
  const minMatches = isolatedOnSpecific ? 1 : 2;
  if (variantMatches.length >= minMatches) {
    console.log(`[comps] variant preference filter: before=${before} after=${variantMatches.length} kept=${variantMatches.length} (match "${variant}", mode=${matchMode}${isolatedOnSpecific ? ', premium-variant isolation' : ''})`);
    return { pool: variantMatches, isolated: isolatedOnSpecific, matchMode };
  }
  console.log(`[comps] variant preference filter: before=${before} after=${pool.length} (only ${variantMatches.length} match, mode=${matchMode} — keeping all)`);
  return { pool, isolated: false, matchMode };
};

// FIX B: Expanded modern relaunch marker detection. Reject listings with
// explicit modern relaunch markers when our book is pre-2000. Catches New
// 52, Rebirth, vol/volume numbering, etc. Module-level (Track B Phase 0
// Commit 2 hoist) so applyEraConsistencyFilter below can reference it —
// previously declared inline inside the block it's now extracted from.
const MODERN_RELAUNCH_RE = /\b(n52|new\s*52|rebirth|infinite\s*frontier|legacy|prime\s*earth|vol\.?\s*[2-9]|volume\s*[2-9]|v[2-9]\b|all[\s-]?new|now!)\b/i;

/**
 * Filter 0c: era consistency (F2). Extracted as a pure, exported function
 * (Track B Phase 0, Commit 2, 2026-07-29) — same "extract for direct
 * regression-testability" pattern as applyVariantPreferenceFilter above
 * (CLAUDE.md Pattern Library, Q111 dispatch: "extracted into a pure
 * exported function... matches the hasMultipleDistinctIssues/
 * detectSeriesMarkers pattern already used in this file").
 *
 * Rejects listings whose year differs from our confirmedYear by more than
 * the era's tolerance. Catches clean reprint listings that don't match
 * REPRINT_RE (e.g. DC Classics Library issues retaining the original's
 * #issue number without an explicit "reprint" token).
 *
 * Commit C.2 (Strange Tales dispatch, 2026-07-28) / Track B Phase 0 Commit
 * 2 — replaces the bare `/\b(19|20)\d{2}\b/` regex extraction with
 * classifyYearEvidence (src/lib/evidenceEligibility.js): only an
 * ISSUE_PUBLICATION_YEAR classification satisfies an exact issue-year
 * comparison. A SERIES_RANGE ("1951-76 1st Series") or SERIES_START_YEAR
 * ("1951 series") classification falls through to the SAME no-evidence-
 * keep branch as a genuinely undated listing — "Strange Tales #142
 * (1951-76 1st Series)" no longer gets treated as if it were a specific
 * issue's own 1951 publication year.
 *
 * Tolerance: getEraYearTolerance (src/lib/compHygiene.js) — single source
 * of truth, consolidated Q128 (was an inline copy here that had
 * independently drifted from soldVerification.js's own inline copy, whose
 * comment falsely claimed to "mirror" this one).
 *
 * Track B Phase 0, Commit 2 CONSUMER-AUDIT CORRECTION (2026-07-29): the
 * pre-existing "wipe-out bypass" (restore the FULL unfiltered pool when
 * era filtering rejects every row in an attempt) was audited before this
 * commit shipped and found to leak. Consumers of the resulting
 * `eraFilterBypassed` flag (`decisionEngine.js`'s `filter-bypass-detected`
 * warning, `api/enrich.js`'s matchConfidence LOW-cap) are SOFT — they cap
 * confidence/decision ceiling but never null price/bands/floor/average,
 * and never gate collection/liquid value. Worse: because the attempts
 * loop (`fetchComps`) only breaks on `filtered.parsed.length > 0`, a
 * restored-to-full pool from an EARLY, narrow attempt satisfied that
 * condition immediately — silently preventing the loop from trying
 * broader queries, AND preventing Ship v0-I's own, much better-guarded
 * era-fallback (reprint/slab/title/issue/±20y checks) from ever running,
 * since v0-I only fires when `parsed.length === 0` after the ENTIRE
 * attempts loop, which the inline restore prevented from ever being true.
 * A modern relaunch/wrong-year pool that passes every non-era filter
 * (the exact Renumbered-franchise-title/issue-collision class — ASM #17
 * 1964 vs. a 2015 relaunch "#17" sharing the same title+issue tokens)
 * could therefore reach pricing fully intact, contaminating recommendation/
 * bands/floor/average with zero hard block — the "confidently wrong"
 * failure mode this whole campaign exists to prevent, not a "fails honest"
 * one. Fixed here: the returned `pool` is now the ACTUAL surviving rows
 * (empty array when every row genuinely fails), never a restoration.
 * Rejected rows are preserved separately in `rejectedReferenceRows` (same
 * `{title, price, reason}` shape `soldVerification.js`'s `pushSample`
 * already uses) for research/display — I13 (never silently vaporize a
 * rejected row) — rather than being smuggled back into the priced pool.
 * `bypassed` is retained as a pure informational flag (still drives the
 * existing warning/confidence-cap copy) — it no longer changes what
 * `pool` contains. This also means an attempt that fails 100% on era
 * grounds now correctly falls through to the next, broader attempt (or to
 * Ship v0-I's own guardrail, which reactivates for the vintage-book case
 * it was built for) instead of a single narrow attempt's restored pool
 * short-circuiting both.
 *
 * @param {Array<{title?: string}>} pool - current comp pool
 * @param {number} yearNum - our confirmed year, already parsed
 * @param {string} assetType - 'comic' | 'tpb' | 'book'; books skip entirely
 *   (book year = edition, spans decades — Session 4B)
 * @param {number|null} [cvVolumeStartYear] - ComicVine volume start year,
 *   for the Q128 volume-label corroboration check inside evaluateEraYearMatch
 * @returns {{pool: Array, bypassed: boolean, excludedVariantCount: number,
 *   excludedVariantSamples: string[], rejectedReferenceRows: Array<{title, price, reason}>}}
 */
export const applyEraConsistencyFilter = (pool, yearNum, assetType, cvVolumeStartYear) => {
  if (!yearNum || !Number.isFinite(yearNum) || assetType === 'book') {
    return { pool, bypassed: false, excludedVariantCount: 0, excludedVariantSamples: [], rejectedReferenceRows: [] };
  }

  const tolerance = getEraYearTolerance(yearNum);
  const beforeEra = pool.length;
  let excludedVariantCount = 0;
  const excludedVariantSamples = [];
  const rejectedReferenceRows = [];

  const eraFiltered = pool.filter((it) => {
    const titleStr = String(it.title || '');

    // Reject modern relaunches for pre-2000 books.
    if (yearNum < 2000 && MODERN_RELAUNCH_RE.test(titleStr)) {
      console.log('[era-filter] rejected (modern relaunch marker):', titleStr.slice(0, 55));
      rejectedReferenceRows.push({ title: it.title ?? null, price: it.price ?? null, reason: 'modern-relaunch-marker' });
      return false;
    }

    // Only ISSUE_PUBLICATION_YEAR is exact-issue-year evidence.
    // SERIES_RANGE/SERIES_START_YEAR/SELLER_CONTEXT_UNKNOWN fall through to
    // the no-evidence-keep branch below, same as a genuinely undated row.
    const yearEvidence = classifyYearEvidence(titleStr);
    const ly = yearEvidence.class === 'ISSUE_PUBLICATION_YEAR' && yearEvidence.year
      ? parseInt(yearEvidence.year, 10)
      : null;

    // FIX B: no year evidence — ACCEPT (insufficient evidence to reject).
    // World's Finest #139/#149/#159/#163 all hit final=0 comps under the
    // old all-listings-must-have-a-year gate; eBay sellers frequently omit
    // year entirely on vintage listings. Modern relaunch contamination is
    // mitigated by the MODERN_RELAUNCH_RE check above instead.
    if (ly == null) {
      return true;
    }

    // Q128 dispatch (2026-07-19, Harley Quinn #62 class) — evaluateEraYearMatch
    // checks the normal confirmedYear tolerance first, then falls back to a
    // volume-label match before rejecting: comic back-issue sellers
    // routinely label listings with a series' volume-launch year rather
    // than the specific issue's cover date. Distinct from genuine
    // wrong-volume contamination (Batman #608 class), which this does NOT
    // protect — a volume-label match only admits a year matching THIS
    // specific book's own resolved volume, not any arbitrary nearby year.
    const { keep, matchedVia } = evaluateEraYearMatch(ly, yearNum, tolerance, cvVolumeStartYear);
    if (!keep) {
      console.log('[era-filter] rejected:',
        titleStr.slice(0, 55),
        `(year ${ly} vs ${yearNum}, tol ±${tolerance})`);
      // Q129 dispatch (2026-07-19, Harley Quinn #62 Guillem March Cover C
      // class) — track era-excluded rows that name a specific variant
      // descriptor; checked against the final surviving pool by the caller
      // (variant-comps-unavailable warning).
      if (hasNamedVariantDescriptor(titleStr)) {
        excludedVariantCount++;
        if (excludedVariantSamples.length < 3) {
          excludedVariantSamples.push(titleStr.slice(0, 80));
        }
      }
      rejectedReferenceRows.push({ title: it.title ?? null, price: it.price ?? null, reason: `era-year-mismatch:${ly}-vs-${yearNum}` });
      return false;
    }
    if (matchedVia === 'volume-label') {
      console.log('[era-filter] kept via volume-label match:',
        titleStr.slice(0, 55),
        `(year ${ly} matches CV volume start year ${cvVolumeStartYear}, confirmedYear=${yearNum})`);
    }
    return true;
  });

  const bypassed = eraFiltered.length === 0 && beforeEra > 0;
  if (bypassed) {
    console.log(
      `[era-filter] all ${beforeEra} comp(s) failed era consistency — pool is now empty ` +
      `(structural fix, Track B Phase 0 Commit 2: no longer restored); bypassed=true retained ` +
      `for warning/confidence-cap copy only, rejected rows preserved as rejectedReferenceRows`
    );
  } else if (eraFiltered.length < beforeEra) {
    console.log(`[comps] era filter removed ${beforeEra - eraFiltered.length}`);
  }
  return { pool: eraFiltered, bypassed, excludedVariantCount, excludedVariantSamples, rejectedReferenceRows };
};

/**
 * Q136 Slice A (2026-07-22, Lozano/Louw sibling class) — artist-preference
 * narrowing. Layered STRICTLY ON TOP of applyVariantPreferenceFilter's own
 * result — never replaces it, never runs independently of it. Per the
 * stability requirements: additive-only, byte-identical when no artist
 * signal is present.
 *
 * Real production case: Pop Kill #1 (Alexander Lozano MegaCon "Naughty"
 * Metal LTD 100) priced off a Warren Louw virgin sold comp — a real,
 * different variant by a different artist — because nothing in the
 * active-comp pipeline ever isolated on artist at all once a variant
 * string was present (Filter 3b, the only creator-aware active filter,
 * explicitly requires `!variant`). soldVerification.js has had a working,
 * proven artist hard-match (classifyArtistMatch, Q109) for SOLD comps for
 * some time; this ports the exact same mechanism to ACTIVE comps rather
 * than inventing a parallel one.
 *
 * `ourArtist` prefers `artistOverride` (extractArtist(confirmedTitle), from
 * api/enrich.js — the resolved IDENTITY itself, not gated by
 * extractConfirmedVariant's own majority-ratio ceiling, which was built to
 * exclude a common cover artist named on a MINORITY of an otherwise-generic
 * pool and would incorrectly also exclude an artist named on the MAJORITY
 * of a pool that already resolved to one coherent family) over
 * extractArtist(variant) (the pre-existing signal, unaffected for every
 * call site that doesn't pass artistOverride).
 *
 * No-op (returns `result` completely unchanged) when: no artist recognized
 * in either signal (the overwhelming majority of variant scans — base
 * books, old books, and any variant that simply doesn't name a specific
 * artist never reach the filter body at all), or when narrowing wouldn't
 * clear the floor (falls back to Filter 1c's own already-computed result,
 * exactly as if this function didn't exist).
 *
 * Floor reuses Filter 1c's own existing premium-variant-isolation
 * convention immediately above (minMatches=1 for a distinguishing signal)
 * rather than inventing a new number — an artist name is the same class of
 * distinguishing, premium signal PREMIUM_VARIANT_RE/isolatedOnSpecific
 * already treats as floor=1-worthy. Flagged for explicit sign-off per the
 * stability requirements: this reuses an existing constant for a NEW
 * purpose, which is a judgment call even though it isn't a new number.
 *
 * @param {{pool: Array, isolated: boolean, matchMode: string}} result - applyVariantPreferenceFilter's own, already-computed result
 * @param {string|null} variant - our confirmed variant string
 * @param {string|null} [artistOverride] - extractArtist(confirmedTitle), preferred over extractArtist(variant) when present
 * @returns {{pool: Array, isolated: boolean, matchMode: string}}
 */
export const applyArtistPreferenceNarrowing = (result, variant, artistOverride = null) => {
  const ourArtist = artistOverride || extractArtist(variant);
  if (!ourArtist || !Array.isArray(result?.pool) || result.pool.length === 0) {
    return result; // no artist signal — byte-identical no-op
  }

  const before = result.pool.length;
  const artistMatched = result.pool.filter((it) => {
    const outcome = classifyArtistMatch(String(it.title || ''), ourArtist);
    return outcome === 'match' || outcome === 'partial';
  });

  const ARTIST_NARROWING_FLOOR = 1; // reuses Filter 1c's own premium-isolation floor, see docstring above
  if (artistMatched.length >= ARTIST_NARROWING_FLOOR) {
    console.log(`[comps] artist-preference narrowing: before=${before} after=${artistMatched.length} kept=${artistMatched.length} (artist "${ourArtist}")`);
    return { pool: artistMatched, isolated: true, matchMode: `${result.matchMode}+artist` };
  }
  console.log(`[comps] artist-preference narrowing: before=${before} after=${result.pool.length} (0 artist matches — keeping Filter 1c's result unchanged)`);
  return result;
};

/**
 * Slice C (2026-07-22, Poison Ivy #31 / Giang MegaCon Secret Drop class) —
 * signed/autographed as a match DIMENSION, not a pure reject filter. Signed
 * books command a premium over standard copies of the same print run —
 * pollutes an unsigned book's pool exactly as much as blending signed and
 * unsigned comps together poisons a SIGNED book's own pool (Poison Ivy #31:
 * 4 signed Frison actives blended against an unsigned $3.49 sold comp →
 * priced below floor).
 *
 * Extracted into its own pure function (mirroring applyVariantPreferenceFilter/
 * applyArtistPreferenceNarrowing above) for direct regression-testability —
 * fetchComps below is a network-calling async function, not unit-testable
 * in isolation.
 *
 * Our book NOT signed: hard-reject SIGNED_RE matches (unchanged from Ship
 * #13 Bug 3's original behavior). Our book IS signed: isolate to ONLY
 * SIGNED_RE-matching listings, falling back to the full pool if zero
 * survive (same graceful-fallback convention as cover-letter Filter 1d /
 * variant-preference Filter 1c — prefer a weak comp over no comp).
 *
 * @param {Array} pool - candidate comp pool (post earlier filters)
 * @param {boolean} isOurBookSigned - "Vision or pool" combined signal (labelType==='signature' || signedConsensus || variant-text regex) computed by the caller
 * @returns {{pool: Array, isolated: boolean, signedRejectedCount: number}}
 */
export const applySignedPreferenceFilter = (pool, isOurBookSigned) => {
  const before = pool.length;
  if (!isOurBookSigned) {
    const kept = [];
    let rejectedCount = 0;
    for (const it of pool) {
      if (SIGNED_RE.test(String(it.title || ''))) {
        rejectedCount++;
        console.log('[signed-filter] SS listing rejected:', String(it.title || '').slice(0, 55));
      } else {
        kept.push(it);
      }
    }
    if (rejectedCount > 0) {
      console.log(`[comps] signed filter: before=${before} after=${kept.length} removed=${rejectedCount}`);
    }
    return { pool: kept, isolated: false, signedRejectedCount: rejectedCount };
  }

  const signedOnly = pool.filter((it) => SIGNED_RE.test(String(it.title || '')));
  if (signedOnly.length > 0) {
    console.log(`[comps] signed filter: before=${before} after=${signedOnly.length} kept=${signedOnly.length} (our book is signed — isolated to signed comps)`);
    return { pool: signedOnly, isolated: true, signedRejectedCount: 0 };
  }
  console.log(`[comps] signed filter: before=${before} after=${pool.length} (our book is signed but no signed comps found — keeping all)`);
  return { pool, isolated: false, signedRejectedCount: 0 };
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
  labelType,   // Q100 FIX-A — Vision slab label type, used to strip auth tokens from variant
  creator,
  publisher,
  imageSearchTitle,
  appId,
  certId,
  categoryId,  // Session 4B — eBay category (259104 comics, 267 books)
  assetType,   // Session 4B — 'comic' | 'book' for query builder routing
  author,      // Session 4B — book identity field (for buildBookQuery)
  cvVolumeStartYear = null,  // Q128 — ComicVine volume's own start_year (lookupComicVine's `.startYear`), used by Filter 0c to corroborate a "volume launch year" label distinct from confirmedYear
  artistOverride = null,  // Q136 Slice A — extractArtist(confirmedTitle) from api/enrich.js, when the RESOLVED identity itself names a recognized artist (see applyArtistPreferenceNarrowing below for why this differs from extractArtist(variant))
  signedConsensus = false,  // Slice C — pool-corroborated "our book is signed" signal (extractConfirmedVariant), for the case where Vision's own variant text can't say so (see Filter 2b below)
  // Track B Phase 0, Commit 4 (presence-threading correction) — two
  // primitives, not one collapsed scalar. issueAuthorityPresent: does an
  // issueAuthority object exist at all on the caller's side? Threaded
  // separately from issueAuthorityStatus (its .status value, if present) so
  // classifyEvidenceRow's gate can distinguish "no issueAuthority tracking
  // at all" (legacy, safe) from "an issueAuthority object exists but its
  // status is somehow null/undefined" (a malformed present record) — both
  // used to collapse to the identical bare `null` before this correction.
  issueAuthorityPresent = false,
  issueAuthorityStatus = null,  // Track B Phase 0, Commit 4 — out.issueAuthority?.status ('provisional'/'conflicted'/'confirmed'/null), threaded into evidenceTarget below for the TARGET_ISSUE_PROVISIONAL_AUTHORITY gate
}) => {
  if (!appId || !certId) {
    return emptyComps(null, "missing eBay credentials", true);
  }
  if (!title) {
    return emptyComps(null, "title required", true);
  }

  // Issue 6 FIX: Extract numeric from grade strings ("GD 2.5" → 2.5, "VF" → 8.0)
  // Prefer explicit numericGrade, fall back to extracting from grade string
  const numericTarget =
    numericGrade != null && !isNaN(Number(numericGrade))
      ? Number(numericGrade)                          // CGC: 9.4
      : grade != null
      ? extractNumericFromGrade(grade)                 // "GD 2.5" → 2.5, "VF" → 8.0
      : null;

  // Diagnostic log for grade numeric extraction
  console.log('[grade-numeric] input=', grade,
    'numericGrade=', numericGrade,
    'numericTarget=', numericTarget,
    'source=', numericGrade != null ? 'explicit' : 'extracted');
  const rawOnly = isGraded === false;
  const gradedOnly = isGraded === true;

  // Precompute relevance helpers once per request.
  const searchTokens = tokenizeTitle(title);
  // Issue number: prefer explicit `issue` param, fall back to extracting from title.
  // Session 4B — Books have no issues; never extract from title for books.
  // Q23 FIX — Normalize issue-format strings ("Annual 14" → 14 + format=annual)
  let issueNum = assetType === 'book'
    ? null
    : (issue ? String(issue).trim() : extractIssueNumber(title));

  let issueFormat = null;  // Q23: track format flag (annual/special/king-size/giant-size)
  if (issueNum) {
    const normalized = normalizeIssueFormat(issueNum);
    issueNum = normalized.issue;
    issueFormat = normalized.format;
    if (issueFormat) {
      console.log(`[comps] Q23 issue-format normalization: "${issue}" → issue="${issueNum}" format="${issueFormat}"`);
    }
  }

  const cleanTitle = cleanTitleForSearch(title);
  const iss = issueNum;  // Q23: use normalized numeric issue for queries
  const yr = year ? String(year).trim() : null;
  console.log('[comps] title=', title, 'issue=', issue, 'issueNum=', issueNum, 'cleanTitle=', cleanTitle);

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
  // Q100 FIX-A — Vision's free-text `variant` field can carry authentication
  // language ("signed", "CGC SS", "signature series") that has nothing to do
  // with the physical slab: an illustrated/printed artist signature in the
  // cover art gets misread as an autograph. The slab's actual label color is
  // authoritative for signature status, not free text. When the book IS
  // graded and the label is NOT signature, strip auth tokens before they
  // reach the query — a Universal-label book must never search for "signed".
  // Q111 [Item 1, reverted 2026-07-18] — convention tokens (NYCC/SDCC/C2E2/
  // etc.) were previously stripped alongside auth tokens on the theory that
  // a con-exclusive descriptor "has nothing to do with what makes the book
  // sellable" on a Universal-label slab. That conflates two unrelated
  // signals: CGC label color reflects signature/authentication status only
  // — it says nothing about whether the book is a genuine numbered/
  // convention-exclusive print run, which is a physical fact about the book
  // independent of grading. Stripping "nycc"/"sdcc" from the query actively
  // prevented finding the comps that would correctly price a con-exclusive
  // (Magik #1 / Silk #1 class, 2026-07-18) — removed from AUTH_STRIP so
  // convention tokens survive into the search query same as any other
  // variant descriptor. Auth-token stripping (signed/autograph/CGC SS/
  // signature series) is unchanged — that one guards against Vision
  // misreading an illustrated cover signature as a real autograph, which
  // has no analogue for convention-exclusive status.
  const AUTH_STRIP = /\b(signed|autograph(?:ed)?|cgc\s*ss|signature\s*series)\b/gi;
  const fullVariant = variant
    ? (isGraded && labelType !== 'signature'
        ? (() => {
            const raw = String(variant).trim();
            const matches = raw.match(AUTH_STRIP) || [];
            matches.forEach((m) => {
              console.log(`[variant-strip] removed auth token "${m.toLowerCase()}" from variant field (labelType=${labelType || 'null'})`);
            });
            return raw.replace(AUTH_STRIP, '').replace(/\s+/g, ' ').trim();
          })()
        : String(variant).trim())
    : "";

  // Build ordered list of query attempts — most specific to least.
  const attempts = [];

  // Ship #20a.6.7b.3 — Image search title as first attempt. When eBay visual
  // search returned results, the top rawTitle becomes attempt -1 (most specific).
  // This catches exact seller listings that Vision might have misread.
  if (imageSearchTitle) {
    const imgQuery = String(imageSearchTitle).trim().slice(0, 100);
    attempts.push({ q: imgQuery, n: -1, label: 'image-search', useGrade: false });
    console.log(`[comps] image-search attempt: "${imgQuery}"`);
  }

  // FIX: isTPB scoping — declare before if/else so it's accessible in filter chain (line 1100)
  let isTPB = false;
  // FIX: artistName scoping — declare before if/else so it's accessible in return statement (book vs comic)
  let artistName = null;

  // Session 4B — Book query builder routing (no #issue, uses author)
  if (assetType === 'book') {
    // Import buildBookQuery from adapter registry
    const { getAdapter } = await import('../src/adapters/adapterRegistry.js');
    const adapter = getAdapter('book');
    if (adapter.buildQuery) {
      const bookQueries = adapter.buildQuery(title, author, null, null, year);
      for (let i = 0; i < bookQueries.length; i++) {
        attempts.push({ q: bookQueries[i], n: i, label: 'book', useGrade: false });
      }
      console.log(`[comps] book queries: ${bookQueries.length} attempts`);
    }
  } else {
    // Comic query builder (existing logic)

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

  // GrailKey Directive O — variant-aware ladder reorder (Sabrina Annual
  // Spectacular 2024 #1 / Dan Parent NYCC Foil class, Directive N1's
  // proven Defect A). The image-search attempt (n=-1, Ship #20a.6.7b.3,
  // pushed unconditionally first at the top of this function) is built
  // from imageSearchTitle, which is variant-blind by ship12/Q141 design
  // (buildSanitizedComicSearchTitle takes title+issue+year only — see
  // that helper's own doc comment). For a book with a confirmed variant,
  // that generic query is BROADER than attempts 0/1/2 (the only three
  // built with fullVariant/variantKeyword above), yet ran before them —
  // and the attempt loop (api/comps.js, below) breaks on the FIRST
  // attempt with any post-filter survivor, so a broad generic pool
  // (abundant ordinary copies) could win before the variant-bearing
  // attempt ever ran. Production evidence: Sabrina scan, confirmedVariant
  // "Dan Parent NYCC variant" — attempt -1 alone returned 84 raw / 11
  // final survivors off 1997 generic copies; attempt 0 (which carries
  // "Dan Parent NYCC variant" in its query text) never executed.
  //
  // Fix is ORDER ONLY — no query string changes (ship12/Q141 sanitization
  // on imageSearchTitle is untouched; fullVariant/variantKeyword
  // construction above is untouched). When a confirmed variant exists,
  // move the already-built image-search attempt to run immediately AFTER
  // the last variant-bearing attempt (n 0-2) instead of unconditionally
  // first. No variant confirmed, or no variant-bearing attempt exists at
  // all (e.g. no issue number) → this is a no-op, image-search stays
  // exactly where Ship #20a.6.7b.3 originally put it (position 0) —
  // structural non-regression for every no-variant book shape.
  //
  // Runs BEFORE the artist-specific / tpb-aware unshift blocks below so
  // both keep unconditional priority over this reorder: those unshift to
  // absolute index 0 regardless of what this block already did, so a
  // known-artist variant or a TPB-marked title still wins the front of
  // the ladder exactly as before this change.
  if (variant) {
    const imgIdx = attempts.findIndex((a) => a.label === 'image-search');
    if (imgIdx !== -1) {
      let lastVariantIdx = -1;
      for (let k = 0; k < attempts.length; k++) {
        if (k !== imgIdx && typeof attempts[k].n === 'number' && attempts[k].n >= 0 && attempts[k].n <= 2) {
          lastVariantIdx = k;
        }
      }
      if (lastVariantIdx > imgIdx) {
        const [imgAttempt] = attempts.splice(imgIdx, 1);
        // lastVariantIdx was computed pre-removal; imgIdx < lastVariantIdx
        // means removing imgIdx shifts every later index left by 1, so
        // re-inserting at lastVariantIdx now lands right after the
        // (shifted) last variant-bearing attempt.
        attempts.splice(lastVariantIdx, 0, imgAttempt);
        console.log(
          `[comps-ladder] confirmedVariant="${variant}" — moved image-search attempt ` +
          `behind variant-bearing attempt(s), new position ${lastVariantIdx}`
        );
      }
    }
  }

  // Artist-specific variant priority: when the variant names a known
  // cover artist (Skan virgin, Rapoza virgin, Momoko, etc.), try the
  // EXACT artist+variant comp before falling through to generic-virgin /
  // variantKeyword queries. Other artist-virgin copies trade at very
  // different prices than ours, so mixing them poisons the average.
  // Falls through gracefully when nothing matches — caller flags
  // artistFallback so the UI can warn the user. ARTIST_PATTERNS list
  // moved to src/lib/compHygiene.js (Ship #20a.6).
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
  // GrailKey Commit Q (Q1b) — IDENTITY_TPB_MARKER_RE, not TPB_MARKER_RE.
  // This tests OUR OWN book's title, not a comp title — see the import
  // comment above for the full collision rationale.
  const tpbMatch = String(title || '').match(IDENTITY_TPB_MARKER_RE);
  isTPB = !!tpbMatch;  // FIX: assign to outer scope variable (declared at line 578)
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
  } // end comic query builder

  // Deduplicate (e.g. if no year was provided, attempts 1 & 2 are identical).
  const seen = new Set();
  const uniqueAttempts = attempts.filter(({ q }) => {
    const key = q.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Declare state variables outside try block so they're accessible in catch
  let query = "";
  let source = "";
  let attemptUsed = 0;
  let attemptLabel = null;
  let parsed = [];
  let gradeFilteredPrices = null;  // Fix C: grade-proximity filtered prices for floor calc
  let reprintFallback = false;
  let variantFallback = false;
  let premiumVariantIsolated = false;
  let fellBack = false;
  let eraFilterBypassed = false;
  let eraRejectedReferenceRows = [];  // Track B Phase 0, Commit 2 — I13 reference bucket for era-rejected rows
  let variantCompsExcludedByEra = null;
  let multiIssueRejected = 0;
  let sequelRejected = 0;
  let signedRejected = 0;

  try {

    // Ship v0-I — era-filter fallback tracking. Collects raw candidates when
    // post-filter=0 for vintage books, applies reprint guardrail after loop.
    const rawCandidates = [];

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
      let _premiumVariantIsolated = false;
      let _fellBack = false;
      let _eraFilterBypassed = false;
      let _eraExcludedVariantCount = 0;
      const _eraExcludedVariantSamples = [];
      const _eraRejectedReferenceRows = [];
      let _multiIssueRejected = 0;
      let _sequelRejected = 0;
      let _signedRejected = 0;

      // Session 4B — Survivor trace counters
      let afterTitle = 0;
      let afterEra = 0;
      let afterReprint = 0;
      let afterVariant = 0;
      let afterLot = 0;
      let afterSanity = 0;

      // Filter 0a: issue-number enforcement. RELAXED for TPBs — TPB
      // listings typically lack a `#1` token (sellers write "TPB Vol 1"
      // or omit issue numbers since a TPB is a single-volume product).
      // When isTPB, accept listings that have EITHER the issue number
      // OR a TPB-format marker; otherwise the standard #issue check.
      // Ship #13 Bug 1: multi-issue compound rejection embedded in
      // hasIssueNumber. Count separately for observability.
      // Session 4B — Skip for books (books have no issue numbers).
      // Q23 FIX — Format-aware issue matching. When issueFormat is set
      // (Annual/Special/King-Size/Giant-Size), require comp titles to
      // contain the format word + the numeric issue number together.
      if (assetType !== 'book' && issueNum) {
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
          // Q23: format-aware match
          if (issueFormat) {
            const formatWord = issueFormat.replace(/-/g, '[-\\s]?');  // king-size → king[-\s]?size
            const formatRe = new RegExp(`\\b${formatWord}\\s*#?\\s*${issueNum}\\b`, 'i');
            if (!formatRe.test(t)) {
              console.log(`[issue-filter] Q23 format-mismatch rejected (need ${issueFormat} #${issueNum}):`, t.slice(0, 55));
              return false;
            }
            return true;
          }
          // Q37: Pass series title for adjacency-aware dual-number parsing
          return hasIssueNumber(t, issueNum, title);
        });
        if (p.length < before) {
          console.log(`[comps] issue# filter removed ${before - p.length}`);
        }
      }

      // Filter 0b: title similarity.
      // Session 4B — Books: 0.3 threshold (editions vary by subtitle).
      // Comics: 0.5 default (titles near-identical).
      if (searchTokens.length > 0) {
        const before = p.length;
        const titleThreshold = assetType === 'book' ? 0.3 : 0.5;
        p = p.filter((it) => hasSufficientTitleOverlap(it.title, searchTokens, titleThreshold));
        if (p.length < before) {
          console.log(`[comps] title similarity filter removed ${before - p.length}`);
        }
      }
      afterTitle = p.length;

      // Ship #13 Bug 2: sequel / volume / extension asymmetry filter.
      // Token overlap alone (filter 0b) can't tell "Last Ronin II
      // Re-Evolution #4" from "Last Ronin #4" — both share "last" + "ronin".
      // Detect Roman numerals II-X, Vol N, Re-/Pre- prefix, Part N, Book N
      // in each listing and reject when listing has a marker our title does
      // NOT. Graceful wipe-out fallback: keep all if filter removes every
      // listing (e.g. user scanned a Vol 2 book but didn't type "Vol 2").
      // Session 4B — SKIP for books. Vol/Book/Part = editions, not sequels.
      if (assetType !== 'book') {
        const ourMarkers = detectSeriesMarkers(title);
        // Q144B dispatch (2026-07-22, Adventure Time Summer Special #1 SDCC
        // class) — canonical-target-aware marker allowance. `ourMarkers`
        // above is computed from the bare title string, which for this book
        // is "Adventure Time Summer Special" with no issue number embedded
        // — detectSeriesMarkers resolves that to 'special-?', never
        // 'special-1'. The real "...Summer Special #1 SDCC..." comps
        // (theirMarkers = ['special-1']) were being rejected outright as
        // series asymmetry against a book that genuinely IS a Special — the
        // asymmetry is an artifact of how ourMarkers was computed here, not
        // a real mismatch. The canonical target — title + issue together,
        // the confirmed identity's own full designation — does carry
        // 'special-1'. A listing marker that agrees with the CANONICAL
        // target (not just the bare title) is the match, not an asymmetric
        // sequel/spinoff; falls back to ourMarkers itself when no issue is
        // available, so every other book's asymmetry check is untouched.
        const canonicalMarkers = iss ? detectSeriesMarkers(`${title} #${iss}`) : ourMarkers;
        const beforeSeq = p.length;
        let localSequelRejected = 0;
        const sequelFiltered = p.filter((it) => {
          const theirMarkers = detectSeriesMarkers(it.title);
          for (const m of theirMarkers) {
            if (ourMarkers.includes(m)) continue;
            if (canonicalMarkers.includes(m)) {
              console.log('[sequel-filter] canonical-marker-allowed marker=' + m + ':',
                String(it.title || '').slice(0, 55));
              continue;
            }
            localSequelRejected++;
            console.log('[sequel-filter] series asymmetry detected:',
              String(it.title || '').slice(0, 55), `(marker: ${m})`);
            return false;
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
            console.log(`[comps] sequel filter: before=${beforeSeq} after=${p.length} removed=${localSequelRejected}`);
          }
        }
      } else {
        console.log('[comps] sequel filter skipped (assetType=book)');
      }

      // Filter 0c: era consistency (F2). Track B Phase 0, Commit 2 — calls
      // the extracted, exported applyEraConsistencyFilter (module scope,
      // above) instead of the previous inline block, so production and
      // this function's test invoke the identical composition (invariant
      // 10). See that function's own doc comment for the full rationale
      // (classifyYearEvidence wiring, tolerance source, volume-label
      // fallback, and the Commit-2 consumer-audit correction to the
      // wipe-out bypass — pool is no longer restored on all-rejected).
      // Session 4B — skip for books (book year = edition, spans decades),
      // enforced inside the extracted function.
      if (year && assetType !== 'book') {
        const yearNum = parseInt(String(year), 10);
        if (!isNaN(yearNum)) {
          const eraResult = applyEraConsistencyFilter(p, yearNum, assetType, cvVolumeStartYear);
          p = eraResult.pool;
          if (eraResult.bypassed) _eraFilterBypassed = true;
          _eraExcludedVariantCount += eraResult.excludedVariantCount;
          for (const s of eraResult.excludedVariantSamples) {
            if (_eraExcludedVariantSamples.length < 3) _eraExcludedVariantSamples.push(s);
          }
          _eraRejectedReferenceRows.push(...eraResult.rejectedReferenceRows);
        }
      }
      afterEra = p.length;

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
      afterReprint = p.length;

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
            const beforeV = beforeVariant.length;
            console.log(`[comps] variant filter: before=${beforeV} after=${p.length} removed=${beforeV - p.length}`);
          }
        }
      }
      afterVariant = p.length;

      // Filter 1c: variant preference (extracted to applyVariantPreferenceFilter
      // above — Q111 dispatch, 2026-07-18, Venomverse #1 class).
      // Q136 Slice A — applyArtistPreferenceNarrowing layered strictly on
      // top, never replacing this result (see its docstring above).
      {
        const varPrefResult = applyVariantPreferenceFilter(p, variant);
        const artistResult = applyArtistPreferenceNarrowing(varPrefResult, variant, artistOverride);
        p = artistResult.pool;
        if (artistResult.isolated) _premiumVariantIsolated = true;
      }

      // Filter 1d: cover-letter matching. Cover A, B, C, D are separate
      // books with separate prices — never compare across cover letters.
      //  - Our book has no variant OR is Cover A OR is just "1st print":
      //    drop any listing with Cover B/C/D/E+ in the title.
      //  - Our book has a specific cover letter (B/C/...): keep ONLY
      //    listings matching that letter; fall back to all if zero match
      //    (prefer weak comp over no comp).
      // Session 4B — SKIP for books. Cover letters are comic-only variants.
      const beforeCover = p.length;
      if (assetType !== 'book') {
        const ourVariant = String(variant || '').toLowerCase();
        const ourCoverMatch = ourVariant.match(/\b(?:cover|cvr)\s*([a-z])\b/);
        const ourCoverLetter = ourCoverMatch ? ourCoverMatch[1].toLowerCase() : null;
        const isCoverAorStandard =
          !ourVariant ||
          ourCoverLetter === 'a' ||
          ourVariant.includes('1st print') ||
          ourVariant.includes('first print');

        if (isCoverAorStandard) {
          // OTHER_COVER_RE imported from src/lib/compHygiene.js (Ship #20a.6).
          // Q108 CHANGE 3 — OTHER_VARIANT_DESCRIPTOR_RE catches named
          // non-letter variants (card stock, foil/sketch/virgin cover, trade
          // dress) that OTHER_COVER_RE's letter-only pattern misses.
          p = p.filter((item) => {
            const itemTitle = String(item.title || '');
            if (OTHER_COVER_RE.test(itemTitle)) {
              console.log('[other-cover] rejected:', itemTitle.slice(0, 50));
              return false;
            }
            if (OTHER_VARIANT_DESCRIPTOR_RE.test(itemTitle)) {
              console.log('[other-variant-descriptor] rejected:', itemTitle.slice(0, 50));
              return false;
            }
            return true;
          });
          if (p.length < beforeCover) {
            console.log(`[comps] cover-letter filter: before=${beforeCover} after=${p.length} removed=${beforeCover - p.length}`);
          }
        } else if (ourCoverLetter) {
          const OUR_COVER_RE = new RegExp(
            `\\b(?:cover|cvr)\\s*${ourCoverLetter}\\b`, 'i'
          );
          const matched = p.filter((item) => OUR_COVER_RE.test(String(item.title || '')));
          if (matched.length > 0) {
            p = matched;
            console.log(`[comps] cover-letter filter: before=${beforeCover} after=${p.length} kept=${matched.length} (cover ${ourCoverLetter})`);
          } else {
            console.log(`[comps] cover-letter filter: before=${beforeCover} after=${p.length} (no cover ${ourCoverLetter} match — keeping all)`);
          }
        }
      } else {
        console.log('[comps] cover-letter filter skipped (assetType=book)');
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
          // LOT_RE + isValidIssueRange + hasCrossSeriesSeparator imported
          // from src/lib/compHygiene.js (Ship #20a.6). Separator check added
          // Ship #20a.6.19 — catches "Brave and Bold #28 + Titans 34" class.
          // isEnumeratedIssueList added Q135 (2026-07-22, Invincible #1
          // MegaCon class) — catches a bare enumerated run ("#1 2 3 4 5
          // ...") with no "lot"/"set"/dash-range qualifier at all.
          const before = p.length;
          p = p.filter((item) => {
            const t = String(item.title || '');
            if (LOT_RE.test(t) || isValidIssueRange(t) || hasCrossSeriesSeparator(t) || isEnumeratedIssueList(t)) {
              console.log('[lot-filter] rejected:', t.slice(0, 55));
              return false;
            }
            return true;
          });
          if (p.length < before) {
            console.log(`[comps] lot filter: before=${before} after=${p.length} removed=${before - p.length}`);
          }
        }
      }
      afterLot = p.length;

      // Filter 1e2 (GL-4, EX-1b): merchandise hard filter. Prints, posters,
      // tin signs, figures, etc. pass title-overlap and issue checks but are
      // not comics — 2 merch actives ("COVER PRINT" + "Metal Tin Sign")
      // formed the entire Action #33 pool and capped a 10-sold tier-2.5
      // price at $24.62. Hard filter, no fallback: a merch listing is never
      // a valid comp regardless of pool size.
      {
        const before = p.length;
        p = p.filter((item) => {
          const t = String(item.title || '');
          if (MERCH_RE.test(t)) {
            console.log('[merch-filter] rejected:', t.slice(0, 55));
            return false;
          }
          return true;
        });
        if (p.length < before) {
          console.log(`[comps] merch filter: before=${before} after=${p.length} removed=${before - p.length}`);
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
      // Session 4B — SKIP for books. #1/2 format is comic-only.
      const beforeHalfIssue = p.length;
      if (assetType !== 'book') {
        const issueStr = String(issue || '');
        const isOurBookHalfIssue =
          issueStr.includes('/') ||
          issueStr.includes('.') ||
          issueStr.includes('½');
        if (!isOurBookHalfIssue) {
          // HALF_ISSUE_RE imported from src/lib/compHygiene.js (Ship #20a.6).
          p = p.filter((item) => {
            const t = String(item.title || '');
            if (HALF_ISSUE_RE.test(t)) {
              console.log('[half-issue] rejected:', t.slice(0, 50));
              return false;
            }
            return true;
          });
          if (p.length < beforeHalfIssue) {
            console.log(`[comps] half-issue filter: before=${beforeHalfIssue} after=${p.length} removed=${beforeHalfIssue - p.length}`);
          }
        }
      } else {
        console.log('[comps] half-issue filter skipped (assetType=book)');
      }

      // Filter 1g: TPB / collected-edition format match. ARROW 2 of the
      // TPB fix. When our title contains a TPB marker (tpb, hardcover,
      // omnibus, compendium, collected edition, etc.), require comp
      // listing titles to also contain a TPB marker — otherwise floppy
      // single issues poison the avg (e.g. Batman vs Predator Collected
      // Edition was getting $8.97 floppy avg vs ~$30 real TPB market).
      // Graceful fallback to keeping all if zero TPB-format matches.
      // Session 4B — SKIP for books. HC/PB markers in book titles trigger
      // comic TPB logic incorrectly.
      const beforeTPB = p.length;
      if (assetType !== 'book' && isTPB && p.length > 0) {
        // GrailKey Commit R (R1) — investigated, deliberately NOT migrated.
        // isTPB is now trustworthy (Q1b — derived from OUR OWN title via
        // IDENTITY_TPB_MARKER_RE), so this branch only ever runs when we
        // genuinely ARE scanning a collected edition. Requiring comp
        // titles to match the LOOSER marker set here is intentional —
        // sellers describe TPBs/omnibuses/hardcovers more loosely than a
        // strict identity check needs to. Residual finding, out of scope
        // for R1 (not named in the dispatch): for an Absolute-line
        // collected edition specifically (e.g. our book is genuinely
        // "Absolute Batman: The Zoo [Hardcover] #1"), this loose match
        // ALSO admits plain floppy "Absolute Batman #N" comps into what
        // should be a hardcover-only pool, since every comp in the
        // Absolute line matches TPB_MARKER_RE's bare "absolute"
        // alternative regardless of format — the mirror image of the R1
        // bug on the require-marker side rather than the exclude side.
        // Flagged for a future commit, not fixed here.
        const tpbFiltered = p.filter((item) => TPB_MARKER_RE.test(String(item.title || '')));
        if (tpbFiltered.length > 0) {
          console.log(`[comps] tpb-format filter: before=${beforeTPB} after=${tpbFiltered.length} kept=${tpbFiltered.length} (marker required)`);
          p = tpbFiltered;
        } else {
          console.log(`[comps] tpb-format filter: before=${beforeTPB} after=${p.length} (0 TPB matches — keeping all)`);
        }
      } else if (assetType !== 'book' && !isTPB && p.length > 0) {
        // Q135 dispatch (2026-07-22, Invincible #1 MegaCon class) — mirror
        // image of the branch above, a pre-existing gap: our book is a
        // single issue, not a collected edition, but nothing ever rejected
        // an OMNIBUS/HC/collected-edition comp from a single-issue pool —
        // the require-marker branch above only ever engages when isTPB is
        // true. Real production case: "invincible #1 2026" matched a
        // Battle Beast omnibus alongside genuine single-issue comps.
        // Graceful fallback (same convention as every other filter here):
        // if EVERY comp happens to be a TPB-marked listing, keep them all
        // rather than starve the pool to zero.
        //
        // GrailKey Commit R (R1, 2026-08-03) — IDENTITY_TPB_MARKER_RE, not
        // TPB_MARKER_RE. Reported and confirmed before changing (per
        // instruction): migrating this ONE site fully closes the gap —
        // the graceful-fallback-to-keep-all condition itself needs no
        // separate handling. It was never broken on its own; it was being
        // fed a garbage classification. TPB_MARKER_RE's bare "absolute"
        // alternative matched every "Absolute Batman" comp regardless of
        // format, so nonTpbFiltered was ALWAYS empty for that book — the
        // fallback fired on effectively every request, silently admitting
        // hardcovers/omnibuses it exists to exclude. With
        // IDENTITY_TPB_MARKER_RE, a genuine floppy no longer matches (test
        // becomes accurate), so nonTpbFiltered correctly contains the real
        // floppies and the fallback only engages in its intended rare
        // case — a pool that is genuinely 100% collected-edition listings
        // with zero floppies to fall back to.
        const nonTpbFiltered = p.filter((item) => !IDENTITY_TPB_MARKER_RE.test(String(item.title || '')));
        if (nonTpbFiltered.length > 0) {
          console.log(`[comps] non-tpb-format filter: before=${beforeTPB} after=${nonTpbFiltered.length} removed=${beforeTPB - nonTpbFiltered.length} (rejecting omnibus/hc/collected-edition for single-issue book)`);
          p = nonTpbFiltered;
        } else {
          console.log(`[comps] non-tpb-format filter: before=${beforeTPB} after=${p.length} (all comps TPB-marked — keeping all, graceful fallback)`);
        }
      } else if (assetType === 'book') {
        console.log('[comps] tpb-format filter skipped (assetType=book)');
      }

      // Filter 1h: Trading card / non-comic format. Ship #20a.6.20 parity
      // with sold Filter 3b. Avengers #20 class — reject card products from
      // active pool (Fleer Ultra, Upper Deck, etc.).
      {
        const before = p.length;
        p = p.filter((item) => !TRADING_CARD_RE.test(String(item.title || '')));
        if (p.length < before) {
          console.log(`[comps] trading-card filter: before=${before} after=${p.length} removed=${before - p.length}`);
        }
      }

      // Filter 2: raw-vs-graded title separation.
      // Session 4B — SKIP for books. CGC/CBCS slabbing is comic/card-only.
      const beforeSlab = p.length;
      if (assetType !== 'book') {
        if (rawOnly) {
          p = p.filter((it) => !SLAB_RE.test(String(it.title || "")));
          if (p.length < beforeSlab) {
            console.log(`[comps] slab filter: before=${beforeSlab} after=${p.length} removed=${beforeSlab - p.length}`);
          }
        } else if (gradedOnly) {
          p = p.filter((it) => GRADED_RE.test(String(it.title || "")));
          if (p.length < beforeSlab) {
            console.log(`[comps] non-graded filter: before=${beforeSlab} after=${p.length} removed=${beforeSlab - p.length}`);
          }
        }
      } else {
        console.log('[comps] slab filter skipped (assetType=book)');
      }

      // Ship #13 Bug 3 / Slice C (Filter 2b): signed as a match dimension.
      // See applySignedPreferenceFilter's docstring above for the full
      // reasoning. isOurBookSigned checks three independently-sourced
      // signals — "Vision or pool" per the design ruling: (1)
      // confirmedLabelType==='signature' (CGC/CBCS SS yellow label, the
      // graded case), (2) signedConsensus (Slice C — pool-corroborated, the
      // ONLY source for a raw signed book, since Vision's own comic prompt
      // is barred from writing signing status into variant text), (3) the
      // pre-existing regex on variant text (Vision's own free-text call,
      // when present).
      {
        const ourVariantStr = String(variant || '').toLowerCase();
        const isOurBookSigned =
          labelType === 'signature' ||
          signedConsensus === true ||
          /\b(?:signed|signature|autograph(?:ed)?|\bauto\b|remarked?|yellow\s*label|green\s*label)\b/.test(ourVariantStr);
        const signedResult = applySignedPreferenceFilter(p, isOurBookSigned);
        p = signedResult.pool;
        _signedRejected += signedResult.signedRejectedCount;
      }

      // Ship #20a.6.11 Filter 2c: coverless / incomplete / no-cover filter.
      // Books with missing covers poison comps (Sensation #1 Crowley 9.4 case
      // where "Sensation Comics #11 CGC-NG COVERLESS" set floor at $1,250).
      // Hard-reject unless our book is also coverless (which never happens in
      // the standard grading flow).
      // Session 4B — SKIP for books. Coverless = comic-specific defect.
      const beforeCoverless = p.length;
      if (assetType !== 'book') {
        p = p.filter((it) => {
          if (COVERLESS_RE.test(String(it.title || ''))) {
            console.log('[coverless-filter] rejected:',
              String(it.title || '').slice(0, 55));
            return false;
          }
          return true;
        });
        if (p.length < beforeCoverless) {
          console.log(`[comps] coverless filter: before=${beforeCoverless} after=${p.length} removed=${beforeCoverless - p.length}`);
        }
      } else {
        console.log('[comps] coverless filter skipped (assetType=book)');
      }

      // Filter 3: ±1.5 grade proximity.
      // Fix C (Phase 1): track grade-filtered pool for floor calculation.
      // When grade filter would remove all comps, we fall back to full pool
      // for pricing (to avoid refusing to price), but we still track the
      // grade-filtered minimum for floor guard use. This prevents VG 4.0 books
      // from anchoring floor to FR 1.0 listings.
      const beforeGrade = p.length;
      let gradeFilteredPrices = null;
      if (p.length > 0 && numericTarget != null && !isNaN(numericTarget)) {
        const filtered = p.filter((it) => {
          const listingGrade = parseListingGrade(it.title);

          // Fix C (Phase 2): Fair/Poor label filter.
          // When parseListingGrade returns null (no numeric grade found),
          // check for Fair/Poor/FR/PR text labels. These listings represent
          // low-grade books that would poison the floor for VG+ books.
          // Prevents VG 4.0 books from anchoring to Fair/Poor listings.
          if (listingGrade === null) {
            const titleStr = String(it.title || '');
            if (/\b(FR|PR|Fair|Poor)\b/i.test(titleStr)) {
              console.log('[grade-filter] rejected (Fair/Poor label):',
                titleStr.slice(0, 50));
              return false;
            }
            // Q47-QUAL: qualitative low-grade phrases ("reading copy", "low
            // grade", "coverless", etc.) — positive evidence only, same
            // dictionary + ±1.5 tolerance as soldVerification.js. No match
            // falls through to the unchanged keep-by-default below.
            const qualCeiling = getQualitativeGradeCeiling(titleStr);
            if (qualCeiling != null && Math.abs(numericTarget - qualCeiling) > 1.5) {
              console.log('[grade-filter] rejected (qualitative phrase):',
                titleStr.slice(0, 50), 'implied ceiling:', qualCeiling, 'vs our:', numericTarget);
              return false;
            }
            return true;
          }

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
          console.log(`[comps] grade-proximity filter: before=${beforeGrade} after=${filtered.length} removed=${beforeGrade - filtered.length} (±1.5 from ${numericTarget})`);
          p = filtered;
          // Snapshot grade-filtered prices for floor calculation
          gradeFilteredPrices = filtered.map(item => item.price).filter(price => typeof price === 'number' && price > 0);
        } else {
          console.log(`[comps] grade-proximity filter: before=${beforeGrade} after=${beforeGrade} (fallback — all rejected, keeping all)`);
          _fellBack = true;
          // Even when falling back, track what the grade-filtered pool would have been
          // (empty in this case, so floor guard will skip)
          gradeFilteredPrices = [];
        }
      } else {
        console.log(`[comps] grade-proximity filter skipped (${p.length === 0 ? 'pool empty before filter' : isNaN(numericTarget) ? 'no numeric grade' : 'unknown'}: numericTarget=${numericTarget})`);
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
      const beforeCreator = p.length;
      if (!variant && creator && p.length > 0) {
        const creatorLower = String(creator).toLowerCase().trim();
        if (creatorLower.length >= 3) {
          const creatorMatches = p.filter((it) => {
            const t = String(it.title || '').toLowerCase();
            if (VARIANT_CONTAM_RE.test(t)) return false;
            return t.includes(creatorLower);
          });
          if (creatorMatches.length >= 2) {
            console.log(`[comps] creator-preference filter: before=${beforeCreator} after=${creatorMatches.length} kept=${creatorMatches.length} (creator "${creator}")`);
            p = creatorMatches;
          } else {
            console.log(`[comps] creator-preference filter: before=${beforeCreator} after=${p.length} (only ${creatorMatches.length} match — keeping all)`);
          }
        }
      }

      // Filter 4: median-based price sanity.
      {
        const before = p.length;
        p = applyPriceSanity(p);
        if (p.length < before) {
          console.log(`[comps] price-sanity filter: before=${before} after=${p.length} removed=${before - p.length}`);
        }
      }
      afterSanity = p.length;

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
          console.log(`[comps] dedup filter: before=${before} after=${p.length} removed=${before - p.length}`);
        }
      }

      // Session 4B — Survivor trace (diagnose book comp over-filtering)
      console.log(`[comps] survivors: afterTitle=${afterTitle} afterEra=${afterEra} afterReprint=${afterReprint} afterVariant=${afterVariant} afterLot=${afterLot} afterSanity=${afterSanity} final=${p.length}`);

      // Q129 dispatch — detectVariantCompsExcludedByEra (compHygiene.js)
      // only flags when the final priced pool does NOT itself carry a
      // named variant descriptor. Checked against the pool as it stands
      // after every filter, not just post-era, since a later filter could
      // in principle also thin it further.
      const _variantCompsExcludedByEra = detectVariantCompsExcludedByEra(
        _eraExcludedVariantCount,
        _eraExcludedVariantSamples,
        p.map((it) => it.title)
      );
      if (_variantCompsExcludedByEra) {
        console.log(
          `[era-filter] variant-descriptor gap: ${_eraExcludedVariantCount} era-excluded ` +
          `listing(s) named a specific cover variant, but the final priced pool ` +
          `(${p.length} comp(s)) does not — price reflects a different, unnamed/generic ` +
          `printing, not the specific variant those excluded listings described`
        );
      }

      return {
        parsed: p,
        gradeFilteredPrices,  // Fix C: grade-proximity filtered prices for floor calc
        reprintFallback: _reprintFallback,
        variantFallback: _variantFallback,
        premiumVariantIsolated: _premiumVariantIsolated,
        fellBack: _fellBack,
        eraFilterBypassed: _eraFilterBypassed,
        eraRejectedReferenceRows: _eraRejectedReferenceRows,
        variantCompsExcludedByEra: _variantCompsExcludedByEra,
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
        raw = await tryBrowse({ appId, certId, query, categoryId, assetType });
      }
      const rawCount = raw ? raw.length : 0;
      console.log(`[comps] attempt ${attempt.n} query="${query}" raw=${rawCount}`);
      if (rawCount === 0) continue;

      const filtered = applyFilterChain(raw);
      console.log(`[comps] attempt ${attempt.n} post-filter=${filtered.parsed.length}`);

      // Ship v0-I — collect raw candidates when post-filter=0 for era-filter fallback
      if (filtered.parsed.length === 0 && raw.length > 0) {
        rawCandidates.push({ raw, attempt, filtered });
      }

      if (filtered.parsed.length > 0) {
        // Issue verification: when searching for a specific issue, ensure at least
        // one comp actually has the correct issue number before accepting the pool.
        // Prevents broader queries (attempt 3: "title year", attempt 4: "title only")
        // from returning wrong-issue comps that survive other filters.
        if (iss) {
          const issueRe = new RegExp(`#\\s*${iss}\\b`, 'i');
          const hasCorrectIssue = filtered.parsed.some((p) =>
            issueRe.test(String(p.title || ''))
          );
          if (!hasCorrectIssue) {
            if (i < uniqueAttempts.length - 1) {
              console.log(`[comps] attempt ${attempt.n} no #${iss} match — continuing`);
              continue;
            } else {
              console.log(`[comps] all attempts exhausted, no #${iss} match — returning empty`);
              parsed = [];
              break;
            }
          }
        }
        parsed = filtered.parsed;
        gradeFilteredPrices = filtered.gradeFilteredPrices;  // Fix C: plumb through
        reprintFallback = filtered.reprintFallback;
        variantFallback = filtered.variantFallback;
        premiumVariantIsolated = filtered.premiumVariantIsolated;
        fellBack = filtered.fellBack;
        eraFilterBypassed = filtered.eraFilterBypassed;
        eraRejectedReferenceRows = filtered.eraRejectedReferenceRows || [];
        variantCompsExcludedByEra = filtered.variantCompsExcludedByEra;
        multiIssueRejected = filtered.multiIssueRejected;
        sequelRejected = filtered.sequelRejected;
        signedRejected = filtered.signedRejected;
        attemptUsed = attempt.n;
        attemptLabel = attempt.label || null;
        // GrailKey Directive O — explicit winner log. Previously the
        // winning attempt was only inferable from the last non-empty
        // "[comps] attempt N ... post-filter=" pair before the loop
        // stopped logging; this states it directly so a production log
        // shows which query produced the priced pool without inference.
        console.log(
          `[comps-ladder] winner: attempt ${attempt.n}${attempt.label ? ` (${attempt.label})` : ''} ` +
          `query="${query}" — ${filtered.parsed.length} survivor(s)`
        );
        break;
      }
      if (i < uniqueAttempts.length - 1) {
        console.log(`[comps] attempt ${attempt.n} post-filter empty, trying next`);
      }
    }

    // Ship v0-I — era-filter fallback for vintage books.
    //
    // When all 6 attempts return post-filter=0 for pre-1970 books, the era
    // filter likely rejected every listing because sellers omitted the year
    // (e.g., "Yellow Claw #1 Jimmy Woo 1st Appearance"). Without this fallback,
    // legitimate vintage books refuse to price due to reprint-contamination
    // paranoia. We collect the best raw candidate, apply a reprint guardrail
    // reject list, validate title/issue match, and surface with LOW confidence.
    //
    // Guardrail: reject listings with explicit reprint markers to prevent
    // modern reprints from poisoning the pool (the original era-filter goal).
    if (parsed.length === 0 && rawCandidates.length > 0 && year) {
      const yearNum = parseInt(String(year), 10);
      if (!isNaN(yearNum) && yearNum < 1970) {
        console.log(`[v0-I] era-filter fallback: ${rawCandidates.length} attempts had raw results`);

        // Find best raw candidate (most raw results)
        const bestCandidate = rawCandidates.reduce((best, curr) =>
          curr.raw.length > best.raw.length ? curr : best
        );

        console.log(`[v0-I] best candidate: attempt ${bestCandidate.attempt.n}, ${bestCandidate.raw.length} raw results`);

        // Reprint guardrail: explicit reject list
        const REPRINT_GUARDRAIL_RE = /\b(reprint|facsimile|replica|cover\s+only|full\s+color\s+reprint|modern\s+reprint|commemorative|tribute|reproduction|poster|lot|bundle|mystery)\b/i;

        let guardedPool = bestCandidate.raw.filter((item) => {
          const titleStr = String(item.title || '');
          if (REPRINT_GUARDRAIL_RE.test(titleStr)) {
            console.log('[v0-I] guardrail rejected:', titleStr.slice(0, 60));
            return false;
          }
          return true;
        });

        console.log(`[v0-I] after guardrail: ${guardedPool.length}/${bestCandidate.raw.length} survived`);

        if (guardedPool.length === 0) {
          console.log('[v0-I] guardrail rejected all — returning empty');
          return { ...emptyComps(bestCandidate.attempt.q, "no sales after filters"), attemptUsed: 0 };
        }

        // Q141: raw-vs-graded title separation — same Filter 2 rule every
        // formal attempt already applies (SLAB_RE for a raw copy, GRADED_RE
        // for a graded copy), never previously applied inside this fallback
        // chain. Without it a slabbed listing that survives the guardrail
        // can become the pool's sole comp and set the price/floor for a raw
        // book (Batman #15 production case: the only active comp reaching
        // pricing was a "CGC 0.5" slab priced against a raw GD 2.0 scan).
        {
          const beforeV0ISlab = guardedPool.length;
          guardedPool = applyRawGradedSeparationFilter(guardedPool, { rawOnly, gradedOnly, assetType });
          if (guardedPool.length < beforeV0ISlab) {
            console.log(`[v0-I] slab filter: before=${beforeV0ISlab} after=${guardedPool.length} removed=${beforeV0ISlab - guardedPool.length}`);
          }

          if (guardedPool.length === 0) {
            console.log('[v0-I] slab filter rejected all — returning empty');
            return { ...emptyComps(bestCandidate.attempt.q, "no sales after filters"), attemptUsed: 0 };
          }
        }

        // Title token match: require sufficient overlap with search title
        const titleTokens = searchTokens; // already computed at function top
        guardedPool = guardedPool.filter((item) => {
          const titleStr = String(item.title || '').toLowerCase();
          const matched = titleTokens.filter(t => titleStr.includes(t)).length;
          const overlap = titleTokens.length > 0 ? matched / titleTokens.length : 0;
          if (overlap < 0.5) {
            console.log('[v0-I] title-mismatch:', titleStr.slice(0, 60));
            return false;
          }
          return true;
        });

        console.log(`[v0-I] after title-match: ${guardedPool.length} survived`);

        if (guardedPool.length === 0) {
          console.log('[v0-I] title-match rejected all — returning empty');
          return { ...emptyComps(bestCandidate.attempt.q, "no sales after filters"), attemptUsed: 0 };
        }

        // Issue match: require correct issue number if we're searching for one
        if (iss) {
          const issueRe = new RegExp(`#\\s*${iss}\\b`, 'i');
          guardedPool = guardedPool.filter((item) => {
            const titleStr = String(item.title || '');
            if (!issueRe.test(titleStr)) {
              console.log('[v0-I] issue-mismatch:', titleStr.slice(0, 60));
              return false;
            }
            return true;
          });

          console.log(`[v0-I] after issue-match: ${guardedPool.length} survived`);

          if (guardedPool.length === 0) {
            console.log('[v0-I] issue-match rejected all — returning empty');
            return { ...emptyComps(bestCandidate.attempt.q, "no sales after filters"), attemptUsed: 0 };
          }
        }

        // No explicit conflicting year: reject listings with years that are
        // WAY outside tolerance (>20 years off). Prevents Action Comics #1 (1938)
        // from matching Action Comics #1 (2011 relaunch).
        const extractYear = (t) => {
          const m = String(t).match(/\(?(19\d{2}|20\d{2})\)?/);
          return m ? parseInt(m[1], 10) : null;
        };

        guardedPool = guardedPool.filter((item) => {
          const titleStr = String(item.title || '');
          const ly = extractYear(titleStr);
          if (ly == null) return true; // no year in title = pass (the whole point of v0-I)
          const diff = Math.abs(ly - yearNum);
          if (diff > 20) {
            console.log('[v0-I] conflicting-year:', titleStr.slice(0, 60), `(${ly} vs ${yearNum})`);
            return false;
          }
          return true;
        });

        console.log(`[v0-I] after year-conflict check: ${guardedPool.length} survived`);

        if (guardedPool.length === 0) {
          console.log('[v0-I] year-conflict rejected all — returning empty');
          return { ...emptyComps(bestCandidate.attempt.q, "no sales after filters"), attemptUsed: 0 };
        }

        // Success: use guarded pool with eraFilterBypassed flag
        console.log(`[v0-I] SUCCESS: ${guardedPool.length} comps survived guardrail`);
        parsed = guardedPool;
        eraFilterBypassed = true;
        attemptUsed = bestCandidate.attempt.n;
        attemptLabel = bestCandidate.attempt.label || 'vintage-year-missing';
        query = bestCandidate.attempt.q;
      }
    }

    if (parsed.length === 0) {
      return { ...emptyComps(query, "no sales after filters"), attemptUsed: 0 };
    }

    // D1 — evidence-eligibility classification (Commit D1). Independent,
    // additional gate downstream of the ENTIRE existing filter/fallback
    // chain — `parsed` here is whatever the formal per-attempt path OR
    // the v0-I emergency fallback produced, so this single insertion
    // point covers both without separate wiring (Commit D Fixture 4: a
    // slab admitted by v0-I still can't re-enter here). Catches what
    // neither has a detector for at all (incomplete-copy, restored-copy)
    // and re-derives raw-vs-graded eligibility via GRADED_RE (broader,
    // order-independent) rather than SLAB_RE (misses "2.5 Cgc ..."
    // orderings — Commit D Fixture 2). Never widens `parsed` — only
    // narrows it further; a row already excluded upstream never reappears.
    const evidenceTarget = {
      issue: issueNum,
      seriesTitle: title,
      confirmedYear: year ? parseInt(year, 10) : null,
      cvVolumeStartYear,
      variant,
      publisher,  // Commit D1.1 — collision-risk assessment (assessCollisionRisk)
      isGraded: gradedOnly === true,
      userGradeKey: rawOnly ? 'raw' : (gradedOnly ? 'graded' : null),
      assetType: isTPB ? 'tpb' : 'comic',
      isSignedTarget: SIGNED_RE.test(String(variant || '')),
      issueAuthorityPresent,  // Track B Phase 0, Commit 4 (presence-threading correction) — TARGET_ISSUE_PROVISIONAL_AUTHORITY gate
      issueAuthorityStatus,  // Track B Phase 0, Commit 4 — TARGET_ISSUE_PROVISIONAL_AUTHORITY gate
    };
    // GrailKey Dispatch 25 (2026-08-07), Fix 1 STEP 1 — instrumentation
    // ONLY. Logs the exact population classifyEvidenceRow measures every
    // row against, once, so it's printed rather than inferred from
    // upstream state. issueAuthorityPresent/issueAuthorityStatus included
    // beyond the requested format's five fields — directly relevant to
    // the repro's hypothesis test (does TARGET_ISSUE_PROVISIONAL_AUTHORITY
    // fire) and already threaded onto evidenceTarget two lines above.
    console.log(
      `[evidence-target] seriesTitle="${evidenceTarget.seriesTitle ?? ''}" issue="${evidenceTarget.issue ?? ''}" ` +
      `variant="${evidenceTarget.variant ?? ''}" year="${evidenceTarget.confirmedYear ?? ''}" grade="${grade ?? ''}" ` +
      `issueAuthorityPresent=${evidenceTarget.issueAuthorityPresent} issueAuthorityStatus="${evidenceTarget.issueAuthorityStatus ?? ''}"`
    );
    const evidenceRows = parsed.map((it) => ({ ...it, marketState: 'active' }));
    // Full classification — powers the display/reference buckets below
    // (evidence.gradedPricingReferences/incompleteReferences/
    // incompatibleEditionReferences/rejectedEvidence). Every mismatch
    // category gets annotated (I13), regardless of whether it additionally
    // excludes the row from pricing math (narrower — see below).
    const evidencePopulations = buildEvidencePopulations(evidenceRows, evidenceTarget);
    // Track B Phase 0, Commit 4 (review-round structural upgrade) — built
    // once, immediately after evidencePopulations, via the exported,
    // enumeration-driven buildEvidenceForResponse (evidenceEligibility.js —
    // see that function's own doc comment) rather than a hand-maintained
    // object literal, so BOTH the zero-eligible early return just below AND
    // the success-path return further down attach the IDENTICAL, COMPLETE
    // evidence shape. Previously only the success path attached `evidence`
    // at all — the zero-eligible early return (`rawPricingEligibleRows.length
    // === 0`) returned a bare `emptyComps(...)` with no evidence field
    // whatsoever, silently dropping every reference-only row (including
    // this commit's own provisionalAuthorityReferences) in exactly the case
    // where ALL rows in the pool were demoted to reference-only — e.g. a
    // pool made ENTIRELY of rows matching a marketplace-only-adopted,
    // not-yet-corroborated issue number. A hand-maintained object literal
    // was the exact defect class that produced this omission (and, before
    // it, the longer-standing omission of similarTitleReferences from
    // EITHER return site) — the exported EVIDENCE_RESPONSE_BUCKETS
    // enumeration prevents the class, not just the one instance already
    // found. Scope: this fix touches only the one early-return site
    // downstream of evidencePopulations in THIS function; it does not
    // attempt the broader "evidence attached at every early return in this
    // file" audit (Commit 2's own already-queued item, see Section 2/16 —
    // several earlier early returns in this function, e.g.
    // `parsed.length === 0` above, fire BEFORE evidencePopulations is even
    // computed and are unaffected by, and out of scope for, this fix).
    const evidenceForResponse = buildEvidenceForResponse(evidencePopulations, eraRejectedReferenceRows);
    // Pricing-math gate — narrower than evidencePopulations.rawPricingPool.
    // `parsed` here already survived the ENTIRE formal filter chain (era/
    // reprint/variant/lot/tpb/slab/signed/grade-proximity/price-sanity/
    // dedup) or the thinner v0-I emergency chain — re-checking
    // identity/variant/printing/lot with a second, less nuanced classifier
    // on top of that risks double-jeopardy false rejects the same way it
    // did in soldVerification.js (see PRICING_GATE_CODES doc comment,
    // evidenceEligibility.js). Only the codes with no prior detector at
    // all, or a proven gap in one, may additionally narrow `parsed`.
    // Track B Phase 0, Commit 1 — calls the exported buildPricingEligibleRows
    // directly (was an inline `evidenceRows.filter((it) =>
    // isPricingMathEligible(classifyEvidenceRow(it, evidenceTarget)))`),
    // so this call site and its test invoke the identical composition.
    const rawPricingEligibleRows = buildPricingEligibleRows(evidenceRows, evidenceTarget);
    if (rawPricingEligibleRows.length === 0) {
      console.log(
        `[evidence-eligibility] active: classification eliminated all ` +
        `${parsed.length} pre-classification survivor(s) — returning empty ` +
        `pricing pool, evidence preserved (never re-admitting rejected/` +
        `reference-only evidence into pricing, never silently dropping it either)`
      );
      // Track B Phase 0, Commit 4 (review-round fix) — evidence attached
      // even on this zero-eligible path (was previously dropped entirely
      // by the bare emptyComps() spread). See evidenceForResponse's own
      // comment above for the exact scope of this fix.
      return { ...emptyComps(query, "no pricing-eligible comps after evidence classification"), attemptUsed: 0, evidence: evidenceForResponse };
    }
    console.log(
      `[evidence-eligibility] activeInput=${parsed.length} ` +
      `rawPricingEligible=${rawPricingEligibleRows.length} ` +
      `gradedReferences=${evidencePopulations.gradedPricingReferences.length} ` +
      `incompleteReferences=${evidencePopulations.incompleteReferences.length} ` +
      `unconfirmedEditionReferences=${evidencePopulations.unconfirmedEditionReferences.length} ` +
      `rejected=${evidencePopulations.incompatibleEditionReferences.length + evidencePopulations.rejectedEvidence.length} ` +
      `codes=${JSON.stringify(evidencePopulations.rejectionCodeCounts)}`
    );
    parsed = rawPricingEligibleRows;

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

    // Fix C (Phase 1): calculate grade-filtered lowest for floor guard.
    // When grade-proximity filter ran, gradeFilteredPrices holds the
    // prices from items within ±1.5 grades. Use this for floor calculation
    // instead of global lowest to prevent VG 4.0 books from anchoring to
    // FR 1.0 listings.
    const gradeFilteredLowest =
      Array.isArray(gradeFilteredPrices) && gradeFilteredPrices.length > 0
        ? Math.min(...gradeFilteredPrices)
        : null;

    return {
      count: parsed.length,
      prices: parsed,
      recentSales,
      average,
      averageFormatted: formatUsd(average),
      lowest,
      lowestFormatted: formatUsd(lowest),
      gradeFilteredLowest,  // Fix C: grade-aware floor minimum
      highest,
      highestFormatted: formatUsd(highest),
      lastSoldDate,
      lastSoldDateFormatted: formatDate(lastSoldDate),
      query,
      fellBack,
      reprintFallback,
      variantFallback,
      premiumVariantIsolated,
      eraFilterBypassed,
      variantCompsExcludedByEra,
      artistFallback,
      compBasis: artistFallback ? 'generic-variant-fallback' : null,
      multiIssueRejected,
      sequelRejected,
      signedRejected,
      attemptUsed,
      attemptLabel,
      source,
      // D1 — sanitized reference groups (never the pricing-eligible pool
      // itself, which is `prices`/`count`/`average`/`lowest`/`highest`
      // above, already narrowed to rawPricingPool). Display-only, I13.
      // Track B Phase 0, Commit 4 (review-round fix) — the same
      // evidenceForResponse object the zero-eligible early return above
      // now also attaches, so both paths carry an identical evidence
      // shape (including provisionalAuthorityReferences) rather than two
      // independently-maintained copies that could drift.
      evidence: evidenceForResponse,
    };
  } catch (err) {
    console.error(`[comps] error: ${err?.message || err}`);
    return { ...emptyComps(query || cleanTitle, err?.message || "fetch failed", true), attemptUsed: 0 };
  }
};

// A3 ACCESS GATE: T1 invite mechanism
function checkAccessGate(req) {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) return null; // Gate disabled when env var not set
  const clientKey = req.headers['x-vault-key']?.trim();

  // DIAGNOSTIC: Log comparison without exposing full value
  const match = clientKey === accessCode;
  console.log(`[access] received_len=${clientKey?.length ?? 0} expected_len=${accessCode?.length ?? 0} match=${match}`);

  if (!match) {
    return { error: 'Access denied. Contact the vault administrator for an access code.', status: 401 };
  }
  return null;
}

export default async function handler(req, res) {
  // A3 ACCESS GATE: T1 invite mechanism
  const gateError = checkAccessGate(req);
  if (gateError) {
    return res.status(gateError.status).json({ error: gateError.error });
  }

  // A4 RATE LIMIT: 30 scans / 10 min per key+IP
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

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

    // FIX 3 — KV cache check before eBay call
    const cacheKey = `comps:${title}:${issue || 'null'}:${grade || 'null'}`;
    const cached = await kvGet(`bc:${cacheKey}`);
    if (cached) {
      return res.status(200).json(cached);
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

    // FIX 3 — Cache successful result
    await kvSet(`bc:${cacheKey}`, comps, KV_TTL.BROWSE);

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
