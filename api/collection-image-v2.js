// /api/collection-image-v2 - GK-L1B (2026-10-11, amended v3): PROTECTED collection display images.
//
//   POST    (Authorization: Bearer <session>)   -> 200 { expiresAt } + Set-Cookie: gk_img=<credential>
//           Mints the 10-minute image credential for the CALLER. One mint serves every image on the page.
//   DELETE  -> 200 + a clearing Set-Cookie (called on logout / session expiry; needs no auth - it can only clear).
//   GET     ?p=<principalId>&id=<itemId>&i=<index>    (credential in the gk_img COOKIE, never in the URL)
//           -> 200 image bytes | 403 IMAGE_CREDENTIAL_MISSING / IMAGE_LINK_EXPIRED / IMAGE_LINK_INVALID /
//              IMAGE_PRINCIPAL_MISMATCH | 404
//           The lookup is `principal_id AND id` with the principal from the VERIFIED cookie; `p` is only a consistency
//           check, so a stale cookie from another account can never serve this account's page.
//
// Replaces the retired, unauthenticated, unscoped /api/collection-image (now 410). Responses are never publicly
// cacheable: `private, max-age` bounded by the credential's remaining life, `Vary: Cookie`, `Referrer-Policy:
// no-referrer`, `nosniff`. This endpoint serves ONLY collection DISPLAY images (collection_item.attributes.
// remoteImages); physical-asset evidence media stays on api/asset-media.js. It never accepts a caller-supplied URL
// (no SSRF surface). It never logs a cookie header, a credential, an item's image URI or image bytes.

import { requireAuthenticatedPrincipal } from '../src/lib/accessGate.js';
import { getRemoteImageUriForPrincipal } from '../src/modules/collection/index.js';
import * as media from '../src/modules/media/index.js';
import { mintImageCredential, verifyImageCredential, readCookie, buildSetCookie, buildClearCookie } from '../src/lib/collectionImageUrl.js';
import { checkRateLimit } from './rate-limit.js';

const MAX_ID_LEN = 128;
const MAX_INDEX = 99;

const noStore = (res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); };

export default async function handler(req, res) {
  // RATE LIMITING: the credential MINT is limited per principal (it is called once per ~10 minutes). Image GETs are NOT put
  // through the shared 30-requests/10-minutes limiter: a single Collection screen legitimately loads dozens of thumbnails,
  // and that limiter would turn them into 429 broken images. A GET needs a valid, principal-bound, 10-minute credential
  // and can only ever return the credential holder's OWN images, so the cost it can cause is bounded by their own data.
  if (req.method === 'POST') {
    noStore(res);
    const auth = requireAuthenticatedPrincipal(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const rateCheck = checkRateLimit(req, { principalId: auth.principalId });
    if (!rateCheck.allowed) {
      res.setHeader('retry-after', String(rateCheck.reset));
      return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
    }
    try {
      const cred = mintImageCredential({ principalId: auth.principalId });
      res.setHeader('Set-Cookie', buildSetCookie(cred.token, cred.maxAgeSeconds));
      return res.status(200).json({ expiresAt: cred.expiresAt });
    } catch (e) {
      console.error('[collection-image-v2] mint failed:', e?.message || e);
      return res.status(503).json({ error: 'Image access is temporarily unavailable.' });
    }
  }

  if (req.method === 'DELETE') {
    noStore(res);
    res.setHeader('Set-Cookie', buildClearCookie());
    return res.status(200).json({ cleared: true });
  }

  if (req.method === 'GET') {
    noStore(res); // overridden below ONLY on a successful, authorized image response
    const q = req.query || {};
    const p = typeof q.p === 'string' ? q.p : '';
    const id = typeof q.id === 'string' ? q.id : '';
    const index = Number.parseInt(q.i, 10);
    if (!p || !id || id.length > MAX_ID_LEN || !Number.isInteger(index) || index < 0 || index > MAX_INDEX) {
      return res.status(400).json({ error: 'p, id and a non-negative integer i are required' });
    }
    const v = verifyImageCredential(readCookie(req.headers?.cookie || req.headers?.Cookie));
    if (!v.ok) {
      if (v.reason === 'unavailable') return res.status(503).json({ error: 'Image access is temporarily unavailable.' });
      if (v.reason === 'expired') return res.status(403).json({ error: 'IMAGE_LINK_EXPIRED', message: 'Image access has expired.' });
      if (v.reason === 'missing') return res.status(403).json({ error: 'IMAGE_CREDENTIAL_MISSING' });
      return res.status(403).json({ error: 'IMAGE_LINK_INVALID' });
    }
    if (v.principalId !== p) return res.status(403).json({ error: 'IMAGE_PRINCIPAL_MISMATCH' });
    try {
      const objectUri = await getRemoteImageUriForPrincipal({ principalId: v.principalId, id, index });
      if (!objectUri) return res.status(404).json({ error: 'No stored display image for this item/index' });
      const [{ contentType }, bytes] = await Promise.all([media.head({ objectUri }), media.getBytes({ objectUri })]);
      const remainingS = Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000));
      res.setHeader('Content-Type', contentType || 'image/jpeg');
      // NEVER public. Private cache only, and never longer than the credential itself is valid.
      res.setHeader('Cache-Control', `private, max-age=${Math.min(300, remainingS)}`);
      res.setHeader('Vary', 'Cookie');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(bytes);
    } catch (e) {
      console.error('[collection-image-v2] read failed:', e?.message || e);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  noStore(res);
  return res.status(405).json({ error: 'Method not allowed' });
}
