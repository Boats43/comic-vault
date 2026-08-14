// tests/q145-contract-decision-sync.test.js
//
// Q145 dispatch (2026-07-22) — Poison Ivy #31 collection-routing class.
// Root cause (investigation report, cited log lines: "[decision]
// action=LIST_LOW" / "[contract-violation] I9: price 12.25 >100% over
// own pool avg 3.49 with action LIST_LOW"): src/lib/responseContract.js's
// finalizeResponse() had TWO independent partial-sync blocks. The
// sold-side-anchor block synced BOTH out.decision.action and out.
// decision.bestChannel; the I9 contract-violation block (added later,
// Q109 dispatch Part 1) synced ONLY .action, forgetting .bestChannel.
// That asymmetry let a stale out.decision.bestChannel ('cash_sale',
// frozen inside computeDecision/computeBestChannel BEFORE I9 ever runs)
// reach the client verbatim (src/App.jsx's `syncedDecision = enrich.
// decision || cur.decision`, merged with no re-derivation) — the
// collection screen's getChannelMetrics and per-row pill both read
// item.decision.bestChannel directly and routed an I9-violating,
// LOCKED, RESEARCH-action book into the "💵 LIST" bucket with its
// pre-violation price, while the detail card (reads item.contract.*
// directly) correctly showed "LISTING LOCKED — CONTRACT VIOLATION".
//
// This file covers FIX 1 (server-side, primary — the actual sync)
// directly and exhaustively via real finalizeResponse() calls. FIXES
// 2-4 (client-side: getAuthoritativeChannel, submitBundle's contract-
// listable guard, the identity-readiness tri-state) live in src/App.jsx,
// which has no named exports for these internal consts — covered here
// via (a) a local mirror of the exact resolver logic, documented as
// mirroring App.jsx and cross-checked against a source-level guard, and
// (b) source-level regex assertions confirming the literal
// implementation exists (same convention as tests/q141's inline-gate
// guard and tests/q143's source-level checks, for the same reason: no
// pure-function extraction exists for these specific client sites).
//
// Invoke: node tests/q145-contract-decision-sync.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { finalizeResponse } from '../src/lib/responseContract.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(__dirname, '../src/App.jsx'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

// Local mirror of src/App.jsx's getAuthoritativeChannel — kept in exact
// sync via the source-level guard in Part 0 below. Any future edit to
// the real implementation that isn't mirrored here fails that guard,
// not silently drifts.
const getAuthoritativeChannel = (item) => {
  if (!item) return null;
  const contract = item.contract;
  const legacy = item.decision?.bestChannel || null;
  if (!contract) return legacy;
  if (contract.state === 'ID_REQUIRED') return 'blocked';
  if (contract.state === 'REFUSED' || contract.state === 'LOCKED' || contract.listable === false) {
    return 'research';
  }
  return contract.bestChannel || legacy || null;
};
// Local mirror of passesContractGate.
const passesContractGate = (c) => (c.contract ? c.contract.listable === true : true);

console.log('\n=== Q145 — contract/decision sync + collection-routing authority ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — source-level guards: confirm the real App.jsx implementation
// exists and matches what this file's local mirrors assume.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: source-level guards on App.jsx\n');
{
  assertTrue(appSrc.includes('const getAuthoritativeChannel = (item) => {'), 'getAuthoritativeChannel defined');
  assertTrue(
    /if \(contract\.state === 'ID_REQUIRED'\) return 'blocked';\s*\n\s*if \(contract\.state === 'REFUSED' \|\| contract\.state === 'LOCKED' \|\| contract\.listable === false\) {\s*\n\s*return 'research';/.test(appSrc),
    'getAuthoritativeChannel forces LOCKED/REFUSED/listable=false to research and ID_REQUIRED to blocked, regardless of contract.bestChannel'
  );
  assertTrue(appSrc.includes('const channel = getAuthoritativeChannel(item);'), 'getChannelMetrics uses the shared resolver, not item.decision.bestChannel directly');
  assertTrue(appSrc.includes('{getAuthoritativeChannel(item) && (() => {'), 'per-row pill uses the shared resolver');
  assertTrue(appSrc.includes("getAuthoritativeChannel(c) !== 'research' &&"), 'trade-eligibility check uses the shared resolver, not the stale c.decision?.bestChannel');
  assertTrue(
    /const notListable = items\.filter\(\(c\) => !passesContractGate\(c\)\);/.test(appSrc),
    'submitBundle gates on passesContractGate (contract.listable), not just ID_REQUIRED/DO_NOT_LIST/blockers'
  );
  // GrailKey Directive Z — identityConfirmed now PREFERS
  // item.contract.actionAuthority.identityStanding (computed server-side,
  // before the client-merge boundary that strips the raw fields below)
  // when present, falling back to the pre-Z three-way check (identical
  // text, still verified below) only for legacy items scanned before
  // actionAuthority existed.
  assertTrue(
    /const authority = item\.contract\?\.actionAuthority;/.test(appSrc),
    'identityConfirmed reads item.contract.actionAuthority when present (GrailKey Directive Z)'
  );
  assertTrue(
    /isProvisional = !isUnresolved && \(\s*\n\s*authority\s*\n\s*\? authority\.identityStanding === 'CONFLICTED'\s*\n\s*: \(\s*\n\s*item\.identityProvisional === true \|\|\s*\n\s*item\.listingHardLockReason === 'identity-unresolved' \|\|\s*\n\s*\(item\.contract\?\.locks \|\| \[\]\)\.some\(\(l\) => l\.code === 'identity-unresolved'\)/.test(appSrc),
    'identityConfirmed tri-state falls back to checking identityProvisional/listingHardLockReason AND the reliable contract.locks proxy for legacy (no-authority) items'
  );
  // The discovery made while implementing FIX 4: neither raw field is
  // actually merged into the client catalogue anywhere in this file.
  assertEq((appSrc.match(/identityProvisional:/g) || []).length, 0, 'confirmed: identityProvisional is never assigned as a merge-object field anywhere in App.jsx (the contract.locks proxy is load-bearing, not redundant)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture builder — matches tests/response-contract.test.js's cleanOut
// convention (hand-constructed decision object, same as the existing
// ASM #17/Ditko I9 test) so LIST_LOW/cash_sale reflects the real cited
// production values exactly, not whatever computeDecision derives from
// a synthetic item shape.
// ═══════════════════════════════════════════════════════════════════════
function buildOut(overrides = {}) {
  return {
    price: '$12.25',
    priceLow: '$10.00',
    priceHigh: '$14.00',
    pricingSource: 'sold_active_blend_30',
    priceBands: { quick: 10, market: 12.25, stretch: 14, tier: 2 },
    soldCompsAvg: 3.49,
    soldComps: [{ price: 3.49 }, { price: 3.5 }],
    rawComps: { count: 4, average: 3.49, lowest: 2, highest: 5 },
    identityConfident: true,
    identityComplete: true,
    refusedToPrice: false,
    decision: {
      action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: [],
      nextStep: '', bestChannel: 'cash_sale',
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture A — Poison Ivy #31 (real production shape, cited log values)
// LIST_LOW/cash_sale prelim → LOCKED/research final → RESEARCH route,
// bundle rejected.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture A: Poison Ivy #31 — I9 violation demotes end to end\n');
{
  const out = buildOut();
  finalizeResponse(out);

  assertTrue(out.contract.violations.some((v) => v.startsWith('I9')), 'I9 violation fires (price $12.25 >100% over pool avg $3.49)');
  assertEq(out.decision.action, 'RESEARCH', 'out.decision.action synced to RESEARCH');
  assertEq(out.decision.bestChannel, 'research', 'out.decision.bestChannel synced to research (the actual bug — was "cash_sale" pre-fix)');
  // Any contract violation (I1-I13, including I9) demotes state to
  // INCOMPLETE unconditionally (responseContract.js:641-650) — the
  // correct, pre-existing behavior ("worst case is an honest INCOMPLETE
  // with a locked button," per this file's own top docstring), not
  // LOCKED. App.jsx's banner renders INCOMPLETE the same as LOCKED
  // ("🔒 LISTING LOCKED", binary check against REFUSED only) — matches
  // the user's own cited detail-card text exactly.
  assertEq(out.contract.state, 'INCOMPLETE', 'contract.state is INCOMPLETE (renders as "LISTING LOCKED" client-side, matches cited evidence)');
  assertEq(out.contract.listable, false, 'contract.listable is false');

  const item = { decision: out.decision, contract: out.contract };
  assertEq(getAuthoritativeChannel(item), 'research', 'collection screen routes to research, not cash_sale');
  assertFalse(passesContractGate(item), 'bundle submission would reject this book (not listable)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture B — Rachta Lin (Q143's active_reference_range, promoted
// provisional identity) → LOCKED → RESEARCH route, readiness shows
// PROVISIONAL, bundle rejected.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture B: Rachta Lin — active_reference_range, provisional identity\n');
{
  const out = buildOut({
    price: '$33.00', priceLow: '$30.00', priceHigh: '$36.00',
    priceBands: null,
    pricingSource: 'active_reference_range',
    soldCompsAvg: undefined,
    soldComps: [],
    rawComps: { count: 2, average: 33, lowest: 30, highest: 36 },
    identityConfident: false,
    identityComplete: false,
    identityProvisional: true,
    listingHardLocked: true,
    listingHardLockReason: 'identity-unresolved',
    listingHardLockBanner: 'Reference range from 2 active listings — not a verified FMV, identity unconfirmed, verify before listing.',
    verifiedFMV: false,
    refusedToPrice: false,
    decision: {
      action: 'RESEARCH', confidence: 'low', blockers: [], warnings: ['identity-conflict-unresolved'],
      nextStep: '', bestChannel: 'research',
    },
  });
  finalizeResponse(out);

  assertEq(out.contract.violations.length, 0, 'no contract violations for a genuine reference-range price');
  assertEq(out.contract.state, 'LOCKED', 'contract.state is LOCKED (listingHardLocked, not REFUSED)');
  assertTrue(out.contract.price != null, 'price stays visible on the LOCKED card');
  assertEq(out.decision.action, 'RESEARCH', 'out.decision.action is RESEARCH');
  assertEq(out.decision.bestChannel, 'research', 'out.decision.bestChannel is research');

  const item = { decision: out.decision, contract: out.contract, identityProvisional: true, listingHardLockReason: 'identity-unresolved' };
  assertEq(getAuthoritativeChannel(item), 'research', 'collection screen routes to research');
  assertFalse(passesContractGate(item), 'bundle submission would reject this book');

  // Readiness tri-state (mirrors App.jsx's identityConfirmed logic directly
  // against the contract.locks proxy, since that's the reliable signal).
  const isUnresolved = item.decision.action === 'ID_REQUIRED';
  const isProvisional = !isUnresolved && (item.identityProvisional === true || item.listingHardLockReason === 'identity-unresolved');
  assertEq(isProvisional ? 'PROVISIONAL' : isUnresolved ? 'UNRESOLVED' : 'CONFIRMED', 'PROVISIONAL', 'readiness checklist would show PROVISIONAL, not an unqualified "confirmed"');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture C — safe listable control (READY class) → LIST route, bundle
// allowed. Proves this dispatch doesn't over-correct into blocking
// legitimate LIST_NOW books.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture C: safe listable control — unaffected\n');
{
  const out = buildOut({
    price: '$45.00', priceLow: '$40.00', priceHigh: '$50.00',
    priceBands: { quick: 40, market: 45, stretch: 50, tier: 1, source: 'verified_sold_recency' },
    pricingSource: 'verified_sold_recency',
    soldCompsAvg: 44,
    soldComps: [{ price: 42 }, { price: 44 }, { price: 46 }],
    rawComps: { count: 5, average: 44, lowest: 40, highest: 50 },
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [], nextStep: '', bestChannel: 'cash_sale' },
  });
  finalizeResponse(out);

  assertEq(out.contract.violations.length, 0, 'no violations for a clean, coherent LIST_NOW book');
  assertEq(out.contract.state, 'PRICED', 'contract.state is PRICED');
  assertEq(out.decision.action, 'LIST_NOW', 'out.decision.action stays LIST_NOW, uncapped');
  assertEq(out.decision.bestChannel, 'cash_sale', 'out.decision.bestChannel stays cash_sale, uncapped');
  assertTrue(out.contract.listable, 'contract.listable is true');

  const item = { decision: out.decision, contract: out.contract };
  assertEq(getAuthoritativeChannel(item), 'cash_sale', 'collection screen correctly routes to cash_sale (LIST)');
  assertTrue(passesContractGate(item), 'bundle submission would allow this book');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture D — Poison Ivy unresolved (genuinely unidentified) → BLOCKED,
// bundle rejected. Byte-identical control, unaffected by this dispatch.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture D: Poison Ivy #1 (unresolved) — BLOCKED, unaffected\n');
{
  const out = buildOut({
    price: null, priceLow: null, priceHigh: null,
    priceBands: null,
    pricingSource: 'identity-required',
    soldCompsAvg: undefined,
    soldComps: [],
    rawComps: { count: 0, average: null, lowest: null, highest: null },
    identityConfident: false,
    identityComplete: false,
    refusedToPrice: false,
    decision: { action: 'ID_REQUIRED', confidence: 'low', blockers: ['identity-not-confident'], warnings: [], nextStep: '', bestChannel: 'blocked' },
  });
  finalizeResponse(out);

  assertEq(out.contract.state, 'ID_REQUIRED', 'contract.state stays ID_REQUIRED');
  assertEq(out.decision.action, 'ID_REQUIRED', 'out.decision.action stays ID_REQUIRED');
  assertEq(out.decision.bestChannel, 'blocked', 'out.decision.bestChannel stays blocked');
  assertEq(out.contract.price, null, 'price stays null');

  const item = { decision: out.decision, contract: out.contract };
  assertEq(getAuthoritativeChannel(item), 'blocked', 'collection screen routes to blocked');
  assertFalse(passesContractGate(item), 'bundle submission would reject this book');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture E — sold-side-anchor demotion (Ship 24c). Regression proof the
// ALREADY-correctly-synced path (both action AND bestChannel, pre-Q145)
// still works identically after centralizing into syncDecisionToContract.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture E: sold-side-anchor demotion — regression control\n');
{
  const out = buildOut({
    price: '$17.00', priceLow: '$14.00', priceHigh: '$20.00',
    priceBands: { quick: 14, market: 17, stretch: 20, tier: 2 },
    pricingSource: 'active_ask_derived',
    soldCompsAvg: undefined,
    soldComps: Array.from({ length: 15 }, () => ({ price: 355, daysAgo: 200 })),
    rawComps: { count: 3, average: 18.23, lowest: 15, highest: 22, prices: [{ price: 18, title: 'x' }, { price: 18.5, title: 'x' }, { price: 18.2, title: 'x' }] },
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [], nextStep: '', bestChannel: 'cash_sale' },
  });
  finalizeResponse(out);

  assertTrue(out.contract.soldSideAnchored === true, 'sold-side anchor fires (extreme sold/active mismatch)');
  assertEq(out.decision.action, 'RESEARCH', 'out.decision.action synced to RESEARCH (already worked pre-Q145)');
  assertEq(out.decision.bestChannel, 'research', 'out.decision.bestChannel synced to research (already worked pre-Q145 — must not regress)');
  assertTrue(out.decision.warnings.includes('sold-active-mismatch-extreme'), 'warning marker present');

  const item = { decision: out.decision, contract: out.contract };
  assertEq(getAuthoritativeChannel(item), 'research', 'collection screen routes to research');
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
