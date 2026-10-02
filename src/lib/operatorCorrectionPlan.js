// src/lib/operatorCorrectionPlan.js -- GK-278. PURE planning for operator-correction
// events. Given the durable row's attributes (read under the row lock) and the
// server-validated patch, decide which correction surfaces LOGICALLY changed, what the
// before/after values and authority standings were, and what the minimal state mutation is.
//
// "No state mutation without event; no event without a mutation": a patch that changes
// nothing logically yields noop=true and the caller performs neither.
//
// An operator correction is a LABEL. Nothing here says "truth".

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const norm = (v) => (v === undefined ? null : v);

const GRADE_VALUE_KEYS = ['operatorGrade', 'operatorGradeNumeric'];
const GRADE_AUTH_KEYS = ['gradeAuthority'];
const GRADE_STATE_KEYS = ['operatorGrade', 'operatorGradeNumeric', 'operatorGradeSetAt', 'gradeAuthority'];
const FORMAT_VALUE_KEYS = ['operatorIsGraded'];
const FORMAT_AUTH_KEYS = ['gradingFormatAuthority'];
const FORMAT_STATE_KEYS = ['operatorIsGraded', 'gradingFormatAuthority'];

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, norm(obj?.[k])]));

function planSurface({ surface, valueKeys, authKeys, stateKeys, attrs, patch }) {
  const touched = stateKeys.some((k) => Object.prototype.hasOwnProperty.call(patch, k));
  if (!touched) return null;
  const beforeValue = pick(attrs, valueKeys);
  const afterValue = pick({ ...attrs, ...patch }, valueKeys);
  const authorityBefore = pick(attrs, authKeys);
  const authorityAfter = pick({ ...attrs, ...patch }, authKeys);
  if (eq(beforeValue, afterValue) && eq(authorityBefore, authorityAfter)) return null; // logical no-op
  const cleared = authKeys.every((k) => authorityAfter[k] === null) && valueKeys.every((k) => afterValue[k] === null);
  return {
    surface, action: cleared ? 'CLEAR' : 'SET',
    beforeValue, afterValue, authorityBefore, authorityAfter,
    patchPart: Object.fromEntries(stateKeys.filter((k) => Object.prototype.hasOwnProperty.call(patch, k)).map((k) => [k, patch[k]])),
  };
}

/** Plan GRADE and GRADING_FORMAT corrections for a grading-authority patch. */
export function planGradingCorrections(attrs, patch) {
  const events = [
    planSurface({ surface: 'GRADE', valueKeys: GRADE_VALUE_KEYS, authKeys: GRADE_AUTH_KEYS, stateKeys: GRADE_STATE_KEYS, attrs, patch }),
    planSurface({ surface: 'GRADING_FORMAT', valueKeys: FORMAT_VALUE_KEYS, authKeys: FORMAT_AUTH_KEYS, stateKeys: FORMAT_STATE_KEYS, attrs, patch }),
  ].filter(Boolean);
  const mutation = Object.assign({}, ...events.map((e) => e.patchPart));
  return { noop: events.length === 0, events, mutation };
}

// The identity facets whose VALUES are persisted attributes (and are therefore written by the
// server inside the correction transaction). 'printingClass' etc. carry authority only.
export const IDENTITY_VALUE_FIELDS = ['title', 'issue', 'year', 'publisher', 'variant'];

/**
 * Plan an IDENTITY correction. `fields` = the accepted corrected facets, `afterValues` = the
 * server-validated corrected values for them, `mergedAuthority` = prior durable map merged with
 * the newly minted OPERATOR_CONFIRMED entries.
 */
export function planIdentityCorrection(attrs, { fields, afterValues, mergedAuthority }) {
  const f = (Array.isArray(fields) ? fields : []).filter((k) => IDENTITY_VALUE_FIELDS.includes(k));
  const beforeValue = pick(attrs, f);
  const afterValue = Object.fromEntries(f.map((k) => [k, norm(afterValues?.[k])]));
  const authorityBefore = (attrs?.identityAuthority && typeof attrs.identityAuthority === 'object') ? attrs.identityAuthority : {};
  const authorityAfter = mergedAuthority && typeof mergedAuthority === 'object' ? mergedAuthority : {};
  if (eq(beforeValue, afterValue) && eq(authorityBefore, authorityAfter)) return { noop: true, events: [], mutation: {} };
  return {
    noop: false,
    events: [{ surface: 'IDENTITY', action: 'CORRECT', beforeValue, afterValue, authorityBefore, authorityAfter }],
    // GK-278B: the corrected VALUES are part of the same mutation, so durable value ==
    // event.after == the validated value, in one transaction.
    mutation: { identityAuthority: authorityAfter, values: afterValue },
  };
}
