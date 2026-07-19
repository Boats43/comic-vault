// tests/q112-year-resolution.test.js
//
// Q112 dispatch (2026-07-18) — Batman #608 class: year resolution used the
// matched ComicVine VOLUME's start_year (series launch year) instead of the
// matched ISSUE's own cover_date. Batman vol. 1 started 1940; issue #608
// (Hush, 2002) is 62 years later. Structural bug — exposed any long-running
// ongoing series whenever no Vision/user year was present on the request
// (resolveYear's `!userYear ||` branches accept PC/CV years unconditionally
// in that case).
//
// Fix: deriveCvYear (src/lib/identityCore.js) derives the ComicVine year
// from `coverDate` (issue-level, "YYYY-MM-DD") — never `startYear`
// (volume-level) — with no fallback to startYear when coverDate is
// unavailable (a wrong-but-present value is worse than falling through to
// resolveYear's other sources).
//
// Scope note: this fix is deliberately narrow (core fix only, per ruling).
// The dead era-gate (api/enrich.js ~2893-2909, reads the wrong
// comicVine?.volume?.startYear shape and never fires) is a SEPARATE,
// queued follow-up — not exercised here.
//
// Invoke: node tests/q112-year-resolution.test.js

import { deriveCvYear, resolveYear } from '../src/lib/identityCore.js';

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

console.log('\n=== Q112 — YEAR RESOLUTION (Batman #608 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE A — Batman #608 (Hush, 2002): reconstructed lookupComicVine
// return shape exactly as api/enrich.js:1093-1106 produces it.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture A: Batman #608 — deriveCvYear');

const batman608ComicVine = {
  id: 12345,
  name: 'Batman',
  issueNumber: '608',
  volume: 'Batman',
  volumeId: 797,
  publisher: 'DC Comics',
  startYear: 1940, // volume start_year — the OLD (buggy) source
  coverDate: '2002-01-01', // issue cover_date — the FIX's source
  description: null,
  deck: null,
};

assertEq(deriveCvYear(batman608ComicVine), 2002, 'deriveCvYear returns 2002 (issue cover_date), NOT 1940 (volume start_year)');
assertEq(deriveCvYear(batman608ComicVine) === batman608ComicVine.startYear, false, 'deriveCvYear does NOT equal the volume start_year');

// End-to-end: resolveYear with the FIXED cvYear, no Vision/user year on the
// request (the exact condition that exposed the bug — resolveYear's
// !userYear branches accept PC/CV years unconditionally when userYear is
// absent, so a wrong cvYear here would have silently won).
const batman608Resolution = resolveYear(null /* no Vision/user year */, null /* no PC match */, deriveCvYear(batman608ComicVine), null);
assertEq(batman608Resolution.confirmedYear, '2002', 'resolveYear (no user year present) resolves to 2002 using the fixed cvYear');
assertEq(batman608Resolution.yearSource, 'comicvine', 'yearSource = comicvine (branch d — no user year to compare against, cvYear wins)');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE B — contrast: demonstrate the OLD bug would have fired had
// startYear still been fed in (proves resolveYear's own logic is correct
// GIVEN correct input — the bug was entirely in what value reached it).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture B: contrast — the old (buggy) cvYear source, same resolveYear logic');

const oldBuggyCvYear = batman608ComicVine.startYear; // what enrich.js used to pass in
const oldBugResolution = resolveYear(null, null, oldBuggyCvYear, null);
assertEq(oldBugResolution.confirmedYear, '1940', 'OLD behavior (pre-fix): resolveYear would have wrongly resolved to 1940 given the old cvYear source — confirms the bug lived in cvYear derivation, not resolveYear itself');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE C — no coverDate available: must return null, NOT fall back to
// startYear (a wrong-but-present value is worse than falling through to
// resolveYear's other sources).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture C: no coverDate available — null, no startYear fallback');

assertEq(deriveCvYear({ startYear: 1940, coverDate: null }), null, 'no coverDate → null (does NOT fall back to startYear)');
assertEq(deriveCvYear({ startYear: 1940 }), null, 'coverDate absent entirely → null');
assertEq(deriveCvYear(null), null, 'null comicVine → null, no crash');
assertEq(deriveCvYear(undefined), null, 'undefined comicVine → null, no crash');
assertEq(deriveCvYear({ coverDate: 'not-a-date' }), null, 'malformed coverDate → null, no crash (NaN guarded)');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE D — structural: the fix generalizes to every long-running
// ongoing series named in the dispatch, not just Batman.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture D: structural — other long-running ongoing series');

const otherSeries = [
  { name: 'Detective Comics #27 (2016 New 52 relaunch numbering)', startYear: 1937, coverDate: '2016-05-01', expected: 2016 },
  { name: 'Action Comics #1000', startYear: 1938, coverDate: '2018-06-01', expected: 2018 },
  { name: 'Superman vol. 1 #400', startYear: 1939, coverDate: '1984-10-01', expected: 1984 },
  { name: 'Amazing Spider-Man vol. 1 #300', startYear: 1963, coverDate: '1988-05-01', expected: 1988 },
  { name: 'Fantastic Four vol. 1 #500', startYear: 1961, coverDate: '2003-08-01', expected: 2003 },
];
for (const s of otherSeries) {
  const derived = deriveCvYear({ startYear: s.startYear, coverDate: s.coverDate });
  assertEq(derived, s.expected, `${s.name}: deriveCvYear = ${s.expected} (issue year), not ${s.startYear} (series launch)`);
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
