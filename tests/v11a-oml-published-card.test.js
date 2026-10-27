// tests/v11a-oml-published-card.test.js -- V1.1a Section H: the PUBLISHED Old Man Logan #25 card (golden case).
//
// Renders the real CollectionDetail (Vite SSR + react-dom/server) for an asset that is already LISTED on eBay and proves that
// CURRENT authoritative listing status outranks historical research:
//   * "Listed on eBay", ItemID 366762997648, authorized price $15.42 and "Check for Sale" are shown;
//   * historical RESEARCH is kept as labelled evidence, NOT an active decision card, and no readiness warning replaces the status;
//   * no "List on eBay" action and no Listing-package panel appear;
//   * the operator-approved grade 9.2 is the listing grade while the original AI grade VF 8.0 is preserved separately;
//   * the stored-photo count is not presented as verified physical views.
//
// Invoke: node tests/v11a-oml-published-card.test.js

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
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };

const oml = {
  id: 'oml-25-listed', assetType: 'comic', assetCategory: 'comic', title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel',
  variant: 'Mike Deodato 1:25 Variant', grade: 'VF 8.0', isGraded: false, numericGrade: null,
  gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false,
  status: 'listed', ebayItemId: '366762997648', ebayUrl: 'https://www.ebay.com/itm/366762997648', listedAt: 1793000000000,
  listPrice: 15.42, price: '$15.42', priceLow: '$12.00', priceHigh: '$18.00', pricingSource: 'active_ask_derived',
  identityConfident: true, assetTypeConfident: true, identityMissingFields: [], identityReasons: [],
  decision: { action: 'RESEARCH', blockers: [], warnings: ['no-sold-evidence'], confidence: 'MEDIUM' },
  contract: { state: 'READY', price: 15.42, bands: null, listable: true, locks: [], fields: {} },
  comps: { count: 4 }, rawComps: { count: 4, prices: [14, 15, 16, 17], average: 15.5, lowest: 14, highest: 17 }, soldComps: [],
  images: ['data:image/png;base64,AA=='], image: 'data:image/png;base64,AA==', purchasePrice: null,
};
const noop = () => {};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true } });
try {
  const { CollectionDetail } = await server.ssrLoadModule('/src/App.jsx');
  const render = (item, extra = {}) => renderToStaticMarkup(React.createElement(CollectionDetail, {
    item, onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop, onReIdentify: noop, onManualCorrect: noop,
    onSetGradedOverride: noop, onConfirmAssetTypeComic: noop, onSaveListingFields: noop, onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop,
    currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop, ...extra,
  }));
  let html = '';
  try { html = render(oml); ok(true, 'the published OML card renders without throwing'); } catch (e) { ok(false, `renders - THREW ${e?.message}`); }
  const has = (re) => re.test(html);

  console.log('\n-- current listing status --');
  ok(has(/listed-badge[^>]*>Listed</) && has(/on eBay/), '"Listed ... on eBay" is shown');
  ok(has(/eBay ItemID 366762997648/), 'ItemID 366762997648 is shown explicitly');
  ok(has(/Authorized listing price \$15\.42/), 'the authorized listing price $15.42 is shown');
  ok(html.includes('data-testid="check-for-sale"') && has(/Check for Sale/), '"Check for Sale" is available');
  ok(!has(/List on eBay\s*[—-]/) && !has(/List locked/) && !has(/Approve this package/), 'no "List on eBay" action, no readiness lock, no listing-package approval');
  ok(!html.includes('data-testid="listing-preview-panel"'), 'the listing-package panel is not offered for a published asset');

  console.log('\n-- historical research does not compete with current status --');
  ok(html.includes('data-testid="historical-research"') && has(/Historical research \(before listing\): RESEARCH/), 'RESEARCH is kept as labelled historical evidence');
  ok(!has(/pill-decision-research/), 'it is NOT rendered as an active decision pill');
  ok(has(/not as a current instruction/), 'the card says it is evidence, not a current instruction');

  console.log('\n-- grade: operator-approved listing grade vs original AI grade --');
  ok(has(/9\.2 \(operator\)/), 'the header shows the operator-approved grade 9.2');
  ok(!has(/ · VF 8\.0</), 'the header does not present the stale AI grade VF 8.0 as the grade');
  ok(has(/Listing grade \(operator-approved\): 9\.2/), 'the listed card shows the operator-approved listing grade');
  ok(has(/Original AI grade: VF 8\.0/), 'the original AI grade is preserved, labelled as original');

  console.log('\n-- stored photos are not presented as verified physical views --');
  ok(has(/Stored photos on this record: 1 of 4 recommended/), 'the count says stored photos of 4 recommended');
  ok(has(/Slots are positions, not verified views/), 'slots are explicitly positions, not verified views');
  ok(!has(/Front ✓/) && !has(/Back missing/), 'the old "Front ✓ / Back missing" claim is gone');

  console.log('\n-- an UNLISTED card is unchanged: decision card + listing package affordance remain --');
  const unlisted = { ...oml, id: 'x', status: null, ebayItemId: null, ebayUrl: null };
  const html2 = render(unlisted);
  ok(/pill-decision-research/.test(html2) && !/data-testid="historical-research"/.test(html2), 'unlisted: the active decision card shows, no historical label');
  ok(/9\.2 \(operator\)/.test(html2), 'unlisted: the header still shows the operator grade');
} finally {
  await server.close();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
