// GrailKey Commit V1 — identity-write instrumentation. Log-only, zero
// behavior change.
//
// Single choke point every confirmedTitle/confirmedIssue/confirmedYear/
// confirmedPublisher/confirmedVariant write in api/enrich.js routes
// through, replacing 23 independently-inline assignments with one shared
// logger. Built so a future lock (V2 shadow mode, then V3 enforcement)
// has exactly one function to instrument instead of 23 call sites to
// find and re-audit.
//
// Pure function — no I/O besides console.log, no hidden state, fully
// unit-testable. Always returns `toValue` unchanged: this function NEVER
// changes what gets written, only observes it.
//
// Per Ship #15 architectural rule: pure helper, no HTTP handler, lives in
// src/lib/. api/enrich.js imports it. Does not count toward the 12/12
// Vercel function cap (only files directly under api/ do).

/**
 * Log a write to one of the five confirmed* identity fields, then return
 * the value unchanged (log-only — callers still perform the assignment
 * themselves: `confirmedTitle = writeConfirmed('confirmedTitle', ...)`).
 *
 * @param {string} field - one of confirmedTitle/confirmedIssue/confirmedYear/confirmedPublisher/confirmedVariant
 * @param {*} fromValue - the incumbent value before this write
 * @param {*} toValue - the value being written
 * @param {string|null|undefined} fromSource - provenance of the incumbent value ('unknown' if not tracked)
 * @param {string|null|undefined} toSource - provenance of the new value ('unknown' if not determinable)
 * @param {string} site - short symbol/tag identifying the call site (e.g. 'q141-a', 'Q58-TITLE')
 * @returns {*} toValue, unchanged
 */
export const writeConfirmed = (field, fromValue, toValue, fromSource, toSource, site) => {
  const from = fromValue == null ? '' : String(fromValue);
  const to = toValue == null ? '' : String(toValue);
  const resolvedFromSource = fromSource || 'unknown';
  const resolvedToSource = toSource || 'unknown';

  // Three distinguishable cases per the V1 spec: a genuine value change,
  // a no-op (identical value rewritten — still worth knowing "something
  // touched this" vs "nothing did"), and a fill of a previously-empty
  // field (a future lock must never treat this as a "block" case).
  let marker = '';
  if (from === to) {
    marker = ' noop=true';
  } else if (from === '') {
    marker = ' fill=true';
  }

  console.log(
    `[identity-write] field=${field} ` +
    `from="${from}" (source=${resolvedFromSource}) ` +
    `to="${to}" (source=${resolvedToSource}) ` +
    `site=${site}${marker}`
  );

  return toValue;
};
