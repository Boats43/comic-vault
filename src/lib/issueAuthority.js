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
// GrailKey Commit P (P1) — reusing the SAME primitives Commit 4.3's
// qualified-family-authority retention gate already uses (identityCore.js),
// not a parallel membership/contamination check. detectSeriesMarkers is the
// existing sequel/volume-asymmetry detector (compHygiene.js, also used by
// api/comps.js's Filter 0 and soldVerification.js) — reused here for
// internal same-series consistency across a family's own members, a check
// that has no prior home in the identity-resolution pipeline (only ever
// applied comp-pool-side before this commit).
import { hasValidFamilyMembership, hasContaminatedMember, detectSeriesMarkers, familyDominatesRunnerUp } from './compHygiene.js';
// GrailKey Commit Q (Q0, 2026-08-03) — reuses responseContract.js's own
// parsePriceNumber, the SAME coercion the response-contract layer already
// applies to every other price field it assembles ("Parse any price
// representation the pipeline produces into a number. Handles fmtUsd
// strings, raw numbers, and null/undefined/NaN -> null."). No second,
// independently-maintained price parser invented for this one field.
import { parsePriceNumber } from './responseContract.js';

// GrailKey Commit P (P1, 2026-08-03) — high-confidence marketplace-consensus
// carve-out for commit4-terminal.
//
// Root problem this closes: commit4-terminal (computeIssueAuthorityContractPatch
// below) nulls out.price the instant issueAuthority.status is 'provisional'
// — it fires on the LABEL "marketplace-only-adoption" alone and never
// inspects how strong the underlying consensus actually was. The real
// Spawn #351 production trace (GrailKey full-pipeline audit, 2026-08-03)
// showed a genuinely computed $21.25 (Ship 11's visual-pool fallback)
// discarded this way even though the family that drove the adoption was 5
// members, weight 14.0, 100% token overlap, with no competing family at
// all — the strongest shape this pipeline's own consensus machinery can
// produce. issueAuthority.status stays 'provisional' either way (P-2) —
// this predicate governs ONLY whether commit4-terminal's contract patch
// hides an already-computed price, never whether the issue number itself
// is trusted enough to cache, query PC/CV, or list without confirmation
// (canUseExactIssuePricingCache, below, is completely untouched by this
// commit — a separate, later-scoped finding, not fixed here).
//
// HIGH_CONFIDENCE_WEIGHT_FLOOR = 12, justified from getRankWeight's own
// scale (imageSearchIdentity.js): the top 3 eBay search ranks are worth
// 5 + 4 + 3 = 12. That is the MAXIMUM weight three members could carry
// using only the highest-ranked results the pool offers — i.e. the
// strongest signal obtainable at the minimum required member count (3,
// the same FAMILY_AUTHORITY_COHERENCE_FLOOR Commit 4.3's retention gate
// already uses). A family clearing 12 has either 3+ members drawn from
// the top 3 ranks, or a broader membership compensating for lower rank —
// either way, requiring at least this much rules out a family that
// scraped together its 3-member floor entirely from the weak, long tail
// (ranks 10-19, worth 0.5 each). The real Spawn #351 trace's weightSum
// (14.0) clears this floor with room (one of its 5 members ranked outside
// the top 3).
export const HIGH_CONFIDENCE_WEIGHT_FLOOR = 12;

/**
 * Internal-consistency check across a title-family's own members: no
 * member may carry a sequel/volume/format marker (roman numeral, Vol-N,
 * Part-N, Book-N, Annual/Special/King-Size) that another member lacks.
 * Reuses detectSeriesMarkers (compHygiene.js) — the SAME sequel-asymmetry
 * detector api/comps.js's Filter 0 and soldVerification.js already apply
 * comp-pool-side — rather than a new pattern set. The simplest, most
 * conservative reading of "same series": every member's marker signature
 * (sorted, joined) must be identical. In practice this means the common
 * case (no member carries any marker at all) passes trivially, and any
 * family mixing a "Vol. 2" listing with a bare listing, or a "Part 3"
 * with a "Part 4", fails — exactly the asymmetry shape the sequel-filter
 * already exists to catch, applied here to the family's own internal
 * coherence rather than our-title-vs-a-comp.
 *
 * @param {Array} visualItems - the raw pool rows (index-aligned)
 * @param {number[]} indices - the family's own topFamily.indices
 * @returns {boolean} true when an asymmetry exists (i.e. NOT same-series)
 */
export function hasFamilySeriesMarkerAsymmetry(visualItems, indices) {
  const rows = Array.isArray(indices) ? indices : [];
  let baseline = null;
  for (const idx of rows) {
    const item = visualItems?.[idx];
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    const signature = detectSeriesMarkers(raw).slice().sort().join(',');
    if (baseline === null) {
      baseline = signature;
    } else if (signature !== baseline) {
      return true;
    }
  }
  return false;
}

/**
 * The P1 gate itself. Every condition is either an existing, reused
 * predicate (hasValidFamilyMembership / hasContaminatedMember, both
 * Commit 4.3's own primitives, compHygiene.js) or a direct field read off
 * the title-family clustering result — no new consensus computation.
 *
 * Deliberately scoped to `decision === 'weighted-consensus'` only (not
 * 'top-rank-protection', which the real reference case never used, and
 * carries a structurally different weight/overlap shape this predicate
 * was not built or tested against) — narrower than "any family override",
 * matching the reference case exactly rather than generalizing past it.
 *
 * GrailKey Commit P2 (Part A, 2026-08-03) — CORRECTED. The original
 * Commit P version required `runnerUp` to be TRUE ABSENCE (no
 * second-place family scored at all), documented at the time as "the
 * stricter of the two readings available." That reading made this gate
 * dead code in production: all 3 real Spawn #351 requests the audit
 * captured carried a nonzero runner-up (weight 2.5 or 4.0 against a top
 * family of 14.0 or 10.0), so the literal-absence check never fired on
 * any of them. Now reuses the SAME dominance predicate
 * (`familyDominatesRunnerUp`, compHygiene.js) Commit 4.3's own qualified-
 * family-authority retention gate already applies to this exact
 * topFamily/runnerUp shape (identityCore.js's `familyAuthorityMarginQualifies`)
 * — a runner-up is tolerated only when the selected family outweighs it
 * by 3x or more (`topWeightSum >= runnerUpWeightSum * 3`; no real
 * runner-up at all, i.e. null/zero/undefined weightSum, also passes —
 * "nothing to dominate"). Not a weaker bar than the retention gate: it is
 * the identical function, so the two can never drift apart. The real
 * Spawn #351 shape (14.0 vs 2.5, a 5.6x margin) clears this with room.
 *
 * @param {{decision: string, topFamily: object, runnerUp: object|null, overlapRatio: number}|null} familyCandidate
 * @param {Array} visualItems - the raw pool rows the family's indices reference
 * @returns {boolean}
 */
export function meetsHighConfidenceMarketplaceConsensusBar(familyCandidate, visualItems) {
  if (!familyCandidate || familyCandidate.decision !== 'weighted-consensus') return false;
  const topFamily = familyCandidate.topFamily;
  if (!topFamily) return false;
  if (!hasValidFamilyMembership(visualItems, topFamily.indices, topFamily.count)) return false;
  if (!(topFamily.count >= 3)) return false;
  if (!(topFamily.weightSum >= HIGH_CONFIDENCE_WEIGHT_FLOOR)) return false;
  if (familyCandidate.overlapRatio !== 1) return false;
  if (!familyDominatesRunnerUp(topFamily.weightSum, familyCandidate.runnerUp?.weightSum)) return false;
  if (hasContaminatedMember(visualItems, topFamily.indices)) return false;
  if (hasFamilySeriesMarkerAsymmetry(visualItems, topFamily.indices)) return false;
  return true;
}

// GrailKey Dispatch 25 (2026-08-07) — Fix 2/2b, unanimous-consensus
// promotion (provisional -> confirmed). A STRICTER, SEPARATE gate from
// P1 above: P1 (meetsHighConfidenceMarketplaceConsensusBar) governs
// only whether commit4-terminal's contract patch hides an already-
// computed price — issueAuthority.status stays 'provisional' either
// way (P-2, the standing invariant this whole file exists to enforce:
// absence of contradiction is not corroboration). This gate is the
// deliberate, narrow exception to that invariant: when consensus is
// not just strong but UNANIMOUS (zero dissent, not merely a clear
// lead) AND independently corroborated by non-collusion signals
// (distinct sellers, distinct listings), the marketplace pool itself
// becomes the corroboration Vision/the user failed to supply — this is
// no longer "nothing contradicted it," it is affirmative, redundant
// agreement from independent sources.
//
// Shared by both the issue-axis (evaluateUnanimousConsensusPromotion)
// and year-axis (evaluateUnanimousYearConsensusPromotion) predicates.
// Missing/null itemId or seller data is treated as a FAILURE, not a
// pass — this codebase's standing "conservative when uncertain"
// posture, and seller-distinctness specifically is the anti-injection
// guard replacing the corroboration Vision never provided (a single
// seller listing 4 near-identical rows under different item IDs is not
// 4 independent sources).
//
// @param {number[]} indices - the specific member indices to check (NOT necessarily the full family — the year-axis caller passes only the asserting subset)
// @param {Array} visualItems - the raw pool rows the indices reference
// @returns {{distinct: boolean, reason: string|null, itemIdCount: number, uniqueItemIdCount: number, sellerCount: number, uniqueSellerCount: number}}
//
// GrailKey Dispatch 27 (2026-08-08) — exported. Was module-private; Fix
// 27-A (src/lib/variantIdentity.js, coverType consensus) needed the same
// anti-injection distinctness check on a different token axis. Exporting
// the real function rather than writing a second copy — a duplicate here
// would be GK-40's own drifted-vocabulary class reproduced inside the fix
// meant to close a GK-40 symptom.
export function checkDistinctItemIdAndSeller(indices, visualItems) {
  const rows = Array.isArray(indices) ? indices : [];
  const itemIds = [];
  const sellers = [];
  for (const idx of rows) {
    const item = visualItems?.[idx];
    if (item == null || typeof item === 'string') continue;
    itemIds.push(item.itemId || item.legacyItemId || null);
    sellers.push(item.sellerUsername || null);
  }
  const uniqueItemIds = new Set(itemIds);
  const uniqueSellers = new Set(sellers);
  const itemIdsDistinct = itemIds.length > 0 && !itemIds.includes(null) && uniqueItemIds.size === itemIds.length;
  const sellersDistinct = sellers.length > 0 && !sellers.includes(null) && uniqueSellers.size === sellers.length;
  return {
    distinct: itemIdsDistinct && sellersDistinct,
    reason: !itemIdsDistinct ? 'duplicate-or-missing-itemId' : (!sellersDistinct ? 'duplicate-or-missing-seller' : null),
    itemIdCount: itemIds.length,
    uniqueItemIdCount: uniqueItemIds.size,
    sellerCount: sellers.length,
    uniqueSellerCount: uniqueSellers.size,
  };
}

/**
 * Fix 2 — issue-axis unanimous-consensus promotion. Every input is read
 * directly off resolveFamilyIssueConsensus's own return shape
 * (identityCore.js) — uniqueRows/support/runnerUp are ALREADY scoped to
 * winning-family membership (the `indices` argument passed into that
 * function is the family's own topFamily.indices, never the raw pool),
 * so no population correction is needed on this axis (contrast Fix 2b
 * below, where a real wrong-population defect was found and fixed
 * before this predicate was written).
 *
 * `support === uniqueRows` (integer comparison), not `ratio === 1`
 * (float comparison) — same value for realistic small integer counts,
 * chosen to avoid float-equality risk entirely rather than rely on it
 * being safe.
 *
 * Every condition failing independently declines (predicate order
 * matters only for which declineReason is reported first — the FIRST
 * failing condition is named, not every one that would fail).
 *
 * @param {{uniqueRows: number, support: number, runnerUp: string|null}|null} familyIssueConsensus
 * @param {{topFamily: {indices: number[], weightSum: number}}|null} familyCandidate
 * @param {Array} visualItems
 * @returns {{promote: boolean, declineReason: string|null, inputs: object}}
 */
export function evaluateUnanimousConsensusPromotion(familyIssueConsensus, familyCandidate, visualItems) {
  const inputs = {
    uniqueRows: familyIssueConsensus?.uniqueRows ?? null,
    support: familyIssueConsensus?.support ?? null,
    runnerUp: familyIssueConsensus?.runnerUp ?? null,
    weightSum: familyCandidate?.topFamily?.weightSum ?? null,
  };
  if (!(inputs.uniqueRows >= 4)) {
    return { promote: false, declineReason: 'uniqueRows<4', inputs };
  }
  if (!(inputs.support === inputs.uniqueRows)) {
    return { promote: false, declineReason: 'not-exact-unanimity', inputs };
  }
  if (inputs.runnerUp !== null) {
    return { promote: false, declineReason: 'runnerUp-present', inputs };
  }
  if (!(inputs.weightSum >= 8.0)) {
    return { promote: false, declineReason: 'weightSum<8.0', inputs };
  }
  const memberCheck = checkDistinctItemIdAndSeller(familyCandidate?.topFamily?.indices, visualItems);
  if (!memberCheck.distinct) {
    return { promote: false, declineReason: memberCheck.reason, inputs: { ...inputs, ...memberCheck } };
  }
  return { promote: true, declineReason: null, inputs: { ...inputs, ...memberCheck } };
}

// GrailKey Dispatch 26, Fix 4, condition 6 (2026-08-08) — title-text
// independence. checkDistinctItemIdAndSeller (above) proves listings were
// independently POSTED (distinct accounts, distinct item IDs) — it cannot
// detect independently PROPAGATED wording: eBay sellers routinely copy a
// competitor's listing title verbatim for search-ranking reasons (a
// well-documented, non-adversarial marketplace behavior, not collusion),
// which produces N distinct sellers all carrying ONE mislabeling error —
// indistinguishable, to that check, from N sellers who each independently
// identified the book correctly. See Pattern Library, "independent
// posting is not independent identification" (GrailKey Dispatch 26) for
// the concrete risk case this closes.
//
// Copy-propagated titles are near-identical strings; independently-
// authored titles describing the same real book diverge in wording. This
// reuses the SAME Jaccard token-set-overlap FORMULA buildTitleFamilies
// already uses for coarse family clustering (imageSearchIdentity.js) —
// not literally imported, since that implementation is a private closure
// local to buildTitleFamilies, not exported; the formula is reused, the
// call site is new. Deliberately NOT tokenizeTitle's normalization
// (compHygiene.js): that function strips artist surnames, signature
// words, and ordinal-key markers ("key", "1st", "origin") because
// they're noise for "does this listing match our target series." For
// THIS check they are exactly the wording variation that distinguishes
// independent authorship from a copy-paste — stripping them would
// destroy the discriminator. Normalization here is deliberately lighter:
// case-fold, strip punctuation/emoji, collapse whitespace, strip only an
// explicit grade/condition stoplist (book-condition words carry no
// authorship signal and vary for uninteresting reasons — a reseller
// grading the same book "NM" vs "near mint" isn't evidence of
// independent identification).
//
// Threshold (0.7) and clustering method were fixed BEFORE being run
// against the real repro this dispatch was scoped against (Spawn #351) —
// not tuned after seeing the result. Verified against that repro: one
// genuinely copy-propagated pair scored 0.929, every other pairing
// scored 0.368-0.538 — a wide, unambiguous gap; 0.7 sits in the middle of
// it, and the clustering result is identical anywhere from roughly
// 0.6-0.8. See the Pattern Library entry for the full record, including
// why NO MARGIN was added on top of the bare ">=3 clusters" floor even
// though the real repro lands exactly at it (deferred pending telemetry,
// not closed).
const TITLE_INDEPENDENCE_CONDITION_STOPWORDS = new Set([
  'nm', 'vf', 'fn', 'gd', 'fr', 'pr', 'mt', 'mint', 'near', 'high', 'grade', 'graded',
]);

export const NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.7;

function normalizeForTitleIndependence(title) {
  const stripped = String(title || '')
    .toLowerCase()
    // Strip emoji ranges, then any remaining punctuation, to bare
    // alphanumerics/whitespace.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = stripped
    .split(' ')
    .filter((t) => t.length > 0 && !TITLE_INDEPENDENCE_CONDITION_STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccardTokenSets(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Condition 6 — clusters near-duplicate title wording among a SET OF
 * ALREADY-SCOPED title strings. Callers are responsible for population
 * scoping (identityCore.js's getAssertingIssueRows — the same asserting-
 * row population evaluateUnanimousConsensusPromotion's own inputs are
 * scoped to, per Fix 2b's population-consistency lesson); this function
 * does no row selection of its own, purely string clustering. Requires
 * >=3 distinct clusters among the given titles — a bare floor, no margin
 * — a family whose asserting rows collapse to fewer than 3 distinct
 * wordings fails regardless of how many distinct sellers/item IDs posted
 * them.
 *
 * Clustering method mirrors buildTitleFamilies exactly (imageSearchIdentity.js):
 * compare each row to the FIRST member of each existing cluster; join the
 * first cluster it clears the threshold against, else start a new
 * cluster. maxPairwiseJaccard/minPairwiseJaccard are computed over the
 * FULL pairwise matrix (not just the pairs the clustering pass happened
 * to compare) so the telemetry is complete regardless of clustering
 * shortcuts — family sizes are small (single digits), so this is
 * negligible cost.
 *
 * @param {string[]} titles - raw title strings of the asserting rows only
 * @param {number} [threshold]
 * @returns {{pass: boolean, assertingRows: number, distinctClusters: number, largestClusterSize: number, maxPairwiseJaccard: number|null, minPairwiseJaccard: number|null, clusters: string[][]}}
 */
export function evaluateTitleTextIndependence(titles, threshold = NEAR_DUPLICATE_JACCARD_THRESHOLD) {
  const rows = Array.isArray(titles) ? titles.filter((t) => typeof t === 'string' && t.trim()) : [];
  const tokenSets = rows.map(normalizeForTitleIndependence);

  let maxPairwiseJaccard = null;
  let minPairwiseJaccard = null;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const sim = jaccardTokenSets(tokenSets[i], tokenSets[j]);
      if (maxPairwiseJaccard === null || sim > maxPairwiseJaccard) maxPairwiseJaccard = sim;
      if (minPairwiseJaccard === null || sim < minPairwiseJaccard) minPairwiseJaccard = sim;
    }
  }

  const clusters = []; // [{ members: [rowIndex, ...] }]
  rows.forEach((_, i) => {
    const joined = clusters.find((c) => jaccardTokenSets(tokenSets[i], tokenSets[c.members[0]]) >= threshold);
    if (joined) joined.members.push(i);
    else clusters.push({ members: [i] });
  });

  const largestClusterSize = clusters.reduce((max, c) => Math.max(max, c.members.length), 0);

  return {
    pass: clusters.length >= 3,
    assertingRows: rows.length,
    distinctClusters: clusters.length,
    largestClusterSize,
    maxPairwiseJaccard,
    minPairwiseJaccard,
    clusters: clusters.map((c) => c.members.map((i) => rows[i])),
  };
}

// Fix 2b — year-axis, corrected population. resolveFamilyYearConsensus's
// own `uniqueRows`/`support` denominator is family MEMBERSHIP (every
// deduped family row), not assertion (Step A finding, GrailKey
// Dispatch 25 — verified directly against that function's source, not
// assumed): `support` (=yearBearingRows) is rows that asserted a year,
// `uniqueRows` counts silent (no year token) rows too. Reusing those
// two fields directly as a naive `support === uniqueRows` check
// (mirroring Fix 2's issue-axis pattern exactly) would be the THIRD
// recorded instance of "measuring coherence against the wrong
// population" (Pattern Library — vision-zero-support at launch
// certification was the first) — a family member that never asserted a
// year at all would count against unanimity exactly like a member that
// asserted a CONFLICTING year, even though silence and dissent are not
// the same thing. This recomputes directly from the same raw
// indices/visualItems inputs, scoped to asserting rows from the start,
// rather than reusing the family-membership-scoped aggregate.
//
// @param {number[]} indices - familyCandidate.topFamily.indices
// @param {Array} visualItems
// @returns {{assertingIndices: number[], assertingCount: number, silentCount: number, majorityYear: string|null, dissentingCount: number}}
function analyzeYearAssertions(indices, visualItems) {
  const rows = Array.isArray(indices) ? indices : [];
  const asserting = [];
  for (const idx of rows) {
    const item = visualItems?.[idx];
    if (item == null) continue;
    const rowYear = typeof item !== 'string' ? item?.year : null;
    if (rowYear != null) asserting.push({ idx, year: String(rowYear) });
  }
  const counts = {};
  for (const a of asserting) counts[a.year] = (counts[a.year] || 0) + 1;
  const majorityYear = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dissentingCount = asserting.filter((a) => a.year !== majorityYear).length;
  return {
    assertingIndices: asserting.map((a) => a.idx),
    assertingCount: asserting.length,
    silentCount: rows.length - asserting.length,
    majorityYear,
    dissentingCount,
  };
}

/**
 * Fix 2b — year-axis unanimous-consensus promotion. On promote, the
 * caller should NOT append 'year' to identityProvisionalFields at all
 * (rather than append-then-remove — there is no removal mechanism
 * anywhere in this codebase, appendYearToProvisionalFields is purely
 * additive by design, so the correct fix is to never append in the
 * first place when this predicate clears).
 *
 * A row asserting a DIFFERENT year than the majority is dissent and
 * hard-fails (`dissentingCount !== 0`) — only ABSENCE (a row with no
 * parseable year at all) is treated as neutral. Unanimity stays at
 * exactly zero dissent among asserting rows; this is a corrected
 * DENOMINATOR, not a lowered bar — a family with 3 silent members and 1
 * asserting member still needs that 1 to be unanimous among asserters
 * (trivially true at n=1, but still gated by the `>=3` asserting-row
 * floor below, so a single lonely assertion can never promote alone).
 *
 * @param {{topFamily: {indices: number[]}}|null} familyCandidate
 * @param {Array} visualItems
 * @param {{mode: string, support: number, uniqueRows: number}|null} [familyYearConsensus] - cross-reference only, logged for comparison against this function's own recomputed figures; never consulted for the promote/decline decision itself
 * @returns {{promote: boolean, declineReason: string|null, inputs: object, year: string|null}}
 */
export function evaluateUnanimousYearConsensusPromotion(familyCandidate, visualItems, familyYearConsensus) {
  const indices = familyCandidate?.topFamily?.indices;
  const analysis = analyzeYearAssertions(indices, visualItems);
  const inputs = {
    priorMode: familyYearConsensus?.mode ?? null,
    priorSupport: familyYearConsensus?.support ?? null,
    priorUniqueRows: familyYearConsensus?.uniqueRows ?? null,
    assertingRows: analysis.assertingCount,
    silentRows: analysis.silentCount,
    dissentingRows: analysis.dissentingCount,
    majorityYear: analysis.majorityYear,
  };
  if (!(analysis.assertingCount >= 3)) {
    return { promote: false, declineReason: 'assertingRows<3', inputs, year: null };
  }
  if (analysis.dissentingCount !== 0) {
    return { promote: false, declineReason: 'dissenting-row-present', inputs, year: null };
  }
  const memberCheck = checkDistinctItemIdAndSeller(analysis.assertingIndices, visualItems);
  if (!memberCheck.distinct) {
    return { promote: false, declineReason: memberCheck.reason, inputs: { ...inputs, ...memberCheck }, year: null };
  }
  return { promote: true, declineReason: null, inputs: { ...inputs, ...memberCheck }, year: analysis.majorityYear };
}

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
 * @param {Object} [familyCandidate] - GrailKey Commit P (P1), optional,
 * backward-compatible (omitted or undefined behaves byte-identically to
 * before this commit — meetsHighConfidenceMarketplaceConsensusBar returns
 * false on a null familyCandidate). The title-family clustering result
 * (imageSearchIdentity.js selectTitleFamilyCandidate's return value) —
 * passed through ONLY so the 'adopted' branch below can additionally
 * check whether the SAME family that drove this adoption also clears the
 * P1 high-confidence bar. Does not change status ('provisional' either
 * way, P-2) — only adds a flag consumed later by
 * computeIssueAuthorityContractPatch.
 * @param {Array} [visualItems] - GrailKey Commit P (P1), the raw pool rows
 * familyCandidate.topFamily.indices reference — required alongside
 * familyCandidate for the membership/contamination/series checks.
 */
export function deriveIssueAuthorityFromAdoption(familyIssueConsensus, familyYearConsensus, familyCandidate, visualItems) {
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
  // GrailKey Commit P (P1) — attached ONLY when the SAME family driving
  // this adoption also clears meetsHighConfidenceMarketplaceConsensusBar.
  // status stays 'provisional' unconditionally (P-2) — this is a sibling
  // flag, never a promotion.
  const highConfidenceMarketplaceConsensus = meetsHighConfidenceMarketplaceConsensusBar(familyCandidate, visualItems);
  return {
    issueAuthority: {
      source: 'marketplace',
      status: 'provisional',
      confidence: mapConfidenceRatioToTier(familyIssueConsensus.ratio),
      supportRatio,
      reasons: ['marketplace-only-adoption'],
      priorObservations: [],
      highConfidenceMarketplaceConsensus,
    },
    identityProvisionalFields: ['issue'],
  };
}

/**
 * projectIssueAuthority — GrailKey Directive 2026-08-16-AQ (GK-127). The
 * ONLY function permitted to derive out.issueAuthority in the real
 * pipeline (api/enrich.js). Pure projection of reconcileIssue's own
 * already-computed verdict (identity.reconciledIssue, src/lib/
 * identityReconciler.js/identityCore.js's resolveIdentity) — never an
 * independent reinterpretation of familyIssueConsensus/familyYearConsensus
 * mode/outcome flags. Mirrors the exact pattern Directive Z already
 * established for contract.listable-from-actionAuthority: one canonical
 * upstream verdict, one pure downstream projection, no competing writer.
 *
 * Why this exists (GK-127, Wolverine #90): before this dispatch, at least
 * four separate call sites (api/enrich.js's commit4/commit4-rescue/
 * commit4.3 blocks) independently re-derived out.issueAuthority from
 * familyIssueConsensus's raw mode/outcome/authoritativeForCustody flags —
 * flags computed by an OLDER, pre-Slice-1 mechanism that could disagree
 * with reconcileIssue's own verdict even when the underlying VALUES
 * agreed (a provenance tag, 'family_margin_decline_conflict', treated as
 * if it were a value disagreement). reconcileIssue already ran, already
 * produced the canonical answer (value/authority/justifiedBy/conflicts) —
 * this function's only job is presenting that answer in the pre-existing
 * out.issueAuthority shape every downstream consumer
 * (canUseExactIssuePricingCache, computeIssueAuthorityContractPatch, the
 * CV/PC exact-lookup gates) already reads.
 *
 * Mapping:
 *   authority='CONTESTED'   -> {status:'conflicted'} — a real, independently-
 *                              sourced disagreement exists in the evidence
 *                              set (reconciledIssue.conflicts is non-empty
 *                              by construction whenever this fires).
 *   authority='CORROBORATED', source='family-population', a LONE winner
 *                           (justifiedBy.length===1, i.e. nothing else in
 *                           the evidence set agrees) -> the SAME stricter
 *                              bar Commit 4 always required for a bare
 *                              population fill (deriveIssueAuthorityFromAdoption's
 *                              own documented invariant: "absence of
 *                              contradiction is not corroboration") is
 *                              preserved here as a QUALITY-SIGNAL input
 *                              (evaluateUnanimousConsensusPromotion), never
 *                              a competing authority object — {status:
 *                              'provisional'} until promotion clears,
 *                              null (fully trusted) once it does.
 *   Everything else (real independent corroboration — 2+ agreeing sources,
 *   e.g. Vision AND family both present and agreeing; or the operator-
 *   confirmed 'user' source) -> null (no gate — the existing "no
 *   issueAuthority object at all" convention for a trusted book,
 *   functionally identical to status:'confirmed' at every consumer:
 *   canUseExactIssuePricingCache's own `if (issueAuthority == null) return
 *   true`).
 *
 * @param {{value: any, source: string|null, authority: 'NONE'|'CONTESTED'|'CORROBORATED', justifiedBy: Array, conflicts: Array}|null} reconciledIssue
 * @param {{familyIssueConsensus?: Object|null, familyCandidate?: Object|null, visualItems?: Array}} [opts]
 * @returns {{source: string, status: string, confidence: string, supportRatio: number|null, reasons: string[], priorObservations: Array}|null}
 */
export function projectIssueAuthority(reconciledIssue, opts = {}) {
  if (!reconciledIssue || reconciledIssue.value == null) return null;

  if (reconciledIssue.authority === 'CONTESTED') {
    return {
      source: 'marketplace',
      status: 'conflicted',
      confidence: 'low',
      supportRatio: null,
      reasons: ['issue-evidence-contested'],
      priorObservations: (reconciledIssue.conflicts || []).map((c) => ({
        value: c.value,
        source: c.source,
        status: 'conflicted',
        provenanceTrust: c.source,
      })),
    };
  }

  // CORROBORATED (or NONE with a value present — should not occur given
  // reconcileIssue's own contract, but handled the same conservative way:
  // a lone winner with nothing else backing it gets the stricter bar).
  const isLoneFamilyPopulationWinner = reconciledIssue.source === 'family-population'
    && Array.isArray(reconciledIssue.justifiedBy)
    && reconciledIssue.justifiedBy.length === 1;
  if (isLoneFamilyPopulationWinner) {
    const fic = opts.familyIssueConsensus;
    const promotion = fic ? evaluateUnanimousConsensusPromotion(fic, opts.familyCandidate, opts.visualItems) : { promote: false };
    if (promotion.promote) return null; // clears the unanimity bar — fully trusted
    return {
      source: 'marketplace',
      status: 'provisional',
      confidence: mapConfidenceRatioToTier(fic?.ratio ?? 0),
      supportRatio: fic ? Number((fic.ratio ?? 0).toFixed(2)) : null,
      reasons: ['marketplace-only-adoption'],
      priorObservations: [],
    };
  }

  return null; // real, independent corroboration (2+ agreeing sources) or operator-confirmed — trusted
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
 * GrailKey Dispatch 25 (2026-08-07), V4 fix — provenance, not a loosened
 * status check. Fix 2 (evaluateUnanimousConsensusPromotion, this file)
 * promotes a marketplace-only-adopted issue from 'provisional' to
 * 'confirmed', which ALSO independently unlocks CV/PC exact-identity
 * lookups (canUseExactIssuePricingCache) that were skipped while
 * provisional — the sources most able to surface a genuine contradiction
 * are the ones promotion just opened, and without this fix the guard
 * that would catch one was dead for exactly those rows (this function's
 * original condition checked `status === 'provisional'` only, so a
 * promoted 'confirmed' row could never re-escalate even on a real
 * conflict — a net safety regression found in review, before push, not
 * by any test). Second condition below is provenance-scoped, not a
 * loosened status check: `status === 'confirmed' &&
 * reasons.includes('unanimous-marketplace-consensus')` — the exact
 * reason string Fix 2 stamps onto the SAME `reasons` array this
 * function already reads for the provisional case, never a separate
 * field that could drift from it. A 'confirmed' status arriving via any
 * OTHER route (manualCorrection.js's real one: `source: 'user',
 * reasons: ['user-correction']`, Commit 3) carries no such reason and
 * stays non-escalatable, exactly as before this fix — the standing
 * authority matrix (catalog sources hold identity authority, marketplace
 * holds pricing-evidence authority) is preserved, not inverted.
 *
 * Only escalates a 'provisional' status reached via marketplace-only-
 * adoption specifically, OR a 'confirmed' status reached via THIS FILE'S
 * OWN unanimous-consensus promotion specifically (both checked via the
 * reasons array, never bare status) — this function has nothing to say
 * about a status that might arrive here via some other, future reason.
 *
 * GrailKey Dispatch 26 (2026-08-08), Fix 4 — extended the SAME way V4
 * extended this function for Fix 2's promotion path: a 'confirmed' status
 * reached via the zero-support unanimous rescue (identityCore.js,
 * distinct reason string 'unanimous-marketplace-consensus-zero-support-
 * rescue' — deliberately NOT the same string Fix 2 stamps, since that
 * string specifically documents "no prior Vision/user issue existed,"
 * false for a rescued row where Vision's prior existed and was overridden)
 * must stay re-escalatable on a later contradiction exactly like a Fix-2-
 * promoted row does. Omitting this was the exact V4 gap already found and
 * fixed once for Fix 2 — not repeating it for Fix 4's own distinct reason
 * string was a required, non-optional part of this diff (GrailKey
 * Dispatch 26, Q2).
 */
export function escalateIssueAuthorityOnConflict(issueAuthority, issueConsensusConflict) {
  const reasons = Array.isArray(issueAuthority?.reasons) ? issueAuthority.reasons : [];
  const eligibleFromProvisional = issueAuthority?.status === 'provisional' && reasons.includes('marketplace-only-adoption');
  const eligibleFromPromotedConfirmed = issueAuthority?.status === 'confirmed' && (
    reasons.includes('unanimous-marketplace-consensus')
    || reasons.includes('unanimous-marketplace-consensus-zero-support-rescue')
  );
  if ((eligibleFromProvisional || eligibleFromPromotedConfirmed) && issueConsensusConflict) {
    return {
      ...issueAuthority,
      status: 'conflicted',
      reasons: reasons.includes('visual-pool-issue-divergence')
        ? reasons
        : [...reasons, 'visual-pool-issue-divergence'],
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

  // GrailKey Commit P (P1) — high-confidence marketplace-consensus
  // carve-out. Scoped to issueProvisional ONLY (never issueConflicted or
  // yearOnlyProvisional — a genuine disagreement, or an unresolved year,
  // is not what this predicate was built or tested against). Returns a
  // DIFFERENT, softer patch: price/priceLow/priceHigh/priceBands/
  // matchConfidence are simply absent from the object below, so
  // Object.assign(out, patch) at the real call site leaves whatever the
  // pipeline already computed untouched. identityConfident is likewise
  // never set false here — decisionEngine's 'identity-not-confident'
  // blocker (and the ID_REQUIRED it forces) never fires from this patch.
  // listingHardLocked IS still set — "PRICE IT... Listing still requires
  // the tap" (P1) — reusing the SAME lock mechanism Q110's advisory
  // conditions already use (responseContract.js resolves this to LOCKED,
  // not REFUSED/ID_REQUIRED: price/bands stay visible, only the List
  // button gates). issueAuthority.status itself is untouched by this
  // function — still 'provisional', never promoted (P-2).
  if (issueProvisional && issueAuthority?.highConfidenceMarketplaceConsensus === true) {
    return {
      listingHardLocked: true,
      listingHardLockReason: 'issue-authority-provisional-high-confidence',
      listingHardLockBanner:
        "This book's issue number was inferred from marketplace listings alone, but a strong, internally-consistent " +
        'consensus (no competing family, no contamination, full title-token overlap) backs it — price shown, ' +
        'listing still requires confirmation.',
    };
  }

  // GK-159 (2026-08-22) — per-facet parity: floor, don't clear. Every
  // sibling contested facet (variant AR/GK-129, year AT/GK-135, title
  // AV/GK-133, and issue itself via GK-152's own deriveMarketStanding
  // floor, actionAuthority.js) already lands a CONTESTED-but-priced book
  // at marketStanding=SIMILAR_ONLY / actionAuthority.state=REVIEW — price
  // stays visible, only READY/listing is withheld. commit4-terminal was
  // the one remaining facet still CLEARING instead of flooring: it
  // unconditionally nulled price/bands and forced ID_REQUIRED the instant
  // issueAuthority.status was 'conflicted', regardless of whether a real
  // price had already been computed from a genuinely comps-corroborated
  // read (e.g. GK-152's own rescueIssueFromCompsPoolConsensus shape,
  // GK-158's own provisional-issue-match admission). Two compounding
  // effects: the clear itself, AND — even on a hypothetical future call
  // site that ignored the clear — overwriting pricingSource with the
  // literal 'refused-issue-authority-conflicted' string would make
  // deriveMarketStanding's own `/^refused/` short-circuit return NONE
  // before the GK-152 conflicted-issue floor below it ever got a chance
  // to run, silently defeating that floor a second, independent way.
  //
  // Fix, scoped narrowly to issueConflicted ONLY (issueProvisional and
  // yearOnlyProvisional are unchanged — a bare marketplace ADOPTION with
  // no external corroboration at all is a materially weaker read than a
  // GENUINE DISAGREEMENT the pool itself already priced through; widening
  // this to those two cases is a separate decision, not made here): when
  // priorOut already carries a real, computed price, return a patch that
  // touches NOTHING price-related (price/priceLow/priceHigh/priceBands/
  // matchConfidence/pricingSource/confidenceLevel all stay exactly as the
  // pipeline computed them — the "honest floored source," never the
  // synthetic refused-* string) and does NOT set identityConfident=false/
  // refusedToPrice=true/listingHardLocked. Deliberately NOT setting
  // listingHardLocked here: that flag always produces a hard, 'integrity'-
  // class lock (responseContract.js deriveLocks), which unconditionally
  // forces actionAuthority.state to LOCKED regardless of marketStanding
  // (Q41's own law, untouched) — the opposite of the REVIEW outcome this
  // fix exists to produce. Listing stays gated anyway: marketStanding
  // never reaches EXACT_CURRENT while issueAuthority.status is
  // 'conflicted' (GK-152's own floor), so deriveActionAuthority's READY
  // condition (identityStanding CONFIRMED && marketStanding EXACT_CURRENT
  // && zero locks) can never be met — state lands at REVIEW, listable
  // stays false, without a hard lock's help. responseContract.js's own
  // pre-existing 'market-standing-issue-contested' soft (insufficiency-
  // class) lock (also GK-152) fires on exactly this shape and supplies
  // the ISSUE_CONTESTED-class card banner — nothing new needed here to
  // surface it, only the absence of a preceding hard lock that would
  // otherwise suppress it (that lock is itself gated on
  // `preStandingLockCount === 0`).
  //
  // `marketStandingFloored: true` is a pure logging/diagnostic marker
  // (api/enrich.js's call site branches on it to log a fix-specific line
  // distinct from both the hard-clear and the P1 commit-p carve-out) —
  // it carries no pricing/eligibility meaning of its own and nothing
  // downstream reads it for a gating decision.
  //
  // Genuine no-price scans (priorOut has no computed price at all) are
  // completely unchanged — falls through to the existing hard-clear
  // branch below exactly as before this fix.
  if (issueConflicted && parsePriceNumber(priorOut?.price) != null) {
    return { marketStandingFloored: true };
  }

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
  // GrailKey Commit Q (Q0, 2026-08-03) — the production Spawn card rendered
  // "Estimated $NaN from marketplace listings". Root cause: priorOut.price
  // is NOT reliably a number by the time this function runs — most of
  // api/enrich.js's pricing writers assign `out.price = fmtUsd(n)`
  // (src/lib/pricingEngine.js), which returns a FORMATTED STRING
  // ("$21.25"), not a number; only a minority of writers (e.g. Ship 11's
  // visual-pool fallback, api/enrich.js ~8703) assign a raw number
  // directly. This function was copying priorOut.price verbatim into
  // hypotheticalReferenceEstimate regardless of which shape it was in.
  // App.jsx's render site (`Number(item.hypotheticalReferenceEstimate)
  // .toFixed(2)`) parses a fmtUsd string with Number() directly — which
  // returns NaN for any string containing "$" or "," — producing the
  // literal "$NaN" text. Coerced HERE, at the write, with
  // parsePriceNumber (not at the render site) so every consumer of this
  // field — current and future — receives a genuine number or nothing.
  // parsePriceNumber returns null for a non-numeric string, an object, or
  // a non-finite number; the field is left OFF the patch entirely in that
  // case (mirrors this function's own existing `priorOut?.price != null`
  // convention for "nothing to preserve") rather than ever being set to
  // null/NaN explicitly.
  const parsedReferenceEstimate = parsePriceNumber(priorOut?.price);
  if (parsedReferenceEstimate != null) {
    patch.hypotheticalReferenceEstimate = parsedReferenceEstimate;
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
 * GrailKey Commit P (P2b) — extracted for testability (same rationale as
 * every other function in this file, invariant 10): the real
 * api/enrich.js call site previously built this object inline, right
 * next to the console.log that already reported the identical
 * year/support/uniqueRows values — computed for that one log line and
 * nothing else. identityProvisionalFields (the bare flag) reached out and
 * the client; the value the flag is ABOUT, and the vote behind it, did
 * not. Mirrors the log line's data exactly, no new computation.
 *
 * @param {{year: *, support: number, uniqueRows: number}|null|undefined} familyYearConsensus
 * @returns {{year: *, support: number, population: number}|null}
 */
export function buildIdentityProvisionalYearDetail(familyYearConsensus) {
  if (!familyYearConsensus) return null;
  return {
    year: familyYearConsensus.year,
    support: familyYearConsensus.support,
    population: familyYearConsensus.uniqueRows,
  };
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

/**
 * GrailKey Commit P2 (Part B, 2026-08-03) — narrow, contained
 * `confirmedYear` backfill for the P1 high-confidence marketplace-
 * consensus carve-out (`meetsHighConfidenceMarketplaceConsensusBar`
 * above). Extracted as a pure function (invariant 10, same rationale as
 * every other primitive in this file) so the real api/enrich.js call site
 * and this feature's tests invoke the IDENTICAL logic.
 *
 * Root problem (Phase 0 finding B-Q1): `confirmedYear` IS assigned from
 * the family's own year vote inside `resolveIdentity`
 * (identityCore.js:1621, `familyYearConsensus.year ?? ...`), but is
 * unconditionally overwritten later in api/enrich.js by `resolveYear()`'s
 * own authoritative PC/CV/user pass (~line 4222) — `resolveYear`'s "user
 * year" input only reuses the family-adopted `confirmedYear` when
 * `identityIsProvisionalOverride` is true, a flag the weighted-consensus/
 * top-rank-protection family-override path (P1's own target) never sets
 * (only the separate 'refused-identity-conflict' branch does). For a book
 * with no PC/CV/user year of its own — Ship 11's visual-pool-fallback
 * territory, exactly where P1 lives — `resolveYear` falls through to
 * null, and every later backfill chain (Q86 PC-tolerated, Q58-TITLE comp
 * consensus) has nothing to work with either: `confirmedYear` reaches the
 * identity-gate still null, blocking on missing 'year' even though the
 * exact same family that just cleared P1's bar also voted on a year.
 *
 * Containment (Phase 0 finding B-Q2): `identityIsProvisionalOverride` is
 * NOT a contained lever for this — it also selects the PC query year
 * (api/enrich.js ~line 3478), nulls `confirmedVariant` (~line 4763), and
 * gates `out.year`'s own fallback (~line 9856), all already executed
 * earlier in the same request by the time this function's real call site
 * runs. Flipping that flag on here would reach back and change decisions
 * already made under a different, broader contract. This function is
 * deliberately narrower: it only ever proposes a value for
 * `confirmedYear` itself, only when the caller reports nothing else (PC,
 * CV, user, comp-consensus) already resolved one
 * (`currentConfirmedYear == null`), and only behind the SAME P1 predicate
 * that already gates the price carve-out
 * (`issueAuthority.highConfidenceMarketplaceConsensus === true`) — no new
 * consensus math, no promotion of `issueAuthority.status` (stays
 * 'provisional', untouched by this function).
 *
 * Gate transparency (Phase 0 finding B-Q3): the identity-gate this
 * backfill exists to clear (`assessIdentityConfidence`/
 * `sanitizeIdentityFields`, `identityGate.js`) has no authority/
 * provenance concept at all — it only checks field presence and format
 * (`isCleanYearString`). A well-formed year string clears it identically
 * regardless of source. This function's return carries its own explicit
 * provenance (`source: 'family-consensus-provisional'`) so a caller can
 * still distinguish it downstream, even though the gate itself cannot.
 *
 * Support threshold >= 3 — stricter than `resolveFamilyYearConsensus`'s
 * own bare adoption floor of 2 (`yearBearingRows >= 2`) — matches the
 * real Spawn #351 reference shape (3 of 5 rows) this predicate was built
 * and tested against; a caller may not weaken this by passing a lower
 * threshold, it is fixed inside this function.
 *
 * @param {string|number|null} currentConfirmedYear - confirmedYear as already resolved by resolveYear() and every backfill chain ahead of this call
 * @param {{highConfidenceMarketplaceConsensus?: boolean}|null} issueAuthority - out.issueAuthority
 * @param {{mode: string, year: *, support: number, uniqueRows: number}|null} familyYearConsensus - identity.familyYearConsensus
 * @returns {{year: string, meta: {value: string, source: string, confidence: string}}|null} null when the backfill does not apply — caller leaves confirmedYear untouched
 */
export function deriveProvisionalYearBackfill(currentConfirmedYear, issueAuthority, familyYearConsensus) {
  if (currentConfirmedYear != null) return null;
  if (issueAuthority?.highConfidenceMarketplaceConsensus !== true) return null;
  if (familyYearConsensus?.mode !== 'adopted') return null;
  if (!(familyYearConsensus.support >= 3)) return null;
  const year = String(familyYearConsensus.year);
  return {
    year,
    meta: { value: year, source: 'family-consensus-provisional', confidence: 'provisional' },
  };
}

/**
 * GrailKey Dispatch 19 (2026-08-07) — Fix 6, corrected and shipped.
 *
 * Rescues an already-adopted family-scoped year (Commit 4.1,
 * `identityProvisionalFields += 'year'`) from being silently downgraded
 * to `resolveYear`'s own weakest outcome: falling all the way through to
 * Vision's raw sentinel value with `yearSource === 'vision-fallback'`
 * (identityCore.js, `resolveYear`'s final else branch). Confirmed via a
 * real production scan (Spawn #351, 2026-08-07 20:40:36 UTC): Commit 4.1
 * had already adopted year=2024 (family-scoped, support=3/4=75%), but
 * `resolveYear` — which never even sees that adopted value when
 * `identityIsProvisionalOverride` is false, the case on this exact path
 * (B-Q1 above) — fell through and overwrote `confirmedYear` with the
 * literal string `"Unknown"` (Vision's own raw placeholder for an
 * undetermined field, not JS `null` — confirmed via `writeConfirmed`'s
 * `to="Unknown"` log; this is why `deriveProvisionalYearBackfill`'s
 * `currentConfirmedYear != null` guard does not catch this shape, it was
 * built assuming a JS-`null` fallback). The originally-queued Fix 6
 * design (thread `poolYearHint` into `resolveYear`) was built on a
 * misread of this exact log line: "year=2024 support=3/4" is Commit
 * 4.1's family-scoped adoption (`identity.familyYearConsensus`), never
 * `poolYearHint` (which was 2020 at 3/6 on this same scan — wrong).
 * Corrected here instead of shipped as originally designed;
 * `poolYearHint` is not consumed by this function at all.
 *
 * Deliberately independent of `deriveProvisionalYearBackfill`/commit-p2's
 * own P1 gate (`issueAuthority.highConfidenceMarketplaceConsensus ===
 * true`) — that gate serves a narrower purpose (unblocking the
 * identity-gate specifically, behind the same bar as the P1 price
 * carve-out, B-Q2 above). This rescue is a different, more general rule:
 * an adopted family-scoped year is always a better answer than
 * `resolveYear`'s own weakest fallback, regardless of whether the
 * stricter P1 weight-floor also cleared for this particular scan (on the
 * real Spawn #351 case above, it did not — see the Pattern Library's
 * "commit-p near-miss" entry). Never fires when `resolveYear` found ANY
 * independent corroboration (pc-cv-agreement, pricecharting, comicvine,
 * ebay-consensus, or even the rejected-override case) — only its bare
 * fallback. Reuses the exact same `support >= 3` floor
 * `deriveProvisionalYearBackfill` already enforces — the real Spawn #351
 * case is exactly `support=3`, ratio=0.75, the instance that validated
 * this threshold (GrailKey Dispatch 16).
 *
 * @param {string|null|undefined} resolvedYearSource - yearSource immediately after resolveYear() returns (before any later backfill chain runs)
 * @param {{mode: string, year: *, support: number, uniqueRows: number}|null} familyYearConsensus - identity.familyYearConsensus
 * @returns {{year: string, meta: {value: string, source: string, confidence: string}}|null} null when the rescue does not apply — caller leaves confirmedYear untouched
 */
export function rescueYearFromVisionFallback(resolvedYearSource, familyYearConsensus) {
  if (resolvedYearSource !== 'vision-fallback') return null;
  if (familyYearConsensus?.mode !== 'adopted') return null;
  if (!(familyYearConsensus.support >= 3)) return null;
  const year = String(familyYearConsensus.year);
  return {
    year,
    meta: { value: year, source: 'family-consensus-vision-fallback-rescue', confidence: 'provisional' },
  };
}
