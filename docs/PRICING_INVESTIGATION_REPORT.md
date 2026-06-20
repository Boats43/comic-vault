# COMIC VAULT PRICING INVESTIGATION REPORT
**Date:** 2026-06-20  
**Session:** Investigation only — NO CODE CHANGES  
**Protocol:** Investigation-first (CLAUDE.md rule)

---

## ISSUE 1 — 30-day average blends sold + active
**Priority:** HIGH  
**Status:** ROOT CAUSE IDENTIFIED

### Current Behavior
The "30-day average" field shown in UI (`item.comps.averageNum`) comes from `rawComps.average`, which is computed from **active eBay Browse API listings only** (not sold comps).

However, the pricing engine ALSO computes `blendedAvg = soldAvg × 0.6 + activeAvg × 0.4` which DOES blend sold + active data, but this blended value is used internally for pricing calculations and NOT surfaced to the UI as the "30-day average" field.

### Files & Lines
**api/enrich.js**
- **Lines 2340-2356**: `blendedAvg` computation
  - `soldAvg` from PriceCharting sales-history scrape (Ship #20a)
  - `activeAvg = rawComps?.average` (eBay Browse API active listings)
  - Blends 60% sold + 40% active
  - Used internally for `priceBands`, `sanityFallback`, `keyMultiplier` base

- **Lines 3476-3477**: `rawComps` surfaced to UI
  ```javascript
  average: rawComps.averageFormatted,
  averageNum: rawComps.average,
  ```
  This is the field displayed as "30-day average" in the UI — but it's ONLY active listings.

**api/comps.js**
- **Lines 900-950** (approx): `rawComps.average` computed from Browse API results
  - `average = prices.reduce((sum, p) => sum + p, 0) / prices.length`
  - These are ACTIVE listing prices (not sold)

**src/App.jsx**
- **Line 1052-1055**: "30-day average" label displays `comps.averageNum`
- **Line 4343-4344**: Same field displayed in CollectionDetail

### Required Behavior
"30-day average" should display the **sold comps average** (from PriceCharting sales-history), NOT active listing prices.

Active listings should be labeled separately as "Active floor" / "Active range" for reference only.

### Evidence
- **Batman #222**: sold=$62, active=$205-395, UI showed $310 as "30-day average" (wrong — this is active avg)
- **Tomb of Dracula #42**: sold=$10 (3 comps), UI showed $18.54 as "30-day average" (likely active avg or blended)

### The Fix (NOT IMPLEMENTED YET)
1. Surface `soldAvg` from enrich.js (line 2344-2346) to `out.soldCompsAvg`
2. Update UI to display `soldCompsAvg` as "30-day average"
3. Keep `rawComps.average` but relabel as "Active avg" or hide it (reference only)

### Effort
**SMALL** — 30 minutes
- Add one field to enrich response (`out.soldCompsAvg = soldAvg`)
- Update 2 UI locations (ResultCard line 1052, CollectionDetail line 4343)
- Relabel existing `averageNum` field or hide it

### Risk
**LOW** — Display-only change
- Pricing math unchanged (already uses `soldAvg` internally)
- Affects only UI labels
- No comp filter changes
- No decision engine changes

### Dependencies
None — standalone fix

### Ready to Ship
**YES** (after report review + user approval)

---

## ISSUE 1B — KISS comp contamination (Beatles card)
**Priority:** HIGH  
**Status:** ROOT CAUSE IDENTIFIED

### Current Behavior
**Beatles Personality #1** card pulled a **KISS comp** (same publisher "Personality Comics 1991", different title).

The title similarity filter (Filter 0c) uses `hasSufficientTitleOverlap()` which requires ≥50% token overlap. "Beatles" vs "KISS" both share the publisher name tokens but have NO title overlap.

### Files & Lines
**api/comps.js**
- **Lines 797-807**: Title similarity filter (Filter 0c)
  ```javascript
  const titleThreshold = assetType === 'book' ? 0.3 : 0.5;
  p = p.filter((it) => hasSufficientTitleOverlap(it.title, searchTokens, titleThreshold));
  ```

**src/lib/compHygiene.js** (imported from comps.js)
- **Lines 80-120** (approx): `hasSufficientTitleOverlap()` implementation
  - Tokenizes both titles
  - Removes stop words ("the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "with", "comic", "comics", "comicbook", "issue", "volume", "vol", "marvel", "dc", "image", "dark", "horse", "idw")
  - Computes overlap: `ourTokensInListing.length / ourTokens.length >= threshold`
  - Returns `true` when all our tokens are stop-words (so other filters take over)

### The Problem
When the title is mostly stop-words OR when publisher name appears in both titles but actual title words differ, the filter passes contamination.

**Beatles Personality #1**:
- Tokens: "beatles", "personality"
- KISS listing: "KISS Personality Comics"
  - Tokens: "kiss", "personality"
  - Overlap: "personality" = 1/2 tokens = 50% → PASSES filter

### Required Behavior
Title similarity filter must reject comps where the core title differs even if publisher/format words match.

One solution: require BOTH:
1. Token overlap ≥50% (current rule)
2. At least ONE non-stop-word token from the original title appears in the listing

This would catch "Beatles" ≠ "KISS" (zero non-stop-word overlap).

### Effort
**MEDIUM** — 1-2 hours
- Modify `hasSufficientTitleOverlap()` to check for at least one core token match
- Add test cases for cross-title contamination
- Verify no regressions on legitimate matches (variants, subtitles, etc.)

### Risk
**MEDIUM** — Comp filter chain change
- Could over-filter legitimate matches if threshold too strict
- Need to test on existing catalog to measure impact
- May need to adjust threshold dynamically based on title length

### Dependencies
None

### Ready to Ship
**NO** — Needs design discussion
- What's the right rule: "at least 1 core token" or "at least 2 core tokens for multi-word titles"?
- Should we special-case single-word titles like "KISS" vs "Beatles"?

---

## ISSUE 2 — CGC candidate detection missing
**Priority:** MEDIUM  
**Status:** ROOT CAUSE IDENTIFIED

### Current Behavior
Decision engine has `GRADE_CANDIDATE` action but the detection logic is incomplete.

**src/lib/decisionEngine.js**
- **Lines 441-465**: GRADE_CANDIDATE detection
  ```javascript
  if (item.price > 100 && !item.isGraded && item.priceLadder) {
    const ladder = item.priceLadder;
    const ladderKeys = Object.keys(ladder).map(k => parseFloat(k)).sort((a, b) => b - a);
    const highestGradeFmv = ladder[ladderKeys[0]];

    if (highestGradeFmv && highestGradeFmv > item.price * 2) {
      decision.action = 'GRADE_CANDIDATE';
      // ...
    }
  }
  ```

### The Problem
1. **Threshold too high**: requires `item.price > 100` — many grading opportunities are in the $50-100 range
2. **Only checks highest grade**: compares raw price to 9.8 FMV, but misses the typical grading target (user's current grade + 1-2 steps)
3. **No pop-aware gating**: doesn't check if `pop.atGrade` is reasonable (low pop at target grade = risky submission)
4. **No cost-aware calculation**: doesn't subtract grading cost (~$35) + press cost (~$20) = $55 from upside

### Evidence
**Batman #222 FN 6.0**: raw sold $62, CGC 6.0 FMV $247 → $185 upside
- Current logic: `price=$62 < 100` → skipped GRADE_CANDIDATE check entirely
- Should have triggered: `$247 - $62 - $55 = $130 net upside` → actionable

### Data Available at Decision Time
**api/enrich.js → computeDecision(item)**
- ✅ `item.priceLadder` — GoCollect FMV per grade (line 3661)
- ✅ `item.price` — current raw price
- ✅ `item.isGraded` — boolean
- ✅ `item.grade` — current raw grade (VF, FN, etc.)
- ✅ `item.numericGrade` — CGC numeric if graded
- ✅ `item.pop` — CGC census data
  - `pop.total` — total copies graded
  - `pop.atGrade` — copies at specific grade
  - `pop.belowGrade` — copies below grade
  - `pop.aboveGrade` — copies above grade

### Required Behavior
GRADE_CANDIDATE should trigger when:
1. Book is raw (`!item.isGraded`)
2. `priceLadder` data available (GoCollect API key set)
3. Net upside ≥ $100 for the **target grade** (current grade + realistic bump)
4. Target grade has reasonable pop (not zero-pop mystery grade)

**Algorithm:**
```javascript
// Map raw grade to numeric equivalent
const gradeMap = { 'NM': 9.4, 'VF+': 8.5, 'VF': 8.0, 'FN+': 7.5, 'FN': 6.0, ... };
const currentNumeric = gradeMap[item.grade] || 6.0;

// Target = current grade (assumes press brings it to CGC equivalent)
const targetGrade = currentNumeric;
const targetFmv = item.priceLadder[targetGrade];

// Grading costs
const GRADING_COST = 35;
const PRESS_COST = 20;
const TOTAL_COST = GRADING_COST + PRESS_COST;

// Net upside
const netUpside = targetFmv - item.price - TOTAL_COST;

if (netUpside >= 100) {
  decision.action = 'GRADE_CANDIDATE';
  // ...
}
```

### Effort
**MEDIUM** — 1-2 hours
- Add grade-to-numeric map (VF→8.0, FN→6.0, etc.)
- Implement target-grade selection logic
- Add cost calculation ($55 total)
- Update decision reason to show net upside
- Test on catalog to verify threshold

### Risk
**LOW** — Decision engine change only
- Does not affect pricing math
- Does not affect comp filtering
- Only changes `decision.action` from LIST_NOW → GRADE_CANDIDATE
- User can override recommendation

### Dependencies
Requires GoCollect API key (optional env var `GOCOLLECT_API`)
- Currently set in production (as of Ship #20a)
- Returns null when not set → graceful fallback

### Ready to Ship
**YES** (after report review)

---

## ISSUE 3 — Web search timeout 8s (should be 20s)
**Priority:** HIGH  
**Status:** CONFIRMED — READY TO SHIP

### Current Behavior
**src/lib/claudeCheck.js**
- **Line 155**: `const TIMEOUT_MS = needsWebSearch ? 20000 : 30000;`

### Investigation Result
**TIMEOUT IS ALREADY 20s** — NOT 8s AS REPORTED.

The timeout for web search mode is correctly set to 20 seconds (line 155). Standard claude-check timeout is 30 seconds.

### Evidence Check
User reported: "Neo Faust #1 (Tezuka, Kodansha 1992) — no price, every zero-PC-data comic times out before web search returns a result"

Possible causes:
1. **API rate limits** — Anthropic web search tool may have internal rate limits
2. **Model routing** — Ship #26 uses `claude-sonnet-4-5-20250929` (line 163) for web search
3. **Network latency** — 20s may not be enough for slow eBay site loads + Claude processing

### Recommendation
**No code change needed** — timeout is already 20s.

If timeouts persist, investigate:
- Anthropic API logs (are web searches completing at all?)
- Increase timeout to 30s or 40s
- Add retry logic (1 retry with 30s timeout)

### Effort
**ZERO** (no change needed) OR **SMALL** (if timeout increase needed)

### Risk
**ZERO** (no change) OR **LOW** (timeout increase is safe)

### Dependencies
None

### Ready to Ship
**N/A** — no fix needed, timeout already 20s

---

## ISSUE 4 — Buyer tab same pricing conflict
**Priority:** MEDIUM  
**Status:** ROOT CAUSE IDENTIFIED (same as Issue 1)

### Current Behavior
Buyer tab displays the same `comps.averageNum` field as the seller view.

**src/App.jsx**
- **Line 9332**: `<BidCalculator marketValue={marketValue} ...`
  - `marketValue` comes from `getDisplayPrice(result)` (line 76-89)
  - `getDisplayPrice()` returns `item.price` (enrich response)
  - Fallback: `item.comps.averageNum × 1.15`

The `item.comps.averageNum` is the same `rawComps.average` field = **active listing average**, not sold average.

### Evidence
**Tomb of Dracula #42 in Buyer tab:**
- Recommended: $9.85 (correct — recent sold avg)
- "30-day avg": $18.54 (wrong — active listing avg or blended)

### Required Behavior
Same fix as Issue 1 — surface `soldAvg` and display it as the reference price.

### Effort
**ZERO** (fixed by Issue 1)

### Risk
**ZERO** (same fix)

### Dependencies
**Issue 1** — must be fixed first (or simultaneously)

### Ready to Ship
**YES** (once Issue 1 is shipped)

---

## ISSUE 5 — Year not extracted from comp pool
**Priority:** MEDIUM  
**Status:** ROOT CAUSE IDENTIFIED

### Current Behavior
`confirmedYear` derivation happens BEFORE comp pool is fetched, so year consensus from eBay comp titles is never used.

**api/enrich.js**
- **Lines 1978-2001**: `resolveYear()` call
  - Sources: Vision year, PriceCharting year, ComicVine year, eBay authoritative year
  - Returns `confirmedYear`
  - **Then** line 2124 fetches comps: `fetchComps(...)`

- **Lines 1990-2001**: `backfillFromComps()` call (identityCore.js)
  - Runs AFTER year resolution
  - Can backfill **publisher** from comp consensus (line 147-207 in identityCore.js)
  - **DOES NOT backfill year** — only publisher

**src/lib/identityCore.js**
- **Lines 147-210**: `backfillFromComps()` implementation
  - Extracts publisher names from eBay visual search result titles
  - Counts hits, computes ratio
  - Returns `{ publisher, publisherBackfilled, ... }`
  - **NO year extraction logic**

### The Problem
When Vision fails to extract year AND PriceCharting/ComicVine have no match, the year remains null → `ID_REQUIRED` blocker.

But eBay comp titles often contain the year: "Groo in the Wild #1 2023" → 4 active comps all say "2023".

### Evidence
**Groo in the Wild #1 (2023)** — ID_REQUIRED, missing field: year
- 4 active eBay comp titles all contain "2023"
- Engine has the data, doesn't use it

### Required Behavior
After Vision/PC/CV year resolution fails, extract year from eBay comp title consensus.

**Algorithm (add to identityCore.js):**
```javascript
export const extractYearFromComps = (compTitles) => {
  if (!compTitles || compTitles.length === 0) return null;

  const years = compTitles
    .map(title => {
      const match = title.match(/\b(19|20)\d{2}\b/);
      return match ? parseInt(match[0], 10) : null;
    })
    .filter(y => y != null);

  if (years.length === 0) return null;

  // Count occurrences
  const counts = {};
  years.forEach(y => { counts[y] = (counts[y] || 0) + 1; });

  // Find most frequent
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [consensusYear, hitCount] = sorted[0];
  const ratio = hitCount / compTitles.length;

  // Require ≥50% agreement
  if (ratio >= 0.5) {
    return {
      year: String(consensusYear),
      yearBackfilled: true,
      yearBackfillRatio: ratio,
      yearBackfillSource: 'ebay-comp-consensus'
    };
  }

  return null;
};
```

**Integration (api/enrich.js, after line 2001):**
```javascript
// Existing backfill
const backfill = backfillFromComps(confirmedTitle, confirmedYear, confirmedPublisher, visualResult?.items);

if (backfill.publisherBackfilled) {
  confirmedPublisher = backfill.publisher;
  // ...
}

// NEW: year backfill when confirmedYear still null
if (!confirmedYear && visualResult?.items) {
  const yearBackfill = extractYearFromComps(visualResult.items.map(i => i.title));
  if (yearBackfill?.yearBackfilled) {
    confirmedYear = yearBackfill.year;
    out.yearBackfilledFromComps = true;
    out.yearBackfillRatio = yearBackfill.yearBackfillRatio;
    console.log(`[year-backfill] ${confirmedYear} from eBay comp consensus (${(yearBackfill.yearBackfillRatio*100).toFixed(0)}%)`);
  }
}
```

### Timing
Year resolution happens at **line 1978** (before fetchComps).  
eBay **visual search** results (`visualResult.items`) are available at **line 1990** (from the parallel block lines 1700-1730).

So `visualResult.items` IS available at year-backfill time ✅

### Effort
**MEDIUM** — 1-2 hours
- Add `extractYearFromComps()` to identityCore.js
- Add year backfill block in enrich.js after line 2001
- Surface `yearBackfilledFromComps` flag to UI (optional)
- Test on catalog to verify consensus threshold (50% vs 60% vs 75%)

### Risk
**LOW** — Identity resolution change
- Only affects books where Vision/PC/CV all failed
- Graceful fallback (no consensus → keeps null year)
- Does not modify existing year resolution logic
- Year consensus uses same pattern as existing publisher backfill

### Dependencies
None — standalone enhancement

### Ready to Ship
**YES** (after report review)

---

## PRIORITY ORDER FOR FIXES (after report review)

1. ✅ **Issue 3** — ALREADY FIXED (timeout is 20s, not 8s)
2. 🟡 **Issue 5** — Year from comps (unblocks ID_REQUIRED) — **MEDIUM effort, LOW risk**
3. 🔴 **Issue 1** — Sold-only averaging (fixes core pricing display) — **SMALL effort, LOW risk**
4. 🟢 **Issue 4** — Buyer tab (follows Issue 1 automatically) — **ZERO effort**
5. 🟠 **Issue 2** — CGC candidate detection (new feature) — **MEDIUM effort, LOW risk**
6. 🟠 **Issue 1B** — KISS contamination (title filter tightening) — **MEDIUM effort, MEDIUM risk**

---

## SUMMARY

| Issue | Priority | Status | Effort | Risk | Ready? |
|-------|----------|--------|--------|------|--------|
| 1 — Sold-only avg | HIGH | Identified | SMALL | LOW | YES |
| 1B — KISS contam | HIGH | Identified | MEDIUM | MEDIUM | NO (design) |
| 2 — CGC candidate | MEDIUM | Identified | MEDIUM | LOW | YES |
| 3 — Timeout | HIGH | **Already 20s** | ZERO | ZERO | N/A |
| 4 — Buyer tab | MEDIUM | Same as #1 | ZERO | ZERO | YES |
| 5 — Year from comps | MEDIUM | Identified | MEDIUM | LOW | YES |

**Next step:** User review + greenlight for fixes #1, #2, #5.  
**Issue 1B (KISS contamination)** needs design discussion before implementation.

