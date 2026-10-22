import { getDisplayPrice } from './displayAuthority.js';

/**
 * collectionMetrics.js
 *
 * GrailKey Commit C (2026-08-02, collection-header defect) — extracted
 * for testability (App.jsx contains JSX and cannot be imported by this
 * repo's plain-Node test runner; matches the established pattern of
 * pulling pure, non-UI logic into src/lib/*.js — issueAuthority.js,
 * dataQualityGuard.js, etc.).
 *
 * One shared aggregate-status derivation, computed ONLY from
 * getCollectionMetrics' own output (App.jsx, unchanged) — never
 * independently re-derived from raw catalogue state — so a header
 * rendering this value and a bucket grid rendering the same metrics
 * object can never disagree with each other.
 */

/**
 * @param {{
 *   totalComics: number,
 *   blocked: {count: number},
 *   needsReview: {count: number},
 *   photosNeeded: {count: number},
 *   ready: {count: number},
 * }} metrics - output of App.jsx's getCollectionMetrics(catalogue)
 * @returns {'BLOCKED'|'REVIEW'|'PHOTOS'|'READY'|'EMPTY'}
 */
export const getAggregateCollectionStatus = (metrics) => {
  if (!metrics || metrics.totalComics === 0) return 'EMPTY';
  if (metrics.blocked.count > 0) return 'BLOCKED';
  if (metrics.needsReview.count > 0) return 'REVIEW';
  if (metrics.photosNeeded.count > 0) return 'PHOTOS';
  if (metrics.ready.count > 0 && metrics.ready.count === metrics.totalComics) return 'READY';
  // Defensive: unreachable given getCollectionMetrics' own four-bucket
  // partition (every item falls into exactly one of blocked/needsReview/
  // photosNeeded/ready), but never silently mislabel an uncovered shape
  // as READY.
  return 'EMPTY';
};

/**
 * Inclusion rules / definitions carried WITH the numbers so a tile can never claim more than it measures.
 * All figures are estimates from the pricing contract; none is realized or net sale proceeds.
 */
export const COLLECTION_VALUE_DEFINITIONS = Object.freeze({
  totalValue: 'Sum of the estimated price of every record, including photo-pending, review, blocked and non-listable records. An estimate, not sale proceeds.',
  listableValue: 'Estimated price of records whose decision authority is READY and whose photo checklist is incomplete or complete, excluding any record the contract marks listable:false. Not a sale or liquidation figure; listing still requires a linked physical asset, operator authorization and server-side authority.',
  nonListable: 'Photo-pending or ready records the contract marks listable:false. Excluded from listable value; their status is unchanged.',
  routing: 'Channel routing is a recommendation. It is not photo readiness and not publishing authority. Records with no channel are counted as unrouted.'
});

/**
 * Listing-readiness, collection-metrics and channel-routing helpers, moved VERBATIM from src/App.jsx
 * (src/App.jsx@6bc07c5 lines 416-794) except where changed for R1/R2/R5/R6 of
 * docs/COLLECTION-INTEGRITY-AUDIT-2026-10-22.md. The only injected dependency is getComicPhotos, which is
 * session-bound (signed protected-image links) and therefore stays in App.jsx.
 */
export const createCollectionMetrics = ({ getComicPhotos }) => {
// Listing Readiness helpers
const getPhotoChecklist = (item) => {
  if (!item) {
    return { front: false, back: false, spine: false, pages: false, count: 0 };
  }
  const photos = getComicPhotos(item);
  return {
    front: photos.length > 0,
    back: photos.length > 1,
    spine: photos.length > 2,
    pages: photos.length > 3,
    count: photos.length
  };
};

const getListingReadiness = (item) => {
  if (!item) {
    return {
      frontPhoto: { status: 'fail', label: 'Front photo', required: true },
      backPhoto: { status: 'caution', label: 'Back photo', required: false },
      spinePhoto: { status: 'caution', label: 'Spine photo', required: false },
      pagesPhoto: { status: 'caution', label: 'Pages photo', required: false },
      identityConfirmed: { status: 'fail', label: 'Identity unresolved', state: 'UNRESOLVED', required: true },
      priceReady: { status: 'fail', label: 'Price ready', required: true },
      decisionSafe: { status: 'fail', label: 'Decision safe', required: true },
      marketEvidence: { status: 'fail', label: 'Market evidence', required: false }
    };
  }

  const photos = getPhotoChecklist(item);
  const decision = item.decision || {};
  const displayPrice = getDisplayPrice(item);
  const listPrice = parseFloat(item.listPrice || 0);
  const price = Math.max(displayPrice, listPrice);
  const soldComps = Array.isArray(item.soldComps) ? item.soldComps : [];
  const activeCount = item.rawComps?.count || 0;
  const blockers = Array.isArray(decision.blockers) ? decision.blockers : [];
  const hasBlockers = blockers.length > 0;

  return {
    frontPhoto: {
      status: photos.front ? 'pass' : 'fail',
      label: 'Front photo',
      required: true
    },
    backPhoto: {
      status: photos.back ? 'pass' : 'caution',
      label: 'Back photo',
      required: false
    },
    spinePhoto: {
      status: photos.spine ? 'pass' : 'caution',
      label: 'Spine photo',
      required: false
    },
    pagesPhoto: {
      status: photos.pages ? 'pass' : 'caution',
      label: 'Pages photo',
      required: false
    },
    identityConfirmed: (() => {
      // Q145 dispatch (2026-07-22) — tri-state: CONFIRMED / PROVISIONAL /
      // UNRESOLVED, replacing the binary blocked/confirmed collapse that
      // let a promoted provisional identity (Q133 Slice 2 — Vision
      // disagreed, the pool corroborated, decision.action never became
      // ID_REQUIRED by design) render as an unqualified "✓ Identity
      // confirmed."
      //
      // Discovered while implementing this fix, not assumed: out.
      // identityProvisional and out.listingHardLockReason (the two signals
      // this fix was specified to use) are NOT present on the client's
      // catalogue item at all — grepped every merge site in this file,
      // zero hits for either field name. Using them directly here would
      // have been a silent no-op, the exact class of bug this whole
      // session has been auditing. The reliable, already-merged proxy is
      // item.contract.locks (deriveLocks, responseContract.js, pushes
      // {code: out.listingHardLockReason || 'listing-hard-locked', ...}
      // whenever out.listingHardLocked is true) — contract itself IS
      // merged on every path (see the `contract:` field in each catalogue
      // merge object). Falls back to the raw fields for a legacy/no-
      // contract item in case a future merge-path fix adds them.
      // GrailKey Directive Z — item.contract.actionAuthority.identityStanding
      // (responseContract.js) is computed server-side on `out`, BEFORE the
      // client-merge boundary this comment's own investigation found strips
      // item.identityProvisional/listingHardLockReason entirely — it does
      // not have the gap the fallback below works around, so it's preferred
      // whenever present. Falls back to the pre-Z local re-derivation only
      // for legacy items scanned before actionAuthority existed.
      const authority = item.contract?.actionAuthority;
      const isUnresolved = authority
        ? authority.identityStanding === 'UNRESOLVED'
        : decision.action === 'ID_REQUIRED' || (hasBlockers && blockers.includes('identity-not-confident'));
      const isProvisional = !isUnresolved && (
        authority
          ? authority.identityStanding === 'CONFLICTED'
          : (
            item.identityProvisional === true ||
            item.listingHardLockReason === 'identity-unresolved' ||
            (item.contract?.locks || []).some((l) => l.code === 'identity-unresolved')
          )
      );
      return {
        status: isUnresolved ? 'fail' : isProvisional ? 'caution' : 'pass',
        label: isUnresolved ? 'Identity unresolved' : isProvisional ? 'Identity provisional — verify before listing' : 'Identity confirmed',
        state: isUnresolved ? 'UNRESOLVED' : isProvisional ? 'PROVISIONAL' : 'CONFIRMED',
        required: true
      };
    })(),
    priceReady: {
      status: price > 0 ? 'pass' : 'fail',
      label: 'Price ready',
      required: true
    },
    decisionSafe: (() => {
      // GrailKey Directive Z (GK-96) — a field labeled "safe" whose
      // negative branch was unreachable for every LIST_LOW is fabricated
      // assurance, not cosmetic wording (a GK-39-class defect, third
      // instance). Reads item.contract.actionAuthority.state (the one
      // transaction verdict every listability consumer now derives
      // from, responseContract.js) rather than decision.action directly
      // -- decision.action alone can no longer render "safe": a
      // thin/stale/tier-4 (pc_estimate) book with decision.action=
      // LIST_LOW now correctly reads REVIEW/LOCKED here, not 'pass'.
      // Falls back to the pre-Z action-only heuristic ONLY for legacy
      // catalogue entries scanned before this field existed
      // (actionAuthority === undefined, not any other falsy value).
      const authority = item.contract?.actionAuthority;
      if (authority) {
        return {
          status: authority.state === 'READY' ? 'pass' :
                  authority.state === 'REVIEW' ? 'caution' :
                  'fail',
          label: 'Decision safe',
          required: true
        };
      }
      return {
        status: decision.action === 'LIST_NOW' || decision.action === 'LIST_LOW' ? 'pass' :
                decision.action === 'RESEARCH' || decision.action === 'GRADE_CANDIDATE' ? 'caution' :
                'fail',
        label: 'Decision safe',
        required: true
      };
    })(),
    marketEvidence: {
      // Commit B.2 (Strange Tales dispatch) — must reflect ZERO exact
      // evidence, not just raw comp-pool population. A pool population
      // from an unrelated/misidentified search (e.g. a null-confirmedIssue
      // scan whose active pool matched on title alone) used to still show
      // "pass" here — the checkmark could stay satisfied even when the
      // underlying identity was genuinely unresolved. item.marketEvidenceReady
      // (out.marketEvidenceReady, api/enrich.js) is the authoritative
      // field, already zeroed whenever confirmedIssue is null (Commit A.2
      // forces rawPricingPool=[] for every row in that case, which is
      // exactly what marketEvidenceReady counts). Falls back to the prior
      // raw-population check only for items scanned before this field
      // existed (item.marketEvidenceReady === undefined, not false) —
      // backward compatibility for already-cached catalogue entries, not a
      // loophole for new scans.
      status: item.marketEvidenceReady === false ? 'fail' :
              item.marketEvidenceReady === true ? 'pass' :
              soldComps.length > 0 || activeCount > 0 ? 'pass' :
              item.pricingSource === 'pricecharting' ? 'caution' :
              'fail',
      label: 'Market evidence',
      required: false
    }
  };
};

const getReadinessStatus = (item) => {
  if (!item) {
    return {
      badge: 'BLOCKED',
      color: '#e05656',
      icon: '🚫',
      bg: 'rgba(239,68,68,0.1)',
      border: 'rgba(239,68,68,0.3)'
    };
  }

  const checklist = getListingReadiness(item);
  const decision = item.decision || {};
  const blockers = Array.isArray(decision.blockers) ? decision.blockers : [];
  const hasBlockers = blockers.length > 0;

  // BLOCKED: DO_NOT_LIST, ID_REQUIRED, or blockers present
  if (decision.action === 'DO_NOT_LIST' || decision.action === 'ID_REQUIRED' || hasBlockers) {
    return {
      badge: 'BLOCKED',
      color: '#e05656',
      icon: '🚫',
      bg: 'rgba(239,68,68,0.1)',
      border: 'rgba(239,68,68,0.3)'
    };
  }

  // PHOTOS NEEDED: missing front photo or decision safe but missing photos
  if (checklist.frontPhoto.status !== 'pass' ||
      (checklist.decisionSafe.status === 'pass' && checklist.frontPhoto.status === 'pass' &&
       (checklist.backPhoto.status !== 'pass' || checklist.spinePhoto.status !== 'pass' || checklist.pagesPhoto.status !== 'pass'))) {
    return {
      badge: 'PHOTOS NEEDED',
      color: '#fbbf24',
      icon: '📷',
      bg: 'rgba(251,191,36,0.1)',
      border: 'rgba(251,191,36,0.3)'
    };
  }

  // READY: required items pass, decision LIST_NOW or LIST_LOW
  if (checklist.frontPhoto.status === 'pass' &&
      checklist.identityConfirmed.status === 'pass' &&
      checklist.priceReady.status === 'pass' &&
      checklist.decisionSafe.status === 'pass' &&
      !hasBlockers) {
    return {
      badge: 'READY',
      color: '#22c55e',
      icon: '✓',
      bg: 'rgba(34,197,94,0.1)',
      border: 'rgba(34,197,94,0.3)'
    };
  }

  // NEEDS REVIEW: everything else (RESEARCH, caution states, etc.)
  return {
    badge: 'NEEDS REVIEW',
    color: '#fbbf24',
    icon: '⚠️',
    bg: 'rgba(251,191,36,0.1)',
    border: 'rgba(251,191,36,0.3)'
  };
};

// ─── Collection accounting (A8 invariants) ───
// Every record lands in EXACTLY ONE status bucket (ready / photosNeeded / needsReview / blocked, or
// `unclassified` if classification itself threw) and EXACTLY ONE routing bucket (a channel, or `unrouted`
// when the item has neither contract.bestChannel nor decision.bestChannel). Nothing is skipped silently:
// a non-finite price is counted at $0 rather than dropping the record from both views.
// The value of a record is ONE definition for both views: Math.max(getDisplayPrice(item), listPrice).
const itemValue = (item) => {
  const v = Math.max(getDisplayPrice(item), parseFloat(item.listPrice || 0));
  return Number.isFinite(v) ? v : 0;
};

// Collection-level metrics helper
const getCollectionMetrics = (catalogue) => {
  const metrics = {
    totalComics: Array.isArray(catalogue) ? catalogue.length : 0,
    // Sum of the display price of EVERY record (ready, photo-pending, review, blocked, non-listable): an estimate, never proceeds.
    totalValue: 0,
    ready: { count: 0, value: 0 },
    photosNeeded: { count: 0, value: 0 },
    needsReview: { count: 0, value: 0 },
    blocked: { count: 0, value: 0 },
    unclassified: { count: 0, value: 0 },
    // Ready + photo-pending records whose contract does NOT say listable:false. An estimate for items that are
    // decision-safe but not necessarily photo-complete. Not a liquidation figure: no fees, shipping, or sell-through.
    listableValue: 0,
    // Photo-pending / ready records the contract marks listable:false. Reported separately and EXCLUDED from
    // listableValue; their status bucket is unchanged (no item moves between statuses).
    nonListable: { count: 0, value: 0 },
    definitions: COLLECTION_VALUE_DEFINITIONS
  };
  if (!Array.isArray(catalogue)) return metrics;

  for (const item of catalogue) {
    if (!item) { metrics.unclassified.count++; continue; }

    const price = itemValue(item);
    metrics.totalValue += price;

    try {
      const readiness = getReadinessStatus(item);

      if (readiness.badge === 'READY' || readiness.badge === 'PHOTOS NEEDED') {
        const bucket = readiness.badge === 'READY' ? metrics.ready : metrics.photosNeeded;
        bucket.count++;
        bucket.value += price;
        if (item.contract?.listable === false) {
          metrics.nonListable.count++;
          metrics.nonListable.value += price;
        } else {
          metrics.listableValue += price;
        }
      } else if (readiness.badge === 'NEEDS REVIEW') {
        metrics.needsReview.count++;
        metrics.needsReview.value += price;
      } else if (readiness.badge === 'BLOCKED') {
        metrics.blocked.count++;
        metrics.blocked.value += price;
      } else {
        metrics.unclassified.count++;
        metrics.unclassified.value += price;
      }
    } catch (err) {
      console.warn('[getCollectionMetrics] unclassified malformed item:', err.message);
      metrics.unclassified.count++;
      metrics.unclassified.value += price;
    }
  }

  return metrics;
};

// Q145 dispatch (2026-07-22, Poison Ivy #31 collection-routing class) —
// single shared channel resolver. Prefers item.contract?.bestChannel
// (server-synced post any I9/sold-side-anchor demotion, since Q145's
// server-side fix — src/lib/responseContract.js's syncDecisionToContract)
// over the legacy item.decision?.bestChannel copy, which a stale
// catalogue entry (scanned before this fix shipped, never re-enriched)
// could still carry out of sync with its own stored contract.
//
// Defense-in-depth, explicitly secondary to the server-side fix — not
// equally load-bearing. Also refuses to trust contract.bestChannel
// blindly: a contract that's LOCKED, REFUSED, ID_REQUIRED, or simply not
// listable is force-routed to research/blocked regardless of whatever
// bestChannel value it carries, so a future contract-assembly bug in
// THAT field specifically still can't misroute a book to Sell/Bundle/
// Trade/Grade.
const getAuthoritativeChannel = (item) => {
  if (!item) return null;
  const contract = item.contract;
  const legacy = item.decision?.bestChannel || null;
  if (!contract) return legacy;

  if (contract.state === 'ID_REQUIRED') return 'blocked';
  if (contract.state === 'REFUSED' || contract.state === 'LOCKED' || contract.listable === false) {
    return 'research';
  }
  return contract.bestChannel || legacy || null;
};

// Session 2A: Channel routing metrics
const getChannelMetrics = (catalogue) => {
  const metrics = {
    cash_sale: { count: 0, value: 0 },
    bundle: { count: 0, value: 0 },
    grade: { count: 0, value: 0 },
    barter: { count: 0, value: 0 },
    research: { count: 0, value: 0 },
    blocked: { count: 0, value: 0 },
    // No contract.bestChannel and no decision.bestChannel (e.g. an un-enriched partial). Counted, never dropped.
    unrouted: { count: 0, value: 0 }
  };
  if (!Array.isArray(catalogue)) return metrics;

  for (const item of catalogue) {
    if (!item) { metrics.unrouted.count++; continue; }
    let bucket = 'unrouted';
    let value = 0;
    try {
      const channel = getAuthoritativeChannel(item);
      bucket = channel && Object.prototype.hasOwnProperty.call(metrics, channel) ? channel : 'unrouted';
      value = itemValue(item);
    } catch (err) {
      console.warn('[getChannelMetrics] unrouted malformed item:', err.message);
    }

    metrics[bucket].count++;
    metrics[bucket].value += value;
  }

  return metrics;
};

// Reconciliation of the two views over the SAME catalogue. `balanced` is the A8 invariant:
// status count = routing count = total, and status value = routing value = total value.
const reconcileCollectionMetrics = (catalogue) => {
  const s = getCollectionMetrics(catalogue);
  const c = getChannelMetrics(catalogue);
  const statusBuckets = [s.ready, s.photosNeeded, s.needsReview, s.blocked, s.unclassified];
  const statusCount = statusBuckets.reduce((a, b) => a + b.count, 0);
  const statusValue = statusBuckets.reduce((a, b) => a + b.value, 0);
  const routingCount = Object.values(c).reduce((a, b) => a + b.count, 0);
  const routingValue = Object.values(c).reduce((a, b) => a + b.value, 0);
  const total = s.totalComics;
  const cents = (n) => Math.round(n * 100);
  return {
    total, statusCount, routingCount, statusValue, routingValue, totalValue: s.totalValue,
    balanced: statusCount === total && routingCount === total &&
      cents(statusValue) === cents(s.totalValue) && cents(routingValue) === cents(s.totalValue)
  };
};

return { getPhotoChecklist, getListingReadiness, getReadinessStatus, getCollectionMetrics, getAuthoritativeChannel, getChannelMetrics, reconcileCollectionMetrics };
};
