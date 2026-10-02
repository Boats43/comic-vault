// src/lib/gradeReceipt.js — GK-261 SERVER-OWNED MODEL / GRADE AUTHORITY RECEIPT.
//
// GOVERNING LAW: authority is minted by the server from a validated action.
// The client may describe WHAT happened (here: "I scanned, this is my
// receipt handle"); it may never declare THAT a model result is
// authoritative. /api/grade records what the model ACTUALLY returned,
// under an opaque, unguessable id bound to the authenticated principal,
// with a short TTL. A later collection save presents only that id; the
// server claims it (single use) and writes the baseline itself.
//
// Unknown stays UNKNOWN: provider/model/version/prompt fields are recorded
// only when the call site really knew them; otherwise null. Nothing here
// infers provenance.
//
// Store: Upstash KV (api/kv-cache.js) in production. KV unavailable at
// issue time => no receipt is issued; unavailable at claim time => no
// baseline is minted. Both fail toward UNKNOWN, never toward client trust.

import { randomBytes, createHash, randomUUID } from 'node:crypto';

export const GRADE_RECEIPT_TTL_SECONDS = 6 * 60 * 60; // 6h: scan -> save is normally seconds; a long-offline save simply stays UNKNOWN

const keyFor = (receiptId) => `gr:v1:${createHash('sha256').update(String(receiptId)).digest('hex')}`;

let storeOverride = null;
// Test seam only: { set(key, value, ttlSeconds), get(key), getdel(key) }.
export function __setReceiptStoreForTests(store) { storeOverride = store; }

async function getStore() {
  if (storeOverride) return storeOverride;
  const kv = await import('../../api/kv-cache.js');
  return {
    set: (k, v, ttl) => kv.kvSet(k, v, ttl),
    get: (k) => kv.kvGet(k),
    getdel: (k) => kv.kvGetDel(k),
  };
}

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Record a server-observed model result. Returns the opaque receipt id, or
 * null when nothing trustworthy can be recorded (no principal, no grade,
 * store unavailable). Never throws.
 */
export async function issueGradeReceipt({ principalId, result, provider = null, model = null, modelVersion = null, promptVersion = null, buildSha = null, resultId = null, predictionEventId = null, now = Date.now() } = {}) {
  try {
    if (!principalId || !result || !str(result.grade)) return null;
    const receiptId = `gr_${randomBytes(24).toString('base64url')}`;
    const record = {
      v: 1,
      principalId,
      issuedAt: now,
      resultId: str(resultId) || randomUUID(),
      predictionEventId: str(predictionEventId), // GK-278: the durable model_prediction_event this receipt corresponds to
      grade: result.grade,
      reason: typeof result.reason === 'string' ? result.reason : null,
      confidence: str(result.confidence),
      provider: str(provider),
      model: str(model),
      modelVersion: str(modelVersion),
      promptVersion: str(promptVersion),
      buildSha: str(buildSha),
    };
    const store = await getStore();
    await store.set(keyFor(receiptId), record, GRADE_RECEIPT_TTL_SECONDS);
    // Verify it really landed (kvSet swallows errors): an unreadable
    // receipt must not be handed to the client as if it were redeemable.
    const back = await store.get(keyFor(receiptId));
    if (!back || back.principalId !== principalId) return null;
    return receiptId;
  } catch {
    return null;
  }
}

/**
 * Claim (single use) a receipt for `principalId`. Returns
 * { ok:true, baseline } or { ok:false, reason }. Never throws.
 * Reasons: NO_RECEIPT_ID | NOT_FOUND | WRONG_PRINCIPAL | EXPIRED | CLAIM_LOST
 * A WRONG_PRINCIPAL attempt does NOT consume the receipt.
 */
export async function claimGradeReceipt({ principalId, receiptId, now = Date.now() } = {}) {
  try {
    if (!principalId || typeof receiptId !== 'string' || !receiptId.startsWith('gr_') || receiptId.length > 128) {
      return { ok: false, reason: 'NO_RECEIPT_ID' };
    }
    const store = await getStore();
    const key = keyFor(receiptId);
    const peek = await store.get(key);
    if (!peek) return { ok: false, reason: 'NOT_FOUND' };
    if (peek.principalId !== principalId) return { ok: false, reason: 'WRONG_PRINCIPAL' };
    const rec = await store.getdel(key); // atomic: exactly one concurrent claimant wins
    if (!rec) return { ok: false, reason: 'CLAIM_LOST' };
    if (rec.principalId !== principalId) return { ok: false, reason: 'WRONG_PRINCIPAL' };
    if (!Number.isFinite(rec.issuedAt) || now - rec.issuedAt > GRADE_RECEIPT_TTL_SECONDS * 1000) {
      return { ok: false, reason: 'EXPIRED' };
    }
    return {
      ok: true,
      record: rec,
      baseline: {
        modelPredictedGrade: rec.grade,
        modelPredictedGradeReason: rec.reason,
        modelPredictedGradeConfidence: rec.confidence,
        modelPredictedAt: rec.issuedAt,
        modelPredictedProvenance: {
          standing: 'SERVER_RECEIPT',
          provider: rec.provider,
          model: rec.model,
          modelVersion: rec.modelVersion,
          promptVersion: rec.promptVersion,
          buildSha: rec.buildSha,
          resultId: rec.resultId,
          predictionEventId: rec.predictionEventId ?? null,
          receiptIssuedAt: rec.issuedAt,
          claimedAt: now,
        },
      },
    };
  } catch {
    return { ok: false, reason: 'NOT_FOUND' };
  }
}

/** Put a claimed record back (only after a failed durable write), keeping its original expiry window. */
export async function restoreGradeReceipt({ receiptId, record, now = Date.now() } = {}) {
  try {
    const remaining = Math.floor((record.issuedAt + GRADE_RECEIPT_TTL_SECONDS * 1000 - now) / 1000);
    if (remaining <= 0) return false;
    const store = await getStore();
    await store.set(keyFor(receiptId), record, remaining);
    return true;
  } catch {
    return false;
  }
}
