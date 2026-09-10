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
    return { attempted: true, dryRun: true, payload, timeAudit, retentionAudit };
  }

  const writeResult = await attemptDurablePersistence(payload);
  if (!writeResult.ok) {
    return { attempted: true, dryRun: false, declineReason: D5D_DECLINE_REASONS.WRITE_FAILED, error: writeResult.error };
  }
  return { attempted: true, dryRun: false, result: writeResult.result, elapsedMs: writeResult.elapsedMs };
}
