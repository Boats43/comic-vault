/**
 * Ship #22c — AXIS VOTING convergence score
 *
 * Computes identity confidence from multi-source voting per axis.
 * Identity tuple: {title, issue, era, publisher}
 *
 * Per-axis source weights (0-100):
 * - TITLE: eBay=90, Vision=85, PC=60, CV=40
 * - ISSUE: eBay=90, Vision=85, PC=60, CV=40
 * - ERA: histogram=90, Vision=70, PC=60, CV=40
 * - PUBLISHER: eBay=90, Vision=85, PC=60, CV=40
 * - GRADE: Vision=100
 *
 * Convergence score: weighted average of per-axis agreement.
 * 90-100 = HIGH (green), 70-89 = MEDIUM (yellow), <70 = LOW (red)
 */

const SOURCE_WEIGHTS = {
  title: { ebay: 90, vision: 85, pc: 60, cv: 40 },
  issue: { ebay: 90, vision: 85, pc: 60, cv: 40 },
  era: { histogram: 90, vision: 70, pc: 60, cv: 40 },
  publisher: { ebay: 90, vision: 85, pc: 60, cv: 40 },
  grade: { vision: 100 },
};

/**
 * Normalize a value for comparison (case-insensitive, trimmed)
 */
function normalize(val) {
  if (val == null) return null;
  return String(val).toLowerCase().trim();
}

/**
 * Compute convergence score for a single axis.
 *
 * @param {string} axis - 'title' | 'issue' | 'era' | 'publisher' | 'grade'
 * @param {Object} sources - { ebay, vision, pc, cv, histogram } with raw values
 * @param {string} confirmedValue - The final resolved value for this axis
 * @returns {Object} { score, votes, winner, rejections }
 */
export function computeAxisScore(axis, sources, confirmedValue) {
  const weights = SOURCE_WEIGHTS[axis];
  if (!weights) {
    throw new Error(`Unknown axis: ${axis}`);
  }

  const confirmed = normalize(confirmedValue);
  const votes = [];
  const rejections = [];
  let totalWeight = 0;
  let agreedWeight = 0;

  for (const [source, weight] of Object.entries(weights)) {
    const rawValue = sources[source];
    const value = normalize(rawValue);

    if (value != null) {
      totalWeight += weight;
      const agrees = value === confirmed;
      if (agrees) {
        agreedWeight += weight;
      }

      votes.push({
        source,
        value: rawValue,
        weight,
        agrees,
      });

      if (!agrees) {
        rejections.push({
          source,
          expected: confirmedValue,
          got: rawValue,
          weight,
        });
      }
    }
  }

  const score = totalWeight > 0 ? Math.round((agreedWeight / totalWeight) * 100) : 0;
  const winner = votes.find(v => v.agrees && v.weight === Math.max(...votes.filter(x => x.agrees).map(x => x.weight)))?.source || 'none';

  return {
    score,
    votes,
    winner,
    rejections,
    totalWeight,
    agreedWeight,
  };
}

/**
 * Compute overall convergence score across all identity axes.
 *
 * @param {Object} identity - { title, issue, era, publisher, grade }
 * @param {Object} sources - Per-axis source values
 * @returns {Object} { convergenceScore, axes, tier }
 */
export function computeConvergenceScore(identity, sources) {
  const axes = {};
  const axisNames = ['title', 'issue', 'era', 'publisher'];
  let totalAxisScore = 0;
  let axisCount = 0;

  for (const axis of axisNames) {
    const confirmedValue = identity[axis];
    if (confirmedValue != null) {
      const axisResult = computeAxisScore(axis, sources[axis] || {}, confirmedValue);
      axes[axis] = axisResult;
      totalAxisScore += axisResult.score;
      axisCount++;
    }
  }

  // Grade axis (optional — only when graded)
  if (identity.grade != null && sources.grade?.vision != null) {
    const gradeResult = computeAxisScore('grade', sources.grade, identity.grade);
    axes.grade = gradeResult;
    totalAxisScore += gradeResult.score;
    axisCount++;
  }

  const convergenceScore = axisCount > 0 ? Math.round(totalAxisScore / axisCount) : 0;

  // Tier: HIGH (90+), MEDIUM (70-89), LOW (<70)
  let tier = 'LOW';
  if (convergenceScore >= 90) tier = 'HIGH';
  else if (convergenceScore >= 70) tier = 'MEDIUM';

  return {
    convergenceScore,
    axes,
    tier,
  };
}

/**
 * Q131 (2026-07-19, Eternus #2 / He-Man class) — a title-family conflict
 * already proven by selectTitleFamilyCandidate (zero token overlap between
 * Vision and the visual pool, explicit 'refused-identity-conflict') must
 * not be contradicted by a HIGH convergence badge computed moments later
 * on the same confirmedTitle. Mirrors the existing visionCapped pattern
 * (api/enrich.js match-confidence demotion) — cap, don't hide: preserve
 * the pre-demotion score/tier for debugging, flag explicitly, never silent.
 *
 * Pure function, extracted for direct regression-testability (same
 * rationale as Q111's applyVariantPreferenceFilter extraction).
 *
 * @param {Object} convergence - result of computeConvergenceScore
 * @param {string|null|undefined} familyDecision - familyCandidate?.decision
 * @returns {Object} convergence, demoted when applicable (new object; input untouched)
 */
export function applyIdentityConflictDemotion(convergence, familyDecision) {
  if (familyDecision !== 'refused-identity-conflict' || convergence.tier === 'LOW') {
    return convergence;
  }
  return {
    ...convergence,
    preDemotionTier: convergence.tier,
    preDemotionScore: convergence.convergenceScore,
    tier: 'LOW',
    convergenceScore: Math.min(convergence.convergenceScore, 69),
    identityConflictDemoted: true,
  };
}
