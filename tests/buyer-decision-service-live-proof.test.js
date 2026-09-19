// tests/buyer-decision-service-live-proof.test.js
//
// GRAILKEY — DURABLE BUYER DECISION LEDGER V1. Real, live proof against
// real Development data1_dev (src/modules/buyer/, through its own
// public index.js — never a reimplementation). Not a scratch schema
// this time — 0027 is now really applied to data1_dev (see
// scripts/apply-0027-buyer-decision-ledger-development.mjs's own
// console output for the before/after census) — so this test exercises
// the REAL service against the REAL table, using a REAL existing
// gk_principal row. All rows this test creates are deleted in a finally
// block (transient test writes only — buyer decisions are meant to be
// precious durable data; this test's own synthetic numbers are not real
// economic history and must not pollute it). Safe to rerun indefinitely.
//
// Invoke: node tests/buyer-decision-service-live-proof.test.js

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
const { IdempotencyConflictError } = buyer;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, ErrClass, label) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = e instanceof ErrClass;
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.constructor.name}: ${e.message.slice(0, 100)})`); }
    else { failed++; const m = `  ✗ ${label} (wrong error type: ${e.constructor.name}: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== Buyer Decision service — real live proof against real Development data1_dev ===\n');

// Preflight, same fail-closed gate every admin/proof script uses.
const preflightClient = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'buyer-decision-service-live-proof' });
const principalRow = (await preflightClient.query('SELECT id FROM data1_dev.gk_principal LIMIT 1')).rows[0];
if (!principalRow) throw new Error('No real gk_principal row exists in Development — cannot run a live proof without one.');
const principalId = principalRow.id;
console.log(`  using real existing gk_principal: ${principalId}\n`);

const createdDecisionIds = [];
const createdAcquisitionIds = [];

try {
  const sessionId = crypto.randomUUID();

  // -------------------------------------------------------------------
  // BUY case
  // -------------------------------------------------------------------
  console.log('-- BUY case --\n');
  const buyKey = `live-proof-buy-${crypto.randomUUID()}`;
  const buyResult = await buyer.appendBuyerDecision({
    principalId, sessionId,
    observedTitle: 'Amazing Spider-Man', observedIssue: '300', observedPublisher: 'Marvel', observedYear: '1988', observedGrade: 'CGC 9.4',
    marketValueAmount: 100, marketValueCurrency: 'USD',
    contemplatedPriceAmount: 45,
    feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
    maxBuyAmount: 57, netProfitAmount: 12,
    decision: 'BUY',
    pricingSource: 'verified_sold_recency', priceBandsSource: 'tier1_recency_weighted', marketStanding: 'EXACT_CURRENT',
    soldCompCount: 16, activeCompCount: 4, totalCompCount: 16, verifiedCompCount: null,
    matchConfidenceTier: 'HIGH', matchConfidenceScore: 82.5,
    idempotencyKey: buyKey,
  });
  assertTrue(!!buyResult.buyerDecisionEventId, 'appendBuyerDecision(BUY) returns a real durable id');
  createdDecisionIds.push(buyResult.buyerDecisionEventId);

  // Idempotency: identical retry (same key, same payload) replays, no new row
  const buyRetry = await buyer.appendBuyerDecision({
    principalId, sessionId,
    observedTitle: 'Amazing Spider-Man', observedIssue: '300', observedPublisher: 'Marvel', observedYear: '1988', observedGrade: 'CGC 9.4',
    marketValueAmount: 100, marketValueCurrency: 'USD',
    contemplatedPriceAmount: 45,
    feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
    maxBuyAmount: 57, netProfitAmount: 12,
    decision: 'BUY',
    idempotencyKey: buyKey,
  });
  assertTrue(buyRetry.buyerDecisionEventId === buyResult.buyerDecisionEventId, 'a network-retry with the SAME idempotencyKey + SAME payload replays the original id — no duplicate row (mobile/retry-safety proof)');

  // Idempotency conflict: same key, DIFFERENT payload -> rejected, not silently accepted
  await assertRejected(
    () => buyer.appendBuyerDecision({
      principalId, sessionId,
      marketValueAmount: 999, contemplatedPriceAmount: 45,
      feePct: 10, suppliesAmount: 3, laborAmount: 5, targetProfitAmount: 25,
      decision: 'BUY',
      idempotencyKey: buyKey, // SAME key, different marketValueAmount
    }),
    IdempotencyConflictError,
    'the SAME idempotencyKey with a DIFFERENT semantic payload is rejected, never silently accepted as a new fact'
  );

  // -------------------------------------------------------------------
  // PASS case — the directive's own worked example
  // -------------------------------------------------------------------
  console.log('\n-- PASS case (MAX BUY $44 < seller ask $60) --\n');
  const passKey = `live-proof-pass-${crypto.randomUUID()}`;
  const passSessionId = crypto.randomUUID();
  const passResult = await buyer.appendBuyerDecision({
    principalId, sessionId: passSessionId,
    observedTitle: 'Incredible Hulk', observedIssue: '273', observedPublisher: 'Marvel', observedYear: '1982', observedGrade: 'raw VF',
    marketValueAmount: 69, marketValueCurrency: 'USD',
    contemplatedPriceAmount: 60,
    feePct: 10, suppliesAmount: 2, laborAmount: 4, targetProfitAmount: 20,
    maxBuyAmount: 44, netProfitAmount: -20,
    decision: 'PASS',
    pricingSource: 'active_ask_derived', priceBandsSource: 'tier3_active_discounted', marketStanding: 'SIMILAR_ONLY',
    soldCompCount: 0, activeCompCount: 1, totalCompCount: 1, verifiedCompCount: null,
    matchConfidenceTier: 'LOW', matchConfidenceScore: 40,
    idempotencyKey: passKey,
  });
  assertTrue(!!passResult.buyerDecisionEventId, 'appendBuyerDecision(PASS) is durably recorded — a PASS is not a no-op');
  createdDecisionIds.push(passResult.buyerDecisionEventId);

  // -------------------------------------------------------------------
  // Acquisition — later, independent, non-mutating
  // -------------------------------------------------------------------
  console.log('\n-- Acquisition event (actual $42, vs. $45 originally contemplated) --\n');
  const acqKey = `live-proof-acq-${crypto.randomUUID()}`;
  const acqResult = await buyer.appendBuyerAcquisition({
    principalId, buyerDecisionEventId: buyResult.buyerDecisionEventId,
    actualPurchasePriceAmount: 42, actualPurchaseCurrency: 'USD',
    idempotencyKey: acqKey,
  });
  assertTrue(!!acqResult.buyerAcquisitionEventId, 'appendBuyerAcquisition returns a real durable id');
  createdAcquisitionIds.push(acqResult.buyerAcquisitionEventId);

  const acqRetry = await buyer.appendBuyerAcquisition({
    principalId, buyerDecisionEventId: buyResult.buyerDecisionEventId,
    actualPurchasePriceAmount: 42, actualPurchaseCurrency: 'USD',
    idempotencyKey: acqKey,
  });
  assertTrue(acqRetry.buyerAcquisitionEventId === acqResult.buyerAcquisitionEventId, 'a retried acquisition write with the same idempotencyKey replays, no duplicate');

  await assertRejected(
    () => buyer.appendBuyerAcquisition({ principalId, buyerDecisionEventId: crypto.randomUUID(), actualPurchasePriceAmount: 1, idempotencyKey: crypto.randomUUID() }),
    buyer.NotFoundError,
    'appendBuyerAcquisition against a nonexistent buyer_decision_event_id is rejected'
  );

  // -------------------------------------------------------------------
  // Read: listBuyerDecisions returns both, with real acquisitions attached
  // -------------------------------------------------------------------
  console.log('\n-- listBuyerDecisions --\n');
  const history = await buyer.listBuyerDecisions({ principalId, limit: 200 });
  const buyRow = history.find((d) => d.id === buyResult.buyerDecisionEventId);
  const passRow = history.find((d) => d.id === passResult.buyerDecisionEventId);
  assertTrue(!!buyRow, 'the BUY decision is present in listBuyerDecisions history');
  assertTrue(!!passRow, 'the PASS decision is present in listBuyerDecisions history — PASS is not excluded from history');
  assertTrue(Number(buyRow.contemplated_price_amount) === 45, 'BUY row\'s original contemplated price ($45) is unchanged after recording a $42 actual acquisition');
  assertTrue(Number(buyRow.max_buy_amount) === 57, 'BUY row\'s original MAX BUY ($57) is unchanged after recording the acquisition');
  assertTrue(buyRow.decision === 'BUY', 'BUY row\'s original decision is unchanged after recording the acquisition');
  assertTrue(Array.isArray(buyRow.acquisitions) && buyRow.acquisitions.length === 1, `BUY row carries exactly 1 attached acquisition (found ${buyRow.acquisitions?.length})`);
  assertTrue(Number(buyRow.acquisitions[0].actual_purchase_price_amount) === 42, 'the attached acquisition shows the real actual purchase price ($42)');
  assertTrue(Array.isArray(passRow.acquisitions) && passRow.acquisitions.length === 0, 'PASS row carries zero acquisitions — none required, none fabricated');
  assertTrue(Number(passRow.max_buy_amount) === 44 && Number(passRow.contemplated_price_amount) === 60, 'PASS row preserves MAX BUY ($44) and seller ask ($60) — the directive\'s own worked example, fully durable');

  // -------------------------------------------------------------------
  // Authorization: a stranger principal cannot append an acquisition
  // against this operator's decision (single-operator today, but the
  // check is real and enforced, not a rubber stamp).
  // -------------------------------------------------------------------
  console.log('\n-- Authorization --\n');
  const strangerId = crypto.randomUUID(); // not a real gk_principal row
  await assertRejected(
    () => buyer.appendBuyerAcquisition({ principalId: strangerId, buyerDecisionEventId: buyResult.buyerDecisionEventId, actualPurchasePriceAmount: 1, idempotencyKey: crypto.randomUUID() }),
    buyer.AuthorizationFailedError,
    'a principalId that does not resolve to a real gk_principal row is rejected before any row is touched'
  );

} finally {
  // Cleanup — real transient writes, deleted here so this test's synthetic
  // numbers never sit in the real, precious buyer-decision economic ledger.
  for (const id of createdAcquisitionIds) {
    await preflightClient.query('DELETE FROM data1_dev.buyer_acquisition_event WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdDecisionIds) {
    await preflightClient.query('DELETE FROM data1_dev.buyer_decision_event WHERE id = $1', [id]).catch(() => {});
  }
  console.log(`\n  cleaned up ${createdAcquisitionIds.length} acquisition row(s) and ${createdDecisionIds.length} decision row(s) this test created`);
  await preflightClient.end();
  await buyer.closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
