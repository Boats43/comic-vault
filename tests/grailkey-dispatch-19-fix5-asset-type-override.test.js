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
// comic-category agreement. Strictly additive to the Q32 merchandise
// hard-block — can never fire when merchandiseRatio >= 0.5 already
// claimed the pool.
//
// SUPERSEDED, Sections 1 and 5 (GrailKey Dispatch 31, 2026-08-08): the
// original design also required `hasCoherentConsensus` (a 4th argument
// — extractConsensus's title+issue majority-vote verdict on the same
// pool) before lifting the lock. That conjunct measured the wrong axis
// — "do these listings describe the same book," not "is this object a
// comic" — and blocked a real production pool (Spawn #351, 20/20
// comic-category, 0% merchandise: an unambiguous asset-type signal)
// SOLELY because its 20 listings didn't agree on one title/issue. It had
// no named failure case motivating it at introduction and failed
// against its own only validation pool at ship time (see this file's
// original Section 1, now rewritten below). Dispatch 31 removed the
// conjunct entirely, not replaced it — see shouldLiftAssetTypeAdvisoryLock's
// own JSDoc for the full removal reasoning. The predicate is now 3-arg;
// Sections 2/3/4/6 below (merchandise hard-block, comicVotes floor,
// comicRatio floor, degenerate inputs) are unaffected and still describe
// shipped behavior.

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

// ─── SECTION 1 (current, Dispatch 31 wording) — the real Spawn #351
// production pool numbers now lift the lock outright. ───
// 0/20 merchandise, ~20/20 comic-category (merchandiseRatio=0,
// comicVotes=20, totalVotes=20) — this is the ACTUAL shape observed
// twice in production (2026-08-07 and 2026-08-08), both times blocked
// only by the now-removed coherence conjunct. This is the GK-41-enabled
// regression fix this dispatch exists to ship.
console.log('-- Section 1: real Spawn #351 pool shape — lifts outright, no coherence conjunct --');
{
  assertTrue(
    shouldLiftAssetTypeAdvisoryLock(0, 20, 20),
    'the real 0/20 merchandise, 20/20 comic-category numbers clear the bar — the actual production shape that was wrongly blocked twice before Dispatch 31'
  );
}

// ─── SECTION 2 — never overrides the merchandise hard-block ───
console.log('\n-- Section 2: merchandise hard-block always wins --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.5, 10, 20), 'merchandiseRatio exactly 0.5 (the hard-block\'s own bar) — declines regardless of comic votes');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.9, 2, 20), 'merchandiseRatio=0.9 — declines');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(1.0, 0, 20), 'merchandiseRatio=1.0, zero comic votes — declines');
}

// ─── SECTION 3 — comic-vote count floor (>=5) ───
console.log('\n-- Section 3: comicVotes >= 5 floor --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 4, 4), 'comicVotes=4, ratio=100% — below the count floor, declines');
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0, 5, 5), 'comicVotes=5, ratio=100% — clears at exactly the floor');
}

// ─── SECTION 4 — comic-ratio floor (>=0.6) ───
console.log('\n-- Section 4: comicRatio >= 0.6 floor --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.41, 10, 17), 'comicVotes=10/17=59% — just below the ratio floor, declines (merchandiseRatio=7/17=0.41 < 0.5, so only the ratio floor is being tested here)');
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0.4, 12, 20), 'comicVotes=12/20=60% — clears at exactly the floor');
}

// ─── SECTION 5 (current, Dispatch 31 wording) — the coherence conjunct
// is GONE: a scattered-title pool with a clean category signal now
// lifts the lock, and a trailing 4th argument (a caller that hasn't
// been updated) has no effect at all. ───
console.log('\n-- Section 5: no coherence gate — scattered-title pool with clean category signal lifts; extra args are ignored --');
{
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0, 20, 20), 'overwhelming category votes (20/20), no merchandise — lifts regardless of title/issue coherence (this is the actual Dispatch 31 fix)');
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0, 20, 20, false), 'passing a stale 4th argument (false, as a not-yet-updated caller might) has NO effect — the function is now 3-arg and still lifts');
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0, 20, 20, null), 'stale 4th argument (null) also has no effect');
}

// ─── SECTION 6 — degenerate inputs ───
console.log('\n-- Section 6: degenerate inputs --');
{
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0, 0, 0), 'zero total votes — declines, never divides by zero into a false positive');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(NaN, 5, 5), 'NaN merchandiseRatio — declines (NaN < 0.5 is false)');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
