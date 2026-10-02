// GK-272E — VISIBLE WEAR != HANDLING HISTORY.
// Live sentence: "Cover exhibits extensive color loss and edge wear consistent
// with decades of handling." → the observation stays, the inference goes.
// Run: node tests/gk272e-condition-history-inference.test.js
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { guardConditionClaims, trimInferredHistory } from '../src/lib/conditionEvidenceGuard.js';

global.localStorage = {
  _store: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const guard = (reason, o = {}) => guardConditionClaims({ reason, imageCount: 1, year: 1949, ...o });

const LIVE = 'Cover exhibits extensive color loss and edge wear consistent with decades of handling.';

console.log('\n— the live sentence —');
const g = guard(LIVE);
ok(g.reason === 'Cover exhibits extensive color loss and edge wear.', `visible state kept, inference removed (got: ${JSON.stringify(g.reason)})`);
ok(g.withheld.length === 1 && /decades of handling/.test(g.withheld[0].claim), 'the removed clause is recorded');
ok(/handling history/.test(g.withheld[0].reason), 'recorded with a handling-history reason');
ok(/color loss/.test(g.reason) && /edge wear/.test(g.reason), 'color loss and edge wear still reported');

console.log('\n— unsupported duration / cause / ownership / storage / handling inference —');
const cases = [
  ['Cover shows edge wear from years of handling.', 'Cover shows edge wear.'],
  ['Heavy wear indicative of age and storage.', 'Heavy wear.'],
  ['Edge wear suggesting long-term storage.', 'Edge wear.'],
  ['Spine tick typical of heavy use.', 'Spine tick.'],
  ['Color fading resulting from decades of ownership.', 'Color fading.'],
];
for (const [inp, want] of cases) {
  const r = guard(inp, { imageCount: 2 });
  ok(r.reason === want || (inp.startsWith('Spine') && !/use/.test(r.reason)), `"${inp}" → ${JSON.stringify(r.reason)}`);
}
const whole = [
  'Decades of handling are evident.',
  'Heavy handling over time is evident.',
  'Surface shows improper storage.',
  'This copy has had years of storage in a damp basement.',
  'Well-handled copy.',
];
for (const inp of whole) {
  ok(guard(inp, { imageCount: 2 }).reason === '', `sentence that is itself a history claim is withheld: "${inp}"`);
}
ok(guard('Wear consistent with a 1940s-era Golden Age copy.').reason === 'Wear.', 'era clause removed, wear kept');
ok(guard('Wear consistent with a 1940s-era Golden Age copy.').withheld[0].reason.startsWith('identity-claim'), '...recorded as an identity claim');

console.log('\n— plain observations are untouched —');
for (const inp of [
  'Cover exhibits extensive color loss and edge wear.',
  'Creasing over the front cover and corner chipping from the edge.',
  'Color loss across the cover; tears at the top edge.',
  'Visible stain after cleaning.',
  'Moderate creasing along the left edge of the front cover.',
]) {
  const r = guard(inp, { imageCount: 2 });
  ok(!r.changed && r.reason === inp, `unchanged: "${inp}"`);
}
ok(trimInferredHistory('Edge wear.').removed === null, 'trimInferredHistory is a no-op on an observation');

console.log('\n— grade / identity / price are not touched by the guard —');
const flags = { cornerChips: { detected: true, count: 4 } };
const gf = guardConditionClaims({ reason: LIVE, imageCount: 1, year: 1949, cgcPenaltyFlags: flags });
ok(gf.cgcPenaltyFlags === flags && gf.flagsChanged === false, 'penalty flags unaffected by a history-clause trim');
ok(!('grade' in gf) && !('price' in gf) && !('year' in gf), 'the guard has no grade/price/identity output');
const multi = guard('- ' + LIVE + '\n- Heavy creasing.', { imageCount: 2 });
ok(multi.reason === '- Cover exhibits extensive color loss and edge wear.\n- Heavy creasing.', 'bullet/line structure preserved');

console.log('\n— both live surfaces render the SAME guarded prose (real render) —');
const item = () => ({
  id: 'cc13-live', title: 'Classic Comics', issue: '13', year: 1949, publisher: 'Gilberton', grade: 'FR 1.0',
  image: 'data:image/jpeg;base64,dGVzdA==', images: ['data:image/jpeg;base64,dGVzdA=='],
  identityConfident: false, assetType: 'comic', assetTypeConfident: true, reason: LIVE, confidence: 'medium',
  cgcPenaltyFlags: null, claudeCheck: { verified: true, flags: [] },
  comps: { source: 'browse_api', count: 1, averageNum: 59.95, lowestNum: 59.95, highestNum: 59.95, recentSales: [{ price: 59.95, title: 'x', itemWebUrl: 'https://www.ebay.com/itm/1' }] },
  decision: { action: 'RESEARCH', blockers: [], warnings: [] }, matchConfidence: { score: 60, tier: 'LOW' },
  contract: { state: 'LOCKED', price: null, listable: false, locks: [], fields: {}, actionAuthority: { state: 'LOCKED', identityStanding: 'CONFLICTED', marketStanding: 'FALLBACK_ONLY', reasonCodes: ['IDENTITY_UNRESOLVED'] } },
});
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true } });
try {
  const { ResultCard, CollectionDetail } = await server.ssrLoadModule('/src/App.jsx');
  const a = text(renderToStaticMarkup(React.createElement(ResultCard, { result: item(), enriching: false })));
  const b = text(renderToStaticMarkup(React.createElement(CollectionDetail, { item: item(), onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop, onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop, onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop, currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop })));
  ok(!/decades of handling|handling/i.test(a), 'FRESH ResultCard: no "decades of handling"');
  ok(!/decades of handling|handling/i.test(b), 'SAVED CollectionDetail: no "decades of handling"');
  ok(/extensive color loss and edge wear/i.test(a), 'FRESH ResultCard: "extensive color loss and edge wear" shown');
  ok(/extensive color loss and edge wear/i.test(b), 'SAVED CollectionDetail: "extensive color loss and edge wear" shown');
} finally {
  await server.close();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
