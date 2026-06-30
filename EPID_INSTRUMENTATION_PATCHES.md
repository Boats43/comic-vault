# EPID INSTRUMENTATION PATCHES
**Purpose:** Temporary logging to collect epid data for trust model testing  
**Status:** INVESTIGATION ONLY — NO PRODUCTION DEPLOYMENT

---

## PATCH 1: Image Search epid Extraction

**File:** `src/lib/imageSearchIdentity.js:260-270`

**BEFORE:**
```javascript
const parsed = {
  rawTitle,
  title: extractSeriesTitle(rawTitle),
  issue: extractIssueFromTitle(rawTitle),
  year: extractYearFromTitle(rawTitle),
  variantTokens: extractVariantTokens(rawTitle),
  price: !isNaN(priceVal) && priceVal > 0 ? priceVal : null,
  itemWebUrl: it?.itemWebUrl || null,
  endTime: it?.itemEndDate || null,
};
return parsed;
```

**AFTER (TEMP):**
```javascript
const parsed = {
  rawTitle,
  title: extractSeriesTitle(rawTitle),
  issue: extractIssueFromTitle(rawTitle),
  year: extractYearFromTitle(rawTitle),
  variantTokens: extractVariantTokens(rawTitle),
  price: !isNaN(priceVal) && priceVal > 0 ? priceVal : null,
  itemWebUrl: it?.itemWebUrl || null,
  endTime: it?.itemEndDate || null,
  epid: it?.epid || null,  // ← TEMP: epid extraction for testing
};
// TEMP: Log epid for empirical testing
if (it?.epid) {
  console.log(`[epid-test-image] item ${idx}: epid=${it.epid} title="${rawTitle}"`);
}
return parsed;
```

---

## PATCH 2: Browse API epid Extraction

**File:** `api/comps.js:289-300`

**BEFORE:**
```javascript
return items
  .map((it) => {
    const price = it?.price?.value != null ? parseFloat(it.price.value) : NaN;
    if (isNaN(price) || price <= 0) return null;
    return {
      price,
      endTime: it?.itemEndDate || null,
      title: it?.title || null,
      url: it?.itemWebUrl || null,
    };
  })
  .filter(Boolean);
```

**AFTER (TEMP):**
```javascript
return items
  .map((it) => {
    const price = it?.price?.value != null ? parseFloat(it.price.value) : NaN;
    if (isNaN(price) || price <= 0) return null;
    const epid = it?.epid || null;
    // TEMP: Log epid for empirical testing
    if (epid) {
      console.log(`[epid-test-browse] epid=${epid} price=${price.toFixed(2)} title="${it?.title}"`);
    }
    return {
      price,
      endTime: it?.itemEndDate || null,
      title: it?.title || null,
      url: it?.itemWebUrl || null,
      epid,  // ← TEMP: epid field for testing
    };
  })
  .filter(Boolean);
```

---

## PATCH 3: Aggregate epid Summary Log

**File:** `api/enrich.js` (after image search call, line ~1420)

**ADD AFTER LINE 1420:**
```javascript
// TEMP: Log epid summary for trust model testing
if (visualResult?.items) {
  const epidCounts = {
    total: visualResult.items.length,
    withEpid: visualResult.items.filter(it => it.epid).length,
    epids: visualResult.items.filter(it => it.epid).map(it => ({
      epid: it.epid,
      title: it.rawTitle
    }))
  };
  console.log('[epid-test-summary-image]', JSON.stringify(epidCounts));
}
```

**ADD AFTER BROWSE API CALL (api/comps.js, after line ~300):**
```javascript
// TEMP: Log browse epid summary
const epidSummary = {
  total: items.length,
  withEpid: items.filter(it => it.epid).length,
  epidList: items.filter(it => it.epid).map(it => it.epid)
};
if (epidSummary.withEpid > 0) {
  console.log('[epid-test-summary-browse]', JSON.stringify(epidSummary));
}
```

---

## DATA COLLECTION PROTOCOL

### Step 1: Deploy Instrumented Code
```bash
# Apply patches locally (DO NOT PUSH TO PRODUCTION)
# Apply PATCH 1, PATCH 2, PATCH 3
npm run build  # Verify compiles
```

### Step 2: Run Each Test Book
For each of 5 test books:
1. Scan via UI (standard scan, not Watch Mode)
2. Capture browser console logs
3. Search for `[epid-test-image]`, `[epid-test-browse]`, `[epid-test-summary-*]`
4. Record epid values + titles

### Step 3: Cross-Check PriceCharting
For each epid found:
```bash
# Call PC API directly
curl -H "X-Api-Key: $PRICECHARTING_TOKEN" \
  "https://www.pricecharting.com/api/products?id={epid}"

# Record:
# - Product name (does it match expected?)
# - ebay-id field (does it match epid?)
# - Any discrepancies
```

### Step 4: Fill Test Matrix
Use template from `test-epid-extraction.mjs` output.

### Step 5: Revert Instrumentation
```bash
# Remove PATCH 1, PATCH 2, PATCH 3
git checkout src/lib/imageSearchIdentity.js
git checkout api/comps.js
git checkout api/enrich.js
# DO NOT COMMIT instrumented code
```

---

## TRUST MODEL DEFINITIONS

### Model A: epid Override (aggressive)
```javascript
const shouldSkip = epidPresent && pcMatchCorrect;
```
**Skip when:** eBay returns epid AND PC lookup succeeds  
**Risk:** May skip on wrong-volume matches if PC has duplicate epids

### Model B: epid + Consensus (safe)
```javascript
const shouldSkip = epidPresent && pcMatchCorrect && ebayConsensus >= 0.80;
```
**Skip when:** epid + PC match + 80%+ title consensus  
**Risk:** Conservative, may under-skip on clean books with low consensus

### Model C: Hybrid (mega-key aware)
```javascript
const shouldSkip = epidPresent && pcMatchCorrect && 
                   (isMegaKey ? ebayConsensus >= 0.85 : true);
```
**Skip when:** epid + PC match + (consensus 85% if mega-key, else always)  
**Risk:** Balanced, protects mega-keys but aggressive on regular books

---

## EXPECTED OUTCOMES

### Hypothesis 1: epid Coverage
- **Prediction:** 60-80% of books will have epid in image search results
- **Why:** eBay Product IDs exist for popular comics, rare for obscure titles
- **Test:** Count `withEpid / total` across 5 books

### Hypothesis 2: PC Match Accuracy
- **Prediction:** 95%+ of epids will match correct PC product
- **Why:** epid is canonical eBay→PC bridge per eBay docs
- **Test:** Manual verification of PC product names vs expected

### Hypothesis 3: False Skip Rate
- **Prediction:** Model A = 5-10% false skips, Model B = 0-2%, Model C = 2-5%
- **Why:** Model A has no consensus gate, Model B too conservative, Model C balanced
- **Test:** Count false skips (should have fired Claude but model skipped)

### Hypothesis 4: Optimal Model
- **Prediction:** Model C will have highest accuracy + zero false skips
- **Why:** Mega-key protection + aggressive skip on regular books
- **Test:** Compare accuracy across all 3 models

---

## ROLLBACK PLAN

If testing reveals epid is unreliable:
1. ❌ DO NOT implement epid extraction
2. ✅ Document findings in audit report
3. ✅ Re-evaluate after eBay API improvements

If testing confirms epid reliability:
1. ✅ Implement chosen model (A/B/C) based on empirical results
2. ✅ Add epid to production extraction (remove TEMP flags)
3. ✅ Monitor skip rate in production logs
4. ✅ Rollback if false skip rate > 5%

---

**END INSTRUMENTATION GUIDE**
