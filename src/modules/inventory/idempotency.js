// src/modules/inventory/idempotency.js — PRIVATE. Mirrors
// src/modules/assets/idempotency.js exactly (same class-wide GK-163 law,
// same shared data1_dev.idempotency_key table — operation names used
// here are distinct from every operation name assets/auth/buyer already
// use). Duplicated rather than imported because that file is itself
// PRIVATE to the assets module — a second, independent implementation
// of the same small, generic pattern, not a boundary violation.

import { createHash } from 'node:crypto';
import { IdempotencyConflictError } from './errors.js';

export function computeRequestFingerprint(semanticPayload) {
  return createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
}

export async function checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint }) {
  if (!idempotencyKey) return null;
  const existing = await client.query(
    `SELECT result_snapshot, request_fingerprint FROM data1_dev.idempotency_key WHERE operation = $1 AND idempotency_key = $2`,
    [operation, idempotencyKey]
  );
  if (existing.rows.length === 0) return null;
  const row = existing.rows[0];
  if (requestFingerprint !== undefined && row.request_fingerprint != null && row.request_fingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError(
      `idempotencyKey "${idempotencyKey}" was already used for operation "${operation}" with a ` +
      `different request — the same key must represent the same semantic request`
    );
  }
  return row.result_snapshot;
}

export async function claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint }) {
  if (!idempotencyKey) return;
  const idRes = await client.query('SELECT uuidv7() as id');
  await client.query(
    `INSERT INTO data1_dev.idempotency_key (id, operation, idempotency_key, principal_id, result_snapshot, request_fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [idRes.rows[0].id, operation, idempotencyKey, principalId, JSON.stringify(result), requestFingerprint ?? null]
  );
}
