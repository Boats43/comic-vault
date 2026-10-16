// src/lib/operatorIdentityAuthority.js — operator-confirmed title authority (P0, 2026-10-16, Old Man Logan #25).
//
// WHY: a PriceCharting anchor's product name (api/enrich.js, q141-a "canonical projection") replaced an
// operator-confirmed title ("Old Man Logan  1:25" -> "Wolverine: Old Man Logan Giant-Size"), the client merged
// `enrich.title`, and every later refresh priced the WRONG book. An OPERATOR_CONFIRMED title is the governing
// title: external enrichment may price it, never rename it.
//
// Pure functions, no I/O. The authority comes from (a) a VALIDATED manual correction in THIS request
// (prepareManualCorrectionRequest accepted the 'title' field) or (b) the owned row's DURABLE
// identityAuthority.title === 'OPERATOR_CONFIRMED' (read server-side by api/enrich.js; never a client claim).

export const OPERATOR_CONFIRMED = 'OPERATOR_CONFIRMED';

const nonEmptyString = (v) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * @param {{ manualRequest?: object|null, durableAttributes?: object|null }} args
 * @returns {{ locked: boolean, title: string|null, source: 'manual-correction'|'durable-operator-confirmed'|null }}
 */
export function resolveOperatorTitleLock({ manualRequest = null, durableAttributes = null } = {}) {
  // A validated manual correction of the title in THIS request is the operator's new, deliberate value.
  if (manualRequest && manualRequest.valid === true) {
    const accepted = manualRequest.validation?.acceptedFields;
    const wt = nonEmptyString(manualRequest.workingIdentity?.title);
    if (Array.isArray(accepted) && accepted.includes('title') && wt) {
      return { locked: true, title: wt, source: 'manual-correction' };
    }
  }
  // Otherwise the durable, server-read authority governs.
  const dt = nonEmptyString(durableAttributes?.title);
  if (dt && durableAttributes?.identityAuthority?.title === OPERATOR_CONFIRMED) {
    return { locked: true, title: dt, source: 'durable-operator-confirmed' };
  }
  return { locked: false, title: null, source: null };
}

// Comparable form of a title: lower-case, variant ratio tokens ("1:25") and punctuation removed, "the" dropped.
export function normalizeTitleTokens(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/\b\d+\s*:\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'the');
}

/**
 * Does a PriceCharting anchor describe a DIFFERENT product than the operator-confirmed identity?
 * Conflict when the anchor names an issue number that differs from the confirmed issue, or when its canonical
 * title is not the same title as the operator's (ignoring case, punctuation, "the", and variant ratio tokens).
 */
export function anchorConflictsWithOperatorTitle({ anchorProductName, anchorCanonicalTitle, operatorTitle, confirmedIssue } = {}) {
  const issueMatch = String(anchorProductName ?? '').match(/#\s*(\d+)\s*(?:\(|$)/);
  const wantIssue = confirmedIssue == null ? null : String(confirmedIssue).replace(/[^0-9]/g, '');
  if (issueMatch && wantIssue && String(Number(issueMatch[1])) !== String(Number(wantIssue))) {
    return { conflict: true, reason: `anchor issue #${issueMatch[1]} != confirmed issue #${wantIssue}` };
  }
  const a = normalizeTitleTokens(anchorCanonicalTitle || anchorProductName);
  const b = normalizeTitleTokens(operatorTitle);
  const same = a.length === b.length && a.every((t, i) => t === b[i]);
  if (!same) return { conflict: true, reason: `anchor title "${anchorCanonicalTitle || anchorProductName}" != operator title "${operatorTitle}"` };
  return { conflict: false, reason: null };
}

/**
 * Client merge boundary. An OPERATOR_CONFIRMED saved title is never replaced by an enrichment response's title.
 * Deliberate operator corrections do NOT go through this (submitManualCorrection builds its own item).
 */
export function governingTitleForMerge(item, enrichTitle) {
  if (item && item.identityAuthority?.title === OPERATOR_CONFIRMED && nonEmptyString(item.title)) return item.title;
  return enrichTitle || item?.title;
}
