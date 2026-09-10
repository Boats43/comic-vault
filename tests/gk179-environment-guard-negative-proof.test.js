// tests/gk179-environment-guard-negative-proof.test.js
//
// GK-179 V3.0 — deterministic negative proof of
// src/lib/environmentGuard.js's assertEnvironmentIdentity().
//
// DELIBERATE DEVIATION FROM "isolated scratch schema/database target":
// assertEnvironmentIdentity()'s SQL is hardcoded to the literal schema
// name `data1_dev.environment_marker` (by design — that name is fixed
// across all three real environments, not parameterized). A truly
// separate scratch SCHEMA cannot also be named `data1_dev` on the same
// Postgres instance without colliding with the real one, and this test
// does not create a new scratch DATABASE or touch Development's own
// data1_dev.environment_marker to manufacture failure states (would
// mean deleting/restoring rows against a real, protected environment
// for a unit-level proof). Instead this proof uses a minimal fake pg
// client — {query: async (sql) => ...} — which exercises exactly the
// same code paths assertEnvironmentIdentity() itself executes (it only
// ever calls client.query(), never anything else), with zero real-
// connection risk and zero cleanup burden. The real, live, read-only
// wiring proof (that a genuine acquireConnection() call against real
// Development succeeds end to end) is separate:
// tests/gk179-environment-guard-wiring-smoke.test.js.
//
// Retained elsewhere, not duplicated here: the structural singleton
// negative proofs (duplicate id=true -> 23505 environment_marker_pkey;
// id=false -> 23514 environment_marker_single_row) already live in
// tests/gk179-environment-marker-migration-contract.test.js (ENV-N1/N2).
//
// Invoke: node tests/gk179-environment-guard-negative-proof.test.js
// (no DB connection required — pure logic proof.)

import { assertEnvironmentIdentity, EnvironmentIdentityError } from '../src/lib/environmentGuard.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-179 V3.0 — environment guard deterministic negative proof ===\n');

const originalEnv = process.env.GRAILKEY_CATALOG_ENVIRONMENT;
function restoreEnv() {
  if (originalEnv === undefined) delete process.env.GRAILKEY_CATALOG_ENVIRONMENT;
  else process.env.GRAILKEY_CATALOG_ENVIRONMENT = originalEnv;
}

function makeFakeClient(behavior) {
  let queryCalls = 0;
  const client = {
    query: async (sql) => {
      queryCalls++;
      return behavior(sql);
    },
    get queryCallCount() { return queryCalls; },
  };
  return client;
}

async function expectFailClosed(label, envValue, clientBehavior, expectedReason, expectDbTouched) {
  if (envValue === undefined) delete process.env.GRAILKEY_CATALOG_ENVIRONMENT;
  else process.env.GRAILKEY_CATALOG_ENVIRONMENT = envValue;
  const client = clientBehavior ? makeFakeClient(clientBehavior) : { query: async () => { throw new Error('client.query should not have been called'); } };
  try {
    await assertEnvironmentIdentity(client);
    failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m);
  } catch (e) {
    const isRightType = e instanceof EnvironmentIdentityError;
    const isRightReason = e.reason === expectedReason;
    const dbTouchedOk = expectDbTouched === undefined || (client.queryCallCount > 0) === expectDbTouched;
    if (isRightType && isRightReason && dbTouchedOk) {
      passed++; console.log(`  ✓ ${label} (FAIL CLOSED: reason=${e.reason})`);
    } else {
      failed++;
      const m = `  ✗ ${label} (wrong shape: type=${e.constructor.name}, reason=${e.reason}, expected=${expectedReason}, queryCalled=${client.queryCallCount > 0})`;
      failures.push(m); console.log(m);
    }
  }
}

// ---------------------------------------------------------------------
// Case 1 — matching marker -> PASS
// ---------------------------------------------------------------------
{
  process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
  const client = makeFakeClient(() => ({ rowCount: 1, rows: [{ app_env: 'development' }] }));
  try {
    const result = await assertEnvironmentIdentity(client);
    assertTrue(result === 'development', 'matching marker -> PASS, resolves with the matched value');
  } catch (e) {
    failed++; const m = `  ✗ matching marker -> PASS (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m);
  }
}

// ---------------------------------------------------------------------
// Case 2 — missing marker table -> FAIL CLOSED (simulated 42P01)
// ---------------------------------------------------------------------
await expectFailClosed(
  'missing marker table',
  'development',
  () => { const e = new Error('relation "environment_marker" does not exist'); e.code = '42P01'; throw e; },
  'MARKER_QUERY_ERROR'
);

// ---------------------------------------------------------------------
// Case 3 — empty marker -> FAIL CLOSED
// ---------------------------------------------------------------------
await expectFailClosed(
  'empty marker',
  'development',
  () => ({ rowCount: 0, rows: [] }),
  'MARKER_EMPTY'
);

// ---------------------------------------------------------------------
// Case 4 — wrong app_env -> FAIL CLOSED
// ---------------------------------------------------------------------
await expectFailClosed(
  'wrong app_env (expected development, marker says preview)',
  'development',
  () => ({ rowCount: 1, rows: [{ app_env: 'preview' }] }),
  'MARKER_MISMATCH'
);

// ---------------------------------------------------------------------
// Case 5 — unexpected multiple-row state -> FAIL CLOSED (defensive; the
// singleton constraint should make this unreachable, but the guard must
// not treat it as undefined behavior if it somehow occurs)
// ---------------------------------------------------------------------
await expectFailClosed(
  'unexpected multiple marker rows',
  'development',
  () => ({ rowCount: 2, rows: [{ app_env: 'development' }, { app_env: 'development' }] }),
  'MARKER_MULTIPLE_ROWS'
);

// ---------------------------------------------------------------------
// Case 6 — unset expected environment -> FAIL CLOSED, DB never touched
// ---------------------------------------------------------------------
await expectFailClosed(
  'unset GRAILKEY_CATALOG_ENVIRONMENT',
  undefined,
  null,
  'EXPECTED_ENV_UNSET',
  false // expectDbTouched: false -- must fail before ever calling client.query
);

// ---------------------------------------------------------------------
// Case 7 — invalid expected environment -> FAIL CLOSED, DB never touched
// ---------------------------------------------------------------------
await expectFailClosed(
  'invalid GRAILKEY_CATALOG_ENVIRONMENT ("staging")',
  'staging',
  null,
  'EXPECTED_ENV_INVALID',
  false
);

// ---------------------------------------------------------------------
// Case 8 — connection/permission error during identity verification
// -> FAIL CLOSED
// ---------------------------------------------------------------------
await expectFailClosed(
  'connection/permission error mid-query',
  'development',
  () => { throw new Error('permission denied for schema data1_dev'); },
  'MARKER_QUERY_ERROR'
);

restoreEnv();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
