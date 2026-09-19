// POST /api/asset-media-append
//
// GRAILKEY — POST-CAPTURE PHYSICAL MEDIA APPEND V1 (GK-227).
//
// The ONLY way to add durable physical-asset evidence media to an
// EXISTING gkAssetId after its original capture. Distinct from
// api/asset-media.js (GET, read-only, streams already-stored bytes) and
// from api/collection.js (writes the CATALOGUE layer's
// collection_item.attributes.remoteImages — never a data1_dev.media
// row). This endpoint is the one and only bridge from "an operator has
// fresh bytes in hand right now" to a durable, kernel-level media row.
//
// PROVENANCE, non-negotiable (mirrors GrailKeyOperatorPanel.jsx's own
// captureAsOwnedAsset() guard for the ORIGINAL capture — this is the
// exact same discipline extended to the post-capture case, which is
// exactly where that discipline could otherwise quietly lapse on an
// already-existing asset):
//   - This endpoint has NO url-fetch code path anywhere in it. It can
//     only ever store the literal bytes present in the request body —
//     it structurally cannot promote a marketplace image, a scraped
//     reference image, or a synced-proxy URL into evidence, because
//     there is no code here that fetches anything from anywhere.
//   - `bytes` must be a plausible base64 payload (a strict base64-
//     charset check) — a URL string (http(s)://..., or a
//     /api/collection-image?... proxy path) fails this check outright
//     and is rejected with a clear reason, never silently stored as
//     garbage or silently ignored.
//   - `captureView` is REQUIRED and must be one of the five explicit
//     roles below. Never inferred from filename, array position, or any
//     other implicit signal — an absent or unrecognized value fails
//     closed with 400, it is never defaulted.
//
// attachMedia (src/modules/assets/service.js) already provides
// everything else this needs: real ownership check
// (assertPrincipalOwnsAsset), real asset-exists check
// (assertAssetExists), append-only/immutable writes, and idempotency
// (same idempotencyKey + same bytes/role -> replay; same key + different
// bytes/role -> a real conflict, never a silent wrong-answer replay).
// This endpoint is a thin, authenticated HTTP wrapper around it — no
// second copy of any of that logic lives here.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { attachMedia, NotFoundError, AuthorizationFailedError, ValidationFailedError, IdempotencyConflictError } from '../src/modules/assets/index.js';
import { checkRateLimit } from './rate-limit.js';

const CAPTURE_VIEWS = ['FRONT', 'BACK', 'SPINE', 'PAGES', 'DETAIL'];
// Strict base64 charset (with optional 0-2 trailing '=' padding). A URL
// (contains ':', '?', '&') or a proxy path fails this outright.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Auth — first, before anything else, matching every other write
  // endpoint in this codebase.
  const token = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(token));
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    }
    console.error('[asset-media-append] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  // 2. Rate limit.
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  const { gkAssetId, bytes, contentType, captureView, idempotencyKey } = req.body || {};

  // 3. Shape/provenance validation — BEFORE attachMedia is ever called,
  // so a rejected request never even reaches the ownership/asset-exists
  // checks (fail fast on the cheapest checks first).
  if (!gkAssetId || typeof gkAssetId !== 'string') {
    return res.status(400).json({ error: 'gkAssetId is required' });
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return res.status(400).json({ error: 'idempotencyKey is required' });
  }
  if (!captureView || !CAPTURE_VIEWS.includes(captureView)) {
    // Fail closed on an unknown/missing role — never inferred, never defaulted.
    return res.status(400).json({
      error: 'CAPTURE_VIEW_REQUIRED',
      detail: `captureView must be one of: ${CAPTURE_VIEWS.join(', ')}`,
    });
  }
  if (!contentType || typeof contentType !== 'string') {
    return res.status(400).json({ error: 'contentType is required' });
  }
  if (!bytes || typeof bytes !== 'string' || !BASE64_RE.test(bytes)) {
    // Covers: a URL, a synced-proxy path, a marketplace/reference image
    // reference, or any non-base64 string a caller might try to pass as
    // "photo bytes." This endpoint has no code path that would fetch any
    // of those — they are rejected here, never silently promoted.
    return res.status(400).json({
      error: 'REFERENCE_IMAGE_REJECTED',
      detail: 'bytes must be a real base64-encoded photo payload captured or uploaded in this action — a URL, proxy path, or reference image cannot be promoted to physical-asset evidence.',
    });
  }

  const decoded = Buffer.from(bytes, 'base64');
  if (decoded.length === 0) {
    return res.status(400).json({ error: 'bytes decoded to zero length' });
  }

  try {
    const result = await attachMedia({
      principalId,
      gkAssetId,
      bytes: decoded,
      contentType,
      captureRole: 'capture-photo',
      captureView,
      idempotencyKey,
    });
    return res.status(200).json({ gkAssetId, ...result });
  } catch (e) {
    if (e instanceof NotFoundError) {
      // Same 404 shape as an authorization failure — never confirm
      // existence to a caller who doesn't own the asset (matches
      // api/collection.js's/api/asset-media.js's own convention).
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof AuthorizationFailedError) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof ValidationFailedError) {
      return res.status(400).json({ error: e.message });
    }
    if (e instanceof IdempotencyConflictError) {
      return res.status(409).json({ error: e.message });
    }
    console.error('[asset-media-append] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
