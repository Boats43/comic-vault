// Ship #24 — Response Contract (single-writer canonical block)
//
// One canonical block assembled ONCE at response end. Card + collection
// render ONLY from this block. Nothing writes price/decision fields after
// assembly — finalizeResponse() must be the last call before res.json().
//
// Design doc: docs/SHIP24_CONTRACT.md (greenlit 2026-07-11, incl. Layer B 24c)
//
// GrailKey Directive Z — deriveActionAuthority/deriveMarketStanding/
// deriveIdentityStanding (src/lib/actionAuthority.js) are the transaction-
// authority boundary; contract.listable is now a pure projection of
// contract.actionAuthority.state === 'READY', not an independently
// re-derived formula. See that module's own header for the full design.

import { deriveActionAuthority, deriveMarketStanding, deriveIdentityStanding } from './actionAuthority.js';

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

  // Q133 Slice 2 follow-up (2026-07-21) — this used to also fire on bare
  // out.identityConfident === false, independent of out.decision?.action.
  // That was a THIRD independent copy of the same "is this identity
  // genuinely unconfirmed" judgment decisionEngine.js already makes (the
  // first two: out.identityComplete in api/enrich.js, fixed Slice 1c; the
  // identity-not-confident BLOCKER itself in decisionEngine.js, which now
  // has explicit isPublisherOnlyGap/isPoolProvisionalIdentity exceptions).
  // Once Slice 1c/2 made identityConfident=false legitimately NOT mean
  // "hard block" in those two cases, this site's independent OR-clause
  // silently reopened the wall decisionEngine.js had just closed — a
  // promoted refused-identity card (Rachta Lin, Lozano) or a publisher-
  // only-gap card (Invincible) showed decision.action=RESEARCH on the
  // badge while this exact site forced contract.state=ID_REQUIRED (and
  // therefore contract.price=null) one section over on the same card.
  //
  // decisionEngine.js is the sole authority WHENEVER it actually ran —
  // checked directly via out.decision?.action, not re-derived. The
  // narrow exception: `!out.decision` (computeDecision never ran at all —
  // a genuine early-exit/bypass path, not "ran and disagreed") still
  // falls back to the raw identityConfident flag as a defensive synthesis
  // net, exactly as before — this is a real, tested scenario (a response
  // assembled with no decision object whatsoever must still not silently
  // read as confident), distinct from the bug above where a decision DID
  // run and correctly said RESEARCH.
  if ((!out.decision && out.identityConfident === false) || out.decision?.action === 'ID_REQUIRED') {
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

  // GrailKey Directive Z — the market-standing / identity-standing
  // transaction-authority axes (GK-95/96 fix). Soft ('insufficiency'):
  // the existing Q41 acknowledge-override flow already handles this
  // class correctly (operator sets and verifies their own price, takes
  // responsibility) -- these are NOT integrity failures, they're evidence
  // gaps. `low-tier-thin-pool` above only fires when matchConfidence
  // itself reads LOW; this is the fix for the case Directive Y found --
  // a thin/stale/tier-4 book that scores MEDIUM confidence from the
  // start clears that check untouched. marketStanding is derived from
  // pricingSource alone (deriveMarketStanding, src/lib/actionAuthority.js)
  // -- matchConfidence itself is never read or mutated here.
  //
  // Both new checks below are gated on the count BEFORE either of them
  // ran (captured once, not re-read after each push) -- deliberately
  // independent of EACH OTHER so a book that's simultaneously
  // CONFLICTED and FALLBACK_ONLY surfaces BOTH reason codes, while
  // still deferring to any of the 9 ORIGINAL, more specific locks above
  // (a REFUSED/qualified-label/manual-review book already carries a
  // stronger integrity lock; stacking a generic reason on top would mix
  // insufficiency into an all-integrity lock set and change the Q41
  // UI's acknowledge-eligibility read, locks.every(l =>
  // l.class==='insufficiency'), without adding real information).
  const preStandingLockCount = locks.length;

  const marketStanding = deriveMarketStanding(out);
  if (preStandingLockCount === 0 && (marketStanding === 'FALLBACK_ONLY' || marketStanding === 'NONE')) {
    locks.push({
      code: marketStanding === 'NONE' ? 'market-standing-none' : 'market-standing-fallback-only',
      reason: marketStanding === 'NONE'
        ? 'No current market evidence available — cannot authorize listing'
        : 'Price is a PriceCharting estimate only — no current verified market comps',
      hard: false,
      class: 'insufficiency',
    });
  }

  // GrailKey Directive AB (GK-101) — evidence applicability custody.
  // deriveMarketStanding already floors EXACT_CURRENT to SIMILAR_ONLY when
  // out.variantApplicability === 'UNVERIFIED' (the actual gating power —
  // READY requires marketStanding === 'EXACT_CURRENT', so this alone
  // routes the book through deriveActionAuthority's existing REVIEW
  // fallthrough, no parallel denial path). This lock adds ONLY the
  // specific, explicable reason code (VARIANT_UNMATCHED_POOL) for that
  // demotion — same additive, independent-of-the-other-standing-locks
  // pattern as market-standing-fallback-only/none and
  // identity-standing-conflicted above (preStandingLockCount gate keeps a
  // stronger integrity lock from being diluted by a generic insufficiency
  // reason; independent of those two so a book that is BOTH e.g.
  // FALLBACK_ONLY and variant-unmatched surfaces both reason codes).
  if (preStandingLockCount === 0 && out.variantApplicability === 'UNVERIFIED') {
    // GrailKey Directive AH (GK-111) — two independent mechanisms can
    // produce variantApplicability==='UNVERIFIED' (api/comps.js Filter 1c
    // on the active pool, AB/GK-101; src/lib/soldVerification.js's variant
    // fallback on the sold pool, this dispatch) and they earn different,
    // more specific reason codes rather than being flattened to one
    // generic message — out.variantApplicabilitySoldFallback (own-property,
    // set unconditionally alongside variantApplicability) distinguishes
    // which one actually fired for THIS price. Mutually exclusive by
    // construction (only one branch below can push), same
    // preStandingLockCount gating as every other soft standing lock here.
    if (out.variantApplicabilitySoldFallback === true) {
      locks.push({
        code: 'market-standing-sold-variant-fallback',
        reason: 'The sold comps behind this price matched on grade only, not the confirmed variant/edition — the real sold price for this exact variant is unverified',
        hard: false,
        class: 'insufficiency',
      });
    } else {
      locks.push({
        code: 'market-standing-variant-unmatched',
        reason: 'No comps in the pricing pool matched the confirmed variant/edition — price reflects a broader pool that may be the wrong edition',
        hard: false,
        class: 'insufficiency',
      });
    }
  }

  // GrailKey Directive 2026-08-16-AP (GK-124) — cleared variant != base
  // edition. Same additive, independent-of-the-other-standing-locks
  // pattern as the UNVERIFIED branch above — this is the ONLY new reason
  // code, distinguished from market-standing-variant-unmatched (a variant
  // WAS confirmed, comps just didn't match it) because here no variant
  // was ever confirmed at all — Vision's own claim was cleared for lack
  // of corroboration, and that clearing itself is the evidence that this
  // is not a plain base edition.
  if (preStandingLockCount === 0 && out.variantApplicability === 'UNRESOLVED') {
    locks.push({
      code: 'market-standing-variant-unresolved',
      reason: 'A specific variant/edition was indicated by the scan but could not be confirmed — price reflects a broader pool that may be the wrong edition',
      hard: false,
      class: 'insufficiency',
    });
  }

  // GrailKey Directive AH (GK-111) — sufficiency, not applicability. A
  // marketStanding of EXACT_CURRENT says the pool IS current and (per the
  // lock above) confirmed applicable to this edition — it says nothing
  // about whether there is ENOUGH of it to authorize an unattended
  // transaction. deriveMarketStanding deliberately stays honest (a single
  // genuinely exact/current comp IS exact and current — demoting the
  // LABEL to make it lie would be worse than gating separately) — this
  // lock is the gate. Distinct from low-tier-thin-pool above: that one
  // requires matchConfidence.tier==='LOW' AND totalComps<3 (an
  // identity-confidence axis); a MEDIUM/HIGH-confidence book with a
  // single-comp EXACT_CURRENT pool clears low-tier-thin-pool untouched
  // (score=59/tier=LOW *did* happen to also be this dispatch's own
  // production case, at totalComps===3 exactly — one comp above that
  // lock's own <3 floor) and needs its own, tier-independent floor. N<2 is
  // the floor: a single comp is definitionally unable to establish a
  // market by itself; N=2 is the smallest population that can. Not
  // claimed to be more defensible than that — stated plainly, not dressed
  // up as a calibrated threshold.
  if (preStandingLockCount === 0 && marketStanding === 'EXACT_CURRENT') {
    const exactCurrentPoolSize = (out.soldComps?.length || 0) + (out.rawComps?.count || 0);
    if (exactCurrentPoolSize < 2) {
      locks.push({
        code: 'single-comp-pool',
        reason: `Only ${exactCurrentPoolSize} comp${exactCurrentPoolSize === 1 ? '' : 's'} back this "current market" price — too thin to authorize an automatic listing`,
        hard: false,
        class: 'insufficiency',
      });
    }
  }

  // identityStanding CONFLICTED (identityProvisional / identity-unresolved
  // as BARE fields) previously fed the client-side "Identity provisional"
  // badge but produced no lock at all unless out.listingHardLocked was
  // ALSO independently true -- contract.listable could be true while the
  // badge showed a caution.
  const identityStanding = deriveIdentityStanding(out);
  if (preStandingLockCount === 0 && identityStanding === 'CONFLICTED') {
    locks.push({
      code: 'identity-standing-conflicted',
      reason: 'Identity is provisional or the visual pool disagreed with Vision — verify before listing',
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
  // Q133 Slice 2 follow-up — see the matching comment in deriveLocks
  // above; same fix, same reasoning. decision.action is the sole
  // authority whenever a decision actually ran; `!out.decision` keeps the
  // pre-existing defensive fallback for the genuine no-decision-at-all case.
  if ((!out.decision && out.identityConfident === false) || out.decision?.action === 'ID_REQUIRED') {
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
 * Card-displayable fields with explicit provenance — Invariant I13
 * (Wave 1 Commit 2, Log-Card Fidelity). Each entry is
 * `{ value, source, logRef }`. `value: null` means "nothing to show" — the
 * card renders "—" or omits the chip, NEVER a fabricated number synthesized
 * from a different kind of data (the Harley Quinn #62 class: an active-ask
 * price rendered as "Last sold $4"). Whenever `value` is non-null, `source`
 * and `logRef` are REQUIRED — I13 in `validateContract` enforces this
 * mechanically for every entry present here.
 *
 * `logRef` names the actual bracketed console.log tag that emitted the
 * underlying data (e.g. `'sold-verify'` → `[sold-verify] kept N/M ...`),
 * greppable in Vercel logs — NOT a file:line, which drifts across edits.
 *
 * Scope (Wave 1): the two fields implicated in the Harley Quinn #62 bug
 * (`lastSold` fabricated from active-listing data) plus the verified-sold
 * count consumed by the card's "N of M sold verified" copy. Wave 2 extends
 * this to full rejected-comp preservation (currently `soldCompDiagnostics`
 * keeps only a 3-sample summary — out of scope here, not silently dropped).
 */
export function deriveFields(out) {
  const fields = {};

  // lastSold — verified sold data ONLY. Never falls back to active/asking
  // listings (out.comps.recentSales), which is a structurally different
  // kind of data (an ask, not a sale) and must never be relabeled as one.
  const sold0 = Array.isArray(out.soldComps) && out.soldComps.length > 0 ? out.soldComps[0] : null;
  fields.lastSold = {
    value: sold0 ? parsePriceNumber(sold0.price) : null,
    source: sold0 ? 'verified_sold' : null,
    logRef: sold0 ? 'sold-verify' : null,
  };

  // activeAsking — the active/ask-derived listing range. Rendered under its
  // own honest label ("Asking"), never blended into a sold-price claim.
  const activeAvg = parsePriceNumber(out.rawComps?.average ?? out.comps?.averageNum);
  const activeLow = parsePriceNumber(out.rawComps?.lowest ?? out.comps?.lowestNum);
  const activeHigh = parsePriceNumber(out.rawComps?.highest ?? out.comps?.highestNum);
  const hasActive = activeAvg != null || activeLow != null || activeHigh != null;
  fields.activeAsking = {
    value: hasActive ? { low: activeLow, high: activeHigh, avg: activeAvg } : null,
    source: hasActive ? 'active_listings' : null,
    logRef: hasActive ? 'comps' : null,
  };

  // verifiedSoldCount — soldCompDiagnostics is already the single source of
  // truth for this number (I6 enforces it for contract.verifiedCount); this
  // entry exists so the card's OWN "N of M sold verified" copy cites the
  // same provenance instead of re-deriving it from soldComps.length.
  const diag = out.soldCompDiagnostics;
  fields.verifiedSoldCount = diag
    ? { value: diag.verifiedCount ?? 0, source: 'sold-verify-diagnostics', logRef: 'sold-verify' }
    : { value: null, source: null, logRef: null };

  return fields;
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

  // GrailKey Directive Z — actionAuthority is the ONE transaction verdict;
  // listable is now a pure projection of it, not an independently
  // re-derived formula (C2: no parallel notion of "safe"). `decision`
  // here is the already-resolved snapshot above (handles the early-exit
  // synthesis case), passed through explicitly so deriveActionAuthority
  // never has to re-derive it from a possibly-absent out.decision.
  const actionAuthority = deriveActionAuthority(out, locks, decision);
  const listable = actionAuthority.state === 'READY';

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
    actionAuthority,
    locks,
    fields: deriveFields(out), // Wave 1 Commit 2 — per-field provenance (I13)
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

  // I13 (Wave 1 Commit 2, Log-Card Fidelity ruling) — every POPULATED
  // contract.fields entry must carry a non-null source AND logRef. This is
  // the mechanically-enforceable half of I13 (checkable from `out` alone).
  // The other half — every card-rendered value must have a matching
  // contract.fields entry, i.e. suppression/fabrication at render time is
  // also forbidden — cannot be verified here (the server never sees the
  // React tree); it is enforced at render time by the client-side
  // `assertContractField` dev-mode warning (App.jsx), which is a real but
  // necessarily partial check: it only covers render sites that have been
  // migrated to call it, not every pixel on the card. Documented, not
  // overclaimed.
  if (contract.fields && typeof contract.fields === 'object') {
    for (const [key, entry] of Object.entries(contract.fields)) {
      if (!entry) continue;
      if (entry.value != null && (entry.source == null || entry.logRef == null)) {
        fail('I13', `fields.${key} populated (value=${JSON.stringify(entry.value)}) with missing source/logRef`);
      }
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
 * Q145 dispatch (2026-07-22, Poison Ivy #31 collection-routing class) —
 * single, unconditional sync point for every contract-authoritative
 * decision field. Prior code had two independent PARTIAL sync blocks,
 * each keyed on a specific demotion flag: the sold-side-anchor block
 * synced BOTH out.decision.action and out.decision.bestChannel; the I9
 * contract-violation block (added later, Q109 dispatch Part 1) synced
 * ONLY .action, forgetting .bestChannel. That asymmetry is exactly what
 * let a stale out.decision.bestChannel ('cash_sale', frozen inside
 * computeDecision/computeBestChannel before I9 ever runs) reach the
 * collection screen (src/App.jsx's getChannelMetrics, the per-row pill —
 * both read item.decision.bestChannel directly) for an I9-violating
 * LIST_LOW book, while the detail card (which reads item.contract.*
 * directly, never item.decision) rendered correctly the whole time.
 *
 * Called ONCE, unconditionally, after BOTH assembleContract (handles
 * sold-side anchoring) and validateContract (handles I9 capping) have
 * had their chance to mutate `contract` — no per-demotion-flag branching
 * for the core fields, so a FUTURE contract-driven demotion mechanism
 * gets this sync for free and cannot reintroduce this exact bug shape by
 * forgetting one field. Demotion-specific warning strings still branch on
 * their own flag (different warning text for different causes), but the
 * action/bestChannel/price sync itself does not.
 *
 * Invariant this function guarantees for every finalized response:
 *   out.decision.action === contract.decision.action
 *   out.decision.bestChannel === (contract.bestChannel ?? contract.decision?.bestChannel)
 * Asserted directly in tests/q145-contract-decision-sync.test.js.
 */
function syncDecisionToContract(out, contract) {
  if (!out.decision || typeof out.decision !== 'object') return;
  out.decision.price = contract.price;
  out.decision.action = contract.decision.action;
  out.decision.bestChannel = contract.bestChannel ?? contract.decision?.bestChannel ?? null;

  if (contract.soldSideAnchored &&
      Array.isArray(out.decision.warnings) &&
      !out.decision.warnings.includes('sold-active-mismatch-extreme')) {
    out.decision.warnings.push('sold-active-mismatch-extreme');
  }
  if (contract.decisionCappedByViolation &&
      Array.isArray(out.decision.warnings) &&
      !out.decision.warnings.includes('contract-violation-decision-capped')) {
    out.decision.warnings.push('contract-violation-decision-capped');
  }
}

/**
 * Assemble → validate → sync → attach. Call this immediately before
 * res.json() on every substantive response exit. Mutates and returns `out`.
 *
 * I7 single-number guarantee: out.decision.price is OVERWRITTEN to the
 * contract price BEFORE validateContract runs (I7 itself checks
 * out.decision.price against contract.price — it must already reflect
 * assembleContract's own price mutations, e.g. the sold-side anchor,
 * or I7 would misfire comparing a pre-anchor price against the anchored
 * one). This also fixes the pre-existing NaN class: computeDecision does
 * arithmetic on fmtUsd strings — "$4.82" * 0.8 → NaN → serialized null.
 *
 * Every OTHER decision field (action, bestChannel, and price again for a
 * single source of truth) syncs exactly once via syncDecisionToContract,
 * AFTER validateContract, so it reflects every mutation from both
 * assembleContract and validateContract — see that function's docstring.
 */
export function finalizeResponse(out) {
  const contract = assembleContract(out);
  if (out.decision && typeof out.decision === 'object') {
    out.decision.price = contract.price;
  }
  validateContract(contract, out);
  syncDecisionToContract(out, contract);
  out.contract = contract;
  return out;
}
