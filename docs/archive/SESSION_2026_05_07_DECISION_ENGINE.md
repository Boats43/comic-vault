# Session 2026-05-07 — Decision Engine v0 Deployment

**Session window:** 09:18–16:30 Pacific (7h 12m)  
**HEAD:** fd0a313  
**Total commits:** 9 (plus 10 prior Ship 26 commits)  
**Focus:** Layer 3 Decision Engine v0-A through v0-D.1 + provisional state safety

## Summary

Day 3 deployed the Decision Engine foundation — a pure helper that reads enrich output and computes BUY/SELL/HOLD/WAIT decisions with blocking reasons. The engine integrates into the enrich pipeline, persists through all merge paths, and gates eBay listing actions.

**Architecture:**
- Pure helper in `src/lib/decisionEngine.js` (zero side effects)
- Computes decisions from enrich response fields (no external calls)
- 4 recommendation types: BUY (Buyer tab), SELL/HOLD/WAIT (Collection tab)
- Blockers system prevents listing actions when decision=WAIT
- UI displays decision badge + reason on comic detail cards

**Key insight:** Provisional state writes are a systemic bug class. Vision can hallucinate price fields when `price` exists in JSON_SHAPE. Build + tests passing does not guarantee React runtime safety (JSX scope errors require render smoke coverage).

## Ships Deployed (chronological)

| Time | Commit | Ship | Effect |
|------|--------|------|--------|
| 09:18 | e9ad60e | v0-C | Display decision badge on CollectionDetail card |
| 14:11 | e779159 | v0-B.1 | Normalize identity fields before decision computation |
| 14:23 | 972ad3a | v0-C.1 | Format currency in decision reasons |
| 14:39 | 316318b | v0-D | Gate listing actions by decision blockers |
| 15:25 | 238280b | v0-D.1 | Reprint key-label safety + no-comps blocker |
| 15:44 | a90388d | A-lite hotfix 1 | Sync system listPrice after enrich completion |
| 16:22 | 1a9e6c1 | A-lite hotfix 2 | Prevent provisional Vision prices from entering catalogue |
| 16:30 | fd0a313 | A-lite hotfix 3 | Fix collection screen crash (wrong variable reference) |

**Note:** Ships v0-A and v0-B deployed prior to session window (commits aa11be5, 1591704, b25e6bf).

Average commit interval: ~55 minutes.

## Decision Engine Architecture

### v0-A — Pure Helper Foundation
**Commit:** b25e6bf  
**Files:** `src/lib/decisionEngine.js` + fixtures

Pure function `computeDecision(item)` returns:
```js
{
  decision: 'BUY' | 'SELL' | 'HOLD' | 'WAIT',
  reason: 'human-readable explanation',
  confidence: 0-100,
  blockers: ['array', 'of', 'blocking', 'reasons']
}
```

**Decision logic:**
- **BUY:** `matchConfidence >= 75 && netProfit >= minProfit` (Buyer tab only)
- **SELL:** `matchConfidence >= 75 && displayPrice >= $10` (Collection tab)
- **HOLD:** `matchConfidence >= 60 && displayPrice >= $5` (wait for better market)
- **WAIT:** Default when confidence too low or blockers present

**Blockers:**
- Low match confidence (<60)
- Low vision confidence (<60)
- Manual review required (mega-key MANUAL badge)
- Grade exceeds mega-key map
- Reprint/facsimile detected (editionWarning.detected)
- No comps available (rawComps.count === 0)
- Identity fields incomplete (title/issue/year/publisher missing)

### v0-B — Backend Integration
**Commits:** 1591704 (integration), aa11be5 (hotfix persistence)

Integrated `computeDecision` into `api/enrich.js`:
- Called at end of handler (line ~1847)
- Added `out.decision` field to response
- Hotfix: persisted `decision` object through all 5 client merge paths

### v0-C — Frontend Display
**Commits:** e9ad60e (display), 972ad3a (formatting)

Added decision badge to `CollectionDetail`:
- Pill component with color coding (green=BUY/SELL, yellow=HOLD, red=WAIT)
- Displays decision + reason below price card
- Cosmetic fix: currency formatting in decision reasons

### v0-B.1 — Field Normalization
**Commit:** e779159

Moved identity field normalization BEFORE decision computation:
```js
// Ensure identity fields exist before decision
out.title = out.title || 'Unknown';
out.issue = out.issue !== undefined ? out.issue : null;
out.year = out.year || null;
out.publisher = out.publisher || 'Unknown';

// THEN compute decision
out.decision = computeDecision(out);
```

**Why:** Decision engine expected normalized fields. Missing fields caused incorrect blocker logic.

### v0-D — Listing Gate
**Commit:** 316318b

Gate eBay listing actions by decision blockers:
- `handleList` checks `item.decision?.blockers?.length > 0`
- Shows alert with blocker reasons before listing
- User can override (soft gate, not hard block)

**Files:** `src/App.jsx` line ~1450

### v0-D.1 — Reprint Safety + No-Comps Blocker
**Commit:** 238280b

Two fixes:
1. **Reprint key-label safety:** When `editionWarning.detected`, decision reason includes "Detected reprint/facsimile — verify authenticity" (not "original key issue")
2. **No-comps blocker:** Added `rawComps.count === 0` to blocker list (was missing from v0-A)

## Option A-lite Hotfixes (3 provisional state bugs)

### Hotfix 1: listPrice Sync
**Commit:** a90388d

**Bug:** User edits `listPrice` input, clicks "Refresh Market Data" → enrich overwrites custom listPrice with system price.

**Fix:** After enrich merge, copy `item.price` (system) to `item.listPrice` only if `item.listPrice` is null/undefined.

**Files:** `src/App.jsx` lines 780-783

### Hotfix 2: Vision Price Hallucination
**Commit:** 1a9e6c1

**Bug:** Vision hallucinated `price: "$4,500"` field when scanning polybag comic. Provisional price persisted to catalogue despite backend returning `out.price=null` + `pricingSource=refused-claude-gate`.

**Root cause:** Vision `JSON_SHAPE` includes `price` field. Model infers price from keyIssue signals even when confidence low.

**Fix:** Scan merge path (`handleGradeResult`) now strips Vision price when backend refuses:
```js
if (enrichData.pricingSource === 'refused-claude-gate' || 
    enrichData.pricingSource === 'refused-no-data-sources') {
  delete enrichData.price; // Strip hallucinated Vision price
}
```

**Files:** `src/App.jsx` lines ~662-665

### Hotfix 3: Collection Screen Crash
**Commit:** fd0a313

**Bug:** Collection tab black screen crash after Hotfix 2 deploy. Error: `Cannot read property 'decision' of undefined`.

**Root cause:** Variable reference typo in decision badge render — referenced wrong item variable in nested scope.

**Fix:** Corrected variable reference in `CollectionDetail` decision badge render.

**Files:** `src/App.jsx` line ~1950

**Why it passed tests:** JSX scope errors require runtime render. Build passed because syntax valid. Tests passed because they don't render `CollectionDetail` with decision field.

## Pattern Library Additions (Day 3)

### Provisional State Write Class
**Pattern:** Component writes optimistic/provisional state before backend confirmation, provisional value persists through merge path.

**Examples:**
- Vision price hallucination (Option A-lite Hotfix 2)
- listPrice overwrite on refresh (Option A-lite Hotfix 1)

**Prevention:** Explicit null checks in merge paths. Delete provisional fields when backend refuses/contradicts.

### Vision Hallucination Class
**Pattern:** Vision infers fields from context when field exists in JSON_SHAPE, even when confidence low or data unavailable.

**Example:** Polybag comic with keyIssue signals → Vision outputs `price: "$4,500"` despite no pricing data.

**Prevention:** 
1. Strip Vision price when `pricingSource=refused-*`
2. Consider removing `price` from Vision JSON_SHAPE entirely (let backend own pricing)

### Build-Pass Runtime-Fail Class
**Pattern:** Code passes build + tests but crashes at runtime due to scope/reference errors in JSX.

**Example:** Hotfix 3 collection screen crash (wrong variable in nested scope).

**Prevention:** Render smoke tests for critical UI paths. Build + unit tests insufficient for React runtime safety.

### Field Normalization Ordering
**Pattern:** Decision engine expects normalized fields, but normalization happens after decision computation.

**Example:** v0-B.1 moved field defaults before `computeDecision()` call.

**Prevention:** Normalize fields at handler entry or immediately before decision computation, never after.

### Reprint Language Safety
**Pattern:** Decision reasons reference "original key issue" when book is actually reprint/facsimile/polybag.

**Example:** v0-D.1 changed reason from "Potential key issue" to "Detected reprint — verify authenticity".

**Prevention:** Gate language by `editionWarning.detected` flag before surfacing key-issue copy.

### Decision Blocker Completeness
**Pattern:** Blocker list incomplete, allows listing when data quality insufficient.

**Example:** v0-D.1 added `rawComps.count === 0` blocker (was missing from v0-A).

**Prevention:** Audit blocker list against all refusal cases in enrich response.

## Validation Status

**Production verified:**
- ✅ Decision badges display correctly on Collection tab
- ✅ Listing gate shows blocker alert when decision=WAIT
- ✅ Vision price hallucination stripped (polybag case)
- ✅ Collection screen stable (no crashes)
- ✅ listPrice persists through refresh

**Pending validation:**
- Decision accuracy calibration (confidence thresholds)
- Blocker coverage audit (other refusal cases)
- BUY decision logic on Buyer tab

## Next Session Priorities

1. **Decision calibration:** Adjust confidence thresholds based on production behavior
2. **Blocker audit:** Check for missing refusal cases (magazine format, non-comic, etc.)
3. **BUY decision validation:** Test Buyer tab BUY recommendations with real Whatnot sessions
4. **Vision JSON_SHAPE review:** Consider removing `price` field to prevent hallucinations

## Architectural Learnings (Day 3)

1. **Pure helpers first, integration second.** v0-A fixtures caught edge cases before backend integration.
2. **Normalize inputs at entry.** Field defaults must precede decision computation, not follow.
3. **Gate copy by context.** Decision reasons need awareness of book type (reprint vs original).
4. **Merge paths are write-once surfaces.** Provisional state from any upstream source persists unless explicitly stripped.
5. **JSX scope discipline.** Variable references in nested React components fail silently at build time, crash at runtime.
6. **Build ≠ runtime.** React rendering smoke coverage required for UI stability.
7. **Blocker lists decay.** New refusal cases (no-comps) require blocker list updates. Audit against enrich response regularly.

## Files Modified (Day 3)

- `src/lib/decisionEngine.js` (NEW) — pure decision helper + fixtures
- `api/enrich.js` — integrate decision computation, normalize fields
- `src/App.jsx` — display decision badge, gate listing, strip Vision price, fix crash
- (Tests not yet added — pending Ship 26.5)

## Decision Engine v0 Status

**Deployed:** v0-A through v0-D.1  
**Remaining:** v0-E (tests), v1-A (calibration), v1-B (BUY path validation)  

**Current behavior:**
- Computes decisions on all enrich responses
- Displays badges on Collection tab
- Gates listing actions (soft gate, user override)
- Strips Vision price hallucinations
- Blocks listing when: low confidence, reprint detected, no comps, mega-key manual review

**Known gaps:**
- No tests yet (pure helper has fixtures, integration untested)
- Confidence thresholds uncalibrated (using placeholder values)
- BUY decision untested on Buyer tab
- Blocker list may be incomplete (audit pending)
