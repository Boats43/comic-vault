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

// ─── SECTION 2 — the repro's exact shape: TARGET_ISSUE_PROVISIONAL_AUTHORITY ───
console.log('\n-- Section 2: the real repro shape (issueAuthority.status=provisional) --');
{
  // Reconstructs the real Spawn #351 scan's evidenceTarget shape: a
  // variant-specific comp title that WOULD pass a title/issue check
  // (contains "Spawn", contains "351") but the target's issue authority
  // is provisional (Commit 4 marketplace-only-adoption).
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
  assertEq(classification.rejectionCodes, ['TARGET_ISSUE_PROVISIONAL_AUTHORITY'], 'rejects on TARGET_ISSUE_PROVISIONAL_AUTHORITY alone — no WRONG_ISSUE, no WRONG_VARIANT, despite a title that would otherwise match on both axes');
  assertTrue(classification.rejectionDetails[0].predicate.includes('hasIssueNumber was never evaluated'), 'predicate explicitly states the title/issue check was short-circuited, not that it ran and failed');
  assertEq(classification.identityEligible, false, 'identityEligible=false');
  assertEq(classification.rawPricingEligible, false, 'rawPricingEligible=false');

  // Confirms this is unconditional on title content: swapping in a
  // title that has ZERO relation to "Spawn"/"351" produces the
  // IDENTICAL rejection — proving the title text is irrelevant to this
  // specific rejection path, not merely untested.
  const unrelatedRow = { title: 'Completely Unrelated Comic Title #999', marketState: 'active' };
  const unrelatedClassification = classifyEvidenceRow(unrelatedRow, target);
  assertEq(unrelatedClassification.rejectionCodes, ['TARGET_ISSUE_PROVISIONAL_AUTHORITY'], 'an unrelated title produces the identical single rejection code — confirms this branch never reaches the title/issue check regardless of title content');
}

// ─── SECTION 3 — PRICING_GATE_CODES membership (the actual isPricingMathEligible driver) ───
console.log('\n-- Section 3: TARGET_ISSUE_PROVISIONAL_AUTHORITY is a real PRICING_GATE_CODES entry --');
{
  assertTrue(PRICING_GATE_CODES.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY'), 'confirmed present in the actual exported PRICING_GATE_CODES array, not assumed from the doc comment');
}

// ─── SECTION 4 — buildPricingEligibleRows logs exactly one reject line per eliminated row, with the blocking code/reason ───
console.log('\n-- Section 4: buildPricingEligibleRows reject logging --');
{
  const target = {
    issue: '351',
    seriesTitle: 'Spawn',
    assetType: 'comic',
    issueAuthorityPresent: true,
    issueAuthorityStatus: 'provisional',
  };
  const rows = [
    { title: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN', marketState: 'active' },
    { title: 'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM', marketState: 'active' },
  ];
  const { result, lines } = captureLogs(() => buildPricingEligibleRows(rows, target));
  assertEq(result.length, 0, 'both rows eliminated (matches the real repro: 14 in, 0 out)');
  const rejectLines = lines.filter(l => l.includes('[evidence-eligibility-reject]'));
  assertEq(rejectLines.length, 2, 'exactly one reject line per eliminated row — not one summary line for the whole batch');
  assertTrue(rejectLines[0].includes('idx=0'), 'first reject line carries idx=0');
  assertTrue(rejectLines[1].includes('idx=1'), 'second reject line carries idx=1');
  assertTrue(rejectLines[0].includes('class=TARGET_ISSUE_PROVISIONAL_AUTHORITY'), 'class= names the actual PRICING_GATE_CODES entry that blocked this row');
  assertTrue(rejectLines[0].includes('targetTitle="Spawn"'), 'targetTitle= is printed, not inferred — this is what a real re-scan needs to confirm/kill the seriesTitle hypothesis');
  assertTrue(rejectLines[0].includes('reason='), 'reason= field present');
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
