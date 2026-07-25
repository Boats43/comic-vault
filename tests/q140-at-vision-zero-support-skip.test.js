// tests/q140-at-vision-zero-support-skip.test.js
//
// Q140-AT dispatch (2026-07-24, Adventure Time Summer Special #1 class) —
// scoped skip for the raw-pool vision-zero-support escalation/override
// block (identityCore.js ~1023-1075) when the winning title family's own
// resolveFamilyIssueConsensus result already adopted/corroborated the
// SAME issue confirmedIssue currently holds.
//
// Root cause (LAUNCH-AUDIT.md Section 10, Q12c finding, confirmed by
// direct code trace): imageSearchIdentity.js's extractIssueFromTitle nulls
// a matched "#1" whenever a marketing keyword (anniversary/special/
// collector/limited/exclusive/variant) falls within 30 characters of the
// match — a false-positive on Adventure Time Summer Special #1's own
// genuine title text. That nulled per-row .issue field is what
// ebay.agreement.visionIssueCount is tallied from (imageSearchIdentity.js
// ~595, ~620), computed pool-wide, BEFORE title-family clustering ever
// runs. So a family that reached full internal agreement on "#1" via
// resolveFamilyIssueConsensus (which re-derives directly from rawTitle
// with its own unguarded regex, immune to Q12c) could still get
// overridden or escalated to null by the raw-pool check immediately
// after, because that check never looked at the family's own result at
// all.
//
// Fix: familyAuthoritySkip (identityCore.js ~1023-1050) — skip ONLY when
// ALL of: the family authority is current (familyIssueConsensusResult was
// set inside THIS call's family-override branch, re-checked against
// family.decision), mode is 'adopted' or 'corroborated' (never
// 'conflict-locked'/'no-consensus'/'no-data' — a real conflict or an
// empty family result must still reach the raw-pool check unshortcut),
// authority.issue is non-null, and it string-equals confirmedIssue at
// check time. visionPublisherCount (the parallel publisher check,
// identityCore.js ~1124) is deliberately NOT touched by this dispatch —
// audit note only, queued as its own family-scoped re-tally fix.
//
// Five required fixtures, per dispatch instruction:
//   1. POS: Vision=1, rawSupport=0, family corroborated #1 -> survives, issue=1
//   2. POS: Vision=null, family adopted #1 -> survives, issue=1
//   3. NEG: rawSupport=0, no valid family authority -> escalation still fires -> ID_REQUIRED
//   4. NEG: family authority resolves #1 but confirmedIssue is #2 at check time (equality guard) -> NOT skipped
//   5. NEG: authority object exists but belongs to a previous/non-current family (current-family guard) -> NOT skipped
//
// Tests 4 and 5 are, by direct code trace, structurally unreachable
// through resolveIdentity's public call surface as currently written:
// confirmedIssue is set in the SAME statement pair that sets
// familyIssueConsensusResult inside each family branch (identityCore.js
// ~889, ~960), so the two can never diverge in a live call, and
// familyIssueConsensusResult is a fresh local per invocation (reset to
// null at declaration, ~838) that is only ever assigned inside a branch
// gated on the matching family.decision — so "non-current family" data
// cannot exist either. Both guards exist as defensive belt-and-suspenders
// for future refactors that might decouple the two, not as fixes for a
// currently-observed failure mode. Rather than fabricate a misleading
// resolveIdentity scenario that doesn't actually occur, tests 4 and 5
// verify the guard PREDICATE directly (mirrored from identityCore.js
// verbatim, cited by line range) plus, for test 5, a real resolveIdentity
// call proving that family data present under a NON-winning decision
// (e.g. 'fallback-vision') is correctly never treated as authority.
//
// Invoke: node tests/q140-at-vision-zero-support-skip.test.js

import { resolveIdentity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== Q140-AT dispatch — vision-zero-support family-authority skip ===\n');

const rows = (titles) => titles.map((t) => ({ rawTitle: t }));

// ═══════════════════════════════════════════════════════════════════════
// Test 1 (POS): Vision=1, rawSupport=0, family corroborated #1 -> survives
// ═══════════════════════════════════════════════════════════════════════
console.log('Test 1 (POS): Vision issue present, raw-pool support=0, family CORROBORATES #1\n');
{
  const visualItems = rows([
    'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NEW',
    'Adventure Time Summer Special #1 SDCC 2013 NM',
    'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
    'Adventure Time Summer Special #1 SDCC 2013 In Hand',
  ]);
  const vision = { title: 'Adventure Time Summer Special', issue: '1', year: '2013', publisher: 'Boom Studios' };
  const ebay = {
    title: 'Adventure Time Summer Special',
    issue: null,
    year: '2013',
    publisher: 'Boom Studios',
    agreement: { visionIssueCount: 0, total: 20, publisher: 0, visionPublisherCount: null },
    noIssueConsensus: true,
    noPublisherConsensus: false,
  };
  const family = {
    selectedTitle: 'Adventure Time Summer Special',
    decision: 'weighted-consensus',
    topFamily: { indices: [0, 1, 2, 3], rawTitle: visualItems[0].rawTitle, count: 4, weightSum: 4 },
  };
  const result = resolveIdentity(vision, ebay, family, { ebayResultCount: 20, visualItems });

  assertEq(result.familyIssueConsensus.mode, 'corroborated', 'family consensus mode is corroborated (4/4 rows agree #1)');
  assertEq(result.confirmedIssue, '1', 'confirmedIssue survives as "1" — NOT overridden or escalated by the poisoned raw-pool tally');
  assertEq(result.identityEscalation, null, 'no ID_REQUIRED escalation');
  assertTrue(!String(result.identitySource).includes('vision_zero_support'), 'identitySource carries no vision_zero_support suffix — the raw-pool block never ran its override/escalate branches');
}

// ═══════════════════════════════════════════════════════════════════════
// Test 2 (POS): Vision=null, family adopted #1 -> survives
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 2 (POS): Vision issue absent, family ADOPTS #1\n');
{
  const visualItems = rows([
    'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NEW',
    'Adventure Time Summer Special #1 SDCC 2013 NM',
    'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
    'Adventure Time Summer Special #1 SDCC 2013 In Hand',
    'Adventure Time Summer Special #1 2013 Sealed',
  ]);
  const vision = { title: 'Adventure Time Summer Special', issue: null, year: '2013', publisher: 'Boom Studios' };
  const ebay = {
    title: 'Adventure Time Summer Special',
    issue: null,
    year: '2013',
    publisher: 'Boom Studios',
    agreement: { visionIssueCount: null, total: 20, publisher: 0, visionPublisherCount: null },
    noIssueConsensus: true,
    noPublisherConsensus: false,
  };
  const family = {
    selectedTitle: 'Adventure Time Summer Special',
    decision: 'top-rank-protection',
    topFamily: { indices: [0, 1, 2, 3, 4], rawTitle: visualItems[0].rawTitle, count: 5, weightSum: 5 },
  };
  const result = resolveIdentity(vision, ebay, family, { ebayResultCount: 20, visualItems });

  assertEq(result.familyIssueConsensus.mode, 'adopted', 'family consensus mode is adopted (5/5 rows agree #1, no prior Vision issue)');
  assertEq(result.confirmedIssue, '1', 'confirmedIssue survives as "1"');
  assertEq(result.identityEscalation, null, 'no ID_REQUIRED escalation');
  // vision.issue is null here, so the pre-existing `vision.issue != null`
  // guard on the raw-pool block would already have prevented entry even
  // before this dispatch — this test confirms the new familyAuthoritySkip
  // branch composes correctly with that guard rather than interfering
  // with it (e.g. by throwing on a null-mode read, or double-logging).
}

// ═══════════════════════════════════════════════════════════════════════
// Test 3 (NEG): rawSupport=0, no valid family authority -> escalation fires
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 3 (NEG): raw-pool support=0, NO family override fired -> escalation still fires -> ID_REQUIRED\n');
{
  const vision = { title: 'Some Random Comic', issue: '1', year: '2013', publisher: 'Boom Studios' };
  const ebay = {
    title: null,
    issue: null,
    year: null,
    publisher: null,
    agreement: { visionIssueCount: 0, total: 8, publisher: 0, visionPublisherCount: null },
    noIssueConsensus: true,
    noPublisherConsensus: false,
  };
  // No family object at all — the family branch never fires, so
  // familyIssueConsensusResult stays null and familyAuthoritySkip is
  // false by construction.
  const result = resolveIdentity(vision, ebay, null, { ebayResultCount: 3 });

  assertEq(result.familyIssueConsensus, null, 'no family consensus was computed — family branch never fired');
  assertEq(result.confirmedIssue, null, 'confirmedIssue nulled — the raw-pool escalate branch fired unshortcut');
  assertEq(result.identityEscalation, 'ID_REQUIRED', 'escalation fires exactly as it did before this dispatch');
  assertTrue(String(result.identitySource).includes('vision_zero_support_escalate'), 'identitySource records the escalate suffix');
}

// ═══════════════════════════════════════════════════════════════════════
// Test 4 (NEG): family authority resolves #1 but confirmedIssue is #2 at
// check time (equality guard) -> NOT skipped
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 4 (NEG): equality guard — authority.issue diverges from confirmedIssue -> predicate does NOT skip\n');
console.log('  (See file header: this exact divergence is structurally unreachable through');
console.log('   resolveIdentity\'s public surface today — confirmedIssue and');
console.log('   familyIssueConsensusResult are always set together, atomically, inside the');
console.log('   same family branch. Verified directly against identityCore.js ~1038-1046.)\n');
{
  // Mirrors identityCore.js's familyAuthoritySkip predicate verbatim
  // (~1038-1046) — kept in lockstep with the source by citing exact line
  // numbers above; a future edit to the real predicate that isn't
  // reflected here is a test-maintenance signal, not a false pass.
  const computeFamilyAuthoritySkip = (familyIssueConsensusResult, familyDecision, confirmedIssue, FAMILY_OVERRIDE_DECISIONS) => {
    const familyAuthorityCurrent = familyIssueConsensusResult != null
      && (FAMILY_OVERRIDE_DECISIONS.includes(familyDecision) || familyDecision === 'refused-identity-conflict');
    return familyAuthorityCurrent
      && (familyIssueConsensusResult.mode === 'adopted' || familyIssueConsensusResult.mode === 'corroborated')
      && familyIssueConsensusResult.issue != null
      && String(familyIssueConsensusResult.issue) === String(confirmedIssue);
  };
  const FAMILY_OVERRIDE_DECISIONS = ['top-rank-protection', 'weighted-consensus'];

  const authorityForIssue1 = { mode: 'corroborated', issue: '1', winner: '1', support: 4, ratio: 1, uniqueRows: 4, runnerUp: null, runnerUpSupport: 0, tiedCandidates: [] };
  assertTrue(
    computeFamilyAuthoritySkip(authorityForIssue1, 'weighted-consensus', '1', FAMILY_OVERRIDE_DECISIONS),
    'sanity: matching issue (authority="1", confirmedIssue="1") DOES skip'
  );
  assertEq(
    computeFamilyAuthoritySkip(authorityForIssue1, 'weighted-consensus', '2', FAMILY_OVERRIDE_DECISIONS),
    false,
    'diverging issue (authority="1", confirmedIssue="2") does NOT skip — equality guard holds'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Test 5 (NEG): authority belongs to a previous/non-current family
// (current-family guard) -> NOT skipped
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 5 (NEG): current-family guard — family data present under a NON-winning decision -> NOT skipped\n');
{
  // Real resolveIdentity call: family carries usable topFamily/indices
  // data that WOULD produce a clean 'adopted' consensus if consulted, but
  // family.decision is 'fallback-vision' — not a winning-family decision
  // (not in FAMILY_OVERRIDE_DECISIONS, not 'refused-identity-conflict').
  // Neither family branch fires, so familyIssueConsensusResult is never
  // computed for this call at all — proving stale/irrelevant family data
  // sitting in the param is never mistaken for current authority.
  const visualItems = rows([
    'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NEW',
    'Adventure Time Summer Special #1 SDCC 2013 NM',
    'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
    'Adventure Time Summer Special #1 SDCC 2013 In Hand',
  ]);
  const vision = { title: 'Adventure Time Summer Special', issue: '1', year: '2013', publisher: 'Boom Studios' };
  const ebay = {
    title: null,
    issue: null,
    year: null,
    publisher: null,
    agreement: { visionIssueCount: 0, total: 20, publisher: 0, visionPublisherCount: null },
    noIssueConsensus: true,
    noPublisherConsensus: false,
  };
  const family = {
    selectedTitle: 'Adventure Time Summer Special',
    decision: 'fallback-vision', // NOT a winning-family decision
    topFamily: { indices: [0, 1, 2, 3], rawTitle: visualItems[0].rawTitle, count: 4, weightSum: 4 },
  };
  const result = resolveIdentity(vision, ebay, family, { ebayResultCount: 3, visualItems });

  assertEq(result.familyIssueConsensus, null, 'familyIssueConsensusResult never computed — decision is not a winning-family decision, so the family branch never fired');
  assertEq(result.confirmedIssue, null, 'confirmedIssue nulled — the raw-pool escalate branch fired unshortcut, exactly as if no family data existed at all');
  assertEq(result.identityEscalation, 'ID_REQUIRED', 'escalation fires — stale/non-current family data was correctly never treated as authority');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
