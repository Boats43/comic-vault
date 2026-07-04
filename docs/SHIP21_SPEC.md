# Ship #21 — Trust Core UI (Context-Loss Insurance)

**Session:** 2026-07-04 ROUND 3D → Ship #21 handoff  
**Status:** 21a complete (9c960be), 21b-21j queued  
**Protocol:** Multi-item ship specs written to docs/ BEFORE build starts (context-loss insurance, Ship #21 lesson)

---

## Rule 21-0 (applies to ALL 21a-21j)

**Three-state rendering — no section ever renders blank:**

1. **DATA state:** Value + source tag (eBay sold / PC / CGC / AI / CV)
2. **NO-DATA state:** Explicit text (e.g., "No CGC census data", "Creator not detected")
3. **CONFLICT state:** Value + warning flag

**Scope:** UI layer only — zero pricing logic edits across all items.

---

## 21a [RENDER BUG] — CGC Population Dropdown ✅ COMPLETE

**Commit:** `9c960be` (pushed 2026-07-04)

**Issue:** Dropdown rendered EMPTY while Total=4,485 showed in header AND PC-TRACKED CGC POP panel below rendered same data fine.

**Root cause:** Schema mismatch
- Dropdown expected CGC API fields: `universal`, `graded`, `restored`, `signature`
- PC pop structure has: `cgc` array, `byGrade` object, `atGrade`, `aboveGrade`, `belowGrade`, `scarcityRatio`, `userBucket`
- Fields don't exist → dropdown empty, panel works (uses `cgc` array)

**Fix (Rule 21-0 compliant):**
1. When `pop.universal` exists → render CGC API breakdown (unchanged)
2. When `pop.byGrade` exists → render "📊 PC-tracked census — see histogram below"
3. Else → render "No CGC census data available"

**Evidence:** Wolverine #8 + Eternals #10 cards

---

## 21b [DATA BUG] — Creator Credits Null Name

**Issue:** CREATOR CREDITS section renders "(artist)" with null name while the SAME creator (John Buscema / Jack Kirby) appears correctly in "DETECTED IN COMPS → CREATORS" section.

**Investigation required:**
1. Trace CREATOR CREDITS data binding (likely `item.comicVine.personCredits` or similar)
2. Trace DETECTED IN COMPS → CREATORS data binding (likely `item.creatorFromComps`)
3. Identify why one source has name, other doesn't

**Fix options:**
- Unify sources (prefer comp-detected creators when CV returns null name)
- OR render "Creator not detected" per Rule 21-0 when name is null

**Evidence:** Wolverine #8, Eternals #10 — same creator appears in one section, null in other

---

## 21c [UI] — Story Truncation + Expand Control

**Issue:** STORY section truncates with no expand control. Full text is stored but user cannot access it.

**Fix:** 
- Render 3 lines (CSS `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;`)
- Add "…more" expand/collapse toggle below truncated text
- Toggle state shows full text, changes to "less" to collapse

**Implementation note:** Use local component state for expand/collapse, preserve across card re-renders

---

## 21d [FEATURE — TRUST CORE] — All Rejected Comps Visible

**Issue:** Rejected comps currently show top-3 only in diagnostics. Full rejection data exists in `soldVerifyResult.diagnostics.rejectedSamples` but not surfaced.

**Fix:**
- Show ALL rejected comps with reason tags (lot/multi-issue, cross-series, gradeMismatch, stale, outlier, etc.)
- Collapsed by default (new expandable section)
- Expandable with click
- Data source: `item.soldCompDiagnostics.rejectedSamples` (already in response)

**Display format:**
```
REJECTED COMPS (N)  ▶
  [When expanded]
  • Title snippet | $XX.XX | reason: lot
  • Title snippet | $XX.XX | reason: gradeMismatch
  • Title snippet | $XX.XX | reason: stale
  ...
```

**Rule 21-0:** When `rejectedCount === 0`, render "All comps verified (0 rejected)"

---

## 21e [FEATURE — DERIVATION TRACE] — Price Build Visibility

**Issue:** Price derivation is opaque. Log data exists (`[price-trace]` logs) but not surfaced to UI.

**Fix:** Surface complete price derivation chain as new card section:
```
PRICE DERIVATION
  PC base: $45.00 (PriceCharting VF)
  × Grade mult: 0.85 (VF raw modern)
  = PC adjusted: $38.25

  Sold avg: $42.00 (24 verified, 2d recency) ✓
  Active avg: $51.00 (30 comps, 0h cache)
  → Blend (60/40): $45.60

  Floor guard: $39.00 (lowest ask)
  = Final: $45.60
```

**Data sources (all exist in `item`):**
- PC base: `item.priceCharting.price`
- Grade mult: `item.gradeMultiplier`
- Sold avg: `item.soldCompsAvg`, count from `item.soldCompDiagnostics.verifiedCount`
- Active avg: `item.comps.average`
- Blend: calculation visible in logs, not currently surfaced as field
- Floor: `item.rawComps.lowest` or `item.rawComps.gradeFilteredLowest`
- Final: `item.price`

**Implementation note:** New section, collapsed by default, expandable. Each line shows value + source tag.

**Rule 21-0:** When no pricing data exists, render "Price derivation unavailable (identity incomplete)"

---

## 21f [FEATURE — PROVENANCE LINE] — Identity + Filter Audit Trail

**Issue:** Identity source and comp filtering invisible to user.

**Fix:** Add identity provenance line showing:
1. Source: `vision` / `weighted-consensus (N members)` / `top-rank-protection`
2. Q32 asset check result (if ran): `✓ comic confirmed` / `⚠ book detected`
3. Filter summary: `"30 comps → 21 verified: 3 annual, 2 lot, 4 gradeMismatch..."`

**Data sources:**
- Identity source: `item.identityAlignment.confirmedSource` or `item.identitySource`
- Asset check: `item.assetType` (when === 'book', show warning)
- Filter summary: `item.soldCompDiagnostics.reasons` object (counts per rejection type)

**Display format:**
```
📋 Identity: vision | ✓ comic confirmed | 30→21 verified (3 annual, 2 lot, 4 gradeMismatch)
```

**Rule 21-0:** Always render (identity source always exists post-Phase-1)

---

## 21g [FLAG] — Price Ladder Monotonicity Warning

**Issue:** Non-monotonic grade ladders mislead users (e.g., 9.6 $186 < 9.4 $150 inversion, or 9.6 $29.85 < 9.4 $38).

**Fix:** Detect inversions in `item.priceLadder` and render inline warning at affected grade.

**Detection logic:**
```javascript
// For each grade in ladder, check if price < previous grade's price
const grades = Object.keys(priceLadder).map(parseFloat).sort((a,b) => a-b);
for (let i = 1; i < grades.length; i++) {
  if (priceLadder[grades[i]] < priceLadder[grades[i-1]]) {
    // Inversion detected at grades[i]
  }
}
```

**Display:** Inline flag next to affected grade: `9.6: $29.85 ⚠ thin data at 9.4-9.6`

**Rule 21-0:** Only render when inversion detected (no "no inversions" message)

---

## 21h [FEATURE] — Data Freshness Line

**Issue:** Cache staleness invisible to user.

**Fix:** Show cache ages + sold data recency:
```
📅 Comps: 0h · PC: 3h · Sold data: 2d recency
```

**Data sources:**
- Comps cache age: `item.compsCachedAt` timestamp → convert to hours ago
- PC cache age: `item.priceCharting` cached timestamp (if surfaced) → hours ago
- Sold recency: median or newest `item.soldComps[0].daysAgo` → "Nd ago" or "Nd recency"

**Display format:** Single line below stats bar, muted color

**Rule 21-0:** Render "Cache age unavailable" when timestamps missing

**Implementation note:** Compute hours ago via `Math.floor((Date.now() - timestamp) / 3600000)`

---

## 21i [STORY POLLUTION] — Foreign Reprint Suppression

**Issue:** "Translates: Wolverine #08, Excalibur #06" = foreign reprint-volume metadata passing story gate.

**Root cause:** Q35 class — suppression checked publisher mismatch, not edition type.

**Investigation required:**
1. Verify CV volume type on Wolverine #8 record (likely `volume.type === 'translation'` or similar)
2. Check current story suppression logic in `api/enrich.js` (lines 906-973)

**Fix:** Add volume-type check to story suppression gate:
```javascript
// After existing publisher/title checks (line 925)
const isForeignEdition = volDetail?.type && /translation|foreign/i.test(volDetail.type);

if (isBorderline || isForeignEdition) {
  // Suppress story fields
  description = null;
  deck = null;
  
  if (isForeignEdition) {
    storySuppressedReason = 'foreign-edition';
  } else if (nameScore < 75) {
    // ... existing reasons
  }
}
```

**Rule 21-0:** Render "No story data" when suppressed (existing fallback generation already compliant)

**Evidence:** Wolverine #8 Eternals #10 cards show foreign metadata in story field

---

## 21j [DEMAND FIELD] — Dynamic Computation from Sold Data

**Issue:** DEMAND/TREND/SPEED fields display static "LOW/Flat/Slow" while sold data shows 22 fresh solds in 30 days.

**Root cause:** Fields exist but not dynamically computed from `soldVerifyResult` data.

**Fix (display layer only, zero pricing impact):**

### DEMAND (from fresh sold count)
```javascript
const freshSolds = (item.soldComps || []).filter(s => s.recencyBand === 'fresh').length;
const demand = freshSolds >= 15 ? 'HIGH' : freshSolds >= 5 ? 'MEDIUM' : 'LOW';
```

### TREND (from fresh vs stale avg delta)
```javascript
const freshAvg = average(soldComps.filter(s => s.recencyBand === 'fresh').map(s => s.price));
const staleAvg = average(soldComps.filter(s => s.recencyBand !== 'fresh').map(s => s.price));
const trend = freshAvg > staleAvg * 1.2 ? 'Rising' 
            : freshAvg < staleAvg * 0.8 ? 'Falling' 
            : 'Flat';
```

### SPEED (from median days-between-solds)
```javascript
// Sort soldComps by daysAgo, compute gaps between consecutive sales
const gaps = []; // array of day-gaps
const medianGap = median(gaps);
const speed = medianGap <= 7 ? 'Fast' : medianGap <= 30 ? 'Moderate' : 'Slow';
```

**Data source:** All data in `item.soldComps` array (each has `daysAgo`, `price`, `recencyBand`)

**Display location:** Existing DEMAND/TREND/SPEED section (replace static values with computed)

**Rule 21-0:** When `soldComps.length === 0`, render "No sold data" instead of LOW/Flat/Slow

**Evidence:** Wolverine #8 has 22 fresh solds, should show DEMAND=HIGH

---

## GATES (All 21a-21j)

**Test scans:** Wolverine #8 + Eternals #10 card re-render

**Success criteria:**
1. ✅ Zero blank card sections (Rule 21-0 compliance)
2. ✅ Story field clean (no foreign metadata pollution)
3. ✅ DEMAND=HIGH on Wolverine #8 (22 fresh solds)
4. ✅ All three rendering states demonstrable (DATA+source / NO-DATA / CONFLICT)

---

## QUEUE AFTER SHIP #21

### C-Block (cleanup sweep)
- Q41: priceOverridden typo (`overriden` → `overridden`)
- Q50b: `.match()` → `.matchAll()` loop-all pattern
- Q52: Thor #235 sold-fetch investigation (RESEARCH on empty pool)
- Arc-word residual cleanup
- `counter → finally` pattern audit
- Dead imports removal

### Docs: SOLD_BLEND_DESIGN.md (#20b)
**Requires greenlight before implementation**

**Content:**
- Exhibits A-F (real-world blend behavior, includes Wolverine #8 Exhibit F logged 20:27)
- Projected prices for 10 exhibit books:
  1. Batman #222
  2. Batman #423
  3. Wolverine #8
  4. House & Whipple #1
  5. Punisher #1
  6. Venom #1
  7. Fantastic Four #96
  8. Fantastic Four #135
  9. Black Panther #1
  10. Eternals #10

**Status:** Design doc write-up, NOT implementation (pricing math requires greenlight)

---

## CONTEXT-LOSS INSURANCE

**Standing rule added to CLAUDE.md (commit 4270495):**

> Multi-item ship specs must be written to docs/ BEFORE build starts (context-loss insurance). Ship #21 lesson.

**This document:** Preserves 21a-21j specifications across session boundaries. Fresh context can execute 21b-21j without re-discovery.

---

**END SPEC**
