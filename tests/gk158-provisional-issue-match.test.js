// tests/gk158-provisional-issue-match.test.js
//
// GK-158 (2026-08-22) — the "AWW shape" (Absolute Wonder Woman #16
// Talavera virgin, GK-152's own comps-pool issue rescue): before this
// fix, src/lib/evidenceEligibility.js's TARGET_ISSUE_PROVISIONAL_AUTHORITY
// branch was an UNCONDITIONAL blanket demotion — every row was pushed to
// reference-only the instant out.issueAuthority.status was
// 'provisional'/'conflicted', regardless of whether the row's own title
// actually agreed with the contested issue number. That discarded real,
// usable evidence: a comps pool unanimous on the (still-unconfirmed)
// issue is genuine pricing signal for that reading, even though it
// hasn't cleared the bar for CONFIRMED.
//
// THE FIX (src/lib/evidenceEligibility.js, classifyEvidenceRow): now
// evaluates hasIssueNumber even inside the provisional-authority branch.
// A row whose title AGREES with the contested issue becomes identity-
// ELIGIBLE (comparabilityStatus='PROVISIONAL_ISSUE_MATCH', no
// rejectionCodes pushed for the issue axis) — it can reach
// rawPricingEligible and be priced. A row that DISAGREES is still
// rejected outright (WRONG_ISSUE, identityEligible=false) — disagreeing
// with an unconfirmed guess is a genuine conflict, not corroboration.
//
// THE FLOOR IS UNTOUCHED: deriveMarketStanding (src/lib/actionAuthority.js)
// still independently floors marketStanding to SIMILAR_ONLY whenever
// out.issueAuthority.status === 'conflicted' (the GK-152 per-facet law) —
// this fix only decides whether a MATCHING row may contribute to the
// price at all, never how confident the resulting card is allowed to
// look. commit4-terminal's own listing lock
// (computeIssueAuthorityContractPatch, issueAuthority.js) and
// responseContract.js's 'market-standing-issue-contested' insufficiency
// lock are equally untouched — both key purely off
// out.issueAuthority.status, independent of which rows fed the price.
//
// Invoke: node tests/gk158-provisional-issue-match.test.js

import { classifyEvidenceRow, buildEvidencePopulations } from '../src/lib/evidenceEligibility.js';
import { deriveMarketStanding } from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-158 — TARGET_ISSUE_PROVISIONAL_AUTHORITY admits matching comps, never inflates standing ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Shared target: the AWW shape — a marketplace-only-adopted (GK-152
// rescueIssueFromCompsPoolConsensus) issue #16, not yet independently
// corroborated.
// ═══════════════════════════════════════════════════════════════════════
const awwTarget = {
  issue: '16',
  seriesTitle: 'Absolute Wonder Woman',
  variant: 'Talavera Virgin',
  issueAuthorityPresent: true,
  issueAuthorityStatus: 'conflicted',
  confirmedYear: null,
  isGraded: false,
  assetType: 'comic',
};

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — blocking fixture: 2 matching comps become pricing-eligible.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: matching comps are admitted to the raw pricing pool\n');

const matchRowA = { title: 'Absolute Wonder Woman #16 Talavera Virgin Variant', price: 45, marketState: 'active' };
const matchRowB = { title: 'Absolute Wonder Woman #16 Talavera Virgin', price: 50, marketState: 'active' };

const classA = classifyEvidenceRow(matchRowA, awwTarget);
const classB = classifyEvidenceRow(matchRowB, awwTarget);

assertTrue(classA.identityEligible, 'matching row A is identity-eligible');
assertTrue(classA.rawPricingEligible, 'matching row A is rawPricingEligible — reaches pricing math');
assertEq(classA.comparabilityStatus, 'PROVISIONAL_ISSUE_MATCH', 'matching row A tagged PROVISIONAL_ISSUE_MATCH (not silently promoted to a confirmed-issue look)');
assertEq(classA.rejectionCodes, [], 'matching row A carries zero rejection codes — genuinely admitted, not admitted-with-an-asterisk code');

assertTrue(classB.identityEligible, 'matching row B is identity-eligible');
assertTrue(classB.rawPricingEligible, 'matching row B is rawPricingEligible — reaches pricing math');
assertEq(classB.comparabilityStatus, 'PROVISIONAL_ISSUE_MATCH', 'matching row B tagged PROVISIONAL_ISSUE_MATCH');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — negative control: a comp NOT matching the contested value is
// still rejected outright (WRONG_ISSUE), never treated as corroboration.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: negative control — non-matching comps still rejected\n');

const mismatchRow = { title: 'Absolute Wonder Woman #1 Talavera Virgin', price: 12, marketState: 'active' };
const classMismatch = classifyEvidenceRow(mismatchRow, awwTarget);

assertEq(classMismatch.identityEligible, false, 'a comp whose own title disagrees with the contested issue is identity-INELIGIBLE');
assertEq(classMismatch.rawPricingEligible, false, 'a mismatching comp never reaches rawPricingEligible');
assertTrue(classMismatch.rejectionCodes.includes('WRONG_ISSUE'), 'mismatching comp carries WRONG_ISSUE — disagreeing with an unconfirmed guess is a real conflict, not silence');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — buildEvidencePopulations end to end: the 2 matching comps
// land in rawPricingPool (priced), the mismatching comp lands in
// incompatibleEditionReferences (display-only, never priced).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: buildEvidencePopulations — pool composition\n');

const pool = buildEvidencePopulations([matchRowA, matchRowB, mismatchRow], awwTarget);

assertEq(pool.rawPricingPool.length, 2, 'exactly the 2 matching comps reach the raw pricing pool');
assertTrue(pool.rawPricingPool.some((r) => r.title === matchRowA.title), 'matching row A is in the priced pool');
assertTrue(pool.rawPricingPool.some((r) => r.title === matchRowB.title), 'matching row B is in the priced pool');
assertEq(pool.incompatibleEditionReferences.length, 1, 'the mismatching comp is demoted to a reference bucket, not silently dropped');
assertTrue(pool.incompatibleEditionReferences[0].rejectionCodes.includes('WRONG_ISSUE'), 'the reference-bucket entry carries its real rejection code (I13 fidelity)');
assertEq(pool.provisionalAuthorityReferences.length, 0, 'no row lands in provisionalAuthorityReferences for this pool — the matching rows were genuinely ADMITTED, not merely reference-labeled');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — the floor is untouched: marketStanding still floors to
// SIMILAR_ONLY, the review lock still fires with ISSUE_CONTESTED, and
// the state is REVIEW — never EXACT_CURRENT/READY — regardless of the
// fact that real comps now priced the book.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: standing/locks floor unchanged — priced, but never EXACT_CURRENT/READY\n');

const pricedButContestedOut = {
  pricingSource: 'verified_active',
  price: 47.5,
  issueAuthority: { status: 'conflicted' },
  variantApplicability: null,
  decision: { action: 'LIST_LOW' },
};

const marketStanding = deriveMarketStanding(pricedButContestedOut);
assertEq(marketStanding, 'SIMILAR_ONLY', 'marketStanding floors to SIMILAR_ONLY via the GK-152 issue floor — real priced comps do not lift this floor');
assertTrue(marketStanding !== 'EXACT_CURRENT', 'marketStanding is never EXACT_CURRENT while issueAuthority is conflicted');

const contestedLocks = deriveLocks(pricedButContestedOut);
const issueLock = contestedLocks.find((l) => l.code === 'market-standing-issue-contested');
assertTrue(!!issueLock, 'the market-standing-issue-contested insufficiency lock fires');
assertEq(issueLock.hard, false, 'the lock is soft (insufficiency-class) — acknowledgeable, not a hard block');

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — negative control: genuine no-consensus junk (no issueAuthority
// tracking at all, target issue genuinely unresolved) still refuses
// normally — this fix does not loosen the TARGET_ISSUE_UNRESOLVED branch.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: negative control — genuine no-consensus junk still refuses\n');

const unresolvedTarget = {
  issue: null,
  seriesTitle: 'Absolute Wonder Woman',
  issueAuthorityPresent: false,
  issueAuthorityStatus: null,
  confirmedYear: null,
  isGraded: false,
  assetType: 'comic',
};
const junkRow = { title: 'Absolute Wonder Woman #16 Talavera Virgin', price: 45, marketState: 'active' };
const classJunk = classifyEvidenceRow(junkRow, unresolvedTarget);
assertEq(classJunk.identityEligible, false, 'with no target issue at all (genuine no-consensus), even a title-matching-looking row is NOT identity-eligible');
assertEq(classJunk.rawPricingEligible, false, 'never reaches pricing math when the target issue is genuinely unresolved');
assertTrue(classJunk.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), 'carries TARGET_ISSUE_UNRESOLVED, not PROVISIONAL_ISSUE_MATCH — distinct states, never conflated');

const junkOut = { pricingSource: null, price: null, decision: { action: 'ID_REQUIRED' } };
assertEq(deriveMarketStanding(junkOut), 'NONE', 'no pricingSource at all still derives marketStanding NONE — untouched by this fix');

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
