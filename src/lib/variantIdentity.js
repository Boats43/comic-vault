// Ship #20a.6.18 — Variant identity engine (pure helper, no I/O).
//
// Problem: Vision frequently misidentifies modern variants (wrong series,
// generic variant label like "virgin variant"). eBay image search returns
// the CORRECT identity in seller listing titles (e.g. "Crow Dead Time #1
// C2E2 exclusive Mico Suayan LTD 150" vs Vision's "The Crow #1, virgin").
//
// Solution: When Vision confidence is not HIGH AND year >= 2000 AND variant
// detected, extract consensus identity from eBay image search listings.
// Overrides Vision's variant field for comp query when ≥2 eBay listings
// agree on specific tokens (convention, artist, exclusive markers, limitation).
//
// ZERO DISRUPTION: Old books (pre-2000) skip entirely via year gate. Silver
// Age / Bronze Age / Golden Age path unchanged. Modern HIGH-confidence scans
// skip. Graceful fallback when no consensus → keeps Vision result.
//
// Per Ship #15 architectural rule: pure helper, no HTTP handler. Lives in
// src/lib/, imported by api/enrich.js. Vercel bundles transitively. Function
// count stays at 12/12.

import { extractVariantTokens, tokenizeTitleFamily, classifyVariantTokens } from './imageSearchIdentity.js';
import { ARTIST_PATTERNS, extractAcronymTokens, detectSeriesMarkers } from './compHygiene.js';

// Helper: find the most frequent item in an array. Returns null when array
// is empty or all items appear only once (no consensus).
const mode = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const freq = {};
  for (const item of arr) {
    freq[item] = (freq[item] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  // Only return if the top item appears more than once
  return top && top[1] >= 2 ? top[0] : null;
};

// Helper: count occurrences of a value in an array.
const count = (arr, val) => {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((item) => item === val).length;
};

// Helper: extract artist name from a title using ARTIST_PATTERNS. Returns
// the first matching pattern's captured text (multi-word patterns match
// first via ordering, so "Mico Suayan" wins before bare "Suayan"). Returns
// null when no pattern matches.
const extractArtist = (title) => {
  if (!title) return null;
  const t = String(title);
  for (const pattern of ARTIST_PATTERNS) {
    const m = t.match(pattern);
    if (m) return m[0];  // Return the matched substring
  }
  return null;
};

// Main entry: extract confirmed variant identity from eBay image search
// results. Returns null when gates fail or no consensus. Returns an object
// with confirmed variant string + metadata when consensus fires.
//
// Q109 Class A (greenlit) — TWO paths through the same consensus mechanism:
//
//   OVERRIDE path (visionVariant present): Vision detected a variant but may
//   have gotten the specific wording wrong or missed a more specific eBay
//   signal — this is the original, unchanged Ship #20a.6.18 behavior.
//     Gates: 1, 3, 4 (all must pass)
//
//   BACKFILL path (visionVariant null): Vision's cover-only variant read
//   (api/grade.js STANDARD_PROMPT: "Only populate variant field when you can
//   see EXPLICIT visual evidence... Do NOT infer variant status from art
//   style or artist recognition alone") is deliberately conservative and
//   frequently returns null even when the eBay visual pool's own listing
//   titles independently and repeatedly name a specific variant (e.g.
//   Captain America #25 "Skottie Young Variant" — never printed on the
//   physical cover, but present in the seller-title consensus). Previously
//   nothing backfilled this the way title/year already do via
//   backfillFromComps() (identityCore.js) — variant just stayed null
//   forever. This path fills that gap using the EXACT SAME consensus
//   mechanism below (mode + ≥2-agree per token type), not a separate
//   ratio-based reimplementation — there's nothing here to second-guess
//   (Vision made no variant call at all), so Gate 4's confidence check
//   doesn't apply; only Gates 1 and 3 gate the backfill path.
//     Gates: 1, 3 (Gate 4 skipped — no Vision variant call to distrust)
//
// Gates:
//   1. visualItems exists and is non-empty array
//   2. (override path only) visionVariant exists (Vision detected a variant)
//   3. bookYear must be parseable (any era — see Q109 note: despite this
//      function's original "modern era only" framing, the code has never
//      actually enforced bookYear >= 2000, only that it parses)
//   4. (override path only) visionConfidence is NOT 'high' (uncertainty signal)
//
// When gates pass:
//   1. Extract variant tokens from each eBay rawTitle
//   2. Find consensus on convention, artist, exclusive, limitation (≥2 agree)
//   3. Build confirmed variant string from consensus tokens
//   4. Return { confirmedVariant, consensus, overriddenVision, source }
//      (source is 'ebay_image_consensus' for override,
//      'ebay_image_consensus_backfill' for backfill; overriddenVision is
//      null on the backfill path — there was nothing to override)
//
// Fallback:
//   - No consensus (< threshold) → return null → keep Vision variant (null)
//   - Any gate fails → return null → keep Vision variant (null)

/**
 * Q115 dispatch (2026-07-18, Batman #608 pool-contamination class) — filter
 * a visual-pool item array to only items whose OWN extracted issue number
 * matches our confirmed issue. Callers MUST apply this before passing items
 * into extractConfirmedVariant (root-mechanism fix, not a downstream flag):
 * an artist-name match can structurally never come from a different issue,
 * so this stops the bad input from ever reaching the artist/exclusive/
 * limitation/year consensus computation, rather than trying to detect and
 * flag a corrupted result after the fact.
 *
 * Confirmed production case: Batman #608 (2002, Jim Lee, Hush) — a 20-item
 * eBay reverse-image-search pool where 0 items were actually issue #608 (a
 * mix of Superman/Batman #657, Absolute Batman #19, Detective Comics #1000,
 * Batman #1 reprints, even unrelated Marvel listings — eBay's own visual-
 * similarity confusion around cover artist Dell'Otto's painted style across
 * his many DIFFERENT DC variant covers, none of them this book). 4/20
 * mentioned "Dell'Otto" — a MINORITY (20%), which the existing artist-
 * consensus ratio gate correctly treats as a genuine distinguishing variant
 * signal when the pool IS the same book (its original, intended purpose —
 * see the Q109-FIX-A comment above). With no issue-level check, it can't
 * tell that shape apart from "these are just different books that happen
 * to share a prolific painter." Backfilled confirmedVariant="exclusive
 * Dell'Otto limited" and, via the artist-year sub-mechanism below,
 * overrode confirmedYear 2002 → 1940 — both wrong, on a book Vision had
 * already correctly identified.
 *
 * A facsimile/artist-variant genuinely mixed into a pool for the SAME
 * issue (the scenario this feature was originally built for — e.g. a
 * Skottie Young facsimile among Captain America #25 originals) is
 * unaffected: those listings still carry "#25," so they survive this
 * filter untouched.
 *
 * Items with no extractable issue number of their own (`.issue == null`)
 * are excluded, not kept — ambiguous is not the same as matching, and an
 * unlabeled item could just as easily be a different issue.
 *
 * @param {Array<{issue?: string|number|null}>} items - parsed visual-pool
 *   rows (extractIdentityFromImageSearch shape — `.issue` already computed)
 * @param {string|number|null} confirmedIssue - our confirmed issue number
 * @returns {Array} filtered items (same shape, subset)
 */
export const filterItemsByIssue = (items, confirmedIssue) => {
  if (!Array.isArray(items)) return items;
  return items.filter(
    (item) => item?.issue != null && String(item.issue) === String(confirmedIssue)
  );
};

/**
 * Q127 dispatch (2026-07-19, Catwoman #64 Szerdy-variant class) — a NEW
 * visual-pool contamination shape, distinct from Q115's Batman #608 class.
 * There, the wrong-book pool shared a DIFFERENT issue number, so
 * filterItemsByIssue (above) fixes it at the root by excluding those items
 * before variant-consensus computation ever sees them. Here, the wrong-book
 * pool (a 2024 Nathan Szerdy "exclusive/limited" trade-dress variant) shares
 * the SAME title string AND the SAME issue number as the real 2007 book —
 * filterItemsByIssue is structurally a no-op against it, since every
 * contaminating item's `.issue` genuinely matches.
 *
 * The only signal that distinguishes the two is YEAR. `poolYearHint`
 * (api/enrich.js, computed from the same visual pool, independent of
 * ComicVine) already carries it — in the confirmed production case, 2024
 * at 100% agreement (6/6 explicit year mentions), against a confirmedYear
 * of 2007 resolved from PriceCharting. This detects a conflict between the
 * two and returns a description object, or null when there's no conflict
 * (including when there's simply no evidence either way — no poolYearHint,
 * or no confirmedYear yet).
 *
 * Deliberately a POOL-LEVEL check, not a per-item filter: only 6/20 of the
 * real contaminating listings in the confirmed case even mentioned a year
 * at all — the other 14 ("Nathan Szerdy DC Comics Trade Dress Variant A
 * /3000 Homage Cover") carry no year and would survive a per-item filter
 * untouched, still contributing "exclusive"/"limited" tokens. Mirrors the
 * existing [cv-era-gate] precedent elsewhere in this codebase: suppress
 * outright on a huge, incontrovertible year drift rather than try to
 * partially clean an already-contaminated pool.
 *
 * Tolerance of 5 years is deliberately looser than the mega-key /
 * AI-verify ±1-2y conventions (those validate a SPECIFIC candidate against
 * a known year; this is a coarser "is this pool even plausibly the same
 * printing/edition" check) but comfortably tighter than genuine
 * contamination gaps seen in production (17y here, 45y for Batman #608) —
 * tunable if a genuine near-year case surfaces that needs it loosened.
 *
 * @param {{year: number, agreement: number, sampleSize: number}|null} poolYearHint
 * @param {string|number|null} confirmedYear
 * @param {number} [tolerance=5]
 * @returns {{poolYear: number, poolAgreement: number, poolSampleSize: number, confirmedYear: number, drift: number}|null}
 */
export const detectVariantPoolYearConflict = (poolYearHint, confirmedYear, tolerance = 5) => {
  if (!poolYearHint || !confirmedYear) return null;
  const cy = parseInt(confirmedYear, 10);
  if (!Number.isFinite(cy)) return null;
  const drift = Math.abs(poolYearHint.year - cy);
  if (drift <= tolerance) return null;
  return {
    poolYear: poolYearHint.year,
    poolAgreement: poolYearHint.agreement,
    poolSampleSize: poolYearHint.sampleSize,
    confirmedYear: cy,
    drift,
  };
};

/**
 * Q132 dispatch (2026-07-20, GrailKey / ASM #26 "David Nakayama" class) —
 * detectVariantPoolYearConflict (above) always responds the same way to a
 * qualifying drift: suppress the variant signal and fall back to trusting
 * confirmedYear. That's the right call when the conflicting pool signal is
 * thin/incidental noise (Batman #608, Catwoman #64 — the pool was
 * genuinely just visual-search confusion). It's the wrong call when a
 * SECOND, independent signal computed from the very same visual pool —
 * title-family clustering (imageSearchIdentity.js) — already found a
 * corroborating dominant cluster and was blocked from adopting it by the
 * Q84 dual-axis gate. Two independent signals agreeing that the confirmed
 * identity is wrong is evidence a human should see, not noise to quietly
 * discard alongside the year conflict.
 *
 * Deliberately narrow: `familyCandidate.decision === 'fallback-vision'` is
 * heavily overloaded in imageSearchIdentity.js — it's also returned for a
 * pool with <5 items, <3 consensus members, or weak token overlap (none of
 * which carry any corroborating signal at all). Only the specific
 * `'[Q84-dual-axis]'`-tagged reason (set exclusively where the dual-axis
 * gate itself blocks a >=3-member consensus family, see
 * imageSearchIdentity.js applyDualAxisGate/q84Gate) means "a real
 * candidate identity was found and rejected," which is the only case this
 * should fire for.
 *
 * @param {{decision: string, reason?: string, topFamily?: {title?: string, rawTitle?: string, count?: number, weightSum?: number}}|null} familyCandidate
 * @returns {{topFamilyTitle: string|null, count: number, weightSum: number, blockedReason: string}|null}
 */
export const detectFamilyOverrideConflict = (familyCandidate) => {
  if (!familyCandidate || familyCandidate.decision !== 'fallback-vision') return null;
  if (!/^\[Q84-dual-axis\]/.test(familyCandidate.reason || '')) return null;
  const tf = familyCandidate.topFamily;
  if (!tf) return null;
  return {
    topFamilyTitle: tf.title || tf.rawTitle || null,
    count: tf.count,
    weightSum: tf.weightSum,
    blockedReason: familyCandidate.reason,
  };
};

/**
 * Q132 dispatch, Layer 4 (2026-07-20, GrailKey / ASM #26 class) — PC's own
 * title-matcher (api/enrich.js lookupPriceCharting) accepts a product on
 * title/issue token overlap with no year check at all when the query ran
 * with comicYear=null (Vision provided no year) — confirmed empirically:
 * the real production case queried with `comic year: null` and accepted
 * "Amazing Spider-Man #26 (2001)" as the anchor for a book independently
 * confirmed (Layers 1+2) to be a 2026 printing. The one re-validation gate
 * that runs afterward (needsRequery/titleOverlapsProduct) is purely
 * textual — no year involved either.
 *
 * This is the missing check: once a confirmed family override has
 * established poolYearHint as trustworthy (yearConflictResolvedByFamily),
 * validate the ALREADY-ACCEPTED PC match's own stated year against that
 * same poolYearHint — the one signal genuinely unavailable to the earlier,
 * year-blind query. Mirrors detectVariantPoolYearConflict's tolerance
 * convention (default 5y) for consistency — same class of check, applied
 * to a different reference value (a PC product's own year, not
 * confirmedYear).
 *
 * Deliberately narrow: this is a pure predicate with no awareness of WHEN
 * it's valid to call — the caller (api/enrich.js) is responsible for only
 * invoking it inside the yearConflictResolvedByFamily branch, exactly the
 * same discipline detectFamilyOverrideConflict's caller already follows.
 *
 * @param {number|string|null} priceChartingYear - the PC match's own parsed product year
 * @param {{year: number}|null} poolYearHint
 * @param {number} [tolerance=5]
 * @returns {boolean} true when the PC match's year conflicts with poolYearHint beyond tolerance
 */
export const pcMatchConflictsWithPoolYear = (priceChartingYear, poolYearHint, tolerance = 5) => {
  const py = priceChartingYear != null ? parseInt(priceChartingYear, 10) : null;
  if (!py || !Number.isFinite(py) || !poolYearHint?.year) return false;
  return Math.abs(py - poolYearHint.year) > tolerance;
};

/**
 * Q133 dispatch (2026-07-21, Invincible/Pop Kill class, sandbox-validated
 * follow-up to Q132 Layer 4) — the year axis alone is not sufficient. Real
 * production evidence (Invincible #1 MegaCon): PC matched "Invincible
 * Universe: Battle Beast #1 (2025)" — a wholly unrelated Skybound one-shot —
 * against a pool whose own year-hint was 2026, a 1-year drift comfortably
 * inside pcMatchConflictsWithPoolYear's tolerance. The two products are
 * contemporaneous; the divergence is EDITION identity, not time. None of the
 * pool's 20 rawTitles mention "battle beast" or "universe" anywhere.
 * Conversely, the real ASM #26/GrailKey case (Q132) textually OVERLAPS
 * perfectly with its pool ("Amazing Spider-Man #26 ...") — same title/issue,
 * wrong printing year — so a text-only check would have missed THAT case.
 * Neither axis alone is sufficient; both are required, independently.
 *
 * Sandbox note (harness.mjs, same dispatch): a naive ratio>=0.5 check let
 * "Alexander Hamilton #1" (Pop Kill Lozano's wrong PC match) pass as
 * "agreeing" with an unrelated pool purely because both products share the
 * common word "Alexander" — 1/2 tokens = 50%. A short PC name needs its
 * tokens FULLY corroborated, not half — hence the >=2-token floor below.
 *
 * @param {string|null} pcProductName - the PC match's own product name
 * @param {Array<string>} poolRawTitles - the visual pool's own rawTitle strings
 * @returns {boolean} true when the PC product name fails to corroborate against the pool's own titles
 */
export const pcMatchConflictsWithPoolName = (pcProductName, poolRawTitles) => {
  if (!pcProductName || !Array.isArray(poolRawTitles) || poolRawTitles.length === 0) return false;
  const pcTokens = tokenizeTitleFamily(pcProductName);
  if (pcTokens.length === 0) return false;
  const poolTokenSet = new Set(poolRawTitles.flatMap((t) => tokenizeTitleFamily(t)));
  const overlap = pcTokens.filter((t) => poolTokenSet.has(t));
  const ratio = overlap.length / pcTokens.length;
  if (ratio < 0.5 || (pcTokens.length >= 2 && overlap.length < 2)) return true;

  // G.O.D.S. dispatch (2026-07-22, One World Under Doom class) — the ratio/
  // floor check above tolerates ONE unaccounted-for token out of several
  // (by design, built to catch WHOLLY unrelated products at 0-50% overlap).
  // It structurally cannot catch "same core title, one extra distinguishing
  // acronym prefix" — empirically confirmed: PC="G.O.D.S.: One World Under
  // Doom #1" against the real plain "One World Under Doom" pool scores
  // ratio=0.83 (4/5 tokens overlap), never dipping below the 0.5 floor.
  // Two independent, narrow, hard-reject directions (either alone rejects,
  // neither depends on the ratio above):
  //
  // Direction 1 — PC's OWN name carries an acronym token the pool never
  // mentions anywhere (this book's real shape: PC over-specified).
  const pcAcronymTokens = extractAcronymTokens(pcProductName);
  if (pcAcronymTokens.some((t) => !poolTokenSet.has(t))) return true;

  // Direction 2 — the pool's OWN titles carry a consensus acronym token
  // (>=50% of pool members — a floor against a single stray/mistyped
  // listing rejecting an otherwise-good match) that PC's name never
  // mentions at all (the inverse shape: PC under-specified, anchored to
  // the plain-series product when the book is actually the acronym-
  // prefixed tie-in).
  const poolAcronymCounts = {};
  for (const rawTitle of poolRawTitles) {
    for (const tok of new Set(extractAcronymTokens(rawTitle))) {
      poolAcronymCounts[tok] = (poolAcronymCounts[tok] || 0) + 1;
    }
  }
  const pcTokenSet = new Set(pcTokens);
  const poolConsensusAcronymOrphan = Object.entries(poolAcronymCounts).find(
    ([tok, count]) => count / poolRawTitles.length >= 0.5 && !pcTokenSet.has(tok)
  );
  if (poolConsensusAcronymOrphan) return true;

  return false;
};

/**
 * Q144A dispatch (2026-07-22, Adventure Time Summer Special SDCC class) —
 * third PC-anchor axis: the winning family's own REQUIRED discriminator.
 * Real production evidence: Q140 correctly resolves the winning title
 * family as "Adventure Time Summer Special #1 SDCC Convention Exclusive
 * 2013," but PC's own search still anchors to a plain, generic "Adventure
 * Time Comics #1 (2012)"/"Adventure Time #1 (2016)" (the anchor even
 * drifts across rescans — unstable, not a one-off). The existing name
 * axis (pcMatchConflictsWithPoolName, above) checks the PC candidate's
 * tokens against the WHOLE undifferentiated visual pool — which mixes the
 * winning SDCC family with the competing plain-series family — and since
 * both families and the wrong PC candidate all share the stem "adventure
 * time," the overlap ratio passes. This axis instead asks the question
 * the name axis structurally can't: does the PC candidate reflect the
 * product-distinguishing marker the WINNING family's own members agree on?
 *
 * Mechanism — 2-gram (adjacent token pair) phrases from the winning
 * family's own member raw titles, at >=60% member adoption, restricted to
 * phrases anchored on ALREADY-RECOGNIZED edition/product registries (never
 * arbitrary majority-shared bigrams):
 *   - series/edition-structure markers via detectSeriesMarkers
 *     (compHygiene.js — special/annual/king-size/giant-size/...): these
 *     name a different PRODUCT LINE ("Summer Special" is a different book
 *     from "#1," same asymmetry logic detectSeriesMarkers' comp-filter
 *     callers already enforce). This is the ONLY lane that can reject.
 *   - specific variant-category tokens via classifyVariantTokens
 *     (imageSearchIdentity.js — convention/ratio/retailer/exclusive/...,
 *     Q111 taxonomy, 'finish' generic excluded): these anchor candidacy
 *     and CORROBORATE on the accept side (a PC product for a con exclusive
 *     is often named by its convention — "Adventure Time SDCC #1" — rather
 *     than its "Summer Special" moniker), but never reject alone. A
 *     variant-cover pool (MegaCon/SDCC exclusive of a regular issue)
 *     legitimately anchors to the base PC product with the variant
 *     multiplier machinery layered on top — rejecting on a missing
 *     convention token would strip the PC anchor from every variant scan
 *     (the G.O.D.S./One World Under Doom quadrant-(d) control, which must
 *     stay accepted byte-identically).
 *
 * False-positive guard (the Captain Marvel #17 / Kamala Khan class —
 * verified against the real Q140 pool): "kamala khan" and "1st
 * appearance" clear the 60% adoption floor trivially, but describe story
 * CONTENT true of every copy of the issue, not a different product —
 * neither word is in any edition/convention registry, so the phrase never
 * becomes a candidate at all. Same mechanical exclusion covers artist
 * names (not registry tokens — the artist axis is separately handled),
 * seller boilerplate ("near mint," "with COA" — 'coa' is an
 * authentication token so the phrase is a candidate, but authentication
 * describes a physical copy, not a product line, and only series-marker
 * phrases reject), and printing notes ("2nd print" at 4/6 adoption in the
 * real Kamala pool — printing candidacy never rejects; PC's plain product
 * anchor stays accepted, matching Q116's separate printing machinery).
 *
 * <3-member floor reuses the established "≥3 members = this family is
 * real" convention (Q38/Q133-Slice-2/Q140) — a 1-2 listing "family" never
 * strips a PC anchor on its own say-so.
 *
 * @param {string|null} pcProductName - the PC match's own product name
 * @param {Array<string>} familyMemberRawTitles - the WINNING family's own
 *   member rawTitle strings (topFamily.indices mapped back to the visual
 *   pool — NOT the whole undifferentiated pool)
 * @returns {boolean} true when the family agrees (>=60%) on a series-marker
 *   phrase the PC product name reflects no part of
 */
export const pcMatchMissingFamilyDiscriminator = (pcProductName, familyMemberRawTitles) => {
  if (!pcProductName || !Array.isArray(familyMemberRawTitles)) return false;
  const titles = familyMemberRawTitles.filter((t) => typeof t === 'string' && t.trim().length > 0);
  if (titles.length < 3) return false;

  const tokenize = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);

  const memberBigramSets = titles.map((t) => {
    const toks = tokenize(t);
    const set = new Set();
    for (let i = 0; i < toks.length - 1; i++) set.add(`${toks[i]} ${toks[i + 1]}`);
    return set;
  });
  const bigramCounts = new Map();
  for (const set of memberBigramSets) {
    for (const bg of set) bigramCounts.set(bg, (bigramCounts.get(bg) || 0) + 1);
  }

  const pcTokens = new Set(tokenize(pcProductName));
  const pcSpecificTokens = new Set(classifyVariantTokens(pcProductName).specific);

  let missingSeriesMarkerPhrase = false;
  let pcReflectsAnyDiscriminator = false;
  for (const [bigram, cnt] of bigramCounts) {
    if (cnt / titles.length < 0.6) continue;
    const [t1, t2] = bigram.split(' ');
    const seriesAnchored = detectSeriesMarkers(bigram).length > 0;
    const variantAnchors = classifyVariantTokens(bigram).specific;
    // Not anchored on any recognized edition/product registry → arbitrary
    // majority-shared bigram (kamala khan class) — never a candidate.
    if (!seriesAnchored && variantAnchors.length === 0) continue;
    const fullyReflected = pcTokens.has(t1) && pcTokens.has(t2);
    const seriesMarkerTokens = [t1, t2].filter((tok) => detectSeriesMarkers(tok).length > 0);
    if (
      fullyReflected ||
      variantAnchors.some((tok) => pcSpecificTokens.has(tok)) ||
      seriesMarkerTokens.some((tok) => pcTokens.has(tok))
    ) {
      pcReflectsAnyDiscriminator = true;
    }
    if (seriesAnchored && !fullyReflected) missingSeriesMarkerPhrase = true;
  }
  return missingSeriesMarkerPhrase && !pcReflectsAnyDiscriminator;
};

/**
 * Q143 dispatch (2026-07-22, Rachta Lin active_reference_range class) —
 * does a thin (1-2 item) active pool disagree with ITSELF on variant/
 * artist identity? By the time this runs, the pool has already survived
 * api/comps.js's FULL filter chain (title-similarity, reprint, variant-
 * contam, cover-letter, lot, slab, signed, grade-proximity, creator-
 * match, price-sanity) — this is not a re-run of that chain. It's a
 * narrower, LAST question: do the SURVIVING 1-2 comps agree with EACH
 * OTHER on what they are? Two comps can each individually clear every
 * existing filter yet still be two genuinely different sub-products (one
 * Virgin, one Embossed Metal) that happen to share enough tokens to both
 * match a thin, ambiguous query — blending them into one reference range
 * would understate real price variance between two real, different
 * items. A single comp (fewer than 2 rows) has nothing to conflict with.
 *
 * @param {Array<{title?: string, rawTitle?: string}|string>} compRows
 * @returns {boolean} true when 2+ comps carry mutually-exclusive artist or specific-variant signals
 */
export const hasUnresolvedActiveVariantConflict = (compRows) => {
  const titles = (compRows || [])
    .map((r) => (typeof r === 'string' ? r : (r?.title || r?.rawTitle || '')))
    .filter(Boolean);
  if (titles.length < 2) return false;

  // Artist mismatch: two comps naming two DIFFERENT recognized creators.
  // Reuses this file's own local extractArtist (above) — lowercased here
  // since that helper preserves original casing and titles arrive mixed
  // case (ALL CAPS listings are common).
  const artists = new Set(titles.map((t) => extractArtist(t)?.toLowerCase()).filter(Boolean));
  if (artists.size >= 2) return true;

  // Specific-variant-token mismatch (Q111 taxonomy) — two comps that each
  // carry SPECIFIC tokens (convention/ratio/retailer/exclusive/
  // limitation/authentication/printing — not a mere finish descriptor)
  // but disagree on which ones. Generic-only tokens (foil, virgin, etc.)
  // never trigger this — same reasoning Q111 already established: a
  // shared cover TREATMENT isn't a distinguishing PRODUCT claim.
  //
  // "Disagree" is deliberately NOT "zero overlap" — two SDCC-exclusive
  // listings both legitimately say "exclusive"/"limited" alongside their
  // own specific convention token, so a bare any-overlap check would let
  // "sdcc,exclusive,limited" vs "c2e2,exclusive,limited" through as
  // compatible even though "sdcc" and "c2e2" are two different, real
  // conventions. Conflict fires when BOTH sides have at least one token
  // the OTHER side lacks (a genuine two-way disagreement) — a plain
  // subset/superset relationship (one comp just states less detail than
  // the other) is compatible, not a conflict.
  const specificSets = titles.map((t) => {
    const { specific } = classifyVariantTokens(extractVariantTokens(t).join(' '));
    return new Set(specific);
  });
  for (let i = 0; i < specificSets.length; i++) {
    for (let j = i + 1; j < specificSets.length; j++) {
      const a = specificSets[i];
      const b = specificSets[j];
      if (a.size === 0 || b.size === 0) continue; // nothing to disagree about
      const aOnly = [...a].some((t) => !b.has(t));
      const bOnly = [...b].some((t) => !a.has(t));
      if (aOnly && bOnly) return true;
    }
  }
  return false;
};

export const extractConfirmedVariant = (
  visualItems,
  visionVariant,
  bookYear,
  visionConfidence
) => {
  // Gate 1: visualItems must exist
  if (!Array.isArray(visualItems) || visualItems.length === 0) {
    return null;
  }

  // Gate 3: bookYear must exist (any era)
  const y = parseInt(bookYear, 10);
  if (!y) {
    return null;
  }

  const isBackfill = !visionVariant;

  // Q109-FIX-C (2026-07-16, ASM #17 Ditko / ASM #300 McFarlane): the
  // backfill path exists to catch modern marketed variants Vision's
  // conservative cover-only read misses (Skottie Young on Captain America
  // #25 — a real, separately-SKU'd incentive cover). Marketed variant
  // covers (convention exclusives, numbered/limited editions, artist
  // incentive covers) are a direct-market-era concept — they don't exist
  // on books from before the direct market's speculator boom. Below this
  // boundary, an artist name surfacing in a MINORITY of pool titles isn't
  // evidence of a distinguishing subset (Fix A's ratio-gate assumption) —
  // it's just inconsistent seller SEO on a book with exactly one cover.
  // Production evidence: Ditko backfilled at 5/18=28% of the ASM #17 pool,
  // McFarlane at 6/20=30% of the ASM #300 pool — both comfortably under
  // Fix A's 70% threshold despite neither naming a real distinguishing
  // variant, both collapsing their downstream comp pools by 65-84% via
  // Filter 1c / classifyArtistMatch. 1990 marks the pre-direct-market /
  // post-speculator-boom line — comfortably below every genuine modern
  // variant case (Skottie Young 2019, Mico Suayan 2024-2025) and at/above
  // both false-positive cases (Ditko 1964, McFarlane 1988). Override path
  // untouched: Vision already saw a real variant on the physical cover
  // there, this gate only stops the backfill mechanism from inventing one.
  const BACKFILL_MIN_YEAR = 1990;
  if (isBackfill && y < BACKFILL_MIN_YEAR) {
    console.log(`[variant-identity] backfill skipped: year=${y} < ${BACKFILL_MIN_YEAR} (pre-direct-market — no marketed variant covers to backfill)`);
    return null;
  }

  // Gate 2/4 (override path only): visionVariant must exist, and when it
  // does, Vision confidence must NOT be HIGH (uncertainty signal — only
  // second-guess Vision's own variant call when Vision itself signals low
  // confidence). Neither applies to the backfill path: there is no Vision
  // variant call to distrust, only a gap to fill.
  if (!isBackfill) {
    const conf = String(visionConfidence || 'medium').toLowerCase().trim();
    if (conf === 'high') {
      return null;
    }
  }

  console.log(`[variant-identity] gates passed: year=${y}, variant="${visionVariant || '(null)'}", mode=${isBackfill ? 'backfill' : 'override'}`);

  // Extract variant tokens from each eBay rawTitle
  const allConventions = [];
  const allArtists = [];
  const allExclusives = [];
  const allLimitations = [];
  // Slice C (2026-07-22, One World Under Doom / Giang MegaCon Secret Drop
  // class) — authentication tokens (signed/autographed/COA/remarked).
  // Bare 'ss' excluded (same false-positive rationale as SIGNED_RE and
  // imageSearchIdentity.js's own AUTH_PATTERNS comment — collides with
  // series names like SS-Squadron). Unlike the artist ratio-gate above, no
  // majority ceiling: a signed sub-listing genuinely IS a distinguishing
  // purchase option a real subset of the print run has (collectors signing
  // copies at a con), not an SEO-citation artifact — a MAJORITY of the pool
  // mentioning "signed" is real information, not noise to discount.
  const AUTH_TOKENS = ['signature series', 'autographed', 'coa', 'signed', 'certified', 'remark'];
  const allAuthentications = [];
  // Q99-B: retain per-item artist + years so an artist-facsimile pool's own
  // publication year can be resolved separately from the generic comp pool
  // (a Skottie Young 2023 facsimile mixed in the same nominal-title pool as
  // 1981 originals must not inherit either CV's or the undifferentiated
  // pool's year — its own listings carry the true year).
  const itemRecords = [];
  const YEAR_RE = /\b(19[3-9]\d|20[0-3]\d)\b/g;
  // Q109-FIX-A (2026-07-16, ASM #300 McFarlane): denominator for the
  // artist distinguishing-ratio check below — count of pool items that
  // actually had a title to extract tokens from.
  let consideredCount = 0;

  for (const item of visualItems) {
    const rawTitle = item?.rawTitle || '';
    if (!rawTitle) continue;
    consideredCount++;

    // Extract tokens using imageSearchIdentity helper
    const tokens = extractVariantTokens(rawTitle);

    // Convention tokens (c2e2, sdcc, nycc, fanexpo, etc.)
    const convention = tokens.find((t) =>
      ['megacon', 'nycc', 'c2e2', 'sdcc', 'fanexpo', 'emerald city', 'eccc', 'wondercon'].includes(t)
    );
    if (convention) allConventions.push(convention);

    // Exclusive tokens
    const exclusive = tokens.find((t) =>
      ['exclusive', 'convention exclusive', 'con exclusive', 'store exclusive',
       'shop exclusive', 'web exclusive', 'online exclusive', 'secret drop'].includes(t)
    );
    if (exclusive) allExclusives.push(exclusive);

    // Limitation tokens
    const limitation = tokens.find((t) =>
      ['numbered', 'limited'].includes(t)
    );
    if (limitation) allLimitations.push(limitation);

    // Authentication tokens (Slice C)
    const authentication = tokens.find((t) => AUTH_TOKENS.includes(t));
    if (authentication) allAuthentications.push(authentication);

    // Artist extraction (from rawTitle using ARTIST_PATTERNS)
    const artist = extractArtist(rawTitle);
    if (artist) allArtists.push(artist);

    const years = [...new Set((rawTitle.match(YEAR_RE) || []).map((y2) => parseInt(y2, 10)))];
    itemRecords.push({ artist: artist ? artist.toLowerCase() : null, years });
  }

  console.log(`[variant-identity] extracted tokens: conventions=${JSON.stringify(allConventions)}, artists=${JSON.stringify(allArtists)}, exclusives=${allExclusives.length}, limitations=${allLimitations.length}, authentications=${allAuthentications.length}`);

  // Build consensus: each token type requires ≥2 agree
  const consensus = {};

  const topConvention = mode(allConventions);
  if (topConvention && count(allConventions, topConvention) >= 2) {
    consensus.convention = topConvention;
  }

  // Artist consensus: case-insensitive comparison (artists appear in
  // mixed case: "Mico Suayan", "MICO SUAYAN", "mico suayan").
  //
  // Q109-FIX-A (2026-07-16, ASM #300): raw ≥2-agree alone can't tell
  // "genuine distinguishing variant" (Skottie Young credited on a MINORITY
  // of a mixed pool of covers) from "this is just who drew the book's one
  // and only cover" (McFarlane named in nearly every listing, because
  // sellers cite the famous artist for SEO regardless of edition — not
  // because a distinguishing subset of comps carries his name). An artist
  // consensus is only treated as distinguishing when it covers a MINORITY
  // of the considered pool — 70% is the threshold, matching the general
  // shape of this session's other consensus gates (issue 50%, title 30%):
  // above it, "most sellers happen to mention this" has tipped into
  // "this is the standard cover, not a variant," and using it as a
  // filtering criterion (classifyArtistMatch / Filter 7 in
  // soldVerification.js) would reject correct comps for the crime of
  // omitting a non-distinguishing artist name. Below-threshold artist
  // mentions are excluded from consensus.artist entirely, so they never
  // reach confirmedVariant and never gate Filter 7 — no separate flag
  // needed downstream.
  //
  // Floor added after this exact change broke the module's own canonical
  // test (Crow Dead Time / Mico Suayan, Captain America #25 / Skottie
  // Young — both 2-item stub pools): with only 2 items, 2/2 agreement is
  // unavoidably 100% whether or not the artist is genuinely distinguishing
  // — the ratio carries no information below a minimum sample size. Pools
  // under MIN_POOL_FOR_RATIO_GATE skip the ratio check entirely and fall
  // back to the original ≥2-agree behavior, unchanged from before Fix A.
  const ARTIST_DISTINGUISHING_RATIO = 0.7;
  const MIN_POOL_FOR_RATIO_GATE = 4;
  const artistsNormalized = allArtists.map((a) => String(a).toLowerCase());
  const topArtistLower = mode(artistsNormalized);
  if (topArtistLower && count(artistsNormalized, topArtistLower) >= 2) {
    const topArtistCount = count(artistsNormalized, topArtistLower);
    const artistRatio = consideredCount > 0 ? topArtistCount / consideredCount : 0;
    const ratioGateApplies = consideredCount >= MIN_POOL_FOR_RATIO_GATE;
    if (!ratioGateApplies || artistRatio < ARTIST_DISTINGUISHING_RATIO) {
      // Find the original-case artist name (prefer first occurrence)
      const idx = artistsNormalized.indexOf(topArtistLower);
      consensus.artist = allArtists[idx];
    } else {
      const idx = artistsNormalized.indexOf(topArtistLower);
      console.log(
        `[variant-identity] artist "${allArtists[idx]}" appears in ` +
        `${topArtistCount}/${consideredCount} (${Math.round(artistRatio * 100)}%) of pool — ` +
        `NOT distinguishing (>= ${Math.round(ARTIST_DISTINGUISHING_RATIO * 100)}% threshold), ` +
        `informational only, excluded from filtering`
      );
    }
  }

  // Exclusive: just need ≥2 listings with ANY exclusive marker
  if (allExclusives.length >= 2) {
    // Pick the most specific exclusive marker
    const topExclusive = mode(allExclusives);
    consensus.exclusive = topExclusive || 'exclusive';
  }

  // Limitation: need ≥2 agree (same type)
  const topLimitation = mode(allLimitations);
  if (topLimitation && count(allLimitations, topLimitation) >= 2) {
    consensus.limitation = topLimitation;
  }

  // Signed/authentication: ≥2 listings with ANY authentication marker —
  // same threshold as exclusive, matching the "real distinguishing purchase
  // option" rationale above (Slice C). Not folded into the confirmedVariant
  // TEXT string below — it drives a separate boolean signal
  // (signedConsensus) consumed by api/comps.js Filter 2b and
  // soldVerification.js's signed filter, so it never risks corrupting
  // title-family clustering or eBay search-query construction the way
  // fusing a creator name into variant text once did (Black Cat / Skottie
  // Young class, Q84).
  if (allAuthentications.length >= 2) {
    consensus.signed = true;
  }
  console.log(
    `[signed-consensus] detected: ${!!consensus.signed}, members=${allAuthentications.length}/${consideredCount}` +
    (allAuthentications.length > 0 ? ` tokens=${JSON.stringify(allAuthentications)}` : '')
  );

  // If no consensus on ANY token, return null (keep Vision variant — null
  // stays null on the backfill path, nothing to fill in)
  if (Object.keys(consensus).length === 0) {
    console.log(`[variant-identity] no consensus — ${isBackfill ? 'nothing to backfill, variant stays null' : 'keeping Vision variant'}`);
    return null;
  }

  console.log(`[variant-identity] consensus:`, JSON.stringify(consensus));

  // Q99-B: when an artist consensus fires (artist facsimile / signed
  // exclusive), resolve publication year from THAT artist's own listings
  // only — not the generic pool, which mixes original-print and facsimile
  // comps under the same nominal title/issue. Requires ≥50% of the
  // artist-matching listings to agree on a single year.
  let variantYear = null;
  let variantYearRatio = 0;
  if (consensus.artist) {
    const artistItems = itemRecords.filter((r) => r.artist === topArtistLower);
    const yearCounts = {};
    artistItems.forEach((r) => {
      r.years.forEach((yr) => { yearCounts[yr] = (yearCounts[yr] || 0) + 1; });
    });
    const sortedYears = Object.entries(yearCounts).sort((a, b) => b[1] - a[1]);
    if (sortedYears.length > 0 && artistItems.length > 0) {
      const [topYear, topCount] = sortedYears[0];
      const ratio = topCount / artistItems.length;
      if (ratio >= 0.5) {
        variantYear = parseInt(topYear, 10);
        variantYearRatio = ratio;
        console.log(
          `[variant-year] resolved ${topYear} from ${consensus.artist} pool ` +
          `(${topCount}/${artistItems.length}=${Math.round(ratio * 100)}%)`
        );
      }
    }
  }

  // Build confirmed variant string from consensus tokens
  // Order: Vision's own variant (override path only) → convention →
  // exclusive → artist → limitation
  //
  // Q109-FIX-B (2026-07-16): the override path used to DISCARD Vision's
  // own variant call outright, replacing it with whatever consensus
  // tokens fired. That's correct when consensus is CORRECTING a wrong or
  // vague Vision read (the mechanism's original purpose), but wrong when
  // Vision supplied a real signal from a different axis than the
  // consensus found — e.g. Vision's reason-text newsstand fallback
  // populates variant="newsstand" (an edition-type signal Vision can only
  // get from the physical cover), and a same-book artist consensus then
  // fires on "mcfarlane" (a cover-credit signal from eBay titles) — the
  // two aren't in conflict, they're both true at once. Appending instead
  // of replacing preserves Vision's edition-type read while still adding
  // whatever the eBay pool corroborates. Backfill path (visionVariant
  // falsy) is unaffected — nothing to prepend, identical to prior output.
  const parts = [];
  if (!isBackfill && visionVariant) parts.push(String(visionVariant).trim());
  if (consensus.convention) parts.push(consensus.convention);
  if (consensus.exclusive) parts.push(consensus.exclusive);
  if (consensus.artist) parts.push(consensus.artist);
  if (consensus.limitation) parts.push(consensus.limitation);

  const confirmedVariant = parts.join(' ');

  console.log(`[variant-identity] confirmed: "${confirmedVariant}" (${isBackfill ? 'backfilled — Vision had no variant call' : `Vision was: "${visionVariant}"`})`);

  return {
    confirmedVariant,
    consensus,
    overriddenVision: isBackfill ? null : visionVariant,
    source: isBackfill ? 'ebay_image_consensus_backfill' : 'ebay_image_consensus',
    variantYear,
    variantYearRatio,
    // Slice C — pool-corroborated "the market has signed copies of this
    // book" signal, kept separate from the free-text confirmedVariant so it
    // never reaches title-family clustering or eBay query construction.
    signedConsensus: !!consensus.signed,
  };
};
