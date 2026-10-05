// Grade-provenance observability — PHASE 1 (observe only).
//
// Law (not yet enforced): A GRADE MAY NOT BECOME ECONOMICALLY LOAD-BEARING
// WITHOUT A DURABLE RECORD THAT IT WAS PREDICTED. Today the
// model_prediction_event write is best-effort/non-fatal, so before any
// refusal is shipped (a later pass, GK-274 precedent: NULL IS NOT NEUTRAL)
// the real Production failure rate must be MEASURED. This module changes no
// grade, no response and no scan outcome; every failure inside it is
// swallowed. It records no prompt, image, condition text or principal id.
//
// Measure from Production: read the daily counter keys (Upstash, via the
// existing KV_REST_API_* credentials), e.g.
//   gk:gradeprov:v1:<YYYY-MM-DD>:prediction:<ok|write_failed>:<branch>:<model>:<buildSha>:<FIRST_GRADE|RE_GRADE>
//   gk:gradeprov:v1:<YYYY-MM-DD>:receipt:<issued|not_issued>:<branch>:<model>:<buildSha>:<FIRST_GRADE|RE_GRADE>
// failure rate = write_failed / (ok + write_failed), per predictionKind. The same facts
// are also emitted as one structured `[grade-provenance]` log line per event.
//
// predictionKind is an OBSERVABILITY LABEL ONLY. It is client-labelled (or
// inferred from image count) and must never be read as authority.

import { researchStore } from './researchStore.js';

const COUNTER_TTL_SECONDS = 35 * 24 * 60 * 60;
const COUNTER_TIMEOUT_MS = 800;

const safe = (v) => String(v ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);

export const PREDICTION_KINDS = Object.freeze(['FIRST_GRADE', 'RE_GRADE']);

/** Valid client label wins; otherwise >1 image implies a re-grade, else a first grade. */
export const resolvePredictionKind = (label, imageCount = 1) => {
  if (PREDICTION_KINDS.includes(label)) return label;
  return Number(imageCount) > 1 ? 'RE_GRADE' : 'FIRST_GRADE';
};

export const classifyWriteFailure = (err) => {
  const msg = String(err?.message || err || '');
  if (/CATALOG_DATABASE_URL.*not set|not set in process\.env/i.test(msg)) return 'NO_DB_ENV';
  if (/EnvironmentIdentity|MARKER_QUERY/i.test(String(err?.name || '') + msg)) return 'ENVIRONMENT_GUARD';
  if (/ValidationFailed/i.test(String(err?.name || ''))) return 'VALIDATION';
  if (/Idempotency/i.test(String(err?.name || ''))) return 'IDEMPOTENCY_CONFLICT';
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return 'TIMEOUT';
  if (/ECONN|ENOTFOUND|connection/i.test(msg)) return 'CONNECTION';
  return 'OTHER';
};

export const counterKey = ({ day, kind, outcome, branch, model, buildSha = null, predictionKind = 'FIRST_GRADE' }) =>
  `gk:gradeprov:v1:${day}:${safe(kind)}:${safe(outcome)}:${safe(branch)}:${safe(model)}:${safe(buildSha)}:${safe(predictionKind)}`;

const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * @param {object} e
 * @param {'prediction'|'receipt'} e.kind
 * @param {string} e.outcome   prediction: ok|write_failed ; receipt: issued|not_issued
 * @param {string} [e.endpoint] @param {string} [e.branch] @param {string|null} [e.model]
 * @param {string|null} [e.buildSha] @param {string|null} [e.errorClass] @param {'FIRST_GRADE'|'RE_GRADE'} [e.predictionKind]
 * Never throws, never blocks beyond COUNTER_TIMEOUT_MS.
 */
export async function observeGradeProvenance({ kind, outcome, endpoint = 'grade', branch = 'unknown', model = null, buildSha = null, predictionKind = 'FIRST_GRADE', errorClass = null, store = null, now = new Date() } = {}) {
  try {
    console.log(`[grade-provenance] ${JSON.stringify({ kind, outcome, endpoint, branch, model, buildSha, predictionKind, errorClass })}`);
  } catch { /* logging must never affect a scan */ }
  try {
    const s = store || researchStore();
    const key = counterKey({ day: utcDay(now), kind, outcome, branch, model, buildSha, predictionKind });
    await Promise.race([
      s.incr(key, COUNTER_TTL_SECONDS),
      new Promise((_, rej) => setTimeout(() => rej(new Error('counter timeout')), COUNTER_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false; // counter store unavailable: the log line above still exists
  }
}

/** Additive, non-sensitive evidence metadata stored inside a GRADE prediction payload. */
export const buildPredictionEvidenceMeta = ({ branch = null, imageCount = 0, imageViews = null, sentDimensions = null, gradeEvidence = null, predictionKind = 'FIRST_GRADE' } = {}) => {
  const views = Array.isArray(imageViews) && imageViews.length === imageCount
    ? imageViews.map((v) => (typeof v === 'string' ? v.toUpperCase() : null))
    : null;
  const declared = views ? views.filter(Boolean) : [];
  return {
    purpose: 'CONDITION_GRADING',
    branch,
    imageCount,
    predictionKind,
    declaredViews: declared.length > 0 ? declared : 'UNDECLARED',
    gradeEvidenceTier: gradeEvidence?.precision ?? 'UNKNOWN',
    sentDimensions: Array.isArray(sentDimensions) ? sentDimensions : null,
    resolutionPolicy: { serverMaxEdgePx: 800, serverJpegQuality: 85, validatedFor: 'IDENTIFICATION_ONLY' },
  };
};
