// src/lib/titleStripStats.js
//
// A6 dispatch (2026-07-26), Scope 2 Option 2 — diagnostic aggregation for
// the [22f] metadata-strip step (compHygiene.js's tokenizeTitle). This is
// the single largest contributor to per-request log volume measured
// across the 5 certification fixtures (70-137+ duplicate lines per
// request, one pair per comp title, often the SAME title logged twice
// when the same tokenizer call runs during both active- and sold-comp
// processing) — the leading suspect for the Flash #128/#139 truncation
// (A6). Default path now emits one summary line per request instead of
// one line per comp title; full per-row detail is opt-in.
//
// Concurrency note, recorded honestly rather than silently assumed away:
// this uses plain module-level state, reset once per request. Under
// Vercel Fluid Compute, a warm function instance can interleave multiple
// concurrent requests' async work on the same module state — two
// requests whose async gaps overlap could, in principle, cross-contaminate
// each other's counts. Accepted as a bounded risk: this is a diagnostic
// log line only, never read by pricing/identity/decision logic, so the
// worst case is a slightly-wrong debug number, not a correctness or
// security issue. AsyncLocalStorage (node:async_hooks) would close this
// gap properly but requires wrapping the entire enrich.js handler body,
// a much larger and riskier change than this diagnostic feature
// justifies today — revisit only if the simple counter is ever observed
// to actually mislead an investigation in practice.
//
// SERVER-CONTROLLED debug flag only (CV_DEBUG_TITLE_STRIP env var) — never
// derived from request body, query string, or any client-supplied value.
// Per-row detail must never be user-toggleable; it can reveal comp-pool
// title text and internal tokenization behavior.

let stats = { rows: 0, changed: 0, unchanged: 0, duplicates: 0 };
let seenThisRequest = new Set();

export const TITLE_STRIP_DEBUG = process.env.CV_DEBUG_TITLE_STRIP === '1';

export function resetTitleStripStats() {
  stats = { rows: 0, changed: 0, unchanged: 0, duplicates: 0 };
  seenThisRequest = new Set();
}

export function recordTitleStrip(before, after) {
  stats.rows += 1;
  if (before === after) stats.unchanged += 1;
  else stats.changed += 1;
  if (seenThisRequest.has(before)) stats.duplicates += 1;
  else seenThisRequest.add(before);
}

export function getTitleStripStats() {
  return { ...stats };
}

export function logTitleStripSummary() {
  if (stats.rows === 0) return;
  console.log(
    `[22f-summary] rows=${stats.rows} changed=${stats.changed} ` +
    `unchanged=${stats.unchanged} duplicates=${stats.duplicates}`
  );
}
