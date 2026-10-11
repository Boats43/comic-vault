// /api/collection-image - RETIRED (GK-L1B, 2026-10-11).
//
// This endpoint used to serve any collection item's display image to ANY unauthenticated caller that knew the item
// id (lookup `WHERE id = $1 LIMIT 1`, no principal scope, `Cache-Control: public, max-age=31536000, immutable`).
// That was a confirmed Production confidentiality defect. It is REPLACED by api/collection-image-v2.js
// (authenticated minting of short-lived, principal/item/index-bound signed links).
//
// It now answers 410 Gone to every method WITHOUT touching the database or the media store, with no-store so a
// cache cannot hold the retirement either. The file is kept (rather than deleted) so the old path returns a
// definite, cacheable-nowhere "gone" instead of a platform 404 that a CDN could treat differently.

export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(410).json({ error: 'GONE', message: 'This image endpoint has been retired. Update the app and try again.' });
}
