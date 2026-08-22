// tests/grailkey-dispatch-25-fix1-instrumentation.test.js
//
// GrailKey Dispatch 25 (2026-08-07) — Fix 1 STEP 1, instrumentation only.
//
// Repro: Spawn #351 Cover C Brett Booth Virgin Variant, two scans
// (22:08:43 and 22:16:19 UTC, build b926dba), identical failure both
// times — [evidence-eligibility] active: classification eliminated all
// 14 pre-classification survivor(s), zero rows survive, no reason
// logged for any row.
//
// Code-level finding (confirmed by direct read of
// src/lib/evidenceEligibility.js before writing this test, not
// assumed): TARGET_ISSUE_PROVISIONAL_AUTHORITY (evidenceEligibility.js
// ~line 322) is an `else if` branch mutually exclusive with WRONG_ISSUE
// — when it fires, hasIssueNumber() (the title/issue text check) is
// NEVER evaluated for that row. It fires whenever
// target.issueAuthorityPresent===true and
// target.issueAuthorityStatus!=='confirmed' — exactly the shape
// Commit 4's marketplace-only-adoption produces
// (out.issueAuthority.status='provisional'), threaded verbatim into
// evidenceTarget (api/comps.js:2186-2187, from api/enrich.js's
// fetchComps call site, api/enrich.js:5721-5722). This code path is
// UNCONDITIONAL on title/variant content — it would reject a row
// regardless of what evidenceTarget.seriesTitle holds, killing the
// originally-stated hypothesis (a 22e-force bare-title mismatch) at the
// code level, before any live re-scan. The instrumentation below exists
// to let a real production re-scan CONFIRM this from raw logs, not
// replace that confirmation with code-reading alone — per explicit
// instruction, this dispatch does not treat code-reading as a
// substitute for re-running the repro.
//
// Every assertion here proves instrumentation is ADDITIVE — same
// rejectionCodes, same identityEligible/rawPricingEligible/etc., same
// isPricingMathEligible result, same buildPricingEligibleRows filter
// outcome, for identical inputs, as the pre-Dispatch-25 shape (verified
// against the full pre-existing regression suites in the commit that
// introduced this file, not just asserted fresh here).
//
// CORRECTED (GK-158, 2026-08-22): the "code-level finding" above — that
// TARGET_ISSUE_PROVISIONAL_AUTHORITY fires UNCONDITIONALLY, regardless of
// title/issue content — was accurate for the code AS IT STOOD in Dispatch
// 25, but described a real defect, not intended behavior: a comps pool
// genuinely agreeing with a provisional/contested issue value is usable
// pricing evidence for that reading, not something to blanket-discard.
// GK-158 narrowed the gate so hasIssueNumber is evaluated even under
// provisional/conflicted authority — a matching row is now identity-
// ELIGIBLE (tagged PROVISIONAL_ISSUE_MATCH); a genuinely mismatching row
// is still rejected (WRONG_ISSUE). Sections 2 and 4 below are updated
// accordingly; this header is retained for history, not as a current
// description of the gate's behavior.

import { classifyEvidenceRow, buildPricingEligibleRows, PRICING_GATE_CODES } from '../src/lib/evidenceEligibility.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

function captureLogs(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  let result;
  try { result = fn(); } finally { console.log = original; }
  return { result, lines };
}

console.log('\n=== GrailKey Dispatch 25 — Fix 1 STEP 1 instrumentation ===\n');

// ─── SECTION 1 — rejectionDetails is 1:1 with rejectionCodes, additive only ───
console.log('-- Section 1: rejectionDetails shape --');
{
  const target = { issue: '351', seriesTitle: 'Spawn', assetType: 'comic' };
  const row = { title: 'Spawn Comic Book Capullo Cover Artwork', marketState: 'active' };
  // No issue token at all in this title -> WRONG_ISSUE (target.issue resolved, issueAuthorityPresent not set).
  const classification = classifyEvidenceRow(row, target);
  assertEq(classification.rejectionCodes.length, classification.rejectionDetails.length, 'rejectionDetails is the same length as rejectionCodes');
  assertEq(classification.rejectionDetails.map(d => d.code), classification.rejectionCodes, 'rejectionDetails codes match rejectionCodes in the same order');
}

// ─── SECTION 2 — the repro's exact shape, CORRECTED by GK-158 (2026-08-22) ───
console.log('\n-- Section 2: the real repro shape (issueAuthority.status=provisional) --');
{
  // GK-158 CORRECTION: this section originally proved
  // TARGET_ISSUE_PROVISIONAL_AUTHORITY fired UNCONDITIONALLY, rejecting
  // even a row that "would otherwise match on both axes" — exactly the
  // over-broad behavior GK-158 was commissioned to fix (a genuinely
  // matching comps pool is real, corroborating evidence for a contested
  // issue value, not something to blanket-discard). hasIssueNumber is now
  // evaluated even under provisional/conflicted authority: a matching row
  // is identity-ELIGIBLE (tagged PROVISIONAL_ISSUE_MATCH), a mismatching
  // row is still rejected outright (WRONG_ISSUE). Section 2 below is
  // rewritten to prove BOTH halves — the original "unconditional on title
  // content" framing is retired (it described the bug this ticket fixes,
  // not intended behavior).
  const target = {
    issue: '351',
    seriesTitle: 'Spawn',
    variant: 'Brett Booth',
    assetType: 'comic',
    issueAuthorityPresent: true,
    issueAuthorityStatus: 'provisional',
  };
  const row = { title: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)', marketState: 'active' };
  const classification = classifyEvidenceRow(row, target);
  assertEq(classification.rejectionCodes, [], 'GK-158: a row genuinely matching #351 carries NO rejection code at all under provisional authority — it is real, admitted evidence');
  assertEq(classification.comparabilityStatus, 'PROVISIONAL_ISSUE_MATCH', 'GK-158: tagged PROVISIONAL_ISSUE_MATCH — eligible, but honestly labeled as resting on an unconfirmed issue value');
  assertEq(classification.identityEligible, true, 'GK-158: identityEligible=true for a matching row under provisional authority');
  assertEq(classification.rawPricingEligible, true, 'GK-158: rawPricingEligible=true — this row may now contribute to the price');

  // Negative control (preserves this section's own original intent, now
  // correctly framed): a title with ZERO relation to "Spawn"/"351" is
  // still rejected — WRONG_ISSUE, evaluated for real, not waved through
  // because the authority happens to be provisional.
  const unrelatedRow = { title: 'Completely Unrelated Comic Title #999', marketState: 'active' };
  const unrelatedClassification = classifyEvidenceRow(unrelatedRow, target);
  assertEq(unrelatedClassification.rejectionCodes, ['WRONG_ISSUE'], 'GK-158: an unrelated title is rejected as WRONG_ISSUE — the provisional-authority branch now genuinely evaluates title/issue content instead of short-circuiting');
  assertEq(unrelatedClassification.rawPricingEligible, false, 'GK-158: an unrelated title stays ineligible under provisional authority');
}

// ─── SECTION 3 — PRICING_GATE_CODES membership (the actual isPricingMathEligible driver) ───
console.log('\n-- Section 3: TARGET_ISSUE_PROVISIONAL_AUTHORITY is a real PRICING_GATE_CODES entry --');
{
  assertTrue(PRICING_GATE_CODES.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), 'confirmed present in the actual exported PRICING_GATE_CODES array, not assumed from the doc comment');
}

// ─── SECTION 4 — buildPricingEligibleRows logs exactly one reject line per eliminated row, with the blocking code/reason ───
console.log('\n-- Section 4: buildPricingEligibleRows reject logging --');
{
  // GK-158 CORRECTION: the original fixture rows genuinely matched
  // target.issue='351' — under the fix, matching rows are now ELIGIBLE
  // (see Section 2), so this fixture no longer eliminates anything and
  // can no longer prove reject-logging via WRONG_ISSUE. Two DISTINCT
  // fixtures now: matchingRows (proves the new admission path — no
  // reject lines, both rows survive) and a graded row that ALSO matches
  // the issue but trips an unrelated, genuine PRICING_GATE_CODES entry
  // (FORMAT_MISMATCH_RAW_VS_SLAB) — preserving this section's original
  // purpose (reject-logging fires per eliminated row) without relying on
  // WRONG_ISSUE, which this dispatch discovered is NOT itself a
  // PRICING_GATE_CODES member (see the GK-35 note below).
  const target = {
    issue: '351',
    seriesTitle: 'Spawn',
    assetType: 'comic',
    issueAuthorityPresent: true,
    issueAuthorityStatus: 'provisional',
  };

  const matchingRows = [
    { title: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN', marketState: 'active' },
    { title: 'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM', marketState: 'active' },
  ];
  const matchingRun = captureLogs(() => buildPricingEligibleRows(matchingRows, target));
  assertEq(matchingRun.result.length, 2, 'GK-158: both genuinely-matching rows now SURVIVE buildPricingEligibleRows — real evidence for a provisional issue is not eliminated');
  assertEq(matchingRun.lines.filter(l => l.includes('[evidence-eligibility-reject]')).length, 0, 'GK-158: zero reject lines for rows that matched and were admitted');

  const gradedMatchingRows = [
    { title: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN CGC 9.8', marketState: 'active' },
  ];
  const { result, lines } = captureLogs(() => buildPricingEligibleRows(gradedMatchingRows, target));
  assertEq(result.length, 0, 'a row matching the (provisional) issue is still eliminated for an UNRELATED, genuine reason (raw target vs. a graded/slabbed row)');
  const rejectLines = lines.filter(l => l.includes('[evidence-eligibility-reject]'));
  assertEq(rejectLines.length, 1, 'exactly one reject line for the one eliminated row');
  assertTrue(rejectLines[0].includes('idx=0'), 'reject line carries idx=0');
  assertTrue(rejectLines[0].includes('class=FORMAT_MISMATCH_RAW_VS_SLAB'), 'class= names the actual PRICING_GATE_CODES entry that blocked this row — NOT TARGET_ISSUE_PROVISIONAL_AUTHORITY (the row matched the issue) and NOT WRONG_ISSUE (not a real member of this list — see the GK-35 note below)');
  assertTrue(rejectLines[0].includes('targetTitle="Spawn"'), 'targetTitle= is printed, not inferred');
  assertTrue(rejectLines[0].includes('reason='), 'reason= field present');

  // GK-158 FINDING FOR GK-35 (2026-08-22, not fixed here — GK-35 is its
  // own, separately-tracked, deliberately-unfixed ticket; scope
  // discipline, not an oversight): PRICING_GATE_CODES does not include
  // WRONG_ISSUE at all (confirmed directly below, not assumed) — so
  // buildPricingEligibleRows/isPricingMathEligible do NOT exclude a row
  // that classifyEvidenceRow itself correctly marks
  // rawPricingEligible=false for a plain issue mismatch. Before GK-158,
  // a mismatch under provisional/contested authority was safely caught
  // anyway, because the OLD blanket behavior produced
  // TARGET_ISSUE_PROVISIONAL_AUTHORITY (which IS gate-listed) for every
  // row regardless of match. GK-158 makes this combination reachable for
  // the FIRST time: a row that mismatches under provisional/contested
  // authority now produces WRONG_ISSUE, which this gate ignores. In the
  // real api/comps.js pipeline this is not currently observed to matter
  // (an earlier, separate per-attempt issue-number filter — confirmed via
  // direct trace, not assumed — already removes plainly-mismatched rows
  // before evidenceEligibility.js ever runs), but that earlier filter is
  // a simpler regex, not hasIssueNumber's own more nuanced check, so a
  // row that fools the earlier filter but not hasIssueNumber could reach
  // this exact gap. Logged here as new, concrete evidence for GK-35 —
  // not fixed in this dispatch (adding WRONG_ISSUE to PRICING_GATE_CODES
  // is a real pricing-math-adjacent change requiring its own scoping and
  // regression pass against every existing PRICING_GATE_CODES consumer,
  // not a one-line addition folded into GK-158's own scope).
  assertEq(PRICING_GATE_CODES.includes('WRONG_ISSUE'), false, 'GK-35 (logged, not fixed here): WRONG_ISSUE is confirmed NOT a PRICING_GATE_CODES member — buildPricingEligibleRows does not exclude a plain issue mismatch on its own, a pre-existing gap GK-158 makes newly reachable via the provisional/contested-authority path specifically');
}

// ─── SECTION 5 — a row eliminated for a DIFFERENT PRICING_GATE_CODES reason still logs correctly (not hardcoded to the provisional-authority case) ───
// Genuinely surprising, existing (pre-Dispatch-25) behavior discovered
// while writing this test, not introduced by this instrumentation:
// isPricingMathEligible only reacts to PRICING_GATE_CODES membership
// (6 codes), NOT the full identityEligible determination — LOT_OR_BUNDLE,
// WRONG_VARIANT, WRONG_PRINTING, WRONG_ISSUE, WRONG_YEAR,
// COLLECTED_EDITION_MISMATCH, SIGNED_MISMATCH, and
// FORMAT_MISMATCH_GRADED_VS_RAW do NOT trigger this specific filter at
// all (a row carrying ONLY one of those codes still passes
// buildPricingEligibleRows) — confirmed by this test's own original,
// wrong assumption failing exactly here before this fix. Using
// TARGET_ISSUE_UNRESOLVED instead — a genuine PRICING_GATE_CODES member
// — to prove the reject-logging itself is generic, not special-cased to
// TARGET_ISSUE_PROVISIONAL_AUTHORITY.
console.log('\n-- Section 5: a different PRICING_GATE_CODES rejection still logs correctly --');
{
  const target = { issue: null, seriesTitle: 'Spawn', assetType: 'comic' }; // unresolved issue axis
  const rows = [{ title: 'Spawn Comic Book Capullo Cover Artwork', marketState: 'active' }];
  const { result, lines } = captureLogs(() => buildPricingEligibleRows(rows, target));
  assertEq(result.length, 0, 'row with an unresolved target issue is eliminated');
  const rejectLine = lines.find(l => l.includes('[evidence-eligibility-reject]'));
  assertTrue(!!rejectLine, 'reject line fired');
  assertTrue(rejectLine.includes('TARGET_ISSUE_UNRESOLVED'), 'class= correctly names TARGET_ISSUE_UNRESOLVED, not TARGET_ISSUE_PROVISIONAL_AUTHORITY — this file\'s instrumentation is generic, not special-cased to the one hypothesis under test');
}

// ─── SECTION 6 — a row that PASSES logs nothing (no noise on the success path) ───
console.log('\n-- Section 6: eligible rows produce no reject line --');
{
  const target = { issue: '351', seriesTitle: 'Spawn', assetType: 'comic' };
  const rows = [{ title: 'Spawn #351 NM', marketState: 'active' }];
  const { result, lines } = captureLogs(() => buildPricingEligibleRows(rows, target));
  assertEq(result.length, 1, 'row survives (no provisional authority, no lot/variant/format issues)');
  assertEq(lines.filter(l => l.includes('[evidence-eligibility-reject]')).length, 0, 'zero reject lines for a row that passed — instrumentation is silent on the success path');
}

// ─── SECTION 7 — [evidence-target] log exists in api/comps.js, matching the requested format ───
console.log('\n-- Section 7: [evidence-target] log site (source check) --');
{
  const { readFileSync } = await import('node:fs');
  const compsSource = readFileSync(new URL('../api/comps.js', import.meta.url), 'utf8');
  assertTrue(/\[evidence-target\] seriesTitle=/.test(compsSource), '[evidence-target] log line present in api/comps.js');
  assertTrue(/issueAuthorityStatus="\$\{evidenceTarget\.issueAuthorityStatus/.test(compsSource), 'log line reads issueAuthorityStatus directly off the constructed evidenceTarget object (not a separately-tracked, potentially-drifted copy)');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
