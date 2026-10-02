// src/modules/learning/repository.js -- PRIVATE. SQL only. Every query is
// schema-qualified (data1_dev.<table>). Both tables are append-only (0035
// triggers); this file has no UPDATE or DELETE against them, by design.

export async function insertPredictionEvent(client, e) {
  // ON CONFLICT on the (principal, surface, result) identity: a replay of the same
  // inference result never creates a second row. The caller compares payload_hash.
  const res = await client.query(
    `INSERT INTO data1_dev.model_prediction_event
       (principal_id, surface, result_id, provider, model, model_version, prompt_version, build_sha,
        input_hash, prediction, payload_hash, usage, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13)
     ON CONFLICT (principal_id, surface, result_id) DO NOTHING
     RETURNING id`,
    [e.principalId, e.surface, e.resultId, e.provider, e.model, e.modelVersion, e.promptVersion, e.buildSha,
     e.inputHash, JSON.stringify(e.prediction), e.payloadHash, e.usage ? JSON.stringify(e.usage) : null, e.idempotencyKey]
  );
  return res.rowCount > 0 ? { id: res.rows[0].id, replayed: false } : null;
}

export async function getPredictionEventByResult(client, { principalId, surface, resultId }) {
  const res = await client.query(
    `SELECT id, payload_hash FROM data1_dev.model_prediction_event WHERE principal_id = $1 AND surface = $2 AND result_id = $3`,
    [principalId, surface, resultId]
  );
  return res.rows[0] || null;
}

export async function getPredictionEvent(client, { principalId, id }) {
  const res = await client.query(
    `SELECT id, principal_id, surface, result_id, provider, model, model_version, prompt_version, build_sha,
            input_hash, prediction, payload_hash, usage, idempotency_key, created_at
       FROM data1_dev.model_prediction_event WHERE principal_id = $1 AND id = $2`,
    [principalId, id]
  );
  return res.rows[0] || null;
}

// Newest prior correction for the same item+surface -- becomes part of the next
// event's idempotency key so a genuine SET -> CLEAR -> SET sequence is three events
// while a concurrent duplicate collapses (the caller holds the item row lock).
export async function getLatestCorrectionEventId(client, { principalId, collectionItemId, surface }) {
  const res = await client.query(
    `SELECT id FROM data1_dev.operator_correction_event
      WHERE principal_id = $1 AND collection_item_id = $2 AND surface = $3
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [principalId, collectionItemId, surface]
  );
  return res.rows[0]?.id ?? null;
}

export async function insertCorrectionEvent(client, e) {
  const res = await client.query(
    `INSERT INTO data1_dev.operator_correction_event
       (principal_id, collection_item_id, gk_asset_id, surface, action, before_value, after_value,
        authority_before, authority_after, related_prediction_event_id, source, reason, build_sha, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)
     ON CONFLICT (principal_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [e.principalId, e.collectionItemId, e.gkAssetId, e.surface, e.action,
     JSON.stringify(e.beforeValue), JSON.stringify(e.afterValue),
     JSON.stringify(e.authorityBefore), JSON.stringify(e.authorityAfter),
     e.relatedPredictionEventId, e.source, e.reason, e.buildSha, e.idempotencyKey]
  );
  return res.rowCount > 0 ? res.rows[0].id : null;
}

export async function listCorrectionEvents(client, { principalId, collectionItemId }) {
  const res = await client.query(
    `SELECT id, surface, action, before_value, after_value, authority_before, authority_after,
            related_prediction_event_id, gk_asset_id, source, build_sha, created_at
       FROM data1_dev.operator_correction_event
      WHERE principal_id = $1 AND collection_item_id = $2
      ORDER BY created_at ASC, id ASC`,
    [principalId, collectionItemId]
  );
  return res.rows;
}
