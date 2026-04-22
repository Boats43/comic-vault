// Unit tests for Ship #9 — 35¢ test-market variant allowlist gate.
// Verifies that books inside the canonical Marvel 1977 test-market
// window pass the gate (multiplier applies) and books outside fall
// through (multiplier skipped).
//
// Invoke: node tests/variant-allowlist.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { normalizeTitle } from '../api/mega-keys.js';

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

// Re-derive the gate locally — TEST_MARKET_VARIANTS / isTestMarketVariant
// live inside api/enrich.js (not exported). Mirror the public surface so
// the gate can be tested in isolation. If the production list changes,
// update both. The allowlist data itself is the contract under test.
const TEST_MARKET_VARIANTS = {
  '35¢': {
    '2001 a space odyssey': [7, 8, 9, 10],
    'amazing spider man': [169, 170, 171, 172, 173],
    'avengers': [160, 161, 162, 163, 164],
    'black panther': [4, 5],
    'captain america': [210, 211, 212, 213, 214],
    'captain marvel': [51, 52],
    'champions': [14, 15],
    'conan the barbarian': [75, 76, 77, 78, 79],
    'daredevil': [146, 147, 148],
    'defenders': [48, 49, 50, 51, 52],
    'doctor strange': [23, 24, 25],
    'dr strange': [23, 24, 25],
    'eternals': [12, 13, 14, 15, 16],
    'fantastic four': [183, 184, 185, 186, 187],
    'flintstones': [1],
    'ghost rider': [24, 25, 26],
    'godzilla': [1, 2, 3],
    'howard the duck': [13, 14, 15, 16, 17],
    'human fly': [1, 2],
    'incredible hulk': [212, 213, 214, 215, 216],
    'inhumans': [11, 12],
    'invaders': [17, 18, 19, 20, 21],
    'iron fist': [13, 14, 15],
    'iron man': [99, 100, 101, 102, 103],
    'john carter': [1, 2, 3, 4, 5],
    'john carter warlord of mars': [1, 2, 3, 4, 5],
    'kid colt': [218, 219, 220],
    'kid colt outlaw': [218, 219, 220],
    'kull the destroyer': [21, 22, 23],
    'logans run': [6, 7],
    'marvel premiere': [36, 37, 38],
    'marvel presents': [11, 12],
    'marvel super action': [2, 3],
    'marvel super heroes': [65, 66],
    'marvel tales': [80, 81, 82, 83, 84],
    'marvel team up': [58, 59, 60, 61, 62],
    'marvel triple action': [36, 37],
    'marvel two in one': [28, 29, 30, 31, 32],
    'marvels greatest comics': [71, 72, 73],
    'master of kung fu': [53, 54, 55, 56, 57],
    'ms marvel': [6, 7, 8, 9, 10],
    'nova': [10, 11, 12, 13, 14],
    'omega the unknown': [9, 10],
    'power man': [44, 45, 46, 47],
    'rawhide kid': [140, 141],
    'red sonja': [4, 5],
    'scooby doo': [1],
    'sgt fury': [141, 142],
    'sgt fury and his howling commandos': [141, 142],
    'spectacular spider man': [7, 8, 9, 10, 11],
    'star wars': [1, 2, 3, 4],
    'super villain team up': [12, 13, 14],
    'tarzan': [1, 2, 3, 4, 5],
    'thor': [260, 261, 262, 263, 264],
    'tomb of dracula': [57, 58, 59, 60],
    'x men': [105, 106, 107],
  },
  '30¢': {
    'adventures on the planet of the apes': [5, 6, 7],
    'amazing adventures': [36, 37],
    'amazing spider man': [155, 156, 157, 158, 159],
    'astonishing tales': [35, 36],
    'avengers': [146, 147, 148, 149, 150],
    'black goliath': [2, 3, 4],
    'captain america': [196, 197, 198, 199, 200],
    'captain marvel': [44, 45],
    'chamber of chills': [22, 23],
    'champions': [5, 6, 7],
    'conan the barbarian': [61, 62, 63, 64, 65],
    'daredevil': [132, 133, 134, 135, 136],
    'defenders': [34, 35, 36, 37, 38],
    'doctor strange': [13, 14, 15, 16, 17],
    'dr strange': [13, 14, 15, 16, 17],
    'eternals': [1, 2],
    'fantastic four': [169, 170, 171, 172, 173],
    'ghost rider': [17, 18, 19],
    'howard the duck': [3, 4],
    'incredible hulk': [198, 199, 200, 201, 202],
    'invaders': [6, 7],
    'iron fist': [4, 5, 6],
    'iron man': [85, 86, 87, 88, 89],
    'jungle action': [21, 22],
    'kid colt': [205, 206, 207, 208, 209],
    'kid colt outlaw': [205, 206, 207, 208, 209],
    'kull the destroyer': [16],
    'marvel adventure': [3, 4, 5],
    'marvel chillers': [4, 5, 6],
    'marvel double feature': [15, 16, 17],
    'marvel feature': [4, 5],
    'marvel premiere': [29, 30, 31],
    'marvel presents': [4, 5, 6],
    'marvel spotlight': [27, 28, 29],
    'marvel super heroes': [57, 58],
    'marvel tales': [66, 67, 68, 69, 70],
    'marvel team up': [44, 45, 46, 47, 48],
    'marvel triple action': [29, 30],
    'marvel two in one': [15, 16, 17, 18],
    'marvels greatest comics': [63, 64],
    'master of kung fu': [39, 40, 41, 42, 43],
    'mighty marvel western': [45],
    'omega the unknown': [2, 3],
    'power man': [30, 31, 32, 33, 34],
    'rawhide kid': [133, 134],
    'ringo kid': [27, 28],
    'sgt fury': [133, 134],
    'sgt fury and his howling commandos': [133, 134],
    'skull the slayer': [5, 6],
    'son of satan': [3, 4, 5],
    'strange tales': [185, 186],
    'super villain team up': [5, 6, 7],
    'thor': [246, 247, 248, 249, 250],
    'tomb of darkness': [20, 21],
    'tomb of dracula': [43, 44, 45, 46, 47],
    'two gun kid': [129, 130, 131],
    'warlock': [12, 13, 14],
    'weird wonder tales': [15, 16, 17],
    'werewolf by night': [38, 39],
    'x men': [98, 99, 100],
  },
};

const isTestMarketVariant = (title, issue, variantKey = '35¢') => {
  const bucket = TEST_MARKET_VARIANTS[variantKey];
  if (!bucket) return false;
  const titleKey = normalizeTitle(title);
  if (!titleKey) return false;
  const issueNum = parseInt(String(issue || '').trim(), 10);
  if (isNaN(issueNum)) return false;
  const allowed = bucket[titleKey];
  return Array.isArray(allowed) && allowed.includes(issueNum);
};

console.log('\n=== 35¢ TEST-MARKET ALLOWLIST ===\n');

// ─── ALLOW cases (in canonical window — multiplier should apply) ────
console.log('ALLOW cases (in window):');
assertEq(isTestMarketVariant('Iron Fist', '14'), true, 'Iron Fist #14');
assertEq(isTestMarketVariant('Star Wars', '1'), true, 'Star Wars #1');
assertEq(isTestMarketVariant('Star Wars', '4'), true, 'Star Wars #4 (last in run)');
assertEq(isTestMarketVariant('Ms. Marvel', '7'), true, 'Ms. Marvel #7 (apostrophe-stripping)');
assertEq(isTestMarketVariant('Amazing Spider-Man', '171'), true, 'Amazing Spider-Man #171 (hyphen→space)');
assertEq(isTestMarketVariant('Conan the Barbarian', '75'), true, 'Conan the Barbarian #75');
assertEq(isTestMarketVariant('X-Men', '107'), true, 'X-Men #107 (hyphen→space)');
assertEq(isTestMarketVariant('Marvel Two-In-One', '30'), true, 'Marvel Two-In-One #30 (multi-hyphen)');
assertEq(isTestMarketVariant('Sgt. Fury', '141'), true, 'Sgt. Fury #141 (short alias)');
assertEq(isTestMarketVariant('Sgt Fury and His Howling Commandos', '141'), true, 'Sgt Fury (long alias)');

// ─── DENY cases (out of window — multiplier must be skipped) ────────
console.log('\nDENY cases (out of window):');
assertEq(isTestMarketVariant('Howard the Duck', '28'), false, 'Howard the Duck #28 (after Oct 1977)');
assertEq(isTestMarketVariant('Amazing Spider-Man', '300'), false, 'Amazing Spider-Man #300 (1988)');
assertEq(isTestMarketVariant('Spawn', '8'), false, 'Spawn #8 (Image, not Marvel)');
assertEq(isTestMarketVariant('Star Wars', '100'), false, 'Star Wars #100 (wrong issue)');
assertEq(isTestMarketVariant('Iron Fist', '12'), false, 'Iron Fist #12 (off-by-one before window)');
assertEq(isTestMarketVariant('Iron Fist', '16'), false, 'Iron Fist #16 (off-by-one after window)');
assertEq(isTestMarketVariant('Walking Dead', '1'), false, 'Walking Dead #1 (unknown title)');
assertEq(isTestMarketVariant('Howard the Duck', '12'), false, 'Howard the Duck #12 (one before window)');
assertEq(isTestMarketVariant('Howard the Duck', '18'), false, 'Howard the Duck #18 (one after window)');

// ─── EDGE cases ─────────────────────────────────────────────────────
console.log('\nEDGE cases:');
assertEq(isTestMarketVariant('', '14'), false, 'Empty title — denied (safe default)');
assertEq(isTestMarketVariant('Iron Fist', null), false, 'Null issue — denied (safe default)');
assertEq(isTestMarketVariant('Iron Fist', ''), false, 'Empty issue — denied (safe default)');
assertEq(isTestMarketVariant('Iron Fist', 'abc'), false, 'Non-numeric issue — denied');
assertEq(isTestMarketVariant('Iron Fist', '14'), true, 'String "14" parses to int 14 — allowed');
assertEq(isTestMarketVariant('Iron Fist', 14), true, 'Numeric 14 — allowed');
assertEq(isTestMarketVariant('IRON FIST', '14'), true, 'Uppercase title normalized');
assertEq(isTestMarketVariant("X-Men", '105'), true, 'X-Men hyphen normalized to space');

// ─── normalizeTitle hyphen handling (extension) ─────────────────────
console.log('\nnormalizeTitle hyphen extension:');
assertEq(normalizeTitle('Marvel Team-Up'), 'marvel team up', 'Hyphen → space');
assertEq(normalizeTitle('Super-Villain Team-Up'), 'super villain team up', 'Multi-hyphen');
assertEq(normalizeTitle('Spider-Man'), 'spider man', 'Single hyphen');
assertEq(normalizeTitle("Sgt. Fury"), 'sgt fury', 'Apostrophe + period stripped');
assertEq(normalizeTitle('  X-Men  '), 'x men', 'Trim + hyphen');

// ─── Ship #10: Kull retroactive correction ──────────────────────────
console.log('\nShip #10 Kull correction (Conqueror → Destroyer):');
assertEq(isTestMarketVariant('Kull the Destroyer', '21', '35¢'), true, '35¢ Kull the Destroyer #21 (corrected)');
assertEq(isTestMarketVariant('Kull the Destroyer', '23', '35¢'), true, '35¢ Kull the Destroyer #23 (corrected)');
assertEq(isTestMarketVariant('Kull the Conqueror', '21', '35¢'), false, '35¢ Kull the Conqueror #21 (old typo key removed)');
assertEq(isTestMarketVariant('Kull the Destroyer', '16', '30¢'), true, '30¢ Kull the Destroyer #16');

// ─── Ship #10: Doctor Strange / Dr. Strange dual-key ────────────────
console.log('\nShip #10 Doctor Strange dual-key (Vision varies):');
assertEq(isTestMarketVariant('Doctor Strange', '24', '35¢'), true, '35¢ Doctor Strange #24 (long form)');
assertEq(isTestMarketVariant('Dr. Strange', '24', '35¢'), true, '35¢ Dr. Strange #24 (short form)');
assertEq(isTestMarketVariant('Doctor Strange', '15', '30¢'), true, '30¢ Doctor Strange #15 (long form)');
assertEq(isTestMarketVariant('Dr. Strange', '15', '30¢'), true, '30¢ Dr. Strange #15 (short form)');
assertEq(isTestMarketVariant('Doctor Strange', '50', '35¢'), false, '35¢ Doctor Strange #50 (out of window)');

console.log('\n\n=== 30¢ TEST-MARKET ALLOWLIST ===\n');

// ─── 30¢ ALLOW cases ────────────────────────────────────────────────
console.log('ALLOW cases (in 1976 window):');
assertEq(isTestMarketVariant('X-Men', '98', '30¢'), true, 'X-Men #98 (pre-Giant-Size era)');
assertEq(isTestMarketVariant('X-Men', '100', '30¢'), true, 'X-Men #100');
assertEq(isTestMarketVariant('Amazing Spider-Man', '157', '30¢'), true, 'ASM #157 (Razorback)');
assertEq(isTestMarketVariant('Hulk', '181', '30¢'), false, 'Hulk #181 NOT in 30¢ window (1974)');
assertEq(isTestMarketVariant('Incredible Hulk', '200', '30¢'), true, 'Hulk #200 (anniversary)');
assertEq(isTestMarketVariant('Eternals', '1', '30¢'), true, 'Eternals #1 (Kirby)');
assertEq(isTestMarketVariant('Iron Fist', '5', '30¢'), true, 'Iron Fist #5 (pre-MTU crossover)');
assertEq(isTestMarketVariant('Marvel Team-Up', '45', '30¢'), true, 'Marvel Team-Up #45 (hyphen normalized)');
assertEq(isTestMarketVariant('Marvel Two-in-One', '17', '30¢'), true, 'Marvel Two-in-One #17 (multi-hyphen)');
assertEq(isTestMarketVariant('Sgt. Fury', '133', '30¢'), true, 'Sgt. Fury #133 (short alias)');
assertEq(isTestMarketVariant('Sgt Fury and His Howling Commandos', '133', '30¢'), true, 'Sgt Fury #133 (long alias)');
assertEq(isTestMarketVariant('Mighty Marvel Western', '45', '30¢'), true, 'Mighty Marvel Western #45 (single-issue entry)');

// ─── 30¢ DENY cases ─────────────────────────────────────────────────
console.log('\nDENY cases (out of 1976 window):');
assertEq(isTestMarketVariant('Amazing Spider-Man', '155', '35¢'), false, 'ASM #155 in 35¢ bucket (wrong era — was 30¢)');
assertEq(isTestMarketVariant('Amazing Spider-Man', '169', '30¢'), false, 'ASM #169 in 30¢ bucket (wrong era — was 35¢)');
assertEq(isTestMarketVariant('X-Men', '101', '30¢'), false, 'X-Men #101 (off-by-one after window)');
assertEq(isTestMarketVariant('X-Men', '97', '30¢'), false, 'X-Men #97 (off-by-one before window)');
assertEq(isTestMarketVariant('Star Wars', '1', '30¢'), false, 'Star Wars #1 not in 30¢ (1977 launch — only 35¢ era)');
assertEq(isTestMarketVariant('Ka-Zar', '16', '30¢'), false, 'Ka-Zar #16 (excluded — entire run was 30¢)');
assertEq(isTestMarketVariant('Inhumans', '5', '30¢'), false, 'Inhumans #5 (excluded — entire run was 30¢)');

// ─── 30¢ EDGE cases ─────────────────────────────────────────────────
console.log('\nEDGE cases:');
assertEq(isTestMarketVariant('Adventures on the Planet of the Apes', '5', '30¢'), true, 'Long title with multiple words');
assertEq(isTestMarketVariant('Skull, the Slayer', '5', '30¢'), true, 'Comma-stripped title');
assertEq(isTestMarketVariant('Two-Gun Kid', '129', '30¢'), true, 'Hyphenated title (normalized)');
assertEq(isTestMarketVariant('Iron Fist', '14', 'unknown-bucket'), false, 'Unknown variant key — safe deny');
assertEq(isTestMarketVariant('Iron Fist', '14', '30¢'), false, 'Iron Fist #14 in 30¢ bucket (wrong era — was 35¢)');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:\n' + failures.join('\n'));
  process.exit(1);
}
process.exit(0);
