// tests/grailkey-dispatch-31-fix31a-wrong-axis-removed.test.js
//
// GrailKey Dispatch 31 (2026-08-08) — Fix 31-A (decision-gate) ONLY.
// See tests/grailkey-dispatch-31-fix31b-prompt-widening.test.js for
// Fix 31-B (prompt) — split into its own file deliberately, so a future
// revert of one fix does not require reverting or hand-splitting the
// other's test coverage.
//
// Dispatch 30 fixed the bulk-import hard-reject (GK-41) and corrected
// Fix 3a's asset-type wording, but a SEPARATE, sharper bug survived: the
// pool-based override for lifting Q110's advisory listingHardLocked
// (shouldLiftAssetTypeAdvisoryLock, src/lib/imageSearchIdentity.js) was
// gated on `hasCoherentConsensus` — extractConsensus's title+issue
// majority-vote verdict on the same eBay visual pool. That measures "do
// these listings describe the same book," not "is this object a
// comic." A real production pool (Spawn #351, 20/20 comic-category
// listings, 0% merchandise — an unambiguous asset-type signal) was
// blocked SOLELY because the 20 listings didn't agree on one
// title/issue, `blockedBy=[pool-incoherent]`. The conjunct had no named
// failure case at introduction (its own JSDoc called it "the MORE
// conservative of the two options," a general principle) and failed
// against its own only validation pool at ship time (Dispatch 19's own
// comment disclosed the motivating scan wouldn't have qualified under
// its own bar).
//
// FIX: hasCoherentConsensus REMOVED from shouldLiftAssetTypeAdvisoryLock
// entirely, not replaced — category votes already measure asset type
// directly; title/issue coherence measures a different axis. See that
// function's own JSDoc (imageSearchIdentity.js) for the full reasoning.
//
// Test design: the predicate (shouldLiftAssetTypeAdvisoryLock) is a
// cleanly exported pure function — imported and called directly below,
// which already exercises the real shipped code, no extract-and-eval
// needed for it. The user-facing OUTCOME this predicate feeds
// (listingHardLocked) is an inline conditional in api/enrich.js's
// handler with no exported function — per the Dispatch 30 standing test
// rule ("assert against the shipped expression, never a copy of it"),
// its literal `if (...)` condition text is extracted directly from the
// live source via anchored regex and evaluated as real JavaScript,
// rather than reimplemented.
//
// Invoke: node tests/grailkey-dispatch-31-fix31a-wrong-axis-removed.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';
import { shouldLiftAssetTypeAdvisoryLock } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertFalse = (cond, label) => assertTrue(!cond, label);
const assertEq = (actual, expected, label) => assertTrue(actual === expected, `${label} (got ${JSON.stringify(actual)})`);

console.log('\n=== GrailKey Dispatch 31 — Fix 31-A (wrong-axis gate removed) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the predicate itself (real exported function).
// ═══════════════════════════════════════════════════════════════════════
console.log('-- Part 1: shouldLiftAssetTypeAdvisoryLock — the real Spawn #351 figures lift outright --');
{
  assertTrue(shouldLiftAssetTypeAdvisoryLock(0, 20, 20), 'merchandiseRatio=0, comicVotes=20, totalVotes=20 — the actual Spawn #351 production shape — now lifts (was blocked by hasCoherentConsensus twice before this fix)');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.9, 2, 20), 'a genuine merchandise-heavy pool (90% merchandise) still declines — the merchandise hard-block is untouched by this fix');
  assertFalse(shouldLiftAssetTypeAdvisoryLock(0.5, 10, 20), 'merchandiseRatio at exactly the hard-block boundary (0.5) still declines');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — the downstream OUTCOME: does listingHardLocked actually stay
// unset for the real Spawn #351 shape? Extracted from the live
// api/enrich.js source, not reimplemented.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Part 2: downstream outcome — listingHardLocked, extracted from the real shipped code --');
{
  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  // Anchored on the known literal condition text itself (not a wildcard
  // capture spanning arbitrary source) so this cannot accidentally latch
  // onto an unrelated if-block elsewhere in this large file — one of
  // ~15 other `out.listingHardLocked = true;` sites exist here, and a
  // loose "anchor comment ... then next matching if/brace" pattern
  // proved fragile against them during authoring (caught before commit:
  // it initially matched a distant, unrelated polybag-pricing gate).
  // Still a real extraction, not a reimplementation — if this exact
  // condition text ever changes, the match fails and the assertion
  // below reports it as missing rather than silently testing stale text.
  const lockBlockMatch = enrichSource.match(
    /if \((!out\.assetTypeConfident && !out\.assetTypeConfidentOverride)\)\s*\{\s*\n\s*out\.listingHardLocked = true;/
  );
  assertTrue(!!lockBlockMatch, 'the listingHardLocked gate is found and isolated for extraction');
  const lockCond = lockBlockMatch?.[1] || 'true';
  const setsListingHardLocked = new Function('out', `return (${lockCond});`);

  // Real Spawn #351 shape: Vision said not-a-comic (assetTypeConfident
  // false), but the pool clears the (now 3-arg) override.
  const overrideResult = shouldLiftAssetTypeAdvisoryLock(0, 20, 20);
  const outAccepted = { assetTypeConfident: false, assetTypeConfidentOverride: overrideResult };
  assertEq(setsListingHardLocked(outAccepted), false, 'the real listingHardLocked condition evaluates to false for the actual Spawn #351 shape — the book is NOT locked, Sell/Bundle stay unlocked');

  // Contrast: Vision said not-a-comic AND the pool does NOT clear the
  // override (e.g. genuine merchandise contamination) — lock must still
  // fire. Proves this isn't a blanket unlock.
  const overrideDeclined = shouldLiftAssetTypeAdvisoryLock(0.9, 2, 20);
  const outLocked = { assetTypeConfident: false, assetTypeConfidentOverride: overrideDeclined };
  assertEq(setsListingHardLocked(outLocked), true, 'the same real condition still locks when the override genuinely declines (merchandise-heavy pool) — the gate still protects against real merchandise contamination');

  // Vision itself said assetTypeConfident=true (the common case) — never
  // locked, regardless of the override flag.
  const outConfident = { assetTypeConfident: true, assetTypeConfidentOverride: false };
  assertEq(setsListingHardLocked(outConfident), false, 'assetTypeConfident=true (Vision agrees it is a comic) — never locked, baseline unaffected');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
