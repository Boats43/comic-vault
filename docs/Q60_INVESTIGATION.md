# Q60 [P0] — Match-Conf Regression Investigation

## Problem Statement
After commit 7d71330 (Q53 fix), match-conf score=0 tier=LOW on books with 17-21 verified solds.
Prior behavior: score 94-100, tier HIGH.

## Hypothesis
The activeCount variable move (7d71330) may have inadvertently broken `compTitlesForScore` derivation.

## Trace Points Needed

1. **Line 4009**: Log `compTitlesForScore.length` BEFORE computeMatchConfidence call
2. **Line 4015**: Log the actual `mc` return value
3. **Line 2771**: Check if `rawSoldRows` is populated correctly

## Investigation Steps

### Step 1: Add entry log before computeMatchConfidence
```javascript
// Line 4014 (after compTitlesForScore assignment)
console.log(`[Q60-trace] compTitlesForScore.length=${compTitlesForScore.length} ` +
            `rawComps.recentSales=${rawComps?.recentSales?.length || 0} ` +
            `rawComps.prices=${rawComps?.prices?.length || 0}`);
```

### Step 2: Scan TOS #96 (has 17-21 verified solds, should score HIGH)

### Step 3: Check log output
- If `compTitlesForScore.length=0` → rawComps is empty (unexpected)
- If `compTitlesForScore.length>0` but `mc.score=0` → computeMatchConfidence inputs wrong
- If neither → different regression path

## Expected Log Pattern (working case)
```
[Q60-trace] compTitlesForScore.length=18 rawComps.recentSales=18 rawComps.prices=18
[match-conf] score=94 tier=HIGH comps=18 vision=high
```

## Regression Log Pattern
```
[Q60-trace] compTitlesForScore.length=0 rawComps.recentSales=0 rawComps.prices=0
[match-conf] score=0 tier=LOW comps=0 vision=high
```

## Next Actions
1. Deploy trace instrumentation
2. Scan TOS #96
3. Analyze log output
4. Fix based on actual data path
