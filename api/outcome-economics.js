// POST /api/outcome-economics -> { componentId }
// GET  /api/outcome-economics?outcomeEventId=<id> -> { components, gross, fees, shipping, refund, credit, realizedNet, externalOrderId }
//
// GK-209 Outcome #1 CLOSER — the REQUIRED authenticated manual-entry
// fallback for realized economics (gross/fees/shipping/refund/credit/
// order_reference), so Outcome #1 can close even when eBay OAuth
// (Fulfillment/Finances) is not yet available. Mirrors
// api/operator-action.js's own auth pattern exactly.
//
// principalId is NEVER accepted from the request body — derived only
// from the caller's Bearer token. source is ALWAYS forced to
// 'operator-entered' here, never caller-suppliable — this endpoint can
// never be used to masquerade a manual fact as 'api-sourced' evidence;
// a real API-sourced write (once OAuth exists) is a separate, future
// internal call path, not this public endpoint.
//
// This endpoint creates NO marketplace listing, NO eBay call.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { recordEconomicsComponent, getOutcomeEconomics, NotFoundError, ValidationFailedError, AuthorizationFailedError, IdempotencyConflictError } from '../src/modules/assets/index.js';
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
    console.error('[outcome-economics] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (req.method === 'GET') {
    const outcomeEventId = req.query?.outcomeEventId;
    try {
      const summary = await getOutcomeEconomics({ principalId, outcomeEventId });
      return res.status(200).json(summary);
    } catch (e) {
      if (e instanceof NotFoundError) return res.status(404).json({ error: 'Not found' });
      if (e instanceof AuthorizationFailedError) return res.status(404).json({ error: 'Not found' });
      if (e instanceof ValidationFailedError) return res.status(400).json({ error: e.message });
      console.error('[outcome-economics] unexpected error:', e?.message || e);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    outcomeEventId, componentType, amount, currency, sourceReference,
    externalOrderId, evidenceNote, idempotencyKey, occurredAt,
  } = req.body || {};

  try {
    const result = await recordEconomicsComponent({
      principalId,
      outcomeEventId,
      componentType,
      amount: amount ?? null,
      currency: currency || 'USD',
      source: 'operator-entered', // FORCED — never caller-suppliable, see file header
      sourceReference,
      externalOrderId,
      evidenceNote,
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
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof IdempotencyConflictError) {
      return res.status(409).json({ error: e.message });
    }
    console.error('[outcome-economics] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
