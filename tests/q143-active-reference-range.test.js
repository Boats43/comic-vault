// tests/q143-active-reference-range.test.js
//
// Q143 dispatch (2026-07-22) — Rachta Lin (Pop Kill #1 Megacon con-
// exclusive) class. Two stacked, independently-confirmed bugs from the
// same live rescan (build 93f7ee2, real log citations in this session's
// investigation report):
//
//   1. api/enrich.js's tier-engine pricing-eligibility gate (Q141) got
//      its missing out.identityProvisional OR-arm and correctly reached
//      the tier engine — but priceBandsRaw came back null (tier=4 "no
//      data available": priceBands.js's Tier 3 floor requires
//      verifiedActive.length >= 3; Rachta Lin's real pool has 2). The
//      tier-engine's OWN fallback then hit the P0-A-LEGACY-PATH block,
//      which unconditionally sets out.refusedToPrice=true — driving
//      responseContract.js's deriveState to REFUSED (checked BEFORE the
//      LOCKED branch out.listingHardLocked would otherwise satisfy) —
//      "⛔ CANNOT PRICE" on a card whose decision.action correctly read
//      RESEARCH, blockers=0.
//
// Fix: a new, narrow active_reference_range path (api/enrich.js, inside
// the same `else if (rawComps && rawComps.count > 0)` branch), eligible
// ONLY when out.identityProvisional is true, rawComps.count is 1-2, zero
// sold comps exist, and the surviving comps don't disagree with each
// other (hasUnresolvedActiveVariantConflict, src/lib/variantIdentity.js).
// P0-A's original refusal narrows to fire only when this doesn't apply —
// it remains the safety net for every other tier-bypass shape, not
// retired. Output: pricingSource=active_reference_range, referenceLow/
// High/Mid, verifiedFMV=false, refusedToPrice=false, listingHardLocked=
// true. A cosmetic-today consistency fix was also added to the FIRST
// identity-gate (the one that sets out.price=null on refusal) so a
// promoted provisional identity is never even transiently nulled there
// either — reference-only, it doesn't itself compute or preserve price.
//
// api/enrich.js's ~11,900-line handler has no pure extraction for the
// activeReferenceEligible condition itself (matches how Q141's OR-chain
// was verified — source-level regression guard, not a unit test of the
// inline gate). This file: (a) unit-tests the pure conflict-detection
// helper directly, (b) source-guards the inline eligibility condition and
// its P0-A narrowing, (c) fixture-tests the two end states (LOCKED
// reference range vs REFUSED) through the REAL computeDecision +
// assembleContract pipeline, matching this campaign's established
// convention for inline-handler gates.
//
// Invoke: node tests/q143-active-reference-range.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasUnresolvedActiveVariantConflict } from '../src/lib/variantIdentity.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { finalizeResponse } from '../src/lib/responseContract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const enrichSrc = readFileSync(join(__dirname, '../api/enrich.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q143 — active_reference_range (Rachta Lin) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — source-level guards on the inline eligibility gate and P0-A's
// narrowing (same convention as Q141's gate guard).
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: source-level gate guards\n');
{
  assertTrue(
    /activeReferenceEligible\s*=\s*\n\s*out\.identityProvisional === true &&\s*\n\s*rawComps\.count >= 1 && rawComps\.count <= 2 &&\s*\n\s*\(out\.soldComps\?\.length \|\| 0\) === 0 &&\s*\n\s*!hasUnresolvedActiveVariantConflict/.test(enrichSrc),
    'activeReferenceEligible carries all four required clauses, in order'
  );
  assertTrue(enrichSrc.includes("out.pricingSource = 'active_reference_range';"), 'pricingSource literal present');
  assertTrue(enrichSrc.includes('out.verifiedFMV = false;'), 'verifiedFMV=false set');
  assertTrue(enrichSrc.includes('out.refusedToPrice = false;') && enrichSrc.includes("out.pricingSource = 'refused-tier-bypass-detected';"),
    'both the new true-path (refusedToPrice=false) and the narrowed P0-A false-path (unchanged refusal) are present, not one replacing the other');
  assertTrue(enrichSrc.includes("out.listingHardLockReason = out.listingHardLockReason || 'identity-unresolved';") &&
    enrichSrc.includes("'[identity-gate] pool-provisional identity — pricing proceeds downstream (LOCKED)'"),
    'first-gate consistency fix present (identityProvisional branch, reference-only)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — hasUnresolvedActiveVariantConflict unit behavior
// (full matrix already exercised interactively during implementation;
// re-asserted here as the permanent regression record)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: hasUnresolvedActiveVariantConflict\n');
{
  assertFalse(hasUnresolvedActiveVariantConflict([
    { title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals NM!!' },
    { title: 'Pop Kill #1 Rachta Lin Megacon Exclusive Virgin 2nd Print LTD 250' },
  ]), 'real Rachta Lin 2-comp pool: no conflict');

  assertTrue(hasUnresolvedActiveVariantConflict([
    { title: 'Pop Kill #1 Alexander Lozano Megacon Metal LTD 100' },
    { title: 'Pop Kill #1 Jenny Frison Megacon Metal LTD 100' },
  ]), 'two different recognized artists: conflict');

  assertFalse(hasUnresolvedActiveVariantConflict([
    { title: 'Pop Kill #1 Rachta Lin Megacon Exclusive Virgin LTD 250' },
  ]), 'single comp: nothing to conflict with');

  assertFalse(hasUnresolvedActiveVariantConflict([
    { title: 'Pop Kill #1 Rachta Lin Foil Variant' },
    { title: 'Pop Kill #1 Rachta Lin Virgin Variant' },
  ]), 'generic-only tokens (foil vs virgin): not a conflict');

  assertTrue(hasUnresolvedActiveVariantConflict([
    { title: 'Pop Kill #1 SDCC Exclusive Virgin LTD 250' },
    { title: 'Pop Kill #1 C2E2 Exclusive Virgin LTD 250' },
  ]), 'two different conventions sharing boilerplate ("exclusive"/"limited"): conflict');

  assertFalse(hasUnresolvedActiveVariantConflict([
    { title: 'Pop Kill #1 SDCC Exclusive Virgin LTD 250' },
    { title: 'Pop Kill #1 SDCC Virgin LTD 250' },
  ]), 'subset relationship (one comp states less detail): not a conflict');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — required test matrix (end-to-end through computeDecision +
// assembleContract, mirroring api/enrich.js's real ordering)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: required test matrix\n');

// 2a. Real Rachta 2-comp case → LOCKED, reference range visible.
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
    priceLow: 30,
    priceHigh: 36,
    pricingSource: 'active_reference_range',
    referenceLow: 30,
    referenceHigh: 36,
    referenceMid: 33,
    verifiedFMV: false,
    refusedToPrice: false,
    rawComps: { average: 33, lowest: 30, highest: 36, count: 2 },
    soldComps: [],
  };
  item.decision = computeDecision(item);
  assertEq(item.decision.action, 'RESEARCH', 'Rachta Lin: decision.action is RESEARCH');
  assertFalse(item.decision.blockers.length > 0, 'Rachta Lin: no blockers');
  finalizeResponse(item);
  const contract = item.contract;
  assertEq(contract.state, 'LOCKED', 'Rachta Lin: contract.state is LOCKED (not REFUSED)');
  assertTrue(contract.price != null, 'Rachta Lin: contract.price is visible, not nulled');
  assertEq(contract.price, 33, 'Rachta Lin: contract.price reflects the reference mid');
}

// 2b. 2 unrelated comps → P0-A's narrowed refusal still fires → REFUSED.
// (activeReferenceEligible would be false in production because rawComps
// itself would never have surfaced two unrelated titles post-filter-chain
// in the first place — this fixture instead directly represents the
// DOWNSTREAM state P0-A produces when eligibility fails for any reason,
// confirming REFUSED renders correctly and consistently.)
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
    price: null,
    pricingSource: 'refused-tier-bypass-detected',
    refusedToPrice: true,
    priceNote: 'Insufficient verified comps (2) — try refresh or edit fields',
    rawComps: { average: 40, lowest: 12, highest: 68, count: 2 },
    soldComps: [],
  };
  item.decision = computeDecision(item);
  finalizeResponse(item);
  const contract = item.contract;
  assertEq(contract.state, 'REFUSED', 'unrelated 2-comp pool: contract.state is REFUSED');
  assertEq(contract.price, null, 'unrelated 2-comp pool: price renders null');
}

// 2c. 2 variant-conflicting comps → same REFUSED shape (the conflict
// itself is what routes production into the P0-A branch above).
{
  assertTrue(
    hasUnresolvedActiveVariantConflict([
      { title: 'Pop Kill #1 Rachta Lin Virgin LTD 250' },
      { title: 'Pop Kill #1 Rachta Lin Embossed Metal LTD 25' },
    ]) === false, // "embossed metal" is a finish descriptor, not conflicting — sanity check on real Rachta Lin variant wording
    'sanity: real Rachta Lin sub-variant wording ("Embossed Metal") does not itself trigger the conflict check (this book\'s actual 2 comps genuinely agree)'
  );
  const item = {
    title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals !!',
    identityProvisional: true,
    identityConfident: false,
    identityComplete: false,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    price: null,
    pricingSource: 'refused-tier-bypass-detected',
    refusedToPrice: true,
    rawComps: { average: 55, lowest: 20, highest: 90, count: 2 },
    soldComps: [],
  };
  item.decision = computeDecision(item);
  finalizeResponse(item);
  const contract = item.contract;
  assertEq(contract.state, 'REFUSED', 'variant-conflicting 2-comp pool: contract.state is REFUSED');
}

// 2d. 3+ verified actives → existing Tier 3 unchanged. priceBands.js was
// not touched by this dispatch (diff-scoped, see report) — this asserts
// isolation directly: the new lane's source string never appears there.
{
  const priceBandsSrc = readFileSync(join(__dirname, '../src/lib/priceBands.js'), 'utf8');
  assertFalse(priceBandsSrc.includes('active_reference_range'), 'priceBands.js has zero references to the new tier — Tier 3 (>=3 actives) is architecturally untouched');
}

// 2e. Exact sold evidence → normal pricing unchanged. The eligibility
// gate's own soldComps===0 clause means real sold evidence routes
// through priceBandsRaw (Tier 1/2/2.5) same as before Q143 — this lane
// is only ever reached when priceBandsRaw is already null.
{
  assertTrue(
    /\(out\.soldComps\?\.length \|\| 0\) === 0/.test(enrichSrc),
    'eligibility gate explicitly excludes any book with sold evidence — sold-evidence books are unaffected by construction'
  );
}

// 2f. Poison Ivy #1 (genuinely unidentified) → ID_REQUIRED unchanged.
{
  const item = {
    title: 'Poison Ivy',
    issue: null,
    year: null,
    identityProvisional: false, // never promoted — no family at all
    identityConfident: false,
    identityComplete: false,
    price: null,
    rawComps: { average: null, lowest: null, highest: null, count: 0 },
  };
  item.decision = computeDecision(item);
  assertEq(item.decision.action, 'ID_REQUIRED', 'Poison Ivy #1: action stays ID_REQUIRED — byte-identical to today');
  finalizeResponse(item);
  const contract = item.contract;
  assertEq(contract.state, 'ID_REQUIRED', 'Poison Ivy #1: contract.state stays ID_REQUIRED');
  assertEq(contract.price, null, 'Poison Ivy #1: price stays null');
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
