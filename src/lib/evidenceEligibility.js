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
];

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
        rejectionCodes.push('WRONG_YEAR');
        identityEligible = false;
      }
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
    identityEligible && !formatMismatch && !conditionOrEditionDisqualified;

  // A legitimate graded copy of the same book — target-relative display
  // eligibility, independent of whether the CURRENT target is raw or
  // graded (Commit D Fixture 2: gradedPricingEligible=true for a CGC 2.5
  // row even while scanning a raw VG 4.0 target).
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
 * five required populations. Every row lands in exactly one bucket —
 * never silently discarded down to a bare counter.
 *
 * @param {Array} rows
 * @param {Object} target - see classifyEvidenceRow
 * @returns {{rawPricingPool: Array, gradedPricingReferences: Array,
 *   incompleteReferences: Array, incompatibleEditionReferences: Array,
 *   rejectedEvidence: Array}}
 */
export const buildEvidencePopulations = (rows, target = {}) => {
  const populations = {
    rawPricingPool: [],
    gradedPricingReferences: [],
    incompleteReferences: [],
    incompatibleEditionReferences: [],
    rejectedEvidence: [],
  };

  for (const row of (rows || [])) {
    const classification = classifyEvidenceRow(row, target);
    if (classification.rawPricingEligible) {
      populations.rawPricingPool.push(row);
      continue;
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
export const PRICING_GATE_CODES = ['INCOMPLETE_COPY', 'RESTORED_COPY', 'FORMAT_MISMATCH_RAW_VS_SLAB'];
export const isPricingMathEligible = (classification) =>
  !classification.rejectionCodes.some((c) => PRICING_GATE_CODES.includes(c));

export { STANDARD_REJECTION_CODES };
