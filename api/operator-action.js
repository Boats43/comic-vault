// POST /api/operator-action -> { operatorActionEventId }
//
// OperatorAction (GK-199, 0021) — the durable record of what the
// AUTHENTICATED HUMAN actually chose, in response to a specific
// existing GrailKey recommendation (decision_event). This is the one
// narrow runtime endpoint this dispatch adds — mirrors api/assets.js's
// own auth pattern exactly.
//
// principalId is NEVER accepted from the request body — it is derived
// exclusively from the caller's own Bearer token (src/modules/auth/),
// the SAME parameter-contract boundary every Asset Service function
// already relies on. A request with no valid token is rejected before
// anything else runs. `source: 'operator-api'` is set here, never
// caller-suppliable — it marks every row this endpoint ever produces as
// a genuinely authenticated call through this real interface, distinct
// from a test-fixture's own direct service-layer call.
//
// This endpoint creates NO marketplace listing, NO sale, NO eBay call —
// it records intent only (GK-199 OperatorAction dispatch, §11).

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { recordOperatorAction, NotFoundError, ValidationFailedError, AuthorizationFailedError, IdempotencyConflictError } from '../src/modules/assets/index.js';
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(token));
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    }
    console.error('[operator-action] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  const { gkAssetId, decisionEventId, actionCode, actionValueAmount, actionValueCurrency, idempotencyKey, occurredAt } = req.body || {};

  try {
    const result = await recordOperatorAction({
      principalId,
      gkAssetId,
      decisionEventId,
      actionCode,
      actionValueAmount: actionValueAmount ?? null,
      actionValueCurrency: actionValueCurrency || 'USD',
      source: 'operator-api',
      idempotencyKey,
      occurredAt: occurredAt ? new Date(occurredAt) : undefined,
    });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof ValidationFailedError) {
      return res.status(400).json({ error: e.message });
    }
    if (e instanceof NotFoundError) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof AuthorizationFailedError) {
      // Same 404 shape as NotFoundError — never confirm to an
      // unauthorized caller that a gkAssetId/decisionEventId exists.
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof IdempotencyConflictError) {
      return res.status(409).json({ error: e.message });
    }
    console.error('[operator-action] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
