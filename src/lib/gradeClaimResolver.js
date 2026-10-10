// GK-280A — turns a client-presented credential (signed grade proof and/or legacy KV receipt id) into a
// VERIFIED claim descriptor, or a refusal. Nothing the client says is trusted: the proof signature,
// expiry and principal are checked, then the durable, immutable model_prediction_event is re-read and
// must match (principal, surface GRADE, result id, input hash). The baseline values come from that
// event (or the server's own receipt record), never from the request body.
//
// Pure with respect to the collection tables: it only reads the learning module's event and the receipt
// store. The association itself happens in src/modules/collection (one transaction).

import { verifyGradeProof, peekGradeReceipt, buildBaselineFromReceipt } from './gradeReceipt.js';
import { getModelPredictionEvent } from '../modules/learning/index.js';
import { GRADE_CLAIM_CODE } from './gradeClaimPolicy.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lc = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

// null = definitively no such event for this principal. A THROWN error is a transient lookup failure, NOT a
// refusal: it must surface as 'unavailable' (the caller returns 503 and the client retries) — otherwise a
// momentary database hiccup would save the row UNASSOCIATED and, under the create-only rule, strand it forever.
class ClaimLookupUnavailable extends Error {}
async function loadEvent(principalId, eventId) {
  if (typeof eventId !== 'string' || !UUID_RE.test(eventId)) return null;
  try { return await getModelPredictionEvent({ principalId, id: eventId }); } catch (e) { throw new ClaimLookupUnavailable(e?.message || 'event lookup failed'); }
}

function baselineFromEvent(ev, { issuedAt, now, via }) {
  const p = ev.prediction || {};
  return {
    modelPredictedGrade: p.grade,
    modelPredictedGradeReason: typeof p.reason === 'string' ? p.reason : null,
    modelPredictedGradeConfidence: typeof p.confidence === 'string' ? p.confidence : null,
    modelPredictedAt: new Date(ev.created_at).getTime(),
    modelPredictedProvenance: {
      standing: 'SERVER_RECEIPT', // unchanged vocabulary; claimedVia says how it was claimed
      provider: ev.provider ?? null, model: ev.model ?? null, modelVersion: ev.model_version ?? null,
      promptVersion: ev.prompt_version ?? null, buildSha: ev.build_sha ?? null,
      resultId: ev.result_id, predictionEventId: ev.id,
      receiptIssuedAt: Number.isFinite(issuedAt) ? issuedAt : null, claimedAt: now, claimedVia: via,
    },
  };
}

/**
 * @returns {Promise<{present:false} | {present:true, unavailable:true} | {present:true, refusal:{code:string, reason?:string}} |
 *   {present:true, claim:object, receiptId:string|null}>}
 */
export async function resolveGradeClaim(args = {}) {
  try { return await resolveGradeClaimInner(args); } catch (e) {
    if (e instanceof ClaimLookupUnavailable) return { present: true, unavailable: true };
    throw e;
  }
}

async function resolveGradeClaimInner({ principalId, gradeProof, gradeReceiptId, gradeInputHash, now = Date.now() } = {}) {
  const hasProof = typeof gradeProof === 'string' && gradeProof.length > 0;
  const hasReceipt = typeof gradeReceiptId === 'string' && gradeReceiptId.length > 0;
  if (!hasProof && !hasReceipt) return { present: false };
  const receiptId = hasReceipt ? gradeReceiptId : null;

  if (hasProof) {
    const v = verifyGradeProof(gradeProof, { now });
    if (!v.ok) return { present: true, refusal: { code: GRADE_CLAIM_CODE.PROOF_INVALID, reason: v.reason } };
    const c = v.claims;
    if (c.p !== principalId) return { present: true, refusal: { code: GRADE_CLAIM_CODE.PRINCIPAL_MISMATCH } };
    if (typeof gradeInputHash === 'string' && gradeInputHash && c.h && gradeInputHash !== c.h) {
      return { present: true, refusal: { code: GRADE_CLAIM_CODE.INPUT_HASH_MISMATCH, reason: 'presented hash differs from the proof' } };
    }
    const ev = await loadEvent(principalId, c.e);
    if (!ev || ev.surface !== 'GRADE' || lc(ev.result_id) !== lc(c.r) || ev.principal_id !== principalId
        || typeof ev.prediction?.grade !== 'string' || !ev.prediction.grade.trim()) {
      return { present: true, refusal: { code: GRADE_CLAIM_CODE.EVENT_MISMATCH } };
    }
    if (c.h && ev.input_hash !== c.h) return { present: true, refusal: { code: GRADE_CLAIM_CODE.INPUT_HASH_MISMATCH, reason: 'proof does not match the recorded event input' } };
    return {
      present: true, receiptId,
      claim: {
        eventId: ev.id, resultId: ev.result_id, targetItemId: c.t ?? null,
        eventCreatedAtMs: new Date(ev.created_at).getTime(), via: 'GRADE_PROOF',
        baseline: baselineFromEvent(ev, { issuedAt: c.iat, now, via: 'GRADE_PROOF' }),
      },
    };
  }

  // Legacy path: the KV receipt (6h TTL). Looked up WITHOUT consuming; consumed only after the association commits.
  const peek = await peekGradeReceipt({ principalId, receiptId: gradeReceiptId, now });
  if (!peek.ok) return { present: true, refusal: { code: GRADE_CLAIM_CODE.RECEIPT_INVALID, reason: peek.reason } };
  const rec = peek.record;
  if (typeof gradeInputHash === 'string' && gradeInputHash && rec.inputHash && gradeInputHash !== rec.inputHash) {
    return { present: true, refusal: { code: GRADE_CLAIM_CODE.INPUT_HASH_MISMATCH, reason: 'presented hash differs from the receipt' } };
  }
  const baseline = buildBaselineFromReceipt(rec, now);
  if (!rec.predictionEventId) {
    // Event write failed at grade time: no durable anchor. Baseline-only, new row only (policy R6).
    return { present: true, receiptId, claim: { eventId: null, resultId: rec.resultId, targetItemId: rec.targetItemId ?? null, eventCreatedAtMs: null, via: 'GRADE_RECEIPT', baseline } };
  }
  const ev = await loadEvent(principalId, rec.predictionEventId);
  if (!ev || ev.surface !== 'GRADE' || lc(ev.result_id) !== lc(rec.resultId) || ev.prediction?.grade !== rec.grade) {
    return { present: true, refusal: { code: GRADE_CLAIM_CODE.EVENT_MISMATCH } };
  }
  if (rec.inputHash && ev.input_hash !== rec.inputHash) return { present: true, refusal: { code: GRADE_CLAIM_CODE.INPUT_HASH_MISMATCH, reason: 'receipt does not match the recorded event input' } };
  return {
    present: true, receiptId,
    claim: { eventId: ev.id, resultId: ev.result_id, targetItemId: rec.targetItemId ?? null, eventCreatedAtMs: new Date(ev.created_at).getTime(), via: 'GRADE_RECEIPT', baseline },
  };
}
