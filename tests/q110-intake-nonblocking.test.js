// tests/q110-intake-nonblocking.test.js
//
// Q110 dispatch (2026-07-18) — "every card must show a price when ANY
// pricing data exists, regardless of confidence tier; asset-type flag
// becomes informational, never a hard block on data already computed."
//
// Part 1 (Walking Dead #109 class): assetTypeConfident=false / Vision-
// confirmed reprint no longer null price/comps at the data layer, no
// longer force ID_REQUIRED at the decision layer, and route to contract
// state=LOCKED (price visible, listing gated) instead of REFUSED/
// ID_REQUIRED (price nulled everywhere).
// Part 2 (Siege #3 class): identity-refused (title-family clustering
// conflict) still surfaces the visual-pool-fallback price/range computed
// from the same eBay reverse-image-search pool, instead of a blank
// "CANNOT PRICE" wall.
// Part 3 (messaging specificity): decisionEngine.js's per-slug message
// builders (describeBlocker/describeWarning) surface the ACTUAL reason
// already known to the system instead of a raw slug/generic label.
//
// Tests the pure layers directly (decisionEngine.js computeDecision +
// describeWarning, responseContract.js assembleContract/finalizeResponse)
// — the same shapes api/enrich.js assembles, without needing to invoke the
// full serverless handler or live API calls.
//
// Invoke: node tests/q110-intake-nonblocking.test.js

import { computeDecision, describeWarning, describeBlocker } from '../src/lib/decisionEngine.js';
import { finalizeResponse } from '../src/lib/responseContract.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNotNull = (v, label) => assertTrue(v !== null && v !== undefined, label);

console.log('\n=== Q110 — INTAKE NON-BLOCKING (asset-type/reprint/identity-conflict advisory) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1a — Walking Dead #109 class: assetTypeConfident=false with a real
// comp pool computed underneath must show price, not a blank ID_REQUIRED
// wall.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1a: assetTypeConfident=false with real comps — price must show');

const walkingDeadOut = {
  title: 'The Walking Dead',
  issue: '109',
  publisher: 'Image',
  year: 2013,
  price: 12.38,
  priceLow: 9.99,
  priceHigh: 15.5,
  priceBands: { quick: 9.99, market: 12.38, stretch: 15.5 },
  pricingSource: 'active_ask_derived',
  assetTypeConfident: false,
  listingHardLocked: true,
  listingHardLockReason: 'asset-type-uncertain',
  listingHardLockBanner: 'This image may be a reference scan or promotional print — verify before listing',
  identityConfident: true,
  rawComps: { count: 10, average: 12.0, lowest: 9.99, highest: 15.5 },
  comps: { count: 10, average: 12.0 },
};
const wdDecision = computeDecision(walkingDeadOut);
walkingDeadOut.decision = wdDecision;
const wdResult = finalizeResponse(walkingDeadOut);

assertEq(wdDecision.action, 'RESEARCH', 'decision.action = RESEARCH (advisory, not ID_REQUIRED)');
assertTrue(!wdDecision.blockers.includes('asset-type-mismatch'), 'no longer a hard blocker');
assertTrue(wdDecision.warnings.includes('asset-type-uncertain'), 'advisory warning present');
assertEq(wdResult.contract.state, 'LOCKED', 'contract.state = LOCKED, not ID_REQUIRED/REFUSED');
assertNotNull(wdResult.contract.price, 'contract.price is NOT null — the number shows');
assertEq(wdResult.contract.price, 12.38, 'contract.price = 12.38 (real computed comp-derived price)');
assertNotNull(wdResult.contract.bands, 'contract.bands present alongside the price');
assertTrue(
  wdResult.contract.locks.some((l) => /reference scan|promotional print/i.test(l.reason)),
  'flag stays visible as a lock reason, sitting alongside the price'
);
assertTrue(!wdResult.contract.listable, 'listing itself still gated pending verification (LOCKED semantics)');

// ═══════════════════════════════════════════════════════════════════════
// PART 1b — Vision-confirmed reprint/editionType: same non-blocking
// treatment, comps not suppressed via isPolybagPricing.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1b: Vision-confirmed reprint with real comps — price must show');

const reprintOut = {
  title: 'Amazing Fantasy',
  issue: '15',
  publisher: 'Marvel',
  year: 1962,
  price: 45.0,
  priceBands: { quick: 30, market: 45, stretch: 60 },
  pricingSource: 'ebay-polybag-active',
  visionConfirmedReprint: true,
  listingHardLocked: true,
  listingHardLockReason: 'vision-confirmed-reprint',
  listingHardLockBanner: 'Vision detected reprint/facsimile markings — verify edition before listing',
  identityConfident: true,
  rawComps: { count: 8, average: 44, lowest: 30, highest: 60 },
};
const reprintDecision = computeDecision(reprintOut);
reprintOut.decision = reprintDecision;
const reprintResult = finalizeResponse(reprintOut);

assertEq(reprintResult.contract.state, 'LOCKED', 'reprint case: contract.state = LOCKED');
assertNotNull(reprintResult.contract.price, 'reprint case: price shows, not nulled');
assertTrue(
  reprintResult.contract.locks.some((l) => /reprint|facsimile/i.test(l.reason)),
  'reprint advisory flag still visible'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — Siege #3 class: identity-refused still surfaces a
// visual-pool-fallback price/range instead of a blank CANNOT PRICE wall.
// Mirrors the exact refusedOut shape api/enrich.js's identityRefused
// early-return now constructs (Ship-11 median/P25/P75 formula).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: identity-refused with a visual pool — fallback estimate must show');

const siegeOut = {
  title: 'Siege',
  issue: '3',
  publisher: 'Marvel',
  year: 2010,
  refusalReason: 'Visual pool families lack overlap with Vision',
  message: 'Visual pool families lack overlap with Vision',
  listingHardLocked: true,
  listingHardLockReason: 'identity-unresolved',
  listingHardLockBanner: 'Visual identification uncertain — Visual pool families lack overlap with Vision — verify before listing',
  confidenceLevel: 'LOW',
  price: '$30.00',
  priceLow: '$9.95',
  priceHigh: '$125.99',
  priceBands: { quick: 9.95, market: 30.0, stretch: 125.99, source: 'visual_pool_fallback', count: 20 },
  pricingSource: 'visual_pool_fallback',
  priceNote: 'Estimated from 20 visually similar active listings — identity unconfirmed, verify before listing.',
  visualPoolUsed: true,
  visualPoolSize: 20,
};
const siegeDecision = computeDecision(siegeOut);
siegeOut.decision = siegeDecision;
const siegeResult = finalizeResponse(siegeOut);

assertEq(siegeDecision.action, 'RESEARCH', 'Siege #3: decision.action = RESEARCH (fallback, not walled off)');
assertTrue(!siegeDecision.blockers.includes('refused-identity-conflict'), 'no longer a hard blocker');
assertEq(siegeResult.contract.state, 'LOCKED', 'Siege #3: contract.state = LOCKED, not REFUSED');
assertNotNull(siegeResult.contract.price, 'Siege #3: fallback price shows, not blank');
assertEq(siegeResult.contract.price, 30.0, 'Siege #3: fallback price = $30.00 (median of visual pool)');
assertNotNull(siegeResult.contract.bands, 'Siege #3: fallback range shows alongside price');
assertEq(siegeResult.contract.bands.quick, 9.95, 'Siege #3: low end of range = $9.95');
assertEq(siegeResult.contract.bands.stretch, 125.99, 'Siege #3: high end of range = $125.99');

// Genuinely-zero-data sibling: eBay's reverse-image-search pool came back
// empty (visualResult.items has <5 priced entries — nothing for the Ship-11
// formula to compute from). Exact shape api/enrich.js's identityRefused
// early-return now produces on the "fallbackPrice == null" branch. Must
// still render a real, non-blank state — never REFUSED (which the old
// hard-return produced), never a crash, never nothing. Runs the FULL
// pipeline (computeDecision → finalizeResponse → assembleContract →
// validateContract), same as production, not just finalizeResponse alone.
console.log('\nPart 2b: identity-refused with an EMPTY visual pool — honest no-price, never blank/REFUSED/crash');
const siegeNoDataOut = {
  title: 'Siege',
  issue: '3',
  publisher: 'Marvel',
  year: '2010',
  refusalReason: 'No visual results from eBay',
  message: 'Visual identification uncertain',
  listingHardLocked: true,
  listingHardLockReason: 'identity-unresolved',
  listingHardLockBanner: 'Visual identification uncertain — verify before listing',
  confidenceLevel: 'LOW',
  price: null,
  priceLow: null,
  priceHigh: null,
  priceBands: null,
  pricingSource: null,
  priceNote: 'No comp or visual-similarity data available for this identification.',
};
const siegeNoDataDecision = computeDecision(siegeNoDataOut);
siegeNoDataOut.decision = siegeNoDataDecision;
const siegeNoDataResult = finalizeResponse(siegeNoDataOut);

assertEq(siegeNoDataDecision.action, 'RESEARCH', 'empty-pool case: decision.action = RESEARCH, not a crash-adjacent state');
assertEq(siegeNoDataResult.contract.state, 'LOCKED', 'empty-pool case: contract.state = LOCKED, not REFUSED, not blank');
assertEq(siegeNoDataResult.contract.price, null, 'empty-pool case: honestly no price (nothing was computed to show)');
assertEq(siegeNoDataResult.contract.violations.length, 0, 'empty-pool case: zero contract invariant violations (not demoted to INCOMPLETE)');
assertTrue(
  siegeNoDataResult.contract.locks.length > 0 && typeof siegeNoDataResult.contract.locks[0].reason === 'string' && siegeNoDataResult.contract.locks[0].reason.length > 0,
  'empty-pool case: locks[0].reason is a real, non-empty string — this is literally what App.jsx renders as the "🔒 LISTING LOCKED" banner text, so the card always shows SOMETHING, never a blank screen'
);
assertEq(
  siegeNoDataResult.contract.locks[0].reason,
  'Visual identification uncertain — verify before listing',
  'empty-pool case: banner reads the actual advisory copy, not a placeholder'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — Edge of Spider-Verse class: the genuine non-comic case still
// surfaces SOME data with a clear flag ("lowest confidence tier"), not the
// old hard ID_REQUIRED wall.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3a: genuine non-comic (poster) with a thin visual-pool price still surfaces something');

const posterOut = {
  title: 'Edge of Spider-Verse',
  issue: '1',
  publisher: 'Marvel',
  year: 2014,
  assetTypeConfident: false,
  listingHardLocked: true,
  listingHardLockReason: 'asset-type-uncertain',
  listingHardLockBanner: 'This image may be a reference scan or promotional print — verify before listing',
  identityConfident: true,
  price: 8.5,
  pricingSource: 'visual_pool_fallback',
  priceBands: { quick: 5, market: 8.5, stretch: 12 },
  rawComps: { count: 0 },
};
const posterDecision = computeDecision(posterOut);
posterOut.decision = posterDecision;
const posterResult = finalizeResponse(posterOut);

assertTrue(posterResult.contract.state !== 'ID_REQUIRED', 'poster case: no longer the hard ID_REQUIRED wall');
assertNotNull(posterResult.contract.price, 'poster case: some price/estimate still surfaces');
assertEq(posterDecision.action, 'RESEARCH', 'poster case: reframed as lowest-confidence RESEARCH tier, not "no information"');

// ═══════════════════════════════════════════════════════════════════════
// PART 3b — messaging specificity: describeWarning/describeBlocker surface
// the actual reason, not a raw slug.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3b: specific messaging replaces generic slugs');

const zeroVerifiedMsg = describeWarning('zero-verified-comps', {
  soldCompDiagnostics: { rawCount: 12, verifiedCount: 0, reasons: { variantMismatch: 9, titleMismatch: 2, stale: 1 } },
});
assertTrue(/variant mismatch/i.test(zeroVerifiedMsg), `zero-verified-comps names the dominant cause: "${zeroVerifiedMsg}"`);
assertTrue(zeroVerifiedMsg !== 'zero-verified-comps', 'not the raw slug');

const contentUnverifiedMsg = describeWarning('content-unverified', { storySuppressedReason: 'publisher-mismatch' });
assertTrue(/publisher/i.test(contentUnverifiedMsg), `content-unverified names the specific mismatch: "${contentUnverifiedMsg}"`);
assertTrue(contentUnverifiedMsg !== 'content-unverified', 'not the raw slug');

const thinPoolMsg = describeWarning('thin-pool-anchor', { rawComps: { count: 2 } });
assertTrue(/\b2\b/.test(thinPoolMsg), `thin-pool-anchor names the actual count: "${thinPoolMsg}"`);

const contaminatedMsg = describeWarning('comp-pool-contaminated', { variantFallback: true, reprintFallback: false });
assertTrue(/variant/i.test(contaminatedMsg), `comp-pool-contaminated names variant specifically: "${contaminatedMsg}"`);

const identityConflictMsg = describeWarning('identity-conflict-unresolved', {
  refusalReason: 'Visual pool families lack overlap with Vision',
});
assertTrue(/lack overlap/i.test(identityConflictMsg), `identity-conflict-unresolved surfaces the real reason: "${identityConflictMsg}"`);

const assetTypeMsg = describeWarning('asset-type-uncertain', {
  listingHardLockBanner: 'This image may be a reference scan or promotional print — verify before listing',
});
assertTrue(/reference scan|promotional print/i.test(assetTypeMsg), `asset-type-uncertain surfaces the specific advisory: "${assetTypeMsg}"`);

// Every warning slug the engine can push must resolve to something other
// than the bare slug itself — guards against a future push() with no
// matching describeWarning branch silently regressing back to raw-slug
// display.
const allWarningSlugs = [
  'asset-type-uncertain', 'identity-conflict-unresolved', 'active-floor-far-below',
  'recommended-below-floor', 'active-avg-far-below', 'sold-comps-stale',
  'zero-verified-comps', 'thin-pool-anchor', 'comp-pool-contaminated',
  'vision-low-confidence', 'ai-verify-rejected-all', 'identity-from-consensus',
  'refused-to-price', 'verification-failed-claude', 'verification-failed-no-data',
  'verification-failed-visual-fallback', 'web-search-pricing', 'uk-weekly-no-comps',
  'verification-failed-reprint-thin', 'content-unverified', 'sold-active-mismatch-extreme',
  'era-risk-vintage-thin', 'reprint-polybag-detected', 'filter-bypass-detected',
  'claude-check-high-severity', 'floor-contamination-suspect', 'all-sold-comps-stale',
  'bundle-candidate', 'cold-market-velocity', 'zero-velocity', 'hot-market-velocity',
  'low-confidence-escalation', 'recommended-below-floor', 'internal-inconsistency',
  'variant-comps-unavailable', 'variant-pool-year-conflict', 'artist-identity-conflict',
];
let allDescribed = true;
for (const slug of allWarningSlugs) {
  const msg = describeWarning(slug, {});
  if (msg === slug) {
    allDescribed = false;
    console.log(`    (no specific description for warning slug: ${slug})`);
  }
}
assertTrue(allDescribed, 'every known warning slug has a specific description (no raw-slug fallback)');

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
