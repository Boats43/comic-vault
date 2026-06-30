# Complete Architecture Audit — 2026-06-30

**Investigation Only. No code changes. GREENLIGHT required before any fix.**

This audit exists because we've seen the SAME class of instability three times:
- Batman #222 price mismatch ($284 vs $149.95)
- Ambush Bug title/decision flicker ($10/DO_NOT_LIST vs $2.79/LIST_LOW)
- Hulk #159 comp pool instability (7 vs 25 survivors, $29.77 vs $25.00)

---

## PART 1 — THE LIFECYCLE CONTRACT

### The Contract We Need

1. **Scan** → identity → comps → price → decision → **SAVE**
2. After save, price/decision/comp-pool is **FROZEN**
3. Collection list = reads frozen data, **zero calls**
4. Card open = reads frozen data, **zero calls**
5. Price changes **ONLY** when user taps Refresh, OR on deliberate staleness check — **NEVER** silently on card open

### Actual Implementation (with file:line citations)

#### A. What Writes Price/Comps/Decision to IndexedDB?

**Three write paths exist:**

1. **Initial Scan Path** (`App.jsx:7991-8047 addToCatalogue`)
   - Creates entry with `marketPending: true`, `price: null`
   - Writes to IndexedDB via `putComic(entry)` (line 8030)
   - **THEN** fires enrich asynchronously (lines 8115-8320)
   - Enrich response OVERWRITES entry via `setCatalogue` updater (lines 8167-8320)
   - Second `putComic(updated)` persists enriched data (line 8289)

2. **Auto-Refresh Path** (`App.jsx:7662-7939`)
   - Triggers when: `tab === "collection"` AND `selectedItem === null` AND 60s cooldown passed
   - Eligibility: `!c.pricingSource || !c.comps` OR duplicate price mismatch
   - Fetches `/api/enrich` for each stale item
   - Writes via `putComic(updated)` (line 7876) AND updates `selectedItem` if card is open (lines 7896-7913)

3. **Manual Refresh Path** (`App.jsx:8923-9118 refreshMarketData`)
   - User taps "Refresh Market Data" button on card detail
   - Fetches `/api/enrich` with abort controller + enrichId collision guard
   - Writes via `putComic(updated)` (line 9113) AND updates `selectedItem` (lines 9114)

**Critical Finding:** All three paths call `putComic()` which persists to IndexedDB (`db.js:61-65`).

#### B. What Reads Them Back on Collection List Render?

**Collection List** (`App.jsx:1846-2556`)
- Reads from `catalogue` state prop (line 1846)
- `catalogue` loaded ONCE on mount via `getAllComics()` (`App.jsx:7645-7660`)
- `db.js:50-59` — reads from IndexedDB, sorts by timestamp descending
- **NO network calls on render** — pure state read

#### C. What Reads Them Back on Card Detail Open?

**Card Open Handler** (`App.jsx:9971-9983`)
```javascript
onOpen={(item) => {
  setSelectedItem(item);  // Line 9974 — JUST sets state, zero network calls
  const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals;  // Line 9976
  if (isStale) {
    refreshMarketData(item).catch(...);  // Line 9979 — TRIGGERS NETWORK CALL
  }
}}
```

**VIOLATION FOUND:** `isStale` check on lines 9976-9982 (collection tab) and 9999-10005 (manage tab).

#### D. Does Card-Open Trigger ANY Fetch/Enrich/Comps Call?

**YES — CONFIRMED LEAK:**

`App.jsx:9976-9982` — Collection tab open handler:
```javascript
const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals;
if (isStale) {
  console.log(`[stale-refresh] auto-refreshing ${item.title} #${item.issue || "?"}`);
  refreshMarketData(item).catch((err) => console.error("[stale-refresh] failed:", err));
}
```

`App.jsx:9999-10005` — Manage tab open handler (identical logic):
```javascript
const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals;
if (isStale) {
  refreshMarketData(item).catch(...);
}
```

**This is the Hulk #159 root cause:**
1. User scans Hulk #159, gets 7 comp survivors, price $29.77
2. Price/comps written to IndexedDB
3. User opens card → `isStale` check fires (missing `priceBands`/`claudeCheck`/`demandSignals`)
4. `refreshMarketData()` re-fetches comps from eBay
5. eBay returns 25 different listings (bestMatch sort is non-deterministic)
6. New price $25.00 overwrites stored $29.77
7. **User sees price change without explicit refresh action**

#### E. Does Auto-Refresh Still Fire on Books with Complete Data?

**YES — Two conditions:**

1. **Incomplete Enrichment** (`App.jsx:7682-7688`):
   ```javascript
   const missingSource = catalogue.filter(
     (c) => !isRecentlyImported(c) && 
            !isUnverifiedMegaKey(c) && 
            !c.inTradePile && 
            (!c.pricingSource || !c.comps)  // ← Triggers on missing fields
   );
   ```

2. **Duplicate Price Mismatch** (`App.jsx:7691-7712`):
   ```javascript
   const dupStale = [];
   Object.values(groups).forEach((group) => {
     if (group.length < 2) return;
     const prices = group.map((c) => parseFloat(String(c.price || "0").replace(/[$,]/g, "")));
     if (!prices.every((p) => p === prices[0])) {  // ← Price variance triggers
       dupStale.push(oldest);
     }
   });
   ```

**Auto-refresh eligibility gate:**
- Only when `tab === "collection"` AND `selectedItem === null` (line 7668-7669)
- 5-minute cooldown via `lastAutoRefreshRef` (line 7670)
- Skips books imported in last 5 minutes (lines 7672-7675)
- Skips unverified mega-keys (lines 7679-7681)

#### F. Is There ANY Code Path Where Opening a Card Re-Runs Comps and Overwrites Stored Price?

**YES — CONFIRMED:** `App.jsx:9976-9982` and `9999-10005` (stale-refresh on card open).

### VERDICT: **LIFECYCLE CONTRACT VIOLATED**

**Expected:** Price frozen after initial scan, changes only on explicit user refresh.

**Actual:** Two silent refresh paths exist:
1. **Card open** → `isStale` check → `refreshMarketData()` → new comps → price overwrite
2. **Auto-refresh** → background fetch on collection tab when no card open → price overwrite

**Batman #222 / Hulk #159 / Ambush Bug instability explained:**
- Card open triggers silent refresh on books missing `priceBands`/`claudeCheck`/`demandSignals`
- eBay `sort=bestMatch` returns non-deterministic result sets between calls
- Filter chain is deterministic GIVEN identical input, but eBay's input varies
- Price recalculated from different comp pool → displayed value changes

---

## PART 2 — COMP POOL DETERMINISM

### The Hulk #159 Bug (7 survivors → 25 survivors)

**Root Cause Analysis:**

1. **Is the eBay query identical between calls?**
   - **YES** — query construction is deterministic (`comps.js:615-724`)
   - Same title/issue/year/publisher → same query string

2. **Does eBay return different result SETS or just different ORDER?**
   - **DIFFERENT SETS** — eBay Browse API uses `sort=bestMatch` (`comps.js:272`)
   - `bestMatch` is a relevance algorithm, not a stable sort
   - Consecutive identical queries can return overlapping but not identical result sets
   - Example: Query A returns items [1,2,3,4,5,6,7], Query B returns items [2,3,4,5,8,9,10,11,12...]

3. **Is there a cache-vs-live mismatch?**
   - **PARTIAL** — Active comps cached 1 hour (`kv-cache.js:110`)
   - Cache key: `ac:${title}|${issue}|${grade}|${year}` (`enrich.js:2291-2303`)
   - If first scan happens, cache populated, then cache expires within card-open session:
     - First view: reads cached 7-comp result
     - Card open after expiry: fetches fresh 25-comp result
   - **This explains time-based variance**

4. **Can two enrich/comps calls overlap and mutate shared array?**
   - **NO** — Each `fetchComps()` call creates new local arrays
   - No shared mutable state between concurrent calls
   - Filter chain operates on `raw.slice()` (`comps.js:763`)

5. **Is the filter chain deterministic given identical input?**
   - **YES** — All filters are pure functions
   - Sort by `endTime` descending (`comps.js:763-765`) — deterministic for same input
   - No `Date.now()`, no random, no non-stable sort
   - **BUT** — different eBay result sets → different filter outputs

6. **When comp pool changes (7→25), should price change?**
   - **Current Behavior:** Price ALWAYS recalculated from current comp pool
   - **Expected Behavior (per lifecycle contract):** First verified result locked, refresh requires explicit user action

7. **Is the comp pool stable for a given book at a given time?**
   - **NO — NON-DETERMINISTIC at eBay API layer**
   - `sort=bestMatch` + `limit=100` returns a relevance-ranked sample, not exhaustive results
   - eBay's relevance algorithm considers:
     - Listing quality score (seller rating, photo count, etc.)
     - Recent activity (views, watchers)
     - Time since listing (fresh listings boosted)
   - **Result:** Same query at different times = different result sets

### VERDICT: **NON-DETERMINISTIC COMP POOLS**

**Root Cause:** eBay Browse API `sort=bestMatch` behavior + 1-hour cache TTL + silent card-open refresh

**Why 7 then 25:**
1. Initial scan: eBay returns set A (100 raw → 7 survivors after filters)
2. Cache expires or card opened before first refresh
3. Second call: eBay returns set B (100 raw → 25 survivors after filters)
4. Sets A and B overlap but are not identical (bestMatch variance)

**This is INTENDED eBay behavior** — relevance ranking, not stable pagination.

---

## PART 3 — THE SCAN ITSELF

### Complete Scan Flow (Photo → Stored Book)

**Step 1: Photo Capture** (`App.jsx:8049-8074`)
- Blob → base64 via `fileToBase64()`
- Compress to 1200px, quality 0.85 via `makeThumbnail()`
- Cost: ~200-500ms client-side

**Step 2: Vision Identification** (`api/grade.js`)
- POST to `/api/grade` with compressed image
- **Watch mode:** Sonnet fast-ID → self-correct → Opus escalation (3-pass pipeline)
- **Standard mode:** Single Opus 4.7 call with `STANDARD_PROMPT`
- Returns: title, issue, publisher, year, grade, keyIssue, variant, creator, certNumber, restoration, defectPenalty, cgcPenaltyFlags, editionWarning
- Cost: **$0.015-0.030** per scan (Opus Vision), ~2-4s
- **Lock mechanism:** `gradeLocked: true` set on HIGH confidence (line 8107)

**Step 3: Add to Catalogue** (`App.jsx:7991-8047`)
- Creates entry with Vision data
- `price: null`, `marketPending: true`
- Writes to IndexedDB via `putComic(entry)`
- Cost: ~50-100ms IndexedDB write

**Step 4: Enrich (Async Fire-and-Forget)** (`App.jsx:8115-8320`)
- POST to `/api/enrich` with Vision identity fields
- Runs in parallel:
  1. ComicVine story/creators lookup
  2. PriceCharting price + pop + sales-history scrape
  3. eBay Browse API active comps (`limit=100`)
  4. eBay sold comps (via PC scrape)
  5. CGC lookup (if certNumber present)
  6. GoCollect FMV lookup (if API key present)
  7. Claude Haiku quality check (initial scan only, cached on refresh)
  8. Decision Engine computation
- Returns: comps, price, priceLow, priceHigh, pricingSource, priceNote, gradeMultiplier, keyIssue, decision, priceBands, demandSignals, etc.
- Cost: **$0.001-0.003** (Haiku check), ~1-3s network time
- **Merge:** `setCatalogue` updater merges enrich response into catalogue entry (lines 8167-8320)
- **Persist:** Second `putComic(updated)` writes enriched data to IndexedDB

**Total Scan Cost:** $0.016-0.033 per book

### What Each Step Accomplishes

| Step | What It Does | Cost | Necessary? |
|------|-------------|------|------------|
| **Vision** | Reads cover → title/issue/publisher/year/grade/keyIssue/variant | $0.015-0.030, 2-4s | ✅ YES — core identity |
| **ComicVine** | Story verification, creator credits | Free, 1-2s | ⚠️ PARTIAL — improves identity confidence but not always available |
| **PriceCharting** | Price ladder, pop, sales velocity | Free (scrape), 2-3s | ✅ YES — primary pricing source |
| **eBay Active** | Current market comps | Free (OAuth), 1-2s | ✅ YES — sanity check + floor guard |
| **eBay Sold** | Historical sold comps (via PC scrape) | Free (bundled), 0s | ✅ YES — blended pricing |
| **CGC Lookup** | Cert verification | Free, 1s | ⚠️ CONDITIONAL — only if cert detected |
| **GoCollect** | CGC FMV at 9.8/9.6/9.4 | Free (API key gated), 1s | ⚠️ CONDITIONAL — submit recommendation only |
| **Claude Check** | Quality gate (price/grade sanity, ID conflicts) | $0.001-0.003, 0.5s | ⚠️ PARTIAL — safety net but gated on initial scan only |
| **Decision Engine** | Action recommendation (LIST_NOW, RESEARCH, etc.) | Free (pure JS), 0s | ✅ YES — actionable guidance |

### Vision Lock Mechanism

**Does Vision fire once and lock?**

**YES — with caveats:**

1. **Initial scan:** Vision runs once, stores result in `item.title`, `item.issue`, etc.
2. **Auto-refresh:** Vision does NOT re-run (`App.jsx:7743` passes `images: [item.images[0]]` but enrich.js does NOT call grade.js again)
3. **Manual refresh:** Vision does NOT re-run (same path as auto-refresh)
4. **Card open stale-refresh:** Vision does NOT re-run

**Lock works correctly — Vision never re-runs after initial scan.**

### Identity Confidence Mechanism

**How confident before it commits?**

`api/grade.js:56-66 parseResponse` — parses Vision JSON
- Returns `confidence: "low" | "medium" | "high"`

`src/lib/identityGate.js:assessIdentityConfidence` — assesses post-Vision
- Checks: title not "unknown"/"not a comic", issue present, year present, publisher present
- Returns `identityConfident: boolean`, `identityMissingFields: string[]`, `identityReasons: string[]`

**Gate at enrich entry** (`api/enrich.js:2063-2112`):
```javascript
const { identityConfident, identityMissingFields, identityReasons } = assessIdentityConfidence({
  title: rawTitle, issue, year, publisher
});
if (identityConfident === false) {
  return res.status(200).json({
    identityConfident: false,
    identityMissingFields,
    identityReasons,
    price: null,  // Refuse to price
    priceLow: null,
    priceHigh: null,
  });
}
```

**Ship #20a.6.4 refuse-to-price gate** — blocks pricing when identity uncertain.

### Where Can Scan Produce WRONG Result That Looks Confident?

**Dangerous Case: False HIGH confidence**

1. **Vision Hallucination** (Pattern: Vision Hallucination class)
   - Vision infers fields from `JSON_SHAPE` context when actual image is unclear
   - Example: "Amazing Spider-Man" defaulted when cover shows generic hero
   - Mitigation: eBay image search cross-check (Ship #20a.6.19) provides consensus validation

2. **Publisher-as-Title Contamination**
   - Bulk import CSV: publisher column value ends up in title field
   - Vision can't detect this (it only sees text, not field semantics)
   - Mitigation: `data.titleWarning = true` flag in bulk import (App.jsx:8475-8520)

3. **Reprint/Facsimile Detection Failure** (Pattern: Star Wars #1 class)
   - Vision sees "35 cent REPRINT edition" in reason text
   - Pricing engine never reads `reason` → applies 1st-print comps
   - Mitigation: Ship #19 `detectEditionWarning()` scans `reason` text, sets `editionWarning.detected` for UI gate

4. **Artist Variant Misidentification**
   - Vision labels cover artist as "variant" when it's actually standard cover
   - Variant multiplier (×1.3-10) incorrectly inflates price
   - Mitigation: Comp-pool composition damping (Ship #13) reduces multiplier when >50% of comps are variants

5. **Mega-Key False Positive**
   - Vision identifies "Action Comics #1" when it's actually a reprint/facsimile
   - Manual review gate (`manualReviewRequired: true`) blocks listing but can't auto-correct
   - Mitigation: Mega-key schema requires strict publisher+year match (`api/mega-keys.js:65-88`)

**WORST CASE:** Vision returns HIGH confidence + wrong title → eBay comps match wrong book → price anchors to unrelated series → user lists $300 book for $30.

**Current Defense:**
- Match confidence tier (LOW/MEDIUM/HIGH) from comp title overlap (`api/comps.js:1373-1423`)
- LOW match blocks auto-refresh price overwrite (App.jsx:7757-7765)
- UI shows warning chip "⚠️ LOW MATCH — Verify before listing"

---

## PART 4 — DECISION ENGINE

### Decision Enum → Trigger Conditions

`src/lib/decisionEngine.js:15-21` defines 7 actions:

1. **ID_REQUIRED** — Identity fields incomplete
   - Triggers: `missing title || missing issue || missing publisher || identityConflict`
   - Blocker: `["Incomplete identity — missing ${fields.join(', ')}"]`

2. **DO_NOT_LIST** — Hard blockers present
   - Triggers:
     - `manualReviewRequired` (mega-key manual review)
     - `gradeExceedsMap` (grade above mega-key schema ceiling)
     - `editionWarning.detected && !editionConfirmed` (reprint/facsimile not acknowledged)
     - `compsExhausted` (AI verify rejected 100% of comps, no verified data)
     - Catastrophic overprice: `listPrice > compsAvg × 3.0`
   - Blockers: array of specific reasons

3. **RESEARCH** — Critical warnings escalated
   - Triggers:
     - `soldAvg / activeAvg > 3.0` (sold market 3× higher than active)
     - `activeAvg / soldAvg > 3.0` (active market 3× higher than sold)
     - Thin Golden Age pool: `era === 'golden' && compsCount < 5`
     - Active avg far below: `activeAvg < recommendedPrice × 0.5`
   - Warnings: array of specific reasons

4. **GRADE_CANDIDATE** — Grading upside detected
   - Triggers: `nextGradeUplift >= 2.0` (price ladder shows 2× jump to next grade)
   - Warnings: `["Grading candidate — ${nextGrade} shows ${uplift}× uplift"]`

5. **LIST_LOW** — Moderate warnings present
   - Triggers:
     - `thinPoolAnchored` (comp count < 3)
     - `variantComposition > 0.5` (>50% variant contamination)
     - `decision === 'BUNDLE'` from earlier logic
     - `reprintFallback || polybagDetected`
   - Warnings: array of reasons

6. **LIST_NOW** — Clean identification and pricing
   - Triggers: No blockers, no critical warnings
   - Confidence: based on match confidence tier + comp count

7. **Action Hierarchy:**
   ```
   ID_REQUIRED (highest priority)
   → DO_NOT_LIST
   → RESEARCH
   → GRADE_CANDIDATE
   → LIST_LOW
   → LIST_NOW (default)
   ```

### Bundle Decision

**Separate from action enum** — computed BEFORE decision engine runs:

`api/enrich.js:4164-4213` — Bundle eligibility:
```javascript
const isBundleCandidate =
  !isMegaKey &&
  !keyIssue &&
  recommendedPrice < 10 &&
  recommendedPrice > 0 &&
  !manualReviewRequired &&
  !gradeExceedsMap &&
  matchConfidence?.tier !== 'LOW';
```

**Bundle threshold sound?** ⚠️ **NEEDS REVIEW:**
- `<$10` cutoff is arbitrary (no data-driven rationale)
- Excludes mega-keys (correct) but includes $9 keys (may be wrong — key issues often bundle poorly)
- No velocity check (slow-moving $8 book may not bundle well)

**UI Display:**
- Collection shows "📦 BUNDLE" badge when `decision.action === 'BUNDLE'` OR `decision.action === 'LIST_LOW'` with bundle warning
- Manage tab "Create Bundle" chip filters `decision.action === 'BUNDLE'`

### Decision Stability

**Is decision stable once computed?**

**NO — can flip on refresh:**

Decision recomputed on EVERY enrich call (`api/enrich.js:4313`):
```javascript
const decision = computeDecision({ ...item, price: recommendedPrice, ... });
```

**Ambush Bug flicker explained:**
1. Initial scan: comps return $10 avg, decision = `DO_NOT_LIST` (some blocker)
2. Card open → stale refresh triggers
3. New comps return $2.79 avg, blocker clears, decision = `LIST_LOW`
4. User sees action change from DO_NOT_LIST → LIST_LOW

**Does decision correctly reflect FROZEN price?**

**NO — decision uses FRESH price from current enrich call:**

`api/enrich.js:4313` — passes `price: recommendedPrice` (just computed, not stored)
- Decision computed from live comp pool, not frozen stored price
- If price changes, decision changes

**Can it desync from displayed price?**

**YES:**

Scenario:
1. Book stored with `price: $30`, `decision: LIST_NOW`
2. Auto-refresh fetches new comps, computes `price: $25`, `decision: LIST_LOW`
3. Quality guard (`chooseBetterPrice`) rejects new price (worse data), keeps `$30`
4. But decision field DOES update to `LIST_LOW`
5. **Result:** Display shows $30 (old) but decision is LIST_LOW (new) — desync

**Data Quality Guard** (`src/lib/dataQualityGuard.js:chooseBetterPrice`):
- Prefers PC over browse_api
- Prefers higher comp counts
- Prefers verified over unverified
- **BUT** — decision recomputed from new enrich data regardless of guard

### VERDICT: **DECISION UNSTABLE + PRICE DESYNC POSSIBLE**

**Root Cause:** Decision recomputed on every enrich, uses fresh price, but quality guard can reject fresh price while keeping fresh decision.

**Ambush Bug / Batman #222 decision flicker confirmed.**

---

## PART 5 — WHAT'S BUILT BUT NOT UNLOCKED

### Dormant Features Inventory

1. **eBay Image Search Identity Override** (`src/lib/imageSearchIdentity.js`)
   - Built: eBay Browse API visual search, consensus extraction, 3+ match override
   - Status: **ACTIVE** but gated — only fires when `images` array passed to enrich
   - Wired: `api/enrich.js:2143-2226`, `App.jsx:7743` (auto-refresh), `8958` (manual refresh), `8143` (scan)
   - Gap: Works on initial scan, NOT wired for bulk import (no images available)
   - Unlock: Pass stored `item.images[0]` on bulk-import enrich

2. **Price Bands Verified Pricing** (`src/lib/priceBands.js`, Ship #20b)
   - Built: Sold-first pricing (sold comps → verified → price bands → enforceFloor)
   - Status: **ACTIVE** — fires on every enrich (`api/enrich.js:2531-2588`)
   - Surfaced: `out.priceBands`, `out.demandSignals` (Ship #21)
   - Gap: UI shows chips but doesn't USE price bands for listing price (still uses `out.price`)
   - Unlock: Decision engine could prefer `priceBands.verified` over `out.price` when available

3. **Demand Signals** (`src/lib/demandSignals.js`, Ship #21)
   - Built: Sales velocity, price trend, volume spike detection
   - Status: **ACTIVE** — fires on every enrich (`api/enrich.js:2578-2584`)
   - Surfaced: `out.demandSignals` (hot/rising/stable/falling/cold)
   - Gap: UI shows "🔥 HOT" badge but decision engine doesn't factor demand into action
   - Unlock: RESEARCH action could escalate on `falling` demand, LIST_NOW confidence boost on `hot`

4. **Creator-Aware Multiplier** (`src/lib/premiumCreators.js`, Ship #16)
   - Built: 80-creator tiered registry, comp extraction, consensus detection
   - Status: **DISPLAY ONLY** — extracts creators, shows chips, NO MULTIPLIER APPLIED
   - Gated: Ship #16b requires explicit greenlight (documented in CLAUDE.md)
   - Surfaced: `keyFromComps`, `creatorFromComps` (consensus), `creatorFromCompsSingleton` (single mentions)
   - Unlock: Apply tiered multiplier (legend ×2.0, premium ×1.5, modern-premium ×1.3, current ×1.2)

5. **Multi-Key Extraction from Comps** (`api/enrich.js:3473-3554`, Ship #12a)
   - Built: 8 key-issue patterns, consensus detection (≥2 matches), singleton tracking
   - Status: **DISPLAY ONLY** — extracts key phrases, shows chips, NO keyIssue OVERRIDE
   - Gated: Ship #12b promotion requires explicit greenlight
   - Surfaced: `keyFromComps`, `keyFromCompsSingleton`
   - Unlock: When consensus exists + Vision keyIssue empty → promote to `keyIssue`, apply key multiplier

6. **Bundle Optimization** (UI built, optimization NOT wired)
   - Built: Manage tab → "Create Bundle" → multi-select → bundlePrice 18% off sum
   - Status: **FUNCTIONAL** — can list bundles on eBay, stored with `bundleId`
   - Gap: No optimization engine (which books bundle best? what's optimal bundle size?)
   - Unlock: ML clustering on (year, publisher, grade, demand) → recommend bundles

7. **Multi-Channel Listing** (eBay only, Whatnot packet built but dormant)
   - Built: `src/lib/marketplacePackets.js` generates Whatnot listing copy
   - Status: **DORMANT** — packet modal UI exists (`App.jsx:2597`) but no API integration
   - Gap: No Whatnot API client, no auth flow
   - Unlock: Whatnot API integration (requires Whatnot seller account + API key)

8. **Buyer Margin Tracking** (Buyer tab functional, portfolio analytics missing)
   - Built: Buyer sessions, budget tracking, net profit calc, BUY/PASS suggestions
   - Status: **ACTIVE** — Watch Mode shows market vs bid profit
   - Gap: No aggregate ROI analysis, no seller/source tracking
   - Unlock: Add `acquisitionSource`, `acquisitionDate` fields → ROI dashboard

9. **Portfolio Analytics** (data exists, UI minimal)
   - Built: Snapshot history (`db.js:80-93`), trend sparkline (`App.jsx:2019-2047`)
   - Status: **ACTIVE** — weekly delta shown
   - Gap: No portfolio composition breakdown (era mix, key-issue %, graded vs raw ratio)
   - Unlock: Metrics dashboard (composition pie charts, risk exposure, liquidity analysis)

10. **Bulk Intake Mode** (CSV import works, photo-less enrichment NOT optimized)
    - Built: CSV import, duplicate detection, bulk enrich with progress bar
    - Status: **ACTIVE** — works but slow (1 book per 1-3s)
    - Gap: No batch API (100 books = 100 sequential enrich calls)
    - Unlock: Batch enrich endpoint (`POST /api/enrich-batch` with array input)

11. **Collection Chat** (`api/chat.js`, Ship #5)
    - Built: Claude streaming chat, collection context injection
    - Status: **ACTIVE** — FloatingSearchBar 🧠 mode
    - Gap: No conversation history, no follow-up context
    - Unlock: Store chat history in IndexedDB, inject last 3 turns into prompt

12. **Pedigree Detection** (`src/lib/pedigreeRegistry.js`, Ship #18)
    - Built: 22 canonical pedigrees, Vision stamp detection, `cgcPenaltyFlags.pedigreeStamp`
    - Status: **ACTIVE** — detects, surfaces chip
    - Gap: No pricing uplift (pedigree books trade 20-50% above standard)
    - Unlock: Apply pedigree multiplier when `cgcPenaltyFlags.pedigreeStamp.detected === true`

13. **Edition Warning Override** (`editionConfirmed` gate, Ship #19)
    - Built: Reprint/facsimile detection, UI acknowledgment flow
    - Status: **ACTIVE** — gates listing until user confirms
    - Gap: No "Actually First Print" override (user can't tell system Vision was wrong)
    - Unlock: "Mark as First Print" button → clears `editionWarning`, allows listing

14. **CGC Submission Profit Calculator** (`App.jsx:3815-3974`, GoCollect FMV)
    - Built: Per-grade FMV scenarios, grading cost ($35) + press ($20), profit verdict
    - Status: **ACTIVE** — shows when `goCollect.fmv98` exists
    - Gap: No submission queue, no grade prediction confidence
    - Unlock: "Add to Submit Queue" → batch CGC submission planner

### Capability vs UI Exposure

**The engine CAN:**
- Price with sold-first verified comps (`priceBands`)
- Detect demand trends (`demandSignals`)
- Identify premium creators (80-creator registry)
- Extract key issues from comp consensus (8 patterns)
- Optimize bundles (data exists: price, velocity, decision)
- Generate multi-channel packets (Whatnot copy ready)
- Track buyer ROI (purchase price stored)
- Analyze portfolio composition (snapshots + metadata)
- Batch enrich (architecture supports, just needs endpoint)
- Chat with collection context (streaming works)
- Detect pedigree stamps (22 canonical)
- Override edition warnings (gate exists, override missing)
- Recommend CGC submissions (FMV + cost calc done)
- Cross-validate identity with image search (consensus extraction works)

**The UI EXPOSES:**
- Basic pricing (PC + eBay comps blend)
- Decision badges (LIST_NOW, RESEARCH, etc.)
- Creator chips (display only, no multiplier)
- Key-issue chips (display only, no promotion)
- Bundle creation (manual, no optimization)
- eBay listing only (Whatnot dormant)
- Buyer net profit (no portfolio ROI)
- Trend sparkline (no composition breakdown)
- CSV import (no batch API)
- Collection chat (no history)
- Pedigree chips (no price uplift)
- Edition warning gate (no first-print override)
- FMV scenarios (no submit queue)
- Image search results (display only, no override)

**Gap Summary:**
- **Pricing:** Engine built, UI shows basic blend only
- **Intelligence:** Detection works, actionability missing
- **Optimization:** Data ready, algorithms not wired
- **Multi-channel:** Packets built, API integration missing
- **Analytics:** Data captured, dashboards minimal

---

## PART 6 — STABILITY GUARANTEE

### Can This System Hold a Price Stable and Trustworthy?

**Bottom-Line Question:** Once a book is scanned and priced, list every way that price could change without explicit user action.

#### 1. Auto-Refresh (60s cooldown, collection tab only)

**Trigger:** `!c.pricingSource || !c.comps` OR duplicate price mismatch

**App.jsx:7662-7939**
```javascript
useEffect(() => {
  if (tab !== "collection") return;
  if (selectedItem) return;  // Only when no card open
  if (Date.now() - lastAutoRefreshRef.current < 300000) return;  // 5-min cooldown
  
  const missingSource = catalogue.filter(c => !c.pricingSource || !c.comps);
  const dupStale = /* duplicate price mismatch */;
  const stale = [...missingSource, ...dupStale];
  
  stale.forEach(item => {
    fetch('/api/enrich', { ...item }).then(enrich => {
      setCatalogue(prev => /* merge enrich, overwrite price */);
      putComic(updated);  // Persist new price
    });
  });
}, [catalogue.length > 0, tab, selectedItem]);
```

**Intended?** YES — designed to heal incomplete data
**Bug?** YES — overly aggressive trigger (fires on books WITH complete data if duplicates exist)

#### 2. Card-Open Stale Refresh

**Trigger:** `!item.priceBands || !item.claudeCheck || !item.demandSignals`

**App.jsx:9976-9982** (collection tab) + **9999-10005** (manage tab)
```javascript
onOpen={(item) => {
  setSelectedItem(item);
  const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals;
  if (isStale) {
    refreshMarketData(item);  // Fetches new comps, overwrites price
  }
}}
```

**Intended?** NO — comment says "Auto-refresh stale records when opened" but user did NOT request refresh
**Bug?** YES — silent price change on card open

#### 3. Quality Guard Rejection with Decision Update

**Trigger:** New enrich data is "worse" than stored data

**App.jsx:7779-7786** (auto-refresh) + **8177-8181** (scan)
```javascript
const priceGuard = idGated || lowMatch
  ? { price: cur.price, /* keep old */ }
  : chooseBetterPrice(enrich, cur);  // May reject new price

const updated = {
  ...cur,
  price: priceGuard.price,  // Old price kept
  decision: enrich.decision,  // New decision applied
};
```

**Intended?** PARTIAL — quality guard is defensive, but decision desync is unintended
**Bug?** YES — `decision` updates even when `price` doesn't

#### 4. Manual Refresh (User-Triggered)

**Trigger:** User taps "Refresh Market Data" button

**App.jsx:8923-9118**
```javascript
const refreshMarketData = useCallback(async (item) => {
  const enrich = await fetch('/api/enrich', { ...item });
  setCatalogue(prev => /* merge enrich, overwrite price */);
  putComic(updated);
}, []);
```

**Intended?** YES — explicit user action
**Bug?** NO — this is correct behavior

#### 5. Duplicate Sync on Auto-Refresh

**Trigger:** Auto-refresh finds multiple copies with same title+issue+year

**App.jsx:7879-7891**
```javascript
return prev.map((x) => {
  if (x.id === item.id) return updated;
  // Sync duplicate copies
  if (x.title === item.title && x.issue === item.issue && x.year === item.year) {
    const synced = { ...x, price: enrich.price, /* ... */ };
    putComic(synced);
    return synced;
  }
  return x;
});
```

**Intended?** YES — keep duplicates in sync
**Bug?** NO — correct behavior (though aggressive)

### WORST CASE: Can Silent Price Change Happen?

**YES — Confirmed Path:**

1. User scans Hulk #159
2. Initial enrich: 7 comps, price $29.77, missing `priceBands`/`claudeCheck`/`demandSignals` (Ship #21 fields added later)
3. Book saved to IndexedDB, user sees $29.77 in collection list
4. User opens card detail
5. `onOpen` handler checks `isStale` → TRUE (missing Ship #21 fields)
6. `refreshMarketData()` fires silently
7. New enrich: 25 comps (eBay bestMatch variance), price $25.00
8. Price overwrites $29.77 → user sees $25.00
9. **User decides to list at $25 based on updated price**
10. **But initial $29.77 was MORE accurate (smaller comp pool, tighter match)**

**This CAN happen today** — exact scenario from user report.

### Is the WORST CASE Blocked?

**NO — Silent price change on card open is UNBLOCKED.**

**Current Guards:**
- Quality guard (`chooseBetterPrice`) can reject new price if worse data
- Low match confidence blocks auto-refresh price overwrite (App.jsx:7762-7765)
- Identity gate (`identityConfident: false`) blocks pricing entirely

**Gaps:**
- Card-open stale-refresh bypasses ALL guards (lines 9976-9982)
- `isStale` check uses Ship #21 fields (`priceBands`, `claudeCheck`, `demandSignals`) not core pricing fields
- Books scanned BEFORE Ship #21 (most of catalogue) trigger stale-refresh on EVERY card open
- eBay `sort=bestMatch` non-determinism → different comp pools → different prices
- User has NO INDICATION that price changed silently (no "Updated X ago" timestamp)

### VERDICT: **PRICE CANNOT BE TRUSTED — STABILITY GUARANTEE VIOLATED**

**Root Cause:** Two silent refresh paths (auto-refresh + card-open stale-refresh) + non-deterministic eBay comp pools + missing "last updated" UI timestamp.

**Batman #222 / Hulk #159 / Ambush Bug confirmed:** Same root cause across all three incidents.

---

## RANKED FIX LIST

### P0 — Data Integrity Blockers (Ship Immediately)

#### P0-A: Remove Card-Open Stale Refresh

**File:** `App.jsx:9976-9982` (collection tab), `9999-10005` (manage tab)

**Current Code:**
```javascript
onOpen={(item) => {
  setSelectedItem(item);
  const isStale = !item.priceBands || !item.claudeCheck || !item.demandSignals;
  if (isStale) {
    refreshMarketData(item);  // SILENT REFRESH
  }
}}
```

**Fix:**
```javascript
onOpen={(item) => {
  setSelectedItem(item);
  // Remove silent refresh — user can tap "Refresh Market Data" button if desired
}}
```

**Impact:** Eliminates Hulk #159 / Batman #222 silent price changes on card open.

**Rationale:** Lifecycle contract demands explicit user action for price updates. Card open is a READ operation, not a WRITE operation.

---

#### P0-B: Fix Auto-Refresh Trigger (Narrow to Core Fields Only)

**File:** `App.jsx:7682-7688`

**Current Code:**
```javascript
const missingSource = catalogue.filter(
  (c) => !c.pricingSource || !c.comps
);
```

**Fix:**
```javascript
const missingSource = catalogue.filter(
  (c) => (!c.pricingSource || !c.comps) &&  // Core pricing fields
         c.marketPending !== true &&          // Don't re-fetch if enrich in progress
         (Date.now() - (c.timestamp || 0) > 86400000)  // Only if >24h old
);
```

**Impact:** Stops auto-refresh from firing on recently-scanned books missing Ship #21 fields.

**Rationale:** `priceBands`/`claudeCheck`/`demandSignals` are intelligence features, not core pricing. Missing them should NOT trigger refresh.

---

#### P0-C: Sync Decision with Quality-Guarded Price

**File:** `App.jsx:7779-7832` (auto-refresh), `8177-8259` (scan)

**Current Code:**
```javascript
const priceGuard = chooseBetterPrice(enrich, cur);
const updated = {
  ...cur,
  price: priceGuard.price,  // May keep old price
  decision: enrich.decision,  // Always uses new decision
};
```

**Fix:**
```javascript
const priceGuard = chooseBetterPrice(enrich, cur);
const priceChanged = priceGuard.price !== cur.price;

// Recompute decision from ACTUAL stored price, not enrich price
const syncedDecision = priceChanged
  ? enrich.decision  // Price changed → use new decision
  : cur.decision;    // Price unchanged → keep old decision

const updated = {
  ...cur,
  price: priceGuard.price,
  decision: syncedDecision,
};
```

**Impact:** Eliminates price/decision desync (Ambush Bug flicker).

**Rationale:** Decision should always reflect displayed price. If quality guard rejects new price, keep old decision too.

---

#### P0-D: Add "Last Updated" Timestamp to UI

**File:** `App.jsx:2557-5500` (CollectionDetail component)

**Current Code:** No update timestamp displayed

**Fix:** Add field to enrich response + UI display
```javascript
// api/enrich.js
res.status(200).json({
  ...out,
  priceUpdatedAt: Date.now(),  // ISO timestamp of this enrich call
});

// App.jsx merge paths (all 5)
updated = {
  ...cur,
  priceUpdatedAt: enrich.priceUpdatedAt || cur.priceUpdatedAt || cur.timestamp,
};

// CollectionDetail UI
<div className="price-header">
  <div className="price">{fmtPrice(item.price)}</div>
  {item.priceUpdatedAt && (
    <div className="muted small">
      Updated {formatTimeAgo(item.priceUpdatedAt)}
    </div>
  )}
</div>
```

**Impact:** User sees when price last changed, knows if data is stale.

**Rationale:** Silent updates are acceptable IF user can see recency. Timestamp provides trust.

---

### P1 — User-Facing Bugs (Ship Next)

#### P1-A: Bundle Threshold Data Validation

**File:** `api/enrich.js:4164-4213`

**Current Code:**
```javascript
const isBundleCandidate = recommendedPrice < 10 && !keyIssue;
```

**Fix:** Add velocity + key-issue exclusion
```javascript
const isBundleCandidate =
  recommendedPrice < 10 &&
  recommendedPrice > 0 &&
  !keyIssue &&
  !isMegaKey &&
  salesVelocity?.tier !== 'cold' &&  // Exclude slow-movers
  matchConfidence?.tier !== 'LOW';   // Exclude uncertain IDs
```

**Impact:** Improves bundle quality (excludes slow $9 books that don't bundle well).

**Rationale:** Bundle optimization should consider liquidity, not just price.

---

#### P1-B: eBay Comp Pool Determinism via Sort Stable

**File:** `api/comps.js:272`

**Current Code:**
```javascript
&limit=100&sort=bestMatch
```

**Fix:** Use `endTimeSoonest` for deterministic results
```javascript
&limit=100&sort=endTimeSoonest  // Chronological, deterministic
```

**Impact:** Same query → same result set (eliminates Hulk #159 7→25 variance).

**Rationale:** `bestMatch` is non-deterministic (relevance algorithm). `endTimeSoonest` is stable (time-ordered).

**Trade-off:** May get less relevant results (e.g., listings from sellers with poor photos).

**Alternative:** Keep `bestMatch` but cache aggressively (24h TTL instead of 1h).

---

#### P1-C: Creator Multiplier Unlock

**File:** `api/enrich.js` (pricing stack, after variant multiplier)

**Current Code:** Creator detection works, multiplier NOT applied (Ship #16 gated)

**Fix:**
```javascript
const creatorConsensus = extractCreatorsFromComps(rawComps.recentSales.map(s => s.title));
if (creatorConsensus.consensus.length > 0) {
  const topCreator = creatorConsensus.consensus[0];  // Highest-tier creator
  const mult = topCreator.tier === 'legend' ? 1.5 :
               topCreator.tier === 'premium' ? 1.3 :
               topCreator.tier === 'modern-premium' ? 1.2 :
               topCreator.tier === 'current' ? 1.1 : 1.0;
  out.price = Math.round(out.price * mult * 100) / 100;
  out.creatorMultiplier = mult;
  out.creatorApplied = topCreator.name;
  out.priceNote = (out.priceNote || '') + ` · ${topCreator.name} ×${mult}`;
}
```

**Impact:** Premium creator books (Kirby, Ditko, McFarlane, etc.) priced correctly.

**Rationale:** Feature fully built (Ship #16), consensus detection works, just needs multiplier application.

---

#### P1-D: Key-Issue Comp Promotion

**File:** `api/enrich.js:3473-3554` (multi-key extraction) + identity resolution

**Current Code:** Detects key consensus, shows chip, does NOT override `keyIssue`

**Fix:**
```javascript
const keyConsensus = extractKeyFromComps(rawComps.recentSales.map(s => s.title));
if (keyConsensus.consensus.length > 0 && !keyIssue) {
  // Vision missed key issue but comps consensus confirms it
  out.keyIssue = keyConsensus.consensus.join(', ');
  out.keyIssueSource = 'comp-consensus';
  // Apply key multiplier (existing logic)
  const keyMult = determineKeyMultiplier(out.keyIssue);
  out.price = Math.round(out.price * keyMult * 100) / 100;
  out.keyMultiplier = keyMult;
}
```

**Impact:** Catches key issues Vision missed (e.g., "first appearance" in comps but Vision returned null).

**Rationale:** Comp consensus is high-confidence signal (≥2 listings agree). Ship #12b gated, ready to unlock.

---

### P2 — Performance & Polish (Ship Later)

#### P2-A: Batch Enrich Endpoint

**File:** New file `api/enrich-batch.js`

**Current:** CSV import = 100 sequential enrich calls (1-3s each = 100-300s total)

**Fix:** Batch endpoint
```javascript
export default async function handler(req, res) {
  const { items } = req.body;  // Array of {title, issue, grade, ...}
  const results = await Promise.all(
    items.map(item => enrichSingle(item))  // Parallel enrich
  );
  res.status(200).json({ results });
}
```

**Impact:** 100 books: 300s → 10s (30× faster).

**Rationale:** Vercel function cap is 12/12, but parallel execution within ONE function is unlimited.

---

#### P2-B: Portfolio Composition Dashboard

**File:** New component `PortfolioDashboard.jsx`

**Current:** Trend sparkline only

**Fix:** Add breakdown charts
- Era mix (Golden/Silver/Bronze/Modern pie chart)
- Key-issue % (keys vs non-keys)
- Graded vs raw ratio
- Top 10 holdings by value
- Liquidity score (% ready to list)

**Impact:** User sees portfolio risk exposure, diversification.

**Rationale:** Data exists, just needs visualization.

---

#### P2-C: Chat History Persistence

**File:** `api/chat.js` + `App.jsx` FloatingSearchBar

**Current:** No conversation history, each query is independent

**Fix:** Store last 5 turns in IndexedDB
```javascript
// db.js
export const getChatHistory = async () => { /* ... */ };
export const appendChatTurn = async (turn) => { /* ... */ };

// api/chat.js
const history = await getChatHistory();
const messages = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...history.slice(-5),  // Last 5 turns
  { role: 'user', content: query },
];
```

**Impact:** Follow-up questions work ("What about Batman?" after "Show me Marvel keys").

**Rationale:** Trivial to implement, massive UX improvement.

---

## SUMMARY

### Lifecycle Contract: **VIOLATED**

**Evidence:**
- Card-open triggers silent `refreshMarketData()` (P0-A)
- Auto-refresh fires on books missing Ship #21 fields (P0-B)
- Price/decision desync possible (P0-C)
- No "last updated" timestamp (P0-D)

### Comp Determinism: **NON-DETERMINISTIC**

**Root Cause:** eBay `sort=bestMatch` + 1-hour cache TTL + silent refresh

**Fix:** P1-B (switch to `endTimeSoonest` sort) OR aggressive caching (24h TTL)

### Scan Effectiveness: **FUNCTIONAL with known gaps**

**Works:**
- Vision identity (title/issue/publisher/year) — HIGH confidence reliable
- PriceCharting pricing — accurate for books with PC match
- eBay comp sanity check — catches outliers

**Risky:**
- Vision hallucination (false HIGH confidence) — mitigated by image search consensus
- Reprint/facsimile detection — mitigated by Ship #19 edition warning gate
- Artist variant misidentification — mitigated by comp composition damping

### Decision Engine: **UNSTABLE + DESYNC-PRONE**

**Issues:**
- Decision recomputed on every enrich, uses fresh price (not stored)
- Quality guard can reject price but keeps decision → desync
- Bundle threshold ($10 cutoff) not data-driven

**Fixes:** P0-C (sync decision with guarded price), P1-A (improve bundle logic)

### Built-but-Dormant Inventory: **14 features ready to unlock**

**High-Value Unlocks:**
1. Price Bands verified pricing (Ship #20b) — UI integration needed
2. Creator multiplier (Ship #16) — just needs greenlight
3. Key-issue comp promotion (Ship #12b) — just needs greenlight
4. Batch enrich endpoint — 30× faster imports
5. Chat history — follow-up questions
6. Portfolio composition dashboard — risk visibility

### Stability Guarantee: **PRICE CANNOT BE TRUSTED**

**Bottom Line:** Silent price changes happen on card open. User has no indication data refreshed.

**Critical Path to Trust:**
1. Remove card-open stale refresh (P0-A)
2. Narrow auto-refresh trigger (P0-B)
3. Sync decision with guarded price (P0-C)
4. Add "last updated" timestamp (P0-D)

**All four P0 fixes required before price is trustworthy for real sell decisions.**

---

## GREENLIGHT PROTOCOL

**DO NOT implement ANY fix without explicit user greenlight.**

Each fix above includes:
- File:line citation
- Current code
- Proposed fix
- Impact statement
- Rationale

User reviews, prioritizes, and greenlights individually.

**Next Step:** User reviews this audit, selects fixes to implement.
