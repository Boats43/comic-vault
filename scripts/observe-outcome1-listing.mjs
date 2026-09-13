#!/usr/bin/env node
/**
 * observe-outcome1-listing — GK-209 Outcome #1 CLOSER. The smallest
 * idempotent lifecycle observer around an existing real eBay listing.
 *
 * WHO TRIGGERS THIS, AND WHEN (documented here, per this dispatch's own
 * "Observation Cadence" instruction):
 *   - The operator (Jimmy) runs this manually, any time, via
 *     `node scripts/observe-outcome1-listing.mjs <ItemID>`.
 *   - The immediate trigger is Jimmy's own real eBay sale/order email —
 *     run this PROMPTLY after that notification so the observation's
 *     own occurred_at (and thus actual time-to-sale) is anchored to
 *     eBay's real listing/order timestamps, not the moment Jimmy
 *     happened to notice the email.
 *   - If no earlier terminal event occurs, the mandatory cutoff
 *     observation is whatever next_observation_due_at the LATEST real
 *     outcome_event row for this listing currently holds (for Creepy,
 *     2026-10-13T04:20:23Z at the time this script was written — always
 *     re-derive from the live row, never hardcode).
 *   - AUTHORITATIVE TIMESTAMP: eBay's own StartTime/EndTime (via
 *     GetItem), never local wall-clock/poll time, for anything that
 *     becomes "actual time-to-sale." Poll/observation time is used only
 *     to decide WHETHER to observe, never to compute WHEN something
 *     eBay-side actually happened.
 *   - No background watcher, no webhook, no cron — a single manual
 *     invocation per real check is the entire cadence for one listing.
 *     See docs/TICKET-REGISTRY.md, GK-209, for the documented (not
 *     built) future upgrade to eBay Marketplace Account Deletion/Order
 *     notifications once real volume justifies it.
 *
 * WHAT THIS SCRIPT WILL NEVER DO:
 *   - Never write a second LISTED row for an ItemID that already has one.
 *   - Never write a SOLD row unless eBay's own GetItem response says
 *     QuantitySold > 0 for a real, Ended listing — never inferred from
 *     an Active listing "probably" having sold.
 *   - Never write ACTIVE_AT_CUTOFF for a listing observed BEFORE its
 *     own next_observation_due_at has actually passed.
 *   - Never make any eBay WRITE call — GetItem only.
 *
 * Usage: node scripts/observe-outcome1-listing.mjs <ExternalListingId>
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

for (const v of ['GRAILKEY_CATALOG_DATABASE_URL', 'GRAILKEY_CATALOG_ENVIRONMENT', 'EBAY_APP_ID', 'EBAY_CERT_ID', 'EBAY_DEV_ID', 'EBAY_AUTH_TOKEN']) {
  if (process.env[v]) continue;
  const text = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
  const m = text.match(new RegExp(`^${v}=(.+)$`, 'm'));
  if (m) process.env[v] = m[1].trim().replace(/^["']|["']$/g, '');
}

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { recordOutcomeEvent, recordEconomicsComponent } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

const xmlEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const extractTag = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
};

async function getItemReadOnly(itemId) {
  const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID, EBAY_AUTH_TOKEN } = process.env;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${xmlEscape(EBAY_AUTH_TOKEN)}</eBayAuthToken></RequesterCredentials>
  <ItemID>${xmlEscape(itemId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;
  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
      'X-EBAY-API-DEV-NAME': EBAY_DEV_ID,
      'X-EBAY-API-APP-NAME': EBAY_APP_ID,
      'X-EBAY-API-CERT-NAME': EBAY_CERT_ID,
      'X-EBAY-API-SITEID': '0',
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': 'GetItem',
    },
    body: xml,
  });
  const text = await res.text();
  const ack = extractTag(text, 'Ack');
  if (!ack || /Failure/i.test(ack)) {
    throw new Error(`GetItem failed (ack=${ack}): ${extractTag(text, 'ShortMessage') || extractTag(text, 'LongMessage') || 'unknown error'}`);
  }
  // GK-209 correction: there is no top-level <SellingState> tag in a
  // real GetItem response — the real field is <SellingStatus>
  // <ListingStatus>, whose real values are "Active" / "Completed" /
  // "Custom" / "Ended". Verified directly against the real Creepy
  // response (previously mis-extracted, caught and fixed same pass —
  // see GK-209 in docs/TICKET-REGISTRY.md for the full account).
  const sellingStatusBlock = (text.match(/<SellingStatus>([\s\S]*?)<\/SellingStatus>/) || [])[1] || '';
  const listingDetailsBlock = (text.match(/<ListingDetails>([\s\S]*?)<\/ListingDetails>/) || [])[1] || '';
  return {
    listingStatus: extractTag(sellingStatusBlock, 'ListingStatus'),
    currentPrice: (sellingStatusBlock.match(/<CurrentPrice[^>]*>([\s\S]*?)<\/CurrentPrice>/) || [])[1],
    quantitySold: parseInt(extractTag(sellingStatusBlock, 'QuantitySold') || '0', 10),
    startTime: extractTag(listingDetailsBlock, 'StartTime'),
    endTime: extractTag(listingDetailsBlock, 'EndTime'),
    listingDuration: extractTag(text, 'ListingDuration'),
    endingReason: extractTag(listingDetailsBlock, 'EndingReason'),
  };
}

const itemId = process.argv[2];
if (!itemId) {
  console.error('Usage: node scripts/observe-outcome1-listing.mjs <ExternalListingId>');
  process.exit(1);
}

const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'observe-outcome1-listing' });

console.log(`\n=== Outcome #1 lifecycle observation: ItemID ${itemId} ===\n`);

// Read the durable LISTED row (and any later observations already
// recorded) for this ItemID — read-only, informs the decision below,
// never mutated.
const rows = (await client.query(
  `SELECT * FROM data1_dev.outcome_event WHERE external_listing_id = $1 ORDER BY occurred_at`,
  [itemId]
)).rows;
const listedRow = rows.find(r => r.outcome_type === 'LISTED');
if (!listedRow) {
  console.error(`No durable LISTED outcome_event exists for ItemID ${itemId} — nothing to observe against. Aborting, no write.`);
  await client.end();
  process.exit(1);
}
const alreadySold = rows.some(r => r.outcome_type === 'SOLD');
const latestRow = rows[rows.length - 1];
const currentCutoff = latestRow.next_observation_due_at;

console.log(`Durable LISTED row: ${listedRow.id} (gkAssetId ${listedRow.gk_asset_id}, ask $${listedRow.ask_amount})`);
console.log(`Existing observation rows so far: ${rows.length} (${rows.map(r => r.outcome_type).join(', ')})`);
console.log(`Current persisted observation cutoff: ${currentCutoff?.toISOString?.() || currentCutoff}`);

const real = await getItemReadOnly(itemId);
console.log(`\nReal eBay GetItem result: listingStatus=${real.listingStatus} endingReason=${real.endingReason} quantitySold=${real.quantitySold} currentPrice=${real.currentPrice} endTime=${real.endTime} listingDuration=${real.listingDuration}`);

const now = new Date();
const cutoffPassed = currentCutoff && now >= new Date(currentCutoff);

let action = null;
if (real.listingStatus === 'Completed' && real.quantitySold > 0) {
  action = 'SOLD';
} else if (real.listingStatus === 'Completed' && real.quantitySold === 0) {
  // GTC listings have no natural fixed-duration expiration — an Ended,
  // unsold GTC listing was manually ended by the seller. A non-GTC
  // listing ending unsold is a natural expiration. This is a disclosed
  // simplification (eBay's own EndingReason taxonomy is more nuanced
  // than this single split) sufficient for this single-listing pass.
  action = real.listingDuration === 'GTC' ? 'DELISTED' : 'EXPIRED_UNSOLD';
} else if (real.listingStatus === 'Active' && cutoffPassed) {
  action = 'ACTIVE_AT_CUTOFF';
} else if (real.listingStatus === 'Active') {
  console.log(`\nStill ACTIVE, and the observation cutoff (${currentCutoff?.toISOString?.() || currentCutoff}) has not passed yet. No write — nothing terminal or censored to record. Next required observation: ${currentCutoff?.toISOString?.() || currentCutoff}.`);
  await client.end();
  process.exit(0);
} else {
  console.log(`\nUnrecognized real state (listingStatus=${real.listingStatus} endingReason=${real.endingReason}) — no write, manual review needed.`);
  await client.end();
  process.exit(1);
}

if (action === 'SOLD' && alreadySold) {
  console.log('\nA SOLD row already exists for this listing — not writing a second one (idempotent no-op).');
  await client.end();
  process.exit(0);
}

console.log(`\nDetermined action: ${action}`);

const occurredAt = action === 'SOLD' ? (real.endTime ? new Date(real.endTime) : now)
  : action === 'DELISTED' || action === 'EXPIRED_UNSOLD' ? (real.endTime ? new Date(real.endTime) : now)
  : now; // ACTIVE_AT_CUTOFF — the observation instant itself IS the censoring timestamp

const daysToSale = action === 'SOLD'
  ? (occurredAt.getTime() - new Date(listedRow.occurred_at).getTime()) / (24 * 60 * 60 * 1000)
  : null;

// Idempotency key: stable for the SAME real-world state observed on the
// SAME calendar day (re-running today's check twice never duplicates),
// but a genuinely later cutoff (a new calendar boundary) or a real state
// change (Active -> Sold) always produces a new key.
const dateStamp = occurredAt.toISOString().slice(0, 10);
const idempotencyKey = `outcome1-observe-${itemId}-${action}-${dateStamp}`;

// Next observation horizon: for ACTIVE_AT_CUTOFF, the listing (GTC)
// has already silently renewed — set the next horizon 30 days out from
// THIS observation, same policy constant as the original LISTED write.
const nextObservationDueAt = action === 'ACTIVE_AT_CUTOFF'
  ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  : null;

const result = await recordOutcomeEvent({
  principalId: listedRow.recorded_by_principal_id,
  gkAssetId: listedRow.gk_asset_id,
  decisionEventId: listedRow.decision_event_id,
  operatorActionEventId: listedRow.operator_action_event_id,
  outcomeType: action,
  channel: listedRow.channel,
  externalListingId: itemId,
  askAmount: null,
  grossAmount: action === 'SOLD' && real.currentPrice ? parseFloat(real.currentPrice) : null,
  daysToSale,
  nextObservationDueAt,
  idempotencyKey,
  occurredAt,
});
console.log(`\nDurable ${action} outcome_event recorded: ${result.outcomeEventId}`);

if (action === 'SOLD' && real.currentPrice) {
  const econ = await recordEconomicsComponent({
    principalId: listedRow.recorded_by_principal_id,
    outcomeEventId: result.outcomeEventId,
    componentType: 'gross',
    amount: parseFloat(real.currentPrice),
    source: 'api-sourced',
    sourceReference: `eBay GetItem CurrentPrice, ItemID ${itemId}`,
    idempotencyKey: `${idempotencyKey}-gross-component`,
    occurredAt,
  });
  console.log(`Real, api-sourced gross economics component recorded: ${econ.componentId}`);
  console.log('NOTE: fees/shipping/refunds are NOT yet recorded — those require the Finances API (OAuth-gated) or a manual operator entry (api/outcome-economics.js). Realized net remains unscoreable until at least one fees/shipping component exists.');
}

if (action === 'ACTIVE_AT_CUTOFF') {
  console.log(`\nNext required observation: ${nextObservationDueAt.toISOString()}`);
}

await client.end();
