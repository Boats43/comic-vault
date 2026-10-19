// V1 CERTIFICATION — P0-D PHYSICAL EVIDENCE AUTHENTICITY + edition-claim containment.
//
// Evidence (Production, 2026-10-18): a camera photo of a SCREEN displaying a Street Fighter #1 cover produced
// a VG 4.0 grade, an asserted corner-chip defect, "No restoration detected", a $19 price, a saved Collection
// record — and a model-invented "Thai edition" claim that nothing in the codebase ever checked.
//
// Principles enforced here (pure functions, no I/O, no pricing math):
//  * There is NO deterministic screen/physicality detector. The only signal is the model's own
//    `captureSurface` read. It is therefore ALWAYS a CLAIM: `verified` is never true, a missing signal is
//    NOT_ASSESSED (unknown), and nothing in this file can produce "VERIFIED".
//  * A model "physical" read is `PHYSICAL_CLAIMED` — plausibility, not proof of possession. Ownership comes
//    only from the operator's explicit attestation (src/lib/ownershipAttestation.js).
//  * When the capture is not plausibly the physical copy (SCREEN_SUSPECTED / UNCERTAIN), physical-condition
//    claims (restoration, defects, CGC penalty flags) are WITHHELD, the grade is annotated PROVISIONAL (never
//    altered — same precedent as the front-only provisional annotation) and the condition report is replaced by
//    a deterministic statement. Reference scanning (identity, comps, price lookup) is preserved.
//  * Foreign-language / foreign-edition claims need a verbatim transcription of the visible non-English text.
//    Without it the flag is dropped and the claim recorded as unsupported; with it the flag stays but is still
//    only an UNVERIFIED CLAIM (api/enrich.js's deriveEditionStanding keeps it UNRESOLVED).

export const CAPTURE_SURFACES = ['physical', 'screen_or_reproduction', 'uncertain'];

export const CAPTURE_STATUS = {
  PHYSICAL_CLAIMED: 'PHYSICAL_CLAIMED',
  SCREEN_SUSPECTED: 'SCREEN_SUSPECTED',
  UNCERTAIN: 'UNCERTAIN',
  NOT_ASSESSED: 'NOT_ASSESSED',
};

export const REFERENCE_ONLY_REASON =
  'Reference image — this capture does not appear to be the physical copy itself (a screen or reproduction was suspected). ' +
  'Identity and market lookups are shown for reference; condition, restoration and defects were not assessed.';

export const UNCERTAIN_CAPTURE_REASON =
  'Capture authenticity could not be established from this image. Condition, restoration and defects were not assessed; ' +
  'any grade shown is provisional.';

/** Never returns a verified state. `verified` is always false. */
export function deriveCaptureAuthenticity(surface) {
  const s = typeof surface === 'string' ? surface.trim().toLowerCase() : null;
  if (s === 'physical') return { status: CAPTURE_STATUS.PHYSICAL_CLAIMED, basis: 'model-claim', verified: false };
  if (s === 'screen_or_reproduction') return { status: CAPTURE_STATUS.SCREEN_SUSPECTED, basis: 'model-claim', verified: false };
  if (s === 'uncertain') return { status: CAPTURE_STATUS.UNCERTAIN, basis: 'model-claim', verified: false };
  return { status: CAPTURE_STATUS.NOT_ASSESSED, basis: 'not-assessed', verified: false };
}

/** Reference-only = the capture itself says it is not the physical copy. */
export const isReferenceOnlyCapture = (auth) => auth?.status === CAPTURE_STATUS.SCREEN_SUSPECTED;

// Sentences asserting a language / foreign / international edition.
const FOREIGN_CLAIM_SENTENCE_RE =
  /\b(thai|thailand|japanese|chinese|korean|spanish|french|german|italian|portuguese|russian|arabic|hindi|turkish|dutch|polish|swedish|indonesian|vietnamese|filipino|tagalog|hebrew|greek|[a-z]+[- ]language|foreign[- ]language|foreign edition|foreign|non[- ]english|international edition|overseas edition|translated|translation)\b/i;

const splitSentences = (text) => String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];

/**
 * Mutates and returns `result`. Tolerates partial objects (ensureAssetType is exported and unit-tested with
 * minimal shapes). Adds: captureAuthenticity, foreignEditionClaim (when a claim existed), gradeProvisional*,
 * referenceOnly, withheldPhysicalClaims.
 */
export function containCaptureEvidence(result) {
  if (!result || typeof result !== 'object') return result;

  // ---- capture authenticity -------------------------------------------------------------------------
  // Idempotent: ensureAssetType runs on every response path and may see an already-contained result —
  // never let a second pass (no raw captureSurface left) downgrade a real SCREEN_SUSPECTED read to NOT_ASSESSED.
  const auth = (result.captureSurface === undefined && result.captureAuthenticity)
    ? result.captureAuthenticity
    : deriveCaptureAuthenticity(result.captureSurface);
  result.captureAuthenticity = auth;
  delete result.captureSurface; // the raw model string is not part of the response contract
  const notPhysical = auth.status === CAPTURE_STATUS.SCREEN_SUSPECTED || auth.status === CAPTURE_STATUS.UNCERTAIN;
  if (notPhysical) {
    const withheld = [];
    if (result.restoration) withheld.push('restoration');
    if (result.defectPenalty) withheld.push('defectPenalty');
    if (result.cgcPenaltyFlags) withheld.push('cgcPenaltyFlags');
    result.restoration = null;
    result.defectPenalty = null;
    result.cgcPenaltyFlags = null;
    result.withheldPhysicalClaims = withheld;
    result.gradeProvisional = true;
    result.gradeProvisionalReason = 'capture-not-physical-evidence';
    result.reason = auth.status === CAPTURE_STATUS.SCREEN_SUSPECTED ? REFERENCE_ONLY_REASON : UNCERTAIN_CAPTURE_REASON;
    result.referenceOnly = auth.status === CAPTURE_STATUS.SCREEN_SUSPECTED;
  }

  // ---- foreign-edition / language claim -------------------------------------------------------------
  const claimed = result.foreignEdition === true;
  const evidenceRaw = typeof result.foreignEditionEvidence === 'string' ? result.foreignEditionEvidence.trim() : '';
  const hasEvidence = evidenceRaw.length >= 2;
  if (claimed || result.foreignEditionEvidence) {
    if (claimed && !hasEvidence) {
      result.foreignEdition = false;
      result.foreignEditionClaim = { claimed: true, status: 'UNSUPPORTED_DROPPED', evidence: null };
    } else if (claimed) {
      result.foreignEditionClaim = { claimed: true, status: 'UNVERIFIED_CLAIM', evidence: evidenceRaw.slice(0, 200) };
    }
  }
  delete result.foreignEditionEvidence;
  if (!notPhysical && typeof result.reason === 'string' && result.reason && !hasEvidence) {
    const kept = [];
    const dropped = [];
    for (const sentence of splitSentences(result.reason)) {
      (FOREIGN_CLAIM_SENTENCE_RE.test(sentence) ? dropped : kept).push(sentence);
    }
    if (dropped.length > 0) {
      result.reason = kept.join('').trim() || null;
      result.droppedUnsupportedEditionClaims = dropped.map((d) => d.trim()).filter(Boolean);
    }
  }
  return result;
}
