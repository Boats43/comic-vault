// PHYSICAL-ASSET LINK GATE -- the executable listing action in the REAL CollectionDetail component (Vite SSR + react-dom/server, the same genuine
// execution proof as gk250) plus the REAL src/lib/physicalLinkStatus.js predicate and fetch classifier.
//
// Laws proven: (1) a recommendation (stored LIST_NOW/LIST_LOW) and a stored `contract.listable` are information, never execution authority;
// (2) the listing control is enabled ONLY for a server-established LINKED state; (3) NOT_LINKED, UNAVAILABLE, UNAUTHENTICATED and the initial
// CHECKING state all fail closed with their own honest label; (4) the historical recommendation stays visible, labelled informational.
// SSR runs no effects, so the server answer is supplied through the module's documented test seam (__seedLinkStateForTests) -- the same state the
// component's effect would write from GET /api/assets; the classifier that turns real HTTP statuses into those states is exercised separately below.
// Invoke: node tests/physical-asset-link-gate-render.test.js

import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
  const link = await server.ssrLoadModule('/src/lib/physicalLinkStatus.js');
  const { CollectionDetail } = mod;
  const { LINK_STATE, NOT_LINKED_LABEL, listingLinkGate, fetchPhysicalLinkStatus, __seedLinkStateForTests, forgetLinkStates } = link;

  // A comic whose STORED contract/decision say "listable LIST_NOW" -- exactly the shape of the 95 Production rows that show an enabled button today.
  const readyShaped = (id) => ({
    id, title: 'Link Gate Comic', issue: '7', year: '1990', publisher: 'Test', assetType: 'comic', assetCategory: 'comic',
    image: 'data:image/jpeg;base64,dGVzdA==', images: ['data:image/jpeg;base64,dGVzdA=='],
    identityConfident: true, identityMissingFields: [], price: '$25.00', grade: 'VF 8.0',
    decision: { action: 'LIST_NOW', blockers: [], warnings: [] },
    contract: { state: 'PRICED', price: 25, bands: null, listable: true, locks: [], fields: {}, decision: { action: 'LIST_NOW' }, actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] } },
    megaKeyFloorDivergent: false,
  });
  const render = (item) => {
    const html = renderToStaticMarkup(React.createElement(CollectionDetail, {
      item, onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop, onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop,
      onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop, currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop,
    }));
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({ text: m[1].replace(/<[^>]+>/g, '').trim(), disabled: /disabled=""/.test(m[0]) }));
    return { html, buttons };
  };
  const enabledList = (b) => b.filter((x) => /list on ebay/i.test(x.text) && !x.disabled);

  console.log('\n-- pure gate predicate --\n');
  ok(listingLinkGate(LINK_STATE.LINKED).blocked === false, 'LINKED is the only unblocked state');
  ok([LINK_STATE.NOT_LINKED, LINK_STATE.UNAVAILABLE, LINK_STATE.UNAUTHENTICATED, LINK_STATE.CHECKING, undefined, null, 'LINKED ', 'garbage'].every((s) => listingLinkGate(s).blocked === true), 'every other state, including unknown/garbage input, is blocked (fail closed)');
  ok(listingLinkGate(LINK_STATE.NOT_LINKED).label === 'Not linked to a physical asset — capture it first.' && NOT_LINKED_LABEL === listingLinkGate(LINK_STATE.NOT_LINKED).label, 'NOT_LINKED label is exactly "Not linked to a physical asset — capture it first."');
  ok(new Set([LINK_STATE.NOT_LINKED, LINK_STATE.UNAVAILABLE, LINK_STATE.UNAUTHENTICATED, LINK_STATE.CHECKING].map((s) => listingLinkGate(s).label)).size === 4, 'the four blocked states carry four DISTINCT honest labels (an outage is never reported as "not linked")');

  console.log('\n-- fetchPhysicalLinkStatus classifies the REAL /api/assets contract --\n');
  const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const st = async (fn) => (await fetchPhysicalLinkStatus({ itemId: 'x', authFetch: fn })).state;
  ok(await st(async () => resp(200, { asset: { asset: { id: 'gk-1' } } })) === LINK_STATE.LINKED, '200 + asset.asset.id -> LINKED');
  ok(await st(async () => resp(200, { asset: {} })) === LINK_STATE.NOT_LINKED, '200 without an asset id -> NOT_LINKED (never LINKED on a hollow body)');
  ok(await st(async () => resp(404, { error: 'Not found' })) === LINK_STATE.NOT_LINKED, '404 -> NOT_LINKED');
  ok(await st(async () => resp(401, {})) === LINK_STATE.UNAUTHENTICATED && await st(async () => null) === LINK_STATE.UNAUTHENTICATED, '401 / no session -> UNAUTHENTICATED');
  ok(await st(async () => resp(500, {})) === LINK_STATE.UNAVAILABLE && await st(async () => { throw new Error('offline'); }) === LINK_STATE.UNAVAILABLE, '5xx / network failure -> UNAVAILABLE');
  ok((await fetchPhysicalLinkStatus({ itemId: '', authFetch: async () => resp(200, {}) })).state === LINK_STATE.UNAVAILABLE, 'no item id -> UNAVAILABLE');

  console.log('\n-- the real CollectionDetail: recommendation + contract.listable never enable the action --\n');
  forgetLinkStates();
  let r = render(readyShaped('gate-checking'));
  ok(enabledList(r.buttons).length === 0 && /Checking physical-asset link/.test(r.html), 'initial CHECKING state: no enabled List button, honest "checking" label');
  __seedLinkStateForTests('gate-nl', LINK_STATE.NOT_LINKED);
  r = render(readyShaped('gate-nl'));
  ok(enabledList(r.buttons).length === 0, 'NOT_LINKED: NO enabled "List on eBay" button although contract.listable=true, decision=LIST_NOW, price set, READY-shaped contract');
  ok(r.html.includes('Not linked to a physical asset') && r.html.includes('capture it first'), 'NOT_LINKED: the banner says "Not linked to a physical asset — capture it first."');
  ok(r.buttons.some((b) => b.disabled && /capture it first/.test(b.text)), 'NOT_LINKED: the (disabled) control carries the same label');
  ok(/Recorded recommendation \(informational only, not an authorization\): LIST_NOW/.test(r.html), 'the historical LIST_NOW recommendation is preserved, labelled informational only');
  __seedLinkStateForTests('gate-un', LINK_STATE.UNAVAILABLE);
  r = render(readyShaped('gate-un'));
  ok(enabledList(r.buttons).length === 0 && /unavailable/i.test(r.html) && !/Not linked/.test(r.html), 'UNAVAILABLE: disabled, own label, NOT claimed to be "not linked"');
  __seedLinkStateForTests('gate-ua', LINK_STATE.UNAUTHENTICATED);
  r = render(readyShaped('gate-ua'));
  ok(enabledList(r.buttons).length === 0 && /Sign in/.test(r.html), 'UNAUTHENTICATED: disabled, asks the operator to sign in');
  // client-authored substitutes must not matter
  __seedLinkStateForTests('gate-forged', LINK_STATE.NOT_LINKED);
  r = render({ ...readyShaped('gate-forged'), gkAssetId: '01a0bb24-c806-7a63-aa86-ce26fe8eed83', linked: true, physicalAssetLinked: true });
  ok(enabledList(r.buttons).length === 0, 'item-borne gkAssetId / linked flags (client-authored) cannot substitute for the server answer');
  __seedLinkStateForTests('gate-linked', LINK_STATE.LINKED);
  r = render(readyShaped('gate-linked'));
  ok(enabledList(r.buttons).length === 1 && !r.html.includes('Not linked to a physical asset'), 'LINKED + the same READY-shaped item: exactly one enabled "List on eBay" button (the gate is not a permanent off-switch)');
  __seedLinkStateForTests('gate-linked-research', LINK_STATE.LINKED);
  r = render({ ...readyShaped('gate-linked-research'), decision: { action: 'RESEARCH', blockers: [], warnings: [] }, contract: { state: 'LOCKED', price: 25, bands: null, listable: false, locks: [], fields: {}, decision: { action: 'RESEARCH' } } });
  ok(enabledList(r.buttons).length === 0, 'LINKED but recommendation/contract not listable: still no enabled button (link is necessary, not sufficient)');
} finally {
  await server.close();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
