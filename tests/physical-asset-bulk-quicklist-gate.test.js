// POST ALL + QUICK LIST physical-asset link gating.
//  * the real ManagePage (Vite SSR + react-dom/server): Post All Listable counts ONLY server-LINKED candidates; stored contract.listable / LIST_NOW / LIST_LOW
//    never admit an item; unknown / checking / unavailable / signed-out / not-linked are excluded and the exclusion is disclosed;
//  * the real execution functions src/lib/physicalLinkStatus.js (listWithLinkCheck = the Quick List path, runBulkListing = the Post All loop) with a stubbed
//    transport that returns the REAL /api/assets statuses: mixed linked/unlinked batches, execution-time re-verification (a cached LINKED that is no longer
//    linked is blocked), onList never called for a blocked item, one blocked item never aborts or unblocks another;
//  * wiring: ManagePage's runPostAll / handleAction go through those functions and no direct onListComic call remains in either path.
// The server remains the final enforcement authority (proved in tests/physical-asset-not-linked-handler.test.js).
// Invoke: node tests/physical-asset-bulk-quicklist-gate.test.js

import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

global.localStorage = {
  _store: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
};
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const noop = () => {};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true } });
try {
  const mod = await server.ssrLoadModule('/src/App.jsx');
  const lib = await server.ssrLoadModule('/src/lib/physicalLinkStatus.js');
  const { ManagePage } = mod;
  const { LINK_STATE, __seedLinkStateForTests, forgetLinkStates, listWithLinkCheck, runBulkListing, resolveLinkStates, recallLinkState } = lib;

  // ── candidates: every one carries a stored LIST_NOW decision and contract.listable=true, a price and an identity ──
  const cand = (id) => ({
    id, title: `Bulk Gate ${id}`, issue: '1', year: '1990', publisher: 'T', assetType: 'comic', assetCategory: 'comic', status: 'unlisted',
    image: 'data:image/jpeg;base64,dGVzdA==', identityConfident: true, price: '$20.00',
    decision: { action: 'LIST_NOW', blockers: [], warnings: [] },
    contract: { state: 'PRICED', price: 20, listable: true, locks: [], fields: {}, decision: { action: 'LIST_NOW' }, actionAuthority: { state: 'READY' } },
  });
  const catalogue = ['L1', 'L2', 'N1', 'U1', 'C1', 'A1'].map(cand);
  const render = (cat) => renderToStaticMarkup(React.createElement(ManagePage, { catalogue: cat, totalValue: 0, onOpenItem: noop, onListComic: noop, onBundleList: noop, onUpdateAll: noop, tradePiles: [], setTradePiles: noop, setCatalogue: noop }));

  console.log('\n-- real ManagePage: Post All Listable --\n');
  forgetLinkStates();
  let html = render(catalogue);
  ok(!/Post All Listable/.test(html), 'nothing is server-LINKED/known yet: NO Post All button despite 6 stored LIST_NOW + contract.listable candidates');
  __seedLinkStateForTests('L1', LINK_STATE.LINKED); __seedLinkStateForTests('L2', LINK_STATE.LINKED);
  __seedLinkStateForTests('N1', LINK_STATE.NOT_LINKED); __seedLinkStateForTests('U1', LINK_STATE.UNAVAILABLE); __seedLinkStateForTests('A1', LINK_STATE.UNAUTHENTICATED);
  // C1 stays CHECKING (unknown)
  html = render(catalogue);
  ok(/Post All Listable \(2\)/.test(html), 'mixed batch: "Post All Listable (2)" counts only the 2 server-LINKED items (not 6)');
  ok(/data-testid="postall-excluded"[^>]*>\s*4 recommended but not linked to a physical asset/.test(html), 'the 4 excluded candidates (not-linked, unavailable, signed-out, unknown) are disclosed, not silently dropped');
  forgetLinkStates();
  for (const id of ['N1', 'U1', 'C1', 'A1']) __seedLinkStateForTests(id, id === 'N1' ? LINK_STATE.NOT_LINKED : id === 'U1' ? LINK_STATE.UNAVAILABLE : id === 'A1' ? LINK_STATE.UNAUTHENTICATED : LINK_STATE.CHECKING);
  html = render(catalogue);
  ok(!/Post All Listable/.test(html) && /4 recommended but not linked|6 recommended but not linked/.test(html), 'all candidates unlinked/unknown: no Post All button, exclusion disclosed');
  forgetLinkStates();
  __seedLinkStateForTests('L1', LINK_STATE.LINKED);
  html = render([{ ...cand('L1'), contract: { state: 'LOCKED', price: 20, listable: false, locks: [], fields: {}, decision: { action: 'RESEARCH' } }, decision: { action: 'RESEARCH', blockers: [], warnings: [] } }]);
  ok(!/Post All Listable/.test(html), 'LINKED is necessary, not sufficient: a linked row whose contract is not listable is still not a Post All candidate');

  console.log('\n-- real execution functions: mixed linked / unlinked batch (stubbed transport returns the real /api/assets statuses) --\n');
  const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const table = { L1: resp(200, { asset: { asset: { id: 'gk-L1' } } }), L2: resp(200, { asset: { asset: { id: 'gk-L2' } } }), N1: resp(404, { error: 'Not found' }), U1: resp(503, {}), A1: null, T1: resp(200, { asset: { asset: { id: 'gk-T1' } } }) };
  let transportCalls = [];
  const authFetch = async (url) => { const id = decodeURIComponent(String(url).split('collectionItemId=')[1]); transportCalls.push(id); if (id === 'X1') throw new Error('offline'); return table[id]; };
  const listed = [];
  const onList = async (it) => { listed.push(it.id); if (it.id === 'L2') throw new Error('eBay said no'); };
  const sleeps = []; const progress = [];
  forgetLinkStates();
  const items = ['N1', 'L1', 'U1', 'L2', 'A1', 'X1'].map((id) => ({ id }));
  const results = await runBulkListing({ items, authFetch, onList, onProgress: (id, r) => progress.push([id, r.state]), sleep: async (ms) => { sleeps.push(ms); } });
  ok(JSON.stringify(listed) === JSON.stringify(['L1', 'L2']), `onList was called ONLY for linked items, in order (${JSON.stringify(listed)})`);
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  ok(by.N1.blocked && by.N1.linkState === LINK_STATE.NOT_LINKED && by.U1.blocked && by.U1.linkState === LINK_STATE.UNAVAILABLE && by.A1.blocked && by.A1.linkState === LINK_STATE.UNAUTHENTICATED && by.X1.blocked && by.X1.linkState === LINK_STATE.UNAVAILABLE, 'not-linked / 503 / signed-out / network failure are each BLOCKED with their own link state');
  ok(by.L1.state === 'success' && by.L2.state === 'error' && !by.L2.blocked, 'a linked item that eBay refuses is an ordinary error (not "blocked"), and does not stop the batch');
  ok(results.length === 6 && transportCalls.length === 6 && transportCalls.join() === 'N1,L1,U1,L2,A1,X1', 'every item was verified individually, one lookup each, in batch order (per-item eligibility)');
  ok(sleeps.length === 5 && sleeps.every((m) => m === 1500), 'the 1500 ms pacing between publishes is preserved');
  ok(progress.filter(([, s]) => s === 'posting').length === 6, 'each item is reported "posting" before its own verification');

  console.log('\n-- execution-time re-verification (a cached LINKED cannot authorise a stale publish) --\n');
  forgetLinkStates(); __seedLinkStateForTests('T1', LINK_STATE.LINKED);
  const flip = { ...table, T1: resp(404, { error: 'Not found' }) };
  const l2 = [];
  let threw = null;
  try { await listWithLinkCheck({ item: { id: 'T1' }, authFetch: async () => flip.T1, onList: async (i) => l2.push(i.id) }); } catch (e) { threw = e; }
  ok(threw?.code === 'PHYSICAL_ASSET_LINK_REQUIRED' && threw.linkState === LINK_STATE.NOT_LINKED && l2.length === 0 && recallLinkState('T1') === LINK_STATE.NOT_LINKED, 'Quick List path: cached LINKED but the server now says 404 -> blocked with the not-linked label, onList NOT called, cache corrected');
  ok(/capture it first/.test(threw?.message || ''), 'the blocked error text is the operator-facing "capture it first" label');
  const okRun = []; await listWithLinkCheck({ item: { id: 'T1' }, authFetch: async () => table.T1, onList: async (i) => okRun.push(i.id) });
  ok(okRun.join() === 'T1', 'Quick List path: a server-LINKED item is listed');
  const noItem = []; let t2 = null;
  try { await listWithLinkCheck({ item: {}, authFetch, onList: async () => noItem.push(1) }); } catch (e) { t2 = e; }
  ok(t2?.code === 'PHYSICAL_ASSET_LINK_REQUIRED' && noItem.length === 0, 'an item with no id fails closed');
  forgetLinkStates();
  const states = await resolveLinkStates({ items: [{ id: 'L1' }, { id: 'N1' }, { id: 'U1' }, { id: 'A1' }], authFetch, concurrency: 2 });
  ok(states.L1 === LINK_STATE.LINKED && states.N1 === LINK_STATE.NOT_LINKED && states.U1 === LINK_STATE.UNAVAILABLE && states.A1 === LINK_STATE.UNAUTHENTICATED, 'resolveLinkStates maps each real status and never throws');

  console.log('\n-- wiring: the real ManagePage paths go through the gate --\n');
  const src = readFileSync('src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
  const strip = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const mp = strip(src.slice(src.indexOf('export function ManagePage')));
  const post = mp.slice(mp.indexOf('const runPostAll'), mp.indexOf('const openPostAll'));
  const act = mp.slice(mp.indexOf('const handleAction'), mp.indexOf('const handleAction') + 1800);
  ok(/runBulkListing\(/.test(post) && !/onListComic\(/.test(post), 'runPostAll publishes only through runBulkListing (no direct onListComic call)');
  ok(/listWithLinkCheck\(/.test(act) && !/await onListComic\(/.test(act), 'Quick List (handleAction "list") publishes only through listWithLinkCheck (no direct onListComic call)');
  ok(/getListableBooks = \(aiTagsSnapshot\) => baseListable\(aiTagsSnapshot\)\.filter\(\(c\) => linkOf\(c\.id\) === LINK_STATE\.LINKED\)/.test(mp), 'getListableBooks requires a server-LINKED state on top of the stored-recommendation filter');
  ok(/listingLinkGate\(linkOf\(a\.comicId\)\)\.blocked/.test(mp), 'the Quick List button is disabled/relabelled for any non-LINKED state');
} finally {
  await server.close();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
