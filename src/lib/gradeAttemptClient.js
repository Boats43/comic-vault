// src/lib/gradeAttemptClient.js — GK-281 client half: ONE LOGICAL SCAN ATTEMPT -> AT MOST ONE PAID GRADING WORKFLOW.
//
// The SERVER is authoritative (src/lib/gradeAttempt.js claims the attempt atomically before any paid call). This module
// makes the client a good citizen of that contract, and removes the way the observed Production incident happened:
// two POST /api/grade ~10 s apart, identical compressed bytes, the SECOND starting after the FIRST had finished and
// returned. An in-flight-only UI lock cannot stop that, so attempt identity here is PERSISTED.
//
//   ATTEMPT IDENTITY  an attemptId (crypto.randomUUID) minted for one intentional scan action and remembered, per
//                     principal, in localStorage keyed by a canonical INPUT DIGEST (all images + workflow params — the
//                     same canonicalisation the server fingerprints, pinned equal by a test). The digest finds the
//                     attempt again after a lost response, a navigation, or an app restart; the attemptId — never the
//                     digest — is what the server binds.
//   REUSE             a pick whose digest matches a remembered attempt that was SUBMITTED (no usable response ever
//                     applied) or RECEIVED-but-not-saved, inside REUSE_WINDOW_MS, resumes that attempt: the server
//                     replays its stored result with zero provider calls and zero spend. A saved ("consumed") attempt,
//                     an expired one, or a DELIBERATE re-grade starts a NEW attempt.
//   DELIBERATE        re-identify and add-photo are operator-initiated re-grades: they never replay a RECEIVED result
//                     (new attemptId), but still resume a SUBMITTED one (a lost response may already have been billed).
//   WATCH             every frame is its own attempt, never persisted or reused.
//   UNCERTAIN         the server says a prior call may have been billed and its result is unrecoverable. The client does
//                     NOT silently start another: it requires an explicit operator confirmation for a new, possibly
//                     billed, attempt.
//   BULK IMPORT       a per-batch manifest of per-file attemptIds. An UNFINISHED batch whose file set matches exactly is
//                     RESUMED (same attemptIds -> replays, no new paid calls); a finished batch, or a different file
//                     set, is a NEW import with new attemptIds — matching bytes alone never make a new import "the same".

import { scopedGet, scopedSet } from './principalStorage.js';

export const REUSE_WINDOW_MS = 10 * 60 * 1000;
export const BULK_MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_REMEMBERED = 200;
export const STORE_KEY = 'cv_grade_attempts_v1';

export const KINDS = Object.freeze({ SCAN: 'scan', REGRADE: 'regrade', WATCH: 'watch', BULK: 'bulk' });
const STATUS = Object.freeze({ SUBMITTED: 'submitted', RECEIVED: 'received', CONSUMED: 'consumed', UNCERTAIN: 'uncertain' });
export const ATTEMPT_STATUS = STATUS;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256HexAsync = async (s) => hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));

// MUST stay byte-for-byte equivalent to computeAttemptFingerprint (src/lib/gradeAttempt.js); a test pins equality.
export async function inputDigest({ source = null, images = [], voiceContext = null, targetItemId = null, predictionKind = null, imageViews = null } = {}) {
  const imgs = [];
  for (const i of Array.isArray(images) ? images : []) imgs.push(typeof i === 'string' ? await sha256HexAsync(i) : 'non-string');
  const canon = JSON.stringify({
    v: 1,
    w: source === 'watch' ? 'watch' : 'standard',
    imgs,
    vc: typeof voiceContext === 'string' && voiceContext ? voiceContext : null,
    tgt: typeof targetItemId === 'string' && targetItemId ? targetItemId : null,
    pk: typeof predictionKind === 'string' ? predictionKind : null,
    iv: Array.isArray(imageViews) ? imageViews.map((x) => (x == null ? null : String(x))) : null,
  });
  return `sha256:${await sha256HexAsync(canon)}`;
}

export const mintAttemptId = () => globalThis.crypto.randomUUID();

// ───────────── persistence (principal-scoped; no session => nothing is read or remembered) ─────────────
const load = () => {
  try { const raw = scopedGet(STORE_KEY); const o = raw ? JSON.parse(raw) : null; if (o && typeof o === 'object') return { entries: o.entries || {}, bulk: o.bulk || {} }; } catch { /* ignore */ }
  return { entries: {}, bulk: {} };
};
const save = (s) => {
  const keys = Object.keys(s.entries);
  if (keys.length > MAX_REMEMBERED) {
    keys.sort((a, b) => (s.entries[a].updatedAt || 0) - (s.entries[b].updatedAt || 0));
    for (const k of keys.slice(0, keys.length - MAX_REMEMBERED)) delete s.entries[k];
  }
  return scopedSet(STORE_KEY, JSON.stringify(s));
};
const fresh = (e, now) => e && now - (e.updatedAt || 0) <= REUSE_WINDOW_MS;

/**
 * Decide the attempt for an intentional grading action. Pure given storage + `now`.
 *   -> { attemptId, reused:boolean, blocked?:'UNCERTAIN' }
 * `blocked:'UNCERTAIN'` means a prior attempt for this exact input may already have been billed and is unrecoverable:
 * the caller must obtain explicit operator confirmation and call again with `authorizeNewAttempt:true`.
 */
export function acquireAttempt({ digest, kind = KINDS.SCAN, authorizeNewAttempt = false, now = Date.now(), mint = mintAttemptId } = {}) {
  if (kind === KINDS.WATCH) return { attemptId: mint(), reused: false }; // never persisted, never reused
  const s = load();
  const prior = digest ? s.entries[digest] : null;
  if (prior && fresh(prior, now)) {
    if (prior.status === STATUS.UNCERTAIN && !authorizeNewAttempt) return { attemptId: prior.attemptId, reused: true, blocked: 'UNCERTAIN' };
    if (prior.status === STATUS.SUBMITTED) return { attemptId: prior.attemptId, reused: true };
    if (prior.status === STATUS.RECEIVED && kind !== KINDS.REGRADE) return { attemptId: prior.attemptId, reused: true };
  }
  const attemptId = mint();
  if (digest) { s.entries[digest] = { attemptId, kind, status: STATUS.SUBMITTED, createdAt: now, updatedAt: now }; save(s); }
  return { attemptId, reused: false };
}

const setStatus = (digest, attemptId, status, now = Date.now()) => {
  if (!digest) return false;
  const s = load();
  const e = s.entries[digest];
  if (!e || e.attemptId !== attemptId) return false;
  e.status = status; e.updatedAt = now;
  return save(s);
};
export const markReceived = (digest, attemptId, now) => setStatus(digest, attemptId, STATUS.RECEIVED, now);
export const markConsumed = (digest, attemptId, now) => setStatus(digest, attemptId, STATUS.CONSUMED, now);
export const markUncertain = (digest, attemptId, now) => setStatus(digest, attemptId, STATUS.UNCERTAIN, now);

// ───────────── in-memory single-flight (rapid double submit, change-event dupes, remount races) ─────────────
const inFlight = new Map();
export const _inFlightSize = () => inFlight.size;
/** Same key concurrently => the SAME promise (one request). Cleared when it settles. */
export function singleFlight(key, fn) {
  if (key && inFlight.has(key)) return inFlight.get(key);
  const p = Promise.resolve().then(fn).finally(() => { if (key) inFlight.delete(key); });
  if (key) inFlight.set(key, p);
  return p;
}

// ───────────── the request itself ─────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const MAX_IN_PROGRESS_WAIT_MS = 95 * 1000; // lease (90 s) + a beat; the server answers COMPLETED/UNCERTAIN by then

/**
 * POST /api/grade under an attempt. Returns the final Response (callers keep their existing res.ok / res.json()).
 *  - 409 GRADE_ATTEMPT_IN_PROGRESS -> waits retry-after and re-asks the SAME attemptId (never a new one).
 *  - 409 GRADE_ATTEMPT_UNCERTAIN   -> marks the remembered attempt uncertain and returns the 409 for the caller to show.
 *  - success                       -> remembered as RECEIVED (a refresh/retry replays instead of paying again).
 */
export async function postGradeWithAttempt({ apiFetch, headers = {}, body, attemptId, digest = null, sleepFn = sleep, now = () => Date.now(), maxWaitMs = MAX_IN_PROGRESS_WAIT_MS }) {
  const started = now();
  for (;;) {
    const res = await apiFetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ...body, attemptId }),
    });
    if (res.status === 409) {
      let data = null;
      try { data = await res.clone().json(); } catch { /* not json */ }
      if (data?.error === 'GRADE_ATTEMPT_IN_PROGRESS' && now() - started < maxWaitMs) {
        await sleepFn(Math.max(1, Number(data.retryAfter) || 3) * 1000);
        continue;
      }
      if (data?.error === 'GRADE_ATTEMPT_UNCERTAIN') markUncertain(digest, attemptId);
      return res;
    }
    if (res.ok) markReceived(digest, attemptId);
    return res;
  }
}

const defaultConfirm = (message) => {
  try { return typeof globalThis.confirm === 'function' ? !!globalThis.confirm(message) : false; } catch { return false; }
};
const UNCERTAIN_CONFIRM_TEXT =
  'A previous grading attempt for this exact photo may already have been charged, and its result could not be recovered.\n\n' +
  'Start a NEW grading attempt? It may be billed again.';

/**
 * The one call sites use. Computes the input digest, finds-or-mints the attempt, de-duplicates identical concurrent
 * submissions (single-flight), posts under the attempt, and returns { ok, status, data, attemptId, digest, reused }.
 * `data.scanId` is re-stamped with THIS caller's scanId so a shared in-flight result never fails scan ownership.
 */
export async function runGradeAttempt({ apiFetch, headers = {}, body, kind = KINDS.SCAN, confirmNewAttempt = defaultConfirm, ...opts }) {
  const digest = kind === KINDS.WATCH ? null : await inputDigest(body);
  const out = await singleFlight(digest, async () => {
    let acq = acquireAttempt({ digest, kind });
    if (acq.blocked === 'UNCERTAIN') {
      const approved = await confirmNewAttempt(UNCERTAIN_CONFIRM_TEXT);
      if (!approved) {
        return { ok: false, status: 409, data: { error: 'GRADE_ATTEMPT_UNCERTAIN', message: attemptRefusalText({ error: 'GRADE_ATTEMPT_UNCERTAIN' }) }, attemptId: acq.attemptId, digest, reused: true, declined: true };
      }
      acq = acquireAttempt({ digest, kind, authorizeNewAttempt: true });
    }
    const res = await postGradeWithAttempt({ apiFetch, headers, body, attemptId: acq.attemptId, digest, ...opts });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    // `attemptReplay` is a transport annotation, not item data: surface it as `replayed` and keep it OUT of `data`
    // (callers spread `data` into the catalogue item, which is synced to the server).
    let replayed = false;
    if (data && typeof data === 'object' && 'attemptReplay' in data) { const { attemptReplay, ...rest } = data; replayed = attemptReplay === true; data = rest; }
    // Scan-latency instrumentation (measurement only): the server's Server-Timing / x-grade-branch headers, passed through
    // as transport annotations. They are never merged into `data` and nothing reads them except src/lib/scanLatency.js.
    const hdr = (n) => { try { return res.headers?.get?.(n) ?? null; } catch { return null; } };
    return { ok: res.ok, status: res.status, data, attemptId: acq.attemptId, digest, reused: acq.reused, replayed, serverTiming: hdr('server-timing'), gradeBranch: hdr('x-grade-branch') };
  });
  if (body && typeof body.scanId === 'string' && out.data && typeof out.data === 'object') {
    return { ...out, data: { ...out.data, scanId: body.scanId } };
  }
  return out;
}

/** Plain-language text for the attempt refusals (display only). Falls through to null for any other error. */
export function attemptRefusalText(body) {
  switch (body?.error) {
    case 'GRADE_ATTEMPT_UNCERTAIN':
      return 'A previous grading attempt for this photo may already have been charged and its result could not be recovered. Scan again to start a new attempt (it may be billed).';
    case 'GRADE_ATTEMPT_IN_PROGRESS': return 'This photo is still being graded. Please wait a moment.';
    case 'GRADE_ATTEMPT_UNAVAILABLE': return 'Scan accounting is temporarily unavailable — please try again shortly.';
    case 'GRADE_ATTEMPT_INPUT_MISMATCH': return 'This scan attempt was already used for a different photo. Please scan again.';
    case 'GRADE_ATTEMPT_RECOVERY_PENDING': return 'Your scan result is saved; finishing it is temporarily unavailable. Please retry shortly.';
    default: return null;
  }
}

// ───────────── bulk import manifests ─────────────
/** Stable, content-independent file fingerprint (name|size|lastModified) plus the compressed-bytes digest once known. */
export const fileFingerprint = (f) => `${f?.name ?? ''}|${f?.size ?? 0}|${f?.lastModified ?? 0}`;

/**
 * Begin (or RESUME) a bulk import. `files` = [{ fp }]. An UNFINISHED manifest (fewer than all files consumed) whose
 * fingerprint set matches exactly, inside BULK_MANIFEST_TTL_MS, is resumed with its ORIGINAL per-file attemptIds;
 * anything else is a new import with new attemptIds.
 *   -> { importId, resumed:boolean, files:[{ fp, attemptId, status }] }
 */
export function beginBulkImport({ files, now = Date.now(), mint = mintAttemptId } = {}) {
  const s = load();
  const wanted = [...new Set(files.map((f) => f.fp))].sort().join('\n');
  for (const [importId, m] of Object.entries(s.bulk)) {
    if (now - (m.updatedAt || 0) > BULK_MANIFEST_TTL_MS) { delete s.bulk[importId]; continue; }
    const have = m.files.map((f) => f.fp).sort().join('\n');
    const unfinished = m.files.some((f) => f.status !== STATUS.CONSUMED);
    if (have === wanted && unfinished) { m.updatedAt = now; save(s); return { importId, resumed: true, files: m.files.map((f) => ({ ...f })) }; }
  }
  const importId = mint();
  const m = { createdAt: now, updatedAt: now, files: files.map((f) => ({ fp: f.fp, attemptId: mint(), status: STATUS.SUBMITTED })) };
  s.bulk[importId] = m;
  save(s);
  return { importId, resumed: false, files: m.files.map((f) => ({ ...f })) };
}
/** Pair each INPUT file (by position) with its manifest slot; duplicate fingerprints consume distinct slots. */
export function alignBulkManifest(files, manifestFiles) {
  const pool = manifestFiles.map((f) => ({ ...f, taken: false }));
  return files.map((file) => {
    const fp = fileFingerprint(file);
    const slot = pool.find((s) => !s.taken && s.fp === fp);
    if (slot) slot.taken = true;
    return slot ? { fp, attemptId: slot.attemptId, status: slot.status } : { fp, attemptId: mintAttemptId(), status: STATUS.SUBMITTED };
  });
}
/** Operator-approved NEW attempt for one bulk slot whose previous attempt was UNCERTAIN. Returns the new attemptId. */
export function renewBulkAttempt({ importId, fp, oldAttemptId, now = Date.now(), mint = mintAttemptId } = {}) {
  const s = load();
  const f = s.bulk[importId]?.files.find((x) => x.fp === fp && x.attemptId === oldAttemptId);
  if (!f) return null;
  f.attemptId = mint(); f.status = STATUS.SUBMITTED; s.bulk[importId].updatedAt = now;
  save(s);
  return f.attemptId;
}
export function markBulkFile({ importId, fp, attemptId = null, status, now = Date.now() } = {}) {
  const s = load();
  const m = s.bulk[importId];
  const f = m?.files.find((x) => x.fp === fp && (!attemptId || x.attemptId === attemptId));
  if (!f) return false;
  f.status = status; m.updatedAt = now;
  return save(s);
}
