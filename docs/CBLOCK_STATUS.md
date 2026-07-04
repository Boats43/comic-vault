# C-Block Status — Cleanup Sweep

**Session:** 2026-07-04 continuation  
**Status:** C1-C3 COMPLETE, C4-C6 queued  
**Token usage at handoff:** 127k/200k (63%)

---

## COMPLETED ITEMS (C1-C3)

### C1: Q41 — getDisplayPrice precedence ✅ DONE

**Commit:** `37f03dc` (pushed 2026-07-04)

**Issue:** Display price should prefer decision engine's market recommendation over legacy item.price.

**Fix:** getDisplayPrice (App.jsx line 107)
- When priceOverridden=true → use item.price (manual edit)
- Else prefer priceBands.market (decision engine market-band)
- Fallback to item.price (legacy books without priceBands)
- Final fallback: comps.averageNum × 1.15

**Flag persistence:** Manual list-price edit sets priceOverridden=true (line 5629)

---

### C2: Q50b — parseListingGrade matchAll numeric ✅ DONE

**Commit:** `2674a1e` (pushed 2026-07-04)

**Issue:** parseListingGrade used .match() returning first match only. Range excluded 10.0.

**Fix:** compHygiene.js line 220
- matchAll: [...t2.matchAll(/\b(\d{1,2}\.\d)\b/g)]
- Filter to grade range: 0.5–10.0
- Decimal preference: Math.max(...validGrades)

**Pattern:** \b(\d{1,2}\.\d)\b matches 0.5, 6.0, 9.4, 10.0

---

### C3: Q52 — Thor #235 investigation ✅ DONE

**Commit:** `232ac75` (pushed 2026-07-04)

**Issue:** Thor #235 sold-fetch returns empty — root cause unknown.

**Investigation (not fix):** Added diagnostic logging to soldVerification.js
- Entry: log "zero sold rows from PC" OR "N raw sold rows entering filter chain"
- Exit: log "100% rejected — top reasons" OR "N/M verified"

**Log pattern:** `[Q52-investigate] {title} #{issue}: {diagnostic}`

**Next:** Rescan Thor #235 → check console logs → report root cause

---

## QUEUED ITEMS (C4-C6)

### C4: Arc-subtitle consensus residual

**Issue:** Arc-word contamination in consensus-built titles. "Silver Banshee", "Deadman", "Goliath", "Secret Six" appearing as subtitle when they're story-arc descriptors, not canonical title components.

**Evidence:**
- Action Comics #595: "Action Silver Banshee" (arc word, not title)
- Action Comics #610: "Action Deadman The Demon Within" (story arc)
- Black Goliath class (character name vs series title)
- Secret Six class (team name in story arc)

**Spec:** Strip arc words after 60% intersection
- When consensus title contains arc-word AND >60% of comp titles DON'T contain it → strip
- Arc-word detection: single/two-word proper nouns appearing inconsistently
- Preserve when ≥60% of comps include it (canonical part of title)

**Location:** Likely in identityCore.js consensus builder or api/enrich.js title resolution

---

### C5: pc_estimate anchors to lone verified sold when soldPool≥1

**Issue:** Action Comics #610 — $5.99 sold comp discarded, pc_estimate anchored to $1.44.

**Root cause:** When soldPool≥1 but verifiedCount=0 (all rejected), pc_estimate should use the BEST rejected sold (highest price within grade tolerance) as anchor, not fall back to PC base.

**Spec:** 
- When soldPool ≥ 1 (sold data exists)
- AND verifiedCount = 0 (all rejected by filters)
- AND pc_estimate path active
- → Anchor to highest rejected sold within ±1.5 grade tolerance
- Do NOT fall back to PC base ($1.44) when real market data ($5.99) exists

**Evidence:** Action #610: $5.99 sold rejected (likely gradeMismatch or stale) → pc_estimate used $1.44 PC base instead

**Location:** api/enrich.js pc_estimate calculation block

---

### C6: Bulk cleanup — counter, error handling, dead imports

**Three fixes in one commit:**

1. **Bulk counter → finally pattern**
   - Location: App.jsx bulk import progress counter
   - Current: counter increments in try block
   - Fix: Move counter to finally block (executes on success AND error)
   - Prevents stuck "Processing 47 of 50" on partial failures

2. **inFlightKeys.delete on save fail**
   - Location: App.jsx putComic error handler
   - Current: inFlightKeys.delete only on success
   - Fix: Add .delete() in catch block
   - Prevents key leaks when IndexedDB write fails

3. **Dead import cleanup**
   - Scan for unused imports across App.jsx, enrich.js
   - Remove orphaned after Ship #21 refactors
   - Build-time verification (zero errors required)

**Evidence:** Bulk import hangs at "Processing 47 of 50" when enrichment errors occur

---

## QUEUE AFTER C-BLOCK

### docs/SOLD_BLEND_DESIGN.md (#20b)

**Status:** DOC ONLY — greenlight required before code implementation

**Content:**

**Exhibits A-G:** Real-world blend behavior examples
- Exhibit A: Batman #222
- Exhibit B: Batman #423
- Exhibit C: Wolverine #8 (logged 20:27 — 22 fresh solds ~$67 → blend $109.98)
- Exhibit D: House & Whipple #1
- Exhibit E: Punisher #1
- Exhibit F: Venom #1
- Exhibit G: Fantastic Four #96 / #135 / Black Panther #1 / Eternals #10

**Projected prices required for all 10 exhibit books:**
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

**Design doc structure:**
- Current blend formula: soldAvg × 0.6 + activeAvg × 0.4
- Exhibit analysis: how blend behaves vs floor enforcement
- Edge cases: sold-only bump (+10%), active-only fallback, thin-pool anchoring
- Proposed refinements (if any) with projected impact
- Test scenarios with before/after pricing

**CRITICAL:** This is DESIGN documentation ONLY. Do NOT implement code changes to blend formula without explicit greenlight. Pricing math modification requires user approval.

---

## FRESH SESSION INSTRUCTION

**Exact paste to new session:**

```
Read docs/CBLOCK_STATUS.md and CLAUDE.md. Execute C4→C5→C6, one commit 
each, push after each. Then write docs/SOLD_BLEND_DESIGN.md per spec. 
HOLD for greenlight after doc.
```

---

**END SPEC**
