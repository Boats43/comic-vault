// Unit tests for Ship #13 — comp-pool hygiene. Addresses 6 bugs surfaced
// via 41-book phone validation + Biker Mice #1 scan:
//
//   Bug 1 — Multi-issue compound listings (hasMultipleDistinctIssues)
//   Bug 2 — Sequel/volume marker asymmetry (detectSeriesMarkers)
//   Bug 3 — Signed/autographed/SS exclusion (SIGNED_RE)
//   Bug 4 — Composition-aware variant mult damping (VARIANT_CONTAM_RE export)
//   Bug 5 — #11 word-boundary regression pins (hasIssueNumber)
//   Bug 6 — Thin-comp-pool anchor (enrich-level, integration-tested in era file)
//
// Invoke: node tests/comp-filter-hygiene.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  hasIssueNumber,
  hasMultipleDistinctIssues,
  detectSeriesMarkers,
  SIGNED_RE,
  VARIANT_CONTAM_RE,
} from '../api/comps.js';
import { computeThinPoolAnchor } from '../api/enrich.js';

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

// ─── Bug 1 — Multi-issue compound detection ────────────────────────
console.log('\n── Bug 1 — hasMultipleDistinctIssues ──');

assertFalse(
  hasMultipleDistinctIssues('Absolute Batman #1 Cover A'),
  'single #1 → not multi-issue'
);
assertFalse(
  hasMultipleDistinctIssues('Amazing Spider-Man #300 CGC 9.8'),
  'single #300 → not multi-issue'
);
assertTrue(
  hasMultipleDistinctIssues('Absolute Batman #4 + #1 variant set'),
  '#4 + #1 → multi-issue'
);
assertTrue(
  hasMultipleDistinctIssues('Batman #1 & #4 bundle'),
  '#1 & #4 → multi-issue'
);
assertTrue(
  hasMultipleDistinctIssues('Spider-Man #1 #2 #3 run'),
  '#1 #2 #3 → multi-issue'
);
assertFalse(
  hasMultipleDistinctIssues('Absolute Batman #1 (2024) Scott Snyder'),
  'year 2024 has no # — not multi-issue'
);
assertFalse(
  hasMultipleDistinctIssues('Sensation Comics #1 CGC 9.0'),
  'single #1 + grade → not multi-issue'
);
assertFalse(
  hasMultipleDistinctIssues(''),
  'empty title → not multi-issue'
);
assertFalse(
  hasMultipleDistinctIssues(null),
  'null title → not multi-issue'
);

console.log('\n── Bug 1 — hasIssueNumber multi-issue integration ──');

assertTrue(
  hasIssueNumber('Absolute Batman #1 Cover A', '1'),
  'single #1 listing → accept'
);
assertFalse(
  hasIssueNumber('Absolute Batman #4 + #1 variant', '1'),
  '#4 + #1 compound → reject'
);
assertFalse(
  hasIssueNumber('Absolute Batman #1 & #4 bundle', '1'),
  '#1 & #4 compound → reject'
);
assertFalse(
  hasIssueNumber('Spider-Man #1 #2 #3 set', '1'),
  'multi-issue run → reject'
);
assertTrue(
  hasIssueNumber('Batman #1 first print NM 2024', '1'),
  'single #1 with year only → accept'
);

// ─── Bug 2 — Sequel/volume marker detection ────────────────────────
console.log('\n── Bug 2 — detectSeriesMarkers ──');

const noMarkers = detectSeriesMarkers('Last Ronin #4');
assertEq(noMarkers.length, 0, 'Last Ronin #4 → no markers');

const withII = detectSeriesMarkers('Last Ronin II Re-Evolution #4');
assertTrue(withII.includes('roman-ii'), 'Last Ronin II → roman-ii detected');
assertTrue(withII.includes('re-evolution'), 'Re-Evolution → re-evolution detected');

const withIII = detectSeriesMarkers('Crisis III Infinite Earths');
assertTrue(withIII.includes('roman-iii'), 'Crisis III → roman-iii detected');

const withIV = detectSeriesMarkers('X-Men IV');
assertTrue(withIV.includes('roman-iv'), 'X-Men IV → roman-iv detected');

const withX = detectSeriesMarkers('Comic X Anniversary');
assertTrue(withX.includes('roman-x'), 'X → roman-x detected');

const withVol = detectSeriesMarkers('Wolverine Vol 2 #1');
assertTrue(withVol.includes('vol-2'), 'Vol 2 → vol-2 detected');

const withVolume = detectSeriesMarkers('Amazing Spider-Man Volume 5 #15');
assertTrue(withVolume.includes('vol-5'), 'Volume 5 → vol-5 detected');

const withPart = detectSeriesMarkers('Infinity Gauntlet Part 3');
assertTrue(withPart.includes('part-3'), 'Part 3 → part-3 detected');

const withBook = detectSeriesMarkers('Sandman Book 1');
assertTrue(withBook.includes('book-1'), 'Book 1 → book-1 detected');

// Word-boundary guards — common false-positive risks
const missile = detectSeriesMarkers('Missile Command');
assertEq(missile.length, 0, '"Missile" → no marker (II inside MISSILE)');

const roman = detectSeriesMarkers('Rom Vii Spaceknight');
// "Rom Vii" is an oddball - Vii isn't a valid Roman (but title-case VII is). Not a real comic.
// Legitimate check: random "viii" anywhere should match.
const viiSample = detectSeriesMarkers('Some VIII Edition');
assertTrue(viiSample.includes('roman-viii'), 'VIII detected');

// Re-/Pre- prefix requires capitalized word (avoids "re-read")
const recap = detectSeriesMarkers('comic re-read copy');
assertEq(recap.length, 0, 'lowercase re-read → no re-* marker');
const prebirth = detectSeriesMarkers('Pre-Birth Saga #1');
assertTrue(prebirth.includes('pre-birth'), 'Pre-Birth → pre-birth detected');

// Symmetric same-markers → no asymmetry implied
const vol2ours = detectSeriesMarkers('Wolverine Vol 2');
const vol2theirs = detectSeriesMarkers('Wolverine Vol 2 #1 CGC 9.8');
assertTrue(
  vol2theirs.every((m) => vol2ours.includes(m)),
  'Vol 2 ↔ Vol 2 symmetric (no extra markers)'
);

// Asymmetric different volumes
const vol1ours = detectSeriesMarkers('Wolverine');
const vol5theirs = detectSeriesMarkers('Wolverine Vol 5 #1');
assertTrue(
  vol5theirs.some((m) => !vol1ours.includes(m)),
  'Vol 5 listing has marker Vol 1 search lacks'
);

// TMNT Last Ronin ↔ Last Ronin II: confirmed production miss
const tmntOurs = detectSeriesMarkers('TMNT Last Ronin');
const tmntII = detectSeriesMarkers('Last Ronin II Re-Evolution #4');
assertTrue(
  tmntII.some((m) => !tmntOurs.includes(m)),
  'Last Ronin II has markers Last Ronin I search lacks'
);

// ─── Bug 3 — Signed / autographed / SS exclusion ───────────────────
console.log('\n── Bug 3 — SIGNED_RE ──');

assertTrue(
  SIGNED_RE.test('US of Cap #1 2X signed Ed McGuinness'),
  'bare "signed" → matches');
assertTrue(
  SIGNED_RE.test('ASM #300 signed by Todd McFarlane'),
  '"signed by" → matches');
assertTrue(
  SIGNED_RE.test('Batman #1 autographed Jim Lee'),
  '"autographed" → matches');
assertTrue(
  SIGNED_RE.test('Spider-Man #1 CGC Signature Series 9.8'),
  '"Signature Series" → matches');
assertTrue(
  SIGNED_RE.test('Hulk #1 CGC SS 9.8 signature series'),
  'signature series → matches');
assertTrue(
  SIGNED_RE.test('X-Men #1 CGC Yellow Label 9.8'),
  'yellow label → matches');
assertTrue(
  SIGNED_RE.test('Iron Man #1 Green Label 9.6'),
  'green label → matches');
assertTrue(
  SIGNED_RE.test('Wolverine #1 remarked original art'),
  'remarked → matches');

// Q3: bare SS should NOT match (too ambiguous)
assertFalse(
  SIGNED_RE.test('SS Squadron comic'),
  'bare "SS" → does NOT match (too many false positives)'
);
assertFalse(
  SIGNED_RE.test('Steel & Soul #1'),
  '"Steel & Soul" → does NOT match bare SS'
);

// Blue label intentionally NOT matched (blue = Universal / standard)
assertFalse(
  SIGNED_RE.test('ASM #300 CGC Blue Label 9.8'),
  'blue label → does NOT match (standard, not signed)');

// Non-signed listings pass through
assertFalse(
  SIGNED_RE.test('Batman #1 CGC 9.8'),
  'bare CGC listing → does NOT match');
assertFalse(
  SIGNED_RE.test('Amazing Spider-Man #300 NM 9.4'),
  'raw NM listing → does NOT match');
assertFalse(
  SIGNED_RE.test('Hulk #181 Marvel 1974'),
  'vintage listing → does NOT match');

// ─── Bug 4 — VARIANT_CONTAM_RE export available for composition ────
console.log('\n── Bug 4 — VARIANT_CONTAM_RE export ──');

assertTrue(
  VARIANT_CONTAM_RE instanceof RegExp,
  'VARIANT_CONTAM_RE exported as RegExp');
assertTrue(
  VARIANT_CONTAM_RE.test('Daredevil #600 Alex Ross Variant'),
  'variant listing matches');
assertTrue(
  VARIANT_CONTAM_RE.test('ASM #50 Virgin 1:100 ratio'),
  'virgin/ratio matches');
assertTrue(
  VARIANT_CONTAM_RE.test('X-Men #1 foil edition'),
  'foil matches');
assertTrue(
  VARIANT_CONTAM_RE.test('Batman #1 Newsstand'),
  'newsstand matches');
assertFalse(
  VARIANT_CONTAM_RE.test('Amazing Spider-Man #300 1st print'),
  'standard listing → no match');

// Composition ratio simulation
const mixedPool = [
  'Daredevil #600 Alex Ross Variant',
  'Daredevil #600 Skan Virgin',
  'Daredevil #600 regular Cover A',
  'Daredevil #600 Inhyuk Lee Variant',
  'Daredevil #600 Newsstand',
];
const variantHits = mixedPool.filter((t) => VARIANT_CONTAM_RE.test(t)).length;
assertEq(variantHits, 4, 'mixed pool: 4/5 variants identified');
const mixedRatio = variantHits / mixedPool.length;
assertTrue(mixedRatio > 0.50, 'mixed pool ratio >50% → 0.75 damping tier');
assertFalse(mixedRatio > 0.80, 'mixed pool ratio NOT >80%');

const allVariant = [
  'Daredevil #600 Alex Ross Variant',
  'Daredevil #600 Skan Virgin',
  'Daredevil #600 Artgerm Variant',
  'Daredevil #600 ratio 1:25 incentive',
  'Daredevil #600 Inhyuk Lee Foil',
];
const allHits = allVariant.filter((t) => VARIANT_CONTAM_RE.test(t)).length;
assertEq(allHits, 5, 'all-variant pool: 5/5 match');
assertTrue(allHits / allVariant.length > 0.80, 'all-variant ratio >80% → 0.5 damping');

const mostStandard = [
  'ASM #300 1st print NM',
  'ASM #300 CGC 9.8 Todd McFarlane',
  'ASM #300 raw NM/MT 9.8',
  'ASM #300 Variant cover A',
  'ASM #300 NM',
];
const stdHits = mostStandard.filter((t) => VARIANT_CONTAM_RE.test(t)).length;
assertEq(stdHits, 1, 'standard pool: 1/5 variant');
assertFalse(stdHits / mostStandard.length > 0.50, 'standard ratio <50% → full mult');

// ─── Bug 5 — hasIssueNumber word-boundary regression pins ──────────
console.log('\n── Bug 5 — #N word-boundary regression ──');

assertFalse(
  hasIssueNumber('Sensation Comics #11 CGC 8.0', '1'),
  'Sensation #11 does NOT match #1 search');
assertFalse(
  hasIssueNumber('Book #10 CGC 9.0', '1'),
  '#10 does NOT match #1 search');
assertFalse(
  hasIssueNumber('Title #100 CGC 9.8', '1'),
  '#100 does NOT match #1 search');
assertFalse(
  hasIssueNumber('Batman #12 NM', '1'),
  '#12 does NOT match #1 search');
assertTrue(
  hasIssueNumber('Batman #1 NM', '1'),
  '#1 still matches #1 search');
assertTrue(
  hasIssueNumber('Sensation Comics #1 CGC 9.0', '1'),
  'Sensation #1 matches #1 search');
assertFalse(
  hasIssueNumber('Title #21 CGC 9.6', '2'),
  '#21 does NOT match #2 search');
assertFalse(
  hasIssueNumber('Title #200 CGC 9.6', '2'),
  '#200 does NOT match #2 search');

// ─── Guards & edge cases ───────────────────────────────────────────
console.log('\n── Edge cases ──');

assertTrue(
  hasIssueNumber('', null),
  'null issueNum → accept (no filter)');
assertTrue(
  hasIssueNumber('Some Title', null),
  'null issueNum with title → accept');
assertFalse(
  hasIssueNumber('Batman #1 NM', '1') && hasMultipleDistinctIssues('Batman #1 NM'),
  'single-issue → does not also flag as multi-issue');

// Existing lot detection preserved
assertFalse(
  hasIssueNumber('Batman #1 lot of comics', '1'),
  'lot keyword still rejects');
assertFalse(
  hasIssueNumber('Batman #1,#2,#3', '1'),
  'comma-separated issues still rejected');

// ─── Integration — 4 confirmed production miss cases ───────────────
console.log('\n── Integration: confirmed production misses ──');

// BUG 1 production miss: Absolute Batman #1 search → #4 + #6 leak
assertFalse(
  hasIssueNumber('Absolute Batman #6 Cover A 2024', '1'),
  'Bug 1 miss: Absolute Batman #6 rejected from #1 search');
assertTrue(
  hasIssueNumber('Absolute Batman #1 Cover A 2024', '1'),
  'Bug 1 miss: Absolute Batman #1 accepted (positive control)');

// BUG 2 production miss: TMNT Last Ronin #4 search → Last Ronin II leak
const lastRoninOurs = detectSeriesMarkers('TMNT Last Ronin');
const lastRoninTheirs = detectSeriesMarkers('TMNT Last Ronin II Re-Evolution #4');
const asymmetric = lastRoninTheirs.some((m) => !lastRoninOurs.includes(m));
assertTrue(
  asymmetric,
  'Bug 2 miss: Last Ronin II listing has marker Last Ronin I search lacks');

// BUG 3 production miss: US of Cap #1 pool polluted by $20 signed
assertTrue(
  SIGNED_RE.test('US of Cap #1 2X signed'),
  'Bug 3 miss: "2X signed" listing rejected');
assertTrue(
  SIGNED_RE.test('United States of Captain America #1 autographed'),
  'Bug 3 miss: autographed rejected');

// BUG 4 production miss: Daredevil #600 all-variant pool
const dd600Pool = [
  'Daredevil #600 Alex Ross Variant',
  'Daredevil #600 Artgerm Virgin 1:25',
  'Daredevil #600 Skan incentive',
  'Daredevil #600 foil variant',
];
const dd600Ratio = dd600Pool.filter((t) => VARIANT_CONTAM_RE.test(t)).length / dd600Pool.length;
assertTrue(
  dd600Ratio > 0.80,
  'Bug 4 miss: Daredevil #600 pool ratio >80% → 0.5 damping');

// ─── Ship #13.1 — computeThinPoolAnchor ────────────────────────────
// Ship #13 Bug 6 gated on isFromPC which falsely excluded the exact
// scenario it was designed for (PC outlier sanity-flipped to browse_api
// output on thin-pool books). Ship #13.1 extracts the anchor logic into
// a pure helper and removes the isFromPC gate. These assertions pin
// the helper's behavior across every code path.
console.log('\n── Ship #13.1 — computeThinPoolAnchor ──');

// Biker Mice from Mars #1 — confirmed production miss. Count 1,
// highest $7.16, engine output $8.23 (PC × mult sanity-fallbacked).
// Expected cap: $7.16 × 1.05 = $7.518.
const biker = computeThinPoolAnchor(
  8.23,
  { count: 1, highest: 7.16 },
  {}
);
assertTrue(biker && biker.shouldAnchor === true,
  'Biker Mice #1: anchor fires (count=1, 8.23 > 7.52)');
assertEq(biker.anchorCap.toFixed(3), '7.518',
  'Biker Mice #1: cap = $7.518');

// Below cap — no anchor.
assertEq(
  computeThinPoolAnchor(7.00, { count: 1, highest: 7.16 }, {}),
  null,
  '$7.00 < cap $7.52 → null (no anchor needed)'
);

// Exactly at cap — no anchor (must be strictly greater).
assertEq(
  computeThinPoolAnchor(7.518, { count: 1, highest: 7.16 }, {}),
  null,
  'exactly at cap → null (no-op)'
);

// 2 comps also in thin-pool range.
const twoComps = computeThinPoolAnchor(
  15.00,
  { count: 2, highest: 10.00 },
  {}
);
assertTrue(twoComps && twoComps.shouldAnchor === true,
  '2 comps, 15 > 10.50: anchor fires');
assertEq(twoComps.anchorCap, 10.5, '2 comps: cap = $10.50');

// 3 comps — outside thin-pool range, no anchor.
assertEq(
  computeThinPoolAnchor(15.00, { count: 3, highest: 10.00 }, {}),
  null,
  '3 comps → null (not thin pool)'
);

// 10 comps — outside thin-pool range.
assertEq(
  computeThinPoolAnchor(15.00, { count: 10, highest: 10.00 }, {}),
  null,
  '10 comps → null (full pool)'
);

// Zero comps — null.
assertEq(
  computeThinPoolAnchor(15.00, { count: 0, highest: 0 }, {}),
  null,
  'count=0 → null'
);

// Mega-key skip — even with thin pool.
assertEq(
  computeThinPoolAnchor(
    50000,
    { count: 1, highest: 100 },
    { isMegaKey: true }
  ),
  null,
  'mega-key skip (Action #1 thin pool, floor map authoritative)'
);

// compsExhausted skip — no trusted comps to anchor against.
assertEq(
  computeThinPoolAnchor(
    1000,
    { count: 1, highest: 10 },
    { compsExhausted: true }
  ),
  null,
  'compsExhausted skip (100% AI verify rejection)'
);

// Missing rawComps defensive.
assertEq(
  computeThinPoolAnchor(10, null, {}),
  null,
  'null rawComps → null'
);
assertEq(
  computeThinPoolAnchor(10, undefined, {}),
  null,
  'undefined rawComps → null'
);
assertEq(
  computeThinPoolAnchor(10, {}, {}),
  null,
  'empty rawComps object → null (no count field)'
);

// Invalid highest values.
assertEq(
  computeThinPoolAnchor(10, { count: 1, highest: 0 }, {}),
  null,
  'highest=0 → null'
);
assertEq(
  computeThinPoolAnchor(10, { count: 1, highest: -5 }, {}),
  null,
  'highest negative → null'
);
assertEq(
  computeThinPoolAnchor(10, { count: 1, highest: null }, {}),
  null,
  'highest null → null'
);

// Invalid currentPrice.
assertEq(
  computeThinPoolAnchor(0, { count: 1, highest: 10 }, {}),
  null,
  'currentPrice=0 → null'
);
assertEq(
  computeThinPoolAnchor(-5, { count: 1, highest: 10 }, {}),
  null,
  'currentPrice negative → null'
);
assertEq(
  computeThinPoolAnchor(null, { count: 1, highest: 10 }, {}),
  null,
  'currentPrice null → null'
);

// Ship #13.1 scope gap verification — browse_api path case.
// Regardless of "source" (no isFromPC gate on the helper), anchor
// decision is purely about count + highest + price.
const browseApiPath = computeThinPoolAnchor(
  8.23,
  { count: 1, highest: 7.16, average: 7.16 },
  {}
);
assertTrue(
  browseApiPath && browseApiPath.shouldAnchor === true,
  'browse_api path + thin pool: anchor fires (the Ship #13 gap fix)'
);

// Negative regression: pure browse_api book where price = average ≤ highest.
// Avg ≤ highest mathematically, so price never > highest×1.05 in this path
// unless sanity/mults were applied. Without mults, never binds.
assertEq(
  computeThinPoolAnchor(7.16, { count: 1, highest: 7.16 }, {}),
  null,
  'pure browse_api (price = avg = highest): no bind'
);

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
