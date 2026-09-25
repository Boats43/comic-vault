/**
 * GK-213B — Operator Grading Authority (Product Refinement/Grading Program,
 * GK-213 item #3).
 *
 * OPERATOR-ESTABLISHED FACTS OUTRANK FRESH MODEL OUTPUT. Sibling domain to
 * src/lib/dataQualityGuard.js's identityAuthority (GK-213A) — same law,
 * deliberately NOT the same field. `grade` is not an identity-bearing fact
 * (it never lived in identityAuthority's five facets: title/issue/year/
 * publisher/variant), so this module carries its own `gradeAuthority` /
 * `gradingFormatAuthority` markers rather than borrowing that object's name
 * merely to reuse it.
 *
 * Three durable facts, never conflated:
 *   - modelPredictedGrade* (dataQualityGuard.js, applyFirstModelPrediction)
 *     — write-once calibration BASELINE. The very first model grade ever
 *     produced. Untouched by anything in this module.
 *   - grade / numericGrade / isGraded — the CURRENT automated estimate.
 *     May keep updating via chooseBetterGrade on later scans (existing
 *     behavior, unchanged) even while an operator override is active.
 *   - operatorGrade / operatorGradeNumeric / operatorIsGraded — explicit
 *     HUMAN authority. Only this module's own set/clear functions ever
 *     write these.
 *
 * Grading-format hierarchy (K1):
 *   ESTABLISHED CERTIFIED FACT (cgcVerified===true, from a real CGC
 *   cert-number lookup — api/cgc-lookup.js; DORMANT today, WAF-blocked,
 *   see CLAUDE.md Open Blockers, so this tier is architecturally correct
 *   but not practically reachable in current live traffic)
 *     >
 *   OPERATOR-CONFIRMED FORMAT (gradingFormatAuthority==='OPERATOR_CONFIRMED')
 *     >
 *   MODEL FORMAT GUESS (isGraded, as returned by /api/grade)
 *
 * Grading VALUE hierarchy, independent of the format hierarchy (K6 Case D
 * — a preserved operatorGrade reactivates the moment governing format
 * becomes RAW again, by design, not by accident):
 *   OPERATOR_CONFIRMED grade (gradeAuthority==='OPERATOR_CONFIRMED' AND a
 *   valid operatorGrade is present)
 *     >
 *   current automated `grade`
 */

// Accepted raw-grade vocabulary — the same abbreviations
// api/enrich.js's RAW_MULTIPLIERS tables actually recognize (both eras
// share the same key set), optionally paired with a decimal numeric grade
// (the same shape getRawGradeMultiplier's own Step-1 numeric-extraction
// already parses, e.g. "VG 4.0"). Deliberately narrower than what
// getRawGradeMultiplier will silently accept (that function's own Step 3
// defaults ANY unrecognized string to 0.75/"RAW" — permissive by design
// for legacy free-text Vision output, not a validation gate) — an
// operator's own explicit correction should be rejected outright if it
// doesn't parse as a real grade, not silently priced as an unlabeled 0.75.
export const RAW_GRADE_LABELS = [
  'NM/M', 'NM', 'VF/NM', 'VF/F', 'VF', 'FN/VF', 'FN', 'VG/FN', 'VG/G', 'VG',
  'GD/VG', 'GD', 'FR/GD', 'FR', 'PR',
];
// Longest-label-first so "NM/M" matches before the "NM" prefix would.
const LABEL_PATTERN = new RegExp(
  `^(${[...RAW_GRADE_LABELS].sort((a, b) => b.length - a.length).map((l) => l.replace('/', '\\/')).join('|')})(?:\\s+(\\d+(?:\\.\\d+)?))?$`,
  'i'
);
const BARE_NUMERIC_PATTERN = /^(\d+(?:\.\d+)?)$/;

/**
 * Validates and normalizes an operator-entered raw grade string.
 * Accepts "VG", "VG 4.0", or a bare "4.0" (0.5-10.0). Rejects empty,
 * unrecognized abbreviations, and out-of-range numerics.
 *
 * @param {string} input
 * @returns {{ valid: true, grade: string, numericGrade: number|null } | { valid: false, error: string }}
 */
export function validateOperatorGrade(input) {
  const s = String(input ?? '').trim();
  if (!s) return { valid: false, error: 'Grade is required.' };

  const labelMatch = s.match(LABEL_PATTERN);
  if (labelMatch) {
    const num = labelMatch[2] != null ? parseFloat(labelMatch[2]) : null;
    if (num != null && (isNaN(num) || num < 0.5 || num > 10)) {
      return { valid: false, error: `Numeric grade "${labelMatch[2]}" is out of range (0.5-10.0).` };
    }
    return { valid: true, grade: s, numericGrade: num };
  }

  const bareMatch = s.match(BARE_NUMERIC_PATTERN);
  if (bareMatch) {
    const num = parseFloat(bareMatch[1]);
    if (isNaN(num) || num < 0.5 || num > 10) {
      return { valid: false, error: `Grade "${s}" is out of range (0.5-10.0).` };
    }
    return { valid: true, grade: s, numericGrade: num };
  }

  return { valid: false, error: `"${s}" is not a recognized raw grade (expected e.g. "VG 4.0", "FN", or a numeric 0.5-10.0).` };
}

/**
 * SET / CHANGE — validates, then returns the patch to spread into the
 * persisted item. Never touches modelPredictedGrade*, never touches
 * `grade`/`isGraded`/`numericGrade` (the current-automated-estimate
 * fields) — those remain exactly what the model last said, per this
 * build's own "operator grade must never overwrite grade" rule.
 *
 * @param {string} rawInput
 * @returns {{ ok: true, patch: object } | { ok: false, error: string }}
 */
export function setOperatorGrade(rawInput) {
  const result = validateOperatorGrade(rawInput);
  if (!result.valid) return { ok: false, error: result.error };
  return {
    ok: true,
    patch: {
      operatorGrade: result.grade,
      operatorGradeNumeric: result.numericGrade,
      operatorGradeSetAt: Date.now(),
      gradeAuthority: 'OPERATOR_CONFIRMED',
    },
  };
}

/**
 * CLEAR — removes operator grading authority only. Governing grade
 * immediately returns to the current automated `grade` (resolveGoverningGrade
 * below re-derives this automatically the next time it's called — this
 * function does not touch `grade`/`numericGrade`/modelPredictedGrade* at
 * all, so "the automated grade it returns to" may itself be whatever
 * chooseBetterGrade most recently selected while the override was active
 * (K2/H-4) — never a mutation performed by this function).
 *
 * @returns {object} the patch to spread into the persisted item
 */
export function clearOperatorGrade() {
  return {
    operatorGrade: null,
    operatorGradeNumeric: null,
    operatorGradeSetAt: null,
    gradeAuthority: null,
  };
}

/**
 * Operator correction to the grading FORMAT itself (K1 — a false-positive
 * model isGraded=true on a genuinely raw book). Independent of
 * setOperatorGrade/clearOperatorGrade — an operator can mark format RAW
 * without having entered an operator grade value yet (and vice versa).
 *
 * @param {boolean} isGradedValue
 * @returns {object} the patch to spread into the persisted item
 */
export function setOperatorGradingFormat(isGradedValue) {
  return {
    operatorIsGraded: isGradedValue === true,
    gradingFormatAuthority: 'OPERATOR_CONFIRMED',
  };
}

export function clearOperatorGradingFormat() {
  return {
    operatorIsGraded: null,
    gradingFormatAuthority: null,
  };
}

/**
 * Resolves which grading FORMAT governs pricing/decision — the hierarchy
 * this module's own header documents. Takes a plain item-shaped object
 * (works identically against a catalogue record or an api/enrich.js `out`/
 * req.body-derived object — same field names either way).
 *
 * @param {object} item - { cgcVerified, gradingFormatAuthority, operatorIsGraded, isGraded }
 * @returns {{ isGraded: boolean, source: 'certified'|'operator'|'model' }}
 */
export function resolveGoverningGradingFormat(item) {
  if (item?.cgcVerified === true) {
    return { isGraded: true, source: 'certified' };
  }
  if (item?.gradingFormatAuthority === 'OPERATOR_CONFIRMED') {
    return { isGraded: item?.operatorIsGraded === true, source: 'operator' };
  }
  return { isGraded: item?.isGraded === true, source: 'model' };
}

/**
 * Resolves which grade VALUE governs raw pricing. Deliberately independent
 * of resolveGoverningGradingFormat — callers gate this on
 * `!resolveGoverningGradingFormat(item).isGraded` themselves (Section C:
 * operator raw-grade override is never consulted at all when the
 * governing format is certified/graded). K6 Case D: a preserved
 * operatorGrade with gradeAuthority still OPERATOR_CONFIRMED reactivates
 * automatically the moment governing format returns to RAW — this
 * function doesn't need special-case logic for that, it's the natural
 * result of checking gradeAuthority alone, every time, from scratch.
 *
 * @param {object} item - { gradeAuthority, operatorGrade, operatorGradeNumeric, grade, numericGrade }
 * @returns {{ grade: string|null, numericGrade: number|null, source: 'operator'|'model' }}
 */
export function resolveGoverningGrade(item) {
  if (item?.gradeAuthority === 'OPERATOR_CONFIRMED' && item?.operatorGrade) {
    return { grade: item.operatorGrade, numericGrade: item.operatorGradeNumeric ?? null, source: 'operator' };
  }
  return { grade: item?.grade ?? null, numericGrade: item?.numericGrade ?? null, source: 'model' };
}
