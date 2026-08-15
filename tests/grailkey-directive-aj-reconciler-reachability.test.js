// tests/grailkey-directive-aj-reconciler-reachability.test.js
//
// GrailKey Directive 2026-08-15-AJ — Slice 1 acceptance, Proof 1
// (reconciler reachability). AI's original branch only invoked
// selectFirstEligibleVisual/the guard logic when confirmedIssue was
// already null — reconcileIssue itself was never imported or called
// anywhere in the production pipeline at all (grep-confirmed zero hits
// pre-fix). This meant a CONFIDENTLY-WRONG-BUT-NON-NULL issue (Vision
// asserts a value, the raw pool has WEAK but nonzero support for it, so
// the zero-support check never runs) never had its value compared
// against firstEligibleVisual — exactly the disease shape this whole
// campaign exists to close, reproduced by AI's own fix.
//
// Fixed: identityCore.js's resolveIdentity now builds an issue evidence
// set and calls reconcileIssue UNCONDITIONALLY, on every issue
// resolution — not gated on confirmedIssue being null. Upstream
// resolvers (family-consensus, zero-support override/escalate, retention/
// rescue) still run exactly as before; their outputs become evidence at
// the reconciler's existing precedence ('family-consensus' >
// 'first-eligible-visual' > 'vision'), rather than pre-empting the
// reconciler from running at all. A sixth guard (contaminated family,
// hasContaminatedMember) was found and added during this dispatch's own
// regression sweep — the same signal familyAuthorityBaseConditions
// already gates retention/rescue on now also gates first-eligible-visual
// evidence.
//
// Invoke: node tests/grailkey-directive-aj-reconciler-reachability.test.js

import { resolveIdentity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

// Captures every [reconcile-issue] console.log line emitted during `fn()`,
// parsed into structured fields — the "reconciler artifact" Proof 1
// requires assertions to target, not the output value alone.
const captureReconcileLogs = (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    const s = args.join(' ');
    if (s.startsWith('[reconcile-issue]')) lines.push(s);
    orig(...args);
  };
  let result;
  try {
    result = fn();
  } finally {
    console.log = orig;
  }
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

console.log('\n=== GrailKey Directive AJ — Proof 1: reconciler reachability ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Fixture P1 — the confidently-wrong-but-non-null case (SHIP-BLOCKING)
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture P1: Vision confidently keeps a weakly-supported issue — reconciler must still run and may overturn it\n');

{
  const vision = { title: 'Venom: Separation Anxiety', issue: '3', year: null, publisher: 'Marvel' };
  // WEAK but NONZERO support for Vision's "#3" — ratio 3/20 = 15%, above
  // ISSUE_ZERO_SUPPORT_RATIO_FLOOR (10%), so the existing zero-support
  // ESCALATE/OVERRIDE block never even runs. Upstream "confidently keeps"
  // confirmedIssue = vision.issue by simple passthrough — no family
  // branch overrides it either (family.decision: 'fallback-vision').
  const ebay = {
    title: 'Venom Separation Anxiety', issue: null, publisher: 'Marvel',
    agreement: { visionIssueCount: 3, total: 20 },
    noIssueConsensus: false,
  };
  const family = { decision: 'fallback-vision', selectedTitle: null, topFamily: null, runnerUp: null };
  const visualItems = rows([
    'Venom Separation Anxiety #1 Marvel',
    'Venom Separation Anxiety #1 Marvel NM',
    'Venom Separation Anxiety #1 Marvel VF',
    'Venom Separation Anxiety #3 Marvel',
    'Venom Separation Anxiety #3 Marvel NM',
    'Venom Separation Anxiety #3 Marvel VF',
    'Venom Separation Anxiety #2 Marvel',
  ]);

  const { result: identity, logs } = captureReconcileLogs(() =>
    resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems })
  );

  assertTrue(logs.length >= 1, 'P1: [reconcile-issue] decision log fired — the reconciler was actually invoked, not bypassed because confirmedIssue was non-null');
  const log = logs[logs.length - 1];
  assertEq(log.source, 'first-eligible-visual', 'P1: reconciler artifact — winning source is first-eligible-visual (asserted on the decision log, not the output value)');
  assertTrue(log.justifiedBy.some((j) => j.source === 'first-eligible-visual' && j.value === '1'), 'P1: reconciler artifact — justifiedBy cites first-eligible-visual="1"');
  assertTrue(log.conflicts.some((c) => c.source === 'vision' && c.value === '3'), 'P1: reconciler artifact — conflicts[] records vision="3" as the disagreeing prior');
  assertEq(log.authority, 'CONTESTED', 'P1: reconciler artifact — authority is CONTESTED, not silently CONFIRMED');

  assertEq(identity.confirmedIssue, '1', 'P1: confirmedIssue is overturned to "1" — a weakly-supported, non-null Vision value is NOT immune to firstEligibleVisual');
  assertEq(identity.identityProvisionalFromVisualFirst, true, 'P1: flagged provisional — the overturn does not silently reach confirmed identity');
  assertEq(identity.visionZeroSupport?.visionIssue, '3', 'P1: vision\'s overturned value recorded');
}

// ═══════════════════════════════════════════════════════════════════════
// Guards re-verified THROUGH the reconciler — each must show a firing
// [reconcile-issue] decision log (proving reachability), with the
// outcome the guard's own fixture requires.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nGuards re-run through the reconciler (each: log fired + correct outcome)\n');

{
  // Guard: family-consensus precedence (Flash #139) — reconciler runs,
  // picks family-consensus over a disagreeing first-eligible-visual.
  const familyOf = (indices, selectedTitle, rawTitle, decision = 'weighted-consensus') => ({
    selectedTitle, decision,
    topFamily: { indices, rawTitle, count: indices.length, weightSum: indices.length, title: selectedTitle },
  });
  const visualItems = rows([
    'The Flash #170 Anniversary Giant-Size A', 'The Flash #170 Anniversary Giant-Size B',
    'The Flash #170 Anniversary Giant-Size C', 'The Flash #139 D', 'The Flash #139 E',
  ]);
  const vision = { title: 'The Flash', issue: '139', year: null, publisher: 'DC Comics' };
  const ebay = { title: 'The Flash', issue: '170', year: null, publisher: 'DC Comics', agreement: { visionIssueCount: 2, total: 5 } };
  const family = familyOf([0, 1, 2, 3, 4], 'The Flash', visualItems[0].rawTitle);
  const { result: identity, logs } = captureReconcileLogs(() =>
    resolveIdentity(vision, ebay, family, { ebayResultCount: 5, visualItems })
  );
  assertTrue(logs.length >= 1, 'Flash #139: [reconcile-issue] log fired (reachable even though family-corroborated wins)');
  // GrailKey Directive AK — renamed from the single 'family-consensus'
  // tier to 'family-corroborated' specifically (conflict-locked mode: a
  // genuine relationship to an existing prior, not a population vote
  // replacing one — see identityReconciler.js's ISSUE_SOURCE_PRECEDENCE
  // doc comment).
  assertEq(logs[logs.length - 1].source, 'family-corroborated', 'Flash #139: winning source is family-corroborated (precedence, not erasure)');
  assertEq(logs[logs.length - 1].authority, 'CORROBORATED', 'Flash #139: authority is CORROBORATED — family-corroborated matches vision, no demotion needed');
  assertEq(identity.confirmedIssue, '139', 'Flash #139: value byte-identical to the pre-AJ baseline');
  assertEq(identity.identityProvisionalFromVisualFirst, false, 'Flash #139: not demoted — the winning source is family-consensus, not first-eligible-visual');
}

{
  // Guard: contamination (CONTROL C class) — reconciler runs, produces
  // NONE/vision-only because the family is contaminated.
  const vision = { title: 'Zap', issue: '1', year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 0 } };
  const family = { decision: 'fallback-vision', topFamily: { indices: [0, 1, 2], rawTitle: 'Zap #7 NM', count: 3, weightSum: 3 }, runnerUp: null };
  const visualItems = rows(['Zap #7 NM', 'Zap #7 VF', 'Zap #7 CGC 9.8']); // slabbed member contaminates
  const { result: identity, logs } = captureReconcileLogs(() =>
    resolveIdentity(vision, ebay, family, { ebayResultCount: 3, visualItems })
  );
  assertTrue(logs.length >= 1, 'Contaminated family: [reconcile-issue] log fired');
  assertEq(logs[logs.length - 1].source, 'vision', 'Contaminated family: winning source is bare vision — first-eligible-visual evidence suppressed by the contamination guard');
  assertEq(identity.confirmedIssue, '1', 'Contaminated family: confirmedIssue stays Vision\'s own "1", untouched');
  assertEq(identity.identityProvisionalFromVisualFirst, false, 'Contaminated family: not demoted');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
