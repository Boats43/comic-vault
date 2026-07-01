# /api/enrich Call Site Audit — skipImageSearch Flag Review

**Date:** 2026-07-01
**Context:** Batman #222 refresh bug revealed missing `skipImageSearch: true` on refreshMarketData call, causing identity re-resolution and comp data loss.

**Question:** Are there OTHER call sites with the same bug?

---

## AUDIT RESULTS: 11 Call Sites Found

| Line | Context | Purpose | Has Image? | skipImageSearch? | CORRECT? | Notes |
|------|---------|---------|------------|------------------|----------|-------|
| **7478** | Watch Mode (Buyer tab) | Live camera enrichment | ✅ YES (live capture) | ❌ NO | ✅ **CORRECT** | Initial scan — SHOULD run full identity pipeline |
| **7710** | App warmup | Serverless warmup ping | ❌ NO | ❌ NO | ✅ **CORRECT** | Warmup payload, no real data |
| **7798** | Auto-refresh queue | Background price updates | ✅ YES (stored) | ❌ NO | 🔴 **BUG** | **SAME BUG as refreshMarketData** |
| **8220** | Scan → Enrich | Initial scan enrichment | ✅ YES (fresh scan) | ❌ NO | ✅ **CORRECT** | Initial scan — SHOULD run full identity pipeline |
| **8461** | Barcode scan | Barcode-based lookup | ❌ NO | ❌ NO | ✅ **CORRECT** | No image, barcode identity path |
| **8586** | Bulk import enrich | Bulk scan enrichment | ✅ YES (fresh scans) | ❌ NO | ✅ **CORRECT** | Initial scans — SHOULD run full identity pipeline |
| **9022** | refreshMarketData | Manual refresh button | ✅ YES (stored) | ✅ **YES** | ✅ **FIXED** | Commit 123ea95 added skipImageSearch |
| **9247** | reIdentifyBook | Re-identify button | ✅ YES (stored) | ❌ NO | ✅ **CORRECT** | Explicit re-ID — SHOULD re-run identity on purpose |
| **9751** | Manual entry | User-typed identity | ❌ NO | ✅ YES | ✅ **CORRECT** | Manual identity, no image, skip enforced |
| **9911** | Duplicate "Save Another Copy" | Enrich duplicate entry | ✅ YES (from result) | ❌ NO | ✅ **CORRECT** | Fresh scan data, initial enrichment |
| **7478** | (duplicate entry) | | | | | |

---

## CRITICAL BUG FOUND: Auto-Refresh Queue (Line 7798)

**Status:** 🔴 **ACTIVE BUG** — Same root cause as Batman #222 refresh bug

**Call site:** `useEffect` auto-refresh queue (lines 7730-7900)
**Purpose:** Background price updates for books with NO price (incomplete scans)
**Trigger:** Collection tab open, no card detail, 60s cooldown, book has `price === null`
**Bug:** Sends stored image **without `skipImageSearch: true`**

**Impact:**
- Auto-refresh can trigger identity re-resolution
- Title-family clustering can refuse identity
- Phase 2 skipped → comps=null returned
- Overwrites stored comps with null
- Price stays null, "No eBay comps found" shown
- Book stuck in refresh loop (price=null → auto-refresh fires again → fails again)

**Example scenario:**
1. Bulk import scan completes, stored with `price: null` (enrich pending)
2. User opens Collection tab
3. Auto-refresh fires after 60s
4. Backend re-runs image search → title-family refuses → comps=null
5. Book STILL has `price: null`, will auto-refresh again in 60s
6. **Infinite broken refresh loop**

---

## ROOT MECHANISM ANALYSIS

**Ambush Bug title-flicker case:** ✅ **YES** — likely caused by auto-refresh (line 7798)
- Title flickered between values → identity re-resolution on refresh
- Auto-refresh sent stored image → title-family clustering ran
- Visual pool selected different family → title changed
- Flicker = merge overwriting confirmed identity with new visual consensus

**"Prices change when I open a card" reports:** ⚠️ **PARTIALLY RELATED**
- P0 lifecycle fix (commit earlier tonight) prevented card-open from triggering refresh
- BUT auto-refresh queue (line 7798) STILL fires in background while browsing collection
- If user opens card WHILE auto-refresh is in-flight, response can land and overwrite during card view
- AbortController at line 7796 should cancel on unmount, but race condition exists

**Why P0 didn't fully fix stability:**
- P0 fixed: Card-open no longer triggers silent refresh ✅
- P0 missed: Auto-refresh queue still has the skipImageSearch bug ❌
- Residual instability = auto-refresh responses landing during card viewing

---

## FIX REQUIRED: Auto-Refresh Queue

**File:** `src/App.jsx`
**Line:** 7798-7824 (auto-refresh fetch payload)

**Add:**
```javascript
skipImageSearch: true,
```

**Justification:**
- Auto-refresh is refreshing EXISTING books (already scanned, identity confirmed)
- Purpose: update PRICING only (comps/sold/PC data may have changed)
- Identity already locked from original scan
- Should NOT re-run title-family clustering
- Should NOT risk identity refusal
- Matches refreshMarketData behavior (commit 123ea95)

---

## VALIDATION PLAN

**After fix deployed:**

1. **Test auto-refresh stability:**
   - Open Collection tab
   - Wait 60s (auto-refresh cooldown)
   - Check Vercel logs for `[phase1]` output
   - Confirm NO title-family clustering logs
   - Confirm comps data preserved

2. **Test Ambush Bug scenario:**
   - Scan comic with ambiguous visual pool
   - Let auto-refresh fire
   - Confirm title does NOT flicker
   - Confirm identity stays locked

3. **Test infinite loop prevention:**
   - Create book with `price: null`
   - Trigger auto-refresh
   - Confirm price gets populated (not stuck null)
   - Confirm NO repeated refresh attempts

---

## SUMMARY

**Findings:**
- ✅ 9/11 call sites correct (initial scans, re-identify, manual entry)
- ✅ 1/11 already fixed (refreshMarketData, commit 123ea95)
- 🔴 **1/11 ACTIVE BUG** (auto-refresh queue, line 7798)

**Impact:**
- Auto-refresh can nuke comps data (same as Batman #222)
- Likely root cause of Ambush Bug flicker
- Contributes to "prices change on card open" reports
- Can create infinite refresh loops for books stuck at `price: null`

**Fix:** Add `skipImageSearch: true` to auto-refresh payload (line 7817)

**Priority:** HIGH — affects background stability, not user-triggered like refreshMarketData
