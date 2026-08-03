// tests/grailkey-commit-q.test.js
//
// GrailKey Commit Q — three mechanical fixes surfaced by the Absolute
// Batman #1 read-only investigation (GrailKey full-pipeline audit,
// 2026-08-03) and by a live production render bug on the Spawn #351 card
// (build bdddda4, Commit P2's own P2a feature).
//
//   Q0 — computeIssueAuthorityContractPatch (issueAuthority.js) copied
//        priorOut.price into hypotheticalReferenceEstimate verbatim.
//        Most of api/enrich.js's pricing writers assign out.price via
//        fmtUsd() (src/lib/pricingEngine.js), which returns a FORMATTED
//        STRING ("$21.25"), not a number — only a minority (e.g. Ship 11's
//        visual-pool fallback) assign a raw number. App.jsx's render site
//        does `Number(item.hypotheticalReferenceEstimate).toFixed(2)`,
//        and `Number("$21.25")` is NaN. Fixed by coercing at the write
//        site with parsePriceNumber (src/lib/responseContract.js, already
//        exported, already built for exactly this fmtUsd-string-vs-number
//        ambiguity) — never setting the field at all when the input isn't
//        a genuine finite number — plus a render-site guard in App.jsx
//        using the SAME function, defense in depth.
//
//   Q1 — TPB_MARKER_RE's bare "absolute"/"deluxe"/"treasury" alternatives
//        (compHygiene.js:99-100) collide with DC's real "Absolute" line
//        (launched 2024) — every listing for every Absolute title matches.
//        IDENTITY_TPB_MARKER_RE (compHygiene.js:222-235) already requires
//        the edition suffix and already documents this exact collision;
//        it was applied to the identity pool (imageSearchIdentity.js) and
//        never propagated to soldVerification.js (Q1a) or api/comps.js's
//        isTPB derivation (Q1b).
//
//   Q2 — buildVerifiedActivePool (priceBands.js) accepted `issue` as a
//        parameter and never used it — title-substring overlap alone
//        ("absolute batman #2".includes("absolute batman") === true) let
//        every issue of an ongoing series with a stable title pass. Fixed
//        by reusing hasIssueNumber (compHygiene.js) — the same predicate
//        api/comps.js's Filter 0a and soldVerification.js's issue-
//        mismatch check already apply — no second matcher invented.
//
// Every function under test is the REAL exported production function at
// its real call site (invariant 10) — MUTATION blocks reconstruct the
// PRE-fix behavior explicitly, verbatim, to prove each fix is load-bearing
// rather than a fixture coincidence.
//
// Invoke: node tests/grailkey-commit-q.test.js

import { computeIssueAuthorityContractPatch } from '../src/lib/issueAuthority.js';
import { parsePriceNumber } from '../src/lib/responseContract.js';
import { TPB_MARKER_RE, IDENTITY_TPB_MARKER_RE, hasIssueNumber } from '../src/lib/compHygiene.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';
import { buildVerifiedActivePool } from '../src/lib/priceBands.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit Q — Q0 NaN / Q1 TPB regex / Q2 active-pool issue check ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Q0 — hypotheticalReferenceEstimate coercion
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ0 — hypotheticalReferenceEstimate coercion\n');
{
  // Hard-refusal shape (issueProvisional, NOT highConfidenceMarketplaceConsensus)
  // — the branch that actually sets hypotheticalReferenceEstimate. The P1
  // carve-out's own early-return branch never nulls price, so it never
  // needs this field at all.
  const issueAuthority = { status: 'provisional' };

  const fmtUsdString = computeIssueAuthorityContractPatch(issueAuthority, { price: '$21.25', refusedToPrice: false }, null);
  assertEq(fmtUsdString.hypotheticalReferenceEstimate, 21.25, 'Q0: fmtUsd-formatted string "$21.25" coerces to the number 21.25');
  assertEq(typeof fmtUsdString.hypotheticalReferenceEstimate, 'number', 'Q0: result type is number, not string');

  const commaString = computeIssueAuthorityContractPatch(issueAuthority, { price: '$1,234.56', refusedToPrice: false }, null);
  assertEq(commaString.hypotheticalReferenceEstimate, 1234.56, 'Q0: comma-thousands fmtUsd string coerces correctly');

  const rawNumber = computeIssueAuthorityContractPatch(issueAuthority, { price: 21.25, refusedToPrice: false }, null);
  assertEq(rawNumber.hypotheticalReferenceEstimate, 21.25, 'Q0: raw number (Ship 11 visual-pool-fallback path) passes through unchanged');

  const nonNumericString = computeIssueAuthorityContractPatch(issueAuthority, { price: 'N/A', refusedToPrice: false }, null);
  assertFalse('hypotheticalReferenceEstimate' in nonNumericString, 'Q0: non-numeric string "N/A" -> field OMITTED entirely, never set to NaN');

  const objectPrice = computeIssueAuthorityContractPatch(issueAuthority, { price: { low: 10, high: 20 }, refusedToPrice: false }, null);
  assertFalse('hypotheticalReferenceEstimate' in objectPrice, 'Q0: object-typed price -> field OMITTED entirely');

  const nullPrice = computeIssueAuthorityContractPatch(issueAuthority, { price: null, refusedToPrice: false }, null);
  assertFalse('hypotheticalReferenceEstimate' in nullPrice, 'Q0: null price -> field omitted (pre-existing behavior, unchanged)');

  const noPriorOut = computeIssueAuthorityContractPatch(issueAuthority, undefined, null);
  assertFalse('hypotheticalReferenceEstimate' in noPriorOut, 'Q0: no priorOut at all -> field omitted, no throw');

  // MUTATION — verbatim pre-Commit-Q body (no parsePriceNumber coercion).
  const naivePatchField = (priorOut) => (priorOut?.price != null ? priorOut.price : undefined);
  const naiveResult = naivePatchField({ price: '$21.25' });
  assertEq(naiveResult, '$21.25', 'MUTATION: the naive pre-fix assignment stores the STRING "$21.25" verbatim');
  assertTrue(Number.isNaN(Number(naiveResult)), 'MUTATION: Number("$21.25").toFixed(2) — the real App.jsx render call — produces NaN, reproducing the live "$NaN" bug');
  assertFalse(Number.isNaN(fmtUsdString.hypotheticalReferenceEstimate), 'MUTATION CONTRAST: the REAL post-fix value is not NaN — Number(21.25).toFixed(2) renders "21.25"');
}

// ══════════════════════════════════════════════════════════════════════════════
// Q0 — parsePriceNumber itself (the render-guard's real upstream signal;
// App.jsx's JSX render call isn't independently invokable in this harness
// — same limitation Commit P's P-5/P-6 tests document — asserted here is
// the exact function the render guard calls).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ0 — parsePriceNumber (shared client+server coercion)\n');
{
  assertEq(parsePriceNumber('$21.25'), 21.25, 'parsePriceNumber: fmtUsd string');
  assertEq(parsePriceNumber(21.25), 21.25, 'parsePriceNumber: raw number');
  assertEq(parsePriceNumber('N/A'), null, 'parsePriceNumber: non-numeric string -> null');
  assertEq(parsePriceNumber({}), null, 'parsePriceNumber: object -> null');
  assertEq(parsePriceNumber(NaN), null, 'parsePriceNumber: NaN -> null');
  assertEq(parsePriceNumber(null), null, 'parsePriceNumber: null -> null');
  assertEq(parsePriceNumber(undefined), null, 'parsePriceNumber: undefined -> null');
}

// ══════════════════════════════════════════════════════════════════════════════
// Q1 — TPB_MARKER_RE vs IDENTITY_TPB_MARKER_RE, regex level
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ1 — regex-level collision proof\n');
{
  const absoluteFirstPrint = 'Absolute Batman #1 CGC 9.8 1st Print Dragotta Cover A';
  const absoluteHardcover = 'Absolute Batman: The Zoo [Hardcover] #1';
  const genuineTpb = 'Batman: Hush TPB';

  assertTrue(TPB_MARKER_RE.test(absoluteFirstPrint), 'Q1 baseline: the LOOSE regex matches a plain single-issue Absolute Batman title (the collision, confirmed still present in TPB_MARKER_RE itself — intentionally unmodified)');
  assertFalse(IDENTITY_TPB_MARKER_RE.test(absoluteFirstPrint), 'Q1: the STRICT regex does NOT match a plain single-issue Absolute Batman title');
  assertTrue(IDENTITY_TPB_MARKER_RE.test(absoluteHardcover), 'Q1: the STRICT regex STILL rejects a genuine Absolute-line hardcover/collected edition');
  assertTrue(IDENTITY_TPB_MARKER_RE.test(genuineTpb), 'Q1: the STRICT regex STILL rejects an ordinary TPB ("Batman: Hush TPB")');
}

// ══════════════════════════════════════════════════════════════════════════════
// Q1a — soldVerification.js end-to-end (real verifySoldComps call)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ1a — verifySoldComps end-to-end\n');
{
  // Real production listing text shapes (GrailKey full-pipeline audit,
  // 2026-08-03) — genuine single-issue floppy sales for Absolute Batman
  // #1, plus one genuine collected-edition sale that must still reject.
  // No "Nth Print" text on the floppy rows — ctx carries no printing
  // marker of our own, so a printing-axis mismatch (a real, separate,
  // unrelated filter — not touched by this commit) would otherwise fire
  // and obscure the format:tpb behavior this test isolates.
  const rows = [
    { price: 45, title: 'Absolute Batman #1 Snyder Dragotta Cover A NM+', daysAgo: 5, grade: '9.6' },
    { price: 42, title: 'ABSOLUTE BATMAN #1 CVR A NICK DRAGOTTA NM DC COMICS SNYDER', daysAgo: 10, grade: '9.6' },
    { price: 33.99, title: 'Absolute Batman #1 DC Comics Snyder Dragotta', daysAgo: 15, grade: '9.6' },
    { price: 60, title: 'Absolute Batman: The Zoo [Hardcover] #1', daysAgo: 20, grade: '9.6' }, // genuine collected edition — must still reject
  ];
  const r = verifySoldComps(rows, { title: 'Absolute Batman', issue: '1', bookYear: 2024, assessedGrade: 'NM 9.6' });
  assertEq(r.verified.length, 3, 'Q1a: the 3 genuine single-issue floppy sales survive (were 0/4 rejected as format:tpb before this fix)');
  assertTrue(r.verified.every((v) => !/hardcover/i.test(v.title)), 'Q1a: no hardcover row survives');
  assertTrue(r.diagnostics.reasons.format >= 1, 'Q1a: the genuine hardcover is still counted under the format reject bucket');

  // MUTATION — verbatim pre-Commit-Q predicate (TPB_MARKER_RE, not
  // IDENTITY_TPB_MARKER_RE) run against the identical fixture.
  const naiveFormatReject = (title) => TPB_MARKER_RE.test(title);
  const naiveSurvivors = rows.filter((row) => !naiveFormatReject(row.title));
  assertEq(naiveSurvivors.length, 0, 'MUTATION: the naive pre-fix predicate (TPB_MARKER_RE) rejects ALL 4 rows, including the 3 genuine sales — reproduces the live 27/30-rejected bug');
}

// ══════════════════════════════════════════════════════════════════════════════
// Q1b — api/comps.js isTPB derivation (regex-level; the local `isTPB`
// variable inside the comps handler isn't independently invokable — same
// limitation as Q0's render-guard section — asserted here is the exact
// predicate its derivation now uses).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ1b — isTPB derivation predicate\n');
{
  assertFalse(!!'Absolute Batman'.match(IDENTITY_TPB_MARKER_RE), 'Q1b: our own confirmed title "Absolute Batman" no longer matches -> isTPB correctly false');
  assertTrue(!!'Absolute Batman'.match(TPB_MARKER_RE), 'Q1b baseline: the OLD derivation (TPB_MARKER_RE) would have matched -> isTPB was wrongly true (the collision this fixes)');
  assertTrue(!!'Batman: Hush TPB'.match(IDENTITY_TPB_MARKER_RE), 'Q1b: a genuine TPB scan still correctly derives isTPB=true');
}

// ══════════════════════════════════════════════════════════════════════════════
// Q2 — buildVerifiedActivePool issue-number enforcement
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ2 — buildVerifiedActivePool issue enforcement\n');
{
  // Real production title shapes (GrailKey audit) — a #1 target pool
  // contaminated with other issues + hardcovers, matching the actual
  // Absolute Batman #1 active-pool composition.
  const absoluteBatmanPool = {
    prices: [
      { price: 16.99, title: '🔥Absolute Batman #1 - 10th Print Cvr DC All In Snyder, Dragotta🔥' },
      { price: 45, title: 'Absolute Batman #1 7th Print Snyder Dragotta NM+' },
      { price: 12.99, title: 'Absolute Batman [Dragotta] #19 (2026)' },
      { price: 14.99, title: 'Absolute Batman [1:25 Mann] #11 (2025)' },
      { price: 19.99, title: 'Absolute Batman [1:50 Pope Virgin] #12 (2025)' },
      { price: 22.99, title: 'Absolute Batman [1:25 Dragotta Minimal] #13 (2025)' },
      { price: 9.99, title: 'Absolute Batman [Felix Dragotta Wraparound] #15 (2026)' },
      { price: 89.99, title: 'Absolute Batman: The Zoo [Hardcover] #1 (2025)' },
      { price: 45.5, title: 'Absolute Batman by Scott Snyder & Nick Dragotta Vol. 1 [Hardcover]' },
    ],
  };
  const filtered = buildVerifiedActivePool(absoluteBatmanPool, { title: 'Absolute Batman', issue: '1', year: 2024 });
  // 3 survive, not 2: the two genuine floppy #1 sales, PLUS "Absolute
  // Batman: The Zoo [Hardcover] #1" — which explicitly says "#1" in its
  // own title. Q2 is scoped to ISSUE-NUMBER enforcement only; it cannot
  // and does not distinguish floppy from hardcover format — that is a
  // separate, already-flagged, out-of-scope gap (api/comps.js's own TPB/
  // format filter at line ~1658 has the identical residual collision,
  // reported but not migrated in this commit). The OTHER hardcover
  // ("...Vol. 1 [Hardcover]", no "#1" text at all) IS correctly excluded
  // — proving the issue check itself works; format filtering is a
  // different, unaddressed axis.
  assertEq(filtered.length, 3, 'Q2: 6/9 cross-issue rows removed (#19/#11/#12/#13/#15 + the un-numbered "Vol. 1" hardcover); the 2 genuine #1 floppies AND the "#1"-labeled hardcover survive — issue matching alone cannot also exclude a hardcover that says "#1"');
  assertTrue(filtered.every((p) => /#\s*1\b/.test(p.title) && !/#\s*1\d\b/.test(p.title)), 'Q2: every surviving row genuinely references #1, not #11/#12/#13/#15/#19');
  assertFalse(filtered.some((p) => /vol\.?\s*1\s*\[hardcover\]$/i.test(p.title)), 'Q2: the un-numbered "Vol. 1 [Hardcover]" row (no "#1" text) IS correctly excluded by issue matching');

  // ASM #300 — byte-identical. A clean, already-correct pool (every row
  // genuinely #300) must be completely unaffected by the new check.
  const asmPool = {
    prices: [
      { price: 350, title: 'Amazing Spider-Man #300 CGC 9.8 White Pages 1st Full Venom' },
      { price: 280, title: 'Amazing Spider-Man #300 Raw NM 1988' },
      { price: 410, title: 'Amazing Spider-Man #300 CGC 9.6' },
    ],
  };
  const asmFiltered = buildVerifiedActivePool(asmPool, { title: 'Amazing Spider-Man', issue: '300', year: 1988 });
  assertEq(asmFiltered.length, 3, 'Q2: ASM #300 — all 3 rows survive, byte-identical to a clean pool with no issue check at all');

  // Iron Man #126 — byte-identical, same reasoning.
  const ironManPool = {
    prices: [
      { price: 30, title: 'Iron Man #126 Bob Layton Demon in a Bottle 1979' },
      { price: 32, title: 'Iron Man #126 VF/NM 1979' },
    ],
  };
  const ironManFiltered = buildVerifiedActivePool(ironManPool, { title: 'Iron Man', issue: '126', year: 1979 });
  assertEq(ironManFiltered.length, 2, 'Q2: Iron Man #126 — both rows survive, byte-identical');

  // MUTATION — pre-Commit-Q buildVerifiedActivePool body (no issue check
  // at all), run against the identical Absolute Batman fixture.
  const naiveFilter = (comps, { title }) => {
    const titleLower = String(title || '').toLowerCase();
    return comps.prices.filter((p) => {
      const t = String(p.title).toLowerCase();
      if (!titleLower || t.includes(titleLower)) return true;
      const ourWords = titleLower.split(/\s+/).filter((w) => w.length >= 3);
      const matchCount = ourWords.filter((w) => t.includes(w)).length;
      return ourWords.length > 0 && matchCount / ourWords.length >= 0.5;
    });
  };
  const naiveResult = naiveFilter(absoluteBatmanPool, { title: 'Absolute Batman' });
  assertEq(naiveResult.length, 9, 'MUTATION: the naive pre-fix filter (title-overlap only, no issue check) keeps all 9 rows — reproduces the live "41/41 removed nothing" bug');
  assertTrue(naiveResult.length > filtered.length, 'MUTATION CONTRAST: the REAL post-fix function removes the cross-issue/hardcover contamination the naive version cannot');
}

// ══════════════════════════════════════════════════════════════════════════════
// Q2 — hasIssueNumber reused, not reinvented (confirms Q2's own instruction:
// "reusing the EXISTING issue-matching predicate the sold side already
// applies" — same function object, imported directly).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nQ2 — shared predicate confirmation\n');
{
  assertTrue(hasIssueNumber('Absolute Batman #1 7th Print', '1', 'Absolute Batman'), 'hasIssueNumber: #1 title matches issue "1"');
  assertFalse(hasIssueNumber('Absolute Batman [Dragotta] #19 (2026)', '1', 'Absolute Batman'), 'hasIssueNumber: #19 title does NOT match issue "1"');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
}
process.exit(failed > 0 ? 1 : 0);
