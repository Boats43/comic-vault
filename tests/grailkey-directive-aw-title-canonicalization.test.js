// tests/grailkey-directive-aw-title-canonicalization.test.js
//
// GrailKey Directive 2026-08-20-AW — GK-140 (linked: GK-125).
//
// AV (GK-133) made the rank-1 title candidate win in the fallback-vision
// void. Production immediately showed the cost of winning VERBATIM: the
// adopted candidate was raw seller text ("Venom Separation Anxiety By
// Mike Mayhew Poker Chip"), which over-narrows the PC/CV/comps queries
// built from it (no catalog product matches a seller's flourish) and
// pollutes the card display.
//
// Rule installed: at adoption, the rank-1 candidate is canonicalized
// (strip-only, C1) into a clean series-title candidate —
// `canonicalizeTitleCandidate` (src/lib/identityCore.js), wired into
// `reconcileTitleFacet`. The verbatim row remains evidence forever
// (`justifiedBy[].verbatim`, C3); only the DISPLAY/QUERY value changes.
// Cooperative title-election paths (weighted-consensus,
// discriminative-corroboration) never touch this function at all — it
// runs only in the exact void AV filled.
//
// Invoke: node tests/grailkey-directive-aw-title-canonicalization.test.js

import { resolveIdentity, canonicalizeTitleCandidate, reconcileTitleFacet } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

// ════════════════════════════════════════════════════════════════════════
// B1 (unit) — Venom qf5c6 production shape: clean candidate, verbatim kept
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B1: canonicalizeTitleCandidate — real Venom qf5c6 row ===');
{
  const raw = "Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip";
  const r = canonicalizeTitleCandidate(raw, { issueValue: '1' });
  assertEq(r.value, 'Venom Separation Anxiety', 'PRE->POST: clean candidate, no "By Mike Mayhew Poker Chip"');
  assertTrue(!r.overStripped, 'not flagged over-stripped — a real candidate remained');
  assertTrue(r.strippedLog.some((s) => s.class === 'attribution' && /mayhew/i.test(s.text)), 'attribution class stripped Mike Mayhew (C2 — same word the variant facet keeps)');
  assertTrue(r.strippedLog.some((s) => s.class === 'finish-descriptor' && /virgin/i.test(s.text)), 'finish-descriptor class stripped "Virgin"');
  assertTrue(r.strippedLog.some((s) => s.class === 'standalone-issue'), 'standalone-issue class stripped the duplicate bare "1"');
}

// ════════════════════════════════════════════════════════════════════════
// B1 (facet-level) — reconcileTitleFacet: candidate value clean, verbatim
// row preserved in justifiedBy (C3), authority still CONTESTED (C4)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B1: reconcileTitleFacet — candidate clean, verbatim preserved, still CONTESTED ===');
{
  const family = {
    decision: 'fallback-vision',
    selectedTitle: null,
    topFamily: {
      title: 'venom separation anxiety by mike mayhew poker chip', // buildTitleFamilies' own weaker cleaning — NOT what we use
      rawTitle: "Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip",
      indices: [0], count: 1, weightSum: 5,
    },
    runnerUp: null,
  };
  const { reconciled } = reconcileTitleFacet('Venom', family);
  assertEq(reconciled.value, 'Venom Separation Anxiety', 'facet-level candidate is the canonicalized form, not topFamily.title\'s own noisy version');
  assertEq(reconciled.source, 'first-eligible-visual', 'source is first-eligible-visual');
  assertEq(reconciled.authority, 'CONTESTED', 'C4: still CONTESTED — canonicalization does not change authority');
  const winnerEntry = reconciled.justifiedBy.find((e) => e.source === 'first-eligible-visual');
  assertTrue(!!winnerEntry, 'justifiedBy carries the winning entry');
  assertEq(winnerEntry?.verbatim, family.topFamily.rawTitle, 'C3: verbatim raw row preserved in justifiedBy, byte-identical to the frozen row');
}

// ════════════════════════════════════════════════════════════════════════
// B2 — no-over-strip controls (C6)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B2: no-over-strip negative controls ===');
{
  const cases = [
    ['Batman: The Signed Edition #22', '22', 'Batman: The Signed Edition', 'a real title containing "Signed" as an actual word survives intact'],
    ['What If? Spider-Man #1', '1', 'What If? Spider-Man', 'punctuation-bearing real title survives'],
    ['Marvel Comics Presents #1', '1', 'Marvel Comics Presents', 'publisher words INSIDE a real title survive — only a bare trailing suffix is stripped'],
    ['Spider-Man 2099 #1', '1', 'Spider-Man 2099', 'a real numeric title word (2099) is not mistaken for a grade/issue duplicate'],
  ];
  for (const [raw, issueValue, expected, label] of cases) {
    const r = canonicalizeTitleCandidate(raw, { issueValue });
    assertEq(r.value, expected, label);
  }
}
{
  // Detective Comics #1107, Corner Box / Jorge Jimenez class — a
  // parenthetical variant descriptor + attribution clause both strip
  // cleanly, leaving a readable series-title candidate; #1107 (leading,
  // duplicate of the already-adopted issue facet) is removed too.
  const raw = 'Detective Comics #1107 Batman (Corner Box Variant) by Jorge Jimenez';
  const r = canonicalizeTitleCandidate(raw, { issueValue: '1107' });
  assertEq(r.value, 'Detective Comics Batman', 'Detective: clean series-title candidate, #1107/parenthetical/attribution all stripped');
  assertTrue(r.strippedLog.some((s) => s.class === 'attribution' && /jorge/i.test(s.text)), 'attribution stripped "by Jorge Jimenez"');
  assertTrue(r.strippedLog.some((s) => s.class === 'parenthetical' && /corner box/i.test(s.text)), 'parenthetical class stripped "(Corner Box Variant)"');
  assertTrue(r.strippedLog.some((s) => s.class === 'standalone-issue' && s.text === '1107'), 'standalone-issue class stripped the duplicate leading #1107');
}
{
  // C6's own named failure mode: stripping collapses to nothing — the
  // over-strip guard must return the lightly-cleaned ORIGINAL, never an
  // empty string or a bare stopword.
  const raw = 'by The Corp';
  const r = canonicalizeTitleCandidate(raw, {});
  // "by The Corp" has no recognized creator, so attribution never fires
  // here — this specific string just demonstrates the guard's mechanics
  // directly against a string that WOULD collapse if a naive stripper
  // removed "by" unconditionally.
  assertTrue(r.value.length > 0, 'over-strip guard never returns an empty string');
}
{
  const r = canonicalizeTitleCandidate('The', {});
  assertTrue(r.overStripped === true || r.value === 'The', 'a single-stopword-only input either flags overStripped or leaves the original standing — never silently emptied');
}

// ════════════════════════════════════════════════════════════════════════
// B3 — cooperative-path byte-identity (weighted-consensus / discriminative-
// corroboration never reach the canonicalizer at all)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B3: cooperative election paths are byte-identical — canonicalizer unreachable ===');
{
  const vision = { title: 'Venom', issue: null, year: 2024, publisher: 'Marvel' };
  const ebay = { title: 'Venom Separation Anxiety', issue: '1', publisher: 'Marvel', agreement: { visionIssueCount: 3, total: 6 } };
  const visualItems = [
    { rawTitle: 'Venom Separation Anxiety 1 NM' },
    { rawTitle: 'Venom Separation Anxiety 1 Marvel 2024' },
    { rawTitle: 'Venom Separation Anxiety #1 Cover A' },
    { rawTitle: 'Venom Separation Anxiety 1 VF/NM' },
    { rawTitle: 'Venom Separation Anxiety 1 Comic Book' },
    { rawTitle: 'Venom Separation Anxiety 1 Marvel Comics' },
  ];
  const family = {
    decision: 'weighted-consensus',
    selectedTitle: 'venom separation anxiety',
    reason: 'weighted consensus',
    topFamily: {
      title: 'venom separation anxiety',
      rawTitle: 'Venom Separation Anxiety 1 NM', // deliberately noisy — must NOT leak through
      indices: [0, 1, 2, 3, 4, 5], count: 6, weightSum: 11,
    },
    runnerUp: null,
  };
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  // sanitizeSeriesTitle (the EXISTING, untouched-by-AW cooperative-path
  // mechanism) does not re-case its input — family.selectedTitle is
  // lowercase by construction (buildTitleFamilies' own token-consensus
  // shape), so the byte-identity check is against ITS actual casing
  // convention, not AW's canonicalizer (which never ran for this path).
  assertEq(identity.confirmedTitle, 'venom separation anxiety', 'weighted-consensus path resolves via the EXISTING sanitizeSeriesTitle mechanism, untouched by AW');
  assertEq(identity.titleAdoptedContested, false, 'titleAdoptedContested stays false — the canonicalizer never ran for this decision');
  assertEq(identity.reconciledTitle, null, 'reconciledTitle stays null — reconcileTitleFacet was never called for a cooperative election');
  assertTrue(identity.identitySource.startsWith('title-family-weighted-consensus'), 'identitySource is the cooperative-path source, no AW suffix appended');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
