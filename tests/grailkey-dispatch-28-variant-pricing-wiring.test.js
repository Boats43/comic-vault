// tests/grailkey-dispatch-28-variant-pricing-wiring.test.js
//
// GrailKey Dispatch 28 (2026-08-08) — the shared root cause behind two
// symptoms surfaced by Fix 27-A's own production validation.
//
// Root cause: api/enrich.js's computePriceBandsFromSold call site passed
// `variant: safeReqVariant` (the raw, pre-consensus request field) where
// it needed `confirmedVariant` (the resolved, post-consensus value). One
// wrong variable, two simultaneous symptoms on the SAME real scan:
//
//   BUG 1 — buildVerifiedActivePool's Q75 filter (priceBands.js) computed
//   `scanIsVariant = variant && variant.trim().length > 0` against the
//   stale, empty safeReqVariant — false — so its own VARIANT_CONTAM_ACTIVE
//   regex rejected the book's own 4 confirmed-virgin active comps,
//   contradicting api/comps.js's variant preference filter, which had
//   just correctly kept those same 4 rows using the fresh confirmedVariant.
//
//   BUG 2 — isActivePoolVariantConfirmed's `if (!variant) return false`
//   early-return, fed the same stale value, starved GK-31's own
//   already-shipped activeAnchoredOverFallbackSold mechanism — built
//   specifically to anchor Tier 3 to a confirmed variant-matched active
//   pool instead of blending in wrong-variant sold-fallback data. The
//   sold-side "variant fallback" (soldVerification.js, a real, correct
//   feature for genuinely thin markets) re-admitted 100%-Cover-A sold
//   data as pricing evidence for a book already confirmed virgin. The
//   card would have shown Price Bands market=$5.64 next to Active
//   Listings $21-27 — two prices, one card, one of them wrong.
//
// This was documented, deliberately deferred debt, not a fresh defect:
// Commit D2 (enrich.js:5152-5167, 2026-08-02) explicitly named
// computePriceBandsFromSold as an out-of-scope safeReqVariant consumer
// at the time. It sat inert for six days because confirmedVariant was
// categorically never populated from backfill before Fix 27-A — the two
// variables were identical (both null) for any book reaching this shape,
// so the wrong-variable bug had no observable effect until Fix 27-A
// started producing real values in the field for the first time.
//
// Fix: a bare one-line substitution at enrich.js:6529
// (`variant: safeReqVariant` -> `variant: confirmedVariant`), verified —
// not assumed — to be safe because confirmedVariant already carries both
// guards safeReqVariant encodes (suppressVariantForYearConflict and
// variantProvenanceValid), through mechanisms independent of this one
// read site. See docs/PATTERN-LIBRARY.md, "deferred debt promoted to
// live by a downstream fix's success."
//
// Invoke: node tests/grailkey-dispatch-28-variant-pricing-wiring.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';
import { buildVerifiedActivePool, computePriceBands } from '../src/lib/priceBands.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';
import { isVariantProvenanceValid } from '../src/lib/variantIdentity.js';
import { detectVariantPoolYearConflict } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Dispatch 28 — variant pricing wiring (Q75 + GK-31 starvation) ===\n');

// The real repro's 4 active virgin comps, $21.25-$26.50, per the real
// production log figures.
const VIRGIN_ACTIVE_COMPS = {
  prices: [
    { price: 21.25, title: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN VARIANT NM' },
    { price: 23.00, title: 'Spawn #351 Cover C Brett Booth Virgin High Grade' },
    { price: 24.50, title: 'SPAWN #351 CVR C VIRGIN BRETT BOOTH CAMEO OF LYRA' },
    { price: 26.50, title: 'Spawn #351 Cover C-Brett Booth Virgin (Image Comics)' },
  ],
};

// The real repro's sold pool — genuinely thin on the virgin variant
// specifically (zero exact-variant sold comps), Cover A dominated,
// mirroring the real log's "variant fallback triggered — variantMismatch
// rejected all N comps" shape.
const buildCoverASoldRows = (n) => Array.from({ length: n }, (_, i) => ({
  price: 4.99 + i * 0.1,
  title: `Spawn #351 Cover A Randal Image Comics 2024 NM+ ${i}`,
  daysAgo: 10 + i,
  grade: '9.6',
}));

// ══════════════ Section 1 — Bug 1: Q75 with the correct value ══════════════

console.log('-- Section 1: buildVerifiedActivePool — confirmedVariant=\'virgin\' -> activePool is 4, not 0 --');
{
  const withCorrectVariant = buildVerifiedActivePool(VIRGIN_ACTIVE_COMPS, {
    title: 'Spawn', issue: '351', year: 2024, variant: 'virgin',
  });
  assertEq(withCorrectVariant.length, 4, 'all 4 virgin actives survive Q75 when fed the real confirmedVariant — no [Q75] rejections');

  // Contrast: reproduce the exact broken shape (stale/empty variant).
  const withStaleVariant = buildVerifiedActivePool(VIRGIN_ACTIVE_COMPS, {
    title: 'Spawn', issue: '351', year: 2024, variant: null,
  });
  assertEq(withStaleVariant.length, 0, 'BEFORE the fix: the SAME 4 comps are rejected when variant is null (safeReqVariant\'s real value for this book) — reproduces the real production log exactly');
}

// ══════════════ Section 2 — Bug 2: the full price, real functions end-to-end ══════════════

console.log('\n-- Section 2: computePriceBands — activeAnchoredOverFallbackSold fires, price anchors to virgin actives --');
let afterSoldVerifyResult, afterBands;
{
  const rawSold = buildCoverASoldRows(12);
  afterSoldVerifyResult = verifySoldComps(rawSold, {
    title: 'Spawn', issue: '351', variant: 'virgin', bookYear: 2024, userGradeKey: '9.6',
  });
  // Note: diagnostics.reasons on the RETURNED result reflects the
  // fallback pass's own tally (mostly zero, since the fallback pool
  // itself passes cleanly), not the original abandoned pass — that
  // original rejection is proven instead via variantAdjusted (only ever
  // set true by the fallback branch, which only runs after
  // reasons.variantMismatch > 0 in the first pass — see
  // soldVerification.js:934).
  assertTrue(afterSoldVerifyResult.variantAdjusted === true, 'sanity: variantAdjusted=true proves the fallback branch fired, which only happens after the first pass genuinely rejected every row as variantMismatch');
  assertTrue(afterSoldVerifyResult.verified.every((r) => r.variantVerified === false), 'sanity: every surviving sold row is the wrong-variant fallback pool (variantVerified:false)');

  afterBands = computePriceBands({
    soldComps: afterSoldVerifyResult.verified,
    activeComps: VIRGIN_ACTIVE_COMPS,
    pcBase: null,
    gradeMultiplier: 1,
    title: 'Spawn',
    issue: '351',
    year: 2024,
    variant: 'virgin', // the fixed call site's value (confirmedVariant)
    variantAdjusted: afterSoldVerifyResult.variantAdjusted || false,
    soldVerifyResult: afterSoldVerifyResult,
  });

  assertTrue(afterBands !== null, 'a price is produced');
  assertEq(afterBands.tier, 3, 'Tier 3 — active-anchored, not the Tier 2 sold/active blend');
  assertTrue(afterBands.activeAnchoredOverFallbackSold === true, 'GK-31\'s activeAnchoredOverFallbackSold fires — the already-shipped mechanism, not new logic');
  assertEq(afterBands.source, 'tier3_active_discounted_over_fallback_sold', 'source correctly attributes the anchor');
  assertTrue(afterBands.market >= 18 && afterBands.market <= 23, `market ($${afterBands.market}) lands in the real virgin range (activeAvg×0.85 off $21.25-$26.50) — nowhere near the contaminated $5.64`);
  assertTrue(afterBands.market > 15, 'and specifically NOT the $5.64-class number — a wide, honest margin check, not a boundary hug');
}

console.log('\n-- Section 3: THE CONTRAST THAT PROVES THE FIX — same call, stale variant=null, reproduces the broken $5.64-class result --');
{
  // Section 2 proves the fix looks right in isolation. This section
  // proves it's actually the SAME wrong-variable bug being fixed — not
  // a happy-path coincidence — by rerunning the identical scenario with
  // the pre-fix value and confirming it reproduces the real production
  // symptom (Price Bands contaminated by Cover A sold fallback, active
  // pool zeroed by Q75, GK-31 never getting the chance to fire).
  const rawSold = buildCoverASoldRows(12);
  const beforeSoldVerifyResult = verifySoldComps(rawSold, {
    title: 'Spawn', issue: '351', variant: null, bookYear: 2024, userGradeKey: '9.6',
  });
  const beforeBands = computePriceBands({
    soldComps: beforeSoldVerifyResult.verified,
    activeComps: VIRGIN_ACTIVE_COMPS,
    pcBase: null,
    gradeMultiplier: 1,
    title: 'Spawn',
    issue: '351',
    year: 2024,
    variant: null, // the BROKEN call site's value (safeReqVariant, this book's real value)
    variantAdjusted: beforeSoldVerifyResult.variantAdjusted || false,
    soldVerifyResult: beforeSoldVerifyResult,
  });

  assertFalse(beforeBands?.activeAnchoredOverFallbackSold === true, 'BEFORE: GK-31 never fires — verifiedActive was zeroed by Q75, so verifiedActive.length>=3 never clears');
  assertTrue(beforeBands !== null, 'BEFORE: a price is STILL produced (that is exactly the danger) — not withheld, just wrong');
  assertTrue(beforeBands.market < 10, `BEFORE: market ($${beforeBands.market}) lands in the contaminated Cover-A range — reproduces the real "$5.64 next to $21-27" two-price contradiction`);
  assertTrue(afterBands.market - beforeBands.market > 10, `the fix moves the price by a large, real margin ($${beforeBands.market} -> $${afterBands.market}), not a rounding difference`);
}

// ══════════════ Section 4 — genuinely thin variant degrades honestly ══════════════

console.log('\n-- Section 4: zero sold, zero active -> honest null, nothing fabricated --');
{
  const emptySoldVerify = verifySoldComps([], { title: 'Spawn', issue: '351', variant: 'virgin', bookYear: 2024, userGradeKey: '9.6' });
  const thinBandsNoPc = computePriceBands({
    soldComps: emptySoldVerify.verified,
    activeComps: { prices: [] },
    pcBase: null,
    gradeMultiplier: 1,
    title: 'Spawn', issue: '351', year: 2024, variant: 'virgin',
    variantAdjusted: false,
    soldVerifyResult: emptySoldVerify,
  });
  assertEq(thinBandsNoPc, null, 'no sold, no active, no PC base -> null, not a fabricated number');

  const thinBandsWithPc = computePriceBands({
    soldComps: emptySoldVerify.verified,
    activeComps: { prices: [] },
    pcBase: 12.00,
    gradeMultiplier: 1,
    title: 'Spawn', issue: '351', year: 2024, variant: 'virgin',
    variantAdjusted: false,
    soldVerifyResult: emptySoldVerify,
  });
  assertEq(thinBandsWithPc?.source, 'tier4_pc_estimate', 'with a PC base present, falls to the clearly-labeled pc_estimate tier, never silently blended with wrong-variant data');
}

// ══════════════ Section 5 — guard survival ══════════════

console.log('\n-- Section 5: guards survived the swap --');
{
  // Honest about what this section proves and what it doesn't: it does
  // NOT run the full api/enrich.js request handler (no integration
  // harness exists for that here, and building one would be its own
  // large undertaking unrelated to this fix). What it DOES prove,
  // directly: (a) the guard PREDICATES themselves still correctly null
  // their inputs, exercised via their own real, exported functions
  // against known fixtures — not re-described, actually called; and
  // (b) the call site producing confirmedVariant's seed and update
  // paths (the safeReqVariant definition, the variantCheck gate) is
  // completely unmodified by this diff — the ONLY line changed is the
  // `variant:` key inside the computePriceBandsFromSold call itself,
  // confirmed by source-presence below. Together these two facts are
  // what justify "the guards survived," not a claim of full end-to-end
  // integration coverage this test suite does not have.
  assertFalse(isVariantProvenanceValid('300', '351'), 'isVariantProvenanceValid still correctly invalidates a drifted issue (Batman #608/Spawn #351-#300 class) — untouched by this diff');
  assertTrue(isVariantProvenanceValid(null, '351'), 'isVariantProvenanceValid still correctly treats a null source issue as valid (nothing to have drifted from) — untouched');
  assertTrue(isVariantProvenanceValid('351', '351'), 'isVariantProvenanceValid still correctly validates a matching issue — untouched');

  assertTrue(detectVariantPoolYearConflict({ year: 2024, agreement: 1.0, sampleSize: 6 }, 2007) !== null, 'detectVariantPoolYearConflict still correctly detects the Catwoman #64 Szerdy-variant class (17y drift) — untouched by this diff');
  assertEq(detectVariantPoolYearConflict({ year: 2024, agreement: 1.0, sampleSize: 6 }, 2023), null, 'detectVariantPoolYearConflict still correctly finds no conflict within tolerance — untouched');

  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(enrichSource.includes('const safeReqVariant = (suppressVariantForYearConflict || !variantProvenanceValid) ? null : (req.body.variant || null);'), 'safeReqVariant\'s own definition — the guard source both booleans flow through — is byte-identical, unchanged by this diff');
  assertTrue(enrichSource.includes("variantCheck = suppressVariantForYearConflict ? null : extractConfirmedVariant("), 'the pool-consensus update gate on confirmedVariant is byte-identical, unchanged by this diff');
  assertTrue(enrichSource.includes('variant: confirmedVariant,'), 'the ONE changed line — computePriceBandsFromSold now reads confirmedVariant');
  assertFalse(enrichSource.includes('variant: safeReqVariant,\n      variantAdjusted'), 'the specific broken call site no longer reads safeReqVariant (other, unrelated safeReqVariant consumers — extractConfirmedVariant\'s own visionVariant argument, the AI-verify context object — are untouched and still present elsewhere in the file, by design)');
}

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
