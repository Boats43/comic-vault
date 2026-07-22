// tests/q137-slice-a3-vision-low-confidence-corroborated.test.js
//
// Slice A3 (2026-07-22, One World Under Doom / Giang MegaCon Secret Drop
// class) — a THIRD, structurally distinct trigger for identityConfident
// ===false, separate from Q133 Slice 1c's publisher-only gap and Slice 2's
// pool-provisional promotion (Slice A2). Here title/issue/year/publisher are
// ALL already resolved (identityMissingFields empty, PC+CV+pool agree, HIGH
// convergence, an 11-member coherent family) — Vision's own self-reported
// low confidence is the SOLE reason assessIdentityConfidence returned
// confident=false. Neither isPublisherOnlyGap (requires exactly one missing
// field) nor isPoolProvisionalIdentity (requires out.identityProvisional,
// only set by the identityRefused promotion path — this book was never
// refused, it resolved cleanly) covers this shape, so the card fell through
// to the hard identity-not-confident blocker and ID_REQUIRED, nulling a
// price that was fully computed underneath.
//
// The pre-existing Q83 "Vision low-confidence is a VOTE, not a VETO" rescue
// (api/enrich.js) does NOT cover this either — it re-derives identity from
// raw pool text and requires >=1 fresh (<=90d) sold comp, which a
// freshly-dropped con-exclusive variant plausibly has zero of yet.
//
// Fix: api/enrich.js sets out.identityVisionLowButCorroborated when
// idCheckFinal.missingFields is empty AND convergence.tier !== 'LOW' AND a
// >=3-member coherent pool family AND a real active/sold comp pool all hold
// simultaneously. decisionEngine.js exempts the identity-not-confident
// blocker on this flag (mirroring isPublisherOnlyGap/isPoolProvisionalIdentity)
// and pushes a new 'vision-confidence-overridden' warning that escalates to
// RESEARCH via criticalWarnings — never a silent LIST_NOW.
//
// Invoke: node tests/q137-slice-a3-vision-low-confidence-corroborated.test.js

import { computeDecision, describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Slice A3 — Vision low-confidence overridden by pipeline corroboration ===\n');

// ═══════════════════════════════════════════════════════════════════════
// One World Under Doom / Giang MegaCon Secret Drop — real production shape.
// All identity fields resolved, HIGH convergence, 11-member family, real
// comp pool — but Vision itself reported low confidence.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'One World Under Doom',
    issue: '1',
    year: '2025',
    publisher: 'Marvel',
    identityConfident: false, // idCheckFinal.confident false — visionConfidence==='low' only
    identityMissingFields: [],
    identityComplete: true,
    identityVisionLowButCorroborated: true,
    listingHardLocked: true,
    listingHardLockReason: 'vision-low-confidence-corroborated',
    listingHardLockBanner: 'Vision wasn\'t confident reading this cover, but PriceCharting/ComicVine and a 11-listing comp pool independently agree — verify before listing',
    identityConsensus: {
      visionConfidence: 'low',
      convergenceTier: 'HIGH',
      convergenceScore: 92,
      familyCount: 11,
      activePoolCount: 11,
      soldPoolCount: 0,
      visionVetoOverridden: true,
    },
    price: 68.5,
    rawComps: { average: 70, lowest: 55, highest: 90, count: 11 },
    soldComps: [],
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'One World Under Doom: identity-not-confident blocker does NOT fire');
  assertTrue(decision.warnings.includes('vision-confidence-overridden'), 'One World Under Doom: vision-confidence-overridden warning DOES fire');
  assertEq(decision.action, 'RESEARCH', 'One World Under Doom: action is RESEARCH — price visible, not the ID_REQUIRED wall');
  const msg = describeWarning('vision-confidence-overridden', item);
  assertTrue(/high/i.test(msg) && /11-listing/i.test(msg), `describeWarning names the real convergence tier and family count: "${msg}"`);
}

// ═══════════════════════════════════════════════════════════════════════
// Isolation control: Vision low confidence AND a thin/scattered pool
// (family < 3) — api/enrich.js would never set the flag in this case, so
// this must fall through unchanged to today's ID_REQUIRED.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'Some Obscure Indie #1',
    issue: '1',
    identityConfident: false,
    identityMissingFields: [],
    identityComplete: true,
    // identityVisionLowButCorroborated deliberately absent — enrich.js
    // never set it (family count was below the floor / convergence LOW).
    price: null,
    rawComps: { average: null, lowest: null, highest: null, count: 1 },
  };
  const decision = computeDecision(item);
  assertTrue(decision.blockers.includes('identity-not-confident'), 'thin-pool control: identity-not-confident blocker still fires — byte-identical to today');
  assertEq(decision.action, 'ID_REQUIRED', 'thin-pool control: action stays ID_REQUIRED — no corroboration to promote on');
}

// ═══════════════════════════════════════════════════════════════════════
// Control: normal confident identity, completely untouched.
// ═══════════════════════════════════════════════════════════════════════
{
  const item = {
    title: 'Catwoman',
    issue: '64',
    identityConfident: true,
    identityComplete: true,
    price: 15,
    rawComps: { average: 15, lowest: 12, highest: 18, count: 6 },
  };
  const decision = computeDecision(item);
  assertFalse(decision.blockers.includes('identity-not-confident'), 'Catwoman #64 control: no identity blocker');
  assertFalse(decision.warnings.includes('vision-confidence-overridden'), 'Catwoman #64 control: no vision-confidence-overridden warning (normal confident identity)');
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
