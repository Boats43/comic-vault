// src/lib/operatorListAction.js -- the durable LIST operator-action rules, extracted from GrailKeyOperatorPanel.jsx so the existing
// LIST button AND the one-action "Approve & List" orchestrator share ONE implementation.
//
// A publication is bound to a durable LIST operator_action_event that recorded the APPROVED price (api/list-ebay.js
// assertListActionPriceBinding compares the outgoing price to it, and validateOutcomeAttachment requires the action to be LIST).
// This module (1) decides whether the CURRENT action already satisfies that for a given price, and (2) records a new LIST with the
// existing pending-idempotency-key lifecycle (src/lib/operatorActionIdempotency.js): the key is persisted before the request, reused
// on an ambiguous outcome, retired only on a definitive server answer.
//
// No authority is created here: the server (api/operator-action.js) decides. A LIST recorded is the operator's explicit decision record.

import { selectCurrentOperatorAction } from './operatorActionAlignment.js';
import { getOrCreatePendingIdempotencyKey, retirePendingIdempotencyKey, isDefinitiveResponseStatus } from './operatorActionIdempotency.js';

export const LIST_ACTION_REQUEST_TIMEOUT_MS = 15000;
const AMOUNT_EPSILON = 0.005;

/** Exact-amount comparison on cents (the server stores NUMERIC(.,2) as text). */
export const amountsEqual = (recorded, price) => {
  const a = Number(recorded); const b = Number(price);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < AMOUNT_EPSILON;
};

/**
 * Does the asset's CURRENT operator action already authorize listing at exactly `price`?
 * @param {{ graph: object|null, price: number }} a  the /api/assets graph (asset.operatorActions / currentOperatorActionId / currentDecisionId)
 * @returns {{ satisfied: boolean, operatorActionEventId: string|null, decisionEventId: string|null, needsRecord: boolean, blockedReason: string|null }}
 */
export function planListAuthority({ graph, price }) {
  const current = selectCurrentOperatorAction({ operatorActions: graph?.operatorActions, currentOperatorActionId: graph?.currentOperatorActionId });
  const decisionEventId = graph?.currentDecisionId || null;
  if (current && current.action_code === 'LIST' && amountsEqual(current.action_value_amount, price)) {
    return { satisfied: true, operatorActionEventId: current.id, decisionEventId, needsRecord: false, blockedReason: null };
  }
  if (!decisionEventId) {
    return { satisfied: false, operatorActionEventId: null, decisionEventId: null, needsRecord: false, blockedReason: 'GrailKey has no recorded decision for this asset, so a LIST action cannot be recorded.' };
  }
  return { satisfied: false, operatorActionEventId: null, decisionEventId, needsRecord: true, blockedReason: null };
}

/**
 * POST /api/operator-action for a LIST at `price`. Same body and idempotency lifecycle the panel always used.
 * @returns {Promise<{ok:true, operatorActionEventId:string}|{ok:false, ambiguous:boolean, status:number|null, message:string}>}
 */
export async function recordListAction({ authFetch, principalScope, gkAssetId, decisionEventId, price, actionCode = 'LIST', timeoutMs = LIST_ACTION_REQUEST_TIMEOUT_MS }) {
  const pending = getOrCreatePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await authFetch('/api/operator-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gkAssetId, decisionEventId, actionCode, idempotencyKey: pending.idempotencyKey,
        ...(actionCode === 'LIST' && Number(price) > 0 ? { actionValueAmount: Number(price).toFixed(2), actionValueCurrency: 'USD' } : {}),
      }),
      signal: controller.signal,
    });
    if (!res) {
      // No request was transmitted (not signed in): nothing to be ambiguous about; retire the just-created key.
      retirePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode });
      return { ok: false, ambiguous: false, status: null, message: 'Not signed in.' };
    }
    if (!isDefinitiveResponseStatus(res.status)) {
      // e.g. a bare 5xx: the server did not say what happened. Keep the key; the same action later is the safe retry.
      return { ok: false, ambiguous: true, status: res.status, message: `Response ${res.status} — outcome unknown. Click ${actionCode} again to safely retry.` };
    }
    retirePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, ambiguous: false, status: res.status, message: body.error || `Request failed (${res.status})` };
    return { ok: true, operatorActionEventId: body.operatorActionEventId };
  } catch {
    // Network error, abort or timeout: no response was received. Retain the key.
    return { ok: false, ambiguous: true, status: null, message: `Could not confirm the result — outcome unknown. Click ${actionCode} again to safely retry.` };
  } finally {
    clearTimeout(timeoutId);
  }
}
