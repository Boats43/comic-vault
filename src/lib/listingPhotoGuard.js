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
