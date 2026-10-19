// GK-240 / V1 certification — server-governed authority evidence for the LIST path.
//
// api/list-ebay.js re-derives transaction authority (deriveLocks / deriveActionAuthority). Before this
// module it fed those functions whatever evidence the REQUEST carried, so a caller that forged `decision`
// and simply omitted `soldCompDiagnostics` reached READY (reproduced against the real functions on the
// Street Fighter #1 row, 2026-10-18). Two rules close that:
//
//  1. DURABLE WINS. When the owned asset's canonical catalogue row (read server-side, principal-scoped)
//     carries a piece of authority evidence, that value is used and the request's value is ignored. The
//     request can only supply evidence the durable row lacks.
//  2. MISSING FAILS CLOSED. A priced source that names a sold/current tier but has NO sold-evidence
//     diagnostics anywhere is treated as "no sold evidence" (the NO_SOLD_EVIDENCE floor), never as
//     "nothing to check". Absence of a check is not verification.
//
// Residual, disclosed: the canonical row's attributes are written by the owning principal's own client
// sync (Collection write-authority hardening is a separately banked item), so this removes the
// per-request forgery path and the omit-to-skip path; it does not make Collection attributes
// server-computed.

import { verifyAuthorityReceipt, identityMatchesReceipt } from './authorityReceipt.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const scalarCount = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function pickDiagnostics(src) {
  if (!isObj(src)) return null;
  return {
    rawCount: scalarCount(src.rawCount),
    verifiedCount: scalarCount(src.verifiedCount),
    newestDaysAgo: scalarCount(src.newestDaysAgo),
  };
}

const lockCodes = (contract) =>
  Array.isArray(contract?.locks) ? contract.locks.map((l) => l && l.code).filter(Boolean) : [];

/**
 * V1 P0 SOURCE AUTHORITY (supersedes the "durable wins" rule above for the execution-deciding fields):
 * the stored Collection row is CLIENT-WRITABLE, so its loose `decision` / `soldCompDiagnostics` / `pricingSource` /
 * `contract` are NOT evidence. Evidence comes from the row's `authorityReceipt` -- a value api/enrich.js signed -- and
 * only when it verifies for THIS principal and its identity matches the row's. With no verifying receipt the result is
 * the fail-closed NO_SOLD_EVIDENCE floor (never READY). The request can only ADD restrictions.
 *
 * @param {object} requestItem  the (untrusted) request item
 * @param {object|null} durable the owned asset's canonical catalogue attributes (server-read), or null
 * @param {{principalId?:string}} opts the authenticated principal the receipt must be bound to
 * @returns {{ evidence: object, priorLockCodes: string[], sources: object }}
 */
export function resolveListingAuthorityEvidence(requestItem, durable, opts = {}) {
  const req = requestItem || {};
  const d = isObj(durable) ? durable : {};
  const sources = {};
  const verdict = verifyAuthorityReceipt(d.authorityReceipt, opts.principalId);
  const bound = verdict.ok && identityMatchesReceipt(verdict.payload.identity, { title: d.title, issue: d.issue });
  const receipt = bound ? verdict.payload : null;
  sources.receipt = receipt ? 'VERIFIED' : (verdict.ok ? 'IDENTITY_MISMATCH' : `UNVERIFIED:${verdict.reason}`);
  const rv = receipt ? receipt.values : {};
  const src = (name, value) => { sources[name] = receipt ? 'server-receipt' : 'absent-failed-closed'; return value; };

  const flag = (k) => (receipt && rv[k] === true) || req[k] === true; // a client may add a restriction, never remove one

  let soldCompDiagnostics;
  if (receipt && rv.soldCompDiagnostics) { sources.soldCompDiagnostics = 'server-receipt'; soldCompDiagnostics = pickDiagnostics(rv.soldCompDiagnostics); }
  else { sources.soldCompDiagnostics = 'absent-failed-closed'; soldCompDiagnostics = { rawCount: 0, verifiedCount: 0, newestDaysAgo: null }; }

  const evidence = {
    decision: src('decision', receipt ? (rv.decision ?? null) : null),
    pricingSource: src('pricingSource', receipt ? (rv.pricingSource ?? null) : null),
    matchConfidence: src('matchConfidence', receipt ? (rv.matchConfidence ?? null) : null),
    rawComps: src('rawComps', receipt ? { count: receipt.rawCompsCount ?? 0 } : null),
    variantApplicability: receipt ? (rv.variantApplicability ?? null) : null,
    variantApplicabilitySoldFallback: flag('variantApplicabilitySoldFallback'),
    soldCompCount: receipt ? (receipt.soldCompCount ?? 0) : 0,
    soldCompDiagnostics,
    identityConfident: receipt ? rv.identityConfident : undefined, // no receipt => no verified market evidence (REVIEW / NO_MARKET_EVIDENCE), not a fabricated identity verdict
    refusedToPrice: flag('refusedToPrice'),
    manualReviewRequired: flag('manualReviewRequired'),
    gradeExceedsMap: flag('gradeExceedsMap'),
    claudeCheckBlocker: (receipt && rv.claudeCheckBlocker) || req.claudeCheckBlocker || null,
    tier0Locked: flag('tier0Locked'),
  };

  const reqPrior = Array.isArray(req.priorLockCodes) ? req.priorLockCodes : [];
  const receiptLocks = receipt ? lockCodes(rv.contract) : [];
  // With no verifying receipt the stored (client-writable) contract is untrusted, and so is its ABSENCE of locks;
  // the fail-closed evidence above already prevents READY.
  const priorLockCodes = [...new Set([...reqPrior, ...receiptLocks])];
  return { evidence, priorLockCodes, sources };
}
