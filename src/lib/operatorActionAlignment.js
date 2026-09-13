// src/lib/operatorActionAlignment.js — OperatorAction FOLLOWED/OVERRIDDEN
// derivation (GK-199, OperatorAction dispatch, 2026-09-09).
//
// Pure function, no I/O, NEVER persisted — recommendation and operator
// action are the only two stored truths (decision_event.recommendation,
// operator_action_event.action_code); FOLLOWED/OVERRIDDEN/NOT_COMPARABLE
// is always re-derived at read time from those two codes. A changed
// mapping rule is therefore a visible code change to THIS file, never a
// silent reinterpretation of already-recorded history — this is the
// explicit reason the mapping is documented here (and mirrored in
// docs/TICKET-REGISTRY.md) rather than left implicit.
//
// Recommendation vocabulary (decisionEngine.js, unchanged, not owned by
// this file): ID_REQUIRED, DO_NOT_LIST, RESEARCH, GRADE_CANDIDATE,
// LIST_LOW, LIST_NOW.
// Operator action vocabulary (0021, this dispatch's own disclosed,
// minimal, non-invented set): LIST, HOLD, PASS.

export const ALIGNMENT = Object.freeze({
  FOLLOWED: 'FOLLOWED',
  OVERRIDDEN: 'OVERRIDDEN',
  NOT_COMPARABLE: 'NOT_COMPARABLE',
});

// recommendation -> the ONE action_code that counts as FOLLOWED.
// Any other real action_code for that recommendation is OVERRIDDEN.
// A recommendation not present here (including ID_REQUIRED, and any
// value this function has never seen) is NOT_COMPARABLE — fail-safe,
// never a guessed alignment.
const FOLLOWED_ACTION_BY_RECOMMENDATION = Object.freeze({
  LIST_NOW: 'LIST',
  LIST_LOW: 'LIST',
  RESEARCH: 'HOLD',
  GRADE_CANDIDATE: 'HOLD',
  DO_NOT_LIST: 'PASS',
});

export function deriveActionAlignment(recommendation, actionCode) {
  const followedAction = FOLLOWED_ACTION_BY_RECOMMENDATION[recommendation];
  if (followedAction === undefined) return ALIGNMENT.NOT_COMPARABLE;
  return actionCode === followedAction ? ALIGNMENT.FOLLOWED : ALIGNMENT.OVERRIDDEN;
}

// selectCurrentOperatorAction — Outcome #1 PRE-PUBLISH HARDENING. Pure,
// no I/O. Finds the operator action a caller (the real "List on eBay"
// button, GrailKeyOperatorPanel.jsx, or anything else) must treat as
// "the current one" — by id, against the server-declared
// currentOperatorActionId (repository.js's getAssetGraph, the SAME
// recorded_at-then-id deterministic tie-break already established for
// currentValuationId/currentDecisionId, P0-B) — NEVER by array position
// (`operatorActions[operatorActions.length - 1]`). For Creepy #1's real
// two-row history (HOLD at 2026-09-12T20:55:17Z, then LIST at
// 2026-09-12T21:58:54Z), this returns the LIST row, because that is the
// row currentOperatorActionId actually names — not because it happens
// to be last in array order (which, for this asset, is the same row,
// but that agreement is incidental, never the contract).
export function selectCurrentOperatorAction({ operatorActions, currentOperatorActionId } = {}) {
  if (!currentOperatorActionId || !Array.isArray(operatorActions)) return null;
  return operatorActions.find((a) => a.id === currentOperatorActionId) ?? null;
}

// Outcome #1 IMPLEMENTATION PASS (2026-09-12) — explicitly confirmed,
// not re-derived, for Creepy #1's own real chain (recommendation
// LIST_LOW, operator action LIST): this maps to FOLLOWED under the
// table above, because LIST_LOW carries two separate semantics —
// directional action (LIST) and price posture (LOW) — and
// operator_action_event.action_code only ever records the directional
// action class. Any gap between the recommended price and the actual
// listing ask is a SEPARATE fact, scored in the marketplace-execution/
// economics layer (outcome_event.ask_amount vs. decision_event's own
// linked valuation_event.value_amount), never folded into this
// alignment derivation. No logic change was needed — this note exists
// only so that fact is recorded, not re-litigated by a future reader.
