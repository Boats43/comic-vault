# ISSUE 6 — Grade-Proximity Filter Skipped on Raw Comics

**Date:** 2026-06-20  
**Issue:** Grade-proximity filter doesn't run for raw comics with grade strings like "GD 2.5"

## Root Cause

**api/comps.js:501-506** — `numericTarget` extraction logic:
```javascript
const numericTarget =
  numericGrade != null && !isNaN(Number(numericGrade))
    ? Number(numericGrade)                    // CGC graded: 9.4, 8.0, etc.
    : grade != null && !isNaN(parseFloat(grade))
    ? parseFloat(grade)                        // Tries to parse grade string
    : null;
```

**Problem:**  
`parseFloat("GD 2.5")` returns `NaN` because the string starts with non-numeric characters.

**Result:**  
- For Batman #222: `grade = "GD 2.5"` → `parseFloat("GD 2.5") = NaN` → `numericTarget = null`
- Filter skipped at line 1247: `[comps] grade-proximity filter skipped (no numeric grade: numericTarget=null)`

## Evidence

**Batman #222 logs:**
```
[comps] grade-proximity filter skipped (no numeric grade: numericTarget=null)
```

**Active listings contaminating the floor:**
- VF/NM listings at $173-$395
- GD 2.5 copy should NOT use these as comps
- Floor set at $173 (wrong for GD grade)

## Current Flow

**For CGC graded books:** ✅ WORKS
- `numericGrade = 9.4` → `numericTarget = 9.4` → filter runs

**For raw books with numeric-first grades:** ⚠️ WORKS BY ACCIDENT
- `grade = "9.4"` → `parseFloat("9.4") = 9.4` → `numericTarget = 9.4` → filter runs
- `grade = "2.5"` → `parseFloat("2.5") = 2.5` → `numericTarget = 2.5` → filter runs

**For raw books with grade strings:** ❌ BROKEN
- `grade = "GD 2.5"` → `parseFloat("GD 2.5") = NaN` → `numericTarget = null` → filter SKIPPED
- `grade = "FN 6.0"` → `parseFloat("FN 6.0") = NaN` → `numericTarget = null` → filter SKIPPED
- `grade = "VF"` → `parseFloat("VF") = NaN` → `numericTarget = null` → filter SKIPPED

## Grade String Formats

**Vision returns grades in multiple formats:**
1. **CGC numeric:** `9.4`, `6.0`, `2.5` (graded books)
2. **Grade + numeric:** `"GD 2.5"`, `"FN 6.0"`, `"VF 8.0"` (raw books with defects noted)
3. **Grade only:** `"GD"`, `"FN"`, `"VF"`, `"NM"` (raw books, generic grade)

**Current parser handles:**
- ✅ Format 1: `numericGrade` passed directly
- ⚠️ Format 2: Falls through to `parseFloat()` → `NaN` → FAILS
- ❌ Format 3: `parseFloat("VF")` → `NaN` → FAILS

## Required Fix

**Add grade-to-numeric mapping in comps.js** (same as decisionEngine.js GRADE_TO_NUMERIC):

```javascript
const GRADE_TO_NUMERIC = {
  'GM': 10.0, 'MT': 10.0, 'NM/MT': 9.8, 'NM+': 9.6, 'NM': 9.4, 'NM-': 9.2,
  'VF/NM': 9.0, 'VF+': 8.5, 'VF': 8.0, 'VF-': 7.5,
  'FN/VF': 7.0, 'FN+': 7.0, 'FN': 6.0, 'FN-': 5.5,
  'VG/FN': 5.0, 'VG+': 4.5, 'VG': 4.0, 'VG-': 3.5,
  'GD/VG': 3.0, 'GD+': 2.5, 'GD': 2.0, 'GD-': 1.8,
  'FR/GD': 1.5, 'FR': 1.0, 'PR': 0.5
};

const numericTarget =
  numericGrade != null && !isNaN(Number(numericGrade))
    ? Number(numericGrade)                         // CGC: 9.4
    : grade != null && !isNaN(parseFloat(grade))
    ? parseFloat(grade)                            // Numeric string: "9.4"
    : grade != null && GRADE_TO_NUMERIC[grade.split(' ')[0]]
    ? GRADE_TO_NUMERIC[grade.split(' ')[0]]       // "GD 2.5" → "GD" → 2.0
    : null;
```

**Logic:**
1. Try `numericGrade` (CGC)
2. Try `parseFloat(grade)` (numeric string)
3. **NEW:** Extract first token from grade string, map to numeric
   - `"GD 2.5".split(' ')[0] = "GD"` → `GRADE_TO_NUMERIC["GD"] = 2.0`
   - `"FN 6.0".split(' ')[0] = "FN"` → `GRADE_TO_NUMERIC["FN"] = 6.0`
   - `"VF".split(' ')[0] = "VF"` → `GRADE_TO_NUMERIC["VF"] = 8.0`

## Expected Behavior After Fix

**Batman #222 GD 2.5:**
- `grade = "GD 2.5"` → extract "GD" → `GRADE_TO_NUMERIC["GD"] = 2.0` → `numericTarget = 2.0`
- Grade-proximity filter RUNS ✅
- VF/NM listings at $173-$395 EXCLUDED (diff > 1.5 grades)
- GD-range listings used for floor
- Floor set at ~$60-70 (correct for GD grade) ✅

**Impact:**
- All raw vintage comics with grade strings now get grade-proximity filtering
- VF/NM active listings won't contaminate GD/VG/FN floors
- More accurate pricing for low-grade vintage

## Regression Check

**Books that work now should still work:**
- CGC graded: `numericGrade=9.4` → no change ✅
- Numeric strings: `grade="9.4"` → no change ✅

**Books that don't work now will be fixed:**
- `grade="GD 2.5"` → mapped to 2.0 ✅
- `grade="FN"` → mapped to 6.0 ✅
- `grade="VF 8.0"` → mapped to 8.0 ✅

## Files to Change

**api/comps.js:501-506** — Add GRADE_TO_NUMERIC map and extraction logic

## One Question

**Which grade to use when Vision provides both string AND numeric?**

Example: `grade = "GD 2.5"` has both "GD" (2.0) and "2.5"

**Options:**
1. **Use the numeric part** (2.5) — more precise
2. **Use the grade string** (GD → 2.0) — matches Vision's grade category
3. **Use the numeric part if present, else map the string**

**Recommendation:** Option 3
- `"GD 2.5"` → extract "2.5" → `parseFloat("2.5") = 2.5` ✅
- `"GD"` → map to 2.0 ✅

**Revised logic:**
```javascript
const extractNumericFromGrade = (gradeStr) => {
  // Try to extract numeric part: "GD 2.5" → "2.5"
  const numMatch = gradeStr.match(/\b(\d+\.?\d*)\b/);
  if (numMatch) return parseFloat(numMatch[1]);
  
  // Fall back to mapping first token: "GD" → 2.0
  const firstToken = gradeStr.trim().split(/\s+/)[0];
  return GRADE_TO_NUMERIC[firstToken] || null;
};

const numericTarget =
  numericGrade != null && !isNaN(Number(numericGrade))
    ? Number(numericGrade)
    : grade != null
    ? extractNumericFromGrade(grade)
    : null;
```

**Examples:**
- `"GD 2.5"` → match "2.5" → `2.5` ✅
- `"GD"` → no match → map "GD" → `2.0` ✅
- `"FN 6.0"` → match "6.0" → `6.0` ✅
- `"VF"` → no match → map "VF" → `8.0` ✅
- `"9.4"` → match "9.4" → `9.4` ✅

## Summary

**Root cause:** `parseFloat("GD 2.5")` returns `NaN` → `numericTarget = null` → filter skipped

**Fix:** Extract numeric from grade string, or map grade token to numeric

**Impact:** Raw vintage comics get proper grade-proximity filtering, fixing $173 GD floor contamination

**Regression risk:** LOW — only affects books that currently skip the filter

**Next step:** Implement fix in api/comps.js
