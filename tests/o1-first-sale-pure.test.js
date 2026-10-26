// tests/o1-first-sale-pure.test.js -- OUTCOME #1 FIRST SALE RECONCILIATION (2026-10-26). DB-free, network-free.
//
// Proves, with a mocked fetch only: UNKNOWN-vs-zero economics, the operator-facing interpretation rules, bounded
// exact-ItemID Fulfillment pagination (incl. every incomplete/failed shape), the corrected Finances host, transaction
// normalization, qualifying-order selection, and -- as assertions that FAIL rather than skip -- the App.jsx wiring.
//
//   node tests/o1-first-sale-pure.test.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  searchOrdersForListing, fetchFinancialTransactionsForOrder, findOrderByLegacyItemId, normalizeTransactionToComponents,
  FINANCES_BASE, MAX_ORDER_PAGES,
} from '../src/lib/ebayFulfillmentFinances.js';
import { classifyEconomics, computeRealizedNet, buildEconomicsView, summarizeComponents } from '../src/lib/economicsView.js';
import { interpretSaleCheck, formatKnownAmount, buildPostageRequest, VERIFY_ERROR_MESSAGE } from '../src/lib/saleCheck.js';
import { selectQualifyingOrder } from '../src/lib/ebayOutcomeReconciler.js';
import { patchFromDurableListing } from '../src/lib/listingState.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const comp = (type, amount) => ({ component_type: type, amount: String(amount) });

console.log('\n=== Outcome #1 first sale: pure proofs ===\n');

console.log('-- UNKNOWN is not zero (economics semantics) --');
{
  const none = classifyEconomics({ hasAnyComponent: false, components: [] });
  ok(none.status === 'PENDING', 'no gross -> PENDING');
  const gOnly = { hasAnyComponent: true, components: [comp('gross', 15.42)] };
  const v1 = buildEconomicsView(gOnly);
  ok(classifyEconomics(gOnly).status === 'INCOMPLETE' && v1.netProceeds.status === 'UNKNOWN' && v1.netProceeds.amount === null, 'gross only -> INCOMPLETE and NO net (not gross)');
  ok(v1.lines.find((l) => l.key === 'fees').status === 'UNKNOWN' && v1.lines.find((l) => l.key === 'fees').amount === null, 'an unarrived fee is UNKNOWN with a null amount, not 0');
  const gf = { hasAnyComponent: true, components: [comp('gross', 15.42), comp('fees', 2.1)] };
  ok(classifyEconomics(gf).status === 'INCOMPLETE' && buildEconomicsView(gf).netProceeds.status === 'UNKNOWN', 'gross + fees but NO postage -> still INCOMPLETE, no net (postage is never read as $0)');
  ok(JSON.stringify(classifyEconomics(gf).missing) === JSON.stringify(['shipping']), 'the missing list names exactly what is unknown');
  const full = { hasAnyComponent: true, components: [comp('gross', 15.42), comp('fees', 2.1), comp('shipping', 4.5)] };
  const vf = buildEconomicsView(full);
  ok(classifyEconomics(full).status === 'COMPLETE' && vf.netProceeds.status === 'KNOWN' && Math.abs(vf.netProceeds.amount - 8.82) < 1e-9, 'gross + fees + postage -> COMPLETE and net = 15.42 - 2.10 - 4.50 = 8.82');
  const zero = { hasAnyComponent: true, components: [comp('gross', 15.42), comp('fees', '0.00'), comp('shipping', '0.00')] };
  const vz = buildEconomicsView(zero);
  ok(vz.lines.find((l) => l.key === 'fees').status === 'KNOWN' && vz.lines.find((l) => l.key === 'fees').amount === 0, 'an explicit verified $0.00 fee is KNOWN and equals 0 (distinct from absent)');
  ok(vz.status === 'COMPLETE' && vz.netProceeds.amount === 15.42 && formatKnownAmount(vz.lines.find((l) => l.key === 'shipping')) === '$0.00', 'explicit zero fees + zero postage -> COMPLETE, net = gross, rendered "$0.00"');
  ok(formatKnownAmount(v1.lines.find((l) => l.key === 'fees')) === 'Unknown', 'an UNKNOWN line renders "Unknown", never "$0.00"');
  const withAdj = { hasAnyComponent: true, components: [...full.components, comp('refund', 3), comp('credit', 1)] };
  ok(Math.abs(buildEconomicsView(withAdj).netProceeds.amount - 6.82) < 1e-9, 'refunds subtract and credits add when recorded (8.82 - 3 + 1 = 6.82)');
  ok(buildEconomicsView(full).netProceeds.includesRefunds === false, 'absence of a refund is reported as "none recorded", not claimed as a verified zero');
  ok(computeRealizedNet({ gross: 10, fees: null, shipping: 2 }, { gross: true, fees: false, shipping: true }) === null, 'computeRealizedNet is null when any required component is absent');
  ok(0.1 + 0.2 !== 0.3 && computeRealizedNet({ gross: 0.3, fees: 0.1, shipping: 0.2 }, { gross: true, fees: true, shipping: true }) === 0, 'net arithmetic is done in integer cents (no float drift)');
  ok(vf.profit.status === 'UNKNOWN' && vf.profit.amount === null && /acquisition/.test(vf.profit.reason), 'PROFIT stays UNKNOWN: net proceeds are kept separate from acquisition-adjusted profit');
  ok(vf.notTracked.packaging === 'UNKNOWN' && vf.notTracked.payout === 'UNKNOWN' && vf.notTracked.acquisitionCost === 'UNKNOWN', 'packaging, payout and acquisition cost are reported UNKNOWN, not tracked');
  ok(vf.canRecordPostage === false && buildEconomicsView(gOnly).canRecordPostage === true, 'the postage form is offered only while postage is UNKNOWN');
  ok(summarizeComponents({ components: [{ component_type: 'order_reference' }] }).present.gross === false, 'an order reference alone never counts as a known amount');
}

console.log('\n-- operator-facing interpretation of the reconciler response --');
{
  const sold = interpretSaleCheck(200, { status: 'SOLD_CONFIRMED', orderId: '27-12345-67890', outcomeEventId: 'o1', soldAt: 1000, economicsView: { status: 'INCOMPLETE', lines: [], missing: ['fees'] } }, 5);
  ok(sold.kind === 'SOLD' && sold.patch?.status === 'sold' && sold.patch.soldOrderId === '27-12345-67890' && sold.patch.soldOutcomeEventId === 'o1', 'a verified paid order is the ONLY thing that yields a sold patch (with the order reference)');
  ok(sold.message.includes('27-12345-67890'), 'the verified order reference is shown');
  ok(interpretSaleCheck(200, { status: 'ALREADY_SOLD_ENRICHED', orderId: 'X', outcomeEventId: 'o1' }).patch?.status === 'sold', 'enriching an already-sold outcome keeps it sold (idempotent)');
  const none = interpretSaleCheck(200, { status: 'NO_ORDER_YET' });
  ok(none.message === 'No paid order found' && none.patch === null && none.retryable === false, 'NO_ORDER_YET -> "No paid order found", NO patch (stays LISTED)');
  for (const st of ['ORDER_LOOKUP_FAILED', 'ORDER_SEARCH_INCOMPLETE']) {
    const r = interpretSaleCheck(200, { status: st });
    ok(r.kind === 'VERIFY_ERROR' && r.retryable === true && r.patch === null && r.message === VERIFY_ERROR_MESSAGE && !/no paid order/i.test(r.message), `${st} -> retryable verification error, never worded as "no order", no state change`);
  }
  for (const [code, http] of [['EBAY_TEMPORARY_FAILURE', 502], ['EBAY_RECONNECT_REQUIRED', 503], ['EBAY_CONNECTION_REQUIRED', 503]]) {
    const r = interpretSaleCheck(http, { error: code });
    ok(r.kind === 'VERIFY_ERROR' && r.patch === null, `provider/connection error ${code} -> error message, no state change`);
  }
  ok(interpretSaleCheck(500, null).patch === null && interpretSaleCheck(0, null).patch === null && interpretSaleCheck(200, {}).patch === null && interpretSaleCheck(200, { status: 'SOMETHING_NEW' }).patch === null, 'HTTP failures, empty and unknown bodies never change the card');
  ok(interpretSaleCheck(200, { status: 'AMBIGUOUS_NOT_SOLD' }).patch === null && interpretSaleCheck(200, { status: 'CANCELLED_NOT_SOLD' }).patch === null && interpretSaleCheck(200, { status: 'MULTIPLE_PAID_ORDERS' }).patch === null, 'unconfirmed / cancelled / ambiguous orders never produce a sold patch');
  const ended = interpretSaleCheck(200, { status: 'ALREADY_TERMINAL_UNSOLD' });
  ok(ended.kind === 'ENDED_UNSOLD' && ended.patch === null && /without a sale/.test(ended.message), 'an ended listing is reported as ended WITHOUT a sale');
  ok(interpretSaleCheck(401, null).kind === 'SIGN_IN' && interpretSaleCheck(404, null).patch === null, '401 asks to sign in; 404 (wrong owner) changes nothing');
}

console.log('\n-- off-eBay postage request (receipt-backed, entered once) --');
{
  const a = buildPostageRequest({ outcomeEventId: 'oe-1', orderId: 'ORD', amount: '4.50', reference: ' USPS  receipt 9400 ' });
  const b = buildPostageRequest({ outcomeEventId: 'oe-1', orderId: 'ORD', amount: 4.5, reference: 'usps receipt 9400' });
  ok(a.body && a.body.componentType === 'shipping' && a.body.amount === 4.5 && a.body.currency === 'USD', 'a shipping component with the exact entered amount');
  ok(a.body.idempotencyKey === b.body.idempotencyKey, 'the same receipt reference (any spacing/case) yields the SAME idempotency key -> recorded once');
  ok(buildPostageRequest({ outcomeEventId: 'oe-2', amount: 4.5, reference: 'usps receipt 9400' }).body.idempotencyKey !== a.body.idempotencyKey, 'a different outcome gets a different key');
  ok(/^Receipt: /.test(a.body.sourceReference) && a.body.evidenceNote.includes('off-eBay'), 'the receipt reference and attribution are carried');
  ok(buildPostageRequest({ outcomeEventId: 'oe-1', amount: 4.5, reference: '  ' }).error, 'a receipt reference is required');
  ok(buildPostageRequest({ outcomeEventId: 'oe-1', amount: null, reference: 'r' }).error && buildPostageRequest({ outcomeEventId: 'oe-1', amount: '   ', reference: 'r' }).error, 'a null or whitespace amount is refused, never coerced to $0');
  ok(buildPostageRequest({ outcomeEventId: 'oe-1', amount: -1, reference: 'r' }).error && buildPostageRequest({ outcomeEventId: 'oe-1', amount: '', reference: 'r' }).error && buildPostageRequest({ outcomeEventId: 'oe-1', amount: 'abc', reference: 'r' }).error, 'a negative, blank or non-numeric amount is refused (nothing fabricated)');
  ok(buildPostageRequest({ outcomeEventId: 'oe-1', amount: 0, reference: 'buyer pickup' }).body.amount === 0, 'an explicit 0 with a reference is accepted (a verified zero)');
  ok(buildPostageRequest({ amount: 1, reference: 'r' }).error, 'no outcome -> refused');
}

// ── mocked eBay for the pagination proofs ──
const realFetch = global.fetch;
const calls = [];
function mockEbay(handler) {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: (opts.method || 'GET').toUpperCase() });
    return handler(u);
  };
}
const respond = (json, status = 200) => ({ ok: status < 400, status, statusText: status < 400 ? 'OK' : 'ERR', json: async () => json });
const order = (id, itemId, extra = {}) => ({ orderId: id, creationDate: '2026-10-27T00:00:00.000Z', orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'NONE_REQUESTED' }, lineItems: [{ legacyItemId: itemId, title: 'Old Man Logan #25' }], ...extra });
const qs = (u) => Object.fromEntries(new URL(u).searchParams.entries());
const WANT = '366762997648';
const S = { accessToken: 't', legacyItemId: WANT, sinceIso: '2026-10-26T00:00:00.000Z', untilIso: '2026-10-28T00:00:00.000Z' };

console.log('\n-- Fulfillment pagination: bounded, exact ItemID, explicit completeness --');
{
  calls.length = 0;
  const all = Array.from({ length: 450 }, (_, i) => order(`O-${i}`, `1000000${String(i).padStart(5, '0')}`));
  all[430] = order('O-MATCH', WANT);
  all[10] = order('O-SAMETITLE', '999999999999'); // same comic title, different ItemID
  mockEbay((u) => { const q = qs(u); const off = Number(q.offset), lim = Number(q.limit); return respond({ total: all.length, orders: all.slice(off, off + lim), limit: lim, offset: off }); });
  const r = await searchOrdersForListing(S);
  ok(r.complete && r.matches.length === 1 && r.matches[0].orderId === 'O-MATCH', 'the matching order is found on the THIRD page');
  ok(r.pagesFetched === 3 && r.ordersScanned === 450 && r.total === 450, 'three pages of 200/200/50 were read');
  const qsAll = calls.map((c) => qs(c.url));
  ok(qsAll.map((q) => q.offset).join() === '0,200,400' && qsAll.every((q) => q.limit === '200'), 'documented limit=200 and offset paging parameters are used');
  ok(calls.every((c) => c.method === 'GET' && c.url.startsWith('https://api.ebay.com/sell/fulfillment/v1/order?') && /filter=creationdate/.test(c.url)), 'GET-only, Fulfillment host, creationdate window filter');
  ok(!r.matches.some((o) => o.orderId === 'O-SAMETITLE'), 'another order with the same comic title (different ItemID) is NOT matched');
}
{
  mockEbay(() => respond({ total: 2, orders: [order('O-1', '111111111111'), order('O-2', '222222222222', { lineItems: [{ legacyItemId: '111111111111' }, { legacyItemId: WANT }] })] }));
  const r = await searchOrdersForListing(S);
  ok(r.complete && r.matches.length === 1 && r.matches[0].orderId === 'O-2', 'a multi-line-item order matches when ANY line item has the exact ItemID');
  mockEbay(() => respond({ total: 1, orders: [order('O-3', `${WANT}1`)] }));
  ok((await searchOrdersForListing(S)).matches.length === 0, 'a longer ItemID that merely starts with the wanted one does not match (exact comparison)');
  mockEbay(() => respond({ total: 0, orders: [] }));
  const none = await searchOrdersForListing(S);
  ok(none.complete && none.matches.length === 0 && !none.failed, 'a complete empty window -> complete, zero matches (the ONLY state that means "no order yet")');
}
{
  calls.length = 0;
  mockEbay((u) => (Number(qs(u).offset) === 0 ? respond({ total: 400, orders: Array.from({ length: 200 }, (_, i) => order(`P-${i}`, '111111111111')) }) : respond({ errors: [{ message: 'boom' }] }, 500)));
  const r = await searchOrdersForListing(S);
  ok(!r.complete && r.failed && r.matches.length === 0 && /page 2 failed/.test(r.reason), 'page 2 failing -> incomplete + failed with a reason, NOT a clean "no order"');
  mockEbay(() => respond({ errors: [{ message: 'unauthorized' }] }, 401));
  const r1 = await searchOrdersForListing(S);
  ok(!r1.complete && r1.failed && r1.matches.length === 0, 'page 1 failing -> failed');
  let threw = false; try { await findOrderByLegacyItemId(S); } catch { threw = true; }
  ok(threw, 'the legacy single-order wrapper THROWS on an incomplete empty search instead of returning null');
}
{
  calls.length = 0;
  const same = Array.from({ length: 200 }, (_, i) => order(`R-${i}`, '111111111111'));
  mockEbay(() => respond({ total: 100000, orders: same }));
  const r = await searchOrdersForListing(S);
  ok(!r.complete && /no progress/.test(r.reason) && r.pagesFetched === 2, `a provider repeating the same page cannot loop: stopped after ${r.pagesFetched} pages (${r.reason})`);
  calls.length = 0;
  let n = 0;
  mockEbay(() => respond({ total: 10000000, orders: Array.from({ length: 200 }, () => order(`U-${n++}`, '111111111111')) }));
  const capped = await searchOrdersForListing({ ...S, maxPages: 4 });
  ok(!capped.complete && /page cap \(4\)/.test(capped.reason) && capped.pagesFetched === 4 && calls.length === 4, 'the page cap bounds an unbounded window and reports INCOMPLETE');
  ok(MAX_ORDER_PAGES === 25, 'the production page cap is 25 pages (5,000 orders)');
  mockEbay(() => respond({ orders: [order('N-1', '111111111111')], next: 'x' }));
  const noTotal = await searchOrdersForListing({ ...S, maxPages: 3 });
  ok(!noTotal.complete, 'with no total and a "next" link that never advances, the search is stopped and INCOMPLETE');
  mockEbay((u) => (Number(qs(u).offset) === 0 ? respond({ orders: [order('Q-1', WANT)], next: 'x' }) : respond({ orders: [] })));
  const noTotalOk = await searchOrdersForListing(S);
  ok(noTotalOk.complete && noTotalOk.matches.length === 1, 'with no total, an empty page ends the search normally');
  mockEbay(() => respond({ total: 2, orders: [{ lineItems: [{ legacyItemId: WANT }] }, order('Q-2', '111111111111')] }));
  ok((await searchOrdersForListing(S)).matches.length === 0, 'an order with no orderId is never evidence');
  ok((await searchOrdersForListing({ ...S, legacyItemId: '' })).failed, 'an empty ItemID is refused');
  const dupe = order('D-1', WANT);
  mockEbay((u) => respond({ total: 2, orders: Number(qs(u).offset) === 0 ? [dupe] : [dupe] }));
  const d = await searchOrdersForListing(S);
  ok(d.matches.length === 1, 'the same order appearing on two pages is processed once');
}

console.log('\n-- Finances: corrected host, bounded pagination, normalization --');
{
  ok(FINANCES_BASE === 'https://apiz.ebay.com/sell/finances/v1', 'FINANCES_BASE is the documented apiz.ebay.com host');
  calls.length = 0;
  const txns = Array.from({ length: 250 }, (_, i) => ({ transactionId: `T-${i}`, transactionType: 'SALE', orderId: 'O', amount: { value: '1.00' } }));
  mockEbay((u) => { const q = qs(u); const off = Number(q.offset), lim = Number(q.limit); return respond({ total: txns.length, transactions: txns.slice(off, off + lim) }); });
  const r = await fetchFinancialTransactionsForOrder({ accessToken: 't', orderId: 'O' });
  ok(r.complete && r.transactions.length === 250 && r.pagesFetched === 2, 'two pages of transactions are read and de-duplicated by transactionId');
  ok(calls.every((c) => c.url.startsWith('https://apiz.ebay.com/sell/finances/v1/transaction?') && c.method === 'GET'), 'every Finances call is GET on the apiz host');
  mockEbay((u) => (Number(qs(u).offset) === 0 ? respond({ total: 400, transactions: txns.slice(0, 200) }) : respond({}, 503)));
  const bad = await fetchFinancialTransactionsForOrder({ accessToken: 't', orderId: 'O' });
  ok(!bad.complete && bad.transactions.length === 200 && /page 2 failed/.test(bad.reason), 'a failed second page is reported INCOMPLETE and keeps the genuine rows already read');

  const c1 = normalizeTransactionToComponents({ transactionId: 'T1', transactionType: 'SHIPPING_LABEL', bookingEntry: 'DEBIT', orderId: 'O', amount: { value: '5.20' } });
  ok(c1.length === 1 && c1[0].componentType === 'shipping' && c1[0].amount === 5.2, 'an eBay shipping-label DEBIT is postage');
  const c2 = normalizeTransactionToComponents({ transactionId: 'T2', transactionType: 'SHIPPING_LABEL', bookingEntry: 'CREDIT', orderId: 'O', amount: { value: '5.20' } });
  ok(c2.length === 1 && c2[0].componentType === 'credit', 'a shipping-label CREDIT (label refund) is a credit, never a cost');
  ok(normalizeTransactionToComponents({ transactionId: 'T3', transactionType: 'NON_SALE_CHARGE', orderId: 'O', amount: { value: '9.99' } }).length === 0, 'NON_SALE_CHARGE is no longer booked as postage');
  const c4 = normalizeTransactionToComponents({ transactionId: 'T4', transactionType: 'SALE', orderId: 'O', amount: { value: '15.42' }, orderLineItems: [{ marketplaceFee: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: '0.00' } }, { feeType: 'X', amount: { value: '1.10' } }] }] });
  ok(c4.filter((c) => c.componentType === 'fees').length === 2 && c4.find((c) => c.componentType === 'fees' && c.amount === 0), 'a fee line of "0.00" is recorded as a verified zero (not dropped, not invented)');
  ok(normalizeTransactionToComponents({ transactionId: 'T5', transactionType: 'SALE', orderId: 'O', amount: { value: '15.42' } }).every((c) => c.componentType !== 'fees'), 'no marketplaceFee entry -> NO fee component (totalFeeAmount is never used)');
  const again = normalizeTransactionToComponents({ transactionId: 'T4', transactionType: 'SALE', orderId: 'O', amount: { value: '15.42' }, orderLineItems: [{ marketplaceFee: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: '0.00' } }, { feeType: 'X', amount: { value: '1.10' } }] }] });
  ok(JSON.stringify(again.map((c) => c.idempotencyKey)) === JSON.stringify(c4.map((c) => c.idempotencyKey)) && new Set(c4.map((c) => c.idempotencyKey)).size === c4.length, 'component keys derive from the provider transactionId + sub-key: stable on repeat, unique within a transaction');
  ok(c4.every((c) => c.idempotencyKey.includes('T4')), 'every key carries the provider transaction identity');
}

console.log('\n-- qualifying-order selection --');
{
  const paid = (id) => order(id, WANT);
  ok(selectQualifyingOrder([paid('A')]).kind === 'CONFIRMED_SALE', 'one paid order -> the sale');
  ok(selectQualifyingOrder([paid('A'), order('B', WANT, { orderPaymentStatus: 'PENDING' })]).order.orderId === 'A', 'one paid + one unpaid -> the paid one');
  ok(selectQualifyingOrder([paid('A'), paid('B')]).kind === 'MULTIPLE_PAID', 'two paid orders for a one-of-one listing are never silently resolved');
  ok(selectQualifyingOrder([order('C', WANT, { orderPaymentStatus: 'PENDING' })]).kind === 'AMBIGUOUS', 'an unpaid order is AMBIGUOUS, not a sale');
  ok(selectQualifyingOrder([order('D', WANT, { cancelStatus: { cancelState: 'CANCEL_CLOSED' } })]).kind === 'CANCELLED', 'a cancelled order is not a sale');
  ok(selectQualifyingOrder([]).kind === 'NO_ORDER' && selectQualifyingOrder(null).kind === 'NO_ORDER', 'no orders -> NO_ORDER');
  ok(selectQualifyingOrder([order('E', WANT, { orderPaymentStatus: undefined })]).kind === 'AMBIGUOUS', 'a missing payment status is never treated as paid');
}

console.log('\n-- durable SOLD carries the outcome id to another device --');
{
  const p = patchFromDurableListing({ id: 'cv', status: 'listed', ebayItemId: WANT }, { externalListingId: WANT, state: 'SOLD', soldOutcomeEventId: 'oe-9', soldAt: 77 });
  ok(p.status === 'sold' && p.soldOutcomeEventId === 'oe-9' && p.soldAt === 77, 'a second device learns the SOLD outcome id and time from the ledger');
  ok(patchFromDurableListing({ id: 'cv', status: 'sold', ebayItemId: WANT, ebayUrl: 'https://www.ebay.com/itm/' + WANT, soldOutcomeEventId: 'oe-9', soldAt: 77 }, { externalListingId: WANT, state: 'SOLD', soldOutcomeEventId: 'oe-9', soldAt: 77 }) === null, 'idempotent');
}

global.fetch = realFetch;

console.log('\n-- source assertions (fail, never skip) --');
{
  const app = read('src/App.jsx');
  ok(/data-testid="check-for-sale"/.test(app) && /Check for Sale/.test(app), 'the published-listing card renders a "Check for Sale" button');
  ok(/authFetch\("\/api\/ebay-outcome-reconciler"/.test(app) && /externalListingId: String\(item\.ebayItemId\)/.test(app), 'it calls the existing authenticated reconciler with the card\'s eBay ItemID');
  ok(/authFetch\(`\/api\/assets\?collectionItemId=/.test(app) && /graph\?\.asset\?\.asset\?\.id/.test(app), 'the physical asset is resolved through the ownership-checked graph, never from the card');
  ok(/const view = interpretSaleCheck\(res\.status, body\);\s*\n\s*if \(view\.patch\) applyItemPatch/.test(app), 'the card changes ONLY through the patch returned by interpretSaleCheck');
  ok(!/applyItemPatch\(item\.id, \{ status: ["']sold["']/.test(app), 'no code path sets status "sold" outside the verified patch');
  ok(/postage-form/.test(app) && /authFetch\("\/api\/outcome-economics"/.test(app) && /buildPostageRequest/.test(app), 'off-eBay postage is entered through the existing POST /api/outcome-economics');
  ok(/formatKnownAmount/.test(app) && /Profit/.test(app) && /acquisition cost not recorded/.test(app), 'amounts render via formatKnownAmount (UNKNOWN never $0) and profit is shown as unknown');
  ok(/'soldOutcomeEventId', 'soldOrderId', 'saleVerifiedAt', 'economicsView'/.test(app), 'the login hydrate keeps the verified-sale fields');
  ok(!/Check for Sale[\s\S]{0,400}AddFixedPriceItem/.test(app), 'the sale check never touches the publish path');
  const rec = read('src/lib/ebayOutcomeReconciler.js');
  ok(/searchOrdersForListing/.test(rec) && !/findOrderByLegacyItemId\(/.test(rec.replace(/\/\/.*$/gm, '')), 'the reconciler uses the paginated search (not the first-page-only finder)');
  ok(/status: 'ORDER_SEARCH_INCOMPLETE'/.test(rec) && /status: 'ORDER_LOOKUP_FAILED', retryable: true/.test(rec), 'an incomplete or failed search is a retryable error status');
  const ff = read('src/lib/ebayFulfillmentFinances.js');
  ok(!/api\.ebay\.com\/sell\/finances/.test(ff) && /apiz\.ebay\.com\/sell\/finances\/v1/.test(ff), 'the old api.ebay.com Finances host is gone');
  ok(!/method:\s*['"](POST|PUT|DELETE|PATCH)/i.test(ff), 'the Fulfillment/Finances client makes no write call');
  const repo = read('src/modules/assets/repository.js');
  ok(!/COALESCE\(SUM\(amount\) FILTER \(WHERE component_type = 'fees'\), 0\)/.test(repo), 'the COALESCE-to-zero aggregation is gone from getRealizedEconomics');
  ok(!/^(export )?(const|function) .*migration/im.test(read('src/lib/economicsView.js')), 'no schema/migration concern in the economics module');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
