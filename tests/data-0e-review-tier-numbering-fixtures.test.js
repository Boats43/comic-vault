// tests/data-0e-review-tier-numbering-fixtures.test.js
//
// DATA-0E — REVIEW tier founding fixtures. These are the 35
// SAME_SERIES_DIFFERENT_ISSUE pairs DATA-0D found in its 1,116-issue
// stratified sample (docs/DATA-0D-CROSSWALK-VALIDATION.md) — real GCD/
// Metron pairs describing the identical physical comic, where only the
// ISSUE NUMBER STRING differs because of a systematic GCD numbering
// convention (never genuine identity confusion — see the DATA-0D doc's
// own accounting). DATA-0E queues these as REVIEW tier: labeled with a
// convention class, no gkIssueId minted.
//
// This file is the GATE the dispatch specified: "the numbering normalizer
// that eventually promotes them must pass all 35 with their documented
// resolutions before any promotion runs." No such normalizer exists yet —
// this file intentionally has nothing to run against, the same shape as
// grailkey-dispatch-33-parity-harness.test.js's own deliberate stub
// (CLAUDE.md's own precedent: "0 passed, 0 failed, N skipped" is not a
// failure signal here, it's the documented state until a real numbering
// normalizer is built and registered below).
//
// To promote any of these 3 convention classes into AUTO-MINT:
//   1. Write the real normalizer function (e.g.
//      normalizeGcdLegacyParentheticalNumber, normalizeGcdNnPlaceholder,
//      normalizeGcdAlternateNumberingAxis) in src/lib/ — NOT in this file.
//   2. Import it below and set NORMALIZERS[conventionClass] to it.
//   3. Run this file. Every one of the 35 fixtures for that class must
//      pass (normalizer(gcd.number) === normalizer-equivalent(metron.number),
//      by whatever comparison the normalizer itself defines) before the
//      promotion is considered proven — not "most," not "the common
//      shape," all 35.
//   4. Only then does DATA-0E's own mint script gain a new comparison
//      tier for that convention class.
//
// Invoke: node tests/data-0e-review-tier-numbering-fixtures.test.js

// ---- Registration point for future normalizers. Empty until built. ----
const NORMALIZERS = {
  // 'gcd-legacy-parenthetical-numbering': (gcdNumber, metronNumber) => { ... },
  // 'gcd-nn-bracket-placeholder': (gcdNumber, metronNumber) => { ... },
  // 'gcd-alternate-numbering-axis': (gcdNumber, metronNumber) => { ... },
};

// ---- The 35 founding fixtures, verbatim from the real DATA-0D sample. ----
const FIXTURES = [
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: 'Adventure Comics', number: '1' }, gcd: { series: 'Adventure Comics', number: '1 / 504' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: 'Adventure Comics', number: '2' }, gcd: { series: 'Adventure Comics', number: '2 / 505' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: 'Adventure Comics', number: '3' }, gcd: { series: 'Adventure Comics', number: '3 / 506' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '52' }, gcd: { series: 'Amazing Spider-Man', number: '52 (853)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '53' }, gcd: { series: 'Amazing Spider-Man', number: '53 (854)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '55' }, gcd: { series: 'Amazing Spider-Man', number: '55 (856)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '56' }, gcd: { series: 'Amazing Spider-Man', number: '56 (857)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '58' }, gcd: { series: 'Amazing Spider-Man', number: '58 (859)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '60' }, gcd: { series: 'Amazing Spider-Man', number: '60 (861)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'The Amazing Spider-Man', number: '62' }, gcd: { series: 'Amazing Spider-Man', number: '62 (863)' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: 'Action Comics', number: '1000000' }, gcd: { series: 'Action Comics', number: '1,000,000' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: "'68 Jungle Jim: Guts N Glory", number: '1' }, gcd: { series: "'68 Jungle Jim: Guts 'n Glory One-Shot", number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: "'68 Jungle Jim", number: '1' }, gcd: { series: "'68: Jungle Jim", number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: 'Alvin', number: '1' }, gcd: { series: 'Alvin', number: '[1]' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '19' }, gcd: { series: 'Abe Sapien', number: '19 (29)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '20' }, gcd: { series: 'Abe Sapien', number: '20 (30)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '22' }, gcd: { series: 'Abe Sapien', number: '22 (32)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '23' }, gcd: { series: 'Abe Sapien', number: '23 (33)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '24' }, gcd: { series: 'Abe Sapien', number: '24 (34)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '25' }, gcd: { series: 'Abe Sapien', number: '25 (35)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '28' }, gcd: { series: 'Abe Sapien', number: '28 (38)' } },
  { conventionClass: 'gcd-legacy-parenthetical-numbering', metron: { series: 'Abe Sapien', number: '29' }, gcd: { series: 'Abe Sapien', number: '29 (39)' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: 'A Flight of Angels', number: '1' }, gcd: { series: 'A Flight of Angels', number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: "A Man's Skin", number: '1' }, gcd: { series: "A Man's Skin", number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: 'Adventure Time: Banana Guard Academy', number: '1' }, gcd: { series: 'Adventure Time: Banana Guard Academy', number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: "'68 Compendium", number: '1' }, gcd: { series: "'68 Compendium", number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: '10 Tons of Fun Preview: Free Comic Book Day 2021', number: '1' }, gcd: { series: '10 Tons of Fun Preview: Free Comic Book Day 2021', number: '[nn]' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: '365 Samurai and a Few Bowls of Rice', number: '1' }, gcd: { series: '365 Samurai and a Few Bowls of Rice', number: '[nn]' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: '2000 AD Annual', number: '2' }, gcd: { series: '2000 AD Annual', number: '1979' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: '2000 AD Annual', number: '14' }, gcd: { series: '2000 AD Annual', number: '1991' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: "All New Collectors' Edition", number: '55' }, gcd: { series: "All New Collectors' Edition", number: 'C-55' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: "All New Collectors' Edition", number: '54' }, gcd: { series: "All New Collectors' Edition", number: 'C-54' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: "All New Collectors' Edition", number: '58' }, gcd: { series: "All New Collectors' Edition", number: 'C-58' } },
  { conventionClass: 'gcd-alternate-numbering-axis', metron: { series: "All New Collectors' Edition", number: '60' }, gcd: { series: "All New Collectors' Edition", number: 'C-60' } },
  { conventionClass: 'gcd-nn-bracket-placeholder', metron: { series: '30 Days of Night Annual 2005', number: '2' }, gcd: { series: '30 Days of Night Annual 2005', number: '[nn]' } },
];

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log(`\n=== DATA-0E REVIEW-tier founding fixtures: ${FIXTURES.length} cases ===\n`);
assertTrue(FIXTURES.length === 35, `exactly 35 founding fixtures present (DATA-0D's own count) — got ${FIXTURES.length}`);

const byClass = {};
for (const f of FIXTURES) byClass[f.conventionClass] = (byClass[f.conventionClass] || 0) + 1;
console.log('  by convention class:', JSON.stringify(byClass));

const registeredClasses = Object.keys(NORMALIZERS);
if (registeredClasses.length === 0) {
  console.log('\n  0 normalizers registered — this is the documented, expected state until a real');
  console.log('  numbering normalizer is built (see this file\'s own header for the promotion steps).');
  skipped = FIXTURES.length;
} else {
  for (const f of FIXTURES) {
    const normalizer = NORMALIZERS[f.conventionClass];
    if (!normalizer) { skipped++; continue; }
    const result = normalizer(f.gcd.number, f.metron.number);
    assertTrue(result === true, `[${f.conventionClass}] "${f.gcd.series}" GCD "${f.gcd.number}" vs Metron "${f.metron.number}" — normalizer resolves as same issue`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped-pending-normalizer ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
