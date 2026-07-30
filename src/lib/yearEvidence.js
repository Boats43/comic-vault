// src/lib/yearEvidence.js
//
// Track B Phase 0, Commit 4.2 — canonical, neutral home for year-
// placeholder detection. Root cause this file closes: Vision can report
// its own year field as the literal string "Unknown" (confirmed live,
// production log: `[year-resolved] Unknown → 2024 (source=pc-cv-agreement)`,
// `[ship28b-conflicts] sources={"vision":"Unknown",...}`) — a truthy,
// non-null string that `?? null` does not intercept, so it was being
// trusted as a real prior year by resolveFamilyYearConsensus
// (identityCore.js), suppressing legitimate family-vote year adoption.
//
// normalizeOptionalYear is the single source of truth for "is this value
// a semantic placeholder, or a real (possibly non-numeric, possibly non-
// string) year value." Deliberately narrow: it answers exactly that one
// question and nothing else — not a validator, not a canonicalizer. Every
// non-placeholder value passes through completely unchanged, same type,
// same value. Two independent consumers share this one definition
// (resolveFamilyYearConsensus's own entry boundary, identityCore.js;
// buildFingerprintYearToken's defense-in-depth, issueAuthority.js) so the
// placeholder list can never drift into two different lists, the exact
// "drifted-duplicate-constant" class this codebase has hit before
// (Q119/Q127/Q128 — see CLAUDE.md's Pattern Library).

const YEAR_PLACEHOLDERS = new Set([
  '', 'unknown', 'unknown year', 'unknown-year', 'n/a', 'na', 'none', '?',
]);

/**
 * @param {*} value - any candidate "year" value from any upstream source
 * @returns {*} `null` when `value` is a semantic placeholder (including
 *   `null`/`undefined` themselves); otherwise the ORIGINAL `value`,
 *   completely unchanged — same type, same content. Never trims,
 *   stringifies, or otherwise touches a non-placeholder value.
 */
export function normalizeOptionalYear(value) {
  if (value == null) return null;
  const comparisonCopy = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (comparisonCopy != null && YEAR_PLACEHOLDERS.has(comparisonCopy)) return null;
  return value;
}
