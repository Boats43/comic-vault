# Universal Asset Intelligence

**Status:** Conceptual Framework  
**Date:** 2026-05-19  
**Purpose:** Intelligence layer architecture for Comic Vault pricing and decision engine

---

## Architecture Overview

Comic Vault's pricing and decision engine operates through four layers:

### Layer 1: Foundation (Identity + Pricing Math)
- Vision identification (Claude Opus 4.7)
- Identity confirmation (eBay visual consensus, ComicVine, PriceCharting)
- Pricing stack (verified_sold → price bands → PriceCharting × grade multipliers)
- Comp hygiene (18-filter chain)
- Sanity checks (era-aware thresholds)
- Floor guards (grade-aware, low-grade anchor, thin-pool anchor)

### Layer 2: Data Leverage (Market Intelligence)
- Sold comp verification (src/lib/soldVerification.js)
- Price bands engine (src/lib/priceBands.js)
- Demand signals (src/lib/demandSignals.js)
- Census data (PriceCharting pop, GoCollect census)
- Velocity tracking (sales frequency, trend direction)

### Layer 3: Decision Engine (Recommendation Logic)
- Action classification (LIST_NOW, LIST_LOW, RESEARCH, GRADE_CANDIDATE, DO_NOT_LIST, ID_REQUIRED)
- Confidence scoring (high/medium/low)
- Blocker detection (10 types)
- Warning signals (12 types)
- Next-steps guidance

### Layer 4: Portfolio OS (Collection Intelligence)
- ROI tracking (purchase price → current value)
- Bundle optimization (multi-book listing logic)
- Hot/warm/cold classification (AI tags)
- Submission scenarios (CGC grading profit analysis)
- Inventory health (decision distribution, liquid value)

---

## Data Sources (Priority Order)

1. **GoCollect FMV** (reference only, CGC grades 9.0–9.8)
2. **Verified sold comps** (eBay Marketplace Insights via PriceCharting scrape)
3. **Price bands** (verified_sold / verified_active comp pools)
4. **PriceCharting base** × grade multipliers
5. **eBay Browse API** (active listings, raw market signal)
6. **Visual search fallback** (image-based comp pool when identity uncertain)

---

## Confidence Caps (Ordered by Priority)

1. **Identity gate** (uncertain identity → refuse to price)
2. **Vision confidence LOW** (HIGH→MEDIUM cap, score ≤75)
3. **Zero-verified sold comps** (HIGH→MEDIUM cap, score ≤75) — Fix D
4. **Era-filter bypass** (vintage year missing → LOW cap, score ≤60)
5. **Thin comp pool** (count <3 → cautionary flags, no hard cap)

---

## Floor Hierarchy

1. **Mega-key floor map** (29 Golden/Silver/Bronze keys, authoritative)
2. **Grade-aware floor** (grade-proximity filtered minimum) — Fix C
3. **Low-grade floor** (bottom-of-census anchor to rawComps.lowest)
4. **Thin-pool anchor** (count=2 → cap at highest × 1.05)
5. **Raw comps.lowest** (global minimum when grade-filter unavailable)

---

## Decision Gates

### Hard Blocks (DO_NOT_LIST)
- Manual review required (mega-key MANUAL tier)
- Grade exceeds map (user grade above highest census)
- Identity conflict (eBay/Vision <20% overlap)
- Key issue misidentification (Claude gate: wrong book)
- Wrong issue / wrong series / wrong era
- Reprint/facsimile with <3 verified comps
- Catastrophic overprice (listPrice > engineRec × 2.0)
- Vision confidence LOW + no comps

### Soft Gates (RESEARCH)
- Sold/active mismatch (>30% delta)
- Thin Golden Age pool (vintage + count <3)
- Active avg far below sold avg
- Historical key date correction (downgrade from hard block) — Fix B
- Zero-verified sold comps + active only

### Grade Candidate (GRADE_CANDIDATE)
- Price ladder shows ≥2× uplift for higher grade
- User grade not bottom-of-census
- Grading cost + press < net profit scenario

---

## Phase 1 Fixes

**Fix A:** Float display formatting (formatCurrency helper, 2-decimal enforcement)  
**Fix B:** Batman #59 gate (historical date correction downgrade to RESEARCH when guards pass)  
**Fix C:** Grade-aware floor (use grade-proximity filtered minimum instead of global)  
**Fix D:** Zero-verified-comps confidence cap (HIGH→MEDIUM when sold data exists but none verify)

---

## Intelligence Principles

1. **Conservative pricing** — bias toward under-pricing on weak signals
2. **Trust but verify** — multiple sources confirm identity before authoritative pricing
3. **Grade-aware** — never price a VG 4.0 against FR 1.0 comps
4. **Era-aware** — vintage thresholds differ from modern (sanity, multipliers, floors)
5. **Transparency** — surface diagnostics (rejectedSamples, reasons, sources) for user review
6. **Safety gates** — refuse to price when confidence insufficient rather than hallucinate

---

**Related Docs:**
- CLAUDE.md (pricing stack, multiplier tables, comp filters)
- docs/validation/PHASE_1_REGRESSION_SET.md (behavioral validation set)
- docs/ROADMAP.md (Intelligence Layer roadmap, Ships #24-27)
