// tests/q142-assembly-integrity-family-population.test.js
//
// Q142 dispatch (2026-07-22) — Adventure Time Summer Special (SDCC) live
// rescan on build 93f7ee2 (Q140/Q141's own deploy) confirmed Q140 fires
// correctly ([title-family] selected="adventure time summer special",
// [q140] family-scoped issue: "#1") but the win never survives into
// out.confirmedTitle: [22e-LOSS] FAIL: excess non-consensus tokens —
// vision="Adventure Time" assembled="adventure time summer special"
// added=[summer,special] non-consensus=[summer,special], forcing a revert
// to bare "Adventure Time" four lines later. Root cause: Ship #22e's
// checkAssemblyIntegrity Rule 2 (identityCore.js) measures whether an
// added token clears 60% consensus against compTitles — and the
// api/enrich.js call site always passed the FULL, possibly-ambiguous
// visual pool (parsedVisualRows), never the specific family that just won
// the override. Within the winning 5-member SDCC family, "summer"/
// "special" are 5/5 = 100% consensus; against the full 19-item production
// pool (which by construction contains a DIFFERENT "Adventure Time"
// product, since that's the whole ambiguous-stem shape) they read as
// ~26% "non-consensus" — the identical "measuring coherence against the
// wrong population" bug Q140 already fixed at the Q84 gate, reproduced
// independently at this second, unrelated choke point downstream of it.
//
// Fix: api/enrich.js now builds integrityCompTitles from the winning
// family's own members (familyCandidate.topFamily.indices mapped back
// into parsedVisualRows) when familyCandidate.decision is a
// FAMILY_OVERRIDE_DECISIONS win with a real topFamily, falling back to
// the full pool for every other path (byte-identical there). The global
// 60%-consensus threshold inside checkAssemblyIntegrity itself is
// untouched — only the population it's measured against changed.
//
// This file tests checkAssemblyIntegrity directly (the pure function the
// fix's population-selection logic feeds) plus a smaller-pool
// reconstruction of the real bug and its fix. The population-selection
// logic itself lives inline in api/enrich.js's ~11,800-line handler
// (no pure extraction) — verified via the live rescan citations in
// docs/LAUNCH-AUDIT.md instead, per this campaign's established
// convention for inline-handler gates.
//
// Invoke: node tests/q142-assembly-integrity-family-population.test.js

import { checkAssemblyIntegrity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q142 — assembly-integrity population source ===\n');

const SDCC_FAMILY = [
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 VF',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 High Grade',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 In Hand',
];
const KABOOM_FAMILY = [
  'Adventure Time #1 KaBOOM 2012',
  'Adventure Time #1 KaBOOM 2012 NM',
  'Adventure Time #1 KaBOOM Comics',
  'Adventure Time #1 VF 2012',
  'Adventure Time #1 2012 High Grade',
];

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — reproduces the exact production bug: full-pool population
// forces a revert of a correct family override.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: full-pool population (pre-Q142 behavior) — reproduces the bug\n');
{
  const fullPool = [...SDCC_FAMILY, ...KABOOM_FAMILY];
  const r = checkAssemblyIntegrity('Adventure Time', 'adventure time summer special', fullPool);
  assertTrue(r.shouldFallback, `full-pool population forces fallback (bug reproduced): reason=${r.reason}`);
  assertEq(r.reason, 'excess-non-consensus-tokens', 'reason is excess-non-consensus-tokens');
  assertTrue(r.added.includes('summer') && r.added.includes('special'), `"summer"/"special" flagged as excess (got [${r.added.join(',')}])`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — winning-family-only population (Q142 fix) — the same override
// now survives.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: winning-family population (Q142 fix) — override survives\n');
{
  const r = checkAssemblyIntegrity('Adventure Time', 'adventure time summer special', SDCC_FAMILY);
  assertFalse(r.shouldFallback, `winning-family population (5/5 members) does NOT force fallback`);
  assertTrue(r.intact, 'integrity check reports intact');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — control: a GENUINE excess-token bug (not a coherent family
// win) must still be caught. Reuses the family's own member set, but the
// added tokens are scattered within it (only 1/5 members carry them) —
// proves this isn't a blanket "always trust the family" bypass; Rule 2's
// 60% threshold is untouched, only the population changed.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: control — scattered addition within a family still caught\n');
{
  const scatteredFamily = [
    'Adventure Time Summer Special #1 2013',
    'Adventure Time Summer Special #1 2013 NM',
    'Adventure Time Summer Special #1 2013 VF',
    'Adventure Time Summer Special #1 2013 High Grade',
    'Adventure Time Summer Special #1 SDCC Sketch Variant Exclusive 2013', // lone outlier
  ];
  // Rule 2 only fires when >=2 tokens fail the 60% consensus bar (mirrors
  // Bug B1's own docstring: "≥2 tokens added that don't appear in ≥60% of
  // comp titles"). "sdcc"/"sketch" both appear in only 1/5 members here.
  const r = checkAssemblyIntegrity('Adventure Time', 'adventure time summer special sdcc sketch', scatteredFamily);
  assertTrue(r.shouldFallback, `scattered additions ("sdcc","sketch", 1/5 members each) still force fallback within a family population (reason=${r.reason})`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — control: missing-Vision-token behavior (Rule 1) is untouched
// by this fix — same function, different rule, not in Q142's scope.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: control — Rule 1 (missing Vision tokens) unaffected\n');
{
  const r = checkAssemblyIntegrity('X-Men', 'men timeless', ['X-Men Timeless #1 Marvel', 'X-Men Timeless #1 NM', 'X-Men Timeless #1 VF']);
  assertTrue(r.shouldFallback && r.reason === 'missing-vision-tokens', `Rule 1 (E3 class, "x" dropped) still fires (reason=${r.reason})`);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
