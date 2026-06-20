# Wolverine #8 Blocker Investigation

**Date:** 2026-06-20  
**Issue:** Wolverine #8 changed from LIST_LOW $91 → BLOCKED $148

## Observations

**Before (baseline):**
- Status: LIST_LOW
- Price: $91

**After (current):**
- Status: BLOCKED
- Price: $148
- Price increased by +$57 (+63%)

## Potential Blockers

The decision engine has 11 blocker types. Given the price INCREASE and BLOCKED status, likely candidates:

### 1. catastrophic-system-overprice (lines 152-162)
**Trigger:** `systemPrice > activeAvg × 10`

If Wolverine #8 activeAvg dropped significantly OR systemPrice jumped:
- Example: activeAvg=$14, systemPrice=$148 → ratio=10.6× → BLOCKED ✅

**Check:**
- What is `item.rawComps.average` for Wolverine #8?
- What is `item.price` ($148)?
- Ratio = $148 / activeAvg

### 2. catastrophic-reprint-overprice (lines 167-175)
**Trigger:** reprint detected AND `systemPrice > activeAvg × 5`

If Wolverine #8 has reprint/polybag flag:
- Example: isReprint=true, activeAvg=$25, systemPrice=$148 → ratio=5.9× → BLOCKED ✅

**Check:**
- `item.editionWarning.detected` (is reprint flagged?)
- `item.isPolybagPricing` (is polybag pricing active?)

### 3. Claude check critical severity (line 137-143)
**Trigger:** `item.claudeCheckBlocker` is set

FIX 2 didn't touch claude-check logic, but if Wolverine was rescanned and claude-gate flagged it:

**Check:**
- `item.claudeCheckBlocker` value
- Recent claude-check logs for wolverine

### 4. identity-not-confident (line 113-115)
**Trigger:** `item.identityConfident === false`

FIX 1 changed year backfill behavior. If Wolverine's year resolution changed and broke identity confidence:

**Check:**
- `item.identityConfident` (should be true for a working book)
- `item.year` (did it change?)
- `item.yearBackfilledFromComps` (did backfill fire incorrectly?)

## What Changed Between Before/After

**FIX 1 (1abac22, a5e1a22):**
- Year backfill from comp consensus
- Could affect identity resolution if comp pool contains wrong year

**FIX 2 (06468e7):**
- Sold avg display only (UI change)
- Should NOT affect decision logic

**FIX 3 (9d02726):**
- HOLD_FOR_CGC detection
- Only fires on raw books with priceLadder
- Should NOT block graded books

## Most Likely Cause

**Hypothesis:** catastrophic-system-overprice blocker

The $148 price suggests pricing math changed (PC data update, comp pool shift, or sanity/floor changes). If activeAvg is now very low (thin pool, contaminated pool, or AI verify rejected most comps), the 10× ratio could trigger.

**Alternative:** Year backfill (FIX 1) changed Wolverine's year, breaking PC/CV matches, causing pricing to fall back to a thin/contaminated comp pool with low activeAvg.

## Required Data for Diagnosis

From Vercel logs for Wolverine #8 scan:

1. **Decision blocker:**
   ```
   [decision] action=DO_NOT_LIST blockers=[...] 
   ```
   
2. **Identity confidence:**
   ```
   [identity-gate] identityConfident=false/true missing=[...]
   ```

3. **Year resolution:**
   ```
   [year-backfill] ... (if fired)
   [year-resolved] ... → confirmedYear
   ```

4. **Comp pool:**
   ```
   [enrich] AI verify: kept X/Y
   rawComps: { average: Z, count: N }
   ```

5. **Pricing:**
   ```
   [pricing] finalPrice=$148 source=...
   activeAvg: $X
   ```

## Next Steps

1. Search Vercel logs for "wolverine" or "Wolverine #8"
2. Find the [decision] log line showing blockers array
3. Find the [pricing] log line showing activeAvg
4. Calculate ratio: $148 / activeAvg
5. If ratio > 10 → catastrophic-system-overprice blocker confirmed
6. If blocker is different → investigate that path

**No fixes until root cause confirmed.**
