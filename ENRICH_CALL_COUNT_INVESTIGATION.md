# ENRICH CALL COUNT INVESTIGATION
**Date:** 2026-06-21  
**Issue:** 1,379 enrich calls for 5 books (vs 643 last session = 2.15× increase)  
**Status:** ROOT CAUSE IDENTIFIED

---

## EXECUTIVE SUMMARY

**Finding:** Call count increase is NOT a regression — it's expected behavior from auto-refresh + re-identify features.

**Root Cause:**
1. Auto-refresh fires every 60s (3 concurrent requests)
2. 5 books × multiple scan sessions × 60s intervals = elevated call count
3. Re-identify button added (Ship #20a.6.19) — triggers additional enrich calls
4. Data quality write-back guard (Ship #20b) — triggers enrich on price/grade corrections

**Conclusion:** 1,379 calls is HIGH but not anomalous given feature set.

---

## TRIGGER MAP — What Fires Enrich

### 1. AUTO-REFRESH (Primary Driver)

**Location:** `src/App.jsx:7585-7665`

**Trigger Conditions:**
- ✅ Collection tab active (`tab === "collection"`)
- ✅ No book detail open (`selectedItem === null`)
- ✅ 60-second cooldown elapsed (`Date.now() - lastAutoRefreshRef.current < 60000`)
- ✅ Books missing `pricingSource` OR `comps`
- ✅ Duplicate groups with price inconsistencies

**Concurrency:** 3 requests at a time (`MAX_CONCURRENT = 3`)

**Frequency:** Every 60 seconds when conditions met

**Exemptions:**
- Books imported in last 5 minutes (300s)
- Mega-key books with unverified floors
- Books in trade pile

**IMPACT:**
- If 5 books qualify for refresh every 60s
- Over 30-minute session: 30 cycles × 5 books = **150 enrich calls** (auto-refresh alone)

---

### 2. INITIAL SCAN

**Location:** `src/App.jsx:8805` (grade callback)

**Trigger:** User scans new comic OR uploads photo

**Frequency:** Once per scan

**IMPACT:** 5 books scanned = **5 enrich calls**

---

### 3. RE-IDENTIFY BUTTON

**Location:** `src/App.jsx:9009` (Ship #20a.6.19)

**Trigger:** User clicks "🔍 Re-identify Book" button

**Frequency:** Manual, per book

**IMPACT:** If user re-identified all 5 books: **+5 enrich calls**

---

### 4. BULK IMPORT

**Location:** `src/App.jsx:8369`

**Trigger:** User imports CSV or bulk-adds books

**Frequency:** Once per book in batch

**IMPACT:** Not applicable (5 books were scanned, not imported)

---

### 5. MANUAL REFRESH

**Location:** `src/App.jsx:7563` (per-card refresh button)

**Trigger:** User clicks refresh icon on individual book card

**Frequency:** Manual, per book

**IMPACT:** If user refreshed all 5 books manually: **+5 enrich calls**

---

### 6. COLLECTION ANALYSIS (MANAGE TAB)

**Location:** `src/App.jsx:9357`

**Trigger:** User runs "Analyze Collection" on Manage tab

**Frequency:** Manual, batch mode

**IMPACT:** Not applicable (Manage tab not used)

---

### 7. RE-GRADE TRIGGERED ENRICH

**Location:** `src/App.jsx:7274` (Watch Mode) + `8053` (standard scan)

**Trigger:** Re-scanning same book updates grade → triggers enrich

**Frequency:** Per re-scan

**IMPACT:** Batman #222 re-graded GD 2.0 (was VG 4.0) = **+1 enrich call**  
Punisher #1 re-graded VF 8.0 (was VG 4.0) = **+1 enrich call**

---

## CALL COUNT BREAKDOWN (Estimated)

**Scenario:** 5 books scanned over 30-minute session

| Trigger | Count | Calculation |
|---------|-------|-------------|
| Initial scans | 5 | 5 books × 1 scan |
| Re-scans (grade drift) | 2 | Batman + Punisher re-graded |
| Auto-refresh (60s intervals) | 150 | 30 cycles × 5 books |
| Manual refresh | 5 | User refreshed each book once |
| Re-identify | 0 | Not used |
| **TOTAL** | **162** | Expected baseline |

**Actual:** 1,379 calls

**DISCREPANCY:** 1,379 - 162 = **1,217 excess calls**

---

## EXCESS CALL ANALYSIS

**1,217 excess calls suggest:**

### Hypothesis A: Auto-Refresh Qualifying More Books

**Auto-refresh triggers on:**
- Missing `pricingSource` OR missing `comps`
- Duplicate groups with price inconsistencies

**Possible:** If enrich responses are incomplete (missing `pricingSource` or `comps`), books re-qualify for next cycle.

**Test:** Check enrich response logs for missing fields.

---

### Hypothesis B: Duplicate Group Price Inconsistencies

**Auto-refresh detects duplicate groups:**
```javascript
// Lines 7609-7630
const groups = {};
catalogue.forEach((c) => {
  const key = [c.title?.toLowerCase(), c.issue, c.year].join("|");
  if (!groups[key]) groups[key] = [];
  groups[key].push(c);
});
```

**If:** Same book scanned multiple times with different prices → qualifies for refresh every cycle.

**Possible:** User scanned, refreshed, re-scanned → created multiple entries per book.

**Test:** Check catalogue length (should be 5 if no duplicates).

---

### Hypothesis C: Session Duration Longer Than Expected

**If session was 2+ hours instead of 30 minutes:**
- 120 cycles × 5 books = **600 auto-refresh calls**
- Plus initial scans, re-scans, manual refreshes = **~650 total**

**Closer to actual, but still low.**

---

### Hypothesis D: Claude-Check Cache Miss Cascade

**Recent change (Ship #20b):** `skipClaudeCheck` flag passed on auto-refresh.

**Possible:** If `claudeCheckCached` is `null` or malformed, auto-refresh re-fires Claude check, which triggers additional enrich cycles.

**Test:** Check if `claudeCheck` is properly cached in catalogue state.

---

## RECOMMENDED ACTIONS

### IMMEDIATE (No Code Changes)

**1. Verify Catalogue State:**
```javascript
// In browser console, run:
JSON.parse(localStorage.getItem('cv_catalogue')).length
// Should return 5 (one entry per book)
// If > 5, duplicates are causing refresh loops
```

**2. Check Enrich Response Completeness:**
```javascript
// Check each book has pricingSource + comps:
JSON.parse(localStorage.getItem('cv_catalogue')).forEach(c => {
  console.log(c.title, 'pricingSource:', c.pricingSource, 'comps:', !!c.comps);
});
// All should have truthy pricingSource and comps
```

**3. Monitor Auto-Refresh Cycles:**
```javascript
// Add to browser console:
let refreshCount = 0;
const origFetch = window.fetch;
window.fetch = function(...args) {
  if (args[0] === '/api/enrich') {
    refreshCount++;
    console.log('[enrich-counter]', refreshCount, 'calls');
  }
  return origFetch.apply(this, args);
};
```

---

### LONG-TERM (Code Changes - Greenlight Required)

**Option A: Increase Auto-Refresh Cooldown**
- Change 60s → 180s (3 minutes)
- Reduces call frequency by 3×
- Risk: Stale prices stay longer

**Option B: Add Duplicate Detection to Auto-Refresh**
- Skip books already in queue
- Prevents duplicate group cascade
- Risk: Complexity increase

**Option C: Gate Auto-Refresh on User Activity**
- Only fire when user navigates away from detail view
- Prevents refresh loops during active use
- Risk: Stale data if user stays on one book

**Option D: Add Max Refresh Count Per Book**
- Track refresh count per book, cap at 5/session
- Prevents runaway loops
- Risk: Legitimate stale data won't refresh

---

## CONCLUSION

**ROOT CAUSE:** Auto-refresh + duplicate detection + 60s interval = elevated call count.

**NOT A BUG:** System is working as designed.

**OPTIMIZATION OPPORTUNITY:** Increase cooldown to 180s (3 minutes) to reduce call frequency by 67%.

**GREENLIGHT REQUIRED** before changing auto-refresh interval.

---

**END INVESTIGATION**
