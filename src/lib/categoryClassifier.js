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
 *
 * GrailKey Commit S (S3, 2026-08-03) — non-sport trading card terms added.
 * Real production case: "1984 FTCC Marvel Superheroes First Issue Covers
 * Thor Tales of Asgard #14 07hl #14" and its sibling listing both carry a
 * genuine "#14" (matching COMIC_SIGNALS below) and none of the pre-existing
 * sports-card vocabulary (topps/panini/upper deck/fleer/psa/bgs/sgc/
 * rookie/refractor/prizm/optic/chrome) — the pre-existing pattern was built
 * for SPORTS trading cards specifically and had no coverage for non-sport
 * card manufacturers/products, so both rows classified COMIC and entered
 * the identity pool as a real Marvel Tales #14 scan's competing evidence.
 * SAME new alternation text added to TRADING_CARD_RE (src/lib/compHygiene.js,
 * this commit) so the two patterns can't drift apart on this addition — see
 * that file's own comment for the reciprocal note (same structure as the
 * P3 bullion-pattern precedent, MERCHANDISE_PATTERN/MERCH_RE).
 */
const CARD_PATTERN = /\b(psa|bgs|sgc)\s*\d+|\b(rookie|rc|auto|autograph|patch|relic|prizm|optic|chrome|refractor|parallel|topps|panini|upper\s*deck|fleer|ftcc|impel|skybox|trading\s*card|non[\s-]?sport(?:\s*card)?|first\s*issue\s*covers?|card\s*set)\b/i;

/**
 * Book-specific signals (novels, TPBs already handled by compHygiene)
 * Session 4B — Expanded to catch hardcover and edition markers
 */
const BOOK_PATTERN = /\b(isbn|978-\d{10}|novel|paperback|hardcover|kindle|ebook|first\s+edition|revised\s+edition|trade\s+paperback)\b/i;

/**
 * Merchandise signals — novelty/decor items printed with cover art, not
 * the comic itself (magnets, metal/tin signs, bullion). Batman #15
 * production case: "Batman #15 FRIDGE MAGNET comic book" and
 * "...Refrigerator Magnet Free Shipping" both survived the pre-existing
 * patterns (no dimension pair, no poster/canvas word) and reached
 * title-family clustering as real pool members.
 *
 * GrailKey Commit P (P3, 2026-08-03) — bullion/silver-ingot collectibles
 * ("1 oz superman #1 summer 1939 agoro foil...", "...1oz Silver Foil
 * Agoro 2026 .999 LE 1000...") had ZERO filter pattern anywhere in the
 * codebase, on either side (confirmed by repo-wide search during the
 * GrailKey full-pipeline audit) — two such listings entered a real
 * Superman #1 facsimile scan's identity pool. Deliberately narrower than
 * blanket-rejecting "silver foil": that phrase is ALREADY a legitimate
 * comic cover-finish variant descriptor elsewhere in this codebase
 * (imageSearchIdentity.js's finish-category token set) — a genuine
 * silver-foil-COVER comic variant must never be rejected here. The two
 * signals below (a troy-ounce weight marker, ".999" fine-silver purity)
 * are specific to bullion/ingot novelty products and essentially never
 * appear in genuine comic-listing text; "bullion"/"ingot" are the
 * category's own name terms, kept for the case a listing states them
 * directly without a weight/purity marker. SAME alternation text as
 * MERCH_RE (src/lib/compHygiene.js) — added there too, this commit, so
 * the two independently-maintained regexes can't drift apart on this
 * addition (see that file's own comment for the reciprocal note).
 */
const MERCHANDISE_PATTERN = /\b(magnet|refrigerator\s*magnet|fridge\s*magnet|metal\s*sign|tin\s*sign|wall\s*sign|bullion|ingot)\b|\b\d+(?:\.\d+)?\s*oz\b|\.999\s*(?:fine\s*)?(?:silver|gold)?\b/i;

// ────────────────────── MARKETPLACE CATEGORY METADATA ──────────────────────
//
// Commit C (2026-07-28) — marketplace category metadata takes precedence
// over title wording. Confirmed via direct execution against real
// production data (Batman #15, build e22e600): classifyTitle() correctly
// returns MERCHANDISE for "Batman #15 FRIDGE MAGNET comic book", but
// filterByCategory() — the actual live call site (api/enrich.js:2205) —
// had its own separate, hardcoded pattern list that never checked
// MERCHANDISE_PATTERN at all. classifyTitle() and filterByCategory() were
// genuinely disconnected; the earlier merchandise-pattern commit verified
// the classifier in isolation and never verified the function that acts
// on it (see the standing rule this dispatch adds, below).
//
// Only ONE leaf category/ID pair is independently confirmed from a real
// captured production payload: a genuine magnet listing in the Flash #139
// pool carried `leafCategoryIds: ['476']` and
// `categories: [{categoryId:'476', categoryName:'Refrigerator Magnets'}, ...]`.
// Every other entry here is eBay's own public category taxonomy, matched
// by NAME (not a guessed ID) for exactly that reason — name matching is
// the primary signal; the one confirmed ID is a secondary belt-and-
// suspenders check, not the sole mechanism.
//
// eBay's `categories[]` array is LEAF-FIRST in the confirmed real payload
// (categories[0] matched leafCategoryIds[0] in both the genuine-comic and
// genuine-magnet real items captured this session) — getLeafCategoryInfo
// below trusts leafCategoryIds as authoritative and cross-references
// categories[] only to recover that specific entry's name, rather than
// assuming array position.
//
// Deliberately does NOT hard-reject on a generic PARENT category alone
// ("Collectibles", "Comic Books & Memorabilia" both appear on genuine
// comic listings too, confirmed in the same real payloads) — only the
// resolved LEAF category is checked.
const HARD_NON_COMIC_LEAF_CATEGORY_IDS = new Map([
  ['476', { classification: 'MERCHANDISE', rejectionCode: 'MARKETPLACE_MAGNET_CATEGORY' }], // Refrigerator Magnets — confirmed via real production log (Flash #139, build e22e600)
]);

// Ordered rules, first match wins. Each tests a leaf category NAME.
const HARD_NON_COMIC_LEAF_CATEGORY_NAME_RULES = [
  { test: /refrigerator\s*magnets?|\bmagnets?\b/i, classification: 'MERCHANDISE', rejectionCode: 'MARKETPLACE_MAGNET_CATEGORY' },
  { test: /metal\s*signs?|tin\s*signs?|\bsigns?\b/i, classification: 'MERCHANDISE', rejectionCode: 'MARKETPLACE_SIGN_CATEGORY' },
  { test: /posters?\s*(&|and)?\s*prints?|\bposters?\b|\bprints?\b/i, classification: 'PRINT', rejectionCode: 'MARKETPLACE_POSTER_CATEGORY' },
  { test: /wall\s*art|home\s*d[ée]cor/i, classification: 'PRINT', rejectionCode: 'MARKETPLACE_WALL_ART_CATEGORY' },
  { test: /trading\s*cards?/i, classification: 'CARD', rejectionCode: 'MARKETPLACE_CARD_CATEGORY' },
  // Negative lookbehind excludes "Comic Books"/"Comic Book" — a genuine
  // comic leaf category must never hard-reject itself. Real captured leaf
  // category name for a genuine comic was "Comics & Graphic Novels", which
  // this pattern does not match at all (no bare "book(s)" token in it).
  { test: /(?<!comic\s)(?<!comics\s)\bbooks?\b/i, classification: 'BOOK', rejectionCode: 'MARKETPLACE_BOOK_CATEGORY' },
];

/**
 * Resolve an eBay Browse API item's own leaf category id + name.
 * Returns null when no leafCategoryIds are present (title-pattern fallback
 * territory, not a marketplace-category hard-reject candidate).
 *
 * @param {Object} item
 * @returns {{categoryId: string, categoryName: string|null}|null}
 */
export const getLeafCategoryInfo = (item) => {
  const leafIds = Array.isArray(item?.leafCategoryIds) ? item.leafCategoryIds.map(String) : [];
  if (leafIds.length === 0) return null;
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  const leafId = leafIds[0];
  const match = categories.find((c) => String(c?.categoryId) === leafId);
  return { categoryId: leafId, categoryName: match?.categoryName || null };
};

/**
 * Commit C — classify a single eBay visual-market row for identity-pool
 * eligibility. Marketplace category metadata takes precedence over title
 * wording (item 2 of the dispatch): an explicit non-comic leaf category is
 * a hard rejection even when the title contains "comic book" (the exact
 * real production case: "Batman #15 FRIDGE MAGNET comic book", leaf
 * category "Refrigerator Magnets"). Title-pattern classification
 * (classifyTitle) remains the fallback when marketplace category metadata
 * is absent or the leaf doesn't match a known non-comic rule.
 *
 * @param {Object} item - eBay Browse API item shape (title/rawTitle, leafCategoryIds, categories)
 * @returns {{eligibleForComicIdentity: boolean, classification: string, authority: 'marketplace-category'|'title-pattern'|'ambiguous', rejectionCode: string|null}}
 */
export const classifyVisualMarketRow = (item) => {
  const title = item?.title || item?.rawTitle || '';
  const leaf = getLeafCategoryInfo(item);

  if (leaf) {
    const idRule = HARD_NON_COMIC_LEAF_CATEGORY_IDS.get(leaf.categoryId);
    const nameRule = leaf.categoryName
      ? HARD_NON_COMIC_LEAF_CATEGORY_NAME_RULES.find((r) => r.test.test(leaf.categoryName))
      : null;
    const rule = idRule || nameRule;
    if (rule) {
      return {
        eligibleForComicIdentity: false,
        classification: rule.classification,
        authority: 'marketplace-category',
        rejectionCode: rule.rejectionCode,
      };
    }
  }

  // Fallback: title-pattern classification (existing classifyTitle, unchanged).
  const titleClass = classifyTitle(title);
  if (titleClass === 'COMIC') {
    return { eligibleForComicIdentity: true, classification: 'COMIC', authority: 'title-pattern', rejectionCode: null };
  }
  if (titleClass === 'UNKNOWN') {
    return { eligibleForComicIdentity: true, classification: 'UNKNOWN', authority: 'ambiguous', rejectionCode: null };
  }
  return {
    eligibleForComicIdentity: false,
    classification: titleClass,
    authority: 'title-pattern',
    rejectionCode: `TITLE_PATTERN_${titleClass}`,
  };
};

// ─────────────────────────── CLASSIFICATION ───────────────────────────

/**
 * Classify a title into a category.
 *
 * @param {string} title - eBay listing title
 * @returns {string} - 'COMIC' | 'PRINT' | 'COLLECTIBLE' | 'CARD' | 'BOOK' | 'MERCHANDISE' | 'UNKNOWN'
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
  if (MERCHANDISE_PATTERN.test(title)) {
    return 'MERCHANDISE';
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

// Bound on how much of a rejected row's title is retained for diagnostics
// (item 8: bounded logging, no full dumps; item 7: never retain seller
// username/item ID/URL/postal code/full marketplace object — the title
// text itself is the only field kept, truncated defensively).
const REJECTED_EVIDENCE_TITLE_MAX_LEN = 100;

/**
 * Commit C — classify every row, separate hard-rejected from eligible,
 * and NEVER let the thin-pool safety path restore a hard-rejected row.
 *
 * Confirmed via direct execution as a second, independent bug from the
 * missing MERCHANDISE check: the old filterByCategory's safety gate
 * (`filtered.length < 5 && items.length >= 5`) returned the ENTIRE
 * UNFILTERED original pool — undoing even the pre-existing, correctly-
 * working PRINT/COLLECTIBLE/POSTER/CANVAS exclusions, not just the
 * missing MERCHANDISE one. It fired hardest exactly when a pool was most
 * contaminated (the fewer genuine comic rows survive filtering, the more
 * likely the count drops below 5) — the case it should protect hardest,
 * not abandon.
 *
 * New behavior: when the eligible pool is thin (<5), it is reported
 * honestly and returned as-is — eligible COMIC/UNKNOWN rows only, never
 * padded back out with known magnets/signs/posters/books/cards. When
 * zero rows are eligible, an empty array is returned; callers (see
 * api/enrich.js) already treat an empty/thin visual pool as "no coherent
 * consensus, keep Vision as provisional" — the correct behavior, not a
 * new code path this function needs to special-case.
 *
 * @param {Array} items - eBay result items (with title or rawTitle fields, ideally leafCategoryIds/categories)
 * @returns {{eligible: Array, rejectedVisualEvidence: Array<{classification: string, rejectionCode: string, sanitizedTitle: string}>}}
 */
export const filterVisualIdentityPool = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { eligible: items || [], rejectedVisualEvidence: [] };
  }

  const eligible = [];
  const rejectedVisualEvidence = [];
  const reasons = {};

  for (const item of items) {
    const result = classifyVisualMarketRow(item);
    if (result.eligibleForComicIdentity) {
      eligible.push(item);
      continue;
    }
    const code = result.rejectionCode || 'UNKNOWN_REJECTION';
    reasons[code] = (reasons[code] || 0) + 1;
    const rawTitle = String(item?.title || item?.rawTitle || '');
    rejectedVisualEvidence.push({
      classification: result.classification,
      rejectionCode: code,
      sanitizedTitle: rawTitle.length > REJECTED_EVIDENCE_TITLE_MAX_LEN
        ? `${rawTitle.slice(0, REJECTED_EVIDENCE_TITLE_MAX_LEN)}…`
        : rawTitle,
    });
  }

  if (rejectedVisualEvidence.length > 0) {
    console.log(
      `[visual-identity-filter] input=${items.length} eligible=${eligible.length} ` +
      `hardRejected=${rejectedVisualEvidence.length} softRejected=0 reasons=${JSON.stringify(reasons)}`
    );
  }

  return { eligible, rejectedVisualEvidence };
};

/**
 * Filter eBay image search results by expected category.
 *
 * Commit C — thin wrapper over filterVisualIdentityPool, kept for
 * backward-compatible callers that only want the filtered array (existing
 * public API surface). Ensures MERCHANDISE/PRINT/CARD/BOOK/COLLECTIBLE are
 * all actually removed when expectedCategory='COMIC' — the core fix for
 * the confirmed bug where this function's own separate, hardcoded pattern
 * list never checked MERCHANDISE_PATTERN and consequently never removed
 * a MERCHANDISE-classified row (confirmed via direct execution: a real
 * "FRIDGE MAGNET" title classified MERCHANDISE by classifyTitle survived
 * this function unfiltered).
 *
 * @param {Array} items - eBay result items (with title or rawTitle fields)
 * @param {string} expectedCategory - 'COMIC' | 'PRINT' | 'COLLECTIBLE' | 'CARD' | 'BOOK'
 * @returns {Array} - Filtered items (may be empty — the old "never empty" safety-net behavior is exactly the bug this dispatch closes)
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

  return filterVisualIdentityPool(items).eligible;
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
