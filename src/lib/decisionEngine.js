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

  // Blocker: Vision itself determined the image is not a comic book at all
  // (2026-07-18, anime/manga poster class). This is distinct from
  // identity-not-confident — Vision can be fully confident about grade/price
  // while explicitly stating the physical item isn't a comic. Must hard-gate
  // regardless of how the rest of identity resolved (visual pool matches on
  // title text can still populate confident-looking fields for a poster
  // that happens to share a comic's title).
  if (item.assetTypeConfident === false) {
    decision.blockers.push('asset-type-mismatch');
  }

  // Blocker: Pricing source refusals
  if (item.pricingSource === 'refused-identity-conflict') {
    decision.blockers.push('refused-identity-conflict');
  }
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
      'identity-not-confident',
      'refused-identity-conflict',
      'asset-type-mismatch'
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

function buildBlockerReason(blockers, item) {
  const reasons = [];

  if (blockers.includes('missing-title')) reasons.push('identity-incomplete: title not resolved');
  if (blockers.includes('identity-incomplete')) reasons.push('identity-incomplete: required fields missing');
  if (blockers.includes('identity-not-confident')) reasons.push('identity uncertain');
  if (blockers.includes('asset-type-mismatch')) reasons.push('Vision determined this is not a comic book');
  if (blockers.includes('refused-identity-conflict')) reasons.push('identity conflict');
  if (blockers.includes('no-data-sources')) reasons.push('no pricing data available');
  if (blockers.includes('manual-review-required')) reasons.push('manual review required');
  if (blockers.includes('mega-key-manual-review')) reasons.push('mega-key requires expert appraisal');
  if (blockers.includes('catastrophic-system-overprice')) {
    const ratio = item.price / item.rawComps?.average;
    reasons.push(`system price $${item.price} is ${ratio.toFixed(1)}x active comps`);
  }
  if (blockers.includes('catastrophic-reprint-overprice')) {
    reasons.push('reprint/polybag detected with extreme overprice');
  }
  if (blockers.includes('claude-check-critical')) {
    reasons.push('Claude critical verification failure');
  }

  return reasons.join('; ');
}

function buildIdentityNextStep(blockers, item) {
  const steps = [];

  if (blockers.includes('missing-title')) steps.push('Rescan asset for clear title');
  if (blockers.includes('identity-incomplete')) steps.push('Rescan asset for missing identity fields');
  if (blockers.includes('identity-not-confident')) steps.push('Retake photo with better lighting or verify identity manually');
  if (blockers.includes('asset-type-mismatch')) steps.push('Confirm this is actually a comic book before pricing/listing');

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

function buildWarningReason(warnings, item) {
  const reasons = [];

  if (warnings.includes('sold-active-mismatch-extreme')) {
    const soldSum = item.soldComps?.reduce((sum, c) => sum + c.price, 0) || 0;
    const soldCount = item.soldComps?.length || 0;
    const soldAvg = soldCount > 0 ? soldSum / soldCount : null;
    const activeAvg = item.rawComps?.average;
    const soldStr = soldAvg != null && !isNaN(soldAvg) ? soldAvg.toFixed(0) : '?';
    const activeStr = activeAvg != null && !isNaN(activeAvg) ? activeAvg.toFixed(0) : '?';
    reasons.push(`sold $${soldStr} vs active $${activeStr} mismatch`);
  }
  if (warnings.includes('era-risk-vintage-thin')) {
    reasons.push('vintage era thin pool with sold/active conflict');
  }
  if (warnings.includes('active-avg-far-below')) {
    reasons.push('recommended price far above active comps');
  }
  if (warnings.includes('thin-pool-anchor')) {
    reasons.push('thin comp pool (limited data)');
  }
  if (warnings.includes('bundle-candidate')) {
    reasons.push('low-value, bundle recommended');
  }
  if (warnings.includes('story-metadata-suspicious')) {
    reasons.push('story metadata needs review');
  }
  if (warnings.includes('reprint-polybag-detected')) {
    reasons.push('reprint/polybag warning');
  }
  if (warnings.includes('verification-failed-claude')) {
    reasons.push('Claude verification failed');
  }
  if (warnings.includes('verification-failed-no-data')) {
    reasons.push('no verified comps found');
  }
  if (warnings.includes('verification-failed-visual-fallback')) {
    reasons.push('image search fallback (verify identity)');
  }
  if (warnings.includes('verification-failed-reprint-thin')) {
    reasons.push('reprint with thin data');
  }
  if (warnings.includes('filter-bypass-detected')) {
    reasons.push('filter criteria missing from comps');
  }
  if (warnings.includes('claude-check-high-severity')) {
    reasons.push('Claude high-severity verification warning');
  }
  if (warnings.includes('zero-verified-comps')) {
    reasons.push('sold comps exist but none verified');
  }
  if (warnings.includes('recommended-below-floor')) {
    const floor = item.rawComps?.lowest;
    const floorStr = floor != null && !isNaN(floor) ? floor.toFixed(2) : '?';
    reasons.push(`recommended below floor (raised to $${floorStr})`);
  }

  return reasons.join('; ') || 'Warnings detected, review before listing';
}
