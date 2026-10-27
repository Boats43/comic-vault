// tests/v11a-approve-and-list-live.test.js -- V1.1a Phase 1: the ONE-ACTION orchestrator driving the REAL server contracts.
//
// REAL: src/lib/approveAndList.js, q41Authority.js, operatorListAction.js, and the REAL handlers api/listing-preview.js (approve),
// api/assets.js (graph), api/operator-action.js (LIST at the exact price) and api/list-ebay.js (publish), against the REAL Development
// Postgres. The ONLY stand-in is eBay (tests/helpers/gkp0Harness.mjs: UUID-enforcing provider stand-in; a live call is impossible).
//
// Proves: the orchestrator creates every server artifact, bound to the exact reviewed content/price, in order; the server still
// independently refuses a tampered approval / Q41 amount / duplicate; exactly ONE provider listing is created per publication.
//
//   node tests/v11a-approve-and-list-live.test.js

import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrap, repoRoot } from './helpers/gkp0Harness.mjs';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; failures.push(l); console.log(`  FAIL ${l}`); } };

const registryFile = path.join(os.tmpdir(), `v11a-aal-registry-${Date.now()}-${process.pid}.json`);
const h = await bootstrap({ registryFile });
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const { approveAndList, AAL_STATUS } = await imp('src/lib/approveAndList.js');
const { recordListAction } = await imp('src/lib/operatorListAction.js');
const operatorActionHandler = (await imp('api/operator-action.js')).default;
const { reg, mint, ledger, outcomes, closeListing, NOT_READY_AUTHORITY: NOT_READY, READY_AUTHORITY: READY } = h;
const addCount = () => reg().calls.filter((c) => c === 'AddFixedPriceItem').length;
const listingCount = () => Object.keys(reg().listings).length;

let seq = 0;
const call = async (handler, req) => { const res = h.mockRes(); await handler(req, res); return res; };
const asFetchResponse = (r) => ({ status: r.statusCode, ok: r.statusCode >= 200 && r.statusCode < 300, json: async () => r.body });

/** Real-handler dependency set for the orchestrator. `tweak` lets a test corrupt exactly one artifact in transit. */
function liveDeps({ principalId, asset, item, ready = false, tweak = {} }) {
  const token = h.issueToken({ principalId }).token;
  const headers = () => ({ authorization: `Bearer ${token}`, 'x-forwarded-for': `aal-live-${++seq}` });
  const authFetch = async (url, opts) => {
    if (url === '/api/operator-action') return asFetchResponse(await call(operatorActionHandler, { method: 'POST', headers: headers(), body: JSON.parse(opts.body) }));
    throw new Error(`unexpected authFetch ${url}`);
  };
  let graphCache = null;
  const getGraph = async () => {
    if (!graphCache) { const r = await call(h.assetsHandler, { method: 'GET', headers: headers(), query: { collectionItemId: item.id } }); graphCache = r.statusCode === 200 ? r.body.asset : null; }
    return graphCache;
  };
  return {
    isListed: () => false,
    getGraph,
    approvePackage: async ({ price }) => {
      const g = await getGraph();
      if (!g) return { ok: false, code: 'GRAPH_UNAVAILABLE', message: 'GrailKey could not read this asset. Nothing was published.' };
      const r = await call(h.previewHandler, { method: 'POST', headers: headers(), body: { action: 'approve', gkAssetId: g.asset.id, price } });
      if (r.statusCode === 200 && r.body?.approval) return { ok: true, approval: r.body.approval, package: r.body.package };
      return { ok: false, code: r.body?.error, message: r.body?.message, blocking: (r.body?.package?.unresolved || []).filter((u) => u.severity === 'blocking') };
    },
    acknowledgeQ41: async ({ ack }) => ({ ...item, q41Ack: ack }),
    recordListAction: async ({ decisionEventId, price }) => {
      const g = await getGraph();
      graphCache = null; // the graph changes once a new action is recorded
      return recordListAction({ authFetch, principalScope: `scope-${principalId}`, gkAssetId: g.asset.id, decisionEventId, price });
    },
    publish: async ({ approval, q41Override, price, operatorActionEventId, decisionEventId }) => {
      const req = h.listRequest(principalId, asset, { ready });
      req.headers['x-forwarded-for'] = `aal-live-${++seq}`;
      req.body.price = `$${Number(price).toFixed(2)}`;
      req.body.operatorActionEventId = operatorActionEventId; req.body.decisionEventId = decisionEventId;
      if (q41Override) req.body.q41Override = tweak.q41Override ? tweak.q41Override(q41Override) : q41Override; else delete req.body.q41Override;
      req.body.listingApproval = tweak.approval ? tweak.approval(approval) : approval;
      const r = await call(h.rawListHandler, req);
      if (r.statusCode === 200) return { ok: true, listingId: r.body.listingId, listingUrl: r.body.listingUrl };
      return { ok: false, status: r.statusCode, code: r.body?.error, message: r.body?.message };
    },
  };
}
const itemFor = (asset, contract, extra = {}) => ({ id: asset.canonicalId, title: 'GKP0 Test Comic', issue: '1', priceOverridden: true, contract, ...extra });
const INSUFF_CONTRACT = { state: 'REVIEW', listable: false, decision: { action: 'RESEARCH' }, locks: [{ code: 'no-sold-evidence', class: 'insufficiency', reason: 'No verified sold evidence.' }] };
const READY_CONTRACT = { state: 'READY', listable: true, locks: [], decision: { action: 'LIST_NOW' } };
const created = [];

console.log('\n=== V1.1a Approve & List: one action, real server contracts (real handlers, real Development DB, UUID-enforcing eBay stand-in) ===\n');
const PA = await h.newPrincipal('v11a-aal-a');
const PB = await h.newPrincipal('v11a-aal-b');

try {
  console.log('-- A: non-READY book (Q41 + existing LIST at the reviewed price) -> ONE action lists it exactly once --');
  const a = await mint(PA, 'aal-q41', NOT_READY);
  const itemA = itemFor(a, INSUFF_CONTRACT);
  const before = listingCount();
  const rA = await approveAndList({ item: itemA, price: 25, confirmed: true, deps: liveDeps({ principalId: PA, asset: a, item: itemA }) });
  ok(rA.status === AAL_STATUS.LISTED && !!rA.listingId, `LISTED through the real server gates (${rA.status} ${rA.code} ${rA.message})`);
  if (rA.listingId) created.push({ principalId: PA, gkAssetId: a.gkAssetId, listingId: rA.listingId });
  ok(listingCount() === before + 1 && addCount() >= 1, 'exactly ONE provider listing was created');
  ok(JSON.stringify(await ledger(a.gkAssetId)) === JSON.stringify(['AUTHORIZED', 'SUBMITTED', 'LISTED_CONFIRMED']), 'attempt ledger: AUTHORIZED -> SUBMITTED -> LISTED_CONFIRMED');
  const oa = await outcomes(a.gkAssetId);
  ok(oa.length === 1 && oa[0].outcome_type === 'LISTED' && oa[0].external_listing_id === rA.listingId, 'a durable LISTED outcome names the provider listing');
  ok(rA.trail.some((t) => t.step === 'Q41' && t.state === 'ok') && rA.trail.some((t) => t.step === 'LIST_AUTHORITY' && t.state === 'ok'), 'the Q41 acknowledgement and the LIST authority were both satisfied (not skipped)');

  console.log('\n-- B: DUPLICATE: the same one action again is refused by the server, not by the UI --');
  const adds = addCount(); const listings = listingCount();
  const rB = await approveAndList({ item: itemA, price: 25, confirmed: true, deps: liveDeps({ principalId: PA, asset: a, item: itemA }) });
  ok(rB.status === AAL_STATUS.REFUSED && rB.step === 'PUBLISH' && rB.code === 'DUPLICATE_ACTIVE_LISTING', `second Approve & List -> REFUSED DUPLICATE_ACTIVE_LISTING at PUBLISH (${rB.status} ${rB.code})`);
  ok(addCount() === adds && listingCount() === listings, 'ZERO new provider calls and still exactly one listing');

  console.log('\n-- C: price differs from the recorded LIST action: the LIST decision is recorded at the NEW price, then published --');
  const c = await mint(PA, 'aal-newprice', NOT_READY);
  const itemC = itemFor(c, INSUFF_CONTRACT);
  const rC = await approveAndList({ item: itemC, price: 26, confirmed: true, deps: liveDeps({ principalId: PA, asset: c, item: itemC }) });
  ok(rC.status === AAL_STATUS.LISTED, `LISTED at $26 (${rC.status} ${rC.code} ${rC.message})`);
  if (rC.listingId) created.push({ principalId: PA, gkAssetId: c.gkAssetId, listingId: rC.listingId });
  const rows = await h.db.query(`SELECT action_code, action_value_amount::text AS amt FROM data1_dev.operator_action_event WHERE gk_asset_id = $1 ORDER BY recorded_at, id`, [c.gkAssetId]);
  ok(rows.rows.length === 2 && rows.rows[1].action_code === 'LIST' && rows.rows[1].amt === '26.00', `a second durable LIST was recorded at exactly $26.00 (${JSON.stringify(rows.rows.map((r) => r.amt))})`);
  ok(rC.artifacts?.operatorActionEventId && rC.artifacts.operatorActionEventId !== c.operatorActionEventId, 'the publish used the NEW LIST action');

  console.log('\n-- D: READY book: no Q41 is manufactured, still one listing --');
  const d = await mint(PA, 'aal-ready', READY);
  const itemD = itemFor(d, READY_CONTRACT, { priceOverridden: false });
  const rD = await approveAndList({ item: itemD, price: 25, confirmed: true, deps: liveDeps({ principalId: PA, asset: d, item: itemD, ready: true }) });
  ok(rD.status === AAL_STATUS.LISTED, `READY book LISTED (${rD.status} ${rD.code} ${rD.message})`);
  if (rD.listingId) created.push({ principalId: PA, gkAssetId: d.gkAssetId, listingId: rD.listingId });
  ok(rD.trail.some((t) => t.step === 'Q41' && t.state === 'skipped'), 'Q41 was skipped, not fabricated');

  console.log('\n-- E: the SERVER stays the authority: a tampered artifact is refused and nothing is listed --');
  const e1 = await mint(PA, 'aal-tamper-approval', NOT_READY);
  const itemE1 = itemFor(e1, INSUFF_CONTRACT);
  let l0 = listingCount();
  const rE1 = await approveAndList({ item: itemE1, price: 25, confirmed: true, deps: liveDeps({ principalId: PA, asset: e1, item: itemE1, tweak: { approval: (ap) => ({ ...ap, sig: ap.sig.slice(0, -3) + (ap.sig.endsWith('AAA') ? 'BBB' : 'AAA') }) } }) });
  ok(rE1.status === AAL_STATUS.REFUSED && rE1.code === 'LISTING_PACKAGE_APPROVAL_REQUIRED' && listingCount() === l0, `forged package approval -> REFUSED by the server, no listing (${rE1.code})`);
  const e2 = await mint(PA, 'aal-tamper-q41', NOT_READY);
  const itemE2 = itemFor(e2, INSUFF_CONTRACT);
  l0 = listingCount();
  const rE2 = await approveAndList({ item: itemE2, price: 25, confirmed: true, deps: liveDeps({ principalId: PA, asset: e2, item: itemE2, tweak: { q41Override: (o) => ({ ...o, manualPrice: 24 }) } }) });
  ok(rE2.status === AAL_STATUS.REFUSED && rE2.code === 'MANUAL_PRICE_ACK_MISMATCH' && listingCount() === l0, `Q41 amount that differs from the price -> REFUSED by the server price binding, no listing (${rE2.code})`);
  const e3 = await mint(PA, 'aal-noconfirm', NOT_READY);
  l0 = listingCount();
  const rE3 = await approveAndList({ item: itemFor(e3, INSUFF_CONTRACT), price: 25, confirmed: false, deps: liveDeps({ principalId: PA, asset: e3, item: itemFor(e3, INSUFF_CONTRACT) }) });
  ok(rE3.status === AAL_STATUS.REFUSED && rE3.code === 'CONFIRMATION_REQUIRED' && listingCount() === l0 && (await ledger(e3.gkAssetId)).length === 0, 'without the explicit confirmation nothing is approved, recorded or published');

  console.log('\n-- F: principal isolation: another principal cannot Approve & List this asset --');
  const f = await mint(PA, 'aal-iso', NOT_READY);
  const itemF = itemFor(f, INSUFF_CONTRACT);
  l0 = listingCount();
  const rF = await approveAndList({ item: itemF, price: 25, confirmed: true, deps: liveDeps({ principalId: PB, asset: f, item: itemF }) });
  ok(rF.status === AAL_STATUS.REFUSED && rF.step === 'APPROVE_PACKAGE' && rF.code === 'GRAPH_UNAVAILABLE' && listingCount() === l0, `a foreign principal cannot even read the asset, so nothing is approved or listed (${rF.status} ${rF.step} ${rF.code})`);
} finally {
  for (const c of created) {
    try {
      const has = await h.db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE external_listing_id = $1 AND outcome_type = 'DELISTED'`, [c.listingId]);
      if (c.listingId && !has.rowCount) await closeListing(c.principalId, c.gkAssetId, c.listingId);
    } catch (e) { console.log('  (cleanup) close failed', c.listingId, e.message); }
  }
  rmSync(registryFile, { force: true });
  await h.db.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((x) => console.log(`  FAIL ${x}`)); process.exit(1); }
process.exit(0);
