# Comic-Specific Assumptions in Comp Filters

This document catalogs assumptions baked into the comp filter chain that are COMIC-specific and need relaxation/skipping for other asset types (books, cards).

## Title Similarity (Filter 0b)

**Comic assumption:** Comic titles are near-identical across listings. Sellers consistently use publisher's canonical title. Substring variation is minimal.

**Threshold:** 50% token overlap required (hardcoded in `hasSufficientTitleOverlap`).

**Why this breaks for books:** Book editions vary by subtitle ("Einstein: His Life and Universe" vs "Einstein" vs "Einstein Biography"), translator, publisher imprint. Same core book, different tokens. 50% threshold over-filters.

**Book relaxation:** 30% threshold for `assetType === 'book'`. Captures edition variation while still rejecting unrelated titles.

---

## Era Filter (Filter 0c)

**Comic assumption:** Year ≈ printing date. A 1975 comic was printed in 1975. Year mismatches indicate reprints (e.g., 2010 DC Classics Library reprint of 1975 original).

**Tolerance:** ±3y for Bronze/Modern (1970+), ±5y for Golden Age (<1970).

**Why this breaks for books:** Year = edition. A 1905 Einstein paper has 1920, 1950, 1990, 2015 editions — all legitimate comps for pricing a used copy. Year ≠ reprint signal; year = market segmentation by edition demand.

**Book relaxation:** Skip era filter entirely when `assetType === 'book'`. Other filters (reprint, lot, price sanity) still apply.

---

## Future Additions

As the 4C filter registry is built (Session 4C+), additional comic-vs-book assumptions will be cataloged here:
- Issue number enforcement (comics require #N, books don't)
- Variant semantics (comic variants = artist exclusives; book variants = format/edition)
- Grading impact (comic grade dominates price; book condition is secondary to edition rarity)
