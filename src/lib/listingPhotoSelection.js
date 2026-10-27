// src/lib/listingPhotoSelection.js — outgoing eBay listing photos from the asset's CERTIFIED durable evidence.
//
// WHY (Old Man Logan #25, 2026-10-16): the listing click sent the CATALOGUE photos (getComicPhotos). A catalogue photo is
// display material; its bytes are not a durable media row (hash c1860d38… matched none of the asset's 7), and on a device
// that holds only the server copy it is a link, not bytes. The server guard (src/lib/listingPhotoGuard.js — UNCHANGED, never
// weakened) correctly refuses any image whose sha256 is not a media row of THIS asset, so the first listing could never pass.
//
// WHAT: when the asset has a FRONT evidence row, the exact stored bytes are retrieved through the existing authenticated
// media pathway (GET /api/asset-media?mediaId=…, Bearer, ownership-checked server-side) and sent as the listing image.
// The client re-verifies sha256(bytes) === the media row's content_hash BEFORE sending, so a wrong/altered/other-asset
// byte stream never leaves the device. Read-only: nothing is created, written or duplicated. Works on any signed-in device.
//
// Policy: FRONT only (the declared cover view). BACK/SPINE/PAGES/DETAIL are private evidence and are not published by this
// path. No FRONT row => the caller keeps its existing behavior (the server guard still decides) — never a silent substitute.
//
// Pure + injectable; no I/O of its own.

export const MAX_LISTING_PHOTO_BYTES = 3 * 1024 * 1024; // base64 inflates ~33%; the listing route body limit is 4.5 MB
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEX64 = /^[0-9a-f]{64}$/i;

export const LISTING_PHOTO_ERRORS = Object.freeze({
  NO_FRONT_EVIDENCE: 'NO_FRONT_EVIDENCE',
  MEDIA_UNAUTHORIZED: 'MEDIA_UNAUTHORIZED',
  MEDIA_NETWORK: 'MEDIA_NETWORK',
  HASH_MISMATCH: 'HASH_MISMATCH',
  TOO_LARGE: 'TOO_LARGE',
  NOT_AN_IMAGE: 'NOT_AN_IMAGE',
});

const MESSAGES = {
  NO_FRONT_EVIDENCE: 'This asset has no FRONT evidence photo to publish.',
  MEDIA_UNAUTHORIZED: 'The FRONT evidence photo could not be retrieved for this account (not found or not permitted). Nothing was listed.',
  MEDIA_NETWORK: 'The FRONT evidence photo could not be downloaded (network problem). Nothing was listed. Try again.',
  HASH_MISMATCH: 'The retrieved FRONT photo does not match its recorded fingerprint. Nothing was listed.',
  TOO_LARGE: 'The FRONT evidence photo is too large to attach to a listing.',
  NOT_AN_IMAGE: 'The FRONT evidence record is not a usable image.',
};
const fail = (code) => ({ ok: false, code, message: MESSAGES[code] });

/**
 * Pick the asset's FRONT evidence row from the asset graph. Only rows of THIS asset qualify.
 * @param {{ asset?: {id?: string}, media?: object[] }|null} graph the /api/assets graph for the card's own asset
 * @returns {{ok:true,row:object}|{ok:false,code:string,message:string}}
 */
export function selectFrontEvidenceMedia(graph) {
  const assetId = graph?.asset?.id;
  const rows = Array.isArray(graph?.media) ? graph.media : [];
  const eligible = rows.filter((r) =>
    r && typeof r.id === 'string' && r.id
    && r.capture_view === 'FRONT'
    && (r.asset_id == null || r.asset_id === assetId)
    && IMAGE_TYPES.has(String(r.content_type || '').toLowerCase())
    && HEX64.test(String(r.content_hash || '')));
  if (!assetId || eligible.length === 0) return fail('NO_FRONT_EVIDENCE');
  // Newest FRONT wins (deterministic: recorded_at, then id).
  eligible.sort((a, b) => String(b.recorded_at || '').localeCompare(String(a.recorded_at || '')) || String(b.id).localeCompare(String(a.id)));
  return { ok: true, row: eligible[0] };
}

/**
 * V1.1a: the asset's rows for the SELLER-APPROVED photo set, in the approved order. Every id must be a row of THIS asset (same
 * eligibility as the FRONT selector); a single missing / foreign / non-image row fails the whole set -- never a silent subset.
 * @returns {{ok:true,rows:object[]}|{ok:false,code:string,message:string}}
 */
export function selectApprovedEvidenceMedia(graph, mediaIds) {
  const assetId = graph?.asset?.id;
  const rows = Array.isArray(graph?.media) ? graph.media : [];
  if (!assetId || !Array.isArray(mediaIds) || mediaIds.length === 0) return fail('NO_FRONT_EVIDENCE');
  const byId = new Map(rows.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
  const out = [];
  for (const id of mediaIds) {
    const r = byId.get(id);
    if (!r || (r.asset_id != null && r.asset_id !== assetId) || !IMAGE_TYPES.has(String(r.content_type || '').toLowerCase()) || !HEX64.test(String(r.content_hash || ''))) {
      return { ok: false, code: 'APPROVED_PHOTO_UNAVAILABLE', message: 'An approved photograph is not available for this asset; re-open the listing package and approve again.' };
    }
    out.push(r);
  }
  return { ok: true, rows: out };
}

const defaultSha256 = async (bytes) => {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
const toBase64 = (bytes) => {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
};

/**
 * Retrieve the selected FRONT row's exact bytes and verify them against the row's recorded hash.
 * @param {{ row: object, fetchMedia: (mediaId:string)=>Promise<Response>, sha256Hex?: (bytes:Uint8Array)=>Promise<string> }} args
 * @returns {Promise<{ok:true,images:string[],mediaIds:string[],sha256:string}|{ok:false,code:string,message:string}>}
 */
export async function fetchCertifiedListingPhoto({ row, fetchMedia, sha256Hex = defaultSha256 }) {
  if (!row || typeof row.id !== 'string') return fail('NO_FRONT_EVIDENCE');
  let res;
  try { res = await fetchMedia(row.id); } catch { return fail('MEDIA_NETWORK'); }
  if (!res) return fail('MEDIA_NETWORK');
  if (res.status === 401 || res.status === 403 || res.status === 404) return fail('MEDIA_UNAUTHORIZED');
  if (!res.ok) return fail('MEDIA_NETWORK');
  const type = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) return fail('NOT_AN_IMAGE');
  let bytes;
  try { bytes = new Uint8Array(await res.arrayBuffer()); } catch { return fail('MEDIA_NETWORK'); }
  if (bytes.length === 0) return fail('NOT_AN_IMAGE');
  if (bytes.length > MAX_LISTING_PHOTO_BYTES) return fail('TOO_LARGE');
  const actual = (await sha256Hex(bytes)).toLowerCase();
  if (actual !== String(row.content_hash).toLowerCase()) return fail('HASH_MISMATCH');
  return { ok: true, images: [`data:${type};base64,${toBase64(bytes)}`], mediaIds: [row.id], sha256: actual };
}
