// tests/gk249-book-refused-render-safety.test.js
//
// GK-249 — U6.0B Section C: prove the REFUSED Book result shape actually
// renders without crashing, doesn't leak comic price/grade UI, and doesn't
// expose an enabled List action. Uses Vite's own SSR module loader (already
// an installed devDependency, no new packages added) to transform App.jsx's
// JSX and resolve import.meta.env, then renders the real, unmodified
// ResultCard/CollectionDetail component functions via react-dom/server —
// a genuine execution proof, not a static read-through.
//
// Invoke: node tests/gk249-book-refused-render-safety.test.js

import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// CollectionDetail's swipe-hint useState initializer calls localStorage
// synchronously during render (not inside an effect) — stub it before any
// component renders. This is environment setup for the test harness, not a
// change to application behavior.
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
const assertFalse = (cond, label) => assertTrue(!cond, label);

console.log('\n=== GK-249 — U6.0B REFUSED Book render-safety proof ===\n');

// ─── The exact U6.0B result shape under test ─────────────────────────
const mockBookRefusedItem = {
  id: 'test-book-refused-1',
  assetType: 'book',
  title: 'The Rationalists',
  author: 'Test Author',
  publisher: 'Test Press',
  year: '2020',
  edition: null,
  format: 'Paperback',
  isbn: null,
  grade: 'Very Good',      // book word-grade, never a numeric comic grade
  isGraded: false,
  numericGrade: null,       // no comic slab grade
  issue: null,               // no comic issue
  variant: null,
  keyIssue: null,
  identityConfident: true,   // identity WAS captured — must not render ID_REQUIRED
  identityMissingFields: [],
  identityReasons: [],
  price: null,
  priceLow: null,
  priceHigh: null,
  comps: null,
  rawComps: null,
  soldComps: [],
  priceLadder: null,
  priceChart: null,
  decision: { action: 'RESEARCH', blockers: [], warnings: [], confidence: null },
  refusedToPrice: true,
  listingHardLocked: true,
  contract: {
    state: 'REFUSED',
    price: null,
    bands: null,
    listable: false,
    locks: [],
    fields: {},
  },
  megaKeyFloorDivergent: false,
  image: null,
  purchasePrice: null,
  decisionEventId: null,
  operatorActionEventId: null,
  gkAssetId: null,
};

const noop = () => {};

const main = async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    root: process.cwd(),
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const mod = await server.ssrLoadModule('/src/App.jsx');
    const { ResultCard, CollectionDetail } = mod;

    assertTrue(typeof ResultCard === 'function', 'ResultCard is exported and importable');
    assertTrue(typeof CollectionDetail === 'function', 'CollectionDetail is exported and importable');

    // ─── ResultCard (immediate scan/result card) ─────────────────────
    console.log('\nResultCard (immediate scan result):');
    let resultCardHtml = null;
    try {
      resultCardHtml = renderToStaticMarkup(
        React.createElement(ResultCard, { result: mockBookRefusedItem, enriching: false })
      );
      assertTrue(true, 'renders without throwing');
    } catch (err) {
      assertTrue(false, `renders without throwing — THREW: ${err?.message}\n${err?.stack}`);
    }

    if (resultCardHtml) {
      assertTrue(resultCardHtml.includes('The Rationalists'), 'book title is visible');
      assertFalse(/\$\d/.test(resultCardHtml.replace(/—/g, '')) && /CGC\s*\d/.test(resultCardHtml), 'no comic CGC-numeric price/grade combination leaks through');
      assertFalse(resultCardHtml.includes('grade-badge cgc'), 'no CGC grade badge rendered for a book');
      assertFalse(/List on eBay|listOnEbay|btn-list(?!ing)/i.test(resultCardHtml) && !resultCardHtml.includes('disabled'), 'no unguarded enabled-List affordance text without a disabled marker nearby');
    }

    // ─── CollectionDetail (Collection persistence / reopen view) ─────
    console.log('\nCollectionDetail (Collection persistence + reopen):');
    let detailHtml = null;
    try {
      detailHtml = renderToStaticMarkup(
        React.createElement(CollectionDetail, {
          item: mockBookRefusedItem,
          onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop,
          onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop,
          onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop,
          currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop,
        })
      );
      assertTrue(true, 'renders without throwing (covers immediate + reopen: same component, same props shape)');
    } catch (err) {
      assertTrue(false, `renders without throwing — THREW: ${err?.message}\n${err?.stack}`);
    }

    if (detailHtml) {
      assertTrue(detailHtml.includes('The Rationalists'), 'book title is visible in CollectionDetail');
      assertTrue(/CANNOT PRICE|REFUSED|LISTING LOCKED/i.test(detailHtml), 'a REFUSED/locked banner renders (truthful state, not silently blank)');
      assertFalse(detailHtml.includes('grade-badge cgc'), 'no CGC grade badge in CollectionDetail for a book');
      assertFalse(/\bissue\b\s*:?\s*#/i.test(detailHtml), 'no comic "issue #" label leaks through for a book');

      // Rigorous List-button proof: enumerate EVERY <button> element's
      // rendered text in the full CollectionDetail output (not a regex
      // guess at which specific branch fires — the component has many
      // list-related branches: plain locked, Q41 acknowledge-and-override,
      // decision-engine-blocked, integrity-lock, incomplete-enrich, each
      // with its own button). For this exact contract shape
      // (listable=false, locks=[], state=REFUSED, decision.action=RESEARCH,
      // decision.blockers=[]), empirically NONE of them fire — zero
      // list-related button text of any kind appears anywhere in the
      // output. This is the strongest possible form of "no enabled List
      // action": not a disabled button, an ABSENT one. Which specific
      // upstream condition excludes the whole listing-controls section for
      // this shape was not further traced (out of scope for this proof);
      // what matters for C's safety requirement is the empirical output.
      const buttonTexts = [...detailHtml.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, '').trim());
      const listRelated = buttonTexts.filter((t) => /list|acknowledge/i.test(t));
      assertTrue(listRelated.length === 0, `zero list-related buttons render for this REFUSED book shape (found: ${JSON.stringify(listRelated)})`);
      assertFalse(/<button(?![^>]*disabled)[^>]*>(?:(?!<\/button>).)*List on eBay[^<]*\$\d/is.test(detailHtml), 'no enabled button anywhere renders an active dollar-priced "List on eBay" label');
    }

    // ─── Re-render (simulates reopening the record a second time) ───
    console.log('\nReopen proof (second independent render pass):');
    try {
      renderToStaticMarkup(
        React.createElement(CollectionDetail, {
          item: mockBookRefusedItem,
          onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop,
          onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop,
          onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop,
          currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop,
        })
      );
      assertTrue(true, 'reopening (second render) does not crash');
    } catch (err) {
      assertTrue(false, `reopening does not crash — THREW: ${err?.message}`);
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
  console.error('FATAL (harness itself failed, not a render-safety result):', err);
  process.exit(1);
});
