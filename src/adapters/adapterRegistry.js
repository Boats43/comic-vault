/**
 * adapterRegistry.js
 *
 * Session 4B — Universal adapter routing for multi-asset pricing engine.
 * Routes comic, book, card, coin through unified config instead of
 * scattered ternaries in enrich.js.
 *
 * Each adapter declares:
 * - identityFields: required fields for identity confidence
 * - usesComicVine: boolean (comic metadata lookup)
 * - usesPriceCharting: boolean (comic pricing data)
 * - gradeScale: 'cgc' | 'book' | 'card' (grade scale type)
 * - buildQuery: function to construct eBay comp queries
 */

import { buildBookQuery } from './BookAdapter.js';

/**
 * Adapter registry — one entry per priceable asset type.
 *
 * Adding new asset types:
 * 1. Create new adapter file (e.g., CardAdapter.js)
 * 2. Add entry here with identityFields + buildQuery
 * 3. Wire buildQuery into api/comps.js
 */
export const ADAPTERS = {
  comic: {
    identityFields: ['title', 'issue', 'year', 'publisher'],
    usesComicVine: true,
    usesPriceCharting: true,
    gradeScale: 'cgc',
    ebayCategoryId: '259104', // Comics > Comic Books > Single Issues
    buildQuery: null, // Comic queries built inline in api/comps.js (existing logic)
  },

  book: {
    identityFields: ['title', 'author', 'year'],
    usesComicVine: false,
    usesPriceCharting: false,
    gradeScale: 'book',
    ebayCategoryId: '267', // Books & Magazines
    buildQuery: buildBookQuery, // From BookAdapter.js (Session 4B STEP 4)
  },

  // Future asset types (uncommitted):
  // card: {
  //   identityFields: ['player', 'year', 'cardNumber', 'set'],
  //   usesComicVine: false,
  //   usesPriceCharting: false,
  //   gradeScale: 'card',
  //   buildQuery: buildCardQuery,
  // },
  //
  // coin: {
  //   identityFields: ['denomination', 'year', 'mint'],
  //   usesComicVine: false,
  //   usesPriceCharting: false,
  //   gradeScale: 'coin',
  //   buildQuery: buildCoinQuery,
  // },
};

/**
 * Get adapter config for an asset type.
 * Defaults to 'comic' for unknown types (backward compatibility).
 *
 * @param {string|null|undefined} assetType - 'comic', 'book', 'card', etc.
 * @returns {Object} Adapter config
 */
export function getAdapter(assetType) {
  const type = assetType || 'comic';
  return ADAPTERS[type] || ADAPTERS.comic;
}
