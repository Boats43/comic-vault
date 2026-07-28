// tests/q141a-canonical-title-projection.test.js
//
// COMMIT A (2026-07-28) — canonical catalog-title projection.
//
// Real production evidence (Batman #15, build e22e600): the accepted PC
// anchor's own name was "Batman #15 (1943)" (`[ship28a] PC anchors:
// id=2315874 name="Batman #15 (1943)"`, `[pc-query] initial PC match
// "Batman #15 (1943)" already overlaps confirmedTitle "batman machine gun"
// sufficiently — keeping initial result`), yet confirmedTitle stayed
// "batman machine gun" (title-family clustering's assembled string) all the
// way through active-comp search, sold-comp filtering, and out.title — the
// anchor's own clean name never won even though it was accepted.
//
// projectCanonicalTitleFromAnchor(anchorProductName) strips only the
// structural suffix every anchor name carries (trailing "(YYYY)" and/or
// trailing "#N") — no stopword list, no length heuristic — so it works
// identically whether the anchor's own official title has an issue number
// (ongoing series) or not (a special/one-shot whose own title has no #N).
//
// Invoke: node tests/q141a-canonical-title-projection.test.js

import { projectCanonicalTitleFromAnchor, diffEditionDescriptorCandidate } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== COMMIT A — projectCanonicalTitleFromAnchor / diffEditionDescriptorCandidate ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — projectCanonicalTitleFromAnchor, real anchor names
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: real anchor names\n');

assertEq(
  projectCanonicalTitleFromAnchor('Batman #15 (1943)'),
  'Batman',
  'real Batman #15 PC anchor name -> "Batman" (the exact production defect)'
);
assertEq(
  projectCanonicalTitleFromAnchor('Flash #128 (1962)'),
  'Flash',
  'real Flash #128 PC anchor name -> "Flash"'
);
assertEq(
  projectCanonicalTitleFromAnchor('Immortal Hulk #44 (2021)'),
  'Immortal Hulk',
  'real Immortal Hulk #44 PC anchor name -> "Immortal Hulk"'
);
assertEq(
  projectCanonicalTitleFromAnchor('Adventure Time #1 (2012)'),
  'Adventure Time',
  'real Adventure Time PC anchor name (base ongoing series, rejected in production by pc-anchor-gate, but the strip logic itself) -> "Adventure Time"'
);
assertEq(
  projectCanonicalTitleFromAnchor('Adventure Time: The Bubbline College Special (2025)'),
  'Adventure Time: The Bubbline College Special',
  'a special/one-shot whose own official catalog title has NO issue number — survives whole, not truncated to a short generic form (no stopword list, no length heuristic)'
);
assertEq(
  projectCanonicalTitleFromAnchor('Wonder Woman'),
  'Wonder Woman',
  'no issue, no year suffix at all — passes through unchanged'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — edge cases
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: edge cases\n');

assertEq(projectCanonicalTitleFromAnchor(''), null, 'empty string -> null');
assertEq(projectCanonicalTitleFromAnchor(null), null, 'null -> null');
assertEq(projectCanonicalTitleFromAnchor(undefined), null, 'undefined -> null');
assertEq(projectCanonicalTitleFromAnchor('   '), null, 'whitespace-only -> null');
assertEq(projectCanonicalTitleFromAnchor('#15 (1943)'), null, 'title IS just the suffix tokens -> null (fail closed, never an empty-string canonical title)');
assertEq(
  projectCanonicalTitleFromAnchor('Batman #15A (1943)'),
  'Batman',
  'lettered sub-issue "#15A" still stripped'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — diffEditionDescriptorCandidate
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: diffEditionDescriptorCandidate\n');

assertEq(
  diffEditionDescriptorCandidate('batman machine gun', 'Batman'),
  'machine gun',
  'real Batman #15 case: family-cluster assembled "batman machine gun" vs canonical "Batman" -> extra "machine gun" surfaced, not silently dropped'
);
assertEq(
  diffEditionDescriptorCandidate('batman machine gun ww2', 'Batman'),
  'machine gun ww2',
  'the fuller pre-sanitization assembled string ("machine gun ww2") also diffs cleanly'
);
assertEq(
  diffEditionDescriptorCandidate('adventure time summer special', 'Adventure Time: The Bubbline College Special'),
  'summer',
  'assembled title vs a different real special title — reports only the genuinely non-overlapping token ("special" appears in both, so it is correctly excluded); no judgment call about which title is "more correct"'
);
assertEq(
  diffEditionDescriptorCandidate('Batman', 'Batman'),
  null,
  'assembled title already equals canonical — no descriptor candidate, not an empty string'
);
assertEq(diffEditionDescriptorCandidate('', 'Batman'), null, 'empty assembled title -> null, no crash');
assertEq(diffEditionDescriptorCandidate(null, null), null, 'both null -> null, no crash');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
