// tests/o1-first-sale-live.test.js -- OUTCOME #1 FIRST SALE RECONCILIATION (2026-10-26).
//
// REAL api/ebay-outcome-reconciler.js + api/outcome-economics.js + api/assets.js handlers, REAL Development Postgres
// (throwaway principals/assets, the repo's append-only-fixture convention). eBay is a stand-in only: Trading
// (publish) via tests/helpers/gkp0Harness.mjs, plus mocked Fulfillment and Finances that REFUSE any non-GET call.
// NO live eBay call is possible.
//
//   node tests/o1-first-sale-live.test.js

import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrap, repoRoot } from './helpers/gkp0Harness.mjs';

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };

// Provider order/transaction ids are unique in reality and the reconciler derives idempotency keys from them (they persist in the DB),
// so every fixture id is made unique per run.
const RUN = Date.now().toString(36);
const U = (id) => `${id}-${RUN}`;
const registryFile = path.join(os.tmpdir(), `o1-registry-${Date.now()}-${process.pid}.json`);
const h = await bootstrap({ registryFile });
const baseFetch = global.fetch;
const ebay = { fulfillment: null, finances: null, calls: [] };
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const isF = u.includes('/sell/fulfillment/v1/order');
  const isT = u.includes('/sell/finances/v1/transaction');
  if (isF || isT) {
    const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET') throw new Error(`o1 mock: eBay ${isF ? 'Fulfillment' : 'Finances'} was called with ${method} -- the reconciler must be GET-only`);
    ebay.calls.push({ kind: isF ? 'fulfillment' : 'finances', url: u });
    const fn = isF ? ebay.fulfillment : ebay.finances;
    if (!fn) throw new Error('o1 mock: no scenario installed');
    return fn(u);
  }
  return baseFetch(url, opts);
};
const respond = (json, status = 200) => ({ ok: status < 400, status, statusText: status < 400 ? 'OK' : 'ERR', json: async () => json });
const qs = (u) => Object.fromEntries(new URL(u).searchParams.entries());
const fOrder = (orderId, itemId, extra = {}) => ({ orderId, creationDate: new Date().toISOString(), orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'NONE_REQUESTED' }, lineItems: [{ legacyItemId: itemId }], pricingSummary: { total: { value: '15.42', currency: 'USD' } }, ...extra });
const serveOrders = (all) => (u) => { const q = qs(u); const off = Number(q.offset), lim = Number(q.limit); return respond({ total: all.length, orders: all.slice(off, off + lim), limit: lim, offset: off }); };
const serveTxns = (all) => (u) => { const q = qs(u); const off = Number(q.offset), lim = Number(q.limit); return respond({ total: all.length, transactions: all.slice(off, off + lim) }); };
const sale = (id, orderId, amount, fee) => ({ transactionId: id, transactionType: 'SALE', orderId, transactionDate: new Date().toISOString(), amount: { value: String(amount), currency: 'USD' }, orderLineItems: fee == null ? [] : [{ marketplaceFee: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: String(fee) } }] }] });
const label = (id, orderId, amount) => ({ transactionId: id, transactionType: 'SHIPPING_LABEL', bookingEntry: 'DEBIT', orderId, transactionDate: new Date().toISOString(), amount: { value: String(amount), currency: 'USD' } });

const reconHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-outcome-reconciler.js')).href)).default;
const econHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'outcome-economics.js')).href)).default;
let ipn = 0;
const ipHdr = () => ({ 'x-forwarded-for': `10.7.${Math.floor(++ipn / 200)}.${ipn % 200}` });
const bearer = (pid) => ({ authorization: `Bearer ${h.issueToken({ principalId: pid }).token}`, ...ipHdr() });
async function reconcile(pid, gkAssetId, externalListingId) { const res = h.mockRes(); await reconHandler({ method: 'POST', headers: bearer(pid), body: { gkAssetId, externalListingId } }, res); return res; }
async function econGet(pid, outcomeEventId) { const res = h.mockRes(); await econHandler({ method: 'GET', headers: bearer(pid), query: { outcomeEventId } }, res); return res; }
async function econPost(pid, body) { const res = h.mockRes(); await econHandler({ method: 'POST', headers: bearer(pid), body }, res); return res; }
async function listingsOf(pid) { const res = h.mockRes(); await h.assetsHandler({ method: 'GET', headers: bearer(pid), query: { listings: '1' } }, res); return res; }

async function snap(assetId) {
  const q = async (sql) => (await h.db.query(sql, [assetId])).rows[0].n;
  return {
    outcomes: await q('SELECT count(*)::int AS n FROM data1_dev.outcome_event WHERE gk_asset_id = $1'),
    sold: await q("SELECT count(*)::int AS n FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND outcome_type = 'SOLD'"),
    components: await q('SELECT count(*)::int AS n FROM data1_dev.outcome_economics_component c JOIN data1_dev.outcome_event o ON o.id = c.outcome_event_id WHERE o.gk_asset_id = $1'),
    inventory: await q('SELECT count(*)::int AS n FROM data1_dev.inventory_transition_event WHERE gk_asset_id = $1'),
    events: await q("SELECT count(*)::int AS n FROM data1_dev.domain_event WHERE subject::text LIKE '%' || $1 || '%'"),
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function listedAsset(pid, name) {
  const a = await h.mint(pid, name, h.READY_AUTHORITY);
  const p = await h.publish(pid, a, { ready: true });
  if (p.statusCode !== 200) throw new Error(`fixture publish failed for ${name}: ${p.statusCode} ${p.body?.error}`);
  return { a, listingId: p.body.listingId };
}

console.log('\n=== Outcome #1 first sale: reconciler handler, real Development DB, mocked eBay ===\n');
const PA = await h.newPrincipal('o1-owner');
const PB = await h.newPrincipal('o1-other');

try {
  // ── 41. no order -> NO_ORDER_YET, zero writes ──
  console.log('-- 41/51/50: no order, unrelated order, ended listing --');
  const L1 = await listedAsset(PA, 'noorder');
  ebay.fulfillment = serveOrders([]); ebay.finances = serveTxns([]); ebay.calls.length = 0;
  let before = await snap(L1.a.gkAssetId);
  const r41 = await reconcile(PA, L1.a.gkAssetId, L1.listingId);
  ok(r41.statusCode === 200 && r41.body.status === 'NO_ORDER_YET', `no order -> NO_ORDER_YET (${r41.statusCode} ${r41.body?.status})`);
  ok(same(before, await snap(L1.a.gkAssetId)), 'ZERO writes: outcome, component, inventory and domain-event counts all unchanged');
  ok(ebay.calls.length === 1 && ebay.calls[0].kind === 'fulfillment' && ebay.calls[0].url.includes('limit=200'), 'one paginated Fulfillment read, and no Finances call without an order');
  ok(r41.body.search?.complete === true && r41.body.search.pagesFetched === 1, 'the response reports a COMPLETE search (so "no order" is a real finding)');
  const lst = await listingsOf(PA);
  ok(lst.body.listings.find((l) => l.externalListingId === L1.listingId)?.state === 'LISTED', 'the listing stays LISTED');

  // 50. unrelated order (same comic title, other ItemID)
  ebay.fulfillment = serveOrders([fOrder(U('O-OTHER'), '123456789012', { lineItems: [{ legacyItemId: '123456789012', title: 'Old Man Logan #25' }] })]);
  before = await snap(L1.a.gkAssetId);
  const r50 = await reconcile(PA, L1.a.gkAssetId, L1.listingId);
  ok(r50.body.status === 'NO_ORDER_YET' && same(before, await snap(L1.a.gkAssetId)), 'an unrelated order (same comic title, different ItemID) is NOT this listing\'s sale: NO_ORDER_YET, zero writes');

  // 51. ended listing without a sale
  ebay.fulfillment = serveOrders([]);
  const E1 = await listedAsset(PA, 'ended-nosale');
  const r51 = await reconcile(PA, E1.a.gkAssetId, E1.listingId);
  ok(r51.body.status === 'NO_ORDER_YET' && (await snap(E1.a.gkAssetId)).sold === 0, 'a listing that simply ended/has no order produces NO SOLD');
  const E2 = await listedAsset(PA, 'ended-delisted');
  await h.closeListing(PA, E2.a.gkAssetId, E2.listingId);
  ebay.fulfillment = serveOrders([fOrder(U('O-E2'), E2.listingId)]);
  before = await snap(E2.a.gkAssetId);
  const r51b = await reconcile(PA, E2.a.gkAssetId, E2.listingId);
  ok(r51b.body.status === 'ALREADY_TERMINAL_UNSOLD' && same(before, await snap(E2.a.gkAssetId)), 'a listing already DELISTED is never re-evaluated for SOLD, even if an order appears: zero writes');

  // ── 48. incomplete / failed search -> verification error, not NO_ORDER_YET ──
  console.log('\n-- 48: failed or incomplete search is a verification error --');
  const L2 = await listedAsset(PA, 'incomplete');
  ebay.fulfillment = (u) => (Number(qs(u).offset) === 0 ? respond({ total: 400, orders: Array.from({ length: 200 }, (_, i) => fOrder(`F-${i}`, '111111111111')) }) : respond({ errors: [{ message: 'upstream' }] }, 503));
  before = await snap(L2.a.gkAssetId);
  const r48 = await reconcile(PA, L2.a.gkAssetId, L2.listingId);
  ok(r48.statusCode === 200 && r48.body.status === 'ORDER_LOOKUP_FAILED' && r48.body.retryable === true, `page 2 fails -> ORDER_LOOKUP_FAILED, retryable (${r48.body?.status})`);
  ok(r48.body.status !== 'NO_ORDER_YET' && same(before, await snap(L2.a.gkAssetId)), 'it is NOT reported as "no order" and nothing is written');
  const rep = Array.from({ length: 200 }, (_, i) => fOrder(`G-${i}`, '111111111111'));
  ebay.fulfillment = () => respond({ total: 100000, orders: rep });
  const r48b = await reconcile(PA, L2.a.gkAssetId, L2.listingId);
  ok(r48b.body.status === 'ORDER_SEARCH_INCOMPLETE' && r48b.body.retryable === true && same(before, await snap(L2.a.gkAssetId)), 'a provider that repeats a page cannot loop the search: ORDER_SEARCH_INCOMPLETE, retryable, zero writes');

  // ── 47. multiple pages ──
  console.log('\n-- 47/42: paid order found on page 3 -> one governed SOLD --');
  const L3 = await listedAsset(PA, 'paged');
  const decoys = Array.from({ length: 450 }, (_, i) => fOrder(`H-${i}`, `1000000${String(i).padStart(5, '0')}`));
  decoys[440] = fOrder(U('O-REAL'), L3.listingId);
  decoys[3] = fOrder(U('O-SAMETITLE'), '999999999999', { lineItems: [{ legacyItemId: '999999999999', title: 'Old Man Logan #25' }] });
  ebay.fulfillment = serveOrders(decoys); ebay.finances = serveTxns([]); ebay.calls.length = 0;
  const r47 = await reconcile(PA, L3.a.gkAssetId, L3.listingId);
  ok(r47.statusCode === 200 && r47.body.status === 'SOLD_CONFIRMED' && r47.body.orderId === U('O-REAL'), `the matching order is found across pages -> SOLD_CONFIRMED (${r47.statusCode} ${r47.body?.status} ${r47.body?.orderId} ${r47.body?.status ? '' : JSON.stringify(r47.body).slice(0, 200)})`);
  ok(ebay.calls.filter((c) => c.kind === 'fulfillment').map((c) => qs(c.url).offset).join() === '0,200,400', 'pages 0/200/400 were read with the documented offset parameter');
  const s47 = await snap(L3.a.gkAssetId);
  ok(s47.sold === 1, 'exactly ONE SOLD outcome_event');
  const soldRow = (await h.db.query("SELECT id, external_listing_id, channel FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND outcome_type = 'SOLD'", [L3.a.gkAssetId])).rows[0];
  ok(soldRow.external_listing_id === L3.listingId && soldRow.channel === 'ebay', 'the SOLD row preserves the original eBay listing association');
  const ref = (await h.db.query("SELECT external_order_id FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1 AND component_type = 'order_reference'", [soldRow.id])).rows[0];
  ok(ref?.external_order_id === U('O-REAL'), 'the external order id is preserved as an order_reference component');
  const inv = (await h.db.query('SELECT state FROM data1_dev.inventory_current_state WHERE gk_asset_id = $1', [L3.a.gkAssetId])).rows[0];
  ok(inv?.state === 'SOLD' && r47.body.inventory?.applied === true, 'governed inventory closeout applied: state SOLD');
  const lst3 = await listingsOf(PA);
  const ent = lst3.body.listings.find((l) => l.externalListingId === L3.listingId);
  ok(ent?.state === 'SOLD' && ent.soldOutcomeEventId === soldRow.id, 'a second device sees SOLD + the outcome id from GET /api/assets?listings=1');
  ok(ebay.calls.every((c) => c.url.startsWith('https://api.ebay.com/sell/fulfillment/') || c.url.startsWith('https://apiz.ebay.com/sell/finances/')), 'Fulfillment on api.ebay.com, Finances on apiz.ebay.com');

  // 43. repeat
  console.log('\n-- 43: repeat reconciliation --');
  const rep3 = await reconcile(PA, L3.a.gkAssetId, L3.listingId);
  const s43 = await snap(L3.a.gkAssetId);
  ok(rep3.body.status === 'ALREADY_SOLD_ENRICHED' && rep3.body.outcomeEventId === soldRow.id && s43.sold === 1 && s43.components === s47.components, 'no duplicate SOLD and no duplicate components');
  // relisting after SOLD is refused before any provider call
  const callsBefore = h.reg().calls.length;
  const relist = await h.publish(PA, L3.a, { ready: true });
  ok(relist.statusCode === 409 && relist.body?.error === 'AUTHORITATIVE_SOLD_EXISTS' && h.reg().calls.length === callsBefore, 'after SOLD a republish is refused with ZERO provider calls (AUTHORITATIVE_SOLD_EXISTS)');

  // ── 44/45: delayed fees, UNKNOWN ──
  console.log('\n-- 44/45: delayed fees -> PENDING, then reconciled; missing components stay UNKNOWN --');
  const L4 = await listedAsset(PA, 'delayed');
  ebay.fulfillment = serveOrders([fOrder(U('O-DEL'), L4.listingId)]); ebay.finances = serveTxns([]);
  const d1 = await reconcile(PA, L4.a.gkAssetId, L4.listingId);
  ok(d1.body.status === 'SOLD_CONFIRMED' && d1.body.economicsStatus === 'PENDING' && d1.body.economics.gross === null && d1.body.economics.realizedNet === null, 'sale confirmed, no Finances rows yet -> economics PENDING; gross and net are UNKNOWN (null)');
  ok(d1.body.economicsView.netProceeds.status === 'UNKNOWN' && d1.body.economicsView.profit.status === 'UNKNOWN', 'the operator view shows net and profit as UNKNOWN');
  const oe4 = d1.body.outcomeEventId;
  ebay.finances = serveTxns([sale(U('T-D-SALE'), U('O-DEL'), 15.42, 2.1)]);
  const d2 = await reconcile(PA, L4.a.gkAssetId, L4.listingId);
  ok(d2.body.status === 'ALREADY_SOLD_ENRICHED' && d2.body.outcomeEventId === oe4 && (await snap(L4.a.gkAssetId)).sold === 1, 'fees arrive later: SAME SOLD outcome enriched, no second SOLD');
  ok(d2.body.economicsStatus === 'INCOMPLETE' && d2.body.economics.fees === 2.1 && d2.body.economics.shipping === null && d2.body.economics.realizedNet === null, 'gross+fees known, postage UNKNOWN -> INCOMPLETE and NO net (postage is not read as $0)');
  ok(d2.body.economicsView.canRecordPostage === true && d2.body.economicsView.missing.join() === 'shipping', 'the view says exactly what is missing and offers the postage entry');
  ebay.finances = serveTxns([sale(U('T-D-SALE'), U('O-DEL'), 15.42, 2.1), label(U('T-D-LABEL'), U('O-DEL'), 4.5)]);
  const d3 = await reconcile(PA, L4.a.gkAssetId, L4.listingId);
  ok(d3.body.economicsStatus === 'COMPLETE' && Math.abs(d3.body.economics.realizedNet - 8.82) < 1e-9, `with an eBay label transaction the net becomes KNOWN: 15.42 - 2.10 - 4.50 = 8.82 (${d3.body.economics.realizedNet})`);
  const c3 = (await snap(L4.a.gkAssetId)).components;
  await reconcile(PA, L4.a.gkAssetId, L4.listingId);
  ok((await snap(L4.a.gkAssetId)).components === c3, 'repeating reconciliation does not duplicate fee, sale or label components (keyed by provider transaction id)');

  // Finances outage after a confirmed sale
  const L4b = await listedAsset(PA, 'finances-down');
  ebay.fulfillment = serveOrders([fOrder(U('O-FD'), L4b.listingId)]); ebay.finances = () => respond({ errors: [{ message: 'down' }] }, 503);
  const fd = await reconcile(PA, L4b.a.gkAssetId, L4b.listingId);
  ok(fd.body.status === 'SOLD_CONFIRMED' && fd.body.financesComplete === false && fd.body.incomplete === true && fd.body.economicsStatus === 'PENDING', 'a Finances outage after a confirmed sale: SOLD recorded once, economics PENDING, the incompleteness is reported');
  ebay.finances = serveTxns([sale(U('T-FD-SALE'), U('O-FD'), 15.42, 2.1)]);
  const fd2 = await reconcile(PA, L4b.a.gkAssetId, L4b.listingId);
  ok(fd2.body.status === 'ALREADY_SOLD_ENRICHED' && fd2.body.financesComplete === true && (await snap(L4b.a.gkAssetId)).sold === 1, 'when Finances recovers the same outcome is enriched');

  // ── 46: explicit zero ──
  console.log('\n-- 46: an explicit verified zero is $0, distinct from UNKNOWN --');
  const L5 = await listedAsset(PA, 'zero');
  ebay.fulfillment = serveOrders([fOrder(U('O-Z'), L5.listingId)]); ebay.finances = serveTxns([sale(U('T-Z-SALE'), U('O-Z'), 15.42, '0.00')]);
  const z1 = await reconcile(PA, L5.a.gkAssetId, L5.listingId);
  ok(z1.body.economics.fees === 0 && z1.body.economics.present.fees === true, 'a fee line of 0.00 from eBay is a KNOWN $0');
  ok(z1.body.economics.shipping === null && z1.body.economics.present.shipping === false, 'while the absent postage is still UNKNOWN (null) -- the two are different');
  const zp = await econPost(PA, { outcomeEventId: z1.body.outcomeEventId, componentType: 'shipping', amount: 0, currency: 'USD', sourceReference: 'Receipt: buyer collected in person', externalOrderId: U('O-Z'), idempotencyKey: `operator-postage-${z1.body.outcomeEventId}-buyer collected in person` });
  ok(zp.statusCode === 200, `an explicit operator zero postage with a reference is accepted (${zp.statusCode})`);
  const zg = await econGet(PA, z1.body.outcomeEventId);
  ok(zg.body.shipping === 0 && zg.body.present.shipping === true && Math.abs(zg.body.realizedNet - 15.42) < 1e-9, 'with verified $0 fees and $0 postage the net is KNOWN and equals the sale amount');

  // ── 52: receipt-backed postage ──
  console.log('\n-- 52/21/22: receipt-backed off-eBay postage, recorded once --');
  const L6 = await listedAsset(PA, 'postage');
  ebay.fulfillment = serveOrders([fOrder(U('O-P'), L6.listingId)]); ebay.finances = serveTxns([sale(U('T-P-SALE'), U('O-P'), 15.42, 2.1)]);
  const p1 = await reconcile(PA, L6.a.gkAssetId, L6.listingId);
  const oe6 = p1.body.outcomeEventId;
  const post = { outcomeEventId: oe6, componentType: 'shipping', amount: 5.25, currency: 'USD', sourceReference: 'Receipt: USPS 9400 1234', externalOrderId: U('O-P'), evidenceNote: 'Operator-entered off-eBay postage', idempotencyKey: `operator-postage-${oe6}-usps 9400 1234` };
  const a1 = await econPost(PA, post);
  const a2 = await econPost(PA, post);
  const cnt = (await h.db.query("SELECT count(*)::int AS n, min(source) AS src FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1 AND component_type = 'shipping'", [oe6])).rows[0];
  ok(a1.statusCode === 200 && a2.statusCode === 200 && a1.body.componentId === a2.body.componentId && cnt.n === 1, 'the same receipt submitted twice is recorded ONCE (idempotent replay returns the same component)');
  ok(cnt.src === 'operator-entered', 'attribution is forced to operator-entered (never claimed as api-sourced)');
  const a3 = await econPost(PA, { ...post, amount: 9.99 });
  const cnt2 = (await h.db.query("SELECT count(*)::int AS n FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1 AND component_type = 'shipping'", [oe6])).rows[0].n;
  ok(a3.statusCode === 409 && cnt2 === 1, 'the same receipt with a DIFFERENT amount is refused (409) and nothing is added');
  const g6 = await econGet(PA, oe6);
  ok(g6.body.shipping === 5.25 && Math.abs(g6.body.realizedNet - (15.42 - 2.1 - 5.25)) < 1e-9, 'the recorded postage completes the net: 15.42 - 2.10 - 5.25 = 8.07');
  const afterRecon = await reconcile(PA, L6.a.gkAssetId, L6.listingId);
  ok(afterRecon.body.economics.shipping === 5.25 && afterRecon.body.economicsStatus === 'COMPLETE', 'a later reconciliation preserves the operator-entered postage');

  // ── 49: wrong principal ──
  console.log('\n-- 49: wrong principal --');
  const L7 = await listedAsset(PA, 'owner-only');
  ebay.fulfillment = serveOrders([fOrder(U('O-X'), L7.listingId)]); ebay.finances = serveTxns([sale(U('T-X'), U('O-X'), 15.42, 2.1)]);
  before = await snap(L7.a.gkAssetId);
  const w = await reconcile(PB, L7.a.gkAssetId, L7.listingId);
  ok(w.statusCode === 404 && same(before, await snap(L7.a.gkAssetId)), `another principal cannot reconcile the owner's listing (${w.statusCode}); zero writes even though a paid order exists`);
  const wEcon = await econGet(PB, oe6);
  ok(wEcon.statusCode === 404, 'another principal cannot read the owner\'s economics');
  const wPost = await econPost(PB, { ...post, idempotencyKey: 'foreign-attempt' });
  ok(wPost.statusCode === 404 && cnt2 === 1, 'another principal cannot add a component to the owner\'s sale');
  const lstB = await listingsOf(PB);
  ok(!lstB.body.listings.some((l) => l.externalListingId === L7.listingId), 'nor see the owner\'s listing state');
  const anon = h.mockRes(); await reconHandler({ method: 'POST', headers: ipHdr(), body: { gkAssetId: L7.a.gkAssetId, externalListingId: L7.listingId } }, anon);
  ok(anon.statusCode === 401, 'an unauthenticated call is refused');

  // multiple paid orders
  const L8 = await listedAsset(PA, 'two-paid');
  ebay.fulfillment = serveOrders([fOrder(U('O-T1'), L8.listingId), fOrder(U('O-T2'), L8.listingId)]);
  before = await snap(L8.a.gkAssetId);
  const mp = await reconcile(PA, L8.a.gkAssetId, L8.listingId);
  ok(mp.body.status === 'MULTIPLE_PAID_ORDERS' && same(before, await snap(L8.a.gkAssetId)), 'two paid orders for a one-of-one listing: nothing is recorded, manual review');
  // unpaid order
  const L9 = await listedAsset(PA, 'unpaid');
  ebay.fulfillment = serveOrders([fOrder(U('O-UNPAID'), L9.listingId, { orderPaymentStatus: 'PENDING' })]);
  before = await snap(L9.a.gkAssetId);
  const up = await reconcile(PA, L9.a.gkAssetId, L9.listingId);
  ok(up.body.status === 'AMBIGUOUS_NOT_SOLD' && same(before, await snap(L9.a.gkAssetId)), 'an unpaid order is not a sale: still LISTED, zero writes');
} finally {
  rmSync(registryFile, { force: true });
  await h.db.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
