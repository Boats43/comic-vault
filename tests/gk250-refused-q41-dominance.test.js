// tests/gk250-refused-q41-dominance.test.js
//
// GK-250 (U6.0C) — contract law: contract.state==='REFUSED' can never be
// overridden into an enabled List action through Q41/manual-price
// acknowledgment, for any category.
//
// CORRECTED FINDING (this dispatch, found while building this very test,
// via real SSR execution, not assumption): the pre-push review hypothesized
// a reachable bypass through CollectionDetail's `allInsufficiency &&
// item.priceOverridden && q41AckValid` empty fall-through block (App.jsx),
// reasoning that it could leave q41Unlocked=true and listLocked=false for a
// REFUSED item with an all-'insufficiency'-class lock array. Building an
// executable proof of that exact shape found it is NOT actually reachable
// today: `isContractIdentityBlocked(item)` (App.jsx:894-897 — true whenever
// `item.contract.state === 'ID_REQUIRED' || 'REFUSED'`) already renders its
// own "Listing blocked — identification required" banner and returns
// UNCONDITIONALLY, earlier in the same render tree, before the
// q41Unlocked/listLocked code is ever reached for a REFUSED item. Verified
// directly: reverting the q41Unlocked/listLocked/researchAckNeeded guards
// and re-running this exact test still produced zero enabled List buttons,
// because isContractIdentityBlocked's own return already short-circuits
// the whole render before that code runs.
//
// The q41Unlocked/listLocked/researchAckNeeded guards added this dispatch
// (App.jsx) are kept as an explicit SECOND, independent layer of the same
// invariant — real, harmless, and directly requested by the governing
// dispatch ("REFUSED must dominate... for every category") — but this test
// proves the PRIMARY, currently-load-bearing mechanism is
// isContractIdentityBlocked, and asserts against ITS actual output
// (the "Listing blocked" banner), not a hypothetical bypass this
// codebase's real render tree does not actually reach.
//
// Uses the same Vite SSR module-loader + react-dom/server execution proof
// as tests/gk249-book-refused-render-safety.test.js — genuine component
// execution, not a static read-through or a hand-faked "safe" shape.
//
// Invoke: node tests/gk250-refused-q41-dominance.test.js

import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

global.localStorage = {
  _store: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
};

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GK-250 — REFUSED dominates Q41 acknowledgment (category-general) ===\n');

const noop = () => {};

// The attempted-bypass shape: REFUSED, one all-'insufficiency'-class lock
// (matching what deriveLocks/responseContract.js actually produces for
// pricingSource values in INSUFFICIENCY_REFUSAL_SLUGS), a valid
// price-matching q41Ack, and priceOverridden=true. A real scan always has
// at least a front photo (`image`) -- required so the render reaches past
// the unrelated "PHOTOS NEEDED" readiness gate (App.jsx:611-614,
// getListingReadiness), found and worked around while building this test.
const buildBypassAttemptItem = (overrides = {}) => ({
  id: 'bypass-attempt',
  title: 'Test Item',
  author: 'Test Author',
  image: 'data:image/jpeg;base64,dGVzdA==',
  identityConfident: true,
  identityMissingFields: [],
  price: null,
  priceOverridden: true,
  q41Ack: { price: 0, at: Date.now() },
  decision: { action: 'RESEARCH', blockers: [], warnings: [] },
  refusedToPrice: true,
  contract: {
    state: 'REFUSED',
    price: null,
    bands: null,
    listable: false,
    locks: [{ code: 'refused', class: 'insufficiency', reason: 'no verified market data', hard: true }],
    fields: {},
  },
  megaKeyFloorDivergent: false,
  ...overrides,
});

const renderAndInspect = async (server, CollectionDetail, item) => {
  const html = renderToStaticMarkup(
    React.createElement(CollectionDetail, {
      item, onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop,
      onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop,
      onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop,
      currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop,
    })
  );
  const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => ({ text: m[1].replace(/<[^>]+>/g, '').trim(), disabled: /disabled=""/.test(m[0]) }));
  return { html, buttons };
};

const main = async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    root: process.cwd(),
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const mod = await server.ssrLoadModule('/src/App.jsx');
    const { CollectionDetail } = mod;

    for (const [label, assetType, extra] of [
      ['Refused Book', 'book', { title: 'The Rationalists' }],
      ['Refused merchandise', 'merchandise', { title: 'Test Merchandise Item' }],
      ['Refused comic-shaped item', 'comic', { title: 'Test Comic #1', issue: '1' }],
    ]) {
      console.log(`\n${label} — acknowledged insufficiency lock, attempted bypass:`);
      const item = buildBypassAttemptItem({ assetType, ...extra });
      const { html, buttons } = await renderAndInspect(server, CollectionDetail, item);

      assertTrue(
        html.includes('Listing blocked') && html.includes('identification required'),
        'isContractIdentityBlocked\'s "Listing blocked — identification required" banner renders (the real, primary mechanism for this shape)'
      );
      const listBuyButtons = buttons.filter((b) => /list on ebay/i.test(b.text) && !b.disabled);
      assertTrue(
        listBuyButtons.length === 0,
        `no ENABLED "List on eBay" button renders despite the acknowledged insufficiency lock + priceOverridden (buttons: ${JSON.stringify(buttons.map((b) => b.text))})`
      );
    }

    // ─── Regression control: legitimate, non-REFUSED Q41 must still work ───
    console.log('\nNon-REFUSED comic — legitimate Q41 acknowledgment path unchanged:');
    {
      // A RESEARCH-tier comic, LOCKED (not REFUSED, not ID_REQUIRED) so
      // isContractIdentityBlocked does NOT fire -- the real researchAckNeeded
      // path this app already relies on for a genuinely thin/unverified
      // comic that still deserves an operator-acknowledged listing option.
      const item = {
        id: 'legit-research', title: 'Test Comic #2', issue: '2', assetType: 'comic',
        image: 'data:image/jpeg;base64,dGVzdA==',
        identityConfident: true, identityMissingFields: [],
        price: null, priceOverridden: false,
        decision: { action: 'RESEARCH', blockers: [], warnings: [] },
        contract: { state: 'LOCKED', price: null, bands: null, listable: false, locks: [], fields: {}, decision: { action: 'RESEARCH' } },
        megaKeyFloorDivergent: false,
      };
      const { html, buttons } = await renderAndInspect(server, CollectionDetail, item);
      assertTrue(!html.includes('Listing blocked'), 'isContractIdentityBlocked does NOT fire for LOCKED (only ID_REQUIRED/REFUSED) — confirms the control is a genuinely different state, not accidentally also blocked');
      const ackButtons = buttons.filter((b) => /acknowledge and enable listing/i.test(b.text));
      assertTrue(ackButtons.length === 1, `the legitimate "Acknowledge and Enable Listing" research panel still renders for a non-REFUSED, unacknowledged RESEARCH-tier comic (found ${ackButtons.length}) — GK-250's guards did not disturb existing Q41 behavior`);
    }

  } finally {
    await server.close();
  }
};

main().then(() => {
  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\n=== FAILURES ===');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log('All tests passed.\n');
  process.exit(0);
}).catch((err) => {
  console.error('FATAL (harness itself failed, not a safety result):', err);
  process.exit(1);
});
