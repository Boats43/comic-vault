// tests/grailkey-dispatch-19-fix5-asset-type-override.test.js
//
// GrailKey Dispatch 19 (2026-08-07) — Fix 5, unblocked and implemented.
//
// Blocked since GrailKey Dispatch 15 on a real captured Vision JSON to
// determine whether a "not a comic" misread returns issue=null
// (display/lock-only fix) or a stale wrong value (would also need to
// feed a corrected issue back into resolveIdentity). Resolved via a real
// production scan (Spawn #351, 2026-08-07 20:40:36 UTC): Vision returned
// #null, confirmed null-not-stale — display/lock-only, as designed.
//
// shouldLiftAssetTypeAdvisoryLock (src/lib/imageSearchIdentity.js) is
// the pure decision predicate: extends the existing Q32 category-vote
// machinery (merchandise detection) to also lift Q110's advisory
// listingHardLocked flag when Vision flagged !assetTypeConfident but the
// pool independently shows strong (>=5 listings, >=60% ratio)
// comic-category agreement AND the pool is coherent (extractConsensus
// produced a real, non-null consensus on title AND issue — deliberately
// the stricter of the two coherence options, see the function's own doc
// comment). Strictly additive to the Q32 merchandise hard-block — can
// never fire when merchandiseRatio >= 0.5 already claimed the pool.

import { shouldLiftAssetTypeAdvisoryLock } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Dispatch 19 — Fix 5 (shouldLiftAssetTypeAdvisoryLock) ===\n');

// ─── SECTION 1 — the real Spawn #351 production pool numbers ───
// 0/20 merchandise, ~20/20 comic-category (merchandiseRatio=0,
// comicVotes=20, totalVotes=20) — but visualConsensus WAS null on this
// exact scan (issue-axis never reached its own 50% bar), disclosed
// honestly: this specific fix would NOT have fired for that scan.
console.log('-- Section 1: real Spawn #351 pool shape, both coherence outcomes --');
{
  assertTrue(
    shouldLiftAssetTypeAdvisoryLock(0, 20, 20, true),
    'if the pool HAD been coherent (hasCoherentConsensus=true), the real 0/20 merchandise, 20/20 comic-category numbers clear the bar trivially'
  );
  assertFalse(
    shouldLiftAssetTypeAdvisoryLock(0, 20, 20, false),
    'the ACTUAL real scan shape (visualConsensus was null) — declines, disclosed limitation, not silently different from what shipped'
  );
}

// ─── SECTION 2 — never overrides the merchandise hard-block ───
console.log('\n-- Section 2: merchandise hard-block always wins --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.5, 10, 20, true), 'merchandiseRatio exactly 0.5 (the hard-block\'s own bar) — declines regardless of comic votes');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.9, 2, 20, true), 'merchandiseRatio=0.9 — declines even with a coherent pool');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(1.0, 0, 20, true), 'merchandiseRatio=1.0, zero comic votes — declines');
}

// ─── SECTION 3 — comic-vote count floor (>=5) ───
console.log('\n-- Section 3: comicVotes >= 5 floor --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 4, 4, true), 'comicVotes=4, ratio=100% — below the count floor, declines');
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0, 5, 5, true), 'comicVotes=5, ratio=100% — clears at exactly the floor');
}

// ─── SECTION 4 — comic-ratio floor (>=0.6) ───
console.log('\n-- Section 4: comicRatio >= 0.6 floor --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.41, 10, 17, true), 'comicVotes=10/17=59% — just below the ratio floor, declines (merchandiseRatio=7/17=0.41 < 0.5, so only the ratio floor is being tested here)');
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0.4, 12, 20, true), 'comicVotes=12/20=60% — clears at exactly the floor');
}

// ─── SECTION 5 — coherence gate is a hard requirement, not a tiebreaker ───
console.log('\n-- Section 5: coherence gate --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 20, 20, false), 'overwhelming category votes (20/20) but incoherent pool — still declines, a scattered pool of unrelated comic-category junk must not force an override');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 20, 20, null), 'hasCoherentConsensus=null (not strictly true) — declines, exact-match required');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 20, 20, undefined), 'hasCoherentConsensus=undefined — declines');
}

// ─── SECTION 6 — degenerate inputs ───
console.log('\n-- Section 6: degenerate inputs --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 0, 0, true), 'zero total votes — declines, never divides by zero into a false positive');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(NaN, 5, 5, true), 'NaN merchandiseRatio — declines (NaN < 0.5 is false)');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
