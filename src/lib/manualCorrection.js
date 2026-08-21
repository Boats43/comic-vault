// Track B Phase 0, Commit 3 (2026-07-29) — manual identity correction:
// server-side authority validation + the explicit clear-list/preserve-list
// merge that replaces a stale card's identity-dependent data with a
// corrected re-identification's, rather than implicitly carrying the old
// card's fields forward via a spread.
//
// Historical grounding: this closes the same stale-merge class as the
// Wonder Woman #750 persistence bug (Scope 1, `mergeConfirmedIdentity`) —
// this time on the CORRECTION path specifically, where a blessed-but-stale
// card (confidently displaying #9's economics under a corrected #3 title)
// would be strictly worse than the original wrong one: the old card at
// least LOOKED uncertain; a stale-merged corrected card looks resolved.
//
// Design note on the "same-request lock" requirement: `manualIdentity: true`
// (the existing Scan-tab manual-entry contract, `api/enrich.js`) already
// routes around `resolveIdentity()`/`resolveFamilyIssueConsensus()` entirely
// — confirmed by direct trace of `api/enrich.js`'s four-way identity branch
// (barcode / manual / cgc_cert / resolveIdentity), a plain `else if` chain,
// not a fallthrough. No automatic evidence resolution runs at all on this
// request when `manualIdentity` is set, for any of title/issue/year/
// publisher. That structural bypass is the PRIMARY protection; Safeguard 1
// below (the exact four-condition request contract) is what makes it safe
// to actually trust — a request that merely sets `manualIdentity: true`
// without the other three conditions is not the same guarantee.
//
// FIVE SAFEGUARDS (2026-07-29 review round, folded in before staging):
// 1. The exact four-condition manual-authority request contract is
//    enforced server-side, not just `manualIdentity` alone.
// 2. `normalizedValues` — not raw request fields — become the working
//    pipeline identity, via `prepareManualCorrectionRequest`.
// 3. Client-supplied prior history is marked `provenanceTrust:
//    'client-reported'`, never presented as server-verified.
// 4. The clear-list/preserve-list dispute is resolved explicitly per
//    field, including a conditional-on-sold-status group.
// 5. The real client payload shape and array-replacement collection
//    integrity are both directly tested via extracted, production-used
//    helpers.

import { normalizeIssueFormat } from './compHygiene.js';
import { mergeIdentityAuthority } from './dataQualityGuard.js';

// ─────────────────────────── validation ───────────────────────────

// Server-side manual-authority validation. Only these four fields may ever
// be marked user-corrected — never price, contract, decision, or any other
// pipeline-computed field, regardless of what a client claims in
// manualAuthority.correctedFields. Exported so a client can build its own
// correction UI against the same authoritative list rather than
// hand-duplicating it.
// GrailKey Directive T, Task 4 — added 'variant'. The operator could
// previously only set the four fields below via a correction; Directive
// Q had already fixed variant *repopulation* from the server's own
// response (buildCorrectedCatalogueItem), but nothing let the operator
// *set* it. Required for the picker foundation (Directive S) to have
// anywhere to put a selected candidate's variant facet at all.
export const MANUAL_CORRECTION_ALLOWED_FIELDS = ['title', 'issue', 'year', 'publisher', 'variant'];

const YEAR_MIN = 1930;
const YEAR_MAX_SLACK = 1; // allow next calendar year (solicitation/cover-date lead)

// Normalizes a raw issue string via the existing normalizeIssueFormat
// (src/lib/compHygiene.js) rather than inventing a second issue-parsing
// routine. Returns null when there's no usable numeric issue in the input
// (e.g. bare "Annual" with no number) — treated as an empty correction for
// that field, not a crash.
export const normalizeManualIssue = (raw) => {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const { issue } = normalizeIssueFormat(trimmed);
  if (!issue) return null;
  // normalizeIssueFormat's own "unrecognized format, return as-is" fallback
  // (used for anything that isn't one of its specific Annual/Special/
  // Giant-Size/King-Size patterns) preserves a bare "#3" untouched — it
  // only strips '#' inside those specific regexes. This correction UI's
  // plain issue-number field must normalize "#3" / " #3 " / "# 3" all down
  // to the bare "3": a corrected issue value must never carry a literal
  // hash into the working pipeline identity (cache keys, comp queries,
  // terminal out.issue all expect the bare form, matching every other
  // confirmedIssue producer in this codebase).
  const stripped = issue.replace(/^\s*#\s*/, '').trim();
  return stripped || null;
};

// Normalizes a raw year string/number. Rejects non-numeric input and years
// outside a sane plausible range (comics predate 1930 only in edge cases
// this app's own era bands don't model; nothing prices a next-next-year
// solicitation). Returns null for anything that doesn't parse — never
// throws, never silently coerces garbage into a number.
export const normalizeManualYear = (raw, currentYear) => {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  const maxYear = (currentYear || new Date().getUTCFullYear()) + YEAR_MAX_SLACK;
  if (n < YEAR_MIN || n > maxYear) return null;
  return String(n);
};

const normalizeManualTitle = (raw) => {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
};

const normalizeManualPublisher = (raw) => {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
};

// GrailKey Directive T, Task 4 — same shape as title/publisher (free
// text, trim, empty -> null). No format constraint beyond that: unlike
// issue/year, a variant descriptor has no canonical numeric/date shape
// to validate against.
const normalizeManualVariant = (raw) => {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
};

const NORMALIZERS = {
  title: normalizeManualTitle,
  issue: normalizeManualIssue,
  year: (raw) => normalizeManualYear(raw),
  publisher: normalizeManualPublisher,
  variant: normalizeManualVariant,
};

// Field-keyed normalization, tolerant of a currentYear override — used by
// both validateManualAuthority (only for accepted fields) and
// prepareManualCorrectionRequest (for EVERY field in the working identity,
// corrected or not, per Safeguard 2).
const normalizeFieldValue = (field, rawValue, currentYear) => {
  if (field === 'issue') return normalizeManualIssue(rawValue);
  if (field === 'year') return normalizeManualYear(rawValue, currentYear);
  if (field === 'title') return normalizeManualTitle(rawValue);
  if (field === 'publisher') return normalizeManualPublisher(rawValue);
  if (field === 'variant') return normalizeManualVariant(rawValue);
  return rawValue ?? null;
};

/**
 * Validates a client-supplied manualAuthority claim against the allow-list
 * AND against what the request actually supplied — a client asking to
 * correct 'price' or 'contract' never gets that field accepted, and a
 * client claiming 'issue' was corrected but sending an empty/whitespace
 * issue value doesn't get 'issue' accepted either. Never trusts the client
 * alone: this is the single point every correction request must pass
 * through before any mutation happens.
 *
 * @param {Object} manualAuthority - { correctedBy, correctedFields } as sent by the client
 * @param {Object} fieldValues - { title, issue, year, publisher } as sent by the client (the NEW values)
 * @param {number} [currentYear] - injected for testability; defaults to real current year
 * @returns {{
 *   acceptedFields: string[],      // allow-listed AND actually supplied with a valid, non-empty value
 *   rejectedFields: string[],      // requested but NOT on the allow-list (e.g. 'price', 'contract')
 *   emptyFields: string[],         // allow-listed and requested, but supplied value was empty/invalid
 *   normalizedValues: Object,      // { field: normalizedValue } for each accepted field
 *   valid: boolean,                // true iff acceptedFields.length > 0
 *   error: string|null,            // set when valid===false
 * }}
 */
export const validateManualAuthority = (manualAuthority, fieldValues, currentYear) => {
  const requested = Array.isArray(manualAuthority?.correctedFields)
    ? manualAuthority.correctedFields.filter((f) => typeof f === 'string')
    : [];

  const rejectedFields = requested.filter((f) => !MANUAL_CORRECTION_ALLOWED_FIELDS.includes(f));
  const allowedRequested = requested.filter((f) => MANUAL_CORRECTION_ALLOWED_FIELDS.includes(f));

  const acceptedFields = [];
  const emptyFields = [];
  const normalizedValues = {};

  for (const field of allowedRequested) {
    const normalize = NORMALIZERS[field];
    const normalized = field === 'year' ? normalize((fieldValues || {})[field], currentYear) : normalize((fieldValues || {})[field]);
    if (normalized == null) {
      emptyFields.push(field);
      continue;
    }
    acceptedFields.push(field);
    normalizedValues[field] = normalized;
  }

  const valid = acceptedFields.length > 0;
  return {
    acceptedFields,
    rejectedFields,
    emptyFields,
    normalizedValues,
    valid,
    error: valid ? null : 'no-valid-corrections',
  };
};

// ─────────────────── Safeguard 1 + 2: request contract + working identity ───────────────────

/**
 * SAFEGUARD 1 — the exact manual-authority request contract. Checking
 * `manualIdentity` alone is not sufficient: a request could set
 * `manualIdentity: true` while NOT actually skipping Vision/image-search,
 * or claim a non-'manual' identitySource, and still reach a correction
 * code path. All four conditions are required together, matching the
 * Scan tab's own existing manual-entry contract byte-for-byte
 * (src/App.jsx's manual-entry submit: skipVision:true, skipImageSearch:true,
 * identitySource:'manual').
 *
 * @param {Object} body - the raw request body
 * @returns {boolean}
 */
export const isValidManualAuthorityRequestContract = (body) =>
  body?.manualIdentity === true &&
  body?.skipVision === true &&
  body?.skipImageSearch === true &&
  body?.identitySource === 'manual';

/**
 * SAFEGUARD 1 + 2, combined. The single gate a correction request must
 * pass through before ANY identity resolution, external lookup
 * (eBay/PriceCharting/ComicVine/Vision), or mutation happens. Returns
 * `valid: false` (with `contractOk` distinguishing WHICH check failed —
 * the request-contract gate vs. the field-validation gate) for:
 *   - a request with `manualAuthority` present but the four-condition
 *     contract NOT fully satisfied (Safeguard 1) — including the spoof
 *     case: a normal automatic-identification request that happens to
 *     carry a `manualAuthority` block gets rejected here, before it can
 *     mint a user-confirmed `issueAuthority`.
 *   - a request whose `manualAuthority.correctedFields` doesn't survive
 *     validateManualAuthority's allow-list + supplied-value intersection.
 *
 * On success, returns `workingIdentity` — title/issue/year/publisher all
 * passed through the SAME normalizers validateManualAuthority uses,
 * regardless of whether a given field was the one actually corrected this
 * request (Safeguard 2: a field not being corrected doesn't mean its raw,
 * un-normalized form should become the pipeline's working identity either
 * — every one of these four values feeds cache-key construction, PC/CV
 * lookup, comp-query construction, and the terminal `out.*` writes, so all
 * four are normalized together). Falls back to the raw supplied value only
 * if normalization of an UNCORRECTED field yields null (never null out a
 * field that isn't part of this correction just because the stricter
 * normalizer dislikes its exact format).
 *
 * @param {Object} body - the raw request body (req.body)
 * @param {number} [currentYear] - injected for testability
 * @returns {{
 *   valid: boolean,
 *   error: string|null,
 *   contractOk: boolean,
 *   validation: Object|null,
 *   workingIdentity: {title, issue, year, publisher, variant}|null,
 * }}
 */
export const prepareManualCorrectionRequest = (body, currentYear) => {
  if (!body?.manualAuthority) {
    return { valid: false, error: 'no-manual-authority', contractOk: false, validation: null, workingIdentity: null };
  }

  if (!isValidManualAuthorityRequestContract(body)) {
    return { valid: false, error: 'invalid-manual-authority-request-contract', contractOk: false, validation: null, workingIdentity: null };
  }

  const validation = validateManualAuthority(
    body.manualAuthority,
    { title: body.title, issue: body.issue, year: body.year, publisher: body.publisher, variant: body.variant },
    currentYear
  );
  if (!validation.valid) {
    return { valid: false, error: validation.error, contractOk: true, validation, workingIdentity: null };
  }

  const buildField = (field) => {
    if (validation.acceptedFields.includes(field)) return validation.normalizedValues[field];
    const rawValue = body[field === 'publisher' ? 'publisher' : field];
    return normalizeFieldValue(field, rawValue, currentYear) ?? (rawValue ?? null);
  };

  const workingIdentity = {
    title: buildField('title'),
    issue: buildField('issue'),
    year: buildField('year'),
    publisher: buildField('publisher'),
    variant: buildField('variant'),
  };

  return { valid: true, error: null, contractOk: true, validation, workingIdentity };
};

/**
 * The union rule: a correctable field is either genuinely missing
 * (identityMissingFields) OR present-but-unconfirmed (identityProvisionalFields
 * — Track B Phase 0 Commit 4's field, not populated in production yet, a
 * safe no-op union member until then), intersected with the allow-list so
 * this can never offer an input for a field the server would reject anyway.
 * Extracted as its own exported function (not left inline in App.jsx's JSX)
 * specifically so both the render site and this file's tests call the
 * identical logic — the mandatory case this exists to guarantee: a
 * provisional pool-adopted issue has identityMissingFields=[] but MUST
 * still render an issue input, via identityProvisionalFields.
 *
 * @param {Object} item - a catalogue item (or an enrich response shape)
 * @returns {string[]} the fields to render correction inputs for, allow-listed
 */
export const getCorrectableFields = (item) => {
  const missing = Array.isArray(item?.identityMissingFields) ? item.identityMissingFields : [];
  const provisional = Array.isArray(item?.identityProvisionalFields) ? item.identityProvisionalFields : [];
  const union = Array.from(new Set([...missing, ...provisional]));
  return union.filter((f) => MANUAL_CORRECTION_ALLOWED_FIELDS.includes(f));
};

// ─────────────────── identity-dependent clear list ───────────────────
//
// Explicit named enumerations (not inferred "everything except" logic —
// every field added to `out` in api/enrich.js in the future must force a
// conscious decision about which list, if any, it joins). Grouped by the
// categories the dispatch itself named, so a reviewer can audit one
// category at a time. Derived from a full enumeration of every `out.X =`
// assignment in api/enrich.js as of Commit 2 (eda3e42) — see
// docs/LAUNCH-AUDIT.md Section 16 for the audit method.

const CLEAR_PC_COMICVINE_GOCOLLECT_IDS = [
  'pcProductId', 'pcProductName', 'pcEbayEpid', 'pcLoosePrice', 'pcGradedPrice',
  'pcLastUpdated', 'pcMatchRejectedForYearConflict', 'pcAnchorTrust',
  // GrailKey Directive H, Item 1 (2026-08-11) -- pcAnchorYear is new
  // (Directive G Task 2); pcAnchorTrust was already clear-listed here
  // since Commit E1 (2026-07-29), but pcAnchorYear didn't exist yet and
  // was missing. Without this, a stale EXACT_EDITION-supporting year
  // could survive a correction whose fresh response carries no PC
  // anchor at all (enrichData simply omits the key; the full spread
  // below never overwrites an absent key).
  'pcAnchorYear',
  'comicVine', 'originalComicVine', 'cvCharacterCredits', 'ximilar',
  'goCollect', 'gcId', 'gcFmvLadder', 'gcLastUpdated', 'gcTrend', 'gcVelocity', 'gcDaysToSell',
];

const CLEAR_COMP_POOLS = [
  'rawComps', 'comps', 'soldComps', 'soldCompsRaw', 'soldCompsRawCached',
  'soldCompsAvg', 'soldCompDiagnostics', 'soldEvidence', 'soldRetentionStale',
  'activeEvidence', 'activeCached', 'compsCachedAt', 'imageSearchResults',
  'visualPoolSize', 'visualPoolUsed', 'visualPoolIsolatedToFamily',
  'ebayBuyingOptions', 'ebayLeafCategories', 'ebaySellerCount',
];

const CLEAR_EVIDENCE_POPULATIONS = [
  'compPoolContaminated', 'reprintFallback', 'variantFallback', 'premiumVariantIsolated',
  'artistFallback', 'compBasis', 'variantCompsExcludedByEra', 'eraRejections', 'eraConflict',
  'multiIssueRejected', 'sequelRejected', 'signedRejected',
  'exactMarketEvidenceCount', 'marketEvidenceReady', 'compFilterVersion',
];

const CLEAR_AVERAGES_FLOOR_HIGH_LASTSOLD = [
  'price', 'priceLow', 'priceHigh', 'blendedAvg',
  'floorBandHigh', 'floorBandLow', 'floorContaminationSuspect', 'floorContaminationReason', 'floorReEnforced',
  'preFloorPrice', 'preFloorSource', 'lowGradeFloorAnchor', 'lowGradeFloorApplied', 'thinPoolAnchored',
  'askDerivedWarning', 'activePoolSuspectWarning', 'sanityCeilingWarning',
  'megaKeyFloorApplied', 'megaKeyFloorBand', 'megaKeyFloorNote', 'megaKeyFloorSkipped',
  'megaKeyFloorSkipReason', 'megaKeyFloorSource', 'megaKeyFloorSuppressed', 'megaKeyFloorVerified',
  'megaKeysSchemaVersion', 'megaKey',
];

const CLEAR_LADDER_HISTORY = [
  'priceLadder', 'priceChart', 'salesByGrade', 'catalogLadderReference',
];

const CLEAR_RECOMMENDATION_BANDS = [
  'priceBands', 'recommendation', 'authoritativeRecommendation', 'hypotheticalReferenceEstimate',
  'referenceLow', 'referenceMid', 'referenceHigh', 'priceDerivationTrace',
];

const CLEAR_PRICING_SOURCE_DERIVATION = [
  'pricingSource', 'priceNote', 'verifiedFMV', 'refusedToPrice', 'confidenceLevel',
  'matchConfidence', 'matchConfidenceDemote',
  'gradeMultiplier', 'gradeMultiplierInterpolated', 'gradeMultiplierInterpolatedFrom',
  'keyMultiplier', 'keyMultBaseSource', 'newsstandMultiplier', 'newsstandEra',
  'variantMultiplier', 'variantMultiplierEstimated', 'priceUpdatedAt',
  // Safeguard 4 — MOVED here from the preserve-list. A system-derived list
  // price (and the "was it manually overridden" flag alongside it) was
  // computed/set against the OLD (wrong) identity's valuation — under the
  // corrected identity the underlying value the override flag refers to no
  // longer means anything (a manual override of "$40 for what we thought
  // was #9" doesn't carry forward to "#3," which may be worth $120).
  // Clearing both together, not just the price: a stale `listPriceManual:
  // true` with no corresponding meaningful price behind it is worse than
  // clearing the flag too.
  'listPrice', 'listPriceManual',
];

const CLEAR_VELOCITY_DEMAND_TREND = [
  'salesVelocity', 'velocityAnalysis', 'demandSignals',
];

const CLEAR_STORY_METADATA = [
  'story', 'storySource', 'storySuppressedReason', 'contentVerified',
  'keyIssue', 'keyIssueSource', 'keyFromComps', 'keyFromCompsSingleton', 'keyCharacters',
  'autoDetectedKey', 'creatorFromComps', 'creatorFromCompsSingleton', 'hasKeyValue',
  'eraRisk', 'limitedRunSize', 'originalKeyIssue', 'originalKeyIssueSource',
];

const CLEAR_VARIANT_PRINTING = [
  'variantNote', 'variantComposition', 'variantConsensus', 'variantIdentitySource',
  'variantOverriddenVision', 'variantPoolYearConflict',
  'isPolybagPricing', 'polybagDetected', 'polybagComps', 'polybagAskLow', 'polybagReprintRatio',
  'polybagYear', 'polybagEditionLabel', 'polybagSuppressedComicVine', 'polybagSuppressedKey',
  'foreignEdition', 'editionWarning', 'editionDescriptorCandidate',
  'visionConfirmedReprint', 'visionEditionType',
  // Safeguard 4 — MOVED here from the preserve-list. These are printing/
  // cover-identity DETERMINATIONS tied to WHICH BOOK this is, not
  // photo-quality facts independent of it — "is #9 a reprint" / "what
  // variant is #9" says nothing valid about #3. The prior classification
  // (originally: "photo-derived, no new photo submitted, so unaffected")
  // was wrong for these three specifically — they're identity-dependent
  // determinations, not photo-condition facts. certNumber/cgcLabel/
  // cgcVerified/labelType/labelNotes/restoration/defectPenalty/
  // cgcPenaltyFlags remain preserved below: those describe the CGC
  // slab/grading-service record and physical condition of the object
  // itself, not which specific printing/variant of a title it is.
  'variant', 'isReprint', 'editionType',
];

const CLEAR_PRIOR_IDENTITY_WARNINGS = [
  'identityConfident', 'identityMissingFields', 'identityReasons',
  'identityConsensus', 'identityFromConsensus', 'identityVisionLowButCorroborated',
  'identityAlignment', 'identityProvisional', 'identityComplete',
  'issueConsensusConflict', 'issueBackfilledFromVisual', 'issueBackfillProvenance',
  'issueSource', 'issueFingerprintViolation',
  'titleBackfilledFromComps', 'titleBackfillRatio', 'titleRevotedFrom22c',
  'titleContamination', 'titleOriginalBeforeSanitize', 'titleSanitized', 'originalTitle',
  'yearBackfilledFromComps', 'yearBackfillRatio', 'yearBackfillSource',
  'yearOverrideRejected', 'yearCorrected', 'yearResolvedFromVariantPool',
  'yearResolvedFromVariantPoolRatio', 'originalYear', 'confirmedYearMeta',
  'publisherBackfilledFromComps', 'publisherBackfillRatio', 'publisherBackfillSource',
  'publisherBeforeCorrection', 'publisherConflictCorrected', 'publisherImplausibleRejected',
  'publisherUnresolved', 'needsReview', 'convergence', 'conflicts',
  'coTitlePreserved', 'coTitleSource',
  'assemblyIntegrityAdded', 'assemblyIntegrityFailed', 'assemblyIntegrityMissing', 'assemblyIntegrityReason',
  'merchandiseDetected', 'rejectedVisualEvidence', 'visionZeroSupport', 'visionPublisherZeroSupport',
  'visionConfidence', 'visionConsistency', 'identifiedBy', 'claudeIssue',
  'claudeCheck', 'claudeCheckBlocker', 'claudeCheckBypassedForPolybag', 'claudeCheckHighSeverity',
  'claudeCheckMode', 'claudeCheckWarning', 'warningFlags', 'criticalFlags', 'webSearchEvidence',
  'recencyWeighted', 'gradeExceedsMap', 'gradeExceedsMapReason',
  'manualReviewRequired', 'manualReviewReason', 'tier0Locked', 'ukWeeklyNoComps',
  'timings', 'pipelineAudit', 'suggestedListingTitle', 'verified', 'author',
];

const CLEAR_CONTRACT_DECISION_LISTING_STATE = [
  'decision', 'contract', 'listingHardLocked', 'listingHardLockReason', 'listingHardLockBanner',
  // Safeguard 4 — MOVED here from the preserve-list. ebayUrl/ebayItemId are
  // the DIRECT identifier/page of a specific eBay listing — one that,
  // under the OLD identity, describes and titles itself as the WRONG book
  // ("Strange Tales #9"). Unconditionally cleared regardless of status
  // (unlike bundleId/soldPrice/status below, which have a genuine
  // historical-fact carve-out) — an eBay listing page for the wrong title
  // has no legitimate reading under the corrected card at all, not even a
  // historical one; the listing's own title text is simply wrong now.
  'ebayUrl', 'ebayItemId',
];

// Flattened, deduplicated union — the actual list `buildCorrectedCatalogueItem`
// iterates. Sub-arrays above exist for reviewability, not as a second
// source of truth; this is the one export consumers should use.
export const IDENTITY_DEPENDENT_FIELDS_TO_CLEAR = Array.from(new Set([
  ...CLEAR_PC_COMICVINE_GOCOLLECT_IDS,
  ...CLEAR_COMP_POOLS,
  ...CLEAR_EVIDENCE_POPULATIONS,
  ...CLEAR_AVERAGES_FLOOR_HIGH_LASTSOLD,
  ...CLEAR_LADDER_HISTORY,
  ...CLEAR_RECOMMENDATION_BANDS,
  ...CLEAR_PRICING_SOURCE_DERIVATION,
  ...CLEAR_VELOCITY_DEMAND_TREND,
  ...CLEAR_STORY_METADATA,
  ...CLEAR_VARIANT_PRINTING,
  ...CLEAR_PRIOR_IDENTITY_WARNINGS,
  ...CLEAR_CONTRACT_DECISION_LISTING_STATE,
]));

// ─────── Safeguard 4: conditionally-preserved-on-sold-status group ───────
//
// Neither a blanket "clear" nor a blanket "preserve" is correct for these
// three — per explicit ruling: completed, historical sale data is a
// genuine fact independent of which specific issue we now believe this
// physical book to be (the transaction happened; the buyer paid a real
// price for a real physical item, whatever we call it today), so it MAY
// preserve — but ONLY when the old item's own status says the sale
// actually completed. Active-listing/bundle-grouping state tied to the OLD
// (wrong) identity must NOT auto-survive: an active `status:'listed'`
// entry, or a `bundleId` grouping it into an active bundle, describes a
// listing that (like ebayUrl/ebayItemId above) is titled under the wrong
// book and needs to be re-evaluated under the corrected identity, not
// silently carried forward as if still valid.
export const CONDITIONALLY_PRESERVED_ON_SOLD_STATUS = ['status', 'soldPrice', 'bundleId'];

// ─────────────────── identity-independent / user-owned preserve list ───────────────────
//
// Fields that must survive a corrected re-identification untouched —
// because they belong to the user's ownership of the physical collection
// entry (never derived from title/issue/year/publisher), or because they
// describe the CGC slab/grading-service record or physical condition of
// the object itself (not which printing/variant/title it is). Confirmed
// against actual App.jsx catalogue-item field usage rather than assumed —
// this app has no generic per-item "notes" field (only a separate,
// unrelated trade-pile-modal `notes` state), so it is NOT included here.
// `status`/`soldPrice`/`bundleId` are NOT here — see
// CONDITIONALLY_PRESERVED_ON_SOLD_STATUS above; `variant`/`isReprint`/
// `editionType`/`ebayUrl`/`ebayItemId`/`listPrice`/`listPriceManual` are
// NOT here either — see the Safeguard 4 notes in the clear-list above.
export const IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE = [
  // Collection ownership / acquisition
  'id', 'timestamp', 'purchasePrice', 'userFmv98',
  // Photos (the actual evidence a re-scan would need to originate from)
  'images',
  // Photo-derived condition/grade/slab/grading-service data — describes
  // the physical object and its CGC record, not which title/issue/variant
  // it is. Unaffected by a text-only title/issue/year/publisher
  // correction (no new image submitted, no new slab lookup performed).
  'grade', 'isGraded', 'numericGrade', 'confidence',
  'certNumber', 'cgcLabel', 'cgcVerified', 'labelType', 'labelNotes',
  'defectPenalty', 'cgcPenaltyFlags', 'restoration',
  'assetType', 'assetTypeConfident', 'gradeLocked',
];

// ─────────────────────────── the merge itself ───────────────────────────

/**
 * Builds the corrected catalogue item: clears every identity-dependent
 * field on the OLD item, applies the conditional-on-sold-status group,
 * merges the new enrich response on top (so whatever it actually computed
 * populates those now-empty slots), then re-asserts the preserve list AND
 * the conditional group from the OLD item (defensive — guards against an
 * enrich response accidentally carrying a same-named key) and pins `id` to
 * the original. `contract`/`decision` are included in the clear list
 * specifically so a stale READY/REFUSED/LOCKED/price-ready state can never
 * survive under a corrected identity — the caller must recompute them from
 * the new response, never inherit the old card's.
 *
 * @param {Object} oldItem - the existing catalogue item (pre-correction)
 * @param {Object} enrichData - the /api/enrich response for the corrected identity
 * @returns {Object} the merged item, ready for putComic/setCatalogue/setSelectedItem
 */
export const buildCorrectedCatalogueItem = (oldItem, enrichData) => {
  const wasSold = oldItem?.status === 'sold';

  const cleared = { ...oldItem };
  for (const field of IDENTITY_DEPENDENT_FIELDS_TO_CLEAR) {
    cleared[field] = null;
  }
  for (const field of CONDITIONALLY_PRESERVED_ON_SOLD_STATUS) {
    cleared[field] = wasSold ? oldItem[field] : null;
  }

  const merged = { ...cleared, ...(enrichData || {}) };

  // GrailKey Directive Q, Task 2 (corrective) — found while auditing every
  // variant/variantNote merge boundary in the repo (Directive P shipped a
  // different variant-custody bug at the App.jsx sites; this one is
  // separate). `variant` IS in IDENTITY_DEPENDENT_FIELDS_TO_CLEAR (line
  // ~399, `cleared.variant` unconditionally null above), but `enrichData`'s
  // own field name is `variantNote`, not `variant` — the generic
  // `{...cleared, ...enrichData}` spread never renames it, so `merged.variant`
  // stayed null on EVERY manual correction regardless of what the server
  // actually determined (unlike Directive Q's other 6 fixes, which resurrect
  // a stale value on null — this site was silently discarding a real value
  // unconditionally, a distinct and more severe defect). No presence-check
  // needed here specifically: `cleared.variant` is already, deliberately,
  // always null (a correction discards the old identity's variant by
  // design, per this function's own clear-list contract), so there is no
  // "prior" to accidentally resurrect — `?? null` alone is correct in this
  // one context, unlike the App.jsx sites where a real prior value exists.
  merged.variant = enrichData?.variantNote ?? null;

  // GK-85 (GrailKey Directive T, Task 3) — identityAuthority is NOT in
  // IDENTITY_DEPENDENT_FIELDS_TO_CLEAR (a correction to one facet must not
  // wipe out a lock on a DIFFERENT facet from an earlier correction), so
  // `cleared.identityAuthority` above is simply `oldItem.identityAuthority`,
  // untouched. But the raw `{...cleared, ...enrichData}` spread two lines
  // up would then WHOLESALE REPLACE it with `enrichData.identityAuthority`
  // (only the field(s) THIS correction just set) the moment the server
  // response carries the key at all — silently dropping every other
  // previously-locked facet. mergeIdentityAuthority (src/lib/
  // dataQualityGuard.js) is the presence-aware, per-field merge that
  // avoids this: this correction's newly-locked field(s) are added,
  // everything else oldItem already had stays.
  merged.identityAuthority = mergeIdentityAuthority(enrichData, oldItem);

  for (const field of IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE) {
    merged[field] = oldItem[field];
  }
  // Re-assert the conditional group after the enrichData spread too — an
  // enrich response should never carry status/soldPrice/bundleId at all,
  // but defensively guard the same way the preserve-list does.
  for (const field of CONDITIONALLY_PRESERVED_ON_SOLD_STATUS) {
    merged[field] = wasSold ? oldItem[field] : null;
  }
  merged.id = oldItem.id;
  return merged;
};

// ─────────────────────── provenance construction ───────────────────────

/**
 * Builds the `manualCorrection` + `issueAuthority` objects api/enrich.js
 * sets on `out` after a successful validated correction. Extracted as its
 * own exported pure function (same "extract for testability" pattern this
 * campaign uses throughout — applyVariantPreferenceFilter,
 * applyEraConsistencyFilter, etc.) so the server call site and this file's
 * tests invoke the IDENTICAL construction, per invariant 10.
 *
 * `issueAuthority` is only ever returned when 'issue' is one of the
 * accepted fields — a correction that only touched title/year/publisher
 * makes no claim about issue authority and must not fabricate one. Never
 * defaults `source` to 'vision' on unknown prior provenance — an older
 * cached record with no `issueAuthority` at all surfaces as an honest
 * `null` prior source, never a guess.
 *
 * SAFEGUARD 3 — `priorIdentity` is browser-supplied (the client's own
 * snapshot of the card before correction), not something the server
 * independently loaded or verified. Every prior-value/prior-source record
 * this function produces is tagged `provenanceTrust: 'client-reported'` so
 * nothing downstream can mistake it for a server-verified fact.
 *
 * @param {{acceptedFields: string[], rejectedFields: string[], normalizedValues: Object}} validation - validateManualAuthority's return
 * @param {{title?, issue?, year?, publisher?, issueAuthority?}} priorIdentity - client-supplied snapshot of the card BEFORE correction
 * @returns {{manualCorrection: Object, issueAuthority: Object|undefined}}
 */
export const buildManualCorrectionProvenance = (validation, priorIdentity) => {
  const priorSnapshot = priorIdentity && typeof priorIdentity === 'object' ? priorIdentity : {};
  const corrections = {};
  for (const field of validation.acceptedFields) {
    const newValue = validation.normalizedValues[field];
    const priorValue = priorSnapshot[field] ?? null;
    // Only the 'issue' field currently carries a structured prior-source
    // signal (issueAuthority, this function's own introduction) — title/
    // year/publisher have no equivalent authority object yet in this
    // codebase, so their priorSource is honestly null, not guessed.
    const priorSource = field === 'issue' ? (priorSnapshot.issueAuthority?.source ?? null) : null;
    corrections[field] = { newValue, newSource: 'user', priorValue, priorSource, provenanceTrust: 'client-reported' };
  }

  const result = {
    manualCorrection: {
      correctedBy: 'user',
      correctedFields: validation.acceptedFields,
      rejectedFields: validation.rejectedFields,
      corrections,
    },
  };

  if (validation.acceptedFields.includes('issue')) {
    const priorObservations = [];
    if (priorSnapshot.issue != null) {
      priorObservations.push({
        value: priorSnapshot.issue,
        source: priorSnapshot.issueAuthority?.source ?? null,
        status: priorSnapshot.issueAuthority?.status ?? null,
        provenanceTrust: 'client-reported',
      });
    }
    result.issueAuthority = {
      source: 'user',
      status: 'confirmed',
      confidence: 'high',
      reasons: ['user-correction'],
      priorObservations,
    };
  }

  return result;
};

// ─────────────────── Safeguard 5: client payload + collection integrity ───────────────────

/**
 * Builds the exact /api/enrich request body a manual correction submits —
 * the real four-condition manual-entry contract (Safeguard 1) plus
 * manualAuthority and a client-side priorIdentity snapshot. Extracted so
 * the App.jsx submit handler and this feature's tests construct the
 * IDENTICAL payload shape, rather than a test mirroring what the client
 * code is trusted to do correctly on its own.
 *
 * @param {Object} item - the existing catalogue item being corrected
 * @param {Object} correctedValues - { [field]: newValue } for only the fields the user actually changed
 * @param {string[]} correctedFields - which fields correctedValues covers
 * @param {string} [scanId] - GrailKey Directive T, Task 5 — the ownership
 *   identity minted when this correction began (src/lib/scanOwnership.js).
 *   Echoed back verbatim on the response (api/enrich.js:2476, the same
 *   generic mechanism gradeBlob already relies on), letting the caller
 *   detect whether a newer operation has superseded this one by the time
 *   the response returns. Optional so existing callers/tests that don't
 *   care about ownership are unaffected.
 * @returns {Object} the request body for POST /api/enrich
 */
export const buildManualCorrectionPayload = (item, correctedValues, correctedFields, scanId) => ({
  manualIdentity: true,
  skipVision: true,
  skipImageSearch: true,
  identitySource: 'manual',
  confidence: 'HIGH',
  ...(scanId ? { scanId } : {}),
  collectionItemId: item.id, // GK-145 (GrailKey Dispatch 2026-08-21) — correction always targets an existing collection record
  title: correctedValues.title ?? item.title,
  issue: correctedValues.issue ?? item.issue,
  year: correctedValues.year ?? item.year,
  publisher: correctedValues.publisher ?? item.publisher,
  // GrailKey Directive T, Task 4 — same convention as the four fields above.
  variant: correctedValues.variant ?? item.variant,
  manualAuthority: { correctedBy: 'user', correctedFields },
  priorIdentity: {
    title: item.title ?? null,
    issue: item.issue ?? null,
    year: item.year ?? null,
    publisher: item.publisher ?? null,
    variant: item.variant ?? null,
    issueAuthority: item.issueAuthority ?? null,
  },
});

/**
 * Pure array-replacement: swaps exactly the item matching `correctedItem.id`
 * for `correctedItem`, leaving every other item and the array's length
 * untouched. No duplicate append, no accidental removal. Extracted so
 * App.jsx's `setCatalogue((prev) => ...)` call and this feature's tests
 * exercise the identical replacement logic.
 *
 * @param {Array<Object>} catalogue - the current catalogue array
 * @param {Object} correctedItem - the item to replace by id
 * @returns {Array<Object>} a new array, same length, with one item replaced
 */
export const replaceCatalogueItemById = (catalogue, correctedItem) =>
  (catalogue || []).map((x) => (x.id === correctedItem.id ? correctedItem : x));

/**
 * Unifies the merge (buildCorrectedCatalogueItem) and the collection
 * replacement (replaceCatalogueItemById) into one call — the exact
 * sequence App.jsx's submitManualCorrection performs against React state,
 * expressed as a pure function so it's directly testable without a
 * component render.
 *
 * @param {Array<Object>} catalogue - the current catalogue array
 * @param {Object} oldItem - the existing catalogue item (pre-correction)
 * @param {Object} enrichData - the /api/enrich response for the corrected identity
 * @returns {{correctedItem: Object, updatedCatalogue: Array<Object>}}
 */
export const applyManualCorrectionResult = (catalogue, oldItem, enrichData) => {
  const correctedItem = buildCorrectedCatalogueItem(oldItem, enrichData);
  const updatedCatalogue = replaceCatalogueItemById(catalogue, correctedItem);
  return { correctedItem, updatedCatalogue };
};
