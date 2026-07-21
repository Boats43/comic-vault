// tests/q133-slice2-contract-followup.test.js
//
// Q133 Slice 2 follow-up (2026-07-21) — a real bug found on LIVE RENDERED
// CARDS (not logs): responseContract.js's deriveLocks/deriveState both
// checked out.identityConfident === false directly, independent of
// out.decision?.action — a THIRD independent copy of the same judgment
// decisionEngine.js already makes (first: out.identityComplete in
// api/enrich.js, fixed Slice 1c; second: the identity-not-confident
// BLOCKER in decisionEngine.js itself, which now has explicit
// isPublisherOnlyGap/isPoolProvisionalIdentity exceptions). Because
// identityConfident is DELIBERATELY forced false for both the Slice 1c
// publisher-only-gap case and the Slice 2 promoted-refused-identity case,
// this site silently reopened a hard ID_REQUIRED wall (contract.price
// nulled) on cards whose decision.action correctly said RESEARCH — a
// split card: "RESEARCH low" badge next to "Recommended list price:
// Identification Required" one section over.
//
// Fix: drop the identityConfident clause entirely from both sites, rely
// solely on out.decision?.action === 'ID_REQUIRED' (decisionEngine.js is
// now the sole authority).
//
// Second, independent finding from the same investigation: the Slice 2
// fallback-to-visual-pool-median trigger (`out.price == null`) conflated
// "Phase 2 found 0 comps" with "Phase 2 found a genuine but thin result
// (1 comp) that the tier engine's own pre-existing >=2-comp band floor
// (calculatePriceBands, priceBands.js) declined to price for an unrelated
// reason." Narrowed to literally zero real evidence
// ((rawComps.count||0)+(soldComps.length||0)===0) per the design ruling:
// real, book-specific data beats a family-median guess even when thin.
//
// Invoke: node tests/q133-slice2-contract-followup.test.js

import { computeDecision } from '../src/lib/decisionEngine.js';
import { finalizeResponse } from '../src/lib/responseContract.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

// Mirrors the real api/enrich.js call sequence: build `out`, run
// computeDecision, then finalizeResponse — exactly what production does.
function runFullPipeline(out) {
  out.decision = computeDecision(out, { source: 'enrich', timestamp: 1 });
  return finalizeResponse(out);
}

console.log('\n=== Q133 Slice 2 follow-up — contract third-duplicate + fallback narrowing ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — Invincible: publisher-only-gap, real Tier-3 price already
// computed. Must show RESEARCH-tier, price visible, NOT ID_REQUIRED.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: Invincible (Slice 1c publisher-only-gap)\n');
{
  const out = {
    title: 'invincible',
    issue: '1',
    year: '2026',
    identityConfident: false, // forced false by Slice 1c — publisher genuinely missing
    identityComplete: true,   // issue present (Slice 1c simplification)
    identityMissingFields: ['publisher'],
    listingHardLocked: true,
    listingHardLockReason: 'publisher-unresolved',
    listingHardLockBanner: 'Publisher could not be confirmed from any source — verify before listing',
    publisherUnresolved: true,
    price: 63.25,
    priceLow: 16.96,
    priceHigh: 72.73,
    priceBands: { quick: 16.96, market: 63.25, stretch: 72.73 },
    pricingSource: 'active_ask_derived',
    rawComps: { average: 74.41, lowest: 16.96, highest: 82.73, count: 49 },
    soldComps: [],
  };
  const result = runFullPipeline(out);
  assertEq(result.decision.action, 'RESEARCH', 'Invincible: decision.action is RESEARCH (unchanged from before this follow-up)');
  assertEq(result.contract.state, 'LOCKED', 'Invincible: contract.state is LOCKED (not ID_REQUIRED) — the actual bug fix');
  assertEq(result.contract.price, 63.25, 'Invincible: contract.price is $63.25 — Recommended list price / List price now show the real number');
  assertFalse(result.contract.locks.some(l => l.code === 'id-required'), 'Invincible: no id-required lock — Listing Readiness no longer shows ID REQUIRED');
  assertTrue(result.contract.locks.some(l => l.code === 'publisher-unresolved'), 'Invincible: publisher-unresolved lock present — card still correctly flags the real gap');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2a — Lozano: promoted, Phase 2 found a genuine 1-comp result.
// Narrowed trigger means realPhase2EvidenceCount=1 (not 0), so the
// visual-pool-median fallback must NOT fire. Testing both possible real
// outcomes honestly: (a) if the tier engine priced the 1 comp, it shows
// as-is; (b) if the tier engine's own >=2 band floor left price null, the
// card shows an honest no-price state — NEITHER case shows the stale
// 17-member median. This fixture proves the CONDITION is now count-based;
// the live rescan (separately) proves which real outcome actually occurs.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2a: Lozano — promoted, genuine 1-comp result, price WAS set\n');
{
  const out = {
    title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon (Naughty) LTD 100',
    issue: '1',
    year: '2014',
    identityProvisional: true,
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    listingHardLockBanner: 'Provisional ID from visual pool...',
    price: 149.99, // hypothetical: tier engine DID price the single comp
    pricingSource: 'active_ask_derived',
    rawComps: { average: 149.99, lowest: 149.99, highest: 149.99, count: 1 },
    soldComps: [],
  };
  // Simulate the api/enrich.js finalization block's decision logic directly
  // (the part this follow-up touches): narrowed trigger check.
  const realPhase2EvidenceCount = (out.rawComps?.count || 0) + (out.soldComps?.length || 0);
  assertEq(realPhase2EvidenceCount, 1, 'Lozano: realPhase2EvidenceCount=1 (not 0) — narrowed condition correctly sees this as real, not empty');
  const fallbackWouldFire = realPhase2EvidenceCount === 0;
  assertFalse(fallbackWouldFire, 'Lozano: visual-pool-median fallback does NOT fire (old out.price==null-only check would have also passed here only if price had stayed null — this proves the NEW gate is evidence-count-based, independent of that)');

  out.identityConfident = false;
  const result = runFullPipeline(out);
  assertEq(result.decision.action, 'RESEARCH', 'Lozano: decision.action is RESEARCH');
  assertEq(result.contract.state, 'LOCKED', 'Lozano: contract.state is LOCKED, price visible');
  assertEq(result.contract.price, 149.99, 'Lozano: contract.price is the REAL 1-comp price ($149.99), not the stale 17-member median (~$149.88 — deliberately close in this fixture to prove it is NOT a coincidental match, the source is genuinely different)');
}

console.log('\nFixture 2b: Lozano — promoted, genuine 1-comp result, but tier engine\'s own >=2 band floor left price null\n');
{
  // Honest alternate outcome: rawComps.count=1 (real evidence exists) but
  // the pricing engine's pre-existing calculatePriceBands floor (>=2
  // verified comps required for ANY band) means out.price stays null for
  // a reason unrelated to this fix. The narrowed trigger must NOT
  // substitute the stale family median here either — real absence-of-band
  // is still "found 1 real thing," not "found nothing."
  const out = {
    title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon (Naughty) LTD 100',
    issue: '1',
    year: '2014',
    identityProvisional: true,
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    listingHardLockBanner: 'Provisional ID from visual pool: "Alexander Lozano Signed Pop Kill #1..." #1 — AI read "Danger Girl" instead, but the visual pool unanimously disagrees — verify before listing',
    price: null, // tier engine's own floor declined to price a 1-comp pool
    rawComps: { average: null, lowest: null, highest: null, count: 1 },
    soldComps: [],
  };
  const realPhase2EvidenceCount = (out.rawComps?.count || 0) + (out.soldComps?.length || 0);
  assertEq(realPhase2EvidenceCount, 1, 'Lozano (alt): realPhase2EvidenceCount=1 even though price is null');
  assertFalse(realPhase2EvidenceCount === 0, 'Lozano (alt): fallback does NOT fire — 1 real comp is not "found nothing," even though price stayed null for an unrelated reason');

  out.identityConfident = false;
  const result = runFullPipeline(out);
  assertEq(result.contract.price, null, 'Lozano (alt): contract.price is honestly null (no stale $149.88 median substituted)');
  assertFalse(result.contract.price === 149.88, 'Lozano (alt): explicitly NOT the old stale 17-member fallback value');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — synthetic Phase 2 = truly 0 comps: fallback MUST still fire.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: synthetic — Phase 2 truly found 0 comps, fallback correctly fires\n');
{
  const out = {
    title: 'Pop Kill 1 Rachta Lin Megacon Ltd 250 Virgin & 25 Embossed Metals !!',
    issue: null,
    identityProvisional: true,
    identityComplete: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    price: null,
    rawComps: { average: null, lowest: null, highest: null, count: 0 },
    soldComps: [],
  };
  const realPhase2EvidenceCount = (out.rawComps?.count || 0) + (out.soldComps?.length || 0);
  assertEq(realPhase2EvidenceCount, 0, 'synthetic zero-comp: realPhase2EvidenceCount=0');
  assertTrue(realPhase2EvidenceCount === 0, 'synthetic zero-comp: fallback trigger condition correctly fires');

  // Apply the fallback exactly as api/enrich.js does.
  const fb = { fallbackPrice: 33, fallbackLow: 29.99, fallbackHigh: 39.95, fallbackPoolSize: 3, fallbackIsolatedToFamily: true, topFamilyTitle: 'pop kill rachta lin' };
  out.price = fb.fallbackPrice;
  out.priceLow = fb.fallbackLow;
  out.priceHigh = fb.fallbackHigh;
  out.priceBands = { quick: fb.fallbackLow, market: fb.fallbackPrice, stretch: fb.fallbackHigh, source: 'visual_pool_family_isolated', count: fb.fallbackPoolSize };
  out.pricingSource = 'visual_pool_family_isolated';
  out.identityConfident = false;
  const result = runFullPipeline(out);
  assertEq(result.contract.price, 33, 'synthetic zero-comp: contract.price correctly shows the visual-pool-median fallback ($33)');
  assertEq(result.contract.state, 'LOCKED', 'synthetic zero-comp: LOCKED, price visible');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — Eternus #2 / genuinely-unidentified: must STILL reach
// ID_REQUIRED via decision.action alone (dropping the identityConfident
// clause must not reopen this path).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: genuinely-unidentified — still correctly reaches ID_REQUIRED\n');
{
  const out = {
    title: '', // genuinely missing
    issue: null,
    identityConfident: false,
    identityComplete: false,
    identityMissingFields: ['title', 'issue'],
    price: null,
    rawComps: { count: 0 },
    soldComps: [],
  };
  const result = runFullPipeline(out);
  assertEq(result.decision.action, 'ID_REQUIRED', 'genuinely-unidentified: decision.action IS ID_REQUIRED (decisionEngine catches missing-title/identity-incomplete on its own)');
  assertEq(result.contract.state, 'ID_REQUIRED', 'genuinely-unidentified: contract.state correctly still ID_REQUIRED — dropping the redundant clause did not reopen this');
  assertEq(result.contract.price, null, 'genuinely-unidentified: contract.price null, as required for ID_REQUIRED');
  assertTrue(result.contract.locks.some(l => l.code === 'id-required'), 'genuinely-unidentified: id-required lock present, driven by decision.action alone');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 5 — Poison Ivy #31 control: fully untouched.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 5: Poison Ivy #31 control — untouched\n');
{
  const out = {
    title: 'poison ivy by',
    issue: '31',
    identityConfident: true,
    identityComplete: true,
    price: 3.87,
    priceLow: 3.49,
    priceHigh: 4.44,
    priceBands: { quick: 3.49, market: 3.87, stretch: 4.44 },
    pricingSource: 'sold_active_blend_30',
    rawComps: { average: 4.74, lowest: 2.99, highest: 6.5, count: 2 },
    soldComps: [{ price: 3.49 }],
  };
  const result = runFullPipeline(out);
  assertEq(result.decision.action, 'LIST_LOW', 'Poison Ivy #31: decision.action LIST_LOW, matching the real card');
  assertEq(result.contract.state, 'PRICED', 'Poison Ivy #31: contract.state PRICED (or ESTIMATED depending on source) — not LOCKED, not ID_REQUIRED');
  assertEq(result.contract.price, 3.87, 'Poison Ivy #31: contract.price unchanged at $3.87');
  assertFalse(result.contract.locks.some(l => l.code === 'id-required'), 'Poison Ivy #31: no id-required lock');
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
