// src/lib/operatorAuthority.js -- GK-284. PURE helpers (no I/O) for durable OPERATOR_MANUAL authority and
// the marketplace attempt ledger (db/data0/0040_operator_manual_authority.sql).
//
// Three separate facts are kept separate here, always:
//   * the ENGINE's recommendation (decision_event) -- never rewritten by an operator approval
//   * the HUMAN's approval (the Q41 acknowledgment + the exact approved price)
//   * the MARKETPLACE attempt (submitted / listed / failed / ambiguous / operator-reconciled)

import { toCents } from './listingPriceBinding.js';
import { resolveGoverningGrade } from './gradeAuthority.js';

export const OPERATOR_AUTHORITY_TYPE = 'OPERATOR_MANUAL';

export const ATTEMPT_PHASES = Object.freeze({
  AUTHORIZED: 'AUTHORIZED',
  SUBMITTED: 'SUBMITTED',
  LISTED_CONFIRMED: 'LISTED_CONFIRMED',
  FAILED_DEFINITIVE: 'FAILED_DEFINITIVE',
  AMBIGUOUS: 'AMBIGUOUS',
  OPERATOR_RECONCILED: 'OPERATOR_RECONCILED',
});

// ───────────────────────── policy constants (documented, versioned) ─────────────────────────
export const RECONCILIATION_POLICY_VERSION = 'recon-v1';
/** An AMBIGUOUS attempt must be owned and closed (found / not-found-proven / closed-but-blocked) within this window. */
export const AMBIGUOUS_REVIEW_WINDOW_HOURS = 48;
/**
 * eBay documents NO indexing / propagation guarantee for its seller views (developer KB 1462 and the GetMyeBaySelling
 * reference, read 2026-10-12). This is therefore an OPERATOR POLICY wait, not a provider contract: an absence
 * observation made sooner than this after the submission is not accepted as proof of non-publication.
 */
export const MIN_ABSENCE_OBSERVATION_DELAY_MINUTES = 60;
/** Every Seller Hub view that could hold a listing a lost AddFixedPriceItem response created. */
export const REQUIRED_ABSENCE_SOURCES = Object.freeze(['SELLER_HUB_ACTIVE', 'SELLER_HUB_SCHEDULED', 'SELLER_HUB_SOLD', 'SELLER_HUB_UNSOLD']);

// ───────────────────────── provider correlation ─────────────────────────
/**
 * Attempt-linked correlation identifiers sent with AddFixedPriceItem.
 *  * uuid -- Item.UUID: 32 characters, digits 0-9 and letters A-F, UPPERCASE (a GUID without dashes). eBay's documented defence for a lost response:
 *    resending the SAME request with the SAME UUID either creates the listing (the first call had failed) or is
 *    rejected with error 488 "Duplicate UUID used" carrying the existing ItemID (KB 1462).
 *  * sku  -- Item.SKU used as a seller-visible custom label ("GK-" + the same 32 characters = 35 chars, limit 50). Without
 *    InventoryTrackingMethod=SKU it is NOT retrievable by GetItem; it exists so an operator (and a seller-scoped
 *    GetMyeBaySelling list scan) can recognise the listing.
 */
export function attemptCorrelation(attemptId) {
  const hex = String(attemptId || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('attemptCorrelation: attemptId must be a UUID');
  // eBay's schema documents Item.UUID as 32 characters of digits 0-9 and letters A-F (example is uppercase): emit uppercase.
  const upper = hex.toUpperCase();
  return { uuid: upper, sku: `GK-${upper}`, scheme: 'attempt-id-derived-v2-upper' };
}

// ───────────────────────── acknowledgment payload (whitelist projection) ─────────────────────────
const cleanStr = (v, max) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const cleanNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cleanStrList = (v, maxItems, maxLen) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => x.slice(0, maxLen)) : []);

/** Explicit whitelist of the client's Q41 acknowledgment. Nothing else the client sent survives. */
export function sanitizeQ41Ack(q41Override) {
  if (!q41Override || typeof q41Override !== 'object' || Array.isArray(q41Override)) return null;
  return {
    manualPrice: cleanNum(q41Override.manualPrice),
    listedPrice: cleanNum(q41Override.listedPrice),
    priceOverridden: q41Override.priceOverridden === true,
    lockClassAcknowledged: cleanStr(q41Override.lockClassAcknowledged, 40),
    locks: cleanStrList(q41Override.locks, 20, 64),
    engineState: cleanStr(q41Override.state, 40),
    engineDecision: cleanStr(q41Override.decision, 40),
    title: cleanStr(q41Override.title, 200),
    issue: cleanStr(q41Override.issue, 40),
  };
}

/** Server-derived warnings the operator approved past -- computed by the server, never client text. */
export function buildAckWarnings({ authority, priorLockCodes, freshLockCodes } = {}) {
  return {
    authorityState: cleanStr(authority && authority.state, 40),
    authorityReasonCodes: cleanStrList(authority && authority.reasonCodes, 20, 64),
    marketStanding: cleanStr(authority && authority.marketStanding, 40),
    identityStanding: cleanStr(authority && authority.identityStanding, 40),
    priorLockCodes: cleanStrList(priorLockCodes, 20, 64),
    freshLockCodes: cleanStrList(freshLockCodes, 20, 64),
  };
}

// ───────────────────────── governing grade reference (or explicit uncertainty) ─────────────────────────
/**
 * The grade authority standing at approval time. Never an inferred certainty: an operator-confirmed grade is
 * recorded as such; a model prediction is recorded as MODEL_PREDICTED_NOT_OPERATOR_CONFIRMED; nothing is recorded as
 * NO_GOVERNING_GRADE. The server-owned prediction event id is carried when the durable row has one.
 */
export function buildGoverningGradeSnapshot(durableAttrs) {
  const a = durableAttrs && typeof durableAttrs === 'object' ? durableAttrs : {};
  const g = resolveGoverningGrade({ gradeAuthority: a.gradeAuthority, operatorGrade: a.operatorGrade, operatorGradeNumeric: a.operatorGradeNumeric, grade: a.grade, numericGrade: a.numericGrade });
  const pointer = a.currentGradePrediction && typeof a.currentGradePrediction === 'object' ? a.currentGradePrediction : null;
  let uncertainty = null;
  if (g.source !== 'operator') uncertainty = g.grade ? 'MODEL_PREDICTED_NOT_OPERATOR_CONFIRMED' : 'NO_GOVERNING_GRADE';
  return {
    source: g.source === 'operator' ? 'OPERATOR_CONFIRMED' : (g.grade ? 'MODEL_PREDICTED' : 'NONE'),
    grade: cleanStr(g.grade, 40),
    numericGrade: cleanNum(g.numericGrade),
    gradeAuthority: cleanStr(a.gradeAuthority, 40),
    isGraded: a.isGraded === true ? true : (a.isGraded === false ? false : null),
    predictionEventId: pointer ? cleanStr(pointer.predictionEventId, 64) : null,
    uncertainty,
  };
}

// ───────────────────────── evidence at approval ─────────────────────────
export function classifyEvidence(attrs) {
  if (!attrs || typeof attrs !== 'object') return null;
  const dx = attrs.soldCompDiagnostics && typeof attrs.soldCompDiagnostics === 'object' ? attrs.soldCompDiagnostics : null;
  const raw = dx && typeof dx.rawCount === 'number' ? dx.rawCount : null;
  const verified = dx && typeof dx.verifiedCount === 'number' ? dx.verifiedCount : null;
  const newest = dx && typeof dx.newestDaysAgo === 'number' ? dx.newestDaysAgo : null;
  const src = cleanStr(attrs.pricingSource, 64);
  let evidenceClass = 'UNKNOWN';
  if (dx) {
    if (raw === 0) evidenceClass = 'NO_SOLD_EVIDENCE';
    else if (verified === 0) evidenceClass = 'SOLD_CANDIDATES_UNVERIFIED';
    else if (verified > 0 && newest !== null && newest > 180) evidenceClass = 'VERIFIED_SOLD_STALE';
    else if (verified > 0) evidenceClass = 'VERIFIED_SOLD_CURRENT';
  }
  return {
    pricingSource: src,
    priceBasis: src && /^active_ask/.test(src) ? 'ACTIVE_ASK_DERIVED' : (src ? 'OTHER' : 'UNKNOWN'),
    evidenceClass,
    verifiedSoldCount: verified,
    rawSoldCount: raw,
    newestDaysAgo: newest,
  };
}

export function buildApprovalEvidence({ durableAttrs, presentedAttrs, decisionSnapshot, decisionGovernance }) {
  const durable = classifyEvidence(durableAttrs);
  const presented = classifyEvidence(presentedAttrs);
  const snap = decisionSnapshot && typeof decisionSnapshot === 'object' && decisionSnapshot.market
    ? {
      pricingSource: cleanStr(decisionSnapshot.market.pricingSource, 64),
      verifiedSoldCount: decisionSnapshot.market.soldEvidence ? cleanNum(decisionSnapshot.market.soldEvidence.verifiedCount) : null,
      rawSoldCount: decisionSnapshot.market.soldEvidence ? cleanNum(decisionSnapshot.market.soldEvidence.rawCount) : null,
    } : null;
  const discrepancy = [];
  if (durable && presented) {
    if (durable.verifiedSoldCount !== presented.verifiedSoldCount) discrepancy.push('VERIFIED_SOLD_COUNT_DIFFERS');
    if (durable.pricingSource !== presented.pricingSource) discrepancy.push('PRICING_SOURCE_DIFFERS');
  }
  return {
    primary: durable ? 'DURABLE_CATALOGUE' : (presented ? 'CLIENT_PRESENTED' : 'NONE'),
    durableCatalogue: durable ? { ...durable, provenance: 'SERVER_HELD_CATALOGUE' } : null,
    clientPresented: presented ? { ...presented, provenance: 'CLIENT_PRESENTED_UNVERIFIED' } : null,
    decisionSnapshot: snap ? { ...snap, provenance: 'DECISION_TIME_SNAPSHOT' } : { provenance: 'LEGACY_NO_SNAPSHOT' },
    decisionGovernance: decisionGovernance
      ? { standing: decisionGovernance.standing, governed: decisionGovernance.governed === true, flags: Array.isArray(decisionGovernance.flags) ? decisionGovernance.flags.slice(0, 12) : [] }
      : null,
    discrepancy,
  };
}

/** The scalar evidence columns of the snapshot, taken from the primary evidence view. */
export function evidenceScalars(evidence) {
  const view = evidence && (evidence.primary === 'DURABLE_CATALOGUE' ? evidence.durableCatalogue : evidence.primary === 'CLIENT_PRESENTED' ? evidence.clientPresented : null);
  return { evidenceClass: view ? view.evidenceClass : 'UNKNOWN', verifiedSoldCount: view && typeof view.verifiedSoldCount === 'number' ? view.verifiedSoldCount : null };
}

// ───────────────────────── snapshot verification (A1) ─────────────────────────
/**
 * Compares the IMMUTABLE approval snapshot (an AUTHORIZED operator_authority_event row) with the mutable rows it
 * references. operator_action_event / decision_event are navigation targets; the snapshot is the source of truth for
 * what was approved. Any divergence is reported -- never silently resolved in favour of either side.
 * @returns {{consistent:boolean, discrepancies:Array<{field:string, snapshot:any, current:any}>}}
 */
export function verifyAuthoritySnapshot(snapshot, refs = {}) {
  const d = [];
  const add = (field, s, c) => d.push({ field, snapshot: s, current: c });
  const s = snapshot || {};
  const action = refs.operatorAction || null;
  const decision = refs.decision || null;
  if (!action) add('operator_action_event', 'present', 'missing');
  else {
    const curCents = toCents(action.action_value_amount);
    const snapCents = s.approved_amount_cents === null || s.approved_amount_cents === undefined ? null : Number(s.approved_amount_cents);
    if (curCents !== snapCents) add('approved_amount_cents', snapCents, curCents);
    if ((action.action_value_currency || null) !== (s.approved_currency || null)) add('approved_currency', s.approved_currency, action.action_value_currency);
    if (action.gk_asset_id !== s.gk_asset_id) add('gk_asset_id', s.gk_asset_id, action.gk_asset_id);
    if (action.principal_id !== s.principal_id) add('principal_id', s.principal_id, action.principal_id);
    if (action.action_code !== 'LIST') add('action_code', 'LIST', action.action_code);
    if (action.decision_event_id !== s.decision_event_id) add('decision_event_id', s.decision_event_id, action.decision_event_id);
    if (action.occurred_at && s.approved_at && new Date(action.occurred_at).getTime() !== new Date(s.approved_at).getTime()) add('approved_at', s.approved_at, action.occurred_at);
  }
  if (!decision) add('decision_event', 'present', 'missing');
  else {
    if (decision.recommendation !== s.engine_recommendation) add('engine_recommendation', s.engine_recommendation, decision.recommendation);
    if (decision.asset_id !== s.gk_asset_id) add('decision.asset_id', s.gk_asset_id, decision.asset_id);
  }
  return { consistent: d.length === 0, discrepancies: d };
}

// ───────────────────────── provider response classification ─────────────────────────
export const AMBIGUOUS_PROVIDER_ERROR_CODES = Object.freeze(['10007', '10001']);

const tag = (xml, name) => { const m = String(xml || '').match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : null; };
function errorEntries(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)) out.push({ code: tag(m[1], 'ErrorCode'), severity: tag(m[1], 'SeverityCode') });
  return out;
}

/**
 * @returns {{kind:'LISTED'|'FAILED_DEFINITIVE'|'AMBIGUOUS', itemId:string|null, errorCodes:string[], reason:string}}
 * DEFINITIVE failure requires ALL of: HTTP 200, a parseable Ack of Failure, no listing id, at least one Error-severity
 * entry, and no ambiguous error code. Anything else without a listing id is AMBIGUOUS.
 */
export function classifyAddItemResponse({ networkError, httpStatus, responseXml } = {}) {
  if (networkError) return { kind: 'AMBIGUOUS', itemId: null, errorCodes: [], reason: 'network-error' };
  const itemId = tag(responseXml, 'ItemID');
  if (itemId) return { kind: 'LISTED', itemId, errorCodes: [], reason: 'item-id-returned' };
  const status = Number(httpStatus);
  const entries = errorEntries(responseXml);
  const errorCodes = entries.map((e) => e.code).filter(Boolean);
  if (!Number.isFinite(status) || status >= 500 || status === 408) return { kind: 'AMBIGUOUS', itemId: null, errorCodes, reason: `http-${Number.isFinite(status) ? status : 'unknown'}` };
  const ack = tag(responseXml, 'Ack');
  if (!ack) return { kind: 'AMBIGUOUS', itemId: null, errorCodes, reason: 'unparseable-response' };
  if (!/^Failure$/i.test(ack)) return { kind: 'AMBIGUOUS', itemId: null, errorCodes, reason: `ack-${ack.toLowerCase()}-without-item-id` };
  const hasError = entries.some((e) => /^Error$/i.test(e.severity || ''));
  if (!hasError) return { kind: 'AMBIGUOUS', itemId: null, errorCodes, reason: 'failure-without-error-entry' };
  if (errorCodes.some((c) => AMBIGUOUS_PROVIDER_ERROR_CODES.includes(c))) return { kind: 'AMBIGUOUS', itemId: null, errorCodes, reason: 'provider-system-error' };
  return { kind: 'FAILED_DEFINITIVE', itemId: null, errorCodes, reason: 'provider-refused' };
}

// ───────────────────────── attempt state + retry guard ─────────────────────────
/**
 * Reduce the phase rows of ONE attempt (oldest first) to its current state.
 * AUTHORIZED_NOT_EXECUTED  approved, nothing sent (safe to retry)
 * IN_FLIGHT_OR_UNRESOLVED  SUBMITTED with no result (a crash or a concurrent call) -- BLOCKS
 * LISTED                   provider listing id recorded (LISTED_CONFIRMED, or an operator reconciliation that FOUND it)
 * FAILED                   definitive refusal (safe to retry)
 * AMBIGUOUS                outcome unknown -- BLOCKS until an operator reconciliation closes it
 * RECONCILED_NOT_LISTED    an operator reconciliation that PASSED the absence policy and authorized a new publish
 * CLOSED_BLOCKED           an operator reconciliation that could not establish absence: owned and closed, STILL BLOCKS
 */
export function reduceAttemptState(phaseRows) {
  const rows = phaseRows || [];
  const phases = new Set(rows.map((r) => r.phase));
  if (phases.has('LISTED_CONFIRMED')) return 'LISTED';
  const recon = [...rows].reverse().find((r) => r.phase === 'OPERATOR_RECONCILED');
  if (recon) {
    if (recon.recon_verdict === 'LISTING_FOUND') return 'LISTED';
    if (recon.recon_verdict === 'NOT_FOUND' && recon.new_publish_authorized === true) return 'RECONCILED_NOT_LISTED';
    return 'CLOSED_BLOCKED';
  }
  if (phases.has('AMBIGUOUS')) return 'AMBIGUOUS';
  if (phases.has('FAILED_DEFINITIVE')) return 'FAILED';
  if (phases.has('SUBMITTED')) return 'IN_FLIGHT_OR_UNRESOLVED';
  return 'AUTHORIZED_NOT_EXECUTED';
}

export function assessListingAttemptGuard(rows, exceptAttemptId = null) {
  const byAttempt = new Map();
  for (const r of rows || []) {
    if (r.attempt_id === exceptAttemptId) continue;
    if (!byAttempt.has(r.attempt_id)) byAttempt.set(r.attempt_id, []);
    byAttempt.get(r.attempt_id).push(r);
  }
  for (const [attemptId, attemptRows] of byAttempt) {
    const state = reduceAttemptState(attemptRows);
    if (state === 'AMBIGUOUS') return { allowed: false, code: 'LISTING_ATTEMPT_AMBIGUOUS', attemptId, state, message: `A previous listing attempt (${attemptId}) has an unknown outcome and must be reconciled by the operator with the marketplace before another listing is attempted.` };
    if (state === 'CLOSED_BLOCKED') return { allowed: false, code: 'LISTING_ATTEMPT_CLOSED_BLOCKED', attemptId, state, message: `A previous listing attempt (${attemptId}) was reviewed but its non-publication could not be established; a new listing stays blocked until further evidence is recorded.` };
    if (state === 'IN_FLIGHT_OR_UNRESOLVED') return { allowed: false, code: 'LISTING_ATTEMPT_UNRESOLVED', attemptId, state, message: `A listing attempt (${attemptId}) was submitted and has no recorded result; it must complete or be reconciled before another listing is attempted.` };
    if (state === 'LISTED') {
      const ended = attemptRows.some((r) => r.listing_ended === true);
      if (!ended) return { allowed: false, code: 'LISTING_ALREADY_LISTED_BY_ATTEMPT', attemptId, state, message: `A previous listing attempt (${attemptId}) produced a live listing; creating another would duplicate it.` };
    }
  }
  return { allowed: true, code: null, attemptId: null, state: null, message: null };
}

// ───────────────────────── operator reconciliation policy (A2) ─────────────────────────
/**
 * Decides what an operator's observation is WORTH. A human observation is not automatically proof of
 * non-publication: NOT_FOUND unlocks a new publish only when the absence policy is satisfied; otherwise the
 * observation is recorded but the attempt is closed-but-BLOCKED. Nothing here ever unlocks on a missing field.
 *
 * @returns {{recordedVerdict:'LISTING_FOUND'|'NOT_FOUND'|'UNRESOLVED', newPublishAuthorized:boolean, claimedVerdict:string, downgradeReasons:string[]}}
 */
export function evaluateOperatorReconciliation({ verdict, externalListingId, checkedSources, checkedAt, evidenceRef, requestNewPublish, submittedAt, automatedLookup, now } = {}) {
  const claimedVerdict = verdict;
  const reasons = [];
  if (!['LISTING_FOUND', 'NOT_FOUND', 'UNRESOLVED'].includes(verdict)) throw new Error('verdict must be LISTING_FOUND | NOT_FOUND | UNRESOLVED');
  if (verdict === 'LISTING_FOUND') {
    if (!externalListingId) throw new Error('LISTING_FOUND requires the marketplace listing id');
    return { recordedVerdict: 'LISTING_FOUND', newPublishAuthorized: false, claimedVerdict, downgradeReasons: [] };
  }
  if (verdict === 'UNRESOLVED') return { recordedVerdict: 'UNRESOLVED', newPublishAuthorized: false, claimedVerdict, downgradeReasons: [] };

  // NOT_FOUND: the claim must earn its weight.
  const sources = new Set(Array.isArray(checkedSources) ? checkedSources : []);
  const missing = REQUIRED_ABSENCE_SOURCES.filter((s) => !sources.has(s));
  if (missing.length) reasons.push(`ABSENCE_SOURCES_INCOMPLETE:${missing.join('+')}`);
  if (!evidenceRef || typeof evidenceRef !== 'string' || evidenceRef.trim().length < 4) reasons.push('NO_EVIDENCE_REFERENCE');
  const checked = checkedAt ? new Date(checkedAt) : null;
  const nowMs = (now ? new Date(now) : new Date()).getTime();
  if (!checked || Number.isNaN(checked.getTime())) reasons.push('CHECKED_AT_MISSING');
  else {
    if (checked.getTime() > nowMs + 60_000) reasons.push('CHECKED_AT_IN_FUTURE');
    const sub = submittedAt ? new Date(submittedAt).getTime() : null;
    if (sub === null || Number.isNaN(sub)) reasons.push('SUBMISSION_TIME_UNKNOWN');
    else if (checked.getTime() < sub + MIN_ABSENCE_OBSERVATION_DELAY_MINUTES * 60_000) reasons.push('CHECKED_TOO_SOON_AFTER_SUBMISSION');
  }
  if (automatedLookup && Array.isArray(automatedLookup.matches) && automatedLookup.matches.length > 0) reasons.push('CONTRADICTED_BY_SELLER_SCOPED_LOOKUP');
  if (reasons.length) return { recordedVerdict: 'UNRESOLVED', newPublishAuthorized: false, claimedVerdict, downgradeReasons: reasons };
  return { recordedVerdict: 'NOT_FOUND', newPublishAuthorized: requestNewPublish === true, claimedVerdict, downgradeReasons: [] };
}

/** Review queue helper: state of one AMBIGUOUS attempt against the bounded review window. */
export function reviewStatus({ reviewDueAt, now }) {
  const due = reviewDueAt ? new Date(reviewDueAt).getTime() : null;
  if (due === null) return 'NO_DEADLINE';
  return (now ? new Date(now) : new Date()).getTime() > due ? 'OVERDUE' : 'WITHIN_WINDOW';
}

/** True when two amounts are the same USD value in integer cents (never float equality). */
export const sameCents = (a, b) => { const x = toCents(a); const y = toCents(b); return x !== null && y !== null && x === y; };
export { toCents };
