// src/lib/outcome1RuntimeBridge.js — Outcome #1: durable
// prediction/recommendation wiring.
//
// Reuses the EXISTING, already-built recordValuation/recordDecision
// primitives (src/modules/assets/service.js, valuation_event/
// decision_event tables, live since 0004) rather than inventing a new
// table -- this dispatch's own audit found these functions fully
// implemented, idempotent (GK-163 class-wide law), and asset-linked,
// but with ZERO real call sites (every existing row in both tables is
// fixture/test data, confirmed live-queried, GK-180). This module's
// only job is the narrow mapping from a real enrich.js response
// (out.price, out.decision, out.numericGrade) onto those two
// functions' existing parameter shapes, plus one additive linkage
// (marketPopulationId, db/data0/0020) into D5's own structured
// evidence chain (valuation_question -> market_population ->
// market_observation/applicability).
//
// Semantic separation (non-negotiable, this dispatch's own ruling):
// this module records ONLY what GrailKey predicted and recommended.
// It must NEVER record what the operator chose -- no accepted/
// rejected field, no listing/sale/disposition field, anywhere in this
// file. valuation_result (this module) != operator_action (a later,
// separate dispatch).

import crypto from 'node:crypto';
import { buildDecisionAuthoritySnapshot } from './decisionAuthoritySnapshot.js';

export const OUTCOME1_DECLINE_REASONS = Object.freeze({
  DISABLED: 'outcome1-disabled',
  WRONG_ENVIRONMENT: 'wrong-environment',
  NO_AUTH_CONTEXT: 'no-auth-context',
  NO_PREDICTION: 'no-prediction', // out.price/out.decision absent -- a refusal (refused-to-price, merchandise hard block, ID_REQUIRED) is a legitimate state, never fabricated into a fake result
  ECONOMIC_WRITE_FAILED: 'economic-write-failed', // GK-276: valuation+decision commit atomically -- ONE failure, never an orphan half
  // GK-276 -- Production controlled-canary gates
  PRODUCTION_ASSET_NOT_ALLOWLISTED: 'production-asset-not-allowlisted', // absent/empty allowlist, or the resolved gkAssetId is not in it
  NO_EXPLICIT_INTENT: 'no-explicit-intent', // a refresh alone never writes a durable decision
  BUILD_IDENTITY_UNAVAILABLE: 'build-identity-unavailable', // never write a trusted row with build_sha unknown
  INPUTS_NOT_SERVER_OWNED: 'inputs-not-server-owned', // request identity does not match the durable owned item
});

// GK-276 -- the Production canary boundary. OUTCOME1_PRODUCTION_ASSET_ALLOWLIST
// is a comma-separated list of EXACT gkAssetIds. Absent/empty = NO Production
// Outcome #1 writes. No wildcard, no "all": any entry that is not a canonical
// UUID is ignored (never interpreted as a pattern or as "everything").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseOutcome1ProductionAllowlist(raw) {
  if (typeof raw !== 'string') return new Set();
  return new Set(
    raw.split(',').map((x) => x.trim().toLowerCase()).filter((x) => UUID_RE.test(x))
  );
}
export function isOutcome1ProductionAssetAllowed(raw, gkAssetId) {
  if (!gkAssetId || typeof gkAssetId !== 'string') return false;
  return parseOutcome1ProductionAllowlist(raw).has(gkAssetId.trim().toLowerCase());
}

// A trusted (SERVER_DERIVED) Production row requires a real build identity:
// the git sha prefix api/enrich.js already stamps (VERCEL_GIT_COMMIT_SHA).
export function isRealBuildSha(buildSha) {
  return typeof buildSha === 'string' && /^[0-9a-f]{7,40}$/.test(buildSha);
}

export const ECONOMIC_FINGERPRINT_RULE_VERSION = 'outcome1-economic-fp-v1';

// SAME ECONOMIC DECISION vs MATERIALLY NEW ECONOMIC DECISION.
// The server-derived semantic fingerprint of one economic decision. Inputs are
// ALL server-owned (principal from the verified token, asset from
// collection_item_link, value/decision/grade/evidence from the server's own
// pipeline result, build from the deploy). Anything that does not change the
// economic meaning (timestamps, trace ids, client keys, client list price) is
// deliberately excluded. Identical -> same key -> idempotent replay (zero new
// rows). Any component differing -> a materially new decision (one new
// valuation+decision pair).
export function computeEconomicDecisionFingerprint({
  principalId, gkAssetId, valueAmount, valueCurrency = 'USD', method = 'engine-computed',
  gradeAssumption = null, evidenceKey = null, recommendation, reasonCodes = [],
  buildSha, marketPopulationId = null,
} = {}) {
  const codes = (Array.isArray(reasonCodes) ? reasonCodes : [])
    .map((c) => (c && typeof c === 'object' ? `${c.type}:${c.code}` : String(c)))
    .sort();
  const canonical = JSON.stringify({
    v: ECONOMIC_FINGERPRINT_RULE_VERSION,
    principalId, gkAssetId,
    valueAmount: Number(valueAmount),
    valueCurrency, method,
    gradeAssumption: gradeAssumption == null ? null : String(gradeAssumption),
    evidenceKey: evidenceKey ?? null,
    recommendation, reasonCodes: codes,
    buildSha, marketPopulationId: marketPopulationId ?? null,
  });
  return 'econ-v1:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

// out.price is always a fmtUsd()-formatted string ("$1,234.56") or
// null (src/lib/pricingEngine.js:14) -- never a raw number. This is
// the exact inverse parse, factored out here (not duplicated ad hoc
// at the call site) so it carries its own unit proof.
export function parseFmtUsd(str) {
  if (str == null) return null;
  const stripped = String(str).replace(/[^0-9.-]/g, '');
  // Number('') === 0 in JS -- a string with no digits at all (garbage,
  // not a price) must decline, never silently become a fabricated $0.
  if (stripped === '' || stripped === '-') return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

// Maps decisionEngine.js's own live output shape
// (action/confidence/blockers/warnings/reason/nextStep,
// src/lib/decisionEngine.js) onto decision_event.reason_codes.
// Preserves the blocker-vs-warning distinction as a JSONB array of
// {type, code} pairs -- decisionEngine.js's own vocabulary, verbatim,
// never invented or reworded here.
export function buildDecisionReasonCodes(decision) {
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers : [];
  const warnings = Array.isArray(decision?.warnings) ? decision.warnings : [];
  return [
    ...blockers.map((code) => ({ type: 'blocker', code })),
    ...warnings.map((code) => ({ type: 'warning', code })),
  ];
}

// attemptOutcome1 — the single entry point. Dependency-injected
// (recordEconomicDecision passed in by the caller, mirroring
// d5dRuntimeBridge.js's own attemptChain1 shape) so this file is
// unit-testable without a real Postgres connection. Never throws for
// a decline outcome; a write failure surfaces as a structured
// declineReason, never propagates raw.
//
// GK-276 -- the write is ONE atomic valuation_event + decision_event
// transaction, provenance SERVER_DERIVED, idempotency key derived from
// the server-owned semantic fingerprint above. There is NO client
// idempotency key, and NO client-supplied value anywhere in this path.
export async function attemptOutcome1({
  enabled, // Development: D5D_RUNTIME_ENABLED. Ignored in Production (the allowlist is the Production gate).
  environment,
  allowlistRaw, // Production: OUTCOME1_PRODUCTION_ASSET_ALLOWLIST (raw env string)
  explicitIntent, // Production: the request explicitly asked for a durable decision (never inferred from a refresh)
  principalId,
  gkAssetId,
  marketPopulationId,
  priceString, // out.price, fmtUsd-formatted
  decision, // out.decision
  gradeAssumption, // out.numericGrade
  evidenceKey, // categorical, server-derived evidence descriptor (e.g. pricingSource|matchTier)
  buildSha, // the SAME resolvable build identity already in api/enrich.js's own x-cv-build header (VERCEL_GIT_COMMIT_SHA / CV_BUILD_ID)
  correlationId,
  recordEconomicDecision, // injected: src/modules/assets/index.js's recordEconomicDecision
  authoritySnapshotSource, // GK-278: { out, durable, durableCategoryAuthority } -- the SERVER's own pipeline state; never request-body material
} = {}) {
  if (environment === 'development') {
    if (!enabled) return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.DISABLED };
  } else if (environment === 'production') {
    if (!isOutcome1ProductionAssetAllowed(allowlistRaw, gkAssetId)) {
      return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED };
    }
    if (explicitIntent !== true) {
      return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.NO_EXPLICIT_INTENT };
    }
    if (!isRealBuildSha(buildSha)) {
      return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.BUILD_IDENTITY_UNAVAILABLE };
    }
  } else {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.WRONG_ENVIRONMENT };
  }
  if (!principalId || !gkAssetId) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT };
  }

  const valueAmount = parseFmtUsd(priceString);
  if (valueAmount == null || !decision?.action) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.NO_PREDICTION };
  }

  // decision.timestamp (decisionEngine.js's own Date.now(), set at the
  // exact instant the recommendation was computed) is the true
  // occurredAt -- never persistence time, never a re-derivation.
  const occurredAt = decision.timestamp ? new Date(decision.timestamp).toISOString() : null;
  const reasonCodes = buildDecisionReasonCodes(decision);
  const semanticFingerprint = computeEconomicDecisionFingerprint({
    principalId, gkAssetId, valueAmount, valueCurrency: 'USD', method: 'engine-computed',
    gradeAssumption: gradeAssumption ?? null, evidenceKey: evidenceKey ?? null,
    recommendation: decision.action, reasonCodes, buildSha, marketPopulationId: marketPopulationId ?? null,
  });

  try {
    const r = await recordEconomicDecision({
      principalId,
      gkAssetId,
      valueAmount,
      valueCurrency: 'USD',
      method: 'engine-computed',
      marketPopulationId: marketPopulationId ?? null,
      gradeAssumption: gradeAssumption ?? null,
      buildSha,
      recommendation: decision.action,
      reasonCodes,
      semanticFingerprint,
      correlationId,
      occurredAt,
      authoritySnapshot: authoritySnapshotSource
        ? buildDecisionAuthoritySnapshot(authoritySnapshotSource.out, authoritySnapshotSource.durable, {
          buildSha, gradeAssumption, reasonCodes, decisionAction: decision.action,
          durableCategoryAuthority: authoritySnapshotSource.durableCategoryAuthority,
        })
        : null,
    });
    return { attempted: true, semanticFingerprint, result: { valuationEventId: r.valuationEventId, decisionEventId: r.decisionEventId }, replayed: r.replayed === true };
  } catch (e) {
    return {
      attempted: true,
      declineReason: OUTCOME1_DECLINE_REASONS.ECONOMIC_WRITE_FAILED,
      error: { message: e?.message ?? String(e), pgErrorCode: e?.code ?? null },
    };
  }
}

// GK-276 -- the whole Production canary decision, dependency-injected so every
// branch is unit-provable without a database. api/enrich.js calls this and
// nothing else for the Production path.
const normIdentity = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export async function attemptOutcome1Production({
  environment,
  recordDurableDecision, // req.body.recordDurableDecision -- explicit intent only, never a value
  allowlistRaw,
  ownedRefresh,
  principalId, // ONLY a Bearer-verified principal confirmed to own collectionItemId (GK-260 hoist) -- else null
  collectionItemId,
  durableAttributes, // the durable owned collection_item attributes
  requestIdentity, // { title, issue } as sent in the request
  priceString, decision, gradeAssumption, evidenceKey, buildSha, correlationId,
  resolveCollectionItemLink, recordEconomicDecision, authoritySnapshotSource,
} = {}) {
  if (environment !== 'production' || recordDurableDecision !== true) {
    return { skipped: true }; // not a Production explicit-intent request: nothing to do, nothing to report
  }
  if (parseOutcome1ProductionAllowlist(allowlistRaw).size === 0) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.PRODUCTION_ASSET_NOT_ALLOWLISTED };
  }
  if (!(ownedRefresh === true && principalId && collectionItemId)) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.NO_AUTH_CONTEXT };
  }
  const link = await resolveCollectionItemLink({ principalId, collectionItemId });
  const dTitle = normIdentity(durableAttributes?.title);
  if (dTitle === '' || dTitle !== normIdentity(requestIdentity?.title) || normIdentity(durableAttributes?.issue) !== normIdentity(requestIdentity?.issue)) {
    return { attempted: false, declineReason: OUTCOME1_DECLINE_REASONS.INPUTS_NOT_SERVER_OWNED };
  }
  return attemptOutcome1({
    enabled: false, // Development flag; unused in Production
    environment: 'production',
    allowlistRaw,
    explicitIntent: true,
    principalId,
    gkAssetId: link?.gkAssetId || null,
    marketPopulationId: null, // D5D chain is not part of this canary; legal NULL
    priceString, decision, gradeAssumption, evidenceKey, buildSha, correlationId,
    recordEconomicDecision, authoritySnapshotSource,
  });
}
