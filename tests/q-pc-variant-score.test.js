// P0 — confirmedVariant-aware PC candidate scoring regression suite.
//
// Root cause: when PC's product-search returns multiple bracket-variant
// candidates for the same issue, the OLD code either (a) deprioritized ALL
// of them into `variantFallbacks` and returned `[0]` (arbitrary, API
// order) when confirmedVariant was null, or (b) when confirmedVariant WAS
// populated, never even looked at bracket content — the first
// bracket-variant candidate encountered in PC's own API order got
// `return candidate`d immediately, regardless of whether its name matched
// confirmedVariant at all. Verified live: querying PC for "Captain America
// 25" returns Steranko (2017), Veregge (2020), and Young (2020) bracket
// variants — Steranko ranks first in PC's raw API order, so the OLD code
// would anchor to a wrong, unrelated 2017 printing even when we've
// confirmed the book in hand is the 2020 Young variant.
//
// Fix: selectBestVariantCandidate scores every deferred bracket candidate
// by variantTokenOverlapScore against confirmedVariant and picks the best
// match. Null confirmedVariant: unchanged (candidates[0], same as before).
//
// Test coverage (regression anchors as specified):
//   1. Captain America #25 + confirmedVariant="SKOTTIE YOUNG" -> selects
//      id=3626270 (Young), not id=3442358 (Steranko) — real PC data.
//   2. Spider-Versity #1 + confirmedVariant="Skottie Young" -> selects the
//      Young-bracketed entry, not the Camuncoli one.
//   3. Existing Q108 null-variant case (Wonder Woman #75) -> unaffected,
//      same arbitrary-first behavior as today.
//   4. Only ONE bracket-variant candidate (no match possible) -> falls
//      through gracefully, same as today's single-candidate behavior.
//
// Invoke: node tests/q-pc-variant-score.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { selectBestVariantCandidate, variantTokenOverlapScore } from '../src/lib/identityCore.js';

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

console.log('Testing Q-PC-VARIANT-SCORE regression suite...\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('Test 1: Captain America #25 + confirmedVariant="SKOTTIE YOUNG" — real PC API order (Steranko ranks first)');
{
  // Exact shape + API order verified live against PC's product-search
  // endpoint for "Captain America 25" — Steranko (2017) ranks BEFORE
  // Veregge/Young (both 2020) in PC's own response.
  const candidates = [
    { id: 3442358, productName: 'Captain America [Steranko] #25 (2017)', price: 2.27 },
    { id: 3626269, productName: 'Captain America [Veregge] #25 (2020)', price: 5.99 },
    { id: 3626270, productName: 'Captain America [Young] #25 (2020)', price: 9.99 },
  ];

  const best = selectBestVariantCandidate(candidates, 'SKOTTIE YOUNG');
  assertEq(best.id, 3626270, 'selects id=3626270 (Young), NOT id=3442358 (Steranko, which ranks first in raw API order)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 2: Spider-Versity #1 + confirmedVariant="Skottie Young" — selects Young, not Camuncoli');
{
  const candidates = [
    { id: 111, productName: 'Spider-Verse [Camuncoli] #1 (2014)', price: 4.50 },
    { id: 222, productName: 'Spider-Versity [Young] #1 (2020)', price: 7.25 },
  ];

  const best = selectBestVariantCandidate(candidates, 'Skottie Young');
  assertEq(best.id, 222, 'selects the Young-bracketed entry, not Camuncoli');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 3: Existing Q108 null-variant case (Wonder Woman #75) — unaffected, same as today');
{
  // Q108's original behavior: confirmedVariant=null -> arbitrary/first
  // (API order), unchanged by this fix. These are BOTH bracket-variant
  // candidates (a plain/unbracketed Cover A entry, if present, would never
  // reach this helper at all — it wins earlier via Q108's untouched
  // base-preference early-return in the main loop).
  const candidates = [
    { id: 1001, productName: 'Wonder Woman [Jenny Frison] #75 (2019)', price: 6.00 },
    { id: 1002, productName: 'Wonder Woman [David Marquez] #75 (2019)', price: 4.50 },
  ];

  const best = selectBestVariantCandidate(candidates, null);
  assertEq(best.id, 1001, 'null confirmedVariant returns candidates[0] — identical to prior arbitrary/first behavior');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 4: Only ONE bracket-variant candidate (no confirmedVariant match possible) — falls through gracefully');
{
  const candidates = [
    { id: 3442358, productName: 'Captain America [Steranko] #25 (2017)', price: 2.27 },
  ];

  const best = selectBestVariantCandidate(candidates, 'SKOTTIE YOUNG'); // no match possible — only one option
  assertEq(best.id, 3442358, 'single candidate returned regardless of match — same as today\'s single-candidate behavior');
  assertEq(variantTokenOverlapScore('SKOTTIE YOUNG', candidates[0].productName), 0, 'sanity check: score is genuinely 0 (no match), yet still selected — no refusal on zero score');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 5: variant-match candidate wins even when it ALSO looks year-mismatched (documented behavior, not inferred)');
{
  // e343a0a's commit note flagged this as a side-effect rather than a
  // tested assertion — this test makes it explicit. Under the OLD
  // bracket-detection condition (`!variant && hasVariantDescriptor(name)`),
  // a bracket candidate with an unproven year mismatch and a CONFIRMED
  // variant would have been diverted to `q86Fallbacks` in lookupPriceCharting
  // (never reaching variantFallbacks/this helper at all), and q86Fallbacks
  // resolves with HIGHER priority than variantFallbacks — so the
  // year-tolerance pick would have won regardless of variant identity.
  //
  // Under the NEW widened condition (`hasVariantDescriptor(name)`,
  // unconditional), this candidate now reaches variantFallbacks instead —
  // and selectBestVariantCandidate scores purely on variant-token overlap,
  // with no awareness of year at all. This test proves that outcome
  // directly: a variant-name match wins over a same-issue candidate with
  // no variant match, even though the matching candidate's OWN product
  // name carries an off year (1995) that would have looked like a q86
  // year-tolerance case under the old routing.
  //
  // Judged correct: a specific confirmed-variant identity match is a
  // stronger signal than a generic year-proximity heuristic. Documented
  // here as intended behavior, not left as an unverified side-effect.
  const candidates = [
    { id: 501, productName: 'Captain America [Young] #25 (1995)', price: 3.00 },   // variant match, off year
    { id: 502, productName: 'Captain America [Steranko] #25 (2020)', price: 2.27 }, // right-shaped year, no variant match
  ];

  const best = selectBestVariantCandidate(candidates, 'SKOTTIE YOUNG');
  assertEq(best.id, 501, 'variant-match candidate (id=501) wins over a no-match candidate, regardless of year plausibility — specific identity signal outranks generic year-proximity');
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`\n${f}`));
}
process.exit(failed > 0 ? 1 : 0);
