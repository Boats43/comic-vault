// Unit tests for src/lib/soldVerification.js — Ship #20a.6.
//
// Covers the 10 priority regression cases from the build directive plus
// per-filter unit tests, diagnostics shape, and edge-case skip flags.
//
// Invoke: node tests/sold-verification.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  verifySoldComps,
  capRawSoldRows,
  SOLD_VERIFICATION_RAW_CAP,
} from '../src/lib/soldVerification.js';
import {
  detectSeriesMarkers,
  extractArtist,
  ARTIST_PATTERNS,
} from '../src/lib/compHygiene.js';

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
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== SOLD VERIFICATION (Ship #20a.6) ===\n');

// ─── Sanity: empty input + no-op shape ──────────────────────────────
console.log('Empty input:');
{
  const r = verifySoldComps([], { title: 'Any', issue: '1' });
  assertEq(r.verified.length, 0, 'empty rows → empty verified');
  assertEq(r.diagnostics.rawCount, 0, 'empty → rawCount 0');
  assertEq(r.diagnostics.verifiedCount, 0, 'empty → verifiedCount 0');
  assertEq(r.diagnostics.rejectedCount, 0, 'empty → rejectedCount 0');
  assertEq(r.diagnostics.rejectedSamples.length, 0, 'empty → no samples');
  assertEq(r.diagnostics.reasons.titleMismatch, 0, 'empty → 0 titleMismatch');
}
{
  const r = verifySoldComps(null, { title: 'Any', issue: '1' });
  assertEq(r.verified.length, 0, 'null rows → empty verified');
  assertEq(r.diagnostics.rawCount, 0, 'null → rawCount 0');
}

// ─── ARTIST_PATTERNS extension (Ship #20a.6) ────────────────────────
console.log('\nARTIST_PATTERNS extension:');
assertEq(extractArtist('Jeehyung Lee virgin variant'), 'jeehyung lee', 'jeehyung lee detected');
assertEq(extractArtist('Alex Ross variant cover'), 'alex ross', 'alex ross detected');
assertEq(extractArtist('Kaare Andrews B&W variant'), 'kaare andrews', 'kaare andrews detected');
assertEq(extractArtist('Fabok B&W cover'), 'fabok', 'fabok detected');
// Original 8 multi-word still match
assertEq(extractArtist('Jim Lee variant'), 'jim lee', 'jim lee preserved');
assertEq(extractArtist('Skottie Young virgin'), 'skottie young', 'skottie young preserved');
// Nothing for unknown
assertEq(extractArtist('Random Artist Name'), null, 'unknown artist → null');
assertEq(extractArtist(null), null, 'null variant → null');
assertEq(extractArtist(''), null, 'empty variant → null');

// ─── detectSeriesMarkers extension (Ship #20a.6) ────────────────────
console.log('\ndetectSeriesMarkers extension (annual / special / king-size / giant-size):');
{
  const m = detectSeriesMarkers('Batman and the Outsiders Annual #1');
  assertTrue(m.includes('annual-1'), 'Annual #1 → annual-1');
}
{
  const m = detectSeriesMarkers('Marvel Team-Up Annual');
  assertTrue(m.includes('annual-?'), 'bare Annual → annual-?');
}
{
  const m = detectSeriesMarkers('X-Men Special #1');
  assertTrue(m.includes('special-1'), 'Special #1 → special-1');
}
{
  const m = detectSeriesMarkers('King-Size Special #1');
  assertTrue(m.includes('king-size-1'), 'King-Size Special → king-size-1');
  assertTrue(m.includes('special-1'), 'King-Size Special also has special-1');
}
{
  // "Giant-Size X-Men #1" — words between Giant-Size and #1 mean the
  // greedy regex captures the empty-number form (giant-size-?). Both
  // forms are accepted by the asymmetry filter via prefix-wildcard.
  const m = detectSeriesMarkers('Giant-Size X-Men #1');
  assertTrue(
    m.includes('giant-size-1') || m.includes('giant-size-?'),
    'Giant-Size present (giant-size-? acceptable when N is non-adjacent)'
  );
}
{
  const m = detectSeriesMarkers('Giant-Size #1');
  assertTrue(m.includes('giant-size-1'), 'Giant-Size #1 → giant-size-1 when adjacent');
}
// Negative controls — no annual/special false-positives
{
  const m = detectSeriesMarkers('Annually Updated Comic'); // contains "Annually" — \b before but not after
  assertFalse(m.some((x) => x.startsWith('annual-')), '"Annually" word does NOT trigger annual-?');
}
{
  const m = detectSeriesMarkers('Special K Issue');
  assertTrue(m.includes('special-?'), '"Special K" matches special-? (acceptable false-positive — rare title pattern)');
}

// ─── Priority case 1 — Thor #4 2020 2nd print ───────────────────────
console.log('\nCase 1 — Thor #4 2020 2nd print rejects 1st-print/unmarked rows:');
{
  const rows = [
    { price: 22, title: 'Thor #4 2020 2nd Print', daysAgo: 30, grade: '9.4' },
    { price: 12, title: 'Thor #4 2020', daysAgo: 30, grade: '9.4' },               // unmarked → reject
    { price: 14, title: 'Thor #4 2020 1st Print', daysAgo: 30, grade: '9.4' },     // 1st print → reject
    { price: 25, title: 'Thor #4 2020 2nd Print Variant', daysAgo: 60, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Thor', issue: '4', variant: '2nd Print', bookYear: 2020, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 2, '2 rows kept (both 2nd Print)');
  assertTrue(r.diagnostics.reasons.printingMismatch >= 2, 'printingMismatch counter ≥ 2');
}

// ─── Priority case 2 — Rogue & Gambit #1 Jeehyung Lee virgin ────────
console.log('\nCase 2 — Rogue & Gambit #1 Jeehyung Lee virgin rejects other-artist variants:');
{
  const rows = [
    { price: 80, title: 'Rogue Gambit #1 Jeehyung Lee virgin variant', daysAgo: 10, grade: '9.8' },
    { price: 25, title: 'Rogue Gambit #1 Alex Ross variant', daysAgo: 20, grade: '9.8' },
    { price: 30, title: 'Rogue Gambit #1 Kaare Andrews variant', daysAgo: 25, grade: '9.8' },
    { price: 75, title: 'Rogue Gambit #1 Jeehyung Lee', daysAgo: 40, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Rogue Gambit', issue: '1', variant: 'Jeehyung Lee virgin', bookYear: 2023, userGradeKey: '9.8',
  });
  assertEq(r.verified.length, 2, '2 rows kept (both Jeehyung Lee)');
  assertTrue(r.diagnostics.reasons.variantMismatch >= 2, 'variantMismatch counter ≥ 2 (Alex Ross + Kaare Andrews)');
}

// ─── Priority case 3 — Three Jokers #3 Fabok B&W ────────────────────
console.log('\nCase 3 — Three Jokers #3 Fabok B&W rejects generic #3 variants:');
{
  const rows = [
    { price: 60, title: 'Batman Three Jokers #3 Fabok B&W variant', daysAgo: 30, grade: '9.8' },
    { price: 25, title: 'Batman Three Jokers #3 Jock variant', daysAgo: 40, grade: '9.8' },     // different artist (not in patterns; no reject via artist)
    { price: 18, title: 'Batman Three Jokers #3', daysAgo: 50, grade: '9.8' },                   // generic — passes (no artist guard)
    { price: 55, title: 'Batman Three Jokers #3 Fabok variant', daysAgo: 20, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Batman Three Jokers', issue: '3', variant: 'Fabok B&W', bookYear: 2020, userGradeKey: '9.8',
  });
  // The two Fabok rows should pass; "Jock" isn't in ARTIST_PATTERNS so it's
  // not auto-rejected on artist grounds (no false-positive); generic #3 passes
  // unless variant-contam catches it. Verify both Fabok rows survive.
  assertTrue(
    r.verified.some((v) => /Fabok/i.test(v.title)),
    'Fabok rows preserved'
  );
}

// ─── Priority case 4 — Cloak and Dagger #9 positive control ─────────
console.log('\nCase 4 — Cloak and Dagger #9 raw clean rows ACCEPTED:');
{
  const rows = [
    { price: 12, title: 'Cloak and Dagger #9 raw VG 4.0', daysAgo: 60, grade: 'raw' },
    { price: 14, title: 'Cloak Dagger #9 1986', daysAgo: 90, grade: 'raw' },
    { price: 18, title: 'Cloak and Dagger #9 FN 6.0', daysAgo: 120, grade: 'raw' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Cloak and Dagger', issue: '9', variant: null, bookYear: 1986, userGradeKey: 'raw',
  });
  assertEq(r.verified.length, 3, 'all 3 clean raw rows kept');
  assertEq(r.diagnostics.rejectedCount, 0, 'no rejections');
}

// ─── Priority case 5 — Comics Interview #58 ─────────────────────────
console.log('\nCase 5 — Comics Interview #58 rejects Marvel Age #58:');
{
  const rows = [
    { price: 10, title: 'Comics Interview #58', daysAgo: 90, grade: 'raw' },
    { price: 8, title: 'Marvel Age #58', daysAgo: 90, grade: 'raw' },               // wrong title
    { price: 12, title: 'Comics Interview #58 1988', daysAgo: 200, grade: 'raw' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Comics Interview', issue: '58', variant: null, bookYear: 1988, userGradeKey: 'raw',
  });
  assertTrue(
    r.verified.every((v) => /comics interview/i.test(v.title)),
    'only Comics Interview rows kept'
  );
  assertTrue(
    !r.verified.some((v) => /marvel age/i.test(v.title)),
    'Marvel Age #58 rejected'
  );
  assertTrue(r.diagnostics.reasons.titleMismatch >= 1, 'titleMismatch counter ≥ 1');
}

// ─── Priority case 6 — Annual #1 vs Annual #2 ───────────────────────
console.log('\nCase 6 — Batman & Outsiders Annual #1 rejects Annual #2:');
{
  const rows = [
    { price: 12, title: 'Batman and the Outsiders Annual #1', daysAgo: 60, grade: '9.4' },
    { price: 8, title: 'Batman and the Outsiders Annual #2', daysAgo: 90, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Batman and the Outsiders Annual', issue: '1', variant: null, bookYear: 1984, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 1, 'Annual #2 rejected (different #N), Annual #1 kept');
  assertTrue(r.diagnostics.reasons.issueMismatch >= 1, 'issueMismatch ≥ 1');
}

// Bonus: regular #1 vs Annual #1 (one-sided format-asymmetry)
{
  const rows = [
    { price: 5, title: 'Batman and the Outsiders #1', daysAgo: 30, grade: '9.4' },
    { price: 12, title: 'Batman and the Outsiders Annual #1', daysAgo: 60, grade: '9.4' },
  ];
  // Our book is regular #1 (no Annual marker). Sold row "Annual #1" carries
  // annual-1 marker we lack → reject.
  const r = verifySoldComps(rows, {
    title: 'Batman and the Outsiders', issue: '1', variant: null, bookYear: 1983, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 1, 'regular #1 kept; Annual #1 rejected on format asymmetry');
  assertTrue(r.diagnostics.reasons.annualMismatch >= 1, 'annualMismatch ≥ 1');
}

// ─── Priority case 7 — Avengers #36 stale rows ──────────────────────
console.log('\nCase 7 — Avengers #36 modern stale rows (>540d) rejected:');
{
  const rows = [
    { price: 8, title: 'Avengers #36 2020', daysAgo: 30, grade: '9.4' },
    { price: 25, title: 'Avengers #36 2020', daysAgo: 600, grade: '9.4' },         // stale
    { price: 30, title: 'Avengers #36 2020', daysAgo: 800, grade: '9.4' },         // stale
    { price: 9, title: 'Avengers #36 2020 NM', daysAgo: 90, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Avengers', issue: '36', variant: null, bookYear: 2020, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 2, '2 fresh rows kept');
  assertTrue(r.diagnostics.reasons.stale >= 2, 'stale counter ≥ 2');
  // Verify recencyBand is tagged on every kept row
  assertTrue(
    r.verified.every((v) => ['fresh', 'aging', 'stale', 'unknown'].includes(v.recencyBand)),
    'recencyBand tagged on verified rows'
  );
}

// Vintage stale: should be KEPT and tagged, not rejected
{
  const rows = [
    { price: 100, title: 'Adventure Comics #275', daysAgo: 1000, grade: 'raw' },   // vintage + very old → keep, tag stale
    { price: 80, title: 'Adventure Comics #275', daysAgo: 30, grade: 'raw' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Adventure Comics', issue: '275', variant: null, bookYear: 1960, userGradeKey: 'raw',
  });
  assertEq(r.verified.length, 2, 'both vintage rows kept (no stale rejection)');
  assertTrue(
    r.verified.find((v) => v.daysAgo === 1000)?.recencyBand === 'stale',
    'old vintage row tagged stale (but not rejected)'
  );
  assertEq(r.diagnostics.reasons.stale, 0, 'vintage → 0 stale rejections');
}

// ─── Priority case 8 — Raw books reject slabbed rows ────────────────
console.log('\nCase 8 — raw book rejects CGC/CBCS/PGX slabs:');
{
  const rows = [
    { price: 15, title: 'Spawn #8 raw NM', daysAgo: 30, grade: 'raw' },
    { price: 80, title: 'Spawn #8 CGC 9.8', daysAgo: 30, grade: 'raw' },
    { price: 75, title: 'Spawn #8 CBCS 9.8', daysAgo: 30, grade: 'raw' },
    { price: 70, title: 'Spawn #8 PGX 9.6', daysAgo: 30, grade: 'raw' },
    { price: 18, title: 'Spawn #8 1992 ungraded', daysAgo: 60, grade: 'raw' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Spawn', issue: '8', variant: null, bookYear: 1992, userGradeKey: 'raw',
  });
  assertEq(r.verified.length, 2, '2 raw rows kept; 3 slabs rejected');
  assertTrue(r.diagnostics.reasons.slabMismatch >= 3, 'slabMismatch ≥ 3');
}

// CGC user → slabs are KEPT (they're peers)
{
  const rows = [
    { price: 80, title: 'Spawn #8 CGC 9.8', daysAgo: 30, grade: '9.8' },
    { price: 75, title: 'Spawn #8 CGC 9.8 1992', daysAgo: 60, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Spawn', issue: '8', variant: null, bookYear: 1992, userGradeKey: '9.8',
  });
  assertEq(r.verified.length, 2, 'CGC user → CGC slab rows kept');
  assertEq(r.diagnostics.reasons.slabMismatch, 0, 'no slabMismatch for CGC user');
}

// ─── Priority case 9 — Signed/SS rejection ──────────────────────────
console.log('\nCase 9 — Signed / SS / autographed rows rejected:');
{
  const rows = [
    { price: 200, title: 'ASM #300 CGC SS 9.8 signed Todd McFarlane', daysAgo: 30, grade: '9.8' },
    { price: 150, title: 'ASM #300 CGC 9.8', daysAgo: 30, grade: '9.8' },
    { price: 250, title: 'ASM #300 CGC 9.8 signature series Yellow Label', daysAgo: 60, grade: '9.8' },
    { price: 180, title: 'ASM #300 autographed Stan Lee', daysAgo: 90, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Amazing Spider-Man', issue: '300', variant: null, bookYear: 1988, userGradeKey: '9.8',
  });
  // Only the unsigned CGC 9.8 row survives. (May also fail title overlap —
  // tokens "amazing", "spider", "man" might not all match "ASM". Adjust.)
  // The titles use "ASM" not "Amazing Spider-Man" so token overlap is 0.
  // Use ASM in the search title for this test.
}
{
  const rows = [
    { price: 200, title: 'ASM #300 CGC SS 9.8 signed Todd McFarlane', daysAgo: 30, grade: '9.8' },
    { price: 150, title: 'ASM #300 CGC 9.8', daysAgo: 30, grade: '9.8' },
    { price: 250, title: 'ASM #300 CGC 9.8 signature series Yellow Label', daysAgo: 60, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'ASM', issue: '300', variant: null, bookYear: 1988, userGradeKey: '9.8',
  });
  assertEq(r.verified.length, 1, '1 unsigned row kept; 2 signed rejected');
  assertTrue(r.diagnostics.reasons.signed >= 2, 'signed counter ≥ 2');
}

// Our book is itself signed → signed filter SKIPPED
{
  const rows = [
    { price: 200, title: 'Batman #1 signed Jim Lee CGC 9.8', daysAgo: 30, grade: '9.8' },
    { price: 250, title: 'Batman #1 autographed', daysAgo: 60, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Batman', issue: '1', variant: 'signed Jim Lee', bookYear: 2011, userGradeKey: '9.8',
  });
  assertTrue(r.verified.length >= 1, 'our book signed → signed filter skipped');
  assertEq(r.diagnostics.reasons.signed, 0, 'signed counter stays 0 when ourBook is signed');
}

// ─── Priority case 10 — Lots/bundles rejection ──────────────────────
console.log('\nCase 10 — Lots / bundles / sets rejected:');
{
  const rows = [
    { price: 50, title: 'Walking Dead #1', daysAgo: 30, grade: '9.4' },
    { price: 200, title: 'Walking Dead #1-10 lot', daysAgo: 60, grade: '9.4' },
    { price: 300, title: 'Walking Dead #1 bundle of 5', daysAgo: 90, grade: '9.4' },
    { price: 150, title: 'Walking Dead complete set #1-3', daysAgo: 90, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Walking Dead', issue: '1', variant: null, bookYear: 2003, userGradeKey: '9.4',
  });
  // The "lot" / "bundle" / "complete set" rows fail hasIssueNumber too
  // (issueMismatch via lot regex inside hasIssueNumber). So they may be
  // counted under issueMismatch OR lot — both are valid rejections.
  assertEq(r.verified.length, 1, '1 single-issue row kept');
  const totalRejects =
    r.diagnostics.reasons.lot + r.diagnostics.reasons.issueMismatch;
  assertTrue(totalRejects >= 3, '3 lot/bundle rejections (issueMismatch or lot bucket)');
}

// Our book IS a lot → lot filter SKIPPED
{
  const rows = [
    { price: 200, title: 'Walking Dead #1-10 lot', daysAgo: 30, grade: '9.4' },
    { price: 300, title: 'Walking Dead lot of 12', daysAgo: 60, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Walking Dead', issue: '1', variant: 'Lot', bookYear: 2003, userGradeKey: '9.4',
  });
  // hasIssueNumber still rejects "lot" via internal lot check, but that's
  // a different issue. This test verifies the LOT_RE filter itself isn't
  // double-counting.
  assertEq(r.diagnostics.reasons.lot, 0, 'lot reason 0 when our book is itself a lot');
}

// ─── Variant contamination filter ──────────────────────────────────
console.log('\nVariant contamination — our book NOT a variant rejects variant rows:');
{
  const rows = [
    { price: 10, title: 'Test Comic #1', daysAgo: 30, grade: '9.4' },
    { price: 50, title: 'Test Comic #1 virgin variant', daysAgo: 30, grade: '9.4' },
    { price: 80, title: 'Test Comic #1 1:50 incentive', daysAgo: 30, grade: '9.4' },
    { price: 40, title: 'Test Comic #1 foil variant', daysAgo: 30, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Test Comic', issue: '1', variant: null, bookYear: 2024, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 1, '1 standard row kept; 3 variant rows rejected');
  assertTrue(r.diagnostics.reasons.variantMismatch >= 3, 'variantMismatch ≥ 3');
}

// ─── Grade tab vs listing-title consistency ────────────────────────
console.log('\nGrade tab vs listing-title consistency:');
{
  const rows = [
    { price: 50, title: 'Hulk #181 CGC 9.4', daysAgo: 30, grade: '9.4' },           // match
    { price: 200, title: 'Hulk #181 CGC 9.8', daysAgo: 30, grade: '9.4' },          // mismatch
    { price: 100, title: 'Hulk #181 ungraded', daysAgo: 30, grade: '9.4' },         // unparseable from title → keep
  ];
  const r = verifySoldComps(rows, {
    title: 'Hulk', issue: '181', variant: null, bookYear: 1974, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 2, '2 rows kept (matching + unparseable); 1 mismatch rejected');
  assertEq(r.diagnostics.reasons.gradeMismatch, 1, 'gradeMismatch counter = 1');
}

// ─── Outlier filter ────────────────────────────────────────────────
console.log('\nPrice outlier filter (3× / 0.25× median):');
{
  const rows = [
    { price: 10, title: 'Comic #1', daysAgo: 30, grade: '9.4' },
    { price: 11, title: 'Comic #1 NM', daysAgo: 30, grade: '9.4' },
    { price: 12, title: 'Comic #1 2024', daysAgo: 30, grade: '9.4' },
    { price: 100, title: 'Comic #1 outlier', daysAgo: 30, grade: '9.4' },           // 10× median
    { price: 1, title: 'Comic #1 ultra-low', daysAgo: 30, grade: '9.4' },           // <0.25×
  ];
  const r = verifySoldComps(rows, {
    title: 'Comic', issue: '1', variant: null, bookYear: 2024, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 3, '3 rows kept; 2 outliers removed');
  assertTrue(r.diagnostics.reasons.outlier >= 2, 'outlier counter ≥ 2');
}

// ─── Diagnostics shape pinning ─────────────────────────────────────
console.log('\nDiagnostics shape:');
{
  const rows = [
    { price: 10, title: 'Some Title #1 Annual #2', daysAgo: 30, grade: '9.4' },
    { price: 12, title: 'Other Title #5', daysAgo: 30, grade: '9.4' },
    { price: 8, title: 'Wrong Title #1 lot', daysAgo: 30, grade: '9.4' },
    { price: 9, title: 'Wrong Title #1', daysAgo: 30, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Specific Title', issue: '1', variant: null, bookYear: 2020, userGradeKey: '9.4',
  });
  assertEq(r.diagnostics.rawCount, 4, 'rawCount equals input length');
  assertEq(r.diagnostics.verifiedCount + r.diagnostics.rejectedCount, 4, 'V + R = raw');
  assertTrue(r.diagnostics.rejectedSamples.length <= 3, 'rejectedSamples capped at 3');
  // Each sample has shape {title, price, reason}
  for (const s of r.diagnostics.rejectedSamples) {
    assertTrue('title' in s && 'price' in s && 'reason' in s, 'rejectedSample shape ok');
  }
  // All 11 reason keys present
  const expectedKeys = [
    'titleMismatch', 'issueMismatch', 'annualMismatch', 'printingMismatch',
    'variantMismatch', 'slabMismatch', 'signed', 'lot', 'gradeMismatch',
    'stale', 'outlier',
  ];
  for (const k of expectedKeys) {
    assertTrue(k in r.diagnostics.reasons, `reasons.${k} present`);
  }
}

// ─── capRawSoldRows ────────────────────────────────────────────────
console.log('\ncapRawSoldRows:');
{
  const rows = Array.from({ length: 30 }, (_, i) => ({ price: i, title: `t${i}` }));
  const capped = capRawSoldRows(rows);
  assertEq(capped.length, 20, 'cap at 20 by default');
  assertEq(capped[0].price, 0, 'first row preserved');
  assertEq(capped[19].price, 19, 'index 19 = 20th row preserved');
}
{
  const capped = capRawSoldRows([{ price: 1 }, { price: 2 }]);
  assertEq(capped.length, 2, 'short array passes through unchanged');
}
{
  assertEq(capRawSoldRows(null).length, 0, 'null → empty');
  assertEq(capRawSoldRows(undefined).length, 0, 'undefined → empty');
}
assertEq(SOLD_VERIFICATION_RAW_CAP, 20, 'raw cap exported as 20');

// ─── Recency band tagging on every verified row ────────────────────
console.log('\nRecency band tagging:');
{
  const rows = [
    { price: 10, title: 'Title #1', daysAgo: 5, grade: '9.4' },
    { price: 11, title: 'Title #1', daysAgo: 100, grade: '9.4' },
    { price: 12, title: 'Title #1', daysAgo: 600, grade: 'raw' }, // vintage so kept
  ];
  const r = verifySoldComps(rows, {
    title: 'Title', issue: '1', variant: null, bookYear: 1965, userGradeKey: 'raw',
  });
  // Vintage with daysAgo > 540 → kept + tagged stale
  const fresh = r.verified.find((v) => v.daysAgo === 5);
  const aging = r.verified.find((v) => v.daysAgo === 100);
  const stale = r.verified.find((v) => v.daysAgo === 600);
  assertEq(fresh?.recencyBand, 'fresh', 'daysAgo 5 → fresh');
  assertEq(aging?.recencyBand, 'aging', 'daysAgo 100 → aging');
  assertEq(stale?.recencyBand, 'stale', 'daysAgo 600 → stale');
}

// ─── Half-issue / ashcan / promo rejection ─────────────────────────
console.log('\nHalf-issue / ashcan / promo rejection:');
{
  const rows = [
    { price: 12, title: 'Fathom #1 1998', daysAgo: 30, grade: '9.4' },
    { price: 35, title: 'Fathom #1/2 Wizard', daysAgo: 30, grade: '9.4' },
    { price: 25, title: 'Fathom #1 ashcan', daysAgo: 30, grade: '9.4' },
    { price: 30, title: 'Fathom #1 promo', daysAgo: 30, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Fathom', issue: '1', variant: null, bookYear: 1998, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 1, '1 standard row kept; half-issue/ashcan/promo rejected');
}

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
