// src/lib/identityReconciler.js
//
// GrailKey Directive 2026-08-15-AI — visual-first identity authority,
// Slice 1 of 3.
//
// THE DISEASE THIS FILE EXISTS TO STOP: a physical-identity fact with two
// meanings and more than one writer (Detective Comics #1107's split-brain
// confirmedIssue=null / issueNum=1107; Venom's null-vs-confident-#1 false
// binary). See CLAUDE.md "GrailKey Directive 2026-08-15-AI" for the full
// contract this file implements a first slice of (D1-D4, C1-C7).
//
// SLICE 1 SCOPE (deliberately conservative, per the directive's own "no
// complete precedence rules" non-goal):
//   - Eligibility filtering (Rule 1 / C1) is general-purpose and facet-
//     agnostic — usable by any producer that ranks visual-pool rows.
//   - The evidence API (addEvidence/proposeRefinement/reportConflict) and
//     the pure reconciler (reconcileIssue/reconcileIdentity) are wired
//     into the pipeline for the ISSUE facet only (src/lib/identityCore.js,
//     resolveIdentity's new "first-eligible-visual" gap-fill branch — see
//     that file for the integration). Title/year/publisher/variant/creator
//     keep their existing ~37 direct writers untouched this dispatch —
//     that is Slice 2's work, not invented here (see identityCore.js's
//     own scoping note at the integration site for the enumerated count).
//   - reconcileIdentity is pure and deterministic (D1): same evidence set
//     in, same identity out, regardless of the order addEvidence/
//     reportConflict were called in. Evidence is sorted by a stable key
//     (source|value), never by arrival order or timestamp (D4).

// ── Eligibility (Rule 1 / C1) ──────────────────────────────────────────
//
// "The first eligible visual match" requires an eligibility filter to run
// BEFORE any rank/weight-based selection — rank has no authority over a
// row that isn't a single physical-book identity at all. Two known
// ineligible shapes (Task 1 trace, GK-115):
//   - lot/bundle/collection listings (multiple books, no single identity)
//   - seller "variation group" placeholders ("select an issue" / "pick
//     your issue") — a picker, not a book
//
// GK-115 caveat, recorded here deliberately: eBay's Browse API
// itemGroupType/SELLER_DEFINED_VARIATIONS marker is never captured in this
// codebase's parsed visual-pool rows (confirmed via Task 1 trace — grep
// for both strings across api/enrich.js, api/comps.js, imageSearchIdentity.js
// returns zero hits). This is therefore a TEXT-PATTERN heuristic, not a
// structural guarantee — same shape as compHygiene.js's documented
// OTHER_VARIANT_DESCRIPTOR_RE stopgap. Extend VARIATION_GROUP_RE as new
// phrasings are found in production; a genuine fix needs itemGroupType
// actually captured at parse time (GK-115).

export const LOT_OR_BUNDLE_RE = /\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection|huge\s*run)\b|\bset\s*of\s*\d+\b|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b/i;

export const VARIATION_GROUP_RE = /\bselect\s+an?\s+issue\b|\bpick\s+your\s+issue\b|\bchoose\s+(?:your|an?)\s+issue\b|\bselect\s+(?:your\s+)?(?:variant|option)s?\b/i;

// A normal variant cover ("Cover B", "Jim Lee Variant") is NOT rejected by
// either pattern above — it names a specific book. Only a listing with no
// single-book identity at all (a picker, a bundle) is ineligible.
export const isEligibleVisualRow = (rawTitle) => {
  const text = String(rawTitle || '');
  if (!text.trim()) return false;
  if (LOT_OR_BUNDLE_RE.test(text)) return false;
  if (VARIATION_GROUP_RE.test(text)) return false;
  return true;
};

// First eligible row, in the pool's OWN returned order — never array
// index 0 blindly (Fixture 2 / Sabrina: rank 1 is a variation-group
// placeholder, rank 2 is the real book). `rows` is the raw visual-pool
// array (each entry a string or an object carrying rawTitle/title).
export const selectFirstEligibleVisual = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const rawTitle = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || ''));
    if (isEligibleVisualRow(rawTitle)) {
      return { index: i, rawTitle, item };
    }
  }
  return null;
};

// GK-116 (found building this dispatch, logged not fixed at the shared
// site) — identityCore.js's extractIssueCandidate (used by
// resolveFamilyIssueConsensus and everything else that reads a "#N" issue
// token in this codebase, including the Flash #139-protected consensus
// path) caps BOTH its hash-prefixed and bare-number branches at 999 —
// real production books exceed that (Detective Comics' restored legacy
// numbering alone reached #1107 by 2022). Widening that shared cap is out
// of THIS dispatch's scope (19+ dependent test files, unknown blast
// radius on the bare-number branch's year-collision guards) — logged as
// its own finding for a future dispatch. This narrower, hash-only,
// uncapped extractor exists so THIS dispatch's new first-eligible-visual
// mechanism doesn't inherit that cap for the one case it must handle
// (Fixture 1). Hash-prefixed only, deliberately no bare-number fallback:
// "#1107" is unambiguous, but an uncapped bare number ("Batman 1977 con
// exclusive") carries real year-collision risk this narrow extractor
// avoids by never attempting it.
// A conservative subset of identityCore.js's own MARKETING_KEYWORDS_RE,
// deliberately WITHOUT "variant" — a variant-cover descriptor doesn't cast
// doubt on the issue NUMBER the way "anniversary/special/exclusive/
// collector/limited" does (those often signal a renumbered one-shot or
// sub-line where "#1" doesn't mean the ongoing series' actual issue 1;
// "variant" just describes which cover was printed — the Venom fixture's
// "Trade Variant Cover" must not be treated the same as the Adventure
// Time Summer Special/SDCC shape). Found regression-testing against
// tests/q140-coherent-content-token-lane.test.js's Adventure Time fixture
// — this codebase has explicitly, repeatedly ruled an honest null safer
// than adopting a marketing-flavored single-row "#1" for that exact
// shape; this dispatch's new mechanism must respect that same precedent.
const FIRST_ELIGIBLE_MARKETING_RE = /\b(anniversary|special|collector|limited|exclusive)\b/i;
export const isMarketingFlavoredRow = (rawTitle) => FIRST_ELIGIBLE_MARKETING_RE.test(String(rawTitle || ''));

export const extractHashIssueNumber = (rawTitle) => {
  const text = String(rawTitle || '');
  const m = text.match(/#\s*(\d{1,5})(?!\d)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { issue: m[1] };
};

// MINIMUM_CORROBORATING_ROWS — the same >=3-unique-row floor this
// codebase already enforces everywhere an issue gets adopted from
// marketplace rows (resolveFamilyIssueConsensus's own uniqueRows>=3 bar;
// the Wonder Woman #1 / Eternus #2 precedents: "a single representative
// rawTitle can never, by itself, establish an issue," and even 2 unique
// rows at 100% self-agreement is still below the floor). Found
// regression-testing against tests/q131-refused-identity-conflict-
// provisional.test.js's Eternus fixture — a lone first-eligible-visual
// row (or two) is exactly the "too little evidence" shape that floor
// exists to reject; this dispatch's new mechanism must honor the SAME
// floor, not a laxer one of its own. Deliberately a flat row-count, not a
// percentage of the total pool (unlike resolveFamilyIssueConsensus's own
// 60% ratio bar) — a large pool full of unrelated eligible rows (TPB
// listings, apparel, etc.) diluting a percentage would make a genuinely
// strong candidate artificially harder to adopt as pool size grows; count
// alone matches what the cited precedents actually measure.
export const MINIMUM_CORROBORATING_ROWS = 3;

// Counts unique ELIGIBLE rows (lot/variation-group rows excluded, per
// Rule 1) whose own extracted issue equals `issueValue`. Same dedup-key
// preference as resolveFamilyIssueConsensus (identityCore.js): itemId ->
// legacyItemId -> normalized itemWebUrl -> rawTitle text — so duplicate
// listings of the same item, or identical repeated text, never count as
// independent corroboration (the "three identical strings is still 1 row"
// precedent). `extractIssue` is injected by the caller (identityCore.js
// already owns extractHashIssueNumber/extractIssueCandidate; this module
// stays extraction-agnostic so it never needs to duplicate that logic or
// import it back).
export const countCorroboratingEligibleRows = (rows, issueValue, extractIssue) => {
  const list = Array.isArray(rows) ? rows : [];
  const seenKeys = new Set();
  let count = 0;
  const normalizeUrl = (u) => {
    const s = String(u);
    const qIdx = s.indexOf('?');
    return qIdx === -1 ? s : s.slice(0, qIdx);
  };
  for (const item of list) {
    const rawTitle = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || ''));
    if (!isEligibleVisualRow(rawTitle)) continue;
    let dedupKey;
    if (typeof item !== 'string' && item?.itemId) dedupKey = `id:${item.itemId}`;
    else if (typeof item !== 'string' && item?.legacyItemId) dedupKey = `legacy:${item.legacyItemId}`;
    else if (typeof item !== 'string' && item?.itemWebUrl) dedupKey = `url:${normalizeUrl(item.itemWebUrl)}`;
    else dedupKey = `title:${rawTitle}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    const candidate = extractIssue(rawTitle);
    if (candidate?.issue != null && String(candidate.issue) === String(issueValue)) count += 1;
  }
  return count;
};

// ── Evidence API (D1-D4, C5) ───────────────────────────────────────────
//
// Three sanctioned WRITE operations. None of them writes canonical
// identity state — each only appends to an evidence list.
// `reconcileIdentity` is the only function that DERIVES canonical state,
// and it derives it fresh from the complete evidence set every time it is
// called (pure, order-independent). A caller that wants a different
// answer must change the evidence, never poke the result directly.

export const createEvidenceSet = () => ({ issue: [] });

const pushEvidence = (evidenceSet, facet, entry) => {
  const set = evidenceSet || createEvidenceSet();
  if (!Array.isArray(set[facet])) set[facet] = [];
  set[facet].push(entry);
  return set;
};

// A corroborating observation for a facet value.
export const addEvidence = (evidenceSet, facet, source, value, opts = {}) =>
  pushEvidence(evidenceSet, facet, { type: 'corroboration', source, value, ...opts });

// A proposed IMPROVEMENT to a facet value — still evidence, never a direct
// write. (Slice 1: accepted by reconcileIssue identically to a
// corroboration; kept as a distinct type so Slice 2/3 can weight it
// differently without changing every call site.)
export const proposeRefinement = (evidenceSet, facet, source, value, rationale, opts = {}) =>
  pushEvidence(evidenceSet, facet, { type: 'refinement', source, value, rationale, ...opts });

// A DISAGREEING observation. Recording a conflict never erases the
// facet's current candidate value (C3) — it demotes the authority the
// reconciler is willing to assign it.
export const reportConflict = (evidenceSet, facet, source, value, opts = {}) =>
  pushEvidence(evidenceSet, facet, { type: 'conflict', source, value, ...opts });

// Deterministic sort key — excludes arrival order/timestamps entirely
// (D4), so canonical identity cannot depend on the order evidence
// operations were called in.
const evidenceSortKey = (e) => `${e.type}|${e.source}|${String(e.value)}`;
const sortEvidence = (list) =>
  [...list].sort((a, b) => {
    const ka = evidenceSortKey(a);
    const kb = evidenceSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

// Source precedence for the issue facet, highest first. Deliberately
// SHORT and conservative (Slice 1's own contract, D1) — this does not
// attempt to reproduce every existing writer's precedence, only the two
// sources this dispatch's integration point ever feeds it:
//   'family-consensus'      resolveFamilyIssueConsensus's own result,
//                            already computed upstream (adopted/
//                            corroborated/conflict-locked) — when present,
//                            it is authoritative and this reconciler is
//                            not consulted at all (see identityCore.js's
//                            integration comment; Flash #139 safety).
//   'first-eligible-visual'  this dispatch's new mechanism — the fallback
//                            candidate when nothing else resolved a value.
//   'vision'                 Vision's own asserted value, recorded as
//                            conflict evidence when it disagrees.
const ISSUE_SOURCE_PRECEDENCE = ['family-consensus', 'first-eligible-visual', 'vision'];

// reconcileIssue — pure, deterministic. Same evidence set in, same result
// out, regardless of call order (D1/D4).
//
// Returns:
//   { value, source, authority, justifiedBy, conflicts }
//   authority: 'NONE' | 'CONTESTED' | 'CORROBORATED'
//
// CONTESTED means: a candidate value exists (usable to drive further
// research/queries, D3) but at least one independent source disagrees, so
// it must not be treated as confirmed identity. Preservation is not
// promotion (C2) — CONTESTED is strictly weaker than a clean, uncontested
// candidate, never stronger.
export const reconcileIssue = (evidenceSet) => {
  const entries = sortEvidence(evidenceSet?.issue || []);
  const corroborations = entries.filter((e) => e.type !== 'conflict');
  const conflicts = entries.filter((e) => e.type === 'conflict');

  if (corroborations.length === 0) {
    return {
      value: null,
      source: null,
      authority: 'NONE',
      justifiedBy: [],
      conflicts: conflicts.map((c) => ({ source: c.source, value: c.value })),
    };
  }

  let winner = null;
  for (const src of ISSUE_SOURCE_PRECEDENCE) {
    winner = corroborations.find((e) => e.source === src);
    if (winner) break;
  }
  if (!winner) winner = corroborations[0];

  const disagreeingConflicts = conflicts.filter((c) => String(c.value) !== String(winner.value));
  const disagreeingCorroborations = corroborations.filter(
    (e) => e !== winner && String(e.value) !== String(winner.value)
  );
  const isContested = disagreeingConflicts.length > 0 || disagreeingCorroborations.length > 0;

  return {
    value: winner.value,
    source: winner.source,
    authority: isContested ? 'CONTESTED' : 'CORROBORATED',
    justifiedBy: corroborations
      .filter((e) => e === winner || String(e.value) === String(winner.value))
      .map((e) => ({ source: e.source, value: e.value })),
    conflicts: [
      ...disagreeingConflicts.map((c) => ({ source: c.source, value: c.value })),
      ...disagreeingCorroborations.map((e) => ({ source: e.source, value: e.value })),
    ],
  };
};

// reconcileIdentity — Slice 1 covers the issue facet only (see module
// header). Deliberately not extended to title/year/publisher/variant/
// creator this dispatch — those facets' existing direct writers are left
// untouched, per the directive's own non-goals ("no complete precedence
// rules", "no deletion of existing producer code").
export const reconcileIdentity = (evidenceSet) => ({
  issue: reconcileIssue(evidenceSet),
});
