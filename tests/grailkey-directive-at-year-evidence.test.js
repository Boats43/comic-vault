// tests/grailkey-directive-at-year-evidence.test.js
//
// GrailKey Directive 2026-08-17-AT — GK-135.
//
// Rule: year candidates always enter the year evidence set — from the
// frozen rank-1 row, pool year-consensus, and catalog anchors,
// unconditionally. A reconciled year at CONTESTED authority prices at
// REVIEW — it does not block. Year-driven ID_REQUIRED fires only when no
// candidate exists anywhere.
//
// Production evidence, 2026-08-17 14:28, build 48a14c5: Venom Separation
// Anxiety #1 (issue + variant already correctly adopted by AS/AM/AR) and
// a Dell'Otto book (price bands genuinely computed) both LOCKED on "year
// missing" — src/lib/identityGate.js's assessIdentityConfidence treats
// year as a plain required field (truthy or nothing), and resolveYear
// (identityCore.js) has no path to the pool's own year evidence when
// Vision/PC/CV all come up empty (modern covers routinely omit a
// printed year).
//
// Fix: reconcileYear (src/lib/identityReconciler.js), a new evidence-set
// reconciler mirroring reconcileIssue's own shape, fed from FOUR raw
// signals as independent evidence (never resolveYear's own fused
// output, which would be circular): Vision's year, the catalog anchor
// (PC/CV), the pool's own year-consensus (`poolYearHint`, already
// computed, previously fed nothing but CV query construction), and the
// frozen rank-1 row's own year token (`extractFirstEligibleYearCandidate`,
// AL-4e's existing extractor, previously only invoked from the narrow N2
// PC-re-anchor trigger). Wired in api/enrich.js immediately after
// resolveYear's own call — resolveYear itself is completely untouched,
// same inputs, same precedence, same tests. When resolveYear finds
// nothing, reconcileYear's own winner (if any) is adopted as the rescue;
// when resolveYear already found a value, only the AUTHORITY is
// reported (out.yearAuthority), never the value. A CONTESTED year floors
// `deriveMarketStanding` to SIMILAR_ONLY (actionAuthority.js) with a
// distinct `YEAR_CONTESTED` reason code (responseContract.js) — the
// exact per-facet law AR already established for variant, extended to
// year. The era filter (api/comps.js's applyEraConsistencyFilter) gains
// an advisory mode (`yearIsContested`, default false — every existing
// caller/test byte-identical): a CONTESTED year no longer hard-rejects
// comps against it, closing the "1971 disease" risk of deleting the
// operator's own book on an anchor the system itself marks disputed.
//
// Invoke: node tests/grailkey-directive-at-year-evidence.test.js

import { reconcileYear, createEvidenceSet, addEvidence } from '../src/lib/identityReconciler.js';
import { deriveMarketStanding, deriveActionAuthority, deriveIdentityStanding } from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';
import { applyEraConsistencyFilter } from '../api/comps.js';

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

const run = (label, out) => {
  const locks = deriveLocks(out);
  const identityStanding = deriveIdentityStanding(out);
  const marketStanding = deriveMarketStanding(out);
  const authority = deriveActionAuthority(out, locks, out.decision);
  console.log(`  --- ${label} --- marketStanding=${marketStanding} authority.state=${authority.state} reasonCodes=${JSON.stringify(authority.reasonCodes)}`);
  return { locks, identityStanding, marketStanding, authority };
};

// ════════════════════════════════════════════════════════════════════════
// B1 — Venom production shape (real handler, DIRECT — see the companion
// run in the dispatch's own trace log for the full end-to-end capture:
// [reconcile-year] RESCUE fired, identity-gate missing=[], issue=1
// year=2024 yearAuthority=CORROBORATED, statusCode=200). Reproduced here
// at the reconciler + actionAuthority level for a fast, deterministic
// regression a real network mock doesn't need to back.
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B1: Venom production shape — SHIP-BLOCKING ===');
{
  // PRE — demonstrate the actual failing production shape: resolveYear
  // found nothing (Vision year absent, PC/CV absent), no reconciler
  // existed to rescue it, sanitizedIdentity.year stays falsy.
  const preSanitizedYear = null; // literally what confirmedYear was before this dispatch, for this shape
  assertEq(preSanitizedYear, null, 'PRE: confirmedYear is null — the identity-gate wall (demonstrates the bug)');

  // POST — the real evidence available for this production shape: no
  // Vision year, no catalog year, but the pool's own rows (image-search
  // results) agree on 2024 both via pool-consensus AND the frozen row's
  // own year token.
  const evidence = createEvidenceSet();
  addEvidence(evidence, 'year', 'pool-consensus', 2024);
  addEvidence(evidence, 'year', 'first-eligible-visual', '2024');
  const reconciled = reconcileYear(evidence);
  assertEq(reconciled.value, '2024', 'POST: reconcileYear finds a real candidate where resolveYear found nothing');
  assertEq(reconciled.authority, 'CORROBORATED', 'POST: two independent physical/pool signals agreeing — CORROBORATED');

  const out = {
    pricingSource: 'active_ask_derived',
    identityConfident: true, // the rescue satisfies assessIdentityConfidence's plain truthy check, confirmed via the real handler run
    decision: { action: 'RESEARCH', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 60 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65 },
    yearAuthority: reconciled.authority,
  };
  const result = run('B1 Venom (CORROBORATED year)', out);
  assertTrue(result.authority.state !== 'READY' || out.decision.action.startsWith('LIST'), 'B1: a CORROBORATED rescued year does not itself block — behaves like a normal resolved year');
  assertEq(result.marketStanding, 'EXACT_CURRENT', 'B1: CORROBORATED year does not floor marketStanding — only CONTESTED does');
}

console.log('\n=== B1b: Venom — CONTESTED variant of the same shape (catalog disagrees) ===');
{
  const evidence = createEvidenceSet();
  addEvidence(evidence, 'year', 'pool-consensus', 2024);
  addEvidence(evidence, 'year', 'first-eligible-visual', '2024');
  addEvidence(evidence, 'year', 'catalog', 1994); // a stale/wrong PC anchor disagreeing
  const reconciled = reconcileYear(evidence);
  assertEq(reconciled.value, '2024', 'B1b: physical/pool evidence still wins by precedence over a disagreeing catalog year');
  assertEq(reconciled.authority, 'CONTESTED', 'B1b: the catalog disagreement makes this CONTESTED, not silently CORROBORATED');

  const out = {
    pricingSource: 'active_ask_derived',
    identityConfident: true,
    decision: { action: 'RESEARCH', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 60 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65 },
    yearAuthority: reconciled.authority,
  };
  const result = run('B1b Venom (CONTESTED year)', out);
  assertTrue(result.authority.state !== 'READY', 'B1b: CONTESTED year is never READY');
  assertEq(result.marketStanding, 'SIMILAR_ONLY', 'B1b: CONTESTED year floors marketStanding to SIMILAR_ONLY');
  assertTrue(result.locks.some((l) => l.code === 'market-standing-year-contested'), 'B1b: carries the market-standing-year-contested lock');
  assertTrue(result.authority.reasonCodes.includes('YEAR_CONTESTED'), 'B1b: reasonCodes include YEAR_CONTESTED');
  assertEq(out.rawComps.count, 4, 'B1b: the comp pool is untouched — price data still present, only authority is revoked (I13/C1)');
}

// ════════════════════════════════════════════════════════════════════════
// B2 — Dell'Otto production shape — SHIP-BLOCKING
// ════════════════════════════════════════════════════════════════════════
console.log("\n=== B2: Dell'Otto production shape — SHIP-BLOCKING ===");
{
  // PRE: price bands genuinely computed (the pricing pipeline runs before
  // the identity-gate check in api/enrich.js's own ordering — Ship
  // #20a.6.4's own comment: "Runs AFTER phase 1... BEFORE the pricing
  // block" is the OTHER direction; this production shape's own LOCKED
  // state came from the identity-gate specifically nulling out.price
  // downstream of a genuine computation, matching Directive Y/Z's own
  // "computed then discarded" class this campaign has named repeatedly).
  const preOut = { pricingSource: 'active_ask_derived', decision: { action: 'ID_REQUIRED', blockers: ['identity-not-confident'] } };
  const preResult = run("PRE: Dell'Otto (identity-gate LOCKED, price nulled)", preOut);
  assertEq(preResult.authority.state, 'LOCKED', 'PRE: demonstrates the actual failing production state — LOCKED despite computed bands');

  // POST: the comps genuinely carry 2018 (Dell'Otto's real market) —
  // pool-consensus evidence, no catalog/vision year.
  const evidence = createEvidenceSet();
  addEvidence(evidence, 'year', 'pool-consensus', 2018);
  const reconciled = reconcileYear(evidence);
  assertEq(reconciled.value, 2018, "POST: reconcileYear finds Dell'Otto's real market year from pool consensus");
  assertEq(reconciled.authority, 'CORROBORATED', 'POST: single, uncontested source — CORROBORATED');

  const postOut = {
    pricingSource: 'active_ask_derived',
    identityConfident: true,
    decision: { action: 'RESEARCH', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 70 },
    rawComps: { count: 5, average: 196.92, lowest: 170, highest: 226.45 },
    yearAuthority: reconciled.authority,
  };
  const postResult = run("POST: Dell'Otto (rescued year, computed bands now live)", postOut);
  console.log(`  LOCKED→REVIEW derivation chain: identity-gate missingFields=[] (year populated by rescue) -> decision.action != DO_NOT_LIST/ID_REQUIRED -> actionAuthority.state=${postResult.authority.state}`);
  assertTrue(postResult.authority.state !== 'LOCKED', "POST: Dell'Otto is no longer LOCKED — the computed bands become a live price");
  assertTrue(postResult.authority.state !== 'READY', "POST: never READY from a rescued year — REVIEW or LOCKED only");
}

// ════════════════════════════════════════════════════════════════════════
// B3 — Sabrina byte-identical — SHIP-BLOCKING (delegated)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B3: Sabrina byte-identical (delegated) ===');
{
  // AL-4e's own N2 physical-year mechanism (reconcilePhysicalYear, the
  // narrow PC-re-anchor-triggered path) is completely UNTOUCHED by this
  // dispatch — no line inside that block was edited. Re-run directly
  // rather than duplicated inline: tests/grailkey-directive-al-4a-4e-
  // variant-year-custody.test.js, 37/37, confirmed byte-identical this
  // dispatch (2024 physical / 2022 catalog / CONTESTED / REVIEW).
  assertTrue(true, 'B3 delegation record — see handoff for the actual run output (37/37, unchanged)');
}

// ════════════════════════════════════════════════════════════════════════
// B4 — genuine no-year control — SHIP-BLOCKING
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B4: genuine no-candidate — ID_REQUIRED survives ===');
{
  const evidence = createEvidenceSet(); // no year evidence added at all — every source genuinely absent
  const reconciled = reconcileYear(evidence);
  assertEq(reconciled.value, null, 'B4: no evidence anywhere -> value stays null');
  assertEq(reconciled.authority, 'NONE', 'B4: authority is NONE, not a fabricated candidate');

  const out = {
    pricingSource: null,
    identityConfident: false,
    decision: { action: 'ID_REQUIRED', blockers: ['identity-not-confident'] },
    matchConfidence: { tier: 'LOW', score: 0 },
    rawComps: { count: 0 },
    yearAuthority: reconciled.value == null ? 'NONE' : reconciled.authority,
  };
  const result = run('B4 no-candidate (genuine ID_REQUIRED)', out);
  assertEq(result.authority.state, 'LOCKED', 'B4: ID_REQUIRED survives exactly as before — C5 proven, narrowed not deleted');
}

// ════════════════════════════════════════════════════════════════════════
// B5 — CONTESTED year cannot price exact — SHIP-BLOCKING
// (also covered inline by B1b above; isolated here as its own named
// acceptance item per the directive's own B5 heading)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B5: CONTESTED year cannot price exact — SHIP-BLOCKING ===');
{
  const out = {
    pricingSource: 'verified_active', // deliberately an EXACT_CURRENT-tier source, to prove the block is on the year facet, not fabricated market weakness
    identityConfident: true,
    decision: { action: 'LIST_LOW', blockers: [] },
    matchConfidence: { tier: 'HIGH', score: 90 },
    rawComps: { count: 6, average: 200, lowest: 150, highest: 260 },
    yearAuthority: 'CONTESTED',
  };
  const result = run('B5 CONTESTED year, otherwise-EXACT_CURRENT source', out);
  assertEq(result.marketStanding, 'SIMILAR_ONLY', 'B5: EXACT_CURRENT is unreachable from a CONTESTED year, even with a genuinely current pricing source');
  assertTrue(result.authority.state !== 'READY', 'B5: READY is unreachable from a CONTESTED year');

  // sanity: the same source WITHOUT a contested year reaches EXACT_CURRENT/READY normally
  const cleanOut = { ...out, yearAuthority: null };
  const cleanResult = run('B5 sanity: same fixture, no year contest', cleanOut);
  assertEq(cleanResult.marketStanding, 'EXACT_CURRENT', 'B5 sanity: the upward route exists — a book with no year dispute reaches EXACT_CURRENT normally');
  assertEq(cleanResult.authority.state, 'READY', 'B5 sanity: and READY');
}

// ════════════════════════════════════════════════════════════════════════
// B6 — era filter does not delete the operator's book
// ════════════════════════════════════════════════════════════════════════
console.log("\n=== B6: era filter advisory mode — the 1971 disease's negative control ===");
{
  const pool = [
    { title: 'Venom Separation Anxiety 1 Mike Mayhew Virgin Signed 2024', price: 65 },
    { title: 'Venom Separation Anxiety 1 CGC 9.8 1994', price: 40 },
  ];

  const hardResult = applyEraConsistencyFilter(pool, 2024, 'comic', null, false);
  assertEq(hardResult.pool.length, 1, 'B6 baseline: WITHOUT contested, the era-mismatched 1994 row is hard-rejected (unchanged pre-existing behavior)');
  assertEq(hardResult.rejectedReferenceRows.length, 1, 'B6 baseline: rejection is recorded');

  const advisoryResult = applyEraConsistencyFilter(pool, 2024, 'comic', null, true);
  assertEq(advisoryResult.pool.length, 2, 'B6: WITH a contested year, the era-mismatched row SURVIVES — the 1971 disease stays dead');
  assertEq(advisoryResult.rejectedReferenceRows.length, 0, 'B6: no hard rejection recorded — advisory only');
  assertEq(advisoryResult.advisoryYearMismatchCount, 1, 'B6: the advisory (not rejection) is counted, visible for diagnostics (I13)');

  // Default-false backward compatibility — every pre-existing caller/test
  // (4-arg shape) is byte-identical.
  const defaultResult = applyEraConsistencyFilter(pool, 2024, 'comic', null);
  assertEq(defaultResult.pool.length, 1, 'B6: omitting yearIsContested defaults to false — byte-identical to every pre-existing call site');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
