// GrailKey Directive 2026-08-11-D (Task 4) / 2026-08-11-E (Task 3).
//
// Two label maps translate internal pricing-source tokens into operator-
// facing text. Both were introduced by GK-67 (c0653a5, 2026-08-10) with a
// literal "unavailable" fallback for any unmapped token — one day before
// GK-72 (bbcb719, 2026-08-11) added a REAL out.ebaySourceUnavailable field
// for genuine eBay outages. Neither map ever read that field; the two
// wordings collided by coincidence. Production showed "Source unavailable
// + eBay sold" and "Based on 27 source-unavailable comps" on two scans
// where eBay was confirmed healthy — the tokens were simply unmapped, not
// an outage.
//
// Fix: both maps now cover every value api/enrich.js can actually assign
// (re-derived directly from the assignment sites, not assumed), and the
// fallback echoes the raw token instead of the word "unavailable" — an
// unmapped token should look like a labeling gap, not an eBay outage.
// "unavailable" wording is reserved for a site that actually reads
// ebaySourceUnavailable (decisionEngine.js's ebay-source-unavailable
// warning already does this correctly and is untouched).
//
// Extracted here (rather than left inline in App.jsx) so this file's own
// guard test can statically re-derive the live assignment set from
// api/enrich.js's source text and fail if a new value is ever added there
// without a matching label — the drifted-duplicate-constant class this
// codebase has hit before (Q119/Q127/Q128, GK-37) is exactly what let
// this map go stale silently the first time.

// out.pricingSource — every literal assignment in api/enrich.js, plus
// every value TIER_SOURCE_MAP (src/lib/priceBands.js) can produce
// (including its 'pc_estimate' fallthrough default).
export const PRICING_SOURCE_LABELS = {
  // TIER_SOURCE_MAP-derived (src/lib/priceBands.js)
  verified_sold_recency: "verified sold comps (recency-weighted)",
  sold_active_blend_30: "sold + active blend (70/30)",
  verified_sold: "verified sold comps",
  verified_sold_stale: "verified sold comps (stale)",
  active_ask_derived: "active listing asks",
  pc_estimate: "PriceCharting estimate",
  // Reassigned after the TIER_SOURCE_MAP lookup, in specific branches
  verified_sold_active_blend: "sold + active blend (verified)",
  // Legacy/reserved — no current assignment site found, kept for forward
  // compatibility rather than removed outright.
  pricecharting: "PriceCharting market data",
  browse_api: "Browse API — active listings",
  // Direct literal assignments elsewhere in api/enrich.js
  "refused-reprint-thin-pool": "refused — reprint, thin comp pool",
  "refused-polybag-pc-divergence": "refused — polybag/PriceCharting divergence",
  "ebay-polybag-active": "eBay polybag active listings",
  "identity-required": "identity required — not yet priced",
  active_reference_range: "active reference range",
  "refused-tier-bypass-detected": "refused — pricing tier bypass detected",
  // No longer assigned by api/enrich.js (removed, comment-only reference
  // at :10345) but still actively checked as a legacy value by
  // decisionEngine.js:514, App.jsx:4152, and dataQualityGuard.js:22 — an
  // older persisted catalogue item can still carry it.
  "refused-claude-gate": "refused — Claude verification rejected pricing",
  "refused-no-data-sources": "refused — no pricing data from any source",
  thin_pool_anchor: "thin comp pool anchor",
  "refused-qualified-label": "refused — qualified/restored CGC label",
  visual_pool_fallback: "visual similarity fallback (identity unconfirmed)",
  refused: "refused — no coherent market data",
  web_search_fallback: "web search fallback",
  ai_estimate: "AI estimate",
  "refused-issue-fingerprint-violation": "refused — issue identification inconsistency",
  "hypothetical-reference-issue-unresolved": "hypothetical reference — issue unresolved",
  catalog_ladder_reference: "PriceCharting catalog ladder reference",
  visual_pool_family_isolated: "visual similarity fallback (isolated family)",
};

// out.priceBands.source — the 10 canonical PRICE_BANDS_SOURCES
// (src/lib/priceBands.js) plus the 3 values api/enrich.js overwrites
// out.priceBands.source with outside that tier system.
export const PRICE_BANDS_SOURCE_LABELS = {
  tier1_recency_weighted: 'sold',
  tier2_blend_70_30: 'blended sold + active',
  tier2_sold_only: 'sold',
  tier2_sold_only_active_suspect: 'sold',
  tier2_active_dominant_thin_sold: 'active',
  verified_sold_stale: 'stale sold',
  tier3_active_discounted: 'active',
  tier3_active_discounted_over_fallback_sold: 'active',
  tier4_pc_estimate: 'PriceCharting-estimated',
  variant_fallback_capped: 'active',
  // Overwritten outside the tier system (api/enrich.js)
  'mega-key-floor': 'mega-key floor',
  visual_pool_fallback: 'visual similarity fallback',
  visual_pool_family_isolated: 'visual similarity fallback (isolated family)',
};

export function getPricingSourceLabel(pricingSource) {
  const label = PRICING_SOURCE_LABELS[pricingSource];
  return label ? `Source: ${label}` : `Source: ${pricingSource || 'unknown'}`;
}

export function getPriceBandsSourceLabel(source) {
  return PRICE_BANDS_SOURCE_LABELS[source] || (source || 'unknown');
}
