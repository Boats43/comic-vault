// src/lib/inventoryListingPreflight.js — GRAILKEY INVENTORY AUTHORITY
// V1. The fail-closed gate api/list-ebay.js's single-item publish path
// runs BEFORE any eBay network call, alongside (never instead of) GK-207's
// own validateOutcomeAttachment. Does not rebuild or replace eBay LIST —
// this is purely an additional precondition check.
//
// TWO independent facts, both required:
//   1. Inventory Authority state is AVAILABLE (src/modules/inventory —
//      UNMANAGED/RESERVED/SOLD/missing/ambiguous all reject).
//   2. No existing active listing already exists for this asset on this
//      channel (src/modules/assets — AVAILABLE does not by itself mean
//      "safe to create unlimited duplicate projections").
//
// Listing itself does NOT reserve — a separate, later, explicit
// reserveAsset() call (manual/API-driven only in V1) is required for
// AVAILABLE -> RESERVED; this preflight only ever READS state, never
// mutates it.

import { assertListable, ConflictError as InventoryConflictError, NotFoundError as InventoryNotFoundError, AuthorizationFailedError as InventoryAuthorizationFailedError } from '../modules/inventory/index.js';
import { hasActiveListingForChannel, wasOutcomeIdempotencyKeyClaimed } from '../modules/assets/index.js';

export class ListingPreflightFailedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ListingPreflightFailedError';
    this.code = code;
  }
}

/**
 * assertListingAuthorized — throws ListingPreflightFailedError with a
 * stable .code on any failure; returns { inventoryState: 'AVAILABLE' }
 * on success. Never mutates anything.
 *
 * outcomeIdempotencyKey (optional): the SAME key the caller will pass to
 * recordOutcomeEvent for this exact request. When supplied and already
 * claimed, this is recognized as a legitimate replay of a request
 * already processed — the duplicate-active-listing check is skipped for
 * it (the existing GK-163 idempotency mechanism inside recordOutcomeEvent
 * handles the replay itself), so retrying the SAME successful LIST is
 * never mistaken for "a new listing attempt while one is already
 * active." A genuinely NEW attempt (no key, or an unclaimed key) is
 * still fully subject to the duplicate check.
 */
export async function assertListingAuthorized({ principalId, gkAssetId, channel, outcomeIdempotencyKey }) {
  try {
    await assertListable({ principalId, gkAssetId });
  } catch (e) {
    if (e instanceof InventoryConflictError) {
      throw new ListingPreflightFailedError('INVENTORY_NOT_AVAILABLE', e.message);
    }
    if (e instanceof InventoryNotFoundError || e instanceof InventoryAuthorizationFailedError) {
      throw new ListingPreflightFailedError('INVENTORY_UNAUTHORIZED', e.message);
    }
    throw e;
  }

  const isReplay = outcomeIdempotencyKey ? await wasOutcomeIdempotencyKeyClaimed(outcomeIdempotencyKey) : false;
  if (!isReplay) {
    const { active, activeListingIds } = await hasActiveListingForChannel({ principalId, gkAssetId, channel });
    if (active) {
      throw new ListingPreflightFailedError(
        'DUPLICATE_ACTIVE_LISTING',
        `gk_asset ${gkAssetId} already has an active listing on channel "${channel}" (${activeListingIds.join(', ')}) — reject, do not create a duplicate projection`
      );
    }
  }

  return { inventoryState: 'AVAILABLE' };
}
