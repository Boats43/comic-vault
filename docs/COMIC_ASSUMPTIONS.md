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

---

## Sequel / Volume / Extension Filter (between 0b and 0c)

**Comic assumption:** Vol 2, Part II, Book 3 = different works in a series. "Last Ronin II" ≠ "Last Ronin". Roman numerals, volume numbers, part numbers distinguish separate comic titles.

**Why this breaks for books:** Vol/Part/Book numbers = editions or volumes of the SAME work. "Einstein Vol 2" and "Einstein Vol 1" are legitimate comps for a multi-volume set. "Relativity Part 1" vs "Part 2" = same book split across volumes.

**Book relaxation:** Skip sequel filter entirely when `assetType === 'book'`.

---

## Cover-Letter Filter (Filter 1d)

**Comic assumption:** Cover A, B, C, D are separate products with separate prices. Never compare across cover letters. A Cover B variant can be worth 10× Cover A.

**Why this breaks for books:** Books don't have "Cover A/B/C/D" variants in the comic sense. Any listing with "Cover B" in title is unrelated book metadata or irrelevant.

**Book relaxation:** Skip cover-letter filter when `assetType === 'book'`.

---

## Half-Issue Filter (Filter 1f)

**Comic assumption:** #1/2, #½, #N.M formats are promo/ashcan/preview issues. Different product from the main #N issue. Fathom #1/2 ≠ Fathom #1.

**Why this breaks for books:** Books don't have half-issue numbering. Any "/" or "." in book listings is unrelated (dates, grades, ISBNs).

**Book relaxation:** Skip half-issue filter when `assetType === 'book'`.

---

## TPB Format Filter (Filter 1g)

**Comic assumption:** When title contains TPB markers (hardcover, omnibus, collected edition), require comps to also have TPB markers. Prevents floppy single-issue prices from poisoning TPB averages.

**Why this breaks for books:** Books naturally have "Hardcover" / "Paperback" in titles. Requiring format marker match would reject all HC comps when searching for PB (or vice versa), when both are legitimate comps for book pricing.

**Book relaxation:** Skip TPB format filter when `assetType === 'book'`.

---

## Slab Separation Filter (Filter 2)

**Comic assumption:** Raw vs graded (CGC/CBCS/PSA slabs) are separate markets with separate pricing. Never mix raw and graded comps.

**Why this breaks for books:** Books aren't CGC-slabbed (except rare signed collectibles). SLAB_RE pattern would reject all book comps that mention grading in unrelated context.

**Book relaxation:** Skip slab filter when `assetType === 'book'`.

---

## Coverless Filter (Filter 2c)

**Comic assumption:** Coverless comics are defective products that poison comps. "Sensation Comics #11 CGC-NG COVERLESS" at $1,250 would anchor floor incorrectly for complete copies.

**Why this breaks for books:** "Coverless" is a comic-specific defect marker. Books don't use this terminology in listings.

**Book relaxation:** Skip coverless filter when `assetType === 'book'`.

---

## AI Comp Verification (enrich.js lines 2140-2242)

**Comic assumption:** Comps can be verified by matching series title + issue number against listing titles. Extract `#N` from title, verify each listing mentions the same series + issue.

**Why this breaks for books:** Books don't have issue numbers. The pattern `/#\s*(\d+)/` extracts null for books. `verifyCompsTitles` receives `issue: null` and rejects ALL listings because none match the non-existent issue number.

**Impact:** AI verify overwrites `rawComps.count = 33` (filter chain survivors) → `count = 0` (verified count) → refused-no-data-sources at pricing gate despite 33 valid comps.

**Book relaxation:** Skip AI verify entirely when `assetType === 'book'`. Book comps already filtered by title similarity (0.3 threshold) and lot/price-sanity/dedup filters. No issue-based verification needed.

---

## Edition Warning Comp Filter (enrich.js lines 2244-2287)

**Comic assumption:** When Vision detects reprint/facsimile/later-print markers, filter comps to ONLY reprint listings. Prevents 1st-print comps from pricing reprints at 100-1000% over market.

**Pattern match:** `/reprint|facsimile|2nd\s*print|3rd\s*print|loot.?crate|millennium/i`

**Why this breaks for books:** Edition detection is comic-specific. Books don't have "facsimile" variants or "2nd print" markers in the same sense. `editionWarning.detected` is unlikely for books, but if it fires, the reprint-only filter would zero book comps.

**Book relaxation:** Skip edition filter when `assetType === 'book'`. Reprint filter already ran in comp filter chain (Filter 1, lines 914-931 in comps.js).

---

## Future Additions

As the 4C filter registry is built (Session 4C+), additional comic-vs-book assumptions will be cataloged here:
- Issue number enforcement (comics require #N, books don't)
- Variant semantics (comic variants = artist exclusives; book variants = format/edition)
- Grading impact (comic grade dominates price; book condition is secondary to edition rarity)
