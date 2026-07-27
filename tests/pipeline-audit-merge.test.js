// tests/pipeline-audit-merge.test.js
//
// A6 dispatch (2026-07-26), Scope 2 Option 1 — client-side propagation of
// pipelineAudit (mergePipelineAudit, src/lib/dataQualityGuard.js). Wired
// into all five App.jsx merge sites (scan→catalogue, scan→selectedItem,
// auto-refresh, bulk-import, Refresh Market Data) alongside
// mergeConfirmedIdentity, per the explicit client-propagation requirement:
// do not assume it copies for free.
//
// Required coverage per dispatch:
// - newest trace replaces old
// - authoritative null identity survives (a genuinely-present trace, even
//   one whose identity fields are honestly null, is not dropped)
// - an older async response cannot overwrite a newer identityRevision
//
// Invoke: node tests/pipeline-audit-merge.test.js

import { mergePipelineAudit } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== pipelineAudit merge — mergePipelineAudit ===\n');

const oldTrace = { v: 1, traceId: 'old', identityRevision: 1000, terminalInvariant: { preResponse: { outIssue: '5' } } };
const newTrace = { v: 1, traceId: 'new', identityRevision: 2000, terminalInvariant: { preResponse: { outIssue: '1' } } };

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — newest trace replaces old
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: newest trace replaces old\n');

{
  const result = mergePipelineAudit({ pipelineAudit: newTrace }, { pipelineAudit: oldTrace });
  assertEq(result.traceId, 'new', 'newer identityRevision replaces the stored trace');
  assertEq(result.identityRevision, 2000, 'identityRevision updates to the newer value');
}

{
  // First scan ever — nothing stored yet.
  const result = mergePipelineAudit({ pipelineAudit: newTrace }, {});
  assertEq(result.traceId, 'new', 'a trace on a record with no prior trace is adopted');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — an older async response cannot overwrite a newer
//      identityRevision (the out-of-order-arrival race this exists for:
//      a slow auto-refresh response lands after a faster manual re-scan
//      already updated the record)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: older async response cannot overwrite a newer identityRevision\n');

{
  // Stored record already has the NEWER trace (identityRevision 2000);
  // a stale, slow response carrying the OLDER trace (1000) arrives late.
  const result = mergePipelineAudit({ pipelineAudit: oldTrace }, { pipelineAudit: newTrace });
  assertEq(result.traceId, 'new', 'stale slow response does not overwrite the already-newer stored trace');
  assertEq(result.identityRevision, 2000, 'stored identityRevision stays at the newer value');
}

{
  // Equal revision — incoming wins (same request re-merged, e.g. a
  // duplicate dispatch of the same response through two consumers).
  const sameRevisionIncoming = { ...newTrace, traceId: 'new-2' };
  const result = mergePipelineAudit({ pipelineAudit: sameRevisionIncoming }, { pipelineAudit: newTrace });
  assertEq(result.traceId, 'new-2', 'equal identityRevision: incoming wins (not a stale-rejection case)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — authoritative null identity survives: a genuinely-present
//      trace whose identity fields are honestly null (Wonder Woman class:
//      confirmedIssue=null, ok=true) is still real evidence and must not
//      be dropped or treated as "nothing to merge."
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: authoritative null-identity trace survives the merge\n');

{
  const honestNullTrace = {
    v: 1, traceId: 'ww-null', identityRevision: 5000,
    familyIssueAuthority: { mode: 'no-consensus', winner: null, support: 0, ratio: 0, uniqueRows: 10, familyKey: 'Wonder Woman' },
    terminalInvariant: {
      prePricing: { pricingIssue: null, confirmedIssue: null, ok: true },
      preResponse: { outIssue: null, confirmedIssue: null, ok: true },
    },
    decision: { action: 'ID_REQUIRED', confidence: 'high', blockerCodes: [], warningCodes: [] },
  };
  const result = mergePipelineAudit({ pipelineAudit: honestNullTrace }, {});
  assertEq(result.traceId, 'ww-null', 'a trace with an honestly-null identity is adopted, not discarded for "looking empty"');
  assertEq(result.terminalInvariant.preResponse.outIssue, null, 'the null outIssue inside the trace survives intact');
  assertEq(result.terminalInvariant.preResponse.ok, true, 'the honest OK verdict survives intact');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — absent/falsy incoming pipelineAudit preserves whatever was
//      already stored (defensive default — never actively regress
//      evidence to nothing because a caller sent a malformed response)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: absent or falsy incoming value preserves the stored trace\n');

{
  // Key genuinely absent from the response object.
  const result = mergePipelineAudit({}, { pipelineAudit: oldTrace });
  assertEq(result.traceId, 'old', 'key absent entirely: stored trace preserved, not cleared');
}

{
  // Key present but explicitly null/undefined.
  const result = mergePipelineAudit({ pipelineAudit: null }, { pipelineAudit: oldTrace });
  assertEq(result.traceId, 'old', 'key present but falsy: stored trace preserved, not cleared');
}

{
  // No prior trace and no incoming trace — genuinely nothing to merge.
  const result = mergePipelineAudit({}, {});
  assertEq(result, null, 'no prior and no incoming: result is null, not fabricated');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — site parity: all five merge-site call shapes (cur/s/item as
//      the second argument) behave identically for the same inputs.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: site parity across all five call shapes (cur / s / item)\n');

{
  const priors = [
    ['auto-refresh (cur)', { pipelineAudit: oldTrace }],
    ['bulk-import (cur)', { pipelineAudit: oldTrace }],
    ['scan→catalogue (cur)', { pipelineAudit: oldTrace }],
    ['scan→selectedItem (s)', { pipelineAudit: oldTrace }],
    ['Refresh Market Data (item)', { pipelineAudit: oldTrace }],
  ];
  for (const [name, prior] of priors) {
    const result = mergePipelineAudit({ pipelineAudit: newTrace }, prior);
    assertEq(result.traceId, 'new', `${name}: newest trace replaces old identically`);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
