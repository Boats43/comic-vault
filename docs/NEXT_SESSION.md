# Next Session Priorities

## Current State (2026-05-07)

**Latest commit:** fd0a313 — A-lite hotfix 3 (collection screen crash fix)  
**Vercel functions:** 12/12  
**Test count:** 1,570 passing across 23 suites  

**Layer Progress:**
- Layer 1 (Foundation): ~95%
- Layer 2 (Data Leverage): ~45%
- Layer 3 (Decision Engine): ~20% (v0-D.1 deployed)
- Layer 4 (Portfolio OS): 0%

## Immediate Priorities

### 1. Decision Engine Validation (HIGH PRIORITY)

**Production verification needed:**
- ✅ Decision badges display correctly on Collection tab
- ✅ Listing gate shows blocker alert when decision=WAIT
- ✅ Vision price hallucination stripped (polybag case)
- ✅ Collection screen stable (no crashes)
- ✅ listPrice persists through refresh

**Pending validation:**
- Decision accuracy calibration (confidence thresholds)
- Blocker coverage audit (other refusal cases)
- BUY decision logic on Buyer tab (Whatnot session testing)

### 2. Day 2 Ship Validation (Phone Test)

From SESSION_2026_05_06.md — 10-item punch list:

1. Detective Comics #27 reprint — Ship 13 — should NOT show $150K, edition banner present
2. Marvel Tales #111 (1952) — Ship 22 — title preserved as "Marvel Tales" (delete + re-scan if cached)
3. Marvel Saga #18 newsstand — Ship 14 — price up from $3.99 (~$4.79)
4. One World Under Doom #1 virgin — Ship 18 — price down from $47 (target $13-25)
5. Mega Man X Timelines #1 virgin — Ship 18 — price down from $22 (target $10-15)
6. Limited Collectors C-44 Treasury — Ship 15 — not refused
7. Catwoman Uncovered #1 foil — Ship 12r — improved comps
8. B&B #28 polybag — Ship 0.6 — still works, price reasonable
9. Wolverine #1 (1982) — Ship 20 — story field "Translate:" garbage gone
10. Uncanny X-Men #173 — Ship 20 — story field "Collects:" garbage gone

Plus UI label spot check: pick 3 cards, verify "Price from:" shows human labels (not raw slugs).

### 3. Decision Engine Next Steps

**v0-E — Tests** (2 hours)
- Unit tests for `computeDecision` helper
- Integration tests for enrich decision output
- UI tests for decision badge display

**v1-A — Calibration** (3 hours)
- Adjust confidence thresholds based on production data
- Audit blocker list against all refusal cases
- Test magazine format / non-comic refusal paths

**v1-B — BUY Path Validation** (2 hours)
- Test BUY recommendations on Buyer tab
- Validate netProfit calculation
- Test with real Whatnot sessions

### 4. Known Gaps

**Ship 6 Polybag UI Bug:**
- UI displays "Recommended: $4,500" despite backend refusing
- Bug location: likely src/App.jsx or PriceCard component
- Three possible causes: cached state, priceLadder lookup, vision.price merge
- **Status:** Backend working, frontend display incorrect

**Vision JSON_SHAPE Review:**
- Consider removing `price` field from Vision prompt
- Prevents hallucinations on polybag/reprint scans
- Would require backend to own all pricing (current architecture already does this)

### 5. Roadmap (Intelligence Layer)

See `docs/ROADMAP.md` for full specs:
- Ship #24 — Velocity Curves (6 hours)
- Ship #25 — Grade-Jump ROI (4 hours)
- Ship #26 — Portfolio Intelligence (10 hours)
- Ship #27 — Auction Intelligence (8 hours)

Total: 28 hours remaining to "best out there" status.

## Architecture Notes

**Critical caveats:**
- IndexedDB caching: Ship 22 fix applies to FRESH scans only. Existing items need DELETE + re-scan.
- Provisional state: Vision can hallucinate fields when they exist in JSON_SHAPE. Strip on merge when backend refuses.
- JSX scope: Build + tests passing ≠ React runtime safety. Render smoke tests required for UI stability.
- Field normalization: Must happen BEFORE decision computation, not after.

**Pattern library additions (Day 3):**
- Provisional State Write Class
- Vision Hallucination Class
- Build-Pass Runtime-Fail Class
- Field Normalization Ordering
- Reprint Language Safety
- Decision Blocker Completeness

See `docs/archive/SESSION_2026_05_07_DECISION_ENGINE.md` for full Day 3 patterns.

## Open Blockers

**External:**
- GoCollect API key #019483 — pending since 2026-04-15
- eBay Marketplace Insights API — gated for indie devs (DEAD)
- eBay Finding API — rate-limited 100% (bypassed via PC scrape)

**Workaround active:**
- PriceCharting sales-history scrape (Ship #20a foundation)
