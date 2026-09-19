// src/lib/inventoryListingPreflight.js — GRAILKEY INVENTORY AUTHORITY
// V1. The fail-closed gate api/list-ebay.js's single-item publish path
// runs BEFORE any eBay network call, alongside (never instead of) GK-207's
// own validateOutcomeAttachment. Does not rebuild or replace eBay LIST —
// this is purely an additional precondition check.
//
// SOLD CONSISTENCY CLOSEOUT (2026-09-20) — the ORIGINAL V1 preflight
// consulted ONLY inventory_current_state (a mutable projection). Traced
// failure path, confirmed by reading the actual code, not inferred: if
// a real SOLD outcome_event write succeeds but the reconciler's own
// markSold() projection write fails afterward for any reason (best-
// effort, never blocks the outcome ledger — see
// src/lib/ebayOutcomeReconciler.js), inventory_current_state is left
// stale (still AVAILABLE/RESERVED) while outcome_event durably says
// SOLD. The old preflight would then WRONGLY permit a new LIST: (1)
// assertListable() only reads the stale projection, sees AVAILABLE,
// passes; (2) hasActiveListingForChannel() groups by external_listing_id
// — a NEW listing attempt uses a fresh id, so the OLD (now-terminal,
// SOLD) listing episode is invisible to that check. A physically sold,
// one-of-one asset could become listable again. Confirmed split-brain,
// not hypothetical.
//
// FIX (smallest correct one, per explicit instruction — no transactional
// coupling, no new retry subsystem, no second inventory authority): the
// preflight now ALSO independently consults the durable, immutable
// outcome_event ledger directly (hasAuthoritativeSoldOutcome) — never
// the mutable projection — and fails closed unconditionally if a real
// SOLD outcome exists, REGARDLESS of what inventory_current_state says.
// outcome_event is the durable historical fact; inventory_current_state
// is a derived projection; a projection failure must never make a SOLD
// asset sellable again. This check runs FIRST, before the projection
// read, and is channel-agnostic (a physically sold asset is never
// listable on any channel, not just the one it sold through).
//
// THREE independent facts, ALL required:
//   1. No authoritative SOLD outcome_event exists for this asset, on
//      ANY channel (the fail-closed invariant — checked first,
//      independent of the mutable projection below).
//   2. Inventory Authority state is AVAILABLE (src/modules/inventory —
//      UNMANAGED/RESERVED/SOLD/missing/ambiguous all reject).
//   3. No existing active listing already exists for this asset on this
//      channel (src/modules/assets — AVAILABLE does not by itself mean
//      "safe to create unlimited duplicate projections").
//
// Listing itself does NOT reserve — a separate, later, explicit
// reserveAsset() call (manual/API-driven only in V1) is required for
// AVAILABLE -> RESERVED; this preflight only ever READS state, never
// mutates it.

import { assertListable, ConflictError as InventoryConflictError, NotFoundError as InventoryNotFoundError, AuthorizationFailedError as InventoryAuthorizationFailedError } from '../modules/inventory/index.js';
import { hasActiveListingForChannel, hasAuthoritativeSoldOutcome, wasOutcomeIdempotencyKeyClaimed } from '../modules/assets/index.js';

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
  // Fail-closed invariant, checked FIRST and independent of the mutable
  // inventory_current_state projection below: once GrailKey has durable
  // authoritative SOLD evidence for a physical asset, no new marketplace
  // LIST may succeed, regardless of a temporary projection failure.
  const soldCheck = await hasAuthoritativeSoldOutcome({ principalId, gkAssetId });
  if (soldCheck.sold) {
    throw new ListingPreflightFailedError(
      'AUTHORITATIVE_SOLD_EXISTS',
      `gk_asset ${gkAssetId} has a durable SOLD outcome_event (${soldCheck.soldOutcomeEventId}, occurred_at ${soldCheck.soldAt}) — permanently not listable, regardless of Inventory Authority projection state`
    );
  }

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
