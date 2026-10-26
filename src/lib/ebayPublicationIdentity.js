// src/lib/ebayPublicationIdentity.js — GK-P0 PROVIDER IDEMPOTENCY (2026-10-26).
//
// eBay Trading API AddFixedPriceItem accepts Item.UUID: exactly 32 characters, digits 0-9 and letters A-F
// (developer.ebay.com UUIDType). A second AddFixedPriceItem carrying a UUID that already created a listing is
// refused with error 488 "Duplicate UUID used." instead of creating another listing, and eBay's own guidance
// (KB 1462) is to resend the SAME UUID after a lost response. That makes the UUID the PROVIDER-SIDE
// idempotency key — but only if it is identical across every retry of the same logical publication, including
// after a crash. A freshly generated id per request would defeat it.
//
// DURABLE IDENTITY WITHOUT A NEW TABLE. The READY path writes no attempt row, so the UUID is a pure function of
// facts that are already durable and monotonic:
//     uuid = sha256("grailkey-ebay-publication-v1|<gkAssetId>|<channel>|<generation>")  (first 32 hex, uppercase)
// where generation = the number of DISTINCT listings of this asset on this channel that have reached a terminal
// outcome (SOLD / DELISTED / EXPIRED_UNSOLD) in the outcome_event ledger.
//   * A crash, a lost response or a new HTTP request leaves the ledger unchanged => same generation => same UUID.
//   * A genuinely authorized RELISTING can only happen after the previous listing is terminal => generation + 1
//     => a new UUID.
// The OPERATOR_MANUAL (Q41) path keeps its own attempt-id-derived UUID (src/lib/operatorAuthority.js); its retries
// are blocked by the attempt ledger until reconciled.
//
// Pure functions, no I/O.

import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function derivePublicationIdentity({ gkAssetId, channel = 'ebay', generation } = {}) {
  if (typeof gkAssetId !== 'string' || !UUID_RE.test(gkAssetId)) throw new Error('derivePublicationIdentity: gkAssetId must be a UUID');
  if (channel !== 'ebay') throw new Error('derivePublicationIdentity: unsupported channel');
  if (!Number.isInteger(generation) || generation < 0) throw new Error('derivePublicationIdentity: generation must be a non-negative integer');
  const digest = createHash('sha256').update(`grailkey-ebay-publication-v1|${gkAssetId.toLowerCase()}|${channel}|${generation}`).digest('hex');
  const uuid = digest.slice(0, 32).toUpperCase();
  return { uuid, sku: `GK-${uuid}`, scheme: 'asset-channel-generation-v1-upper', generation };
}

const ITEM_ID_RE = /^\d{9,15}$/;
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

/**
 * parseDuplicateUuidError — recognises Trading error 488 and extracts the existing ItemID from the DOCUMENTED
 * structured error parameters (KB 1462 sample: ParamID="0" = ListedByRequestAppId, ParamID="1" = the existing
 * item id; the id is NOT labelled "ItemID" in the XML). The LongMessage ("...item ID=<id>") is only a
 * cross-check: when present it must agree, otherwise nothing is trusted.
 * Never throws. itemId is null unless the structured parameter is a well-formed id AND consistent.
 */
export function parseDuplicateUuidError(responseXml) {
  const xml = typeof responseXml === 'string' ? responseXml : '';
  const blocks = [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map((m) => m[1]);
  const dupBlocks = blocks.filter((b) => /<ErrorCode>\s*488\s*<\/ErrorCode>/.test(b));
  if (dupBlocks.length === 0) return { isDuplicateUuid: false, itemId: null, reason: 'not-488' };
  const structured = new Set();
  const fromMessage = new Set();
  for (const b of dupBlocks) {
    for (const m of b.matchAll(/<ErrorParameters\s+ParamID="(\d+)"[^>]*>\s*<Value>([^<]*)<\/Value>/g)) {
      if (m[1] === '1' && ITEM_ID_RE.test(decode(m[2]))) structured.add(decode(m[2]));
    }
    const long = (b.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/) || [])[1];
    const mm = long ? decode(long).match(/item ID=(\d{9,15})/i) : null;
    if (mm) fromMessage.add(mm[1]);
  }
  if (structured.size === 0) return { isDuplicateUuid: true, itemId: null, reason: 'no-structured-item-id' };
  if (structured.size > 1) return { isDuplicateUuid: true, itemId: null, reason: 'multiple-structured-item-ids' };
  const id = [...structured][0];
  if (fromMessage.size > 0 && !(fromMessage.size === 1 && fromMessage.has(id))) return { isDuplicateUuid: true, itemId: null, reason: 'structured-message-mismatch' };
  return { isDuplicateUuid: true, itemId: id, reason: 'structured-item-id' };
}

/** parseListingIdentity — the few GetItem fields needed to authenticate a recovered listing. Never throws. */
export function parseListingIdentity(getItemXml) {
  const xml = typeof getItemXml === 'string' ? getItemXml : '';
  const tag = (name, src = xml) => { const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : null; };
  const sellerBlock = (xml.match(/<Seller>([\s\S]*?)<\/Seller>/) || [])[1] || '';
  return {
    ack: tag('Ack'),
    itemId: tag('ItemID'),
    sellerUserId: tag('UserID', sellerBlock),
    sku: tag('SKU'),
    listingStatus: tag('ListingStatus'),
  };
}

/**
 * evaluateRecoveredListing — a duplicate-UUID refusal is NEVER by itself proof of a published listing. The listing
 * the error points at must (1) be readable, (2) be the very item the error named, (3) belong to the expected
 * seller account, (4) carry the deterministic SKU label of THIS publication identity, and (5) still be Active.
 * Anything else => not verified (the caller preserves an AMBIGUOUS state and refuses a blind second publication).
 */
export function evaluateRecoveredListing({ expectedItemId, expectedSellerUserId, expectedSku, identity } = {}) {
  if (!identity) return { verified: false, reason: 'getitem-unavailable' };
  if (!identity.ack || /^Failure$/i.test(identity.ack)) return { verified: false, reason: 'getitem-failed' };
  if (!expectedItemId || identity.itemId !== expectedItemId) return { verified: false, reason: 'item-id-mismatch' };
  if (!expectedSellerUserId || !identity.sellerUserId || identity.sellerUserId.toLowerCase() !== String(expectedSellerUserId).toLowerCase()) return { verified: false, reason: 'seller-mismatch' };
  if (!expectedSku || identity.sku !== expectedSku) return { verified: false, reason: 'sku-mismatch' };
  if (identity.listingStatus !== 'Active') return { verified: false, reason: 'listing-not-active' };
  return { verified: true, reason: 'seller-sku-active-match' };
}
