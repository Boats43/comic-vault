// src/lib/principalStorage.js — principal-scoped browser persistence
// (LIVE EXPOSURE CLOSURE, 2026-10-04).
//
// LOCAL DURABLE USER DATA IS PRINCIPAL-SCOPED. The principal is read from
// the CURRENT session token on every call (getPrincipalScope), never cached
// and never chosen by a caller — so local scope can never disagree with the
// token the server will authenticate. No session -> no scope -> every
// scoped read returns empty and every scoped write refuses. Anonymous data
// is never given an invented principal.
//
// IndexedDB uses one physical database per principal (src/db.js). This file
// covers the localStorage keys that hold user-owned data (buyer sessions
// incl. pending sync queue, trade piles, listing packets, buyer settings).

import { getPrincipalScope } from "./grailkeySession.js";

export const SCOPE_SEPARATOR = "::p::";

// Exported for tests. Returns null when no authenticated principal exists.
export function scopedKey(baseKey, principal = getPrincipalScope()) {
  if (!principal) return null;
  return `${baseKey}${SCOPE_SEPARATOR}${principal}`;
}

export function scopedGet(baseKey) {
  try {
    const key = scopedKey(baseKey);
    return key ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

// Returns true when written. Refuses (false) with no authenticated principal.
export function scopedSet(baseKey, value) {
  try {
    const key = scopedKey(baseKey);
    if (!key) return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function scopedRemove(baseKey) {
  try {
    const key = scopedKey(baseKey);
    if (key) localStorage.removeItem(key);
  } catch {
    // no-op
  }
}
