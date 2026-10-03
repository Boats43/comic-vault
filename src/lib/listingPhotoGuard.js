// src/lib/listingPhotoGuard.js — Outcome #1 LAST-MILE PUBLISH PHOTO GUARD.
//
// The photo is the one packet field not fully knowable during a dry run (the hosted
// URL only exists after eBay's picture service accepts the bytes). Immediately BEFORE
// AddFixedPriceItem the server verifies, per photo:
//   1. the SOURCE bytes the operator device sent hash (sha256) to a media row that
//      belongs to THIS gkAssetId (asset relationship — not merely "a photo exists");
//   2. the eBay-hosted URL is https, on an approved host, is not a placeholder;
//   3. the URL is reachable (HTTP 2xx) and serves Content-Type image/*.
// ANY failure => PUBLISH_BLOCKED_NO_PHOTO (the caller aborts before the eBay call).
// No server-side photo architecture: the publish still originates from the device
// carrying the valid source photo.

import { createHash } from 'node:crypto';

export const APPROVED_PICTURE_HOST_RE = /(^|\.)ebayimg\.com$/i;
const PLACEHOLDER_RE = /placeholder|dryrun|dry-run|example\.|localhost|127\.0\.0\.1|\.invalid(\/|$)/i;

export class PhotoGuardError extends Error {
  constructor(reason, detail) { super(`PUBLISH BLOCKED — NO VALID EBAY PHOTO (${reason}${detail ? ': ' + detail : ''})`); this.name = 'PhotoGuardError'; this.code = 'PUBLISH_BLOCKED_NO_PHOTO'; this.reason = reason; }
}

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function checkPictureUrlShape(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new PhotoGuardError('invalid-url'); }
  if (u.protocol !== 'https:') throw new PhotoGuardError('not-https');
  if (PLACEHOLDER_RE.test(String(url))) throw new PhotoGuardError('placeholder-url');
  if (!APPROVED_PICTURE_HOST_RE.test(u.hostname)) throw new PhotoGuardError('host-not-approved', u.hostname);
  return u;
}

export async function checkPictureReachable(url, fetchImpl = fetch) {
  let res;
  try { res = await fetchImpl(String(url), { method: 'GET', headers: { Range: 'bytes=0-0' } }); }
  catch (e) { throw new PhotoGuardError('unreachable', e?.message); }
  if (!res || !(res.status >= 200 && res.status < 300)) throw new PhotoGuardError('unreachable', `HTTP ${res?.status}`);
  const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
  if (!ct.startsWith('image/')) throw new PhotoGuardError('not-an-image', ct || 'no content-type');
  return { contentType: ct };
}

// sourceImages: [{ bytes, url }] (bytes = the exact decoded bytes uploaded; url = eBay-hosted FullURL)
// assetMediaHashes: Set/array of sha256 for media rows belonging to THIS gkAssetId.
export async function assertPublishPhotos({ sourceImages, assetMediaHashes, fetchImpl = fetch }) {
  if (!Array.isArray(sourceImages) || sourceImages.length === 0) throw new PhotoGuardError('no-photo');
  const owned = new Set(assetMediaHashes || []);
  for (const img of sourceImages) {
    if (!img?.url) throw new PhotoGuardError('no-hosted-url');
    checkPictureUrlShape(img.url);
    if (!img.bytes || !owned.has(sha256Hex(img.bytes))) throw new PhotoGuardError('media-not-for-this-asset');
    await checkPictureReachable(img.url, fetchImpl);
  }
  return { count: sourceImages.length };
}

// ── SOURCE-MEDIA VALIDATION (runs BEFORE any eBay network call, incl. reads) ──────────────────────────────────────
// Every source photo must be a real base64 image data URL whose bytes (a) are non-empty, (b) are a format the eBay
// Media API accepts, (c) actually start with that format's magic bytes, and (d) hash to a media row of THIS gkAssetId.
// Returns [{ bytes, mimeType, sha256 }]. Throws PhotoGuardError (code PUBLISH_BLOCKED_NO_PHOTO) otherwise.
const MEDIA_API_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'image/webp']);
const startsWith = (b, sig, off = 0) => sig.every((v, i) => b[off + i] === v);
function magicMatches(mime, b) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return startsWith(b, [0xff, 0xd8, 0xff]);
  if (mime === 'image/png') return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/gif') return startsWith(b, [0x47, 0x49, 0x46, 0x38]);
  if (mime === 'image/bmp') return startsWith(b, [0x42, 0x4d]);
  if (mime === 'image/tiff') return startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]);
  if (mime === 'image/webp') return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
  if (mime === 'image/avif' || mime === 'image/heic') return startsWith(b, [0x66, 0x74, 0x79, 0x70], 4); // ISO-BMFF "ftyp"
  return false;
}
export function assertSourceImages({ images, assetMediaHashes }) {
  if (!Array.isArray(images) || images.length === 0) throw new PhotoGuardError('no-photo');
  const owned = new Set(assetMediaHashes || []);
  return images.map((img) => {
    const m = typeof img === 'string' ? img.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]*)$/) : null;
    if (!m) throw new PhotoGuardError('source-not-an-image-data-url');
    const mimeType = m[1].toLowerCase();
    if (!MEDIA_API_MIMES.has(mimeType)) throw new PhotoGuardError('source-format-unsupported', mimeType);
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length === 0) throw new PhotoGuardError('source-empty');
    if (!magicMatches(mimeType, bytes)) throw new PhotoGuardError('source-bytes-not-the-declared-format', mimeType);
    const sha = sha256Hex(bytes);
    if (!owned.has(sha)) throw new PhotoGuardError('media-not-for-this-asset');
    return { bytes, mimeType, sha256: sha };
  });
}
