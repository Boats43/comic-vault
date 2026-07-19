import { enforceFloor } from './pricingEngine.js';
import { GRADE_TO_NUMERIC } from './gradeUtils.js';

/**
 * Session 2A: Compute best sales channel based on decision + item characteristics
 *
 * Channels:
 * - cash_sale: Quick individual sale for clean HOT books
 * - bundle: Group low-value items for batch listing
 * - grade: Submit for professional grading (upside detected)
 * - barter: Trade for items with collector appeal but weak cash market
 * - research: Verify market before deciding channel
 * - blocked: Cannot route (identity or quality issues)
 */
function computeBestChannel(decision, item) {
  const price = item.price ?? null;
  const isHOT = item.aiTags?.label === 'HOT';
  const isCOLD = item.aiTags?.label === 'COLD';
  const soldCount = item.soldComps?.length || 0;
  // hasKeyValue flag computed by ComicAdapter.detectKeyValue()
  const hasKeyValue = item.hasKeyValue === true;
  const isGraded = item.isGraded === true;
  const isRecognizable = item.title && item.title.trim().length > 0 &&
                         !item.title.toLowerCase().includes('unknown');

  // Rule 5: Blocked (DO_NOT_LIST or ID_REQUIRED)
  if (decision.action === 'DO_NOT_LIST' || decision.action === 'ID_REQUIRED') {
    return 'blocked';
  }

  // Rule 4: Research
  if (decision.action === 'RESEARCH') {
    return 'research';
  }

  // Rule 0: Unpriced items always route to research
  if (price == null) {
    return 'research';
  }

  // Rule 3: Grade candidate (already detected by decision engine)
  // FIX 3: Also handle HOLD_FOR_CGC action
  if (decision.action === 'GRADE_CANDIDATE' || decision.action === 'HOLD_FOR_CGC') {
    return 'grade';
  }

  // Additional grade detection: high raw key value
  if (!isGraded && price > 50 && hasKeyValue) {
    return 'grade';
  }

  // Rule 6: Barter (value < $25 + recognizable + no blockers + cold/thin market)
  const isThinMarket = soldCount < 2;
  if (price < 25 && isRecognizable && decision.blockers.length === 0 && (isCOLD || isThinMarket)) {
    return 'barter';
  }

  // Rule 2: Bundle (LIST_LOW or low value)
  // ROUTING RULE [P2]: Books ≥$100 never route BUNDLE (MWOM #198 $201 key class)
  // High-value books warrant individual listings even when decision=LIST_LOW
  if (price < 100 && (decision.action === 'LIST_LOW' || price < 10)) {
    return 'bundle';
  }

  // Rule 1: Cash sale (LIST_NOW + high + HOT)
  if (decision.action === 'LIST_NOW' && decision.confidence === 'high' && isHOT) {
    return 'cash_sale';
  }

  // Default: Cash sale for clean LIST_NOW books
  if (decision.action === 'LIST_NOW') {
    return 'cash_sale';
  }

  // FIX: LIST_LOW ≥$100 → cash_sale (individual listing, conservative price)
  // Not research — book has price and clear action
  if (decision.action === 'LIST_LOW') {
    return 'cash_sale';
  }

  // Fallback: research only for unpriced/conflict/unknown states
  return 'research';
}

/**
 * Decision Engine v0-A
 *
 * Pure helper that analyzes a comic item and returns a structured decision
 * with action, confidence, price recommendation, blockers, warnings, and evidence.
 *
 * @param {Object} item - Comic item from catalogue (enrich response shape)
 * @param {Object} context - Optional context (catalogue, settings, etc.)
 * @returns {Object} Decision object
 */
export function computeDecision(item, context = {}) {
  const decision = {
    action: null,
    confidence: null,
    price: null,
    reason: '',
    blockers: [],
    warnings: [],
    nextStep: '',
    evidence: {},
    bestChannel: null,
    timestamp: Date.now()
  };

  // PHASE 1: HARD BLOCKERS

  // Blocker: Missing critical identity fields
  if (!item.title || item.title.trim() === '') {
    decision.blockers.push('missing-title');
  }
  // Blocker: Identity incomplete (comic-specific: issue + publisher required)
  // identityComplete flag computed by ComicAdapter
  if (item.identityComplete === false) {
    decision.blockers.push('identity-incomplete');
  }

  // Blocker: Identity not confident
  if (item.identityConfident === false) {
    decision.blockers.push('identity-not-confident');
  }

  // Q110 dispatch Part 1 (2026-07-18) — assetTypeConfident and
  // refused-identity-conflict demoted from hard blockers to advisory
  // warnings (see Phase 2 below). Was: forced ID_REQUIRED even when a real
  // price/comp pool existed underneath (Walking Dead #109 class) — the
  // flag alone no longer walls off data already computed. api/enrich.js no
  // longer nulls price/comps for either condition; the flag stays visible
  // via listingHardLocked (contract state LOCKED — price shown, listing
  // gated) rather than REFUSED/ID_REQUIRED (price nulled everywhere).
  // Genuinely-missing identity (identity-not-confident above, missing
  // title/fields) is unaffected — that stays a hard blocker, since there is
  // no usable book to price against at all.

  // Blocker: Pricing source refusals
  if (item.pricingSource === 'refused-no-data-sources') {
    decision.blockers.push('no-data-sources');
  }

  // Blocker: Manual review required
  if (item.manualReviewRequired === true) {
    decision.blockers.push('manual-review-required');
  }

  // Blocker: Mega-key special cases
  if (item.megaKey?.badge === 'MANUAL REVIEW' ||
      item.megaKey?.badge === 'GRADE EXCEEDS MAP') {
    decision.blockers.push('mega-key-manual-review');
  }

  // Blocker: Claude check critical severity
  if (item.claudeCheckBlocker) {
    decision.blockers.push('claude-check-critical');
    decision.evidence.claudeCritical = {
      reason: item.claudeCheckBlocker,
      source: 'claude-gate'
    };
  }

  // Blocker: Catastrophic system overprice
  // System-generated price far above active comps = broken pricing logic
  // EXCEPT: vintage-thin era risk (Golden Age thin pools) may have contaminated active comps
  const activeAvg = item.rawComps?.average;
  const systemPrice = item.price;
  const eraRisk = item.eraRisk; // computed by ComicAdapter.computeEraRisk()

  if (systemPrice && activeAvg && systemPrice > activeAvg * 10) {
    // Skip blocker for vintage-thin pools - let warnings handle it
    if (eraRisk !== 'vintage-thin') {
      decision.blockers.push('catastrophic-system-overprice');
      decision.evidence.catastrophicOverprice = {
        systemPrice,
        activeAvg,
        ratio: systemPrice / activeAvg
      };
    }
  }

  // Blocker: Catastrophic overprice on reprint/polybag/facsimile
  const isReprint = item.editionWarning?.detected === true;
  const isPolybag = item.isPolybagPricing === true;
  if ((isReprint || isPolybag) && systemPrice && activeAvg && systemPrice > activeAvg * 5) {
    decision.blockers.push('catastrophic-reprint-overprice');
    decision.evidence.reprintOverprice = {
      systemPrice,
      activeAvg,
      isReprint,
      isPolybag
    };
  }

  // Blocker: Reprint/polybag with no verified comps
  // Ship #26 v0-D.1 — When reprint detected AND zero verified comps AND AI verify rejected all,
  // we have NO reliable pricing data. This combination is objectively unpriceable.
  // Only blocks when verification was attempted and rejected 100% of comps.
  const rawCompsCount = item.rawComps?.count || 0;

  if ((isReprint || isPolybag) && rawCompsCount === 0 && item.compsExhausted === true) {
    decision.blockers.push('reprint-no-verified-comps');
    decision.evidence.reprintNoComps = {
      isReprint,
      isPolybag,
      verifiedCount: 0,
      aiVerifyRejectedAll: true
    };
  }

  // If blockers exist, return DO_NOT_LIST or ID_REQUIRED
  if (decision.blockers.length > 0) {
    // Determine if it's ID_REQUIRED vs DO_NOT_LIST
    const identityBlockers = [
      'missing-title',
      'identity-incomplete',
      'identity-not-confident'
    ];
    const hasIdentityBlocker = decision.blockers.some(b => identityBlockers.includes(b));

    if (hasIdentityBlocker) {
      decision.action = 'ID_REQUIRED';
      decision.confidence = 'high';
      decision.reason = buildBlockerReason(decision.blockers, item);
      decision.nextStep = buildIdentityNextStep(decision.blockers, item);
    } else {
      decision.action = 'DO_NOT_LIST';
      decision.confidence = 'high';
      decision.reason = buildBlockerReason(decision.blockers, item);
      decision.nextStep = buildBlockerNextStep(decision.blockers, item);
    }

    decision.evidence.blockers = decision.blockers;
    decision.bestChannel = computeBestChannel(decision, item);
    return decision;
  }

  // PHASE 2: WARNING GATES

  // Q110 dispatch Part 1 — asset-type mismatch, now advisory (was a
  // blocker above). Still routes to RESEARCH via criticalWarnings below,
  // so the card shows a price with an explicit caution rather than either
  // a hard wall or a silent LIST_NOW.
  if (item.assetTypeConfident === false) {
    decision.warnings.push('asset-type-uncertain');
    decision.evidence.assetTypeUncertain = {
      message: item.listingHardLockBanner
        || 'This image may be a reference scan or promotional print — verify before listing',
    };
  }

  // Q110 dispatch Part 2 — identity-conflict, now advisory (was a
  // blocker above). api/enrich.js still attempts the visual-similarity
  // fallback tier before this ever fires, so a price is usually present.
  if (item.pricingSource === 'refused-identity-conflict' || item.listingHardLockReason === 'identity-unresolved') {
    decision.warnings.push('identity-conflict-unresolved');
    decision.evidence.identityConflictUnresolved = {
      message: item.refusalReason || 'Visual pool could not confirm identity — verify before listing',
    };
  }

  // Warning: Active floor far below recommended
  const activeLowest = item.rawComps?.lowest;
  if (systemPrice && activeLowest && systemPrice > activeLowest * 3) {
    decision.warnings.push('active-floor-far-below');
    decision.evidence.activeFloor = { systemPrice, activeLowest };
  }

  // Warning: Recommended price below floor (v0-F)
  // When item.price < floor, decision.price will be raised to floor
  if (item.price && activeLowest && item.price < activeLowest) {
    decision.warnings.push('recommended-below-floor');
    decision.evidence.recommendedBelowFloor = {
      recommended: item.price,
      floor: activeLowest,
      adjusted: activeLowest
    };
  }

  // Warning: Active average far below recommended
  if (systemPrice && activeAvg && systemPrice > activeAvg * 2) {
    decision.warnings.push('active-avg-far-below');
    decision.evidence.activeAvgGap = { systemPrice, activeAvg };
  }

  // Warning: Sold comps stale
  if (item.soldComps?.length > 0) {
    const mostRecentDays = Math.min(...item.soldComps.map(s => s.daysAgo || 999));
    if (mostRecentDays > 180) {
      decision.warnings.push('sold-comps-stale');
      decision.evidence.soldStale = { mostRecentDays };
    }
  }

  // Warning: Zero verified sold comps (v1-C)
  // When sold comp data exists but none passed verification, we lack reliable sold evidence
  const verifiedSoldCount = item.soldCompDiagnostics?.verifiedCount || 0;
  const rawSoldCount = item.soldCompDiagnostics?.rawCount || 0;
  const activeCount = item.rawComps?.count || 0;

  if (verifiedSoldCount === 0 && rawSoldCount > 0) {
    decision.warnings.push('zero-verified-comps');
    decision.evidence.zeroVerifiedComps = {
      rawSoldCount,
      verifiedCount: 0,
      activeCount
    };
  }

  // Warning: Thin pool anchor
  if (item.thinPoolAnchored === true) {
    decision.warnings.push('thin-pool-anchor');
  }

  // Warning: Comp pool contamination
  if (item.compPoolContaminated === true) {
    decision.warnings.push('comp-pool-contaminated');
  }

  // Warning: Grade low confidence
  if (item.visionConfidence === 'low') {
    decision.warnings.push('vision-low-confidence');
  }

  // Warning: AI verify rejected all
  if (item.compsExhausted === true) {
    decision.warnings.push('ai-verify-rejected-all');
  }

  // Q83: identity adopted from verified-comp consensus (Vision's
  // low-confidence vote overridden — vote, not veto). The book prices
  // normally but carries a review flag: moderate warning → LIST_LOW
  // ceiling, never silent LIST_NOW.
  if (item.identityFromConsensus === true) {
    decision.warnings.push('identity-from-consensus');
    decision.evidence.identityFromConsensus = item.identityConsensus || true;
  }

  // GL-1 (EX-2): pricing-class refusal keyed off the STATE, not the slug.
  // 'refused-tier-bypass-detected' leaked to LIST_LOW because the slug
  // handlers below never matched it, and any future refused-* slug would
  // leak the same way. Identity-class refusal (refused-identity-conflict)
  // is handled as a blocker above and returns ID_REQUIRED before this runs.
  // The price==null guard keeps priced verification-warning paths (e.g.
  // claude-gate books that still ship a comp-derived price) out of the
  // forced-RESEARCH escalation.
  const isRefusedPricing =
    item.pricingSource !== 'refused-identity-conflict' &&
    (item.refusedToPrice === true ||
      (/^refused/.test(item.pricingSource || '') && item.price == null));
  if (isRefusedPricing) {
    decision.warnings.push('refused-to-price');
    decision.evidence.refusedToPrice = {
      source: item.pricingSource || 'unknown',
      note: item.priceNote || 'Engine refused to price — no coherent market data',
    };
  }

  // Warning: Verification failed (Claude gate)
  if (item.pricingSource === 'refused-claude-gate') {
    decision.warnings.push('verification-failed-claude');
    decision.evidence.verificationFailed = {
      source: 'claude-gate',
      note: item.priceNote || 'Claude verification rejected pricing'
    };
  }

  // Warning: No verified or sold comps (zero data)
  if (item.pricingSource === 'refused' && item.price == null) {
    decision.warnings.push('verification-failed-no-data');
    decision.evidence.verificationFailed = {
      source: 'zero-comps',
      note: item.priceNote || 'No verified comps or sold comps found'
    };
  }

  // Warning: Visual pool fallback (identity uncertain)
  if (item.pricingSource === 'visual_pool_fallback') {
    decision.warnings.push('verification-failed-visual-fallback');
    decision.evidence.verificationFailed = {
      source: 'visual-pool',
      visualPoolSize: item.visualPoolSize,
      note: item.priceNote || 'Image search fallback — verify identity'
    };
  }

  // Ship #26: Warning: Web search fallback (comp data unavailable)
  if (item.pricingSource === 'web_search_fallback') {
    decision.warnings.push('web-search-pricing');
    decision.evidence.webSearchPricing = {
      source: item.claudeCheck?.web_source || 'unknown',
      confidence: item.confidenceLevel,
      evidence: item.webSearchEvidence || 'No details available'
    };
  }

  // Ship #27 FIX 2: UK weekly/pence variant with zero comps — flag as manual research
  if (item.ukWeeklyNoComps === true) {
    decision.warnings.push('uk-weekly-no-comps');
    decision.evidence.ukWeeklyNoComps = {
      variant: item.variant,
      publisher: item.publisher,
      note: 'UK weekly/pence variant with no eBay comps — manual research required'
    };
  }

  // Warning: Reprint thin pool
  if (item.pricingSource === 'refused-reprint-thin-pool') {
    decision.warnings.push('verification-failed-reprint-thin');
    decision.evidence.verificationFailed = {
      source: 'reprint-thin-pool',
      note: 'Reprint with insufficient comp data'
    };
  }

  // Warning: Content verification
  // contentVerified flag computed by ComicAdapter.verifyStory()
  if (item.contentVerified === false) {
    decision.warnings.push('content-unverified');
    decision.evidence.contentUnverified = 'Story metadata suspicious or suppressed';
  }

  // Q118 dispatch (2026-07-18) — Vision self-consistency: reason text vs
  // Vision's own structured fields disagree (title/issue truncation,
  // grading-status claim vs isGraded=false, character/era anachronism).
  // Explicit ruling: escalates to RESEARCH via criticalWarnings below —
  // a deliberate departure from the Q72 content-flags-stay-LIST_LOW
  // policy 'content-unverified' follows just above, made knowingly for
  // this new class rather than inherited by default.
  if (item.visionConsistency?.hasInconsistency) {
    decision.warnings.push('internal-inconsistency');
    decision.evidence.internalInconsistency = item.visionConsistency.flags.map((f) => f.message);
  }

  // Q129 dispatch (2026-07-19, Harley Quinn #62 Guillem March Cover C
  // class) — a distinct failure shape from Q115/Q127/Q128's contamination
  // classes: not wrong data getting IN, but CORRECT variant-specific comps
  // getting excluded by the era filter for a legitimate reason (a
  // different printing/year), leaving a priced pool that carries no named
  // variant descriptor at all — the price silently reflects a different,
  // generic printing rather than the specific variant those excluded
  // listings described. Escalates to RESEARCH (same explicit-ruling
  // precedent as internal-inconsistency above) rather than staying at
  // LIST_LOW — this is a price-accuracy gap for THIS specific book, not a
  // generic content flag.
  if (item.variantCompsExcludedByEra) {
    decision.warnings.push('variant-comps-unavailable');
    decision.evidence.variantCompsExcludedByEra = item.variantCompsExcludedByEra;
  }

  // Warning: Active/sold mismatch
  const soldAvg = item.soldComps?.length >= 2
    ? item.soldComps.reduce((sum, c) => sum + c.price, 0) / item.soldComps.length
    : null;
  if (soldAvg && activeAvg && Math.abs(soldAvg - activeAvg) / activeAvg > 2) {
    decision.warnings.push('sold-active-mismatch-extreme');
    decision.evidence.soldActiveMismatch = { soldAvg, activeAvg };
  }

  // Warning: Vintage-thin era risk (Golden Age thin-active-pool)
  if (eraRisk === 'vintage-thin' && soldAvg && activeAvg && soldAvg > activeAvg * 3) {
    decision.warnings.push('era-risk-vintage-thin');
    decision.evidence.eraRisk = {
      type: 'vintage-thin',
      year: item.year,
      activeCount: item.rawComps?.count,
      soldAvg,
      activeAvg
    };
  }

  // Warning: Reprint/polybag
  if (isReprint || isPolybag) {
    decision.warnings.push('reprint-polybag-detected');
    decision.evidence.editionWarning = {
      isReprint,
      isPolybag,
      signals: item.editionWarning?.signals
    };
  }

  // Warning: Filter bypass detected (Ship v0-I)
  // Comps passed hygiene but filter criteria missing (year, set, etc.).
  // Moderate warning ensures LIST_LOW ceiling, not LIST_NOW.
  if (item.filterBypassDetected === true) {
    decision.warnings.push('filter-bypass-detected');
    decision.evidence.filterBypassDetected = {
      message: 'Filter criteria missing from comp listings',
      matchConfidenceCapped: item.matchConfidence?.tier === 'LOW'
    };
  }

  // Warning: Claude check high severity
  // HIGH-severity flag from claude-gate. Price ships but decision must cap at LIST_LOW.
  // Confidence capped to LOW, never LIST_NOW.
  if (item.claudeCheckHighSeverity) {
    decision.warnings.push('claude-check-high-severity');
    decision.evidence.claudeHighSeverity = {
      reason: item.claudeCheckHighSeverity,
      source: 'claude-gate'
    };
  }

  // P0 2026-07-13 (XMEN1 coexistence): the mega-key contamination lock
  // sets RESEARCH inline in enrich's floor branch, but this function
  // recomputes the final decision and knew nothing about the flag — a
  // hard-LOCKED card could still carry a LIST badge. Surface as a
  // price-evidence critical warning so the final decision lands RESEARCH.
  if (item.floorContaminationSuspect === true) {
    decision.warnings.push('floor-contamination-suspect');
    decision.evidence.floorContamination = {
      message: item.floorContaminationReason ||
        'Verified solds far below mega-key floor — pool may contain reprints',
      source: 'mega-key-floor',
    };
  }

  // Warning: Q64 Tier-2.5 (all-stale sold pool)
  // When pricingSource='verified_sold_stale', all sold comps are >90d old.
  // Caps action to LIST_LOW (never LIST_NOW) due to market staleness.
  if (item.pricingSource === 'verified_sold_stale') {
    decision.warnings.push('all-sold-comps-stale');
    decision.evidence.allSoldStale = {
      message: 'All sold comps >90 days old — verify current market',
      tier: 2.5
    };
  }

  // PHASE 3: CRITICAL WARNING ESCALATION

  // Escalate zero-verified-comps to critical if thin active pool (v1-C)
  // When sold comps exist but none verified AND active pool is thin (< 3),
  // we lack sufficient market evidence for confident pricing
  const isZeroVerifiedCritical = verifiedSoldCount === 0 &&
                                  rawSoldCount > 0 &&
                                  activeCount < 3;

  // Q72 — RESEARCH escalation = PRICE-EVIDENCE flags only (not content/photo flags)
  // Content-unverified/photo-needed flags stay LIST_LOW/BUNDLE with PHOTOS NEEDED badge.
  // Only escalate when pricing math is uncertain (sold-active mismatch, zero-verified,
  // self-flag >100% drift, polybag/reprint warnings).
  const criticalWarnings = [
    'asset-type-uncertain',            // Q110 Part 1: possible non-comic image, needs review
    'identity-conflict-unresolved',    // Q110 Part 2: visual pool identity unconfirmed
    'refused-to-price',                // GL-1: refused state must never reach a LIST action
    'sold-active-mismatch-extreme',    // Price evidence: sold vs active divergence
    'era-risk-vintage-thin',           // Price evidence: thin Golden Age pool
    'active-avg-far-below',            // Price evidence: recommended far above asks
    'zero-verified-comps',             // Price evidence: no verified sold data
    'ai-verify-rejected-all',          // Price evidence: 100% comp rejection
    'verification-failed-claude',      // Price evidence: Claude gate rejected
    'verification-failed-no-data',     // Price evidence: zero comp data
    'verification-failed-visual-fallback',  // Price evidence: fallback to visual pool
    'verification-failed-reprint-thin',     // Price evidence: reprint thin pool
    'claude-check-high-severity',      // Price evidence: HIGH severity flag
    'web-search-pricing',              // Price evidence: web search fallback
    'reprint-polybag-detected',        // Price evidence: edition pricing uncertainty
    'floor-contamination-suspect',     // Price evidence: solds far below mega-key floor (XMEN1)
    'internal-inconsistency',          // Q118: Vision's own reason text contradicts its own structured fields
    'variant-comps-unavailable',       // Q129: era-excluded comps named a specific cover variant the priced pool doesn't
  ];
  // Removed: 'content-unverified' (not a price flag — stays LIST_LOW/BUNDLE)

  const hasCriticalWarning = decision.warnings.some(w => criticalWarnings.includes(w)) || isZeroVerifiedCritical;

  if (hasCriticalWarning) {
    decision.action = 'RESEARCH';
    decision.confidence = 'low';
    decision.reason = buildWarningReason(decision.warnings, item);
    decision.nextStep = 'Verify market state and review comps manually before listing';
    // v0-F: Enforce floor even in RESEARCH, EXCEPT for sold-active-mismatch-extreme
    // where the floor comes from garbage active comps and should not override
    // the recommended price derived from sold data.
    const researchPrice = item.rawComps?.average || item.price;
    const floor = item.rawComps?.lowest;
    const hasSoldActiveMismatch = decision.warnings.includes('sold-active-mismatch-extreme');
    decision.price = hasSoldActiveMismatch
      ? researchPrice
      : enforceFloor(researchPrice, floor);
    decision.evidence.warnings = decision.warnings;
    decision.bestChannel = computeBestChannel(decision, item);
    return decision;
  }

  // PHASE 4: OPPORTUNITY DETECTION

  // BUILD 1: Auto key detection influences grading decisions
  // Keys with strong auto-detection signal → lean toward CGC/HOLD
  const autoDetectedKey = item.autoDetectedKey === true;
  const keyCharacters = item.keyCharacters || [];
  const hasAutoKey = autoDetectedKey && keyCharacters.length > 0;

  // BUILD 2: Market velocity routing from GoCollect
  // Answers "who's the next buyer" — the 2026 market question
  const gcVelocity = item.goCollect?.velocity; // 'HIGH' | 'MEDIUM' | 'LOW' | null
  const gcTrend = item.goCollect?.trend;       // 'UP' | 'FLAT' | 'DOWN' | null
  const gcDaysToSell = item.goCollect?.daysToSell; // average days to sell

  // Classify market temperature
  const isHotMarket = gcVelocity === 'HIGH' || gcVelocity === 'FAST';
  const isColdMarket = gcVelocity === 'LOW' || gcVelocity === 'SLOW' || gcVelocity === 'NONE';
  const isTrendingUp = gcTrend === 'UP' || gcTrend === 'RISING' || gcTrend === 'BULLISH';
  const isTrendingDown = gcTrend === 'DOWN' || gcTrend === 'FALLING' || gcTrend === 'BEARISH';
  const isStale = gcDaysToSell && gcDaysToSell > 60; // Takes >2 months to sell

  decision.evidence.marketVelocity = {
    velocity: gcVelocity,
    trend: gcTrend,
    daysToSell: gcDaysToSell,
    isHot: isHotMarket,
    isCold: isColdMarket,
    trendingUp: isTrendingUp,
    trendingDown: isTrendingDown,
    isStale: isStale
  };

  // FIX 3: CGC grading upside detection (cost-aware, target-grade)
  // BUILD 1: Lower threshold for auto-detected keys (higher grading priority)
  const CGC_ALL_IN_COST = 75; // grading + press, economy tier
  const CGC_UPSIDE_THRESHOLD = hasAutoKey ? 30 : 50; // Lower bar for keys

  if (!item.isGraded && item.priceLadder && item.price != null && item.price > 0) {
    // Map raw grade to nearest CGC numeric grade (using shared gradeUtils.js)
    const currentGrade = item.grade || item.rawGrade || 'VG';
    const targetNumeric = GRADE_TO_NUMERIC[currentGrade] || 6.0;
    const ladder = item.priceLadder;

    // Find nearest available grade in ladder
    const ladderGrades = Object.keys(ladder).map(k => parseFloat(k)).sort((a, b) => Math.abs(a - targetNumeric) - Math.abs(b - targetNumeric));
    const nearestGrade = ladderGrades[0];
    const cgcValue = ladder[nearestGrade];

    if (cgcValue && cgcValue > 0) {
      // BUG 1 FIX: Use raw market price (pre-floor) for CGC upside calculation
      // item.price is floor-enforced final price (e.g., $173)
      // rawMarketPrice is pre-floor sold avg or PC×gradeMult (e.g., $62)
      const rawMarketPrice = item.soldCompsAvg
        || (item.priceCharting?.price && item.gradeMultiplier
            ? item.priceCharting.price * item.gradeMultiplier
            : item.price);

      const cgcUpside = cgcValue - rawMarketPrice - CGC_ALL_IN_COST;

      // Debug diagnostic for CGC candidate detection
      console.log('[cgc-check] floorPrice=', item.price,
        'rawMarketPrice=', rawMarketPrice,
        'soldCompsAvg=', item.soldCompsAvg,
        'pcBase=', item.priceCharting?.price,
        'gradeMult=', item.gradeMultiplier,
        'grade=', currentGrade,
        'mappedGrade=', targetNumeric,
        'nearestGrade=', nearestGrade,
        'cgcValue=', cgcValue,
        'cgcUpside=', cgcUpside,
        'triggered=', cgcUpside > rawMarketPrice);

      // BUILD 1: Lower threshold for auto-detected keys OR upside exceeds raw market price
      const meetsThreshold = hasAutoKey ? cgcUpside > CGC_UPSIDE_THRESHOLD : cgcUpside > rawMarketPrice;

      if (meetsThreshold) {
        decision.action = 'HOLD_FOR_CGC';
        decision.confidence = hasAutoKey ? 'high' : 'medium';
        const keyNote = hasAutoKey ? ` (key: ${keyCharacters.join(', ')})` : '';
        decision.reason = `CGC ${nearestGrade} target: $${cgcValue.toFixed(0)} (+$${cgcUpside.toFixed(0)} after ~$${CGC_ALL_IN_COST} cost)${keyNote}`;
        decision.nextStep = hasAutoKey
          ? 'Key issue detected — submit for grading to maximize value'
          : 'Submit for professional grading — upside exceeds raw value';
        decision.price = null; // Not listing, grading instead
        decision.evidence.gradingUpside = {
          floorEnforcedPrice: item.price,      // $173 floor-enforced (display)
          rawMarketPrice: rawMarketPrice,      // $62 pre-floor (calculation)
          targetGrade: nearestGrade,
          cgcValue: cgcValue,
          gradingCost: CGC_ALL_IN_COST,
          netUpside: cgcUpside,
          rawGrade: currentGrade,
          autoDetectedKey: hasAutoKey,         // BUILD 1
          keyCharacters: keyCharacters          // BUILD 1
        };
        decision.bestChannel = computeBestChannel(decision, item);
        return decision;
      }
    }
  }

  // Check for bundle opportunity
  const isLowDollar = item.price < 10;
  const catalogue = context.catalogue || [];
  const unlistedLowDollar = catalogue.filter(c =>
    c.status !== 'listed' &&
    c.price < 10 &&
    (item.id ? c.id !== item.id : true)  // Only exclude self if we have an id
  ).length;

  if (isLowDollar && unlistedLowDollar >= 5) {
    decision.warnings.push('bundle-candidate');
    decision.evidence.bundleOpportunity = {
      price: item.price,
      otherLowDollar: unlistedLowDollar
    };
  }

  // PHASE 5: NORMAL PRICING DECISIONS

  // Determine band recommendation based on warnings
  // Exclude informational-only warnings that don't affect market confidence
  // v1-C: zero-verified-comps is informational when activeCount >= 3 (escalates to RESEARCH only when < 3)
  // v0-F: recommended-below-floor is informational (floor already enforced in decision.price)
  const informationalWarnings = ['story-suppressed', 'zero-verified-comps', 'recommended-below-floor'];
  const actionableWarnings = decision.warnings.filter(w => !informationalWarnings.includes(w));
  const hasModerateWarnings = actionableWarnings.length > 0 && !hasCriticalWarning;

  if (hasModerateWarnings || decision.warnings.includes('bundle-candidate')) {
    decision.action = 'LIST_LOW';
    decision.confidence = 'medium';
    decision.reason = buildWarningReason(decision.warnings, item);
    decision.nextStep = 'List at Quick band or bundle with similar books';
    // v0-F: Enforce floor on conservative pricing
    const conservativePrice = item.price * 0.8;
    const floor = item.rawComps?.lowest;
    decision.price = enforceFloor(conservativePrice, floor);
    decision.evidence.warnings = decision.warnings;
    decision.bestChannel = computeBestChannel(decision, item);
    return decision;
  }

  // BUILD 2: Market velocity routing
  // Route based on GoCollect velocity + trend signals
  if (isColdMarket && isTrendingDown && item.price < 15) {
    // Cold + trending down → bundle or hold
    decision.action = 'LIST_LOW';
    decision.confidence = 'low';
    decision.reason = 'Cold market (low velocity, trending down) — bundle or wait';
    decision.nextStep = 'Bundle with similar books or hold for market recovery';
    decision.price = item.price * 0.7; // Deep discount for cold market
    decision.warnings.push('cold-market-velocity');
    decision.bestChannel = computeBestChannel(decision, item);
    return decision;
  }

  if (gcVelocity === 'NONE' || (isColdMarket && isStale)) {
    // No market activity or very slow → research
    decision.action = 'RESEARCH';
    decision.confidence = 'low';
    decision.reason = 'No market velocity detected — verify demand before listing';
    decision.nextStep = 'Check recent sales and adjust expectations';
    decision.price = item.price;
    decision.warnings.push('zero-velocity');
    decision.bestChannel = computeBestChannel(decision, item);
    return decision;
  }

  // Clean book - LIST_NOW at market
  decision.action = 'LIST_NOW';
  decision.confidence = 'high';

  // BUILD 2: Adjust pricing band based on velocity + trend
  if (isHotMarket && isTrendingUp) {
    // Hot market + trending up → aggressive pricing (stretch band)
    decision.confidence = 'high';
    decision.reason = 'Hot market (high velocity, trending up) — list at stretch band';
    decision.nextStep = 'List aggressively — strong buyer demand';
    decision.warnings.push('hot-market-velocity'); // Positive warning
  } else if (isHotMarket) {
    // Hot market + flat trend → market pricing
    decision.confidence = 'high';
    decision.reason = 'Active market (high velocity) — list at market band';
    decision.nextStep = 'List at market price — steady demand';
  } else if (isTrendingUp && !isColdMarket) {
    // Warming market → optimistic pricing
    decision.confidence = 'high';
    decision.reason = 'Trending up — list at market-to-stretch band';
    decision.nextStep = 'Market gaining momentum — price optimistically';
  }

  // v1-C: Cap confidence at medium when zero verified sold comps
  // Active comps may pass verification, but without sold confirmation we cap confidence
  if (verifiedSoldCount === 0 && rawSoldCount > 0) {
    decision.confidence = 'medium';
  }

  decision.reason = 'Clean identification and pricing, ready to list';
  decision.nextStep = 'List at market band';

  // v0-F: Enforce floor on list price
  const floor = item.rawComps?.lowest;
  decision.price = enforceFloor(item.price, floor);

  decision.evidence.clean = true;
  decision.evidence.pricingSource = item.pricingSource;

  // Q74 TIER-AWARE ESCALATION: LOW match confidence + LIST_NOW → RESEARCH
  // Prevents thin-data books from shipping without manual verification
  if (item.matchConfidence?.tier === 'LOW' && decision.action === 'LIST_NOW') {
    decision.action = 'RESEARCH';
    decision.warnings.push('low-confidence-escalation');
    decision.reason = 'Match confidence LOW — verify data quality before listing';
    decision.nextStep = 'Review comp accuracy and identity verification';
  }

  decision.bestChannel = computeBestChannel(decision, item);

  return decision;
}

// Q110 dispatch Part 3 (2026-07-18) — per-slug message builders. Split out
// of buildBlockerReason/buildWarningReason so App.jsx can render a specific
// reason PER blocker/warning (was: rendering the raw slug array directly,
// e.g. literally "content-unverified" — decision.reason existed with nicer
// text but was never wired to the card's per-item badge list). Exported so
// App.jsx can call these directly; buildBlockerReason/buildWarningReason
// below are now thin wrappers preserving their existing joined-string
// callers unchanged.
export function describeBlocker(slug, item) {
  if (slug === 'missing-title') return 'title not resolved — retake photo for a clearer title read';
  if (slug === 'identity-incomplete') return 'required identity fields missing (issue/publisher)';
  if (slug === 'identity-not-confident') return 'identity uncertain — title/issue/year/publisher not confirmed';
  if (slug === 'no-data-sources') return 'no pricing data available from any source';
  if (slug === 'manual-review-required') return 'manual review required';
  if (slug === 'mega-key-manual-review') return 'mega-key requires expert appraisal';
  if (slug === 'catastrophic-system-overprice') {
    const ratio = item.rawComps?.average ? item.price / item.rawComps.average : null;
    return ratio != null
      ? `system price $${item.price} is ${ratio.toFixed(1)}x active comps`
      : 'system price far exceeds active comps';
  }
  if (slug === 'catastrophic-reprint-overprice') return 'reprint/polybag detected with extreme overprice';
  if (slug === 'reprint-no-verified-comps') return 'reprint/polybag detected with no verified comps of any kind';
  if (slug === 'claude-check-critical') return item.claudeCheckBlocker || 'Claude critical verification failure';
  return slug;
}

// Q110 dispatch Part 3 — humanize a soldCompDiagnostics.reasons key
// ("variantMismatch" → "variant mismatch") for the dominant-cause message.
const humanizeReasonKey = (key) => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const STORY_SUPPRESSED_MESSAGES = {
  'era-gate-year-drift': 'story metadata year is outside the expected range for this printing',
  'foreign-edition': 'story metadata matched a foreign edition, not this printing',
  'title-weak-match': 'story metadata title only weakly matches this book',
  'title-token-mismatch': 'story metadata title tokens do not match this book',
  'publisher-mismatch': 'story metadata publisher does not match this book',
};

export function describeWarning(slug, item) {
  if (slug === 'asset-type-uncertain') {
    return item.listingHardLockBanner
      || 'This image may be a reference scan or promotional print — verify before listing';
  }
  if (slug === 'identity-conflict-unresolved') {
    return item.refusalReason
      ? `Visual pool identity uncertain — ${item.refusalReason}`
      : 'Visual pool identity uncertain — verify title/issue before listing';
  }
  if (slug === 'sold-active-mismatch-extreme') {
    const soldSum = item.soldComps?.reduce((sum, c) => sum + c.price, 0) || 0;
    const soldCount = item.soldComps?.length || 0;
    const soldAvg = soldCount > 0 ? soldSum / soldCount : null;
    const activeAvg = item.rawComps?.average;
    const soldStr = soldAvg != null && !isNaN(soldAvg) ? soldAvg.toFixed(0) : '?';
    const activeStr = activeAvg != null && !isNaN(activeAvg) ? activeAvg.toFixed(0) : '?';
    return `sold $${soldStr} vs active $${activeStr} mismatch`;
  }
  if (slug === 'era-risk-vintage-thin') return 'vintage era thin pool with sold/active conflict';
  if (slug === 'active-avg-far-below') return 'recommended price far above active comps';
  if (slug === 'active-floor-far-below') {
    const systemPrice = item.price;
    const activeLowest = item.rawComps?.lowest;
    return systemPrice && activeLowest
      ? `recommended price $${Number(systemPrice).toFixed(2)} is ${(systemPrice / activeLowest).toFixed(1)}x the active floor $${Number(activeLowest).toFixed(2)}`
      : 'recommended price far above the active floor';
  }
  if (slug === 'sold-comps-stale') {
    const days = item.soldComps?.length > 0
      ? Math.min(...item.soldComps.map((s) => s.daysAgo || 999))
      : null;
    return days != null ? `most recent sold comp is ${Math.round(days)} days old` : 'sold comps are stale';
  }
  if (slug === 'vision-low-confidence') return "Vision's own identification confidence was low";
  if (slug === 'web-search-pricing') {
    return item.webSearchEvidence || 'priced from a web-search fallback — no eBay comp data available';
  }
  if (slug === 'low-confidence-escalation') return 'match confidence LOW — verify data quality before listing';
  if (slug === 'cold-market-velocity') return 'cold market (low velocity, trending down) — bundle or wait';
  if (slug === 'hot-market-velocity') return 'hot market (high velocity, trending up)';
  if (slug === 'zero-velocity') return 'no market velocity detected — verify demand before listing';
  if (slug === 'thin-pool-anchor') {
    const count = item.rawComps?.count;
    return count != null ? `only ${count} active listing${count === 1 ? '' : 's'} found — thin comp pool` : 'thin comp pool (limited data)';
  }
  if (slug === 'bundle-candidate') return 'low-value, bundle recommended';
  if (slug === 'story-metadata-suspicious') return 'story metadata needs review';
  if (slug === 'reprint-polybag-detected') return 'reprint/polybag warning';
  if (slug === 'verification-failed-claude') return 'Claude verification failed';
  if (slug === 'verification-failed-no-data') return item.priceNote || 'no verified comps found';
  if (slug === 'verification-failed-visual-fallback') {
    return item.visualPoolSize
      ? `image search fallback — ${item.visualPoolSize} visually similar listings, identity unconfirmed`
      : 'image search fallback (verify identity)';
  }
  if (slug === 'verification-failed-reprint-thin') return 'reprint with thin data — fewer than 3 reprint-specific comps';
  if (slug === 'filter-bypass-detected') return 'filter criteria missing from comps';
  if (slug === 'claude-check-high-severity') return item.claudeCheckHighSeverity || 'Claude high-severity verification warning';
  if (slug === 'zero-verified-comps') {
    const reasons = item.soldCompDiagnostics?.reasons;
    if (reasons && typeof reasons === 'object') {
      const dominant = Object.entries(reasons).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
      if (dominant) {
        return `${item.soldCompDiagnostics.rawCount || dominant[1]} sold comps found but rejected — mostly ${humanizeReasonKey(dominant[0])}`;
      }
    }
    return 'sold comps exist but none verified';
  }
  if (slug === 'recommended-below-floor') {
    const floor = item.rawComps?.lowest;
    const floorStr = floor != null && !isNaN(floor) ? floor.toFixed(2) : '?';
    return `recommended below floor (raised to $${floorStr})`;
  }
  if (slug === 'comp-pool-contaminated') {
    if (item.variantFallback && item.reprintFallback) return 'comp pool used both variant and reprint fallback — verify edition/cover before listing';
    if (item.variantFallback) return 'comp pool fell back to any-variant comps — variant mismatch dominated the direct match';
    if (item.reprintFallback) return 'comp pool fell back to reprint-inclusive comps — verify this is the printing you have';
    return 'comp pool contamination detected';
  }
  if (slug === 'ai-verify-rejected-all') {
    const reasons = item.soldCompDiagnostics?.reasons;
    const dominant = reasons && typeof reasons === 'object'
      ? Object.entries(reasons).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
      : null;
    return dominant
      ? `AI verification rejected every comp — mostly ${humanizeReasonKey(dominant[0])}`
      : 'AI verification rejected every comp in the pool';
  }
  if (slug === 'uk-weekly-no-comps') {
    return item.variant
      ? `UK weekly/pence variant ("${item.variant}") — no eBay comps found, manual research required`
      : 'UK weekly/pence variant — no eBay comps found, manual research required';
  }
  if (slug === 'content-unverified') {
    return STORY_SUPPRESSED_MESSAGES[item.storySuppressedReason]
      || (item.storySuppressedReason?.startsWith('convergence-rejected')
        ? `story metadata rejected — axes disagreed (${item.storySuppressedReason.replace('convergence-rejected:', '')})`
        : 'story metadata suspicious or suppressed');
  }
  if (slug === 'internal-inconsistency') {
    const messages = item.visionConsistency?.flags?.map((f) => f.message) || [];
    return messages.length > 0
      ? `AI condition report contradicts its own structured fields — ${messages.join('; ')}`
      : 'AI condition report contradicts its own structured fields — review before listing';
  }
  if (slug === 'variant-comps-unavailable') {
    const v = item.variantCompsExcludedByEra;
    return v?.count
      ? `no current comps for your specific cover variant — ${v.count} matching listing(s) excluded as a different printing/year; price reflects generic/Main Cover comps only`
      : 'no current comps for your specific cover variant — price reflects a different printing';
  }
  if (slug === 'identity-from-consensus') {
    const c = item.identityConsensus;
    return c?.poolSize
      ? `identity adopted from ${c.poolSize}-listing comp consensus (Vision was low-confidence) — review before listing`
      : 'identity adopted from comp consensus — Vision was low-confidence';
  }
  if (slug === 'refused-to-price') {
    return item.priceNote || 'engine refused to price — no coherent market data';
  }
  if (slug === 'floor-contamination-suspect') {
    return item.floorContaminationReason || 'verified solds far below mega-key floor — pool may contain reprints';
  }
  if (slug === 'all-sold-comps-stale') return 'all sold comps >90 days old — verify current market';
  return slug;
}

// Thin wrapper preserving the existing joined-string decision.reason shape.
function buildBlockerReason(blockers, item) {
  return blockers.map((b) => describeBlocker(b, item)).join('; ');
}

function buildIdentityNextStep(blockers, item) {
  const steps = [];

  if (blockers.includes('missing-title')) steps.push('Rescan asset for clear title');
  if (blockers.includes('identity-incomplete')) steps.push('Rescan asset for missing identity fields');
  if (blockers.includes('identity-not-confident')) steps.push('Retake photo with better lighting or verify identity manually');

  return steps.join('; ') || 'Fix identity fields before listing';
}

function buildBlockerNextStep(blockers, item) {
  if (blockers.includes('mega-key-manual-review')) {
    return 'Get professional appraisal before listing';
  }
  if (blockers.includes('catastrophic-system-overprice') || blockers.includes('catastrophic-reprint-overprice')) {
    const activeAvg = item.rawComps?.average;
    return `List around market average $${activeAvg?.toFixed(2) || '?'} or bundle, not system price`;
  }
  if (blockers.includes('no-data-sources')) {
    return 'Verify identity and retry, or research manually';
  }

  return 'Resolve blockers before listing';
}

// Thin wrapper preserving the existing joined-string decision.reason shape.
function buildWarningReason(warnings, item) {
  const reasons = warnings.map((w) => describeWarning(w, item));
  return reasons.join('; ') || 'Warnings detected, review before listing';
}
