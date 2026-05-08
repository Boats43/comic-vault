# Comic Vault Intelligence Layer Roadmap

**Intelligence layer roadmap — maximizing all data sources.**

## Ship #24 — VELOCITY CURVES + DYNAMIC PRICING (NEXT)
**Est: 6 hours | Highest ROI**

Extract 90d/30d/7d velocity trends from PC sales-history (already captured, currently unused).
- Velocity classification: ACCELERATING / FLAT / DECELERATING
- Dynamic pricing strategy:
  - Accelerating → price at Stretch band (sell into demand)
  - Decelerating → price at Quick band (exit before drop)
  - High auction watch counts → +5% premium (demand spike)
  - 3+ auctions ending this week → -10% (undercut flood)
- Price peak detection: "Sell NOW — velocity tripling (peak in 7-14d)"
- Market saturation warnings: "Comp pool flooding — wait or drop price"

**Impact:** Catch price peaks (+15% sell price), avoid dumps (-25% loss prevention)

**Files:**
- `src/lib/velocityCurves.js` (NEW — velocity extraction + trend classification)
- `src/lib/priceBands.js` (ENHANCE — dynamic pricing adjustments)
- `api/enrich.js` (ENHANCE — plumb velocity trend to output)

**Tests:** 40 tests (velocity math, trend detection, dynamic pricing logic)

---

## Ship #25 — GRADE-JUMP ROI CALCULATOR
**Est: 4 hours | High profit finder**

Use PC price ladder (already captured, 14 grades per book) to calculate press/submit ROI.
- Grade scenario comparison:
  - Current: 9.4 raw → $2,100 market
  - Scenario A: Press + 9.6 submit → $4,200 FMV - $55 cost = $2,045 profit (97% ROI)
  - Scenario B: Raw 9.4 submit → $2,800 FMV - $35 cost = $665 profit (32% ROI)
  - Recommendation: Press first, target 9.6
- Downside protection: "If grade drops to 9.2 → -$385 loss"
- Submission sweet-spot: Only recommend when ROI > 50%

**Impact:** Identify $2K+ profit opportunities, prevent bad submissions (< 30% ROI)

**Files:**
- `src/lib/gradeJumpROI.js` (NEW — ROI calculator, scenario builder)
- `src/App.jsx` (ENHANCE — add ROI panel to CollectionDetail)

**Tests:** 25 tests (ROI math, cost scenarios, grade-drop risk)

---

## Ship #26 — PORTFOLIO INTELLIGENCE
**Est: 10 hours | Differentiator (no competitor has this)**

Analyze 84-book catalogue for portfolio-level insights.

**A. Diversification Scoring**
- Character exposure: "Spider-Man: 22 books (26% portfolio) — HIGH RISK"
- Era exposure: "Bronze Age: 38 books (45%) — balanced"
- Publisher exposure: "Marvel: 68 books (81%) — consider DC/indie"
- Correlation risk: "ASM #129 + Punisher #1 move together (r²=0.87)"

**B. Gap Detection (ComicVine story arcs)**
- "You own 5/6 Kraven's Last Hunt — buy Spectacular #132 ($45)"
- "Complete set premium: +25% ($280 → $350) = $70 net value gain"

**C. Bundle Opportunities**
- Detect: ASM #121, #122, #129 (Death of Gwen trilogy)
- Individual value: $850 + $420 + $2,100 = $3,370
- Bundle premium: +18% = $3,977
- Gain: $607 vs selling individually

**D. Liquidity Profile**
- FAST (sell <7d): 12 books ($8,400)
- NORMAL (7-30d): 48 books ($22,100)
- SLOW (>30d): 24 books ($18,200)

**Impact:** Risk reduction (diversify), value capture (complete sets), buy targeting (gap-fill)

**Files:**
- `src/lib/portfolioAnalyzer.js` (NEW — correlation, gaps, bundles)
- `api/comicvine-arcs.js` (NEW — story arc lookup)
- `src/App.jsx` (ENHANCE — Manage tab portfolio dashboard)

**Tests:** 50 tests (correlation math, gap detection, bundle scoring)

---

## Ship #27 — AUCTION INTELLIGENCE
**Est: 8 hours | Leading indicator**

Track eBay auctions (already queried in Browse API, data currently unused).
- **Watch counts:** High watchers → price spike coming (leading indicator)
- **Bid velocity:** 12 bids in 2 days → FAST liquidity
- **Auction calendar:** "3 auctions ending this week → wait for dip"
- **Reserve tracking:** Reserve met = price floor hint

**Example:**
```
ASM #129 auction:
  • Watch count: 47 (HIGH demand)
  • Bid velocity: 2.4 bids/day (FAST)
  • Ending: 2026-05-02 (3 days)
  → Recommendation: List NOW before auction flood
```

**Impact:** Timing optimizer (list before flood), demand forecasting (watch → spike)

**Files:**
- `api/comps.js` (ENHANCE — capture auction data from Browse API)
- `src/lib/auctionIntelligence.js` (NEW — watch/bid extraction, calendar)

**Tests:** 35 tests (watch/bid parsing, calendar logic, demand scoring)

---

## PHASE 2 (Deferred — Lower Priority)

**Ship #28 — IMAGE FORENSICS** (12 hours)
- Color histogram → detect color-touch restoration
- Edge sharpness → detect pressing
- Paper texture → detect modern reprint
**Reason:** High effort, incremental authentication value

**Ship #29 — CROSS-SOURCE VALIDATION** (10 hours)
- Compare Vision vs CV vs PC vs eBay consensus
- Authentication score 0-100 (all sources agree → 99%)
**Reason:** Nice-to-have polish, current confidence scoring sufficient

---

## COMPLETED SHIPS (Reference)
- ✅ Ship #20b — Verified sold pricing (Quick/Market/Stretch bands)
- ✅ Ship #21 — Claude quality check + demand signals  
- ✅ Ship #22 — Best practice eBay listings (item specifics, multi-image, Claude titles, Best Offer)
- ✅ Ship #23 — Consistency engine (CV gate, refuse-to-price, stale refresh)

---

## Timeline

- Core intelligence layer (Ships #24-27): 28 hours total
- Est completion: 4-5 weeks (at current pace)
- Phase 2 (Ships #28-29): 22 hours — deferred to lower priority
- Total to "best out there" status: ~50 hours remaining (7 weeks)
