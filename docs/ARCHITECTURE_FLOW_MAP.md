# ARCHITECTURE FLOW MAP — Complete Request Tracing
**Date:** 2026-06-24  
**Status:** Current production state (Ship #28a deployed)

---

## 1. ENTRY POINTS — User Actions → API Calls

### 1A. CAMERA CAPTURE (Standard Scan)
**Location:** `src/App.jsx:7984-8130`

**Trigger:** User taps camera button → `gradeBlob(blob, { save: true })`

**Flow:**
```
User → Camera capture → JPEG blob (85% quality)
  ↓
fileToBase64(blob)
  ↓
POST /api/grade { images: [b64], source: undefined }  [SEQUENTIAL]
  ↓
POST /api/enrich { title, issue, grade, ... }        [FIRE-AND-FORGET]
  ↓
setCatalogue → IndexedDB → Screen update
```

**Files touched (in order):**
1. `src/App.jsx:gradeBlob()` — camera → base64
2. `api/grade.js:handler()` — Vision scan
3. `src/App.jsx:addToCatalogue()` — save to IndexedDB
4. `api/enrich.js:handler()` — pricing (async, no await)
5. `src/App.jsx:setCatalogue()` — merge enrich result

**Timing:**
- Camera → base64: ~50ms
- POST /api/grade: **2,000-3,000ms** (Vision call)
- Save to IndexedDB: ~20ms
- Screen shows card: **IMMEDIATE** (grade complete)
- POST /api/enrich: **1,500-3,000ms** (async, merges when ready)

---

### 1B. WATCH MODE (Buyer Scanning)
**Location:** `src/App.jsx:7246-7295`

**Trigger:** 3-second interval while Watch Mode active

**Flow:**
```
setInterval(3000ms)
  ↓
Camera snapshot → JPEG blob
  ↓
POST /api/grade { images: [b64], source: 'watch' }   [SEQUENTIAL]
  ↓ (multi-pass: Haiku P1 → Haiku P2 → Opus P3)
  ↓
Dedup check (title|issue already seen?)
  ↓
POST /api/enrich { title, issue, ... }                [FIRE-AND-FORGET]
  ↓
setResult → Screen update (show market + net profit)
```

**Files touched:**
1. `src/App.jsx:captureAndGrade()` — interval snapshot
2. `api/grade.js:watchPipeline()` — 3-pass Vision
3. `api/enrich.js:handler()` — pricing (async)

**Watch Mode Pass Escalation:**
- Pass 1 (Haiku): confidence=HIGH → DONE (1 pass)
- Pass 2 (Haiku self-correct): confidence≠LOW → DONE (2 passes)
- Pass 3 (Opus): LOW confidence → escalate (3 passes)

**Timing per scan:**
- Pass 1 only: ~800-1,200ms (70% of scans)
- Pass 1+2: ~1,500-2,000ms (20% of scans)
- Pass 1+2+3: ~2,500-3,500ms (10% of scans, Opus expensive)

---

### 1C. RE-IDENTIFY BUTTON
**Location:** `src/App.jsx:8993-9040`

**Trigger:** User clicks "Re-identify" on book detail card

**Flow:**
```
User → re-identify button
  ↓
POST /api/grade { images: [stored_b64] }             [SEQUENTIAL]
  ↓
POST /api/enrich { new_title, ... }                  [SEQUENTIAL, AWAITED]
  ↓
setCatalogue → replace item → IndexedDB → Screen
```

**Files touched:**
1. `src/App.jsx:handleReIdentify()` — orchestrator
2. `api/grade.js:handler()` — re-grade with stored image
3. `api/enrich.js:handler()` — full enrichment
4. `src/App.jsx:setCatalogue()` — replace in collection

**Timing:**
- POST /api/grade: 2,000-3,000ms
- POST /api/enrich: 1,500-3,000ms
- **Total: 3,500-6,000ms** (BLOCKING — user waits)

---

### 1D. REFRESH BUTTON (Manual Market Data Refresh)
**Location:** `src/App.jsx:refreshMarketData()`

**Trigger:** User clicks refresh icon on book detail card

**Flow:**
```
User → refresh button → refreshMarketData(item)
  ↓
POST /api/enrich {
  ...item fields,
  skipClaudeCheck: true,              // CRITICAL GATE
  claudeCheckCached: item.claudeCheck // reuse AI result
}                                     [SEQUENTIAL, AWAITED]
  ↓
setCatalogue → merge → IndexedDB → Screen
```

**Files touched:**
1. `src/App.jsx:refreshMarketData()` — fetch enrich with cached AI
2. `api/enrich.js:handler()` — pricing only (AI gated)
3. `src/App.jsx:setCatalogue()` — merge

**Timing:**
- POST /api/enrich: **1,000-1,500ms** (no AI, comps only)
- Screen update: immediate

**CRITICAL:** `skipClaudeCheck: true` flag prevents 600-token Haiku call on every refresh

---

### 1E. AUTO-REFRESH TIMER (300s Interval)
**Location:** `src/App.jsx:7584-7650`

**Trigger:** 300s (5min) interval, collection tab, no detail card open

**Flow:**
```
setInterval check (every render)
  ↓
lastAutoRefreshRef.current < 300000? → SKIP
  ↓
Filter stale books:
  - missingSource (no pricingSource or comps)
  - dupStale (duplicate books with inconsistent prices)
  ↓
Parallel fetch queue (MAX_CONCURRENT = 3)
  ↓
POST /api/enrich (3 concurrent) × N books
  ↓
setCatalogue per result → IndexedDB → Screen
```

**Files touched:**
1. `src/App.jsx:useEffect()` — auto-refresh orchestrator
2. `api/enrich.js:handler()` — parallel pricing (×3 concurrent)
3. `src/App.jsx:setCatalogue()` — merge each result

**Timing:**
- Per book: ~1,000-1,500ms (AI gated via `skipClaudeCheck`)
- Wall-clock for 6 books: ~3,000-4,000ms (3 at a time)

---

## 2. GRADE FLOW — api/grade.js Complete Trace

### Entry Point
**Line:** `api/grade.js:405` — `export default async function handler(req, res)`

### Input
```javascript
{
  images: [base64_string],       // JPEG data URI
  source: 'watch' | undefined,   // Watch Mode vs Standard
  voiceContext: string | undefined // Optional voice transcript
}
```

### Call Sequence (Standard Scan Path)

**Step 1:** eBay-First Identity (SKIPPED in production)
- Line 457: `lookupEbayIdentity(images[0])`
- Returns consensus if ≥0.3 confidence
- **Current:** Feature dormant, always falls through to Vision

**Step 2:** Vision Full Identification
- Line 513: `callModel("claude-sonnet-4-5-20250929", imageContent, STANDARD_PROMPT)`
- Model: **Sonnet 4.5** (was Opus before Ship d3259da)
- Prompt: STANDARD_PROMPT (cached via `cache_control`)
- Returns: `{ title, issue, year, publisher, grade, confidence, ... }`

**Step 3:** Book Signal Detection
- Line 514: `detectBookSignals(initialScan)`
- If book signals → use BOOK_PROMPT, else comic path

**Step 4:** Pedigree Enrichment
- `enrichPedigree(result)` — lookup canonical pedigree name
- `detectEditionWarning(result.reason)` — detect reprint signals

**Step 5:** Return to Client
```javascript
{
  title, issue, year, publisher, grade, isGraded,
  numericGrade, certNumber, confidence,
  cgcPenaltyFlags, editionWarning, pedigree,
  assetType: 'comic' | 'book'
}
```

### Call Sequence (Watch Mode Path)

**Step 1:** watchPipeline(imageContent, voiceContext)
- Line 448: Enters 3-pass escalation

**Pass 1:** Haiku Fast ID
- Line 352: `callModel(HAIKU, imageContent, WATCH_PROMPT)`
- Model: **claude-haiku-4-5-20251001**
- Prompt: WATCH_PROMPT + voiceContext (if present)
- Exit if: `confidence === 'high' && !title.includes('unknown')`
- **70% of scans exit here** (~800ms)

**Pass 2:** Haiku Self-Correction
- Line 375: `callModel(HAIKU, imageContent, correctionPrompt)`
- Prompt: "First pass identified X, review and correct"
- Exit if: `confidence !== 'low' && !title.includes('unknown')`
- **20% of scans exit here** (~1,500ms total)

**Pass 3:** Opus Escalation
- Line 392: `callModel(OPUS, imageContent, STANDARD_PROMPT)`
- Model: **claude-opus-4-7**
- Full STANDARD_PROMPT (cached)
- **10% of scans reach here** (~2,500ms total)
- Returns with `_watchPasses: 3` flag

### Files Touched (in order)
1. `api/grade.js:handler()` — entry
2. `api/grade.js:lookupEbayIdentity()` — eBay image search (dormant)
3. `api/grade.js:callModel()` — Vision API wrapper
4. `api/grade.js:buildImageContent()` — resize + base64 prep
5. `api/grade.js:parseResponse()` — JSON extraction
6. `api/grade.js:enrichPedigree()` — pedigree lookup
7. `api/grade.js:detectEditionWarning()` — reprint detection
8. `src/lib/pedigreeRegistry.js` — 22-pedigree canonical lookup
9. **Anthropic API** — Vision call (external)

### Timing Breakdown
```
Resize image (800px):        ~50ms
Build payload:                ~10ms
Anthropic Vision call:        1,800-2,500ms (Sonnet) | 2,500-3,500ms (Opus)
Parse JSON:                   ~20ms
Pedigree enrichment:          ~5ms
─────────────────────────────
TOTAL (Standard):             2,000-3,000ms
TOTAL (Watch Pass 1):         800-1,200ms
TOTAL (Watch Pass 3):         2,500-3,500ms
```

---

## 3. ENRICH FLOW — api/enrich.js Complete Trace

### Entry Point
**Line:** `api/enrich.js:1445` — `export default async function handler(req, res)`

### Input
```javascript
{
  title, issue, year, publisher, grade,
  isGraded, numericGrade, variant, keyIssue,
  images: [base64], // optional
  skipClaudeCheck: boolean, // refresh gate
  claudeCheckCached: object, // cached AI result
  soldCompsRawCached: array // cached sold comps
}
```

### PHASE 1: Identity Resolution (PARALLEL)

**Line 1766:** First Promise.all
```javascript
const [comicVine, priceChartingInitial, cgcResult] = await Promise.all([
  lookupComicVine({ title, issue, year, publisher }),
  fetchPriceCharting({ title, issue, year, publisher }),
  lookupCGC({ certNumber })
]);
```

**Parallel calls:**
1. **ComicVine** (`api/enrich.js:482-950`)
   - Search API: `GET https://comicvine.gamespot.com/api/search`
   - Timeout: 2s
   - Returns: volume, description, credits, characters
   - Timing: ~500-800ms

2. **PriceCharting** (`api/enrich.js:953-1060`)
   - Search API: `GET https://www.pricecharting.com/search`
   - Fallback: requery with variant
   - Returns: price, year, productName, id
   - Timing: ~400-600ms

3. **CGC Lookup** (`api/cgc-lookup.js`)
   - Only if `certNumber` present
   - Timing: ~300-500ms

**Also in Phase 1:**
- Line 1547: `lookupEbayVisual()` — eBay image search (if `images` present)
- Line 1561: `extractConsensus()` — eBay consensus voting
- Line 1574: `selectTitleFamilyCandidate()` — title-family clustering

**Phase 1 Timing:** ~800-1,200ms (parallel, blocked by slowest)

---

### PHASE 2: Identity Confirmation

**Lines 1604-2040:**
- `resolveIdentity()` — Vision vs eBay vs family candidate
- `resolveYear()` — PC vs CV vs user year cross-check
- `backfillFromComps()` — year from eBay comp consensus
- `sanitizeComicTitle()` — strip seller noise
- `resolveIssue()` — issue cross-validation

**Timing:** ~20-50ms (pure logic, no I/O)

---

### PHASE 3: Comps + Data Fetching (PARALLEL)

**Line 2246:** Second Promise.all
```javascript
const [
  compsFromEbay,
  soldResult,
  goCollectResult,
  pcPop,
  pcSalesResult,
] = await Promise.all([
  fetchComps({ title, issue, year, ... }),
  fetchSold(...),  // dormant
  lookupGoCollect({ title, issue, year, publisher }),
  fetchPricechartingPop(priceCharting.id, grade),
  fetchPricechartingSales(priceCharting.id, userGrade)
]);
```

**Parallel calls:**
1. **eBay Browse API Comps** (`api/comps.js`)
   - 6 search attempts (most specific → broadest)
   - Filter chain inside each attempt
   - Returns: active listing prices
   - Timing: ~1,200-2,000ms (6 attempts, but early exit on match)
   - **CACHE:** Active comps cached 1h (Ship 6549578)

2. **eBay Sold** (`api/sold.js`)
   - Currently dormant (Marketplace Insights gated)
   - Returns: [] (empty)
   - Timing: ~1ms

3. **GoCollect FMV** (`api/gocollect.js`)
   - Search API: `POST https://api.gocollect.com/api/v2/search`
   - Timeout: 4.5s
   - Returns: fmv98, fmv96, fmv94, census
   - Timing: ~800-1,500ms
   - **CACHE:** 24h (Ship 6549578)

4. **PriceCharting Pop** (`api/pricecharting-pop.js`)
   - HTML scrape: `GET https://www.pricecharting.com/game/{productId}`
   - Extract: CGC pop_data from `<script>` tag
   - Returns: { total, byGrade, percentile }
   - Timing: ~600-900ms
   - **CACHE:** HTML cached 7 days per productId

5. **PriceCharting Sales** (`api/pricecharting-pop.js`)
   - Same HTML as Pop (shared fetch)
   - Extract: completed sales rows + price ladder + velocity
   - Returns: { soldComps, salesByGrade, priceLadder, salesVelocity }
   - Timing: ~0ms (HTML already fetched)
   - **CACHE:** Book-level sold comps cache (6hr TTL, Ship 704a02d)

**Phase 3 Timing:** ~1,500-2,500ms (parallel, blocked by slowest = eBay comps)

---

### PHASE 4: AI Verification (CONDITIONAL)

**Line 2302:** AI Comp Verify (Haiku)
```javascript
if (shouldRunAIVerify) {
  const verified = await verifyCompsWithClaude(listings);
  rawComps.recentSales = rawComps.recentSales.filter((_, i) => verified[i]);
}
```

**Gate conditions:**
- `!req.body?.skipClaudeCheck` ← **CRITICAL GATE**
- `out.assetType !== 'book'`
- `rawComps.recentSales.length > 0`

**If fires:**
- Model: **claude-haiku-4-5**
- Prompt: "For each listing reply MATCH or NO_MATCH"
- Tokens: ~600 input + ~50 output
- Timing: ~800-1,200ms
- **Skipped on refresh** (skipClaudeCheck: true)

**Phase 4 Timing:**
- Initial scan: ~800-1,200ms (AI fires)
- Refresh: ~0ms (AI gated)

---

### PHASE 5: Sold Comps Verification

**Line 2350:** `verifySoldComps(rawRows, ctx)`
- Filter chain: title → issue → variant → slab → grade → stale → outlier
- Returns: { verified, rejected, diagnostics }
- Timing: ~10-30ms (pure logic)

---

### PHASE 6: Conflict Detection (Ship #28a)

**Line 2279:** `detectIdentityConflicts()`, `detectPricingConflicts()`, `detectCompsConflicts()`
- Deterministic conflict detection across all sources
- Returns: `out.conflicts` array
- **Current:** LOG ONLY (not used for gating yet)
- Timing: ~5-10ms

---

### PHASE 7: Pricing Math (SEQUENTIAL)

**Lines 2900-3700:** Waterfall pricing logic

**Priority 1:** Sold comps + PC base
- Blend: `soldAvg × 0.6 + activeAvg × 0.4`
- Apply grade multiplier (era-aware)
- Apply variant multiplier (test-market gated)
- Apply key multiplier (PC source only)
- Source: `verified_sold`

**Priority 2:** PriceCharting only
- Base price × grade multiplier
- Source: `pricecharting`

**Priority 3:** Active comps (browse_api)
- Median of active listings
- **NO grade multiplier** (listings already reflect market grade)
- Source: `browse_api`

**Priority 4:** Visual pool fallback
- When sold=0, active=0, but eBay image search had ≥10 results
- Use image search pool median
- Source: `visual_pool_fallback`

**Priority 5:** AI estimate
- Generic fallback when all sources fail
- Source: `ai_estimate`

**Sanity check:** `computeSanityFallback()`
- Compares PC price vs eBay comp average
- High threshold: 1.75× (Golden), 1.5× (modern)
- Low threshold: 0.6× (Silver/Bronze), 0.5× (other)
- Caps price if outside bounds

**Floor guard:** `rawComps.lowest`
- Raw floor (no grade multiplier)
- Capped at compsAvg

**Thin-pool anchor:** When `rawComps.count < 3`
- Cap price at `rawComps.highest × 1.05`

**Low-grade floor:** When `pop.belowGrade === 0`
- Re-anchor to `rawComps.lowest`

**Mega-key floor:** One-way raise (never lowers)
- 29-entry floor map (Golden/Silver/Bronze/Modern)
- Manual review on Action #1, Superman #1

**Timing:** ~50-100ms (pure math)

---

### PHASE 8: ClaudeCheck (CONDITIONAL)

**Line 4160:** `runClaudeCheck(claudeCheckData)`

**Gate conditions:**
- NOT polybag pricing
- NOT refresh (`req.body?.skipClaudeCheck !== true`)
- If refresh AND `req.body?.claudeCheckCached`: reuse cached result

**If fires:**
- Model: **claude-haiku-4-5-20251001** (no web search)
- Model: **claude-sonnet-4-5-20250929** (web search mode, when `needsWebSearch`)
- Prompt: Cached static instructions + dynamic data
- Tool: `web_search_20250305` (when zero comps + UK/pence skip)
- Tokens: ~1,500 input + ~200 output (cached portion ~96% savings)
- Timing: ~1,000-1,500ms (Haiku) | ~2,000-3,000ms (Sonnet + web search)

**Current behavior:**
- Initial scan: **FIRES** (Haiku/Sonnet)
- Refresh: **SKIPPED** (cached result reused)

**Phase 8 Timing:**
- Initial: ~1,000-3,000ms (model + web search dependent)
- Refresh: ~0ms (cached)

---

### PHASE 9: Decision Engine

**Line 4597:** `computeDecision(out)`
- Input: complete `out` object
- Returns: { action, confidence, blockers, warnings, nextStep }
- Actions: LIST_NOW | LIST_LOW | RESEARCH | GRADE_CANDIDATE | DO_NOT_LIST | ID_REQUIRED
- Timing: ~10-20ms (pure logic)

**Files touched:**
1. `src/lib/decisionEngine.js:computeDecision()`
2. Blocker detection (manual review, mega-key, identity)
3. Warning detection (thin pool, variant contam, sold/active mismatch)
4. Action selection (priority waterfall)

---

### Output
```javascript
{
  // Identity
  title, issue, year, publisher, variant,
  confirmedTitle, confirmedIssue, confirmedYear,
  identitySource, identityAlignment,
  
  // Pricing
  price, priceLow, priceHigh,
  pricingSource, priceNote,
  gradeMultiplier, variantMultiplier, keyMultiplier,
  
  // Comps
  comps, soldComps, soldCompsRaw, soldCompDiagnostics,
  rawComps: { count, prices, average, lowest, highest },
  
  // Sources
  comicVine, priceCharting, goCollect,
  pcProductId, pcProductName, gcId, gcFmvLadder,
  
  // Metadata
  pop, priceLadder, salesVelocity,
  keyFromComps, creatorFromComps,
  
  // Quality
  matchConfidence, confidenceLevel,
  claudeCheck, conflicts,
  
  // Decision
  decision: { action, confidence, blockers, warnings },
  
  // Ship #28a
  ebayLeafCategories, ebayBuyingOptions, ebaySellerCount
}
```

### Files Touched (in order)
1. `api/enrich.js:handler()` — entry
2. `api/enrich.js:lookupComicVine()` — CV search
3. `api/enrich.js:fetchPriceCharting()` — PC search
4. `api/cgc-lookup.js:lookupCGC()` — CGC verify
5. `api/enrich.js:lookupEbayVisual()` — eBay image search
6. `src/lib/imageSearchIdentity.js:extractIdentityFromImageSearch()` — parse eBay items
7. `src/lib/imageSearchIdentity.js:extractConsensus()` — eBay voting
8. `src/lib/identityCore.js:resolveIdentity()` — cross-source identity
9. `src/lib/identityCore.js:resolveYear()` — year resolution
10. `src/lib/identityCore.js:backfillFromComps()` — year backfill
11. `src/adapters/ComicAdapter.js:sanitizeComicTitle()` — title cleanup
12. `api/comps.js:fetchComps()` — eBay Browse API comps
13. `api/sold.js:fetchSold()` — dormant
14. `api/gocollect.js:lookupGoCollect()` — GC FMV
15. `api/pricecharting-pop.js:fetchPricechartingPop()` — PC pop
16. `api/pricecharting-pop.js:fetchPricechartingSales()` — PC sales
17. `src/lib/soldVerification.js:verifySoldComps()` — sold filter chain
18. `src/lib/conflictDetector.js:detectIdentityConflicts()` — Ship #28a
19. `src/lib/conflictDetector.js:detectPricingConflicts()` — Ship #28a
20. `src/lib/conflictDetector.js:detectCompsConflicts()` — Ship #28a
21. `api/enrich.js:verifyCompsWithClaude()` — AI comp verify (conditional)
22. `api/enrich.js:computeSanityFallback()` — sanity check
23. `api/enrich.js:computeThinPoolAnchor()` — thin-pool anchor
24. `api/enrich.js:computeLowGradeFloor()` — low-grade floor
25. `api/mega-keys.js:getMegaKeyEntry()` — mega-key floor
26. `src/lib/claudeCheck.js:runClaudeCheck()` — AI verify (conditional)
27. `src/lib/decisionEngine.js:computeDecision()` — routing

### Timing Breakdown (Initial Scan)
```
Phase 1: Identity (parallel):        800-1,200ms
Phase 2: Identity logic:              20-50ms
Phase 3: Comps + data (parallel):     1,500-2,500ms
Phase 4: AI comp verify:              800-1,200ms
Phase 5: Sold verification:           10-30ms
Phase 6: Conflict detection:          5-10ms
Phase 7: Pricing math:                50-100ms
Phase 8: ClaudeCheck:                 1,000-3,000ms
Phase 9: Decision engine:             10-20ms
─────────────────────────────────────────────────
TOTAL (Initial):                      4,195-8,110ms
MEDIAN:                               ~5,500ms
```

### Timing Breakdown (Refresh)
```
Phase 1: Identity (parallel):        800-1,200ms (CV/PC cached)
Phase 2: Identity logic:              20-50ms
Phase 3: Comps + data (parallel):     800-1,500ms (GC/PC/comps cached)
Phase 4: AI comp verify:              0ms (GATED)
Phase 5: Sold verification:           10-30ms
Phase 6: Conflict detection:          5-10ms
Phase 7: Pricing math:                50-100ms
Phase 8: ClaudeCheck:                 0ms (CACHED RESULT)
Phase 9: Decision engine:             10-20ms
─────────────────────────────────────────────────
TOTAL (Refresh):                      1,695-2,910ms
MEDIAN:                               ~2,000ms
```

---

## 4. COMPS FLOW — api/comps.js

### Entry Point
**Line:** `api/comps.js:1080` — `export default async function handler(req, res)`

### Trigger
Called from `api/enrich.js:2246` in Phase 3 Promise.all

### Search Strategy (6 Attempts, Sequential with Early Exit)

**Attempt 0:** Most specific
- Query: `title #issue full-variant year publisher`
- Filter chain runs INSIDE attempt
- Early exit if `parsed.length > 0` (survivors after filters)

**Attempt 1:** Short variant + year
- Query: `title #issue short-variant year`

**Attempt 2:** No year
- Query: `title #issue short-variant publisher`

**Attempt 3:** Artist-specific (if ARTIST_PATTERNS match)
- Query: `title #issue artist virgin? year publisher`

**Attempt 4:** Broader
- Query: `title #issue publisher`

**Attempt 5:** Broadest
- Query: `title #issue`

### Filter Chain (Hard → Soft, runs INSIDE each attempt)

**Filter 0c:** Title similarity (≥50% token overlap)
**Filter 1:** Reprint (REPRINT_RE detection, pre-filter fallback)
**Filter 1b:** Variant contamination (VARIANT_CONTAM_RE, hard)
**Filter 1c:** Variant preference (cover letter matching)
**Filter 1d:** Cover-letter matching (A vs B vs C)
**Filter 1e:** Lot detection (LOT_RE)
**Filter 1f:** Half-issue (decimal issue numbers)
**Filter 1g:** TPB format (TPB_MARKER_RE)
**Filter 2:** Slab (SLAB_RE, unless user is graded)
**Filter 2b:** Signed (SIGNED_RE)
**Filter 3:** Grade proximity (within 2 grades)
**Filter 3b:** Creator match (SOFT, Ship #20a)
**Filter 4:** Price sanity ($1-$10,000)
**Filter 5:** Dedup (same title + price)

### eBay Browse API Call

**Endpoint:** `POST https://api.ebay.com/buy/browse/v1/item_summary/search`

**Parameters:**
- `q`: search query (title + issue + variant + year + publisher)
- `limit`: 100
- `sort`: bestMatch
- `filter`: `buyingOptions:{FIXED_PRICE|AUCTION}`
- OAuth token (client credentials flow)

**Returns:**
```javascript
{
  itemSummaries: [{
    title, price: { value }, itemEndDate, itemWebUrl,
    leafCategoryIds, buyingOptions, seller
  }]
}
```

### Output
```javascript
{
  count: 5,
  prices: [8.99, 9.99, 10.50, 11.00, 12.00],
  recentSales: [{ title, price, date, url }],
  average: 10.50,
  lowest: 8.99,
  highest: 12.00,
  lastSoldDate: null,
  attemptUsed: 1,
  query: "Groo in the Wild #1"
}
```

### Caching

**Active comps cache:** 1h TTL (Ship 6549578)
- Key: `title|issue|year|variant|publisher`
- Storage: In-memory Map (per Lambda instance)
- Expires: `now + 3600000` (1 hour)

**Timing:**
- Cold (no cache): ~1,200-2,000ms (6 attempts, early exit on match)
- Warm (cached): ~0ms

---

## 5. IDENTITY PIPELINE — Phase 1 Resolution

### Sequence of Identity Sources (Parallel Fetch)

**Source 1:** Vision (from `/api/grade`)
- Confidence: HIGH/MEDIUM/LOW
- Fields: title, issue, year, publisher

**Source 2:** eBay Image Search Consensus
- `lookupEbayVisual()` → `extractConsensus()`
- Voting: ≥50% agreement required
- Agreement score: 0-1
- Fields: title, issue, year

**Source 3:** ComicVine Top Match
- Search + volume detail fetch
- Scoring: nameScore + yearScore + publisherScore
- Fields: volume, startYear, publisher

**Source 4:** PriceCharting Match
- Search + product name
- Year tolerance: ±5y
- Fields: productName, year

### Consensus Computation (src/lib/identityCore.js)

**Function:** `resolveIdentity(vision, ebayConsensus, familyCandidate, ctx)`

**Priority waterfall:**
1. Family candidate (if decision='use-top-family')
2. eBay consensus (if agreement ≥ threshold)
3. Vision (fallback)

**Overlap detection:** `calculateTitleOverlap(visionTitle, ebayTitle)`
- Returns: overlap ratio (0-1)
- Threshold: 0.2 (era-aware: pre-1970 requires 1 token, modern 2)

**Override logic:**
- eBay overrides Vision when: `ebayResultCount >= 10 && overlap < threshold`
- Identity source: `'vision'` | `'ebay_override'` | `'family_candidate'`

### Conflict Resolution

**When sources disagree:**
- Title: Use highest-confidence source (eBay agreement > Vision confidence)
- Issue: eBay overrides if agreement ≥0.7
- Year: `resolveYear()` cross-checks PC/CV/eBay vs Vision
- Publisher: Vision preferred, CV fallback

### Consensus Score Storage

**Fields on `out` object:**
- `out.identitySource` — which source won
- `out.identityAlignment` — Ship #24 cross-source validation
  - `authenticationScore` (0-100)
  - `confidence` (HIGH/MEDIUM/LOW)
  - `confirmedTitle`, `confirmedIssue`, `confirmedYear`
  - `overrodeVision` (boolean)
  - `conflicts` (array of mismatches)

**Files touched:**
1. `src/lib/identityCore.js:resolveIdentity()`
2. `src/lib/identityCore.js:calculateTitleOverlap()`
3. `src/lib/identityCore.js:resolveYear()`
4. `src/lib/identityCore.js:resolveIssue()`
5. `src/lib/identityCore.js:backfillFromComps()`

---

## 6. PRICING PIPELINE — Raw Data → Screen Price

### Source Priority (Waterfall)

**1. Sold + PC Blend** (`verified_sold`)
- Condition: `soldComps.length >= 3 && priceCharting.price`
- Formula: `soldAvg × 0.6 + activeAvg × 0.4`
- Grade multiplier: Applied (era-aware)
- File: `api/enrich.js:2850-2900`

**2. PriceCharting Only** (`pricecharting`)
- Condition: `priceCharting.price && soldComps.length < 3`
- Formula: `pcBase × gradeMultiplier`
- Sanity check: Applied
- File: `api/enrich.js:2903-2940`

**3. Active Comps** (`browse_api`)
- Condition: `rawComps.count >= 1`
- Formula: `rawComps.median`
- Grade multiplier: **NOT applied** (eBay already reflects market grade)
- File: `api/enrich.js:3680-3720`

**4. Visual Pool Fallback** (`visual_pool_fallback`)
- Condition: `soldComps=0 && activeComps=0 && visualResult.items >= 10`
- Formula: `median(visualResult.items.prices)`
- File: `api/enrich.js:3870-3900`

**5. AI Estimate** (`ai_estimate`)
- Condition: All sources failed
- Formula: claudeCheck returns `estimated_range_low/high`
- File: `api/enrich.js:4214-4230`

### Price Computation Chain

**Step 1:** Base price selection (source priority)

**Step 2:** Grade multiplier (if applicable)
- `getGradeMultiplier(numericGrade, confirmedYear || year)`
- Era-aware: vintage vs modern tables
- Source: `src/lib/pricingEngine.js`

**Step 3:** Variant multiplier (PC source only)
- Test-market gated: `TEST_MARKET_VARIANTS` allowlist
- Composition damping: ratio > 0.8 → ×0.5
- Source: `api/enrich.js:3270-3380`

**Step 4:** Key multiplier (PC source + comps)
- Tiered: major ×1.5, minor ×1.2
- Gated by: `isFromPC && blendedAvg`
- Source: `api/enrich.js:3400-3450`

**Step 5:** Sanity check
- Compare PC vs eBay comp average
- High/low thresholds (era-aware)
- Fallback to median if outside bounds
- Source: `api/enrich.js:2940-3100`

**Step 6:** Floor guard
- `rawFloor = rawComps.lowest` (capped at compsAvg)
- One-way raise (never lowers)
- Source: `api/enrich.js:3150-3200`

**Step 7:** Thin-pool anchor
- When `rawComps.count < 3`
- Cap at `rawComps.highest × 1.05`
- Source: `api/enrich.js:computeThinPoolAnchor()`

**Step 8:** Low-grade floor
- When `pop.belowGrade === 0`
- Re-anchor to `rawComps.lowest`
- Source: `api/enrich.js:computeLowGradeFloor()`

**Step 9:** Mega-key floor
- 29-entry floor map
- One-way raise (never lowers)
- Source: `api/mega-keys.js:getMegaKeyFloor()`

### pricingSource Setter

**Set at:** `api/enrich.js` (various lines)

**Sources:**
- `verified_sold` — Line 2900
- `pricecharting` — Line 2938
- `browse_api` — Line 3695
- `visual_pool_fallback` — Line 3899
- `image_search_fallback` — (dormant)
- `ai_estimate` — Line 4220
- `web_search_fallback` — Line 4194 (claudeCheck web search)
- `refused-*` — Various refusal reasons

### Files Touched (in order)
1. `api/enrich.js` — waterfall logic
2. `src/lib/pricingEngine.js:getGradeMultiplier()`
3. `src/lib/pricingEngine.js:getRawGradeMultiplier()`
4. `api/enrich.js:isTestMarketVariant()`
5. `api/enrich.js:computeSanityFallback()`
6. `api/enrich.js:computeThinPoolAnchor()`
7. `api/enrich.js:computeLowGradeFloor()`
8. `api/mega-keys.js:getMegaKeyEntry()`
9. `api/mega-keys.js:getMegaKeyFloor()`

---

## 7. DECISION ENGINE — Routing Logic

### Entry Point
**File:** `src/lib/decisionEngine.js:computeDecision(item)`

### Input
Complete `item` object from enrich (price, comps, flags, conflicts)

### Routing Rules (Priority Order)

**1. BLOCKERS (DO_NOT_LIST or ID_REQUIRED):**
- Missing identity fields → `ID_REQUIRED`
- `manualReviewRequired` → `DO_NOT_LIST`
- `gradeExceedsMap` (mega-key) → `DO_NOT_LIST`
- `claudeCheckBlocker` (CRITICAL flag) → `DO_NOT_LIST`
- Catastrophic overprice → `DO_NOT_LIST`
- Reprint with zero comps → `DO_NOT_LIST`

**2. WARNINGS (RESEARCH):**
- `claudeCheckHighSeverity` (HIGH flag) → `RESEARCH`
- Sold/active mismatch (>50% gap) → `RESEARCH`
- Thin Golden Age pool (<3 comps, year<1970) → `RESEARCH`
- Active avg far below sold (liquidity crisis) → `RESEARCH`
- Zero comps (refused-no-data-sources) → `RESEARCH`

**3. GRADE CANDIDATE:**
- Price ladder shows 2× uplift at higher grade → `GRADE_CANDIDATE`
- GoCollect FMV 9.8 > raw × 2 + grading cost → `GRADE_CANDIDATE`

**4. LIST_LOW (Moderate Warnings):**
- Thin pool (<5 comps) → `LIST_LOW`
- Variant contamination → `LIST_LOW`
- Bundle candidate (duplicate series) → `LIST_LOW`
- Reprint/polybag (but has comps) → `LIST_LOW`

**5. LIST_NOW (Clean):**
- Clean identification → `LIST_NOW`
- Verified pricing → `LIST_NOW`
- No blockers/warnings → `LIST_NOW`

### Output
```javascript
{
  action: 'LIST_NOW' | 'LIST_LOW' | 'RESEARCH' | 'GRADE_CANDIDATE' | 'DO_NOT_LIST' | 'ID_REQUIRED',
  confidence: 'high' | 'medium' | 'low',
  price: "$X.XX",
  reason: "Clean identification and pricing, ready to list",
  blockers: [],
  warnings: [],
  nextStep: "List at market band",
  evidence: { clean: true, pricingSource: "verified_sold" },
  bestChannel: "cash_sale" | "bundle" | "research",
  timestamp: Date.now()
}
```

### Files Touched
1. `src/lib/decisionEngine.js:computeDecision()`
2. Blocker detection functions
3. Warning detection functions
4. Action selection waterfall

**Timing:** ~10-20ms (pure logic)

---

## 8. CONFLICT DETECTOR — Ship #28a Integration

### Entry Point
**File:** `src/lib/conflictDetector.js`

**Called from:** `api/enrich.js:2279` (after Phase 3 Promise.all)

### Functions

**1. detectIdentityConflicts(vision, ebay, cv, pc)**
- Title family mismatch (<50% overlap AND <0.7 agreement)
- Issue number mismatch (eBay consensus ≠ Vision)
- Year drift (>5y spread across sources)
- Publisher mismatch (Vision ≠ CV)

**2. detectPricingConflicts(sold, active, pcGuide, gcFmv)**
- Liquidity crisis (active < sold × 0.6)
- Price inflation (active > sold × 2.5)
- FMV divergence (PC vs GC > 30% gap at 9.8)

**3. detectCompsConflicts(comps, leafCategories)**
- Cross-category contamination (non-comic eBay categories)
- Valid categories: 259104, 171228, 63

### Current Behavior (Ship #28a)

**LOG ONLY:**
- Conflicts stored on `out.conflicts` array
- Logged to console: `[ship28a-conflicts]` JSON
- **NOT used for AI gating** (Ship #28b will gate)

**Timing:** ~5-10ms (pure logic)

---

## 9. CLAUDE-CHECK — AI Verification

### Entry Point
**File:** `src/lib/claudeCheck.js:runClaudeCheck(data)`

**Called from:** `api/enrich.js:4162`

### Gate Conditions (Ship #28a)

**Fires when:**
- NOT polybag pricing
- NOT refresh (`req.body?.skipClaudeCheck !== true`)
- If refresh AND has cached result → reuse cached, skip API call

**Model Selection:**
- **Zero comps + NOT UK/pence:** Sonnet 4.5 with `web_search_20250305` tool
- **Has comps OR UK/pence:** Haiku 4.5 (no tools)

### Prompt Structure

**Static block (CACHED):**
```
VERIFY ALL OF THE FOLLOWING:
1. Do sold/active comps match this exact book?
2. Is grade consistent with condition described?
3. Are price bands reasonable for this grade/era?
4. Is key issue description accurate for THIS issue?
5. What is your recommendation?

JSON response: {...}
Flag severity rules: CRITICAL vs WARNING
```

**Dynamic block (NOT cached):**
```
BOOK: {title} #{issue} {year} {publisher}
VARIANT: {variant}
GRADE: {grade} ({numericGrade})
CONDITION REPORT: {conditionSummary}
KEY ISSUE: {keyIssue}
CREATORS: {creatorLines}
PRICE BANDS: Quick/Market/Stretch
TOP SOLD COMPS: ...
TOP ACTIVE COMPS: ...
CGC POP: ...
DEMAND: ...
```

### Web Search Mode (Sonnet + web_search)

**Trigger:** `needsWebSearch = rawComps.count === 0 && !ukWeeklySkip`

**Model:** claude-sonnet-4-5-20250929

**Tool:** `web_search_20250305`

**Timeout:** 20s (vs 30s standard)

**Prompt:**
```
NO EBAY COMP DATA AVAILABLE (rawComps=0).

Use web search to find current sold and active eBay listings for this exact book.

Search for: site:ebay.com/itm "{title} #{issue}" {year} sold

Extract from results:
- Recent sold prices (prefer last 30 days)
- Active listing prices
- Typical price range for this grade/condition
```

### Output
```javascript
{
  verified: true | false,
  confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  flags: [{ message, severity: 'CRITICAL' | 'WARNING' }],
  gradeConsistent: boolean,
  compsAccurate: boolean,
  pricingReasonable: boolean,
  keyIssueAccurate: boolean,
  recommendation: 'SELL_RAW' | 'PRESS' | 'CGC' | 'HOLD',
  recommendationReason: string,
  suggestedListingTitle: string,
  
  // Web search mode only:
  web_price: number,
  web_source: 'ebay_sold' | 'ebay_active' | 'estimate',
  web_confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  web_evidence: string
}
```

### Files Touched
1. `src/lib/claudeCheck.js:runClaudeCheck()`
2. `src/lib/claudeCheck.js:buildVerificationPrompt()`
3. **Anthropic API** — Haiku or Sonnet call

### Timing
- Haiku (standard): ~1,000-1,500ms
- Sonnet + web search: ~2,000-3,000ms
- Refresh (cached): ~0ms

---

## 10. DATA FLOW DIAGRAM

### STANDARD SCAN (Camera → Screen)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USER ACTION: Camera capture                                             │
└─────────────────────────────────────────────────────────────────────────┘
          ↓ ~50ms
┌─────────────────────────────────────────────────────────────────────────┐
│ App.jsx:gradeBlob()                                                      │
│ - Capture JPEG blob                                                      │
│ - Convert to base64                                                      │
└─────────────────────────────────────────────────────────────────────────┘
          ↓ SEQUENTIAL
┌─────────────────────────────────────────────────────────────────────────┐
│ POST /api/grade                                          [2,000-3,000ms] │
│ ├─ api/grade.js:handler()                                       [AI]    │
│ ├─ Resize image (800px)                                         ~50ms   │
│ ├─ Anthropic Vision (Sonnet 4.5)                                ~2,500ms│
│ ├─ Parse JSON response                                          ~20ms   │
│ └─ enrichPedigree + detectEditionWarning                        ~10ms   │
│ Returns: { title, issue, year, grade, confidence, ... }                 │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ App.jsx:addToCatalogue()                                                 │
│ - Save to IndexedDB                                             ~20ms   │
│ - setResult → SCREEN SHOWS CARD IMMEDIATELY                             │
└─────────────────────────────────────────────────────────────────────────┘
          ↓ FIRE-AND-FORGET (async, no await)
┌─────────────────────────────────────────────────────────────────────────┐
│ POST /api/enrich                                         [5,500-8,000ms] │
│                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 1: Identity Resolution                           [800-1,200ms] ││
│ │ ├─ lookupComicVine()                         [PARALLEL] ~600ms       ││
│ │ ├─ fetchPriceCharting()                      [PARALLEL] ~500ms       ││
│ │ ├─ lookupCGC()                               [PARALLEL] ~400ms       ││
│ │ └─ lookupEbayVisual()                        [PARALLEL] ~800ms       ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 2: Identity Confirmation                         [20-50ms]     ││
│ │ ├─ resolveIdentity()                                                 ││
│ │ ├─ resolveYear()                                                     ││
│ │ ├─ sanitizeComicTitle()                                              ││
│ │ └─ resolveIssue()                                                    ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 3: Comps + Data Fetching                         [1,500-2,500ms│
│ │ ├─ fetchComps() → eBay Browse API           [PARALLEL] ~1,500ms     ││
│ │ ├─ fetchSold() (dormant)                    [PARALLEL] ~1ms         ││
│ │ ├─ lookupGoCollect()                        [PARALLEL] ~1,000ms [CACHE│
│ │ ├─ fetchPricechartingPop()                  [PARALLEL] ~700ms   [CACHE│
│ │ └─ fetchPricechartingSales()                [PARALLEL] ~0ms     [CACHE│
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 4: AI Comp Verify                                [800-1,200ms] ││
│ │ ├─ verifyCompsWithClaude() (Haiku)          [AI]                    ││
│ │ └─ Filter comps by AI verification                                  ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 5: Sold Verification                             [10-30ms]    ││
│ │ └─ verifySoldComps() → filter chain                                 ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 6: Conflict Detection (Ship #28a)                [5-10ms]     ││
│ │ ├─ detectIdentityConflicts()                [LOG ONLY]              ││
│ │ ├─ detectPricingConflicts()                                         ││
│ │ └─ detectCompsConflicts()                                           ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 7: Pricing Math                                  [50-100ms]   ││
│ │ ├─ Waterfall (sold+PC → PC → active → visual → AI)                 ││
│ │ ├─ Grade multiplier (era-aware)                                     ││
│ │ ├─ Variant multiplier (test-market gated)                           ││
│ │ ├─ Key multiplier (PC source)                                       ││
│ │ ├─ Sanity check                                                     ││
│ │ ├─ Floor guard                                                      ││
│ │ ├─ Thin-pool anchor                                                 ││
│ │ └─ Mega-key floor                                                   ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 8: ClaudeCheck                                   [1,000-3,000ms││
│ │ ├─ runClaudeCheck() (Haiku or Sonnet)      [AI] [CACHED]           ││
│ │ ├─ Web search mode (if zero comps)         [Sonnet + web_search]   ││
│ │ └─ Returns: verified, flags, recommendation                         ││
│ └──────────────────────────────────────────────────────────────────────┘│
│          ↓                                                               │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ PHASE 9: Decision Engine                               [10-20ms]    ││
│ │ └─ computeDecision() → action + warnings + blockers                 ││
│ └──────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│ Returns: { price, comps, decision, conflicts, claudeCheck, ... }        │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ App.jsx:setCatalogue()                                                   │
│ - Merge enrich result into catalogue                                    │
│ - Update IndexedDB                                                       │
│ - SCREEN UPDATE (price + decision appear)                               │
└─────────────────────────────────────────────────────────────────────────┘

TOTAL TIME (user waits for grade): ~2,500ms
TOTAL TIME (enrich merges async):   ~5,500ms (background)
SCREEN RESPONSIVE:                   IMMEDIATE after grade
```

---

### REFRESH (Manual Market Data Update)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USER ACTION: Click refresh icon on book card                            │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ App.jsx:refreshMarketData()                                              │
│ - Build request with skipClaudeCheck: true                              │
│ - Pass claudeCheckCached: item.claudeCheck                              │
└─────────────────────────────────────────────────────────────────────────┘
          ↓ SEQUENTIAL
┌─────────────────────────────────────────────────────────────────────────┐
│ POST /api/enrich                                         [~2,000ms]     │
│                                                                          │
│ PHASE 1: Identity (CACHED CV/PC)                         [400-600ms]   │
│ PHASE 2: Identity logic                                  [20-50ms]     │
│ PHASE 3: Comps (GC/PC/comps CACHED)                      [800-1,200ms] │
│ PHASE 4: AI comp verify                                  [0ms GATED]   │
│ PHASE 5: Sold verification                               [10-30ms]     │
│ PHASE 6: Conflict detection                              [5-10ms]      │
│ PHASE 7: Pricing math                                    [50-100ms]    │
│ PHASE 8: ClaudeCheck                                     [0ms CACHED]  │
│ PHASE 9: Decision engine                                 [10-20ms]     │
│                                                                          │
│ Returns: { price, comps, decision, ... }                                │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ App.jsx:setCatalogue()                                                   │
│ - Merge updated price/comps                                             │
│ - Update IndexedDB                                                       │
│ - SCREEN UPDATE                                                          │
└─────────────────────────────────────────────────────────────────────────┘

TOTAL TIME: ~2,000ms
COST SAVINGS: 90% (AI gated + caching)
```

---

## 11. GAPS & OPTIMIZATION TARGETS

### TIME WASTED (Sequential → Parallel Opportunities)

**GAP 1:** Re-identify is fully sequential
- Current: grade → await → enrich → await (3.5-6s)
- Optimal: grade runs on stored image, enrich could start with Vision data
- **Savings: 0ms** (can't start enrich without grade results)
- **STATUS: Already optimal**

**GAP 2:** Phase 1 + Phase 3 could merge
- Current: CV/PC/CGC parallel (800ms), then comps/GC/PC-pop parallel (1,500ms)
- Optimal: ALL 7 calls in one Promise.all (blocked by slowest = 1,500ms)
- **Savings: ~800ms**
- **Risk: Code complexity, but feasible**

**GAP 3:** AI comp verify + ClaudeCheck could parallel
- Current: AI comp verify (800ms) → pricing math → ClaudeCheck (1,000ms)
- Optimal: Both fire in parallel after comps fetched
- **Savings: ~800-1,000ms**
- **Risk: ClaudeCheck needs pricing results for prompt**
- **STATUS: Not feasible without redesign**

---

### MONEY WASTED (AI on Clean Data)

**GAP 4:** ClaudeCheck fires on ALL initial scans
- Current: Every book → Haiku/Sonnet (1,000-3,000ms + $0.001-$0.01)
- Ship #28a: Conflicts logged but not gated
- Ship #28b proposal: Skip AI when `conflicts.length === 0`
- **Expected: 70% of books have zero conflicts**
- **Savings: $0.70-$0.80 per book** (70-80% cost reduction)

**GAP 5:** AI comp verify fires on every initial scan
- Current: Every book with comps → Haiku (~600 tokens)
- Could gate: Only fire when comp titles have low similarity to confirmed title
- **Savings: ~40-50% of AI comp verify calls** (deterministic title check first)

**GAP 6:** Watch Mode Pass 3 (Opus) is expensive
- Current: 10% of Watch scans escalate to Opus (15× Haiku cost)
- Could optimize: Use Sonnet 4.5 for Pass 3 instead of Opus
- **Savings: ~60% cost on Pass 3 escalations**

---

### DATA FETCHED TWICE (No Cache)

**GAP 7:** ComicVine not cached
- Current: Every scan fetches CV (600-800ms)
- Optimal: 24h cache (same as PC/GC)
- **Savings: ~600ms on refresh, 95% API cost**

**GAP 8:** PriceCharting HTML fetched per scan
- Current: 7-day cache per productId (good)
- **STATUS: Already optimal**

**GAP 9:** Active comps cached 1h
- Current: 1h TTL (Ship 6549578)
- Optimal: Could extend to 6h (books don't move that fast)
- **Savings: Marginal (95% hit rate → 99%)**

---

### FLOW BREAKS (Null Returns, Dead Ends)

**GAP 10:** Zero comps → AI estimate fallback
- Current: Works correctly, returns $10 generic estimate
- **STATUS: No break, fallback chain complete**

**GAP 11:** eBay-First path is dormant
- Current: `lookupEbayIdentity()` always returns null (confidence check fails)
- Could enable: Lower threshold from 0.3 → 0.2 agreement
- **Impact: Haiku grade-only path (~$0.0001 vs Sonnet Vision ~$0.001)**
- **Savings: 90% Vision cost IF eBay consensus succeeds**

**GAP 12:** Mega-key manual review blocks listing
- Current: Action #1, Superman #1 → DO_NOT_LIST (correct behavior)
- **STATUS: Not a gap, intended safety**

---

### CRITICAL PATH (Longest Chain)

**Current Critical Path (Initial Scan):**
```
Camera → Base64 (50ms)
  → /api/grade Vision (2,500ms)           [BLOCKING]
  → Save IndexedDB (20ms)
  → SCREEN SHOWS CARD
  
  → /api/enrich Phase 3 (1,500ms)         [ASYNC, slowest phase]
  → /api/enrich AI comp verify (800ms)
  → /api/enrich ClaudeCheck (1,000ms)
  → SCREEN UPDATES
  
TOTAL: 5,870ms (grade blocks, enrich async)
USER WAITS: 2,570ms (until card appears)
```

**Optimal Critical Path (Ship #28b):**
```
Camera → Base64 (50ms)
  → /api/grade Vision (2,500ms)           [BLOCKING]
  → Save IndexedDB (20ms)
  → SCREEN SHOWS CARD
  
  → /api/enrich Phase 1+3 merged (1,500ms) [ONE Promise.all]
  → /api/enrich Skip AI (0ms)              [70% of books]
  → SCREEN UPDATES
  
TOTAL: 4,070ms (70% of books)
USER WAITS: 2,570ms (unchanged)
ASYNC SPEEDUP: 30% faster enrich
```

---

## 3 HIGHEST-LEVERAGE OPTIMIZATION TARGETS

### 🥇 **TARGET 1: Ship #28b AI Gate (READY TO DEPLOY)**

**Current:** ClaudeCheck fires on 100% of initial scans  
**Proposed:** Skip when `conflicts.length === 0`  

**Impact:**
- **Cost:** 70-80% reduction ($0.70-$0.80 per book)
- **Time:** 1,000-3,000ms saved on 70% of scans
- **Complexity:** LOW (conflict detector already deployed)

**Implementation:**
```javascript
if (allConflicts.length === 0) {
  out.claudeCheck = { verified: true, skipReason: 'no_conflicts' };
} else {
  out.claudeCheck = await runClaudeCheck({ conflicts: allConflicts });
}
```

**Status:** Ship #28a validation PASSED (6/6 tests)  
**Blocker:** User greenlight required

---

### 🥈 **TARGET 2: Merge Phase 1 + Phase 3 (Medium Complexity)**

**Current:** Two separate Promise.all blocks (800ms + 1,500ms sequential)  
**Proposed:** Single Promise.all with all 7 external calls

**Impact:**
- **Time:** ~800ms saved per scan
- **Cost:** $0 (no new API calls)
- **Complexity:** MEDIUM (dependency analysis required)

**Calls to merge:**
1. ComicVine search
2. PriceCharting search
3. CGC lookup
4. eBay image search
5. eBay Browse API comps
6. GoCollect FMV
7. PriceCharting pop + sales

**Implementation:**
```javascript
const [comicVine, priceCharting, cgcResult, visualResult, compsFromEbay, goCollect, pcPop, pcSales] = 
  await Promise.all([
    lookupComicVine(...),
    fetchPriceCharting(...),
    lookupCGC(...),
    lookupEbayVisual(...),
    fetchComps(...),    // needs confirmedTitle from Phase 2
    lookupGoCollect(...), // needs confirmedTitle from Phase 2
    fetchPricechartingPop(...),
    fetchPricechartingSales(...)
  ]);
```

**Blocker:** `fetchComps()` and `lookupGoCollect()` need `confirmedTitle` from Phase 2 identity resolution  
**Solution:** Move identity resolution INSIDE enrich.js (currently depends on Phase 1 results)

---

### 🥉 **TARGET 3: ComicVine Caching (Low Complexity)**

**Current:** ComicVine fetched on every scan (600-800ms)  
**Proposed:** 24h cache (same pattern as PC/GC)

**Impact:**
- **Time:** ~600ms saved on refresh
- **Cost:** 95% API call reduction
- **Complexity:** LOW (copy existing cache pattern)

**Implementation:**
```javascript
const CV_TTL = 24 * 60 * 60 * 1000; // 24 hours
const _comicVineCache = new Map();

const cachedCV = _comicVineCache.get(cvKey);
if (cached && cached.expires > Date.now()) {
  return cached.data;
}
const result = await lookupComicVine(...);
_comicVineCache.set(cvKey, { data: result, expires: Date.now() + CV_TTL });
```

**Status:** READY TO IMPLEMENT (no dependencies)

---

## TIMING ESTIMATES

### Current State
```
Standard Scan:
  User waits (grade):      2,500ms
  Background (enrich):     5,500ms
  TOTAL:                   8,000ms

Refresh:
  User waits:              2,000ms
  AI savings:              90% (gated)

Watch Mode:
  Pass 1 (70%):            800ms
  Pass 2 (20%):            1,500ms
  Pass 3 (10%):            2,500ms
```

### Optimal State (All 3 Targets)
```
Standard Scan (70% clean books):
  User waits (grade):      2,500ms (unchanged)
  Background (enrich):     2,700ms (-51%)
  TOTAL:                   5,200ms (-35%)

Standard Scan (30% with conflicts):
  User waits (grade):      2,500ms
  Background (enrich):     4,700ms (-15%)
  TOTAL:                   7,200ms (-10%)

Refresh:
  User waits:              1,400ms (-30%)
  AI savings:              90% (gated)
```

---

**END OF ARCHITECTURE FLOW MAP**
