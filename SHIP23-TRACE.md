# Ship #23 — Code Execution Trace

## Where Each Fix Lives in the Pipeline

---

## FIX 1: CV Year Gate
**File:** `api/enrich.js` **Lines:** 569-589

### Trigger Point
```javascript
// Line 569: Right after volDetails are fetched
if (comicYear && comicYear < 1970) {  // ← GATE FIRES HERE
```

### What Happens
```javascript
// Line 570-579: Filter candidates by ±15y
const beforeFilter = candidates.length;
const filteredCandidates = candidates.filter((r) => {
  const vid = r?.volume?.id;
  const vol = volDetails[vid];
  if (!vol || !vol.start_year) return true;  // Keep if no year
  return Math.abs(vol.start_year - comicYear) <= 15;  // ± 15 years
});
```

### Console Log
```javascript
// Line 583-585: Success case
console.log(
  `[cv-year-gate] ${comicYear}: ${beforeFilter} → ${candidates.length} volumes (filtered ±15y)`
)

// Line 587-589: Graceful fallback case
console.log(
  `[cv-year-gate] ${comicYear}: would remove all ${beforeFilter} volumes — keeping original set`
)
```

### Watch For
```bash
# In server logs (Vercel Functions or npm run dev):
[cv-year-gate] 1941: 3 → 1 volumes (filtered ±15y)
```

---

## FIX 2: Refuse to Price
**File:** `api/enrich.js` **Lines:** 2489-2509

### Trigger Point
```javascript
// Line 2489: Right after confidence level is set
if (
  verifiedCount === 0 &&
  soldCount === 0 &&
  out.price != null &&
  out.pricingSource === "browse_api"
) {  // ← GATE FIRES HERE
```

### What Happens
```javascript
// Line 2495-2502: Refuse pricing, set flags
console.log(
  `[refuse-to-price] 0 verified comps + 0 sold comps — refusing browse_api price ${out.price}`
);
out.price = null;
out.priceLow = null;
out.priceHigh = null;
out.priceBands = null;
out.priceNote = "Insufficient data — no verified comps found";
out.refusedToPrice = true;
out.pricingSource = "refused";
```

### Console Log
```bash
[refuse-to-price] 0 verified comps + 0 sold comps — refusing browse_api price $8.50
```

### Watch For
**UI:** Card shows "Insufficient data — no verified comps found" instead of a price.

---

## FIX 3: Stale Record Auto-Refresh
**File:** `src/App.jsx` **Lines:** 6754-6761 (Collection), 6833-6840 (Manage)

### Trigger Point
```javascript
// Line 6754: When user taps a book to open detail
onOpen={(item) => {
  // ... scroll/state management ...
  
  // Line 6756: Stale check
  const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals;
  if (isStale) {  // ← GATE FIRES HERE
```

### What Happens
```javascript
// Line 6757-6761: Silent background refresh
console.log(`[stale-refresh] auto-refreshing ${item.title} #${item.issue || "?"}`);
refreshMarketData(item).catch((err) =>
  console.error("[stale-refresh] failed:", err)
);
```

### Console Log
```bash
[stale-refresh] auto-refreshing Spooky Haunted House #118
[enrich] refresh start id=xyz789-1746140400 title=Spooky Haunted House #118
# ... enrich pipeline logs ...
```

### Watch For
**Browser Console:** Look for `[stale-refresh]` when opening old books.  
**UI:** Price bands appear 2-3 seconds after opening detail view.

---

## FIX 4: Update All Books Button
**File:** `src/App.jsx` **Lines:** 3848-3870 (handler), 4348-4377 (button)

### Trigger Point (Button Render)
```javascript
// Line 4348: Manage tab button section
{(() => {
  const staleCount = catalogue.filter(
    (c) => !c.priceBands || !c.claudeCheck || !c.demandSignals
  ).length;
  if (staleCount === 0) return null;  // Hide if no stale books
  
  // Line 4352: Button renders
  return (
    <button onClick={runUpdateAll}>  // ← CLICK FIRES HERE
```

### Handler Logic
```javascript
// Line 3848-3870: runUpdateAll function
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
      await onUpdateAll(staleBooks[i]);  // refreshMarketData()
    } catch (err) {
      console.error(`[update-all] failed for ${staleBooks[i].title}:`, err);
    }
    if (i < staleBooks.length - 1) {
      await new Promise((res) => setTimeout(res, 2000));  // 2s rate limit
    }
  }
  
  setUpdateAllRunning(false);
  setUpdateAllProgress({ current: 0, total: 0 });
};
```

### Console Log
```bash
[update-all] failed for Spooky Haunted House #118: Error: Failed to refresh
```

### Watch For
**UI:** Button text changes: `🔄 Updating 12 of 47...`  
**Browser Console:** Look for `[update-all]` errors if any fail.

---

## Full Pipeline Flow (Action Comics #33 Example)

```
┌─────────────────────────────────────────────────────────────┐
│ USER SCANS COMIC                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ POST /api/grade (Vision)                                    │
│ → title: "Action Comics #33"                                │
│ → year: 1941                                                │
│ → grade: "VG"                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ POST /api/enrich                                            │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ PHASE 1: ComicVine Lookup                           │   │
│ │ → Query: "Action Comics 33"                         │   │
│ │ → Fetch volume details (parallel)                   │   │
│ │                                                      │   │
│ │ 🔧 FIX 1 FIRES (line 569)                           │   │
│ │ → comicYear=1941 < 1970 ✓                           │   │
│ │ → Filter candidates by ±15y                         │   │
│ │ → [cv-year-gate] 1941: 3 → 1 volumes                │   │
│ │                                                      │   │
│ │ → Match: Action Comics (1938) ✓                     │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ PHASE 2: eBay Comps Lookup                          │   │
│ │ → Query: "Action Comics #33 1941 DC"                │   │
│ │ → Filter chain: reprint/lot/slab/grade/...          │   │
│ │ → verifiedCount: 6                                  │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ PHASE 3: Sold Comps (PC scrape)                     │   │
│ │ → soldCount: 3                                      │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ PHASE 4: Pricing Decision                           │   │
│ │ → computePriceBands() → market=$920                 │   │
│ │                                                      │   │
│ │ 🔧 FIX 2 CHECK (line 2489)                          │   │
│ │ → verifiedCount=6 (not 0) → SKIP ✗                  │   │
│ │                                                      │   │
│ │ → pricingSource: "verified_sold"                    │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ PHASE 5: Claude Check + Demand Signals              │   │
│ │ → claudeCheck: "high"                               │   │
│ │ → demandSignals: { velocity: "MEDIUM" }            │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ RETURN:                                                     │
│ {                                                           │
│   price: "$920.00",                                         │
│   priceBands: { quick: 850, market: 920, stretch: 1050 },  │
│   claudeCheck: { quality: "high" },                         │
│   demandSignals: { velocity: "MEDIUM" },                    │
│   confidenceLevel: "HIGH"                                   │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CLIENT: Merge into catalogue, save to IndexedDB            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ USER TAPS BOOK TO OPEN DETAIL                               │
│                                                             │
│ 🔧 FIX 3 CHECK (line 6756)                                  │
│ → isStale = !priceBands || !claudeCheck || !demandSignals  │
│ → isStale = false || false || false = false                │
│ → SKIP ✗                                                    │
│                                                             │
│ Book opens immediately (no refresh needed)                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ USER OPENS MANAGE TAB                                       │
│                                                             │
│ 🔧 FIX 4 CHECK (line 4349)                                  │
│ → staleCount = catalogue.filter(c => !c.priceBands...)      │
│ → staleCount = 0                                            │
│ → Button hidden ✗                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Failure Flow (Zero Comps Case)

```
┌─────────────────────────────────────────────────────────────┐
│ SCAN: Spooky Haunted House #118 (1965)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ POST /api/enrich                                            │
│                                                             │
│ 🔧 FIX 1 FIRES → filters 2008 volume (43y gap)              │
│ → Still matches wrong 1972 series (7y gap within ±15)      │
│                                                             │
│ eBay Comps: 1 found, 0 verified (reprint rejected)         │
│ Sold Comps: 0 found (no PC data)                           │
│                                                             │
│ Browse API fallback: $8.50 (unverified)                    │
│                                                             │
│ 🔧 FIX 2 FIRES (line 2489)                                  │
│ → verifiedCount=0 ✓                                         │
│ → soldCount=0 ✓                                             │
│ → pricingSource="browse_api" ✓                              │
│ → [refuse-to-price] refusing $8.50                         │
│                                                             │
│ RETURN:                                                     │
│ {                                                           │
│   price: null,                                              │
│   priceNote: "Insufficient data — no verified comps",       │
│   priceBands: null,                                         │
│   claudeCheck: { quality: "low" },                          │
│   demandSignals: null,                                      │
│   refusedToPrice: true                                      │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ SAVE TO INDEXEDDB (missing priceBands + demandSignals)     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ USER TAPS BOOK                                              │
│                                                             │
│ 🔧 FIX 3 FIRES (line 6756)                                  │
│ → isStale = true || false || true = true ✓                 │
│ → [stale-refresh] auto-refreshing Spooky #118              │
│ → Runs /api/enrich in background                           │
│ → (still no comps → stays null)                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ USER OPENS MANAGE TAB                                       │
│                                                             │
│ 🔧 FIX 4 FIRES (line 4349)                                  │
│ → staleCount = 1 (this book) ✓                             │
│ → Button shows: "🔄 Update All Books (1)"                   │
│                                                             │
│ User taps → runUpdateAll() queues refresh                  │
│ → Rate-limited 2s loop                                     │
│ → (still no comps → stays null)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Phone Validation Steps

### 1. Test FIX 1 (CV Year Gate)
**Scan:** Any pre-1970 book (e.g., Amazing Spider-Man #50, 1967)

**Look for in Vercel logs:**
```bash
[cv-year-gate] 1967: N → M volumes (filtered ±15y)
```

**Verify:** ComicVine `start_year` is within ±15 years of 1967 (1952–1982 range).

---

### 2. Test FIX 2 (Refuse to Price)
**Scan:** Obscure indie book (or manually trigger by editing book year to break comps)

**Look for in Vercel logs:**
```bash
[refuse-to-price] 0 verified comps + 0 sold comps — refusing browse_api price $X.XX
```

**Verify UI shows:**
```
Insufficient data — no verified comps found
```

**NOT:** `$8.50` or any price.

---

### 3. Test FIX 3 (Stale Refresh)
**Setup:** Scan a book, note it has priceBands. Delete `priceBands` field from IndexedDB (dev tools).

**Action:** Tap the book to open detail.

**Look for in browser console:**
```bash
[stale-refresh] auto-refreshing <title> #<issue>
[enrich] refresh start id=...
```

**Verify:** Price bands reappear 2-3 seconds after opening.

---

### 4. Test FIX 4 (Update All Books)
**Setup:** Have at least 1 stale book (missing priceBands or demandSignals).

**Action:** Open Manage tab.

**Verify button appears:**
```
🔄 Update All Books (N)
```

**Tap button → watch progress:**
```
🔄 Updating 1 of N...
🔄 Updating 2 of N...
...
```

**After completion:** Button should hide (no more stale books).

---

## Troubleshooting

### FIX 1 not firing?
**Check:** Is book year ≥ 1970? (Gate only applies to pre-1970 books)

### FIX 2 not firing?
**Check:** 
- Does book have verified comps? (Check `rawComps.count > 0`)
- Does book have sold comps? (Check `filteredSold.length > 0`)
- Is pricingSource `"browse_api"`? (PC sources bypass the gate)

### FIX 3 not firing?
**Check:** Does book have all three fields? (`priceBands`, `claudeCheck`, `demandSignals`)

### FIX 4 button not showing?
**Check:** Are there any stale books in catalogue? Run in console:
```javascript
catalogue.filter(c => !c.priceBands || !c.claudeCheck || !c.demandSignals).length
```

---

## Summary

All four fixes are **live in production** (commit `1751f4c`).  
Phone validation = verify console logs + UI behavior match expectations above.
