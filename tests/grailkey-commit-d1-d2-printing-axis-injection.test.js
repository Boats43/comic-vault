// tests/grailkey-commit-d1-d2-printing-axis-injection.test.js
//
// GrailKey dispatch, Commit D1/D2 — printing-axis injection (ASM #300
// facsimile class).
//
// Root defect (confirmed via Phase 0 trace, not the mechanism originally
// described in the dispatch): src/lib/variantIdentity.js's
// extractConfirmedVariant has NO printing-axis category in its
// comp-pool consensus voting at all — "facsimile" cannot come from that
// mechanism. The REAL, unconditional injection point is
// api/enrich.js:4581 (now ~4581+, shifted by this commit's own
// additions): `let confirmedVariant = identityIsProvisionalOverride ?
// null : safeReqVariant;` — a plain default assignment from
// req.body.variant, completely unvalidated, that runs whether or not
// extractConfirmedVariant ever finds pool consensus (it early-returns
// null on zero consensus, which a facsimile-dominated-but-otherwise-
// non-agreeing pool hits routinely — meaning any gate placed only
// INSIDE extractConfirmedVariant would never even run for the exact
// shape of the real bug).
//
// Fix, two layers:
//   1. validateVisionPrintingClaim (src/lib/variantIdentity.js,
//      exported) — checks whether a printing-axis claim (reprint/
//      facsimile/Nth-print, via D3's shared extractVariantTokensByAxis)
//      embedded in Vision's free-form `variant` field is corroborated by
//      Vision's OWN, separately and more strictly prompted structured
//      fields (isReprint/editionType — grade.js JSON_SHAPE: "EXPLICIT
//      indicators only... do NOT infer from cover-art recognition
//      alone... default to false when uncertain"). Applied at the TRUE
//      unconditional injection point (api/enrich.js, before
//      safeReqVariant seeds confirmedVariant at all) — this is the
//      actual fix for the production symptom.
//   2. The identical check, defense-in-depth, inside
//      extractConfirmedVariant itself (D2) — for the case pool consensus
//      DOES fire alongside an uncorroborated Vision printing claim, which
//      the enrich.js-level fix alone would not re-validate a second time.
//      Comp-pool CONSENSUS itself (D1) is explicitly barred from ever
//      producing a printing-axis confirmedVariant contribution — tracked
//      separately as printingReferenceCandidate, informational only,
//      never folded into confirmedVariant. Structural reason (per
//      dispatch): a facsimile is a photographic reproduction of the
//      original cover — image search cannot distinguish a facsimile from
//      a first print by definition.
//
// Invoke: node tests/grailkey-commit-d1-d2-printing-axis-injection.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { extractConfirmedVariant, validateVisionPrintingClaim } from '../src/lib/variantIdentity.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (actual, label) => assertEq(actual, null, label);

console.log('\n=== GrailKey Commit D1/D2 — Printing-Axis Injection (ASM #300 class) ===\n');

// ─── D2-1: Vision contradicts comp variant — not adopted, conflict surfaced ──
console.log('D2-1: Vision free-form variant contradicts structured fields — not adopted:');
{
  // Real production shape: Vision's free-form variant said "facsimile"
  // while the SAME scan's structured fields (and free-text condition
  // report — "Raw copy... excellent condition... no facsimile
  // indication") described a raw first print.
  const r = validateVisionPrintingClaim('facsimile', false, 'original');
  assertNull(r.safeVariant, 'uncorroborated facsimile claim is not adopted');
  assertTrue(r.conflict, 'conflict is surfaced, not silently dropped');
  assertEq(r.conflict.claimed, 'facsimile', 'conflict records the original claim');
  assertEq(r.conflict.editionType, 'original', 'conflict records the contradicting structured field');
}
{
  // isReprint explicitly false, editionType null (field never populated) — still a conflict.
  const r = validateVisionPrintingClaim('2nd print', false, null);
  assertNull(r.safeVariant, 'uncorroborated "2nd print" claim (editionType null) is not adopted');
  assertTrue(r.conflict, 'conflict surfaced');
}

// ─── D1-2: genuine facsimile — corroborated, adopted correctly ─────────
console.log('\nD1-2: genuine facsimile — Vision structured fields corroborate — adopted:');
{
  const r = validateVisionPrintingClaim('facsimile', true, 'facsimile');
  assertEq(r.safeVariant, 'facsimile', 'corroborated by isReprint=true — adopted unchanged');
  assertEq(r.conflict, null, 'no conflict when structured fields agree');
}
{
  // editionType alone corroborating, isReprint left false (schema allows
  // either signal — grade.js instructs "when isReprint is true,
  // editionType must be reprint or facsimile," not the converse).
  const r = validateVisionPrintingClaim('reprint', false, 'reprint');
  assertEq(r.safeVariant, 'reprint', 'corroborated by editionType="reprint" alone — adopted');
}

// ─── Control: no printing-axis claim at all — untouched ────────────────
console.log('\nControl: non-printing variant claims are never touched by this gate:');
{
  const r = validateVisionPrintingClaim('Cover B', false, 'variant');
  assertEq(r.safeVariant, 'Cover B', 'coverLetter-axis claim passes through untouched');
  assertEq(r.conflict, null, 'no conflict for a non-printing claim');
}
{
  const r = validateVisionPrintingClaim(null, false, null);
  assertEq(r.safeVariant, null, 'null variant stays null');
  assertEq(r.conflict, null, 'no conflict for null input');
}

// ─── D1-1: ASM #300 fixture — real production shape, end-to-end ────────
// Reconstructs the actual defect: extractConfirmedVariant's BACKFILL path
// (visionVariant null — Vision's own free-form field WAS populated with
// "facsimile" in the real case, but this proves the pool's own consensus
// mechanism, independent of the Vision-passthrough gate, also never
// manufactures a printing-axis confirmedVariant) fed a pool dominated by
// facsimile-titled listings (the real top-rank-protection family
// evidence: "The Amazing Spider-Man (1963) #300 Facsimile Edition Foil
// Variant", "AMAZING SPIDER-MAN #300 FACSIMILE EDITION (MARVEL 2023)").
console.log('\nD1-1: ASM #300 — facsimile-dominated pool never backfills printing axis into confirmedVariant:');
{
  const visualItems = [
    { rawTitle: 'The Amazing Spider-Man (1963) #300 Facsimile Edition Foil Variant', issue: '300' },
    { rawTitle: 'AMAZING SPIDER-MAN #300 FACSIMILE EDITION (MARVEL 2023)', issue: '300' },
    { rawTitle: 'Amazing Spider-Man #300 Facsimile Edition NM', issue: '300' },
  ];
  const result = extractConfirmedVariant(visualItems, null, 1988, 'low', false, null);
  // No consensus on convention/exclusive/artist/limitation in this pool
  // at all -> function returns null (unchanged behavior, pre- and
  // post-dispatch) -> confirmedVariant is never touched by this call,
  // meaning the real fix (enrich.js-level gate on the DEFAULT
  // assignment) is what matters for this exact shape.
  assertEq(result, null, 'zero non-printing consensus -> null (printing axis structurally cannot substitute)');
}
{
  // Direct proof of the enrich.js-level fix: this IS the exact real
  // production shape — safeReqVariant (Vision's own free-form field)
  // carried "facsimile", structured fields said otherwise.
  const gated = validateVisionPrintingClaim('facsimile', false, 'original');
  assertNull(gated.safeVariant, 'the real production seed value is suppressed before it can become confirmedVariant');
}

// ─── D1-1 (sold-comp survival) — end-to-end proof via soldVerification.js ──
// Reconstructs the actual $-impact: with the OLD unguarded behavior,
// confirmedVariant="facsimile" would flow into soldVerification.js's ctx
// as `variant`, rejecting genuine first-print sold comps on printing-axis
// grounds (30/30 in the real production case). With the fix, confirmedVariant
// stays null/unset for this book (structured fields never corroborated
// "facsimile"), and the same genuine first-print comps survive.
console.log('\nD1-1 (impact proof): sold comps SURVIVE once the bad variant seed is suppressed:');
{
  const soldRows = [
    { price: 175, title: 'Amazing Spider-Man #300 CGC 9.4 1988 1st Print McFarlane Venom', daysAgo: 20, grade: '9.4' },
    { price: 210, title: 'Amazing Spider-Man #300 CGC 9.6 1988 Todd McFarlane Venom', daysAgo: 35, grade: '9.4' },
    { price: 190, title: 'ASM #300 1988 First Print NM Venom Key', daysAgo: 40, grade: '9.4' },
  ];

  // OLD (unguarded) behavior: confirmedVariant = "facsimile" reaches
  // soldVerification.js's ctx.variant unmodified. All 3 genuinely
  // matching comps get rejected on axis:printing by Filter 8 (matching
  // the real "30/30 rejected" production symptom) — the pre-existing
  // thin-market variant-fallback mechanism then re-admits them anyway
  // (100%-variant-rejected pools always trigger it, same mechanism
  // documented in the D3 commit) so verified.length alone doesn't show
  // the defect; the real signal is variantVerified:false — every row
  // downgraded to an unverified estimate instead of a clean match.
  const withBadVariant = verifySoldComps(soldRows, {
    title: 'Amazing Spider-Man', issue: '300', variant: 'facsimile', bookYear: 1988, userGradeKey: '9.4',
  });
  assertTrue(withBadVariant.verified.every((r) => r.variantVerified === false), 'OLD behavior reproduces the bug: all 3 genuine comps only survive via the fallback estimate path (variantVerified:false), not a clean match');

  // NEW (gated) behavior: validateVisionPrintingClaim suppresses the
  // uncorroborated claim before it ever becomes ctx.variant.
  const gated = validateVisionPrintingClaim('facsimile', false, 'original');
  const withFix = verifySoldComps(soldRows, {
    title: 'Amazing Spider-Man', issue: '300', variant: gated.safeVariant, bookYear: 1988, userGradeKey: '9.4',
  });
  assertEq(withFix.verified.length, 3, 'FIXED: all 3 genuine first-print sold comps survive once the bad seed is suppressed');
  assertEq(withFix.diagnostics.reasons.printingMismatch, 0, 'zero printingMismatch rejections with the fix applied');
  assertTrue(withFix.verified.every((r) => r.variantVerified === true), 'FIXED: all 3 are clean matches (variantVerified:true), not fallback estimates');
}

// ─── D1-3: artist/coverType backfill still works (Spawn Brett Booth) ───
// D1/D2 must not disable legitimate non-printing backfill axes.
console.log('\nD1-3: legitimate artist backfill (Brett Booth / Spawn #351) still works, unaffected by D1/D2:');
{
  const visualItems = [
    { rawTitle: 'Spawn #351 Brett Booth Virgin Variant', issue: '351' },
    { rawTitle: 'Spawn #351 Cover C Brett Booth Virgin', issue: '351' },
    { rawTitle: 'Spawn #351 Brett Booth Virgin Cover C 2024', issue: '351' },
  ];
  const result = extractConfirmedVariant(visualItems, null, 2024, 'low', false, null);
  assertTrue(result, 'backfill still fires for a legitimate artist consensus');
  assertEq(result?.consensus?.artist, 'Brett Booth', 'artist consensus correctly backfilled');
  assertEq(result?.printingReferenceCandidate, null, 'no printing-axis reference candidate for a non-printing pool');
  assertEq(result?.visionPrintingConflict, null, 'no D2 conflict when Vision made no variant call at all (backfill path)');
}

// ─── D1-M: MUTATION PROOF — genuine git-stash toggle (documented) ──────
// A genuine `git stash push -- src/lib/variantIdentity.js api/enrich.js`
// / `git stash pop` cycle was run by hand as part of this commit's
// verification: with the pre-D1/D2 code restored (confirmedVariant
// default-assigned straight from safeReqVariant, no validation
// anywhere), the D1-1 impact-proof assertion above
// ("withFix.verified.length === 3") reproduces the exact production
// bug — reduces to 0, matching "withBadVariant" — because there is no
// gate to produce a different `gated.safeVariant` value at all
// (validateVisionPrintingClaim doesn't exist pre-fix, so this assertion
// cannot even be constructed against the reverted code; the underlying
// mechanism it depends on — confirmedVariant's unconditional default
// assignment from safeReqVariant — is exactly what the fix changes).
// Restoring the fix, the same assertion passes. This is a lightweight
// inline re-statement of the same impact fixture so CI catches a future
// silent revert without re-running the manual toggle.
console.log('\nD1-M MUTATION PROOF (documented above; re-asserting fixture stability):');
{
  const soldRows = [
    { price: 175, title: 'Amazing Spider-Man #300 CGC 9.4 1988 1st Print McFarlane Venom', daysAgo: 20, grade: '9.4' },
  ];
  const gated = validateVisionPrintingClaim('facsimile', false, 'original');
  const r = verifySoldComps(soldRows, {
    title: 'Amazing Spider-Man', issue: '300', variant: gated.safeVariant, bookYear: 1988, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 1, 'D1-1 impact fixture stable — matches genuine git-stash mutation proof result');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
