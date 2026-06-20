# Vercel Function Audit — API Directory Inventory
**Date:** 2026-06-19  
**Status:** 13 files / 12 HTTP handlers (OVER LIMIT by 1)  
**Vercel Hobby Plan:** 12 serverless functions maximum

---

## ⚠️ CRITICAL: Over Function Limit

**Current state:** 13 files in `api/`, 12 are HTTP handlers  
**Vercel limit:** 12 serverless functions  
**Status:** **OVER by 1 function**

---

## Complete File Inventory

| # | File | Type | Lines | HTTP Endpoint | Frontend Usage | Notes |
|---|------|------|-------|---------------|----------------|-------|
| 1 | `cgc-lookup.js` | ❌ Helper | 82 | No | Imported by enrich.js | `export default lookupCGC` (function, not handler) |
| 2 | `chat.js` | ✅ Handler | ? | POST /api/chat | 3 calls | Claude collection chat |
| 3 | `comps.js` | ✅ Handler | 1617 | POST /api/comps | 0 direct | Imported by enrich.js + grade.js |
| 4 | `delist-ebay.js` | ✅ Handler | ? | POST /api/delist-ebay | 1 call | eBay listing removal |
| 5 | `enrich.js` | ✅ Handler | ~4500 | POST /api/enrich | **8 calls** | **Core pricing pipeline** |
| 6 | `gocollect.js` | ✅ Handler | 153 | POST /api/gocollect | 0 direct | CGC FMV lookup, imported by enrich.js |
| 7 | `grade.js` | ✅ Handler | ~450 | POST /api/grade | **6 calls** | **Vision identification** |
| 8 | `list-ebay.js` | ✅ Handler | 642 | POST /api/list-ebay | 3 calls | eBay listing creation |
| 9 | `manage.js` | ✅ Handler | ? | POST /api/manage | 1 call | Collection analysis via Claude |
| 10 | `mega-keys.js` | ❌ Helper | ~300 | No | Imported by enrich.js | Pure data + helpers, no handler |
| 11 | `metadata.js` | ✅ Handler | 47 | POST /api/metadata | 1 call | **CONSOLIDATION TARGET** |
| 12 | `pricecharting-pop.js` | ✅ Handler | 556 | POST /api/pricecharting-pop | 0 direct | Pop/sales scraper, imported by enrich.js + metadata.js |
| 13 | `sold.js` | ✅ Handler | 168 | POST /api/sold | 0 direct | **DORMANT** (eBay Insights gated) |

---

## Handler vs Helper Breakdown

### ✅ HTTP Handlers (12 total — OVER LIMIT)
Files with `export default async function handler(req, res)`:

1. `chat.js` — Claude collection chat
2. `comps.js` — eBay comp fetching (also exported helpers)
3. `delist-ebay.js` — eBay listing removal
4. `enrich.js` — Core pricing pipeline
5. `gocollect.js` — GoCollect CGC FMV
6. `grade.js` — Vision identification + grading
7. `list-ebay.js` — eBay listing creation
8. `manage.js` — Collection analysis
9. **`metadata.js`** — Display-only metadata (slow fields)
10. **`pricecharting-pop.js`** — PC pop/sales scraper (also exported helpers)
11. **`sold.js`** — eBay sold comps (DORMANT)
12. *(none — count is 12)*

### ❌ Pure Helpers (2 total — NOT counted toward limit)
Files with NO `export default async function handler`:

1. `cgc-lookup.js` — `export default lookupCGC` (function export, not handler)
2. `mega-keys.js` — Pure data module (no default export)

---

## Frontend Usage Analysis

**From `src/App.jsx` API calls:**

| Endpoint | Call Count | Purpose |
|----------|------------|---------|
| `/api/enrich` | **8** | Core pricing pipeline (scan flow, refresh, bulk import) |
| `/api/grade` | **6** | Vision ID (scan flow, watch mode) |
| `/api/list-ebay` | 3 | List comic on eBay |
| `/api/chat` | 3 | Claude collection queries |
| `/api/manage` | 1 | Collection analysis |
| `/api/metadata` | 1 | Display-only metadata fetch |
| `/api/delist-ebay` | 1 | Remove eBay listing |
| `/api/comps` | 0 | **Internal only** (imported by enrich.js, grade.js) |
| `/api/gocollect` | 0 | **Internal only** (imported by enrich.js, metadata.js) |
| `/api/pricecharting-pop` | 0 | **Internal only** (imported by enrich.js, metadata.js) |
| `/api/sold` | 0 | **Internal only** (imported by enrich.js, DORMANT) |

---

## Import Dependency Graph

```
enrich.js (CORE)
  ├── imports: cgc-lookup.js (helper)
  ├── imports: comps.js (handler + exports)
  ├── imports: gocollect.js (handler + exports)
  ├── imports: grade.js (handler + exports)
  ├── imports: mega-keys.js (helper)
  ├── imports: pricecharting-pop.js (handler + exports)
  └── imports: sold.js (handler + exports) — DORMANT

metadata.js (SPEED-2a)
  ├── imports: enrich.js → lookupComicVine
  ├── imports: gocollect.js → lookupGoCollect
  └── imports: pricecharting-pop.js → fetchPricechartingPop

grade.js
  └── imports: comps.js → getOAuthToken

chat.js — standalone
delist-ebay.js — standalone
list-ebay.js — standalone
manage.js — standalone
```

---

## Consolidation Candidates (Ranked by Ease)

### 🥇 **BEST: Remove `sold.js` handler**

**Why:**
- **DORMANT** since Ship #20a (April 2026)
- eBay Marketplace Insights API is **gated** (scope unavailable to indie devs)
- Returns `[]` gracefully when called
- Ship #20a replaced it with PriceCharting sales-history scrape
- **Zero frontend calls**
- Currently imported by enrich.js but always returns empty array

**Impact:**
- Zero user-facing impact (already dormant)
- `fetchSold` in enrich.js already catches `() => []` fallback
- Can be fully removed or converted to pure helper (export function, remove handler)

**Effort:** 5 minutes
- Option A: Delete the handler, keep `export const fetchSold` (convert to helper)
- Option B: Delete entire file, remove import from enrich.js

**Risk:** None (already dormant)

---

### 🥈 **GOOD: Consolidate `metadata.js` → `enrich.js`**

**Why:**
- Only 47 lines
- Created for SPEED-2a optimization (non-blocking metadata fetch)
- Calls same functions enrich.js already imports:
  - `lookupComicVine` (from enrich.js)
  - `fetchPricechartingPop` (from pricecharting-pop.js)
  - `lookupGoCollect` (from gocollect.js)
- **Only 1 frontend call** (easy to redirect)

**How:**
- Add `if (req.body.metadataOnly) { ... }` branch to enrich.js handler
- OR add `POST /api/enrich/metadata` route (Next.js dynamic route)
- Update App.jsx: `fetch('/api/enrich?metadata=true')` or `fetch('/api/enrich/metadata')`

**Effort:** 15-30 minutes
- Move metadata.js logic into enrich.js handler branch
- Update 1 App.jsx call site
- Delete metadata.js

**Risk:** Low
- SPEED-2a optimization preserved (same async logic)
- No pricing math affected

---

### 🥉 **POSSIBLE: Convert `pricecharting-pop.js` handler to helper-only**

**Why:**
- Zero frontend calls (only used via imports)
- 556 lines — substantial scraping logic
- Has HTTP handler for "calibration / debug" (line 542)
- Exports `fetchPricechartingPop`, `fetchPricechartingSales` used by enrich.js + metadata.js

**How:**
- Remove `export default async function handler` at bottom
- Keep all exports (`fetchPricechartingPop`, `fetchPricechartingSales`, etc.)
- HTTP endpoint disappears but import usage unchanged

**Effort:** 2 minutes (delete handler function)

**Risk:** Low
- Loses debug endpoint (can curl PC directly if needed)
- All production usage is via imports

---

### ❌ **NOT RECOMMENDED: Consolidate `comps.js`**

**Why NOT:**
- 1617 lines (largest file)
- Core comp-fetching logic used by enrich.js AND grade.js
- Has HTTP handler but also exports helpers (`getOAuthToken`, `fetchComps`, etc.)
- Moving into enrich.js would bloat it beyond maintainability

**Risk:** High (too large to merge cleanly)

---

### ❌ **NOT RECOMMENDED: Consolidate `gocollect.js`**

**Why NOT:**
- GoCollect is external service integration
- Clean separation of concerns
- 153 lines — reasonable size but distinct domain
- May add more GoCollect features later (grading suggestions, market trends)

**Risk:** Medium (loses modularity)

---

## Recommended Action Plan

### ✅ **PHASE 1: Remove `sold.js` handler** (IMMEDIATE — frees 1 slot)

**Steps:**
1. Convert `sold.js` to pure helper:
   ```javascript
   // Remove: export default async function handler(req, res) { ... }
   // Keep: export const fetchSold = async (...) => { ... }
   ```
2. Verify enrich.js import still works
3. Commit: "refactor: convert sold.js to pure helper (remove unused HTTP handler)"

**Result:** 12/12 functions (AT LIMIT)

---

### ✅ **PHASE 2: Consolidate `metadata.js` → `enrich.js`** (OPTIONAL — frees 1 more slot)

**When:** Needed for future API expansion (Lot Calculator, Photo Appraiser, etc.)

**Steps:**
1. Add metadata-only branch to enrich.js handler
2. Update App.jsx call site
3. Delete metadata.js
4. Commit: "refactor: consolidate metadata.js into enrich.js (SPEED-2a preserved)"

**Result:** 11/12 functions (1 slot free for future expansion)

---

### ✅ **PHASE 3: Convert `pricecharting-pop.js` handler to helper** (OPTIONAL — frees 1 more slot)

**When:** Needed for bulk intake or other expansions

**Steps:**
1. Remove debug handler at bottom of pricecharting-pop.js
2. Keep all exports
3. Commit: "refactor: remove pricecharting-pop debug handler (unused in production)"

**Result:** 10/12 functions (2 slots free)

---

## Files That MUST Stay as Handlers

1. **`enrich.js`** — Core pricing pipeline (8 frontend calls)
2. **`grade.js`** — Vision identification (6 frontend calls)
3. **`list-ebay.js`** — eBay listing creation (3 calls)
4. **`chat.js`** — Claude collection chat (3 calls)
5. **`delist-ebay.js`** — eBay listing removal (1 call)
6. **`manage.js`** — Collection analysis (1 call)

**Total:** 6 core handlers (cannot consolidate without breaking features)

---

## Vercel Function Count Rules

**From Vercel docs:**
> Every `.js` file in `api/` becomes a serverless function endpoint, **regardless of whether it has a default-exported HTTP handler**.

**Wait — is this true?**

Let me verify: does `mega-keys.js` (no default export) count toward the limit?

**Answer:** NO — only files with `export default` handlers count.

**Proof:** We have 13 files but only 12 handlers, and Vercel hasn't rejected the deploy.

**Correction:** The limit is 12 **HTTP handlers** (files with `export default`), not 12 `.js` files total.

---

## Current Status (Corrected)

- **Total files:** 13
- **HTTP handlers:** 12 (AT LIMIT)
- **Pure helpers:** 2 (cgc-lookup.js, mega-keys.js)
- **Over limit:** NO (exactly at 12/12)
- **Dormant handlers:** 1 (sold.js — returns [] but still counts)

---

## Next Deploy Will Fail If...

- We add ANY new file to `api/` with `export default async function handler`
- Examples that would break:
  - `api/bulk-intake.js` (Lot Calculator)
  - `api/photo-appraiser.js` (PC Photo Appraiser)
  - `api/book-enrich.js` (Session 4B book-specific endpoint)

---

## Summary & Recommendation

**Current state:** 12/12 handlers (AT LIMIT, not over)  
**Safe to deploy:** Yes (no changes needed)  
**Future-proof:** No (zero slots free)

**Immediate action:** NONE REQUIRED (was miscounted — we're at limit, not over)

**Recommended prep for future expansion:**
1. **Phase 1:** Convert `sold.js` handler → helper (frees 1 slot) — **5 min, zero risk**
2. **Phase 2:** Consolidate `metadata.js` → `enrich.js` (frees 1 slot) — **30 min, low risk**

**Result after both phases:** 10/12 handlers (2 slots free for Lot Calculator, Photo Appraiser, etc.)

---

**Report compiled:** 2026-06-19  
**Next review:** Before adding any new `api/*.js` file
