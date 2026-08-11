// tests/grailkey-dispatch-e-task3-source-labels.test.js
//
// GrailKey Directive 2026-08-11-D found src/App.jsx's PRICING_SOURCE_LABELS
// and PRICE_BANDS_SOURCE_LABELS (both introduced by GK-67, c0653a5,
// 2026-08-10) fall through to a literal "unavailable"/"source-unavailable"
// wording for any token they don't enumerate -- a coincidence that collided
// with GK-72's real out.ebaySourceUnavailable field (bbcb719, 2026-08-11,
// one day later). Two real production scans with eBay confirmed healthy
// still rendered "Source unavailable + eBay sold" and "Based on 27
// source-unavailable comps" -- purely because api/enrich.js had assigned a
// pricingSource/priceBands.source value neither map enumerated.
//
// Directive 2026-08-11-E, Task 3 completes both maps (src/lib/sourceLabels.js)
// and changes the fallback to echo the raw token instead of "unavailable"
// wording. This suite:
//   1. Asserts every known value produces a real (non-fallback) label.
//   2. Asserts the fallback string never contains any form of "unavailable".
//   3. GUARD: statically re-derives the live set of out.pricingSource /
//      out.priceBands.source literal assignments directly from
//      api/enrich.js's own source text (the same "read the real file, don't
//      trust a hand-maintained mirror" approach tests/grailkey-commit-e/f/g
//      already use for their own git-diff checks) and fails if any
//      assigned value is missing a label. This is the actual drift-catching
//      mechanism -- a hand-maintained duplicate list would just be a fifth
//      instance of the drifted-duplicate-constant class this codebase has
//      already hit multiple times (Q119/Q127/Q128, GK-37).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PRICING_SOURCE_LABELS,
  PRICE_BANDS_SOURCE_LABELS,
  getPricingSourceLabel,
  getPriceBandsSourceLabel,
} from '../src/lib/sourceLabels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

// The OLD map, verbatim, as it shipped from GK-67 (c0653a5) before this
// fix (src/App.jsx's inline PRICING_SOURCE_LABELS prior to Directive E,
// Task 3). Reconstructed here so this suite can demonstrate the real,
// shipped defect directly -- the guard mechanism (part 3 below) is only
// meaningful if it can be shown actually catching a real gap, not just
// asserted to work against a map already known to be complete.
const OLD_PRICING_SOURCE_LABELS = {
  pricecharting: "PriceCharting market data",
  browse_api: "Browse API — active listings",
  verified_sold_recency: "verified sold comps (recency-weighted)",
  sold_active_blend_30: "sold + active blend (70/30)",
  verified_sold: "verified sold comps",
  verified_sold_stale: "verified sold comps (stale)",
  active_ask_derived: "active listing asks",
  pc_estimate: "PriceCharting estimate",
  verified_sold_active_blend: "sold + active blend (verified)",
};
function oldGetPricingSourceLabel(source) {
  const label = OLD_PRICING_SOURCE_LABELS[source];
  return label ? `Source: ${label}` : "Source unavailable";
}

function assertTruthy(value, message) {
  if (!value) throw new Error(`${message}\nExpected truthy, got: ${value}`);
}

// ── 1. Every known value produces a real label ─────────────────────

const KNOWN_PRICING_SOURCES = Object.keys(PRICING_SOURCE_LABELS);
const KNOWN_PRICE_BANDS_SOURCES = Object.keys(PRICE_BANDS_SOURCE_LABELS);

for (const source of KNOWN_PRICING_SOURCES) {
  test(`pricingSource "${source}" produces a real label, not the fallback`, () => {
    const rendered = getPricingSourceLabel(source);
    assertTruthy(rendered.startsWith('Source: ') && rendered !== `Source: ${source}`,
      `Expected a friendly label for a known source. Got: "${rendered}"`);
  });
}

for (const source of KNOWN_PRICE_BANDS_SOURCES) {
  test(`priceBands.source "${source}" produces a real label, not the raw token`, () => {
    const rendered = getPriceBandsSourceLabel(source);
    assertTruthy(rendered !== source, `Expected a friendly label for a known source. Got: "${rendered}"`);
  });
}

// ── DEFECT DEMONSTRATION — the OLD map, on the two real production cases ──

test('DEFECT DEMONSTRATION: the OLD map renders "Source unavailable" for a healthy visual_pool_fallback scan (Spawn #351 shape)', () => {
  // Real production case: 4 active listings, 1 sold comp, eBay confirmed
  // healthy (no [ebay-source] unavailable logged) -- pricingSource landed
  // on visual_pool_fallback, a value the OLD map never enumerated.
  const rendered = oldGetPricingSourceLabel('visual_pool_fallback');
  assertTruthy(rendered === 'Source unavailable',
    `This assertion documents the real, shipped defect: the old map rendered exactly this string for a healthy scan. Got: "${rendered}"`);
});

test('DEFECT DEMONSTRATION: the guard mechanism itself catches the OLD map missing this value', () => {
  const missing = ['visual_pool_fallback', 'thin_pool_anchor', 'ai_estimate']
    .filter((v) => !(v in OLD_PRICING_SOURCE_LABELS));
  assertTruthy(missing.length === 3,
    `The OLD map should be missing all three of these real api/enrich.js values -- if this ever fails, the OLD reconstruction has drifted from what actually shipped.`);
});

// ── 2. Fallback never says "unavailable" ────────────────────────────

test('unmapped pricingSource echoes the raw token, never "unavailable"', () => {
  const rendered = getPricingSourceLabel('some_brand_new_unmapped_token');
  assertTruthy(!/unavailable/i.test(rendered), `Fallback must not contain "unavailable". Got: "${rendered}"`);
  assertTruthy(rendered.includes('some_brand_new_unmapped_token'), `Fallback should echo the raw token. Got: "${rendered}"`);
});

test('null/undefined pricingSource does not say "unavailable" either', () => {
  const rendered = getPricingSourceLabel(null);
  assertTruthy(!/unavailable/i.test(rendered), `Fallback must not contain "unavailable" even for a null source. Got: "${rendered}"`);
});

test('unmapped priceBands.source echoes the raw token, never "source-unavailable"', () => {
  const rendered = getPriceBandsSourceLabel('some_brand_new_unmapped_token');
  assertTruthy(!/unavailable/i.test(rendered), `Fallback must not contain "unavailable". Got: "${rendered}"`);
  assertTruthy(rendered === 'some_brand_new_unmapped_token', `Fallback should be exactly the raw token. Got: "${rendered}"`);
});

// ── 3. GUARD — re-derive the live assignment set from api/enrich.js ─

// Strip `//`-style line comments before matching -- a commented-out
// assignment (e.g. "// REMOVED: out.pricingSource = 'x'") is not a live
// value and must not force a label requirement on its own. Simple
// per-line strip; safe here since no live pricingSource/priceBands.source
// literal in this file contains "//" inside its own string content.
const enrichSourceLive = readFileSync(join(repoRoot, 'api', 'enrich.js'), 'utf8')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');
const enrichSource = enrichSourceLive;

// out.pricingSource = 'literal' / "literal" — every direct literal
// assignment. (TIER_SOURCE_MAP's own output values are covered by the
// separate KNOWN_PRICING_SOURCES loop above via priceBands.js's exported
// map, not re-parsed here — this regex only catches api/enrich.js's own
// direct literal assignments.)
const pricingSourceAssignments = [...enrichSource.matchAll(/out\.pricingSource\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/g)]
  .map((m) => m[1]);

test('GUARD: every out.pricingSource literal assignment in api/enrich.js has a label', () => {
  const uniqueValues = [...new Set(pricingSourceAssignments)];
  assertTruthy(uniqueValues.length > 10, `Sanity check: expected many assignment sites, found ${uniqueValues.length} -- the regex may have stopped matching api/enrich.js's real syntax.`);
  const missing = uniqueValues.filter((v) => !(v in PRICING_SOURCE_LABELS));
  assertTruthy(missing.length === 0, `api/enrich.js assigns out.pricingSource to values with no label in src/lib/sourceLabels.js: ${JSON.stringify(missing)}`);
});

// out.priceBands = { ... source: 'literal', ... } and the ternary form
// (fb.fallbackIsolatedToFamily ? 'a' : 'b') — collect quoted literals that
// appear as the value of a `source:` key inside an out.priceBands object
// literal.
const priceBandsBlocks = [...enrichSource.matchAll(/out\.priceBands(?:\.source)?\s*=\s*\{?[\s\S]{0,400}/g)]
  .map((m) => m[0]);
const priceBandsSourceLiterals = new Set();
for (const block of priceBandsBlocks) {
  const sourceLineMatch = block.match(/source:\s*([^\n,]+)/);
  if (!sourceLineMatch) continue;
  const rhs = sourceLineMatch[1];
  for (const litMatch of rhs.matchAll(/['"]([a-zA-Z0-9_-]+)['"]/g)) {
    priceBandsSourceLiterals.add(litMatch[1]);
  }
}

test('GUARD: every literal found in an out.priceBands source: assignment in api/enrich.js has a label', () => {
  assertTruthy(priceBandsSourceLiterals.size >= 2, `Sanity check: expected at least the mega-key-floor and visual_pool_fallback overwrites, found ${priceBandsSourceLiterals.size} -- the regex may have stopped matching api/enrich.js's real syntax.`);
  const missing = [...priceBandsSourceLiterals].filter((v) => !(v in PRICE_BANDS_SOURCE_LABELS));
  assertTruthy(missing.length === 0, `api/enrich.js assigns out.priceBands.source to values with no label in src/lib/sourceLabels.js: ${JSON.stringify(missing)}`);
});

// ─────────────────────────────────────────────────────────────────

console.log('\n=== GrailKey Directive E, Task 3 — source label maps ===\n');
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
    failed++;
  }
}
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
