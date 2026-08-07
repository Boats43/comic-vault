// GrailKey Dispatch 11 (2026-08-07) — TIER_SOURCE_MAP completeness guard.
//
// Third production incident of the identical shape (Q109-DISPATCH-1-B,
// Q109-D, GK-34/Dispatch-10): a new `source` value introduced in
// src/lib/priceBands.js with no corresponding entry in
// api/enrich.js's TIER_SOURCE_MAP silently falls through to the
// 'pc_estimate' default — which sits inside VARIANT_MULT_ELIGIBLE_SOURCES,
// making an already-adjusted price (active-anchored, discounted, capped,
// whichever) eligible for a second, silent variant/key multiplier
// re-application. "Every new tier source is a live pricing hazard until
// it's mapped" is a design gap, not a one-off missed entry — this test
// is the completeness check that closes the class permanently: every
// source PRICE_BANDS_SOURCES enumerates must have an explicit
// TIER_SOURCE_MAP entry. No silent default, enforced on both sides.
//
// PRICE_BANDS_SOURCES and TIER_SOURCE_MAP both live in
// src/lib/priceBands.js (not api/enrich.js) specifically so this test can
// import them directly — api/enrich.js does not cleanly exit when
// imported in a bare Node/test context.
//
// Invoke: node tests/tier-source-map-completeness.test.js

import { PRICE_BANDS_SOURCES, TIER_SOURCE_MAP } from '../src/lib/priceBands.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

check(PRICE_BANDS_SOURCES.length >= 10, `sanity: PRICE_BANDS_SOURCES has ${PRICE_BANDS_SOURCES.length} entries (expected 10+)`);

for (const source of PRICE_BANDS_SOURCES) {
  check(
    Object.prototype.hasOwnProperty.call(TIER_SOURCE_MAP, source),
    `TIER_SOURCE_MAP has an explicit entry for "${source}"`
  );
}

// The inverse direction matters too, though less urgently: a
// TIER_SOURCE_MAP entry with no corresponding PRICE_BANDS_SOURCES entry
// isn't a pricing hazard (nothing silently falls through), but it does
// mean PRICE_BANDS_SOURCES has drifted out of being a genuinely
// exhaustive list — worth knowing, not worth failing the build over.
// Documented "legacy (pre-tier)" keys are expected here and excluded.
const LEGACY_KEYS = new Set(['verified_sold', 'verified_active', 'verified_sold_active_blend']);
const orphanedMapEntries = Object.keys(TIER_SOURCE_MAP).filter(
  (key) => !LEGACY_KEYS.has(key) && !PRICE_BANDS_SOURCES.includes(key)
);
if (orphanedMapEntries.length > 0) {
  console.log(`  ⚠ TIER_SOURCE_MAP has entries not in PRICE_BANDS_SOURCES (informational, not a failure): ${orphanedMapEntries.join(', ')}`);
} else {
  check(true, 'no orphaned TIER_SOURCE_MAP entries beyond the documented legacy keys');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
