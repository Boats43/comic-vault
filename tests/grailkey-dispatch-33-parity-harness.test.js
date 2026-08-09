// tests/grailkey-dispatch-33-parity-harness.test.js
//
// GrailKey Dispatch 33 (2026-08-08) — the parity-test harness for a
// future fast lane / shadow architecture. BINDING CONTRACT, read before
// adding a case:
//
//   MUST MATCH: identity, variant, compPool, price, decision, warnings.
//   ALLOWED TO DIFFER: timing, instrumentation, latency, cost,
//     correlationId — nothing else.
//   ANYTHING ELSE THAT DIFFERS IS A FAIL. No exceptions, no "close
//     enough." A new architecture that can't reproduce the legacy path's
//     answer on these six fields has contaminated the fallback —
//     Invariant 1 (Monotonic Evidence Extension), see
//     docs/PATTERN-LIBRARY.md "GrailKey Dispatch 33".
//
// Shipped as an empty stub ON PURPOSE, before any shadow lane exists —
// per explicit instruction: an empty harness with a documented contract
// forces the next phase's shadow mode to have a gate that already
// exists. Building it after the shadow lane exists means building it to
// fit what was already written — that is how parity tests become
// theater.
//
// Zero cases is a LOUD SKIP, not a pass — same reasoning as this
// project's other intentionally-red suites (see the "Known stale test
// suites" baseline in CLAUDE.md): an unexplained green reads as coverage
// to a future session, and there is no coverage here yet. This file
// exits non-zero and prints an explicit SKIP banner for as long as
// `cases` is empty. It only starts reporting real pass/fail once a
// future shadow lane adds its first case.
//
// Invoke: node tests/grailkey-dispatch-33-parity-harness.test.js

const CHECKED_KEYS = ['identity', 'variant', 'compPool', 'price', 'decision', 'warnings'];
const DEFAULT_ALLOWED_DIFF_KEYS = ['timing', 'instrumentation', 'latency', 'cost', 'correlationId'];

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
};

/**
 * Compares a legacy-path result against a new-architecture result for
 * one frozen case. MUST match on CHECKED_KEYS; anything outside
 * allowedDiffKeys that differs is ALSO a hard fail — this catches drift
 * outside the six named fields, not just mismatches inside them.
 *
 * @param {object} legacyResult
 * @param {object} newResult
 * @param {{allowedDiffKeys?: string[]}} [opts]
 * @returns {{pass: boolean, mismatches: string[]}}
 */
export const assertParity = (legacyResult, newResult, opts = {}) => {
  const allowedDiffKeys = opts.allowedDiffKeys || DEFAULT_ALLOWED_DIFF_KEYS;
  const mismatches = [];

  for (const key of CHECKED_KEYS) {
    if (!deepEqual(legacyResult?.[key], newResult?.[key])) mismatches.push(key);
  }

  const allKeys = new Set([
    ...Object.keys(legacyResult || {}),
    ...Object.keys(newResult || {}),
  ]);
  for (const key of allKeys) {
    if (CHECKED_KEYS.includes(key) || allowedDiffKeys.includes(key)) continue;
    if (!deepEqual(legacyResult?.[key], newResult?.[key])) mismatches.push(key);
  }

  return { pass: mismatches.length === 0, mismatches: [...new Set(mismatches)] };
};

let passed = 0;
let failed = 0;

console.log('\n=== GrailKey Dispatch 33 — parity harness (stub) ===\n');

// No shadow lane exists yet (this dispatch's own constraint: "No routing
// change. No new lanes."). `cases` is deliberately empty — the correct
// state for Week 1, not a placeholder that got forgotten. Each future
// case is { label, legacy, next, allowedDiffKeys? }.
const cases = [];

if (cases.length === 0) {
  console.log('  ⚠️  SKIP — 0 cases. No shadow lane exists yet to compare against.');
  console.log('  This is NOT a passing gate and must not be read as coverage —');
  console.log('  it becomes real the moment a future shadow lane adds its first case.');
  console.log('\n0 passed, 0 failed, 1 skipped (exit code reflects SKIP, not PASS)\n');
  process.exitCode = 1;
} else {
  for (const { label, legacy, next, allowedDiffKeys } of cases) {
    const { pass, mismatches } = assertParity(legacy, next, { allowedDiffKeys });
    if (pass) {
      passed++;
      console.log(`  ✓ ${label}`);
    } else {
      failed++;
      console.log(`  ✗ ${label}\n    mismatched keys: ${mismatches.join(', ')}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
