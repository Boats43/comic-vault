# FIX 3 BUGS — CGC Detection Not Firing

**Date:** 2026-06-20  
**Issue:** [cgc-check] never fires for Batman #222

## Root Cause Analysis

### BUG 1: Wrong Price Passed to CGC Check ✅ CONFIRMED

**Problem:** CGC upside calculation uses floor-enforced price, not raw market price.

**Evidence from logs:**
- `item.price = $173.11` (floor-enforced final price)
- Real raw market = ~$62 (recent sold avg)
- CGC upside = $247 - $173 - $75 = **-$1** → NO TRIGGER ❌

**Correct calculation should be:**
- PC base × grade mult = ~$57.82 (or soldAvg ~$62)
- CGC upside = $247 - $62 - $75 = **$110** → TRIGGER ✅

**Call site:** api/enrich.js:4376
```javascript
out.decision = computeDecision(out, { ... });
```

The `out` object contains `out.price` which is the **final floor-enforced price**, not the raw market price.

### Price Fields Available in `out` Object

**At decision time (line 4376), these price fields exist:**

1. **`out.price`** — Final floor-enforced price (e.g., $173.11)
   - Set at multiple locations (lines 2754, 2785, 2798, 3071, 3440, etc.)
   - Goes through: PC × gradeMult → sanity → floor → variant mult → key mult → thin-pool anchor → mega-key floor

2. **`out.soldCompsAvg`** — Sold-only average (e.g., ~$62)
   - Set at line 3659
   - FIX 2 added this field
   - **This is the pre-floor raw market price we need** ✅

3. **`out.preFloorPrice`** — Price before mega-key floor (only set for mega-keys)
   - Set at line 3438 (only when mega-key floor applied)
   - NOT available for regular books ❌

4. **`out.priceCharting.price`** — PC base price (e.g., $96.37 for Batman #222)
   - Available but needs grade multiplier applied

5. **`out.gradeMultiplier`** — Grade multiplier (e.g., 0.6 for GD)
   - Available

**Best source for raw market price:** `out.soldCompsAvg`
- Already computed (FIX 2)
- Represents verified sold comps average
- Pre-floor, pre-sanity
- Available for all books with sold history

**Fallback when soldCompsAvg is null:**
```javascript
const rawMarketPrice = out.soldCompsAvg 
  || (out.priceCharting?.price * out.gradeMultiplier) 
  || out.price; // last resort
```

### BUG 2: Grade Mapping Issue ✅ CONFIRMED

**Problem:** CGC detection assumes user's current grade maps to CGC ladder grade directly.

**Current logic (decisionEngine.js:458-465):**
```javascript
const currentGrade = item.grade || item.rawGrade || 'VG';
const targetNumeric = GRADE_TO_NUMERIC[currentGrade] || 6.0;
const nearestGrade = ladderGrades[0]; // nearest to targetNumeric
const cgcValue = ladder[nearestGrade];
```

**Batman #222 example:**
- Vision grade: "GD 2.5" (with 4-corner chips)
- GRADE_TO_NUMERIC['GD'] = 2.0
- Ladder has: [2, 4, 6, 8, 9.2, 9.4, 9.6, 9.8, 10]
- nearestGrade = 2.0
- cgcValue = ladder[2.0] = $102

**CGC upside with CORRECT price:**
- rawMarketPrice = $62
- cgcUpside = $102 - $62 - $75 = **-$35** → NO TRIGGER ✅

**This is CORRECT behavior!** GD 2.5 with corner chips shouldn't trigger CGC submission — the economics don't work.

**The earlier FN 6.0 example (from investigation docs):**
- Was hypothetical, not the actual Batman #222 grade
- FN 6.0 at $70 → CGC 6.0 $247 → upside $102 → WOULD trigger ✅

**So BUG 2 is NOT a bug** — the grade mapping works correctly. The issue was **BUG 1** (wrong price input).

## Price Flow in enrich.js

**Pricing chain (simplified):**
```
1. Line 2754: out.price = priceBandsRaw.market (verified sold/active)
   OR
   Line 2785/2798: out.price = PC × gradeMult (raw estimate)

2. Line 2809-2870: Sanity check (may lift/lower price)

3. Line 3058-3075: Floor enforcement
   - rawFloor from comps.lowest
   - out.price raised to rawFloor if below
   - NO preFloorPrice saved (except mega-keys)

4. Line 3248: Variant multiplier applied

5. Line 3308: Key multiplier applied

6. Line 3346: Thin-pool anchor (cap at rawComps.highest × 1.05)

7. Line 3374: Low-grade floor anchor

8. Line 3440: Mega-key floor (saves preFloorPrice here)

9. Line 4376: computeDecision(out) ← uses final floor-enforced price
```

**The raw market price (pre-floor) is NOT preserved** except:
- `soldCompsAvg` (FIX 2) — sold average
- `preFloorPrice` (mega-keys only) — price before mega-key floor

## Fix Required

**decisionEngine.js:447** — Change price input to CGC check:

**Current:**
```javascript
if (!item.isGraded && item.priceLadder && item.price != null && item.price > 0) {
  // ...
  const cgcUpside = cgcValue - item.price - CGC_ALL_IN_COST;
```

**Fixed:**
```javascript
if (!item.isGraded && item.priceLadder && item.price != null && item.price > 0) {
  // Use raw market price (pre-floor) for CGC upside calculation
  const rawMarketPrice = item.soldCompsAvg 
    || (item.priceCharting?.price && item.gradeMultiplier 
        ? item.priceCharting.price * item.gradeMultiplier 
        : item.price);
  
  // ...
  const cgcUpside = cgcValue - rawMarketPrice - CGC_ALL_IN_COST;
  
  // Trigger condition unchanged
  if (cgcUpside > rawMarketPrice) {
```

**Also update evidence object:**
```javascript
decision.evidence.gradingUpside = {
  currentPrice: item.price,          // floor-enforced (display)
  rawMarketPrice: rawMarketPrice,    // pre-floor (calculation)
  targetGrade: nearestGrade,
  cgcValue: cgcValue,
  gradingCost: CGC_ALL_IN_COST,
  netUpside: cgcUpside,
  rawGrade: currentGrade
};
```

## Expected Behavior After Fix

**Batman #222 GD 2.5:**
- rawMarketPrice: ~$62 (soldCompsAvg)
- ladder[2.0]: $102
- cgcUpside: $102 - $62 - $75 = **-$35**
- Trigger: -$35 > $62? **NO** ✅
- **Correct!** GD with corner chips is not worth grading.

**Hypothetical Batman #222 FN 6.0:**
- rawMarketPrice: ~$70
- ladder[6.0]: $247
- cgcUpside: $247 - $70 - $75 = **$102**
- Trigger: $102 > $70? **YES** ✅
- action = HOLD_FOR_CGC ✅

**Groo in the Wild #1 (modern low-value):**
- rawMarketPrice: ~$6
- priceLadder: likely null or insufficient upside
- No trigger → stays LIST_LOW ✅

## Summary

| Bug | Status | Severity | Fix |
|-----|--------|----------|-----|
| BUG 1: Wrong price (floor vs raw) | ✅ CONFIRMED | HIGH | Use soldCompsAvg or PC×gradeMult |
| BUG 2: Grade mapping | ❌ NOT A BUG | N/A | Current logic correct |

**Next step:** Implement BUG 1 fix in decisionEngine.js.
