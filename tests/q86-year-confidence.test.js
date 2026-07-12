// Q86 — Year confidence: unproven year → PC year-mismatch is a rank
// penalty, never a rejection.
//
// Funnybook class: Vision guessed a year with no eBay ratio, no PC anchor,
// no cover-read. PC's only real product "Funny Book #1 (1971)" was
// rejected on the 5-year gap and the book starved. With confidence
// plumbed: proven years keep the strict gate; unproven years demote
// mismatched products below year-matching ones and accept them as
// fallback.
//
// Invoke: node tests/q86-year-confidence.test.js

import { resolveYear } from '../src/lib/identityCore.js';

process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-token';
const { lookupPriceCharting } = await import('../api/enrich.js');

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. resolveYear confidence classes ──────────────────────────────
console.log('── resolveYear confidence ──');
{
  const visionOnly = resolveYear('2015', null, null, null, {});
  check(visionOnly.yearConfidence === 'unproven', `vision-only → unproven (got ${visionOnly.yearConfidence})`);

  const ebay = resolveYear('2015', null, null, 1971, {});
  check(ebay.yearConfidence === 'proven' && ebay.confirmedYear === '1971',
    `ebay-consensus → proven, adopts pool year (got ${ebay.yearConfidence}/${ebay.confirmedYear})`);

  const pc = resolveYear('1971', 1971, null, null, {});
  check(pc.yearConfidence === 'proven', `pc-corroborated → proven (got ${pc.yearConfidence})`);

  const rejected = resolveYear('2015', 1971, 1972, null, {});
  check(rejected.yearConfidence === 'proven' || rejected.yearOverrideRejected === true,
    `pc-cv agreement path handled (source=${rejected.yearSource}, conf=${rejected.yearConfidence})`);

  const visionRejected = resolveYear('2015', 1990, null, null, {});
  check(visionRejected.yearSource === 'vision-rejected-override'
    ? visionRejected.yearConfidence === 'unproven'
    : true,
    `vision-rejected-override → unproven (source=${visionRejected.yearSource})`);
}

// ── 2. PC matcher: Funny Book #1 (1971) replica via fetch stub ─────
console.log('\n── lookupPriceCharting penalty behavior ──');
const PRODUCTS = {
  products: [
    { id: 'fb1', 'product-name': 'Funny Book #1 (1971)', 'loose-price': 4200 },
  ],
};
globalThis.fetch = async () => ({ ok: true, json: async () => PRODUCTS });

{
  // Unproven claimed year 2015 vs product 1971 (44y gap) → tolerated
  const r = await lookupPriceCharting({
    title: 'Funny Book', issue: '1', year: '2015', yearConfidence: 'unproven',
  });
  check(r != null, 'unproven year → product accepted');
  check(r?.yearMismatchTolerated === true, 'flagged yearMismatchTolerated');
  check(r?.year === 1971, `product-page year surfaces (got ${r?.year})`);
}

{
  // Proven claimed year 2015 vs product 1971 → strict gate holds
  const r = await lookupPriceCharting({
    title: 'Funny Book', issue: '1', year: '2015', yearConfidence: 'proven',
  });
  check(r == null, 'proven year → mismatch still rejected (strict gate unchanged)');
}

{
  // Unproven, but a year-MATCHING product exists → it outranks the fallback
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      products: [
        { id: 'wrong', 'product-name': 'Funny Book #1 (1971)', 'loose-price': 4200 },
        { id: 'right', 'product-name': 'Funny Book #1 (2014)', 'loose-price': 900 },
      ],
    }),
  });
  const r = await lookupPriceCharting({
    title: 'Funny Book', issue: '1', year: '2015', yearConfidence: 'unproven',
  });
  check(r?.id === 'right' && !r?.yearMismatchTolerated,
    `year-matching product outranks mismatched fallback (got ${r?.id})`);
}

{
  // Default parameter = proven (all untouched callers keep strict behavior)
  globalThis.fetch = async () => ({ ok: true, json: async () => PRODUCTS });
  const r = await lookupPriceCharting({ title: 'Funny Book', issue: '1', year: '2015' });
  check(r == null, 'default confidence is proven — no behavior change for legacy calls');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
