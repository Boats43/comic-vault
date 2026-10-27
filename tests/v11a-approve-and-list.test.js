// tests/v11a-approve-and-list.test.js -- V1.1a Phase 1 (pure, DB-free, network-free).
//
// Covers: src/lib/q41Authority.js (rules + payloads byte-identical to the former inline buttons), src/lib/operatorListAction.js
// (LIST-authority planning + the recorder with the pending-idempotency-key lifecycle), and src/lib/approveAndList.js (the one-action
// orchestration: strict order, abort-on-first-failure with NO later side effect, explicit confirmation, single flight, price binding,
// refused / failed / uncertain / listed classification).
//
// Invoke: node tests/v11a-approve-and-list.test.js

// localStorage stub: operatorActionIdempotency keeps its pending keys there.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };

const { deriveQ41Requirement, buildQ41Payload, buildQ41Ack, buildQ41Override, isQ41AckPriceValid, Q41_KIND } = await import('../src/lib/q41Authority.js');
const { planListAuthority, recordListAction, amountsEqual } = await import('../src/lib/operatorListAction.js');
const { approveAndList, AAL_STATUS, AAL_STEP, SHIPPING_RETURNS_NOTICE } = await import('../src/lib/approveAndList.js');
const { getPendingIdempotencyKey } = await import('../src/lib/operatorActionIdempotency.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (got ${JSON.stringify(a)})`}`);

const INSUFF = [{ code: 'no-sold-evidence', class: 'insufficiency', reason: 'No verified sold evidence.' }];
const mkItem = (over = {}) => ({ id: 'item-1', title: 'Old Man Logan', issue: '25', priceOverridden: true,
  contract: { state: 'REVIEW', listable: false, locks: INSUFF, decision: { action: 'RESEARCH' } }, ...over });

console.log('\n--- 1. Q41 rules (extracted verbatim from the inline buttons) ---');
{
  const r = deriveQ41Requirement({ contract: mkItem().contract, priceOverridden: true, q41Ack: null, price: 15.42 });
  ok(r.kind === Q41_KIND.INSUFFICIENCY && r.required && !r.acknowledged && r.canAcknowledge, 'insufficiency locks + manual price: acknowledgeable, not yet acknowledged');
  ok(!deriveQ41Requirement({ contract: mkItem().contract, priceOverridden: false, q41Ack: null, price: 15.42 }).canAcknowledge, 'insufficiency locks WITHOUT a manual price: not acknowledgeable');
  ok(deriveQ41Requirement({ contract: mkItem().contract, priceOverridden: true, q41Ack: { price: 15.42 }, price: 15.42 }).acknowledged, 'an ack bound to this exact price counts');
  ok(!deriveQ41Requirement({ contract: mkItem().contract, priceOverridden: true, q41Ack: { price: 15.42 }, price: 16 }).acknowledged, 'a CHANGED price invalidates the ack (price-bound)');
  ok(isQ41AckPriceValid({ price: 15.42 }, 15.425) && !isQ41AckPriceValid({ price: 15.42 }, 15.44) && !isQ41AckPriceValid(null, 15.42), 'price binding tolerance is 1.1 cents');
  const integ = deriveQ41Requirement({ contract: { state: 'REVIEW', listable: false, locks: [{ code: 'manual-review', class: 'integrity' }] }, priceOverridden: true, price: 10 });
  ok(integ.kind === Q41_KIND.BLOCKED && !integ.canAcknowledge, 'an INTEGRITY lock is never acknowledgeable');
  ok(deriveQ41Requirement({ contract: { state: 'REFUSED', listable: false, locks: [] }, priceOverridden: true, price: 10 }).kind === Q41_KIND.BLOCKED, 'REFUSED is never acknowledgeable (contract law)');
  const research = deriveQ41Requirement({ contract: { state: 'REVIEW', listable: false, locks: [], decision: { action: 'RESEARCH' } }, priceOverridden: false, price: 12 });
  ok(research.kind === Q41_KIND.RESEARCH_NOT_LISTABLE && research.canAcknowledge, 'lockless RESEARCH card: acknowledgeable with a price');
  ok(!deriveQ41Requirement({ contract: { state: 'REVIEW', listable: false, locks: [] }, price: 0 }).canAcknowledge, '... but not without a price');
  eq([deriveQ41Requirement({ contract: { state: 'READY', listable: true, locks: [] }, price: 12 }).kind, deriveQ41Requirement({ contract: null, price: 12 }).kind], ['NONE', 'NONE'], 'READY / no contract: no acknowledgement needed');

  // payloads: BYTE-IDENTICAL to the objects the two inline buttons used to build
  const it = mkItem();
  eq(buildQ41Payload({ kind: Q41_KIND.INSUFFICIENCY, item: it, price: 15.42 }),
    { title: 'Old Man Logan', issue: '25', state: 'REVIEW', decision: 'RESEARCH', manualPrice: 15.42, priceOverridden: true, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'] },
    'insufficiency payload == the former inline payload');
  const ri = { title: 'X', issue: null, priceOverridden: false, contract: { state: 'REVIEW', listable: false, locks: [], decision: { action: 'RESEARCH' } } };
  eq(buildQ41Payload({ kind: Q41_KIND.RESEARCH_NOT_LISTABLE, item: ri, price: 9.5 }),
    { title: 'X', issue: null, state: 'REVIEW', decision: 'RESEARCH', manualPrice: 9.5, priceOverridden: false, lockClassAcknowledged: 'research-not-listable', locks: [] },
    'research-not-listable payload == the former inline payload');
  eq(buildQ41Payload({ kind: Q41_KIND.RESEARCH_NOT_LISTABLE, item: { ...ri, contract: { state: 'REVIEW', listable: false, locks: [] } }, price: 9.5 }).decision, 'REVIEW', 'research payload defaults the decision to REVIEW');
  let threw = false; try { buildQ41Payload({ kind: Q41_KIND.NONE, item: it, price: 1 }); } catch { threw = true; }
  ok(threw, 'no payload can be built for a card that needs no acknowledgement');
  const ack = buildQ41Ack({ price: 15.42, payload: { a: 1 }, at: 7 });
  eq(ack, { price: 15.42, at: 7, payload: { a: 1 } }, 'ack shape');
  eq(buildQ41Override({ item: { ...it, q41Ack: ack }, overridePrice: 15.42, displayPrice: 99 }), { a: 1, listedPrice: 15.42 }, 'q41Override = payload + listedPrice (override price wins)');
  eq(buildQ41Override({ item: { ...it, q41Ack: ack }, overridePrice: 0, displayPrice: 99 }).listedPrice, 99, '... display price when no override');
  ok(buildQ41Override({ item: { ...it, contract: { ...it.contract, listable: true }, q41Ack: ack }, overridePrice: 1, displayPrice: 1 }) === null, 'no override on a listable card');
}

console.log('\n--- 2. LIST authority planning ---');
{
  const graph = (over = {}) => ({ currentDecisionId: 'dec-1', currentOperatorActionId: 'oa-1', operatorActions: [{ id: 'oa-1', action_code: 'LIST', action_value_amount: '15.42' }], ...over });
  ok(planListAuthority({ graph: graph(), price: 15.42 }).satisfied, 'a current LIST at exactly this price is reused');
  const wrongPrice = planListAuthority({ graph: graph(), price: 16 });
  ok(!wrongPrice.satisfied && wrongPrice.needsRecord && wrongPrice.decisionEventId === 'dec-1', 'a LIST at a DIFFERENT price must be re-recorded');
  const hold = planListAuthority({ graph: graph({ operatorActions: [{ id: 'oa-1', action_code: 'HOLD', action_value_amount: null }] }), price: 15.42 });
  ok(!hold.satisfied && hold.needsRecord, 'a current HOLD is not LIST authority');
  const none = planListAuthority({ graph: graph({ currentDecisionId: null, currentOperatorActionId: null, operatorActions: [] }), price: 15.42 });
  ok(!none.satisfied && !none.needsRecord && /no recorded decision/.test(none.blockedReason), 'no decision: blocked (nothing can be recorded)');
  ok(planListAuthority({ graph: null, price: 1 }).needsRecord === false, 'no graph: nothing to plan');
  ok(amountsEqual('15.42', 15.42) && !amountsEqual('15.43', 15.42) && !amountsEqual(null, 15.42), 'cent-exact amount comparison');
}

console.log('\n--- 3. LIST recorder: request shape + pending-idempotency-key lifecycle ---');
{
  const calls = [];
  const mk = (resp) => async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return typeof resp === 'function' ? resp() : resp; };
  const base = { principalScope: 'scope-a', gkAssetId: 'asset-1', decisionEventId: 'dec-1', price: 15.42 };
  const okRes = { status: 200, ok: true, json: async () => ({ operatorActionEventId: 'oa-new' }) };
  const r1 = await recordListAction({ ...base, authFetch: mk(okRes) });
  ok(r1.ok && r1.operatorActionEventId === 'oa-new', 'success returns the new action id');
  eq(calls[0].body.actionValueAmount, '15.42', 'the approved price is recorded to the cent'); ok(calls[0].body.actionValueCurrency === 'USD' && calls[0].body.actionCode === 'LIST', 'USD + LIST');
  ok(getPendingIdempotencyKey({ principalScope: 'scope-a', gkAssetId: 'asset-1', decisionEventId: 'dec-1', actionCode: 'LIST' }) == null, 'a definitive answer retires the pending key');
  const r2 = await recordListAction({ ...base, authFetch: mk({ status: 503, ok: false, json: async () => ({}) }) });
  ok(!r2.ok && r2.ambiguous === true && /Click LIST again to safely retry/.test(r2.message), 'a bare 5xx is AMBIGUOUS (original wording kept)');
  const key1 = getPendingIdempotencyKey({ principalScope: 'scope-a', gkAssetId: 'asset-1', decisionEventId: 'dec-1', actionCode: 'LIST' });
  ok(!!key1, 'the pending key is RETAINED after an ambiguous outcome');
  await recordListAction({ ...base, authFetch: mk({ status: 503, ok: false, json: async () => ({}) }) });
  eq(calls[calls.length - 1].body.idempotencyKey, calls[calls.length - 2].body.idempotencyKey, 'the retry REUSES the same idempotency key');
  const r3 = await recordListAction({ ...base, authFetch: mk({ status: 409, ok: false, json: async () => ({ error: 'conflict' }) }) });
  ok(!r3.ok && !r3.ambiguous && r3.message === 'conflict', 'a definitive 409 is a refusal, not ambiguous');
  ok(getPendingIdempotencyKey({ principalScope: 'scope-a', gkAssetId: 'asset-1', decisionEventId: 'dec-1', actionCode: 'LIST' }) == null, '... and retires the key');
  const r4 = await recordListAction({ ...base, authFetch: async () => { throw new Error('socket'); } });
  ok(!r4.ok && r4.ambiguous && /Could not confirm the result/.test(r4.message), 'a network failure is ambiguous');
  const r5 = await recordListAction({ ...base, authFetch: async () => null });
  ok(!r5.ok && !r5.ambiguous && r5.message === 'Not signed in.', 'not signed in: not ambiguous, key retired');
  const hold2 = await recordListAction({ ...base, actionCode: 'HOLD', authFetch: mk(okRes) });
  ok(hold2.ok && calls[calls.length - 1].body.actionValueAmount === undefined, 'non-LIST actions carry no price (HOLD/PASS unchanged)');
}

console.log('\n--- 4. Approve & List orchestration ---');
// A fully scriptable dependency set that records every side effect in order.
function harness({ approve, ack, graph, record, publish, listed = false } = {}) {
  const log = [];
  const deps = {
    isListed: () => listed,
    approvePackage: async (a) => { log.push('approve'); return approve ? approve(a) : { ok: true, approval: { sig: 's' }, package: { price: { amount: a.price }, photos: { selected: [{ mediaId: 'm1' }] } } }; },
    acknowledgeQ41: async (a) => { log.push('q41'); return ack ? ack(a) : null; },
    getGraph: async () => { log.push('graph'); return graph === undefined ? { currentDecisionId: 'dec-1', currentOperatorActionId: 'oa-1', operatorActions: [{ id: 'oa-1', action_code: 'LIST', action_value_amount: '15.42' }] } : graph; },
    recordListAction: async (a) => { log.push('record'); return record ? record(a) : { ok: true, operatorActionEventId: 'oa-rec' }; },
    publish: async (a) => { log.push('publish'); return publish ? publish(a) : { ok: true, listingId: '111', listingUrl: 'https://www.ebay.com/itm/111' }; },
  };
  return { deps, log };
}
const run = (h, over = {}) => approveAndList({ item: mkItem(), price: 15.42, confirmed: true, deps: h.deps, ...over });
{
  let h = harness();
  let r = await run(h);
  ok(r.status === AAL_STATUS.LISTED && r.listingId === '111', 'happy path: LISTED');
  eq(h.log, ['approve', 'q41', 'graph', 'publish'], 'strict order: approve package -> Q41 -> LIST authority -> publish (LIST reused: no record)');
  eq(r.trail.map((t) => `${t.step}:${t.state}`).filter((x) => !x.endsWith(':running')), ['PREFLIGHT:ok', 'APPROVE_PACKAGE:ok', 'Q41:ok', 'LIST_AUTHORITY:ok', 'PUBLISH:ok'], 'every step reported');

  h = harness({ graph: { currentDecisionId: 'dec-1', currentOperatorActionId: null, operatorActions: [] } });
  r = await run(h);
  eq(h.log, ['approve', 'q41', 'graph', 'record', 'publish'], 'no current LIST: the LIST decision is recorded BEFORE publish, at the reviewed price');
  ok(r.status === AAL_STATUS.LISTED && r.artifacts.operatorActionEventId === 'oa-rec', 'the new action id is carried');

  // publish receives exactly the artifacts the server gates need
  let seen; h = harness({ publish: (a) => { seen = a; return { ok: true, listingId: '1' }; }, ack: ({ ack }) => ({ ...mkItem(), q41Ack: ack }) });
  await run(h);
  ok(!!seen.approval && seen.price === 15.42 && seen.q41Override?.manualPrice === 15.42 && seen.q41Override?.listedPrice === 15.42 && seen.q41Override?.lockClassAcknowledged === 'insufficiency', 'publish gets the signed approval and a price-bound Q41 override for the exact reviewed price');

  // READY card: Q41 skipped, never fabricated
  h = harness();
  r = await run(h, { item: mkItem({ contract: { state: 'READY', listable: true, locks: [] }, priceOverridden: false }) });
  eq(h.log, ['approve', 'graph', 'publish'], 'READY: Q41 is skipped (no acknowledgement manufactured)');
  ok(seen && r.trail.some((t) => t.step === 'Q41' && t.state === 'skipped'), 'and reported as skipped');
}
{
  // explicit confirmation + single flight
  let h = harness(); let r = await run(h, { confirmed: false });
  ok(r.status === AAL_STATUS.REFUSED && r.code === 'CONFIRMATION_REQUIRED' && h.log.length === 0, 'no confirmation: refused with ZERO side effects');
  r = await run(harness(), { confirmed: 'yes' }); ok(r.code === 'CONFIRMATION_REQUIRED', 'a truthy-but-not-true confirmation does not count');
  let release; h = harness({ approve: () => new Promise((res) => { release = () => res({ ok: true, approval: {}, package: { price: { amount: 15.42 } } }); }) });
  const first = run(h); await new Promise((res) => setTimeout(res, 10));
  const second = await run(harness());
  ok(second.status === AAL_STATUS.REFUSED && second.code === 'ALREADY_IN_PROGRESS', 'a second click while one is running is refused');
  release(); await first;
  r = await run(harness()); ok(r.status === AAL_STATUS.LISTED, '... and the guard is released afterwards');
  r = await run(harness({ listed: true })); ok(r.code === 'ALREADY_LISTED' && r.status === AAL_STATUS.REFUSED, 'an already-listed book is refused');
  r = await run(harness(), { price: 0 }); ok(r.code === 'NO_PRICE', 'no price: refused');
  h = harness(); r = await run(h, { item: mkItem({ contract: { state: 'REFUSED', listable: false, locks: [] } }) });
  ok(r.status === AAL_STATUS.REFUSED && r.code === 'Q41_BLOCKED' && h.log.length === 0, 'REFUSED contract: refused in preflight, no side effects');
  h = harness(); r = await run(h, { item: mkItem({ contract: { state: 'REVIEW', listable: false, locks: [{ code: 'manual-review', class: 'integrity' }] } }) });
  ok(r.code === 'Q41_BLOCKED' && h.log.length === 0, 'an integrity lock: refused in preflight');
  h = harness(); r = await run(h, { item: mkItem({ priceOverridden: false }) });
  ok(r.code === 'Q41_NOT_ACKNOWLEDGEABLE' && /Set your own list price/.test(r.message) && h.log.length === 0, 'insufficiency lock without a manual price: refused in preflight with guidance');
}
{
  // abort-on-first-failure: nothing after the failing step runs
  let h = harness({ approve: () => ({ ok: false, code: 'LISTING_PACKAGE_NOT_APPROVABLE', message: 'Resolve the blocking items.', blocking: [{ message: 'No eligible photograph.' }] }) });
  let r = await run(h);
  ok(r.status === AAL_STATUS.REFUSED && r.step === AAL_STEP.APPROVE_PACKAGE && r.blocking[0] === 'No eligible photograph.', 'package not approvable: REFUSED at APPROVE_PACKAGE with the blocking reasons');
  eq(h.log, ['approve'], '... and NOTHING after it ran (no Q41, no LIST record, no publish)');
  h = harness({ approve: () => { throw new Error('offline'); } }); r = await run(h);
  ok(r.status === AAL_STATUS.FAILED && r.step === AAL_STEP.APPROVE_PACKAGE && h.log.join() === 'approve', 'approve network failure: FAILED (safe to retry), nothing else ran');
  h = harness({ approve: (a) => ({ ok: true, approval: {}, package: { price: { amount: a.price + 1 } } }) }); r = await run(h);
  ok(r.code === 'PRICE_CHANGED' && h.log.join() === 'approve', 'approved package price differs from the reviewed price: REFUSED');
  h = harness({ ack: () => { throw new Error('disk'); } }); r = await run(h);
  ok(r.status === AAL_STATUS.FAILED && r.step === AAL_STEP.Q41 && h.log.join() === 'approve,q41', 'Q41 could not be saved: FAILED, no LIST record, no publish');
  h = harness({ ack: () => ({ ...mkItem(), q41Ack: undefined }) }); r = await run(h);
  ok(r.code === 'Q41_UNAVAILABLE' && !h.log.includes('publish'), 'an acknowledgement that is not in effect cannot proceed');
  h = harness({ graph: null }); r = await run(h);
  ok(r.status === AAL_STATUS.FAILED && r.code === 'GRAPH_UNAVAILABLE' && !h.log.includes('publish'), 'asset graph unavailable: FAILED before publish');
  h = harness({ graph: { currentDecisionId: null, operatorActions: [] } }); r = await run(h);
  ok(r.status === AAL_STATUS.REFUSED && r.code === 'NO_DECISION' && !h.log.includes('record') && !h.log.includes('publish'), 'no recorded decision: REFUSED, nothing recorded or published');
  h = harness({ graph: { currentDecisionId: 'd', operatorActions: [] }, record: () => ({ ok: false, ambiguous: true, message: 'Response 503 — outcome unknown. Click LIST again to safely retry.' }) }); r = await run(h);
  ok(r.status === AAL_STATUS.UNCERTAIN && r.code === 'LIST_ACTION_UNCERTAIN' && r.retrySafe && !h.log.includes('publish') && /Nothing was published/.test(r.message), 'LIST record ambiguous: UNCERTAIN, retry-safe, and publish did NOT run');
  h = harness({ graph: { currentDecisionId: 'd', operatorActions: [] }, record: () => ({ ok: false, ambiguous: false, message: 'conflict' }) }); r = await run(h);
  ok(r.status === AAL_STATUS.REFUSED && r.code === 'LIST_ACTION_REFUSED' && !h.log.includes('publish'), 'LIST record refused: REFUSED, no publish');
}
{
  // publish outcome classification
  const pub = (res) => harness({ publish: () => res });
  let r = await run(pub({ ok: false, status: 409, code: 'DUPLICATE_ACTIVE_LISTING', message: 'already has an active listing' }));
  ok(r.status === AAL_STATUS.REFUSED && r.code === 'DUPLICATE_ACTIVE_LISTING', 'duplicate listing: REFUSED (definitive)');
  r = await run(pub({ ok: false, status: 403, code: 'ACTION_AUTHORITY_NOT_READY', message: 'receipt required' }));
  ok(r.status === AAL_STATUS.REFUSED && r.code === 'ACTION_AUTHORITY_NOT_READY', 'a 403 gate refusal is REFUSED and shown with its code');
  r = await run(pub({ ok: false, status: 409, code: 'LISTING_PACKAGE_APPROVAL_REQUIRED', message: 'stale' }));
  ok(r.status === AAL_STATUS.REFUSED, 'a stale/expired approval at the server is REFUSED (the server is the authority)');
  for (const [res, label] of [[{ ok: false, status: 502, code: null, message: 'x' }, '5xx'], [{ ok: false, status: null, code: null, message: 'socket hang up' }, 'network'],
    [{ ok: false, status: 409, code: 'PUBLICATION_IN_PROGRESS', message: 'x' }, 'publication in progress'], [{ ok: false, status: 502, code: 'DUPLICATE_UUID_UNVERIFIED', message: 'x' }, 'unverified duplicate UUID']]) {
    r = await run(pub(res));
    ok(r.status === AAL_STATUS.UNCERTAIN && r.retrySafe === true && /Seller Hub|Check for Sale/.test(r.message), `${label}: UNCERTAIN with retry-safe guidance (never reported as a clean refusal)`);
  }
  const thrown = harness({ publish: () => { throw Object.assign(new Error('boom'), { status: 500 }); } });
  r = await run(thrown); ok(r.status === AAL_STATUS.UNCERTAIN, 'a thrown publish error with status 500 is UNCERTAIN');
  let cbThrew = false; r = await approveAndList({ item: mkItem(), price: 15.42, confirmed: true, deps: harness().deps, onStep: () => { cbThrew = true; throw new Error('ui'); } });
  ok(r.status === AAL_STATUS.LISTED && cbThrew, 'a throwing UI progress callback can never break the flow');
  ok(/does NOT cover shipping or return terms/.test(SHIPPING_RETURNS_NOTICE), 'the shipping/returns limitation is stated');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
