# Cert Corpus Protocol — Standing Regression Suite

**Status:** STANDING PROTOCOL (active)  
**Effective:** 2026-07-04  
**Scope:** All pricing/identity/comps changes  

---

## PROTOCOL

**Before ANY merge that touches:**
- Pricing logic (tier architecture, blend formulas, floors, multipliers)
- Identity resolution (title/issue/year/publisher detection)
- Comp filtering (sold verification, active verification, grade proximity)
- Match confidence (tier thresholds, display messages)
- Decision engine (LIST_NOW/RESEARCH/GRADE_CANDIDATE gates)

**MUST:**
1. Re-run 10-book cert corpus
2. Verify all 10 within gate bands
3. Confirm speed baseline met
4. Report pass/fail before merge

---

## CERT CORPUS (10 Books)

**Permanent regression suite:**

| Book | Gate Band | Tier | Source | Regression Check |
|------|-----------|------|--------|------------------|
| Batman #222 | $110-120 | 1 | verified_sold_recency | Tier selection, recency weights |
| Batman #423 | $160-175 | 1 | verified_sold_recency | Hot key trending |
| Wolverine #8 | $85-92 | 1 | verified_sold_recency | Floor conflict solved |
| Punisher #1 | $19-21 | 2 | sold_active_blend_30 | 70/30 blend |
| Venom #1 | $5-7 | 2 | sold_active_blend_30 | Modern cooled |
| House & Whipple #1 | $10-12 | 2 | sold_active_blend_30 | C5 lone-sold anchor |
| FF #96 | $11-14 | 2 | sold_active_blend_30 | Comp pipeline ~28/30 verified |
| Eternals #10 | $4-6 | 2 | sold_active_blend_30 | Thin pool conservative |
| Black Panther #1 | $30-38 | 1 | verified_sold_recency | Recency weighting |
| FF #135 | $6-9 | 3 | active_ask_derived | Ask discount 15% |

**Coverage:**
- Tier 1: 4 books (robust sold pools)
- Tier 2: 5 books (thin sold pools, blend, lone-sold)
- Tier 3: 1 book (active-only discount)
- Tier 4: 0 books (add if pc_estimate path changes)

**Comp regression:**
- FF #96: ~28/30 verified (comp filter chain baseline)

---

## SPEED BASELINE

**Cold bulk (10 books):** <100 seconds total

**Breakdown:**
- Grade phase: <15 seconds (10 Vision calls @ ~1.5s avg)
- Enrich phase: <85 seconds (10 enrich calls @ ~8.5s avg)

**Visibility:**
- Bulk counter: 10/10 (all books complete)
- Zero hung requests
- Zero enrichment failures

**Measured from:** First grade request → last enrich complete

**Cold start assumption:** No prompt cache, no API warmup

---

## GATE CRITERIA

### Price Gates (Primary)

**PASS:** Price within band  
**FAIL:** Price outside band

**Example:**
- Batman #222: $113.50 → PASS (gate $110-120)
- Batman #222: $108.00 → FAIL (below $110)
- Batman #222: $125.00 → FAIL (above $120)

**Tolerance:** NONE (strict bands)

---

### Source Gates (Secondary)

**PASS:** Source label matches expected tier  
**FAIL:** Source label incorrect

**Example:**
- Batman #222 tier=1 source=verified_sold_recency → PASS
- Batman #222 tier=1 source=pc_estimate → FAIL (wrong source)

---

### Floor Gates (Tertiary)

**PASS:** Zero ask-floor artifacts in [price-trace]  
**FAIL:** Ask-floor present (rawComps.lowest in floor log)

**Check:**
- `[floor] skipped — tier N owns floor enforcement` → PASS
- `[floor] price $X < floor $Y (raw $Z, cap $W)` where Z = ask-derived → FAIL

---

### Comp Regression Gates

**FF #96 specific:**
- Verified sold count: ≥25 (was ~28/30 at baseline)
- Filter chain: title/issue/variant/grade/lot/signed/dedup
- PASS: ≥25 verified
- FAIL: <25 verified (filter too aggressive)

---

## EXECUTION PROTOCOL

### 1. Prepare Corpus

**Create test batch:**
```json
[
  { "title": "Batman", "issue": "222", "year": "1970", "publisher": "DC", "grade": "VF" },
  { "title": "Batman", "issue": "423", "year": "1988", "publisher": "DC", "grade": "NM" },
  { "title": "Wolverine", "issue": "8", "year": "1989", "publisher": "Marvel", "grade": "NM" },
  { "title": "Punisher", "issue": "1", "year": "2000", "publisher": "Marvel", "grade": "VF+" },
  { "title": "Venom", "issue": "1", "year": "2018", "publisher": "Marvel", "grade": "NM+" },
  { "title": "House & Whipple", "issue": "1", "year": "2023", "publisher": "Independent", "grade": "NM" },
  { "title": "Fantastic Four", "issue": "96", "year": "1970", "publisher": "Marvel", "grade": "VF" },
  { "title": "Eternals", "issue": "10", "year": "1977", "publisher": "Marvel", "grade": "VF" },
  { "title": "Black Panther", "issue": "1", "year": "1977", "publisher": "Marvel", "grade": "VF" },
  { "title": "Fantastic Four", "issue": "135", "year": "1973", "publisher": "Marvel", "grade": "VF" }
]
```

---

### 2. Run Bulk Scan

**Timing:**
```
START: Note timestamp
→ Bulk import (10 books)
→ Grade phase completes
→ Enrich phase completes
END: Note timestamp
```

**Extract:**
- Total time: END - START
- Grade phase: last grade complete - first grade start
- Enrich phase: last enrich complete - first enrich start
- Counter: should show "Processing 10 of 10" → "Complete"

---

### 3. Validate Results

**For each book:**

1. **Price gate:**
   - Check card price
   - Verify within band
   - ✓ PASS / ✗ FAIL

2. **Source gate:**
   - Check pricingSource label
   - Verify matches expected tier source
   - ✓ PASS / ✗ FAIL

3. **Floor gate:**
   - Check [price-trace] logs
   - Verify no ask-floor artifacts
   - ✓ PASS / ✗ FAIL

4. **Tier gate:**
   - Check tier number
   - Verify matches expected (1/2/3)
   - ✓ PASS / ✗ FAIL

**Comp regression (FF #96 only):**
- Check soldCompDiagnostics.verifiedCount
- Verify ≥25
- ✓ PASS / ✗ FAIL

---

### 4. Report Format

```
CERT CORPUS RESULTS

SPEED BASELINE:
- Total: XXs (target <100s) ✓/✗
- Grade phase: XXs (target <15s) ✓/✗
- Enrich phase: XXs (target <85s) ✓/✗
- Counter: 10/10 complete ✓/✗

PRICE GATES: X/10 PASS
- Batman #222: $XXX (gate $110-120) ✓/✗
- Batman #423: $XXX (gate $160-175) ✓/✗
- Wolverine #8: $XXX (gate $85-92) ✓/✗
- Punisher #1: $XXX (gate $19-21) ✓/✗
- Venom #1: $XXX (gate $5-7) ✓/✗
- House & Whipple #1: $XXX (gate $10-12) ✓/✗
- FF #96: $XXX (gate $11-14) ✓/✗
- Eternals #10: $XXX (gate $4-6) ✓/✗
- Black Panther #1: $XXX (gate $30-38) ✓/✗
- FF #135: $XXX (gate $6-9) ✓/✗

SOURCE GATES: X/10 PASS
- Batman #222: tier=N source=Y ✓/✗
- [repeat for all 10]

FLOOR GATES: X/10 PASS
- [check ask-floor artifacts]

COMP REGRESSION:
- FF #96: XX verified (≥25 target) ✓/✗

OVERALL: PASS/FAIL (requires 10/10 price + 10/10 source + 10/10 floor + comp regression)
```

---

### 5. Merge Decision

**PASS (all gates met):**
- ✅ Merge authorized
- Update PRICING_ENGINE_COMPLETE.md with new baseline if changed

**FAIL (any gate missed):**
- ❌ Merge BLOCKED
- Investigate regression
- Fix issue
- Re-run corpus
- Repeat until PASS

---

## CORPUS MAINTENANCE

### Add New Books

**When:**
- New tier path added (e.g., tier 4 pc_estimate changes)
- New comp filter introduced (needs baseline)
- Edge case discovered in production (add to corpus)

**How:**
1. Define gate band (±10% of verified price)
2. Add to corpus list
3. Document regression check (what it validates)
4. Update protocol doc

---

### Update Gate Bands

**When:**
- Market prices shift significantly (>20% from band)
- Tier architecture changes fundamentally
- All 10 books fail same direction (systemic shift)

**How:**
1. Document reason for band update
2. Get user approval
3. Update CERT_CORPUS_PROTOCOL.md
4. Update PRICING_ENGINE_COMPLETE.md
5. Re-run corpus with new bands

**NOT ALLOWED:**
- Widen bands to pass failing test (cheating)
- Remove books from corpus to hide regression
- Skip corpus on "minor" pricing changes

---

## STANDING EXCEPTIONS

**Skip corpus when change is:**
- UI-only (no pricing/identity/comps logic)
- Documentation-only
- Logging/instrumentation-only
- Non-pricing fields (e.g., creator credits display)

**Required when change touches:**
- src/lib/priceBands.js
- src/lib/soldVerification.js
- src/lib/compHygiene.js
- src/lib/identityCore.js
- src/lib/decisionEngine.js
- api/enrich.js (pricing/identity sections)
- api/comps.js
- Any tier/floor/blend/multiplier logic

**When uncertain:** Run corpus (safer than skip)

---

## HISTORICAL BASELINE

**First corpus run:** 2026-07-04 (Ship #20b deployment)

**Baseline results:**
- Speed: TBD (awaiting first bulk run)
- Price gates: 10/10 projected PASS (design validation)
- Source gates: 10/10 projected PASS (FIX1 deployed)
- Floor gates: 10/10 projected PASS (FIX2 deployed)
- Comp regression: FF #96 baseline TBD

**Future baselines:**
- Each corpus run updates baseline
- Track trends: speed improving/degrading, gate pass rate
- Regression detected when PASS → FAIL without code change

---

## COMPLIANCE

**This protocol is MANDATORY.**

**Bypassing corpus = pricing trust violation.**

**User can override ONLY when:**
- Production incident requires hotfix (run corpus after)
- Corpus infrastructure broken (fix infra first)
- Explicit greenlight given for experimental branch

**Otherwise:** No corpus run = no merge.

---

**END PROTOCOL**

**Effective immediately:** All pricing/identity/comps changes subject to 10-book cert corpus validation.
