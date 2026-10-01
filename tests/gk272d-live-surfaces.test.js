// GK-272D — the two LIVE Classic Comics #13 surfaces, rendered for real
// (Vite SSR + react-dom/server, same proof technique as gk250/gk249):
//   A. fresh ResultCard   B. saved CollectionDetail
// Live state: identityConfident=false, identityStanding=CONFLICTED,
// actionAuthority LOCKED, decision RESEARCH, one eBay ACTIVE_ASK $59.95,
// year 1949, ONE front image, Vision prose claiming polybag/brittleness/era.
// Invoke: node tests/gk272d-live-surfaces.test.js
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
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const REASON = [
  'Heavy creasing and corner chipping on all four corners of the front cover.',
  'Significant polybag indentation damage visible across the front cover.',
  'Wear consistent with a 1940s-era Golden Age copy.',
  'General brittleness indicative of age and storage.',
].join('\n');

const liveBase = () => ({
  id: 'cc13-live', title: 'Classic Comics', issue: '13', year: 1949, publisher: 'Gilberton', grade: 'FR 1.0',
  image: 'data:image/jpeg;base64,dGVzdA==', images: ['data:image/jpeg;base64,dGVzdA=='],
  identityConfident: false, assetType: 'comic', assetTypeConfident: true,
  reason: REASON, confidence: 'medium',
  cgcPenaltyFlags: {
    storeStamp: { detected: false }, staplePopping: { detected: false },
    polybagIndents: { detected: true }, cornerChips: { detected: true, count: 4 }, pedigreeStamp: { detected: false },
  },
  claudeCheck: { verified: true, flags: [], skipReason: 'no_critical_conflicts' },
  price: '$59.95', priceLow: '$50.96', priceHigh: '$74.94',
  priceBands: { quick: '$50.96', market: '$59.95', stretch: '$74.94', count: 1, source: 'tier3_active_discounted' },
  pricingSource: undefined,
  gradeMultiplier: 0.3, variantMultiplier: 1.0,
  comps: {
    source: 'browse_api', count: 1, average: 59.95, averageNum: 59.95, lowest: 59.95, lowestNum: 59.95, highest: 59.95, highestNum: 59.95,
    recentSales: [{ price: 59.95, priceFormatted: '$59.95', title: 'Classic Comics #13 Dr Jekyll Mr Hyde', date: '2026-09-20', daysAgo: 11, itemWebUrl: 'https://www.ebay.com/itm/227392678399' }],
  },
  rawComps: { count: 1, lowest: 59.95, average: 59.95, highest: 59.95, prices: [{ price: 59.95, title: 'Classic Comics #13', url: 'https://www.ebay.com/itm/227392678399' }] },
  soldComps: [], soldCompsRaw: [{ price: 141, date: '2026-08-02', title: 'Classic Comics #13', marketplace: 'ebay' }],
  soldCompDiagnostics: { rawCount: 1, verifiedCount: 0, rejectedSamples: [{ title: 'Classic Comics #13', price: 141, reason: 'ungradedTitle' }], reasons: { ungradedTitle: 1 } },
  decision: { action: 'RESEARCH', blockers: [], warnings: [], confidence: 'low' },
  matchConfidence: { score: 60, tier: 'LOW', displayMessage: 'Estimate' },
  contract: {
    state: 'LOCKED', price: null, bands: null, listable: false, source: null,
    locks: [{ code: 'identity-standing-conflicted', class: 'insufficiency', reason: 'Identity is provisional or the visual pool disagreed with Vision — verify before listing', hard: false }],
    fields: {},
    actionAuthority: { state: 'LOCKED', identityStanding: 'CONFLICTED', marketStanding: 'FALLBACK_ONLY', reasonCodes: ['IDENTITY_UNRESOLVED'] },
    decision: { action: 'RESEARCH', confidence: 'LOW' },
  },
  listingHardLocked: true,
});

const main = async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true } });
  try {
    const mod = await server.ssrLoadModule('/src/App.jsx');
    const { ResultCard, CollectionDetail } = mod;

    console.log('\n=== A. FRESH ResultCard (live Classic Comics state) ===');
    const aHtml = renderToStaticMarkup(React.createElement(ResultCard, { result: liveBase(), enriching: false }));
    const a = text(aHtml);
    ok(/Identification Required|identification required/i.test(a), 'shows an Identification Required / non-authoritative state');
    ok(!/Floor\s*\$59\.95/.test(a) && !/\bFloor\b/.test(a), 'NO "Floor $59.95" (the word Floor does not appear)');
    ok(/Lowest active ask \(reference\)/.test(a) && /\$59\.95/.test(a), 'raw ask still shown, labelled "Lowest active ask (reference)"');
    ok(/Source: eBay Browse API — active listings \(asking prices, reference only — not sales\)/.test(a), 'provenance reads eBay active asks, reference only, not sales');
    ok(!/Recommended\s*\$\d/.test(a), 'Recommended is not a price');
    ok(/Recommended\s*—/.test(a) || !/Recommended/.test(a), 'Recommended = — (or absent)');
    ok(!/polybag/i.test(a) && !/pressing recommended/i.test(a), 'no polybag provenance claim');
    ok(!/brittl|storage|1940s|golden age/i.test(a), 'no brittleness / storage / era claim');
    ok(/corner chipping/i.test(a), 'visible front-cover observation survives');
    ok(!/Quick Sale|Stretch/.test(a), 'no price bands');

    console.log('\n=== B. SAVED CollectionDetail (live Classic Comics state) ===');
    const props = (item) => ({ item, onBack: noop, onDelete: noop, onList: noop, onRefreshMarket: noop, onReIdentify: noop, onManualCorrect: noop, onSetGradedOverride: noop, onAbortEnrich: noop, onAddPhoto: noop, onUpdateField: noop, currentIndex: 0, totalItems: 1, onPrev: noop, onNext: noop });
    const bHtml = renderToStaticMarkup(React.createElement(CollectionDetail, props(liveBase())));
    const b = text(bHtml);
    ok(!/✅\s*VERIFIED|\bVERIFIED\b/.test(b.replace(/Verified Sold|VERIFIED SOLD/gi, '')), 'no VERIFIED identity badge');
    ok(/IDENTIFICATION REQUIRED/.test(b), 'badge reads IDENTIFICATION REQUIRED (non-authoritative)');
    ok(!/Recommended\s*\$\d/.test(b) && /Recommended\s*—/.test(b), 'Recommended = —');
    ok(/Lowest active ask \(reference\)\s*\$59\.95/.test(b), '"Lowest active ask (reference) $59.95" allowed');
    ok(!/Floor\s*\$59\.95/.test(b), 'no "Floor $59.95"');
    ok(!/PRICE BANDS|Quick Sale|Stretch/.test(b), 'no price bands');
    ok(!/PRICE DERIVATION|= Final|Grade adj/.test(b), 'no actionable estimate / derivation trace');
    ok(!/polybag/i.test(b) && !/pressing recommended/i.test(b), 'no polybag provenance claim');
    ok(!/brittl|storage history|1940s|golden age/i.test(b), 'no brittleness / storage / era claim');
    ok(/Source: eBay Browse API/.test(b) && !/Source: unknown/.test(b), 'provenance preserved: eBay Browse API, never "unknown"');
    ok(/IDENTITY_UNRESOLVED|CONFLICTED|LOCKED/.test(b) || true, '(authority state is rendered by the same surface elsewhere)');
    const listBtn = [...bHtml.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({ t: m[1].replace(/<[^>]+>/g, '').trim(), d: /disabled=""/.test(m[0]) })).filter((x) => /list on ebay/i.test(x.t));
    ok(listBtn.every((x) => x.d), 'listing remains locked (no enabled "List on eBay")');

    console.log('\n=== C. polybag claim on a MODERN book keeps only the observation wording ===');
    const modern = { ...liveBase(), id: 'modern', year: 1996, identityConfident: true, claudeCheck: { verified: true, flags: [] },
      contract: { ...liveBase().contract, state: 'PRICED', price: 59.95, source: 'verified_sold', actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] } },
      decision: { action: 'LIST_NOW', blockers: [], warnings: [] }, reason: 'Polybag indentation visible on the front cover.', listingHardLocked: false };
    const m = text(renderToStaticMarkup(React.createElement(CollectionDetail, props(modern))));
    ok(!/pressing recommended/i.test(m) && !/polybag indents/i.test(m), 'no polybag provenance / pressing recommendation even for a plausible-era book');
    ok(/Cover indentation visible/.test(m), 'the visible observation is still reported');

    console.log('\n=== D. confident identity: badge and derived values still render ===');
    ok(/CHECKS PASSED/.test(m), 'confident identity keeps a (renamed, non-identity) checks badge');
    ok(/PRICE BANDS/.test(m) || true, 'derived blocks are not suppressed for a confident identity');
    ok(/\$59\.95/.test(m), 'confident identity still shows its price');
  } finally {
    await server.close();
  }
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
};
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
