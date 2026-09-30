// POST /api/ebay-outcome-reconciler { gkAssetId, externalListingId, lookbackDays? }
//  -> { status, ... } (see src/lib/ebayOutcomeReconciler.js's own return shapes)
//
// GRAILKEY AUTOMATIC EBAY OUTCOME RECONCILER V1 — the smallest
// Production-safe execution surface for reconciliation. Authenticated
// (Bearer token only, principalId never client-supplied, ownership
// re-checked on every read/write by src/modules/assets/ itself). Safe to
// call repeatedly for the same listing at any point in its lifecycle —
// every write is idempotent (GK-163). Zero eBay WRITE calls anywhere in
// this chain (Fulfillment order list, Finances transaction list — both
// GET-only).
//
// No scheduler/cron wires this up — this repo has no established
// scheduling mechanism (checked: no vercel.json `crons`, no existing
// cron endpoint convention) — inventing one is explicitly out of this
// dispatch's scope. This endpoint is the reconciliation surface itself;
// wiring a recurring trigger to it is the next operational step, not
// done here.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { reconcileEbayOutcome, DEFAULT_LOOKBACK_DAYS } from '../src/lib/ebayOutcomeReconciler.js';
import {
  resolveEbayUserAccessToken,
  EbayConnectionRequiredError,
  EbayReconnectRequiredError,
  EbayTemporaryFailureError,
  EbayTokenResolutionInternalError,
} from '../src/lib/ebayPrincipalToken.js';
import { ValidationFailedError, NotFoundError, AuthorizationFailedError } from '../src/modules/assets/index.js';
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
    console.error('[ebay-outcome-reconciler] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  const { gkAssetId, externalListingId, lookbackDays } = req.body || {};
  if (!gkAssetId || !externalListingId) {
    return res.status(400).json({ error: 'gkAssetId and externalListingId are both required' });
  }

  // GK-265 PHASE 3 — principal-scoped token resolution. principalId here
  // is the SAME value getOutcomeEventsForListing (inside
  // reconcileEbayOutcome, below) independently checks asset ownership
  // against — this endpoint's own caller-authenticated principal is
  // never trusted as authority beyond "whose eBay connection to use."
  // NO global EBAY_USER_REFRESH_TOKEN fallback exists on this path.
  let accessToken;
  try {
    ({ accessToken } = await resolveEbayUserAccessToken({ principalId }));
  } catch (e) {
    if (e instanceof EbayConnectionRequiredError) {
      return res.status(503).json({ error: 'EBAY_CONNECTION_REQUIRED', message: 'No eBay connection exists for this principal — Connect eBay before reconciling.' });
    }
    if (e instanceof EbayReconnectRequiredError) {
      return res.status(503).json({ error: 'EBAY_RECONNECT_REQUIRED', message: 'This principal\'s eBay connection requires reconnection.' });
    }
    if (e instanceof EbayTemporaryFailureError) {
      return res.status(502).json({ error: 'EBAY_TEMPORARY_FAILURE', message: 'eBay was temporarily unavailable — try again shortly.' });
    }
    if (e instanceof EbayTokenResolutionInternalError) {
      console.error('[ebay-outcome-reconciler] internal token-resolution fault:', e?.message || e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Could not resolve an eBay access token due to a server-side fault.' });
    }
    console.error('[ebay-outcome-reconciler] could not obtain eBay User access token:', e?.message || e);
    return res.status(502).json({ error: 'Could not obtain a real eBay User access token' });
  }

  try {
    const result = await reconcileEbayOutcome({
      principalId, gkAssetId, externalListingId,
      accessToken,
      lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : DEFAULT_LOOKBACK_DAYS,
    });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof ValidationFailedError) return res.status(400).json({ error: e.message });
    if (e instanceof NotFoundError) return res.status(404).json({ error: 'Not found' });
    if (e instanceof AuthorizationFailedError) return res.status(404).json({ error: 'Not found' });
    console.error('[ebay-outcome-reconciler] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
