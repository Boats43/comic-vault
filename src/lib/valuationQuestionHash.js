// src/lib/valuationQuestionHash.js — D5B 0015, vq-hash-v1.
//
// NOT wired into any production endpoint, adapter, or DB write path --
// design + scratch-proof only, same "designed, unconsumed" convention as
// marketObservationHash.js (mo-hash-v1) before it. No writer is
// authorized to call this (0015 is a design + scratch-proof pass; live
// migration, D5C, D5D, and any runtime writer are explicitly out of
// scope -- see docs/adr/ADR-VALUATION-001-question-applicability.md).
//
// Ratifies R5 (question hash) and V3 (reuse D5A's serializer verbatim):
// this module owns ONLY the ValuationQuestion tuple shape, its own
// version prefix ('vq-hash-v1'), and field-specific normalization --
// every byte-framing primitive (encodeField/hashCanonicalBuffer) and
// every domain-agnostic normalizer (canonicalMinimalDecimal/normalizeText/
// normalizeLowerToken) is imported unchanged from
// src/lib/canonicalHashFraming.js, the same module mo-hash-v1 now uses.
//
// D5B 0015, D2/D3 field admission (ADR-VALUATION-001 R2 + this pass's
// D2 re-audit): exactly the semantic assumptions that change what a
// correct valuation answer would be, plus the identity anchor (D1) that
// says WHICH physical instance and WHAT GrailKey believed it was at
// question-authoring time. Nothing else -- no query/credential/
// reconciliation input from fetchComps()'s live 22-parameter surface
// participates (COMP_FILTER_VERSION and modelVersion explicitly never
// do, per R3/GK-185).
//
// Tuple, in ratified order (frozen by this file -- changing the order,
// or adding/removing a field, is a hash-contract-version bump, never an
// in-place edit):
//   1. HASH_CONTRACT_VERSION ('vq-hash-v1')
//   2. assetId               -- WHICH physical instance (R1, NOT NULL FK)
//   3. identityAssignmentId  -- WHAT GrailKey believed it was, frozen to
//                                one immutable asset_identity_assignment
//                                row (D1) -- never the "current" identity,
//                                so a later correction (T2) never
//                                retroactively changes a T1 question's
//                                meaning
//   4. targetGrade           -- canonicalMinimalDecimal (same function
//                                mo-hash-v1 uses for grade_numeric --
//                                V4: "9.4"/"9.40" hash identically)
//   5. gradeBasis             -- nullable, source-asserted qualifier
//                                (V4) -- "9.4 CGC" and "9.4 raw-estimate"
//                                are different questions even though the
//                                numeric target is identical
//   6. disposition            -- 'raw' | 'graded' | null ("no disposition
//                                asserted" is a real, pre-existing state
//                                -- api/comps.js's own isGraded parameter
//                                is genuinely tri-state: true/false/
//                                undefined, not a forced boolean)
//   7. variantScope            -- free text, R2
//   8. targetYear              -- canonicalMinimalDecimal (D2 re-audit:
//                                the identity anchor does NOT carry
//                                year/variant at all, so these remain
//                                distinct valuation assumptions, not
//                                duplicative of identity)
//
// Deliberately absent, by R2/R3 (never add without a fresh R2 admission
// argument, and never for filter/model implementation state -- R3):
// title, issue, author, publisher, assetType, imageSearchTitle,
// labelType, categoryId, appId, certId, creator, cvVolumeStartYear,
// artistOverride, signedConsensus, issueAuthorityPresent,
// issueAuthorityStatus, yearIsContested, COMP_FILTER_VERSION,
// modelVersion. See ADR-VALUATION-001's field-classification table for
// the per-field reasoning.

import {
  encodeField,
  serializeCanonicalTuple,
  hashCanonicalBuffer,
  normalizeText,
  normalizeLowerToken,
  canonicalMinimalDecimal,
  normalizeUuid,
} from './canonicalHashFraming.js';

export { encodeField, normalizeText, normalizeLowerToken, canonicalMinimalDecimal, normalizeUuid } from './canonicalHashFraming.js';

export const HASH_CONTRACT_VERSION = 'vq-hash-v1';

// canonicalTargetGradeString -- alias, same function mo-hash-v1 names
// canonicalGradeString. Kept as its own named export for readability at
// ValuationQuestion call sites; NOT a reimplementation.
export const canonicalTargetGradeString = canonicalMinimalDecimal;

// canonicalTargetYearString -- D3: a plain integer year is a
// zero-fractional-digit case of the exact same base-10 canonicalization
// grade already needs (see canonicalHashFraming.js's own doc comment) --
// no separate year-specific function is written; reusing
// canonicalMinimalDecimal directly is the V3 discipline applied to a
// second field on the SAME tuple, not just across modules.
export const canonicalTargetYearString = canonicalMinimalDecimal;

// normalizeDisposition -- 'raw' | 'graded' | null. A fixed, generic
// two-value vocabulary (never a comic-specific grading-service name) --
// null means "no disposition asserted," a real tri-state already live
// in api/comps.js's own isGraded parameter (isGraded === true / === false
// / undefined all currently reachable, api/comps.js:1051-1052), not a
// state this module invents.
export function normalizeDisposition(value) {
  if (value === null || value === undefined) return null;
  const v = normalizeLowerToken(value);
  if (v !== 'raw' && v !== 'graded') {
    throw new Error(`normalizeDisposition: expected 'raw', 'graded', or null/undefined, got ${JSON.stringify(value)}`);
  }
  return v;
}

// normalizeGradeBasis -- same normalizeText discipline mo-hash-v1 uses
// for its own grade_basis (F2/F2a): source-asserted, never inferred,
// present-but-empty stays distinct from genuinely-absent.
export const normalizeGradeBasis = normalizeText;

// normalizeVariantScope -- free text, same normalizeText discipline as
// MarketObservation's condition_text/grade_basis.
export const normalizeVariantScope = normalizeText;

// serializeValuationQuestionTuple(canonicalFields) -- canonicalFields is
// an object of already-normalized strings-or-null, in the exact ratified
// field order documented at the top of this file. Mirrors
// serializeMarketObservationTuple's own shape exactly (same shared
// serializeCanonicalTuple primitive, this module owns only the field
// list).
export function serializeValuationQuestionTuple({
  assetId, identityAssignmentId, targetGrade, gradeBasis, disposition, variantScope, targetYear,
}) {
  return serializeCanonicalTuple([
    HASH_CONTRACT_VERSION,
    assetId, identityAssignmentId,
    targetGrade, gradeBasis, disposition, variantScope, targetYear,
  ]);
}

// computeValuationQuestionHash -- SHA-256 hex digest. Pipes through
// serializeValuationQuestionTuple (field order declared exactly once,
// same anti-drift discipline as mo-hash-v1's own compute function).
export function computeValuationQuestionHash(canonicalFields) {
  return hashCanonicalBuffer(serializeValuationQuestionTuple(canonicalFields));
}

// canonicalizeValuationQuestionFields -- convenience: raw field values
// in, the exact canonical tuple serializeValuationQuestionTuple/
// computeValuationQuestionHash expect, out.
export function canonicalizeValuationQuestionFields({
  assetId, identityAssignmentId, targetGrade, gradeBasis, disposition, variantScope, targetYear,
}) {
  return {
    assetId: normalizeUuid(assetId),
    identityAssignmentId: normalizeUuid(identityAssignmentId),
    targetGrade: canonicalTargetGradeString(targetGrade),
    gradeBasis: normalizeGradeBasis(gradeBasis),
    disposition: normalizeDisposition(disposition),
    variantScope: normalizeVariantScope(variantScope),
    targetYear: canonicalTargetYearString(targetYear),
  };
}
