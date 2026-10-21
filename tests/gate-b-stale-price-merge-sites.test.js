// GATE B (2026-10-21) -- STALE-PRICE RESURRECTION at the client merge sites (duplicate-confirm, re-identify, duplicate-sync). No network, no DB.
//
// REAL: the duplicate-confirm `updated = { ...cur, ... }` literal is EXTRACTED FROM THE SHIPPED src/App.jsx and executed (the technique tests/gk213a-identity-authority.test.js uses), at every
// site that has it, with the real mergePricingBundle / isPriceInvalidatingRefusal. The re-identify and duplicate-sync sites are inline expressions inside React closures that cannot be
// extracted cleanly; they are covered by a STATIC source scan (label: STATIC-SOURCE, not executed). The scan is also run on the pre-repair source (git show ba19141:src/App.jsx) as a negative control.
//
// WHAT THIS PROVES (client-merge level only): a newer refusal that invalidates the prior price is not undone by `enrich.price || cur.price` at these sites; a later qualified estimate replaces it;
// refusal fields stay null. WHAT IT DOES NOT PROVE: that an OLDER response cannot overwrite a NEWER state (no response ordering exists anywhere -- see docs/GATE-B-STALE-RESPONSE-DESIGN-2026-10-21.md). Section 4
// prints that gap with its observed behavior; it is reported, never asserted as safe.
// Invoke: node tests/gate-b-stale-price-merge-sites.test.js
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mergeConfirmedIdentity, applyProvisionalIdentity, isPriceInvalidatingRefusal } from '../src/lib/dataQualityGuard.js';
import { mergePricingBundle } from '../src/lib/pricingBundleMerge.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const norm = (s) => s.replace(/\r\n/g, '\n');
const current = norm(readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8'));
const prior = norm(execSync('git show ba19141:src/App.jsx', { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));

const ANCHOR = 'const idGatedDup = enrich.identityConfident === false || enrich.assetTypeConfident === false;';
function dupConfirmSites(src) {
  const out = [];
  for (let from = src.indexOf(ANCHOR); from !== -1; from = src.indexOf(ANCHOR, from + 1)) {
    const os = src.indexOf('const updated = { ...cur,', from);
    if (os === -1 || os - from > 400) continue;
    const ap = src.indexOf('applyProvisionalIdentity(enrich, cur),', os);
    if (ap === -1) continue;
    const oe = src.indexOf('};', ap) + 2;
    if (!src.slice(oe, oe + 600).includes("duplicate-confirm's own post-enrich")) continue;
    out.push(src.slice(from, oe));
  }
  return out;
}
const runSite = (block, enrich, cur) => new Function('enrich', 'cur', 'mergeConfirmedIdentity', 'applyProvisionalIdentity', 'mergePricingBundle', 'isPriceInvalidatingRefusal', `${block}\nreturn updated;`)(enrich, cur, mergeConfirmedIdentity, applyProvisionalIdentity, mergePricingBundle, isPriceInvalidatingRefusal);

const OBSOLETE_BANDS = { quick: '$2.13', market: '$4.18', stretch: '$4.81', source: 'tier3_active_discounted', count: 16, tier: 3 };
const obsoleteRow = () => ({
  id: 'oml-25', title: 'Old Man Logan', issue: '25', year: '2017', variant: '1:25', identityConfident: true, assetTypeConfident: true,
  price: '$4.18', priceLow: '$2.13', priceHigh: '$4.81', pricingSource: 'active_ask_derived', priceNote: '16 active asks',
  priceBands: OBSOLETE_BANDS, rawComps: { count: 16, average: 4.92 }, priceDerivationTrace: { finalPrice: 4.18 }, authoritativeRecommendation: { price: 4.18 },
  contract: { state: 'ESTIMATED', listable: false }, decision: { action: 'RESEARCH' },
});
const refusal = () => ({
  title: 'Old Man Logan', issue: '25', year: '2017', identityConfident: true, assetTypeConfident: true, price: null, priceLow: null, priceHigh: null, priceBands: null,
  pricingSource: 'refused-variant-evidence-insufficient', refusedToPrice: true, priceNote: 'No price: only 0 listing(s) name the 1:25 variant',
  rawComps: { count: 16, average: 4.92 }, contract: { state: 'REFUSED', listable: false }, decision: { action: 'RESEARCH' },
});
const qualified = () => ({
  title: 'Old Man Logan', issue: '25', year: '2017', identityConfident: true, assetTypeConfident: true, price: '$15.29', priceLow: '$12.74', priceHigh: '$17.59',
  priceBands: { quick: '$12.74', market: '$15.29', stretch: '$17.59', source: 'tier3_active_discounted', count: 5, tier: 3, variantEvidence: { applicable: 5, nonVariant: 0 } },
  pricingSource: 'active_ask_derived', priceNote: '5 active asks (not sold-verified)', rawComps: { count: 5, average: 17.99 },
  priceDerivationTrace: { finalPrice: 15.29 }, authoritativeRecommendation: { price: 15.29 }, contract: { state: 'ESTIMATED', listable: false }, decision: { action: 'RESEARCH' },
});

for (const [label, src, expectFixed] of [['REPAIRED source', current, true], ['PRE-REPAIR source (ba19141) -- negative control', prior, false]]) {
  console.log(`\n== duplicate-confirm literal, executed from ${label} ==`);
  const sites = dupConfirmSites(src);
  ok(sites.length >= 1, `${label}: ${sites.length} duplicate-confirm merge site(s) extracted from the shipped source`);
  sites.forEach((block, i) => {
    const t = `[site ${i + 1}/${sites.length}]`;
    const r = runSite(block, refusal(), obsoleteRow());
    const stalePrice = r.price === '$4.18' || r.priceLow === '$2.13' || r.priceHigh === '$4.81';
    if (expectFixed) {
      ok(r.price === null && r.priceLow === null && r.priceHigh === null, `${t} refusal after the obsolete $4.18 row: price/priceLow/priceHigh are null (got ${JSON.stringify([r.price, r.priceLow, r.priceHigh])})`);
      ok(r.priceBands == null && r.pricingBundleStatus === 'REFUSED_OR_OMITTED', `${t} no obsolete band is current (status ${r.pricingBundleStatus})`);
      ok(r.historicalPricingEvidence && r.historicalPricingEvidence.authoritative === false && r.historicalPricingEvidence.priceBands && r.historicalPricingEvidence.priceBands.market === '$4.18', `${t} the obsolete bundle is kept only as non-authoritative HISTORICAL`);
      ok(r.pricingSource === 'refused-variant-evidence-insufficient' && r.contract.state === 'REFUSED', `${t} refusal source and contract adopted (${r.pricingSource}, ${r.contract && r.contract.state})`);
      const q = runSite(block, qualified(), r);
      ok(q.price === '$15.29' && q.priceBands.market === '$15.29' && q.rawComps.count === 5 && q.pricingBundleStatus === 'CURRENT', `${t} a later qualified estimate replaces the refusal as one generation ($${q.price}, ${q.rawComps && q.rawComps.count} listings)`);
      ok(q.priceDerivationTrace.finalPrice === 15.29 && q.priceLow === '$12.74' && q.priceHigh === '$17.59', `${t} trace and low/high belong to the same generation`);
      const again = runSite(block, refusal(), q);
      ok(again.price === null && again.priceLow === null && again.priceHigh === null, `${t} refusal after the qualified estimate: null stays null (nothing resurrected from $15.29)`);
      const nullFields = runSite(block, { ...refusal(), priceLow: null, priceHigh: null }, { ...obsoleteRow(), priceLow: '$9.99', priceHigh: '$99.99' });
      ok(nullFields.priceLow === null && nullFields.priceHigh === null, `${t} explicit null refusal fields remain null even when the old row had other values`);
      const generic = runSite(block, { ...qualified(), pricingSource: 'verified_sold' }, obsoleteRow());
      ok(generic.price === '$15.29', `${t} unrelated sources are unchanged: a normal priced response still replaces the price`);
      const genericRefusal = runSite(block, { ...refusal(), pricingSource: 'refused-no-data-sources' }, obsoleteRow());
      ok(genericRefusal.price === '$4.18', `${t} scope held: only the variant-evidence refusal invalidates the price; other refusals keep the existing behavior ($${genericRefusal.price})`);
    } else {
      ok(stalePrice, `${t} NEGATIVE CONTROL: the pre-repair literal DOES restore the obsolete price after a refusal (${JSON.stringify([r.price, r.priceLow, r.priceHigh])}) -- these tests can fail`);
    }
  });
}

console.log('\n== STATIC-SOURCE scan: every `enrich.price|priceLow|priceHigh ?? / ||` merge must be refusal-aware ==');
function unguarded(src) {
  const re = /enrich\.price(?:Low|High)?\s*(\?\?|\|\|)/g; let m; const bad = [];
  while ((m = re.exec(src))) {
    const ctx = src.slice(Math.max(0, m.index - 160), m.index);
    const line = src.slice(0, m.index).split('\n').length;
    const text = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
    if (/isPriceInvalidatingRefusal\(enrich\)/.test(ctx)) continue;
    if (/^\s*\/\//.test(text) || /\/\/.*enrich\.price/.test(text) && !/=/.test(text.split('//')[0])) continue; // comment
    if (/const newP = lowMatch \? s\.price : \(enrich\.price \|\| s\.price\);/.test(text)) continue; // feeds only the `pc` flag; the same object spreads `...enrich` (price null) so nothing is restored
    bad.push({ line, text: text.trim().slice(0, 110) });
  }
  return bad;
}
const badNow = unguarded(current), badPrior = unguarded(prior);
ok(badNow.length === 0, `repaired source: 0 unguarded enrich.price* merges (${badNow.length}${badNow.length ? ': ' + JSON.stringify(badNow) : ''})`);
ok(badPrior.length >= 5, `NEGATIVE CONTROL pre-repair source: ${badPrior.length} unguarded merges are found (duplicate-confirm x3, re-identify, duplicate-sync x2) -- the scan can fail`);
ok(/const newPriceRM = \(idGatedRM \|\| isPriceInvalidatingRefusal\(enrich\)\) \? null/.test(current), 're-identify (reIdentifyBook): refusal nulls the price (static)');

console.log('\n== Section 4: ORDERING (client-merge level) -- REPORTED GAP, not asserted ==');
{
  const row0 = obsoleteRow();
  const merge = (cur, e) => ({ ...cur, ...mergePricingBundle(cur, e), price: isPriceInvalidatingRefusal(e) ? null : (e.price ?? cur.price) });
  const oldResp = { ...obsoleteRow(), pricingSource: 'active_ask_derived' };
  const afterRefusal = merge(row0, refusal());
  const replayOverRefusal = merge(afterRefusal, oldResp);
  const afterQualified = merge(afterRefusal, qualified());
  const replayOverQualified = merge(afterQualified, oldResp);
  const orderA = merge(merge(row0, oldResp), refusal());   // old then refusal arrive in order
  const orderB = merge(merge(row0, refusal()), oldResp);   // overlapping: the OLD response lands LAST
  const line = (n, r) => console.log(`  GAP  ${n}: price=${r.price} band=${r.priceBands && r.priceBands.market} status=${r.pricingBundleStatus}`);
  line('old response replayed after a newer REFUSAL      ', replayOverRefusal);
  line('old response replayed after a newer QUALIFIED est', replayOverQualified);
  line('overlap, arrival order old -> refusal             ', orderA);
  line('overlap, arrival order refusal -> old (inverted)  ', orderB);
  console.log(`  GAP  verdict: the final state depends on ARRIVAL order (${orderA.price} vs ${orderB.price}). The merge cannot tell which response is newer; no server-owned ordering reaches it. Not certifiable client-side.`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
