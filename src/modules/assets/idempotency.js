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
// Both functions take an already-open `client` (a connection mid-
// transaction) — this module never opens its own connection or manages
// its own transaction boundary; that stays entirely in service.js.

// Returns the ORIGINAL result_snapshot if this (operation, idempotencyKey)
// pair was already claimed, or null if this is a fresh key (or no key was
// supplied at all — idempotency is opt-in per call, per the design doc).
export async function checkIdempotencyReplay(client, { operation, idempotencyKey }) {
  if (!idempotencyKey) return null;
  const existing = await client.query(
    `SELECT result_snapshot FROM idempotency_key WHERE operation = $1 AND idempotency_key = $2`,
    [operation, idempotencyKey]
  );
  if (existing.rows.length === 0) return null;
  return existing.rows[0].result_snapshot;
}

// Claims the key for this result. Must run inside the SAME transaction as
// the mutation it's guarding — a claim that fails to commit alongside the
// mutation it guards would let a later "replay" re-execute a mutation that
// never actually landed. No-ops when no key was supplied.
export async function claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result }) {
  if (!idempotencyKey) return;
  const idRes = await client.query('SELECT uuidv7() as id');
  await client.query(
    `INSERT INTO idempotency_key (id, operation, idempotency_key, principal_id, result_snapshot)
     VALUES ($1, $2, $3, $4, $5)`,
    [idRes.rows[0].id, operation, idempotencyKey, principalId, JSON.stringify(result)]
  );
}
