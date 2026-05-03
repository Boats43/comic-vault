# Ship #23 Pipeline Simulation — FAILURE CASE
## Obscure 1965 Indie Comic (Zero Comps Scenario)

**Input:**
```json
{
  "title": "Spooky Haunted House #118",
  "issue": "118",
  "year": 1965,
  "publisher": "Harvey",
  "grade": "VG",
  "isGraded": false
}
```

---

## PHASE 1: ComicVine Lookup (FIX 1 TEST)

### Step 1.1: Initial CV Search
Query: `"Spooky Haunted House 118"`
API returns 8 results:

```javascript
results = [
  {
    id: 11111,
    issue_number: "118",
    volume: { id: 1111, name: "Spooky Haunted House" }
  },
  {
    id: 22222,
    issue_number: "118",
    volume: { id: 2222, name: "Spooky" }
  },
  {
    id: 33333,
    issue_number: "118",
    volume: { id: 3333, name: "Haunted House Stories" }
  }
]
```

### Step 1.2: Volume Detail Fetch
```javascript
volDetails = {
  1111: { 
    id: 1111, 
    name: "Spooky Haunted House",
    start_year: 1972,  // Harvey relaunch (wrong era)
    publisher: { name: "Harvey Comics" }
  },
  2222: { 
    id: 2222, 
    name: "Spooky",
    start_year: 1955,  // Original Harvey series ✅
    publisher: { name: "Harvey Publications" }
  },
  3333: {
    id: 3333,
    name: "Haunted House Stories",
    start_year: 2008,  // Modern horror anthology
    publisher: { name: "IDW Publishing" }
  }
}
```

### Step 1.3: **🔧 FIX 1 — CV YEAR GATE FIRES**

**Condition Check:**
```javascript
comicYear = 1965
comicYear < 1970 → TRUE ✅
```

**Filter Applied:**
```javascript
// BEFORE FILTER:
candidates = [
  { volume_id: 1111, start_year: 1972 },  // gap = 7y
  { volume_id: 2222, start_year: 1955 },  // gap = 10y
  { volume_id: 3333, start_year: 2008 }   // gap = 43y
]

// FILTER LOGIC:
Math.abs(1972 - 1965) = 7  ≤ 15 → KEEP ✅
Math.abs(1955 - 1965) = 10 ≤ 15 → KEEP ✅
Math.abs(2008 - 1965) = 43 > 15 → REJECT ❌

// AFTER FILTER:
candidates = [
  { volume_id: 1111, start_year: 1972 },
  { volume_id: 2222, start_year: 1955 }
]
```

**Console Output:**
```
[cv-year-gate] 1965: 3 → 2 volumes (filtered ±15y)
```

### Step 1.4: Volume Scoring
```javascript
// Two candidates → score them
scored = [
  {
    volume_id: 1111,
    nameScore: 100,    // "Spooky Haunted House" exact match
    yearScore: 1,      // 7y diff (10-20 range) → +1
    publisherScore: 2, // Harvey matches → +2
    total: 103
  },
  {
    volume_id: 2222,
    nameScore: 50,     // "Spooky" partial match
    yearScore: 2,      // 10y diff < 10 → +2
    publisherScore: 2, // Harvey matches → +2
    total: 54
  }
]

// Highest score wins (but it's the WRONG series)
match = volume 1111 (1972 relaunch) ⚠️
```

**Problem:** Year gate kept both, but name-score prioritized wrong series.  
**Result:** Mismatch (1972 data for 1965 book) — but better than 2008 match!

---

## PHASE 2: eBay Comps Lookup

### Step 2.1: Comp Search
Query: `"Spooky Haunted House #118 1965 Harvey"`

**Raw eBay Results:** 3 listings found (obscure book, thin market)
```javascript
[
  "Spooky Haunted House Lot #115-120 1970s Harvey",  // ❌ lot
  "Spooky #118 Harvey 1972 Reprint",                 // ❌ reprint
  "Spooky Haunted House #118 Harvey VG",             // ✅ maybe?
]
```

### Step 2.2: Comp Filter Chain
**Filter 1e (lot):** Removes lot → 2 remain  
**Filter 1 (reprint):** Removes reprint → 1 remains  

**After Filters:** 1 listing
```javascript
rawListings = [
  { title: "Spooky Haunted House #118 Harvey VG", price: 8.50 }
]
```

### Step 2.3: AI Verify (Claude checks listing text)
```javascript
// Claude analyzes: "Spooky Haunted House #118 Harvey VG"
// Checks: title match, issue match, year proximity
// Verdict: REJECT (seller description says "1972 reprint" in fine print)

verifiedCount = 0 ❌
```

**Console Output:**
```
[verify] Spooky Haunted House #118 | grade: VG | 
  comps: 0 verified / 1 checked | sold: 0 found | 
  confidence: LOW | recommended: AI est
```

---

## PHASE 3: Sold Comps (Ship #20a)

**PriceCharting scrape:** No sales found (obscure book, no PC listing)
```javascript
soldCompsRaw = []
soldCount = 0 ❌
```

---

## PHASE 4: Pricing Decision (FIX 2 FIRES!)

### Step 4.1: Price Bands Check
```javascript
verifiedCount = 0
soldCount = 0

// Ship #20b — no verified comps, no sold comps
priceBandsRaw = null  // Can't compute bands with no data
```

### Step 4.2: PriceCharting Fallback
```javascript
priceCharting = null  // No PC listing for this book
```

### Step 4.3: Browse API Fallback
```javascript
// Falls back to raw eBay average (unverified)
compsFromEbay = {
  average: 8.50,   // From the 1 unverified listing
  lowest: 8.50,
  highest: 8.50,
  count: 1
}

// Browse API pricing:
browsePrice = 8.50
out.price = "$8.50"
out.priceLow = "$6.38"   // 8.50 × 0.75
out.priceHigh = "$10.63" // 8.50 × 1.25
out.pricingSource = "browse_api"
```

### Step 4.4: **🔧 FIX 2 — REFUSE-TO-PRICE FIRES!**

**Condition Check:**
```javascript
verifiedCount === 0 → TRUE ✅
soldCount === 0 → TRUE ✅
out.price != null → TRUE (we have $8.50) ✅
out.pricingSource === "browse_api" → TRUE ✅

// ALL CONDITIONS MET — REFUSE TO PRICE!
```

**Action Taken:**
```javascript
console.log(
  '[refuse-to-price] 0 verified comps + 0 sold comps — refusing browse_api price $8.50'
)

out.price = null
out.priceLow = null
out.priceHigh = null
out.priceBands = null
out.priceNote = "Insufficient data — no verified comps found"
out.refusedToPrice = true
out.pricingSource = "refused"
```

**Why This Matters:**  
Without FIX 2, the UI would show **$8.50** from a **1972 reprint listing** that AI rejected. User lists at $8.50 → wrong price for 1965 original.

---

## PHASE 5: Confidence & Signals

### Confidence Level
```javascript
verifiedCount = 0
soldCount = 0
hasPCData = false

confidenceLevel = "LOW" ⚠️

out.confidenceLevel = "LOW"
```

### Claude Check (Ship #21)
```javascript
out.claudeCheck = {
  quality: "low",
  identityConfident: false,  // CV mismatch (1972 vs 1965)
  reasoning: "ComicVine matched 1972 relaunch, but user year is 1965. Low confidence."
}
```

### Demand Signals (Ship #21)
```javascript
// Can't compute without sold comps
out.demandSignals = null
```

---

## PHASE 6: Storage & Stale Check (FIX 3 TEST)

### Step 6.1: Item Saved to IndexedDB
```javascript
catalogueItem = {
  id: "xyz789",
  title: "Spooky Haunted House #118",
  year: 1965,
  grade: "VG",
  price: null,  // Refused to price
  priceBands: null,
  claudeCheck: { quality: "low", ... },
  demandSignals: null,  // Missing
  priceNote: "Insufficient data — no verified comps found",
  refusedToPrice: true,
  timestamp: 1746140400000
}
```

### Step 6.2: **🔧 FIX 3 — STALE CHECK (on next open)**

**User taps book to open detail:**
```javascript
const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals

// Check:
!item.priceBands → TRUE (null) ✅
!item.claudeCheck → FALSE (exists) ❌
!item.demandSignals → TRUE (null) ✅

isStale = true ✅

// FIX 3 FIRES — book is stale!
console.log('[stale-refresh] auto-refreshing Spooky Haunted House #118')
refreshMarketData(item).catch(...)
```

**What Happens:**  
Silent background `/api/enrich` call runs. If new comps appeared since last scan, `priceBands` and `demandSignals` populate. If still no comps, stays refused.

---

## PHASE 7: Update All Books (FIX 4 TEST)

### Step 7.1: Manage Tab Check
```javascript
// User opens Manage tab
const staleCount = catalogue.filter(
  c => !c.priceBands || !c.claudeCheck || !c.demandSignals
).length

// Includes this book (missing priceBands + demandSignals)
staleCount = 1  // (or 47 if user has many old scans)
```

### Step 7.2: **🔧 FIX 4 — BUTTON APPEARS**

**Button Rendered:**
```jsx
<button onClick={runUpdateAll}>
  🔄 Update All Books (1)
</button>
```

**User Taps Button:**
```javascript
// FIX 4 FIRES!
runUpdateAll() {
  const staleBooks = catalogue.filter(
    c => !c.priceBands || !c.claudeCheck || !c.demandSignals
  )
  
  // Queue refresh for Spooky #118
  for (let i = 0; i < staleBooks.length; i++) {
    setUpdateAllProgress({ current: i+1, total: 1 })
    await onUpdateAll(staleBooks[i])  // refreshMarketData()
    await sleep(2000)  // Rate limit
  }
}
```

**Progress Indicator:**
```
🔄 Updating 1 of 1...
```

After 2 seconds → refresh completes:
- If still no comps: `priceBands` stays null, `demandSignals` stays null
- Button hides (no more stale books)

---

## FAILURE PATH SUMMARY

### ✅ FIX 1 Applied
- **Filtered out** 2008 IDW volume (43y gap)
- **Kept** 1972 & 1955 volumes (within ±15y)
- **Result:** Prevented catastrophic mismatch, but still got wrong series (1972 vs 1965)
- **Why:** Name-score prioritization issue (separate from Ship #23)

### ✅ FIX 2 Fired
- 0 verified active comps (AI rejected the 1 reprint)
- 0 verified sold comps (no PC data)
- Pricing source: `browse_api` ($8.50 from reprint)
- **Result:** Refused to price → shows "Insufficient data"
- **Impact:** Prevents user from listing at wrong price

### ✅ FIX 3 Fired
- Missing `priceBands` (null)
- Missing `demandSignals` (null)
- Has `claudeCheck` (low quality)
- **Result:** Auto-refresh triggers on next open

### ✅ FIX 4 Applied
- Book is stale (missing 2 of 3 fields)
- **Result:** Appears in "Update All Books" queue
- **Action:** Batch refresh available

---

## FINAL OUTPUT

```json
{
  "title": "Spooky Haunted House #118",
  "year": 1965,
  "grade": "VG",
  "price": null,
  "priceLow": null,
  "priceHigh": null,
  "pricingSource": "refused",
  "priceNote": "Insufficient data — no verified comps found",
  "priceBands": null,
  "confidenceLevel": "LOW",
  "comicVine": {
    "volume": {
      "name": "Spooky Haunted House",
      "start_year": 1972  // ⚠️ Mismatch (user year 1965)
    }
  },
  "claudeCheck": {
    "quality": "low",
    "identityConfident": false
  },
  "demandSignals": null,
  "refusedToPrice": true,
  "identityConfident": false,
  "comps": {
    "count": 0,
    "verified": 0,
    "checked": 1
  }
}
```

---

## WHERE FIXES FIRE

| Fix | Fires? | Why |
|-----|--------|-----|
| **FIX 1** (CV year gate) | ✅ YES | Pre-1970 book (1965), filtered 2008 volume |
| **FIX 2** (refuse-to-price) | ✅ YES | 0 verified + 0 sold + browse_api source |
| **FIX 3** (stale refresh) | ✅ YES | Missing priceBands + demandSignals |
| **FIX 4** (update all) | ✅ YES | Book is stale (2 of 3 fields missing) |

---

## UI Display

**Collection Card:**
```
┌─────────────────────────────────┐
│ Spooky Haunted House #118       │
│ 1965 · Harvey · VG              │
│                                 │
│ Insufficient data — no          │
│ verified comps found            │
│                                 │
│ 🔴 LOW confidence               │
│ 0 verified comps                │
└─────────────────────────────────┘
```

**Detail View:**
```
⚠️ Identity Not Confirmed
ComicVine matched 1972 relaunch, but your year is 1965.

💰 Pricing
No price available — insufficient market data.

📊 Market Data
• 0 verified active comps
• 0 sold comps (90 days)
• No PriceCharting data

🔄 Refresh button available
```

---

## KEY WINS

1. **FIX 1** prevented matching 2008 IDW horror anthology (43y gap)
2. **FIX 2** prevented showing $8.50 from unverified 1972 reprint
3. **FIX 3** enables silent refresh when user opens book (if new comps appear)
4. **FIX 4** allows batch refresh of this + other stale books

**Without Ship #23:**  
User sees "$8.50" from reprint → lists at $8.50 → loses money (if original worth $25+) or overprices (if reprint worth $2).

**With Ship #23:**  
User sees "Insufficient data" → knows to research manually or skip listing → no bad transaction.
