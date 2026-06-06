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

/**
 * Comic-specific title sanitization.
 * Owns comic pattern lists (creators, eras, artists).
 * Replaces inline sanitizeTitle + cleanTitleForComicVine in enrich.js.
 *
 * @param {string} title - Title to sanitize
 * @param {Object} context - { year, isGraded, preservePublisherInTitle }
 * @returns {string} Sanitized title
 */
export function sanitizeComicTitle(title, context) {
  return title;
}
