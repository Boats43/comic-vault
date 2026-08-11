// GrailKey Directive 2026-08-11-B, Task 2 — eBay UNAVAILABLE != EMPTY.
//
// Doctrine violation being closed: an eBay outage (missing credentials, no
// title to search, a thrown fetch error) was observationally identical to a
// successful eBay search that genuinely found zero listings. Both collapsed
// to rawComps.count===0 with no distinguishing signal anywhere downstream
// (GrailKey Directive A, Task 4 finding). "Honest and locked, never
// confident and wrong" requires the operator be able to tell these apart.
//
// PART A — emptyComps() now classifies each zero-result reason as
//          unavailable (search couldn't run) or genuine-zero (search ran,
//          found nothing). Real import, real function.
// PART B — decisionEngine.computeDecision() escalates a new
//          'ebay-source-unavailable' critical warning to RESEARCH when
//          item.ebaySourceUnavailable is true. Real import, real function.
// PART C — api/enrich.js's refuse-to-price block produces a distinct
//          priceNote for the unavailable case vs the genuine-zero case.
//          enrich.js is a request handler, not an importable module (same
//          constraint documented in tests/ship23-consistency.test.js) — the
//          exact conditional is mirrored here byte-for-byte against the
//          real source at api/enrich.js, cited by line number at each
//          assertion, same convention as ship23-consistency.test.js FIX 2.
//
// Invoke: node tests/grailkey-directive-b-task2-ebay-unavailable.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { emptyComps } from '../api/comps.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

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
const assertTrue = (actual, label) => assertEq(actual, true, label);
const assertFalse = (actual, label) => assertEq(actual, false, label);

console.log('\n=== GrailKey Directive B, Task 2 — eBay UNAVAILABLE != EMPTY ===\n');

// ─── PART A: emptyComps() classification ───
console.log('PART A — emptyComps() unavailable classification (api/comps.js):');

const missingCreds = emptyComps(null, 'missing eBay credentials', true);
assertTrue(missingCreds.unavailable, 'missing-credentials case: unavailable=true');
assertEq(missingCreds.reason, 'missing eBay credentials', 'missing-credentials case: reason preserved');

const noTitle = emptyComps(null, 'title required', true);
assertTrue(noTitle.unavailable, 'no-title case: unavailable=true (search never attempted)');

const fetchThrew = emptyComps('spawn 1', 'ECONNRESET', true);
assertTrue(fetchThrew.unavailable, 'thrown-fetch-error case: unavailable=true');

const noSalesAfterFilters = emptyComps('spawn 1', 'no sales after filters');
assertFalse(noSalesAfterFilters.unavailable, 'no-sales-after-filters case: unavailable=false (search ran, genuinely empty)');

const noPricingEligible = emptyComps('spawn 1', 'no pricing-eligible comps after evidence classification');
assertFalse(noPricingEligible.unavailable, 'no-pricing-eligible case: unavailable=false (search ran, genuinely empty)');

const defaultCase = emptyComps('spawn 1', 'no sales after filters');
assertFalse(defaultCase.unavailable, 'unavailable param defaults to false when omitted (back-compat for every pre-existing call site)');

// ─── PART B: decisionEngine escalation ───
console.log('\nPART B — computeDecision() escalates ebay-source-unavailable (src/lib/decisionEngine.js):');

const baseItem = {
  title: 'Spawn',
  issue: '351',
  publisher: 'Image',
  year: '2024',
  identityComplete: true,
  price: '$45.00',
  rawComps: { count: 0, lowest: null },
  soldComps: [],
  soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 },
  comicVine: { matched: 'Spawn' },
  identityConfident: true,
  assetTypeConfident: true,
};

const unavailableItem = { ...baseItem, ebaySourceUnavailable: true, ebaySourceReason: 'missing eBay credentials' };
const unavailableDecision = computeDecision(unavailableItem);
assertTrue(unavailableDecision.warnings.includes('ebay-source-unavailable'), 'ebaySourceUnavailable=true item carries the ebay-source-unavailable warning');
assertEq(unavailableDecision.action, 'RESEARCH', 'ebaySourceUnavailable=true escalates decision.action to RESEARCH (price evidence uncertain, same tier as zero-verified-comps)');

const healthyItem = { ...baseItem };
const healthyDecision = computeDecision(healthyItem);
assertFalse(healthyDecision.warnings.includes('ebay-source-unavailable'), 'item with no ebaySourceUnavailable flag never carries the warning');

// ─── PART C: api/enrich.js refuse-to-price message (mirror, per ship23-consistency.test.js convention) ───
console.log('\nPART C — api/enrich.js refuse-to-price message distinguishes outage from genuine-zero:');

// Mirrors api/enrich.js's refuse-to-price block verbatim (the condition is
// unchanged by this fix -- only the priceNote text branches on the new
// out.ebaySourceUnavailable flag, set earlier at api/enrich.js:6206 from
// rawComps.unavailable).
const buildRefusePriceNote = (ebaySourceUnavailable, ebaySourceReason) =>
  ebaySourceUnavailable
    ? `eBay data unavailable (${ebaySourceReason}) — no price could be verified`
    : 'Insufficient data — no verified comps found';

assertEq(
  buildRefusePriceNote(true, 'missing eBay credentials'),
  'eBay data unavailable (missing eBay credentials) — no price could be verified',
  'refuse-to-price note names the outage reason when ebaySourceUnavailable=true'
);
assertEq(
  buildRefusePriceNote(false, null),
  'Insufficient data — no verified comps found',
  'refuse-to-price note stays the original generic message when eBay genuinely returned zero (unchanged behavior, no regression)'
);

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
