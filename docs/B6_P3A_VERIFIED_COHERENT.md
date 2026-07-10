# B6 [P3-A]: Tier-3 Card Header Price Consistency

## Status: VERIFIED COHERENT — NO CHANGES NEEDED

## Evidence Path

### Backend (api/enrich.js)
Line 3663: `out.price = fmtUsd(priceBandsRaw.market);`
- `priceBandsRaw.market` = tier-3 active average × 0.85 (from buildPriceBands)
- `out.price` is the canonical market recommendation

### Decision Engine (src/lib/decisionEngine.js)
Line 634, 674: `decision.price = item.price;`
- Decision engine receives `item.price` (= backend's `out.price`)
- `decision.price` = same value as `priceBandsRaw.market`

### Frontend Display (src/App.jsx)
Line 3351-3355 (Card header):
```javascript
{item.decision?.price != null
  ? (typeof item.decision.price === 'number'
    ? `$${Number(item.decision.price).toFixed(2)}`
    : (String(item.decision.price).startsWith('$') ? item.decision.price : `$${item.decision.price}`))
  : `$${Number(displayPrice).toFixed(2)}`}
```

Line 137-141 (getDisplayPrice fallback):
```javascript
if (item.priceBands?.market) {
  const marketPrice = parseFloat(String(item.priceBands.market).replace(/[$,]/g, ""));
  if (marketPrice > 0) return marketPrice;
}
```

### Coherence Chain
1. Backend: `out.price = fmtUsd(priceBandsRaw.market)` ← tier-3 active × 0.85
2. Decision: `decision.price = item.price` ← same value
3. Frontend header: `decision.price` OR `displayPrice(priceBands.market)` ← both same source

## User's Evidence Re-analyzed

**Crow card:** "$16.07 header vs $13.66 recommended"
- Header used `decision.price` (tier-3 active avg, no damping)
- Recommended used `priceBands.market` (tier-3 × 0.85)
- RESOLVED: backend now sets `out.price = priceBandsRaw.market` (line 3663)

**War & Attack:** "$12.85 header vs $10.93 recommended"
- Same pattern as Crow
- RESOLVED: same fix

## Conclusion

P3-A coherence already achieved via line 3663 backend change (likely Ship #20a or prior session). Header displays `decision.price` which sources from `item.price` which equals `priceBandsRaw.market`.

No additional changes required for B6.
