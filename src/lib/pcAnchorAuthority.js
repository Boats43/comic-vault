// src/lib/pcAnchorAuthority.js
//
// GrailKey Directive G, Task 2 (2026-08-11). Pure UI helpers — no pricing
// math, no fetch/caching behavior. Directive F traced the Bone #1 class:
// Last Sold, Price Ladder, and CGC Population are fetched off bare
// priceCharting.id presence (api/enrich.js:6174-6184) with no edition
// check at fetch time, so a PC match for a different printing (1991
// Cartoon Books first print vs. a scanned 1996 Image copy, drift=5y)
// rendered as if it were the scanned book's own sale/ladder/population.
//
// api/enrich.js now stamps out.pcAnchorTrust unconditionally whenever a
// PC record exists (previously only set inside the catalog-ladder-
// reference branch, which requires the comp pool to be completely empty
// — the opposite of the case that needed it). These helpers decide, from
// that field alone, whether a PC-anchored render surface may present as
// this asset's own data (EXACT_EDITION only) or must carry a caveat.
//
// A missing/undefined pcAnchorTrust (item never re-scanned since this
// shipped, or refusedToPrice skipped the stamp) is treated identically to
// a non-EXACT_EDITION verdict — never authoritative on an absent field.

export const isPcAnchorExact = (obj) => obj?.pcAnchorTrust === 'EXACT_EDITION';

export const pcEditionCaveat = (obj) => {
  if (isPcAnchorExact(obj)) return null;
  const y = obj?.pcAnchorYear;
  return y
    ? `PriceCharting reference only — matched a ${y} edition, not confirmed as this copy's own printing`
    : "PriceCharting reference only — edition not confirmed as this copy's own printing";
};
