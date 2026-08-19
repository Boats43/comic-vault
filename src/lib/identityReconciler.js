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

// GrailKey Directive 2026-08-16-AO (GK-123) — companion-product exclusion.
// A third known-ineligible shape, found tracing the real wfvvb production
// pool: a companion art-print/portfolio product (not a printed comic edition
// of the item at all) reaching family election and defeating the actual
// physical book on member count alone ("Ariel Diaz Artbook-Venom & Carnage,"
// 3 near-duplicate listings, weight 5.5, beat a single genuine Mayhew
// Separation Anxiety row, weight 5.0, via weighted-consensus — the
// pre-existing Lethal Protector bug had always fired first and masked this
// completely; fixing GK-121 exposed it). Same governing rule as the two
// existing classes above: a listing with no single-COMIC-book identity is
// ineligible, rank/weight has no authority over it. Explicit tokens only
// (art book/artbook, art print, portfolio, sketchbook, poster) — bare "art"
// is deliberately excluded (would false-positive on real comic titles like
// "Art Ops" or "Art of War"). Comic-identity-scoped by construction, not
// merely by convention: isEligibleVisualRow has no assetType parameter and
// is called only from this codebase's comic identity-resolution pipeline
// (selectFirstEligibleVisual, countCorroboratingEligibleRows,
// selectTitleFamilyCandidate's Rule 1/C1 filter) — there is no other asset-
// type pipeline yet (Session 4B's BookAdapter/CardAdapter are roadmap-only,
// unbuilt) that would ever need an artbook to BE the identity target through
// this same function.
export const COMPANION_PRODUCT_RE = /\bart\s*books?\b|\bart\s*prints?\b|\bportfolios?\b|\bsketchbooks?\b|\bposters?\b/i;

// A normal variant cover ("Cover B", "Jim Lee Variant") is NOT rejected by
// any pattern above — it names a specific book. Only a listing with no
// single-comic-book identity at all (a picker, a bundle, a companion
// non-comic product) is ineligible.
export const isEligibleVisualRow = (rawTitle) => {
  const text = String(rawTitle || '');
  if (!text.trim()) return false;
  if (LOT_OR_BUNDLE_RE.test(text)) return false;
  if (VARIATION_GROUP_RE.test(text)) return false;
  const companionMatch = text.match(COMPANION_PRODUCT_RE);
  if (companionMatch) {
    console.log(`[eligibility] reason=COMPANION_PRODUCT token="${companionMatch[0]}" rejected: "${text}"`);
    return false;
  }
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
// attempt to reproduce every existing writer's precedence, only the
// sources this dispatch's integration point ever feeds it.
//
// GrailKey Directive 2026-08-15-AK — 'family-consensus' was split into
// two DELIBERATELY DIFFERENT-PRECEDENCE sources after a real Sabrina-
// shaped fixture proved a single unified 'family-consensus' tier let a
// large GENERIC population (resolveFamilyIssueConsensus's own 'adopted'
// mode — no prior existed, a raw vote filled the gap) outrank a specific,
// corroborated firstEligibleVisual candidate purely on member count, no
// discriminative corroboration, no hard contradiction. The governing
// rule this precedence table must encode: "visual decides what the
// object is; corroboration decides how strongly to stand behind that
// answer; population alone corroborates or contradicts, it never
// REPLACES." A name that reads as generic "consensus" authority is
// exactly how this policy quietly reverts in a future dispatch — the
// split below is deliberately named after WHAT KIND of family evidence
// it is, not merely THAT family evidence exists.
//
//   'family-corroborated'   resolveFamilyIssueConsensus's 'corroborated'/
//                            'conflict-locked'/'unanimous-zero-support-
//                            rescue' modes — each represents a genuine
//                            relationship to an EXISTING prior value
//                            (the family agrees with it, or a locked
//                            contradiction preserves it verbatim — Flash
//                            #139) — never a population vote replacing a
//                            value that was never there to begin with.
//                            Also covers the raw-pool zero-support
//                            OVERRIDE mechanism (ebay.issue adopted when
//                            Vision's own value has zero pool support) —
//                            a separate, already load-bearing, already-
//                            tested mechanism this split does not touch
//                            or reclassify.
//   'first-eligible-visual'  this dispatch's mechanism — the specific,
//                            eligible, corroborated visual candidate.
//   'family-population'      resolveFamilyIssueConsensus's 'adopted' mode
//                            SPECIFICALLY — no prior existed, a family's
//                            own raw member-count vote filled the gap.
//                            Demoted below first-eligible-visual: a pure
//                            population fill may still corroborate (when
//                            it agrees) or be recorded as a disagreeing
//                            conflict, but must not outrank a specific
//                            candidate on count alone. Still usable as a
//                            fallback when no first-eligible-visual
//                            candidate exists at all.
//   'vision'                 Vision's own asserted value, recorded as
//                            conflict evidence when it disagrees.
// GrailKey Directive 2026-08-16-AQ (GK-127) — 'user' added, top precedence.
// An operator-confirmed issue (GK-85's OPERATOR_CONFIRMED, threaded in as
// evidence source='user' by resolveIdentity's opts.issueOperatorConfirmed,
// api/enrich.js's manual-correction re-enrich path) is genuine, independent,
// maximum-weight evidence — the same standing this project already grants
// 'user' for the variant facet (identityCore.js's VARIANT_SOLE_AUTHORITY_
// PRECEDENCE). A lone 'user' entry wins outright; it is demoted to CONTESTED
// (never silently promoted away) only if something else in the evidence set
// still disagrees — visible, never hidden (C1/C3, AQ's own governing rule).
const ISSUE_SOURCE_PRECEDENCE = ['user', 'family-corroborated', 'first-eligible-visual', 'family-population', 'vision'];

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

// ── Year facet (GrailKey Directive 2026-08-17-AT, GK-135) ──────────────
//
// "Year candidates always enter the year evidence set — unconditionally."
// The last legacy hard-gate: resolveYear (identityCore.js) has no path to
// the frozen rank-1 row's own year token, the raw eBay visual pool's own
// year-consensus, or an honest CONTESTED state — it either finds a value
// through its own precedence chain or returns null outright, and null
// there was, until this dispatch, indistinguishable from "no evidence
// exists anywhere" even when the pool the scan itself returned carried a
// year in plain text. reconcileYear does not replace resolveYear (C6's
// own scope: this is the rescue/authority layer for the path resolveYear
// leaves uncovered, not a rewrite of its own already-tested precedence)
// — it is fed the SAME raw signals resolveYear already receives
// (Vision's year, the catalog anchor's year, the pool's own year-
// consensus, the frozen row's own year token, an operator correction)
// as independent evidence, and answers two questions resolveYear's own
// binary output cannot: (1) when resolveYear found nothing, is there
// still an honest candidate elsewhere in the evidence — the true GK-135
// rescue; (2) regardless of whether resolveYear found a value, do the
// independent raw signals actually AGREE — the authority resolveYear's
// own confidence label never separately expressed.
//
// Precedence mirrors ISSUE_SOURCE_PRECEDENCE's own shape (an operator
// correction outranks everything; the frozen row's own physical evidence
// outranks a pool-wide or catalog signal, matching AL/AM's own already-
// established "physical evidence wins outright" rule for this exact
// facet; a genuine pool-wide consensus is stronger than a single
// catalog-anchor's own year, which is itself stronger than Vision's bare
// guess). Same D1/D4 guarantees as reconcileIssue: pure, order-
// independent.
const YEAR_SOURCE_PRECEDENCE = ['user', 'first-eligible-visual', 'pool-consensus', 'catalog', 'vision'];

// GrailKey Directive 2026-08-18-AU (GK-137), 4b, C4 — "CATALOG-source year:
// single-source ceiling" (C4's own wording names catalog specifically, not
// every non-physical source — confirmed against a real conflict found
// regression-testing this fix, see below). Physical/operator sources are
// genuine direct observation and may win CORROBORATED entirely alone,
// matching AL/AM's already-established "physical evidence wins outright"
// rule for this exact facet (unchanged, same list shape as
// VARIANT_SOLE_AUTHORITY_PRECEDENCE above). 'pool-consensus' ALSO stays
// sole-authority-capable — it is not a single, fragile claim the way one
// catalog product-page's embedded year is: poolYearHint (api/enrich.js) is
// already an aggregate computed from >=3 independent raw-pool year mentions
// at >=50% agreement before it ever becomes a candidate at all, so a lone
// 'pool-consensus' entry already represents multi-source agreement, not a
// single opinion. Confirmed by a real pre-existing conflict: this fix's
// first draft put 'pool-consensus' in the SAME non-sole-authority bucket as
// 'catalog', which broke tests/grailkey-directive-at-year-evidence.js's own
// "POST: single, uncontested [pool-consensus] source — CORROBORATED"
// assertion (AT's own prior, deliberate design for that exact source).
// Only 'catalog' and 'vision' are NOT sole-authority: standing completely
// alone, with nothing independently agreeing AND nothing disagreeing, they
// may still win (a real value beats no value) but land CONTESTED, not
// CORROBORATED. Production evidence (ghmn7): confirmedYear=1963 came ONLY
// from PriceCharting's catalog match (justifiedBy=[{catalog:1963}], nothing
// else in the evidence set at all) and still reached CORROBORATED — the era
// filter then hard-rejected the book's own 2022 market against that
// single-source year. This does not touch YEAR_SOURCE_PRECEDENCE (which
// source wins is unchanged) or the existing disagreement handling below
// (still CONTESTED, unchanged) — it only adds a floor under how much trust
// a lone catalog or vision-only source earns.
const YEAR_SOLE_AUTHORITY_PRECEDENCE = ['user', 'first-eligible-visual', 'pool-consensus'];

// reconcileYear — pure, deterministic. Same shape as reconcileIssue:
//   { value, source, authority, justifiedBy, conflicts }
//   authority: 'NONE' | 'CONTESTED' | 'CORROBORATED'
export const reconcileYear = (evidenceSet) => {
  const entries = sortEvidence(evidenceSet?.year || []);
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
  for (const src of YEAR_SOURCE_PRECEDENCE) {
    winner = corroborations.find((e) => e.source === src);
    if (winner) break;
  }
  if (!winner) winner = corroborations[0];

  const disagreeingConflicts = conflicts.filter((c) => String(c.value) !== String(winner.value));
  const disagreeingCorroborations = corroborations.filter(
    (e) => e !== winner && String(e.value) !== String(winner.value)
  );
  const isContested = disagreeingConflicts.length > 0 || disagreeingCorroborations.length > 0;

  // GK-137, C4 — a lone non-sole-authority winner (nothing disagrees, but
  // also nothing independently agrees) is provisional, not fully trusted.
  const isSoleAuthority = YEAR_SOLE_AUTHORITY_PRECEDENCE.includes(winner.source);
  const hasIndependentAgreement = corroborations.some(
    (e) => e !== winner && e.source !== winner.source && String(e.value) === String(winner.value)
  );
  const singleSourceCeiling = !isContested && !isSoleAuthority && !hasIndependentAgreement;

  return {
    value: winner.value,
    source: winner.source,
    authority: (isContested || singleSourceCeiling) ? 'CONTESTED' : 'CORROBORATED',
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
// header). Deliberately not extended to title/publisher/variant/
// creator this dispatch — those facets' existing direct writers are left
// untouched, per the directive's own non-goals ("no complete precedence
// rules", "no deletion of existing producer code"). Year (reconcileYear)
// is a SEPARATE, independently-wired mechanism (GrailKey Directive AT) —
// not folded into this function, since its caller (api/enrich.js) needs
// it at a different point in the pipeline (after PC/CV catalog lookups
// resolve), not alongside the issue facet's own resolveIdentity-time call.
export const reconcileIdentity = (evidenceSet) => ({
  issue: reconcileIssue(evidenceSet),
});

// ── Variant facet (GrailKey Directive 2026-08-16-AL continuation, 4a) ──
//
// GOVERNING MODEL: VALUE != AUTHORITY. first-eligible-visual supplies the
// physical variant candidate; Vision alone is evidence only and cannot
// establish the canonical value by itself; Vision (or any other non-
// sole-authority source) gains canonical standing only with independent,
// applicable corroboration from a DIFFERENT source; a disagreement stays
// conflict evidence forever, never adopted, never erased.
//
// Unlike the issue facet (where raw values are already canonical 4-5
// digit numbers, directly string-comparable), variant text is free-form
// — two entries can describe the SAME physical attribute without matching
// string-for-string ("Mike Mayhew Virgin" vs "Mayhew"). This module stays
// extraction-agnostic (same convention countCorroboratingEligibleRows
// already established above for `extractIssue`) — `valuesAgree` is an
// INJECTED pure comparator, not something this file computes itself. This
// is deliberate, not merely stylistic: imageSearchIdentity.js (the module
// that owns the richest variant-taxonomy classifier) already imports THIS
// file for `isEligibleVisualRow` — importing anything variant-domain-
// specific back from imageSearchIdentity.js here would be a genuine
// import cycle. The default comparator (exact, case-insensitive string
// equality) is intentionally dumb; real callers (identityCore.js's
// reconcileVariantFacet) inject a creator-registry/variant-taxonomy-aware
// comparator built from modules that are safe for THEM to import.
const defaultValuesAgree = (a, b) =>
  a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Sources that may win outright without needing independent agreement
// from a second source — each already represents a genuine, independent
// verification/corroboration mechanism (physical visual evidence, an
// explicit operator correction, a CGC cert lookup, a real eBay pool
// consensus), never a bare, unverified claim. 'vision' (and any other
// source not listed here — edition-warning text, promoted title residue,
// family/publisher routing) is deliberately NOT sole-authority: those
// still require a second, independent source agreeing on the same value
// to be adopted as canonical (the directive's "Vision alone... cannot
// establish canonical value" rule). Order is precedence among sole-
// authority sources when more than one is present and they disagree.
const VARIANT_SOLE_AUTHORITY_PRECEDENCE = ['user', 'first-eligible-visual', 'cgc_cert', 'ebay_image_consensus'];

// reconcileVariant — pure, deterministic, mirrors reconcileIssue's shape
// (value/source/authority/justifiedBy/conflicts). Same D1/D4 guarantees:
// same evidence set in, same result out, regardless of call order.
export const reconcileVariant = (evidenceSet, valuesAgree = defaultValuesAgree) => {
  const entries = sortEvidence(evidenceSet?.variant || []);
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
  for (const src of VARIANT_SOLE_AUTHORITY_PRECEDENCE) {
    winner = corroborations.find((e) => e.source === src);
    if (winner) break;
  }

  // No sole-authority source present. A non-sole-authority claim (e.g.
  // bare 'vision') can still be adopted, but only when a DIFFERENT source
  // independently agrees with it on the same value — a bare, uncorrobo-
  // rated claim is never winnable on its own under this branch.
  if (!winner) {
    for (const candidate of corroborations) {
      const agreeing = corroborations.filter(
        (e) => e !== candidate && e.source !== candidate.source && valuesAgree(e.value, candidate.value)
      );
      if (agreeing.length > 0) { winner = candidate; break; }
    }
  }

  if (!winner) {
    // Every corroboration is a lone, uncorroborated claim — nothing wins.
    // Facet stays unresolved; every claim remains visible as evidence,
    // none of them promoted to canonical (C1/C3: never hidden, never
    // adopted without standing).
    return {
      value: null,
      source: null,
      authority: 'NONE',
      justifiedBy: [],
      conflicts: [
        ...conflicts.map((c) => ({ source: c.source, value: c.value })),
        ...corroborations.map((e) => ({ source: e.source, value: e.value })),
      ],
    };
  }

  const disagreeingConflicts = conflicts.filter((c) => !valuesAgree(c.value, winner.value));
  const disagreeingCorroborations = corroborations.filter(
    (e) => e !== winner && !valuesAgree(e.value, winner.value)
  );
  const isContested = disagreeingConflicts.length > 0 || disagreeingCorroborations.length > 0;

  return {
    value: winner.value,
    source: winner.source,
    authority: isContested ? 'CONTESTED' : 'CORROBORATED',
    justifiedBy: corroborations
      .filter((e) => e === winner || valuesAgree(e.value, winner.value))
      .map((e) => ({ source: e.source, value: e.value })),
    conflicts: [
      ...disagreeingConflicts.map((c) => ({ source: c.source, value: c.value })),
      ...disagreeingCorroborations.map((e) => ({ source: e.source, value: e.value })),
    ],
  };
};

// ── Physical year facet (GrailKey Directive 2026-08-16-AL continuation, 4e) ──
//
// Separates three things Directive AL's trace found conflated into one at
// the N2 re-anchor site: a PHYSICAL year candidate (from the first
// eligible visual row's own raw title, when explicit — independent of
// any catalog match), a CATALOG year candidate (the selected PC anchor's
// own `year` field — a reference/corroboration signal, never itself
// physical-book authority), and the derived year AUTHORITY. A catalog
// candidate must never silently become the physical-year value merely
// because it is the only value a downstream re-anchor step happens to
// have on hand (the Sabrina production bug: N2 re-anchored to a genuinely
// correct 2022 variant candidate, then let that candidate's own catalog
// year become "confirmedYear" outright, discarding the operator's own
// book's real 2024 cover date that was sitting right there in the visual
// pool the whole time).
//
// extractFirstEligibleYearCandidate — companion to extractHashIssueNumber
// above (same file, same "first, not best" discipline: the FIRST plausible
// year token in the row's own raw text, never ranked/scored across
// candidates). Bounded to a realistic comic-publication range (1930-2039)
// so an unrelated 4-digit number (a price, a print-run count, a grade-
// adjacent number) isn't misread as a year.
export const extractFirstEligibleYearCandidate = (rawTitle) => {
  const text = String(rawTitle || '');
  const m = text.match(/\b(19[3-9]\d|20[0-3]\d)\b/);
  return m ? m[1] : null;
};

// reconcilePhysicalYear — pure. Returns { value, source, authority,
// catalogYear, contested }.
//   authority: 'NONE' | 'CATALOG_ONLY' | 'CONTESTED' | 'CORROBORATED'
//   CATALOG_ONLY: no physical candidate exists at all — the catalog year
//     is returned as a usable, but explicitly non-physical-corroborated,
//     value (never silently promoted to CORROBORATED) so callers aren't
//     forced into an outright null when it is genuinely the only signal
//     available. Callers requiring physical confirmation before granting
//     exact-match trust must check authority === 'CORROBORATED' — a
//     CATALOG_ONLY year is a reference, not a confirmed physical fact.
export const reconcilePhysicalYear = (physicalYearCandidate, catalogYearCandidate) => {
  const physical = physicalYearCandidate != null ? String(physicalYearCandidate) : null;
  const catalog = catalogYearCandidate != null ? String(catalogYearCandidate) : null;

  if (physical == null && catalog == null) {
    return { value: null, source: null, authority: 'NONE', catalogYear: null, contested: false };
  }
  if (physical == null) {
    return { value: catalog, source: 'catalog', authority: 'CATALOG_ONLY', catalogYear: catalog, contested: false };
  }
  const contested = catalog != null && catalog !== physical;
  return {
    value: physical,
    source: 'first-eligible-visual',
    authority: contested ? 'CONTESTED' : 'CORROBORATED',
    catalogYear: catalog,
    contested,
  };
};
