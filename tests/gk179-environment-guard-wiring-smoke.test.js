// tests/gk179-environment-guard-wiring-smoke.test.js
//
// GK-179 Handler-Wiring Verification (standing P0 protocol) — this
// dispatch edited acquireConnection() in all three modules
// (src/modules/{assets,auth,valuation}/db.js). Unit proofs of
// assertEnvironmentIdentity()'s own logic
// (tests/gk179-environment-guard-negative-proof.test.js) cannot catch a
// wiring bug in the three call sites themselves. This is the real,
// live, read-only invocation proof: each module's actual
// acquireConnection() is called against real Development, with
// GRAILKEY_CATALOG_ENVIRONMENT correctly set to 'development', and must
// resolve without throwing.
//
// Read-only: acquireConnection() only runs the guard's own SELECT
// against environment_marker; nothing here writes to Development.
// Connections are released/pools closed immediately after.
//
// A13: consumes GRAILKEY_CATALOG_DATABASE_URL blind via process.env
// (populated by --env-file), never reads .env.development.local itself.
//
// Invoke:
//   node --env-file=.env.development.local tests/gk179-environment-guard-wiring-smoke.test.js

process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

let passed = 0, failed = 0;
const failures = [];
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-179 — real acquireConnection() wiring smoke, all 3 modules, real Development, read-only ===\n');

if (!process.env.GRAILKEY_CATALOG_DATABASE_URL) {
  console.log('BLOCKED — VARIABLE NOT SET (GRAILKEY_CATALOG_DATABASE_URL)');
  process.exit(2);
}

const assetsDb = await import('../src/modules/assets/db.js');
const authDb = await import('../src/modules/auth/db.js');
const valuationDb = await import('../src/modules/valuation/db.js');

await assertSucceeds(async () => {
  const client = await assetsDb.acquireConnection();
  client.release();
}, 'assets/db.js acquireConnection() — real guard passes against real Development');

await assertSucceeds(async () => {
  const client = await authDb.acquireConnection();
  client.release();
}, 'auth/db.js acquireConnection() — real guard passes against real Development');

await assertSucceeds(async () => {
  const client = await valuationDb.acquireConnection();
  client.release();
}, 'valuation/db.js acquireConnection() — real guard passes against real Development (dormant module, zero production call sites, wiring still proven)');

await assetsDb.closePool();
await authDb.closePool();
await valuationDb.closePool();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
