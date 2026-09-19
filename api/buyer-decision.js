// POST /api/buyer-decision { action: 'decision', ... }   -> { buyerDecisionEventId }
// POST /api/buyer-decision { action: 'acquisition', ... } -> { buyerAcquisitionEventId }
// GET  /api/buyer-decision                                -> { decisions: [...] }
//
// GRAILKEY — DURABLE BUYER DECISION LEDGER V1. Authenticated Buyer
// decision API. Mirrors api/outcome-economics.js's own auth pattern
// exactly. principalId is NEVER accepted from the request body — derived
// only from the caller's verified Bearer token (src/modules/auth). No
// arbitrary update endpoint exists here or anywhere else for a
// buyer_decision_event/buyer_acquisition_event row — both are
// append-only; this handler exposes exactly three operations (append
// decision, append acquisition, read history), nothing else.
//
// This endpoint creates NO marketplace listing, NO eBay call, NO
// physical-asset capture — it consumes existing valuation evidence
// (MAX BUY, market value, provenance) the client already computed; it
// never recomputes or redefines any of it.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import {
  appendBuyerDecision, appendBuyerAcquisition, listBuyerDecisions,
  NotFoundError, ValidationFailedError, AuthorizationFailedError, IdempotencyConflictError,
} from '../src/modules/buyer/index.js';
import { checkRateLimit } from './rate-limit.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export default async function handler(req, res) {
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  const token = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(token));
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    }
    console.error('[buyer-decision] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (req.method === 'GET') {
    const limit = req.query?.limit ? parseInt(req.query.limit, 10) : undefined;
    const before = req.query?.before || undefined;
    try {
      const decisions = await listBuyerDecisions({ principalId, limit, before });
      return res.status(200).json({ decisions });
    } catch (e) {
      if (e instanceof ValidationFailedError) return res.status(400).json({ error: e.message });
      console.error('[buyer-decision] unexpected error (GET):', e?.message || e);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { action } = body;

  try {
    if (action === 'decision') {
      const result = await appendBuyerDecision({
        principalId,
        sessionId: body.sessionId,
        gkAssetId: body.gkAssetId,
        observedTitle: body.observedTitle, observedIssue: body.observedIssue, observedPublisher: body.observedPublisher,
        observedYear: body.observedYear, observedVariant: body.observedVariant, observedGrade: body.observedGrade,
        marketValueAmount: body.marketValueAmount, marketValueCurrency: body.marketValueCurrency,
        contemplatedPriceAmount: body.contemplatedPriceAmount,
        feePct: body.feePct, suppliesAmount: body.suppliesAmount, laborAmount: body.laborAmount, targetProfitAmount: body.targetProfitAmount,
        maxBuyAmount: body.maxBuyAmount, netProfitAmount: body.netProfitAmount,
        decision: body.decision,
        pricingSource: body.pricingSource, priceBandsSource: body.priceBandsSource, marketStanding: body.marketStanding,
        soldCompCount: body.soldCompCount, activeCompCount: body.activeCompCount, totalCompCount: body.totalCompCount, verifiedCompCount: body.verifiedCompCount,
        matchConfidenceTier: body.matchConfidenceTier, matchConfidenceScore: body.matchConfidenceScore,
        idempotencyKey: body.idempotencyKey,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      });
      return res.status(200).json(result);
    }

    if (action === 'acquisition') {
      const result = await appendBuyerAcquisition({
        principalId,
        buyerDecisionEventId: body.buyerDecisionEventId,
        actualPurchasePriceAmount: body.actualPurchasePriceAmount,
        actualPurchaseCurrency: body.actualPurchaseCurrency,
        gkAssetId: body.gkAssetId,
        idempotencyKey: body.idempotencyKey,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      });
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'action must be "decision" or "acquisition"' });
  } catch (e) {
    if (e instanceof ValidationFailedError) return res.status(400).json({ error: e.message });
    if (e instanceof NotFoundError) return res.status(404).json({ error: 'Not found' });
    if (e instanceof AuthorizationFailedError) return res.status(404).json({ error: 'Not found' });
    if (e instanceof IdempotencyConflictError) return res.status(409).json({ error: e.message });
    console.error('[buyer-decision] unexpected error (POST):', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
