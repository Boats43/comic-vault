// GATE B (2026-10-20) -- the pricing-evidence bundle moves as ONE unit on every client merge site (src/lib/pricingBundleMerge.js, wired in src/App.jsx).
//
// THE LATENT DEFECT (proven from the code, not claimed as the cause of the Production row): api/enrich.js returns priceBands null on its refusal paths, and
// `enrich.priceBands || cur.priceBands` turns that null into "keep the old bands" -- so stale pricing survives exactly when the system has just declared it cannot establish new
// pricing; and priceDerivationTrace / authoritativeRecommendation are merged by NO site, so they ride in on `...cur` forever.
// WHAT THE PRODUCTION LOGS SHOW about Old Man Logan #25 (2026-10-16): passes at 03:57:57Z and 03:58:16Z priced $4.18 from a 16-listing regular-cover pool (variant confirmed as the
// notation "1/25", which eBay titles' "1:25" do not match, so the upstream variant preference did not narrow the pool); the FINAL pass (03:58:31-34Z) was NOT a refusal: it returned
// tier-3 bands ($12.74/$15.10/$17.36, count 6) and a trace ($15.10). Why that response's bundle did not replace the stored one is NOT established. The $4.18-from-regular-covers cause is
// fixed in src/lib/priceBands.js (tests/gate-b-variant-evidence.test.js); this file pins the client rule.
//
// Three cases, never two: NEW EVIDENCE replaces the whole bundle; REFUSED/OMITTED leaves no current band and moves the old bundle to a non-authoritative historical record;
// EMPTY ({}) is not a result and is never stored as one. Section 4 replays a SYNTHETIC response that lacks bands, shaped from the stored row, through the legacy and new expressions.
// Invoke: node tests/gate-b-pricing-bundle-merge.test.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergePricingBundle, isPricingBandResult, PRICING_BUNDLE_MEMBERS } from '../src/lib/pricingBundleMerge.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const NOW = () => Date.parse('2026-10-20T12:00:00Z');
const merge = (prior, enrich) => mergePricingBundle(prior, enrich, { now: NOW });

const OLD = {   // the stored 03:23 generation, field for field where the Production row showed it
  title: 'old man logan deodato', variant: '', issue: '25', year: '2017', publisher: 'Marvel',
  priceBands: { quick: '$2.13', market: '$4.18', stretch: '$4.81', source: 'tier3_active_discounted', count: 16, tier: 3, variantAdjusted: false },
  rawComps: { count: 16, average: 4.916875, lowest: 2.5, highest: 10, evidenceObservedAt: '2026-10-16T03:23:23.728Z', prices: [{ price: 5.99, title: 'Old Man Logan #25 Mike Deodato Jr. (Marvel Comics August 2017)' }] },
  priceDerivationTrace: { finalPrice: 4.18, pricingSource: 'tier3_active_discounted', operations: [{ step: 'active_ask_discount', factor: 0.85, outputValue: 4.18 }] },
  authoritativeRecommendation: '$4.18',
  price: '$4.18',
};
const NEW_BANDS = { quick: '$12.74', market: '$15.10', stretch: '$17.36', source: 'tier3_active_discounted', count: 5, tier: 3, variantAdjusted: false, variantEvidence: { applicable: 5, nonVariant: 0, ratio: '1:25' } };
const NEW_POOL = { count: 5, average: 17.992, lowest: 14.99, highest: 24.99, evidenceObservedAt: '2026-10-16T03:58:15.000Z', prices: [{ price: 15, title: 'Old Man Logan #25 Mike Deodato 1:25 Variant Cover 2017' }] };
const NEW_TRACE = { finalPrice: 15.1, pricingSource: 'tier3_active_discounted', operations: [{ step: 'active_ask_discount', factor: 0.85, outputValue: 15.1 }] };

console.log('\n=== GATE B pricing-bundle merge ===\n');

console.log('-- 1. NEW EVIDENCE: the bundle is replaced as one --');
let m = merge(OLD, { variant: '1:25', priceBands: NEW_BANDS, rawComps: NEW_POOL, priceDerivationTrace: NEW_TRACE, authoritativeRecommendation: '$15.10' });
ok(m.pricingBundleStatus === 'CURRENT' && m.priceBands === NEW_BANDS && m.rawComps === NEW_POOL && m.priceDerivationTrace === NEW_TRACE && m.authoritativeRecommendation === '$15.10', 'complete successful refresh: all four members come from the response');
ok(m.historicalPricingEvidence === null, '   and the superseded generation is not left lying around as "historical" once a current bundle exists');
m = merge(OLD, { priceBands: NEW_BANDS });
ok(m.priceBands === NEW_BANDS && m.rawComps === null && m.priceDerivationTrace === null && m.authoritativeRecommendation === null, 'new bands but no pool/trace/recommendation in the response: those become null, they are NEVER filled from the old row (no mixing generations)');
ok(JSON.stringify(m).indexOf('4.18') === -1, '   no trace of the old $4.18 survives anywhere in the merged bundle');

console.log('-- 2. REFUSED / OMITTED: no current band; the old bundle is historical --');
for (const [label, enrich] of [['refused refresh (priceBands: null)', { priceBands: null }], ['missing priceBands (key absent)', { price: null }]]) {
  m = merge(OLD, enrich);
  ok(m.priceBands === null && m.pricingBundleStatus === 'REFUSED_OR_OMITTED', `${label}: the row shows NO current band`);
  ok(m.rawComps === null && m.priceDerivationTrace === null && m.authoritativeRecommendation === null, '   stale pool, trace and recommendation are not current either');
  const h = m.historicalPricingEvidence;
  ok(h && h.authoritative === false && h.status === 'HISTORICAL' && h.priceBands.market === '$4.18' && h.rawComps.count === 16 && h.priceDerivationTrace.finalPrice === 4.18 && h.authoritativeRecommendation === '$4.18', '   the old bundle is kept whole, marked authoritative:false / HISTORICAL');
  ok(h && h.observedUnder.title === 'old man logan deodato' && h.observedUnder.variant === '' && /^2026-10-20T12:00:00/.test(h.supersededAt), '   with the identity it was observed under and when it was superseded');
}
m = merge(OLD, { priceBands: null, rawComps: NEW_POOL });
ok(m.priceBands === null && m.rawComps === NEW_POOL && m.historicalPricingEvidence.rawComps.count === 16, 'a refusal that still reports the pool it saw: that pool is the current OBSERVATION (not a price), the old pool is historical');

console.log('-- 3. EMPTY bundle is not a result --');
for (const empty of [{}, { market: 0 }, { market: '$0.00' }, { quick: '$1.00' }]) {
  m = merge(OLD, { priceBands: empty });
  ok(m.priceBands === null && !isPricingBandResult(empty), `priceBands ${JSON.stringify(empty)} is not stored as a result (current priceBands null)`);
}
m = merge(OLD, { priceBands: {} });
ok(m.pricingBundleStatus === 'EMPTY_REJECTED' && m.historicalPricingEvidence.reason === 'refresh-returned-empty-bands', 'an empty object is recorded as EMPTY_REJECTED with its own reason; the old bundle is historical');
ok(Array.isArray(PRICING_BUNDLE_MEMBERS) && PRICING_BUNDLE_MEMBERS.length === 4, 'the bundle is exactly priceBands, rawComps, priceDerivationTrace, authoritativeRecommendation');

console.log('-- identity changed since the bundle was observed --');
m = merge(OLD, { variant: '1:25', priceBands: null });
ok(m.historicalPricingEvidence.identityChangedSinceObserved === true && m.historicalPricingEvidence.observedUnder.variant === '', 'changed variant (none -> 1:25) + no bands: the old bundle is historical and flagged identity-changed');
m = merge(OLD, { title: 'Old Man Logan', priceBands: null });
ok(m.historicalPricingEvidence.identityChangedSinceObserved === true && m.priceBands === null, 'changed canonical title + no bands: historical, flagged identity-changed, no current band');
m = merge(OLD, { variant: '', title: 'old man logan deodato', priceBands: null });
ok(m.historicalPricingEvidence.identityChangedSinceObserved === false && m.priceBands === null, 'same identity + no bands: still no current band (staleness is about the response, not only identity), flagged unchanged');
m = merge({ ...OLD, priceBands: null, rawComps: null, priceDerivationTrace: null, authoritativeRecommendation: null, historicalPricingEvidence: { authoritative: false, status: 'HISTORICAL', marker: 'earlier' } }, { priceBands: null });
ok(m.historicalPricingEvidence && m.historicalPricingEvidence.marker === 'earlier', 'a second refusal with nothing current to move keeps the earlier historical record instead of wiping it');
m = merge({ ...OLD, historicalPricingEvidence: { authoritative: false, marker: 'earlier' } }, { priceBands: NEW_BANDS, rawComps: NEW_POOL });
ok(m.pricingBundleStatus === 'CURRENT' && m.historicalPricingEvidence === null, 'a later successful refresh makes the bundle CURRENT and clears the historical record');
ok(merge(null, null).priceBands === null && merge(undefined, { priceBands: NEW_BANDS }).priceBands === NEW_BANDS, 'null prior / null response do not throw');

console.log('-- 4. synthetic reproduction of the stale-bundle shape (stored row fields; the response is HYPOTHETICAL -- the real 03:58:34 response carried bands) --');
// the expression every site used before this change
const legacy = (cur, enrich) => ({ priceBands: enrich.priceBands || cur.priceBands || {}, rawComps: enrich.rawComps || cur.rawComps || null });
const row0328 = { ...OLD, variant: '1:25', contract: { price: 4.18, state: 'ESTIMATED' }, price: '$4.18' };   // variant confirmed; bundle still the 03:23 generation
const resp0358 = { price: '$15.10', priceNote: '9.2 · 6 active asks', variant: '1:25', pricingSource: 'active_ask_derived', priceBands: null, contract: { price: 15.1, state: 'ESTIMATED', source: 'active_ask_derived' } };   // HYPOTHETICAL: price + contract advance, bands null (the latent defect shape, not what Production returned)
const oldRow = { ...row0328, ...resp0358, ...legacy(row0328, resp0358) };
ok(oldRow.priceBands.market === '$4.18' && oldRow.contract.price === 15.1 && oldRow.rawComps.count === 16, 'NEGATIVE CONTROL -- for a response shaped like this the legacy expression produces the same contradiction seen in Production: contract $15.10 beside bands $4.18 and the 16-listing pool');
const newRow = { ...row0328, ...resp0358, ...merge(row0328, resp0358) };
ok(newRow.contract.price === 15.1 && newRow.price === '$15.10', 'with the new rule the newer contract and price are kept (they are the response)');
ok(newRow.priceBands === null && newRow.rawComps === null && newRow.priceDerivationTrace === null && newRow.authoritativeRecommendation === null, 'and NO 03:23 band, pool, trace or recommendation is left wearing current clothes');
ok(newRow.historicalPricingEvidence.authoritative === false && newRow.historicalPricingEvidence.priceBands.market === '$4.18' && newRow.historicalPricingEvidence.rawComps.evidenceObservedAt === '2026-10-16T03:23:23.728Z' && newRow.historicalPricingEvidence.identityChangedSinceObserved === false, 'the 03:23 evidence is preserved as historical with its original observation time (variant already confirmed in cur, so the identity did not change at this step)');
const viaVariantStep = merge(OLD, { ...resp0358 });
ok(viaVariantStep.historicalPricingEvidence.identityChangedSinceObserved === true, 'replayed from the pre-variant row directly: flagged identity-changed (observed with no variant, refreshed with 1:25)');

console.log('-- 5. every client site uses the rule (structural, by absence and by count) --');
const here = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(here, '..', 'src', 'App.jsx'), 'utf8');
const raw = (app.match(/enrich\.(priceBands|rawComps) \|\|/g) || []);
ok(raw.length === 0, `no site still merges priceBands/rawComps with the old "enrich.X ||" fallback (found ${raw.length})`);
const calls = (app.match(/\.\.\.mergePricingBundle\((cur|s|item), enrich\)/g) || []);
ok(calls.length === 9, `the bundle rule is spread at exactly the 9 former merge sites (found ${calls.length})`);
ok(/import \{ mergePricingBundle \} from "\.\/lib\/pricingBundleMerge\.js";/.test(app), 'App.jsx imports mergePricingBundle');
const inv = (app.match(/enrich\.(priceDerivationTrace|authoritativeRecommendation)/g) || []).length;
ok(inv === 0, 'trace and recommendation are only merged through the bundle rule (no ad-hoc client merge of them)');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
