# API Data Completeness Audit — Ship #28 Investigation
**Date:** 2026-06-24  
**Status:** Investigation only — GREENLIGHT REQUIRED before refactor  
**Goal:** Map what data we're leaving on the table vs what AI receives

---

## EXECUTIVE SUMMARY

**Current architecture:** API calls extract rich structured data → we discard 60-70% of it → pass sparse summaries to AI → AI re-derives what we already had

**Opportunity:** Data-first pipeline that extracts complete API payloads → stores deterministic facts → only calls AI for genuine conflicts

**Est. AI call reduction:** 70-80% (most books have clean data, no conflicts)

---

## KEY FINDINGS

See investigation below for complete analysis of 5 API sources and 10+ missing high-impact fields.

**TOP GAPS:**
1. eBay `leafCategoryIds` - eliminates contamination (MTG/manga/TPB)
2. PriceCharting `pc_product_id` + `ebay_epid` - identity anchors
3. GoCollect `last_updated` - stale FMV detection
4. eBay `buyingOptions` + seller diversity - demand signals

**CURRENT STATE:** AI fires on ~90% of books to re-derive data we already have

**PROPOSED:** AI only fires on ~20-30% with genuine conflicts
