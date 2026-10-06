// src/lib/copyReviewHeld.js — DUPLICATE ENTRY CLOSEOUT (2026-10-06).
//
// LAW: CATALOGUE DUPLICATE != PHYSICAL-ASSET DUPLICATE. Duplicate suspicion
// may WARN; it may never silently throw an item away. A bulk-import or
// JSON-restore item that resembles something already owned is HELD (durably,
// in the principal-scoped IndexedDB store `copyReviewHeld`) for ONE batch
// review, and resolved only by an explicit operator choice that REUSES the
// existing server authority (`/api/physical-copy` action:'same' | 'another').
// This module adds NO second duplicate authority: the server still validates
// every SAME COPY candidate and still records every decision.
//
// IDEMPOTENCY != INTENTIONAL SECOND COPY. A retry of the same import attempt
// is protected by (a) the stable ids stored ON the held record (presetId,
// decisionKey are minted once and persisted BEFORE any server call, so every
// retry replays the same attempt) and (b) the caller's untouched inFlightKeys
// race guard. An intentional second copy is simply held and then resolved
// as ANOTHER COPY.
//
// _presetId: this module only USES the existing ANOTHER COPY convention —
// the id is minted with the identical formula the single-scan flow uses
// (`cv_<ms>_<6 base36>`) and handed to addToCatalogue as `_presetId`. How the
// single-scan flow mints/consumes it is untouched.

import { titlesLikelySameBook } from './duplicateCopyDetection.js';

export const HELD_KIND = Object.freeze({ BULK_SCAN: 'BULK_SCAN', JSON_RESTORE: 'JSON_RESTORE', COLLECTION_SYNC: 'COLLECTION_SYNC' });
export const HELD_REASON = Object.freeze({
  CATALOGUE_MATCH: 'CATALOGUE_MATCH',
  IN_FLIGHT_MATCH: 'IN_FLIGHT_MATCH',
  JSON_NO_ID_MATCH: 'JSON_NO_ID_MATCH',
  // The SERVER (409 PHYSICAL_COPY_DECISION_REQUIRED at sync) found an owned physical copy this device's
  // local catalogue could not see (e.g. captured on another device).
  SERVER_DECISION_REQUIRED: 'SERVER_DECISION_REQUIRED',
});

const rand6 = () => Math.random().toString(36).slice(2, 8);
// Same shape as the single-scan ANOTHER COPY's `presetId` (App.jsx).
export const mintItemId = () => `cv_${Date.now()}_${rand6()}`;
export const mintHeldId = () => `held_${Date.now()}_${rand6()}`;
// Deterministic: a repeat 409 for the same local row overwrites ONE held record, never duplicates it.
export const syncHeldId = (collectionItemId) => `held_sync_${collectionItemId}`;
export const mintDecisionKey = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `pcd-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const sameStr = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * Bulk import: is this incoming scan a POSSIBLE duplicate of something owned or
 * currently being saved by another worker? Returns null (proceed normally) or
 * { reason, matchIds }. Triggers are exactly the two the old code used to
 * silently skip on — only the OUTCOME changes (hold, never discard).
 */
export function classifyBulkDuplicate({ catalogue = [], title, issue, year, dupKey, inFlightKeys = new Set() } = {}) {
  if (dupKey != null && inFlightKeys.has(dupKey)) {
    return { reason: HELD_REASON.IN_FLIGHT_MATCH, matchIds: [] };
  }
  const matches = catalogue.filter((c) =>
    titlesLikelySameBook(c.title, title) && c.issue === issue && c.year === year);
  if (matches.length > 0) {
    return { reason: HELD_REASON.CATALOGUE_MATCH, matchIds: matches.map((c) => c.id) };
  }
  return null;
}

/**
 * JSON restore plan. Identity order (never title|issue|year -> skip):
 *   1. exported durable id present  -> idempotent on that id (replay creates nothing;
 *      a NEW id restores even when the catalogue identity is identical)
 *   2. no id + no catalogue match   -> restore normally (fresh id assigned)
 *   3. no id + catalogue match      -> HOLD for copy review
 */
export function planJsonRestore({ parsed, existingItems = [] } = {}) {
  const knownIds = new Set(existingItems.map((c) => c.id));
  const pool = existingItems.map((c) => ({ id: c.id, title: c.title, issue: c.issue, year: c.year }));
  const restore = [];
  const held = [];
  let replayed = 0;
  let invalid = 0;
  for (const c of Array.isArray(parsed) ? parsed : []) {
    if (!c || !c.title) { invalid++; continue; }
    const hasId = typeof c.id === 'string' && c.id.length > 0;
    if (hasId) {
      if (knownIds.has(c.id)) { replayed++; continue; }
      knownIds.add(c.id);
      pool.push({ id: c.id, title: c.title, issue: c.issue, year: c.year });
      restore.push(c);
      continue;
    }
    const matches = pool.filter((p) =>
      titlesLikelySameBook(p.title, c.title) && sameStr(p.issue, c.issue) && sameStr(p.year, c.year));
    if (matches.length > 0) {
      held.push({ entry: c, matchIds: matches.map((m) => m.id) });
      continue;
    }
    const entry = { ...c, id: mintItemId() };
    knownIds.add(entry.id);
    pool.push({ id: entry.id, title: entry.title, issue: entry.issue, year: entry.year });
    restore.push(entry);
  }
  return { restore, held, replayed, invalid };
}

/** Build the durable held record. The payload is sufficient to FINISH the save after a restart. */
export function buildHeldRecord({ kind, reason, principal, fileName = null, incoming = null, image = null, entry = null, matchIds = [], candidates = [], candidatesVerified = false, now = Date.now() } = {}) {
  if (!kind || !reason) throw new Error('buildHeldRecord: kind and reason are required');
  if (kind === HELD_KIND.BULK_SCAN && (!incoming || !image)) {
    throw new Error('buildHeldRecord: a held bulk scan must retain the model result AND the image, or it cannot be resumed');
  }
  if ((kind === HELD_KIND.JSON_RESTORE || kind === HELD_KIND.COLLECTION_SYNC) && !entry) {
    throw new Error('buildHeldRecord: a held JSON restore / sync conflict must retain the full entry, or it cannot be resumed');
  }
  if (kind === HELD_KIND.COLLECTION_SYNC && !entry.id) {
    throw new Error('buildHeldRecord: a held sync conflict must carry the local row id');
  }
  const book = kind === HELD_KIND.BULK_SCAN ? incoming : entry;
  return {
    id: mintHeldId(),
    v: 1,
    kind, reason, principal: principal ?? null, fileName, createdAt: now,
    book: { title: book.title ?? null, issue: book.issue ?? null, year: book.year ?? null },
    incoming: incoming ? JSON.parse(JSON.stringify(incoming)) : null,
    image: image ?? (kind === HELD_KIND.COLLECTION_SYNC
      ? ((Array.isArray(entry.images) ? entry.images : []).find((x) => typeof x === 'string' && x.startsWith('data:')) ?? null)
      : null),
    entry: entry ? JSON.parse(JSON.stringify(entry)) : null,
    localMatchIds: matchIds,
    candidates, candidatesVerified,
    presetId: null,
    decisionKey: null,
    lastError: null,
  };
}

const post = (deps, body) => deps.authFetch('/api/physical-copy', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/** Ask the SERVER for this principal's owned physical-copy candidates. Fail-closed: failure is NOT "zero". */
export async function fetchCandidates(book, deps) {
  try {
    const r = await post(deps, { action: 'candidates', book });
    if (!r || !r.ok) return { ok: false };
    const j = await r.json().catch(() => ({}));
    return { ok: true, candidates: Array.isArray(j.candidates) ? j.candidates : [] };
  } catch { return { ok: false }; }
}

/** Refresh (and durably store) the candidate list. A failed check leaves the record held. */
export async function refreshCandidates(rec, deps) {
  const c = await fetchCandidates(rec.book, deps);
  if (!c.ok) return { ok: false, code: 'CHECK_UNAVAILABLE', record: rec };
  const next = { ...rec, candidates: c.candidates, candidatesVerified: true, lastError: null };
  await deps.putHeld(next);
  return { ok: true, record: next };
}

// presetId + decisionKey are minted ONCE and persisted BEFORE any server call, so a retry
// after a partial failure replays the SAME attempt (same decision key, same row id) —
// idempotent by construction, never a second collection row.
async function ensureAttemptIds(rec, deps) {
  if (rec.presetId && rec.decisionKey) return rec;
  // A sync conflict's "new row" ALREADY EXISTS locally under its own id — that id is the one the server's
  // standing check will see on the push, so the ANOTHER COPY decision must be recorded for exactly it.
  const presetId = rec.presetId || (rec.kind === HELD_KIND.COLLECTION_SYNC ? rec.entry.id : mintItemId());
  const next = { ...rec, presetId, decisionKey: rec.decisionKey || mintDecisionKey() };
  await deps.putHeld(next);
  return next;
}

/**
 * ANOTHER COPY: re-check candidates on the server (fail-closed); if any exist record the
 * operator's decision via action:'another' FIRST (the server's own standing check at the
 * durable write requires it), then save under the pre-minted id, then drop the held record.
 */
export async function resolveAnotherCopy(rec, deps) {
  if (rec.principal && deps.getPrincipal && deps.getPrincipal() !== rec.principal) {
    return { ok: false, code: 'WRONG_PRINCIPAL' };
  }
  const c = await fetchCandidates(rec.book, deps);
  if (!c.ok) return { ok: false, code: 'CHECK_UNAVAILABLE' };
  let cur = await ensureAttemptIds(rec, deps);
  if (c.candidates.length > 0) {
    let recorded = false;
    try {
      const r = await post(deps, { action: 'another', book: cur.book, collectionItemId: cur.presetId, idempotencyKey: cur.decisionKey });
      recorded = !!(r && r.ok);
    } catch { recorded = false; }
    if (!recorded) return { ok: false, code: 'DECISION_NOT_RECORDED' };
  }
  let savedId;
  if (cur.kind === HELD_KIND.COLLECTION_SYNC) {
    // Decision recorded (if candidates exist) -> now the push the server refused will be accepted.
    const pushed = await deps.pushEntry(cur.entry);
    if (pushed) { await deps.markSynced(cur.entry); savedId = cur.entry.id; }
  } else if (cur.kind === HELD_KIND.JSON_RESTORE) {
    savedId = await deps.saveEntry({ ...cur.entry, id: cur.presetId });
  } else {
    savedId = await deps.saveScan({ ...cur.incoming, _presetId: cur.presetId }, cur.image, cur.principal);
  }
  if (!savedId) return { ok: false, code: 'SAVE_FAILED' };
  let cleanupPending = false;
  try { await deps.deleteHeld(cur.id); } catch { cleanupPending = true; }
  return { ok: true, savedId, cleanupPending };
}

/**
 * SAME COPY: the SERVER validates the chosen candidate against its own owned-asset set,
 * appends the photo to the existing asset and records the decision. No second collection
 * row, no second asset. The held record is dropped only after the server confirms.
 */
export async function resolveSameCopy(rec, selectedGkAssetId, deps) {
  if (rec.principal && deps.getPrincipal && deps.getPrincipal() !== rec.principal) {
    return { ok: false, code: 'WRONG_PRINCIPAL' };
  }
  const cur = await ensureAttemptIds(rec, deps);
  let photo;
  const m = typeof cur.image === 'string' ? cur.image.match(/^data:([^;,]+);base64,(.*)$/) : null;
  if (m) photo = { bytes: m[2], contentType: m[1] };
  let ok = false;
  try {
    const r = await post(deps, {
      action: 'same', book: cur.book, selectedGkAssetId,
      gradeReceiptId: typeof cur.incoming?.gradeReceiptId === 'string' ? cur.incoming.gradeReceiptId
        : (typeof cur.entry?._gradeReceiptId === 'string' ? cur.entry._gradeReceiptId : undefined),
      photo, idempotencyKey: cur.decisionKey,
    });
    ok = !!(r && r.ok);
  } catch { ok = false; }
  if (!ok) return { ok: false, code: 'SAME_COPY_NOT_CONFIRMED' };
  // A sync-conflict row exists ONLY locally (the server never accepted it): SAME COPY means it is the
  // existing asset, so the local-only duplicate row is removed — after the server has confirmed.
  if (cur.kind === HELD_KIND.COLLECTION_SYNC) await deps.removeLocalRow(cur.entry.id);
  let cleanupPending = false;
  try { await deps.deleteHeld(cur.id); } catch { cleanupPending = true; }
  return { ok: true, cleanupPending };
}

/**
 * Explicit operator dismissal: "this is the same book I already saved". Only offered when the
 * server confirms ZERO physical-asset candidates (so there is no asset to route SAME COPY to).
 * Never automatic; the operator must tap it. Removes ONLY the held record.
 */
export async function discardHeld(rec, deps) {
  // Guard here, not only in the UI: dismissal is legitimate only when the server has CONFIRMED
  // there is no owned physical asset this scan could be the same copy of.
  if (!rec.candidatesVerified || (rec.candidates || []).length > 0) {
    return { ok: false, code: 'CANDIDATES_EXIST_OR_UNVERIFIED' };
  }
  if (rec.kind === HELD_KIND.COLLECTION_SYNC) await deps.removeLocalRow(rec.entry.id);
  await deps.deleteHeld(rec.id);
  return { ok: true };
}
