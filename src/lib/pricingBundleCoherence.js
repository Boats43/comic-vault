// src/lib/pricingBundleCoherence.js -- GATE B (2026-10-21): LISTING-TIME DETECTION of an internally inconsistent pricing bundle.
//
// WHAT IT DETECTS (demonstrated inconsistencies only; pure, no I/O, no pricing math):
//   REFUSED_OR_NO_PRICE   a refused state, or a band without a positive price, can never back a listing
//   RECEIPT_COUNT         the durable pool size differs from the pool size the SERVER signed in the receipt (the recorded 6-vs-16 mixed generation)
//   RECEIPT_SOURCE        the durable pricingSource differs from the signed one
//   POOL_GENERATION       `comps` (the aggregate) and `rawComps` (the pool) describe different pools
//   BAND_POOL             the bands claim more listings than the pool holds
//   PRICE_TRACE / PRICE_BAND   the stored price disagrees with its own derivation trace / band market
//   VARIANT_APPLICABILITY the confirmed ratio variant's applicability verdict is not CONFIRMED (receipt value wins)
//   VARIANT_EVIDENCE      a confirmed ratio variant (1:25 ...) whose bands carry no proof, or fewer than 3 listings naming it
//   WRONG_VARIANT_ROWS    listings in the stored pool that do not name the confirmed ratio
//   IDENTITY_*            the receipt's signed year/issue differ from the durable identity
//   AGGREGATE_RECORDS     the stored records do not reproduce their own count / average / lowest / highest
//
// WHAT IT DOES NOT AND CANNOT DETECT -- THIS IS A PARTIAL CONTROL, never "fully protected":
//   Only the receipt's pool COUNT and pricingSource are server-signed facts about the pricing pool. The listings themselves, their prices, the average and
//   the bands are ordinary client-writable attributes. A bundle whose records were REPLACED by different records that have the SAME count, the SAME source label,
//   and internally consistent aggregates, titles and bands is INDISTINGUISHABLE from the genuine one by these checks. Closing that needs the signed pricing digest
//   of the (deferred, Gate D) pricing-generation protocol. `protection` is therefore always 'PARTIAL' and `limitation` always says so.
//
// A check whose inputs are absent is NOT_EVALUATED (never silently PASS); a missing input is not an inconsistency, so it does not refuse by itself, and it lowers the
// reconstructability verdict recorded with the approval (see pricingBasisSnapshot.js).

import { getRatioVariantN, titleShowsRatioVariant } from './priceBands.js';

export const COHERENCE_LIMITATION =
  'PARTIAL CONTROL: only the pool COUNT and pricingSource are server-signed (receipt). A same-count, same-source substitution with consistent aggregates, titles and bands is NOT detectable here; '
  + 'the pricing fields themselves are not receipt-signed (needs the Gate D pricing-generation protocol).';

const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameCents = (a, b) => a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100);
const normYear = (v) => { const m = String(v ?? '').match(/\d{4}/); return m ? m[0] : null; };
const normIssue = (v) => String(v ?? '').trim().replace(/^#\s*/, '').replace(/^0+(?=\d)/, '').toLowerCase();

const BAND_DERIVED_SOURCES = /^(active_ask_derived|verified_sold|verified_active|tier\d|sold_|recency)/;

/**
 * @param {{durable: object|null, receipt: object|null}} input durable = the server-read canonical Collection attributes; receipt = the VERIFIED receipt payload (or null)
 * @returns {{coherent: boolean, violations: {id:string, detail:string}[], checks: {id:string, status:'PASS'|'FAIL'|'NOT_EVALUATED', detail:string}[], evaluated:number, protection:'PARTIAL', limitation:string}}
 */
export function assessPricingBundleCoherence({ durable = null, receipt = null } = {}) {
  const d = isObj(durable) ? durable : {};
  const rv = receipt && isObj(receipt.values) ? receipt.values : {};
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  const rc = isObj(d.rawComps) ? d.rawComps : null;
  const comps = isObj(d.comps) ? d.comps : null;
  const bands = isObj(d.priceBands) ? d.priceBands : null;
  const trace = isObj(d.priceDerivationTrace) ? d.priceDerivationTrace : null;
  const price = money(d.price);
  const poolCount = rc ? num(rc.count) : null;
  const rows = rc && Array.isArray(rc.prices) ? rc.prices : null;

  // 1. refused / no-price states
  {
    const refused = d.refusedToPrice === true || rv.refusedToPrice === true
      || (isObj(d.contract) && d.contract.state === 'REFUSED') || (isObj(rv.contract) && rv.contract.state === 'REFUSED')
      || d.pricingBundleStatus === 'REFUSED_OR_OMITTED' || /^refused/.test(String(d.pricingSource || rv.pricingSource || ''));
    if (refused) add('REFUSED_OR_NO_PRICE', 'FAIL', 'the stored/receipted state is a refusal; a refusal cannot back a listing');
    else if (bands && (price === null || price <= 0)) add('REFUSED_OR_NO_PRICE', 'FAIL', 'price bands are present but the stored price is null or not positive');
    else if (!bands && price === null) add('REFUSED_OR_NO_PRICE', 'NOT_EVALUATED', 'no pricing bundle is stored');
    else add('REFUSED_OR_NO_PRICE', 'PASS', 'not a refusal and a positive price accompanies the bundle');
  }

  // 2/3. receipt facts vs durable
  if (receipt && poolCount !== null && num(receipt.rawCompsCount) !== null) {
    if (poolCount !== receipt.rawCompsCount) add('RECEIPT_COUNT', 'FAIL', `durable rawComps.count ${poolCount} differs from the server-signed pool size ${receipt.rawCompsCount} (mixed generations)`);
    else add('RECEIPT_COUNT', 'PASS', `durable pool size ${poolCount} equals the signed pool size`);
  } else add('RECEIPT_COUNT', 'NOT_EVALUATED', receipt ? 'no durable rawComps.count' : 'no verified receipt');
  if (receipt && rv.pricingSource != null && d.pricingSource != null) {
    if (String(rv.pricingSource) !== String(d.pricingSource)) add('RECEIPT_SOURCE', 'FAIL', `durable pricingSource "${d.pricingSource}" differs from the signed "${rv.pricingSource}"`);
    else add('RECEIPT_SOURCE', 'PASS', 'durable pricingSource equals the signed one');
  } else add('RECEIPT_SOURCE', 'NOT_EVALUATED', 'receipt or durable pricingSource absent');

  // 4. the aggregate and the pool are one population
  {
    const cc = comps ? num(comps.count) : null;
    if (cc !== null && poolCount !== null) {
      if (cc !== poolCount) add('POOL_GENERATION', 'FAIL', `comps.count ${cc} and rawComps.count ${poolCount} describe different pools`);
      else add('POOL_GENERATION', 'PASS', `comps and rawComps agree on ${cc}`);
    } else add('POOL_GENERATION', 'NOT_EVALUATED', 'comps or rawComps count absent');
  }

  // 5. bands cannot exceed the pool
  if (bands && num(bands.count) !== null && poolCount !== null) {
    if (bands.count > poolCount) add('BAND_POOL', 'FAIL', `bands claim ${bands.count} listings; the stored pool holds ${poolCount}`);
    else add('BAND_POOL', 'PASS', `bands use ${bands.count} of ${poolCount} pool listings`);
  } else add('BAND_POOL', 'NOT_EVALUATED', 'bands or pool count absent');

  // 6. price vs its own derivation
  {
    const fin = trace ? money(trace.finalPrice) : null;
    if (price !== null && fin !== null) add('PRICE_TRACE', sameCents(price, fin) ? 'PASS' : 'FAIL', sameCents(price, fin) ? 'price equals the derivation trace final price' : `price ${price} differs from derivation trace final ${fin}`);
    else add('PRICE_TRACE', 'NOT_EVALUATED', 'price or trace absent');
    const mk = bands ? money(bands.market) : null;
    if (price !== null && mk !== null && BAND_DERIVED_SOURCES.test(String(d.pricingSource || ''))) add('PRICE_BAND', sameCents(price, mk) ? 'PASS' : 'FAIL', sameCents(price, mk) ? 'price equals the band market' : `price ${price} differs from band market ${mk}`);
    else add('PRICE_BAND', 'NOT_EVALUATED', 'price, band market, or a band-derived source absent');
  }

  // 7. confirmed ratio variant must be proven by the bands and by every listed row
  {
    const n = getRatioVariantN(d.variant);
    if (!n) add('VARIANT_EVIDENCE', 'NOT_EVALUATED', 'no confirmed ratio variant');
    else if (!bands) add('VARIANT_EVIDENCE', 'NOT_EVALUATED', 'no bands to carry variant evidence');
    else {
      const ve = isObj(bands.variantEvidence) ? bands.variantEvidence : null;
      if (!ve || ve.required !== true) add('VARIANT_EVIDENCE', 'FAIL', `the confirmed 1:${n} variant has bands with no variant evidence (priced without proof the listings are that variant)`);
      else if (String(ve.ratio) !== `1:${n}`) add('VARIANT_EVIDENCE', 'FAIL', `band variant evidence is for ${ve.ratio}, the confirmed variant is 1:${n}`);
      else if (!(num(ve.applicable) >= 3)) add('VARIANT_EVIDENCE', 'FAIL', `only ${ve.applicable} listing(s) name 1:${n}; a band needs at least 3`);
      else add('VARIANT_EVIDENCE', 'PASS', `${ve.applicable} listings name 1:${n}`);
    }
    {
      // the variant-applicability verdict: the receipt's signed value wins; the stored value is used only when there is no verified receipt
      const va = receipt ? (rv.variantApplicability ?? null) : (d.variantApplicability ?? null);
      if (!n) add('VARIANT_APPLICABILITY', 'NOT_EVALUATED', 'no confirmed ratio variant');
      else if (va === null || va === undefined) add('VARIANT_APPLICABILITY', 'NOT_EVALUATED', 'no variantApplicability verdict stored or signed');
      else if (va !== 'CONFIRMED') add('VARIANT_APPLICABILITY', 'FAIL', `the confirmed 1:${n} variant has applicability "${va}", not CONFIRMED (the pool was not shown to be that variant)`);
      else add('VARIANT_APPLICABILITY', 'PASS', 'the pricing pass confirmed the variant applies to the pool');
    }
    const sample = [];
    if (rows) sample.push(...rows);
    if (comps && Array.isArray(comps.recentSales)) sample.push(...comps.recentSales);
    if (!n) add('WRONG_VARIANT_ROWS', 'NOT_EVALUATED', 'no confirmed ratio variant');
    else if (sample.length === 0) add('WRONG_VARIANT_ROWS', 'NOT_EVALUATED', 'no stored listing records');
    else {
      const bad = sample.filter((r) => !(isObj(r) && r.title && titleShowsRatioVariant(String(r.title), n)));
      if (bad.length) add('WRONG_VARIANT_ROWS', 'FAIL', `${bad.length} of ${sample.length} stored listing record(s) do not name 1:${n}`);
      else add('WRONG_VARIANT_ROWS', 'PASS', `all ${sample.length} stored records name 1:${n}`);
    }
  }

  // 8. identity facts the receipt signed
  if (receipt && isObj(receipt.identity)) {
    const ry = normYear(receipt.identity.year), dy = normYear(d.year);
    if (ry && dy) add('IDENTITY_YEAR', ry === dy ? 'PASS' : 'FAIL', ry === dy ? 'signed year equals durable year' : `signed year ${ry} differs from durable year ${dy}`);
    else add('IDENTITY_YEAR', 'NOT_EVALUATED', 'year absent on the receipt or the row');
    const ri = normIssue(receipt.identity.issue), di = normIssue(d.issue);
    if (ri && di) add('IDENTITY_ISSUE', ri === di ? 'PASS' : 'FAIL', ri === di ? 'signed issue equals durable issue' : `signed issue ${ri} differs from durable issue ${di}`);
    else add('IDENTITY_ISSUE', 'NOT_EVALUATED', 'issue absent on the receipt or the row');
  } else { add('IDENTITY_YEAR', 'NOT_EVALUATED', 'no verified receipt'); add('IDENTITY_ISSUE', 'NOT_EVALUATED', 'no verified receipt'); }

  // 9. the stored records must reproduce their own aggregates
  if (rc && rows && rows.length > 0 && rows.every((r) => isObj(r) && num(r.price) !== null)) {
    const ps = rows.map((r) => r.price);
    const probs = [];
    if (poolCount !== null && poolCount !== rows.length) probs.push(`count ${poolCount} vs ${rows.length} records`);
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
    if (num(rc.average) !== null && Math.abs(mean - rc.average) > 0.01) probs.push(`average ${rc.average} vs recomputed ${mean.toFixed(4)}`);
    if (num(rc.lowest) !== null && Math.abs(Math.min(...ps) - rc.lowest) > 0.01) probs.push(`lowest ${rc.lowest} vs ${Math.min(...ps)}`);
    if (num(rc.highest) !== null && Math.abs(Math.max(...ps) - rc.highest) > 0.01) probs.push(`highest ${rc.highest} vs ${Math.max(...ps)}`);
    add('AGGREGATE_RECORDS', probs.length ? 'FAIL' : 'PASS', probs.length ? probs.join('; ') : 'the stored records reproduce their count, average, lowest and highest');
  } else add('AGGREGATE_RECORDS', 'NOT_EVALUATED', 'no stored pool records with prices');

  const violations = checks.filter((c) => c.status === 'FAIL').map(({ id, detail }) => ({ id, detail }));
  return {
    coherent: violations.length === 0,
    violations,
    checks,
    evaluated: checks.filter((c) => c.status !== 'NOT_EVALUATED').length,
    protection: 'PARTIAL',
    limitation: COHERENCE_LIMITATION,
  };
}
