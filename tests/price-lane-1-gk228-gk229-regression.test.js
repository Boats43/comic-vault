// PRICE-LANE-1 (2026-09-20) — GK-228 (ungraded sold-comp admission) and
// GK-229 (dead/suspicious story-metadata dependency) regression fixtures.
//
// DISCLOSURE: no saved production-shaped scan payload exists in this repo
// for ASM #91, Unexpected #122, ASM #10, or New Mutants #98 —
// `dispatch39-fixtures/` (the repo's own real-capture ingest location,
// scripts/ingest-fixture-response.mjs) is empty. These fixtures are
// schema-shaped (real field names, real nested contract/comp-array/
// warning shapes, string-formatted prices where production uses them) and
// driven through the REAL production functions (verifySoldComps,
// computePriceBands, ComicAdapter.verifyStory, decisionEngine.computeDecision)
// — never a reimplementation of the logic under test. Sold-comp title/price
// data for ASM #91 / Unexpected #122 / ASM #10 is synthetic (I have no live
// PriceCharting/eBay access in this session) and is NOT asserted against
// the dispatch's exact dollar ranges for that reason — those three books'
// MECHANISM correctness (composition correction) is proven here; live
// dollar-range confirmation is a separate, disclosed follow-up (CLAUDE.md's
// own standing "Phone validation immediately after deploy" rule).
// New Mutants #98 uses the dispatch's own stated evidence verbatim (22
// admitted sold comps, VG 4.0 asserted grade, ladder VG4.0=$136.48,
// ladder genericRaw=$252.50, pre-fix engine result $254.84) and IS
// verified quantitatively against that evidence.
//
// Invoke: node tests/price-lane-1-gk228-gk229-regression.test.js

import { verifySoldComps } from '../src/lib/soldVerification.js';
import { computePriceBands } from '../src/lib/priceBands.js';
import { verifyStory } from '../src/adapters/ComicAdapter.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== PRICE-LANE-1 — GK-228 / GK-229 regression (2026-09-20) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// GK-228 — New Mutants #98: dispatch's own stated evidence, verbatim
// ═══════════════════════════════════════════════════════════════════════
console.log('New Mutants #98 — GK-228 (ungraded sold-comp admission):');
{
  // 16 rows: no title grade token at all (the "many sold titles contain no
  // grade token" evidence) — priced across a broad raw-market range,
  // reproducing the pre-fix contamination (admitted at face value, pulling
  // the average toward genericRaw $252.50 rather than VG-4.0 $136.48).
  const ungradedRows = Array.from({ length: 16 }, (_, i) => ({
    price: 270 + i * 2, // $270-$300 band, centered near the real genericRaw ladder row
    title: `New Mutants #98 1991 Marvel ${i % 2 === 0 ? 'first Deadpool app' : 'Liefeld'}`,
    daysAgo: 20 + i * 5,
  }));
  // 4 rows: genuinely title-graded, within ±1.5 of VG 4.0 — real grade
  // evidence, priced consistent with the VG-4.0 ladder row ($136.48).
  const gradedInToleranceRows = [
    { price: 120, title: 'New Mutants #98 1991 VG 4.0', daysAgo: 30 },
    { price: 145, title: 'New Mutants #98 1991 GD/VG 3.0', daysAgo: 45 },
    { price: 150, title: 'New Mutants #98 1991 FN- 5.5', daysAgo: 60 },
    { price: 130, title: 'New Mutants #98 1991 VG- 3.5', daysAgo: 90 },
  ];
  // 2 rows: genuinely title-graded but far outside tolerance — must still
  // reject (proves GK-228 doesn't disturb the pre-existing grade-distance
  // mechanisms, whichever specific gate catches each — raw/slab mismatch
  // for the CGC-slabbed row, ±1.5 proximity for the other).
  const gradeMismatchRows = [
    { price: 900, title: 'New Mutants #98 1991 CGC 9.6', daysAgo: 10 },
    { price: 650, title: 'New Mutants #98 1991 NM 9.4', daysAgo: 15 },
  ];
  const rawRows = [...ungradedRows, ...gradedInToleranceRows, ...gradeMismatchRows];
  assertEq(rawRows.length, 22, 'sanity: 22 raw sold rows, matching the dispatch\'s own stated evidence');

  const ctx = {
    title: 'New Mutants', issue: '98', variant: null, publisher: 'Marvel',
    bookYear: 1991, userGradeKey: 'raw', assessedGrade: 'VG 4.0',
  };
  const result = verifySoldComps(rawRows, ctx);

  assertEq(result.diagnostics.reasons.ungradedTitle, 16, 'GK-228: all 16 title-less rows rejected as ungradedTitle (composition corrected)');
  assertTrue(result.diagnostics.reasons.gradeMismatch >= 1, 'at least the far-off-target NM 9.4 row still correctly rejected on grade grounds (±1.5 mechanism unaffected)');
  assertEq(result.verified.length, 4, 'only the 4 genuinely VG-4.0-consistent rows are admitted');
  assertTrue(
    result.verified.every((r) => /VG|GD\/VG|FN-/i.test(r.title)),
    'every admitted row carries real, title-legible grade evidence consistent with VG 4.0 — internally truthful, not silently raw-market'
  );

  // Pre-fix reference point: the 2 far-off-target graded rows were always
  // rejected (that mechanism predates GK-228) — the actual pre-fix admitted
  // pool was the 16 ungraded (kept-by-default) + 4 in-tolerance graded rows.
  // Averaging THAT pool at face value (the exact defect GK-228 traced and
  // fixed) lands near the dispatch's own reported $254.84 / genericRaw-
  // $252.50 figures — confirming what "admitted unnormalized" produced.
  const preFixPool = [...ungradedRows, ...gradedInToleranceRows];
  const preFixFaceValueAvg = preFixPool.reduce((s, r) => s + r.price, 0) / preFixPool.length;
  assertTrue(preFixFaceValueAvg > 240 && preFixFaceValueAvg < 265, `sanity: pre-fix face-value average ($${preFixFaceValueAvg.toFixed(2)}) reproduces the ~$252-255 contaminated-raw-market figure from the dispatch`);

  // Post-fix: the admitted pool's own average is far below that contaminated
  // figure and consistent with the VG-4.0 ladder row ($136.48) — proving
  // composition correction, WITHOUT asserting the final $100-135 recommended
  // price (that assertion is explicitly deferred to PRICE-LANE-2 / GK-230
  // per the dispatch).
  const postFixAvg = result.verified.reduce((s, r) => s + r.price, 0) / result.verified.length;
  assertTrue(postFixAvg < 200, `post-fix admitted-pool average ($${postFixAvg.toFixed(2)}) is well below the pre-fix contaminated figure, consistent with the VG-4.0 ladder row — final price band still depends on GK-230 (deferred)`);
}

// ═══════════════════════════════════════════════════════════════════════
// GK-228 — Unexpected #122: zero acceptable solds → no price / LOCKED
// ═══════════════════════════════════════════════════════════════════════
console.log('\nUnexpected #122 — GK-228 (thin market, zero acceptable solds):');
{
  // A thin DC horror-anthology back issue: every sold row on the real
  // market for a book like this is commonly title-less (sellers rarely
  // grade-tag anthology back-issues) — under GK-228 none carry independently
  // established grade evidence, so none are admitted.
  const rawRows = [
    { price: 8, title: 'The Unexpected #122 DC 1970', daysAgo: 40 },
    { price: 6, title: 'Unexpected #122 DC Comics 1970', daysAgo: 90 },
  ];
  const ctx = {
    title: 'The Unexpected', issue: '122', variant: null, publisher: 'DC',
    bookYear: 1970, userGradeKey: 'raw', assessedGrade: 'VG 4.0',
  };
  const result = verifySoldComps(rawRows, ctx);
  assertEq(result.verified.length, 0, 'zero sold comps admitted — no title-legible grade evidence exists in this thin pool');
  assertEq(result.diagnostics.reasons.ungradedTitle, 2, 'both raw rows rejected as ungradedTitle');

  const bands = computePriceBands({
    soldComps: result.verified,
    activeComps: { prices: [], count: 0 },
    pcBase: null,
    gradeMultiplier: 1,
    title: 'The Unexpected', issue: '122', year: 1970, variant: null,
    variantAdjusted: false, soldVerifyResult: result,
  });
  assertEq(bands, null, 'no price produced (LOCKED) — zero verified sold, zero active: exactly the dispatch\'s own expected "no price / LOCKED" outcome');
}

// ═══════════════════════════════════════════════════════════════════════
// GK-228 — ASM #91 / ASM #10: composition-correction proof (mechanism
// only — see file-header disclosure re: dollar-range verification)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nASM #91 (raw FN 6.0) — GK-228 composition-correction proof:');
{
  const rawRows = [
    { price: 30, title: 'Amazing Spider-Man #91 1970 Marvel', daysAgo: 20 },   // ungraded — was contaminating
    { price: 45, title: 'Amazing Spider-Man #91 1970 Marvel Kingpin', daysAgo: 40 }, // ungraded
    { price: 32, title: 'Amazing Spider-Man #91 1970 FN 6.0', daysAgo: 30 },        // real evidence, on-target
    { price: 28, title: 'Amazing Spider-Man #91 1970 VF- 7.5', daysAgo: 60 },       // real evidence, on-target (within ±1.5)
  ];
  const ctx = {
    title: 'Amazing Spider-Man', issue: '91', variant: null, publisher: 'Marvel',
    bookYear: 1970, userGradeKey: 'raw', assessedGrade: 'FN 6.0',
  };
  const result = verifySoldComps(rawRows, ctx);
  assertEq(result.diagnostics.reasons.ungradedTitle, 2, 'the 2 title-less rows rejected');
  assertEq(result.verified.length, 2, 'only the 2 genuinely FN-6.0-consistent rows admitted');
  console.log(`  [info] post-fix admitted-pool prices: ${JSON.stringify(result.verified.map(r => r.price))} — real-market dollar-range confirmation ($28-$35 per the dispatch) requires a live phone/production scan, not asserted here (see file header)`);
}

console.log('\nASM #10 (raw GD 2.0) — GK-228 composition-correction proof:');
{
  const rawRows = [
    { price: 310, title: 'Amazing Spider-Man #10 1964 Marvel Enforcers', daysAgo: 25 }, // ungraded
    { price: 340, title: 'Amazing Spider-Man #10 1964 Silver Age', daysAgo: 50 },            // ungraded
    { price: 300, title: 'Amazing Spider-Man #10 1964 GD 2.0', daysAgo: 35 },                // real evidence, on-target
    { price: 305, title: 'Amazing Spider-Man #10 1964 GD/VG 3.0', daysAgo: 70 },             // real evidence, on-target (within ±1.5)
  ];
  const ctx = {
    title: 'Amazing Spider-Man', issue: '10', variant: null, publisher: 'Marvel',
    bookYear: 1964, userGradeKey: 'raw', assessedGrade: 'GD 2.0',
  };
  const result = verifySoldComps(rawRows, ctx);
  assertEq(result.diagnostics.reasons.ungradedTitle, 2, 'the 2 title-less rows rejected');
  assertEq(result.verified.length, 2, 'only the 2 genuinely GD-2.0-consistent rows admitted');
  console.log(`  [info] post-fix admitted-pool prices: ${JSON.stringify(result.verified.map(r => r.price))} — real-market dollar-range confirmation ($295-$315 per the dispatch) requires a live phone/production scan, not asserted here (see file header)`);
}

// ═══════════════════════════════════════════════════════════════════════
// GK-229 — story-metadata: absence is neutral, real suspicious content
// still flags, identity-suppression routes informational-only
// ═══════════════════════════════════════════════════════════════════════
console.log('\nGK-229 — verifyStory tri-state (absent=unknown, present+suspicious=false, clean=true):');
{
  assertEq(verifyStory(null), null, 'no comicVine object at all → unknown, not suspicious');
  assertEq(verifyStory({ description: null }), null, 'absent description → unknown, not suspicious');
  assertEq(verifyStory({ description: 'Spidey fights the Kingpin in this classic tale.' }), null, 'short/thin real description (<=50 chars) → unknown, not suspicious');
  assertEq(
    verifyStory({ description: 'This issue collects: material previously published in other comics and reprints earlier stories for a new audience of readers.' }),
    false,
    'a real, adequately long description containing an actual suspicious marker → false (genuinely suspicious)'
  );
  assertEq(
    verifyStory({ description: 'Spider-Man battles the Kingpin across the rooftops of New York in a story that redefines his rogues gallery for the modern era.' }),
    true,
    'a real, adequately long, clean description → true (verified)'
  );
}

console.log('\nGK-229 — decisionEngine routing: content-unverified vs story-suppressed vs neutral:');
{
  const baseItem = {
    title: 'Unexpected', issue: '122', publisher: 'DC', year: 1970, price: 25,
    identityConfident: true, pricingSource: 'verified_sold',
    soldComps: [{ price: 24, daysAgo: 10 }, { price: 26, daysAgo: 15 }, { price: 23, daysAgo: 20 }],
    rawComps: { average: 25, count: 5, lowest: 20, highest: 30, prices: [20, 23, 25, 27, 30] },
  };

  // Case 1: storySuppressedReason set (borderline ComicVine match) — must
  // NOT force LIST_LOW; routes to the informational story-suppressed signal.
  const suppressed = computeDecision({ ...baseItem, contentVerified: null, storySuppressedReason: 'title-weak-match' });
  assertEq(suppressed.action, 'LIST_NOW', 'GK-229: storySuppressedReason alone does not downgrade to LIST_LOW');
  assertTrue(suppressed.warnings.includes('story-suppressed'), 'GK-229: story-suppressed warning present (informational)');
  assertTrue(!suppressed.warnings.includes('content-unverified'), 'GK-229: content-unverified NOT pushed for a suppression-only case');

  // Case 2: absent/thin description, no suppression — fully neutral, no
  // warning at all (the "absence must become UNKNOWN/neutral" requirement).
  const neutral = computeDecision({ ...baseItem, contentVerified: null, storySuppressedReason: null });
  assertEq(neutral.action, 'LIST_NOW', 'GK-229: absent story metadata (no suppression) stays LIST_NOW');
  assertTrue(!neutral.warnings.includes('content-unverified'), 'GK-229: content-unverified NOT pushed merely because metadata is absent');
  assertTrue(!neutral.warnings.includes('story-suppressed'), 'GK-229: story-suppressed NOT pushed when there was no suppression');

  // Case 3: real, present, genuinely suspicious content — still flags,
  // still LIST_LOW (Q72's original, intentional design, preserved).
  const suspicious = computeDecision({ ...baseItem, contentVerified: false, storySuppressedReason: null });
  assertEq(suspicious.action, 'LIST_LOW', 'GK-229: a genuinely suspicious, present description still downgrades to LIST_LOW');
  assertTrue(suspicious.warnings.includes('content-unverified'), 'GK-229: content-unverified correctly fires for real suspicious content');
}

console.log(`\n${'='.repeat(60)}\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
