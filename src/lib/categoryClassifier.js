/**
 * categoryClassifier.js
 *
 * Session 4A — Universal pre-clustering category filter.
 * Removes non-comic results (posters, prints, collectibles, cards, books)
 * from eBay image search results before title-family clustering.
 *
 * Design: Exclusion-based filtering.
 * - Drop results that match NON-COMIC signals
 * - Keep results with comic signals OR ambiguous signals
 * - Never drop a result just because it lacks comic signals
 *
 * Foundation for multi-format adapters (BookAdapter, CardAdapter).
 */

// ─────────────────────────── CATEGORY PATTERNS ───────────────────────────

/**
 * Dimension pattern — detects print/poster dimensions like "18x24 inch".
 * Requires both numbers to avoid false positives on:
 * - "2x Amazing Spider-Man #300" (lot descriptor)
 * - "1:25 variant ratio" (uses colon, not x)
 * - "Amazing Adventures #3 GD 2.0" (no x between digits)
 */
const DIMENSION_PATTERN = /\b\d+\s*[x×]\s*\d+\s*(inch|in|cm)?\b/i;

/**
 * Print format markers — art prints, lithographs, giclée
 */
const PRINT_FORMAT_PATTERN = /\b(screen\s*print|art\s*print|lithograph|giclee|litho|giclée)\b/i;

/**
 * Collectible 3D objects — statues, busts, figures
 */
const COLLECTIBLE_PATTERN = /\b(statue|statuette|bust|figurine|polystone|resin)\b/i;

/**
 * Poster marker (standalone word only)
 */
const POSTER_PATTERN = /\bposter\b/i;

/**
 * Canvas print marker
 */
const CANVAS_PATTERN = /\bcanvas\b/i;

/**
 * Card-specific signals (trading cards, graded cards)
 */
const CARD_PATTERN = /\b(psa|bgs|sgc)\s*\d+|\b(rookie|rc|auto|autograph|patch|relic|prizm|optic|chrome|refractor|parallel|topps|panini|upper\s*deck|fleer)\b/i;

/**
 * Book-specific signals (novels, TPBs already handled by compHygiene)
 * Session 4B — Expanded to catch hardcover and edition markers
 */
const BOOK_PATTERN = /\b(isbn|978-\d{10}|novel|paperback|hardcover|kindle|ebook|first\s+edition|revised\s+edition|trade\s+paperback)\b/i;

// ─────────────────────────── CLASSIFICATION ───────────────────────────

/**
 * Classify a title into a category.
 *
 * @param {string} title - eBay listing title
 * @returns {string} - 'COMIC' | 'PRINT' | 'COLLECTIBLE' | 'CARD' | 'BOOK' | 'UNKNOWN'
 */
export const classifyTitle = (title) => {
  if (!title || typeof title !== 'string') return 'UNKNOWN';

  const titleLower = title.toLowerCase();

  // Check non-comic categories first (order matters for logging clarity)
  if (DIMENSION_PATTERN.test(title) || PRINT_FORMAT_PATTERN.test(title) || POSTER_PATTERN.test(title) || CANVAS_PATTERN.test(title)) {
    return 'PRINT';
  }
  if (COLLECTIBLE_PATTERN.test(title)) {
    return 'COLLECTIBLE';
  }
  if (CARD_PATTERN.test(title)) {
    return 'CARD';
  }
  if (BOOK_PATTERN.test(title)) {
    return 'BOOK';
  }

  // Comic signals (issue number, CGC/CBCS grading, cover variants)
  const COMIC_SIGNALS = [
    /#\d{1,3}\b/,                                    // Issue number
    /\b(cgc|cbcs|pgx)\s*\d+\.\d+/i,                  // Comic slab grading
    /\b(cover\s*[a-z]|cvr\s*[a-z])/i,                // Cover variants
    /\b(newsstand|direct|whitman|1st\s*print)/i,     // Distribution/print markers
  ];

  const hasComicSignal = COMIC_SIGNALS.some(pattern => pattern.test(title));
  if (hasComicSignal) {
    return 'COMIC';
  }

  // Ambiguous — no strong signals either way
  return 'UNKNOWN';
};

/**
 * Log category distribution before and after filtering.
 *
 * @param {Array} original - Original items array
 * @param {Array} filtered - Filtered items array
 */
export const logCategoryDistribution = (original, filtered) => {
  if (!Array.isArray(original) || !Array.isArray(filtered)) return;

  const dropped = original.filter(item => !filtered.includes(item));
  const categoryCounts = {};

  for (const item of dropped) {
    const title = item?.title || item?.rawTitle || '';
    const category = classifyTitle(title);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  const categoryStr = Object.entries(categoryCounts)
    .filter(([cat, count]) => cat !== 'COMIC' && count > 0)
    .map(([cat, count]) => `${cat}:${count}`)
    .join(' ');

  console.log(
    `[category-gate] pool=${original.length} kept=${filtered.length} dropped=${dropped.length}` +
    (categoryStr ? ` (${categoryStr})` : '')
  );
};

// ─────────────────────────── FILTERING ───────────────────────────────

/**
 * Filter eBay image search results by expected category.
 *
 * Exclusion-based: drop items with non-comic signals, keep everything else.
 * Safety: returns original array if filtering would drop pool below 5.
 *
 * @param {Array} items - eBay result items (with title or rawTitle fields)
 * @param {string} expectedCategory - 'COMIC' | 'PRINT' | 'COLLECTIBLE' | 'CARD' | 'BOOK'
 * @returns {Array} - Filtered items (never empty if input was non-empty)
 */
export const filterByCategory = (items, expectedCategory = 'COMIC') => {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  // Currently only COMIC filtering is implemented
  if (expectedCategory !== 'COMIC') {
    console.log(`[category-gate] category "${expectedCategory}" not implemented, skipping filter`);
    return items;
  }

  const filtered = items.filter(item => {
    const title = item?.title || item?.rawTitle || '';
    if (!title) return true; // Keep items without titles (handled downstream)

    // Drop if matches any non-comic pattern
    if (DIMENSION_PATTERN.test(title)) return false;
    if (PRINT_FORMAT_PATTERN.test(title)) return false;
    if (COLLECTIBLE_PATTERN.test(title)) return false;
    if (POSTER_PATTERN.test(title)) return false;
    if (CANVAS_PATTERN.test(title)) return false;

    // Keep everything else (comic signals OR ambiguous)
    return true;
  });

  // Safety gate: if filtered pool drops below minimum threshold, use original
  if (filtered.length < 5 && items.length >= 5) {
    console.log(
      `[category-gate] pool too small after filter (${filtered.length} < 5) — using original pool (${items.length})`
    );
    return items;
  }

  // Log distribution for observability
  if (filtered.length < items.length) {
    logCategoryDistribution(items, filtered);
  }

  return filtered;
};

// ─────────────────────────── ASSET TYPE DETECTION ───────────────────────────

/**
 * Detect if parsed Vision result is a book (not a comic).
 *
 * Session 4B — Moved from api/grade.js to shared classifier module.
 * Used by both grade.js (initial scan routing) and enrich.js (server-side
 * assetType derivation when client handoff fails).
 *
 * @param {Object} parsed - Vision scan result with title/reason fields
 * @returns {boolean} - true if 2+ book signals detected
 */
export const detectBookSignals = (parsed) => {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  // Check for book-specific signals in title or reason text
  const title = String(parsed.title || '').toLowerCase();
  const reason = String(parsed.reason || '').toLowerCase();
  const combined = `${title} ${reason}`;

  const BOOK_SIGNALS = [
    /\bauthor\b/i,
    /\bisbn\b/i,
    /\b978-\d{10}\b/,              // ISBN-13 pattern
    /\bpublished\s+by\b/i,
    /\bcopyright\b/i,
    /\bedition\b/i,
    /\bhardcover\b/i,
    /\bpaperback\b/i,
    /\bnovel\b/i,
    /\btitle\s+page\b/i,
    /\bdust\s+jacket\b/i,
    // Session 4B — Abbreviations
    /\bhc\b/i,                     // hardcover (abbreviated)
    /\bdj\b/i,                     // dust jacket (abbreviated)
    /\b\d+(st|nd|rd|th)\s*ed\b/i, // 1st ed, 5th ed, etc.
    /\bpress\b/i,                  // university press, publishing house
    /\bvol\b/i,                    // volume
  ];

  const matchCount = BOOK_SIGNALS.filter(pattern => pattern.test(combined)).length;

  // Require 2+ book signals to avoid false positives
  return matchCount >= 2;
};
