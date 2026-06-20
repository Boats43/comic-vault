/**
 * Shared grade utilities for numeric grade extraction and mapping
 * Used by comps.js (grade-proximity filter) and decisionEngine.js (CGC detection)
 */

/**
 * Map raw grade strings to CGC numeric equivalents
 */
export const GRADE_TO_NUMERIC = {
  'GM': 10.0, 'MT': 10.0, 'NM/MT': 9.8, 'NM+': 9.6, 'NM': 9.4, 'NM-': 9.2,
  'VF/NM': 9.0, 'VF+': 8.5, 'VF': 8.0, 'VF-': 7.5,
  'FN/VF': 7.0, 'FN+': 7.0, 'FN': 6.0, 'FN-': 5.5,
  'VG/FN': 5.0, 'VG+': 4.5, 'VG': 4.0, 'VG-': 3.5,
  'GD/VG': 3.0, 'GD+': 2.5, 'GD': 2.0, 'GD-': 1.8,
  'FR/GD': 1.5, 'FR': 1.0, 'PR': 0.5
};

/**
 * Extract numeric grade from grade string
 *
 * Handles multiple formats:
 * - "GD 2.5" → 2.5 (extracts numeric part)
 * - "FN 6.0" → 6.0 (extracts numeric part)
 * - "NM- 9.2" → 9.2 (extracts numeric part)
 * - "GD" → 2.0 (maps grade token to numeric)
 * - "VF" → 8.0 (maps grade token to numeric)
 * - "9.4" → 9.4 (already numeric)
 *
 * @param {string} gradeStr - Grade string from Vision
 * @returns {number|null} Numeric grade or null if unparseable
 */
export function extractNumericFromGrade(gradeStr) {
  if (!gradeStr || typeof gradeStr !== 'string') return null;

  const trimmed = gradeStr.trim();

  // Try to extract numeric part: "GD 2.5" → "2.5"
  const numMatch = trimmed.match(/\b(\d+\.?\d*)\b/);
  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (!isNaN(num)) return num;
  }

  // Fall back to mapping first token: "GD" → 2.0, "NM-" → 9.2
  const firstToken = trimmed.split(/\s+/)[0];
  return GRADE_TO_NUMERIC[firstToken] || null;
}
