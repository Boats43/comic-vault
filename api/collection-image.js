// GET /api/collection-image?id=<collectionItemId>&index=0
//
// GRAILKEY — COLLECTION IMAGE SYNC (2026-09-19) production-retest fix.
//
// api/collection.js originally tried to store a collection display
// photo via the media module's put() with access:'public'. Real
// Production evidence (Vercel runtime logs, a live reproduced 500)
// showed this throws: "Vercel Blob: Cannot use public access on a
// private store. The store is configured with private access." The
// real comic-vault-media-primary store (GK-166) was provisioned
// private-only — there is no per-object public override, and
// provisioning a second, genuinely-public store is an architecture
// change out of scope for this fix. So the store stays exactly as it
// already is (private) and api/collection.js no longer requests
// public access at all.
//
// This endpoint is the resulting private-media READ path — same shape
// as the existing api/asset-media.js (auth -> ownership check ->
// media.getBytes(), storage never touched for a bad request), but
// deliberately NOT the same code, NOT the same table, and NOT
// Bearer-token-authenticated: a plain <img src="..."> cannot attach an
// Authorization header, and putting the real session bearer token in
// an image URL (query string, browser history, referrer, server logs)
// would be a meaningfully worse exposure than what this endpoint
// actually guards — a session token authorizes the ENTIRE account, not
// just images. Instead, this "authenticates" by SERVER-SIDE
// REGISTRATION: it only ever streams the exact bytes already recorded
// at collection_item.attributes.remoteImages[index] for a given item
// id (src/modules/collection/repository.js's getRemoteImageUri, the
// one deliberately non-principal-scoped lookup in that module) — an id
// is an unguessable client-generated cv_<timestamp>_<random> string,
// and the content-addressed object key itself is a sha256 hash, so
// this is the SAME "unguessable key, no further access control" trust
// model true public Blob access would have given directly. It can
// never serve anything that isn't already a registered collection
// display image — never an arbitrary caller-supplied URL (no SSRF
// surface: the objectUri always comes from this server's own DB read,
// never from the request), never physical-asset evidence media (that
// lives in gk_media/getMediaById, an entirely different table this
// file never queries), and no gkAssetId or gk_asset row is ever
// touched or created.
//
// Doctrine preserved: collection display image != physical-asset
// evidence. This is the display-only exception; asset-media.js's
// stricter, principal-authenticated, ownership-checked path remains
// the only way to read real evidence media, untouched by this file.

import { getRemoteImageUri } from '../src/modules/collection/index.js';
import * as media from '../src/modules/media/index.js';
import { checkRateLimit } from './rate-limit.js';

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

  const id = req.query?.id;
  const indexRaw = req.query?.index;
  const index = indexRaw === undefined ? 0 : parseInt(indexRaw, 10);
  if (!id || typeof id !== 'string' || !Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: 'id and a non-negative integer index are required' });
  }

  try {
    const objectUri = await getRemoteImageUri({ id, index });
    if (!objectUri) {
      return res.status(404).json({ error: 'No stored display image for this item/index' });
    }
    const [{ contentType }, bytes] = await Promise.all([
      media.head({ objectUri }),
      media.getBytes({ objectUri }),
    ]);
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    // Content-addressed key -> the bytes at this exact URL never change.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(bytes);
  } catch (e) {
    console.error('[collection-image] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
