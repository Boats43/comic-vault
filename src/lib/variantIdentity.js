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
import { ARTIST_PATTERNS, extractAcronymTokens, detectSeriesMarkers, extractVariantTokensByAxis } from './compHygiene.js';
// GrailKey Dispatch 27, Fix 27-A (2026-08-08) — reuses the SAME
// anti-injection distinctness check and title-independence primitive
// Fix 4/4b already built and shipped, never a second implementation. No
// import cycle: issueAuthority.js imports only compHygiene.js/
// responseContract.js/yearEvidence.js, none of which import this file.
import { checkDistinctItemIdAndSeller, evaluateTitleTextIndependence } from './issueAuthority.js';

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
 * Q144 Item 1 dispatch (2026-07-22, Adventure Time Summer Special class) —
 * `familyOverrideAccepted` (optional, defaults to false — every existing
 * caller omitting it is byte-identical to before) recovers items whose
 * `.issue` came back null at pool-build time not because they're a
 * different issue, but because extractIssueFromTitle's Q12c marketing-copy
 * guard mistook a genuine title word ("Summer Special," "Convention
 * Exclusive") for hype. Real production case: every "Adventure Time
 * Summer Special #1 SDCC Convention Exclusive..." listing nulled its own
 * "#1" this way, emptying this filter's output entirely before
 * extractConfirmedVariant's own consensus computation ever got a real
 * family sample to work from.
 *
 * Deliberately narrow, final scope (tightened from an earlier canonical-
 * title-text design): this is CORROBORATION of an already-established
 * confirmedIssue, not a new inference mechanism, and MARKETING_KEYWORDS_RE
 * itself is untouched — still fires exactly as before for every caller
 * that doesn't pass `familyOverrideAccepted`. Recovery requires ALL of:
 * the caller asserts an accepted family override is active (the caller's
 * responsibility — every row already belongs to the winning family by
 * construction, since `variantSourceItemsPreIssueFilter` in api/enrich.js
 * is only family-scoped when FAMILY_OVERRIDE_DECISIONS.includes(decision)
 * in the first place), confirmedIssue is present, AND the row's own raw
 * title literally contains "#<confirmedIssue>" as text — word-bounded so
 * "#1" does not match "#1B"/"#1C" (lettered cover suffixes) or "#10"/
 * "#1000" (a longer number sharing the same leading digits). A bare year
 * ("2013") or a ratio/limitation fraction ("1:25", "1/1000") never
 * contains a literal "#" immediately before the digits, so neither can
 * ever satisfy this check regardless of family-override context.
 *
 * @param {Array<{issue?: string|number|null, rawTitle?: string}>} items - parsed visual-pool
 *   rows (extractIdentityFromImageSearch shape — `.issue` already computed)
 * @param {string|number|null} confirmedIssue - our confirmed issue number
 * @param {boolean} [familyOverrideAccepted] - true only when the caller has
 *   an accepted family-override identity (FAMILY_OVERRIDE_DECISIONS) and
 *   `items` is already scoped to that winning family
 * @returns {Array} filtered items (same shape, subset)
 */
export const filterItemsByIssue = (items, confirmedIssue, familyOverrideAccepted = false) => {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => {
    if (item?.issue != null && String(item.issue) === String(confirmedIssue)) return true;
    if (familyOverrideAccepted && confirmedIssue != null && item?.rawTitle) {
      const escaped = String(confirmedIssue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const corroborated = new RegExp(`#\\s*${escaped}(?!\\d)(?![A-Za-z])`).test(item.rawTitle);
      if (corroborated) return true;
    }
    return false;
  });
};

/**
 * Track B Phase 0, Commit 4.3 (Section D, 2026-07-30) — variant provenance
 * check. A client-forwarded variant string (req.body.variant) carries no
 * provenance metadata of its own — the issue number it arrived alongside
 * in the SAME request (variantSourceIssue — in practice, Vision's own
 * issue read at scan time) is the only signal this codebase has for
 * "which issue was this variant candidate computed for."
 *
 * Confirmed live (2026-07-30 23:16:50 production dispatch, pre-Commit-4.3
 * build): a genuinely correct Vision read ("Brett Booth virgin variant")
 * survived unchanged even after confirmedIssue silently drifted from #351
 * to an unrelated #300 — producing an impossible identity (a Brett Booth
 * Cover C Virgin variant of a completely different issue). This check is
 * the explicit invalidation point: when variantSourceIssue disagrees with
 * the FINAL confirmedIssue — by ANY mechanism that can move confirmedIssue
 * (family-authority retention, vision-zero-support, an eBay title
 * override, a future code path) — the candidate must be treated as stale
 * and never used, neither as a starting default nor as input to any
 * consensus recomputation. filterItemsByIssue (above) is the complementary
 * half of this containment: it ensures the POOL a variant gets
 * re-derived FROM is scoped to the final issue; this function ensures the
 * CLIENT-FORWARDED CANDIDATE itself doesn't leak past an issue change
 * either.
 *
 * A null variantSourceIssue (no issue was ever associated with the
 * variant text — e.g. a manual/no-camera entry) is not a provenance
 * failure — there's nothing to have drifted from, so the candidate stays
 * valid; the caller's own issue-scoped re-derivation is what will
 * actually confirm or reject it downstream.
 *
 * Pure, no console/log side effects.
 *
 * @param {string|number|null} variantSourceIssue - the issue this variant candidate was captured alongside (in practice, Vision's own issue read)
 * @param {string|number|null} confirmedIssue - the FINAL, fully-resolved issue
 * @returns {boolean} true when the candidate is still trustworthy (no provenance conflict)
 */
export const isVariantProvenanceValid = (variantSourceIssue, confirmedIssue) => {
  return variantSourceIssue == null || String(variantSourceIssue) === String(confirmedIssue);
};

/**
 * GrailKey Commit D2 (2026-08-02, ASM #300 facsimile-injection dispatch)
 * — Vision non-contradiction gate, standalone/exported so it can also
 * gate the TRUE unconditional injection point (api/enrich.js:
 * `confirmedVariant = ... safeReqVariant` — a plain default assignment
 * that runs whether or not extractConfirmedVariant ever finds pool
 * consensus; extractConfirmedVariant's own internal gate, above, only
 * ever runs when it reaches its return statement, which a zero-consensus
 * pool never does). Applying this ONCE, before safeReqVariant is used to
 * seed confirmedVariant at all, closes the gap that would otherwise let
 * an uncorroborated printing claim through untouched on exactly the
 * pools (thin/no consensus) where extractConfirmedVariant's own
 * defense-in-depth copy of this check never gets to run.
 *
 * Real production case (ASM #300, 2026-08-02): a client-forwarded
 * variant="facsimile" (Vision's own free-form `variant` field) reached
 * confirmedVariant unconditionally, rejecting 30/30 sold comps on
 * axis:printing — while the SAME scan's structured isReprint/editionType
 * fields (and Vision's own free-text condition report) described a raw
 * first print with no facsimile indication. Structural reason: a
 * facsimile is a photographic reproduction of the original cover — image
 * search (and a free-form guess influenced by a facsimile-dominated
 * reverse-image pool) cannot distinguish a facsimile from a first print
 * by definition. Only the physical object's own indicia can, which is
 * exactly what isReprint/editionType are prompted to require ("EXPLICIT
 * indicators only... Do NOT infer from cover-art recognition alone...
 * default to false when uncertain") — stricter than the free-form
 * `variant` field's own general "SHORT STANDARDIZED description"
 * instruction. Per dispatch: use structured Vision fields, never the
 * free-text condition report (reason) — deliberately not consulted here.
 *
 * Deliberately coarse: an uncorroborated printing-axis claim nulls the
 * ENTIRE visionVariant string, not just the printing token — surgical
 * extraction would need to map a normalized axis token ('reprint', the
 * shared label for reprint/facsimile/2nd-print/3rd-print alike) back to
 * whichever original substring produced it, which extractVariantTokens
 * doesn't preserve. A variant string genuinely carrying BOTH a printing
 * claim and another legitimate axis (e.g. "newsstand facsimile") is rare
 * enough, and the failure mode of over-suppressing is a small miss (a
 * lost coverType/distribution word) versus the failure mode of
 * under-suppressing (a $175-est book priced at $19 off contaminated
 * comps) — conservative direction preferred when uncertain, per standing
 * doctrine.
 *
 * @param {string|null} visionVariant - req.body.variant (free-form, unvalidated)
 * @param {boolean} visionIsReprint - req.body.isReprint (structured)
 * @param {string|null} visionEditionType - req.body.editionType (structured)
 * @returns {{ safeVariant: string|null, conflict: null | { claimed: string, isReprint: boolean, editionType: string|null } }}
 */
export const validateVisionPrintingClaim = (visionVariant, visionIsReprint, visionEditionType) => {
  if (!visionVariant) return { safeVariant: visionVariant, conflict: null };
  const printingAxis = extractVariantTokensByAxis(String(visionVariant)).printing;
  if (printingAxis.length === 0) return { safeVariant: visionVariant, conflict: null };

  const editionTypeLower = String(visionEditionType || '').toLowerCase().trim();
  const corroborated = visionIsReprint === true || editionTypeLower === 'reprint' || editionTypeLower === 'facsimile';
  if (corroborated) return { safeVariant: visionVariant, conflict: null };

  return {
    safeVariant: null,
    conflict: {
      claimed: String(visionVariant),
      isReprint: visionIsReprint === true,
      editionType: visionEditionType || null,
    },
  };
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

// GrailKey Dispatch 27, Fix 27-A (2026-08-08) — coverType consensus tally.
// Mirrors resolveFamilyIssueConsensus's own tie-handling (identityCore.js)
// exactly: a tie for the top count NEVER masquerades as a winner (`winner`
// stays null, `support` stays 0) — the exact discipline that function's own
// doc comment established for the issue axis, reused here rather than
// re-derived. Reads the coverType axis SPECIFICALLY from
// extractVariantTokensByAxis (compHygiene.js) — not imageSearchIdentity.js's
// richer 'finish' vocabulary — verified by direct execution (GrailKey
// Dispatch 27 STEP B) that 4 of that richer list's 10 tokens
// (holographic/glow-in-dark/embossed/metallic) do not round-trip through
// the narrower list soldVerification.js actually checks against; reading
// from the literal same function that verifies it back guarantees the
// round-trip by construction. See Pattern Library GK-40 — three
// independently-drifted variant-token vocabularies exist in this codebase;
// this reads exactly one of them on purpose, does not consolidate the
// other two.
//
// A row asserting MULTIPLE coverType tokens (rare — e.g. "foil" and
// "virgin" both present) contributes to both tallies; `uniqueRows` counts
// rows with at least one coverType token, not token occurrences.
export function tallyCoverTypeConsensus(visualItems) {
  const rows = Array.isArray(visualItems) ? visualItems : [];
  const counts = {};
  const assertingIndices = [];
  const assertingRows = [];
  rows.forEach((item, idx) => {
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (!raw) return;
    const coverTypeTokens = extractVariantTokensByAxis(raw.toLowerCase()).coverType;
    if (!coverTypeTokens || coverTypeTokens.length === 0) return;
    assertingIndices.push(idx);
    assertingRows.push({ idx, rawTitle: raw });
    for (const tok of new Set(coverTypeTokens)) {
      counts[tok] = (counts[tok] || 0) + 1;
    }
  });
  const uniqueRows = assertingIndices.length;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topCount = ranked[0]?.[1] ?? 0;
  const tiedForTop = ranked.filter(([, c]) => c === topCount).length;
  const winner = tiedForTop === 1 ? (ranked[0]?.[0] ?? null) : null;
  const winnerCount = tiedForTop === 1 ? topCount : 0;
  const runnerUp = tiedForTop === 1 ? (ranked[1]?.[0] ?? null) : null;
  return { winner, support: winnerCount, uniqueRows, runnerUp, assertingIndices, assertingRows };
}

// GrailKey Dispatch 27, Fix 27-A — promotion predicate. Deliberately FIVE
// conditions, not six: mirrors evaluateUnanimousConsensusPromotion's
// (issueAuthority.js) uniqueRows>=4 / exact-unanimity / no-runnerUp /
// distinct-itemId-AND-seller structure exactly, reusing
// checkDistinctItemIdAndSeller verbatim rather than a second
// implementation — but does NOT include that function's weightSum>=8.0
// condition. Argued and greenlit explicitly (GrailKey Dispatch 27):
// weightSum requires each row's ORIGINAL eBay search-rank index
// (getRankWeight, imageSearchIdentity.js, itself module-private), but by
// the time `visualItems` reaches this function it has already been
// filtered (filterItemsByIssue, api/enrich.js) and re-indexed — local
// array position no longer corresponds to original search rank.
// Fabricating a weightSum from the wrong index would be the SIXTH
// instance of "measuring coherence against the wrong population" in this
// codebase (Pattern Library) — self-inflicted, inside the very fix meant
// to close a different instance of the same class. Omitting a condition
// that cannot be computed honestly was judged better than computing it
// wrong. A genuine sixth condition remains available if original-rank
// threading is ever done for OTHER reasons — not built here, not this
// diff. Caller supplies the ALREADY-COMPUTED condition-6 result
// (evaluateTitleTextIndependence) rather than this function calling it
// internally, so the caller can log it whether promotion.promote is true
// or the population is too thin to bother — see the call site.
export function evaluateCoverTypeConsensusPromotion(tally, visualItems) {
  const inputs = {
    uniqueRows: tally.uniqueRows,
    support: tally.support,
    runnerUp: tally.runnerUp,
  };
  if (!(inputs.uniqueRows >= 4)) {
    return { promote: false, declineReason: 'uniqueRows<4', inputs };
  }
  if (!(inputs.support === inputs.uniqueRows)) {
    return { promote: false, declineReason: 'not-exact-unanimity', inputs };
  }
  if (inputs.runnerUp !== null) {
    return { promote: false, declineReason: 'runnerUp-present', inputs };
  }
  const memberCheck = checkDistinctItemIdAndSeller(tally.assertingIndices, visualItems);
  if (!memberCheck.distinct) {
    return { promote: false, declineReason: memberCheck.reason, inputs: { ...inputs, ...memberCheck } };
  }
  return { promote: true, declineReason: null, inputs: { ...inputs, ...memberCheck } };
}

export const extractConfirmedVariant = (
  visualItems,
  visionVariant,
  bookYear,
  visionConfidence,
  // GrailKey Commit D1/D2 (2026-08-02, ASM #300 facsimile-injection
  // dispatch) — Vision's OWN structured printing/edition read
  // (grade.js JSON_SHAPE isReprint/editionType — deliberately prompted
  // "do NOT infer from cover-art recognition alone... default to false
  // when uncertain," stricter than the free-form `variant` field). Used
  // ONLY as a corroboration check for visionVariant's own printing-axis
  // content below (D2) — never as an independent adoption source, and
  // never touches the comp-pool consensus mechanism at all (D1).
  // Optional, default false/null — every pre-existing call site (there
  // is exactly one, api/enrich.js) is unaffected until it opts in.
  visionIsReprint = false,
  visionEditionType = null
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
  // GrailKey Commit D1 (2026-08-02) — printing/edition axis (reprint/
  // facsimile/Nth-print) tracked SEPARATELY from the consensus token
  // arrays above. Deliberately never joins allConventions/allExclusives/
  // allArtists/allLimitations and never gets a `consensus.printing`
  // entry below — a facsimile is a photographic reproduction of the
  // original cover; image search cannot distinguish a facsimile from a
  // first print by definition (a famous key's reverse-image pool is
  // routinely facsimile-dominated regardless of which printing the user
  // actually holds — same confound Q98 already ruled on for the
  // reprint-ratio polybag signal). Printing/edition status describes the
  // physical object in hand and may never be adopted from marketplace
  // comp text alone. Surfaced below as an informational reference
  // candidate only — never folded into confirmedVariant.
  const allPrintings = [];

  for (const item of visualItems) {
    const rawTitle = item?.rawTitle || '';
    if (!rawTitle) continue;
    consideredCount++;

    // Extract tokens using imageSearchIdentity helper
    const tokens = extractVariantTokens(rawTitle);

    // D1 — printing-axis tokens, reference-only (see comment above).
    const printingAxis = extractVariantTokensByAxis(rawTitle).printing;
    if (printingAxis.length > 0) allPrintings.push(printingAxis[0]);

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

  // GrailKey Dispatch 27, Fix 27-A (2026-08-08) — coverType consensus.
  // NOT the artist ratio gate's job and NOT subject to its majority
  // ceiling: an artist NAME is always true of every copy of a single-cover
  // book (100% agreement is uninformative about edition), but "virgin" /
  // "sketch" / "foil" is a disputable FACTUAL CLAIM about which PRODUCT is
  // being sold — a seller mislabeling a real Cover A copy "virgin" is
  // asserting something false, not citing an omnipresent truth for
  // searchability. Structurally the SAME shape as the authentication axis
  // just above (no majority ceiling, per that code's own reasoning: "a
  // signed sub-listing genuinely IS a distinguishing purchase option...
  // not an SEO-citation artifact"), not the artist axis. This is
  // NOT a reversal of GENERIC_VARIANT_KINDS/Q111 (imageSearchIdentity.js)
  // — that classification answers a different question (can this token
  // alone disambiguate WHICH of several competing specific variants two
  // listings describe — no, many different virgin covers all just say
  // "virgin") from this one (does near-unanimous pool agreement mean OUR
  // book itself is a virgin variant). Filter 1c and Q111's own
  // specific/generic split are untouched by this change.
  const coverTypeTally = tallyCoverTypeConsensus(visualItems);
  const coverTypePromotion = evaluateCoverTypeConsensusPromotion(coverTypeTally, visualItems);
  const coverTypeIndependence = coverTypePromotion.promote
    ? evaluateTitleTextIndependence(coverTypeTally.assertingRows.map((r) => r.rawTitle))
    : { pass: false, assertingRows: 0, distinctClusters: 0, largestClusterSize: 0, maxPairwiseJaccard: null, minPairwiseJaccard: null, clusters: [] };
  const coverTypeEligible = coverTypePromotion.promote && coverTypeIndependence.pass;
  // GK-155 (2026-08-22) — the independence fields above are a FALLBACK
  // placeholder, not a computed result, whenever coverTypePromotion.promote
  // is false: the ternary never calls evaluateTitleTextIndependence in
  // that case. Printing "independence.pass=false" next to a real
  // declineReason (e.g. runnerUp-present) read as two separate reasons
  // for decline when only one ever ran. Logged as "skipped=promotion-
  // declined" instead of the placeholder stats when independence was
  // never evaluated, so it no longer reads as a failed check.
  const independenceSection = coverTypePromotion.promote
    ? `independence.pass=${coverTypeIndependence.pass} assertingRows=${coverTypeIndependence.assertingRows} ` +
      `distinctClusters=${coverTypeIndependence.distinctClusters} largestClusterSize=${coverTypeIndependence.largestClusterSize} ` +
      `maxPairwiseJaccard=${coverTypeIndependence.maxPairwiseJaccard ?? 'n/a'} minPairwiseJaccard=${coverTypeIndependence.minPairwiseJaccard ?? 'n/a'} ` +
      `clusters=${JSON.stringify(coverTypeIndependence.clusters)}`
    : `independence=skipped(promotion-declined)`;
  console.log(
    `[coverType-consensus] ${coverTypeEligible ? 'FIRE' : 'DECLINE'} ` +
    `winner=${coverTypeTally.winner ?? 'null'} support=${coverTypeTally.support}/${coverTypeTally.uniqueRows} ` +
    `runnerUp=${coverTypeTally.runnerUp ?? 'null'} promotion.declineReason=${coverTypePromotion.declineReason ?? 'none'} ` +
    `uniqueItemIdCount=${coverTypePromotion.inputs.uniqueItemIdCount ?? 'n/a'}/${coverTypePromotion.inputs.itemIdCount ?? 'n/a'} ` +
    `uniqueSellerCount=${coverTypePromotion.inputs.uniqueSellerCount ?? 'n/a'}/${coverTypePromotion.inputs.sellerCount ?? 'n/a'} ` +
    `${independenceSection}`
  );
  if (coverTypeEligible) {
    consensus.coverType = coverTypeTally.winner;
  }

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
  // D1 — printing-axis reference candidate. Never joins `consensus`
  // (that dict is what `parts` below reads from), so it structurally
  // cannot reach confirmedVariant — surfaced here purely as an
  // informational reference for a future user-confirm prompt, only when
  // the function already has other consensus to return (a pool with
  // ONLY printing-axis agreement and nothing else returns null above,
  // same as before this dispatch — see D2's gate at the actual
  // unconditional injection point, api/enrich.js, for the real fix).
  const topPrinting = mode(allPrintings);
  const printingReferenceCandidate =
    topPrinting && count(allPrintings, topPrinting) >= 2 ? topPrinting : null;
  if (printingReferenceCandidate) {
    console.log(
      `[variant-identity] printing-axis reference candidate: "${printingReferenceCandidate}" ` +
      `(${count(allPrintings, topPrinting)}/${consideredCount}) — NOT adopted into confirmedVariant ` +
      `(D1: printing/edition status may never be adopted from marketplace comp text alone)`
    );
  }

  // D2 — Vision non-contradiction gate. visionVariant's OWN printing-axis
  // content (e.g. Vision's free-form variant field literally reading
  // "facsimile") is only trustworthy when corroborated by Vision's own,
  // separately and more strictly prompted structured fields
  // (isReprint/editionType — grade.js JSON_SHAPE: "EXPLICIT indicators
  // only... Do NOT infer from cover-art recognition alone... default to
  // false when uncertain"). Uncorroborated, it is not adopted — the
  // override-path passthrough below drops it rather than blindly
  // including it. This mirrors the primary fix applied at the true
  // unconditional injection point (api/enrich.js, where confirmedVariant
  // is DEFAULT-initialized from the same raw value even when this
  // function finds no pool consensus at all and returns null early) —
  // defense-in-depth for the case pool consensus DOES fire alongside an
  // uncorroborated Vision printing claim.
  let effectiveVisionVariant = visionVariant;
  let visionPrintingConflict = null;
  if (!isBackfill && visionVariant) {
    const claimCheck = validateVisionPrintingClaim(visionVariant, visionIsReprint, visionEditionType);
    if (claimCheck.conflict) {
      visionPrintingConflict = claimCheck.conflict;
      effectiveVisionVariant = null;
      console.log(
        `[variant-identity] D2 conflict: visionVariant="${visionVariant}" claims a printing/edition ` +
        `status not corroborated by structured fields (isReprint=${visionIsReprint}, ` +
        `editionType="${visionEditionType || 'null'}") — not adopted, surfaced as conflict only`
      );
    }
  }

  // GK-155 (2026-08-22) — token-set idempotent build. Before this fix,
  // `parts` pushed effectiveVisionVariant WHOLESALE and then separately
  // pushed each corroborating consensus field with no check for whether
  // that word was already present in the Vision string — a pool that
  // independently corroborates "exclusive"/"limited" alongside a Vision
  // read that already SAYS "exclusive limited signed virgin" produced
  // "exclusive limited signed virgin exclusive limited" (byte-identical
  // real production case, G.I. Joe #5 Kirkham virgin, 2026-08-22). The
  // duplicated text reached the live eBay search query and the active-
  // comp cache key, not just the display string. Fixed by tracking
  // already-added tokens (case-insensitive, whole-word) and only
  // appending the NEW words each phrase contributes — first occurrence
  // wins, relative phrase order is preserved, a phrase contributing
  // nothing new is dropped entirely rather than appended as an empty
  // string.
  const seenVariantTokens = new Set();
  const parts = [];
  const pushDedupedVariantPhrase = (phrase) => {
    if (!phrase) return;
    const words = String(phrase).trim().split(/\s+/).filter(Boolean);
    const newWords = words.filter((w) => !seenVariantTokens.has(w.toLowerCase()));
    newWords.forEach((w) => seenVariantTokens.add(w.toLowerCase()));
    if (newWords.length > 0) parts.push(newWords.join(' '));
  };
  if (!isBackfill && effectiveVisionVariant) pushDedupedVariantPhrase(String(effectiveVisionVariant).trim());
  // GrailKey Dispatch 27, Fix 27-A — coverType placed first among the
  // consensus tokens (base physical-product classifier; convention/
  // exclusive/artist/limitation are additional distinguishing facts
  // layered on top of it, not alternatives to it).
  pushDedupedVariantPhrase(consensus.coverType);
  pushDedupedVariantPhrase(consensus.convention);
  pushDedupedVariantPhrase(consensus.exclusive);
  pushDedupedVariantPhrase(consensus.artist);
  pushDedupedVariantPhrase(consensus.limitation);

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
    // D1 — printing-axis reference candidate, informational only.
    printingReferenceCandidate,
    // D2 — non-null only when visionVariant's own printing claim was
    // rejected for lack of structured-field corroboration.
    visionPrintingConflict,
  };
};
