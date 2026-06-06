import { enforceFloor } from './pricingEngine.js';

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
  if (decision.action === 'GRADE_CANDIDATE') {
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
  if (decision.action === 'LIST_LOW' || price < 10) {
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

  // Fallback
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
  // EXCEPT: Golden Age thin pools may have contaminated active comps - handle as warning
  const activeAvg = item.rawComps?.average;
  const systemPrice = item.price;
  const year = parseInt(item.year);
  const isGoldenAge = year >= 1938 && year <= 1955;
  const isThinActive = item.rawComps?.count <= 2;

  if (systemPrice && activeAvg && systemPrice > activeAvg * 10) {
    // Skip blocker for Golden Age thin pools - let warnings handle it
    if (!(isGoldenAge && isThinActive)) {
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
      'refused-identity-conflict'
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

  // Warning: Golden Age thin-active-pool
  // Note: year, isGoldenAge, isThinActive already defined in blocker section above
  if (isGoldenAge && isThinActive && soldAvg && activeAvg && soldAvg > activeAvg * 3) {
    decision.warnings.push('golden-age-thin-active-mismatch');
    decision.evidence.goldenAgeThin = { year, activeCount: item.rawComps?.count, soldAvg, activeAvg };
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

  // PHASE 3: CRITICAL WARNING ESCALATION

  // Escalate zero-verified-comps to critical if thin active pool (v1-C)
  // When sold comps exist but none verified AND active pool is thin (< 3),
  // we lack sufficient market evidence for confident pricing
  const isZeroVerifiedCritical = verifiedSoldCount === 0 &&
                                  rawSoldCount > 0 &&
                                  activeCount < 3;

  // Escalate to RESEARCH if critical warnings
  const criticalWarnings = [
    'sold-active-mismatch-extreme',
    'golden-age-thin-active-mismatch',
    'active-avg-far-below',
    'ai-verify-rejected-all',
    'verification-failed-claude',
    'verification-failed-no-data',
    'verification-failed-visual-fallback',
    'verification-failed-reprint-thin',
    'claude-check-high-severity'  // HIGH severity from claude-gate
  ];

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

  // Check for grading upside
  if (item.price > 100 && !item.isGraded && item.priceLadder) {
    const currentGrade = item.grade || item.rawGrade;
    // Simple check: if price ladder shows significant upside
    const ladder = item.priceLadder;
    const ladderKeys = Object.keys(ladder).map(k => parseFloat(k)).sort((a, b) => b - a);
    const highestGradeFmv = ladder[ladderKeys[0]];

    if (highestGradeFmv && highestGradeFmv > item.price * 2) {
      decision.action = 'GRADE_CANDIDATE';
      decision.confidence = 'medium';
      decision.reason = `Grading upside detected: potential $${(highestGradeFmv - item.price).toFixed(0)} gain`;
      decision.nextStep = 'Consider professional grading submission';
      decision.price = null; // Not listing, grading instead
      decision.evidence.gradingUpside = {
        currentPrice: item.price,
        potentialFmv: highestGradeFmv,
        uplift: highestGradeFmv - item.price
      };
      decision.bestChannel = computeBestChannel(decision, item);
      return decision;
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

  // Clean book - LIST_NOW at market
  decision.action = 'LIST_NOW';
  decision.confidence = 'high';

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
  decision.bestChannel = computeBestChannel(decision, item);

  return decision;
}

function buildBlockerReason(blockers, item) {
  const reasons = [];

  if (blockers.includes('missing-title')) reasons.push('identity-incomplete: title not resolved');
  if (blockers.includes('identity-incomplete')) reasons.push('identity-incomplete: required fields missing');
  if (blockers.includes('identity-not-confident')) reasons.push('identity uncertain');
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
  if (warnings.includes('golden-age-thin-active-mismatch')) {
    reasons.push('Golden Age thin active pool with sold/active conflict');
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
