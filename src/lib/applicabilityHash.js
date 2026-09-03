// src/lib/applicabilityHash.js — D5B 0015, applicability-hash-v1.
//
// NOT wired into any production endpoint, adapter, or DB write path --
// design + scratch-proof only, same convention as mo-hash-v1/vq-hash-v1.
//
// D9 (judgment identity/cardinality): D9 rules OUT a plain
// UNIQUE(observation_id, question_id) constraint -- multiple judgments
// for the same pair are legal and expected (a rule-version bump, a
// model-version bump, or a genuinely independent second opinion all
// produce additional, legitimately distinct rows over the SAME pair).
// What must still be prevented is "same judgment replay" -- a caller
// retrying an identical write after a network blip, or re-running the
// identical rule/version over the identical observation/question and
// reaching the identical conclusion, should not silently multiply rows
// forever. The mechanism is the SAME one D5A already proved for
// MarketObservation: a per-row content hash, UNIQUE-indexed alongside
// the pair it judges, so an exact semantic repeat is a dedup collision
// (app-layer resolve-or-create, exactly D5A's own documented contract)
// while any genuinely different judgment (different rule, version,
// model, verdict, confidence, or reason) gets its own row.
//
// Tuple, in ratified order (frozen by this file):
//   1. HASH_CONTRACT_VERSION ('applicability-hash-v1')
//   2. observationId   -- WHICH MarketObservation
//   3. questionId      -- WHICH ValuationQuestion
//   4. verdict          -- 'APPLICABLE' | 'NOT_APPLICABLE' (D7: exactly
//                          two primitive verdict states -- CONTESTED is
//                          never a persisted verdict value, only a
//                          read-time derived concept over multiple rows,
//                          see db/data0/0015's applicability_contested_
//                          pairs view)
//   5. confidenceTier   -- 'LOW' | 'MEDIUM' | 'HIGH' (V1, corrected --
//                          see this module's own header comment on WHY
//                          this is not named/valued like D4's
//                          resolution_authority)
//   6. ruleId            -- generic rule/filter identifier
//   7. ruleVersion       -- nullable (not every judgment mechanism is
//                          versioned identically)
//   8. modelVersion      -- nullable (model-based judgments only)
//   9. sourceType        -- 'automated' | 'operator-override'
//  10. reason            -- nullable free text
//
// Deliberately EXCLUDED (provenance/timing metadata, not judgment
// content -- same treatment mo-hash-v1 already gives recorded_by_
// principal_id/recorded_at/correlation_id/raw_payload/content_hash
// itself): recordedByPrincipalId, recordedAt, correlationId. WHO
// happened to record an otherwise-identical judgment does not make it a
// different judgment, exactly as WHO ingested an otherwise-identical
// market listing does not make it a different observation.

import {
  serializeCanonicalTuple,
  hashCanonicalBuffer,
  normalizeText,
  normalizeLowerToken,
  normalizeUuid,
} from './canonicalHashFraming.js';

export { normalizeText, normalizeLowerToken, normalizeUuid } from './canonicalHashFraming.js';

export const HASH_CONTRACT_VERSION = 'applicability-hash-v1';

export const VERDICT_VALUES = Object.freeze(['APPLICABLE', 'NOT_APPLICABLE']);
export const CONFIDENCE_TIER_VALUES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
export const SOURCE_TYPE_VALUES = Object.freeze(['automated', 'operator-override']);

export function normalizeVerdict(value) {
  const v = normalizeLowerToken(value)?.toUpperCase() ?? null;
  if (v === null) throw new Error('normalizeVerdict: verdict is required (never null)');
  if (!VERDICT_VALUES.includes(v)) {
    throw new Error(`normalizeVerdict: expected one of ${VERDICT_VALUES.join('/')}, got ${JSON.stringify(value)}`);
  }
  return v;
}

export function normalizeConfidenceTier(value) {
  const v = normalizeLowerToken(value)?.toUpperCase() ?? null;
  if (v === null) throw new Error('normalizeConfidenceTier: confidence tier is required (never null)');
  if (!CONFIDENCE_TIER_VALUES.includes(v)) {
    throw new Error(`normalizeConfidenceTier: expected one of ${CONFIDENCE_TIER_VALUES.join('/')}, got ${JSON.stringify(value)}`);
  }
  return v;
}

export function normalizeSourceType(value) {
  const v = normalizeLowerToken(value);
  if (v === null) throw new Error('normalizeSourceType: source type is required (never null)');
  if (!SOURCE_TYPE_VALUES.includes(v)) {
    throw new Error(`normalizeSourceType: expected one of ${SOURCE_TYPE_VALUES.join('/')}, got ${JSON.stringify(value)}`);
  }
  return v;
}

// normalizeRuleId / normalizeRuleVersion / normalizeModelVersion --
// generic identifiers, same normalizeText discipline as MarketObservation's
// provider_item_id (present-but-empty stays distinct from absent).
export const normalizeRuleId = normalizeText;
export const normalizeRuleVersion = normalizeText;
export const normalizeModelVersion = normalizeText;
export const normalizeReason = normalizeText;

export function serializeApplicabilityTuple({
  observationId, questionId, verdict, confidenceTier, ruleId, ruleVersion, modelVersion, sourceType, reason,
}) {
  return serializeCanonicalTuple([
    HASH_CONTRACT_VERSION,
    observationId, questionId, verdict, confidenceTier,
    ruleId, ruleVersion, modelVersion, sourceType, reason,
  ]);
}

export function computeApplicabilityHash(canonicalFields) {
  return hashCanonicalBuffer(serializeApplicabilityTuple(canonicalFields));
}

export function canonicalizeApplicabilityFields({
  observationId, questionId, verdict, confidenceTier, ruleId, ruleVersion, modelVersion, sourceType, reason,
}) {
  return {
    observationId: normalizeUuid(observationId),
    questionId: normalizeUuid(questionId),
    verdict: normalizeVerdict(verdict),
    confidenceTier: normalizeConfidenceTier(confidenceTier),
    ruleId: normalizeRuleId(ruleId),
    ruleVersion: normalizeRuleVersion(ruleVersion),
    modelVersion: normalizeModelVersion(modelVersion),
    sourceType: normalizeSourceType(sourceType),
    reason: normalizeReason(reason),
  };
}
