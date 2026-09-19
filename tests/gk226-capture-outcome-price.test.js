// tests/gk226-capture-outcome-price.test.js
//
// GK-226 — proves the exact root cause and fix for Old Man Logan #25's
// durable $0.00 valuation_event (gkAssetId 01a0bb24-c806-7a63-aa86-
// ce26fe8eed83). No DB — pure function proof.
//
// Root cause: GrailKeyOperatorPanel.jsx's capture payload builder did
// `item.price != null ? \`$${Number(item.price).toFixed(2)}\` : null`.
// item.price is a dollar-formatted STRING throughout this codebase
// (api/enrich.js's fmtUsd(), e.g. "$15.28" — confirmed live in
// collection_item.attributes.price for the real Production asset).
// Number("$15.28") is NaN; `${NaN}`.toFixed... -> "NaN"; the resulting
// "$NaN" string is non-empty so mapping.js's hasValuation() (a bare
// truthiness check) passed, but mapValuation()'s digit-only regex
// (`replace(/[^0-9.]/g, '')`) strips "N"/"a" right along with "$",
// leaving "" -> Number('') -> 0. A real valuation_event was durably
// written with value_amount 0.00 this way.
//
// Invoke: node tests/gk226-capture-outcome-price.test.js

import { buildCaptureOutcomePrice } from '../src/lib/captureOutcomeMapping.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

// Reproduces the ORIGINAL buggy inline expression, for direct comparison.
function oldBuggyLogic(item) {
  return item.price != null ? `$${Number(item.price).toFixed(2)}` : null;
}

console.log('\n=== GK-226 — capture outcome price mapping ===\n');

console.log('-- Reproducing the real bug: a dollar-formatted string price --\n');
const realShapeItem = { price: '$15.28' }; // exact real shape, collection_item.attributes.price
assertTrue(oldBuggyLogic(realShapeItem) === '$NaN', `OLD logic on a real "$X.XX" string produced the broken "$NaN" (got ${oldBuggyLogic(realShapeItem)})`);
assertTrue(buildCaptureOutcomePrice(realShapeItem) === '$15.28', `NEW logic correctly reproduces $15.28 (got ${buildCaptureOutcomePrice(realShapeItem)})`);

// Confirm the OLD "$NaN" string really does strip to 0 under mapping.js's
// own regex, proving the causal chain end-to-end (not just asserting the
// intermediate string).
const oldStripped = Number(String(oldBuggyLogic(realShapeItem)).replace(/[^0-9.]/g, ''));
assertTrue(Object.is(oldStripped, 0), `OLD "$NaN" string strips (mapping.js's own regex) to exactly 0 — this is the real cause of the durable $0.00 row (got ${oldStripped})`);
const newStripped = Number(String(buildCaptureOutcomePrice(realShapeItem)).replace(/[^0-9.]/g, ''));
assertTrue(newStripped === 15.28, `NEW "$15.28" string strips correctly to 15.28, not 0 (got ${newStripped})`);

console.log('\n-- Old Man Logan #25\'s own real current price --\n');
const oml25 = { price: '$15.28' }; // real, current collection_item.attributes.price value, verified live 2026-09-19
assertTrue(buildCaptureOutcomePrice(oml25) === '$15.28', 'the real OML25 price string round-trips correctly');

console.log('\n-- A raw numeric price (should also still work, e.g. an older/different caller shape) --\n');
assertTrue(buildCaptureOutcomePrice({ price: 42.5 }) === '$42.50', 'a raw number is also handled correctly');

console.log('\n-- Null/undefined price --\n');
assertTrue(buildCaptureOutcomePrice({ price: null }) === null, 'null price -> null (never a fabricated $0.00)');
assertTrue(buildCaptureOutcomePrice({}) === null, 'missing price field -> null');
assertTrue(buildCaptureOutcomePrice(null) === null, 'null item -> null, does not throw');

console.log('\n-- Zero, genuinely --\n');
assertTrue(buildCaptureOutcomePrice({ price: '$0.00' }) === '$0.00', 'a genuinely-zero price string is preserved as $0.00, not conflated with the null case');
assertTrue(buildCaptureOutcomePrice({ price: 0 }) === '$0.00', 'a genuinely-zero raw number is also preserved as $0.00');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
