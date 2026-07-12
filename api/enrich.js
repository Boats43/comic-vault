// POST /api/enrich
//
// Second-pass enrichment. Fires ComicVine, eBay comps, and the
// Ximilar image fallback in parallel and returns everything together. The
// client displays the Claude /api/grade result immediately and merges this
// payload into the card when it resolves.
//
// Request body: { title, grade, confidence?, images? }
// Response: { comicVine?, comps?, ximilar?, price?, priceLow?,
//             priceHigh?, keyIssue?, identifiedBy? }

import Anthropic from "@anthropic-ai/sdk";
import {
  fetchComps,
  getOAuthToken,
  computeMatchConfidence,
  cleanPublisher,
  VARIANT_CONTAM_RE,
  REPRINT_RE,
} from "./comps.js";
import {
  fmtUsd,
  median,
  computeThinPoolAnchor,
  computeSanityFallback,
  computeLowGradeFloor,
  getEra,
  enforceFloor,
  enforceFloorWithCap,
} from "../src/lib/pricingEngine.js";
import {
  calculateTitleOverlap,
  resolveIdentity,
  resolveIssue,
  backfillFromComps,
  resolveYear,
  checkAssemblyIntegrity,
} from "../src/lib/identityCore.js";
// Ship #24 — canonical response contract. finalizeResponse must be the LAST
// call before res.json() on every substantive exit; nothing writes
// price/decision fields after it.
import { finalizeResponse } from "../src/lib/responseContract.js";
import {
  verifyStory,
  detectKeyValue,
  computeEraRisk,
  cleanTitleForComicVine,
  sanitizeComicTitle,
  PUBLISHER_IN_TITLE_SERIES,
  CREATOR_NOISE_RE,
  PUBLISHER_FILLER_RE,
  LISTING_LANGUAGE_RE,
} from "../src/adapters/ComicAdapter.js";
// Ship #20a.6 — sold comp verification (pure regex, no I/O). Replaces the
// single #issue regex filter with full hygiene chain. See
// src/lib/soldVerification.js for filter list + diagnostics shape.
import {
  verifySoldComps,
  capRawSoldRows,
} from "../src/lib/soldVerification.js";
import { fetchSold } from "./sold.js";
import { lookupCGC } from "./cgc-lookup.js";
// Q25 FIX — GoCollect removed. 100% timeout rate (4.5s tax, zero successful
// returns across all sessions). API key #019483 status unknown, but evidence
// confirms dead integration. Recover 4.5s per scan by removing the call.
// import { lookupGoCollect } from "./gocollect.js";
import {
  fetchPricechartingPop,
  fetchPricechartingSales,
} from "./pricecharting-pop.js";
import {
  MEGA_KEYS_SCHEMA_VERSION,
  getMegaKeyEntry,
  getMegaKeyFloor,
  normalizeTitle,
} from "./mega-keys.js";
import { extractCreatorsFromComps } from "../src/lib/premiumCreators.js";
import { extractIssueFromEbayResults } from "../src/lib/identityAlignment.js";
// Ship #20a.6.4 — refuse-to-price gate. Sanitizes Vision identity fields
// and refuses to produce a price when title/issue/year/publisher can't
// be cleanly extracted (or Vision self-reports low confidence). See
// src/lib/identityGate.js for sanitizer + assessor.
import {
  sanitizeIdentityFields,
  assessIdentityConfidence,
} from "../src/lib/identityGate.js";
// Ship v0-B — Decision Engine integration. Computes accountable decision
// (LIST_NOW, RESEARCH, ID_REQUIRED, etc.) after full enrich object assembled.
import { computeDecision } from "../src/lib/decisionEngine.js";
import { extractIdentityFromImageSearch, extractConsensus, selectTitleFamilyCandidate, inferAssetTypeFromCategories } from "../src/lib/imageSearchIdentity.js";
// Session 4A — Universal category filter (pre-clustering)
import { filterByCategory } from "../src/lib/categoryClassifier.js";
// Session 4B — Adapter registry (per-asset routing config)
import { getAdapter } from "../src/adapters/adapterRegistry.js";
// Ship #20b — price bands engine (verified sold-first pricing).
import { computePriceBands as computePriceBandsFromSold, enforceFloor as enforceFloorFromBands } from "../src/lib/priceBands.js";
// Ship #21 — demand signals from sales data.
import { computeDemandSignals } from "../src/lib/demandSignals.js";
// C5 — parseListingGrade for lone-sold anchor.
import { parseListingGrade } from "../src/lib/compHygiene.js";
// Ship #21 — Claude Haiku quality check.
import { runClaudeCheck } from "../src/lib/claudeCheck.js";
// Ship #20a.6.18 — variant identity engine (modern variant consensus from
// eBay image search). Overrides Vision variant field when ≥2 eBay listings
// agree on specific tokens (convention, artist, exclusive, limitation).
import { extractConfirmedVariant } from "../src/lib/variantIdentity.js";
// Ship #1.3 — edition warning detection (reprint/facsimile/later-print gates).
import { detectEditionWarning } from "./grade.js";
// Session 4B — Import book signal detection from shared classifier
import { detectBookSignals } from "../src/lib/categoryClassifier.js";
// FIX 3 — Vercel KV persistent cache (replaces in-memory Map caches)
import { kvGet, kvSet, KV_TTL } from "./kv-cache.js";
import { checkRateLimit } from "./rate-limit.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// Marvel test-market price-variant allowlists. Vision labels any 35¢ /
// 30¢ price box on a cover as a "test market" variant, but those price
// points are also the standard cover price for a wide era of Marvel
// books (35¢ became standard August 1977; 30¢ was standard from
// September 1976 onward outside the test window). Without this gate
// the variant multiplier (×6 for 35¢, ×4 for 30¢) fires on books like
// Howard the Duck #28 (1978, out of window) that just happen to show
// 35¢ as their normal price.
//
// Title keys go through `normalizeTitle` (lowercase, strip punctuation,
// hyphens → spaces). Aliases included where Vision returns the short
// form some scans and the full form on others (sgt fury, john carter,
// kid colt, doctor strange / dr strange).
//
// 35¢ source: https://recalledcomics.com/Marvel35CentVariants.php
//   (cross-checked vs gocollect.com and sellmycomicbooks.com — 184
//   issues across 52 series, June–October 1977 test-market window).
//
// 30¢ source: https://recalledcomics.com/Marvel30CentVariants.php
//   (cross-checked vs gocollect.com — 182 issues across 57 series,
//   April–August 1976 test-market window). Excludes Ka-Zar #16 and
//   Inhumans #5 — those were printed entirely at 30¢, no variant.
const TEST_MARKET_VARIANTS = {
  '35¢': {
    '2001 a space odyssey': [7, 8, 9, 10],
    'amazing spider man': [169, 170, 171, 172, 173],
    'avengers': [160, 161, 162, 163, 164],
    'black panther': [4, 5],
    'captain america': [210, 211, 212, 213, 214],
    'captain marvel': [51, 52],
    'champions': [14, 15],
    'conan the barbarian': [75, 76, 77, 78, 79],
    'daredevil': [146, 147, 148],
    'defenders': [48, 49, 50, 51, 52],
    // Ship #10: dual-key for Doctor Strange / Dr. Strange (Vision varies).
    'doctor strange': [23, 24, 25],
    'dr strange': [23, 24, 25],
    'eternals': [12, 13, 14, 15, 16],
    'fantastic four': [183, 184, 185, 186, 187],
    'flintstones': [1],
    'ghost rider': [24, 25, 26],
    'godzilla': [1, 2, 3],
    'howard the duck': [13, 14, 15, 16, 17],
    'human fly': [1, 2],
    'incredible hulk': [212, 213, 214, 215, 216],
    'inhumans': [11, 12],
    'invaders': [17, 18, 19, 20, 21],
    'iron fist': [13, 14, 15],
    'iron man': [99, 100, 101, 102, 103],
    'john carter': [1, 2, 3, 4, 5],
    'john carter warlord of mars': [1, 2, 3, 4, 5],
    'kid colt': [218, 219, 220],
    'kid colt outlaw': [218, 219, 220],
    // Ship #10: actual cover title 1977 was "Kull the Destroyer"
    // (RecalledComics' display label "Kull the Conqueror" was a
    // typo — the title flipped to Destroyer in 1973 and stayed
    // there until 1982). Vision reads literal cover text.
    'kull the destroyer': [21, 22, 23],
    'logans run': [6, 7],
    'marvel premiere': [36, 37, 38],
    'marvel presents': [11, 12],
    'marvel super action': [2, 3],
    'marvel super heroes': [65, 66],
    'marvel tales': [80, 81, 82, 83, 84],
    'marvel team up': [58, 59, 60, 61, 62],
    'marvel triple action': [36, 37],
    'marvel two in one': [28, 29, 30, 31, 32],
    'marvels greatest comics': [71, 72, 73],
    'master of kung fu': [53, 54, 55, 56, 57],
    'ms marvel': [6, 7, 8, 9, 10],
    'nova': [10, 11, 12, 13, 14],
    'omega the unknown': [9, 10],
    'power man': [44, 45, 46, 47],
    'rawhide kid': [140, 141],
    'red sonja': [4, 5],
    'scooby doo': [1],
    'sgt fury': [141, 142],
    'sgt fury and his howling commandos': [141, 142],
    'spectacular spider man': [7, 8, 9, 10, 11],
    'star wars': [1, 2, 3, 4],
    'super villain team up': [12, 13, 14],
    'tarzan': [1, 2, 3, 4, 5],
    'thor': [260, 261, 262, 263, 264],
    'tomb of dracula': [57, 58, 59, 60],
    'x men': [105, 106, 107],
  },
  '30¢': {
    'adventures on the planet of the apes': [5, 6, 7],
    'amazing adventures': [36, 37],
    'amazing spider man': [155, 156, 157, 158, 159],
    'astonishing tales': [35, 36],
    'avengers': [146, 147, 148, 149, 150],
    'black goliath': [2, 3, 4],
    'captain america': [196, 197, 198, 199, 200],
    'captain marvel': [44, 45],
    'chamber of chills': [22, 23],
    'champions': [5, 6, 7],
    'conan the barbarian': [61, 62, 63, 64, 65],
    'daredevil': [132, 133, 134, 135, 136],
    'defenders': [34, 35, 36, 37, 38],
    'doctor strange': [13, 14, 15, 16, 17],
    'dr strange': [13, 14, 15, 16, 17],
    'eternals': [1, 2],
    'fantastic four': [169, 170, 171, 172, 173],
    'ghost rider': [17, 18, 19],
    'howard the duck': [3, 4],
    'incredible hulk': [198, 199, 200, 201, 202],
    'invaders': [6, 7],
    'iron fist': [4, 5, 6],
    'iron man': [85, 86, 87, 88, 89],
    'jungle action': [21, 22],
    'kid colt': [205, 206, 207, 208, 209],
    'kid colt outlaw': [205, 206, 207, 208, 209],
    'kull the destroyer': [16],
    'marvel adventure': [3, 4, 5],
    'marvel chillers': [4, 5, 6],
    'marvel double feature': [15, 16, 17],
    'marvel feature': [4, 5],
    'marvel premiere': [29, 30, 31],
    'marvel presents': [4, 5, 6],
    'marvel spotlight': [27, 28, 29],
    'marvel super heroes': [57, 58],
    'marvel tales': [66, 67, 68, 69, 70],
    'marvel team up': [44, 45, 46, 47, 48],
    'marvel triple action': [29, 30],
    'marvel two in one': [15, 16, 17, 18],
    'marvels greatest comics': [63, 64],
    'master of kung fu': [39, 40, 41, 42, 43],
    'mighty marvel western': [45],
    'omega the unknown': [2, 3],
    'power man': [30, 31, 32, 33, 34],
    'rawhide kid': [133, 134],
    'ringo kid': [27, 28],
    'sgt fury': [133, 134],
    'sgt fury and his howling commandos': [133, 134],
    'skull the slayer': [5, 6],
    'son of satan': [3, 4, 5],
    'strange tales': [185, 186],
    'super villain team up': [5, 6, 7],
    'thor': [246, 247, 248, 249, 250],
    'tomb of darkness': [20, 21],
    'tomb of dracula': [43, 44, 45, 46, 47],
    'two gun kid': [129, 130, 131],
    'warlock': [12, 13, 14],
    'weird wonder tales': [15, 16, 17],
    'werewolf by night': [38, 39],
    'x men': [98, 99, 100],
  },
};

// Maps variant-string keys (as appear in Vision-returned variant
// strings) to their TEST_MARKET_VARIANTS bucket key. Extends cleanly
// to future variant types (Whitman, Mark Jewelers, Type 1A/1B) by
// adding new entries here + a new bucket above.
const TEST_MARKET_KEYS = {
  '35 cent': '35¢',
  '35¢': '35¢',
  '30 cent': '30¢',
  '30¢': '30¢',
};

// Resolve whether a (title, issue, variantKey) combo falls within a
// known test-market window. Returns true ONLY for (title, issue) pairs
// listed in TEST_MARKET_VARIANTS[variantKey]. Used to gate the variant
// multiplier — books outside the allowlist fall through to 1.0× even
// when Vision labeled the cover with a test-market price string.
const isTestMarketVariant = (title, issue, variantKey) => {
  const bucket = TEST_MARKET_VARIANTS[variantKey];
  if (!bucket) return false;
  const titleKey = normalizeTitle(title);
  if (!titleKey) return false;
  const issueNum = parseInt(String(issue || '').trim(), 10);
  if (isNaN(issueNum)) return false;
  const allowed = bucket[titleKey];
  return Array.isArray(allowed) && allowed.includes(issueNum);
};





// Fast, text-only AI verification pass. Asks Claude whether each eBay
// listing title actually matches the identified comic. Returns an array
// of booleans in the same order as `listings`, or null on any failure so
// the caller can silently fall back to unverified comps.
const verifyCompsTitles = async ({ title, issue, year, publisher, listings }) => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!Array.isArray(listings) || listings.length === 0) return null;
  try {
    const metaParts = [];
    if (title) metaParts.push(String(title).trim());
    if (issue) metaParts.push(`#${issue}`);
    if (year) metaParts.push(`(${year})`);
    const comicLabel =
      metaParts.filter(Boolean).join(" ").trim() || "this comic";
    const publisherPart = publisher ? ` by ${publisher}` : "";
    const numbered = listings
      .map((t, i) => `${i + 1}. ${String(t || "").trim()}`)
      .join("\n");

    const prompt =
      `I identified this comic: ${comicLabel}${publisherPart}.\n\n` +
      `These are eBay listings returned as price comps:\n${numbered}\n\n` +
      `For each listing reply with MATCH or NO_MATCH. MATCH if the ` +
      `listing is clearly the same comic — same title, same issue number, ` +
      `same era. If the title is a close match (same character, same series ` +
      `name, same issue number) accept it even if the listing title has ` +
      `extra words like "variant", "cover B", "ratio variant", "2nd print", ` +
      `"newsstand", or "facsimile". ` +
      `Year in listing title may differ from our year by 1-2 years due to ` +
      `cover dates vs publication dates — this is NOT a reason to reject. ` +
      `Only reject if it is clearly a different issue number or a different ` +
      `character/series. ` +
      `Reply with only a JSON array like:\n[true, false, true, false]\n` +
      `in the same order as the listings.`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (message.content || [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*?\]/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!Array.isArray(parsed)) return null;
    if (parsed.length !== listings.length) {
      console.warn(
        `[enrich] AI verify length mismatch: got ${parsed.length}, expected ${listings.length}`
      );
      return null;
    }
    return parsed.map((v) => v === true);
  } catch (err) {
    console.error(`[enrich] AI verify error: ${err?.message || err}`);
    return null;
  }
};

// Helper: Extract subtitle tokens from title (after colon, dash with spaces, or "vs")
// for ComicVine volume scoring boost/penalty.
const extractSubtitleTokens = (title) => {
  const str = String(title || '').toLowerCase();
  // Split on colon, dash with spaces (not compound words like "Spider-Man"), or "vs"
  const parts = str.split(/:\s*|\s+-\s+|\bvs\b/);
  if (parts.length < 2) return [];
  // Return tokens from subtitle parts (skip stop words)
  return parts.slice(1)
    .join(' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['the', 'and', 'for', 'with'].includes(t));
};

// Ship 26.3C-2 Patch C2-A — Clean title for ComicVine query
// Strip artist/variant noise tokens to prevent wrong-volume matching.
// Preserves publisher-in-title series (Marvel Tales, DC Pride, etc.).
// Ship 3B.7 — cleanTitleForComicVine now in ComicAdapter.js
// Imported above, no local definition needed

// Ship 3B.7 — sanitizeTitle moved to ComicAdapter.sanitizeComicTitle
// Now imported above, no local definition needed

/**
 * Ship v0-G — Detect title contamination signals.
 *
 * Flags titles that appear to contain seller/marketplace noise.
 * Does NOT downgrade decision.action — only triggers sanitization.
 *
 * @param {string} title - Title to check
 * @param {Object} context - { year, isGraded, issue, publisher }
 * @returns {Object} { contaminated, signals, severity }
 */
const detectTitleContamination = (title, context = {}) => {
  const { year, isGraded, issue, publisher } = context;
  const signals = [];

  if (!title || typeof title !== 'string') {
    return { contaminated: false, signals: [], severity: 'none' };
  }

  const titleLower = title.toLowerCase();

  // Signal 1: Marketplace keywords
  if (/\b(free\s+(?:shipping|ship)|select\s+an?\s+issue|choose\s+(?:your\s+)?issue|your\s+choice|stock\s+image|see\s+pics?|combine(?:d)?\s+(?:shipping|ship|s&h)|buy\s+it\s+now|must\s+see|hot\s+read)\b/i.test(title)) {
    signals.push('marketplace-keywords');
  }

  // Signal 2: Seller-description cluster (grade + year + creator)
  const hasGrade = /\b(vg|fn|vf|nm|gd|fr|pr|raw|low\s+grade|mid\s+grade|high\s+grade|apparent)\b/i.test(title);
  const hasYear = year && new RegExp(`\\b${year}\\b`).test(title);
  const hasCreator = /\b(kirby|severin|ditko|lee|buscema|romita|steranko|bartel|mayhew|byrne|miller|mcfarlane|mignola|ross|campbell|cho|fabok|aparo|wrightson|kubert|adams|bolland|perez|simonson|sook|capullo|finch|sale|coipel|quesada)\b/i.test(title);

  if (hasGrade && hasYear && hasCreator) {
    signals.push('seller-description-cluster');
  }

  // Signal 6: Publisher filler
  if (/\b(atlas\s+series|silver\s+age|golden\s+age|bronze\s+age|copper\s+age|modern\s+age|pre\s+code)\b/i.test(title)) {
    signals.push('publisher-filler');
  }

  // Signal 7: Listing language
  if (/\b(set\s+main|1st\s+app(?:earance)?|trade\s+dress|empire|new\s+series|ongoing|limited\s+series|mini\s+series|one[\s-]?shot)\b/i.test(title)) {
    signals.push('listing-language');
  }

  // Signal 3: Excessive length
  const tokens = title.split(/\s+/).filter(t => t.length > 1);
  if (title.length > 60 || tokens.length > 8) {
    signals.push('excessive-length');
  }

  // Signal 4: Grading service mismatch
  if (!isGraded && /\b(cgc|cbcs|slabbed|graded)\b/i.test(title)) {
    signals.push('grading-service-mismatch');
  }

  // Signal 5: Rarity stacking
  const rarityMatches = (title.match(/\b(rare|scarce|hot|key|gem|beauty)\b/gi) || []).length;
  if (rarityMatches >= 2) {
    signals.push('rarity-stacking');
  }

  // Ship Pattern-J — Seller inventory code detection.
  // Detects short alphanumeric codes like mm22, A2, Z4405, 9176.
  // Preserves legitimate title numbers (2099, 2000 AD), issue numbers (#22),
  // ratios (1:25), and years (1900-2099).
  const INVENTORY_CODE_DETECTOR = /\b(?!(?:19|20)\d{2}\b)(?!#)(?!\d+:)([a-z]{1,2}\d{1,5}|\d{1,5}[a-z]{1,2}|[a-z]\d+[a-z]|\d{4,5}(?!AD))\b/i;
  if (INVENTORY_CODE_DETECTOR.test(title)) {
    signals.push('inventory-code');
  }

  const contaminated = signals.length > 0;

  // Ship v0-G.1 — Tightened severity rules
  // High: ≥2 signals OR any single high-priority signal
  // Medium: 1 signal
  const highPrioritySignals = ['seller-description-cluster', 'listing-language', 'publisher-filler', 'marketplace-keywords', 'inventory-code'];
  const hasHighPriority = signals.some(s => highPrioritySignals.includes(s));

  let severity = 'none';
  if (signals.length >= 2 || hasHighPriority) {
    severity = 'high';
  } else if (signals.length === 1) {
    severity = 'medium';
  }

  if (contaminated) {
    console.log(`[title-contamination] ${severity}: ${signals.join(', ')}`);
  }

  return { contaminated, signals, severity };
};

// SPEED-2a — Export for metadata endpoint
// TRACK A: ComicVine UPC/barcode lookup
export const lookupComicVineByUPC = async (upc) => {
  if (!process.env.COMICVINE_API_KEY || !upc) return null;
  try {
    const url =
      `https://comicvine.gamespot.com/api/issues/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
      `&format=json&filter=upc:${encodeURIComponent(upc)}` +
      `&field_list=id,name,issue_number,cover_date,volume,upc`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      headers: { "User-Agent": "ComicVault/1.0" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];

    if (results.length === 0) {
      console.log(`[cv-upc] no results for UPC: ${upc}`);
      return null;
    }

    // Take first match (UPC should be unique)
    const issue = results[0];
    const title = issue?.volume?.name || issue?.name || null;
    const issueNumber = issue?.issue_number || null;
    const coverDate = issue?.cover_date || null;
    const year = coverDate ? coverDate.slice(0, 4) : null;
    const publisher = issue?.volume?.publisher?.name || null;

    console.log(`[cv-upc] found: ${title} #${issueNumber} (${year}) - ${publisher}`);

    return {
      title,
      issue: issueNumber,
      year,
      publisher,
      upc,
      volume: issue.volume,
      cvIssueId: issue.id,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('[cv-upc] timeout after 3s');
    } else {
      console.error(`[cv-upc] error: ${err?.message || err}`);
    }
    return null;
  }
};

export const lookupComicVine = async ({ title, issue, year, publisher }) => {
  if (!process.env.COMICVINE_API_KEY || !title) return null;
  try {
    // Prefer explicit issue param, fall back to parsing from title.
    const issueFromTitle = String(title).match(/#\s*(\d+)/);
    const issueNumber = issue ? String(issue).trim() : (issueFromTitle ? issueFromTitle[1] : null);
    // Strip #N from title for the base series name.
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    // Include issue number in query — ComicVine search ranks it much higher.
    const searchQuery = issueNumber ? `${seriesName} ${issueNumber}` : seriesName;

    const url =
      `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
      `&format=json&resources=issue&query=${encodeURIComponent(searchQuery)}` +
      `&field_list=id,name,issue_number,cover_date,description,deck,first_appearance_characters,character_credits,person_credits,story_arc_credits,aliases,volume` +
      `&limit=20`;

    // 2-second timeout to prevent pipeline blocking
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(url, {
      headers: { "User-Agent": "ComicVault/1.0" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];

    // Filter to issue number matches first.
    const issueMatches = issueNumber
      ? results.filter((r) => String(r?.issue_number ?? "").trim() === String(issueNumber))
      : [];

    // Score each issue match: prefer volume name closest to our series name,
    // then use volume id as a tiebreaker (lower id = older/original volume).
    const seriesLower = seriesName.toLowerCase().replace(/^(the|a|an)\s+/i, "").trim();
    const comicYear = year ? parseInt(String(year).trim(), 10) : null;
    const pubLower = publisher ? String(publisher).toLowerCase().trim() : null;
    const scoreMatch = (r) => {
      const volName = String(r?.volume?.name || "").toLowerCase().replace(/^(the|a|an)\s+/i, "").trim();
      // Exact or near-exact volume name match gets highest priority.
      const nameScore = volName === seriesLower ? 100
        : volName.includes(seriesLower) || seriesLower.includes(volName) ? 50
        : 0;
      // Year proximity scoring: prefer volumes from the same era.
      const startYear = r?.volume?.start_year ? parseInt(r.volume.start_year, 10) : null;
      const yearDiff = comicYear && startYear ? Math.abs(startYear - comicYear) : 999;
      const yearScore = yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0;
      // Publisher scoring: prefer matching publisher.
      const volPublisher = String(r?.volume?.publisher?.name || "").toLowerCase().trim();
      const publisherScore = pubLower && volPublisher && volPublisher.includes(pubLower) ? 2 : 0;
      // Lower volume id = older/more likely original series.
      const volId = parseInt(r?.volume?.id, 10) || 999999;
      return { r, nameScore, yearScore, publisherScore, volId,
        total: nameScore + yearScore + publisherScore };
    };

    // For all issue matches (even single), fetch volume details for the
    // unique volumes so we can score on start_year and publisher.
    const candidates = issueMatches.length > 0 ? issueMatches : [];
    const uniqueVolIds = [...new Set(candidates.map((r) => r?.volume?.id).filter(Boolean))];
    const volDetails = {};
    // Ship #20a.6.16 Win #1 — Fetch up to 5 volume details IN PARALLEL.
    // CV rate-limiting claim from sequential comment was never validated;
    // parallel fetches save ~500-1000ms on Silver Age keys with multiple volumes.
    const volumePromises = uniqueVolIds.slice(0, 5).map(async (vid) => {
      try {
        const vUrl =
          `https://comicvine.gamespot.com/api/volume/4050-${vid}/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
          `&format=json&field_list=id,name,start_year,publisher`;
        const vController = new AbortController();
        const vTimeoutId = setTimeout(() => vController.abort(), 2000);
        const vRes = await fetch(vUrl, {
          headers: { "User-Agent": "ComicVault/1.0" },
          signal: vController.signal,
        });
        clearTimeout(vTimeoutId);
        if (vRes.ok) {
          const vJson = await vRes.json();
          if (vJson?.results) return { vid, data: vJson.results };
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log(`[comicvine] volume ${vid} timeout — continuing without details`);
        }
        // Gracefully continue on any error
      }
      return null;
    });
    const volumeResults = await Promise.all(volumePromises);
    volumeResults.forEach(r => {
      if (r) volDetails[r.vid] = r.data;
    });
    console.log(`[comicvine] volDetails fetched: ${Object.keys(volDetails).length}/${uniqueVolIds.length} — ${
      Object.entries(volDetails).map(([id, v]) => `${id}:${v.name}(${v.start_year},${v.publisher?.name || "?"})`).join(", ")}`);

    // Strict year filter: reject issues where cover_date differs >4y from comicYear.
    // Uses issue cover_date, NOT volume start_year (prevents long-running series rejection).
    // ASM #518 (2005): cover_date "2005-01-01" vs start_year 1963 — cover_date is correct.
    if (comicYear) {
      const beforeYearStrict = candidates.length;
      const yearStrictFiltered = candidates.filter((r) => {
        const coverDate = r?.cover_date; // Format: "2005-01-01"
        if (!coverDate) return true; // keep if no cover_date
        const coverYear = parseInt(String(coverDate).split('-')[0], 10);
        if (isNaN(coverYear)) return true;
        const yearDiff = Math.abs(coverYear - comicYear);
        if (yearDiff > 4) {
          console.log(`[cv-year-strict] REJECT ${r.volume?.name} #${r.issue_number} (cover ${coverYear} vs ${comicYear}, ${yearDiff}y gap)`);
          return false;
        }
        return true;
      });
      if (yearStrictFiltered.length > 0) {
        candidates.splice(0, candidates.length, ...yearStrictFiltered);
        console.log(`[cv-year-strict] ${beforeYearStrict} → ${candidates.length} issues (±4y cover_date)`);
      } else {
        console.log(`[cv-year-strict] would remove all ${beforeYearStrict} issues — keeping original set`);
      }
    }

    // Language gate: filter out non-English editions (German, French, Spanish, Italian).
    // Prevents Scumbag #1 (German) and other foreign-language editions from winning.
    const beforeLang = candidates.length;
    const langFiltered = candidates.filter((r) => {
      const vol = volDetails[r?.volume?.id];
      if (!vol?.name) return true;
      return !/\b(german|deutsch|french|français|spanish|español|italian|italiano)\b/i
        .test(String(vol.name));
    });
    if (langFiltered.length > 0) {
      candidates.splice(0, candidates.length, ...langFiltered);
      console.log(
        `[cv-lang-gate] ${beforeLang} → ${candidates.length} volumes (non-English filtered)`
      );
    }

    // Reprint publisher gate: UNCONDITIONALLY reject known reprint imprints.
    // Panini/Marvel UK/DynaPubs/etc are NEVER original publishers — always reprints.
    // Prevents Hulk #110 → Panini reprint, ASM #518 → Marvel UK, Punisher story bleed.
    const beforeReprint = candidates.length;
    const REPRINT_PUBLISHERS = [
      'marvel uk', 'panini', 'dynapubs', 'revolutionary',
      'sergio bonelli', 'dennis förlag', 'condor', 'titan books',
      'grupo editorial', 'vid', 'novedades'  // Mexican reprint publishers
    ];
    const reprintFiltered = candidates.filter((r) => {
      const vol = volDetails[r?.volume?.id];
      if (!vol?.publisher?.name) return true;
      const volPub = String(vol.publisher.name).toLowerCase();
      const isReprint = REPRINT_PUBLISHERS.some(rp => volPub.includes(rp));
      if (isReprint) {
        console.log(`[cv-reprint-gate] REJECT ${vol.name} (reprint publisher: ${vol.publisher.name})`);
        return false;
      }
      return true;
    });
    if (reprintFiltered.length > 0) {
      candidates.splice(0, candidates.length, ...reprintFiltered);
      console.log(`[cv-reprint-gate] ${beforeReprint} → ${candidates.length} volumes`);
    }

    // Ship 26.3C-2 Patch C2-B — Token gate: require volume name to overlap ≥50%
    // with cleaned query core tokens. Prevents generic volumes (e.g., "Scorched
    // Earth" sci-fi volume) from matching specific series (Batman/Catwoman Gotham War).
    const beforeToken = candidates.length;
    const tokenizeForGate = (str) => {
      return String(str || '')
        .toLowerCase()
        .replace(/#\s*\d+/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !/^\d+$/.test(t))
        .filter(t => !['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with'].includes(t));
    };
    const queryTokens = tokenizeForGate(seriesName);
    const coreTokens = queryTokens.slice(0, 3); // First 3 significant tokens

    const tokenFiltered = candidates.filter((r) => {
      const vol = volDetails[r?.volume?.id];
      if (!vol?.name) return true; // Keep if no volume name data
      const volTokens = tokenizeForGate(vol.name);
      const overlap = queryTokens.filter(qt => volTokens.includes(qt)).length;
      const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;

      // Hard fail: volume missing ALL of first 3 core tokens
      const coreOverlap = coreTokens.filter(ct => volTokens.includes(ct)).length;
      if (coreOverlap === 0 && coreTokens.length > 0) {
        console.log(`[cv-token-gate] REJECT ${vol.name} (0/${coreTokens.length} core tokens: ${coreTokens.join(', ')})`);
        return false;
      }

      // Soft fail: overlap < 50%
      if (overlapRatio < 0.5) {
        console.log(`[cv-token-gate] REJECT ${vol.name} (${Math.round(overlapRatio * 100)}% overlap < 50%)`);
        return false;
      }

      return true;
    });
    if (tokenFiltered.length > 0) {
      candidates.splice(0, candidates.length, ...tokenFiltered);
      console.log(
        `[cv-token-gate] ${beforeToken} → ${candidates.length} volumes (token overlap ≥50%)`
      );
    } else {
      console.log(
        `[cv-token-gate] would remove all ${beforeToken} volumes — keeping original set`
      );
    }

    // Ship 26.3C-2 Patch C2-C — Publisher gate: reject weak matches (nameScore < 75)
    // when publisher doesn't match. Prevents generic/unrelated volumes from winning
    // on partial title overlap alone.
    const beforePub = candidates.length;
    const pubFiltered = candidates.filter((r) => {
      const vol = volDetails[r?.volume?.id];
      if (!vol?.name) return true; // Keep if no volume data

      // Compute preliminary nameScore (same logic as scoreMatch)
      const volName = String(vol.name || '').toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
      const nameScore = volName === seriesLower ? 100
        : volName.includes(seriesLower) || seriesLower.includes(volName) ? 50
        : 0;

      // Compute preliminary publisherScore
      const volPub = String(vol.publisher?.name || '').toLowerCase().trim();
      const publisherScore = pubLower && volPub && (volPub.includes(pubLower) || pubLower.includes(volPub)) ? 2 : 0;

      // Reject weak matches without publisher confirmation
      if (nameScore < 75 && publisherScore === 0 && pubLower) {
        console.log(`[cv-pub-gate] REJECT ${vol.name} (nameScore=${nameScore} < 75, publisherScore=0)`);
        return false;
      }

      return true;
    });
    if (pubFiltered.length > 0) {
      candidates.splice(0, candidates.length, ...pubFiltered);
      console.log(
        `[cv-pub-gate] ${beforePub} → ${candidates.length} volumes (weak matches without publisher rejected)`
      );
    } else {
      console.log(
        `[cv-pub-gate] would remove all ${beforePub} volumes — keeping original set`
      );
    }

    // Re-score with volume detail data (start_year, publisher).
    const scoreWithDetails = (r) => {
      const base = scoreMatch(r);
      const vid = r?.volume?.id;
      const vol = volDetails[vid];
      if (!vol) return base;
      const startYear = vol.start_year ? parseInt(vol.start_year, 10) : null;
      const yearDiff = comicYear && startYear ? Math.abs(startYear - comicYear) : 999;

      // PART 3: Year gap penalty for large differences
      let detailYearScore = yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0;
      if (yearDiff >= 30) detailYearScore = -5;
      else if (yearDiff > 20) detailYearScore = -2;

      const volPub = String(vol.publisher?.name || "").toLowerCase().trim();
      const detailPubScore = pubLower && volPub && volPub.includes(pubLower) ? 2 : 0;

      // PART 1: Subtitle token boost/penalty
      let subtitleScore = 0;
      const subtitleTokens = extractSubtitleTokens(seriesName);
      if (subtitleTokens.length > 0) {
        const volNameLower = String(vol.name || '').toLowerCase();
        const hasSubtitle = subtitleTokens.some(t => volNameLower.includes(t));
        subtitleScore = hasSubtitle ? 30 : -20;
      }

      const total = base.nameScore + detailYearScore + detailPubScore + subtitleScore;
      return { ...base, yearScore: detailYearScore, publisherScore: detailPubScore, subtitleScore, total, volume: vol };
    };

    let match = null;
    if (candidates.length === 1) {
      // Single match — still validate year/publisher if we have details.
      const scored = scoreWithDetails(candidates[0]);
      // Reject if we know both year and publisher and neither matched.
      if (comicYear && pubLower && scored.yearScore === 0 && scored.publisherScore === 0 && volDetails[candidates[0]?.volume?.id]) {
        match = null; // wrong era + wrong publisher — skip
      } else {
        match = candidates[0];
      }
    } else if (candidates.length > 1) {
      // Pick best: highest combined score, then lowest volume id (oldest series).
      const scored = candidates.map(scoreWithDetails);
      scored.sort((a, b) => b.total - a.total || a.volId - b.volId);
      console.log(`[comicvine] top scores: ${scored.slice(0, 3).map((s) =>
        `${s.r.volume?.name}(name=${s.nameScore} yr=${s.yearScore} pub=${s.publisherScore} sub=${s.subtitleScore || 0} total=${s.total} vid=${s.volId})`
      ).join(" | ")}`);

      // PART 2: Publisher tiebreaker when top 2 scores within 10 points
      const topScore = scored[0].total;
      const closeVols = scored.filter(c => topScore - c.total <= 10);

      if (closeVols.length > 1 && pubLower) {
        const pubMatch = closeVols.find(c => {
          const volPub = String(c.volume?.publisher?.name || '').toLowerCase();
          return volPub.includes(pubLower) || pubLower.includes(volPub);
        });
        if (pubMatch) {
          console.log(`[cv-pub-tiebreaker] ${closeVols.length} within 10pts → publisher match wins: ${pubMatch.volume?.name}`);
          match = pubMatch.r;
        } else {
          match = scored[0].r;
        }
      } else {
        match = scored[0].r;
      }
    }
    // No match — don't fall through to results[0].

    console.log(
      `[comicvine] query="${searchQuery}" issue=${issueNumber} year=${year || "?"}` +
      ` results=${results.length} issueMatches=${candidates.length}` +
      ` matched=${match ? `${match.volume?.name} #${match.issue_number} (vol_id=${match.volume?.id})` : "none"}`
    );

    // DIAGNOSTIC: Track publisher backfill from ComicVine match (The Crow case)
    if (match?.volume) {
      console.log(`[cv-publisher-debug] vol_id=${match.volume.id} publisher=${JSON.stringify(match.volume.publisher)}`);
    }

    if (!match) return null;
    const firstApps = match.first_appearance_characters;
    const hasFirstApps = Array.isArray(firstApps) && firstApps.length > 0;

    // Parse description + deck for key-issue signals when structured
    // first_appearance_characters is empty (common for origin issues,
    // deaths, #1 issues, classic-artist-significance keys).
    const descText = `${match.deck || ""} ${match.description || ""}`
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let derivedKey = null;
    if (!hasFirstApps && descText) {
      const d = descText.toLowerCase();
      const faMatch = descText.match(/first appearance of ([^.!?;\n]{3,80})/i);
      const originMatch = descText.match(/origin of ([^.!?;\n]{3,80})/i);
      const deathMatch = descText.match(/death of ([^.!?;\n]{3,80})/i);
      if (faMatch) {
        derivedKey = `1st appearance of ${faMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (originMatch) {
        derivedKey = `Origin of ${originMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (deathMatch) {
        derivedKey = `Death of ${deathMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (/\bfirst appearance\b/.test(d)) {
        derivedKey = "1st appearance";
      } else if (/\borigin\b/.test(d) && /\bissue\b/.test(d)) {
        derivedKey = "Origin issue";
      }
      if (derivedKey) console.log("[comicvine] key derived from description:", derivedKey);
    }

    // Ship #21 — Expand ComicVine data for complete card
    const vid = match.volume?.id;
    const volDetail = volDetails[vid];

    // Ship 26.3C-2 Patch C2-D-lite — Story safety: suppress description/deck
    // for borderline matches to prevent wrong-volume story contamination.
    // KEEP the ComicVine match (volume, characters, credits, etc.) — suppress
    // story fields only when match quality is questionable.
    //
    // CV-VOLUME — Era-gate: suppress story when abs(confirmedYear - cvYear) > 10y.
    // X-Men #25 case: 1966 book pulled 2010 vol.3 story (44y drift).
    let description = match.description;
    let deck = match.deck;
    let storySuppressedReason = null;

    if (volDetail?.name) {
      // Compute final nameScore (same logic as scoreMatch)
      const volName = String(volDetail.name || '').toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
      const nameScore = volName === seriesLower ? 100
        : volName.includes(seriesLower) || seriesLower.includes(volName) ? 50
        : 0;

      // Compute final publisherScore
      const volPub = String(volDetail.publisher?.name || '').toLowerCase().trim();
      const publisherScore = pubLower && volPub && (volPub.includes(pubLower) || pubLower.includes(volPub)) ? 2 : 0;

      // Compute final token overlap
      const volTokens = tokenizeForGate(volDetail.name);
      const overlap = queryTokens.filter(qt => volTokens.includes(qt)).length;
      const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;

      // CV-VOLUME — Era-gate CV story when year drift >10y (wrong volume indicator)
      const cvStartYear = volDetail?.start_year ? parseInt(volDetail.start_year, 10) : null;
      const confirmedYearInt = comicYear ? parseInt(comicYear, 10) : null;
      const yearDrift = cvStartYear && confirmedYearInt ? Math.abs(confirmedYearInt - cvStartYear) : 0;

      if (yearDrift > 10) {
        description = null;
        deck = null;
        storySuppressedReason = 'era-gate-year-drift';
        console.log(
          `[cv-era-gate] suppressed story: confirmedYear=${confirmedYearInt} cvYear=${cvStartYear} drift=${yearDrift}y ` +
          `volume="${volDetail.name}"`
        );
      }

      // Ship #21i-b: Foreign edition check (Q35 pattern — metadata gate, NOT pricing logic)
      // Detect translation/foreign volumes from description or name metadata
      // Widened pattern: "Translates"/"Reprints"/"Vertaling" at start of story text OR
      // foreign-imprint publisher (Panini, etc.)
      const FOREIGN_IMPRINT_PUBLISHERS = [
        'panini', 'planeta', 'planeta deagostini', 'semic', 'editora abril',
        'editorial novaro', 'vertaling', 'glenat', 'dargaud'
      ];
      const volPubLower = String(volDetail?.publisher?.name || '').toLowerCase().trim();
      const isForeignImprint = FOREIGN_IMPRINT_PUBLISHERS.some(pub => volPubLower.includes(pub));

      const isForeignEdition = (volDetail?.description && /translat(e|ion)|foreign|edition\s+\w+\s+language/i.test(volDetail.description)) ||
                               (description && /^(translates|reprints|vertaling)\b/i.test(description)) ||
                               isForeignImprint;

      // Borderline conditions
      const isBorderline = nameScore < 75 || publisherScore === 0 || overlapRatio < 0.6;

      if (isBorderline || isForeignEdition) {
        // Suppress story fields (unless already suppressed by era-gate above)
        if (!storySuppressedReason) {
          description = null;
          deck = null;

          // Determine reason
          if (isForeignEdition) {
            storySuppressedReason = 'foreign-edition';
          } else if (nameScore < 75) {
            storySuppressedReason = 'title-weak-match';
          } else if (overlapRatio < 0.6) {
            storySuppressedReason = 'title-token-mismatch';
          } else if (publisherScore === 0) {
            storySuppressedReason = 'publisher-mismatch';
          }
        }

        console.log(
          `[comicvine-story] SUPPRESSED reason=${storySuppressedReason} ` +
          `nameScore=${nameScore} pubScore=${publisherScore} tokenOverlap=${Math.round(overlapRatio * 100)}% ` +
          `volume="${volDetail.name}"`
        );

        // Build fallback description from available metadata
        const fallbackParts = [
          match.volume?.name,
          match.issue_number ? `#${match.issue_number}` : null,
          volDetail?.publisher?.name || match.volume?.publisher?.name,
          volDetail?.start_year ? `(${volDetail.start_year})` : null,
        ].filter(Boolean);

        const characters = Array.isArray(match.character_credits)
          ? match.character_credits.map(c => c?.name).filter(Boolean).slice(0, 3)
          : [];
        if (characters.length > 0) {
          fallbackParts.push(`Featuring: ${characters.join(', ')}`);
        }

        const firstApps = Array.isArray(match.first_appearance_characters)
          ? match.first_appearance_characters.map(c => c?.name).filter(Boolean)
          : [];
        if (firstApps.length > 0) {
          fallbackParts.push(`First appearance: ${firstApps[0]}`);
        }

        description = fallbackParts.length > 0
          ? fallbackParts.join(' · ')
          : 'No description available.';
        deck = null; // deck already suppressed above
      }
    }

    return {
      id: match.id,
      name: match.name,
      issueNumber: match.issue_number,
      volume: match.volume?.name,
      volumeId: vid,
      publisher: volDetail?.publisher?.name || match.volume?.publisher?.name || null,
      startYear: volDetail?.start_year || null,
      description,
      deck,
      storySuppressedReason,
      storySource: storySuppressedReason ? 'generated-fallback' : null,
      coverDate: match.cover_date || null,
      aliases: Array.isArray(match.aliases) ? match.aliases : [],
      firstAppearanceCharacters: hasFirstApps
        ? firstApps.map((c) => c?.name).filter(Boolean)
        : [],
      characterCredits: Array.isArray(match.character_credits)
        ? match.character_credits.map((c) => c?.name).filter(Boolean).slice(0, 5)
        : [],
      personCredits: Array.isArray(match.person_credits)
        ? match.person_credits.map((p) => ({
            name: p?.name,
            role: p?.role
          })).filter(p => p.name)
        : [],
      storyArcCredits: Array.isArray(match.story_arc_credits)
        ? match.story_arc_credits.map((s) => s?.name).filter(Boolean)
        : [],
      derivedKeyIssue: derivedKey,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[comicvine] timeout after 2s — falling through gracefully`);
    } else {
      console.error(`[enrich] comicvine error: ${err?.message || err}`);
    }
    return null;
  }
};

// Ship #11 — era-aware CGC/RAW multipliers. Pre-1985 (Golden/Silver/Bronze)
// keeps scarcity-premium multipliers unchanged. 1985+ (Crisis-era direct
// market → modern) uses damped multipliers to match abundant high-grade
// supply. getEra(year) routes to the right table; null/0/missing year
// defaults to vintage (safe — prefers over- to under-valuing unknown books).
export const CGC_MULTIPLIERS = {
  vintage: {
    10: 12.0, 9.9: 8.0, 9.8: 5.0, 9.6: 3.0, 9.4: 2.2, 9.2: 1.8,
    9.0: 1.5, 8.5: 1.3, 8.0: 1.15, 7.5: 1.05, 7.0: 1.0, 6.5: 0.9,
    6.0: 0.85, 5.5: 0.8, 5.0: 0.75, 4.5: 0.7, 4.0: 0.65, 3.5: 0.6,
    3.0: 0.55, 2.5: 0.5, 2.0: 0.45, 1.8: 0.4, 1.5: 0.35, 1.0: 0.3,
    0.5: 0.2,
  },
  modern: {
    10: 3.0, 9.9: 2.6, 9.8: 2.2, 9.6: 1.6, 9.4: 1.35, 9.2: 1.2,
    9.0: 1.1, 8.5: 1.05, 8.0: 1.0, 7.5: 0.95, 7.0: 0.9, 6.5: 0.85,
    6.0: 0.8, 5.5: 0.7, 5.0: 0.65, 4.5: 0.6, 4.0: 0.55, 3.5: 0.5,
    3.0: 0.45, 2.5: 0.4, 2.0: 0.38, 1.8: 0.35, 1.5: 0.32, 1.0: 0.28,
    0.5: 0.25,
  },
};

// Modern raw: graduated damp on upper curve (NM → VG/G), flat tail below.
// Sub-GD books trade on condition-survival, not era dynamics, so damping
// at that tier is noise — modern == vintage from GD/VG downward.
export const RAW_MULTIPLIERS = {
  vintage: {
    "NM": 1.0, "NM/M": 1.0,
    "VF/NM": 0.85, "VF": 0.75,
    "VF/F": 0.70, "FN/VF": 0.65,
    "FN": 0.55, "VG/FN": 0.50,
    "VG": 0.45, "VG/G": 0.40,
    "GD/VG": 0.35, "GD": 0.30,
    "FR/GD": 0.25, "FR": 0.20,
    "PR": 0.15,
  },
  modern: {
    "NM": 0.90, "NM/M": 0.90,
    "VF/NM": 0.78, "VF": 0.70,
    "VF/F": 0.65, "FN/VF": 0.60,
    "FN": 0.50, "VG/FN": 0.45,
    "VG": 0.40, "VG/G": 0.36,
    "GD/VG": 0.35, "GD": 0.30,
    "FR/GD": 0.25, "FR": 0.20,
    "PR": 0.15,
  },
};

const CGC_GRADES = Object.keys(CGC_MULTIPLIERS.vintage)
  .map(Number).sort((a, b) => a - b);


export const getGradeMultiplier = (grade, year = null) => {
  const g = Number(grade);
  if (isNaN(g)) return null;
  const era = getEra(year);
  const table = CGC_MULTIPLIERS[era];
  if (table[g] != null) return { multiplier: table[g], grade: g, era };
  let closest = CGC_GRADES[0];
  let minDist = Math.abs(g - closest);
  for (const k of CGC_GRADES) {
    const d = Math.abs(g - k);
    if (d < minDist) { closest = k; minDist = d; }
  }
  return { multiplier: table[closest], grade: closest, era };
};

// Parse a raw grade string like "VG 4.0" or "FR 1.0" into a multiplier.
// Step 1: extract numeric → find nearest CGC_MULTIPLIERS entry.
// Step 2: extract text abbreviation → look up RAW_MULTIPLIERS.
// Step 3: default 0.75.
export const getRawGradeMultiplier = (gradeStr, year = null) => {
  if (!gradeStr) return { multiplier: 0.75, label: "RAW", era: getEra(year) };
  const s = String(gradeStr).trim();
  const era = getEra(year);

  // Step 1: numeric portion
  const numMatch = s.match(/([\d.]+)/);
  if (numMatch) {
    const g = parseFloat(numMatch[1]);
    if (!isNaN(g) && g >= 0.5 && g <= 10) {
      const info = getGradeMultiplier(g, year);
      if (info) return { multiplier: info.multiplier, label: s, era };
    }
  }

  // Step 2: text abbreviation
  const textMatch = s.match(/^([A-Z][A-Z/]*)/i);
  if (textMatch) {
    const abbrev = textMatch[1].toUpperCase().replace(/\s+/g, "");
    const table = RAW_MULTIPLIERS[era];
    if (table[abbrev] != null) {
      return { multiplier: table[abbrev], label: s, era };
    }
  }

  // Step 3: default
  return { multiplier: 0.75, label: s || "RAW", era };
};

// Ship #12a — FR-D7 multi-key attribution extraction from comp titles.
// Sellers encode key context in eBay listing titles ("1st app of X", "Death
// of Dracula", "Intro of Y"). Engine previously pulled titles for pricing
// but ignored the key signals. Pattern-match post-AI-verify comp pool,
// surface consensus detections (hits >= 2) on out.keyFromComps, singletons
// on out.keyFromCompsSingleton for observability. DISPLAY ONLY — no write
// to out.keyIssue, no pricing math impact. Promotion logic reserved for
// Ship #12b with separate greenlight.
export const COMP_KEY_PATTERNS = [
  {
    kind: 'first-appearance',
    weight: 'major',
    re: /\b(?:1st|first)\s+(?:ever\s+)?app(?:earance)?\b(?:\s+of\s+[^-–|#,;]{2,50})?/i,
  },
  {
    kind: 'origin',
    weight: 'major',
    re: /\borigin\s+of\s+[^-–|#,;]{2,50}/i,
  },
  {
    kind: 'death',
    weight: 'minor',
    re: /\b(?:1st\s+)?(?:death|dies)\s+of\s+[^-–|#,;]{2,50}/i,
  },
  {
    kind: 'intro',
    weight: 'major',
    re: /\b(?:intro(?:duction|duces|duced|ducing)?|introducing)\b(?:\s+(?:of\s+)?[^-–|#,;]{2,50})?/i,
  },
  {
    kind: 'first-told',
    weight: 'minor',
    re: /\b(?:1st|first)\s+told\s+[^-–|#,;]{2,50}/i,
  },
  {
    kind: 'cameo',
    weight: 'minor',
    re: /\bcameo(?:\s+(?:of|by)\s+[^-–|#,;]{2,50})?/i,
  },
  {
    kind: 'second-appearance',
    weight: 'minor',
    re: /\b(?:2nd|second)\s+app(?:earance)?\b/i,
  },
  {
    kind: 'first-cover',
    weight: 'minor',
    re: /\b(?:1st|first)\s+cover(?:\s+app(?:earance)?)?\b/i,
  },
];

// Trim noise from a captured phrase — grading-company suffixes, trailing
// grades, trailing years, trailing issue numbers. The raw match may trail
// into "CGC 9.4 Marvel 1974" territory; we want just the signal phrase.
const COMP_PHRASE_NOISE = [
  /\s+(?:cgc|cbcs|pgx|psa|egs|hga)\b.*$/i,
  /\s+#\s*\d+.*$/,
  /\s+\d{4}\s*$/,
  /\s+\d+(?:\.\d+)?\s*$/,
  /\s+(?:vf|nm|fn|vg|gd|fr|pr|mint)\b.*$/i,
];

const cleanCompPhrase = (p) => {
  if (!p) return '';
  let out = String(p).trim();
  for (const re of COMP_PHRASE_NOISE) out = out.replace(re, '');
  return out.replace(/\s{2,}/g, ' ').trim();
};

// Title-case for display. Lowercase common connectors (of, the, &, and)
// unless they're the first token. Preserves punctuation ("Mr.", "Ma & Pa").
export const titleCaseKeyPhrase = (s) => {
  if (!s) return s;
  const lowers = new Set(['of', 'the', 'a', 'an', 'and', '&', 'in', 'on',
    'at', 'to', 'for', 'by', 'vs', 'vs.']);
  return String(s).toLowerCase().split(/\s+/).map((w, i) => {
    if (!w) return w;
    if (i > 0 && lowers.has(w)) return w;
    if (!/[a-z]/i.test(w)) return w; // pure symbols/numbers
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
};

// Scan an array of comp titles and return consensus + singleton detections.
// { consensus: [{kind, phrase, hits, weight, sources[]}], singletons: [...] }
// consensus = hits >= 2. singletons = hits === 1 (observability).
// Sorted by hits desc. sources capped at 3 per entry.
export const extractKeyFromComps = (titles) => {
  if (!Array.isArray(titles) || titles.length === 0) {
    return { consensus: [], singletons: [] };
  }
  const map = new Map();
  for (const rawTitle of titles) {
    if (!rawTitle || typeof rawTitle !== 'string') continue;
    for (const { kind, weight, re } of COMP_KEY_PATTERNS) {
      const m = rawTitle.match(re);
      if (!m) continue;
      const cleaned = cleanCompPhrase(m[0]);
      if (!cleaned || cleaned.length < 3) continue;
      const phrase = titleCaseKeyPhrase(cleaned);
      const key = `${kind}:${phrase.toLowerCase()}`;
      const existing = map.get(key);
      if (existing) {
        existing.hits += 1;
        if (existing.sources.length < 3) existing.sources.push(rawTitle);
      } else {
        map.set(key, { kind, phrase, hits: 1, weight, sources: [rawTitle] });
      }
    }
  }
  const all = Array.from(map.values()).sort((a, b) => b.hits - a.hits);
  return {
    consensus: all.filter((e) => e.hits >= 2),
    singletons: all.filter((e) => e.hits === 1),
  };
};

const PRICECHARTING_EXCLUDE =
  /facsimile|reprint|homage|variant|walmart|newsstand|mexican|authentix|true believers|marvel tales/i;

const lookupPriceCharting = async ({ title, issue, year }) => {
  if (!issue) {
    console.log("[pt] no issue number — skipping");
    return null;
  }
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token || !title) return null;
  try {
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    const query = issue ? `${seriesName} ${issue}` : seriesName;
    const url =
      `https://www.pricecharting.com/api/products` +
      `?q=${encodeURIComponent(query)}&type=comic&t=${encodeURIComponent(token)}`;
    console.log(`[pricecharting] query="${query}"`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[pricecharting] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const products = Array.isArray(json?.products) ? json.products : [];
    if (products.length === 0) return null;

    const issueStr = issue ? String(issue).trim() : null;
    const issueRe = issueStr
      ? new RegExp(`#${issueStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      : null;

    const comicYear = year ? parseInt(String(year).trim(), 10) : null;

    // Ship #20a.6.7b.1 — PC token overlap check. Prevents wrong-product
    // acceptance when PC returns products with similar but wrong titles
    // (e.g. "Crow Lazarus" matching "Lazarus: Fallen"). Requires at least
    // the first main token from our query to appear in the product name.
    const COMMON_TOKENS = new Set([
      'marvel', 'dc', 'image', 'idw', 'comics', 'comic',
      'book', 'the', 'a', 'an', 'of', 'and', 'in', 'for',
      'dark', 'horse', 'boom', 'archie', 'dynamite',
    ]);
    const tokenize = (s) =>
      String(s || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !COMMON_TOKENS.has(t));

    const queryTokens = tokenize(seriesName);
    const mainToken = queryTokens[0];

    for (const p of products) {
      const name = p["product-name"] || "";
      if (PRICECHARTING_EXCLUDE.test(name)) continue;
      if (issueRe && !issueRe.test(name)) continue;

      // Year validation: reject products from the wrong era.
      if (comicYear) {
        const yearMatch = name.match(/\((\d{4})\)/);
        const productYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
        if (productYear && Math.abs(productYear - comicYear) > 5) {
          console.log(`[pricecharting] skipping "${name}" — year ${productYear} vs ${comicYear}`);
          continue;
        }
      }

      // Ship #20a.6.7b.1 — Token overlap validation. Skip when the main
      // query token (first substantive word) is absent from the product name.
      if (mainToken) {
        const productTokens = tokenize(name);
        if (!productTokens.includes(mainToken)) {
          console.log(`[pricecharting] skipping "${name}" — main token "${mainToken}" absent`);
          continue;
        }
      }

      const cents = p["loose-price"];
      if (cents == null || isNaN(cents) || cents <= 0) continue;
      const price = cents / 100;
      const yearMatch2 = name.match(/\((\d{4})\)/);
      const productYear = yearMatch2 ? parseInt(yearMatch2[1], 10) : null;
      console.log(`[pt] matched: "${name}" year: ${productYear} comic year: ${comicYear}`);
      // Stricter era check: skip if year gap > 5
      if (comicYear && productYear && Math.abs(productYear - comicYear) > 5) {
        console.log(`[pt] year mismatch — skipping`);
        continue;
      }
      return { price, productName: name, id: p.id, year: productYear, source: "pricecharting" };
    }
    console.log(`[pricecharting] no valid match in ${products.length} results`);
    return null;
  } catch (err) {
    console.error(`[pricecharting] error: ${err?.message || err}`);
    return null;
  }
};

const lookupXimilar = async ({ images, title, confidence }) => {
  if (!process.env.XIMILAR_API_TOKEN) return null;
  const rawConfidence = parseFloat(
    String(confidence ?? "").replace(/[^\d.]/g, "")
  );
  const lowConfidence = !isNaN(rawConfidence) && rawConfidence < 75;
  const weakTitle = !title || String(title).trim().length < 3;
  if (!lowConfidence && !weakTitle) return null;
  if (!Array.isArray(images) || images.length === 0) return null;

  try {
    const firstImg = String(images[0] || "");
    const m = firstImg.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    const b64 = m ? m[2] : firstImg.replace(/^data:[^;]+;base64,/, "");

    const res = await fetch(
      "https://api.ximilar.com/collectibles/v2/comics_id",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.XIMILAR_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [{ _base64: b64 }] }),
      }
    );
    if (!res.ok) {
      console.error(`[enrich] ximilar HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const rec = Array.isArray(json?.records) ? json.records[0] : null;
    const idBlock =
      rec?._identification?.best_match ||
      rec?.best_match ||
      rec?._objects?.[0]?._identification?.best_match ||
      null;
    if (!idBlock) return null;
    const name = idBlock.name || idBlock.full_name || idBlock.title || null;
    const issueNumber =
      idBlock.issue_number || idBlock.issue || idBlock.number || null;
    const publisher = idBlock.publisher || null;
    const year =
      idBlock.year ||
      idBlock.publication_year ||
      (idBlock.publication_date
        ? String(idBlock.publication_date).slice(0, 4)
        : null);
    return {
      name,
      issueNumber,
      publisher,
      year: year ? String(year) : null,
      weakTitle,
    };
  } catch (err) {
    console.error(`[enrich] ximilar error: ${err?.message || err}`);
    return null;
  }
};

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

const lookupEbayVisual = async ({ imageBase64, claudeIssue }) => {
  // Ship #20a.6.7a — modern gate lifted (was: skip year>=1985), limit
  // raised 5→20 for richer consensus, structured items[] surfaced for
  // downstream cross-reference + UI inspection. Issue-consensus voting
  // unchanged: ≥3 matching #N to override Claude. Items always returned
  // (with parsed title / issue / year / variantTokens) so callers can
  // see ALL parsed rows even when consensus didn't fire.
  //
  // Token parsing lives in src/lib/imageSearchIdentity.js (pure helper,
  // bundled transitively per Ship #15 — no new function endpoint).
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId || !imageBase64) return null;
  try {
    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image" +
      "?category_ids=63&limit=20";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      body: JSON.stringify({ image: imageBase64 }),
    });
    if (!res.ok) {
      console.error(`[visual] eBay image search HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
    if (items.length === 0) return null;

    // Build structured identity rows once. Same parsed issue values feed
    // both the consensus voter below AND the surfaced items[] payload.
    const parsedRows = extractIdentityFromImageSearch(items);

    console.log('[visual] titles:', items.map((r) => r.title));
    const issueNumbers = parsedRows.map((r) => r.issue).filter(Boolean);
    console.log('[visual] extracted issues:', issueNumbers);

    const claudeStr = claudeIssue ? String(claudeIssue).trim() : null;
    const result = { items: parsedRows };

    if (issueNumbers.length > 0) {
      const freq = {};
      for (const n of issueNumbers) freq[n] = (freq[n] || 0) + 1;
      let mostCommon = null;
      let maxCount = 0;
      for (const [num, count] of Object.entries(freq)) {
        if (count > maxCount) { mostCommon = num; maxCount = count; }
      }
      console.log('[visual] winner:', mostCommon, `(${maxCount}/${issueNumbers.length})`);

      if (maxCount >= 3) {
        // Ship 8 — Vision-presence guard. Previous behavior: override
        // Vision whenever any other issue won frequency vote. This
        // produced false negatives like Thanos #11 where eBay returned
        // 4 hits for #11 and 6 hits for #3 (a more popular issue with
        // similar cover art). Frequency vote picked #3, system priced
        // wrong book. Fix: only override when Vision's issue is ABSENT
        // from eBay results entirely (zero hits). When Vision is in
        // results, even at minority count, trust Vision — it physically
        // saw the book on the user's desk.
        const claudeHits = claudeStr ? (freq[claudeStr] || 0) : 0;
        const claudeInResults = claudeHits > 0;

        if (mostCommon && claudeStr && mostCommon !== claudeStr && !claudeInResults) {
          console.log(`[visual] Claude=#${claudeStr} NOT in eBay results — using consensus #${mostCommon} (${maxCount} hits)`);
          result.issue = mostCommon;
          result.issueSource = "ebay_visual";
          result.claudeIssue = claudeStr;
        } else if (mostCommon && claudeStr && mostCommon !== claudeStr && claudeInResults) {
          console.log(`[visual] Claude=#${claudeStr} present in eBay results (${claudeHits} hits) — keeping Claude over consensus #${mostCommon}`);
          result.issue = claudeStr;
          result.issueSource = "claude_vision_confirmed";
        } else {
          console.log(`[visual] Claude=#${claudeStr} matches eBay=#${mostCommon || "none"} — keeping Claude`);
          result.issue = claudeStr;
          result.issueSource = "claude_vision";
        }
      } else {
        console.log('[visual] only', maxCount, 'matches — keeping Claude issue:', claudeStr);
      }
    }

    return result;
  } catch (err) {
    console.error(`[visual] eBay image search error: ${err?.message || err}`);
    return null;
  }
};

// Re-export pricing helpers for test compatibility
export {
  fmtUsd,
  median,
  computeThinPoolAnchor,
  computeSanityFallback,
  computeLowGradeFloor,
  getEra,
  enforceFloor,
  enforceFloorWithCap,
};

export default async function handler(req, res) {
  // A6 BUILD-ID: Inject commit hash header (Vercel auto-injects VERCEL_GIT_COMMIT_SHA)
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.CV_BUILD_ID || 'unknown';
  res.setHeader('x-cv-build', buildId);
  console.log(`[boot] Comic Vault build ${buildId}`);

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

  if (req.body?.warmup === true) {
    res.status(200).json({ warmed: true });
    return;
  }

  try {
    // A5 INPUT CAP: reject malformed body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Phase timing instrumentation — Buyer mode speed measurement.
    // All offsets are ms relative to handler entry. Logged to Vercel
    // function logs and mirrored onto out.timings for client inspection.
    const startTime = Date.now();
    const t = {};
    const mark = (label) => {
      const ms = Date.now() - startTime;
      t[label] = ms;
      console.log(`[timing] ${label}: ${ms}ms`);
    };
    mark('handler_entry');

    const {
      title,
      issue,
      grade,
      confidence,
      images,
      isGraded,
      numericGrade,
      year,
      publisher: rawPublisher,
      certNumber,
      assetType,
      author,  // Session 4B — book identity field from BOOK_PROMPT
      barcode,  // TRACK A — UPC/barcode scan
      manualIdentity,  // FIX 4 — Manual text search (title/issue/year)
      skipVision,      // FIX 4 — Skip Vision when manual identity provided
      skipImageSearch, // FIX 4 — Skip eBay image search when manual
    } = req.body || {};

    // A5 INPUT CAP: validate images array if present
    if (images && Array.isArray(images)) {
      const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB per image
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (typeof img === 'string' && img.startsWith('data:')) {
          const base64Data = img.split(',')[1] || '';
          const sizeBytes = (base64Data.length * 3) / 4;
          if (sizeBytes > MAX_IMAGE_SIZE) {
            return res.status(413).json({
              error: `Image ${i+1} exceeds 8MB limit (${(sizeBytes/1024/1024).toFixed(1)}MB)`,
            });
          }
        }
      }
    }

    // TRACK A: Barcode bypass - lookup identity from ComicVine UPC
    let barcodeIdentity = null;
    if (barcode) {
      mark('barcode_lookup_start');
      barcodeIdentity = await lookupComicVineByUPC(barcode);
      mark('barcode_lookup_complete');
      if (!barcodeIdentity) {
        console.log('[barcode] UPC not found:', barcode);
        res.status(404).json({ error: "Barcode not found in ComicVine database" });
        return;
      }
      // Inject barcode identity into pipeline
      console.log('[barcode] identity resolved:', barcodeIdentity.title, '#' + barcodeIdentity.issue);
    }

    // FIX 4: Manual identity bypass (user typed title/issue/year, no camera)
    // FIX B: Manual identity now includes publisher, grade, variant (optional fields)
    // Skip Vision + eBay image search, use provided fields as confirmed identity
    if (manualIdentity) {
      console.log('[manual] identity provided:', title, '#' + issue, year || 'no-year', rawPublisher || 'no-publisher');
    }

    // Use barcode identity if available, manual if flagged, otherwise Vision data
    // FIX B: Manual entry now passes publisher (was hardcoded null)
    const effectiveTitle = barcodeIdentity?.title || (manualIdentity ? title : title);
    const effectiveIssue = barcodeIdentity?.issue || (manualIdentity ? issue : issue);
    const effectiveYear = barcodeIdentity?.year || (manualIdentity ? year : year);
    const effectivePublisher = barcodeIdentity?.publisher || (manualIdentity ? rawPublisher : rawPublisher);

    // Strip brackets/quotes/slashes before anything downstream sees the
    // publisher — parens in "Hollywood Comics (Walt Disney)" break eBay's
    // query parser and cause ComicVine's substring scoring to miss.
    const publisher = cleanPublisher(effectivePublisher) || null;

    // Ship #1.3 — Edition warning detection (reprint/facsimile/later-print).
    // Scans Vision's reason text for reprint signals. When detected, comp pool
    // will be filtered to reprint-only listings or refuse-to-price if <3 matches.
    const editionWarning = detectEditionWarning(req.body?.reason);
    if (editionWarning?.detected) {
      console.log('[edition-gate] detected:', editionWarning.signals.join(', '));
    }

    const titleLower = (effectiveTitle || "").toLowerCase();
    if (!effectiveTitle || (!barcodeIdentity && (titleLower.includes("not a comic") || titleLower === "unknown"))) {
      console.log("[enrich] rejected non-comic:", effectiveTitle);
      res.status(400).json({ error: "Not a comic book" });
      return;
    }

    // Ship 0.6 — Move `const out = {}` declaration to top of handler.
    //
    // Previously declared at line ~2055 but referenced as early as line 1670
    // (yearBackfill) and line 1916 (edition-gate refusal). ReferenceError
    // crashed any reprint scan with thin comp pool. Caught by Ship 0.5
    // smoke harness 5/6/2026.
    //
    // Original Ships 1.3+1.4 (commit 6bd864f, 5/3/2026) introduced the
    // edition-gate writes to `out` without verifying declaration order.
    // Same bug class as Ship 12 (4f5f35a, reverted).
    //
    // Lesson encoded: variable declarations referenced across a function
    // must be at function top, not deep in execution flow.
    const out = {};

    // Session 4B — Set assetType early so identityComplete logic can use it.
    // Defaults to 'comic' when not provided (backward compatibility).
    out.assetType = assetType || 'comic';
    console.log(`[enrich-entry] assetType from req.body: ${assetType}, out.assetType: ${out.assetType}`);

    // Prefer explicit issue param, fall back to parsing from title.
    // Ship #20a.6.22 hotfix: treat "Unknown" as null (Vision failure case).
    const issueMatch = String(title).match(/#\s*(\d+)/);
    const issueRaw = issue && !/unknown/i.test(String(issue)) ? issue : null;
    const issueNum = issueRaw || (issueMatch ? issueMatch[1] : null);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: IDENTITY DETERMINATION (runs first, blocking)
    // ═══════════════════════════════════════════════════════════════════════
    // Extract eBay visual consensus BEFORE querying PC/CV/comps.
    // If eBay disagrees with Vision (<20% overlap), use eBay title for all
    // downstream queries. Prevents PC/CV from querying wrong book.

    mark('phase1_start');
    console.log(`[phase1] identity determination: Vision="${title}" #${issueNum}`);

    let visualBase64 = null;
    if (Array.isArray(images) && images.length > 0) {
      const firstImg = String(images[0] || "");
      const m = firstImg.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      visualBase64 = m ? m[2] : firstImg.replace(/^data:[^;]+;base64,/, "");
    }

    // Run eBay visual search alone to determine correct identity
    // FIX 4: Skip image search when manual identity provided
    const visualResult = (visualBase64 && !skipImageSearch)
      ? await lookupEbayVisual({ imageBase64: visualBase64, claudeIssue: issueNum }).catch(() => null)
      : null;

    // Session 4A — Category filter removes non-comic results (posters, prints,
    // collectibles) before clustering. Gracefully falls back to original pool
    // if filtering would drop below minimum threshold (5 results).
    if (visualResult?.items?.length) {
      visualResult.items = filterByCategory(visualResult.items, 'COMIC');
    }

    // Extract consensus from eBay image search results
    // visualResult.items already contains parsed rows from lookupEbayVisual
    const parsedVisualRows = visualResult?.items || [];
    const visualConsensus = extractConsensus(parsedVisualRows);

    console.log(`[phase1] eBay visual: ${visualResult?.items?.length || 0} results, consensus=${visualConsensus ? 'YES' : 'NO'}`);
    if (visualConsensus) {
      console.log(`[phase1] eBay consensus: "${visualConsensus.title}" #${visualConsensus.issue} (confidence ${(visualConsensus.confidence * 100).toFixed(0)}%)`);
    }

    // Ship #22a: Era lock from visual comp year histogram (Phase 1)
    // Extract year histogram from parsedVisualRows → consensus decade → lock ±10y
    // Threshold: ≥50% agreement. Below → era-unlocked flag, no guard.
    // E1/E2 protection: ASM #1 (1963) locks 1960s → PC "Divided We Stand" (2016) rejected.
    // Q63 FIX: Parse COVER years from comp titles (4-digit adjacent to issue tokens),
    // NOT listing/sale dates. Cavewoman (2000) must lock ~2000s, not 2020s (listing year).
    let eraLock = null;
    let eraUnlocked = false;
    if (parsedVisualRows && parsedVisualRows.length >= 3) {
      const yearHistogram = {};
      parsedVisualRows.forEach(r => {
        // Q63: Extract year tokens adjacent to issue numbers (#1 1998, 1998 #1, etc.)
        // or standalone cover years. Prefer years NEAR issue tokens (cover years),
        // ignore years far from title core (listing metadata).
        const titleLower = (r.title || '').toLowerCase();

        // Pattern 1: year near issue marker (#1 1998, #1 (1998), 1998 #1)
        const nearIssue = titleLower.match(/#\s*\d+[^\d]*(19\d{2}|20\d{2})|(\b19\d{2}|20\d{2})[^\d]*#\s*\d+/);
        if (nearIssue) {
          const year = parseInt(nearIssue[1] || nearIssue[2]);
          if (year >= 1900 && year <= 2030) {
            const decade = Math.floor(year / 10) * 10;
            yearHistogram[decade] = (yearHistogram[decade] || 0) + 1;
            return; // Found cover year, skip fallback
          }
        }

        // Pattern 2: Fallback - any 4-digit year in first half of title (likely cover year)
        const firstHalf = titleLower.slice(0, Math.floor(titleLower.length / 2));
        const yearMatch = firstHalf.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1]);
          if (year >= 1900 && year <= 2030) {
            const decade = Math.floor(year / 10) * 10;
            yearHistogram[decade] = (yearHistogram[decade] || 0) + 1;
          }
        }
      });

      const totalWithYear = Object.values(yearHistogram).reduce((sum, count) => sum + count, 0);
      if (totalWithYear >= 3) {
        const consensusEntry = Object.entries(yearHistogram)
          .sort((a, b) => b[1] - a[1])[0];

        if (consensusEntry) {
          const [decadeStr, count] = consensusEntry;
          const decade = parseInt(decadeStr);
          const ratio = count / totalWithYear;

          if (ratio >= 0.50) {
            eraLock = {
              decade,
              minYear: decade - 10,
              maxYear: decade + 19,
              confidence: ratio,
              source: 'visual_consensus'
            };
            console.log(`[22a] era-locked=${decade} consensus=${(ratio * 100).toFixed(0)}% (${count}/${totalWithYear})`);
          } else {
            eraUnlocked = true;
            console.log(`[22a] era-unlocked: consensus=${(ratio * 100).toFixed(0)}% < 50% threshold`);
          }
        }
      }
    }

    // Q78: Issue-axis visual consensus (mismatch detection + backfill)
    // Q58: Issue consensus backfill from VISUAL pool (eBay image search results).
    // When Vision missed issue (issueNum=null) AND ≥70% of visual search results
    // agree on single issue number, backfill issueNum/effectiveIssue and continue.
    // Cavewoman class: Vision "Cavewoman" no issue → visual pool 18/20 "#1".
    // Must run BEFORE resolveIdentity (line 1736) so confirmedIssue gets backfilled value.
    let issueBackfilledFromVisual = false;
    let issueBackfillProvenance = null;
    let issueFromConsensus = false;
    let issueMismatchRatio = 0;

    if (parsedVisualRows && parsedVisualRows.length >= 4) {
      const issuePattern = /#\s*(\d+)/;
      const issueCounts = {};
      parsedVisualRows.forEach(r => {
        const match = (r.title || '').match(issuePattern);
        if (match) {
          const num = match[1];
          issueCounts[num] = (issueCounts[num] || 0) + 1;
        }
      });
      const totalVisual = parsedVisualRows.length;
      const consensusEntry = Object.entries(issueCounts)
        .sort((a, b) => b[1] - a[1])[0];

      if (consensusEntry) {
        const [visualIssue, count] = consensusEntry;
        const ratio = count / totalVisual;
        const visionIssue = String(issueNum || '').trim().replace(/^0+/, '') || '';
        const visualNorm = String(visualIssue).trim().replace(/^0+/, '') || '';

        // Q78: Mismatch detection when Vision HAS issue but ≥60% visual disagrees
        if (issueNum && visionIssue && visionIssue !== visualNorm && ratio >= 0.60) {
          issueMismatchRatio = ratio;
          console.log(`[Q78-issue] visual=${visualIssue} vision=${visionIssue} mismatch=${(ratio*100).toFixed(0)}% (${count}/${totalVisual})`);

          // ≥80% mismatch → ID_REQUIRED (handled in identity blockers below)
          if (ratio >= 0.80) {
            console.log(`[Q78-issue] ≥80% mismatch → will escalate to ID_REQUIRED`);
          } else {
            // ≥60% mismatch → adopt visual consensus, flag NEEDS_REVIEW
            issueNum = visualIssue;
            issueFromConsensus = true;
            console.log(`[Q78-issue] adopted visual=${visualIssue}, flagged NEEDS_REVIEW`);
          }
        }
      }
    }

    // Q58: Backfill when Vision has NO issue (9TH ATTEMPT — entry trace added)
    console.log(`[Q58-entry] issueNum=${issueNum||'null'} visualPoolCount=${parsedVisualRows?.length||0}`);
    if (!issueNum && parsedVisualRows && parsedVisualRows.length > 0) {
      const issuePattern = /#\s*(\d+)/;
      const issueCounts = {};
      parsedVisualRows.forEach(r => {
        const match = (r.title || '').match(issuePattern);
        if (match) {
          const num = match[1];
          issueCounts[num] = (issueCounts[num] || 0) + 1;
        }
      });
      const totalVisual = parsedVisualRows.length;
      console.log(`[Q58-entry] guard: !issueNum=${!issueNum}, parsedVisualRows.length=${parsedVisualRows.length}, entering backfill block`);
      const consensusEntry = Object.entries(issueCounts)
        .sort((a, b) => b[1] - a[1])[0];
      if (consensusEntry) {
        const [issueBackfill, count] = consensusEntry;
        const ratio = count / totalVisual;
        if (ratio >= 0.70) {
          // Overwrite issueNum for resolveIdentity (line 1737)
          issueNum = issueBackfill;
          issueBackfilledFromVisual = true;
          issueBackfillProvenance = `${count}/${totalVisual} visual consensus`;
          console.log(`[Q58] backfilled issue=${issueBackfill} from ${(ratio * 100).toFixed(0)}% visual consensus (${count}/${totalVisual})`);
        }
      }
    }

    // Ship 26.2 — Title-family clustering for rank-weighted identity resolution.
    // Runs after extractConsensus to detect wrong-family pricing (Catwoman/Gotham
    // War class bugs where exact-frequency voting picks larger unrelated family
    // over correct top-ranked result).
    // Ship 3A: Pass year for era-aware overlap gate (pre-1970 requires 1 token, modern 2).
    mark('family_candidate_start');
    const familyCandidate = (visualResult?.items?.length >= 5)
      ? selectTitleFamilyCandidate(visualResult.items, title, issueNum, year)
      : null;
    mark('family_candidate_complete');

    let identityRefused = false;

    if (familyCandidate) {
      console.log(`[title-family] decision=${familyCandidate.decision}`);
      console.log(`[title-family] selected=${familyCandidate.selectedTitle || 'null'}`);
      console.log(`[title-family] reason: ${familyCandidate.reason}`);

      if (familyCandidate.topFamily) {
        console.log(`[title-family] top family: "${familyCandidate.topFamily.title}" (weight ${familyCandidate.topFamily.weightSum.toFixed(1)}, ${familyCandidate.topFamily.count} members)`);
      }
      if (familyCandidate.runnerUp) {
        console.log(`[title-family] runner-up: "${familyCandidate.runnerUp.title}" (weight ${familyCandidate.runnerUp.weightSum.toFixed(1)}, ${familyCandidate.runnerUp.count} members)`);
      }

      // Handle refused-identity-conflict: block Phase 2, comps, and pricing
      if (familyCandidate.decision === 'refused-identity-conflict') {
        identityRefused = true;
        console.log(`[title-family] refusing identity — ${familyCandidate.reason}`);
        // Will be gated below; continue to preserve card response shape
      }
    }

    // Ship 3B.3 — calculateTitleOverlap now in identityCore.js

    // Ship 3B.3 — Identity resolution now in identityCore.js
    // TRACK A: Skip identity resolution for barcode scans (100% certain)
    // FIX 4: Also skip for manual identity (user typed, no camera)
    let identity, confirmedTitle, confirmedIssue, confirmedYear, confirmedPublisher, identitySource;

    if (barcodeIdentity) {
      // Barcode provides authoritative identity
      confirmedTitle = barcodeIdentity.title;
      confirmedIssue = barcodeIdentity.issue;
      confirmedYear = barcodeIdentity.year;
      confirmedPublisher = barcodeIdentity.publisher;
      identitySource = 'barcode';
      console.log('[barcode] identity locked:', confirmedTitle, '#' + confirmedIssue);
    } else if (manualIdentity) {
      // FIX 4: Manual identity (user typed title/issue/year)
      confirmedTitle = effectiveTitle;
      confirmedIssue = effectiveIssue;
      confirmedYear = effectiveYear;
      confirmedPublisher = effectivePublisher;
      identitySource = 'manual';
      console.log('[manual] identity locked:', confirmedTitle, '#' + confirmedIssue, confirmedYear || 'no-year');
    } else {
      // Standard Vision-based identity resolution
      identity = resolveIdentity(
        { title: effectiveTitle, issue: issueNum, year: effectiveYear, publisher },
        visualConsensus,
        familyCandidate,
        { ebayResultCount: visualResult?.items?.length || 0, overlapThreshold: 0.2 }
      );
      confirmedTitle = identity.confirmedTitle;
      confirmedIssue = identity.confirmedIssue;
      confirmedYear = identity.confirmedYear;
      confirmedPublisher = identity.confirmedPublisher;
      identitySource = identity.identitySource;

      // Ship #22e: Assembly integrity check (Q54 compounds survive final title)
      // E3 class protection: "The X-Men #44 Angel" → Q54 protects ["x", "men"]
      // → assembly drops "x" → integrity check FAILS → force Vision title.
      // B1 (22e-LOSS): Phase 1 check (missing Vision tokens only; comp-consensus
      // check runs post-fetch in Phase 2).
      console.log(`[22e] checking integrity: vision="${effectiveTitle}" assembled="${confirmedTitle}"`);
      const integrityCheck = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, []);
      if (integrityCheck.shouldFallback) {
        console.log(
          `[22e] FORCED vision="${effectiveTitle}" rejected="${confirmedTitle}" ` +
          `reason=${integrityCheck.reason} missing=[${integrityCheck.missing.join(',')}]`
        );
        confirmedTitle = effectiveTitle;
        out.assemblyIntegrityFailed = true;
        out.assemblyIntegrityMissing = integrityCheck.missing;
        out.assemblyIntegrityReason = integrityCheck.reason;
      }
    }

    mark('phase1_complete');

    // Ship #28a COMMIT 3: Conflict detection (LOG ONLY)
    // Deterministic conflict detection across all data sources.
    // Ship #28b will gate AI calls on conflicts.length.
    // Ship #28a logs + stores conflicts but doesn't change AI behavior yet.
    const { detectIdentityConflicts, detectPricingConflicts, detectCompsConflicts } =
      await import('../src/lib/conflictDetector.js');

    // Note: Pricing conflicts require comp data (computed later in pipeline).
    // For now, only run identity + comps conflicts after Phase 1.
    // Full conflict suite runs after comp fetching (post-Phase 2).

    // Ship v0-G — Title contamination detection and sanitization.
    // Detects seller/marketplace noise in confirmedTitle and sanitizes before
    // downstream queries (ComicVine, PriceCharting, eBay comps). Preserves
    // original for evidence/display metadata.
    const titleOriginalBeforeSanitize = confirmedTitle;
    const titleContamination = detectTitleContamination(confirmedTitle, {
      year: confirmedYear,
      isGraded: isGraded || false,
      issue: confirmedIssue,
      publisher: confirmedPublisher
    });

    let titleSanitized = false;
    // Widen gate to catch medium severity (e.g., "champions cgc origin", "house of mystery 1965 vg")
    // Ship 3B.7 — sanitizeComicTitle now in ComicAdapter.js
    if (titleContamination.severity !== 'none') {
      const sanitized = sanitizeComicTitle(confirmedTitle, {
        year: confirmedYear,
        isGraded: isGraded || false,
        preservePublisherInTitle: true
      });

      if (sanitized !== confirmedTitle) {
        confirmedTitle = sanitized;
        titleSanitized = true;
      }
    }

    // eBay year authority — requires year-specific agreement ≥70%
    const ebayConsensusYearRaw = visualConsensus?.year;
    const ebayConsensusYearInt = ebayConsensusYearRaw
      ? parseInt(String(ebayConsensusYearRaw).trim(), 10)
      : null;
    const yearAgreementRatio = (visualConsensus?.agreement?.year || 0) /
      (visualConsensus?.agreement?.total || 1);
    const ebayYearAuthoritative = (
      Number.isFinite(ebayConsensusYearInt) &&
      ebayConsensusYearInt >= 1900 &&
      ebayConsensusYearInt <= 2099 &&
      (visualResult?.items?.length || 0) >= 10 &&
      (visualConsensus?.agreement?.year || 0) >= 8 &&
      ((visualConsensus?.agreement?.year || 0) /
       (visualConsensus?.agreement?.total || 1)) >= 0.5
    ) ? ebayConsensusYearInt : null;

    console.log(`[year-ebay] raw="${ebayConsensusYearRaw}" int=${ebayConsensusYearInt} ratio=${yearAgreementRatio.toFixed(2)} authoritative=${ebayYearAuthoritative}`);

    // Session 4B — Derive assetType server-side from eBay category + title signals.
    // MUST run BEFORE phase2 comp fetch so book category routing fires.
    // Do not trust client handoff (grade→App→enrich drops assetType repeatedly).
    // Server derivation is source of truth. Client req.body.assetType is a hint
    // only — if it arrives as 'book', trust it; otherwise derive from data we have.
    if (out.assetType !== 'book' && out.assetType !== 'comic' || out.assetType === 'comic') {
      // Count eBay results categorized as books
      const bookCatRows = (parsedVisualRows || []).filter(r =>
        (r.categories || []).some(c =>
          /book|magazine|antiquarian/i.test(c.categoryName || '')
        )
      ).length;
      const total = (parsedVisualRows || []).length || 1;
      const ebaySaysBook = bookCatRows / total >= 0.5;

      const titleSaysBook = detectBookSignals({
        title: confirmedTitle,
        issue: confirmedIssue
      });

      if (ebaySaysBook || titleSaysBook) {
        out.assetType = 'book';
        console.log(`[assetType-derive] book detected: ebayCat=${bookCatRows}/${total} titleSignals=${titleSaysBook}`);
      }
    }

    // Q32 — Merchandise detection via eBay category tree (fraud risk gate).
    // Runs AFTER book detection so book-category hits take precedence.
    // Only fires when parsedVisualRows available (image-search path only).
    // Barcode/title-search paths skip this gate (no leafCategoryIds).
    if (out.assetType === 'comic' && parsedVisualRows?.length > 0) {
      const categoryVotes = parsedVisualRows
        .map(r => inferAssetTypeFromCategories(r.leafCategoryIds))
        .filter(Boolean); // null when no category data on a row

      if (categoryVotes.length > 0) {
        const merchandiseVotes = categoryVotes.filter(v => v === 'merchandise').length;
        const merchandiseRatio = merchandiseVotes / categoryVotes.length;

        if (merchandiseRatio >= 0.5) {
          out.assetType = 'merchandise';
          out.merchandiseDetected = true;
          console.log(`[Q32] MERCHANDISE detected: ${merchandiseVotes}/${categoryVotes.length} eBay results outside comics category tree (ratio=${(merchandiseRatio*100).toFixed(0)}%)`);
        } else {
          console.log(`[Q32] merchandise vote: ${merchandiseVotes}/${categoryVotes.length} (ratio=${(merchandiseRatio*100).toFixed(0)}%) — threshold not met, keeping assetType=comic`);
        }
      }
    }

    // Session 4B — Derive author for books server-side when missing from client.
    // MUST run BEFORE phase2 comp fetch so buildBookQuery has author param.
    // Same pattern as assetType: don't trust handoff, derive from data we have.
    if (out.assetType === 'book') {
      // First check if author arrived from grade.js BOOK_PROMPT
      const authorFromGrade = author || null;

      // If not, extract from eBay titles (author name repeats across listings)
      let derivedAuthor = null;
      if (!authorFromGrade && parsedVisualRows?.length > 0) {
        // Extract capitalized name sequences from titles (excluding the book title)
        const titleLower = (confirmedTitle || '').toLowerCase();
        const nameFreq = {};

        for (const row of parsedVisualRows) {
          const title = row.title || '';
          // Match sequences of 2+ capitalized words (typical author names)
          const matches = title.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
          for (const name of matches) {
            // Skip if it's part of the book title
            if (titleLower.includes(name.toLowerCase())) continue;
            nameFreq[name] = (nameFreq[name] || 0) + 1;
          }
        }

        // Pick most frequent name (if appears in ≥30% of listings)
        const threshold = parsedVisualRows.length * 0.3;
        const candidates = Object.entries(nameFreq)
          .filter(([name, count]) => count >= threshold)
          .sort((a, b) => b[1] - a[1]);

        if (candidates.length > 0) {
          derivedAuthor = candidates[0][0];
        }
      }

      out.author = authorFromGrade || derivedAuthor || null;
      console.log(`[author-derive] reqBody=${authorFromGrade} derived=${derivedAuthor} final=${out.author}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: DATA FETCHING (runs after identity confirmed)
    // ═══════════════════════════════════════════════════════════════════════
    // Query PC/CV/comps with CONFIRMED identity (not Vision title).

    mark('phase2_start');
    console.log(`[phase2] data fetching: "${confirmedTitle}" #${confirmedIssue}`);

    // Subtitle strip helper (Ship #20a.6.15).
    const stripSubtitle = (t) => String(t || '').replace(/:.*$/, '').trim();
    const hasSubtitle = confirmedTitle && String(confirmedTitle).includes(':');
    const subtitleStripped = hasSubtitle ? stripSubtitle(confirmedTitle) : confirmedTitle;
    const pcInitialTitle = subtitleStripped; // Title used for initial PC query

    // Ship 26.3C-2 — Clean confirmedTitle before passing to ComicVine to prevent
    // artist/variant noise from matching wrong volumes (Catwoman/Gotham War class).
    const cleanedCVTitle = cleanTitleForComicVine(confirmedTitle, req.body.variant);

    // Session 6/20/26 — Cache lookups (5-min TTL, same as Anthropic prompt cache)
    // Crow fix — PC cache key MUST include year (year validation makes year-dependent results)
    const cvKey = `${cleanedCVTitle}|${confirmedIssue}|${confirmedPublisher}`;
    const pcKey = `${subtitleStripped}|${confirmedIssue}|${year || ''}`;
    const now = Date.now();

    const [comicVine, priceChartingInitial, cgcResult] = await Promise.all([
      // FIX 3 — ComicVine KV cache (persistent across cold starts)
      (async () => {
        const kvKey = `cv:${cvKey}`;
        const cached = await kvGet(kvKey);
        if (cached) return cached;
        const result = await lookupComicVine({ title: cleanedCVTitle, issue: confirmedIssue, year: confirmedYear, publisher: confirmedPublisher }).catch(() => null);
        await kvSet(kvKey, result, KV_TTL.CV);
        return result;
      })(),
      // FIX 3 — PriceCharting KV cache (persistent across cold starts)
      // Crow: Dead Time fix — try full title FIRST, fallback to stripped only if zero results
      (async () => {
        const fullTitleKey = `pc:${confirmedTitle}|${confirmedIssue}|${year || ''}`;
        const strippedTitleKey = `pc:${pcKey}`;

        // Try cache for full title first
        const cachedFull = await kvGet(fullTitleKey);
        if (cachedFull) {
          console.log('[pc-query] cache hit for full title');
          return cachedFull;
        }

        // Try cache for stripped title
        const cachedStripped = await kvGet(strippedTitleKey);
        if (cachedStripped) {
          console.log('[pc-query] cache hit for stripped title (fallback)');
          return cachedStripped;
        }

        // No cache hit — try live query with full title first
        console.log(`[pc-query] trying full title: "${confirmedTitle}"`);
        let result = await lookupPriceCharting({ title: confirmedTitle, issue: confirmedIssue, year }).catch(() => null);

        if (result) {
          console.log(`[pc-query] full title matched: "${result.productName}"`);
          await kvSet(fullTitleKey, result, KV_TTL.PC);
          return result;
        }

        // Full title returned zero results — fallback to subtitle-stripped
        if (hasSubtitle && subtitleStripped !== confirmedTitle) {
          console.log(`[pc-query] full title zero results — fallback to stripped: "${subtitleStripped}"`);
          result = await lookupPriceCharting({ title: subtitleStripped, issue: confirmedIssue, year }).catch(() => null);
          if (result) {
            console.log(`[pc-query] stripped title matched: "${result.productName}"`);
            await kvSet(strippedTitleKey, result, KV_TTL.PC);
          }
        }

        return result;
      })(),
      certNumber ? lookupCGC(certNumber).catch(() => null) : Promise.resolve(null),
    ]);
    const ximilar = null; // Ximilar lookup disabled

    mark('phase2_complete');

    // Ship #22c: AXIS VOTING convergence score
    // Computes identity confidence from multi-source voting per axis.
    // Sources: eBay (visualConsensus), Vision (original), PC (priceCharting), CV (comicVine)
    // Era histogram extracted from visual year distribution (eraLock.decade)
    const { computeConvergenceScore } = await import('../src/lib/convergenceScore.js');

    // Build sources object from Phase 1+2 data (PC/CV now available)
    const convergenceSources = {
      title: {
        ebay: visualConsensus?.title || null,
        vision: effectiveTitle,
        pc: priceChartingInitial?.title || null,
        cv: comicVine?.name || null,
      },
      issue: {
        ebay: visualConsensus?.issue || null,
        vision: effectiveIssue,
        pc: priceChartingInitial?.issue || null,
        cv: comicVine?.issue || null,
      },
      era: {
        histogram: eraLock?.decade ? `${eraLock.decade}s` : null,  // "1960s", "1970s", etc.
        vision: effectiveYear ? (parseInt(effectiveYear) >= 1985 ? 'modern' : 'vintage') : null,
        pc: priceChartingInitial?.year ? (parseInt(priceChartingInitial.year) >= 1985 ? 'modern' : 'vintage') : null,
        cv: comicVine?.volume?.startYear ? (parseInt(comicVine.volume.startYear) >= 1985 ? 'modern' : 'vintage') : null,
      },
      publisher: {
        ebay: visualConsensus?.publisher || null,
        vision: effectivePublisher,
        pc: priceChartingInitial?.publisher || null,
        cv: comicVine?.volume?.publisher?.name || null,
      },
      grade: {
        // E7: Vision issue does NOT auto-win; issue axis votes independently.
        // Grade axis is Vision-only (no eBay/PC/CV grade extraction).
        vision: req.body?.grade || null,
      },
    };

    // Compute convergence from confirmed identity
    const convergenceIdentity = {
      title: confirmedTitle,
      issue: confirmedIssue,
      era: confirmedYear ? (parseInt(confirmedYear) >= 1985 ? 'modern' : 'vintage') : null,
      publisher: confirmedPublisher,
      grade: req.body?.grade || null,
    };

    const convergence = computeConvergenceScore(convergenceIdentity, convergenceSources);
    out.convergence = convergence;
    console.log(`[22c] convergence=${convergence.convergenceScore} tier=${convergence.tier}`);

    // Log per-axis rejections for debugging
    Object.entries(convergence.axes).forEach(([axis, result]) => {
      if (result.rejections.length > 0) {
        console.log(
          `[22c] ${axis} rejections:`,
          result.rejections.map(r => `${r.source}="${r.got}" (expected "${r.expected}")`).join(', ')
        );
      }
    });

    // Ship #22b: PC Guard — era-gate filtering (PC/CV as verifiers, not originators)
    // When eraLock present AND PC/CV year vs locked era >10y → reject, persist for card.
    // E1/E2 protection: ASM #1 locked to 1963 → PC "Divided We Stand" 2016 rejected.
    const eraRejections = [];

    // Declare priceCharting here (reassignable for era-gate + requeries below)
    let priceCharting = priceChartingInitial;

    if (eraLock && priceCharting?.year) {
      const pcYear = parseInt(priceCharting.year);
      if (Number.isFinite(pcYear)) {
        if (pcYear < eraLock.minYear || pcYear > eraLock.maxYear) {
          console.log(
            `[era-gate] rejected PC "${priceCharting.productName}" (${pcYear}) ` +
            `vs locked era ${eraLock.decade}s (${eraLock.minYear}-${eraLock.maxYear})`
          );
          eraRejections.push({
            source: 'PriceCharting',
            productName: priceCharting.productName,
            year: pcYear,
            reason: `era-mismatch (${pcYear} outside ${eraLock.decade}s lock)`
          });
          priceCharting = null; // REJECT
        }
      }
    }

    if (eraLock && comicVine?.volume?.startYear) {
      const cvYear = parseInt(comicVine.volume.startYear);
      if (Number.isFinite(cvYear)) {
        if (cvYear < eraLock.minYear || cvYear > eraLock.maxYear) {
          console.log(
            `[era-gate] rejected CV "${comicVine.volume.name}" (${cvYear}) ` +
            `vs locked era ${eraLock.decade}s (${eraLock.minYear}-${eraLock.maxYear})`
          );
          eraRejections.push({
            source: 'ComicVine',
            volumeName: comicVine.volume.name,
            year: cvYear,
            reason: `era-mismatch (${cvYear} outside ${eraLock.decade}s lock)`
          });
          // Note: Do NOT null comicVine here — publisher fallback still needed
        }
      }
    }

    if (eraRejections.length > 0) {
      out.eraRejections = eraRejections;
    }

    // Publisher fallback from ComicVine when eBay/Vision didn't provide it
    confirmedPublisher = confirmedPublisher || comicVine?.volume?.publisher?.name || publisher;

    // Identity already determined in Phase 1 — construct alignment object
    const alignment = {
      confirmedTitle,
      confirmedIssue,
      confirmedYear,
      confirmedSource: identitySource,
      overrodeVision: identitySource === 'ebay_visual_override',
      visionWas: identitySource === 'ebay_visual_override' ? title : undefined,
      confidence: identitySource === 'ebay_visual_override' ? 'UNCERTAIN' : 'VERIFIED',
      authenticationScore: identitySource === 'ebay_visual_override' ? 65 : 90,
      breakdown: { title: identitySource === 'ebay_visual_override' ? 65 : 90, issue: 90, year: 85, publisher: 100 },
      conflicts: identitySource === 'ebay_visual_override' ? [{
        field: 'title',
        severity: 'CRITICAL',
        vision: title,
        ebay: confirmedTitle,
        ebayCount: visualResult?.items?.length || 0,
        message: `eBay image search (${visualResult?.items?.length || 0} results) disagrees with Vision`
      }] : [],
      needsReview: identitySource === 'ebay_visual_override',
    };

    console.log(
      `[identity] confirmed="${confirmedTitle}" #${confirmedIssue} ` +
      `source=${identitySource} ` +
      `overrode=${alignment.overrodeVision}`
    );

    if (alignment.overrodeVision) {
      console.log(
        `[identity] OVERRIDE: Vision="${alignment.visionWas}" → eBay="${confirmedTitle}"`
      );
    }

    // Q58: Surface issue backfill metadata
    if (issueBackfilledFromVisual) {
      out.issueBackfilledFromVisual = true;
      out.issueBackfillProvenance = issueBackfillProvenance;
      out.identityConfident = false;
      out.identityReasons = out.identityReasons || [];
      out.identityReasons.push('issue backfilled from visual consensus — verify manually');
    }

    // Ship #20a.6.7c — Instrumentation: log image search titles for Option B
    // design if Option A proves insufficient. Format: array of {title, tokens}
    // so we can analyze consensus behavior on the next exclusive-variant failure.
    if (visualResult?.items?.length) {
      console.log(
        '[image-search-titles]',
        JSON.stringify(
          visualResult.items.map(i => ({
            title: i?.rawTitle || i?.title,
            tokens: i?.variantTokens
          }))
        )
      );
    }

    // Q49: Deleted redundant confirmedIssue = resolveIssue(...) shadowing.
    // confirmedIssue already set correctly at Phase 1 line 1724 from resolveIdentity().
    // Second assignment here was stale (Vision+eBay only, no PC/CV corrections) causing
    // FF #133 / TMNT #8 sold-verify 100% reject (verified #133, compared vs #120).

    // Ship #20a.6.7b.2 — Image search consensus title extraction. Extract
    // consensus title (≥2 matching titles) from visual result when Vision
    // confidence is not HIGH. Ship #20a.6.7c lowered threshold from ≥3 to ≥2
    // to catch thin exclusive variants (Alan Quah Fanexpo class).
    const getImageSearchConsensusTitle = (visualResult) => {
      if (!visualResult?.items?.length) return null;
      const titles = visualResult.items.map(i => i.title).filter(Boolean);
      if (titles.length < 2) return null;
      const freq = {};
      titles.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      if (!top || top[1] < 2) return null;

      // C4: Arc-subtitle residual cleanup — strip words appearing in <40% of comp titles
      // Evidence: "Action Silver Banshee" #595, "Action Deadman" #610, goliath/secret six class
      const consensusTitle = top[0];
      const consensusWords = consensusTitle.toLowerCase().split(/\s+/).filter(w => w.length > 0);

      // For each word in consensus, check if ≥60% of comps include it
      const wordInclusion = {};
      consensusWords.forEach(word => {
        const includeCount = titles.filter(t => t.toLowerCase().includes(word)).length;
        wordInclusion[word] = includeCount / titles.length;
      });

      // Strip words with <60% inclusion (arc words, not canonical title)
      const canonicalWords = consensusWords.filter(word => wordInclusion[word] >= 0.6);

      // If stripping would remove ALL words, keep original (safety)
      if (canonicalWords.length === 0) return consensusTitle;

      // Rebuild title from canonical words, preserving original casing
      const strippedTitle = consensusTitle.split(/\s+/)
        .filter(w => canonicalWords.includes(w.toLowerCase()))
        .join(' ');

      if (strippedTitle !== consensusTitle) {
        console.log(`[C4-arc-strip] "${consensusTitle}" → "${strippedTitle}" (removed <60% words)`);
      }

      return strippedTitle || consensusTitle;
    };

    const visionConfidenceLower = String(confidence || 'medium').toLowerCase();

    // Ship 26.0 / 26.2 — Gate PC requery on accepted visual consensus OR
    // accepted family candidate. Previously, imageConsensusTitle could be
    // derived from visualResult.items frequency voting even when extractConsensus
    // rejected the pool (title <30% or issue <50% agreement). This allowed
    // wrong-family titles like "Catwoman Uncovered" to poison PC queries for
    // "Batman Catwoman Gotham War" scans.
    // Fix: only use consensus title when visualConsensus passed validation OR
    // when family candidate selected via top-rank-protection/weighted-consensus.
    const familyCandidateAccepted = familyCandidate && ['top-rank-protection', 'weighted-consensus'].includes(familyCandidate.decision);
    const imageConsensusTitle = (visualConsensus || familyCandidateAccepted)
      ? (familyCandidate?.selectedTitle || visualConsensus?.title || getImageSearchConsensusTitle(visualResult))
      : null;

    // Diagnostic: log when rejected visual consensus suppresses a requery
    if (!visualConsensus && visualResult?.items?.length >= 5) {
      const wouldHaveBeenTitle = getImageSearchConsensusTitle(visualResult);
      if (wouldHaveBeenTitle && wouldHaveBeenTitle !== pcInitialTitle) {
        console.log(`[pc-requery] gated: visualConsensus rejected, suppressed requery for "${wouldHaveBeenTitle}"`);
      }
    }

    // Ship #20a.6.16 Win #2 — PC re-query logic. If image consensus title differs
    // from Vision title AND the initial PC product might be wrong (main-token check),
    // re-query PC with consensus title. Re-query only fires ~20% of scans, adds
    // ~300-600ms when it does. Net savings: ~600-900ms per scan.
    // Ship #22b: priceCharting already declared above for era-gate (line 2071)
    if (imageConsensusTitle && imageConsensusTitle !== pcInitialTitle) {
      // Check if initial PC product passes main-token validation.
      // If PC returned null or the product name lacks the main Vision token,
      // re-query with consensus title.
      const needsRequery = !priceCharting || (() => {
        const COMMON_TOKENS = new Set([
          'marvel', 'dc', 'image', 'idw', 'comics', 'comic',
          'book', 'the', 'a', 'an', 'of', 'and', 'in', 'for',
          'dark', 'horse', 'boom', 'archie', 'dynamite',
        ]);
        const tokenize = (s) =>
          String(s || '').toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1 && !COMMON_TOKENS.has(t));
        const visionTokens = tokenize(pcInitialTitle);
        const mainToken = visionTokens[0];
        if (!mainToken) return false; // No main token to check
        const productTokens = tokenize(priceCharting.productName || '');
        return !productTokens.includes(mainToken);
      })();

      if (needsRequery) {
        mark('pc_requery_start');
        const gateSource = familyCandidateAccepted
          ? `family-candidate ${familyCandidate.decision}`
          : 'visualConsensus';
        // Ship Pattern-J — Use sanitized confirmedTitle for pc-requery instead of
        // raw imageConsensusTitle to prevent seller inventory codes (mm22, A2, etc.)
        // from contaminating PriceCharting queries. confirmedTitle has already been
        // sanitized via detectTitleContamination + sanitizeTitle at line ~1980.
        const pcRequeryTitle = confirmedTitle || imageConsensusTitle || title;
        console.log(`[pc-requery] consensus "${imageConsensusTitle}" differs from Vision "${pcInitialTitle}" — re-querying PC with "${pcRequeryTitle}" (gated: ${gateSource} accepted)`);
        priceCharting = await lookupPriceCharting({
          title: pcRequeryTitle,
          issue: confirmedIssue,
          year
        }).catch(() => null);
        mark('pc_requery_complete');
        if (priceCharting) {
          console.log(`[pc-requery] matched: "${priceCharting.productName}"`);
        }
      } else {
        console.log(`[pc-query] consensus differs but initial PC product passes main-token check — keeping initial result`);
      }
    } else if (imageConsensusTitle) {
      console.log(`[pc-query] using image consensus title: "${imageConsensusTitle}" (Vision was: "${title}")`);
    } else if (hasSubtitle && subtitleStripped !== title) {
      console.log(`[pc-query] subtitle stripped: "${title}" → "${subtitleStripped}"`);
    }

    // Ship 26.2 / Ship 12 — Canonical search title selection.
    //
    // When family candidate selected (top-rank-protection or weighted-consensus),
    // use familyCandidate.rawTitle (from top-ranked family member). This replaces
    // Ship 12 token-matching logic with rank-weighted family selection.
    //
    // Fallback to Ship 12 Approach C when family candidate not applicable:
    // For variant scans, scan visualResult.items for a candidate where ALL
    // Vision title tokens appear in the rawTitle. If no candidate matches all
    // tokens, fall back to items[0] (existing behavior preserved).
    //
    // No persistent storage — imageSearchTitle is consumed at line ~1800
    // (fetchComps) and not surfaced to the response.
    let imageSearchTitle = visualResult?.items?.[0]?.rawTitle || null;

    if (familyCandidateAccepted && familyCandidate?.rawTitle) {
      // Ship Pattern-J — rawTitle issue-mismatch guard.
      // When family rawTitle contains different issue # than consensus, skip it
      // to prevent wrong-issue comp contamination (Luke Cage #28 vs #46 class).
      try {
        const rawTitleIssue = String(familyCandidate.rawTitle || '').match(/#\s*(\d+)/)?.[1];
        // Use confirmedIssue (set at line ~1909) which holds the accepted issue.
        // Safely access all variables with explicit String() and trim to avoid any
        // undefined references. NO body.* references - all variables in scope.
        const acceptedIssue = String(
          (typeof confirmedIssue !== 'undefined' && confirmedIssue) ||
          (typeof issue !== 'undefined' && issue) ||
          (out && out.issue) ||
          ''
        ).trim();

        if (rawTitleIssue && acceptedIssue && rawTitleIssue !== acceptedIssue) {
          console.log(
            `[rawTitle-skipped-issue-mismatch] rawTitle has #${rawTitleIssue}, ` +
            `consensus is #${acceptedIssue} — using sanitized title instead`
          );
          // Use confirmedTitle + accepted issue instead of contaminated rawTitle.
          // Safely access all variables - NO body.* references.
          const fallbackTitle = String(
            (typeof confirmedTitle !== 'undefined' && confirmedTitle) ||
            (typeof title !== 'undefined' && title) ||
            (out && out.confirmedTitle) ||
            ''
          ).trim();

          if (fallbackTitle && acceptedIssue) {
            imageSearchTitle = `${fallbackTitle} #${acceptedIssue}`;
          } else {
            // Can't construct fallback — fail closed, don't use contaminated rawTitle
            imageSearchTitle = null;
            console.log(`[rawTitle-guard] fallback unavailable — skipping rawTitle`);
          }
        } else {
          // Use family candidate's rawTitle (from top-ranked family member)
          imageSearchTitle = familyCandidate.rawTitle;
          console.log(`[ship12] using title-family rawTitle: ${imageSearchTitle}`);
        }
      } catch (err) {
        console.error('[rawTitle-guard] failed:', err.message, err.stack);
        // Fail closed — don't use potentially contaminated rawTitle
        imageSearchTitle = null;
      }
    } else if (familyCandidate?.decision === 'fallback-vision') {
      // FIX A3: On fallback-vision with LOW Vision confidence, escalate to refused.
      // Mark Spears Monsters case: Vision hallucinated "Monster of Frankenstein #1 1973"
      // when eBay pool was empty and Vision confidence was implicitly low. Fallback-vision
      // blocked comps query but left confirmedTitle = fabricated Vision output.
      imageSearchTitle = null;
      const visionConfidence = String(confidence || 'medium').toLowerCase();
      if (visionConfidence === 'low') {
        console.log(`[ship12] fallback-vision + LOW Vision confidence → escalate to refused`);
        familyCandidate.decision = 'refused-identity-conflict';
        familyCandidate.reason = `Fallback-vision with LOW Vision confidence — cannot trust identity`;
        identityRefused = true;
      } else {
        console.log(`[ship12] fallback-vision — blocking unrelated visual pool from comps`);
      }
    } else {
      // Ship 12 fallback logic
      const isVariantScan = !!(
        req.body?.variant ||
        /\b(foil|virgin|variant|exclusive|sketch|incentive|1:\d+)\b/i.test(String(title || ''))
      );
      if (isVariantScan && Array.isArray(visualResult?.items) && visualResult.items.length > 0) {
      const refTitle = String(confirmedTitle || title || '').toLowerCase();
      const refTokens = refTitle.split(/\s+/).filter((t) => t.length >= 3);
      if (refTokens.length > 0) {
        const canonical = visualResult.items.find((item) => {
          const itemTitle = String(item?.rawTitle || '').toLowerCase();
          return refTokens.every((tok) => itemTitle.includes(tok));
        });
        if (canonical?.rawTitle) {
          imageSearchTitle = canonical.rawTitle;
          console.log('[ship12] variant canonical title selected:', imageSearchTitle);
        } else {
          console.log('[ship12] no canonical match found, using items[0] fallback');
        }
      }
      }
    }

    // Ship 3B.3 — Year resolution core now in identityCore.js
    // TODO-016: Era-specific detection moved to ComicAdapter in Phase 3
    // Stub remains for Phase 3 extraction — currently unused
    const keyIssueStr = req.body?.keyIssue ? String(req.body.keyIssue) : "";
    const eraSpecific = /silver age|bronze age|king[-\s]?size|giant[-\s]?size|annual|spectacular|first issue/i.test(keyIssueStr);

    const pcYear = priceCharting?.year ? parseInt(priceCharting.year, 10) : null;
    const cvYear = comicVine?.startYear
      ? parseInt(String(comicVine.startYear), 10)
      : null;

    // Ship #28a COMMIT 2: Persist PriceCharting identity anchors
    if (priceCharting) {
      out.pcProductId = priceCharting.id || null;
      out.pcProductName = priceCharting.productName || null;
      // TODO Ship #28a.2: Extract from PC HTML when available
      out.pcEbayEpid = null;  // ebay_product_id field (requires HTML parse)
      out.pcLastUpdated = null;  // last_updated timestamp (requires HTML parse)
      // TRACK B.5: PriceCharting loose/graded prices
      out.pcLoosePrice = priceCharting.loosePrice || priceCharting['loose-price'] || null;
      out.pcGradedPrice = priceCharting.cibPrice || priceCharting['cib-price'] || priceCharting.gradedPrice || null;
      console.log(`[ship28a] PC anchors: id=${out.pcProductId} name="${out.pcProductName}"`);
    }

    const yearResolution = resolveYear(
      year,
      pcYear,
      cvYear,
      ebayYearAuthoritative,
      { keyIssue: keyIssueStr }
    );

    confirmedYear = yearResolution.confirmedYear;
    let yearOverrideRejected = yearResolution.yearOverrideRejected;

    // Ship 3B.3 — Comp consensus backfill now in identityCore.js
    const backfill = backfillFromComps(
      confirmedTitle,
      confirmedYear,
      confirmedPublisher,
      visualResult?.items
    );

    // Q58-TITLE — Title backfill from comp consensus
    if (backfill.titleBackfilled) {
      confirmedTitle = backfill.title;
      out.titleBackfilledFromComps = true;
      out.titleBackfillRatio = backfill.titleBackfillRatio;
    }

    if (backfill.yearBackfilled) {
      confirmedYear = backfill.year;
      out.yearBackfilledFromComps = true;
      out.yearBackfillRatio = backfill.yearBackfillRatio;
      out.yearBackfillSource = backfill.yearBackfillSource;
    }

    if (backfill.publisherBackfilled) {
      confirmedPublisher = backfill.publisher;
      out.publisherBackfilledFromComps = true;
      out.publisherBackfillRatio = backfill.yearBackfillRatio;
    }

    // Publisher autofill from ComicVine: when publisher=null but CV volume has it, backfill.
    // Unblocks Pacific Silver Star and similar cases where Vision didn't extract publisher.
    if (!confirmedPublisher && comicVine?.volume?.publisher?.name) {
      confirmedPublisher = comicVine.volume.publisher.name;
      out.publisherBackfilledFromCV = true;
      console.log(`[cv-pub-autofill] ${confirmedPublisher} (from CV volume)`);
    }

    // Ship #20a.6.18 — Variant identity check (additive, gated). Only runs
    // on modern books (year >= 2000) with variant detected AND Vision
    // confidence not HIGH AND eBay image search returned results. Extracts
    // consensus variant from eBay listing titles (convention, artist,
    // exclusive markers, limitation). Overrides Vision variant for comp
    // query when ≥2 listings agree. Falls back gracefully: no consensus →
    // keeps Vision variant. Old books (pre-2000) skip entirely.
    let confirmedVariant = req.body.variant || null;
    let variantIdentitySource = 'vision';
    let variantConsensus = null;
    let variantOverriddenVision = false;

    // Ship 26.3B — Restrict variant extraction to selected title family when
    // family candidate fires. Prevents wrong-family variant contamination.
    // Catwoman/Gotham War: previously variant pool was 20 mixed items, electing
    // Artgerm from Catwoman Uncovered family. Now uses Gotham War family subset only.
    const variantSourceItems = (familyCandidate &&
      ['top-rank-protection', 'weighted-consensus'].includes(familyCandidate.decision) &&
      familyCandidate.topFamily?.indices &&
      Array.isArray(visualResult?.items))
      ? familyCandidate.topFamily.indices.map(i => visualResult.items[i]).filter(Boolean)
      : visualResult?.items;

    const variantCheck = extractConfirmedVariant(
      variantSourceItems,
      req.body.variant,
      confirmedYear,
      confidence
    );
    if (variantCheck) {
      confirmedVariant = variantCheck.confirmedVariant;
      variantIdentitySource = 'ebay_image_consensus';
      variantConsensus = variantCheck.consensus;
      variantOverriddenVision = variantCheck.overriddenVision;
    }

    // Step 2b: year-dependent lookups using confirmedYear.
    mark('phase2_start');

    // Ship 26.2 — Gate Phase 2 when identity refused
    if (identityRefused) {
      console.log(`[phase2] SKIPPED — identity refused by title-family clustering`);
      // Skip to response construction with refusal data
      // FIX 1: Include backfilled year/publisher in refused response
      // (backfillFromComps ran at line 1990, may have set confirmedYear/confirmedPublisher)
      const refusedOut = {
        ...sanitizeIdentityFields(req.body),
        // Override with backfilled values (if available)
        year: confirmedYear || req.body.year,
        publisher: confirmedPublisher || req.body.publisher,
        yearBackfilledFromComps: out.yearBackfilledFromComps || false,
        yearBackfillRatio: out.yearBackfillRatio || 0,
        yearBackfillSource: out.yearBackfillSource || null,
        publisherBackfilledFromComps: out.publisherBackfilledFromComps || false,
        pricingSource: 'refused-identity-conflict',
        refusedToPrice: true,
        refusalReason: familyCandidate?.reason || 'Visual pool families lack overlap with Vision',
        message: familyCandidate?.reason || 'Visual identification uncertain',
        price: null,
        priceCharting: null,
        comicVine: null,
        comps: null,
        soldComps: null,
        familyCandidateDiagnostic: familyCandidate ? {
          decision: familyCandidate.decision,
          topFamily: familyCandidate.topFamily,
          runnerUp: familyCandidate.runnerUp,
          families: familyCandidate.families
        } : null
      };
      // Ship #24a-2: refusedOut retired as a separate SHAPE — same fields
      // flow, plus the canonical contract block (state=REFUSED, price null).
      return res.status(200).json(finalizeResponse(refusedOut));
    }

    // Book-level comps cache — skip 5-9s eBay fetch on refresh.
    // Comps stored on book record with timestamp, 6-hour TTL.
    // Survives Vercel cold starts (in-memory cache does not).
    const COMPS_BOOK_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
    const bookCompsCachedAt = req.body?.compsCachedAt || null;
    const bookCompsAge = bookCompsCachedAt ? now - bookCompsCachedAt : null;
    const useBookCompsCache = bookCompsCachedAt &&
                                bookCompsAge < COMPS_BOOK_CACHE_TTL &&
                                req.body?.activeCached &&
                                req.body?.soldCompsRawCached;

    const compsPromise =
      useBookCompsCache
        ? (async () => {
            console.log(`[comps-cache] HIT from book record, age=${Math.round(bookCompsAge/60000)}min`);
            return req.body.activeCached;
          })()
        : process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID
        ? (async () => {
            const activeKey = `${confirmedTitle}|${confirmedIssue}`;
            // CACHE-BUST: skipCache flag bypasses poisoned cache entries
            const skipCache = req.body?.skipCache === true;
            const cached = !skipCache ? await kvGet(`ac:${activeKey}`) : null;
            if (cached) {
              console.log(`[active-cache] HIT: ${activeKey}`);
              return cached.data;
            }
            if (skipCache) {
              console.log(`[active-cache] SKIP: ${activeKey} — skipCache=true`);
            }
            console.log(`[comps-cache] MISS — fetching from eBay`);
            const result = await fetchComps({
              // Ship 26.3A — propagate confirmedTitle (Ship 26.2 override) into comps query.
              // Previously used original req.body.title, bypassing title-family correction.
              // Catwoman/Gotham War: confirmedTitle resolved to Gotham War, but comps queried Catwoman Uncovered.
              title: confirmedTitle,
              issue: confirmedIssue,
              grade,
              isGraded,
              numericGrade,
              year: confirmedYear,
              variant: confirmedVariant,  // Ship #20a.6.18: uses confirmed variant (eBay consensus when gate fires, Vision otherwise)
              creator: req.body.creator || null,
              publisher: publisher || null,
              imageSearchTitle,
              appId: process.env.EBAY_APP_ID,
              certId: process.env.EBAY_CERT_ID,
              // Session 4B — adapter-aware comp queries (book category 267, comic 259104)
              categoryId: getAdapter(out.assetType).ebayCategoryId,
              assetType: out.assetType,
              author: out.author || null,  // book identity field for buildBookQuery
            }).catch((err) => {
              console.error('[enrich] comps error stack:', err?.stack);
              console.error(`[enrich] comps error: ${err?.message || err}`);
              return null;
            });
            // FIX: Never cache empty/null active-comps results (prevents cache poisoning)
            // Amazing Adventures #3: bad empty value cached → replayed on every request
            // → blocked FIX 1 blend-override from ever having real data.
            if (result && result.count > 0) {
              await kvSet(`ac:${activeKey}`, result, KV_TTL.ACTIVE);
              console.log(`[active-cache] MISS: ${activeKey} — cached ${result.count} comps`);
            } else {
              console.log(`[active-cache] MISS: ${activeKey} — NOT caching (empty result)`);
            }
            return result;
          })()
        : Promise.resolve(null);

    // Ship #20a — fetchPricechartingSales userGrade is the numeric CGC
    // grade for graded books, the literal 'raw' for ungraded. Falls back
    // to req.body?.grade when numericGrade absent so a string-typed grade
    // still routes through pickUserGradeKey on the extractor side.
    const userGradeForSales =
      isGraded === true && numericGrade != null
        ? numericGrade
        : "raw";

    const [
      compsFromEbay,
      soldResult,
      goCollectResult,
      pcPop,
      pcSalesResult,
    ] = await Promise.all([
      compsPromise,
      // fetchSold (api/sold.js) currently dormant: eBay Marketplace
      // Insights API requires a gated scope unavailable to indie devs.
      // Returns [] gracefully. Kept in the pipeline so a future scope
      // approval lights it up without re-wiring. Ship #20a sources sold
      // data from PriceCharting instead (pcSalesResult below).
      fetchSold({ title, issue: confirmedIssue, year: confirmedYear }).catch(() => []),
      // Q25 FIX — GoCollect removed (100% timeout, 4.5s tax, zero returns).
      // Return null immediately instead of waiting 4.5s per scan.
      Promise.resolve(null),
      priceCharting?.id
        ? fetchPricechartingPop(priceCharting.id, req.body?.grade).catch(() => null)
        : Promise.resolve(null),
      useBookCompsCache
        ? (async () => {
            // Use cached sold comps from book record
            return { soldComps: req.body.soldCompsRawCached || [], salesByGrade: {} };
          })()
        : priceCharting?.id
        ? fetchPricechartingSales(priceCharting.id, userGradeForSales).catch(() => null)
        : Promise.resolve(null),
    ]);
    const pcSales = pcSalesResult || { soldComps: [], salesByGrade: {} };
    mark('comps_fetched');

    // Ship #28b FIX 1: Run conflict detection BEFORE AI to gate AI calls
    // Order: comps → conflicts → (gate AI on conflicts) → AI verify → claudeCheck
    const identityConflicts = detectIdentityConflicts(
      { title, issue: issueNum, year, publisher },  // Vision
      visualConsensus,  // eBay
      comicVine,  // ComicVine
      priceCharting  // PriceCharting
    );

    // Pricing conflicts require processed comp data (computed later)
    // Comps conflicts need eBay metadata (from visualResult)
    const compsConflicts = detectCompsConflicts(
      compsFromEbay,
      visualResult?.items && out.ebayLeafCategories ? out.ebayLeafCategories : []
    );

    const allConflicts = [
      ...identityConflicts,
      ...compsConflicts,
      // Pricing conflicts added after sold/active medians computed
    ];

    // Log conflicts
    console.log(
      '[ship28b-conflicts]',
      JSON.stringify({
        title: title || '?',
        issue: issueNum || '?',
        conflictCount: allConflicts.length,
        conflicts: allConflicts,
      })
    );

    // Store conflicts on out object
    out.conflicts = allConflicts;

    // AI verification pass on the comps that will be displayed. Verifies
    // each listing title from rawComps.prices (which carries titles in the
    // same order as recentSales) and filters recentSales by the returned
    // boolean array. Silent fallback: any failure leaves comps unchanged.
    let rawComps = compsFromEbay;

    // Q58: Issue consensus backfill moved to line 1677 (BEFORE resolveIdentity).
    // Extracts issue from visual pool (parsedVisualRows) instead of comp titles
    // (rawComps.prices) so backfill fires even when comp fetch skips due to missing issue.

    // Tracks the "AI verify nuked everything" case so the sanity
    // check downstream can skip rather than read compsFromEbay.average
    // (which still holds the contaminated pre-verify mean).
    // Session 4B — SKIP for books. AI verify matches issue+series; books have no issues.
    // Ship #28b FIX 1: Gate AI comp verify on conflicts
    // Zero conflicts = deterministic data, skip AI entirely
    // Has conflicts = needs AI verification to resolve
    let compsExhausted = false;
    const shouldRunAIVerify = allConflicts.length > 0 &&
                               !req.body?.skipClaudeCheck &&
                               out.assetType !== 'book' &&
                               rawComps &&
                               Array.isArray(rawComps.recentSales) &&
                               rawComps.recentSales.length > 0 &&
                               Array.isArray(rawComps.prices);

    if (shouldRunAIVerify) {
      const verifyCount = rawComps.recentSales.length;
      const titlesToVerify = rawComps.prices
        .slice(0, verifyCount)
        .map((p) => p.title || "");
      const issueMatch = String(title).match(/#\s*(\d+)/);
      const issueNum = issueMatch ? issueMatch[1] : null;
      const seriesTitle = issueMatch
        ? String(title).replace(issueMatch[0], "").trim()
        : title;
      mark('ai_verify_start');
      const keepFlags = await verifyCompsTitles({
        title: seriesTitle,
        issue: issueNum,
        year: confirmedYear,
        publisher,
        listings: titlesToVerify,
      });
      mark('ai_verify_complete');
      if (Array.isArray(keepFlags)) {
        const verifiedSales = rawComps.recentSales.filter(
          (_, i) => keepFlags[i]
        );
        const removed = verifyCount - verifiedSales.length;

        // Recompute stats from the verified subset so count, averages,
        // and low/high all reflect the AI-approved comps — no more
        // "count=3 but only 2 rows shown" inconsistency in the UI.
        const verifiedPrices = verifiedSales
          .map((s) => s.price)
          .filter(Boolean);
        const verifiedCount = verifiedPrices.length;
        const verifiedAvg = verifiedCount
          ? verifiedPrices.reduce((a, b) => a + b, 0) / verifiedCount
          : null;
        const verifiedLow = verifiedCount
          ? Math.min(...verifiedPrices)
          : null;
        const verifiedHigh = verifiedCount
          ? Math.max(...verifiedPrices)
          : null;

        // When AI verify partially rejects (>0% but <100%), flag
        // aiVerifyFallback so the sanity check can price against the
        // median of the raw prices. When AI verify rejects 100% of
        // comps, do NOT fall back — those rejected listings are
        // exactly the ones we don't trust (e.g. wrong-book Superman
        // facsimiles surfacing in an Action Comics #1 query). Their
        // median produces high-confidence wrong answers (the $109 /
        // $147,250 class of bug). When 100% rejected, compsExhausted
        // gates the entire sanity block off below.
        const aiVerifyFallback =
          verifiedCount === 0 &&
          Array.isArray(rawComps.prices) &&
          rawComps.prices.length > 0 &&
          verifyCount > 0 &&
          (verifyCount - verifiedCount) / verifyCount < 1.0;

        const verifiedPricesArray = Array.isArray(rawComps.prices)
          ? rawComps.prices.filter((_, i) => keepFlags[i])
          : [];

        rawComps = {
          ...rawComps,
          prices: verifiedPricesArray,
          recentSales: verifiedSales,
          count: verifiedCount,
          average: verifiedAvg,
          averageFormatted: fmtUsd(verifiedAvg),
          lowest: verifiedLow,
          lowestFormatted: fmtUsd(verifiedLow),
          highest: verifiedHigh,
          highestFormatted: fmtUsd(verifiedHigh),
          verifiedByAI: true,
          verificationRemoved: removed,
          aiVerifyFallback,
        };
        console.log(
          `[enrich] AI verify: kept ${verifiedCount}/${verifyCount} (removed ${removed})`
        );
        if (removed > 0) {
          const rejectedTitles = titlesToVerify.filter((_, i) => !keepFlags[i]).slice(0, 3);
          console.log('[verify] removed titles:', rejectedTitles);
        }
        if (aiVerifyFallback) {
          console.log('[verify] fallback — 0 verified of', verifyCount,
            ', will use median of', rawComps.prices.length, 'raw comps');
        }
        if (verifiedCount === 0 && verifyCount > 0) {
          compsExhausted = true;
          console.log('[verify] all comps rejected — no comp-based sanity applied');
        }
      }
    } else if (req.body?.skipClaudeCheck && rawComps?.recentSales?.length > 0) {
      console.log('[ai-comp-verify] skipped — refresh/cached (', rawComps.recentSales.length, 'comps)');
    }

    // Ship #1.3 — Edition warning comp filter. When Vision detected reprint/
    // facsimile/later-print signals, filter rawComps to reprint-only listings.
    // If <3 reprint comps remain, refuse-to-price (prevents 1st-print comps
    // from anchoring reprint book prices at 100-1000% over market).
    // Session 4B — SKIP for books. Edition warning is comic-specific (facsimile detection).
    if (out.assetType !== 'book' && editionWarning?.detected) {
      console.log(`[edition-gate] reprint/later-print detected — filtering comps`);
      const reprintComps = (rawComps?.prices || []).filter((c) =>
        /reprint|facsimile|2nd\s*print|3rd\s*print|loot.?crate|millennium/i.test(
          String(c.title || '')
        )
      );
      if (reprintComps.length < 3) {
        out.price = null;
        out.pricingSource = 'refused-reprint-thin-pool';
        out.priceNote = 'Reprint edition detected — insufficient reprint-specific comps';
        out.refusedToPrice = true;
        out.confidenceLevel = 'LOW';
        console.log(`[edition-gate] only ${reprintComps.length} reprint comps — refused to price`);
      } else {
        // Recalculate stats with reprint-only pool
        const reprintPrices = reprintComps.map((c) => c.price).filter((p) => p > 0);
        const reprintAvg = reprintPrices.length > 0
          ? reprintPrices.reduce((s, p) => s + p, 0) / reprintPrices.length
          : 0;
        const reprintLow = reprintPrices.length > 0 ? Math.min(...reprintPrices) : 0;
        const reprintHigh = reprintPrices.length > 0 ? Math.max(...reprintPrices) : 0;
        rawComps = {
          ...rawComps,
          prices: reprintComps,
          count: reprintComps.length,
          average: reprintAvg,
          averageFormatted: fmtUsd(reprintAvg),
          lowest: reprintLow,
          lowestFormatted: fmtUsd(reprintLow),
          highest: reprintHigh,
          highestFormatted: fmtUsd(reprintHigh),
          reprintFiltered: true,
        };
        console.log(
          `[edition-gate] filtered to ${reprintComps.length} reprint comps ` +
          `(avg $${reprintAvg.toFixed(2)}, was $${compsFromEbay?.average?.toFixed(2) || 'null'})`
        );
      }
    }

    // B1 (22e-LOSS): Phase 2 integrity check — token-addition rule (comp-consensus).
    // Runs AFTER comps fetched so we can validate if added tokens appear in ≥60% of comps.
    // Only applies when Phase 1 didn't already force fallback AND we have comp data.
    if (!out.assemblyIntegrityFailed && rawComps?.prices?.length >= 3 && identitySource !== 'vision') {
      const compTitles = rawComps.prices.map(p => p?.title).filter(Boolean);
      const phase2Check = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, compTitles);
      if (phase2Check.shouldFallback && phase2Check.reason === 'excess-non-consensus-tokens') {
        console.log(
          `[22e-LOSS] Phase 2 FORCED vision="${effectiveTitle}" rejected="${confirmedTitle}" ` +
          `non-consensus=[${phase2Check.added.join(',')}]`
        );
        confirmedTitle = effectiveTitle;
        out.assemblyIntegrityFailed = true;
        out.assemblyIntegrityAdded = phase2Check.added;
        out.assemblyIntegrityReason = phase2Check.reason;
      }
    }

    // Ship #20a — sold comp source. Prefer PriceCharting sales-history
    // (real eBay + Heritage completed sales) when populated; fall back to
    // soldResult (eBay Insights, currently dormant).
    //
    // Ship #20a.6 — verification chain replaces the single #issue regex.
    // verifySoldComps returns { verified, diagnostics }. The verified pool
    // is what feeds soldAvg / blendedAvg / sanity / thin-pool anchor /
    // key-mult gate / confidence below. Raw rows are surfaced (capped at
    // 20) on out.soldCompsRaw for UI debug + diagnostics shape on
    // out.soldCompDiagnostics for the "V of R verified" chip.
    //
    // Ship 6 hotfix — null-safe access. Polybag-detected books may have
    // pcSales = null because PriceCharting flow short-circuited when
    // polybag pricing fired. Crash here was the hidden 500 that
    // followed `[polybag-pool] detected:` log without warning.
    const rawSoldRows = (pcSales?.soldComps?.length || 0) > 0
      ? pcSales.soldComps
      : (Array.isArray(soldResult) ? soldResult : []);
    const userGradeKeyForSold =
      isGraded === true && numericGrade != null
        ? (Number.isInteger(numericGrade)
            ? `${numericGrade}.0`
            : String(numericGrade))
        : 'raw';
    const soldVerifyResult = verifySoldComps(rawSoldRows, {
      title: confirmedTitle,
      issue: confirmedIssue,
      variant: req.body?.variant || null,
      publisher,
      bookYear: confirmedYear || year,
      userGradeKey: userGradeKeyForSold,
      assessedGrade: grade, // Q47-FIX4: Vision/AI grade for raw scans (e.g. "FN 6.0")
    });
    const filteredSold = soldVerifyResult.verified;
    if (rawSoldRows.length > 0) {
      const d = soldVerifyResult.diagnostics;
      console.log(
        `[sold-verify] kept ${d.verifiedCount}/${d.rawCount} ` +
        `(rejected ${d.rejectedCount}: ` +
        Object.entries(d.reasons)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ') +
        ')'
      );
    }

    // BUILD 3: Recency-weighted pricing for sold comps
    // Weight recent sales 3× more than 90d+ stale sales
    const { computeRecencyWeightedPrice } = await import('../src/lib/pricingEngine.js');
    const recencyWeighted = computeRecencyWeightedPrice(filteredSold);

    // Blended average: weight sold comps (60%) + active comps (40%).
    // BUILD 3: Use recency-weighted avg instead of flat avg for sold comps
    const soldAvg = recencyWeighted.price; // BUILD 3: weighted instead of flat
    const activeAvg = rawComps?.average || null;
    let blendedAvg = null;
    if (soldAvg && activeAvg) {
      blendedAvg = (soldAvg * 0.6) + (activeAvg * 0.4);
      console.log(
        '[blend] sold:', soldAvg.toFixed(2),
        `(recency: ${recencyWeighted.recencyDays}d, fresh:${recencyWeighted.weights.fresh} recent:${recencyWeighted.weights.recent} stale:${recencyWeighted.weights.stale})`,
        'active:', activeAvg.toFixed(2),
        'blended:', blendedAvg.toFixed(2)
      );
    } else if (soldAvg) {
      blendedAvg = soldAvg * 1.1;
      console.log('[blend] sold-only:', soldAvg.toFixed(2), `(recency: ${recencyWeighted.recencyDays}d)`);
    } else if (activeAvg) {
      blendedAvg = activeAvg;
    }

    // BUILD 3: Surface recency metadata
    if (recencyWeighted.price) {
      out.recencyWeighted = {
        price: recencyWeighted.price,
        recencyDays: recencyWeighted.recencyDays,
        weights: recencyWeighted.weights,
        note: recencyWeighted.recencyDays <= 30
          ? `Price reflects last 30 days`
          : recencyWeighted.recencyDays <= 60
          ? `Price reflects last 60 days`
          : `Price includes ${recencyWeighted.weights.stale} stale comps (90d+)`
      };
    }

    // Ship #20b — Price bands (verified sold-first pricing).
    // Calculate Quick/Market/Stretch bands from verified sold comps (primary),
    // verified active comps (fallback), or PC base (last resort).
    // Apply era-aware grade multiplier to all bands.
    const eraYear = confirmedYear || year;
    let gradeMultiplier = 1;
    let gradeLabel = '';

    if (isGraded === true && numericGrade != null) {
      const gradeInfo = getGradeMultiplier(numericGrade, eraYear);
      if (gradeInfo) {
        gradeMultiplier = gradeInfo.multiplier;
        gradeLabel = `CGC ${numericGrade}`;
      }
    } else if (grade) {
      const rawInfo = getRawGradeMultiplier(grade, eraYear);
      gradeMultiplier = rawInfo.multiplier;
      gradeLabel = rawInfo.label;
    }

    const pcBase = priceCharting?.price || null;
    // Ship #20b: Pass soldVerifyResult for tier-based pricing (live recency bands)
    const priceBandsRaw = computePriceBandsFromSold({
      soldComps: filteredSold,
      activeComps: rawComps,
      pcBase,
      gradeMultiplier,
      title: confirmedTitle,
      issue: confirmedIssue,
      year: confirmedYear,
      variant: req.body?.variant || null,
      variantAdjusted: soldVerifyResult.variantAdjusted || false,
      soldVerifyResult,
    });

    if (priceBandsRaw) {
      console.log(
        `[price-bands] source=${priceBandsRaw.source} ` +
        `quick=$${priceBandsRaw.quick} market=$${priceBandsRaw.market} stretch=$${priceBandsRaw.stretch} ` +
        `count=${priceBandsRaw.count}` +
        (priceBandsRaw.recencyDays != null ? ` recency=${priceBandsRaw.recencyDays}d` : '') +
        ` gradeMult=${gradeMultiplier}`
      );
    }

    // Ship 0.6 — `out` declaration moved to handler top (line ~1303).
    // Do not redeclare here — would shadow the existing object and lose
    // any earlier writes (yearBackfill, publisherBackfill, edition-gate refusal).

    if (confirmedPublisher) {
      out.publisher = confirmedPublisher;
    }

    if (comicVine) {
      out.comicVine = comicVine;
      // TRACK B.1: Extract character_credits
      out.cvCharacterCredits = Array.isArray(comicVine.character_credits)
        ? comicVine.character_credits.map(c => ({ name: c.name, id: c.id }))
        : [];
    }

    // Ship #20a.6.18 — Variant identity fields (moved after out initialization)
    if (variantIdentitySource === 'ebay_image_consensus') {
      out.variantIdentitySource = variantIdentitySource;
      out.variantConsensus = variantConsensus;
      out.variantOverriddenVision = variantOverriddenVision;
    }

    // Ship #20b — Price bands (Quick/Market/Stretch) from tier-based pricing
    if (priceBandsRaw) {
      out.priceBands = {
        quick: fmtUsd(priceBandsRaw.quick),
        market: fmtUsd(priceBandsRaw.market),
        stretch: fmtUsd(priceBandsRaw.stretch),
        source: priceBandsRaw.source,
        count: priceBandsRaw.count,
        tier: priceBandsRaw.tier,
        variantAdjusted: priceBandsRaw.variantAdjusted || false,
      };

      // Tier-specific warnings
      if (priceBandsRaw.sanityCeilingWarning) {
        out.sanityCeilingWarning = priceBandsRaw.sanityCeilingWarning;
      }
      if (priceBandsRaw.askDerivedWarning) {
        out.askDerivedWarning = priceBandsRaw.askDerivedWarning;
      }
    }

    // Ship #21e: Surface blendedAvg for price derivation trace UI
    if (blendedAvg != null) {
      out.blendedAvg = blendedAvg;
    }

    // Ship #21 — Demand signals (velocity, trend, liquidity)
    const demandSignals = computeDemandSignals({
      soldComps: filteredSold,
      activeComps: rawComps
    });
    out.demandSignals = demandSignals;

    // BUILD 1 — Auto key detection from ComicVine character credits
    // Detects first appearances deterministically (zero AI cost, beats competitors)
    const { enhanceKeyIssue } = await import('../src/lib/autoKeyDetector.js');
    const existingKey = req.body?.keyIssue && req.body.keyIssue !== "N/A" && String(req.body.keyIssue).length > 3
      ? req.body.keyIssue
      : null;
    const keyEnhanced = enhanceKeyIssue(existingKey, comicVine);

    out.keyIssue = keyEnhanced.keyIssue;
    out.keyIssueSource = keyEnhanced.keySource || (existingKey ? 'claude' : null);
    out.autoDetectedKey = keyEnhanced.autoDetected;
    out.keyCharacters = keyEnhanced.keyCharacters;

    // Legacy logic preserved for backward compatibility (Vision/manual override priority)
    // Priority chain (highest first):
    // 1. Vision/manual keyIssue (user saw it on cover)
    // 2. ComicVine first_appearance_characters (authoritative)
    // 3. ComicVine derivedKeyIssue (from description text)
    if (!out.keyIssue) {
      const cvChars = comicVine?.firstAppearanceCharacters;
      if (Array.isArray(cvChars) && cvChars.length > 0) {
        out.keyIssue = `1st appearance of ${cvChars.join(", ")}`;
        out.keyIssueSource = 'comicvine';
        out.autoDetectedKey = true;
        out.keyCharacters = cvChars;
      } else if (comicVine?.derivedKeyIssue) {
        out.keyIssue = comicVine.derivedKeyIssue;
        out.keyIssueSource = 'comicvine-derived';
      }
    }

    // Ship #12a + Ship #16 — comp-title attribution scans.
    // Both run over the post-AI-verify pool so reprint/facsimile noise is
    // already filtered. Display-only — neither mutates out.keyIssue or
    // pricing math. Consensus (hits >= 2) surfaces on out.keyFromComps /
    // out.creatorFromComps; singletons (hits === 1) surface on the
    // *FromCompsSingleton parallels for observability.
    {
      const compTitles = Array.isArray(rawComps?.prices)
        ? rawComps.prices.map((p) => p?.title).filter(Boolean)
        : [];

      // Ship #12a — multi-key attribution.
      const keyResult = extractKeyFromComps(compTitles);
      out.keyFromComps = keyResult.consensus;
      out.keyFromCompsSingleton = keyResult.singletons;
      if (keyResult.consensus.length > 0) {
        console.log('[key-from-comps] consensus:',
          keyResult.consensus.map((e) => `${e.kind}/${e.phrase}×${e.hits}`).join(', '));
      }

      // Ship #16 — premium creator credits.
      const creatorResult = extractCreatorsFromComps(compTitles);
      out.creatorFromComps = creatorResult.consensus;
      out.creatorFromCompsSingleton = creatorResult.singletons;
      if (creatorResult.consensus.length > 0) {
        console.log('[creator-from-comps] consensus:',
          creatorResult.consensus.map((e) => `${e.tier}/${e.canonical}×${e.hits}`).join(', '));
      }
    }

    // Ship 6 retry — Polybag pricing flag. Set true by polybag detection
    // block below. When true, ALL downstream pricing blocks skip so
    // polybag price stands as final answer.
    let isPolybagPricing = false;

    // Ship 6 retry — Polybag comp pool from eBay image-search items.
    // When ≥60% of visualResult.items rawTitles match REPRINT_RE AND
    // ≥5 items have valid prices, use those active-listing prices as
    // the polybag pool with 0.75x ask-to-sold haircut. Sets
    // isPolybagPricing=true to bypass ALL downstream pricing logic.
    //
    // MOVED FROM line 1933 — original location was BEFORE `out`
    // declaration causing ReferenceError: Cannot access 'out' before
    // initialization. Now placed after metadata population, before
    // identity gate.
    if (visualResult?.items?.length >= 5) {
      const itemsWithPrice = visualResult.items.filter(
        (i) => typeof i?.price === 'number' && i.price > 0
      );
      if (itemsWithPrice.length >= 5) {
        const reprintItems = itemsWithPrice.filter((i) =>
          REPRINT_RE.test(String(i.rawTitle || ''))
        );
        const reprintRatio = reprintItems.length / itemsWithPrice.length;

        if (reprintRatio >= 0.6) {
          // Q67-C FIX: Polybag cap binding
          // ROOT CAUSE: askMedian computed from TRIMMED pool, but when ONE high outlier
          // exists ($1200+), trimming removes it → askMedian = trimmed median ($800+).
          // Then uncapped = $800 × 0.75 = $600+, but cap = poolAvg × 1.5 = $15.
          // Math.min($600, $15) SHOULD bind to $15, but production shipped $626.
          //
          // ACTUAL BUG: 0.75 haircut applied to WRONG median. Should use LOW end of
          // trimmed pool (min or P10), not median, for polybag floor pricing.
          // Polybag = reprint stock, sellers race to bottom → floor matters, not median.
          const rawPrices = reprintItems.map((i) => i.price).sort((a, b) => a - b);
          const rawMedian = rawPrices[Math.floor(rawPrices.length / 2)];

          // Trim outliers >3× median (B&B #28 Loot Crate class)
          const trimmed = rawPrices.filter(p => p <= rawMedian * 3);
          const askPrices = trimmed.length >= 3 ? trimmed : rawPrices; // Keep original if trim leaves <3

          const askLow = askPrices[0];  // Q67-C: Use LOW end, not median
          const askAvg = askPrices.reduce((a, b) => a + b, 0) / askPrices.length;

          // Q67-C: Base on LOW ask × 0.75, cap at poolAvg × 1.5
          const uncapped = askLow * 0.75;
          const cap = askAvg * 1.5;
          const polybagPrice = Math.min(uncapped, cap);
          const polybagLow = askPrices[0] * 0.75;
          const polybagHigh = Math.min(askPrices[askPrices.length - 1] * 0.75, cap);

          console.log(
            `[polybag-pool] detected: ${reprintItems.length}/${itemsWithPrice.length} ` +
            `(${(reprintRatio * 100).toFixed(0)}%) reprint titles · ` +
            `trimmed ${rawPrices.length - askPrices.length} outliers · ` +
            `askLow=$${askLow.toFixed(2)} askAvg=$${askAvg.toFixed(2)} · ` +
            `haircut=0.75 → uncapped=$${uncapped.toFixed(2)} · ` +
            `capped at poolAvg×1.5=$${cap.toFixed(2)} → final=$${polybagPrice.toFixed(2)}`
          );

          out.price = fmtUsd(polybagPrice);
          out.priceLow = fmtUsd(polybagLow);
          out.priceHigh = fmtUsd(polybagHigh);
          out.pricingSource = 'ebay-polybag-active';
          out.priceNote = 'eBay polybag listings (active asks, 0.75x haircut)';
          out.polybagDetected = true;
          out.polybagComps = reprintItems.length;
          out.polybagAskLow = askLow;
          out.polybagReprintRatio = reprintRatio;
          isPolybagPricing = true;

          // Ship 6.1 — Polybag year extraction.
          // Reprint titles often carry the actual reprint year ("POLYBAGGED 2017",
          // "Loot Crate 2020", "Facsimile 2026"). Extract any 4-digit year >= 2000
          // from polybag titles and use the highest-frequency year as the actual
          // edition year. Falls back to original year if no polybag year detected.
          const yearMatches = reprintItems
            .map((item) => {
              const matches = String(item.rawTitle || '').match(/\b(20\d{2})\b/g);
              return matches ? matches.map((y) => parseInt(y, 10)) : [];
            })
            .flat()
            .filter((y) => y >= 2000 && y <= new Date().getFullYear() + 1);

          if (yearMatches.length > 0) {
            // Most frequent year wins — handles mixed years across listings.
            const yearCounts = {};
            yearMatches.forEach((y) => { yearCounts[y] = (yearCounts[y] || 0) + 1; });
            const polybagYear = Object.entries(yearCounts)
              .sort((a, b) => b[1] - a[1])[0][0];

            console.log(
              `[polybag-year] extracted ${polybagYear} from ${yearMatches.length} title hits ` +
              `(distribution: ${JSON.stringify(yearCounts)})`
            );

            out.year = polybagYear;
            out.polybagYear = polybagYear;
            out.originalYear = String(confirmedYear || year || '');
          }

          // Ship 6.1 — Polybag edition type detection from title patterns.
          // Detects specific edition labels in seller titles to produce
          // accurate displayed title and edition tag. Falls back to generic
          // "Reprint" label if no specific edition keyword detected.
          const editionPatterns = [
            { pattern: /loot\s*crate/i, label: 'Loot Crate Reprint' },
            { pattern: /facsimile/i, label: 'Facsimile Edition' },
            { pattern: /millennium\s*edition/i, label: 'Millennium Edition' },
            { pattern: /silver\s*age\s*classics/i, label: 'Silver Age Classics' },
            { pattern: /direct\s*reprint/i, label: 'Direct Edition Reprint' },
            { pattern: /2nd\s*print|second\s*print/i, label: '2nd Print' },
            { pattern: /3rd\s*print|third\s*print/i, label: '3rd Print' },
            { pattern: /polybag/i, label: 'Polybag Reprint' },
          ];

          let editionLabel = 'Reprint';
          const editionCounts = {};
          reprintItems.forEach((item) => {
            const titleStr = String(item.rawTitle || '');
            for (const { pattern, label } of editionPatterns) {
              if (pattern.test(titleStr)) {
                editionCounts[label] = (editionCounts[label] || 0) + 1;
                break;
              }
            }
          });

          if (Object.keys(editionCounts).length > 0) {
            editionLabel = Object.entries(editionCounts)
              .sort((a, b) => b[1] - a[1])[0][0];
          }

          console.log(
            `[polybag-edition] label="${editionLabel}" ` +
            `(distribution: ${JSON.stringify(editionCounts)})`
          );

          // Override title with edition-aware label.
          // Uses confirmedTitle (cleanest source) + confirmedIssue + edition.
          const baseTitle = confirmedTitle || title || '';
          const issueStr = confirmedIssue ? ` #${confirmedIssue}` : '';
          out.title = `${baseTitle}${issueStr} ${editionLabel}`;
          out.originalTitle = baseTitle;
          out.polybagEditionLabel = editionLabel;

          // Ship 6.1 — Suppress key issue flag on polybag scans.
          // Reprints/facsimiles/Loot Crates are NOT key issues — only the
          // original first-print is the key. Without this override, polybag
          // cards display "⭐ 1st appearance of [hero]" creating a false
          // listing claim. Preserves originalKeyIssue for reference.
          if (out.keyIssue) {
            out.originalKeyIssue = out.keyIssue;
            out.originalKeyIssueSource = out.keyIssueSource;
            console.log(
              `[polybag-key-suppress] cleared "${out.keyIssue}" ` +
              `(source=${out.keyIssueSource}) — reprints are not keys`
            );
          }
          out.keyIssue = null;
          out.keyIssueSource = null;
          out.polybagSuppressedKey = true;

          // Ship 6.1 — Clear ComicVine object on polybag scans.
          // out.comicVine was assigned at line ~2046 before polybag detection
          // ran, carrying first-print volume info, characters, story arcs,
          // and creator credits. UI components reading comicVine.description
          // or comicVine.firstAppearanceCharacters would surface first-print
          // data as if it described the polybag. Preserves originalComicVine
          // for reference/debug. Final cleanup of all first-print metadata
          // paths flowing to the response shape.
          if (out.comicVine) {
            out.originalComicVine = out.comicVine;
            console.log(
              `[polybag-cv-suppress] cleared comicVine ` +
              `(volume=${out.comicVine.volume || 'null'}, ` +
              `chars=${out.comicVine.firstAppearanceCharacters?.length || 0})`
            );
          }
          out.comicVine = null;
          out.polybagSuppressedComicVine = true;

          // Ship 6 — populate out.comps with polybag listings instead of
          // first-print comps. UI reads recentSales / average / lowest from
          // out.comps. Without this override, UI shows $1200/$1500 first-print
          // sold comps alongside $9.71 polybag price = confusing/dangerous.
          out.comps = {
            count: reprintItems.length,
            average: fmtUsd(askAvg * 0.75),
            averageNum: askAvg * 0.75,
            lowest: fmtUsd(polybagLow),
            lowestNum: polybagLow,
            highest: fmtUsd(polybagHigh),
            highestNum: polybagHigh,
            lastSoldDate: null,
            recentSales: reprintItems.map((item) => ({
              price: item.price * 0.75,
              priceFormatted: fmtUsd(item.price * 0.75),
              title: item.rawTitle,
              date: item.endTime || null,
              daysAgo: null,
              itemWebUrl: item.itemWebUrl || null,
            })),
            query: 'polybag-pool',
            fellBack: false,
            source: 'ebay-polybag-active',
            verifiedByAI: false,
            verificationRemoved: 0,
          };
        }
      }
    }

    // Q32 — Merchandise hard gate (fraud risk). Runs BEFORE identity gate so
    // assetType=merchandise blocks pricing pipeline entirely. Forces RESEARCH
    // decision with clear blocker message.
    if (out.assetType === 'merchandise') {
      out.identityComplete = false;
      out.decision = {
        action: 'DO_NOT_LIST',
        confidence: 'HIGH',
        blockers: ['Non-comic asset detected — verify item type before listing'],
        warnings: [],
        nextSteps: [
          'Confirm this is a comic book, not merchandise/collectible',
          'Re-scan if item was misidentified',
          'Check eBay visual results for category contamination'
        ],
      };
      console.log('[Q32] MERCHANDISE HARD BLOCK — refusing to price, decision=DO_NOT_LIST');
      // Ship #24a-2: contract state=LOCKED via DO_NOT_LIST hard lock
      return res.json(finalizeResponse(out)); // STOP — no pricing, return early
    }

    // Ship #20a.6.4 — identity gate. Runs AFTER phase 1 (so PC/CV year-heal
    // chain has applied → confirmedYear; visual issue correction → confirmedIssue;
    // publisher cleanup → publisher) and BEFORE the pricing block. When
    // identity-critical fields can't be cleanly extracted, refuses to price
    // entirely. Vision's price/priceLow/priceHigh are NOT used as a fallback —
    // out.price is set to null explicitly so the client merge ("enrich.price ||
    // cur.price") replaces, not preserves, Vision's guess.
    //
    // Surfaced 2026-04-27 phone validation: Donald Duck Whitman #978 priced
    // $50 with Vision returning "Cannot determine from visible cover" as
    // literal issue value. Real Golden Age key in same shape would be 10× wrong.
    const sanitizedIdentity = sanitizeIdentityFields({
      title: confirmedTitle,
      issue: confirmedIssue,
      year: confirmedYear,
      publisher: confirmedPublisher,
      visionConfidence: confidence,
      author: out.author || null,  // Session 4B — book identity field (server-derived)
    });
    // Session 4B — Pass adapter identityFields for asset-aware confidence check
    // Crow Dead Time fix — pass pcProductId to allow publisher skip when PC matched a real product
    const adapter = getAdapter(out.assetType);
    const idCheck = assessIdentityConfidence(sanitizedIdentity, identitySource, adapter.identityFields, out.pcProductId);
    console.log(`[identity-gate] assetType=${out.assetType} fields=${JSON.stringify(adapter.identityFields)} missing=${JSON.stringify(idCheck.missingFields)}`);

    // B4: Enhanced diagnostic logging for identity-gate refusals
    if (!idCheck.confident) {
      console.log(
        '[B4-DIAGNOSTIC] identity-gate BLOCK:',
        `title="${confirmedTitle}"`,
        `issue="${confirmedIssue}"`,
        `year="${confirmedYear}"`,
        `publisher="${confirmedPublisher}"`,
        `confidence="${confidence}"`,
        `source="${identitySource}"`,
        `pcProductId="${out.pcProductId || 'null'}"`,
        `sanitized=${JSON.stringify(sanitizedIdentity)}`,
        `missing=[${idCheck.missingFields.join(',')}]`,
        `reasons=[${idCheck.reasons.join('; ')}]`
      );
    }

    out.identityConfident = idCheck.confident;
    if (!idCheck.confident) {
      out.identityMissingFields = idCheck.missingFields;
      out.identityReasons = idCheck.reasons;
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.pricingSource = 'identity-required';
      console.log(
        '[identity-gate] REFUSED to price —',
        'missing:', idCheck.missingFields.join(',') || '(none)',
        '· reasons:', idCheck.reasons.join('; ')
      );
    }

    // Hoisted out of the pricing block so the [price-trace] log below has
    // these in scope when the gate fires (pricing block is skipped entirely).
    let sanityFired = false;
    let floorNum = 0;
    let floorFired = false;
    let priceAfterFloor = 0;
    let isMegaKeyForFloor = false;

    // Ship #20b — Primary price source: Price Bands (verified sold-first pricing).
    // STEP 1: Verified sold comps (min 2) → Quick/Market/Stretch bands
    // STEP 2: Verified active comps (min 2) → Quick/Market/Stretch bands
    // STEP 3: PC base (last resort) → synthetic bands
    // Fallback: Legacy PC/browse API logic (when price bands unavailable).
    //
    // Ship #20a.6.4: entire pricing flow gated by identity confidence. When
    // gate fires, this whole block is skipped. Comps/sold/pop reference data
    // (already populated above) still surfaces on the response so the user
    // can see what eBay/PC found, but no price recommendation is produced.
    // P0-A — Skip entire pricing block when polybag pricing active. Polybag path
    // (line ~2994) already set out.price/pricingSource. Without this guard, code
    // falls through all `!isPolybagPricing`-gated pricing branches and hits final
    // `else` which overwrites pricingSource='ebay-polybag-active' with 'refused'.
    if (idCheck.confident && !isPolybagPricing) {
    // P0-A — Kill browse_api legacy paths. All pricing routes through tier engine.
    // When priceBandsRaw truthy (tier 1-4 with data), use it. When null (tier-4
    // no-data: no PC, <2 verified comps), refuse-to-price instead of falling through
    // to legacy PC/browse_api escape hatches which bypass tier selection.
    // Evidence: 3/21 production records pricingSource=browse_api (Punisher #1
    // $39.85 LIST_NOW vs $20.98 tier-3 gate). Legacy paths killed below.
    if (priceBandsRaw) {
      // Ship #20b — Use price bands as primary pricing source (tier 1-4 with data).
      out.price = fmtUsd(priceBandsRaw.market);
      out.priceLow = fmtUsd(priceBandsRaw.quick);
      out.priceHigh = fmtUsd(priceBandsRaw.stretch);
      out.gradeMultiplier = gradeMultiplier;
      // #20b-FIX1: Map tier sources to display labels
      const tierSourceMap = {
        'tier1_recency_weighted': 'verified_sold_recency',
        'tier2_blend_70_30': 'sold_active_blend_30',
        'tier2_sold_only': 'verified_sold',
        'verified_sold_stale': 'verified_sold_stale',  // Q71: tier-2.5 stale-sold source
        'tier3_active_discounted': 'active_ask_derived',
        'tier4_pc_estimate': 'pc_estimate',
        // Legacy sources (pre-tier)
        'verified_sold': 'verified_sold',
        'verified_active': 'verified_active',
        'verified_sold_active_blend': 'verified_sold_active_blend',
      };
      out.pricingSource = tierSourceMap[priceBandsRaw.source] || 'pc_estimate';

      // Ship #24 — source-specific comp count. priceBandsRaw.count reflects
      // the pool that calculatePriceBands() received (sold comps when source
      // is verified_sold, active comps when source is verified_active). For
      // blended sources, sum BOTH pools. For active-only, read rawComps.count
      // (the AI-verified active pool) instead of priceBandsRaw.count (which
      // would be the sold pool size, potentially zero).
      let displayCount = priceBandsRaw.count;
      if (out.pricingSource === 'verified_active' && rawComps?.count != null) {
        displayCount = rawComps.count;
      } else if (out.pricingSource === 'verified_sold_active_blend') {
        const soldCount = priceBandsRaw.count || 0;
        const activeCount = rawComps?.count || 0;
        displayCount = soldCount + activeCount;
      }

      let priceNoteBase = gradeLabel
        ? `${gradeLabel} · ${displayCount} verified comps`
        : `${displayCount} verified comps`;

      // Variant fallback warning — user should verify variant premium manually
      if (priceBandsRaw.variantAdjusted) {
        priceNoteBase += ' · variant-adjusted (verify premium)';
      }

      out.priceNote = priceNoteBase;

      console.log(
        `[price-bands-pricing] market=${priceBandsRaw.market.toFixed(2)} ` +
        `source=${out.pricingSource} count=${priceBandsRaw.count} ` +
        `gradeMult=${gradeMultiplier}` +
        (priceBandsRaw.variantAdjusted ? ' VARIANT-ADJUSTED' : '')
      );
    } else if (rawComps && rawComps.count > 0) {
      // P0-A — LEGACY PATH (DEPRECATED). This path fires when tier-4 returned null
      // (no PC match) but rawComps exist (1-2 verified active comps, below tier-3
      // threshold of 3). Tier-based pricing should handle this with adaptive threshold.
      // Kept temporarily with diagnostic logging; will be deleted after confirming
      // tier-3 adaptive threshold covers this edge case. If you see this log in
      // production, the tier-3 threshold should be lowered from 3 to 1.
      console.warn(
        '[P0-A-LEGACY-PATH] browse_api fallback fired — tier-4 null, rawComps exist.',
        'rawComps.count:', rawComps.count,
        'title:', title,
        'issue:', confirmedIssue
      );
      // P0-A TEMPORARY: refuse-to-price instead of using browse_api average.
      // This path bypasses tier selection and can leak contaminated comps.
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.pricingSource = 'refused-tier-bypass-detected';
      out.priceNote = `Insufficient verified comps (${rawComps.count}) — try refresh or edit fields`;
      out.refusedToPrice = true;
      out.confidenceLevel = 'LOW';
      console.log(
        '[P0-A-refuse] tier-bypass path blocked —',
        'rawComps.count:', rawComps.count,
        'priceBands:', !!priceBandsRaw
      );
    } else {
      // P0-A: Deleted dead code block (lines 3361-3387, else-if-false browse_api path).
      // 48h monitor waived — block already refused to price via tier-bypass guard above.
      // PC path below is final fallback after tier engine.
      // Ship 21 — Silent-empty refusal with diagnostic.
      //
      // The pricing chain has three branches: priceBands, priceCharting,
      // browse_api. When all three fail (no verified comps, no PC match,
      // no Browse API results), the chain previously had no else clause.
      // Response returned with undefined pricingSource/refusedToPrice,
      // confusing UI merge logic and showing stale or empty pricing.
      //
      // Production cases 2026-05-06:
      //   Amazing Spider-Man #282 (1986) — common book returned empty
      //   Limited Collectors C-44 (post-Ship-15) — gate ok but pricing empty
      //
      // This else clause forces explicit refusal so UI can show the user
      // what to do (refresh, edit fields, accept book is uncomputable).
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.pricingSource = 'refused-no-data-sources';
      out.priceNote = 'No pricing sources returned data — try refresh or edit title/issue/year';
      out.refusedToPrice = true;
      out.confidenceLevel = 'LOW';
      console.log(
        '[refuse-to-price] no-data-sources —',
        'priceBands:', !!priceBandsRaw,
        'PC:', !!(priceCharting && priceCharting.price),
        'rawComps:', (rawComps && rawComps.count) || 0
      );
    }

    // Ship 13 — editionWarning must reach response for ALL code paths,
    // including mega-key books and comps-exhausted cases. Previously
    // misplaced inside the sanity-fallback else block, which mega-keys
    // skip via line 2483 short-circuit. Caused Detective #27 reprint and
    // B&B #28 Loot Crate to lose editionWarning from response, hiding
    // edition warning UI banner. Caught by Ship 0.5 harness 2026-05-06.
    if (editionWarning) out.editionWarning = editionWarning;

    // Surface artistFallback / compBasis for browse_api-only books too
    // (the priceCharting branch already sets these, but not the
    // browse-only branch). Safe to set unconditionally — no-op when the
    // flag is already true.
    if (rawComps?.artistFallback && !out.artistFallback) {
      out.artistFallback = true;
      out.compBasis = rawComps.compBasis || 'generic-variant-fallback';
    }

    // Filter bypass flag — set in both pricing branches (PC + browse).
    // Universal flag: era filter (comics) or set filter (cards) bypassed.
    if (rawComps?.eraFilterBypassed || out.matchConfidence?.eraFilterBypassed) {
      out.filterBypassDetected = true;
    }

    // Ship 14 — Variant multiplier applies to ALL pricing paths that use
    // unfiltered comp pools. Previously gated to pricingSource ===
    // 'pricecharting' only. Three paths were incorrectly excluded:
    //
    //   verified_active — mixed comp pool (active filter only fires when
    //                     variant is null), needs newsstand compensation
    //   pc_estimate     — generic PriceCharting API price (no variant
    //                     specificity), needs compensation
    //   browse_api      — mixed comp pool (sanity/raw fallbacks), needs
    //                     compensation
    //
    // verified_sold remains EXCLUDED because Ship 18 strict variant filter
    // already restricts sold comps to matching variant tier — applying
    // multiplier would double-count the newsstand premium.
    //
    // Pre-Ship-14 production case: Marvel Saga #18 (1987 newsstand) priced
    // at $3.99 via pc_estimate path. Ship 7 era multiplier (1.2× for
    // 1985-1995) skipped, underpriced ~20%. Should price ~$4.79.
    const VARIANT_MULT_ELIGIBLE_SOURCES = new Set([
      'pricecharting',
      'pc_estimate',
      'verified_active',
      'browse_api',
    ]);
    const isFromPC = !!(priceCharting?.price) && !sanityFired && VARIANT_MULT_ELIGIBLE_SOURCES.has(out.pricingSource);

    // Floor guard: never price below the lowest eBay comp.
    // eBay comps already reflect market grade — no grade multiplier on floor.
    // Floor is capped at compsAvg to prevent exceeding market.
    //
    // Same skip conditions as the sanity block above (Ship #1 Surface B):
    //   1. Mega-keys: floor map at api/mega-keys.js is the source of
    //      truth. The eBay-comps floor here would override clean PC × mult
    //      with `compsFromEbay.lowest` — for Golden/Silver mega-keys this
    //      is dominated by reprints/facsimiles/wrong-book entries (the
    //      $145K Action #1 from Superman #1 comps class of bug).
    //   2. compsExhausted: AI verify rejected 100% of comps. `rawComps.lowest`
    //      is null but `compsFromEbay.lowest` still holds the pre-verify
    //      contaminated lowest — same untrusted data the sanity block skips.
    isMegaKeyForFloor = !!getMegaKeyEntry(title, confirmedIssue, confirmedPublisher, confirmedYear || year);

    // #20b-FIX2 [P0]: Gate legacy ask-floor when tier path active.
    // Tier pricing owns floor enforcement (priceBands.quick = verified-sold low).
    // Legacy rawComps.lowest (ask-based) was overwriting tier market prices.
    // Evidence: Batman #222 tier=1 market=$122 → legacy floor=$173 (ask-derived).
    const tierPathActive = priceBandsRaw && priceBandsRaw.tier != null;

    if (isPolybagPricing) {
      console.log('[floor] skipped — polybag pricing active');
    } else if (isMegaKeyForFloor) {
      console.log('[floor] skipped — mega-key uses floor map');
    } else if (compsExhausted) {
      console.log('[floor] skipped — all comps rejected by AI verify');
    } else if (tierPathActive) {
      console.log(`[floor] skipped — tier ${priceBandsRaw.tier} owns floor enforcement (verified-sold low only)`);
    } else {
      const finalNum = parseFloat(
        String(out.price || '0').replace(/[$,]/g, '')
      );
      // Fix C (Phase 1): use grade-filtered lowest for floor guard.
      // Prevents VG 4.0 books from anchoring to FR 1.0 listings.
      // Falls back to global lowest when grade filter wasn't applied.
      const gradeAwareFloor = rawComps?.gradeFilteredLowest ?? rawComps?.lowest;
      const rawFloor = gradeAwareFloor || compsFromEbay?.lowest || 0;
      const compsAvgForCap = blendedAvg || compsFromEbay?.average || 0;

      const enforcedFloor = enforceFloorWithCap(finalNum, rawFloor, compsAvgForCap);

      if (enforcedFloor !== null) {
        floorFired = true;
        floorNum = enforcedFloor;

        // Log cap if applied
        if (rawFloor > compsAvgForCap && compsAvgForCap > 0) {
          console.log('[floor] capped at comps avg', compsAvgForCap.toFixed(2));
        }

        console.log('[floor] price', finalNum,
          '< floor', enforcedFloor, `(raw ${rawFloor}, cap ${compsAvgForCap})`, '— enforcing');
        out.price = fmtUsd(enforcedFloor);
        out.priceLow = fmtUsd(enforcedFloor * 0.85);
        out.priceHigh = fmtUsd(enforcedFloor * 1.25);
        out.priceNote = (out.priceNote || '') + ' · floor enforced';
      }
    }

    // Ship #13.1: snapshot price RIGHT HERE (post-floor, pre-
    // variant/key/anchor/mega-key) so `[price-trace]` below can show
    // afterMult = "what PC × gradeMult + sanity + floor produced" while
    // `finalPrice` shows the actual returned value after every downstream
    // adjustment. Without this snapshot the log would lose the pre-
    // multiplier baseline as soon as variant mult rewrote out.price.
    priceAfterFloor = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));

    // Variant multiplier: adjust price for known variant types.
    // Only apply when PriceCharting is the pricing source — browse_api/ebay_avg
    // already reflect market for this specific variant.
    const variant = req.body.variant ? String(req.body.variant).trim() : null;
    // Ship 6 — skip variant multiplier when polybag pricing active.
    if (variant && out.price && isFromPC && !isPolybagPricing) {
      const NO_PREMIUM = [
        'corner box', 'masterpieces', 'design variant', 'headshot',
        'trading card', 'cover a', 'cover b', 'cover c', 'cover d',
        'marvel legacy', 'legacy',
      ];
      const vLower = variant.toLowerCase();
      const isNoPremium = NO_PREMIUM.some((v) => vLower.includes(v));
      if (isNoPremium) {
        out.variantNote = variant;
        console.log('[variant] no premium — skipping mult');
      } else {
        // Ordered by descending multiplier so the higher-premium match wins
        // when a variant string contains multiple keywords (e.g.
        // "canadian price variant" must hit `canadian price` before
        // `price variant`).
        const variantMultipliers = {
          'triple cover': 10.0,
          'double cover': 8.0,
          '35¢': 6.0,
          '35 cent': 6.0,
          '30¢': 4.0,
          '30 cent': 4.0,
          'inverted': 4.0,
          'gold': 3.0,
          'printing error': 3.0,
          'miscut': 3.0,
          'mark jewelers': 2.5,
          'canadian price': 2.0,
          'price variant': 2.0,
          'type 1a': 2.0,
          'type 1b': 2.0,
          'canadian': 1.8,
          'whitman': 1.8,
          '2nd print': 1.5,
          'second print': 1.5,
          'pence': 1.5,
          'dc universe logo': 1.5,
          // Ship 7 — newsstand removed from flat table; era-aware logic
          // runs BEFORE this table lookup. Pre-1985: 1.0× (default print
          // run, no premium). 1985-1995: 1.2×. 1996-2000: 1.5×. 2001-2013:
          // 2.5×. Post-2013: null (Marvel/DC killed newsstand).
        };
        let vMult = null;

        // Ship 7 — Era-aware newsstand multiplier (runs BEFORE table lookup).
        // Newsstand premium varies dramatically by year:
        //   pre-1985: 1.0×  (was the DEFAULT print run, no premium)
        //   1985-1995: 1.2× (direct market growing, newsstand still common)
        //   1996-2000: 1.5× (direct dominant, newsstand becoming scarce)
        //   2001-2013: 2.5× (newsstand <10% print run, scarce)
        //   post-2013: null (Marvel killed newsstand 2013, DC in 2017)
        // Calibrated against mega-keys.js note "NEWSSTAND commands 2-4×
        // direct edition" and observed eBay sold data on Anti-Venom #569,
        // X-Men v4 #1, etc. Surfaces newsstandEra for telemetry.
        if (vLower.includes('newsstand')) {
          const yr = parseInt(confirmedYear || year || 0, 10);
          let newsstandMult = null;
          let newsstandEra = null;
          if (yr >= 1 && yr < 1985) {
            newsstandMult = 1.0;
            newsstandEra = 'pre-1985-default';
          } else if (yr >= 1985 && yr <= 1995) {
            newsstandMult = 1.2;
            newsstandEra = '1985-1995-modest';
          } else if (yr >= 1996 && yr <= 2000) {
            newsstandMult = 1.5;
            newsstandEra = '1996-2000-scarce';
          } else if (yr >= 2001 && yr <= 2013) {
            newsstandMult = 2.5;
            newsstandEra = '2001-2013-rare';
          } else if (yr > 2013) {
            newsstandEra = 'post-2013-discontinued';
          }
          if (newsstandMult !== null && newsstandMult > 1.0) {
            vMult = newsstandMult;
            out.newsstandEra = newsstandEra;
            out.newsstandMultiplier = newsstandMult;
            console.log(
              `[variant] newsstand era=${newsstandEra} year=${yr} mult=${newsstandMult}×`
            );
          } else {
            out.newsstandEra = newsstandEra;
            console.log(
              `[variant] newsstand era=${newsstandEra} year=${yr} — no premium applied`
            );
          }
        }

        // Standard variant table lookup. Skipped if Ship 7 newsstand block
        // already set vMult. Catches non-newsstand variants (price variants,
        // canadian, whitman, 2nd prints, etc.).
        for (const [key, mult] of Object.entries(variantMultipliers)) {
          if (!vMult && vLower.includes(key)) {
            // Test-market price-variant gate (Ship #9 + #10). Vision
            // labels any 35¢ / 30¢ price box as a test-market variant,
            // but those are also standard cover prices outside the
            // 1976-1977 windows. Only honor the multiplier when
            // (title, issue) is in the canonical allowlist; otherwise
            // fall through and try the next variant key. Pattern
            // extends trivially to Whitman, Mark Jewelers, etc. by
            // adding entries to TEST_MARKET_KEYS + TEST_MARKET_VARIANTS.
            if (key in TEST_MARKET_KEYS) {
              const variantType = TEST_MARKET_KEYS[key];
              if (!isTestMarketVariant(title, confirmedIssue, variantType)) {
                console.log(
                  `[variant] ${variantType} allowlist miss — skipping mult`,
                  `title="${normalizeTitle(title)}" issue=${confirmedIssue}`
                );
                continue;
              }
              console.log(
                `[variant] ${variantType} test-market match`,
                `title="${normalizeTitle(title)}" issue=${confirmedIssue}`
              );
            }
            vMult = mult;
            break;
          }
        }
        if (vMult) {
          // Ship #13 Bug 4: composition-aware damping. When the comp
          // pool is dominated by variant listings (>80% match
          // VARIANT_CONTAM_RE), the variant premium is already baked
          // into the floor/avg — applying the full vMult on top
          // double-counts. Tiered damping keeps the mult accurate for
          // mixed pools while taming homogeneous-variant pools.
          const originalMult = vMult;
          let variantComposition = null;
          if (rawComps && Array.isArray(rawComps.prices) && rawComps.prices.length > 0) {
            const variantHits = rawComps.prices.filter((p) =>
              VARIANT_CONTAM_RE.test(String(p?.title || ''))
            ).length;
            const ratio = variantHits / rawComps.prices.length;
            let damping = 1.0;
            if (ratio > 0.80) damping = 0.5;
            else if (ratio > 0.50) damping = 0.75;
            // else: ≤50% → full mult (no damping)
            if (damping < 1.0) {
              vMult = vMult * damping;
              console.log(
                `[variant-composition] ratio=${ratio.toFixed(2)} damping=${damping} mult ${originalMult}→${vMult}`
              );
            } else {
              console.log(
                `[variant-composition] ratio=${ratio.toFixed(2)} damping=1.0 (no change)`
              );
            }
            variantComposition = {
              ratio: Number(ratio.toFixed(2)),
              dampedMult: vMult,
              originalMult,
              compCount: rawComps.prices.length,
            };
          }

          const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
          out.price = fmtUsd(curPrice * vMult);
          out.priceLow = fmtUsd(curPrice * vMult * 0.75);
          out.priceHigh = fmtUsd(curPrice * vMult * 1.25);
          out.variantNote = variant;
          out.variantMultiplier = vMult;
          if (variantComposition) out.variantComposition = variantComposition;
          console.log('[variant]', variant, '×', vMult);
        }
      }
    }

    // Key issue multiplier: tiered — major keys ×1.5, minor keys ×1.2.
    // Only apply when PriceCharting is the pricing source — browse_api/ebay_avg
    // already reflect market premium for the key.
    const keyStr = String(out.keyIssue || '').toLowerCase();
    const isMajorKey = keyStr.includes('1st appearance') ||
      keyStr.includes('first appearance') ||
      keyStr.includes('origin') ||
      keyStr.includes('death') ||
      keyStr.includes('first issue');
    const isMinorKey = !isMajorKey && (
      keyStr.includes('2nd appearance') ||
      keyStr.includes('second appearance') ||
      keyStr.includes('2nd') ||
      keyStr.includes('second app') ||
      keyStr.includes('first cover') ||
      keyStr.includes('cameo') ||
      keyStr.includes('iconic') ||
      keyStr.includes('classic')
    );
    const keyMult = isMajorKey ? 1.5 : isMinorKey ? 1.2 : 1.0;
    console.log('[key] keyIssue:', out.keyIssue, 'major:', isMajorKey, 'minor:', isMinorKey, 'mult:', keyMult, 'isFromPC:', isFromPC);
    // Ship 1.6.1 — key multiplier must work across all pricing sources.
    // Previous gate required isFromPC && blendedAvg, which silently
    // no-op'd whenever priceBands fired (verified_sold/verified_active).
    // Captain America #359 (1st Crossbones cameo, 23 sources) was
    // priced at $6.70 with no multiplier instead of $7.50–$9 range.
    // Ship 6 — Skip key multiplier when polybag pricing active.
    if (keyMult > 1.0 && out.price && isPolybagPricing) {
      console.log('[key] SKIPPED — polybag pricing active (no key premium for reprints)');
    } else if (keyMult > 1.0 && out.price) {
      const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      if (curPrice > 0) {
        // Determine multiplier base: blendedAvg (PC source) or current price (price-bands)
        let keyMultBase;
        let keyMultBaseSource;
        if (isFromPC && blendedAvg) {
          keyMultBase = blendedAvg;
          keyMultBaseSource = 'blendedAvg';
        } else if (out.pricingSource === 'verified_sold' || out.pricingSource === 'verified_active') {
          keyMultBase = curPrice;
          keyMultBaseSource = 'priceBandsMarket';
        }
        if (keyMultBase) {
          const newPrice = keyMultBase * keyMult;
          const ratio = newPrice / curPrice;
          // Sanity ceiling: only apply if multiplier would change price
          // by less than 50% in either direction. Prevents thin-pool
          // edge cases from blowing up.
          if (ratio <= 1.5 && ratio >= 0.67) {
            out.price = fmtUsd(newPrice);
            out.priceLow = fmtUsd(newPrice * 0.75);
            out.priceHigh = fmtUsd(newPrice * 1.25);
            out.keyMultiplier = keyMult;
            out.keyMultBaseSource = keyMultBaseSource;

            // Ship #24 — preserve blend-sourced label when key mult applied to blendedAvg.
            // Without this, blend-derived pricing shows as 'pc_estimate' even though the
            // base came from verified sold+active comps (Street Fighter G.I. #1 case).
            if (keyMultBaseSource === 'blendedAvg' && out.pricingSource === 'pc_estimate') {
              out.pricingSource = 'verified_sold_active_blend';
            }

            console.log('[key]', isMajorKey ? 'major' : 'minor',
              `×${keyMult} (base=${keyMultBaseSource}=${keyMultBase.toFixed(2)})`,
              `${curPrice.toFixed(2)} → ${newPrice.toFixed(2)}`);
          } else {
            console.log('[key] SKIPPED — sanity ceiling',
              `(ratio=${ratio.toFixed(2)}, ${curPrice.toFixed(2)} → ${newPrice.toFixed(2)})`);
          }
        } else {
          console.log('[key] SKIPPED — no multiplier base available',
            `(source=${out.pricingSource}, isFromPC=${isFromPC})`);
        }
      }
    }

    // Ship #13.1 — thin-comp-pool anchor (scope-corrected from Ship #13).
    // Universal safety cap: when rawComps.count < 3 (and > 0), cap engine
    // output at rawComps.highest × 1.05 regardless of pricing source.
    // Ship #13 gated this on isFromPC, which flipped false exactly when
    // sanity fired and pushed output into the exact "PC outlier, thin
    // pool" region the anchor was designed to protect (Biker Mice #1
    // hotfix case). Runs AFTER variant/key mults, sanity, floor — so the
    // cap binds against the final engine output. Mega-key floor runs
    // AFTER anchor and one-way-raises, preserving mega-key authority.
    {
      const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      const anchorResult = computeThinPoolAnchor(curPrice, rawComps, {
        isMegaKey: isMegaKeyForFloor,
        compsExhausted,
      });
      if (anchorResult && !isPolybagPricing) {
        console.log(
          `[thin-pool] anchor applied cap=$${anchorResult.anchorCap.toFixed(2)} was=$${curPrice.toFixed(2)} comps=${rawComps.count}`
        );
        out.price = fmtUsd(anchorResult.anchorCap);
        out.priceLow = fmtUsd(anchorResult.anchorCap * 0.85);
        out.priceHigh = fmtUsd(anchorResult.anchorCap * 1.15);
        out.thinPoolAnchored = true;
        out.priceNote = (out.priceNote || '') + ' · thin-pool anchor';
      }
    }

    // Ship #17 — bottom-of-census low-grade floor.
    // Conservative re-anchor: when pricing fell back to browse_api
    // (sanity LOW lifted to compsAvg, or no-PC path used rawComps.average)
    // AND PC pop data confirms user grade is the bottom of CGC census,
    // override compsAvg-derived price with rawComps.lowest. PC × grade-mult
    // outputs are NOT touched — calibrated grade-aware pricing wins.
    // Runs AFTER thin-pool anchor (both lower price; either order works
    // since the more-conservative result wins). Runs BEFORE mega-key
    // floor so mega-key one-way raise re-corrects when applicable.
    {
      const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      const lgResult = computeLowGradeFloor(curPrice, rawComps, pcPop, {
        isMegaKey: isMegaKeyForFloor,
        compsExhausted,
        pricingSource: out.pricingSource,
      });
      if (lgResult && !isPolybagPricing) {
        console.log(
          `[low-grade-floor] anchored cur=$${curPrice.toFixed(2)} → comp.lowest=$${lgResult.anchor.toFixed(2)} (pop.belowGrade=0)`
        );
        out.price = fmtUsd(lgResult.anchor);
        out.priceLow = fmtUsd(lgResult.anchor * 0.85);
        out.priceHigh = fmtUsd(lgResult.anchor * 1.15);
        out.lowGradeFloorApplied = true;
        out.lowGradeFloorAnchor = lgResult.anchor;
        out.priceNote = (out.priceNote || '') + ' · low-grade floor';
      }
    }

    // ═══ MEGA-KEY FLOOR — post-pricing guard (E2) ═══
    // Consulted AFTER all variant/key multipliers. One-way: only raises
    // price, never lowers. Two branches:
    //   MANUAL → flag for manual review; price untouched; listing blocked.
    //   MEGA   → apply floor when current price < floor bucket for grade.
    //   exceedsMap → grade above map coverage; flag for manual review.
    // Schema version stamped on response for K2 rules-version tracking.
    out.megaKeysSchemaVersion = MEGA_KEYS_SCHEMA_VERSION;
    {
      const megaKeyEntry = getMegaKeyEntry(title, confirmedIssue, confirmedPublisher, confirmedYear || year);
      // Ship 1.3.1 — mega-key floor must yield to edition warning.
      // Reprints/facsimiles/later-prints of mega-keys (e.g., B&B #28
      // Loot Crate polybag) must NOT receive 1st-print floor pricing.
      // Ship 6 — Skip mega-key floor when polybag pricing active.
      if (megaKeyEntry && isPolybagPricing) {
        out.megaKeyFloorSkipped = true;
        out.megaKeyFloorSkipReason = 'polybag-pricing';
        console.log('[mega-key-floor] SKIPPED — polybag pricing active');
      } else if (megaKeyEntry && editionWarning?.detected) {
        out.megaKeyFloorSkipped = true;
        out.megaKeyFloorSkipReason = 'edition-warning';
        console.log('[mega-key-floor] SKIPPED — reprint/later-print detected',
          `(signals: ${editionWarning.signals.join(', ')})`,
          `${title} #${confirmedIssue}`);
      } else if (megaKeyEntry) {
        if (megaKeyEntry.type === 'MANUAL') {
          out.manualReviewRequired = true;
          out.manualReviewReason = megaKeyEntry.volatilityNote ||
            'Mega-key with price dispersion too wide for automated floor';
          out.priceNote = (out.priceNote || '') + ' · manual review required';
          console.log('[mega-key-floor] MANUAL REVIEW:',
            `${title} #${confirmedIssue}`, '— no floor applied');
        } else {
          const floorResult = getMegaKeyFloor(
            title, confirmedIssue, confirmedPublisher, confirmedYear || year, grade, numericGrade
          );
          if (floorResult.exceedsMap) {
            // Distinct from type=MANUAL: the map simply doesn't cover
            // this grade. Book could be floored if the map were
            // extended. UI surfaces an amber GRADE EXCEEDS MAP badge
            // and suppresses the engine-computed price (same safety
            // gate as MANUAL) so users don't anchor on an unfloored
            // PC/comp number that's typically orders of magnitude
            // below market.
            out.gradeExceedsMap = true;
            out.gradeExceedsMapReason =
              'Grade exceeds floor map coverage — manual review required';
            out.priceNote = (out.priceNote || '') + ' · grade exceeds floor map';
            console.log('[mega-key-floor] EXCEEDS MAP:',
              `${title} #${confirmedIssue} grade=${grade}`, '— manual review');
          } else if (floorResult.floor) {
            const currentPriceNum = parseFloat(
              String(out.price || '0').replace(/[$,]/g, '')
            );

            // XMEN1-RULING [Option 2+]: Contamination detection
            // When soldAvg exists and is <50% of floor.low, suspect reprint/polybag
            // contamination in sold pool. Keep estimate displayed (no floor override),
            // flag for research, hard-lock listing.
            const contaminationThreshold = floorResult.floor * 0.5;
            const hasSoldData = soldAvg != null && !isNaN(soldAvg) && soldAvg > 0;
            const isSuspectContaminated = hasSoldData && soldAvg < contaminationThreshold;

            if (isSuspectContaminated) {
              // Option 2+: Flag contamination, RESEARCH decision, hard-lock
              out.floorContaminationSuspect = true;
              out.floorContaminationReason =
                `Verified solds ($${soldAvg.toFixed(0)}) far below key floor ($${floorResult.floor.toLocaleString()}) — pool may contain reprints`;
              out.floorBandLow = fmtUsd(floorResult.floor);
              out.floorBandHigh = fmtUsd(floorResult.priceHigh);
              out.decision = {
                action: 'RESEARCH',
                confidence: 'LOW',
                blockers: ['floor-contamination-suspect'],
                warnings: [],
                reason: out.floorContaminationReason,
              };
              out.listingHardLocked = true;
              out.listingHardLockReason = 'mega-key-floor-contamination';
              console.log('[mega-key-floor] CONTAMINATION SUSPECT:',
                `${title} #${confirmedIssue} soldAvg=$${soldAvg.toFixed(0)}`,
                `floor=$${floorResult.floor.toLocaleString()}`,
                `(${((soldAvg / floorResult.floor) * 100).toFixed(0)}% of floor) → RESEARCH + hard-locked`);
            } else if (currentPriceNum < floorResult.floor) {
              // Normal floor enforcement path
              out.preFloorPrice = out.price;
              out.preFloorSource = out.pricingSource || 'fallback';
              out.price = fmtUsd(floorResult.floor);
              out.priceLow = fmtUsd(floorResult.floor);
              out.priceHigh = fmtUsd(floorResult.priceHigh);
              out.megaKeyFloorApplied = true;
              out.megaKeyFloorVerified = megaKeyEntry.verified;
              out.megaKeyFloorSource = megaKeyEntry.source;
              out.megaKeyFloorNote = megaKeyEntry.volatilityNote;
              out.priceNote = (out.priceNote || '') + ' · mega-key floor';
              console.log('[mega-key-floor] enforced:',
                `${title} #${confirmedIssue} grade=${grade} bucket=${floorResult.bucket}`,
                `${out.preFloorPrice} → $${floorResult.floor}`,
                megaKeyEntry.verified ? 'VERIFIED' : 'ESTIMATED');
            }
          }
        }
      }
    }

    // Ship #22d: Tier-0 convergence lock
    // When mega-key detected AND convergence score <70 (LOW tier), hard-block
    // listing with identity verification blocker. Prevents wrong-era/wrong-
    // publisher/wrong-issue mega-key matches from shipping at tier-0 floors.
    // E1 gate: ASM #1 (1963) with PC "Divided We Stand" (2016) mismatch →
    // convergence <70 → DO_NOT_LIST blocker surfaces to user.
    if ((out.manualReviewRequired || out.gradeExceedsMap) &&
        out.convergence?.convergenceScore != null &&
        out.convergence.convergenceScore < 70) {
      out.tier0Locked = true;
      out.decision = {
        action: 'DO_NOT_LIST',
        confidence: 'LOW',
        blockers: ['MEGA-KEY: verify identity before listing (convergence < 70)'],
        warnings: [],
        nextSteps: [
          'Verify title/issue/year/publisher match expected book',
          'Check convergence card for source disagreements',
          'Confirm this is the correct printing/era'
        ],
      };
      console.log(
        `[22d] tier0-locked: "${confirmedTitle}" #${confirmedIssue} ` +
        `convergence=${out.convergence.convergenceScore} ` +
        `(${out.manualReviewRequired ? 'MANUAL' : 'EXCEEDS_MAP'})`
      );
    }

    } // end if (idCheck.confident) — Ship #20a.6.4 identity-gate wrap

    // FIX: Final floor re-enforcement AFTER all adjustments.
    // BUG: Floor was enforced at line 3434 (floorFired=true, note added), but
    // variant/key multipliers (lines 3624, 3684), thin-pool anchor (line 3722),
    // and low-grade floor (line 3750) all OVERWROTE out.price without re-checking
    // the floor. Result: recommended price shown BELOW its own stated floor.
    //
    // Batman #222 case: floor=$172.98, recommended=$149.95 (thin-pool anchored).
    // ASM #76 case: floor=$49.99, recommended=$33.96 (variant/key mult reduced).
    //
    // Fix: Re-enforce floor as FINAL step before price-trace. If any downstream
    // adjustment pushed price below floorNum, raise it back and update note.
    if (floorFired && floorNum > 0 && out.price) {
      const finalPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      if (finalPrice < floorNum) {
        console.log('[floor] FINAL RE-ENFORCEMENT:',
          `downstream adjustment pushed $${finalPrice.toFixed(2)} below floor $${floorNum.toFixed(2)}`);
        out.price = fmtUsd(floorNum);
        out.priceLow = fmtUsd(floorNum * 0.85);
        out.priceHigh = fmtUsd(floorNum * 1.25);
        out.floorReEnforced = true;
        // Note already has "· floor enforced" from first enforcement
      }
    }

    // Q59: Rebuild priceBands + recommended from finalPrice. Corrections
    // (sanity/thin-pool/floor re-enforcement) modify out.price at 3268-3925
    // but priceBands built at 2897 reads priceBandsRaw (pre-correction).
    // Symbiote Spider-Man #1 class: thin-pool anchored $8.30 but bands
    // still showed $472.50. Rebuild when any correction fired.
    if (priceBandsRaw && (out.floorReEnforced || out.thinPoolAnchored || sanityFired)) {
      const currentPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      const currentLow = parseFloat(String(out.priceLow || '0').replace(/[$,]/g, ''));
      const currentHigh = parseFloat(String(out.priceHigh || '0').replace(/[$,]/g, ''));

      out.priceBands = {
        quick: fmtUsd(currentLow),
        market: fmtUsd(currentPrice),
        stretch: fmtUsd(currentHigh),
        source: out.priceBands.source,
        count: out.priceBands.count,
        tier: out.priceBands.tier,
        variantAdjusted: out.priceBands.variantAdjusted || false,
      };

      console.log(
        `[price-bands] rebuilt-from=finalPrice=$${currentPrice.toFixed(2)} ` +
        `(was market=$${priceBandsRaw.market.toFixed(2)}) ` +
        `quick=$${currentLow.toFixed(2)} stretch=$${currentHigh.toFixed(2)}`
      );
    }

    // Ship #13.1: relocated to run AFTER all pricing adjustments
    // (variant mult, key mult, thin-pool anchor, mega-key floor) so
    // `finalPrice` reflects the actual returned value. `afterMult` stays
    // the post-floor/pre-multiplier snapshot (priceAfterFloor) so the
    // trace still shows the compute chain's intermediate state.
    console.log('[price-trace]',
      'pcBase:', priceCharting?.price,
      'multiplier:', out.gradeMultiplier,
      'afterMult:', priceAfterFloor,
      'compsAvg:', compsFromEbay?.average,
      'rawFloor:', rawComps?.lowest || 0,
      'floor:', floorNum,
      'floorFired:', floorFired,
      'floorReEnforced:', out.floorReEnforced === true,
      'sanityFired:', sanityFired || false,
      'finalPrice:', out.price,
      'source:', out.pricingSource,
      'thinPoolAnchored:', out.thinPoolAnchored === true,
      'lowGradeFloorApplied:', out.lowGradeFloorApplied === true
    );

    // Ship 6 — skip first-print comps overwrite when polybag pricing active.
    // Polybag block at line ~2168 already populated out.comps with polybag
    // listings. Without this guard, first-print comp pool overwrites it.
    if (rawComps && rawComps.count > 0 && !isPolybagPricing) {
      out.comps = {
        count: rawComps.count,
        average: rawComps.averageFormatted,
        averageNum: rawComps.average,
        lowest: rawComps.lowestFormatted,
        lowestNum: rawComps.lowest,
        highest: rawComps.highestFormatted,
        highestNum: rawComps.highest,
        lastSoldDate: rawComps.lastSoldDateFormatted,
        recentSales: rawComps.recentSales,
        query: rawComps.query,
        fellBack: rawComps.fellBack,
        source: rawComps.source,
        verifiedByAI: rawComps.verifiedByAI === true,
        verificationRemoved:
          typeof rawComps.verificationRemoved === "number"
            ? rawComps.verificationRemoved
            : 0,
      };
    }

    // matchConfidence — DISPLAY-only signal scoring how exact our final
    // (post-AI-verify) comp set matches the book. Does NOT influence the
    // pricing math chain. Sourced from the same prices array the UI shows.
    // Falls back to {0, LOW} when comps is empty so the client can render
    // an "AI estimate" badge without special-casing nulls.
    {
      // Q53: Declare activeCount + tier metadata BEFORE computeMatchConfidence
      // so thin-data cap logic (line 4115) reads tier-3's verified activePool
      // (priceBandsRaw.count) instead of relaxed AI-verified pool (rawComps.count).
      // Symbiote Spider-Man #1 class: tier-3 selected (3 verified active) but
      // match-conf saw rawComps.count=1 → thin-data cap fired → MEDIUM tier.
      const verifiedCount = soldVerifyResult?.diagnostics?.verifiedCount ?? null;
      const hadSoldComps = Array.isArray(rawSoldRows) && rawSoldRows.length > 0;
      const activeCount = (priceBandsRaw?.tier === 3 && priceBandsRaw.count != null)
        ? priceBandsRaw.count
        : (rawComps?.count || 0);
      const tierPathActive = priceBandsRaw && priceBandsRaw.tier != null;
      const tier = priceBandsRaw?.tier;

      // Q80 FIX: When activePool=0 but verified solds exist, use soldComps for
      // match-conf scoring (Flash Gordon #22 class: 20+ verified solds, 0 active
      // → score=0 → RESEARCH over-routing). Prefer active comps, fall back to sold.
      const compTitlesForScore =
        Array.isArray(rawComps?.recentSales) && rawComps.recentSales.length > 0
          ? rawComps.recentSales
          : Array.isArray(rawComps?.prices) && rawComps.prices.length > 0
          ? rawComps.prices
          : Array.isArray(filteredSold) && filteredSold.length > 0
          ? filteredSold
          : [];
      const mc = computeMatchConfidence(compTitlesForScore, {
        title: req.body.title || title,
        issue: confirmedIssue,
        year: confirmedYear,
        variant: confirmedVariant,  // Ship #20a.6.18: uses confirmed variant
        creator: req.body.creator || null,
      });
      const fallbackMessage =
        mc.tier === 'HIGH'
          ? 'Verified exact match'
          : mc.tier === 'MEDIUM'
          ? 'Similar matches found'
          : 'Exact match not found — AI estimate';
      const finalMc = {
        ...mc,
        displayMessage: mc.displayMessage || fallbackMessage,
      };

      // Vision-confidence cap. matchConfidence scores how well the comps
      // match the IDENTIFIED book — it can't detect a misidentification
      // (wrong book → matching comps still scores HIGH). Cap the tier and
      // score by Claude Vision's own confidence so a LOW-confidence ID
      // can never surface as "✓ Verified".
      const visionConfidence = String(confidence || 'medium').toLowerCase();
      out.visionConfidence = visionConfidence;

      if (visionConfidence === 'low') {
        if (finalMc.tier === 'HIGH') {
          const originalScore = finalMc.score;
          finalMc.tier = 'MEDIUM';
          finalMc.score = Math.min(finalMc.score, 75);
          finalMc.displayMessage = 'Vision confidence low — verify identification';
          finalMc.visionCapped = true;
          finalMc.originalScore = originalScore;
        } else if (finalMc.tier === 'MEDIUM') {
          finalMc.displayMessage = 'Vision confidence low — verify identification';
          finalMc.visionCapped = true;
        }
      } else if (visionConfidence === 'medium' && finalMc.tier === 'HIGH') {
        finalMc.visionModerate = true;
      }

      // Fix D — Phase 1: Zero-verified-comps cap. When sold comps exist but
      // NONE verify (soldCompDiagnostics.verifiedCount === 0), cap match
      // confidence to MEDIUM/75. 5 Ronin #1 class: soldComps present, all
      // rejected → signals data exists but quality uncertain.
      const soldCompDx = out.soldCompDiagnostics;
      const hasSoldCompsButNoneVerified =
        soldCompDx &&
        typeof soldCompDx.rawCount === 'number' &&
        soldCompDx.rawCount > 0 &&
        soldCompDx.verifiedCount === 0;
      if (hasSoldCompsButNoneVerified && finalMc.tier === 'HIGH') {
        const originalScore = finalMc.score;
        finalMc.tier = 'MEDIUM';
        finalMc.score = Math.min(finalMc.score, 75);
        finalMc.displayMessage = 'Sold comps exist but none verified — review data quality';
        finalMc.zeroVerifiedCapped = true;
        finalMc.originalScore = originalScore;
        console.log(`[match-conf] zero-verified cap: HIGH→MEDIUM (${originalScore}→${finalMc.score})`);
      }

      // Ship v0-I — era-filter bypass cap. When vintage book comps were
      // rescued via v0-I guardrail fallback (year missing from listings),
      // cap confidence to LOW. The comp pool passed reprint guardrail but
      // couldn't be era-validated, so user must verify before listing.
      if (rawComps?.eraFilterBypassed) {
        const originalScore = finalMc.score;
        const originalTier = finalMc.tier;
        finalMc.tier = 'LOW';
        finalMc.score = Math.min(finalMc.score, 60);
        finalMc.displayMessage = 'Vintage year missing — verify comps before listing';
        finalMc.eraFilterBypassed = true;
        if (originalTier !== 'LOW') {
          finalMc.originalScore = originalScore;
          finalMc.originalTier = originalTier;
          console.log(`[match-conf] era-filter bypass: ${originalTier}→LOW (${originalScore}→${finalMc.score})`);
        }
      }

      // Ship #21l: Fix D (Phase 2) — zero-verified-sold-comps + thin-active-pool confidence cap.
      // 21l-b [P1]: Gate on tier-path. Tier 1/2/3 has verified market data, suppress
      // "no comps" banners. Only tier 4 (pc_estimate fallback) permits estimate banner.
      // Q53: verifiedCount/hadSoldComps/activeCount/tier declared ABOVE (line 4006-4015)
      // so thin-data cap logic reads tier-3's verified activePool instead of relaxed pool.
      //
      // Tier 1/2 has verified solds, tier 3 has verified actives → suppress thin-data caps
      const hasVerifiedSoldComps = verifiedCount != null && verifiedCount > 0;
      const tierHasMarketData = tier === 1 || tier === 2 || tier === 3;

      // Only apply thin-data caps when NO tier path OR tier=4 (pc_estimate fallback)
      if (!tierHasMarketData &&
          !hasVerifiedSoldComps &&
          (verifiedCount === 0 || verifiedCount === null) &&
          (hadSoldComps || activeCount < 3) &&
          finalMc.tier === 'HIGH') {
        const originalScore = finalMc.score;
        finalMc.tier = 'MEDIUM';
        finalMc.score = Math.min(finalMc.score, 75);

        // Display message based on which condition triggered
        if (verifiedCount === 0 && hadSoldComps) {
          finalMc.displayMessage = 'No verified sold comps — verify before listing';
        } else if (activeCount < 3) {
          finalMc.displayMessage = 'Limited comps — verify before listing';
        } else {
          finalMc.displayMessage = 'Insufficient market evidence — verify before listing';
        }

        finalMc.zeroVerifiedSold = true;
        finalMc.originalScore = originalScore;
        console.log(`[match-conf] thin-data cap: HIGH→MEDIUM (${originalScore}→${finalMc.score}) ` +
                    `tier=${tier || 'none'} verifiedSold=${verifiedCount} active=${activeCount}`);
      } else if (tierHasMarketData) {
        console.log(`[match-conf] tier ${tier} has market data — thin-data caps suppressed`);
      }

      out.matchConfidence = finalMc;
      console.log(
        `[match-conf] score=${finalMc.score} tier=${finalMc.tier} comps=${compTitlesForScore.length} ` +
        `vision=${visionConfidence}${finalMc.visionCapped ? ' CAPPED' : ''}` +
        `${finalMc.eraFilterBypassed ? ' ERA-BYPASSED' : ''}`
      );
      // Q53: Log activePool wire to verify tier-3 verified pool propagates
      console.log(`[price-trace] activePool=${activeCount} tier=${tier || 'none'} verifiedSold=${verifiedCount}`);
    }

    // Sold comps — Ship #20a: now populated from PriceCharting sales-history
    // scrape (api/pricecharting-pop.js fetchPricechartingSales). Each entry
    // carries marketplace: 'ebay' | 'heritage' for source attribution.
    // Falls back to fetchSold (eBay Insights, dormant) when PC sales empty.
    // salesByGrade keeps every grade tab's rows for future Ship #20b weighting
    // and FR-5a.4 value-ladder display.
    //
    // Ship #20a.6 — out.soldComps now holds VERIFIED rows only (used by
    // pricing math). out.soldCompsRaw exposes the raw pool (capped at 20)
    // for UI debug. out.soldCompDiagnostics gives reason counts + top 3
    // rejected samples so post-deploy phone QA can see what was filtered.
    // Ship 6 — clear sold comp arrays when polybag pricing active.
    // soldComps holds first-print sales ($1200/$1500/$561 for B&B #28).
    // UI reads these and miscomputes recommended price as ~$857 instead
    // of using out.price = $9.71. Polybag pricing has no PriceCharting
    // sold history (these are reprint stock, not graded keys).
    if (isPolybagPricing) {
      out.soldComps = [];
      out.soldCompsRaw = [];
      out.soldCompDiagnostics = { kept: 0, rejected: 0, reasons: {} };
      out.soldCompsAvg = null;  // FIX 2: Surface sold-only average
    } else {
      out.soldComps = filteredSold;
      out.soldCompsRaw = capRawSoldRows(rawSoldRows);
      out.soldCompDiagnostics = soldVerifyResult.diagnostics;
      // FIX 2: Surface sold-only average (computed at line 2354-2356)
      out.soldCompsAvg = soldAvg;
      // Book-level comps cache — surface timestamp and comps for persistence
      out.compsCachedAt = useBookCompsCache ? bookCompsCachedAt : now;
      out.activeCached = compsFromEbay;
      out.soldCompsRawCached = capRawSoldRows(rawSoldRows);
    }
    // Ship 6 — skip PriceCharting per-grade arrays when polybag pricing active.
    // salesByGrade / priceLadder / salesVelocity all hold first-print PC data
    // (B&B #28 1960 graded ladder, sales history). UI displays "PRICE LADDER
    // (14 grades)" and "2 sales per month" labels from these — confusing for
    // a $9.71 polybag. Clear them so UI has only polybag data to render.
    if (!isPolybagPricing) {
      if (pcSales.salesByGrade && Object.keys(pcSales.salesByGrade).length > 0) {
        out.salesByGrade = pcSales.salesByGrade;
      }
      // Ship #20a.5 — per-grade price guide + per-grade sales velocity from
      // the same PC HTML. Pure data capture; downstream Ship #20b consumes
      // these for sold-first weighting and grade-aware pricing math.
      if (pcSales.priceLadder && Object.keys(pcSales.priceLadder).length > 0) {
        out.priceLadder = pcSales.priceLadder;
      }
      if (pcSales.salesVelocity && Object.keys(pcSales.salesVelocity).length > 0) {
        out.salesVelocity = pcSales.salesVelocity;
      }
    }

    // Ship #25 — Velocity analysis + dynamic pricing
    if (out.salesVelocity && out.priceBands) {
      const { analyzeVelocity } = await import('../src/lib/velocityAnalyzer.js');
      const velocityAnalysis = analyzeVelocity({
        salesVelocity: out.salesVelocity,
        userGrade: numericGrade || (isGraded ? null : 'raw'),
        priceBands: out.priceBands,
      });

      if (velocityAnalysis) {
        out.velocityAnalysis = velocityAnalysis;

        // Log velocity insights
        if (velocityAnalysis.hasData) {
          console.log(
            `[velocity] tier=${velocityAnalysis.tier} ` +
            `perDay=${velocityAnalysis.perDay?.toFixed(3)} ` +
            `label="${velocityAnalysis.label}" ` +
            `rec=${velocityAnalysis.recommendation.recommendedBand} ` +
            `price=$${velocityAnalysis.recommendation.recommendedPrice || 'N/A'}`
          );
        } else {
          console.log('[velocity] no data for user grade');
        }
      }
    }

    // Confidence level — PC data guarantees at least MEDIUM.
    const verifiedCount = rawComps?.count || 0;
    // Ship 6 hotfix — null-safe access. Same defensive pattern as line 1991.
    const soldCount = filteredSold?.length || 0;
    const hasPCData = out.pricingSource === "pricecharting";
    let confidenceLevel = "LOW";
    if (soldCount >= 2 && verifiedCount >= 2) confidenceLevel = "HIGH";
    else if (verifiedCount >= 2 || soldCount >= 1 || hasPCData) confidenceLevel = "MEDIUM";
    out.confidenceLevel = confidenceLevel;

    // Ship 11 — Visual pool fallback pricing.
    //
    // Production data (5/5/2026): modern variant books (Catwoman Uncovered #1
    // Artgerm Foil, Crow Dead Time #1 FanExpo Variant, etc.) refuse-to-price
    // because:
    //   - ComicVine doesn't catalog convention exclusives within months of release
    //   - PriceCharting has no entry for limited variants
    //   - Comp search builds queries that return zero exact matches
    // BUT eBay image search already returned 10-20 visually similar listings
    // WITH prices during identity verification (Phase 1). Those prices are sitting
    // in visualResult.items, already fetched, already parsed, currently discarded.
    //
    // When primary comp pipeline returns zero AND visual pool has ≥5 priced items,
    // use the pool itself as the comp source. The pool was selected by eBay's
    // visual similarity engine — for variant books, that's better signal than
    // catalog matches that don't exist yet.
    //
    // Triggers ONLY when refuse-to-price would otherwise fire. Working books
    // (Tomb of Dracula, ASM #606, Wolverine #1) skip this entire block because
    // their primary path already produced verified comps.
    if (
      verifiedCount === 0 &&
      soldCount === 0 &&
      visualResult?.items?.length >= 10
    ) {
      const poolPrices = (visualResult.items || [])
        .map((i) => Number(i?.price))
        .filter((p) => Number.isFinite(p) && p > 0 && p < 10000)
        .sort((a, b) => a - b);

      if (poolPrices.length >= 5) {
        const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
        const median = pct(poolPrices, 0.5);
        const low = pct(poolPrices, 0.25);
        const high = pct(poolPrices, 0.75);

        out.price = Math.round(median * 100) / 100;
        out.priceLow = Math.round(low * 100) / 100;
        out.priceHigh = Math.round(high * 100) / 100;
        out.priceBands = {
          quick: low,
          market: median,
          stretch: high,
          source: 'visual_pool_fallback',
          count: poolPrices.length,
        };
        out.pricingSource = 'visual_pool_fallback';
        out.priceNote = `Estimated from ${poolPrices.length} visually similar active listings. Verify identity before listing.`;
        out.refusedToPrice = false;
        out.confidenceLevel = 'MEDIUM';
        out.visualPoolUsed = true;
        out.visualPoolSize = poolPrices.length;

        console.log(
          `[ship11] visual_pool_fallback: ${poolPrices.length} prices, median=$${median.toFixed(2)} range=$${low.toFixed(2)}-$${high.toFixed(2)}`
        );
      } else {
        console.log(
          `[ship11] visual pool insufficient — ${poolPrices.length} priced items (need ≥5), falling through to refuse`
        );
      }
    }

    // Ship #23 FIX 2 — Refuse to price with zero verified comps.
    // Original refuse-to-price block — only fires if Ship 11 didn't populate price.
    // Never show a price when we have no verified active comps and no sold comps,
    // regardless of source (PC base, browse_api, or price bands).
    if (
      verifiedCount === 0 &&
      soldCount === 0 &&
      out.price != null &&
      out.pricingSource !== 'visual_pool_fallback'
    ) {
      console.log(
        `[refuse-to-price] 0 verified comps + 0 sold comps — refusing price ${out.price} (source: ${out.pricingSource})`
      );
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.priceBands = null;
      out.priceNote = "Insufficient data — no verified comps found";
      out.refusedToPrice = true;
      out.pricingSource = "refused";
      out.confidenceLevel = "LOW";
    }

    // Surface confirmedYear so the client can heal an incorrectly-stored
    // year on the catalogue item (e.g. Claude vision read 2025 but PC /
    // ComicVine agree on 2026). Only flag yearCorrected when the new
    // value actually differs from what the client sent in.
    if (confirmedYear) {
      out.confirmedYear = String(confirmedYear);
      out.yearCorrected = String(confirmedYear) !== String(year || "");
    }
    if (yearOverrideRejected) {
      out.yearOverrideRejected = true;
    }

    // Recommended price — Q59: read from finalPrice (post-correction) instead
    // of rawComps.average (pre-sanity/thin-pool/floor). When pricing chain
    // modified out.price, recommended should match corrected value.
    const finalPriceNum = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
    const recommendedPrice =
      finalPriceNum > 0
        ? finalPriceNum
        : (rawComps?.average != null ? Math.round(rawComps.average * 1.15) : null);

    // [verify] log line
    const seriesTitle = issueMatch
      ? String(confirmedTitle).replace(issueMatch[0], "").trim()
      : confirmedTitle;
    console.log(
      `[verify] ${seriesTitle} #${confirmedIssue || "?"} | ` +
      `grade: ${grade || "unknown"} | ` +
      `comps: ${verifiedCount} verified / ${rawComps?.prices?.length || 0} checked | ` +
      `sold: ${soldCount} found | ` +
      `confidence: ${confidenceLevel} | ` +
      `recommended: ${recommendedPrice != null ? "$" + recommendedPrice : "AI est"}`
    );

    if (ximilar) {
      out.ximilar = {
        name: ximilar.name,
        issueNumber: ximilar.issueNumber,
        publisher: ximilar.publisher,
        year: ximilar.year,
      };
      // Only override title if Claude's was weak; never stomp a good title.
      if (ximilar.weakTitle && ximilar.name) {
        out.title = ximilar.issueNumber
          ? `${ximilar.name} #${ximilar.issueNumber}`
          : ximilar.name;
        out.identifiedBy = "ximilar";
      }
    }

    // eBay visual issue cross-validation + Ship #20a.6.7a image-search
    // identity rows. Items[] is always present when search_by_image
    // returned anything; issueSource is only set when the consensus
    // voter fired (≥3 matching #N).
    if (visualResult) {
      if (Array.isArray(visualResult.items) && visualResult.items.length > 0) {
        out.imageSearchResults = visualResult.items;

        // Ship #28a: Extract eBay metadata for conflict detection
        const allCategories = visualResult.items.flatMap(i => i.leafCategoryIds || []);
        const allBuyingOptions = visualResult.items.flatMap(i => i.buyingOptions || []);
        const uniqueSellers = new Set(
          visualResult.items.map(i => i.sellerUsername).filter(Boolean)
        );

        out.ebayLeafCategories = [...new Set(allCategories)]; // dedupe
        out.ebayBuyingOptions = [...new Set(allBuyingOptions)]; // dedupe
        out.ebaySellerCount = uniqueSellers.size;

        console.log(
          `[ship28a] eBay metadata: ` +
          `categories=[${out.ebayLeafCategories.join(',')}] ` +
          `buyingOptions=[${out.ebayBuyingOptions.join(',')}] ` +
          `sellers=${out.ebaySellerCount}`
        );
      }
      if (visualResult.issueSource) {
        out.issueSource = visualResult.issueSource;
        if (visualResult.issueSource === "ebay_visual") {
          out.issue = visualResult.issue;
          out.claudeIssue = visualResult.claudeIssue;
        }
      }
    }

    // Ship #24 — Identity authentication score (0-100 cross-source validation)
    if (alignment) {
      out.identityAlignment = {
        confirmedTitle: alignment.confirmedTitle,
        confirmedIssue: alignment.confirmedIssue,
        confirmedYear: alignment.confirmedYear,
        confirmedSource: alignment.confirmedSource,
        overrodeVision: alignment.overrodeVision,
        confidence: alignment.confidence,
        authenticationScore: alignment.authenticationScore,
        breakdown: alignment.breakdown,
        conflicts: alignment.conflicts,
        needsReview: alignment.needsReview,
      };
      if (alignment.overrodeVision) {
        out.identityAlignment.visionWas = alignment.visionWas;
      }
    }

    // CGC cert verification override — authoritative data.
    if (cgcResult) {
      if (cgcResult.title) out.title = cgcResult.title;
      if (cgcResult.issue) out.issue = cgcResult.issue;
      if (cgcResult.grade != null) out.grade = cgcResult.grade;
      out.cgcVerified = true;
      out.cgcLabel = cgcResult.labelType || null;
      out.certNumber = cgcResult.certNumber;
    }

    // GoCollect CGC FMV data (null when API key not set)
    if (goCollectResult) {
      out.goCollect = goCollectResult;

      // Ship #28a COMMIT 2: Extract GoCollect identity anchors + full FMV ladder
      out.gcId = goCollectResult.id || null;
      out.gcLastUpdated = goCollectResult.last_updated || null;

      // Extend FMV ladder to lower grades (7.0-8.5) for raw upgrade scenarios
      out.gcFmvLadder = {
        '7.0': goCollectResult.fmv70 || null,
        '7.5': goCollectResult.fmv75 || null,
        '8.0': goCollectResult.fmv80 || null,
        '8.5': goCollectResult.fmv85 || null,
        '9.0': goCollectResult.fmv90 || null,
        '9.2': goCollectResult.fmv92 || null,
        '9.4': goCollectResult.fmv94 || null,
        '9.6': goCollectResult.fmv96 || null,
        '9.8': goCollectResult.fmv98 || null,
      };

      // TRACK B.3: GoCollect velocity + trend
      out.gcVelocity = goCollectResult.velocity || null;
      out.gcTrend = goCollectResult.trend || null;
      out.gcDaysToSell = goCollectResult.daysToSell || null;

      console.log(
        `[ship28a] GC anchors: id=${out.gcId} ` +
        `lastUpdated=${out.gcLastUpdated || 'unknown'} ` +
        `fmv98=${out.gcFmvLadder['9.8'] || 'N/A'} ` +
        `fmv70=${out.gcFmvLadder['7.0'] || 'N/A'}`
      );
    }

    // PriceCharting CGC pop data (Phase 5a.1 — backend only, no UI
    // and no pricing math changes. Null when PC has no product match
    // or the pop_data HTML scrape fails.)
    if (pcPop) {
      out.pop = pcPop;
    }

    // AI verify exhausted all comps — surface so client/UI can
    // indicate "no comp validation" without inventing a number.
    if (compsExhausted) {
      out.compsExhausted = true;
    }

    // Ship #13 observability flags: surface filter-rejection counts so the
    // UI (and post-deploy telemetry) can report pool-hygiene activity.
    if (rawComps?.multiIssueRejected > 0) {
      out.multiIssueRejected = rawComps.multiIssueRejected;
    }
    if (rawComps?.sequelRejected > 0) {
      out.sequelRejected = rawComps.sequelRejected;
    }
    if (rawComps?.signedRejected > 0) {
      out.signedRejected = rawComps.signedRejected;
    }

    // Ship #21 — Claude Haiku quality check (verify all data alignment)
    // Ship #26 — Web search trigger: when rawComps=0 AND no verified_sold data
    // Ship #27 — FIX 2: Kill web search for UK/pence zero-comp books
    // FIX A: Title-based UK detection (manual entry often has null publisher)
    const isZeroComp = (rawComps?.count === 0 || !rawComps);
    const variantLower = String(req.body?.variant || '').toLowerCase();
    const publisherLower = String(confirmedPublisher || '').toLowerCase();
    const ukTitleLower = String(confirmedTitle || '').toLowerCase();

    const isPenceVariant = variantLower.includes('pence');
    const isUKPublisher = publisherLower.includes('uk') ||
                          publisherLower.includes('panini') ||
                          publisherLower.includes('marvel uk') ||
                          publisherLower.includes('titan');

    // FIX A: Detect UK weeklies by TITLE patterns (for manual entry with null publisher)
    const isUKWeeklyTitle = ukTitleLower.includes('mighty world of marvel') ||
                            ukTitleLower.includes('marvel uk') ||
                            ukTitleLower.includes('panini') ||
                            ukTitleLower.includes('titan') ||
                            ukTitleLower.includes('weekly') ||
                            ukTitleLower.includes('british') ||
                            ukTitleLower.includes('pence edition');

    // Skip web search for UK weeklies/pence variants — they never have eBay sold comps,
    // web search fires, times out at 20s, burns Sonnet tokens, returns nothing.
    // Flag as MANUAL_RESEARCH instead.
    let ukWeeklySkip = false;
    if (isZeroComp && (isPenceVariant || isUKPublisher || isUKWeeklyTitle)) {
      ukWeeklySkip = true;
      out.ukWeeklyNoComps = true;
      console.log('[web-search] UK/pence zero-comp book detected — skipping web search, flagging MANUAL_RESEARCH');
      console.log('[uk-gate] triggered by:', isPenceVariant ? 'pence-variant' : isUKPublisher ? 'uk-publisher' : 'uk-title-pattern');
    }

    // FIX C: Gate web search on clean identity (identityComplete flag).
    // House of Mystery #157 case: title-family selection produced garbage title
    // "dc batman house of mystery 161 dial for hero read description", rawComps=0,
    // web search fired spending 20s + tokens on Sonnet query guaranteed to fail.
    // New gate: only fire web search when identity is COMPLETE and CLEAN.
    const identityComplete = !!(confirmedTitle && confirmedIssue && confirmedYear);

    const shouldTriggerWebSearch =
      isZeroComp &&
      out.pricingSource !== 'verified_sold' &&
      out.pricingSource !== 'pricecharting' &&
      !out.refusedToPrice &&  // Don't search when identity refused
      !isPolybagPricing &&
      !ukWeeklySkip &&  // FIX 2: Skip web search for UK/pence books
      identityComplete;  // FIX C: Only search when identity is clean

    // P0-B diagnostic: confirm web search Sonnet gate on refresh
    console.log('[web-search]',
      shouldTriggerWebSearch ? 'FIRING Sonnet' : 'skipped',
      'rawComps.count=', rawComps?.count ?? 'null',
      'ukWeeklySkip=', ukWeeklySkip,
      'identityComplete=', identityComplete,
      'skipFlag=', !!req.body?.skipClaudeCheck);

    if (shouldTriggerWebSearch) {
      console.log('[claude-check] web search mode triggered (rawComps=0, no verified_sold, identity complete)');
    } else if (isZeroComp && !identityComplete) {
      console.log('[web-search] SKIPPED — identity incomplete (title/issue/year missing)');
    }

    const claudeCheckData = {
      title: confirmedTitle,
      issue: confirmedIssue,
      year: confirmedYear || year,
      publisher: confirmedPublisher,
      variant: req.body?.variant || null,
      grade,
      numericGrade,
      conditionSummary: req.body?.reason || null,
      keyIssue: out.keyIssue,
      // Ship 6.1 — Suppress ComicVine story/creators on polybag scans.
      // ComicVine returns first-print metadata (story, creators) that
      // doesn't apply to a Loot Crate reprint. UI displays this as the
      // book's story description, creating misleading product info.
      storyDescription: isPolybagPricing
        ? null
        : (() => {
            const raw = comicVine?.description;
            if (!raw || typeof raw !== 'string') return null;
            const CROSS_REF_RE = /^(?:\s*<[^>]+>)*\s*(?:Translate|Collects?|Reprints?|Featured\s+Story\s+Arcs?)\s*:/i;
            return CROSS_REF_RE.test(raw) ? null : raw;
          })(),
      creators: isPolybagPricing ? [] : (comicVine?.personCredits || []),
      priceBands: out.priceBands,
      soldComps: filteredSold,
      activeComps: rawComps,
      pop: out.pop,
      demandSignals: out.demandSignals,
      // Ship #26: web search flags
      needsWebSearch: shouldTriggerWebSearch,
      rawCompsCount: rawComps?.count || 0,
      pricingSource: out.pricingSource
    };

    // Ship 6.3 — Skip claudeCheck API call entirely when polybag pricing active.
    // Ship 6.1 already bypasses the kill switch on polybags, but the API call
    // itself was still firing — costing ~3s per polybag scan and burning
    // Anthropic API credits on a result we discard. Skip the call entirely
    // when isPolybagPricing=true; polybag has its own verification (60%
    // reprint ratio + ≥5 priced items at line ~2148).
    //
    // P0 CRITICAL — Gate claudeCheck to initial scan only (disable on auto-refresh).
    // Auto-refresh fires enrich on every collection update, burning 3K Sonnet tokens
    // per book per refresh with zero new information gained. claudeCheck result is
    // stored on book record after initial scan. Refreshes use cached result.
    // Token audit: 71K Sonnet input / 521 output (ratio 0.007) = verify re-running
    // on every refresh. After fix: verify fires ONCE per book, zero on refresh.
    // Projected savings: 90%+ Sonnet spend eliminated.
    const isRefresh = req.body?.skipClaudeCheck === true || req.body?.claudeCheckCached != null;
    mark('claude_check_start');
    let claudeCheck;
    // Q44-B: Count only CRITICAL-severity conflicts before AI gate.
    // INFO conflicts (adjective/article normalization) are cosmetic — AI escalation
    // fires false alarms on "The Mighty Thor" vs "Thor" when deterministic layer
    // normalized and passed. Filter to CRITICAL only for escalation decision.
    const criticalConflicts = (out.conflicts || []).filter(c => c.severity === 'CRITICAL');
    if (isPolybagPricing) {
      claudeCheck = null;
    } else if (isRefresh && req.body?.claudeCheckCached) {
      // Use cached result from initial scan — zero AI calls on refresh
      claudeCheck = req.body.claudeCheckCached;
      console.log('[claude-check] using cached result — skip AI call (refresh)');
    } else if (!isRefresh && criticalConflicts.length > 0) {
      // Ship #28b FIX 1 + Q44-B: Only fire AI when CRITICAL conflicts exist
      claudeCheck = await runClaudeCheck(claudeCheckData);
      console.log(`[claude-check] ${criticalConflicts.length} CRITICAL conflicts detected — AI call fired`);
    } else if (!isRefresh && criticalConflicts.length === 0) {
      // Ship #28b + Q44-B: Zero CRITICAL conflicts = deterministic pricing, skip AI
      claudeCheck = { verified: true, skipReason: 'no_critical_conflicts' };
      const infoCount = (out.conflicts || []).filter(c => c.severity === 'INFO').length;
      console.log(`[claude-check] zero CRITICAL conflicts${infoCount > 0 ? ` (${infoCount} INFO)` : ''} — skip AI call (deterministic)`);
    } else {
      // Refresh but no cached result available — skip entirely
      claudeCheck = null;
      console.log('[claude-check] refresh with no cached result — skip AI call');
    }
    mark('claude_check_complete');
    if (claudeCheck) {
      out.claudeCheck = claudeCheck;
      out.verified = claudeCheck.verified;
      out.recommendation = claudeCheck.recommendation;
      out.suggestedListingTitle = claudeCheck.suggestedListingTitle;

      // Ship #27: Surface WARNING flags separately (non-blocking)
      // Parse flags into criticalFlags and warningFlags (reuse flags array from earlier parse)
      const allFlags = Array.isArray(claudeCheck.flags) ? claudeCheck.flags : [];
      out.criticalFlags = allFlags.filter(f =>
        (typeof f === 'object' && f.severity === 'CRITICAL') ||
        (typeof f === 'string' && /CRITICAL:/i.test(f))
      );
      out.warningFlags = allFlags.filter(f =>
        (typeof f === 'object' && f.severity === 'WARNING')
      );

      // Ship #26: Handle web search pricing
      if (claudeCheck.web_price && claudeCheck.web_confidence !== 'LOW') {
        const webPrice = Number(claudeCheck.web_price);
        if (webPrice > 0) {
          out.price = fmtUsd(webPrice);
          out.priceLow = fmtUsd(webPrice * 0.85);
          out.priceHigh = fmtUsd(webPrice * 1.15);
          out.pricingSource = 'web_search_fallback';
          out.priceNote = `Web search estimate (${claudeCheck.web_source || 'unknown source'})`;
          out.webSearchEvidence = claudeCheck.web_evidence || null;
          out.confidenceLevel = claudeCheck.web_confidence || 'MEDIUM';

          console.log(
            `[claude-check] web search pricing: $${webPrice} ` +
            `source=${claudeCheck.web_source} ` +
            `confidence=${claudeCheck.web_confidence} ` +
            `evidence="${claudeCheck.web_evidence}"`
          );

          // Decision engine will re-evaluate with new price
          // Web search prices default to RESEARCH (user must verify)
        }
      }

      // AI estimate fallback: never show a blank card (Principle 3)
      // When all verified sources fail, use AI range estimate as last resort.
      // Rank 6 (ai_estimate) means any verified source will override on refresh.
      if (!out.price && claudeCheck?.estimated_range_low && claudeCheck?.estimated_range_high) {
        const lowEst = parseFloat(claudeCheck.estimated_range_low) || 0;
        const highEst = parseFloat(claudeCheck.estimated_range_high) || 0;
        if (lowEst > 0 && highEst > lowEst) {
          const midpoint = (lowEst + highEst) / 2;
          out.price = fmtUsd(midpoint);
          out.priceLow = fmtUsd(lowEst);
          out.priceHigh = fmtUsd(highEst);
          out.pricingSource = 'ai_estimate';
          out.priceNote = 'Unverified AI estimate — verify before listing';
          out.confidenceLevel = 'LOW';
          console.log(`[ai-estimate] fallback: $${lowEst}-$${highEst} → market $${midpoint.toFixed(2)}`);
        }
      }

      // Ship 5 — Claude-check kill switch. When claude-check returns
      // verified=false AND confidence=LOW, refuse to ship the computed
      // price. Two-factor requirement is intentional — HIGH confidence on
      // verified=false may indicate principled disagreement worth surfacing
      // (not blocking). LOW + unverified is the "system is wrong, do not
      // ship" signal.
      //
      // B&B #28 Loot Crate polybag (5/4/2026): scanned as 1960 original,
      // priced at $2,275.34 via mega-key floor + key multiplier. Claude
      // check correctly flagged "Story description is for modern Flash/
      // Blackhawks crossover NOT 1960 Justice League debut" with
      // verified=false confidence=LOW. Pre-Ship-5: flag surfaced but
      // price still recommended. Post-Ship-5: price nulled, refusal
      // surfaced with flag as priceNote.
      //
      // Closes failure class: any case where pricing engine produces a
      // confident wrong answer that claude-check catches but cannot block.
      // Includes Thanos #11 wrong-issue comps, B&B polybag, future cases.
      //
      // Ship 6.1 — Skip kill switch when polybag pricing active.
      // claudeCheck runs first-print verification logic (story description
      // matching, creator credits, era-appropriate comps). For polybags,
      // these checks always fail by design — the polybag has its own
      // verification (60% reprint ratio + ≥5 priced items in pool, applied
      // at line ~2148). Letting Ship 5 kill the polybag price would null
      // every legitimate polybag scan. claudeCheck still runs for telemetry
      // but the kill switch is bypassed when polybag pricing is active.
      //
      // Hotfix 2026-05-09 — Check PRICING_CRITICAL_PATTERNS BEFORE confidence gate.
      // BUG: CRITICAL flags were bypassed when confidence=HIGH. CRITICAL flags
      // must always be evaluated regardless of confidence level.
      // Ship #27: Parse severity-tiered flags from claude-check response
      // Flags can be: array of strings (legacy) or array of {message, severity} objects (new)
      const flags = Array.isArray(claudeCheck.flags) ? claudeCheck.flags : [];
      const criticalFlags = flags.filter(f => {
        if (typeof f === 'object' && f.severity === 'CRITICAL') return true;
        if (typeof f === 'string') {
          // Legacy string flags — apply pattern matching for backward compatibility
          const PRICING_CRITICAL_PATTERNS = [
            /^CRITICAL:/i,
            /\bCRITICAL:/i,
            /^HIGH:/i,
            /\bHIGH:/i,
            /\bKEY ISSUE\b/i,
            /wrong\s+issue/i,
            /different\s+(?:book|series|comic)/i,
            /wrong\s+era/i,
            /era\s+mismatch/i,
            /comp\s+pool\s+contaminated/i,
            /completely\s+different/i,
            /\bnot\s+the\s+same\s+(?:book|comic|issue)/i,
            /issue\s+misidentified/i,
            /critical:\s*key\s+issue\s+misidentified/i,
          ];
          return PRICING_CRITICAL_PATTERNS.some(re => re.test(f));
        }
        return false;
      });

      const warningFlags = flags.filter(f => {
        if (typeof f === 'object' && f.severity === 'WARNING') return true;
        return false;
      });

      const refusalReason = criticalFlags[0]?.message || criticalFlags[0] || 'Claude verification failed';
      const isPricingCritical = claudeCheck.verified === false && criticalFlags.length > 0;

      // Ship Pattern M — Story-only CRITICAL downgrade.
      // When Haiku flags CRITICAL due to ComicVine story metadata corruption
      // (not identity/comp pool failures), downgrade to HIGH severity if
      // identity and market evidence are strong. Story metadata is known
      // unreliable (line 4367 comment acknowledges this).
      const STORY_ONLY_PATTERNS = [
        /story\s+(?:content|description|field|metadata)\s+(?:is|references|mentions|describes)/i,
        /story.*(?:wrong|incorrect|mismatch|different|unrelated|corrupt)/i,
        /(?:wrong|different|unrelated|corrupt).*story/i,
        /description\s+(?:is|references|describes).*(?:wrong|different|unrelated)/i
      ];

      const IDENTITY_FAILURE_PATTERNS = [
        /\bKEY ISSUE\b/i,
        /key\s+claim/i,
        /wrong\s+(?:issue|book|era|series)/i,
        /different\s+(?:book|series|comic|era)/i,
        /\breprint\b/i,
        /\bfacsimile\b/i,
        /\bcounterfeit\b/i,
        /comp\s+pool.*(?:wrong|contaminated|mismatch)/i,
        /\bnot\s+the\s+same\s+(?:book|comic|issue)/i,
        /chronological.*impossible/i,
        /\bauthenticity\b/i,
        /completely\s+different/i,
        /issue\s+misidentified/i
      ];

      const isCriticalFlag = /\bCRITICAL:/i.test(refusalReason);
      const isStoryOnly = STORY_ONLY_PATTERNS.some(re => re.test(refusalReason)) &&
                          !IDENTITY_FAILURE_PATTERNS.some(re => re.test(refusalReason));
      const activeCount = rawComps?.count || 0;
      const verifiedCount = out.soldCompDiagnostics?.verifiedCount || 0;

      // Story-only mismatch fix: wrong story description NEVER grounds to null price.
      // Identity (title+issue+year) and comps (verified sold) are independent of story.
      // Removed isIdentityStrong gate — story metadata corruption alone is NOT pricing-critical.
      let shouldDowngradeCritical = false;
      if (isCriticalFlag && isStoryOnly) {
        shouldDowngradeCritical = true;
        console.log(
          '[claude-gate] DOWNGRADE — story-only CRITICAL, verified comps protected · flag:',
          refusalReason
        );
        // Convert CRITICAL to HIGH and route to high-severity warning path
        const downgradedReason = refusalReason.replace(/\bCRITICAL:/i, 'HIGH:');
        out.claudeCheckHighSeverity = downgradedReason;
        out.claudeCheckMode = 'story_only_downgraded';
        // Price ships, decision will cap at RESEARCH via claudeCheckHighSeverity warning

        // Clear wrong story description — user sees empty field instead of wrong edition
        out.story = null;
        out.storySource = 'cleared-wrong-edition';
        console.log('[story-cleared] wrong edition description removed');
      }

      // Crossover/intercompany downgrade — DC+Marvel mix with supporting comps
      // Real crossovers exist (Superman vs Spider-Man 1976, JLA/Avengers, Amalgam).
      // When market evidence validates product existence, downgrade to HIGH for manual review.
      const isCrossoverFlag = /mixes\s+(?:DC|Marvel).*(?:Marvel|DC)/i.test(refusalReason);
      const activeAvg = rawComps?.average || 0;
      const hasSupportingComps = activeCount >= 2 && activeAvg > 0;

      if (isCrossoverFlag && hasSupportingComps && !isPolybagPricing) {
        shouldDowngradeCritical = true;
        console.log(
          '[claude-gate] DOWNGRADE — crossover with supporting comps · flag:',
          refusalReason,
          '· comps:',
          activeCount,
          '· avg:',
          activeAvg
        );
        out.claudeCheckHighSeverity = refusalReason.replace(/\bCRITICAL:/i, 'HIGH:');
        out.claudeCheckMode = 'crossover_downgraded';
        // Price ships, decision will cap at RESEARCH via claudeCheckHighSeverity warning
      }

      // Fix B (Phase 1 finalization) — Historical key-issue hallucination downgrade.
      // Fix B — Phase 1: Batman #59 historical key-issue hallucination gate.
      // Claude verification sometimes hallucinates historical corrections without
      // source-backing (Batman #59: claimed Deadshot first appeared 1959 not 1950).
      //
      // Hard-block phrases (must NOT downgrade):
      //   - wrong issue / wrong book / wrong series / wrong era
      //   - reprint / facsimile
      //   - KEY ISSUE MISMATCH / KEY ISSUE MISIDENTIFICATION
      //   - comp pool contaminated
      //
      // Downgrade-eligible phrases (downgrade to RESEARCH when guards pass):
      //   - "first appeared in X (year)" correction language
      //   - "does not feature first appearance"
      //   - "not the first appearance"
      //
      // Guards (ALL required for downgrade):
      //   - visionConfidence !== low
      //   - activeCount >= 2 OR verifiedCount >= 2
      //   - flag does NOT contain hard-block phrases
      const HARD_BLOCK_PHRASES = [
        /wrong\s+issue/i,
        /wrong\s+book/i,
        /wrong\s+series/i,
        /wrong\s+era/i,
        /\breprint\b/i,
        /\bfacsimile\b/i,
        /KEY\s+ISSUE\s+MISMATCH/i,
        /KEY\s+ISSUE\s+MISIDENTIFICATION/i,
        /comp\s+pool\s+contaminated/i,
      ];
      const HISTORICAL_KEY_PATTERNS = [
        /first\s+appear(?:ed|ance)/i,                      // "first appeared", "first appearance"
        /does\s+not\s+feature\s+first\s+appearance/i,      // "does not feature first appearance"
        /not\s+the\s+first\s+appearance/i,                 // "not the first appearance"
        /wrong\s+year/i,                                    // "wrong year"
        /(?:debut|origin|introduced)\s+in\s+\d{4}/i,       // "debuted in 1959" (year claim)
        /actually\s+(?:appeared|debuted|introduced)/i,     // "actually appeared", "actually debuted"
        /historical(?:ly)?\s+inaccurate/i,                 // "historically inaccurate"
      ];

      // Evaluate hard blocks FIRST — if any present, skip downgrade path entirely
      const hasHardBlock = HARD_BLOCK_PHRASES.some(re => re.test(refusalReason));

      const isHistoricalKeyCorrection = isCriticalFlag &&
        HISTORICAL_KEY_PATTERNS.some(re => re.test(refusalReason));
      const visionConfirmedKey = !!(req.body.keyIssue && String(req.body.keyIssue).trim().length > 0);
      const visionConfidenceNotLow = out.visionConfidence !== 'low';
      const hasComps = activeCount >= 2 || verifiedCount >= 2;

      if (!hasHardBlock && isHistoricalKeyCorrection && visionConfirmedKey && visionConfidenceNotLow && hasComps && !isPolybagPricing) {
        shouldDowngradeCritical = true;
        console.log(
          '[claude-gate] DOWNGRADE — historical key-issue hallucination · flag:',
          refusalReason,
          '· visionKey:',
          req.body.keyIssue,
          '· visionConf:',
          out.visionConfidence,
          '· activeComps:',
          activeCount,
          '· verifiedSold:',
          verifiedCount
        );
        out.claudeCheckHighSeverity = refusalReason.replace(/\bCRITICAL:/i, 'HIGH:');
        out.claudeCheckMode = 'historical_key_hallucination_downgraded';
        // Price ships, decision will cap at RESEARCH via claudeCheckHighSeverity warning.
        // This downgrade does NOT fully trust the book into LIST_NOW — only prevents
        // hard DO_NOT_LIST block. User must review before listing.
      }

      if (
        ((isPricingCritical && !shouldDowngradeCritical) ||
         ((claudeCheck.verified === false && claudeCheck.confidence === 'LOW') && !shouldDowngradeCritical)) &&
        !isPolybagPricing
      ) {
        // Ship 10 — Reclassify claude-gate refusals.
        // Production data (5/5/2026 batch test on 77-book collection):
        // ~70% false-refusal rate because gate flagged METADATA nits as
        // pricing-critical:
        //   - "No condition details provided" (caused by frontend not
        //     passing req.body.reason; fixed in Ship 10.2 too)
        //   - "Higher grade comps than subject" (normal for thin markets)
        //   - "Story field wrong" (ComicVine data quality, irrelevant to price)
        //   - "Creators not listed" (cosmetic, irrelevant to price)
        // Now refuses ONLY when refusal indicates the priced book is
        // actually a different book than what comps cover. Otherwise
        // surfaces as warning and lets price ship.

        if (isPricingCritical) {
          console.log(
            '[claude-gate] CRITICAL FLAG — price preserved, decision will block · flag:',
            refusalReason
          );
          // FIX 2: NEVER null the price due to AI refusal
          // Price from deterministic sources (verified_sold, browse_api, pricecharting)
          // is ALWAYS computed and stored. claudeCheck adds flags ONLY.
          // Decision engine reads claudeCheckBlocker → sets DO_NOT_LIST.
          // User sees: price + DO_NOT_LIST + warning flag (informed context).
          // NOT: null price + DO_NOT_LIST (no market data, no context).

          // REMOVED: out.price = null
          // REMOVED: out.priceLow = null
          // REMOVED: out.priceHigh = null
          // REMOVED: out.pricingSource = 'refused-claude-gate'

          // Price/priceLow/priceHigh/pricingSource preserved from comp sources
          out.priceNote = `⚠️ ${refusalReason}`;  // Show flag to user
          out.refusedToPrice = false;  // Price IS provided (from comps)
          out.confidenceLevel = 'LOW';  // Keep low confidence signal
          out.claudeCheckMode = 'pricing_critical_flagged';
          out.claudeCheckBlocker = refusalReason;  // Decision engine blocker field
        } else {
          // Detect HIGH severity in WARNING ONLY path
          const isHighSeverity = /^HIGH:/i.test(refusalReason) || /\bHIGH:/i.test(refusalReason);

          if (isHighSeverity) {
            console.log(
              '[claude-gate] HIGH SEVERITY WARNING — price ships, decision capped · flag:',
              refusalReason
            );
            out.claudeCheckHighSeverity = refusalReason;  // Decision engine warning field
            out.claudeCheckMode = 'high_severity_warning';
          } else {
            console.log(
              '[claude-gate] WARNING ONLY — metadata nit, price stands · flag:',
              refusalReason
            );
            out.claudeCheckWarning = refusalReason;
            out.claudeCheckMode = 'metadata_warning_only';
          }
          // Note: price/priceLow/priceHigh/pricingSource preserved in both paths.
        }
      } else if (
        claudeCheck.verified === false &&
        claudeCheck.confidence === 'LOW' &&
        isPolybagPricing
      ) {
        console.log(
          '[claude-gate] BYPASSED — polybag pricing active. ' +
          'claudeCheck flag:', (claudeCheck.flags?.[0]) || 'none'
        );
        out.claudeCheckBypassedForPolybag = true;
      }
    }

    // Ship 26.3B — Ensure confirmedTitle propagates to final response.
    // Frontend merge: enrich.title || cur.title. Without explicit assignment,
    // out.title remains undefined and UI displays original grade.js title.
    if (!out.title) {
      out.title = confirmedTitle;
    }

    mark('final_response');
    out.timings = {
      total_ms: Date.now() - startTime,
      phase1_ms: (t.phase1_complete != null && t.phase1_start != null) ? t.phase1_complete - t.phase1_start : null,
      comps_ms: (t.comps_fetched != null && t.phase2_start != null) ? t.comps_fetched - t.phase2_start : null,
      verify_ms: (t.ai_verify_complete != null && t.ai_verify_start != null) ? t.ai_verify_complete - t.ai_verify_start : null,
      claude_check_ms: (t.claude_check_complete != null && t.claude_check_start != null) ? t.claude_check_complete - t.claude_check_start : null,
      marks: t,
    };
    console.log('[timing] summary:', JSON.stringify(out.timings));

    // Ship v0-B — Decision Engine integration.
    // Normalize fields for decision engine (field mapping from Step 0):
    // 1. rawComps: construct from local rawComps variable
    out.rawComps = rawComps ? {
      average: rawComps.average,
      lowest: rawComps.lowest,
      highest: rawComps.highest,
      count: rawComps.count,
      // GL-0: applyAnchorDirection (responseContract.js) reads
      // out.rawComps.prices to compute the active median. Without this
      // array the ≥1-active guard returns early and 24c can never fire
      // (EX-1 silence on dpl_43c65g9 / build 2b19171). Minimal shape —
      // price for the median, title for contamination debugging.
      prices: Array.isArray(rawComps.prices)
        ? rawComps.prices.map((p) => ({
            price: typeof p === 'number' ? p : (p?.price ?? null),
            title: p?.title || null,
          }))
        : [],
    } : { count: 0 };

    // 2. compPoolContaminated: universal flag for variant/reprint fallback
    if (out.variantFallback || out.reprintFallback) {
      out.compPoolContaminated = true;
    }

    // 3. storySuppressedReason: normalize from nested comicVine
    if (out.comicVine?.storySuppressedReason) {
      out.storySuppressedReason = out.comicVine.storySuppressedReason;
    }

    // Q35: Clear comicVine when suppressed (publisher-mismatch / title-weak-match).
    // Bug: out.storySuppressedReason flag set but out.comicVine fields retained →
    // UI displayed "Editorial Novaro (1954)" on Batman #222 (wrong publisher).
    if (out.storySuppressedReason) {
      out.comicVine = null;
    }

    // 3b. contentVerified: universal flag computed by ComicAdapter.verifyStory
    // False when story suppressed OR story metadata suspicious
    if (out.storySuppressedReason) {
      out.contentVerified = false;
    } else {
      out.contentVerified = verifyStory(out.comicVine);
    }

    // 3c. hasKeyValue: universal flag computed by ComicAdapter.detectKeyValue
    out.hasKeyValue = detectKeyValue(req.body.keyIssue);

    // 3e. eraRisk: comic-specific era risk (Golden Age thin-pool, modern bundle)
    out.eraRisk = computeEraRisk(out.year, out.rawComps);

    // 4. megaKey: construct from flags
    if (out.manualReviewRequired) {
      out.megaKey = { badge: 'MANUAL REVIEW' };
    } else if (out.gradeExceedsMap) {
      out.megaKey = { badge: 'GRADE EXCEEDS MAP' };
    }

    // 5. isPolybagPricing: expose function parameter on out
    out.isPolybagPricing = isPolybagPricing;

    // Ship #26 v0-B.1 — Normalize critical identity fields for decision engine.
    // confirmedIssue / confirmedYear / confirmedPublisher drive pricing and comps,
    // but decisionEngine reads out.issue / out.year / out.publisher directly.
    // Q49: Simplified confirmedIssue || confirmedIssue → confirmedIssue (duplicate from global replace)
    if (!out.issue) {
      out.issue = confirmedIssue || issueNum || null;
    }

    if (!out.year) {
      out.year = confirmedYear || year || null;
    }

    if (!out.publisher) {
      out.publisher = confirmedPublisher || publisher || null;
    }

    // Q27: Surface foreign edition flag from Vision
    if (req.body.foreignEdition === true) {
      out.foreignEdition = true;
      console.log('[q27] foreign edition detected — pc_estimate blocked');
    }

    // 3d. identityComplete: adapter-aware flag
    // Comic: issue + publisher required
    // Book: title + author required
    // Computed AFTER fallback assignments so identity fields are populated
    // assetType already set at line 1475 from req.body destructure
    // Crow Dead Time fix — use same publisher-skip logic as identity gate (pcProductId exists = trust)
    const publisherRequired = out.assetType === 'comic' && !(
      (identitySource && (
        String(identitySource).includes('ebay') ||
        String(identitySource).includes('title-family') ||
        String(identitySource) === 'manual'
      )) ||
      Boolean(out.pcProductId)
    );

    out.identityComplete = out.assetType === 'book'
      ? !!(out.title && out.author)
      : publisherRequired
        ? !!(out.issue && out.publisher)
        : !!out.issue;

    if (!out.visionConfidence && out.matchConfidence?.visionConfidence) {
      out.visionConfidence = out.matchConfidence.visionConfidence;
    }

    // Ship v0-G — Surface title sanitization metadata
    if (titleSanitized) {
      out.titleSanitized = true;
      out.titleOriginalBeforeSanitize = titleOriginalBeforeSanitize;
    }
    if (titleContamination.contaminated) {
      out.titleContamination = titleContamination;
    }

    // Compute decision after full enrich object assembled
    out.decision = computeDecision(out, {
      source: 'enrich',
      timestamp: Date.now()
    });

    console.log(
      `[decision] action=${out.decision.action} ` +
      `confidence=${out.decision.confidence} ` +
      `blockers=${out.decision.blockers?.length || 0} ` +
      `warnings=${out.decision.warnings?.length || 0}`
    );

    // P0-D: Add timestamp so UI can show "Updated X ago"
    out.priceUpdatedAt = Date.now();

    // FIX 1 PHASE 2 — api/metadata.js merged into enrich.
    // Return full enrichment including display-only fields (story, creators, pop, goCollect).
    // Previously these were stripped and fetched via separate /api/metadata call (SPEED-2a).
    // Eliminates duplicate CV/PC/GoCollect API calls and second HTTP round-trip.
    mark('response_sent');
    // Ship #24a-2: single-writer boundary — contract assembled here, nothing
    // may write price/decision fields after this call.
    res.status(200).json(finalizeResponse(out));
  } catch (err) {
    // Ship 6 debug — log full error and stack trace to Vercel logs.
    // Without this, 500s appear in production with no diagnostic info.
    console.error('[enrich-error] message:', err?.message || 'unknown');
    console.error('[enrich-error] stack:', err?.stack || 'no stack');
    console.error('[enrich-error] name:', err?.name || 'unknown');
    console.error('[enrich-error] isPolybagPricing:', typeof isPolybagPricing !== 'undefined' ? isPolybagPricing : 'out of scope');
    res.status(500).json({ error: err?.message || "Server error", stack: err?.stack });
  }
}
