# MANUAL COVERAGE TEST INSTRUCTIONS

**Purpose:** Verify all 10 scenarios work WITHOUT Anthropic AI  
**Requirement:** Must test with `ANTHROPIC_API_KEY` **removed** from Vercel  
**Time Required:** 30-45 minutes  

---

## SETUP (Critical)

### Step 1: Remove Anthropic Key from Vercel

```bash
# SSH into Vercel dashboard or use CLI
vercel env rm ANTHROPIC_API_KEY production
vercel env rm ANTHROPIC_API_KEY preview

# Verify removal
vercel env ls
# Should NOT show ANTHROPIC_API_KEY
```

### Step 2: Redeploy

```bash
git commit --allow-empty -m "test: trigger redeploy without AI key"
git push origin main
# Wait for deploy to complete (~2 minutes)
```

### Step 3: Open Production Site

```
https://comic-vault-rouge.vercel.app
```

---

## TEST SCENARIOS

### ✅ SCENARIO 1: Barcode Scan (Modern Comic)

**Input:**
- Open PWA in browser
- Click camera icon
- Scan barcode OR manually enter UPC: `75960620200800111`

**Expected:**
- Identity resolves from ComicVine UPC
- Price appears
- NO `[claude-check]` logs in Vercel function logs

**Verify:**
```bash
vercel logs --follow
# Look for:
✅ [barcode] identity resolved: ...
✅ [pricecharting] ...
✅ [comps] ...
❌ [claude-check] ... (should NOT appear)
```

**Pass/Fail:** ___________

---

### ✅ SCENARIO 2: Title Search (Bronze/Silver/Golden)

**Input:**
1. Click "✏️ Search by Title" button
2. Enter:
   - Title: `Batman`
   - Issue #: `222`
   - Year: `1970`
3. Click "Search →"

**Expected:**
- Price appears
- Decision badge shows (LIST_NOW / RESEARCH / etc.)
- NO AI call if PC + CV + eBay agree

**Verify:**
```bash
vercel logs --follow
# Look for:
✅ [manual] identity locked: Batman #222
✅ [pricecharting] ...
✅ [comicvine] ...
✅ [comps] ...
✅ [decision] ...
❌ [claude-check] conflicts detected — AI call fired (should NOT appear if zero conflicts)
✅ [claude-check] zero conflicts — skip AI call (GOOD)
```

**Pass/Fail:** ___________

---

### ⚠️ SCENARIO 3: UK Edition (EXPECTED FAIL)

**Input:**
1. Click "✏️ Search by Title"
2. Enter:
   - Title: `Mighty World of Marvel`
   - Issue #: `157`
   - Year: `1975`
3. Click "Search →"

**Expected:**
- ❌ Web search fires (NO UK kill switch implemented)
- Error: "ANTHROPIC_API_KEY not set" (because we removed it)

**Verify:**
```bash
vercel logs --follow
# Look for:
❌ [claude-check] web search mode triggered (rawComps=0)
❌ Error: ANTHROPIC_API_KEY not set
```

**Pass/Fail:** EXPECTED FAIL (web search fires)

---

### ✅ SCENARIO 4: Mega-Key (Known Key Issue)

**Input:**
1. Click "✏️ Search by Title"
2. Enter:
   - Title: `Amazing Fantasy`
   - Issue #: `15`
   - Year: `1962`
3. Click "Search →"

**Expected:**
- Badge: "🔴 MANUAL REVIEW"
- NO AI call (mega-key floor map is deterministic)

**Verify:**
```bash
vercel logs --follow
# Look for:
✅ [mega-key] ...
❌ [claude-check] ... (should NOT appear)
```

**Pass/Fail:** ___________

---

### ✅ SCENARIO 5: CGC Graded

**Input:**
1. Scan or enter: `Amazing Spider-Man 300 CGC 9.8`
2. OR use manual entry with grade field (if available)

**Expected:**
- GoCollect FMV appears (purple panel)
- NO Anthropic AI call (GoCollect is separate API)

**Verify:**
```bash
vercel logs --follow
# Look for:
✅ [gocollect] ...
❌ [claude-check] ... (should NOT appear)
```

**Pass/Fail:** ___________

---

### ⚠️ SCENARIO 6: Zero Comps (EXPECTED FAIL)

**Input:**
1. Click "✏️ Search by Title"
2. Enter:
   - Title: `Mighty World of Marvel`
   - Issue #: `185`
   - Year: `1976`
3. Click "Search →"

**Expected:**
- ❌ Web search fires (zero eBay comps found)
- Error: "ANTHROPIC_API_KEY not set"

**Verify:**
```bash
vercel logs --follow
# Look for:
❌ [claude-check] web search mode triggered (rawComps=0)
❌ Error: ANTHROPIC_API_KEY not set
```

**Pass/Fail:** EXPECTED FAIL (web search fires)

---

### ✅ SCENARIO 7: Variant

**Input:**
1. Click "✏️ Search by Title"
2. Enter:
   - Title: `Amazing Spider-Man`
   - Issue #: `300`
   - Year: `1988`
   - (No variant field in manual entry, but test via scan)
3. Click "Search →"

**Expected:**
- Price appears with variant premium (if eBay comps have newsstand)
- NO AI call if zero conflicts

**Verify:**
```bash
vercel logs --follow
# Look for:
✅ [variant] ...
✅ [comps] variant-specific: ...
❌ [claude-check] conflicts detected (should NOT appear if clean)
```

**Pass/Fail:** ___________

---

### ⚠️ SCENARIO 8: Manual Fallback (INCOMPLETE)

**Input:**
1. Try to enter grade in manual entry form

**Expected:**
- ❌ NO grade field available
- Manual entry only has: Title, Issue #, Year

**Verify:**
- Open browser inspector
- Check form fields in "Search by Title" section
- Grade input: NOT PRESENT

**Pass/Fail:** INCOMPLETE (feature missing)

---

### ✅ SCENARIO 9: Bulk Manual (3 Books)

**Input:**
1. Click "✏️ Search by Title" → Enter: `Batman` `1` `1940` → Search
2. Click "✏️ Search by Title" → Enter: `Detective Comics` `27` `1939` → Search
3. Click "✏️ Search by Title" → Enter: `Action Comics` `1` `1938` → Search

**Expected:**
- 3 books appear in collection
- Each processes independently
- NO AI calls if zero conflicts on each

**Verify:**
```bash
vercel logs --follow
# Look for 3 separate enrich calls:
✅ [manual] identity locked: Batman #1
✅ [manual] identity locked: Detective Comics #27
✅ [manual] identity locked: Action Comics #1
❌ [claude-check] conflicts detected (should NOT appear × 3)
```

**Pass/Fail:** ___________

---

### ✅ SCENARIO 10: Reprint Detection

**Input:**
1. Click "✏️ Search by Title"
2. Enter:
   - Title: `Batman`
   - Issue #: `1`
   - Year: `2016`
3. Click "Search →"

**Expected:**
- Reprint warning (if comp pool has "reprint" in titles)
- Decision: RESEARCH
- NO AI call (reprint detection is regex-based)

**Verify:**
```bash
vercel logs --follow
# Look for:
✅ [Filter 1] reprint: ...
✅ [decision] RESEARCH (reprint flag)
❌ [claude-check] ... (should NOT appear)
```

**Pass/Fail:** ___________

---

## RESULTS SUMMARY

| Scenario | Expected AI | Actual AI | Pass/Fail |
|----------|-------------|-----------|-----------|
| 1. Barcode | NO | _____ | _____ |
| 2. Title search | NO (if clean) | _____ | _____ |
| 3. UK edition | NO | _____ | **EXPECTED FAIL** |
| 4. Mega-key | NO | _____ | _____ |
| 5. CGC graded | NO | _____ | _____ |
| 6. Zero comps | NO | _____ | **EXPECTED FAIL** |
| 7. Variant | NO (if clean) | _____ | _____ |
| 8. Manual fallback | NO | _____ | **INCOMPLETE** |
| 9. Bulk manual | NO (if clean) | _____ | _____ |
| 10. Reprint | NO | _____ | _____ |

**AI Fire Rate:** _____ / 10 scenarios  
**Expected Failures:** 2 (scenarios 3, 6)  
**Incomplete:** 1 (scenario 8)  

---

## CLEANUP

### Restore Anthropic Key

```bash
# Add key back to Vercel
vercel env add ANTHROPIC_API_KEY production
# Paste key value when prompted

vercel env add ANTHROPIC_API_KEY preview
# Paste key value when prompted

# Redeploy
git commit --allow-empty -m "test: restore AI key"
git push origin main
```

---

## NOTES

- **Scenarios 3, 6 WILL FAIL** because web search fires on zero comps (no UK kill switch)
- **Scenario 8 is INCOMPLETE** because manual entry has no grade/publisher fields
- **All other scenarios should PASS** with zero AI calls

---

**Test Date:** ___________  
**Tester:** ___________  
**Environment:** Production (comic-vault-rouge.vercel.app)  
**ANTHROPIC_API_KEY:** REMOVED for testing  
