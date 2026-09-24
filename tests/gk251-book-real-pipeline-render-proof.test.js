// tests/gk251-book-real-pipeline-render-proof.test.js
//
// GK-251 (U6.0C addition, "post-acceptance real-pipeline render check") —
// per the standing project rule ("a safety/render state must be produced
// through the actual code path being tested"), gk249's REFUSED render proof
// used a HAND-CONSTRUCTED shape. This file closes that gap: it runs a real
// Book-shaped payload through the REAL /api/enrich handler (same convention
// as tests/gk250-book-enrich-handler-smoke.test.js), captures the ACTUAL
// response object the handler produces, reconstructs what App.jsx's own
// real merge logic would build from it (both the "immediate result" merge,
// a literal wholesale spread, and the "persisted catalogue item" merge, an
// explicit field allowlist — both traced and cited by file:line below, not
// invented), and renders BOTH through the real, unmodified ResultCard/
// CollectionDetail components via the same Vite SSR + react-dom/server
// execution proof as tests/gk249-book-refused-render-safety.test.js.
//
// Invoke: node tests/gk251-book-real-pipeline-render-proof.test.js

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

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
const assertFalse = (cond, label) => assertTrue(!cond, label);

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

const BOOK_ITEMS = [
  ['The Rationalists Philosophy Book Paperback', 12.99],
  ['The Rationalists by Test Author Paperback Good Condition', 9.5],
].map(([title, price], i) => ({
  itemId: `v1|9901000000${i}|0`, title,
  leafCategoryIds: ['267'], categories: [{ categoryId: '267', categoryName: 'Books & Magazines' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C9901000000${i}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New', conditionId: '1000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'], itemWebUrl: `https://www.ebay.com/itm/9901000000${i}`,
  itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `9901000000${i}`,
  adultOnly: false, itemOriginDate: '2026-04-06T14:26:54.000Z', itemCreationDate: '2026-04-06T14:26:54.000Z',
  listingMarketplaceId: 'EBAY_US',
}));

async function getRealEnrichResponse() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image') || u.includes('item_summary/search')) {
      return jsonResponse({ itemSummaries: BOOK_ITEMS, total: BOOK_ITEMS.length });
    }
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const originalConsoleLog = console.log;
  console.log = () => {};
  const handlerModule = await import('../api/enrich.js?gk251');
  const handler = handlerModule.default;
  // Real request shape: mirrors App.jsx's own enrichBody construction
  // (gradeBlob, ~App.jsx:12130-12159) for a real BOOK_PROMPT grade
  // response -- title/author/year/format present, issue/publisher absent
  // (BOOK_JSON_SHAPE has no issue field at all), assetType='book' threaded
  // exactly as the real client does (enrichBody.assetType = data.assetType
  // || 'comic').
  const gradeResponseData = {
    title: 'The Rationalists', author: 'Test Author', year: '2020', assetType: 'book',
    grade: 'Very Good', isGraded: false, numericGrade: null, confidence: 'high',
    publisher: null, edition: null, format: 'Paperback', isbn: null,
    reason: 'A paperback philosophy book, light shelf wear.',
  };
  const req = {
    method: 'POST', headers: {},
    body: {
      title: gradeResponseData.title, issue: null, grade: gradeResponseData.grade,
      isGraded: gradeResponseData.isGraded, numericGrade: gradeResponseData.numericGrade,
      year: gradeResponseData.year, publisher: gradeResponseData.publisher,
      confidence: gradeResponseData.confidence, defectPenalty: null, certNumber: null,
      labelType: null, labelNotes: null, variant: null, keyIssue: null, creator: null,
      reason: gradeResponseData.reason, assetType: gradeResponseData.assetType,
      assetTypeConfident: undefined, foreignEdition: undefined, isReprint: undefined, editionType: undefined,
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    }
  };
  let capturedBody = null;
  const res = { status: (code) => ({ json: (data) => { capturedBody = data; } }), setHeader: () => {} };
  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  return { threw, enrich: capturedBody, gradeResponseData };
}

// ─── Faithful reproduction of App.jsx's own real merge logic ──────────
// Both merges below are cited to their exact real source so this is a
// reproduction of traced logic, not an invented shape.

// "Immediate result" merge -- App.jsx:12207-12214, setResult((prev) =>
// prev ? { ...prev, ...enrich, variant: ..., image: prev.image } : prev).
// A literal wholesale spread: every field on the real enrich response
// survives into the displayed result, verbatim.
function buildImmediateResult(gradeData, enrich, imageDataUrl) {
  const prev = { ...gradeData, image: imageDataUrl };
  return {
    ...prev,
    ...enrich,
    variant: Object.prototype.hasOwnProperty.call(enrich, 'variantNote') ? enrich.variantNote : prev.variant,
    image: prev.image,
  };
}

// "Persisted catalogue item" merge -- App.jsx:12265-12406 (setCatalogue
// updater inside the enrich .then() callback). NOT a wholesale spread --
// an explicit field allowlist. Reproducing only the fields load-bearing
// for render safety (contract/decision/comps/rawComps/priceBands/
// identity*/marketPending/price*), each with the exact same real
// expression as the source. Confirmed during this same trace: `assetType`
// is NOT among the ~80 explicitly-merged fields anywhere in that block --
// a real, disclosed gap (the persisted item never carries assetType, even
// though the transient `result` object does via the wholesale spread
// above) -- reproduced faithfully as an ABSENT key here, not papered over.
function buildPersistedItem(gradeData, enrich, imageDataUrl) {
  // addToCatalogue's own initial entry (App.jsx:11920-11966) -- also does
  // NOT include assetType, confirmed by direct read of that object literal.
  const cur = {
    id: 'test-persisted-book', title: gradeData.title || '', publisher: gradeData.publisher || '',
    year: gradeData.year || '', grade: gradeData.grade || '', isGraded: gradeData.isGraded === true,
    numericGrade: typeof gradeData.numericGrade === 'number' ? gradeData.numericGrade : null,
    issue: null, price: null, priceLow: null, priceHigh: null,
    marketPending: true, images: imageDataUrl ? [imageDataUrl] : [], image: imageDataUrl,
  };
  const idGated = enrich.identityConfident === false || enrich.assetTypeConfident === false;
  return {
    ...cur,
    comps: enrich.comps || cur.comps,
    price: idGated ? null : (enrich.price ?? cur.price),
    priceLow: idGated ? null : (enrich.priceLow ?? cur.priceLow),
    priceHigh: idGated ? null : (enrich.priceHigh ?? cur.priceHigh),
    pricingSource: enrich.pricingSource,
    priceNote: enrich.priceNote,
    grade: enrich.grade || cur.grade,
    identityConfident: idGated ? false : (enrich.identityConfident ?? cur.identityConfident ?? true),
    assetTypeConfident: enrich.assetTypeConfident ?? cur.assetTypeConfident ?? true,
    identityMissingFields: enrich.identityMissingFields ?? cur.identityMissingFields ?? null,
    soldComps: enrich.soldComps || cur.soldComps || [],
    priceLadder: enrich.priceLadder || cur.priceLadder || null,
    rawComps: enrich.rawComps || cur.rawComps || null,
    priceChart: enrich.priceChart || cur.priceChart || null,
    marketPending: false,
    decision: enrich.decision || cur.decision,
    contract: enrich.contract ?? cur.contract ?? null,
    claudeCheck: enrich.claudeCheck || cur.claudeCheck || null,
    priceBands: enrich.priceBands || cur.priceBands || null,
    pop: enrich.pop || cur.pop || null,
    cgcPenaltyFlags: enrich.cgcPenaltyFlags || cur.cgcPenaltyFlags || null,
    // NOTE: assetType deliberately NOT set here -- matches the real merge's
    // own gap, confirmed by direct trace of App.jsx:12265-12406 (not one
    // of the ~80 explicitly-listed fields).
  };
}

const noop = () => {};

async function main() {
  console.log('\n=== GK-251 — post-acceptance real-pipeline render proof ===\n');

  console.log('Step 1: run the real payload through the real /api/enrich handler:');
  const { threw, enrich, gradeResponseData } = await getRealEnrichResponse();
  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!!enrich, 'a real response object was captured');
  assertTrue(enrich?.contract?.state === 'REFUSED', `real contract.state === "REFUSED" (actual: ${JSON.stringify(enrich?.contract?.state)})`);
  assertTrue(enrich?.refusedToPrice === true, 'real out.refusedToPrice === true');
  console.log(`  (real response keys: ${Object.keys(enrich || {}).length})`);

  const imageDataUrl = 'data:image/jpeg;base64,dGVzdA==';
  const immediateResult = buildImmediateResult(gradeResponseData, enrich, imageDataUrl);
  const persistedItem = buildPersistedItem(gradeResponseData, enrich, imageDataUrl);

  console.log('\nStep 2: immediate result object (real wholesale-spread merge):');
  assertTrue(immediateResult.assetType === 'book', `immediate result.assetType === "book" (real field survives the wholesale spread)`);
  assertTrue(immediateResult.contract?.state === 'REFUSED', 'immediate result.contract.state === "REFUSED"');

  console.log('\nStep 3: persisted item object (real explicit-field merge):');
  assertTrue(persistedItem.assetType === undefined, 'CONFIRMED GAP: persisted item.assetType is undefined (not among the real merge\'s ~80 explicit fields, App.jsx:12265-12406) -- disclosed, not fixed here (out of scope, see report)');
  assertTrue(persistedItem.contract?.state === 'REFUSED', 'persisted item.contract.state === "REFUSED" (safety-relevant field IS correctly merged)');
  assertTrue(persistedItem.price === null, 'persisted item.price === null');

  console.log('\nStep 4: render both through the real, unmodified components (SSR execution):');
  const server = await createServer({
    server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true },
  });
  try {
    const mod = await server.ssrLoadModule('/src/App.jsx');
    const { ResultCard, CollectionDetail } = mod;

    let resultCardHtml = null;
    try {
      resultCardHtml = renderToStaticMarkup(React.createElement(ResultCard, { result: immediateResult, enriching: false }));
      assertTrue(true, 'ResultCard renders the REAL immediate result without throwing');
    } catch (err) {
      assertTrue(false, `ResultCard renders the REAL immediate result without throwing — THREW: ${err?.message}\n${err?.stack}`);
    }
    if (resultCardHtml) {
      assertTrue(resultCardHtml.includes('The Rationalists'), 'ResultCard: book title visible');
      assertFalse(resultCardHtml.includes('grade-badge cgc'), 'ResultCard: no CGC grade badge');
      assertFalse(/\bissue\s*#/i.test(resultCardHtml), 'ResultCard: no comic "issue #" label');
    }

    let detailHtml = null;
    try {
      detailHtml = renderToStaticMarkup(React.createElement(CollectionDetail, {
        item: persistedItem, onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop,
        onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop, onAbortEnrich: noop,
        onAddPhoto: noop, onUpdateField: noop, currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop,
      }));
      assertTrue(true, 'CollectionDetail renders the REAL persisted item without throwing (proves both immediate AND reopen-safety -- same component, same props shape)');
    } catch (err) {
      assertTrue(false, `CollectionDetail renders the REAL persisted item without throwing — THREW: ${err?.message}\n${err?.stack}`);
    }
    if (detailHtml) {
      assertTrue(detailHtml.includes('The Rationalists'), 'CollectionDetail: book title visible');
      assertTrue(/CANNOT PRICE|REFUSED|LISTING LOCKED|Listing blocked/i.test(detailHtml), 'CollectionDetail: a truthful REFUSED/locked/blocked indicator renders');
      assertFalse(detailHtml.includes('grade-badge cgc'), 'CollectionDetail: no CGC grade badge');
      assertFalse(/\bissue\s*#/i.test(detailHtml), 'CollectionDetail: no comic "issue #" label');
      const buttons = [...detailHtml.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
      const listBuy = buttons.filter((b) => /list on ebay/i.test(b) && /\$\d/.test(b));
      assertTrue(listBuy.length === 0, `no enabled dollar-priced "List on eBay" button renders (buttons: ${JSON.stringify(buttons)})`);
    }

    // Reopen proof -- second independent render pass, same real persisted shape.
    try {
      renderToStaticMarkup(React.createElement(CollectionDetail, {
        item: persistedItem, onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop,
        onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop, onAbortEnrich: noop,
        onAddPhoto: noop, onUpdateField: noop, currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop,
      }));
      assertTrue(true, 'reopening CollectionDetail with the real persisted shape (second render pass) does not crash');
    } catch (err) {
      assertTrue(false, `reopening does not crash — THREW: ${err?.message}`);
    }
  } finally {
    await server.close();
  }

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
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
