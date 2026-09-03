// src/lib/marketPopulationHash.js — D5C, market-population-hash-v1.
//
// NOT wired into any production endpoint, adapter, or DB write path --
// design + scratch-proof only, same convention as mo-hash-v1/vq-hash-v1/
// applicability-hash-v1. Reuses the shared canonical framing primitive
// (src/lib/canonicalHashFraming.js) directly -- no independent encoder
// (Section 12).
//
// Two-level digest, both using the identical shared primitive:
//   1. memberSetDigest -- a fixed-length SHA-256 fold of the ENTIRE
//      member set (sorted deterministically by observation_id, tie-
//      broken by member_status, so the digest is order-INSENSITIVE --
//      Section 9 ruled member order is not semantically meaningful in
//      this pass; MP-NP11 proves reordering the input array does not
//      change the digest).
//   2. computeMarketPopulationHash -- the population HEADER's own
//      content hash: version tag, valuationQuestionId,
//      populationRuleVersion, memberSetDigest. This keeps the header
//      hash computation O(1)-sized regardless of population size,
//      rather than concatenating arbitrarily many raw member fields
//      into one unbounded buffer.
//
// Tuple, in ratified order (frozen by this file):
//   HEADER:  1. HASH_CONTRACT_VERSION ('market-population-hash-v1')
//            2. valuationQuestionId
//            3. populationRuleVersion
//            4. memberSetDigest
//   MEMBER SET (folded into memberSetDigest, sorted before hashing):
//            for each member, in sorted order:
//              observationId, memberStatus

import {
  encodeField,
  serializeCanonicalTuple,
  hashCanonicalBuffer,
  normalizeLowerToken,
  normalizeText,
  normalizeUuid,
} from './canonicalHashFraming.js';

export { encodeField, normalizeText, normalizeUuid } from './canonicalHashFraming.js';

export const HASH_CONTRACT_VERSION = 'market-population-hash-v1';

export const MEMBER_STATUS_VALUES = Object.freeze(['SELECTED', 'EXCLUDED']);

export function normalizeMemberStatus(value) {
  const v = normalizeLowerToken(value)?.toUpperCase() ?? null;
  if (v === null) throw new Error('normalizeMemberStatus: member_status is required (never null)');
  if (!MEMBER_STATUS_VALUES.includes(v)) {
    throw new Error(`normalizeMemberStatus: expected one of ${MEMBER_STATUS_VALUES.join('/')}, got ${JSON.stringify(value)}`);
  }
  return v;
}

export const normalizePopulationRuleVersion = normalizeText;
export const normalizeExclusionReason = normalizeText;

// computeMemberSetDigest -- deterministic, order-insensitive fold of
// the full member set. Sorts by (observationId, memberStatus) before
// serializing, so the SAME semantic set always digests identically
// regardless of the order members were evaluated or passed in.
export function computeMemberSetDigest(members) {
  const canonicalMembers = members
    .map(({ observationId, memberStatus }) => ({
      observationId: normalizeUuid(observationId),
      memberStatus: normalizeMemberStatus(memberStatus),
    }))
    .sort((a, b) => {
      if (a.observationId < b.observationId) return -1;
      if (a.observationId > b.observationId) return 1;
      return a.memberStatus < b.memberStatus ? -1 : a.memberStatus > b.memberStatus ? 1 : 0;
    });
  const fields = [HASH_CONTRACT_VERSION, String(canonicalMembers.length)];
  for (const m of canonicalMembers) fields.push(m.observationId, m.memberStatus);
  return hashCanonicalBuffer(serializeCanonicalTuple(fields));
}

export function serializeMarketPopulationTuple({ valuationQuestionId, populationRuleVersion, memberSetDigest }) {
  return serializeCanonicalTuple([
    HASH_CONTRACT_VERSION, valuationQuestionId, populationRuleVersion, memberSetDigest,
  ]);
}

export function computeMarketPopulationHash(canonicalFields) {
  return hashCanonicalBuffer(serializeMarketPopulationTuple(canonicalFields));
}

export function canonicalizeMarketPopulationFields({ valuationQuestionId, populationRuleVersion, members }) {
  return {
    valuationQuestionId: normalizeUuid(valuationQuestionId),
    populationRuleVersion: normalizePopulationRuleVersion(populationRuleVersion),
    memberSetDigest: computeMemberSetDigest(members),
  };
}
