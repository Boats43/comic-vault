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
