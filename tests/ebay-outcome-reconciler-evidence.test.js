// tests/ebay-outcome-reconciler-evidence.test.js
//
// GRAILKEY AUTOMATIC EBAY OUTCOME RECONCILER V1 — pure-function proof for
// the authoritative SOLD-evidence rule (evaluateOrderSaleEvidence,
// src/lib/ebayFulfillmentFinances.js) and the economics-completeness
// classifier (classifyEconomicsCompleteness, src/lib/
// ebayOutcomeReconciler.js). No DB, no network, no real eBay call.
//
// Invoke: node tests/ebay-outcome-reconciler-evidence.test.js

import { evaluateOrderSaleEvidence } from '../src/lib/ebayFulfillmentFinances.js';
import { classifyEconomicsCompleteness } from '../src/lib/ebayOutcomeReconciler.js';

const tests = [];
let passed = 0, failed = 0;
function test(desc, fn) { tests.push({ desc, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(actual, expected, msg) { if (actual !== expected) throw new Error(msg || `expected ${expected}, got ${actual}`); }

function run() {
  console.log('='.repeat(60));
  console.log('eBay Outcome Reconciler — evidence rule tests');
  console.log('='.repeat(60));
  tests.forEach(({ desc, fn }) => {
    try { fn(); console.log(`  ✓ ${desc}`); passed++; }
    catch (err) { console.error(`  ✗ ${desc}`); console.error(`    ${err.message}`); failed++; }
  });
  console.log('');
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// evaluateOrderSaleEvidence
// ─────────────────────────────────────────────────────────────────

test('no order object at all -> NO_ORDER', () => {
  assertEqual(evaluateOrderSaleEvidence(null).verdict, 'NO_ORDER');
  assertEqual(evaluateOrderSaleEvidence(undefined).verdict, 'NO_ORDER');
  assertEqual(evaluateOrderSaleEvidence({}).verdict, 'NO_ORDER');
});

test('a real order with orderPaymentStatus=PAID and no cancellation -> CONFIRMED_SALE', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O1', orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'NONE_REQUESTED' } });
  assertEqual(r.verdict, 'CONFIRMED_SALE');
});

test('orderPaymentStatus=PAID with no cancelStatus object at all -> still CONFIRMED_SALE (absent cancelStatus is not itself cancelled)', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O2', orderPaymentStatus: 'PAID' });
  assertEqual(r.verdict, 'CONFIRMED_SALE');
});

test('orderPaymentStatus=PARTIALLY_REFUNDED -> CONFIRMED_SALE (a refund is evidence a sale occurred, not evidence it did not)', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O3', orderPaymentStatus: 'PARTIALLY_REFUNDED' });
  assertEqual(r.verdict, 'CONFIRMED_SALE');
});

test('orderPaymentStatus=FULLY_REFUNDED -> CONFIRMED_SALE (still a real, executed sale — the refund is a separate later fact)', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O4', orderPaymentStatus: 'FULLY_REFUNDED' });
  assertEqual(r.verdict, 'CONFIRMED_SALE');
});

test('cancelStatus.cancelState=CANCEL_REQUESTED -> CANCELLED, regardless of payment status', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O5', orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'CANCEL_REQUESTED' } });
  assertEqual(r.verdict, 'CANCELLED');
});

test('cancelStatus.cancelState=CANCEL_CLOSED -> CANCELLED', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O6', orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'CANCEL_CLOSED' } });
  assertEqual(r.verdict, 'CANCELLED');
});

test('orderPaymentStatus=PENDING -> AMBIGUOUS, never treated as a sale', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O7', orderPaymentStatus: 'PENDING' });
  assertEqual(r.verdict, 'AMBIGUOUS');
});

test('orderPaymentStatus=FAILED -> AMBIGUOUS, never treated as a sale', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O8', orderPaymentStatus: 'FAILED' });
  assertEqual(r.verdict, 'AMBIGUOUS');
});

test('orderPaymentStatus missing entirely -> AMBIGUOUS, never defaulted to a sale', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O9' });
  assertEqual(r.verdict, 'AMBIGUOUS');
});

test('orderPaymentStatus is an unrecognized future value -> AMBIGUOUS, never guessed as a sale', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O10', orderPaymentStatus: 'SOME_FUTURE_STATUS_NOT_YET_HANDLED' });
  assertEqual(r.verdict, 'AMBIGUOUS');
});

test('cancellation is checked BEFORE payment status — a cancelled+PAID order never reports CONFIRMED_SALE', () => {
  const r = evaluateOrderSaleEvidence({ orderId: 'O11', orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'CANCEL_CLOSED' } });
  assert(r.verdict !== 'CONFIRMED_SALE', 'a cancelled order must never confirm a sale regardless of payment status');
});

// ─────────────────────────────────────────────────────────────────
// classifyEconomicsCompleteness
// ─────────────────────────────────────────────────────────────────

test('zero components (hasAnyComponent=false) -> PENDING', () => {
  assertEqual(classifyEconomicsCompleteness({ hasAnyComponent: false, components: [] }), 'PENDING');
});

test('only order_reference recorded -> PENDING (no gross yet)', () => {
  assertEqual(classifyEconomicsCompleteness({ hasAnyComponent: false, components: [{ component_type: 'order_reference' }] }), 'PENDING');
});

test('gross recorded, fees not yet -> PARTIAL', () => {
  assertEqual(classifyEconomicsCompleteness({ hasAnyComponent: true, components: [{ component_type: 'gross' }] }), 'PARTIAL');
});

test('gross AND fees both recorded -> KNOWN', () => {
  assertEqual(classifyEconomicsCompleteness({ hasAnyComponent: true, components: [{ component_type: 'gross' }, { component_type: 'fees' }] }), 'KNOWN');
});

test('gross, fees, AND a later refund -> still KNOWN (refund does not downgrade completeness)', () => {
  assertEqual(classifyEconomicsCompleteness({ hasAnyComponent: true, components: [{ component_type: 'gross' }, { component_type: 'fees' }, { component_type: 'refund' }] }), 'KNOWN');
});

test('null/undefined economics object fails safely to PENDING, never throws', () => {
  assertEqual(classifyEconomicsCompleteness(null), 'PENDING');
  assertEqual(classifyEconomicsCompleteness(undefined), 'PENDING');
});

run();
