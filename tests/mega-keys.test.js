// Unit tests for api/mega-keys.js — floor map, grade normalization,
// bucket rounding, exceedsMap detection, AND identity gating
// (Ship #20a.7: publisher + year required to prevent false-positive
// matches like TMNT #1 IDW 2016 Funko against the Mirage 1984 floor).
//
// Invoke: node tests/mega-keys.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  MEGA_KEYS_SCHEMA_VERSION,
  MEGA_KEYS_FLOOR,
  normalizeTitle,
  normalizePublisher,
  normalizeGrade,
  isMegaKey,
  getMegaKeyEntry,
  getMegaKeyFloor,
} from '../api/mega-keys.js';

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

console.log(`\n=== MEGA-KEYS v${MEGA_KEYS_SCHEMA_VERSION} ===\n`);

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof MEGA_KEYS_SCHEMA_VERSION, 'string', 'schema version is a string');
assertEq(MEGA_KEYS_SCHEMA_VERSION, '2.0.0', 'schema bumped to 2.0.0 for breaking signature change');
const entryCount = Object.keys(MEGA_KEYS_FLOOR).length;
assertEq(entryCount, 29, `map has exactly 29 entries (got ${entryCount})`);
const megaCount = Object.values(MEGA_KEYS_FLOOR).filter(e => e.type === 'MEGA').length;
const manualCount = Object.values(MEGA_KEYS_FLOOR).filter(e => e.type === 'MANUAL').length;
assertEq(megaCount, 27, '27 MEGA entries');
assertEq(manualCount, 2, '2 MANUAL entries');
const verifiedCount = Object.values(MEGA_KEYS_FLOOR).filter(e => e.verified === true).length;
assertEq(verifiedCount, 8, '8 verified:true entries');

// Identity-gating fields present on every entry
const entriesWithoutPublisher = Object.entries(MEGA_KEYS_FLOOR)
  .filter(([, e]) => !e.publisher);
assertEq(entriesWithoutPublisher.length, 0, 'every entry has a publisher');
const entriesWithoutYear = Object.entries(MEGA_KEYS_FLOOR)
  .filter(([, e]) => !e.year);
assertEq(entriesWithoutYear.length, 0, 'every entry has a year');

// Pre-1962 entries get yearTolerance: 2 (Golden / early-Silver dating drift)
const PRE_1962_KEYS = [
  'action comics|1', 'superman|1', 'detective comics|27', 'detective comics|38',
  'batman|1', 'marvel comics|1', 'captain america comics|1', 'all star comics|8',
  'sensation comics|1', 'flash comics|1', 'showcase|4', 'brave and the bold|28',
];
for (const k of PRE_1962_KEYS) {
  assertEq(MEGA_KEYS_FLOOR[k].yearTolerance, 2, `${k} yearTolerance=2 (pre-1962)`);
}
// Post-1962 entries omit yearTolerance (default 1 applied)
const POST_1962_SAMPLE = [
  'amazing fantasy|15', 'fantastic four|1', 'tales of suspense|39',
  'incredible hulk|181', 'teenage mutant ninja turtles|1',
];
for (const k of POST_1962_SAMPLE) {
  assertEq(MEGA_KEYS_FLOOR[k].yearTolerance, undefined, `${k} yearTolerance default (1)`);
}

// ─── Title/grade normalization ──────────────────────────────────────
console.log('\nTitle normalization:');
assertEq(normalizeTitle('Detective Comics'), 'detective comics', 'lowercase');
assertEq(normalizeTitle("D'Orc"), 'dorc', 'strip apostrophe');
assertEq(normalizeTitle('  X-Men  '), 'x men', 'trim whitespace + hyphen → space (Ship #9)');
assertEq(normalizeTitle('Amazing  Spider-Man'), 'amazing spider man', 'collapse spaces + hyphen → space (Ship #9)');

console.log('\nPublisher normalization (Ship #20a.7):');
assertEq(normalizePublisher(null), null, 'null → null');
assertEq(normalizePublisher(''), null, 'empty → null');
assertEq(normalizePublisher('   '), null, 'whitespace-only → null');
assertEq(normalizePublisher('DC'), 'dc', 'DC → dc');
assertEq(normalizePublisher('DC Comics'), 'dc', 'DC Comics → dc');
assertEq(normalizePublisher('National'), 'dc', 'National → dc');
assertEq(normalizePublisher('National Periodical Publications'), 'dc', 'National Periodical → dc');
assertEq(normalizePublisher('National Allied Publications'), 'dc', 'National Allied → dc');
assertEq(normalizePublisher('Detective Comics, Inc.'), 'dc', 'Detective Comics, Inc. → dc (punct stripped)');
assertEq(normalizePublisher('Marvel'), 'marvel', 'Marvel → marvel');
assertEq(normalizePublisher('Marvel Comics'), 'marvel', 'Marvel Comics → marvel');
assertEq(normalizePublisher('Marvel Comics Group'), 'marvel', 'Marvel Comics Group → marvel (1972-1986 cover legal name)');
assertEq(normalizePublisher('Marvel Entertainment Group'), 'marvel', 'Marvel Entertainment Group → marvel (1986-1996)');
assertEq(normalizePublisher('Marvel Worldwide'), 'marvel', 'Marvel Worldwide → marvel');
assertEq(normalizePublisher('Timely'), 'marvel', 'Timely → marvel');
assertEq(normalizePublisher('Timely Comics'), 'marvel', 'Timely Comics → marvel');
assertEq(normalizePublisher('Timely Publications'), 'marvel', 'Timely Publications → marvel');
assertEq(normalizePublisher('Atlas'), 'marvel', 'Atlas → marvel');
assertEq(normalizePublisher('Atlas Comics'), 'marvel', 'Atlas Comics → marvel');
assertEq(normalizePublisher('Atlas Marvel'), 'marvel', 'Atlas Marvel → marvel');
assertEq(normalizePublisher('Mirage'), 'mirage', 'Mirage → mirage');
assertEq(normalizePublisher('Mirage Studios'), 'mirage', 'Mirage Studios → mirage');
assertEq(normalizePublisher('IDW'), 'idw', 'IDW → idw');
assertEq(normalizePublisher('IDW Publishing'), 'idw', 'IDW Publishing → idw');
assertEq(normalizePublisher('Image'), 'image', 'Image → image');
assertEq(normalizePublisher('Image Comics'), 'image', 'Image Comics → image');
assertEq(normalizePublisher('Archie'), 'archie', 'Archie → archie');
assertEq(normalizePublisher('Archie Comics'), 'archie', 'Archie Comics → archie');
// Whitespace + punctuation handling
assertEq(normalizePublisher('  marvel  comics  '), 'marvel', 'extra whitespace');
assertEq(normalizePublisher('Marvel/Comics'), 'marvel', 'slash → space');
assertEq(normalizePublisher('Marvel (Comics)'), 'marvel', 'parens → space');
// Unknown publisher passes through (allows entry-side canonical match without alias)
assertEq(normalizePublisher('Random Press'), 'random press', 'unknown → cleaned passthrough');

console.log('\nGrade normalization:');
assertEq(normalizeGrade(null, 9.8), 9.8, 'numericGrade 9.8 → 9.8');
assertEq(normalizeGrade('VF 8.0'), 8.0, 'VF 8.0 → 8.0');
assertEq(normalizeGrade('FN 6.5'), 6.5, '6.5 → 6.5');
assertEq(normalizeGrade(null, 6.3), 6.0, '6.3 rounds DOWN to 6.0');
assertEq(normalizeGrade(null, 9.75), 9.6, '9.75 rounds DOWN to 9.6');
assertEq(normalizeGrade(null, 0.3), null, 'grade below 0.5 → null');
assertEq(normalizeGrade(null, 11), null, 'grade above 10 → null');
assertEq(normalizeGrade('unknown'), null, 'unparseable → null');

// ─── ACCEPT cases — original mega-keys with correct publisher + year ──
console.log('\nACCEPT — original mega-keys with correct publisher + year:');
assertTrue(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage', 1984), 'TMNT #1 (full title) Mirage 1984 ✓');
assertTrue(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage Studios', 1984), 'TMNT #1 Mirage Studios 1984 ✓');
assertTrue(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage', 1985), 'TMNT #1 Mirage 1985 (within ±1) ✓');
assertTrue(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage', 1983), 'TMNT #1 Mirage 1983 (within ±1) ✓');
assertTrue(getMegaKeyEntry('Action Comics', '1', 'DC', 1938), 'Action #1 DC 1938 ✓');
assertTrue(getMegaKeyEntry('Action Comics', '1', 'National', 1938), 'Action #1 National 1938 (alias) ✓');
assertTrue(getMegaKeyEntry('Action Comics', '1', 'National Allied Publications', 1938), 'Action #1 National Allied 1938 ✓');
assertTrue(getMegaKeyEntry('Detective Comics', '27', 'DC', 1939), 'Det #27 DC 1939 ✓');
assertTrue(getMegaKeyEntry('Detective Comics', '27', 'DC Comics', 1940), 'Det #27 DC 1940 (within ±2) ✓');
assertTrue(getMegaKeyEntry('Detective Comics', '27', 'DC', 1941), 'Det #27 DC 1941 (at ±2 boundary) ✓');
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1964), 'DD #1 Marvel 1964 ✓');
assertTrue(getMegaKeyEntry('X-Men', '1', 'Marvel', 1963), 'X-Men #1 Marvel 1963 ✓');
assertTrue(getMegaKeyEntry('Amazing Fantasy', '15', 'Marvel', 1962), 'AF #15 Marvel 1962 ✓');
assertTrue(getMegaKeyEntry('Amazing Fantasy', '15', 'Marvel Comics', 1962), 'AF #15 Marvel Comics 1962 ✓');
assertTrue(getMegaKeyEntry('Marvel Comics', '1', 'Timely', 1939), 'Marvel Comics #1 Timely 1939 (alias) ✓');
assertTrue(getMegaKeyEntry('Marvel Comics', '1', 'Timely Publications', 1939), 'Marvel Comics #1 Timely Publications ✓');
assertTrue(getMegaKeyEntry('Captain America Comics', '1', 'Atlas', 1941), 'Cap #1 Atlas 1941 (alias) ✓');
assertTrue(getMegaKeyEntry('Captain America Comics', '1', 'Timely', 1941), 'Cap #1 Timely 1941 (alias) ✓');
assertTrue(getMegaKeyEntry('Incredible Hulk', '181', 'Marvel', 1974), 'Hulk #181 Marvel 1974 ✓');
assertTrue(getMegaKeyEntry('Incredible Hulk', '181', 'Marvel Comics Group', 1974), 'Hulk #181 Marvel Comics Group 1974 (cover legal name alias) ✓');
assertTrue(getMegaKeyEntry('Giant-Size X-Men', '1', 'Marvel', 1975), 'GSX #1 Marvel 1975 ✓');
assertTrue(getMegaKeyEntry('Giant-Size X-Men', '1', 'Marvel Comics Group', 1975), 'GSX #1 Marvel Comics Group 1975 (cover legal name alias) ✓');
assertTrue(getMegaKeyEntry('Amazing Spider-Man', '300', 'Marvel', 1988), 'ASM #300 Marvel 1988 ✓');

// ─── REJECT cases — title+issue match, publisher OR year mismatch ────
console.log('\nREJECT — false-positive false matches (the bug class):');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'IDW', 2016), null, 'TMNT #1 IDW 2016 Funko (THE BUG) ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'IDW', 2011), null, 'TMNT #1 IDW 2011 relaunch ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Image', 1996), null, 'TMNT #1 Image 1996 relaunch ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Archie', 1988), null, 'TMNT #1 Archie 1988 ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage', 1986), null, 'TMNT #1 Mirage 1986 (out of ±1 tol — later printing) ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage', 1990), null, 'TMNT #1 Mirage 1990 (way out of tol) ✗');
assertEq(getMegaKeyEntry('Action Comics', '1', 'IDW', 2010), null, 'Action #1 IDW 2010 (wrong pub) ✗');
assertEq(getMegaKeyEntry('Action Comics', '1', 'DC', 2017), null, 'Action #1 DC 2017 facsimile (year mismatch) ✗');
assertEq(getMegaKeyEntry('Action Comics', '1', 'DC', 1942), null, 'Action #1 DC 1942 (out of ±2 tol) ✗');
assertEq(getMegaKeyEntry('Detective Comics', '27', 'DC', 2010), null, 'Det #27 DC 2010 facsimile ✗');
assertEq(getMegaKeyEntry('Detective Comics', '27', 'IDW', 1939), null, 'Det #27 IDW 1939 (impossible — wrong pub) ✗');
assertEq(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1998), null, 'DD #1 Marvel 1998 (Marvel Knights relaunch) ✗');
assertEq(getMegaKeyEntry('Daredevil', '1', 'Marvel', 2011), null, 'DD #1 Marvel 2011 relaunch ✗');
assertEq(getMegaKeyEntry('X-Men', '1', 'Marvel', 1991), null, 'X-Men #1 Marvel 1991 Jim Lee ✗');
assertEq(getMegaKeyEntry('X-Men', '1', 'Marvel', 2019), null, 'X-Men #1 Marvel 2019 HoX/PoX ✗');
assertEq(getMegaKeyEntry('X-Men', '1', 'Marvel', 2024), null, 'X-Men #1 Marvel 2024 Krakoa ✗');
assertEq(getMegaKeyEntry('Avengers', '1', 'Marvel', 1996), null, 'Avengers #1 Marvel 1996 Heroes Reborn ✗');
assertEq(getMegaKeyEntry('Avengers', '1', 'Marvel', 1998), null, 'Avengers #1 Marvel 1998 Heroes Return ✗');
assertEq(getMegaKeyEntry('Incredible Hulk', '181', 'Marvel', 1998), null, 'Hulk #181 Marvel 1998 Wolverine reprint ✗');
assertEq(getMegaKeyEntry('Captain America Comics', '1', 'DC', 1941), null, 'Cap #1 DC 1941 (impossible pub) ✗');

// ─── EDGE — partial disambiguation data ─────────────────────────────
console.log('\nEDGE — partial disambiguation (single field present):');
assertTrue(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'Mirage', null), 'TMNT #1 Mirage + null year (publisher disambiguates) ✓');
assertTrue(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', null, 1984), 'TMNT #1 null pub + 1984 (year disambiguates) ✓');
assertTrue(getMegaKeyEntry('Detective Comics', '27', 'DC', null), 'Det #27 DC + null year ✓');
assertTrue(getMegaKeyEntry('Detective Comics', '27', null, 1939), 'Det #27 null pub + 1939 ✓');
assertTrue(getMegaKeyEntry('Detective Comics', '27', null, '1939'), 'Det #27 string year ✓');
// Single field PRESENT but WRONG → still rejects
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', 'IDW', null), null, 'TMNT #1 IDW + null year (wrong pub still rejects) ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', null, 2016), null, 'TMNT #1 null pub + 2016 (wrong year still rejects) ✗');

// ─── EDGE — fail-closed: zero disambiguation data ───────────────────
console.log('\nEDGE — fail-closed when both publisher AND year unknown:');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1', null, null), null, 'TMNT #1 null+null → reject ✗');
assertEq(getMegaKeyEntry('Teenage Mutant Ninja Turtles', '1'), null, 'TMNT #1 no args → reject ✗');
assertEq(getMegaKeyEntry('Action Comics', '1', '', ''), null, 'Action #1 empty strings → reject ✗');
assertEq(getMegaKeyEntry('Detective Comics', '27', null, undefined), null, 'Det #27 undefined → reject ✗');

// ─── isMegaKey threading ────────────────────────────────────────────
console.log('\nisMegaKey threads identity gates the same way:');
assertEq(isMegaKey('Detective Comics', '27', 'DC', 1939), true, 'isMegaKey Det #27 DC 1939 true');
assertEq(isMegaKey('Detective Comics', '27', 'DC', 2010), false, 'isMegaKey Det #27 DC 2010 false (facsimile)');
assertEq(isMegaKey('Teenage Mutant Ninja Turtles', '1', 'IDW', 2016), false, 'isMegaKey TMNT IDW 2016 false (THE BUG)');
assertEq(isMegaKey('Teenage Mutant Ninja Turtles', '1', 'Mirage', 1984), true, 'isMegaKey TMNT Mirage 1984 true');
assertEq(isMegaKey('Batman', '181', 'DC', 1966), false, 'isMegaKey Batman #181 false (not in map)');
assertEq(isMegaKey('Daredevil', '1', 'Marvel', 1998), false, 'isMegaKey DD #1 1998 false (relaunch)');
assertEq(isMegaKey('Daredevil', '1', 'Marvel', 1964), true, 'isMegaKey DD #1 1964 true');

// ─── QA callout — Detective #27 @ 6.5 must be > $1.5M ───────────────
console.log('\nQA callout: Detective #27 @ 6.5 > $1.5M (with identity gates):');
const det27 = getMegaKeyFloor('Detective Comics', '27', 'DC', 1939, null, 6.5);
assertEq(det27.bucket, 6.5, 'bucket = 6.5');
assertTrue(det27.floor > 1_500_000, `floor > $1.5M (got $${det27.floor?.toLocaleString()})`);
assertEq(det27.exceedsMap, false, 'exceedsMap = false');
assertTrue(getMegaKeyEntry('Detective Comics', '27', 'DC', 1939).verified, 'Det #27 is verified');
// Facsimile floored as null
const det27Fac = getMegaKeyFloor('Detective Comics', '27', 'DC', 2010, null, 6.5);
assertEq(det27Fac.floor, null, 'Det #27 DC 2010 facsimile → no floor (identity rejected)');

// ─── QA callout — Action #1 MANUAL, no floor ────────────────────────
console.log('\nQA callout: Action #1 MANUAL behavior (with identity gates):');
const action = getMegaKeyEntry('Action Comics', '1', 'DC', 1938);
assertEq(action?.type, 'MANUAL', 'type = MANUAL');
assertEq(action?.grades, null, 'grades = null');
const actionFloor = getMegaKeyFloor('Action Comics', '1', 'DC', 1938, null, 9.0);
assertEq(actionFloor.floor, null, 'getMegaKeyFloor returns null floor for MANUAL');
assertEq(actionFloor.exceedsMap, false, 'MANUAL does not set exceedsMap');
// Facsimile no longer triggers MANUAL REVIEW (correct downstream behavior)
const actionFac = getMegaKeyEntry('Action Comics', '1', 'DC', 2017);
assertEq(actionFac, null, 'Action #1 DC 2017 facsimile → no MANUAL trigger (identity rejected)');

// ─── QA callout — Superman #1 MANUAL ────────────────────────────────
console.log('\nQA callout: Superman #1 MANUAL:');
assertEq(getMegaKeyEntry('Superman', '1', 'DC', 1939).type, 'MANUAL', 'Superman #1 MANUAL');
assertEq(getMegaKeyEntry('Superman', '1', 'DC', 2018), null, 'Superman #1 DC 2018 facsimile → reject');

// ─── QA callout — Hulk #181 grade values ────────────────────────────
console.log('\nQA callout: Hulk #181 grade values (with identity gates):');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'Marvel', 1974, 'GD 2.0', 2.0).floor, 3_000, '#181 @ 2.0 = $3K');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'Marvel', 1974, 'VF 8.0', 8.0).floor, 12_000, '#181 @ 8.0 = $12K');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'Marvel', 1974, 'NM 9.4', 9.4).floor, 40_000, '#181 @ 9.4 = $40K');
// Wolverine 1998 anniversary reprint → no floor
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'Marvel', 1998, 'NM 9.4', 9.4).floor, null, '#181 1998 reprint → no floor');

// ─── QA callout — AF #15 CGC 9.4 ────────────────────────────────────
console.log('\nQA callout: AF #15 CGC 9.4:');
const af15 = getMegaKeyFloor('Amazing Fantasy', '15', 'Marvel', 1962, null, 9.4);
assertEq(af15.floor, 1_100_000, '#15 @ 9.4 = $1.1M');
assertTrue(getMegaKeyEntry('Amazing Fantasy', '15', 'Marvel', 1962).verified, 'AF#15 verified');

// ─── exceedsMap detection ───────────────────────────────────────────
console.log('\nexceedsMap detection:');
const det27hi = getMegaKeyFloor('Detective Comics', '27', 'DC', 1939, null, 9.0);
assertEq(det27hi.exceedsMap, true, 'Det #27 @ 9.0 exceedsMap=true');
assertEq(det27hi.floor, null, 'Det #27 @ 9.0 floor=null');
const af15hi = getMegaKeyFloor('Amazing Fantasy', '15', 'Marvel', 1962, null, 9.8);
assertEq(af15hi.exceedsMap, true, 'AF #15 @ 9.8 exceedsMap=true');
const tos39hi = getMegaKeyFloor('Tales of Suspense', '39', 'Marvel', 1963, null, 9.8);
assertEq(tos39hi.exceedsMap, true, 'TOS #39 @ 9.8 exceedsMap=true');

// ─── Bucket round-down ──────────────────────────────────────────────
console.log('\nBucket round-down:');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'Marvel', 1974, null, 6.3).floor, 8_000, '6.3 → 6.0 bucket $8K');
assertEq(getMegaKeyFloor('Detective Comics', '27', 'DC', 1939, null, 6.4).floor, 1_700_000, 'Det 6.4 → 6.0 $1.7M');

// ─── priceHigh (next bucket) ────────────────────────────────────────
console.log('\npriceHigh = next bucket up:');
const h181_20 = getMegaKeyFloor('Incredible Hulk', '181', 'Marvel', 1974, null, 2.0);
assertEq(h181_20.floor, 3_000, '#181 @ 2.0 floor=3K');
assertEq(h181_20.priceHigh, 3_500, '#181 @ 2.0 priceHigh=3.5K');
const af15_96 = getMegaKeyFloor('Amazing Fantasy', '15', 'Marvel', 1962, null, 9.6);
assertEq(af15_96.floor, 2_400_000, 'AF @ 9.6 floor=$2.4M');
assertEq(af15_96.priceHigh, Math.round(2_400_000 * 1.3), 'AF @ 9.6 priceHigh = floor×1.3');

// ─── SEPARATION: GSX #1 ≠ X-Men #1 ──────────────────────────────────
console.log('\nSeparation: GSX #1 ≠ X-Men #1:');
const xmen1 = getMegaKeyEntry('X-Men', '1', 'Marvel', 1963);
const gsx1 = getMegaKeyEntry('Giant-Size X-Men', '1', 'Marvel', 1975);
assertTrue(xmen1, 'X-Men #1 1963 exists');
assertTrue(gsx1, 'Giant-Size X-Men #1 1975 exists');
assertTrue(xmen1 !== gsx1, 'Different entries');
assertEq(xmen1.grades[9.2], 500_000, 'X-Men #1 @ 9.2 = $500K');
assertEq(gsx1.grades[9.2], 11_000, 'GSX #1 @ 9.2 = $11K');

// ─── TOS #39 exists, Iron Man #1 doesn't ────────────────────────────
console.log('\nSeparation: TOS #39 is on list, Iron Man #1 is NOT:');
assertTrue(getMegaKeyEntry('Tales of Suspense', '39', 'Marvel', 1963), 'TOS #39 exists');
assertEq(getMegaKeyEntry('Iron Man', '1', 'Marvel', 1968), null, 'Iron Man #1 NOT in map');

// ─── AF #15 has NO 35¢ variant ──────────────────────────────────────
console.log('\nAF #15 has NO 35¢ variant entry:');
assertEq(getMegaKeyEntry('Amazing Fantasy', '15 35 cent', 'Marvel', 1962), null, 'No 35¢ key');
assertEq(getMegaKeyEntry('Amazing Fantasy 35 cent variant', '15', 'Marvel', 1962), null, 'No title variant');

// ─── Regression: non-mega books return null ─────────────────────────
console.log('\nRegression: non-mega books untouched:');
assertEq(getMegaKeyEntry('Batman', '181', 'DC', 1966), null, 'Batman #181 not mega');
assertEq(getMegaKeyEntry('Spawn', '8', 'Image', 1992), null, 'Spawn #8 not mega');
assertEq(getMegaKeyEntry('Amazing Spider-Man', '121', 'Marvel', 1973), null, 'ASM #121 not mega');
assertEq(isMegaKey('Batman', '181', 'DC', 1966), false, 'isMegaKey(Batman #181) false');
assertEq(isMegaKey('Detective Comics', '27', 'DC', 1939), true, 'isMegaKey(Det #27 DC 1939) true');

// ─── Title normalization lookup path (with identity threaded) ──────
console.log('\nLookup is case/whitespace insensitive (with identity):');
assertTrue(getMegaKeyEntry('DETECTIVE COMICS', '27', 'DC', 1939), 'uppercase title works');
assertTrue(getMegaKeyEntry('detective comics', '27', 'dc', 1939), 'lowercase works');
assertTrue(getMegaKeyEntry('Detective  Comics', '27', 'DC Comics', 1939), 'extra spaces + alias work');
assertTrue(getMegaKeyEntry('detective comics', 27, 'DC', 1939), 'numeric issue works');

// ─── Unknown books ──────────────────────────────────────────────────
console.log('\nUnknown books:');
const none = getMegaKeyFloor('Random Comic', '1', 'Some Pub', 2020, null, 6.0);
assertEq(none.floor, null, 'unknown book → null floor');
assertEq(none.exceedsMap, false, 'unknown book → exceedsMap false');

// ─── Pre-1962 ±2 tolerance edge cases ───────────────────────────────
console.log('\nPre-1962 ±2 tolerance boundaries:');
assertTrue(getMegaKeyEntry('Showcase', '4', 'DC', 1956), 'Showcase #4 DC 1956 ✓');
assertTrue(getMegaKeyEntry('Showcase', '4', 'DC', 1957), 'Showcase #4 DC 1957 (within ±2) ✓');
assertTrue(getMegaKeyEntry('Showcase', '4', 'DC', 1958), 'Showcase #4 DC 1958 (at ±2 boundary) ✓');
assertEq(getMegaKeyEntry('Showcase', '4', 'DC', 1959), null, 'Showcase #4 DC 1959 (out of ±2) ✗');
assertEq(getMegaKeyEntry('Showcase', '4', 'DC', 1953), null, 'Showcase #4 DC 1953 (out of ±2) ✗');
assertTrue(getMegaKeyEntry('Brave and the Bold', '28', 'DC', 1960), 'B&B #28 DC 1960 ✓');
assertTrue(getMegaKeyEntry('Brave and the Bold', '28', 'DC', 1962), 'B&B #28 DC 1962 (at ±2 boundary) ✓');

// ─── Post-1962 ±1 tolerance edge cases ──────────────────────────────
console.log('\nPost-1962 ±1 default tolerance boundaries:');
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1964), 'DD #1 1964 ✓');
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1965), 'DD #1 1965 (within ±1) ✓');
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1963), 'DD #1 1963 (within ±1) ✓');
assertEq(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1966), null, 'DD #1 1966 (out of ±1) ✗');
assertEq(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1962), null, 'DD #1 1962 (out of ±1) ✗');

// ─── Year as string (parseInt path) ─────────────────────────────────
console.log('\nYear input is permissive (string or number):');
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', '1964'), 'DD #1 string year "1964" ✓');
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', 1964.0), 'DD #1 float year 1964.0 ✓');
// Unparseable year → parseInt returns NaN → treated as "no year provided".
// Publisher gate still satisfied → ACCEPT (publisher alone disambiguates).
assertTrue(getMegaKeyEntry('Daredevil', '1', 'Marvel', 'not-a-year'), 'DD #1 Marvel + unparseable year (publisher disambiguates) ✓');
// Both fields invalid → fail-closed.
assertEq(getMegaKeyEntry('Daredevil', '1', '', 'not-a-year'), null, 'DD #1 empty pub + unparseable year → reject');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
