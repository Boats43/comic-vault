// tests/q129-variant-comps-excluded-by-era.test.js
//
// Q129 dispatch (2026-07-19, Harley Quinn #62 Guillem March Cover C class)
// — a distinct failure shape from tonight's other three same-title-
// different-year-meaning instances (Q115 Batman #608, Q127 Catwoman #64,
// Q128 Harley Quinn #62's own active-pool tolerance gap). This is the
// FIRST one where the correct behavior (era-filter rejecting a different
// printing) is what CAUSES the downstream problem, not a filter failing
// to reject something it should have.
//
// CONFIRMED via real production log (deployment dpl_FcaXCbwE3J9HrwWysu7ZfLM2FY2X,
// build fac7b7e): the physical book is the Guillem March Cover C card-
// stock variant (confirmedYear 2019). Every currently-live eBay listing
// matching that exact description is dated 2026 (a DC homage/nostalgia
// reprint solicitation) and was correctly rejected by Filter 0c's era
// check — 3 of the era-filter's 14 rejections explicitly named "Cover C"
// and/or "Guillem March":
//   "Harley Quinn #62 2026  Cover C  Variant   DC Comics"
//   "Harley Quinn #62 Cover C Guillem March Card Stock Varia[nt]"
//   "Harley Quinn #62 DC Comics 1st Print 2026 Guillem March"
// The variant-preference filter then fell back to matching only on "1st
// print" (userVariant confirmed via the same log's own
// `[sold-reject] ... userVariant: 1st print` line) — a token shared by
// virtually every current listing, including the wrong ones — and the
// surviving 3-comp pool (generic Main Cover comps) silently produced the
// final $4.95 price with no signal that the specific variant being priced
// has zero current market data.
//
// Root cause compounding factor found during investigation: "Guillem
// March" was entirely absent from ARTIST_PATTERNS (src/lib/compHygiene.js)
// — the same drifted/incomplete-registry shape documented multiple times
// tonight, just discovered fresh here. Added as a multi-word-only pattern
// (no bare "march" fallback — collides with the calendar month).
//
// Fix: hasNamedVariantDescriptor + detectVariantCompsExcludedByEra
// (src/lib/compHygiene.js) — reuses OTHER_COVER_RE, OTHER_VARIANT_DESCRIPTOR_RE,
// and extractArtist (all pre-existing) rather than inventing a fourth
// detector. api/comps.js's Filter 0c tracks era-rejected listings that
// name a specific variant, then checks whether the FINAL priced pool
// carries any such descriptor at all — flagging only when it doesn't
// (the silent-substitution shape), not when a different-but-still-named
// variant survived instead.
//
// Invoke: node tests/q129-variant-comps-excluded-by-era.test.js

import { hasNamedVariantDescriptor, detectVariantCompsExcludedByEra } from '../src/lib/compHygiene.js';
import { computeDecision, describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
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
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q129 — VARIANT COMPS EXCLUDED BY ERA (Harley Quinn #62 Guillem March Cover C class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — hasNamedVariantDescriptor
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: hasNamedVariantDescriptor\n');

assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 Cover C Guillem March Card Stock Variant'), 'cover letter + artist + "card stock" all present — detected');
assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 DC Comics 1st Print 2026 Guillem March'), 'artist name alone (no cover letter, no "card stock") — detected via ARTIST_PATTERNS');
assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 CVR C GUILLEM MARCH CARD STOCK VAR'), 'abbreviated "CVR C" — still detected');
assertEq(hasNamedVariantDescriptor('Harley Quinn #62 Main Cover DC Comics NM 1st Print 2019'), false, 'generic Main Cover, 1st print only — NOT detected (correctly generic)');
assertEq(hasNamedVariantDescriptor('Harley Quinn #62'), false, 'bare title, no descriptor at all — NOT detected');
assertEq(hasNamedVariantDescriptor(''), false, 'empty string — NOT detected, no crash');
assertEq(hasNamedVariantDescriptor(null), false, 'null — NOT detected, no crash');
assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 David Nakayama Card Stock Variant'), 'a DIFFERENT named artist (Nakayama) also detected — not Guillem-March-specific');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — detectVariantCompsExcludedByEra
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: detectVariantCompsExcludedByEra\n');

assertNull(detectVariantCompsExcludedByEra(0, [], ['Harley Quinn #62 Main Cover 1st Print']), 'no era-excluded variant listings at all — no flag');
assertNull(detectVariantCompsExcludedByEra(3, ['a', 'b', 'c'], ['Harley Quinn #62 Cover C Guillem March Card Stock']), 'final pool STILL carries a named descriptor — no flag (a real, specific variant is still being priced)');

const flagged = detectVariantCompsExcludedByEra(
  3,
  ['Harley Quinn #62 2026 Cover C Variant', 'Harley Quinn #62 Cover C Guillem March Card Stock', 'Harley Quinn #62 1st Print 2026 Guillem March'],
  ['Harley Quinn #62 Main Cover DC Comics NM 1st Print 2019', 'Harley Quinn #62 -regular cover a (2016 series) 2019', 'Harley Quinn #62 dc comics 2019 nm']
);
assertTrue(!!flagged, 'era-excluded variant comps exist AND final pool has none — flags');
assertEq(flagged?.count, 3, 'flag carries the correct count');
assertEq(flagged?.samples?.length, 3, 'flag carries the sample titles');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — end-to-end reconstruction of the real Harley Quinn #62 pool
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: real Harley Quinn #62 pool reconstruction\n');

// The 3 Guillem March / Cover C listings among the 14 real era-filter
// rejections (production log, dep dpl_FcaXCbwE3J9HrwWysu7ZfLM2FY2X).
const eraRejectedTitles = [
  'HARLEY QUINN #62 DC Comics (2026) COVER A BRANDT&STEIN',
  'Harley Quinn #62 Cvr A Brandt (DC, 2026) NM',
  'Harley Quinn #62 A Cover DC 2026 VF/NM Comics',
  'HARLEY QUINN #62 DC Comics (2026) COVER D DERRICK CHEW',
  'HARLEY QUINN #62 - DERRICK CHEW CARDSTOCK VARIANT COVER',
  'HARLEY QUINN #62 DC Comics (2026) COVER B DAVID NAKAYAMA',
  'HARLEY QUINN #62 - DAVID NAKAYAMA CARDSTOCK VARIANT COVER',
  'Harley Quinn #62 (2026) (New) Choice of Covers',
  'Harley Quinn #62 Cvr B Nakayama Variant (DC, 2026) NM',
  'Harley Quinn #62 2026  Cover C  Variant   DC Comics',
  'Harley Quinn #62 2026 Brandt & Stein Cover A DC Comics',
  'Harley Quinn #62 Cover C Guillem March Card Stock Variant',
  'Harley Quinn #62 DC Comics 1st Print 2026 Cover A',
  'Harley Quinn #62 DC Comics 1st Print 2026 Guillem March',
];
const eraExcludedCount = eraRejectedTitles.filter(hasNamedVariantDescriptor).length;
// Not all 14 — "Cover A" listings correctly don't count (Cover A is the
// default/standard cover, not a distinguishing descriptor; OTHER_COVER_RE
// only matches B-Z), and "Brandt&Stein" isn't in ARTIST_PATTERNS (a
// separate, lower-priority gap, out of scope for this dispatch — only
// Guillem March, the artist actually relevant to this book, was added).
// The specific 3 Guillem March / Cover C listings (the ones that matter
// for this exact book) are confirmed counted below.
assertTrue(eraExcludedCount > 0, `at least some real era-rejected listings carry a named variant descriptor (got ${eraExcludedCount}/14)`);
assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 2026  Cover C  Variant   DC Comics'), 'the real "2026 Cover C Variant" rejection is counted');
assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 Cover C Guillem March Card Stock Variant'), 'the real "Cover C Guillem March Card Stock" rejection is counted');
assertTrue(hasNamedVariantDescriptor('Harley Quinn #62 DC Comics 1st Print 2026 Guillem March'), 'the real "1st Print 2026 Guillem March" rejection is counted');
assertEq(hasNamedVariantDescriptor('HARLEY QUINN #62 DC Comics (2026) COVER A BRANDT&STEIN'), false, 'a Cover A / unrecognized-artist rejection correctly does NOT count (Cover A is the default, Brandt&Stein is a separate gap out of scope here)');

// The real final 3-comp pool that actually produced the $4.95 price —
// generic Main Cover / no-descriptor comps.
const finalPricedTitles = [
  'Harley Quinn #62 main cover dc comics nm 1st print 2019',
  'Harley Quinn #62 (dc comics august 2019) vf condition 2019',
  'Harley Quinn #62 dc comics 2019 nm',
];
const realCaseResult = detectVariantCompsExcludedByEra(eraExcludedCount, eraRejectedTitles.slice(0, 3), finalPricedTitles);
assertTrue(!!realCaseResult, 'real Harley Quinn #62 case: flags — the $4.95 price silently substituted generic comps for the excluded Guillem March Cover C variant');
assertEq(realCaseResult?.count, eraExcludedCount, 'real case carries the true count of era-excluded variant listings');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — decisionEngine.js integration
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: decisionEngine.js integration\n');

const flaggedItem = {
  title: 'harley quinn',
  issue: '62',
  year: 2019,
  publisher: 'DC Comics',
  price: 4.95,
  rawComps: { count: 3, average: 5.4 },
  variantCompsExcludedByEra: { count: 3, samples: ['Harley Quinn #62 Cover C Guillem March Card Stock Variant'] },
};
const flaggedDecision = computeDecision(flaggedItem);
assertTrue(flaggedDecision.warnings.includes('variant-comps-unavailable'), 'computeDecision pushes the variant-comps-unavailable warning');
assertEq(flaggedDecision.action, 'RESEARCH', 'escalates to RESEARCH (price-accuracy gap, not a generic content flag)');

const warningMessage = describeWarning('variant-comps-unavailable', flaggedItem);
assertTrue(/3 matching listing/.test(warningMessage), `describeWarning names the specific count, not the raw slug (got: "${warningMessage}")`);
assertTrue(/generic/.test(warningMessage) || /Main Cover/.test(warningMessage), 'describeWarning explains the price reflects generic comps, not the specific variant');

const cleanItem = {
  title: 'harley quinn',
  issue: '62',
  year: 2019,
  publisher: 'DC Comics',
  price: 4.95,
  rawComps: { count: 5, average: 5.0 },
};
const cleanDecision = computeDecision(cleanItem);
assertEq(cleanDecision.warnings.includes('variant-comps-unavailable'), false, 'a clean item with no variantCompsExcludedByEra field does not get the warning');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
