// src/modules/media/contentAddress.js — PRIVATE. Never imported outside
// src/modules/media/ — enforced by tests/media-module-boundary.test.js,
// mirroring tests/assets-module-boundary.test.js's discipline for the
// Asset Service.
//
// Two pure functions: hash the actual bytes, derive the storage key from
// that hash. This is the whole of "content addressing" in this module —
// every driver receives a key already derived this way, never invents
// its own key scheme.

import { createHash } from 'node:crypto';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// sha256/<first2>/<hash> — the two-char shard prefix keeps any single
// storage-listing directory/prefix from holding an unbounded flat list
// of objects as the store grows (a plain flat sha256/<hash> would still
// be correct, just worse-shaped at scale). contentType is intentionally
// NOT part of the key: the key addresses BYTES, not bytes+metadata — two
// requests for the identical bytes must resolve to the identical object
// regardless of what content-type header either caller happened to send.
export function deriveKey(sha256Hex) {
  return `sha256/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
}
