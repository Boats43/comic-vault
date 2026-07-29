// tests/q-trackB-commit1.1-verification-hardening.test.js
//
// Track B Phase 0, Commit 1.1 — verification hardening on top of Commit 1
// (5dd59f4), inserted before Commit 2 per explicit instruction. Does NOT
// rewrite or revert Commit 1. Four items:
//   1. soldVerification.js's own isPricingMathEligible(classifyEvidenceRow(...))
//      inline composition (line ~405, pre-existing, predates invariant 10)
//      converged onto the shared buildPricingEligibleRows export.
//   2. A real sold-pipeline consumer test (verifySoldComps itself, not a
//      mirror) proving a null-issue target yields zero verified sold rows
//      with the removedCodes breakdown showing TARGET_ISSUE_UNRESOLVED.
//   3. TPB control — assetType 'tpb' (the live case; production never
//      passes 'book') with issue:null is a LEGITIMATE state (TPBs have no
//      issue numbers) and must stay pricingMathEligible=true, while
//      assetType 'comic' with issue:null stays gated.
//   4. buildPricingEligibleRows' (rows || []) null-guard — documented,
//      loud-logged, explicitly tested behavior, not a silent side effect.
//
// Invoke: node tests/q-trackB-commit1.1-verification-hardening.test.js

import {
  classifyEvidenceRow, buildPricingEligibleRows,
} from '../src/lib/evidenceEligibility.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Track B Phase 0, Commit 1.1 — verification hardening ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// ITEM 1 + 2 — sold call-site convergence + real sold-consumer test
// ══════════════════════════════════════════════════════════════════════════════
console.log('Item 1+2: verifySoldComps (real production entry point) on a null-issue target\n');
{
  const ctx = {
    title: 'Strange Tales', issue: null, variant: null, publisher: 'Marvel',
    bookYear: null, userGradeKey: null, assessedGrade: null, priceLadder: null,
    cvVolumeStartYear: null, labelType: null, signedConsensus: false,
  };
  // Clean rows, deliberately isolating the D1 gate: no lot/variant/signed/
  // slab/format signal, uniform close prices (no outlier trigger), no
  // bookYear/userGradeKey (so grade-proximity and era-year filters are
  // skipped entirely) — confirmed by direct execution that all 3 survive
  // the ENTIRE legacy filter chain (chain-survivors=3) and are removed
  // ONLY by the evidence-eligibility gate.
  const rawRows = [
    { title: 'Strange Tales #142 Marvel', price: 30, daysAgo: 10 },
    { title: 'Strange Tales #101 Marvel', price: 32, daysAgo: 20 },
    { title: 'Strange Tales #76 Marvel', price: 28, daysAgo: 15 },
  ];
  const result = verifySoldComps(rawRows, ctx);
  assertEq(result.verified.length, 0, 'null-issue target: verifySoldComps returns ZERO verified sold rows (the sold ladder/average/recommendation receives none)');
  assertEq(result.diagnostics.verifiedCount, 0, 'diagnostics.verifiedCount=0');
  assertEq(result.diagnostics.rejectedCount, 3, 'diagnostics.rejectedCount=3 (all 3 raw rows)');
  assertTrue(!!result.evidence, 'result.evidence present (buildEvidencePopulations ran)');
  assertEq(result.evidence.rejectionCodeCounts.TARGET_ISSUE_UNRESOLVED, 3, 'removedCodes breakdown: TARGET_ISSUE_UNRESOLVED=3 (evidence.rejectionCodeCounts, the structured form of the [evidence-eligibility] sold:main removedCodes log line)');
  assertEq(result.evidence.similarTitleReferences.length, 3, 'all 3 rows retained as similarTitleReferences, never silently dropped');
}

// Control: resolved, matching issue on the SAME real path — confirms this
// hardening does not over-narrow a normal sold pool.
console.log('\nControl: resolved-issue target through the same real verifySoldComps path\n');
{
  const ctx = {
    title: 'Strange Tales', issue: '142', variant: null, publisher: 'Marvel',
    bookYear: null, userGradeKey: null, assessedGrade: null, priceLadder: null,
    cvVolumeStartYear: null, labelType: null, signedConsensus: false,
  };
  const rawRows = [
    { title: 'Strange Tales #142 Marvel', price: 30, daysAgo: 10 },
    { title: 'Strange Tales #142 Marvel VG', price: 32, daysAgo: 20 },
  ];
  const result = verifySoldComps(rawRows, ctx);
  assertEq(result.verified.length, 2, 'control: resolved matching issue -> both rows verified (unaffected by this commit)');
  assertEq(result.evidence.rejectionCodeCounts.TARGET_ISSUE_UNRESOLVED || 0, 0, 'control: zero TARGET_ISSUE_UNRESOLVED rejections');
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM 3 — TPB control (assetType with no issue axis)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nItem 3: TPB (no issue axis) vs comic (has issue axis), both with issue:null\n');
{
  const row = { title: 'Saga Volume 1 Image', price: 15, marketState: 'active' };

  const tpbTarget = { issue: null, seriesTitle: 'Saga', confirmedYear: 2020, publisher: 'Image', isGraded: false, userGradeKey: 'raw', assetType: 'tpb' };
  const tpbClassification = classifyEvidenceRow(row, tpbTarget);
  assertTrue(tpbClassification.rawPricingEligible, 'TPB + issue:null: rawPricingEligible=true (a TPB legitimately has no issue number)');
  assertFalse(tpbClassification.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), 'TPB + issue:null: TARGET_ISSUE_UNRESOLVED does NOT fire');
  assertEq(buildPricingEligibleRows([row], tpbTarget).length, 1, 'TPB + issue:null: buildPricingEligibleRows keeps the row');

  const comicTarget = { issue: null, seriesTitle: 'Saga', confirmedYear: 2020, publisher: 'Image', isGraded: false, userGradeKey: 'raw', assetType: 'comic' };
  const comicClassification = classifyEvidenceRow(row, comicTarget);
  assertFalse(comicClassification.rawPricingEligible, 'comic + issue:null: rawPricingEligible=false (genuinely unresolved issue axis)');
  assertTrue(comicClassification.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), 'comic + issue:null: TARGET_ISSUE_UNRESOLVED DOES fire (unchanged Commit 1 behavior)');
  assertEq(buildPricingEligibleRows([row], comicTarget).length, 0, 'comic + issue:null: buildPricingEligibleRows excludes the row');

  // Forward-safety spot check (not a live production case today, per the
  // dispatch — production only ever passes 'tpb'/'comic') — 'book' and
  // 'collected' get the identical no-issue-axis treatment as 'tpb'.
  const bookTarget = { ...tpbTarget, assetType: 'book' };
  assertTrue(classifyEvidenceRow(row, bookTarget).rawPricingEligible, "assetType 'book' (not yet a live caller): same no-issue-axis treatment as tpb");
  const collectedTarget = { ...tpbTarget, assetType: 'collected' };
  assertTrue(classifyEvidenceRow(row, collectedTarget).rawPricingEligible, "assetType 'collected' (not yet a live caller): same no-issue-axis treatment as tpb");

  // A TPB target with a genuinely WRONG resolved issue (not null) must
  // still be unaffected by this change — this fix only silences the
  // "unresolved" state for issue-less asset types, it does not disable
  // WRONG_ISSUE checking that a caller might still legitimately want.
  // (No current caller passes a non-null issue for assetType:'tpb', but
  // the classifier itself must not crash or misclassify if one did.)
  const tpbWithIssueTarget = { ...tpbTarget, issue: '1' };
  const tpbWithIssueRow = { title: 'Saga Volume 1 Image', price: 15, marketState: 'active' };
  const tpbWithIssueClassification = classifyEvidenceRow(tpbWithIssueRow, tpbWithIssueTarget);
  assertFalse(tpbWithIssueClassification.rejectionCodes.includes('TARGET_ISSUE_UNRESOLVED'), "TPB with a non-null issue: still no TARGET_ISSUE_UNRESOLVED (issue axis is skipped entirely for tpb, not just the null case)");
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM 4 — buildPricingEligibleRows null-guard semantics
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nItem 4: buildPricingEligibleRows null-guard — documented, loud-logged, tested\n');
{
  const target = { issue: '1', seriesTitle: 'Test', confirmedYear: 2020, assetType: 'comic', isGraded: false, userGradeKey: 'raw' };

  // Capture console.log to prove the loud diagnostic actually fires — not
  // just trusted to exist because the code has a console.log line (per
  // this codebase's own "Log Statement Discipline" standing rule: test
  // that a log statement actually triggers, don't just read the source).
  const originalLog = console.log;
  let capturedLogs = [];
  console.log = (...args) => { capturedLogs.push(args.join(' ')); };

  let nullResult, undefinedResult, emptyResult;
  try {
    nullResult = buildPricingEligibleRows(null, target);
    undefinedResult = buildPricingEligibleRows(undefined, target);
    emptyResult = buildPricingEligibleRows([], target);
  } finally {
    console.log = originalLog;
  }

  assertEq(nullResult, [], 'buildPricingEligibleRows(null, target) returns [] (never throws)');
  assertEq(undefinedResult, [], 'buildPricingEligibleRows(undefined, target) returns [] (never throws)');
  assertEq(emptyResult, [], 'buildPricingEligibleRows([], target) returns [] (genuinely empty pool, same result, different cause)');

  const nullLogFired = capturedLogs.some((l) => l.includes('upstream population') && l.includes('missing'));
  assertTrue(nullLogFired, 'a loud [evidence-eligibility] diagnostic log actually fired for the null/undefined case (verified by capturing console.log, not assumed from source)');
  const emptyLogFired = capturedLogs.some((l) => l.includes('upstream population'));
  assertEq(capturedLogs.filter((l) => l.includes('upstream population')).length, 2, 'the diagnostic logs exactly twice (once for null, once for undefined) and NOT for the genuinely-empty-array call — silent for the normal empty-pool case, loud only for the null/undefined defect case');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
