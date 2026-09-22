// tests/gk241-buyer-marketstanding-vocabulary.test.js
//
// GK-241 hotfix — src/modules/buyer/service.js's marketStanding
// validation previously maintained its own separate, hand-copied
// whitelist (['EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY']) that
// drifted from deriveMarketStanding's real output set (missing
// FALLBACK_ONLY/NONE, then GK-238's NO_SOLD_EVIDENCE) — rejecting real
// Production Buyer Decisions for those standings. Fixed by importing the
// single shared constant, src/lib/actionAuthority.js's own new
// MARKET_STANDING_VALUES export, instead of re-copying its values.
//
// Real, live proof against real Development data1_dev (mirrors
// tests/buyer-decision-service-live-proof.test.js's own established
// convention exactly) — this file additionally empirically checks
// whether the real database write succeeds end-to-end for every value,
// not just whether the service-layer validation accepts it, since a
// separate DB-level CHECK constraint on buyer_decision_event.market_standing
// is a distinct gate from the JS-level requireEnum this hotfix touches.
//
// Invoke: node tests/gk241-buyer-marketstanding-vocabulary.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const buyer = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'buyer', 'index.js')).href);
const { ValidationFailedError } = buyer;
const { MARKET_STANDING_VALUES, deriveMarketStanding } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'actionAuthority.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEq = (actual, expected, label) => assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
const assertRejected = async (fn, ErrClass, label) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = e instanceof ErrClass;
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.constructor.name}: ${e.message.slice(0, 100)})`); }
    else { failed++; const m = `  ✗ ${label} (wrong error type: ${e.constructor.name}: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== GK-241 — Buyer marketStanding vocabulary (real live proof, Development data1_dev) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the shared constant itself, DIRECT, no DB.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: MARKET_STANDING_VALUES completeness (DIRECT)\n');
{
  assertEq(MARKET_STANDING_VALUES.length, 6, 'exactly 6 values exported');
  for (const v of ['EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY', 'FALLBACK_ONLY', 'NO_SOLD_EVIDENCE', 'NONE']) {
    assertTrue(MARKET_STANDING_VALUES.includes(v), `MARKET_STANDING_VALUES includes ${v}`);
  }
  // Cross-check: every fixture from GK-238's own test suite reproduces a
  // value that's a member of the exported constant — proves the constant
  // isn't just a static list that happens to match by coincidence, it's
  // checked against the REAL function's real behavior across its known
  // branch set.
  const fixtures = [
    { pricingSource: 'verified_sold_recency', soldCompDiagnostics: { rawCount: 5, verifiedCount: 5, newestDaysAgo: 5 } }, // EXACT_CURRENT
    { pricingSource: 'verified_sold_stale' }, // EXACT_STALE
    { pricingSource: 'visual_pool_fallback' }, // SIMILAR_ONLY
    { pricingSource: 'pc_estimate' }, // FALLBACK_ONLY
    { pricingSource: 'active_ask_derived', soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 } }, // NO_SOLD_EVIDENCE
    { pricingSource: null }, // NONE
  ];
  for (const f of fixtures) {
    const v = deriveMarketStanding(f);
    assertTrue(MARKET_STANDING_VALUES.includes(v), `deriveMarketStanding(${JSON.stringify(f)}) = ${v}, a real member of MARKET_STANDING_VALUES`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — service-layer validation accepts every value + rejects an
// unknown one, DIRECT (isolates requireEnum, which runs BEFORE
// acquireConnection — no DB connection needed for this half).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: service-layer requireEnum, isolated from the DB write (DIRECT)\n');
{
  // A deliberately-invalid principalId makes appendBuyerDecision fail at
  // assertPrincipalActive — AFTER requireEnum already ran. So: if the
  // marketStanding value itself is invalid, the error is
  // ValidationFailedError with a marketStanding-naming message BEFORE any
  // DB call; if the marketStanding value is valid, the error (still
  // thrown, since principalId is garbage) will be AuthorizationFailedError
  // instead — proving requireEnum passed. This isolates the ONE thing
  // this hotfix touches without needing a real DB write for every case.
  const baseArgs = {
    principalId: '00000000-0000-0000-0000-000000000000', // syntactically valid UUID, not a real principal
    sessionId: crypto.randomUUID(),
    marketValueAmount: 10, contemplatedPriceAmount: 5,
    feePct: 10, suppliesAmount: 1, laborAmount: 1, targetProfitAmount: 1,
    decision: 'PASS',
  };
  for (const v of MARKET_STANDING_VALUES) {
    try {
      await buyer.appendBuyerDecision({ ...baseArgs, marketStanding: v });
      failed++; console.log(`  ✗ marketStanding=${v}: expected rejection (bad principal), got success`); failures.push(`marketStanding=${v} unexpected success`);
    } catch (e) {
      const isEnumRejection = e instanceof ValidationFailedError && /marketStanding/.test(e.message);
      assertTrue(!isEnumRejection, `marketStanding=${v} passes requireEnum (fails later, on principal, not on the enum: ${e.constructor.name})`);
    }
  }
  await assertRejected(
    () => buyer.appendBuyerDecision({ ...baseArgs, marketStanding: 'TOTALLY_MADE_UP_VALUE' }),
    ValidationFailedError,
    'a genuinely unknown marketStanding string is still rejected'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — REAL live writes, real Development data1_dev, real
// gk_principal, real rows, cleaned up after. This is the actual
// end-to-end proof: does the value round-trip through the real DB row,
// not just past the JS-level check.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: REAL live writes against real Development data1_dev\n');

const preflightClient = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'gk241-buyer-marketstanding-vocabulary' });
const principalRow = (await preflightClient.query('SELECT id FROM data1_dev.gk_principal LIMIT 1')).rows[0];
if (!principalRow) throw new Error('No real gk_principal row exists in Development — cannot run a live proof without one.');
const principalId = principalRow.id;
console.log(`  using real existing gk_principal: ${principalId}\n`);

const createdDecisionIds = [];

try {
  for (const marketStanding of MARKET_STANDING_VALUES) {
    const idempotencyKey = `gk241-${marketStanding}-${crypto.randomUUID()}`;
    try {
      const result = await buyer.appendBuyerDecision({
        principalId, sessionId: crypto.randomUUID(),
        observedTitle: 'GK-241 Test Fixture', observedIssue: '1', observedPublisher: 'Test',
        marketValueAmount: 20, contemplatedPriceAmount: 10,
        feePct: 10, suppliesAmount: 1, laborAmount: 1, targetProfitAmount: 5,
        maxBuyAmount: 12, netProfitAmount: 3,
        decision: 'PASS',
        pricingSource: 'test', priceBandsSource: 'test', marketStanding,
        idempotencyKey,
      });
      if (result?.buyerDecisionEventId) {
        createdDecisionIds.push(result.buyerDecisionEventId);
        assertTrue(true, `marketStanding=${marketStanding} writes a real durable row end-to-end (id: ${result.buyerDecisionEventId})`);
      } else {
        assertTrue(false, `marketStanding=${marketStanding} writes a real durable row end-to-end (no id returned)`);
      }
    } catch (e) {
      assertTrue(false, `marketStanding=${marketStanding} writes a real durable row end-to-end (THREW: ${e.constructor.name}: ${e.message})`);
    }
  }

  // Regression guard — a pre-existing, already-whitelisted standing still works.
  const regressionKey = `gk241-regression-EXACT_CURRENT-${crypto.randomUUID()}`;
  const regressionResult = await buyer.appendBuyerDecision({
    principalId, sessionId: crypto.randomUUID(),
    marketValueAmount: 100, contemplatedPriceAmount: 45,
    feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
    decision: 'BUY',
    pricingSource: 'verified_sold_recency', marketStanding: 'EXACT_CURRENT',
    idempotencyKey: regressionKey,
  });
  if (regressionResult?.buyerDecisionEventId) createdDecisionIds.push(regressionResult.buyerDecisionEventId);
  assertTrue(!!regressionResult?.buyerDecisionEventId, 'REGRESSION GUARD: previously-valid EXACT_CURRENT still writes successfully');

} finally {
  console.log(`\n  cleaning up ${createdDecisionIds.length} test rows...`);
  for (const id of createdDecisionIds) {
    await preflightClient.query('DELETE FROM data1_dev.buyer_decision_event WHERE id = $1', [id]);
  }
  await preflightClient.end();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
