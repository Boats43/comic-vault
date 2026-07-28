// Evidence-eligibility classification — Commit D1 (2026-07-28).
//
// Classifies every active and sold market row against the scanned target
// BEFORE any destructive filtering discards it. A rejected row is never
// dropped down to a bare counter — it's retained as a sanitized reference
// record (title/price/marketState/detectedFormat/rejectionCodes only, no
// seller/postal-code/item-ID/private marketplace metadata) so I13
// (log-card fidelity) can render it as a labeled, non-verified reference
// group instead of it silently vanishing.
//
// Deliberately reuses the exact detection signals api/comps.js and
// src/lib/soldVerification.js already trust (SLAB_RE/GRADED_RE,
// COVERLESS_RE, REPRINT_RE, VARIANT_CONTAM_RE, LOT_RE, HALF_ISSUE_RE,
// SIGNED_RE, TPB_MARKER_RE, hasIssueNumber, evaluateEraYearMatch,
// getEraYearTolerance, isValidIssueRange, hasCrossSeriesSeparator,
// isEnumeratedIssueList) rather than forking new regexes that could drift
// from the formal filter chains those two files already run. Two
// title-text signals had no existing detector anywhere in the codebase —
// INCOMPLETE_COPY (missing centerfold/pages/back cover, distinct from
// COVERLESS_COPY) and RESTORED_COPY (title-text restoration language,
// distinct from api/enrich.js's IMPAIRED_LABEL_RE, which reads a CGC
// cert/Vision slab-label field, not a market row's own title text) —
// those two are defined here, in the shared-primitives home this codebase
// already uses for cross-pipeline regex (compHygiene.js's own stated
// purpose), not duplicated per call site.
//
// GRADED_RE (not SLAB_RE) drives raw-vs-graded classification here.
// SLAB_RE requires "CGC/CBCS" immediately adjacent to a numeric grade
// (built for a stricter, different purpose — the formal per-attempt hard
// slab filter) and misses number-before-designation orderings like
// "Flash #139 2.5 Cgc Menace Of The Reverse Flash" (confirmed live,
// Commit D Fixture 2) — GRADED_RE's bare CGC/CBCS-anywhere test catches
// it regardless of word order, and is already exported from
// compHygiene.js for exactly this raw/graded-separation purpose
// (applyRawGradedSeparationFilter).

import {
  GRADED_RE,
  COVERLESS_RE,
  REPRINT_RE,
  VARIANT_CONTAM_RE,
  LOT_RE,
  HALF_ISSUE_RE,
  SIGNED_RE,
  hasIssueNumber,
  isValidIssueRange,
  hasCrossSeriesSeparator,
  isEnumeratedIssueList,
  getEraYearTolerance,
  evaluateEraYearMatch,
  IDENTITY_TPB_MARKER_RE,
} from './compHygiene.js';
import { extractYearFromTitle } from './imageSearchIdentity.js';

// Title-text incompleteness. Explicit missing-part language only —
// deliberately excludes "loose" (a structural condition descriptor, not a
// completeness signal) per Commit D Fixture 1: "2 CF loose" must NOT
// trigger; "missing CF" / "BC missing" must. Both word orders covered
// (sellers write "missing CF" and "BC missing" interchangeably).
export const INCOMPLETE_COPY_RE =
  /\bmissing\s+(?:cf|centerfold|centre\s*fold|pages?|bc|back\s*cover|front\s*cover|cover)\b|\b(?:cf|centerfold|centre\s*fold|bc|back\s*cover|front\s*cover|pages?)\s+missing\b|\bpartial\s+cover\b|\b(?:photocopy|photocopied|reproduction)\s+pages?\b|\bincomplete\s+copy\b/i;

// Title-text restoration/conservation language on a market row itself.
// Same vocabulary root as enrich.js's label-based IMPAIRED_LABEL_RE
// (qualified|restored|conserved) but a different data source (a comp's
// own listing title, not our scanned book's CGC cert/Vision label) — both
// legitimately coexist, same relationship as SLAB_RE vs GRADED_RE above.
export const RESTORED_TITLE_RE =
  /\b(?:restored|restoration|conserved|amateur\s*repair|professional\s*restoration|color\s*touch|married\s*pages?)\b/i;

// Explicit "1st/first printing" language — the bidirectional counterpart
// REPRINT_RE alone can't provide (REPRINT_RE only recognizes an Nth/
// facsimile printing as reprint language; it has no alternative for the
// ORIGINAL printing, since that's normally the unmarked default). Needed
// only when the TARGET is itself a later printing (Commit D Fixture 5).
const FIRST_PRINT_EXPLICIT_RE = /\b(?:1st|first)\s*print(?:ing)?\b/i;

const STANDARD_REJECTION_CODES = [
  'FORMAT_MISMATCH_RAW_VS_SLAB',
  'FORMAT_MISMATCH_GRADED_VS_RAW',
  'INCOMPLETE_COPY',
  'COVERLESS_COPY',
  'RESTORED_COPY',
  'WRONG_ISSUE',
  'WRONG_YEAR',
  'WRONG_PRINTING',
  'WRONG_VARIANT',
  'LOT_OR_BUNDLE',
  'SIGNED_MISMATCH',
  'COLLECTED_EDITION_MISMATCH',
  'UNCONFIRMED_EDITION',
];

// Commit D1.1 (2026-07-28) — collision-aware positive-compatibility gate.
// The base classifier above is a NEGATIVE model: a row is eligible unless
// it affirmatively fails a check. Confirmed live-broken for collision-
// prone identities (Batman #15, 1943): 5 generic active listings with NO
// distinguishing edition information ("BATMAN #15", $2.99-$9.79) triggered
// zero of the negative checks above (no wrong issue, no wrong year — they
// simply have no year token at all — no lot/variant/format signal) and
// sailed through as rawPricingEligible=true, contaminating the active
// average/floor/market-high warning with listings that could just as
// easily be the 1943 original, a 2013 New 52 relaunch, or a 2017 Rebirth
// relaunch #15 — DC has renumbered Batman's ongoing series repeatedly,
// each restart reusing low issue numbers.
//
// assessCollisionRisk derives which comparison axes actually need
// POSITIVE confirmation for a given target, rather than a blanket
// "missing year = reject" rule (which would incorrectly punish unambiguous,
// non-collision titles — a 2020 creator-owned one-shot's #1 has no
// competing volume to be confused with). Deliberately title-text-free —
// uses only confirmedYear + publisher, both passed as separate structured
// fields, never the raw confirmedTitle string (which can itself be
// contaminated by an unrelated open bug — the A3 canonical-title issue
// flagged in this same dispatch, "batman ww2 machine gun" — this function
// must not inherit that bug by depending on title text).
//
// Heuristic: a vintage (pre-1985, matching this codebase's own
// getEra()/COMP_FILTER era-boundary convention) DC or Marvel title is
// high collision-risk — both publishers have decades of legacy-numbering
// relaunch history (Batman, Detective Comics, Action Comics, Superman,
// Amazing Spider-Man, Fantastic Four, X-Men, Avengers, etc. have all been
// renumbered at least once, reusing low issue numbers). A non-vintage or
// non-major-publisher target defaults to low collision risk — missing
// year alone does not disqualify a row there, unchanged from pre-D1.1
// behavior (the existing WRONG_YEAR check already only fires when a row
// DOES carry a conflicting year; this only adds a requirement when
// collision risk is genuinely high).
const MAJOR_LEGACY_PUBLISHER_RE = /\b(dc|d\.c\.|marvel)\b/i;
const VINTAGE_YEAR_CUTOFF = 1985; // matches getEra(year) in api/enrich.js

export const assessCollisionRisk = (target = {}) => {
  const year = target.confirmedYear != null ? parseInt(target.confirmedYear, 10) : null;
  const isVintage = Number.isFinite(year) && year < VINTAGE_YEAR_CUTOFF;
  const isMajorLegacyPublisher = MAJOR_LEGACY_PUBLISHER_RE.test(String(target.publisher || ''));

  const requiredAxes = ['series', 'issue'];
  const collisionReasons = [];
  let collisionRisk = 'low';

  if (isVintage && isMajorLegacyPublisher) {
    collisionRisk = 'high';
    requiredAxes.push('publicationIdentity');
    collisionReasons.push(
      'same normalized series and issue exists across multiple eras/volumes ' +
      '(vintage DC/Marvel ongoing series — legacy-numbering relaunch history)'
    );
  }
  // If the target has a confirmed printing (Nth print / facsimile) or a
  // confirmed material/variant, those axes are already required by the
  // existing WRONG_PRINTING/WRONG_VARIANT checks below — surfaced here
  // for completeness of the identity-requirements record, not yet given
  // an "unconfirmed" (vs. "incompatible") treatment of their own: no
  // fixture has demonstrated that gap the way Batman #15 demonstrated the
  // publicationIdentity one. Flagged for a future pass if one does.
  if (REPRINT_RE.test(String(target.variant || ''))) {
    requiredAxes.push('printing');
  }
  if (target.variant && !REPRINT_RE.test(String(target.variant))) {
    requiredAxes.push('materialVariant');
  }

  return {
    baseTitle: target.seriesTitleBase || null,
    issue: target.issue ?? null,
    confirmedYear: year,
    requiredAxes,
    collisionRisk,
    collisionReasons,
  };
};

/**
 * Classify one market row (active listing or sold row) against the
 * scanned target. Pure, no I/O, no mutation of `row`. Does not decide
 * whether a row is discarded — only what it's eligible to contribute to.
 * Eligibility is evaluated relative to the target: the SAME CGC 2.5 row
 * can be gradedPricingEligible=true (it's a legitimate graded copy of the
 * same book) while rawPricingEligible=false and floorEligible=false for a
 * raw-target scan.
 *
 * @param {Object} row - { title, price, marketState: 'active'|'sold', year }
 * @param {Object} target - {
 *   issue, seriesTitle, confirmedYear, cvVolumeStartYear, variant,
 *   isGraded, userGradeKey, assetType: 'comic'|'tpb'|'book', isSignedTarget
 * }
 * @returns {{identityEligible: boolean, rawPricingEligible: boolean,
 *   gradedPricingEligible: boolean, floorEligible: boolean,
 *   referenceOnly: boolean, rejectionCodes: string[]}}
 */
export const classifyEvidenceRow = (row, target = {}) => {
  const title = String(row?.title || '');
  const rejectionCodes = [];
  const targetIsGraded = target.isGraded === true;
  const rowIsGraded = GRADED_RE.test(title);

  // Identity axis: is this genuinely the same book (issue/year, not a
  // lot/bundle), independent of format/condition/edition eligibility.
  let identityEligible = true;

  if (target.issue != null && String(target.issue).length > 0 &&
      !hasIssueNumber(title, target.issue, target.seriesTitle || null)) {
    rejectionCodes.push('WRONG_ISSUE');
    identityEligible = false;
  }

  // Commit D1.1 — collision-aware. requiredAxes is derived purely from
  // confirmedYear/publisher (never confirmedTitle text — see
  // assessCollisionRisk's own doc comment for why).
  const collisionAssessment = assessCollisionRisk(target);
  const publicationIdentityRequired = collisionAssessment.requiredAxes.includes('publicationIdentity');
  let unconfirmedEdition = false;

  if (target.confirmedYear != null) {
    const rowYear = row.year != null
      ? parseInt(row.year, 10)
      : (() => {
          const y = extractYearFromTitle(title);
          return y ? parseInt(y, 10) : null;
        })();
    if (rowYear != null && Number.isFinite(rowYear)) {
      const tolerance = getEraYearTolerance(target.confirmedYear);
      const yearEval = evaluateEraYearMatch(rowYear, target.confirmedYear, tolerance, target.cvVolumeStartYear ?? null);
      if (!yearEval.keep) {
        // Affirmatively conflicting year — the row DOES claim a year, and
        // it's outside tolerance. A genuine, stated mismatch.
        rejectionCodes.push('WRONG_YEAR');
        identityEligible = false;
      }
    } else if (publicationIdentityRequired) {
      // Commit D1.1 — the fix. No year token at all, but this target is
      // collision-prone (vintage DC/Marvel — the same title+issue exists
      // across multiple eras/volumes). Absence of evidence is NOT
      // evidence of a wrong book — this row never claimed an incorrect
      // year, it simply provided none. UNCONFIRMED_EDITION, not
      // WRONG_YEAR: identityEligible stays true (we are not asserting
      // this is a different book), but the row cannot enter pricing math
      // until it clears the collision on some other positive signal
      // (this classifier only evaluates the year axis — cover-image
      // match, ePID, and other provider-backed discriminators named in
      // the D1.1 dispatch are not evaluable from title-only market rows
      // in this codebase's current data shape).
      unconfirmedEdition = true;
      rejectionCodes.push('UNCONFIRMED_EDITION');
    }
  }

  if (
    LOT_RE.test(title) ||
    isValidIssueRange(title) ||
    hasCrossSeriesSeparator(title) ||
    isEnumeratedIssueList(title) ||
    HALF_ISSUE_RE.test(title)
  ) {
    rejectionCodes.push('LOT_OR_BUNDLE');
    identityEligible = false;
  }

  // Printing/edition — bidirectional. Mirrors api/comps.js Filter 1's
  // existing our-book-is-Nth-print skip for the "target is plain, row is
  // a reprint" direction, PLUS the reverse (Commit D Fixture 5: target IS
  // itself "second printing" — a row explicitly labeled the original/1st
  // printing is just as much a wrong-edition mismatch as the reverse).
  const targetText = String(target.variant || '');
  const targetIsReprintEdition = REPRINT_RE.test(targetText);
  const rowIsReprintEdition = REPRINT_RE.test(title);
  const rowIsExplicitFirstPrint = FIRST_PRINT_EXPLICIT_RE.test(title);
  const wrongPrinting =
    (!targetIsReprintEdition && rowIsReprintEdition) ||
    (targetIsReprintEdition && !rowIsReprintEdition && rowIsExplicitFirstPrint);
  if (wrongPrinting) rejectionCodes.push('WRONG_PRINTING');

  // Variant contamination — token-precise, not a bare truthy check on
  // target.variant. A target variant string can be non-empty without
  // being a foil/virgin/ratio marker itself (Commit D Fixture 5: target
  // variant is "second printing" — a row matching a DIFFERENT variant
  // contamination word, "foil"/"virgin", is still a mismatch even though
  // target.variant is non-empty; the blunt !target.variant guard
  // api/comps.js Filter 1b uses would have missed this). Flags only when
  // the row's specific matched contamination word is absent from the
  // target's own variant text.
  const variantContamMatch = title.match(VARIANT_CONTAM_RE);
  const wrongVariant = !!variantContamMatch &&
    !new RegExp(variantContamMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(targetText);
  if (wrongVariant) rejectionCodes.push('WRONG_VARIANT');

  // Collected-edition mismatch — our target is a single issue, row is a
  // TPB/HC/omnibus/collected-edition listing. Uses IDENTITY_TPB_MARKER_RE,
  // not TPB_MARKER_RE: the latter's bare "absolute"/"deluxe"/"treasury"
  // alternatives are deliberately edition-suffix-optional for a resolved
  // book's PRICING pool (documented safe there), but this classifier runs
  // against a CONFIRMED target that can itself legitimately be titled
  // "Absolute Batman" (DC's 2024+ ongoing line) — TPB_MARKER_RE's bare
  // "absolute" would match every genuine row of that book's own title.
  // IDENTITY_TPB_MARKER_RE requires the edition suffix on all three
  // ambiguous terms, closing exactly this collision (confirmed live by
  // this file's own Commit D Fixture 5 test).
  const collectedEditionMismatch = target.assetType !== 'tpb' && IDENTITY_TPB_MARKER_RE.test(title);
  if (collectedEditionMismatch) rejectionCodes.push('COLLECTED_EDITION_MISMATCH');

  // Signed mismatch — our target isn't signed, row is.
  const signedMismatch = !target.isSignedTarget && SIGNED_RE.test(title);
  if (signedMismatch) rejectionCodes.push('SIGNED_MISMATCH');

  // Completeness / restoration / coverless — condition-class rejections,
  // independent of format or edition.
  const incompleteHit = INCOMPLETE_COPY_RE.test(title);
  const coverlessHit = COVERLESS_RE.test(title);
  const restoredHit = RESTORED_TITLE_RE.test(title);
  if (incompleteHit) rejectionCodes.push('INCOMPLETE_COPY');
  if (coverlessHit) rejectionCodes.push('COVERLESS_COPY');
  if (restoredHit) rejectionCodes.push('RESTORED_COPY');

  // Format — raw vs. graded, target-relative, bidirectional.
  let formatMismatch = false;
  if (!targetIsGraded && rowIsGraded) {
    rejectionCodes.push('FORMAT_MISMATCH_RAW_VS_SLAB');
    formatMismatch = true;
  } else if (targetIsGraded && !rowIsGraded) {
    rejectionCodes.push('FORMAT_MISMATCH_GRADED_VS_RAW');
    formatMismatch = true;
  }

  const conditionOrEditionDisqualified =
    incompleteHit || coverlessHit || restoredHit ||
    wrongPrinting || wrongVariant || collectedEditionMismatch || signedMismatch;

  const rawPricingEligible =
    identityEligible && !formatMismatch && !conditionOrEditionDisqualified && !unconfirmedEdition;

  // A legitimate graded copy of the same book — target-relative display
  // eligibility, independent of whether the CURRENT target is raw or
  // graded (Commit D Fixture 2: gradedPricingEligible=true for a CGC 2.5
  // row even while scanning a raw VG 4.0 target).
  // Not gated by unconfirmedEdition (Commit D1.1 fixture requirement:
  // "Flash #139 2.5 Cgc Menace Of The Reverse Flash" carries no year token
  // either — Flash 1963/DC is itself a high collision-risk target — but
  // must still report gradedPricingEligible=true. gradedPricingEligible is
  // a weaker "plausible reference for the same book" signal for display
  // purposes, not a pricing gate; unconfirmedEdition's job is specifically
  // to keep an under-evidenced row OUT of pricing math (rawPricingEligible/
  // floorEligible), not to erase it as a reference candidate too.
  const gradedPricingEligible =
    identityEligible && !conditionOrEditionDisqualified && rowIsGraded;

  // Floor is an active-pool-only concept in this codebase (rawComps.lowest —
  // sold rows never establish a floor). Never inferred merely because a
  // row happens to have the lowest asking price — it's the SAME
  // eligibility test as rawPricingEligible, just additionally scoped to
  // active listings only.
  const floorEligible = rawPricingEligible && row.marketState === 'active';

  const referenceOnly = !rawPricingEligible;

  return {
    identityEligible,
    rawPricingEligible,
    gradedPricingEligible,
    floorEligible,
    referenceOnly,
    rejectionCodes,
  };
};

// Sanitized display record for a reference-only row. Deliberately narrow —
// title/price/state/format/codes only. No seller, postal code, item ID,
// request object, or private marketplace metadata.
const sanitizeForDisplay = (row, classification) => ({
  title: row.title ?? null,
  price: row.price ?? null,
  marketState: row.marketState || null,
  detectedFormat: GRADED_RE.test(String(row.title || '')) ? 'graded' : 'raw',
  rejectionCodes: classification.rejectionCodes,
});

/**
 * Classify a full pool of raw rows against a target and split into the
 * required populations. Every row lands in exactly one bucket — never
 * silently discarded down to a bare counter.
 *
 * unconfirmedEditionReferences (Commit D1.1) is deliberately separate from
 * incompatibleEditionReferences: the latter holds rows that AFFIRMATIVELY
 * claim a mismatching year/printing/issue; the former holds rows that
 * simply provide no evidence either way on a collision-prone axis. Display
 * label: "Unconfirmed same-title/issue references" — never merged with
 * "incompatible," which would mislabel an under-evidenced row as if it had
 * made a false claim.
 *
 * @param {Array} rows
 * @param {Object} target - see classifyEvidenceRow
 * @returns {{rawPricingPool: Array, gradedPricingReferences: Array,
 *   incompleteReferences: Array, incompatibleEditionReferences: Array,
 *   unconfirmedEditionReferences: Array, rejectedEvidence: Array}}
 */
export const buildEvidencePopulations = (rows, target = {}) => {
  const populations = {
    rawPricingPool: [],
    gradedPricingReferences: [],
    incompleteReferences: [],
    incompatibleEditionReferences: [],
    unconfirmedEditionReferences: [],
    rejectedEvidence: [],
    // Commit D1.1 — bounded (fixed code enum, one increment per row) count
    // of every rejection code actually fired across the pool, so a live
    // trace can show WHICH classifications produced a given reduction
    // (e.g. "chain-survivors=17 -> classification-eligible=15") instead of
    // only the aggregate before/after counts.
    rejectionCodeCounts: {},
  };

  for (const row of (rows || [])) {
    const classification = classifyEvidenceRow(row, target);
    if (classification.rawPricingEligible) {
      populations.rawPricingPool.push(row);
      continue;
    }
    for (const code of classification.rejectionCodes) {
      populations.rejectionCodeCounts[code] = (populations.rejectionCodeCounts[code] || 0) + 1;
    }
    const sanitized = sanitizeForDisplay(row, classification);
    const codes = classification.rejectionCodes;
    if (codes.includes('FORMAT_MISMATCH_RAW_VS_SLAB')) {
      populations.gradedPricingReferences.push(sanitized);
    } else if (codes.includes('INCOMPLETE_COPY') || codes.includes('COVERLESS_COPY') || codes.includes('RESTORED_COPY')) {
      populations.incompleteReferences.push(sanitized);
    } else if (
      codes.includes('WRONG_ISSUE') || codes.includes('WRONG_YEAR') ||
      codes.includes('WRONG_PRINTING') || codes.includes('WRONG_VARIANT') ||
      codes.includes('COLLECTED_EDITION_MISMATCH') || codes.includes('LOT_OR_BUNDLE')
    ) {
      populations.incompatibleEditionReferences.push(sanitized);
    } else if (codes.includes('UNCONFIRMED_EDITION')) {
      populations.unconfirmedEditionReferences.push(sanitized);
    } else {
      populations.rejectedEvidence.push(sanitized);
    }
  }

  return populations;
};

// Codes this codebase had NO prior detector for at all (INCOMPLETE_COPY,
// RESTORED_COPY) or a proven, narrow gap in an existing detector
// (FORMAT_MISMATCH_RAW_VS_SLAB — SLAB_RE requires "CGC" immediately
// before a numeric grade and misses "2.5 Cgc ..." orderings; GRADED_RE
// catches it). Reserved for the PRICING-MATH gate specifically —
// deliberately narrower than the full classification `rawPricingEligible`
// above, which also flags identity/variant/printing/lot mismatches that
// api/comps.js and src/lib/soldVerification.js's own, considerably more
// mature filter chains already handle with edge-case nuance (artist
// partial-match, unparseable-grade grace, format-asymmetry markers,
// annual/half-issue distinctions, etc.) this classifier does not
// replicate. Confirmed empirically during Commit D1 implementation:
// gating pricing math on the full `rawPricingEligible` flag regressed 11
// previously-passing tests/sold-verification.test.js assertions with no
// mandatory-fixture requiring it — narrowed back to exactly the codes the
// 5 mandatory fixtures actually need enforced as a second, independent
// gate. buildEvidencePopulations still uses the FULL classification for
// its display/reference buckets — every mismatch category still gets
// annotated (I13), only the subset that may additionally EXCLUDE a row
// from pricing math is narrower here.
// Commit D1.1 adds UNCONFIRMED_EDITION — the live-confirmed active-pool
// defect this dispatch fixes. Narrow and safe to gate: it only fires when
// collisionRisk="high" (vintage DC/Marvel target) AND the row has zero
// year evidence — a condition that could not have overlapped any of the
// existing test fixtures this codebase already had passing (none of them
// combine a vintage-DC/Marvel target with an undated comp row expected to
// survive), confirmed by the full-suite regression run in this commit's
// own test delivery.
export const PRICING_GATE_CODES = ['INCOMPLETE_COPY', 'RESTORED_COPY', 'FORMAT_MISMATCH_RAW_VS_SLAB', 'UNCONFIRMED_EDITION'];
export const isPricingMathEligible = (classification) =>
  !classification.rejectionCodes.some((c) => PRICING_GATE_CODES.includes(c));

// Commit E (2026-07-28) — catalog ladder reference. Same family as the
// buildEvidencePopulations buckets above (rawPricingPool/
// gradedPricingReferences/incompleteReferences/unconfirmedEditionReferences/
// rejectedEvidence), but structurally different: those are per-row
// classifications of comps; this is a single aggregate reference object
// sourced from PriceCharting's own per-grade price ladder (`priceLadder`,
// api/pricecharting-pop.js's extractPriceLadder — a flat {gradeKey: price}
// object scraped from the product page), surfaced ONLY when there is
// otherwise zero comp-based evidence to price from at all.
//
// Trigger (all four required):
//   1. rawPricingPool is empty (POST-classification, both active and sold
//      sides — not a pre-classification raw count).
//   2. gradedPricingReferences is empty (POST-classification, both sides).
//   3. An exact PriceCharting product anchor was accepted for this book.
//   4. The ladder has a value at the EXACT confirmed-grade key.
//
// Deliberately does NOT trigger on PC population/census count — population
// is scarcity (how many copies CGC has graded), not sale-sample depth; the
// two were explicitly ruled non-equivalent earlier in this campaign.
//
// V1 does not interpolate between rungs: this function does a single exact-
// key lookup. If the confirmed grade has no exact rung, this returns null —
// no synthesized/interpolated value, no nearest-neighbor substitution.
//
// rungProvenance is always "unknown" with the current data source:
// PriceCharting's scraped HTML carries no field distinguishing a rung PC
// itself directly observed from one it interpolated/estimated between two
// real data points (confirmed by direct source inspection of
// extractPriceLadder and its regex — no such signal exists to read). The
// type union `"unknown" | "direct" | "interpolated"` is kept open for a
// future data source that DOES expose this, not because "unknown" is
// expected to change under the current one.
//
// contributesToReadyValue is always false and automatedListingAllowed is
// always false — this is display-only. It must never populate Quick/
// Market/Stretch bands (a separate, unrelated mechanism — tier 4's
// existing pc_estimate pricing, computePriceBands in priceBands.js, is
// untouched by this function and continues to set out.price exactly as it
// did before Commit E) and must never itself enable a listing action (Step
// 2A's review-contract gate governs that, regardless of source).
export const assessCatalogLadderReference = ({
  rawPricingPoolEmpty,
  gradedReferencesEmpty,
  pcAnchorAccepted,
  priceLadder,
  gradeKey,
} = {}) => {
  if (!rawPricingPoolEmpty || !gradedReferencesEmpty) return null;
  if (!pcAnchorAccepted) return null;
  if (!priceLadder || typeof priceLadder !== 'object') return null;
  if (!gradeKey) return null;

  const rungValue = priceLadder[gradeKey];
  if (typeof rungValue !== 'number' || !(rungValue > 0)) return null;

  return {
    pricingSource: 'catalog_ladder_reference',
    valuationAuthority: 'compatible-reference',
    automatedListingAllowed: false,
    contributesToReadyValue: false,
    rungProvenance: 'unknown',
    rungGrade: gradeKey,
    rungValue,
  };
};

export { STANDARD_REJECTION_CODES };
