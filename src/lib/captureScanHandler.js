// src/lib/captureScanHandler.js — HARNESS-ONLY HTTP-shaped handler for
// src/modules/capture/service.js's captureFromScan.
//
// Deliberately NOT under api/ — placing it there would make it a live
// Vercel serverless function the moment it's committed, which would be
// real production capture wiring. The standing rule this project has
// repeatedly ratified (CLAUDE.md, DATA-1D Current State: "no production
// scanner/capture wiring beyond what's already shipped, no flag-gated
// production capture, until Milestone Ten's phone proof passes") governs
// this exactly. This file exists so the rescan-continuity mechanism
// (P0-A, priorCollectionItemId) can be proven through a REAL request/
// response/auth contract — not a bare direct call to captureFromScan
// with hand-built arguments — without creating that production surface.
// It mirrors api/operator-action.js's own auth/rate-limit/error-mapping
// pattern exactly, byte-for-byte in structure, so that promoting it to a
// real api/capture-scan.js later (a separate, explicit, future
// authorization — not granted by this file's existence) is a copy, not
// a redesign.
//
// principalId is NEVER accepted from the request body — derived
// exclusively from the caller's Bearer token, the same boundary every
// other real endpoint in this project already relies on.

import { verifyToken, InvalidTokenError } from '../modules/auth/index.js';
import { captureFromScan, ValidationFailedError, ConflictError, NotFoundError, AuthorizationFailedError } from '../modules/capture/index.js';
import { checkRateLimit } from '../../api/rate-limit.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function handleCaptureScan(req, res) {
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
    console.error('[capture-scan] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  const { scanPayload, photos, idempotencyKey } = req.body || {};

  try {
    const result = await captureFromScan({ principalId, scanPayload, photos, idempotencyKey });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof ValidationFailedError) {
      return res.status(400).json({ error: e.message });
    }
    if (e instanceof ConflictError) {
      return res.status(409).json({ error: e.message });
    }
    if (e instanceof NotFoundError) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof AuthorizationFailedError) {
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[capture-scan] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
