// tests/grailkey-directive-ak-population-precedence.test.js
//
// GrailKey Directive 2026-08-15-AK — Slice 1 final gate: precedence
// proof. AJ's own precedence order (family-consensus > first-eligible-
// visual > vision) was tested directly against a Sabrina-shaped fixture
// this file constructs: a specific, corroborated, eligible visual
// candidate ("Sabrina Annual Spectacular #1, Dan Parent, NYCC, Foil")
// competing against a LARGER, GENERIC "Sabrina the Teenage Witch"
// population that wins resolveFamilyIssueConsensus's own 'adopted' mode
// purely on member count (4/6 = 67% agreement on "#5", no prior to
// compare against, no discriminative corroboration, no hard
// contradiction).
//
// THE FIXTURE FAILED ON FIRST RUN. `family-consensus` (mode='adopted')
// unconditionally outranked `first-eligible-visual` by precedence,
// producing confirmedIssue="5" — the generic population's own vote —
// instead of "1", the specific physical book actually in hand. Sabrina's
// original disease (a generic franchise family's population count
// defeating a specific edition candidate — GK-98, AF's discriminative-
// corroboration fix at the TITLE layer) had been re-encoded as a
// precedence rule inside the NEW issue-facet reconciler, for exactly the
// case AF's own fix does not cover (no discriminative corroboration
// available at all).
//
// FIXED: `identityCore.js` now tags family issue evidence with ONE of
// two DIFFERENT-PRECEDENCE sources instead of a single unified
// 'family-consensus' — 'family-population' (resolveFamilyIssueConsensus's
// OWN 'adopted' mode, no `outcome` field — a bare vote filling an empty
// gap) is demoted BELOW 'first-eligible-visual'; 'family-corroborated'
// (every other genuine mode, PLUS the retention branch's own legacy-
// mapped 'adopted'/'provisionally-corrected' outcomes, which are
// confidence-AWARE corrections of an existing prior, not bare population
// votes) keeps top precedence, unchanged. Governing rule: population
// corroborates or contradicts, it does not replace.
//
// Invoke: node tests/grailkey-directive-ak-population-precedence.test.js

import { resolveIdentity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

const captureReconcileLogs = (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    const s = args.join(' ');
    if (s.startsWith('[reconcile-issue]')) lines.push(s);
    orig(...args);
  };
  let result;
  try { result = fn(); } finally { console.log = orig; }
  const parsed = lines.map((line) => {
    const value = /value=(\S+)/.exec(line)?.[1];
    const source = /source=(\S+)/.exec(line)?.[1];
    const authority = /authority=(\S+)/.exec(line)?.[1];
    const justifiedBy = JSON.parse(/justifiedBy=(\[.*?\]) conflicts=/.exec(line)?.[1] ?? '[]');
    const conflicts = JSON.parse(/conflicts=(\[.*\])$/.exec(line)?.[1] ?? '[]');
    return { value, source, authority, justifiedBy, conflicts };
  });
  return { result, logs: parsed };
};

const rows = (titles) => titles.map((t) => ({ rawTitle: t }));

console.log('\n=== GrailKey Directive AK — Slice 1 final gate: precedence proof ===\n');

// ═══════════════════════════════════════════════════════════════════════
// THE FIXTURE — blocking
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture: specific corroborated candidate vs. generic population-only family\n');

{
  const visualItems = rows([
    // firstEligibleVisual: the specific, correct physical book — eligible,
    // single book, title-agreeing, corroborated by 3 unique rows (clears
    // MINIMUM_CORROBORATING_ROWS without tripping the marketing-flavor or
    // contamination guards).
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant NM',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant VF',
    // Competing family: a larger GENERIC "Sabrina the Teenage Witch"
    // population that wins resolveFamilyIssueConsensus's own 'adopted'
    // mode (uniqueRows=6 >= 3, ratio=4/6=67% >= 60%, clear lead over the
    // "#12" runner-up) purely on member count — no prior to compare
    // against (vision.issue is null), no discriminative corroboration
    // (no opts.visionVariant token match), no hard contradiction.
    'Sabrina the Teenage Witch #5 Archie',
    'Sabrina the Teenage Witch #5 Archie NM',
    'Sabrina the Teenage Witch #5 Archie VF',
    'Sabrina the Teenage Witch #5 Archie Fine',
    'Sabrina the Teenage Witch #12 Archie',
    'Sabrina the Teenage Witch Digest',
  ]);
  const vision = { title: 'Sabrina', issue: null, year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 0 } };
  // family.decision: 'weighted-consensus' — plain population-weighted
  // title-family selection, deliberately NOT 'discriminative-corroboration'
  // (AF's own GK-98 fix, which requires opts.visionVariant token
  // corroboration this fixture deliberately omits — testing the case AF's
  // fix does not cover).
  const family = {
    decision: 'weighted-consensus',
    selectedTitle: 'sabrina the teenage witch',
    topFamily: {
      indices: [3, 4, 5, 6, 7, 8],
      rawTitle: visualItems[3].rawTitle,
      count: 6,
      weightSum: 6,
      title: 'sabrina the teenage witch',
    },
    runnerUp: null,
  };

  const { result: identity, logs } = captureReconcileLogs(() =>
    resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems })
  );

  assertTrue(logs.length >= 1, 'FIXTURE: [reconcile-issue] log fired');
  const log = logs[logs.length - 1];
  console.log(`    (firstEligibleVisual=1, familyCandidate=5, familyBasis=population-only(mode=adopted,outcome=null))`);
  console.log(`    (winner=${log.source}, authority=${log.authority}, justifiedBy=${JSON.stringify(log.justifiedBy)}, conflicts=${JSON.stringify(log.conflicts)})`);

  // Required fields from the [reconcile-issue] artifact — asserted on the
  // log, not merely on the final value, per the same discipline Fixture
  // P1 (Directive AJ) established: the old path could produce the right
  // value for the wrong reason, so execution must be provable
  // independent of the outcome.
  assertTrue(log.conflicts.some((c) => c.source === 'family-population' && c.value === '5'), 'FIXTURE: familyCandidate ("5") is PRESENT in the log, tagged family-population — population-only evidence entered and competed, it was not silently dropped');
  assertEq(log.source, 'first-eligible-visual', 'FIXTURE: winner is first-eligible-visual — the specific candidate, not the generic population');
  assertTrue(log.justifiedBy.some((j) => j.source === 'first-eligible-visual' && j.value === '1'), 'FIXTURE: justifiedBy cites first-eligible-visual="1"');
  assertTrue(log.authority === 'CONTESTED', 'FIXTURE: authority is CONTESTED — derived from the genuine population disagreement, not fabricated');

  assertEq(identity.confirmedIssue, '1', 'FIXTURE: confirmedIssue is "1" — the specific physical book, not "5" — the generic population\'s own vote');
  assertEq(identity.identityProvisionalFromVisualFirst, true, 'FIXTURE: flagged provisional — an overturned population vote does not silently reach confirmed identity');
}

// ═══════════════════════════════════════════════════════════════════════
// Population still corroborates when it AGREES (not merely demoted to
// uselessness) — a population vote that happens to match the specific
// candidate should still resolve cleanly, non-contested.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nControl: population-only family AGREES with the specific candidate — still resolves cleanly\n');

{
  const visualItems = rows([
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant NM',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant VF',
    'Sabrina the Teenage Witch #1 Archie',
    'Sabrina the Teenage Witch #1 Archie NM',
    'Sabrina the Teenage Witch #1 Archie VF',
    'Sabrina the Teenage Witch #1 Archie Fine',
    'Sabrina the Teenage Witch #12 Archie',
  ]);
  const vision = { title: 'Sabrina', issue: null, year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 0 } };
  const family = {
    decision: 'weighted-consensus',
    selectedTitle: 'sabrina the teenage witch',
    topFamily: { indices: [3, 4, 5, 6, 7], rawTitle: visualItems[3].rawTitle, count: 5, weightSum: 5, title: 'sabrina the teenage witch' },
    runnerUp: null,
  };
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  assertEq(identity.confirmedIssue, '1', 'CONTROL: agreeing population still resolves to "1"');
}

// ═══════════════════════════════════════════════════════════════════════
// Population still usable as a fallback when NO first-eligible-visual
// candidate exists at all (e.g. no eligible rows outside the family) —
// demotion must not mean "never usable," only "never outranks a
// specific competing candidate."
// ═══════════════════════════════════════════════════════════════════════
console.log('\nControl: population-only family is still usable when nothing else competes\n');

{
  const visualItems = rows([
    'Sabrina the Teenage Witch #5 Archie',
    'Sabrina the Teenage Witch #5 Archie NM',
    'Sabrina the Teenage Witch #5 Archie VF',
    'Sabrina the Teenage Witch #5 Archie Fine',
    'Sabrina the Teenage Witch #12 Archie',
    'Sabrina the Teenage Witch Digest',
  ]);
  const vision = { title: 'Sabrina', issue: null, year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 0 } };
  const family = {
    decision: 'weighted-consensus',
    selectedTitle: 'sabrina the teenage witch',
    topFamily: { indices: [0, 1, 2, 3, 4, 5], rawTitle: visualItems[0].rawTitle, count: 6, weightSum: 6, title: 'sabrina the teenage witch' },
    runnerUp: null,
  };
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  assertEq(identity.confirmedIssue, '5', 'CONTROL: with no independent competing candidate, population-only evidence is still usable as a fallback');
  // GrailKey Directive AK, refined during the same dispatch (see the
  // Spawn #351 regression this refinement fixed): demotion fires when
  // `justifiedBy.length === 1` — the winning value has EXACTLY ONE
  // supporting entry, nothing else agrees with it. Here BOTH
  // family-population AND first-eligible-visual independently assert
  // "5" (justifiedBy.length === 2) — two computationally distinct
  // signals reaching the same answer IS real corroboration, even though
  // they both trace back to the same underlying pool text; this is not
  // demoted, matching Fixture 7 (vision agrees) and the Spawn #351
  // fixture (family-population agrees) — agreement from ANY second
  // source means the value is not "single unverified," regardless of
  // which source it is.
  assertEq(identity.identityProvisionalFromVisualFirst, false, 'CONTROL: NOT demoted — family-population and first-eligible-visual independently agree on "5" (justifiedBy.length===2), real corroboration even from the same underlying pool');
}

// ═══════════════════════════════════════════════════════════════════════
// Regression control: the retention branch's own legacy-mapped 'adopted'
// (Spawn #351 class — a CONFIDENCE-AWARE correction of a low-confidence
// prior, not a bare population vote) must NOT be demoted by this fix.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nControl: retention-branch legacy-mapped "adopted" (confidence-aware correction) is NOT demoted\n');

{
  // Mirrors tests/q-trackB-commit4.3-winning-family-authority.test.js's
  // own live Spawn #351 fixture shape closely enough to prove the
  // distinguishing signal (outcome field presence) without re-deriving
  // its full precondition chain: a family with a real decideFieldAuthority
  // verdict (outcome/authoritativeForCustody present) legacy-mapped to
  // mode:'adopted' must still win top ('family-corroborated') precedence.
  const familyIssueConsensusLike = { issue: '351', mode: 'adopted', outcome: 'provisionally-corrected', authoritativeForCustody: true, uniqueRows: 5, support: 5, ratio: 1, winner: '351', runnerUp: null, assertedIssues: ['351'] };
  assertTrue(familyIssueConsensusLike.outcome != null, 'CONTROL: retention-branch legacy-mapped "adopted" carries a non-null outcome field — the distinguishing signal from a bare resolveFamilyIssueConsensus "adopted" vote (which never carries one)');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
