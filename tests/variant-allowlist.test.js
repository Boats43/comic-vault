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
const TEST_MARKET_35C = {
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
  'kull the conqueror': [21, 22, 23],
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
};

const isTestMarketVariant = (title, issue) => {
  const titleKey = normalizeTitle(title);
  if (!titleKey) return false;
  const issueNum = parseInt(String(issue || '').trim(), 10);
  if (isNaN(issueNum)) return false;
  const allowed = TEST_MARKET_35C[titleKey];
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

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:\n' + failures.join('\n'));
  process.exit(1);
}
process.exit(0);
