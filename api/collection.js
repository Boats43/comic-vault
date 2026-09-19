// /api/collection — GrailKey Clean Account/Collection Cutover (2026-09-17).
//
// GET    /api/collection            -> list my collection (newest-updated first)
// GET    /api/collection?id=<id>    -> get one item
// POST   /api/collection            -> create/upsert one item ({id, assetCategory?, attributes})
// PUT    /api/collection?id=<id>    -> update one item ({assetCategory?, attributes})
// PATCH  /api/collection?id=<id>    -> same as PUT
// DELETE /api/collection?id=<id>    -> delete one item
//
// principalId is NEVER accepted from the request body or query string —
// derived exclusively from the caller's own Bearer token
// (src/modules/auth/), the same boundary every other real endpoint in
// this project already relies on. A request with no valid token is
// rejected before anything else runs.
//
// Category-agnostic: `attributes` is an opaque JSON object as far as
// this endpoint and the collection module are concerned — comic-shaped
// today, any future format's shape tomorrow, no schema enforced here.
//
// This endpoint creates NO physical asset, NO gkAssetId, and never calls
// src/modules/assets/ or src/modules/capture/ — collection_item !=
// gkAssetId, unchanged. Does not touch /api/capture-scan, grading,
// pricing, or eBay in any way.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import {
  listMyCollection, getMyCollectionItem, createCollectionItem,
  updateCollectionItem, deleteCollectionItem,
  ValidationFailedError, AuthorizationFailedError, NotFoundError,
} from '../src/modules/collection/index.js';
import { put as mediaPut } from '../src/modules/media/index.js';
import { checkRateLimit } from './rate-limit.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

// GRAILKEY — COLLECTION IMAGE SYNC (2026-09-19, production-retest fix).
// collection_item.attributes is an opaque JSON bag for every OTHER field
// (title/issue/publisher/...), but a raw base64 photo has no business
// sitting in that JSONB column (large, and Postgres is not a blob store)
// — see 0026's own header. This endpoint is the one place that isn't
// opaque about `images`: a data: URL in the request body's top-level
// `images` array is uploaded through the media module's raw
// content-addressed blob primitive (src/modules/media/index.js's put()).
//
// CORRECTION (2026-09-19): the first version of this code requested
// access:'public'. Real Production evidence (Vercel runtime logs, a live
// reproduced 500) proved that throws — the real comic-vault-media-primary
// store (GK-166) was provisioned PRIVATE-ONLY; there is no per-object
// public override, and every real write that included an image was
// failing outright (500, "Internal error"), attributes and all. The
// store's own configuration is left exactly as it already is — access is
// no longer requested at all here (media.put()'s default, 'private',
// applies).
//
// attributes.remoteImages still holds the real (private) objectUri
// strings — server-side ground truth only, never sent directly to a
// browser <img src>. The client (src/App.jsx's getComicPhotos()) never
// reads these values; it derives a same-origin proxy path
// (`/api/collection-image?id=<item id>&index=<n>`) purely from the
// item's own id and the array's length/position. That new endpoint
// (api/collection-image.js) independently re-reads this exact
// attributes.remoteImages[index] value server-side and streams the
// bytes — see its own header for why it doesn't need Bearer auth to
// stay safe. This is still NOT the physical-asset evidence path: no
// gk_asset, no gkAssetId, no gk_media row, no call into
// src/modules/assets/ or src/modules/capture/ — a collection display
// thumbnail stays exactly what it is, never silently becoming durable
// physical-condition evidence. An entry already shaped like a URL (not a
// data: URL) is passed through unchanged — a replay of an already-synced
// item must not re-upload.
const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/;

async function resolveRemoteImages(images) {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const resolved = [];
  for (const entry of images) {
    if (typeof entry !== 'string') continue;
    const m = entry.match(DATA_URL_RE);
    if (!m) {
      resolved.push(entry); // already a URL from a prior sync — pass through
      continue;
    }
    const [, contentType, b64] = m;
    const bytes = Buffer.from(b64, 'base64');
    const { objectUri } = await mediaPut({ bytes, contentType }); // default access:'private', matches the real store
    resolved.push(objectUri);
  }
  return resolved;
}

async function withResolvedImages(attributes, images) {
  const remoteImages = await resolveRemoteImages(images);
  if (remoteImages === undefined) return attributes;
  return { ...(attributes || {}), remoteImages };
}

export default async function handler(req, res) {
  // 1. Auth — first, before rate limiting or anything else.
  const token = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(token));
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    }
    console.error('[collection] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  // 2. Rate limit.
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  const id = req.query?.id || null;

  try {
    if (req.method === 'GET') {
      if (id) {
        const item = await getMyCollectionItem({ principalId, id });
        return res.status(200).json(item);
      }
      const items = await listMyCollection({ principalId });
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { id: bodyId, assetCategory, attributes, images } = req.body || {};
      const resolvedAttributes = await withResolvedImages(attributes, images);
      const created = await createCollectionItem({ principalId, id: bodyId, assetCategory, attributes: resolvedAttributes });
      return res.status(200).json(created);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id query parameter is required' });
      const { assetCategory, attributes, images } = req.body || {};
      const resolvedAttributes = await withResolvedImages(attributes, images);
      const updated = await updateCollectionItem({ principalId, id, assetCategory, attributes: resolvedAttributes });
      return res.status(200).json(updated);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id query parameter is required' });
      const result = await deleteCollectionItem({ principalId, id });
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
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
    console.error('[collection] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
