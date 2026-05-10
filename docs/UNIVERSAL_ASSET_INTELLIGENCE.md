# Universal Asset Intelligence Schematic

**Version:** 1.0  
**Date:** 2026-05-10  
**Status:** Documented — extraction deferred to Layer 4 (Portfolio OS)

---

## Overview

Comic Vault's pricing intelligence layer has evolved from single-asset evaluation (comic books) into a **universal asset pricing framework** applicable to any physical collectible with:
1. Verifiable identity fields
2. Condition gradation
3. Comparable market data
4. Scarcity metrics

This document preserves the framework design for future extraction into a standalone AssetCore library.

---

## Core Principles

### 1. Identity-First Architecture
All pricing starts with identity certainty. Without confident identification, no price should be computed.

**Identity components:**
- **Primary:** Title, Issue/Model/Edition, Publisher/Manufacturer
- **Secondary:** Year, Variant/Version, Creator/Designer credits
- **Confidence gates:** Vision confidence, field completeness, cross-source validation

**Current implementation:**
- `src/lib/identityGate.js` — sanitizeIdentityFields, assessIdentityConfidence
- `src/lib/identityAlignment.js` — cross-source consensus (Vision ↔ eBay ↔ ComicVine)
- `src/lib/imageSearchIdentity.js` — visual consensus extraction

**Universal extraction:**
Replace comic-specific fields (title/issue/publisher) with generic schema:
```javascript
{
  primaryId: string,      // "Amazing Spider-Man #1" → "Rolex Submariner 16610"
  secondaryId: string,    // "#1" → "Serial K123456"
  manufacturer: string,   // "Marvel" → "Rolex"
  year: number,
  variant: string,        // "newsstand" → "no-date dial"
  condition: string,      // "VG 4.0" → "good service history"
}
```

---

### 2. Condition-Aware Pricing
Condition directly multiplies base value. Without condition normalization, comps are meaningless.

**Condition components:**
- **Grading system:** CGC 0.5–10.0 (comics) → generic 0–100 scale
- **Grade multipliers:** Era-aware tables (vintage vs modern dampening)
- **Condition penalties:** Defects, restoration, alterations
- **Census context:** Scarcity at grade (pop data)

**Current implementation:**
- `CGC_MULTIPLIERS` and `RAW_MULTIPLIERS` in `api/enrich.js`
- Era-aware multiplier selection (vintage ≥1956, modern ≥1985)
- Defect penalty application (staple rust, cover detached, etc.)
- Pop-report scarcity ratio (`item.pop.scarcityRatio`)

**Universal extraction:**
```javascript
const CONDITION_MULTIPLIERS = {
  [assetClass]: {
    [conditionTier]: {
      [era]: multiplier
    }
  }
};

// Example:
CONDITION_MULTIPLIERS.watch.mint.vintage = 2.5;
CONDITION_MULTIPLIERS.watch.mint.modern = 1.8;
CONDITION_MULTIPLIERS.comic.cgc_9_8.vintage = 5.0;
CONDITION_MULTIPLIERS.comic.cgc_9_8.modern = 2.2;
```

---

### 3. Multi-Source Price Discovery
Single-source pricing fails. Triangulate across reference data, active listings, and verified sales.

**Source hierarchy:**
1. **Reference data** (PriceCharting, Beckett, PCGS) — baseline anchor
2. **Verified sold comps** (eBay sold, auction results) — realized market value
3. **Active listings** (eBay active, dealer stock) — current ask prices

**Blending logic:**
- Sold-first when available: `soldAvg × 0.6 + activeAvg × 0.4`
- Sold-only bump: `soldAvg × 1.1` (realized > ask)
- Active-only discount: `activeAvg × 0.9` (ask > realized)
- Reference sanity bounds: high/low thresholds by era

**Current implementation:**
- `api/pricecharting-pop.js` — reference data (PC scrape)
- `api/comps.js` — active listings (eBay Browse API)
- `src/lib/soldVerification.js` — sold comp verification chain
- Blending in `api/enrich.js:3200-3350`

**Universal extraction:**
```javascript
const sources = {
  reference: await fetchReferenceData(assetId),
  sold: await fetchVerifiedSales(assetId, dateRange),
  active: await fetchActiveListings(assetId)
};

const blendedPrice = computeBlendedPrice(sources, {
  soldWeight: 0.6,
  activeWeight: 0.4,
  soldOnlyBump: 1.1,
  activeOnlyDiscount: 0.9,
  sanityBounds: getSanityBounds(assetClass, era)
});
```

---

### 4. Comp Hygiene
Raw market data is contaminated. Filter aggressively before pricing.

**Filter chain (hard → soft):**
1. **Title/model mismatch** (wrong asset entirely)
2. **Reprint/replica detection** (edition mismatch)
3. **Variant contamination** (artist exclusives, limited editions when seeking standard)
4. **Format mismatch** (TPB vs floppy, box vs loose)
5. **Lot/bundle detection** (multi-item vs single)
6. **Slab mismatch** (graded vs raw, or wrong grading tier)
7. **Signed/autograph mismatch** (premium feature contamination)
8. **Grade proximity** (±2 grades for comics, ±10% condition for other)
9. **Creator/designer match** (SOFT — warn but don't exclude premium names)
10. **Price sanity** (outlier removal, ±3σ)
11. **Deduplication** (same listing ID, seller, or exact title/price)

**Current implementation:**
- `src/lib/compHygiene.js` — shared regex catalog (REPRINT_RE, SLAB_RE, SIGNED_RE, etc.)
- `api/comps.js` — active listing filter chain
- `src/lib/soldVerification.js` — sold comp filter chain
- `src/lib/premiumCreators.js` — soft creator-premium detection

**Universal extraction:**
```javascript
const FILTER_CHAIN = [
  { name: 'identity', type: 'hard', fn: filterIdentityMismatch },
  { name: 'replica', type: 'hard', fn: filterReplicas },
  { name: 'variant', type: 'hard', fn: filterVariantContamination },
  { name: 'format', type: 'hard', fn: filterFormatMismatch },
  { name: 'lot', type: 'hard', fn: filterLots },
  { name: 'condition', type: 'hard', fn: filterConditionMismatch },
  { name: 'premium', type: 'soft', fn: filterPremiumFeatures },
  { name: 'outlier', type: 'soft', fn: filterOutliers },
  { name: 'dedup', type: 'hard', fn: deduplicateListings }
];

const filteredComps = applyFilterChain(rawComps, FILTER_CHAIN, { asset, strictMode });
```

---

### 5. Scarcity Intelligence
Price without scarcity context is incomplete. Rare + demand = premium; rare + no demand = worthless.

**Scarcity metrics:**
- **Population reports** (CGC census, PCGS registry, production runs)
- **Grade distribution** (how many exist at this condition tier)
- **Scarcity ratio** (your grade / total population)
- **Sales velocity** (7d/30d/90d transaction volume)
- **Demand signals** (price trend, velocity acceleration, comp pool depth)

**Current implementation:**
- `api/pricecharting-pop.js` — CGC census scrape
- `item.pop.scarcityRatio` — grade-tier scarcity percentage
- `item.salesVelocity` — time-windowed transaction counts
- `src/lib/demandSignals.js` — demand classification (HOT/COOLING/STABLE/DEAD)

**Universal extraction:**
```javascript
const scarcity = {
  totalPopulation: await fetchPopulationData(assetId),
  gradeDistribution: getGradeDistribution(assetId, condition),
  scarcityRatio: computeScarcityRatio(condition, gradeDistribution),
  salesVelocity: await fetchSalesVelocity(assetId, windows),
  demandSignal: classifyDemand(salesVelocity, priceHistory)
};

const scarcityMultiplier = computeScarcityMultiplier(scarcity, {
  minPop: 100,      // Below this, apply scarcity premium
  maxPop: 10000,    // Above this, ignore scarcity
  velocityWeight: 0.3
});
```

---

### 6. Key/Variant Premium Logic
Certain features multiply base value. Detect from multiple signals, apply conservatively.

**Key-issue detection (comics):**
- First appearance, origin, death, first cover → ×1.5
- Second appearance, cameo, classic story → ×1.2
- Cross-source validation (ComicVine + eBay comp titles + PriceCharting notes)

**Variant detection (comics):**
- Test-market price variants (35¢, 30¢) → ×6 / ×4
- Error variants (inverted, miscut) → ×4 / ×3
- Newsstand, pence, Whitman → ×1.3 / ×1.5 / ×1.8
- Composition damping when variant ratio >50% in comp pool

**Current implementation:**
- `api/mega-keys.js` — mega-key registry (29 entries, strict canonical match)
- `src/lib/premiumCreators.js` — creator premium registry (80 tiered creators)
- Variant multiplier table in `api/enrich.js:2700-2850`
- Variant composition damping in `api/enrich.js:2850-2900`

**Universal extraction:**
```javascript
const PREMIUM_FEATURES = {
  [assetClass]: [
    { 
      pattern: /first appearance/i, 
      multiplier: 1.5, 
      sources: ['reference', 'comp_titles'], 
      minConfidence: 2 
    },
    { 
      pattern: /error/i, 
      multiplier: 3.0, 
      sources: ['comp_titles', 'visual'], 
      compositionDamp: true 
    }
  ]
};

const premiumMultiplier = detectPremiumFeatures(asset, comps, PREMIUM_FEATURES[assetClass]);
```

---

### 7. Sanity Bounds
Computed prices need guardrails. Era-aware thresholds catch hallucinations and contamination.

**Sanity check components:**
- **High threshold:** PC/reference ≤ compsAvg × threshold (prevents under-pricing rare books)
- **Low threshold:** PC/reference ≥ compsAvg × threshold (prevents over-pricing common books)
- **Era stratification:** Golden Age looser bounds (3×/0.6×) than Modern (1.5×/0.5×)
- **Skip conditions:** Mega-keys, comps exhausted (AI verify rejected 100%)

**Current implementation:**
- `computeSanityFallback()` in `api/enrich.js:550-650`
- Era-aware thresholds: Golden <1970 → 3×/0.6×, Silver/Bronze <1985 → 1.75×/0.6×, Modern → 1.5×/0.5×
- Comparison base: `sanityCompsAvg = compsAvg` (RAW — eBay already reflects market grade)

**Universal extraction:**
```javascript
const SANITY_THRESHOLDS = {
  [assetClass]: {
    [era]: {
      high: multiplier,   // Max allowed PC/ref vs comps
      low: multiplier     // Min allowed PC/ref vs comps
    }
  }
};

// Example:
SANITY_THRESHOLDS.comic.golden = { high: 3.0, low: 0.6 };
SANITY_THRESHOLDS.comic.modern = { high: 1.5, low: 0.5 };
SANITY_THRESHOLDS.watch.vintage = { high: 2.5, low: 0.7 };
SANITY_THRESHOLDS.watch.modern = { high: 1.8, low: 0.8 };
```

---

### 8. Floor Guards
Never price below verifiable minimum. Multiple floor types protect against underpricing.

**Floor types:**
1. **Raw floor** — lowest verified comp, capped at compsAvg
2. **Low-grade floor** — when census shows zero books graded below yours, anchor to lowest comp
3. **Thin-pool anchor** — when <3 comps, cap at highest comp × 1.05
4. **Mega-key floor** — grade-specific floor map for established high-value keys

**Current implementation:**
- Raw floor: `rawComps.lowest` (no grade multiplier — eBay already reflects market grade)
- `computeLowGradeFloor()` in `api/enrich.js:413-425` (Ship #17)
- `computeThinPoolAnchor()` in `api/enrich.js:290-320` (Ship #13.1)
- `getMegaKeyFloor()` in `api/mega-keys.js`

**Universal extraction:**
```javascript
const floors = {
  raw: computeRawFloor(verifiedComps),
  scarcity: computeScarcityFloor(census, condition),
  thinPool: computeThinPoolFloor(verifiedComps, maxMultiplier),
  registry: lookupRegistryFloor(assetId, condition)
};

const enforcedFloor = Math.max(...Object.values(floors).filter(Boolean));
const finalPrice = Math.max(computedPrice, enforcedFloor);
```

---

### 9. Decision Engine
Pricing alone is insufficient. Recommend action with accountability.

**Decision types:**
- **ID_REQUIRED** — identity fields incomplete, identity conflict detected
- **DO_NOT_LIST** — hard blockers (manual review required, reprint with no comps, catastrophic overprice)
- **RESEARCH** — critical warnings (sold/active mismatch, thin Golden Age pool, active avg far below sold)
- **GRADE_CANDIDATE** — grading upside (price ladder shows 2×+ uplift)
- **LIST_LOW** — moderate warnings (thin pool, variant contamination, reprint/polybag with comps)
- **LIST_NOW** — clean identification and pricing, ready to list

**Confidence tiers:**
- **HIGH** — verified exact match, ≥3 comps, Vision confidence not low
- **MEDIUM** — similar matches, 2 comps OR Vision capped
- **LOW** — 0-1 comps OR AI estimate only

**Current implementation:**
- `src/lib/decisionEngine.js` — computeDecision() (Ship v0-D, v0-D.1)
- Blockers, warnings, next steps all surfaced
- Gates eBay listing actions (soft gate with user override)

**Universal extraction:**
```javascript
const decision = computeDecision(asset, {
  price,
  confidence: matchConfidence,
  scarcity,
  demandSignal,
  warnings,
  blockers
});

// Returns:
{
  action: 'LIST_NOW' | 'RESEARCH' | 'DO_NOT_LIST' | ...,
  confidence: 'high' | 'medium' | 'low',
  reason: string,
  blockers: string[],
  warnings: string[],
  nextSteps: string[]
}
```

---

### 10. Match Confidence Scoring
How well do comps match the identified asset? Separate from Vision confidence.

**Scoring components (max 100 points):**
- Title match: 20 points (exact substring) or 14 points (≥50% token overlap)
- Issue/model match: 20 points (exact match)
- Year match: 15 points (exact year in listing)
- Variant match: 20 points (first 15 chars substring)
- Creator/designer match: 15 points
- Print/edition alignment: 10 points

**Tier assignment:**
- 0 comps → LOW (score 0, "No eBay comps found")
- 1 comp → LOW (score ≤60, "Only 1 comp found")
- 2 comps → MEDIUM max (score ≤75, "Limited comps")
- 3+ comps → full scoring (HIGH ≥80, MEDIUM 65-79, LOW <65)

**Vision confidence cap:**
- Vision LOW + Match HIGH → Match MEDIUM (score ≤75)
- Vision LOW + Match MEDIUM → Match MEDIUM (flagged)
- Vision MEDIUM + Match HIGH → Match HIGH (flagged)

**Current implementation:**
- `computeMatchConfidence()` in `api/comps.js:376-456`
- Vision cap logic in `api/enrich.js:3920-3942`
- Era-filter bypass cap in `api/enrich.js:3944-3960`

**Universal extraction:**
```javascript
const matchConfidence = computeMatchConfidence(verifiedComps, {
  asset,
  visionConfidence,
  minCompsForHigh: 3,
  scoringWeights: {
    identity: 40,    // Title + Issue/Model
    metadata: 35,    // Year + Variant
    features: 25     // Creator + Edition
  }
});
```

---

## AssetCore Interface (Future Extraction)

```javascript
// Generic asset pricing engine
class AssetCore {
  constructor(config) {
    this.assetClass = config.assetClass;  // 'comic', 'watch', 'card', 'sneaker', etc.
    this.schemas = config.schemas;         // Identity field definitions
    this.multipliers = config.multipliers; // Condition/era multiplier tables
    this.filters = config.filters;         // Comp hygiene filter chain
    this.sources = config.sources;         // Reference/sold/active data sources
  }

  async price(asset) {
    // 1. Sanitize and validate identity
    const identity = this.sanitizeIdentity(asset);
    const identityConfidence = this.assessIdentityConfidence(identity);
    
    if (identityConfidence.confident === false) {
      return { decision: 'ID_REQUIRED', blockers: identityConfidence.missing };
    }

    // 2. Fetch multi-source data
    const [reference, sold, active] = await Promise.all([
      this.fetchReferenceData(identity),
      this.fetchSoldComps(identity),
      this.fetchActiveListings(identity)
    ]);

    // 3. Apply comp hygiene
    const filteredSold = this.applyFilterChain(sold, identity, 'sold');
    const filteredActive = this.applyFilterChain(active, identity, 'active');

    // 4. Compute blended price
    const basePrice = this.computeBlendedPrice({
      reference,
      sold: filteredSold,
      active: filteredActive
    });

    // 5. Apply condition multiplier
    const conditionMultiplier = this.getConditionMultiplier(
      asset.condition,
      identity.era
    );
    let price = basePrice * conditionMultiplier;

    // 6. Apply premium features
    const premiumMultiplier = this.detectPremiumFeatures(
      asset,
      [...filteredSold, ...filteredActive]
    );
    price *= premiumMultiplier;

    // 7. Sanity check
    const sanityResult = this.checkSanity(price, {
      reference,
      compsAvg: this.average([...filteredSold, ...filteredActive]),
      era: identity.era
    });
    if (sanityResult.triggered) price = sanityResult.fallback;

    // 8. Floor guard
    const floor = this.computeFloor({
      comps: [...filteredSold, ...filteredActive],
      census: await this.fetchCensus(identity),
      condition: asset.condition
    });
    price = Math.max(price, floor);

    // 9. Match confidence
    const matchConfidence = this.computeMatchConfidence(
      [...filteredSold, ...filteredActive],
      { asset, visionConfidence: asset.visionConfidence }
    );

    // 10. Decision
    const decision = this.computeDecision({
      price,
      confidence: matchConfidence,
      warnings: this.collectWarnings({ sanityResult, floor, comps }),
      blockers: this.collectBlockers({ identity, comps })
    });

    return {
      price,
      decision,
      confidence: matchConfidence,
      diagnostics: {
        reference,
        sold: filteredSold.length,
        active: filteredActive.length,
        conditionMultiplier,
        premiumMultiplier,
        floor
      }
    };
  }
}

// Usage:
const comicEngine = new AssetCore({
  assetClass: 'comic',
  schemas: COMIC_IDENTITY_SCHEMA,
  multipliers: COMIC_MULTIPLIERS,
  filters: COMIC_FILTER_CHAIN,
  sources: COMIC_DATA_SOURCES
});

const result = await comicEngine.price({
  title: 'Amazing Spider-Man',
  issue: '1',
  publisher: 'Marvel',
  year: 1963,
  condition: 'VG 4.0',
  visionConfidence: 'high'
});

console.log(result.price);      // $12,500
console.log(result.decision);   // { action: 'GRADE_CANDIDATE', confidence: 'high', ... }
```

---

## Migration Path (Layer 4)

### Phase 1: Extract Pure Functions
Move all non-comic-specific logic into `src/lib/assetCore/`:
- `identity.js` — sanitization, validation, confidence assessment
- `conditions.js` — multiplier tables, era detection, grade normalization
- `comps.js` — filter chain, hygiene regex, dedup
- `pricing.js` — blending, sanity, floors, premium detection
- `confidence.js` — match scoring, tier assignment, Vision capping
- `decision.js` — action recommendation, blocker/warning collection

### Phase 2: Parameterize Comic-Specific Logic
Replace hardcoded comic assumptions:
- `'title' | 'issue' | 'publisher'` → generic `primaryId | secondaryId | manufacturer`
- `CGC_MULTIPLIERS` → `CONDITION_MULTIPLIERS[assetClass]`
- `TEST_MARKET_VARIANTS` → `PREMIUM_FEATURES[assetClass]`
- `MEGA_KEYS_SCHEMA` → `KEY_REGISTRY[assetClass]`

### Phase 3: Build Asset Adapters
Create asset-specific config files:
- `assetCore/adapters/comic.js` — Comic-specific schemas, multipliers, filters
- `assetCore/adapters/watch.js` — Watch-specific config
- `assetCore/adapters/card.js` — Trading card config
- etc.

### Phase 4: Deploy AssetCore as Standalone Package
Publish to npm as `@comicvault/asset-core`:
```bash
npm install @comicvault/asset-core
```

```javascript
import { AssetCore } from '@comicvault/asset-core';
import { comicAdapter } from '@comicvault/asset-core/adapters/comic';

const engine = new AssetCore(comicAdapter);
const result = await engine.price(asset);
```

---

## Key Design Decisions

### Why Identity-First?
Wrong identification is catastrophic. A $5 book priced as a $5000 key destroys trust. Gate all pricing behind identity confidence.

### Why Multi-Source Triangulation?
Single sources lie. PriceCharting lags. eBay active inflates. Only verified sold comps show realized value. Blend all three.

### Why Era-Aware Multipliers?
Modern book grading is saturated (CGC 9.8 is 40% of census). Vintage grading is scarce (CGC 9.8 is <1% of census). Same multiplier for both eras over-values modern, under-values vintage.

### Why Comp Hygiene First?
One contaminated comp (reprint, variant, lot) can skew the average by 50-300%. Filter before pricing, not after.

### Why Conservative Floor Guards?
Under-pricing is safer than over-pricing. A user can raise their price after listing. A buyer can't un-buy an over-priced book they already purchased.

### Why Separate Match Confidence from Vision Confidence?
Vision can confidently identify the wrong book (hallucination). Match confidence scores how well comps align with the IDENTIFIED book, not whether the identification was correct. Both signals needed.

### Why Decision Engine over Raw Pricing?
"Here's a price" is incomplete. "List now at $88 because 24 verified comps and HOT demand" is actionable. Users need recommendations with accountability.

---

## Performance Optimizations Applied

1. **Parallel data fetching** — ComicVine volume details (Ship #20a.6.16), all Phase 1 enrichment sources
2. **24-hour caching** — PriceCharting scrapes (pop + sales-history share same cache key)
3. **Short-circuit logic** — Skip sanity/floor when mega-key or compsExhausted
4. **Prompt caching** — Claude API system prompts cached (5-min TTL, 90% cost reduction)
5. **Progressive disclosure** — UI collapses expensive-to-render sections (price ladder, sales velocity, creator credits)

---

## Test Coverage Strategy

**Unit tests:**
- Pure functions (sanitize, validate, filter, blend, multiply)
- Edge cases (null/undefined, empty arrays, division by zero)
- Regex patterns (REPRINT_RE, SLAB_RE, etc.)

**Integration tests:**
- Multi-source fetching (mock API responses)
- Filter chain ordering (hard → soft sequence)
- Pricing stack (PC → multiplier → sanity → floor → variant → key)

**Regression tests:**
- Pattern classes (Sinful Suzie, Thor #4, Howard Duck Magazine, etc.)
- 8-card validation set (Wolverine #8, Batman #59, etc.)
- Historical bugs (B&B #28 polybag, Thanos #11 wrong-issue, etc.)

**Current coverage:**
- 1,570 tests passing
- 23 test suites
- Behavioral specs in `tests/` directory

---

## Known Limitations

1. **No international market data** — eBay US only, no European/Asian sources
2. **No auction results** — Heritage, ComicLink not integrated (eBay-only)
3. **No seller reputation weighting** — All eBay sellers treated equally
4. **No time-decay on sold comps** — 90-day window but no recency weighting
5. **No machine learning** — All logic rule-based, no predictive models
6. **No cross-asset comp borrowing** — Can't price Action #1 from Superman #1 comps

---

## Future Enhancements (Layer 4+)

1. **Portfolio-level intelligence** — Cross-asset correlation, diversification scoring
2. **Market timing signals** — Optimal list timing (holiday bump, movie release correlation)
3. **Buyer personas** — Price differently for collectors vs flippers vs investors
4. **Dynamic multipliers** — Learn from realized sales instead of static tables
5. **Cross-category comp borrowing** — Use Fantastic Four #1 comps to inform Fantastic Four #2 pricing when direct comps thin
6. **Authenticity scoring** — Visual forgery detection, census validation against known fakes

---

## Related Documentation

- `CLAUDE.md` — Project overview and current state
- `docs/ROADMAP.md` — Intelligence Layer roadmap (Ships #24-27)
- `docs/NEXT_SESSION.md` — Next session priorities
- `docs/validation/PHASE_1_REGRESSION_SET.md` — 8-card validation baseline
- `tests/` — Behavioral test suite

---

**Universal Asset Intelligence Status:** Schematic complete, extraction queued for Layer 4 (Portfolio OS)
