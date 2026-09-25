// src/modules/collection/repository.js — PRIVATE. SQL only, never
// imported outside src/modules/collection/ (enforced by
// tests/collection-module-boundary.test.js). Every query is
// schema-qualified (data1_dev.<table>) — GK-178 discipline, no
// `SET search_path` reliance anywhere in this module.

export async function assertPrincipalExists(client, principalId) {
  const res = await client.query('SELECT 1 FROM data1_dev.gk_principal WHERE id = $1', [principalId]);
  return res.rowCount > 0;
}

// GK-213B (Operator Authority, K3) — attributes is otherwise a deliberate
// FULL REPLACE (see updateItem's own comment below) — correct for every
// ordinary field (title, images, comps, etc.), but wrong for the small set
// of authority/provenance keys GK-213A/B place inside this same JSONB blob:
// an ordinary client write that legitimately omits these keys (any caller
// that doesn't know about them at all — "Add Photo," a stale client
// version, a future caller) must never be read as "delete the established
// authority." Presence-aware, same law as every client-side merge in
// src/lib/dataQualityGuard.js: a key ABSENT from the incoming attributes
// preserves whatever the existing row already had; a key PRESENT (even an
// explicit null, e.g. an intentional CLEAR) overwrites it. Every other key
// in `attributes` is untouched by this — still a genuine full replace.
// Enforced here, server-side, at the one real persistence boundary, rather
// than requiring every present and future client caller to remember to
// resend every authority field forever.
const PROTECTED_AUTHORITY_KEYS = [
  'identityAuthority',
  'modelPredictedGrade', 'modelPredictedGradeReason', 'modelPredictedGradeConfidence', 'modelPredictedAt',
  'operatorGrade', 'operatorGradeNumeric', 'operatorGradeSetAt', 'gradeAuthority',
  'operatorIsGraded', 'gradingFormatAuthority',
];

// `existingAttrsExpr` is a trusted SQL fragment (the current row's own
// `attributes` column reference — either the bare column name in an UPDATE,
// or `collection_item.attributes` inside an ON CONFLICT DO UPDATE, where the
// bare table name resolves to the pre-existing row). `incomingParam` is
// likewise a trusted SQL fragment (a bind parameter or EXCLUDED.attributes),
// never caller-supplied text — PROTECTED_AUTHORITY_KEYS is a fixed literal
// list, not user input, so building the key list into the query text here
// carries no injection risk.
function protectedAttributesMergeSql(existingAttrsExpr, incomingParam) {
  const pairs = PROTECTED_AUTHORITY_KEYS.map((k) => `'${k}', ${existingAttrsExpr}->'${k}'`).join(', ');
  return `(jsonb_strip_nulls(jsonb_build_object(${pairs})) || COALESCE(${incomingParam}::jsonb, '{}'::jsonb))`;
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
           attributes = ${protectedAttributesMergeSql('collection_item.attributes', 'EXCLUDED.attributes')},
           updated_at = now()
     RETURNING id, asset_category, attributes, created_at, updated_at`,
    [id, principalId, assetCategory, JSON.stringify(attributes)]
  );
  return toRow(res.rows[0]);
}

// Full replace of `attributes` for every ordinary field — mirrors the
// existing client-side IndexedDB putComic() semantics exactly (a
// whole-object store.put(), never a partial merge), so behavior stays
// identical whether a write lands locally or on the server. GK-213B (K3)
// carves out one narrow, explicit exception: PROTECTED_AUTHORITY_KEYS
// survive an incoming write that omits them (see that constant's own
// comment) — everything else in `attributes` remains a true full replace.
export async function updateItem(client, { id, principalId, assetCategory, attributes }) {
  const res = await client.query(
    `UPDATE data1_dev.collection_item
        SET asset_category = COALESCE($3, asset_category),
            attributes = ${protectedAttributesMergeSql('attributes', '$4')},
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

// GRAILKEY — COLLECTION IMAGE SYNC (2026-09-19). Deliberately NOT
// principal-scoped, unlike every other lookup in this file — used only
// by api/collection-image.js's display-image proxy, which authenticates
// by "server-side registration in a real collection_item row" rather
// than by caller identity (see that endpoint's own header for the full
// rationale: an id is a client-generated `cv_<timestamp>_<random>`
// value, not a secret, and this is the same "unguessable key, no
// further access control" trust model 'public' Blob access would have
// given directly, now routed through this proxy because the real
// Production Blob store turned out to be private-only). Returns ONLY
// the one string at attributes.remoteImages[index] — nothing else about
// the item, and never the raw `attributes` object.
export async function getRemoteImageUri(client, id, index) {
  const res = await client.query(
    `SELECT attributes->'remoteImages' AS remote_images FROM data1_dev.collection_item WHERE id = $1 LIMIT 1`,
    [id]
  );
  const arr = res.rows[0]?.remote_images;
  return Array.isArray(arr) && typeof arr[index] === 'string' ? arr[index] : null;
}
