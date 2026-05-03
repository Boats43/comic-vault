# Ship #23 Pipeline Simulation
## Action Comics #33 (1941)

**Input:**
```json
{
  "title": "Action Comics #33",
  "issue": "33",
  "year": 1941,
  "publisher": "DC",
  "grade": "VG",
  "isGraded": false
}
```

---

## PHASE 1: ComicVine Lookup (FIX 1 TEST)

### Step 1.1: Initial CV Search
Query: `"Action Comics 33"`
API returns 20 results (multiple volumes):

```javascript
results = [
  {
    id: 12345,
    issue_number: "33",
    volume: { id: 1234, name: "Action Comics" }
    // Missing start_year (needs volume detail fetch)
  },
  {
    id: 67890,
    issue_number: "33",
    volume: { id: 6789, name: "Action Comics" }
  },
  // ... more results
]
```

### Step 1.2: Volume Detail Fetch (Parallel)
Fetches volume details for unique volume IDs:

```javascript
volDetails = {
  1234: { 
    id: 1234, 
    name: "Action Comics",
    start_year: 1938,  // Original Golden Age series
    publisher: { name: "DC Comics" }
  },
  6789: { 
    id: 6789, 
    name: "Action Comics",
    start_year: 2011,  // New 52 relaunch
    publisher: { name: "DC Comics" }
  },
  7891: {
    id: 7891,
    name: "Action Comics",
    start_year: 2016,  // Rebirth
    publisher: { name: "DC Comics" }
  }
}
```

### Step 1.3: **🔧 FIX 1 — CV YEAR GATE FIRES**

**Condition Check:**
```javascript
comicYear = 1941
comicYear < 1970 → TRUE ✅
```

**Filter Applied:**
```javascript
// BEFORE FILTER:
candidates = [
  { volume_id: 1234, start_year: 1938 },  // gap = 3y
  { volume_id: 6789, start_year: 2011 },  // gap = 70y
  { volume_id: 7891, start_year: 2016 }   // gap = 75y
]

// FILTER LOGIC:
Math.abs(1938 - 1941) = 3  ≤ 15 → KEEP ✅
Math.abs(2011 - 1941) = 70 > 15 → REJECT ❌
Math.abs(2016 - 1941) = 75 > 15 → REJECT ❌

// AFTER FILTER:
candidates = [
  { volume_id: 1234, start_year: 1938 }  // Only the original series
]
```

**Console Output:**
```
[cv-year-gate] 1941: 3 → 1 volumes (filtered ±15y)
```

### Step 1.4: Volume Scoring & Match
```javascript
// Single candidate → validate year/publisher
scored = {
  nameScore: 100,     // "Action Comics" exact match
  yearScore: 2,       // 3y diff < 10 → +2
  publisherScore: 2,  // "DC Comics" matches "DC" → +2
  total: 104
}

match = candidates[0]  // Volume 1234 (1938 series) ✅
```

**Console Output:**
```
[comicvine] query="Action Comics 33" issue=33 year=1941
  results=20 issueMatches=3 matched=Action Comics #33 (vol_id=1234)
```

**CV Result:**
```json
{
  "comicVine": {
    "issue_number": "33",
    "volume": {
      "id": 1234,
      "name": "Action Comics",
      "start_year": 1938
    },
    "cover_date": "1941-02-01",
    "description": "Golden Age adventure featuring Superman...",
    "keyIssue": null  // No structured first-appearance data
  }
}
```

---

## PHASE 2: eBay Comps Lookup

### Step 2.1: Comp Search
Query: `"Action Comics #33 1941 DC"`

**Raw eBay Results:** 12 listings found
```javascript
[
  "Action Comics #33 CGC 4.0 Golden Age Superman 1941",
  "Action Comics #33 1941 DC Golden Age VG",
  "Action Comics 33 Golden Age Facsimile Reprint",  // ❌ reprint
  "Action Comics #33 2011 New 52 #33",              // ❌ wrong year
  "Action Comics Lot #30-35 1941",                  // ❌ lot
  "Action Comics #33 CGC 3.5 1941",
  "Action Comics #33 Raw VG 1941 Superman",
  // ... more
]
```

### Step 2.2: Comp Filter Chain
**Filter 0c (title similarity):** All match ✅  
**Filter 1 (reprint):** Removes facsimile → 11 remain  
**Filter 1b (variant contamination):** None found → 11 remain  
**Filter 1d (cover letter):** N/A → 11 remain  
**Filter 1e (lot):** Removes lot listing → 10 remain  
**Filter 2 (slab):** CGC listings flagged but kept → 10 remain  
**Filter 3 (grade proximity):** VG user grade → keeps VG/FN/GD range → 7 remain  
**Filter 4 (price sanity):** Removes 1 outlier → 6 remain  
**Filter 5 (dedup):** 0 dupes → 6 remain  

**Verified Comps:** 6 listings
```javascript
rawComps = {
  count: 6,
  prices: [850, 920, 780, 1100, 890, 950],
  average: 915,
  lowest: 780,
  highest: 1100
}
```

---

## PHASE 3: Sold Comps (Ship #20a)

**PriceCharting scrape:** 4 sold comps found (90-day window)
```javascript
soldCompsRaw = [
  { title: "Action Comics #33 CGC 4.0", price: 1050, date: "2026-03-15" },
  { title: "Action Comics #33 Raw VG", price: 880, date: "2026-04-01" },
  { title: "Action Comics #33 CGC 3.5", price: 920, date: "2026-04-10" },
  { title: "Action Comics 33 2011", price: 25, date: "2026-04-12" }  // ❌ wrong year
]
```

**Sold Verification (`verifySoldComps`):**
```javascript
// Filter: yearMismatch → rejects 2011 listing
filteredSold = [
  { price: 1050, date: "2026-03-15" },
  { price: 880, date: "2026-04-01" },
  { price: 920, date: "2026-04-10" }
]

soldCount = 3 ✅
```

---

## PHASE 4: Pricing Decision (FIX 2 TEST)

### Step 4.1: Price Bands Calculation
```javascript
verifiedCount = 6  // active comps
soldCount = 3      // sold comps

// Ship #20b — Sold-first pricing
priceBandsRaw = computePriceBands({
  soldComps: filteredSold,
  activeComps: rawComps,
  userGrade: "VG",
  userGradeKey: "vg"
})

// Result:
priceBandsRaw = {
  quick: 850,    // 10th percentile sold
  market: 920,   // median sold
  stretch: 1050, // 90th percentile sold
  source: "verified_sold",
  count: 3
}
```

### Step 4.2: **🔧 FIX 2 — REFUSE-TO-PRICE CHECK**

**Condition Check:**
```javascript
verifiedCount === 0 → FALSE (we have 6) ❌
soldCount === 0 → FALSE (we have 3) ❌
pricingSource === "browse_api" → FALSE (source is "verified_sold") ❌

// FIX 2 DOES NOT FIRE — we have good data ✅
```

### Step 4.3: Final Pricing
```javascript
out.price = "$920.00"        // market band
out.priceLow = "$850.00"     // quick band
out.priceHigh = "$1,050.00"  // stretch band
out.pricingSource = "verified_sold"
out.priceNote = "VG · 3 verified comps"
out.priceBands = {
  quick: 850,
  market: 920,
  stretch: 1050
}
```

---

## PHASE 5: Confidence & Signals

### Confidence Level
```javascript
verifiedCount = 6
soldCount = 3
hasPCData = false

// Ship #21 logic:
if (soldCount >= 2 && verifiedCount >= 2) 
  confidenceLevel = "HIGH" ✅

out.confidenceLevel = "HIGH"
```

### Claude Check (Ship #21)
```javascript
out.claudeCheck = {
  quality: "high",
  identityConfident: true,
  reasoning: "Golden Age key period, verified via ComicVine 1938 series"
}
```

### Demand Signals (Ship #21)
```javascript
out.demandSignals = {
  velocity: "MEDIUM",      // 3 sales in 90d
  trend: "FLAT",           // ±5% variance
  liquidity: "NORMAL"      // ratio ~3
}
```

---

## PHASE 6: Storage & Stale Check (FIX 3 TEST)

### Step 6.1: Item Saved to IndexedDB
```javascript
catalogueItem = {
  id: "abc123",
  title: "Action Comics #33",
  year: 1941,
  grade: "VG",
  price: "$920.00",
  priceBands: { quick: 850, market: 920, stretch: 1050 },
  claudeCheck: { quality: "high", ... },
  demandSignals: { velocity: "MEDIUM", ... },
  timestamp: 1746140400000
}
```

### Step 6.2: **🔧 FIX 3 — STALE CHECK (on next open)**

**User taps book to open detail:**
```javascript
const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals

// Check:
!item.priceBands → FALSE (exists) ❌
!item.claudeCheck → FALSE (exists) ❌
!item.demandSignals → FALSE (exists) ❌

isStale = false

// FIX 3 DOES NOT FIRE — book has all fields ✅
// No auto-refresh needed
```

---

## SUCCESS PATH SUMMARY

### ✅ FIX 1 Applied
- **Filtered out** 2011 & 2016 volumes (70y+ gap)
- **Kept** 1938 volume (3y gap)
- **Result:** Correct Golden Age series match

### ⏭️ FIX 2 Skipped
- 6 verified active comps
- 3 verified sold comps
- Pricing source: `verified_sold` (reliable)
- **Result:** No refuse-to-price needed

### ⏭️ FIX 3 Skipped
- All fields present (`priceBands`, `claudeCheck`, `demandSignals`)
- **Result:** No auto-refresh needed

### ⏭️ FIX 4 N/A
- Book is not stale
- **Result:** Won't appear in "Update All Books" queue

---

## FINAL OUTPUT

```json
{
  "title": "Action Comics #33",
  "year": 1941,
  "grade": "VG",
  "price": "$920.00",
  "priceLow": "$850.00",
  "priceHigh": "$1,050.00",
  "pricingSource": "verified_sold",
  "priceNote": "VG · 3 verified comps",
  "priceBands": {
    "quick": 850,
    "market": 920,
    "stretch": 1050,
    "source": "verified_sold",
    "count": 3
  },
  "confidenceLevel": "HIGH",
  "comicVine": {
    "volume": {
      "name": "Action Comics",
      "start_year": 1938
    }
  },
  "claudeCheck": {
    "quality": "high"
  },
  "demandSignals": {
    "velocity": "MEDIUM",
    "trend": "FLAT"
  },
  "refusedToPrice": false,
  "identityConfident": true
}
```

---

## WHERE FIXES FIRE

| Fix | Fires? | Why |
|-----|--------|-----|
| **FIX 1** (CV year gate) | ✅ YES | Pre-1970 book (1941) |
| **FIX 2** (refuse-to-price) | ❌ NO | Has 6 verified + 3 sold comps |
| **FIX 3** (stale refresh) | ❌ NO | All fields present |
| **FIX 4** (update all) | ❌ NO | Book not stale |

**Key Win:** FIX 1 prevented matching to 2011/2016 New 52/Rebirth volumes, ensuring correct Golden Age pricing data.
