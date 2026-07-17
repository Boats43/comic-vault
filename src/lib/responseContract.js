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
// Q41 lock taxonomy (ruled 2026-07-12): every lock carries a class.
//   'integrity'     — the book/identity/evidence itself is suspect
//                     (qualified/restored label, floor contamination,
//                     polybag divergence, tier-0, manual review, blocked
//                     decisions). HARD, never acknowledgeable.
//   'insufficiency' — the engine simply lacks data to verify a price
//                     (tier-bypass, no-data-sources, bare refused, thin
//                     pool). Acknowledgeable WHEN the user sets a manual
//                     price (priceOverridden) and takes responsibility.
// Unlisted/unknown codes default to 'integrity' (conservative).
const INSUFFICIENCY_REFUSAL_SLUGS = new Set([
  'refused-tier-bypass-detected',
  'refused-no-data-sources',
  'refused',
]);

export function deriveLocks(out) {
  const locks = [];

  if (out.identityConfident === false || out.decision?.action === 'ID_REQUIRED') {
    locks.push({
      code: 'id-required',
      reason: out.identityReasons?.[0]
        || 'Identification incomplete — verify title, issue, and publisher before listing',
      hard: true,
      class: 'integrity',
    });
  }

  if (out.refusedToPrice === true) {
    locks.push({
      code: 'refused',
      reason: out.priceNote || 'Cannot price — no verified market data for this book',
      hard: true,
      // Q41: class from the refusal slug — data insufficiency is
      // acknowledgeable, integrity refusals (qualified-label,
      // polybag-pc-divergence, identity-conflict, reprint) are not.
      class: INSUFFICIENCY_REFUSAL_SLUGS.has(out.pricingSource)
        ? 'insufficiency'
        : 'integrity',
    });
  }

  if (out.listingHardLocked) {
    locks.push({
      code: out.listingHardLockReason || 'listing-hard-locked',
      // GL-2: generic banner support — the contamination copy was baked in
      // as the only fallback, which mislabels non-floor locks (qualified/
      // restored label). Banner beats contamination reason beats legacy copy.
      reason: out.listingHardLockBanner
        || out.floorContaminationReason
        || 'Verified solds far below key floor — pool may contain reprints',
      hard: true,
      class: 'integrity',
    });
  }

  if (out.tier0Locked) {
    locks.push({
      code: 'tier0-convergence',
      reason: 'Mega-key identity convergence below 70 — verify this is the correct book before listing',
      hard: true,
      class: 'integrity',
    });
  }

  if (out.manualReviewRequired) {
    locks.push({
      code: 'manual-review',
      reason: out.manualReviewReason || 'Mega-key requires expert appraisal before listing',
      hard: true,
      class: 'integrity',
    });
  }

  if (out.gradeExceedsMap) {
    locks.push({
      code: 'grade-exceeds-map',
      reason: out.gradeExceedsMapReason || 'Grade exceeds the verified floor map — manual pricing required',
      hard: true,
      class: 'integrity',
    });
  }

  if (out.claudeCheckBlocker) {
    locks.push({
      code: 'claude-check-blocker',
      reason: typeof out.claudeCheckBlocker === 'string'
        ? out.claudeCheckBlocker
        : 'Verification flagged a critical mismatch — review before listing',
      hard: true,
      class: 'integrity',
    });
  }

  if (out.decision?.action === 'DO_NOT_LIST' || out.decision?.blockers?.length > 0) {
    // Only add when no more specific lock above already covers it
    if (locks.length === 0) {
      locks.push({
        code: 'decision-blocked',
        reason: out.decision?.blockers?.[0] || 'Decision engine blocked listing',
        hard: true,
        class: 'integrity',
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
      class: 'insufficiency',
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
 *
 * priceBands is only trusted when the final price sits INSIDE it — writers
 * that run after the band build (mega-key floor, variant/key multipliers)
 * can legitimately move the price without a band rebuild; the paired
 * priceLow/High always reflect the LAST writer, so fall through to those.
 */
function deriveBands(out, priceNum) {
  if (priceNum == null) return null;

  const pb = out.priceBands;
  if (
    pb && pb.quick != null && pb.market != null && pb.stretch != null &&
    priceNum >= pb.quick - 0.011 && priceNum <= pb.stretch + 0.011
  ) {
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

// ─────────────────────────────────────────────────────────────────
// Ship 24c — Anchor-direction rule (Layer B pricing math, greenlit
// 2026-07-11 with SHIP24_CONTRACT.md §3 parameters)
// ─────────────────────────────────────────────────────────────────

const medianOf = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

/**
 * When sold-active mismatch is EXTREME, the contract price anchors to the
 * VERIFIED SOLDS side, never to actives (Action #33 exhibit: $291-class
 * stale solds vs $13–23 junk actives — solds win, RESEARCH stays).
 *
 * Fires when ALL of:
 * - ≥3 verified solds AND soldMedian > activeMedian × 3 (the existing
 *   isActiveContaminated threshold from priceBands.js)
 * - the net price landed on the actives side (< soldMedian × 0.5)
 * - state is PRICED/ESTIMATED, and NOT a mega-key path (X-Men floor
 *   contamination ruling and verified floors win there)
 *
 * Anchor: all-stale sold pool → soldAvg × 0.85 (tier-2.5 staleness
 * discount, unknown recency counted as stale — conservative); any fresh
 * solds → soldMedian. Decision forced to RESEARCH — a mismatch this
 * extreme is never LIST-clean.
 */
function applyAnchorDirection(out, contract) {
  if (contract.price == null) return;
  if (contract.state !== 'PRICED' && contract.state !== 'ESTIMATED') return;
  if (out.floorContaminationSuspect || out.listingHardLocked || out.megaKeyFloorApplied) return;

  const soldPrices = (out.soldComps || [])
    .map((s) => parsePriceNumber(s?.price))
    .filter((p) => p != null && p > 0);
  if (soldPrices.length < 3) return;

  const activePrices = (out.rawComps?.prices || [])
    .map((p) => (typeof p === 'number' ? p : parsePriceNumber(p?.price)))
    .filter((p) => p != null && p > 0);
  if (activePrices.length === 0) return;

  const soldMedian = medianOf(soldPrices);
  const activeMedian = medianOf(activePrices);
  if (!(soldMedian > activeMedian * 3)) return;
  if (contract.price >= soldMedian * 0.5) return; // already sold-side

  const allStale = (out.soldComps || []).every(
    (s) => s?.daysAgo == null || s.daysAgo > 90
  );
  const soldAvg = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length;
  const soldLow = Math.min(...soldPrices);
  const anchor = round2(allStale ? soldAvg * 0.85 : soldMedian);
  const priorPrice = contract.price;

  contract.price = anchor;
  contract.bands = {
    quick: round2(allStale ? soldLow * 0.85 : soldLow),
    market: anchor,
    stretch: round2(anchor * 1.15),
  };
  contract.decision.action = 'RESEARCH';
  if (!contract.decision.warnings.includes('sold-active-mismatch-extreme')) {
    contract.decision.warnings.push('sold-active-mismatch-extreme');
  }
  contract.bestChannel = 'research';
  contract.listable = false;
  contract.soldSideAnchored = true;

  console.log(
    `[24c] anchor-direction: soldMedian=$${soldMedian.toFixed(2)} (${soldPrices.length} solds${allStale ? ', all stale' : ''}) ` +
    `activeMedian=$${activeMedian.toFixed(2)} — price $${priorPrice.toFixed(2)} → $${anchor.toFixed(2)} sold-side, RESEARCH forced`
  );
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
        blockers: Array.isArray(d.blockers) ? [...d.blockers] : [],
        warnings: Array.isArray(d.warnings) ? [...d.warnings] : [],
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

  const contract = {
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

  // Ship 24c — verified solds outrank junk actives on extreme mismatch
  applyAnchorDirection(out, contract);

  return contract;
}

// ─────────────────────────────────────────────────────────────────
// Ship 24b — Invariant validator (API boundary)
// ─────────────────────────────────────────────────────────────────

const CENT = 0.011; // rounding tolerance for band containment

/**
 * Validate the assembled contract against invariants I1–I10
 * (docs/SHIP24_CONTRACT.md §2). NEVER throws, never 500s. On violation:
 * demote state to INCOMPLETE, lock listing, record the invariant, and emit
 * a greppable [contract-violation] log line. Ship no self-contradicting
 * card ever again — worst case is an honest INCOMPLETE with a locked button.
 *
 * Mutates and returns `contract`.
 */
export function validateContract(contract, out) {
  const violations = [];
  const fail = (id, detail) => violations.push(`${id}: ${detail}`);

  // Q41 (ruled 2026-07-12) — acknowledged-override exception for I2/I3.
  // listable may be true despite locks ONLY when every lock is
  // insufficiency-class AND the user acknowledged with a manual price
  // (priceOverridden). Server assembly never sets these fields — the flip
  // happens client-side on the card — so server-side validation still
  // fails any listable+locked contract it produces itself. Integrity
  // locks remain invariant-protected unconditionally.
  const ackOverrideValid =
    out?.listingAcknowledged === true &&
    out?.priceOverridden === true &&
    contract.locks.length > 0 &&
    contract.locks.every((l) => l.class === 'insufficiency');

  // I1 / I2 — REFUSED and ID_REQUIRED render nothing priced
  if (contract.state === 'REFUSED' || contract.state === 'ID_REQUIRED') {
    if (contract.price !== null) fail('I1', `${contract.state} with price ${contract.price}`);
    if (contract.bands !== null) fail('I1', `${contract.state} with bands`);
    if (contract.listable && !ackOverrideValid) fail('I2', `${contract.state} marked listable`);
  }

  // I3 — any lock forbids listing (Q41: unless acknowledged insufficiency)
  if (contract.locks.length > 0 && contract.listable && !ackOverrideValid) {
    fail('I3', `listable with ${contract.locks.length} lock(s): ${contract.locks.map((l) => l.code).join(',')}`);
  }

  // I4 — LOCKED must carry at least one lock
  if (contract.state === 'LOCKED' && contract.locks.length === 0) {
    fail('I4', 'state LOCKED with empty locks[]');
  }

  // I5 — a price must sit inside its own bands
  if (contract.price != null) {
    if (!contract.bands) {
      fail('I5', `price ${contract.price} with null bands`);
    } else if (
      contract.price < contract.bands.quick - CENT ||
      contract.price > contract.bands.stretch + CENT
    ) {
      fail('I5', `price ${contract.price} outside bands [${contract.bands.quick}, ${contract.bands.stretch}]`);
    }
  }

  // I6 — exactly one verifiedCount source
  const diagCount = out?.soldCompDiagnostics?.verifiedCount ?? 0;
  if (contract.verifiedCount !== diagCount) {
    fail('I6', `contract.verifiedCount ${contract.verifiedCount} != soldCompDiagnostics.verifiedCount ${diagCount}`);
  }

  // I7 — recommended == header == grade-row: decision.price must equal the
  // contract price (finalizeResponse syncs it; this catches later writers)
  if (out?.decision && typeof out.decision === 'object') {
    const dp = parsePriceNumber(out.decision.price);
    if (dp !== contract.price) {
      fail('I7', `out.decision.price ${dp} != contract.price ${contract.price}`);
    }
  }

  // I8 — source/state coherence
  if (contract.price != null && (contract.source == null || contract.source === 'refused')) {
    fail('I8', `price ${contract.price} with source ${contract.source}`);
  }
  if (contract.state === 'PRICED' && !PRICED_SOURCES.has(contract.source)) {
    fail('I8', `state PRICED with non-verified-sold source ${contract.source}`);
  }
  if (contract.state === 'ESTIMATED' && PRICED_SOURCES.has(contract.source)) {
    fail('I8', `state ESTIMATED with verified-sold source ${contract.source}`);
  }

  // I9 — customer-grade drift: price >100% over its own pool avg must not
  // ship a LIST action. Pool = the pool that priced the book (sold avg for
  // verified-sold sources, active avg for ask-derived). Skipped for
  // estimate-class sources (no pool) and mega-key floors (verified table
  // legitimately prices above a contaminated pool).
  if (
    contract.price != null &&
    (contract.decision.action === 'LIST_NOW' || contract.decision.action === 'LIST_LOW') &&
    !out?.megaKeyFloorApplied
  ) {
    let poolAvg = null;
    if (PRICED_SOURCES.has(contract.source)) {
      poolAvg = parsePriceNumber(out?.soldCompsAvg);
    } else if (
      contract.source === 'active_ask_derived' ||
      contract.source === 'verified_active' ||
      contract.source === 'ebay-polybag-active' ||
      contract.source === 'thin_pool_anchor'  // GL-4: anchor output is active-derived
    ) {
      poolAvg = parsePriceNumber(out?.rawComps?.average);
    }
    if (poolAvg != null && poolAvg > 0 && contract.price > poolAvg * 2) {
      fail('I9', `price ${contract.price} >100% over own pool avg ${poolAvg} with action ${contract.decision.action}`);
    }
  }

  // I10 — blocked decisions forbid listing
  if (
    (contract.decision.action === 'DO_NOT_LIST' ||
      contract.decision.action === 'ID_REQUIRED' ||
      contract.decision.blockers.length > 0) &&
    contract.listable
  ) {
    fail('I10', `listable with blocking decision ${contract.decision.action} (${contract.decision.blockers.length} blockers)`);
  }

  // I11 (GL-1, EX-1/D-3 rule a) — the PRE-derivation values must agree:
  // out.price and out.priceBands.market are what the pipeline PUBLISHED
  // (deriveBands can silently hide a fork by re-deriving bands around a
  // price that escaped them — this rule inspects the raw pair instead).
  // Exception: mega-key floor override (D-3) — floor legitimately outranks
  // the sold-derived band and rebuilds it as the single source of truth.
  if (!out?.megaKeyFloorApplied) {
    const outPrice = parsePriceNumber(out?.price);
    const outMarket = parsePriceNumber(out?.priceBands?.market);
    if (outPrice != null && outMarket != null && Math.abs(outPrice - outMarket) > CENT) {
      fail('I11', `out.price ${outPrice} != out.priceBands.market ${outMarket} (source ${out?.pricingSource})`);
    }
  }

  // I12 (GL-1, EX-2 rule b) — a refused price forbids list-class decisions.
  // RESEARCH/HOLD per ruling; ID_REQUIRED ratified for identity-class;
  // DO_NOT_LIST allowed as stricter-than-required (existing no-data-sources
  // blocker behavior preserved).
  if (contract.state === 'REFUSED' || out?.refusedToPrice === true) {
    const allowed = new Set(['RESEARCH', 'HOLD', 'ID_REQUIRED', 'DO_NOT_LIST']);
    if (contract.decision.action && !allowed.has(contract.decision.action)) {
      fail('I12', `refused price with decision ${contract.decision.action}`);
    }
  }

  if (violations.length > 0) {
    violations.forEach((v) => console.log(`[contract-violation] ${v}`));
    contract.violations = violations;
    contract.state = 'INCOMPLETE';
    contract.listable = false;
    contract.locks.push({
      code: 'contract-violation',
      reason: 'Pricing evidence is inconsistent — card demoted pending review',
      hard: true,
    });

    // Q109 dispatch Part 1 (2026-07-16, ASM #17 Ditko I9 case): a
    // self-flagged contract violation (I1-I12) must not ship a LIST-class
    // decision — the checklist "Decision safe" pill and any consumer that
    // reads decision.action directly (not contract.listable) would
    // otherwise still display/treat the card as list-ready. Mirrors
    // applyAnchorDirection's RESEARCH-cap pattern above exactly.
    // Conservative-only: never overrides a decision already stricter than
    // RESEARCH (DO_NOT_LIST, ID_REQUIRED) — only downgrades the LIST_*
    // action the violation just proved unsafe.
    if (typeof contract.decision.action === 'string' && contract.decision.action.startsWith('LIST')) {
      contract.decision.action = 'RESEARCH';
      contract.bestChannel = 'research';
      contract.decisionCappedByViolation = true;
      if (!contract.decision.warnings.includes('contract-violation-decision-capped')) {
        contract.decision.warnings.push('contract-violation-decision-capped');
      }
    }
  }

  return contract;
}

/**
 * Assemble → validate → attach. Call this immediately before res.json()
 * on every substantive response exit. Mutates and returns `out`.
 *
 * I7 single-number guarantee: out.decision.price is OVERWRITTEN to the
 * contract price so decision panel, stats bar, Recommended row, and List
 * button are definitionally equal. (Also fixes the pre-existing NaN class:
 * computeDecision does arithmetic on fmtUsd strings — "$4.82" * 0.8 → NaN
 * → serialized null.)
 */
export function finalizeResponse(out) {
  const contract = assembleContract(out);
  if (out.decision && typeof out.decision === 'object') {
    out.decision.price = contract.price;
    // Ship 24c — keep the legacy decision object coherent with the
    // anchored contract (action pill / bestChannel badge read it).
    if (contract.soldSideAnchored) {
      out.decision.action = 'RESEARCH';
      out.decision.bestChannel = 'research';
      if (Array.isArray(out.decision.warnings) &&
          !out.decision.warnings.includes('sold-active-mismatch-extreme')) {
        out.decision.warnings.push('sold-active-mismatch-extreme');
      }
    }
  }
  validateContract(contract, out);

  // Q109 dispatch Part 1: validateContract runs after the soldSideAnchored
  // mirror above, so a violation-capped decision needs its own sync step
  // once contract.decision.action has actually been mutated to RESEARCH.
  if (out.decision && typeof out.decision === 'object' && contract.decisionCappedByViolation) {
    out.decision.action = 'RESEARCH';
    if (Array.isArray(out.decision.warnings) &&
        !out.decision.warnings.includes('contract-violation-decision-capped')) {
      out.decision.warnings.push('contract-violation-decision-capped');
    }
  }

  out.contract = contract;
  return out;
}
