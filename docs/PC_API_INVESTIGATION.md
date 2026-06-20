# PriceCharting API Integration — Investigation Report
**Date:** 2026-06-19  
**Investigator:** Claude Code  
**Status:** REPORT ONLY — No code changes

---

## Executive Summary

Comic Vault has a **PriceCharting API account** with advanced features but is currently using **only 2 of the available capabilities**. The account includes Lot Calculator, Photo Appraiser, and Profitable Grading Suggestions — none of which are currently integrated.

---

## Current Integration Status

### ✅ Active Endpoints

#### 1. **GET /api/products** (Product Search)
- **File:** `api/enrich.js` line 1153
- **URL:** `https://www.pricecharting.com/api/products?q={query}&type=comic&t={token}`
- **Usage:** Single-item product lookup by title + issue
- **Returns:**
  ```javascript
  {
    products: [
      {
        "product-name": "Amazing Spider-Man #300 (1988)",
        "loose-price": 67200,  // cents
        "id": "comic-book/...",
        // ... other fields
      }
    ]
  }
  ```
- **Frequency:** 1-2 calls per scan (initial + optional requery)
- **Current filters:**
  - Year gap ≤5 years
  - Issue # exact match via regex
  - Token overlap (main query token must appear in product name)
  - Excludes: facsimile/reprint/variant/walmart/newsstand/mexican

#### 2. **HTML Scrape: /game/{productId}** (Pop + Sales History)
- **File:** `api/pricecharting-pop.js`
- **URL:** `https://www.pricecharting.com/game/{productId}`
- **Method:** HTML scrape (NOT official API endpoint)
- **Usage:** Extract 4 data sources from single HTML page
  1. CGC pop data (`VGPC.pop_data` JS variable)
  2. Completed sales by grade (table extraction)
  3. Price ladder per-grade (table extraction)
  4. Sales velocity per-grade (table extraction)
- **Cache:** 7 days per productId
- **Returns:** Pop buckets (14 grades), sold comps with eBay/Heritage attribution, price ladder, velocity

---

## Account Features NOT Currently Used

### 🔴 Missing Integration #1: **Lot Calculator**
**Account Status:** Active (confirmed "Lot Calculator (no item limit)")  
**PC Documentation:** Unable to access (HTTP 403 on api-documentation page)  
**Expected capability:** Bulk item appraisal — likely accepts:
- Photo uploads (batch)
- CSV/list of titles + issues
- Returns: Aggregate value + per-item breakdown

**Potential use case for Comic Vault:**
- Bulk intake flow (scan 50 comics → single PC API call)
- Fast scan mode (skip individual enrichment)
- Collection import (CSV → valuations)

**Investigation needed:**
- API endpoint path/method
- Input format (photos? titles? both?)
- Rate limits
- Response structure

---

### 🔴 Missing Integration #2: **Photo Appraiser**
**Account Status:** Active (confirmed "Photo Appraiser")  
**PC Documentation:** Unable to access  
**Expected capability:** Image → product identification + price

**Potential use case for Comic Vault:**
- Fallback identity resolver (when Vision + eBay both fail)
- Cross-validation (PC photo vs Vision vs eBay consensus)
- Faster ID path (PC vision may be faster than Claude Opus)

**Investigation needed:**
- Is this a separate API endpoint or web-only?
- Does it accept base64 images?
- Does it return product ID (linkable to /game/{id} scrape)?
- Accuracy vs Claude Vision for comics

---

### 🔴 Missing Integration #3: **Profitable Grading Suggestions**
**Account Status:** Active (confirmed "Profitable Grading Suggestions")  
**PC Documentation:** Unable to access  
**Expected capability:** Per-product grading ROI analysis

**Current Comic Vault implementation:**
- Manual calculation using GoCollect FMV + CGC costs
- Shows profit scenarios for 9.4/9.6/9.8
- File: `src/App.jsx` CGC submission profit UI

**Potential PC version:**
- May include PC's own grading profit model
- May factor in current market conditions
- May return recommended grade targets

**Investigation needed:**
- Is this per-product API data (embedded in /api/products response)?
- Or separate endpoint?
- What does it return — target grade? profit estimate? submit/hold decision?
- How does it compare to our GoCollect-based calculator?

---

## Environment Variables

### ✅ Verified in Production
```bash
$ vercel env ls | grep PRICECHARTING
PRICECHARTING_TOKEN        Encrypted    Development, Preview, Production    68d ago
```

**Status:** Token is SET and active across all environments  
**Last updated:** ~68 days ago (circa April 2026)  
**Scope:** Development, Preview, Production

---

## Current API Call Flow (Per Scan)

1. **Vision identification** (Claude Opus) → title, issue, year
2. **PC product search** (`/api/products`) → price, productId
3. **PC HTML scrape** (`/game/{productId}`) → pop, sales, ladder, velocity
4. **eBay Browse API** → active comps
5. **eBay Finding API** (BYPASSED since April 2026)
6. **PC sales history** (from HTML scrape) → sold comps
7. **ComicVine API** → metadata
8. **GoCollect API** (if token present) → CGC FMV

**Total PC calls per scan:** 1-2 API + 1 HTML scrape  
**PC data used for:**
- `pricingSource: 'pc_estimate'` when no verified comps
- `pricingSource: 'pricecharting'` (legacy, same as pc_estimate)
- Sold comps verification (Ship #20a foundation)
- Pop data for CGC grading upside (CollectionDetail panel)
- Price ladder for grade multiplier validation

---

## What We Need to Unlock Lot Calculator / Photo Appraiser

### Option A: Contact PriceCharting Support
- Request API documentation for:
  - Lot Calculator endpoint
  - Photo Appraiser endpoint
  - Profitable Grading Suggestions data format
- Account email: `boatsbaron@gmail.com` (from CLAUDE.md)
- Include current token usage (2/5+ endpoints)

### Option B: Reverse-Engineer from PC Web App
- Inspect network traffic during:
  - Lot Calculator usage (if web-accessible)
  - Photo Appraiser usage
- Extract endpoint paths, request format, response shape
- Risk: Undocumented endpoints may change without notice

### Option C: Search PC Community / Forums
- Reddit r/pricecharting
- Discord (if exists)
- GitHub issues for PC integrations

---

## Bulk Intake Flow — Technical Design (Hypothetical)

**IF** Lot Calculator accepts photo batch:

```javascript
// NEW ENDPOINT: api/bulk-intake.js
export default async function handler(req, res) {
  const { images } = req.body; // array of base64
  
  // Call PC Lot Calculator (HYPOTHETICAL)
  const pcLotResult = await fetch('https://www.pricecharting.com/api/lot-calculator', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.PRICECHARTING_TOKEN}` },
    body: JSON.stringify({ photos: images, type: 'comic' })
  });
  
  const lot = await pcLotResult.json();
  // lot = { total: 1247.50, items: [{ title, issue, price, productId }, ...] }
  
  // Enrich each item with Comic Vault layers
  const enriched = await Promise.all(
    lot.items.map(item => quickEnrich(item)) // minimal enrich, skip Vision
  );
  
  res.json({ total: lot.total, items: enriched });
}
```

**IF** Lot Calculator accepts title list:

```javascript
// Bulk CSV import → PC Lot Calculator
const items = parseCSV(req.body.csv); // [{ title, issue, year }, ...]
const pcQuery = items.map(i => `${i.title} ${i.issue}`).join('\n');

const pcLotResult = await fetch('https://www.pricecharting.com/api/lot-calculator', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${process.env.PRICECHARTING_TOKEN}` },
  body: JSON.stringify({ list: pcQuery, type: 'comic' })
});
```

**Vercel function cap:** Currently 12/12 — bulk-intake.js would require:
- Deleting an existing endpoint, OR
- Consolidating endpoints (merge metadata.js into enrich.js?)

---

## Photo Appraiser — Integration Points

**Fallback identity resolver:**

```javascript
// api/enrich.js — after Vision + eBay consensus both fail
if (!confirmedTitle && process.env.PRICECHARTING_TOKEN) {
  console.log('[pc-photo] Vision + eBay failed — trying PC Photo Appraiser');
  const pcPhoto = await lookupPCPhotoAppraiser(imageBase64);
  if (pcPhoto?.productId) {
    confirmedTitle = pcPhoto.title;
    confirmedIssue = pcPhoto.issue;
    priceCharting = { id: pcPhoto.productId, price: pcPhoto.price };
  }
}
```

**Cross-validation (Ship 26+ territory):**

```javascript
// Three-way consensus: Vision vs eBay vs PC Photo
const [vision, ebay, pcPhoto] = await Promise.all([
  callVision(image),
  lookupEbayIdentity(image),
  lookupPCPhotoAppraiser(image)
]);

const consensus = resolveThreeWayConsensus(vision, ebay, pcPhoto);
// consensus.source = 'unanimous' | 'majority' | 'conflict'
```

---

## Profitable Grading Suggestions — Integration

**IF** embedded in /api/products response:

```javascript
// api/enrich.js lookupPriceCharting
const product = products[0];
const gradingSuggestion = product.grading_suggestion; // hypothetical field
// gradingSuggestion = { recommended_grade: 9.6, profit_estimate: 245, confidence: 'high' }
```

**IF** separate endpoint:

```javascript
// api/enrich.js — parallel fetch with PC product search
const [pcProduct, pcGrading] = await Promise.all([
  lookupPriceCharting({ title, issue, year }),
  fetchPCGradingSuggestion(productId, currentGrade)
]);
```

**UI integration:**
- Replace GoCollect-based CGC profit calculator
- Or run BOTH and show comparison
- Surface PC recommendation in Decision Engine

---

## Next Steps (Requires User Approval)

1. **Contact PriceCharting Support**
   - Request API documentation for Lot Calculator, Photo Appraiser, Profitable Grading
   - Confirm endpoint paths, auth method, rate limits

2. **Test Lot Calculator** (once documented)
   - Single batch upload (5 comics)
   - Measure response time vs sequential scans
   - Validate product ID linkage to /game/{id} scrape

3. **Test Photo Appraiser** (once documented)
   - Accuracy benchmark vs Claude Vision (same 20-comic test set)
   - Speed comparison
   - Cross-validation protocol design

4. **Evaluate Profitable Grading vs GoCollect**
   - Data source comparison
   - Accuracy (PC historical sales vs GoCollect CGC census)
   - UI: show both? replace GoCollect?

5. **Function cap mitigation**
   - IF bulk-intake.js needed: consolidate metadata.js → enrich.js
   - OR: deploy metadata.js as scheduled cron (not HTTP handler)

---

## Open Questions

1. **Lot Calculator input format:**
   - Does it accept photos? Titles? Both?
   - Max batch size?
   - Response time for 50-item batch?

2. **Photo Appraiser accuracy:**
   - Trained on comic covers specifically?
   - Handles variants? CGC slabs?
   - Returns confidence score?

3. **Profitable Grading data source:**
   - PC's own model or third-party (CGC/CBCS)?
   - Does it factor in current market velocity?
   - Grade range (just 9.4/9.6/9.8 or full ladder)?

4. **Rate limits:**
   - Current /api/products calls: ~200/day (100 scans/day × 2 calls)
   - Would Lot Calculator count as 1 call or N calls?
   - Photo Appraiser rate limit?

5. **Cost:**
   - Is the account tiered? Current usage vs limits?
   - Does Lot Calculator consume credits?

---

## Risk Assessment

### Low Risk
- **Contact PC support** — no code changes, gathers intel
- **Test Photo Appraiser** — parallel to Vision, doesn't block existing flow

### Medium Risk
- **Lot Calculator integration** — new bulk flow, may affect function cap
- **Profitable Grading integration** — replaces GoCollect UI (user preference?)

### High Risk
- **Replacing Vision with PC Photo** — accuracy unknown, latency unknown
- **HTML scrape breakage** — PC may change /game/{id} schema (already accepted risk)

---

## Appendix: Current PC Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ SCAN INPUT: base64 image                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Vision (Claude Opus) → title, issue, year, grade                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ PC /api/products?q={title} {issue}&type=comic                   │
│   ↓                                                              │
│ Returns: { price: 672, productName: "...", id: "comic-book/..." }│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ PC /game/{productId} (HTML scrape, cached 7d)                   │
│   ↓                                                              │
│ Extracts:                                                        │
│   - pop_data: [14 grade buckets]                                │
│   - sales: [{ price, date, grade, marketplace }, ...]           │
│   - priceLadder: { "9.4": 681, "9.8": 2757, ... }               │
│   - salesVelocity: { "9.4": "3 sales/week", ... }               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ PRICING STACK (api/enrich.js line 2744+)                        │
│   1. priceBands (verified_sold / verified_active)               │
│   2. priceCharting.price × gradeMultiplier                      │
│   3. browse_api (eBay active avg)                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ OUTPUT: { price, pricingSource, pop, soldComps, priceLadder }  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Conclusion

Comic Vault is **under-utilizing** its PriceCharting API account. Integrating Lot Calculator, Photo Appraiser, and Profitable Grading Suggestions could unlock:

1. **Bulk intake** (50+ comics in one call)
2. **Fallback identity** (when Vision + eBay fail)
3. **Cross-validation** (three-way consensus)
4. **Better grading ROI** (PC model vs GoCollect)

**Blocker:** PC API documentation is HTTP 403 forbidden. **Next step:** Contact PriceCharting support for endpoint specs.

**No code changes** until documentation acquired and endpoints validated.

---

**Report compiled:** 2026-06-19  
**Next review:** After PC support response
