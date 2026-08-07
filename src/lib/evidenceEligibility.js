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
  extractVariantTokensByAxis,
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

// Track B Phase 0, Commit 1.1 (2026-07-29) — asset types with no issue axis
// at all. TPBs/books/collected editions are legitimately issue-less; a null
// target.issue on one of these is NOT the "genuinely unresolved" state
// TARGET_ISSUE_UNRESOLVED exists to catch (Commit A.2/A.4's Strange Tales
// class, a single-issue comic whose identity resolution genuinely failed) —
// it's the correct, permanent shape of that book. Confirmed by direct
// source check: api/comps.js and soldVerification.js only ever pass
// assetType 'tpb' or 'comic' today (never 'book') — 'book'/'collected' are
// included here anyway, forward-safe for the not-yet-built BookAdapter
// (CLAUDE.md's Session 4A), not because a live caller needs them yet.
const NO_ISSUE_AXIS_ASSET_TYPES = ['tpb', 'book', 'collected'];

// Commit C.2 (Strange Tales dispatch, 2026-07-28) — year-evidence
// semantics. extractYearFromTitle (imageSearchIdentity.js) extracts a bare
// 4-digit year with zero awareness of WHAT that year describes — "Strange
// Tales #142 (1951-76 1st Series) Marvel" extracts "1951" identically to a
// genuine single-issue cover date, even though #142 (and #76, same
// pattern) were both plausibly published well into the 1960s/1970s by
// this pool's own internal series-pace evidence. That misclassified
// "1951" then passed straight into evaluateEraYearMatch as if it were
// this SPECIFIC issue's own publication year, letting badly wrong-era
// comps survive era filtering. Only an ISSUE_PUBLICATION_YEAR classification
// may satisfy an exact issue-year comparison — SERIES_START_YEAR and
// SERIES_RANGE are treated as "no year evidence" (same as a genuinely
// undated listing), which correctly routes into the SAME
// publicationIdentity/UNCONFIRMED_EDITION path Commit D1.1 already built,
// rather than being silently accepted as if it were a match.
//
// Range checked FIRST (more specific evidence than a bare series-start
// phrase) — "(1951-76 1st Series)" carries both an explicit range AND the
// words "1st Series"; the range alone is sufficient to disqualify this as
// issue-specific evidence regardless of what else is nearby.
const SERIES_RANGE_YEAR_RE = /\b(19\d{2}|20\d{2})\s*[-–—]\s*(?:'?\d{2}|\d{4})\b/;
const SERIES_START_YEAR_RE = /\b(19\d{2}|20\d{2})\s*(?:series|1st\s*series|first\s*series)\b|\bsince\s*(19\d{2}|20\d{2})\b/i;

export const classifyYearEvidence = (title) => {
  const t = String(title || '');
  if (!t) return { class: 'SELLER_CONTEXT_UNKNOWN', year: null };

  const rangeMatch = t.match(SERIES_RANGE_YEAR_RE);
  if (rangeMatch) return { class: 'SERIES_RANGE', year: rangeMatch[1] };

  const seriesStartMatch = t.match(SERIES_START_YEAR_RE);
  if (seriesStartMatch) {
    return { class: 'SERIES_START_YEAR', year: seriesStartMatch[1] || seriesStartMatch[2] };
  }

  const y = extractYearFromTitle(t);
  if (y) return { class: 'ISSUE_PUBLICATION_YEAR', year: y };

  return { class: 'SELLER_CONTEXT_UNKNOWN', year: null };
};

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
  'TARGET_ISSUE_UNRESOLVED',
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
  // GrailKey Dispatch 25 (2026-08-07), Fix 1 STEP 1 — instrumentation
  // ONLY. Pairs each pushed rejectionCodes entry with the exact
  // predicate/values that produced it. Never read by any eligibility
  // decision in this file — rejectionCodes/identityEligible/
  // rawPricingEligible/gradedPricingEligible/floorEligible/
  // referenceOnly are computed identically to before this change, from
  // the same conditions, in the same order. This array exists solely so
  // [evidence-eligibility-reject] (api/comps.js call site) can print
  // WHY, not just WHICH code, without a second reviewer needing to
  // re-read this function's internals to translate a bare code back
  // into the comparison that produced it.
  const rejectionDetails = [];
  const targetIsGraded = target.isGraded === true;
  const rowIsGraded = GRADED_RE.test(title);

  // Identity axis: is this genuinely the same book (issue/year, not a
  // lot/bundle), independent of format/condition/edition eligibility.
  let identityEligible = true;

  // Commit A.2 (Strange Tales dispatch, 2026-07-28) — the base D1 model
  // is negative-only: no explicit check means a row passes by default.
  // That's correct when target.issue is a real, resolved number (the
  // WRONG_ISSUE check below governs it) but is a genuine blind spot when
  // the issue is UNRESOLVED (target.issue == null, a real "identity
  // genuinely unknown" state, not "not yet computed") — every row
  // silently passed the issue axis unconditionally, exactly the gap that
  // let a "Strange Tales #1"-textured query and its resulting comps price
  // a book whose own confirmedIssue was null. Absence of a target issue
  // is not a reason to skip the check; it's a reason every row fails it.
  // Same class of fix as D1.1's UNCONFIRMED_EDITION (closing the "missing
  // evidence silently treated as compatible" blind spot) — here for the
  // issue axis, unconditionally, on every target, not gated by collision
  // risk (an unresolved issue is unresolved regardless of publisher/era).
  let comparabilityStatus = null;
  // Track B Phase 0, Commit 1.1 — TPB/book/collected targets have no issue
  // axis at all; skip both issue-axis checks entirely for them (a null
  // target.issue there is a legitimate permanent state, not an unresolved
  // one, and WRONG_ISSUE is equally inapplicable — there is no issue number
  // to be wrong about).
  const targetHasIssueAxis = !NO_ISSUE_AXIS_ASSET_TYPES.includes(String(target.assetType || '').toLowerCase());
  if (!targetHasIssueAxis) {
    // no-op — issue axis does not apply to this target's asset type
  } else if (target.issue == null || String(target.issue).length === 0) {
    rejectionCodes.push('TARGET_ISSUE_UNRESOLVED');
    rejectionDetails.push({ code: 'TARGET_ISSUE_UNRESOLVED', predicate: 'target.issue is null/empty — issue axis genuinely unresolved' });
    identityEligible = false;
    comparabilityStatus = 'SIMILAR_TITLE_REFERENCE';
  } else if (target.issueAuthorityPresent === true && target.issueAuthorityStatus !== 'confirmed') {
    // Track B Phase 0, Commit 4 (2026-07-29) — target.issue is populated
    // (unlike the branch above) but its ONLY authority is a marketplace-
    // only adoption (issueAuthority.status, src/lib/issueAuthority.js)
    // that has not been corroborated by anything outside the marketplace
    // pool itself. Every row is demoted to reference-only regardless of
    // whether ITS OWN title happens to match target.issue — a row
    // matching an unconfirmed number is not evidence the number is
    // correct, it's just more of the same un-corroborated marketplace
    // signal that produced the adoption in the first place. Same
    // "absence of evidence is not evidence of correctness" reasoning as
    // TARGET_ISSUE_UNRESOLVED just above, one authority tier up.
    //
    // Fail-closed (review round), not fail-open: an earlier version checked
    // `=== 'provisional' || === 'conflicted'` — an ALLOWLIST inversion bug
    // in disguise, since it let ANY unrecognized future status value fall
    // through as if confirmed. A later version fixed that but checked ONLY
    // `target.issueAuthorityStatus != null` — which, one layer up
    // (api/enrich.js's call sites), was fed by a bare
    // `out.issueAuthority?.status || null` that COLLAPSES two genuinely
    // different upstream states into the identical `null`: (a) no
    // issueAuthority object exists at all (legacy, safe — no tracking ever
    // happened), and (b) an issueAuthority object exists but its own
    // `.status` field is itself null/undefined (a malformed PRESENT
    // record — something tried to track authority here and produced an
    // unreadable result, which is exactly the kind of uncertain shape this
    // gate exists to catch, not wave through as if it were the safe case).
    // Presence-threading correction: `target.issueAuthorityPresent`
    // (boolean, threaded as its own primitive from api/enrich.js's real
    // call sites, never derived from the status value) now answers "does
    // an authority object exist at all" independently of what its status
    // reads. This branch only ever fires when an authority object
    // genuinely exists (`issueAuthorityPresent === true`) and its status
    // isn't the one explicitly-safe value (`'confirmed'`) — covering
    // `'provisional'`/`'conflicted'`/any future value/AND a present-but-
    // statusless record, all correctly gated. `issueAuthorityPresent`
    // false or absent (the ordinary, pre-campaign case, or any caller that
    // never threads it) skips this branch entirely regardless of whatever
    // stray `issueAuthorityStatus` value might otherwise be present —
    // presence is the gate, not status alone.
    rejectionCodes.push('TARGET_ISSUE_PROVISIONAL_AUTHORITY');
    rejectionDetails.push({
      code: 'TARGET_ISSUE_PROVISIONAL_AUTHORITY',
      predicate: `target.issueAuthorityPresent=true, target.issueAuthorityStatus="${target.issueAuthorityStatus}" !== "confirmed" — ` +
        `row demoted to reference-only regardless of title/variant match (hasIssueNumber was never evaluated for this row)`,
    });
    identityEligible = false;
    comparabilityStatus = 'PROVISIONAL_ISSUE_REFERENCE';
  } else if (!hasIssueNumber(title, target.issue, target.seriesTitle || null)) {
    rejectionCodes.push('WRONG_ISSUE');
    rejectionDetails.push({
      code: 'WRONG_ISSUE',
      predicate: `hasIssueNumber(title, target.issue="${target.issue}", target.seriesTitle="${target.seriesTitle}") === false`,
    });
    identityEligible = false;
  }

  // Commit D1.1 — collision-aware. requiredAxes is derived purely from
  // confirmedYear/publisher (never confirmedTitle text — see
  // assessCollisionRisk's own doc comment for why).
  const collisionAssessment = assessCollisionRisk(target);
  const publicationIdentityRequired = collisionAssessment.requiredAxes.includes('publicationIdentity');
  let unconfirmedEdition = false;

  if (target.confirmedYear != null) {
    // Commit C.2 — a structured row.year field (e.g. from PriceCharting
    // sold data) is already a clean single year, never a range/series-
    // start text string, so it's trusted directly. Title-text extraction
    // goes through classifyYearEvidence first: only an
    // ISSUE_PUBLICATION_YEAR classification may supply rowYear for the
    // exact-match check below — SERIES_START_YEAR/SERIES_RANGE/
    // SELLER_CONTEXT_UNKNOWN all fall through as "no year evidence."
    let rowYear = null;
    if (row.year != null) {
      rowYear = parseInt(row.year, 10);
    } else {
      const yearEvidence = classifyYearEvidence(title);
      if (yearEvidence.class === 'ISSUE_PUBLICATION_YEAR' && yearEvidence.year) {
        rowYear = parseInt(yearEvidence.year, 10);
      }
    }
    if (rowYear != null && Number.isFinite(rowYear)) {
      const tolerance = getEraYearTolerance(target.confirmedYear);
      const yearEval = evaluateEraYearMatch(rowYear, target.confirmedYear, tolerance, target.cvVolumeStartYear ?? null);
      if (!yearEval.keep) {
        // Affirmatively conflicting year — the row DOES claim a year, and
        // it's outside tolerance. A genuine, stated mismatch.
        rejectionCodes.push('WRONG_YEAR');
        rejectionDetails.push({
          code: 'WRONG_YEAR',
          predicate: `rowYear=${rowYear} outside tolerance ${tolerance} of target.confirmedYear=${target.confirmedYear}`,
        });
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
      rejectionDetails.push({
        code: 'UNCONFIRMED_EDITION',
        predicate: `no year token on row, but publicationIdentityRequired=true (collision-prone target: confirmedYear=${target.confirmedYear}, publisher="${target.publisher}")`,
      });
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
    rejectionDetails.push({
      code: 'LOT_OR_BUNDLE',
      predicate: `title matched LOT_RE=${LOT_RE.test(title)} / isValidIssueRange=${isValidIssueRange(title)} / hasCrossSeriesSeparator=${hasCrossSeriesSeparator(title)} / isEnumeratedIssueList=${isEnumeratedIssueList(title)} / HALF_ISSUE_RE=${HALF_ISSUE_RE.test(title)}`,
    });
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
  if (wrongPrinting) {
    rejectionCodes.push('WRONG_PRINTING');
    rejectionDetails.push({
      code: 'WRONG_PRINTING',
      predicate: `targetIsReprintEdition=${targetIsReprintEdition} rowIsReprintEdition=${rowIsReprintEdition} rowIsExplicitFirstPrint=${rowIsExplicitFirstPrint} (target.variant="${targetText}")`,
    });
  }

  // Variant contamination — axis-aware, not a flat single-regex match.
  // GrailKey Commit D3 follow-on (2026-08-02): the prior flat
  // VARIANT_CONTAM_RE match (any recognized contamination word, checked
  // as a literal substring of target.variant) carried the identical
  // defect D3 fixed in soldVerification.js's Filter 8 — a target variant
  // naming only the cover ARTIST ("Brett Booth") against a row naming
  // only the cover TYPE ("virgin") is the same physical product
  // described two different ways, but "virgin" never literally appears
  // in "brett booth" so the flat check flagged it as a mismatch. Reuses
  // the SAME extractor Filter 8 uses (compHygiene.js,
  // extractVariantTokensByAxis) — one extractor, both call sites — and
  // the same per-axis comparison shape. 'artist' is included in the
  // globally-empty check (an artist-only target variant still counts as
  // "target specified something") but excluded from the iterated
  // comparison axes, mirroring Filter 8's own AXES/ALL_AXES split
  // exactly so the two mechanisms can't drift apart on this point again.
  const VARIANT_AXES = ['coverType', 'distribution', 'coverLetter', 'printing'];
  const VARIANT_ALL_AXES = ['coverType', 'distribution', 'coverLetter', 'printing', 'artist'];
  const targetVariantByAxis = extractVariantTokensByAxis(targetText);
  const rowVariantByAxis = extractVariantTokensByAxis(title);
  const targetVariantGloballyEmpty = VARIANT_ALL_AXES.every((axis) => targetVariantByAxis[axis].length === 0);
  let wrongVariant = false;
  // GrailKey Dispatch 25, Fix 1 STEP 1 — records which axis broke and the
  // exact token sets compared, purely for rejectionDetails below. Every
  // `break` site, condition, and the resulting `wrongVariant` value are
  // byte-identical to before this change — only the two new lines
  // (`wrongVariantAxis = axis`) immediately before each existing `break`
  // were added.
  let wrongVariantAxis = null;
  for (const axis of VARIANT_AXES) {
    const targetAxisTokens = targetVariantByAxis[axis];
    const rowAxisTokens = rowVariantByAxis[axis];
    if (targetAxisTokens.length > 0 && rowAxisTokens.length > 0) {
      const overlap = rowAxisTokens.some((t) =>
        targetAxisTokens.some((u) => u === t || u.includes(t) || t.includes(u))
      );
      if (!overlap) { wrongVariant = true; wrongVariantAxis = axis; break; }
      continue;
    }
    if (targetAxisTokens.length > 0 && rowAxisTokens.length === 0) { wrongVariant = true; wrongVariantAxis = axis; break; }
    if (rowAxisTokens.length > 0 && targetAxisTokens.length === 0 && targetVariantGloballyEmpty) { wrongVariant = true; wrongVariantAxis = axis; break; }
    // Cross-axis: no signal on this axis, continue.
  }
  if (wrongVariant) {
    rejectionCodes.push('WRONG_VARIANT');
    rejectionDetails.push({
      code: 'WRONG_VARIANT',
      predicate: `axis="${wrongVariantAxis}" target=[${targetVariantByAxis[wrongVariantAxis]}] row=[${rowVariantByAxis[wrongVariantAxis]}] (target.variant="${targetText}")`,
    });
  }

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
  if (collectedEditionMismatch) {
    rejectionCodes.push('COLLECTED_EDITION_MISMATCH');
    rejectionDetails.push({ code: 'COLLECTED_EDITION_MISMATCH', predicate: `target.assetType="${target.assetType}" !== "tpb" and title matches IDENTITY_TPB_MARKER_RE` });
  }

  // Signed mismatch — our target isn't signed, row is.
  const signedMismatch = !target.isSignedTarget && SIGNED_RE.test(title);
  if (signedMismatch) {
    rejectionCodes.push('SIGNED_MISMATCH');
    rejectionDetails.push({ code: 'SIGNED_MISMATCH', predicate: `target.isSignedTarget=${target.isSignedTarget} and title matches SIGNED_RE` });
  }

  // Completeness / restoration / coverless — condition-class rejections,
  // independent of format or edition.
  const incompleteHit = INCOMPLETE_COPY_RE.test(title);
  const coverlessHit = COVERLESS_RE.test(title);
  const restoredHit = RESTORED_TITLE_RE.test(title);
  if (incompleteHit) { rejectionCodes.push('INCOMPLETE_COPY'); rejectionDetails.push({ code: 'INCOMPLETE_COPY', predicate: 'title matches INCOMPLETE_COPY_RE' }); }
  if (coverlessHit) { rejectionCodes.push('COVERLESS_COPY'); rejectionDetails.push({ code: 'COVERLESS_COPY', predicate: 'title matches COVERLESS_RE' }); }
  if (restoredHit) { rejectionCodes.push('RESTORED_COPY'); rejectionDetails.push({ code: 'RESTORED_COPY', predicate: 'title matches RESTORED_TITLE_RE' }); }

  // Format — raw vs. graded, target-relative, bidirectional.
  let formatMismatch = false;
  if (!targetIsGraded && rowIsGraded) {
    rejectionCodes.push('FORMAT_MISMATCH_RAW_VS_SLAB');
    rejectionDetails.push({ code: 'FORMAT_MISMATCH_RAW_VS_SLAB', predicate: `target.isGraded=${targetIsGraded}, row title matches GRADED_RE` });
    formatMismatch = true;
  } else if (targetIsGraded && !rowIsGraded) {
    rejectionCodes.push('FORMAT_MISMATCH_GRADED_VS_RAW');
    rejectionDetails.push({ code: 'FORMAT_MISMATCH_GRADED_VS_RAW', predicate: `target.isGraded=${targetIsGraded}, row title does not match GRADED_RE` });
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
    // GrailKey Dispatch 25, Fix 1 STEP 1 — instrumentation only, additive.
    // One entry per code in rejectionCodes (same order, same length),
    // pairing each code with the exact predicate/values that produced
    // it. Never consulted by isPricingMathEligible or any other
    // eligibility decision — purely for [evidence-eligibility-reject]
    // diagnostics.
    rejectionDetails,
    // Commit A.4 — null except for the TARGET_ISSUE_UNRESOLVED case, where
    // it's always 'SIMILAR_TITLE_REFERENCE': this row is a plausible
    // same-title reference, never mislabeled as "incompatible" (it made no
    // false claim — OUR side's identity is what's unresolved).
    comparabilityStatus,
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
 *   unconfirmedEditionReferences: Array, similarTitleReferences: Array,
 *   provisionalAuthorityReferences: Array, rejectedEvidence: Array}}
 */
export const buildEvidencePopulations = (rows, target = {}) => {
  const populations = {
    rawPricingPool: [],
    gradedPricingReferences: [],
    incompleteReferences: [],
    incompatibleEditionReferences: [],
    unconfirmedEditionReferences: [],
    similarTitleReferences: [],
    // Track B Phase 0, Commit 4 — reference-only custody for rows priced
    // against a marketplace-only-adopted (provisional/conflicted) target
    // issue. Deliberately separate from similarTitleReferences
    // (TARGET_ISSUE_UNRESOLVED — no issue guess at all) and from
    // unconfirmedEditionReferences (a resolved, confirmed issue with a
    // thin year signal) — this bucket holds rows for a target that HAS a
    // specific issue guess, but one whose only authority is the
    // marketplace pool itself, not yet corroborated.
    provisionalAuthorityReferences: [],
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
    } else if (codes.includes('TARGET_ISSUE_UNRESOLVED')) {
      // Commit A.4 — a dedicated bucket, deliberately separate from
      // incompatibleEditionReferences: this row made no false claim, OUR
      // side's identity is what's unresolved. Display label: "Similar-
      // title references — target issue unresolved" (Commit B.3).
      populations.similarTitleReferences.push({ ...sanitized, comparabilityStatus: classification.comparabilityStatus });
    } else if (codes.includes('TARGET_ISSUE_PROVISIONAL_AUTHORITY')) {
      // Track B Phase 0, Commit 4 — I13 custody: this row is not deleted,
      // not silently folded into a generic "rejected" bucket — it's
      // labeled with its own comparabilityStatus and the specific
      // rejection code (source/reason) that kept it out of pricing math.
      populations.provisionalAuthorityReferences.push({ ...sanitized, comparabilityStatus: classification.comparabilityStatus });
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

// Track B Phase 0, Commit 4 (review-round structural upgrade) — the
// complete, ordered list of display/reference bucket keys a fully-
// assembled evidence response carries. Exported so buildEvidenceForResponse
// below, BOTH api/comps.js response-construction sites, and this feature's
// test all enumerate the IDENTICAL set — a hand-maintained partial object
// literal at each call site is the exact defect class that omitted
// provisionalAuthorityReferences (and, longer-standing,
// similarTitleReferences) from api/comps.js's response shape; an exported
// enumeration prevents the CLASS, not just the one instance already found.
// Same pattern as Commit 3's IDENTITY_DEPENDENT_FIELDS_TO_CLEAR /
// IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE (manualCorrection.js) — explicit,
// named, exported lists, never inferred "everything except" logic.
export const EVIDENCE_RESPONSE_BUCKETS = [
  'similarTitleReferences',
  'provisionalAuthorityReferences',
  'gradedPricingReferences',
  'incompleteReferences',
  'incompatibleEditionReferences',
  'unconfirmedEditionReferences',
  'rejectedEvidence',
  'eraRejectedReferenceRows',
];

/**
 * Assembles the complete display/reference evidence object api/comps.js
 * attaches to its response (out.activeEvidence, api/enrich.js:8799) — every
 * bucket in EVIDENCE_RESPONSE_BUCKETS, always present as an array (empty
 * when a bucket has no rows), never a hand-picked subset.
 *
 * eraRejectedReferenceRows is NOT one of buildEvidencePopulations' own
 * fields — it's computed separately, by api/comps.js's own era-consistency
 * filter, BEFORE evidence classification even runs (a different pipeline
 * stage entirely) — so it's accepted as a second argument here rather than
 * requiring buildEvidencePopulations itself to know about an upstream
 * filter stage, or being silently dropped.
 *
 * src/lib/soldVerification.js's real call site does not use this function —
 * it returns `evidencePopulations` directly (the full object
 * buildEvidencePopulations already produces, which already carries every
 * bucket in this list except eraRejectedReferenceRows — sold comps have no
 * equivalent era-consistency pre-filter stage) — confirmed complete by
 * direct reading, not assumed; this feature's response-shape test asserts
 * both shapes.
 */
export function buildEvidenceForResponse(evidencePopulations, eraRejectedReferenceRows = []) {
  const evidence = {};
  for (const bucket of EVIDENCE_RESPONSE_BUCKETS) {
    evidence[bucket] = bucket === 'eraRejectedReferenceRows'
      ? (eraRejectedReferenceRows || [])
      : (evidencePopulations?.[bucket] || []);
  }
  return evidence;
}

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
//
// Track B Phase 0, Commit 1 (2026-07-29) — full audit of every code in
// STANDARD_REJECTION_CODES not already in this list. Verdict: ADD
// TARGET_ISSUE_UNRESOLVED only. Live-confirmed gap: `api/comps.js`'s
// Filter 0a and `soldVerification.js`'s issue filter both SKIP entirely
// when the target issue is null — neither legacy chain rejects anything
// on this axis when unresolved, so a row carrying only
// TARGET_ISSUE_UNRESOLVED passed this gate even though classifyEvidenceRow
// itself already correctly flags it identityEligible=false. The other 9
// codes (WRONG_ISSUE/WRONG_YEAR/WRONG_PRINTING/WRONG_VARIANT/
// LOT_OR_BUNDLE/SIGNED_MISMATCH/COLLECTED_EDITION_MISMATCH/
// FORMAT_MISMATCH_GRADED_VS_RAW/COVERLESS_COPY) stay OUT — already locked
// in by tests/q-commitD1.1-collision-aware-eligibility.test.js's
// LEGACY_OVERLAPPING_CODES assertion (the existing, more nuanced
// api/comps.js/soldVerification.js filter chains already enforce these
// with edge-case handling this narrower classifier doesn't replicate;
// widening this gate to them previously regressed 11 passing
// sold-verification.test.js assertions).
// Track B Phase 0, Commit 4 (2026-07-29) — adds TARGET_ISSUE_PROVISIONAL_AUTHORITY.
// Same reasoning as TARGET_ISSUE_UNRESOLVED's original Commit 1 addition:
// classifyEvidenceRow already correctly flags identityEligible=false for a
// marketplace-only-adopted target issue, but neither api/comps.js's
// legacy filter chain nor soldVerification.js's issue filter has any
// concept of "issue present but unconfirmed" — both would otherwise admit
// these rows into pricing math on target.issue's bare presence alone.
export const PRICING_GATE_CODES = ['INCOMPLETE_COPY', 'RESTORED_COPY', 'FORMAT_MISMATCH_RAW_VS_SLAB', 'UNCONFIRMED_EDITION', 'TARGET_ISSUE_UNRESOLVED', 'TARGET_ISSUE_PROVISIONAL_AUTHORITY'];
export const isPricingMathEligible = (classification) =>
  !classification.rejectionCodes.some((c) => PRICING_GATE_CODES.includes(c));

// Track B Phase 0, Commit 1 — the exact composition api/comps.js:2062
// applies inline (`rows.filter((it) => isPricingMathEligible(classifyEvidenceRow(it, target)))`),
// extracted and exported so both production and its test invoke the
// IDENTICAL function rather than a test-local mirror that can drift from
// the real call site independently (the exact failure class this
// campaign has hit three times already — Commit D1's own writeup,
// classifyYearEvidence shipping with zero call sites, and this gate
// itself before this extraction).
//
// Track B Phase 0, Commit 1.1 (2026-07-29) — null/undefined `rows` (an
// upstream population genuinely missing, not merely empty) is deliberately
// swallowed to an empty array rather than thrown: a pricing endpoint
// returning "no eligible comps" on a malformed upstream call is recoverable
// (honest no-price, same as a genuinely empty pool); a 500 is not. This is
// a real, documented behavior decision, not an accidental side effect of
// `|| []` — the loud console.log below exists specifically so this path is
// never silent: a caller passing null/undefined by mistake is visible in
// production logs even though the function itself doesn't throw.
export const buildPricingEligibleRows = (rows, target = {}) => {
  if (rows == null) {
    console.log(
      '[evidence-eligibility] buildPricingEligibleRows: upstream population ' +
      'missing (rows was null/undefined, not an empty array) — returning ' +
      'empty pool rather than throwing.'
    );
    return [];
  }
  // GrailKey Dispatch 25 (2026-08-07), Fix 1 STEP 1 — instrumentation
  // ONLY. The filter predicate itself (isPricingMathEligible(classification))
  // is computed identically to before this change — classifyEvidenceRow
  // is still called exactly once per row, its result still decides
  // inclusion/exclusion via the same function, same logic, same order.
  // The only addition is capturing that same call's result in a variable
  // (instead of leaving it inline-anonymous) so a rejected row can be
  // logged before the filter moves on. Zero eligibility behavior change.
  return rows.filter((row, idx) => {
    const classification = classifyEvidenceRow(row, target);
    const eligible = isPricingMathEligible(classification);
    if (!eligible) {
      // "class"/"reason" cover ONLY the code(s) actually in
      // PRICING_GATE_CODES — i.e. the ones isPricingMathEligible reacted
      // to — not every code classifyEvidenceRow may have pushed (a row
      // can carry a non-pricing-gate code like WRONG_VARIANT alongside
      // a pricing-gate one; printing only the blocking code(s) here
      // keeps "reason" answering the actual question this log exists
      // for: why did THIS FILTER reject the row, not every observation
      // classifyEvidenceRow made about it).
      const blockingCodes = classification.rejectionCodes.filter((c) => PRICING_GATE_CODES.includes(c));
      const blockingReasons = classification.rejectionDetails
        .filter((d) => blockingCodes.includes(d.code))
        .map((d) => `${d.code}: ${d.predicate}`)
        .join(' | ');
      console.log(
        `[evidence-eligibility-reject] idx=${idx} title="${String(row?.title || '')}" ` +
        `class=${blockingCodes.join(',') || '(none — see full rejectionCodes)'} ` +
        `reason=${blockingReasons || JSON.stringify(classification.rejectionCodes)} ` +
        `targetTitle="${target.seriesTitle ?? ''}" targetVariant="${target.variant ?? ''}"`
      );
    }
    return eligible;
  });
};

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
// always false — this is display-only. This pure function never touches
// price/bands itself (it only classifies and returns a reference object);
// the CALLER (api/enrich.js) is responsible for actually nulling
// out.price/priceLow/priceHigh/priceBands and setting refusedToPrice=true
// when this fires — Commit E1 made that mandatory (Commit E originally
// left tier 4's pc_estimate price standing alongside the reference, which
// defeated the "reference, not a recommendation" purpose entirely: the
// same underlying pcBase×gradeMultiplier data would otherwise present as
// BOTH an inert reference AND an actionable recommended price
// simultaneously). See api/enrich.js's own comment at its
// assessCatalogLadderReference call site (positioned immediately before
// out.decision = computeDecision(...), same strategic spot as the Q140
// issue-fingerprint-violation clearing block) for the actual override.
// Listing enablement is never this function's concern either way — Step
// 2A's review-contract gate governs that, regardless of source.
export const assessCatalogLadderReference = ({
  rawPricingPoolEmpty,
  gradedReferencesEmpty,
  pcAnchorAccepted,
  priceLadder,
  gradeKey,
  gradeBasis,
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
    // Commit E1 — grade authority the rung is being shown against. A
    // SINGLE_PHOTO_PROVISIONAL/UNKNOWN basis must never be presented as a
    // confirmed grade match (the UI consumer labels this explicitly,
    // "Reference at provisional AI grade <X>" — never "confirmed").
    gradeBasis: gradeBasis || 'UNKNOWN',
  };
};

// Commit E1 (2026-07-28) — pcAnchorTrust. isFromPC (api/enrich.js) is a
// variant-multiplier double-count guard (VARIANT_MULT_ELIGIBLE_SOURCES) --
// it answers "should this pricing source also receive the newsstand/
// variant multiplier," not "is this PriceCharting product genuinely the
// SAME edition as the confirmed book." Conflating the two let Commit E's
// original wiring accept a merely-plausible PC match as if it were an
// exact-edition confirmation. Three states, not a boolean, because
// "rejected outright" and "accepted but not exact" are different things a
// caller needs to react to differently (V1 catalog-ladder-reference
// requires EXACT_EDITION specifically; COMPATIBLE_REFERENCE must never
// fire it).
//
// Grounded in two EXISTING, already-computed signals rather than a new
// classifier from scratch:
//   - pcMatchRejectedForYearConflict (src/lib/variantIdentity.js's
//     pcMatchConflictsWithPoolYear, ±5y tolerance, already gates whether
//     api/enrich.js keeps out.pcProductId/out.pcLoosePrice at all).
//   - identityConflictCount (api/enrich.js's [ship28b-conflicts] tally --
//     detectIdentityConflicts/detectCompsConflicts, src/lib/conflictDetector.js
//     -- title/issue/year/publisher mismatch detection already running
//     well before tier pricing).
// A tighter year-drift band (0-1y) than the ±5y admission gate is required
// for EXACT_EDITION specifically -- cover-date-vs-publication-date drift
// of 1-2y is normal even for the genuinely correct edition (documented
// elsewhere in this codebase's AI-verify tolerance), but a 2-5y drift is
// exactly the zone this campaign's own "Renumbered-franchise" and
// "Batman #608" pattern-library classes were built around -- plausible,
// not exact.
export const assessPcAnchorTrust = ({
  pcPrice,
  pcYear,
  confirmedYear,
  pcMatchRejectedForYearConflict,
  identityConflictCount,
} = {}) => {
  if (!pcPrice || pcMatchRejectedForYearConflict) return 'REJECTED';
  const py = pcYear != null ? parseInt(pcYear, 10) : null;
  const cy = confirmedYear != null ? parseInt(confirmedYear, 10) : null;
  if (py == null || cy == null || !Number.isFinite(py) || !Number.isFinite(cy)) {
    // Can't verify a tight year match either way -- never claim EXACT
    // without evidence to back it.
    return 'COMPATIBLE_REFERENCE';
  }
  if ((identityConflictCount || 0) > 0) return 'COMPATIBLE_REFERENCE';
  const drift = Math.abs(py - cy);
  if (drift > 5) return 'REJECTED';
  if (drift <= 1) return 'EXACT_EDITION';
  return 'COMPATIBLE_REFERENCE';
};

// Commit E1 — gradeBasis. Grounded in the two grade-authority signals
// actually available in api/enrich.js: isGraded/numericGrade (a CGC slab
// number -- an objective third-party fact, not a subjective AI visual
// estimate) vs. a raw scan's AI-assessed condition string, further split
// by how many photos backed that assessment (images.length -- though
// api/enrich.js today only ever consumes images[0] for its own visual-
// pool search, the count itself is a legitimate signal of how much visual
// evidence the assessment had, independent of what enrich.js does with
// the rest of the array).
export const assessGradeBasis = ({ isGraded, grade, numericGrade, imagesCount } = {}) => {
  if (isGraded === true && numericGrade != null) return 'USER_CONFIRMED';
  if (!grade) return 'UNKNOWN';
  if (imagesCount != null && imagesCount > 1) return 'MULTI_PHOTO_ASSESSED';
  return 'SINGLE_PHOTO_PROVISIONAL';
};

// Commit C.3 (Strange Tales dispatch, 2026-07-28) — reference/catalog-
// image detection. No mechanism anywhere in this codebase currently flags
// a listing photo as a reused catalog/reference/stock image rather than a
// genuine seller photo of their own copy (confirmed by direct source
// search before writing this — zero hits for "stock image"/"reference
// image"/"GPAnalysis"/etc. as a detection signal anywhere; "stock image"
// only appears as marketplace-boilerplate text stripped during title
// cleanup, src/lib/titleHygiene.js). This codebase has no image-pixel
// analysis available at all — Vision only ever returns text descriptions,
// never a structured "is this a stock photo" signal — so this is
// necessarily a title/description TEXT heuristic, not true image
// forensics. Deliberately conservative: only fires on explicit seller
// language admitting the photo isn't of their actual item ("stock photo,"
// "for reference only," "actual item may vary," etc.), never inferred
// from image content itself, which this codebase cannot see.
//
// A detected reference image can still legitimately corroborate WHICH
// book this is (identityPhotoEligible stays true — the cover art itself
// is genuine even if the specific photo is reused) but must not be
// trusted for anything about THIS SPECIFIC COPY: its condition, its
// completeness, whether the seller's hands are actually on it, or its
// individual grade.
const REFERENCE_IMAGE_RE =
  /\bstock\s*photo\b|\bstock\s*image\b|\breference\s*photo\b|\breference\s*image\b|\bfor\s*reference\s*only\b|\bnot\s*(?:the\s*)?actual\s*item\b|\bphoto\s*not\s*of\s*(?:the\s*)?actual\b|\bgeneric\s*image\b|\bactual\s*item\s*may\s*vary\b|\bcover\s*image\s*only\b|\bsample\s*image\b|\bgrading\s*reference\b/i;

export const assessPhotoAuthority = (title) => {
  const isReferenceImage = REFERENCE_IMAGE_RE.test(String(title || ''));
  return {
    identityPhotoEligible: true,
    conditionPhotoEligible: !isReferenceImage,
    listingPhotoEligible: !isReferenceImage,
    ownershipEvidence: !isReferenceImage,
  };
};

export { STANDARD_REJECTION_CODES };
