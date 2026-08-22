// src/modules/media/index.js — PUBLIC. The only file anything outside
// src/modules/media/ may import. Re-exports put/head/getBytes and the
// error classes — nothing else. driver-localfs.js, driver-vercel-blob.js,
// and contentAddress.js are never re-exported here and never imported
// directly by any file outside this directory (see
// tests/media-module-boundary.test.js).
//
// See docs/adr/DATA-1C-MEDIA-DESIGN.md for the full design.
//
// NO delete() export in this v1 (C3 — the Part-A dispatch's delete()
// sketch is deliberately removed). Deletion/retention gets its own
// future ADR; DATA-1C's media SERVICE layer (src/modules/assets/
// service.js's attachMedia) only ever tombstones a media ROW, never
// touches the underlying object.

import * as localfs from './driver-localfs.js';

const DRIVERS = {
  localfs,
  // 'vercel-blob' is loaded lazily inside selectDriver() below — a
  // static import here would make @vercel/blob's absence break this
  // whole module even when localfs (the only driver actually exercised
  // in this dispatch) is selected.
};

function driverName() {
  return process.env.MEDIA_STORAGE_DRIVER || 'localfs';
}

async function selectDriver() {
  const name = driverName();
  if (name === 'localfs') return DRIVERS.localfs;
  if (name === 'vercel-blob') return await import('./driver-vercel-blob.js');
  throw new Error(`[media] unknown MEDIA_STORAGE_DRIVER: ${name}`);
}

// put({ bytes, contentType, sha256 }) -> { objectUri, bytesStored, sha256Verified, created }
export async function put(args) {
  const driver = await selectDriver();
  return driver.put(args);
}

// head({ objectUri }) -> { exists, bytes, contentType }
export async function head(args) {
  const driver = await selectDriver();
  return driver.head(args);
}

// getBytes({ objectUri }) -> Buffer. Dev/verification paths only (M4-2
// round-trip proof, cold getPhysicalAsset display) — not a hot path.
export async function getBytes(args) {
  const driver = await selectDriver();
  return driver.getBytes(args);
}

export {
  MediaStorageError,
  HashMismatchError,
  ImmutabilityViolationError,
  MediaNotFoundError,
  NotProvisionedError,
} from './errors.js';

export { sha256Hex, deriveKey } from './contentAddress.js';
