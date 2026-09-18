// src/modules/collection/repository.js — PRIVATE. SQL only, never
// imported outside src/modules/collection/ (enforced by
// tests/collection-module-boundary.test.js). Every query is
// schema-qualified (data1_dev.<table>) — GK-178 discipline, no
// `SET search_path` reliance anywhere in this module.

export async function assertPrincipalExists(client, principalId) {
  const res = await client.query('SELECT 1 FROM data1_dev.gk_principal WHERE id = $1', [principalId]);
  return res.rowCount > 0;
}

function toRow(dbRow) {
  return {
    id: dbRow.id,
    assetCategory: dbRow.asset_category,
    attributes: dbRow.attributes,
    createdAt: dbRow.created_at,
    updatedAt: dbRow.updated_at,
  };
}

export async function listByPrincipal(client, principalId) {
  const res = await client.query(
    `SELECT id, asset_category, attributes, created_at, updated_at
       FROM data1_dev.collection_item
      WHERE principal_id = $1
      ORDER BY updated_at DESC`,
    [principalId]
  );
  return res.rows.map(toRow);
}

export async function getByPrincipalAndId(client, principalId, id) {
  const res = await client.query(
    `SELECT id, asset_category, attributes, created_at, updated_at
       FROM data1_dev.collection_item
      WHERE principal_id = $1 AND id = $2`,
    [principalId, id]
  );
  return res.rowCount > 0 ? toRow(res.rows[0]) : null;
}

// Upsert-as-create: same (principalId, id) replayed with the same or
// different attributes is always a safe, idempotent write — never a
// duplicate row, never a raw constraint-violation error surfaced to the
// caller. A collision on the SAME id for the SAME principal can only
// realistically happen via a genuine client retry (the id is a
// client-generated `cv_<timestamp>_<random>` value) — there is no
// separate request-fingerprint ledger here (unlike the Asset Service's
// class-wide GK-163 law); this is a plain CRUD resource, not an
// event-sourced ledger, and a same-principal self-overwrite carries no
// cross-account risk.
export async function upsertItem(client, { id, principalId, assetCategory, attributes }) {
  const res = await client.query(
    `INSERT INTO data1_dev.collection_item (id, principal_id, asset_category, attributes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (principal_id, id) DO UPDATE
       SET asset_category = EXCLUDED.asset_category,
           attributes = EXCLUDED.attributes,
           updated_at = now()
     RETURNING id, asset_category, attributes, created_at, updated_at`,
    [id, principalId, assetCategory, JSON.stringify(attributes)]
  );
  return toRow(res.rows[0]);
}

// Full replace of `attributes` — mirrors the existing client-side
// IndexedDB putComic() semantics exactly (a whole-object store.put(),
// never a partial merge), so behavior stays identical whether a write
// lands locally or on the server.
export async function updateItem(client, { id, principalId, assetCategory, attributes }) {
  const res = await client.query(
    `UPDATE data1_dev.collection_item
        SET asset_category = COALESCE($3, asset_category),
            attributes = $4,
            updated_at = now()
      WHERE principal_id = $1 AND id = $2
      RETURNING id, asset_category, attributes, created_at, updated_at`,
    [principalId, id, assetCategory ?? null, JSON.stringify(attributes)]
  );
  return res.rowCount > 0 ? toRow(res.rows[0]) : null;
}

export async function deleteItem(client, principalId, id) {
  const res = await client.query(
    `DELETE FROM data1_dev.collection_item WHERE principal_id = $1 AND id = $2`,
    [principalId, id]
  );
  return res.rowCount > 0;
}
