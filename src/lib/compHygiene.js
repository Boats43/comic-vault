// Comic comp hygiene primitives — shared regex + helper set used by both
// active-comp filtering (api/comps.js) and sold-comp verification
// (src/lib/soldVerification.js). Pure functions, no I/O.
//
// Q136 Slice A (2026-07-22) — imports PREMIUM_CREATORS for
// isUnambiguousSurnameAlias (promoted from soldVerification.js below).
// No circular risk: premiumCreators.js has zero imports of its own.
import { PREMIUM_CREATORS } from './premiumCreators.js';
//
// Location note (per Ship #15 architectural learning): this module has no
// HTTP handler so it lives in src/lib/, not api/. api/comps.js and
// api/enrich.js import via `../src/lib/compHygiene.js`. Vercel bundles
// transitively-imported files into each function bundle — no new function
// endpoint added.
//
// Extracted Ship #20a.6 from api/comps.js. Behavior preserved exactly from
// the originals in the same commit; detectSeriesMarkers extended with
// annual-N / special-N / king-size-N / giant-size-N for sold-comp
// format-asymmetry filtering. ARTIST_PATTERNS extended with jeehyung lee /
// alex ross / kaare andrews / fabok for sold-comp variant-artist match.
//
// Ship #22f: Artist/publisher/signature strip extracted to titleHygiene.js
// (single normalize helper for all identity layers).

import { stripMetadataTokens, stripArtistWords } from './titleHygiene.js';
import { TITLE_STRIP_DEBUG, recordTitleStrip } from './titleStripStats.js';

// ────────────────────────────── REGEXES ──────────────────────────────

// Reprint / facsimile / Nth-print / anniversary edition / Marvel
// Milestones / DC Classics Library / etc. F3 extension entries from Tier-0:
// Millennium Edition, Masterworks, reproduction, replica edition, premiere
// edition, archive edition.
// Ship #20a.6.12 — subscription box / promotional edition extensions (12
// patterns): loot crate, funko, previews exclusive, comic block, nerd block,
// geek fuel, box set, collector's box, subscription box, promotional edition,
// convention exclusive, con exclusive. Closes B&B #28 Loot Crate class.
export const REPRINT_RE = /true believers|reprint|facsimile|replica|anniversary edition|2nd\s*p(?:rint|tg)|3rd\s*p(?:rint|tg)|4th\s*p(?:rint|tg)|5th\s*p(?:rint|tg)|second\s*print|third\s*print|fourth\s*print|\bptg\b|millennium edition|dc classics library|marvel milestones|masterworks|reproduction|replica edition|premiere edition|archive edition|loot.?crate|\bfunko\b|previews\s+exclusive|comic\s+block|nerd\s+block|geek\s+fuel|box\s+set|collector'?s?\s+box|subscription\s+box|promotional\s+edition|convention\s+exclusive|con\s+exclusive|^sealed\b/i;

// Slab/grading-organization detection. Requires explicit slab indicator
// (CGC/CBCS/PGX/PSA/EGS/HGA/etc) followed by an optional letter tier and
// numeric grade. Bare "9.4" in a raw seller's self-grade does NOT match.
// Middle (?:ss|signature\s+series|...) catches "CGC SS 9.8" / "CBCS SS 7.0".
// Ship #20a.6.11 — extended to catch CGC-NG / CBCS-NG / no-grade slabs.
export const SLAB_RE = /\b(?:cgc|cbcs|pgx|psa|egs|hga|slab|graded|universal|signature\s+series|verified|qualified)\s*(?:ss|signature\s+series|mt|nm\/mt|nm\+|nm-|nm|vf\/nm|vf\+|vf-|vf|fn\/vf|fn\+|fn-|fn|vg\/fn|vg\+|vg-|vg|gd\/vg|gd\+|gd-|gd|fr\/gd|fr|pr)?\s*(?:\d+(?:\.\d+)?|(?:-\s*)?(?:ng|no\s*grade))/i;

// Graded-only requirement — title MUST mention CGC or CBCS.
export const GRADED_RE = /\bCGC\b|\bCBCS\b/i;

// Q141 — raw-vs-graded title separation, single shared implementation.
// Previously inlined only inside api/comps.js's formal per-attempt filter
// chain (Filter 2); the v0-I emergency fallback chain (era-filter fallback
// for vintage books, guardrail -> title-match -> issue-match -> year-conflict)
// never applied it, so a slabbed listing that survived v0-I's other checks
// could become the pool's sole comp for a raw-copy price (Batman #15
// production case: the only active comp reaching pricing was a "CGC 0.5"
// slab priced against a raw GD 2.0 scan). Extracted here so both call sites
// share one implementation rather than risk drifting copies.
// Q141 — sanitized comps-search query text for the title-family-override
// path (api/enrich.js). A family candidate's rawTitle is a verbatim eBay
// listing title and can carry a grading-service fragment (e.g. "CGC 0.5")
// baked in from whichever pool member won the family vote; that fragment
// then rides straight into the eBay search query text, biasing results
// toward slabbed listings even when pricing a raw copy (Batman #15
// production case). Never search on raw listing text for this path --
// construct from confirmed identity fields only.
export const buildSanitizedComicSearchTitle = (titleBase, issueNum, year) => {
  const t = String(titleBase || '').trim();
  if (!t) return null;
  const iss = String(issueNum || '').trim();
  const yr = String(year || '').trim();
  return [t, iss ? `#${iss}` : '', yr].filter(Boolean).join(' ');
};

export const applyRawGradedSeparationFilter = (items, { rawOnly, gradedOnly, assetType } = {}) => {
  if (!Array.isArray(items) || items.length === 0) return items;
  if (assetType === 'book') return items;
  if (rawOnly) {
    return items.filter((it) => !SLAB_RE.test(String(it?.title || '')));
  }
  if (gradedOnly) {
    return items.filter((it) => GRADED_RE.test(String(it?.title || '')));
  }
  return items;
};

// Variant contamination markers — variant/virgin/foil/ratio/incentive/etc.
// Hard-reject when our book is NOT a variant. Used both as standalone
// filter and as a guard inside creator/artist match.
export const VARIANT_CONTAM_RE = /\bvariant\b|\bvirgin\b|\bfoil\b|\bratio\b|\b1:\d+\b|\bincentive\b|\bnewsstand\b|\bwhitman\b|\bprice\s+variant\b|\btype\s+1|\bexclusive\b|\bsketch\b|\bexcl\.?\b/i;

// Signed / SS / yellow-label / green-label / remarked / autographed.
// Skips bare "SS" (false-positive risk: SS-Squadron, Steel & Soul).
// Multi-word "signature series" catches CGC SS slabs. Blue label omitted
// (= Universal/standard, not signed). COA = Certificate of Authenticity.
export const SIGNED_RE = /\b(?:signed|signature\s+series|autographed?|yellow\s*label|green\s*label|remarked?|COA)\b/i;

// TPB / collected-edition format markers.
export const TPB_MARKER_RE =
  /\b(?:tpb|trade\s*paperback|hardcover|hc|omnibus|compendium|deluxe(?:\s*edition)?|absolute(?:\s*edition)?|treasury(?:\s*edition)?|collected\s*edition|graphic\s*novel|gn)\b/i;

// Track B Phase 0, Commit 4.3 (Matrix A / rider F, 2026-07-30) — extracted
// here, not into imageSearchIdentity.js or identityCore.js, specifically
// because both of those files need to call it and imageSearchIdentity.js
// already imports FROM identityCore.js — putting it in either would create
// a circular import. compHygiene.js is a true leaf module both already
// import from safely. Single source of truth for "is this row a
// lot/reprint/slab/graded/signed/TPB listing" — was previously a local
// closure inside mergeFragmentedTitleFamilies (imageSearchIdentity.js);
// that function now delegates here instead of maintaining its own copy,
// and identityCore.js's new qualified-family-authority predicate reuses
// the identical check — exactly the drifted-duplicate-constant class this
// codebase has been burned by repeatedly (see CLAUDE.md's Pattern
// Library). Same six detectors, same row-title extraction convention
// (rawTitle || title || string item) already used throughout this
// codebase.
export const hasContaminatedMember = (visualItems, indices) => {
  const rows = Array.isArray(indices) ? indices : [];
  for (const idx of rows) {
    const item = visualItems?.[idx];
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (LOT_RE.test(raw) || REPRINT_RE.test(raw) || SLAB_RE.test(raw) ||
      GRADED_RE.test(raw) || SIGNED_RE.test(raw) || TPB_MARKER_RE.test(raw)) {
      return true;
    }
  }
  return false;
};

// Track B Phase 0, Commit 4.3 (Matrix A, 2026-07-30) — extracted from
// selectTitleFamilyCandidate's top-rank-protection branch
// (imageSearchIdentity.js). `familyWeightSum` there is
// item0Family.weightSum — the family containing the visually-FIRST
// (position-ranked, not necessarily weight-ranked) search result — and
// `competingFamilies` is the REST of the pre-sorted-weight-descending
// `scored` array. Because item0Family is picked by POSITION, it can
// legitimately have LESS weight than a competitor; this function answers
// "does the strongest competitor outweigh item0Family by 3x or more?" —
// if so, don't trust the position-based signal over a much larger
// alternative cluster.
//
// CORRECTION (IMPLEMENTATION PACKET HOLD — FINAL NARROW HOLD, item 2,
// 2026-07-30): this function was ORIGINALLY reused verbatim (inverted
// with `!`) as the 4th condition of identityCore.js's qualified-family-
// authority predicate. That reuse was WRONG and, worse, VACUOUS in that
// context — see familyDominatesRunnerUp below for why, and the LAUNCH-
// AUDIT.md Commit 4.3 entry for the full named finding. Left unchanged
// here (its original top-rank-protection call site is correct and
// untouched); do not reuse it for retention-gate dominance again.
export const isCompetingFamilyTooStrong = (familyWeightSum, competingFamilies) => {
  const strongest = Array.isArray(competingFamilies) ? competingFamilies[0] : null;
  return !!(strongest && strongest.weightSum >= familyWeightSum * 3);
};

// Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD — FINAL NARROW
// HOLD, item 2, 2026-07-30) — the CORRECT dominance predicate for
// identityCore.js's qualified-family-authority retention gate. Deliberately
// a NEW, separately-named function rather than a reuse of
// isCompetingFamilyTooStrong above, because the two contexts have opposite
// weight-ordering invariants:
//   - top-rank-protection (isCompetingFamilyTooStrong's real call site):
//     item0Family is picked by POSITION — it can have LESS weight than a
//     competitor. The check is "does a competitor outweigh item0Family by
//     3x?" (competitor >= family * 3).
//   - the retention gate (this function's only call site): `topFamily`/
//     `runnerUp` are literally `scored[0]`/`scored[1]` — by construction,
//     topFamily.weightSum >= runnerUp.weightSum ALWAYS holds here. Under
//     that constraint, isCompetingFamilyTooStrong(top, [runner]) can only
//     ever be true in a degenerate zero-weight case (runner >= top*3
//     requires runner > top, contradicting top >= runner) — i.e. reusing
//     it here, as the first-pass implementation did, is VACUOUS: it can
//     never actually block retention in production. Confirmed as a named
//     finding, not silently patched over — see LAUNCH-AUDIT.md.
// The correct question for retention is the INVERSE relationship: "does
// the SELECTED family dominate the runner-up by 3x?" (top >= runner * 3).
// A runner-up that is present but not overwhelming (e.g. top=9, runner=4)
// must still BLOCK retention under this rule — 9 is not >= 12 — which
// isCompetingFamilyTooStrong could never express given the ordering
// constraint above (runner=4 could never be flagged "too strong" against
// top=9 by that formula). Boundary is inclusive (>=), matching
// isCompetingFamilyTooStrong's own >= convention: top=9, runner=3 exactly
// dominates (9 >= 3*3).
export const familyDominatesRunnerUp = (topWeightSum, runnerUpWeightSum) => {
  if (runnerUpWeightSum == null || !(runnerUpWeightSum > 0)) return true; // no real competitor — nothing to dominate
  return topWeightSum >= runnerUpWeightSum * 3;
};

// Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD — FINAL NARROW
// HOLD, item 1, 2026-07-30) — current-request family MEMBERSHIP
// precondition for identityCore.js's qualified-family-authority retention
// gate. Distinct from the four evidence-quality conditions (title-axis-
// only block, coherence floor, contamination screen, dominance margin):
// this is a precondition that must hold BEFORE any of those are even
// evaluated, or before resolveFamilyIssueConsensus/resolveFamilyYearConsensus
// ever measure the family. Guards against a stale/foreign family object —
// one whose topFamily.indices don't actually belong to the CURRENT
// request's visualItems (e.g. carried over from a different/prior scan) —
// slipping through on the strength of a coincidentally-satisfied count/
// weight/contamination check alone. Fails closed (returns false) on any
// structural mismatch:
//   - visualItems must be an array
//   - indices must be an array
//   - indices.length must equal expectedCount (the family's own claimed count)
//   - every index must be a unique integer (no duplicates)
//   - every index must be in bounds (0 <= idx < visualItems.length)
//   - every referenced row must actually exist (visualItems[idx] != null)
export const hasValidFamilyMembership = (visualItems, indices, expectedCount) => {
  if (!Array.isArray(visualItems)) return false;
  if (!Array.isArray(indices)) return false;
  if (indices.length !== expectedCount) return false;
  const seen = new Set();
  for (const idx of indices) {
    if (!Number.isInteger(idx)) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
    if (idx < 0 || idx >= visualItems.length) return false;
    if (visualItems[idx] == null) return false;
  }
  return true;
};

// 2026-07-18 (Uncanny X-Men #27 / Ultimate X-Men #1 Momoko class) — stricter
// sibling of TPB_MARKER_RE for use BEFORE a title is known (identity
// determination), not after (comp-pricing pool). TPB_MARKER_RE's "absolute"/
// "deluxe"/"treasury" are deliberately bare-word-optional-suffix so a
// confirmed book's pricing pool catches "Batman Absolute Edition" reprints —
// safe there because the title is already resolved. Applied to an
// UNRESOLVED identity pool, that same looseness collides with real ongoing
// single-issue titles ("Absolute Batman", DC's 2024+ line) and would filter
// out every genuine comp for that book. Requires the edition suffix on all
// three ambiguous terms; tpb/trade paperback/hardcover/hc/omnibus/compendium/
// collected edition/graphic novel/gn have no such collision risk and are
// unchanged.
export const IDENTITY_TPB_MARKER_RE =
  /\b(?:tpb|trade\s*paperback|hardcover|hc|omnibus|compendium|deluxe\s*edition|absolute\s*edition|treasury\s*edition|collected\s*edition|graphic\s*novel|gn)\b/i;

// Premium-variant isolation markers (2026-07-18, Magik #1 / Silk #1 class) —
// convention-exclusive, retailer-exclusive, virgin, and numbered/limited
// print runs are a distinct, often significantly more valuable market
// segment than a generic variant cover. Used by comps.js Filter 1c to
// isolate a thin matching pool rather than blending it with generic
// variant comps (the app already handles thin pools gracefully elsewhere —
// Ship #13.1 thin-pool anchor — so isolating is preferred over blending).
export const PREMIUM_VARIANT_RE =
  /\b(nycc|sdcc|c2e2|megacon|fan\s*expo|eccc|wondercon|emerald\s*city|exclusive|virgin|limited|numbered|ltd)\b/i;

// Other-cover-letter detector. When our book is Cover A (or has no cover
// letter), this matches Cover B/C/D/E... in listing titles for hard reject.
export const OTHER_COVER_RE = /\bcover\s*[b-z]\b|\bcvr\s*[b-z]\b/i;

// Q108 CHANGE 3 — named non-letter variant descriptors. OTHER_COVER_RE only
// catches LETTERED covers (Cover B/C/D); many modern variants (card stock,
// foil, sketch, virgin, trade dress, or a named artist's card-stock cover)
// carry no letter at all and slip straight through it (Wonder Woman #75 /
// Flash #75 class: Frison/Manapul card-stock listings priced against a
// Cover A scan). Applied the same way as OTHER_COVER_RE — hard reject when
// our own confirmedVariant is null/Cover-A/1st-print.
//
// STOPGAP, not a permanent design: artist names ("frison") can't live in a
// static regex forever — new named variants ship every week. Extend this
// list as new patterns emerge in production (see CLAUDE.md); the long-term
// fix is a variant-type classifier, not a name list.
export const OTHER_VARIANT_DESCRIPTOR_RE =
  /\bcard\s*stock\b|\bcardstock\b|\bfrison\b|\bfoil\s*cover\b|\bsketch\s*cover\b|\bvirgin\s*cover\b|\btrade\s*dress\b|\bblank\s*cover\b/i;

// GL-4 (EX-1b) — Merchandise hard filter. eBay Browse returns non-comic
// items ("ACTION COMICS #33 COVER PRINT", "Metal Tin Sign") that pass
// title-overlap (publisher words are stop-words) and issue-number checks —
// two merch actives averaging $18.23 capped a 10-sold tier-2.5 price at
// $24.62 (vfjpp-1783797090560). Explicit phrases where a bare word would
// collide with comic vocabulary: "art/cover print" (never bare \bprint\b —
// collides with 1st/2nd print).
//
// Q89 (2026-07-12): short merch tokens with compound comic-vocabulary
// collisions get context guards. \bpin\b's (?!-?up) lookahead missed the
// SPACE-separated forms — "pin up cover"/"pin ups" matched and rejected
// 4 real Evil Ernie #1 comps (pool starved → tier-4 $234.49 on an $8
// book). Audit of the same class: "mug" collides with "mug shot" covers;
// "sticker" collides with defect descriptions ("price sticker", "sticker
// residue"). "patch" is a homonym (Wolverine alias), not a compound —
// no adjacent-word guard can separate it; residual risk stands per the
// 2026-07-11 ruling.
export const MERCH_RE =
  /\b(?:art\s+print|cover\s+print|poster|tin\s+sign|metal\s+sign|plaque|magnet|statue|figur(?:e|ine)s?|funko|t-?shirts?|canvas|postcard|lithograph|keychain|patch|bookmark)\b|\bmugs?\b(?!\s*shot)|(?<!price\s)\bstickers?\b(?!\s*(?:residue|damage))|\bpins?\b(?!\s*-?\s*ups?\b)/i;

// Lot / set / bundle / multi-book markers. Excludes bare issue-number
// ranges (e.g. "#1-5") which are validated separately by isValidIssueRange
// to avoid false positives on year ranges ("1961-10 Cents") or grade
// fractions in titles ("9.5/10").
export const LOT_RE =
  /\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection)\b|\bset\s*of\s*\d+\b|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b/i;

// Half-issue / ashcan / promo markers. Tightened: `#` prefix REQUIRED on
// the `#N/M` and `#N.M` alternations — otherwise grade strings like "9.4"
// or date strings like "9/2026" would falsely match.
export const HALF_ISSUE_RE =
  /#\s*\d+\s*\/\s*\d+\b|#\s*\d+\.\d+\b|\b½\b|\bhalf[-\s]*issue\b|\b1\/2\s*issue\b|\bashcan\b|\bpromo(?:tional)?\b/i;

// Coverless / incomplete / no-cover markers. Ship #20a.6.11 — Sensation #1
// Crowley 9.4 case where "Sensation Comics #11 CGC-NG COVERLESS" passed all
// filters and poisoned the floor. Hard-reject unless our book is also
// coverless (which it never is in the standard grading flow).
export const COVERLESS_RE =
  /\b(?:coverless|no\s*cover|cover\s*missing|incomplete|damaged\s*cover)\b/i;

// Trading card / non-comic format markers. Ship #20a.6.13 — Avengers #20
// (2025) sold pool contaminated by "Marvel Fleer Ultra Avengers 2022 Base
// Card #20 Elektra" trading card sales. PriceCharting API includes
// `&type=comic` parameter but still returns trading card products for some
// queries. Downstream filter required. Closes Avengers #20 trading-card class.
// Extended to include Impel, Marvel Universe, Series I/II/III, Score, Leaf, etc.
export const TRADING_CARD_RE =
  /\b(?:fleer|upper\s*deck|topps|panini|skybox|impel|score|leaf|pro\s*set|press\s*pass|stadium\s*club|finest|chrome|marvel\s*universe|base\s*card|trading\s*card|insert\s*card|parallel|chase\s*card|series\s*[ivx]+|card\s*#\d+)\b/i;

// Cover artist patterns — used both for active-comp creator filter
// (api/comps.js Filter 3b) and sold-row variant-artist matching
// (Ship #20a.6 soldVerification). Multi-word patterns FIRST so first-
// match-wins via break captures the longer name before generic single-
// word fallbacks (e.g. /jim lee/ wins over /lee/).
//
// Ship #20a.6 added 4 patterns at the END (after the original 36) so
// first-match-wins ordering is preserved for all original entries:
// jeehyung lee, alex ross, kaare andrews (multi-word, but appended
// after the original multi-word block — they only fire when no original
// pattern matches), fabok (single-word). Active-comp callers will pick
// these up when scanning cover-credit variant strings; the same array
// drives sold-comp variant-artist mismatch detection.
//
// Ship #20a.6.18 added 9 patterns: mico suayan (Crow Dead Time class),
// puppeteer lee, derrick chew, jonboy meyers, kael ngu, natali sanders,
// kendrick lim, lucio parrillo (multi-word); ejikure (single-word).
export const ARTIST_PATTERNS = [
  // Multi-word patterns — longest-first wins via break in callers, so
  // multi-word entries MUST come before single-word fallbacks (e.g.
  // /alex ross/ before /ross/, /jeehyung lee/ before /lee/).
  // Original 8 multi-word + Ship #20a.6 added /jeehyung lee/, /alex ross/,
  // /kaare andrews/. Ship #20a.6.7c added /alan quah/.
  // Ship #20a.6.18 added 8 multi-word below.
  /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i,
  /frank cho/i, /frank miller/i, /windsor.?smith/i, /dell'?otto/i,
  /jeehyung lee/i, /alex ross/i, /kaare andrews/i, /alan quah/i,
  /mico suayan/i, /puppeteer lee/i, /derrick chew/i, /jonboy meyers/i,
  /kael ngu/i, /natali sanders/i, /kendrick lim/i, /lucio parrillo/i,
  /jenny frison/i,  // Q84 — WW #75 cover artist (unambiguous, alias policy)
  /guillem march/i,  // Q129 — Harley Quinn #62 cover artist. Multi-word ONLY,
  // deliberately no bare /march/i single-word fallback below — "March" alone
  // collides with the calendar month (solicitation dates, "March 2019", the
  // eBay item's own listing month), unlike the short, distinctive surnames
  // that get a safe bare fallback elsewhere in this list.
  /john giang/i,  // Q130 — One World Under Doom #1 MegaCon Secret Drop artist.
  // Collision-swept (Q130 dispatch): "giang" is not a substring of any
  // common English word and doesn't collide with any existing pattern in
  // this file; bare "john" alone would be unsafe (too common), same reason
  // every other multi-word entry here leads with the full name.
  /kyuyong eom/i,  // Q133 Slice 1b — Invincible #1 MegaCon exclusive artist.
  // Collision-swept: "eom"/"kyuyong" aren't substrings of any common
  // English word or existing pattern in this file. Multi-word form covers
  // every real pool spelling ("Kyuyong Eom", "Kyu Yong Eom" fails this
  // exact regex but still hits the bare surname fallback below).
  /alexander lozano/i,  // Q136 Slice A — Pop Kill #1 MegaCon "Naughty" metal
  // exclusive artist. Collision-swept: "lozano" is not a substring of any
  // common English word or existing pattern in this file.
  /brett booth/i,  // Track B Phase 0, Commit 4.1 review round (item 2) —
  // the Spawn #351 Cover C Virgin variant checkpoint found this artist
  // entirely absent from this registry. Multi-word ONLY, deliberately no
  // bare /booth/i single-word fallback below — "booth" is common non-artist
  // usage in this domain ("convention booth," "artist alley booth," "photo
  // booth"), same reasoning already applied to /guillem march/i and
  // /john giang/i above.
  // Single-word — original 28 + Ship #20a.6 /fabok/ + Ship #20a.6.18 /ejikure/ + Ship #20a.6.21 modern variant artists.
  //
  // Q131 systemic-audit follow-up (2026-07-19, One World Under Doom #1 /
  // "lim" class) — every single-word entry below is now \b-anchored.
  // Confirmed real, live bug: bare /lim/i (Kendrick Lim) matched as a
  // substring inside the ordinary word "limited" — appearing in
  // confirmedVariant's own classified-token text ("...limited signed
  // virgin") wherever a listing said "Limited to 500" — and because the
  // consumer loops (api/comps.js's artist-specific query builder,
  // variantIdentity.js's extractArtist, imageSearchIdentity.js's
  // extractPoolArtistTokens) all use first-match-wins-then-break over
  // this exact array, that false match short-circuited before every
  // pattern positioned after it — chew, ngu, sanders, frison, giang —
  // ever got a chance, regardless of whether the real artist's name was
  // also present in the same string. Same root-cause class as "ngu"
  // matching inside "penguin" or "ross" matching inside "crossover"/
  // "embossed" — none of these are hypothetical, all three are real
  // English/comic-marketing words. Multi-word patterns above are left
  // unanchored (lower collision risk — a 2-3 word phrase colliding with
  // unrelated running text is far less likely than a 3-4 letter
  // fragment), consistent with the narrow scope of this pass.
  /\bskan\b/i, /\brapoza\b/i, /\bquash\b/i, /\bmomoko\b/i, /\bross\b/i, /\badams\b/i,
  /\bkirkham\b/i, /\bbean\b/i, /\bandolfo\b/i, /\bbrowne\b/i, /\bforstner\b/i,
  /\bhoward\b/i, /\bcorona\b/i, /\bstegman\b/i, /\bottley\b/i,
  /\bjimenez\b/i, /\bmcfarlane\b/i, /\bcampbell\b/i, /\bartgerm\b/i, /\bnakayama\b/i,
  /\bhughes\b/i, /\bbyrne\b/i, /\bperez\b/i, /\bkirby\b/i, /\bditko\b/i, /\bmele\b/i,
  /\balbuquerque\b/i, /\bhama\b/i, /\bfabok\b/i, /\bejikure\b/i,
  /\bgleason\b/i, /\bquah\b/i, /\bparrillo\b/i, /\bmaer\b/i, /\blim\b/i, /\bchew\b/i, /\bngu\b/i, /\bsanders\b/i,
  /\bfrison\b/i,  // Q84 — unambiguous last name (alias policy)
  /\bgiang\b/i,  // Q130 — unambiguous last name, collision-swept (alias policy)
  /\beom\b/i,  // Q133 Slice 1b — unambiguous last name, collision-swept (alias policy).
  // Catches bare "EOM" (no first name) and "Kyu Yong Eom" (3-word spelling
  // variant the multi-word /kyuyong eom/i pattern above doesn't match).
  /\blozano\b/i,  // Q136 Slice A — unambiguous last name, collision-swept (alias policy).
];

// Track B Phase 0, Commit 4.1 review round (items 2/3 investigation) —
// ARTIST_PATTERNS carries two coupled responsibilities that don't always
// agree: (1) RECOGNIZE an artist for display/query/gate purposes (every
// consumer of ARTIST_PATTERNS needs this for every entry — extractArtist
// here, extractPoolArtistTokens/tokenizeTitleFamily's own match in
// imageSearchIdentity.js, variantIdentity.js's local extractArtist,
// api/comps.js's artist-specific query builder); (2) tokenizeTitleFamily
// (imageSearchIdentity.js) ALSO destructively STRIPS every match before
// title-family clustering (the Q-BC/Black Cat/Skottie Young fix — a
// variant-cover artist named in nearly every pool listing must not fuse
// into the family's own consensus title). Those two responsibilities are
// appropriate together for a WIDELY-SHARED variant-cover artist (Skottie
// Young on Black Cat #1 — stripping is correct, the name would otherwise
// dominate the token-consensus vote) but WRONG for an artist whose name is
// one of very few surviving distinguishing tokens on an otherwise-sparse
// listing (Brett Booth on Spawn #351 Cover C — confirmed by direct
// execution: stripping it collapsed two genuinely-#351 rows into an
// over-generic bare "spawn" token bucket, indistinguishable from unrelated
// #300 McFarlane-variant rows in the same real production pool, which then
// correctly failed the pre-existing issue-contradiction merge gate and
// prevented a merge that should have succeeded).
//
// This Set is the SINGLE, explicit, auditable opt-out from stripping
// specifically — ARTIST_PATTERNS itself is untouched (still one canonical
// detection registry, every consumer above still sees every entry).
// DEFAULT PRESERVES CURRENT BEHAVIOR: every pre-existing ARTIST_PATTERNS
// entry is absent from this set and therefore still stripped by
// tokenizeTitleFamily exactly as before this commit — no global default
// flip. 'brett booth' is the ONLY member added this commit.
export const ARTIST_FAMILY_STRIP_EXCEPTIONS = new Set(['brett booth']);

// Q89-CACHE — Comp-filter version. Bump whenever a comp-admission filter
// (MERCH_RE, LOT_RE, SLAB_RE, …) changes behavior — OR, per Q129, when
// fetchComps' cached RETURN SHAPE gains a new field a customer-grade
// I13 annotation depends on: cached ACTIVE pools are the full fetchComps
// result object, stored and replayed verbatim (Q92), so a stale pool
// written by pre-change code is missing that field entirely, not just
// carrying a wrong value for it — a silent I13 omission for up to
// KV_TTL.ACTIVE (1h), invisible until the cache naturally expires. Salts
// the ac: KV key and gates the book-record cache in api/enrich.js.
// v2 = Q89 MERCH_RE pin/mug/sticker guards (2026-07-12).
// v3 = Q129 (2026-07-19) — variantCompsExcludedByEra added to fetchComps'
// return object (Harley Quinn #62 Guillem March Cover C class). The
// admitted comps themselves are unchanged by this fix (same era-filter,
// same tolerance) — only new diagnostic metadata was added — but a cache
// entry written before this shipped has no such field to replay, so the
// warning would silently never appear for any book whose comp pool was
// cached in the hour before deploy, with no natural way to distinguish
// that from "the detector correctly found nothing to flag."
// v4 = Q131 (2026-07-19) — ARTIST_PATTERNS word-boundary anchoring
// (5506d87, "lim" matching inside "limited" class). This changes WHICH
// comps a query/AND-match can admit (a different artist-specific query,
// a different Filter 1c token set), not just a diagnostic field — the
// same class of gap Q89's MERCH_RE bump closed, missed here because
// this fix landed in ARTIST_PATTERNS without also bumping this constant.
// Confirmed live: One World Under Doom #1 (John Giang) rescanned on the
// 5506d87 build and still replayed a pre-fix cache entry (`ac:v3:one
// world under doom|1`, written by build c3c8353's "lim virgin" query)
// for the full 1h TTL — the fix was correct but never got a chance to
// run. A skipCache-bypassed live re-fetch (Q131 verification) confirmed
// the fix resolves correctly once it actually executes: 18 genuine John
// Giang comps ($12.99-$150, avg $63.85) vs. the stale cached single
// Inhyuk Lee comp ($14.99). Every ARTIST_PATTERNS/variant-matching
// change should bump this constant going forward — it's the general
// class, not a one-off.
// v5 = Q136 Slice A (2026-07-22) — Alexander Lozano added to ARTIST_PATTERNS;
// new artist-preference narrowing tier changes which comps Filter 1c admits.
// v6 = Slice C (2026-07-22) — signed/autographed promoted from a pure reject
// filter to a match dimension (applySignedPreferenceFilter, Filter 2b) —
// changes WHICH comps a signed book's pool isolates to, same class of gap
// as v4/v5 above. Confirmed live: One World Under Doom #1 (John Giang
// MegaCon Secret Drop) rescanned on the Slice-C build and still replayed
// the pre-fix `ac:v5:one world under doom|1` cache entry (11-listing signed
// Giang pool collapsed to the same 1-comp snapshot from before this fix
// shipped) for the full 1h TTL — same failure shape as the v3→v4 incident
// on this exact book, this time from forgetting the bump rather than the
// fix itself being wrong.
// v7 = Slice C follow-up (2026-07-22) — deploying the v6 build alone does
// NOT clear the Redis-backed `ac:` KV cache; a rescan on the v6 build was
// due to replay the SAME `ac:v6:one world under doom|1` entry (written
// ~15:57 UTC, 3600s TTL) that never actually ran the new signed-isolation
// logic. Bumped again so the next rescan is a genuine `ac:v7:` MISS,
// forcing a fresh fetchComps pass through the fix rather than a stale hit.
// v8 = Q144 Item 1 (2026-07-22, Adventure Time Summer Special class) —
// extractIssueFromTitle's canonical-title exemption + filterItemsByIssue's
// canonical-title recovery param change comp-relevant behavior (which
// items reach extractConfirmedVariant's consensus computation). A v7 HIT
// would replay a pre-fix cached comp pool and be inconclusive per
// invariant 9 — this bump forces a genuine ac:v8 MISS on the next scan.
// v9 = Commit A (2026-07-28, Batman #15 CGC-machine-gun-title class) —
// api/enrich.js now projects confirmedTitle from an accepted PC anchor's
// own clean product name (projectCanonicalTitleFromAnchor, identityCore.js)
// instead of leaving it as whatever title-family clustering assembled. The
// active-comps cache key (`ac:v${COMP_FILTER_VERSION}:${confirmedTitle}|...`)
// is keyed on this exact string — a pre-v9 entry keyed on the OLD polluted
// title ("batman machine gun|15") is naturally orphaned by the new key
// ("Batman|15") for any PC-anchor-matched book scanned again, but the
// version bump is still applied per this codebase's standing invariant 9
// (fresh-MISS before any cache-dependent verdict) rather than relying on
// the key-string difference alone to guarantee it in every case.
export const COMP_FILTER_VERSION = 9;

// Q132 dispatch (2026-07-20) — single source of truth for "the title-family
// override actually succeeded" (as opposed to 'fallback-vision', returned
// both when no override was attempted and when Q84 blocked one). Consumed
// by identityCore.js's resolveIdentity title-override branch and
// api/enrich.js's variant-source-narrowing (Ship 26.3B) and
// year-conflict-resolution checks — three independent call sites that
// each kept their own inline copy of this exact array before this fix,
// the same "drifted duplicate constant" class this session already found
// twice elsewhere (Q119 title whitelists, Q128 era-year tolerances).
export const FAMILY_OVERRIDE_DECISIONS = ['top-rank-protection', 'weighted-consensus'];

// Q85 — Compact title key: lowercase, strip everything non-alphanumeric.
// Equality fallback for compound/spacing/hyphen variants that token-level
// matching can never reconcile ("Funnybook" vs "Funny Book" vs
// "Funny-Book" all → "funnybook"). Used by title-family overlap and PC
// product matching.
export const compactTitleKey = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ───────────────────────── TOKEN-BASED HELPERS ─────────────────────────

// Stop-words excluded from title-similarity tokens. These appear so
// commonly across comic listings (publisher names, format words, common
// English particles) that matching on them produces noise. Stay in the
// eBay search query — only similarity-match step ignores them.
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or',
  'in', 'on', 'at', 'to', 'for', 'with',
  'comic', 'comics', 'comicbook', 'issue', 'volume', 'vol',
  'marvel', 'dc', 'image', 'dark', 'horse', 'idw',
]);
export const MIN_TOKEN_LEN = 2;

// Q54: Compound whitelist + single-letter guard. Certain hyphenated titles
// (X-Men, Marvel Tales/Age/Premiere/Team-Up/Two-in-One/Spotlight/Feature/Fanfare,
// TaleSpin, Walt Disney) reduce to single-letter or stop-word tokens after
// normalization. Preserve them as canonical forms BEFORE tokenization splits.
// X-Men #44 class: "x-men" → ["x", "men"] → "x" stripped by MIN_TOKEN_LEN=2
// → ["men"] → cross-series contamination (Men of War, X-Men Adventures).
//
// Q120 dispatch (2026-07-19, Captain Marvel #17 class) — was ALSO missing
// "captain marvel"/"ms. marvel" (a SEVENTH independently-drifted copy of
// the same underlying fact Q119 consolidated, found under yet another
// name — this Set predates that sweep and wasn't grepped for since it
// isn't named PUBLISHER_IN_TITLE_SERIES/COMPOUND_TITLE_WHITELIST/
// PUBLISHER_NAMES). Entries added here literally rather than imported
// from identityCore.js's canonical COMPOUND_TITLE_WHITELIST deliberately —
// identityCore.js already imports COMPOUND_WHITELIST FROM this file, so
// importing back would create a direct 2-file cycle (tighter than the
// 3-file cycle titleHygiene.js's stripMetadataTokens fix accepted, which
// only closes through a function-body reference, not a module-eval-time
// one). compHygiene.js is intentionally kept dependency-free — it's the
// foundational module the other two import from. This is real, live
// architecture debt: a fifth/sixth/seventh copy's worth of the same list,
// now duplicated for a real, documented reason rather than by oversight.
// Reconciling all of these onto one true source would need a genuine
// restructure (e.g. a lower-level shared module beneath all three) — not
// attempted here, flagged for a future dedicated pass.
export const COMPOUND_WHITELIST = new Set([
  'x-men', 'x-force', 'x-factor',  // single-letter lead
  'marvel tales', 'marvel age', 'marvel premiere', 'marvel team-up',
  'marvel two-in-one', 'marvel spotlight', 'marvel feature', 'marvel fanfare',
  'talespin', 'walt disney',  // thin-token titles
  'captain marvel', 'ms. marvel', 'ms marvel',  // Q120
]);

// Q42 C-A3: Abbreviation expansion map (single source of truth).
// Applied BEFORE tokenization in comp verification path (compHygiene →
// soldVerification issueMismatch) AND conflict detection (conflictDetector).
//
// TMNT failure: Vision "Teenage Mutant Ninja Turtles Adventures" vs comps
// "TMNT Adventures #4" → tokens ["teenage", "mutant", "ninja", "turtles"]
// vs ["tmnt"] → 0% overlap → 0/30 kept (100% issueMismatch rejection).
export const ABBREV_MAP = {
  'tmnt': 'teenage mutant ninja turtles',
  'asm': 'amazing spider man',
  'ff': 'fantastic four',
  'jla': 'justice league',
  'mwom': 'mighty world of marvel',
  'gsx': 'giant size x men',
  'dd': 'daredevil',
  'xm': 'x men',
};

// G.O.D.S. dispatch (2026-07-22, One World Under Doom class) — every
// tokenizer in this codebase that strips punctuation to whitespace before
// a length floor (MIN_TOKEN_LEN or an equivalent local `>= 2`/`> 1`/`> 2`
// check) shares one structural bug: a punctuated acronym ("G.O.D.S.",
// "S.W.O.R.D.", "W.E.B.", "A.X.E.") decomposes into isolated single-letter
// tokens once the punctuation becomes whitespace, and every one of those
// single-letter tokens then falls below the length floor and is dropped —
// the acronym contributes ZERO tokens to whatever comparison consumes the
// tokenized output. Confirmed live: PriceCharting anchored "G.O.D.S.: One
// World Under Doom #1 (2025)" against a pool that is genuinely the plain
// "One World Under Doom #1" — pcMatchConflictsWithPoolName never saw
// "G.O.D.S." at all, only "one world under doom", which fully overlaps
// the real pool.
//
// Fix: collapse a punctuated acronym into ONE joined token BEFORE any
// consumer's own strip-to-whitespace regex runs, so "G.O.D.S." and its
// spaced variant "G. O. D. S." both become "GODS" — a real token that
// survives every existing length floor unchanged. Deliberately NOT a
// MIN_TOKEN_LEN change (that would let through unrelated single-character
// noise tokens everywhere else) — this only touches the specific
// punctuated-letter-run shape.
//
// Regex requires >=2 dotted letter units (a MANDATORY first "X." plus at
// least one MORE "X." unit, each optionally preceded by whitespace) before
// an OPTIONAL final bare letter (no trailing period — "G.O.D.S" without a
// closing dot, common when the acronym is immediately followed by a colon
// or another word). The >=2 floor is deliberate: a single "X." followed by
// an ordinary word ("A. Smith", "Dr. Strange", "Vol. 2") must NOT collapse
// — "Dr."/"Vol." aren't even single-letter units (two+ letters before the
// period), and a lone "A." has nothing after it to join with once the
// next word fails the dotted-unit test. Verified against both false-
// positive candidates and genuine short acronyms ("G.I. Joe" → "GI Joe").
export const normalizeAcronyms = (text) => {
  if (!text) return text;
  return String(text).replace(
    /\b[A-Za-z]\.(?:\s?[A-Za-z]\.){1,}(?:\s?[A-Za-z]\b)?/g,
    (match) => match.replace(/[.\s]/g, '')
  );
};

// G.O.D.S. dispatch — companion to normalizeAcronyms. Recovering the
// acronym as an ordinary token (above) is necessary but not sufficient:
// a ratio/floor-based overlap check (pcMatchConflictsWithPoolName, the
// ComicVine [cv-token-gate]) tolerates ONE unaccounted-for token out of
// several without ever flagging a conflict — by design, those floors
// exist to catch WHOLLY unrelated products (0-50% overlap), not "same
// core title plus one extra distinguishing prefix." Verified empirically
// against the real G.O.D.S. case: recovering "gods" as a token alone left
// pcMatchConflictsWithPoolName's ratio at 0.83 (4/5 tokens still overlap),
// comfortably above its 0.5 floor — the gate's verdict never flipped.
// Callers use this to identify WHICH tokens came from an acronym
// specifically (as opposed to an ordinary word that happens to already be
// short) and apply a narrower, hard "this exact token is entirely absent
// on the other side" rule — independent of overall ratio.
export const extractAcronymTokens = (text) => {
  if (!text) return [];
  const matches = String(text).match(/\b[A-Za-z]\.(?:\s?[A-Za-z]\.){1,}(?:\s?[A-Za-z]\b)?/g) || [];
  return matches.map((m) => m.replace(/[.\s]/g, '').toLowerCase());
};

// Tokenize a title for similarity matching. Lowercases, strips the issue#
// hash, splits on non-alphanumerics, drops stop-words and pure-digit
// tokens (years, raw numbers carry no series-name signal).
// Q22 FIX — Normalize hyphens before tokenization to match "Spider-Man" vs "Spiderman"
// Q42 C-A3 — Expand abbreviations BEFORE tokenization (TMNT → teenage mutant ninja turtles)
export const tokenizeTitle = (title) => {
  // G.O.D.S. dispatch — collapse punctuated acronyms BEFORE anything else
  // touches the string, so both the compound-whitelist check below and the
  // main tokenization path see "gods" instead of losing it to punctuation.
  let normalized = normalizeAcronyms(String(title || "")).toLowerCase();

  // Q54: Compound whitelist check FIRST (before abbreviation expansion).
  // When title matches a protected compound (prefix or exact), return the
  // canonical split form to preserve single-letter tokens.
  // X-Men #44 → ["x", "men"], The X-Men #44 Angel → ["x", "men"] (trailing stripped).
  let bareTitle = normalized
    .replace(/#\s*\d+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Q54-FIX: Strip leading articles (the/a/an) before whitelist check.
  // "The X-Men" → "x-men" to match whitelist entry.
  bareTitle = bareTitle.replace(/^(?:the|a|an)\s+/i, '');

  // Q54-FIX: Prefix matching instead of exact match. "x-men angel red raven"
  // starts with "x-men " → match. Protects compound, allows trailing strip.
  const hit = Array.from(COMPOUND_WHITELIST).find(entry =>
    bareTitle === entry || bareTitle.startsWith(entry + ' ')
  );

  if (hit) {
    // Return canonical split of MATCHED compound only (trailing words stripped)
    const tokens = hit.replace(/-/g, " ").split(/\s+/).filter(Boolean);
    console.log(`[Q54] compound-protected="${hit}" → [${tokens.join(', ')}]`);
    return tokens;
  }

  // C-A3: Expand abbreviations (word-boundary anchored)
  for (const [abbrev, expanded] of Object.entries(ABBREV_MAP)) {
    const pattern = new RegExp(`\\b${abbrev}\\b`, 'gi');
    normalized = normalized.replace(pattern, expanded);
  }

  // Ship #22f: String-level metadata strip BEFORE tokenization
  // (publishers, artist bigrams, signatures, ordinals). Extracted to
  // titleHygiene.js for use across all identity layers.
  // Q55+55-B+Q55-C+Q55-D: Strip artist/signature/ordinal-key tokens BEFORE tokenization
  // to prevent "Amazing Spider-Man #1 Signed McFarlane" → family=["mcfarlane"]
  // matching "Spawn #1 McFarlane" (different series). E4/E5 class protection.
  const beforeStrip = normalized;
  normalized = stripMetadataTokens(normalized);
  // A6 dispatch (2026-07-26) — per-row log replaced by a per-request
  // [22f-summary] aggregate (src/lib/titleStripStats.js) on the default
  // path; this was the single largest log-volume contributor measured
  // across the certification fixtures. Full per-row detail is opt-in via
  // a server-controlled env var only, never user/request-controlled.
  recordTitleStrip(beforeStrip, normalized);
  if (TITLE_STRIP_DEBUG) {
    console.log(`[22f] metadata-stripped: "${beforeStrip}" → "${normalized}"`);
  }

  // Q55-C: Full sync with ARTIST_PATTERNS single-word entries (lines 117-123).
  // Extracts single-word last names from both multi-word patterns (kirkham from
  // /tyler kirkham/, lee from /jim lee/, etc.) AND single-word patterns.
  // COMPLETE LIST — 60+ artists from ARTIST_PATTERNS regex catalog.
  const artistWords = new Set([
    // From single-word patterns (lines 117-123)
    'skan', 'rapoza', 'quash', 'momoko', 'ross', 'adams',
    'kirkham', 'bean', 'andolfo', 'browne', 'forstner',
    'howard', 'corona', 'stegman', 'ottley',
    'jimenez', 'mcfarlane', 'campbell', 'artgerm', 'nakayama',
    'hughes', 'byrne', 'perez', 'kirby', 'ditko', 'mele',
    'albuquerque', 'hama', 'fabok', 'ejikure',
    'gleason', 'quah', 'parrillo', 'maer', 'lim', 'chew', 'ngu', 'sanders',
    // From multi-word patterns (lines 111-115) — extract last-name tokens
    // /tyler kirkham/ → kirkham (already above), /jim lee/ → lee,
    // /inhyuk lee/ → lee, /skottie young/ → young, /frank cho/ → cho,
    // /frank miller/ → miller, /windsor.?smith/ → smith, /dell'?otto/ → otto/dekal,
    // /jeehyung lee/ → lee, /alex ross/ → ross (already above),
    // /kaare andrews/ → andrews, /alan quah/ → quah (already above),
    // /mico suayan/ → suayan, /puppeteer lee/ → lee, /derrick chew/ → chew (already above),
    // /jonboy meyers/ → meyers, /kael ngu/ → ngu (already above),
    // /natali sanders/ → sanders (already above), /kendrick lim/ → lim (already above),
    // /lucio parrillo/ → parrillo (already above)
    'lee', 'young', 'cho', 'miller', 'smith', 'otto', 'dekal', 'andrews',
    'suayan', 'meyers', 'spears',  // Q55-C: add missing 'dekal', 'spears'
  ]);
  // Signature markers: signed, sig, auto, autographed (do NOT strip "ss" —
  // false positive risk: "Secret Six", "Space Squadron", etc.)
  const signatureWords = new Set(['signed', 'sig', 'auto', 'autographed']);
  // Ordinal-key phrases: 1st, 2nd, first, second, appearance, origin, key, intro
  const ordinalKeyWords = new Set([
    '1st', '2nd', '3rd', 'first', 'second', 'third',
    'appearance', 'origin', 'key', 'intro', 'debut',
  ]);
  const stripSet = new Set([...artistWords, ...signatureWords, ...ordinalKeyWords]);

  const words = normalized
    // FIX-2 (jrcrp-17838110): hyphen family → SPACE on both sides, replacing
    // Q22's strip-to-join. Enrich passes pre-normalized titles ("Giant Size
    // X Men" → [giant,size,men]) while comp rows tokenized raw hyphens
    // ("Giant-Size X-Men" → [giantsize,xmen]) → overlap 0.00, 17 sold rows
    // rejected on-grade. Space-split makes both forms canonical. The Q22
    // compact-form case ("Spiderman") is preserved by the bigram-join check
    // in hasSufficientTitleOverlap below. Covers -, ‐, ‑, ‒, –, —, ―.
    .replace(/[-‐-―]/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) =>
      w.length >= MIN_TOKEN_LEN &&
      !STOP_WORDS.has(w) &&
      !/^\d+$/.test(w) &&
      !stripSet.has(w)  // Q55+55-B: strip artist/signature/ordinal tokens
    );
  return words;
};

// Require ≥50% of our non-stop-word tokens to appear in the listing's
// non-stop-word tokens. When all our tokens are stop-words, returns true
// (no signal to gate on — let other filters handle it).
//
// Q31 Part 1: Adaptive threshold — when our title reduces to ≤2 tokens
// (e.g., "Groo in the Wild" → ["groo", "wild"]), require ≥75% overlap
// to prevent cross-series contamination (MWOM/Mighty Samson, Groo/Groo:
// The Prophecy class bugs). Thin titles have higher false-positive risk.
export const hasSufficientTitleOverlap = (listingTitle, searchTokens, threshold = 0.5) => {
  if (!searchTokens || searchTokens.length === 0) return true;
  const listingArr = tokenizeTitle(listingTitle);
  const listingSet = new Set(listingArr);
  if (listingSet.size === 0) return false;

  // FIX-2: bigram-join set — with hyphens now splitting to spaces, compact
  // seller spellings ("Spiderman") must still match split forms ("spider",
  // "man") in BOTH directions.
  const joinedSet = new Set();
  for (let i = 0; i < listingArr.length - 1; i++) {
    joinedSet.add(listingArr[i] + listingArr[i + 1]);
  }

  // Q31: Adaptive threshold for thin titles (≤2 tokens after sanitization)
  const adaptiveThreshold = searchTokens.length <= 2 ? 0.75 : threshold;

  let matches = 0;
  for (let i = 0; i < searchTokens.length; i++) {
    const t = searchTokens[i];
    if (listingSet.has(t)) { matches++; continue; }
    // our compact token ↔ listing split pair ("spiderman" vs "spider man")
    if (joinedSet.has(t)) { matches++; continue; }
    // our split pair ↔ listing compact token ("spider","man" vs "spiderman")
    if (i + 1 < searchTokens.length && listingSet.has(t + searchTokens[i + 1])) {
      matches += 2;
      i++;
    }
  }
  return matches / searchTokens.length >= adaptiveThreshold;
};

// ──────────────────────────── GRADE PARSING ────────────────────────────

// Parse a numeric grade from a listing title. Recognizes CGC X.X slab
// grades and raw letter grades (NM, VF+, GD-, etc). Returns null when no
// grade is detectable — caller should keep those listings (can't prove
// mismatch).
export const parseListingGrade = (title) => {
  const t = String(title || '');
  // Q50: Numeric token extraction FIRST (prevents "FN 6.0" → 6.0 label-midpoint skew).
  // CGC prefix (highest priority): "CGC 9.4" → 9.4
  const cgc = t.match(/CGC\s*([\d.]+)/i);
  if (cgc) return parseFloat(cgc[1]);
  // Q51 HOTFIX: Strip issue tokens BEFORE numeric extraction (Venom #1: "1" → grade 1.0 regression).
  // Remove: "#1", "No. 133", "Issue 8" → prevents bare integers from matching as grades.
  const t2 = t.replace(/#\s*\d+/g, ' ')
               .replace(/\bno\.?\s*\d+/gi, ' ')
               .replace(/\bissue\s*\d+/gi, ' ');
  // Q50b: matchAll numeric tokens, prefer decimal format, range 0.5–10.0
  // Pattern: \b(\d{1,2}\.\d)\b matches "6.0", "9.4", "10.0" (1-2 digits before decimal, 1 digit after)
  const numericTokens = [...t2.matchAll(/\b(\d{1,2}\.\d)\b/g)].map(m => parseFloat(m[1]));
  const validGrades = numericTokens.filter(val => val >= 0.5 && val <= 10.0);

  if (validGrades.length > 0) {
    // Q50b: Decimal preference — if multiple matches, prefer highest (likely the grade, not year/issue)
    // Grades cluster 0.5-10.0; years/issues are 1900+ or single-digit, filtered out by range check
    return Math.max(...validGrades);
  }
  // Label midpoint fallback: "FN", "VF+", "nm/mt" → canonical grade
  const gradeMap = [
    ['nm/mt', 9.8], ['nm+', 9.6], ['nm-', 9.2],
    ['nm', 9.4], ['vf/nm', 9.0], ['vf+', 8.5],
    ['vf-', 7.5], ['vf', 8.0], ['fn/vf', 7.0],
    ['fn+', 6.5], ['fn-', 5.5], ['fn', 6.0],
    ['vg/fn', 5.0], ['vg+', 4.5], ['vg-', 3.5],
    ['vg', 4.0], ['gd/vg', 3.0], ['gd+', 2.5],
    ['gd-', 1.8], ['gd', 2.0], ['fr/gd', 1.5],
    ['fr', 1.0], ['pr', 0.5]
  ];
  for (const [abbr, val] of gradeMap) {
    const re = new RegExp(
      '(?:^|[\\s#(])' +
      abbr.replace('/', '\\/') +
      '(?:[\\s)$]|\\d)', 'i');
    if (re.test(t)) return val;
  }
  return null;
};

// Q47-QUAL (2026-07-16, ASM #17 "low grade reading copy" class) — the
// grade-proximity filter's Fair/Poor check (soldVerification.js and
// comps.js, both call sites below) only recognizes bare "Fair"/"Poor"
// words when parseListingGrade finds no structured token. It misses the
// much more common collector shorthand sellers actually write: "reading
// copy", "coverless", "detached cover", "missing pages", "well worn",
// "heavily read" — all reliable, unambiguous signals that a listing is
// well below mid-grade, none of which parseListingGrade's numeric/
// letter-abbreviation scan can see. A $61 "low grade reading copy" comp
// with no parseable grade token was passing the null-grade fallback
// unfiltered and anchoring the low end of a 24-comp pool for a VG 4.0
// target book (real market $700-1,100, engine landed at $188.36).
//
// Positive-evidence dictionary ONLY — deliberately does not attempt to
// infer anything from the ABSENCE of grade language. A listing that says
// nothing about condition at all must keep passing through untouched;
// only an explicit, known low-grade phrase counts as evidence. Same
// safety property as tonight's newsstand reason-text fallback.
//
// Each phrase maps to a conservative ceiling — the highest grade that
// phrase could plausibly describe. getQualitativeGradeCeiling returns
// the STRICTEST (lowest) ceiling among every phrase that matches, so a
// title matching multiple low-grade signals doesn't get diluted toward
// the weaker one. Callers apply the SAME ±1.5 tolerance already used for
// parsed numeric grades — no new threshold invented, just a second way
// to arrive at a comparable number.
const QUALITATIVE_GRADE_CEILINGS = [
  ['reading copy', 1.8],
  ['low grade', 2.0],
  ['coverless', 1.0],
  ['detached cover', 1.0],
  ['cover detached', 1.0],
  ['missing pages', 1.0],
  ['well worn', 2.0],
  ['well-worn', 2.0],
  ['heavily read', 1.8],
];

export const getQualitativeGradeCeiling = (title) => {
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  let strictest = null;
  for (const [phrase, ceiling] of QUALITATIVE_GRADE_CEILINGS) {
    if (t.includes(phrase) && (strictest === null || ceiling < strictest)) {
      strictest = ceiling;
    }
  }
  return strictest;
};

// ─────────────────────── PRICE / OUTLIER HELPERS ───────────────────────

// Drop price outliers: above 3× median or below 25% of median. Requires
// at least 3 items to be meaningful — below that, returns input unchanged.
// Items shape: array of { price: number, ... }.
export const applyPriceSanity = (items) => {
  if (!Array.isArray(items) || items.length < 3) return items;
  const sorted = items.map((p) => p.price).slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (!median || median <= 0) return items;
  const lo = median * 0.25;
  const hi = median * 3;
  return items.filter((p) => p.price >= lo && p.price <= hi);
};

// ──────────────────────── ISSUE NUMBER HELPERS ─────────────────────────

// Extract issue number from a title like "Comic Reader #171" → "171".
export const extractIssueNumber = (title) => {
  const m = String(title || "").match(/#\s*(\d+)/);
  return m ? m[1] : null;
};

// Q23 FIX — Normalize issue-format strings (Annual 14 → 14 + format=annual).
// Vision and eBay sometimes return "Annual 14", "Special", "King-Size 3" as
// the issue field. Comp filters expect numeric issue strings, so non-numeric
// formats kill all matches. Extract the numeric portion and flag the format.
export const normalizeIssueFormat = (issueStr) => {
  if (!issueStr) return { issue: null, format: null };

  const str = String(issueStr).trim();

  // Pure numeric — no format marker
  if (/^\d+$/.test(str)) return { issue: str, format: null };

  // Annual #14 or Annual 14 → 14 + format=annual
  const annualMatch = str.match(/^Annual\s*#?\s*(\d+)$/i);
  if (annualMatch) return { issue: annualMatch[1], format: 'annual' };

  // Special #3 or Special 3 → 3 + format=special
  const specialMatch = str.match(/^Special\s*#?\s*(\d+)$/i);
  if (specialMatch) return { issue: specialMatch[1], format: 'special' };

  // Giant-Size #7 or King-Size #5 → N + format=giant-size/king-size
  const giantMatch = str.match(/^Giant[-\s]?Size\s*#?\s*(\d+)$/i);
  if (giantMatch) return { issue: giantMatch[1], format: 'giant-size' };

  const kingMatch = str.match(/^King[-\s]?Size\s*#?\s*(\d+)$/i);
  if (kingMatch) return { issue: kingMatch[1], format: 'king-size' };

  // Bare format words without numbers → flag format, null issue
  if (/^(Annual|Special|Giant[-\s]?Size|King[-\s]?Size)$/i.test(str)) {
    const format = str.toLowerCase().replace(/\s+/g, '-');
    return { issue: null, format };
  }

  // Unrecognized format → return as-is
  return { issue: str, format: null };
};

// Listing must contain the issue number as "#N" with a word boundary
// after (so "#1710" and "#21" don't match "#1"). Also rejects lot
// listings with commas-between-digits, "lot" keyword.
//
// Q37: Adjacency-aware dual-number parsing. When title contains multiple
// issue numbers (UK weeklies: "MWOM #198 feat. Hulk #181"), prefer the
// number nearest series-title tokens. Falls back to first-number for UK
// weeklies when no adjacency match (weekly issue comes before reprint issue).
export const hasIssueNumber = (listingTitle, issueNum, seriesTitle = null) => {
  if (!issueNum) return true;
  const tRaw = String(listingTitle || "");
  if (/\blot\b/i.test(tRaw) || /\d+\s*,\s*\d+/.test(tRaw)) return false;

  // Q46: Apply ABBREV expansion to comp title BEFORE adjacency scan.
  // TMNT failure: Vision tokens expanded ("teenage", "mutant", "ninja", "turtles"),
  // but comp title "TMNT Adventures #4" left raw → adjacency window search finds
  // "tmnt" (unexpanded) → no anchor match → 0/30 kept.
  //
  // Fix: normalize BOTH sides identically. Comp title gets same ABBREV expansion
  // as seriesTitle tokenization below.
  let t = tRaw.toLowerCase();
  for (const [abbrev, expanded] of Object.entries(ABBREV_MAP)) {
    const pattern = new RegExp(`\\b${abbrev}\\b`, 'gi');
    t = t.replace(pattern, expanded);
  }

  const escaped = String(issueNum).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Q37: UK weeklies use "no." instead of "#" (e.g., "MWOM no.198")
  // Accept both "#N" and "no.N" patterns
  const hasHashOrNo = new RegExp(`(?:#|\\bno\\.?)\\s*${escaped}\\b`, "i").test(t);
  if (!hasHashOrNo) return false;

  // Q37: Multi-number adjacency logic (matches both "#N" and "no.N")
  const issueMatches = [...t.matchAll(/(?:#|\bno\.?)\s*(\d+)\b/gi)];
  if (issueMatches.length === 0) return false;
  if (issueMatches.length === 1) {
    // Single issue — standard check
    return hasHashOrNo;
  }

  // Multiple issues — adjacency-aware resolution
  if (seriesTitle) {
    // Q46: seriesTitle tokenization already expands abbreviations via tokenizeTitle
    // (which calls ABBREV_MAP internally). Both sides now normalized identically.
    const seriesTokens = tokenizeTitle(seriesTitle);
    for (const match of issueMatches) {
      if (match[1] === String(issueNum)) {
        // Extract 15-char window around this match (from EXPANDED comp title)
        const start = Math.max(0, match.index - 15);
        const end = Math.min(t.length, match.index + 20);
        const window = t.slice(start, end);

        // Check if any series token appears in window
        const hasSeriesToken = seriesTokens.some(token =>
          window.includes(token.toLowerCase())
        );
        if (hasSeriesToken) return true; // Adjacency match
      }
    }
  }

  // No adjacency — use first-number heuristic for UK weeklies
  // (weekly issue comes before featured issue: "MWOM #198 feat. Hulk #181")
  return issueMatches[0][1] === String(issueNum);
};

// Helper: count distinct #N or no.N patterns in a title. Returns true when ≥2
// different issue numbers are present.
// Q37: Updated to match UK "no." format
export const hasMultipleDistinctIssues = (listingTitle) => {
  const distinct = new Set();
  for (const m of String(listingTitle || "").matchAll(/(?:#|\bno\.?)\s*(\d+)\b/gi)) {
    distinct.add(m[1]);
    if (distinct.size > 1) return true;
  }
  return false;
};

// Helper: detect cross-series separator patterns. Returns true when listing
// contains both an issue number (#N) AND a separator (+/&) followed by likely
// second book (series name + bare issue number). Catches "Brave and Bold #28
// + Titans 34" class where bare issue number lacks "#" prefix. Ship #20a.6.19.
export const hasCrossSeriesSeparator = (title) => {
  const t = String(title || '');
  // Requires: issue number present (#N pattern)
  if (!/#\s*\d+/.test(t)) return false;
  // Separator pattern: + or & followed by likely series name (word starting
  // with capital) and bare issue number (1-4 digits)
  return /[+&]\s+[A-Z][a-z]+\s+\d{1,4}\b/i.test(t);
};

// Issue range validator — returns true for ascending whole-number ranges
// like "#1-5" or "#100-150"; false for years, decimal grades, descending
// pairs, or pairs spanning >=1000 (likely year/issue mix).
export const isValidIssueRange = (title) => {
  const re = /#?(\d+(?:\.\d+)?)\s*[-–—]\s*#?(\d+(?:\.\d+)?)/g;
  for (const m of title.matchAll(re)) {
    const firstStr = m[1];
    const secondStr = m[2];
    const first = parseFloat(firstStr);
    const second = parseFloat(secondStr);
    if (second >= 1800 && second <= 2050) continue; // year
    if (second <= 10 && secondStr.includes('.')) continue; // grade
    if (first >= second) continue; // not ascending
    if (
      Number.isInteger(first) &&
      Number.isInteger(second) &&
      second < 1000
    ) {
      return true;
    }
  }
  return false;
};

// Q135 dispatch (2026-07-22, Invincible #1 MegaCon class) — enumerated
// print-set detector. LOT_RE requires an explicit "lot"/"set"/"bundle"
// word; isValidIssueRange catches dash-separated ranges ("#1-11"). Neither
// catches a listing that spells out a run as bare space-separated issue
// numbers with no qualifier word at all ("Invincible #1 2 3 4 5 6 7 8 9 10
// 11") — a real production comp-pool contaminant. Requires a SINGLE "#"
// followed by 4+ space-separated integers (the initial issue number plus
// 3+ more) to keep false-positive risk low: an ordinary "title #1 2026"
// (issue + year) or "title #1 2 2026" never reaches 4 total numbers.
// Strictly-ascending is also required — an incidental non-monotonic
// triple ("#9 4 5", a grade fragment) can't false-positive. Each number
// must stay under 1000 — guards against a year (2024+) appearing in the
// sequence and being mistaken for part of the enumeration.
export const isEnumeratedIssueList = (title) => {
  const m = String(title || '').match(/#\s*(\d+(?:\s+\d+){3,})\b/);
  if (!m) return false;
  const nums = m[1].trim().split(/\s+/).map(Number);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) return false;
    if (nums[i] >= 1000) return false;
  }
  return true;
};

// ──────────────────────── SERIES / FORMAT MARKERS ──────────────────────

// Detect series-extension markers in a title — Roman numerals II-X, Vol
// or Volume N, Re-/Pre- prefix words, Part N, Book N. Ship #20a.6
// extended with annual-N, special-N, king-size-N, giant-size-N for
// sold-comp format-asymmetry filtering. Returns an array of normalized
// marker strings.
//
// Used by both Ship #13 sequel-asymmetry filter (active comps,
// api/comps.js) and Ship #20a.6 sold-comp format check. Rejection logic
// in callers: "listing has marker our title lacks → reject", with
// graceful wipe-out fallback so a too-strict filter doesn't kill thin
// sold pools.
//
// `?` placeholder: when format word appears without a number (e.g.
// "Annual" alone, "King-Size Special" alone), the marker becomes
// `annual-?` so callers can still detect the format presence even when
// no specific issue number is given.
export const detectSeriesMarkers = (title) => {
  const t = String(title || '');
  const markers = [];
  // Roman numerals II-X — `(?<![\w-])` and `(?![\w-])` exclude
  // hyphenated adjacency (X-Men / V-Wars don't false-positive).
  // Ship #24 — crossover-X guard: "X" between two capitalized words
  // (e.g., "Street Fighter X G.I. Joe") is a crossover symbol, NOT
  // a sequel marker. Bidirectional check: requires BOTH (a) preceding
  // capitalized word AND (b) following capitalized word/abbreviation.
  for (const m of t.matchAll(/(?<![\w-])(III|II|IV|VI{0,3}|IX|X)(?![\w-])/g)) {
    const numeral = m[1];
    // Crossover-X filter: if "X" has capitalized words on BOTH sides, it's a crossover.
    if (numeral === 'X') {
      const beforeMatch = t.slice(0, m.index);
      const afterMatch = t.slice(m.index + m[0].length);

      // Pattern: preceding word contains letters (any case, incl. all-caps "FIGHTER")
      const hasPrecedingWord = /[A-Za-z]\s*$/.test(beforeMatch);
      // Pattern: following starts with optional whitespace/punctuation + letter
      // Catches: "X G.I.", "X GIJOE", "X GI JOE", "X Joe"
      const hasFollowingWord = /^[\s.]*[A-Za-z]/.test(afterMatch);

      if (hasPrecedingWord && hasFollowingWord) {
        continue; // Skip this "X" — crossover symbol between two franchise names
      }
    }
    markers.push(`roman-${numeral.toLowerCase()}`);
  }
  // Vol / Volume N
  const volMatch = t.match(/\bVol(?:\.|ume)?\s*(\d+)\b/i);
  if (volMatch) markers.push(`vol-${volMatch[1]}`);
  // Re- / Pre- prefix followed by a capitalized word
  const reMatch = t.match(/\b(Re|Pre)[-\s]([A-Z][a-z]+)\b/);
  if (reMatch) markers.push(`${reMatch[1].toLowerCase()}-${reMatch[2].toLowerCase()}`);
  // Part N
  const partMatch = t.match(/\bPart\s+(\d+)\b/i);
  if (partMatch) markers.push(`part-${partMatch[1]}`);
  // Book N
  const bookMatch = t.match(/\bBook\s+(\d+)\b/i);
  if (bookMatch) markers.push(`book-${bookMatch[1]}`);
  // Ship #20a.6 — issue-format markers (Annual / Special / King-Size /
  // Giant-Size). Annual #N → annual-N; bare Annual → annual-?. Same
  // pattern for the others. King-Size Special is detected as BOTH
  // 'king-size-N' AND 'special-N' (two markers from one title).
  const annualMatch = t.match(/\bAnnual\s*#?\s*(\d+)?\b/i);
  if (annualMatch) markers.push(`annual-${annualMatch[1] || '?'}`);
  const specialMatch = t.match(/\bSpecial\s*#?\s*(\d+)?\b/i);
  if (specialMatch) markers.push(`special-${specialMatch[1] || '?'}`);
  const kingMatch = t.match(/\bKing[-\s]?Size\s*(?:Special)?\s*#?\s*(\d+)?\b/i);
  if (kingMatch) markers.push(`king-size-${kingMatch[1] || '?'}`);
  const giantMatch = t.match(/\bGiant[-\s]?Size\s*#?\s*(\d+)?\b/i);
  if (giantMatch) markers.push(`giant-size-${giantMatch[1] || '?'}`);
  return markers;
};

// Extract a known artist name from a variant string. Returns the matched
// artist (lowercased) or null. First-match-wins via break — multi-word
// patterns listed first in ARTIST_PATTERNS so longer names capture before
// generic single-word fallbacks.
export const extractArtist = (variantOrTitle) => {
  if (!variantOrTitle) return null;
  const s = String(variantOrTitle);
  for (const pattern of ARTIST_PATTERNS) {
    const m = s.match(pattern);
    if (m) return m[0].toLowerCase();
  }
  return null;
};

// Q109 (greenlit, soldVerification.js) — bare-surname corroboration check.
// A surname counts as fully trusted (not just "partial") when
// premiumCreators.js has ALREADY registered it as an unambiguous alias for
// the matching creator (e.g. Momoko, Parrillo) — same registry, same
// ambiguity judgment the rest of the codebase already relies on.
//
// Q136 Slice A (2026-07-22) — promoted here from soldVerification.js
// (single source of truth, same pattern as classifyVariantTokens/
// getEraYearTolerance elsewhere in this file) so api/comps.js's new
// artist-preference narrowing tier and soldVerification.js's existing
// sold-comp filter share one implementation instead of drifting into two.
export const isUnambiguousSurnameAlias = (ourArtist, surname) => {
  const entry = PREMIUM_CREATORS.find((c) =>
    c.canonical.toLowerCase() === ourArtist ||
    c.aliases.some((a) => a.toLowerCase() === ourArtist)
  );
  if (!entry) return false;
  return entry.aliases.some((a) => a.toLowerCase() === surname);
};

// Q109 (greenlit) — three-outcome variant-artist classification.
//   'match'     — full curated ARTIST_PATTERNS match, or a bare-surname
//                 match ALREADY registered unambiguous in premiumCreators.js.
//   'partial'   — bare surname present but not a curated/registered match
//                 either way (ambiguous or undetermined). Callers should
//                 keep but demote (lower-trust tier), not reject.
//   'mismatch'  — comp names a DIFFERENT known artist. Reject.
//   'no-signal' — our artist is known and the comp corroborates NOTHING,
//                 not even a bare surname. Reject.
//
// Q136 Slice A (2026-07-22) — promoted here from soldVerification.js
// (see isUnambiguousSurnameAlias above for the reasoning) so the new
// active-comp artist-preference narrowing tier (api/comps.js) reuses the
// EXACT proven sold-side mechanism rather than a parallel reimplementation.
export const classifyArtistMatch = (rowTitle, ourArtist) => {
  if (!ourArtist) return 'match'; // nothing to check against — unchanged behavior
  const rowArtist = extractArtist(rowTitle);
  if (rowArtist) {
    return rowArtist === ourArtist ? 'match' : 'mismatch';
  }
  // Row's artist unrecognized by the curated registry — fall back to raw
  // substring corroboration on our artist's surname (last word; the
  // literal full-name case is already covered by extractArtist above,
  // since every multi-word ARTIST_PATTERNS entry is itself a literal
  // substring match).
  const words = ourArtist.split(/\s+/);
  const surname = words[words.length - 1];
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const surnameRe = new RegExp(`\\b${escaped}\\b`, 'i');
  if (surnameRe.test(String(rowTitle || ''))) {
    return isUnambiguousSurnameAlias(ourArtist, surname) ? 'match' : 'partial';
  }
  return 'no-signal';
};

// Q132 dispatch, Fix 3 (2026-07-20) — surfaces a mismatch between the two
// structurally-separate artist signals on a card: the comp-pool/title-
// family creator consensus (extractCreatorsFromComps, premiumCreators.js —
// derived from eBay listing titles) and whatever artist name Vision's own
// free-text condition report (grade.js STANDARD_PROMPT's "reason" field)
// happens to mention. These two pipelines never cross-check each other
// today — confirmed by tracing every consumer of req.body.reason in
// api/enrich.js (detectEditionWarning only, plus pass-through display) —
// so a card can show one artist in its condition-report text while pricing
// against a completely different artist's variant, with nothing to catch
// the contradiction. Real production case: the SAME physical book's
// condition-report artist name drifted three separate ways across three
// scans ("Iana Nyx" → "Iana Anikyrie" → "Jimenez") while the comp-pool
// consensus correctly said "David Nakayama" all three times — Vision's
// free narration is not grounded to the resolved identity at all.
//
// Vision's structured JSON response (grade.js JSON_SHAPE) has no dedicated
// artist/coverArtist field — an artist name can ONLY appear embedded in
// the free-text reason narrative, in unpredictable phrasing ("Iana Nyx
// artwork", "signed by X", "art by X"). ARTIST_PATTERNS/extractArtist
// alone is insufficient here: it's a closed registry (confirmed
// real-world names only), so hallucinated non-existent names like "Iana
// Nyx" — exactly the case this exists to catch — would never match it.
// Extraction instead looks for a capitalized name-like phrase (1-3 Title
// Case words) sitting immediately adjacent to a small set of attribution
// keywords ("artwork", "artist", "cover", "illustrat*", "drawn", "signed",
// "credit*") — bounded, not exhaustive; a stopgap in the same spirit as
// this file's other named-descriptor lists (OTHER_VARIANT_DESCRIPTOR_RE),
// not a permanent NLP solution. GENERIC_CAPS excludes common capitalized
// format/grade/publisher words that would otherwise false-positive
// (Cover, Variant, NM, Marvel, etc.).
//
// Deliberately does NOT attempt to resolve which artist is correct — pure
// surfacing, per the standing ruling on this feature. The comp-pool
// consensus is treated as the comparison baseline (it comes from real
// seller listings, not free narration) but no confidence claim is made
// about it being right; a mismatch here means "these two signals
// disagree," not "the condition report is wrong."
const ARTIST_ATTRIBUTION_KEYWORDS = new Set([
  'artist', 'artwork', 'art', 'cover', 'illustrated', 'illustration',
  'illustrator', 'drawn', 'signed', 'credited', 'credit', 'by',
]);
// Includes the attribution keywords themselves (a sentence-initial "Signed
// by..." must not treat "Signed" as a name candidate) plus common
// condition-report/format vocabulary that also turns up capitalized at
// sentence starts ("Standard cover...", "Raw copy...").
const ARTIST_MENTION_GENERIC_CAPS = new Set([
  ...ARTIST_ATTRIBUTION_KEYWORDS,
  'cover', 'variant', 'virgin', 'color', 'block', 'white', 'direct',
  'edition', 'near', 'mint', 'nm', 'vf', 'fn', 'gd', 'pr', 'signature',
  'series', 'trade', 'dress', 'exclusive', 'limited', 'incentive',
  'marvel', 'dc', 'image', 'idw', 'boom', 'dynamite', 'archie', 'valiant',
  'comics', 'comic', 'the', 'a', 'an', 'this', 'that', 'issue', 'first',
  'second', 'raw', 'copy', 'standard', 'condition', 'appears', 'features',
  'detected', 'overall', 'front', 'style', 'distinctive', 'minor', 'edge',
  'wear', 'no', 'not', 'looks', 'shows', 'book', 'grade', 'graded',
]);

const capWordClean = (w) => String(w || '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
const isCapWord = (w) => /^[A-Z][a-zA-Z'.-]*$/.test(capWordClean(w));
// A word is sentence-initial when it's the very first word of the text, or
// the previous word ends with sentence-terminal punctuation — capitalized
// purely by English sentence-casing, not evidence of a proper noun. Only
// matters for single-word candidates: two CONSECUTIVE capitalized words
// ("Iana Nyx") are strong proper-noun evidence regardless of position,
// since English doesn't capitalize a common word immediately following a
// sentence-initial capital.
const isSentenceInitial = (words, idx) => {
  if (idx <= 0) return true;
  return /[.!?]["')\]]*$/.test(words[idx - 1] || '');
};

// Extracts a candidate artist-name mention from free-text narration. Pure,
// no registry lookup — returns the raw candidate phrase (original case) or
// null. Adjacency window is 1 word on either side of an attribution
// keyword, matching the one concrete phrasing this was built from
// ("Iana Nyx artwork" — name immediately precedes the keyword).
export const extractConditionReportArtistMention = (text) => {
  if (!text) return null;
  const words = String(text).split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const bare = capWordClean(words[i]).toLowerCase();
    if (!ARTIST_ATTRIBUTION_KEYWORDS.has(bare)) continue;
    // Check the word immediately before, then immediately after.
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= words.length || j === i) continue;
      if (!isCapWord(words[j])) continue;
      const candidateWord = capWordClean(words[j]);
      if (ARTIST_MENTION_GENERIC_CAPS.has(candidateWord.toLowerCase())) continue;
      // Try to extend to a 2-word "Firstname Lastname" sequence in the
      // same direction as the adjacency (before the keyword: look one
      // further back; after the keyword: look one further forward).
      const extendIdx = j < i ? j - 1 : j + 1;
      if (extendIdx >= 0 && extendIdx < words.length && isCapWord(words[extendIdx])) {
        const extendWord = capWordClean(words[extendIdx]);
        if (!ARTIST_MENTION_GENERIC_CAPS.has(extendWord.toLowerCase())) {
          // Two consecutive capitalized words — strong proper-noun
          // evidence, position-independent.
          return j < i ? `${extendWord} ${candidateWord}` : `${candidateWord} ${extendWord}`;
        }
      }
      // Single-word candidate — reject if it's only capitalized because
      // it's sentence-initial (no corroborating second capitalized word).
      if (isSentenceInitial(words, j)) continue;
      return candidateWord;
    }
  }
  return null;
};

// Compares the condition-report artist mention against the comp-pool
// creator consensus. Returns { conditionReportArtist, compPoolArtists }
// when they name DIFFERENT people, or null when they agree, either signal
// is absent, or there's nothing to compare. Comparison is by surname (last
// word) — "Nakayama" (bare, ARTIST_PATTERNS surname-only match) must equal
// "David Nakayama" (full canonical name, premiumCreators.js), not conflict
// with it; only genuinely different people should ever fire this.
export const detectConditionReportArtistConflict = (conditionReportText, compPoolArtistNames) => {
  if (!Array.isArray(compPoolArtistNames) || compPoolArtistNames.length === 0) return null;
  const mention = extractConditionReportArtistMention(conditionReportText);
  if (!mention) return null;
  const lastWord = (s) => {
    const w = String(s || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return w.length ? w[w.length - 1] : null;
  };
  const mentionSurname = lastWord(mention);
  if (!mentionSurname) return null;
  const compSurnames = compPoolArtistNames.map(lastWord).filter(Boolean);
  if (compSurnames.includes(mentionSurname)) return null;
  return {
    conditionReportArtist: mention,
    compPoolArtists: compPoolArtistNames,
  };
};

// ───────────────────────────── PUBLISHER ───────────────────────────────

// Normalize a publisher string for search queries. Brackets/quotes/
// slashes/ampersands/question marks break eBay's query parser or
// truncate the match, so they're replaced with spaces and collapsed.
// Preserves all word tokens — "Hollywood Comics (Walt Disney)" →
// "Hollywood Comics Walt Disney".
export const cleanPublisher = (p) => {
  if (!p) return "";
  return String(p)
    .replace(/[()[\]{}"'\/\\&?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// ─────────────────────────── ERA/YEAR TOLERANCE ─────────────────────────

// Q128 dispatch (2026-07-19, Harley Quinn #62 systemic-tolerance audit) —
// single source of truth for the "how many years apart can a listing's
// year be from our confirmedYear before it's a different book" tolerance.
// Previously existed as two independently-maintained inline copies:
// api/comps.js's active-listing Filter 0c (±3 for modern) and
// soldVerification.js's sold-comp yearMismatch filter (±2 for modern,
// in TWO places — main pass and fallback pass) — the latter's own comment
// literally claimed to "mirror active Filter 0c" while actually using a
// different number, an already-silently-drifted claim. Consolidated here
// at comps.js's existing ±3 value (NOT tightened to ±2): the investigated
// case (Harley Quinn #62, a 2016-labeled comp for a confirmedYear=2019
// book) turned out to be a LEGITIMATE comp once checked against
// ComicVine — see isVolumeLabelYear below — and the Pattern Library's
// Renumbered-franchise entry already found, with a real reconstructed
// test (Fantastic Four #187), that a stricter numeric year tolerance
// rejects genuinely-legitimate vintage/back-issue comps. Blanket-
// tightening was considered and deliberately rejected in favor of the
// corroboration check below.
// Strange Tales dispatch (Commit C.1, 2026-07-28) — non-genuine-copy
// detector. REPRINT_RE already catches "reproduction" but has zero
// awareness of photocopy/USB/digital-archive/scan-disc listings — a real
// production title, "Strange Tales #7 Photocopy Comic Book," sailed
// through identity clustering (buildTitleFamilies/tokenizeTitleFamily,
// imageSearchIdentity.js; resolveFamilyIssueConsensus's Q140 denominator,
// identityCore.js) with ZERO reprint/reproduction awareness at all — those
// two functions never referenced REPRINT_RE, unlike the comp-pricing
// filter chains which do. This is a HARD row-exclusion for identity
// clustering specifically (rank weighting, title family, issue/year/
// publisher voting, the Q140 denominator) — a photocopy/digital-scan
// listing must never count as a "unique row" casting a vote for what book
// this is, the same way a lot/bundle listing never should. Deliberately a
// separate, narrower regex from REPRINT_RE rather than folding into it —
// REPRINT_RE is heavily tuned and tested across comp-pricing filter chains
// already (100+ existing tests); this only needs the specific "not even a
// genuine physical printed copy" vocabulary REPRINT_RE was never built to
// cover, applied at a new choke point REPRINT_RE has never touched.
export const NON_GENUINE_COPY_RE =
  /\bphotocop(?:y|ied|ies)\b|\breproduction\b|\bUSB\b|\bdigital\s*archive\b|\bscan\s*disc\b/i;

export const getEraYearTolerance = (year) => {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) return 3;
  if (y < 1970) return 5; // Golden/Silver Age — volatile cover dating
  if (y < 1985) return 3; // Bronze Age
  return 3; // Modern — consolidated single source of truth
};

// Q128 dispatch — corroboration check for the "same book, different year
// LABEL" class (distinct from genuine wrong-book contamination). Comic
// back-issue sellers routinely title listings with a series' VOLUME
// LAUNCH YEAR rather than the specific issue's own cover date (industry-
// standard convention, matching ComicVine/GCD/MyComicShop cataloging) —
// e.g. "Harley Quinn #62 (2016)" for an issue actually cover-dated 2019,
// because the ongoing series (ComicVine vol_id 92750) itself launched in
// 2016. Confirmed directly against ComicVine's own canonical volume
// record for this exact case (not assumed) before this function was
// written. A listing's stated year is treated as legitimate when it's
// within a tight tolerance of the CONFIRMED book's own ComicVine volume
// start year, even when it falls outside the normal era tolerance against
// confirmedYear. Tight tolerance (±1) because this is an exact-label
// match, not an approximate era band — sellers using this convention
// state the volume's actual start year, not a fuzzy guess.
//
// @param {number|null} listingYear - year extracted from a comp's title
// @param {number|string|null} cvVolumeStartYear - confirmedBook's
//   ComicVine volume start year (lookupComicVine's `.startYear` field —
//   NOT `.volume.startYear`, a different, broken shape documented
//   elsewhere in this codebase as always-undefined)
// @returns {boolean}
export const isVolumeLabelYear = (listingYear, cvVolumeStartYear) => {
  if (listingYear == null || cvVolumeStartYear == null) return false;
  const ly = parseInt(listingYear, 10);
  const vy = parseInt(cvVolumeStartYear, 10);
  if (!Number.isFinite(ly) || !Number.isFinite(vy)) return false;
  return Math.abs(ly - vy) <= 1;
};

// Q128 dispatch — the core keep/reject decision shared by both era-year
// checks (api/comps.js Filter 0c, src/lib/soldVerification.js's main and
// fallback passes), extracted as a pure function for direct
// regression-testability (same precedent as Q111's
// applyVariantPreferenceFilter). Callers keep their own missing-year
// pass-through and modern-relaunch-marker checks — this only decides the
// numeric year-vs-tolerance-vs-volume-label question.
//
// @param {number|null} listingYear - year extracted from a comp's title
// @param {number} confirmedYear - our book's confirmed year
// @param {number} tolerance - era tolerance, from getEraYearTolerance
// @param {number|string|null} [cvVolumeStartYear] - confirmed book's
//   ComicVine volume start year, for the volume-label corroboration check
// @returns {{keep: boolean, matchedVia: 'confirmed-year'|'volume-label'|null}}
export const evaluateEraYearMatch = (listingYear, confirmedYear, tolerance, cvVolumeStartYear = null) => {
  const diff = Math.abs(listingYear - confirmedYear);
  if (diff <= tolerance) {
    return { keep: true, matchedVia: 'confirmed-year' };
  }
  if (isVolumeLabelYear(listingYear, cvVolumeStartYear)) {
    return { keep: true, matchedVia: 'volume-label' };
  }
  return { keep: false, matchedVia: null };
};

// Q129 dispatch (2026-07-19, Harley Quinn #62 Guillem March Cover C class)
// — detects whether a listing title names a SPECIFIC cover variant
// (lettered cover, named descriptor like "card stock"/"virgin cover", or a
// known cover artist), independent of whether OUR confirmedVariant string
// itself captured that same descriptor. Reuses the three existing
// detectors already used elsewhere in this file/pipeline (OTHER_COVER_RE,
// OTHER_VARIANT_DESCRIPTOR_RE, extractArtist) rather than inventing a
// fourth pattern list. Used to detect a distinct failure shape from
// Q115/Q127/Q128's contamination classes: not wrong data getting IN, but
// CORRECT variant-specific comps getting excluded by an upstream filter
// (era, in the confirmed case) for a legitimate reason, with the survivors
// silently priced as if they were equivalent to the excluded variant. See
// Pattern Library.
export const hasNamedVariantDescriptor = (title) => {
  const t = String(title || '');
  if (!t) return false;
  return OTHER_COVER_RE.test(t) || OTHER_VARIANT_DESCRIPTOR_RE.test(t) || extractArtist(t) != null;
};

// Q129 dispatch — the final keep/flag decision, extracted as a pure
// function for direct regression-testability (same precedent as
// evaluateEraYearMatch above). Only flags when era-excluded listings
// named a specific variant AND the final priced pool doesn't itself
// carry one — a final pool that DOES carry a named descriptor still
// represents a real, specific cover variant (just not necessarily the
// same one that got excluded), which isn't the silent-substitution shape
// this exists to catch.
//
// @param {number} eraExcludedCount - count of era-rejected listings that
//   named a specific variant (hasNamedVariantDescriptor === true)
// @param {string[]} eraExcludedSamples - up to 3 sample titles, for display
// @param {string[]} finalPoolTitles - titles of the comps that survived
//   the full filter chain and will actually be priced
// @returns {{count: number, samples: string[]}|null}
export const detectVariantCompsExcludedByEra = (eraExcludedCount, eraExcludedSamples, finalPoolTitles) => {
  if (!eraExcludedCount || eraExcludedCount <= 0) return null;
  const finalHasDescriptor = (finalPoolTitles || []).some((t) => hasNamedVariantDescriptor(t));
  if (finalHasDescriptor) return null;
  return { count: eraExcludedCount, samples: eraExcludedSamples || [] };
};
