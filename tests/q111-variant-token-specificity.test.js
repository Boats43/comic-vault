// tests/q111-variant-token-specificity.test.js
//
// Q111 dispatch (2026-07-18) — Venomverse #1 class: variant-match used only
// the generic descriptor token ("foil"), discarding specific tokens
// (sdcc/1:1000) that were already correctly extracted, pooling genuinely
// different products (2017 1:2000 remastered, 2017 1:1000 remastered
// incentive, 2025 SDCC 1:1000 Mexican foil) into one comp average.
//
// Two coordinated fixes, tested together and independently:
//   Fix #1 (src/lib/imageSearchIdentity.js, extractConsensus) — per-
//   category variant consensus, replacing the flat single-winner-token
//   collapse that always picked the most common category (generic
//   "finish" tokens like "foil" in a foil-heavy pool) and discarded
//   co-occurring specific tokens (convention/ratio/retailer/exclusive/
//   limitation/authentication).
//   Fix #2 (api/comps.js, applyVariantPreferenceFilter / Filter 1c) —
//   AND-match on specific tokens when 2+ exist, instead of the old
//   any-single-token OR-match. Falls back to OR-match if the AND-match
//   produces zero comps (flagged via matchMode, never silent).
//
// Confirmed NOT covered by the same-day Magik #1 / Silk #1 fix (commit
// 1ea15f8, PREMIUM_VARIANT_RE + minMatches threshold only) — that fix
// assumed the token list was already correct and only relaxed the count.
//
// Invoke: node tests/q111-variant-token-specificity.test.js

import { extractIdentityFromImageSearch, extractConsensus, classifyVariantTokens } from '../src/lib/imageSearchIdentity.js';
import { applyVariantPreferenceFilter } from '../api/comps.js';

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
const assertIncludes = (arr, val, label) => assertTrue(Array.isArray(arr) && arr.includes(val), label);
const assertNotIncludes = (arr, val, label) => assertTrue(Array.isArray(arr) && !arr.includes(val), label);

console.log('\n=== Q111 — VARIANT TOKEN SPECIFICITY (Venomverse #1 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE A — Venomverse #1: real raw pool shape from the production log.
// Three genuinely distinct products sharing "Venomverse #1" title (already
// past title/era filters) and, critically, TWO of them share "1:1000" with
// the correct book despite being a different (2017) product entirely.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture A: Venomverse #1 mixed pool (2017 remastered x2 + 2025 SDCC Mexican foil)');

const venomverseItems = [
  // 2017 "1:2000 REMASTERED B&W VARIANT" — wrong ratio, wrong product
  { title: 'Venomverse #1 2017 1:2000 Remastered B&W Variant NM' },
  { title: 'Venomverse #1 2017 1:2000 Remastered Black White Variant' },
  // 2017 "1:1000 REMASTERED INCENTIVE COLOR VARIANT" — SAME ratio as our
  // book (1:1000) but a different, cheaper 2017 product — the exact trap
  // a naive single-token match on "1:1000" alone would also fail on.
  { title: 'Venomverse #1 2017 1:1000 Remastered Incentive Color Variant' },
  { title: 'Venomverse #1 1:1000 Remastered Incentive Color Variant 2017 NM' },
  // 2025 "SDCC McFarlane 1:1000 Mexican Foil" — the actual matching book
  { title: 'Venomverse #1 2025 SDCC McFarlane 1:1000 Mexican Foil NM' },
  { title: 'Venomverse #1 SDCC 2025 McFarlane 1:1000 Mexican Foil' },
  { title: 'Venomverse #1 2025 SDCC Exclusive McFarlane 1:1000 Mexican Foil NM+' },
  { title: 'Venomverse #1 SDCC McFarlane 1:1000 Mexican Foil Variant 2025' },
];

const venomversePool = extractIdentityFromImageSearch(venomverseItems);

// Sanity: extractVariantTokens correctly extracted the specific tokens per
// listing all along (this was never the bug — confirms the dispatch's own
// "raw pool tokenization correctly extracted specific tokens" observation).
assertIncludes(venomversePool[4].variantTokens, 'sdcc', 'per-listing tokenization already extracts "sdcc" (SDCC McFarlane row)');
assertIncludes(venomversePool[4].variantTokens, '1:1000', 'per-listing tokenization already extracts "1:1000" (SDCC McFarlane row)');
assertIncludes(venomversePool[4].variantTokens, 'foil', 'per-listing tokenization already extracts "foil" (SDCC McFarlane row)');

// FIX #1 — per-category consensus. Before the fix, `variant` would have
// collapsed to just "foil" (the flat pool-wide winner). After the fix, the
// convention (sdcc) and ratio (1:1000) categories each independently reach
// the >=2 adoption threshold across the SDCC rows and survive alongside finish.
const consensus = extractConsensus(venomversePool);
assertTrue(consensus.variant !== 'foil', `Fix #1: variant is NOT collapsed to bare "foil" (got "${consensus.variant}")`);
assertTrue(/\bsdcc\b/.test(consensus.variant || ''), `Fix #1: variant retains "sdcc" (got "${consensus.variant}")`);
assertTrue(/1:1000/.test(consensus.variant || ''), `Fix #1: variant retains "1:1000" (got "${consensus.variant}")`);

// FIX #2 — Filter 1c AND-match using the recovered variant string. Filter
// 1c (api/comps.js) operates on the SEPARATE Phase-2 eBay text-search comp
// pool, whose items carry the RAW listing title on `.title` — distinct from
// the Phase-1 reverse-image-search `parsedRows` above, whose `.title` is
// the SANITIZED series name (extractSeriesTitle strips exactly the ratio/
// convention/finish tokens this test is about). Remap to the shape Filter
// 1c actually receives in production, keeping `.rawTitle` for assertions.
const venomverseCompsPool = venomversePool.map((r) => ({ title: r.rawTitle, rawTitle: r.rawTitle }));

// Must isolate ONLY the 4 genuine SDCC/1:1000/Mexican-foil listings,
// excluding BOTH 2017 products — including the 1:1000-sharing one, which a
// naive single-token OR-match (even post-Fix#1) would have still incorrectly pooled.
const filterResult = applyVariantPreferenceFilter(venomverseCompsPool, consensus.variant);
assertEq(filterResult.matchMode, 'all-specific', 'Fix #2: matchMode = all-specific (AND-match fired, not a fallback)');
assertTrue(filterResult.isolated, 'Fix #2: isolated = true');
assertEq(filterResult.pool.length, 4, 'Fix #2: isolates to exactly the 4 genuine SDCC listings');
assertTrue(
  filterResult.pool.every((it) => /sdcc/i.test(it.rawTitle) && /1:1000/i.test(it.rawTitle)),
  'Fix #2: every surviving comp contains BOTH "sdcc" AND "1:1000"'
);
assertTrue(
  !filterResult.pool.some((it) => /2017/.test(it.rawTitle)),
  'Fix #2: zero 2017 remastered listings survive (including the 1:1000-sharing one)'
);

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE B — Silk #1 class: single specific token (e.g. "exclusive").
// Must reduce to exactly today's (pre-Q111) behavior — unaffected.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture B: Silk #1 class — single specific token ("exclusive")');

const silkPool = [
  { title: 'Silk #1 Store Exclusive Variant NM', rawTitle: 'Silk #1 Store Exclusive Variant NM' },
  { title: 'Silk #1 Exclusive Cover NM+', rawTitle: 'Silk #1 Exclusive Cover NM+' },
  { title: 'Silk #1 Regular Cover A NM', rawTitle: 'Silk #1 Regular Cover A NM' },
  { title: 'Silk #1 Standard Edition VF', rawTitle: 'Silk #1 Standard Edition VF' },
];
const silkClassify = classifyVariantTokens('exclusive');
assertEq(silkClassify.specific.length, 1, 'Silk #1: exactly 1 specific token ("exclusive")');
const silkResult = applyVariantPreferenceFilter(silkPool, 'exclusive');
assertEq(silkResult.matchMode, 'any', 'Silk #1: matchMode = any (single specific token — old OR-match path, unaffected)');
assertTrue(silkResult.isolated, 'Silk #1: still isolates (premium keyword, 1-match threshold preserved)');
assertEq(silkResult.pool.length, 2, 'Silk #1: isolates to the 2 exclusive-cover listings, unchanged from pre-fix behavior');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE C — Magik #1 class: pure generic token only ("virgin", which
// classifies as 'finish' — generic, not specific). Must reduce to exactly
// today's behavior — unaffected.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture C: Magik #1 class — pure generic token only ("virgin")');

const magikPool = [
  { title: 'Magik #1 Virgin Variant NM', rawTitle: 'Magik #1 Virgin Variant NM' },
  { title: 'Magik #1 Virgin Cover NM+', rawTitle: 'Magik #1 Virgin Cover NM+' },
  { title: 'Magik #1 Regular Cover A NM', rawTitle: 'Magik #1 Regular Cover A NM' },
];
const magikClassify = classifyVariantTokens('virgin');
assertEq(magikClassify.specific.length, 0, 'Magik #1: "virgin" has zero specific tokens (finish category = generic)');
assertIncludes(magikClassify.generic, 'virgin', 'Magik #1: "virgin" classifies as generic (finish)');
const magikResult = applyVariantPreferenceFilter(magikPool, 'virgin');
assertEq(magikResult.matchMode, 'any', 'Magik #1: matchMode = any (no specific tokens — old OR-match path, unaffected)');
assertTrue(magikResult.isolated, 'Magik #1: still isolates (premium keyword "virgin", 1-match threshold preserved)');
assertEq(magikResult.pool.length, 2, 'Magik #1: isolates to the 2 virgin-cover listings, unchanged from pre-fix behavior');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE D — genuinely generic-only variant with no co-occurring specific
// tokens at all (bare "foil", the dispatch's own reported case in the
// hypothetical where Fix #1 still couldn't recover a specific token —
// e.g. a pool where no convention/ratio/etc. category reaches consensus).
// Confirms the ANY-match fallback path still works, doesn't over-narrow to
// zero comps.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture D: bare generic-only variant ("foil", no specific tokens) — ANY-match unaffected');

const bareFoilPool = [
  { title: 'Some Book #1 Foil Variant NM', rawTitle: 'Some Book #1 Foil Variant NM' },
  { title: 'Some Book #1 Regular Cover A NM', rawTitle: 'Some Book #1 Regular Cover A NM' },
  { title: 'Some Book #1 Regular Cover B NM+', rawTitle: 'Some Book #1 Regular Cover B NM+' },
];
const bareFoilResult = applyVariantPreferenceFilter(bareFoilPool, 'foil');
assertEq(bareFoilResult.matchMode, 'any', 'bare foil: matchMode = any (no specific tokens present at all)');
assertTrue(!bareFoilResult.isolated, 'bare foil: not "isolated" (foil is not a PREMIUM_VARIANT_RE keyword, needs >=2 to isolate)');
assertEq(bareFoilResult.pool.length, 3, 'bare foil: only 1 match < minMatches=2 — correctly falls back to keeping all 3, no over-narrowing');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE E — AND-match-produces-zero fallback: 2+ specific tokens present
// in `variant`, but no single comp in the pool contains ALL of them
// simultaneously. Must visibly flag the fallback (matchMode) and still
// return a usable (non-empty) pool via the broader OR-match, never
// silently starve to zero.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture E: AND-match produces zero — visible fallback, not silent starvation');

const fallbackPool = [
  // Contains "sdcc" but NOT "1:1000"
  { title: 'Some Book #1 SDCC Exclusive Variant NM', rawTitle: 'Some Book #1 SDCC Exclusive Variant NM' },
  { title: 'Some Book #1 SDCC 2025 Cover NM+', rawTitle: 'Some Book #1 SDCC 2025 Cover NM+' },
  // Contains "1:1000" but NOT "sdcc"
  { title: 'Some Book #1 1:1000 Incentive Variant NM', rawTitle: 'Some Book #1 1:1000 Incentive Variant NM' },
  // Contains neither
  { title: 'Some Book #1 Regular Cover A NM', rawTitle: 'Some Book #1 Regular Cover A NM' },
];
const fallbackClassify = classifyVariantTokens('sdcc 1:1000');
assertEq(fallbackClassify.specific.length, 2, 'fallback fixture: 2 specific tokens present in variant ("sdcc", "1:1000")');
const fallbackResult = applyVariantPreferenceFilter(fallbackPool, 'sdcc 1:1000');
assertEq(fallbackResult.matchMode, 'any-fallback', 'fallback fires: matchMode = any-fallback (visibly distinguishable from a clean all-specific isolation)');
assertTrue(fallbackResult.pool.length > 0, 'fallback fires: pool is NOT silently starved to zero');
assertEq(fallbackResult.pool.length, 3, 'fallback fires: falls back to the broader any-token match (3 of 4 listings, excluding only the fully-unrelated one)');

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
