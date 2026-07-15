// P0 — 22e title zero-support regression suite (same blind spot as the
// issue-number fix, second location: checkAssemblyIntegrity's Rule 1).
//
// Root cause: Rule 1 forced Vision's title back whenever ANY Vision token
// was absent from the assembled/pool title, with no check on whether that
// specific token had any support in the pool at all — "does assembled
// disagree with Vision" instead of "does Vision's specific claim have any
// support in the pool." Fix: a carve-out that defers to the pool only when
// (a) ALL missing tokens have ZERO occurrences across compTitles, AND
// (b) assembled's own substantive tokens independently clear Rule 2's
// existing >=60% consensus bar — proving assembled isn't a random artifact.
//
// Test coverage:
//   1. Spider-Versity class (the reported bug) — zero-support + assembled
//      clears consensus -> carve-out fires, defers to pool.
//   2. X-Men #44 Angel class (E3's original purpose — must still catch
//      genuine assembly bugs) — missing token "x-men" has FULL pool
//      support -> carve-out does NOT fire, Vision-force stands.
//   3. Thin pool (<3 compTitles) — carve-out can't engage at all ->
//      original conservative behavior holds.
//   4. Partial-support (one of two missing tokens has zero support, the
//      other doesn't) — carve-out does NOT fire, no over-eager deferral
//      on a mixed signal.
//
// Invoke: node tests/q-title-zero-support.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { checkAssemblyIntegrity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected: ${JSON.stringify(expected)}\n    Got: ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${label}`);
  }
};

console.log('Testing Q-TITLE-ZERO-SUPPORT regression suite...\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('Test 1: Spider-Versity class — zero-support + assembled clears consensus -> carve-out fires');
{
  const visionTitle = 'Spider-Verse';
  const assembledTitle = 'Amazing Spider Versity';
  // 20 pool titles: unanimous "Amazing Spider Versity", none ever spell
  // the hyphenated "spider-verse" Vision read.
  const compTitles = Array.from({ length: 20 }, (_, i) =>
    `Amazing Spider Versity #1 (2019) Marvel CGC ${9 + (i % 2) * 0.2}`
  );

  const result = checkAssemblyIntegrity(visionTitle, assembledTitle, compTitles);

  assertEq(result.shouldFallback, false, 'shouldFallback is false — pool consensus accepted, Vision NOT forced back');
  assertEq(result.reason, null, 'reason is null — no integrity failure recorded');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 2: X-Men #44 Angel class — missing token HAS full pool support -> carve-out does NOT fire, Vision-force stands');
{
  const visionTitle = 'The X-Men #44 Angel';
  // Simulated assembly-bug artifact: an unrelated pipeline stage stripped
  // "x-" and "angel", producing a broken title (E3's original motivating
  // failure — Ship #22 doc: "x men" #2 -> assembled "men").
  const assembledTitle = 'Men Timeless';
  // Realistic X-Men #44 comp pool — "x-men" is well-attested; "angel" is
  // Vision's own added character descriptor, not standard sale-title text,
  // so it has zero support too. Mixed support on the two missing tokens
  // still must NOT clear the "ALL missing zero-support" bar.
  const compTitles = Array.from({ length: 20 }, (_, i) =>
    `X-Men #44 (1968) Marvel CGC ${8 + (i % 3) * 0.5}`
  );

  const result = checkAssemblyIntegrity(visionTitle, assembledTitle, compTitles);

  assertEq(result.shouldFallback, true, 'shouldFallback is true — Vision-force still fires (assembly-bug protection intact)');
  assertEq(result.reason, 'missing-vision-tokens', 'reason is missing-vision-tokens');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 3: Thin pool (<3 compTitles) — carve-out can\'t engage, original conservative behavior holds');
{
  const visionTitle = 'Spider-Verse';
  const assembledTitle = 'Amazing Spider Versity';
  // Same shape as Test 1's fixture, but only 2 comps — below the >=3 gate
  // (matches Rule 2's existing bar) — so the carve-out must not engage at
  // all, regardless of what the 2 comps say.
  const compTitles = [
    'Amazing Spider Versity #1 (2019) Marvel CGC 9.8',
    'Amazing Spider Versity #1 (2019) Marvel CGC 9.6',
  ];

  const result = checkAssemblyIntegrity(visionTitle, assembledTitle, compTitles);

  assertEq(result.shouldFallback, true, 'shouldFallback is true — thin pool falls back to original (pre-fix) conservative behavior');
  assertEq(result.reason, 'missing-vision-tokens', 'reason is missing-vision-tokens');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 4: Partial-support (one of two missing tokens has zero support, the other doesn\'t) — carve-out does NOT fire');
{
  const visionTitle = 'Amazing Spider-Verse Legacy';
  const assembledTitle = 'Amazing Spider Versity';
  // missing = ["spider-verse", "legacy"] (both absent from assembled).
  // "spider-verse" never appears literally in any comp title (zero
  // support). "legacy" appears in 3/20 (non-zero support) — a mixed
  // signal across the two missing tokens.
  const base = Array.from({ length: 17 }, (_, i) =>
    `Amazing Spider Versity #1 (2019) Marvel CGC ${9 + (i % 2) * 0.2}`
  );
  const withLegacy = Array.from({ length: 3 }, () =>
    'Amazing Spider Versity Legacy #1 (2019) Marvel CGC 9.4'
  );
  const compTitles = [...base, ...withLegacy];

  const result = checkAssemblyIntegrity(visionTitle, assembledTitle, compTitles);

  assertEq(result.shouldFallback, true, 'shouldFallback is true — mixed support on missing tokens does NOT trigger the carve-out');
  assertEq(result.reason, 'missing-vision-tokens', 'reason is missing-vision-tokens');
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`\n${f}`));
}
process.exit(failed > 0 ? 1 : 0);
