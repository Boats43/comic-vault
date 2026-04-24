// Unit tests for Ship #11 — era-aware CGC / RAW grade multipliers.
// Year >= 1985 → modern (damped). Year < 1985 → vintage (unchanged).
// Null / 0 / missing year → vintage (safe default).
//
// Invoke: node tests/era-multipliers.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  CGC_MULTIPLIERS,
  RAW_MULTIPLIERS,
  getEra,
  getGradeMultiplier,
  getRawGradeMultiplier,
} from '../api/enrich.js';
import { hasIssueNumber } from '../api/comps.js';

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

console.log('\n=== SHIP #11 — ERA-AWARE GRADE MULTIPLIERS ===\n');

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof CGC_MULTIPLIERS.vintage, 'object', 'CGC_MULTIPLIERS.vintage exists');
assertEq(typeof CGC_MULTIPLIERS.modern, 'object', 'CGC_MULTIPLIERS.modern exists');
assertEq(typeof RAW_MULTIPLIERS.vintage, 'object', 'RAW_MULTIPLIERS.vintage exists');
assertEq(typeof RAW_MULTIPLIERS.modern, 'object', 'RAW_MULTIPLIERS.modern exists');
assertEq(
  Object.keys(CGC_MULTIPLIERS.vintage).length,
  Object.keys(CGC_MULTIPLIERS.modern).length,
  'CGC vintage/modern have same grade keys'
);
assertEq(
  Object.keys(RAW_MULTIPLIERS.vintage).length,
  Object.keys(RAW_MULTIPLIERS.modern).length,
  'RAW vintage/modern have same tier keys'
);

// ─── getEra() — boundary + null handling ────────────────────────────
console.log('\ngetEra() boundaries:');
assertEq(getEra(1938), 'vintage', 'Action Comics era (1938) → vintage');
assertEq(getEra(1974), 'vintage', 'Hulk #181 era (1974) → vintage');
assertEq(getEra(1984), 'vintage', '1984 boundary (just before Crisis) → vintage');
assertEq(getEra(1985), 'modern', '1985 boundary (Crisis) → modern');
assertEq(getEra(1986), 'modern', '1986 → modern');
assertEq(getEra(1992), 'modern', 'Image founding (1992) → modern');
assertEq(getEra(2021), 'modern', '2021 → modern');
assertEq(getEra(null), 'vintage', 'null year → vintage (safe default)');
assertEq(getEra(undefined), 'vintage', 'undefined year → vintage');
assertEq(getEra(0), 'vintage', 'year=0 → vintage');
assertEq(getEra(''), 'vintage', 'empty string → vintage');
assertEq(getEra('1985'), 'modern', 'string "1985" → modern (parseInt handles)');
assertEq(getEra('1974'), 'vintage', 'string "1974" → vintage');

// ─── CGC GRADED — vintage unchanged ─────────────────────────────────
console.log('\nCGC graded — vintage (unchanged from pre-ship):');
assertEq(getGradeMultiplier(2.0, 1938).multiplier, 0.45, 'Action #1 (1938) CGC 2.0 → 0.45×');
assertEq(getGradeMultiplier(9.4, 1974).multiplier, 2.2, 'Hulk #181 (1974) CGC 9.4 → 2.2×');
assertEq(getGradeMultiplier(9.4, 1984).multiplier, 2.2, '1984 boundary CGC 9.4 → 2.2×');
assertEq(getGradeMultiplier(9.8, 1960).multiplier, 5.0, 'Silver Age CGC 9.8 → 5.0×');
assertEq(getGradeMultiplier(10, 1950).multiplier, 12.0, 'Golden Age CGC 10 → 12.0×');
assertEq(getGradeMultiplier(8.5, 1972).multiplier, 1.3, 'Bronze VF+ 8.5 → 1.3× (vintage)');
assertEq(getGradeMultiplier(9.4, 1938).era, 'vintage', 'era tagged vintage on response');

// ─── CGC GRADED — modern damped ─────────────────────────────────────
console.log('\nCGC graded — modern (damped):');
assertEq(getGradeMultiplier(9.4, 1985).multiplier, 1.35, '1985 boundary CGC 9.4 → 1.35×');
assertEq(getGradeMultiplier(9.4, 1992).multiplier, 1.35, 'Dark Horse #1 era CGC 9.4 → 1.35×');
assertEq(getGradeMultiplier(9.4, 2002).multiplier, 1.35, 'Wolverine/Hulk #1 (2002) CGC 9.4 → 1.35×');
assertEq(getGradeMultiplier(9.4, 2021).multiplier, 1.35, 'US of Cap #1 (2021) CGC 9.4 → 1.35×');
assertEq(getGradeMultiplier(9.8, 1988).multiplier, 2.2, 'ASM #300 (1988) CGC 9.8 → 2.2× (was 5.0×)');
assertEq(getGradeMultiplier(8.5, 1992).multiplier, 1.05, 'Dark Horse #1 VF+ 8.5 → 1.05× (was 1.3×)');
assertEq(getGradeMultiplier(10, 2020).multiplier, 3.0, 'Modern CGC 10 → 3.0× (was 12.0×)');
assertEq(getGradeMultiplier(9.6, 2000).multiplier, 1.6, 'Modern CGC 9.6 → 1.6× (was 3.0×)');
assertEq(getGradeMultiplier(9.2, 2018).multiplier, 1.2, 'Modern CGC 9.2 → 1.2× (was 1.8×)');
assertEq(getGradeMultiplier(9.4, 2002).era, 'modern', 'era tagged modern on response');

// ─── CGC GRADED — null / edge year ──────────────────────────────────
console.log('\nCGC graded — null / edge year → vintage default:');
assertEq(getGradeMultiplier(9.4, null).multiplier, 2.2, 'null year CGC 9.4 → 2.2× (vintage)');
assertEq(getGradeMultiplier(9.4, undefined).multiplier, 2.2, 'undefined year CGC 9.4 → 2.2×');
assertEq(getGradeMultiplier(9.4, 0).multiplier, 2.2, 'year=0 CGC 9.4 → 2.2×');
assertEq(getGradeMultiplier(9.4).multiplier, 2.2, 'no year arg → 2.2× (vintage default)');

// ─── RAW — vintage unchanged ────────────────────────────────────────
console.log('\nRAW — vintage (unchanged):');
assertEq(getRawGradeMultiplier('NM', 1973).multiplier, 1.0, 'Vintage NM → 1.00×');
assertEq(getRawGradeMultiplier('VF', 1968).multiplier, 0.75, 'Vintage VF → 0.75×');
assertEq(getRawGradeMultiplier('FN', 1965).multiplier, 0.55, 'Vintage FN → 0.55×');
assertEq(getRawGradeMultiplier('VG', 1960).multiplier, 0.45, 'Vintage VG → 0.45×');
assertEq(getRawGradeMultiplier('GD', 1942).multiplier, 0.30, 'Vintage GD → 0.30×');
assertEq(getRawGradeMultiplier('PR', 1950).multiplier, 0.15, 'Vintage PR → 0.15×');

// ─── RAW — modern damped (upper curve) ──────────────────────────────
console.log('\nRAW — modern (damped upper curve):');
assertEq(getRawGradeMultiplier('NM', 2020).multiplier, 0.90, 'Modern NM → 0.90× (was 1.00×)');
assertEq(getRawGradeMultiplier('NM/M', 2020).multiplier, 0.90, 'Modern NM/M → 0.90×');
assertEq(getRawGradeMultiplier('VF/NM', 2015).multiplier, 0.78, 'Modern VF/NM → 0.78×');
assertEq(getRawGradeMultiplier('VF', 2018).multiplier, 0.70, 'Modern VF → 0.70× (was 0.75×)');
assertEq(getRawGradeMultiplier('FN', 2010).multiplier, 0.50, 'Modern FN → 0.50× (was 0.55×)');
assertEq(getRawGradeMultiplier('VG', 2005).multiplier, 0.40, 'Modern VG → 0.40× (was 0.45×)');
assertEq(getRawGradeMultiplier('VG/G', 2010).multiplier, 0.36, 'Modern VG/G → 0.36×');

// ─── RAW — modern flat tail (≤ GD/VG) ───────────────────────────────
console.log('\nRAW — modern flat tail (sub-VG/G unchanged):');
assertEq(getRawGradeMultiplier('GD/VG', 1995).multiplier, 0.35, 'Modern GD/VG → 0.35× (flat vs vintage)');
assertEq(getRawGradeMultiplier('GD', 1995).multiplier, 0.30, 'Modern GD → 0.30× (flat)');
assertEq(getRawGradeMultiplier('FR/GD', 2010).multiplier, 0.25, 'Modern FR/GD → 0.25× (flat)');
assertEq(getRawGradeMultiplier('FR', 2010).multiplier, 0.20, 'Modern FR → 0.20× (flat)');
assertEq(getRawGradeMultiplier('PR', 2010).multiplier, 0.15, 'Modern PR → 0.15× (flat)');
assertEq(
  RAW_MULTIPLIERS.vintage['GD'],
  RAW_MULTIPLIERS.modern['GD'],
  'GD tier: modern === vintage (flat tail assertion)'
);
assertEq(
  RAW_MULTIPLIERS.vintage['PR'],
  RAW_MULTIPLIERS.modern['PR'],
  'PR tier: modern === vintage (flat tail assertion)'
);

// ─── RAW — null year → vintage ──────────────────────────────────────
console.log('\nRAW — null year → vintage default:');
assertEq(getRawGradeMultiplier('NM', null).multiplier, 1.0, 'null year NM → 1.00× (vintage)');
assertEq(getRawGradeMultiplier('VF').multiplier, 0.75, 'no year arg VF → 0.75× (vintage)');
assertEq(getRawGradeMultiplier('VG', 0).multiplier, 0.45, 'year=0 VG → 0.45× (vintage)');

// ─── Raw grade string with numeric (e.g. "VG 4.0") ──────────────────
console.log('\nRAW — numeric grade strings route via CGC table:');
assertEq(getRawGradeMultiplier('VG 4.0', 1970).multiplier, 0.65, 'Vintage "VG 4.0" → 0.65× (CGC 4.0 vintage)');
assertEq(getRawGradeMultiplier('VG 4.0', 2010).multiplier, 0.55, 'Modern "VG 4.0" → 0.55× (CGC 4.0 modern)');
assertEq(getRawGradeMultiplier('FR 1.0', 1960).multiplier, 0.3, 'Vintage "FR 1.0" → 0.3× (CGC 1.0)');

// ─── Era tag present on response ────────────────────────────────────
console.log('\nEra tag on response:');
assertEq(getRawGradeMultiplier('NM', 1973).era, 'vintage', 'raw response includes era=vintage');
assertEq(getRawGradeMultiplier('NM', 2020).era, 'modern', 'raw response includes era=modern');
assertEq(getRawGradeMultiplier('NM', null).era, 'vintage', 'null year → era=vintage');

// ─── Regression check — vintage table fully intact ──────────────────
console.log('\nRegression — every vintage CGC multiplier matches pre-ship value:');
const preShipVintage = {
  10: 12.0, 9.9: 8.0, 9.8: 5.0, 9.6: 3.0, 9.4: 2.2, 9.2: 1.8,
  9.0: 1.5, 8.5: 1.3, 8.0: 1.15, 7.5: 1.05, 7.0: 1.0, 6.5: 0.9,
  6.0: 0.85, 5.5: 0.8, 5.0: 0.75, 4.5: 0.7, 4.0: 0.65, 3.5: 0.6,
  3.0: 0.55, 2.5: 0.5, 2.0: 0.45, 1.8: 0.4, 1.5: 0.35, 1.0: 0.3,
  0.5: 0.2,
};
for (const [g, mult] of Object.entries(preShipVintage)) {
  assertEq(CGC_MULTIPLIERS.vintage[g], mult, `vintage CGC ${g} === ${mult} (pre-ship)`);
}

console.log('\nRegression — every vintage RAW multiplier matches pre-ship value:');
const preShipVintageRaw = {
  "NM": 1.0, "NM/M": 1.0, "VF/NM": 0.85, "VF": 0.75, "VF/F": 0.70,
  "FN/VF": 0.65, "FN": 0.55, "VG/FN": 0.50, "VG": 0.45, "VG/G": 0.40,
  "GD/VG": 0.35, "GD": 0.30, "FR/GD": 0.25, "FR": 0.20, "PR": 0.15,
};
for (const [t, mult] of Object.entries(preShipVintageRaw)) {
  assertEq(RAW_MULTIPLIERS.vintage[t], mult, `vintage RAW ${t} === ${mult} (pre-ship)`);
}

// Ship #13 Bug 5 — issue-number word-boundary regression pins. The
// existing `\b`-anchored regex in hasIssueNumber already rejects #11
// against a #1 search; these pins prevent future regression of the
// Sensation #1 / Comics #11 filter-leak class of bug.
console.log('\nShip #13 Bug 5 — issue# word-boundary regression pins:');
assertEq(hasIssueNumber('Sensation Comics #11 CGC 8.0', '1'), false,
  'Sensation #11 must NOT match #1 search');
assertEq(hasIssueNumber('Book #10 CGC 9.0', '1'), false,
  '#10 must NOT match #1 search');
assertEq(hasIssueNumber('Title #100 CGC 9.8', '1'), false,
  '#100 must NOT match #1 search');
assertEq(hasIssueNumber('Sensation Comics #1 CGC 9.0', '1'), true,
  'Sensation #1 still matches #1 search (positive control)');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
