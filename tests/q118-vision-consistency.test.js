// tests/q118-vision-consistency.test.js
//
// Q118 dispatch (2026-07-18) — automated internal consistency checker.
// Almost every bug fixed tonight (Q112-Q117) had the same shape: Vision's
// own free-text reasoning said one thing, its own structured fields said
// another, and a human had to notice by reading the card carefully. This
// builds that comparison as an automated, flag-only check that runs on
// every scan (src/lib/visionConsistency.js), wired into api/enrich.js and
// escalating to RESEARCH tier via decisionEngine.js's criticalWarnings
// (explicit ruling — a deliberate departure from the Q72 policy that
// content-type flags normally stay at LIST_LOW/BUNDLE, made knowingly for
// this new class).
//
// Four required regression scenarios, per explicit ruling:
//   1. "Captain Marvel #17" in reason vs structured title "Captain" — title
//      check flags the disagreement.
//   2. War Is Hell #15 class — grading-status check flags an affirmative
//      CGC claim vs isGraded=false, AND does NOT flag a genuine "raw, not
//      CGC certified" explanation (the harder, more important half).
//   3. A genuine Kamala-Khan-era book (2013+) — anachronism check does NOT
//      fire when character and year actually agree.
//   4. A normal, fully-consistent scan — zero flags across all three
//      checks.
//
// Invoke: node tests/q118-vision-consistency.test.js

import {
  checkTitleConsistency,
  checkGradingStatusConsistency,
  checkEraAnachronismConsistency,
  checkVisionConsistency,
} from '../src/lib/visionConsistency.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertTrue = (cond, label) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertNull = (v, label) => assertTrue(v === null, label);
const assertEq = (actual, expected, label) => {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(m); console.log(m); }
};

console.log('\n=== Q118 — VISION INTERNAL CONSISTENCY CHECKER ===\n');

// ═══════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Captain Marvel #17 title truncation
// ═══════════════════════════════════════════════════════════════════════
console.log('Scenario 1: "Captain Marvel #17" in reason vs structured title "Captain"\n');

const s1 = checkTitleConsistency({
  reason: 'This copy of Captain Marvel #17 shows light wear on the spine and corners, otherwise clean.',
  title: 'Captain',
  issue: '17',
});
assertTrue(s1 !== null, 'flags the title truncation');
assertTrue(s1?.id === 'title-issue-text-mismatch', 'flag id is title-issue-text-mismatch');
assertTrue(/truncated/.test(s1?.message || ''), `message calls out truncation: "${s1?.message}"`);

// Sanity: a matching issue number with a genuinely wrong title (no shared
// words at all) also flags, via the other branch.
const s1b = checkTitleConsistency({
  reason: 'This copy of Wonder Woman #17 shows light wear.',
  title: 'Captain',
  issue: '17',
});
assertTrue(s1b !== null, 'wrong title entirely (no shared words) also flags');

// Sanity: mismatched issue number flags immediately, regardless of title.
const s1c = checkTitleConsistency({
  reason: 'This copy of Captain Marvel #12 shows light wear.',
  title: 'Captain Marvel',
  issue: '17',
});
assertTrue(s1c !== null, 'mismatched issue number (#12 in text vs #17 structured) flags');
assertTrue(/#12/.test(s1c?.message || '') && /#17/.test(s1c?.message || ''), 'issue mismatch message names both numbers');

// ═══════════════════════════════════════════════════════════════════════
// SCENARIO 1b — Q126 dispatch (2026-07-19, Harley Quinn #62 / Catwoman #64
// false-positive class): the truncation check must not conflate "extra
// words exist somewhere in the reason-text window" with "the title
// continues past where the structured field ends." Short (1-2 token)
// titles paired with ordinary Vision narration ("This is a raw copy of
// Catwoman #64...") were flagging as truncated even though the structured
// title is complete and correct — the extra words are lead-in narration
// BEFORE the title match, not a continuation of it. Scenario 1 above
// (Captain Marvel #17) remains the proof this doesn't overcorrect into
// never firing: "marvel" sits immediately AFTER the matched "captain"
// span, a genuine continuation, and must still flag.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nScenario 1b: Q126 false-positive class — narration before a complete title must not flag\n');

const q126Cases = [
  { reason: 'This is a raw copy of Catwoman #64 in near mint condition, minor spine wear.', title: 'catwoman', issue: '64', expectFlag: false },
  { reason: 'The comic shows Catwoman #64 with a glossy cover and sharp corners.', title: 'catwoman', issue: '64', expectFlag: false },
  { reason: 'This looks like Harley Quinn #62, near mint, no visible defects.', title: 'harley quinn', issue: '62', expectFlag: false },
  { reason: 'Harley Quinn #62 appears to be in very fine condition with slight foxing.', title: 'harley quinn', issue: '62', expectFlag: false },
  { reason: 'Catwoman #64, near mint condition.', title: 'catwoman', issue: '64', expectFlag: false },
];
for (const c of q126Cases) {
  const r = checkTitleConsistency(c);
  assertTrue((r === null) === !c.expectFlag, `"${c.reason}" (title="${c.title}") — expected ${c.expectFlag ? 'flag' : 'no flag'}, got ${r ? `flag: ${r.message}` : 'no flag'}`);
}

// The genuine-truncation case must still fire after the fix — this is the
// regression that matters most (confirms no overcorrection into silence).
const q126Genuine = checkTitleConsistency({
  reason: 'This copy of Captain Marvel #17 shows light wear.',
  title: 'Captain',
  issue: '17',
});
assertTrue(q126Genuine !== null, 'genuine truncation (Captain vs Captain Marvel) still flags after the adjacency fix');
assertTrue(/truncated/.test(q126Genuine?.message || ''), 'still calls it truncation');

// ═══════════════════════════════════════════════════════════════════════
// SCENARIO 2 — War Is Hell #15 class: grading-status affirmative claim
// ═══════════════════════════════════════════════════════════════════════
console.log('\nScenario 2: grading-status — affirmative CGC claim flags, genuine negation does not\n');

const s2_bug = checkGradingStatusConsistency({
  reason: 'This appears to be CGC graded, with a visible certification number on the label.',
  isGraded: false,
});
assertTrue(s2_bug !== null, 'affirmative CGC claim vs isGraded=false — flags (War Is Hell #15 class)');
assertTrue(s2_bug?.id === 'grading-status-text-mismatch', 'flag id is grading-status-text-mismatch');

// The harder, more important half: genuine negative explanations must NOT flag.
const negationCases = [
  'This is a raw copy in a protective sleeve, not CGC certified — no slab visible.',
  'This is not CGC graded; it appears to be a raw book stored in a poly bag.',
  'Raw copy, ungraded — no CGC label present anywhere on the cover.',
  'This appears to be CGC graded — actually wait, no cert number visible, so it is likely raw.',
];
for (const reason of negationCases) {
  const r = checkGradingStatusConsistency({ reason, isGraded: false });
  assertNull(r, `genuine negation does not false-positive: "${reason.slice(0, 55)}..."`);
}

// Control: isGraded=true — check is a no-op regardless of reason text
// (only relevant when structured says NOT graded).
const s2_control = checkGradingStatusConsistency({
  reason: 'This is CGC graded with a visible certification number.',
  isGraded: true,
});
assertNull(s2_control, 'isGraded=true — check is a no-op (agreement, nothing to flag)');

// ═══════════════════════════════════════════════════════════════════════
// SCENARIO 3 — genuine Kamala-Khan-era book, character and year agree
// ═══════════════════════════════════════════════════════════════════════
console.log('\nScenario 3: genuine Kamala Khan book (2014, post-debut) — no false positive\n');

const s3 = checkEraAnachronismConsistency({
  reason: 'This is Kamala Khan\'s Ms. Marvel in her signature costume, first ongoing series appearance.',
  year: '2014',
});
assertNull(s3, 'Kamala Khan mentioned with year=2014 (after her 2013 debut) — no flag');

// The actual bug case: same mention, impossible year.
const s3_bug = checkEraAnachronismConsistency({
  reason: 'Cover shows a Kamala Khan era design element.',
  year: '1977',
});
assertTrue(s3_bug !== null, 'Kamala Khan mentioned with year=1977 (14 years before her 2013 debut) — flags');
assertTrue(/2013/.test(s3_bug?.message || '') && /1977/.test(s3_bug?.message || ''), 'message names both the debut year and the impossible structured year');

// Boundary: debut year itself is NOT anachronistic.
const s3_boundary = checkEraAnachronismConsistency({
  reason: 'Kamala Khan appears on this cover.',
  year: '2013',
});
assertNull(s3_boundary, 'debut year itself (2013) is not flagged as anachronistic');

// ═══════════════════════════════════════════════════════════════════════
// SCENARIO 4 — normal, fully-consistent scan: zero flags
// ═══════════════════════════════════════════════════════════════════════
console.log('\nScenario 4: normal consistent scan — zero flags across all three checks\n');

const s4 = checkVisionConsistency({
  reason: 'This copy of Batman #608 shows moderate wear along the spine with some corner blunting, otherwise a solid mid-grade copy.',
  title: 'Batman',
  issue: '608',
  year: '2002',
  isGraded: false,
});
assertEq(s4.hasInconsistency, false, 'fully-consistent scan: hasInconsistency=false');
assertEq(s4.flags.length, 0, 'fully-consistent scan: zero flags');

// A second, independent consistent case with a real slab.
const s4b = checkVisionConsistency({
  reason: 'This CGC 9.8 slab shows a bright, glossy cover with sharp corners — the certification number is clearly visible on the label.',
  title: 'Amazing Spider-Man',
  issue: '300',
  year: '1988',
  isGraded: true,
});
assertEq(s4b.hasInconsistency, false, 'genuine graded slab, isGraded=true, affirmative language — zero flags (agreement, not a mismatch)');

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — decisionEngine wiring: RESEARCH escalation + messaging
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: decisionEngine escalates internal-inconsistency to RESEARCH\n');

const flaggedItem = {
  title: 'Captain',
  issue: '17',
  publisher: 'Marvel',
  year: '2019',
  price: 25,
  comps: { count: 5 },
  rawComps: { count: 5, prices: [20, 22, 25, 28, 30] },
  visionConsistency: checkVisionConsistency({
    reason: 'This copy of Captain Marvel #17 shows light wear.',
    title: 'Captain',
    issue: '17',
    year: '2019',
    isGraded: false,
  }),
};
const decision = computeDecision(flaggedItem);
assertTrue(decision.warnings.includes('internal-inconsistency'), 'decisionEngine pushes internal-inconsistency warning');
assertEq(decision.action, 'RESEARCH', 'flagged item escalates to RESEARCH action');

const msg = describeWarning('internal-inconsistency', flaggedItem);
assertTrue(msg !== 'internal-inconsistency', 'describeWarning gives a specific message, not the raw slug');
assertTrue(/truncated/.test(msg), `message surfaces the specific disagreement: "${msg}"`);

// Control: clean item never gets the warning or the escalation from this check.
const cleanItem = {
  title: 'Batman',
  issue: '608',
  publisher: 'DC Comics',
  year: '2002',
  price: 21,
  comps: { count: 18 },
  rawComps: { count: 18, prices: [15, 18, 21, 24, 27] },
  visionConsistency: checkVisionConsistency({
    reason: 'This copy of Batman #608 shows moderate wear.',
    title: 'Batman',
    issue: '608',
    year: '2002',
    isGraded: false,
  }),
};
const cleanDecision = computeDecision(cleanItem);
assertTrue(!cleanDecision.warnings.includes('internal-inconsistency'), 'clean item does not get the warning');

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
