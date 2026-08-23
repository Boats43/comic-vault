// GET /api/asset-media?mediaId=<uuid>
//
// DATA-1D, T3/C1 — the ONLY way a client ever gets real photo bytes.
// Authenticated (Bearer token) + authorization-checked against the
// media row's OWNING asset (src/modules/assets/index.js's getMediaById)
// BEFORE src/modules/media/'s own getBytes() ever touches storage — an
// unauthenticated or unauthorized request never reaches the storage
// layer at all. Proven directly in this dispatch's staging proof: an
// unauthenticated fetch of this endpoint FAILS (401), never falls
// through to serving bytes.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { getMediaById, NotFoundError, AuthorizationFailedError } from '../src/modules/assets/index.js';
import * as media from '../src/modules/media/index.js';
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

  if (req.method !== 'GET') {
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
    console.error('[asset-media] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  const mediaId = req.query?.mediaId;
  if (!mediaId) {
    return res.status(400).json({ error: 'mediaId required' });
  }

  try {
    // Authorization happens INSIDE getMediaById, BEFORE this handler
    // ever calls media.getBytes() — storage is never touched for an
    // unauthorized request.
    const mediaRow = await getMediaById({ principalId, mediaId });
    if (!mediaRow.object_uri) {
      return res.status(404).json({ error: 'No stored object for this media row' });
    }
    const bytes = await media.getBytes({ objectUri: mediaRow.object_uri });
    res.setHeader('Content-Type', mediaRow.content_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600'); // C1 — private, never a shared/public cache
    return res.status(200).send(bytes);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof AuthorizationFailedError) {
      // Same 404 shape as NotFoundError — never confirm existence to an
      // unauthorized caller.
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[asset-media] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
