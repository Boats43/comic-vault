// Ship #24 — Response Contract (single-writer canonical block)
//
// One canonical block assembled ONCE at response end. Card + collection
// render ONLY from this block. Nothing writes price/decision fields after
// assembly — finalizeResponse() must be the last call before res.json().
//
// Design doc: docs/SHIP24_CONTRACT.md (greenlit 2026-07-11, incl. Layer B 24c)

/**
 * Parse any price representation the pipeline produces into a number.
 * Handles fmtUsd strings ("$1,234.56"), raw numbers (visual-pool writer),
 * and null/undefined/NaN → null.
 */
export function parsePriceNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Ruling 2 (greenlight §7-2): PRICED reserved for verified-sold tiers
// (1 / 2 / 2.5) and sold-active blend. Everything ask-derived or
// estimate-class renders ESTIMATED.
const PRICED_SOURCES = new Set([
  'verified_sold_recency',      // tier 1
  'sold_active_blend_30',       // tier 2 blend
  'verified_sold',              // tier 2 sold-only / legacy
  'verified_sold_stale',        // tier 2.5
  'verified_sold_active_blend', // key-mult relabel of blend
]);

const ESTIMATED_SOURCES = new Set([
  'active_ask_derived',   // tier 3
  'verified_active',      // legacy active-only
  'ebay-polybag-active',  // polybag active-ask pricing
  'visual_pool_fallback', // image-search pool
  'pc_estimate',          // tier 4
  'web_search_fallback',
  'ai_estimate',
]);

const REFUSED_SOURCE_RE = /^refused/;

/**
 * Normalize the pipeline's pricingSource vocabulary for the contract.
 * refused-* variants collapse to 'refused'; identity-required is a refuse
 * of the ID_REQUIRED class and keeps its own value for state derivation.
 */
function normalizeSource(pricingSource) {
  if (!pricingSource) return null;
  if (REFUSED_SOURCE_RE.test(pricingSource)) return 'refused';
  return pricingSource;
}

/**
 * Derive locks[] — every reason listing is blocked, machine-readable.
 * locks[0].reason renders verbatim as the card banner (Amendment B),
 * so entries are ordered most-severe-first and reasons are human copy.
 * `hard: true` locks also drive state=LOCKED; soft locks only gate the
 * List button (listable=false) without changing state.
 */
export function deriveLocks(out) {
  const locks = [];

  if (out.identityConfident === false || out.decision?.action === 'ID_REQUIRED') {
    locks.push({
      code: 'id-required',
      reason: out.identityReasons?.[0]
        || 'Identification incomplete — verify title, issue, and publisher before listing',
      hard: true,
    });
  }

  if (out.refusedToPrice === true) {
    locks.push({
      code: 'refused',
      reason: out.priceNote || 'Cannot price — no verified market data for this book',
      hard: true,
    });
  }

  if (out.listingHardLocked) {
    locks.push({
      code: out.listingHardLockReason || 'listing-hard-locked',
      reason: out.floorContaminationReason
        || 'Verified solds far below key floor — pool may contain reprints',
      hard: true,
    });
  }

  if (out.tier0Locked) {
    locks.push({
      code: 'tier0-convergence',
      reason: 'Mega-key identity convergence below 70 — verify this is the correct book before listing',
      hard: true,
    });
  }

  if (out.manualReviewRequired) {
    locks.push({
      code: 'manual-review',
      reason: out.manualReviewReason || 'Mega-key requires expert appraisal before listing',
      hard: true,
    });
  }

  if (out.gradeExceedsMap) {
    locks.push({
      code: 'grade-exceeds-map',
      reason: out.gradeExceedsMapReason || 'Grade exceeds the verified floor map — manual pricing required',
      hard: true,
    });
  }

  if (out.claudeCheckBlocker) {
    locks.push({
      code: 'claude-check-blocker',
      reason: typeof out.claudeCheckBlocker === 'string'
        ? out.claudeCheckBlocker
        : 'Verification flagged a critical mismatch — review before listing',
      hard: true,
    });
  }

  if (out.decision?.action === 'DO_NOT_LIST' || out.decision?.blockers?.length > 0) {
    // Only add when no more specific lock above already covers it
    if (locks.length === 0) {
      locks.push({
        code: 'decision-blocked',
        reason: out.decision?.blockers?.[0] || 'Decision engine blocked listing',
        hard: true,
      });
    }
  }

  // Tier-0 thin-pool list lock — previously computed inline in App.jsx
  // (matchConfidence LOW + fewer than 3 total comps). Soft: gates the
  // button, does not flip state to LOCKED.
  const totalComps = (out.soldComps?.length || 0) + (out.rawComps?.count || 0);
  if (out.matchConfidence?.tier === 'LOW' && totalComps < 3) {
    locks.push({
      code: 'low-tier-thin-pool',
      reason: 'Match confidence LOW with under 3 comps — verify before listing',
      hard: false,
    });
  }

  return locks;
}

/**
 * State enum resolution — precedence order, first match wins
 * (design doc §1.2, greenlight ruling 4):
 *   ID_REQUIRED → REFUSED → LOCKED → PRICED/ESTIMATED → INCOMPLETE
 * LOCKED keeps price visible (XMEN1 ruling); REFUSED renders null.
 */
function deriveState(out, locks, priceNum, source) {
  if (out.identityConfident === false || out.decision?.action === 'ID_REQUIRED') {
    return 'ID_REQUIRED';
  }
  if (out.refusedToPrice === true || source === 'refused') {
    return 'REFUSED';
  }
  const hasHardLock = locks.some(
    (l) => l.hard && l.code !== 'refused' && l.code !== 'id-required'
  );
  if (hasHardLock) return 'LOCKED';
  if (priceNum != null) {
    return PRICED_SOURCES.has(source) ? 'PRICED' : 'ESTIMATED';
  }
  return 'INCOMPLETE';
}

/**
 * Bands as numbers. Preference: priceBands (tier engine) → priceLow/High
 * around the price → degenerate band at the price. null when price null.
 */
function deriveBands(out, priceNum) {
  if (priceNum == null) return null;

  const pb = out.priceBands;
  if (pb && pb.quick != null && pb.market != null && pb.stretch != null) {
    return {
      quick: round2(pb.quick),
      market: round2(pb.market),
      stretch: round2(pb.stretch),
    };
  }

  const low = parsePriceNumber(out.priceLow);
  const high = parsePriceNumber(out.priceHigh);
  return {
    quick: round2(low != null && low <= priceNum ? low : priceNum),
    market: round2(priceNum),
    stretch: round2(high != null && high >= priceNum ? high : priceNum),
  };
}

/**
 * Assemble the canonical contract block from the final `out` object
 * (post-computeDecision). Pure — does not mutate `out`.
 */
export function assembleContract(out) {
  const locks = deriveLocks(out);
  const rawPrice = parsePriceNumber(out.price);
  const source = normalizeSource(out.pricingSource);
  const state = deriveState(out, locks, rawPrice, source);

  // REFUSED / ID_REQUIRED render price NULL everywhere (ruling 3 — no
  // $0.00 strings, honest "cannot price" copy comes from locks[0].reason).
  const price = (state === 'REFUSED' || state === 'ID_REQUIRED')
    ? null
    : round2(rawPrice);

  const bands = price == null ? null : deriveBands(out, price);

  // Decision snapshot — always the FINAL computeDecision result, never a
  // pre-seed. When absent (early-exit paths), synthesize the conservative
  // action for the state (renders less confidence, never more).
  const d = out.decision;
  const decision = d
    ? {
        action: d.action || null,
        confidence: d.confidence ? String(d.confidence).toUpperCase() : null,
        blockers: Array.isArray(d.blockers) ? d.blockers : [],
        warnings: Array.isArray(d.warnings) ? d.warnings : [],
        nextStep: d.nextStep || '',
      }
    : {
        action: state === 'ID_REQUIRED' ? 'ID_REQUIRED' : 'DO_NOT_LIST',
        confidence: 'LOW',
        blockers: locks.filter((l) => l.hard).map((l) => l.reason),
        warnings: [],
        nextStep: '',
      };

  const listable =
    locks.length === 0 &&
    (state === 'PRICED' || state === 'ESTIMATED') &&
    typeof decision.action === 'string' &&
    decision.action.startsWith('LIST');

  return {
    version: 1,
    state,
    price,
    source,
    tier: out.priceBands?.tier ?? null,
    verifiedCount: out.soldCompDiagnostics?.verifiedCount ?? 0,
    bands,
    decision,
    bestChannel: d?.bestChannel ?? (listable ? null : 'blocked'),
    listable,
    locks,
    violations: [],
  };
}

/**
 * Assemble → (validate, Ship 24b) → attach. Call this immediately before
 * res.json() on every substantive response exit. Mutates and returns `out`.
 *
 * I7 single-number guarantee: out.decision.price is OVERWRITTEN to the
 * contract price so decision panel, stats bar, Recommended row, and List
 * button are definitionally equal. (Also fixes the pre-existing NaN class:
 * computeDecision does arithmetic on fmtUsd strings — "$4.82" * 0.8 → NaN
 * → serialized null.)
 */
export function finalizeResponse(out) {
  const contract = assembleContract(out);
  // validateContract(contract, out) — Ship 24b, next commit in sequence
  out.contract = contract;
  if (out.decision && typeof out.decision === 'object') {
    out.decision.price = contract.price;
  }
  return out;
}
