// GATE B (2026-10-21) -- PURE proof of listing-time pricing-bundle coherence and the pricingBasis snapshot builder. No network, no DB.
// The live (real handler + real Development database) proof is tests/gate-b-pricing-basis-live.test.js.
//
// Every check has a NEGATIVE CONTROL: a coherent bundle is mutated to violate exactly that one check and it must fail alone.
// THE CONTROL IS PARTIAL: the same-count / same-source substitution test below proves the limitation is real and that it is exposed, never hidden.
// Invoke: node tests/gate-b-pricing-coherence-pure.test.js
import { assessPricingBundleCoherence, COHERENCE_LIMITATION } from '../src/lib/pricingBundleCoherence.js';
import { buildPricingBasis, completePricingBasis, pricingBasisRefuses, MAX_BASIS_BYTES } from '../src/lib/pricingBasisSnapshot.js';
import { OML_FIVE, REGULAR_SIXTEEN, coherentBundle, historicalMixedRow, row } from './helpers/pricingBundleFixtures.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const durableOf = (b, extra = {}) => ({ title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: b.variant, price: b.price, rawComps: b.rawComps, comps: b.comps, priceBands: b.priceBands, priceDerivationTrace: b.priceDerivationTrace, ...b.exec, ...extra });
const receiptOf = (b, poolCount = b.rawComps.count, extra = {}) => ({
  issuedAt: 1792000000000, binding: { collectionItemId: 'cv_x', gkAssetId: 'asset-x', evidenceVersion: 'ev1' }, identity: { title: 'Old Man Logan', issue: '25', year: '2017' },
  values: { ...b.exec }, rawCompsCount: poolCount, soldCompCount: 0, ...extra,
});
const status = (res, id) => res.checks.find((c) => c.id === id)?.status;
const failsOnly = (res, id) => res.violations.length === 1 && res.violations[0].id === id;

console.log('\n== 1. a coherent bundle passes every evaluated check ==');
const good = coherentBundle(OML_FIVE);
const goodRes = assessPricingBundleCoherence({ durable: durableOf(good), receipt: receiptOf(good) });
ok(goodRes.coherent === true && goodRes.violations.length === 0, 'coherent bundle: no violations');
ok(goodRes.checks.every((c) => c.status === 'PASS'), `every check evaluated and passing (${goodRes.checks.map((c) => c.id + ':' + c.status).join(' ')})`);
ok(goodRes.protection === 'PARTIAL' && goodRes.limitation === COHERENCE_LIMITATION && /NOT detectable/.test(goodRes.limitation), 'the verdict is ALWAYS labelled PARTIAL and states the substitution limitation');

console.log('\n== 2. the recorded OML mixed-generation row is detected ==');
const hist = historicalMixedRow();
const histRes = assessPricingBundleCoherence({ durable: durableOf(hist), receipt: receiptOf(hist, hist.receiptPoolCount) });
const ids = histRes.violations.map((v) => v.id);
ok(histRes.coherent === false, 'the 6-vs-16 mixed row is NOT coherent');
for (const id of ['RECEIPT_COUNT', 'POOL_GENERATION', 'PRICE_TRACE', 'PRICE_BAND', 'VARIANT_EVIDENCE', 'WRONG_VARIANT_ROWS', 'VARIANT_APPLICABILITY']) ok(ids.includes(id), `detects ${id}`);
const histNoReceipt = assessPricingBundleCoherence({ durable: durableOf(hist), receipt: null });
ok(histNoReceipt.coherent === false && ['POOL_GENERATION', 'PRICE_TRACE', 'VARIANT_EVIDENCE'].every((id) => histNoReceipt.violations.some((v) => v.id === id)), 'even WITHOUT a receipt the bundle is rejected by its own internal contradictions');

console.log('\n== 3. negative controls: each check fails alone ==');
const mut = (label, id, fn, { receipt = true, poolCount } = {}) => {
  const b = coherentBundle(OML_FIVE); const d = durableOf(b); fn(d, b);
  const r = assessPricingBundleCoherence({ durable: d, receipt: receipt ? receiptOf(b, poolCount ?? 5) : null });
  ok(status(r, id) === 'FAIL' && failsOnly(r, id), `${label} -> ${id} FAILS alone (${r.violations.map((v) => v.id).join(',') || 'none'})`);
};
mut('refusedToPrice flag', 'REFUSED_OR_NO_PRICE', (d) => { d.refusedToPrice = true; });
mut('REFUSED contract', 'REFUSED_OR_NO_PRICE', (d) => { d.contract = { state: 'REFUSED' }; });
mut('refused pricingSource', 'REFUSED_OR_NO_PRICE', (d) => { d.pricingSource = 'refused-variant-evidence-insufficient'; }, { receipt: false });
mut('null price beside bands', 'REFUSED_OR_NO_PRICE', (d) => { d.price = null; });
{ const b = coherentBundle(OML_FIVE); const d = durableOf(b, { price: '$0.00' }); ok(assessPricingBundleCoherence({ durable: d, receipt: receiptOf(b) }).violations.some((v) => v.id === 'REFUSED_OR_NO_PRICE'), 'zero price beside bands -> REFUSED_OR_NO_PRICE fails (with its trace/band disagreements)'); }
{ const b = coherentBundle(OML_FIVE); const d = durableOf(b); d.rawComps = { ...d.rawComps, count: 6 }; d.comps = { ...d.comps, count: 6 }; d.priceBands = { ...d.priceBands, count: 6 }; const r = assessPricingBundleCoherence({ durable: d, receipt: receiptOf(b, 5) }); ok(r.violations.some((v) => v.id === 'RECEIPT_COUNT'), 'durable pool count 6 vs signed 5 -> RECEIPT_COUNT fails'); }
mut('signed pricingSource differs', 'RECEIPT_SOURCE', (d) => { d.pricingSource = 'verified_sold'; });
mut('comps vs rawComps generations', 'POOL_GENERATION', (d) => { d.comps = { ...d.comps, count: 6 }; });
mut('bands claim more listings than the pool', 'BAND_POOL', (d) => { d.priceBands = { ...d.priceBands, count: 9 }; });
mut('price differs from its trace', 'PRICE_TRACE', (d) => { d.priceDerivationTrace = { finalPrice: 4.18 }; d.priceBands = { ...d.priceBands, market: '$4.18' }; d.price = '$4.18'; d.priceDerivationTrace = { finalPrice: 15 }; });
mut('price differs from band market', 'PRICE_BAND', (d) => { d.priceBands = { ...d.priceBands, market: '$4.18' }; });
mut('confirmed ratio variant with no band evidence', 'VARIANT_EVIDENCE', (d) => { const { variantEvidence, ...rest } = d.priceBands; d.priceBands = rest; });
mut('band evidence for a different ratio', 'VARIANT_EVIDENCE', (d) => { d.priceBands = { ...d.priceBands, variantEvidence: { ...d.priceBands.variantEvidence, ratio: '1:50' } }; });
mut('fewer than 3 applicable listings', 'VARIANT_EVIDENCE', (d) => { d.priceBands = { ...d.priceBands, variantEvidence: { ...d.priceBands.variantEvidence, applicable: 2 } }; });
{ const b = coherentBundle(OML_FIVE); const d = durableOf(b); d.rawComps = { ...d.rawComps, prices: [...d.rawComps.prices.slice(0, 4), row([24.99, 'Old Man Logan #25 Marvel Comics regular cover'], 9)] }; d.comps = { ...d.comps, recentSales: d.comps.recentSales.slice(0, 4) }; ok(assessPricingBundleCoherence({ durable: d, receipt: receiptOf(b) }).violations.some((v) => v.id === 'WRONG_VARIANT_ROWS'), 'a regular-cover record in the stored pool -> WRONG_VARIANT_ROWS fails'); }
mut('variant applicability not CONFIRMED (signed)', 'VARIANT_APPLICABILITY', (d, b) => { b.exec.variantApplicability = 'UNVERIFIED'; });
mut('signed year differs from durable year', 'IDENTITY_YEAR', (d) => { d.year = '2016'; });
mut('signed issue differs from durable issue', 'IDENTITY_ISSUE', (d) => { d.issue = '26'; });
mut('records do not reproduce their own average', 'AGGREGATE_RECORDS', (d) => { d.rawComps = { ...d.rawComps, average: 99 }; });
mut('records do not reproduce their own count', 'AGGREGATE_RECORDS', (d) => { d.rawComps = { ...d.rawComps, prices: d.rawComps.prices.slice(0, 4) }; });

console.log('\n== 4. wrong-variant evidence cannot pass ==');
{
  const reg = coherentBundle(REGULAR_SIXTEEN);
  const r = assessPricingBundleCoherence({ durable: durableOf(reg), receipt: receiptOf(reg) });
  ok(r.coherent === false && r.violations.some((v) => v.id === 'WRONG_VARIANT_ROWS'), 'sixteen regular covers priced for a confirmed 1:25 are rejected even though the bundle is otherwise self-consistent');
  const noEv = coherentBundle(REGULAR_SIXTEEN, { withVariantEvidence: false });
  ok(assessPricingBundleCoherence({ durable: durableOf(noEv), receipt: receiptOf(noEv) }).violations.some((v) => v.id === 'VARIANT_EVIDENCE'), 'and the missing band variant-evidence is itself a violation');
}

console.log('\n== 5. SAME-COUNT / SAME-SOURCE SUBSTITUTION: the limitation is real and is exposed ==');
{
  const real = coherentBundle(OML_FIVE);
  const other = coherentBundle([[60, 'Old Man Logan #25 1:25 Deodato Variant substituted record A'], [61, 'Old Man Logan #25 1:25 Deodato Variant substituted record B'], [62, 'Old Man Logan #25 1:25 Deodato Variant substituted record C'], [63, 'Old Man Logan #25 1:25 Deodato Variant substituted record D'], [64, 'Old Man Logan #25 1:25 Deodato Variant substituted record E']]);
  // the receipt was signed over the REAL pass (count 5, source active_ask_derived); the durable row now holds DIFFERENT records with the same count and source label
  const r = assessPricingBundleCoherence({ durable: durableOf(other), receipt: receiptOf(real) });
  ok(r.coherent === true, 'a substituted pool with the same count, same source and consistent aggregates/titles/bands is NOT detected (documented PARTIAL control)');
  ok(r.protection === 'PARTIAL' && /same-count, same-source substitution/.test(r.limitation), 'the verdict nevertheless carries protection=PARTIAL and the explicit limitation text');
  const basis = buildPricingBasis({ durable: durableOf(other), receiptPayload: receiptOf(real), receiptBody: '{"x":1}', receiptBindingState: 'BOUND', evidenceVersion: 'ev1' });
  ok(basis.coherence.protection === 'PARTIAL' && /NOT detectable/.test(basis.coherence.limitation) && basis.provenance.pricingFieldsSigned === false, 'the immutable snapshot records the limitation and that the pricing fields are not signed -- never labelled fully protected');
  // detectable variants of the same attack
  const diffCount = { ...durableOf(other), rawComps: { ...other.rawComps, count: 4, prices: other.rawComps.prices.slice(0, 4) }, comps: { ...other.comps, count: 4 } };
  ok(assessPricingBundleCoherence({ durable: diffCount, receipt: receiptOf(real) }).violations.some((v) => v.id === 'RECEIPT_COUNT'), 'changing the count IS detected');
  const diffSource = { ...durableOf(other), pricingSource: 'verified_sold' };
  ok(assessPricingBundleCoherence({ durable: diffSource, receipt: receiptOf(real) }).violations.some((v) => v.id === 'RECEIPT_SOURCE'), 'changing the source label IS detected');
}

console.log('\n== 6. missing inputs are NOT_EVALUATED, never PASS ==');
{
  const empty = assessPricingBundleCoherence({ durable: {}, receipt: null });
  ok(empty.coherent === true && empty.evaluated === 0 && empty.checks.every((c) => c.status === 'NOT_EVALUATED'), 'an empty row has no demonstrated inconsistency, and zero checks claim to have passed');
  const eb = buildPricingBasis({ durable: {}, receiptPayload: null });
  ok(eb.reconstructability.verdict === 'NOT_RECONSTRUCTABLE' && eb.reconstructability.missing.includes('comparable records'), 'incomplete evidence is stored as NOT_RECONSTRUCTABLE (honestly), not silently dropped');
  ok(assessPricingBundleCoherence({ durable: null, receipt: null }).coherent === true && buildPricingBasis({ durable: undefined }).schemaVersion === 'pricing-basis-v1', 'null/undefined inputs are handled without throwing');
}

console.log('\n== 7. reconstructability verdicts ==');
{
  const full = buildPricingBasis({ durable: durableOf(good), receiptPayload: receiptOf(good), receiptBody: 'body', receiptBindingState: 'BOUND', evidenceVersion: 'ev1' });
  ok(full.reconstructability.verdict === 'FULL' && full.pool.records.length === 5 && full.pool.recordsSource === 'rawComps.prices', 'coherent, complete, bound -> FULL (5 of 5 records)');
  ok(full.receipt.verified === true && full.receipt.signedPoolCount === 5 && typeof full.receipt.bodySha256 === 'string' && full.receipt.bodySha256.length === 64 && full.photoEvidence.currentEvidenceVersion === 'ev1', 'receipt and photo-evidence references are recorded (body hash, signed count, evidence version)');
  const sampleOnly = (() => { const b = coherentBundle(OML_FIVE); const d = durableOf(b); delete d.rawComps; d.comps = { ...d.comps, count: 6 }; d.priceBands = { ...d.priceBands, count: 6 }; return d; })();
  const part = buildPricingBasis({ durable: sampleOnly, receiptPayload: null });
  ok(part.reconstructability.verdict === 'PARTIAL' && part.pool.truncated === true && part.reconstructability.explanations.some((e) => /DISPLAY_SAMPLE.*first 5.*not reconstructed/.test(e)), 'six aggregated / five stored -> PARTIAL, truncation explained, missing record not reconstructed');
  const hb = buildPricingBasis({ durable: durableOf(hist), receiptPayload: receiptOf(hist, 6), receiptBody: 'b', receiptBindingState: 'BOUND', evidenceVersion: 'ev1' });
  ok(hb.reconstructability.verdict === 'NOT_RECONSTRUCTABLE' && hb.coherence.coherent === false, 'the historical OML row is NOT_RECONSTRUCTABLE (incoherent)');
  ok(hb.reconstructability.explanations.some((e) => /GENERATION_MISMATCH.*count 6.*count 16/.test(e)), 'the 6-vs-16 generation difference is explained');
  ok(hb.reconstructability.explanations.some((e) => /DISPLAY_SAMPLE.*first 5.*other 1/.test(e)), 'six aggregated / five displayed: the missing sixth is explained as unavailable');
  ok(hb.pool.records.length <= 5 && hb.pool.records.every((r) => OML_FIVE.some((o) => o[1] === r.title)) && !hb.pool.records.some((r) => Math.abs(r.price - 16.61) < 0.005), 'the sixth record is NOT fabricated (stored records are exactly the stored five; no $16.61 invented)');
  ok(hb.market.storedPrice === 15.1 && hb.reconstructability.verdict !== 'FULL', '$15.10 is preserved as the historical STORED price, not certified as a recommendation');
  ok(pricingBasisRefuses(hb) === true && pricingBasisRefuses(full) === false && pricingBasisRefuses(null) === false, 'pricingBasisRefuses: incoherent refuses, coherent and null do not');
}

console.log('\n== 8. oversized / hostile input is bounded and safe ==');
{
  const big = coherentBundle(Array.from({ length: 400 }, (_, i) => [10 + (i % 7), `Old Man Logan #25 1:25 Deodato Variant ${'x'.repeat(280)} ${i}`]));
  const b = buildPricingBasis({ durable: durableOf(big), receiptPayload: receiptOf(big), receiptBody: 'b', receiptBindingState: 'BOUND', evidenceVersion: 'ev1' });
  const bytes = Buffer.byteLength(JSON.stringify(b), 'utf8');
  ok(bytes <= MAX_BASIS_BYTES, `400 long records bounded to ${bytes} bytes (limit ${MAX_BASIS_BYTES})`);
  ok(b.reconstructability.verdict !== 'FULL' && b.pool.truncated === true, 'a bounded snapshot is never reported FULL and is flagged truncated');
  ok(b.pool.records.every((r) => r.title.length <= 160), 'titles are truncated to 160 characters');
  const hostile = buildPricingBasis({ durable: { rawComps: { prices: [null, 1, 'x', { title: {} }], count: 'many' }, comps: { recentSales: 'no' }, priceBands: 'x', variant: { evil: true } }, receiptPayload: { values: null } });
  ok(!!hostile.reconstructability.verdict, 'hostile / wrongly-typed fields do not throw');
}

console.log('\n== 9. approved price and engine prediction stay separate ==');
{
  const base = buildPricingBasis({ durable: durableOf(good), receiptPayload: receiptOf(good), receiptBody: 'b', receiptBindingState: 'BOUND', evidenceVersion: 'ev1' });
  const action = { id: 'act-1', action_value_amount: '25.00', action_value_currency: 'USD' };
  const dec = (valuation_event_id) => ({ id: 'dec-1', valuation_event_id });
  const q = completePricingBasis(base, { action, decision: dec('val-1'), valuations: [{ id: 'val-1', value_amount: '15.29', provenance: 'SERVER_DERIVED' }] });
  ok(q.approved.amount === '25.00' && q.enginePrediction.qualified === true && q.enginePrediction.valueAmount === '15.29' && q.predictionErrorScoring === 'MEASURABLE', 'a SERVER_DERIVED valuation is a qualified prediction ($15.29) and the operator-approved $25.00 is a separate field');
  ok(q.approved.meaning.includes('NOT an engine prediction'), 'the approved price is labelled an operator decision');
  for (const [label, valuations, d] of [['OPERATOR_OVERRIDE valuation', [{ id: 'val-1', value_amount: '15.28', provenance: 'OPERATOR_OVERRIDE' }], dec('val-1')], ['CLIENT_ASSERTED valuation', [{ id: 'val-1', value_amount: '0.00', provenance: 'CLIENT_ASSERTED' }], dec('val-1')], ['no valuation anchor', [], dec(null)]]) {
    const n = completePricingBasis(base, { action, decision: d, valuations });
    ok(n.enginePrediction.qualified === false && n.enginePrediction.valueAmount === null && n.predictionErrorScoring === 'NOT_MEASURABLE' && n.approved.amount === '25.00', `${label}: no qualified prediction is claimed, scoring NOT_MEASURABLE, approved price intact`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
