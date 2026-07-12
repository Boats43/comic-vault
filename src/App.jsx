import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllComics,
  putComic,
  deleteComic,
  migrateFromLocalStorage,
  putSnapshot,
  getAllSnapshots,
  getAnalysis,
  putAnalysis,
} from "./db.js";
import { computeListPriceWarning } from "./lib/listPriceWarning.js";
import { runAutoFix } from "./lib/autoFix.js";
import { generatePacket } from "./lib/marketplacePackets.js";
import { chooseBetterPrice, chooseBetterGrade } from "./lib/dataQualityGuard.js";
import { shouldSkipIdRequiredEnrich } from "./lib/identityGate.js";

// A3 ACCESS GATE: Client-side key helper
// ACCESS GATE — T1 invite key management (A3 + LAUNCH BLOCKER FIX)
const getVaultHeaders = () => {
  const key = localStorage.getItem('vault_key');
  return key ? { 'x-vault-key': key } : {};
};

const clearVaultKey = () => {
  localStorage.removeItem('vault_key');
};

// STRUCTURAL FIX: Normalize all items before render to prevent "cannot read property of undefined" crashes
// Legacy books scanned before Fix 2/3 lack decision/claudeCheck/priceBands objects.
// This function GUARANTEES all expected parent objects AND nested arrays exist so optional
// chaining becomes backup defense, not primary. Applied at EVERY entry point to component state.
function normalizeItem(item) {
  if (!item) return item;
  return {
    ...item,
    decision: item.decision || {},
    claudeCheck: item.claudeCheck || {},
    priceBands: item.priceBands || {},
    demandSignals: item.demandSignals || {},
    comicVine: item.comicVine || {},
    goCollect: item.goCollect || {},
    convergence: item.convergence ? {
      axes: {},
      ...item.convergence,
    } : null,
    // CRITICAL: Provide nested array defaults to prevent .recentSales.map() crashes
    comps: item.comps ? {
      recentSales: [],
      ...item.comps,
    } : { recentSales: [] },
    rawComps: item.rawComps ? {
      recentSales: [],
      prices: [],
      ...item.rawComps,
    } : { recentSales: [], prices: [] },
    soldComps: Array.isArray(item.soldComps) ? item.soldComps : [],
    pop: item.pop || {},
  };
}

const LOADING_STEPS = [
  "Reading cover...",
  "Identifying issue...",
  "Checking grade...",
  "Pricing...",
];

const parsePrice = (p) => {
  if (p == null) return null;
  const m = String(p).replace(/,/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

const fmt = (n) =>
  n == null || isNaN(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// Format a price dropping trailing .00 so "$22.00" becomes "$22".
const fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded)
    ? `$${rounded.toLocaleString("en-US")}`
    : `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Format a sale timestamp as "X hours ago" same-day, "yesterday", "N days
// ago", or a calendar date for older items. Browse API (active listings)
// has no end date yet, so those rows show "Active".
const fmtSaleWhen = (iso, daysAgo) => {
  if (!iso && daysAgo == null) return "Active";
  if (iso) {
    const then = new Date(iso).getTime();
    if (!isNaN(then)) {
      const diffMs = Date.now() - then;
      if (diffMs < 86400000 && diffMs >= 0) {
        const hours = Math.max(1, Math.round(diffMs / 3600000));
        return `${hours} hour${hours === 1 ? "" : "s"} ago`;
      }
    }
  }
  if (daysAgo === 1) return "yesterday";
  if (daysAgo != null) return `${daysAgo} days ago`;
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
    }
  }
  return "—";
};

// Mirror of api/pricecharting-pop.js POP_GRADE_INDEX. Hardcoded
// client-side so the histogram can label its 14 bars without
// shipping the array on every enrich response. Verified from PC's
// render_pop_chart() in /js/market_ab.js (April 2026).
const POP_GRADE_INDEX = [
  1, 2, 3, 4, 5, 6, 7, 8, 9.0, 9.2, 9.4, 9.6, 9.8, 10,
];

const getDisplayPrice = (item) => {
  if (!item) return 0;

  // Ship #24a-3 — single writer. When the canonical contract block exists,
  // it IS the price: header, stats bar, Recommended row, and List button all
  // resolve here. Legacy chain below survives ONLY for pre-Ship-24 catalogue
  // entries that have no contract yet (auto-refresh back-fills them).
  // Q41 manual override still wins — the user's number outranks the engine's.
  if (item.contract && !item.priceOverridden) {
    return item.contract.price ?? 0;
  }

  // Ship #20a.6.4 — refuse-to-price gate. When identity is uncertain,
  // suppress both Vision's stored price AND the cached comps fallback.
  // The displayed value is the listing-decision number; gated books
  // must not produce one. Default-true on missing field protects
  // existing catalog entries (no field → not gated).
  if (item.identityConfident === false) return 0;

  // Q41: When priceOverridden flag is set, use item.price (manual edit).
  // Otherwise prefer priceBands.market (market-band price from decision engine).
  if (item.priceOverridden) {
    const p = parseFloat(String(item.price || "0").replace(/[$,]/g, ""));
    return p > 0 ? p : 0;
  }

  // Prefer priceBands.market (decision engine's market recommendation)
  if (item.priceBands?.market) {
    const marketPrice = parseFloat(String(item.priceBands.market).replace(/[$,]/g, ""));
    if (marketPrice > 0) return marketPrice;
  }

  // Fallback to item.price (legacy books without priceBands)
  const p = parseFloat(String(item.price || "0").replace(/[$,]/g, ""));
  if (p > 0) return p;

  // Final fallback: comps average + 15%
  if (item.comps?.averageNum)
    return Math.round(item.comps.averageNum * 1.15);
  return 0;
};

// Fix A — Phase 1: Format currency to exactly 2 decimal places.
// Prevents float artifacts like $13.796000000000001 from rendering.
const formatCurrency = (value) => {
  if (value == null || value === '') return '$0.00';
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,]/g, ''));
  if (isNaN(num)) return '$0.00';
  return `$${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

// P0-D: Format timestamp as "X ago" for price recency display
const formatTimeAgo = (timestamp) => {
  if (!timestamp) return null;
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return 'just now';
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) {
    const mins = Math.floor(diffMs / 60000);
    return `${mins} min${mins === 1 ? '' : 's'} ago`;
  }
  if (diffMs < 86400000) {
    const hours = Math.floor(diffMs / 3600000);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diffMs / 86400000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  return 'over a year ago';
};

// Decision-first UI helpers (Ship SPEED-2a+1)
const getActionColor = (decision) => {
  if (!decision?.action) return { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', text: '#6366f1' };

  const action = decision.action;
  const confidence = decision.confidence;

  // GREEN: LIST_NOW with high or medium confidence
  if (action === 'LIST_NOW' && (confidence === 'high' || confidence === 'medium')) {
    return { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#22c55e' };
  }

  // YELLOW: LIST_LOW, RESEARCH, GRADE_CANDIDATE, BUNDLE
  if (action === 'LIST_LOW' || action === 'RESEARCH' || action === 'GRADE_CANDIDATE' || action === 'BUNDLE') {
    return { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', text: '#fbbf24' };
  }

  // RED: DO_NOT_LIST, ID_REQUIRED
  if (action === 'DO_NOT_LIST' || action === 'ID_REQUIRED') {
    return { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', text: '#e05656' };
  }

  // Default: blue
  return { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', text: '#6366f1' };
};

const getMarketSignal = (item) => {
  if (!item) return { badge: 'UNKNOWN', color: '#888', icon: '❓' };

  const soldComps = Array.isArray(item.soldComps) ? item.soldComps : [];
  const activeCount = item.rawComps?.count || 0;
  const soldCount = soldComps.length;

  // Find most recent sold comp
  let mostRecentDays = null;
  if (soldComps.length > 0) {
    mostRecentDays = Math.min(...soldComps.map(s => s?.daysAgo || 999));
  }

  // HOT: recent sold recency <= 30 days AND soldCount >= 3 AND activeCount <= 5
  if (mostRecentDays != null && mostRecentDays <= 30 && soldCount >= 3 && activeCount <= 5) {
    return { badge: 'HOT', color: '#22c55e', icon: '🔥' };
  }

  // NORMAL: recency <= 90 days OR soldCount >= 1 OR activeCount >= 2
  if ((mostRecentDays != null && mostRecentDays <= 90) || soldCount >= 1 || activeCount >= 2) {
    return { badge: 'NORMAL', color: '#60a5fa', icon: '📊' };
  }

  // COLD: recency > 90 days OR (soldCount === 0 and activeCount <= 1)
  if ((mostRecentDays != null && mostRecentDays > 90) || (soldCount === 0 && activeCount <= 1)) {
    return { badge: 'COLD', color: '#888', icon: '❄️' };
  }

  // UNKNOWN: insufficient data
  return { badge: 'UNKNOWN', color: '#888', icon: '❓' };
};

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
      identityConfirmed: { status: 'fail', label: 'Identity confirmed', required: true },
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
    identityConfirmed: {
      status: decision.action === 'ID_REQUIRED' || (hasBlockers && blockers.includes('identity-not-confident')) ? 'fail' : 'pass',
      label: 'Identity confirmed',
      required: true
    },
    priceReady: {
      status: price > 0 ? 'pass' : 'fail',
      label: 'Price ready',
      required: true
    },
    decisionSafe: {
      status: decision.action === 'LIST_NOW' || decision.action === 'LIST_LOW' ? 'pass' :
              decision.action === 'RESEARCH' || decision.action === 'GRADE_CANDIDATE' ? 'caution' :
              'fail',
      label: 'Decision safe',
      required: true
    },
    marketEvidence: {
      status: soldComps.length > 0 || activeCount > 0 ? 'pass' :
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

// Collection-level metrics helper
const getCollectionMetrics = (catalogue) => {
  if (!catalogue || !Array.isArray(catalogue) || catalogue.length === 0) {
    return {
      totalComics: 0,
      totalValue: 0,
      ready: { count: 0, value: 0 },
      photosNeeded: { count: 0, value: 0 },
      needsReview: { count: 0, value: 0 },
      blocked: { count: 0, value: 0 },
      liquidValue: 0
    };
  }

  const metrics = {
    totalComics: catalogue.length,
    totalValue: 0,
    ready: { count: 0, value: 0 },
    photosNeeded: { count: 0, value: 0 },
    needsReview: { count: 0, value: 0 },
    blocked: { count: 0, value: 0 },
    liquidValue: 0
  };

  for (const item of catalogue) {
    if (!item) continue;

    try {
      const displayPrice = getDisplayPrice(item);
      const listPrice = parseFloat(item.listPrice || 0);
      const price = Math.max(displayPrice, listPrice);

      if (isNaN(price) || !isFinite(price)) continue;

      metrics.totalValue += price;

      const readiness = getReadinessStatus(item);

      if (readiness.badge === 'READY') {
        metrics.ready.count++;
        metrics.ready.value += price;
        metrics.liquidValue += price;
      } else if (readiness.badge === 'PHOTOS NEEDED') {
        metrics.photosNeeded.count++;
        metrics.photosNeeded.value += price;
        metrics.liquidValue += price; // PHOTOS_NEEDED items are listable/liquid
      } else if (readiness.badge === 'NEEDS REVIEW') {
        metrics.needsReview.count++;
        metrics.needsReview.value += price;
      } else if (readiness.badge === 'BLOCKED') {
        metrics.blocked.count++;
        metrics.blocked.value += price;
      }
    } catch (err) {
      console.warn('[getCollectionMetrics] skipping malformed item:', err.message);
      continue;
    }
  }

  return metrics;
};

// Session 2A: Channel routing metrics
const getChannelMetrics = (catalogue) => {
  if (!catalogue || !Array.isArray(catalogue) || catalogue.length === 0) {
    return {
      cash_sale: { count: 0, value: 0 },
      bundle: { count: 0, value: 0 },
      grade: { count: 0, value: 0 },
      barter: { count: 0, value: 0 },
      research: { count: 0, value: 0 },
      blocked: { count: 0, value: 0 }
    };
  }

  const metrics = {
    cash_sale: { count: 0, value: 0 },
    bundle: { count: 0, value: 0 },
    grade: { count: 0, value: 0 },
    barter: { count: 0, value: 0 },
    research: { count: 0, value: 0 },
    blocked: { count: 0, value: 0 }
  };

  for (const item of catalogue) {
    if (!item || !item.decision?.bestChannel) continue;

    try {
      const displayPrice = getDisplayPrice(item);
      const listPrice = parseFloat(item.listPrice || 0);
      const price = Math.max(displayPrice, listPrice);

      if (isNaN(price) || !isFinite(price)) continue;

      const channel = item.decision.bestChannel;
      if (metrics[channel]) {
        metrics[channel].count++;
        // Only add to value if item has a valid price (not null/undefined)
        if (price > 0 && item.price != null) {
          metrics[channel].value += price;
        }
      }
    } catch (err) {
      console.warn('[getChannelMetrics] skipping malformed item:', err.message);
      continue;
    }
  }

  return metrics;
};

// v0-E: Decision Engine price authority helper
// Returns the authoritative price for listPrice initialization.
// Precedence: blocked → 0, decision.price when decision permits listing → system price fallback
// Fix v0-H: When floor enforcement creates extreme mismatch with recommended price,
// use the recommended price (from verified sold comps) instead of floor.
const getAuthorityPrice = (item) => {
  if (!item) return 0;

  // Ship #24a-3 (Amendment A): the contract is the single price authority —
  // listPrice and the List button read the same number as every other
  // surface. The v0-H soldAvg override is DELETED as a writer; sold/active
  // arbitration now happens server-side inside contract assembly.
  if (item.contract) {
    return item.contract.price ?? 0;
  }

  // Legacy chain — pre-Ship-24 catalogue entries only (no contract yet).

  // Q68-C: Refuse-state coherence - return 0 for refused identity
  if (item.identityConfident === false) return 0;

  // Blocked decisions: use system price (may be 0)
  const isBlocked =
    item.decision?.action === 'DO_NOT_LIST' ||
    item.decision?.action === 'ID_REQUIRED' ||
    (item.decision?.blockers?.length || 0) > 0;

  if (isBlocked) {
    return getDisplayPrice(item);
  }

  // Non-blocked decisions with decision.price: use it
  // Includes LIST_NOW, LIST_LOW, RESEARCH, GRADE_CANDIDATE
  if (item.decision?.price != null && item.decision.price > 0) {
    return item.decision.price;
  }

  // Fallback to system price
  return getDisplayPrice(item);
};

// Ship #24 Amendment C — client-side drift alarm (dev mode only).
// Every rendered price surface must show contract.price; a divergence here
// means a surface bypassed the contract. Warn, never block.
const CONTRACT_DEV_MODE =
  typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
const assertContractPrice = (item, surface, rendered) => {
  if (!CONTRACT_DEV_MODE || !item?.contract || item.priceOverridden) return rendered;
  const cp = item.contract.price ?? 0;
  const rv =
    typeof rendered === 'number'
      ? rendered
      : parseFloat(String(rendered ?? '0').replace(/[$,]/g, '')) || 0;
  if (Math.abs(rv - cp) > 0.011) {
    console.warn(
      `[contract-drift] ${surface}: rendered ${rv} != contract.price ${cp} (state=${item.contract.state})`
    );
  }
  return rendered;
};

const marketValueOf = (r) => {
  if (!r) return null;
  const v = getDisplayPrice(r);
  return v || null;
};

// Ship #20a.6.1 — human-readable label for sold-comp rejection reasons.
// Reasons in soldVerification.js:
//   titleMismatch, issueMismatch, annualMismatch, printingMismatch,
//   variantMismatch, slabMismatch, signed, lot, gradeMismatch, stale, outlier
// Sample reasons may carry a qualifier (e.g. "lot:half-issue", "outlier×3");
// the base key before ':' or '×' drives the lookup.
const SOLD_REASON_LABELS = {
  titleMismatch: "title didn't match",
  issueMismatch: "issue # didn't match",
  annualMismatch: "annual/special format mismatch",
  printingMismatch: "wrong print (1st vs reprint)",
  variantMismatch: "variant mismatch",
  slabMismatch: "slab vs raw mismatch",
  signed: "signed/SS variant",
  lot: "lot/multi-issue",
  gradeMismatch: "wrong grade tier",
  stale: "stale (>540 days)",
  outlier: "outlier price",
};
const humanizeSoldReason = (reason) => {
  if (!reason) return "rejected";
  const base = String(reason).split(/[:×]/)[0];
  return SOLD_REASON_LABELS[base] || base;
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// Downscale an image data URL to a JPEG thumbnail for localStorage storage.
// Keeps cover thumbs ~20-50KB each so the catalogue doesn't blow the 5MB quota.
const makeThumbnail = (dataUrl, maxDim = 1000, quality = 0.85) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

// Return an array of photo data URLs for a comic, supporting both the
// legacy single `image` field and the new `images` array. Used by
// CollectionList, CollectionDetail, and the list-to-eBay flow so either
// storage shape works.
const getComicPhotos = (comic) => {
  if (!comic) return [];
  if (Array.isArray(comic.images) && comic.images.length > 0) {
    return comic.images.filter(Boolean);
  }
  if (comic.image) return [comic.image];
  return [];
};

// ─── Ship #26 — NO-DEAD-END CARDS (display-only, no pricing math) ───
// Every card must offer: market reference points (when the engine
// refused/flagged), an exit-strategy row, and a next-action line.

// Block 1 — Market references on REFUSED / ID_REQUIRED / RESEARCH cards.
// Reference points only, never a recommendation — the data already rides
// the response (comps, soldComps, PC anchors).
const MarketReferences = ({ item }) => {
  const state = item.contract?.state;
  const action = item.contract?.decision?.action || item.decision?.action;
  const show = state === 'REFUSED' || state === 'ID_REQUIRED' || action === 'RESEARCH';
  if (!show) return null;

  const rows = [];
  const comps = item.comps || {};
  const compCount = comps.count || 0;
  if (compCount > 0 && (comps.lowestNum != null || comps.highestNum != null)) {
    rows.push(
      `Active asks ${formatCurrency(comps.lowestNum)}–${formatCurrency(comps.highestNum)} · ` +
      `${compCount} listing${compCount === 1 ? '' : 's'} (live)`
    );
  }
  const solds = Array.isArray(item.soldComps)
    ? item.soldComps.filter((s) => s && s.price != null)
    : [];
  if (solds.length > 0) {
    const avg = item.soldCompsAvg != null
      ? item.soldCompsAvg
      : solds.reduce((a, s) => a + (parseFloat(String(s.price).replace(/[$,]/g, '')) || 0), 0) / solds.length;
    const ages = solds.map((s) => s.daysAgo).filter((d) => d != null);
    const freshest = ages.length ? Math.min(...ages) : null;
    rows.push(
      `Sold avg ${formatCurrency(avg)} · ${solds.length} sale${solds.length === 1 ? '' : 's'}` +
      (freshest != null ? ` · freshest ${freshest}d ago` : ' · age unknown')
    );
  }
  const pcAnchor = item.isGraded
    ? (item.pcGradedPrice ?? item.pcLoosePrice)
    : (item.pcLoosePrice ?? item.pcGradedPrice);
  if (pcAnchor != null && parseFloat(pcAnchor) > 0) {
    rows.push(`PriceCharting anchor ${formatCurrency(pcAnchor)} (${item.isGraded ? 'graded' : 'raw'})`);
  }

  return (
    <div style={{
      padding: '10px 12px', marginBottom: 10,
      background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.3)',
      borderRadius: 6, fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: 4 }}>📊 Market references</div>
      {rows.length > 0 ? (
        rows.map((r, i) => (
          <div key={i} style={{ color: '#cbd5e1', lineHeight: 1.7 }}>{r}</div>
        ))
      ) : (
        <div style={{ color: '#888' }}>No reference data yet — search the live market below.</div>
      )}
      <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>
        Reference points only — not a verified price.
      </div>
    </div>
  );
};

// Block 2 — Exit strategy row: the 5 KeyRoute paths as chips, recommended
// one highlighted from bestChannel; Sell/Bundle greyed under integrity locks.
const EXIT_PATHS = [
  { key: 'cash_sale', icon: '💵', label: 'Sell' },
  { key: 'bundle', icon: '📦', label: 'Bundle' },
  { key: 'grade', icon: '🏆', label: 'Grade' },
  { key: 'barter', icon: '🔄', label: 'Trade' },
  { key: 'research', icon: '🔍', label: 'Research' },
];
const ExitStrategyRow = ({ item }) => {
  const best = item.contract?.bestChannel || item.decision?.bestChannel || null;
  const locks = item.contract?.locks || [];
  const integrityLocks = locks.filter((l) => l.class === 'integrity');
  const lockReason = integrityLocks[0]?.reason || '';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>Exit strategy</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {EXIT_PATHS.map((p) => {
          const isBest = best === p.key;
          const greyed = integrityLocks.length > 0 && (p.key === 'cash_sale' || p.key === 'bundle');
          return (
            <span
              key={p.key}
              title={greyed ? lockReason : ''}
              style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11,
                border: isBest ? '1px solid #d4af37' : '1px solid rgba(255,255,255,0.15)',
                background: isBest ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.05)',
                color: greyed ? '#555' : isBest ? '#fde68a' : '#aaa',
                textDecoration: greyed ? 'line-through' : 'none',
                fontWeight: isBest ? 700 : 400,
              }}
            >
              {p.icon} {p.label}{isBest ? ' ★' : ''}
            </span>
          );
        })}
      </div>
      {integrityLocks.length > 0 && (
        <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>
          Sell/Bundle locked: {lockReason}
        </div>
      )}
    </div>
  );
};

// Block 3 — Next action line: state-machine driven, one line, always
// present, maps 1:1 to contract.state.
const computeNextAction = (item) => {
  const c = item.contract;
  if (!c) return { icon: '🔄', text: 'Refresh market data to build evidence' };
  const locks = c.locks || [];
  const allInsufficiency = locks.length > 0 && locks.every((l) => l.class === 'insufficiency');
  const action = c.decision?.action || item.decision?.action;
  const price = getDisplayPrice(item);

  if (c.state === 'ID_REQUIRED') {
    return { icon: '🔍', text: 'Retake the photo or edit title / issue / year fields' };
  }
  if (c.state === 'REFUSED') {
    return allInsufficiency
      ? { icon: '✍️', text: 'Set your price + Acknowledge to list' }
      : { icon: '🔒', text: locks[0]?.reason || 'Listing locked — see banner above' };
  }
  if (c.state === 'LOCKED') {
    return { icon: '🔒', text: locks[0]?.reason || 'Listing locked — review required' };
  }
  if (action === 'RESEARCH' || !c.listable) {
    return price > 0
      ? { icon: '🔍', text: `Acknowledge to list at ${formatCurrency(price)} — or search the live market for new solds` }
      : { icon: '🔍', text: 'Search the live market for new solds' };
  }
  const readiness = getReadinessStatus(item);
  if (readiness.badge === 'PHOTOS NEEDED') {
    const missing = Math.max(1, 4 - (getComicPhotos(item)?.length || 0));
    return { icon: '📷', text: `Add ${missing} photo${missing === 1 ? '' : 's'} to finish the listing packet` };
  }
  return price > 0
    ? { icon: '📋', text: `Ready — list at ${formatCurrency(price)}` }
    : { icon: '🔄', text: 'Refresh market data for a price' };
};
const NextActionLine = ({ item }) => {
  const na = computeNextAction(item);
  return (
    <div style={{
      padding: '8px 12px', marginBottom: 12,
      background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.3)',
      borderRadius: 6, fontSize: 12, color: '#fde68a', fontWeight: 600,
    }}>
      {na.icon} Next: {na.text}
    </div>
  );
};

// Keyword set used to flag condition-concern sentences in Claude's reason
// field. Deliberately loose — matches "wear", "creases", "tanning", etc.
const CONDITION_KEYWORDS =
  /\b(wear|stress|crease|fold|tear|soil|tann|scratch|blunt|dent|missing|soiling|handling|edge|corner)/i;

// Split Claude's reason into sentences and classify each as a concern
// (condition issue ⚠️) or positive (✅) bullet for the condition report.
const parseConditionReport = (reason) => {
  if (!reason) return [];
  return String(reason)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({ text, concern: CONDITION_KEYWORDS.test(text) }));
};

// Normalize Claude's confidence field for display. Claude returns
// "High" / "Medium" / "85" / "85%" / "High (90%)" inconsistently.
const formatConfidence = (c) => {
  if (!c) return "low";
  const s = String(c).toLowerCase().trim();
  if (s === "high" || s === "excellent") return "high";
  if (s === "medium" || s === "mid" || s === "moderate") return "medium";
  const num = parseFloat(s);
  if (!isNaN(num)) {
    const n = num > 10 ? num / 100 : num > 1 ? num / 10 : num;
    if (n >= 0.8) return "high";
    if (n >= 0.6) return "medium";
    return "low";
  }
  return "low";
};

const showKeyIssue = (k) => {
  if (!k) return false;
  const s = k.toLowerCase().trim();
  if (["no", "n/a", "none", "false", "not a key",
    "non-key", "non key", "not key"]
    .some((x) => s.includes(x))) return false;
  return ["1st", "first", "origin", "death",
    "intro", "appearance", "cameo", "key",
    "classic", "vs ", "battle", "debut",
    "kirby", "ditko", "first issue", "last issue",
    "final issue", "historic", "landmark", "#1"]
    .some((x) => s.includes(x));
};

// Ship #26 v0-D.1 — Reprint key-label safety helper
// When reprint/polybag detected, prepend "Reprint of" to key issue label.
// Prevents misleading users that a modern reprint is an original first appearance.
const displayKeyIssue = (item) => {
  if (!showKeyIssue(item.keyIssue)) return null;

  const isReprint = item.editionWarning?.detected === true || item.polybagDetected === true;

  if (isReprint) {
    const key = item.keyIssue;
    // Avoid double-prefix if already starts with "Reprint of"
    if (key.toLowerCase().startsWith('reprint of')) {
      return key;
    }
    return `Reprint of ${key}`;
  }

  return item.keyIssue;
};

function ScanZone({ onFile, inputRef, compact, label }) {
  const cameraRef = useRef(null);

  return (
    <div
      className={`upload-zone${compact ? " compact" : ""}`}
      onClick={() => cameraRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && cameraRef.current?.click()}
    >
      <div className="upload-emoji">📷</div>
      <div className="upload-text">{label}</div>
      <input
        ref={(el) => { cameraRef.current = el; if (inputRef) inputRef.current = el; }}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        hidden
      />
    </div>
  );
}

// Isolated barcode scanner component - completely separate from Vision camera
function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const [hint, setHint] = useState('Point camera at barcode');

  useEffect(() => {
    let mounted = true;

    const startScanning = async () => {
      try {
        // Dynamic import ZXing
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (!mounted) return;

        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;

        // Get video stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        });

        if (!mounted || !videoRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});

        // Start barcode detection
        codeReader.decodeFromVideoDevice(null, videoRef.current, (result) => {
          if (!mounted) return;
          if (result) {
            const barcode = result.getText();
            console.log('[barcode] detected:', barcode);

            // Validate UPC-A (12 digits) or EAN-13 (13 digits)
            if (/^\d{12,13}$/.test(barcode)) {
              console.log('[barcode] valid UPC, closing scanner');
              onDetected(barcode);
            }
          }
        });
      } catch (err) {
        console.error('[barcode] error:', err);
        setHint('Camera access denied or unavailable');
      }
    };

    startScanning();

    // Cleanup on unmount
    return () => {
      mounted = false;

      if (codeReaderRef.current) {
        try {
          codeReaderRef.current.reset();
        } catch (err) {
          console.warn('[barcode] reset error:', err);
        }
        codeReaderRef.current = null;
      }

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject;
        stream.getTracks().forEach(track => {
          track.stop();
          console.log('[barcode] stopped track:', track.kind);
        });
        videoRef.current.srcObject = null;
      }
    };
  }, [onDetected]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: '#000',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        color: '#d4af37',
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 16,
        textAlign: 'center',
      }}>
        {hint}
      </div>
      <div style={{
        width: '90%',
        maxWidth: 500,
        aspectRatio: '4/3',
        position: 'relative',
        border: '2px dashed rgba(212,175,55,0.6)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <video
          ref={videoRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>
      <button
        onClick={onCancel}
        style={{
          marginTop: 20,
          padding: '12px 24px',
          background: 'transparent',
          color: '#d4af37',
          border: '2px solid rgba(212,175,55,0.5)',
          borderRadius: 10,
          fontSize: 16,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function ResultCard({ result, enriching }) {
  // Ship #20a.6.1 — collapsible drawer for soldCompDiagnostics rejected
  // samples. Toggled by clicking the V/R chip. Per-card state — different
  // cards stay independently expanded.
  const [soldDrawerOpen, setSoldDrawerOpen] = useState(false);

  const comps = result.comps;
  const hasComps =
    (comps &&
     Array.isArray(comps.recentSales) &&
     comps.recentSales.length > 0) ||
    (Array.isArray(result.soldComps) && result.soldComps.length > 0);
  const displayPrice = getDisplayPrice(result);
  // Ship #24a-3 — contract items render contract.price ONLY. The legacy
  // `result.price` string fallback is dead for them: a REFUSED card must
  // show "—", never a stale writer's price (ruling 3).
  const recommendedLabel = result.contract
    ? (result.contract.price != null
        ? formatCurrency(assertContractPrice(result, 'ResultCard.header', result.contract.price))
        : "—")
    : (displayPrice > 0 ? formatCurrency(displayPrice) : result.price || "—");
  // Contract banner: REFUSED / LOCKED / INCOMPLETE render locks[0].reason
  // verbatim (Amendment B — wires XMEN1 contamination copy onto the card).
  const contractBanner =
    result.contract &&
    ['REFUSED', 'LOCKED', 'INCOMPLETE'].includes(result.contract.state)
      ? {
          state: result.contract.state,
          reason:
            result.contract.locks?.[0]?.reason ||
            'Listing locked — review before listing',
        }
      : null;
  // Ship #20a.6.4 — refuse-to-price state. When server returns
  // identityConfident:false, the price area is replaced with a red
  // "Identification Required" panel. Only the title (when it itself
  // is non-uncertainty) and the cover image are still shown so the
  // user can see what they captured.
  const identityGated = result.identityConfident === false;
  // Numeric-issue check: when identity is gated, suppress the "#N"
  // suffix unless issue is purely numeric (uncertainty strings like
  // "Cannot determine from visible cover" must not render).
  const issueRendersAsNumber =
    result.issue != null && /^\d+(\.\d+)?$/.test(String(result.issue).trim());
  const showIssueSuffix =
    issueRendersAsNumber &&
    !result.title?.includes(`#${result.issue}`);

  return (
    <div className="result-card">
      {result.image && (
        <img
          src={result.image}
          alt=""
          loading="lazy"
          className="result-image"
          style={{
            width: "100%",
            maxHeight: 360,
            objectFit: "contain",
            borderRadius: 8,
            marginBottom: 12,
          }}
        />
      )}
      <div className="title">{result.title}{showIssueSuffix ? ` #${result.issue}` : ''}</div>
      <div className="muted small">
        {result.publisher}
        {result.publisher && result.year && /^\d{4}$/.test(String(result.year).trim()) ? " · " : ""}
        {/^\d{4}$/.test(String(result.year || "").trim()) ? result.year : ""}
      </div>
      {!result.image && (
        <div className="muted small" style={{ fontStyle: "italic" }}>
          No cover photo — rescan for image
        </div>
      )}
      {result.isGraded === true && result.numericGrade != null
        ? <div className="grade-badge cgc">CGC {result.numericGrade}</div>
        : result.grade
          ? <div className="grade-badge raw">{result.grade}</div>
          : null}
      {(() => {
        const keyText = displayKeyIssue(result);
        return keyText ? <div className="key-box">⭐ {keyText}</div> : null;
      })()}
      {result.variant && (
        <div style={{ color: "#FFD700", fontSize: 13, marginTop: 4, fontWeight: "bold" }}>
          ⚡ {result.variant}
        </div>
      )}
      {result.restoration && (
        <div style={{ background: "#ff000022", border: "1px solid #ff4444", borderRadius: 6, padding: "8px 12px", marginTop: 8, color: "#ff6666" }}>
          ⚠️ RESTORED: {result.restoration}
        </div>
      )}
      {identityGated && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            border: "1px solid rgba(239,68,68,0.6)",
            borderRadius: 8,
            background: "rgba(239,68,68,0.10)",
            color: "#fca5a5",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 15 }}>
            🔍 Identification Required
          </div>
          <div className="small" style={{ marginBottom: 8, color: "#fecaca" }}>
            {(() => {
              const isLikelyNonComic =
                result.identityMissingFields?.includes('issue') &&
                result.title &&
                /\b(book|novel|paperback|hardcover|toy|figure|statue|bust|print|poster|art|sketch|original|painting|lithograph|magazine|guide|handbook|encyclopedia)\b/i.test(result.title);

              if (isLikelyNonComic) {
                return "📚 Book/Object detected — comic pricing disabled. Scan ISBN/barcode or archive this item.";
              }
              return "Cannot price safely — verified title, issue, year, and publisher all required.";
            })()}
          </div>
          {!(/\b(book|novel|paperback|hardcover|toy|figure|statue|bust|print|poster|art|sketch|original|painting|lithograph|magazine|guide|handbook|encyclopedia)\b/i.test(result.title || '') && result.identityMissingFields?.includes('issue')) && Array.isArray(result.identityMissingFields) && result.identityMissingFields.length > 0 && (
            <div className="small" style={{ marginBottom: 8 }}>
              <span style={{ opacity: 0.7 }}>Missing: </span>
              <span style={{ fontWeight: 600 }}>
                {result.identityMissingFields.join(", ")}
              </span>
            </div>
          )}
          {Array.isArray(result.identityReasons) && result.identityReasons.length > 0 && (
            <ul style={{ margin: "6px 0 8px 0", paddingLeft: 18, fontSize: 12, color: "#fecaca" }}>
              {result.identityReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <div className="small" style={{ opacity: 0.85 }}>
            Capture the indicia (inside front cover) or back cover to surface issue # and year, then re-scan.
          </div>
        </div>
      )}

      {!identityGated && contractBanner && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            border: contractBanner.state === 'REFUSED'
              ? "1px solid rgba(239,68,68,0.5)"
              : "1px solid rgba(245,158,11,0.5)",
            background: contractBanner.state === 'REFUSED'
              ? "rgba(239,68,68,0.08)"
              : "rgba(245,158,11,0.08)",
            color: contractBanner.state === 'REFUSED' ? "#ef4444" : "#f59e0b",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {contractBanner.state === 'REFUSED' ? '⛔ CANNOT PRICE' : '🔒 LISTING LOCKED'}
          <div style={{ fontWeight: 400, marginTop: 4, opacity: 0.9 }}>
            {contractBanner.reason}
          </div>
        </div>
      )}

      {!identityGated && recommendedLabel && (
        <>
          <div className="muted small" style={{ marginTop: 12 }}>
            Recommended list price
          </div>
          <div className="price">{recommendedLabel}</div>
          {result.priceNote && (
            <div style={{ color: "#aaa", fontSize: 12 }}>
              {result.priceNote}
            </div>
          )}
          {hasComps && (
            <div className="muted small">
              {comps.source === "browse_api"
                ? `Based on ${comps.count ?? 0} active eBay listing${comps.count === 1 ? "" : "s"}`
                : `Based on ${comps.count ?? 0} eBay sale${comps.count === 1 ? "" : "s"} in last 30 days`}
            </div>
          )}
          {result.priceNote && /defect adj/i.test(result.priceNote) && (
            <div style={{ color: "#f59e0b", fontSize: 12, marginTop: 4 }}>
              Adjusted for cover defects
            </div>
          )}
        </>
      )}

      {!identityGated && !hasComps && enriching && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 8,
            background: "rgba(212,175,55,0.05)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              border: "2px solid rgba(212,175,55,0.3)",
              borderTopColor: "#d4af37",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span className="muted small">Loading market data…</span>
        </div>
      )}

      {!identityGated && !hasComps && !enriching && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(245,158,11,0.5)",
            borderRadius: 8,
            background: "rgba(245,158,11,0.1)",
            color: "#f59e0b",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠ No recent eBay sales found for this book
          </div>
          <div className="small" style={{ marginBottom: 4 }}>
            Price estimated from AI market knowledge
          </div>
          <div className="small" style={{ marginBottom: 8 }}>
            Verify on eBay before listing
          </div>
          {(result.priceLow || result.priceHigh) && (
            <div style={{ fontWeight: 600 }}>
              AI range: {result.priceLow}
              {result.priceLow && result.priceHigh ? " – " : ""}
              {result.priceHigh}
            </div>
          )}
        </div>
      )}

      {hasComps && (
        <div
          className="comps-breakdown"
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 8,
            background: "rgba(212,175,55,0.05)",
          }}
        >
          {/* LAST SOLD section */}
          {Array.isArray(result.soldComps) && result.soldComps.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                className="muted small"
                style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
              >
                Last Sold
                {(() => {
                  const newest = result.soldComps[0]?.daysAgo;
                  const recencyStr = newest == null ? null : newest === 0 ? "today" : newest === 1 ? "1d ago" : `${newest}d ago`;
                  // Ship #20a.6 — when raw count > verified, show "V of R verified".
                  // Ship #20a.6.1 — chip is clickable; expands rejected-samples drawer.
                  const diag = result.soldCompDiagnostics;
                  const hasRejected = diag && Array.isArray(diag.rejectedSamples) && diag.rejectedSamples.length > 0;
                  // Ship #24a-3 — THE verifiedCount is contract.verifiedCount
                  // (I6 pins it to soldCompDiagnostics; legacy read only for
                  // pre-contract entries).
                  const vCount = result.contract?.verifiedCount ?? diag?.verifiedCount ?? 0;
                  const showVerifiedRatio = diag && diag.rawCount > vCount && vCount > 0;
                  const verifiedStr = showVerifiedRatio
                    ? `${vCount} of ${diag.rawCount} sold verified`
                    : `${result.soldComps.length} sold`;
                  const onClick = hasRejected
                    ? (e) => { e.preventDefault(); e.stopPropagation(); setSoldDrawerOpen((v) => !v); }
                    : undefined;
                  return (
                    <span
                      onClick={onClick}
                      style={{
                        marginLeft: 6,
                        opacity: 0.7,
                        textTransform: "none",
                        letterSpacing: 0,
                        cursor: hasRejected ? "pointer" : "default",
                        userSelect: "none",
                      }}
                      title={hasRejected ? (soldDrawerOpen ? "Hide rejected" : "Show rejected") : undefined}
                    >
                      📊 {verifiedStr}{recencyStr ? ` · ${recencyStr}` : ""}{hasRejected ? (soldDrawerOpen ? " ▾" : " ▸") : ""}
                    </span>
                  );
                })()}
              </div>
              {result.soldComps.slice(0, 3).map((s, i) => {
                const mpStyle = (mp) => ({
                  marginLeft: 6, padding: "1px 5px", fontSize: 10, borderRadius: 3,
                  background: mp === "heritage" ? "rgba(212,175,55,0.15)" : "rgba(22,163,106,0.15)",
                  color: mp === "heritage" ? "#d4af37" : "#16a34a",
                  textTransform: "uppercase", letterSpacing: 0.5,
                });
                const rowStyle = { padding: "6px 0", fontSize: 14 };
                const inner = (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="muted small">
                        {s.daysAgo != null ? (s.daysAgo === 0 ? "today" : s.daysAgo === 1 ? "yesterday" : `${s.daysAgo} days ago`) : s.date || "—"}
                        {s.marketplace && (
                          <span style={mpStyle(s.marketplace)}>
                            {s.marketplace === "heritage" ? "HRT" : "eBay"}
                          </span>
                        )}
                      </span>
                      <span style={{ fontWeight: 600, color: "#16a34a" }}>
                        {s.priceFormatted || fmtPrice(s.price)} <span style={{ fontSize: 11, opacity: 0.8 }}>SOLD</span>
                        {s.url && <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>}
                      </span>
                    </div>
                    {s.title && (
                      <div style={{ fontSize: 13, color: "#999", marginTop: 2, lineHeight: 1.3, wordBreak: "break-word" }}>
                        {s.title}
                      </div>
                    )}
                  </div>
                );
                return s.url ? (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>
                    {inner}
                  </a>
                ) : (
                  <div key={i} style={rowStyle}>{inner}</div>
                );
              })}
              {soldDrawerOpen && Array.isArray(result.soldCompDiagnostics?.rejectedSamples) && result.soldCompDiagnostics.rejectedSamples.length > 0 && (
                <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(224,86,86,0.06)", border: "1px solid rgba(224,86,86,0.2)" }}>
                  <div className="muted small" style={{ marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#e05656" }}>
                    Rejected ({result.soldCompDiagnostics.rejectedCount} total — top {result.soldCompDiagnostics.rejectedSamples.length})
                  </div>
                  {result.soldCompDiagnostics.rejectedSamples.map((rej, i) => (
                    <div key={i} style={{ padding: "4px 0", fontSize: 12, borderTop: i > 0 ? "1px solid rgba(224,86,86,0.15)" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <span style={{
                          fontSize: 10, padding: "1px 6px", borderRadius: 3,
                          background: "rgba(224,86,86,0.15)", color: "#e05656",
                          whiteSpace: "nowrap", letterSpacing: 0.3,
                        }}>
                          {humanizeSoldReason(rej.reason)}
                        </span>
                        {rej.price != null && (
                          <span style={{ color: "#888", fontSize: 11 }}>
                            {fmtPrice(rej.price)}
                          </span>
                        )}
                      </div>
                      {rej.title && (
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2, lineHeight: 1.3, wordBreak: "break-word" }}>
                          {rej.title}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {result.soldComps.length >= 2 && (() => {
                const avg = result.soldComps.reduce((s, c) => s + (c.price || 0), 0) / result.soldComps.length;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14, borderTop: "1px solid rgba(22,163,106,0.2)", marginTop: 4 }}>
                    <span className="muted small">Avg sold</span>
                    <span style={{ fontWeight: 600, color: "#16a34a" }}>{fmtPrice(avg)}</span>
                  </div>
                );
              })()}
              <div style={{ borderTop: "1px solid rgba(212,175,55,0.25)", margin: "8px 0" }} />
            </div>
          )}

          {/* ACTIVE LISTINGS section */}
          {Array.isArray(comps.recentSales) && comps.recentSales.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                className="muted small"
                style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
              >
                Active Listings
              </div>
              {comps.recentSales.slice(0, 3).map((s, i) => {
                const row = (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="muted small">
                        {fmtSaleWhen(s.date, s.daysAgo)}
                      </span>
                      <span style={{ fontWeight: 600, color: "#d4af37" }}>
                        {fmtPrice(s.price)}
                        {s.itemWebUrl ? (
                          <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>
                        ) : null}
                      </span>
                    </div>
                    {s.title && (
                      <div style={{ fontSize: 13, color: "#999", marginTop: 2, lineHeight: 1.3, wordBreak: "break-word" }}>
                        {s.title}
                      </div>
                    )}
                  </div>
                );
                const rowStyle = {
                  padding: "6px 0",
                  fontSize: 14,
                };
                return s.itemWebUrl ? (
                  <a
                    key={i}
                    href={s.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}
                  >
                    {row}
                  </a>
                ) : (
                  <div key={i} style={rowStyle}>
                    {row}
                  </div>
                );
              })}
            </div>
          )}

          <div
            style={{
              borderTop: "1px solid rgba(212,175,55,0.25)",
              margin: "8px 0",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            {/* FIX 2: Display sold avg separately from active listings */}
            <span className="muted small">
              {result.soldCompsAvg != null && result.soldCompsAvg > 0 ? 'Sold avg (30d)' : 'Active listing avg'}
            </span>
            <span style={{ fontWeight: 600 }}>
              {fmtPrice(result.soldCompsAvg != null && result.soldCompsAvg > 0 ? result.soldCompsAvg : comps.averageNum)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            <span className="muted small">Recommended</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, color: "#d4af37" }}>
                {recommendedLabel}
              </span>
              {(() => {
                // Ship #24a-3 (Amendment A): inline chip recomputation
                // DELETED — the chip renders contract fields only. Legacy
                // count-based heuristic survives solely for pre-contract
                // catalogue entries.
                let level, label;
                if (result.contract) {
                  const st = result.contract.state;
                  if (st === 'ESTIMATED') { level = 'LOW'; label = 'ESTIMATE'; }
                  else if (st === 'PRICED') {
                    level = result.contract.decision?.confidence === 'HIGH' ? 'HIGH'
                      : result.contract.decision?.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW';
                    label = level === 'HIGH' ? 'HIGH ✓' : level === 'MEDIUM' ? 'MED ~' : 'LOW';
                  }
                  else { level = 'LOW'; label = st; }
                } else {
                  const cc = comps?.count || 0;
                  const sc = Array.isArray(result.soldComps) ? result.soldComps.length : 0;
                  const hasPriceData = result?.pricingSource === "pricecharting";
                  level = sc >= 2 ? "HIGH" : cc >= 2 ? "MEDIUM" : hasPriceData ? "MEDIUM" : "LOW";
                  label = level === "HIGH" ? "HIGH ✓" : level === "MEDIUM" ? "MED ~" : "AI EST";
                }
                const bg = level === "HIGH" ? "rgba(22,163,106,0.2)" : level === "MEDIUM" ? "rgba(212,175,55,0.2)" : "rgba(245,158,11,0.2)";
                const fg = level === "HIGH" ? "#16a34a" : level === "MEDIUM" ? "#d4af37" : "#f59e0b";
                return (
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, fontWeight: 700, background: bg, color: fg }}>
                    {label}
                  </span>
                );
              })()}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            <span className="muted small">Floor</span>
            <span style={{ fontWeight: 600, color: "#e05656" }}>
              {fmtPrice(comps.lowestNum)}
            </span>
          </div>
          {comps.fellBack && (
            <div className="muted small" style={{ marginTop: 6 }}>
              (raw copy comps)
            </div>
          )}
          <div
            className="muted small"
            style={{ marginTop: 8, fontStyle: "italic" }}
          >
            {result.pricingSource === "pricecharting"
              ? "Source: PriceCharting market data"
              : "Source: Browse API — active listings"}
            {Array.isArray(result.soldComps) && result.soldComps.length > 0 && " + eBay sold"}
          </div>
        </div>
      )}

      {result.cgcVerified === true && (
        <div style={{ background: "#00aa4422", border: "1px solid #00aa44", borderRadius: 6, padding: "6px 12px", marginTop: 8, color: "#00cc55", fontSize: 13 }}>
          ✓ CGC Verified · {result.certNumber} · {result.cgcLabel}
        </div>
      )}

      {result.reason && <div className="reason muted small">{result.reason}</div>}
    </div>
  );
}

// Session logger — ephemeral buyer history in localStorage
const SESSIONS_KEY = "cv_buyer_sessions";
const getSessions = () => { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]"); } catch { return []; } };
const saveSession = (entry) => {
  const sessions = getSessions();
  sessions.push({ ...entry, ts: Date.now() });
  if (sessions.length > 100) sessions.splice(0, sessions.length - 100);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
};
const getSessionSummary = () => {
  const sessions = getSessions().slice(-20);
  if (sessions.length === 0) return null;
  const buys = sessions.filter((s) => s.decision === "BUY");
  const totalSpent = buys.reduce((s, b) => s + (b.bidPrice || 0), 0);
  const discounts = buys.filter((b) => b.marketValue > 0).map((b) => (b.marketValue - b.bidPrice) / b.marketValue);
  const avgDiscount = discounts.length > 0 ? discounts.reduce((s, d) => s + d, 0) / discounts.length : 0;
  const bestDeal = buys.reduce((best, b) => {
    const disc = b.marketValue > 0 ? (b.marketValue - b.bidPrice) / b.marketValue : 0;
    return disc > (best?.discount || 0) ? { title: b.title, discount: disc, bidPrice: b.bidPrice, marketValue: b.marketValue } : best;
  }, null);
  return { recentSessions: sessions, buyRate: buys.length / sessions.length, avgDiscount, totalSpent, bestDeal };
};

const DEFAULT_BUYER_SETTINGS = { whatnotFee: 10, supplies: 0.75, labor: 2.0, minProfit: 5.0 };

// Trade Pile persistence
const TRADE_PILES_KEY = "cv_trade_piles";
const getTradePiles = () => {
  try {
    return JSON.parse(localStorage.getItem(TRADE_PILES_KEY) || "[]");
  } catch {
    return [];
  }
};
const saveTradePiles = (piles) => {
  localStorage.setItem(TRADE_PILES_KEY, JSON.stringify(piles));
};

// Listing Packets persistence (24h TTL)
const LISTING_PACKETS_KEY = "cv_listing_packets";
const getListingPackets = () => {
  try {
    return JSON.parse(localStorage.getItem(LISTING_PACKETS_KEY) || "{}");
  } catch {
    return {};
  }
};
const saveListingPacket = (itemId, channel, packet) => {
  const packets = getListingPackets();
  if (!packets[itemId]) packets[itemId] = {};
  packets[itemId][channel] = { packet, createdAt: Date.now() };
  localStorage.setItem(LISTING_PACKETS_KEY, JSON.stringify(packets));
};
const getStoredPacket = (itemId, channel) => {
  const packets = getListingPackets();
  const stored = packets[itemId]?.[channel];
  if (!stored) return null;
  const age = Date.now() - stored.createdAt;
  if (age > 86400000) return null; // 24h TTL
  return stored.packet;
};

const loadBuyerSettings = () => {
  try {
    const raw = localStorage.getItem("cv_buyer_settings");
    if (!raw) return { ...DEFAULT_BUYER_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BUYER_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BUYER_SETTINGS };
  }
};

function BidCalculator({ marketValue, detectedPrice, resultTitle, resultGrade, onLogSession }) {
  const [bid, setBid] = useState("");
  const [budget, setBudget] = useState(() => localStorage.getItem("cv_buyer_budget") || "");
  const [seeded, setSeeded] = useState(false);
  const [logged, setLogged] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(loadBuyerSettings);

  useEffect(() => {
    if (detectedPrice && !seeded) {
      const cleaned = String(detectedPrice).replace(/[^0-9.]/g, "");
      if (cleaned && parseFloat(cleaned) > 0) {
        setBid(cleaned);
        setSeeded(true);
      }
    }
  }, [detectedPrice, seeded]);

  useEffect(() => {
    if (budget) localStorage.setItem("cv_buyer_budget", budget);
  }, [budget]);

  useEffect(() => {
    localStorage.setItem("cv_buyer_settings", JSON.stringify(settings));
  }, [settings]);

  const bidNum = parseFloat(bid);
  const budgetNum = parseFloat(budget);
  const hasBid = !isNaN(bidNum) && bidNum > 0;
  const hasBudget = !isNaN(budgetNum) && budgetNum > 0;
  const hasMV = marketValue != null && marketValue > 0;

  const feePct = parseFloat(settings.whatnotFee) || 0;
  const supplies = parseFloat(settings.supplies) || 0;
  const labor = parseFloat(settings.labor) || 0;
  const minProfit = parseFloat(settings.minProfit) || 0;

  const whatnotFeeAmt = hasMV ? marketValue * (feePct / 100) : 0;
  const netProfit = hasMV && hasBid
    ? marketValue - whatnotFeeAmt - supplies - labor - bidNum
    : null;

  const overBudget = hasBid && hasBudget && bidNum > budgetNum;

  let verdictColor = "#aaa";
  if (netProfit != null) {
    if (netProfit >= minProfit) verdictColor = "#16a34a";
    else if (netProfit > 0) verdictColor = "#d4af37";
    else verdictColor = "#e05656";
  }
  const shouldBuy = netProfit != null && netProfit >= minProfit && !overBudget;

  const logDecision = (decision) => {
    if (logged) return;
    const entry = {
      title: resultTitle || "Unknown",
      marketValue: marketValue || 0,
      bidPrice: bidNum || 0,
      budget: budgetNum || 0,
      netProfit: netProfit != null ? Math.round(netProfit * 100) / 100 : 0,
      decision,
    };
    saveSession(entry);
    setLogged(true);
    if (onLogSession) onLogSession(entry);
  };

  const updateSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="calc-card">
      {/* Header: title + grade + settings gear */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {resultTitle && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resultTitle}
            </div>
          )}
          {resultGrade && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{resultGrade}</div>
          )}
        </div>
        <button
          onClick={() => setShowSettings((s) => !s)}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
            padding: "4px 8px", fontSize: 14, color: "#aaa", cursor: "pointer", lineHeight: 1,
          }}
          aria-label="Settings"
        >⚙</button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
          padding: 12, marginBottom: 12, background: "rgba(255,255,255,0.03)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#d4af37", marginBottom: 8 }}>Buyer settings</div>
          {[
            { k: "whatnotFee", label: "Whatnot fee %", step: "0.5" },
            { k: "supplies", label: "Supplies $", step: "0.25" },
            { k: "labor", label: "Labor $", step: "0.5" },
            { k: "minProfit", label: "Min profit $", step: "0.5" },
          ].map(({ k, label, step }) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#aaa" }}>{label}</span>
              <input
                type="number" inputMode="decimal" step={step}
                value={settings[k]}
                onChange={(e) => updateSetting(k, e.target.value)}
                style={{
                  width: 80, padding: "4px 8px", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.15)", background: "#1a1a1a",
                  color: "#fff", fontSize: 13, textAlign: "right",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Inputs: budget + bid */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="calc-label">Budget</label>
          <div className="calc-input-wrap">
            <span className="calc-dollar">$</span>
            <input type="number" inputMode="decimal" placeholder="50" value={budget} onChange={(e) => setBudget(e.target.value)} className="calc-input" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label className="calc-label">Bid / Ask</label>
          <div className="calc-input-wrap">
            <span className="calc-dollar">$</span>
            <input type="number" inputMode="decimal" placeholder="0" value={bid} onChange={(e) => setBid(e.target.value)} className="calc-input" />
          </div>
        </div>
      </div>

      {/* NET PROFIT hero */}
      {hasMV && hasBid ? (
        <div style={{ textAlign: "center", padding: "14px 0 8px" }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#888", fontWeight: 700 }}>NET PROFIT</div>
          <div style={{ fontSize: 52, fontWeight: 900, color: verdictColor, lineHeight: 1.05, marginTop: 4 }}>
            {netProfit >= 0 ? "$" : "-$"}{Math.abs(Math.round(netProfit))}
          </div>
          {overBudget && (
            <div style={{ fontSize: 12, color: "#e05656", marginTop: 4 }}>
              Over budget by ${Math.round(bidNum - budgetNum)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "14px 0 8px", color: "#666", fontSize: 13 }}>
          {!hasMV ? "Scan a comic to see net profit" : "Enter a bid"}
        </div>
      )}

      {/* BUY / PASS */}
      {hasMV && hasBid && (
        <button
          onClick={() => logDecision(shouldBuy ? "BUY" : "PASS")}
          disabled={logged}
          style={{
            width: "100%", padding: "16px 0", borderRadius: 10, border: "none",
            fontWeight: 900, fontSize: 20, letterSpacing: 2, cursor: logged ? "default" : "pointer",
            background: logged ? "rgba(255,255,255,0.06)" : (shouldBuy ? "#16a34a" : "#e05656"),
            color: logged ? "#666" : "#fff", marginTop: 6,
          }}
        >{logged ? "LOGGED" : (shouldBuy ? "BUY" : "PASS")}</button>
      )}

      {/* See details */}
      {hasMV && hasBid && (
        <>
          <button
            onClick={() => setShowDetails((s) => !s)}
            style={{
              width: "100%", padding: "8px 0", marginTop: 8, background: "transparent",
              border: "none", color: "#888", fontSize: 12, cursor: "pointer",
            }}
          >See details {showDetails ? "▾" : "›"}</button>
          {showDetails && (
            <div style={{ fontSize: 12, color: "#aaa", padding: "0 4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Market value</span><span style={{ color: "#ddd" }}>{fmt(marketValue)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Whatnot fee ({feePct}%)</span><span>-${whatnotFeeAmt.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Supplies</span><span>-${supplies.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Labor</span><span>-${labor.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Your bid</span><span>-${bidNum.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, fontWeight: 700 }}>
                <span style={{ color: "#ddd" }}>Net profit</span>
                <span style={{ color: verdictColor }}>${netProfit.toFixed(2)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FloatingSearchBar({ value, onChange, items, onAskClaude, onClaudeCardChange }) {
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInput, setAiInput] = useState(""); // separate state for Claude queries
  const [mode, setMode] = useState("search"); // "search" or "claude"
  const recognitionRef = useRef(null);
  const silenceTimer = useRef(null);
  const inputRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);

  const isAiQuery = (text) => {
    const t = text.trim().toLowerCase();
    if (t.startsWith("ask ")) return true;
    if (/^(what|which|who|how|why|show me|find|tell|suggest|recommend|should|is there|are there|do i|any )/i.test(t)) return true;
    return false;
  };

  const submitAiQuery = useCallback(async (text) => {
    const query = text.replace(/^ask\s+/i, "").trim();
    if (!query || !items) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getVaultHeaders() },
        body: JSON.stringify({ message: query, collection: items, history: [], buyerSessions: getSessionSummary() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAiResponse(data.response || "No response.");
      if (onAskClaude) onAskClaude(data);
    } catch {
      setAiResponse("Something went wrong. Try again.");
    } finally {
      setAiLoading(false);
    }
  }, [items, onAskClaude]);

  const displayValue = mode === "claude" ? aiInput : value;
  const handleInputChange = (text) => {
    if (mode === "claude") {
      setAiInput(text);
    } else {
      // Auto-detect AI query and switch modes
      if (isAiQuery(text)) {
        setMode("claude");
        setAiInput(text);
        onChange(""); // clear filter
      } else {
        onChange(text);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && mode === "claude" && aiInput.trim()) {
      submitAiQuery(aiInput);
    }
  };

  const clearAll = () => {
    onChange("");
    setAiInput("");
    setAiResponse(null);
    setMode("search");
  };

  const claudeCardVisible = !!(aiResponse || aiLoading);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
    }
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setListening(false);
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#d4af37";
      ctx.beginPath();
      const sliceW = canvas.width / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    draw();
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognitionRef.current = rec;

    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join("");
      if (isAiQuery(transcript)) {
        setMode("claude");
        setAiInput(transcript);
        onChange("");
      } else {
        onChange(transcript);
      }
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (e.results[e.results.length - 1].isFinal) {
        silenceTimer.current = setTimeout(() => {
          stopListening();
          if (isAiQuery(transcript)) submitAiQuery(transcript);
        }, 1500);
      }
    };
    rec.onerror = () => stopListening();
    rec.onend = () => stopListening();
    rec.start();
    setListening(true);

    navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      streamRef.current = stream;
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      drawWaveform();
    }).catch(() => {});
  }, [onChange, stopListening, drawWaveform, submitAiQuery]);

  useEffect(() => () => stopListening(), [stopListening]);

  const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (onClaudeCardChange) onClaudeCardChange(claudeCardVisible);
  }, [claudeCardVisible, onClaudeCardChange]);

  return (
    <div style={{
      position: "fixed", bottom: 70, left: 0, right: 0,
      maxWidth: 480, margin: "0 auto",
      padding: "0 12px", zIndex: 20,
      pointerEvents: "none",
    }}>
      {/* Claude AI response bubble */}
      {claudeCardVisible && (
        <div style={{
          background: "rgba(18,18,18,0.95)", backdropFilter: "blur(12px)",
          border: "1px solid rgba(212,175,55,0.3)", borderRadius: 16,
          padding: "12px 14px", marginBottom: 8,
          pointerEvents: "auto", maxHeight: 200, overflowY: "auto",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#d4af37", fontWeight: 600 }}>Claude</span>
            <button
              onClick={clearAll}
              style={{ background: "transparent", border: "none", color: "#666", fontSize: 14, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
            >✕</button>
          </div>
          {aiLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, border: "2px solid rgba(212,175,55,0.3)", borderTopColor: "#d4af37", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ color: "#d4af37", fontSize: 13 }}>Thinking...</span>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "#e0e0e0" }}>{aiResponse}</div>
          )}
        </div>
      )}

      {/* Search bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "rgba(18,18,18,0.95)", backdropFilter: "blur(12px)",
        border: `1px solid ${mode === "claude" ? "rgba(212,175,55,0.6)" : "rgba(212,175,55,0.35)"}`, borderRadius: 28,
        padding: "6px 6px 6px 16px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        pointerEvents: "auto",
      }}>
        {expanded ? (
          <>
            {/* Mode toggle */}
            <button
              onClick={() => { setMode(mode === "claude" ? "search" : "claude"); }}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: 16, flexShrink: 0, padding: "2px 4px",
                color: mode === "claude" ? "#d4af37" : "#888",
              }}
              aria-label={mode === "claude" ? "Switch to search" : "Switch to Claude"}
            >{mode === "claude" ? "🧠" : "🔍"}</button>
            <input
              ref={inputRef}
              type="text"
              placeholder={mode === "claude" ? 'Ask Claude about your collection...' : 'Filter by title, "key", "$100+"...'}
              value={displayValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#fff", fontSize: 15, padding: "6px 0",
              }}
            />
            {listening && (
              <canvas ref={canvasRef} width={60} height={28} style={{ flexShrink: 0, opacity: 0.9 }} />
            )}
            {displayValue && (
              <button
                onClick={clearAll}
                style={{ background: "transparent", border: "none", color: "#aaa", fontSize: 18, cursor: "pointer", padding: "4px 6px", lineHeight: 1 }}
              >✕</button>
            )}
            {hasSpeech && (
              <button
                onClick={listening ? stopListening : startListening}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: listening ? "#d4af37" : "rgba(255,255,255,0.1)",
                  color: listening ? "#000" : "#d4af37", fontSize: 18, transition: "all 0.2s",
                }}
                aria-label={listening ? "Stop voice" : "Voice search"}
              >{listening ? "⏹" : "🎤"}</button>
            )}
            {mode === "claude" && aiInput.trim() && !aiLoading && (
              <button
                onClick={() => submitAiQuery(aiInput)}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: "#d4af37", color: "#000", fontSize: 16, fontWeight: 700,
                }}
                aria-label="Ask Claude"
              >→</button>
            )}
            <button
              onClick={() => { setExpanded(false); stopListening(); }}
              style={{ background: "transparent", border: "none", color: "#888", fontSize: 14, cursor: "pointer", padding: "4px 8px", fontWeight: 600 }}
            >Done</button>
          </>
        ) : (
          <button
            onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 100); }}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              background: "transparent", border: "none", cursor: "pointer",
              color: "#888", fontSize: 15, padding: "6px 0", textAlign: "left",
            }}
          >
            <span style={{ fontSize: 16 }}>🔍</span>
            <span>{value || 'Search or ask Claude...'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function CollectionList({ items, totalValue, soldCount, soldRevenue, onOpen, onDelete, refreshingPrices, snapshots, bulkEnrichProgress }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [sortBy, setSortBy] = useState("recent");
  const [eraFilter, setEraFilter] = useState("all");
  const [localSearch, setLocalSearch] = useState("");
  const [importStatus, setImportStatus] = useState(null);
  const [claudeCardVisible, setClaudeCardVisible] = useState(false);
  const [backupBanner, setBackupBanner] = useState(false);
  const [readinessFilter, setReadinessFilter] = useState(null); // 'READY' | 'PHOTOS NEEDED' | 'NEEDS REVIEW' | 'BLOCKED' | null
  const importRef = useRef(null);

  // Track collection changes for backup reminder
  useEffect(() => {
    if (items.length === 0) return;
    const lastBackup = localStorage.getItem("cv_last_backup_date");
    const lastCount = parseInt(localStorage.getItem("cv_last_backup_count") || "0", 10);
    if (!lastBackup || items.length !== lastCount) {
      setBackupBanner(true);
    }
  }, [items.length]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));
  const cancelSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const deleteSelected = () => {
    if (!confirm(`Delete ${selected.size} comic${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    for (const id of selected) onDelete(id);
    setSelected(new Set());
    setSelectMode(false);
  };

  const exportJSON = () => {
    const data = items.map(({ images, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comic-vault-export-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const cols = ["title","issue","publisher","year","grade","isGraded","numericGrade","keyIssue","price","pricingSource","status","ebayUrl","purchasePrice","timestamp"];
    const escape = (v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [cols.join(",")];
    for (const item of items) {
      rows.push(cols.map((c) => escape(item[c])).join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comic-vault-export-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const backupToDrive = () => {
    const data = items.map(({ images, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comic-vault-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem("cv_last_backup_date", date);
    localStorage.setItem("cv_last_backup_count", String(items.length));
    setBackupBanner(false);
    setTimeout(() => {
      window.open("https://drive.google.com/drive/my-drive", "_blank");
    }, 500);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) { setImportStatus("Invalid file: expected JSON array"); return; }
      const existing = new Set(items.map((c) => `${c.title}|${c.issue}|${c.year}`));
      let imported = 0, skipped = 0;
      for (let i = 0; i < parsed.length; i++) {
        const c = parsed[i];
        if (!c || !c.title) { skipped++; continue; }
        const key = `${c.title}|${c.issue}|${c.year}`;
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);
        const entry = {
          ...c,
          id: c.id || `cv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: c.timestamp || Date.now(),
          images: c.images || [],
        };
        await putComic(entry);
        imported++;
        if (i % 10 === 0) setImportStatus(`Importing ${i + 1} of ${parsed.length}...`);
      }
      setImportStatus(`Imported ${imported}, skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""}`);
      if (imported > 0) window.location.reload();
    } catch (err) {
      setImportStatus(`Import failed: ${err.message}`);
    }
  };

  // Value trend sparkline from snapshots
  const trendData = (snapshots || []).slice(-30);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const weekAgoSnap = trendData.find((s) => s.date >= weekAgo) || trendData[0];
  const latestSnap = trendData[trendData.length - 1];
  const weekDelta = latestSnap && weekAgoSnap ? latestSnap.totalValue - weekAgoSnap.totalValue : null;

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="upload-emoji">📚</div>
        <div className="muted">No comics in your collection yet.</div>
        <div className="muted small">Scanned comics will appear here.</div>
        <input ref={importRef} type="file" accept=".json" onClick={(e) => { e.target.value = null; }} onChange={handleImport} hidden />
        <button
          onClick={() => importRef.current?.click()}
          style={{ marginTop: 12, fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(212,175,55,0.4)", background: "transparent", color: "#d4af37", cursor: "pointer", fontWeight: 600 }}
        >Import Collection</button>
        <div className="muted small" style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>Tip: Find your backup in Downloads folder</div>
        {importStatus && <div className="muted small" style={{ marginTop: 8 }}>{importStatus}</div>}
      </div>
    );
  }

  return (
    <>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#d4af37", textAlign: "center", padding: "8px 0 4px", letterSpacing: 0.5 }}>
        GrailKey
      </div>
      <div className="stats-row">
        <div className="stat">
          <div className="stat-value">{items.length}</div>
          <div className="stat-label">Comics</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {items.some(c => !c.marketPending)
              ? fmt(totalValue)
              : "Updating…"}
          </div>
          <div className="stat-label">Liquid Value</div>
        </div>
        {soldCount > 0 && (
          <div className="stat">
            <div className="stat-value" style={{ color: "#eab308" }}>
              {fmt(soldRevenue)}
            </div>
            <div className="stat-label">Sold ({soldCount})</div>
          </div>
        )}
      </div>
      {/* Value trend sparkline */}
      {trendData.length >= 2 && (() => {
        const vals = trendData.map((s) => s.totalValue);
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals);
        const range = maxV - minV || 1;
        const w = 300;
        const h = 60;
        const pad = 4;
        const points = vals.map((v, i) => {
          const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
          const y = h - pad - ((v - minV) / range) * (h - pad * 2);
          return `${x},${y}`;
        });
        return (
          <div style={{ margin: "8px 0" }}>
            {weekDelta != null && (
              <div style={{ fontSize: 12, fontWeight: 600, textAlign: "center", marginBottom: 4, color: weekDelta >= 0 ? "#16a34a" : "#e05656" }}>
                {weekDelta >= 0 ? "\u2191" : "\u2193"} {fmt(Math.abs(weekDelta))} since last week
              </div>
            )}
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 60 }}>
              <polyline points={points.join(" ")} fill="none" stroke="#FFD700" strokeWidth="2" strokeLinejoin="round" />
              {points.map((p, i) => (
                <circle key={i} cx={p.split(",")[0]} cy={p.split(",")[1]} r="2.5" fill="#FFD700" />
              ))}
            </svg>
          </div>
        );
      })()}

      {/* Collection Action Dashboard */}
      {(() => {
        const metrics = getCollectionMetrics(items);
        return (
          <div style={{ margin: "12px 0 8px", padding: "12px", borderRadius: 8, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#888", marginBottom: 10, textAlign: "center" }}>
              Collection Status
            </div>

            {/* Action buckets grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 8 }}>
              {/* Ready to List */}
              <div
                onClick={() => setReadinessFilter(readinessFilter === 'READY' ? null : 'READY')}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: readinessFilter === 'READY' ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.08)",
                  border: readinessFilter === 'READY' ? "1.5px solid rgba(34,197,94,0.5)" : "1px solid rgba(34,197,94,0.25)",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, color: "#22c55e", marginBottom: 2 }}>✓ READY</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", marginBottom: 1 }}>{metrics.ready.count}</div>
                <div style={{ fontSize: 10, color: "#22c55e", opacity: 0.8 }}>{fmt(metrics.ready.value)}</div>
              </div>

              {/* Photos Needed */}
              <div
                onClick={() => setReadinessFilter(readinessFilter === 'PHOTOS NEEDED' ? null : 'PHOTOS NEEDED')}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: readinessFilter === 'PHOTOS NEEDED' ? "rgba(251,191,36,0.15)" : "rgba(251,191,36,0.08)",
                  border: readinessFilter === 'PHOTOS NEEDED' ? "1.5px solid rgba(251,191,36,0.5)" : "1px solid rgba(251,191,36,0.25)",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, color: "#fbbf24", marginBottom: 2 }}>📷 PHOTOS</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fbbf24", marginBottom: 1 }}>{metrics.photosNeeded.count}</div>
                <div style={{ fontSize: 10, color: "#fbbf24", opacity: 0.8 }}>{fmt(metrics.photosNeeded.value)}</div>
              </div>

              {/* Needs Review */}
              <div
                onClick={() => setReadinessFilter(readinessFilter === 'NEEDS REVIEW' ? null : 'NEEDS REVIEW')}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: readinessFilter === 'NEEDS REVIEW' ? "rgba(251,146,60,0.15)" : "rgba(251,146,60,0.08)",
                  border: readinessFilter === 'NEEDS REVIEW' ? "1.5px solid rgba(251,146,60,0.5)" : "1px solid rgba(251,146,60,0.25)",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, color: "#fb923c", marginBottom: 2 }}>⚠️ REVIEW</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fb923c", marginBottom: 1 }}>{metrics.needsReview.count}</div>
                <div style={{ fontSize: 10, color: "#fb923c", opacity: 0.8 }}>{fmt(metrics.needsReview.value)}</div>
              </div>

              {/* Blocked */}
              <div
                onClick={() => setReadinessFilter(readinessFilter === 'BLOCKED' ? null : 'BLOCKED')}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: readinessFilter === 'BLOCKED' ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.08)",
                  border: readinessFilter === 'BLOCKED' ? "1.5px solid rgba(239,68,68,0.5)" : "1px solid rgba(239,68,68,0.25)",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, color: "#e05656", marginBottom: 2 }}>🚫 BLOCKED</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#e05656", marginBottom: 1 }}>{metrics.blocked.count}</div>
                <div style={{ fontSize: 10, color: "#e05656", opacity: 0.8 }}>{fmt(metrics.blocked.value)}</div>
              </div>
            </div>

            {/* Liquid Value highlight */}
            <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#22c55e", marginBottom: 1 }}>💰 LIQUID VALUE</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>{fmt(metrics.liquidValue)}</div>
              <div style={{ fontSize: 9, color: "#22c55e", opacity: 0.7, marginTop: 2 }}>Ready + Photos Needed</div>
            </div>
          </div>
        );
      })()}

      {/* Channel Routing Dashboard */}
      {(() => {
        const channels = getChannelMetrics(items);
        const hasChannels = Object.values(channels).some(ch => ch.count > 0);
        if (!hasChannels) return null;

        return (
          <div style={{ margin: "12px 0 8px", padding: "12px", borderRadius: 8, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.15)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#888", marginBottom: 10, textAlign: "center" }}>
              Channel Routing
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {channels.cash_sale.count > 0 && (
                <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#22c55e", marginBottom: 1 }}>💵 LIST</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#22c55e", marginBottom: 1 }}>{channels.cash_sale.count}</div>
                  <div style={{ fontSize: 9, color: "#22c55e", opacity: 0.8 }}>{fmt(channels.cash_sale.value)}</div>
                </div>
              )}

              {channels.bundle.count > 0 && (
                <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#eab308", marginBottom: 1 }}>📦 BUNDLE</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#eab308", marginBottom: 1 }}>{channels.bundle.count}</div>
                  <div style={{ fontSize: 9, color: "#eab308", opacity: 0.8 }}>{fmt(channels.bundle.value)}</div>
                </div>
              )}

              {channels.grade.count > 0 && (
                <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#a855f7", marginBottom: 1 }}>⭐ GRADE</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#a855f7", marginBottom: 1 }}>{channels.grade.count}</div>
                  <div style={{ fontSize: 9, color: "#a855f7", opacity: 0.8 }}>{fmt(channels.grade.value)}</div>
                </div>
              )}

              {channels.barter.count > 0 && (
                <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#3b82f6", marginBottom: 1 }}>🔁 TRADE</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#3b82f6", marginBottom: 1 }}>{channels.barter.count}</div>
                  <div style={{ fontSize: 9, color: "#3b82f6", opacity: 0.8 }}>{fmt(channels.barter.value)}</div>
                </div>
              )}

              {channels.research.count > 0 && (
                <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#f97316", marginBottom: 1 }}>🔍 RESEARCH</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#f97316", marginBottom: 1 }}>{channels.research.count}</div>
                  <div style={{ fontSize: 9, color: "#f97316", opacity: 0.8 }}>{fmt(channels.research.value)}</div>
                </div>
              )}

              {channels.blocked.count > 0 && (
                <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", marginBottom: 1 }}>🚫 BLOCKED</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#ef4444", marginBottom: 1 }}>{channels.blocked.count}</div>
                  <div style={{ fontSize: 9, color: "#ef4444", opacity: 0.8 }}>{fmt(channels.blocked.value)}</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Active filter indicator */}
      {readinessFilter && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "4px 0 8px", padding: "6px 10px", borderRadius: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#6366f1" }}>Showing: {readinessFilter}</span>
          <button
            onClick={() => setReadinessFilter(null)}
            style={{ background: "transparent", border: "none", color: "#6366f1", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1, fontWeight: 700 }}
          >&times;</button>
        </div>
      )}

      {refreshingPrices > 0 && (
        <div className="muted small" style={{ textAlign: "center", margin: "4px 0 8px" }}>
          Updating prices... ({refreshingPrices} remaining)
        </div>
      )}

      {bulkEnrichProgress && bulkEnrichProgress.current < bulkEnrichProgress.total && (
        <div className="muted small" style={{ textAlign: "center", margin: "4px 0 8px", color: "#4caf50" }}>
          Fetching market data… {bulkEnrichProgress.current} of {bulkEnrichProgress.total}
        </div>
      )}

      {/* Backup banner */}
      {backupBanner && (
        <div
          onClick={backupToDrive}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 12px", margin: "4px 0", borderRadius: 8, background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.3)", cursor: "pointer" }}
        >
          <span style={{ fontSize: 13, color: "#d4af37", fontWeight: 600 }}>Collection updated — tap to backup to Drive</span>
          <button onClick={(e) => { e.stopPropagation(); setBackupBanner(false); }} style={{ background: "transparent", border: "none", color: "#888", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>&times;</button>
        </div>
      )}

      {/* Select mode header */}
      <input ref={importRef} type="file" accept=".json" onClick={(e) => { e.target.value = null; }} onChange={handleImport} hidden />
      {importStatus && <div className="muted small" style={{ textAlign: "center", margin: "4px 0" }}>{importStatus}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "4px 0", marginBottom: 4 }}>
        {selectMode ? (
          <>
            <span className="muted small" style={{ marginRight: "auto" }}>
              {selected.size} selected
            </span>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(212,175,55,0.4)", background: "transparent", color: "#d4af37", cursor: "pointer", fontWeight: 600 }}
              onClick={selectAll}
            >Select All</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid #e05656", background: selected.size > 0 ? "#e05656" : "transparent", color: selected.size > 0 ? "#fff" : "#e05656", cursor: selected.size > 0 ? "pointer" : "default", fontWeight: 700, opacity: selected.size > 0 ? 1 : 0.4 }}
              onClick={deleteSelected}
              disabled={selected.size === 0}
            >Delete Selected</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={cancelSelect}
            >Cancel</button>
          </>
        ) : (
          <>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(212,175,55,0.25)", background: "rgba(212,175,55,0.08)", color: "#d4af37", cursor: "pointer", fontWeight: 600 }}
              onClick={backupToDrive}
            >Backup to Drive</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={exportJSON}
            >Export</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={exportCSV}
            >CSV</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={() => importRef.current?.click()}
            >Import</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={() => setSelectMode(true)}
            >Select</button>
          </>
        )}
      </div>

      {/* Sort bar */}
      <div style={{ display: "flex", gap: 4, padding: "4px 0", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[["value", "Value ↓"], ["title", "Title"], ["year", "Year"], ["grade", "Grade"], ["recent", "Recent"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: sortBy === key ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.12)", background: sortBy === key ? "rgba(212,175,55,0.15)" : "transparent", color: sortBy === key ? "#d4af37" : "#aaa", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
          >{label}</button>
        ))}
      </div>

      {/* Era filter pills */}
      <div style={{ display: "flex", gap: 4, padding: "4px 0 8px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[["all", "All"], ["silver", "Silver Age"], ["bronze", "Bronze"], ["modern", "Modern"], ["keys", "Keys"], ["listed", "Listed"], ["unlisted", "Unlisted"], ["sold", "Sold"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setEraFilter(eraFilter === key ? "all" : key)}
            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, border: eraFilter === key && key !== "all" ? "none" : "1px solid rgba(255,255,255,0.12)", background: eraFilter === key && key !== "all" ? "#FFD700" : eraFilter === key ? "rgba(212,175,55,0.15)" : "transparent", color: eraFilter === key && key !== "all" ? "#000" : eraFilter === key ? "#d4af37" : "#aaa", cursor: "pointer", fontWeight: eraFilter === key ? 700 : 600, whiteSpace: "nowrap" }}
          >{label}</button>
        ))}
      </div>

      <FloatingSearchBar value={localSearch} onChange={setLocalSearch} items={items} onClaudeCardChange={setClaudeCardVisible} />

      {(() => {
        const sq = localSearch.toLowerCase().trim();
        const searchFilter = (item) => {
          if (!sq) return true;
          const priceMatch = sq.match(/^\$(\d+)\+?$/);
          if (priceMatch) return (getDisplayPrice(item) || 0) >= parseInt(priceMatch[1]);
          if (sq === "key" || sq === "keys") return showKeyIssue(item.keyIssue);
          if (sq === "listed") return item.status === "listed";
          if (sq === "unlisted") return item.status !== "listed";
          if (sq === "sold") return item.status === "sold";
          const hay = `${item.title} ${item.publisher} ${item.year} ${item.grade} ${item.keyIssue}`.toLowerCase();
          return hay.includes(sq);
        };
        const filteredItems = items
          .filter(searchFilter)
          .filter((item) => {
            if (eraFilter === "all") return true;
            const yr = parseInt(item.year, 10);
            if (eraFilter === "silver") return yr >= 1956 && yr <= 1969;
            if (eraFilter === "bronze") return yr >= 1970 && yr <= 1985;
            if (eraFilter === "modern") return yr >= 1986;
            if (eraFilter === "keys") return showKeyIssue(item.keyIssue);
            if (eraFilter === "listed") return item.status === "listed";
            if (eraFilter === "unlisted") return item.status !== "listed";
            if (eraFilter === "sold") return item.status === "sold";
            return true;
          })
          .filter((item) => {
            if (!readinessFilter) return true;
            const readiness = getReadinessStatus(item);
            return readiness.badge === readinessFilter;
          })
          .sort((a, b) => {
            if (sortBy === "value") return (getDisplayPrice(b) || 0) - (getDisplayPrice(a) || 0);
            if (sortBy === "title") return (a.title || "").localeCompare(b.title || "");
            if (sortBy === "year") return (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0);
            if (sortBy === "grade") return (b.numericGrade || 0) - (a.numericGrade || 0);
            if (sortBy === "recent") return (b.timestamp || 0) - (a.timestamp || 0);
            return 0;
          });
        const isFiltered = eraFilter !== "all" || sq || readinessFilter;
        return (
          <>
            {isFiltered && (
              <div className="muted small" style={{ textAlign: "center", marginBottom: 6 }}>
                Showing {filteredItems.length} of {items.length} comics
              </div>
            )}
            <div className="collection-list" style={{ paddingBottom: claudeCardVisible ? 220 : 100 }}>
              {filteredItems.map((item) => {
          const thumbSrc = getComicPhotos(item)[0] || null;
          const extractIssueFromReport = (txt) => {
            if (!txt) return null;
            const m = String(txt).match(/#\s*(\d+)/);
            return m ? m[1] : null;
          };
          const displayIssue = item.issue || extractIssueFromReport(item.conditionReport || item.notes || '');
          const titleWithIssue = (item.title || "Unknown") + (displayIssue && !/unknown/i.test(String(displayIssue)) && !String(item.title || "").includes('#' + displayIssue) ? ` #${displayIssue}` : '');
          const gradeTxt = item.isGraded === true && item.numericGrade != null
            ? `CGC ${item.numericGrade}`
            : (() => {
                if (!item.grade) return null;
                const g = String(item.grade).trim();
                const hasLetters = /[A-Z]/i.test(g);
                const hasNumber = /\d/.test(g);
                if (hasLetters && hasNumber) return g;
                if (hasLetters && !hasNumber) {
                  const RAW_NUMS = { "NM/M": "9.8", "NM": "9.4", "VF/NM": "8.5", "VF": "7.5", "VF/F": "7.0", "FN/VF": "6.5", "FN": "6.0", "VG/FN": "5.0", "VG": "4.0", "VG/G": "3.5", "GD/VG": "3.0", "GD": "2.0", "GD-": "1.8", "FR/GD": "1.5", "FR": "1.0", "PR": "0.5" };
                  const abbrev = g.toUpperCase().replace(/\s+/g, "");
                  return RAW_NUMS[abbrev] ? `${g} ${RAW_NUMS[abbrev]}` : g;
                }
                return g;
              })();
          const isSelected = selected.has(item.id);
          return (
          <div
            key={item.id}
            className="collection-item"
            style={isSelected ? { background: "rgba(212,175,55,0.1)" } : undefined}
            onClick={() => selectMode ? toggleSelect(item.id) : onOpen(item)}
          >
            {selectMode && (
              <div
                style={{ display: "flex", alignItems: "center", paddingRight: 8, cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: 4,
                  border: isSelected ? "2px solid #d4af37" : "2px solid rgba(255,255,255,0.25)",
                  background: isSelected ? "#d4af37" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, color: "#000", fontWeight: 700,
                }}>{isSelected ? "✓" : ""}</div>
              </div>
            )}
            {thumbSrc ? (
              <img src={thumbSrc} alt="" loading="lazy" className="thumb" />
            ) : (
              <div className="thumb thumb-placeholder">📘</div>
            )}
            <div className="collection-meta">
              <div className="cl-row1">
                <span className="collection-title">{titleWithIssue}</span>
                {(item.manualReviewRequired || item.gradeExceedsMap) ? (
                  <span className="collection-price" style={{ color: "#d17105" }}>
                    Appraise
                  </span>
                ) : item.marketPending ? (
                  <span className="collection-price" style={{ color: "#666" }}>—</span>
                ) : getDisplayPrice(item) > 0 && (
                  <span className="collection-price">{formatCurrency(getDisplayPrice(item))}</span>
                )}
              </div>
              {item.variant && !['cover a','corner box','masterpieces'].some(v => item.variant.toLowerCase().includes(v)) && (
                <div style={{ fontSize: 11, color: '#d4af37', marginTop: 1 }}>⚡ {item.variant}</div>
              )}
              <div className="cl-row2 muted small">
                {item.publisher}{item.publisher && item.year ? " · " : ""}{item.year}{gradeTxt ? ` · ${gradeTxt}` : ""}
              </div>
              {(() => {
                // When engine cannot price the book, hide both range and
                // last-sold rather than leak the unguarded comp pool — same
                // logic that already suppresses the hero/inline price.
                if (item.manualReviewRequired || item.gradeExceedsMap) return null;

                // Mega-key floor enforced: show the floor band, not the
                // contaminated comp pool that the floor exists to override.
                if (item.megaKeyFloorApplied) {
                  const lo = item.priceLow ? String(item.priceLow).replace(/\.00$/, '') : null;
                  const hi = item.priceHigh ? String(item.priceHigh).replace(/\.00$/, '') : null;
                  if (!lo) return null;
                  return (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {(!hi || lo === hi) ? `Floor ${lo}` : `Floor band ${lo}–${hi}`}
                    </div>
                  );
                }

                const soldLow = item.soldComps?.[0]?.price;
                const askLow = item.comps?.lowestNum;
                const askHigh = item.comps?.highestNum;
                if (!soldLow && !askLow) return null;
                return (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    {soldLow ? `Last sold $${Math.round(soldLow)}` : ''}
                    {soldLow && askLow ? ' · ' : ''}
                    {askLow ? `Asking $${Math.round(askLow)}` : ''}
                    {askHigh && askHigh !== askLow ? `–$${Math.round(askHigh)}` : ''}
                  </div>
                );
              })()}
              {item.status === "sold" && item.soldPrice != null && (
                <div style={{ fontSize: 11, color: '#eab308', marginTop: 2, fontWeight: 600 }}>
                  💰 Sold ${item.soldPrice.toFixed(2)} {item.soldAt ? (() => {
                    const d = new Date(item.soldAt);
                    return `on ${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
                  })() : ''}
                </div>
              )}
              {(showKeyIssue(item.keyIssue) || item.status === "listed" || item.status === "sold" || item.purchasePrice > 0 || item.megaKeyFloorApplied || item.manualReviewRequired || item.gradeExceedsMap || item.decision?.bestChannel) && (
                <div className="cl-row3">
                  {item.decision?.bestChannel && (() => {
                    const ch = item.decision.bestChannel;
                    const badges = {
                      cash_sale: { emoji: '💵', label: 'LIST', className: 'pill-channel-cash' },
                      bundle: { emoji: '📦', label: 'BUNDLE', className: 'pill-channel-bundle' },
                      barter: { emoji: '🔁', label: 'TRADE', className: 'pill-channel-barter' },
                      research: { emoji: '🔍', label: 'RESEARCH', className: 'pill-channel-research' },
                      blocked: { emoji: '🚫', label: 'BLOCKED', className: 'pill-channel-blocked' },
                      grade: { emoji: '⭐', label: 'GRADE', className: 'pill-channel-grade' }
                    };
                    const badge = badges[ch];
                    if (!badge) return null;
                    return (
                      <span className={`pill ${badge.className}`} title={`Best channel: ${ch.replace('_', ' ')}`}>
                        {badge.emoji} {badge.label}
                      </span>
                    );
                  })()}
                  {item.inTradePile && (
                    <span className="pill pill-in-trade" title="In trade pile">
                      🔁 IN TRADE
                    </span>
                  )}
                  {showKeyIssue(item.keyIssue) && <span className="pill pill-key">KEY</span>}
                  {item.manualReviewRequired && (
                    <span
                      className="pill pill-manual-review"
                      title={item.manualReviewReason || "Manual review required"}
                    >
                      🔑 MANUAL REVIEW
                    </span>
                  )}
                  {item.gradeExceedsMap && !item.manualReviewRequired && (
                    <span
                      className="pill pill-exceeds-map"
                      title={item.gradeExceedsMapReason || "Grade exceeds floor map coverage"}
                    >
                      🔑 GRADE EXCEEDS MAP
                    </span>
                  )}
                  {item.megaKeyFloorApplied && !item.manualReviewRequired && !item.gradeExceedsMap && (
                    <span
                      className={`pill ${item.megaKeyFloorVerified ? 'pill-mega-verified' : 'pill-mega-estimated'}`}
                      title={item.megaKeyFloorNote || ""}
                    >
                      🔑 {item.megaKeyFloorVerified ? "VERIFIED" : "ESTIMATED"}
                    </span>
                  )}
                  {item.status === "listed" && <span className="pill pill-listed">LISTED</span>}
                  {item.status === "sold" && <span className="pill pill-sold">SOLD</span>}
                  {item.purchasePrice > 0 && getDisplayPrice(item) > 0 && (() => {
                    const roi = ((getDisplayPrice(item) - item.purchasePrice) / item.purchasePrice) * 100;
                    const pos = roi >= 0;
                    return (
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, fontWeight: 700, background: pos ? "rgba(22,163,106,0.2)" : "rgba(224,86,86,0.2)", color: pos ? "#16a34a" : "#e05656" }}>
                        {pos ? "+" : ""}{Math.round(roi)}%
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
            {!selectMode && (
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${titleWithIssue}"?`)) onDelete(item.id);
                }}
                aria-label="Delete"
              >
                ✕
              </button>
            )}
          </div>
          );
              })}
            </div>
          </>
        );
      })()}
    </>
  );
}

function CollectionDetail({
  item,
  onBack,
  onDelete,
  onList,
  onRefreshMarket,
  onReIdentify,
  onAbortEnrich,
  onAddPhoto,
  onUpdateField,
  currentIndex,
  totalItems,
  onPrev,
  onNext,
}) {
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [reIdentifying, setReIdentifying] = useState(false);
  const [reIdentifyError, setReIdentifyError] = useState(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [addPhotoError, setAddPhotoError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncSuccess, setSyncSuccess] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [ppInput, setPpInput] = useState(item.purchasePrice != null ? String(item.purchasePrice) : "");
  const [listPrice, setListPrice] = useState(() => getAuthorityPrice(item)); // v0-E: use decision.price when available
  const [swipeHint, setSwipeHint] = useState(() => !localStorage.getItem("cv_swipe_hint_seen"));
  const [showEngineRec, setShowEngineRec] = useState(false);
  const [expandedKeyIdx, setExpandedKeyIdx] = useState(null);
  const [listPriceWarningDismissed, setListPriceWarningDismissed] = useState(false);
  // Ship #20a.6.1 — collapsible drawer for soldCompDiagnostics rejected samples.
  const [soldDrawerOpen, setSoldDrawerOpen] = useState(false);
  // Collapsible sections for enriched data
  const [creatorsExpanded, setCreatorsExpanded] = useState(false);
  const [velocityExpanded, setVelocityExpanded] = useState(false);
  const [ladderExpanded, setLadderExpanded] = useState(false);
  const [popExpanded, setPopExpanded] = useState(false);
  const [storyExpanded, setStoryExpanded] = useState(false); // Ship #21c
  const [derivationExpanded, setDerivationExpanded] = useState(false); // Ship #21e
  const [packetModal, setPacketModal] = useState(null); // { channel, packet }
  const [packetDropdownOpen, setPacketDropdownOpen] = useState(false);
  const [packetEditTitle, setPacketEditTitle] = useState("");
  const [packetEditDesc, setPacketEditDesc] = useState("");
  const [packetEditPrice, setPacketEditPrice] = useState("");
  const addPhotoRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchStartT = useRef(null);

  useEffect(() => {
    // v0-E: Rule precedence (highest first):
    // 1. Blocked decision: always overwrite stale listPrice with current price
    // 2. Explicit manual edit: preserve user value (unless blocked)
    // 3. Decision.price authority: use decision.price when decision permits listing
    // 4. Old items without manual flag: overwrite if >50% deviation from authority price
    // 5. New items: always sync authority price

    const isBlocked =
      item.decision?.action === 'DO_NOT_LIST' ||
      item.decision?.action === 'ID_REQUIRED' ||
      (item.decision?.blockers?.length || 0) > 0;

    // v0-E: Use authority price (decision.price when available, else system price)
    const authorityPrice = getAuthorityPrice(item);

    if (isBlocked) {
      // Rule 1: Blocked items always show current authority price (may be 0)
      setListPrice(authorityPrice);
    } else if (item.listPriceManual === true) {
      // Rule 2: Preserve manual value (only for non-blocked items)
      setListPrice(item.listPrice != null ? item.listPrice : Math.round(authorityPrice * 100) / 100);
    } else if (item.listPrice != null && (item.listPriceManual === undefined || item.listPriceManual === false)) {
      // Rule 3: Items without manual edit - detect stale data vs authority price
      const deviation = Math.abs(item.listPrice - authorityPrice) / Math.max(authorityPrice, 0.01);
      if (deviation > 0.5) {
        // >50% deviation = stale data, overwrite with authority price
        setListPrice(Math.round(authorityPrice * 100) / 100);
      } else {
        // Within 50% = preserve
        setListPrice(item.listPrice);
      }
    } else {
      // Rule 4: New items or items without listPrice field
      setListPrice(authorityPrice);
    }

    setShowEngineRec(false);
    setListPriceWarningDismissed(false);
  }, [item?.id, item?.price, item?.decision, item?.listPrice, item?.listPriceManual]);

  // Abort any in-flight card enrich when the item changes or the detail
  // view unmounts. Prevents a pending /api/enrich response from a PRIOR
  // item (e.g. user tapped Refresh on A, swiped to B) from landing and
  // stomping catalogue state.
  useEffect(() => {
    return () => {
      if (onAbortEnrich) onAbortEnrich();
    };
  }, [item?.id, onAbortEnrich]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onPrev, onNext]);

  useEffect(() => {
    if (!swipeHint) return;
    const t = setTimeout(() => {
      setSwipeHint(false);
      localStorage.setItem("cv_swipe_hint_seen", "1");
    }, 2000);
    return () => clearTimeout(t);
  }, [swipeHint]);

  const photos = getComicPhotos(item);
  const canAddMore = photos.length < 4;
  const isListed = item.status === "listed" && item.ebayUrl;

  // Pricing: single source of truth via getDisplayPrice.
  const hasComps =
    (item.comps &&
     Array.isArray(item.comps.recentSales) &&
     item.comps.recentSales.length > 0) ||
    (Array.isArray(item.soldComps) && item.soldComps.length > 0);
  const displayPrice = getDisplayPrice(item);
  // Ship #24a-3 — contract price renders "—" honestly when null (REFUSED),
  // never a $0.00 string (ruling 3).
  const recommendedLabel = item.contract
    ? (item.contract.price != null
        ? formatCurrency(assertContractPrice(item, 'CollectionDetail.recommended', item.contract.price))
        : "—")
    : (displayPrice > 0 ? formatCurrency(displayPrice) : "—");

  // Grade badge: CGC numeric if graded, raw grade if available, else RAW COPY.
  const gradeBadgeText =
    item.isGraded === true && item.numericGrade != null
      ? `CGC ${item.numericGrade}`
      : item.grade || "RAW COPY";

  // Ship 6.4 — Filter key-related bullets when polybag detected.
  // Vision generates conditionReport BEFORE polybag detection runs, so
  // bullets often reference "Major Silver Age key", "1st appearance",
  // "first JLA" etc. for what's actually a Loot Crate reprint. Filter at
  // render only — preserves item.reason in storage so first-print scans
  // are unaffected and we can revert later. Pattern matches case-insensitive.
  const KEY_LANGUAGE_RE = /\b(?:1st|first)\s+(?:app|appearance|jla|justice|issue)|\bmajor\s+(?:silver|bronze|golden|copper)\s+age\s+key|\bkey\s+issue|\borigin\s+of\b|\bdebut\s+of\b/i;
  const conditionBullets = item.polybagDetected
    ? parseConditionReport(item.reason).filter((b) => !KEY_LANGUAGE_RE.test(b.text || ''))
    : parseConditionReport(item.reason);
  const confidenceText = formatConfidence(item.confidence);
  const scannedText = item.timestamp
    ? new Date(item.timestamp).toLocaleString()
    : null;

  const handleList = async () => {
    setListing(true);
    setListError(null);
    try {
      const overridePrice = parseFloat(listPrice);
      const itemToList = overridePrice > 0
        ? { ...item, price: `$${overridePrice.toFixed(2)}` }
        : { ...item };
      // Q41: acknowledged-override listings carry the audit payload so
      // [Q41-override] fires server-side on every acknowledged listing.
      if (item.q41Ack?.payload && item.contract && !item.contract.listable) {
        itemToList.q41Override = {
          ...item.q41Ack.payload,
          listedPrice: overridePrice > 0 ? overridePrice : getDisplayPrice(item),
        };
      }
      await onList(itemToList);
    } catch (err) {
      setListError(err.message || "Failed to list");
    } finally {
      setListing(false);
    }
  };

  const handlePreparePacket = (channel) => {
    setPacketDropdownOpen(false);
    const packet = generatePacket(item, channel, getDisplayPrice, getComicPhotos);

    if (packet.error) {
      const messages = {
        DO_NOT_LIST: 'Cannot create listing packet: blocked by decision engine',
        ID_REQUIRED: 'Cannot create listing packet: identity verification required',
        BLOCKED: `Cannot create listing packet: ${packet.reason}`,
        SOLD: 'Cannot create listing packet: item already sold',
        NO_PRICE: 'Cannot create listing packet: no price available',
        RESEARCH: `Cannot create listing packet: marked for research\n${packet.reason || ''}`
      };
      alert(messages[packet.error] || 'Cannot create listing packet');
      return;
    }

    saveListingPacket(item.id, channel, packet);
    setPacketEditTitle(packet.title);
    setPacketEditDesc(packet.description);
    setPacketEditPrice(packet.price.toFixed(2));
    setPacketModal({ channel, packet });
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      alert(`${label} copied to clipboard!`);
    }).catch(() => {
      alert('Failed to copy to clipboard');
    });
  };

  const handleRefresh = async () => {
    if (!onRefreshMarket) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefreshMarket(item);
    } catch (err) {
      setRefreshError(err.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleReIdentify = async () => {
    if (!onReIdentify) return;
    const confirmed = window.confirm(
      "Re-scanning will update title, variant, grade, and pricing from the stored image. Continue?"
    );
    if (!confirmed) return;
    setReIdentifying(true);
    setReIdentifyError(null);
    try {
      await onReIdentify(item);
    } catch (err) {
      setReIdentifyError(err.message || "Re-identify failed");
    } finally {
      setReIdentifying(false);
    }
  };

  const handleAddPhotoClick = () => {
    if (!canAddMore || addingPhoto) return;
    addPhotoRef.current?.click();
  };

  const handleAddPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (addPhotoRef.current) addPhotoRef.current.value = "";
    if (!file || !onAddPhoto) return;
    setAddingPhoto(true);
    setAddPhotoError(null);
    try {
      await onAddPhoto(item, file);
    } catch (err) {
      setAddPhotoError(err.message || "Failed to add photo");
    } finally {
      setAddingPhoto(false);
    }
  };

  const handleSync = async () => {
    if (!onSyncEbay) return;
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(null);
    try {
      const result = await onSyncEbay(item);
      if (result.status === "sold") {
        setSyncSuccess(`Sold for $${result.soldPrice?.toFixed(2) || "?"}`);
      } else if (result.status === "ended") {
        setSyncSuccess("Listing ended (not sold)");
      } else {
        setSyncSuccess("Still active on eBay");
      }
    } catch (err) {
      setSyncError(err.message || "Failed to sync status");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className="detail-view"
      onTouchStart={e => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchStartT.current = Date.now();
      }}
      onTouchEnd={e => {
        if (touchStartX.current === null) return;
        const dx = touchStartX.current - e.changedTouches[0].clientX;
        const dy = touchStartY.current - e.changedTouches[0].clientY;
        const dt = Date.now() - (touchStartT.current || 0);
        touchStartX.current = null;
        touchStartY.current = null;
        touchStartT.current = null;
        if (dt > 500) return;
        if (Math.abs(dx) < 50) return;
        if (Math.abs(dx) <= Math.abs(dy)) return;
        if (dx > 0) { onNext && onNext(); }
        else { onPrev && onPrev(); }
      }}
    >
      {swipeHint && totalItems > 1 && (
        <div style={{ textAlign: "center", fontSize: 11, color: "rgba(212,175,55,0.6)", marginBottom: 4, transition: "opacity 0.5s", animation: "fadeOut 2s forwards" }}>
          ← swipe to navigate →
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <button className="back-btn" onClick={onBack} style={{ margin: 0 }}>← Back</button>
        {totalItems > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onPrev}
              disabled={currentIndex <= 0}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: currentIndex <= 0 ? "#555" : "#d4af37", cursor: currentIndex <= 0 ? "default" : "pointer", padding: "4px 10px", fontSize: 14, fontWeight: 700 }}
            >←</button>
            <span className="muted small">{currentIndex + 1} of {totalItems}</span>
            <button
              onClick={onNext}
              disabled={currentIndex >= totalItems - 1}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: currentIndex >= totalItems - 1 ? "#555" : "#d4af37", cursor: currentIndex >= totalItems - 1 ? "default" : "pointer", padding: "4px 10px", fontSize: 14, fontWeight: 700 }}
            >→</button>
          </div>
        )}
      </div>

      {/* 1. PHOTO STRIP */}
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          padding: "4px 0 12px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {photos.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            onClick={() => setExpandedPhoto(src)}
            style={{
              height: 120,
              width: "auto",
              flexShrink: 0,
              borderRadius: 8,
              objectFit: "cover",
              cursor: "pointer",
              border: "1px solid rgba(212,175,55,0.3)",
            }}
          />
        ))}
        {(() => {
          const PHOTO_LABELS = ['Front', 'Back', 'Spine', 'Pages'];
          const missing = PHOTO_LABELS.slice(Math.min(photos.length, 4));
          if (missing.length === 0) return null;
          return missing.map((label) => (
            <button
              key={label}
              onClick={handleAddPhotoClick}
              disabled={addingPhoto}
              style={{
                height: 120,
                minWidth: 80,
                width: 80,
                flexShrink: 0,
                border: "2px dashed rgba(212,175,55,0.5)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                color: "#d4af37",
                fontSize: 11,
                fontWeight: 600,
                cursor: addingPhoto ? "wait" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: 6,
              }}
            >
              {addingPhoto ? (
                <div style={{ width: 20, height: 20, border: "2px solid rgba(212,175,55,0.3)", borderTopColor: "#d4af37", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              ) : (
                <>
                  <span style={{ fontSize: 20, lineHeight: 1, opacity: 0.6 }}>{"\uD83D\uDCF7"}</span>
                  <span>{label}</span>
                </>
              )}
            </button>
          ));
        })()}
        <input
          ref={addPhotoRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleAddPhotoChange}
          hidden
        />
      </div>
      {addPhotoError && (
        <div className="error-text small" style={{ marginBottom: 10 }}>
          {addPhotoError}
        </div>
      )}

      {/* Fullscreen photo overlay */}
      {expandedPhoto && (
        <div
          onClick={() => setExpandedPhoto(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            cursor: "pointer",
          }}
        >
          <img
            src={expandedPhoto}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      )}

      {/* Ship #21 — VERIFIED BADGE */}
      {(() => {
        const check = item.claudeCheck;
        if (!check) return null;

        const verified = check.verified;
        const hasFlags = check.flags && check.flags.length > 0;
        const lowConfidence = item.identityConfident === false;

        const badge = lowConfidence ? {
          icon: '❓',
          label: 'UNCONFIRMED',
          color: '#888',
          bg: 'rgba(136,136,136,0.1)',
          border: 'rgba(136,136,136,0.3)'
        } : hasFlags ? {
          icon: '⚠️',
          label: 'NEEDS REVIEW',
          color: '#fbbf24',
          bg: 'rgba(251,191,36,0.1)',
          border: 'rgba(251,191,36,0.3)'
        } : verified ? {
          icon: '✅',
          label: 'VERIFIED',
          color: '#22c55e',
          bg: 'rgba(34,197,94,0.1)',
          border: 'rgba(34,197,94,0.3)'
        } : {
          icon: '⚠️',
          label: 'NEEDS REVIEW',
          color: '#fbbf24',
          bg: 'rgba(251,191,36,0.1)',
          border: 'rgba(251,191,36,0.3)'
        };

        return (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            color: badge.color,
            marginBottom: 8,
            letterSpacing: 0.5
          }}>
            <span>{badge.icon}</span>
            <span>{badge.label}</span>
            {hasFlags && <span style={{ fontSize: 9 }}>({check.flags.length})</span>}
          </div>
        );
      })()}

      {/* Ship #27 WIN 3 — Authentication Score + Identity Source + Pricing Source */}
      <div style={{ fontSize: 11, marginTop: 6, marginBottom: 6 }}>
        {/* Authentication Score */}
        {item.identityAlignment?.authenticationScore != null && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#888' }}>Auth: </span>
            <strong style={{
              color: item.identityAlignment.authenticationScore >= 85 ? '#22c55e' :
                     item.identityAlignment.authenticationScore >= 65 ? '#fbbf24' : '#e05656'
            }}>
              {item.identityAlignment.authenticationScore}%
            </strong>
          </div>
        )}

        {/* Identity Source */}
        {item.identityAlignment?.confirmedSource && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#888' }}>ID: </span>
            <strong>
              {item.identityAlignment.confirmedSource === 'ebay_visual_override' ? 'eBay image search' :
               item.identityAlignment.confirmedSource === 'vision+text' ? 'Vision + text sources' :
               item.identityAlignment.confirmedSource === 'vision_only' ? 'Vision' :
               item.identityAlignment.confirmedSource}
            </strong>
          </div>
        )}

        {/* Pricing Source */}
        {item.pricingSource && (
          <div>
            <span style={{ color: '#888' }}>Price from: </span>
            <strong>
              {/* Ship 17 — Complete pricingSource label mapping. Previously missing
                 mappings displayed raw backend slugs in UI ("refused-claude-gate",
                 "verified_sold", "ebay-polybag-active", etc.). Production cards
                 showed technical strings instead of human labels for any source
                 not explicitly mapped. Also fixes typo: backend emits 'verified_sold'
                 but old code checked for 'sold_verified' (never fired). */}
              {item.pricingSource === 'gocollect_fmv' ? 'GoCollect FMV' :
               item.pricingSource === 'verified_sold' ? 'sold comps (verified)' :
               item.pricingSource === 'verified_active' ? 'active comps (verified)' :
               item.pricingSource === 'pricecharting' ? 'PriceCharting' :
               item.pricingSource === 'browse_api' ? 'active listings' :
               item.pricingSource === 'ebay-polybag-active' ? 'polybag comps' :
               item.pricingSource === 'visual_pool_fallback' ? 'image search fallback' :
               item.pricingSource === 'sanity' ? 'sanity fallback' :
               item.pricingSource === 'refused-identity-conflict' ? 'visual identification uncertain' :
               item.pricingSource === 'refused-claude-gate' ? 'verification failed' :
               item.pricingSource === 'refused-reprint-thin-pool' ? 'reprint (insufficient data)' :
               item.pricingSource === 'identity-required' ? 'identity required' :
               item.pricingSource === 'refused-no-data-sources' ? 'no data available' :
               item.pricingSource === 'refused-qualified-label' ? 'qualified/restored label — comps not applicable' :
               item.pricingSource === 'refused-polybag-pc-divergence' ? 'reprint pool conflicts with anchor' :
               item.pricingSource === 'thin_pool_anchor' ? 'active listings (thin pool, capped)' :
               item.pricingSource === 'refused' ? 'insufficient data' :
               item.pricingSource}
            </strong>
            {item.gradeMultiplier != null && item.gradeMultiplier !== 1 && (
              <span style={{ color: '#888' }}>
                {' '}· ×{item.gradeMultiplier.toFixed(2)} {item.isGraded ? 'CGC' : 'raw'} {item.grade}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. TITLE BLOCK */}
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
        {item.title || "Unknown"}{item.issue && !/unknown/i.test(String(item.issue)) && !String(item.title || "").includes('#' + item.issue) ? ` #${item.issue}` : ''}
      </div>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {item.publisher}
        {item.publisher && item.year ? " · " : ""}
        {item.year}
        {item.grade && ` · ${gradeBadgeText}`}
      </div>

      {/* Ship #21f: Identity provenance line (Rule 21-0: always render post-Phase-1) */}
      {(() => {
        const identitySource = item.identityAlignment?.confirmedSource || item.identitySource || 'vision';
        const assetWarning = item.assetType === 'book' ? '⚠ book detected' : '✓ comic confirmed';
        const soldDiag = item.soldCompDiagnostics;
        const filterSummary = soldDiag ? (() => {
          const reasons = soldDiag.reasons || {};
          const total = soldDiag.rawCount || 0;
          const verified = soldDiag.verifiedCount || 0;
          if (total === 0) return null;
          const topReasons = Object.entries(reasons)
            .filter(([_, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([reason, count]) => `${count} ${reason}`)
            .join(', ');
          return `${total}→${verified} verified${topReasons ? ` (${topReasons})` : ''}`;
        })() : null;

        return (
          <div style={{
            fontSize: 10,
            color: '#888',
            marginBottom: 8,
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 4,
            borderLeft: '2px solid rgba(212,175,55,0.3)'
          }}>
            📋 Identity: {identitySource} | {assetWarning}
            {filterSummary && ` | ${filterSummary}`}
          </div>
        );
      })()}

      {/* Ship #21h: Data freshness line (Rule 21-0: render when timestamps available) */}
      {(() => {
        const compsAge = item.compsCachedAt
          ? Math.floor((Date.now() - item.compsCachedAt) / 3600000)
          : null;
        const soldRecency = item.soldComps?.[0]?.daysAgo;

        if (compsAge === null && soldRecency === null) {
          return (
            <div style={{
              fontSize: 10,
              color: '#888',
              marginBottom: 8,
              opacity: 0.6
            }}>
              📅 Cache age unavailable
            </div>
          );
        }

        return (
          <div style={{
            fontSize: 10,
            color: '#888',
            marginBottom: 8,
            opacity: 0.7
          }}>
            📅
            {compsAge !== null && ` Comps: ${compsAge}h`}
            {soldRecency != null && ` · Sold data: ${soldRecency}d recency`}
            {compsAge === null && soldRecency != null && ` Sold data: ${soldRecency}d recency`}
          </div>
        );
      })()}

      {/* 2a. DECISION CARD — Decision-first layout */}
      {item.decision?.action && (() => {
        const colors = getActionColor(item.decision);
        const marketSignal = getMarketSignal(item);
        const displayPrice = getDisplayPrice(item);

        return (
          <div style={{
            marginBottom: 16,
            padding: "14px",
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
          }}>
            {/* Action + Confidence + Market Signal */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              flexWrap: "wrap"
            }}>
              <span className={`pill-decision-${item.decision.action.toLowerCase().replace(/_/g, '-')}`}
                style={{
                  background: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '6px 12px',
                  letterSpacing: 0.5
                }}>
                {item.decision.action.replace(/_/g, ' ')}
              </span>
              {item.decision.confidence && (
                <span style={{
                  fontSize: 10,
                  color: "#888",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  letterSpacing: 0.5
                }}>
                  {item.decision.confidence}
                </span>
              )}
              <div style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                fontWeight: 700,
                color: marketSignal.color,
                background: `${marketSignal.color}15`,
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${marketSignal.color}40`
              }}>
                <span>{marketSignal.icon}</span>
                <span>{marketSignal.badge}</span>
              </div>
            </div>

            {/* Recommended Price — Ship #24a-3: the hero number IS the
                contract price. The decision.price/displayPrice divergence
                (four-sources coherence bug, B3 P3-A) is dead for contract
                items: header == Recommended row == stats bar == List button. */}
            {(item.contract ? item.contract.price != null : (item.decision?.price != null || displayPrice > 0)) && (
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: colors.text, marginBottom: 4 }}>
                  {item.contract
                    ? formatCurrency(assertContractPrice(item, 'DecisionPanel.hero', item.contract.price))
                    : item.decision?.price != null
                      ? (typeof item.decision.price === 'number'
                        ? `$${Number(item.decision.price).toFixed(2)}`
                        : (String(item.decision.price).startsWith('$') ? item.decision.price : `$${item.decision.price}`))
                      : `$${Number(displayPrice).toFixed(2)}`}
                </div>
                {/* P0-D: Show when price was last updated */}
                {item.priceUpdatedAt && (
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                    Updated {formatTimeAgo(item.priceUpdatedAt)}
                  </div>
                )}
              </div>
            )}

            {/* Reason */}
            {item.decision?.reason && (
              <div style={{ fontSize: 13, color: "#ccc", marginBottom: 8, lineHeight: 1.5 }}>
                {item.decision.reason}
              </div>
            )}

            {/* Blockers */}
            {item.decision?.blockers && item.decision.blockers.length > 0 && (
              <div style={{
                fontSize: 11,
                color: "#fca5a5",
                background: "rgba(239,68,68,0.15)",
                padding: "6px 10px",
                borderRadius: 6,
                marginBottom: 6,
                fontWeight: 600
              }}>
                🚫 {item.decision.blockers.map(b => typeof b === 'string' ? b : (b?.message || b?.type || String(b))).join(', ')}
              </div>
            )}

            {/* Warnings */}
            {item.decision?.warnings && item.decision.warnings.length > 0 && (
              <div style={{
                fontSize: 11,
                color: "#fde68a",
                background: "rgba(251,191,36,0.15)",
                padding: "6px 10px",
                borderRadius: 6,
                marginBottom: 6,
                fontWeight: 600
              }}>
                ⚠️ {item.decision.warnings.map(w => typeof w === 'string' ? w : (w?.message || w?.type || String(w))).join(', ')}
              </div>
            )}

            {/* Next Step */}
            {item.decision?.nextStep && (
              <div style={{ fontSize: 11, color: "#888", marginTop: 8, fontStyle: "italic" }}>
                → {item.decision.nextStep}
              </div>
            )}
          </div>
        );
      })()}

      {/* 2a-1. ENRICHED DATA SECTIONS */}
      {/* Creator Credits */}
      {item.creatorFromComps && item.creatorFromComps.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 4 }}>
          <div
            onClick={() => setCreatorsExpanded(!creatorsExpanded)}
            style={{
              cursor: 'pointer',
              fontSize: 11,
              color: '#888',
              fontWeight: 600,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>{creatorsExpanded ? '▼' : '▶'}</span>
            {/* 21b-fix: Count valid creators only (filter nulls). Hide count when all null (NO-DATA state). */}
            {(() => {
              const validCount = item.creatorFromComps.filter(c => c.name).length;
              return validCount > 0
                ? <span>CREATOR CREDITS ({validCount})</span>
                : <span>CREATOR CREDITS</span>;
            })()}
          </div>
          {creatorsExpanded && (
            <div style={{
              marginTop: 6,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 6,
              fontSize: 13
            }}>
              {/* Ship #21b: Filter null names per Rule 21-0 (no blank sections). When all names null, show "Creator not detected". */}
              {item.creatorFromComps.filter(c => c.name).length > 0 ? (
                item.creatorFromComps.filter(c => c.name).map((creator, idx) => (
                  <div key={idx} style={{ marginBottom: idx < item.creatorFromComps.filter(c => c.name).length - 1 ? 4 : 0 }}>
                    <strong>{creator.name}</strong>
                    {creator.role && <span style={{ color: '#888', marginLeft: 6 }}>({creator.role})</span>}
                  </div>
                ))
              ) : (
                <div style={{ color: '#888', fontSize: 11, opacity: 0.7 }}>
                  Creator not detected
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sales Velocity */}
      {item.salesVelocity && (item.salesVelocity['90d'] > 0 || item.salesVelocity['30d'] > 0 || item.salesVelocity['7d'] > 0) && (
        <div style={{ marginTop: 8, marginBottom: 4 }}>
          <div
            onClick={() => setVelocityExpanded(!velocityExpanded)}
            style={{
              cursor: 'pointer',
              fontSize: 11,
              color: '#888',
              fontWeight: 600,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>{velocityExpanded ? '▼' : '▶'}</span>
            <span>SALES VELOCITY</span>
          </div>
          {velocityExpanded && (
            <div style={{
              marginTop: 6,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 6,
              fontSize: 13,
              display: 'flex',
              gap: 12
            }}>
              {item.salesVelocity['90d'] != null && (
                <span><strong>{item.salesVelocity['90d']}</strong> <span style={{ color: '#888' }}>90d</span></span>
              )}
              {item.salesVelocity['30d'] != null && (
                <span><strong>{item.salesVelocity['30d']}</strong> <span style={{ color: '#888' }}>30d</span></span>
              )}
              {item.salesVelocity['7d'] != null && (
                <span><strong>{item.salesVelocity['7d']}</strong> <span style={{ color: '#888' }}>7d</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Price Ladder */}
      {item.priceLadder && Object.keys(item.priceLadder).length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 4 }}>
          <div
            onClick={() => setLadderExpanded(!ladderExpanded)}
            style={{
              cursor: 'pointer',
              fontSize: 11,
              color: '#888',
              fontWeight: 600,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>{ladderExpanded ? '▼' : '▶'}</span>
            <span>PRICE LADDER ({Object.keys(item.priceLadder).length} grades)</span>
          </div>
          {ladderExpanded && (() => {
            // Ship #21k: Preserve literal grade strings ("raw", "9.8", etc.) — parseFloat("raw") = NaN
            const entries = Object.entries(item.priceLadder)
              .map(([gradeStr, price]) => ({
                gradeStr,
                gradeNum: parseFloat(gradeStr),
                price: parseFloat(price)
              }));

            // Ship #21g: Detect inversions (numeric grades only, skip NaN "raw")
            const numericEntries = entries
              .filter(e => !isNaN(e.gradeNum))
              .sort((a, b) => a.gradeNum - b.gradeNum);

            const inversions = new Set();
            for (let i = 1; i < numericEntries.length; i++) {
              if (numericEntries[i].price < numericEntries[i-1].price) {
                inversions.add(numericEntries[i].gradeNum);
              }
            }

            // Sort for display: numeric descending, then "raw" last
            const sortedEntries = entries.sort((a, b) => {
              if (isNaN(a.gradeNum)) return 1;  // "raw" to end
              if (isNaN(b.gradeNum)) return -1;
              return b.gradeNum - a.gradeNum;   // numeric descending
            });

            return (
              <div style={{
                marginTop: 6,
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 6,
                fontSize: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 6
              }}>
                {sortedEntries.map(({ gradeStr, gradeNum, price }) => (
                  <div key={gradeStr}>
                    <span style={{ color: '#888' }}>{gradeStr}</span>
                    <span style={{ marginLeft: 6, fontWeight: 600 }}>
                      {formatCurrency(price)}
                    </span>
                    {!isNaN(gradeNum) && inversions.has(gradeNum) && (
                      <span style={{
                        marginLeft: 4,
                        fontSize: 10,
                        color: '#f59e0b',
                        opacity: 0.8
                      }}>
                        ⚠ thin data
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* CGC Population */}
      {item.pop && item.pop.total > 0 && (
        <div style={{ marginTop: 8, marginBottom: 4 }}>
          <div
            onClick={() => setPopExpanded(!popExpanded)}
            style={{
              cursor: 'pointer',
              fontSize: 11,
              color: '#888',
              fontWeight: 600,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>{popExpanded ? '▼' : '▶'}</span>
            <span>CGC POPULATION (Total: {item.pop.total.toLocaleString('en-US')})</span>
          </div>
          {popExpanded && (
            <div style={{
              marginTop: 6,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 6,
              fontSize: 12
            }}>
              {/* Ship #21a: PC-tracked pop structure (cgc array + byGrade) doesn't have
                  CGC API fields (universal/qualified/restored/signature). Render byGrade
                  breakdown or link to histogram below per Rule 21-0 (no blank sections). */}
              {item.pop.universal != null ? (
                <>
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: '#888' }}>Universal:</span>
                    <span style={{ marginLeft: 6, fontWeight: 600 }}>{item.pop.universal.toLocaleString('en-US')}</span>
                  </div>
                  {item.pop.graded != null && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: '#888' }}>Qualified:</span>
                      <span style={{ marginLeft: 6, fontWeight: 600 }}>{item.pop.graded.toLocaleString('en-US')}</span>
                    </div>
                  )}
                  {item.pop.restored != null && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: '#888' }}>Restored:</span>
                      <span style={{ marginLeft: 6, fontWeight: 600 }}>{item.pop.restored.toLocaleString('en-US')}</span>
                    </div>
                  )}
                  {item.pop.signature != null && (
                    <div>
                      <span style={{ color: '#888' }}>Signature:</span>
                      <span style={{ marginLeft: 6, fontWeight: 600 }}>{item.pop.signature.toLocaleString('en-US')}</span>
                    </div>
                  )}
                </>
              ) : item.pop.byGrade && Object.keys(item.pop.byGrade).length > 0 ? (
                <div style={{ color: '#aaa', fontSize: 11 }}>
                  📊 PC-tracked census — see histogram below for grade distribution
                </div>
              ) : (
                <div style={{ color: '#888', fontSize: 11, opacity: 0.7 }}>
                  No CGC census data available
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ship #24a-3 — contract state banner (Amendment B): REFUSED /
          LOCKED / INCOMPLETE render locks[0].reason verbatim on the card. */}
      {item.contract &&
        ['REFUSED', 'LOCKED', 'INCOMPLETE'].includes(item.contract.state) && (
        <div
          style={{
            marginTop: 8,
            marginBottom: 4,
            padding: "10px 12px",
            borderRadius: 8,
            border: item.contract.state === 'REFUSED'
              ? "1px solid rgba(239,68,68,0.5)"
              : "1px solid rgba(245,158,11,0.5)",
            background: item.contract.state === 'REFUSED'
              ? "rgba(239,68,68,0.08)"
              : "rgba(245,158,11,0.08)",
            color: item.contract.state === 'REFUSED' ? "#ef4444" : "#f59e0b",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {item.contract.state === 'REFUSED' ? '⛔ CANNOT PRICE' : '🔒 LISTING LOCKED'}
          <div style={{ fontWeight: 400, marginTop: 4, opacity: 0.9 }}>
            {item.contract.locks?.[0]?.reason || 'Review before listing'}
          </div>
        </div>
      )}

      {/* 2a. STATS BAR */}
      {(() => {
        const lastSoldPrice = item.soldComps?.[0]?.price || item.comps?.recentSales?.[0]?.price || null;
        const lastSoldLabel = lastSoldPrice ? '$' + Math.round(lastSoldPrice) : null;
        const activeLoNum = item.comps?.lowestNum;
        const activeHiNum = item.comps?.highestNum;
        const activeAvgNum = item.comps?.averageNum;
        const activeLow = activeLoNum ? '$' + Math.round(activeLoNum) : null;
        const activeHigh = activeHiNum ? '$' + Math.round(activeHiNum) : null;
        const activeRange = activeLow && activeHigh ? activeLow + '\u2013' + activeHigh : (activeAvgNum ? '$' + Math.round(activeAvgNum) : null);
        const dp = assertContractPrice(item, 'StatsBar', getDisplayPrice(item));
        return (
          <div style={{ fontSize: 12, color: '#888', marginTop: 4, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 12, color: '#d4af37', fontWeight: 600 }}>{item.grade || 'RAW'}</span>
            {(item.manualReviewRequired || item.gradeExceedsMap) ? (
              <span style={{ color: '#d17105', fontWeight: 600 }}>Appraise</span>
            ) : item.megaKeyFloorApplied ? (
              <>
                {dp > 0 && <span>${dp.toLocaleString('en-US')}</span>}
                {(() => {
                  const lo = item.priceLow ? String(item.priceLow).replace(/\.00$/, '') : null;
                  const hi = item.priceHigh ? String(item.priceHigh).replace(/\.00$/, '') : null;
                  if (!lo) return null;
                  return (
                    <span>· {(!hi || lo === hi) ? `Floor ${lo}` : `Floor band ${lo}–${hi}`}</span>
                  );
                })()}
              </>
            ) : (
              <>
                {dp > 0 && <span>${dp.toLocaleString('en-US')}</span>}
                {lastSoldLabel && <span>· Last sold {lastSoldLabel}</span>}
                {activeRange && <span>· Asking {activeRange}</span>}
              </>
            )}
          </div>
        );
      })()}

      {/* Ship #20a.6.22 — Graceful degradation: enrichFailed warning */}
      {item.enrichFailed && (
        <div
          style={{
            background: "rgba(255,193,7,0.15)",
            border: "1px solid rgba(255,193,7,0.3)",
            borderRadius: 6,
            padding: 8,
            marginTop: 8,
            marginBottom: 8,
            fontSize: 12,
            color: "#ffc107",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ AI estimate only — market data unavailable</div>
          <div style={{ opacity: 0.9, fontSize: 11 }}>
            {item.enrichError || "Unable to fetch pricing data. Refresh to retry."}
          </div>
        </div>
      )}

      {/* 2b. PURCHASE PRICE + ROI */}
      <div style={{ marginTop: 10 }}>
        <input
          type="text"
          inputMode="decimal"
          placeholder="What did you pay? (optional)"
          value={ppInput}
          onChange={(e) => setPpInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.target.blur();
            }
          }}
          onBlur={() => {
            const val = parseFloat(ppInput.replace(/[$,]/g, ""));
            const newVal = !isNaN(val) && val > 0 ? val : null;
            if (newVal !== item.purchasePrice) {
              onUpdateField?.(item, "purchasePrice", newVal);
            }
          }}
          style={{
            width: "100%", padding: "8px 12px", boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6, color: "#fff", fontSize: 14, outline: "none",
          }}
        />
        {item.purchasePrice > 0 && displayPrice > 0 && (() => {
          const gain = displayPrice - item.purchasePrice;
          const pct = (gain / item.purchasePrice) * 100;
          const pos = gain >= 0;
          return (
            <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 14 }}>
              <span className="muted">Paid: <strong>{formatCurrency(item.purchasePrice)}</strong></span>
              <span className="muted">Current: <strong>{formatCurrency(displayPrice)}</strong></span>
              <span style={{ fontWeight: 700, color: pos ? "#16a34a" : "#e05656" }}>
                ROI: {pos ? "+" : ""}{fmt(gain)} ({pos ? "+" : ""}{Math.round(pct)}%)
              </span>
            </div>
          );
        })()}
      </div>

      {/* 3. KEY ISSUE BLOCK */}
      {(() => {
        const keyText = displayKeyIssue(item);
        if (!keyText) return null;

        const isReprint = item.editionWarning?.detected === true || item.polybagDetected === true;

        return (
          <>
            <div className="key-box" style={{ marginTop: 12 }}>
              ⭐ {keyText}
            </div>
            {isReprint && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                background: "rgba(255,193,7,0.1)",
                border: "1px solid #ffc107",
                borderRadius: 6,
                fontSize: 12,
                color: "#856404",
                lineHeight: 1.4,
              }}>
                ⚠️ REPRINT/FACSIMILE — Not original first appearance. This is a modern reprint, facsimile, or polybag copy.
              </div>
            )}
          </>
        );
      })()}

      {/* Ship #21 — STORY & CREATORS from ComicVine */}
      {item.comicVine && (item.comicVine.description || item.comicVine.personCredits?.length > 0 || item.comicVine.characterCredits?.length > 0) && (
        <div style={{
          marginTop: 12,
          padding: "10px 12px",
          background: "rgba(59,130,246,0.06)",
          border: "1px solid rgba(59,130,246,0.15)",
          borderRadius: 8,
        }}>
          {/* Story */}
          {item.comicVine.description && (() => {
            const cleanText = item.comicVine.description.replace(/<[^>]+>/g, '');
            const needsTruncate = cleanText.length > 150;
            return (
              <div style={{ marginBottom: item.comicVine.personCredits?.length > 0 || item.comicVine.characterCredits?.length > 0 ? 8 : 0 }}>
                <div style={{ color: "#888", fontSize: 10, marginBottom: 4, letterSpacing: 0.5, fontWeight: 600 }}>STORY</div>
                <div style={{ fontSize: 12, lineHeight: 1.4, color: "#ccc" }}>
                  {/* Ship #21c: 3-line truncate + expand/collapse control per Rule 21-0 */}
                  <div style={{
                    ...(!storyExpanded && needsTruncate ? {
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    } : {})
                  }}>
                    {cleanText}
                  </div>
                  {needsTruncate && (
                    <span
                      onClick={() => setStoryExpanded(!storyExpanded)}
                      style={{
                        fontSize: 11,
                        color: '#3b82f6',
                        cursor: 'pointer',
                        marginTop: 4,
                        display: 'inline-block',
                        fontWeight: 500
                      }}
                    >
                      {storyExpanded ? '…less' : '…more'}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
          {/* Creators */}
          {item.comicVine.personCredits && item.comicVine.personCredits.length > 0 && (
            <div style={{ marginBottom: item.comicVine.characterCredits?.length > 0 ? 8 : 0 }}>
              <div style={{ color: "#888", fontSize: 10, marginBottom: 4, letterSpacing: 0.5, fontWeight: 600 }}>CREATORS</div>
              <div style={{ fontSize: 12, color: "#ccc" }}>
                {item.comicVine.personCredits.slice(0, 3).map((c, i) => (
                  <span key={i}>
                    {c.name}{c.role ? ` (${c.role})` : ''}
                    {i < Math.min(2, item.comicVine.personCredits.length - 1) && ', '}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Characters */}
          {item.comicVine.characterCredits && item.comicVine.characterCredits.length > 0 && (
            <div>
              <div style={{ color: "#888", fontSize: 10, marginBottom: 4, letterSpacing: 0.5, fontWeight: 600 }}>CHARACTERS</div>
              <div style={{ fontSize: 12, color: "#ccc" }}>
                {item.comicVine.characterCredits.slice(0, 5).join(', ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ship #22g: CONVERGENCE CARD (per-axis votes, three-state render, era-gate rejections) */}
      {item.convergence && (
        <div style={{
          marginTop: 8,
          padding: "10px 12px",
          background: item.convergence.tier === 'HIGH' ? "rgba(34,197,94,0.08)"
                   : item.convergence.tier === 'MEDIUM' ? "rgba(251,191,36,0.08)"
                   : "rgba(239,68,68,0.08)",
          border: `1px solid ${item.convergence.tier === 'HIGH' ? "rgba(34,197,94,0.2)"
                              : item.convergence.tier === 'MEDIUM' ? "rgba(251,191,36,0.2)"
                              : "rgba(239,68,68,0.2)"}`,
          borderRadius: 8,
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 8,
            color: item.convergence.tier === 'HIGH' ? "#22c55e"
                 : item.convergence.tier === 'MEDIUM' ? "#fbbf24"
                 : "#ef4444"
          }}>
            CONVERGENCE: {item.convergence.convergenceScore}% ({item.convergence.tier})
          </div>
          {Object.entries(item.convergence.axes || {}).map(([axis, result]) => (
            <div key={axis} style={{
              fontSize: 10,
              marginBottom: 6,
              paddingBottom: 6,
              borderBottom: "1px solid rgba(255,255,255,0.05)"
            }}>
              <div style={{
                fontWeight: 500,
                textTransform: 'uppercase',
                color: "#aaa",
                marginBottom: 3
              }}>
                {axis}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {result.votes?.map((vote, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: vote.agrees ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      border: `1px solid ${vote.agrees ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                      fontSize: 9,
                      color: vote.agrees ? "#22c55e" : "#ef4444"
                    }}
                  >
                    {vote.source.toUpperCase()}: {String(vote.value || '—').substring(0, 20)}
                    {vote.agrees ? ' ✓' : ' ✗'}
                  </div>
                ))}
              </div>
              {result.rejections?.length > 0 && (
                <div style={{
                  marginTop: 4,
                  fontSize: 9,
                  color: "#ef4444",
                  fontStyle: 'italic'
                }}>
                  Rejected: {result.rejections.map(r =>
                    `${r.source}="${String(r.got).substring(0, 15)}"`
                  ).join(', ')}
                </div>
              )}
            </div>
          ))}
          {item.tier0Locked && (
            <div style={{
              marginTop: 8,
              padding: "6px 8px",
              background: "rgba(239,68,68,0.2)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 4,
              fontSize: 10,
              color: "#ef4444",
              fontWeight: 600
            }}>
              ⚠️ TIER-0 LOCKED — Verify identity before listing
            </div>
          )}
        </div>
      )}

      {/* Ship #21j: DEMAND SIGNALS (dynamic from soldComps, Rule 21-0: NO-DATA when soldComps=0) */}
      {(() => {
        const soldComps = item.soldComps || [];

        if (soldComps.length === 0) {
          return (
            <div style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "rgba(168,85,247,0.06)",
              border: "1px solid rgba(168,85,247,0.15)",
              borderRadius: 8,
              fontSize: 11,
              color: "#888"
            }}>
              No sold data
            </div>
          );
        }

        // DEMAND: fresh sold count
        const freshSolds = soldComps.filter(s => s.recencyBand === 'fresh').length;
        const demand = freshSolds >= 15 ? 'HIGH' : freshSolds >= 5 ? 'MEDIUM' : 'LOW';

        // TREND: fresh vs stale avg delta
        const average = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const freshPrices = soldComps.filter(s => s.recencyBand === 'fresh').map(s => s.price);
        const stalePrices = soldComps.filter(s => s.recencyBand !== 'fresh').map(s => s.price);
        const freshAvg = average(freshPrices);
        const staleAvg = average(stalePrices);
        const trend = freshAvg > staleAvg * 1.2 ? 'Rising'
                    : freshAvg < staleAvg * 0.8 ? 'Falling'
                    : 'Flat';

        // SPEED: median days-between-solds
        const sortedByDays = [...soldComps].sort((a, b) => a.daysAgo - b.daysAgo);
        const gaps = sortedByDays.map((s, i, arr) =>
          i === 0 ? null : s.daysAgo - arr[i-1].daysAgo
        ).filter(g => g != null).sort((a, b) => a - b);
        const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 999;
        const speed = medianGap <= 7 ? 'Fast' : medianGap <= 30 ? 'Moderate' : 'Slow';

        return (
          <div style={{
            marginTop: 8,
            padding: "8px 12px",
            background: "rgba(168,85,247,0.06)",
            border: "1px solid rgba(168,85,247,0.15)",
            borderRadius: 8,
            display: "flex",
            gap: 12,
            fontSize: 11,
          }}>
            <div>
              <span style={{ color: "#888" }}>DEMAND:</span>{' '}
              <span style={{ fontWeight: 600, color: demand === 'HIGH' ? '#22c55e' : demand === 'MEDIUM' ? '#3b82f6' : '#888' }}>
                {demand === 'HIGH' ? '🔥 HIGH' : demand === 'MEDIUM' ? '➡️ MEDIUM' : '📉 LOW'}
              </span>
            </div>
            <div>
              <span style={{ color: "#888" }}>TREND:</span>{' '}
              <span style={{ fontWeight: 600 }}>
                {trend === 'Rising' ? '↑ Rising' : trend === 'Falling' ? '↓ Falling' : '→ Flat'}
              </span>
            </div>
            <div>
              <span style={{ color: "#888" }}>SPEED:</span>{' '}
              <span style={{ fontWeight: 600 }}>
                {speed === 'Fast' ? '⚡ Fast' : speed === 'Moderate' ? '➡️ Moderate' : '🐌 Slow'}
              </span>
            </div>
          </div>
        );
      })()}

      {/* 3a. Ship #12a + Ship #16 — DETECTED IN COMPS (keys + creators) */}
      {((Array.isArray(item.keyFromComps) && item.keyFromComps.length > 0) ||
        (Array.isArray(item.creatorFromComps) && item.creatorFromComps.length > 0)) && (
        <div style={{
          marginTop: 8,
          padding: "8px 14px",
          background: "rgba(240, 192, 64, 0.06)",
          border: "1px solid rgba(240, 192, 64, 0.18)",
          borderRadius: 12,
        }}>
          <div style={{ color: "#888", fontSize: 11, marginBottom: 4, letterSpacing: 0.5 }}>
            DETECTED IN COMPS
          </div>
          {Array.isArray(item.keyFromComps) && item.keyFromComps.map((entry, idx) => {
            const id = `key-${idx}`;
            return (
              <div key={id} style={{ marginBottom: 3 }}>
                <button
                  onClick={() => setExpandedKeyIdx(expandedKeyIdx === id ? null : id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--gold)",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                    width: "100%",
                  }}
                >
                  • {entry.phrase}{" "}
                  <span style={{ color: "#888", fontSize: 11 }}>
                    ({entry.hits} source{entry.hits === 1 ? "" : "s"}) {expandedKeyIdx === id ? "▲" : "▼"}
                  </span>
                </button>
                {expandedKeyIdx === id && Array.isArray(entry.sources) && (
                  <div style={{ paddingLeft: 12, marginTop: 4, fontSize: 11, color: "#aaa" }}>
                    {entry.sources.map((src, i) => (
                      <div key={i} style={{ marginBottom: 2 }}>— {src}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {Array.isArray(item.creatorFromComps) && item.creatorFromComps.length > 0 && (
            <>
              {Array.isArray(item.keyFromComps) && item.keyFromComps.length > 0 && (
                <div style={{ borderTop: "1px solid rgba(240,192,64,0.18)", margin: "6px 0" }} />
              )}
              <div style={{ color: "#888", fontSize: 11, marginBottom: 4, letterSpacing: 0.5 }}>
                CREATORS
              </div>
              {item.creatorFromComps.map((entry, idx) => {
                const id = `creator-${idx}`;
                const meta = [entry.role, entry.tier].filter(Boolean).join(", ");
                return (
                  <div key={id} style={{ marginBottom: 3 }}>
                    <button
                      onClick={() => setExpandedKeyIdx(expandedKeyIdx === id ? null : id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--gold)",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 13,
                        width: "100%",
                      }}
                    >
                      • {entry.canonical}{" "}
                      <span style={{ color: "#888", fontSize: 11 }}>
                        ({meta}, {entry.hits} source{entry.hits === 1 ? "" : "s"}) {expandedKeyIdx === id ? "▲" : "▼"}
                      </span>
                    </button>
                    {expandedKeyIdx === id && Array.isArray(entry.sources) && (
                      <div style={{ paddingLeft: 12, marginTop: 4, fontSize: 11, color: "#aaa" }}>
                        {entry.sources.map((src, i) => (
                          <div key={i} style={{ marginBottom: 2 }}>— {src}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {item.variant && (
        <div style={{ color: "#FFD700", fontSize: 13, marginTop: 4, fontWeight: "bold" }}>
          ⚡ {item.variant}
        </div>
      )}

      {/* 3b. RESTORATION WARNING */}
      {item.restoration && (
        <div style={{ background: "#ff000022", border: "1px solid #ff4444", borderRadius: 6, padding: "8px 12px", marginTop: 8, color: "#ff6666" }}>
          ⚠️ RESTORED: {item.restoration}
        </div>
      )}

      {/* 4. AI CONDITION REPORT */}
      {(conditionBullets.length > 0 || confidenceText || scannedText || item.cgcPenaltyFlags) && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 8,
            background: "rgba(212,175,55,0.05)",
          }}
        >
          <div
            className="muted small"
            style={{
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            AI Condition Report
          </div>
          {conditionBullets.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {conditionBullets.map((b, i) => (
                <li
                  key={i}
                  style={{
                    padding: "4px 0",
                    fontSize: 14,
                    color: b.concern ? "#f59e0b" : "#5cb85c",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{b.concern ? "⚠️" : "✅"}</span>
                  <span style={{ color: "inherit" }}>{b.text}</span>
                </li>
              ))}
            </ul>
          )}
          {item.cgcPenaltyFlags && (() => {
            const f = item.cgcPenaltyFlags;
            const advisoryStyle = (color) => ({
              padding: "4px 0",
              fontSize: 14,
              color,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            });
            const positive = "#d4af37";   // gold (pedigree premium)
            const warn = "#f59e0b";       // amber (store stamp)
            const severe = "#ef4444";     // red (staple, chips)
            const info = "#06b6d4";       // cyan (polybag, pressable)
            const lis = [];
            if (f.pedigreeStamp?.detected && f.pedigreeStamp.canonical) {
              lis.push(
                <li key="ped" style={advisoryStyle(positive)}>
                  <span style={{ flexShrink: 0 }}>🏆</span>
                  <span>Pedigree: {f.pedigreeStamp.canonical} — adds collector premium</span>
                </li>
              );
            } else if (f.pedigreeStamp?.detected && f.pedigreeStamp.pedigreeName && f.pedigreeStamp.recognized === false) {
              lis.push(
                <li key="ped-unrec" style={advisoryStyle(warn)}>
                  <span style={{ flexShrink: 0 }}>⚠️</span>
                  <span>Pedigree claimed: "{f.pedigreeStamp.pedigreeName}" — unrecognized, verify manually</span>
                </li>
              );
            }
            if (f.storeStamp?.detected) {
              lis.push(
                <li key="stamp" style={advisoryStyle(warn)}>
                  <span style={{ flexShrink: 0 }}>⚠️</span>
                  <span>Store stamp detected — CGC may dock ~1.3 grades</span>
                </li>
              );
            }
            if (f.staplePopping?.detected) {
              lis.push(
                <li key="staple" style={advisoryStyle(severe)}>
                  <span style={{ flexShrink: 0 }}>🚨</span>
                  <span>
                    Staple popping{f.staplePopping.severity ? ` (${f.staplePopping.severity})` : ""} —
                    structural damage, grade typically capped (not pressable)
                  </span>
                </li>
              );
            }
            if (f.polybagIndents?.detected) {
              lis.push(
                <li key="polybag" style={advisoryStyle(info)}>
                  <span style={{ flexShrink: 0 }}>✨</span>
                  <span>Polybag indents — pressing recommended</span>
                </li>
              );
            }
            if (f.cornerChips?.detected) {
              lis.push(
                <li key="chips" style={advisoryStyle(severe)}>
                  <span style={{ flexShrink: 0 }}>🚨</span>
                  <span>
                    Corner chips
                    {f.cornerChips.count ? ` (${f.cornerChips.count} corner${f.cornerChips.count === 1 ? "" : "s"})` : ""} —
                    CGC may dock up to 4 grades
                  </span>
                </li>
              );
            }
            if (lis.length === 0) return null;
            return (
              <ul style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                marginTop: conditionBullets.length > 0 ? 6 : 0,
                paddingTop: conditionBullets.length > 0 ? 6 : 0,
                borderTop: conditionBullets.length > 0 ? "1px solid rgba(212,175,55,0.15)" : "none",
              }}>
                {lis}
              </ul>
            );
          })()}
          {(confidenceText || scannedText) && (() => {
            const hasAnyAdvisory =
              conditionBullets.length > 0 ||
              (item.cgcPenaltyFlags && (
                item.cgcPenaltyFlags.pedigreeStamp?.detected ||
                item.cgcPenaltyFlags.storeStamp?.detected ||
                item.cgcPenaltyFlags.staplePopping?.detected ||
                item.cgcPenaltyFlags.polybagIndents?.detected ||
                item.cgcPenaltyFlags.cornerChips?.detected
              ));
            return (
              <div
                className="muted small"
                style={{
                  marginTop: hasAnyAdvisory ? 10 : 0,
                  paddingTop: hasAnyAdvisory ? 8 : 0,
                  borderTop: hasAnyAdvisory ? "1px solid rgba(212,175,55,0.2)" : "none",
                }}
              >
                {confidenceText && <div>Confidence: {confidenceText}</div>}
                {scannedText && <div>Scanned: {scannedText}</div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* Ship #24 — AUTHENTICATION BADGE */}
      {item.identityAlignment?.authenticationScore != null && (
        <div style={{
          background:
            item.identityAlignment.authenticationScore >= 90
              ? '#d4edda'
              : item.identityAlignment.authenticationScore >= 60
                ? '#fff3cd'
                : '#f8d7da',
          border: `1px solid ${
            item.identityAlignment.authenticationScore >= 90
              ? '#28a745'
              : item.identityAlignment.authenticationScore >= 60
                ? '#ffc107'
                : '#dc3545'
          }`,
          borderRadius: '8px',
          padding: '12px',
          marginTop: '12px',
          fontSize: '13px',
        }}>
          <div style={{
            fontWeight: 700,
            marginBottom: item.identityAlignment.conflicts?.length > 0 ? 6 : 0,
            color:
              item.identityAlignment.authenticationScore >= 90
                ? '#155724'
                : item.identityAlignment.authenticationScore >= 60
                  ? '#856404'
                  : '#721c24'
          }}>
            {item.identityAlignment.authenticationScore >= 90 ? '🟢' :
             item.identityAlignment.authenticationScore >= 60 ? '🟡' : '🔴'}
            {' '}
            {item.identityAlignment.confidence} ({item.identityAlignment.authenticationScore}%)
          </div>
          {item.identityAlignment.breakdown && (
            <div style={{
              fontSize: '11px',
              opacity: 0.8,
              marginBottom: item.identityAlignment.conflicts?.length > 0 ? 6 : 0,
              fontFamily: 'monospace',
            }}>
              Title: {item.identityAlignment.breakdown.title}% ·
              Issue: {item.identityAlignment.breakdown.issue}% ·
              Year: {item.identityAlignment.breakdown.year}% ·
              Pub: {item.identityAlignment.breakdown.publisher}%
            </div>
          )}
          {item.identityAlignment.conflicts?.length > 0 && (
            <div style={{
              fontSize: '11px',
              color: '#721c24',
              background: 'rgba(220,53,69,0.1)',
              padding: '6px 8px',
              borderRadius: '4px',
              marginTop: 6,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Conflicts ({item.identityAlignment.conflicts.length}):
              </div>
              {item.identityAlignment.conflicts.slice(0, 3).map((c, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  • {c.field}: Vision={JSON.stringify(c.vision)} vs {Object.keys(c).filter(k => k !== 'field' && k !== 'vision').map(k => `${k}=${JSON.stringify(c[k])}`).join(', ')}
                </div>
              ))}
              {item.identityAlignment.conflicts.length > 3 && (
                <div style={{ opacity: 0.7, marginTop: 4 }}>
                  ...and {item.identityAlignment.conflicts.length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4b. PC-TRACKED CGC POP (Phase 5a.3) */}
      {item.pop && Array.isArray(item.pop.cgc) && item.pop.cgc.length === POP_GRADE_INDEX.length && (
        <div className="pop-panel">
          <div className="pop-header">PC-TRACKED CGC POP</div>
          {item.pop.total === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              No copies tracked yet — thin census signal.
            </div>
          ) : (
            <>
              <div className="pop-stats">
                <span>Tracked copies:</span>
                <span>{item.pop.total.toLocaleString("en-US")}</span>
                {item.pop.atGrade != null && item.pop.userBucket != null && (
                  <>
                    <span>At your grade ({item.pop.userBucket}):</span>
                    <span>
                      {item.pop.atGrade.toLocaleString("en-US")}
                      {item.pop.scarcityRatio != null && ` (${(item.pop.scarcityRatio * 100).toFixed(1)}%)`}
                    </span>
                  </>
                )}
                {item.pop.aboveGrade != null && (
                  <>
                    <span>Graded higher:</span>
                    <span>{item.pop.aboveGrade.toLocaleString("en-US")}</span>
                  </>
                )}
                {item.pop.belowGrade != null && (
                  <>
                    <span>Graded lower:</span>
                    <span>{item.pop.belowGrade.toLocaleString("en-US")}</span>
                  </>
                )}
              </div>
              <div className="pop-histogram">
                {item.pop.cgc.map((count, idx) => {
                  const grade = POP_GRADE_INDEX[idx];
                  const maxCount = Math.max(...item.pop.cgc, 1);
                  const heightPercent = (Number(count) / maxCount) * 100;
                  const isUserGrade = item.pop.userBucket === grade;
                  return (
                    <div key={idx} className="pop-bar-container">
                      <div
                        className={`pop-bar ${isUserGrade ? 'user-grade' : ''}`}
                        style={{ height: `${heightPercent}%` }}
                        title={`Grade ${grade}: ${Number(count).toLocaleString("en-US")} copies`}
                      />
                      <div className="pop-label">{grade}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="pop-footer">
            * PriceCharting tracks copies seen in market activity. Full CGC census may be higher for vintage books.
          </div>
        </div>
      )}

      {/* 5. PRICING BLOCK */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div className="muted small">Recommended list price</div>
            {item.identityConfident === false ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#ef4444", lineHeight: 1.15 }}>
                  Identification Required
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#fecaca", lineHeight: 1.4 }}>
                  {(() => {
                    // Non-comic detection: missing issue + title suggests book/toy/collectible
                    const isLikelyNonComic =
                      item.identityMissingFields?.includes('issue') &&
                      item.title &&
                      /\b(book|novel|paperback|hardcover|toy|figure|statue|bust|print|poster|art|sketch|original|painting|lithograph|magazine|guide|handbook|encyclopedia)\b/i.test(item.title);

                    if (isLikelyNonComic) {
                      return (
                        <>
                          📚 Book/Object detected — comic pricing disabled.
                          <div style={{ marginTop: 4, fontSize: 11, color: "#fca5a5" }}>
                            Scan ISBN/barcode or archive this item.
                          </div>
                        </>
                      );
                    }
                    return "Cannot price safely without verified title, issue, year, and publisher.";
                  })()}
                </div>
                {!(/\b(book|novel|paperback|hardcover|toy|figure|statue|bust|print|poster|art|sketch|original|painting|lithograph|magazine|guide|handbook|encyclopedia)\b/i.test(item.title || '') && item.identityMissingFields?.includes('issue')) && Array.isArray(item.identityMissingFields) && item.identityMissingFields.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#fca5a5" }}>
                    Missing: <span style={{ fontWeight: 700 }}>{item.identityMissingFields.join(", ")}</span>
                  </div>
                )}
                {Array.isArray(item.identityReasons) && item.identityReasons.length > 0 && (
                  <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 11, color: "#fecaca" }}>
                    {item.identityReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: "#aaa" }}>
                  Edit fields below or re-scan with indicia / back cover photo.
                </div>
              </>
            ) : (item.manualReviewRequired || item.gradeExceedsMap) ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#d17105", lineHeight: 1.15 }}>
                  Manual Appraisal Required
                </div>
                <button
                  onClick={() => setShowEngineRec((v) => !v)}
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "transparent",
                    border: "1px solid #555",
                    borderRadius: 4,
                    color: "#aaa",
                    cursor: "pointer",
                  }}
                >
                  {showEngineRec ? "Hide engine estimate ▲" : "Show engine estimate ▼"}
                </button>
                {showEngineRec && (
                  <div style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: "#aaa",
                    lineHeight: 1.4,
                  }}>
                    <div>Engine estimate: <span style={{ color: "#d4af37" }}>{recommendedLabel}</span></div>
                    <div style={{ marginTop: 2, color: "#d17105" }}>
                      ⚠ Engine cannot price this book accurately.{" "}
                      {item.manualReviewReason || item.gradeExceedsMapReason || "Verify via Heritage/GoCollect before listing."}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className="price"
                  style={{ fontSize: 28, fontWeight: 800, color: "#d4af37" }}
                >
                  {recommendedLabel}
                </div>
                {item.priceNote && (
                  <div style={{ color: "#aaa", fontSize: 12, marginTop: 4 }}>
                    {item.priceNote}
                  </div>
                )}
              </>
            )}
          </div>
          {(() => {
            // Pill precedence (highest to lowest):
            //   identityConfident:false → 🔍 ID REQUIRED (red, Ship #20a.6.4)
            //   manualReviewRequired    → 🔑 MANUAL REVIEW
            //   gradeExceedsMap         → 🔑 GRADE EXCEEDS MAP
            //   megaKeyFloorApplied     → 🔑 VERIFIED/ESTIMATED FLOOR
            const pillStyle = { fontSize: 11, padding: "4px 10px", borderRadius: 6, fontWeight: 700, alignSelf: "flex-end", marginBottom: 4 };
            if (item.identityConfident === false) {
              return (
                <span
                  className="pill"
                  title="Identification required to price safely"
                  style={{
                    ...pillStyle,
                    background: "rgba(239,68,68,0.15)",
                    color: "#fca5a5",
                    border: "1px solid rgba(239,68,68,0.6)",
                  }}
                >
                  🔍 ID REQUIRED
                </span>
              );
            }
            if (item.manualReviewRequired) {
              return (
                <span
                  className="pill pill-manual-review"
                  title={item.manualReviewReason || ""}
                  style={pillStyle}
                >
                  🔑 MANUAL REVIEW
                </span>
              );
            }
            if (item.gradeExceedsMap) {
              return (
                <span
                  className="pill pill-exceeds-map"
                  title={item.gradeExceedsMapReason || ""}
                  style={pillStyle}
                >
                  🔑 GRADE EXCEEDS MAP
                </span>
              );
            }
            if (item.megaKeyFloorApplied) {
              return (
                <span
                  className={`pill ${item.megaKeyFloorVerified ? "pill-mega-verified" : "pill-mega-estimated"}`}
                  title={item.megaKeyFloorNote || ""}
                  style={pillStyle}
                >
                  🔑 {item.megaKeyFloorVerified ? "VERIFIED FLOOR" : "ESTIMATED FLOOR"}
                </span>
              );
            }
            // Default: matchConfidence tier (for non-mega-key books).
            // Ship #24a-3 (Amendment A): the count-based recomputation is
            // DELETED for contract items — fallback maps contract.state
            // instead (conservative: ESTIMATED renders as Estimate).
            const mcTier = item.matchConfidence?.tier;
            const mcScore = item.matchConfidence?.score;
            const cc = item.comps?.count || 0;
            const sc = Array.isArray(item.soldComps) ? item.soldComps.length : 0;
            const hasPriceData = item?.pricingSource === "pricecharting";
            const level = mcTier
              || (item.contract
                ? (item.contract.state === 'PRICED' ? "MEDIUM" : "LOW")
                : (sc >= 2 ? "HIGH" : cc >= 2 ? "MEDIUM" : hasPriceData ? "MEDIUM" : "LOW"));
            const bg = level === "HIGH" ? "rgba(22,163,106,0.2)" : level === "MEDIUM" ? "rgba(212,175,55,0.2)" : "rgba(220,38,38,0.2)";
            const fg = level === "HIGH" ? "#16a34a" : level === "MEDIUM" ? "#d4af37" : "#dc2626";
            const label = level === "HIGH"
              ? `✓ Verified${mcScore != null ? ` ${mcScore}` : ""}`
              : level === "MEDIUM"
                ? `~ Similar${mcScore != null ? ` ${mcScore}` : ""}`
                : `⚠ Estimate${mcScore != null ? ` ${mcScore}` : ""}`;
            return (
              <span style={{ ...pillStyle, background: bg, color: fg }}>
                {label}
              </span>
            );
          })()}
        </div>

        {(item.matchConfidence?.tier === "LOW" || item.matchConfidence?.visionCapped) && !item.megaKeyFloorApplied && !item.manualReviewRequired && !item.gradeExceedsMap && (
          <div style={{
            marginTop: 10,
            padding: "10px 12px",
            border: "1px solid rgba(220,38,38,0.4)",
            borderRadius: 8,
            background: "rgba(220,38,38,0.08)",
            color: "#fca5a5",
            fontSize: 13,
            lineHeight: 1.4,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: "#dc2626" }}>
              ⚠ {item.matchConfidence.displayMessage || "Exact match not found — AI estimate"}
            </div>
            {item.matchConfidence?.visionCapped ? (
              <>
                AI identification uncertain — confirm book identity before listing.
                {item.matchConfidence.originalScore != null && (
                  <> Match score reduced from {item.matchConfidence.originalScore} to {item.matchConfidence.score} due to low Vision confidence.</>
                )}
              </>
            ) : (
              <>These are SIMILAR listings, not exact matches. Verify before listing.</>
            )}
          </div>
        )}

        {item.manualReviewRequired && (
          <div style={{
            marginTop: 10,
            padding: "12px 14px",
            border: "1px solid #da3633",
            borderRadius: 8,
            background: "rgba(218,54,51,0.08)",
            color: "#fca5a5",
            fontSize: 13,
            lineHeight: 1.45,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "#da3633" }}>
              🔑 Mega-key detected — manual review required
            </div>
            {item.manualReviewReason || "Price dispersion too wide for automated floor."}
            <div style={{ marginTop: 4, opacity: 0.8 }}>
              Verify manually via Heritage Auctions or GoCollect before listing.
            </div>
            {item.preFloorPrice && (
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                Engine rec shown for transparency: {item.preFloorPrice} (source: {item.preFloorSource || "—"})
              </div>
            )}
          </div>
        )}

        {item.gradeExceedsMap && !item.manualReviewRequired && (
          <div style={{
            marginTop: 10,
            padding: "12px 14px",
            border: "1px solid #d17105",
            borderRadius: 8,
            background: "rgba(209,113,5,0.08)",
            color: "#fde68a",
            fontSize: 13,
            lineHeight: 1.45,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "#d17105" }}>
              🔑 Grade exceeds floor map coverage
            </div>
            {item.gradeExceedsMapReason ||
              "This grade is above the highest bucket in our floor map for this book."}
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              The engine-computed price is not trustworthy for this grade.
              Verify via Heritage Auctions or GoCollect before listing.
            </div>
          </div>
        )}

        {item.megaKeyFloorApplied && !item.manualReviewRequired && !item.gradeExceedsMap && (
          <div style={{
            marginTop: 10,
            padding: "12px 14px",
            border: `1px solid ${item.megaKeyFloorVerified ? "#2ea043" : "#d29922"}`,
            borderRadius: 8,
            background: item.megaKeyFloorVerified
              ? "rgba(46,160,67,0.08)"
              : "rgba(210,153,34,0.08)",
            color: item.megaKeyFloorVerified ? "#86efac" : "#fde68a",
            fontSize: 13,
            lineHeight: 1.45,
          }}>
            <div style={{
              fontWeight: 700,
              marginBottom: 4,
              color: item.megaKeyFloorVerified ? "#2ea043" : "#d29922"
            }}>
              🔑 Mega-key floor {item.megaKeyFloorVerified ? "enforced" : "applied (estimated)"}
            </div>
            <div>Engine floor: <strong>{item.price}</strong></div>
            {item.preFloorPrice && (
              <div style={{ marginTop: 2, opacity: 0.85 }}>
                Pre-floor rec: {item.preFloorPrice}
                {item.preFloorSource && <> (source: {item.preFloorSource})</>}
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {item.megaKeyFloorVerified
                ? "Verified against Heritage/GoCollect sold archive."
                : "⚠ Estimated floor — verify against Heritage/GoCollect before listing."}
            </div>
            {item.megaKeyFloorNote && (
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8, fontStyle: "italic" }}>
                {item.megaKeyFloorNote}
              </div>
            )}
          </div>
        )}

        {item.compEraFilterBypassed && (
          <div style={{
            marginTop: 10,
            padding: "10px 12px",
            border: "1px solid rgba(210,153,34,0.4)",
            borderRadius: 8,
            background: "rgba(210,153,34,0.08)",
            color: "#fde68a",
            fontSize: 12,
            lineHeight: 1.4,
          }}>
            ⚠ Era filter bypassed — every comp failed year consistency check and was kept as fallback. Verify listings manually.
          </div>
        )}

        {hasComps && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(212,175,55,0.3)",
              borderRadius: 8,
              background: "rgba(212,175,55,0.05)",
            }}
          >
            {/* LAST SOLD section */}
            {Array.isArray(item.soldComps) && item.soldComps.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                  Last Sold
                  {(() => {
                    const newest = item.soldComps[0]?.daysAgo;
                    const recencyStr = newest == null ? null : newest === 0 ? "today" : newest === 1 ? "1d ago" : `${newest}d ago`;
                    // Ship #20a.6 — when raw count > verified, show "V of R verified".
                    // Ship #20a.6.1 — chip is clickable; expands rejected-samples drawer.
                    const diag = item.soldCompDiagnostics;
                    const hasRejected = diag && diag.rejectedCount > 0; // Ship #21d: check rejectedCount, not just samples
                    // Ship #24a-3 — contract.verifiedCount is the single source
                    const vCount = item.contract?.verifiedCount ?? diag?.verifiedCount ?? 0;
                    const showVerifiedRatio = diag && diag.rawCount > vCount && vCount > 0;
                    const verifiedStr = showVerifiedRatio
                      ? `${vCount} of ${diag.rawCount} sold verified`
                      : `${item.soldComps.length} sold`;
                    const onClick = hasRejected
                      ? (e) => { e.preventDefault(); e.stopPropagation(); setSoldDrawerOpen((v) => !v); }
                      : undefined;
                    return (
                      <span
                        onClick={onClick}
                        style={{
                          marginLeft: 6,
                          opacity: 0.7,
                          textTransform: "none",
                          letterSpacing: 0,
                          cursor: hasRejected ? "pointer" : "default",
                          userSelect: "none",
                        }}
                        title={hasRejected ? (soldDrawerOpen ? "Hide rejected" : "Show rejected") : undefined}
                      >
                        📊 {verifiedStr}{recencyStr ? ` · ${recencyStr}` : ""}{hasRejected ? (soldDrawerOpen ? " ▾" : " ▸") : ""}
                      </span>
                    );
                  })()}
                </div>
                {item.soldComps.slice(0, 3).map((s, i) => {
                  const mpStyle = (mp) => ({
                    marginLeft: 6, padding: "1px 5px", fontSize: 10, borderRadius: 3,
                    background: mp === "heritage" ? "rgba(212,175,55,0.15)" : "rgba(22,163,106,0.15)",
                    color: mp === "heritage" ? "#d4af37" : "#16a34a",
                    textTransform: "uppercase", letterSpacing: 0.5,
                  });
                  const rowStyle = { padding: "6px 0", fontSize: 14 };
                  const inner = (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="muted small">
                          {s.daysAgo != null ? (s.daysAgo === 0 ? "today" : s.daysAgo === 1 ? "yesterday" : `${s.daysAgo} days ago`) : s.date || "—"}
                          {s.marketplace && (
                            <span style={mpStyle(s.marketplace)}>
                              {s.marketplace === "heritage" ? "HRT" : "eBay"}
                            </span>
                          )}
                        </span>
                        <span style={{ fontWeight: 600, color: "#16a34a" }}>
                          {s.priceFormatted || fmtPrice(s.price)} <span style={{ fontSize: 11, opacity: 0.8 }}>SOLD</span>
                          {s.url && <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>}
                        </span>
                      </div>
                      {s.title && (
                        <div style={{ fontSize: 13, color: "#999", marginTop: 2, lineHeight: 1.3, wordBreak: "break-word" }}>
                          {s.title}
                        </div>
                      )}
                    </div>
                  );
                  return s.url ? (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>{inner}</a>
                  ) : (
                    <div key={i} style={rowStyle}>{inner}</div>
                  );
                })}
                {/* Ship #21d: Show rejected breakdown when drawer open, Rule 21-0 NO-DATA state when 0 rejected */}
                {soldDrawerOpen && item.soldCompDiagnostics && (item.soldCompDiagnostics.rejectedCount > 0 ? (
                  <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(224,86,86,0.06)", border: "1px solid rgba(224,86,86,0.2)" }}>
                    {/* Ship #21d: Show ALL rejection types with counts + samples (Rule 21-0: DATA state with source tags) */}
                    <div className="muted small" style={{ marginBottom: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#e05656" }}>
                      Rejected ({item.soldCompDiagnostics.rejectedCount} total)
                    </div>

                    {/* Rejection breakdown by type */}
                    {item.soldCompDiagnostics.reasons && Object.entries(item.soldCompDiagnostics.reasons)
                      .filter(([_, count]) => count > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count], i) => (
                        <div key={i} style={{ fontSize: 11, color: "#bbb", marginBottom: 3 }}>
                          <span style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: 3,
                            background: "rgba(224,86,86,0.15)", color: "#e05656",
                            marginRight: 6, letterSpacing: 0.3
                          }}>
                            {humanizeSoldReason(reason)}
                          </span>
                          <span style={{ color: "#888" }}>×{count}</span>
                        </div>
                      ))
                    }

                    {/* Sample listings (top 3 preserved by backend) */}
                    {Array.isArray(item.soldCompDiagnostics.rejectedSamples) && item.soldCompDiagnostics.rejectedSamples.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(224,86,86,0.15)" }}>
                        <div style={{ fontSize: 10, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Sample listings
                        </div>
                        {item.soldCompDiagnostics.rejectedSamples.map((rej, i) => (
                          <div key={i} style={{ padding: "4px 0", fontSize: 12, borderTop: i > 0 ? "1px solid rgba(224,86,86,0.1)" : "none" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                              <span style={{
                                fontSize: 10, padding: "1px 6px", borderRadius: 3,
                                background: "rgba(224,86,86,0.15)", color: "#e05656",
                                whiteSpace: "nowrap", letterSpacing: 0.3,
                              }}>
                                {humanizeSoldReason(rej.reason)}
                              </span>
                              {rej.price != null && (
                                <span style={{ color: "#888", fontSize: 11 }}>
                                  {fmtPrice(rej.price)}
                                </span>
                              )}
                            </div>
                            {rej.title && (
                              <div style={{ fontSize: 11, color: "#999", marginTop: 2, lineHeight: 1.3, wordBreak: "break-word" }}>
                                {rej.title}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <div style={{ fontSize: 11, color: "#22c55e" }}>
                      ✓ All comps verified (0 rejected)
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid rgba(212,175,55,0.25)", margin: "8px 0" }} />
              </div>
            )}

            {/* Ship #21e: PRICE DERIVATION trace */}
            {item.price && (
              <div style={{ marginBottom: 10 }}>
                <div
                  onClick={() => setDerivationExpanded(!derivationExpanded)}
                  style={{
                    cursor: 'pointer',
                    fontSize: 11,
                    color: '#888',
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    marginBottom: 6
                  }}
                >
                  <span>{derivationExpanded ? '▼' : '▶'}</span>
                  <span>PRICE DERIVATION</span>
                </div>
                {derivationExpanded && (
                  <div style={{
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.6,
                    fontFamily: 'monospace'
                  }}>
                    {/* Ship #21e: Rule 21-0 compliant — shows DATA state with source tags, or NO-DATA state */}
                    {item.priceCharting?.price && (
                      <>
                        <div style={{ color: '#888' }}>
                          PC base: <span style={{ color: '#d4af37' }}>{item.priceCharting.price}</span>{' '}
                          <span style={{ fontSize: 10, opacity: 0.7 }}>(PriceCharting {item.priceCharting.grade || 'raw'})</span>
                        </div>
                        {item.gradeMultiplier && (
                          <div style={{ color: '#888', marginTop: 2 }}>
                            × Grade mult: <span style={{ color: '#d4af37' }}>{item.gradeMultiplier.toFixed(2)}</span>{' '}
                            <span style={{ fontSize: 10, opacity: 0.7 }}>({item.grade || 'raw'} {item.year >= 1985 ? 'modern' : 'vintage'})</span>
                          </div>
                        )}
                      </>
                    )}

                    {item.soldCompsAvg && (
                      <div style={{ color: '#888', marginTop: 6 }}>
                        Sold avg: <span style={{ color: '#22c55e' }}>${item.soldCompsAvg.toFixed(2)}</span>{' '}
                        <span style={{ fontSize: 10, opacity: 0.7 }}>
                          ({item.soldCompDiagnostics?.verifiedCount || 0} verified, {item.soldComps?.[0]?.daysAgo || '?'}d recency)
                        </span>
                      </div>
                    )}

                    {item.comps?.average && (
                      <div style={{ color: '#888', marginTop: 2 }}>
                        Active avg: <span style={{ color: '#3b82f6' }}>${item.comps.average.toFixed(2)}</span>{' '}
                        <span style={{ fontSize: 10, opacity: 0.7 }}>({item.comps.count || 0} comps)</span>
                      </div>
                    )}

                    {item.blendedAvg && (
                      <div style={{ color: '#888', marginTop: 4 }}>
                        → Blend (60/40): <span style={{ color: '#a78bfa' }}>${item.blendedAvg.toFixed(2)}</span>
                      </div>
                    )}

                    {(item.rawComps?.lowest || item.rawComps?.gradeFilteredLowest) && (
                      <div style={{ color: '#888', marginTop: 6 }}>
                        Floor guard: <span style={{ color: '#f59e0b' }}>${(item.rawComps.gradeFilteredLowest || item.rawComps.lowest).toFixed(2)}</span>{' '}
                        <span style={{ fontSize: 10, opacity: 0.7 }}>(lowest ask)</span>
                      </div>
                    )}

                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(212,175,55,0.15)', color: '#d4af37', fontWeight: 600 }}>
                      = Final: ${parseFloat(item.price.replace(/[$,]/g, '')).toFixed(2)}{' '}
                      <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>({item.pricingSource || 'unknown'})</span>
                    </div>

                    {!item.priceCharting?.price && !item.soldCompsAvg && !item.comps?.average && (
                      <div style={{ color: '#888', fontSize: 11, opacity: 0.7 }}>
                        Price derivation unavailable (identity incomplete)
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ACTIVE LISTINGS section */}
            <div
              className="muted small"
              style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
            >
              Active Listings
            </div>
            {(item.comps?.recentSales || []).slice(0, 3).map((s, i) => {
              const rowStyle = { padding: "6px 0", fontSize: 14 };
              const inner = (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted small">{fmtSaleWhen(s.date, s.daysAgo)}</span>
                    <span style={{ fontWeight: 600, color: "#d4af37" }}>
                      {fmtPrice(s.price)}
                      {s.itemWebUrl && <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>}
                    </span>
                  </div>
                  {s.title && (
                    <div style={{ fontSize: 13, color: "#999", marginTop: 2, lineHeight: 1.3, wordBreak: "break-word" }}>
                      {s.title}
                    </div>
                  )}
                </div>
              );
              return s.itemWebUrl ? (
                <a key={i} href={s.itemWebUrl} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>{inner}</a>
              ) : (
                <div key={i} style={rowStyle}>{inner}</div>
              );
            })}
            <div style={{ borderTop: "1px solid rgba(212,175,55,0.25)", margin: "8px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
              {/* FIX 2: Display sold avg separately from active listings */}
              <span className="muted small">
                {item.soldCompsAvg != null && item.soldCompsAvg > 0 ? 'Sold avg (30d)' : 'Active listing avg'}
              </span>
              <span style={{ fontWeight: 600 }}>
                {fmtPrice(item.soldCompsAvg != null && item.soldCompsAvg > 0 ? item.soldCompsAvg : item.comps?.averageNum)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
              <span className="muted small">Recommended</span>
              <span style={{ fontWeight: 700, color: "#d4af37" }}>{recommendedLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
              <span className="muted small">Floor</span>
              <span style={{ fontWeight: 600, color: "#e05656" }}>{fmtPrice(item.comps?.lowestNum)}</span>
            </div>
            {item.comps?.highestNum != null && (
              <div className="muted small" style={{ marginTop: 4, fontSize: 12 }}>
                {/* Floor display fix: when recommended < floor, show sold vs active instead of Low→Avg→High */}
                {displayPrice > 0 && displayPrice < (item.comps?.lowestNum || 0) && item.soldCompsAvg > 0 ? (
                  <>Sold avg: ${item.soldCompsAvg.toLocaleString("en-US")} · Active: ${item.comps?.lowestNum?.toLocaleString("en-US")}–${item.comps?.highestNum?.toLocaleString("en-US")}</>
                ) : (
                  <>Low ${item.comps.lowestNum?.toLocaleString("en-US")} → Avg ${(Math.round((item.comps.averageNum || 0) * 100) / 100).toLocaleString("en-US")} → High ${item.comps.highestNum?.toLocaleString("en-US")}</>
                )}
              </div>
            )}
            {item.gradeMultiplier != null && (
              <div className="muted small" style={{ marginTop: 4, fontSize: 12 }}>
                Grade adj: ×{item.gradeMultiplier}{item.priceNote && /estimate|CGC/i.test(item.priceNote) ? ` (${item.priceNote})` : ""}
              </div>
            )}
            {item.variantMultiplier != null && (
              <div style={{ color: "#aaa", fontSize: 11, marginTop: 4 }}>
                Variant adj: ×{item.variantMultiplier}
              </div>
            )}
            <div className="muted small" style={{ marginTop: 6, fontStyle: "italic" }}>
              {item.pricingSource === "pricecharting"
                ? "Source: PriceCharting market data"
                : item.pricingSource === "browse_api"
                  ? "Source: Browse API — active listings"
                  : "Source: AI estimate"}
              {Array.isArray(item.soldComps) && item.soldComps.length > 0 && " + eBay sold"}
            </div>
            <div className="muted small" style={{ fontSize: 11 }}>
              {item.comps.source === "browse_api"
                ? `Based on ${item.comps.count ?? 0} active eBay listing${item.comps.count !== 1 ? "s" : ""}`
                : `Based on ${item.comps.count ?? 0} eBay sale${item.comps.count !== 1 ? "s" : ""} in last 30 days`}
              {item.comps.verifiedByAI ? " · AI verified" : ""}
            </div>
            {item.priceNote && /defect adj/i.test(item.priceNote) && (
              <div style={{ color: "#f59e0b", fontSize: 12, marginTop: 4 }}>
                Adjusted for cover defects
              </div>
            )}
          </div>
        )}

        {/* GoCollect CGC submission analysis */}
        {(item.goCollect || item.userFmv98) && (() => {
          const gc = item.goCollect || {};
          const fmv98 = item.userFmv98 || gc.fmv98;
          const fmv96 = gc.fmv96;
          const fmv94 = gc.fmv94;
          const fmv92 = gc.fmv92;

          const gradingCost = 35; // CGC economy tier
          const pressCost = 20;   // press + clean
          const totalCost = gradingCost + pressCost;
          const rawPrice = getDisplayPrice(item) || 0;

          const scenariosRaw = [
            { grade: "9.8", fmv: fmv98 },
            { grade: "9.6", fmv: fmv96 },
            { grade: "9.4", fmv: fmv94 },
            { grade: "9.2", fmv: fmv92 },
          ].filter((s) => s.fmv > 0);

          const scenarios = scenariosRaw.map((s) => {
            const net = s.fmv - totalCost - rawPrice;
            return { ...s, net, profitable: net > 0 };
          });

          // Verdict: find the lowest grade where net is still profitable
          // (stopping at the first unprofitable tier on the way down).
          const descending = scenarios
            .slice()
            .sort((a, b) => parseFloat(b.grade) - parseFloat(a.grade));
          let lowestProfitable = null;
          for (const s of descending) {
            if (s.profitable) lowestProfitable = s.grade;
            else break;
          }
          const lowestTested = descending[descending.length - 1]?.grade;

          let verdict;
          if (!lowestProfitable) {
            verdict = { icon: "❌", text: "SELL RAW — not worth grading", color: "#dc2626" };
          } else if (lowestProfitable === "9.8") {
            verdict = { icon: "⚠️", text: "RISKY — must grade 9.8", color: "#f59e0b" };
          } else if (lowestProfitable === lowestTested) {
            verdict = { icon: "✅", text: "SUBMIT — low risk", color: "#4caf50" };
          } else {
            verdict = {
              icon: "✅",
              text: `SUBMIT — profitable at ${lowestProfitable}+`,
              color: "#4caf50",
            };
          }

          // Press recommendation from Claude's condition notes.
          const reasonLower = String(item.reason || "").toLowerCase();
          const needsPress = /spine tick|stress|minor wear|handling/.test(reasonLower);

          const census = gc.census;
          const lowCensus = typeof census === "number" && census > 0 && census < 50;

          const showAnalysis = !item.isGraded && scenarios.length > 0;

          return (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid rgba(138,43,226,0.3)",
                borderRadius: 8,
                background: "rgba(138,43,226,0.06)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8a2be2", marginBottom: 8 }}>
                {showAnalysis ? "📊 CGC Submission Analysis" : "CGC Fair Market Value"}
              </div>

              {showAnalysis && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", padding: "2px 0" }}>
                    <span>Raw value</span>
                    <span style={{ fontWeight: 700, color: "#ccc" }}>${rawPrice.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 6, marginBottom: 6 }}>
                    <span>Grading + press</span>
                    <span style={{ fontWeight: 700, color: "#ccc" }}>~${totalCost}</span>
                  </div>

                  {scenarios.map((s) => (
                    <div
                      key={s.grade}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "3px 0",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: "#aaa" }}>
                        If grades <strong style={{ color: "#ccc" }}>{s.grade}</strong>
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        <span style={{ color: "#8a2be2" }}>${Number(s.fmv).toFixed(0)}</span>
                        <span style={{ color: "#888", margin: "0 6px" }}>→</span>
                        <span style={{ color: s.profitable ? "#4caf50" : "#dc2626", fontWeight: 700 }}>
                          {s.net >= 0 ? "+" : "−"}${Math.abs(s.net).toFixed(0)}
                        </span>
                        <span style={{ marginLeft: 6 }}>{s.profitable ? "✅" : "❌"}</span>
                      </span>
                    </div>
                  ))}

                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: `${verdict.color}20`,
                      border: `1px solid ${verdict.color}60`,
                      color: verdict.color,
                      fontSize: 13,
                      fontWeight: 700,
                      textAlign: "center",
                    }}
                  >
                    {verdict.icon} {verdict.text}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 11, color: "#aaa" }}>
                    {needsPress
                      ? "🔧 Press recommended before submit"
                      : "✅ Clean copy — press optional"}
                  </div>

                  {typeof census === "number" && census > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: "#aaa" }}>
                      Census: {census.toLocaleString("en-US")} graded
                      {lowCensus && (
                        <span style={{ color: "#f59e0b", marginLeft: 6 }}>🔥 Low pop — scarcity premium</span>
                      )}
                    </div>
                  )}
                </>
              )}

              {!showAnalysis && (
                <>
                  {fmv98 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                      <span style={{ color: "#aaa" }}>CGC 9.8</span>
                      <span style={{ fontWeight: 700, color: "#8a2be2" }}>
                        ${Number(fmv98).toLocaleString("en-US")}
                        {item.userFmv98 ? " (manual)" : ""}
                      </span>
                    </div>
                  )}
                  {fmv96 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                      <span style={{ color: "#aaa" }}>CGC 9.6</span>
                      <span style={{ fontWeight: 600 }}>${Number(fmv96).toLocaleString("en-US")}</span>
                    </div>
                  )}
                  {fmv94 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                      <span style={{ color: "#aaa" }}>CGC 9.4</span>
                      <span style={{ fontWeight: 600 }}>${Number(fmv94).toLocaleString("en-US")}</span>
                    </div>
                  )}
                  {typeof census === "number" && census > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#aaa" }}>
                      Census: {census.toLocaleString("en-US")} graded
                      {lowCensus && (
                        <span style={{ color: "#f59e0b", marginLeft: 6 }}>🔥 Low pop</span>
                      )}
                    </div>
                  )}
                </>
              )}

              <div style={{ marginTop: 8 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Override FMV 9.8"
                  defaultValue={item.userFmv98 || ""}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (v > 0) onUpdateField?.(item, "userFmv98", v);
                    else if (!e.target.value) onUpdateField?.(item, "userFmv98", null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                  }}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(138,43,226,0.3)",
                    background: "rgba(0,0,0,0.2)",
                    color: "#ccc",
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              {gc.source && (
                <div className="muted small" style={{ marginTop: 4, fontSize: 10 }}>
                  Source: GoCollect
                </div>
              )}
            </div>
          );
        })()}

        {!hasComps && !item.megaKeyFloorApplied && !item.manualReviewRequired && !item.gradeExceedsMap && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(245,158,11,0.5)",
              borderRadius: 8,
              background: "rgba(245,158,11,0.1)",
              color: "#f59e0b",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              ⚠ No stored eBay comps for this comic
            </div>
            <div className="small" style={{ marginBottom: 4 }}>
              Tap refresh to fetch live market data
            </div>
            {(item.priceLow || item.priceHigh) && (
              <div style={{ fontWeight: 600, marginTop: 6 }}>
                AI range: {item.priceLow}
                {item.priceLow && item.priceHigh ? " – " : ""}
                {item.priceHigh}
              </div>
            )}
          </div>
        )}

        {item.cgcVerified === true && (
          <div style={{ background: "#00aa4422", border: "1px solid #00aa44", borderRadius: 6, padding: "6px 12px", marginTop: 8, color: "#00cc55", fontSize: 13 }}>
            ✓ CGC Verified · {item.certNumber} · {item.cgcLabel}
          </div>
        )}

        <button
          className="reset-btn"
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ marginTop: 12, width: "100%" }}
        >
          {refreshing ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  border: "2px solid rgba(212,175,55,0.3)",
                  borderTopColor: "#d4af37",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  marginRight: 8,
                  verticalAlign: "middle",
                }}
              />
              Refreshing…
            </>
          ) : item.refusedToPrice || item.contract?.state === 'REFUSED' ? (
            // Ship #26 REFRESH-AS-SEARCH: same call, customer framing —
            // a refused card invites a search, not a retry.
            "🔍 Search live market"
          ) : (
            "🔄 Refresh Market Data"
          )}
        </button>
        {refreshError && (
          <div className="error-text small" style={{ marginTop: 6 }}>
            {refreshError}
          </div>
        )}

        {/* Ship #20a.6.19 — Re-identify button */}
        {item.images?.[0] && onReIdentify && (
          <>
            <button
              className="btn-secondary"
              onClick={handleReIdentify}
              disabled={reIdentifying || refreshing}
              style={{ marginTop: 8, width: "100%" }}
            >
              {reIdentifying ? (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(212,175,55,0.3)",
                      borderTopColor: "#d4af37",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                      marginRight: 8,
                      verticalAlign: "middle",
                    }}
                  />
                  Re-scanning…
                </>
              ) : (
                "🔍 Re-identify Book"
              )}
            </button>
            {reIdentifyError && (
              <div className="error-text small" style={{ marginTop: 6 }}>
                {reIdentifyError}
              </div>
            )}
          </>
        )}
      </div>

      {/* 6. ACTION BUTTONS */}
      <div style={{ marginTop: 18 }}>
        {item.status === "sold" ? (
          <div className="listed-card" style={{ borderColor: "rgba(234,179,8,0.4)" }}>
            <div className="listed-header">
              <span className="listed-badge" style={{ background: "rgba(234,179,8,0.2)", color: "#eab308" }}>Sold</span>
              <span className="muted small">on eBay</span>
            </div>
            {item.soldPrice != null && (
              <div style={{ fontSize: 18, fontWeight: 700, color: "#eab308", marginTop: 8 }}>
                ${item.soldPrice.toFixed(2)}
              </div>
            )}
            {item.soldAt && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                Sold {(() => {
                  const d = new Date(item.soldAt);
                  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
                })()}
              </div>
            )}
            {item.ebayUrl && (
              <a
                href={item.ebayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="listed-link"
                style={{ marginTop: 8, fontSize: 11 }}
              >
                View listing
              </a>
            )}
          </div>
        ) : isListed ? (
          <div className="listed-card">
            <div className="listed-header">
              <span className="listed-badge">Listed</span>
              <span className="muted small">on eBay</span>
            </div>
            <a
              href={item.ebayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="listed-link"
            >
              {item.ebayUrl}
            </a>
            <button
              className="reset-btn"
              onClick={handleSync}
              disabled={syncing}
              style={{
                marginTop: 10,
                width: "100%",
                background: syncing ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.15)",
                color: syncing ? "#888" : "#60a5fa",
                border: "1px solid rgba(59,130,246,0.3)",
              }}
            >
              {syncing ? "Checking eBay..." : "🔄 Sync eBay Status"}
            </button>
            {syncSuccess && (
              <div style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                background: "rgba(34,197,94,0.15)",
                color: "#22c55e",
                fontSize: 12,
                textAlign: "center",
              }}>
                {syncSuccess}
              </div>
            )}
            {syncError && (
              <div style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                background: "rgba(239,68,68,0.15)",
                color: "#ef4444",
                fontSize: 12,
                textAlign: "center",
              }}>
                {syncError}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Ship #20b — Price Bands */}
            {item.priceBands && (
              <div style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
              }}>
                <div style={{ color: "#888", fontSize: 11, marginBottom: 8, letterSpacing: 0.5 }}>
                  PRICE BANDS
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Quick Sale */}
                  <button
                    onClick={() => {
                      const price = parseFloat(String(item.priceBands.quick || '0').replace(/[$,]/g, ''));
                      setListPrice(price);
                    }}
                    style={{
                      background: "rgba(34,197,94,0.1)",
                      border: "1px solid rgba(34,197,94,0.3)",
                      borderRadius: 6,
                      padding: "8px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      color: "#fff",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#22c55e" }}>Quick Sale</span>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{item.priceBands.quick}</span>
                  </button>
                  {/* Market */}
                  <button
                    onClick={() => {
                      const price = parseFloat(String(item.priceBands.market || '0').replace(/[$,]/g, ''));
                      setListPrice(price);
                    }}
                    style={{
                      background: "rgba(59,130,246,0.1)",
                      border: "1px solid rgba(59,130,246,0.3)",
                      borderRadius: 6,
                      padding: "8px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      color: "#fff",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#3b82f6" }}>Market</span>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{item.priceBands.market}</span>
                  </button>
                  {/* Stretch */}
                  <button
                    onClick={() => {
                      const price = parseFloat(String(item.priceBands.stretch || '0').replace(/[$,]/g, ''));
                      setListPrice(price);
                    }}
                    style={{
                      background: "rgba(168,85,247,0.1)",
                      border: "1px solid rgba(168,85,247,0.3)",
                      borderRadius: 6,
                      padding: "8px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      color: "#fff",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#a855f7" }}>Stretch</span>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{item.priceBands.stretch}</span>
                  </button>
                </div>
                {/* Source info */}
                <div style={{ marginTop: 8, fontSize: 11, color: "#888" }}>
                  {item.priceBands.count > 0 && `Based on ${item.priceBands.count ?? 0} ${
                    item.priceBands.source === 'verified_sold' ? 'sold' :
                    item.priceBands.source === 'verified_active' ? 'active' : 'estimated'
                  } comp${item.priceBands.count === 1 ? '' : 's'}`}
                  {item.priceBands.recencyDays != null && ` · Most recent: ${item.priceBands.recencyDays}d ago`}
                </div>
              </div>
            )}

            {/* Ship #25 — Velocity Analysis */}
            {item.velocityAnalysis && item.velocityAnalysis.hasData && (
              <div style={{
                background: (() => {
                  const tier = item.velocityAnalysis.tier;
                  if (tier === 'HOT') return 'rgba(220,38,38,0.1)';
                  if (tier === 'FAST') return 'rgba(234,88,12,0.1)';
                  if (tier === 'NORMAL') return 'rgba(22,163,74,0.1)';
                  if (tier === 'SLOW') return 'rgba(202,138,4,0.1)';
                  return 'rgba(156,163,175,0.1)';
                })(),
                border: `1px solid ${(() => {
                  const tier = item.velocityAnalysis.tier;
                  if (tier === 'HOT') return 'rgba(220,38,38,0.3)';
                  if (tier === 'FAST') return 'rgba(234,88,12,0.3)';
                  if (tier === 'NORMAL') return 'rgba(22,163,74,0.3)';
                  if (tier === 'SLOW') return 'rgba(202,138,4,0.3)';
                  return 'rgba(156,163,175,0.3)';
                })()}`,
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
              }}>
                <div style={{ color: "#888", fontSize: 11, marginBottom: 8, letterSpacing: 0.5 }}>
                  MARKET VELOCITY
                </div>
                <div style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.4 }}>
                  {item.velocityAnalysis.summary}
                </div>
                {item.velocityAnalysis.recommendation.recommendedPrice && (
                  <div style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}>
                    <span style={{ fontSize: 12, color: '#888' }}>
                      Recommended ({item.velocityAnalysis.recommendation.recommendedBand}):
                    </span>
                    <button
                      onClick={() => {
                        setListPrice(item.velocityAnalysis.recommendation.recommendedPrice);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#60a5fa',
                        fontSize: 15,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      ${item.velocityAnalysis.recommendation.recommendedPrice}
                    </button>
                  </div>
                )}
                {item.velocityAnalysis.saturation?.saturated && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: '#fbbf24',
                    background: 'rgba(251,191,36,0.1)',
                    padding: '6px 8px',
                    borderRadius: 4,
                  }}>
                    ⚠️ {item.velocityAnalysis.saturation.reason}
                  </div>
                )}
              </div>
            )}

            {/* Ship #21 — Decision Path UI */}
            {item.claudeCheck && item.claudeCheck.recommendation && (
              <div style={{
                marginBottom: 12,
                padding: "12px",
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.25)",
                borderRadius: 8,
              }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#60a5fa" }}>
                  RECOMMENDATION
                </div>
                <div style={{ fontSize: 12, color: "#ccc", marginBottom: 8 }}>
                  {item.claudeCheck.recommendationReason || 'Based on current market data'}
                </div>
                {(() => {
                  const rec = item.claudeCheck.recommendation;
                  const marketPrice = item.priceBands?.market ? parseFloat(String(item.priceBands.market).replace(/[$,]/g, '')) : null;

                  if (rec === 'SELL_RAW') {
                    return (
                      <div style={{ fontSize: 13 }}>
                        <div style={{ fontWeight: 600, color: "#22c55e", marginBottom: 4 }}>
                          ✓ Sell Raw
                        </div>
                        {marketPrice && (
                          <div style={{ fontSize: 12, color: "#888" }}>
                            Market value: ${marketPrice.toFixed(2)}
                          </div>
                        )}
                      </div>
                    );
                  } else if (rec === 'PRESS') {
                    const currentGrade = item.numericGrade || 6.0;
                    const afterPressGrade = currentGrade + 0.5;
                    const currentValue = marketPrice || 50;
                    const afterPressValue = currentValue * 1.3; // rough estimate
                    const pressCost = 25;
                    const netGain = afterPressValue - currentValue - pressCost;

                    return (
                      <div style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>
                          ⚡ Press Recommended
                        </div>
                        <div style={{ color: "#888", lineHeight: 1.6 }}>
                          Current: {item.grade} → ${currentValue.toFixed(2)}<br/>
                          After press: ~{afterPressGrade.toFixed(1)} → ${afterPressValue.toFixed(2)}<br/>
                          Press cost: ~${pressCost}<br/>
                          <span style={{ fontWeight: 600, color: netGain > 0 ? '#22c55e' : '#ef4444' }}>
                            Net gain: ${netGain.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  } else if (rec === 'CGC') {
                    const currentValue = marketPrice || 50;
                    const cgcGrade = item.numericGrade || (item.grade?.match(/(\d+\.?\d*)/)?.[1] ? parseFloat(item.grade.match(/(\d+\.?\d*)/)[1]) : 7.0);
                    const cgcValue = item.goCollect?.fmv98 || currentValue * 2; // rough estimate
                    const submissionCost = 55; // grading + press
                    const netGain = cgcValue - currentValue - submissionCost;

                    return (
                      <div style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: "#8b5cf6", marginBottom: 6 }}>
                          🏆 CGC Submission
                        </div>
                        <div style={{ color: "#888", lineHeight: 1.6 }}>
                          Current raw: ${currentValue.toFixed(2)}<br/>
                          CGC at {cgcGrade.toFixed(1)}: ${cgcValue.toFixed(2)}<br/>
                          Submission cost: ~${submissionCost}<br/>
                          <span style={{ fontWeight: 600, color: netGain > 0 ? '#22c55e' : '#ef4444' }}>
                            Net gain: ${netGain.toFixed(2)}
                          </span><br/>
                          <span style={{ fontSize: 10 }}>Timeline: 60-90 days</span>
                        </div>
                      </div>
                    );
                  } else if (rec === 'HOLD') {
                    return (
                      <div style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: "#6366f1", marginBottom: 4 }}>
                          📊 Hold
                        </div>
                        <div style={{ color: "#888" }}>
                          {item.claudeCheck.recommendationReason || 'Market conditions suggest holding'}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Ship #26 — NO-DEAD-END CARDS: references + exit chips + next action */}
            <MarketReferences item={item} />
            <ExitStrategyRow item={item} />
            <NextActionLine item={item} />

            {/* 3. PRIMARY ACTION — List Price Input */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ color: "#aaa", fontSize: 13 }}>List price</span>
              <input
                type="number"
                value={listPrice}
                onChange={(e) => {
                  const newPrice = e.target.value;
                  setListPrice(newPrice);
                  // Q41-FIX (P0): setCatalogue is NOT in CollectionDetail
                  // scope — this handler threw ReferenceError on every
                  // keystroke (after setListPrice, so the input LOOKED
                  // functional) and priceOverridden never persisted. The
                  // original Q41 flag has been dead since ship. Route
                  // through onUpdateField, which owns catalogue +
                  // selectedItem state and the IndexedDB write.
                  onUpdateField(
                    {
                      ...item,
                      listPrice: parseFloat(newPrice) || 0,
                      listPriceManual: true,
                    },
                    'priceOverridden',
                    true
                  );
                }}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 700,
                  padding: "6px 10px",
                  width: 100,
                  textAlign: "right",
                }}
              />
            </div>
            {(() => {
              if (listPriceWarningDismissed) return null;
              const w = computeListPriceWarning(listPrice, item);
              if (!w) return null;
              return (
                <div style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 10px",
                  marginBottom: 8,
                  background: "rgba(218,165,32,0.10)",
                  border: "1px solid #d4af37",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "#fde68a",
                  lineHeight: 1.4,
                }}>
                  <div style={{ flex: 1 }}>
                    ⚠ ${w.listPrice.toFixed(2)} is {w.worst.pctOver}% above {w.worst.label} (${w.worst.anchor.toFixed(2)}). Books priced above market typically stall.
                  </div>
                  <button
                    onClick={() => setListPriceWarningDismissed(true)}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(212,175,55,0.4)",
                      color: "#fde68a",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              );
            })()}
            {(() => {
              // Ship #20a.6.4 — identity gate is HARD-BLOCK, not ack-able.
              // User can't acknowledge "we don't know what this book is";
              // they have to fix the data first (edit fields or re-scan).
              // Takes precedence over mega-key ack and edition warning ack.
              if (item.identityConfident === false) {
                return (
                  <div style={{
                    padding: "10px 12px",
                    marginBottom: 8,
                    background: "rgba(239,68,68,0.10)",
                    border: "1px solid rgba(239,68,68,0.6)",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#fca5a5",
                  }}>
                    🔍 Listing blocked — identification required.{" "}
                    Edit title, issue, year, or publisher to proceed (or re-scan).
                  </div>
                );
              }
              // ANY mega-key floor (verified or estimated) requires user
              // acknowledgment before listing — mega-keys are volatile and
              // $100K+ decisions warrant explicit one-tap confirmation.
              // gradeExceedsMap and manualReviewRequired both gate here
              // because the displayed price cannot be trusted for listing.
              // manualConfirmed resets on price change (see merge paths).
              const needsAck =
                (item.manualReviewRequired ||
                  item.gradeExceedsMap ||
                  item.megaKeyFloorApplied) &&
                !item.manualConfirmed;
              // Ship #19 — edition warning ack, stacks sequentially after
              // mega-key ack. Red banner with signals list; must click
              // "Acknowledge" to enable listing. editionConfirmed persists
              // until Vision rescan changes the signals array.
              const needsEditionAck =
                item.editionWarning?.detected === true && !item.editionConfirmed;
              if (needsAck) {
                const gateLabel = item.gradeExceedsMap
                  ? "Grade exceeds map — manual appraisal needed before listing."
                  : item.manualReviewRequired
                    ? "Manual appraisal required — mega-key pricing dispersion."
                    : "Confirm price manually first — mega-key detected.";
                return (
                  <>
                    <div style={{
                      padding: "8px 10px",
                      marginBottom: 8,
                      background: "rgba(218,54,51,0.1)",
                      border: "1px solid #da3633",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#fca5a5",
                    }}>
                      {gateLabel}
                    </div>
                    <button
                      className="reset-btn"
                      onClick={() => onUpdateField(item, 'manualConfirmed', true)}
                      style={{ width: "100%", background: "#da3633", color: "white" }}
                    >
                      Acknowledge and Enable Listing
                    </button>
                  </>
                );
              }
              if (needsEditionAck) {
                const signals = Array.isArray(item.editionWarning?.signals)
                  ? item.editionWarning.signals.join(", ")
                  : "";
                return (
                  <>
                    <div style={{
                      padding: "8px 10px",
                      marginBottom: 8,
                      background: "rgba(218,54,51,0.1)",
                      border: "1px solid #da3633",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#fca5a5",
                    }}>
                      🚨 EDITION WARNING — Vision detected reprint or later-print
                      signals{signals ? ` (${signals})` : ""}. Current price may
                      reflect 1st-print comps. Verify edition before listing.
                    </div>
                    <button
                      className="reset-btn"
                      onClick={() => onUpdateField(item, 'editionConfirmed', true)}
                      style={{ width: "100%", background: "#da3633", color: "white" }}
                    >
                      Acknowledge edition warning and Enable Listing
                    </button>
                  </>
                );
              }
              // Ship #24 — Authentication gate (block listing when score < 80)
              const needsAuthAck =
                item.identityAlignment?.authenticationScore != null &&
                item.identityAlignment.authenticationScore < 80 &&
                !item.authenticationConfirmed;
              if (needsAuthAck) {
                const authScore = item.identityAlignment.authenticationScore;
                const conflicts = item.identityAlignment.conflicts || [];
                const conflictFields = conflicts.map(c => c.field).join(", ");
                return (
                  <>
                    <div style={{
                      padding: "8px 10px",
                      marginBottom: 8,
                      background: authScore >= 60 ? "rgba(255,193,7,0.1)" : "rgba(218,54,51,0.1)",
                      border: `1px solid ${authScore >= 60 ? "#ffc107" : "#da3633"}`,
                      borderRadius: 6,
                      fontSize: 12,
                      color: authScore >= 60 ? "#856404" : "#fca5a5",
                    }}>
                      {authScore >= 60 ? '⚠️' : '🚨'} LOW AUTHENTICATION ({authScore}%) —
                      Identity conflicts detected{conflictFields ? ` (${conflictFields})` : ""}.
                      Cross-source validation shows disagreement. Review data accuracy before listing.
                    </div>
                    <button
                      className="reset-btn"
                      onClick={() => onUpdateField(item, 'authenticationConfirmed', true)}
                      style={{ width: "100%", background: authScore >= 60 ? "#ffc107" : "#da3633", color: authScore >= 60 ? "#856404" : "white" }}
                    >
                      Acknowledge conflicts and Enable Listing
                    </button>
                  </>
                );
              }
              // Ship #24a-3 (Amendment B) — contract lock gate. Any lock in
              // contract.locks[] hard-disables listing and locks[0].reason
              // renders VERBATIM as the banner. Wires the XMEN1 fields
              // (listingHardLocked / floorContaminationReason) onto the
              // card, plus manual-review, refused, tier-0, thin-pool, and
              // contract-violation locks — one gate for all of them.
              if (item.contract && (item.contract.locks?.length || 0) > 0) {
                const locks = item.contract.locks;
                const lock = locks[0];
                // Q41 (ruled 2026-07-12): lock taxonomy. Insufficiency-class
                // locks (engine lacks data) are acknowledgeable WHEN the user
                // sets a manual price and takes responsibility. Integrity
                // locks (book/identity/evidence suspect) render NO control.
                const allInsufficiency = locks.every((l) => l.class === 'insufficiency');
                const manualPriceNum = parseFloat(listPrice) || 0;
                const q41AckValid =
                  item.q41Ack != null &&
                  Math.abs((item.q41Ack.price ?? -1) - manualPriceNum) < 0.011;

                if (allInsufficiency && item.priceOverridden && q41AckValid) {
                  // Acknowledged insufficiency override — fall through to the
                  // List button below (I2/I3 amendment path).
                } else if (allInsufficiency) {
                  const canAck = item.priceOverridden && manualPriceNum > 0;
                  return (
                    <>
                      <div style={{
                        padding: "10px 12px",
                        marginBottom: 8,
                        background: "rgba(251,191,36,0.10)",
                        border: "1px solid rgba(212,175,55,0.6)",
                        borderRadius: 6,
                        fontSize: 12,
                        color: "#fde68a",
                      }}>
                        🔒 {String(lock.code).replace(/-/g, ' ').toUpperCase()} — {lock.reason}
                        <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                          {canAck
                            ? "Acknowledge below to list at your own price."
                            : "Set a manual list price above to enable acknowledgment."}
                        </div>
                      </div>
                      <button
                        className="reset-btn"
                        disabled={!canAck}
                        onClick={() => {
                          const payload = {
                            title: item.title,
                            issue: item.issue || null,
                            state: item.contract?.state || null,
                            decision: item.contract?.decision?.action || null,
                            manualPrice: manualPriceNum,
                            priceOverridden: true,
                            lockClassAcknowledged: 'insufficiency',
                            locks: locks.map((l) => l.code),
                          };
                          console.log('[Q41-override] acknowledged', JSON.stringify(payload));
                          onUpdateField(item, 'q41Ack', { price: manualPriceNum, at: Date.now(), payload });
                        }}
                        style={{ width: "100%", background: canAck ? "#b45309" : undefined, color: canAck ? "white" : undefined, opacity: canAck ? 1 : 0.5 }}
                      >
                        Engine could not verify a price. I've set and verified this price myself.
                      </button>
                    </>
                  );
                } else {
                  // Integrity lock — hard, never acknowledgeable (X-Men Q7.0
                  // qualified-label gate: NO acknowledge control exists).
                  return (
                    <>
                      <div style={{
                        padding: "10px 12px",
                        marginBottom: 8,
                        background: "rgba(239,68,68,0.10)",
                        border: "1px solid #da3633",
                        borderRadius: 6,
                        fontSize: 12,
                        color: "#fca5a5",
                      }}>
                        🔒 LISTING LOCKED — {String(lock.code).replace(/-/g, ' ').toUpperCase()}
                        <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                          {lock.reason}
                        </div>
                      </div>
                      <button
                        className="reset-btn"
                        disabled={true}
                        style={{ width: "100%", opacity: 0.5 }}
                      >
                        📋 Listing Locked
                      </button>
                    </>
                  );
                }
              }

              // Ship #26 v0-D — Decision Engine hard-block gate
              // Block listing when decision.action is ID_REQUIRED or DO_NOT_LIST,
              // or when decision.blockers array has items.
              const hasDecisionBlocker =
                item.decision?.action === 'ID_REQUIRED' ||
                item.decision?.action === 'DO_NOT_LIST' ||
                (item.decision?.blockers?.length || 0) > 0;

              if (hasDecisionBlocker) {
                const firstBlocker = item.decision?.blockers?.[0] || 'unknown';
                const reason = item.decision?.reason || 'Decision Engine blocked this listing';
                return (
                  <>
                    <div style={{
                      padding: "10px 12px",
                      marginBottom: 8,
                      background: "rgba(239,68,68,0.10)",
                      border: "1px solid #da3633",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#fca5a5",
                    }}>
                      🚫 DECISION ENGINE BLOCKED — {firstBlocker.replace(/-/g, ' ')}
                      <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                        {reason}
                      </div>
                    </div>
                    <button
                      className="reset-btn"
                      disabled={true}
                      style={{ width: "100%", opacity: 0.5 }}
                    >
                      📋 Listing Blocked
                    </button>
                  </>
                );
              }

              // Q73: Incomplete enrich state → explicit disabled button + refresh prompt
              // GSX #1 class: enrich returned null everything (no price/decision/year/bands)
              // but button rendered "No price available" ACTIVE. Rule 21-0: incomplete
              // enrich → honest incomplete state, list button DISABLED, never phantom-rendered.
              const isIncompleteEnrich = !item.price && !item.decision && !item.year;

              if (isIncompleteEnrich) {
                return (
                  <>
                    <div style={{
                      padding: "10px 12px",
                      marginBottom: 8,
                      background: "rgba(239,68,68,0.10)",
                      border: "1px solid #da3633",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#fca5a5",
                    }}>
                      ⚠️ SCAN INCOMPLETE — refresh market data
                      <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                        Enrich did not complete. Tap "Refresh Market Data" to retry.
                      </div>
                    </div>
                    <button
                      className="reset-btn"
                      disabled={true}
                      style={{ width: "100%", opacity: 0.5 }}
                    >
                      📋 Listing Disabled — Incomplete
                    </button>
                  </>
                );
              }

              // Ship #24a-3 — contract items: button obeys contract.listable
              // (locks already returned above, so a lockless !listable here
              // means the decision action isn't a LIST action). Q57 inline
              // thin-pool rule survives ONLY for pre-contract entries — the
              // contract carries it server-side as the low-tier-thin-pool lock.
              // Q41: acknowledged-override unlock. Two paths reach here
              // unlisted: (a) insufficiency locks acknowledged above (fall
              // through), (b) RESEARCH/!listable lockless cards acknowledged
              // via the mega-key-gate pattern below. Ack is price-bound —
              // a changed price invalidates it and re-gates.
              const q41Locks = item.contract?.locks || [];
              const q41ManualNum = parseFloat(listPrice) || 0;
              const q41EffectivePrice = q41ManualNum > 0 ? q41ManualNum : getDisplayPrice(item);
              const q41AckPriceValid =
                item.q41Ack != null &&
                Math.abs((item.q41Ack.price ?? -1) - q41EffectivePrice) < 0.011;
              const q41Unlocked =
                q41AckPriceValid &&
                (q41Locks.length === 0 ||
                  (q41Locks.every((l) => l.class === 'insufficiency') && item.priceOverridden));

              const researchAckNeeded =
                item.contract && !item.contract.listable &&
                q41Locks.length === 0 && !q41AckPriceValid;

              if (researchAckNeeded) {
                const act = item.contract.decision?.action || 'REVIEW';
                return (
                  <>
                    <div style={{
                      padding: "8px 10px",
                      marginBottom: 8,
                      background: "rgba(251,191,36,0.10)",
                      border: "1px solid rgba(212,175,55,0.6)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#fde68a",
                    }}>
                      🔍 {act} recommended — review the evidence, then acknowledge to list
                      {q41EffectivePrice > 0 ? ` at $${q41EffectivePrice.toFixed(2)}` : ''}.
                    </div>
                    <button
                      className="reset-btn"
                      disabled={!(q41EffectivePrice > 0)}
                      onClick={() => {
                        const payload = {
                          title: item.title,
                          issue: item.issue || null,
                          state: item.contract?.state || null,
                          decision: act,
                          manualPrice: q41EffectivePrice,
                          priceOverridden: !!item.priceOverridden,
                          lockClassAcknowledged: 'research-not-listable',
                          locks: [],
                        };
                        console.log('[Q41-override] acknowledged', JSON.stringify(payload));
                        onUpdateField(item, 'q41Ack', { price: q41EffectivePrice, at: Date.now(), payload });
                      }}
                      style={{ width: "100%", background: "#b45309", color: "white" }}
                    >
                      Acknowledge and Enable Listing
                    </button>
                  </>
                );
              }

              const listLocked = item.contract
                ? (!item.contract.listable && !q41Unlocked)
                : (item.matchConfidence?.tier === 'LOW' &&
                   (item.soldComps?.length || 0) + (item.comps?.count || 0) < 3);
              const listLockedLabel = item.contract
                ? `🔒 List locked — ${item.contract.decision?.action || 'review'} recommended first`
                : `🔒 List locked — verify data quality first`;

              return (
                <button
                  className="reset-btn primary"
                  onClick={handleList}
                  disabled={
                    listing ||
                    !(parseFloat(listPrice) > 0) ||
                    listLocked
                  }
                  style={{ width: "100%" }}
                >
                  {listing
                    ? "Listing on eBay..."
                    : listLocked
                      ? listLockedLabel
                      : listPrice
                        ? `📋 List on eBay — $${Number(listPrice).toFixed(2)}`
                        : `📋 List on eBay — No price available`}
                </button>
              );
            })()}
          </>
        )}

        {/* Prepare Listing Dropdown */}
        {item.status !== "sold" && getDisplayPrice(item) > 0 && (
          <div style={{ position: "relative", marginTop: 8 }}>
            <button
              className="reset-btn"
              onClick={() => setPacketDropdownOpen(!packetDropdownOpen)}
              style={{
                width: "100%",
                background: "rgba(100,200,100,0.15)",
                border: "1px solid rgba(100,200,100,0.35)",
                color: "#4caf50",
              }}
            >
              📤 Prepare Listing {packetDropdownOpen ? "▲" : "▼"}
            </button>
            {packetDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "#1a1a1a",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  padding: 4,
                  zIndex: 10,
                  marginTop: 4,
                }}
              >
                <button
                  onClick={() => handlePreparePacket("mercari")}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    color: "#ccc",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "rgba(255,255,255,0.1)")}
                  onMouseLeave={(e) => (e.target.style.background = "transparent")}
                >
                  📦 Mercari
                </button>
                <button
                  onClick={() => handlePreparePacket("facebook")}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    color: "#ccc",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "rgba(255,255,255,0.1)")}
                  onMouseLeave={(e) => (e.target.style.background = "transparent")}
                >
                  👥 Facebook Marketplace
                </button>
                <button
                  onClick={() => handlePreparePacket("craigslist")}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    color: "#ccc",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "rgba(255,255,255,0.1)")}
                  onMouseLeave={(e) => (e.target.style.background = "transparent")}
                >
                  📋 Craigslist
                </button>
                <button
                  onClick={() => handlePreparePacket("whatnot")}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    color: "#ccc",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "rgba(255,255,255,0.1)")}
                  onMouseLeave={(e) => (e.target.style.background = "transparent")}
                >
                  🎙️ Whatnot
                </button>
              </div>
            )}
          </div>
        )}

        {listError && (
          <div className="error-text small" style={{ marginTop: 6 }}>
            {listError}
          </div>
        )}

        {/* LISTING READINESS CHECKLIST */}
        {(() => {
          const readiness = getListingReadiness(item);
          const status = getReadinessStatus(item);
          const photos = getPhotoChecklist(item);

          return (
            <div style={{
              marginTop: 16,
              marginBottom: 16,
              padding: "12px",
              background: status.bg,
              border: `1px solid ${status.border}`,
              borderRadius: 8,
            }}>
              {/* Header with status badge */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  letterSpacing: 0.5
                }}>
                  LISTING READINESS
                </span>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: status.color,
                  background: `${status.color}15`,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: `1px solid ${status.color}40`,
                  letterSpacing: 0.5
                }}>
                  <span>{status.icon}</span>
                  <span>{status.badge}</span>
                </div>
              </div>

              {/* Checklist items */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(readiness).map(([key, item]) => {
                  const icon = item.status === 'pass' ? '✓' : item.status === 'caution' ? '⚠️' : '✗';
                  const color = item.status === 'pass' ? '#22c55e' : item.status === 'caution' ? '#fbbf24' : '#e05656';

                  return (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{
                        fontSize: 14,
                        color,
                        width: 16,
                        textAlign: "center"
                      }}>
                        {icon}
                      </span>
                      <span style={{
                        color: item.status === 'pass' ? '#ccc' : item.status === 'caution' ? '#fde68a' : '#fca5a5',
                        flex: 1
                      }}>
                        {item.label}
                      </span>
                      {item.required && (
                        <span style={{
                          fontSize: 9,
                          color: '#888',
                          textTransform: 'uppercase',
                          letterSpacing: 0.5
                        }}>
                          Required
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Photo summary */}
              <div style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid rgba(255,255,255,0.1)',
                fontSize: 11,
                color: '#888'
              }}>
                {photos.count}/4 photos · {
                  photos.front ? 'Front ✓' : 'Front missing'
                } · {
                  photos.back ? 'Back ✓' : 'Back missing'
                } · {
                  photos.spine ? 'Spine ✓' : 'Spine missing'
                } · {
                  photos.pages ? 'Pages ✓' : 'Pages missing'
                }
              </div>
            </div>
          );
        })()}

        <button
          className="reset-btn danger"
          onClick={() => {
            if (confirm(`Delete "${item.title || "this comic"}"?`)) {
              onDelete(item.id);
              onBack();
            }
          }}
          style={{ marginTop: 12, width: "100%" }}
        >
          Delete from Collection
        </button>
      </div>

      <div
        className="muted small"
        style={{ textAlign: "center", marginTop: 16, fontStyle: "italic" }}
      >
        {photos.length} photo{photos.length === 1 ? "" : "s"} stored
      </div>

      {/* Packet Modal */}
      {packetModal && (() => {
        const { channel, packet } = packetModal;
        const channelNames = {
          mercari: 'Mercari',
          facebook: 'Facebook Marketplace',
          craigslist: 'Craigslist',
          whatnot: 'Whatnot'
        };
        const channelName = channelNames[channel] || channel;

        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.8)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setPacketModal(null); }}
          >
            <div
              style={{
                background: "#0a0a0a",
                border: "1px solid rgba(100,200,100,0.35)",
                borderRadius: 12,
                padding: 16,
                maxWidth: 500,
                width: "100%",
                maxHeight: "90vh",
                overflowY: "auto",
                color: "#ccc",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: "#4caf50", marginBottom: 10 }}>
                📤 {channelName} Listing Packet
              </div>

              {packet.warnings.length > 0 && (
                <div style={{
                  padding: "8px 12px",
                  background: "rgba(245,158,11,0.15)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "#f59e0b",
                  marginBottom: 12,
                }}>
                  ⚠️ {packet.warnings.join(', ')}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#4caf50", marginBottom: 4 }}>
                  Title ({packetEditTitle.length} chars):
                </label>
                <textarea
                  value={packetEditTitle}
                  onChange={(e) => setPacketEditTitle(e.target.value)}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "#1a1a1a",
                    border: "1px solid rgba(100,200,100,0.3)",
                    borderRadius: 6,
                    color: "#ccc",
                    fontSize: 13,
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#4caf50", marginBottom: 4 }}>
                  Description:
                </label>
                <textarea
                  value={packetEditDesc}
                  onChange={(e) => setPacketEditDesc(e.target.value)}
                  rows={6}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "#1a1a1a",
                    border: "1px solid rgba(100,200,100,0.3)",
                    borderRadius: 6,
                    color: "#ccc",
                    fontSize: 13,
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#4caf50", marginBottom: 4 }}>
                  Price:
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={packetEditPrice}
                  onChange={(e) => setPacketEditPrice(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "#1a1a1a",
                    border: "1px solid rgba(100,200,100,0.3)",
                    borderRadius: 6,
                    color: "#ccc",
                    fontSize: 13,
                  }}
                />
              </div>

              {channel === 'whatnot' && packet.startingBid && (
                <div style={{
                  padding: "8px 12px",
                  background: "rgba(100,200,100,0.1)",
                  border: "1px solid rgba(100,200,100,0.25)",
                  borderRadius: 6,
                  fontSize: 12,
                  marginBottom: 12,
                }}>
                  💡 Suggested starting bid: ${packet.startingBid.toFixed(2)}
                  {packet.warnings.find(w => w.includes('floor')) && (
                    <div style={{ color: "#f59e0b", marginTop: 4 }}>
                      ⚠️ {packet.warnings.find(w => w.includes('floor'))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => copyToClipboard(packetEditTitle, 'Title')}
                  style={{
                    flex: 1,
                    minWidth: "calc(50% - 4px)",
                    padding: "8px 12px",
                    background: "rgba(100,200,100,0.15)",
                    border: "1px solid rgba(100,200,100,0.35)",
                    borderRadius: 6,
                    color: "#4caf50",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📋 Copy Title
                </button>
                <button
                  onClick={() => copyToClipboard(packetEditDesc, 'Description')}
                  style={{
                    flex: 1,
                    minWidth: "calc(50% - 4px)",
                    padding: "8px 12px",
                    background: "rgba(100,200,100,0.15)",
                    border: "1px solid rgba(100,200,100,0.35)",
                    borderRadius: 6,
                    color: "#4caf50",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📋 Copy Description
                </button>
                <button
                  onClick={() => {
                    const all = `Title:\n${packetEditTitle}\n\nDescription:\n${packetEditDesc}\n\nPrice: $${packetEditPrice}`;
                    copyToClipboard(all, 'All');
                  }}
                  style={{
                    flex: 1,
                    minWidth: "calc(50% - 4px)",
                    padding: "8px 12px",
                    background: "rgba(100,200,100,0.25)",
                    border: "1px solid rgba(100,200,100,0.5)",
                    borderRadius: 6,
                    color: "#4caf50",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  📋 Copy All
                </button>
                {navigator.share && (
                  <button
                    onClick={() => {
                      const text = `Title:\n${packetEditTitle}\n\nDescription:\n${packetEditDesc}\n\nPrice: $${packetEditPrice}`;
                      navigator.share({ text }).catch(() => {});
                    }}
                    style={{
                      flex: 1,
                      minWidth: "calc(50% - 4px)",
                      padding: "8px 12px",
                      background: "rgba(59,130,246,0.15)",
                      border: "1px solid rgba(59,130,246,0.35)",
                      borderRadius: 6,
                      color: "#3b82f6",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    📤 Share
                  </button>
                )}
              </div>

              <button
                onClick={() => setPacketModal(null)}
                style={{
                  width: "100%",
                  marginTop: 12,
                  padding: "10px 14px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 6,
                  color: "#ccc",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// --- Manage Tab: Claude Command Center ---

function ManagePage({ catalogue, totalValue, onOpenItem, onListComic, onBundleList, onUpdateAll, tradePiles, setTradePiles, setCatalogue }) {
  const [selectionType, setSelectionType] = useState(null); // 'bundle' | 'trade' | null
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bundling, setBundling] = useState(false);
  const [bundleMsg, setBundleMsg] = useState(null);
  const [postAllOpen, setPostAllOpen] = useState(false);
  const [postAllRunning, setPostAllRunning] = useState(false);
  const [postAllResults, setPostAllResults] = useState([]); // [{ id, title, issue, priceNum, state, msg }]
  const [updateAllRunning, setUpdateAllRunning] = useState(false);
  const [updateAllProgress, setUpdateAllProgress] = useState({ current: 0, total: 0 });
  const [tradePileModal, setTradePileModal] = useState(null); // { step: 1|2, wants: string[], notes: string }

  const selectionMode = selectionType !== null;

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionType(null);
    setSelectedIds(new Set());
  };

  // Ship #26 v0-D — Decision Engine aware filtering for bulk listing.
  // Only include books with listable decision actions and no blockers.
  // Renamed from getHotUnlisted to getListableBooks.
  const getListableBooks = (aiTagsSnapshot) =>
    catalogue.filter(
      (c) =>
        c.status !== "listed" &&
        getDisplayPrice(c) > 0 &&
        (c.decision?.action === 'LIST_NOW' || c.decision?.action === 'LIST_HIGH') &&
        (c.decision?.blockers?.length || 0) === 0 &&
        c.identityConfident !== false
    );

  const getEligibleForTrade = () =>
    catalogue.filter(
      (c) =>
        c.decision?.action !== 'ID_REQUIRED' &&
        c.decision?.action !== 'DO_NOT_LIST' &&
        (c.decision?.blockers?.length || 0) === 0 &&
        c.status !== 'listed' &&
        c.status !== 'sold' &&
        getDisplayPrice(c) > 0 &&
        c.decision?.bestChannel !== 'research'
    );

  const runPostAll = async (ids) => {
    const items = ids
      .map((id) => catalogue.find((c) => c.id === id))
      .filter(Boolean);
    if (items.length === 0) return;
    setPostAllRunning(true);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setPostAllResults((prev) =>
        prev.map((r) => (r.id === it.id ? { ...r, state: "posting", msg: null } : r))
      );
      try {
        await onListComic(it);
        setPostAllResults((prev) =>
          prev.map((r) => (r.id === it.id ? { ...r, state: "success" } : r))
        );
      } catch (err) {
        setPostAllResults((prev) =>
          prev.map((r) =>
            r.id === it.id
              ? { ...r, state: "error", msg: err?.message || "failed" }
              : r
          )
        );
      }
      if (i < items.length - 1) {
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    setPostAllRunning(false);
  };

  const openPostAll = (hotUnlisted) => {
    if (!hotUnlisted.length) return;
    setPostAllResults(
      hotUnlisted.map((c) => ({
        id: c.id,
        title: c.title,
        issue: c.issue,
        priceNum: getDisplayPrice(c),
        state: "pending",
        msg: null,
      }))
    );
    setPostAllOpen(true);
  };

  const confirmPostAll = () => {
    const pendingIds = postAllResults
      .filter((r) => r.state === "pending")
      .map((r) => r.id);
    runPostAll(pendingIds);
  };

  const retryFailed = () => {
    const failedIds = postAllResults
      .filter((r) => r.state === "error")
      .map((r) => r.id);
    if (failedIds.length === 0) return;
    setPostAllResults((prev) =>
      prev.map((r) => (r.state === "error" ? { ...r, state: "pending", msg: null } : r))
    );
    runPostAll(failedIds);
  };

  const closePostAll = () => {
    if (postAllRunning) return;
    setPostAllOpen(false);
    setPostAllResults([]);
  };

  // Ship #23 FIX 4 — Update All Books button handler.
  const runUpdateAll = async () => {
    const staleBooks = catalogue.filter(
      (c) => !c.priceBands || !c.claudeCheck || !c.demandSignals
    );
    if (staleBooks.length === 0) return;
    setUpdateAllRunning(true);
    setUpdateAllProgress({ current: 0, total: staleBooks.length });
    for (let i = 0; i < staleBooks.length; i++) {
      setUpdateAllProgress({ current: i + 1, total: staleBooks.length });
      try {
        await onUpdateAll(staleBooks[i]);
      } catch (err) {
        console.error(`[update-all] failed for ${staleBooks[i].title}:`, err);
      }
      if (i < staleBooks.length - 1) {
        await new Promise((res) => setTimeout(res, 2000)); // 2s between updates
      }
    }
    setUpdateAllRunning(false);
    setUpdateAllProgress({ current: 0, total: 0 });
  };

  const submitBundle = async () => {
    if (bundling || !onBundleList) return;
    const items = catalogue.filter((c) => selectedIds.has(c.id));

    // Ship #26 v0-D — Decision Engine blocker validation for bundle submission
    const blocked = items.filter(c =>
      c.decision?.action === 'ID_REQUIRED' ||
      c.decision?.action === 'DO_NOT_LIST' ||
      (c.decision?.blockers?.length || 0) > 0
    );
    if (blocked.length > 0) {
      setBundleMsg({
        type: "err",
        text: `${blocked.length} book${blocked.length === 1 ? '' : 's'} ha${blocked.length === 1 ? 's' : 've'} decision blockers. Deselect them first.`
      });
      return;
    }

    if (items.length < 2) {
      setBundleMsg({ type: "err", text: "Select at least 2 comics" });
      return;
    }
    setBundling(true);
    setBundleMsg({ type: "info", text: `Creating bundle listing for ${items.length} comics…` });
    try {
      const r = await onBundleList(items);
      setBundleMsg({ type: "ok", text: `Bundle listed! ${r.count} comics → eBay #${r.ebayItemId}` });
      exitSelection();
      setTimeout(() => setBundleMsg(null), 4000);
    } catch (err) {
      setBundleMsg({ type: "err", text: err?.message || "Bundle listing failed" });
    } finally {
      setBundling(false);
    }
  };

  const createTradePile = async () => {
    if (!tradePileModal) return;
    const items = catalogue.filter((c) => selectedIds.has(c.id));
    if (items.length === 0) return;

    const pileId = `pile_${Date.now()}`;
    const totalValue = items.reduce((s, c) => s + getDisplayPrice(c), 0);

    const newPile = {
      id: pileId,
      name: `Trade Pile ${tradePiles.length + 1}`,
      itemIds: items.map(c => c.id),
      wants: tradePileModal.wants.filter(w => w.trim()),
      notes: tradePileModal.notes || '',
      totalValue,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Update items with trade pile flags
    for (const item of items) {
      const updated = {
        ...item,
        inTradePile: true,
        tradePileId: pileId,
        tradeValue: getDisplayPrice(item)
      };
      await putComic(updated);
      setCatalogue((prev) => prev.map((c) => c.id === item.id ? updated : c));
    }

    // Add pile to state
    setTradePiles((prev) => [...prev, newPile]);

    // Clean up
    setTradePileModal(null);
    exitSelection();
  };

  const [chatInput, setChatInput] = useState("");
  const [latestResponse, setLatestResponse] = useState(null);
  const [latestActions, setLatestActions] = useState([]);
  const [history, setHistory] = useState([]);
  const [sending, setSending] = useState(false);
  const totalCostBasis = catalogue.reduce((s, c) => s + (c.purchasePrice || 0), 0);
  const totalGain = totalValue - totalCostBasis;
  const totalGainPct = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : null;
  const [metrics, setMetrics] = useState(() => {
    // Instant default metrics from local data — no API wait.
    const listed = catalogue.filter((c) => c.status === "listed").length;
    const keys = catalogue.filter((c) => showKeyIssue(c.keyIssue)).length;
    const stagnant = catalogue.filter((c) => c.status !== "listed" && (Date.now() - (c.timestamp || 0)) > 86400000 * 30).length;
    const m = [
      { label: "Total Value", value: fmt(totalValue), color: "green" },
      { label: "Listed", value: `${listed} of ${catalogue.length}`, color: listed < catalogue.length / 2 ? "red" : "green" },
      { label: "Key Issues", value: String(keys), color: keys > 0 ? "yellow" : "green" },
      { label: "Stagnant", value: String(stagnant), color: stagnant > 0 ? "red" : "green" },
    ];
    if (totalCostBasis > 0) {
      m.push({ label: "Cost Basis", value: fmt(totalCostBasis), color: "yellow" });
      m.push({ label: "Gain/Loss", value: `${totalGain >= 0 ? "+" : ""}${fmt(totalGain)}${totalGainPct != null ? ` (${totalGain >= 0 ? "+" : ""}${Math.round(totalGainPct)}%)` : ""}`, color: totalGain >= 0 ? "green" : "red" });
    }
    return m;
  });
  const [search, setSearch] = useState("");
  const [aiTags, setAiTags] = useState({});
  const [actionStatus, setActionStatus] = useState({});
  const [booted, setBooted] = useState(false);

  // Auto-fire Claude analysis on tab open.
  useEffect(() => {
    if (booted || catalogue.length === 0) return;
    setBooted(true);
    setSending(true);
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getVaultHeaders() },
      body: JSON.stringify({
        message: "Give me a quick summary of my collection status and top 3 actions I should take right now",
        collection: catalogue,
        history: [],
        buyerSessions: getSessionSummary(),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.response) {
          setLatestResponse(data.response);
          setLatestActions(data.actions || []);
          setHistory([
            { role: "user", content: "Give me a quick summary of my collection status and top 3 actions I should take right now" },
            { role: "assistant", content: data.response },
          ]);
        }
        if (data.metrics?.length) {
        // Total Value must come from local getDisplayPrice sum — never from Claude.
        const filtered = data.metrics.filter((m) => m.label !== "Total Value");
        setMetrics((prev) => {
          const tv = prev.find((m) => m.label === "Total Value");
          return tv ? [tv, ...filtered] : filtered;
        });
      }
        applyAiTags(data);
      })
      .catch(() => {})
      .finally(() => setSending(false));
  }, [catalogue, booted]);

  const applyAiTags = (data) => {
    const tags = {};
    (data.actions || []).forEach((a) => {
      if (a.action === "list" && a.comicId) tags[a.comicId] = { emoji: "🔥", label: "HOT" };
      if (a.action === "bundle" && a.comicIds) {
        a.comicIds.forEach((id) => { tags[id] = { emoji: "📦", label: "BUNDLE" }; });
      }
    });
    catalogue.forEach((item) => {
      const marketVal = item.comps?.averageNum;
      const displayVal = getDisplayPrice(item);
      if (marketVal && displayVal < marketVal * 0.85) {
        if (!aiTags[item.id] && !tags[item.id]) {
          tags[item.id] = { emoji: "🔥", label: "HOT", reason: "Priced below market" };
        }
      }
    });
    catalogue.forEach((c) => {
      if (!tags[c.id] && c.status !== "listed" && (Date.now() - (c.timestamp || 0)) > 86400000 * 30) {
        tags[c.id] = { emoji: "⏳", label: "STAGNANT" };
      }
    });
    setAiTags((prev) => ({ ...prev, ...tags }));
  };

  const sendMessage = async (text) => {
    if (!text.trim() || sending) return;
    setChatInput("");
    setSending(true);
    const newHistory = [...history, { role: "user", content: text.trim() }];
    setHistory(newHistory);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getVaultHeaders() },
        body: JSON.stringify({
          message: text.trim(),
          collection: catalogue,
          history: newHistory.slice(-10, -1),
          buyerSessions: getSessionSummary(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLatestResponse(data.response || "I couldn't analyze that.");
      setLatestActions(data.actions || []);
      setHistory((prev) => [...prev, { role: "assistant", content: data.response }]);
      if (data.metrics?.length) {
        // Total Value must come from local getDisplayPrice sum — never from Claude.
        const filtered = data.metrics.filter((m) => m.label !== "Total Value");
        setMetrics((prev) => {
          const tv = prev.find((m) => m.label === "Total Value");
          return tv ? [tv, ...filtered] : filtered;
        });
      }
      applyAiTags(data);
    } catch {
      setLatestResponse("Something went wrong. Try again.");
      setLatestActions([]);
    } finally {
      setSending(false);
    }
  };

  const handleAction = async (action) => {
    if (action.action === "view" && action.comicId) {
      const comic = catalogue.find((c) => c.id === action.comicId);
      if (comic) onOpenItem(comic);
      return;
    }
    if (action.action === "list" && action.comicId) {
      const comic = catalogue.find((c) => c.id === action.comicId);
      if (!comic || !onListComic) return;
      setActionStatus((prev) => ({ ...prev, [action.comicId]: "listing" }));
      try {
        await onListComic(comic);
        setActionStatus((prev) => ({ ...prev, [action.comicId]: "listed" }));
      } catch {
        setActionStatus((prev) => ({ ...prev, [action.comicId]: "error" }));
      }
      return;
    }
    if (action.action === "bundle" && action.comicIds) {
      const validIds = action.comicIds.filter((id) => catalogue.some((c) => c.id === id));
      if (validIds.length < 2) {
        setLatestResponse("Not enough comics for a bundle.");
        return;
      }
      setSelectionMode(true);
      setSelectedIds(new Set(validIds));
      const titles = validIds
        .map((id) => catalogue.find((c) => c.id === id)?.title)
        .filter(Boolean);
      setLatestResponse(
        `Bundle pre-selected: ${titles.join(", ")}. Review checkboxes and tap "List Bundle" to create the combined eBay listing.`
      );
      setLatestActions([]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Filter and sort
  const q = search.toLowerCase().trim();
  const filtered = catalogue
    .filter((item) => {
      if (!q) return true;
      const priceMatch = q.match(/^\$(\d+)\+?$/);
      if (priceMatch) return (marketValueOf(item) || 0) >= parseInt(priceMatch[1]);
      if (q === "key" || q === "keys") return showKeyIssue(item.keyIssue);
      if (q === "listed") return item.status === "listed";
      if (q === "unlisted") return item.status !== "listed";
      if (q === "hot") return aiTags[item.id]?.label === "HOT";
      if (q === "stagnant") return aiTags[item.id]?.label === "STAGNANT";
      if (q === "bundle") return aiTags[item.id]?.label === "BUNDLE";
      const hay = `${item.title} ${item.publisher} ${item.year} ${item.grade} ${item.keyIssue}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      const tagOrder = { HOT: 0, BUNDLE: 1, STAGNANT: 3 };
      const aO = tagOrder[aiTags[a.id]?.label] ?? 2;
      const bO = tagOrder[aiTags[b.id]?.label] ?? 2;
      if (aO !== bO) return aO - bO;
      return (marketValueOf(b) || 0) - (marketValueOf(a) || 0);
    });

  const metricColors = { red: "#dc2626", yellow: "#d4af37", green: "#16a34a" };

  const actionBtnStyle = (a) => {
    const s = actionStatus[a.comicId];
    if (s === "listing") return { background: "rgba(212,175,55,0.2)", color: "#d4af37", cursor: "wait" };
    if (s === "listed") return { background: "rgba(22,163,106,0.2)", color: "#16a34a", cursor: "default" };
    if (s === "error") return { background: "rgba(220,38,38,0.2)", color: "#dc2626", cursor: "pointer" };
    if (a.action === "list") return { background: "linear-gradient(135deg, #d4af37, #b8941f)", color: "#0a0a0a", cursor: "pointer" };
    return { background: "rgba(212,175,55,0.15)", color: "#d4af37", cursor: "pointer" };
  };

  const actionBtnLabel = (a) => {
    const s = actionStatus[a.comicId];
    if (s === "listing") return "Listing...";
    if (s === "listed") return "Listed! View on eBay →";
    if (s === "error") return "Failed — Retry";
    if (a.action === "list" && a.comicId) {
      const listItem = catalogue.find((c) => c.id === a.comicId);
      const realPrice = listItem ? getDisplayPrice(listItem) : null;
      const label = realPrice ? "List Now — $" + realPrice : a.label;
      return label;
    }
    return a.label;
  };

  const bundleItems = catalogue.filter((c) => selectedIds.has(c.id));
  const bundleSum = bundleItems.reduce((acc, it) => acc + (getDisplayPrice(it) || 0), 0);
  const bundlePrice = bundleSum * 0.82;

  return (
    <div style={{ paddingBottom: selectionMode ? 120 : 8, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Trade Piles Section */}
      {tradePiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tradePiles.map((pile) => {
            const pileItems = catalogue.filter(c => pile.itemIds.includes(c.id));
            return (
              <div
                key={pile.id}
                style={{
                  border: "1px solid rgba(100,200,100,0.4)",
                  borderRadius: 12,
                  padding: 12,
                  background: "rgba(100,200,100,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#4caf50", marginBottom: 4 }}>
                      🔁 {pile.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#999" }}>
                      {pileItems.length} comic{pileItems.length === 1 ? '' : 's'} • ${pile.totalValue.toFixed(2)} value
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${pile.name}"?`)) {
                        // Clear item flags
                        pile.itemIds.forEach(async (itemId) => {
                          const item = catalogue.find(c => c.id === itemId);
                          if (item) {
                            const updated = { ...item, inTradePile: false, tradePileId: null, tradeValue: null };
                            await putComic(updated);
                            setCatalogue((prev) => prev.map((c) => c.id === itemId ? updated : c));
                          }
                        });
                        setTradePiles((prev) => prev.filter(p => p.id !== pile.id));
                      }
                    }}
                    style={{
                      padding: "4px 8px",
                      background: "rgba(220,38,38,0.15)",
                      border: "1px solid rgba(220,38,38,0.3)",
                      borderRadius: 6,
                      color: "#dc2626",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
                {pile.wants.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Looking for:</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {pile.wants.map((want, i) => (
                        <span
                          key={i}
                          style={{
                            padding: "2px 8px",
                            background: "rgba(100,200,100,0.15)",
                            border: "1px solid rgba(100,200,100,0.3)",
                            borderRadius: 12,
                            fontSize: 11,
                            color: "#4caf50",
                          }}
                        >
                          {want}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => {
                    const lines = [
                      "Trading:",
                      ...pileItems.map(c => `- ${c.title}${c.issue ? ` #${c.issue}` : ''} — ${fmtPrice(c.tradeValue || getDisplayPrice(c))}`),
                      "",
                      `Estimated trade value: ~${fmtPrice(pile.totalValue)}`,
                      "",
                      "Looking for:",
                      ...pile.wants.map(w => `- ${w}`),
                      "",
                      "Contact:",
                      "[your info]",
                      "",
                      "Notes:",
                      pile.notes || "[none]"
                    ].join("\n");

                    if (navigator.share) {
                      navigator.share({ text: lines }).catch(() => {});
                    } else {
                      navigator.clipboard.writeText(lines);
                      alert("Copied to clipboard!");
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "rgba(100,200,100,0.15)",
                    border: "1px solid rgba(100,200,100,0.35)",
                    borderRadius: 8,
                    color: "#4caf50",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📤 Share Trade Offer
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* A. CLAUDE RESPONSE BOX (top) */}
      <div style={{
        border: "1px solid rgba(212,175,55,0.4)",
        borderRadius: 12,
        padding: 14,
        background: "rgba(212,175,55,0.06)",
      }}>
        <div style={{ fontSize: 11, color: "#d4af37", fontWeight: 600, marginBottom: 8 }}>
          🧠 Claude
        </div>

        {/* Loading state */}
        {sending && !latestResponse && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
            <div style={{
              width: 16, height: 16,
              border: "2px solid rgba(212,175,55,0.3)",
              borderTopColor: "#d4af37",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <span style={{ color: "#d4af37", fontSize: 14 }}>Analyzing your collection...</span>
          </div>
        )}

        {/* Response text */}
        {latestResponse && (
          <div style={{ fontSize: 14, lineHeight: 1.6, color: "#e0e0e0" }}>
            {latestResponse}
          </div>
        )}

        {/* Refreshing indicator after initial load */}
        {sending && latestResponse && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <div style={{
              width: 12, height: 12,
              border: "2px solid rgba(212,175,55,0.3)",
              borderTopColor: "#d4af37",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <span className="muted small">Updating...</span>
          </div>
        )}

        {/* Action buttons */}
        {latestActions.length > 0 && !sending && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {latestActions.map((a, j) => (
              <button
                key={j}
                onClick={() => handleAction(a)}
                disabled={actionStatus[a.comicId] === "listing"}
                style={{
                  padding: "10px 16px",
                  border: a.action === "list" ? "none" : "1px solid rgba(212,175,55,0.3)",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  ...actionBtnStyle(a),
                }}
              >
                {actionBtnLabel(a)}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!latestResponse && !sending && catalogue.length === 0 && (
          <div className="muted small">Scan some comics first, then Claude will analyze your collection.</div>
        )}
      </div>

      {/* B. CHAT INPUT */}
      <div>
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(chatInput); }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="text"
            placeholder="Ask Claude..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={sending}
            style={{
              flex: 1,
              padding: "12px 14px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              color: "#fff",
              fontSize: 15,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={sending || !chatInput.trim()}
            style={{
              padding: "12px 18px",
              background: sending ? "rgba(212,175,55,0.2)" : "linear-gradient(135deg, #d4af37, #b8941f)",
              color: sending ? "#d4af37" : "#0a0a0a",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              cursor: sending ? "wait" : "pointer",
              flexShrink: 0,
            }}
          >
            {sending ? "..." : "Ask"}
          </button>
        </form>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => {
              if (selectionMode) exitSelection();
              else setSelectionType('bundle');
            }}
            style={{
              padding: "6px 12px",
              background: selectionMode && selectionType === 'bundle' ? "rgba(220,38,38,0.2)" : "rgba(212,175,55,0.15)",
              border: `1px solid ${selectionMode && selectionType === 'bundle' ? "rgba(220,38,38,0.4)" : "rgba(212,175,55,0.35)"}`,
              borderRadius: 20,
              color: selectionMode && selectionType === 'bundle' ? "#dc2626" : "#d4af37",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {selectionMode && selectionType === 'bundle' ? "✕ Cancel Bundle" : "📦 Create Bundle"}
          </button>
          <button
            onClick={() => {
              if (selectionMode) exitSelection();
              else setSelectionType('trade');
            }}
            disabled={postAllRunning}
            style={{
              padding: "6px 12px",
              background: selectionMode && selectionType === 'trade' ? "rgba(100,200,100,0.2)" : "rgba(100,200,100,0.15)",
              border: `1px solid ${selectionMode && selectionType === 'trade' ? "rgba(100,200,100,0.4)" : "rgba(100,200,100,0.35)"}`,
              borderRadius: 20,
              color: selectionMode && selectionType === 'trade' ? "#64c864" : "#4caf50",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              opacity: postAllRunning ? 0.5 : 1,
            }}
          >
            {selectionMode && selectionType === 'trade' ? "✕ Cancel Trade" : "🔁 Create Trade Pile"}
          </button>
          {(() => {
            const listableBooks = getListableBooks(aiTags);
            if (listableBooks.length === 0) return null;
            return (
              <button
                onClick={() => openPostAll(listableBooks)}
                disabled={selectionMode || postAllRunning}
                style={{
                  padding: "6px 12px",
                  background: "rgba(220,38,38,0.2)",
                  border: "1px solid rgba(220,38,38,0.4)",
                  borderRadius: 20,
                  color: "#dc2626",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity: selectionMode || postAllRunning ? 0.5 : 1,
                }}
              >
                📋 Post All Listable ({listableBooks.length})
              </button>
            );
          })()}
          {(() => {
            const staleCount = catalogue.filter(
              (c) => !c.priceBands || !c.claudeCheck || !c.demandSignals
            ).length;
            if (staleCount === 0) return null;
            return (
              <button
                onClick={runUpdateAll}
                disabled={selectionMode || postAllRunning || updateAllRunning}
                style={{
                  padding: "6px 12px",
                  background: updateAllRunning
                    ? "rgba(59,130,246,0.2)"
                    : "rgba(34,197,94,0.2)",
                  border: updateAllRunning
                    ? "1px solid rgba(59,130,246,0.4)"
                    : "1px solid rgba(34,197,94,0.4)",
                  borderRadius: 20,
                  color: updateAllRunning ? "#3b82f6" : "#22c55e",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: updateAllRunning ? "default" : "pointer",
                  opacity: selectionMode || postAllRunning ? 0.5 : 1,
                }}
              >
                {updateAllRunning
                  ? `🔄 Updating ${updateAllProgress.current}/${updateAllProgress.total}...`
                  : `🔄 Update All Books (${staleCount})`}
              </button>
            );
          })()}
          {["Sell?", "Keys?", "Bundle?", "Stagnant?", "Value?"].map((q) => (
            <button
              key={q}
              onClick={() => sendMessage(q === "Sell?" ? "What should I sell this week?" : q === "Keys?" ? "Which books are key issues?" : q === "Bundle?" ? "Any bundle opportunities?" : q === "Stagnant?" ? "Which books are stagnant?" : "What's my most valuable book?")}
              disabled={sending}
              style={{
                padding: "6px 12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 20,
                color: "#999",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* C. METRIC BOXES (2x2) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {metrics.slice(0, 4).map((m, i) => (
          <div
            key={i}
            onClick={() => {
              if (m.filter) setSearch(m.filter);
              else sendMessage(`Tell me about ${m.label}`);
            }}
            style={{
              padding: 14,
              borderRadius: 10,
              border: `1px solid ${metricColors[m.color] || "#d4af37"}40`,
              background: `${metricColors[m.color] || "#d4af37"}10`,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, color: metricColors[m.color] || "#d4af37" }}>
              {m.value}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#ccc", marginTop: 2 }}>
              {m.label}
            </div>
            {m.detail && <div className="muted small" style={{ marginTop: 4 }}>{m.detail}</div>}
          </div>
        ))}
      </div>

      {/* D. SEARCH BAR */}
      <input
        type="text"
        placeholder='Search: title, "key", "$100+", "hot"...'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          color: "#fff",
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {/* E. COLLECTION GRID */}
      {filtered.length === 0 && (
        <div className="muted small" style={{ textAlign: "center", padding: 20 }}>
          {q ? "No comics match" : "No comics in collection yet"}
        </div>
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 10,
      }}>
        {filtered.map((item) => {
          const thumbSrc = getComicPhotos(item)[0] || null;
          const mv = marketValueOf(item);
          const tag = aiTags[item.id];
          const isSelected = selectionMode && selectedIds.has(item.id);
          return (
            <div
              key={item.id}
              onClick={() => {
                if (selectionMode) toggleSelected(item.id);
                else onOpenItem(item);
              }}
              style={{
                position: "relative",
                borderRadius: 10,
                border: isSelected
                  ? "2px solid #d4af37"
                  : "1px solid rgba(255,255,255,0.08)",
                background: isSelected
                  ? "rgba(212,175,55,0.1)"
                  : "rgba(255,255,255,0.03)",
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              {selectionMode && (
                <div style={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: isSelected ? "#d4af37" : "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(212,175,55,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#0a0a0a",
                  fontWeight: 800,
                  fontSize: 14,
                  zIndex: 2,
                }}>
                  {isSelected ? "✓" : ""}
                </div>
              )}
              {thumbSrc ? (
                <img src={thumbSrc} alt="" loading="lazy" style={{ width: "100%", height: 160, objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: 160, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>📘</div>
              )}
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
                  {item.title || "Unknown"}
                </div>
                {(() => {
                  const gt = item.isGraded === true && item.numericGrade != null
                    ? `CGC ${item.numericGrade}`
                    : (item.grade || null);
                  return gt ? (
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{gt}</div>
                  ) : null;
                })()}
                <div style={{ fontSize: 15, fontWeight: 800, color: "#d4af37" }}>
                  {mv != null ? fmt(mv) : "—"}
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                  {tag && (
                    <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 5, fontWeight: 700,
                      background: tag.label === "HOT" ? "rgba(220,38,38,0.2)" : tag.label === "STAGNANT" ? "rgba(245,158,11,0.2)" : "rgba(212,175,55,0.15)",
                      color: tag.label === "HOT" ? "#dc2626" : tag.label === "STAGNANT" ? "#f59e0b" : "#d4af37",
                    }}>
                      {tag.emoji} {tag.label}
                    </span>
                  )}
                  {item.status === "listed" && (
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: "rgba(22,163,106,0.2)", color: "#16a34a", fontWeight: 700 }}>
                      LISTED
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {bundleMsg && (
        <div style={{
          position: "fixed",
          left: 12,
          right: 12,
          bottom: selectionMode ? 90 : 70,
          padding: "10px 14px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          textAlign: "center",
          zIndex: 50,
          background: bundleMsg.type === "err"
            ? "rgba(220,38,38,0.2)"
            : bundleMsg.type === "ok"
              ? "rgba(22,163,106,0.2)"
              : "rgba(212,175,55,0.2)",
          border: `1px solid ${bundleMsg.type === "err" ? "#dc2626" : bundleMsg.type === "ok" ? "#16a34a" : "#d4af37"}`,
          color: bundleMsg.type === "err" ? "#dc2626" : bundleMsg.type === "ok" ? "#16a34a" : "#d4af37",
        }}>
          {bundleMsg.text}
        </div>
      )}

      {selectionMode && selectionType === 'bundle' && (
        <div style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 56,
          padding: "10px 12px",
          background: "rgba(15,15,15,0.96)",
          borderTop: "1px solid rgba(212,175,55,0.4)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 40,
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#d4af37" }}>
              {selectedIds.size} selected
            </div>
            <div style={{ fontSize: 11, color: "#999" }}>
              {bundleItems.length >= 2
                ? `$${bundleSum.toFixed(2)} → $${bundlePrice.toFixed(2)} (18% off)`
                : "Select 2+ comics to bundle"}
            </div>
          </div>
          <button
            onClick={exitSelection}
            disabled={bundling}
            style={{
              padding: "10px 14px",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              background: "transparent",
              color: "#ccc",
              fontSize: 13,
              fontWeight: 600,
              cursor: bundling ? "wait" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submitBundle}
            disabled={bundling || selectedIds.size < 2}
            style={{
              padding: "10px 16px",
              border: "none",
              borderRadius: 8,
              background: selectedIds.size >= 2 && !bundling
                ? "linear-gradient(135deg, #d4af37, #b8941f)"
                : "rgba(212,175,55,0.2)",
              color: selectedIds.size >= 2 && !bundling ? "#0a0a0a" : "#d4af37",
              fontSize: 13,
              fontWeight: 800,
              cursor: bundling ? "wait" : selectedIds.size >= 2 ? "pointer" : "not-allowed",
            }}
          >
            {bundling ? "Listing…" : "📦 List Bundle"}
          </button>
        </div>
      )}

      {selectionMode && selectionType === 'trade' && (
        <div style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 56,
          padding: "10px 12px",
          background: "rgba(15,15,15,0.96)",
          borderTop: "1px solid rgba(100,200,100,0.4)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 40,
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#4caf50" }}>
              {selectedIds.size} selected
            </div>
            <div style={{ fontSize: 11, color: "#999" }}>
              {bundleItems.length >= 1
                ? `Total trade value: $${bundleSum.toFixed(2)}`
                : "Select comics for trade pile"}
            </div>
          </div>
          <button
            onClick={exitSelection}
            style={{
              padding: "10px 14px",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              background: "transparent",
              color: "#ccc",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (selectedIds.size >= 1) {
                setTradePileModal({ step: 1, wants: [], notes: '' });
              }
            }}
            disabled={selectedIds.size < 1}
            style={{
              padding: "10px 16px",
              border: "none",
              borderRadius: 8,
              background: selectedIds.size >= 1
                ? "linear-gradient(135deg, #4caf50, #45a049)"
                : "rgba(100,200,100,0.2)",
              color: selectedIds.size >= 1 ? "#0a0a0a" : "#4caf50",
              fontSize: 13,
              fontWeight: 800,
              cursor: selectedIds.size >= 1 ? "pointer" : "not-allowed",
            }}
          >
            🔁 Next
          </button>
        </div>
      )}

      {postAllOpen && (() => {
        const total = postAllResults.length;
        const successCount = postAllResults.filter((r) => r.state === "success").length;
        const errorCount = postAllResults.filter((r) => r.state === "error").length;
        const doneCount = successCount + errorCount;
        const estTotal = postAllResults.reduce((s, r) => s + (r.priceNum || 0), 0);
        const started = postAllRunning || doneCount > 0;
        const allDone = !postAllRunning && doneCount === total && total > 0;
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) closePostAll(); }}
          >
            <div
              style={{
                background: "#0a0a0a",
                border: "1px solid rgba(220,38,38,0.35)",
                borderRadius: 12,
                padding: 16,
                maxWidth: 440,
                width: "100%",
                maxHeight: "85vh",
                overflowY: "auto",
                color: "#ccc",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: "#dc2626", marginBottom: 10 }}>
                {!started && `Post ${total} books to eBay?`}
                {postAllRunning && `📋 Posting… ${doneCount} of ${total}`}
                {allDone && `✅ Posted ${successCount} of ${total}${errorCount > 0 ? ` — ${errorCount} failed` : ""}`}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {postAllResults.map((r) => {
                  const icon =
                    r.state === "pending" ? "⏳" :
                    r.state === "posting" ? "📤" :
                    r.state === "success" ? "✅" : "❌";
                  const color =
                    r.state === "success" ? "#4caf50" :
                    r.state === "error" ? "#dc2626" :
                    r.state === "posting" ? "#d4af37" : "#888";
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        color,
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        paddingBottom: 4,
                      }}
                    >
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
                        {icon} {r.title}{r.issue ? ` #${r.issue}` : ""}
                      </span>
                      <span style={{ fontWeight: 700 }}>
                        ${Number(r.priceNum || 0).toFixed(2)}
                        {r.msg ? ` — ${r.msg}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>

              {!started && (
                <div style={{ fontSize: 13, fontWeight: 700, color: "#d4af37", marginBottom: 12 }}>
                  Est. total value: ${estTotal.toFixed(2)}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {!started && (
                  <>
                    <button
                      onClick={closePostAll}
                      style={{ padding: "8px 14px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#ccc", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmPostAll}
                      style={{ padding: "8px 14px", background: "rgba(220,38,38,0.25)", border: "1px solid rgba(220,38,38,0.5)", borderRadius: 8, color: "#dc2626", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
                    >
                      Post All
                    </button>
                  </>
                )}
                {allDone && (
                  <>
                    {errorCount > 0 && (
                      <button
                        onClick={retryFailed}
                        style={{ padding: "8px 14px", background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, color: "#f59e0b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                      >
                        Retry {errorCount} failed
                      </button>
                    )}
                    <button
                      onClick={closePostAll}
                      style={{ padding: "8px 14px", background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.35)", borderRadius: 8, color: "#d4af37", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {tradePileModal && (() => {
        const items = catalogue.filter((c) => selectedIds.has(c.id));
        const totalValue = items.reduce((s, c) => s + getDisplayPrice(c), 0);
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setTradePileModal(null); }}
          >
            <div
              style={{
                background: "#0a0a0a",
                border: "1px solid rgba(100,200,100,0.35)",
                borderRadius: 12,
                padding: 16,
                maxWidth: 440,
                width: "100%",
                maxHeight: "85vh",
                overflowY: "auto",
                color: "#ccc",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: "#4caf50", marginBottom: 10 }}>
                Create Trade Pile
              </div>

              {tradePileModal.step === 1 && (
                <>
                  <div style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>
                    {items.length} comic{items.length === 1 ? '' : 's'} selected — ${totalValue.toFixed(2)} total value
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#4caf50", marginBottom: 6 }}>
                      Looking for (comma separated, max 3):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Amazing Spider-Man #1, Hulk #181"
                      value={tradePileModal.wants.join(', ')}
                      onChange={(e) => {
                        const vals = e.target.value.split(',').map(v => v.trim()).filter(Boolean).slice(0, 3);
                        setTradePileModal({ ...tradePileModal, wants: vals });
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "#1a1a1a",
                        border: "1px solid rgba(100,200,100,0.3)",
                        borderRadius: 8,
                        color: "#ccc",
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#4caf50", marginBottom: 6 }}>
                      Notes (optional):
                    </label>
                    <textarea
                      placeholder="Any additional details..."
                      value={tradePileModal.notes}
                      onChange={(e) => setTradePileModal({ ...tradePileModal, notes: e.target.value })}
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "#1a1a1a",
                        border: "1px solid rgba(100,200,100,0.3)",
                        borderRadius: 8,
                        color: "#ccc",
                        fontSize: 13,
                        resize: "vertical",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setTradePileModal(null)}
                      style={{
                        padding: "8px 14px",
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 8,
                        color: "#ccc",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={createTradePile}
                      style={{
                        padding: "8px 14px",
                        background: "rgba(100,200,100,0.25)",
                        border: "1px solid rgba(100,200,100,0.5)",
                        borderRadius: 8,
                        color: "#4caf50",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Create Pile
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function WatchMode({ onStop }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const lastTitleRef = useRef("");
  const busyRef = useRef(false);
  const recognitionRef = useRef(null);
  const scanCountRef = useRef(0);
  const idleSecondsRef = useRef(0);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("Starting camera...");
  const [settings] = useState(loadBuyerSettings);
  const [watchContext, setWatchContext] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState(null);
  const [bid, setBid] = useState("");
  const [scanCount, setScanCount] = useState(0);
  const watchContextRef = useRef("");
  useEffect(() => { watchContextRef.current = watchContext; }, [watchContext]);

  // GUARD 5: Daily cap check
  useEffect(() => {
    const today = new Date().toDateString();
    const dailyKey = `cv_watch_daily_${today}`;
    const dailyCount = parseInt(localStorage.getItem(dailyKey) || "0", 10);
    if (dailyCount >= 200) {
      alert("Daily Watch Mode scan limit reached (200). Resets at midnight.");
      onStop();
    }
  }, [onStop]);

  useEffect(() => {
    let stream = null;
    let intervalId = null;
    let cancelled = false;

    // GUARD 3: UI cost warning
    const estimatedMaxCost = (0.003 * 50).toFixed(2);
    console.log(`[watch] Watch Mode active — scanning every 3s. Each scan costs ~$0.003. Auto-stops at 50 scans or 30s idle. Max cost this session: ~$${estimatedMaxCost}`);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("Watching...");

        const captureAndGrade = async () => {
          // GUARD 1: Hard session cap at 50 scans
          if (scanCountRef.current >= 50) {
            clearInterval(intervalId);
            onStop();
            alert("Watch Mode stopped — 50 scan limit reached. Restart to continue.");
            console.log("[watch] stopped — 50 scan cap hit");
            return;
          }

          if (busyRef.current) return;

          scanCountRef.current++;
          setScanCount(scanCountRef.current);

          // Update daily counter
          const today = new Date().toDateString();
          const dailyKey = `cv_watch_daily_${today}`;
          const dailyCount = parseInt(localStorage.getItem(dailyKey) || "0", 10);
          localStorage.setItem(dailyKey, String(dailyCount + 1));
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || !v.videoWidth) return;
          busyRef.current = true;
          try {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
            if (!blob) return;
            const b64 = await fileToBase64(blob);
            const res = await fetch("/api/grade", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getVaultHeaders() },
              body: JSON.stringify({ images: [b64], source: 'watch', voiceContext: watchContextRef.current || undefined }),
            });
            const data = await res.json();
            if (!res.ok || !data.title) return;
            const low = data.title.toLowerCase();
            if (low.includes("not a comic") || low.includes("unknown")) return;
            const issueNum = data.issue || data.title?.match(/#(\d+)/)?.[1] || null;
            const key = `${data.title}|${issueNum}`;

            // GUARD 2: Idle detection — stop if no new book for 30 seconds
            if (key === lastTitleRef.current) {
              idleSecondsRef.current += 3;
              if (idleSecondsRef.current >= 30) {
                clearInterval(intervalId);
                onStop();
                console.log("[watch] stopped — idle 30s");
                return;
              }
              return;
            } else {
              idleSecondsRef.current = 0;
              lastTitleRef.current = key;
            }
            setResult({ ...data, issue: issueNum, image: b64, _enriching: true });

            fetch("/api/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getVaultHeaders() },
              body: JSON.stringify({
                title: data.title,
                issue: issueNum,
                grade: data.grade,
                isGraded: data.isGraded,
                numericGrade: data.numericGrade,
                year: data.year,
                publisher: data.publisher,
                variant: data.variant || null,
                keyIssue: data.keyIssue || null,
                labelType: data.labelType || null,
                labelNotes: data.labelNotes || null,
                images: [b64],
              }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((enrich) => {
                if (!enrich || cancelled) return;
                setResult((prev) => prev ? { ...prev, ...enrich, image: prev.image, _enriching: false } : prev);
              })
              .catch(() => {});
          } catch {
            /* skip frame */
          } finally {
            busyRef.current = false;
          }
        };

        intervalId = setInterval(captureAndGrade, 3000);
        captureAndGrade();
      } catch (err) {
        setStatus("Camera error: " + (err.message || "permission denied"));
      }
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceNote("Type context above instead"); return; }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(" ").trim();
      if (transcript) {
        setWatchContext(transcript);
        const bidMatch = transcript.match(/\$?\b(\d+(?:\.\d{1,2})?)\b/);
        if (bidMatch) {
          const autoBid = parseFloat(bidMatch[1]);
          if (autoBid > 0 && autoBid < 10000) {
            setBid(String(autoBid));
            setVoiceNote("\uD83C\uDFA4 Bid: $" + autoBid);
          }
        }
      }
    };
    recognition.onerror = () => { setListening(false); setVoiceNote("Type context above instead"); };
    recognition.onend = () => { setListening(false); };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setVoiceNote(null);
    } catch {
      setListening(false);
      setVoiceNote("Type context above instead");
    }
  };

  const mv = marketValueOf(result);
  const fee = Number(settings.whatnotFee) || 0;
  const supplies = Number(settings.supplies) || 0;
  const labor = Number(settings.labor) || 0;
  const bidNum = parseFloat(bid);
  const hasBid = !isNaN(bidNum) && bidNum > 0;
  const netAtZero = mv != null ? mv - mv * (fee / 100) - supplies - labor : null;
  const netAtBid = mv != null && hasBid ? mv - mv * (fee / 100) - supplies - labor - bidNum : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#d4af37" }}>👁 Watch Mode: {scanCount}/50 scans</div>
        <button
          onClick={onStop}
          style={{ padding: "6px 14px", background: "transparent", border: "1px solid #e05656", borderRadius: 8, color: "#e05656", fontWeight: 700, cursor: "pointer" }}
        >Stop</button>
      </div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", aspectRatio: "4/3" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", color: "#d4af37", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
          {status}
        </div>
        <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#d4af37", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
          ~${(scanCount * 0.003).toFixed(3)}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
        <input
          placeholder="Context: title, grade, notes..."
          value={watchContext}
          onChange={e => setWatchContext(e.target.value)}
          style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#fff", fontSize: 13, padding: "6px 10px" }}
        />
        {watchContext && (
          <button onClick={() => { setWatchContext(""); setVoiceNote(null); }} style={{ background: "transparent", border: "none", color: "#999", fontSize: 16, cursor: "pointer", padding: "4px" }}>✕</button>
        )}
        <button
          onClick={toggleVoice}
          style={{ padding: "6px 10px", background: listening ? "rgba(224,86,86,0.3)" : "rgba(212,175,55,0.15)", border: `1px solid ${listening ? "#e05656" : "rgba(212,175,55,0.4)"}`, borderRadius: 8, color: listening ? "#e05656" : "#d4af37", fontSize: 16, cursor: "pointer" }}
        >{listening ? "⏹" : "\uD83C\uDFA4"}</button>
      </div>
      {voiceNote && <div style={{ fontSize: 11, color: "#d4af37", marginTop: 2 }}>{voiceNote}</div>}
      {result && (
        <div style={{ border: "1px solid rgba(212,175,55,0.4)", borderRadius: 12, padding: 14, background: "rgba(212,175,55,0.06)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
            {result.title}{result.issue ? ` #${result.issue}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>
            {result.publisher}{result.year ? ` · ${result.year}` : ""}{result.grade ? ` · ${result.grade}` : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase" }}>Market</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#d4af37" }}>
                {mv != null ? fmt(mv) : (result._enriching ? "..." : "\u2014")}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase" }}>{hasBid ? `Net @ $${bid}` : "Net @ $0 bid"}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: (hasBid ? netAtBid : netAtZero) != null && (hasBid ? netAtBid : netAtZero) > 0 ? "#16a34a" : "#e05656" }}>
                {hasBid
                  ? (netAtBid != null ? fmt(netAtBid) : "\u2014")
                  : (netAtZero != null ? fmt(netAtZero) : (result._enriching ? "..." : "\u2014"))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const isShareTarget = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("share-target") === "1";
  const [tab, setTab] = useState(isShareTarget ? "buyer" : "scan"); // 'scan' | 'buyer' | 'collection'
  const [loading, setLoading] = useState(isShareTarget);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualIssue, setManualIssue] = useState('');
  const [manualYear, setManualYear] = useState('');
  const [manualPublisher, setManualPublisher] = useState(''); // FIX B
  const [manualGrade, setManualGrade] = useState(''); // FIX B
  const [manualVariant, setManualVariant] = useState(''); // FIX B
  const [catalogue, setCatalogue] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showSafariBanner, setShowSafariBanner] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(
    () => localStorage.getItem("installDismissed") === "1"
  );
  // Install banner is mobile-only. Desktop Chrome/Edge show their own
  // install icon in the address bar, so a custom banner is just noise.
  const [isMobile] = useState(() =>
    /android|iphone|ipad|ipod/i.test(navigator.userAgent || "")
  );
  const [widgetMode, setWidgetMode] = useState(() => isShareTarget);
  const [watchMode, setWatchMode] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, title }
  const [bulkDone, setBulkDone] = useState(null); // number or null
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState(null); // { current, total }
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [refreshingPrices, setRefreshingPrices] = useState(0);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [pendingDuplicate, setPendingDuplicate] = useState(null);
  const [tradePiles, setTradePiles] = useState(() => getTradePiles());
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const fileRef = useRef(null);
  const buyerFileRef = useRef(null);
  const bulkRef = useRef(null);
  const collectionScrollPos = useRef(0);
  const manageScrollPos = useRef(0);
  const prevTabRef = useRef("collection");
  const lastAutoRefreshRef = useRef(0);
  // Card-level enrich collision guard. Each manual-refresh /api/enrich call
  // (refreshMarketData) tags itself with an enrichId and registers its
  // AbortController here. Navigating to a different item or unmounting the
  // detail view aborts the in-flight call and stale responses (enrichId
  // mismatch) are dropped before they can overwrite the catalogue.
  const activeCardEnrichIdRef = useRef(null);
  const cardEnrichAbortRef = useRef(null);
  // Auto-refresh queue abort registry. Effect cleanup aborts every
  // in-flight fetch so responses can't land after the user opens a card.
  const autoRefreshAbortersRef = useRef(new Set());

  // FIX 1 PHASE 2 — Metadata now bundled in /api/enrich response.
  // No separate fetch needed (story/creators/pop/goCollect arrive with pricing).
  // loadDeferredMetadata removed (was SPEED-2a optimization, now reversed).

  // Sync tradePiles to localStorage on change
  useEffect(() => {
    saveTradePiles(tradePiles);
  }, [tradePiles]);

  // ACCESS GATE — Check for vault key on mount
  useEffect(() => {
    const key = localStorage.getItem('vault_key');
    if (!key) {
      setShowAccessModal(true);
    }
  }, []);

  // Load catalogue, snapshots, and cached analysis from IndexedDB on mount.
  useEffect(() => {
    // Warm up grade + enrich endpoints silently (skip if no key yet)
    const key = localStorage.getItem('vault_key');
    if (!key) return;

    fetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getVaultHeaders() },
      body: JSON.stringify({ warmup: true })
    }).catch(() => {});
    fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getVaultHeaders() },
      body: JSON.stringify({ warmup: true })
    }).catch(() => {});

    (async () => {
      await migrateFromLocalStorage();
      const items = await getAllComics();
      setCatalogue(items.map(normalizeItem)); // STRUCTURAL FIX: normalize on load
      const snaps = await getAllSnapshots();
      setSnapshots(snaps);
      const cached = await getAnalysis();
      if (cached) setAnalysis(cached);
    })();
  }, []);

  // P0-B: Auto-heal books with NO price at all (genuinely incomplete scans).
  // A book with a price is NEVER auto-refreshed — price is frozen after initial scan.
  // Only fires when on collection tab with no detail open, 5-min cooldown.
  useEffect(() => {
    if (catalogue.length === 0) return;
    if (tab !== "collection") return;
    if (selectedItem) return;
    if (Date.now() - lastAutoRefreshRef.current < 300000) return;
    lastAutoRefreshRef.current = Date.now();
    // Skip books imported in the last 5 minutes — bulk import enrich is still
    // in flight and would race with auto-refresh, overwriting fresh data.
    const isRecentlyImported = (c) =>
      Date.now() - (c.timestamp || 0) < 300000;
    // Skip mega-key books with estimated floors or manual-review flags —
    // thin comps could overwrite the protected floor. Verified floors still
    // refresh normally (they're trusted and can be updated).
    const isUnverifiedMegaKey = (c) =>
      c.manualReviewRequired ||
      (c.megaKeyFloorApplied && !c.megaKeyFloorVerified);
    // P0-B: ONLY auto-refresh books that:
    //  1. Have NO price/comps at all (genuinely incomplete)
    //  2. Are >24h old (not recent scans)
    //  3. Are not currently enriching (marketPending !== true)
    // A book WITH a price is never touched — user must manually refresh.
    // Q87: ID_REQUIRED enrich cache — auto-refresh skips blocked books
    // until a user identity edit bumps identityRevision.
    const isQ87Cached = (c) => {
      const cached = shouldSkipIdRequiredEnrich(c);
      if (cached) {
        console.log(`[Q87] skip — ID_REQUIRED unchanged at identityRevision ${c.identityRevision || 0}: "${c.title}"`);
      }
      return cached;
    };
    const missingSource = catalogue.filter(
      (c) =>
        !isRecentlyImported(c) &&
        !isUnverifiedMegaKey(c) &&
        !isQ87Cached(c) &&
        !c.inTradePile &&
        (!c.pricingSource || !c.comps) &&
        (Date.now() - (c.timestamp || 0) > 86400000) &&  // >24h old
        c.marketPending !== true  // Not currently enriching
    );
    const missingIds = new Set(missingSource.map((c) => c.id));

    // Find duplicate groups with inconsistent prices.
    const groups = {};
    catalogue.forEach((c) => {
      const key = [c.title?.toLowerCase(), c.issue, c.year].join("|");
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    const dupStale = [];
    Object.values(groups).forEach((group) => {
      if (group.length < 2) return;
      const prices = group.map((c) =>
        parseFloat(String(c.price || "0").replace(/[$,]/g, ""))
      );
      if (!prices.every((p) => p === prices[0])) {
        const oldest = group.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))[0];
        if (
          !missingIds.has(oldest.id) &&
          !isRecentlyImported(oldest) &&
          !isUnverifiedMegaKey(oldest)
        ) dupStale.push(oldest);
      }
    });

    const stale = [...missingSource, ...dupStale];
    if (stale.length === 0) return;
    let cancelled = false;
    setRefreshingPrices(stale.length);
    const queue = stale.slice();
    let active = 0;
    const MAX_CONCURRENT = 3;
    const next = () => {
      while (active < MAX_CONCURRENT && queue.length > 0 && !cancelled) {
        const item = queue.shift();
        active++;
        const controller = new AbortController();
        autoRefreshAbortersRef.current.add(controller);
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getVaultHeaders() },
          body: JSON.stringify({
            title: item.title,
            issue: item.issue || item.title?.match(/#(\d+)/)?.[1] || null,
            grade: item.grade,
            isGraded: item.isGraded,
            numericGrade: item.numericGrade,
            year: item.year,
            publisher: item.publisher,
            confidence: item.confidence,
            variant: item.variant || null,
            keyIssue: item.keyIssue || null,
            labelType: item.labelType || null,
            labelNotes: item.labelNotes || null,
            // Ship 10.2 — Pass Vision condition report to enrich.
            reason: item.reason || null,
            images: item.images?.[0] ? [item.images[0]] : [],  // Ship #20a.6.19: pass stored image for variant identity
            // P0 CRITICAL — Pass cached claudeCheck to skip AI on refresh
            skipClaudeCheck: true,
            claudeCheckCached: item.claudeCheck || null,
            // Book-level comps cache — skip 5-9s eBay fetch on refresh
            compsCachedAt: item.compsCachedAt || null,
            activeCached: item.activeCached || null,
            soldCompsRawCached: item.soldCompsRawCached || [],
            // FIX: Skip image search on auto-refresh (same as manual refreshMarketData).
            // Auto-refresh updates PRICING for existing books (identity already confirmed).
            // Ambush Bug flicker + "prices change on card open" root cause: auto-refresh
            // sent stored image → title-family clustering → identity changed/refused →
            // comps=null → overwrote real data. Creates infinite loop for price=null books.
            skipImageSearch: true,
          }),
          signal: controller.signal,
        })
          .then((r) => {
            // Handle 401 unauthorized
            if (r.status === 401) {
              clearVaultKey();
              setShowAccessModal(true);
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .then((enrich) => {
            if (cancelled || !enrich) return;
            // Gate: when matchConfidence is LOW, auto-refresh must NOT
            // overwrite price/comps fields — comps are loose substitutes,
            // not exact matches. Non-price metadata (matchConfidence, year
            // heal, comicVine, cgcVerified, goCollect) still flows so the
            // UI can render the warning and require a manual refresh.
            const lowMatch = enrich.matchConfidence?.tier === "LOW";
            if (lowMatch) {
              console.log('[refresh] LOW match confidence — skipping price update for', item.title);
            }
            setCatalogue((prev) => {
              const cur = prev.find((x) => x.id === item.id);
              if (!cur) return prev;
              if (enrich.yearCorrected && enrich.confirmedYear) {
                console.log('[refresh] year healed:', cur.year, '→', enrich.confirmedYear);
              }
              // Ship #20a.6.4 — idGated forces null on price triplet so
              // Vision's stored guess can't survive the merge default of
              // "enrich.price || cur.price". Default-true on missing
              // identityConfident protects existing catalog entries.
              const idGated = enrich.identityConfident === false;

              // Quality guard: better data never replaced by worse (Principle 2)
              const priceGuard = idGated || lowMatch
                ? { price: idGated ? null : cur.price,
                    priceLow: idGated ? null : cur.priceLow,
                    priceHigh: idGated ? null : cur.priceHigh,
                    pricingSource: cur.pricingSource,
                    priceNote: cur.priceNote }
                : chooseBetterPrice(enrich, cur);
              const gradeGuard = chooseBetterGrade(enrich, cur);

              // P0-C: Sync decision to displayed price. Decision recomputed on every refresh
              // even if price unchanged (sold/active ratio, warnings can shift verdict).
              const priceChangedAR = priceGuard.price !== cur.price;
              const syncedDecision = enrich.decision || cur.decision;

              const updated = {
                ...cur,
                // Q87: stamp the revision this ID_REQUIRED verdict was
                // computed at; cleared when identity becomes confident.
                q87CheckedRevision: idGated ? (cur.identityRevision || 0) : null,
                comps: lowMatch ? cur.comps : (enrich.comps || cur.comps),
                price: priceGuard.price,
                priceLow: priceGuard.priceLow,
                priceHigh: priceGuard.priceHigh,
                pricingSource: priceGuard.pricingSource,
                priceNote: priceGuard.priceNote,
                priceUpdatedAt: priceChangedAR ? (enrich.priceUpdatedAt || Date.now()) : (cur.priceUpdatedAt || cur.timestamp),
                grade: gradeGuard.grade,
                confidenceLevel: gradeGuard.confidenceLevel,
                identityConfident: enrich.identityConfident ?? cur.identityConfident ?? true,
                identityMissingFields: enrich.identityMissingFields ?? cur.identityMissingFields ?? null,
                identityReasons: enrich.identityReasons ?? cur.identityReasons ?? null,
                // Ship 6.2 — Polybag-aware merge.
                // When backend detects polybag, enrich.keyIssue is null and
                // enrich.title/year/comicVine are overridden. Default ||
                // fallback would preserve old first-print values. Polybag
                // flag forces use of enrich values even when null.
                keyIssue: enrich.polybagDetected ? null : (enrich.keyIssue || cur.keyIssue),
                keyIssueSource: enrich.polybagDetected ? null : (enrich.keyIssueSource || cur.keyIssueSource || null),
                polybagDetected: enrich.polybagDetected === true,
                polybagYear: enrich.polybagYear || null,
                polybagEditionLabel: enrich.polybagEditionLabel || null,
                originalTitle: enrich.originalTitle || cur.originalTitle || null,
                originalYear: enrich.originalYear || cur.originalYear || null,
                originalKeyIssue: enrich.originalKeyIssue || cur.originalKeyIssue || null,
                title: enrich.title || cur.title,
                keyFromComps: enrich.keyFromComps || cur.keyFromComps || [],
                keyFromCompsSingleton: enrich.keyFromCompsSingleton || cur.keyFromCompsSingleton || [],
                creatorFromComps: enrich.creatorFromComps || cur.creatorFromComps || [],
                creatorFromCompsSingleton: enrich.creatorFromCompsSingleton || cur.creatorFromCompsSingleton || [],
                soldComps: enrich.soldComps || cur.soldComps || [],
                soldCompsRaw: enrich.soldCompsRaw || cur.soldCompsRaw || [],
                soldCompDiagnostics: enrich.soldCompDiagnostics || cur.soldCompDiagnostics || null,
                // P0-B — Persist tier-based pricing metadata
                priceBands: enrich.priceBands || cur.priceBands || {},
                demandSignals: enrich.demandSignals || cur.demandSignals || {},
                // Book-level comps cache fields
                compsCachedAt: enrich.compsCachedAt || cur.compsCachedAt || null,
                activeCached: enrich.activeCached || cur.activeCached || null,
                soldCompsRawCached: enrich.soldCompsRawCached || cur.soldCompsRawCached || [],
                imageSearchResults: enrich.imageSearchResults || cur.imageSearchResults || null,
                salesByGrade: enrich.salesByGrade || cur.salesByGrade || null,
                priceLadder: enrich.priceLadder || cur.priceLadder || null,
                salesVelocity: enrich.salesVelocity || cur.salesVelocity || null,
                matchConfidence: enrich.matchConfidence || cur.matchConfidence || null,
                decision: syncedDecision,
                // Ship #24a-3 — canonical contract. Follows the same
                // LOW-match gate as price fields: a LOW-tier refresh must
                // not swap in a contract that contradicts preserved data.
                contract: (idGated || !lowMatch)
                  ? (enrich.contract ?? cur.contract ?? null)
                  : (cur.contract ?? null),
                gradeMultiplier: lowMatch ? cur.gradeMultiplier : (enrich.gradeMultiplier || null),
                defectPenalty: enrich.defectPenalty || cur.defectPenalty || null,
                comicVine: enrich.polybagDetected ? null : (enrich.comicVine || cur.comicVine || null),
                certNumber: enrich.certNumber || cur.certNumber || null, labelType: enrich.labelType || cur.labelType || null, labelNotes: enrich.labelNotes || cur.labelNotes || null,
                cgcVerified: enrich.cgcVerified || cur.cgcVerified || false,
                cgcLabel: enrich.cgcLabel || cur.cgcLabel || null,
                goCollect: enrich.goCollect || cur.goCollect || null,
                variant: enrich.variantNote || cur.variant || null,
                variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null,
                year: enrich.polybagDetected && enrich.year
                  ? enrich.year
                  : (enrich.yearCorrected && enrich.confirmedYear ? enrich.confirmedYear : cur.year),
                // Mega-key floor flags — flow even under lowMatch (they're identity, not price)
                megaKeyFloorApplied: enrich.megaKeyFloorApplied === true,
                megaKeyFloorVerified: enrich.megaKeyFloorVerified === true,
                megaKeyFloorSource: enrich.megaKeyFloorSource || null,
                megaKeyFloorNote: enrich.megaKeyFloorNote || null,
                preFloorPrice: enrich.preFloorPrice || null,
                preFloorSource: enrich.preFloorSource || null,
                manualReviewRequired: enrich.manualReviewRequired === true,
                manualReviewReason: enrich.manualReviewReason || null,
                gradeExceedsMap: enrich.gradeExceedsMap === true,
                gradeExceedsMapReason: enrich.gradeExceedsMapReason || null,
                compsExhausted: enrich.compsExhausted === true,
                pop: enrich.pop || cur.pop || null,
                compEraFilterBypassed: enrich.compEraFilterBypassed === true,
                // Ship #13 observability
                thinPoolAnchored: enrich.thinPoolAnchored === true,
                variantComposition: enrich.variantComposition || null,
                sequelRejected: enrich.sequelRejected || 0,
                signedRejected: enrich.signedRejected || 0,
                multiIssueRejected: enrich.multiIssueRejected || 0,
                // Ship #17 observability
                lowGradeFloorApplied: enrich.lowGradeFloorApplied === true,
                lowGradeFloorAnchor: enrich.lowGradeFloorAnchor || null,
                // Ship #18 — preserve Vision-set penalty flags
                cgcPenaltyFlags: enrich.cgcPenaltyFlags || cur.cgcPenaltyFlags || null,
                // Ship #19 — preserve Vision-set editionWarning + ack state
                editionWarning: enrich.editionWarning || cur.editionWarning || null,
                editionConfirmed: cur.editionConfirmed || false,
                megaKeysSchemaVersion: enrich.megaKeysSchemaVersion || null,
                manualConfirmed: priceChangedAR ? false : (cur.manualConfirmed || false),
              };
              putComic(updated).catch(() => {});
              return prev.map((x) => {
                if (x.id === item.id) return updated;
                // Sync duplicate copies with same title + issue + year.
                if (x.title?.toLowerCase() === item.title?.toLowerCase()
                  && x.issue === item.issue
                  && x.year === item.year) {
                  // Ship #20a.6.4 — duplicate sync respects idGated.
                  const synced = idGated
                    ? { ...x, price: null, priceLow: null, priceHigh: null, comps: enrich.comps ?? x.comps, pricingSource: enrich.pricingSource ?? x.pricingSource, priceNote: enrich.priceNote ?? null, gradeMultiplier: enrich.gradeMultiplier ?? x.gradeMultiplier, identityConfident: false, identityMissingFields: enrich.identityMissingFields ?? null, identityReasons: enrich.identityReasons ?? null }
                    : { ...x, price: enrich.price ?? x.price, priceLow: enrich.priceLow ?? x.priceLow, priceHigh: enrich.priceHigh ?? x.priceHigh, comps: enrich.comps ?? x.comps, pricingSource: enrich.pricingSource ?? x.pricingSource, priceNote: enrich.priceNote ?? null, gradeMultiplier: enrich.gradeMultiplier ?? x.gradeMultiplier, identityConfident: enrich.identityConfident ?? x.identityConfident ?? true };
                  putComic(synced).catch(() => {});
                  return synced;
                }
                return x;
              });
            });
            // FIX 4: update detail view if open during background refresh.
            // Blind spread includes mega-key flags; manualConfirmed is reset
            // when price changed so user must re-acknowledge on new floor.
            setSelectedItem((s) => {
              if (!s || s.id !== item.id) return s;
              const newP = lowMatch ? s.price : (enrich.price || s.price);
              const pc = newP !== s.price;
              return {
                ...s, ...enrich,
                comicVine: enrich.comicVine || s.comicVine || null,
                certNumber: enrich.certNumber || s.certNumber || null, labelType: enrich.labelType || s.labelType || null, labelNotes: enrich.labelNotes || s.labelNotes || null,
                cgcVerified: enrich.cgcVerified || s.cgcVerified || false,
                cgcLabel: enrich.cgcLabel || s.cgcLabel || null,
                goCollect: enrich.goCollect || s.goCollect || null,
                // FIX: Explicit preservation (redundant with spread, but defensive)
                claudeCheck: enrich.claudeCheck || s.claudeCheck || null,
                priceBands: enrich.priceBands || s.priceBands || null,
                demandSignals: enrich.demandSignals || s.demandSignals || null,
                // Ship #24a-3 — same LOW-match gate as the catalogue merge
                contract: lowMatch ? (s.contract ?? null) : (enrich.contract ?? s.contract ?? null),
                manualConfirmed: pc ? false : (s.manualConfirmed || false),
              };
            });
            // SPEED-2a: Load deferred metadata asynchronously
            // Metadata now bundled in enrich response (no separate fetch)
          })
          .catch((err) => {
            if (err?.name === "AbortError") {
              console.log("[auto-refresh] aborted for", item.title);
            }
          })
          .finally(() => {
            autoRefreshAbortersRef.current.delete(controller);
            if (cancelled) return;
            active--;
            setRefreshingPrices((n) => Math.max(0, n - 1));
            next();
          });
      }
    };
    next();
    return () => {
      cancelled = true;
      // Abort every in-flight auto-refresh fetch so responses can't land
      // after the user opens a detail card or switches tabs.
      for (const c of autoRefreshAbortersRef.current) c.abort();
      autoRefreshAbortersRef.current.clear();
    };
  }, [catalogue.length > 0 && catalogue.some((c) => !c.pricingSource || !c.comps), tab, selectedItem]);

  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const id = setInterval(() => {
      setStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 1200);
    return () => clearInterval(id);
  }, [loading]);

  // PWA install eligibility detection:
  //  - Chrome / Android fires `beforeinstallprompt`; capture the event so the
  //    banner can trigger the native install flow via installPrompt.prompt().
  //  - iOS Safari never fires that event — detect it manually and show an
  //    instructional banner pointing at the Share sheet instead.
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    const ua = navigator.userAgent || "";
    const isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
    const isSafari = isIOS && !ua.includes("CriOS");
    if (isSafari && !window.navigator.standalone) {
      setShowSafariBanner(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  // Auto-dismiss the install banner 8s after it becomes visible.
  // IMPORTANT: keyed to the banner's visibility state, NOT to mount —
  // Chrome's `beforeinstallprompt` engagement heuristic often fires
  // 30+ seconds after mount, so a mount-keyed timer would expire long
  // before the banner ever appears and the banner would stay forever.
  // This version restarts the 8s countdown when the banner first shows.
  // Non-persistent: banner reappears next session unless the user taps ✕.
  useEffect(() => {
    if (installDismissed) return;
    if (!installPrompt && !showSafariBanner) return;
    const t = setTimeout(() => {
      setInstallPrompt(null);
      setShowSafariBanner(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [installDismissed, installPrompt, showSafariBanner]);

  const addToCatalogue = useCallback(async (data, sourceDataUrl) => {
    let thumb = null;
    try {
      thumb = sourceDataUrl ? await makeThumbnail(sourceDataUrl) : null;
    } catch {
      thumb = null;
    }
    const entry = {
      id: `cv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: data.title || "",
      publisher: data.publisher || "",
      year: data.year || "",
      grade: data.grade || "",
      isGraded: data.isGraded === true,
      numericGrade:
        typeof data.numericGrade === "number" ? data.numericGrade : null,
      issue: data.issue || null,
      keyIssue: data.keyIssue || "",
      price: null,  // ignore data.price, will be calculated by enrich.js
      priceLow: null,
      priceHigh: null,
      reason: data.reason || "",
      confidence: data.confidence || "",
      restoration: data.restoration || null,
      defectPenalty: data.defectPenalty || null,
      cgcPenaltyFlags: data.cgcPenaltyFlags || null,
      editionWarning: data.editionWarning || null,
      editionConfirmed: false,
      variant: data.variant || null,
      variantMultiplier: data.variantMultiplier || null,
      certNumber: data.certNumber || null,
      labelType: data.labelType || null,
      labelNotes: data.labelNotes || null,
      cgcVerified: data.cgcVerified || false,
      cgcLabel: data.cgcLabel || null,
      purchasePrice: data.purchasePrice != null ? parseFloat(data.purchasePrice) || null : null,
      timestamp: Date.now(),
      marketPending: true,  // signal price not ready, enrich in progress
      images: thumb ? [thumb] : [],
    };
    try {
      await putComic(entry);
    } catch (err) {
      // IndexedDB quota errors are rare but possible on very large libraries.
      // Retry once without photos before giving up.
      if (entry.images.length > 0) {
        try {
          await putComic({ ...entry, images: [] });
          entry.images = [];
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }
    setCatalogue((prev) => [normalizeItem(entry), ...prev]); // STRUCTURAL FIX
    return entry.id;
  }, []);

  const gradeBlob = useCallback(
    async (blob, { save = false, buyerMode = false } = {}) => {
      setError(null);
      setResult(null);
      setEnriching(false);
      setLoading(true);
      try {
        const rawB64 = await fileToBase64(blob);
        // Compress in-browser before upload to stay well under Vercel's
        // 4.5MB request body limit. Max 1200px on the longest side,
        // JPEG quality 0.85. Reuses the same canvas helper the catalogue
        // thumbnail path uses.
        const b64 = await makeThumbnail(rawB64, 1200, 0.85);
        // Buyer mode: route grade through the watch-mode Sonnet pipeline
        // (pass-1 fast ID, pass-2 self-correct, pass-3 Opus escalate only
        // if still low confidence). ~5x faster on the common case where
        // the book is clearly identifiable. Scan tab stays on the full
        // Opus standard path for condition-report accuracy.
        const gradeBody = buyerMode
          ? { images: [b64], source: 'watch' }
          : { images: [b64] };
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getVaultHeaders() },
          body: JSON.stringify(gradeBody),
        });
        const data = await res.json();

        // Handle 401 unauthorized (wrong/missing access code)
        if (res.status === 401) {
          clearVaultKey();
          setShowAccessModal(true);
          throw new Error("Access denied. Please enter your access code.");
        }

        if (!res.ok) throw new Error(data.error || "Failed to grade");

        // FIX 2: Non-comic rejection
        if (!data.title ||
            data.title.toLowerCase().includes('not a comic') ||
            data.title.toLowerCase().includes('unknown') ||
            (!data.publisher && !data.year && !data.issue)) {
          setError("No comic detected. Try again.");
          setLoading(false);
          return;
        }

        // Extract issue number: prefer explicit field, fall back to parsing title.
        const issueNum = data.issue || data.title?.match(/#(\d+)/)?.[1] || null;
        console.log('[grade] title:', data.title, 'issue:', issueNum);

        // Duplicate detection: skip auto-save if already in collection.
        const isDuplicate = save && catalogue.some(c =>
          c.title?.toLowerCase() === data.title?.toLowerCase() &&
          c.issue === issueNum &&
          c.year === data.year
        );
        if (isDuplicate) {
          setDuplicateWarning({ title: data.title, issue: issueNum, year: data.year });
          setPendingDuplicate({ data: { ...data, issue: issueNum }, b64 });
        } else {
          setDuplicateWarning(null);
          setPendingDuplicate(null);
        }

        // FIX 4: Set grade lock on HIGH confidence
        if (data.confidence?.toLowerCase() === 'high') {
          data.gradeLocked = true;
        }

        // Show the Claude result immediately.
        setResult({ ...data, issue: issueNum, image: b64 });
        setLoading(false);
        const savedId = (save && !isDuplicate) ? await addToCatalogue({ ...data, issue: issueNum }, b64) : null;

        // Fire-and-forget enrichment pass — merges into the card when ready.
        // Buyer mode skips `images` to bypass Ximilar visual search (saves
        // ~500-800ms on the enrich critical path). Price + comps still fire
        // (PriceCharting, ComicVine, eBay browse/sold, GoCollect) — we just
        // trust the grade-pass identification in live-buying context.
        setEnriching(true);
        const enrichBody = {
          title: data.title,
          issue: issueNum,
          grade: data.grade,
          isGraded: data.isGraded,
          numericGrade: data.numericGrade,
          year: data.year,
          publisher: data.publisher,
          confidence: data.confidence,
          defectPenalty: data.defectPenalty || null,
          certNumber: data.certNumber || null,
          labelType: data.labelType || null,
          labelNotes: data.labelNotes || null,
          variant: data.variant || null,
          keyIssue: data.keyIssue || null,
          creator: data.creator || null,
          // Ship 10.2 — Pass Vision condition report to enrich so claudeCheck
          // has condition data and stops false-refusing with "No condition
          // details provided".
          reason: data.reason || null,
          // Session 4B — Pass assetType from grade.js (book vs comic routing)
          assetType: data.assetType || 'comic',
        };
        if (!buyerMode) enrichBody.images = [b64];
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getVaultHeaders() },
          body: JSON.stringify(enrichBody),
        })
          .then((r) => {
            // Handle 401 unauthorized
            if (r.status === 401) {
              clearVaultKey();
              setShowAccessModal(true);
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .then((enrich) => {
            if (!enrich) return;
            // Explicitly preserve the cover image from the initial grade
            // response in case enrich ever returns its own image field.
            setResult((prev) =>
              prev ? { ...prev, ...enrich, image: prev.image } : prev
            );
            // Persist comps + enriched price fields into the stored
            // catalogue entry so CollectionDetail can display them after
            // a refresh from IndexedDB — AND update selectedItem in case
            // the user is already viewing the detail page for this comic
            // (otherwise the detail view would keep rendering the stale
            // pre-enrich entry until they close and reopen it).
            if (savedId) {
              // Use setCatalogue updater to get the CURRENT state (avoids
              // stale closure — catalogue from gradeBlob call time won't
              // contain the item that addToCatalogue just inserted).
              setCatalogue((prev) => {
                const cur = prev.find((x) => x.id === savedId);
                if (!cur) return prev;
                if (enrich.yearCorrected && enrich.confirmedYear) {
                  console.log('[scan] year healed:', cur.year, '→', enrich.confirmedYear);
                }
                // Ship #20a.6.4 — see auto-refresh path for full rationale.
                const idGated = enrich.identityConfident === false;

                // Quality guard: better data never replaced by worse (Principle 2)
                const priceGuardB = idGated
                  ? { price: null, priceLow: null, priceHigh: null,
                      pricingSource: cur.pricingSource, priceNote: cur.priceNote }
                  : chooseBetterPrice(enrich, cur);
                const gradeGuardB = chooseBetterGrade(enrich, cur);
                const priceChanged = priceGuardB.price && priceGuardB.price !== cur.price;

                // P0-C: Sync decision to displayed price (scan path)
                // Always use new decision when present (verdict can change without price change)
                const syncedDecisionB = enrich.decision || cur.decision;

                const updated = {
                  ...cur,
                  comps: enrich.comps || cur.comps,
                  price: priceGuardB.price,
                  priceLow: priceGuardB.priceLow,
                  priceHigh: priceGuardB.priceHigh,
                  pricingSource: priceGuardB.pricingSource,
                  priceNote: priceGuardB.priceNote,
                  priceUpdatedAt: priceChanged ? (enrich.priceUpdatedAt || Date.now()) : (cur.priceUpdatedAt || cur.timestamp),
                  grade: gradeGuardB.grade,
                  confidenceLevel: gradeGuardB.confidenceLevel,
                  identityConfident: enrich.identityConfident ?? cur.identityConfident ?? true,
                  identityMissingFields: enrich.identityMissingFields ?? cur.identityMissingFields ?? null,
                  identityReasons: enrich.identityReasons ?? cur.identityReasons ?? null,
                  keyIssue: enrich.keyIssue || cur.keyIssue,
                  keyIssueSource: enrich.keyIssueSource || cur.keyIssueSource || null,
                  keyFromComps: enrich.keyFromComps || cur.keyFromComps || [],
                  keyFromCompsSingleton: enrich.keyFromCompsSingleton || cur.keyFromCompsSingleton || [],
                  creatorFromComps: enrich.creatorFromComps || cur.creatorFromComps || [],
                  creatorFromCompsSingleton: enrich.creatorFromCompsSingleton || cur.creatorFromCompsSingleton || [],
                  soldComps: enrich.soldComps || cur.soldComps || [],
                  soldCompsRaw: enrich.soldCompsRaw || cur.soldCompsRaw || [],
                  soldCompDiagnostics: enrich.soldCompDiagnostics || cur.soldCompDiagnostics || null,
                  imageSearchResults: enrich.imageSearchResults || cur.imageSearchResults || null,
                  salesByGrade: enrich.salesByGrade || cur.salesByGrade || null,
                  priceLadder: enrich.priceLadder || cur.priceLadder || null,
                  salesVelocity: enrich.salesVelocity || cur.salesVelocity || null,
                  matchConfidence: enrich.matchConfidence || cur.matchConfidence || null,
                  gradeMultiplier: enrich.gradeMultiplier || null,
                  // Preserve manual list price edits
                  listPrice: cur.listPrice,
                  listPriceManual: cur.listPriceManual,
                  // Clear pending flag when enrich completes
                  marketPending: false,
                  comicVine: enrich.comicVine || cur.comicVine || null,
                  certNumber: enrich.certNumber || cur.certNumber || null, labelType: enrich.labelType || cur.labelType || null, labelNotes: enrich.labelNotes || cur.labelNotes || null,
                  cgcVerified: enrich.cgcVerified || cur.cgcVerified || false,
                  cgcLabel: enrich.cgcLabel || cur.cgcLabel || null,
                  variant: enrich.variantNote || cur.variant || null,
                  variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null,
                  year: enrich.polybagDetected && enrich.year
                    ? enrich.year
                    : (enrich.yearCorrected && enrich.confirmedYear ? enrich.confirmedYear : cur.year),
                  // Mega-key floor flags (Tier 0 hotfix — persist from enrich)
                  megaKeyFloorApplied: enrich.megaKeyFloorApplied === true,
                  megaKeyFloorVerified: enrich.megaKeyFloorVerified === true,
                  megaKeyFloorSource: enrich.megaKeyFloorSource || null,
                  megaKeyFloorNote: enrich.megaKeyFloorNote || null,
                  preFloorPrice: enrich.preFloorPrice || null,
                  preFloorSource: enrich.preFloorSource || null,
                  manualReviewRequired: enrich.manualReviewRequired === true,
                  manualReviewReason: enrich.manualReviewReason || null,
                  gradeExceedsMap: enrich.gradeExceedsMap === true,
                  gradeExceedsMapReason: enrich.gradeExceedsMapReason || null,
                  compsExhausted: enrich.compsExhausted === true,
                  pop: enrich.pop || cur.pop || null,
                  compEraFilterBypassed: enrich.compEraFilterBypassed === true,
                  // Ship #13 observability
                  thinPoolAnchored: enrich.thinPoolAnchored === true,
                  variantComposition: enrich.variantComposition || null,
                  sequelRejected: enrich.sequelRejected || 0,
                  signedRejected: enrich.signedRejected || 0,
                  multiIssueRejected: enrich.multiIssueRejected || 0,
                  // Ship #17 observability
                  lowGradeFloorApplied: enrich.lowGradeFloorApplied === true,
                  lowGradeFloorAnchor: enrich.lowGradeFloorAnchor || null,
                  // Ship #18 — preserve Vision-set penalty flags
                  cgcPenaltyFlags: enrich.cgcPenaltyFlags || cur.cgcPenaltyFlags || null,
                  // Ship #19 — preserve Vision-set editionWarning + ack state
                  editionWarning: enrich.editionWarning || cur.editionWarning || null,
                  editionConfirmed: cur.editionConfirmed || false,
                  // Ship #26 — Decision Engine v0-B
                  decision: syncedDecisionB,
                  contract: enrich.contract ?? cur.contract ?? null, // Ship #24a-3
                  // FIX: Persist AI/pricing state to eliminate stale-refresh loop
                  claudeCheck: enrich.claudeCheck || cur.claudeCheck || null,
                  priceBands: enrich.priceBands || cur.priceBands || null,
                  demandSignals: enrich.demandSignals || cur.demandSignals || null,
                  megaKeysSchemaVersion: enrich.megaKeysSchemaVersion || null,
                  manualConfirmed: priceChanged ? false : (cur.manualConfirmed || false),
                };
                console.log('[persist] savedId:', savedId,
                  'price:', updated.price,
                  'comps count:', updated.comps?.count,
                  'megaKey:', updated.megaKeyFloorApplied);
                putComic(updated).catch(() => {});
                return prev.map((x) => x.id === savedId ? updated : x);
              });
              setSelectedItem((s) => {
                if (!s || s.id !== savedId) return s;
                const priceChangedSel = enrich.price && enrich.price !== s.price;
                // Ship #20a.6.4 — see auto-refresh path for full rationale.
                const idGatedSel = enrich.identityConfident === false;
                return {
                  ...s,
                  comps: enrich.comps || s.comps,
                  price: idGatedSel ? null : (enrich.price || s.price),
                  priceLow: idGatedSel ? null : (enrich.priceLow || s.priceLow),
                  priceHigh: idGatedSel ? null : (enrich.priceHigh || s.priceHigh),
                  identityConfident: enrich.identityConfident ?? s.identityConfident ?? true,
                  identityMissingFields: enrich.identityMissingFields ?? s.identityMissingFields ?? null,
                  identityReasons: enrich.identityReasons ?? s.identityReasons ?? null,
                  keyIssue: enrich.keyIssue || s.keyIssue,
                  keyIssueSource: enrich.keyIssueSource || s.keyIssueSource || null,
                  keyFromComps: enrich.keyFromComps || s.keyFromComps || [],
                  keyFromCompsSingleton: enrich.keyFromCompsSingleton || s.keyFromCompsSingleton || [],
                  creatorFromComps: enrich.creatorFromComps || s.creatorFromComps || [],
                  creatorFromCompsSingleton: enrich.creatorFromCompsSingleton || s.creatorFromCompsSingleton || [],
                  soldComps: enrich.soldComps || s.soldComps || [],
                  soldCompsRaw: enrich.soldCompsRaw || s.soldCompsRaw || [],
                  soldCompDiagnostics: enrich.soldCompDiagnostics || s.soldCompDiagnostics || null,
                  imageSearchResults: enrich.imageSearchResults || s.imageSearchResults || null,
                  salesByGrade: enrich.salesByGrade || s.salesByGrade || null,
                  priceLadder: enrich.priceLadder || s.priceLadder || null,
                  salesVelocity: enrich.salesVelocity || s.salesVelocity || null,
                  confidenceLevel: enrich.confidenceLevel || s.confidenceLevel || "LOW",
                  matchConfidence: enrich.matchConfidence || s.matchConfidence || null,
                  contract: enrich.contract ?? s.contract ?? null, // Ship #24a-3
                  pricingSource: enrich.pricingSource || null,
                  priceNote: enrich.priceNote || null,
                  gradeMultiplier: enrich.gradeMultiplier || null,
                  // Preserve manual list price edits
                  listPrice: s.listPrice,
                  listPriceManual: s.listPriceManual,
                  // Clear pending flag when enrich completes
                  marketPending: false,
                  defectPenalty: enrich.defectPenalty || s.defectPenalty || null,
                  comicVine: enrich.comicVine || s.comicVine || null,
                  certNumber: enrich.certNumber || s.certNumber || null, labelType: enrich.labelType || s.labelType || null, labelNotes: enrich.labelNotes || s.labelNotes || null,
                  cgcVerified: enrich.cgcVerified || s.cgcVerified || false,
                  cgcLabel: enrich.cgcLabel || s.cgcLabel || null,
                  goCollect: enrich.goCollect || s.goCollect || null,
                  variant: enrich.variantNote || s.variant || null,
                  variantMultiplier: enrich.variantMultiplier || s.variantMultiplier || null,
                  // Mega-key floor flags
                  megaKeyFloorApplied: enrich.megaKeyFloorApplied === true,
                  megaKeyFloorVerified: enrich.megaKeyFloorVerified === true,
                  megaKeyFloorSource: enrich.megaKeyFloorSource || null,
                  megaKeyFloorNote: enrich.megaKeyFloorNote || null,
                  preFloorPrice: enrich.preFloorPrice || null,
                  preFloorSource: enrich.preFloorSource || null,
                  manualReviewRequired: enrich.manualReviewRequired === true,
                  manualReviewReason: enrich.manualReviewReason || null,
                  gradeExceedsMap: enrich.gradeExceedsMap === true,
                  gradeExceedsMapReason: enrich.gradeExceedsMapReason || null,
                  compsExhausted: enrich.compsExhausted === true,
                  pop: enrich.pop || s.pop || null,
                  compEraFilterBypassed: enrich.compEraFilterBypassed === true,
                  // Ship #13 observability
                  thinPoolAnchored: enrich.thinPoolAnchored === true,
                  variantComposition: enrich.variantComposition || null,
                  sequelRejected: enrich.sequelRejected || 0,
                  signedRejected: enrich.signedRejected || 0,
                  multiIssueRejected: enrich.multiIssueRejected || 0,
                  // Ship #17 observability
                  lowGradeFloorApplied: enrich.lowGradeFloorApplied === true,
                  lowGradeFloorAnchor: enrich.lowGradeFloorAnchor || null,
                  // Ship #18 — preserve Vision-set penalty flags
                  cgcPenaltyFlags: enrich.cgcPenaltyFlags || s.cgcPenaltyFlags || null,
                  // Ship #19 — preserve Vision-set editionWarning + ack state
                  editionWarning: enrich.editionWarning || s.editionWarning || null,
                  editionConfirmed: s.editionConfirmed || false,
                  // Ship #26 — Decision Engine v0-B
                  decision: enrich.decision || s.decision,
                  megaKeysSchemaVersion: enrich.megaKeysSchemaVersion || null,
                  manualConfirmed: priceChangedSel ? false : (s.manualConfirmed || false),
                };
              });
              // SPEED-2a: Load deferred metadata asynchronously
              // Metadata now bundled in enrich response (no separate fetch)
            }
          })
          .catch(() => {
            /* enrichment failure is non-fatal */
          })
          .finally(() => setEnriching(false));
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    },
    [addToCatalogue, catalogue]
  );

  const handleFile = async (e, which) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await gradeBlob(file, { save: which === "scan", buyerMode: which === "buyer" });
    if (which === "scan" && fileRef.current) fileRef.current.value = "";
    if (which === "buyer" && buyerFileRef.current) buyerFileRef.current.value = "";
  };

  // TRACK A: Barcode submit handler
  const handleBarcodeSubmit = async (barcode) => {
    if (!barcode) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Skip Vision entirely - go straight to enrich with barcode
      const enrichRes = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getVaultHeaders() },
        body: JSON.stringify({
          barcode,
          title: "Barcode scan",  // placeholder
          skipVision: true,
        }),
      });
      if (!enrichRes.ok) throw new Error("Barcode lookup failed");
      const enrichData = await enrichRes.json();

      if (!enrichData.title || enrichData.identitySource !== 'barcode') {
        throw new Error("Barcode not found in ComicVine database");
      }

      // Show result with barcode-derived identity
      setResult({
        ...enrichData,
        identitySource: 'barcode',
        gradeLocked: true,
      });

      // Save to catalogue
      const savedId = await addToCatalogue(enrichData, null);
      console.log('[barcode] saved:', savedId);

    } catch (err) {
      setError(err.message || "Barcode scan failed");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImport = useCallback(async (files) => {
    setBulkDone(null);
    setBulkProgress({ current: 1, total: files.length, title: "" });
    setBulkEnrichProgress(null);
    let added = 0;
    const errors = [];
    let enrichTotal = 0;
    let enrichDone = 0;
    const bumpEnrichFired = () => {
      enrichTotal++;
      setBulkEnrichProgress({ current: enrichDone, total: enrichTotal });
    };
    const bumpEnrichSettled = () => {
      enrichDone++;
      setBulkEnrichProgress({ current: enrichDone, total: enrichTotal });
    };

    // SPEED BUILD 1 — Parallel grade worker pool (concurrency=3)
    const CONCURRENCY = 3;
    const startTime = Date.now();
    let completed = 0;
    // P0 HOTFIX: shared Set to prevent duplicate races (workers check before grade)
    const inFlightKeys = new Set();

    // Worker function: process one file (compress → grade → save → fire enrich)
    const processFile = async (file, index) => {
      console.log('[bulk] processing file:', file.name);
      try {
        // P0 HOTFIX: restore b64 definition (deleted in dc2e164)
        const rawB64 = await fileToBase64(file);
        const b64 = await makeThumbnail(rawB64, 1200, 0.85);

        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getVaultHeaders() },
          body: JSON.stringify({ images: [b64] }),
        });
        const data = await res.json();

        // P0 HOTFIX: increment progress on ALL paths (error/skip/duplicate/success)
        completed++;
        setBulkProgress({ current: completed, total: files.length, title: data.title || file.name });

        if (!res.ok) {
          const msg = data.error || `HTTP ${res.status}`;
          console.warn('[bulk] grade error for', file.name, msg);
          errors.push(`${file.name}: ${msg}`);
          return;
        }
        console.log('[bulk] grade result:', JSON.stringify(data));

        // Non-comic rejection (mirrors gradeBlob :3844-3852)
        const titleLower = (data.title || '').toLowerCase();
        if (!data.title ||
            titleLower === 'unknown' ||
            titleLower.includes('not a comic') ||
            (!data.publisher && !data.year && !data.issue)) {
          console.warn('[bulk] not a comic, skipping:', file.name);
          errors.push(`${file.name}: not a comic`);
          return;
        }

        // Publisher-as-title detection — WARN, don't block. Book still gets
        // added; user can review and edit the title manually in the catalogue.
        const PUBLISHER_NAMES = [
          'marvel comics', 'dc comics', 'image comics', 'dark horse comics',
          'idw publishing', 'boom studios', 'dynamite entertainment', 'valiant',
          'archie comics', 'oni press', 'vault comics', 'mad cave',
          'aftershock', 'awaken comics',
          'marvel', 'dc', 'image', 'dark horse', 'idw'
        ];
        if (PUBLISHER_NAMES.some(p => titleLower.includes(p)) &&
            data.publisher && titleLower.includes(data.publisher.toLowerCase())) {
          console.warn('[bulk] title may be publisher name:', data.title, file.name);
          data.titleWarning = true;
          data.titleWarningMsg = 'Title may be publisher name — verify';
          errors.push(`${file.name}: title "${data.title}" may be publisher name — added, review manually`);
          // book still gets added
        }

        const bulkIssue = data.issue || data.title?.match(/#(\d+)/)?.[1] || null;

        // P0 HOTFIX: duplicate race — check in-flight Set before grading
        // (workers now share inFlightKeys to prevent concurrent duplicates)
        const dupKey = `${titleLower}|${bulkIssue}|${data.year || ''}`;
        if (inFlightKeys.has(dupKey)) {
          console.log('[bulk] duplicate in-flight, skipping:', data.title, '#' + bulkIssue);
          errors.push(`${file.name}: duplicate in-flight (${data.title} #${bulkIssue})`);
          return;
        }

        // Duplicate detection (mirrors gradeBlob :3859-3863)
        const isDuplicate = catalogue.some(c =>
          c.title?.toLowerCase() === titleLower &&
          c.issue === bulkIssue &&
          c.year === data.year
        );
        if (isDuplicate) {
          console.log('[bulk] duplicate, skipping:', data.title, '#' + bulkIssue);
          errors.push(`${file.name}: duplicate (${data.title} #${bulkIssue})`);
          return;
        }

        // Mark as in-flight to prevent concurrent workers from processing same book
        inFlightKeys.add(dupKey);

        // C6: Wrap save/enrich in try-finally to ensure inFlightKeys.delete on error
        try {
          const savedId = await addToCatalogue({ ...data, issue: bulkIssue }, b64);
          if (savedId) {
            added++;
            console.log('[bulk] added to catalogue:', data.title, bulkIssue);
          } else {
            console.warn('[bulk] addToCatalogue returned null for', file.name);
            errors.push(`${file.name}: failed to save`);
            return;
          }
          // Fire-and-forget enrichment — tracked via bulkEnrichProgress.
          bumpEnrichFired();
          fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getVaultHeaders() },
          body: JSON.stringify({
            title: data.title,
            issue: bulkIssue,
            grade: data.grade,
            isGraded: data.isGraded,
            numericGrade: data.numericGrade,
            year: data.year,
            publisher: data.publisher,
            confidence: data.confidence,
            defectPenalty: data.defectPenalty || null,
            variant: data.variant || null,
            keyIssue: data.keyIssue || null,
            labelType: data.labelType || null,
            labelNotes: data.labelNotes || null,
            // Ship 10.2 — Pass Vision condition report to enrich.
            reason: data.reason || null,
            images: [b64],
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((enrich) => {
            if (!enrich || !savedId) return;
            setCatalogue((prev) => {
              const cur = prev.find((x) => x.id === savedId);
              if (!cur) return prev;
              if (enrich.yearCorrected && enrich.confirmedYear) {
                console.log('[bulk] year healed:', cur.year, '→', enrich.confirmedYear);
              }
              // Ship #20a.6.4 — see auto-refresh path for full rationale.
              const idGatedBulk = enrich.identityConfident === false;

              // Quality guard: better data never replaced by worse (Principle 2)
              const priceGuardC = idGatedBulk
                ? { price: null, priceLow: null, priceHigh: null,
                    pricingSource: cur.pricingSource, priceNote: cur.priceNote }
                : chooseBetterPrice(enrich, cur);
              const gradeGuardC = chooseBetterGrade(enrich, cur);
              const priceChangedBulk = priceGuardC.price && priceGuardC.price !== cur.price;

              const updated = {
                ...cur,
                comps: enrich.comps || cur.comps,
                price: priceGuardC.price,
                priceLow: priceGuardC.priceLow,
                priceHigh: priceGuardC.priceHigh,
                pricingSource: priceGuardC.pricingSource,
                priceNote: priceGuardC.priceNote,
                grade: gradeGuardC.grade,
                confidenceLevel: gradeGuardC.confidenceLevel,
                identityConfident: enrich.identityConfident ?? cur.identityConfident ?? true,
                identityMissingFields: enrich.identityMissingFields ?? cur.identityMissingFields ?? null,
                identityReasons: enrich.identityReasons ?? cur.identityReasons ?? null,
                // Ship 6.2 — Polybag-aware merge.
                // When backend detects polybag, enrich.keyIssue is null and
                // enrich.title/year/comicVine are overridden. Default ||
                // fallback would preserve old first-print values. Polybag
                // flag forces use of enrich values even when null.
                keyIssue: enrich.polybagDetected ? null : (enrich.keyIssue || cur.keyIssue),
                keyIssueSource: enrich.polybagDetected ? null : (enrich.keyIssueSource || cur.keyIssueSource || null),
                polybagDetected: enrich.polybagDetected === true,
                polybagYear: enrich.polybagYear || null,
                polybagEditionLabel: enrich.polybagEditionLabel || null,
                originalTitle: enrich.originalTitle || cur.originalTitle || null,
                originalYear: enrich.originalYear || cur.originalYear || null,
                originalKeyIssue: enrich.originalKeyIssue || cur.originalKeyIssue || null,
                title: enrich.title || cur.title,
                keyFromComps: enrich.keyFromComps || cur.keyFromComps || [],
                keyFromCompsSingleton: enrich.keyFromCompsSingleton || cur.keyFromCompsSingleton || [],
                creatorFromComps: enrich.creatorFromComps || cur.creatorFromComps || [],
                creatorFromCompsSingleton: enrich.creatorFromCompsSingleton || cur.creatorFromCompsSingleton || [],
                soldComps: enrich.soldComps || cur.soldComps || [],
                soldCompsRaw: enrich.soldCompsRaw || cur.soldCompsRaw || [],
                soldCompDiagnostics: enrich.soldCompDiagnostics || cur.soldCompDiagnostics || null,
                // P0-B — Persist tier-based pricing metadata
                priceBands: enrich.priceBands || cur.priceBands || {},
                demandSignals: enrich.demandSignals || cur.demandSignals || {},
                // Book-level comps cache fields
                compsCachedAt: enrich.compsCachedAt || cur.compsCachedAt || null,
                activeCached: enrich.activeCached || cur.activeCached || null,
                soldCompsRawCached: enrich.soldCompsRawCached || cur.soldCompsRawCached || [],
                imageSearchResults: enrich.imageSearchResults || cur.imageSearchResults || null,
                salesByGrade: enrich.salesByGrade || cur.salesByGrade || null,
                priceLadder: enrich.priceLadder || cur.priceLadder || null,
                salesVelocity: enrich.salesVelocity || cur.salesVelocity || null,
                matchConfidence: enrich.matchConfidence || cur.matchConfidence || null,
                decision: enrich.decision || cur.decision,
                contract: enrich.contract ?? cur.contract ?? null, // Ship #24a-3
                gradeMultiplier: enrich.gradeMultiplier || null,
                // Preserve manual list price edits
                listPrice: cur.listPrice,
                listPriceManual: cur.listPriceManual,
                // Clear pending flag when enrich completes
                marketPending: false,
                defectPenalty: enrich.defectPenalty || cur.defectPenalty || null,
                comicVine: enrich.polybagDetected ? null : (enrich.comicVine || cur.comicVine || null),
                certNumber: enrich.certNumber || cur.certNumber || null, labelType: enrich.labelType || cur.labelType || null, labelNotes: enrich.labelNotes || cur.labelNotes || null,
                cgcVerified: enrich.cgcVerified || cur.cgcVerified || false,
                cgcLabel: enrich.cgcLabel || cur.cgcLabel || null,
                goCollect: enrich.goCollect || cur.goCollect || null,
                variant: enrich.variantNote || cur.variant || null,
                variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null,
                year: enrich.polybagDetected && enrich.year
                  ? enrich.year
                  : (enrich.yearCorrected && enrich.confirmedYear ? enrich.confirmedYear : cur.year),
                // Mega-key floor flags
                megaKeyFloorApplied: enrich.megaKeyFloorApplied === true,
                megaKeyFloorVerified: enrich.megaKeyFloorVerified === true,
                megaKeyFloorSource: enrich.megaKeyFloorSource || null,
                megaKeyFloorNote: enrich.megaKeyFloorNote || null,
                preFloorPrice: enrich.preFloorPrice || null,
                preFloorSource: enrich.preFloorSource || null,
                manualReviewRequired: enrich.manualReviewRequired === true,
                manualReviewReason: enrich.manualReviewReason || null,
                gradeExceedsMap: enrich.gradeExceedsMap === true,
                gradeExceedsMapReason: enrich.gradeExceedsMapReason || null,
                compsExhausted: enrich.compsExhausted === true,
                pop: enrich.pop || cur.pop || null,
                compEraFilterBypassed: enrich.compEraFilterBypassed === true,
                // Ship #13 observability
                thinPoolAnchored: enrich.thinPoolAnchored === true,
                variantComposition: enrich.variantComposition || null,
                sequelRejected: enrich.sequelRejected || 0,
                signedRejected: enrich.signedRejected || 0,
                multiIssueRejected: enrich.multiIssueRejected || 0,
                // Ship #17 observability
                lowGradeFloorApplied: enrich.lowGradeFloorApplied === true,
                lowGradeFloorAnchor: enrich.lowGradeFloorAnchor || null,
                // Ship #18 — preserve Vision-set penalty flags
                cgcPenaltyFlags: enrich.cgcPenaltyFlags || cur.cgcPenaltyFlags || null,
                // Ship #19 — preserve Vision-set editionWarning + ack state
                editionWarning: enrich.editionWarning || cur.editionWarning || null,
                editionConfirmed: cur.editionConfirmed || false,
                megaKeysSchemaVersion: enrich.megaKeysSchemaVersion || null,
                manualConfirmed: priceChangedBulk ? false : (cur.manualConfirmed || false),
              };
              console.log('[persist-bulk] savedId:', savedId,
                'price:', updated.price,
                'megaKey:', updated.megaKeyFloorApplied);
              putComic(updated).catch(() => {});
              return prev.map((x) => x.id === savedId ? updated : x);
            });
            // SPEED-2a: Load deferred metadata asynchronously
            // Metadata now bundled in enrich response (no separate fetch)
          })
          .catch(() => {})
          .finally(bumpEnrichSettled);
        } finally {
          // C6: Delete key from inFlightKeys on success OR error (prevent key leaks)
          inFlightKeys.delete(dupKey);
        }
      } catch (err) {
        console.warn('[bulk] unexpected error for', file.name, err);
        errors.push(`${file.name}: ${err.message || 'unexpected error'}`);
      }
    };

    // Worker pool: process files with concurrency=3
    const queue = files.map((f, i) => ({ file: f, index: i }));
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (task) await processFile(task.file, task.index);
        }
      })());
    }
    await Promise.all(workers);

    const elapsedMs = Date.now() - startTime;
    console.log(`[bulk-parallel] grade phase complete: ${files.length} files, ${elapsedMs}ms wall-clock, ${(elapsedMs / files.length).toFixed(0)}ms per book`);

    setBulkProgress(null);
    // Poll enrich completion; clear progress when all settle (max 45s wait).
    const pollStart = Date.now();
    while (enrichDone < enrichTotal && Date.now() - pollStart < 45000) {
      await new Promise((r) => setTimeout(r, 250));
    }
    setBulkEnrichProgress(null);
    if (errors.length > 0) {
      console.warn('[bulk] errors:', errors);
      setError(`Bulk import: ${added} added, ${errors.length} failed.\n${errors.join('\n')}`);
    }
    setBulkDone(added);
    // Auto-switch to collection tab after a short delay
    setTimeout(() => {
      setTab("collection");
      setBulkDone(null);
    }, 2000);
  }, [addToCatalogue, catalogue]);

  // Android back gesture intercept — return to list instead of exiting app.
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (selectedItem) setSelectedItem(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [selectedItem]);

  // Web Share Target handoff — grade in Buyer tab without saving.
  // Strip ?share-target=1 immediately so reloads don't re-trigger the flow.
  useEffect(() => {
    if (!widgetMode) return;
    setTab("buyer");
    window.history.replaceState({}, "", "/");
    setWidgetMode(false);
    (async () => {
      const tryFetchSharedImage = async (retries = 6) => {
        for (let i = 0; i < retries; i++) {
          try {
            const res = await fetch("/__shared-image", { cache: "no-store" });
            if (res.ok) return res;
          } catch {
            /* retry */
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        return null;
      };
      try {
        const res = await tryFetchSharedImage();
        if (!res) {
          setLoading(false);
          setError("Couldn't load shared image. Try sharing again.");
          return;
        }
        const blob = await res.blob();
        if (blob.size > 0) {
          await gradeBlob(blob, { save: false, buyerMode: true });
        } else {
          setLoading(false);
          setError("Shared image was empty. Try again.");
        }
      } catch (err) {
        setLoading(false);
        setError(err?.message || "Share failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setResult(null);
    setError(null);
    setDuplicateWarning(null);
    setPendingDuplicate(null);
  };

  const deleteFromCatalogue = useCallback(async (id) => {
    const item = catalogue.find((x) => x.id === id);

    // If listed on eBay with a known ItemID, offer to delist first.
    if (item && item.status === "listed" && item.ebayItemId) {
      const choice = prompt(
        `"${item.title}" is listed on eBay.\n\n` +
        `Type 1 to Remove from eBay + Collection\n` +
        `Type 2 to Remove from Collection Only\n` +
        `Type anything else to Cancel`
      );
      if (choice === "1") {
        try {
          const res = await fetch("/api/delist-ebay", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getVaultHeaders() },
            body: JSON.stringify({ ebayItemId: item.ebayItemId }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            const proceed = confirm(
              `eBay removal failed: ${data.error || "unknown error"}\n` +
              `Remove manually at ebay.com/myebay.\n\n` +
              `Still remove from collection?`
            );
            if (!proceed) return;
          }
        } catch {
          const proceed = confirm(
            `Could not reach eBay API.\n` +
            `Remove manually at ebay.com/myebay.\n\n` +
            `Still remove from collection?`
          );
          if (!proceed) return;
        }
      } else if (choice !== "2") {
        return; // cancelled
      }
    }

    await deleteComic(id);
    setCatalogue((prev) => prev.filter((x) => x.id !== id));
    setSelectedItem((cur) => (cur && cur.id === id ? null : cur));
  }, [catalogue]);

  const listOnEbay = useCallback(async (item) => {
    const coverPhoto = getComicPhotos(item)[0] || null;
    // Q41: acknowledged-override listings carry their audit payload to the
    // server so [Q41-override] appears in Vercel logs (client console does
    // not reach log capture).
    if (item.q41Override) {
      console.log('[Q41-override]', JSON.stringify(item.q41Override));
    }
    const res = await fetch("/api/list-ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getVaultHeaders() },
      body: JSON.stringify({
        q41Override: item.q41Override || null,
        title: item.title,
        publisher: item.publisher,
        year: item.year,
        grade: item.grade,
        keyIssue: item.keyIssue,
        price: item.price,
        priceLow: item.priceLow,
        priceHigh: item.priceHigh,
        reason: item.reason,
        image: coverPhoto,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.listingUrl) {
      throw new Error(data.error || "Failed to create eBay listing");
    }
    const updated = {
      ...item,
      status: "listed",
      ebayUrl: data.listingUrl,
      ebayItemId: data.listingId || null,
      listedAt: Date.now(),
    };
    await putComic(updated);
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? normalizeItem(updated) : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? normalizeItem(updated) : cur));
  }, []);

  const listBundleOnEbay = useCallback(async (items) => {
    if (!Array.isArray(items) || items.length < 2) {
      throw new Error("Select at least 2 comics to bundle");
    }
    const payloadItems = items.map((it) => ({
      id: it.id,
      title: it.title,
      issue: it.issue,
      publisher: it.publisher,
      year: it.year,
      grade: it.grade,
      isGraded: it.isGraded,
      numericGrade: it.numericGrade,
      keyIssue: it.keyIssue,
      price: it.price,
      priceLow: it.priceLow,
      priceHigh: it.priceHigh,
      reason: it.reason,
      images: [getComicPhotos(it)[0]].filter(Boolean),
    }));
    const res = await fetch("/api/list-ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getVaultHeaders() },
      body: JSON.stringify({ bundle: true, items: payloadItems }),
    });
    const data = await res.json();
    if (!res.ok || !data.listingUrl) {
      throw new Error(data.error || "Failed to create bundle listing");
    }
    const ebayItemId = data.listingId || null;
    const ebayUrl = data.listingUrl;
    const ids = new Set(items.map((i) => i.id));
    const listedAt = Date.now();
    setCatalogue((prev) =>
      prev.map((x) => {
        if (!ids.has(x.id)) return x;
        const updated = {
          ...x,
          status: "listed",
          ebayUrl,
          ebayItemId,
          listedAt,
          bundleId: ebayItemId,
        };
        putComic(updated).catch(() => {});
        return updated;
      })
    );
    return { ebayItemId, ebayUrl, count: items.length };
  }, []);

  const syncEbayStatus = useCallback(async (item) => {
    if (!item.ebayItemId) {
      throw new Error("No eBay Item ID — cannot sync status");
    }
    const res = await fetch("/api/list-ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getVaultHeaders() },
      body: JSON.stringify({
        checkStatus: true,
        ebayItemId: item.ebayItemId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to check eBay status");
    }

    // Update item with new status
    const updates = {
      ...item,
      status: data.status, // "sold", "ended", or "active"
    };

    if (data.status === "sold") {
      updates.soldPrice = data.soldPrice;
      updates.soldAt = data.soldAt;
      if (data.buyerFeedback != null) {
        updates.buyerFeedback = data.buyerFeedback;
      }
    } else if (data.status === "ended") {
      updates.endedAt = data.endedAt;
    }

    await putComic(updates);
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? normalizeItem(updates) : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? normalizeItem(updates) : cur));

    return data;
  }, []);

  // Update a single field on a catalogue entry and persist to IndexedDB.
  const updateComicField = useCallback((item, field, value) => {
    const updated = { ...item, [field]: value };
    // Q87: identity edits bump identityRevision — unblocks the ID_REQUIRED
    // enrich cache so the next refresh re-enriches this book.
    if (['title', 'issue', 'year', 'publisher'].includes(field)) {
      updated.identityRevision = (item.identityRevision || 0) + 1;
    }
    // Optimistic UI: update React state immediately so ROI and any other
    // derived views render instantly, then flush to IndexedDB in the
    // background. Users never see the putComic latency.
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? normalizeItem(updated) : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? normalizeItem(updated) : cur));
    putComic(updated).catch((err) => console.error("[db] write failed:", err));
  }, []);

  // Re-fetch eBay comps + ComicVine + AI verification for an
  // existing catalogue entry, without re-running the image identification.
  // Used by the CollectionDetail "Refresh Market Data" button.
  //
  // Collision guard: each call abort()s the previous in-flight refresh and
  // tags itself with a unique enrichId. On response, compares enrichId to
  // activeCardEnrichIdRef — if mismatched, the user moved on (swiped cards,
  // closed detail, started another refresh) and this response is discarded
  // before it can overwrite the catalogue with stale data for a prior item.
  const refreshMarketData = useCallback(async (item) => {
    // Q87: ID_REQUIRED enrich cache. A blocked book re-enriches only after
    // a user identity edit bumps identityRevision — same fields, same
    // refusal, so the call is pure waste until something changes.
    if (shouldSkipIdRequiredEnrich(item)) {
      console.log(`[Q87] skip — ID_REQUIRED unchanged at identityRevision ${item.identityRevision || 0}: "${item.title}"`);
      return;
    }
    cardEnrichAbortRef.current?.abort();
    const controller = new AbortController();
    cardEnrichAbortRef.current = controller;
    const enrichId = `${item.id}-${Date.now()}`;
    activeCardEnrichIdRef.current = enrichId;
    console.log(`[enrich] refresh start id=${enrichId} title=${item.title}`);

    // Ship v0-G — Defense-in-depth: minimal frontend sanitization before refresh.
    // Backend sanitizer (api/enrich.js) is authoritative, but this prevents obvious
    // contaminated titles from entering the refresh loop.
    const sanitizedTitle = (item.title || '')
      .replace(/\b(free\s+shipping|stock\s+image|select\s+an?\s+issue|see\s+pics?|combine\s+(?:shipping|s&h))\b/gi, ' ')
      .replace(/\b(vg|fn|vf|nm|gd|fr|pr|raw)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || item.title;  // Fallback to original if empty

    let res;
    try {
      res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getVaultHeaders() },
        body: JSON.stringify({
          title: sanitizedTitle,
          issue: item.issue || item.title?.match(/#(\d+)/)?.[1] || null,
          grade: item.grade,
          isGraded: item.isGraded,
          numericGrade: item.numericGrade,
          year: item.year,
          publisher: item.publisher,
          confidence: item.confidence,
          variant: item.variant || null,
          keyIssue: item.keyIssue || null,
          labelType: item.labelType || null,
          labelNotes: item.labelNotes || null,
          // Ship 10.2 — Pass Vision condition report to enrich.
          reason: item.reason || null,
          images: item.images?.[0] ? [item.images[0]] : [],  // Ship #20a.6.19: pass stored image for variant identity
          // P0 CRITICAL — Pass cached claudeCheck to skip AI on refresh
          skipClaudeCheck: true,
          claudeCheckCached: item.claudeCheck || null,
          // FIX: Skip image search on refresh to prevent identity re-resolution.
          // Batman #222 bug: refresh triggered eBay visual search → title-family
          // clustering → identity refusal → Phase 2 skipped → comps=null returned
          // → overwrote original comps with null → "No eBay comps found" despite
          // real comps existing. Refresh should only update PRICING, not re-run
          // identity resolution.
          skipImageSearch: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        console.log(`[enrich] refresh aborted id=${enrichId}`);
        return;
      }
      throw err;
    }
    if (!res.ok) {
      // Handle 401 unauthorized
      if (res.status === 401) {
        clearVaultKey();
        setShowAccessModal(true);
        return;
      }
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Failed to refresh market data");
    }
    if (activeCardEnrichIdRef.current !== enrichId) {
      console.log(`[enrich] stale ignored id=${enrichId}`);
      return;
    }
    const enrich = await res.json();
    if (activeCardEnrichIdRef.current !== enrichId) {
      console.log(`[enrich] stale ignored post-parse id=${enrichId}`);
      return;
    }
    if (enrich.yearCorrected && enrich.confirmedYear) {
      console.log('[refresh] year healed:', item.year, '→', enrich.confirmedYear);
    }
    // Ship #20a.6.4 — see auto-refresh path for full rationale.
    const idGatedRM = enrich.identityConfident === false;
    const newPriceRM = idGatedRM ? null : (enrich.price ?? item.price);
    const priceChangedRM = newPriceRM !== item.price;
    let updated = {
      ...item,
      // Q87: stamp the revision this ID_REQUIRED verdict was computed at;
      // cleared when identity becomes confident.
      q87CheckedRevision: idGatedRM ? (item.identityRevision || 0) : null,
      title: enrich.title || item.title,
      comps: enrich.comps ?? item.comps,
      price: newPriceRM,
      priceLow: idGatedRM ? null : (enrich.priceLow ?? item.priceLow),
      priceHigh: idGatedRM ? null : (enrich.priceHigh ?? item.priceHigh),
      priceUpdatedAt: priceChangedRM ? (enrich.priceUpdatedAt || Date.now()) : (item.priceUpdatedAt || item.timestamp),
      identityConfident: enrich.identityConfident ?? item.identityConfident ?? true,
      identityMissingFields: enrich.identityMissingFields ?? item.identityMissingFields ?? null,
      identityReasons: enrich.identityReasons ?? item.identityReasons ?? null,
      keyIssue: enrich.keyIssue || item.keyIssue,
      keyIssueSource: enrich.keyIssueSource || item.keyIssueSource || null,
      keyFromComps: enrich.keyFromComps || item.keyFromComps || [],
      keyFromCompsSingleton: enrich.keyFromCompsSingleton || item.keyFromCompsSingleton || [],
      creatorFromComps: enrich.creatorFromComps || item.creatorFromComps || [],
      creatorFromCompsSingleton: enrich.creatorFromCompsSingleton || item.creatorFromCompsSingleton || [],
      soldComps: enrich.soldComps || item.soldComps || [],
      soldCompsRaw: enrich.soldCompsRaw || item.soldCompsRaw || [],
      soldCompDiagnostics: enrich.soldCompDiagnostics || item.soldCompDiagnostics || null,
      // P0-B — Persist tier-based pricing metadata
      priceBands: enrich.priceBands || item.priceBands || {},
      demandSignals: enrich.demandSignals || item.demandSignals || {},
      imageSearchResults: enrich.imageSearchResults || item.imageSearchResults || null,
      salesByGrade: enrich.salesByGrade || item.salesByGrade || null,
      priceLadder: enrich.priceLadder || item.priceLadder || null,
      salesVelocity: enrich.salesVelocity || item.salesVelocity || null,
      confidenceLevel: enrich.confidenceLevel || item.confidenceLevel || "LOW",
      matchConfidence: enrich.matchConfidence || item.matchConfidence || null,
      decision: enrich.decision || item.decision,
      contract: enrich.contract ?? item.contract ?? null, // Ship #24a-3
      pricingSource: enrich.pricingSource ?? null,
      priceNote: enrich.priceNote || null,
      // Preserve manual list price edits
      listPrice: item.listPrice,
      listPriceManual: item.listPriceManual,
      // Clear pending flag when enrich completes
      marketPending: false,
      gradeMultiplier: enrich.gradeMultiplier || null,
      defectPenalty: enrich.defectPenalty || item.defectPenalty || null,
      comicVine: enrich.comicVine || item.comicVine || null,
      certNumber: enrich.certNumber || item.certNumber || null,
      labelType: enrich.labelType || item.labelType || null,
      labelNotes: enrich.labelNotes || item.labelNotes || null,
      cgcVerified: enrich.cgcVerified || item.cgcVerified || false,
      cgcLabel: enrich.cgcLabel || item.cgcLabel || null,
      goCollect: enrich.goCollect || item.goCollect || null,
      variant: enrich.variantNote || item.variant || null,
      variantMultiplier: enrich.variantMultiplier || item.variantMultiplier || null,
      year: enrich.polybagDetected && enrich.year
        ? enrich.year
        : (enrich.yearCorrected && enrich.confirmedYear ? enrich.confirmedYear : item.year),
      // Mega-key floor flags
      megaKeyFloorApplied: enrich.megaKeyFloorApplied === true,
      megaKeyFloorVerified: enrich.megaKeyFloorVerified === true,
      megaKeyFloorSource: enrich.megaKeyFloorSource || null,
      megaKeyFloorNote: enrich.megaKeyFloorNote || null,
      preFloorPrice: enrich.preFloorPrice || null,
      preFloorSource: enrich.preFloorSource || null,
      manualReviewRequired: enrich.manualReviewRequired === true,
      manualReviewReason: enrich.manualReviewReason || null,
      gradeExceedsMap: enrich.gradeExceedsMap === true,
      gradeExceedsMapReason: enrich.gradeExceedsMapReason || null,
      compsExhausted: enrich.compsExhausted === true,
      pop: enrich.pop || item.pop || null,
      compEraFilterBypassed: enrich.compEraFilterBypassed === true,
      // Ship #13 observability
      thinPoolAnchored: enrich.thinPoolAnchored === true,
      variantComposition: enrich.variantComposition || null,
      sequelRejected: enrich.sequelRejected || 0,
      signedRejected: enrich.signedRejected || 0,
      multiIssueRejected: enrich.multiIssueRejected || 0,
      // Ship #17 observability
      lowGradeFloorApplied: enrich.lowGradeFloorApplied === true,
      lowGradeFloorAnchor: enrich.lowGradeFloorAnchor || null,
      // Ship #18 — preserve Vision-set penalty flags
      cgcPenaltyFlags: enrich.cgcPenaltyFlags || item.cgcPenaltyFlags || null,
      // Ship #19 — preserve Vision-set editionWarning + ack state
      editionWarning: enrich.editionWarning || item.editionWarning || null,
      editionConfirmed: item.editionConfirmed || false,
      megaKeysSchemaVersion: enrich.megaKeysSchemaVersion || null,
      manualConfirmed: priceChangedRM ? false : (item.manualConfirmed || false),
      // FIX 2: Preserve book-level comps cache fields across refresh
      // Bug: activeCached dropped on refresh #2 → backend can't use cache → full re-fetch
      // Amazing Adventures #3: refresh #1 had active data, refresh #2 lost it (undefined)
      activeCached: enrich.activeCached || item.activeCached || null,
      compsCachedAt: enrich.compsCachedAt || item.compsCachedAt || null,
      soldCompsRawCached: enrich.soldCompsRawCached || item.soldCompsRawCached || [],
    };

    // Ship #20a.6.22 — Apply autofix engine
    const { updated: autofixed, fixes } = runAutoFix(updated);
    if (fixes.length > 0) {
      console.log('[autofix] refreshMarketData:', fixes);
      updated = autofixed;
    }

    await putComic(updated);
    setCatalogue((prev) => prev.map((x) => {
      if (x.id === item.id) return updated;
      // Sync duplicate copies with same title + issue + year.
      if (x.title?.toLowerCase() === item.title?.toLowerCase()
        && x.issue === item.issue
        && x.year === item.year) {
        // Ship #20a.6.4 — duplicate sync respects idGated.
        const synced = idGatedRM
          ? {
              ...x,
              price: null,
              priceLow: null,
              priceHigh: null,
              comps: enrich.comps ?? x.comps,
              pricingSource: enrich.pricingSource ?? x.pricingSource,
              priceNote: enrich.priceNote ?? null,
              gradeMultiplier: enrich.gradeMultiplier ?? x.gradeMultiplier,
              identityConfident: false,
              identityMissingFields: enrich.identityMissingFields ?? null,
              identityReasons: enrich.identityReasons ?? null,
            }
          : {
              ...x,
              price: enrich.price ?? x.price,
              priceLow: enrich.priceLow ?? x.priceLow,
              priceHigh: enrich.priceHigh ?? x.priceHigh,
              comps: enrich.comps ?? x.comps,
              pricingSource: enrich.pricingSource ?? x.pricingSource,
              priceNote: enrich.priceNote ?? null,
              gradeMultiplier: enrich.gradeMultiplier ?? x.gradeMultiplier,
              identityConfident: enrich.identityConfident ?? x.identityConfident ?? true,
            };
        putComic(synced).catch(() => {});
        return synced;
      }
      return x;
    }));
    setSelectedItem((cur) => (cur && cur.id === item.id ? normalizeItem(updated) : cur));
    // SPEED-2a: Load deferred metadata asynchronously
    // Metadata now bundled in enrich response (no separate fetch)
  }, []);

  // Ship #20a.6.19 — Re-identify book (re-grade + re-enrich with stored image).
  // Differs from refreshMarketData: refreshes Vision identity (title/variant/
  // grade) not just pricing. Used when stored image exists but identity is
  // wrong (e.g. Crow Lethe vs Crow Dead Time).
  const reIdentifyBook = useCallback(async (item) => {
    if (!item.images?.[0]) {
      throw new Error("No stored image available for re-identification");
    }
    const b64 = item.images[0];

    // Step 1: Re-grade with stored image
    // FIX 2: Force regrade bypasses grade lock (user explicitly requested re-identification)
    const gradeRes = await fetch("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getVaultHeaders() },
      body: JSON.stringify({
        images: [b64],
        existingGrade: {
          grade: item.grade,
          isGraded: item.isGraded,
          numericGrade: item.numericGrade,
          conditionSummary: item.conditionSummary,
          confidence: item.confidence,
        },
        gradeConfidence: item.confidence?.toUpperCase(),
        gradeLocked: item.gradeLocked || false,
        forceRegrade: true, // FIX 2: Bypass grade lock for explicit re-identification
      }),
    });
    if (!gradeRes.ok) throw new Error("Failed to re-grade book");
    const gradeData = await gradeRes.json();
    if (!gradeData.title) throw new Error("Vision returned no title");

    // Step 2: Re-enrich with new identity + stored image
    const issueNum = gradeData.issue || gradeData.title?.match(/#(\d+)/)?.[1] || null;
    let enrichData = null;
    let enrichFailed = false;
    let enrichError = null;

    try {
      const enrichRes = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getVaultHeaders() },
        body: JSON.stringify({
          title: gradeData.title,
          issue: issueNum,
          grade: gradeData.grade,
          isGraded: gradeData.isGraded,
          numericGrade: gradeData.numericGrade,
          year: gradeData.year,
          publisher: gradeData.publisher,
          confidence: gradeData.confidence,
          variant: gradeData.variant || null,
          keyIssue: gradeData.keyIssue || null,
          certNumber: gradeData.certNumber || null,
      labelType: gradeData.labelType || null,
      labelNotes: gradeData.labelNotes || null,
          defectPenalty: gradeData.defectPenalty || null,
          // Ship 10.2 — Pass Vision condition report to enrich.
          reason: gradeData.reason || null,
          images: [b64],
        }),
      });
      if (!enrichRes.ok) {
        const errBody = await enrichRes.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to enrich book");
      }
      enrichData = await enrichRes.json();
    } catch (err) {
      // Graceful degradation: enrich failed but we have Vision data
      enrichFailed = true;
      enrichError = err.message;
      console.warn('[reIdentify] enrich failed, falling back to Vision-only:', err.message);
    }

    // Step 3: Update catalogue with new identity + enriched data (or Vision-only if enrich failed)
    const updated = {
      ...item,
      title: gradeData.title,
      issue: issueNum,
      grade: gradeData.grade,
      isGraded: gradeData.isGraded,
      numericGrade: gradeData.numericGrade,
      year: enrichData?.confirmedYear || gradeData.year,
      publisher: gradeData.publisher,
      confidence: gradeData.confidence,
      variant: gradeData.variant || null,
      keyIssue: enrichData?.keyIssue || gradeData.keyIssue || null,
      price: enrichData?.price || null,
      priceLow: enrichData?.priceLow || null,
      priceHigh: enrichData?.priceHigh || null,
      comps: enrichData?.comps || null,
      reason: gradeData.reason || null,
      restoration: gradeData.restoration || null,
      defectPenalty: gradeData.defectPenalty || null,
      cgcPenaltyFlags: gradeData.cgcPenaltyFlags || null,
      editionWarning: gradeData.editionWarning || null,
      certNumber: gradeData.certNumber || null,
      labelType: gradeData.labelType || null,
      labelNotes: gradeData.labelNotes || null,
      cgcVerified: gradeData.cgcVerified || false,
      cgcLabel: gradeData.cgcLabel || null,
      enrichFailed,
      enrichError,
    };

    // Ship #20a.6.22 — Apply autofix engine (skip if enrich failed)
    let finalUpdated = updated;
    if (!enrichFailed) {
      const { updated: autofixed, fixes } = runAutoFix(updated);
      if (fixes.length > 0) {
        console.log('[autofix] reIdentifyBook:', fixes);
        finalUpdated = autofixed;
      }
    }

    await putComic(finalUpdated);
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? normalizeItem(finalUpdated) : x)));
    setSelectedItem(finalUpdated);

    return finalUpdated;
  }, []);

  // Append a new photo to an existing comic and re-run /api/grade with
  // ALL photos so the identification benefits from multi-angle coverage.
  // Updates the stored entry with fresh grade fields + new images array.
  const addPhotoToComic = useCallback(async (item, file) => {
    const existingPhotos = getComicPhotos(item);
    if (existingPhotos.length >= 4) {
      throw new Error("Maximum 4 photos reached");
    }
    const rawB64 = await fileToBase64(file);
    const newThumb = await makeThumbnail(rawB64, 1200, 0.85);
    const nextPhotos = [...existingPhotos, newThumb];

    const res = await fetch("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getVaultHeaders() },
      body: JSON.stringify({ images: nextPhotos }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to re-analyze");

    const photoIssue = data.issue || data.title?.match(/#(\d+)/)?.[1] || item.issue || null;
    const updated = {
      ...item,
      title: data.title || item.title,
      issue: photoIssue,
      publisher: data.publisher || item.publisher,
      year: data.year || item.year,
      grade: data.grade || item.grade,
      isGraded: data.isGraded === true,
      numericGrade:
        typeof data.numericGrade === "number"
          ? data.numericGrade
          : item.numericGrade,
      keyIssue: data.keyIssue || item.keyIssue,
      price: data.price || item.price,
      priceLow: data.priceLow || item.priceLow,
      priceHigh: data.priceHigh || item.priceHigh,
      reason: data.reason || item.reason,
      confidence: data.confidence || item.confidence,
      cgcPenaltyFlags: data.cgcPenaltyFlags || item.cgcPenaltyFlags || null,
      // Ship #19 — manual rescan: update editionWarning from new Vision
      // result. Reset editionConfirmed when the signals actually change
      // (different reason → possibly different edition judgment).
      editionWarning: data.editionWarning || item.editionWarning || null,
      editionConfirmed:
        JSON.stringify(data.editionWarning?.signals || []) ===
        JSON.stringify(item.editionWarning?.signals || [])
          ? (item.editionConfirmed || false)
          : false,
      images: nextPhotos,
      // Drop the legacy single `image` field if it's still hanging around
      // from an older record — `images` is the source of truth now.
      image: undefined,
    };
    try {
      await putComic(updated);
    } catch {
      // Quota fallback: drop the oldest photo and retry.
      const trimmed = { ...updated, images: nextPhotos.slice(-3) };
      await putComic(trimmed);
      setCatalogue((prev) =>
        prev.map((x) => (x.id === item.id ? trimmed : x))
      );
      setSelectedItem((cur) =>
        cur && cur.id === item.id ? trimmed : cur
      );
      return;
    }
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? normalizeItem(updated) : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? normalizeItem(updated) : cur));
  }, []);

  const marketValue = marketValueOf(result);

  const totalValue = catalogue.reduce((sum, item) => {
    if (item.marketPending) return sum;  // exclude pending items
    return sum + (getDisplayPrice(item) || 0);
  }, 0);

  const soldRevenue = catalogue.reduce((sum, item) => {
    if (item.status === "sold" && item.soldPrice != null) {
      return sum + item.soldPrice;
    }
    return sum;
  }, 0);

  const soldCount = catalogue.filter((item) => item.status === "sold").length;

  // Record a daily value snapshot whenever catalogue changes.
  useEffect(() => {
    if (catalogue.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const val = catalogue.reduce((s, c) => s + (getDisplayPrice(c) || 0), 0);
    const snap = { date: today, totalValue: val, comicCount: catalogue.length };
    putSnapshot(snap)
      .then(() => getAllSnapshots())
      .then((s) => setSnapshots(s))
      .catch(() => {});
  }, [catalogue]);

  const refreshAnalysis = useCallback(async () => {
    if (catalogue.length === 0) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getVaultHeaders() },
        body: JSON.stringify({ comics: catalogue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data);
      await putAnalysis(data);
    } catch {
      /* non-fatal */
    } finally {
      setAnalyzing(false);
    }
  }, [catalogue]);

  const switchTab = (next) => {
    // Save current scroll position for restore
    if (tab === "collection") collectionScrollPos.current = window.scrollY;
    if (tab === "manage") manageScrollPos.current = window.scrollY;
    setTab(next);
    reset();
    setSelectedItem(null);
    // Restore saved scroll position for the target tab
    if (next === "manage") {
      setTimeout(() => window.scrollTo(0, manageScrollPos.current), 50);
    } else if (next === "collection") {
      setTimeout(() => window.scrollTo(0, collectionScrollPos.current), 50);
    } else {
      window.scrollTo(0, 0);
    }
  };

  const handleInstallTap = async () => {
    if (!installPrompt) return;
    try {
      installPrompt.prompt();
      await installPrompt.userChoice;
    } catch {
      /* user dismissed natively or prompt threw — clear state anyway */
    }
    setInstallPrompt(null);
  };

  const handleInstallDismiss = () => {
    localStorage.setItem("installDismissed", "1");
    setInstallDismissed(true);
  };

  return (
    <div className="app">
      <header className="header">
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.5 }}>GrailKey</div>
        <div style={{ fontSize: 11, color: "#999", marginTop: 2, fontWeight: 400 }}>Know what it's worth. Get paid.</div>
      </header>

      {tab === "scan" && (
        <>
          {/* Bulk import progress */}
          {bulkProgress && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-text">
                {bulkProgress.title
                  ? `Grading ${bulkProgress.title}… (${bulkProgress.current}/${bulkProgress.total})`
                  : `Grading ${bulkProgress.current} of ${bulkProgress.total}…`}
              </div>
            </div>
          )}

          {/* Bulk enrich progress (shown on Scan tab after grading finishes,
              until the tab switches to collection). */}
          {!bulkProgress && bulkEnrichProgress && bulkEnrichProgress.current < bulkEnrichProgress.total && (
            <div className="muted small" style={{ textAlign: "center", margin: "8px 0", color: "#4caf50" }}>
              Fetching market data… {bulkEnrichProgress.current} of {bulkEnrichProgress.total}
            </div>
          )}

          {/* Bulk import done */}
          {bulkDone != null && !bulkProgress && (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#d4af37" }}>
                {bulkDone} comic{bulkDone === 1 ? "" : "s"} added to collection
              </div>
            </div>
          )}

          {!loading && !result && !error && !bulkProgress && bulkDone == null && (
            <>
              {/* Scanner ready indicator + access code button */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 20px 8px" }}>
                <button
                  onClick={() => setShowAccessModal(true)}
                  style={{
                    fontSize: 11,
                    color: "#666",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 8px",
                  }}
                >
                  🔑 Access code
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", background: "#16a34a",
                    boxShadow: "0 0 4px #16a34a",
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", opacity: 0.8 }}>Ready</span>
                </div>
              </div>

              {/* Barcode scanner modal */}
              {showBarcodeScanner && (
                <BarcodeScanner
                  onDetected={(barcode) => {
                    setShowBarcodeScanner(false);
                    handleBarcodeSubmit(barcode);
                  }}
                  onCancel={() => setShowBarcodeScanner(false)}
                />
              )}

              {/* Clean 3-option layout */}
              <div style={{ maxWidth: 420, margin: "0 auto", padding: "0 20px" }}>
                {/* Option 1: Scan Cover */}
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "16px",
                    background: "transparent",
                    color: "#d4af37",
                    border: "2px solid rgba(212,175,55,0.4)",
                    borderRadius: 10,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "center",
                    marginBottom: 12,
                  }}
                >
                  📷 Scan Cover
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleFile(e, "scan")}
                  hidden
                />

                {/* Option 2: Scan Barcode */}
                <button
                  onClick={() => setShowBarcodeScanner(true)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "16px",
                    background: "transparent",
                    color: "#d4af37",
                    border: "2px solid rgba(212,175,55,0.4)",
                    borderRadius: 10,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "center",
                    marginBottom: 12,
                  }}
                >
                  📊 Scan Barcode
                </button>

                {/* Option 3: Search by Title */}
                <button
                  onClick={() => setShowManualEntry(!showManualEntry)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "16px",
                    background: showManualEntry ? "rgba(212,175,55,0.1)" : "transparent",
                    color: "#d4af37",
                    border: "2px solid rgba(212,175,55,0.4)",
                    borderRadius: 10,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "center",
                    marginBottom: showManualEntry ? 12 : 20,
                  }}
                >
                  ✏️ Search by Title
                </button>

                {/* Manual entry form (expandable) */}
                {showManualEntry && (
                  <div style={{
                    background: 'rgba(212,175,55,0.05)',
                    border: '1px solid rgba(212,175,55,0.2)',
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 20,
                  }}>
                    <input
                      type="text"
                      placeholder="Title (e.g., Batman)"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 10,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: 6,
                        color: '#f4f4f4',
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Issue # (e.g., 222)"
                      value={manualIssue}
                      onChange={(e) => setManualIssue(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 10,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: 6,
                        color: '#f4f4f4',
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Year (e.g., 1970)"
                      value={manualYear}
                      onChange={(e) => setManualYear(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 10,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: 6,
                        color: '#f4f4f4',
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    />
                    {/* FIX B: Publisher field (optional, helps disambiguation) */}
                    <input
                      type="text"
                      placeholder="Publisher (optional, e.g., DC, Marvel)"
                      value={manualPublisher}
                      onChange={(e) => setManualPublisher(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 10,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: 6,
                        color: '#f4f4f4',
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    />
                    {/* FIX B: Grade dropdown (optional) */}
                    <select
                      value={manualGrade}
                      onChange={(e) => setManualGrade(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 10,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: 6,
                        color: '#f4f4f4',
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    >
                      <option value="">Grade (optional)</option>
                      <option value="Raw">Raw</option>
                      <option value="GD 2.0">GD 2.0</option>
                      <option value="VG 4.0">VG 4.0</option>
                      <option value="FN 6.0">FN 6.0</option>
                      <option value="VF 8.0">VF 8.0</option>
                      <option value="VF+ 8.5">VF+ 8.5</option>
                      <option value="NM- 9.2">NM- 9.2</option>
                      <option value="NM 9.4">NM 9.4</option>
                      <option value="NM+ 9.6">NM+ 9.6</option>
                      <option value="NM/M 9.8">NM/M 9.8</option>
                    </select>
                    {/* FIX B: Variant field (optional) */}
                    <input
                      type="text"
                      placeholder="Variant (optional, e.g., newsstand, pence)"
                      value={manualVariant}
                      onChange={(e) => setManualVariant(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        marginBottom: 12,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,175,55,0.25)',
                        borderRadius: 6,
                        color: '#f4f4f4',
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (!manualTitle.trim() || !manualIssue.trim()) {
                          setError('Title and Issue # are required');
                          return;
                        }
                        setLoading(true);
                        setError(null);
                        setShowManualEntry(false);
                        try {
                          const enrichRes = await fetch('/api/enrich', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...getVaultHeaders() },
                            body: JSON.stringify({
                              manualIdentity: true,
                              skipVision: true,
                              skipImageSearch: true,
                              title: manualTitle.trim(),
                              issue: manualIssue.trim(),
                              year: manualYear.trim() || null,
                              publisher: manualPublisher.trim() || null, // FIX B
                              grade: manualGrade || null, // FIX B
                              variant: manualVariant.trim() || null, // FIX B
                              isGraded: false,
                              confidence: 'HIGH',
                              identitySource: 'manual',
                            }),
                          });
                          if (!enrichRes.ok) {
                            throw new Error(`Enrich failed: ${enrichRes.status}`);
                          }
                          const enrichData = await enrichRes.json();
                          setResult({
                            ...enrichData,
                            title: enrichData.title || manualTitle.trim(),
                            issue: enrichData.issue || manualIssue.trim(),
                            year: enrichData.year || manualYear.trim() || null,
                            identitySource: 'manual',
                          });
                          setManualTitle('');
                          setManualIssue('');
                          setManualYear('');
                          setManualPublisher(''); // FIX B
                          setManualGrade(''); // FIX B
                          setManualVariant(''); // FIX B
                        } catch (err) {
                          setError(err.message || 'Search failed');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={!manualTitle.trim() || !manualIssue.trim()}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: (!manualTitle.trim() || !manualIssue.trim())
                          ? 'rgba(212,175,55,0.2)'
                          : '#d4af37',
                        color: (!manualTitle.trim() || !manualIssue.trim())
                          ? 'rgba(212,175,55,0.5)'
                          : '#000',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 15,
                        fontWeight: 600,
                        cursor: (!manualTitle.trim() || !manualIssue.trim())
                          ? 'not-allowed'
                          : 'pointer',
                      }}
                    >
                      Search →
                    </button>
                  </div>
                )}

                {/* Divider */}
                <div style={{
                  textAlign: 'center',
                  margin: '0 0 16px',
                  color: 'rgba(212,175,55,0.4)',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  ───── or ─────
                </div>

                {/* Text input for UPC/title */}
                <input
                  type="text"
                  placeholder="Enter UPC barcode..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      handleBarcodeSubmit(e.target.value.trim());
                      e.target.value = '';
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(212,175,55,0.25)',
                    borderRadius: 8,
                    color: '#f4f4f4',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    textAlign: 'center',
                    marginBottom: 16,
                  }}
                />

                {/* Bulk import */}
                <button
                  onClick={() => bulkRef.current?.click()}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px 16px",
                    background: "transparent",
                    color: "#d4af37",
                    border: "1px solid rgba(212,175,55,0.3)",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  📚 Bulk Import from Gallery
                </button>
                <input
                  ref={bulkRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (bulkRef.current) bulkRef.current.value = "";
                    if (files.length > 0) handleBulkImport(files);
                  }}
                  hidden
                />
              </div>
            </>
          )}
          {loading && !bulkProgress && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-text">{LOADING_STEPS[step]}</div>
            </div>
          )}
          {error && (
            <div className="error-card">
              <div className="error-text">{error}</div>
              <button className="reset-btn" onClick={reset}>Try again</button>
            </div>
          )}
          {result && !loading && !bulkProgress && (
            <>
              {duplicateWarning && pendingDuplicate && (
                <div style={{ background: "#ff990022", border: "1px solid #ff9900", borderRadius: 6, padding: "8px 12px", marginBottom: 8, color: "#ffaa33", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⚠️ Already in collection. Tap Save to add another copy.</span>
                  <button
                    style={{ background: "#ff9900", color: "#000", border: "none", borderRadius: 4, padding: "4px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }}
                    onClick={async () => {
                      const { data, b64 } = pendingDuplicate;
                      const savedId = await addToCatalogue(data, b64);
                      setPendingDuplicate(null);
                      setDuplicateWarning(null);
                      if (savedId) {
                        // Fire enrichment for the newly saved copy
                        fetch("/api/enrich", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", ...getVaultHeaders() },
                          body: JSON.stringify({
                            title: data.title, issue: data.issue, grade: data.grade,
                            isGraded: data.isGraded, numericGrade: data.numericGrade,
                            year: data.year, publisher: data.publisher,
                            confidence: data.confidence, defectPenalty: data.defectPenalty || null,
                            certNumber: data.certNumber || null, labelType: data.labelType || null, labelNotes: data.labelNotes || null, variant: data.variant || null,
                            keyIssue: data.keyIssue || null, images: [b64],
                          }),
                        })
                          .then((r) => r.ok ? r.json() : null)
                          .then((enrich) => {
                            if (!enrich) return;
                            setCatalogue((prev) => {
                              const cur = prev.find((x) => x.id === savedId);
                              if (!cur) return prev;
                              const updated = { ...cur, contract: enrich.contract ?? cur.contract ?? null, decision: enrich.decision || cur.decision || null, comps: enrich.comps || cur.comps, price: enrich.price || cur.price, priceLow: enrich.priceLow || cur.priceLow, priceHigh: enrich.priceHigh || cur.priceHigh, keyIssue: enrich.keyIssue || cur.keyIssue, soldComps: enrich.soldComps || cur.soldComps || [], imageSearchResults: enrich.imageSearchResults || cur.imageSearchResults || null, salesByGrade: enrich.salesByGrade || cur.salesByGrade || null, priceLadder: enrich.priceLadder || cur.priceLadder || null, salesVelocity: enrich.salesVelocity || cur.salesVelocity || null, confidenceLevel: enrich.confidenceLevel || cur.confidenceLevel || "LOW", pricingSource: enrich.pricingSource || null, priceNote: enrich.priceNote || null, gradeMultiplier: enrich.gradeMultiplier || null, defectPenalty: enrich.defectPenalty || cur.defectPenalty || null, comicVine: enrich.comicVine || cur.comicVine || null, certNumber: enrich.certNumber || cur.certNumber || null, labelType: enrich.labelType || cur.labelType || null, labelNotes: enrich.labelNotes || cur.labelNotes || null, cgcVerified: enrich.cgcVerified || cur.cgcVerified || false, cgcLabel: enrich.cgcLabel || cur.cgcLabel || null, variant: enrich.variantNote || cur.variant || null, variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null };
                              putComic(updated).catch(() => {});
                              return prev.map((x) => x.id === savedId ? updated : x);
                            });
                          })
                          .catch(() => {});
                      }
                    }}
                  >Save Another Copy</button>
                </div>
              )}
              <ResultCard result={result} enriching={enriching} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
        </>
      )}

      {tab === "buyer" && (
        <>
          {watchMode ? (
            <WatchMode onStop={() => setWatchMode(false)} />
          ) : (
          <>
          {!loading && !result && !error && (
            <>
              <ScanZone
                onFile={(e) => handleFile(e, "buyer")}
                inputRef={buyerFileRef}
                compact
                label="Scan the book on stream"
              />
              <button
                onClick={() => setWatchMode(true)}
                style={{
                  width: "100%", padding: "12px 0", marginTop: 8,
                  background: "transparent", border: "1px solid rgba(212,175,55,0.4)",
                  borderRadius: 10, color: "#d4af37", fontWeight: 700, fontSize: 14,
                  cursor: "pointer",
                }}
              >👁 Watch Mode</button>
            </>
          )}
          {loading && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-text">{LOADING_STEPS[step]}</div>
            </div>
          )}
          {error && (
            <div className="error-card">
              <div className="error-text">{error}</div>
              <button className="reset-btn" onClick={reset}>Try again</button>
            </div>
          )}
          {result && !loading && (
            <>
              <button
                onClick={() => {
                  window.location.href = "whatnot://";
                  setTimeout(() => { window.location.href = "https://whatnot.com"; }, 1500);
                }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  width: "100%", padding: "10px 0", marginBottom: 8,
                  background: "transparent", border: "1px solid rgba(212,175,55,0.4)",
                  borderRadius: 8, color: "#d4af37", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >Back to stream →</button>
              <ResultCard result={result} enriching={enriching} />
              <BidCalculator marketValue={marketValue} detectedPrice={result?.detectedPrice} resultTitle={result?.title} resultGrade={result?.grade} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
          {!result && !loading && !error && <BidCalculator marketValue={null} />}
          </>
          )}
        </>
      )}

      {tab === "collection" && (
        selectedItem ? (
          <CollectionDetail
            item={selectedItem}
            onBack={() => {
              const prev = prevTabRef.current;
              setSelectedItem(null);
              if (prev === "manage") {
                setTab("manage");
                setTimeout(() => window.scrollTo(0, manageScrollPos.current), 50);
              } else {
                setTimeout(() => window.scrollTo(0, collectionScrollPos.current), 50);
              }
              prevTabRef.current = "collection";
            }}
            onDelete={deleteFromCatalogue}
            onList={listOnEbay}
            onSyncEbay={syncEbayStatus}
            onRefreshMarket={refreshMarketData}
            onReIdentify={reIdentifyBook}
            onAbortEnrich={() => {
              if (cardEnrichAbortRef.current) {
                console.log("[enrich] card unmount/change — aborting in-flight");
                cardEnrichAbortRef.current.abort();
                cardEnrichAbortRef.current = null;
                activeCardEnrichIdRef.current = null;
              }
            }}
            onAddPhoto={addPhotoToComic}
            onUpdateField={updateComicField}
            currentIndex={catalogue.indexOf(selectedItem)}
            totalItems={catalogue.length}
            onPrev={() => {
              const idx = catalogue.indexOf(selectedItem);
              if (idx > 0) { setSelectedItem(catalogue[idx - 1]); window.scrollTo(0, 0); }
            }}
            onNext={() => {
              const idx = catalogue.indexOf(selectedItem);
              if (idx < catalogue.length - 1) { setSelectedItem(catalogue[idx + 1]); window.scrollTo(0, 0); }
            }}
          />
        ) : (
          <CollectionList
            items={catalogue}
            totalValue={totalValue}
            soldCount={soldCount}
            soldRevenue={soldRevenue}
            refreshingPrices={refreshingPrices}
            bulkEnrichProgress={bulkEnrichProgress}
            snapshots={snapshots}
            onOpen={(item) => {
              collectionScrollPos.current = window.scrollY;
              prevTabRef.current = "collection";
              setSelectedItem(item);
              // P0-A: Card open is now a pure READ — no silent refresh.
              // Price frozen after initial scan. User taps "Refresh Market Data" to update.
            }}
            onDelete={deleteFromCatalogue}
          />
        )
      )}

      {tab === "manage" && (
        <ManagePage
          catalogue={catalogue}
          totalValue={totalValue}
          onOpenItem={(item) => {
            manageScrollPos.current = window.scrollY;
            prevTabRef.current = "manage";
            setSelectedItem(item);
            setTab("collection");
            // P0-A: Card open is now a pure READ — no silent refresh.
            // Price frozen after initial scan. User taps "Refresh Market Data" to update.
          }}
          onListComic={listOnEbay}
          onBundleList={listBundleOnEbay}
          onUpdateAll={refreshMarketData}
          tradePiles={tradePiles}
          setTradePiles={setTradePiles}
          setCatalogue={setCatalogue}
        />
      )}

      {/* A1 LEGAL: Launch footer — pricing disclaimer + eBay attribution */}
      <div style={{
        padding: "12px 16px",
        background: "rgba(20,20,20,0.6)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#888",
        textAlign: "center",
      }}>
        Prices are estimates derived from recent eBay sales data — not appraisals or financial advice.
        <br />
        eBay and the eBay logo are trademarks of eBay Inc.
      </div>

      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "scan" ? "active" : ""}`}
          onClick={() => switchTab("scan")}
        >
          <div className="tab-icon">📷</div>
          <div>Scan</div>
        </button>
        <button
          className={`tab-btn ${tab === "buyer" ? "active" : ""}`}
          onClick={() => switchTab("buyer")}
        >
          <div className="tab-icon">⚡</div>
          <div>Buyer</div>
        </button>
        <button
          className={`tab-btn ${tab === "collection" ? "active" : ""}`}
          onClick={() => switchTab("collection")}
        >
          <div className="tab-icon">📚</div>
          <div>Collection</div>
        </button>
        <button
          className={`tab-btn ${tab === "manage" ? "active" : ""}`}
          onClick={() => switchTab("manage")}
        >
          <div className="tab-icon">🧠</div>
          <div>Manage</div>
        </button>
      </nav>

      {isMobile && !installDismissed && (installPrompt || showSafariBanner) && (
        <div
          role="dialog"
          aria-label="Install GrailKey"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            background: "#f0c040",
            color: "#0a0a0a",
            padding: "12px 16px",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4)",
          }}
        >
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
            {installPrompt
              ? "📲 Add GrailKey to your home screen"
              : "📲 Tap Share then Add to Home Screen to install"}
          </span>
          {installPrompt && (
            <button
              onClick={handleInstallTap}
              style={{
                background: "#0a0a0a",
                color: "#f0c040",
                border: "none",
                padding: "8px 16px",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Install
            </button>
          )}
          <button
            onClick={handleInstallDismiss}
            aria-label="Dismiss install banner"
            style={{
              background: "transparent",
              color: "#0a0a0a",
              border: "none",
              fontSize: 20,
              fontWeight: 700,
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ACCESS GATE MODAL — T1 invite key entry (LAUNCH BLOCKER FIX) */}
      {showAccessModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.95)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              // Prevent dismissing by clicking outside if no key stored
              if (localStorage.getItem('vault_key')) {
                setShowAccessModal(false);
              }
            }
          }}
        >
          <div
            style={{
              background: "#1a1a1a",
              borderRadius: 12,
              padding: 32,
              maxWidth: 400,
              width: "100%",
              border: "1px solid #333",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#d4af37" }}>
              🔐 Access Required
            </div>
            <div style={{ fontSize: 14, color: "#999", marginBottom: 24 }}>
              Enter your GrailKey access code to continue
            </div>
            <input
              type="password"
              value={accessCodeInput}
              onChange={(e) => setAccessCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && accessCodeInput.trim()) {
                  localStorage.setItem('vault_key', accessCodeInput.trim());
                  setShowAccessModal(false);
                  setAccessCodeInput('');
                }
              }}
              placeholder="Access code"
              autoFocus
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 16,
                background: "#2a2a2a",
                border: "1px solid #444",
                borderRadius: 8,
                color: "#fff",
                marginBottom: 16,
              }}
            />
            <button
              onClick={() => {
                if (accessCodeInput.trim()) {
                  localStorage.setItem('vault_key', accessCodeInput.trim());
                  setShowAccessModal(false);
                  setAccessCodeInput('');
                }
              }}
              disabled={!accessCodeInput.trim()}
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 16,
                fontWeight: 700,
                background: accessCodeInput.trim() ? "#d4af37" : "#444",
                color: accessCodeInput.trim() ? "#000" : "#666",
                border: "none",
                borderRadius: 8,
                cursor: accessCodeInput.trim() ? "pointer" : "not-allowed",
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
