// tests/d4-identifier-fabric-retry-unit.test.js
//
// D4 Phase B, B7/B7a -- deterministic unit tests of the retry ALGORITHM
// itself (src/modules/assets/retry.js's withRetryOn40P01), fully
// isolated from any real database connection. Complements, and does NOT
// substitute for, the live proof (tests/d4-identifier-fabric-live-
// concurrency.test.js) that a genuine Postgres-generated 40P01 actually
// reaches this code through the real transaction boundary — B7a is
// explicit that unit-branch coverage alone is insufficient; this file
// is the deterministic half of that two-part requirement, not the whole
// of it.
//
// Invoke: node tests/d4-identifier-fabric-retry-unit.test.js

import { withRetryOn40P01, RETRYABLE_SQLSTATES } from '../src/modules/assets/retry.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D4 Phase B -- retry algorithm unit tests (deterministic, no DB) ===\n');

const fakeError = (code, message = 'fake error') => Object.assign(new Error(message), { code });

// --- 40P01 -> transaction retried ---
{
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw fakeError('40P01', 'first attempt deadlocked');
    return { ok: true, calls };
  };
  const result = await withRetryOn40P01(fn);
  assertTrue(calls === 2, '40P01 on attempt 1 -> function called a 2nd time (retried)');
  assertTrue(result.ok === true && result.calls === 2, '40P01 then success -> succeeds on the 2nd attempt, correct result returned');
}

// --- nonretryable constraint error -> not retried ---
{
  let calls = 0;
  const fn = async () => {
    calls++;
    throw fakeError('23503', 'foreign key violation');
  };
  let threw = null;
  try { await withRetryOn40P01(fn); } catch (e) { threw = e; }
  assertTrue(calls === 1, 'nonretryable FK violation (23503) -> function called exactly ONCE, not retried');
  assertTrue(threw?.code === '23503', 'the original FK violation error propagates unchanged');
}

// --- semantic rejection (P0001, e.g. "already superseded") -> not retried ---
{
  let calls = 0;
  const fn = async () => {
    calls++;
    throw fakeError('P0001', 'asset_identifier_assertion id=x is already superseded');
  };
  let threw = null;
  try { await withRetryOn40P01(fn); } catch (e) { threw = e; }
  assertTrue(calls === 1, 'P0001 "already superseded" rejection -> function called exactly ONCE, not retried');
  assertTrue(threw?.code === 'P0001', 'the original P0001 rejection propagates unchanged');
}

// --- retry exhaustion -> surfaced cleanly ---
{
  let calls = 0;
  const fn = async () => {
    calls++;
    throw fakeError('40P01', `deadlock on attempt ${calls}`);
  };
  let threw = null;
  try { await withRetryOn40P01(fn, { maxAttempts: 3 }); } catch (e) { threw = e; }
  assertTrue(calls === 3, 'repeated 40P01 -> exactly maxAttempts (3) calls made, no infinite loop');
  assertTrue(threw?.code === '40P01' && threw?.message.includes('attempt 3'), 'exhaustion surfaces the LAST attempt\'s real error cleanly, not a generic wrapper error');
}

// --- ordinary supersession -> one attempt ---
{
  let calls = 0;
  const fn = async () => { calls++; return { ok: true }; };
  const result = await withRetryOn40P01(fn);
  assertTrue(calls === 1, 'no error at all -> function called exactly ONCE');
  assertTrue(result.ok === true, 'result returned correctly on the ordinary, uncontended path');
}

// --- error with no .code at all (e.g. a plain thrown Error) -> not retried ---
{
  let calls = 0;
  const fn = async () => { calls++; throw new Error('plain error, no SQLSTATE'); };
  let threw = null;
  try { await withRetryOn40P01(fn); } catch (e) { threw = e; }
  assertTrue(calls === 1, 'an error with no .code at all is never mistaken for retryable -- called exactly ONCE');
  assertTrue(threw?.message === 'plain error, no SQLSTATE', 'original error propagates unchanged');
}

assertTrue(RETRYABLE_SQLSTATES.length === 1 && RETRYABLE_SQLSTATES[0] === '40P01', 'RETRYABLE_SQLSTATES is exactly [\'40P01\'] -- no broader retry framework, scoped narrowly as ruled (B7)');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) { console.log('FAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
