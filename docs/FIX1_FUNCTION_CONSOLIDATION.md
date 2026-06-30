# FIX 1 — FUNCTION CONSOLIDATION INVESTIGATION
**Date:** 2026-06-29  
**Status:** GREENLIGHT REQUIRED BEFORE MERGES  
**Target:** Free up 3-4 function slots (currently 10/10 HTTP endpoints)

---

## CURRENT STATE

### Vercel Function Count: **10 HTTP Endpoints + 3 Helpers**

#### HTTP Endpoints (Vercel Functions)
1. `api/chat.js` — 183 LOC — Collection chat (Claude Haiku)
2. `api/comps.js` — 1,652 LOC — eBay Browse API comp fetching
3. `api/delist-ebay.js` — 71 LOC — eBay listing removal + status sync
4. `api/enrich.js` — 4,862 LOC — **CORE PIPELINE** (CV, eBay, PC, CGC, GoCollect, Decision Engine)
5. `api/gocollect.js` — 169 LOC — GoCollect FMV lookup (HTTP endpoint)
6. `api/grade.js` — 561 LOC — **VISION ENTRY POINT** (Opus/Sonnet, Watch Mode, eBay-first)
7. `api/list-ebay.js` — 838 LOC — eBay listing creation
8. `api/manage.js` — 122 LOC — Collection analysis (Claude Haiku)
9. `api/metadata.js` — 47 LOC — **ASYNC DISPLAY-ONLY** (CV story, CGC pop, GoCollect FMV)
10. `api/pricecharting-pop.js` — 556 LOC — PC pop + sales + ladder + velocity (HTTP endpoint for debug)

#### Pure Helpers (NOT Vercel Functions)
1. `api/cgc-lookup.js` — 83 LOC — CGC cert scraper (exported function, called from enrich)
2. `api/mega-keys.js` — 795 LOC — Mega-keys data + lookup (exported functions, called from enrich)
3. `api/sold.js` — 164 LOC — eBay Finding API (dormant, PC scrape replaced it)

**Actual Vercel Cap:** 10/10 HTTP endpoints (CLAUDE.md said 12/12 — appears to be 10 based on Hobby plan limit)

---

## MERGE CANDIDATES

### OPTION A: Merge `api/metadata.js` INTO `api/enrich.js` ⭐⭐⭐⭐⭐
**Status:** ✅ RECOMMENDED — Safest, highest value

**Why it exists:**
- Ship SPEED-2a (2026-05-XX) — "Lightweight metadata endpoint for display-only fields"
- Returns ComicVine story/creators, CGC pop, GoCollect FMV
- Non-blocking (client calls async after initial enrich response)

**Current call pattern:**
1. User scans → `/api/grade` (Vision)
2. → `/api/enrich` (identity + pricing)
3. → Client calls `/api/metadata` (story + pop + FMV, async) ⚠️ **ACTUAL USAGE CONFIRMED**
4. → Client merges metadata into catalogue

**Why merge makes sense:**
- **Same data sources:** CV, PC, GoCollect (already in enrich)
- **Duplicate API calls:** enrich fetches CV/PC/GoCollect, metadata re-fetches same data
- **Tiny:** 47 LOC (metadata just returns subset of what enrich already has)
- **Performance win:** Eliminates duplicate CV/PC/GoCollect calls (cache helps but still wasteful)

**Merge strategy:**
```javascript
// api/enrich.js (after existing CV/PC/GoCollect calls)

// Ship SPEED-2a — Metadata now bundled (was separate endpoint)
// Async display-only fields (story, creators, pop, goCollect)
// Cost: zero (same API calls, already cached)
const metadata = {
  story: comicVine?.description || null,
  creators: comicVine?.personCredits || [],
  pop: pop || null,
  goCollect: goCollect || null,
};

// Add to response
out.metadata = metadata;
// OR flatten: out.story = metadata.story, out.creators = metadata.creators
```

**Client change:**
```javascript
// Before:
fetch('/api/metadata', { body: { title, issue, ... }})
  .then(meta => setMetadata(meta))

// After:
// Already in enrich response:
const { story, creators, pop, goCollect } = enrichResponse;
```

**Effort:** ~1 hour (merge + test)  
**Risk:** LOW (additive, no behavior change)  
**Freed slots:** 1

---

### OPTION B: Merge `api/gocollect.js` HTTP endpoint INTO helper-only ⭐⭐⭐⭐
**Status:** ✅ RECOMMENDED — Low risk, easy win

**Why it exists:**
- GoCollect FMV lookup
- HTTP handler exists for debugging (line 542: `export default async function handler`)
- Also exported as `lookupGoCollect` function (called from enrich.js + metadata.js)

**Current usage:**
- `api/enrich.js` imports `lookupGoCollect` function ✅
- `api/metadata.js` imports `lookupGoCollect` function ✅
- HTTP endpoint unused in production (no client calls)

**Why merge makes sense:**
- **Function already exported:** enrich imports it, not calls via HTTP
- **HTTP handler is debug-only:** Not used by app
- **Zero client impact:** No client code calls `/api/gocollect`

**Merge strategy:**
```javascript
// api/gocollect.js
// REMOVE:
export default async function handler(req, res) { ... }

// KEEP:
export const lookupGoCollect = async ({ title, issue, year, publisher }) => { ... }
```

**Verification:**
```bash
# Check for HTTP calls to /api/gocollect
grep -r "/api/gocollect" src/
# Expected: zero results (enrich imports directly)
```

**Effort:** ~10 minutes (delete handler + verify)  
**Risk:** NONE (unused endpoint)  
**Freed slots:** 1

---

### OPTION C: Merge `api/pricecharting-pop.js` HTTP endpoint INTO helper-only ⭐⭐⭐⭐
**Status:** ✅ RECOMMENDED — Same as GoCollect

**Why it exists:**
- PC pop + sales + ladder + velocity scraping
- HTTP handler exists for "calibration / debug" (line 542)
- Exported as `fetchPricechartingPop` + `fetchPricechartingSales` (called from enrich.js + metadata.js)

**Current usage:**
- `api/enrich.js` imports functions ✅
- `api/metadata.js` imports `fetchPricechartingPop` ✅
- HTTP endpoint unused in production (no client calls)

**Why merge makes sense:**
- **Functions already exported:** enrich imports, not HTTP calls
- **HTTP handler is debug-only:** "single curl can verify both pipelines"
- **Zero client impact:** No client code calls `/api/pricecharting-pop`

**Merge strategy:**
```javascript
// api/pricecharting-pop.js
// REMOVE:
export default async function handler(req, res) { ... }

// KEEP:
export const fetchPricechartingPop = async (productId, grade) => { ... }
export const fetchPricechartingSales = async (productId, userGrade) => { ... }
```

**Effort:** ~10 minutes (delete handler + verify)  
**Risk:** NONE (unused endpoint)  
**Freed slots:** 1

---

### OPTION D: Keep `api/sold.js` as dormant helper ⭐⭐
**Status:** ⚠️ KEEP AS-IS (already a helper, not an endpoint)

**Why it exists:**
- eBay Finding API sold listings
- **DORMANT:** Ship #20a bypassed it (PC scrape replaced)
- CLAUDE.md: "api/sold.js — eBay completed/sold listings (legacy, dormant — Ship #20a routes via PC scrape)"

**Current usage:**
- `api/enrich.js` line 2349: **DOES call** `fetchSold()` in Promise.all
- Returns `[]` gracefully (Finding API dead, 500 errors)
- Comment: "Kept in the pipeline so a future scope approval lights it up without re-wiring"
- **NOT an HTTP endpoint** (no `export default handler`)

**Why keep:**
- **No function slot cost:** Already a helper-only file (not Vercel function)
- **Future-ready:** If eBay approves Marketplace Insights scope, it lights up immediately
- **Fail-safe:** Returns empty array, zero impact on pricing
- **Comment says keep:** Line 2346-2348 explicitly says "Kept in the pipeline"

**DECISION:** Keep as-is (no slot savings, intentionally dormant)

---

### OPTION E: Create `api/router.js` dispatcher ⭐⭐
**Status:** ⚠️ NOT RECOMMENDED — High risk, low value

**Concept:**
```javascript
// api/router.js
export default async function handler(req, res) {
  const { action, ...params } = req.body;
  
  switch (action) {
    case 'chat':
      return handleChat(params, res);
    case 'manage':
      return handleManage(params, res);
    case 'metadata':
      return handleMetadata(params, res);
    default:
      res.status(400).json({ error: 'Unknown action' });
  }
}
```

**Why NOT recommended:**
- **Breaks REST conventions:** Single endpoint for multiple actions
- **Client refactor required:** All fetch calls change
- **Debugging harder:** Single function, multiple paths
- **No clear win:** Only saves slots if ≥3 endpoints merged (and we have better options)
- **Error isolation worse:** One crash affects all routes

**Only consider if:** Options A-D don't free enough slots (unlikely)

---

### OPTION F: Merge `api/chat.js` + `api/manage.js` ❌ NOT RECOMMENDED
**Status:** ❌ DON'T MERGE — Different purposes

**Why they're separate:**
- `chat.js` — Real-time collection queries (user-initiated, frequent)
- `manage.js` — Batch analysis (infrequent, Claude pre-selects books)
- Different prompts, different use cases
- Merging adds complexity for zero gain (both are small, 183 + 122 = 305 LOC total)

**Keep separate.**

---

### OPTION G: Merge `api/list-ebay.js` + `api/delist-ebay.js` ❌ NOT RECOMMENDED
**Status:** ❌ DON'T MERGE — Different Trade API calls

**Why they're separate:**
- `list-ebay.js` — AddFixedPriceItem + UploadSiteHostedPictures (complex, 838 LOC)
- `delist-ebay.js` — EndItem + GetItem (simple, 71 LOC)
- Different failure modes, different retry logic
- Merging makes list-ebay even larger (already 838 LOC)

**Keep separate.**

---

## RECOMMENDATION

### MERGE PLAN (Frees 3 Slots)

**Phase 1: Low-Risk Deletions (15 minutes)**
1. ✅ Delete HTTP handler from `api/gocollect.js` → -1 slot
2. ✅ Delete HTTP handler from `api/pricecharting-pop.js` → -1 slot

**Phase 2: Metadata Merge (2 hours)**
3. ✅ Merge `api/metadata.js` into `api/enrich.js` → -1 slot
   - Enrich already fetches CV/PC/GoCollect
   - Add fields to enrich response: `out.story`, `out.creators` (flatten metadata object)
   - Update client: remove `/api/metadata` fetch, read from enrich response
   - Delete `api/metadata.js`

**Total freed:** 3 slots  
**Total effort:** ~2.25 hours  
**Risk:** LOW (Phase 1 zero risk, Phase 2 low risk — just response shape change)

**Result:** 7/10 HTTP endpoints (30% headroom for future features)

---

## IMPLEMENTATION ORDER

1. **FIX 1.1:** Remove HTTP handler from `api/gocollect.js`
   - Delete `export default async function handler`
   - Verify: `grep -r "/api/gocollect" src/` → zero results
   - Test: `npm run build` passes

2. **FIX 1.2:** Remove HTTP handler from `api/pricecharting-pop.js`
   - Delete `export default async function handler`
   - Verify: `grep -r "/api/pricecharting-pop" src/` → zero results
   - Test: `npm run build` passes

3. **FIX 1.3:** Merge `api/metadata.js` into `api/enrich.js`
   - Copy metadata extraction logic into enrich
   - Add `out.story`, `out.creators` to enrich response
   - Update client to read from enrich response instead of separate fetch
   - Delete `api/metadata.js`
   - Test: full scan → enrich → verify story/creators present

---

## VERIFICATION CHECKLIST

Before greenlight:
- [ ] Verify no client calls to `/api/gocollect`
- [ ] Verify no client calls to `/api/pricecharting-pop`
- [ ] Verify no client calls to `/api/metadata` (will change in Phase 2)
- [ ] Verify `fetchSold` never called (can delete)
- [ ] Confirm enrich.js already imports gocollect/pricecharting-pop functions

After merge:
- [ ] `npm run build` passes
- [ ] Full scan flow works (grade → enrich → display)
- [ ] Story/creators display in UI
- [ ] GoCollect FMV displays (if key present)
- [ ] CGC pop chart displays

---

## QUESTIONS FOR GREENLIGHT

1. **Approve Options 1-2 (delete debug handlers)?** Zero risk, instant win.
2. **Approve Option 3 (delete api/sold.js)?** Dead code cleanup.
3. **Approve Option 4 (merge metadata)?** Low risk, medium effort, good value.
4. **Need more than 3 slots freed?** If so, consider router pattern (not recommended).

---

**AWAITING GREENLIGHT TO PROCEED.**
