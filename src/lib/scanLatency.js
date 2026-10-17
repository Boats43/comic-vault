// src/lib/scanLatency.js — SCAN LATENCY INSTRUMENTATION (measurement only).
//
// PURPOSE: produce a trustworthy BEFORE baseline for scan speed (comics AND books) from a real phone. Nothing in this
// file changes what a scan does, what it sends, what is stored on the item, or what any gate decides. It observes.
//
// WHAT IT GUARANTEES
//   - Never throws into the scan path: every public function swallows its own faults.
//   - Records NUMBERS and a fixed whitelist of enumerated labels only. No image data, no tokens, no titles, no
//     identifiers other than the client-minted scanId (a random id that already appears in logs and requests).
//   - Principal-scoped local storage (same convention as every other user-scoped localStorage key). No session -> not
//     stored. Nothing is sent to any server by this module.
//
// THE TWO USER-FACING MILESTONES (kept separate ON PURPOSE — never fold one into the other)
//   shutterToIdentityMs  scan start -> the authoritative-identification result is committed to the UI
//                        (marks: identity_committed, then identity_painted after two animation frames).
//   shutterToFinalMs     scan start -> the complete, final priced result is merged into the UI
//                        (marks: final_committed / final_painted). Null when enrichment never merged.
//   Enrichment time moved BEHIND an earlier render is not "removed": it stays visible as enrichAfterIdentityMs.
//
// T0 DEFINITION: scan start is the entry of gradeBlob — AFTER the camera/picker handed the app a file. Time inside the
// OS camera UI / file picker is not observable here and is NOT included. Reported as `t0` in every record.
//
// SERVER SIDE: buildServerTiming() renders the W3C `Server-Timing` header api/grade.js now emits; parseServerTiming()
// is its client half. Both are pure.

export const SCAN_LATENCY_STORAGE_KEY = 'cv_scan_latency_v1';
export const SCAN_LATENCY_MAX_RECORDS = 60;
export const SCAN_LATENCY_RECORD_VERSION = 1;
export const SCAN_LATENCY_T0 = 'gradeBlob-entry (after camera/picker returned a file)';

// ───────────── server timing ───────────────────────────────────────────────────────────────────────────────────
// `marks` is api/grade.js's own { label: msSinceHandlerEntry } map. Stages are DIFFERENCES between marks it already
// records; a stage is omitted (never zero-filled) when either of its marks is absent for the branch taken.
const STAGES = [
  ['pre', null, 'ebay_image_start'],                       // handler entry -> eBay lookup begins (auth, guards, parse)
  ['ebay', 'ebay_image_start', 'ebay_image_complete'],     // eBay image search incl. resize + consensus
  ['vision', 'vision_start', 'vision_complete'],           // FIRST model call (Haiku grade-only, or Sonnet identification)
  ['book', 'book_vision_start', 'book_vision_complete'],   // SECOND Sonnet call (BOOK_PROMPT) — Book fallback only
  ['ctx', 'context_vision_start', 'context_vision_complete'], // voice-context re-scan — fallback only
  ['finalize', 'finalize_start', 'finalize_complete'],     // receipt / prediction record / contract assembly
];
const BRANCHES = new Set(['WATCH', 'HAIKU_EBAY_CONSENSUS', 'SONNET_VISION_FALLBACK', 'SONNET_BOOK']);

export function buildServerTiming(marks, totalMs, branch = null) {
  const m = marks && typeof marks === 'object' ? marks : {};
  const out = {};
  for (const [name, from, to] of STAGES) {
    const a = from === null ? 0 : m[from];
    const b = m[to];
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) out[name] = Math.round(b - a);
  }
  if (Number.isFinite(totalMs)) out.total = Math.round(totalMs);
  const header = Object.entries(out).map(([k, v]) => `${k};dur=${v}`).join(', ');
  return { stages: out, header, branch: BRANCHES.has(branch) ? branch : null };
}

export function parseServerTiming(value) {
  const out = {};
  if (typeof value !== 'string') return out;
  for (const part of value.split(',')) {
    const mm = /^\s*([a-z][a-z0-9_-]*)\s*;\s*dur=([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(part);
    if (mm) out[mm[1].toLowerCase()] = Number(mm[2]);
  }
  return out;
}

// ───────────── client timer ────────────────────────────────────────────────────────────────────────────────────
const defaultNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const defaultPaint = (fn) => {
  try {
    if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(() => requestAnimationFrame(fn)); return; }
  } catch { /* fall through */ }
  setTimeout(fn, 0);
};

const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const pick = (obj, keys) => {
  const o = {};
  if (obj && typeof obj === 'object') for (const k of keys) if (Number.isFinite(obj[k])) o[k] = Math.round(obj[k]);
  return o;
};
const label = (v, allowed) => (typeof v === 'string' && allowed.has(v) ? v : null);
const CATEGORIES = new Set(['comic', 'book', 'generic', 'unsupported', 'merchandise']);
const SOURCES = new Set(['ebay_image_search', 'vision_fallback', 'watch']);
const OUTCOMES = new Set(['complete', 'rejected', 'error', 'enrich_failed', 'incomplete']);

export function createScanTimer({ now = defaultNow, paint = defaultPaint, buildSha = null, scanId = null, buyerMode = false, save = false, onFinish = null, idleMs = null, incompleteAfterMs = 3 * 60 * 1000 } = {}) {
  let t0 = 0;
  try { t0 = now(); } catch { t0 = 0; }
  const marks = {};
  const meta = {};
  let finished = null;
  const safe = (fn) => { try { return fn(); } catch { return undefined; } };

  const mark = (name) => safe(() => { if (!(name in marks)) marks[name] = num(now() - t0); });
  const set = (obj) => safe(() => { if (obj && typeof obj === 'object') Object.assign(meta, obj); });

  // markPainted('identity') records identity_committed now and identity_painted two animation frames later.
  const markPainted = (stem, finishAs = null) => safe(() => {
    mark(`${stem}_committed`);
    paint(() => { mark(`${stem}_painted`); if (finishAs) finish(finishAs); });
  });

  const build = (outcome) => {
    const g = (k) => (Number.isFinite(marks[k]) ? marks[k] : null);
    const d = (a, b) => (g(a) != null && g(b) != null && g(b) >= g(a) ? g(b) - g(a) : null);
    const identity = g('identity_painted') ?? g('identity_committed');
    const final = g('final_painted') ?? g('final_committed');
    const durations = {
      encodeMs: d('scan_start', 'encoded'),
      gradeRoundTripMs: d('grade_sent', 'grade_received'),
      identityRenderLagMs: d('identity_committed', 'identity_painted'),
      persistBeforeEnrichMs: d('identity_committed', 'enrich_sent'), // the awaited addToCatalogue sits in this window
      enrichRoundTripMs: d('enrich_sent', 'enrich_received'),
      enrichAfterIdentityMs: identity != null && final != null && final >= identity ? final - identity : null,
      shutterToIdentityMs: identity,
      shutterToFinalMs: final,
    };
    return { outcome, durations };
  };

  const finish = (outcome) => safe(() => {
    if (finished) return finished;
    const { durations } = build(outcome);
    const rec = sanitizeScanRecord({
      v: SCAN_LATENCY_RECORD_VERSION, t0: SCAN_LATENCY_T0, build: buildSha, scanId, at: Date.now(),
      outcome, buyerMode, save, marks: { ...marks }, durations, ...meta, idleMs,
    });
    finished = rec;
    if (typeof onFinish === 'function') safe(() => onFinish(rec));
    return rec;
  });

  mark('scan_start');
  if (incompleteAfterMs > 0 && typeof setTimeout === 'function') {
    safe(() => { const h = setTimeout(() => finish('incomplete'), incompleteAfterMs); if (h && typeof h.unref === 'function') h.unref(); });
  }
  return { mark, set, markPainted, finish, isFinished: () => finished !== null, snapshot: () => ({ marks: { ...marks }, meta: { ...meta } }) };
}

// ───────────── record schema (privacy whitelist) ───────────────────────────────────────────────────────────────
export function sanitizeScanRecord(r) {
  const x = r && typeof r === 'object' ? r : {};
  const marks = {};
  if (x.marks && typeof x.marks === 'object') for (const [k, v] of Object.entries(x.marks)) if (/^[a-z_]{1,32}$/.test(k) && Number.isFinite(v)) marks[k] = Math.round(v);
  return {
    v: SCAN_LATENCY_RECORD_VERSION,
    t0: SCAN_LATENCY_T0,
    build: typeof x.build === 'string' ? x.build.slice(0, 40) : null,
    scanId: typeof x.scanId === 'string' ? x.scanId.slice(0, 64) : null,
    at: num(x.at),
    outcome: label(x.outcome, OUTCOMES),
    buyerMode: x.buyerMode === true,
    save: x.save === true,
    category: label(x.category, CATEGORIES),
    identitySource: label(x.identitySource, SOURCES),
    gradeBranch: label(x.gradeBranch, BRANCHES),
    replayed: x.replayed === true,
    reused: x.reused === true,
    gradeStatus: num(x.gradeStatus),
    enrichStatus: num(x.enrichStatus),
    rawBytes: num(x.rawBytes),
    payloadChars: num(x.payloadChars),
    idleMs: num(x.idleMs),
    network: x.network && typeof x.network === 'object'
      ? { type: typeof x.network.type === 'string' ? x.network.type.slice(0, 12) : null, rttMs: num(x.network.rttMs), downlinkMbps: Number.isFinite(x.network.downlinkMbps) ? Math.round(x.network.downlinkMbps * 10) / 10 : null }
      : null,
    marks,
    durations: pick(x.durations, ['encodeMs', 'gradeRoundTripMs', 'identityRenderLagMs', 'persistBeforeEnrichMs', 'enrichRoundTripMs', 'enrichAfterIdentityMs', 'shutterToIdentityMs', 'shutterToFinalMs']),
    serverGrade: pick(x.serverGrade, ['pre', 'ebay', 'vision', 'book', 'ctx', 'finalize', 'total']),
    serverEnrich: pick(x.serverEnrich, ['total_ms', 'phase1_ms', 'comps_ms', 'verify_ms', 'claude_check_ms']),
  };
}

// ───────────── local ring buffer ───────────────────────────────────────────────────────────────────────────────
export function appendScanRecord(records, rec, max = SCAN_LATENCY_MAX_RECORDS) {
  const list = Array.isArray(records) ? records.slice() : [];
  list.push(rec);
  return list.length > max ? list.slice(list.length - max) : list;
}

// storage = { get(key) -> string|null, set(key, string) -> boolean } (principal-scoped in the app; injectable in tests)
export function loadScanTimings(storage) {
  try {
    const raw = storage.get(SCAN_LATENCY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(sanitizeScanRecord) : [];
  } catch { return []; }
}

export function recordScanTiming(storage, rec) {
  try {
    const next = appendScanRecord(loadScanTimings(storage), sanitizeScanRecord(rec));
    return storage.set(SCAN_LATENCY_STORAGE_KEY, JSON.stringify(next));
  } catch { return false; }
}

export function lastScanAt(storage) {
  const l = loadScanTimings(storage);
  return l.length ? l[l.length - 1].at : null;
}

export function exportScanTimingsText(storage, { build = null, now = Date.now() } = {}) {
  const records = loadScanTimings(storage);
  return JSON.stringify({ kind: 'grailkey-scan-latency', v: SCAN_LATENCY_RECORD_VERSION, build, exportedAt: now, count: records.length, records }, null, 1);
}
