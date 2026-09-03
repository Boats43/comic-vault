// src/modules/valuation/idempotency.js — PRIVATE. Never imported
// outside this module -- enforced by
// tests/valuation-module-boundary.test.js.
//
// F10 (D5D isolated-writer-design dispatch): "commit succeeds, response
// lost, retry" must recover the ORIGINAL durable evaluation, never
// create a second semantic one. A deterministic content hash on each
// individual row (MarketObservation/ValuationQuestion/Applicability/
// MarketPopulation) is NOT sufficient by itself to prove this at the
// EVALUATION level -- it proves ROW-level dedup, not "this whole
// multi-row write attempt is the same execution as an earlier one."
// This module supplies the missing EXECUTION-level identity, exactly
// GK-163's already-proven class-wide law (docs/TICKET-REGISTRY.md,
// "GK-163"; src/modules/assets/idempotency.js is the original,
// currently used by 10 live Asset Service operations).
//
// DELIBERATE DUPLICATION, not a shared import from src/modules/assets/
// -- reasoned explicitly, not an oversight: assets/idempotency.js is
// PRIVATE to a LIVE, already-shipped, already-production-serving
// module (createPhysicalAsset, assignIdentity, correctIdentity, etc.
// all depend on it today). Refactoring it to a shared location would
// be a behavior-preserving change in principle (the same technique
// already used for src/lib/canonicalHashFraming.js, D5A/B/C's shared
// hash primitive) -- but CLAUDE.md's own standing rule for this exact
// dispatch ("no production capture... until Milestone Ten's phone
// proof passes") argues for extra conservatism specifically because
// this module has zero production call sites yet and the live asset
// module does not need to be touched, at all, to build it. The
// duplicated logic is ~50 lines and reuses the SAME already-live,
// already schema-generic `idempotency_key` table (db/data0/
// 0005_data1b_idempotency.sql -- operation/idempotency_key/
// principal_id/result_snapshot/request_fingerprint, no asset-specific
// column) -- only the JS wrapper is duplicated, not the schema, and
// this module's own operation names are namespaced ('d5-evaluation')
// so no collision with assets/'s own operation names is possible in
// the shared table.

import { createHash } from 'node:crypto';
import { IdempotencyConflictError } from './errors.js';

// See repository.js's own header for the full SCHEMA rationale --
// configurable (VALUATION_SCHEMA env var), never a session-scoped SET,
// so this module's own scratch-schema proofs never touch real
// data1_dev.
const SCHEMA = process.env.VALUATION_SCHEMA || 'data1_dev';

export function computeRequestFingerprint(semanticPayload) {
  return createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
}

export async function checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint }) {
  if (!idempotencyKey) return null;
  const existing = await client.query(
    `SELECT result_snapshot, request_fingerprint FROM ${SCHEMA}.idempotency_key WHERE operation = $1 AND idempotency_key = $2`,
    [operation, idempotencyKey]
  );
  if (existing.rows.length === 0) return null;
  const row = existing.rows[0];
  if (requestFingerprint !== undefined && row.request_fingerprint != null && row.request_fingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError(
      `idempotencyKey "${idempotencyKey}" was already used for operation "${operation}" with a different request -- the same key must represent the same semantic request`
    );
  }
  return row.result_snapshot;
}

export async function claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint }) {
  if (!idempotencyKey) return;
  const idRes = await client.query('SELECT uuidv7() as id');
  await client.query(
    `INSERT INTO ${SCHEMA}.idempotency_key (id, operation, idempotency_key, principal_id, result_snapshot, request_fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [idRes.rows[0].id, operation, idempotencyKey, principalId, JSON.stringify(result), requestFingerprint ?? null]
  );
}
