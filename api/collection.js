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
// This endpoint creates NO physical asset, NO gkAssetId, and never
// WRITES to src/modules/assets/ or src/modules/capture/ — collection_item
// != gkAssetId, unchanged. Does not touch /api/capture-scan, grading,
// pricing, or eBay in any way.
//
// GK-266 follow-up (2026-09-30) — ONE narrow, READ-ONLY exception to the
// "never calls assets/" rule above, on the DELETE path only. GK-266's own
// prevention fix stops a NEW collection_item_link from ever being created
// against a nonexistent collection_item, but a *later* delete of an
// already-linked collection_item through this ordinary path was found to
// still orphan that link (a real, Production-reachable gap, not merely
// the disclosed check-then-insert race — this is unbounded in time,
// exercisable by any authenticated principal on their own already-synced
// item at any point after linking). Composed here, one layer up from
// both modules — the same pattern src/lib/assetRecoveryHandler.js
// already uses to read across collection_item_link and collection_item
// without either module writing to the other's tables.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import {
  listMyCollection, getMyCollectionItem, createCollectionItem,
  updateCollectionItem, deleteCollectionItem, claimModelBaseline,
  ValidationFailedError, AuthorizationFailedError, NotFoundError, CategoryImmutableError,
} from '../src/modules/collection/index.js';
import { isSupportedAssetCategory, describeSupportedCategories } from '../src/lib/assetCategories.js';
import { CATEGORY_REQUIRED_CODE, OUTDATED_CLIENT_MESSAGE, markClientContractRefusal } from '../src/lib/clientContract.js';
import { resolveCollectionItemLink } from '../src/modules/assets/index.js';
import { assertPhysicalCopySaveAllowed, PhysicalCopyCandidateCheckUnavailableError } from '../src/modules/capture/index.js';
import { respondPhysicalCopyError } from '../src/lib/physicalCopyErrors.js';
import { put as mediaPut } from '../src/modules/media/index.js';
import { checkRateLimit } from './rate-limit.js';
import { claimGradeReceipt, restoreGradeReceipt } from '../src/lib/gradeReceipt.js';

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

// GK-261 — server-owned model baseline. The client presents ONLY an opaque
// receipt id (minted by /api/grade for this same principal); the baseline
// values come exclusively from the server's own receipt record. Any
// modelPredicted*/identityAuthority material in the request's attributes
// has already been made inert by the repository's full-immunity set. A
// missing/expired/foreign/replayed receipt changes nothing — the ordinary
// save still succeeds and no trusted baseline is minted (UNKNOWN).
async function claimReceiptIfPresent(principalId, itemId, gradeReceiptId, saved) {
  if (gradeReceiptId === undefined || gradeReceiptId === null) return saved;
  const claim = await claimGradeReceipt({ principalId, receiptId: gradeReceiptId });
  if (!claim.ok) {
    console.log(`[grade-receipt] not claimed: ${claim.reason}`);
    return saved;
  }
  try {
    const out = await claimModelBaseline({ principalId, id: itemId, baseline: claim.baseline });
    console.log(`[grade-receipt] claimed written=${out.written}`);
    return out.item || saved;
  } catch (e) {
    await restoreGradeReceipt({ receiptId: gradeReceiptId, record: claim.record });
    console.log(`[grade-receipt] durable write failed, receipt restored: ${e?.message || e}`);
    return saved;
  }
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
      const { id: bodyId, assetCategory, attributes, images, gradeReceiptId } = req.body || {};
      // U1 — NO DEFAULT CATEGORY: refuse BEFORE the physical-copy check or any photo upload
      // (a refused save must leave no orphan blob and no row).
      if (assetCategory === undefined || assetCategory === null || assetCategory === '') {
        // The CLIENT-CONTRACT failure: this app version predates the mandatory-category contract.
        markClientContractRefusal(res);
        return res.status(400).json({ error: CATEGORY_REQUIRED_CODE, code: CATEGORY_REQUIRED_CODE, message: OUTDATED_CLIENT_MESSAGE });
      }
      if (!isSupportedAssetCategory(assetCategory)) {
        return res.status(400).json({ error: 'ASSET_CATEGORY_UNSUPPORTED', message: `assetCategory must be one of ${describeSupportedCategories()}.` });
      }
      // GK-279 — SERVER-OWNED physical-copy standing for a NEW row, evaluated BEFORE
      // any photo upload or write (a refusal leaves no orphan and no row). Updates to
      // an existing row are not a duplicate-creation event. Failure to determine
      // standing refuses the save (fail-closed) — never "zero candidates".
      if (typeof bodyId === 'string' && bodyId && attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
        let isNewRow;
        try {
          await getMyCollectionItem({ principalId, id: bodyId });
          isNewRow = false;
        } catch (lookupErr) {
          if (lookupErr instanceof NotFoundError) isNewRow = true;
          else throw new PhysicalCopyCandidateCheckUnavailableError('collection existence check failed', lookupErr?.code || lookupErr?.name);
        }
        if (isNewRow) await assertPhysicalCopySaveAllowed({ principalId, id: bodyId, attributes, assetCategory });
      }
      const resolvedAttributes = await withResolvedImages(attributes, images);
      const created = await createCollectionItem({ principalId, id: bodyId, assetCategory, attributes: resolvedAttributes });
      return res.status(200).json(await claimReceiptIfPresent(principalId, bodyId, gradeReceiptId, created));
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id query parameter is required' });
      const { assetCategory, attributes, images, gradeReceiptId } = req.body || {};
      const resolvedAttributes = await withResolvedImages(attributes, images);
      const updated = await updateCollectionItem({ principalId, id, assetCategory, attributes: resolvedAttributes });
      return res.status(200).json(await claimReceiptIfPresent(principalId, id, gradeReceiptId, updated));
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id query parameter is required' });
      // GK-266 follow-up — governing invariant: NO NORMAL PRODUCTION
      // APPLICATION OPERATION MAY CREATE A DANGLING collection_item_link.
      // A collection_item referenced by a real physical-asset link is
      // permanently linked in v1 (0007's own header: "no relink mechanism
      // in v1") — there is no established, safe unlink transaction to
      // run first, so this fails closed unconditionally rather than
      // inventing cascading-delete semantics. Read-only check, principal-
      // scoped (resolveCollectionItemLink never leaks a cross-principal
      // link's existence — see that function's own contract).
      const link = await resolveCollectionItemLink({ principalId, collectionItemId: id });
      if (link) {
        return res.status(409).json({
          error: 'COLLECTION_ITEM_LINKED_TO_PHYSICAL_ASSET',
          message: 'This catalogue item is linked to a real physical asset and cannot be deleted.',
        });
      }
      const result = await deleteCollectionItem({ principalId, id });
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    if (respondPhysicalCopyError(res, e, { principalId, handler: 'collection-create', req })) return;
    if (e instanceof ValidationFailedError) {
      return res.status(400).json({ error: e.message });
    }
    if (e instanceof CategoryImmutableError) {
      return res.status(409).json({ error: 'ASSET_CATEGORY_IMMUTABLE', message: 'This item already has a category and it cannot be changed.' });
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
