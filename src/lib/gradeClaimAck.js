// GK-280A amendment — client acknowledgment of the server's grade-claim outcome. The collection save
// and the grade claim are SEPARATE facts: a save can succeed while the claim is refused. This pure
// helper records the claim outcome on the LOCAL entry so an unclaimed prediction is never
// represented as associated, and drops the (single-purpose) credential once the server has decided.
//
//   save ok + claim ASSOCIATED/ALREADY_ASSOCIATED -> _gradeClaimStatus 'ASSOCIATED', credentials dropped
//   save ok + claim REFUSED                        -> _gradeClaimStatus 'REFUSED' (+ bounded code), credentials dropped
//                                                     (every refusal is terminal: re-sending cannot change it)
//   push failed / 503 unavailable / no credential  -> entry unchanged (stays pending; the same credential is retried)
//
// The status fields are LOCAL markers only: collectionSync strips them before any push.

const CODE_RE = /^GRADE_CLAIM_[A-Z_]{3,40}$/;

export function applyGradeClaimAck(entry, claim, synced) {
  if (!entry || synced !== true || !claim || typeof claim.status !== 'string') return entry;
  const next = { ...entry };
  if (claim.status === 'ASSOCIATED' || claim.status === 'ALREADY_ASSOCIATED') {
    delete next._gradeProof; delete next._gradeReceiptId; delete next._gradeClaimCode;
    next._gradeClaimStatus = 'ASSOCIATED';
    return next;
  }
  if (claim.status === 'REFUSED') {
    delete next._gradeProof; delete next._gradeReceiptId;
    next._gradeClaimStatus = 'REFUSED';
    next._gradeClaimCode = typeof claim.code === 'string' && CODE_RE.test(claim.code) ? claim.code : 'GRADE_CLAIM_OTHER';
    return next;
  }
  return entry;
}

/** True when the entry is known to have NO server-side prediction association (never claim it is associated). */
export const isGradeClaimUnassociated = (entry) => entry?._gradeClaimStatus === 'REFUSED';
