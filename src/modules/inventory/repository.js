// src/modules/inventory/repository.js — PRIVATE. The only file in this
// module permitted to issue raw SQL. Every query is schema-qualified
// (data1_dev.<table>), never a bare table reference (GK-178).
//
// ATOMIC RESERVATION, precisely: every "CAS" function below is a single
// UPDATE (or INSERT ... ON CONFLICT DO NOTHING for enrollment)
// predicated on the row's CURRENT state, e.g.
//   UPDATE inventory_current_state SET state='RESERVED', ...
//   WHERE gk_asset_id=$1 AND state='AVAILABLE'
// Postgres's own row-level MVCC makes this atomic: if two callers race,
// the database serializes the two UPDATEs against the same physical
// row — the second one's WHERE predicate is evaluated against whatever
// the first one committed, so at most one of them can ever match and
// update a row. This is genuine database-level concurrency control, not
// a JavaScript read-then-decide-then-write race. Every function here
// returns null (never throws) when the CAS predicate did not match —
// service.js decides whether that is a real conflict (and rolls the
// whole transaction back, undoing the transition_event this same
// transaction inserted first).

const uuidv7 = async (client) => (await client.query('SELECT uuidv7() as id')).rows[0].id;

export async function assertPrincipalExists(client, principalId) {
  const r = await client.query('SELECT 1 FROM data1_dev.gk_principal WHERE id = $1', [principalId]);
  return r.rows.length > 0;
}

export async function getAssetOwner(client, gkAssetId) {
  const r = await client.query('SELECT owner_principal_id FROM data1_dev.current_owner WHERE asset_id = $1', [gkAssetId]);
  return r.rows[0]?.owner_principal_id || null;
}

export async function assetExists(client, gkAssetId) {
  const r = await client.query('SELECT 1 FROM data1_dev.gk_asset WHERE id = $1', [gkAssetId]);
  return r.rows.length > 0;
}

// insertTransitionEvent — always inserted FIRST, inside the caller's
// open transaction, before the CAS attempt below. If the CAS then finds
// its predicate doesn't match, the caller ROLLBACKs the whole
// transaction — this insert never becomes durable history in that case.
export async function insertTransitionEvent(client, {
  gkAssetId, priorState, nextState, reason, channel, externalReference,
  correlationId, recordedByPrincipalId, occurredAt, idempotencyKey,
}) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.inventory_transition_event (
       id, gk_asset_id, prior_state, next_state, reason, channel, external_reference,
       correlation_id, occurred_at, recorded_by_principal_id, idempotency_namespace, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10, 'inventory-authority-transition', $11)`,
    [id, gkAssetId, priorState, nextState, reason, channel ?? null, externalReference ?? null,
      correlationId, occurredAt ?? null, recordedByPrincipalId, idempotencyKey]
  );
  return id;
}

// casEnroll — UNMANAGED -> AVAILABLE. Succeeds (returns the row) only
// when NO inventory_current_state row exists yet for this asset. The
// PRIMARY KEY + ON CONFLICT DO NOTHING makes this atomic against a
// concurrent double-enrollment the same way the UPDATE-based CAS
// functions below are atomic against a concurrent double-reservation.
export async function casEnroll(client, { gkAssetId, transitionEventId }) {
  const r = await client.query(
    `INSERT INTO data1_dev.inventory_current_state (gk_asset_id, state, as_of_transition_event_id, updated_at)
     VALUES ($1, 'AVAILABLE', $2, now())
     ON CONFLICT (gk_asset_id) DO NOTHING
     RETURNING gk_asset_id`,
    [gkAssetId, transitionEventId]
  );
  return r.rows[0] || null;
}

// casReserve — AVAILABLE -> RESERVED. Returns null if the row is
// missing (UNMANAGED) or not currently AVAILABLE (already RESERVED or
// SOLD) — the caller's transaction is then rolled back.
export async function casReserve(client, { gkAssetId, transitionEventId, channel, externalReference }) {
  const r = await client.query(
    `UPDATE data1_dev.inventory_current_state
     SET state = 'RESERVED', reserved_by_channel = $3, reserved_external_reference = $4,
         as_of_transition_event_id = $2, updated_at = now()
     WHERE gk_asset_id = $1 AND state = 'AVAILABLE'
     RETURNING gk_asset_id`,
    [gkAssetId, transitionEventId, channel ?? null, externalReference ?? null]
  );
  return r.rows[0] || null;
}

// casRelease — RESERVED -> AVAILABLE (legitimate cancellation).
export async function casRelease(client, { gkAssetId, transitionEventId }) {
  const r = await client.query(
    `UPDATE data1_dev.inventory_current_state
     SET state = 'AVAILABLE', reserved_by_channel = NULL, reserved_external_reference = NULL,
         as_of_transition_event_id = $2, updated_at = now()
     WHERE gk_asset_id = $1 AND state = 'RESERVED'
     RETURNING gk_asset_id`,
    [gkAssetId, transitionEventId]
  );
  return r.rows[0] || null;
}

// casMarkSold — (AVAILABLE|RESERVED) -> SOLD. Terminal: no function in
// this module ever transitions a row OUT of SOLD. Allows a direct
// AVAILABLE -> SOLD jump (skipping RESERVED) — the smallest legitimate
// sequence when no reservation was ever observed, never fabricated.
export async function casMarkSold(client, { gkAssetId, transitionEventId }) {
  const r = await client.query(
    `UPDATE data1_dev.inventory_current_state
     SET state = 'SOLD', reserved_by_channel = NULL, reserved_external_reference = NULL,
         as_of_transition_event_id = $2, updated_at = now()
     WHERE gk_asset_id = $1 AND state IN ('AVAILABLE', 'RESERVED')
     RETURNING gk_asset_id`,
    [gkAssetId, transitionEventId]
  );
  return r.rows[0] || null;
}

// getCurrentState — read-only. Returns null (meaning UNMANAGED — no row
// exists) rather than a literal 'UNMANAGED' string, so a caller that
// forgets to handle null cannot accidentally treat it as any other
// state either.
export async function getCurrentState(client, gkAssetId) {
  const r = await client.query('SELECT * FROM data1_dev.inventory_current_state WHERE gk_asset_id = $1', [gkAssetId]);
  return r.rows[0] || null;
}

export async function listTransitionHistory(client, gkAssetId) {
  const r = await client.query(
    'SELECT * FROM data1_dev.inventory_transition_event WHERE gk_asset_id = $1 ORDER BY occurred_at, id',
    [gkAssetId]
  );
  return r.rows;
}
