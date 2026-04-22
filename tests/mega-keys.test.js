// Unit tests for api/mega-keys.js — floor map, grade normalization,
// bucket rounding, exceedsMap detection. Runs as plain node.
//
// Invoke: node tests/mega-keys.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  MEGA_KEYS_SCHEMA_VERSION,
  MEGA_KEYS_FLOOR,
  normalizeTitle,
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

console.log(`\n=== MEGA-KEYS v${MEGA_KEYS_SCHEMA_VERSION} ===\n`);

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof MEGA_KEYS_SCHEMA_VERSION, 'string', 'schema version is a string');
const entryCount = Object.keys(MEGA_KEYS_FLOOR).length;
assertEq(entryCount, 29, `map has exactly 29 entries (got ${entryCount})`);
const megaCount = Object.values(MEGA_KEYS_FLOOR).filter(e => e.type === 'MEGA').length;
const manualCount = Object.values(MEGA_KEYS_FLOOR).filter(e => e.type === 'MANUAL').length;
assertEq(megaCount, 27, '27 MEGA entries');
assertEq(manualCount, 2, '2 MANUAL entries');
const verifiedCount = Object.values(MEGA_KEYS_FLOOR).filter(e => e.verified === true).length;
assertEq(verifiedCount, 8, '8 verified:true entries');

// ─── Title/grade normalization ──────────────────────────────────────
console.log('\nTitle normalization:');
assertEq(normalizeTitle('Detective Comics'), 'detective comics', 'lowercase');
assertEq(normalizeTitle("D'Orc"), 'dorc', 'strip apostrophe');
assertEq(normalizeTitle('  X-Men  '), 'x men', 'trim whitespace + hyphen → space (Ship #9)');
assertEq(normalizeTitle('Amazing  Spider-Man'), 'amazing spider man', 'collapse spaces + hyphen → space (Ship #9)');

console.log('\nGrade normalization:');
assertEq(normalizeGrade(null, 9.8), 9.8, 'numericGrade 9.8 → 9.8');
assertEq(normalizeGrade('VF 8.0'), 8.0, 'VF 8.0 → 8.0');
assertEq(normalizeGrade('FN 6.5'), 6.5, '6.5 → 6.5');
assertEq(normalizeGrade(null, 6.3), 6.0, '6.3 rounds DOWN to 6.0');
assertEq(normalizeGrade(null, 9.75), 9.6, '9.75 rounds DOWN to 9.6');
assertEq(normalizeGrade(null, 0.3), null, 'grade below 0.5 → null');
assertEq(normalizeGrade(null, 11), null, 'grade above 10 → null');
assertEq(normalizeGrade('unknown'), null, 'unparseable → null');

// ─── QA callout — Detective #27 @ 6.5 must be > $1.5M ───────────────
console.log('\nQA callout: Detective #27 @ 6.5 > $1.5M:');
const det27 = getMegaKeyFloor('Detective Comics', '27', null, 6.5);
assertEq(det27.bucket, 6.5, 'bucket = 6.5');
assertTrue(det27.floor > 1_500_000, `floor > $1.5M (got $${det27.floor?.toLocaleString()})`);
assertEq(det27.exceedsMap, false, 'exceedsMap = false');
assertTrue(getMegaKeyEntry('Detective Comics', '27').verified, 'Det #27 is verified');

// ─── QA callout — Action #1 MANUAL, no floor ────────────────────────
console.log('\nQA callout: Action #1 MANUAL, no floor:');
const action = getMegaKeyEntry('Action Comics', '1');
assertEq(action?.type, 'MANUAL', 'type = MANUAL');
assertEq(action?.grades, null, 'grades = null');
const actionFloor = getMegaKeyFloor('Action Comics', '1', null, 9.0);
assertEq(actionFloor.floor, null, 'getMegaKeyFloor returns null floor for MANUAL');
assertEq(actionFloor.exceedsMap, false, 'MANUAL does not set exceedsMap');

// ─── QA callout — Superman #1 MANUAL ────────────────────────────────
console.log('\nQA callout: Superman #1 MANUAL:');
assertEq(getMegaKeyEntry('Superman', '1').type, 'MANUAL', 'Superman #1 MANUAL');

// ─── QA callout — Hulk #181 grade values ────────────────────────────
console.log('\nQA callout: Hulk #181 grade values:');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'GD 2.0', 2.0).floor, 3_000, '#181 @ 2.0 = $3K');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'VF 8.0', 8.0).floor, 12_000, '#181 @ 8.0 = $12K');
assertEq(getMegaKeyFloor('Incredible Hulk', '181', 'NM 9.4', 9.4).floor, 40_000, '#181 @ 9.4 = $40K');

// ─── QA callout — AF #15 CGC 9.4 ────────────────────────────────────
console.log('\nQA callout: AF #15 CGC 9.4:');
const af15 = getMegaKeyFloor('Amazing Fantasy', '15', null, 9.4);
assertEq(af15.floor, 1_100_000, '#15 @ 9.4 = $1.1M');
assertTrue(getMegaKeyEntry('Amazing Fantasy', '15').verified, 'AF#15 verified');

// ─── exceedsMap detection ───────────────────────────────────────────
console.log('\nexceedsMap detection:');
// Detective #27 map ends at 8.0 — 9.0 should exceed
const det27hi = getMegaKeyFloor('Detective Comics', '27', null, 9.0);
assertEq(det27hi.exceedsMap, true, 'Det #27 @ 9.0 exceedsMap=true');
assertEq(det27hi.floor, null, 'Det #27 @ 9.0 floor=null');
// AF #15 map ends at 9.6 — 9.8 should exceed
const af15hi = getMegaKeyFloor('Amazing Fantasy', '15', null, 9.8);
assertEq(af15hi.exceedsMap, true, 'AF #15 @ 9.8 exceedsMap=true');
// TOS #39 map ends at 9.6 — 9.8 should exceed
const tos39hi = getMegaKeyFloor('Tales of Suspense', '39', null, 9.8);
assertEq(tos39hi.exceedsMap, true, 'TOS #39 @ 9.8 exceedsMap=true');

// ─── Bucket round-down ──────────────────────────────────────────────
console.log('\nBucket round-down:');
// Hulk #181 has every bucket; 6.3 should hit 6.0 bucket = $8K
assertEq(getMegaKeyFloor('Incredible Hulk', '181', null, 6.3).floor, 8_000, '6.3 → 6.0 bucket $8K');
// Det #27 has 6.0 and 6.5 — 6.4 should hit 6.0 = $1.7M
assertEq(getMegaKeyFloor('Detective Comics', '27', null, 6.4).floor, 1_700_000, 'Det 6.4 → 6.0 $1.7M');

// ─── priceHigh (next bucket) ────────────────────────────────────────
console.log('\npriceHigh = next bucket up:');
// Hulk #181 at 2.0 → floor 3K, priceHigh should be 3.5K (next bucket)
const h181_20 = getMegaKeyFloor('Incredible Hulk', '181', null, 2.0);
assertEq(h181_20.floor, 3_000, '#181 @ 2.0 floor=3K');
assertEq(h181_20.priceHigh, 3_500, '#181 @ 2.0 priceHigh=3.5K');
// AF #15 at 9.6 (highest bucket) → priceHigh = floor × 1.3
const af15_96 = getMegaKeyFloor('Amazing Fantasy', '15', null, 9.6);
assertEq(af15_96.floor, 2_400_000, 'AF @ 9.6 floor=$2.4M');
assertEq(af15_96.priceHigh, Math.round(2_400_000 * 1.3), 'AF @ 9.6 priceHigh = floor×1.3');

// ─── SEPARATION: GSX #1 ≠ X-Men #1 ──────────────────────────────────
console.log('\nSeparation: GSX #1 ≠ X-Men #1:');
const xmen1 = getMegaKeyEntry('X-Men', '1');
const gsx1 = getMegaKeyEntry('Giant-Size X-Men', '1');
assertTrue(xmen1, 'X-Men #1 exists');
assertTrue(gsx1, 'Giant-Size X-Men #1 exists');
assertTrue(xmen1 !== gsx1, 'Different entries');
assertEq(xmen1.grades[9.2], 500_000, 'X-Men #1 @ 9.2 = $500K');
assertEq(gsx1.grades[9.2], 11_000, 'GSX #1 @ 9.2 = $11K');

// ─── TOS #39 exists, Iron Man #1 doesn't ────────────────────────────
console.log('\nSeparation: TOS #39 is on list, Iron Man #1 is NOT:');
assertTrue(getMegaKeyEntry('Tales of Suspense', '39'), 'TOS #39 exists');
assertEq(getMegaKeyEntry('Iron Man', '1'), null, 'Iron Man #1 NOT in map');

// ─── AF #15 has NO 35¢ variant ──────────────────────────────────────
console.log('\nAF #15 has NO 35¢ variant entry:');
assertEq(getMegaKeyEntry('Amazing Fantasy', '15 35 cent'), null, 'No 35¢ key');
assertEq(getMegaKeyEntry('Amazing Fantasy 35 cent variant', '15'), null, 'No title variant');

// ─── Regression: non-mega books return null ─────────────────────────
console.log('\nRegression: non-mega books untouched:');
assertEq(getMegaKeyEntry('Batman', '181'), null, 'Batman #181 not mega');
assertEq(getMegaKeyEntry('Spawn', '8'), null, 'Spawn #8 not mega');
assertEq(getMegaKeyEntry('Amazing Spider-Man', '121'), null, 'ASM #121 not mega');
assertEq(isMegaKey('Batman', '181'), false, 'isMegaKey(Batman #181) false');
assertEq(isMegaKey('Detective Comics', '27'), true, 'isMegaKey(Det #27) true');

// ─── Title normalization lookup path ────────────────────────────────
console.log('\nLookup is case/whitespace insensitive:');
assertTrue(getMegaKeyEntry('DETECTIVE COMICS', '27'), 'uppercase works');
assertTrue(getMegaKeyEntry('detective comics', '27'), 'lowercase works');
assertTrue(getMegaKeyEntry('Detective  Comics', '27'), 'extra spaces work');
assertTrue(getMegaKeyEntry('detective comics', 27), 'numeric issue works');

// ─── Unknown books ──────────────────────────────────────────────────
console.log('\nUnknown books:');
const none = getMegaKeyFloor('Random Comic', '1', null, 6.0);
assertEq(none.floor, null, 'unknown book → null floor');
assertEq(none.exceedsMap, false, 'unknown book → exceedsMap false');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
