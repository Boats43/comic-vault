# FIX 1 ROOT CAUSE — backfillFromComps() Never Called

**Date:** 2026-06-20  
**Issue:** Year backfill not firing for Groo in the Wild #1

## Root Cause

`backfillFromComps()` is located **AFTER** an early return gate that fires when `identityRefused === true`.

### Execution Flow for Groo in the Wild #1

**api/enrich.js line numbers:**

1. **Line 1542**: `familyCandidate` fires (title-family clustering)
2. **Line 1555**: `familyCandidate.decision === 'refused-identity-conflict'`
3. **Line 1556**: `identityRefused = true`
4. **Lines 1578-1692**: Phase 1 continues (assetType derivation, author extraction)
5. **Line 1698**: Phase 2 start marker
6. **Line 1711-1716**: Phase 2 data fetching (PC/CV/CGC) — RUNS (before gate)
7. **Line 1978-1987**: `resolveYear()` called — RUNS (before gate)
8. **Line 2050**: **EARLY RETURN GATE** — `if (identityRefused) { return res.status(200).json(out); }`
9. **Line 2071**: Returns with `pricingSource: 'refused-identity-conflict'`
10. **Lines 1990-2008**: `backfillFromComps()` call — **NEVER REACHED**

### Call Site Analysis

**Only ONE call site for `backfillFromComps()`:**
- Location: `api/enrich.js:1990`
- Gating condition: NONE (unconditional call)
- Problem: Located AFTER line 2050 early return gate

The function itself is correct (FIX 1 changes are valid), but it's in dead code for the `identityRefused` path.

## The Fix

**Move `backfillFromComps()` call from line 1990 to BEFORE line 2050.**

Optimal location: **After line 1987** (immediately after `resolveYear()` call), BEFORE the Phase 2 gate.

This ensures year backfill runs on ALL paths:
- ✅ Normal path (identity confirmed)
- ✅ Refused path (`identityRefused === true`)

### Proposed Code Location

```javascript
// Line 1978-1987: resolveYear() call
const yearResolution = resolveYear(
  year,
  pcYear,
  cvYear,
  ebayYearAuthoritative,
  { keyIssue: keyIssueStr }
);

confirmedYear = yearResolution.confirmedYear;
let yearOverrideRejected = yearResolution.yearOverrideRejected;

// NEW LOCATION: backfillFromComps() BEFORE Phase 2 gate
const backfill = backfillFromComps(
  confirmedTitle,
  confirmedYear,
  confirmedPublisher,
  visualResult?.items
);

if (backfill.yearBackfilled) {
  confirmedYear = backfill.year;
  out.yearBackfilledFromComps = true;
  out.yearBackfillRatio = backfill.yearBackfillRatio;
  out.yearBackfillSource = backfill.yearBackfillSource;
}

if (backfill.publisherBackfilled) {
  confirmedPublisher = backfill.publisher;
  out.publisherBackfilledFromComps = true;
  out.publisherBackfillRatio = backfill.yearBackfillRatio;
}

// Line 2048-2072: Phase 2 gate (early return when identityRefused)
if (identityRefused) {
  console.log(`[phase2] SKIPPED — identity refused by title-family clustering`);
  // confirmedYear is NOW available from backfill even on refused path
  const out = {
    ...sanitizeIdentityFields(req.body),
    year: confirmedYear,  // ← FIX: include backfilled year in refused response
    pricingSource: 'refused-identity-conflict',
    // ...
  };
  return res.status(200).json(out);
}
```

## Additional Fix Required

The early return at line 2050-2072 constructs a NEW `out` object that **does NOT include `confirmedYear`**.

The `sanitizeIdentityFields(req.body)` at line 2054 uses the **original Vision year** (from req.body), not the backfilled year.

**Add to the refused response:**
```javascript
year: confirmedYear,  // Include backfilled year
yearBackfilledFromComps: out.yearBackfilledFromComps,
yearBackfillRatio: out.yearBackfillRatio,
yearBackfillSource: out.yearBackfillSource,
```

## Testing After Fix

**Groo in the Wild #1 validation:**
1. Scan should log `[year-backfill-debug]` (function now called)
2. Scan should log `[year-backfill] 2023 from eBay comp consensus (X/Y=Z%)`
3. Response should include `year: "2023"`
4. Identity gate may still refuse (depends on what other fields are missing)
5. But year field should be populated, unblocking future scans if year was the only missing field

**Incredible Hulk & Wolverine #1 regression check:**
- Vision year should still be preserved (backfill only runs when `confirmedYear` is null)
- No behavior change for books where Vision succeeds

## Summary

| Location | Current | After Fix |
|----------|---------|-----------|
| backfillFromComps() call | Line 1990 (dead code on refused path) | Line 1988 (before gate) |
| confirmedYear in refused response | Missing (uses Vision year) | Included (uses backfilled year) |
| Execution on refused path | Skipped | Runs |

**Next step:** Implement the relocation fix.
