# MANUAL COVERAGE TESTING PROTOCOL

**Purpose:** Verify all 10 scenarios work WITHOUT Anthropic AI  
**Status:** Ready for execution  
**Estimated Time:** 30-45 minutes  

---

## ⚠️ CRITICAL REQUIREMENT

**YOU MUST REMOVE `ANTHROPIC_API_KEY` FROM VERCEL BEFORE TESTING**

```bash
# Remove from Vercel
vercel env rm ANTHROPIC_API_KEY production
vercel env rm ANTHROPIC_API_KEY preview

# Redeploy
git commit --allow-empty -m "test: trigger redeploy without AI"
git push origin main
```

Without this step, AI will fire on conflicts/zero-comps and tests will be invalid.

---

## PREVIOUS AUDIT (Code Analysis Only)

The `docs/MANUAL_COVERAGE.md` audit was **code investigation only**, not actual execution.

**Findings from code audit:**
- ✅ manualIdentity skips Vision (confirmed)
- ✅ skipImageSearch skips eBay visual (confirmed)
- ✅ All deterministic components run (PC, CV, comps, decision)
- ✅ AI fires ONLY when conflicts detected OR zero comps

**AI fire rate (estimated):** 10-20%  
**Scenarios expected to fire AI:** 3 (UK edition), 6 (zero comps)  
**Scenarios conditional:** 2, 7, 9 (fire AI only if conflicts)

---

## THIS PROTOCOL: Real Execution Tests

Now we need **actual browser testing** with API key removed to confirm zero-AI paths work.

---

## TEST EXECUTION

### SCENARIO 1: Barcode Scan

**Input:** UPC `75960620200800111`  
**Steps:**
1. Open https://comic-vault-rouge.vercel.app
2. Scan barcode OR enter UPC manually
3. Check Vercel logs: `vercel logs --follow`

**Expected Logs:**
```
✅ [barcode] identity resolved: ...
✅ [pricecharting] ...
✅ [comps] ...
❌ [claude-check] ... (should NOT appear)
```

**Result:** PASS / FAIL / ___________

---

### SCENARIO 2: Title Search (Clean Book)

**Input:** Batman #222 (1970)  
**Steps:**
1. Click "✏️ Search by Title"
2. Enter: Batman, 222, 1970
3. Click "Search →"
4. Check Vercel logs

**Expected Logs:**
```
✅ [manual] identity locked: Batman #222
✅ [pricecharting] ...
✅ [comicvine] ...
✅ [comps] ...
✅ [claude-check] zero conflicts — skip AI call
❌ [claude-check] conflicts detected (should NOT appear)
```

**Result:** PASS / FAIL / ___________

---

### SCENARIO 3: UK Edition (EXPECTED FAIL)

**Input:** Mighty World of Marvel #157 (1975)  
**Steps:**
1. Click "✏️ Search by Title"
2. Enter: Mighty World of Marvel, 157, 1975
3. Click "Search →"
4. Check Vercel logs

**Expected Logs:**
```
❌ [claude-check] web search mode triggered (rawComps=0)
❌ Error: ANTHROPIC_API_KEY not set
```

**Result:** EXPECTED FAIL (web search fires) / ___________

---

### SCENARIO 4: Mega-Key

**Input:** Amazing Fantasy #15 (1962)  
**Steps:**
1. Click "✏️ Search by Title"
2. Enter: Amazing Fantasy, 15, 1962
3. Click "Search →"
4. Verify badge: "🔴 MANUAL REVIEW"
5. Check Vercel logs

**Expected Logs:**
```
✅ [mega-key] ...
❌ [claude-check] ... (should NOT appear)
```

**Result:** PASS / FAIL / ___________

---

### SCENARIO 5: CGC Graded

**Input:** Amazing Spider-Man #300 CGC 9.8  
**Steps:**
1. Scan CGC slab OR enter manually
2. Check for GoCollect FMV panel (purple)
3. Check Vercel logs

**Expected Logs:**
```
✅ [gocollect] ...
❌ [claude-check] ... (should NOT appear)
```

**Result:** PASS / FAIL / ___________

---

### SCENARIO 6: Zero Comps (EXPECTED FAIL)

**Input:** Mighty World of Marvel #185 (1976)  
**Steps:**
1. Click "✏️ Search by Title"
2. Enter: Mighty World of Marvel, 185, 1976
3. Click "Search →"
4. Check Vercel logs

**Expected Logs:**
```
❌ [claude-check] web search mode triggered (rawComps=0)
❌ Error: ANTHROPIC_API_KEY not set
```

**Result:** EXPECTED FAIL (web search fires) / ___________

---

### SCENARIO 7: Variant

**Input:** Amazing Spider-Man #300 (1988) newsstand  
**Steps:**
1. Scan or manual entry
2. Check for variant premium in price
3. Check Vercel logs

**Expected Logs:**
```
✅ [variant] ...
✅ [comps] variant-specific: ...
✅ [claude-check] zero conflicts — skip AI call
❌ [claude-check] conflicts detected (should NOT appear if clean)
```

**Result:** PASS / FAIL / ___________

---

### SCENARIO 8: Manual Fallback (INCOMPLETE)

**Input:** Check manual entry form  
**Steps:**
1. Click "✏️ Search by Title"
2. Inspect form fields

**Expected:**
- ❌ NO grade field
- ❌ NO publisher field
- ✅ Only: Title, Issue #, Year

**Result:** INCOMPLETE (missing fields confirmed) / ___________

---

### SCENARIO 9: Bulk Manual (3 Books)

**Input:** Batman #1, Detective #27, Action #1  
**Steps:**
1. Enter Batman #1 (1940) → Search
2. Enter Detective Comics #27 (1939) → Search
3. Enter Action Comics #1 (1938) → Search
4. Check Vercel logs for 3 separate enrich calls

**Expected Logs (×3):**
```
✅ [manual] identity locked: Batman #1
✅ [manual] identity locked: Detective Comics #27
✅ [manual] identity locked: Action Comics #1
✅ [claude-check] zero conflicts — skip AI call (×3)
❌ [claude-check] conflicts detected (should NOT appear ×3)
```

**Result:** PASS / FAIL / ___________

---

### SCENARIO 10: Reprint Detection

**Input:** Batman #1 (2016)  
**Steps:**
1. Click "✏️ Search by Title"
2. Enter: Batman, 1, 2016
3. Click "Search →"
4. Check for reprint warning
5. Check Vercel logs

**Expected Logs:**
```
✅ [Filter 1] reprint: ...
✅ [decision] RESEARCH
❌ [claude-check] ... (should NOT appear)
```

**Result:** PASS / FAIL / ___________

---

## RESULTS TABLE

| # | Scenario | Expected AI | Actual AI | Pass/Fail |
|---|----------|-------------|-----------|-----------|
| 1 | Barcode scan | NO | _____ | _____ |
| 2 | Title search | NO (if clean) | _____ | _____ |
| 3 | UK edition | NO | _____ | **EXP FAIL** |
| 4 | Mega-key | NO | _____ | _____ |
| 5 | CGC graded | NO | _____ | _____ |
| 6 | Zero comps | NO | _____ | **EXP FAIL** |
| 7 | Variant | NO (if clean) | _____ | _____ |
| 8 | Manual fallback | N/A | _____ | **INCOMPLETE** |
| 9 | Bulk manual | NO (if clean) | _____ | _____ |
| 10 | Reprint | NO | _____ | _____ |

**AI Fire Rate:** _____ / 10  
**Expected:** 2/10 (scenarios 3, 6)  
**Pass Rate:** _____ / 10  

---

## CLEANUP

```bash
# Restore Anthropic key
vercel env add ANTHROPIC_API_KEY production
# Paste key value

vercel env add ANTHROPIC_API_KEY preview
# Paste key value

# Redeploy
git commit --allow-empty -m "test: restore AI key"
git push origin main
```

---

## CONCLUSION

Based on test results:

- **Deterministic coverage:** _____ / 10 scenarios
- **AI fire rate:** _____ %
- **Bugs found:** _____
- **Optimizations needed:** _____

**Next steps:**
1. Fix web search gate (scenarios 3, 6)
2. Add manual entry fields (scenario 8)
3. Widen year tolerance (reduce false conflicts)
4. Implement UK kill switch

---

**Test Date:** ___________  
**Tester:** ___________  
**Environment:** Production  
**ANTHROPIC_API_KEY:** REMOVED  
