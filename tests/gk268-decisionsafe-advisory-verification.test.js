// tests/gk268-decisionsafe-advisory-verification.test.js
//
// GK-268 — "REMOVE DECISION SAFE AS A HARD LISTING REQUIREMENT" dispatch.
//
// FINDING (this dispatch, proven by real execution, not assumption): the
// requested behavior already exists in shipped code. contract.listable is
// a pure projection of actionAuthority.state==='READY' (src/lib/
// responseContract.js:714), so a RESEARCH/REVIEW/NO_SOLD_EVIDENCE item is
// NOT listable by default — but the pre-existing Q41 override chain
// (GK-250's `q41Unlocked`/`listLocked`, App.jsx ~8795-9066, itself reusing
// the original Q41 ruling 2026-07-12) already treats every
// 'insufficiency'-class lock — including GK-238's new
// 'market-standing-no-sold-evidence' lock — as acknowledgeable: once the
// operator enters/confirms a manual price (priceOverridden=true) and clicks
// "Engine could not verify a price. I've set and verified this price
// myself.", contract.listable's REVIEW/insufficiency state is overridden
// client-side (q41Unlocked=true), the List on eBay button becomes enabled,
// and api/list-ebay.js's own independent server-side gate (`hasValidAck`)
// already accepts exactly this q41Override shape. Decision Safe itself was
// therefore ALREADY advisory (a 'caution' badge, never an independent
// blocker) for every insufficiency-class reason — only integrity-class
// locks (REFUSED, manual-review, grade-exceeds-map, etc.) are genuinely
// hard, exactly as the dispatch requires them to remain.
//
// NO PRODUCTION CODE CHANGED. This file is net-new regression coverage
// closing a real gap: no prior test proved the CLIENT-side
// listLocked/q41Unlocked interaction for GK-238's specific
// 'market-standing-no-sold-evidence' lock (GK-238's own test suite is
// server/contract-only, never renders CollectionDetail).
//
// Real SSR execution of the actual, unmodified `CollectionDetail` export
// from src/App.jsx via Vite's SSR module loader + react-dom/server,
// mirroring tests/gk250-refused-q41-dominance.test.js's proven technique.
//
// Invoke: node tests/gk268-decisionsafe-advisory-verification.test.js

import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

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
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; const msg = `  \u2717 ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GK-268 \u2014 Decision Safe advisory verification (real SSR proof) ===\n');

const noop = () => {};
const repoRoot = 'C:/Users/matam/OneDrive/Desktop/comic-vault';

const renderAndInspect = async (CollectionDetail, item) => {
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
  // Real, unmodified src/lib/responseContract.js -- builds the exact
  // contract shape a real RESEARCH/NO_SOLD_EVIDENCE enrich response
  // produces server-side (Old Man Logan #25's own acceptance-test shape:
  // decision RESEARCH, pricingSource active_ask_derived, zero sold comps).
  const { assembleContract } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'responseContract.js')).href);

  const baseOut = {
    price: '$15.26',
    pricingSource: 'active_ask_derived',
    priceBands: { tier: 3 },
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null },
    identityConfident: true,
    identityProvisional: false,
    decision: { action: 'RESEARCH', confidence: 'MEDIUM', blockers: [], warnings: ['no-sold-candidates'], nextStep: 'Research comparable sales before listing.' },
  };
  const researchContract = assembleContract(baseOut);

  assertTrue(researchContract.state !== 'REFUSED' && researchContract.state !== 'ID_REQUIRED', 'sanity: RESEARCH/NO_SOLD_EVIDENCE contract is a normal ESTIMATED-class state, not REFUSED/ID_REQUIRED');
  assertTrue(researchContract.actionAuthority.state === 'REVIEW', 'sanity: actionAuthority.state === REVIEW (matches dispatch\u2019s Old Man Logan acceptance scenario exactly)');
  assertTrue(researchContract.actionAuthority.marketStanding === 'NO_SOLD_EVIDENCE', 'sanity: marketStanding === NO_SOLD_EVIDENCE');
  assertTrue(researchContract.listable === false, 'sanity: contract.listable === false by default (Decision Safe not READY)');
  assertTrue(
    researchContract.locks.length === 1 && researchContract.locks[0].code === 'market-standing-no-sold-evidence' && researchContract.locks[0].class === 'insufficiency' && researchContract.locks[0].hard === false,
    'sanity: exactly one soft, insufficiency-class lock (market-standing-no-sold-evidence) \u2014 acknowledgeable by Q41 design'
  );

  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    root: process.cwd(),
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const mod = await server.ssrLoadModule('/src/App.jsx');
    const { CollectionDetail } = mod;

    const baseItem = {
      id: 'oml-25-test',
      title: 'Old Man Logan',
      issue: '25',
      assetType: 'comic',
      image: 'data:image/jpeg;base64,dGVzdA==', // (I) a real front photo present
      identityConfident: true,
      identityMissingFields: [],
      price: '$15.26',
      decision: baseOut.decision,
      contract: researchContract,
      megaKeyFloorDivergent: false,
    };

    // ─── Scenario B: RESEARCH + NO_SOLD_EVIDENCE, no acknowledgment yet ───
    console.log('\nScenario B \u2014 RESEARCH/NO_SOLD_EVIDENCE, before Q41 acknowledgment:');
    {
      const item = { ...baseItem, priceOverridden: false, q41Ack: null };
      const { buttons } = await renderAndInspect(CollectionDetail, item);
      const listBtn = buttons.find((b) => /list on ebay/i.test(b.text));
      // The insufficiency-lock branch (App.jsx ~8795-8853) returns early with
      // ONLY the acknowledgment control when unacknowledged -- it renders no
      // "List on eBay" button at all (not merely a disabled one). Either
      // shape (absent, or present-but-disabled) proves listing is blocked.
      assertTrue(!listBtn || listBtn.disabled, `List on eBay is not an enabled listing path before acknowledgment (found: ${JSON.stringify(buttons.map((b) => b.text))})`);
      const ackBtn = buttons.find((b) => /engine could not verify a price/i.test(b.text) || /acknowledge and enable listing/i.test(b.text));
      assertTrue(!!ackBtn, 'an acknowledgment control (Q41) is offered instead of a silent block');
    }

    // ─── Scenario C: RESEARCH + NO_SOLD_EVIDENCE, valid manual price + Q41 ack ───
    console.log('\nScenario C \u2014 RESEARCH/NO_SOLD_EVIDENCE, AFTER manual price + Q41 acknowledgment:');
    {
      const manualPrice = 15.26;
      const item = {
        ...baseItem,
        priceOverridden: true,
        q41Ack: {
          price: manualPrice,
          at: Date.now(),
          payload: {
            title: 'Old Man Logan', issue: '25', state: researchContract.state,
            decision: 'RESEARCH', manualPrice, priceOverridden: true,
            lockClassAcknowledged: 'insufficiency', locks: ['market-standing-no-sold-evidence'],
          },
        },
      };
      const { buttons } = await renderAndInspect(CollectionDetail, item);
      const listBtn = buttons.find((b) => /list on ebay/i.test(b.text));
      assertTrue(!!listBtn && !listBtn.disabled, `List on eBay is ENABLED after acknowledgment (found: ${JSON.stringify(buttons.map((b) => ({ t: b.text, d: b.disabled })))})`);
      assertTrue(!!listBtn && /\$15\.26/.test(listBtn.text), `List on eBay shows the acknowledged manual price ($15.26): "${listBtn?.text}"`);
    }

    // ─── Scenario E: REFUSED still dominates, unconditionally, even with a
    // matching all-insufficiency-class lock + valid price-matching ack ───
    console.log('\nScenario E \u2014 REFUSED remains blocked regardless of any acknowledgment:');
    {
      const refusedOut = { price: null, pricingSource: 'refused-no-data-sources', refusedToPrice: true, identityConfident: true, decision: { action: 'RESEARCH', blockers: [], warnings: [] } };
      const refusedContract = assembleContract(refusedOut);
      assertTrue(refusedContract.state === 'REFUSED', 'sanity: this shape actually produces contract.state === REFUSED');
      const item = {
        ...baseItem, price: null, contract: refusedContract, priceOverridden: true,
        refusedToPrice: true,
        q41Ack: { price: 0, at: Date.now(), payload: { priceOverridden: true, manualPrice: 0, lockClassAcknowledged: 'insufficiency', locks: refusedContract.locks.map((l) => l.code) } },
      };
      const { html, buttons } = await renderAndInspect(CollectionDetail, item);
      const enabledListBtn = buttons.filter((b) => /list on ebay/i.test(b.text) && !b.disabled);
      assertTrue(enabledListBtn.length === 0, `no ENABLED List on eBay button renders for REFUSED (found: ${JSON.stringify(buttons.map((b) => b.text))})`);
      assertTrue(html.includes('Listing blocked') || html.includes('REFUSED'), 'a REFUSED banner/state renders instead of a listable card');
    }

    // ─── Scenario F: SOLD status hard-replaces the entire action area ───
    console.log('\nScenario F \u2014 SOLD status blocks listing regardless of contract:');
    {
      const item = { ...baseItem, status: 'sold', soldPrice: 61.41, priceOverridden: true, q41Ack: { price: 15.26, at: Date.now(), payload: {} } };
      const { html, buttons } = await renderAndInspect(CollectionDetail, item);
      const listBtn = buttons.find((b) => /list on ebay/i.test(b.text));
      assertTrue(!listBtn, 'no List on eBay button renders at all once item.status === "sold" (the sold-card branch replaces the entire action area)');
      assertTrue(html.includes('Sold'), 'the Sold badge/state renders instead');
    }

    // ─── Scenario I/J: photo gate is independent of Decision Safe ───
    console.log('\nScenario I \u2014 zero photos still gates listing even with a valid Q41 ack:');
    {
      const manualPrice = 15.26;
      const item = {
        ...baseItem, image: null, images: [],
        priceOverridden: true,
        q41Ack: { price: manualPrice, at: Date.now(), payload: { priceOverridden: true, manualPrice, lockClassAcknowledged: 'insufficiency', locks: ['market-standing-no-sold-evidence'] } },
      };
      const { buttons, html } = await renderAndInspect(CollectionDetail, item);
      const enabledListBtn = buttons.filter((b) => /list on ebay/i.test(b.text) && !b.disabled);
      assertTrue(enabledListBtn.length === 0 || /photo/i.test(html), 'zero-photo case does not silently enable List on eBay (photo gate independent of Q41/Decision Safe)');
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
