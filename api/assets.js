// GET /api/assets                  -> { assets: [...] }  (list-my-assets)
// GET /api/assets?gkAssetId=<uuid> -> { asset }           (getPhysicalAsset)
//
// DATA-1D, T3 — the first real authenticated READ surface. Requires
// `Authorization: Bearer <token>` (src/modules/auth/index.js); the
// token's principalId is the ONLY principal ever passed into the Asset
// Service's own operations here — never trusted from a request body or
// query param, so a caller cannot ask to read as someone else.
//
// C1 — media stays private. This endpoint never returns a raw
// localfs://... object_uri (an internal storage key, not a fetchable
// URL for a browser) — every media row's objectUri is rewritten to
// `/api/asset-media?mediaId=<id>`, itself authenticated the same way.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { getPhysicalAsset, listMyAssets, NotFoundError, AuthorizationFailedError } from '../src/modules/assets/index.js';
import { checkRateLimit } from './rate-limit.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function rewriteMediaUris(media) {
  return (media || []).map((m) => ({ ...m, object_uri: `/api/asset-media?mediaId=${m.id}` }));
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
    console.error('[assets] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  const gkAssetId = req.query?.gkAssetId;

  try {
    if (gkAssetId) {
      const asset = await getPhysicalAsset({ principalId, gkAssetId });
      return res.status(200).json({ asset: { ...asset, media: rewriteMediaUris(asset.media) } });
    }
    const assets = await listMyAssets({ principalId });
    return res.status(200).json({ assets });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof AuthorizationFailedError) {
      // Deliberately the SAME 404 shape as NotFoundError — never confirm
      // to an unauthorized caller that a gkAssetId exists at all.
      return res.status(404).json({ error: 'Not found' });
    }
    console.error('[assets] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
