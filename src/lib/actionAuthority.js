// src/lib/actionAuthority.js
//
// GrailKey Directive Z — the transaction authority boundary.
//
// Confidence answers "how sure are we?" (matchConfidence — identity
// confidence, untouched by this file). Authority answers "are we allowed
// to transact?" — a SEPARATE axis. The Sabrina P0 (GK-95/96) happened
// because no such axis existed: a book whose pricing evidence was thin,
// stale, and tier-4 (pc_estimate) scored MEDIUM identity confidence and
// sailed through every existing safety check, because none of them were
// built to ask "is there enough EVIDENCE to transact," only "how sure are
// we this is the right book."
//
// Two independently-derived standings feed one verdict:
//   identityStanding — CONFIRMED | CONFLICTED | UNRESOLVED
//   marketStanding   — EXACT_CURRENT | EXACT_STALE | SIMILAR_ONLY |
//                       FALLBACK_ONLY | NONE
//   actionAuthority  — { state, identityStanding, marketStanding, reasonCodes }
//     state: READY | REVIEW | LOCKED
//
// Pure functions only, operating on `out` (the server enrich response
// shape, same object responseContract.js already consumes) — importable
// from BOTH api/enrich.js (server, where the contract is assembled) and
// api/list-ebay.js (server, where this dispatch adds independent
// re-derivation per C3 — the client's own computed verdict, if it sends
// one at all, is never read).
//
// Explicitly NOT touched by this file: matchConfidence (identity
// confidence) is never mutated, never demoted, never read as an input to
// marketStanding. The two axes stay separate by design (see the module
// header above) — conflating them was the original architectural mistake
// this dispatch exists to undo, not repeat under a new name.

// Mirrors responseContract.js's PRICED_SOURCES/ESTIMATED_SOURCES
// vocabulary (not reinvented — same source list, re-partitioned along the
// evidence-currency axis those sets don't themselves express).
const FALLBACK_ONLY_SOURCES = new Set(['pc_estimate', 'ai_estimate']);
const SIMILAR_ONLY_SOURCES = new Set(['visual_pool_fallback', 'web_search_fallback']);
const STALE_SOURCES = new Set(['verified_sold_stale']);
const EXACT_CURRENT_SOURCES = new Set([
  'verified_sold_recency',
  'sold_active_blend_30',
  'verified_sold',
  'verified_sold_active_blend',
  'active_ask_derived',
  'verified_active',
  'ebay-polybag-active',
]);

/**
 * marketStanding — evidence-quality axis, derived from pricingSource
 * alone (the same field responseContract.js's PRICED_SOURCES/
 * ESTIMATED_SOURCES already partition, just along a different cut).
 * Deliberately does NOT read matchConfidence, rawComps counts, or
 * staleness beyond what pricingSource's own tier label already encodes —
 * per Directive Z Task 2a: "if a distinction can't be made from existing
 * data, collapse it, don't invent a signal."
 */
export function deriveMarketStanding(out) {
  const source = out?.pricingSource;
  if (!source) return 'NONE';
  if (/^refused/.test(source)) return 'NONE';
  if (FALLBACK_ONLY_SOURCES.has(source)) return 'FALLBACK_ONLY';
  if (SIMILAR_ONLY_SOURCES.has(source)) return 'SIMILAR_ONLY';
  if (STALE_SOURCES.has(source)) return 'EXACT_STALE';
  if (EXACT_CURRENT_SOURCES.has(source)) {
    // GrailKey Directive AB (GK-101) — evidence applicability custody.
    // pricingSource alone says the pool is CURRENT; it says nothing about
    // whether the pool is evidence for the confirmed EDITION. When a
    // variant was confirmed and api/comps.js's Filter 1c could not confirm
    // any comp in the winning pool actually matches it (fell back to the
    // broader, variant-blind "keeping all" pool — out.variantApplicability
    // === 'UNVERIFIED', computed once at the filter and carried here
    // untouched, never re-derived), EXACT_CURRENT is unreachable: the pool
    // is current for SOME edition of this book, not confirmed current for
    // THIS one. Floors to SIMILAR_ONLY, never lower — this is a
    // revocation of standing the source string alone would have granted,
    // not fabrication of worse evidence (C1). No confirmedVariant at all
    // (out.variantApplicability === null) is a normal, unaffected book —
    // EXACT_CURRENT stays fully reachable.
    if (out?.variantApplicability === 'UNVERIFIED') return 'SIMILAR_ONLY';
    return 'EXACT_CURRENT';
  }
  // Unrecognized source string — conservative default, never silently
  // treated as current market evidence.
  return 'NONE';
}

/**
 * identityStanding — the three signals Directive Y confirmed feed the
 * existing "Identity confirmed" badge (App.jsx:425-458), re-derived here
 * as their own axis instead of a badge-only computation. Deliberately
 * conservative scaffolding (Directive Z Task 1d/2b): GK-98 (a confidently
 * WRONG identity that never sets ANY of these three signals) remains
 * open and undetected by this axis — that gap is not closed here, and
 * this function must not be extended to guess at it without GK-98's own
 * greenlight.
 */
export function deriveIdentityStanding(out) {
  // Mirrors deriveLocks' own 'id-required' defensive fallback exactly
  // (responseContract.js) -- a genuine early-exit path with no decision
  // object at all still reads as UNRESOLVED via identityConfident, not as
  // an undefined/false negative.
  const isUnresolved =
    (!out?.decision && out?.identityConfident === false) ||
    out?.decision?.action === 'ID_REQUIRED' ||
    (Array.isArray(out?.decision?.blockers) && out.decision.blockers.includes('identity-not-confident'));
  if (isUnresolved) return 'UNRESOLVED';

  const isConflicted =
    out?.identityProvisional === true ||
    out?.listingHardLockReason === 'identity-unresolved';
  if (isConflicted) return 'CONFLICTED';

  return 'CONFIRMED';
}

// reasonCode map — one entry per lock `code` responseContract.js's
// deriveLocks can emit (existing 9 + the 2 new standing-derived locks
// this dispatch adds there), so every denial is explicable without
// inference (Directive Z Task 2c). Codes not in this map pass through
// upper-snake-cased as a defensive fallback, never silently dropped.
const LOCK_CODE_TO_REASON = {
  'id-required': 'IDENTITY_REQUIRED',
  'refused': 'PRICING_REFUSED',
  'tier0-convergence': 'TIER0_CONVERGENCE',
  'manual-review': 'MANUAL_REVIEW_REQUIRED',
  'grade-exceeds-map': 'GRADE_EXCEEDS_MAP',
  'claude-check-blocker': 'CLAUDE_CHECK_BLOCKER',
  'decision-blocked': 'DECISION_BLOCKED',
  'low-tier-thin-pool': 'LOW_TIER_THIN_POOL',
  'market-standing-fallback-only': 'FALLBACK_ONLY_PRICING',
  'market-standing-none': 'NO_MARKET_EVIDENCE',
  'identity-standing-conflicted': 'IDENTITY_CONFLICT',
  'market-standing-variant-unmatched': 'VARIANT_UNMATCHED_POOL', // GrailKey Directive AB (GK-101)
  'market-standing-sold-variant-fallback': 'SOLD_VARIANT_FALLBACK_POOL', // GrailKey Directive AH (GK-111)
  'single-comp-pool': 'SINGLE_COMP_POOL', // GrailKey Directive AH (GK-111)
};

const lockToReasonCode = (lock) => {
  if (lock.code === 'listing-hard-locked' || !LOCK_CODE_TO_REASON[lock.code]) {
    // listing-hard-locked carries its own specific out.listingHardLockReason
    // as the code (Ship #24a-3 GL-2 design) -- pass through, upper-snaked,
    // rather than collapsing every hard-lock reason to one generic code.
    return String(lock.code || 'UNKNOWN').toUpperCase().replace(/-/g, '_');
  }
  return LOCK_CODE_TO_REASON[lock.code];
};

/**
 * deriveActionAuthority — the ONE transaction verdict every listability
 * consumer must derive from (Directive Z C2). `locks` is the FULL,
 * already-augmented deriveLocks(out) output (existing 9 conditions PLUS
 * the 2 new standing-derived locks responseContract.js adds) -- computed
 * once by the caller and passed in, not re-derived here, so this
 * function stays a pure projection with no risk of drifting from
 * deriveLocks' own logic.
 *
 * state:
 *   READY  — identityStanding CONFIRMED, marketStanding EXACT_CURRENT,
 *            zero locks of any kind, decision.action starts with 'LIST'.
 *            The ONLY state that authorizes a one-tap listing.
 *   LOCKED — any 'integrity'-class (hard) lock present, OR
 *            decision.action is DO_NOT_LIST/ID_REQUIRED. Never
 *            acknowledgeable (matches the existing Q41 integrity-class
 *            UI, unchanged).
 *   REVIEW — everything else: soft ('insufficiency'-class) locks present
 *            without a hard lock, or a non-EXACT_CURRENT market standing,
 *            or decision.action is RESEARCH/GRADE_CANDIDATE. Acknowledge-
 *            able via the existing Q41 override flow (unchanged).
 */
export function deriveActionAuthority(out, locks, resolvedDecision) {
  const identityStanding = deriveIdentityStanding(out);
  const marketStanding = deriveMarketStanding(out);
  // resolvedDecision — assembleContract's own early-exit synthesis
  // (responseContract.js) when out.decision is entirely absent. Falls
  // back to out.decision?.action for every normal call (including every
  // direct test of this function), never changes behavior for the
  // common case.
  const action = resolvedDecision?.action ?? out?.decision?.action ?? null;
  const safeLocks = Array.isArray(locks) ? locks : [];

  const hasHardLock = safeLocks.some((l) => l.hard === true);
  const isHardBlockedAction = action === 'DO_NOT_LIST' || action === 'ID_REQUIRED';

  let state;
  if (hasHardLock || isHardBlockedAction) {
    state = 'LOCKED';
  } else if (
    identityStanding === 'CONFIRMED' &&
    marketStanding === 'EXACT_CURRENT' &&
    safeLocks.length === 0 &&
    typeof action === 'string' &&
    action.startsWith('LIST')
  ) {
    state = 'READY';
  } else {
    state = 'REVIEW';
  }

  const reasonCodes = safeLocks.map(lockToReasonCode);

  return { state, identityStanding, marketStanding, reasonCodes };
}
