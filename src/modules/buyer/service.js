// src/modules/buyer/service.js — the public surface implementation.
// Orchestrates transactions, calls repository.js, NEVER issues SQL
// directly. Mirrors src/modules/assets/service.js's own shape:
//   1. validate required/enum fields (before touching the DB at all)
//   2. acquire a connection, assertPrincipalActive (read, pre-transaction)
//   3. BEGIN
//   4. check idempotency replay — if hit, COMMIT (no-op) and return the
//      ORIGINAL result verbatim, zero new rows
//   5. verify any referenced row (a buyer_decision_event, for an
//      acquisition) exists and belongs to the caller
//   6. perform the mutation
//   7. claim the idempotency key (if one was supplied)
//   8. COMMIT (or ROLLBACK on any thrown error, in a catch)
//
// BUY and PASS are handled by the exact same function — this module has
// no branch anywhere that treats one decision value as more durable,
// more validated, or more first-class than the other.

import * as repo from './repository.js';
import { acquireConnection } from './db.js';
import { checkIdempotencyReplay, claimIdempotencyKey, computeRequestFingerprint } from './idempotency.js';
import { NotFoundError, ValidationFailedError, AuthorizationFailedError } from './errors.js';
// GK-241 hotfix (2026-09-21) — the single source of truth for every
// marketStanding value deriveMarketStanding can actually emit. This
// module previously maintained its own separate, hand-copied whitelist
// (['EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY']) that silently
// drifted from the real function three times over (missing FALLBACK_ONLY
// and NONE from before this fix, then GK-238's NO_SOLD_EVIDENCE) —
// rejecting real Production Buyer Decisions for those standings with a
// genuine HTTP 400. Importing the constant directly, rather than
// re-copying its values, makes that drift class structurally impossible
// going forward: any future addition/removal in actionAuthority.js's own
// return statements updates this validation automatically, in the same
// commit, by construction.
import { MARKET_STANDING_VALUES } from '../../lib/actionAuthority.js';

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

function requireEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new ValidationFailedError(`${fieldName} must be one of [${allowed.join(', ')}], got: ${JSON.stringify(value)}`);
  }
}

function requireNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationFailedError(`${fieldName} must be a finite number, got: ${JSON.stringify(value)}`);
  }
}

async function assertPrincipalActive(client, principalId) {
  if (!principalId) throw new AuthorizationFailedError('principalId is required');
  const exists = await repo.assertPrincipalExists(client, principalId);
  if (!exists) throw new AuthorizationFailedError(`principalId ${principalId} does not resolve to a real gk_principal row`);
}

// appendBuyerDecision — a BUY or PASS evaluation, equally durable.
export async function appendBuyerDecision({
  principalId, sessionId, gkAssetId,
  observedTitle, observedIssue, observedPublisher, observedYear, observedVariant, observedGrade,
  marketValueAmount, marketValueCurrency,
  contemplatedPriceAmount,
  feePct, suppliesAmount, laborAmount, targetProfitAmount,
  maxBuyAmount, netProfitAmount,
  decision,
  pricingSource, priceBandsSource, marketStanding,
  soldCompCount, activeCompCount, totalCompCount, verifiedCompCount,
  matchConfidenceTier, matchConfidenceScore,
  idempotencyKey, occurredAt,
} = {}) {
  requireFields({ principalId, sessionId, decision }, ['principalId', 'sessionId', 'decision']);
  requireEnum(decision, ['BUY', 'PASS'], 'decision');
  requireNumber(marketValueAmount, 'marketValueAmount');
  requireNumber(contemplatedPriceAmount, 'contemplatedPriceAmount');
  requireNumber(feePct, 'feePct');
  requireNumber(suppliesAmount, 'suppliesAmount');
  requireNumber(laborAmount, 'laborAmount');
  requireNumber(targetProfitAmount, 'targetProfitAmount');
  if (marketStanding != null) requireEnum(marketStanding, MARKET_STANDING_VALUES, 'marketStanding');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'appendBuyerDecision';
      // Semantic payload: what this request MEANS. Deliberately the
      // decision-defining numbers/enum, not every provenance field — a
      // retry with slightly reformatted (but equivalent) provenance text
      // must not spuriously conflict with itself.
      const requestFingerprint = computeRequestFingerprint({
        principalId, sessionId, gkAssetId: gkAssetId ?? null,
        marketValueAmount, contemplatedPriceAmount, feePct, suppliesAmount, laborAmount, targetProfitAmount,
        maxBuyAmount: maxBuyAmount ?? null, decision,
      });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      const buyerDecisionEventId = await repo.insertBuyerDecisionEvent(client, {
        principalId, sessionId, gkAssetId: gkAssetId ?? null,
        observedTitle, observedIssue, observedPublisher, observedYear, observedVariant, observedGrade,
        marketValueAmount, marketValueCurrency,
        contemplatedPriceAmount,
        feePct, suppliesAmount, laborAmount, targetProfitAmount,
        maxBuyAmount, netProfitAmount,
        decision,
        pricingSource, priceBandsSource, marketStanding,
        soldCompCount, activeCompCount, totalCompCount, verifiedCompCount,
        matchConfidenceTier, matchConfidenceScore,
        recordedByPrincipalId: principalId, occurredAt,
        idempotencyKey,
      });

      const result = { buyerDecisionEventId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// appendBuyerAcquisition — a later, independent, immutable fact. NEVER
// touches the buyer_decision_event row it references.
export async function appendBuyerAcquisition({
  principalId, buyerDecisionEventId, actualPurchasePriceAmount, actualPurchaseCurrency, gkAssetId,
  idempotencyKey, occurredAt,
} = {}) {
  requireFields({ principalId, buyerDecisionEventId }, ['principalId', 'buyerDecisionEventId']);
  requireNumber(actualPurchasePriceAmount, 'actualPurchasePriceAmount');

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'appendBuyerAcquisition';
      const requestFingerprint = computeRequestFingerprint({ buyerDecisionEventId, actualPurchasePriceAmount });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      const decisionRow = await repo.getBuyerDecisionEventById(client, buyerDecisionEventId);
      if (!decisionRow) throw new NotFoundError(`buyer_decision_event ${buyerDecisionEventId} does not exist`);
      if (decisionRow.principal_id !== principalId) {
        throw new AuthorizationFailedError(`principalId ${principalId} did not record buyer_decision_event ${buyerDecisionEventId}`);
      }

      const buyerAcquisitionEventId = await repo.insertBuyerAcquisitionEvent(client, {
        buyerDecisionEventId, actualPurchasePriceAmount, actualPurchaseCurrency, gkAssetId,
        recordedByPrincipalId: principalId, occurredAt, idempotencyKey,
      });

      const result = { buyerAcquisitionEventId };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// listBuyerDecisions — read-only. Every returned decision carries its
// own acquisitions array (zero or more) — a PASS decision legitimately
// returns an empty array, never an error, never a required field.
export async function listBuyerDecisions({ principalId, limit, before } = {}) {
  requireFields({ principalId }, ['principalId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const decisions = await repo.listBuyerDecisionEventsByPrincipal(client, { principalId, limit, before });
    const acquisitions = await repo.listAcquisitionEventsForDecisions(client, decisions.map((d) => d.id));
    const byDecision = new Map();
    for (const a of acquisitions) {
      const list = byDecision.get(a.buyer_decision_event_id) || [];
      list.push(a);
      byDecision.set(a.buyer_decision_event_id, list);
    }
    return decisions.map((d) => ({ ...d, acquisitions: byDecision.get(d.id) || [] }));
  } finally {
    client.release();
  }
}
