// tests/grailkey-dispatch-25-fix2-unanimous-promotion.test.js
//
// GrailKey Dispatch 25 (2026-08-07) — Fix 2 (issue axis) and Fix 2b
// (year axis), unanimous-consensus promotion, provisional -> confirmed.
//
// Fix 2 and Fix 2b are ONE root cause investigation: out.issueAuthority.
// status='provisional' independently gates four blocks (CV/PC lookup
// skip, active-cache skip, evidence-eligibility elimination,
// commit4-terminal ID_REQUIRED) — but identityProvisionalFields.
// includes('year') gates the SAME four blocks a second, independent
// way. Fix 2 alone (issue axis) does not clear a repro where the year
// axis is also provisional; Fix 2b (year axis) is required alongside it.
//
// Fix 2b's predicate uses a CORRECTED population — verified against
// resolveFamilyYearConsensus's actual source (identityCore.js:1234)
// before writing this predicate, not assumed: that function's own
// `uniqueRows`/`support` denominator is family MEMBERSHIP (every row,
// silent or not), not assertion. Reusing it naively (support===
// uniqueRows, mirroring Fix 2's issue-axis pattern) would be the THIRD
// recorded "measuring coherence against the wrong population" defect
// (Pattern Library — vision-zero-support at launch certification was
// the first) — a silent row (no year token) would count against
// unanimity exactly like a DISSENTING row (a different year asserted),
// even though silence and dissent are not the same thing. Fix 2b
// recomputes directly from raw indices/visualItems, scoped to asserting
// rows from the start.
//
// The real repro (Spawn #351 Cover C Brett Booth Virgin Variant,
// 2026-08-07): 4-member winning family, 3 members assert year=2024, 1
// member ("...High Grade NM") asserts no year at all. Among asserting
// rows: 3/3 = 100% agreement, zero dissent. This is the exact shape
// Section 2 below reconstructs.
//
// V4 (review finding, caught before push, not by any test) — Fix 2
// simultaneously (a) unlocks CV/PC exact-identity lookups that were
// skipped while provisional and (b) killed conflict escalation for the
// promoted row: escalateIssueAuthorityOnConflict originally checked
// `status === 'provisional'` only, so a promoted 'confirmed' row could
// never re-escalate even on a genuine later contradiction — the sources
// most able to surface a contradiction are the ones promotion just
// opened, and the guard that would catch it was dead for exactly those
// rows. Fixed with PROVENANCE, not a loosened status check: promotion
// stamps 'unanimous-marketplace-consensus' onto the existing `reasons`
// array (this file's own already-live provenance mechanism, not a new
// parallel field), and escalateIssueAuthorityOnConflict's second
// eligibility branch checks that specific reason string, never bare
// status — a 'confirmed' status arriving via any OTHER route
// (manualCorrection.js's real one, source:'user'/reasons:
// ['user-correction']) carries no such reason and stays
// non-escalatable. Sections 9-12 below prove this directly.

import { evaluateUnanimousConsensusPromotion, evaluateUnanimousYearConsensusPromotion, escalateIssueAuthorityOnConflict } from '../src/lib/issueAuthority.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Dispatch 25 — Fix 2/2b unanimous-consensus promotion ===\n');

// Helper: build a 4-member visualItems pool at indices 0-3, each with a
// distinct itemId/seller by default (overridable per test).
const buildRows = (overrides = []) => {
  const base = [
    { itemId: 'v1|100|0', sellerUsername: 'seller_a', year: 2024 },
    { itemId: 'v1|101|0', sellerUsername: 'seller_b', year: 2024 },
    { itemId: 'v1|102|0', sellerUsername: 'seller_c', year: 2024 },
    { itemId: 'v1|103|0', sellerUsername: 'seller_d', year: null }, // the real repro's silent 4th row
  ];
  return base.map((row, i) => ({ ...row, ...(overrides[i] || {}) }));
};

// ═══════════════════════ FIX 2 — ISSUE AXIS ═══════════════════════

console.log('-- Section 1: Fix 2 issue-axis — promote case --');
{
  const familyIssueConsensus = { uniqueRows: 4, support: 4, runnerUp: null };
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3], weightSum: 11.0 } };
  const visualItems = buildRows();
  const result = evaluateUnanimousConsensusPromotion(familyIssueConsensus, familyCandidate, visualItems);
  assertTrue(result.promote, 'promotes: uniqueRows=4, support===uniqueRows, no runnerUp, weightSum>=8, all distinct itemId/seller');
  assertEq(result.declineReason, null, 'no decline reason on promote');
}

console.log('\n-- Section 2: Fix 2 issue-axis — each condition declines independently --');
{
  const goodFamily = { topFamily: { indices: [0, 1, 2, 3], weightSum: 11.0 } };
  const goodRows = buildRows();

  assertFalse(evaluateUnanimousConsensusPromotion({ uniqueRows: 3, support: 3, runnerUp: null }, goodFamily, goodRows).promote, 'uniqueRows=3 < 4 declines');
  assertEq(evaluateUnanimousConsensusPromotion({ uniqueRows: 3, support: 3, runnerUp: null }, goodFamily, goodRows).declineReason, 'uniqueRows<4', 'correct decline reason for uniqueRows');

  assertFalse(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 3, runnerUp: null }, goodFamily, goodRows).promote, 'support=3 !== uniqueRows=4 declines (not exact unanimity, even at 75%)');
  assertEq(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 3, runnerUp: null }, goodFamily, goodRows).declineReason, 'not-exact-unanimity', 'correct decline reason for non-exact ratio — explicitly NOT >=0.9, per instruction');

  assertFalse(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: '366' }, goodFamily, goodRows).promote, 'a real runnerUp present declines, even with exact unanimity on the winner');
  assertEq(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: '366' }, goodFamily, goodRows).declineReason, 'runnerUp-present', 'correct decline reason for runnerUp');

  const thinFamily = { topFamily: { indices: [0, 1, 2, 3], weightSum: 7.9 } };
  assertFalse(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: null }, thinFamily, goodRows).promote, 'weightSum=7.9 < 8.0 declines');
  assertEq(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: null }, thinFamily, goodRows).declineReason, 'weightSum<8.0', 'correct decline reason for weightSum');

  const dupItemIdRows = buildRows([{}, { itemId: 'v1|100|0' }]); // row 1 shares row 0's itemId
  assertFalse(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: null }, goodFamily, dupItemIdRows).promote, 'duplicate itemId across members declines — anti-injection guard');
  assertEq(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: null }, goodFamily, dupItemIdRows).declineReason, 'duplicate-or-missing-itemId', 'correct decline reason for duplicate itemId');

  const dupSellerRows = buildRows([{}, { sellerUsername: 'seller_a' }]); // row 1 shares row 0's seller
  assertFalse(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: null }, goodFamily, dupSellerRows).promote, 'duplicate seller across members declines — the non-negotiable anti-injection guard');
  assertEq(evaluateUnanimousConsensusPromotion({ uniqueRows: 4, support: 4, runnerUp: null }, goodFamily, dupSellerRows).declineReason, 'duplicate-or-missing-seller', 'correct decline reason for duplicate seller');
}

// ═══════════════════════ FIX 2b — YEAR AXIS ═══════════════════════

console.log('\n-- Section 3: Fix 2b year-axis — the real repro shape (3 assert 2024, 1 silent) --');
{
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3] } };
  const visualItems = buildRows(); // rows 0-2 assert 2024, row 3 (silent) has year:null
  const priorConsensus = { mode: 'adopted', support: 3, uniqueRows: 4 }; // the real logged shape
  const result = evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, priorConsensus);
  assertTrue(result.promote, 'promotes: 3 asserting rows unanimous on 2024, the 4th (silent) row does not count against it');
  assertEq(result.year, '2024', 'resolved year is 2024');
  assertEq(result.inputs.assertingRows, 3, 'assertingRows=3 (not the raw uniqueRows=4)');
  assertEq(result.inputs.silentRows, 1, 'silentRows=1 (the "High Grade NM" row with no year token)');
  assertEq(result.inputs.dissentingRows, 0, 'dissentingRows=0 — the silent row is neutral, not dissent');
}

console.log('\n-- Section 4: Fix 2b year-axis — silence is not dissent (the core corrected-population proof) --');
{
  // Same 3-asserting/1-silent shape, but confirms the OLD naive
  // (support===uniqueRows) check would have wrongly declined this —
  // 3 !== 4 — while the corrected predicate promotes it. This is the
  // single assertion that proves the fix, not just documents it.
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3] } };
  const visualItems = buildRows();
  const priorConsensus = { mode: 'adopted', support: 3, uniqueRows: 4 };
  const naiveCheckWouldDecline = priorConsensus.support !== priorConsensus.uniqueRows;
  assertTrue(naiveCheckWouldDecline, 'sanity: confirms the naive support===uniqueRows check (3!==4) really would have declined this real shape');
  const result = evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, priorConsensus);
  assertTrue(result.promote, 'the corrected predicate promotes anyway — proves the fix, not just describes it');
}

console.log('\n-- Section 5: Fix 2b year-axis — a genuinely DISSENTING row hard-fails (not neutral like silence) --');
{
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3] } };
  const visualItems = buildRows([{}, {}, { year: 2023 }]); // row 2 asserts a DIFFERENT year
  const result = evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, { mode: 'conflict-locked' });
  assertFalse(result.promote, 'a row asserting a conflicting year declines — dissent is a hard fail, unlike silence');
  assertEq(result.declineReason, 'dissenting-row-present', 'correct decline reason');
  assertEq(result.inputs.dissentingRows, 1, 'dissentingRows correctly counts the one conflicting row, distinct from silentRows');
}

console.log('\n-- Section 6: Fix 2b year-axis — fewer than 3 asserting rows declines, even at 100% agreement --');
{
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3] } };
  const visualItems = buildRows([{}, { year: null }, { year: null }]); // only row 0 asserts a year now
  const result = evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, { mode: 'adopted' });
  assertFalse(result.promote, 'assertingRows=1 (even at trivial 100% self-agreement) declines — a lone assertion is not a vote');
  assertEq(result.declineReason, 'assertingRows<3', 'correct decline reason');
}

console.log('\n-- Section 7: Fix 2b year-axis — distinct itemId/seller required among ASSERTING rows specifically --');
{
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3] } };
  // Rows 0-2 assert 2024 but rows 0 and 1 share a seller — should decline
  // even though row 3 (silent, different seller) is irrelevant to this
  // check, since it never asserted anything.
  const visualItems = buildRows([{}, { sellerUsername: 'seller_a' }]);
  const result = evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, { mode: 'adopted' });
  assertFalse(result.promote, 'duplicate seller among the 3 asserting rows declines');
  assertEq(result.declineReason, 'duplicate-or-missing-seller', 'correct decline reason');
}

console.log('\n-- Section 8: Fix 2b year-axis — mode not adopted at the call site means the check is never invoked (mirrors the real call site\'s own guard) --');
{
  // This is a call-site-level guard (api/enrich.js only calls
  // evaluateUnanimousYearConsensusPromotion when familyYearConsensus.mode
  // === 'adopted'), not something the function itself enforces — verified
  // here as documentation of that contract, not a claim the function
  // rejects other modes internally (it doesn't need to; the real caller
  // already gates it).
  const familyCandidate = { topFamily: { indices: [0, 1, 2, 3] } };
  const visualItems = buildRows();
  const priorConsensus = { mode: 'no-consensus', support: 0, uniqueRows: 4 };
  const result = evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, priorConsensus);
  // The function itself still evaluates asserting rows directly from
  // visualItems (it doesn't read priorConsensus.mode at all for its own
  // decision) — with 3 real asserting rows unanimous on 2024, it WOULD
  // promote if called. This confirms familyYearConsensus is cross-
  // reference-only input, exactly as designed.
  assertTrue(result.promote, 'the function computes from raw rows regardless of priorConsensus.mode — confirms familyYearConsensus is logged for cross-reference only, never consulted for the decision itself');
}

// ═══════════════ V4 — provenance-scoped conflict escalation ═══════════════

console.log('\n-- Section 9: promoted-confirmed + conflict => escalates to conflicted --');
{
  const promotedConfirmed = {
    source: 'marketplace',
    status: 'confirmed',
    reasons: ['marketplace-only-adoption', 'unanimous-marketplace-consensus'],
  };
  const conflict = { currentIssue: '351', consensusIssue: '366' };
  const result = escalateIssueAuthorityOnConflict(promotedConfirmed, conflict);
  assertTrue(result !== promotedConfirmed, 'returns a new object (escalated), not the same reference');
  assertEq(result.status, 'conflicted', 'status becomes conflicted');
  assertTrue(result.reasons.includes('unanimous-marketplace-consensus'), 'original promotion reason preserved, never dropped');
  assertTrue(result.reasons.includes('visual-pool-issue-divergence'), 'new escalation reason appended');
}

console.log('\n-- Section 10: catalog/other-route confirmed + conflict => does NOT escalate (provenance-scoped, not status-loosened) --');
{
  // The real manualCorrection.js shape (Commit 3, source:'user') — proves
  // the check is scoped to the SPECIFIC promotion reason string, not to
  // status==='confirmed' in general, which would have inverted the
  // standing authority matrix (catalog holds identity authority,
  // marketplace holds pricing-evidence authority).
  const userConfirmed = {
    source: 'user',
    status: 'confirmed',
    reasons: ['user-correction'],
  };
  const conflict = { currentIssue: '351', consensusIssue: '366' };
  const result = escalateIssueAuthorityOnConflict(userConfirmed, conflict);
  assertTrue(result === userConfirmed, 'returns the SAME reference unchanged — no escalation, referential no-op');
  assertEq(result.status, 'confirmed', 'status stays confirmed — a marketplace pool disagreement never overrides catalog/user-confirmed identity');
}

console.log('\n-- Section 11: provisional + conflict => escalates (unchanged, regression guard) --');
{
  const provisional = {
    source: 'marketplace',
    status: 'provisional',
    reasons: ['marketplace-only-adoption'],
  };
  const conflict = { currentIssue: '351', consensusIssue: '366' };
  const result = escalateIssueAuthorityOnConflict(provisional, conflict);
  assertTrue(result !== provisional, 'still escalates — the original, pre-Dispatch-25 behavior is unchanged');
  assertEq(result.status, 'conflicted', 'status becomes conflicted');
}

console.log('\n-- Section 12: promoted-confirmed + no conflict => stays confirmed --');
{
  const promotedConfirmed = {
    source: 'marketplace',
    status: 'confirmed',
    reasons: ['marketplace-only-adoption', 'unanimous-marketplace-consensus'],
  };
  const result = escalateIssueAuthorityOnConflict(promotedConfirmed, null);
  assertTrue(result === promotedConfirmed, 'no conflict signal — referential no-op, stays confirmed');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
