# Wolverine #8 Year Backfill Protection Check

**Date:** 2026-06-20  
**Issue:** Confirm year backfill doesn't fire when Vision already has the year

## Expected Behavior

**Wolverine #8 (1989)** should NOT trigger year backfill because:
1. Vision should extract "1989" correctly from the cover
2. `confirmedYear` should be "1989" after `resolveYear()` (line 1986)
3. `backfillFromComps()` should skip year extraction (line 168: `if (!confirmedYear)`)

## Protection Gate Location

**src/lib/identityCore.js:168**
```javascript
if (!confirmedYear) {
  // Year extraction logic...
}
```

**This gate should prevent backfill when `confirmedYear` is already set.**

## Call Flow

**api/enrich.js:**
1. **Line 1978-1984**: `resolveYear(year, pcYear, cvYear, ebayYearAuthoritative, ...)`
   - Sources: Vision year, PriceCharting year, ComicVine year, eBay authoritative year
   - Returns `{ confirmedYear, yearOverrideRejected, yearSource }`

2. **Line 1986**: `confirmedYear = yearResolution.confirmedYear`
   - If Vision extracted "1989" → `confirmedYear = "1989"`

3. **Line 1990-1995**: `backfillFromComps(confirmedTitle, confirmedYear, confirmedPublisher, visualResult?.items)`
   - Passes `confirmedYear = "1989"` to the function

4. **identityCore.js:168**: `if (!confirmedYear)` evaluates to `false` (because "1989" is truthy)
   - Year backfill SKIPPED ✅

5. **Line 1997**: `if (backfill.yearBackfilled)` evaluates to `false`
   - No year override occurs ✅

## Potential Failure Modes

### 1. Vision year extraction failed
If Vision returns `year: null` or `year: ""` for Wolverine #8:
- `resolveYear()` would try PC/CV fallbacks
- If PC/CV also return null → `confirmedYear = null`
- Backfill would fire → extract "1989" from comp titles
- **This is correct behavior** (backfill working as designed)

### 2. `resolveYear()` returning falsy when it shouldn't
If `resolveYear()` has a bug where it returns `null` despite Vision having "1989":
- Backfill would fire incorrectly
- **This would be a bug in resolveYear(), not backfill**

### 3. String vs null check issue
The gate is `if (!confirmedYear)` which checks for:
- `null` → triggers backfill ✅
- `undefined` → triggers backfill ✅
- `""` (empty string) → triggers backfill ✅
- `"0"` → SKIPS backfill ❌ (edge case: year=0 treated as truthy)
- `"1989"` → SKIPS backfill ✅

**The gate is correct** for all real-world years.

## Diagnostic Logs to Check

From Wolverine #8 Vercel logs, look for:

1. **Vision year extraction:**
   ```
   [grade] year="1989" (or year=null if failed)
   ```

2. **Year resolution:**
   ```
   [year-resolved] Vision="1989" → confirmedYear="1989" source=vision
   ```
   OR
   ```
   [year-resolved] Vision=null pcYear=1989 → confirmedYear="1989" source=pricecharting
   ```

3. **Year backfill (should NOT appear if Vision succeeded):**
   ```
   [year-backfill-debug] compItems available: 20 confirmedYear: 1989 needsBackfill: false
   ```
   ↑ This shows the gate worked (needsBackfill=false because confirmedYear exists)

4. **Year backfill firing (should NOT appear):**
   ```
   [year-backfill] 1989 from eBay comp consensus (...)
   ```
   ↑ If this appears, the gate FAILED

## Hypothesis: Why Wolverine #8 Is BLOCKED

**Most likely:** NOT related to year backfill.

The catastrophic-overprice blocker triggers when:
```javascript
if (systemPrice > activeAvg × 10) {
  decision.blockers.push('catastrophic-system-overprice');
}
```

If Wolverine #8 pricing changed:
- **Before:** $91 price, activeAvg ~$30 → ratio=3.0× → LIST_LOW ✅
- **After:** $148 price, activeAvg ~$14 → ratio=10.6× → BLOCKED ❌

**Possible causes:**
1. PC data updated → new price calculation → $148
2. Comp pool shifted → activeAvg dropped to $14
3. AI verify rejected more comps → thin pool with low activeAvg
4. Sanity fallback fired → lifted price to $148

**NOT caused by year backfill** unless:
- Year backfill incorrectly fired
- Changed year from 1989 → something else
- Broke PC/CV matches
- Caused pricing to fall back to contaminated comp pool

## Required Vercel Logs

To diagnose, search for these exact patterns in Wolverine #8 logs:

1. `[year-backfill]` — if present, backfill fired (unexpected)
2. `[pricing] finalPrice=$148 source=... activeAvg: $X` — shows the ratio
3. `[decision] action=DO_NOT_LIST blockers=[...]` — shows which blocker
4. `[enrich] AI verify: kept X/Y` — shows comp pool size

**Please paste the relevant log lines and I'll identify the exact cause.**

## Summary

**Year backfill protection gate:** ✅ CORRECT  
**Location:** src/lib/identityCore.js:168 `if (!confirmedYear)`  
**Protection:** Only fires when confirmedYear is null/undefined/empty  
**Expected for Wolverine #8:** SKIP backfill (Vision should have "1989")  

**Wolverine blocker hypothesis:** catastrophic-system-overprice (price/activeAvg ratio)  
**NOT related to year backfill** unless logs show `[year-backfill]` firing unexpectedly.
