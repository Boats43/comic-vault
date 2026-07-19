// tests/q115-variant-issue-filter.test.js
//
// Q115 dispatch (2026-07-18) — Batman #608 pool-contamination class: an
// eBay reverse-image-search pool can be near-100% visually-similar-but-
// unrelated (0/20 items were actually issue #608, per direct production
// log reconstruction — a mix of Superman/Batman #657, Absolute Batman #19,
// Detective Comics #1000, Batman #1 reprints, even unrelated Marvel
// listings, sharing only eBay's own visual-similarity confusion around
// cover artist Dell'Otto's painted style across his many DIFFERENT DC
// variant covers). extractConfirmedVariant's artist-consensus gate
// (variantIdentity.js) correctly scored "Dell'Otto" as a MINORITY (4/20 =
// 20%, under the 70% distinguishing-ratio threshold) — exactly the signal
// shape it treats as a genuine distinguishing variant subset when the pool
// IS the same book. With no issue-level check, it backfilled
// confirmedVariant="exclusive Dell'Otto limited" and overrode
// confirmedYear 2002 -> 1940 from books that were never Batman #608 at all.
//
// Fix: filterItemsByIssue (src/lib/variantIdentity.js) — filter the pool to
// items whose OWN extracted issue matches our confirmed issue BEFORE
// extractConfirmedVariant ever sees them. Root-mechanism fix (bad input
// never reaches the computation), not a downstream flag.
//
// Confirmed via direct Vercel production log reconstruction (not
// hypothetical) — build f705054, pre-fix. Real 20-item pool, real issue
// extraction values.
//
// Invoke: node tests/q115-variant-issue-filter.test.js

import { extractConfirmedVariant, filterItemsByIssue } from '../src/lib/variantIdentity.js';

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
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q115 — VARIANT/YEAR BACKFILL ISSUE-LEVEL FILTER (Batman #608 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE A — Batman #608: the real 20-item production pool, reconstructed
// from the actual Vercel runtime log (`.issue` values match the log's own
// "[visual] extracted issues: [...]" line exactly — 15 non-null, 5 null,
// zero of them "608").
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture A: Batman #608 — real 20-item contaminated pool');

const batman608Pool = [
  { rawTitle: "9.4 NM SUPERMAN # 656 BATMAN # 657 FRENCH EURO VARIANT DELL OTTO JOKER 2006 WP", issue: '656', year: '2006' },
  { rawTitle: "9.4 NM SUPERMAN # 656 BATMAN # 657 FRENCH EURO VARIANT DELL OTTO JOKER 2006 WP", issue: '656', year: '2006' },
  { rawTitle: "Batman #1 (1940 reprint) Superman / Batman #7 Dell'Otto Custom Foil Joker NM", issue: '1', year: '1940' },
  { rawTitle: "Batman 1 Exclusive 9.8", issue: null, year: null },
  { rawTitle: "9.8 MT BATMAN ONE SHOTS GERMAN HC EURO VARIANT DELL OTTO 2006 NOT 656 657 JOKER", issue: null, year: '2006' },
  { rawTitle: "Batman #1 (1940 reprint) Superman / Batman #7 Dell'Otto Foil Variant NM+", issue: '1', year: '1940' },
  { rawTitle: "Venomverse Reborn #4 1:100 Derrick Chew Variant Marvel 2024 As Is", issue: '4', year: '2024' },
  { rawTitle: "SUPERMAN & BATMAN #7 ORIGINAL VIRGIN VARIANT FRENCH ED. DELL'OTTO EGC 9.7 Bu76", issue: '7', year: null },
  { rawTitle: "Batman And Robin #25 Cover F Gabriele Dell Otto Gotham Card Stock Variant", issue: '25', year: null },
  { rawTitle: "ABSOLUTE BATMAN #19 GERALD PAREL EXCLUSIVE VIRGIN VARIANT ltd 800", issue: '19', year: null },
  { rawTitle: "BATMAN No. 1 Special Edition Reprint 1st Batman Facsimile. Chrome Cover Fan expo", issue: null, year: null },
  { rawTitle: "Absolute Batman #19 Gerald Parel Virgin Variant LTD 800 DC Comics RTS", issue: '19', year: null },
  { rawTitle: "BATMAN #122 CVR B GABRIELE DELL OTTO CARD STOCK VAR (SHADOW WAR) DC COMICS", issue: '122', year: null },
  { rawTitle: "VENOMVERSE REBORN #4 (1:100 )Virgin Variant, cover by Derrick Chew. F/VF", issue: '4', year: '2024' },
  { rawTitle: "Absolute Batman #19 Gerald Parel Virgin Variant LTD 800 DC Comics 26", issue: '19', year: null },
  { rawTitle: "DC BATMAN 153 MARCO MASTRAZZO 1:25 RATIO VARIANT NEW 2024", issue: null, year: '2024' },
  { rawTitle: "DETECTIVE COMICS 1000 GABRIELLE DELL OTTO BATS VIRGIN VARIANT NM BATMAN", issue: null, year: null },
  { rawTitle: "Batman #154C (3RD SERIES) DC Comics 2025 NM-  Dell Otto Variant", issue: '154', year: '2025' },
  { rawTitle: "Batman #1 Foil Reprint CGC 9.8 Gabriele Dell'Otto Variant C Batman/Superman 7", issue: '1', year: null },
  { rawTitle: "VENOMVERSE REBORN #4 Derrick Chew 1:100 Virgin Variant NM", issue: '4', year: '2024' },
];

assertEq(batman608Pool.length, 20, 'pool has all 20 real production items');
assertEq(batman608Pool.filter((i) => i.issue != null).length, 15, 'matches log line exactly: "extracted 15 issues from 20 items"');

// Sanity: confirm the pre-fix bug reproduces on the UNFILTERED pool —
// artist consensus fires on "Dell'Otto" and backfills the wrong variant +
// year, exactly as the real production response did.
const preFixResult = extractConfirmedVariant(batman608Pool, null, 2002, 'high');
assertTrue(!!preFixResult, 'PRE-FIX (unfiltered pool): backfill fires — reproduces the real bug');
assertTrue(
  (preFixResult?.confirmedVariant || '').toLowerCase().includes("dell'otto"),
  `PRE-FIX: confirmedVariant wrongly includes "Dell'Otto" (got "${preFixResult?.confirmedVariant}")`
);

// THE FIX — filter to issue #608 first. 0/20 items are genuinely #608.
const filtered = filterItemsByIssue(batman608Pool, '608');
assertEq(filtered.length, 0, 'filterItemsByIssue: 0/20 items match issue 608 (pool is 100% contaminated)');

const postFixResult = extractConfirmedVariant(filtered, null, 2002, 'high');
assertNull(postFixResult, 'POST-FIX: extractConfirmedVariant returns null on the filtered (empty) pool — no backfill');

// Confirms the practical effect at the call site: confirmedVariant stays
// null (Vision's own — there was none to backfill) and confirmedYear is
// never touched by this mechanism, so it stays at whatever resolveYear
// already correctly produced (2002 in the real case).
{
  let confirmedVariant = null; // req.body.variant was null in the real request
  let confirmedYear = 2002; // resolveYear already correctly resolved this
  const variantCheck = extractConfirmedVariant(filtered, confirmedVariant, confirmedYear, 'high');
  if (variantCheck) {
    confirmedVariant = variantCheck.confirmedVariant;
    if (variantCheck.variantYear) confirmedYear = variantCheck.variantYear;
  }
  assertNull(confirmedVariant, 'confirmedVariant stays null (no false "exclusive Dell\'Otto limited")');
  assertEq(confirmedYear, 2002, 'confirmedYear stays 2002 — never overridden to 1940');
}

// String vs numeric confirmedIssue must behave identically (enrich.js may
// pass either depending on the identity-resolution path taken).
assertEq(filterItemsByIssue(batman608Pool, 608).length, 0, 'numeric confirmedIssue (608) behaves the same as string');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE B — the facsimile/genuine-variant case this feature was
// originally built for (Captain America #25 / Skottie Young, same
// fixture shape already covered by tests/variantIdentity.test.js Test 12)
// — MUST still work correctly after the issue-level filter. Every item
// genuinely IS issue #25, so filterItemsByIssue must not remove anything.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture B: Captain America #25 / Skottie Young — same-issue variant, unaffected by the filter');

const capAmerica25Pool = [
  { rawTitle: 'Captain America #25 Skottie Young Variant CGC 9.8', title: 'Captain America', issue: '25', year: '2019', variantTokens: [] },
  { rawTitle: 'CAPTAIN AMERICA #25 SKOTTIE YOUNG VARIANT COVER', title: 'Captain America', issue: '25', year: '2019', variantTokens: [] },
];

const capFiltered = filterItemsByIssue(capAmerica25Pool, '25');
assertEq(capFiltered.length, 2, 'filterItemsByIssue: both genuine same-issue listings survive (0 removed)');

const capResult = extractConfirmedVariant(capFiltered, null, 2019, 'high');
assertTrue(!!capResult, 'facsimile/variant backfill still fires after issue-filtering');
assertTrue(
  (capResult?.confirmedVariant || '').toLowerCase().includes('skottie young'),
  `confirmed variant still correctly contains "skottie young" (got "${capResult?.confirmedVariant}")`
);
assertEq(capResult?.source, 'ebay_image_consensus_backfill', 'source is still ebay_image_consensus_backfill');

// Numeric confirmedIssue variant of the same case.
assertEq(filterItemsByIssue(capAmerica25Pool, 25).length, 2, 'numeric confirmedIssue (25) also keeps both genuine listings');

// Mixed-issue pool: a genuine same-issue variant subset MIXED with
// unrelated-issue noise must isolate correctly — the noise is dropped, the
// genuine variant signal survives.
console.log('\nFixture B2: same-issue variant signal survives when mixed with unrelated-issue noise');
const mixedPool = [
  ...capAmerica25Pool,
  { rawTitle: 'Captain America #26 Regular Cover CGC 9.6', title: 'Captain America', issue: '26', year: '2019', variantTokens: [] },
  { rawTitle: 'Amazing Spider-Man #300 Todd McFarlane CGC 9.8', title: 'Amazing Spider-Man', issue: '300', year: '1988', variantTokens: [] },
];
const mixedFiltered = filterItemsByIssue(mixedPool, '25');
assertEq(mixedFiltered.length, 2, 'mixed pool: only the 2 genuine #25 listings survive, unrelated #26/#300 noise dropped');
const mixedResult = extractConfirmedVariant(mixedFiltered, null, 2019, 'high');
assertTrue(
  (mixedResult?.confirmedVariant || '').toLowerCase().includes('skottie young'),
  'genuine variant signal correctly extracted from the isolated same-issue subset'
);

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE C — pool too sparse/noisy to safely extract ANY signal even
// after issue-filtering (exactly 1 matching item, or 0 matching items) —
// must gracefully fall through to "no backfill," never crash or default
// to something else.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture C: sparse/empty post-filter pool — graceful no-crash fallthrough');

// C1: zero items match our issue at all (same as Fixture A, re-asserted
// standalone for clarity).
{
  const empty = filterItemsByIssue([{ rawTitle: 'Unrelated Book #999', issue: '999' }], '608');
  assertEq(empty.length, 0, 'C1: 0 items match — filtered array is empty');
  let threw = false;
  let result;
  try {
    result = extractConfirmedVariant(empty, null, 2002, 'high');
  } catch (e) {
    threw = true;
  }
  assertTrue(!threw, 'C1: extractConfirmedVariant does not throw on an empty array');
  assertNull(result, 'C1: returns null (Gate 1 — no items)');
}

// C2: exactly 1 item matches our issue — real signal exists but below the
// >=2-agree consensus threshold everywhere in extractConfirmedVariant.
{
  const single = filterItemsByIssue(
    [
      { rawTitle: 'Batman #608 Dell\'Otto Exclusive Variant NM', issue: '608', year: '2002' },
      { rawTitle: 'Batman #607 Unrelated Cover NM', issue: '607', year: '2002' },
    ],
    '608'
  );
  assertEq(single.length, 1, 'C2: exactly 1 item matches issue 608');
  let threw = false;
  let result;
  try {
    result = extractConfirmedVariant(single, null, 2002, 'high');
  } catch (e) {
    threw = true;
  }
  assertTrue(!threw, 'C2: extractConfirmedVariant does not throw on a single-item array');
  assertNull(result, 'C2: single item is insufficient for consensus — returns null, no backfill, no crash');
}

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
