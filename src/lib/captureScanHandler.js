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
import { captureFromScan, PhysicalCopyDecisionRequiredError, ValidationFailedError, ConflictError, NotFoundError, AuthorizationFailedError, IdempotencyConflictError } from '../modules/capture/index.js';
import { checkRateLimit } from '../../api/rate-limit.js';
import { isSupportedAssetCategory } from './assetCategories.js';
import { respondPhysicalCopyError } from './physicalCopyErrors.js';
import { CATEGORY_REQUIRED_CODE, OUTDATED_CLIENT_MESSAGE, markClientContractRefusal } from './clientContract.js';
import { normalizeOwnershipAttestation, OWNERSHIP_ATTESTATION_REQUIRED_CODE, CAPTURE_REFERENCE_ONLY_CODE } from './ownershipAttestation.js';

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

  const { scanPayload, photos, idempotencyKey, assetClass, copyDisposition } = req.body || {};

  // U1 closeout — a MISSING category is the client-contract failure (an app version that predates the
  // mandatory-category contract): one distinct stable code, before any work is attempted.
  if (assetClass === undefined || assetClass === null || assetClass === '') {
    markClientContractRefusal(res);
    return res.status(400).json({ error: CATEGORY_REQUIRED_CODE, code: CATEGORY_REQUIRED_CODE, message: OUTDATED_CLIENT_MESSAGE });
  }

  // V1 CERTIFICATION / P0-D — durable owned-asset creation requires the operator's EXPLICIT ownership
  // attestation (fixed, versioned statement; a bare flag does not qualify). Refused before any work.
  const ownershipAttestation = normalizeOwnershipAttestation(req.body?.ownershipAttestation);
  // (An unsupported category is refused by the service with its own validation message, in its own order.)
  if (!ownershipAttestation && isSupportedAssetCategory(assetClass)) {
    return res.status(400).json({
      error: OWNERSHIP_ATTESTATION_REQUIRED_CODE, code: OWNERSHIP_ATTESTATION_REQUIRED_CODE,
      message: 'Saving an owned physical asset requires you to confirm that you physically possess the item and that the photo shows the item itself.',
    });
  }
  // A capture the scan itself flagged as a suspected screen/reproduction is reference imagery, not
  // qualifying physical evidence. (This is a flag from the scan, never proof about ownership or possession.)
  if (scanPayload?.captureAuthenticity?.status === 'SCREEN_SUSPECTED') {
    return res.status(400).json({
      error: CAPTURE_REFERENCE_ONLY_CODE, code: CAPTURE_REFERENCE_ONLY_CODE,
      message: 'This photo was flagged as a possible screen or reproduction, so it can be kept for reference but not saved as an owned physical asset. Take a photo of the item itself to save it.',
    });
  }

  try {
    const result = await captureFromScan({ principalId, scanPayload, photos, idempotencyKey, assetClass, copyDisposition, ownershipAttestation });
    return res.status(200).json(result);
  } catch (e) {
    // GK-279 — 409 decision-required (nothing minted) or 503 candidate-check-unavailable (fail-closed).
    if (respondPhysicalCopyError(res, e, { principalId, handler: 'capture-scan', req })) return;
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
    if (e instanceof IdempotencyConflictError) {
      // Same key, different semantic payload — checkIdempotencyReplay
      // throws this BEFORE any mutation (idempotency.js), so no asset/
      // media is created on this branch. Mirrors api/operator-action.js's
      // own mapping for the identical error class.
      return res.status(409).json({ error: e.message });
    }
    console.error('[capture-scan] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
