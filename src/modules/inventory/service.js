// src/modules/inventory/service.js — the public surface implementation.
// Orchestrates transactions, calls repository.js, NEVER issues SQL
// directly. Every mutating operation follows the same shape as every
// other module in this project:
//   1. validate required fields
//   2. acquire a connection, assertPrincipalActive
//   3. BEGIN
//   4. check idempotency replay — if hit, COMMIT (no-op), return the
//      ORIGINAL result verbatim
//   5. verify the asset exists and this principal owns it
//   6. insert the transition_event FIRST (see repository.js's own
//      header) — this is provisional until step 7 confirms it
//   7. attempt the CAS on inventory_current_state — if it returns null
//      (predicate didn't match), throw ConflictError; the outer catch's
//      ROLLBACK undoes the whole transaction, INCLUDING the transition_
//      event insert from step 6 — no phantom history row ever survives
//      a failed transition.
//   8. claim the idempotency key, COMMIT

import * as repo from './repository.js';
import { acquireConnection } from './db.js';
import { checkIdempotencyReplay, claimIdempotencyKey, computeRequestFingerprint } from './idempotency.js';
import { NotFoundError, ValidationFailedError, AuthorizationFailedError, ConflictError } from './errors.js';
// SOLD CONSISTENCY CLOSEOUT — the durable outcome_event ledger lives in
// the assets module; this is a normal public-surface cross-module read
// (the same composition pattern src/modules/assets/service.js already
// uses for media), never a boundary violation. Every function below
// that could make an asset appear AVAILABLE/RESERVED checks this FIRST,
// independent of this module's own (mutable) inventory_current_state —
// a stale/failed projection must never let a truly SOLD asset become
// reservable or listable again.
import { hasAuthoritativeSoldOutcome } from '../assets/index.js';

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

async function assertPrincipalActive(client, principalId) {
  if (!principalId) throw new AuthorizationFailedError('principalId is required');
  const exists = await repo.assertPrincipalExists(client, principalId);
  if (!exists) throw new AuthorizationFailedError(`principalId ${principalId} does not resolve to a real gk_principal row`);
}

async function assertPrincipalOwnsAsset(client, principalId, gkAssetId) {
  const exists = await repo.assetExists(client, gkAssetId);
  if (!exists) throw new NotFoundError(`gk_asset ${gkAssetId} does not exist`);
  const ownerId = await repo.getAssetOwner(client, gkAssetId);
  if (!ownerId) throw new AuthorizationFailedError(`gk_asset ${gkAssetId} has no current_owner row — cannot authorize any principal`);
  if (ownerId !== principalId) throw new AuthorizationFailedError(`principalId ${principalId} is not authorized for gk_asset ${gkAssetId} (not the current owner)`);
}

const newCorrelationId = () => crypto.randomUUID();

// SOLD CONSISTENCY CLOSEOUT — shared fail-closed guard. Consults the
// durable outcome_event ledger directly (never this module's own
// inventory_current_state), so a stale/failed projection can never let
// a truly SOLD asset be enrolled, reserved, or released back to
// AVAILABLE. Called from every function below that could otherwise make
// an asset appear available for sale.
async function assertNoAuthoritativeSoldOutcome(principalId, gkAssetId) {
  const { sold, soldOutcomeEventId, soldAt } = await hasAuthoritativeSoldOutcome({ principalId, gkAssetId });
  if (sold) {
    throw new ConflictError(`gk_asset ${gkAssetId} has a durable SOLD outcome_event (${soldOutcomeEventId}, occurred_at ${soldAt}) — permanently ineligible, regardless of Inventory Authority projection state`);
  }
}

// enrollAsset — UNMANAGED -> AVAILABLE. "GrailKey is now authorized to
// control sale availability for this physical asset." Never inferred
// from a scan, ownership, gkAssetId existing, Collection presence, or
// listing preparation — this is the ONLY function in this module (or
// anywhere else) that performs this transition, and it is only ever
// called by an explicit operator/API action.
export async function enrollAsset({ principalId, gkAssetId, idempotencyKey, occurredAt } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'enrollAsset';
      const requestFingerprint = computeRequestFingerprint({ gkAssetId });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
      await assertNoAuthoritativeSoldOutcome(principalId, gkAssetId);

      const transitionEventId = await repo.insertTransitionEvent(client, {
        gkAssetId, priorState: 'UNMANAGED', nextState: 'AVAILABLE', reason: 'operator-enrollment',
        channel: null, externalReference: null, correlationId: newCorrelationId(),
        recordedByPrincipalId: principalId, occurredAt, idempotencyKey,
      });
      const cas = await repo.casEnroll(client, { gkAssetId, transitionEventId });
      if (!cas) {
        throw new ConflictError(`gk_asset ${gkAssetId} is already enrolled in Inventory Authority — enrollment is only valid from UNMANAGED`);
      }

      const result = { transitionEventId, gkAssetId, state: 'AVAILABLE' };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// reserveAsset — AVAILABLE -> RESERVED. Manual/API-driven only in V1 —
// no automatic eBay-order-derived call site exists anywhere in this
// repo (see src/lib/ebayOutcomeReconciler.js's own header for the
// evidentiary reasoning: no eBay order-state combination was found that
// safely, unambiguously signals "reservation-worthy" for a real
// one-of-one physical asset).
export async function reserveAsset({ principalId, gkAssetId, channel, externalReference, reason = 'marketplace-reservation', idempotencyKey, occurredAt } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'reserveAsset';
      const requestFingerprint = computeRequestFingerprint({ gkAssetId, channel: channel ?? null, externalReference: externalReference ?? null });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
      await assertNoAuthoritativeSoldOutcome(principalId, gkAssetId);

      const transitionEventId = await repo.insertTransitionEvent(client, {
        gkAssetId, priorState: 'AVAILABLE', nextState: 'RESERVED', reason,
        channel, externalReference, correlationId: newCorrelationId(),
        recordedByPrincipalId: principalId, occurredAt, idempotencyKey,
      });
      const cas = await repo.casReserve(client, { gkAssetId, transitionEventId, channel, externalReference });
      if (!cas) {
        const current = await repo.getCurrentState(client, gkAssetId);
        const currentState = current ? current.state : 'UNMANAGED';
        throw new ConflictError(`gk_asset ${gkAssetId} cannot be reserved — current state is ${currentState}, not AVAILABLE`);
      }

      const result = { transitionEventId, gkAssetId, state: 'RESERVED' };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// releaseReservation — RESERVED -> AVAILABLE, a legitimate pre-sale
// cancellation/release. Never a substitute for SOLD.
export async function releaseReservation({ principalId, gkAssetId, reason = 'operator-release', idempotencyKey, occurredAt } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'releaseReservation';
      const requestFingerprint = computeRequestFingerprint({ gkAssetId });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
      await assertNoAuthoritativeSoldOutcome(principalId, gkAssetId);

      const transitionEventId = await repo.insertTransitionEvent(client, {
        gkAssetId, priorState: 'RESERVED', nextState: 'AVAILABLE', reason,
        channel: null, externalReference: null, correlationId: newCorrelationId(),
        recordedByPrincipalId: principalId, occurredAt, idempotencyKey,
      });
      const cas = await repo.casRelease(client, { gkAssetId, transitionEventId });
      if (!cas) {
        const current = await repo.getCurrentState(client, gkAssetId);
        const currentState = current ? current.state : 'UNMANAGED';
        throw new ConflictError(`gk_asset ${gkAssetId} cannot be released — current state is ${currentState}, not RESERVED`);
      }

      const result = { transitionEventId, gkAssetId, state: 'AVAILABLE' };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// markSold — (AVAILABLE|RESERVED) -> SOLD, terminal. The ONLY call site
// for this in the whole repo is src/lib/ebayOutcomeReconciler.js, driven
// by its own already-authoritative SOLD evidence rule — this function
// itself never re-derives or second-guesses that evidence, it only
// performs the inventory-side transition once the caller has already
// established a real sale occurred. priorState is read, not assumed,
// so the correct "smallest legitimate sequence" (AVAILABLE->SOLD or
// RESERVED->SOLD) is recorded truthfully — never a fabricated
// intermediate RESERVED step.
export async function markSold({ principalId, gkAssetId, reason = 'authoritative-sale', channel, externalReference, idempotencyKey, occurredAt } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const operation = 'markSold';
      const requestFingerprint = computeRequestFingerprint({ gkAssetId, channel: channel ?? null, externalReference: externalReference ?? null });
      const replay = await checkIdempotencyReplay(client, { operation, idempotencyKey, requestFingerprint });
      if (replay) { await client.query('COMMIT'); return replay; }

      await assertPrincipalOwnsAsset(client, principalId, gkAssetId);

      const current = await repo.getCurrentState(client, gkAssetId);
      const priorState = current ? current.state : 'UNMANAGED';
      if (priorState !== 'AVAILABLE' && priorState !== 'RESERVED') {
        throw new ConflictError(`gk_asset ${gkAssetId} cannot be marked SOLD — current state is ${priorState}`);
      }

      const transitionEventId = await repo.insertTransitionEvent(client, {
        gkAssetId, priorState, nextState: 'SOLD', reason,
        channel, externalReference, correlationId: newCorrelationId(),
        recordedByPrincipalId: principalId, occurredAt, idempotencyKey,
      });
      const cas = await repo.casMarkSold(client, { gkAssetId, transitionEventId });
      if (!cas) {
        // Genuinely lost a race between the read above and this CAS
        // (e.g. a concurrent transition landed in between) — real
        // conflict, not a bug; the transaction rolls back cleanly.
        throw new ConflictError(`gk_asset ${gkAssetId} could not be marked SOLD — its state changed concurrently`);
      }

      const result = { transitionEventId, gkAssetId, state: 'SOLD' };
      await claimIdempotencyKey(client, { operation, idempotencyKey, principalId, result, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

// getInventoryState — read-only. state:null means UNMANAGED (no row).
export async function getInventoryState({ principalId, gkAssetId } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
    const current = await repo.getCurrentState(client, gkAssetId);
    const history = await repo.listTransitionHistory(client, gkAssetId);
    return { state: current ? current.state : null, current, history };
  } finally {
    client.release();
  }
}

// assertListable — the LIST preflight's own gate (api/list-ebay.js).
// Fails closed on anything that isn't a clean, unambiguous AVAILABLE
// read: UNMANAGED, RESERVED, SOLD, a missing asset, or any unrecognized
// state all throw. Read-only, no transaction, no idempotency claim —
// safe to call repeatedly, like validateOutcomeAttachment's own
// pre-flight cousin in the assets module.
export async function assertListable({ principalId, gkAssetId } = {}) {
  requireFields({ principalId, gkAssetId }, ['principalId', 'gkAssetId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await assertPrincipalOwnsAsset(client, principalId, gkAssetId);
    const current = await repo.getCurrentState(client, gkAssetId);
    const state = current ? current.state : 'UNMANAGED';
    if (state !== 'AVAILABLE') {
      throw new ConflictError(`gk_asset ${gkAssetId} is not listable — Inventory Authority state is ${state}, not AVAILABLE`);
    }
    return { state: 'AVAILABLE' };
  } finally {
    client.release();
  }
}
