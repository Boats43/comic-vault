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
import { checkRateLimit } from './rate-limit.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
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
      const { id: bodyId, assetCategory, attributes } = req.body || {};
      const created = await createCollectionItem({ principalId, id: bodyId, assetCategory, attributes });
      return res.status(200).json(created);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id query parameter is required' });
      const { assetCategory, attributes } = req.body || {};
      const updated = await updateCollectionItem({ principalId, id, assetCategory, attributes });
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
