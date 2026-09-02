// src/modules/assets/idempotency.js — PRIVATE. Never imported outside
// this module — enforced by tests/assets-module-boundary.test.js (S3-11).
//
// Generalizes entity_mint_basis's own idempotency shape (a UNIQUE
// constraint is the mechanism, not an application-level check-then-insert
// race) from "one operation (mint)" to any operation the service names.
// See docs/adr/DATA-1B-ASSET-SERVICE-DESIGN.md, Section 3 ("Idempotency")
// and Section 6 (the new idempotency_key table, db/data0/
// 0005_data1b_idempotency.sql).
//
// GK-163 (docs/TICKET-REGISTRY.md) — class-wide request fingerprint, ONE
// shared law here instead of nine per-operation copies of attachMedia's
// own bespoke pattern (DATA-1C). The law: same idempotencyKey + same
// semantic requestFingerprint -> replay the original result verbatim,
// zero new rows. Same idempotencyKey + a DIFFERENT requestFingerprint ->
// IdempotencyConflictError, never a silent stale-success replay. Each
// caller (service.js) declares its own semantic payload via
// computeRequestFingerprint({...fields that define what this request
// MEANS...}) — this module never has operation-specific knowledge of
// what those fields are, matching the module-boundary discipline the
// rest of this file already follows (repository.js owns SQL,
// service.js owns orchestration, this file owns the idempotency law
// only).
//
// Both functions take an already-open `client` (a connection mid-
// transaction) — this module never opens its own connection or manages
// its own transaction boundary; that stays entirely in service.js.
//
// GK-178 (2026-09-03) — idempotency_key is schema-qualified
// (data1_dev.idempotency_key), never bare — see repository.js's header
// for why (pooled-connection session-state hazard).

import { createHash } from 'node:crypto';
import { IdempotencyConflictError } from './errors.js';

// Pure function — sha256 of the canonical JSON of whatever semantic
// fields the caller declares define "this request." Exported so
// service.js computes the SAME fingerprint value at both the replay
// check and the claim (never two independent computations that could
// silently drift apart).
export function computeRequestFingerprint(semanticPayload) {
  return createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
}

// Returns the ORIGINAL result_snapshot if this (operation, idempotencyKey)
// pair was already claimed AND the caller's requestFingerprint matches the
// one recorded at claim time; null if this is a fresh key (or no key was
// supplied at all — idempotency is opt-in per call, per the design doc).
// Throws IdempotencyConflictError — never returns a mismatched result —
// when the key was already claimed under a DIFFERENT fingerprint.
//
// A stored fingerprint of NULL (a row written before migration 0010, or
// by a caller that genuinely supplied none) has nothing to compare
// against — permits the replay rather than fabricating a retroactive
// verdict about history this function cannot know. This is a one-time
// transition-period allowance for pre-existing rows, not a way for a
// NEW call to opt out of the check: every service.js call site this
// pass touched always supplies a real requestFingerprint.
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

// Claims the key for this result. Must run inside the SAME transaction as
// the mutation it's guarding — a claim that fails to commit alongside the
// mutation it guards would let a later "replay" re-execute a mutation that
// never actually landed. No-ops when no key was supplied.
export async function claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint }) {
  if (!idempotencyKey) return;
  const idRes = await client.query('SELECT uuidv7() as id');
  await client.query(
    `INSERT INTO data1_dev.idempotency_key (id, operation, idempotency_key, principal_id, result_snapshot, request_fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [idRes.rows[0].id, operation, idempotencyKey, principalId, JSON.stringify(result), requestFingerprint ?? null]
  );
}
