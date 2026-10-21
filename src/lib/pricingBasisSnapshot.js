// src/lib/pricingBasisSnapshot.js -- GATE B (2026-10-21): the `pricingBasis` object preserved INSIDE the existing append-only AUTHORIZED evidence JSONB
// (operator_authority_event.evidence). No schema, table, migration or receipt-format change: `evidence` is already a JSONB object column.
//
// TRUTHFULNESS RULES
//   * It is captured at authorization time from the SERVER-HELD durable row. Those pricing fields (records, aggregates, bands, trace) are ordinary client-writable
//     attributes and are NOT independently receipt-signed; `provenance.pricingFieldsSigned` is false and says so. Only the pool COUNT, pricingSource and the execution
//     keys are server-signed (receipt), and they are recorded as such, separately.
//   * Nothing is fabricated. A record that is not stored is never reconstructed; truncation, a display sample, and a generation difference are each DISCLOSED.
//   * The approved LIST price (an operator's decision) and the engine's prediction (a server-derived valuation, if one qualifies) are separate fields. When no qualified
//     prediction exists, predictionErrorScoring is NOT_MEASURABLE; it is never inferred from the approved price.
//   * `reconstructability` is FULL / PARTIAL / NOT_RECONSTRUCTABLE and states why.
//   * Bounded: records are capped, titles truncated, and the whole object is size-capped; an over-size object degrades to a minimal, honest stub (never throws, never silently drops
//     the verdict).
// Pure. No I/O.

import { assessPricingBundleCoherence } from './pricingBundleCoherence.js';
import { decisionTrustStanding, DECISION_TRUST } from './decisionTrust.js';
import { createHash } from 'node:crypto';

export const PRICING_BASIS_VERSION = 'pricing-basis-v1';
export const MAX_RECORDS = 30;
export const MAX_TITLE_CHARS = 160;
export const MAX_BASIS_BYTES = 16 * 1024;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const rec = (r) => (isObj(r) ? { title: str(r.title, MAX_TITLE_CHARS), price: num(r.price), url: str(r.url ?? r.itemWebUrl, 200), endedOrObserved: str(typeof r.date === 'string' ? r.date : null, 40) } : null);

/**
 * Build the pricing basis. `receiptPayload` is the VERIFIED receipt payload or null. Returns an object that is always safe to store (see bounding).
 */
export function buildPricingBasis({ durable = null, receiptPayload = null, receiptBody = null, receiptBindingState = 'NOT_CHECKED', evidenceVersion = null, now = Date.now() } = {}) {
  const d = isObj(durable) ? durable : {};
  const coherence = assessPricingBundleCoherence({ durable: d, receipt: receiptPayload });
  const rc = isObj(d.rawComps) ? d.rawComps : null;
  const comps = isObj(d.comps) ? d.comps : null;
  const bands = isObj(d.priceBands) ? d.priceBands : null;
  const trace = isObj(d.priceDerivationTrace) ? d.priceDerivationTrace : null;
  const rv = receiptPayload && isObj(receiptPayload.values) ? receiptPayload.values : {};
  const notes = [];

  const poolCount = rc ? num(rc.count) : null;
  const rows = rc && Array.isArray(rc.prices) ? rc.prices.map(rec).filter(Boolean) : [];
  const sample = comps && Array.isArray(comps.recentSales) ? comps.recentSales.map(rec).filter(Boolean) : [];
  const compsCount = comps ? num(comps.count) : null;

  if (compsCount !== null && poolCount !== null && compsCount !== poolCount) notes.push(`GENERATION_MISMATCH: comps (count ${compsCount}) and rawComps (count ${poolCount}) describe different passes; rawComps, priceBands and the derivation trace may belong to another generation than the aggregate in comps.`);
  if (compsCount !== null && sample.length > 0 && compsCount > sample.length) notes.push(`DISPLAY_SAMPLE: comps.count ${compsCount} aggregates the full eligible pool; only the first ${sample.length} records (recentSales, eBay best-match order) were stored. The other ${compsCount - sample.length} record(s) are unavailable and are not reconstructed.`);
  if (poolCount !== null && rows.length > 0 && poolCount > rows.length) notes.push(`POOL_RECORDS_INCOMPLETE: rawComps.count ${poolCount} but only ${rows.length} record(s) stored.`);
  if (!rc && !comps) notes.push('NO_POOL_STORED: neither rawComps nor comps is stored on the durable row.');

  // The records that most completely represent the pool the BANDS were built from. When the aggregate (`comps`) and the pool (`rawComps`) are DIFFERENT generations, the
  // aggregate's own stored records are kept as the primary list (they are what the stored price/contract was derived from) and the other generation is disclosed separately.
  const generationMismatch = compsCount !== null && poolCount !== null && compsCount !== poolCount;
  const preferRows = !generationMismatch && rows.length >= sample.length;
  const records = preferRows ? rows : sample;
  const recordsSource = preferRows && rows.length > 0 ? 'rawComps.prices' : (sample.length > 0 ? 'comps.recentSales' : 'none');
  const expected = recordsSource === 'rawComps.prices' ? poolCount : compsCount;
  const allRecords = expected !== null && records.length > 0 && records.length === expected;

  let verdict; const reasons = []; const missing = [];
  if (!coherence.coherent) { verdict = 'NOT_RECONSTRUCTABLE'; reasons.push('the stored pricing evidence is internally inconsistent'); }
  else if (records.length === 0) { verdict = 'NOT_RECONSTRUCTABLE'; reasons.push('no comparable records are stored'); missing.push('comparable records'); }
  else {
    if (!allRecords) { reasons.push(`records stored (${records.length}) do not cover the pool (${expected ?? 'unknown'})`); missing.push('complete pool records'); }
    if (!trace || money(trace.finalPrice) === null) { reasons.push('no derivation trace'); missing.push('derivation trace'); }
    if (!bands) { reasons.push('no price bands'); missing.push('price bands'); }
    if (!receiptPayload) { reasons.push('no verified receipt'); missing.push('receipt'); }
    else if (receiptBindingState !== 'BOUND' && receiptBindingState !== 'NOT_CHECKED') { reasons.push(`receipt binding is ${receiptBindingState}`); missing.push('bound receipt'); }
    verdict = reasons.length === 0 ? 'FULL' : 'PARTIAL';
    if (verdict === 'FULL') reasons.push('records, aggregates, bands, trace and a bound server receipt are all present and agree (pricing fields remain client-writable, not signed)');
  }

  const basis = {
    schemaVersion: PRICING_BASIS_VERSION,
    capturedAt: new Date(typeof now === 'function' ? now() : now).toISOString(),
    provenance: {
      source: 'SERVER_HELD_CATALOGUE',
      pricingFieldsSigned: false,
      note: 'Captured from the server-held durable Collection row at authorization time. The comparable records, aggregates, bands and trace are client-writable attributes and are NOT independently receipt-signed. Only the pool count, pricingSource and execution keys below under `receipt` are server-signed.',
    },
    identity: {
      title: str(d.title, 200), issue: str(d.issue, 20), year: str(d.year, 8), publisher: str(d.publisher, 80), variant: str(d.variant, 80),
      identityAuthority: isObj(d.identityAuthority) ? Object.fromEntries(Object.entries(d.identityAuthority).slice(0, 12).map(([k, v]) => [str(k, 24), str(v, 32)])) : null,
    },
    market: {
      pricingSource: str(d.pricingSource, 64),
      storedPrice: money(d.price),
      verifiedSoldCount: isObj(d.soldCompDiagnostics) ? num(d.soldCompDiagnostics.verifiedCount) : null,
      rawSoldCount: isObj(d.soldCompDiagnostics) ? num(d.soldCompDiagnostics.rawCount) : null,
      variantApplicability: str(receiptPayload ? rv.variantApplicability : d.variantApplicability, 24),
    },
    pool: {
      records,
      recordsSource,
      recordCount: records.length,
      poolCount,
      aggregate: comps ? { count: compsCount, average: num(comps.averageNum) ?? money(comps.average), lowest: num(comps.lowestNum) ?? money(comps.lowest), highest: num(comps.highestNum) ?? money(comps.highest), query: str(comps.query, 160), source: str(comps.source, 40) } : null,
      populations: {
        'rawComps.prices': 'eligible active asks that survived the title/variant/era/evidence filters in the pass that produced rawComps; the pool the price bands read',
        'comps.*': 'count/average/lowest/highest over the full eligible pool of the pass that produced `comps`',
        'comps.recentSales': 'a DISPLAY SAMPLE: the first 5 of that pool in eBay best-match order. Not a different population; the remainder is simply not stored',
      },
      truncated: expected !== null ? expected > records.length : false,
      otherGeneration: generationMismatch && rows.length > 0
        ? { source: 'rawComps.prices', count: poolCount, recordCount: rows.length, records: rows.slice(0, 5), note: 'a DIFFERENT pass than the aggregate above; disclosed for audit only, never the basis of the stored price' }
        : null,
    },
    bands: bands ? { tier: num(bands.tier), source: str(bands.source, 48), quick: str(String(bands.quick ?? ''), 16), market: str(String(bands.market ?? ''), 16), stretch: str(String(bands.stretch ?? ''), 16), count: num(bands.count), variantEvidence: isObj(bands.variantEvidence) ? { required: bands.variantEvidence.required === true, ratio: str(bands.variantEvidence.ratio, 12), applicable: num(bands.variantEvidence.applicable), nonVariant: num(bands.variantEvidence.nonVariant) } : null } : null,
    derivation: trace ? { finalPrice: money(trace.finalPrice), source: str(trace.source ?? trace.pricingSource, 48) } : null,
    receipt: receiptPayload ? {
      verified: true,
      issuedAt: num(receiptPayload.issuedAt),
      bodySha256: typeof receiptBody === 'string' ? createHash('sha256').update(receiptBody).digest('hex') : null,
      signedPoolCount: num(receiptPayload.rawCompsCount),
      signedPricingSource: str(rv.pricingSource, 64),
      bindingState: str(receiptBindingState, 32),
      boundEvidenceVersion: str(receiptPayload.binding && receiptPayload.binding.evidenceVersion, 40),
      boundGkAssetId: str(receiptPayload.binding && receiptPayload.binding.gkAssetId, 40),
    } : { verified: false },
    photoEvidence: { currentEvidenceVersion: str(evidenceVersion, 40) },
    coherence: {
      coherent: coherence.coherent, protection: coherence.protection, limitation: coherence.limitation,
      violations: coherence.violations.slice(0, 12),
      checks: coherence.checks.map((c) => ({ id: c.id, status: c.status })),
    },
    reconstructability: { verdict, reasons, missing, explanations: notes },
    // filled by the service (it holds the LIST action, decision and valuations): approved price and engine prediction are kept separate
    approved: null,
    enginePrediction: null,
    predictionErrorScoring: 'NOT_MEASURABLE',
  };
  return boundPricingBasis(basis);
}

/** Keep the object under MAX_BASIS_BYTES: shrink records, then fall back to a minimal honest stub. Never throws. */
export function boundPricingBasis(basis) {
  try {
    let b = basis;
    const size = (x) => Buffer.byteLength(JSON.stringify(x), 'utf8');
    if (size(b) <= MAX_BASIS_BYTES) return b;
    for (const keep of [MAX_RECORDS, 12, 5, 0]) {
      b = { ...basis, pool: { ...basis.pool, records: basis.pool.records.slice(0, keep), truncated: true }, reconstructability: { ...basis.reconstructability, verdict: basis.reconstructability.verdict === 'FULL' ? 'PARTIAL' : basis.reconstructability.verdict, explanations: [...basis.reconstructability.explanations, `SIZE_BOUND: records cut to ${keep} to fit the ${MAX_BASIS_BYTES}-byte limit`] } };
      if (size(b) <= MAX_BASIS_BYTES) return b;
    }
    throw new Error('still oversized');
  } catch {
    return {
      schemaVersion: PRICING_BASIS_VERSION, capturedAt: basis && basis.capturedAt ? basis.capturedAt : null,
      provenance: { source: 'SERVER_HELD_CATALOGUE', pricingFieldsSigned: false, note: 'stub: the full basis exceeded the size bound' },
      coherence: basis && basis.coherence ? { coherent: basis.coherence.coherent, protection: 'PARTIAL', violations: (basis.coherence.violations || []).slice(0, 12) } : { coherent: false, protection: 'PARTIAL', violations: [] },
      reconstructability: { verdict: 'NOT_RECONSTRUCTABLE', reasons: ['PRICING_BASIS_OVERSIZED'], missing: ['everything'], explanations: [] },
      approved: null, enginePrediction: null, predictionErrorScoring: 'NOT_MEASURABLE',
    };
  }
}

/**
 * Fill the two service-owned parts. The approved price comes from the LIST operator action (an operator decision). The engine prediction is reported ONLY when the
 * decision is anchored to a SERVER_DERIVED valuation; otherwise it is explicitly absent and prediction-error scoring is NOT_MEASURABLE. The two are never merged.
 */
export function completePricingBasis(basis, { action, decision, valuations, approvedCurrency }) {
  const trust = decisionTrustStanding(decision, valuations);
  const v = (Array.isArray(valuations) ? valuations : []).find((x) => x && decision && x.id === decision.valuation_event_id) || null;
  const qualified = trust === DECISION_TRUST.SERVER_DERIVED && v !== null;
  return boundPricingBasis({
    ...basis,
    approved: {
      amount: action && action.action_value_amount != null ? String(action.action_value_amount) : null,
      currency: approvedCurrency || (action && action.action_value_currency) || null,
      source: 'LIST_OPERATOR_ACTION',
      operatorActionEventId: action ? action.id || null : null,
      meaning: 'the operator-approved listing price; an operator decision, NOT an engine prediction',
    },
    enginePrediction: qualified
      ? { qualified: true, trust, valuationEventId: v.id, valueAmount: String(v.value_amount), provenance: v.provenance }
      : { qualified: false, trust, valuationEventId: v ? v.id : null, valueAmount: null, provenance: v ? v.provenance : null, reason: 'no SERVER_DERIVED valuation anchors the decision; the approved price is an operator decision and no engine prediction is claimed' },
    predictionErrorScoring: qualified ? 'MEASURABLE' : 'NOT_MEASURABLE',
  });
}

/** True when the object is a pricingBasis whose coherence verdict refuses authorization. */
export const pricingBasisRefuses = (b) => isObj(b) && isObj(b.coherence) && b.coherence.coherent === false;
