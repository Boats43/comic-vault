// tests/ebay-fulfillment-finances-ingestion.test.js
//
// GRAILKEY — BUYER DECISION DURABILITY + AUTOMATIC OUTCOME INGESTION,
// item 6 (Tests). Pure-function + mocked-fetch proof for
// src/lib/ebayFulfillmentFinances.js — the real eBay Fulfillment/Finances
// REST callers and the transaction-to-economics-component normalizer that
// scripts/ingest-outcome1-financials.mjs uses.
//
// No real DB, no real eBay call — global fetch is mocked with response
// shapes matching eBay's documented Fulfillment Order / Finances
// Transaction resources. Proves: correct normalization, no fabrication of
// missing fields, deterministic idempotency-key derivation (the actual
// duplicate-prevention mechanism, enforced downstream by
// recordEconomicsComponent's class-wide idempotency law, GK-163), and
// fail-safe behavior on non-OK HTTP responses.
//
// Invoke: node tests/ebay-fulfillment-finances-ingestion.test.js

import {
  findOrderByLegacyItemId,
  getFinancialTransactionsForOrder,
  normalizeTransactionToComponents,
} from '../src/lib/ebayFulfillmentFinances.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(desc, fn) {
  tests.push({ desc, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function run() {
  console.log('='.repeat(60));
  console.log('eBay Fulfillment/Finances ingestion — Tests');
  console.log('='.repeat(60));

  for (const { desc, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

function withMockedFetch(responder, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = responder;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

// ─────────────────────────────────────────────────────────────────
// normalizeTransactionToComponents — pure
// ─────────────────────────────────────────────────────────────────

test('SALE transaction normalizes to one gross candidate', () => {
  const txn = { transactionId: 'T1', transactionType: 'SALE', orderId: 'O1', transactionDate: '2026-10-01T00:00:00.000Z', amount: { value: '75.00', currency: 'USD' } };
  const out = normalizeTransactionToComponents(txn);
  assertEqual(out.length, 1);
  assertEqual(out[0].componentType, 'gross');
  assertEqual(out[0].amount, 75);
  assertEqual(out[0].externalOrderId, 'O1');
  assert(out[0].idempotencyKey.includes('T1'), 'idempotencyKey should embed the real transactionId');
});

test('REFUND transaction normalizes to one refund candidate', () => {
  const txn = { transactionId: 'T2', transactionType: 'REFUND', orderId: 'O1', amount: { value: '10.00', currency: 'USD' } };
  const out = normalizeTransactionToComponents(txn);
  assertEqual(out.length, 1);
  assertEqual(out[0].componentType, 'refund');
  assertEqual(out[0].amount, 10);
});

test('SHIPPING_LABEL transaction normalizes to one shipping candidate', () => {
  const txn = { transactionId: 'T3', transactionType: 'SHIPPING_LABEL', orderId: 'O1', amount: { value: '5.25', currency: 'USD' } };
  const out = normalizeTransactionToComponents(txn);
  assertEqual(out.length, 1);
  assertEqual(out[0].componentType, 'shipping');
  assertEqual(out[0].amount, 5.25);
});

test('CREDIT transaction normalizes to one credit candidate', () => {
  const txn = { transactionId: 'T4', transactionType: 'CREDIT', orderId: 'O1', amount: { value: '2.00', currency: 'USD' } };
  const out = normalizeTransactionToComponents(txn);
  assertEqual(out.length, 1);
  assertEqual(out[0].componentType, 'credit');
});

test('marketplaceFee line items normalize to one fees candidate each', () => {
  const txn = {
    transactionId: 'T5', transactionType: 'SALE', orderId: 'O1', amount: { value: '75.00' },
    orderLineItems: [{
      marketplaceFee: [
        { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: { value: '0.30' } },
        { feeType: 'FINAL_VALUE_FEE', amount: { value: '9.02' } },
      ],
    }],
  };
  const out = normalizeTransactionToComponents(txn);
  // 1 gross + 2 fees
  assertEqual(out.length, 3);
  const fees = out.filter((c) => c.componentType === 'fees');
  assertEqual(fees.length, 2);
  assertEqual(fees[0].amount, 0.30);
  assertEqual(fees[1].amount, 9.02);
  assert(fees[0].idempotencyKey !== fees[1].idempotencyKey, 'each fee line item must get its own distinct idempotencyKey');
});

test('missing amount on a fee entry is skipped, never fabricated as $0', () => {
  const txn = {
    transactionId: 'T6', transactionType: 'SALE', orderId: 'O1', amount: { value: '75.00' },
    orderLineItems: [{ marketplaceFee: [{ feeType: 'UNKNOWN_FEE' /* no amount field at all */ }] }],
  };
  const out = normalizeTransactionToComponents(txn);
  const fees = out.filter((c) => c.componentType === 'fees');
  assertEqual(fees.length, 0, 'a fee entry with no amount must produce zero fee candidates, not a $0 one');
});

test('SALE transaction with no amount field produces no gross candidate (never fabricated)', () => {
  const txn = { transactionId: 'T7', transactionType: 'SALE', orderId: 'O1' /* no amount */ };
  const out = normalizeTransactionToComponents(txn);
  assertEqual(out.length, 0);
});

test('transaction with no transactionId is rejected entirely (fail safe, no throw)', () => {
  const out = normalizeTransactionToComponents({ transactionType: 'SALE', amount: { value: '75.00' } });
  assertEqual(out.length, 0);
});

test('null/undefined transaction input fails safely, no throw', () => {
  assertEqual(normalizeTransactionToComponents(null).length, 0);
  assertEqual(normalizeTransactionToComponents(undefined).length, 0);
});

test('unrecognized transactionType produces no candidates by itself (never a guessed mapping)', () => {
  const txn = { transactionId: 'T8', transactionType: 'SOME_FUTURE_TYPE_NOT_YET_HANDLED', amount: { value: '1.00' } };
  const out = normalizeTransactionToComponents(txn);
  assertEqual(out.length, 0, 'an unmapped transaction type must not silently become gross/fees/etc.');
});

// ─────────────────────────────────────────────────────────────────
// Idempotency-key determinism across repeated "polls" of the SAME data
// ─────────────────────────────────────────────────────────────────

test('re-normalizing the identical transaction twice yields byte-identical idempotencyKeys (repeated polling proof)', () => {
  const txn = {
    transactionId: 'T9', transactionType: 'SALE', orderId: 'O9', amount: { value: '50.00' },
    orderLineItems: [{ marketplaceFee: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: '4.75' } }] }],
  };
  const first = normalizeTransactionToComponents(txn);
  const second = normalizeTransactionToComponents(structuredClone(txn));
  assertEqual(first.length, second.length);
  first.forEach((c, i) => assertEqual(c.idempotencyKey, second[i].idempotencyKey, `component ${i} idempotencyKey must be stable across repeated polls`));
});

test('the SAME transaction embedded in a DIFFERENT order of orderLineItems still derives distinct, stable per-fee keys (no collision)', () => {
  const txn = {
    transactionId: 'T10', transactionType: 'SALE', orderId: 'O10', amount: { value: '50.00' },
    orderLineItems: [
      { marketplaceFee: [{ feeType: 'A', amount: { value: '1.00' } }] },
      { marketplaceFee: [{ feeType: 'B', amount: { value: '2.00' } }] },
    ],
  };
  const out = normalizeTransactionToComponents(txn);
  const keys = out.map((c) => c.idempotencyKey);
  assertEqual(new Set(keys).size, keys.length, 'all idempotencyKeys for one transaction must be pairwise distinct');
});

// ─────────────────────────────────────────────────────────────────
// findOrderByLegacyItemId / getFinancialTransactionsForOrder — mocked fetch
// ─────────────────────────────────────────────────────────────────

test('findOrderByLegacyItemId returns the real order object when a lineItem matches', async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ orders: [{ orderId: 'O-MATCH', lineItems: [{ legacyItemId: '366665728633' }] }, { orderId: 'O-OTHER', lineItems: [{ legacyItemId: '999' }] }] }),
    }),
    async () => {
      const order = await findOrderByLegacyItemId({ accessToken: 'tok', legacyItemId: '366665728633', sinceIso: '2026-01-01T00:00:00Z', untilIso: '2026-01-08T00:00:00Z' });
      assert(order && order.orderId === 'O-MATCH', 'expected the matching order to be returned');
    }
  );
});

test('findOrderByLegacyItemId returns null (not an error) when no order matches', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ orders: [{ orderId: 'O-OTHER', lineItems: [{ legacyItemId: '999' }] }] }) }),
    async () => {
      const order = await findOrderByLegacyItemId({ accessToken: 'tok', legacyItemId: '366665728633', sinceIso: '2026-01-01T00:00:00Z', untilIso: '2026-01-08T00:00:00Z' });
      assertEqual(order, null);
    }
  );
});

test('findOrderByLegacyItemId throws a clear error on a non-OK HTTP response (fail loud, not silent)', async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ errors: [{ message: 'invalid_token' }] }) }),
    async () => {
      let threw = false;
      try {
        await findOrderByLegacyItemId({ accessToken: 'bad', legacyItemId: '1', sinceIso: '2026-01-01T00:00:00Z', untilIso: '2026-01-08T00:00:00Z' });
      } catch (e) {
        threw = true;
        assert(/401/.test(e.message) && /invalid_token/.test(e.message), `error should surface HTTP status and eBay's own message, got: ${e.message}`);
      }
      assert(threw, 'expected findOrderByLegacyItemId to throw on a non-OK response');
    }
  );
});

test('getFinancialTransactionsForOrder returns the real transactions array', async () => {
  await withMockedFetch(
    async (url) => {
      assert(String(url).includes('orderId%3A%7BO1%7D') || String(url).includes('orderId:{O1}'), `expected the real orderId in the filter, got url: ${url}`);
      return { ok: true, status: 200, json: async () => ({ transactions: [{ transactionId: 'T1' }, { transactionId: 'T2' }] }) };
    },
    async () => {
      const txns = await getFinancialTransactionsForOrder({ accessToken: 'tok', orderId: 'O1' });
      assertEqual(txns.length, 2);
    }
  );
});

test('getFinancialTransactionsForOrder returns [] (not an error) when the API returns no transactions field', async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
    async () => {
      const txns = await getFinancialTransactionsForOrder({ accessToken: 'tok', orderId: 'O1' });
      assertEqual(txns.length, 0);
    }
  );
});

await run();
