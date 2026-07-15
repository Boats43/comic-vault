// P0 — PC requery gate regression suite (titleOverlapsProduct).
//
// Root cause: the requery decision was gated on `imageConsensusTitle`
// (derived from the raw image-search pool's OWN vote) rather than on
// whether PC's matched product still represents confirmedTitle. When pool
// consensus was rejected/absent, NO validation of PC's match ran at all —
// "pool consensus rejected" and "PC's match is still right for our current
// identity" were treated as the same signal. Even when the check DID run,
// it only compared the FIRST tokenized word (main-token heuristic), which
// always passed for same-franchise titles sharing a lead word (Spider-Man
// / Spider-Verse / Spider-Versity all start with "spider").
//
// Fix: titleOverlapsProduct(confirmedTitle, productName) — majority-token
// overlap (>=0.5, matching the existing top-rank-guard forwardRatio
// convention), run unconditionally whenever a PC match exists.
//
// Test coverage:
//   1. Amazing Spider-Man #300 (regression anchor) — already-correct match,
//      high overlap -> titleOverlapsProduct true -> needsRequery: false.
//   2. Spider-Versity vs Camuncoli Variant (the reported bug) — corrected
//      identity vs a different real product sharing only the franchise
//      lead word -> low overlap -> titleOverlapsProduct false -> would
//      correctly trigger needsRequery: true (the old main-token heuristic
//      would have wrongly passed this).
//   3. No PC match at all -> needsRequery still true (unaffected by the
//      overlap check, short-circuited by !priceCharting).
//   4. Degenerate confirmedTitle (all common/filler tokens) -> nothing
//      substantive to check -> true (no spurious requery forced).
//
// Invoke: node tests/q-pc-requery-gate.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { titleOverlapsProduct } from '../src/lib/identityCore.js';

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

console.log('Testing Q-PC-REQUERY-GATE regression suite...\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('Test 1: Amazing Spider-Man #300 (regression anchor) — already-correct match stays needsRequery: false');
{
  const confirmedTitle = 'Amazing Spider-Man';
  const productName = 'Amazing Spider-Man #300 (1988)';

  const overlaps = titleOverlapsProduct(confirmedTitle, productName);
  const needsRequery = !productName || !overlaps; // mirrors enrich.js's `!priceCharting || !titleOverlapsProduct(...)`

  assertEq(overlaps, true, 'titleOverlapsProduct is true — high token overlap');
  assertEq(needsRequery, false, 'needsRequery is false — initial PC match kept, no wasted requery');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 2: Spider-Versity vs Camuncoli Variant (the reported bug) — correctly triggers a requery');
{
  // confirmedTitle here represents the identity AFTER 22e's correction —
  // a different, real product from what PC actually matched, sharing only
  // the franchise lead word "spider".
  const confirmedTitle = 'Amazing Spider Versity';
  const productName = 'Spider-Verse (2014) #1 Camuncoli Variant';

  const overlaps = titleOverlapsProduct(confirmedTitle, productName);
  const needsRequery = !productName || !overlaps;

  assertEq(overlaps, false, 'titleOverlapsProduct is false — only "spider" overlaps, majority does not');
  assertEq(needsRequery, true, 'needsRequery is true — the old main-token heuristic would have wrongly kept this match; the fix does not');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 3: No PC match at all -> needsRequery stays true regardless of the overlap check');
{
  const priceCharting = null;
  const confirmedTitle = 'Amazing Spider-Man';
  const needsRequery = !priceCharting || !titleOverlapsProduct(confirmedTitle, priceCharting?.productName);

  assertEq(needsRequery, true, 'needsRequery is true — short-circuited by !priceCharting, overlap check never even needed');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 4: Degenerate confirmedTitle (all common/filler tokens) -> no spurious requery forced');
{
  // "The Comics" tokenizes to nothing substantive (both are filtered
  // PC_MATCH_COMMON_TOKENS) — titleOverlapsProduct has nothing to check
  // against, so it must not force a requery just because confirmedTitle
  // is thin.
  const confirmedTitle = 'The Comics';
  const productName = 'Amazing Spider-Man #300 (1988)';

  const overlaps = titleOverlapsProduct(confirmedTitle, productName);
  assertEq(overlaps, true, 'titleOverlapsProduct is true — nothing substantive in confirmedTitle to fail on');
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`\n${f}`));
}
process.exit(failed > 0 ? 1 : 0);
