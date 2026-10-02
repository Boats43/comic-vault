// src/modules/learning/service.js -- GK-278 Minimum Learning Spine.
//
// LAWS: server-written only (no HTTP route imports a writer from here other than
// api/grade.js's server-side inference path and the collection module's own
// transaction); no client-supplied value is accepted by any parameter; unknown
// metadata stays null; history is append-only and corrections are new events.
//
// An operator correction is a LABEL/ACTION. Nothing here is named or treated as
// "truth".

import { createHash } from 'node:crypto';
import { acquireConnection } from './db.js';
import * as repo from './repository.js';
import { ValidationFailedError, IdempotencyConflictError } from './errors.js';

const PREDICTION_SURFACES = ['IDENTITY', 'GRADE', 'CONDITION', 'RESEARCH'];
const CORRECTION_SURFACES = ['GRADE', 'GRADING_FORMAT', 'IDENTITY', 'CONDITION'];
const CORRECTION_ACTIONS = ['SET', 'CLEAR', 'CORRECT'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable canonical JSON (sorted keys) so semantically identical payloads hash identically.
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Record the server's own model output. `prediction` is the structured result the
 * server itself produced/validated -- never request-body material. Idempotent on
 * (principal, surface, resultId): the same inference result replays to the same event;
 * the same resultId with a DIFFERENT payload is a conflict (never a contradictory twin);
 * a different resultId is a different inference and appends a new event.
 */
export async function recordModelPrediction({
  principalId, surface, resultId, prediction, provider, model, modelVersion, promptVersion,
  buildSha, inputHash, usage,
} = {}) {
  if (!principalId) throw new ValidationFailedError('principalId is required');
  if (!PREDICTION_SURFACES.includes(surface)) throw new ValidationFailedError(`surface must be one of ${PREDICTION_SURFACES.join(', ')}`);
  if (typeof resultId !== 'string' || !UUID_RE.test(resultId)) throw new ValidationFailedError('resultId must be a server-minted uuid');
  if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) throw new ValidationFailedError('prediction must be an object');

  const payloadHash = sha256Hex(canonicalJson(prediction));
  const idempotencyKey = `pred-v1:${sha256Hex([principalId, surface, resultId, payloadHash].join('|'))}`;
  const client = await acquireConnection();
  try {
    const inserted = await repo.insertPredictionEvent(client, {
      principalId, surface, resultId,
      provider: strOrNull(provider), model: strOrNull(model), modelVersion: strOrNull(modelVersion),
      promptVersion: strOrNull(promptVersion), buildSha: strOrNull(buildSha),
      inputHash: strOrNull(inputHash), prediction, payloadHash,
      usage: usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : null,
      idempotencyKey,
    });
    if (inserted) return { eventId: inserted.id, replayed: false };
    const existing = await repo.getPredictionEventByResult(client, { principalId, surface, resultId });
    if (!existing) throw new Error('prediction event conflict without a resolvable existing row');
    if (existing.payload_hash !== payloadHash) {
      throw new IdempotencyConflictError('this inference result already has a prediction event with a different payload');
    }
    return { eventId: existing.id, replayed: true };
  } finally {
    client.release();
  }
}

export async function getModelPredictionEvent({ principalId, id } = {}) {
  if (!principalId || !id) throw new ValidationFailedError('principalId and id are required');
  const client = await acquireConnection();
  try {
    return await repo.getPredictionEvent(client, { principalId, id });
  } finally {
    client.release();
  }
}

/**
 * Append one operator correction event USING THE CALLER'S TRANSACTION CLIENT. This is
 * how the event and the state mutation it records commit-or-fail together: the caller
 * (src/modules/collection) holds the item row lock, performs the mutation and calls this
 * on the same client inside BEGIN..COMMIT. This function never opens or commits a
 * transaction. Returns the new event id, or null if an identical event already exists.
 */
export async function appendOperatorCorrectionEventTx(client, {
  principalId, collectionItemId, gkAssetId, surface, action, beforeValue, afterValue,
  authorityBefore, authorityAfter, relatedPredictionEventId, source, reason, buildSha,
} = {}) {
  if (!client || typeof client.query !== 'function') throw new ValidationFailedError('a transaction client is required');
  if (!principalId || !collectionItemId) throw new ValidationFailedError('principalId and collectionItemId are required');
  if (!CORRECTION_SURFACES.includes(surface)) throw new ValidationFailedError(`surface must be one of ${CORRECTION_SURFACES.join(', ')}`);
  if (!CORRECTION_ACTIONS.includes(action)) throw new ValidationFailedError(`action must be one of ${CORRECTION_ACTIONS.join(', ')}`);
  for (const [n, v] of [['beforeValue', beforeValue], ['afterValue', afterValue], ['authorityBefore', authorityBefore], ['authorityAfter', authorityAfter]]) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ValidationFailedError(`${n} must be an object`);
  }
  if (relatedPredictionEventId != null && !UUID_RE.test(relatedPredictionEventId)) throw new ValidationFailedError('relatedPredictionEventId must be a uuid');
  if (gkAssetId != null && !UUID_RE.test(gkAssetId)) throw new ValidationFailedError('gkAssetId must be a uuid');

  const previousEventId = await repo.getLatestCorrectionEventId(client, { principalId, collectionItemId, surface });
  const idempotencyKey = `corr-v1:${sha256Hex([
    principalId, collectionItemId, surface, action,
    canonicalJson(beforeValue), canonicalJson(afterValue), canonicalJson(authorityBefore), canonicalJson(authorityAfter),
    previousEventId || 'none',
  ].join('|'))}`;
  return repo.insertCorrectionEvent(client, {
    principalId, collectionItemId, gkAssetId: gkAssetId ?? null, surface, action,
    beforeValue, afterValue, authorityBefore, authorityAfter,
    relatedPredictionEventId: relatedPredictionEventId ?? null,
    source: strOrNull(source), reason: strOrNull(reason),
    buildSha: strOrNull(buildSha) && buildSha !== 'unknown' ? buildSha : null,
    idempotencyKey,
  });
}

export async function listOperatorCorrectionEvents({ principalId, collectionItemId } = {}) {
  if (!principalId || !collectionItemId) throw new ValidationFailedError('principalId and collectionItemId are required');
  const client = await acquireConnection();
  try {
    return await repo.listCorrectionEvents(client, { principalId, collectionItemId });
  } finally {
    client.release();
  }
}
