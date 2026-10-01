// GK-272B — display authority for prices. Extracted from src/App.jsx
// unchanged except for the leading identity gate, so the real function is
// importable by tests. No pricing math lives here: it only decides which
// already-computed number a user-facing surface may show.

// True when the fresh ResultCard suppresses its Recommended price
// (identityConfident === false). Missing field = not gated (legacy items).
export const isIdentityDisplayGated = (item) => item?.identityConfident === false;

// Explicit raw access for diagnostics/assertions that genuinely need the
// engine's advisory number. NOT a display value.
export const getAdvisoryContractPrice = (item) => item?.contract?.price ?? null;

export const getDisplayPrice = (item) => {
  if (!item) return 0;

  // GK-272B (display authority) — CONTRACT PRICE EXISTENCE != USER-FACING
  // PRICE AUTHORITY. contract.price may legitimately exist as advisory
  // context under identityConfident=false / LOCKED / RESEARCH (Q110/Q133/
  // XMEN1 retention law, unchanged), but every caller of this helper is an
  // actionable or valuation surface (collection price, sort/filter, totals,
  // portfolio snapshot, listing/packet price, ROI). The fresh ResultCard
  // already suppresses its Recommended price on exactly this condition
  // (`identityGated`). This gate used to sit BELOW the contract branch, so
  // it was unreachable for any item that carries a contract. 0 is this
  // helper's existing "no user-facing price" signal (callers test `> 0`
  // or sum), never a $0 valuation. Raw advisory access is explicit:
  // getAdvisoryContractPrice.
  if (isIdentityDisplayGated(item)) return 0;

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

// v0-E: Decision Engine price authority helper
// Returns the authoritative price for listPrice initialization.
// Precedence: blocked → 0, decision.price when decision permits listing → system price fallback
// Fix v0-H: When floor enforcement creates extreme mismatch with recommended price,
// use the recommended price (from verified sold comps) instead of floor.
export const getAuthorityPrice = (item) => {
  if (!item) return 0;

  // GK-272B — same law as getDisplayPrice: the identity gate must come
  // BEFORE the contract branch, or a gated item's editable list price is
  // pre-filled with the advisory contract price.
  if (isIdentityDisplayGated(item)) return 0;

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

// GK-272C — provenance for the RAW active-ask evidence shown beside a gated
// identity. Derived from what the evidence itself says it is (comps.source),
// never from item.pricingSource (which the identity-gated refresh merge
// deliberately does not overwrite, and which is therefore absent/stale —
// the "Source: unknown" next to "Based on 1 active eBay listing" defect).
// Returns null when provenance cannot be established: the caller must then
// suppress the line, never label it "unknown" beside known evidence.
export const describeActiveEvidenceProvenance = (item) => {
  const src = item?.comps?.source;
  if (src === 'browse_api') {
    return 'Source: eBay Browse API — active listings (asking prices, reference only — not sales)';
  }
  return null;
};
