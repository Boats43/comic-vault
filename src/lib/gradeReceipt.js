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

import { randomBytes, createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

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
export async function issueGradeReceipt({ principalId, result, provider = null, model = null, modelVersion = null, promptVersion = null, buildSha = null, resultId = null, predictionEventId = null, inputHash = null, targetItemId = null, now = Date.now() } = {}) {
  try {
    if (!principalId || !result || !str(result.grade)) return null;
    const receiptId = `gr_${randomBytes(24).toString('base64url')}`;
    const record = {
      v: 1,
      principalId,
      issuedAt: now,
      resultId: str(resultId) || randomUUID(),
      predictionEventId: str(predictionEventId), // GK-278: the durable model_prediction_event this receipt corresponds to
      inputHash: str(inputHash), // GK-280A: scan identity (sha256 of the graded input), same value stored on the event
      targetItemId: str(targetItemId), // GK-280A: set only for a re-grade of a KNOWN item; null for a fresh scan
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

/** The write-once baseline attributes a receipt record yields (shared by the consuming and non-consuming claim paths). */
export function buildBaselineFromReceipt(rec, now = Date.now()) {
  return {
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
  };
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
      baseline: buildBaselineFromReceipt(rec, now),
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

/**
 * GK-280A — NON-CONSUMING receipt lookup for the atomic claim. Same principal/expiry checks as
 * claimGradeReceipt, but the single-use delete happens only AFTER the durable association commits
 * (consumeGradeReceipt), and one-event-one-item is enforced durably by the item pointer, not by
 * the KV delete. Never throws.
 */
export async function peekGradeReceipt({ principalId, receiptId, now = Date.now() } = {}) {
  try {
    if (!principalId || typeof receiptId !== 'string' || !receiptId.startsWith('gr_') || receiptId.length > 128) return { ok: false, reason: 'NO_RECEIPT_ID' };
    const rec = await (await getStore()).get(keyFor(receiptId));
    if (!rec) return { ok: false, reason: 'NOT_FOUND' };
    if (rec.principalId !== principalId) return { ok: false, reason: 'WRONG_PRINCIPAL' };
    if (!Number.isFinite(rec.issuedAt) || now - rec.issuedAt > GRADE_RECEIPT_TTL_SECONDS * 1000) return { ok: false, reason: 'EXPIRED' };
    return { ok: true, record: rec };
  } catch {
    return { ok: false, reason: 'NOT_FOUND' };
  }
}

/** Single-use delete after a committed association (best effort; the durable pointer is the real guard). */
export async function consumeGradeReceipt({ receiptId } = {}) {
  try { await (await getStore()).getdel(keyFor(receiptId)); return true; } catch { return false; }
}

// ───────────────────────────── GK-280A scan-bound grade proof ─────────────────────────────
// A signed, stateless proof that THIS principal's server recorded THIS prediction event for THIS input.
// It is a credential to ASK for an association, never authority by itself: the claim re-reads the
// durable model_prediction_event (immutable) and checks principal, result id, input hash, and that
// the event is not already bound to another item. It does not depend on the 6h KV receipt, so a
// held / delayed copy can still be associated without another paid grading call.
//
//   gp1.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>
//   claims: { v:1, p: principalId, r: resultId, e: predictionEventId, h: inputHash|null, t: targetItemId|null, iat, exp }
export const GRADE_PROOF_VERSION = 1;
export const GRADE_PROOF_TTL_SECONDS = 30 * 24 * 60 * 60; // outlives held-copy resolution; the event, not the clock, is the authority

const proofKey = () => {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) return null; // fail closed, same floor as session tokens
  return createHmac('sha256', secret).update('grailkey-grade-proof-v1').digest(); // domain-separated from session tokens
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** Returns the proof string, or null (no event id, no secret, bad input) — never throws. */
export function issueGradeProof({ principalId, resultId, predictionEventId, inputHash = null, targetItemId = null, now = Date.now() } = {}) {
  try {
    const key = proofKey();
    if (!key || !principalId || !resultId || !predictionEventId) return null;
    const claims = { v: GRADE_PROOF_VERSION, p: principalId, r: resultId, e: predictionEventId, h: str(inputHash), t: str(targetItemId), iat: now, exp: now + GRADE_PROOF_TTL_SECONDS * 1000 };
    const payload = b64u(JSON.stringify(claims));
    return `gp1.${payload}.${b64u(createHmac('sha256', key).update(payload).digest())}`;
  } catch {
    return null;
  }
}

/** { ok:true, claims } | { ok:false, reason }. Verifies signature and expiry only; the caller checks principal and the durable event. */
export function verifyGradeProof(token, { now = Date.now() } = {}) {
  try {
    const key = proofKey();
    if (!key) return { ok: false, reason: 'PROOF_UNAVAILABLE' };
    if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'PROOF_MALFORMED' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'gp1') return { ok: false, reason: 'PROOF_MALFORMED' };
    const expected = createHmac('sha256', key).update(parts[1]).digest();
    const got = Buffer.from(parts[2], 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: 'PROOF_SIGNATURE_INVALID' };
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || claims.v !== GRADE_PROOF_VERSION || typeof claims.p !== 'string' || typeof claims.r !== 'string' || typeof claims.e !== 'string') return { ok: false, reason: 'PROOF_MALFORMED' };
    if (!Number.isFinite(claims.exp) || now > claims.exp) return { ok: false, reason: 'PROOF_EXPIRED' };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: 'PROOF_MALFORMED' };
  }
}
