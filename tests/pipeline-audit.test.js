// tests/pipeline-audit.test.js
//
// A6 dispatch (2026-07-26), Scope 2 Option 1 — response-embedded
// pipelineAudit. Server-side unit tests for buildPipelineAudit
// (src/lib/pipelineAudit.js), the pure assembler wired into api/enrich.js
// at all three successful-response exit points (main terminal path,
// identityRefused early return, Q32 merchandise hard block).
//
// Required coverage per dispatch:
// - trace exists on LIST and on ID_REQUIRED
// - boundary snapshots exactly equal the q140-terminal variables passed in
// - preResponse.outIssue === final out.issue
// - no-consensus responses do not manufacture family authority
//
// Invoke: node tests/pipeline-audit.test.js

import { buildPipelineAudit } from '../src/lib/pipelineAudit.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== pipelineAudit — buildPipelineAudit ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — present on a LIST_NOW-shaped response (main terminal path,
//      real family consensus, real decision)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: LIST_NOW response — full family authority + decision\n');

{
  const audit = buildPipelineAudit({
    traceId: 'test-trace-1',
    buildSha: '9f0c86a',
    identityRevision: 1000,
    familyIssueConsensus: { mode: 'corroborated', winner: '44', support: 12, ratio: 1.0, uniqueRows: 12, runnerUp: null },
    familyKey: 'immortal hulk cho michael',
    pricingIssue: '44',
    confirmedIssue: '44',
    outIssue: '44',
    prePricingOk: true,
    preResponseOk: true,
    decision: { action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: ['thin-pool-anchor'] },
  });

  assertEq(audit.v, 1, 'v: schema version present');
  assertEq(audit.traceId, 'test-trace-1', 'traceId: passed through verbatim');
  assertEq(audit.buildSha, '9f0c86a', 'buildSha: passed through verbatim');
  assertEq(typeof audit.generatedAt, 'string', 'generatedAt: present as a string timestamp');
  assertEq(audit.identityRevision, 1000, 'identityRevision: passed through verbatim');
  assertEq(audit.familyIssueAuthority.mode, 'corroborated', 'familyIssueAuthority.mode: real consensus mode preserved');
  assertEq(audit.familyIssueAuthority.winner, '44', 'familyIssueAuthority.winner: preserved');
  assertEq(audit.familyIssueAuthority.support, 12, 'familyIssueAuthority.support: preserved');
  assertEq(audit.familyIssueAuthority.ratio, 1, 'familyIssueAuthority.ratio: preserved (rounded)');
  assertEq(audit.familyIssueAuthority.uniqueRows, 12, 'familyIssueAuthority.uniqueRows: preserved');
  assertEq(audit.familyIssueAuthority.familyKey, 'immortal hulk cho michael', 'familyIssueAuthority.familyKey: preserved');
  assertEq(audit.terminalInvariant.prePricing.pricingIssue, '44', 'terminalInvariant.prePricing.pricingIssue: exact snapshot');
  assertEq(audit.terminalInvariant.prePricing.confirmedIssue, '44', 'terminalInvariant.prePricing.confirmedIssue: exact snapshot');
  assertEq(audit.terminalInvariant.prePricing.ok, true, 'terminalInvariant.prePricing.ok: exact snapshot (caller-supplied, not recomputed)');
  assertEq(audit.terminalInvariant.preResponse.outIssue, '44', 'terminalInvariant.preResponse.outIssue: exact snapshot');
  assertEq(audit.terminalInvariant.preResponse.ok, true, 'terminalInvariant.preResponse.ok: exact snapshot');
  assertEq(audit.decision.action, 'LIST_LOW', 'decision.action: preserved');
  assertEq(audit.decision.confidence, 'medium', 'decision.confidence: preserved');
  assertEq(JSON.stringify(audit.decision.blockerCodes), JSON.stringify([]), 'decision.blockerCodes: empty array preserved');
  assertEq(JSON.stringify(audit.decision.warningCodes), JSON.stringify(['THIN_POOL_ANCHOR']), 'decision.warningCodes: normalized to UPPER_SNAKE_CASE');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — present on an ID_REQUIRED-shaped response (Wonder Woman class:
//      vision-zero-support escalate, no adoptable issue)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: ID_REQUIRED response — trace still exists, honest null terminal values\n');

{
  const audit = buildPipelineAudit({
    traceId: 'test-trace-2',
    buildSha: '9f0c86a',
    identityRevision: 2000,
    familyIssueConsensus: { mode: 'no-consensus', winner: null, support: 0, ratio: 0, uniqueRows: 10, runnerUp: null },
    familyKey: 'Wonder Woman',
    pricingIssue: null,
    confirmedIssue: null,
    outIssue: null,
    prePricingOk: true,
    preResponseOk: true,
    decision: { action: 'ID_REQUIRED', confidence: 'high', blockers: ['identity-not-confident', 'issue-number-missing'], warnings: [] },
  });

  assertEq(audit.v, 1, 'v: present even on a refused/ID_REQUIRED response — pipelineAudit is not LIST-only');
  assertEq(audit.terminalInvariant.prePricing.pricingIssue, null, 'prePricing.pricingIssue: honest null, not fabricated');
  assertEq(audit.terminalInvariant.preResponse.outIssue, null, 'preResponse.outIssue: honest null, not fabricated');
  assertEq(audit.terminalInvariant.prePricing.ok, true, 'prePricing.ok: null === null is a genuine OK, not a violation');
  assertEq(audit.decision.action, 'ID_REQUIRED', 'decision.action: ID_REQUIRED preserved');
  assertEq(JSON.stringify(audit.decision.blockerCodes), JSON.stringify(['IDENTITY_NOT_CONFIDENT', 'ISSUE_NUMBER_MISSING']), 'decision.blockerCodes: normalized');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — no-consensus / no-family-run responses do not manufacture
//      family authority (identityRefused early-return class — the whole
//      resolveFamilyIssueConsensus mechanism never ran at all)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: no family consensus ever ran — familyIssueAuthority is honestly "none", not fabricated\n');

{
  const audit = buildPipelineAudit({
    traceId: 'test-trace-3',
    buildSha: '9f0c86a',
    identityRevision: 3000,
    familyIssueConsensus: null, // genuinely never computed — identityRefused, below promotion floor
    familyKey: null,
    pricingIssue: null,
    confirmedIssue: null,
    outIssue: null,
    prePricingOk: true,
    preResponseOk: true,
    decision: null, // this exact exit path never calls computeDecision
  });

  assertEq(audit.familyIssueAuthority.mode, 'none', 'familyIssueAuthority.mode: "none", not a fabricated consensus mode');
  assertEq(audit.familyIssueAuthority.winner, null, 'familyIssueAuthority.winner: null, not fabricated');
  assertEq(audit.familyIssueAuthority.support, null, 'familyIssueAuthority.support: null, not fabricated (never 0-as-a-lie)');
  assertEq(audit.familyIssueAuthority.ratio, null, 'familyIssueAuthority.ratio: null, not fabricated');
  assertEq(audit.familyIssueAuthority.uniqueRows, null, 'familyIssueAuthority.uniqueRows: null, not fabricated');
  assertEq(audit.familyIssueAuthority.familyKey, null, 'familyIssueAuthority.familyKey: null when no family authority exists at all');
  assertEq(audit.decision.action, null, 'decision.action: honestly null — this exit path never computes a decision object');
  assertEq(JSON.stringify(audit.decision.blockerCodes), JSON.stringify([]), 'decision.blockerCodes: empty, not fabricated');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — preResponse.outIssue is an exact string projection of whatever
//      out.issue value the caller passed, never independently derived
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: preResponse.outIssue is a faithful projection, never independently derived\n');

{
  const numericAudit = buildPipelineAudit({
    traceId: 't', buildSha: null, identityRevision: 1,
    familyIssueConsensus: null, familyKey: null,
    pricingIssue: 128, confirmedIssue: 128, outIssue: 128,
    prePricingOk: true, preResponseOk: true, decision: null,
  });
  assertEq(numericAudit.terminalInvariant.preResponse.outIssue, '128', 'numeric out.issue stringified consistently');
  assertEq(numericAudit.terminalInvariant.prePricing.pricingIssue, '128', 'numeric pricingIssue stringified consistently');

  const violationAudit = buildPipelineAudit({
    traceId: 't', buildSha: null, identityRevision: 1,
    familyIssueConsensus: null, familyKey: null,
    pricingIssue: '5', confirmedIssue: '1', outIssue: '5',
    prePricingOk: false, preResponseOk: false, decision: null,
  });
  assertEq(violationAudit.terminalInvariant.prePricing.ok, false, 'a real violation is reported as false, not silently OK');
  assertEq(violationAudit.terminalInvariant.preResponse.outIssue, '5', 'outIssue reflects the actual (violating) value, not confirmedIssue');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
