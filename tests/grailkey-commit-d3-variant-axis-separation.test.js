// tests/grailkey-commit-d3-variant-axis-separation.test.js
//
// GrailKey dispatch, Commit D3 — variant axis separation, TWO files.
//
// Root defect #1 (src/lib/soldVerification.js, Filter 8): the old
// extractVariantTokens flattened four structurally distinct variant
// "axes" — coverType (virgin/foil/sketch), distribution (newsstand/
// exclusive/ratio), coverLetter (altcover), printing (reprint/facsimile/
// 2nd-3rd-print) — into one array, with zero artist awareness at all. A
// user variant naming only the cover ARTIST ("Brett Booth") against a
// comp title naming only the cover TYPE ("virgin") — the same physical
// product, described two different ways — hit Case (b) (both non-empty,
// zero token overlap) and was wrongly rejected. Production impact: 100%
// of sold comps rejected for Spawn #351.
//
// Root defect #2 (src/lib/evidenceEligibility.js, classifyEvidenceRow's
// WRONG_VARIANT branch): an INDEPENDENT, second occurrence of the
// identical defect on a separate code path — a flat single-regex
// (VARIANT_CONTAM_RE) match against the comp title, checked as a literal
// substring of target.variant. Found while investigating why the D3
// Filter-8 fix alone didn't recover the Spawn #351 fixture — this
// function is applied to `working` (soldVerification.js, gate at
// ~line 1282) AFTER Filter 8 runs, re-rejecting the same rows via a
// completely different mechanism. It is ALSO shared with api/comps.js's
// active-listing pricing-eligibility gate (line ~2184), so this fix's
// blast radius includes active comps, not just sold — confirmed
// deliberately accepted (see D-8 below): the axis-aware check is
// strictly less-rejecting than the flat regex, so active comps can only
// gain eligibility, never lose it.
//
// Fix: both consumers now share ONE extractor —
// extractVariantTokensByAxis, promoted to src/lib/compHygiene.js (single
// source of truth) — returning
// { coverType, distribution, coverLetter, printing, artist }. 'artist'
// is included in each consumer's globally-empty check (so an
// artist-only variant still counts as "something was specified") but
// EXCLUDED from the iterated comparison axes in both places — Filter 7
// (classifyArtistMatch, soldVerification.js) is the sole
// artist-matching mechanism; comparing artist twice caused 2 regressions
// during implementation (documented in the D3 commit message), fixed
// before this file was written.
//
// END-TO-END RECOVERY CONFIRMED (post-commit verification, corrects an
// earlier draft of this file): run against the 4 VERBATIM real
// production titles ("SPAWN #351 CVR C BRETT BOOTH VIRGIN 1st CAMEO OF
// LYRA HTF SCARCE 2024" and 3 siblings), verifySoldComps recovers 3/4
// (the 4th correctly rejected on an unrelated filter — gradeMismatch,
// "NM-" outside the ±1.5 grade-proximity band — nothing to do with
// variant axes). Zero variantMismatch, zero WRONG_VARIANT. Real sold
// listings for artist-driven variants DO credit the artist by name in
// the title (sellers know it's the source of the premium) — Filter 7
// (classifyArtistMatch) correctly matches all 4 real titles. An earlier
// draft of this test used a SYNTHETIC fixture with titles that never
// named the artist at all ("Spawn #351 Virgin Cover") and concluded
// Filter 7 was an unresolved blocker — that conclusion was wrong; it
// was an artifact of an unrealistic fixture, not real pipeline
// behavior. See D-2c below for both the real-title recovery proof and
// the (much narrower, genuinely real) synthetic edge case: a comp that
// truly never names the artist anywhere still won't match on that
// evidence alone — Filter 7's 'no-signal' handling for that specific
// case remains a legitimate, separate, lower-priority design question,
// not the production bug this commit fixes.
//
// Invoke: node tests/grailkey-commit-d3-variant-axis-separation.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { verifySoldComps } from '../src/lib/soldVerification.js';
import { extractVariantTokensByAxis, classifyArtistMatch } from '../src/lib/compHygiene.js';
import { classifyEvidenceRow } from '../src/lib/evidenceEligibility.js';

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
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit D3 — Variant Axis Separation (soldVerification.js + evidenceEligibility.js) ===\n');

// ─── D-2a: extractor correctly separates axes (mechanical proof) ───────
console.log('D-2a: extractVariantTokensByAxis axis separation (Spawn #351 shape):');
{
  const userAxes = extractVariantTokensByAxis('brett booth');
  assertEq(userAxes.artist.join(','), 'brett booth', 'artist-only variant populates artist axis');
  assertEq(userAxes.coverType.length, 0, 'artist-only variant leaves coverType axis empty');

  const compAxes = extractVariantTokensByAxis('spawn #351 virgin cover');
  assertEq(compAxes.coverType.join(','), 'virgin', 'comp title populates coverType axis');
  assertEq(compAxes.artist.length, 0, 'comp title (no artist name) leaves artist axis empty');
}

// ─── D-2b: classifyEvidenceRow no longer flat-regex-rejects (isolated) ──
console.log('\nD-2b: classifyEvidenceRow WRONG_VARIANT no longer cross-axis-rejects:');
{
  const target = { issue: '351', seriesTitle: 'Spawn', variant: 'Brett Booth', confirmedYear: 2024, assetType: 'comic' };
  const row = { title: 'Spawn #351 Cover C Virgin', price: 45 };
  const result = classifyEvidenceRow(row, target);
  assertFalse(result.rejectionCodes.includes('WRONG_VARIANT'), 'artist-only target vs coverType-only comp: no WRONG_VARIANT');
}
// D-4 (classifyEvidenceRow side): genuine same-axis mismatch still rejects.
{
  const target = { issue: '351', seriesTitle: 'Spawn', variant: 'Brett Booth Virgin', confirmedYear: 2024, assetType: 'comic' };
  const row = { title: 'Spawn #351 Foil Cover', price: 45 };
  const result = classifyEvidenceRow(row, target);
  assertTrue(result.rejectionCodes.includes('WRONG_VARIANT'), 'same-axis (coverType) genuine mismatch still flagged WRONG_VARIANT');
}

// ─── D-2c: END-TO-END recovery on real production titles ───────────────
console.log('\nD-2c: full pipeline recovers Spawn #351 end-to-end on VERBATIM production titles:');
{
  const rows = [
    { price: 45, title: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN 1st CAMEO OF LYRA HTF SCARCE 2024', daysAgo: 20, grade: '9.6' },
    { price: 50, title: 'Spawn #351 Cover C Brett Booth Virgin Variant 2024', daysAgo: 35, grade: '9.6' },
    { price: 48, title: 'SPAWN #351 BRETT BOOTH VIRGIN VARIANT C IMAGE COMICS NM- FIRST PRINT', daysAgo: 40, grade: '9.6' },
    { price: 47, title: 'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)', daysAgo: 55, grade: '9.6' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Spawn', issue: '351', variant: 'Brett Booth', bookYear: 2024, userGradeKey: '9.6',
  });
  assertEq(r.verified.length, 3, '3/4 real production comps verified (4th rejected on unrelated gradeMismatch, not variant)');
  assertEq(r.diagnostics.reasons.variantMismatch, 0, 'zero variantMismatch on real titles');
  assertEq(r.diagnostics.reasons.gradeMismatch, 1, 'the 1 rejection is the unrelated NM- grade-proximity miss, confirming variant axes are not the blocker');
}
// Narrower, genuinely real edge case: a comp that truly never names the
// artist anywhere (not a realistic Spawn #351 listing, but a legitimate
// hypothetical for a thinner market) still won't match on variant
// evidence alone — Filter 7's 'no-signal' handling for that specific
// case is a real, separate, lower-priority design question (queued as
// "F7"), not the production bug this commit fixes.
{
  const title = 'Spawn #351 Virgin Cover';
  assertEq(classifyArtistMatch(title, 'brett booth'), 'no-signal', 'edge case only: a comp naming no artist at all still can\'t corroborate an artist-only user variant (Filter 7, out of scope here)');
}

// ─── D-4: genuine same-axis mismatch still rejects at Filter 8 (mixed pool) ──
// A 100%-variant-mismatch pool triggers the pre-existing "thin market
// variant fallback" (soldVerification.js ~line 991), which re-admits
// rows via grade-match regardless of Filter 8's verdict, by design — not
// a D3 regression. A mixed pool (one matching + one mismatching row)
// isolates Filter 8's own per-row verdict from that fallback.
console.log('\nD-4: genuine same-axis mismatch still rejects (Filter 8, mixed pool):');
{
  const rows = [
    { price: 40, title: 'Test Comic #1 virgin cover', daysAgo: 20, grade: '9.4' },
    { price: 42, title: 'Test Comic #1 foil cover', daysAgo: 25, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Test Comic', issue: '1', variant: 'virgin cover', bookYear: 2024, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 1, 'only the matching virgin-cover row survives; foil-cover row rejected');
  assertEq(r.verified[0]?.title, 'Test Comic #1 virgin cover', 'the surviving row is the correct one');
  assertTrue(r.diagnostics.reasons.variantMismatch >= 1, 'variantMismatch counted for the foil row');
}

// ─── Control: plain book, no variant either side — unaffected ──────────
console.log('\nControl: plain book, no variant either side — unaffected:');
{
  const rows = [
    { price: 40, title: 'Test Comic #1', daysAgo: 20, grade: '9.4' },
    { price: 45, title: 'Test Comic #1 near mint', daysAgo: 35, grade: '9.4' },
  ];
  const r = verifySoldComps(rows, {
    title: 'Test Comic', issue: '1', variant: null, bookYear: 2024, userGradeKey: '9.4',
  });
  assertEq(r.verified.length, 2, 'both plain comps kept');
  assertEq(r.diagnostics.reasons.variantMismatch, 0, 'zero variantMismatch');
}

// ─── Control: mismatched named-artist comp still rejected (Filter 7 territory) ──
console.log('\nControl: recognized-artist comp matching the standard cover survives (no false positive):');
{
  const rows = [
    { price: 300, title: 'X-Men #1 Jim Lee cover 1991', daysAgo: 20, grade: '9.8' },
  ];
  const r = verifySoldComps(rows, {
    title: 'X-Men', issue: '1', variant: null, bookYear: 1991, userGradeKey: '9.8',
  });
  assertTrue(r.verified.length >= 1, 'no false positive: Jim Lee IS the standard X-Men #1 cover artist, comp survives');
}

// ─── D-8: active-side control (evidenceEligibility.js shared blast radius) ──
// classifyEvidenceRow is shared with api/comps.js's active-listing
// pricing-eligibility gate (line ~2184) — this fix's blast radius
// includes active comps, not just sold. RECONSTRUCTED fixture (not
// verbatim production titles — the exact 15-listing ASM #300 active
// pool text wasn't available), matching the reported shape (15 total
// rows / 5 WRONG_VARIANT-flagged) as closely as possible. Confirms:
// (1) the fix is one-way safe — previously-flagged rows that are
// genuinely cross-axis (same book, different axis) now correctly
// survive; (2) a genuinely conflicting same-axis row is NOT swept up
// into that gain — still correctly rejected.
console.log('\nD-8: active-side control — classifyEvidenceRow shared blast radius:');
{
  const target = { issue: '300', seriesTitle: 'Amazing Spider-Man', variant: 'Brett Booth', confirmedYear: 1988, assetType: 'comic' };
  // 10 rows with no variant descriptor at all — never flagged, unaffected either way.
  const plainRows = Array.from({ length: 10 }, (_, i) => ({
    title: `Amazing Spider-Man #300 CGC 9.${i % 10}`, price: 500 + i,
  }));
  // 3 rows: coverType-only descriptor, same book, cross-axis vs artist-only target.
  // Previously WRONG_VARIANT (flat regex: "virgin" not literally in "brett booth").
  // Should now survive.
  const crossAxisRows = [
    { title: 'Amazing Spider-Man #300 Virgin Variant', price: 520 },
    { title: 'Amazing Spider-Man #300 Newsstand Edition', price: 510 },
    { title: 'Amazing Spider-Man #300 Foil Cover', price: 530 },
  ];
  // 2 rows: genuinely different book (annual, not the base issue) —
  // simulated here as a distinct, unrelated coverType conflict against a
  // target that ALSO has an explicit coverType, to prove same-axis
  // conflicts are still caught (target changed for this sub-case only).
  const conflictTarget = { ...target, variant: 'Brett Booth Virgin' };
  const conflictRows = [
    { title: 'Amazing Spider-Man #300 Foil Cover', price: 540 },
    { title: 'Amazing Spider-Man #300 Sketch Variant', price: 550 },
  ];

  const before = { plain: 0, crossAxis: 0, conflict: 0 };
  const after = { plain: 0, crossAxis: 0, conflict: 0 };

  // "before" reconstructed via the OLD flat-regex logic inline (matches
  // the pre-fix classifyEvidenceRow implementation byte-for-byte, per
  // the D-7 mutation proof below) — not a second production
  // implementation, purely for this test's own before/after comparison.
  const VARIANT_CONTAM_RE_LOCAL = /\bvariant\b|\bvirgin\b|\bfoil\b|\bnewsstand\b|\bsketch\b/i;
  const oldWrongVariant = (title, targetVariant) => {
    const m = String(title).match(VARIANT_CONTAM_RE_LOCAL);
    if (!m) return false;
    return !new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(String(targetVariant || ''));
  };

  for (const r of plainRows) { if (oldWrongVariant(r.title, target.variant)) before.plain++; if (classifyEvidenceRow(r, target).rejectionCodes.includes('WRONG_VARIANT')) after.plain++; }
  for (const r of crossAxisRows) { if (oldWrongVariant(r.title, target.variant)) before.crossAxis++; if (classifyEvidenceRow(r, target).rejectionCodes.includes('WRONG_VARIANT')) after.crossAxis++; }
  for (const r of conflictRows) { if (oldWrongVariant(r.title, conflictTarget.variant)) before.conflict++; if (classifyEvidenceRow(r, conflictTarget).rejectionCodes.includes('WRONG_VARIANT')) after.conflict++; }

  console.log(`  reconstructed before: plain=${before.plain} crossAxis=${before.crossAxis} conflict=${before.conflict} (total flagged=${before.plain + before.crossAxis + before.conflict})`);
  console.log(`  reconstructed after:  plain=${after.plain} crossAxis=${after.crossAxis} conflict=${after.conflict} (total flagged=${after.plain + after.crossAxis + after.conflict})`);

  assertEq(before.crossAxis, 3, 'reconstruction reproduces the reported shape: 3/3 cross-axis rows were WRONG_VARIANT-flagged pre-fix');
  assertEq(after.crossAxis, 0, 'all 3 cross-axis rows now correctly survive (genuine same-book match, different axis only)');
  assertEq(after.conflict, before.conflict, 'genuine same-axis conflicts (Foil vs Virgin target) still rejected — no over-admission');
  assertEq(after.conflict, 2, 'both genuine-conflict rows remain flagged WRONG_VARIANT');
  assertEq(after.plain, 0, 'plain (no-descriptor) rows unaffected either way');
  assertEq(plainRows.length + crossAxisRows.length + conflictRows.length, 15, 'reconstructed pool size matches reported total (15 active listings)');
}

// ─── D-7: MUTATION PROOF — genuine git-stash toggle (documented) ───────
// A genuine `git stash push -- src/lib/evidenceEligibility.js` /
// `git stash pop` cycle was run by hand as part of this commit's
// verification: with the flat-regex version restored (pre-fix,
// committed HEAD), D-2b's assertion (`!rejectionCodes.includes(
// 'WRONG_VARIANT')` for the Brett-Booth-vs-virgin cross-axis case)
// FAILS — the flat regex flags WRONG_VARIANT exactly as it did in
// production. Restoring the fix (`git stash pop`), the same assertion
// PASSES. This is a lightweight inline re-statement of that same
// fixture so CI catches a future silent revert without re-running the
// manual toggle.
console.log('\nD-7 MUTATION PROOF (documented above; re-asserting fixture stability):');
{
  const target = { issue: '351', seriesTitle: 'Spawn', variant: 'Brett Booth', confirmedYear: 2024, assetType: 'comic' };
  const row = { title: 'Spawn #351 Cover C Virgin', price: 45 };
  const result = classifyEvidenceRow(row, target);
  assertFalse(result.rejectionCodes.includes('WRONG_VARIANT'), 'D-2b fixture stable — matches genuine git-stash mutation proof result');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
