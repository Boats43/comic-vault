// /api/collection-image-v2 - GK-L1B (2026-10-11): PROTECTED collection display images.
//
//   POST  (Authorization: Bearer <session>)   body { ids: [itemId, ...] }  (max 100)
//         -> 200 { urls: { <itemId>: [ "/api/collection-image-v2?t=...", ... ] }, expiresAt }
//         Mints one short-lived signed link per displayable image of the CALLER'S OWN items. An id that does not
//         belong to the caller (or does not exist) is simply absent: no 403/404 distinction, no enumeration.
//   GET   ?t=<signed link>
//         -> 200 image bytes | 403 IMAGE_LINK_INVALID | 403 IMAGE_LINK_EXPIRED | 404
//         The lookup is ALWAYS `principal_id AND id` taken from the SIGNED payload, never from the query string.
//
// Replaces the retired, unauthenticated, unscoped /api/collection-image (now 410). Responses are never publicly
// cacheable: `private, max-age` bounded by the link's remaining life, `Referrer-Policy: no-referrer`, `nosniff`.
// This endpoint serves ONLY collection DISPLAY images (collection_item.attributes.remoteImages); physical-asset
// evidence media stays on api/asset-media.js. It never accepts a caller-supplied URL (no SSRF surface) and never
// logs a token, an item id's image URI or image bytes.

import { requireAuthenticatedPrincipal } from '../src/lib/accessGate.js';
import { getRemoteImageUriForPrincipal, getRemoteImageCountsForPrincipal } from '../src/modules/collection/index.js';
import * as media from '../src/modules/media/index.js';
import { mintImageLink, verifyImageLink, imageLinkPath } from '../src/lib/collectionImageUrl.js';
import { checkRateLimit } from './rate-limit.js';

const MAX_IDS = 100;
const MAX_IMAGES_PER_ITEM = 24;
const MAX_ID_LEN = 128;

const noStore = (res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); };

export default async function handler(req, res) {
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    noStore(res);
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  if (req.method === 'POST') {
    noStore(res);
    const auth = requireAuthenticatedPrincipal(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID_LEN)) {
      return res.status(400).json({ error: `ids must be an array of 1-${MAX_IDS} non-empty strings` });
    }
    try {
      const counts = await getRemoteImageCountsForPrincipal({ principalId: auth.principalId, ids: [...new Set(ids)] });
      const urls = {};
      let expiresAt = null;
      for (const { id, count } of counts) {
        if (!count) continue;
        urls[id] = [];
        for (let i = 0; i < Math.min(count, MAX_IMAGES_PER_ITEM); i += 1) {
          const link = mintImageLink({ principalId: auth.principalId, itemId: id, index: i });
          urls[id].push(imageLinkPath(link.token));
          expiresAt = link.expiresAt;
        }
      }
      return res.status(200).json({ urls, expiresAt });
    } catch (e) {
      console.error('[collection-image-v2] mint failed:', e?.message || e);
      return res.status(503).json({ error: 'Image links are temporarily unavailable.' });
    }
  }

  if (req.method === 'GET') {
    const t = req.query?.t;
    const v = verifyImageLink(typeof t === 'string' ? t : '');
    if (!v.ok) {
      noStore(res);
      if (v.reason === 'expired') return res.status(403).json({ error: 'IMAGE_LINK_EXPIRED', message: 'This image link has expired.' });
      if (v.reason === 'unavailable') return res.status(503).json({ error: 'Image links are temporarily unavailable.' });
      return res.status(403).json({ error: 'IMAGE_LINK_INVALID' });
    }
    try {
      const objectUri = await getRemoteImageUriForPrincipal({ principalId: v.principalId, id: v.itemId, index: v.index });
      if (!objectUri) { noStore(res); return res.status(404).json({ error: 'No stored display image for this item/index' }); }
      const [{ contentType }, bytes] = await Promise.all([media.head({ objectUri }), media.getBytes({ objectUri })]);
      const remainingS = Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000));
      res.setHeader('Content-Type', contentType || 'image/jpeg');
      // NEVER public. Private cache only, and never longer than the link itself is valid.
      res.setHeader('Cache-Control', `private, max-age=${Math.min(300, remainingS)}`);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(bytes);
    } catch (e) {
      noStore(res);
      console.error('[collection-image-v2] read failed:', e?.message || e);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  noStore(res);
  return res.status(405).json({ error: 'Method not allowed' });
}
