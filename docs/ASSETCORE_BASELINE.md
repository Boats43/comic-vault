# AssetCore Extraction — Baseline Snapshot

**Date:** 2026-06-05  
**Last commit before extraction:** `dc63e88 fix: clustering — lower overlap threshold to 1 for pre-1970 Silver Age titles`

## Current State

### Test Suite
- **Total tests:** 38
- **Passing:** 35
- **Failing:** 3 (pre-existing, unrelated to AssetCore work)

### Pre-existing Test Failures
1. **identity-gate.test.js** — Issue: "Annual 1" string not being nulled by sanitizer
2. **priceBands.test.js** — Price bands calculation edge cases
3. **sold-verification.test.js** — Sold comp verification filter chain

**Baseline requirement:** Any extraction step must maintain ≥35 passing tests.

---

## App.jsx Function Map

### Comic-Specific Functions (NOT extraction candidates)
- `gradeComic` — Claude Vision comic grading (comic covers only)
- `handleList` — eBay listing creation (comic-specific title formatting)
- `FloatingSearchBar` — comic collection UI component
- `ResultCard` — comic display card
- `CollectionDetail` — comic detail view

### Universal Asset Functions (Extraction candidates)
- Database operations (`db.js` wrapper calls) — all generic
- Merge logic (5 client merge paths) — generic field updates
- Auto-refresh logic — generic staleness check
- Bulk import field mapping — generic CSV→object transform

**Note:** App.jsx merge paths are HIGH RISK for extraction — every field plumbed through 8 codepaths. Touch last.

---

## api/enrich.js Function Map

### Comic-Specific (NOT extraction candidates)
- `lookupComicVine` — ComicVine API integration (comics only)
- `TEST_MARKET_VARIANTS` — Marvel 30¢/35¢ allowlists (comic-era specific)
- `CGC_MULTIPLIERS` / `RAW_MULTIPLIERS` — grading tables (comic grading)
- `COMP_KEY_PATTERNS` — comic key-issue detection regex

### Universal Candidates (Can extract to AssetCore)
- `computeSanityFallback` — pricing sanity check (pure math, era-aware)
- `computeThinPoolAnchor` — thin-pool safety cap (pure math)
- `computeLowGradeFloor` — low-grade floor anchor (pure math)
- `verifyCompsTitles` — AI title verification (generic LLM call)
- `median` — statistical helper (pure)
- `fmtUsd` — currency formatter (pure)
- `getEra` — era detection (year→vintage/modern, generic)
- Floor enforcement logic (lines 3480-3496)
- Variant multiplier logic (lines 3506-3670) — WAIT, has comic-specific allowlists
- Key multiplier logic (lines 3680-3750) — WAIT, has comic-specific patterns

### Mixed (Needs separation)
- Pricing pipeline (lines 3150-3900) — core math is universal, variant/key logic is comic-specific
- Match confidence (delegated to `computeMatchConfidence` in comps.js)
- Decision engine integration (lines 4671-4733) — already extracted to `decisionEngine.js`

---

## Current Architecture Debt

1. **Pricing math embedded in handler** — sanity, floor, anchor logic lives inside 200-line enrich handler
2. **Merge path fragility** — 8 codepaths (5 in App.jsx, 3 in enrich.js) must sync field names
3. **No separation between core + domain** — comic-specific test-market logic mixed with universal pricing math
4. **Decision engine partially extracted** — `computeDecision` is pure, but integration still coupled

---

## Performance Baseline (Buyer Mode)

**Targets (from production logs):**
- `total_ms`: ~2500ms average (66% improvement from 7500ms baseline)
- `claude_check_ms`: varies by check mode
- `phase2_start`: should fire on every scan (0% skip rate)

**Stop condition:** Any metric regresses >20% during extraction.

---

## Known Issues Pre-Extraction

### Session 3A Bug Queue (Deferred)
1. **Recommended price below floor** — UI reading `rawComps.average * 1.15` instead of `decision.price`
2. **Confidence=high on browse_api** — Decision engine v1-C gate missing `pricingSource === 'browse_api'` condition
3. **Story suppression nulls description** — Borderline CV matches leave description null (Session 3A.1 fixing)

### Identity Fields
- `confirmedYear` / `confirmedTitle` / `confirmedPublisher` drive pricing but decision engine reads `out.year` / `out.title` / `out.publisher`
- Normalization happens at line 4700-4728 (post-pricing, pre-decision)

---

## Extraction Readiness

**GREEN:**
- Test suite stable (35/38 passing)
- Pure helpers identified (`computeSanityFallback`, `computeThinPoolAnchor`, `computeLowGradeFloor`)
- Decision engine already extracted (partial)

**YELLOW:**
- Pricing pipeline still monolithic (200+ lines, mixed concerns)
- Variant/key multipliers have comic-specific allowlists embedded
- Merge paths fragile (8 codepaths to keep in sync)

**RED:**
- App.jsx merge logic — HIGH RISK, touch last
- No rollback plan for partial extractions (requires atomic steps)

---

## Next Steps (Session 3A.1+)

1. ✅ Lock baseline (this file)
2. ✅ Define stop conditions (`ASSETCORE_STOP_CONDITIONS.md`)
3. ✅ Plan extraction sequence (`ASSETCORE_EXTRACTION_SEQUENCE.md`)
4. 🔄 Fix story suppression fallback (Session 3A.1 in-flight)
5. ⏳ Extract pricing helpers to `src/lib/pricingEngine.js` (Step 1)
6. ⏳ Audit decision engine completeness (Step 2)
7. ⏳ Extract identity pipeline (Step 3)
8. ⏳ Define AssetCore interface (Step 4)
9. ⏳ Build ComicAdapter (Step 5)
