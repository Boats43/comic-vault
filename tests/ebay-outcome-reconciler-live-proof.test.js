// tests/ebay-outcome-reconciler-live-proof.test.js
//
// GRAILKEY AUTOMATIC EBAY OUTCOME RECONCILER V1 — real, live proof
// against real Development data1_dev, through the real reconcileEbayOutcome()
// (src/lib/ebayOutcomeReconciler.js), the real assets module writers, and
// the real predictionErrorScoring.js scorer. Only global.fetch is mocked
// (deterministic eBay Fulfillment/Finances fixtures) — we are NOT
// listing or selling a real book to test this. Every scenario below is
// mapped from the dispatch's own required fixture list: valid sale, no
// order, cancelled order, paid order, delayed financial transaction,
// fee, refund, repeated poll, reordered transactions, partial economics,
// and a dedicated partial-refund-vs-full-refund proof.
//
// Real transient rows are created (on a real, existing, non-Creepy
// Development asset) and deleted in a finally block. Creepy's own real
// DELISTED history is used ONLY to prove it can never become SOLD by
// this reconciler — never converted, never touched.
//
// Invoke: node tests/ebay-outcome-reconciler-live-proof.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { reconcileEbayOutcome } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayOutcomeReconciler.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

// Real gk_principal / real, existing, NOT-Creepy gk_asset in Development
// (confirmed live via current_owner before writing this test).
const TEST_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TEST_ASSET_ID = '01a0283b-a0f2-7bfb-bdf2-d565824fc4e9';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CREEPY_LISTING_ID = '366665728633';

// ── Mock fetch — dispatches by URL shape, no real network call ever. ──
let scenario = null;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/sell/fulfillment/v1/order')) {
    return { ok: true, status: 200, json: async () => ({ orders: scenario?.order ? [scenario.order] : [] }) };
  }
  if (u.includes('/sell/finances/v1/transaction')) {
    return { ok: true, status: 200, json: async () => ({ transactions: scenario?.transactions || [] }) };
  }
  return { ok: false, status: 404, statusText: 'unmocked URL', json: async () => ({ errors: [{ message: `unmocked URL: ${u}` }] }) };
};

const createdOutcomeEventIds = [];
let createdValuationEventId = null;

async function createTransientListedRow(externalListingId, askAmount = 100) {
  const result = await assets.recordOutcomeEvent({
    principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID,
    outcomeType: 'LISTED', channel: 'ebay', externalListingId,
    askAmount, askCurrency: 'USD',
    idempotencyKey: `reconciler-test-listed-${crypto.randomUUID()}`,
  });
  createdOutcomeEventIds.push(result.outcomeEventId);
  return result.outcomeEventId;
}

function saleTxn({ id, orderId, amount, feeAmount, date }) {
  return {
    transactionId: id, transactionType: 'SALE', orderId, transactionDate: date || '2026-10-01T00:00:00.000Z',
    amount: { value: String(amount), currency: 'USD' },
    orderLineItems: feeAmount != null ? [{ marketplaceFee: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: String(feeAmount) } }] }] : [],
  };
}
function refundTxn({ id, orderId, amount, date }) {
  return { transactionId: id, transactionType: 'REFUND', orderId, transactionDate: date || '2026-10-05T00:00:00.000Z', amount: { value: String(amount), currency: 'USD' } };
}
function fixtureOrder({ orderId, itemId, paymentStatus = 'PAID', cancelState = 'NONE_REQUESTED', total }) {
  return {
    orderId, creationDate: '2026-10-01T00:00:00.000Z',
    orderPaymentStatus: paymentStatus, cancelStatus: { cancelState },
    lineItems: [{ legacyItemId: itemId }],
    ...(total != null ? { pricingSummary: { total: { value: String(total), currency: 'USD' } } } : {}),
  };
}

console.log('\n=== eBay Outcome Reconciler — real live proof (real Development, mocked eBay only) ===\n');

try {
  // Real transient valuation_event for TEST_ASSET_ID — needed for the
  // SCORED predictionError path below.
  const val = await assets.recordValuation({
    principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID,
    valueAmount: 61.41, method: 'engine-computed', buildSha: 'reconciler-test',
    idempotencyKey: `reconciler-test-valuation-${crypto.randomUUID()}`,
  });
  createdValuationEventId = val.valuationEventId;

  // ===================================================================
  // 1. NO ORDER
  // ===================================================================
  console.log('-- No order --\n');
  {
    const itemId = `test-reconciler-noorder-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId);
    scenario = { order: null };
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(r.status === 'NO_ORDER_YET', `no matching order -> NO_ORDER_YET (got ${r.status})`);
  }

  // ===================================================================
  // 2. CANCELLED ORDER
  // ===================================================================
  console.log('\n-- Cancelled order --\n');
  {
    const itemId = `test-reconciler-cancelled-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId);
    scenario = { order: fixtureOrder({ orderId: `O-CANCEL-${crypto.randomUUID()}`, itemId, paymentStatus: 'PAID', cancelState: 'CANCEL_CLOSED' }) };
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(r.status === 'CANCELLED_NOT_SOLD', `a cancelled order never becomes SOLD (got ${r.status})`);
  }

  // ===================================================================
  // 3. AMBIGUOUS PAYMENT STATE (PENDING)
  // ===================================================================
  console.log('\n-- Ambiguous payment state --\n');
  {
    const itemId = `test-reconciler-ambiguous-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId);
    scenario = { order: fixtureOrder({ orderId: `O-PEND-${crypto.randomUUID()}`, itemId, paymentStatus: 'PENDING' }) };
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(r.status === 'AMBIGUOUS_NOT_SOLD', `PENDING payment status never becomes SOLD — unknown stays unknown (got ${r.status})`);
  }

  // ===================================================================
  // 4. VALID SALE (PAID) + FEE — the core success path
  // ===================================================================
  console.log('\n-- Valid sale (PAID), with fee --\n');
  let validSaleOutcomeEventId, validSaleOrderId;
  {
    const itemId = `test-reconciler-validsale-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId, 75);
    validSaleOrderId = `O-VALID-${crypto.randomUUID()}`;
    scenario = {
      order: fixtureOrder({ orderId: validSaleOrderId, itemId, paymentStatus: 'PAID', total: 75 }),
      transactions: [saleTxn({ id: `T-SALE-${crypto.randomUUID()}`, orderId: validSaleOrderId, amount: 75, feeAmount: 9.32 })],
    };
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(r.status === 'SOLD_CONFIRMED', `real PAID order with a matching real transaction -> SOLD_CONFIRMED (got ${r.status})`);
    assertTrue(r.orderId === validSaleOrderId, 'the real order id is linked on the SOLD outcome');
    assertTrue(r.economicsStatus === 'KNOWN', `gross + fees both recorded -> economicsStatus KNOWN (got ${r.economicsStatus})`);
    assertTrue(Math.abs(r.economics.gross - 75) < 0.001, `real gross recorded ($75, got $${r.economics.gross})`);
    assertTrue(Math.abs(r.economics.fees - 9.32) < 0.001, `real fee recorded ($9.32, got $${r.economics.fees})`);
    assertTrue(Math.abs(r.economics.realizedNet - (75 - 9.32)) < 0.001, `realizedNet = gross - fees (got $${r.economics.realizedNet})`);
    assertTrue(r.predictionError?.status === 'SCORED', `PredictionError is SCORED once economics are KNOWN (got ${r.predictionError?.status})`);
    assertTrue(r.predictionError?.predictedValue === 61.41, 'original predicted value ($61.41) preserved, never rewritten');
    validSaleOutcomeEventId = r.outcomeEventId;
  }

  // ===================================================================
  // 5. REPEATED POLL — same order, same transaction, re-run
  // ===================================================================
  console.log('\n-- Repeated poll (idempotency) --\n');

  async function getExternalListingId(outcomeEventId) {
    // Small local helper — reads back a SOLD row's own external_listing_id.
    const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'reconciler-test-helper' });
    try {
      const row = (await client.query('SELECT external_listing_id FROM data1_dev.outcome_event WHERE id = $1', [outcomeEventId])).rows[0];
      return row.external_listing_id;
    } finally {
      await client.end();
    }
  }

  // Re-run reconciliation for the SAME listing/order/transaction as scenario 4.
  const validSaleItemId = await getExternalListingId(validSaleOutcomeEventId);
  {
    const componentsBefore = await assets.getOutcomeEconomics({ principalId: TEST_PRINCIPAL_ID, outcomeEventId: validSaleOutcomeEventId });
    const countBefore = componentsBefore.components.length;
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: validSaleItemId, accessToken: 'fake-token' });
    assertTrue(r.status === 'ALREADY_SOLD_ENRICHED', `a listing already SOLD is enriched, never re-marked SOLD (got ${r.status})`);
    assertTrue(r.outcomeEventId === validSaleOutcomeEventId, 'the SAME SOLD outcome_event id is returned — no second SOLD row created');
    const componentsAfter = await assets.getOutcomeEconomics({ principalId: TEST_PRINCIPAL_ID, outcomeEventId: validSaleOutcomeEventId });
    assertTrue(componentsAfter.components.length === countBefore, `identical repeated poll creates ZERO new components (before=${countBefore}, after=${componentsAfter.components.length})`);
    assertTrue(Math.abs(componentsAfter.gross - 75) < 0.001, 'economics unchanged after the repeated poll');
  }

  // ===================================================================
  // 6. DELAYED / PARTIAL ECONOMICS — order confirmed, zero transactions yet
  // ===================================================================
  console.log('\n-- Delayed financial transaction (economics pending) --\n');
  {
    const itemId = `test-reconciler-delayed-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId, 50);
    const orderId = `O-DELAYED-${crypto.randomUUID()}`;
    scenario = { order: fixtureOrder({ orderId, itemId, paymentStatus: 'PAID' }), transactions: [] };
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(r.status === 'SOLD_CONFIRMED', `sale confirmed even with zero Finances transactions yet (got ${r.status})`);
    assertTrue(r.economicsStatus === 'PENDING', `zero components beyond order_reference -> economicsStatus PENDING (got ${r.economicsStatus})`);
    assertTrue(r.economics.gross === 0 && !r.economics.hasAnyComponent, 'gross is NOT fabricated as a real $0 fact — hasAnyComponent=false discloses it is genuinely unknown');
    assertTrue(r.predictionError?.status === 'ECONOMICS_PENDING', `PredictionError reports the distinct ECONOMICS_PENDING state, never CENSORED (got ${r.predictionError?.status})`);
  }

  // ===================================================================
  // 7. GROSS KNOWN, FEES NOT YET — PARTIAL, net must not be fabricated
  // ===================================================================
  console.log('\n-- Partial economics (gross known, fees unknown) --\n');
  {
    const itemId = `test-reconciler-partial-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId, 40);
    const orderId = `O-PARTIAL-${crypto.randomUUID()}`;
    scenario = { order: fixtureOrder({ orderId, itemId, paymentStatus: 'PAID' }), transactions: [saleTxn({ id: `T-P1-${crypto.randomUUID()}`, orderId, amount: 40 })] };
    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(r.economicsStatus === 'PARTIAL', `gross known, fees not -> PARTIAL (got ${r.economicsStatus})`);
    assertTrue(r.predictionError?.status === 'SCORED', 'gross alone is enough for a SCORED prediction (grossSignedError meaningful)');
    assertTrue(r.predictionError?.netSignedError == null, 'netSignedError stays null while fees are still unknown — never fabricated from a $0 fee default');
  }

  // ===================================================================
  // 8. REFUND ARRIVING LATER — enrich an existing SOLD outcome
  // ===================================================================
  console.log('\n-- Refund arriving later (enrichment) --\n');
  {
    const itemId = `test-reconciler-laterrefund-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId, 60);
    const orderId = `O-LATEREFUND-${crypto.randomUUID()}`;
    const saleId = `T-LR-SALE-${crypto.randomUUID()}`;
    scenario = { order: fixtureOrder({ orderId, itemId, paymentStatus: 'PAID' }), transactions: [saleTxn({ id: saleId, orderId, amount: 60, feeAmount: 7 })] };
    const first = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(first.status === 'SOLD_CONFIRMED' && first.economicsStatus === 'KNOWN', 'first pass: sale confirmed, gross+fees known');

    // A later poll: same SALE txn (must not duplicate) PLUS a new REFUND txn.
    scenario = {
      order: fixtureOrder({ orderId, itemId, paymentStatus: 'PARTIALLY_REFUNDED' }),
      transactions: [saleTxn({ id: saleId, orderId, amount: 60, feeAmount: 7 }), refundTxn({ id: `T-LR-REFUND-${crypto.randomUUID()}`, orderId, amount: 15 })],
    };
    const second = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    assertTrue(second.status === 'ALREADY_SOLD_ENRICHED', `second poll enriches the SAME SOLD outcome (got ${second.status})`);
    assertTrue(second.outcomeEventId === first.outcomeEventId, 'no second SOLD row created for the refund');
    assertTrue(second.skippedGross === 1, 'the re-seen SALE transaction is correctly skipped as already-recorded gross, not duplicated');
    assertTrue(Math.abs(second.economics.refund - 15) < 0.001, `the real refund ($15) is now recorded (got $${second.economics.refund})`);
    assertTrue(Math.abs(second.economics.realizedNet - (60 - 7 - 15)) < 0.001, `realizedNet correctly reflects gross-fees-refund (got $${second.economics.realizedNet})`);
  }

  // ===================================================================
  // 9. PARTIAL REFUND vs FULLY REFUNDED SALE — distinct outcomes
  // ===================================================================
  console.log('\n-- Partial refund vs fully-refunded sale (must differ) --\n');
  let partialNet, fullNet;
  {
    // Partial: $75 gross, $9 fee, $20 refund (LESS than gross) — a real,
    // completed, partially-refunded sale.
    const itemId = `test-reconciler-partialrefund-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId, 75);
    const orderId = `O-PARTREF-${crypto.randomUUID()}`;
    const saleId = `T-PR-SALE-${crypto.randomUUID()}`;
    scenario = { order: fixtureOrder({ orderId, itemId, paymentStatus: 'PAID' }), transactions: [saleTxn({ id: saleId, orderId, amount: 75, feeAmount: 9 })] };
    const first = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });

    scenario = {
      order: fixtureOrder({ orderId, itemId, paymentStatus: 'PARTIALLY_REFUNDED' }),
      transactions: [saleTxn({ id: saleId, orderId, amount: 75, feeAmount: 9 }), refundTxn({ id: `T-PR-REFUND-${crypto.randomUUID()}`, orderId, amount: 20 })],
    };
    const enriched = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    partialNet = enriched.economics.realizedNet;
    assertTrue(Math.abs(enriched.economics.gross - 75) < 0.001, 'partial-refund scenario: gross remains the real $75, never reduced/zeroed by the refund itself');
    assertTrue(Math.abs(enriched.economics.refund - 20) < 0.001, 'partial-refund scenario: exactly the real $20 refund is recorded, not the full $75');
    assertTrue(Math.abs(partialNet - (75 - 9 - 20)) < 0.001, `partial-refund realizedNet = gross - fees - refund = $46 (got $${partialNet})`);
    assertTrue(partialNet > 0, 'a partial refund of LESS than gross must never imply a full reversal — net stays positive');

    // Idempotent re-ingestion of the SAME partial refund.
    const componentsBefore = (await assets.getOutcomeEconomics({ principalId: TEST_PRINCIPAL_ID, outcomeEventId: first.outcomeEventId })).components.length;
    const reenriched = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    const componentsAfter = reenriched.economics.components.length;
    assertTrue(componentsAfter === componentsBefore, `repeated ingestion of the same partial refund stays idempotent (before=${componentsBefore}, after=${componentsAfter})`);
  }
  {
    // Full: $75 gross, $9 fee, $75 refund (FULL reversal) — a distinct scenario.
    const itemId = `test-reconciler-fullrefund-${crypto.randomUUID()}`;
    await createTransientListedRow(itemId, 75);
    const orderId = `O-FULLREF-${crypto.randomUUID()}`;
    const saleId = `T-FR-SALE-${crypto.randomUUID()}`;
    scenario = { order: fixtureOrder({ orderId, itemId, paymentStatus: 'PAID' }), transactions: [saleTxn({ id: saleId, orderId, amount: 75, feeAmount: 9 })] };
    await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });

    scenario = {
      order: fixtureOrder({ orderId, itemId, paymentStatus: 'FULLY_REFUNDED' }),
      transactions: [saleTxn({ id: saleId, orderId, amount: 75, feeAmount: 9 }), refundTxn({ id: `T-FR-REFUND-${crypto.randomUUID()}`, orderId, amount: 75 })],
    };
    const enriched = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemId, accessToken: 'fake-token' });
    fullNet = enriched.economics.realizedNet;
  }
  assertTrue(partialNet !== fullNet, `sale + partial refund ($${partialNet}) != fully refunded sale ($${fullNet}) — the two are structurally distinct outcomes`);
  assertTrue(fullNet < partialNet, 'the fully-refunded scenario nets meaningfully lower than the partial-refund scenario');

  // ===================================================================
  // 10. REORDERED TRANSACTIONS — final economics unaffected by array order
  // ===================================================================
  console.log('\n-- Reordered transactions --\n');
  {
    const orderIdA = `O-REORDER-A-${crypto.randomUUID()}`;
    const saleA = saleTxn({ id: `T-RA-SALE-${crypto.randomUUID()}`, orderId: orderIdA, amount: 55, feeAmount: 6 });
    const shipA = { transactionId: `T-RA-SHIP-${crypto.randomUUID()}`, transactionType: 'SHIPPING_LABEL', orderId: orderIdA, transactionDate: '2026-10-02T00:00:00.000Z', amount: { value: '4.50', currency: 'USD' } };

    const itemIdA = `test-reconciler-reorderA-${crypto.randomUUID()}`;
    await createTransientListedRow(itemIdA, 55);
    scenario = { order: fixtureOrder({ orderId: orderIdA, itemId: itemIdA, paymentStatus: 'PAID' }), transactions: [saleA, shipA] };
    const resultA = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemIdA, accessToken: 'fake-token' });

    const orderIdB = `O-REORDER-B-${crypto.randomUUID()}`;
    const saleB = saleTxn({ id: `T-RB-SALE-${crypto.randomUUID()}`, orderId: orderIdB, amount: 55, feeAmount: 6 });
    const shipB = { transactionId: `T-RB-SHIP-${crypto.randomUUID()}`, transactionType: 'SHIPPING_LABEL', orderId: orderIdB, transactionDate: '2026-10-02T00:00:00.000Z', amount: { value: '4.50', currency: 'USD' } };

    const itemIdB = `test-reconciler-reorderB-${crypto.randomUUID()}`;
    await createTransientListedRow(itemIdB, 55);
    scenario = { order: fixtureOrder({ orderId: orderIdB, itemId: itemIdB, paymentStatus: 'PAID' }), transactions: [shipB, saleB] }; // REORDERED
    const resultB = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: TEST_ASSET_ID, externalListingId: itemIdB, accessToken: 'fake-token' });

    assertTrue(resultA.economics.components.length === resultB.economics.components.length, 'identical transaction sets in a different order produce the same number of components');
    assertTrue(Math.abs(resultA.economics.gross - resultB.economics.gross) < 0.001, 'gross identical regardless of transaction array order');
    assertTrue(Math.abs(resultA.economics.fees - resultB.economics.fees) < 0.001, 'fees identical regardless of transaction array order');
    assertTrue(Math.abs(resultA.economics.shipping - resultB.economics.shipping) < 0.001, 'shipping identical regardless of transaction array order');
    assertTrue(Math.abs(resultA.economics.realizedNet - resultB.economics.realizedNet) < 0.001, `final realizedNet identical regardless of transaction order (A=$${resultA.economics.realizedNet}, B=$${resultB.economics.realizedNet})`);
  }

  // ===================================================================
  // 11. ENDED-UNSOLD LISTING (real Creepy history) — must NEVER become SOLD
  // ===================================================================
  console.log('\n-- Real Creepy history: ended-unsold, never converted to SOLD --\n');
  {
    // scenario left deliberately absent an order — if the reconciler's
    // own terminal-state short-circuit is broken, this would make a
    // REAL, unmocked-fallback eBay call; the fetch mock above returns a
    // 404 for any unrecognized URL shape, which would itself fail this
    // scenario loudly rather than silently faking a match.
    scenario = null;
    const before = await assets.getOutcomeEventsForListing({ principalId: TEST_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, externalListingId: CREEPY_LISTING_ID });
    const hadSoldBefore = before.events.some((e) => e.outcome_type === 'SOLD');
    assertTrue(!hadSoldBefore, 'sanity check: Creepy has no real SOLD row before this test runs');

    const r = await reconcileEbayOutcome({ principalId: TEST_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, externalListingId: CREEPY_LISTING_ID, accessToken: 'fake-token' });
    assertTrue(r.status === 'ALREADY_TERMINAL_UNSOLD', `Creepy's real DELISTED history short-circuits to ALREADY_TERMINAL_UNSOLD, never re-evaluated (got ${r.status})`);

    const after = await assets.getOutcomeEventsForListing({ principalId: TEST_PRINCIPAL_ID, gkAssetId: CREEPY_ASSET_ID, externalListingId: CREEPY_LISTING_ID });
    assertTrue(after.events.length === before.events.length, `zero new outcome_event rows written against Creepy's real history (before=${before.events.length}, after=${after.events.length})`);
    assertTrue(!after.events.some((e) => e.outcome_type === 'SOLD'), 'Creepy still has NO SOLD row — never converted');
  }

} finally {
  // Cleanup: delete every transient component + outcome_event this test
  // created, and the one transient valuation_event. Creepy's real rows
  // are never touched (none were created against it, proven above).
  const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'reconciler-test-cleanup' });
  try {
    for (const id of createdOutcomeEventIds) {
      await client.query('DELETE FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1', [id]).catch(() => {});
      await client.query('DELETE FROM data1_dev.outcome_event WHERE id = $1', [id]).catch(() => {});
    }
    if (createdValuationEventId) {
      await client.query('DELETE FROM data1_dev.valuation_event WHERE id = $1', [createdValuationEventId]).catch(() => {});
    }
    console.log(`\n  cleaned up ${createdOutcomeEventIds.length} transient outcome_event row(s) (+ their components) and 1 transient valuation_event row`);
  } finally {
    await client.end();
  }
  await assets.closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
