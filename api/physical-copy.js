// POST /api/physical-copy — GK-279 correction: the ONE server-adjudicated
// physical-copy decision surface, used by the SAVE flow BEFORE any duplicate
// collection row becomes durable.
//
// PHYSICAL IDENTITY != CATALOGUE SIMILARITY. The client may PROPOSE
// SAME_COPY / ANOTHER_COPY; the server supplies the candidates, validates the
// choice against its own candidate set, and establishes the durable result.
// principalId is NEVER accepted from the request body — only from the Bearer
// token. This endpoint mints no gkAssetId and creates no collection row.
//
//   { action: 'candidates', book: {title, issue, year} }
//       -> { candidates: [...] }   (server-owned, principal-scoped)
//   { action: 'same', book, selectedGkAssetId, gradeReceiptId?, photo?: {bytes(base64), contentType}, idempotencyKey }
//       -> { gkAssetId, canonicalCollectionItemId, replayed }   (existing asset reused, photo appended)
//   { action: 'another', book, collectionItemId, idempotencyKey }
//       -> { decisionId, outcome }   (durable ANOTHER_COPY record for that catalogue row)

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import {
  listSaveTimeCopyCandidates, confirmSameCopyAtSave, recordAnotherCopyAtSave,
  ValidationFailedError, ConflictError, NotFoundError, AuthorizationFailedError, IdempotencyConflictError,
} from '../src/modules/capture/index.js';
import { checkRateLimit } from './rate-limit.js';

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let principalId;
  try {
    ({ principalId } = verifyToken(extractBearerToken(req)));
  } catch (e) {
    if (e instanceof InvalidTokenError) return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    console.error('[physical-copy] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  const rateCheck = checkRateLimit(req, { principalId });
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  const body = req.body || {};
  const { action, book, selectedGkAssetId, gradeReceiptId, photo, idempotencyKey, collectionItemId } = body;
  if (!book || typeof book !== 'object' || typeof book.title !== 'string' || !book.title.trim()) {
    return res.status(400).json({ error: 'book.title is required' });
  }

  try {
    if (action === 'candidates') {
      const candidates = await listSaveTimeCopyCandidates({ principalId, book });
      return res.status(200).json({ candidates });
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }
    if (action === 'same') {
      let photoArg = null;
      if (photo && photo.bytes !== undefined) {
        if (typeof photo.bytes !== 'string' || !BASE64_RE.test(photo.bytes)) {
          return res.status(400).json({ error: 'photo.bytes must be base64 image bytes' });
        }
        photoArg = { bytes: Buffer.from(photo.bytes, 'base64'), contentType: photo.contentType || 'image/jpeg' };
      }
      const out = await confirmSameCopyAtSave({ principalId, book, selectedGkAssetId, gradeReceiptId, photo: photoArg, idempotencyKey });
      return res.status(200).json({
        gkAssetId: out.gkAssetId, canonicalCollectionItemId: out.canonicalCollectionItemId,
        mediaAppended: !!out.media, replayed: out.replayed,
      });
    }
    if (action === 'another') {
      const out = await recordAnotherCopyAtSave({ principalId, book, collectionItemId, idempotencyKey });
      return res.status(200).json(out);
    }
    return res.status(400).json({ error: "action must be one of candidates|same|another" });
  } catch (e) {
    if (e instanceof ValidationFailedError) return res.status(400).json({ error: e.message });
    if (e instanceof ConflictError || e instanceof IdempotencyConflictError) return res.status(409).json({ error: e.message });
    if (e instanceof NotFoundError || e instanceof AuthorizationFailedError) return res.status(404).json({ error: 'Not found' });
    console.error('[physical-copy] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
