# Ship 6 — Polybag Pricing — SEALED 2026-05-05

## Status: BACKEND COMPLETE, UI DISPLAY BUG OUTSTANDING

### Backend (Deployed, Working)

- Polybag detection: 60% reprint title threshold on visualResult.items
- 11 bypass guards across all pricing branches
- out.comps populated with polybag listings when isPolybagPricing=true
- out.soldComps/salesByGrade/priceLadder/salesVelocity gated when polybag active
- Final price: ebay-polybag-active source, polybag median × 0.75 haircut
- Verified: B&B #28 polybag prices $9.00 in production logs

### Frontend Bug (Not Yet Diagnosed)

- UI displays "Recommended: $4,500" despite backend returning out.price=null and pricingSource=refused-claude-gate
- Polybag comp data displays correctly ($3-$525 range, $9 avg)
- Bug location unknown - likely src/App.jsx or PriceCard component
- Three possible causes: cached state, priceLadder lookup in React, vision.price merge

### Pending Ships

- Ship 5.2: claude-check polybag-aware (skip veto when ebay-polybag-active)
- UI fix: Recommended price source resolution

### Final Commits

- 8466ea4: Ship 6 - skip PC per-grade arrays when polybag pricing active
- e2c02f1: Ship 6 - clear soldComps arrays when polybag pricing active
- 02da165: Ship 6 - populate out.comps with polybag listings
- acd0193: Ship 6 - browse_api fallback guard (11th)
- eef344b: Ship 6 - priceCharting fallback guard (10th)
- c087c5d: Ship 6 - priceBands guard (9th)
- c1304ab: Ship 6 - move polybag block AFTER out declaration
