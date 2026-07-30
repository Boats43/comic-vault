// src/lib/issueAuthority.js
//
// Track B Phase 0, Commit 4 (2026-07-29) — pure functions computing the
// issueAuthority object and its downstream contract transition for a
// marketplace-only-adopted issue number. Extracted so api/enrich.js's real
// call sites and this feature's tests invoke the IDENTICAL logic (invariant
// 10), mirroring the pattern already established by
// src/lib/manualCorrection.js (Commit 3) and buildActiveCompCacheKey
// (Commit 3, Safeguard 2 amendment).
//
// Corrected invariant (the reason this file exists): when
// resolveFamilyIssueConsensus (identityCore.js) returns mode:'adopted' —
// only reachable when priorIssue was null, i.e. no Vision/user issue
// existed to corroborate or conflict with — the resulting issue number is
// ALWAYS provisional, never silently promoted to a confirmed value just
// because nothing contradicted it. Absence of contradiction is not
// corroboration. An earlier draft of the Track B Phase 0 plan considered a
// control where "no contradiction detected" would let a marketplace-only-
// adopted issue display as confirmed — that control was never implemented
// in shipped code; every function below is its replacement and contains no
// such carve-out.

/**
 * Maps a raw adoption-vote ratio to the SAME string confidence-tier
 * vocabulary Commit 3's issueAuthority.confidence already uses
 * (manualCorrection.js:602, `confidence: 'high'`) — issueAuthority.confidence
 * is one field with one type across every writer; a number here and a
 * string there is the same drifted-duplicate-constant shape this
 * codebase has hit before (Q119/Q127/Q128 — see the Pattern Library),
 * just at the type level instead of the value level.
 *
 * resolveFamilyIssueConsensus's own adoption bar (ratio >= 0.6) makes
 * 'low' structurally unreachable via the real 'adopted' path — kept as an
 * honest defensive default anyway, never silently coerced to 'medium'.
 */
export function mapConfidenceRatioToTier(ratio) {
  if (ratio >= 0.8) return 'high';
  if (ratio >= 0.6) return 'medium';
  return 'low';
}

/**
 * Derives the initial issueAuthority object (and the client-facing
 * identityProvisionalFields list) from a resolveFamilyIssueConsensus
 * result, at the moment identity resolution runs. Reuses the SAME object
 * shape Commit 3 introduced for manual-correction provenance
 * (source/status/confidence/reasons/priorObservations) — no parallel
 * schema, including confidence's type (string tier, not a number — see
 * mapConfidenceRatioToTier above). The raw adoption ratio is never
 * discarded — it survives as its own dedicated supportRatio field, so
 * no information is lost relative to the number this function used to
 * put directly on confidence.
 *
 * Returns { issueAuthority: null, identityProvisionalFields: null } for
 * every mode other than 'adopted' — this function has nothing to say about
 * 'corroborated'/'conflict-locked'/'no-consensus'/'no-data', which are
 * handled by pre-existing mechanisms (out.issueConsensusConflict, etc.)
 * untouched by this commit.
 */
export function deriveIssueAuthorityFromAdoption(familyIssueConsensus) {
  if (familyIssueConsensus?.mode !== 'adopted') {
    return { issueAuthority: null, identityProvisionalFields: null };
  }
  const supportRatio = Number(familyIssueConsensus.ratio.toFixed(2));
  return {
    issueAuthority: {
      source: 'marketplace',
      status: 'provisional',
      confidence: mapConfidenceRatioToTier(familyIssueConsensus.ratio),
      supportRatio,
      reasons: ['marketplace-only-adoption'],
      priorObservations: [],
    },
    identityProvisionalFields: ['issue'],
  };
}

/**
 * Escalates a marketplace-only-adopted 'provisional' issueAuthority to
 * 'conflicted' when a LATER marketplace population disagrees with it
 * (api/enrich.js's own visual-pool issue-divergence check, surfaced as
 * out.issueConsensusConflict). This is NOT an independent corroboration
 * source in the sense that would justify promoting status toward
 * 'confirmed' — both signals originate from the same marketplace/pool
 * evidence class, just differently-scoped populations (the family-scoped
 * adoption vote vs. the later, pool-wide eBay visual consensus). Genuine
 * independence — the kind that could ever promote an issue to 'confirmed'
 * — means a non-marketplace source: Vision, physical indicia/fingerprint,
 * or an explicit user correction (Commit 3). A same-source disagreement is
 * still worth surfacing (uncertainty escalates, never resolves itself),
 * which is exactly and only what this function does: escalate to
 * 'conflicted', never promote. Preserves every existing reason and appends
 * the new one — never drops a reason, never silently reverts status back
 * toward 'confirmed'.
 *
 * Pure: returns a NEW object when escalating (never mutates the input),
 * and returns the SAME reference unchanged when no escalation applies —
 * callers can rely on referential equality to detect a no-op.
 *
 * Only escalates a 'provisional' status that was reached via
 * marketplace-only-adoption specifically (checked via the reasons array,
 * not just status) — this function has nothing to say about a
 * 'provisional'/'conflicted' status that might arrive here via some future,
 * different reason.
 */
export function escalateIssueAuthorityOnConflict(issueAuthority, issueConsensusConflict) {
  if (
    issueAuthority?.status === 'provisional' &&
    Array.isArray(issueAuthority.reasons) &&
    issueAuthority.reasons.includes('marketplace-only-adoption') &&
    issueConsensusConflict
  ) {
    return {
      ...issueAuthority,
      status: 'conflicted',
      reasons: issueAuthority.reasons.includes('visual-pool-issue-divergence')
        ? issueAuthority.reasons
        : [...issueAuthority.reasons, 'visual-pool-issue-divergence'],
    };
  }
  return issueAuthority;
}

/**
 * Computes the explicit server-side contract-transition patch for a
 * marketplace-only-adopted issue identity. Positioned to run as the LAST
 * terminal check before out.decision = computeDecision(...) — the caller
 * is responsible for merging the returned patch into `out` at that exact
 * point, so nothing downstream can re-touch price after this clears it.
 *
 * Mechanism: patch.identityConfident = false reuses decisionEngine's OWN
 * pre-existing 'identity-not-confident' blocker (no new blocker slug
 * invented) — decisionEngine deterministically sets
 * decision.action='ID_REQUIRED' from that blocker (when no exemption flag
 * is set, which this patch never sets), which responseContract.js's
 * deriveState() resolves to contract state 'ID_REQUIRED' at its FIRST
 * precedence check — the same contract-state class already used for
 * REFUSED/ID_REQUIRED this dispatch calls for, never the Q110 LOCKED class
 * (which keeps price visible with only the List button gated — correct
 * for advisory conditions on an otherwise-known identity, wrong here: this
 * issue number isn't known at all, only guessed from comp titles with zero
 * corroboration). patch.refusedToPrice=true is set too as an explicit,
 * redundant second signal (deriveState's very next check) — belt-and-
 * suspenders, matching the established multi-block pattern in
 * api/enrich.js (Q140/Commit-B/E1).
 *
 * I13 custody: this patch NEVER touches rawComps/soldComps — the comp pool
 * a customer scanned for is real data and stays visible with its own
 * annotations; only the derived price/recommendation is withheld.
 * hypotheticalReferenceEstimate preserves whatever price the pipeline
 * computed (mirrors Commit B's item B.4) so the value is relabeled, never
 * silently deleted.
 *
 * Returns null when no transition applies: either issueAuthority.status is
 * not 'provisional'/'conflicted', or a more fundamental refusal already
 * fired (priorRefusedToPrice === true — one refusal reason per card, same
 * discipline as Commit B/E1's own `!out.refusedToPrice` guards).
 */
/**
 * Whether the exact-pricing `ac:` active-comp cache namespace (Commit B.1's
 * containment surface, extended here) may be read from or written to for
 * this request. Extracted so the real api/enrich.js cache-guard call site
 * and this feature's tests share one implementation (invariant 10) —
 * previously an inline `confirmedIssue != null && issueAuthority?.status
 * !== 'provisional' && ... !== 'conflicted'` composition at the call site,
 * now a single named, testable predicate.
 *
 * Fail-closed (review-round fix), not fail-open: the first version
 * BLOCKLISTED the two known-bad statuses (`'provisional'`/`'conflicted'`)
 * and allowed everything else through, including a status value nobody
 * anticipated — a future third status, a typo, a bug elsewhere writing
 * something unexpected onto issueAuthority.status, would all have silently
 * defaulted to CACHEABLE. This function's entire purpose is preventing a
 * not-yet-trustworthy issue from poisoning the cache namespace; failing
 * open on the unknown case defeats that purpose. Now ALLOWLISTS the known-
 * safe shapes instead: no `issueAuthority` object at all (the ordinary,
 * pre-campaign case — ~99% of requests, no regression), or an explicit
 * `status: 'confirmed'` (Commit 3's user-correction path and any future
 * non-marketplace corroboration). Everything else — `'provisional'`,
 * `'conflicted'`, and any value this function has never seen before — is
 * ineligible by default. Conservative direction on uncertainty, same
 * standing project posture as pricing/identification generally.
 */
const CACHE_SAFE_ISSUE_AUTHORITY_STATUSES = new Set(['confirmed']);

export function canUseExactIssuePricingCache(confirmedIssue, issueAuthority) {
  if (confirmedIssue == null) return false;
  if (issueAuthority == null) return true;
  return CACHE_SAFE_ISSUE_AUTHORITY_STATUSES.has(issueAuthority.status);
}

export function computeIssueAuthorityContractPatch(issueAuthority, priorOut) {
  const status = issueAuthority?.status;
  if (status !== 'provisional' && status !== 'conflicted') return null;
  if (priorOut?.refusedToPrice === true) return null;

  const isConflicted = status === 'conflicted';
  const patch = {
    authoritativeRecommendation: null,
    price: null,
    priceLow: null,
    priceHigh: null,
    priceBands: null,
    pricingSource: isConflicted
      ? 'refused-issue-authority-conflicted'
      : 'refused-issue-authority-provisional',
    refusedToPrice: true,
    confidenceLevel: 'LOW',
    priceNote: isConflicted
      ? "Marketplace listings disagree on this book's issue number — price withheld pending verification."
      : "This book's issue number was inferred from marketplace listings alone, with no independent confirmation — price withheld pending verification.",
    matchConfidence: { score: 0, tier: 'LOW' },
    identityConfident: false,
    listingHardLocked: true,
    listingHardLockReason: isConflicted ? 'issue-authority-conflicted' : 'issue-authority-provisional',
    listingHardLockBanner: isConflicted
      ? "Marketplace listings disagree on this book's issue number — identification requires manual verification before listing."
      : "This book's issue number was inferred from marketplace listings alone (no Vision or user confirmation) — identification requires manual verification before listing.",
  };
  if (priorOut?.price != null) {
    patch.hypotheticalReferenceEstimate = priorOut.price;
  }
  return patch;
}
