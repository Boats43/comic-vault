# BATCH 1 & 2 COMPLETE — Bug Fix Report

## Summary

**BATCH 1**: 3 fixes deployed (Q22, Q23, Q28)  
**BATCH 2**: 2 fixes deployed (Q24, Q26)  
**Total**: 5 bugs fixed, 27/27 tests passing, zero build errors

---

## BATCH 1: Comp Filtering Fixes

### Q22 — Hyphen-Normalization Gap ✅ FIXED

**BUG**: "Amazing Spiderman #205" rejected as title-mismatch when our book is "Amazing Spider-Man #205"  
**ROOT CAUSE**: `tokenizeTitle()` preserved hyphens → "Spider-Man" tokenized as `["spider", "man"]`, "Spiderman" as `["spiderman"]` → zero overlap  
**FIX**: Strip hyphens BEFORE tokenization → both normalize to `["spiderman"]`  
**FILE**: `src/lib/compHygiene.js:144`  
**SCOPE**: Spider-Man, X-Men, Ant-Man, all hyphenated character names  
**TESTS**: 4/4 passed

```javascript
// Before
.toLowerCase()
.replace(/#\s*\d+/g, " ")

// After
.toLowerCase()
.replace(/-/g, "")  // Q22: strip hyphens first
.replace(/#\s*\d+/g, " ")
```

---

### Q23 — Annual/Special Issue-Format Kills All Comps ✅ FIXED

**BUG**: `issue="Annual 14"` or `issue="Special"` fails numeric `#14` match → 87-96 raw comps fetched PER ATTEMPT, **ZERO survivors EVERY TIME**  
**ROOT CAUSE**: `hasIssueNumber(t, "Annual 14")` regex expects pure numeric string, rejects every listing  
**FIX**: Two-part solution:
1. **Normalize** issue-format strings: `normalizeIssueFormat("Annual 14")` → `{issue: "14", format: "annual"}`
2. **Format-aware filter**: when `format` is set, require comp title contains format-word + number together

**FILES**:
- `src/lib/compHygiene.js:232-268` — normalizer
- `api/comps.js:25` — import
- `api/comps.js:536-545` — entry normalization
- `api/comps.js:819-827` — format-aware filter

**SCOPE**: Annual, Special, Giant-Size, King-Size  
**TESTS**: 7/7 passed

```javascript
normalizeIssueFormat("Annual 14")     // → {issue: "14", format: "annual"}
normalizeIssueFormat("Special 3")     // → {issue: "3", format: "special"}
normalizeIssueFormat("181")           // → {issue: "181", format: null}
normalizeIssueFormat("Annual")        // → {issue: null, format: "annual"}
```

**Graceful fallback**: wipeout handled at attempt-loop (lines 1371-1407) — when format filter removes all, next broader query fires.

---

### Q28 — Seller-Noise Title Contamination ✅ FIXED

**BUG**: "brickman intro uk indie lew stringer #1" leaked verbatim into confirmed title → seller listing descriptors pollute identity  
**ROOT CAUSE**: `sanitizeSeriesTitle()` strips creator/cover/condition noise but NOT seller keywords  
**FIX**: Add seller-noise patterns to NOISE_PATTERNS: `intro, indie, feat/featuring, htf, oop, rare, lew stringer`. Contextual "uk" strip (not when followed by "comic").

**FILE**: `src/lib/identityCore.js:60-80`  
**TESTS**: 5/5 passed

**Strip list**:
- intro, indie (format/origin descriptors)
- feat, featuring (guest-appearance marketing)
- htf, oop, rare (collectibility noise)
- lew stringer (creator-name dupe — Brickman case)
- uk (contextual — strip when standalone, keep in "UK Comic" publisher context)

---

## BATCH 2: Identity Resolution Fixes

### Q24 — Publisher-Name Stripped from Compound Character Titles ✅ FIXED

**BUG**: "Captain Marvel" → "Captain" (Marvel stripped as publisher noise) → **22 verified comps against ambiguous "Captain #1" pool** (could be Captain America, Captain Britain, Captain Atom)  
**ROOT CAUSE**: Publisher-strip regex removes "Marvel" even when part of canonical character name  
**FIX**: Whitelist guard for compound titles — preserve publisher tokens when part of whitelisted series name

**FILE**: `src/lib/identityCore.js:55-89`  
**WHITELIST**: Captain Marvel, Ms. Marvel, Marvel Team-Up, Marvel Two-in-One, Marvel Presents, Detective Comics, DC Comics Presents  
**TESTS**: 5/5 passed

```javascript
// Before
clean = clean.replace(/\b(marvel|dc|...)\b/gi, ' ');  // always strip

// After
const isCompoundTitle = COMPOUND_TITLE_WHITELIST.some(w => rawLower.includes(w));
if (!isCompoundTitle) {
  clean = clean.replace(/\b(marvel|dc|...)\b/gi, ' ');
} else {
  console.log('[sanitize] Q24 compound-title guard: preserving publisher tokens');
}
```

---

### Q26 — Dual-Issue-Number Conflict (Foreign/Reprint Editions) ✅ FIXED

**BUG**: "Daredevil #103 Foreign Edition US #97" → silently picks one (97 vs 103) → **206% overprice when wrong number chosen**  
**ROOT CAUSE**: `resolveIssue()` returns first match, no conflict detection  
**FIX**: `detectDualIssueConflict()` counts distinct `#N` patterns → when ≥2, return `{conflict: true, candidates: [...]}` instead of silently choosing

**FILE**: `src/lib/identityCore.js:231-273`  
**TESTS**: 6/6 passed

```javascript
resolveIssue('103', null, null, "Daredevil #103 Foreign Edition US #97")
// → {
//     conflict: true,
//     candidates: ['103', '97'],
//     visionIssue: '103',
//     ebayIssue: null,
//     visualIssue: null
//   }
```

**Next step**: Route conflict flag to RESEARCH decision with candidate-picker UI (not implemented yet — returns raw object for now).

---

## Test Coverage

### BATCH 1 Tests (tests/batch1-fixes.test.js)
```
Q22: 4/4 hyphen-normalization tests passed
Q23: 7/7 issue-format tests passed
Q28: 5/5 seller-noise tests passed
Total: 16/16 PASSED ✓
```

### BATCH 2 Tests (tests/batch2-fixes.test.js)
```
Q24: 5/5 compound-title tests passed
Q26: 6/6 dual-issue conflict tests passed
Total: 11/11 PASSED ✓
```

**Build**: `npm run build` — zero errors

---

## Commits

### BATCH 1
```
fix: BATCH 1 — hyphen norm + annual/special format + seller noise (Q22, Q23, Q28)
Hash: 64618c3
Files: 4 changed, 180 insertions(+)
```

### BATCH 2
```
fix: BATCH 2 — publisher whitelist + dual-issue conflict (Q24, Q26)
Hash: 25813c1
Files: 2 changed, 146 insertions(+)
```

---

## BATCH 3 Remaining Work

### Q25 — GoCollect 100% Timeout ⚠️ BLOCKED
**STATUS**: Requires user action  
**ISSUE**: 100% timeout at 4.5s, zero data return  
**ACTION REQUIRED**: Confirm GoCollect API key #019483 activation status  
- If DEAD → remove call, recover 4.5s/scan
- If VALID → reduce timeout 4.5s→2s, confirm parallelization

**Cannot proceed blind** — need key status confirmation before fix.

---

### Q21 — House of Secrets Issue Mismatch (120 vs 112) ⚠️ TRACE INCOMPLETE
**STATUS**: Root cause unknown  
**ACTION REQUIRED**: Pull full raw [visual] titles + extracted issues array for this specific scan  
**TRACE NEEDED**: Determine correct value via majority/explicit-count, then classify:
- Same root cause as Q12c (marketing-copy discriminator)? OR
- New digit-transposition mechanism?

**Cannot build blind** — need trace data to diagnose.

---

### Q29 — Publisher Backfill Gap ⚠️ TRACE REQUIRED
**STATUS**: May already be fixed  
**OBSERVATION**: Brickman card — publisher field empty, "Harrier" present in CV/story match, never promoted  
**EXISTING LOGIC**: Lines 2248-2254 already handle CV publisher backfill  
**ACTION REQUIRED**: Confirm backfill logic already covers this path, extend ONLY if gap found

**Cannot extend blind** — existing logic may already handle this.

---

### Q27 — Foreign/Reprint Edition Price Guard ⚠️ PROMPT CHANGE + LIVE VERIFY
**STATUS**: Requires Vision prompt modification + live scan  
**FIX**: Vision detects foreign price box (pence/foreign currency)/foreign publisher indicia → edition flag. When set: BLOCK pc_estimate path, require edition-matched comps or route RESEARCH.  
**SCOPE**: Vision prompt change (slowest verify cycle)

**Schedule LAST** — requires live-scan verification after prompt modification.

---

## Next Steps

1. **User provides**:
   - GoCollect API key status (active/dead)
   - House of Secrets #120 raw trace data (visual titles + extracted issues)
   - Brickman publisher backfill trace (CV lookup result)

2. **After trace data received**:
   - Q25: implement timeout fix OR removal
   - Q21: classify + fix based on trace
   - Q29: verify existing logic OR extend

3. **Final step**:
   - Q27: Vision prompt modification + live verification

4. **Full regression sweep**:
   - Replay 15-case sweep + all logged cards from session
   - Verify Q12c no longer regressing (title-family override desync)

---

## Impact Summary

**5 bugs fixed** across comp filtering and identity resolution:
- Q22: hyphenated character names now match correctly
- Q23: Annual/Special/Giant-Size/King-Size books now get comps
- Q28: seller noise stripped from titles
- Q24: compound character titles preserved (Captain Marvel, Detective Comics)
- Q26: dual-issue conflicts flagged instead of silent wrong-choice

**Zero regressions** — all existing tests still passing, build clean.

**Ready for BATCH 3** pending user-provided trace data.
