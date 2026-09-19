#!/usr/bin/env node
/**
 * reconcile-ebay-outcome — GRAILKEY AUTOMATIC EBAY OUTCOME RECONCILER V1.
 * Manual/local CLI entry point over src/lib/ebayOutcomeReconciler.js's
 * reconcileEbayOutcome() — the SAME function api/ebay-outcome-reconciler.js
 * (the authenticated HTTP surface) calls. One reconciler, two entry
 * points, zero duplicated logic.
 *
 * SOLD EVIDENCE RULE: a listing disappearing/ending/becoming unavailable
 * is never sufficient evidence of SOLD. This script only ever marks SOLD
 * from a real Fulfillment order with a confirmed, non-cancelled payment
 * state (src/lib/ebayFulfillmentFinances.js's evaluateOrderSaleEvidence).
 *
 * Safe to run repeatedly for the same ItemID at any point in its
 * lifecycle — idempotent throughout (GK-163 class-wide law on every
 * write; a listing already SOLD is enriched, never re-marked; a listing
 * already DELISTED/EXPIRED_UNSOLD is never re-evaluated for SOLD).
 * GET-only against eBay — zero marketplace writes.
 *
 * Usage: node scripts/reconcile-ebay-outcome.mjs <ExternalListingId> [--lookback-days=180]
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
const { refreshUserAccessToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
const { reconcileEbayOutcome, DEFAULT_LOOKBACK_DAYS } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayOutcomeReconciler.js')).href);
const { closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

const itemId = process.argv[2];
const lookbackArg = process.argv.find((a) => a.startsWith('--lookback-days='));
const lookbackDays = lookbackArg ? parseInt(lookbackArg.split('=')[1], 10) : DEFAULT_LOOKBACK_DAYS;

if (!itemId) {
  console.error('Usage: node scripts/reconcile-ebay-outcome.mjs <ExternalListingId> [--lookback-days=180]');
  process.exit(1);
}

const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'reconcile-ebay-outcome' });

console.log(`\n=== eBay Outcome Reconciler: ItemID ${itemId} (lookback ${lookbackDays}d) ===\n`);

try {
  // Diagnostic read only, to derive principalId/gkAssetId for this
  // listing — reconcileEbayOutcome itself re-derives everything through
  // the real, ownership-checked assets module read path, never trusts
  // this lookup as authorization.
  const listedRow = (await client.query(
    `SELECT gk_asset_id, recorded_by_principal_id FROM data1_dev.outcome_event WHERE external_listing_id = $1 AND outcome_type = 'LISTED' LIMIT 1`,
    [itemId]
  )).rows[0];
  if (!listedRow) {
    console.error(`No durable LISTED outcome_event exists for ItemID ${itemId}. Nothing to reconcile. Aborting, no write.`);
    process.exit(1);
  }

  let accessToken;
  try {
    const refreshToken = process.env.EBAY_USER_REFRESH_TOKEN;
    if (!refreshToken) throw new Error('EBAY_USER_REFRESH_TOKEN is not set (GK-214).');
    ({ accessToken } = await refreshUserAccessToken(refreshToken));
  } catch (e) {
    console.error(`\nCould not obtain a real eBay User access token: ${e.message}`);
    process.exit(1);
  }

  const result = await reconcileEbayOutcome({
    principalId: listedRow.recorded_by_principal_id,
    gkAssetId: listedRow.gk_asset_id,
    externalListingId: itemId,
    accessToken,
    lookbackDays,
  });

  console.log(JSON.stringify(result, null, 2));
  console.log(`\n=== status: ${result.status} ===`);
} finally {
  await client.end();
  await closePool();
}
