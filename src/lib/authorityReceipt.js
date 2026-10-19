// V1 P0 — SERVER-ISSUED AUTHORITY RECEIPT (closes the /api/collection source-authority vulnerability).
//
// GOVERNING LAW: a client-written field may never impersonate a server-derived fact. `decision`, `pricingSource`,
// `soldCompDiagnostics`, `contract` and the other execution-deciding fields are produced by api/enrich.js. They travel
// through the client (IndexedDB, then /api/collection) and so arrive at the server as client-WRITABLE data. Before this
// module api/list-ebay.js trusted that stored copy ("durable wins"), so any authenticated owner could persist forged
// values and reach READY.
//
// The fix: api/enrich.js SIGNS the exact values it derived (HMAC-SHA256, key derived from the server session secret with
// a purpose label, so a session token can never double as a receipt). The receipt is stateless (no KV dependency) and
// bound to the authenticated principal. /api/collection keeps the execution-deciding fields ONLY when they arrive with a
// receipt that verifies for this principal, and then OVERWRITES them from the signed payload; with no valid receipt the
// incoming values are discarded. api/list-ebay.js derives authority from a VERIFIED receipt alone.
//
// This module is pure (node:crypto only). It does not decide anything; it only signs and verifies.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const AUTHORITY_RECEIPT_VERSION = 1;

/** Fields api/enrich.js derives and that decide executable readiness. Client writes of these are inert without a receipt. */
export const EXECUTION_AUTHORITY_KEYS = Object.freeze([
  'decision', 'pricingSource', 'matchConfidence', 'variantApplicability', 'variantApplicabilitySoldFallback',
  'soldCompDiagnostics', 'identityConfident', 'refusedToPrice', 'manualReviewRequired', 'gradeExceedsMap',
  'claudeCheckBlocker', 'tier0Locked', 'contract', 'assemblyIntegrityFailed',
]);

/** Display-only market data the client may keep; never read for authority (the receipt carries the counts that matter). */
export const RECEIPT_COUNT_KEYS = Object.freeze(['rawCompsCount', 'soldCompCount']);

const secretKey = () => {
  const s = process.env.GRAILKEY_SESSION_SECRET;
  if (!s || s.length < 32) return null; // same 32-char floor the auth module enforces; fail closed below it
  return createHmac('sha256', s).update('grailkey/authority-receipt/v1').digest();
};

const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};

const normText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const wordSet = (s) => new Set(normText(s).split(' ').filter((w) => w.length > 1 && !['the', 'and', 'of', 'a', 'an'].includes(w)));

/** Identity binding: same issue and overlapping title words. Returns true when a receipt's identity matches the row's. */
export function identityMatchesReceipt(receiptIdentity, rowFacts) {
  if (!receiptIdentity || !rowFacts) return false;
  if (normText(receiptIdentity.issue) !== normText(rowFacts.issue)) return false;
  const a = wordSet(receiptIdentity.title), b = wordSet(rowFacts.title);
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size) >= 0.5;
}

/**
 * Build the signed receipt for one enrich response. Returns null when it cannot be issued (no principal, no secret).
 * `response` is the finalized enrich response (contract already attached).
 */
/**
 * PHYSICAL-ASSET BINDING. A receipt proves what the SERVER derived for one identity; it must also prove WHICH physical object that
 * derivation belongs to, or a receipt minted for asset A could be replayed onto asset B that shares the same catalogue identity.
 * `binding` is resolved server-side by api/enrich.js from the authenticated principal's own collection_item_link (ownership-checked),
 * never from a client claim: { collectionItemId, gkAssetId, evidenceVersion } -- any member null when it could not be established.
 */
export function computeEvidenceVersion(contentHashes) {
  const hs = (Array.isArray(contentHashes) ? contentHashes : []).filter((h) => typeof h === 'string' && h).slice().sort();
  if (hs.length === 0) return null;
  return createHash('sha256').update(hs.join('|')).digest('hex').slice(0, 32);
}

export function issueAuthorityReceipt({ principalId, response, binding = null, now = Date.now() } = {}) {
  const key = secretKey();
  if (!key || !principalId || !response || typeof response !== 'object') return null;
  const payload = {
    issuedAt: now,
    binding: {
      collectionItemId: binding?.collectionItemId ?? null,
      gkAssetId: binding?.gkAssetId ?? null,
      evidenceVersion: binding?.evidenceVersion ?? null,
    },
    identity: { title: response.title ?? null, issue: response.issue ?? null, year: response.year ?? null },
    values: {},
    rawCompsCount: Number.isFinite(response.rawComps?.count) ? response.rawComps.count : (Array.isArray(response.rawComps?.prices) ? response.rawComps.prices.length : 0),
    soldCompCount: Array.isArray(response.soldComps) ? response.soldComps.length : (Number.isFinite(response.soldComps) ? response.soldComps : 0),
  };
  for (const k of EXECUTION_AUTHORITY_KEYS) if (response[k] !== undefined) payload.values[k] = response[k];
  const body = stable(payload);
  const sig = createHmac('sha256', key).update(`${AUTHORITY_RECEIPT_VERSION}.${principalId}.${body}`).digest('base64url');
  return { v: AUTHORITY_RECEIPT_VERSION, principalId, body, sig };
}

/** @returns {{ok:true,payload:object}|{ok:false,reason:string}} Never throws. */
export function verifyAuthorityReceipt(receipt, principalId) {
  try {
    const key = secretKey();
    if (!key) return { ok: false, reason: 'no-secret' };
    if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'absent' };
    if (receipt.v !== AUTHORITY_RECEIPT_VERSION) return { ok: false, reason: 'version' };
    if (!principalId || receipt.principalId !== principalId) return { ok: false, reason: 'principal-mismatch' };
    if (typeof receipt.body !== 'string' || typeof receipt.sig !== 'string') return { ok: false, reason: 'malformed' };
    const expected = createHmac('sha256', key).update(`${AUTHORITY_RECEIPT_VERSION}.${principalId}.${receipt.body}`).digest();
    const given = Buffer.from(receipt.sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };
    const payload = JSON.parse(receipt.body);
    if (!payload || typeof payload !== 'object' || typeof payload.values !== 'object') return { ok: false, reason: 'malformed' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Write-path governance for ONE incoming attributes object (used by the collection repository).
 * Returns a NEW attributes object plus a provenance verdict; never mutates the input.
 *   * valid receipt  -> execution fields are OVERWRITTEN from the signed payload; receipt kept
 *   * anything else  -> execution fields AND the receipt slot are DISCARDED from the write (an existing row keeps its own)
 */
export function governIncomingAuthority(attributes, principalId, rowId = null) {
  const out = { ...(attributes || {}) };
  let verdict = verifyAuthorityReceipt(out.authorityReceipt, principalId);
  // Row binding: a receipt issued for a specific Collection row is inert on any OTHER row (cross-row / cross-asset replay).
  const boundRow = verdict.ok ? verdict.payload.binding?.collectionItemId : null;
  if (verdict.ok && boundRow && rowId && boundRow !== rowId) verdict = { ok: false, reason: 'row-mismatch' };
  // The provenance label is server-owned: never accepted from a client.
  delete out.authorityProvenance;
  if (verdict.ok) {
    for (const k of EXECUTION_AUTHORITY_KEYS) delete out[k];
    Object.assign(out, verdict.payload.values);
    out.authorityProvenance = { status: 'SERVER_RECEIPT', issuedAt: verdict.payload.issuedAt };
    return { attributes: out, verified: true, reason: null };
  }
  for (const k of EXECUTION_AUTHORITY_KEYS) delete out[k];
  delete out.authorityReceipt;
  return { attributes: out, verified: false, reason: verdict.reason };
}
