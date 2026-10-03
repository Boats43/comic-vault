// src/lib/ebayMediaApi.js — eBay Media API image upload for the canonical single-listing path.
//
// Replaces the Trading API UploadSiteHostedPictures call on the single-list path. Contract below is eBay's own
// published OpenAPI spec (https://developer.ebay.com/develop/api/spec/media_api.json, read 2026-10-03):
//   POST https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file
//     Content-Type: multipart/form-data, form part name "image" (JPG GIF PNG BMP TIFF AVIF HEIC WEBP; no animated GIF /
//     multi-page PNG/TIFF; must satisfy eBay picture policy). Success: HTTP 201 + Location header
//     https://apim.ebay.com/commerce/media/v1_beta/image/{image_id}.
//   GET  <that Location>  -> { imageUrl (the EPS URL to use in listings), expirationDate }; 404 when expired.
//   OAuth: user access token, scope https://api.ebay.com/oauth/api_scope/sell.inventory (the single scope the spec defines).
//
// createImageFromFile (not createImageFromUrl) is used because GrailKey's source media is PRIVATE (private Blob store,
// content-addressed); createImageFromUrl would require exposing a public URL for eBay to fetch.
//
// Every failure throws MediaApiError with a stable `code`; nothing here ever falls back to another upload path.
import { checkPictureUrlShape, PhotoGuardError } from './listingPhotoGuard.js';

export const EBAY_MEDIA_API_BASE = 'https://apim.ebay.com/commerce/media/v1_beta';
export const EBAY_MEDIA_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory';

export class MediaApiError extends Error {
  constructor(code, message) { super(message); this.name = 'MediaApiError'; this.code = code; }
}
// codes: MEDIA_PERMISSION (401/403 or scope not granted) | MEDIA_UPLOAD_FAILED | MEDIA_RESPONSE_MALFORMED

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/webp': 'webp' };

// Validates the Location returned by createImageFromFile and returns the CANONICAL getImage URL built from the
// extracted image_id. The seller bearer token is only ever attached to a URL produced here, never to the raw Location.
// Accepts exactly https://apim.ebay.com/commerce/media/v1_beta/image/{image_id}: same origin (no subdomain tricks,
// userinfo, custom port), exact path, a single path segment of [A-Za-z0-9_-], no query, no fragment, no encoding tricks.
export function parseMediaImageLocation(location) {
  if (typeof location !== 'string' || !location || /[\s\\%]/.test(location)) return null;
  let u;
  try { u = new URL(location); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'apim.ebay.com' || u.port !== '' || u.username || u.password) return null;
  if (u.search || u.hash) return null;
  const m = u.pathname.match(/^\/commerce\/media\/v1_beta\/image\/([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  return { imageId: m[1], url: `${EBAY_MEDIA_API_BASE}/image/${m[1]}` };
}

export function hasMediaScope(scopes) {
  return Array.isArray(scopes) && scopes.includes(EBAY_MEDIA_SCOPE);
}

const safeErr = async (res) => {
  try { const j = await res.json(); const e = j?.errors?.[0]; return e ? `eBay error ${e.errorId ?? ''}: ${String(e.message || '').slice(0, 160)}` : ''; } catch { return ''; }
};

// bytes: Buffer (already source-validated); returns the verified EPS imageUrl.
export async function uploadImageViaMediaApi({ bytes, mimeType, accessToken, fetchImpl = fetch }) {
  if (!accessToken) throw new MediaApiError('MEDIA_PERMISSION', 'no eBay user access token');
  if (!bytes || bytes.length === 0) throw new MediaApiError('MEDIA_UPLOAD_FAILED', 'empty image payload');

  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mimeType }), `comic-vault-${Date.now()}.${EXT[mimeType] || 'jpg'}`);
  let createRes;
  try {
    createRes = await fetchImpl(`${EBAY_MEDIA_API_BASE}/image/create_image_from_file`, {
      method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, body: form,
    });
  } catch (e) { throw new MediaApiError('MEDIA_UPLOAD_FAILED', `Media API unreachable: ${e?.message || e}`); }

  if (createRes.status === 401 || createRes.status === 403) {
    throw new MediaApiError('MEDIA_PERMISSION', `Media API refused the seller token (HTTP ${createRes.status}) ${await safeErr(createRes)}`.trim());
  }
  if (createRes.status !== 201) {
    throw new MediaApiError('MEDIA_UPLOAD_FAILED', `Media API create_image_from_file returned HTTP ${createRes.status} ${await safeErr(createRes)}`.trim());
  }
  const location = createRes.headers?.get?.('location');
  // The bearer token is only ever sent to a canonical URL rebuilt from a validated image_id, never to the raw Location.
  const parsed = parseMediaImageLocation(location);
  if (!parsed) throw new MediaApiError('MEDIA_RESPONSE_MALFORMED', 'Media API 201 response had no valid image Location');

  let getRes;
  try { getRes = await fetchImpl(parsed.url, { method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }); }
  catch (e) { throw new MediaApiError('MEDIA_UPLOAD_FAILED', `Media API image lookup unreachable: ${e?.message || e}`); }
  if (getRes.status === 401 || getRes.status === 403) throw new MediaApiError('MEDIA_PERMISSION', `Media API refused the image lookup (HTTP ${getRes.status})`);
  if (!getRes.ok) throw new MediaApiError('MEDIA_UPLOAD_FAILED', `Media API image lookup returned HTTP ${getRes.status}`);
  let body;
  try { body = await getRes.json(); } catch { throw new MediaApiError('MEDIA_RESPONSE_MALFORMED', 'Media API image lookup was not JSON'); }
  const imageUrl = body?.imageUrl;
  if (typeof imageUrl !== 'string' || !imageUrl) throw new MediaApiError('MEDIA_RESPONSE_MALFORMED', 'Media API image lookup had no imageUrl');
  if (body.expirationDate != null) {
    const exp = Date.parse(body.expirationDate);
    if (!Number.isFinite(exp) || exp <= Date.now()) throw new MediaApiError('MEDIA_RESPONSE_MALFORMED', 'Media API image is already expired or has an invalid expirationDate');
  }
  try { checkPictureUrlShape(imageUrl); }
  catch (e) {
    if (e instanceof PhotoGuardError) throw new MediaApiError('MEDIA_RESPONSE_MALFORMED', `Media API returned an unusable imageUrl (${e.reason})`);
    throw e;
  }
  return imageUrl;
}
