# Q54 X-Men #44 Failure Investigation

## Problem Statement
X-Men #44 rescan still shows "the men angel red raven" identity — Q54 compound whitelist
did NOT prevent the collapse. Note says "uncanny x men" variant worked, but base case failed.

## Expected Q54 Behavior
When title exactly matches "x-men" (case-insensitive, after stripping issue# + non-alphanumerics):
1. Return canonical split ["x", "men"] IMMEDIATELY
2. SKIP all downstream tokenization (abbreviation expansion, artist strip, etc.)
3. Preserve both "x" and "men" tokens

## Q54 Implementation (compHygiene.js:183-191)
```javascript
const bareTitle = normalized
  .replace(/#\s*\d+/g, " ")
  .replace(/[^a-z0-9\s-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();
if (COMPOUND_WHITELIST.has(bareTitle)) {
  // Return canonical split (hyphens → spaces, split on whitespace)
  return bareTitle.replace(/-/g, " ").split(/\s+/).filter(Boolean);
}
```

## Failure Analysis

### Case A: Title was "The X-Men #44"
```
normalized = "the x-men #44"
bareTitle = normalized.replace(/#\s*\d+/g, " ")  → "the x-men "
bareTitle = bareTitle.replace(/[^a-z0-9\s-]/g, " ")  → "the x men " (hyphen KEPT by \s- range)
bareTitle = bareTitle.replace(/\s+/g, " ").trim()  → "the x men"
COMPOUND_WHITELIST.has("the x men")  → FALSE (whitelist has "x-men", not "the x men")
```
→ **MISS:** "the" prefix not in whitelist, hyphen preserved → mismatch

### Case B: Title was "X-Men #44" exactly
```
normalized = "x-men #44"
bareTitle = ... → "x men"  (no hyphen after [^a-z0-9\s-] replacement? WRONG)
```
Wait - `[^a-z0-9\s-]` should KEEP hyphens (inside the negated class). Let me re-read the regex.

`/[^a-z0-9\s-]/g` = NOT (letter OR digit OR whitespace OR hyphen)
→ Hyphens ARE preserved by this pattern.

So `"x-men #44"` becomes:
1. Replace `#44` → `"x-men "`
2. Replace non-[a-z0-9\s-] → `"x-men "` (no change, hyphen preserved)
3. Replace `\s+` → `"x-men"`
4. `COMPOUND_WHITELIST.has("x-men")` → TRUE ✓

**Expected: should work.**

### Case C: Title has variant/artist contamination BEFORE tokenization
If title is `"X-Men #44 Angel Iceman Red Raven"`:
```
bareTitle = "x-men angel iceman red raven"
COMPOUND_WHITELIST.has("x-men angel iceman red raven")  → FALSE
```
→ **MISS:** Whitelist checks EXACT match, variants contaminate the check.

## Root Cause Hypothesis
Q54 whitelist check runs on FULL title (with variants/artists/descriptors), not just core series name.
When title = "X-Men #44 Angel Red Raven", bareTitle = "x-men angel red raven" ≠ "x-men".

## Fix Options

### Option 1: Strip Trailing Words
Check if bareTitle STARTS WITH whitelist entry, not exact match:
```javascript
const matchedEntry = Array.from(COMPOUND_WHITELIST).find(entry =>
  bareTitle === entry || bareTitle.startsWith(entry + ' ')
);
if (matchedEntry) {
  return matchedEntry.replace(/-/g, " ").split(/\s+/).filter(Boolean);
}
```

### Option 2: Extract Core Title First
Run artist/variant strip BEFORE whitelist check (contradicts Q54 design).

## Recommended: Option 1
Whitelist check should match PREFIX, not exact string. "x-men angel" starts with "x-men " → match.

## GATE
X-Men #44 rescan → family = ["x", "men"], NOT ["men"] or ["the", "men", "angel", ...].
