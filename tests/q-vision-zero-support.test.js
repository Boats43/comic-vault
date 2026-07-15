// P0 — Vision "confidently wrong" issue-number regression suite.
//
// Root cause: every existing consensus check (Q78 issue-mismatch, the
// resolveIdentity title branches, Q83 consensus rescue) asks "does the pool
// agree with itself" or is gated behind Vision's OWN self-reported low
// confidence. None of them ask "does Vision's specific claim have ANY
// support in the pool at all" as an independent, always-on check. Fix:
// extractConsensus() tallies agreement.visionIssueCount; resolveIdentity()
// applies a single post-branch override/escalate step using it.
//
// Test coverage:
//   1. She-Hulk #8->#9 class — coherent pool, zero support for Vision's
//      issue, pool HAS an adoptable alternate -> loud override.
//   2. Marvel Super-Heroes / Iron Man Spring Special class — coherent
//      TITLE consensus, zero support for Vision's issue, pool has NO
//      adoptable issue at all -> escalate to ID_REQUIRED (proven via the
//      real identity-gate functions, not asserted by assumption).
//   3. Partial-support (60/40) fixture — pool disagrees with Vision but
//      Vision's issue still has non-zero support -> override must NOT
//      fire; today's weighted-consensus/title-agreement behavior stands.
//   4. Captain America #25 anchor — Vision and pool fully agree -> no
//      flip on a correct identification.
//   5. Slab fixture (isGraded=true) — pool is coherent and wrong, zero
//      support for Vision's issue, but isGraded excludes it (Q106).
//
// Invoke: node tests/q-vision-zero-support.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { extractConsensus } from '../src/lib/imageSearchIdentity.js';
import { resolveIdentity, computeReprintDominanceRatio } from '../src/lib/identityCore.js';
import { sanitizeIdentityFields, assessIdentityConfidence } from '../src/lib/identityGate.js';

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

const assertTruthy = (actual, label) => {
  if (actual) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected truthy, got: ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${label}`);
  }
};

const assertContains = (str, substr, label) => {
  if (String(str || '').includes(substr)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected "${str}" to contain "${substr}"`);
    console.log(`  ✗ ${label}`);
  }
};

const assertNotContains = (str, substr, label) => {
  if (!String(str || '').includes(substr)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected "${str}" NOT to contain "${substr}"`);
    console.log(`  ✗ ${label}`);
  }
};

const buildRows = (rawTitle, issue, year, count) =>
  Array.from({ length: count }, () => ({ rawTitle, title: rawTitle, issue, year, variantTokens: [] }));

console.log('Testing Q-VISION-ZERO-SUPPORT regression suite...\n');

// ─────────────────────────────────────────────────────────────────────────
console.log('Test 1: She-Hulk #8->#9 — coherent pool, zero support, adoptable alternate -> OVERRIDE fires');
{
  const visualItems = buildRows('Sensational She-Hulk #9 (1989) CGC 8.5', '9', '1989', 20);
  const visionIssue = '8';
  const visualConsensus = extractConsensus(visualItems, visionIssue);

  assertTruthy(visualConsensus, 'extractConsensus returns non-null (title+issue both coherent)');
  assertEq(visualConsensus?.issue, '9', 'pool issue consensus is "9"');
  assertEq(visualConsensus?.agreement?.visionIssueCount, 0, 'visionIssueCount is 0 (Vision\'s "8" never appears in the pool)');

  const identity = resolveIdentity(
    { title: 'She-Hulk', issue: visionIssue, year: '1989', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false }
  );

  assertEq(identity.confirmedIssue, '9', 'confirmedIssue adopts pool consensus "9"');
  assertContains(identity.identitySource, 'vision_zero_support_override', 'identitySource tags the override');
  assertEq(identity.visionZeroSupport?.mode, 'override', 'visionZeroSupport.mode is "override"');
  assertEq(identity.matchConfidenceDemote, true, 'matchConfidenceDemote is true (loud override)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 2: Marvel Super-Heroes / Iron Man Spring Special — zero support, NO adoptable alternate -> ESCALATE to ID_REQUIRED');
{
  // "Spring Special" listings carry no #N at all -> issue stays null on
  // every row, so extractConsensus's issue-consensus vote has nothing to
  // adopt (issueOk fails) even though title consensus is unanimous.
  const visualItems = buildRows('Marvel Super-Heroes Spring Special (1993) CGC 9.6', null, '1993', 20);
  const visionIssue = '8';
  const visualConsensus = extractConsensus(visualItems, visionIssue);

  assertTruthy(visualConsensus, 'extractConsensus returns non-null via the escalation carve-out (title coherent, issue not)');
  assertEq(visualConsensus?.issue, null, 'pool has no adoptable issue consensus');
  assertEq(visualConsensus?.noIssueConsensus, true, 'noIssueConsensus flag set');
  assertEq(visualConsensus?.agreement?.visionIssueCount, 0, 'visionIssueCount is 0 (Vision\'s "8" never appears in the pool)');

  const identity = resolveIdentity(
    { title: 'Marvel Super-Heroes', issue: visionIssue, year: '1993', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false }
  );

  assertEq(identity.confirmedIssue, null, 'confirmedIssue is nulled, not silently retained as Vision\'s "8"');
  assertContains(identity.identitySource, 'vision_zero_support_escalate', 'identitySource tags the escalation');
  assertEq(identity.identityEscalation, 'ID_REQUIRED', 'identityEscalation is ID_REQUIRED');
  assertEq(identity.visionZeroSupport?.mode, 'escalate', 'visionZeroSupport.mode is "escalate"');

  // Prove the escalation actually reaches ID_REQUIRED through the REAL
  // identity-gate functions (not asserted by assumption per the ask: "if
  // it doesn't, report — do not paper over").
  const sanitized = sanitizeIdentityFields({
    title: identity.confirmedTitle,
    issue: identity.confirmedIssue,
    year: identity.confirmedYear,
    publisher: identity.confirmedPublisher,
    visionConfidence: 'high',
  });
  const idCheck = assessIdentityConfidence(sanitized, identity.identitySource, ['title', 'issue', 'year', 'publisher'], null);

  assertEq(idCheck.confident, false, 'assessIdentityConfidence reports NOT confident');
  assertContains(idCheck.missingFields.join(','), 'issue', 'assessIdentityConfidence flags issue as the missing field');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 3: Partial-support (60/40) — Vision\'s issue has non-zero support -> override does NOT fire');
{
  const majority = buildRows('She-Hulk #9 (1989) CGC 8.5', '9', '1989', 12);
  const minority = buildRows('She-Hulk #8 (1989) CGC 8.5', '8', '1989', 8);
  const visualItems = [...majority, ...minority];
  const visionIssue = '8';
  const visualConsensus = extractConsensus(visualItems, visionIssue);

  assertTruthy(visualConsensus, 'extractConsensus returns non-null (issue reaches 60% >= 50% bar)');
  assertEq(visualConsensus?.agreement?.visionIssueCount, 8, 'visionIssueCount is 8 (non-zero — partial support)');

  const identity = resolveIdentity(
    { title: 'She-Hulk', issue: visionIssue, year: '1989', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false }
  );

  assertNotContains(identity.identitySource, 'vision_zero_support', 'identitySource carries NO zero-support tag');
  assertEq(identity.matchConfidenceDemote, false, 'matchConfidenceDemote is false — new check stayed inert');
  // Today's existing (unchanged) weighted-consensus behavior: title agrees,
  // so confirmedIssue keeps Vision's value. This is the pre-existing,
  // out-of-scope behavior for partial disagreement — this assertion proves
  // the NEW check didn't touch it, not that the pre-existing behavior is
  // itself correct.
  assertEq(identity.confirmedIssue, '8', 'confirmedIssue unchanged from pre-existing weighted-consensus path');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 4: Captain America #25 anchor — Vision and pool fully agree -> no flip');
{
  const visualItems = buildRows('Captain America #25 Skottie Young Variant CGC 9.8', '25', '2019', 6);
  const visionIssue = '25';
  const visualConsensus = extractConsensus(visualItems, visionIssue);

  assertEq(visualConsensus?.agreement?.visionIssueCount, 6, 'visionIssueCount is 6 (full agreement)');

  const identity = resolveIdentity(
    { title: 'Captain America', issue: visionIssue, year: '2019', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 6, overlapThreshold: 0.2, isGraded: false }
  );

  assertEq(identity.confirmedIssue, '25', 'confirmedIssue unchanged — no flip on a correct identification');
  assertNotContains(identity.identitySource, 'vision_zero_support', 'identitySource carries NO zero-support tag');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 5: Slab fixture (isGraded=true) — coherent wrong pool, zero support -> isGraded EXCLUSION holds');
{
  const visualItems = buildRows('Venom #2 (2018) CGC 9.8', '2', '2018', 6);
  const visionIssue = '1'; // Vision's read; pool unanimously disagrees and has ZERO occurrences of "1"
  const visualConsensus = extractConsensus(visualItems, visionIssue);

  assertTruthy(visualConsensus, 'extractConsensus returns non-null (title+issue coherent, just wrong for a slab)');
  assertEq(visualConsensus?.agreement?.visionIssueCount, 0, 'visionIssueCount is 0 — pool is coherent AND wrong');

  const identity = resolveIdentity(
    { title: 'Venom', issue: visionIssue, year: '2018', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 6, overlapThreshold: 0.2, isGraded: true } // <-- slab
  );

  assertEq(identity.confirmedIssue, '1', 'confirmedIssue UNCHANGED — isGraded exclusion holds despite coherent wrong pool');
  assertNotContains(identity.identitySource, 'vision_zero_support', 'identitySource carries NO zero-support tag on a slab');
  assertEq(identity.matchConfidenceDemote, false, 'matchConfidenceDemote is false on a slab');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 6: GSX facsimile (15/20 reprint titles, correct 1975 original in pool) — override does NOT fire, Vision stands');
{
  // Both the facsimile reprints AND the correct original carry "#1" (Giant-
  // Size X-Men has always been issue #1), so this fixture's issue axis
  // doesn't itself hit the zero-support condition — it proves the
  // reprint-dominance ratio computes correctly on a named production shape
  // and that resolveIdentity leaves the identity alone when it's dominant.
  // Test 7 (below) proves the gate has real teeth on a case where the
  // override WOULD otherwise fire.
  const facsimileItems = buildRows('Giant-Size X-Men #1 Facsimile Edition (2020) Marvel', '1', '2020', 15)
    .map((r, i) => ({ ...r, price: 15 + i })); // priced, so they count toward the ratio
  const originalItems = buildRows('Giant-Size X-Men #1 (1975) CGC 9.0', '1', '1975', 5)
    .map((r, i) => ({ ...r, price: 9000 + i * 100 }));
  const visualItems = [...facsimileItems, ...originalItems];
  const visionIssue = '1';

  const ratio = computeReprintDominanceRatio(visualItems);
  assertEq(ratio, 0.75, 'reprint-dominance ratio computes 15/20 = 0.75');
  assertTruthy(ratio >= 0.6, 'ratio clears the Q98 dominance threshold');

  const visualConsensus = extractConsensus(visualItems, visionIssue);
  const identity = resolveIdentity(
    { title: 'Giant-Size X-Men', issue: visionIssue, year: '1975', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems }
  );

  assertEq(identity.confirmedIssue, '1', 'confirmedIssue unchanged — Vision\'s identity stands');
  assertNotContains(identity.identitySource, 'vision_zero_support', 'identitySource carries NO zero-support tag (gate skipped the check)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 7: True Believers renumbering — reprint-dominant pool WOULD wrongly flip issue without the EX-7 gate');
{
  // True Believers facsimile reprints always renumber to "#1" regardless of
  // the original source issue (REPRINT_RE matches "true believers"
  // directly). Vision correctly reads the original as #300; an all-
  // facsimile pool unanimously (and wrongly, for identity purposes) says
  // #1. Without the EX-7 gate this is a textbook zero-support override:
  // visionIssueCount("300") === 0, ebay.issue === "1" -> would adopt "1".
  const visualItems = buildRows('True Believers: Venom #1 (2018) Marvel', '1', '2018', 20)
    .map((r, i) => ({ ...r, price: 5 + i }));
  const visionIssue = '300';

  const ratio = computeReprintDominanceRatio(visualItems);
  assertEq(ratio, 1, 'reprint-dominance ratio is 1.0 (all 20 are True Believers facsimiles)');

  const visualConsensus = extractConsensus(visualItems, visionIssue);
  assertEq(visualConsensus?.agreement?.visionIssueCount, 0, 'visionIssueCount is 0 — without the gate this is a live override candidate');
  assertEq(visualConsensus?.issue, '1', 'pool has an adoptable (but WRONG) alternate — the exact override-eligible shape');

  const identityWithGate = resolveIdentity(
    { title: 'Venom', issue: visionIssue, year: '2018', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false, visualItems }
  );
  assertEq(identityWithGate.confirmedIssue, '300', 'WITH the gate: confirmedIssue stays "300" — no wrong flip to the reprint\'s "1"');
  assertNotContains(identityWithGate.identitySource, 'vision_zero_support', 'identitySource carries NO zero-support tag — gate suppressed it');

  // Sanity check: prove the gate is actually load-bearing here (not
  // vacuously passing) by confirming the override WOULD have fired without
  // it, using the same visualConsensus/vision inputs but no visualItems.
  const identityWithoutGateData = resolveIdentity(
    { title: 'Venom', issue: visionIssue, year: '2018', publisher: 'Marvel' },
    visualConsensus,
    null,
    { ebayResultCount: 20, overlapThreshold: 0.2, isGraded: false } // no visualItems -> ratio is null -> gate can't engage
  );
  assertEq(identityWithoutGateData.confirmedIssue, '1', 'CONTROL: without pool data for the gate, the override DOES fire and wrongly adopts "1" — proves Test 7 is load-bearing, not vacuous');
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`\n${f}`));
}
process.exit(failed > 0 ? 1 : 0);
