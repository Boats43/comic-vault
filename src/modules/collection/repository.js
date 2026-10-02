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
  'modelPredictedGradeAt', 'modelPredictedProvenance',
  'operatorGrade', 'operatorGradeNumeric', 'operatorGradeSetAt', 'gradeAuthority',
  'operatorIsGraded', 'gradingFormatAuthority',
];

// GK-260 (Server-Owned Write Authority) — of the ten keys above, these six
// specifically get a STRONGER guarantee than the rest: an ordinary
// /api/collection write can never mint, overwrite, downgrade, OR clear
// them, whether the incoming attributes blob omits them, includes a forged
// value, or includes an explicit null. The EXISTING row's value always
// wins, unconditionally. This closes a real gap the omission-only
// protection below left open: a client could previously plant
// gradeAuthority:'OPERATOR_CONFIRMED' directly through this endpoint,
// which api/enrich.js's durable-row fallback (GK-213C) would then trust
// unconditionally on a later request — a forged-insertion path GK-260's
// own request-body fix never covered.
//
// (GK-261 below extends the same full immunity to the remaining keys.)
//
// The ONLY legitimate way to set/change/clear these six fields is now
// applyGradingAuthorityPatch below, called exclusively by api/enrich.js
// after a validated setOperatorGrade/clearOperatorGrade/
// setOperatorGradingFormat/clearOperatorGradingFormat call — never through
// this ordinary write path, regardless of what the caller sends here.
const FULLY_PROTECTED_GRADING_KEYS = [
  'operatorGrade', 'operatorGradeNumeric', 'operatorGradeSetAt', 'gradeAuthority',
  'operatorIsGraded', 'gradingFormatAuthority',
];

// GK-260 — for a genuine INSERT (no pre-existing row to fall back to at
// all, e.g. a brand-new collection_item), there is nothing legitimate for
// these six keys to inherit — they simply must never be settable via the
// ordinary create path either. Used directly in upsertItem's VALUES list
// (not just its ON CONFLICT branch, which alone left a real gap: a genuine
// first-insert bypassed protectedAttributesMergeSql entirely, since that
// function is only referenced inside the ON CONFLICT DO UPDATE clause).
// GK-261 (Server-Owned Model / Grade Authority) — the model-prediction
// baseline and identity authority get the SAME full immunity. The existing
// row's value always wins on UPDATE/ON CONFLICT; the keys are stripped from
// the INSERT VALUES list; an explicit null cannot clear them. They change
// ONLY through claimModelBaselinePatch (a server-claimed grade receipt,
// write-once) and applyIdentityAuthorityPatch (a validated manual
// correction, api/enrich.js). modelPredictedGradeAt is the dispatch's name
// for modelPredictedAt; both are protected so neither spelling can be forged.
// Historical rows keep whatever they already hold (existing wins) — they are
// preserved, not promoted and not rewritten.
const FULLY_PROTECTED_BASELINE_KEYS = [
  'identityAuthority',
  'modelPredictedGrade', 'modelPredictedGradeReason', 'modelPredictedGradeConfidence', 'modelPredictedAt',
  'modelPredictedGradeAt', 'modelPredictedProvenance',
];
const ALL_FULLY_PROTECTED_KEYS = [...FULLY_PROTECTED_GRADING_KEYS, ...FULLY_PROTECTED_BASELINE_KEYS];

function stripFullyProtectedGradingKeysSql(incomingParam) {
  const gradingKeysArray = `ARRAY[${ALL_FULLY_PROTECTED_KEYS.map((k) => `'${k}'`).join(', ')}]::text[]`;
  return `(COALESCE(${incomingParam}::jsonb, '{}'::jsonb) - ${gradingKeysArray})`;
}

// `existingAttrsExpr` is a trusted SQL fragment (the current row's own
// `attributes` column reference — either the bare column name in an UPDATE,
// or `collection_item.attributes` inside an ON CONFLICT DO UPDATE, where the
// bare table name resolves to the pre-existing row). `incomingParam` is
// likewise a trusted SQL fragment (a bind parameter or EXCLUDED.attributes),
// never caller-supplied text — PROTECTED_AUTHORITY_KEYS/
// FULLY_PROTECTED_GRADING_KEYS are fixed literal lists, not user input, so
// building the key lists into the query text here carries no injection risk.
function protectedAttributesMergeSql(existingAttrsExpr, incomingParam) {
  // GK-261: every key in PROTECTED_AUTHORITY_KEYS is now fully protected
  // (ALL_FULLY_PROTECTED_KEYS is a superset). Result = incoming minus every
  // protected key, plus the EXISTING row's protected entries copied exactly
  // (jsonb_each key-subset, NOT jsonb_strip_nulls, which is recursive and
  // would silently drop nested null keys inside a protected value such as
  // modelPredictedProvenance — "unknown stays null" must survive byte-for-byte).
  const keysArray = `ARRAY[${ALL_FULLY_PROTECTED_KEYS.map((k) => `'${k}'`).join(', ')}]::text[]`;
  return `(
    (COALESCE(${incomingParam}::jsonb, '{}'::jsonb) - ${keysArray})
    || (
      SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        FROM jsonb_each(COALESCE(${existingAttrsExpr}, '{}'::jsonb)) AS e
       WHERE e.key = ANY(${keysArray})
    )
  )`;
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
     VALUES ($1, $2, $3, ${stripFullyProtectedGradingKeysSql('$4')})
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

// GK-260 — the ONLY write path that may set/change/clear the six
// FULLY_PROTECTED_GRADING_KEYS. NOT a full replace, NOT the ordinary
// client-facing write (api/collection.js never calls this) — a targeted
// jsonb patch merge that touches only the caller-supplied keys, leaving
// every other attribute (title, images, price, comps, identityAuthority,
// modelPredictedGrade*, etc.) completely untouched, so there is no
// possible staleness/full-replace race with a concurrent ordinary write.
// `patch` is filtered to FULLY_PROTECTED_GRADING_KEYS ONLY — defense in
// depth against a future caller accidentally passing an unrelated field —
// the caller (src/modules/collection/service.js) is expected to have
// already built `patch` from a validated setOperatorGrade/
// clearOperatorGrade/setOperatorGradingFormat/clearOperatorGradingFormat
// result, never from raw client input directly.
export async function applyGradingAuthorityPatch(client, { id, principalId, patch }) {
  const safePatch = {};
  for (const key of FULLY_PROTECTED_GRADING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) safePatch[key] = patch[key];
  }
  const res = await client.query(
    `UPDATE data1_dev.collection_item
        SET attributes = COALESCE(attributes, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
      WHERE principal_id = $1 AND id = $2
      RETURNING id, asset_category, attributes, created_at, updated_at`,
    [principalId, id, JSON.stringify(safePatch)]
  );
  return res.rowCount > 0 ? toRow(res.rows[0]) : null;
}

// GK-261 — write-once model baseline from a server-claimed grade receipt.
// `baseline` must be claimGradeReceipt's own output (src/lib/gradeReceipt.js),
// never request-body fields. Filtered to the model-baseline keys as defense in
// depth, and the UPDATE is predicated on NO existing modelPredictedGrade, so a
// replay, a second receipt, or a legacy client-written baseline can never be
// overwritten. Returns { written, item } — written:false with a non-null item
// means the baseline already existed (idempotent no-op); item:null means no row.
const BASELINE_PATCH_KEYS = [
  'modelPredictedGrade', 'modelPredictedGradeReason', 'modelPredictedGradeConfidence', 'modelPredictedAt', 'modelPredictedProvenance',
];
export async function claimModelBaselinePatch(client, { id, principalId, baseline }) {
  const safe = {};
  for (const key of BASELINE_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(baseline || {}, key)) safe[key] = baseline[key];
  }
  const res = await client.query(
    `UPDATE data1_dev.collection_item
        SET attributes = COALESCE(attributes, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
      WHERE principal_id = $1 AND id = $2
        AND (attributes->>'modelPredictedGrade') IS NULL
      RETURNING id, asset_category, attributes, created_at, updated_at`,
    [principalId, id, JSON.stringify(safe)]
  );
  if (res.rowCount > 0) return { written: true, item: toRow(res.rows[0]) };
  return { written: false, item: await getByPrincipalAndId(client, principalId, id) };
}

// GK-261 — the ONLY write path for identityAuthority. `identityAuthority` is
// the facet->'OPERATOR_CONFIRMED' map api/enrich.js minted from a validated
// manual-correction request, already merged with the durable row's prior map.
export async function applyIdentityAuthorityPatch(client, { id, principalId, identityAuthority }) {
  const res = await client.query(
    `UPDATE data1_dev.collection_item
        SET attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('identityAuthority', $3::jsonb),
            updated_at = now()
      WHERE principal_id = $1 AND id = $2
      RETURNING id, asset_category, attributes, created_at, updated_at`,
    [principalId, id, JSON.stringify(identityAuthority || {})]
  );
  return res.rowCount > 0 ? toRow(res.rows[0]) : null;
}

// GK-278 -- row lock for the correction transaction: the before-state read, the
// mutation, and the correction-event insert all happen under this lock.
export async function lockItemAttributes(client, { id, principalId }) {
  const res = await client.query(
    `SELECT attributes FROM data1_dev.collection_item WHERE principal_id = $1 AND id = $2 FOR UPDATE`,
    [principalId, id]
  );
  return res.rowCount > 0 ? (res.rows[0].attributes || {}) : null;
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
