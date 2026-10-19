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
 * @param {object} requestItem  the (untrusted) request item
 * @param {object|null} durable the owned asset's canonical catalogue attributes (server-read), or null
 * @returns {{ evidence: object, priorLockCodes: string[], sources: object }}
 */
export function resolveListingAuthorityEvidence(requestItem, durable) {
  const req = requestItem || {};
  const d = isObj(durable) ? durable : {};
  const sources = {};
  const pick = (name, durableValue, requestValue) => {
    if (durableValue !== undefined && durableValue !== null) { sources[name] = 'durable'; return durableValue; }
    if (requestValue !== undefined && requestValue !== null) { sources[name] = 'request'; return requestValue; }
    sources[name] = 'absent';
    return null;
  };

  const decision = pick('decision', d.decision, req.decision);
  const pricingSource = pick('pricingSource', d.pricingSource, req.pricingSource);
  const matchConfidence = pick('matchConfidence', d.matchConfidence, req.matchConfidence);
  const rawComps = pick('rawComps', d.rawComps, req.rawComps);
  const variantApplicability = pick('variantApplicability', d.variantApplicability, req.variantApplicability);

  const durableDx = pickDiagnostics(d.soldCompDiagnostics);
  const requestDx = pickDiagnostics(req.soldCompDiagnostics);
  let soldCompDiagnostics;
  if (durableDx) { sources.soldCompDiagnostics = 'durable'; soldCompDiagnostics = durableDx; }
  else if (requestDx) { sources.soldCompDiagnostics = 'request'; soldCompDiagnostics = requestDx; }
  else {
    // FAIL CLOSED: no diagnostics anywhere => the NO_SOLD_EVIDENCE floor applies.
    sources.soldCompDiagnostics = 'absent-failed-closed';
    soldCompDiagnostics = { rawCount: 0, verifiedCount: 0, newestDaysAgo: null };
  }

  const durableSold = Array.isArray(d.soldComps) ? d.soldComps.length : null;
  const soldCompCount = durableSold !== null ? durableSold : (typeof req.soldComps === 'number' ? req.soldComps : 0);

  // Restrictive flags: either side asserting the restriction is enough (a client may add a restriction,
  // never remove one the durable record carries).
  const flag = (k) => d[k] === true || req[k] === true;

  const evidence = {
    decision,
    pricingSource,
    matchConfidence,
    rawComps,
    variantApplicability,
    variantApplicabilitySoldFallback: flag('variantApplicabilitySoldFallback'),
    soldCompCount,
    soldCompDiagnostics,
    identityConfident: d.identityConfident !== undefined && d.identityConfident !== null ? d.identityConfident : req.identityConfident,
    refusedToPrice: flag('refusedToPrice'),
    manualReviewRequired: flag('manualReviewRequired'),
    gradeExceedsMap: flag('gradeExceedsMap'),
    claudeCheckBlocker: d.claudeCheckBlocker || req.claudeCheckBlocker || null,
    tier0Locked: flag('tier0Locked'),
  };

  const reqPrior = Array.isArray(req.priorLockCodes) ? req.priorLockCodes : [];
  const priorLockCodes = [...new Set([...reqPrior, ...lockCodes(d.contract)])];

  return { evidence, priorLockCodes, sources };
}
