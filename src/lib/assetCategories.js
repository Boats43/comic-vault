// src/lib/assetCategories.js — the SUPPORTED physical-asset categories
// (Universal U1, 2026-10-05).
//
// PERMANENT LAW: UNKNOWN OR MISSING CATEGORY MUST NEVER BECOME COMIC BY
// DEFAULT. A category is either one of these explicitly-supplied values or the
// operation REFUSES (pending an operator choice). There is no default and no
// fallback anywhere a category is written.
//
// The same value is used for gk_asset.asset_class (physical-asset kernel) and
// collection_item.asset_category (catalogue projection): one vocabulary, so the
// two can never drift apart by definition.

export const SUPPORTED_ASSET_CATEGORIES = Object.freeze(['comic', 'book', 'generic']);

export function isSupportedAssetCategory(value) {
  return typeof value === 'string' && SUPPORTED_ASSET_CATEGORIES.includes(value);
}

export function describeSupportedCategories() {
  return SUPPORTED_ASSET_CATEGORIES.join('|');
}
