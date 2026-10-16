// src/lib/serverPhotoForReidentify.js — supplies the saved photo to the EXISTING reIdentifyBook workflow when this device
// holds no raw bytes (server-hydrated cards, other device/origin).
//
// Reuses the existing protected display-image retrieval (src/lib/protectedImages.js -> GET /api/collection-image-v2, a
// short-lived HttpOnly cookie credential, principal-scoped, never a caller-supplied URL). Nothing new on the server.
// The bytes are returned to the caller as a data URL for the existing /api/grade call and are NEVER written to the card or
// IndexedDB (so no image sync is triggered and no duplicate media is created).
//
// Every failure is explicit and typed — never a silent fallback.

import { getProtectedImageUrl, subscribeProtectedImages } from './protectedImages.js';

export const SERVER_PHOTO_ERRORS = Object.freeze({
  NO_REMOTE_PHOTO: 'NO_REMOTE_PHOTO',
  NO_CREDENTIAL: 'NO_CREDENTIAL',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  TOO_LARGE: 'TOO_LARGE',
  NOT_AN_IMAGE: 'NOT_AN_IMAGE',
  NETWORK: 'NETWORK',
});

const MESSAGES = {
  NO_REMOTE_PHOTO: 'No saved photo exists for this card, so it cannot be re-evaluated.',
  NO_CREDENTIAL: 'Could not get access to your saved photo (the session may have expired). Sign in again and retry.',
  NOT_FOUND: 'The saved photo could not be found on the server for this card.',
  FORBIDDEN: 'Access to the saved photo was refused. Sign in again and retry.',
  TOO_LARGE: 'The saved photo is too large to re-evaluate.',
  NOT_AN_IMAGE: 'The saved photo is not a usable image.',
  NETWORK: 'Could not download the saved photo (network problem). Nothing was changed. Try again.',
};
const fail = (code) => ({ ok: false, code, message: MESSAGES[code] });

// Raw bytes cap: base64 inflates ~33%, and the grading route's request body limit is 4.5 MB.
export const MAX_SERVER_PHOTO_BYTES = 3 * 1024 * 1024;
export const CREDENTIAL_WAIT_MS = 6000;

const toBase64 = (bytes) => {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
};

// Waits (bounded) for the image credential to exist. getProtectedImageUrl starts the mint and returns null until then.
async function awaitUrl(itemId, deps, waitMs) {
  const first = deps.getUrl(itemId, 0);
  if (first) return first;
  return new Promise((resolve) => {
    let done = false;
    let unsub = () => {};
    let timer = null;
    const finish = (v) => { if (done) return; done = true; if (timer) clearTimeout(timer); unsub(); resolve(v); };
    timer = setTimeout(() => finish(null), waitMs);
    unsub = deps.subscribe(() => { const u = deps.getUrl(itemId, 0); if (u) finish(u); });
  });
}

/**
 * @param {object} item saved card ({ id, remoteImages })
 * @param {object} [deps] injectable for tests
 * @returns {Promise<{ok:true, dataUrl:string, bytes:number, mimeType:string}|{ok:false, code:string, message:string}>}
 */
export async function fetchServerPhotoAsDataUrl(item, deps = {}) {
  const d = {
    getUrl: deps.getUrl || getProtectedImageUrl,
    subscribe: deps.subscribe || subscribeProtectedImages,
    fetchImpl: deps.fetchImpl || ((...a) => fetch(...a)),
    waitMs: deps.waitMs ?? CREDENTIAL_WAIT_MS,
  };
  if (!item || typeof item.id !== 'string' || !Array.isArray(item.remoteImages) || item.remoteImages.length === 0) return fail('NO_REMOTE_PHOTO');
  const url = await awaitUrl(item.id, d, d.waitMs);
  if (!url) return fail('NO_CREDENTIAL');
  let res;
  try { res = await d.fetchImpl(url, { credentials: 'same-origin' }); } catch { return fail('NETWORK'); }
  if (!res) return fail('NETWORK');
  if (res.status === 404) return fail('NOT_FOUND');
  if (res.status === 401 || res.status === 403) return fail('FORBIDDEN');
  if (!res.ok) return fail('NETWORK');
  const mimeType = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return fail('NOT_AN_IMAGE');
  let bytes;
  try { bytes = new Uint8Array(await res.arrayBuffer()); } catch { return fail('NETWORK'); }
  if (bytes.length === 0) return fail('NOT_AN_IMAGE');
  if (bytes.length > MAX_SERVER_PHOTO_BYTES) return fail('TOO_LARGE');
  return { ok: true, dataUrl: `data:${mimeType};base64,${toBase64(bytes)}`, bytes: bytes.length, mimeType };
}
