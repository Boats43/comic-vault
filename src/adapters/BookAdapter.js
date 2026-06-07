/**
 * BookAdapter.js
 *
 * Session 4B — Book-specific domain logic.
 * Extracts book knowledge from AssetCore (decisionEngine, pricingEngine).
 *
 * AssetCore operates on universal primitives only.
 * BookAdapter owns: author, ISBN, edition, format (hardcover/paperback),
 * book-specific title sanitization.
 */

/**
 * Expected category for filtering.
 * Used by categoryClassifier to route book listings.
 */
export const expectedCategory = 'BOOK';

/**
 * Detect key-value from edition + signed + author signals.
 * Replaces inline hasKeyIssue logic for books.
 *
 * @param {string|null} edition - Edition descriptor (e.g., "First Edition")
 * @param {boolean} signed - Signed by author flag
 * @param {string|null} author - Author name
 * @returns {boolean} True if key value detected
 */
export function detectKeyValue(edition, signed, author) {
  // TODO Session 4B: implement first edition + signed detection
  return false;
}

/**
 * Verify content from description.
 * Replaces inline comicVine.description check for books.
 *
 * @param {string|null} description - Book description text
 * @returns {boolean} True if content verified (not placeholder/spam)
 */
export function verifyContent(description) {
  // TODO Session 4B: implement description quality check
  return true;
}

/**
 * Compute format-based risk flag.
 * Replaces era-based risk detection for books.
 *
 * @param {string|null} format - Format (hardcover/paperback/etc.)
 * @param {number|null} price - Estimated price
 * @param {Object|null} soldComps - Sold comp data { count, average }
 * @returns {string|null} 'rare-edition' | 'mass-market' | null
 */
export function computeFormatRisk(format, price, soldComps) {
  // TODO Session 4B: implement format risk detection
  return null;
}

/**
 * Book-specific title sanitization.
 * Removes seller/marketplace noise + book-specific patterns.
 *
 * @param {string} title - Title to sanitize
 * @param {Object} context - { year, author, preserveSubtitle }
 * @returns {string} Sanitized title
 */
export function sanitizeBookTitle(title, context = {}) {
  // TODO Session 4B: implement book title cleaning
  if (!title || typeof title !== 'string') return title;
  return title;
}
