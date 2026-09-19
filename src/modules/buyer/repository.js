// src/modules/buyer/repository.js — PRIVATE. The only file in this
// module permitted to issue raw SQL. Every query is schema-qualified
// (data1_dev.<table>), never a bare table reference — same GK-178
// pooled-connection session-state discipline every other module in this
// project follows.

const uuidv7 = async (client) => (await client.query('SELECT uuidv7() as id')).rows[0].id;

export async function assertPrincipalExists(client, principalId) {
  const r = await client.query('SELECT 1 FROM data1_dev.gk_principal WHERE id = $1', [principalId]);
  return r.rows.length > 0;
}

export async function getBuyerDecisionEventById(client, id) {
  const r = await client.query('SELECT * FROM data1_dev.buyer_decision_event WHERE id = $1', [id]);
  return r.rows[0] || null;
}

export async function insertBuyerDecisionEvent(client, {
  principalId, sessionId, gkAssetId,
  observedTitle, observedIssue, observedPublisher, observedYear, observedVariant, observedGrade,
  marketValueAmount, marketValueCurrency,
  contemplatedPriceAmount,
  feePct, suppliesAmount, laborAmount, targetProfitAmount,
  maxBuyAmount, netProfitAmount,
  decision,
  pricingSource, priceBandsSource, marketStanding,
  soldCompCount, activeCompCount, totalCompCount, verifiedCompCount,
  matchConfidenceTier, matchConfidenceScore,
  recordedByPrincipalId, occurredAt, idempotencyKey,
}) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.buyer_decision_event (
       id, principal_id, session_id, gk_asset_id,
       observed_title, observed_issue, observed_publisher, observed_year, observed_variant, observed_grade,
       market_value_amount, market_value_currency,
       contemplated_price_amount,
       fee_pct, supplies_amount, labor_amount, target_profit_amount,
       max_buy_amount, net_profit_amount,
       decision,
       pricing_source, price_bands_source, market_standing,
       sold_comp_count, active_comp_count, total_comp_count, verified_comp_count,
       match_confidence_tier, match_confidence_score,
       recorded_by_principal_id, occurred_at,
       idempotency_namespace, idempotency_key
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8, $9, $10,
       $11, $12,
       $13,
       $14, $15, $16, $17,
       $18, $19,
       $20,
       $21, $22, $23,
       $24, $25, $26, $27,
       $28, $29,
       $30, COALESCE($31, now()),
       'buyer-decision-sync', $32
     )`,
    [
      id, principalId, sessionId, gkAssetId ?? null,
      observedTitle ?? null, observedIssue ?? null, observedPublisher ?? null, observedYear ?? null, observedVariant ?? null, observedGrade ?? null,
      marketValueAmount, marketValueCurrency || 'USD',
      contemplatedPriceAmount,
      feePct, suppliesAmount, laborAmount, targetProfitAmount,
      maxBuyAmount ?? null, netProfitAmount ?? null,
      decision,
      pricingSource ?? null, priceBandsSource ?? null, marketStanding ?? null,
      soldCompCount ?? null, activeCompCount ?? null, totalCompCount ?? null, verifiedCompCount ?? null,
      matchConfidenceTier ?? null, matchConfidenceScore ?? null,
      recordedByPrincipalId, occurredAt ?? null,
      idempotencyKey,
    ]
  );
  return id;
}

export async function insertBuyerAcquisitionEvent(client, {
  buyerDecisionEventId, actualPurchasePriceAmount, actualPurchaseCurrency, gkAssetId,
  recordedByPrincipalId, occurredAt, idempotencyKey,
}) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.buyer_acquisition_event (
       id, buyer_decision_event_id, actual_purchase_price_amount, actual_purchase_currency, gk_asset_id,
       recorded_by_principal_id, occurred_at, idempotency_namespace, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), 'buyer-acquisition-sync', $8)`,
    [id, buyerDecisionEventId, actualPurchasePriceAmount, actualPurchaseCurrency || 'USD', gkAssetId ?? null, recordedByPrincipalId, occurredAt ?? null, idempotencyKey]
  );
  return id;
}

export async function listBuyerDecisionEventsByPrincipal(client, { principalId, limit, before }) {
  const params = [principalId];
  let where = 'principal_id = $1';
  if (before) {
    params.push(before);
    where += ` AND occurred_at < $${params.length}`;
  }
  params.push(Math.min(limit || 50, 200));
  const r = await client.query(
    `SELECT * FROM data1_dev.buyer_decision_event WHERE ${where} ORDER BY occurred_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

export async function listAcquisitionEventsForDecisions(client, decisionIds) {
  if (!decisionIds || decisionIds.length === 0) return [];
  const r = await client.query(
    `SELECT * FROM data1_dev.buyer_acquisition_event WHERE buyer_decision_event_id = ANY($1) ORDER BY occurred_at ASC`,
    [decisionIds]
  );
  return r.rows;
}
