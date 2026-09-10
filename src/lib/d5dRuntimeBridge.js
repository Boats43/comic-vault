// src/lib/d5dRuntimeBridge.js — D5D Chain #1 runtime wiring.
//
// GK-180 narrow-open: this is the ONE deliberate runtime integration
// point connecting the already-proven, isolated D5D writer
// (src/modules/valuation/) to a real request path. Default OFF
// everywhere (D5D_RUNTIME_ENABLED unset), hard-gated to
// GRAILKEY_CATALOG_ENVIRONMENT==='development' regardless of the flag —
// Production and Preview D5D remain disabled no matter what. Existing
// gk_asset/collection_item_link only — never mints, never creates
// linkage as a side effect (that would violate the D5D eligibility
// boundary this module exists to enforce, not bypass).
//
// Pure logic, dependency-injected (resolveEligibleSubject,
// attemptDurablePersistence passed in by the caller) — no direct import
// of src/modules/valuation/ here, so this file is unit-testable without
// a real Postgres connection and never itself becomes a second import
// path into that module's private surface.
//
// Structured decline reasons (GK-179/GK-184 dispatch corrections,
// 2026-09-09) — every non-write outcome carries exactly one of these,
// never a bare boolean:

import { classifyEvidenceObservedAt, isEvidenceTimeAdmissible, EVIDENCE_CLASSIFICATION } from './evidenceObservedAt.js';

// The exact enum data1_dev.market_observation.listing_kind's CHECK
// constraint permits (db/data0/0014_d5a_market_observation.sql:216:
// CHECK (listing_kind IN ('asking', 'sold', 'offer', 'auction-result'))).
// A caller that emits any other string gets a live 23514 at write time,
// not a decline -- this happened once (Chain #1's first real-write
// attempt, 2026-09-09, used 'active') and is the exact regression this
// constant plus buildChain1ObservationsFromRawComps's own unit proof
// (tests/d5d-runtime-bridge-unit.test.js) now guard against.
export const MARKET_OBSERVATION_LISTING_KIND = Object.freeze({
  ASKING: 'asking',
  SOLD: 'sold',
  OFFER: 'offer',
  AUCTION_RESULT: 'auction-result',
});

export const D5D_DECLINE_REASONS = Object.freeze({
  DISABLED: 'd5d-disabled',
  WRONG_ENVIRONMENT: 'wrong-environment',
  NO_AUTH_CONTEXT: 'no-auth-context',
  INELIGIBLE_NO_LINK: 'ineligible-no-link',
  EVIDENCE_TIME_MISSING_LEGACY: 'evidence-time-missing-legacy',
  EVIDENCE_TIME_MISSING_MALFORMED: 'evidence-time-missing-malformed',
  NO_OBSERVATIONS: 'no-observations',
  WRITE_FAILED: 'write-failed',
});

// GK-182 retention audit — the exact, exhaustive set of MarketObservation
// fields this bridge is ever allowed to construct. Anything else (a raw
// listing title, URL, seller name, HTML, or any other verbatim
// third-party payload fragment) fails this audit and the attempt is
// aborted before any DB call — a hard error, not a decline, since this
// represents a defect in the CALLER's payload construction, not a
// legitimate ineligibility state.
const ALLOWED_OBSERVATION_KEYS = new Set([
  'provider', 'providerItemId', 'listingKind', 'priceAmount', 'currency',
  'conditionText', 'gradeNumeric', 'gradeBasis', 'occurredOn', 'occurredAt', 'observedAt',
]);
// Belt-and-suspenders: even an allowed key must not carry an obviously
// raw-payload-shaped value (a title/URL string smuggled in under a
// differently-named field).
const SUSPICIOUS_VALUE_RE = /<[a-z]+[\s>]|https?:\/\/(?!.{0,0})|\.com\/itm|VGPC\.pop_data/i;

export function auditGk182Retention(observations) {
  const violations = [];
  for (const [i, o] of observations.entries()) {
    const mo = o?.marketObservation || {};
    for (const key of Object.keys(mo)) {
      if (!ALLOWED_OBSERVATION_KEYS.has(key)) {
        violations.push(`observation[${i}].marketObservation.${key} is not on the allowed GK-182 field list`);
      }
    }
    for (const [key, value] of Object.entries(mo)) {
      if (typeof value === 'string' && SUSPICIOUS_VALUE_RE.test(value)) {
        violations.push(`observation[${i}].marketObservation.${key} value looks like raw provider payload content: ${JSON.stringify(value).slice(0, 60)}`);
      }
    }
  }
  return { compliant: violations.length === 0, violations };
}

// GK-184 evidence-time audit — every observation's observedAt must
// classify PRESENT_VALID. Distinguishes WHY a non-valid state occurred
// (legacy/absent vs. malformed) so a decline can be told apart from a
// broken writer, per the GK-184/GK-179 correction requiring
// distinguishable decline reasons.
export function auditEvidenceTime(observations) {
  const results = observations.map((o, i) => {
    const cls = classifyEvidenceObservedAt(o?.marketObservation?.observedAt);
    return { index: i, classification: cls.classification, admissible: isEvidenceTimeAdmissible(cls.classification) };
  });
  return { allAdmissible: results.every((r) => r.admissible), results };
}

// buildChain1ObservationsFromRawComps — the exact mapping from a
// fetchComps() result to a Chain #1 buildObservations() payload,
// extracted out of api/enrich.js's own wiring so the mapping (in
// particular listingKind) is unit-testable without a DB or a real
// handler invocation. Pure function, no I/O -- up to 3 real comp rows,
// all sharing the ONE genuine provider-retrieval instant this pool was
// fetched at (they came from the same fetchComps() call).
export function buildChain1ObservationsFromRawComps({
  prices,
  evidenceObservedAt,
  confidenceTier,
  ruleVersion,
  targetGrade,
  gradeBasis,
  disposition,
  targetYear,
  populationRuleVersion = 'd5d-chain1-v1',
} = {}) {
  const list = Array.isArray(prices) ? prices : [];
  if (list.length === 0) return null;
  const observations = list.slice(0, 3).map((p) => ({
    marketObservation: {
      provider: 'ebay',
      providerItemId: null, // not extracted from the URL for this minimal proof -- never the raw url itself (GK-182)
      listingKind: MARKET_OBSERVATION_LISTING_KIND.ASKING, // these are active/not-yet-sold eBay Browse API listings
      priceAmount: p.price,
      currency: 'USD',
      conditionText: p.condition || null,
      gradeNumeric: null, // not asserted per-row for this minimal proof -- never fabricated
      gradeBasis: null,
      occurredOn: null,
      occurredAt: p.date || null,
      observedAt: evidenceObservedAt ?? null,
    },
    applicability: {
      verdict: 'APPLICABLE',
      confidenceTier: confidenceTier || 'MEDIUM',
      ruleId: 'comp-filter',
      ruleVersion: String(ruleVersion || '1'),
      modelVersion: null,
      sourceType: 'automated',
      reason: null,
    },
    memberStatus: 'SELECTED',
  })).filter((o) => o.marketObservation.priceAmount != null);
  if (observations.length === 0) return null;
  return {
    targetGrade,
    gradeBasis,
    disposition,
    variantScope: null,
    targetYear,
    populationRuleVersion,
    observations,
  };
}

// attemptChain1 — the single entry point. NEVER throws for an
// ineligibility/decline outcome (matches attemptDurablePersistence's own
// "never throws to the caller" contract) — a GK-182 retention violation
// IS thrown, deliberately, since that represents a caller defect that
// must never be silently swallowed into a generic decline.
export async function attemptChain1({
  enabled,
  dryRun,
  environment,
  principalId,
  collectionItemId,
  buildObservations, // () => { targetGrade, gradeBasis, disposition, variantScope, targetYear, populationRuleVersion, observations } | null
  resolveEligibleSubject,
  attemptDurablePersistence,
  idempotencyKey,
  correlationId,
} = {}) {
  if (!enabled) {
    return { attempted: false, declineReason: D5D_DECLINE_REASONS.DISABLED };
  }
  if (environment !== 'development') {
    return { attempted: false, declineReason: D5D_DECLINE_REASONS.WRONG_ENVIRONMENT };
  }
  if (!principalId || !collectionItemId) {
    return { attempted: false, declineReason: D5D_DECLINE_REASONS.NO_AUTH_CONTEXT };
  }

  const eligibility = await resolveEligibleSubject({ principalId, collectionItemId });
  if (!eligibility?.eligible) {
    return { attempted: false, declineReason: D5D_DECLINE_REASONS.INELIGIBLE_NO_LINK, eligibility };
  }

  const built = buildObservations ? buildObservations() : null;
  if (!built || !Array.isArray(built.observations) || built.observations.length === 0) {
    return { attempted: false, declineReason: D5D_DECLINE_REASONS.NO_OBSERVATIONS };
  }

  const timeAudit = auditEvidenceTime(built.observations);
  if (!timeAudit.allAdmissible) {
    const badOne = timeAudit.results.find((r) => !r.admissible);
    const declineReason = badOne.classification === EVIDENCE_CLASSIFICATION.MALFORMED
      ? D5D_DECLINE_REASONS.EVIDENCE_TIME_MISSING_MALFORMED
      : D5D_DECLINE_REASONS.EVIDENCE_TIME_MISSING_LEGACY;
    return { attempted: false, declineReason, timeAudit };
  }

  const retentionAudit = auditGk182Retention(built.observations);
  if (!retentionAudit.compliant) {
    // Deliberate throw — a caller-payload defect, not a legitimate
    // decline state. D5A rows are immutable; this must be loud, not a
    // silent skip that could be mistaken for routine ineligibility.
    throw new Error(`GK-182 retention violation, refusing to build payload: ${retentionAudit.violations.join('; ')}`);
  }

  const payload = {
    principalId,
    gkAssetId: eligibility.gkAssetId,
    identityAssignmentId: eligibility.identityAssignmentId,
    targetGrade: built.targetGrade,
    gradeBasis: built.gradeBasis,
    disposition: built.disposition,
    variantScope: built.variantScope ?? null,
    targetYear: built.targetYear ?? null,
    observations: built.observations,
    populationRuleVersion: built.populationRuleVersion || 'd5d-chain1-v1',
    idempotencyKey,
    correlationId,
  };

  if (dryRun) {
    return { attempted: true, dryRun: true, payload, timeAudit, retentionAudit, eligibility };
  }

  const writeResult = await attemptDurablePersistence(payload);
  if (!writeResult.ok) {
    return { attempted: true, dryRun: false, declineReason: D5D_DECLINE_REASONS.WRITE_FAILED, error: writeResult.error, eligibility };
  }
  // eligibility carried through on success too (not just the decline
  // path) -- a caller building a downstream durable result (Outcome #1)
  // needs gkAssetId/identityAssignmentId without a second, duplicate
  // resolveEligibleSubject() round trip.
  return { attempted: true, dryRun: false, result: writeResult.result, elapsedMs: writeResult.elapsedMs, eligibility };
}
