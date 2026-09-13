// src/lib/operatorActionIdempotency.js — reload-safe idempotency-key
// lifecycle for OperatorAction submits, layered in front of the existing,
// unmodified GK-163 server-side mechanism (src/modules/assets/service.js's
// checkIdempotencyReplay/claimIdempotencyKey). This file owns nothing about
// correctness on the server side — it exists solely so the BROWSER never
// mints a second idempotency key for what is still, as far as anyone can
// tell, the same human intention.
//
// Storage: localStorage. Chosen over IndexedDB as the smallest mechanism
// consistent with this app's existing architecture — grailkeySession.js
// already persists the auth token the same way, and a pending record here
// is a single small synchronous read/write, not a dataset that benefits
// from IndexedDB's async/transactional model (that's what src/db.js's
// IndexedDB catalogue store is for).
//
// Key identity is v1:<principalScope>:<gkAssetId>:<decisionEventId>:
// <actionCode> — NOT the collectionItemId used to find the asset, and
// nothing else. Two different actionCodes for the same decision are two
// different intentions and get two different storage slots, by
// construction — no separate "invalidate the old one" step is needed when
// the operator switches their choice.
//
// principalScope (GK-201 final correction) namespaces this purely-local
// state per operator on a shared browser — it is a LOCAL NAMESPACE ONLY,
// never sent to the server, never authorization authority. The server
// continues to derive the authenticated principal exclusively from the
// verified bearer token (src/modules/auth/token.js). Callers get the scope
// from src/lib/grailkeySession.js's getPrincipalScope(). Without this, a
// second operator logging into the same browser could resolve/reuse the
// first operator's still-pending idempotency key — an unrelated person's
// click reusing a key never means the SAME intention.
//
// Orphan/stale rule (deliberately chosen, documented here because it is the
// safety-critical decision in this file): a pending key is NEVER
// automatically expired or replaced by a fresh one on the client's own
// initiative. It is retained until a DEFINITIVE server response is
// observed, no matter how much wall-clock time passes. This is the only
// choice that preserves correctness unconditionally: GK-163's server-side
// law keys its replay-or-conflict decision on the idempotencyKey itself,
// not on payload freshness or age — minting a NEW key for what might still
// be the same in-flight attempt is exactly how one human intention becomes
// two durable rows. A returning operator resolves an old pending attempt by
// clicking the SAME action again; that reuses the SAME key, and the server
// tells us, definitively, what actually happened (replay if it already
// committed, a fresh execution if it never reached the server, or a
// rejection). `pendingAgeMs`/`isStale` below exist only to drive an
// informational UI label ("pending since Xh ago") — they never gate
// reuse and never trigger auto-deletion.

const PREFIX = 'gk_pending_op:v1:';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // label only — see file header
const UNSCOPED = 'unscoped'; // defensive fallback only — see getOrCreatePendingIdempotencyKey

function storageKey(principalScope, gkAssetId, decisionEventId, actionCode) {
  return `${PREFIX}${principalScope}:${gkAssetId}:${decisionEventId}:${actionCode}`;
}

export function getPendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode }) {
  try {
    const raw = localStorage.getItem(storageKey(principalScope, gkAssetId, decisionEventId, actionCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.idempotencyKey !== 'string' || typeof parsed.createdAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

// The one function submit handlers call. Reuses an existing pending record
// for this exact (principalScope, gkAssetId, decisionEventId, actionCode)
// tuple if one exists; otherwise mints a fresh key and PERSISTS IT
// SYNCHRONOUSLY before returning, so a caller that awaits nothing else
// before firing the request still has the key durable on disk first.
//
// A null/missing principalScope (should not happen for an authenticated
// panel — see grailkeySession.js's getPrincipalScope) falls back to a
// fixed 'unscoped' namespace rather than throwing; it never silently
// borrows another operator's already-scoped keys.
export function getOrCreatePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode }) {
  const scope = principalScope || UNSCOPED;
  const existing = getPendingIdempotencyKey({ principalScope: scope, gkAssetId, decisionEventId, actionCode });
  if (existing) return existing;
  const record = { idempotencyKey: crypto.randomUUID(), createdAt: Date.now() };
  try {
    localStorage.setItem(storageKey(scope, gkAssetId, decisionEventId, actionCode), JSON.stringify(record));
  } catch {
    // localStorage unavailable — the key still works for this one request,
    // it simply won't survive a reload. Nothing else this module can do.
  }
  return record;
}

export function retirePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode }) {
  try {
    localStorage.removeItem(storageKey(principalScope || UNSCOPED, gkAssetId, decisionEventId, actionCode));
  } catch {
    // no-op
  }
}

// A response is DEFINITIVE (retire the pending key) exactly when the server
// told us, authoritatively, what happened to the request: any 2xx, or one
// of the specific rejection codes this dispatch names (400/401/403/404/409).
// Everything else — including a bare 5xx — is treated as AMBIGUOUS on
// purpose: this handler's own writes run inside one transaction with a
// ROLLBACK on error (src/modules/assets/service.js's recordOperatorAction),
// so a 500 from THIS endpoint specifically never leaves a committed row —
// but the general, conservative rule (never assume a 5xx means "nothing
// happened") is kept here rather than special-cased, matching standard
// idempotency-key practice and erring toward retaining, not discarding.
export function isDefinitiveResponseStatus(status) {
  if (status >= 200 && status < 300) return true;
  return [400, 401, 403, 404, 409].includes(status);
}

export function pendingAgeMs(createdAt) {
  return Date.now() - createdAt;
}

export function isStale(createdAt) {
  return pendingAgeMs(createdAt) > STALE_AFTER_MS;
}
