// src/lib/listingState.js — GK-P0 FIRST LISTING RECONCILIATION (2026-10-26).
//
// Three separate facts that the catalogue previously collapsed into one
// string field (`item.status`):
//
//   1. GrailKey's own LISTED state — durable, authoritative, held in the
//      outcome_event ledger (LISTED with no terminal event). The client
//      mirrors it as `status: 'listed'` plus `ebayItemId`.
//   2. The marketplace PROVIDER's last-observed status (GetItem:
//      active | ended | sold). Observational only: kept in
//      `ebayProviderStatus`, never written into `status`.
//   3. A SOLD outcome — only a durable SOLD outcome_event is evidence of a
//      sale. A provider "sold" is shown, but "ended" is NEVER treated as sold.
//
// Defect this replaces: syncEbayStatus wrote the provider's raw word
// ("active") into `status`, while every display site tests
// `status === 'listed'` — so a successful Sync on a live listing made the
// card revert to "List on eBay".
//
// Pure functions, no I/O.

export const LISTED = 'listed';
export const ENDED = 'ended';
export const SOLD = 'sold';

export function ebayItemUrl(ebayItemId) {
  const id = ebayItemId == null ? '' : String(ebayItemId).trim();
  return /^\d{9,15}$/.test(id) ? `https://www.ebay.com/itm/${id}` : null;
}

// The one listed-ness test every badge, button, filter and count uses.
// Legacy repair: a row previously corrupted by the old Sync wrote the
// provider word 'active' into status; with an eBay item id present that
// is a live listing, not an unlisted book.
export function normalizeListingStatus(item) {
  if (!item || typeof item !== 'object') return item;
  if (item.status === 'active' && item.ebayItemId) return { ...item, status: LISTED };
  return item;
}

export function isItemListed(item) {
  if (!item) return false;
  if (item.status === LISTED) return true;
  return item.status === 'active' && !!item.ebayItemId;
}

export function getItemEbayUrl(item) {
  if (!item) return null;
  return item.ebayUrl || ebayItemUrl(item.ebayItemId);
}

// Maps a GetItem result ({status, soldPrice?, soldAt?, endedAt?}) onto a
// catalogue patch. Returns null for anything unrecognised (unknown/failed
// provider responses change NOTHING and can never re-enable publication).
// The listing association (ebayItemId/ebayUrl/listedAt) is never in the
// patch, so it is preserved by construction.
export function applyProviderStatus(item, data, now = Date.now()) {
  const provider = data && typeof data.status === 'string' ? data.status : null;
  if (provider !== 'active' && provider !== 'ended' && provider !== 'sold') return null;
  const patch = { ebayProviderStatus: provider, ebayProviderCheckedAt: now };
  if (provider === 'active') {
    patch.status = LISTED;
  } else if (provider === 'ended') {
    // Ended is not sold: expired / cancelled / out-of-stock / ended by the seller.
    patch.status = ENDED;
    patch.endedAt = data.endedAt ?? now;
  } else {
    patch.status = SOLD;
    patch.soldPrice = data.soldPrice;
    patch.soldAt = data.soldAt;
    if (data.buyerFeedback != null) patch.buyerFeedback = data.buyerFeedback;
  }
  return patch;
}

// Durable outcome ledger -> catalogue patch, for one listing summary
// returned by GET /api/assets?listings=1:
//   { collectionItemId, externalListingId, state: 'LISTED'|'SOLD'|'DELISTED'|'EXPIRED_UNSOLD', askAmount, listedAt }
// Returns null when nothing should change. Fills a missing association
// (refresh / empty IndexedDB / second device) but never downgrades a local
// SOLD, and never overrides a locally observed ended/sold provider result
// with an older LISTED fact.
export function patchFromDurableListing(item, listing) {
  if (!item || !listing || !listing.externalListingId) return null;
  const id = String(listing.externalListingId);
  const url = ebayItemUrl(id);
  const sameListing = String(item.ebayItemId || '') === id;
  const patch = {};

  if (listing.state === 'LISTED') {
    if (item.status === SOLD && sameListing) return null;
    if (item.status === ENDED && sameListing) return null; // provider observed the end more recently than the unreconciled ledger
    if (!sameListing) patch.ebayItemId = id;
    if (!item.ebayUrl && url) patch.ebayUrl = url;
    if (!item.listedAt && listing.listedAt) patch.listedAt = listing.listedAt;
    if (!isItemListed(item) || item.status === 'active') patch.status = LISTED;
  } else if (listing.state === 'SOLD') {
    if (item.status !== SOLD) patch.status = SOLD;
    if (!sameListing) patch.ebayItemId = id;
    if (!item.ebayUrl && url) patch.ebayUrl = url;
  } else if (listing.state === 'DELISTED' || listing.state === 'EXPIRED_UNSOLD') {
    if (item.status === SOLD) return null;
    if (isItemListed(item) && sameListing) patch.status = ENDED;
    if (!item.ebayItemId) patch.ebayItemId = id;
    if (!item.ebayUrl && url) patch.ebayUrl = url;
  } else {
    return null;
  }
  return Object.keys(patch).length ? patch : null;
}

// Applies a whole GET /api/assets?listings=1 payload to a catalogue array.
// Returns { items, changed: [{id, patch}] } — items are the same array
// entries when unchanged.
export function reconcileCatalogueWithDurableListings(items, listings) {
  const byItem = new Map();
  for (const l of Array.isArray(listings) ? listings : []) {
    if (!l || !l.collectionItemId) continue;
    // Prefer the most informative listing per catalogue item: an active LISTED wins over history.
    const prior = byItem.get(l.collectionItemId);
    if (!prior || (l.state === 'LISTED' && prior.state !== 'LISTED')) byItem.set(l.collectionItemId, l);
  }
  const changed = [];
  const out = (items || []).map((it) => {
    const l = it && byItem.get(it.id);
    if (!l) return it;
    const patch = patchFromDurableListing(it, l);
    if (!patch) return it;
    changed.push({ id: it.id, patch });
    return { ...it, ...patch };
  });
  return { items: out, changed };
}
