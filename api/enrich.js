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
  backfillPublisherFromTitles,
  normalizePublisherKey,
  extractTitleConsensus,
  resolveYear,
  deriveCvYear,
  checkAssemblyIntegrity,
  titleOverlapsProduct,
  projectCanonicalTitleFromAnchor,
  extractAnchorBracketDescriptor,
  diffEditionDescriptorCandidate,
  selectBestVariantCandidate,
  variantTokenOverlapScore,
  buildIdentityRefusedFallbackPool,
  shouldSkipAssemblyIntegrityCheck,
  detectVisualIssueDivergence,
  enforceQueryIssueAuthority,
  buildStandardVisionAuthorityContext,
  resolveFamilyIssueConsensus,
  isCorroboratedIdentitySource,
  normalizeVisionConfidence,
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
  isPublisherYearPlausible,
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
import { extractIdentityFromImageSearch, extractConsensus, selectTitleFamilyCandidate, inferAssetTypeFromCategories, buildRetentionFamilyEvidenceLog, shouldLiftAssetTypeAdvisoryLock } from "../src/lib/imageSearchIdentity.js";
// Session 4A — Universal category filter (pre-clustering)
// Commit C — filterVisualIdentityPool is the primary entry point now (runs
// inside lookupEbayVisual, before extraction/consensus); filterByCategory
// is kept for any other/future caller wanting just the filtered array.
import { filterByCategory, filterVisualIdentityPool } from "../src/lib/categoryClassifier.js";
// Session 4B — Adapter registry (per-asset routing config)
import { getAdapter } from "../src/adapters/adapterRegistry.js";
// Ship #20b — price bands engine (verified sold-first pricing).
import { computePriceBands as computePriceBandsFromSold, enforceFloor as enforceFloorFromBands, TIER_SOURCE_MAP } from "../src/lib/priceBands.js";
// Ship #21 — demand signals from sales data.
import { computeDemandSignals } from "../src/lib/demandSignals.js";
// C5 — parseListingGrade for lone-sold anchor.
import { parseListingGrade, compactTitleKey, COMP_FILTER_VERSION, FAMILY_OVERRIDE_DECISIONS, detectConditionReportArtistConflict, PREMIUM_VARIANT_RE, extractArtist, normalizeAcronyms, extractAcronymTokens, buildSanitizedComicSearchTitle, hasValidFamilyMembership, classifyPromotableVariantDescriptor, ARTIST_PATTERNS } from "../src/lib/compHygiene.js";
import { assessCatalogLadderReference, assessPcAnchorTrust, assessGradeBasis } from "../src/lib/evidenceEligibility.js";
// Track B Phase 0, Commit 3 — manual identity correction: server-side
// authority validation (allow-list + normalization), never trusting the
// client's correctedFields claim alone.
import { prepareManualCorrectionRequest, buildManualCorrectionProvenance } from "../src/lib/manualCorrection.js";
import { deriveIssueAuthorityFromAdoption, escalateIssueAuthorityOnConflict, computeIssueAuthorityContractPatch, canUseExactIssuePricingCache, appendYearToProvisionalFields, buildVisualReferenceEvidence, restampVisualReferenceEvidenceYear, checkCrossPopulationPromotionGuard, buildRejectedCandidateFingerprint, buildIdentityProvisionalYearDetail, deriveProvisionalYearBackfill, rescueYearFromVisionFallback } from "../src/lib/issueAuthority.js";
// Track B Phase 0, Commit 4.3 (revision round 2) — cache-key builders,
// relocated to src/lib/cacheKeys.js for import-safety (see that file's
// own header comment). Imported here for this handler's own internal use
// AND re-exported (below, near the old definition site) for backward
// compatibility with existing consumers of this module's namespace.
import { buildActiveCompCacheKey, buildComicVineCacheKey, buildPriceChartingCacheKey, parseCacheKeyIssueSegment, buildComicVineQueryParams, buildPriceChartingQueryParams, readPriceChartingCache } from "../src/lib/cacheKeys.js";
// Ship #21 — Claude Haiku quality check.
import { runClaudeCheck } from "../src/lib/claudeCheck.js";
// Ship #20a.6.18 — variant identity engine (modern variant consensus from
// eBay image search). Overrides Vision variant field when ≥2 eBay listings
// agree on specific tokens (convention, artist, exclusive, limitation).
import { extractConfirmedVariant, filterItemsByIssue, detectVariantPoolYearConflict, detectFamilyOverrideConflict, pcMatchConflictsWithPoolYear, pcMatchConflictsWithPoolName, pcMatchMissingFamilyDiscriminator, hasUnresolvedActiveVariantConflict, isVariantProvenanceValid, validateVisionPrintingClaim } from "../src/lib/variantIdentity.js";
// Ship #1.3 — edition warning detection (reprint/facsimile/later-print gates).
import { detectEditionWarning, classifySpecificPrinting } from "./grade.js";
// Q118 — internal consistency checker (Vision's free-text reason vs its own structured fields).
import { checkVisionConsistency } from "../src/lib/visionConsistency.js";
// Session 4B — Import book signal detection from shared classifier
import { detectBookSignals } from "../src/lib/categoryClassifier.js";
// FIX 3 — Vercel KV persistent cache (replaces in-memory Map caches)
import { kvGet, kvSet, KV_TTL, PC_FILTER_VERSION, CV_FILTER_VERSION } from "./kv-cache.js";
import { checkRateLimit } from "./rate-limit.js";
import { randomUUID } from "node:crypto";
import { buildPipelineAudit } from "../src/lib/pipelineAudit.js";
import { resetTitleStripStats, logTitleStripSummary } from "../src/lib/titleStripStats.js";
import { writeConfirmed } from "../src/lib/identityWriteLog.js";

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

export const lookupComicVine = async ({ title, issue, year, publisher, poolYearHint = null }) => {
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
      // Q120 audit (2026-07-19, Captain Marvel #17 class) — confirmed this
      // coarse path was already correct: yearDiff's 999 sentinel (fires
      // whenever comicYear or startYear is missing, not just when they
      // genuinely disagree) only ever maps to yearScore=0 here — there is
      // no negative branch in this formula. The bug lived exclusively in
      // scoreWithDetails below, which added a negative-penalty branch on
      // top of the same sentinel value. Documented here so the two stay
      // consistent if either is touched again.
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
      'grupo editorial', 'vid', 'novedades',  // Mexican reprint publishers
      'ediciones vertice', 'editorial novaro', // Q99 — Spanish/Mexican reprint licensees
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
    } else if (beforeReprint > 0) {
      // Q99 (ruled): unlike the token/pub gates below (fuzzy scoring, where
      // "keep original set" guards against nuking a legitimate near-miss),
      // reprint-publisher rejection is a deterministic blocklist match —
      // there is no case where resurrecting a KNOWN foreign reprint is
      // correct just because it's the only candidate. UXM #141: CV's
      // search returned only 3 Panini Brasil/Verlag volumes (no 1981
      // Marvel US volume in the result set at all); the old silent
      // fallback let Panini Brasil win by default, anchoring
      // confirmedYear=2002 and era-rejecting every genuine 1981 comp.
      // Committing to zero here makes comicVine() return null instead —
      // confirmedYear then correctly falls through to backfillFromComps'
      // eBay-comp-consensus year extraction (identityCore.js), which
      // resolves the real year from "(1981)"-style tokens already present
      // in the genuine market listings.
      candidates.length = 0;
      console.log(`[cv-reprint-gate] ${beforeReprint} → 0 volumes (all candidates were known foreign reprints — no fallback)`);
    }

    // Ship 26.3C-2 Patch C2-B — Token gate: require volume name to overlap ≥50%
    // with cleaned query core tokens. Prevents generic volumes (e.g., "Scorched
    // Earth" sci-fi volume) from matching specific series (Batman/Catwoman Gotham War).
    const beforeToken = candidates.length;
    const tokenizeForGate = (str) => {
      // G.O.D.S. dispatch — collapse punctuated acronyms before anything
      // else, so a candidate ComicVine volume literally named "G.O.D.S.:
      // One World Under Doom" doesn't lose the distinguishing "gods" token
      // to the [^a-z0-9]+ strip below.
      return normalizeAcronyms(String(str || ''))
        .toLowerCase()
        .replace(/#\s*\d+/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !/^\d+$/.test(t))
        .filter(t => !['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with'].includes(t));
    };
    const queryTokens = tokenizeForGate(seriesName);
    const coreTokens = queryTokens.slice(0, 3); // First 3 significant tokens
    // G.O.D.S. dispatch — same "ratio/floor tolerates one orphan acronym
    // token" gap as pcMatchConflictsWithPoolName (variantIdentity.js), same
    // two-direction fix. queryAcronymTokens computed once here (doesn't
    // depend on the per-candidate volume), unlike the PC-gate's pool-
    // consensus direction which needs the full pool — CV compares one
    // query against one candidate volume name, no pool to aggregate.
    const queryAcronymTokens = extractAcronymTokens(seriesName);

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

      // G.O.D.S. dispatch — Direction 1: this candidate volume's own name
      // carries an acronym token our query never mentions at all (e.g. a
      // "G.O.D.S.: One World Under Doom" volume matched against a plain
      // "One World Under Doom" query).
      const volAcronymTokens = extractAcronymTokens(vol.name);
      const orphanVolAcronym = volAcronymTokens.find((t) => !queryTokens.includes(t));
      if (orphanVolAcronym) {
        console.log(`[cv-token-gate] REJECT ${vol.name} (acronym token "${orphanVolAcronym}" not present in our own query "${seriesName}")`);
        return false;
      }

      // Direction 2 — the inverse: OUR query legitimately carries an
      // acronym token this candidate volume never mentions (our book
      // genuinely is the acronym-prefixed tie-in; this candidate is the
      // plain-series volume).
      const orphanQueryAcronym = queryAcronymTokens.find((t) => !volTokens.includes(t));
      if (orphanQueryAcronym) {
        console.log(`[cv-token-gate] REJECT ${vol.name} (our query's acronym token "${orphanQueryAcronym}" is absent from this candidate volume's name)`);
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
      // Q120 dispatch (2026-07-19, Captain Marvel #17 class) — hasYearComparison
      // distinguishes "we have both years and they genuinely disagree" from
      // "we have no comicYear to compare against at all" — both previously
      // collapsed to the same yearDiff=999 sentinel, and the negative-
      // penalty branches below then punished the SECOND case as if it were
      // the first. Real production case: comicYear was null (no year signal
      // from Vision or an authoritative eBay consensus); a same-named
      // "Captain Marvel" volume that correctly had its start_year fetched
      // (vid=50575, 2012, the real DeConnick-run volume) scored yr=-5 purely
      // for having data available to compare — while vid=6458, which never
      // got its volume details fetched at all (capped at 5 unique volume
      // IDs per request), scored yr=0 by omission and won. Absence of a
      // year to compare is not evidence of a year mismatch; only apply the
      // gap-based scoring (positive OR negative) when a genuine comparison
      // was possible.
      const hasYearComparison = Boolean(comicYear && startYear);
      const yearDiff = hasYearComparison ? Math.abs(startYear - comicYear) : 999;

      // PART 3: Year gap penalty for large differences — gated on
      // hasYearComparison; see comment above.
      let detailYearScore = hasYearComparison ? (yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0) : 0;
      if (hasYearComparison && yearDiff >= 30) detailYearScore = -5;
      else if (hasYearComparison && yearDiff > 20) detailYearScore = -2;

      // Q121 dispatch (2026-07-19, Captain Marvel #17 fix #2) — poolYearHint
      // only ever applies when hasYearComparison is false (no authoritative
      // comicYear exists at all) — it never competes with or overrides a
      // real year comparison, only supplements the no-data case Q120
      // isolated. Deliberately smaller magnitude than the authoritative
      // scale above (+1/-2 here vs +2/-5 there) — a raw pool-derived modal
      // year from seller title text is weaker evidence than an authoritative
      // field and should never dominate name/publisher scoring.
      let poolYearHintScore = 0;
      if (!hasYearComparison && poolYearHint?.year && startYear) {
        const poolYearDiff = Math.abs(startYear - poolYearHint.year);
        if (poolYearDiff <= 3) poolYearHintScore = 1;
        else if (poolYearDiff > 15) poolYearHintScore = -2;
      }

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

      const total = base.nameScore + detailYearScore + detailPubScore + subtitleScore + poolYearHintScore;
      return { ...base, yearScore: detailYearScore, publisherScore: detailPubScore, subtitleScore, poolYearHintScore, total, volume: vol };
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
        `${s.r.volume?.name}(name=${s.nameScore} yr=${s.yearScore} pub=${s.publisherScore} sub=${s.subtitleScore || 0} poolYr=${s.poolYearHintScore || 0} total=${s.total} vid=${s.volId})`
      ).join(" | ")}`);

      const topScore = scored[0].total;

      // Q-BATMAN222 — scored is sorted descending, so topScore===0 means
      // EVERY candidate scored <=0 on every axis (name/year/publisher/
      // subtitle) -- none of them actually matched anything about this
      // book. Real production case: ComicVine matched "Batman" to a
      // volume named "Tiger" (all top-3 candidates: name=0 yr=0 pub=0
      // sub=0 total=0). The tiebreaker below exists to pick between
      // genuine close contenders, not to manufacture a "winner" out of a
      // field of complete non-matches -- return no-match instead of
      // silently adopting whichever volume happens to sort first among
      // equally-worthless scores.
      if (topScore === 0) {
        console.log(`[comicvine] all ${scored.length} candidates score total=0 — no genuine match, returning none instead of tiebreaking`);
        match = null;
      } else {
        // PART 2: Publisher tiebreaker when top 2 scores within 10 points
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

    // Q99 (ruled) — defense-in-depth: a foreign-reprint-publisher volume
    // should never survive to `match` now that cv-reprint-gate commits to
    // zero candidates instead of resurrecting them (above), but if some
    // other path ever lets one through (e.g. it legitimately outscores a
    // domestic candidate on title tokens), its start_year must never
    // anchor confirmedYear — that's exactly how UXM #141 got year=2002
    // instead of 1981. Suppressing startYear here forces the same safe
    // fallback: resolveYear/backfillFromComps pick up the real year from
    // eBay comp consensus instead of trusting a reprint edition's year.
    const resolvedCvPublisher = volDetail?.publisher?.name || match.volume?.publisher?.name || null;
    const cvIsForeignReprint = resolvedCvPublisher
      ? REPRINT_PUBLISHERS.some(rp => String(resolvedCvPublisher).toLowerCase().includes(rp))
      : false;
    if (cvIsForeignReprint) {
      console.log(`[cv-year-suppress] foreign reprint publisher "${resolvedCvPublisher}" — start_year withheld from year resolution`);
    }

    return {
      id: match.id,
      name: match.name,
      issueNumber: match.issue_number,
      volume: match.volume?.name,
      volumeId: vid,
      publisher: resolvedCvPublisher,
      startYear: cvIsForeignReprint ? null : (volDetail?.start_year || null),
      foreignReprintPublisher: cvIsForeignReprint,
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
    // Q109-G [2026-07-17]: 9.5 was the only real gap in this table — CGC
    // does issue 9.5 as a census grade, but it fell through to
    // nearest-neighbor resolution (tied 9.4/9.6, tie-break landing on
    // 9.4, always slightly under). Added as the exact midpoint of the
    // documented 9.4/9.6 entries (2.2 + 3.0) / 2 = 2.6 — the table isn't
    // linear across its full range, but 9.5 sits exactly halfway between
    // these two known, adjacent points regardless, so no extrapolation
    // or curve-fitting assumption is needed.
    10: 12.0, 9.9: 8.0, 9.8: 5.0, 9.6: 3.0, 9.5: 2.6, 9.4: 2.2, 9.2: 1.8,
    9.0: 1.5, 8.5: 1.3, 8.0: 1.15, 7.5: 1.05, 7.0: 1.0, 6.5: 0.9,
    6.0: 0.85, 5.5: 0.8, 5.0: 0.75, 4.5: 0.7, 4.0: 0.65, 3.5: 0.6,
    3.0: 0.55, 2.5: 0.5, 2.0: 0.45, 1.8: 0.4, 1.5: 0.35, 1.0: 0.3,
    0.5: 0.2,
  },
  modern: {
    // Q109-G — same fix, modern table: (1.35 + 1.6) / 2 = 1.475.
    10: 3.0, 9.9: 2.6, 9.8: 2.2, 9.6: 1.6, 9.5: 1.475, 9.4: 1.35, 9.2: 1.2,
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
  if (table[g] != null) return { multiplier: table[g], grade: g, era, gradeFallback: false };
  let closest = CGC_GRADES[0];
  let minDist = Math.abs(g - closest);
  for (const k of CGC_GRADES) {
    const d = Math.abs(g - k);
    if (d < minDist) { closest = k; minDist = d; }
  }
  // Q109-G — explicit signal (not left for callers to re-derive by diffing
  // grade vs. the requested value) so a future table gap surfaces on the
  // card instead of silently resolving to a neighboring grade's price.
  return { multiplier: table[closest], grade: closest, era, gradeFallback: true };
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

// Q108 CHANGE 1 — added card stock/foil/sketch/blank/virgin/trade-dress
// descriptors. These are always variant-qualifier words in a PC product
// name — a base/plain entry never carries them — so it's safe to exclude
// globally regardless of whether our own variant is confirmed or null
// (Wonder Woman #75 class: PC anchored to "[Card Stock]" on a Cover A scan
// because none of the prior tokens matched that product name).
const PRICECHARTING_EXCLUDE =
  /facsimile|reprint|homage|variant|walmart|newsstand|mexican|authentix|true believers|marvel tales|card stock|cardstock|foil cover|sketch cover|blank cover|trade dress|virgin cover|gold foil|silver foil/i;

// GrailKey Commit M2 (2026-08-03, Iron Man #126 signed-edition class) —
// PC's own '#' convention is unambiguous: a genuine issue number is
// ALWAYS '#' + digits ("#126"). A '#' immediately followed by a LETTER
// is structurally never an issue number — it's a certification/signing
// SKU code. Real evidence: "Bob Layton The Invincible Iron Man Vol.1 126
// #CC-BL" (a signed/certified edition, confirmed via Commit L's
// diagnostic) — "#CC-BL" is exactly this shape. Loosening issueRe (M1,
// below) to accept a bare "126" without a leading '#' would otherwise
// ALSO admit this exact product (it carries "126" bare in "Vol.1 126"),
// pricing a raw copy off a signed-edition entry — worse than no match at
// all. This check is what keeps that from happening. Deliberately a
// structural signal (letter immediately after '#'), not a name/alias
// list — generalizes to any PC-cataloged signed/certified SKU without
// needing to know the specific signer or service.
const PC_SKU_CODE_RE = /#[a-z]/i;

// Token-health visibility (dispatch 2026-07-16). PC gives no dedicated
// status endpoint — an expired/invalid token surfaces as either a 401/403/410
// HTTP status or (observed in practice) an HTTP 200 with an error string in
// the JSON body. Either shape must be logged with an unmistakable marker and
// distinguished from the ordinary "no results for this obscure book" null
// return, which is expected behavior, not a system fault.
const PC_TOKEN_ERROR_RE = /access token has expired|invalid.{0,20}token|token.{0,20}invalid|unauthorized/i;
const flagPcTokenErrorIfPresent = (status, bodyText, pcDiag) => {
  const authStatus = status === 401 || status === 403 || status === 410;
  const bodyFlagsAuth = !!bodyText && PC_TOKEN_ERROR_RE.test(bodyText);
  if (!authStatus && !bodyFlagsAuth) return false;
  console.error(
    `[pricecharting] TOKEN EXPIRED — all PC data unavailable until rotated ` +
    `(HTTP ${status}${bodyText ? `: ${String(bodyText).slice(0, 200)}` : ""})`
  );
  if (pcDiag) pcDiag.pcTokenExpired = true;
  return true;
};

// GrailKey Dispatch 03 prerequisite (2026-08-06) — [pc-candidate]/[pc-reject]
// are per-PC-product diagnostics (Commit L/M) that can run to 100+ lines on
// a broad query (Jetsons class: 90 candidates, 90 rejections in one request)
// and were observed eating a Vercel runtime-log capture's size budget before
// later, more load-bearing lines ([decision], [vision-zero-support]) ever
// got written — a real investigation blocker, not just noise. OFF by
// default; set PC_VERBOSE_LOG=true to restore full per-candidate tracing
// when actually debugging PC matching itself. Does not touch the single-shot
// [pricecharting]/[pc-reject] lines outside the per-product loop (query-level
// events, already low-volume).
const PC_VERBOSE_LOG = process.env.PC_VERBOSE_LOG === 'true';

const lookupPriceCharting = async ({ title, issue, year, yearConfidence = 'proven', eraHint = null, variant = null, pcDiag = null, pcProductId = null }) => {
  if (!issue) {
    console.log("[pt] no issue number — skipping");
    return null;
  }
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token || !title) {
    console.log(`[pc-reject] query never sent — reason=${!token ? 'no-token' : 'no-title'}`);
    return null;
  }

  // Q109-E [2026-07-17] — id-anchored lookup. When a prior successful
  // resolution's PC product id is known (persisted client-side alongside
  // the catalogued item), use PC's direct single-product endpoint instead
  // of the fuzzy q= text search. Prevents re-scan drift to a different
  // product that merely happens to score higher on THIS request's text
  // match (Captain America #25 Steranko-vs-Young, Wonder Woman #75
  // Frison, Spider-Versity Camuncoli class). Falls through to the
  // existing q= path on ANY failure — deleted/stale id, network error,
  // unexpected shape — so a bad stored id can never permanently break
  // pricing for a book. Distinct endpoint, confirmed via PriceCharting's
  // own published example (docs page itself 403s for automated fetches,
  // same block noted in docs/PC_API_INVESTIGATION.md): GET /api/product
  // (singular) ?id=&t= returns a flat single-product object, unlike
  // /api/products (plural) ?q=&t= which returns { products: [...] }.
  if (pcProductId) {
    try {
      const idUrl =
        `https://www.pricecharting.com/api/product` +
        `?id=${encodeURIComponent(pcProductId)}&t=${encodeURIComponent(token)}`;
      const idRes = await fetch(idUrl);
      if (idRes.ok) {
        const idJson = await idRes.json();
        const idBodyOk = idJson && idJson.status !== 'error' && typeof idJson['product-name'] === 'string';
        if (idBodyOk) {
          const cents = idJson['loose-price'];
          if (cents != null && !isNaN(cents) && cents > 0) {
            const name = idJson['product-name'];
            const yearMatch = name.match(/\((\d{4})\)/);
            const productYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
            console.log(`[pricecharting] id-anchored hit: id=${pcProductId} "${name}"`);
            return {
              price: cents / 100,
              productName: name,
              id: idJson.id || pcProductId,
              year: productYear,
              source: "pricecharting",
              idAnchored: true,
            };
          }
        }
        console.log(`[pricecharting] id-anchored lookup returned unusable data for id=${pcProductId} — falling back to q= search`);
      } else {
        console.log(`[pricecharting] id-anchored lookup HTTP ${idRes.status} for id=${pcProductId} — falling back to q= search`);
      }
    } catch (err) {
      console.log(`[pricecharting] id-anchored lookup error for id=${pcProductId}: ${err?.message || err} — falling back to q= search`);
    }
  }

  try {
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();

    const issueStr = issue ? String(issue).trim() : null;
    // GrailKey Commit M1 (2026-08-03, Iron Man #126 class) — was
    // `#${issueStr}\b` (required a literal '#' immediately before the
    // digits). PC formats some products with a BARE issue number ("Vol.1
    // 126", no '#' at all) — confirmed via Commit L's diagnostic: PC's
    // single returned candidate for Iron Man #126 carried "126" bare,
    // and its only '#' was on an unrelated SKU suffix ("#CC-BL"). `\b`
    // on both sides is what actually does the work: it requires the
    // digits to stand alone (not glued to another digit or letter), so
    // "1265" and "SKU126A" still correctly fail to match while "Vol.1
    // 126" and "Iron Man #126" (the '#' is a non-word character, so a
    // boundary exists there either way) both succeed. False-positive
    // risk: a product name that happened to embed the bare number as an
    // unrelated standalone token (e.g. a price string like "$126.00" in
    // the name field) would now match — PC's product-name field has
    // never been observed carrying price text in any sample seen this
    // session, so this is a theoretical, not evidenced, risk.
    const issueRe = issueStr
      ? new RegExp(`\\b${issueStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
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
    // G.O.D.S. dispatch — collapse punctuated acronyms before the strip below.
    const tokenize = (s) =>
      normalizeAcronyms(String(s || '')).toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !COMMON_TOKENS.has(t));

    const hasVariantDescriptor = (name) => {
      if (/\[[^\]]+\]/.test(name)) return true;
      const parenGroups = name.match(/\(([^)]*)\)/g) || [];
      return parenGroups.some((g) => !/^\(\s*\d{4}\s*\)$/.test(g));
    };

    // GrailKey Commit M (2026-08-03) — the fetch + match-loop, extracted
    // to a closure so it can run against more than one query text (M3,
    // below) without duplicating the ~100 lines of matching logic.
    // Unchanged from the pre-M implementation except: (1) issueRe
    // loosened per M1 above, (2) PC_SKU_CODE_RE exclusion added per M2,
    // (3) every raw candidate logged via [pc-candidate] before any
    // filtering — the Phase 0 diagnostic the dispatch asked for, kept
    // permanently rather than thrown away, since it's needed for every
    // future rejection this cheaply.
    const attemptPcSearch = async (attemptSeriesName) => {
      const query = issue ? `${attemptSeriesName} ${issue}` : attemptSeriesName;
      const url =
        `https://www.pricecharting.com/api/products` +
        `?q=${encodeURIComponent(query)}&type=comic&t=${encodeURIComponent(token)}`;
      console.log(`[pricecharting] query="${query}"`);
      const res = await fetch(url);
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        if (flagPcTokenErrorIfPresent(res.status, bodyText, pcDiag)) return null;
        console.error(`[pricecharting] HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      // PC's auth failures aren't always a non-2xx status — the API has
      // been observed returning HTTP 200 with an error payload for an
      // expired token. Check the body regardless of res.ok.
      if (json && typeof json.error === "string" && flagPcTokenErrorIfPresent(res.status, json.error, pcDiag)) {
        return null;
      }
      const products = Array.isArray(json?.products) ? json.products : [];
      if (products.length === 0) {
        console.log(`[pc-reject] query="${query}" — reason=zero-products (PC's own search returned nothing)`);
        return null;
      }
      if (PC_VERBOSE_LOG) {
        for (const p of products) {
          console.log(`[pc-candidate] "${p["product-name"] || ''}"`);
        }
      }

      const queryTokens = tokenize(attemptSeriesName);
      const mainToken = queryTokens[0];

      // Q86: unproven-year candidates that fail the year gate are demoted
      // to a fallback rank instead of rejected — a Vision-guessed year
      // must not veto the only real product match (Funny Book #1 1971
      // class).
      const q86Fallbacks = [];
      // Q88(a): below-quorum era is ADVISORY — out-of-era candidates are
      // demoted (rank penalty), never rejected. Any in-era product wins
      // first.
      const eraFallbacks = [];
      // Q108 CHANGE 2 — when no variant is confirmed, a PC product
      // carrying a named-variant descriptor (bracket, or a paren group
      // that isn't just the bare year) is demoted below any plain base
      // entry. Lowest-priority fallback tier — only consulted once
      // era/year fallbacks are exhausted.
      const variantFallbacks = [];

      for (const p of products) {
        const name = p["product-name"] || "";
        // GrailKey Commit L (2026-08-03) — I13 applied to PC matching:
        // the trace must carry both the rejected candidate and the
        // reason. These previously rejected silently (bare `continue`,
        // no log) — the Iron Man #126 class (PC returns exactly 1
        // product, "no valid match" with zero visibility into why).
        const excludeMatch = PRICECHARTING_EXCLUDE.exec(name);
        if (excludeMatch) {
          if (PC_VERBOSE_LOG) console.log(`[pc-reject] "${name}" — reason=exclude:${excludeMatch[0]}`);
          continue;
        }
        // GrailKey Commit M2 (2026-08-03) — signed/certified SKU
        // exclusion. MUST run before issueRe (below): M1 loosened
        // issueRe to accept a bare issue number, which would otherwise
        // ALSO admit a signed-edition product carrying that same bare
        // number ("Vol.1 126") — this check keeps that from happening.
        // See PC_SKU_CODE_RE's own doc comment for the full rationale.
        const skuMatch = PC_SKU_CODE_RE.exec(name);
        if (skuMatch) {
          if (PC_VERBOSE_LOG) console.log(`[pc-reject] "${name}" — reason=signed-sku:${skuMatch[0]}`);
          continue;
        }
        if (issueRe && !issueRe.test(name)) {
          if (PC_VERBOSE_LOG) console.log(`[pc-reject] "${name}" — reason=issue-regex`);
          continue;
        }

        // Year validation: reject products from the wrong era — unless
        // the claimed year is UNPROVEN (Q86): then mismatch = rank
        // penalty only.
        let q86YearMismatch = false;
        if (comicYear) {
          const yearMatch = name.match(/\((\d{4})\)/);
          const productYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
          if (productYear && Math.abs(productYear - comicYear) > 5) {
            if (yearConfidence === 'unproven') {
              q86YearMismatch = true; // demote below year-matching candidates
            } else {
              console.log(`[pricecharting] skipping "${name}" — year ${productYear} vs ${comicYear}`);
              continue;
            }
          }
        }

        // Ship #20a.6.7b.1 — Token overlap validation. Skip when the main
        // query token (first substantive word) is absent from the
        // product name. Q85: compact-key fallback — "Funnybook" query
        // vs "Funny Book #1 (1971)" product: mainToken "funnybook" is
        // absent at token level but the compact keys are identical.
        // Strict containment of the whole compacted series name (≥4
        // chars) in the compacted product name rescues compound-spacing
        // variants.
        if (mainToken) {
          const productTokens = tokenize(name);
          if (!productTokens.includes(mainToken)) {
            const seriesKey = compactTitleKey(attemptSeriesName);
            const productKey = compactTitleKey(name);
            if (seriesKey.length >= 4 && productKey.includes(seriesKey)) {
              console.log(`[Q85] compact-key rescue: "${attemptSeriesName}" ⊂ "${name}"`);
            } else {
              if (PC_VERBOSE_LOG) {
                console.log(`[pricecharting] skipping "${name}" — main token "${mainToken}" absent`);
                console.log(`[pc-reject] "${name}" — reason=main-token`);
              }
              continue;
            }
          }
        }

        const cents = p["loose-price"];
        if (cents == null || isNaN(cents) || cents <= 0) {
          if (PC_VERBOSE_LOG) console.log(`[pc-reject] "${name}" — reason=no-price (loose-price=${cents})`);
          continue;
        }
        const price = cents / 100;
        const yearMatch2 = name.match(/\((\d{4})\)/);
        const productYear = yearMatch2 ? parseInt(yearMatch2[1], 10) : null;
        console.log(`[pt] matched: "${name}" year: ${productYear} comic year: ${comicYear}`);
        // Stricter era check: skip if year gap > 5 (Q86: unproven → demote)
        if (comicYear && productYear && Math.abs(productYear - comicYear) > 5) {
          if (yearConfidence === 'unproven') {
            q86YearMismatch = true;
          } else {
            console.log(`[pt] year mismatch — skipping`);
            continue;
          }
        }
        const candidate = { price, productName: name, id: p.id, year: productYear, source: "pricecharting" };
        // Q108 CHANGE 2 — a product name carrying a variant descriptor is
        // deferred (not returned immediately) regardless of whether
        // variant is confirmed — Q-PC-VARIANT-SCORE (below) needs to see
        // the FULL set of bracket candidates to score them, not just the
        // first one PC happens to list. Null confirmedVariant: unchanged,
        // a plain/unbracketed entry still wins outright via the early
        // return below (Q108's original base-preference, untouched).
        // Populated confirmedVariant: previously these fell through to
        // an immediate `return candidate` on whichever bracket PC listed
        // FIRST — the Captain America [Steranko] #25 (2017) class bug,
        // an unrelated printing beating the actual [Young] #25 (2020)
        // variant in hand purely by API ordering. Scored at resolution
        // time instead.
        if (hasVariantDescriptor(name)) {
          console.log(
            variant
              ? `[pc-anchor] deferred "${name}" for variant-match scoring against "${variant}"`
              : `[pc-anchor] deprioritized "${name}" — variant descriptor present, confirmedVariant=null`
          );
          variantFallbacks.push(candidate);
          continue;
        }
        if (q86YearMismatch) {
          q86Fallbacks.push(candidate);
          continue; // keep scanning for a year-matching product first
        }
        // Q88(a): advisory-era rank penalty — a year-passing candidate
        // outside the advisory era is demoted, preferring any in-era
        // product.
        if (eraHint && productYear && (productYear < eraHint.minYear || productYear > eraHint.maxYear)) {
          eraFallbacks.push(candidate);
          continue;
        }
        if (variantFallbacks.length > 0) {
          console.log(`[pc-anchor] base entry preferred over ${variantFallbacks.length} deferred variant candidate(s)`);
        }
        console.log(`[pc-accept] "${candidate.productName}" — reason=base-entry`);
        // GrailKey Commit N2 (2026-08-03, Spawn Brett Booth PC-anchor
        // class) — carry forward whatever variant-descriptor candidates
        // were already seen (and deprioritized) BEFORE this base entry
        // was accepted, so the caller can re-score them once
        // confirmedVariant becomes known later in the request (it is
        // not resolved yet at this point — see api/enrich.js's own N2
        // re-anchor block for why retain-and-rescore was chosen over a
        // second live PC query). Honest scope limit: only captures
        // variant candidates PC listed BEFORE this base entry in its own
        // result order — one still unseen after this point (had the loop
        // continued) is not recoverable without a second query. Matches
        // the real Spawn #351 production case, where PC listed the
        // variant entry first.
        if (variantFallbacks.length > 0) {
          candidate.deferredVariantCandidates = variantFallbacks.slice();
        }
        return candidate;
      }
      // Q88(a): no in-era product — accept the best out-of-era candidate.
      // Advisory era (below quorum) is a rank penalty, never a rejection.
      if (eraFallbacks.length > 0) {
        const fb = eraFallbacks[0];
        console.log(
          `[22a] era-advisory demotion tolerated: "${fb.productName}" (${fb.year}) ` +
          `outside advisory ${eraHint.decade}s — no in-era product`
        );
        console.log(`[pc-accept] "${fb.productName}" — reason=era-advisory-fallback`);
        return { ...fb, eraAdvisoryConflict: true };
      }
      // Q86: no year-matching product — accept the best year-mismatched
      // candidate when the claimed year was unproven (rank penalty, not
      // rejection). Product-page year becomes the better anchor
      // downstream.
      if (q86Fallbacks.length > 0) {
        const fb = q86Fallbacks[0];
        // Q86-B: BOUND the tolerance. A 38y-gap DIFFERENT book slipped
        // through (CA Special 1984 → Winter Soldier Special 2022).
        // Tolerance requires compact-title containment BOTH directions —
        // the claimed series key must equal the product's core key
        // (issue/paren stripped, articles dropped) — AND a year gap
        // ≤15y. Else no-match stands.
        const q86bGap = (comicYear && fb.year) ? Math.abs(fb.year - comicYear) : null;
        const q86bCoreKey = (s) => compactTitleKey(
          String(s || '').toLowerCase().replace(/\b(?:the|a|an)\b/g, ' ')
        );
        const productCore = String(fb.productName || '')
          .replace(/#\s*[\d.]+.*$/, ' ')
          .replace(/\([^)]*\)/g, ' ');
        const claimedKey = q86bCoreKey(attemptSeriesName);
        const productKey = q86bCoreKey(productCore);
        const coreEquivalent = claimedKey.length >= 4 && claimedKey === productKey;
        if (!coreEquivalent || q86bGap == null || q86bGap > 15) {
          console.log(
            `[Q86-B] tolerance rejected: "${fb.productName}" gap=${q86bGap}y ` +
            `claimedKey="${claimedKey}" productKey="${productKey}" — no-match stands`
          );
          return null;
        }
        console.log(
          `[Q86] year-mismatch tolerated (unproven year): "${fb.productName}" ` +
          `product-year=${fb.year} vs claimed=${comicYear} (Q86-B: core-equivalent, gap=${q86bGap}y)`
        );
        console.log(`[pc-accept] "${fb.productName}" — reason=year-mismatch-tolerated`);
        return { ...fb, yearMismatchTolerated: true };
      }
      // Q108 CHANGE 2 — no base entry survived at all; the only usable
      // data is a named-variant product. Deprioritized, not excluded —
      // fall back to it rather than refuse a price outright.
      // Q-PC-VARIANT-SCORE — when confirmedVariant is populated, pick
      // the candidate whose bracket best matches it (Captain America
      // [Young] #25 (2020) over an unrelated [Steranko] #25 (2017) that
      // merely happened to rank first in PC's own API order). Null
      // confirmedVariant: selectBestVariantCandidate returns
      // candidates[0] — identical to the prior arbitrary/first-
      // encountered behavior, unchanged.
      if (variantFallbacks.length > 0) {
        const fb = selectBestVariantCandidate(variantFallbacks, variant);
        console.log(
          variant
            ? `[pc-anchor] variant-scored: "${fb.productName}" best matches confirmedVariant="${variant}" (of ${variantFallbacks.length} candidates)`
            : `[pc-anchor] no base entry found — falling back to variant entry "${fb.productName}"`
        );
        console.log(`[pc-accept] "${fb.productName}" — reason=variant-fallback`);
        return { ...fb, variantFallback: true };
      }
      console.log(`[pricecharting] no valid match in ${products.length} results — all ${products.length} candidate(s) rejected, see [pc-reject] lines above`);
      return null;
    };

    let result = await attemptPcSearch(seriesName);
    if (result) return result;

    // GrailKey Commit M3 (2026-08-03) — query fallback. Scoped strictly
    // to the Phase 0 evidence: PC's own search behaves differently for
    // an inflated masthead-banner title ("The Invincible Iron Man")
    // than for its shorter catalog form ("Iron Man"). Rather than a
    // hardcoded alias table (explicitly out of scope per the dispatch),
    // this reuses the SAME tokenize/COMMON_TOKENS machinery mainToken
    // already relies on: drop the single leading substantive word
    // (mechanically — "Invincible" is never named explicitly anywhere
    // in this code) and retry once. Bounded to exactly one retry, and
    // only fires when the primary attempt found nothing — ASM #300 and
    // every other book whose primary query already succeeds never
    // reaches this path, so their behavior is byte-identical.
    const fallbackTokens = tokenize(seriesName);
    if (fallbackTokens.length >= 3) {
      const fallbackSeriesName = fallbackTokens.slice(1).join(' ');
      console.log(`[pc-query] primary query found no match — retrying with leading word stripped: "${seriesName}" -> "${fallbackSeriesName}"`);
      result = await attemptPcSearch(fallbackSeriesName);
      if (result) return result;
    }

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
  // downstream cross-reference + UI inspection. Items always returned
  // (with parsed title / issue / year / variantTokens) so callers can
  // see ALL parsed rows even when consensus didn't fire.
  //
  // Q-ADV397 (2026-07-15) — issue-consensus voting now delegates to
  // extractConsensus (same helper phase1 already uses for title
  // consensus + the resolveIdentity zero-support check) instead of a
  // separate ad-hoc freq/maxCount tally. The two implementations used
  // different denominators: this function's old tally counted only rows
  // with a parseable issue number (e.g. 18 of 20), while extractConsensus
  // counts the full pool (20) — a real production case (Adventure Comics
  // #397, eBay pool split 9/18 for a different issue #401) cleared the
  // old ad-hoc ">=3 raw hits" bar at 50% but fails extractConsensus's
  // issueOk>=50%-of-total gate at the correct denominator (9/20=45%).
  // Same function, one accounting, can't disagree with itself again.
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
    const rawItems = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
    if (rawItems.length === 0) return null;

    // Commit C (2026-07-28) — marketplace-category + title-pattern
    // eligibility filter runs HERE, on the RAW eBay items (which still
    // carry leafCategoryIds + the full categories[] array with names),
    // before extractIdentityFromImageSearch ever parses them. Confirmed
    // via direct execution + real production logs that every downstream
    // consumer this dispatch is required to protect — extractIdentity's
    // own issue tally, this function's own internal consensus check a
    // few lines below, title-family clustering, family issue consensus,
    // year/publisher consensus, Q32's merchandise-vote denominator — all
    // read from this same `items`/`parsedRows`-derived pool (or a later
    // alias of it, `parsedVisualRows`, in the caller). Filtering at the
    // true origin point, before a single row of this pool is ever parsed
    // or tallied, means every one of those consumers is protected by
    // construction — no need to separately patch each call site.
    const { eligible: items, rejectedVisualEvidence } = filterVisualIdentityPool(rawItems);

    // Build structured identity rows once. Same parsed issue values feed
    // both the consensus voter below AND the surfaced items[] payload.
    const parsedRows = extractIdentityFromImageSearch(items);

    console.log('[visual] titles:', items.map((r) => r.title));
    console.log('[visual] extracted issues:', parsedRows.map((r) => r.issue).filter(Boolean));

    const claudeStr = claudeIssue ? String(claudeIssue).trim() : null;
    const result = { items: parsedRows, rejectedVisualEvidence };

    // Q-ADV397 — same consensus function, same denominator, as phase1's
    // title consensus and resolveIdentity's zero-support check. Requires
    // parsedRows.length >= 5 (no attempt on a thin pool) and issueOk =
    // issueResult.count / parsedRows.length >= 0.5 (not >= 0.5 of just the
    // parseable-issue subset) before `.issue` is populated at all.
    const consensus = extractConsensus(parsedRows, claudeIssue);
    const mostCommon = consensus?.issue ?? null;
    const claudeInResults = consensus ? consensus.agreement.visionIssueCount > 0 : false;

    console.log(
      '[visual] consensus:',
      consensus
        ? `issue=${mostCommon ?? 'none'} (${consensus.agreement.issue}/${consensus.agreement.total}) visionIssueCount=${consensus.agreement.visionIssueCount ?? 'n/a'}`
        : `none — pool=${parsedRows.length}${parsedRows.length < 5 ? ' (<5, no attempt)' : ' (below issueOk>=50% coherence gate)'}`
    );

    if (mostCommon && claudeStr && mostCommon !== claudeStr && !claudeInResults) {
      // Ship 8 — Vision-presence guard. Previous behavior: override
      // Vision whenever any other issue won frequency vote. This
      // produced false negatives like Thanos #11 where eBay returned
      // 4 hits for #11 and 6 hits for #3 (a more popular issue with
      // similar cover art). Frequency vote picked #3, system priced
      // wrong book. Fix: only override when Vision's issue is ABSENT
      // from eBay results entirely (zero hits). When Vision is in
      // results, even at minority count, trust Vision — it physically
      // saw the book on the user's desk.
      console.log(`[visual] Claude=#${claudeStr} NOT in eBay results — using consensus #${mostCommon} (${consensus.agreement.issue}/${consensus.agreement.total})`);
      result.issue = mostCommon;
      result.issueSource = "ebay_visual";
      result.claudeIssue = claudeStr;
    } else if (mostCommon && claudeStr && mostCommon !== claudeStr && claudeInResults) {
      console.log(`[visual] Claude=#${claudeStr} present in eBay results (${consensus.agreement.visionIssueCount} hits) — keeping Claude over consensus #${mostCommon}`);
      result.issue = claudeStr;
      result.issueSource = "claude_vision_confirmed";
    } else if (mostCommon && claudeStr && mostCommon === claudeStr) {
      console.log(`[visual] Claude=#${claudeStr} matches eBay consensus #${mostCommon} — keeping Claude`);
      result.issue = claudeStr;
      result.issueSource = "claude_vision";
    } else {
      console.log(`[visual] no coherent consensus — keeping Claude issue as-is:`, claudeStr);
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
  lookupPriceCharting,  // Q86 — exported for year-confidence tests
};

// TIER_SOURCE_MAP now lives in src/lib/priceBands.js, colocated with
// PRICE_BANDS_SOURCES (the exhaustive list of source values it must
// cover) — see that file for the map itself and the full incident
// history in its comments. Relocated here rather than just hoisted to
// this file's own module scope (GrailKey Dispatch 11, 2026-08-07)
// because this handler file does not cleanly exit when imported in a
// bare Node/test context (same reason buildActiveCompCacheKey and
// friends were relocated to cacheKeys.js, see the comment above) —
// tests/tier-source-map-completeness.test.js needs to import both the
// map and PRICE_BANDS_SOURCES directly.

// Q89-CACHE / Commit B.1 (Strange Tales dispatch) — the exact-pricing `ac:`
// active-comp cache key, plus the Commit 4.3 ComicVine/PriceCharting
// cache-key builders and the shared parser. Track B Phase 0, Commit 4.3
// (revision round 2, 2026-07-30) — RELOCATED to src/lib/cacheKeys.js
// (imported below) so a test can import the REAL functions directly
// without importing this whole handler file (which does not cleanly
// exit in a bare Node/test context — confirmed during implementation).
// Re-exported here for any other consumer that already imports them from
// this file's own module namespace.
export { buildActiveCompCacheKey, buildComicVineCacheKey, buildPriceChartingCacheKey, parseCacheKeyIssueSegment } from "../src/lib/cacheKeys.js";

export default async function handler(req, res) {
  // A6 BUILD-ID: Inject commit hash header (Vercel auto-injects VERCEL_GIT_COMMIT_SHA)
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.CV_BUILD_ID || 'unknown';
  res.setHeader('x-cv-build', buildId);
  console.log(`[boot] Comic Vault build ${buildId}`);

  // A6 dispatch (2026-07-26) — Option 1: response-embedded pipelineAudit.
  // traceId/identityRevision are per-request, generated once here so every
  // exit point (early-refused, hard-blocked, main path) uses the same
  // values. traceId is public-safe (randomUUID, never a provider request
  // ID). identityRevision is a monotonic per-request timestamp the client
  // uses to reject an older async response overwriting a newer one.
  const pipelineTraceId = randomUUID();
  const pipelineIdentityRevision = Date.now();
  // A6 dispatch, Scope 2 Option 2 — reset the per-request [22f] tokenizer
  // stats accumulator (src/lib/titleStripStats.js). Known bounded
  // concurrency caveat documented in that file.
  resetTitleStripStats();

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
      labelType,   // GL-2 (EX-5) — Vision slab label type (qualified/restored/...)
      labelNotes,  // GL-2 (EX-5) — verbatim slab label notes ("PAGE 12 MISSING")
      assetType,
      assetTypeConfident,  // 2026-07-18 — Vision's own "is this actually a comic" read
      author,  // Session 4B — book identity field from BOOK_PROMPT
      barcode,  // TRACK A — UPC/barcode scan
      manualIdentity,  // FIX 4 — Manual text search (title/issue/year)
      skipVision,      // FIX 4 — Skip Vision when manual identity provided
      skipImageSearch, // FIX 4 — Skip eBay image search when manual
      manualAuthority, // Track B Phase 0, Commit 3 — { correctedBy, correctedFields }, present only on a card-correction request
      priorIdentity,   // Track B Phase 0, Commit 3 — { title, issue, year, publisher, issueAuthority } snapshot of the card BEFORE correction, client-supplied (server has no other way to know the prior state)
      scanId,          // Slice 7 — client-minted per-scan ownership identifier (src/lib/scanOwnership.js), echoed back verbatim so App.jsx's gradeBlob can verify this response belongs to the scan that requested it. Absent on requests from older clients or non-gradeBlob call sites (e.g. refreshMarketData) — always optional.
    } = req.body || {};

    // Track B Phase 0, Commit 3 — Safeguards 1+2. prepareManualCorrectionRequest
    // enforces the EXACT four-condition manual-authority request contract
    // (manualIdentity===true, skipVision===true, skipImageSearch===true,
    // identitySource==='manual' — checking manualIdentity alone is not
    // sufficient, and a request that carries manualAuthority without the
    // other three is rejected outright, before any identity resolution,
    // external lookup, or mutation), THEN validates manualAuthority.correctedFields
    // against MANUAL_CORRECTION_ALLOWED_FIELDS (title/issue/year/publisher
    // only — price/contract/decision/etc. can never become user-authoritative
    // regardless of what a client requests), THEN normalizes all four
    // identity fields into `workingIdentity` — the values that actually
    // drive effectiveTitle/Issue/Year/Publisher below, not the raw request
    // fields (Safeguard 2: a raw " #3 " must become "3" everywhere
    // downstream — cache-key construction, PC/CV lookup, comp-query
    // construction, terminal out.* writes — never just in the display
    // layer).
    let manualCorrectionRequest = null;
    if (manualAuthority) {
      manualCorrectionRequest = prepareManualCorrectionRequest(req.body, new Date().getUTCFullYear());
      if (!manualCorrectionRequest.valid) {
        return res.status(400).json({
          error: manualCorrectionRequest.contractOk === false
            ? 'Invalid manual-authority request contract'
            : 'No valid corrections supplied',
          contractOk: manualCorrectionRequest.contractOk,
          rejectedFields: manualCorrectionRequest.validation?.rejectedFields || [],
          emptyFields: manualCorrectionRequest.validation?.emptyFields || [],
        });
      }
    }

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
    //
    // Track B Phase 0, Commit 3, Safeguard 2 — when this request is a
    // validated manual correction, `manualCorrectionRequest.workingIdentity`
    // (the NORMALIZED title/issue/year/publisher — e.g. raw " #3 " already
    // reduced to bare "3") is the authoritative working identity, not the
    // raw request fields. This is the first identity-dependent consumer of
    // those fields (cache-key construction, PC/CV lookup, and comp-query
    // construction all read effectiveTitle/effectiveIssue/effectiveYear/
    // effectivePublisher, directly or via confirmedTitle/confirmedIssue/
    // confirmedYear/confirmedPublisher downstream) — every later consumer
    // inherits the normalized form through these four variables, never the
    // raw one. Unaffected for every other path (barcode, fresh Scan-tab
    // manual entry with no manualAuthority, Vision/resolveIdentity) — this
    // only engages when manualCorrectionRequest is present AND valid.
    const effectiveTitle = barcodeIdentity?.title || (manualCorrectionRequest?.valid ? manualCorrectionRequest.workingIdentity.title : title);
    const effectiveIssue = barcodeIdentity?.issue || (manualCorrectionRequest?.valid ? manualCorrectionRequest.workingIdentity.issue : issue);
    const effectiveYear = barcodeIdentity?.year || (manualCorrectionRequest?.valid ? manualCorrectionRequest.workingIdentity.year : year);
    const effectivePublisher = barcodeIdentity?.publisher || (manualCorrectionRequest?.valid ? manualCorrectionRequest.workingIdentity.publisher : rawPublisher);

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

    // Q118 dispatch (2026-07-18) — internal consistency checker. Compares
    // Vision's own free-text reason against Vision's own RAW structured
    // fields (req.body.*, as sent by the client from grade.js's response —
    // deliberately NOT the confirmed*/resolved identity computed below,
    // which may legitimately differ from Vision's raw guess after eBay/PC/
    // CV correction; that's not an inconsistency, that's the pipeline
    // doing its job). Same recompute-at-point-of-use pattern as
    // editionWarning above, rather than trusting a field threaded through
    // grade.js's response and 5 client merge paths — avoids the exact
    // "dead field that silently never reaches the card" class of bug
    // found and fixed earlier tonight (Q110's compPoolContaminated).
    // Flag-only — see src/lib/visionConsistency.js for why auto-correction
    // isn't attempted here.
    const visionConsistency = checkVisionConsistency({
      reason: req.body?.reason,
      title: req.body?.title,
      issue: req.body?.issue,
      year: req.body?.year,
      isGraded: req.body?.isGraded,
    });
    if (visionConsistency.hasInconsistency) {
      console.log('[vision-consistency] flagged:', visionConsistency.flags.map((f) => f.id).join(', '));
    }
    // NOTE: assigned onto `out` further down, once `out` exists (const out
    // declared later) — same deferred-assignment pattern editionWarning
    // uses below. Do not assign to out here; out is not yet in scope.

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
    // Slice 7 — stamp once; finalizeResponse(out) returns `out` unmodified
    // except for attaching `.contract`, so this reaches every response
    // path that flows through `out` (the terminal res.status(200).json
    // sites at the bottom of this handler and the identity-refused early
    // return a few thousand lines below both do). JSON.stringify drops the
    // key entirely when scanId is undefined — no conditional needed here.
    out.scanId = scanId;

    // 2026-07-18 (anime/manga poster class) — Vision's own structured
    // assetTypeConfident read. Defaults true when absent (older callers,
    // eBay-first grade-only path) so nothing pre-existing gets blocked
    // retroactively; explicit false is the only thing that hard-gates.
    // Independent of identityConfident/visionConfidence — Vision can be
    // fully confident about grade/price fields while explicitly stating
    // the physical item isn't a comic at all, and visual-pool title
    // matches can still populate confident-looking identity fields for a
    // poster that happens to share a comic's title.
    out.assetTypeConfident = assetTypeConfident !== false;
    if (!out.assetTypeConfident) {
      // Q133 Slice 1c — text fix only: this has been advisory-only since
      // Q110 (2026-07-18); the real gating behavior is logged accurately
      // a few hundred lines below ('advisory only — pricing proceeds,
      // listing locked pending verification'). This line's wording was
      // never updated when Q110 shipped and was actively misleading anyone
      // reading logs post-Q110.
      console.log('[asset-type-gate] Vision reports this image is NOT a comic book — flagged advisory, not hard-blocked');
    }

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

    // Q106 FIX-1 — cgc-lookup races with the visual pool instead of waiting
    // behind it. Previous behavior: lookupCGC ran inside the Phase 2
    // Promise.all (after Phase 1's visual-pool vote had already locked
    // identity), then its result was applied to out.title/out.issue at the
    // very end of the handler — after comps/PC/CV had already queried the
    // wrong (visual-pool) identity. CGC's own cert-verification page is
    // authoritative for a slabbed book, so it must not wait on the pool.
    const cgcLookupPromise = (isGraded === true && certNumber)
      ? lookupCGC(certNumber).catch(() => null)
      : Promise.resolve(null);

    // Run eBay visual search alone to determine correct identity
    // FIX 4: Skip image search when manual identity provided
    const visualResult = (visualBase64 && !skipImageSearch)
      ? await lookupEbayVisual({ imageBase64: visualBase64, claudeIssue: issueNum }).catch(() => null)
      : null;

    // Commit C — the category-eligibility filter now runs INSIDE
    // lookupEbayVisual, before this pool is ever parsed (see that
    // function's own comment). visualResult.items already reflects the
    // eligible-only pool by the time it reaches here — no second filter
    // pass needed. I13: rejected rows are preserved for diagnostics only,
    // never fed back into identity/pricing.
    if (visualResult?.rejectedVisualEvidence?.length) {
      out.rejectedVisualEvidence = visualResult.rejectedVisualEvidence;
    }

    // Extract consensus from eBay image search results
    // visualResult.items already contains parsed rows from lookupEbayVisual
    const parsedVisualRows = visualResult?.items || [];
    // P0 (Q-VISION-ZERO-SUPPORT) — pass Vision's own (pre-backfill) issue
    // read so extractConsensus can tally agreement.visionIssueCount.
    // Q-FIX-B — also pass Vision's own publisher read (same `publisher`
    // const resolveIdentity's `vision.publisher` argument uses below) so
    // extractConsensus can tally agreement.visionPublisherCount the same
    // way, feeding resolveIdentity's new publisher zero-support check.
    const visualConsensus = extractConsensus(parsedVisualRows, issueNum, publisher);

    console.log(`[phase1] eBay visual: ${visualResult?.items?.length || 0} results, consensus=${visualConsensus ? 'YES' : 'NO'}`);
    if (visualConsensus) {
      console.log(`[phase1] eBay consensus: "${visualConsensus.title}" #${visualConsensus.issue} (confidence ${(visualConsensus.confidence * 100).toFixed(0)}%)`);
    }

    // Q106 FIX-1 — await the racing cgc-lookup BEFORE the title-family vote
    // (selectTitleFamilyCandidate, below) or the issue-consensus vote can
    // fire. When a usable CGC identity comes back, it wins outright — the
    // visual pool is demoted to zero weight for identity/comp-query purposes
    // (visualPoolWeight=0) and is used ONLY for the REPRINT_RE polybag/
    // facsimile-ratio check later (~3737-3745), unchanged.
    const cgcResult = await cgcLookupPromise;
    const cgcIdentityConfirmed = !!(cgcResult && cgcResult.title && cgcResult.issue);
    if (isGraded === true && certNumber && !cgcIdentityConfirmed) {
      console.log('[cgc-identity] cert lookup failed — falling back to visual pool');
    }
    // CGC's own labelType vocabulary ("Universal", "Signature Series", ...)
    // differs in case/wording from the lowercase tokens Vision returns
    // ("universal", "signature", ...) that the rest of the pipeline (e.g.
    // the Q100 FIX-A auth-token gate in api/comps.js) expects.
    const normalizeCgcLabelType = (raw) => {
      const s = String(raw || '').toLowerCase().trim();
      if (!s) return null;
      if (s.includes('signature')) return 'signature';
      if (s.includes('restored')) return 'restored';
      if (s.includes('qualified')) return 'qualified';
      if (s.includes('conserved')) return 'conserved';
      if (s.includes('universal')) return 'universal';
      return s;
    };

    // Q104 FIX-3 — Crossover/co-title detection, run BEFORE the title-family
    // vote (selectTitleFamilyCandidate, below) so the co-title requirement is
    // already known before any clustering/sanitization pass gets a chance to
    // silently collapse a two-character crossover title down to one name
    // (Deadpool/Batman class). Detection only here; preservation happens
    // after title sanitization, once confirmedTitle is otherwise final.
    const CO_TITLE_RE = /\b(?:featuring|vs\.?)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})/i;
    const CROSSOVER_RE = /\bcrossover\b/i;
    const detectCoTitle = (str) => {
      const m = String(str || '').match(CO_TITLE_RE);
      return (m && m[1]) ? m[1].trim() : null;
    };
    let coTitleToken = detectCoTitle(title);
    let coTitleSource = coTitleToken ? 'vision' : null;
    let coTitleIsCrossover = CROSSOVER_RE.test(String(title || ''));
    if (!coTitleToken && Array.isArray(visualResult?.items)) {
      for (const item of visualResult.items.slice(0, 3)) {
        const t = detectCoTitle(item?.rawTitle);
        if (t) { coTitleToken = t; coTitleSource = 'visual_pool_top3'; break; }
        if (CROSSOVER_RE.test(String(item?.rawTitle || ''))) coTitleIsCrossover = true;
      }
    }
    if (coTitleToken) {
      console.log(`[co-title] detected "${coTitleToken}" source=${coTitleSource} crossover=${coTitleIsCrossover}`);
    } else if (coTitleIsCrossover) {
      console.log(`[co-title] "crossover" marker seen but no extractable co-title name (featuring/vs pattern required)`);
    }

    // Ship #22a: Era lock from visual comp year histogram (Phase 1)
    // Extract year histogram from parsedVisualRows → consensus decade → lock ±10y
    // Threshold: ≥50% agreement. Below → era-unlocked flag, no guard.
    // E1/E2 protection: ASM #1 (1963) locks 1960s → PC "Divided We Stand" (2016) rejected.
    // Q63 FIX: Parse COVER years from comp titles (4-digit adjacent to issue tokens),
    // NOT listing/sale dates. Cavewoman (2000) must lock ~2000s, not 2020s (listing year).
    let eraLock = null;
    let eraAdvisory = null; // Q88(a): below-quorum era — rank penalty only, never rejects
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
            // Q88(a): era HARD-lock requires quorum — ≥6 year-bearing items,
            // or ≥50% of the pool once the pool is ≥12 (below that, a tiny
            // year sample dominates: Funnybook's 3-of-4 hit 75% agreement and
            // hard-locked 1940, then [era-gate] rejected the PC match Q86 had
            // tolerated — two gates fighting, book starved, 2026-07-12 06:53).
            const eraPoolSize = parsedVisualRows.length;
            const eraQuorumMet = totalWithYear >= 6 ||
              (eraPoolSize >= 12 && totalWithYear >= eraPoolSize * 0.5);
            if (eraQuorumMet) {
              eraLock = {
                decade,
                minYear: decade - 10,
                maxYear: decade + 19,
                confidence: ratio,
                source: 'visual_consensus'
              };
              console.log(`[22a] era-locked=${decade} consensus=${(ratio * 100).toFixed(0)}% (${count}/${totalWithYear})`);
            } else {
              eraAdvisory = {
                decade,
                minYear: decade - 10,
                maxYear: decade + 19,
                confidence: ratio,
                yearBearing: totalWithYear,
                poolSize: eraPoolSize,
                source: 'visual_consensus_advisory'
              };
              console.log(
                `[22a] era-advisory decade=${decade} consensus=${(ratio * 100).toFixed(0)}% ` +
                `yearBearing=${totalWithYear}/${eraPoolSize} — below quorum (need ≥6 year-bearing), rank penalty only`
              );
            }
          } else {
            eraUnlocked = true;
            console.log(`[22a] era-unlocked: consensus=${(ratio * 100).toFixed(0)}% < 50% threshold`);
          }
        }
      }
    }

    // Q121 dispatch (2026-07-19, Captain Marvel #17 fix #2) — a separate,
    // simpler, purpose-built year signal for ComicVine volume
    // disambiguation ONLY. Built alongside eraLock, from the same
    // parsedVisualRows, but with looser extraction: any 4-digit
    // 19xx/20xx token ANYWHERE in the title, no proximity-to-issue-marker
    // bridging, no first-half-only restriction. Confirmed via direct
    // testing against the real Captain Marvel #17 pool: eraLock's own
    // patterns extracted a year from only 1/20 titles (nowhere near its
    // own >=3 minimum) because sellers commonly put the cover year LATE
    // in the title, after grade/description text — breaking eraLock's
    // bridging and first-half heuristics. This looser extraction found
    // 7/20 titles with a parseable year, unanimous at 2014 — a real
    // signal eraLock's own logic cannot see on this pool shape.
    // Deliberately NOT reusing or modifying eraLock — a new, independent
    // value, zero interaction with eraLock's own decision or consumers.
    // Only ever consulted by lookupComicVine when comicYear is null
    // (Q120's hasYearComparison gate), at a much smaller magnitude than
    // the authoritative-year scale (+1/-2, not +2/-5) — appropriately
    // conservative for a signal built from raw seller title text with no
    // exact-year guarantee, unlike eraLock's own stricter quorum (kept
    // exactly as-is above, untouched).
    let poolYearHint = null;
    if (parsedVisualRows && parsedVisualRows.length >= 3) {
      const poolYearCounts = {};
      parsedVisualRows.forEach((r) => {
        const titleLower = (r.title || '').toLowerCase();
        const yearsInTitle = new Set(
          [...titleLower.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => parseInt(m[1], 10))
        );
        yearsInTitle.forEach((y) => {
          if (y >= 1900 && y <= 2030) poolYearCounts[y] = (poolYearCounts[y] || 0) + 1;
        });
      });
      const poolTotalWithYear = Object.values(poolYearCounts).reduce((s, c) => s + c, 0);
      if (poolTotalWithYear >= 3) {
        const [topYearStr, topCount] = Object.entries(poolYearCounts).sort((a, b) => b[1] - a[1])[0];
        const agreement = topCount / poolTotalWithYear;
        if (agreement >= 0.50) {
          poolYearHint = { year: parseInt(topYearStr, 10), agreement, sampleSize: poolTotalWithYear };
          console.log(`[cv-pool-year-hint] year=${poolYearHint.year} agreement=${(agreement * 100).toFixed(0)}% (${topCount}/${poolTotalWithYear})`);
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
    // Commit C — confirms, at the exact point title-family clustering
    // consumes the pool, that the eligibility filter already ran upstream
    // (inside lookupEbayVisual) and this pool's denominator excludes
    // whatever was hard-rejected. Only logs when something was actually
    // rejected, matching this dispatch's bounded-logging requirement.
    if (visualResult?.rejectedVisualEvidence?.length) {
      console.log(
        `[visual-identity-filter-family] eligibleRows=${visualResult.items?.length || 0} ` +
        `rejectedRowsExcludedFromDenominator=${visualResult.rejectedVisualEvidence.length}`
      );
    }
    // Q106 FIX-1 — visualPoolWeight=0 on a confirmed-CGC-identity path: skip
    // the title-family vote entirely rather than compute and then ignore it.
    // familyCandidate=null routes into the same "small pool" fallback paths
    // already exercised whenever the visual pool has <5 items — no new
    // branch, just reuses tested code that already handles a null candidate.
    const familyCandidate = (!cgcIdentityConfirmed && visualResult?.items?.length >= 5)
      // Q84-AMENDED: pass the eBay image consensus title so the dual-axis
      // token-class gate can detect Vision+eBay agreement (Flash #75:
      // both said "the flash", arc family "flash year one" overrode both).
      ? selectTitleFamilyCandidate(visualResult.items, title, issueNum, year, {
          ebayConsensusTitle: visualConsensus?.title || null,
        })
      : null;
    mark('family_candidate_complete');

    let identityRefused = false;
    // Q142 instance 2 fix (2026-07-22, Adventure Time Summer Special class)
    // — hoisted to this outer scope so BOTH checkAssemblyIntegrity call
    // sites (Phase 1 ~line 2604 and Phase 2 ~line 4757) share the exact
    // SAME winning-family population, computed once, instead of Phase 2
    // drifting into its own independently-derived (and in this book's
    // case, diluted) copy. Assigned at Phase 1; read-only at Phase 2.
    let winningFamilyTitles = null;

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
    let identity, confirmedTitle, confirmedIssue, confirmedYear, confirmedPublisher, identitySource, confirmedGrade, confirmedLabelType;
    // Track B Phase 0, Commit 4.2 — declared separately from the grouped
    // list above (not an uninitialized member of it) so its intent reads
    // clearly: this is the captured custody context for the terminal
    // fingerprint finalizer, visible to both the phase-1 evidence-
    // construction branch (which assigns it) and the terminal
    // finalization block (which reads it), far later in this same
    // handler. See issueAuthority.js's restampVisualReferenceEvidenceYear
    // for what consumes it.
    let visualReferenceFingerprintContext = null;
    // Q134 dispatch (2026-07-21) — captured once, straight from
    // resolveIdentity's isProvisionalOverride (set at branch-fire time,
    // before any zero-support suffix can mutate identitySource). Every
    // later call site that needs to know "did the pool's provisional
    // identity win" reads THIS, never identitySource string-matching.
    // Stays false for barcode/manual/cgc-identity paths — none of those
    // ever go through resolveIdentity's provisional branch.
    let identityIsProvisionalOverride = false;
    // Q140 corrective dispatch (2026-07-23, review fix) — pre-pricing
    // fingerprint checkpoint. Captured at the end of EACH identity branch
    // below (barcode/manual/cgc/resolveIdentity), so it reflects exactly
    // the confirmedIssue value in scope the moment identity resolution
    // finishes — the same value that flows, unmodified, into the
    // fetchComps({ issue: confirmedIssue, ... }) call that actually drives
    // the active-comp search (api/enrich.js, ~line 4410). Compared against
    // confirmedIssue again at the terminal out.issue write, far below —
    // together the two checkpoints prove confirmedIssue never silently
    // drifts between "what pricing was computed against" and "what the
    // card renders," not merely that out.issue mirrors whatever
    // confirmedIssue last happened to be.
    let pricingIssue = null;

    if (barcodeIdentity) {
      // Barcode provides authoritative identity
      confirmedTitle = barcodeIdentity.title;
      confirmedIssue = barcodeIdentity.issue;
      confirmedYear = barcodeIdentity.year;
      confirmedPublisher = barcodeIdentity.publisher;
      identitySource = 'barcode';
      pricingIssue = confirmedIssue;
      console.log('[barcode] identity locked:', confirmedTitle, '#' + confirmedIssue);
    } else if (manualIdentity) {
      // FIX 4: Manual identity (user typed title/issue/year)
      confirmedTitle = effectiveTitle;
      confirmedIssue = effectiveIssue;
      confirmedYear = effectiveYear;
      confirmedPublisher = effectivePublisher;
      identitySource = 'manual';
      pricingIssue = confirmedIssue;
      console.log('[manual] identity locked:', confirmedTitle, '#' + confirmedIssue, confirmedYear || 'no-year');
    } else if (cgcIdentityConfirmed) {
      // Q106 FIX-1 — CGC cert-verification data is authoritative for a
      // slabbed book. Bypasses resolveIdentity/the visual-pool vote entirely.
      confirmedTitle = cgcResult.title;
      confirmedIssue = cgcResult.issue;
      confirmedYear = cgcResult.year || effectiveYear;
      confirmedPublisher = effectivePublisher;
      confirmedGrade = cgcResult.grade;
      confirmedLabelType = normalizeCgcLabelType(cgcResult.labelType) || (labelType || null);
      identitySource = 'cgc_cert';
      out.cgcVerified = true;
      out.cgcLabel = confirmedLabelType;
      out.certNumber = cgcResult.certNumber;
      if (confirmedGrade != null) out.grade = confirmedGrade;
      pricingIssue = confirmedIssue;
      console.log(`[cgc-identity] confirmed from cert title="${confirmedTitle}" issue="${confirmedIssue}" grade="${confirmedGrade}" label="${confirmedLabelType}"`);
    } else {
      // Standard Vision-based identity resolution.
      identity = resolveIdentity(
        // Track B Phase 0, Commit 4.3 (PRODUCTION AUTHORITY-CONTEXT
        // INTEGRATION HOLD, item 1, 2026-07-31) — buildStandardVisionAuthorityContext
        // (src/lib/identityCore.js) is the single, shared, server-built
        // authority context: `confidence` is Vision's own self-reported
        // req.body.confidence (never req.body.source/identitySource, never
        // a client-forwarded field) — see that function's own doc comment
        // for the full trace and rationale.
        { title: effectiveTitle, issue: issueNum, year: effectiveYear, publisher, ...buildStandardVisionAuthorityContext(confidence) },
        visualConsensus,
        familyCandidate,
        {
          ebayResultCount: visualResult?.items?.length || 0,
          overlapThreshold: 0.2,
          isGraded: isGraded === true,
          // EX-7 fold-in — same pool resolveIdentity uses to compute
          // agreement.visionIssueCount, reused for reprint-dominance gating.
          visualItems: parsedVisualRows,
        }
      );
      confirmedTitle = identity.confirmedTitle;
      confirmedIssue = identity.confirmedIssue;
      confirmedYear = identity.confirmedYear;
      confirmedPublisher = identity.confirmedPublisher;
      identitySource = identity.identitySource;
      identityIsProvisionalOverride = identity.isProvisionalOverride === true;
      pricingIssue = confirmedIssue;

      // Q140 corrective dispatch (2026-07-23, review fix) — surface the
      // FAMILY-vs-prior issue conflict (resolveFamilyIssueConsensus's
      // 'conflict-locked' mode — e.g. Vision/prior #139 vs a genuine,
      // adoption-bar-clearing family consensus of #170) to the response
      // and decision engine with full structured metadata. Previously this
      // was computed correctly inside resolveIdentity but only
      // console-logged — invisible to out, to computeDecision, and to the
      // card. currentIssue/consensusIssue/currentSource name the actual
      // conflict; support/population/ratio are the raw vote (never a bare
      // boolean); decision:'locked' records that confirmedIssue was never
      // overwritten.
      if (identity.familyIssueConsensus?.mode === 'conflict-locked') {
        const fic = identity.familyIssueConsensus;
        out.issueConsensusConflict = {
          currentIssue: String(confirmedIssue),
          consensusIssue: String(fic.winner),
          currentSource: identitySource,
          support: fic.support,
          population: fic.uniqueRows,
          ratio: Number(fic.ratio.toFixed(2)),
          decision: 'locked',
        };
        console.log(
          `[q140-terminal] issueConsensusConflict surfaced: current=#${confirmedIssue} (${identitySource}) ` +
          `vs family consensus=#${fic.winner} (${fic.support}/${fic.uniqueRows} = ${(fic.ratio * 100).toFixed(0)}%) — locked, never overwritten`
        );
        // Track B Phase 0, Commit 4.3.1 (Section E) — the near-miss
        // margin-decline conflict (identityCore.js's resolveIdentity)
        // shares this SAME legacy 'conflict-locked' mode, but is a
        // distinct shape from an ordinary Q140 family-vs-Vision conflict
        // (fic.reason is only ever set by that one branch) and, per the
        // observability requirement, additionally needs its own
        // structured [family-evidence] event — no other branch in this
        // file fires one for it (the mode==='adopted' branch below fires
        // only for that mode, which this near-miss shape never carries).
        // Reuses the same buildRetentionFamilyEvidenceLog/
        // buildRejectedCandidateFingerprint primitives the qualified
        // retention path already uses (Commit 4.1/4.3), not a second,
        // independently-maintained event shape.
        if (fic.reason === 'retention-margin-decline-conflict') {
          // COMMIT 4.3.1 HOLD (R1) — two DIFFERENT identities are in play
          // here (the untouched prior vs. the family's own disputed
          // measurement), so two DIFFERENT fingerprints are built and
          // logged by name, rather than collapsing them into one
          // familyKey that would misrepresent which issue the event's own
          // `rows` actually describe. Built from fic.resolvedValue/
          // fic.observedFamilyValue directly (the exact fields this
          // dispatch itself named), not re-read from confirmedIssue —
          // correct by construction even if a future refactor changes
          // what confirmedIssue holds at this point in the pipeline.
          const priorFingerprint = buildRejectedCandidateFingerprint(effectiveTitle, fic.resolvedValue, confirmedYear, null);
          const observedFamilyFingerprint = buildRejectedCandidateFingerprint(effectiveTitle, fic.observedFamilyValue, confirmedYear, null);
          const nearMissEvidenceLog = buildRetentionFamilyEvidenceLog(
            familyCandidate,
            fic,
            identity.familyYearConsensus,
            priorFingerprint,
            parsedVisualRows,
            observedFamilyFingerprint
          );
          if (nearMissEvidenceLog.isRetentionPath) {
            console.log(nearMissEvidenceLog.logLine);
          }
        }
      } else if (identity.familyIssueConsensus?.mode === 'adopted') {
        // Track B Phase 0, Commit 4 (2026-07-29) — a marketplace/pool-only
        // adoption (resolveFamilyIssueConsensus's 'adopted' mode is only
        // reachable when priorIssue was null — no Vision/user issue existed
        // to corroborate or conflict with) is ALWAYS provisional, never
        // silently promoted to a confirmed value just because nothing
        // contradicted it. Absence of contradiction is not corroboration.
        // Real call site for the extracted, exported
        // deriveIssueAuthorityFromAdoption (src/lib/issueAuthority.js) —
        // see that file's doc comment for the full invariant and the
        // documented, deliberate absence of a "no contradiction still
        // confirmed" carve-out.
        const fic = identity.familyIssueConsensus;
        // GrailKey Commit P (P1) — familyCandidate/parsedVisualRows passed
        // through so deriveIssueAuthorityFromAdoption can additionally
        // check whether the SAME family driving this adoption clears the
        // high-confidence marketplace-consensus bar (issueAuthority.js).
        // Does not change status ('provisional' either way) — only adds a
        // flag consumed later by computeIssueAuthorityContractPatch.
        const derived = deriveIssueAuthorityFromAdoption(fic, undefined, familyCandidate, parsedVisualRows);
        out.issueAuthority = derived.issueAuthority;
        out.identityProvisionalFields = derived.identityProvisionalFields;
        console.log(
          `[commit4] issueAuthority=provisional (marketplace-only-adoption): ` +
          `issue=#${fic.winner} support=${fic.support}/${fic.uniqueRows}=${(fic.ratio * 100).toFixed(0)}% — ` +
          `no prior Vision/user issue existed to corroborate against` +
          (derived.issueAuthority?.highConfidenceMarketplaceConsensus ? ' — [commit-p] high-confidence marketplace consensus qualifies (price will not be nulled at the terminal gate)' : '')
        );
        // Track B Phase 0, Commit 4.1 — same field, same union machinery
        // Commit 3 already shipped (getCorrectableFields,
        // manualCorrection.js) — 'year' is added ONLY when
        // resolveIdentity's own family-scoped year vote
        // (resolveFamilyYearConsensus, identityCore.js) actually adopted a
        // value from this same family, never unconditionally. No parallel
        // yearAuthority object: year's provisional-ness is fully expressed
        // by its presence here plus out.issueAuthority.status staying
        // 'provisional' (already the case whenever issue adopted) — the
        // existing Commit 4 contract-transition machinery
        // (computeIssueAuthorityContractPatch) needs no changes at all to
        // cover it.
        const nextProvisionalFields = appendYearToProvisionalFields(out.identityProvisionalFields, identity.familyYearConsensus);
        if (nextProvisionalFields !== out.identityProvisionalFields) {
          out.identityProvisionalFields = nextProvisionalFields;
          // GrailKey Commit P (P2b) — this year/support/population triple
          // was previously computed for this exact log line and nothing
          // else: identityProvisionalFields itself (the bare flag) reached
          // out and the client, but the VALUE the flag is about, and how
          // strong the vote behind it was, existed only in server console
          // output. Card could show "year is provisional" but never what
          // year, or on what evidence. Mirrors the log line's own data
          // exactly — no new computation, just also assigning it to out.
          out.identityProvisionalYearDetail = buildIdentityProvisionalYearDetail(identity.familyYearConsensus);
          console.log(
            `[commit4.1] identityProvisionalFields += 'year' (family-scoped adoption): ` +
            `year=${identity.familyYearConsensus.year} support=${identity.familyYearConsensus.support}/${identity.familyYearConsensus.uniqueRows}`
          );
        }

        // Track B Phase 0, Commit 4.1 — visualReferenceEvidence, built
        // ONLY from the merged family's own topFamily.indices (the exact
        // rows that drove the issue/year consensus above) — NEVER from
        // filterItemsByIssue's broader issue-scoped population (used much
        // later, separately, for variant extraction only). These are two
        // distinct populations with two distinct purposes: confirmed by
        // direct execution on the real Spawn #351 fixture — the merged
        // family has 5 rows, but 6 rows in the pool independently assert
        // issue #351 (one of them, "Spawn 351 NM (9.6) 2024 - Booth Cover
        // C...", was never part of either title-family cluster) — mixing
        // the sixth row into this evidence bucket would silently broaden
        // it beyond what actually produced the identity above. Extracted
        // into buildVisualReferenceEvidence (issueAuthority.js) so a test
        // can invoke this exact computation directly (invariant 10).
        //
        // Fingerprint title input — CORRECTED (review round item 1):
        // `confirmedTitle` at this point in the pipeline is the visual-
        // family CLUSTER LABEL (sanitizeSeriesTitle(family.selectedTitle),
        // identityCore.js ~line 1331), NOT the stable proposed identity.
        // Confirmed by direct execution: the real fixture produced
        // familyKey "spawn-brett-booth-cameo-of-lyra-scarce|351" —
        // cluster-derived, not stable across re-scans of the same book.
        // `effectiveTitle` is Vision's own title, passed as `vision.title`
        // into resolveIdentity a few lines above (~line 2707) — the
        // stable prior this key is supposed to capture. confirmedIssue is
        // unaffected: it comes from resolveFamilyIssueConsensus's vote,
        // not from raw cluster-label text. confirmedYear (5th argument,
        // review round item 2) is likewise the adopted/trusted value from
        // resolveFamilyYearConsensus/vision, never a raw pool value —
        // included so a same-title/same-issue, different-year product
        // (a different volume, reboot, or renumbering) never collides
        // into the same fingerprint.
        //
        // Track B Phase 0, Commit 4.2 — bound ONCE into named locals so
        // the builder call and the custody context below are guaranteed
        // to use the identical values, never re-reading effectiveTitle/
        // confirmedIssue/confirmedYear a second time (confirmedYear in
        // particular gets REASSIGNED later in this function by
        // resolveYear's own PC/CV agreement — reading it live a second
        // time at the terminal point would silently defeat the whole
        // point of capturing a phase-1 snapshot).
        const fingerprintStableTitle = effectiveTitle;
        const fingerprintStableIssue = confirmedIssue;
        const fingerprintPhaseOneYear = confirmedYear;
        const visualReferenceEvidence = buildVisualReferenceEvidence(
          familyCandidate?.topFamily?.indices,
          parsedVisualRows,
          fingerprintStableTitle,
          fingerprintStableIssue,
          fingerprintPhaseOneYear
        );
        if (visualReferenceEvidence) {
          out.visualReferenceEvidence = visualReferenceEvidence;
          visualReferenceFingerprintContext = {
            stableTitle: fingerprintStableTitle,
            stableIssue: fingerprintStableIssue,
            phaseOneYear: fingerprintPhaseOneYear,
            originalFamilyKey: visualReferenceEvidence.familyKey,
          };
          console.log(
            `[commit4.1] visualReferenceEvidence: ${visualReferenceEvidence.count} rows, ` +
            `range=$${visualReferenceEvidence.low}-$${visualReferenceEvidence.high} median=$${visualReferenceEvidence.median}, ` +
            `familyKey="${visualReferenceEvidence.familyKey}"`
          );
          // Track B Phase 0, Commit 4.3 (Rider E, 2026-07-30; extracted to
          // a testable pure function per the IMPLEMENTATION PACKET HOLD,
          // Section 4) — the NEW structured [family-evidence] event,
          // amending the Commit 4.1 instrumentation contract to also fire
          // for the retention path (identityCore.js). GATED to fire ONLY
          // for that path — a request whose decision is title-override-
          // accepted or refused-conflict-provisional already got its OWN
          // [family-evidence] line from imageSearchIdentity.js's pre-
          // existing, UNCHANGED logFamilyEvidence call, at title-decision
          // time; firing here TOO for those cases would produce two lines
          // per request, violating "exactly one... zero duplicate evidence
          // events." This is a deliberate supersession, not drift: the
          // event's real contract was always "fires wherever family rows
          // drive authority" — retention is a newly-recognized authority
          // path that never had ANY [family-evidence] coverage before
          // Commit 4.3 (imageSearchIdentity.js's own site explicitly
          // excludes fallback-vision/refused-identity-conflict). Computed
          // from HERE (not identityCore.js) specifically because issue/
          // year support numbers and the final familyKey are only known at
          // this later point in the pipeline. buildRetentionFamilyEvidenceLog
          // is the SAME real, exported function the regression test calls
          // directly — no second, independently-maintained gate/log copy.
          const retentionEvidenceLog = buildRetentionFamilyEvidenceLog(
            familyCandidate,
            identity.familyIssueConsensus,
            identity.familyYearConsensus,
            visualReferenceEvidence.familyKey,
            parsedVisualRows
          );
          if (retentionEvidenceLog.isRetentionPath) {
            console.log(retentionEvidenceLog.logLine);
          }
        }
      }

      // Track B Phase 0, Commit 4.3 (PRODUCTION AUTHORITY-CONTEXT
      // INTEGRATION HOLD, item 3, 2026-07-31) — wires the retention-branch
      // conflict containment (deriveIssueAuthorityFromAdoption's outcome/
      // authoritativeForCustody-driven branches) into the REAL
      // out.issueAuthority/out.identityProvisionalFields fields the
      // pricing/listing gates below actually read. Runs independently of
      // the mode==='conflict-locked'/mode==='adopted' chain above —
      // composes with it (out.issueConsensusConflict, the pre-existing
      // Q140 mechanism, is untouched; the mode==='adopted' branch's own
      // provisional object is untouched via the out.issueAuthority==null
      // guard) rather than replacing anything. Without this, a rule-D
      // 'conflicted' issue outcome (mode maps to 'conflict-locked', which
      // ONLY sets out.issueConsensusConflict, an informational field) or a
      // year-only conflict (issue mode 'corroborated'/other — matches
      // NEITHER existing branch above at all) left out.issueAuthority at
      // its initialized null — and the terminal pricingCustodyCheck below
      // (checkCrossPopulationPromotionGuard) only fires on a genuine
      // MISMATCH when authoritativeForCustody===true, which is never the
      // case for an unresolved conflict (authoritativeForCustody===false
      // by definition) — so NEITHER mechanism actually blocked cache/
      // pricing/listing for this exact scenario despite Controls T1/T6
      // proving the underlying function correct in isolation. Confirmed
      // via direct trace before writing this fix, not assumed.
      if (out.issueAuthority == null) {
        const retentionConflictDerived = deriveIssueAuthorityFromAdoption(identity.familyIssueConsensus, identity.familyYearConsensus);
        if (retentionConflictDerived.issueAuthority != null) {
          out.issueAuthority = retentionConflictDerived.issueAuthority;
          out.identityProvisionalFields = retentionConflictDerived.identityProvisionalFields;
          console.log(
            `[commit4.3] retention-branch authority conflict wired to out.issueAuthority: ` +
            `status=${out.issueAuthority.status} reasons=${JSON.stringify(out.issueAuthority.reasons)} ` +
            `identityProvisionalFields=${JSON.stringify(out.identityProvisionalFields)}`
          );
        }
      }

      // P0 (Q-VISION-ZERO-SUPPORT) — surface the loud override/escalate
      // note for the card UI + one-tier match-confidence demotion below.
      if (identity.visionZeroSupport) {
        out.visionZeroSupport = {
          ...identity.visionZeroSupport,
          note: identity.visionZeroSupport.mode === 'override'
            ? `Vision read issue #${identity.visionZeroSupport.visionIssue}, but the comp pool shows zero support for that number — corrected to #${identity.visionZeroSupport.adoptedIssue}. Please verify.`
            : `Vision read issue #${identity.visionZeroSupport.visionIssue}, but the comp pool shows zero support and no adoptable alternate — identity requires manual verification.`,
        };
      }

      // Q-FIX-B — same surfacing for the new publisher zero-support check.
      if (identity.visionPublisherZeroSupport) {
        out.visionPublisherZeroSupport = {
          ...identity.visionPublisherZeroSupport,
          note: identity.visionPublisherZeroSupport.mode === 'override'
            ? `Vision read publisher "${identity.visionPublisherZeroSupport.visionPublisher}", but the comp pool shows zero support for that publisher — corrected to "${identity.visionPublisherZeroSupport.adoptedPublisher}". Please verify.`
            : `Vision read publisher "${identity.visionPublisherZeroSupport.visionPublisher}", but the comp pool shows zero support and no adoptable alternate — publisher requires verification.`,
        };
      }
      out.matchConfidenceDemote = identity.matchConfidenceDemote === true;

      // Ship #22e: Assembly integrity check (Q54 compounds survive final title)
      // E3 class protection: "The X-Men #44 Angel" → Q54 protects ["x", "men"]
      // → assembly drops "x" → integrity check FAILS → force Vision title.
      // B1 (22e-LOSS): Phase 1 check (missing Vision tokens only; comp-consensus
      // check runs post-fetch in Phase 2).
      // Q-TITLE-ZERO-SUPPORT — pass the eBay visual pool's raw titles instead
      // of []. Same pool already feeding agreement.visionIssueCount (Vision
      // zero-support fix) — gives checkAssemblyIntegrity's zero-support
      // carve-out real, EARLY data instead of being permanently inert here.
      console.log(`[22e] checking integrity: vision="${effectiveTitle}" assembled="${confirmedTitle}"`);
      // Q131 follow-up — see shouldSkipAssemblyIntegrityCheck docstring
      // (identityCore.js) for why refused-identity-conflict is exempt.
      if (shouldSkipAssemblyIntegrityCheck(familyCandidate?.decision)) {
        console.log(`[22e] SKIPPED — refused-identity-conflict provisional identity is intentionally divergent from Vision, not an assembly bug`);
      } else {
        // Q142 dispatch (2026-07-22, Adventure Time Summer Special / SDCC
        // class) — Rule 2 ("excess non-consensus tokens," 22e-LOSS below)
        // measures whether an added token clears 60% consensus against
        // compTitles. Before this fix, compTitles was ALWAYS the full,
        // possibly-ambiguous visual pool (parsedVisualRows) — the exact
        // same "measuring coherence against the wrong population" bug Q140
        // fixed at the Q84 gate, reproduced independently at this second,
        // unrelated choke point downstream of it. A real, ≥3-member family
        // that Q84 already vetted and let win (summer/special at 5/5=100%
        // within the family) reads as ~26% "non-consensus" against the
        // full 19-item pool, which necessarily contains OTHER, different
        // "Adventure Time" products by construction — forcing a revert of
        // a correct override back to bare Vision. When the family that won
        // is a real, accepted override, its OWN members are the correct
        // population to check consensus against, not the pool it was
        // extracted from. Falls back to the full pool for every other
        // path (fallback-vision, refused-identity-conflict already exempt
        // above, no familyCandidate at all) — byte-identical there.
        //
        // Q142 instance 2 fix — assigns the OUTER-scoped winningFamilyTitles
        // (declared near identityRefused above) rather than a block-local
        // const, so Phase 2's integrity check (~line 4757) can reuse this
        // exact same population instead of computing its own, independently
        // driftable copy.
        winningFamilyTitles =
          familyCandidate?.topFamily?.indices && FAMILY_OVERRIDE_DECISIONS.includes(familyCandidate?.decision)
            ? familyCandidate.topFamily.indices.map((i) => parsedVisualRows[i]?.rawTitle).filter(Boolean)
            : null;
        const integrityCompTitles = winningFamilyTitles && winningFamilyTitles.length > 0
          ? winningFamilyTitles
          : parsedVisualRows.map((r) => r.rawTitle).filter(Boolean);
        console.log(
          `[22e-population] mode=${winningFamilyTitles && winningFamilyTitles.length > 0 ? 'winning-family' : 'full-pool'} ` +
          `count=${integrityCompTitles.length}` +
          (winningFamilyTitles && winningFamilyTitles.length > 0 ? ` (family="${familyCandidate.topFamily.title}")` : '')
        );
        const integrityCheck = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, integrityCompTitles);
        if (integrityCheck.shouldFallback) {
          console.log(
            `[22e] FORCED vision="${effectiveTitle}" rejected="${confirmedTitle}" ` +
            `reason=${integrityCheck.reason} missing=[${integrityCheck.missing.join(',')}]`
          );
          // GrailKey Dispatch 03 (2026-08-06) — routed through writeConfirmed
          // for V1 instrumentation visibility (log-only, per identityWriteLog.js's
          // own contract — does not change what gets written). titleSource
          // isn't declared yet at this point in the handler (first assignment
          // is later, ~line 3933), so fromSource is honestly 'unknown' rather
          // than referencing an out-of-scope variable.
          confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, effectiveTitle, 'unknown', 'vision', '22e-force');
          out.assemblyIntegrityFailed = true;
          out.assemblyIntegrityMissing = integrityCheck.missing;
          out.assemblyIntegrityReason = integrityCheck.reason;
        }
      }
    }

    // Q106 FIX-1 — non-CGC paths never set confirmedLabelType above; default
    // it to Vision's raw labelType so the fetchComps call site (Phase 2) has
    // a consistent value to pass regardless of which identity path fired.
    if (confirmedLabelType === undefined) confirmedLabelType = labelType || null;

    // Q-FLASHGORDON13 — publisher founding-year plausibility gate. Nothing
    // upstream validates confirmedPublisher against confirmedYear at all
    // (title/issue get cv-year-strict-style checks; publisher never did).
    // Real production case: Vision read publisher="Image" on a book
    // correctly identified as 1969 — Image Comics didn't exist until 1992.
    // Fallback order: (1) pool consensus from the eBay visual pool via the
    // same backfillPublisherFromTitles Q94 already uses when publisher is
    // outright missing (Charlton Comics is already in its pattern table —
    // Q96 added it for this exact Flash Gordon #13 class); (2) ComicVine's
    // publisher, tried in STAGE B below once the CV lookup below resolves
    // (not available yet at this point in the pipeline); (3) null.
    // Runs BEFORE the ComicVine/PriceCharting lookups below so a corrected
    // publisher also improves the ComicVine query itself, not just the
    // final display value.
    if (!isPublisherYearPlausible(confirmedPublisher, confirmedYear)) {
      const rejectedPublisher = confirmedPublisher;
      const poolTitles = parsedVisualRows.map((r) => r.rawTitle).filter(Boolean);
      const poolBackfill = backfillPublisherFromTitles(poolTitles);
      if (poolBackfill) {
        confirmedPublisher = poolBackfill.publisher;
        out.publisherImplausibleRejected = {
          rejected: rejectedPublisher,
          adopted: confirmedPublisher,
          source: 'pool_consensus',
          ratio: poolBackfill.ratio,
        };
        console.log(`[pub-plausibility] REJECT "${rejectedPublisher}" (postdates year=${confirmedYear}) — pool consensus adopts "${confirmedPublisher}" (${poolBackfill.hitCount}/${poolBackfill.total})`);
      } else {
        confirmedPublisher = null;
        out.publisherImplausibleRejected = {
          rejected: rejectedPublisher,
          adopted: null,
          source: null,
        };
        console.log(`[pub-plausibility] REJECT "${rejectedPublisher}" (postdates year=${confirmedYear}) — no pool consensus, deferring to ComicVine fallback`);
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

    // Q104 FIX-3 — preserve the crossover co-title as a required token.
    // Runs AFTER title contamination/sanitization so a re-check catches the
    // case where those passes stripped it back out. Feeds confirmedTitle
    // forward into the initial PC lookup, any PC requery, and the comp
    // query (fetchComps) — all three consume confirmedTitle downstream, so
    // fixing it once here means the pc-requery suppression gate (below,
    // gated on visualConsensus/familyCandidate acceptance) never gets a
    // chance to drop a co-title that came from the visual pool's top-3,
    // because the token is already baked into confirmedTitle before that
    // gate runs.
    if (coTitleToken && confirmedTitle && !confirmedTitle.toLowerCase().includes(coTitleToken.toLowerCase())) {
      console.log(`[co-title] preserving "${coTitleToken}" (source=${coTitleSource}) — appending to confirmedTitle "${confirmedTitle}"`);
      // GrailKey Dispatch 03 (2026-08-06) — routed through writeConfirmed
      // for V1 instrumentation visibility (log-only, does not change what
      // gets written — see identityWriteLog.js's own contract). Behavior
      // (the blind append itself) is unchanged this commit; Strip 3b
      // (confirmedVariant destination + crossover-fixture verification) is
      // the actual behavior fix, deferred per explicit instruction.
      confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, `${confirmedTitle} ${coTitleToken}`, 'unknown', 'co-title-preserved', 'co-title-append');
      out.coTitlePreserved = coTitleToken;
      out.coTitleSource = coTitleSource;
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

        // GrailKey Dispatch 19 (2026-08-07) — Fix 5, unblocked and
        // implemented. Q110 already made assetTypeConfident advisory-only
        // (listingHardLocked, never a hard price block) — this extends
        // the SAME Q32 category-vote machinery above to ALSO tally
        // comic-category votes, and when Vision itself flagged
        // !assetTypeConfident but the pool independently shows strong,
        // coherent comic-category agreement, lifts the advisory lock
        // before it fires. Strictly additive to the merchandise
        // hard-block above — this only runs inside the merchandiseRatio
        // < 0.5 branch already reached, never able to override that block.
        //
        // Blocked since GrailKey Dispatch 15 on a real captured Vision
        // JSON to determine whether a "not a comic" misread returns
        // issue=null (display/lock-only fix) or a stale wrong value
        // (would also need to feed a corrected issue back into
        // resolveIdentity) — resolved via a real production scan (Spawn
        // #351, 2026-08-07 20:40:36 UTC): Vision returned #null, confirmed
        // null-not-stale. Display/lock-only, as designed — this block
        // never writes confirmedIssue/confirmedTitle, only the advisory
        // lock flag consumed at the listingHardLocked gate below.
        //
        // Coherence gate: requires visualConsensus !== null —
        // extractConsensus's own overall verdict on this exact pool
        // (computed once at phase1, already in scope) — rather than
        // isolating just its internal titleOk sub-check. Deliberately the
        // MORE conservative of the two options (titleOk alone is a lower
        // bar than "extractConsensus produced ANY real consensus,
        // title AND issue"), per the standing "conservative when
        // uncertain" rule, and avoids refactoring extractConsensus's
        // internal closures (stripVariantNoise/extractMainTitle/
        // getMostCommon) out to module scope just to isolate one
        // sub-check — a real option, not taken, to keep this fix's
        // surface area contained.
        //
        // Disclosed limitation, not hidden: the real Spawn #351 scan that
        // unblocked this fix had visualConsensus === null itself (title
        // consensus was fine, but the ISSUE axis never reached its own
        // separate 50% bar — a different, narrower problem; see the
        // commit-p/HIGH_CONFIDENCE_WEIGHT_FLOOR near-miss investigated
        // separately this same dispatch). This fix would NOT have lifted
        // that exact scan's own advisory lock. It targets the more common
        // shape where the pool agrees on both title AND issue but
        // Vision's own assetTypeConfident read was wrong (a poster/print
        // visually confused for a genuine listing pool that DOES
        // converge) — a real, different case from Spawn #351's own.
        //
        // Thresholds (>=5 comic-category listings, >=60% ratio) are the
        // Dispatch 15 design's own candidates; validated against the one
        // real pool available (Spawn #351: 0/20 merchandise, ~20/20
        // comic-category — clears trivially, confirming the bar isn't
        // miscalibrated against real eBay category data, though this
        // pool doesn't exercise the boundary itself).
        if (!out.assetTypeConfident) {
          const comicVotes = categoryVotes.length - merchandiseVotes;
          const comicRatio = categoryVotes.length > 0 ? comicVotes / categoryVotes.length : 0;
          if (shouldLiftAssetTypeAdvisoryLock(merchandiseRatio, comicVotes, categoryVotes.length, visualConsensus !== null)) {
            out.assetTypeConfidentOverride = true;
            console.log(
              `[Q32-asset-type-override] lifting advisory lock: comic-category vote ${comicVotes}/${categoryVotes.length} ` +
              `(ratio=${(comicRatio*100).toFixed(0)}%), pool title/issue coherent (extractConsensus non-null) — ` +
              `Vision's assetTypeConfident=false treated as overridden for the listing-lock gate only`
            );
          } else {
            console.log(
              `[Q32-asset-type-override] declined: comicVotes=${comicVotes}/${categoryVotes.length} ` +
              `(ratio=${(comicRatio*100).toFixed(0)}%) coherent=${visualConsensus !== null} — advisory lock stays`
            );
          }
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

    // Q131 systemic-audit follow-up (2026-07-19, Eternus #2 class) — the
    // bare `year` (destructured from req.body at the top of the handler,
    // line ~1961) is Vision's raw, pre-resolution guess. Every site below
    // that uses it for a PC cache key or lookup was bypassing
    // confirmedYear entirely — the exact "PC cache-key still shows
    // year=2019 eighty milliseconds after the field was correctly nulled"
    // gap. Scoped narrowly (not a blanket year→confirmedYear swap): only
    // substitutes confirmedYear when identitySource is the provisional-
    // override outcome specifically. For every other request — including
    // the GENERAL (non-provisional) refused-identity-conflict sub-case,
    // where Vision's title legitimately stands and confirmedYear already
    // equals vision.year by resolveIdentity's own initial-declaration
    // fallthrough — this is byte-identical to the pre-existing behavior
    // (pcQueryYear === year). Zero blast radius on normal identification.
    const pcQueryYear = identityIsProvisionalOverride ? confirmedYear : year;

    // Session 6/20/26 — Cache lookups (5-min TTL, same as Anthropic prompt cache)
    // Crow fix — PC cache key MUST include year (year validation makes year-dependent results)
    // Track B Phase 0, Commit 4.3 — cvKey's own template inlined directly
    // into buildComicVineCacheKey's call site below (no longer a separate
    // local — was unused after that extraction).
    // GrailKey Dispatch 03 prerequisite (2026-08-06) — variant segment
    // added, same reasoning as buildPriceChartingCacheKey/
    // buildComicVineCacheKey (cacheKeys.js): confirmedVariant isn't
    // resolved yet at this point in the handler (see Q108 CHANGE 2 note
    // below), req.body.variant is the same established proxy.
    const pcKey = `${subtitleStripped}|${confirmedIssue}|${pcQueryYear || ''}|${req.body.variant || ''}`;
    const now = Date.now();

    // Track B Phase 0, Commit 4.3.1 (Section B) — RETENTION-DECLINE
    // FAIL-CLOSED CONTAINMENT, market-custody half. The ac: exact-issue
    // active-comp cache is already gated on out.issueAuthority.status via
    // canUseExactIssuePricingCache (Commit 4) — 'conflicted' was never in
    // its CACHE_SAFE allowlist, so that namespace was already fail-closed
    // before this commit. The cv:/pc:v1 lookups just below had NO
    // equivalent gate at all (disclosed, not previously fixed, in the
    // Commit 4.3 test's own "DISCLOSED STRUCTURAL ASYMMETRY" note) — they
    // ran unconditionally regardless of whether the resolved identity was
    // provisional/conflicted. Narrowest safe fix: skip both lookups
    // entirely (no cache read, no cache write, no live query, so no
    // result can corroborate identity/pricing/convergence) whenever
    // out.issueAuthority.status is 'conflicted' at this point in the
    // pipeline — which is already true here, since the retention-branch
    // wiring above (~line 2937) runs before this Promise.all. Preserving
    // Vision's own issue while still querying/caching under that same
    // issue number would only relocate the pollution risk from the
    // family's disputed value to Vision's unconfirmed one — not close it.
    //
    // GrailKey Commit B2 (2026-08-02, Spawn #351 virgin-variant dispatch)
    // — confirmed via a real production trace (22:53:21 UTC, build af32d21)
    // that this check alone is insufficient: a `mode==='conflict-locked'`
    // outcome (the q140 issue-consensus-conflict path, distinct from
    // `mode==='adopted'`) never calls deriveIssueAuthorityFromAdoption at
    // all, so out.issueAuthority stays null/undefined and
    // marketCustodyConflicted evaluates false — yet confirmedIssue is
    // ALSO null in this exact shape (Vision's own issue was rejected,
    // no adoptable alternate exists), which is precisely the case the
    // ac: namespace's own canUseExactIssuePricingCache already guards
    // against (`if (confirmedIssue == null) return false;`, Commit B.1).
    // Confirmed live: `[active-cache] SKIP: confirmedIssue is null...
    // (Commit B.1)` correctly fired for ac: on this exact request, while
    // cv: had no equivalent check and wrote `cv:spawn brett booth|null|Image`
    // unconditionally. Reusing canUseExactIssuePricingCache here (rather
    // than a second, independently-tuned null check) closes the gap with
    // the same function ac: already trusts, extended to a second
    // namespace — not a new subsystem.
    const marketCustodyConflicted = !canUseExactIssuePricingCache(confirmedIssue, out.issueAuthority, out.identityProvisionalFields);

    // Q106 FIX-1 — cgcResult already fetched in Phase 1 (races the visual
    // pool); no longer re-fetched here.
    const [comicVine, priceChartingInitial] = await Promise.all([
      // FIX 3 — ComicVine KV cache (persistent across cold starts)
      (async () => {
        if (marketCustodyConflicted) {
          console.log(
            confirmedIssue == null
              ? `[commit-b2] exact-identity cv: lookup SKIPPED — confirmedIssue is null (no title|null key in the cv: namespace)`
              : `[commit4.3.1] exact-identity cv: lookup SKIPPED — issueAuthority.status="${out.issueAuthority?.status}" ` +
                `(reasons=${JSON.stringify(out.issueAuthority?.reasons || [])}) — no cache read/write, no live query`
          );
          return null;
        }
        // Track B Phase 0, Commit 4.3 — real call site for the extracted,
        // exported buildComicVineCacheKey (invariant 10).
        // GrailKey Dispatch 03 prerequisite (2026-08-06) — variant segment
        // + CV_FILTER_VERSION added (see cacheKeys.js). req.body.variant is
        // the same pre-resolution proxy used at the PC call site below.
        const kvKey = buildComicVineCacheKey(cleanedCVTitle, confirmedIssue, confirmedPublisher, req.body.variant, CV_FILTER_VERSION);
        const cached = await kvGet(kvKey);
        if (cached) return cached;
        // Track B Phase 0, Commit 4.3 (Section 3) — real call site for the
        // extracted, exported buildComicVineQueryParams.
        const result = await lookupComicVine(buildComicVineQueryParams(cleanedCVTitle, confirmedIssue, confirmedYear, confirmedPublisher, poolYearHint)).catch(() => null);
        await kvSet(kvKey, result, KV_TTL.CV);
        return result;
      })(),
      // FIX 3 — PriceCharting KV cache (persistent across cold starts)
      // Crow: Dead Time fix — try full title FIRST, fallback to stripped only if zero results
      (async () => {
        if (marketCustodyConflicted) {
          console.log(
            confirmedIssue == null
              ? `[commit-b2] exact-identity pc: lookup SKIPPED — confirmedIssue is null (no title|null key in the pc:v1 namespace)`
              : `[commit4.3.1] exact-identity pc: lookup SKIPPED — issueAuthority.status="${out.issueAuthority?.status}" ` +
                `(reasons=${JSON.stringify(out.issueAuthority?.reasons || [])}) — no cache read/write, no live query`
          );
          return null;
        }
        // Q108-B — version-salted the same way the active-comps cache
        // already is (COMP_FILTER_VERSION): a lookupPriceCharting logic
        // change must invalidate old cached entries, not have them served
        // untouched for up to 24h (Wonder Woman #75 class).
        // Track B Phase 0, Commit 4.3 — real call site for the extracted,
        // exported buildPriceChartingCacheKey (invariant 10).
        const fullTitleKey = buildPriceChartingCacheKey(PC_FILTER_VERSION, confirmedTitle, confirmedIssue, pcQueryYear, req.body.variant);
        const strippedTitleKey = `pc:v${PC_FILTER_VERSION}:${pcKey}`;

        // Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD — FINAL
        // NARROW HOLD, item 3) — real call site for the extracted, exported
        // readPriceChartingCache. Preserves the exact prior "full title
        // first, stripped-title fallback skipped when identical to
        // fullTitleKey" behavior byte-for-byte — a second kvGet() for a key
        // just proven to MISS is pure redundant latency, confirmed live via
        // production logs showing the identical `[kv-cache] MISS: pc:v1:...`
        // line twice in a row for the same key.
        const cacheRead = await readPriceChartingCache(fullTitleKey, strippedTitleKey, kvGet);
        if (cacheRead.hit) {
          console.log(`[pc-query] cache hit for ${cacheRead.hit} title${cacheRead.hit === 'stripped' ? ' (fallback)' : ''}`);
          return cacheRead.result;
        }

        // No cache hit — try live query with full title first
        console.log(`[pc-query] trying full title: "${confirmedTitle}"`);
        // Q86: pre-resolution year confidence — proven only when the eBay
        // pool year ratio corroborates; a lone Vision year is a guess.
        const q86PreYearConfidence = ebayYearAuthoritative ? 'proven' : 'unproven';
        // Q108 CHANGE 2 — confirmedVariant isn't resolved yet at this point
        // in the handler (that runs later, ~line 3090); req.body.variant is
        // the same value it would default to absent an eBay-consensus
        // override, so it's the correct proxy signal here.
        // Track B Phase 0, Commit 4.3 (Section 3) — real call site for the
        // extracted, exported buildPriceChartingQueryParams.
        let result = await lookupPriceCharting(buildPriceChartingQueryParams(confirmedTitle, confirmedIssue, pcQueryYear, q86PreYearConfidence, eraAdvisory, req.body.variant, out, req.body.pcProductId)).catch(() => null);

        if (result) {
          console.log(`[pc-query] full title matched: "${result.productName}"`);
          // GrailKey Commit T (T3, 2026-08-03) — do not write a PC product
          // to a durable cache key when the product name fails the T2
          // overlap check against the key's own title. Same containment
          // discipline Commits B.1/B.2 already apply to the ac:/cv:
          // exact-pricing namespaces (skip the write rather than let a
          // mismatched result poison a key future, differently-identified
          // requests will read back as a HIT). Root case this closes:
          // pc:v1:marvel tales|14|1968 held id=8878655 "Tales of Asgard
          // #14" — correct key, wrong product, written under an earlier
          // request whose confirmedTitle was itself wrong at the time,
          // then served back unconditionally (KV_TTL.PC = 86400s = 24h)
          // to every later request for the same key, including one whose
          // identity had since been correctly resolved. Gated on the SAME
          // titleOverlapsProduct this file's own requery gate already
          // uses — no second, independently-tuned comparison.
          if (titleOverlapsProduct(confirmedTitle, result.productName)) {
            await kvSet(fullTitleKey, result, KV_TTL.PC);
          } else {
            console.log(
              `[pc-cache-guard] durable write SKIPPED — "${result.productName}" fails title-overlap ` +
              `against "${confirmedTitle}" (would poison ${fullTitleKey} for future requests)`
            );
          }
          return result;
        }

        // Full title returned zero results — fallback to subtitle-stripped
        if (hasSubtitle && subtitleStripped !== confirmedTitle) {
          console.log(`[pc-query] full title zero results — fallback to stripped: "${subtitleStripped}"`);
          // Track B Phase 0, Commit 4.3 (Section 3 follow-up) — same
          // buildPriceChartingQueryParams builder as the full-title call
          // above, for the stripped-title fallback query.
          result = await lookupPriceCharting(buildPriceChartingQueryParams(subtitleStripped, confirmedIssue, pcQueryYear, q86PreYearConfidence, eraAdvisory, req.body.variant, out, req.body.pcProductId)).catch(() => null);
          if (result) {
            console.log(`[pc-query] stripped title matched: "${result.productName}"`);
            // GrailKey Commit T (T3) — same guard as the full-title write above.
            if (titleOverlapsProduct(subtitleStripped, result.productName)) {
              await kvSet(strippedTitleKey, result, KV_TTL.PC);
            } else {
              console.log(
                `[pc-cache-guard] durable write SKIPPED — "${result.productName}" fails title-overlap ` +
                `against "${subtitleStripped}" (would poison ${strippedTitleKey} for future requests)`
              );
            }
          }
        }

        return result;
      })(),
    ]);

    // Q-FLASHGORDON13 STAGE B — the founding-year gate above rejected
    // Vision's publisher and pool consensus couldn't resolve it either
    // (confirmedPublisher is still null, flagged via
    // publisherImplausibleRejected.adopted === null). ComicVine's lookup
    // has now resolved, so try its publisher as the second fallback step.
    // "Independently passed its own gates" in practice: comicVine is
    // non-null here (its own identity match wasn't discarded) and has a
    // real, non-empty publisher name — nothing further to validate beyond
    // that, per scope.
    if (
      confirmedPublisher == null &&
      out.publisherImplausibleRejected &&
      out.publisherImplausibleRejected.adopted === null
    ) {
      const cvPublisher = comicVine?.volume?.publisher?.name || null;
      if (cvPublisher) {
        confirmedPublisher = cvPublisher;
        out.publisherImplausibleRejected.adopted = cvPublisher;
        out.publisherImplausibleRejected.source = 'comicvine';
        console.log(`[pub-plausibility] ComicVine fallback adopts "${cvPublisher}"`);
      } else {
        console.log(`[pub-plausibility] no ComicVine publisher available either — confirmedPublisher stays null`);
      }
    }

    const ximilar = null; // Ximilar lookup disabled

    mark('phase2_complete');

    // Ship #22c: AXIS VOTING convergence score
    // Computes identity confidence from multi-source voting per axis.
    // Sources: eBay (visualConsensus), Vision (original), PC (priceCharting), CV (comicVine)
    // Era histogram extracted from visual year distribution (eraLock.decade)
    const { computeConvergenceScore, applyIdentityConflictDemotion } = await import('../src/lib/convergenceScore.js');

    // Build sources object from Phase 1+2 data (PC/CV now available)
    const convergenceSources = {
      title: {
        ebay: visualConsensus?.title || null,
        vision: effectiveTitle,
        // Q117 dispatch (2026-07-18, Batman #608 "Hush" / #215 "Call Me
        // Master" / Absolute Batman #1 class) — was comicVine?.name, the
        // ComicVine ISSUE record's own `name` field, which per ComicVine's
        // schema is the story/chapter title ("Hush Chapter One: The
        // Ransom", "Los Apuros del Titere Flash", "Le Zoo" — confirmed via
        // real production logs across three unrelated books, all with
        // 100/100 volume-name match scores at the ComicVine lookup stage
        // moments earlier), NOT the series name. Comparing our confirmed
        // series title against that field guaranteed a false rejection on
        // any issue whose CV record has a populated story-arc name — common
        // specifically on notable, valuable keys (the ones worth naming an
        // arc for), which is exactly the class this axis should be most
        // reliable on. comicVine.volume.name is the correct series-name
        // field — already used correctly elsewhere in this file (era-gate
        // logging, ~line 2899; UPC-lookup title resolution, ~line 536).
        cv: comicVine?.volume?.name || null,
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

    const rawConvergence = computeConvergenceScore(convergenceIdentity, convergenceSources);
    // Q131 — see applyIdentityConflictDemotion docstring (convergenceScore.js).
    const convergence = applyIdentityConflictDemotion(rawConvergence, familyCandidate?.decision);
    if (convergence.identityConflictDemoted) {
      console.log(
        `[22c] DEMOTED ${convergence.preDemotionTier}(${convergence.preDemotionScore}) → LOW — ` +
        `title-family clustering refused this identity (${familyCandidate.reason})`
      );
    }
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

    // FIX-3: convergence rejection gates DISPLAY fields, not only pricing
    // inputs. GSX card rendered the Giant-Size ASTONISHING X-Men (2008)
    // story blurb while [22c] had rejected cv="Gone" — the verdict never
    // reached out.comicVine. Verdict computed here; the actual out.comicVine
    // assignment (~line 3290) consults it. Identity axes only (title/issue/
    // publisher — era excluded, cover-date drift is normal).
    const CV_IDENTITY_AXES = ['title', 'issue', 'publisher'];
    const cvConvergenceRejectedAxes = CV_IDENTITY_AXES.filter((axis) =>
      (convergence.axes[axis]?.rejections || []).some((r) => r.source === 'cv')
    );

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

    // Q88(b): ADVISORY era (below quorum) never rejects. When the surviving
    // PC match conflicts with the advisory era, the match STANDS; if it only
    // survived via Q86 year-mismatch tolerance (yearConfidence=unproven),
    // surface NEEDS_REVIEW + era-conflict instead of starving the book.
    // Mixed-era pools (1942 vs 1971 same-name books) become review, not refusal.
    if (eraAdvisory && priceCharting?.year) {
      const pcYearAdv = parseInt(priceCharting.year);
      if (Number.isFinite(pcYearAdv) && (pcYearAdv < eraAdvisory.minYear || pcYearAdv > eraAdvisory.maxYear)) {
        console.log(
          `[22a] era-advisory conflict: PC "${priceCharting.productName}" (${pcYearAdv}) ` +
          `vs advisory ${eraAdvisory.decade}s — match STANDS`
        );
        out.eraConflict = {
          source: 'PriceCharting',
          productYear: pcYearAdv,
          advisoryDecade: eraAdvisory.decade,
          advisoryYearBearing: eraAdvisory.yearBearing,
          yearMismatchTolerated: !!priceCharting.yearMismatchTolerated,
        };
        if (priceCharting.yearMismatchTolerated) {
          out.needsReview = true;
        }
      }
    }

    // Publisher fallback from ComicVine when eBay/Vision didn't provide it.
    // Q131 systemic-audit follow-up — the bare `|| publisher` leg is the
    // SAME raw req.body value resolveIdentity already rejected for the
    // provisional-override case (identical object reference: `publisher`
    // is what got passed into resolveIdentity as vision.publisher). Since
    // confirmedPublisher is null only in that specific outcome (Vision's
    // own publisher survives untouched in the general refused-conflict
    // sub-case via resolveIdentity's initial-declaration fallthrough —
    // unaffected here), scope the exemption the same narrow way as the
    // PC-year fix above: skip the raw fallback only for the provisional
    // outcome, unchanged for every other case.
    confirmedPublisher = confirmedPublisher || comicVine?.volume?.publisher?.name ||
      (identityIsProvisionalOverride ? null : publisher);

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

    // GrailKey Commit V1 — per-field provenance trackers. identitySource
    // (above) reflects only the INITIAL resolution (barcode/manual/cgc/
    // resolveIdentity) and, confirmed during V1's investigation, is
    // reassigned exactly once more after this point (line ~6956, the Q83
    // rescue block) — every other post-anchor write to confirmedTitle/
    // Year/Publisher would otherwise leave identitySource stale relative
    // to what actually produced the current value. These five trackers
    // seed from the best already-known value at this point and are
    // updated by every writeConfirmed() call below, so each write's
    // logged "from" source is the true incumbent provenance, not a stale
    // global. confirmedVariant reuses the EXISTING variantIdentitySource
    // (declared later, ~line 4821) rather than a duplicate — threaded in
    // at that declaration site instead of here.
    let titleSource = identitySource;
    let issueSource = identitySource;
    let yearSource = out?.confirmedYearMeta?.source || 'unknown';
    let publisherSource = identitySource;

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

      // Q88-P3: min-length guard — the <60% floor can strip a compound title
      // down to a junk token ("Funny Book …" → "Book"). A stripped result
      // this short carries no identity; keep the original consensus title.
      if (strippedTitle && strippedTitle !== consensusTitle && strippedTitle.length < 5) {
        console.log(`[C4-arc-strip] guard: "${strippedTitle}" too short (<5 chars) — keeping "${consensusTitle}"`);
        return consensusTitle;
      }

      if (strippedTitle !== consensusTitle) {
        console.log(`[C4-arc-strip] "${consensusTitle}" → "${strippedTitle}" (removed <60% words)`);
      }

      return strippedTitle || consensusTitle;
    };

    const visionConfidenceLower = normalizeVisionConfidence(confidence);

    // Ship 26.0 / 26.2 — imageConsensusTitle retained for logging/diagnostics
    // and as a requery-title fallback only. It no longer GATES whether PC's
    // match gets validated (see Q-PC-REQUERY-GATE below) — "the image pool
    // has no consensus opinion" and "PC's match is still right for our
    // CURRENT identity" are not the same claim, and conflating them let a
    // wrong PC match survive whenever the pool consensus was rejected/thin.
    const familyCandidateAccepted = familyCandidate && ['top-rank-protection', 'weighted-consensus'].includes(familyCandidate.decision);
    const imageConsensusTitle = (visualConsensus || familyCandidateAccepted)
      ? (familyCandidate?.selectedTitle || visualConsensus?.title || getImageSearchConsensusTitle(visualResult))
      : null;

    // Q-PC-REQUERY-GATE — validate PC's initial match against confirmedTitle
    // UNCONDITIONALLY, regardless of whether the image pool had its own
    // consensus opinion. Previously this check (and the main-token
    // heuristic it fed) only ran when imageConsensusTitle was truthy and
    // differed from pcInitialTitle — when pool consensus was rejected or
    // absent, NO check ran at all, silently keeping priceChartingInitial's
    // match no matter what, even if confirmedTitle had already been
    // corrected (22e, backfill, or otherwise) to something that match no
    // longer represents (Spider-Versity class: confirmedTitle corrected to
    // "Amazing Spider Versity", PC's initial match was "Spider-Verse ...
    // Camuncoli Variant" — a different, real product — kept as-is because
    // the pool consensus that originally produced the wrong title had
    // already been rejected by 22e, so the old gate never even looked).
    //
    // titleOverlapsProduct (identityCore.js) replaces the old "shares one
    // token" heuristic (which always passed for same-franchise titles
    // sharing a lead word, e.g. "spider") with a majority-token-overlap
    // check between confirmedTitle and PC's productName.
    const needsRequery = !priceCharting || !titleOverlapsProduct(confirmedTitle, priceCharting.productName);

    // Track B Phase 0, Commit 4.3.1 HOLD (Item 3) — the initial pc: lookup
    // above is skipped entirely while issueAuthority is conflicted
    // (marketCustodyConflicted, ~line 3313), which leaves `priceCharting`
    // null here — `needsRequery`'s own `!priceCharting` clause would
    // therefore ALWAYS evaluate true and fire this requery unconditionally
    // for every conflicted request, silently reopening the exact exact-
    // identity PC read this dispatch's Section B closes at the initial
    // lookup. Composed with needsRequery (not replacing it) so the
    // pre-existing title-overlap requery behavior is byte-identical for
    // every non-conflicted request.
    if (needsRequery && !marketCustodyConflicted) {
      mark('pc_requery_start');
      const gateSource = familyCandidateAccepted
        ? `family-candidate ${familyCandidate.decision}`
        : (imageConsensusTitle ? 'visualConsensus' : 'confirmedTitle-vs-pc-match');
      // Ship Pattern-J — Use sanitized confirmedTitle for pc-requery instead of
      // raw imageConsensusTitle to prevent seller inventory codes (mm22, A2, etc.)
      // from contaminating PriceCharting queries. confirmedTitle has already been
      // sanitized via detectTitleContamination + sanitizeTitle at line ~1980.
      const pcRequeryTitle = confirmedTitle || imageConsensusTitle || title;
      console.log(
        `[pc-requery] confirmedTitle "${pcRequeryTitle}" vs initial PC match ` +
        `${priceCharting ? `"${priceCharting.productName}"` : '(none)'} — insufficient overlap, ` +
        `re-querying PC (gated: ${gateSource})`
      );
      priceCharting = await lookupPriceCharting({
        title: pcRequeryTitle,
        issue: confirmedIssue,
        year,
        // Q86: requery runs pre-resolveYear — same preliminary confidence
        yearConfidence: ebayYearAuthoritative ? 'proven' : 'unproven',
        eraHint: eraAdvisory,
        // Q108 CHANGE 2 — confirmedVariant not yet resolved here either;
        // req.body.variant is the correct proxy (see note at initial PC lookup).
        variant: req.body.variant || null,
        pcDiag: out,
      }).catch(() => null);
      mark('pc_requery_complete');
      if (priceCharting) {
        console.log(`[pc-requery] matched: "${priceCharting.productName}"`);
      }
    } else if (marketCustodyConflicted) {
      console.log(
        confirmedIssue == null
          ? `[commit-b2] exact-identity pc: requery SKIPPED — confirmedIssue is null, no fallback lookup attempted`
          : `[commit4.3.1] exact-identity pc: requery SKIPPED — issueAuthority.status="${out.issueAuthority?.status}", no fallback lookup attempted`
      );
    } else {
      console.log(`[pc-query] initial PC match "${priceCharting.productName}" already overlaps confirmedTitle "${confirmedTitle}" sufficiently — keeping initial result`);
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
          // Q141: a family candidate's rawTitle is a verbatim eBay listing
          // title and can carry a grading-service fragment (e.g. "CGC 0.5")
          // baked in from whichever pool member won the family vote — that
          // fragment then rides into the comps search query text itself,
          // biasing results toward slabbed listings for a raw-copy scan
          // (Batman #15 production case: query text contained "CGC 0.5",
          // collapsed every formal attempt to 0 post-filter survivors).
          // Never search on the raw listing title — construct from
          // confirmed identity fields only, same convention as the
          // rawTitle-issue-mismatch fallback above.
          const sanitizedTitleBase = String(
            (typeof confirmedTitle !== 'undefined' && confirmedTitle) ||
            (typeof title !== 'undefined' && title) ||
            (out && out.confirmedTitle) ||
            ''
          ).trim();
          const sanitizedIssue = String(
            (typeof confirmedIssue !== 'undefined' && confirmedIssue) ||
            (typeof issue !== 'undefined' && issue) ||
            (out && out.issue) ||
            ''
          ).trim();
          const sanitizedYear = String(
            (typeof confirmedYear !== 'undefined' && confirmedYear) ||
            (out && out.confirmedYear) ||
            ''
          ).trim();

          imageSearchTitle = buildSanitizedComicSearchTitle(sanitizedTitleBase, sanitizedIssue, sanitizedYear);
          if (imageSearchTitle) {
            console.log(`[ship12] title-family override — sanitized query (title+issue+year, no raw listing text): ${imageSearchTitle}`);
          } else {
            console.log('[ship12] title-family override — no confirmed title available, skipping rawTitle');
          }
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
      const visionConfidence = normalizeVisionConfidence(confidence);
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

    // Q106 FIX-1 — visual pool must not seed the comp-query "image-search"
    // attempt when CGC cert data already confirmed identity.
    if (cgcIdentityConfirmed) {
      imageSearchTitle = null;
    }

    // Ship 3B.3 — Year resolution core now in identityCore.js
    // TODO-016: Era-specific detection moved to ComicAdapter in Phase 3
    // Stub remains for Phase 3 extraction — currently unused
    const keyIssueStr = req.body?.keyIssue ? String(req.body.keyIssue) : "";
    const eraSpecific = /silver age|bronze age|king[-\s]?size|giant[-\s]?size|annual|spectacular|first issue/i.test(keyIssueStr);

    const pcYear = priceCharting?.year ? parseInt(priceCharting.year, 10) : null;
    // Q112 dispatch (2026-07-18, Batman #608 class) — deriveCvYear
    // (src/lib/identityCore.js) uses the issue's own cover_date, never the
    // volume's start_year (was: comicVine.startYear, the series-launch
    // year — 1940 for Batman vol. 1 — fed straight into year resolution
    // for every issue including #608/2002).
    const cvYear = deriveCvYear(comicVine);

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

    // Q131 systemic-audit follow-up — resolveYear's first argument is its
    // "user/vision year" input; passing raw `year` here unconditionally
    // overwrote confirmedYear right back to Vision's rejected guess for
    // the provisional-override case, regressing the null Fix 1/2 already
    // set. pcYear/cvYear are independent external signals (PriceCharting's
    // own year, ComicVine's own issue cover_date) — neither derives from
    // `year`, so with both absent for a book resolveYear has no source
    // and correctly returns null, same "honest unconfirmed" outcome as
    // resolveIdentity's own fix. Scoped identically to the two fixes
    // above: byte-identical to prior behavior (yearForResolution === year)
    // for every case except the provisional outcome specifically —
    // including the general (non-provisional) refused-conflict sub-case,
    // where confirmedYear already legitimately equals vision.year.
    const yearForResolution = identityIsProvisionalOverride ? confirmedYear : year;
    const yearResolution = resolveYear(
      yearForResolution,
      pcYear,
      cvYear,
      ebayYearAuthoritative,
      { keyIssue: keyIssueStr }
    );

    confirmedYear = writeConfirmed('confirmedYear', confirmedYear, yearResolution.confirmedYear, yearSource, yearResolution.yearSource, 'resolve-year');
    yearSource = yearResolution.yearSource;
    let yearOverrideRejected = yearResolution.yearOverrideRejected;

    // Q86: structured year provenance on the response — {value, source,
    // confidence}. Scalar out.confirmedYear stays for every existing
    // consumer; the meta lets the UI and future gates distinguish a
    // cover-read/anchored year from a Vision guess.
    out.confirmedYearMeta = {
      value: confirmedYear || null,
      source: yearResolution.yearSource,
      confidence: yearResolution.yearConfidence,
    };

    // P3 (Funnybook metadata): a Q86-tolerated PC product year outranks an
    // UNPROVEN claimed year. Funny Book (1971) stored year=2024 from
    // wrong-source noise; resolveYear keeps the claimed year when PC is
    // >2y away, so the tolerated product-page year never landed. Adopt it
    // — out.yearCorrected (derived below from confirmedYear ≠ sent year)
    // then heals the catalogue item through the existing merge paths.
    if (priceCharting?.yearMismatchTolerated && pcYear &&
        yearResolution.yearConfidence === 'unproven' &&
        String(confirmedYear || '') !== String(pcYear)) {
      console.log(`[Q86] year backfill from tolerated PC product: ${confirmedYear || 'null'} → ${pcYear}`);
      confirmedYear = writeConfirmed('confirmedYear', confirmedYear, String(pcYear), yearSource, 'pc-product-tolerated', 'Q86');
      yearSource = 'pc-product-tolerated';
      out.confirmedYearMeta = {
        value: confirmedYear,
        source: 'pc-product-tolerated',
        confidence: yearResolution.yearConfidence,
      };
    }

    // Ship 3B.3 — Comp consensus backfill now in identityCore.js
    // Q106 FIX-1 — skip entirely on the CGC-identity path: the visual pool
    // must not backfill/override a title, year, or publisher that CGC's
    // own cert page already confirmed.
    const backfill = cgcIdentityConfirmed
      ? { titleBackfilled: false, yearBackfilled: false, publisherBackfilled: false }
      : backfillFromComps(
          confirmedTitle,
          confirmedYear,
          confirmedPublisher,
          visualResult?.items
        );

    // Q58-TITLE — Title backfill from comp consensus
    if (backfill.titleBackfilled) {
      confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, backfill.title, titleSource, 'comp-consensus-backfill', 'Q58-TITLE');
      titleSource = 'comp-consensus-backfill';
      out.titleBackfilledFromComps = true;
      out.titleBackfillRatio = backfill.titleBackfillRatio;
    }

    if (backfill.yearBackfilled) {
      confirmedYear = writeConfirmed('confirmedYear', confirmedYear, backfill.year, yearSource, backfill.yearBackfillSource || 'comp-consensus-backfill', 'Q58-TITLE');
      yearSource = backfill.yearBackfillSource || 'comp-consensus-backfill';
      out.yearBackfilledFromComps = true;
      out.yearBackfillRatio = backfill.yearBackfillRatio;
      out.yearBackfillSource = backfill.yearBackfillSource;
    }

    if (backfill.publisherBackfilled) {
      confirmedPublisher = writeConfirmed('confirmedPublisher', confirmedPublisher, backfill.publisher, publisherSource, 'comp-consensus-backfill', 'Q58-TITLE');
      publisherSource = 'comp-consensus-backfill';
      out.publisherBackfilledFromComps = true;
      out.publisherBackfillRatio = backfill.yearBackfillRatio;
    }

    // Publisher autofill from ComicVine: when publisher=null but CV has it, backfill.
    // Unblocks Pacific Silver Star and similar cases where Vision didn't extract publisher.
    //
    // Q135 dispatch (2026-07-22, Poison Ivy #31 class) — this read
    // `comicVine?.volume?.publisher?.name`, which is ALWAYS undefined: the
    // object `lookupComicVine` actually returns (this file, ~line 1138)
    // has `volume` as a flat STRING (`match.volume?.name`, just the volume
    // title) and the resolved publisher as its OWN top-level `publisher`
    // field (`resolvedCvPublisher`) — the exact same "comicVine.volume is a
    // flat string, not an object with nested fields" shape bug CLAUDE.md
    // already documents for the era-gate (~2893) and convergence-score
    // axes (~2811/2817/2823); this is a fourth, independent instance of it
    // in the publisher-autofill path specifically. Confirmed via real
    // production log: Poison Ivy #31 resolved cvYear=2025 (agreeing with
    // PC, proving `comicVine` was genuinely non-null with real matched-
    // issue data) yet confirmedPublisher stayed null all the way to Q94's
    // active-comp-consensus fallback (api/enrich.js ~5400) — a strictly
    // weaker signal that only exists because this dead branch could never
    // fire to begin with, regardless of whether CV actually had the data.
    // Root cause of WHY Vision's own publisher read was null this scan in
    // the first place is separate and expected: Vision's OCR of the cover
    // publisher logo varies scan-to-scan on the same physical book (the
    // same documented nondeterminism class as the condition-report-artist
    // drift / Momoko style-confusion entries in the Pattern Library) — not
    // itself a bug to fix, just the trigger condition that exposes this one.
    if (!confirmedPublisher && comicVine?.publisher) {
      confirmedPublisher = writeConfirmed('confirmedPublisher', confirmedPublisher, comicVine.publisher, publisherSource, 'comicvine', 'q135-cv-autofill');
      publisherSource = 'comicvine';
      out.publisherBackfilledFromCV = true;
      console.log(`[cv-pub-autofill] ${confirmedPublisher} (from CV match)`);
    }

    // Q127 dispatch (2026-07-19, Catwoman #64 Szerdy-variant class) — a
    // NEW contamination shape, distinct from Q115's Batman #608 class:
    // there, the wrong-book pool had a DIFFERENT issue number, so
    // filterItemsByIssue (below) fixed it at the root. Here, the wrong-book
    // pool (a 2024 Nathan Szerdy "exclusive/limited" trade-dress variant)
    // shares the SAME title string AND the SAME issue number as the real
    // 2007 book — filterItemsByIssue is structurally a no-op against it.
    // The only signal that distinguishes them is YEAR, and poolYearHint
    // (computed earlier, ~line 2329, from this same request's visual pool)
    // already carries it: 2024 at 100% (6/6) agreement, vs confirmedYear
    // 2007 resolved from PriceCharting. Mirrors the existing [cv-era-gate]
    // precedent (suppress outright on a huge, incontrovertible year drift,
    // rather than partially filter) — an item-level year filter alone
    // wouldn't have been enough here: 14/20 contaminating listings carry no
    // year at all and would survive untouched.
    //
    // req.body.variant is included in the gate (not just the
    // extractConfirmedVariant recomputation below) because that's where
    // THIS bug actually lived: it's grade.js's own eBay-first path
    // (extractConsensus, api/grade.js:353) that produced
    // "exclusive limited signed" from an equally-contaminated pool — a
    // near-identical reverse-image search of the same photo — and
    // extractConfirmedVariant's gates below never even fired to correct
    // it (confirmedVariant just kept the client-forwarded value).
    // Deliberately conservative: this can also suppress a genuine
    // Vision-read variant on the rare chance one coincides with a
    // conflicting poolYearHint. That's the intended direction per standing
    // doctrine (prefer under-confident over over-confident identification)
    // — dropping a possibly-real variant multiplier is a small miss;
    // keeping a contaminated one is the $13.50-vs-real-price class of bug
    // this gate exists to close.
    const variantPoolYearConflict = detectVariantPoolYearConflict(poolYearHint, confirmedYear);
    if (variantPoolYearConflict) {
      console.log(
        `[variant-year-gate] suppressed: poolYearHint=${variantPoolYearConflict.poolYear} ` +
        `(${Math.round(variantPoolYearConflict.poolAgreement * 100)}%, ${variantPoolYearConflict.poolSampleSize} mentions) ` +
        `vs confirmedYear=${variantPoolYearConflict.confirmedYear}, drift=${variantPoolYearConflict.drift}y — ` +
        `pool likely different edition/relaunch, variant consensus skipped`
      );
      // I13 — annotate, never silently drop: the card can surface this as
      // "variant consensus withheld (pool looks like a different
      // year/edition)" rather than the suppression being invisible.
      out.variantPoolYearConflict = variantPoolYearConflict;

      // Q132 dispatch (2026-07-20, GrailKey / ASM #26 class) — corroboration
      // check: did title-family clustering, independently, ALSO find a
      // >=3-member consensus family it was blocked from adopting (Q84
      // dual-axis gate)? See detectFamilyOverrideConflict (variantIdentity.js)
      // for the exact narrow-match rule that excludes the thin/no-consensus
      // 'fallback-vision' cases (Batman #608, Catwoman #64 — must NOT
      // regress). Two agreeing signals escalate past a silent
      // suppress-and-proceed to a hard listing lock — price/comps stay
      // visible per the Customer-Grade Standard (XMEN1 ruling), only the
      // List button gates. A lone/thin signal keeps today's behavior
      // unchanged.
      const familyOverrideConflict = detectFamilyOverrideConflict(familyCandidate);
      if (familyOverrideConflict) {
        out.variantPoolYearConflict.corroboratedByFamily = familyOverrideConflict;
        console.log(
          `[variant-year-gate] corroborated by title-family: blocked cluster "${familyOverrideConflict.topFamilyTitle}" ` +
          `(${familyOverrideConflict.count} members) independently agrees with the year conflict — escalating to hard lock`
        );
        if (!out.listingHardLocked) {
          out.listingHardLocked = true;
          out.listingHardLockReason = 'variant-pool-year-conflict-corroborated';
          out.listingHardLockBanner =
            `Comp pool suggests a different edition (${variantPoolYearConflict.poolYear} vs confirmed ${variantPoolYearConflict.confirmedYear}), corroborated by an independently-blocked title match ("${familyOverrideConflict.topFamilyTitle}") — verify before listing`;
        }
      }
    }

    // Q132 dispatch, Layers 1+2 (2026-07-20, GrailKey / ASM #26 class,
    // follow-up after the Q84 bounded creator-pair recovery fix) — the
    // suppression above (safeReqVariant/variantSourceItems/variantCheck
    // below) was unconditional on variantPoolYearConflict alone, with no
    // awareness of whether title-family clustering had ALREADY
    // independently confirmed (not blocked — a genuine, successful,
    // non-'fallback-vision' override) that this pool IS the correct
    // alternate identity. Once Q84 stops blocking a real artist-named
    // family (the fix this dispatch made), that confirmed family is
    // exactly the evidence needed to trust the pool's own variant/year
    // signal rather than discard it — the ORIGINAL Q127 rationale
    // ("thin/incidental pool noise, discard it") no longer applies once a
    // >=3-member consensus family has been independently accepted, not
    // just found and rejected. FAMILY_OVERRIDE_DECISIONS (compHygiene.js)
    // is the single shared check for "the override succeeded" — also used
    // by identityCore.js's resolveIdentity and the Ship 26.3B narrowing
    // just below, so this can't drift into a fourth independent copy.
    //
    // Deliberately narrow: this ONLY changes behavior when
    // variantPoolYearConflict is truthy AND familyCandidate.decision is a
    // SUCCESSFUL override. Batman #608 (poolYearHint never fires —
    // variantPoolYearConflict is null, this code never runs) and Catwoman
    // #64 (variantPoolYearConflict fires, but no family override occurred
    // in that production case — familyCandidate.decision is not one of
    // FAMILY_OVERRIDE_DECISIONS) are both unaffected; suppression stays
    // unconditional for them, exactly as Q127/Q132-Layer-1 shipped it.
    const yearConflictResolvedByFamily = !!variantPoolYearConflict &&
      FAMILY_OVERRIDE_DECISIONS.includes(familyCandidate?.decision);
    if (yearConflictResolvedByFamily) {
      out.variantPoolYearConflict.resolvedByFamilyOverride = {
        decision: familyCandidate.decision,
        topFamilyTitle: familyCandidate.topFamily?.title || familyCandidate.topFamily?.rawTitle || null,
      };
      console.log(
        `[variant-year-gate] resolved: confirmed family override (${familyCandidate.decision}) ` +
        `independently agrees with poolYearHint=${variantPoolYearConflict.poolYear} — ` +
        `suppression lifted, variant/year computation proceeds`
      );
    }
    // Suppression now applies only when the conflict is NOT resolved by a
    // confirmed family override — the default/unresolved path (Batman
    // #608, Catwoman #64) is byte-identical to Q127/Fix-1 behavior.
    const suppressVariantForYearConflict = !!variantPoolYearConflict && !yearConflictResolvedByFamily;

    // Q133 dispatch (2026-07-21, Invincible/Pop Kill class) — generalizes
    // Q132 Layer 4 from a year-only check gated behind a confirmed family
    // override into a two-axis check (year OR product-name-vs-pool) that
    // runs whenever a PC match exists, independent of family decision.
    //
    // Investigation + sandbox evidence (Q132/Q133 dispatches) showed Layer
    // 4's original scope was too narrow in one direction and the year axis
    // alone is insufficient in another:
    //
    // - Too narrow: Layer 4 fired only when `yearConflictResolvedByFamily`
    //   (a confirmed family override AND a year conflict). Invincible #1
    //   MegaCon never reaches that branch at all — Vision ("invincible")
    //   and the pool's own consensus title agree at 100% overlap, so title-
    //   family clustering never has to override anything; the decision
    //   falls through to `fallback-vision`, which is not a
    //   FAMILY_OVERRIDE_DECISIONS entry. PC matched "Invincible Universe:
    //   Battle Beast #1 (2025)" — a wholly unrelated Skybound one-shot —
    //   and the old gate could never see it.
    // - Year axis insufficient: Invincible's wrong PC match (2025) is only
    //   1 year off the pool's own year-hint (2026) — comfortably inside
    //   pcMatchConflictsWithPoolYear's tolerance. The two products are
    //   contemporaneous; the divergence is EDITION identity, not time.
    //   None of the pool's 20 rawTitles mention "battle beast"/"universe".
    // - Name axis alone would have been insufficient for the ORIGINAL
    //   Layer-4 case: PC's "Amazing Spider-Man #26 (2001)" textually
    //   OVERLAPS its own pool perfectly (same title/issue, wrong printing
    //   year) — a text-only check would have missed GrailKey/ASM #26.
    //
    // Neither axis alone is sufficient; both run, independently, and either
    // conflicting rejects the match. pcMatchConflictsWithPoolName
    // (variantIdentity.js) carries its own sandbox-caught false-negative
    // fix (a >=2-token PC name needs >=2 overlapping tokens, not a bare
    // ratio — "Alexander Hamilton" was passing as "agreeing" with "Alexander
    // Lozano" on the shared first name alone).
    //
    // Do NOT mirror ComicVine's [cv-year-strict] gate here — that gate's
    // apparent "success" on the original GrailKey case was coincidental
    // (all 4 CV candidates scored 0 on the NAME axis before year ever
    // mattered) and it uses the same stale/null comicYear PC does.
    //
    // Rejects outright (does not demote to "nearest fuzzy hit") — matching
    // the hard-reject disposition of every other confirmed conflict gate in
    // this file. No new fallback path needed (confirmed by tracing, not
    // assumed): fetchPricechartingPop/fetchPricechartingSales (~line
    // 4061/4069) are already gated on `priceCharting?.id`, so nulling
    // priceCharting here makes both no-op correctly, and Tier 3 active-
    // comps-only anchoring already works once no PC anchor exists. The
    // out.pc* fields below were already populated (~line 3430-3439, before
    // this gate had the pool information needed to reject the match) and
    // must be explicitly cleared here.
    //
    // Byte-identical for the agreeing case: Poison Ivy #31 (PC year 2025 vs
    // poolYearHint 2024, 1y — agrees; PC name "Poison Ivy #31" fully
    // overlaps its own pool) and Catwoman #64 (PC/pool agree on both year
    // and name) never reject. Batman #608 has no poolYearHint at all and
    // its PC name fully overlaps its pool, so neither axis ever fires.
    if (priceCharting) {
      const poolRawTitlesForPcGate = (visualResult?.items || [])
        .map((it) => it?.rawTitle)
        .filter(Boolean);
      const pcYearConflict = pcMatchConflictsWithPoolYear(priceCharting.year, poolYearHint);
      const pcNameConflict = pcMatchConflictsWithPoolName(priceCharting.productName, poolRawTitlesForPcGate);
      // Q144A dispatch (2026-07-22, Adventure Time Summer Special SDCC
      // class) — third axis: family-required discriminator. The name axis
      // above checks against the WHOLE pool (poolRawTitlesForPcGate), which
      // mixes the winning family with competing wrong families sharing the
      // same stem ("adventure time") — a plain-series PC anchor passes the
      // token-overlap ratio even though it misses the WINNING family's own
      // product-distinguishing marker ("summer special"). This axis checks
      // the PC candidate against the winning family's OWN member titles
      // (topFamily.indices mapped back to the visual pool), rejecting when
      // a >=60%-adopted series-marker phrase is reflected nowhere in the PC
      // product name. See pcMatchMissingFamilyDiscriminator
      // (variantIdentity.js) for the Kamala Khan / variant-cover-pool
      // false-positive guards.
      const familyMemberTitlesForPcGate = (familyCandidate?.topFamily?.indices || [])
        .map((idx) => visualResult?.items?.[idx]?.rawTitle)
        .filter(Boolean);
      const pcDiscriminatorConflict = pcMatchMissingFamilyDiscriminator(
        priceCharting.productName, familyMemberTitlesForPcGate
      );
      if (pcYearConflict || pcNameConflict || pcDiscriminatorConflict) {
        const axes = [pcYearConflict && 'year', pcNameConflict && 'name', pcDiscriminatorConflict && 'discriminator'].filter(Boolean).join('+');
        console.log(
          `[pc-anchor-gate] rejecting PC match "${priceCharting.productName}" (year=${priceCharting.year}) — ` +
          `conflicts on ${axes} axis (poolYearHint=${poolYearHint?.year ?? 'n/a'}) — ` +
          `no PC anchor for this book's actual edition; falling through to active-comps-only pricing`
        );
        // I13 — annotate the rejection so the card can show WHY there's no
        // PC data, rather than a silent absence.
        out.pcMatchRejectedForYearConflict = {
          rejectedProductName: priceCharting.productName,
          rejectedProductId: priceCharting.id,
          rejectedYear: priceCharting.year,
          poolYearHint: poolYearHint?.year ?? null,
          conflictAxes: axes,
        };
        out.pcProductId = null;
        out.pcProductName = null;
        out.pcEbayEpid = null;
        out.pcLastUpdated = null;
        out.pcLoosePrice = null;
        out.pcGradedPrice = null;
        priceCharting = null;

        // Q132/Q133 — confirmedYear correction. Only meaningful when (a)
        // poolYearHint actually exists (nothing to correct TO otherwise —
        // e.g. Pop Kill Lozano has no poolYearHint at all) AND (b)
        // confirmedYear was itself derived from this same now-rejected PC
        // match (out.confirmedYearMeta.source === 'pricecharting') — a
        // name-axis-only rejection (Lozano's real confirmedYear came from
        // ComicVine, not PC) must NOT stomp a perfectly good year sourced
        // elsewhere. getEra(year) (this file, ~line 220) defaults null →
        // 'vintage', so correcting to poolYearHint.year (never to null)
        // matters whenever the wrong PC year and the real year land on
        // opposite sides of the 1985 boundary.
        if (poolYearHint?.year != null && out.confirmedYearMeta?.source === 'pricecharting') {
          const correctedYear = poolYearHint.year;
          console.log(
            `[pc-anchor-gate] confirmedYear corrected: ${confirmedYear} → ${correctedYear} ` +
            `(was derived from the just-rejected PC match)`
          );
          confirmedYear = writeConfirmed('confirmedYear', confirmedYear, String(correctedYear), yearSource, 'pc-anchor-rejected-corrected', 'pc-anchor-gate');
          yearSource = 'pc-anchor-rejected-corrected';
          out.confirmedYearMeta = {
            value: confirmedYear,
            source: 'pc-anchor-rejected-corrected',
            confidence: 'proven',
          };
          // Corrects the SAME object decisionEngine.js's describeWarning
          // reads for the 'variant-pool-year-conflict' banner text.
          if (out.variantPoolYearConflict) {
            out.variantPoolYearConflict.originalConfirmedYear = out.variantPoolYearConflict.confirmedYear;
            out.variantPoolYearConflict.confirmedYear = correctedYear;
          }
        }
      }
    }

    // Q141-A — canonical catalog-title projection. priceCharting surviving
    // to this point means it passed BOTH gates: titleOverlapsProduct
    // (~line 3422, the initial title-overlap accept) and pc-anchor-gate
    // immediately above (year/name/discriminator conflict checks) — the
    // "exact trusted anchor" condition. Below this point, confirmedTitle
    // is projected from the anchor's own clean product name rather than
    // whatever title-family clustering assembled, which can carry cover/
    // edition descriptor text the anchor's own name never had (Batman #15
    // production case: family clustering assembled "batman machine gun",
    // while the accepted PC anchor's own name was plain "Batman #15
    // (1943)" — every downstream consumer below this line, from here on,
    // used the polluted string instead of the anchor's clean one).
    //
    // Scope, explicit: only fires from an ACCEPTED PC anchor — no
    // ComicVine-anchor equivalent yet (no real production case has
    // motivated one; deferred rather than built speculatively, matching
    // this codebase's standing "don't fix without a real signal"
    // discipline). When no PC anchor is accepted, confirmedTitle is
    // untouched — whatever the pre-existing resolution chain (title-family
    // consensus, vision, etc.) already produced stays authoritative,
    // unchanged from before this commit.
    if (priceCharting?.productName) {
      const canonicalTitle = projectCanonicalTitleFromAnchor(priceCharting.productName);
      // Q141-A2 — a bracketed descriptor block ("[Nick Dragotta Virgin
      // Foil]") is anchor-sourced signal, independent of whether the title
      // itself needed correcting this request — capture it whenever
      // present, not only inside the title-changed branch below (a request
      // where confirmedTitle already happened to equal the projected
      // canonical title would otherwise silently drop this).
      const anchorBracketDescriptor = extractAnchorBracketDescriptor(priceCharting.productName);
      if (anchorBracketDescriptor && !out.editionDescriptorCandidate) {
        out.editionDescriptorCandidate = anchorBracketDescriptor;
        console.log(`[q141-a2] anchor bracket descriptor captured: "${anchorBracketDescriptor}" (anchor="${priceCharting.productName}")`);
      }
      if (canonicalTitle && canonicalTitle !== confirmedTitle) {
        // GrailKey Commit T (T1, 2026-08-03) — Marvel Tales #14 class. A
        // corroborated identity (title-family clustering cleared a real
        // consensus bar — see isCorroboratedIdentitySource's own doc
        // comment, identityCore.js) must never be overwritten by a PC
        // anchor's product name. A PC anchor whose name conflicts with a
        // corroborated title is evidence the ANCHOR is wrong, not the
        // title: confirmed live — "marvel tales" (source=title-family-
        // weighted-consensus, 17/20 eBay rows / 4-row 100%-overlap family)
        // was overwritten to "Tales of Asgard" from a PC anchor that only
        // survived because PRICECHARTING_EXCLUDE's own "marvel tales"
        // reprint-exclusion term rejected the correct candidate (a
        // separate, still-open defect, out of this commit's scope) — the
        // corroborated title had already done more work to establish
        // itself than a single PC catalog match ever does. Uncorroborated
        // sources ('vision', 'ebay_visual_override', etc.) are unaffected
        // — q141-a still corrects those exactly as before (e.g. the
        // Batman #15 "batman machine gun" class this projection was
        // originally built for).
        if (isCorroboratedIdentitySource(identitySource)) {
          console.log(
            `[q141-a] SKIPPED — confirmedTitle "${confirmedTitle}" is corroborated ` +
            `(source=${identitySource}); anchor "${priceCharting.productName}" projects to "${canonicalTitle}", ` +
            `rejected as evidence the ANCHOR is wrong, not the title`
          );
        } else {
          // Anchor-sourced bracket content is preferred over the
          // family-cluster-diff heuristic when both are available — it's a
          // direct read of the anchor's own descriptor, not an inference.
          const editionDescriptorCandidate = anchorBracketDescriptor || diffEditionDescriptorCandidate(confirmedTitle, canonicalTitle);
          console.log(
            `[q141-a] canonical projection: confirmedTitle "${confirmedTitle}" -> "${canonicalTitle}" ` +
            `(anchor="${priceCharting.productName}")` +
            (editionDescriptorCandidate ? ` editionDescriptorCandidate="${editionDescriptorCandidate}"` : '')
          );
          confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, canonicalTitle, titleSource, 'pc-anchor-projection', 'q141-a');
          titleSource = 'pc-anchor-projection';
          out.confirmedTitle = canonicalTitle;
          if (editionDescriptorCandidate) {
            out.editionDescriptorCandidate = editionDescriptorCandidate;
          }
        }
      }
    }

    // Q135 dispatch (2026-07-22, Invincible #1 MegaCon class) — narrow
    // recovery for ship12's imageSearchTitle selection (computed above,
    // ~line 3335). Invincible can't reach ship12's branch-2 isVariantScan
    // fallback today: title-family clustering's decision is
    // 'fallback-vision' (Q84 blocked the [atom,eve] character-name
    // override — that gate is deliberately untouched here), and branch-2
    // of the imageSearchTitle selector nulls it unconditionally the moment
    // decision === 'fallback-vision', before ever checking isVariantScan.
    // Real production case: PC anchor rejected (Battle Beast one-shot,
    // wrong product), pool is MegaCon-exclusive (premium-variant tokens),
    // but the comps query fell back to a bare "invincible #1 2026" search
    // that matched Battle Beast print sets + an omnibus instead of the
    // pool's own 20 real MegaCon-exclusive listings.
    //
    // Deliberately narrow, matching the greenlit scope: fires ONLY when
    // (a) imageSearchTitle is still null (every other branch already
    // produced a usable seed — this never overrides a working value), (b)
    // the PC anchor was just rejected on this exact request (a genuine
    // signal that the "obvious" query text matched the wrong product),
    // and (c) the pool's own dominant family carries premium-variant
    // tokens (convention/exclusive/virgin/numbered/ltd — PREMIUM_VARIANT_RE,
    // the same registry Q111's Filter 1c AND-match already trusts). When
    // all three hold, seed the query from the pool's own dominant rawTitle
    // — same mechanism ASM #26/Nakayama already uses via
    // familyCandidate.rawTitle for an ACCEPTED override; here the override
    // was blocked, so this reads familyCandidate.topFamily.rawTitle
    // instead (still populated even when Q84 blocks the top-level decision
    // — see selectTitleFamilyCandidate's fallback-vision branches,
    // imageSearchIdentity.js).
    if (
      imageSearchTitle == null &&
      out.pcMatchRejectedForYearConflict &&
      familyCandidate?.topFamily?.rawTitle
    ) {
      const poolVariantText = `${req.body.variant || ''} ${familyCandidate.topFamily.rawTitle}`;
      if (PREMIUM_VARIANT_RE.test(poolVariantText)) {
        imageSearchTitle = familyCandidate.topFamily.rawTitle;
        console.log(
          `[ship12-anchor-rejected] PC anchor rejected + premium-variant pool — ` +
          `seeding comps query from pool's dominant rawTitle: "${imageSearchTitle}"`
        );
      } else {
        console.log(
          `[ship12-anchor-rejected] PC anchor rejected but pool carries no premium-variant ` +
          `tokens — leaving imageSearchTitle null (narrow trigger not met)`
        );
      }
    }

    // Q127 follow-up (same dispatch, found during pre-commit verification
    // audit) — req.body.variant is read directly, bypassing
    // confirmedVariant entirely, at several OTHER call sites downstream:
    // the variant-multiplier application block (the exact source of the
    // real "[variant] exclusive limited signed x 1.15" contamination seen
    // in production — confirmedVariant being null does NOT stop this
    // separate block from re-reading the raw client-forwarded value),
    // computePriceBandsFromSold's variant param, and the Claude AI-verify
    // prompt data. All three need the identical suppression
    // confirmedVariant already gets, or the price-multiplier/AI-verify
    // stages would still see the contaminated string even after comps/
    // sold-verify are correctly cleaned up above. Single derived value so
    // every remaining raw req.body.variant consumer stays in sync with the
    // same gate rather than drifting into a fourth independently-checked
    // copy.
    // Track B Phase 0, Commit 4.3 (Section D, 2026-07-30) — variant
    // provenance guard. req.body.variant is a bare string with no
    // provenance metadata of its own — issueNum (vision.issue, the exact
    // value this variant text was captured ALONGSIDE at scan time, both
    // arriving in the same request payload) is the only signal this
    // codebase has for "which issue was this variant candidate computed
    // for." When issueNum disagrees with the FINAL confirmedIssue —
    // confirmedIssue changed since this variant text was captured, by
    // ANY mechanism (Commit 4.3's own family-authority retention,
    // vision-zero-support, an eBay title override, a future code path) —
    // the candidate is invalidated before it can be used anywhere,
    // including as the `visionVariant` input to extractConfirmedVariant
    // below, which would otherwise silently pair a stale variant read
    // with a re-scoped issue population. This is independent, narrower
    // defense-in-depth alongside the pre-existing `identityIsProvisionalOverride
    // ? null : safeReqVariant` clearing a few lines down and
    // filterItemsByIssue's own confirmedIssue-scoped population (Q115) —
    // together these ensure a variant candidate can never outlive the
    // issue number it was originally paired with.
    const variantSourceIssue = issueNum ?? null;
    const variantProvenanceValid = isVariantProvenanceValid(variantSourceIssue, confirmedIssue);
    if (!variantProvenanceValid) {
      console.log(
        `[commit4.3] variant provenance invalidated: variantSourceIssue="${variantSourceIssue}" ` +
        `!= confirmedIssue="${confirmedIssue}" — clearing req.body.variant, recomputing from the final issue-scoped population only`
      );
    }
    const safeReqVariant = (suppressVariantForYearConflict || !variantProvenanceValid) ? null : (req.body.variant || null);

    // GrailKey Commit D2 (2026-08-02, ASM #300 facsimile-injection
    // dispatch) — the true unconditional injection point: confirmedVariant
    // is DEFAULT-initialized from safeReqVariant a few lines below,
    // whether or not extractConfirmedVariant ever finds pool consensus
    // (it early-returns null on zero consensus, which a facsimile-
    // dominated but otherwise-non-agreeing pool hits routinely). Gate
    // ONCE here, before that seed is used anywhere, rather than only
    // inside extractConfirmedVariant (whose own copy of this same check,
    // added the same dispatch, is defense-in-depth for the case pool
    // consensus DOES fire — it cannot reach the zero-consensus path).
    // req.body.variant itself is left untouched for its other existing
    // consumers (variant-multiplier block, computePriceBandsFromSold,
    // AI-verify prompt) — out of scope for this dispatch, which is
    // specifically about what becomes confirmedVariant for pricing.
    const visionPrintingClaimCheck = validateVisionPrintingClaim(
      safeReqVariant,
      req.body?.isReprint,
      req.body?.editionType
    );
    if (visionPrintingClaimCheck.conflict) {
      out.visionPrintingConflict = visionPrintingClaimCheck.conflict;
      console.log(
        `[variant-printing-gate] D2 conflict: req.body.variant="${safeReqVariant}" claims a printing/edition ` +
        `status not corroborated by structured fields (isReprint=${req.body?.isReprint}, ` +
        `editionType="${req.body?.editionType || 'null'}") — confirmedVariant seed suppressed`
      );
    }
    const safeVariantForConfirmed = visionPrintingClaimCheck.safeVariant;

    // Ship #20a.6.18 — Variant identity check (additive, gated). Only runs
    // on modern books (year >= 2000) with variant detected AND Vision
    // confidence not HIGH AND eBay image search returned results. Extracts
    // consensus variant from eBay listing titles (convention, artist,
    // exclusive markers, limitation). Overrides Vision variant for comp
    // query when ≥2 listings agree. Falls back gracefully: no consensus →
    // keeps Vision variant. Old books (pre-2000) skip entirely.
    // Q134 dispatch (2026-07-21, Rachta Lin class) — confirmedVariant never
    // got the same honest-null treatment confirmedYear/confirmedPublisher
    // already get from resolveIdentity's provisional branch. Without this,
    // Vision's rejected variant read (safeReqVariant, itself the client-
    // forwarded req.body.variant) survived untouched — displayed as the
    // variant badge AND fed into fetchComps/computePriceBandsFromSold,
    // where it could poison variant-preference filtering against genuine
    // comps that don't mention it. Gated exactly like year/publisher:
    // provisional branch only — a normal, Vision-agreed identity keeps its
    // real variant untouched. If extractConfirmedVariant (below) finds a
    // pool-derived consensus, it overwrites this null with THAT — pool-
    // derived or honestly-null, never the overruled source.
    let confirmedVariant = writeConfirmed('confirmedVariant', null, identityIsProvisionalOverride ? null : safeVariantForConfirmed, 'unknown', 'vision', 'ship-20a.6.18-init');
    let variantIdentitySource = 'vision';
    let variantConsensus = null;
    let variantOverriddenVision = false;
    // Slice C (2026-07-22) — pool-corroborated "the market has signed
    // copies of this book" signal (Giang MegaCon Secret Drop class, where
    // Vision's own prompt is deliberately barred from writing signing
    // status into variant text — see api/grade.js JSON_SHAPE — so the
    // eBay-pool consensus is the ONLY source for a raw signed book).
    let confirmedSignedConsensus = false;

    // Q106 FIX-1 Step 3 — on the CGC-identity path, variant resolution never
    // touches the visual pool. Prefer cgc-lookup's own variant text (when the
    // scraper parses one — not yet implemented, see Q106 report) else fall
    // back to Vision's variant field. The Q100 FIX-A auth-token strip is
    // applied downstream in fetchComps/api/comps.js using confirmedLabelType.
    if (cgcIdentityConfirmed) {
      confirmedVariant = writeConfirmed('confirmedVariant', confirmedVariant, cgcResult.variant || safeVariantForConfirmed || null, variantIdentitySource, cgcResult.variant ? 'cgc_cert' : 'vision', 'q106-fix1-cgc');
      variantIdentitySource = cgcResult.variant ? 'cgc_cert' : 'vision';
      console.log(`[cgc-variant] source=${cgcResult.variant ? 'cgc' : 'vision'} value="${confirmedVariant || ''}"`);
    } else {

    // Ship 26.3B — Restrict variant extraction to selected title family when
    // family candidate fires. Prevents wrong-family variant contamination.
    // Catwoman/Gotham War: previously variant pool was 20 mixed items, electing
    // Artgerm from Catwoman Uncovered family. Now uses Gotham War family subset only.
    const variantSourceItemsPreIssueFilter = (familyCandidate &&
      FAMILY_OVERRIDE_DECISIONS.includes(familyCandidate.decision) &&
      familyCandidate.topFamily?.indices &&
      Array.isArray(visualResult?.items))
      ? familyCandidate.topFamily.indices.map(i => visualResult.items[i]).filter(Boolean)
      : visualResult?.items;

    // Q115 dispatch (2026-07-18, Batman #608 pool-contamination class) —
    // an artist-name match can structurally never come from a different
    // issue, so filter to items whose OWN extracted issue number matches
    // our confirmed issue BEFORE extractConfirmedVariant computes artist/
    // exclusive/limitation/year consensus from them. Was: the Ship 26.3B
    // family-narrowing above only fires for 'top-rank-protection'/
    // 'weighted-consensus' — when title-family clustering falls back to
    // Vision (decision='fallback-vision', e.g. a genuinely incoherent
    // pool), the FULL unfiltered visualResult.items reached this function
    // untouched. Confirmed production case: Batman #608 (2002, Jim Lee,
    // Hush) — 0/20 pool items were actually issue #608 (a mix of Superman/
    // Batman #657, Absolute Batman #19, Detective Comics #1000, Batman #1
    // reprints, even unrelated Marvel Venomverse listings, sharing only
    // eBay's own visual-similarity confusion around Dell'Otto's painted-
    // cover style across his many DIFFERENT DC variant covers). 4/20
    // mentioned "Dell'Otto" — correctly scored as a MINORITY (20%, under
    // the 70% distinguishing-ratio threshold) by the existing artist gate,
    // which is exactly the signal shape this feature treats as a genuine
    // distinguishing variant subset — except these aren't a variant
    // subset of OUR book, they're different books entirely. The gate
    // has no way to tell those apart without knowing whether the items
    // are even the same issue — this filter gives it that fact directly,
    // fixing the root mechanism rather than flagging the bad output after
    // the fact. Each item's `.issue` field is already computed by
    // extractIdentityFromImageSearch/extractIssueFromTitle — same value
    // the `[visual] extracted issues: [...]` log line already draws from,
    // no new extraction logic. A facsimile/artist-variant mixed into a
    // pool for the SAME issue (the scenario this feature was originally
    // built for — e.g. a Skottie Young facsimile among Captain America
    // #25 originals) is unaffected: those listings still say "#25," so
    // they survive this filter untouched. filterItemsByIssue lives in
    // src/lib/variantIdentity.js (single source of truth, directly
    // regression-testable).
    //
    // Q144 Item 1 (final scope) — familyCandidateAccepted passed through so
    // filterItemsByIssue can corroborate (not infer) a row whose own
    // `.issue` was falsely nulled by extractIssueFromTitle's marketing-copy
    // guard, ONLY inside an accepted family override where every row
    // already belongs to the winning family by construction (see that
    // function's own doc comment for the exact corroboration conditions).
    const variantSourceItems = suppressVariantForYearConflict
      ? []
      : filterItemsByIssue(variantSourceItemsPreIssueFilter, confirmedIssue, familyCandidateAccepted);

    // Q127 — skip recomputation entirely on an UNRESOLVED year-hint
    // conflict: both the override AND backfill paths would otherwise
    // recompute the identical contaminated consensus from the same pool
    // (variantSourceItems is already forced empty above, but Gate 1's
    // early-return means this call would just be dead work either way —
    // skipping it outright keeps the log trail limited to the one
    // [variant-year-gate] line). When the conflict IS resolved by a
    // confirmed family override (Q132 Layer 1), this call proceeds.
    //
    // Q132 Layer 2 — bookYear: extractConfirmedVariant's own entry gate
    // (BACKFILL_MIN_YEAR) rejects pre-1990 bookYear outright, before it
    // ever reaches artist/year consensus. confirmedYear is STILL the
    // stale, disputed value at this point in the resolved-conflict case
    // (correcting it is exactly what this call is for) — passing it back
    // in would fail that gate immediately (empirically confirmed: a real
    // 13-listing Nakayama pool with bookYear=1965 never got past "backfill
    // skipped: year=1965 < 1990"). poolYearHint.year is itself an
    // independently-computed signal from this same visual pool, already
    // corroborated by the now-successful family override — using it here
    // only in this narrow branch lets the pool's own evidence reach its
    // own consensus computation instead of being rejected by a gate keyed
    // on the very value that evidence disputes. Confined to
    // extractConfirmedVariant's bookYear PARAMETER only — does not touch
    // confirmedYear itself, which is only ever reassigned by the existing,
    // unmodified Q99-B variantYear override a few lines below (computed
    // from the pool's own per-item year mentions, independent of this
    // parameter) — so getGradeMultiplier's later `confirmedYear || year`
    // era-table selection is unaffected except through that same
    // pre-existing mechanism.
    const variantBookYear = yearConflictResolvedByFamily ? variantPoolYearConflict.poolYear : confirmedYear;
    const variantCheck = suppressVariantForYearConflict ? null : extractConfirmedVariant(
      variantSourceItems,
      safeReqVariant,
      variantBookYear,
      confidence,
      req.body?.isReprint,
      req.body?.editionType
    );
    if (variantCheck) {
      confirmedVariant = writeConfirmed('confirmedVariant', confirmedVariant, variantCheck.confirmedVariant, variantIdentitySource, 'ebay_image_consensus', 'variant-check-consensus');
      variantIdentitySource = 'ebay_image_consensus';
      variantConsensus = variantCheck.consensus;
      variantOverriddenVision = variantCheck.overriddenVision;
      confirmedSignedConsensus = variantCheck.signedConsensus === true;

      // GrailKey Commit D1/D2 — I13 (log-card fidelity): surface both,
      // never silently drop. printingReferenceCandidate is informational
      // (pool agrees on a printing signal, not adopted into pricing);
      // visionPrintingConflict overrides the enrich.js-level gate's own
      // (identical-shape) value only when THIS call is the one that
      // actually detected it — the pool-consensus path can find a
      // conflict the earlier, zero-consensus-unaware gate had no chance
      // to see yet if extractConfirmedVariant reaches its own gate first.
      if (variantCheck.printingReferenceCandidate) {
        out.printingReferenceCandidate = variantCheck.printingReferenceCandidate;
      }
      if (variantCheck.visionPrintingConflict) {
        out.visionPrintingConflict = variantCheck.visionPrintingConflict;
      }

      // Q99-B: an artist-facsimile's own listings (Skottie Young 2023, etc.)
      // are more authoritative on publication year than CV's volume
      // start_year or the undifferentiated comp-pool consensus — both of
      // those mix original-print and facsimile listings under the same
      // nominal title/issue. Override confirmedYear so era-filter keeps the
      // facsimile's real comps instead of the original print's.
      if (variantCheck.variantYear) {
        console.log(
          `[variant-year] overriding confirmedYear ${confirmedYear || 'null'} → ` +
          `${variantCheck.variantYear} from ${variantConsensus.artist} pool`
        );
        confirmedYear = writeConfirmed('confirmedYear', confirmedYear, String(variantCheck.variantYear), yearSource, 'variant-pool', 'q99-b-variant-year');
        yearSource = 'variant-pool';
        out.confirmedYearMeta = {
          value: confirmedYear,
          source: 'variant-pool',
          confidence: 'proven',
        };
        out.yearResolvedFromVariantPool = true;
        out.yearResolvedFromVariantPoolRatio = variantCheck.variantYearRatio;
      }
    }
    } // end Q106 FIX-1 else (non-CGC-identity variant resolution)

    // Q116 dispatch (2026-07-18, Incredible Hulk #377 class) — thread
    // editionWarning's classified SPECIFIC printing kind into
    // confirmedVariant so the already-correct isolation machinery (Filter
    // 1c AND-match / Q111, sold-side printingMatch / soldVerification.js)
    // actually has real data to isolate against. Previously
    // editionWarning.detected only drove the enrich.js-local reprint-comp
    // filter (Part 1, above) and the UI list-gate — confirmedVariant
    // itself never learned the specific printing at all, so nothing
    // downstream of it (Filter 1c, printingMatch, the active-comp query
    // string itself) could isolate by printing even when Vision correctly
    // spotted "3rd printing" in its own reasoning. Generic-only signals
    // (reprint / facsimile-without-a-number is still specific enough,
    // handled below / later-printing / not-first-print / not-original /
    // less-valuable) are deliberately NOT threaded — we don't know WHICH
    // specific printing then, and injecting a vague "reprint" token into
    // confirmedVariant would feed Filter 1c's AND-match exactly the kind
    // of under-specified signal Q111 fixed, not a real one.
    if (!cgcIdentityConfirmed && editionWarning?.detected) {
      const specificPrintingForVariant = classifySpecificPrinting(editionWarning.signals);
      if (specificPrintingForVariant && !String(confirmedVariant || '').toLowerCase().includes(specificPrintingForVariant.text)) {
        // GrailKey Commit V1 — this was the one confirmedVariant write site
        // with NO source attribution at all (V1-Q3 finding): it threads
        // Vision's own classified printing signal without ever updating
        // variantIdentitySource. The LOG now attributes it correctly
        // ('edition-warning-printing', genuinely determinable from
        // classifySpecificPrinting's own output — not a guess). Deliberately
        // NOT updating the real variantIdentitySource variable itself here —
        // V1 is log-only/zero-behavior-change, and that variable is read
        // downstream (`variantIdentitySource === 'ebay_image_consensus'`,
        // ~line 6198) for real output construction; changing it would be a
        // real behavior change, not an instrumentation one. Left as a
        // disclosed, still-open gap for a future (non-V1) fix.
        const newConfirmedVariant = confirmedVariant ? `${confirmedVariant} ${specificPrintingForVariant.text}` : specificPrintingForVariant.text;
        confirmedVariant = writeConfirmed('confirmedVariant', confirmedVariant, newConfirmedVariant, variantIdentitySource, 'edition-warning-printing', 'q116-edition-variant');
        console.log(`[edition-variant] threaded "${specificPrintingForVariant.text}" into confirmedVariant (from Vision's own reasoning) — now "${confirmedVariant}"`);
      }
    }

    // GrailKey Commit N1 (2026-08-03, Spawn Brett Booth PC-anchor class)
    // — promote a canonical-projection residue (out.editionDescriptorCandidate,
    // q141-a above) to confirmedVariant when confirmedVariant is still
    // null and the residue carries a recognized, non-printing variant-
    // axis signal. Uses D3's own extractVariantTokensByAxis
    // (compHygiene.js) — the SAME taxonomy the rest of the variant
    // pipeline already trusts — rather than a new heuristic. Distinguishes
    // a genuine descriptor ("brett booth" -> artist axis populated) from
    // title-residue noise ("the invincible" -> every axis empty; this is
    // Iron Man #126's own editionDescriptorCandidate, confirmed via
    // direct trace this dispatch — diffEditionDescriptorCandidate has no
    // awareness of what's a masthead adjective vs a real variant credit,
    // it just diffs tokens) by requiring AT LEAST ONE non-printing axis
    // to be non-empty. Printing axis is never adopted from this path
    // (D1's invariant, unchanged) — the promoted string is built only
    // from artist/coverType/coverLetter/distribution axis content; a
    // descriptor whose ONLY recognized axis is printing ("2nd print")
    // has nothing left to adopt and confirmedVariant stays null.
    if (!confirmedVariant && out.editionDescriptorCandidate) {
      const promotion = classifyPromotableVariantDescriptor(out.editionDescriptorCandidate);
      if (promotion.promotable) {
        confirmedVariant = writeConfirmed('confirmedVariant', confirmedVariant, promotion.text, variantIdentitySource, 'canonical-projection-residue', 'commit-n1-residue');
        variantIdentitySource = 'canonical-projection-residue';
        console.log(
          `[n1-variant-promotion] promoted editionDescriptorCandidate="${out.editionDescriptorCandidate}" ` +
          `to confirmedVariant (axes: ${JSON.stringify(promotion.axes)})`
        );
      } else {
        console.log(
          `[n1-variant-promotion] editionDescriptorCandidate="${out.editionDescriptorCandidate}" ` +
          `carries no recognized variant-axis signal — NOT promoted (title residue, not a variant)`
        );
      }
    }

    // GrailKey Dispatch 03 Strip 1 (2026-08-06) — narrow-scope publisher/
    // imprint/event token routing. selectTitleFamilyCandidate's Q140
    // coherent-content lane (imageSearchIdentity.js) now separates its
    // admitted tokens into admittedTitleTokens (stays in confirmedTitle,
    // e.g. "and other stories" — Q109-C precedent, protected) vs
    // admittedVariantTokens (a narrow, explicit known-name list only —
    // "cartoon books", "local shop day", "wildstorm", "hanna barbera",
    // "gold key" — see KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES for the full
    // rationale, including why the broader "route everything not
    // Vision-asserted" design was tested and rejected). Fill-only-if-empty,
    // same pattern as the N1 promotion block just above — every other
    // confirmedVariant source (CGC cert, eBay image consensus, edition-
    // warning printing, canonical-projection-residue) takes priority.
    if (!confirmedVariant && Array.isArray(familyCandidate?.admittedVariantTokens) && familyCandidate.admittedVariantTokens.length > 0) {
      const routedVariant = familyCandidate.admittedVariantTokens.join(' ');
      confirmedVariant = writeConfirmed('confirmedVariant', confirmedVariant, routedVariant, variantIdentitySource, 'title-family-publisher-imprint-event', 'grailkey-d03-strip1');
      variantIdentitySource = 'title-family-publisher-imprint-event';
      console.log(`[strip1-variant-routing] routed publisher/imprint/event tokens to confirmedVariant: "${routedVariant}"`);
    }

    // GrailKey Commit N2 (2026-08-03, Spawn Brett Booth PC-anchor class)
    // — re-anchor the PC product once confirmedVariant is known, when the
    // initial anchor deprioritized a genuine variant-descriptor product in
    // favor of a base entry because confirmedVariant was still null at PC
    // lookup time (a decision made before its input existed — same class
    // as the printing-axis bug D1/D2 fixed). Retain-and-rescore, not a
    // second live query: fetchPricechartingPop/fetchPricechartingSales
    // (below, ~line 5400+) both key off priceCharting.id and run well
    // after this point, so reassigning priceCharting here rebinds ladder/
    // population/velocity/sold-pool automatically — no separate rebind
    // step needed. selectBestVariantCandidate (variantIdentity.js) is the
    // SAME scoring function the base PC-anchor path already trusts when
    // no base entry survives at all — reused here, not reimplemented, for
    // the case a base entry DID survive and won only by default.
    if (confirmedVariant && priceCharting?.deferredVariantCandidates?.length > 0) {
      const bestVariant = selectBestVariantCandidate(priceCharting.deferredVariantCandidates, confirmedVariant);
      const variantScore = bestVariant ? variantTokenOverlapScore(confirmedVariant, bestVariant.productName) : 0;
      if (bestVariant && variantScore > 0) {
        console.log(
          `[n2-reanchor] re-anchoring PC product: "${priceCharting.productName}" (id=${priceCharting.id}) -> ` +
          `"${bestVariant.productName}" (id=${bestVariant.id}) — confirmedVariant="${confirmedVariant}" ` +
          `matched ${variantScore} token(s)`
        );
        priceCharting = { ...bestVariant, variantReanchored: true };
        out.pcVariantReanchored = true;
      } else {
        console.log(
          `[n2-reanchor] confirmedVariant="${confirmedVariant}" known, but no deferred candidate scored a match — ` +
          `keeping base entry "${priceCharting.productName}"`
        );
      }
    }

    // Step 2b: year-dependent lookups using confirmedYear.
    mark('phase2_start');

    // Ship 26.2 — Gate Phase 2 when identity refused
    //
    // Q133 Slice 2 (C1 promotion, 2026-07-21) — this used to be an
    // unconditional hard wall for EVERY refused-identity-conflict book,
    // regardless of how strongly the pool itself corroborated its own
    // provisional identity. Real cases (Pop Kill Rachta Lin: 3-member
    // family; Pop Kill Lozano: 17-member family) had their title/issue
    // ALREADY correctly resolved to the pool's own identity (Q131,
    // resolveIdentity) — but Phase 2 (the real fetchComps/
    // fetchPricechartingSales calls) never even ran, so the only price
    // ever shown was buildIdentityRefusedFallbackPool's median of the
    // 20-item VISUAL pool's own listing prices — a much thinner signal
    // than a real comps.js query would produce.
    //
    // promotionEligible reuses the SAME >=3-member floor
    // applyDualAxisGate's weighted-consensus path already trusts elsewhere
    // in this file ("Q38: Require >=3 members for weighted-consensus
    // override") — not a new, independently-tuned number. Below that floor
    // (Eternus #2: 2 members) the pool is exactly the "thin/incidental
    // noise" case Q127's original rationale was built around — stays on
    // today's early-return path, byte-identical.
    const identityRefusedTopFamily = familyCandidate?.topFamily;
    // Track B Phase 0, Commit 4.3 (Section E, revised — shared custody
    // invariant, 2026-07-30) — call site 1 of 4 (promotion). Confirmed
    // live: this promotion branch used a family's own coherent evidence
    // to justify "PROMOTED" while confirmedIssue/pricingIssue had
    // separately drifted to an unrelated issue (a raw-pool plurality,
    // pre-Commit-4.3) — Phase 2 then queried, cached, and priced that
    // unrelated issue under the family's banner. Checked BEFORE the
    // >=3-member floor decides eligibility so a genuine mismatch can
    // never reach promotion regardless of family size. Passes
    // identity?.familyIssueConsensus directly — the decide-result shape
    // (authoritativeForCustody/resolvedValue), never reconstructed from
    // `.mode` — see checkCrossPopulationPromotionGuard's own doc comment
    // (issueAuthority.js).
    const crossPopulationPromotionCheck = checkCrossPopulationPromotionGuard(
      identity?.familyIssueConsensus, { confirmedIssue, pricingIssue }
    );
    if (!crossPopulationPromotionCheck.allowed) {
      out.crossPopulationPromotionBlocked = crossPopulationPromotionCheck.conflict;
      console.log(
        `[commit4.3] cross-population promotion blocked: reason=${crossPopulationPromotionCheck.conflict.reason} ` +
        `selectedFamilyIssue=${crossPopulationPromotionCheck.conflict.selectedFamilyIssue ?? 'null'} ` +
        `mismatchedField=${crossPopulationPromotionCheck.conflict.mismatchedField} ` +
        `mismatchedValue=${crossPopulationPromotionCheck.conflict.mismatchedValue ?? 'null'}`
      );
    }
    const identityRefusedPromotionEligible = identityRefused && !!identityRefusedTopFamily &&
      identityRefusedTopFamily.count >= 3 && crossPopulationPromotionCheck.allowed;
    // Stashed here (not inside the early-return branch below) so it's still
    // in scope ~4000 lines later, near computeDecision — used ONLY as a
    // last-resort if a promoted card's real Phase 2 fetch comes back with
    // zero comps (out.price stays null): real data beats no data, but no
    // data still beats an empty LOCKED card.
    let refusalFallbackForPromoted = null;

    if (identityRefused) {
      // Q131 — when resolveIdentity surfaced the pool's own top family as a
      // provisional identity (Eternus #2 / He-Man class: pool unanimous,
      // Vision zero-overlap and proven inconsistent), use IT for the card's
      // title/issue instead of blindly echoing req.body's Vision guess back.
      // Still LOCKED/advisory below — this is "show the stronger real
      // signal, clearly flagged," never a silent confidence upgrade.
      const isProvisionalFamilyIdentity = identityIsProvisionalOverride;

      // Q110 dispatch Part 2 (2026-07-18, Siege #3 class) — was a hard
      // refusal (price/comps nulled) even when Phase 1 already fetched a
      // usable visualResult pool. Transformers Universe #1's tier-4 visual-
      // pool fallback (Ship 11, below) never got a chance to run here
      // because this early return happens ~2,800 lines earlier and
      // discarded visualResult entirely. Reuses Ship 11's exact median/P25/
      // P75 formula (same threshold: >=10 raw items, >=5 valid prices) so
      // every card reaches at minimum this fallback tier before showing a
      // blank price — no new pricing logic, same tested computation.
      // Q131 — see buildIdentityRefusedFallbackPool docstring (identityCore.js).
      const {
        fallbackPrice, fallbackLow, fallbackHigh, fallbackPoolSize,
        isolatedToFamily: fallbackIsolatedToFamily,
      } = buildIdentityRefusedFallbackPool(visualResult?.items, familyCandidate);
      if (fallbackPrice != null) {
        console.log(
          `[phase2] identity-refused fallback: ${fallbackPoolSize} ` +
          `${fallbackIsolatedToFamily ? `"${familyCandidate.topFamily.title}"-family` : 'visual-pool'} prices ` +
          `→ median=$${fallbackPrice} range=$${fallbackLow}-$${fallbackHigh}`
        );
      }

      if (identityRefusedPromotionEligible) {
        // Q133 Slice 2 — do NOT take the early return. confirmedTitle/
        // confirmedIssue/confirmedYear/confirmedPublisher are already the
        // pool's provisional identity (Q131, resolveIdentity ran long
        // before this point) — let Phase 2 run normally with them, exactly
        // like any other card, and let computeDecision run at the very end
        // as usual. Card stays LOCKED/RESEARCH via the SAME
        // listingHardLocked mechanism Q110 already built, not a new state.
        console.log(
          `[phase2] PROMOTED — identity refused but pool family has ` +
          `${identityRefusedTopFamily.count} members (>=3 floor) — ` +
          `running Phase 2 with the pool's provisional identity instead of the thin visual-pool-only fallback`
        );
        out.identityProvisional = true;
        out.listingHardLocked = true;
        out.listingHardLockReason = 'identity-unresolved';
        // Provisional banner text — overwritten below (near computeDecision)
        // once we know whether Phase 2 actually found real comps or not;
        // this is the fallback wording if somehow neither branch fires.
        out.listingHardLockBanner = out.crossPopulationPromotionBlocked
          ? `Visual pool evidence points to #${out.crossPopulationPromotionBlocked.selectedFamilyIssue}, but ${out.crossPopulationPromotionBlocked.mismatchedField} was about to use #${out.crossPopulationPromotionBlocked.mismatchedValue} — blocked pending verification`
          : isProvisionalFamilyIdentity
          ? `Provisional ID from visual pool: "${confirmedTitle}" #${confirmedIssue} — AI read "${req.body.title}" instead, but the visual pool unanimously disagrees — verify before listing`
          : familyCandidate?.reason
          ? `Visual identification uncertain — ${familyCandidate.reason} — verify before listing`
          : 'Visual identification uncertain — verify before listing';
        // Q134 dispatch (2026-07-21) — the AI condition-report text (item.
        // reason) was generated at scan time, BEFORE this identity
        // resolution ever ran — it can and does narrate the AI's original
        // (now-rejected) read (wrong title/issue/variant mentioned inline).
        // No code path can rewrite that freeform text after the fact, so
        // per I13 this is an ANNOTATION only, reusing the same banner
        // pattern/wording style — never a rewrite or suppression of the
        // text itself. Gated on isProvisionalFamilyIdentity specifically
        // (not the broader out.identityProvisional, which also covers the
        // general non-provisional promoted sub-case where confirmedTitle
        // still legitimately equals Vision's own read — no mismatch to
        // warn about there).
        if (isProvisionalFamilyIdentity) {
          out.conditionReportAdvisory =
            'This report was generated under the AI\'s original identification, ' +
            'which the visual pool disagrees with — details it mentions (title, issue, variant) may not match the confirmed identity above.';
        }
        refusalFallbackForPromoted = fallbackPrice != null
          ? { fallbackPrice, fallbackLow, fallbackHigh, fallbackPoolSize, fallbackIsolatedToFamily, topFamilyTitle: identityRefusedTopFamily.title }
          : null;
        // fall through — Phase 2 runs normally below, NOT skipped.
      } else {

      console.log(
        crossPopulationPromotionCheck.allowed
          ? `[phase2] SKIPPED — identity refused by title-family clustering (${identityRefusedTopFamily?.count ?? 0} member(s), below the >=3 promotion floor)`
          : `[phase2] SKIPPED — identity refused, promotion blocked by cross-population guard (${identityRefusedTopFamily?.count ?? 0} member(s), otherwise above the >=3 floor)`
      );

      // FIX 1: Include backfilled year/publisher in refused response
      // (backfillFromComps ran at line 1990, may have set confirmedYear/confirmedPublisher)
      const refusedOut = {
        ...sanitizeIdentityFields(req.body),
        // Override with backfilled values (if available)
        year: confirmedYear || req.body.year,
        publisher: confirmedPublisher || req.body.publisher,
        // Q131 follow-up — for the provisional-override path, year/publisher
        // must NOT fall back to req.body (that's the client-submitted
        // Vision guess this exact identity already rejected — the same bug
        // shape the title/issue override two lines below already fixes).
        // confirmedYear/confirmedPublisher are honestly null here when
        // unconfirmed (see resolveIdentity), not silently backfilled.
        ...(isProvisionalFamilyIdentity
          ? { title: confirmedTitle, issue: confirmedIssue, year: confirmedYear, publisher: confirmedPublisher }
          : {}),
        identitySource: identitySource || 'vision',
        identityProvisional: isProvisionalFamilyIdentity,
        // Slice 7 — refusedOut spreads from req.body, not `out`, above;
        // stamped explicitly here (rather than relying on the spread) so
        // this path is correct regardless of whether sanitizeIdentityFields
        // preserves unrecognized keys.
        scanId,
        // Q134 dispatch — same freeform-text caveat as the promoted branch
        // above: item.reason was written before this identity resolution
        // ran and may still narrate the AI's original (rejected) read.
        conditionReportAdvisory: isProvisionalFamilyIdentity
          ? 'This report was generated under the AI\'s original identification, ' +
            'which the visual pool disagrees with — details it mentions (title, issue, variant) may not match the confirmed identity above.'
          : null,
        yearBackfilledFromComps: out.yearBackfilledFromComps || false,
        yearBackfillRatio: out.yearBackfillRatio || 0,
        yearBackfillSource: out.yearBackfillSource || null,
        publisherBackfilledFromComps: out.publisherBackfilledFromComps || false,
        pcTokenExpired: out.pcTokenExpired || false,
        refusalReason: familyCandidate?.reason || 'Visual pool families lack overlap with Vision',
        message: familyCandidate?.reason || 'Visual identification uncertain',
        priceCharting: null,
        comicVine: null,
        comps: null,
        soldComps: null,
        // Q131 — explicit, not omitted. [22c] already demoted this to LOW
        // above; carrying it forward (rather than leaving the key absent,
        // which a client-side `enrich.X || cur.X` merge could backfill from
        // a stale prior-scan HIGH value) is what actually closes the "HIGH
        // badge next to a refused identity" gap end to end.
        convergence: out.convergence || null,
        familyCandidateDiagnostic: familyCandidate ? {
          decision: familyCandidate.decision,
          topFamily: familyCandidate.topFamily,
          runnerUp: familyCandidate.runnerUp,
          families: familyCandidate.families
        } : null,
        // Track B Phase 0, Commit 4.3 (Section E) — I13: annotate, never
        // silently drop. This early-return path builds refusedOut
        // separately from `out` (sanitizeIdentityFields(req.body) base),
        // so the guard's own conflict object (set on `out` earlier in
        // this handler) must be threaded through explicitly or it never
        // reaches the response on this exit.
        crossPopulationPromotionBlocked: out.crossPopulationPromotionBlocked || null,
        // Advisory, not a wall — LOCKED state (responseContract.js) shows
        // whatever price/range was computed above and gates only listing.
        listingHardLocked: true,
        listingHardLockReason: 'identity-unresolved',
        listingHardLockBanner: isProvisionalFamilyIdentity
          ? `Provisional ID from visual pool: "${confirmedTitle}" #${confirmedIssue} — AI read "${req.body.title}" instead, but the visual pool unanimously disagrees — verify before listing`
          : familyCandidate?.reason
          ? `Visual identification uncertain — ${familyCandidate.reason} — verify before listing`
          : 'Visual identification uncertain — verify before listing',
        confidenceLevel: 'LOW',
        ...(fallbackPrice != null
          ? {
              price: fmtUsd(fallbackPrice),
              priceLow: fmtUsd(fallbackLow),
              priceHigh: fmtUsd(fallbackHigh),
              priceBands: {
                quick: fallbackLow, market: fallbackPrice, stretch: fallbackHigh,
                source: fallbackIsolatedToFamily ? 'visual_pool_family_isolated' : 'visual_pool_fallback',
                count: fallbackPoolSize,
              },
              pricingSource: fallbackIsolatedToFamily ? 'visual_pool_family_isolated' : 'visual_pool_fallback',
              priceNote: fallbackIsolatedToFamily
                ? `Estimated from ${fallbackPoolSize} listings matching the pool's own "${familyCandidate.topFamily.title}" family — identity unconfirmed, verify before listing.`
                : `Estimated from ${fallbackPoolSize} visually similar active listings — identity unconfirmed, verify before listing.`,
              visualPoolUsed: true,
              visualPoolSize: fallbackPoolSize,
              visualPoolIsolatedToFamily: fallbackIsolatedToFamily,
            }
          : {
              // Genuinely nothing to fall back to (thin visual pool too) —
              // this is the "truly zero data" case the ruling still reserves
              // for an honest no-price state, not a refusal wall.
              price: null,
              priceLow: null,
              priceHigh: null,
              priceBands: null,
              pricingSource: null,
              priceNote: 'No comp or visual-similarity data available for this identification.',
            }),
      };
      // A6 dispatch — pipelineAudit on the refused exit. This branch never
      // ran the main terminal invariant check (it returns before Phase 2's
      // pricing/decision code), and title-family clustering never reached
      // adoption (below the >=3 promotion floor) — familyIssueConsensus is
      // honestly null, not fabricated. decision is genuinely null too:
      // finalizeResponse's syncDecisionToContract no-ops when out.decision
      // was never set, which is exactly the case here (this path never
      // calls computeDecision).
      logTitleStripSummary();
      refusedOut.pipelineAudit = buildPipelineAudit({
        traceId: pipelineTraceId,
        buildSha: buildId,
        identityRevision: pipelineIdentityRevision,
        familyIssueConsensus: null,
        familyKey: null,
        pricingIssue,
        confirmedIssue,
        outIssue: refusedOut.issue ?? null,
        prePricingOk: pricingIssue === confirmedIssue,
        preResponseOk: (refusedOut.issue ?? null) === (confirmedIssue ?? null),
        decision: null,
      });
      // Ship #24a-2: refusedOut retired as a separate SHAPE — same fields
      // flow, plus the canonical contract block.
      return res.status(200).json(finalizeResponse(refusedOut));
      } // end else (below-floor: unpromoted, early-return path)
    } // end if (identityRefused)

    // Book-level comps cache — skip 5-9s eBay fetch on refresh.
    // Comps stored on book record with timestamp, 6-hour TTL.
    // Survives Vercel cold starts (in-memory cache does not).
    const COMPS_BOOK_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
    const bookCompsCachedAt = req.body?.compsCachedAt || null;
    const bookCompsAge = bookCompsCachedAt ? now - bookCompsCachedAt : null;
    // Q89-CACHE: the cached active pool is a FILTERED result — a comp-filter
    // fix (MERCH_RE etc.) must invalidate it. Book cache is only trusted
    // when the record was built with the current filter version; old
    // records (no version) refetch once and get stamped.
    const useBookCompsCache = bookCompsCachedAt &&
                                bookCompsAge < COMPS_BOOK_CACHE_TTL &&
                                req.body?.activeCached &&
                                req.body?.soldCompsRawCached &&
                                req.body?.compFilterVersion === COMP_FILTER_VERSION;

    const compsPromise =
      useBookCompsCache
        ? (async () => {
            console.log(`[comps-cache] HIT from book record, age=${Math.round(bookCompsAge/60000)}min`);
            return req.body.activeCached;
          })()
        : process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID
        ? (async () => {
            // Q89-CACHE: version-salted — a filter fix (MERCH_RE) must not
            // replay pools filtered by the old regex (Evil Ernie class).
            // Track B Phase 0, Commit 3, Safeguard 2 amendment — calls the
            // extracted, exported buildActiveCompCacheKey (below in this
            // file) instead of an inline template string, so this real
            // production call site and this feature's tests build the
            // IDENTICAL key (invariant 10). Closes the gap where Safeguard
            // 2's normalization chain (workingIdentity -> effectiveTitle/
            // effectiveIssue -> confirmedTitle/confirmedIssue) was proven
            // up to confirmedIssue but never exercised through to the
            // actual cache key a corrected request would read/write under.
            const activeKey = buildActiveCompCacheKey(COMP_FILTER_VERSION, confirmedTitle, confirmedIssue);
            // Commit B.1 (Strange Tales dispatch) — no `title|null` keys in
            // the exact-pricing `ac:` cache namespace. A null confirmedIssue
            // means genuinely unresolved identity — a key built from that
            // would be a title-only bucket any future request for the same
            // title could collide on, regardless of which (or whether any)
            // issue that later request actually resolves to. Reads AND
            // writes are both skipped entirely when confirmedIssue is null
            // — this pool is fetched fresh every time, never cached under
            // this namespace. (A separate similar-title research
            // namespace, e.g. `similar:v1:<title>|<approximateEra>`, may
            // exist for informational/UI purposes per item B.1's own
            // wording — but it is never read from here, and never feeds
            // this exact-pricing path.)
            // Track B Phase 0, Commit 4 (2026-07-29) — extends the same
            // Commit B.1 containment surface: an issue whose ONLY authority
            // is a marketplace-only adoption (out.issueAuthority.status
            // 'provisional'/'conflicted', set above) is not yet trustworthy
            // enough to cache under. Caching it would let a genuinely-wrong
            // pool-adopted issue number poison the ac: namespace for every
            // future request against this title|issue pair for the TTL
            // window, including ones that arrive with real Vision/user
            // corroboration — same poisoning risk Commit B.1 already
            // guards against for the null-issue case, just one authority
            // tier up. Real call site for the extracted, exported
            // canUseExactIssuePricingCache (src/lib/issueAuthority.js).
            // Commit 4.1 (review round, item 2) — identityProvisionalFields
            // passed as a third argument so a trusted/corroborated issue
            // paired with a still-provisional (family-adopted-only) year is
            // also excluded from the exact-issue cache namespace, not just
            // an unconfirmed issue.
            // Track B Phase 0, Commit 4.3 (Section E/F, revised — shared
            // custody invariant) — call site 2 of 4 (exact-cache access).
            // Independent, additional layer alongside the existing
            // canUseExactIssuePricingCache gate (which already correctly
            // blocks this namespace whenever out.issueAuthority.status is
            // 'provisional' — the Commit 4.3 retention branch's own legacy-
            // mode mapping already routes here for the Spawn fixture) — a
            // genuine belt-and-suspenders check for any FUTURE code path
            // that might set confirmedIssue without going through the
            // issueAuthority-provisional signal.
            const cacheCustodyCheck = checkCrossPopulationPromotionGuard(
              identity?.familyIssueConsensus, { cacheIssue: confirmedIssue }
            );
            if (!cacheCustodyCheck.allowed) {
              console.log(
                `[commit4.3] exact-cache custody blocked: selectedFamilyIssue=${cacheCustodyCheck.conflict.selectedFamilyIssue} ` +
                `cacheIssue=${cacheCustodyCheck.conflict.mismatchedValue}`
              );
            }
            const exactPricingCacheEligible = canUseExactIssuePricingCache(confirmedIssue, out.issueAuthority, out.identityProvisionalFields)
              && cacheCustodyCheck.allowed;
            if (!exactPricingCacheEligible) {
              const yearOnlyGate = (out.identityProvisionalFields || []).includes('year') &&
                out.issueAuthority?.status !== 'provisional' && out.issueAuthority?.status !== 'conflicted';
              console.log(
                confirmedIssue == null
                  ? `[active-cache] SKIP: confirmedIssue is null — no title|null key in the ac: namespace (Commit B.1)`
                  : !cacheCustodyCheck.allowed
                    ? `[active-cache] SKIP: custody invariant blocked (see [commit4.3] line above)`
                    : yearOnlyGate
                    ? `[active-cache] SKIP: identityProvisionalFields includes 'year' (family-adopted-only) — not cached even though issue itself is trusted (Commit 4.1)`
                    : `[active-cache] SKIP: issueAuthority.status="${out.issueAuthority?.status}" — marketplace-only-adopted issue not cached (Commit 4)`
              );
            }
            // CACHE-BUST: skipCache flag bypasses poisoned cache entries
            const skipCache = req.body?.skipCache === true || !exactPricingCacheEligible;
            const cached = !skipCache ? await kvGet(`ac:${activeKey}`) : null;
            if (cached) {
              console.log(`[active-cache] HIT: ${activeKey}`);
              // Q92: kvSet stores the fetchComps result DIRECTLY — the
              // `{ data, expires }` wrapper died with the in-memory cache
              // (dfbb959). `cached.data` was undefined on every KV HIT →
              // active pool 0/0 → refused-no-data-sources on any refresh
              // within the 1h TTL of a successful scan.
              return cached;
            }
            if (skipCache) {
              console.log(`[active-cache] SKIP: ${activeKey} — skipCache=true`);
            }
            console.log(`[comps-cache] MISS — fetching from eBay`);
            // Commit A.1/A.3 (Strange Tales dispatch) — terminal
            // single-writer guard: confirmedIssue is the ONLY authority
            // for whether this query may carry an issue term. No upstream
            // branch (family-candidate rebuild, fallback-vision, variant-
            // scan reselect, the Pattern-J rawTitle-issue-mismatch guard)
            // is trusted to have already correctly nulled/synced
            // imageSearchTitle — this is the one terminal check,
            // positioned immediately at the actual query-construction call
            // site so a future upstream branch can't bypass it. See
            // enforceQueryIssueAuthority's own doc comment
            // (identityCore.js) for the full root-cause trace.
            const preAuthorityImageSearchTitle = imageSearchTitle;
            imageSearchTitle = enforceQueryIssueAuthority(imageSearchTitle, confirmedIssue);
            if (preAuthorityImageSearchTitle && imageSearchTitle !== preAuthorityImageSearchTitle) {
              console.log(
                `[commitA-terminal] discarded stale/conflicting imageSearchTitle ` +
                `"${preAuthorityImageSearchTitle}" (confirmedIssue="${confirmedIssue}") before comps fetch`
              );
            }
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
              labelType: confirmedLabelType,  // Q100 FIX-A — gates auth tokens; Q106 FIX-1 — CGC-confirmed label when available
              creator: req.body.creator || null,
              publisher: publisher || null,
              imageSearchTitle,
              appId: process.env.EBAY_APP_ID,
              certId: process.env.EBAY_CERT_ID,
              // Session 4B — adapter-aware comp queries (book category 267, comic 259104)
              categoryId: getAdapter(out.assetType).ebayCategoryId,
              assetType: out.assetType,
              author: out.author || null,  // book identity field for buildBookQuery
              cvVolumeStartYear: comicVine?.startYear || null,  // Q128 — volume-label-year corroboration (Harley Quinn #62 class). NOT comicVine?.volume?.startYear — that shape is always undefined (comicVine.volume is a flat string); .startYear is the correct top-level field.
              artistOverride: extractArtist(confirmedTitle) || null,  // Q136 Slice A — the RESOLVED identity's own artist (e.g. a provisional pool's confirmedTitle already naming "Alexander Lozano"), independent of extractConfirmedVariant's majority-ratio ceiling.
              signedConsensus: confirmedSignedConsensus,  // Slice C — pool-corroborated "our book is signed" signal (extractConfirmedVariant), for Filter 2b's isolate-vs-reject branch.
              // Track B Phase 0, Commit 4 (presence-threading correction) —
              // two primitives, not one collapsed scalar: issueAuthorityPresent
              // (does an authority object exist at all?) is threaded
              // SEPARATELY from issueAuthorityStatus (its .status value, if
              // present). A bare `out.issueAuthority?.status || null` collapses
              // "no issueAuthority object at all" (legacy, safe) and "an
              // issueAuthority object exists but .status is somehow null/
              // undefined" (a malformed present record) into the identical
              // `null` value once it crosses into evidenceTarget — the
              // classifier could no longer tell them apart. See
              // classifyEvidenceRow's gate (evidenceEligibility.js) for how
              // both primitives are actually used together.
              issueAuthorityPresent: out.issueAuthority != null,
              issueAuthorityStatus: out.issueAuthority?.status ?? null,  // Track B Phase 0, Commit 4 — TARGET_ISSUE_PROVISIONAL_AUTHORITY gate (evidenceEligibility.js)
            }).catch((err) => {
              console.error('[enrich] comps error stack:', err?.stack);
              console.error(`[enrich] comps error: ${err?.message || err}`);
              return null;
            });
            // FIX: Never cache empty/null active-comps results (prevents cache poisoning)
            // Amazing Adventures #3: bad empty value cached → replayed on every request
            // → blocked FIX 1 blend-override from ever having real data.
            if (result && result.count > 0 && exactPricingCacheEligible) {
              await kvSet(`ac:${activeKey}`, result, KV_TTL.ACTIVE);
              console.log(`[active-cache] MISS: ${activeKey} — cached ${result.count} comps`);
            } else if (!exactPricingCacheEligible) {
              console.log(
                confirmedIssue == null
                  ? `[active-cache] MISS: ${activeKey} — NOT caching (confirmedIssue null, Commit B.1)`
                  : `[active-cache] MISS: ${activeKey} — NOT caching (issueAuthority.status="${out.issueAuthority?.status}", Commit 4)`
              );
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

        // Q-pool-truncation [P0, 2026-07-16, Option B]: rawComps.prices is
        // the FULL pool (30 items for Groo the Wanderer #1's real trace),
        // but verifyCount/keepFlags only ever cover the ≤5-item
        // recentSales display sample (documented, deliberate cost
        // control — see comment above). The old
        // `rawComps.prices.filter((_, i) => keepFlags[i])` iterated the
        // full array with a ≤5-length keepFlags, silently dropping every
        // item past index 4 regardless of whether AI-verify ever saw it —
        // a 30-item pool collapsed to ≤5 on any scan that triggered
        // AI-verify at all. Only the first verifyCount items were ever
        // evaluated; only those should be filtered. Everything after
        // passes through untouched — it was never suspect, never checked.
        const verifiedFirstN = rawComps.prices
          .slice(0, verifyCount)
          .filter((_, i) => keepFlags[i]);
        const untouchedRest = rawComps.prices.slice(verifyCount);
        const verifiedPricesArray = Array.isArray(rawComps.prices)
          ? [...verifiedFirstN, ...untouchedRest]
          : [];

        // count/average/lowest/highest must reflect the same full,
        // corrected pool (verifiedPricesArray), not just the ≤5-item
        // checked-and-kept sample (verifiedPrices/verifiedCount below,
        // which stay scoped to "what AI-verify actually evaluated" for
        // aiVerifyFallback/compsExhausted — unchanged, see below).
        const fullVerifiedPrices = verifiedPricesArray
          .map((p) => p.price)
          .filter(Boolean);
        const fullVerifiedCount = fullVerifiedPrices.length;
        const fullVerifiedAvg = fullVerifiedCount
          ? fullVerifiedPrices.reduce((a, b) => a + b, 0) / fullVerifiedCount
          : null;
        const fullVerifiedLow = fullVerifiedCount
          ? Math.min(...fullVerifiedPrices)
          : null;
        const fullVerifiedHigh = fullVerifiedCount
          ? Math.max(...fullVerifiedPrices)
          : null;

        rawComps = {
          ...rawComps,
          prices: verifiedPricesArray,
          recentSales: verifiedSales,
          count: fullVerifiedCount,
          average: fullVerifiedAvg,
          averageFormatted: fmtUsd(fullVerifiedAvg),
          lowest: fullVerifiedLow,
          lowestFormatted: fmtUsd(fullVerifiedLow),
          highest: fullVerifiedHigh,
          highestFormatted: fmtUsd(fullVerifiedHigh),
          verifiedByAI: true,
          verificationRemoved: removed,
          aiVerifyFallback,
          // Q-gradeFilteredLowest-staleness [P1, 2026-07-16]: this spread
          // otherwise carries .gradeFilteredLowest forward unchanged — a
          // snapshot taken mid-filter-chain in api/comps.js, BEFORE this
          // AI-verify pass ever ran. When AI-verify rejects a comp that was
          // within that grade-proximity snapshot, the stale value can sit
          // below the freshly-verified .lowest. (NOT the Groo the Wanderer
          // #1 case cited in earlier investigation notes — that scan's real
          // verificationRemoved was 0, so it doesn't exercise this branch;
          // its $4.77-vs-$7.99 discrepancy traced to a separate pool-
          // truncation issue, not AI-verify rejection. Verified against a
          // constructed removed=1 case instead — see commit message.) All
          // four current consumers (Finding A's floor guard,
          // computeThinPoolAnchor, computeLowGradeFloor, and any future one
          // following the same pattern) already do
          // `rawComps.gradeFilteredLowest ?? rawComps.lowest` — null here
          // routes them onto that existing, already-correct fallback
          // instead of the stale snapshot.
          gradeFilteredLowest: removed > 0 ? null : rawComps.gradeFilteredLowest,
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

      // Q116 dispatch (2026-07-18, Incredible Hulk #377 class) — when
      // Vision's reason text named a SPECIFIC printing number (or
      // facsimile), isolate comps to that exact printing rather than an
      // undifferentiated "any reprint" bucket that mixes 2nd print, 3rd
      // print, and facsimile comps together — the same "generic signal
      // used where a specific one already exists" class as tonight's
      // other fixes (Q111 variant-token collapse). editionWarning.signals
      // already classifies this (EDITION_WARNING_PATTERNS, api/grade.js);
      // it was just never consumed for isolation, only for the pass/fail
      // gate below. Falls back to the original generic match when only a
      // generic signal fired (reprint/later-printing/not-first-print/
      // not-original/less-valuable, no specific number) — genuinely
      // unknown which printing then, generic isolation remains the best
      // available signal, unchanged from before this fix.
      const specificPrinting = classifySpecificPrinting(editionWarning.signals);
      if (specificPrinting) {
        console.log(`[edition-gate] specific printing kind detected (${specificPrinting.text}) — isolating to matching comps only`);
      }

      const reprintComps = (rawComps?.prices || []).filter((c) =>
        specificPrinting
          ? specificPrinting.re.test(String(c.title || ''))
          : /reprint|facsimile|2nd\s*print|3rd\s*print|loot.?crate|millennium/i.test(
              String(c.title || '')
            )
      );
      if (reprintComps.length < 3) {
        out.price = null;
        out.priceBands = null;
        out.pricingSource = 'refused-reprint-thin-pool';
        out.priceNote = specificPrinting
          ? `${specificPrinting.label} detected — insufficient printing-specific comps`
          : 'Reprint edition detected — insufficient reprint-specific comps';
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
    //
    // Q142 instance 2 fix (2026-07-22, Adventure Time Summer Special class)
    // — this site's defect was its CONSENSUS REFERENCE, not just its
    // population size: rawComps.prices at this point in the pipeline is
    // not guaranteed to be the same clean, family-matched set the final
    // card displays (it can carry broader-query-attempt fallback noise) —
    // "summer"/"special" scored <60% against it despite being the winning
    // family's own 100%-overlap canonical tokens. When an accepted family
    // override exists, the winning family — the SAME population Phase 1
    // above already established as the correct reference, reused via the
    // outer-scoped winningFamilyTitles rather than a second, independently
    // driftable copy — IS the consensus baseline, not rawComps.prices.
    // This still guards genuine assembly corruption (the check itself,
    // checkAssemblyIntegrity, is untouched) — it changes what population
    // it's validated against, not whether it runs. Falls back to
    // rawComps.prices exactly as before for every non-override path.
    const phase2UseFamily = winningFamilyTitles && winningFamilyTitles.length >= 3;
    const phase2CompTitles = phase2UseFamily
      ? winningFamilyTitles
      : (rawComps?.prices?.length >= 3 ? rawComps.prices.map(p => p?.title).filter(Boolean) : null);
    if (!out.assemblyIntegrityFailed && phase2CompTitles && phase2CompTitles.length >= 3 && identitySource !== 'vision') {
      console.log(
        `[22e-population] Phase 2 mode=${phase2UseFamily ? 'winning-family' : 'full-pool'} ` +
        `count=${phase2CompTitles.length}`
      );
      const phase2Check = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, phase2CompTitles);
      if (phase2Check.shouldFallback && phase2Check.reason === 'excess-non-consensus-tokens') {
        console.log(
          `[22e-LOSS] Phase 2 FORCED vision="${effectiveTitle}" rejected="${confirmedTitle}" ` +
          `non-consensus=[${phase2Check.added.join(',')}]`
        );
        confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, effectiveTitle, titleSource, 'vision', '22e-LOSS');
        titleSource = 'vision';
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
    let rawSoldRows = (pcSales?.soldComps?.length || 0) > 0
      ? pcSales.soldComps
      : (Array.isArray(soldResult) ? soldResult : []);
    // Q91: sold-retention — a pc-sales dropout (KV MISS + fetch fail → 0
    // rows) must not demote tier and RAISE price. ASM #112: tier-1
    // (26 solds, $29.50) → tier-3 (0 solds, $47.44) across refreshes.
    // When the fresh fetch returns nothing but the book record carried a
    // prior raw sold pool (≥5 rows), retain it with a stale flag; the
    // verify chain re-runs on the retained rows so the verified pool is
    // reproduced, and recency weighting naturally decays old dates.
    let q91SoldRetention = false;
    if (rawSoldRows.length === 0) {
      const priorRawSold = Array.isArray(req.body?.soldCompsRawCached)
        ? req.body.soldCompsRawCached
        : [];
      if (priorRawSold.length >= 5) {
        rawSoldRows = priorRawSold;
        q91SoldRetention = true;
        console.log(
          `[Q91] sold-retention: fresh fetch returned 0 solds — ` +
          `retained ${priorRawSold.length} prior raw rows (stale)`
        );
      }
    }
    const userGradeKeyForSold =
      isGraded === true && numericGrade != null
        ? (Number.isInteger(numericGrade)
            ? `${numericGrade}.0`
            : String(numericGrade))
        : 'raw';
    const soldVerifyResult = verifySoldComps(rawSoldRows, {
      title: confirmedTitle,
      issue: confirmedIssue,
      variant: confirmedVariant,
      publisher,
      bookYear: confirmedYear || year,
      userGradeKey: userGradeKeyForSold,
      assessedGrade: grade, // Q47-FIX4: Vision/AI grade for raw scans (e.g. "FN 6.0")
      // Q109-LADDER (2026-07-16): PC's own per-grade price ladder, already
      // fetched and populated on `pcSales` by this point (see out.priceLadder
      // assignment later in this handler, same underlying data). Lets
      // verifySoldComps cross-check a raw scan's sold-comp prices against
      // PC's own grade-value data — independent of title text entirely.
      priceLadder: pcSales.priceLadder || null,
      cvVolumeStartYear: comicVine?.startYear || null,  // Q128 — same volume-label-year corroboration as active Filter 0c
      artistOverride: extractArtist(confirmedTitle) || null,  // Q136 Slice A — see the fetchComps call site above for the full reasoning
      labelType: confirmedLabelType,  // Slice C — graded-slab signature signal (CGC/CBCS SS yellow label), same field name as the fetchComps call site
      signedConsensus: confirmedSignedConsensus,  // Slice C — pool-corroborated "our book is signed" signal, same field name as the fetchComps call site
      // Track B Phase 0, Commit 4 (presence-threading correction) — same
      // two-primitive threading as the fetchComps call site above (see its
      // comment for the full reasoning): presence and status threaded
      // separately, never collapsed to one scalar before reaching
      // evidenceTarget.
      issueAuthorityPresent: out.issueAuthority != null,
      issueAuthorityStatus: out.issueAuthority?.status ?? null,  // Track B Phase 0, Commit 4 — TARGET_ISSUE_PROVISIONAL_AUTHORITY gate (evidenceEligibility.js), same field name as the fetchComps call site
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

    // Q84-AMENDED [22c-title-revote]: unanimous title-axis rejection alone
    // is NOT the trigger (Wonder Woman #75 had unanimous rejection and was
    // RIGHT). Trigger = unanimous non-vision rejection AND PC no-match AND
    // verified pool <3 — downstream failure confirms the identity is bad.
    // Then: revote confirmedTitle to the majority axis value and re-query
    // PC once. Comps are NOT re-fetched (single re-query per ruling).
    {
      const titleAxis = out.convergence?.axes?.title;
      const nonVisionVotes = (titleAxis?.votes || []).filter((v) => v.source !== 'vision');
      const unanimousRejection =
        nonVisionVotes.length >= 2 && nonVisionVotes.every((v) => v.agrees === false);
      const pcNoMatch = !(priceCharting && priceCharting.id);
      const verifiedPool = (rawComps?.count || 0) + (filteredSold?.length || 0);

      if (unanimousRejection && pcNoMatch && verifiedPool < 3) {
        // Majority axis value: the most common `got` among rejecting sources
        const gotCounts = {};
        (titleAxis.rejections || []).forEach((r) => {
          const g = String(r.got || '').trim();
          if (g) gotCounts[g] = (gotCounts[g] || 0) + 1;
        });
        const majority = Object.entries(gotCounts).sort((a, b) => b[1] - a[1])[0];
        if (majority && majority[0] && majority[0].toLowerCase() !== String(confirmedTitle || '').toLowerCase()) {
          const oldTitle = confirmedTitle;
          confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, majority[0], titleSource, 'title-axis-majority-rejection', '22c-title-revote');
          titleSource = 'title-axis-majority-rejection';
          out.titleRevotedFrom22c = true;
          out.needsReview = true;
          console.log(`[22c-title-revote] old="${oldTitle}" new="${confirmedTitle}" (unanimous rejection + PC no-match + pool=${verifiedPool})`);
          // Re-query PC once with the revoted title
          priceCharting = await lookupPriceCharting({
            title: confirmedTitle,
            issue: confirmedIssue,
            year: confirmedYear || year,
            // Q86: revote runs post-resolveYear — use resolved confidence
            yearConfidence: yearResolution?.yearConfidence || 'proven',
            eraHint: eraAdvisory,
            variant: confirmedVariant,  // Q108 CHANGE 2 — resolved by this point in the handler
            pcDiag: out,
          }).catch(() => null);
          if (priceCharting) {
            console.log(`[22c-title-revote] PC re-query matched: "${priceCharting.productName}"`);
            out.pcProductId = priceCharting.id || null;
            out.pcProductName = priceCharting.productName || null;
          } else {
            console.log('[22c-title-revote] PC re-query: no match — revoted title kept, pricing proceeds on pool');
          }
        }
      }
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
        // Q109-G — transparency: the multiplier table has no exact entry
        // for this grade, so the price reflects the nearest table grade's
        // multiplier instead. Surfaced on the card rather than left silent.
        if (gradeInfo.gradeFallback) {
          out.gradeMultiplierInterpolated = true;
          out.gradeMultiplierInterpolatedFrom = gradeInfo.grade;
        }
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
      variant: safeReqVariant,
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

    if (comicVine && cvConvergenceRejectedAxes.length > 0) {
      // FIX-3: convergence rejected CV on an identity axis — the volume is
      // the wrong book. Suppress from the card entirely (same pattern as
      // Q35 + polybag-cv-suppress; original preserved for debug).
      out.originalComicVine = comicVine;
      out.storySuppressedReason = `convergence-rejected:${cvConvergenceRejectedAxes.join(',')}`;
      console.log(
        `[22c] cv display suppressed — rejected on axes: ${cvConvergenceRejectedAxes.join(', ')}`
      );
    } else if (comicVine) {
      out.comicVine = comicVine;
      // TRACK B.1: Extract character_credits
      out.cvCharacterCredits = Array.isArray(comicVine.character_credits)
        ? comicVine.character_credits.map(c => ({ name: c.name, id: c.id }))
        : [];

      // GrailKey Dispatch 12 (2026-08-07) — ARTIST_PATTERNS registry-gap
      // detection, phase 1 (live, zero new API calls). ComicVine's
      // person_credits is already fetched (field_list above) and already
      // parsed into comicVine.personCredits ({name, role}[]) for display
      // purposes (claudeCheckData.creators) — this reads that same,
      // already-in-memory data to check each credited name against the
      // canonical creator registry. Nine registry additions in one week
      // across two discovery channels (five production incidents, four
      // from the reverse-direction sync test) established that one-at-a-
      // time addition doesn't converge; this is the third channel — real
      // credit data on every scan, logged for periodic batch review
      // rather than waiting for the next book to misfire.
      //
      // Deliberately logs ALL roles, not just artist/cover — this week's
      // own evidence (Alan Moore, Chris Claremont: both writers, both
      // bled into corrupted titles exactly like Jeff Smith/Cory Walker
      // did) shows role does not predict whether a name lands in a
      // seller's listing title. Detection only — no auto-classification,
      // no auto-add. The 'dekal'/'spears' artifacts are the standing
      // argument against ever trusting a mechanical "safe to add"
      // judgment; every gap this surfaces still needs a human collision
      // sweep before it becomes an ARTIST_PATTERNS entry.
      if (Array.isArray(comicVine.personCredits)) {
        for (const credit of comicVine.personCredits) {
          const name = credit?.name;
          if (!name || typeof name !== 'string') continue;
          const recognized = ARTIST_PATTERNS.some((re) => re.test(name));
          if (!recognized) {
            console.log(`[artist-registry-gap] name="${name}" role="${credit.role || 'unknown'}" not in ARTIST_PATTERNS (title="${confirmedTitle || title}" issue=${confirmedIssue || issue || '?'})`);
          }
        }
      }
    }

    // Ship #20a.6.18 — Variant identity fields (moved after out initialization)
    if (variantIdentitySource === 'ebay_image_consensus') {
      out.variantIdentitySource = variantIdentitySource;
      out.variantConsensus = variantConsensus;
      out.variantOverriddenVision = variantOverriddenVision;
    }

    // Ship #20b — Price bands (Quick/Market/Stretch) from tier-based pricing
    // Q109-B [2026-07-17]: gated on !out.refusedToPrice — an earlier refusal
    // (e.g. the reprint edition-gate above) must not be silently overwritten
    // by this unconditional tier-pricing recompute. Shared checkpoint for
    // every refusal site that fires before this block, not just this one.
    if (priceBandsRaw && !out.refusedToPrice) {
      out.priceBands = {
        quick: fmtUsd(priceBandsRaw.quick),
        market: fmtUsd(priceBandsRaw.market),
        stretch: fmtUsd(priceBandsRaw.stretch),
        source: priceBandsRaw.source,
        count: priceBandsRaw.count,
        tier: priceBandsRaw.tier,
        variantAdjusted: priceBandsRaw.variantAdjusted || false,
      };
      // D2 (Commit D2) — shared structured derivation trace, built once
      // inside computePriceBands (src/lib/priceBands.js) by whichever
      // tier actually fired. Surfaced verbatim, never recomputed here —
      // this IS the mathematically truthful record of how out.price was
      // derived, replacing the pcBase/multiplier/afterMult log line below
      // (which conflated an unrelated tier-1/2/2.5/3 result with a
      // pcBase×multiplier product that was never actually computed).
      out.priceDerivationTrace = priceBandsRaw.derivationTrace || null;

      // Tier-specific warnings
      if (priceBandsRaw.sanityCeilingWarning) {
        out.sanityCeilingWarning = priceBandsRaw.sanityCeilingWarning;
      }
      if (priceBandsRaw.askDerivedWarning) {
        out.askDerivedWarning = priceBandsRaw.askDerivedWarning;
      }
      // ASM #17 [P0, 2026-07-16]: active pool excluded from Tier-2 blend as
      // implausibly below the verified sold anchor (contamination flag).
      if (priceBandsRaw.activePoolSuspect) {
        out.activePoolSuspectWarning = priceBandsRaw.activePoolSuspectReason;
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

      // Q132 dispatch, Fix 3 (2026-07-20) — surface a disagreement between
      // this comp-pool creator consensus and whatever artist name Vision's
      // own free-text condition report (req.body.reason) happens to
      // mention. Two structurally separate pipelines that never cross-
      // check each other today (traced: req.body.reason is only consumed
      // by detectEditionWarning + display pass-through) — a card can show
      // one artist in its condition report while pricing against a
      // different artist's variant entirely. Real production case: the
      // SAME physical book's condition-report artist drifted three
      // separate ways across three scans ("Iana Nyx" → "Iana Anikyrie" →
      // "Jimenez") while the comp-pool consensus correctly said "David
      // Nakayama" all three times. Surfacing only — does not attempt to
      // resolve which artist is correct.
      const artistConflict = detectConditionReportArtistConflict(
        req.body?.reason,
        creatorResult.consensus.map((e) => e.canonical)
      );
      if (artistConflict) {
        out.artistIdentityConflict = artistConflict;
        console.log(
          `[artist-conflict] condition report names "${artistConflict.conditionReportArtist}" but ` +
          `comp-pool consensus says ${artistConflict.compPoolArtists.join(', ')} — surfacing, not resolving`
        );
      }
    }

    // Ship 6 retry — Polybag pricing flag. Set true by polybag detection
    // block below. When true, ALL downstream pricing blocks skip so
    // polybag price stands as final answer.
    // GL-2 (EX-5): Qualified/Restored/Conserved label detection.
    // Two channels: Vision labelType (req.body, new in GL-2) and the CGC
    // cert lookup (cgcResult.labelType — defense-in-depth when the cert
    // number is readable; was previously display-only as out.cgcLabel).
    // A green QUALIFIED or purple RESTORED label trades at a fraction of
    // blue-label Universal, and every comp source in this pipeline is
    // Universal — so pricing is not applicable at all.
    const IMPAIRED_LABEL_RE = /qualified|restored|conserved/i;
    const visionLabelType = String(labelType || '').toLowerCase();
    const certLabelType = String(cgcResult?.labelType || '');
    const isImpairedLabel =
      IMPAIRED_LABEL_RE.test(visionLabelType) || IMPAIRED_LABEL_RE.test(certLabelType);
    const impairedLabelClass =
      /restored/i.test(visionLabelType) || /restored/i.test(certLabelType)
        ? 'restored'
        : 'qualified';
    if (visionLabelType) out.labelType = visionLabelType;
    if (labelNotes) out.labelNotes = labelNotes;
    if (isImpairedLabel) {
      console.log(
        `[label-gate] impaired label detected: vision=${visionLabelType || 'null'} ` +
        `cgc=${certLabelType || 'null'} class=${impairedLabelClass}`
      );
    }

    let isPolybagPricing = false;

    // Q107 FIX-2 — Vision-confirmed reprint/facsimile is a hard abort
    // trigger, independent of the image-pool reprint-ratio signal below.
    // Q98 ruled that ratio a facsimile-LIKELIHOOD signal only (confounded —
    // facsimiles reproduce famous cover art exactly, so a cover-image search
    // on a famous key comes back facsimile-dominated regardless of what the
    // user actually holds). But when Vision itself, looking at the physical
    // book in hand, read explicit reprint/facsimile text/markings (not
    // cover-art inference), that is direct evidence and must abort
    // regardless of the PC-anchor divergence ratio checks below.
    const visionEditionType = String(req.body?.editionType || '').toLowerCase();
    const visionConfirmedReprint =
      req.body?.isReprint === true ||
      visionEditionType === 'reprint' ||
      visionEditionType === 'facsimile';

    if (visionConfirmedReprint) {
      // Q110 dispatch Part 1 (2026-07-18) — Vision-confirmed reprint/
      // facsimile becomes advisory, not a hard abort. Was: nulled price,
      // set refusedToPrice + isPolybagPricing=true, which ALSO suppressed
      // out.comps (the `!isPolybagPricing` gate at the comps-output write)
      // even though a real comp pool was already fetched. Now: the flag
      // stays visible via listingHardLocked (routes responseContract.js to
      // state=LOCKED — price/bands shown, only the List button is gated
      // pending verification). isPolybagPricing is deliberately NOT set
      // true here, so control falls through to the existing Ship-6 polybag
      // comp-pool pricing below (reprintRatio>=0.6 branch) and, failing
      // that, into the normal tier1-4 synthesis — both already-tested,
      // data-driven pricing paths, not new logic. The genuinely data-driven
      // divergence-abort branches further below (PC-anchor >10x conflict)
      // are untouched — those refuse on real evidence, not on this flag
      // alone, and stay out of scope per the dispatch's own framing.
      out.confidenceLevel = 'LOW';
      out.priceNote = 'Vision-confirmed reprint/facsimile — verify edition before pricing';
      out.listingHardLocked = true;
      out.listingHardLockReason = out.listingHardLockReason || 'vision-confirmed-reprint';
      out.listingHardLockBanner = out.listingHardLockBanner
        || 'Vision detected reprint/facsimile markings — verify edition before listing';
      out.polybagDetected = true;
      out.visionConfirmedReprint = true;
      out.visionEditionType = req.body?.editionType || null;
      console.log(
        `[polybag-advisory] Vision-confirmed reprint: isReprint=${req.body?.isReprint} ` +
        `editionType="${req.body?.editionType}" — advisory only, pricing proceeds`
      );
    }

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
    if (!isPolybagPricing && visualResult?.items?.length >= 5) {
      const itemsWithPrice = visualResult.items.filter(
        (i) => typeof i?.price === 'number' && i.price > 0
      );
      if (itemsWithPrice.length >= 5) {
        const reprintItems = itemsWithPrice.filter((i) =>
          REPRINT_RE.test(String(i.rawTitle || ''))
        );
        const reprintRatio = reprintItems.length / itemsWithPrice.length;

        if (reprintRatio >= 0.6) {
          // Q98 (ruled 2026-07-13): image-search reprint ratio is a
          // facsimile-LIKELIHOOD signal, never a pricing veto by itself.
          // Facsimiles reproduce iconic cover art exactly, so a cover-image
          // search on a famous key (X-Men #1, GSX #1) always comes back
          // facsimile-dominated regardless of what the user is actually
          // holding. Comparing PC's anchor against THIS pool's average
          // false-positived on both books: image-pool avg $26.13 / $17.86
          // vs their real comps.js pools (post reprint/sequel/era/slab
          // filters) of $11,329.50 / $1,674.91, both HIGH confidence.
          // Surfaced non-blocking so the UI can still show it as context.
          out.imagePoolFacsimileRatio = reprintRatio;
          console.log(
            `[image-pool] facsimile signal: ${reprintItems.length}/${itemsWithPrice.length} ` +
            `(${(reprintRatio * 100).toFixed(0)}%) reprint titles in cover-image matches — informational only`
          );

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

          // GL-3 (INV-3, ruled) + Q98 (ruled): >10x PC-anchor divergence
          // hard-abort — measured against the REAL filtered pricing pool,
          // not the raw image-search pool. Q98-BUG: out.price is NOT yet
          // assigned at this point in the handler — the tier-1 pipeline's
          // result only lands in out.price at line ~4223, well after this
          // block runs. The already-in-scope value is priceBandsRaw.market
          // (computed at line ~3491 by computePriceBandsFromSold, logged
          // one line later) — that's the real number to compare. Falls
          // back to the image-pool ask average only when the real pipeline
          // found no usable price at all (genuine no-comp-data polybag/
          // facsimile scan — Q67-C's original target case).
          const pcAnchor = priceCharting?.price || null;
          const realPoolPrice =
            typeof priceBandsRaw?.market === 'number' && priceBandsRaw.market > 0
              ? priceBandsRaw.market
              : 0;

          if (realPoolPrice > 0 && pcAnchor && pcAnchor / realPoolPrice > 10) {
            out.price = null;
            out.priceLow = null;
            out.priceHigh = null;
            out.priceBands = null;
            out.pricingSource = 'refused-polybag-pc-divergence';
            out.refusedToPrice = true;
            out.confidenceLevel = 'LOW';
            out.priceNote = 'Real comp pool conflicts with PriceCharting anchor — verify edition before pricing';
            out.listingHardLocked = true;
            out.listingHardLockReason = 'polybag-pc-divergence';
            out.listingHardLockBanner = 'Comp pool conflicts with PriceCharting anchor — verify edition';
            out.polybagDetected = true;
            out.polybagReprintRatio = reprintRatio;
            isPolybagPricing = true; // skip ALL downstream pricing blocks
            console.log(
              `[polybag-abort] PC=$${pcAnchor.toFixed(2)} realPoolPrice=$${realPoolPrice.toFixed(2)} ` +
              `ratio=${(pcAnchor / realPoolPrice).toFixed(0)}x > 10 — hard abort (real pool), refused to price`
            );
          } else if (realPoolPrice > 0) {
            // Real filtered pool (comps.js) is coherent vs PC, or PC has no
            // match to compare — it stands untouched. Image-pool facsimile
            // ratio above was informational only; no pricing override.
            console.log(
              `[polybag-check] real pool $${realPoolPrice.toFixed(2)} coherent vs PC ` +
              `${pcAnchor ? '$' + pcAnchor.toFixed(2) : 'n/a'} — INV-3 does not fire ` +
              `(image-pool ${(reprintRatio * 100).toFixed(0)}% facsimile signal stays informational)`
            );
          } else if (pcAnchor && askAvg > 0 && pcAnchor / askAvg > 10) {
            // No real pool price at all — original image-pool fallback.
            out.price = null;
            out.priceLow = null;
            out.priceHigh = null;
            out.priceBands = null;
            out.pricingSource = 'refused-polybag-pc-divergence';
            out.refusedToPrice = true;
            out.confidenceLevel = 'LOW';
            out.priceNote = 'Reprint pool conflicts with PriceCharting anchor — verify edition before pricing';
            out.listingHardLocked = true;
            out.listingHardLockReason = 'polybag-pc-divergence';
            out.listingHardLockBanner = 'Reprint pool conflicts with PriceCharting anchor — verify edition';
            out.polybagDetected = true;
            out.polybagReprintRatio = reprintRatio;
            isPolybagPricing = true; // skip ALL downstream pricing blocks
            console.log(
              `[polybag-abort] PC=$${pcAnchor.toFixed(2)} poolAvg=$${askAvg.toFixed(2)} ` +
              `ratio=${(pcAnchor / askAvg).toFixed(0)}x > 10 — hard abort (no real pool price), refused to price`
            );
          } else {

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
          } // GL-3 — end else: polybag pricing committed (no PC divergence abort)
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
      // A6 dispatch — pipelineAudit on the merchandise hard-block exit.
      // out.issue was never written (the terminal write at the main path
      // hasn't run yet) — honestly null, not fabricated. decision reuses
      // the exact object just set two lines above, not recomputed.
      logTitleStripSummary();
      out.pipelineAudit = buildPipelineAudit({
        traceId: pipelineTraceId,
        buildSha: buildId,
        identityRevision: pipelineIdentityRevision,
        familyIssueConsensus: identity?.familyIssueConsensus || null,
        familyKey: confirmedTitle ?? null,
        pricingIssue,
        confirmedIssue,
        outIssue: out.issue ?? null,
        prePricingOk: pricingIssue === confirmedIssue,
        preResponseOk: (out.issue ?? null) === (confirmedIssue ?? null),
        decision: out.decision,
      });
      // Ship #24a-2: contract state=LOCKED via DO_NOT_LIST hard lock
      return res.json(finalizeResponse(out)); // STOP — no pricing, return early
    }

    // Q94 — Publisher backfill from ACTIVE-comp title consensus (second path).
    // The WARP-FIX pattern table runs against the eBay VISUAL pool only
    // (backfillFromComps at line ~2857); when that pool doesn't yield a
    // publisher the confirmedPublisher stays null even when the Phase-2
    // active pool overwhelmingly names one, and CV's correct match gets
    // rejected in a circular publisher-mismatch loop (Warp #9: 0 visual
    // results, 35 active comps naming "First Comics"). Runs BEFORE the
    // identity gate so the backfilled publisher completes identity.
    //
    // Q133 Slice 1c (2026-07-21) — the `< 4` visual-pool-SIZE gate below was
    // written for the Warp #9 shape (empty visual pool) but had an
    // unintended side effect: a FULL visual pool that still fails to name a
    // publisher (Invincible #1 MegaCon — 20 pool items, all seller listings
    // that never bother writing "Image Comics") blocked this fallback too,
    // even though the 49-item active comp pool, already fetched, visibly
    // does contain publisher mentions. Pool SIZE was never the right
    // condition — `!confirmedPublisher` (already checked one line up) IS
    // the condition: "did every attempt so far fail to produce one." Warp
    // #9's own case is unaffected — an empty visual pool still leaves
    // confirmedPublisher null, so this still fires for it exactly as before.
    {
      const activeCompTitles = [
        ...(Array.isArray(compsFromEbay?.prices) ? compsFromEbay.prices : []),
        ...(Array.isArray(filteredSold) ? filteredSold : []),
      ].map((r) => String(r?.rawTitle || r?.title || '')).filter(Boolean);

      if (!confirmedPublisher) {
        {
          const pubConsensus = backfillPublisherFromTitles(activeCompTitles);
          if (pubConsensus) {
            confirmedPublisher = writeConfirmed('confirmedPublisher', confirmedPublisher, pubConsensus.publisher, publisherSource, 'active-comp-consensus', 'q94-active-comp');
            publisherSource = 'active-comp-consensus';
            out.publisher = confirmedPublisher;
            out.publisherBackfilledFromComps = true;
            out.publisherBackfillRatio = pubConsensus.ratio;
            out.publisherBackfillSource = 'active-comp-consensus';
            console.log(
              `[Q94] publisher backfilled from ACTIVE comps: ${pubConsensus.publisher} ` +
              `(${pubConsensus.hitCount}/${pubConsensus.total}=${Math.round(pubConsensus.ratio * 100)}%, ` +
              `visual pool=${visualResult?.items?.length || 0})`
            );
          }
        }
      } else {
        // Q96 — publisher CORRECTION path. Q94 only fills a null publisher;
        // a WRONG non-null value (Flash Gordon #13: "Image" on a 1969
        // Charlton book) persisted across rescans because the active-comp
        // consensus was never consulted once a string existed. Higher bar
        // than backfill: ≥80% of active+sold comp titles must name a
        // DIFFERENT publisher (key-normalized so "DC" ≡ "DC Comics" and
        // imprints don't self-conflict).
        const pubConsensus = backfillPublisherFromTitles(activeCompTitles, { minRatio: 0.8 });
        if (
          pubConsensus &&
          normalizePublisherKey(pubConsensus.publisher) !== normalizePublisherKey(confirmedPublisher)
        ) {
          console.log(
            `[Q96] publisher-conflict-corrected old=${confirmedPublisher} new=${pubConsensus.publisher} ` +
            `(${pubConsensus.hitCount}/${pubConsensus.total}=${Math.round(pubConsensus.ratio * 100)}%)`
          );
          out.publisherBeforeCorrection = confirmedPublisher;
          confirmedPublisher = writeConfirmed('confirmedPublisher', confirmedPublisher, pubConsensus.publisher, publisherSource, 'active-comp-consensus-correction', 'q96-active-comp-correction');
          publisherSource = 'active-comp-consensus-correction';
          out.publisher = confirmedPublisher;
          out.publisherConflictCorrected = true;
          out.publisherBackfillRatio = pubConsensus.ratio;
          out.publisherBackfillSource = 'active-comp-consensus-correction';
        }
      }
    }

    // GrailKey Commit P2 (Part B, 2026-08-03) — narrow, contained year
    // backfill for the P1 high-confidence marketplace-consensus carve-out.
    // Without this, P1 firing (out.issueAuthority.highConfidenceMarketplaceConsensus
    // === true) still hit a SECOND, independent wall below: this same
    // request's own family year vote (identity.familyYearConsensus,
    // resolveFamilyYearConsensus) reaching mode 'adopted' is already
    // logged and 'year' is already appended to out.identityProvisionalFields
    // (Commit 4.1) — but the VALUE never reached confirmedYear.
    //
    // B-Q1 (Phase 0 finding): confirmedYear IS assigned from the family
    // vote inside resolveIdentity (identityCore.js:1621), but is
    // unconditionally overwritten later in this function by resolveYear()'s
    // own authoritative pass (~line 4222) — resolveYear's "user year"
    // input (yearForResolution, ~line 4213) only reuses the family-adopted
    // confirmedYear when identityIsProvisionalOverride is true, a flag the
    // weighted-consensus/top-rank-protection family-override path (P1's
    // own target) never sets — only the separate 'refused-identity-conflict'
    // branch does. For a book with no PC/CV/user year of its own (Ship
    // 11's visual-pool-fallback territory — exactly where P1 lives),
    // resolveYear falls through to null, and every later backfill chain
    // (Q86 PC-tolerated, Q58-TITLE comp consensus) has nothing to work
    // with either — confirmedYear reaches the identity-gate below still
    // null, blocking on missing 'year' even though the exact same family
    // that just cleared P1's bar also voted on a year.
    //
    // B-Q2 (Phase 0 finding): identityIsProvisionalOverride is NOT a
    // contained lever — it also selects the PC query year (~line 3478,
    // already executed by this point in the request), nulls
    // confirmedVariant (~line 4763, already executed), and gates out.year's
    // own fallback (~line 9856). Flipping it on here to let resolveYear
    // pick up confirmedYear would reach back and change decisions already
    // made earlier in this same request under a different, broader
    // contract. This backfill is deliberately narrower: it only ever
    // writes confirmedYear itself, only when nothing else (PC, CV, user,
    // comp-consensus) already resolved it, and only behind the SAME P1
    // predicate that already gates the price carve-out — no new consensus
    // math, no promotion of issueAuthority.status (stays 'provisional').
    //
    // B-Q3 (Phase 0 finding): assessIdentityConfidence/sanitizeIdentityFields
    // (identityGate.js, called just below) have no authority/provenance
    // concept at all — they only check presence and format
    // (isCleanYearString). Writing any well-formed year string here clears
    // the gate identically to a canonical one; provenance is preserved
    // separately via out.confirmedYearMeta.source and
    // out.identityProvisionalFields (already includes 'year' from Commit
    // 4.1, unchanged by this write).
    //
    // Real call site for the extracted, exported deriveProvisionalYearBackfill
    // (src/lib/issueAuthority.js) — see that function's own doc comment for
    // the B-Q1/B-Q2/B-Q3 findings and the full invariant. Support threshold
    // (>= 3, stricter than resolveFamilyYearConsensus's own bare adoption
    // floor of 2) lives inside that function, not duplicated here.
    const provisionalYearBackfill = deriveProvisionalYearBackfill(confirmedYear, out.issueAuthority, identity?.familyYearConsensus);
    if (provisionalYearBackfill) {
      confirmedYear = writeConfirmed('confirmedYear', confirmedYear, provisionalYearBackfill.year, yearSource, provisionalYearBackfill.meta?.source || 'unknown', 'commit-p2');
      yearSource = provisionalYearBackfill.meta?.source || 'unknown';
      out.confirmedYearMeta = provisionalYearBackfill.meta;
      console.log(
        `[commit-p2] confirmedYear backfilled from family consensus (provisional, unblocks identity-gate only): ` +
        `year=${confirmedYear} support=${identity.familyYearConsensus.support}/${identity.familyYearConsensus.uniqueRows}`
      );
    }

    // GrailKey Dispatch 19 (2026-08-07) — Fix 6, corrected and shipped.
    // Runs AFTER commit-p2 above and reads the CURRENT yearSource, not
    // confirmedYear's nullness — deliberately: commit-p2's own
    // `currentConfirmedYear != null` guard never fires when resolveYear's
    // fallback left confirmedYear as the literal string "Unknown" rather
    // than JS null (see rescueYearFromVisionFallback's doc comment,
    // src/lib/issueAuthority.js, for the real Spawn #351 production scan
    // this closes). Placing this check here, after every intermediate
    // backfill (Q86 PC-tolerated, Q58-TITLE comp consensus, pc-anchor-gate,
    // q99-b-variant-year) has already had its chance to run, means this
    // only fires when NOTHING else found a better year — yearSource stays
    // 'vision-fallback' only when every one of those declined too.
    const visionFallbackRescue = rescueYearFromVisionFallback(yearSource, identity?.familyYearConsensus);
    if (visionFallbackRescue) {
      const priorFallbackYear = confirmedYear;
      confirmedYear = writeConfirmed('confirmedYear', confirmedYear, visionFallbackRescue.year, yearSource, visionFallbackRescue.meta.source, 'commit-p3');
      yearSource = visionFallbackRescue.meta.source;
      out.confirmedYearMeta = visionFallbackRescue.meta;
      console.log(
        `[commit-p3] confirmedYear rescued from vision-fallback ("${priorFallbackYear}") using family-scoped adoption: ` +
        `year=${confirmedYear} support=${identity.familyYearConsensus.support}/${identity.familyYearConsensus.uniqueRows}`
      );
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

    // Q83 — Vision low-confidence is a VOTE, not a VETO.
    // Superman vs the Amazing Spider-Man #1 (1976 treasury): Vision
    // hallucinated "not a valid comic title" + self-reported low
    // confidence, and assessIdentityConfidence's unconditional
    // visionConfidence==='low' veto outranked 13 verified actives + 3
    // fresh solds converging on one identity. When the verified pool is
    // deep (≥10 combined) with ≥1 fresh sold and converges on a single
    // identity (Q58-TITLE ≥80% title / ≥70% issue), adopt the consensus,
    // flag identity-from-consensus, keep NEEDS_REVIEW. ID_REQUIRED
    // remains for the consensus-absent case.
    let idCheckFinal = idCheck;
    if (!idCheck.confident) {
      const activePoolItems = Array.isArray(compsFromEbay?.prices) ? compsFromEbay.prices : [];
      const soldRows = Array.isArray(filteredSold) ? filteredSold : [];
      const freshSolds = soldRows.filter((r) => r?.daysAgo != null && r.daysAgo <= 90);
      const consensusPool = [...activePoolItems, ...soldRows];

      if (consensusPool.length >= 10 && freshSolds.length >= 1) {
        // Title consensus — prefix-before-# extractor (Q83, ≥80% of ≥10
        // issue-bearing titles). Robust against format-word variance that
        // splinters Q58-TITLE's first-N-token join ("Treasury"/"Crossover"
        // suffixes). Q58-TITLE backfill kept as fallback + for year/
        // publisher completion.
        const titleConsensus = extractTitleConsensus(consensusPool, { minCount: 10, minRatio: 0.8 });
        const rescueBackfill = backfillFromComps(null, confirmedYear, confirmedPublisher, consensusPool);

        // Issue consensus — Q58 issue pattern: dominant #N at ≥70% of
        // issue-bearing titles. Vision issue (when present) is kept.
        const issueCounts = {};
        consensusPool.forEach((it) => {
          const m = String(it?.rawTitle || it?.title || '').match(/#\s*(\d{1,4})\b/);
          if (m) issueCounts[m[1]] = (issueCounts[m[1]] || 0) + 1;
        });
        const issueRanked = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]);
        const issueTotal = issueRanked.reduce((sum, [, c]) => sum + c, 0);
        const issueConsensus =
          issueRanked.length > 0 && issueTotal > 0 && issueRanked[0][1] / issueTotal >= 0.70
            ? issueRanked[0][0]
            : null;

        const consensusTitle =
          titleConsensus?.title ||
          (rescueBackfill.titleBackfilled ? rescueBackfill.title : null);
        const consensusTitleRatio =
          titleConsensus?.ratio ?? rescueBackfill.titleBackfillRatio ?? 0;
        const consensusIssue = confirmedIssue || issueConsensus;
        // Consensus may also complete year/publisher (same extractor family
        // as `backfill` above — backfillFromComps — invoked a second time
        // here against a different pool, hence the same 'comp-consensus-
        // backfill' source).
        if (!confirmedYear && rescueBackfill.yearBackfilled) {
          confirmedYear = writeConfirmed('confirmedYear', confirmedYear, rescueBackfill.year, yearSource, 'comp-consensus-backfill', 'q83-rescue');
          yearSource = 'comp-consensus-backfill';
        }
        if (!confirmedPublisher && rescueBackfill.publisherBackfilled) {
          confirmedPublisher = writeConfirmed('confirmedPublisher', confirmedPublisher, rescueBackfill.publisher, publisherSource, 'comp-consensus-backfill', 'q83-rescue');
          publisherSource = 'comp-consensus-backfill';
        }

        if (consensusTitle && consensusIssue) {
          const rescuedIdentity = sanitizeIdentityFields({
            title: consensusTitle,
            issue: consensusIssue,
            year: confirmedYear,
            publisher: confirmedPublisher,
            // Vision's low confidence TRIGGERED this path; consensus judges
            // the identity on fields — the low-confidence vote is recorded
            // via needsReview below, not as a veto.
            visionConfidence: null,
            author: out.author || null,
          });
          const idCheck2 = assessIdentityConfidence(
            rescuedIdentity, 'ebay_comp_consensus', adapter.identityFields, out.pcProductId
          );
          if (idCheck2.confident) {
            confirmedTitle = writeConfirmed('confirmedTitle', confirmedTitle, rescuedIdentity.title, titleSource, 'ebay_comp_consensus', 'q83-rescue');
            titleSource = 'ebay_comp_consensus';
            confirmedIssue = writeConfirmed('confirmedIssue', confirmedIssue, rescuedIdentity.issue, issueSource, 'ebay_comp_consensus', 'q83-rescue');
            issueSource = 'ebay_comp_consensus';
            out.title = rescuedIdentity.title;
            // Q140 terminal fingerprint invariant — out.issue is no longer
            // written here directly. confirmedIssue (just set above) is the
            // single source of truth; the terminal write further down
            // derives out.issue from it exactly once.
            identitySource = 'ebay_comp_consensus';
            out.identityFromConsensus = true;
            out.needsReview = true; // NEEDS_REVIEW retained per Q83 ruling
            out.identityConsensus = {
              titleRatio: Number(consensusTitleRatio.toFixed(2)),
              issue: consensusIssue,
              poolSize: consensusPool.length,
              freshSolds: freshSolds.length,
              visionVetoOverridden: true,
            };
            idCheckFinal = idCheck2;
            console.log(
              `[Q83] identity-from-consensus: "${rescuedIdentity.title}" #${rescuedIdentity.issue} ` +
              `pool=${consensusPool.length} freshSolds=${freshSolds.length} ` +
              `titleRatio=${(consensusTitleRatio * 100).toFixed(0)}% — ` +
              `Vision low-confidence vote overridden by comp consensus`
            );
          } else {
            console.log(
              `[Q83] consensus rescue incomplete — missing=[${idCheck2.missingFields.join(',')}], ID_REQUIRED stands`
            );
          }
        } else {
          console.log(
            `[Q83] no single-identity consensus (title=${consensusTitle || 'none'} ` +
            `issue=${consensusIssue || 'none'} pool=${consensusPool.length}) — ID_REQUIRED stands`
          );
        }
      }
    }

    // Slice A3 (2026-07-22, One World Under Doom / Giang MegaCon Secret Drop
    // class) — a DIFFERENT trigger from Q83's consensus-rescue above: here
    // title/issue/year/publisher are ALL already resolved (idCheckFinal.
    // missingFields is empty) — Vision's own self-reported low confidence is
    // the ONLY reason idCheckFinal.confident is false. Q83's rescue
    // re-derives identity from raw pool text and requires >=1 fresh (<=90d)
    // sold comp; a freshly-dropped con-exclusive variant plausibly has zero
    // solds yet, so Q83 never enters for this shape at all. This instead
    // trusts signals the pipeline already computed for the
    // ALREADY-CONFIRMED identity — out.convergence (PC/CV agreement) and
    // familyCandidate's own member count (pool coherence) — no
    // re-derivation, no solds-recency requirement. idCheckFinal.confident
    // is deliberately left honestly false (same convention as
    // out.identityProvisional) — exempted downstream via a dedicated flag,
    // never silently promoted to LIST_NOW. Requires family >=3 AND a real
    // comp pool AND convergence not LOW — a book where Vision is unsure
    // AND the pool is thin/scattered still correctly falls through to
    // ID_REQUIRED, byte-identical to today.
    let visionLowButCorroborated = false;
    if (!idCheckFinal.confident && idCheckFinal.missingFields.length === 0) {
      const activePoolCountForVLC = Array.isArray(compsFromEbay?.prices) ? compsFromEbay.prices.length : 0;
      const soldPoolCountForVLC = Array.isArray(filteredSold) ? filteredSold.length : 0;
      // Track B Phase 0, Commit 4.3.1 (Section C) — coherentFamilyCount
      // used to be bare topFamily.count: ANY coherent family contributed
      // toward corroboration regardless of whether its OWN issue
      // measurement agreed with confirmedIssue — a family that is
      // internally coherent but measures a DIFFERENT issue than the one
      // actually confirmed (e.g. the Commit 4.3.1 near-miss shape: family
      // observes #351, confirmedIssue stays Vision's own prior) would have
      // wrongly corroborated an issue it explicitly disagrees with. A
      // family may now only contribute when (a) its topFamily.indices
      // genuinely belong to the CURRENT request's visualItems
      // (hasValidFamilyMembership, the same precondition identityCore.js's
      // own retention gate uses), and (b) its OWN issue measurement — the
      // existing resolveFamilyIssueConsensus resolver, no second issue
      // parser — is 'adopted' AND equals confirmedIssue exactly.
      const topFamilyForVLC = familyCandidate?.topFamily;
      const familyMembershipValidForVLC = hasValidFamilyMembership(parsedVisualRows, topFamilyForVLC?.indices, topFamilyForVLC?.count);
      const familyIssueMeasurementForVLC = familyMembershipValidForVLC
        ? resolveFamilyIssueConsensus(null, parsedVisualRows, topFamilyForVLC.indices)
        : null;
      const familyIssueMatchesConfirmedForVLC = familyIssueMeasurementForVLC?.mode === 'adopted'
        && familyIssueMeasurementForVLC.issue != null
        && String(familyIssueMeasurementForVLC.issue) === String(confirmedIssue);
      const coherentFamilyCount = familyIssueMatchesConfirmedForVLC ? (topFamilyForVLC?.count || 0) : 0;
      const convergenceTierOk = !!convergence?.tier && convergence.tier !== 'LOW';

      if (convergenceTierOk && coherentFamilyCount >= 3 && (activePoolCountForVLC > 0 || soldPoolCountForVLC > 0)) {
        visionLowButCorroborated = true;
        out.identityVisionLowButCorroborated = true;
        out.needsReview = true;
        out.identityConsensus = out.identityConsensus || {
          visionConfidence: confidence,
          convergenceTier: convergence.tier,
          convergenceScore: convergence.convergenceScore,
          familyCount: coherentFamilyCount,
          activePoolCount: activePoolCountForVLC,
          soldPoolCount: soldPoolCountForVLC,
          visionVetoOverridden: true,
        };
        console.log(
          `[slice-a3] vision-low-but-corroborated: convergence=${convergence.tier}(${convergence.convergenceScore}) ` +
          `familyCount=${coherentFamilyCount} activePool=${activePoolCountForVLC} soldPool=${soldPoolCountForVLC} — ` +
          `Vision's low self-confidence not treated as a veto; identity fields were already fully resolved`
        );
      }
    }

    out.identityConfident = idCheckFinal.confident;
    // Q133 Slice 1c (2026-07-21, Invincible class) — publisher-only-missing
    // is not the same class as a genuinely unresolved title/issue (that
    // stays a hard ID_REQUIRED wall — there's no book to price against).
    // A missing publisher with title/issue/year all present and a real
    // Tier-3 price already computed underneath is the same "computed-but-
    // refused" shape Q110 already fixed for assetTypeConfident/reprint/
    // refused-identity-conflict — reusing that exact mechanism
    // (listingHardLocked → contract state LOCKED, price/bands visible,
    // only the List button gates) rather than inventing new state.
    //
    // Design ruling (explicit, not inferred): a Q94 comp-consensus
    // publisher (>=50% of active+sold titles) counts as "found" for gate
    // purposes but is real evidence, not indicia — the card stays RESEARCH-
    // tier minimum on this field alone, never silently promoted to
    // LIST_NOW. When even that consensus doesn't clear 50%, publisher
    // stays honestly unresolved (out.publisherUnresolved) — still not
    // ID_REQUIRED, since title/issue/year are otherwise solid and a price
    // exists to show.
    const publisherOnlyMissing = !idCheckFinal.confident &&
      idCheckFinal.missingFields.length === 1 &&
      idCheckFinal.missingFields[0] === 'publisher';
    if (!idCheckFinal.confident) {
      out.identityMissingFields = idCheckFinal.missingFields;
      out.identityReasons = idCheckFinal.reasons;
      if (publisherOnlyMissing) {
        out.listingHardLocked = true;
        out.listingHardLockReason = out.listingHardLockReason || 'publisher-unresolved';
        if (out.publisherBackfillSource === 'active-comp-consensus') {
          out.listingHardLockBanner = out.listingHardLockBanner ||
            `Publisher derived from ${Math.round((out.publisherBackfillRatio || 0) * 100)}% comp-listing consensus, not confirmed by title/issuer data — verify before listing`;
        } else {
          out.publisherUnresolved = true;
          out.listingHardLockBanner = out.listingHardLockBanner ||
            'Publisher could not be confirmed from any source — verify before listing';
        }
        console.log(
          `[identity-gate] publisher-only gap — pricing proceeds (LOCKED), ` +
          `source=${out.publisherBackfillSource || 'none'}`
        );
      } else if (visionLowButCorroborated) {
        out.listingHardLocked = true;
        out.listingHardLockReason = out.listingHardLockReason || 'vision-low-confidence-corroborated';
        out.listingHardLockBanner = out.listingHardLockBanner ||
          `Vision wasn't confident reading this cover, but PriceCharting/ComicVine and a ` +
          `${out.identityConsensus?.familyCount ?? 0}-listing comp pool independently agree — verify before listing`;
        console.log(
          '[identity-gate] vision-low-confidence overridden by pipeline corroboration — pricing proceeds (LOCKED)'
        );
      } else if (out.identityProvisional) {
        // Q143 dispatch (2026-07-22) — consistency fix, not the primary
        // mechanism (that's the tier-engine OR-arm, Q141, and the new
        // active_reference_range branch a few hundred lines down). This
        // branch exists ONLY so a promoted provisional identity is never
        // even transiently nulled/mislabeled here — it does not itself
        // compute or preserve any point price. Mirrors publisherOnlyMissing/
        // visionLowButCorroborated's shape (LOCKED, not nulled) but is
        // deliberately reference-only: whatever price this book ends up
        // with (a real tier-engine result, the new reference-range tier,
        // or none at all) is decided entirely downstream of this gate.
        out.listingHardLocked = true;
        out.listingHardLockReason = out.listingHardLockReason || 'identity-unresolved';
        console.log(
          '[identity-gate] pool-provisional identity — pricing proceeds downstream (LOCKED)'
        );
      } else {
        out.price = null;
        out.priceLow = null;
        out.priceHigh = null;
        out.pricingSource = 'identity-required';
        console.log(
          '[identity-gate] REFUSED to price —',
          'missing:', idCheckFinal.missingFields.join(',') || '(none)',
          '· reasons:', idCheckFinal.reasons.join('; ')
        );
      }
    } else if (out.publisherBackfillSource === 'active-comp-consensus' && !out.comicVine?.publisher) {
      // Q133 Slice 1c — the OTHER half of the design ruling: when Q94's
      // consensus SUCCEEDS, confirmedPublisher is non-null and idCheckFinal
      // reports fully confident (nothing missing) — this branch would
      // never run and the card would silently reach LIST_NOW with no
      // marker at all. A comp-consensus publisher is real evidence, not
      // indicia, so it still gets the same advisory lock as the no-
      // consensus case, just with the consensus-specific banner.
      //
      // Q135 dispatch (2026-07-22, Poison Ivy #31 class) — `!out.comicVine
      // ?.publisher` added: the ruling's premise is comp titles being the
      // ONLY source, not merely the source that happened to fire first.
      // ComicVine independently confirming a publisher for this exact book
      // is a real source, not indicia-grade — this branch should never
      // have reached active-comp-consensus for such a book at all (root
      // cause: cv-pub-autofill above was reading a dead field path,
      // ~line 3536); this guard is defense-in-depth in case some other
      // path ever sets publisherBackfillSource without CV having had its
      // turn first.
      out.listingHardLocked = true;
      out.listingHardLockReason = out.listingHardLockReason || 'publisher-comp-consensus';
      out.listingHardLockBanner = out.listingHardLockBanner ||
        `Publisher derived from ${Math.round((out.publisherBackfillRatio || 0) * 100)}% comp-listing consensus, not confirmed by title/issuer data — verify before listing`;
      console.log(
        `[identity-gate] publisher resolved via comp-consensus (${Math.round((out.publisherBackfillRatio || 0) * 100)}%) — ` +
        `RESEARCH-tier marker applied, not silently promoted to LIST_NOW`
      );
    }

    // Q110 dispatch Part 1 (2026-07-18) — asset-type flag becomes advisory,
    // never a hard block on data already computed. Was: explicitly nulled
    // price fields and forced pricingSource='refused-not-a-comic', which
    // walled off the card even when a real comp pool existed underneath
    // (Walking Dead #109 class — 10 real listings, blank card). Now: the
    // flag stays visible via listingHardLocked (routes responseContract.js
    // to state=LOCKED, which shows price/bands, gates only the List button
    // — the "genuine listing gate" the ruling reserves for publish-time,
    // not intake). Pricing below is no longer gated on this flag, so a
    // real price computes from the same comps and lands inside the LOCKED
    // card instead of being suppressed.
    if (!out.assetTypeConfident && !out.assetTypeConfidentOverride) {
      out.listingHardLocked = true;
      out.listingHardLockReason = out.listingHardLockReason || 'asset-type-uncertain';
      out.listingHardLockBanner = out.listingHardLockBanner
        || 'This image may be a reference scan or promotional print — verify before listing';
      console.log('[asset-type-gate] advisory only — pricing proceeds, listing locked pending verification');
    } else if (!out.assetTypeConfident && out.assetTypeConfidentOverride) {
      // GrailKey Dispatch 19 — Fix 5. Vision said not-a-comic, but the Q32
      // category-vote override above lifted the advisory lock. Explicitly
      // logged as its own case (not silent) — the lock genuinely does not
      // fire here, which should be visible in the log same as when it does.
      console.log('[asset-type-gate] advisory lock overridden by Q32 comic-category consensus — listing NOT locked');
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
    // Q110 dispatch Part 1: out.assetTypeConfident no longer gates the
    // synthesis block — the flag is advisory (listingHardLocked above),
    // not a pricing-eligibility gate. Real comps still price normally.
    // Q133 Slice 1c: publisherOnlyMissing is the same kind of exception —
    // title/issue/year are solid, only publisher is advisory-locked above,
    // so synthesis proceeds instead of the hard identity-required wall.
    // Slice A3 (2026-07-22 follow-up) — visionLowButCorroborated is the
    // same kind of exception again: idCheckFinal.confident is deliberately
    // left false (Vision's own low self-rating, honestly preserved), but
    // priceBandsRaw (computePriceBandsFromSold, line ~4883) already ran
    // UNCONDITIONALLY, upstream of and independent from this gate — without
    // this OR-arm, a real blended price computed moments earlier in the
    // same request (One World Under Doom: $10.73) never reached
    // out.price/out.pricingSource at all, and [price-bands-pricing] never
    // logged despite priceBandsRaw holding a genuine value. Same bug shape
    // as the original identityProvisional gap this pattern was built to
    // close — a promotion that flips the BLOCKER but forgets the
    // PRICING-ELIGIBILITY gate is the same class of half-fix twice now.
    //
    // Rachta Lin row-7 gap (2026-07-22, LAUNCH-AUDIT Section 3 dispatch) —
    // out.identityProvisional itself (Q133 Slice 2, set ~line 4163) was
    // MISSING from this exact OR-chain — a third instance of the identical
    // bug shape now, not a new one. decisionEngine.js's identity-incomplete
    // blocker got its own out.identityProvisional exemption (Slice A2), so
    // the CARD's decision correctly read RESEARCH — but this gate, upstream
    // and independent of decisionEngine, still required idCheckFinal.
    // confident/publisherOnlyMissing/visionLowButCorroborated, none of which
    // a promoted provisional identity with a missing issue/year (Rachta
    // Lin's genuine shape — the pool can't supply them) ever satisfies. The
    // entire tier-engine block below ran skipped; realPhase2EvidenceCount
    // check at computeDecision time (~line 8279) could be >0 with out.price
    // still null, and neither of ITS branches fires for that combination
    // (real evidence exists so the 0-evidence fallback doesn't fire; out.
    // price is null so the "real data priced this card" branch doesn't
    // fire either) — a real, already-fetched comp pool showing a blank
    // price. out.identityProvisional is already narrowly scoped (only set
    // true inside the >=3-member promotion floor, Q133 Slice 2) — adding it
    // here is not a new eligibility class, it's completing the one Q133
    // Slice 2 already established.
    if ((idCheckFinal.confident || publisherOnlyMissing || visionLowButCorroborated || out.identityProvisional) && !isPolybagPricing) {
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
      // #20b-FIX1: Map tier sources to display labels. Definition hoisted
      // to module scope (TIER_SOURCE_MAP, below the handler) — three
      // incidents of the identical shape now (Q109-DISPATCH-1-B, Q109-D,
      // GK-34/Dispatch-10) all trace to a NEW priceBands.js source value
      // silently falling through to the 'pc_estimate' default, which is
      // eligible for a variant/key re-multiply — see
      // tests/tier-source-map-completeness.test.js, which asserts every
      // source PRICE_BANDS_SOURCES (priceBands.js) can emit has an
      // explicit entry here. Third-incident pattern closed by the test,
      // not by remembering harder.
      if (!(priceBandsRaw.source in TIER_SOURCE_MAP)) {
        console.error(
          `[tier-source-map] UNMAPPED source "${priceBandsRaw.source}" — falling through to ` +
          `'pc_estimate' default, which is VARIANT_MULT_ELIGIBLE_SOURCES-eligible. This is exactly ` +
          `the Q109-DISPATCH-1-B/Q109-D/GK-34 double-count shape. Add an explicit TIER_SOURCE_MAP ` +
          `entry for this source.`
        );
      }
      out.pricingSource = TIER_SOURCE_MAP[priceBandsRaw.source] || 'pc_estimate';

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

      // Q109-G — grade multiplier resolved via nearest-neighbor fallback
      // (no exact table entry for this grade), not a documented value.
      if (out.gradeMultiplierInterpolated) {
        priceNoteBase += ` · grade multiplier estimated (nearest: CGC ${out.gradeMultiplierInterpolatedFrom})`;
      }

      out.priceNote = priceNoteBase;

      console.log(
        `[price-bands-pricing] market=${priceBandsRaw.market.toFixed(2)} ` +
        `source=${out.pricingSource} count=${priceBandsRaw.count} ` +
        `gradeMult=${gradeMultiplier}` +
        (priceBandsRaw.variantAdjusted ? ' VARIANT-ADJUSTED' : '')
      );
    } else if (rawComps && rawComps.count > 0) {
      // Q143 dispatch (2026-07-22, Rachta Lin class) — active_reference_range.
      // A promoted provisional identity (out.identityProvisional, Q133 Slice
      // 2) whose own family-scoped comp pool found 1-2 real, mutually-
      // consistent active comps and zero exact solds deserves an honest
      // "here's the real market range, not a verified FMV" answer instead
      // of P0-A's blanket refusal below. P0-A remains the safety net for
      // every OTHER tier-bypass shape (a non-provisional identity that's
      // simply thin, unrelated comps, internally-conflicting comps) —
      // narrowed to fire only when this narrower, better-evidenced path
      // does not apply, never retired.
      // refPrices computed up front (not inside the eligibility branch)
      // specifically so its length can gate eligibility itself — a
      // rawComps.count > 0 pool whose recentSales rows carry no valid
      // numeric price (malformed/missing .price) must fall through to
      // the existing P0-A refusal below, not compute Math.min/max on an
      // empty array (Infinity/-Infinity).
      const refPrices = (rawComps.recentSales || [])
        .map((r) => r?.price)
        .filter((p) => typeof p === 'number' && p > 0);
      const activeReferenceEligible =
        out.identityProvisional === true &&
        rawComps.count >= 1 && rawComps.count <= 2 &&
        refPrices.length >= 1 &&
        (out.soldComps?.length || 0) === 0 &&
        !hasUnresolvedActiveVariantConflict(rawComps.recentSales);

      if (activeReferenceEligible) {
        const referenceLow = Math.round(Math.min(...refPrices) * 100) / 100;
        const referenceHigh = Math.round(Math.max(...refPrices) * 100) / 100;
        const referenceMid = Math.round((refPrices.reduce((a, b) => a + b, 0) / refPrices.length) * 100) / 100;
        out.price = fmtUsd(referenceMid);
        out.priceLow = fmtUsd(referenceLow);
        out.priceHigh = fmtUsd(referenceHigh);
        out.referenceLow = referenceLow;
        out.referenceHigh = referenceHigh;
        out.referenceMid = referenceMid;
        out.pricingSource = 'active_reference_range';
        out.verifiedFMV = false;
        out.refusedToPrice = false;
        out.listingHardLocked = true;
        out.listingHardLockReason = out.listingHardLockReason || 'identity-unresolved';
        out.priceNote = `Reference range from ${rawComps.count} active listing${rawComps.count === 1 ? '' : 's'} — not a verified FMV, identity unconfirmed, verify before listing.`;
        out.confidenceLevel = 'LOW';
        console.log(
          `[active-reference-range] eligible — count=${rawComps.count} ` +
          `range=$${referenceLow.toFixed(2)}-$${referenceHigh.toFixed(2)} mid=$${referenceMid.toFixed(2)}`
        );
      } else {
        // P0-A — LEGACY PATH (DEPRECATED). This path fires when tier-4 returned null
        // (no PC match) but rawComps exist (1-2 verified active comps, below tier-3
        // threshold of 3) AND the narrower active_reference_range path above didn't
        // apply (not a provisional identity, >2 comps, sold evidence present, or the
        // comps disagree with each other). Kept as the safety net for every other
        // tier-bypass shape — no longer the unconditional catch-all it used to be.
        console.warn(
          '[P0-A-LEGACY-PATH] browse_api fallback fired — tier-4 null, rawComps exist, active_reference_range not eligible.',
          'rawComps.count:', rawComps.count,
          'identityProvisional:', out.identityProvisional === true,
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
      }
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

    // Q118 — same reach-every-code-path requirement as editionWarning
    // immediately above (computed early, assigned here once `out` exists
    // and every branch above has had a chance to run).
    if (visionConsistency.hasInconsistency) out.visionConsistency = visionConsistency;

    // Surface artistFallback / compBasis for browse_api-only books too
    // (the priceCharting branch already sets these, but not the
    // browse-only branch). Safe to set unconditionally — no-op when the
    // flag is already true.
    if (rawComps?.artistFallback && !out.artistFallback) {
      out.artistFallback = true;
      out.compBasis = rawComps.compBasis || 'generic-variant-fallback';
    }

    // Premium-variant isolation flag (2026-07-18, Magik #1 / Silk #1 class)
    // — Filter 1c isolated the comp pool to convention-exclusive/virgin/
    // numbered-limited comps on a single match instead of the usual >=2.
    // Surfaced so the UI can show the pool is thin-but-isolated rather than
    // thin-and-blended.
    if (rawComps?.premiumVariantIsolated) {
      out.premiumVariantIsolated = true;
    }

    // Filter bypass flag — set in both pricing branches (PC + browse).
    // Universal flag: era filter (comics) or set filter (cards) bypassed.
    if (rawComps?.eraFilterBypassed || out.matchConfidence?.eraFilterBypassed) {
      out.filterBypassDetected = true;
    }

    // Q129 dispatch (2026-07-19, Harley Quinn #62 Guillem March Cover C
    // class) — a distinct failure shape from Q115/Q127/Q128: not wrong
    // data getting IN, but CORRECT variant-specific comps getting excluded
    // by the era filter for a legitimate reason (a different printing —
    // in the confirmed case, the ONLY currently-live Guillem March Cover C
    // listings are a 2026 DC homage-reprint solicitation, correctly
    // rejected against a confirmedYear of 2019), leaving a priced pool
    // that carries no named variant descriptor at all (generic Main Cover
    // comps) silently standing in for the specific variant. I13 —
    // annotate, never silently substitute one real product's comps for a
    // different real product's when the correct data genuinely doesn't
    // exist right now.
    if (rawComps?.variantCompsExcludedByEra) {
      out.variantCompsExcludedByEra = rawComps.variantCompsExcludedByEra;
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
    //
    // GrailKey Dispatch 13 (2026-08-07) — 'verified_active' removed.
    // Confirmed genuinely dead: not in PRICE_BANDS_SOURCES
    // (src/lib/priceBands.js, the exhaustive current source enum), never
    // directly assigned to out.pricingSource anywhere in this handler —
    // a gate condition that can never fire, referenced here as though
    // live. "Dead code inside a pricing gate is a landmine" — a future
    // change could add a real code path assuming this entry already
    // covers it, silently not covering anything. Frontend display
    // support for this label (src/App.jsx) is deliberately left
    // untouched — that's backward-compat rendering for old catalogue
    // items whose stored pricingSource may predate whatever removed this
    // value from the live pipeline, a different concern from this
    // pricing-eligibility gate. Two more independent 'verified_active'
    // references were found in the same investigation
    // (src/lib/responseContract.js's ESTIMATED_SOURCES + inline check,
    // src/lib/dataQualityGuard.js's PRICE_RANK) — out of scope for this
    // specific fix (a different mechanism each, not multiplier
    // eligibility), flagged in CLAUDE.md for their own review.
    const VARIANT_MULT_ELIGIBLE_SOURCES = new Set([
      'pricecharting',
      'pc_estimate',
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

    // Finding A [P0, 2026-07-16]: narrowed from tierPathActive. The legacy
    // floor guard should only be suppressed when the tier price is itself
    // verified-sold derived (tiers 1/2/2.5) — that's the only case where an
    // inflated ask-based floor could override a real sold price (the
    // Batman #222 evidence above). Tier 3 (active-only) and tier 4
    // (pc_estimate, zero sold comps) have no sold price to protect, so the
    // grade-aware active floor (gradeFilteredLowest — the same value shown
    // as "Floor" on the card) must still apply. Previously tier != null
    // blanket-skipped every tier, leaving tier-4 pc_estimate free to fall
    // below the card's own displayed floor with nothing to catch it (Thor
    // #163: rec $11.52 < floor $49.91 — pc_estimate read PriceCharting's
    // ungraded loose-price ($12.80) x vintage 6.5 multiplier (0.9) instead
    // of reconciling against the one real, correctly-matched active comp).
    const soldDerivedTierActive = priceBandsRaw &&
      (priceBandsRaw.tier === 1 || priceBandsRaw.tier === 2 || priceBandsRaw.tier === 2.5);

    if (isPolybagPricing) {
      console.log('[floor] skipped — polybag pricing active');
    } else if (isMegaKeyForFloor) {
      console.log('[floor] skipped — mega-key uses floor map');
    } else if (compsExhausted) {
      console.log('[floor] skipped — all comps rejected by AI verify');
    } else if (soldDerivedTierActive) {
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
    // Q127 follow-up — was reading req.body.variant directly, bypassing the
    // year-hint conflict gate entirely: confirmedVariant could correctly
    // resolve to null (comps/sold-verify cleaned up) while this block still
    // applied a spurious multiplier from the same contaminated string
    // (the real "[variant] exclusive limited signed x 1.15" case).
    const variant = safeReqVariant ? String(safeReqVariant).trim() : null;

    // Newsstand multiplier eligibility (GrailKey Dispatch 14, 2026-08-07)
    // — deliberately broader than the rest of the variant-multiplier
    // system below, and split from isFromPC on purpose. Ladder-tested and
    // cleared (ASM #222: projected $13.40 vs its real FN 6.0 PriceCharting
    // rung of $20.80 — 35% under, see CLAUDE.md "dormant-multiplier
    // class"). Every tier-engine comp-derived source becomes eligible for
    // the newsstand branch specifically: a comp pool has no way to see
    // "this specific copy is the newsstand distribution" on its own —
    // that scarcity signal has to be applied externally regardless of how
    // well-verified the base price already is (inverted-trust-model
    // finding: the more-verified a price is, the LESS reason to withhold
    // this multiplier, not more).
    //
    // Every OTHER variant multiplier (35¢/30¢, gold, triple/double cover,
    // canadian, whitman, virgin, exclusive, etc.) and the key multiplier
    // stay under the ORIGINAL, narrower isFromPC gate — untested at this
    // tier this round, not part of what was greenlit, completely
    // unchanged. Does not require priceCharting?.price the way isFromPC
    // does: unlike isFromPC, this can't depend on PC data existing at all
    // (the Killing Joke class — real, well-priced active-comp data with
    // zero PC anchor whatsoever, pcBase undefined).
    const NEWSSTAND_MULT_TIER_SOURCES = new Set([
      'verified_sold_recency', 'sold_active_blend_30', 'verified_sold',
      'verified_sold_stale', 'active_ask_derived',
    ]);
    const isNewsstandMultEligible = !!out.price && !sanityFired &&
      NEWSSTAND_MULT_TIER_SOURCES.has(out.pricingSource);

    // Ship 6 — skip variant multiplier when polybag pricing active.
    if (variant && out.price && (isFromPC || isNewsstandMultEligible) && !isPolybagPricing) {
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
          'virgin': 1.5,
          '2nd print': 1.5,
          'second print': 1.5,
          'pence': 1.5,
          'dc universe logo': 1.5,
          'exclusive': 1.3,
          // Ship 7 — newsstand removed from flat table; era-aware logic
          // runs BEFORE this table lookup. Pre-1985: 1.0× (default print
          // run, no premium). 1985-1995: 1.2×. 1996-2000: 1.5×. 2001-2013:
          // 2.5×. Post-2013: null (Marvel/DC killed newsstand).
        };
        // 2026-07-18 (Magik #1 / Silk #1 class) — 'virgin' and 'exclusive'
        // entries, plus the numbered/limited tiered block below, are
        // estimates, NOT calibrated against real market data the way the
        // rest of this table is (per user greenlight: conservative starting
        // ratios, flagged for re-verification as real scans accumulate).
        const ESTIMATED_VARIANT_KEYS = new Set(['virgin', 'exclusive']);
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

        // GrailKey Dispatch 14 (2026-08-07) — everything below this point
        // (numbered/limited tiered mult + the flat variantMultipliers
        // table: 35¢/30¢, gold, triple/double cover, canadian, whitman,
        // virgin, exclusive, etc.) is NOT part of what was ladder-tested/
        // greenlit this round — newsstand alone was. Gated behind the
        // ORIGINAL narrow isFromPC specifically, so a tier-engine source
        // that only qualifies via the newsstand-broadened
        // isNewsstandMultEligible above can't also silently pick up one of
        // these untested multipliers.
        if (isFromPC) {
        // Numbered/limited print-run tiered multiplier (2026-07-18, Magik
        // #1 class) — runs BEFORE the flat table lookup, same shape as the
        // newsstand era block above. Smaller print runs command a larger
        // premium; tiers and thresholds are estimated starting points (user
        // greenlight 2026-07-18), not calibrated against real market data —
        // out.variantMultiplierEstimated flags this for re-verification.
        const LIMITED_RUN_RE = /\b(?:limited\s*(?:to)?|ltd\.?|le)\D{0,10}(\d{1,6})\b|(\d{1,6})\s*(?:copies|pieces)\b|\b1\s*of\s*(\d{1,6})\b/i;
        if (vLower.includes('limited') || vLower.includes('numbered')) {
          const runMatch = variant.match(LIMITED_RUN_RE);
          const runSize = runMatch
            ? parseInt(runMatch[1] || runMatch[2] || runMatch[3], 10)
            : null;
          let limitedMult;
          if (runSize > 0) {
            if (runSize <= 500) limitedMult = 2.0;
            else if (runSize <= 1500) limitedMult = 1.6;
            else if (runSize <= 3000) limitedMult = 1.3;
            else limitedMult = 1.15;
            out.limitedRunSize = runSize;
          } else {
            // Limited/numbered language present but no parseable run size —
            // most conservative tier rather than skipping entirely.
            limitedMult = 1.15;
          }
          vMult = limitedMult;
          out.variantMultiplierEstimated = true;
          console.log(
            `[variant] numbered/limited run=${runSize || 'unclear'} mult=${limitedMult}× (estimated, needs re-verification)`
          );
        }

        // Standard variant table lookup. Skipped if Ship 7 newsstand block
        // or the numbered/limited block above already set vMult. Catches
        // non-newsstand variants (price variants, canadian, whitman, 2nd
        // prints, etc.).
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
            if (ESTIMATED_VARIANT_KEYS.has(key)) out.variantMultiplierEstimated = true;
            break;
          }
        }
        } // end isFromPC-gated block (Dispatch 14)
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
        } else if (out.pricingSource === 'verified_sold') {
          // GrailKey Dispatch 13 — 'verified_active' removed from this
          // check (dead: never produced by the current tier engine, see
          // VARIANT_MULT_ELIGIBLE_SOURCES above for the full rationale).
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
        // GL-4 (EX-1): tier engine owns pricing — anchor never overrides
        // sold-derived tier output with active-pool math (#20b-FIX2 parity).
        tierPathActive,
      });
      if (anchorResult && !isPolybagPricing) {
        console.log(
          `[thin-pool] anchor applied cap=$${anchorResult.anchorCap.toFixed(2)} was=$${curPrice.toFixed(2)} comps=${rawComps.count}`
        );
        out.price = fmtUsd(anchorResult.anchorCap);
        out.priceLow = fmtUsd(anchorResult.anchorCap * 0.85);
        out.priceHigh = fmtUsd(anchorResult.anchorCap * 1.15);
        out.thinPoolAnchored = true;
        // GL-4: source truth — the returned number is now active-pool
        // derived; keeping the prior label (EX-1: 'verified_sold_stale')
        // made [price-trace] lie about where the price came from.
        out.pricingSource = 'thin_pool_anchor';
        out.priceNote = (out.priceNote || '') + ' · thin-pool anchor';
      } else if (tierPathActive && rawComps && rawComps.count > 0 && rawComps.count < 3 && !isPolybagPricing) {
        console.log(
          `[thin-pool] SKIPPED — tier ${priceBandsRaw.tier} pricing owns the pool (GL-4 EX-1 gate)`
        );
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
      } else if (megaKeyEntry && isImpairedLabel) {
        // GL-2 (EX-5): floor map holds blue-label Universal floors. A
        // Qualified/Restored copy must never receive them (X-Men #1
        // QUALIFIED 7.0 was floored to $30,000, dh9xr-17838111).
        out.megaKeyFloorSkipped = true;
        out.megaKeyFloorSkipReason = `${impairedLabelClass}-label`;
        console.log(
          `[mega-key-floor] SKIPPED — ${impairedLabelClass} label (Universal floor not applicable)`
        );
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
            // When the sold-derived basis is <50% of floor.low, suspect
            // reprint/polybag contamination in sold pool. Keep estimate
            // displayed (no floor override), flag for research, hard-lock.
            //
            // P0 2026-07-13 (X-Men #1 CGC 4.0 shipped $4,672 LIST vs
            // $14,000 floor.low): an undated verified-sold pool leaves
            // soldAvg null (computeRecencyWeightedPrice skips dateless
            // rows) while pricingSource is still sold-derived — the
            // contamination check was blind and Q90 suppressed the floor.
            // Basis now falls back to the current sold-derived price when
            // soldAvg is unavailable.
            const SOLD_DERIVED_SOURCES = new Set([
              'verified_sold_recency', 'verified_sold', 'sold_active_blend_30',
              'verified_sold_active_blend', 'verified_sold_stale',
            ]);
            const soldDerivedSource = SOLD_DERIVED_SOURCES.has(out.pricingSource);
            const hasSoldData = soldAvg != null && !isNaN(soldAvg) && soldAvg > 0;
            const soldBasis = hasSoldData
              ? soldAvg
              : (soldDerivedSource && currentPriceNum > 0 ? currentPriceNum : null);
            const contaminationThreshold = floorResult.floor * 0.5;
            const isSuspectContaminated =
              soldBasis != null && soldBasis < contaminationThreshold;

            // Q90: mega-key floor must NEVER re-anchor a verified-sold-
            // derived slab price. GSX 3.0 (20:11:28 2026-07-12): a sold-pool
            // dropout degraded the tier price below the $1,200 bucket and
            // this branch re-anchored a book whose own slab-grade-matched
            // market was $1,387.64. RULE: floor applies only when
            // price < floor.low AND the pool is NOT slab-grade-matched.
            // A slab scan's verified solds passed the gradeMismatch filter,
            // so a sold-derived source == slab-grade-matched pool. The floor
            // band is still surfaced as a reference display.
            //
            // P0 2026-07-13 coexistence amendment: Q90 protects GOOD sold
            // prices from a stale floor; a basis far below floor is the
            // contamination signal XMEN1 exists to catch. Suppression now
            // additionally requires the sold basis above or reasonably
            // near floor.low (≥80%). The rules partition:
            //   basis < 50% of floor  → XMEN1 lock (contamination)
            //   50–80%                → normal floor enforcement
            //   ≥ 80% (incl. above)   → Q90 suppression (GSX 3.0: 116%)
            //
            // Q90 extension (2026-07-16, ASM #300 VF 8.0): originally gated
            // on isGraded===true && numericGrade!=null (slab-only). Raw
            // scans get numericGrade=null by design (api/grade.js prompt:
            // "otherwise null" when no slab label) — the slab gate silently
            // excluded every raw-book sold-derived case, so a raw book with
            // 3 tight fresh solds ($425/$425/$530, basis $429.60 vs a $500
            // floor — 86% of floor, inside the 80% band) still got floored
            // upward. Gate dropped; the 0.8 ratio and 2-comp minimum are
            // reused exactly, unchanged from the original Q90 calibration.
            //
            // Q90 strong-evidence carve-out (2026-07-17, ASM #300 VF 8.0,
            // three consecutive scans): the 80% line is a deliberate
            // partition boundary (P0 2026-07-13 ruling above), not fit to
            // any near-boundary case — GSX 3.0 (116%) and the raw-book
            // extension's 3-comp case (86%) both cleared it comfortably.
            // This case sits at 78.8% (basis $394.22 vs floor $500) with
            // 23 verified comps at 3-day recency — evidence far stronger
            // than the 50-80% "don't fully trust it" zone was built to
            // distrust. Both a high comp count AND high recency are
            // required (either alone is not sufficient) to relax the
            // ratio to 0.75; thinner or staler pools still need the full
            // 0.8. Do not adjust 15 / 7 / 0.75 further without new
            // evidence — reasoning captured in the Q90 dispatch report.
            const NEAR_FLOOR_RATIO = 0.8;
            const STRONG_EVIDENCE_RATIO = 0.75;
            const STRONG_EVIDENCE_MIN_COMPS = 15;
            const STRONG_EVIDENCE_MAX_DAYS = 7;
            const soldCount = filteredSold?.length || 0;
            const freshestDaysAgo = (filteredSold || []).reduce((min, s) => {
              const d = s?.daysAgo;
              return (d != null && d < min) ? d : min;
            }, Infinity);
            const strongEvidence =
              soldCount >= STRONG_EVIDENCE_MIN_COMPS &&
              freshestDaysAgo <= STRONG_EVIDENCE_MAX_DAYS;
            const effectiveNearFloorRatio = strongEvidence
              ? STRONG_EVIDENCE_RATIO
              : NEAR_FLOOR_RATIO;
            const soldMatchedFloorGuard =
              soldDerivedSource &&
              soldCount >= 2 &&
              soldBasis != null &&
              soldBasis >= floorResult.floor * effectiveNearFloorRatio;

            if (isSuspectContaminated) {
              // Option 2+: Flag contamination, RESEARCH decision, hard-lock
              out.floorContaminationSuspect = true;
              out.floorContaminationReason =
                `Verified solds ($${soldBasis.toFixed(0)}) far below key floor ($${floorResult.floor.toLocaleString()}) — pool may contain reprints`;
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
                `${title} #${confirmedIssue} basis=$${soldBasis.toFixed(0)}`,
                `(${hasSoldData ? 'soldAvg' : 'sold-derived price, soldAvg unavailable'})`,
                `floor=$${floorResult.floor.toLocaleString()}`,
                `(${((soldBasis / floorResult.floor) * 100).toFixed(0)}% of floor) → RESEARCH + hard-locked`);
            } else if (soldMatchedFloorGuard) {
              // Q90: sold-derived price stands (slab or raw); floor band
              // retained as reference display only (never re-anchors price
              // or bands).
              out.megaKeyFloorSuppressed = true;
              out.megaKeyFloorBand = {
                low: floorResult.floor,
                high: floorResult.priceHigh,
                bucket: floorResult.bucket,
                reason: 'sold-pool-matched-near-floor',
              };
              out.floorBandLow = fmtUsd(floorResult.floor);
              out.floorBandHigh = fmtUsd(floorResult.priceHigh);
              console.log('[Q90] mega-key floor SUPPRESSED:',
                `${title} #${confirmedIssue} grade=${grade} bucket=${floorResult.bucket}`,
                `price=${out.price} (${out.pricingSource}, ${soldCount} solds, graded=${isGraded === true})`,
                `basis=${soldBasis != null ? '$' + soldBasis.toFixed(2) : 'n/a'} ratio=${effectiveNearFloorRatio}`,
                `(strongEvidence=${strongEvidence}, freshestDaysAgo=${Number.isFinite(freshestDaysAgo) ? freshestDaysAgo : 'n/a'})`,
                `— floor band $${floorResult.floor}–$${floorResult.priceHigh} retained as reference`);
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

              // GL-1 / D-3 option B: floor override re-anchors the bands —
              // one price per card. Pre-fix the response carried sold-derived
              // bands ($22,335 market) beside a $30,000 floor price (X-Men
              // Q7.0 scan, dh9xr-17838111). Floor IS the single source of
              // truth when it fires.
              out.priceBands = {
                quick: floorResult.floor,
                market: floorResult.floor,
                stretch: floorResult.priceHigh ?? floorResult.floor,
                source: 'mega-key-floor',
                count: out.priceBands?.count ?? null,
                tier: out.priceBands?.tier ?? null,
                variantAdjusted: out.priceBands?.variantAdjusted || false,
              };
              console.log(
                `[price-bands] rebuilt-from=mega-key-floor market=$${floorResult.floor} ` +
                `stretch=$${floorResult.priceHigh ?? floorResult.floor}`
              );
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

    // GL-2 (EX-5): Qualified/Restored label — refuse to price + hard-lock.
    // Every pricing source in this pipeline (sold comps, active comps, PC,
    // mega-key floors) is blue-label Universal data. A green QUALIFIED or
    // purple RESTORED copy trades at a fraction of that, so no number this
    // engine can produce is honest. X-Men #1 CGC QUALIFIED 7.0 "PAGE 12
    // MISSING" (dh9xr-17838111) shipped $30,000 off 16 Universal solds +
    // the mega-key floor. Structural, not advisory (22d pattern).
    if (isImpairedLabel && !out.refusedToPrice) {
      const labelWord = impairedLabelClass === 'restored' ? 'Restored' : 'Qualified';
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.priceBands = null;
      out.pricingSource = 'refused-qualified-label';
      out.refusedToPrice = true;
      out.confidenceLevel = 'LOW';
      out.priceNote = `${labelWord} label — comps not applicable`;
      out.listingHardLocked = true;
      out.listingHardLockReason =
        impairedLabelClass === 'restored' ? 'restored-label' : 'qualified-label';
      out.listingHardLockBanner = `${labelWord} label — comps not applicable`;
      // Neutralize downstream band writers: floor re-enforcement and the
      // Q59 drift rebuild key off these flags and would resurrect a price
      // (or crash on the nulled priceBands) for a refused card.
      out.thinPoolAnchored = false;
      out.floorReEnforced = false;
      floorFired = false;
      sanityFired = false;
      console.log(
        `[label-gate] REFUSED — ${labelWord} label` +
        (labelNotes ? ` notes="${labelNotes}"` : '') +
        ` — Universal comps suppressed, listing hard-locked`
      );
    }

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
    // GL-1 (I11 support): rebuild also fires on ANY residual drift between
    // finalPrice and the published band market — variant/key multipliers
    // rewrite out.price without setting the three named flags, leaving two
    // numbers on one card. Mega-key floor excluded: it rebuilds its own
    // bands (D-3 option B above) and must not be overwritten here.
    const bandDrift = (() => {
      if (!priceBandsRaw || !out.price || out.megaKeyFloorApplied) return false;
      const p = parseFloat(String(out.price).replace(/[$,]/g, ''));
      return Number.isFinite(p) && Math.abs(p - priceBandsRaw.market) > 0.011;
    })();
    if (priceBandsRaw && !out.megaKeyFloorApplied &&
        (out.floorReEnforced || out.thinPoolAnchored || sanityFired || bandDrift)) {
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
    // `finalPrice` reflects the actual returned value.
    //
    // D2 (Commit D2) — `postFloorPreMultSnapshot` (was labeled `afterMult`)
    // is a snapshot of out.price taken after floor enforcement, before
    // variant/key multipliers — it is NOT pcBase×gradeMultiplier's
    // product, and never was: for any tier-1/2/2.5/3 result (sold- or
    // active-comp-derived — the common case whenever comps exist at all),
    // this value is the tier's own recency-weighted/blended/discounted
    // output, computed independently of pcBase entirely. `pcBase`/
    // `gradeMultiplier` below are logged for reference only — see
    // out.priceDerivationTrace for the actual, mathematically verified
    // calculation chain (src/lib/priceBands.js's computePriceBands, only
    // Tier 4 ever multiplies pcBase by gradeMultiplier as a real step).
    console.log('[price-trace]',
      'pcBase(reference-only):', priceCharting?.price,
      'gradeMultiplier(reference-only):', out.gradeMultiplier,
      'postFloorPreMultSnapshot:', priceAfterFloor,
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
    if (out.priceDerivationTrace) {
      const t = out.priceDerivationTrace;
      const finalOp = t.operations?.[t.operations.length - 1];
      console.log(
        `[price-derivation] source=${t.pricingSource} ` +
        `steps=${(t.operations || []).map((o) => o.step).join('->')} ` +
        `finalOperation.outputValue=${finalOp?.outputValue} trace.finalPrice=${t.finalPrice}`
      );
    }

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
      const visionConfidence = normalizeVisionConfidence(confidence);
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

      // P0 (Q-VISION-ZERO-SUPPORT) — one-tier confidence demotion when
      // Vision's issue had zero pool support and was overridden/escalated
      // by resolveIdentity. Card-visible verify note is out.visionZeroSupport
      // (set at Phase 1, same call site as the identity resolution).
      if (out.matchConfidenceDemote) {
        if (finalMc.tier === 'HIGH') {
          const originalScore = finalMc.score;
          finalMc.tier = 'MEDIUM';
          finalMc.score = Math.min(finalMc.score, 75);
          finalMc.displayMessage = out.visionZeroSupport?.note || 'Identity corrected from comp pool — verify before listing';
          finalMc.visionZeroSupportCapped = true;
          finalMc.originalScore = originalScore;
        } else if (finalMc.tier === 'MEDIUM') {
          const originalScore = finalMc.score;
          finalMc.tier = 'LOW';
          finalMc.score = Math.min(finalMc.score, 60);
          finalMc.displayMessage = out.visionZeroSupport?.note || 'Identity corrected from comp pool — verify before listing';
          finalMc.visionZeroSupportCapped = true;
          finalMc.originalScore = originalScore;
        }
        console.log(`[vision-zero-support] match-confidence demoted one tier (capped=${finalMc.visionZeroSupportCapped === true})`);
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

      // Q-FLASHGORDON13-BADGE — active-pool-exhausted cap. compsExhausted
      // means verifyCompsTitles (the Haiku ai_verify pass) rejected 100%
      // of the checked ACTIVE eBay listings (still only the <=5-item
      // recentSales sample post-1f05785 — see Q-pool-truncation above;
      // compsExhausted intentionally stayed scoped to that checked sample,
      // not rawComps.prices as a whole, per the 2026-07-16 ruling: a 100%
      // rejection on the checked sample is real evidence the query itself
      // is likely contaminated, and any untouched items behind it were
      // never individually verified either) -- decisionEngine already
      // surfaces this as the 'ai-verify-rejected-all' warning. But
      // compTitlesForScore (above) silently falls through to the SOLD
      // comps pool once the active pool is emptied by that rejection.
      // NOTE (corrected 2026-07-16): rawComps.recentSales/.prices are NOT
      // necessarily rebuilt empty at the 0-kept branch anymore — since
      // 1f05785, untouched items beyond the checked sample survive into
      // rawComps.prices. This cap still fires on compsExhausted regardless
      // (see ruling above), so its behavior is unchanged; only this
      // comment's "rebuilt empty" claim was stale. None of the OTHER caps
      // in this chain reference compsExhausted -- a sold-comp-driven score
      // can still reach HIGH while a rejection warning fires on the same
      // card. Real production case: Flash Gordon #13, ai_verify kept 0/5
      // active listings, matchConfidence still scored 100/HIGH off 16
      // independently-verified sold comps -- "✓ Verified 100" next to a
      // RESEARCH/low-confidence decision on the same card. Same cap shape
      // as the sibling check above (HIGH->MEDIUM, score capped at 75); the
      // client already renders MEDIUM as "~ Similar NN" (App.jsx ~5572)
      // with zero new UI needed. Only fires the message if the sold-comp
      // cap above didn't already set one, so the more specific reason wins.
      if (compsExhausted && finalMc.tier === 'HIGH') {
        const originalScore = finalMc.score;
        finalMc.tier = 'MEDIUM';
        finalMc.score = Math.min(finalMc.score, 75);
        if (!hasSoldCompsButNoneVerified) {
          finalMc.displayMessage = 'Active listings all rejected by verification — priced from sold comps only';
        }
        finalMc.activeVerifyExhaustedCapped = true;
        finalMc.originalScore = originalScore;
        console.log(`[match-conf] active-verify-exhausted cap: HIGH→MEDIUM (${originalScore}→${finalMc.score})`);
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
      out.soldEvidence = null;
    } else {
      out.soldComps = filteredSold;
      out.soldCompsRaw = capRawSoldRows(rawSoldRows);
      out.soldCompDiagnostics = soldVerifyResult.diagnostics;
      // D1 — sanitized reference groups (Commit D1). Display-only, never
      // the pricing-eligible pool itself (that's out.soldComps above,
      // already gated to rawPricingPool by verifySoldComps).
      out.soldEvidence = soldVerifyResult.evidence || null;
      // FIX 2: Surface sold-only average (computed at line 2354-2356)
      out.soldCompsAvg = soldAvg;
      // Book-level comps cache — surface timestamp and comps for persistence
      out.compsCachedAt = useBookCompsCache ? bookCompsCachedAt : now;
      out.activeCached = compsFromEbay;
      out.soldCompsRawCached = capRawSoldRows(rawSoldRows);
      // Q89-CACHE: stamp the comp-filter version the active pool was built
      // with — book cache is only trusted when versions match (see gate).
      out.compFilterVersion = COMP_FILTER_VERSION;
      // Q91: surface sold-retention so the card can label the pool stale.
      if (q91SoldRetention) {
        out.soldRetentionStale = true;
        out.priceNote = (out.priceNote || '') + ' · sold pool retained (stale fetch)';
      }
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
      // Q-audit COMMIT 5 — month-over-month price trend, same PC HTML.
      if (
        pcSales.priceChart &&
        ((pcSales.priceChart.used?.length || 0) + (pcSales.priceChart.graded?.length || 0)) > 0
      ) {
        out.priceChart = pcSales.priceChart;
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
    // GL-1 (EX-2): refused state suppresses the recommendation entirely.
    // Pre-fix, price=null fell through to rawComps.average×1.15 and the
    // [verify] line advertised "$13" for a book the engine refused to price
    // (Sweethearts #130, z7kwx-1783797060030).
    const recommendedPrice = out.refusedToPrice
      ? null
      : finalPriceNum > 0
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
        // Q-ADV397 — confirmedIssue is null exactly when resolveIdentity's
        // zero-support check already escalated this scan (Vision's issue
        // had zero pool support AND no adoptable alternate — see
        // vision-zero-support ESCALATE above). That decision must not be
        // silently reachable-around by a later, independent assignment:
        // out.issue was landing on visualResult's value regardless, while
        // identityEscalation (the correct signal) was never read again
        // after resolveIdentity returned it. A real production case
        // (Adventure Comics #397) shipped decision.action=ID_REQUIRED
        // alongside out.issue="401" -- confidently wrong, not missing.
        //
        // Q140 terminal fingerprint invariant (2026-07-23) — the other half
        // of the same class of bug: this used to unconditionally overwrite
        // out.issue with visualResult.issue whenever confirmedIssue was
        // non-null, with no check that the two agreed. confirmedIssue has
        // already driven comp search and pricing by this point in the
        // pipeline — a disagreeing visualResult.issue landing in out.issue
        // here would make the card display a DIFFERENT issue than the one
        // its own price was computed against. out.issue is no longer
        // written from visualResult here at all; confirmedIssue is the sole
        // source of truth for it (the single terminal write, further
        // down). A disagreement is surfaced as an annotation instead of a
        // silent divergence (I13 — never suppress, never fabricate).
        out.claudeIssue = visualResult.claudeIssue;
        if (visualResult.issueSource === "ebay_visual" && confirmedIssue != null) {
          const divergence = detectVisualIssueDivergence(confirmedIssue, visualResult.issue);
          // Q140 corrective dispatch (2026-07-23, review fix) — do not
          // clobber a richer conflict already surfaced by resolveIdentity's
          // family-consensus check above (out.issueConsensusConflict may
          // already be set with real support/population/ratio metadata).
          // This is a separate, later, coarser signal (visualResult.issue
          // is itself a pool-WIDE eBay consensus value, exactly the kind of
          // possibly-wrong-family signal Q140 exists to distrust) — it
          // fills the gap for identity sources that never ran family
          // consensus at all (manual/barcode/CGC), but never overrides the
          // more authoritative family-scoped conflict when one exists.
          if (divergence && !out.issueConsensusConflict) {
            // support/population/ratio are honestly null — this is a bare
            // two-value comparison against an already-aggregated eBay
            // value, not a fresh per-row vote (I13: never fabricate).
            out.issueConsensusConflict = {
              currentIssue: divergence.confirmedIssue,
              consensusIssue: divergence.visualIssue,
              currentSource: identitySource,
              support: null,
              population: null,
              ratio: null,
              decision: 'locked',
            };
            console.log(
              `[q140-terminal] visual-pool issue diverges from confirmedIssue ` +
              `(confirmed=#${divergence.confirmedIssue}, visual=#${divergence.visualIssue}) — ` +
              `confirmedIssue wins, out.issue never overwritten`
            );
          }
        } else if (visualResult.issueSource === "ebay_visual") {
          console.log(`[visual-guard] suppressed out.issue overwrite (visual="${visualResult.issue}") — confirmedIssue already null from identity escalation`);
        }
      }
    }

    // Track B Phase 0, Commit 4 (2026-07-29) — contradiction escalation. A
    // marketplace-only-adopted issue (out.issueAuthority.status ===
    // 'provisional', set above at resolveIdentity time from
    // resolveFamilyIssueConsensus's 'adopted' mode) that a LATER
    // marketplace population disagrees with escalates to 'conflicted',
    // preserving every existing reason and appending the new one — never
    // silently dropped, never silently re-confirmed. out.issueConsensusConflict
    // can only have been set here (by the divergence check immediately
    // above) when the family-consensus check upstream did NOT already fire
    // 'conflict-locked' — which resolveFamilyIssueConsensus guarantees is
    // disjoint from 'adopted' (exactly one mode per call) — so a conflict
    // object present at this point, on a provisional-from-adoption card, is
    // a genuine SECOND, differently-scoped marketplace signal (the
    // family-scoped adoption vote vs. this pool-wide eBay visual
    // consensus), not a re-check of the same evidence that produced
    // 'adopted' in the first place. NOT independent corroboration in the
    // sense that could ever promote status toward 'confirmed' — both
    // signals are marketplace/pool evidence, same source class; genuine
    // independence (Vision, physical indicia/fingerprint, or an explicit
    // user correction — Commit 3) is required for that, and escalation
    // here only ever moves toward MORE uncertainty ('conflicted'), never
    // less. Real call site for the extracted, exported
    // escalateIssueAuthorityOnConflict (src/lib/issueAuthority.js).
    {
      const escalated = escalateIssueAuthorityOnConflict(out.issueAuthority, out.issueConsensusConflict);
      if (escalated !== out.issueAuthority) {
        out.issueAuthority = escalated;
        console.log(
          `[commit4] issueAuthority escalated provisional -> conflicted: ` +
          `visual-pool divergence detected against marketplace-adopted issue #${out.issueConsensusConflict.currentIssue} ` +
          `(pool suggests #${out.issueConsensusConflict.consensusIssue})`
        );
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

    // CGC identity override removed — cgcResult now applied in Phase 1
    // before comp queries run. See Fix-1 (Q106) commit for context.

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
      variant: safeReqVariant,
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
      // (EX-1 silence on dpl_43c65g9 / build 2b19171). price/title were the
      // original minimal shape for that consumer; url/date/condition
      // (Q-audit COMMIT 6) are additive display fields comps.js already
      // attaches to every listing during filtering (confirmed they survive
      // the AI-verify pass unstripped, enrich.js:3479-3481) -- they were
      // simply discarded at this one reduction step, not lost upstream.
      prices: Array.isArray(rawComps.prices)
        ? rawComps.prices.map((p) => ({
            price: typeof p === 'number' ? p : (p?.price ?? null),
            title: p?.title || null,
            url: p?.url || null,
            date: p?.endTime || null,
            condition: p?.conditionDisplayName || null,
          }))
        : [],
    } : { count: 0 };

    // 2. compPoolContaminated: universal flag for variant/reprint fallback
    // Q110 dispatch Part 3 (2026-07-18) — out.variantFallback/reprintFallback
    // were never copied from rawComps (api/comps.js computes and returns
    // them, but this file's copy-forward block only ever threaded
    // artistFallback/premiumVariantIsolated). This warning could never fire.
    out.variantFallback = out.variantFallback || rawComps?.variantFallback || false;
    out.reprintFallback = out.reprintFallback || rawComps?.reprintFallback || false;
    if (out.variantFallback || out.reprintFallback) {
      out.compPoolContaminated = true;
    }

    // D1 — sanitized active-pool reference groups (Commit D1). Same
    // copy-forward gap class as variantFallback/reprintFallback just
    // above: api/comps.js computes and returns this, but without an
    // explicit thread-through it would never reach the card either.
    // Display-only — never the pricing-eligible pool itself (that's
    // out.rawComps.prices above, already gated to rawPricingPool by
    // fetchComps).
    out.activeEvidence = rawComps?.evidence || null;

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
    //
    // Q135 dispatch (2026-07-22, Lozano/Rachta Lin follow-up) — this is a
    // FIFTH site sharing the exact "unconditional raw-Vision fallback"
    // shape Q134 fixed at 4 other call sites (PC query year, publisher
    // fallback, resolveYear input, banner selector) — missed then because
    // it lives in the decision-engine normalize block, not the identity-
    // resolution block those four came from. `issueNum`/`year`/`publisher`
    // are the SAME raw, pre-resolution local variables Q131/Q134 already
    // established must not leak back in for a provisional identity — a
    // card whose confirmedYear/confirmedPublisher are honestly null here
    // (pool didn't corroborate) would otherwise have this block silently
    // resurrect Vision's rejected guess into out.year/out.publisher, which
    // is exactly what the client then displays. confirmedIssue is
    // included for the same reason even though it's rarely null in
    // practice — same principle, no exception carved out for it.
    //
    // Q140 terminal fingerprint invariant (2026-07-23, review fix —
    // BLOCKER 2) — this is now the ONLY site in the request lifecycle that
    // writes out.issue, and it reads EXACTLY ONE variable: confirmedIssue.
    // The previous form (`confirmedIssue || (identityIsProvisionalOverride
    // ? null : issueNum) || null`) was one assignment STATEMENT but two
    // authority SOURCES — when confirmedIssue was deliberately nulled by
    // resolveIdentity (vision-zero-support escalate, refused-identity-
    // conflict with no adoptable issue, etc.) for a NON-provisional
    // identity, this fallback silently rehydrated the raw, pre-resolution
    // issueNum anyway — undoing that deliberate null and shipping a
    // "confidently wrong" issue on a card the server had already decided
    // NOT to assert an issue for (the Immortal Hulk class: server
    // issue=null, card rendered #1). If issueNum is ever a legitimate
    // fallback for some case, that decision belongs INSIDE canonical
    // resolution (resolveIdentity / the branch that sets confirmedIssue),
    // before pricing runs — never reintroduced here, where it bypasses the
    // entire consensus rewrite. confirmedIssue is now the single authority
    // for out.issue, full stop.
    if (!out.issue) {
      // Track B Phase 0, Commit 4.3 (Section E, revised — shared custody
      // invariant) — call site 4 of 4 (response finalization). By this
      // point Phase 2/pricing already ran using confirmedIssue — this
      // check can no longer PREVENT anything, only ANNOTATE (I13: never
      // silently suppress) a genuine divergence between the family's own
      // resolved authority and the value about to be written to out.issue
      // (the single terminal write, per this block's own established
      // convention). Composed with, not replacing, the pre-existing Q140
      // detectVisualIssueDivergence below (a different source pair —
      // visual-pool consensus vs. confirmedIssue).
      const responseCustodyCheck = checkCrossPopulationPromotionGuard(
        identity?.familyIssueConsensus, { responseIssue: confirmedIssue }
      );
      if (!responseCustodyCheck.allowed && !out.crossPopulationPromotionBlocked) {
        out.crossPopulationPromotionBlocked = responseCustodyCheck.conflict;
        console.log(
          `[commit4.3] response-finalization custody blocked: selectedFamilyIssue=${responseCustodyCheck.conflict.selectedFamilyIssue} ` +
          `responseIssue=${responseCustodyCheck.conflict.mismatchedValue}`
        );
      }
      out.issue = confirmedIssue ?? null;
    } else {
      console.log(`[q140-terminal] INVARIANT VIOLATION: out.issue was already set to "${out.issue}" before the terminal write — a new upstream writer bypassed confirmedIssue`);
    }

    // Q140 corrective dispatch (2026-07-23, review fix) — explicit dual-
    // boundary fingerprint check, not just a single-writer projection.
    // Boundary 1 (pre-pricing): pricingIssue was captured the instant
    // identity resolution finished, in every branch (barcode/manual/cgc/
    // resolveIdentity) — the exact value that flowed unmodified into
    // fetchComps({ issue: confirmedIssue, ... }), the call that actually
    // decided which comps got searched/priced. If it differs from
    // confirmedIssue here, only one legitimate cause exists: the Q83
    // ebay_comp_consensus rescue corrected a null identity using the
    // comps that were ALREADY fetched under that null issue (it does not
    // re-query) — out.identityFromConsensus is the signal for that,
    // logged as a correction, not a violation. Any other divergence is
    // the exact silent-drift bug this dispatch closes.
    const pricingBoundaryOk = pricingIssue === confirmedIssue || out.identityFromConsensus === true;
    // Boundary 2 (pre-response): with the BLOCKER-2 fix above, out.issue
    // is derived from confirmedIssue alone — this is now a direct equality
    // check, no fallback-chain special case needed.
    const responseBoundaryOk = out.issue === (confirmedIssue ?? null);
    console.log(
      `[q140-terminal] fingerprint invariant — pre-pricing: pricingIssue="${pricingIssue}" ` +
      `confirmedIssue="${confirmedIssue}" ${pricingBoundaryOk ? 'OK' : 'VIOLATION'}` +
      `${out.identityFromConsensus ? ' (corrected via Q83 rescue)' : ''}; ` +
      `pre-response: out.issue="${out.issue}" confirmedIssue="${confirmedIssue}" ${responseBoundaryOk ? 'OK' : 'VIOLATION'}`
    );
    // Q140 corrective dispatch (2026-07-23, review round 3 — price
    // authority) — the VIOLATION path now clears PRICE authority itself,
    // not just routing/listing. A locked card that still displayed
    // "Recommended: $10.77" (calculated against issue #170) while showing
    // "The Flash #139" would still be misleading even though it couldn't
    // be listed — price/recommendedPrice/priceBands are separate fields
    // with separate authority from decision.action/bestChannel/listable.
    //
    // Ordering, cited honestly: this check runs at the very END of the
    // request lifecycle (the terminal out.issue write, just above) —
    // AFTER the entire pricing pipeline (tier1-4 synthesis, comps fetch,
    // sold verification) has already run and already set out.price/
    // out.priceBands/out.matchConfidence using whatever confirmedIssue was
    // in scope at fetch time (pricingIssue). It is structurally impossible
    // to prevent the price from being calculated before this point — the
    // violation can only be detected once out.issue is FINAL, which by
    // definition is the last write. What this block does instead is
    // retroactively clear that already-computed price the instant the
    // violation is detected, before the response ever leaves the server —
    // out.decision = computeDecision(out, {...}) (~line 8707) and the
    // client response finalization both run AFTER this block, so they see
    // the cleared state, never the stale $10.77.
    //
    // Reuses the EXISTING, established refused-price pattern byte-for-byte
    // (see the polybag-pc-divergence branches above, e.g. ~line 5385-5399)
    // rather than inventing a new mechanism: out.price/priceLow/priceHigh/
    // priceBands nulled, pricingSource relabeled 'refused-*', refusedToPrice
    // set true (routes responseContract.js's deriveState to 'REFUSED',
    // which nulls contract.price/contract.bands too — the Customer-Grade
    // Standard P0 rule: "Refused states: Render $0 everywhere OR render
    // nothing"), confidenceLevel demoted to LOW, matchConfidence demoted
    // to LOW/0 (the live "is this price trustworthy" signal in this
    // codebase — GoCollect CGC FMV is dormant, not a real field to clear).
    // Plus the listingHardLocked trio and the issueFingerprintViolation
    // diagnostic object already wired to decisionEngine.js's criticalWarnings
    // (action/bestChannel/listable lock — proven separately).
    if (!pricingBoundaryOk || !responseBoundaryOk) {
      console.log(
        `[q140-terminal] INVARIANT VIOLATION${!pricingBoundaryOk ? ' (pre-pricing boundary)' : ''}` +
        `${!responseBoundaryOk ? ' (pre-response boundary)' : ''}: pricingIssue="${pricingIssue}" ` +
        `confirmedIssue="${confirmedIssue}" out.issue="${out.issue}" — clearing price authority, locking listing, forcing RESEARCH`
      );
      out.issueFingerprintViolation = {
        pricingIssue: pricingIssue != null ? String(pricingIssue) : null,
        confirmedIssue: confirmedIssue != null ? String(confirmedIssue) : null,
        outIssue: out.issue != null ? String(out.issue) : null,
        pricingBoundaryOk,
        responseBoundaryOk,
      };
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.priceBands = null;
      out.pricingSource = 'refused-issue-fingerprint-violation';
      out.refusedToPrice = true;
      out.confidenceLevel = 'LOW';
      out.priceNote = 'Pricing was computed against a different issue than the confirmed identity — price withheld pending review.';
      out.matchConfidence = { score: 0, tier: 'LOW' };
      out.listingHardLocked = true;
      out.listingHardLockReason = out.listingHardLockReason || 'issue-fingerprint-violation';
      out.listingHardLockBanner = out.listingHardLockBanner
        || 'Internal consistency check failed on issue identification — listing blocked pending review.';
    }

    // Commit B (Strange Tales dispatch, 2026-07-28) — market-evidence
    // authority. Same strategic terminal position as the Q140/E1 blocks —
    // runs immediately before out.decision = computeDecision(...), so
    // nothing downstream can re-touch these fields. Sequenced BEFORE the
    // E1 block below: both use the refused-price pattern and both guard
    // on `!out.refusedToPrice`, so whichever fires first correctly
    // prevents the other from double-firing — an unresolved issue is a
    // more fundamental problem than "zero evidence with an exact PC
    // anchor," so it takes priority when both could apply.
    if (!out.refusedToPrice) {
      // Commit A.2 already forces rawPricingPool=[] for every row when
      // confirmedIssue is null (evidenceEligibility.js) — these counts
      // reflect that directly rather than re-deriving it, so the two
      // mechanisms can't drift apart.
      const activeExactCount = confirmedIssue != null ? (rawComps?.count || 0) : 0;
      const soldExactCount = confirmedIssue != null ? (soldVerifyResult?.verified?.length || 0) : 0;
      const exactMarketEvidenceCount = activeExactCount + soldExactCount;
      const marketEvidenceReady = exactMarketEvidenceCount > 0;

      out.exactMarketEvidenceCount = exactMarketEvidenceCount;
      out.marketEvidenceReady = marketEvidenceReady;

      if (confirmedIssue == null && out.price != null) {
        // Item B.4 — a price is present despite genuinely unresolved
        // issue identity. Tier 4's pc_estimate path doesn't require any
        // comps at all (just a PriceCharting title-only match), so it can
        // still fire and set out.price even when confirmedIssue is null —
        // exactly the "recommended: $41" shape this item exists to close.
        // Relabeled, never silently nulled-and-hidden (I13: annotate,
        // don't vanish) — then structurally demoted the same way E1
        // demotes a catalog-ladder value, reusing the same established
        // refused-price pattern.
        console.log(
          `[commitB-market-evidence] confirmedIssue null but out.price=${out.price} was set ` +
          `(source=${out.pricingSource}) — relabeled hypotheticalReferenceEstimate, price/bands ` +
          `cleared, never presented as "recommended"`
        );
        out.hypotheticalReferenceEstimate = out.price;
        out.authoritativeRecommendation = null;
        out.price = null;
        out.priceLow = null;
        out.priceHigh = null;
        out.priceBands = null;
        out.pricingSource = 'hypothetical-reference-issue-unresolved';
        out.refusedToPrice = true;
        out.confidenceLevel = 'LOW';
        out.matchConfidence = { score: 0, tier: 'LOW' };
        out.listingHardLocked = true;
        out.listingHardLockReason = 'target-issue-unresolved';
        out.listingHardLockBanner = 'The specific issue number could not be confirmed for this book — similar-title references are shown for context only. Listing is blocked pending identification.';
      } else {
        // authoritativeRecommendation mirrors out.price only when real
        // market evidence backs it — never a bare passthrough. When
        // marketEvidenceReady is false (including every confirmedIssue-
        // null case that didn't hit the branch above because out.price
        // was already honestly null), this is null too.
        out.authoritativeRecommendation = marketEvidenceReady ? out.price : null;
      }
    }

    // Commit E1 (2026-07-28) — catalog ladder reference, made authoritative
    // as reference-ONLY. Positioned at this exact strategic point (same as
    // the Q140 issue-fingerprint-violation block just above, for the same
    // reason: this is the last point in the pipeline before
    // out.decision = computeDecision(...) below, so nothing downstream --
    // floor guard, variant/key multipliers, mega-key floor, thin-pool
    // anchor, all of which already ran earlier in this handler -- can
    // silently re-touch out.price after this clears it. Guarded on
    // `!out.refusedToPrice` so this never layers onto an already-refused
    // card (e.g. the Q140 violation above) -- one refusal reason per card,
    // never two competing ones.
    //
    // pcAnchorTrust (not isFromPC -- see assessPcAnchorTrust's own doc
    // comment for why they're different questions) must be EXACT_EDITION
    // for V1. rawComps/soldVerifyResult/out.conflicts/
    // out.pcMatchRejectedForYearConflict are all already resolved by this
    // point (comps fetch ~line 4730, sold verify ~5059, ship28b-conflicts
    // ~4715, pc-anchor-gate ~3953 -- all well before this line).
    if (!out.refusedToPrice) {
      const activeRawEmpty = (rawComps?.count || 0) === 0;
      const activeGradedEmpty = (rawComps?.evidence?.gradedPricingReferences?.length || 0) === 0;
      const soldRawEmpty = (soldVerifyResult?.verified?.length || 0) === 0;
      const soldGradedEmpty = (soldVerifyResult?.evidence?.gradedPricingReferences?.length || 0) === 0;

      const pcAnchorTrust = assessPcAnchorTrust({
        pcPrice: priceCharting?.price || null,
        pcYear: priceCharting?.year || null,
        confirmedYear: confirmedYear || year || null,
        pcMatchRejectedForYearConflict: out.pcMatchRejectedForYearConflict === true,
        identityConflictCount: out.conflicts?.length || 0,
      });

      // Same grade-key derivation as before (matches
      // api/pricecharting-pop.js's formatGradeKey exactly): graded books
      // reuse userGradeKeyForSold's ".0"-suffix format verbatim; raw books
      // mirror the Q109-LADDER derivation in soldVerification.js (AI-
      // assessed grade string -> numeric CGC-equivalent via
      // parseListingGrade -> same ".0"-suffix rule). No fallback to the
      // bare "raw"/"Ungraded" ladder bucket for a specific numeric grade.
      let catalogLadderGradeKey = null;
      if (isGraded === true && numericGrade != null) {
        catalogLadderGradeKey = Number.isInteger(numericGrade) ? `${numericGrade}.0` : String(numericGrade);
      } else {
        const rawNumericTarget = parseListingGrade(grade);
        if (rawNumericTarget != null) {
          catalogLadderGradeKey = Number.isInteger(rawNumericTarget) ? `${rawNumericTarget}.0` : String(rawNumericTarget);
        }
      }

      const gradeBasis = assessGradeBasis({
        isGraded,
        grade,
        numericGrade,
        imagesCount: Array.isArray(images) ? images.length : null,
      });

      const catalogLadderReference = assessCatalogLadderReference({
        rawPricingPoolEmpty: activeRawEmpty && soldRawEmpty,
        gradedReferencesEmpty: activeGradedEmpty && soldGradedEmpty,
        pcAnchorAccepted: pcAnchorTrust === 'EXACT_EDITION',
        priceLadder: pcSales?.priceLadder || null,
        gradeKey: catalogLadderGradeKey,
        gradeBasis,
      });

      if (catalogLadderReference) {
        console.log(
          `[catalog-ladder-reference] fired: grade=${catalogLadderReference.rungGrade} ` +
          `value=$${catalogLadderReference.rungValue} provenance=${catalogLadderReference.rungProvenance} ` +
          `gradeBasis=${gradeBasis} pcAnchorTrust=${pcAnchorTrust} — ` +
          `clearing all actionable price fields, reference-only`
        );
        out.catalogLadderReference = catalogLadderReference;
        out.pcAnchorTrust = pcAnchorTrust;
        // Reuses the EXISTING refused-price pattern byte-for-byte (same as
        // the Q140 block just above) rather than inventing a second
        // mechanism -- routes responseContract.js's deriveState to
        // 'REFUSED' (price/bands null everywhere) and forces decisionEngine's
        // RESEARCH action via the 'refused-to-price' criticalWarnings entry
        // (never DO_NOT_LIST -- that only fires from the separate hard-
        // blockers array, which this deliberately does not touch: a
        // catalog reference is a real, if non-actionable, data point, not
        // "no data sources at all").
        out.price = null;
        out.priceLow = null;
        out.priceHigh = null;
        out.priceBands = null;
        out.pricingSource = 'catalog_ladder_reference';
        out.refusedToPrice = true;
        out.confidenceLevel = 'LOW';
        out.priceNote = 'No comp-based evidence available — showing a PriceCharting catalog reference only, not a recommended price.';
        out.matchConfidence = { score: 0, tier: 'LOW' };
        out.listingHardLocked = true;
        out.listingHardLockReason = 'catalog-ladder-reference-only';
        out.listingHardLockBanner = 'No verified comps or sales exist for this book — a catalog reference value is shown for context only. Listing is blocked pending real market evidence.';
      }
    }

    if (!out.year) {
      out.year = confirmedYear || (identityIsProvisionalOverride ? null : year) || null;
    }

    if (!out.publisher) {
      out.publisher = confirmedPublisher || (identityIsProvisionalOverride ? null : publisher) || null;
    }

    // Track B Phase 0, Commit 3 — manual-correction provenance. Calls the
    // extracted, exported buildManualCorrectionProvenance
    // (src/lib/manualCorrection.js) so this call site and this feature's
    // tests invoke the identical construction (invariant 10). Only
    // populated when this request passed manual-authority validation above
    // (manualCorrectionRequest.valid === true, Safeguards 1+2) — never
    // inherited/guessed for older cards with no manualAuthority at all
    // (honest-null over fabricated provenance). priorIdentity is
    // client-supplied (Safeguard 3) — buildManualCorrectionProvenance tags
    // every prior-value/prior-source record it produces with
    // `provenanceTrust: 'client-reported'`.
    if (manualCorrectionRequest?.valid) {
      const provenance = buildManualCorrectionProvenance(manualCorrectionRequest.validation, priorIdentity);
      out.manualCorrection = provenance.manualCorrection;
      if (provenance.issueAuthority) {
        out.issueAuthority = provenance.issueAuthority;
      }
    }

    // Q135 dispatch — out.variantNote (the field the client actually
    // displays as the variant badge, via `enrich.variantNote || cur.variant`)
    // was ONLY ever assigned inside the PC-multiplier pricing block
    // (isFromPC-gated, ~line 6037/6229) — never set at all for a
    // browse_api-priced card (no PC anchor), regardless of whether
    // confirmedVariant holds a real, honest value. Universal fallback so
    // every card threads its actual resolved variant through, not just
    // PC-anchored ones — this is a general fix (any browse_api-priced book
    // with a real variant had this same silent gap), not Q134/provisional-
    // specific; the provisional case simply made it visible because
    // confirmedVariant is honestly null there and the stale client value
    // never got overwritten.
    if (out.variantNote === undefined) {
      out.variantNote = confirmedVariant || null;
    }

    // Q27: Surface foreign edition flag from Vision
    if (req.body.foreignEdition === true) {
      out.foreignEdition = true;
      console.log('[q27] foreign edition detected — pc_estimate blocked');
    }

    // 3d. identityComplete: adapter-aware flag
    // Comic: issue required. Book: title + author required.
    // Computed AFTER fallback assignments so identity fields are populated
    // assetType already set at line 1475 from req.body destructure
    //
    // Q133 Slice 1c (2026-07-21) — this used to carry its OWN copy of the
    // "Crow Dead Time" publisher-skip logic (identitySource includes ebay/
    // title-family/manual, OR pcProductId exists), independently from
    // assessIdentityConfidence's copy of the identical check
    // (identityGate.js). Same drifted-duplicate-constant shape this
    // codebase has hit before (Q119's five compound-title whitelists,
    // Q128's year-tolerance constants) — two independently-maintained
    // copies of one skip rule, one more place for them to disagree.
    // Publisher completeness is now solely assessIdentityConfidence's job
    // (its missing-publisher-only case routes to listingHardLocked/
    // RESEARCH rather than a hard wall, not to identityComplete=false) —
    // consolidated here rather than patching both copies in sync forever.
    out.identityComplete = out.assetType === 'book'
      ? !!(out.title && out.author)
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

    // Q133 Slice 2 (C1 promotion) — finalize a promoted refused-identity
    // card right before computeDecision, once the ENTIRE normal pipeline
    // (Phase 2 comps/sold fetch, all pricing tiers, the identity-gate
    // above) has had its chance to run against the pool's provisional
    // identity.
    if (out.identityProvisional) {
      // Structural distinction (explicit, not a convention): title/issue/
      // year being populated from the pool's OWN provisional identity must
      // never read as Vision-agreed confidence, even though
      // assessIdentityConfidence (the identity-gate above) would otherwise
      // report confident=true here — every required field genuinely IS
      // present, it's just not an identity Vision and the pool agree on.
      // Forced here, unconditionally, regardless of what the identity-gate
      // computed. decisionEngine.js's identity-not-confident BLOCKER gets
      // an explicit exception for out.identityProvisional (mirroring the
      // existing isPublisherOnlyGap exception) so this doesn't silently
      // reopen a hard ID_REQUIRED wall — the card stays reachable via the
      // SAME listingHardLockReason==='identity-unresolved' mechanism
      // that's already been driving decisionEngine's identity-conflict-
      // unresolved warning (and RESEARCH-tier escalation) since Q110.
      out.identityConfident = false;

      // Q133 Slice 2 follow-up (2026-07-21) — narrowed from `out.price ==
      // null` to literally zero real evidence. The broader check conflated
      // two different situations: Phase 2 truly finding nothing (0 comps)
      // vs. Phase 2 finding a genuine but thin result (e.g. Lozano's real
      // 1-comp match) that the tier engine's own pre-existing >=2-comp
      // floor (calculatePriceBands, priceBands.js) declines to band,
      // leaving out.price null for an unrelated reason. The old check
      // couldn't tell those apart and silently substituted the stale
      // visual-pool-family median for a genuine thin result. Ruling: real,
      // book-specific data — even thin — beats a family-median guess; only
      // fall back when Phase 2 found LITERALLY nothing.
      const realPhase2EvidenceCount = (out.rawComps?.count || 0) + (out.soldComps?.length || 0);
      if (realPhase2EvidenceCount === 0 && refusalFallbackForPromoted?.fallbackPrice != null) {
        // Phase 2 genuinely found nothing (0 active comps, 0 sold comps) —
        // real data beats no data, but no data still beats an empty LOCKED
        // card. Falls back to the same visual-pool-median this book would
        // have shown before promotion existed — banner stays the ORIGINAL
        // "provisional ID" wording (set when identityRefused fired above),
        // since that wording is still accurate for this exact case.
        const fb = refusalFallbackForPromoted;
        console.log(
          `[phase2] promoted card found 0 real comps — falling back to visual-pool-median: ` +
          `median=$${fb.fallbackPrice} range=$${fb.fallbackLow}-$${fb.fallbackHigh}`
        );
        out.price = fmtUsd(fb.fallbackPrice);
        out.priceLow = fmtUsd(fb.fallbackLow);
        out.priceHigh = fmtUsd(fb.fallbackHigh);
        out.priceBands = {
          quick: fb.fallbackLow, market: fb.fallbackPrice, stretch: fb.fallbackHigh,
          source: fb.fallbackIsolatedToFamily ? 'visual_pool_family_isolated' : 'visual_pool_fallback',
          count: fb.fallbackPoolSize,
        };
        out.pricingSource = fb.fallbackIsolatedToFamily ? 'visual_pool_family_isolated' : 'visual_pool_fallback';
        out.priceNote = fb.fallbackIsolatedToFamily
          ? `Estimated from ${fb.fallbackPoolSize} listings matching the pool's own "${fb.topFamilyTitle}" family — identity unconfirmed, verify before listing.`
          : `Estimated from ${fb.fallbackPoolSize} visually similar active listings — identity unconfirmed, verify before listing.`;
        out.visualPoolUsed = true;
        out.visualPoolSize = fb.fallbackPoolSize;
        out.visualPoolIsolatedToFamily = fb.fallbackIsolatedToFamily;
      } else if (out.price != null) {
        // Real comps.js/sold data priced this card — source-honest banner,
        // deliberately distinct wording from the visual-pool-only fallback
        // above. The card must say which evidence class it's showing.
        const realCompCount = out.rawComps?.count || 0;
        const realSoldCount = out.soldComps?.length || 0;
        console.log(
          `[phase2] promoted card priced from real Phase 2 data — ` +
          `activeComps=${realCompCount} soldComps=${realSoldCount} price=${out.price}`
        );
        out.listingHardLockBanner =
          `Identity unconfirmed (visual pool disagrees with the AI read) — priced from ` +
          `${realCompCount} live comp${realCompCount === 1 ? '' : 's'}` +
          (realSoldCount > 0 ? ` and ${realSoldCount} verified sold record${realSoldCount === 1 ? '' : 's'}` : '') +
          ` — verify before listing`;
      }
      // else: out.price stayed null AND no fallback was available either —
      // genuinely nothing anywhere. Banner stays the default "Visual
      // identification uncertain" text set when identityRefused fired.
    }

    // Track B Phase 0, Commit 4.2 — fingerprint year finalization. Must
    // run BEFORE the commit4-terminal block below: it only touches
    // out.visualReferenceEvidence.familyKey (never price/decision fields),
    // so ordering relative to that block is not load-bearing for
    // correctness, but this keeps all Track B terminal blocks grouped in
    // one place and keeps the finalizer's own single log line adjacent to
    // its cause (confirmedYear's final resolveYear-driven value, above).
    // restampVisualReferenceEvidenceYear does its own internal logging
    // (both required formats, [commit4.2] fingerprint custody mismatch /
    // [commit4.2] familyKey finalized) — no duplicate log needed here.
    if (out.visualReferenceEvidence) {
      const restamp = restampVisualReferenceEvidenceYear(
        out.visualReferenceEvidence,
        visualReferenceFingerprintContext,
        confirmedYear,
        yearResolution.yearSource
      );
      out.visualReferenceEvidence = restamp.evidence;
    }

    // Track B Phase 0, Commit 4 (2026-07-29) — explicit server-side
    // contract transition for a marketplace-only-adopted issue
    // (out.issueAuthority.status === 'provisional' or escalated to
    // 'conflicted', above). Positioned as the LAST terminal block before
    // out.decision = computeDecision(...) — same strategic slot as the
    // Q140/Commit-B/E1 blocks above — so nothing downstream can re-touch
    // out.price after this clears it, including the Q133 Slice 2
    // promoted-card fallback immediately above, whose price this must
    // still be able to null. Real call site for the extracted, exported
    // computeIssueAuthorityContractPatch (src/lib/issueAuthority.js) —
    // see that file's doc comment for the full mechanism (why
    // identityConfident=false alone is sufficient to route through
    // decisionEngine's real ID_REQUIRED path) and the documented,
    // deliberate absence of a "no contradiction still confirmed"
    // carve-out anywhere in this commit's diff.
    {
      // Track B Phase 0, Commit 4.3 (Section E, revised — shared custody
      // invariant) — call site 3 of 4 (authoritative pricing). Runs
      // BEFORE computeIssueAuthorityContractPatch immediately below so a
      // genuine custody violation forces the SAME ID_REQUIRED-class
      // contract state a provisional issueAuthority already gets — one
      // shared mechanism, not a second parallel lockdown. Synthesizes an
      // issueAuthority-shaped object only when out.issueAuthority isn't
      // already provisional/conflicted (avoids double-writing reasons
      // when both signals fire for the same underlying cause).
      const pricingCustodyCheck = checkCrossPopulationPromotionGuard(
        identity?.familyIssueConsensus, { confirmedIssue }
      );
      if (!pricingCustodyCheck.allowed
        && out.issueAuthority?.status !== 'provisional' && out.issueAuthority?.status !== 'conflicted') {
        console.log(
          `[commit4.3] authoritative-pricing custody blocked: selectedFamilyIssue=${pricingCustodyCheck.conflict.selectedFamilyIssue} ` +
          `confirmedIssue=${pricingCustodyCheck.conflict.mismatchedValue}`
        );
        out.issueAuthority = {
          source: 'marketplace', status: 'conflicted', confidence: 'low', supportRatio: null,
          reasons: ['custody-invariant-violation'], priorObservations: [],
        };
      }
      // Commit 4.1 (review round, item 2) — identityProvisionalFields
      // passed as a third argument so this containment fires even when
      // out.issueAuthority is null (issue trusted/corroborated) but 'year'
      // is still family-adopted-only — see computeIssueAuthorityContractPatch's
      // own doc comment (issueAuthority.js) for the three-branch gate this
      // now runs.
      const authorityPatch = computeIssueAuthorityContractPatch(out.issueAuthority, out, out.identityProvisionalFields);
      if (authorityPatch) {
        // GrailKey Commit P (P1) — the soft, high-confidence-consensus
        // patch never sets refusedToPrice (it doesn't touch price at all),
        // so it's distinguished from the hard patches on that field alone
        // — no new marker needed on the patch object itself. Logging the
        // wrong ("forcing ID_REQUIRED-class... clearing price authority")
        // message for this case would itself be an I13 violation (log
        // must match what actually happened) of exactly the shape this
        // whole audit was commissioned to find.
        if (authorityPatch.refusedToPrice === true) {
          console.log(
            out.issueAuthority?.status
              ? `[commit4-terminal] issueAuthority.status="${out.issueAuthority.status}" — forcing ID_REQUIRED-class ` +
                `contract state, clearing price authority, locking listing (reasons=[${(out.issueAuthority.reasons || []).join(', ')}])`
              : `[commit4.1-terminal] identityProvisionalFields includes 'year' (issue trusted/corroborated, no issueAuthority) — ` +
                `forcing ID_REQUIRED-class contract state, clearing price authority, locking listing`
          );
        } else {
          console.log(
            `[commit-p] issueAuthority.status="provisional" but high-confidence marketplace consensus qualifies ` +
            `(reasons=[${(out.issueAuthority?.reasons || []).join(', ')}]) — price preserved, listing still locked pending confirmation`
          );
        }
        Object.assign(out, authorityPatch);
      }
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

    // A6 dispatch — pipelineAudit on the main path. Reuses the exact
    // pricingBoundaryOk/responseBoundaryOk booleans the terminal invariant
    // already computed above (~line 8534-8538) — not recomputed — plus
    // out.decision, now populated by computeDecision above.
    logTitleStripSummary();
    out.pipelineAudit = buildPipelineAudit({
      traceId: pipelineTraceId,
      buildSha: buildId,
      identityRevision: pipelineIdentityRevision,
      familyIssueConsensus: identity?.familyIssueConsensus || null,
      familyKey: confirmedTitle ?? null,
      pricingIssue,
      confirmedIssue,
      outIssue: out.issue ?? null,
      prePricingOk: pricingBoundaryOk,
      preResponseOk: responseBoundaryOk,
      decision: out.decision,
    });

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
