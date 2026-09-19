#!/usr/bin/env node
/**
 * ingest-outcome1-financials — GRAILKEY: BUYER DECISION DURABILITY +
 * AUTOMATIC OUTCOME INGESTION, item 4. The smallest automatic pipeline
 * from a real eBay ItemID that ALREADY HAS a durable SOLD outcome_event
 * (written by scripts/observe-outcome1-listing.mjs from real Trading API
 * GetItem data) to the real financial facts behind that sale: order
 * linkage, marketplace fees, shipping-label cost, refunds/credits — via
 * eBay's Fulfillment + Finances REST APIs (User OAuth, GK-214).
 *
 * WHAT THIS SCRIPT WILL NEVER DO:
 *   - Never determine SOLD itself, and never mark SOLD merely because a
 *     Fulfillment order exists or a listing can no longer be found — SOLD
 *     determination remains exclusively observe-outcome1-listing.mjs's
 *     job (real Trading API GetItem, QuantitySold>0 on a Completed
 *     listing). This script REQUIRES a real SOLD outcome_event row to
 *     already exist for the given ItemID and aborts, with no write at
 *     all, if one does not.
 *   - Never fabricate a fee/shipping/refund/credit component the real
 *     Fulfillment/Finances API response did not actually contain. An
 *     absent field is skipped, never defaulted to $0.
 *   - Never write the same real economic fact twice. idempotencyKey is
 *     derived from eBay's own transactionId/orderId (src/lib/
 *     ebayFulfillmentFinances.js's normalizeTransactionToComponents), so
 *     a repeated run naturally no-ops via recordEconomicsComponent's own
 *     class-wide idempotency law (GK-163: same key + same payload =
 *     silent replay, same key + different payload = IdempotencyConflictError).
 *   - Never make an eBay WRITE call anywhere in this script — Fulfillment
 *     order list/get and Finances transaction list are GET-only.
 *   - Never touch api/list-ebay.js's Trading API listing path, GK-207's
 *     linkage gate, or pricing/comps math.
 *
 * DISCLOSURE: this script has NOT been run against a real order as of
 * this dispatch — Creepy #1 (the only real Outcome #1 listing) ended
 * DELISTED/unsold (GK-209/GK-210), so no real Fulfillment order or
 * Finances transaction currently exists to ingest. This is real,
 * runnable code proven by tests/ebay-fulfillment-finances-ingestion.test.js
 * (mocked eBay responses) and by static/idempotency-derivation proofs
 * only — end-to-end proof against a real sale is still open, pending a
 * real SOLD outcome.
 *
 * GRAILKEY AUTOMATIC EBAY OUTCOME RECONCILER V1 (2026-09-20) —
 * superseded in AUTHORITY, kept FUNCTIONAL: scripts/reconcile-ebay-
 * outcome.mjs now owns SOLD determination via real Fulfillment-order
 * evidence (stronger than this script's own prerequisite, a GetItem-
 * QuantitySold-based SOLD row from observe-outcome1-listing.mjs) and
 * shares its transaction-ingestion loop with this script via
 * src/lib/ebayOutcomeReconciler.js's ingestFinancialTransactionsForOutcome
 * — ONE ingestion implementation, not two. This script remains useful
 * standalone for manually attaching financials to an outcome already
 * marked SOLD through the legacy GetItem path. Also fixed this pass: a
 * real bug where the PredictionError call below read
 * `economics.realizedGross` (undefined — getOutcomeEconomics returns
 * `gross`, never `realizedGross`) and so ALWAYS scored CENSORED/unscored
 * regardless of real data; now reads the correct field and gates on
 * `hasAnyComponent`, matching src/lib/ebayOutcomeReconciler.js's own
 * classifyEconomicsCompleteness()/scoreOutcomePrediction() logic exactly.
 *
 * Usage: node scripts/ingest-outcome1-financials.mjs <ExternalListingId>
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

for (const v of ['GRAILKEY_CATALOG_DATABASE_URL', 'GRAILKEY_CATALOG_ENVIRONMENT', 'EBAY_APP_ID', 'EBAY_CERT_ID', 'EBAY_OAUTH_RUNAME', 'EBAY_USER_REFRESH_TOKEN']) {
  if (process.env[v]) continue;
  try {
    const text = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
    const m = text.match(new RegExp(`^${v}=(.+)$`, 'm'));
    if (m) process.env[v] = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* env file optional — real deploys supply these via Vercel env */ }
}

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { recordEconomicsComponent, getOutcomeEconomics } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { refreshUserAccessToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
const { findOrderByLegacyItemId } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayFulfillmentFinances.js')).href);
const { ingestFinancialTransactionsForOutcome, classifyEconomicsCompleteness } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayOutcomeReconciler.js')).href);
const { scorePrediction } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'predictionErrorScoring.js')).href);

const itemId = process.argv[2];
if (!itemId) {
  console.error('Usage: node scripts/ingest-outcome1-financials.mjs <ExternalListingId>');
  process.exit(1);
}

const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'ingest-outcome1-financials' });

console.log(`\n=== Outcome #1 automatic financials ingestion: ItemID ${itemId} ===\n`);

// 1. Require a real, already-durable SOLD row. Never determined here.
const rows = (await client.query(
  `SELECT * FROM data1_dev.outcome_event WHERE external_listing_id = $1 ORDER BY occurred_at`,
  [itemId]
)).rows;
const soldRow = rows.find((r) => r.outcome_type === 'SOLD');
if (!soldRow) {
  console.error(
    `No durable SOLD outcome_event exists for ItemID ${itemId}. This script never determines SOLD itself — ` +
    `run scripts/observe-outcome1-listing.mjs first. Aborting, no write.`
  );
  await client.end();
  process.exit(1);
}
const listedRow = rows.find((r) => r.outcome_type === 'LISTED');
console.log(`Durable SOLD row: ${soldRow.id} (gkAssetId ${soldRow.gk_asset_id}, occurred_at ${soldRow.occurred_at?.toISOString?.() || soldRow.occurred_at})`);

// 2. What economics already exist for this outcome_event (informational —
//    real dedup happens inside recordEconomicsComponent via idempotencyKey,
//    this is only used to skip a redundant 'gross' write, see below).
const existingComponents = (await client.query(
  `SELECT component_type, source_reference FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1`,
  [soldRow.id]
)).rows;
console.log(`Existing economics components on this outcome_event: ${existingComponents.length} (${existingComponents.map((c) => c.component_type).join(', ') || 'none'})`);

// 3. Real eBay User OAuth token — never printed, never logged.
let accessToken;
try {
  const refreshToken = process.env.EBAY_USER_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('EBAY_USER_REFRESH_TOKEN is not set — see GK-214, the User OAuth consent has already been completed once; the resulting refresh token must be supplied via env, never re-derived here.');
  ({ accessToken } = await refreshUserAccessToken(refreshToken));
} catch (e) {
  console.error(`\nCould not obtain a real eBay User access token: ${e.message}`);
  await client.end();
  process.exit(1);
}

// 4. Find the real Fulfillment order for this ItemID — a real order search
//    window centered on the SOLD row's own occurred_at (never guessed wider
//    than necessary). No match is not an error — the order may not exist
//    yet, or may have posted outside this window.
const soldAt = new Date(soldRow.occurred_at);
const sinceIso = new Date(soldAt.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
const untilIso = new Date(soldAt.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

let order = null;
try {
  order = await findOrderByLegacyItemId({ accessToken, legacyItemId: itemId, sinceIso, untilIso });
} catch (e) {
  console.error(`\nFulfillment order lookup failed: ${e.message}`);
  await client.end();
  process.exit(1);
}
if (!order) {
  console.log(`\nNo matching Fulfillment order found for ItemID ${itemId} in window [${sinceIso}..${untilIso}]. No write — a real order may not exist yet, or fell outside this window. Safe to re-run later.`);
  await client.end();
  process.exit(0);
}
console.log(`\nReal Fulfillment order found: ${order.orderId}`);

// 5. order_reference component — idempotent by the real orderId, never a
//    second row for the same order on a repeated run.
const orderRefResult = await recordEconomicsComponent({
  principalId: soldRow.recorded_by_principal_id,
  outcomeEventId: soldRow.id,
  componentType: 'order_reference',
  amount: null,
  source: 'api-sourced',
  sourceReference: `eBay Fulfillment order ${order.orderId}`,
  externalOrderId: order.orderId,
  idempotencyKey: `outcome1-finances-${order.orderId}-order-reference`,
});
console.log(`order_reference recorded/replayed: ${orderRefResult.componentId}`);

// 6. Real Finances transactions for this real order — shared ingestion
//    loop (src/lib/ebayOutcomeReconciler.js), the SAME one
//    scripts/reconcile-ebay-outcome.mjs uses, so there is exactly one
//    transaction-ingestion implementation in this repo, not two.
const ingestResult = await ingestFinancialTransactionsForOutcome({
  principalId: soldRow.recorded_by_principal_id, outcomeEventId: soldRow.id, orderId: order.orderId, accessToken,
});
if (ingestResult.error) {
  console.error(`\nFinances transaction lookup failed: ${ingestResult.error}`);
  await client.end();
  process.exit(1);
}
console.log(`\n${ingestResult.transactionsSeen} real Finances transaction(s) seen; ${ingestResult.written} component write(s) attempted (idempotent — reruns will not duplicate); ${ingestResult.skippedGross} gross candidate(s) skipped as already-recorded.`);
if (ingestResult.transactionsSeen === 0) {
  console.log('Order found but zero Finances transactions returned yet (fees/payout can post days after a sale). Safe to re-run later.');
}

// 7. Prediction error — reuses the existing pure scorer exactly, computed
//    and logged only; no new persistence, matching predictionErrorScoring.js's
//    own no-I/O contract. Gated on real hasAnyComponent evidence — fixed
//    this pass, see file header ("Also fixed this pass").
if (listedRow) {
  const predicted = (await client.query(
    `SELECT value_amount FROM data1_dev.valuation_event WHERE asset_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
    [soldRow.gk_asset_id]
  )).rows[0];
  const economics = await getOutcomeEconomics({ principalId: soldRow.recorded_by_principal_id, outcomeEventId: soldRow.id });
  const economicsStatus = classifyEconomicsCompleteness(economics);
  if (economicsStatus === 'PENDING') {
    console.log('\nPrediction error not computed — sale confirmed but no realized-gross economics component recorded yet (ECONOMICS_PENDING, distinct from CENSORED).');
  } else if (predicted?.value_amount != null && listedRow.ask_amount != null) {
    const scored = scorePrediction({
      predictedValue: parseFloat(predicted.value_amount),
      askAmount: parseFloat(listedRow.ask_amount),
      realizedGross: economics.gross,
      // Only a real, both-gross-and-fees-known 'KNOWN' economics state
      // may report a net — otherwise a still-missing fee would silently
      // COALESCE to $0 inside economics.realizedNet, a fabrication.
      realizedNet: economicsStatus === 'KNOWN' ? economics.realizedNet : null,
      listedAt: listedRow.occurred_at,
      realizedAt: soldRow.occurred_at,
      isCensored: false,
    });
    console.log(`\nPrediction error (${scored.status}): gross ${scored.grossSignedError != null ? `$${scored.grossSignedError.toFixed(2)} (${scored.grossPercentError.toFixed(1)}%)` : 'unscored'}, net ${scored.netSignedError != null ? `$${scored.netSignedError.toFixed(2)} (${scored.netPercentError.toFixed(1)}%)` : 'unscored (fees/shipping not yet fully known)'}`);
  } else {
    console.log('\nPrediction error not computed — no valuation_event row found for this asset yet.');
  }
}

await client.end();
