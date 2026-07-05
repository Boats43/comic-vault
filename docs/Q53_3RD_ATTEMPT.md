# Q53 [P0] — 3rd Attempt: Tier Selection activePool=0

## Problem Statement
activeCount now reaches match-conf ([price-trace] activePool=29 from line 4148) but TIER SELECTION still reads 0 (tier line activePool=0 from priceBands.js:316).

Two different variables/scopes:
1. **Match-conf activeCount** (api/enrich.js:4003) — reads `priceBandsRaw.count` when tier=3
2. **Tier selection activePool** (priceBands.js:316) — reads `verifiedActive.length` from buildVerifiedActivePool

## Root Cause
`verifiedActive = buildVerifiedActivePool(activeComps, {title, issue})` at line 294 returns EMPTY array when it should have 29 items.

## Trace Points

### Point 1: priceBands.js:294 (buildVerifiedActivePool call)
```javascript
console.log(`[Q53-tier-trace] BEFORE buildVerifiedActivePool: ` +
            `activeComps.length=${activeComps?.length || 0} ` +
            `title="${title}" issue="${issue}"`);
const verifiedActive = buildVerifiedActivePool(activeComps, { title, issue });
console.log(`[Q53-tier-trace] AFTER buildVerifiedActivePool: ` +
            `verifiedActive.length=${verifiedActive.length}`);
```

### Point 2: priceBands.js:182 (inside buildVerifiedActivePool)
Log entry + exit to see filter chain results

## Expected vs Actual

### Expected (Action Weekly #638)
```
[Q53-tier-trace] BEFORE buildVerifiedActivePool: activeComps.length=29 title="Action Weekly" issue="638"
[Q53-tier-trace] AFTER buildVerifiedActivePool: verifiedActive.length=29
[price-trace] tier=3 ... activePool=29
```

### Actual (broken)
```
[Q53-tier-trace] BEFORE buildVerifiedActivePool: activeComps.length=29 title="Action Weekly" issue="638"
[Q53-tier-trace] AFTER buildVerifiedActivePool: verifiedActive.length=0
[price-trace] tier=4 ... activePool=0
```

## Next Actions
1. Deploy trace instrumentation
2. Scan Action Weekly #638
3. Check [Q53-tier-trace] logs
4. Fix buildVerifiedActivePool filter (likely title/issue match too strict)
