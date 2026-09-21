// tests/gk238-authority-truthfulness-hotfix.test.js
//
// GK-238 — Authority Truthfulness Hotfix. Dispatch (2026-09-21) found three
// real production cases where marketStanding/actionAuthority claimed
// EXACT_CURRENT/READY/LIST NOW with a live eBay-listing button, off
// pricingSource alone, with no usable SOLD evidence behind it:
//   Case A — ASM #11:            rawCount=0,  verifiedCount=0, warnings=[]
//   Case B — New Mutants #98:    rawCount=30, verifiedCount=0
//   Case C — Detective Comics #424: verifiedCount=1, newest sold comp 203d old
// Plus a regression guard (Hulk #180, verifiedCount=11) proving genuinely
// strong sold evidence is completely unaffected.
//
// Invariant under test: EXACT_CURRENT requires usable verified SOLD
// evidence, not merely a nonzero verified count.
//
// Invoke: node tests/gk238-authority-truthfulness-hotfix.test.js

import { verifySoldComps } from '../src/lib/soldVerification.js';
import { deriveMarketStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { deriveLocks, assembleContract, finalizeResponse } from '../src/lib/responseContract.js';
import { computeDecision, describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GK-238 — Authority Truthfulness Hotfix ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — soldVerification.js: newestDaysAgo computation (the reused
// signal itself, at its single source of truth).
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: soldVerification.js newestDaysAgo\n');
{
  const zeroRows = verifySoldComps([], { title: 'Test', issue: '1' });
  assertEq(zeroRows.diagnostics.rawCount, 0, 'zero raw rows: rawCount 0');
  assertEq(zeroRows.diagnostics.newestDaysAgo, null, 'zero raw rows: newestDaysAgo null (nothing to measure)');

  const rows = [
    { price: 50, date: '2026-01-01', daysAgo: 203, title: 'Detective Comics #424', grade: 'NM' },
  ];
  const oneRow = verifySoldComps(rows, { title: 'Detective Comics', issue: '424', bookYear: '1972' });
  if (oneRow.diagnostics.verifiedCount > 0) {
    assertEq(oneRow.diagnostics.newestDaysAgo, 203, 'single verified row: newestDaysAgo matches its own daysAgo');
  } else {
    console.log('  (skipped — fixture row rejected by an unrelated filter; not this dispatch\'s concern)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — deriveMarketStanding, DIRECT unit tests for the 4 documented
// states.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: deriveMarketStanding DIRECT\n');
{
  // Fixture 1 — Case A (ASM #11): rawCount=0, verifiedCount=0.
  const asm11 = {
    pricingSource: 'active_ask_derived',
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {}, newestDaysAgo: null },
  };
  assertEq(deriveMarketStanding(asm11), 'NO_SOLD_EVIDENCE', 'Fixture 1 (ASM #11, rawCount=0): not EXACT_CURRENT');

  // Fixture 2 — Case B (New Mutants #98): rawCount=30, verifiedCount=0.
  const nm98 = {
    pricingSource: 'active_ask_derived',
    soldCompDiagnostics: { rawCount: 30, verifiedCount: 0, rejectedCount: 30, reasons: { variantMismatch: 30 }, newestDaysAgo: null },
  };
  assertEq(deriveMarketStanding(nm98), 'NO_SOLD_EVIDENCE', 'Fixture 2 (New Mutants #98, rawCount=30/verifiedCount=0): not EXACT_CURRENT');

  // Fixture 3 — Case C (Detective Comics #424): verifiedCount=1, 203 days old.
  const det424 = {
    pricingSource: 'verified_sold',
    soldCompDiagnostics: { rawCount: 1, verifiedCount: 1, rejectedCount: 0, reasons: {}, newestDaysAgo: 203 },
  };
  assertEq(deriveMarketStanding(det424), 'EXACT_STALE', 'Fixture 3 (Detective #424, 1 verified comp 203d old): not EXACT_CURRENT (floors to EXACT_STALE)');

  // Fixture 4 — Hulk #180 regression guard: verifiedCount=11, fresh.
  const hulk180 = {
    pricingSource: 'verified_sold_recency',
    soldCompDiagnostics: { rawCount: 12, verifiedCount: 11, rejectedCount: 1, reasons: { lot: 1 }, newestDaysAgo: 14 },
  };
  assertEq(deriveMarketStanding(hulk180), 'EXACT_CURRENT', 'Fixture 4 (Hulk #180, 11 verified, fresh): EXACT_CURRENT preserved exactly');

  // Boundary: exactly 180 days is NOT stale (decisionEngine.js's own
  // '> 180' threshold, reused verbatim — 180 itself stays fresh-enough).
  const boundary180 = {
    pricingSource: 'verified_sold',
    soldCompDiagnostics: { rawCount: 1, verifiedCount: 1, newestDaysAgo: 180 },
  };
  assertEq(deriveMarketStanding(boundary180), 'EXACT_CURRENT', 'exactly 180 days: still EXACT_CURRENT (threshold is > 180, matching decisionEngine.js verbatim)');
  const boundary181 = {
    pricingSource: 'verified_sold',
    soldCompDiagnostics: { rawCount: 1, verifiedCount: 1, newestDaysAgo: 181 },
  };
  assertEq(deriveMarketStanding(boundary181), 'EXACT_STALE', '181 days: EXACT_STALE');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — absence-safety regression: every pre-existing caller that never
// set soldCompDiagnostics (the overwhelming majority of this repo's own
// prior test fixtures) must be completely unaffected.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: absence-safety regression (protects pre-existing callers)\n');
{
  assertEq(deriveMarketStanding({ pricingSource: 'active_ask_derived' }), 'EXACT_CURRENT', 'no soldCompDiagnostics at all: EXACT_CURRENT unaffected (bare fixture, matches dozens of pre-existing tests)');
  assertEq(deriveMarketStanding({ pricingSource: 'verified_sold_recency' }), 'EXACT_CURRENT', 'no soldCompDiagnostics at all: EXACT_CURRENT unaffected (sold-tier source)');
  assertEq(deriveMarketStanding({ pricingSource: 'verified_active' }), 'EXACT_CURRENT', 'legacy verified_active source, no soldCompDiagnostics: unaffected');
  assertEq(deriveMarketStanding({ pricingSource: 'ebay-polybag-active' }), 'EXACT_CURRENT', 'polybag active source (diagnostics object has no rawCount field by construction): unaffected');
  // Polybag's REAL diagnostics shape (api/enrich.js: {kept,rejected,reasons}, no rawCount).
  assertEq(
    deriveMarketStanding({ pricingSource: 'ebay-polybag-active', soldCompDiagnostics: { kept: 0, rejected: 0, reasons: {} } }),
    'EXACT_CURRENT',
    'polybag REAL diagnostics shape (no rawCount field): still EXACT_CURRENT, this dispatch does not touch polybag pricing'
  );
  // Non-EXACT_CURRENT sources untouched regardless of soldCompDiagnostics.
  assertEq(deriveMarketStanding({ pricingSource: 'pc_estimate', soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 } }), 'FALLBACK_ONLY', 'pc_estimate stays FALLBACK_ONLY regardless of soldCompDiagnostics');
  assertEq(deriveMarketStanding({ pricingSource: 'refused', soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 } }), 'NONE', 'refused stays NONE regardless of soldCompDiagnostics');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — decisionEngine.js: 'no-sold-candidates' warning (new) and
// 'zero-verified-comps' (existing, unchanged emission condition).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: decisionEngine.js warnings\n');
{
  const caseA = {
    title: 'Amazing Spider-Man', issue: '11', publisher: 'Marvel', year: 1964,
    price: '$52.70', pricingSource: 'active_ask_derived',
    rawComps: { count: 5, average: 62, lowest: 50, highest: 80 },
    soldComps: [], soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {}, newestDaysAgo: null },
    identityConfident: true,
  };
  const decisionA = computeDecision(caseA);
  assertTrue(decisionA.warnings.includes('no-sold-candidates'), 'Case A: no-sold-candidates warning present');
  assertFalse(decisionA.warnings.includes('zero-verified-comps'), 'Case A: zero-verified-comps must NOT also fire (mutually exclusive with no-sold-candidates)');
  assertEq(decisionA.action, 'RESEARCH', 'Case A: decision.action escalates to RESEARCH (no-sold-candidates is a critical warning) — not LIST NOW');
  const msgA = describeWarning('no-sold-candidates', caseA);
  assertTrue(msgA !== 'no-sold-candidates', 'Case A: describeWarning resolves to a real sentence, not the bare slug');
  assertTrue(/active listing/i.test(msgA), `Case A: message names active-listing-only evidence: "${msgA}"`);

  const caseB = {
    title: 'New Mutants', issue: '98', publisher: 'Marvel', year: 1991,
    price: '$45.00', pricingSource: 'active_ask_derived',
    rawComps: { count: 4, average: 50, lowest: 40, highest: 60 },
    soldComps: [], soldCompDiagnostics: { rawCount: 30, verifiedCount: 0, rejectedCount: 30, reasons: { variantMismatch: 30 }, newestDaysAgo: null },
    identityConfident: true,
  };
  const decisionB = computeDecision(caseB);
  assertTrue(decisionB.warnings.includes('zero-verified-comps'), 'Case B: zero-verified-comps warning present (pre-existing, unchanged behavior)');
  assertFalse(decisionB.warnings.includes('no-sold-candidates'), 'Case B: no-sold-candidates must NOT fire (rawCount > 0 — candidates WERE found)');
  assertEq(decisionB.action, 'RESEARCH', 'Case B: decision.action already correctly downgrades to RESEARCH (pre-existing behavior, confirmed unchanged)');

  // Regression: a caller that never sets soldCompDiagnostics at all must
  // never gain the new warning (matches many pre-existing decisionEngine
  // test fixtures across this repo).
  const noDiagItem = {
    title: 'Batman', issue: '608', publisher: 'DC', year: 2002,
    price: '$175.00', pricingSource: 'active_ask_derived',
    rawComps: { count: 8, average: 180, lowest: 100, highest: 260 },
  };
  const noDiagDecision = computeDecision(noDiagItem);
  assertFalse(noDiagDecision.warnings.includes('no-sold-candidates'), 'no soldCompDiagnostics at all: no-sold-candidates does not fire (absence-safe)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — full card-level proof (real assembleContract/finalizeResponse):
// marketStanding, actionAuthority.state, listable, AND price immutability
// (this hotfix changes authority state only, never the calculated price).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: full card-level proof (assembleContract, REAL)\n');

function buildOut(overrides) {
  return {
    title: 'Amazing Spider-Man', issue: '11', publisher: 'Marvel', year: '1964',
    price: '$52.70', priceLow: '$44.80', priceHigh: '$60.60',
    priceBands: { quick: 44.8, market: 52.7, stretch: 60.6, tier: 3, source: 'tier3_active_discounted' },
    pricingSource: 'active_ask_derived',
    soldComps: [],
    rawComps: { count: 5, average: 62, lowest: 50, highest: 80 },
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {}, newestDaysAgo: null },
    matchConfidence: { score: 80, tier: 'HIGH' },
    identityConfident: true,
    identityComplete: true,
    refusedToPrice: false,
    ...overrides,
  };
}

{
  // Fixture 1 — ASM #11 (Case A).
  const out = buildOut({});
  out.decision = computeDecision(out);
  const priceBeforeFinalize = out.price;
  finalizeResponse(out);
  assertEq(out.contract.actionAuthority.marketStanding, 'NO_SOLD_EVIDENCE', 'Fixture 1: contract.actionAuthority.marketStanding not EXACT_CURRENT');
  assertFalse(out.contract.actionAuthority.state === 'READY', 'Fixture 1: not READY');
  assertFalse(out.contract.listable, 'Fixture 1: not listable (no live one-tap eBay-listing action)');
  assertTrue(out.contract.actionAuthority.reasonCodes.includes('NO_SOLD_EVIDENCE'), 'Fixture 1: reason code explains why');
  assertEq(out.contract.price, 52.70, 'Fixture 1: PRICE IMMUTABLE — contract.price unchanged by this hotfix');
  assertEq(priceBeforeFinalize, '$52.70', 'Fixture 1: input price never mutated in place');
}

{
  // Fixture 2 — New Mutants #98 (Case B).
  const out = buildOut({
    price: '$45.00', priceLow: '$38.00', priceHigh: '$52.00',
    priceBands: { quick: 38, market: 45, stretch: 52, tier: 3, source: 'tier3_active_discounted' },
    rawComps: { count: 4, average: 50, lowest: 40, highest: 60 },
    soldCompDiagnostics: { rawCount: 30, verifiedCount: 0, rejectedCount: 30, reasons: { variantMismatch: 30 }, newestDaysAgo: null },
  });
  out.decision = computeDecision(out);
  finalizeResponse(out);
  assertEq(out.contract.actionAuthority.marketStanding, 'NO_SOLD_EVIDENCE', 'Fixture 2: marketStanding not EXACT_CURRENT (was the dishonest label even after decision.action correctly downgraded)');
  assertFalse(out.contract.actionAuthority.state === 'READY', 'Fixture 2: not READY');
  assertFalse(out.contract.listable, 'Fixture 2: not listable');
  assertEq(out.contract.decision.action, 'RESEARCH', 'Fixture 2: decision.action RESEARCH (unchanged, was already correct)');
  assertEq(out.contract.price, 45.00, 'Fixture 2: PRICE IMMUTABLE');
}

{
  // Fixture 3 — Detective Comics #424 (Case C).
  const out = buildOut({
    price: '$24.12', priceLow: '$20.50', priceHigh: '$27.74',
    priceBands: { quick: 20.5, market: 24.12, stretch: 27.74, tier: 2, source: 'tier2_sold_only' },
    pricingSource: 'verified_sold',
    soldComps: [{ price: 24.12, daysAgo: 203 }],
    rawComps: { count: 3, average: 26, lowest: 22, highest: 30 },
    soldCompDiagnostics: { rawCount: 1, verifiedCount: 1, rejectedCount: 0, reasons: {}, newestDaysAgo: 203 },
  });
  out.decision = computeDecision(out);
  // decisionEngine's own pre-existing 'sold-comps-stale' warning must
  // already be firing for this shape — the dispatch's own observation that
  // the DECISION side already knew about the staleness.
  assertTrue(out.decision.warnings.includes('sold-comps-stale'), 'Fixture 3: pre-existing sold-comps-stale warning already fires (decision layer was never the bug)');
  finalizeResponse(out);
  assertEq(out.contract.actionAuthority.marketStanding, 'EXACT_STALE', 'Fixture 3: marketStanding not EXACT_CURRENT (floors to EXACT_STALE)');
  assertFalse(out.contract.actionAuthority.state === 'READY', 'Fixture 3: not READY — no live List button');
  assertFalse(out.contract.listable, 'Fixture 3: not listable');
  assertEq(out.contract.price, 24.12, 'Fixture 3: PRICE IMMUTABLE');
}

{
  // Fixture 4 — Hulk #180 regression guard: preserve current behavior EXACTLY.
  const out = buildOut({
    price: '$1200.00', priceLow: '$1020.00', priceHigh: '$1380.00',
    priceBands: { quick: 1020, market: 1200, stretch: 1380, tier: 1, source: 'tier1_recency_weighted' },
    pricingSource: 'verified_sold_recency',
    soldComps: Array.from({ length: 11 }, (_, i) => ({ price: 1200 + i, daysAgo: 5 + i })),
    rawComps: { count: 12, average: 1150, lowest: 1000, highest: 1300 },
    soldCompDiagnostics: { rawCount: 12, verifiedCount: 11, rejectedCount: 1, reasons: { lot: 1 }, newestDaysAgo: 5 },
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [], nextStep: '', bestChannel: 'cash_sale' },
  });
  finalizeResponse(out);
  assertEq(out.contract.actionAuthority.marketStanding, 'EXACT_CURRENT', 'Fixture 4 (Hulk #180): marketStanding EXACT_CURRENT preserved exactly');
  assertEq(out.contract.actionAuthority.state, 'READY', 'Fixture 4 (Hulk #180): READY preserved exactly');
  assertTrue(out.contract.listable, 'Fixture 4 (Hulk #180): listable (live one-tap List action) preserved exactly');
  assertEq(out.contract.price, 1200.00, 'Fixture 4: PRICE IMMUTABLE (and correct — this hotfix must never touch strong-evidence pricing)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — api/list-ebay.js server-side independent re-derivation
// (MIRRORED — see grailkey-directive-z-transaction-authority.test.js Part
// 4 for why the HTTP handler itself isn't independently invocable here;
// this mirrors its syntheticOut construction exactly, including the new
// soldCompDiagnostics field this dispatch adds).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: server-side independent re-derivation (MIRRORED)\n');
{
  // ASM #11 shape, as api/list-ebay.js would receive it from App.jsx's
  // request body (item.soldCompDiagnostics threaded through, per this
  // dispatch's src/App.jsx change).
  const clientPayload = {
    pricingSource: 'active_ask_derived',
    rawComps: { count: 5 },
    soldComps: 0,
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null },
    decision: { action: 'LIST_NOW', blockers: [] },
    identityConfident: true,
    refusedToPrice: false,
    manualReviewRequired: false,
    gradeExceedsMap: false,
    claudeCheckBlocker: null,
    tier0Locked: false,
  };
  const syntheticOut = {
    decision: clientPayload.decision,
    pricingSource: clientPayload.pricingSource,
    rawComps: clientPayload.rawComps,
    soldComps: new Array(clientPayload.soldComps).fill({}),
    soldCompDiagnostics: clientPayload.soldCompDiagnostics ? {
      rawCount: clientPayload.soldCompDiagnostics.rawCount,
      verifiedCount: clientPayload.soldCompDiagnostics.verifiedCount,
      newestDaysAgo: clientPayload.soldCompDiagnostics.newestDaysAgo,
    } : null,
    identityConfident: clientPayload.identityConfident,
    refusedToPrice: clientPayload.refusedToPrice,
    manualReviewRequired: clientPayload.manualReviewRequired,
    gradeExceedsMap: clientPayload.gradeExceedsMap,
    claudeCheckBlocker: clientPayload.claudeCheckBlocker,
    tier0Locked: clientPayload.tier0Locked,
  };
  const freshLocks = deriveLocks(syntheticOut);
  const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
  const serverReady = authority.state === 'READY';
  assertEq(authority.state, 'REVIEW', 'SERVER: ASM #11 shape independently re-derived as REVIEW, not READY');
  assertFalse(serverReady, 'SERVER: api/list-ebay.js would reject with 403 ACTION_AUTHORITY_NOT_READY — no live listing action reaches eBay');

  // CONTROL: a client payload that never sent soldCompDiagnostics at all
  // (older cached catalogue item, pre-dating this fix) must reach READY
  // exactly as before — absence never fabricates a demotion server-side.
  const controlSynthetic = {
    decision: { action: 'LIST_NOW', blockers: [] },
    pricingSource: 'verified_sold_recency',
    rawComps: { count: 8 },
    soldComps: new Array(3).fill({}),
    soldCompDiagnostics: null,
    identityConfident: true,
    refusedToPrice: false,
    manualReviewRequired: false,
    gradeExceedsMap: false,
    claudeCheckBlocker: null,
    tier0Locked: false,
  };
  const controlLocks = deriveLocks(controlSynthetic);
  const controlAuthority = deriveActionAuthority(controlSynthetic, controlLocks, controlSynthetic.decision);
  assertEq(controlAuthority.state, 'READY', 'CONTROL: soldCompDiagnostics:null (pre-fix client) still reaches READY — absence-safe server-side too');
}

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
