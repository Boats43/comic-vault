# Phase 1 Regression Set

**Date:** 2026-05-19  
**Purpose:** Behavioral validation for Phase 1 fixes (float display, zero-verified cap, grade-aware floor, Batman #59 gate)

---

## Expected Decisions

| Title | Issue | Year | Publisher | Expected Decision | Confidence | Notes |
|-------|-------|------|-----------|------------------|------------|-------|
| Wolverine | #8 | 1989 | Marvel | LIST_NOW | high | Baseline — clean modern book |
| 5 Ronin | #1 | 2011 | Marvel | LIST_NOW | medium | Fix D: zero-verified cap (was HIGH) |
| Yellow Claw | #1 | 1956 | Marvel | LIST_LOW | medium | Vintage Golden Age key |
| Spawn Dark Ages | #1 | 2023 | Image | RESEARCH | low | Modern variant contamination |
| Giant-Size Hulk | #1 | 1975 | Marvel | RESEARCH | low | Pattern M story mismatch |
| Batman | #129 | 1960 | DC | LIST_NOW | high | Fix C: grade-aware floor |
| Batman | #59 | 1950 | DC | RESEARCH | medium | Fix B: historical key date correction downgrade (was DO_NOT_LIST) |
| Captain America | #359 | 1989 | Marvel | LIST_NOW | high | Modern key, clean comps |

---

## Fix-Specific Validation

### Fix A: Float Display
**Test:** Scan any book, verify all displayed prices render to exactly 2 decimals.
- Collection list: `$13.80`, not `$13.796000000000001`
- Detail card: `$149.90`, not `$149.9` or `$149.89999`
- ROI display: `$45.00`, not `$45`

### Fix D: Zero-Verified-Comps Cap
**Test:** 5 Ronin #1 (2011) Marvel
- **Before:** LIST_NOW HIGH (score 85+)
- **After:** LIST_NOW MEDIUM (score ≤75, message "Sold comps exist but none verified")
- Blockers: none
- Confidence: medium (capped from high)

### Fix C: Grade-Aware Floor
**Test:** Batman #129 (1960) DC VG 4.0
- **Before:** Floor anchors to FR 1.0 listing at $36
- **After:** Floor uses VG-proximate filtered minimum ($45–$55 range)
- Verify `rawComps.gradeFilteredLowest` surfaced in response

### Fix B: Batman #59 Historical Key Gate
**Test:** Batman #59 (1950) DC
- **Before:** DO_NOT_LIST (Claude gate: "does not feature first appearance")
- **After:** RESEARCH medium (downgrade path, Vision confidence high + activeCount ≥2)
- Blockers: none
- Warnings: historical-date-correction flag

---

## Boundary Cases

### Hard Blocks (Must NOT Downgrade)
- MTU #141: "KEY ISSUE MISIDENTIFIED" → DO_NOT_LIST
- Any "wrong issue" + historical phrase → DO_NOT_LIST
- Vision confidence LOW + historical phrase → DO_NOT_LIST
- Reprint/facsimile + historical phrase → DO_NOT_LIST

### Downgrade Eligibility (Must Downgrade to RESEARCH)
- Historical phrase alone + Vision HIGH + comps ≥2 → RESEARCH
- "first appeared in X (year)" correction + guards pass → RESEARCH
- "not the first appearance" + guards pass → RESEARCH

---

## Regression Protocol

1. Run `npm run build` — must pass clean
2. Run full test suite — 1,570+ tests must pass
3. Phone validation: scan 8-book set above
4. Verify decisions match expected table
5. Spot-check 3 random catalog books for float display artifacts
6. Flag any deviation from expected behavior before merge

---

**Baseline commit:** (will be set after Commit 1 ships)  
**Test suite:** tests/*.test.js (23 suites)  
**Validation device:** Production phone scans via Watch Mode or standard scan flow
