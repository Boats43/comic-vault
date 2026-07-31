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

// Track B Phase 0, Commit 4.2 — shared canonical placeholder-year set,
// see buildFingerprintYearToken below and resolveFamilyYearConsensus
// (identityCore.js).
import { normalizeOptionalYear } from './yearEvidence.js';

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
 * every mode other than 'adopted' (and, per the optional second
 * parameter below, other than a retention-branch conflict on either
 * axis) — this function has nothing to say about an ordinary
 * 'corroborated'/'conflict-locked'/'no-consensus'/'no-data' shape, which
 * is handled by pre-existing mechanisms (out.issueConsensusConflict,
 * etc.) untouched by this commit.
 *
 * @param {Object} familyIssueConsensus
 * @param {Object} [familyYearConsensus] - IMPLEMENTATION PACKET HOLD —
 * PRODUCTION AUTHORITY-CONTEXT INTEGRATION HOLD, item 3 (2026-07-31),
 * optional, backward-compatible (every pre-existing call site that omits
 * it behaves byte-identically). Considers the YEAR axis's own retention-
 * branch conflict independently of the issue axis — a "correct" HIGH-
 * confidence-Vision-vs-family issue can coexist with a genuine, separate
 * year conflict (Control T6), and the issue side being fine must never
 * silently swallow a real year-side conflict.
 */
export function deriveIssueAuthorityFromAdoption(familyIssueConsensus, familyYearConsensus) {
  if (familyIssueConsensus?.mode !== 'adopted') {
    // IMPLEMENTATION PACKET HOLD — FINAL AUTHORITY-SOURCE HOLD (2026-07-30)
    // — a Commit 4.3 retention-branch 'conflicted' outcome (rule D: a
    // high-confidence-but-untrusted prior disagreeing with a qualified,
    // unanimous family) is a genuine, UNRESOLVED identity conflict, not
    // the same "nothing to say" shape this function's general null default
    // was designed for (a pre-existing, non-retention 'corroborated'/
    // 'conflict-locked' consensus, correctly left to the separate
    // out.issueConsensusConflict mechanism this function has never
    // touched). Without this branch, a rule-D 'conflicted' outcome fell
    // through to the null default — and canUseExactIssuePricingCache's own
    // `if (issueAuthority == null) return true` default (designed for a
    // DIFFERENT null-issueAuthority shape — a corroborated, already-
    // trustworthy issue) would have silently treated a genuinely conflicted
    // identity as cache-eligible. Caught during this hold's own controls
    // (T1), not shipped silently — see LAUNCH-AUDIT.md.
    //
    // Detected via familyIssueConsensus.outcome/authoritativeForCustody —
    // fields ONLY the Commit 4.3 retention branch ever sets (confirmed: no
    // other call site in this codebase assigns `outcome` onto a consensus
    // object) — so this branch can never misfire on an unrelated,
    // pre-existing 'conflict-locked' shape that predates Commit 4.3.
    if (familyIssueConsensus?.outcome === 'conflicted' && familyIssueConsensus?.authoritativeForCustody === false) {
      // Track B Phase 0, Commit 4.3.1 — familyIssueConsensus.reason, when
      // present, names a SPECIFIC conflict subtype (currently only
      // 'retention-margin-decline-conflict', identityCore.js's near-miss
      // branch) rather than the generic rule-D "high-confidence-Vision-vs-
      // qualified-family" shape this branch was originally written for
      // (which never sets .reason at all). Falls back to the original
      // generic string when absent — byte-identical for every pre-existing
      // caller.
      return {
        issueAuthority: {
          source: 'marketplace',
          status: 'conflicted',
          confidence: 'low',
          supportRatio: null,
          reasons: [familyIssueConsensus.reason || 'vision-family-authority-conflict'],
          priorObservations: [],
        },
        identityProvisionalFields: ['issue'],
      };
    }
    // IMPLEMENTATION PACKET HOLD — PRODUCTION AUTHORITY-CONTEXT
    // INTEGRATION HOLD, item 3 (2026-07-31, Control T6) — a YEAR-ONLY
    // retention-branch conflict (the issue axis may be perfectly fine —
    // 'corroborated', or any other non-adopted, non-conflicted mode; only
    // the year axis disagrees). Same detection convention as the issue
    // branch above (outcome/authoritativeForCustody, exclusive to the
    // Commit 4.3 retention branch) — reason is deliberately distinct
    // ('vision-family-year-authority-conflict', not the issue reason
    // above) so a consumer can tell which axis is actually in dispute.
    // identityProvisionalFields is ['year'] only (never 'issue' — the
    // issue side was never in question here) — this is the field
    // canUseExactIssuePricingCache's own pre-existing
    // `identityProvisionalFields.includes('year')` check already reads,
    // so no change was needed there; the gap was purely that nothing
    // upstream ever populated 'year' into this list for a retention-
    // branch year conflict (appendYearToProvisionalFields only appends
    // 'year' for familyYearConsensus.mode==='adopted', never
    // 'conflict-locked'). The correction field MAY include 'year' (so the
    // existing Commit 3 correction UI can surface an input for it) — the
    // year is never labeled 'adopted' anywhere in this branch.
    if (familyYearConsensus?.outcome === 'conflicted' && familyYearConsensus?.authoritativeForCustody === false) {
      return {
        issueAuthority: {
          source: 'marketplace',
          status: 'conflicted',
          confidence: 'low',
          supportRatio: null,
          reasons: ['vision-family-year-authority-conflict'],
          priorObservations: [],
        },
        identityProvisionalFields: ['year'],
      };
    }
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

/**
 * Track B Phase 0, Commit 4.1 (review round, item 2) — the third,
 * optional `identityProvisionalFields` parameter closes a real gap: a
 * production composition where Vision's ISSUE is trusted (family issue
 * vote reaches `resolveFamilyIssueConsensus` mode `'corroborated'`, not
 * `'adopted'` — no `issueAuthority` object is ever created for a
 * corroborated issue, `deriveIssueAuthorityFromAdoption` returns `null`
 * for every mode except `'adopted'`) while the YEAR is still
 * family-adopted-only (`resolveFamilyYearConsensus` mode `'adopted'`,
 * `'year'` present in `identityProvisionalFields`). Before this fix,
 * `issueAuthority == null` in that exact composition, so this function
 * returned `true` (cacheable) — caching an exact-issue price keyed on a
 * confirmed issue number while the book's YEAR (a real pricing input —
 * grade multipliers and PriceCharting/comp queries are era-sensitive) is
 * still only a marketplace guess would poison the `ac:` namespace the
 * identical way an unconfirmed issue does; year deserves the same
 * containment, not a parallel cache namespace. Backward compatible: the
 * parameter is optional and defaults to a no-op (`undefined` fails
 * `Array.isArray`), so every pre-existing call site and test that never
 * passes it behaves byte-identically to before this fix.
 */
export function canUseExactIssuePricingCache(confirmedIssue, issueAuthority, identityProvisionalFields) {
  if (confirmedIssue == null) return false;
  if (Array.isArray(identityProvisionalFields) && identityProvisionalFields.includes('year')) return false;
  if (issueAuthority == null) return true;
  return CACHE_SAFE_ISSUE_AUTHORITY_STATUSES.has(issueAuthority.status);
}

/**
 * Track B Phase 0, Commit 4.1 (review round, item 2) — the third,
 * optional `identityProvisionalFields` parameter closes the containment
 * gap `canUseExactIssuePricingCache` closes above, for the contract/
 * readiness surface specifically: `computeIssueAuthorityContractPatch`
 * previously gated ENTIRELY on `issueAuthority?.status` — in the same
 * trusted-issue/adopted-year composition described above,
 * `issueAuthority` is `null` (issue was corroborated, not adopted), so
 * this function returned `null` (no patch) and authoritative pricing/
 * listing would have proceeded on a book whose year is still an
 * unconfirmed marketplace guess. `identityProvisionalFields` now
 * participates in the gate independently of `issueAuthority.status` —
 * exactly the instruction this fix follows ("make identityProvisionalFields
 * participate in the contract/readiness gate independently"), reusing this
 * SAME existing patch shape and machinery rather than a parallel
 * `yearAuthority` schema. When issue is ALSO provisional/conflicted
 * (Commit 4's original case), that branch's wording wins unchanged — this
 * only adds a THIRD, year-only branch, never altering the first two.
 * Backward compatible: optional parameter, `undefined` is a safe no-op for
 * every pre-existing call site/test.
 */
export function computeIssueAuthorityContractPatch(issueAuthority, priorOut, identityProvisionalFields) {
  const status = issueAuthority?.status;
  const issueProvisional = status === 'provisional';
  const issueConflicted = status === 'conflicted';
  const yearOnlyProvisional = !issueProvisional && !issueConflicted &&
    Array.isArray(identityProvisionalFields) && identityProvisionalFields.includes('year');

  if (!issueProvisional && !issueConflicted && !yearOnlyProvisional) return null;
  if (priorOut?.refusedToPrice === true) return null;

  let pricingSource, priceNote, listingHardLockReason, listingHardLockBanner;
  if (issueConflicted) {
    pricingSource = 'refused-issue-authority-conflicted';
    priceNote = "Marketplace listings disagree on this book's issue number — price withheld pending verification.";
    listingHardLockReason = 'issue-authority-conflicted';
    listingHardLockBanner = "Marketplace listings disagree on this book's issue number — identification requires manual verification before listing.";
  } else if (issueProvisional) {
    pricingSource = 'refused-issue-authority-provisional';
    priceNote = "This book's issue number was inferred from marketplace listings alone, with no independent confirmation — price withheld pending verification.";
    listingHardLockReason = 'issue-authority-provisional';
    listingHardLockBanner = "This book's issue number was inferred from marketplace listings alone (no Vision or user confirmation) — identification requires manual verification before listing.";
  } else {
    // yearOnlyProvisional — issue is trusted (Vision-confirmed or
    // family-corroborated), only the year is a marketplace-only guess.
    pricingSource = 'refused-year-authority-provisional';
    priceNote = "This book's publication year was inferred from marketplace listings alone, with no independent confirmation — price withheld pending verification.";
    listingHardLockReason = 'year-authority-provisional';
    listingHardLockBanner = "This book's publication year was inferred from marketplace listings alone (no Vision or user confirmation) — identification requires manual verification before listing.";
  }

  const patch = {
    authoritativeRecommendation: null,
    price: null,
    priceLow: null,
    priceHigh: null,
    priceBands: null,
    pricingSource,
    refusedToPrice: true,
    confidenceLevel: 'LOW',
    priceNote,
    matchConfidence: { score: 0, tier: 'LOW' },
    identityConfident: false,
    listingHardLocked: true,
    listingHardLockReason,
    listingHardLockBanner,
  };
  if (priorOut?.price != null) {
    patch.hypotheticalReferenceEstimate = priorOut.price;
  }
  return patch;
}

/**
 * Track B Phase 0, Commit 4.1 — "Not this comic" rejection fingerprint.
 *
 * Investigated before implementation, per instruction: keying rejection on
 * the visual-family CLUSTER LABEL (e.g. the merged family's consensus
 * title string, "spawn brett booth cameo of lyra htf scarce") is NOT
 * stable across separate scans of the same physical book. That label is a
 * byproduct of exactly which listings eBay's reverse-image search happens
 * to return that day (Q45's 60%-of-members token-consensus computation,
 * imageSearchIdentity.js) — a listing being delisted, a new one appearing,
 * or ranking shifting between two scans of the identical photo can change
 * which tokens clear the 60% bar, producing a different label for the
 * SAME underlying candidate. Confirmed directly: the real Spawn #351
 * fixture's own founding-vs-corroborating requests (this dispatch's own
 * investigation) already show the pool composition differing scan to
 * scan (16 vs 18 vs 20 eligible rows across three separate captures of
 * the same photo).
 *
 * Keys on the PROPOSED IDENTITY instead — the thing the user actually
 * looked at and rejected — which is stable once the merge/adoption
 * machinery resolves it: normalized title + adopted/trusted issue +
 * adopted/trusted year + composed variant designation (variant omitted
 * while unresolved). Two separate scans of the same photo that both
 * resolve to the same proposed identity produce the identical fingerprint
 * even if the underlying visual-pool cluster label differs between them.
 *
 * YEAR IS INCLUDED (review round, item 1 — reverses this function's own
 * original "year deliberately omitted" design). The asymmetry that
 * decides it: a title|issue-only key (e.g. "spawn|351") can COLLIDE
 * across genuinely different products sharing the same title+issue text
 * — different volumes, reboots, or renumbered series (the exact
 * same-title/same-issue/different-year shape this codebase has hit
 * before — see the Pattern Library's "Batman #608 class" and "Catwoman
 * #64 Szerdy-variant class" entries in CLAUDE.md). A collision here
 * SILENTLY suppresses a "not this comic" candidate the user never
 * actually rejected — confident and wrong. A year-instability mismatch
 * (the risk the original no-year design was guarding against) merely
 * re-asks the user on the next scan — honest and open. Confident-and-
 * wrong is strictly worse than honest-and-open, so year is included.
 * NEVER silently shortens the identity when year is unavailable: an
 * explicit, stable `'unknown-year'` token is used instead of omitting the
 * segment — `buildFingerprintYearToken` below guarantees this token is
 * itself deterministic (same absent/unresolved input always produces the
 * identical literal string), not an accidental one-off.
 *
 * @param {string|null} title
 * @param {string|number|null} issue
 * @param {string|number|null} year - the ADOPTED/TRUSTED year (post
 *   resolveFamilyYearConsensus, or Vision's own trusted year) — NEVER a
 *   raw per-row or pool-wide value, same authority discipline as `issue`.
 * @param {string|null} variant
 * @returns {string}
 */
export function buildFingerprintYearToken(year) {
  // Track B Phase 0, Commit 4.2 — defense-in-depth, independent of the
  // resolver-entry fix in resolveFamilyYearConsensus (identityCore.js).
  // Reuses the SAME canonical placeholder set (yearEvidence.js) so this
  // function and the resolver can never drift into two different
  // placeholder lists. A semantic placeholder now maps directly to
  // 'unknown-year' — never a normalized-but-meaningless string like
  // "unknown" (the literal, confirmed-live bug this closes: a real
  // production fingerprint read `familyKey="spawn|351|unknown"`, not
  // "spawn|351|unknown-year", because "Unknown" normalized to "unknown"
  // and that non-empty string never reached the old fallback).
  if (normalizeOptionalYear(year) == null) return 'unknown-year';
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const normalized = norm(year);
  return normalized || 'unknown-year';
}

export function buildRejectedCandidateFingerprint(title, issue, year, variant) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [norm(title), norm(issue), buildFingerprintYearToken(year), norm(variant)].filter(Boolean).join('|');
}

/**
 * Track B Phase 0, Commit 4.1 — extracted for testability (same rationale
 * as every other pure-function extraction this campaign has made): the
 * real api/enrich.js call site only ever needs to add 'year' to the
 * existing identityProvisionalFields array when resolveIdentity's
 * family-scoped year vote (resolveFamilyYearConsensus, identityCore.js)
 * actually adopted a value — never unconditionally, never duplicated if
 * already present. No parallel yearAuthority object: year's
 * provisional-ness is expressed entirely through this field plus
 * out.issueAuthority.status (already 'provisional' whenever issue was
 * adopted) — computeIssueAuthorityContractPatch needs no changes to cover
 * it.
 *
 * @param {string[]} identityProvisionalFields
 * @param {{mode: string}|null|undefined} familyYearConsensus
 * @returns {string[]} the same array reference when no change applies
 *   (referential no-op, mirrors escalateIssueAuthorityOnConflict's own
 *   convention), otherwise a NEW array with 'year' appended
 */
export function appendYearToProvisionalFields(identityProvisionalFields, familyYearConsensus) {
  const fields = Array.isArray(identityProvisionalFields) ? identityProvisionalFields : [];
  if (familyYearConsensus?.mode !== 'adopted') return fields;
  if (fields.includes('year')) return fields;
  return [...fields, 'year'];
}

/**
 * Track B Phase 0, Commit 4.1 — builds out.visualReferenceEvidence from
 * ONLY the accepted family's own topFamily.indices, extracted out of
 * api/enrich.js for the same invariant-10 reason as every other function
 * in this file: a test must be able to invoke the real computation
 * directly rather than only exercising it through the full enrich handler.
 *
 * Population discipline (the reason this function exists at all, not just
 * for testability): familyIndices must be the MERGED family's own
 * indices — the exact rows that drove the issue/year consensus vote —
 * never the broader issue-scoped population filterItemsByIssue produces
 * later for variant extraction. Confirmed on the real Spawn #351 fixture:
 * the merged family has 5 rows, but 6 rows in the same pool independently
 * assert issue #351 (one row belongs to neither title-family cluster).
 * Passing the wrong population in would silently broaden this evidence
 * bucket beyond what actually produced the identity.
 *
 * familyKey input discipline (corrected — a real bug found and fixed in
 * review): the first shipped version of this function's call site passed
 * `identity.confirmedTitle`, which in the family-override branch
 * (identityCore.js resolveIdentity, ~line 1331) is
 * `sanitizeSeriesTitle(family.selectedTitle)` — the visual-family CLUSTER
 * LABEL, not the stable proposed identity this key is supposed to capture.
 * Confirmed by direct execution: the real Spawn #351 fixture produced
 * `familyKey: "spawn-brett-booth-cameo-of-lyra-scarce|351"` — cluster-
 * derived and NOT stable across re-scans of the same book (see
 * buildRejectedCandidateFingerprint's own doc comment on pool-composition
 * drift). `stableSeriesTitle` below MUST be Vision's own title read (the
 * `vision.title`/`effectiveTitle` value passed INTO resolveIdentity as the
 * prior, before any family override) or an explicitly normalized
 * base-series field — NEVER `family.selectedTitle`,
 * `identity.confirmedTitle`, `identity.displayTitle`, or any other
 * cluster/consensus-derived string. `stableYear` is the ADOPTED/TRUSTED
 * year (`identity.confirmedYear`, post `resolveFamilyYearConsensus`) —
 * included in the key (review round, item 1 reverses this function's
 * earlier "year omitted" design; see buildRejectedCandidateFingerprint's
 * own doc comment for the collision-vs-instability asymmetry that
 * decided it) via `buildFingerprintYearToken`'s `'unknown-year'` fallback
 * when unavailable, never silently omitted. Variant is likewise omitted
 * while unresolved, never fabricated.
 *
 * @param {number[]} familyIndices - the accepted family's topFamily.indices
 * @param {Array<object>} parsedVisualRows - index-aligned parsed rows (rawTitle/title/price/itemWebUrl)
 * @param {string|null} stableSeriesTitle - Vision's own title (pre-family-override), NEVER a cluster label
 * @param {string|number|null} stableIssue
 * @param {string|number|null} stableYear - the adopted/trusted year, NEVER a raw per-row or pool-wide value
 * @returns {object|null} the visualReferenceEvidence object, or null when
 *   no row in the family carries a usable title+price (nothing to show —
 *   caller should leave out.visualReferenceEvidence unset, never fabricate
 *   a zero-row evidence object)
 */
export function buildVisualReferenceEvidence(familyIndices, parsedVisualRows, stableSeriesTitle, stableIssue, stableYear) {
  const rows = (Array.isArray(familyIndices) ? familyIndices : []).map((idx) => {
    const row = parsedVisualRows?.[idx];
    return {
      title: row?.rawTitle || row?.title || null,
      price: typeof row?.price === 'number' ? row.price : null,
      itemWebUrl: row?.itemWebUrl || null,
    };
  }).filter((r) => r.title != null);

  const prices = rows
    .map((r) => r.price)
    .filter((p) => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b);

  if (rows.length === 0 || prices.length === 0) return null;

  const low = prices[0];
  const high = prices[prices.length - 1];
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];

  return {
    familyKey: buildRejectedCandidateFingerprint(stableSeriesTitle, stableIssue, stableYear, null),
    rows,
    count: rows.length,
    low,
    high,
    median: Math.round(median * 100) / 100,
    marketState: 'active',
    status: 'reference-only',
    reason: 'provisional-visual-family',
  };
}

/**
 * Track B Phase 0, Commit 4.2 — terminal fingerprint finalizer.
 *
 * Root case this closes: `buildVisualReferenceEvidence` runs early in
 * phase 1, using whatever year was known at that point. A LATER, more
 * authoritative year resolution (PriceCharting/ComicVine agreement, via
 * the pre-existing `resolveYear`, identityCore.js) can become available
 * afterward and is never retroactively applied — confirmed live:
 * `[commit4.1] visualReferenceEvidence: ... familyKey="spawn|351|unknown"`
 * followed, later in the SAME request, by
 * `[year-resolved] Unknown → 2024 (source=pc-cv-agreement)`. This function
 * is the terminal re-check that lets a genuinely-improved year replace a
 * placeholder — never anything else.
 *
 * FOUR ACTIONS ONLY: 'no-evidence' | 'fingerprint-custody-mismatch' |
 * 'no-op' | 'restamped'. No conflict-reporting action — REAL-YEAR
 * TERMINAL DIVERGENCE (a phase-1 family-adopted REAL year that later
 * genuinely disagrees with a REAL terminal-resolved year) is explicitly
 * OUT OF SCOPE for this commit: no existing gate contains that specific
 * divergence shape (Ship-28b's own YEAR_DRIFT conflict detector is keyed
 * on {vision, comicVine, priceCharting} only — it never reads the
 * family-vote's own adopted value, so it would not catch this either) —
 * recorded as the REAL-YEAR TERMINAL DIVERGENCE finding, a scoped input
 * to Commit 5's authority work, not solved here. Monotonicity is still
 * enforced: a phase-1 REAL year is NEVER overwritten, regardless of what
 * the terminal value holds — it silently resolves to 'no-op', with no
 * signal raised (the gap the finding above documents honestly).
 *
 * CUSTODY PRECEDES ALL YEAR-ACTION BRANCHING. Two independent links, both
 * required:
 *   - Link 1 (current vs original): has `visualReferenceEvidence.familyKey`
 *     been mutated since `visualReferenceFingerprintContext` was captured?
 *   - Link 2 (original vs expected): was the captured context itself
 *     internally consistent — does rebuilding the fingerprint from its own
 *     captured stableTitle/stableIssue/phaseOneYear reproduce the captured
 *     originalFamilyKey?
 * Either link failing is a custody mismatch — no mutation, no year-action
 * evaluation, one bounded log line. A missing or incomplete context
 * (`visualReferenceFingerprintContext` null, or missing stableTitle/
 * stableIssue/originalFamilyKey) is treated as a custody failure too —
 * NEVER reconstructed from terminal-mutable values (`effectiveTitle`/
 * `confirmedIssue` as read live at the terminal point) — missing context
 * stays inside the four-action matrix as a custody-mismatch, not a fifth
 * action.
 *
 * The `custodyExpected` log selector reports the FIRST broken link: if
 * link 1 failed (current != original), `originalKey` is the more useful
 * diagnostic value (it names what the key was supposed to still be,
 * before whatever touched it); if only link 2 failed (capture-time
 * inconsistency), `expectedKey` is what's useful (it names what a
 * self-consistent capture would have produced). An implementation that
 * always logs `expectedKey` regardless of which link failed loses this
 * distinction — the reason this selector exists rather than a single
 * fixed field.
 *
 * Both the custody expected-key rebuild and the restamp's new-key
 * construction use ONLY the captured `stableTitle`/`stableIssue` from
 * `visualReferenceFingerprintContext` — never `effectiveTitle`/
 * `confirmedIssue` read live at the terminal call site. This function
 * changes only the YEAR SEGMENT of the identity that originally built the
 * key; it never re-derives title or issue.
 *
 * Restamping may change ONLY `visualReferenceEvidence.familyKey` — every
 * other field (`rows`, `count`, `low`, `high`, `median`, `marketState`,
 * `status`, `reason`, and each row's own `title`/`price`/`itemWebUrl`)
 * stays byte-identical, enforced by spreading the original object and
 * overwriting exactly one key.
 *
 * Bounded logging — the ONLY two outputs this function ever produces,
 * fired exactly once each when they apply, never on 'no-op'/'no-evidence':
 *   `[commit4.2] fingerprint custody mismatch current="..." expected="..."`
 *   `[commit4.2] familyKey finalized old="..." new="..." yearSource="..."`
 *
 * @param {object|null} visualReferenceEvidence - out.visualReferenceEvidence, or null/undefined
 * @param {{stableTitle: string, stableIssue: string|number, phaseOneYear: *, originalFamilyKey: string}|null} visualReferenceFingerprintContext
 * @param {*} terminalYear - the fully-resolved terminal year (e.g. the real, current value of `confirmedYear` after `resolveYear` has run)
 * @param {string|null} terminalYearSource - the real, already-computed `yearResolution.yearSource` label (e.g. 'pc-cv-agreement') — never fabricated
 * @returns {{evidence: object|null, action: 'no-evidence'|'fingerprint-custody-mismatch'|'no-op'|'restamped'}}
 */
export function restampVisualReferenceEvidenceYear(visualReferenceEvidence, visualReferenceFingerprintContext, terminalYear, terminalYearSource) {
  if (!visualReferenceEvidence) {
    return { evidence: visualReferenceEvidence, action: 'no-evidence' };
  }

  const hasCompleteContext = visualReferenceFingerprintContext != null &&
    visualReferenceFingerprintContext.stableTitle != null &&
    visualReferenceFingerprintContext.stableIssue != null &&
    'phaseOneYear' in visualReferenceFingerprintContext &&
    visualReferenceFingerprintContext.originalFamilyKey != null;

  if (!hasCompleteContext) {
    console.log(`[commit4.2] fingerprint custody mismatch current="${visualReferenceEvidence.familyKey}" expected="unavailable/missing-context"`);
    return { evidence: visualReferenceEvidence, action: 'fingerprint-custody-mismatch' };
  }

  const currentKey = visualReferenceEvidence.familyKey;
  const originalKey = visualReferenceFingerprintContext.originalFamilyKey;
  const expectedKey = buildRejectedCandidateFingerprint(
    visualReferenceFingerprintContext.stableTitle,
    visualReferenceFingerprintContext.stableIssue,
    visualReferenceFingerprintContext.phaseOneYear,
    null
  );

  if (currentKey !== originalKey || originalKey !== expectedKey) {
    const custodyExpected = currentKey !== originalKey ? originalKey : expectedKey;
    console.log(`[commit4.2] fingerprint custody mismatch current="${currentKey}" expected="${custodyExpected}"`);
    return { evidence: visualReferenceEvidence, action: 'fingerprint-custody-mismatch' };
  }

  // Custody passed (both links). Four-action year matrix — no conflict
  // branch (REAL-YEAR TERMINAL DIVERGENCE deliberately out of scope).
  const phaseOneToken = buildFingerprintYearToken(visualReferenceFingerprintContext.phaseOneYear);
  const terminalToken = buildFingerprintYearToken(terminalYear);

  if (phaseOneToken !== 'unknown-year') {
    // Phase-1 already real — ALWAYS no-op, regardless of terminal value.
    return { evidence: visualReferenceEvidence, action: 'no-op' };
  }
  if (terminalToken === 'unknown-year') {
    return { evidence: visualReferenceEvidence, action: 'no-op' };
  }

  const newFamilyKey = buildRejectedCandidateFingerprint(
    visualReferenceFingerprintContext.stableTitle,
    visualReferenceFingerprintContext.stableIssue,
    terminalYear,
    null
  );
  console.log(`[commit4.2] familyKey finalized old="${currentKey}" new="${newFamilyKey}" yearSource="${terminalYearSource}"`);
  return { evidence: { ...visualReferenceEvidence, familyKey: newFamilyKey }, action: 'restamped' };
}

/**
 * Track B Phase 0, Commit 4.3 (Section E, revised — shared custody
 * invariant, 2026-07-30) — cross-population promotion/cache/pricing/
 * response custody guard.
 *
 * Root case this closes: api/enrich.js's identity-refused PROMOTED branch
 * (Q133 Slice 2) lets Phase 2 run normally "with the pool's provisional
 * identity" whenever the pool's own top family clears a >=3-member
 * promotion floor — but never actually checked that the family's own
 * issue consensus AGREES with confirmedIssue/pricingIssue before
 * promoting. Confirmed live (2026-07-30 23:16:50 production dispatch,
 * pre-Commit-4.3 build): a 5-member Spawn #351 family (5/5 internal issue
 * support) justified "PROMOTED", but confirmedIssue/pricingIssue had
 * separately been set to #300 (an unrelated raw-pool plurality) — Phase 2
 * went on to query, cache, and price Spawn #300 while the promotion
 * banner and reference evidence both spoke of the #351 family.
 *
 * REVISED (implementation-approval addendum, Precision Clause 1): consumes
 * the measure/decide split's own decide-result object directly —
 * `authoritativeForCustody` and `resolvedValue` — NEVER reconstructs
 * authority from `familyIssueConsensus.mode` string matching. This is
 * what lets a 'provisionally-corrected' outcome (the Spawn fixture's own
 * path — a real correction, not a fresh null-prior "adoption") be
 * correctly recognized as authoritative for custody, alongside 'adopted'
 * and 'corroborated' — the original draft's `mode === 'adopted'` check
 * would have missed 'corroborated' entirely (Matrix C finding) and had no
 * way to represent 'provisionally-corrected' as a distinct, still-
 * authoritative outcome at all.
 *
 * Deliberately conservative: only blocks when `authoritativeForCustody`
 * is exactly `true` AND at least one of the supplied custody values
 * genuinely disagrees with `resolvedValue`. A decision that isn't
 * authoritative for custody (`'preserved-prior'` with an untrusted prior,
 * or `'conflicted'`) has nothing to assert custody over, and is not
 * blocked here — those are pre-existing, separate signals (e.g.
 * `out.issueConsensusConflict`) this guard does not duplicate or
 * re-decide.
 *
 * Called from four sites (api/enrich.js): before promotion, before
 * exact-cache access, before the terminal authoritative-pricing contract
 * patch, and before response finalization (`out.issue` write) — composed
 * with, not duplicating, the pre-existing Q140 `detectVisualIssueDivergence`
 * (a different source pair: visual-pool consensus vs. confirmedIssue).
 * Each site passes only the custody value(s) it actually has at that
 * point in the pipeline.
 *
 * Pure, no console/log side effects — the caller decides what to log.
 *
 * @param {{resolvedValue: *, authoritativeForCustody: boolean}|null} familyIssueDecision - identity.familyIssueConsensus (Commit 4.3 retention branch shape — carries the decide-result fields directly; undefined/absent on the pre-existing FAMILY_OVERRIDE_DECISIONS/refused-identity-conflict branches, which are unaffected by this guard and rely on their own pre-existing containment)
 * @param {Object.<string, *>} custodyValues - a map of custody-relevant field name -> value known at THIS call site (e.g. {confirmedIssue, pricingIssue} at promotion; {cacheIssue} at cache access; {responseIssue} at response finalization) — null/undefined entries are skipped (not yet known, not a mismatch)
 * @returns {{allowed: boolean, conflict: null|{selectedFamilyIssue: *, mismatchedField: string, mismatchedValue: *, custodyValues: Object, reason: string}}}
 */
export function checkCrossPopulationPromotionGuard(familyIssueDecision, custodyValues) {
  if (!familyIssueDecision || familyIssueDecision.authoritativeForCustody !== true) {
    return { allowed: true, conflict: null };
  }
  const resolvedValue = familyIssueDecision.resolvedValue;
  if (resolvedValue == null) {
    return { allowed: true, conflict: null };
  }
  const entries = Object.entries(custodyValues || {}).filter(([, v]) => v != null);
  const mismatch = entries.find(([, v]) => String(v) !== String(resolvedValue));
  if (mismatch) {
    const [mismatchedField, mismatchedValue] = mismatch;
    return {
      allowed: false,
      conflict: {
        selectedFamilyIssue: resolvedValue,
        mismatchedField,
        mismatchedValue,
        custodyValues,
        reason: `${mismatchedField}-diverges-from-resolved-family-issue`,
      },
    };
  }
  return { allowed: true, conflict: null };
}

// Track B Phase 0, Commit 4.3 (Matrix D, 2026-07-30) — computeListingPricingAuthority
// was implemented then REMOVED from this commit, per explicit reviewer
// ruling: it was a second, parallel pricing-readiness contract sitting
// alongside the existing, unmodified Commit 4 computeIssueAuthorityContractPatch
// above, without clearing every legacy price/band/routing/UI-alias field
// that function already owns — a real risk of contradictory states. This
// commit's own test assertions proved the EXISTING contract (price/
// priceBands nulled, refusedToPrice/listingHardLocked set) already
// satisfies every observable requirement for the Spawn #351 closure
// without it. The four field names it introduced (recommendedListPrice/
// priceReady/pricingAuthority/listingAuthority) are real Commit 6 design
// work — deciding the full field set and reconciling it against every
// existing consumer — not a two-function bolt-on. See LAUNCH-AUDIT.md
// Section 16 for the full record.
