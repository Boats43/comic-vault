/**
 * ComicAdapter.js
 *
 * Session 3B Step 5 — Comic-specific domain logic.
 * Extracts comic knowledge from AssetCore (decisionEngine, pricingEngine).
 *
 * AssetCore operates on universal primitives only.
 * ComicAdapter owns: issue, publisher, variant, keyIssue, era, ComicVine,
 * creator patterns, artist patterns, comic-specific title sanitization.
 *
 * Phase 1+2 implementation: stubs and flag migrations.
 * Phase 3 implementation: full enrichComic() orchestration.
 */

/**
 * Detect key-issue value from keyIssue string.
 * Replaces inline hasKeyIssue logic in decisionEngine.js.
 *
 * @param {string|null} keyIssue - Key issue descriptor
 * @returns {boolean} True if key issue detected
 */
export function detectKeyValue(keyIssue) {
  if (!keyIssue || keyIssue.trim().length <= 3) {
    return false;
  }

  const lower = keyIssue.toLowerCase();
  const negatives = ['no', 'n/a', 'none', 'false', 'not a key', 'non-key', 'non key', 'not key'];

  return !negatives.some(x => lower.includes(x));
}

/**
 * Verify story content from ComicVine metadata.
 * Replaces inline comicVine.description check in decisionEngine.js.
 *
 * @param {Object|null} comicVine - ComicVine API response
 * @returns {boolean} True if story verified (not ad/pinup/metadata artifact)
 */
export function verifyStory(comicVine) {
  if (!comicVine?.description || comicVine.description.length <= 50) {
    return false;
  }

  const storyLower = comicVine.description.toLowerCase();
  const suspicious = storyLower.includes('translate:') ||
                     storyLower.includes('collects:') ||
                     storyLower.includes('reprints:') ||
                     storyLower.includes('featured story arcs:');

  return !suspicious;
}

/**
 * Compute era-based risk flag.
 * Replaces Golden Age thin-pool and modern bundle detection in decisionEngine.js.
 *
 * @param {string|number} year - Publication year
 * @param {Object} rawComps - Raw comp data { count, average }
 * @returns {string|null} 'vintage-thin' | 'modern-bundle' | null
 */
export function computeEraRisk(year, rawComps) {
  const y = parseInt(year);
  if (!y || isNaN(y)) return null;

  // Golden Age: 1938-1955
  const isGoldenAge = y >= 1938 && y <= 1955;
  const isThinActive = rawComps?.count <= 2;

  if (isGoldenAge && isThinActive) {
    return 'vintage-thin';
  }

  // Modern bundle candidate: post-1991, low value
  if (y >= 1992 && rawComps?.average && rawComps.average < 10) {
    return 'modern-bundle';
  }

  return null;
}

// ============================================================================
// COMIC-SPECIFIC PATTERN LISTS
// Extracted from enrich.js sanitizeTitle + cleanTitleForComicVine
// ============================================================================

/**
 * Protected series where publisher name is part of canonical title.
 * Example: "Marvel Tales" is the series name, not "Tales" + noise.
 */
export const PUBLISHER_IN_TITLE_SERIES = [
  'marvel tales', 'marvel presents', 'marvel preview', 'marvel spotlight',
  'marvel super action', 'marvel super heroes', 'marvel team-up', 'marvel team up',
  'marvel triple action', 'marvel two-in-one', 'marvel two in one', 'marvel age',
  'marvel chillers', 'marvel feature', 'marvel fanfare', 'marvel comics presents',
  'marvel saga', 'marvel premiere', 'marvel mystery comics',
  'dc universe presents', 'dc retroactive', 'dc comics presents', 'dc special',
  'image comics presents', 'image united',
];

/**
 * Artist patterns for title cleaning.
 * Multi-word patterns + high-frequency single-word artist names that
 * appear as variant descriptors in eBay listing titles.
 */
export const ARTIST_NOISE = [
  /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i, /frank cho/i,
  /frank miller/i, /dell'?otto/i, /jeehyung lee/i, /alex ross/i, /kaare andrews/i,
  /alan quah/i, /mico suayan/i, /puppeteer lee/i, /derrick chew/i, /jonboy meyers/i,
  /kael ngu/i, /natali sanders/i, /kendrick lim/i, /lucio parrillo/i,
  /artgerm/i, /stanley lau/i, /kunkka/i, /momoko/i, /mcfarlane/i, /campbell/i,
  /nakayama/i, /hughes/i, /fabok/i, /lim/i, /chew/i, /ngu/i, /sanders/i,
];

/**
 * Character-in-series noise patterns.
 * Example: "Fantastic Four Human Torch Artgerm" → strip "Human Torch"
 * (it's a variant descriptor, not part of title).
 */
export const CHARACTER_NOISE_PATTERNS = [
  { series: /fantastic\s+four/i, character: /human\s+torch/i },
  { series: /x-?men/i, character: /wolverine|cyclops|storm|rogue|gambit/i },
  { series: /avengers/i, character: /iron\s+man|captain\s+america|thor|hulk/i },
];

/**
 * Variant/format noise keywords (for cleanTitleForComicVine).
 */
export const VARIANT_NOISE = [
  /\bvariant\b/i, /\bcover\b/i, /\bcvr\b/i,
  /\bratio\b/i, /\bincentive\b/i, /\bexclusive\b/i, /\bexcl\.?\b/i,
  /\bnm\b/i, /\bvf\b/i, /\bfn\b/i, /\bvg\b/i, /\bgd\b/i,
];

/**
 * Single-word creator names that appear as marketplace noise.
 * Example: "Batman #1 Kirby" (seller added creator, not canonical).
 */
export const CREATOR_NOISE_RE = /\b(kirby|severin|ditko|lee|buscema|romita|steranko|bartel|mayhew|byrne|miller|mcfarlane|mignola|ross|campbell|cho|fabok|aparo|wrightson|kubert|adams|bolland|perez|simonson|sook|capullo|finch|sale|coipel|quesada)\b/gi;

/**
 * Publisher filler words and era labels.
 * Example: "Batman Silver Age #1" → "Batman #1".
 */
export const PUBLISHER_FILLER_RE = /\b(atlas\s+series|silver\s+age|golden\s+age|bronze\s+age|copper\s+age|modern\s+age|pre\s+code|horror|crime|western|romance)\b/gi;

/**
 * Comic-specific listing language.
 * Example: "Amazing Spider-Man 1st app" → "Amazing Spider-Man".
 */
export const LISTING_LANGUAGE_RE = /\b(set\s+main|1st\s+app(?:earance)?|trade\s+dress|empire|new\s+series|ongoing|limited\s+series|mini\s+series|one[\s-]?shot)\b/gi;

// ============================================================================
// COMIC-SPECIFIC TITLE CLEANING FUNCTIONS
// ============================================================================

/**
 * Clean title for ComicVine queries.
 * Strips artist names, character variants, and format noise.
 * Preserves publisher-in-title series (Marvel Tales, DC Special).
 *
 * @param {string} title - Title to clean
 * @param {string|null} variant - Variant descriptor (unused, kept for signature compat)
 * @returns {string} Cleaned title
 */
export function cleanTitleForComicVine(title, variant) {
  const titleLower = String(title || '').toLowerCase().trim();

  // Preserve publisher-in-title series
  const isProtected = PUBLISHER_IN_TITLE_SERIES.some(p => titleLower.startsWith(p));
  if (isProtected) {
    return title; // Don't strip anything from Marvel Tales, etc.
  }

  let cleaned = title;
  const removedTokens = [];

  // Strip artist names
  for (const pattern of ARTIST_NOISE) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, ' ');
    if (before !== cleaned) {
      const removed = before.match(pattern);
      if (removed) removedTokens.push(removed[0]);
    }
  }

  // Strip variant keywords
  for (const pattern of VARIANT_NOISE) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, ' ');
    if (before !== cleaned) {
      const removed = before.match(pattern);
      if (removed) removedTokens.push(removed[0]);
    }
  }

  // Character-name stripping when acting as variant descriptors
  for (const { series, character } of CHARACTER_NOISE_PATTERNS) {
    if (series.test(cleaned) && character.test(cleaned)) {
      const before = cleaned;
      cleaned = cleaned.replace(character, ' ');
      if (before !== cleaned) {
        const removed = before.match(character);
        if (removed) removedTokens.push(removed[0]);
      }
    }
  }

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Safeguard: if cleaned title < 2 meaningful tokens, restore last removed token
  const tokens = cleaned.split(/\s+/).filter(t => t.length >= 2 && !/^\d+$/.test(t));
  if (tokens.length < 2 && removedTokens.length > 0) {
    const restore = removedTokens[removedTokens.length - 1];
    cleaned = `${cleaned} ${restore}`.replace(/\s+/g, ' ').trim();
    console.log(`[cv-clean-safeguard] restored "${restore}" (result was < 2 tokens)`);
  }

  if (cleaned.toLowerCase() !== titleLower) {
    console.log(`[cv-clean] "${title}" → "${cleaned}"`);
  }

  return cleaned;
}

/**
 * Comic-specific title sanitization.
 * Stub for Phase 3 Part 2 — will replace inline sanitizeTitle in enrich.js.
 *
 * @param {string} title - Title to sanitize
 * @param {Object} context - { year, isGraded, preservePublisherInTitle }
 * @returns {string} Sanitized title
 */
export function sanitizeComicTitle(title, context) {
  return title;
}
