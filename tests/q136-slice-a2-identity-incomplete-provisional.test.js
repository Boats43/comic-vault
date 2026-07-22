// tests/q136-slice-a2-identity-incomplete-provisional.test.js
//
// Slice A2 (2026-07-22, Rachta Lin regression) — Q133 Slice 2's promotion
// exempted the 'identity-not-confident' blocker for a pool-provisional card
// (isPoolProvisionalIdentity, decisionEngine.js), but every existing test
// fixture for that slice hardcoded `identityComplete: true` on its item —
// papering over the real computation. In production, api/enrich.js derives
// out.identityComplete = !!out.issue for comics (line ~8119) with NO
// awareness of identityProvisional. A con-exclusive whose issue/year
// genuinely cannot be read off the pool (Rachta Lin / Pop Kill #1 class)
// gets identityComplete=false, which trips the SEPARATE 'identity-incomplete'
// blocker (decisionEngine.js) — completely unguarded by the Slice 2
// exemption — and the promoted card falls straight back to ID_REQUIRED,
// undoing the entire point of promotion.
//
// Fix: hoist isPoolProvisionalIdentity above the identity-incomplete check
// and exempt it there too, but gated STRICTLY narrower than the
// identity-not-confident exemption — only when Phase 2 found real comps
// (rawComps.count > 0 || soldComps.length > 0), not the 0-comp
// fallback-median case. Genuinely-unidentified books (no identityProvisional
// at all — Poison Ivy #1 class) must keep today's ID_REQUIRED byte-identical.
//
// Invoke: node tests/q136-slice-a2-identity-incomplete-provisional.test.js

import { computeDecision } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Slice A2 — identity-incomplete exemption for pool-provisional + real comps ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Rachta Lin (Pop Kill #1 Megacon con-exclusive) — real production shape.
// issue/year genuinely absent (the pool can't supply them), identityComplete
// derived honestly as false (NOT hardcoded true like the Q133 fixtures),
// but real Phase 2 comps exist underneath.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals !!',
    issue: null,
    year: null,
    identityProvisional: true,
    identityConfident: false,
    identityComplete: false, // honest derivation: !!out.issue === false
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    listingHardLockBanner: 'Identity unconfirmed (visual pool disagrees with the AI read) — priced from 12 live comps — verify before listing',
    price: 45.5,
    rawComps: { average: 47, lowest: 30, highest: 65, count: 12 },
    soldComps: [],
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-incomplete'), 'Rachta Lin: identity-incomplete blocker does NOT fire (real comps underneath)');
  assertFalse(decision.blockers.includes('identity-not-confident'), 'Rachta Lin: identity-not-confident blocker still does NOT fire (Slice 2, unaffected)');
  assertTrue(decision.warnings.includes('identity-conflict-unresolved'), 'Rachta Lin: identity-conflict-unresolved warning DOES fire');
  assertEq(decision.action, 'RESEARCH', 'Rachta Lin: action is RESEARCH — price visible, not the ID_REQUIRED regression');
}

// ═══════════════════════════════════════════════════════════════════════
// Same book, but Phase 2 found ZERO real comps (fell back to visual-pool
// median) — deliberately gated OUT of this exemption per the explicit
// ruling ("AND Phase 2 found real comps"). Narrower than the
// identity-not-confident exemption on purpose.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals !!',
    issue: null,
    year: null,
    identityProvisional: true,
    identityConfident: false,
    identityComplete: false,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    price: 33,
    pricingSource: 'visual_pool_family_isolated',
    rawComps: { average: null, lowest: null, highest: null, count: 0 },
    soldComps: [],
  };
  const decision = computeDecision(item);
  assertTrue(decision.blockers.includes('identity-incomplete'), 'Rachta Lin (0 real comps): identity-incomplete blocker fires — exemption is strictly narrower, real-comps required');
  assertEq(decision.action, 'ID_REQUIRED', 'Rachta Lin (0 real comps): action is ID_REQUIRED — matches the explicit "AND Phase 2 found real comps" gating');
}

// ═══════════════════════════════════════════════════════════════════════
// Control: genuinely-unidentified book, NOT pool-provisional at all
// (Poison Ivy #1 class) — must keep today's ID_REQUIRED byte-identical.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'Poison Ivy',
    issue: null,
    year: null,
    identityProvisional: false,
    identityConfident: false,
    identityComplete: false,
    price: null,
    rawComps: { average: null, lowest: null, highest: null, count: 0 },
  };
  const decision = computeDecision(item);
  assertTrue(decision.blockers.includes('identity-incomplete'), 'Poison Ivy #1 (genuinely unidentified): identity-incomplete blocker still fires — byte-identical to today');
  assertEq(decision.action, 'ID_REQUIRED', 'Poison Ivy #1 (genuinely unidentified): action stays ID_REQUIRED — no book to price against');
}

// ═══════════════════════════════════════════════════════════════════════
// Control: Lozano (identityComplete honestly TRUE — issue present) —
// confirms this fix doesn't change behavior for the already-verified case
// where identityComplete never went false to begin with.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon (Naughty) LTD 100',
    issue: '1',
    identityProvisional: true,
    identityConfident: false,
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    price: 149.88,
    rawComps: { average: 140, lowest: 80.72, highest: 191.04, count: 17 },
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-incomplete'), 'Lozano: identity-incomplete blocker does not fire (identityComplete was already true)');
  assertEq(decision.action, 'RESEARCH', 'Lozano: action stays RESEARCH — unaffected control');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
