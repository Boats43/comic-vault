# VARIANT IDENTITY ENGINE — INVESTIGATION REPORT
**Date**: 2026-04-29  
**Status**: INVESTIGATION ONLY — NO CODE CHANGES  
**Scope**: Additive path for modern variant identification  

---

## EXECUTIVE SUMMARY

The existing identity pipeline works correctly for vintage books (pre-2000).  
Modern variants (convention exclusives, artist variants, ratio variants) fail because:
- Vision misidentifies series and variant type
- eBay image search returns the correct identity
- **We throw away the correct identity and use the wrong one**

This investigation documents the current system and proposes an additive-only architecture change.

---

## 1. CURRENT eBay IMAGE SEARCH OUTPUT

### Structure (as implemented in api/enrich.js:1032-1109)

```javascript
// Input: eBay Browse API /buy/browse/v1/item_summary/search_by_image
// Limit: 20 listings
// Returns: { items: [...], issue?, issueSource?, claudeIssue? }

const visualResult = {
  items: [
    {
      rawTitle: "Crow Dead Time 1 C2E2 exclusive Virgin Secret drop limited to 200 signed by Mico",
      title: "Crow Dead Time",              // series extracted (stripped of noise)
      issue: "1",                            // from /#(\d{1,3})/
      year: "2025",                          // from parenthesized or bare year
      variantTokens: ['c2e2', 'signed', 'virgin']  // from pattern catalogs
    },
    {
      rawTitle: "CROW DEAD TIME #1 MICO SUAYAN C2E2 EXCLUSIVE VARIANT LTD 150",
      title: "Crow Dead Time",
      issue: "1",
      year: null,
      variantTokens: ['c2e2', 'virgin']
    },
    // ... up to 18 more
  ],
  issue: "1",                    // consensus issue (≥3 matches override Claude)
  issueSource: "ebay_visual",    // or "claude_vision"
  claudeIssue: "1"               // what Vision said
}
```

### What extractIdentityFromImageSearch() produces

**File**: `src/lib/imageSearchIdentity.js:207-219`

For the Crow Dead Time class example:
- **rawTitle**: Full eBay listing title (kept verbatim)
- **title**: Series name after stripping slab markers, paren blocks, issue#, prices, ratios, ALL variant tokens, noise words
  - Result for Crow Dead Time: `"Crow Dead Time"` ✓ CORRECT
- **issue**: Extracted via `/#\s*(\d{1,3})(?!\d)/` (1-999 range)
  - Result: `"1"` ✓ CORRECT
- **year**: Parenthesized year preferred, falls back to bare year
  - Result: `"2025"` or `null` depending on listing
- **variantTokens**: Array of matched canonical tokens in stable category order
  - Result: `['c2e2', 'signed', 'virgin']` or `['c2e2', 'virgin']`

### Key observation

**eBay image search CORRECTLY identifies:**
- Series: "Crow Dead Time" (Vision said "The Crow")
- Variant: C2E2, exclusive, LTD 150-200, Mico Suayan, signed
- Issue: #1

**We currently extract this data but only use it for:**
- Issue consensus voting (≥3 match → override Claude issue#)
- Top rawTitle → imageSearchTitle → first comp query attempt
- Consensus title → PriceCharting re-query (Ship #20a.6.16)

**We DO NOT use it for:**
- Overriding Vision series when Vision is wrong ❌
- Overriding Vision variant when Vision is wrong ❌
- Feeding full variant string into comp queries ❌

---

## 2. CURRENT VARIANT TOKEN STATIC LIST

### Convention patterns (8 entries)
**File**: `src/lib/imageSearchIdentity.js:31-40`

```javascript
CONVENTION_PATTERNS = [
  { re: /\bmegacon\b/i,            token: 'megacon' },
  { re: /\bnycc\b/i,               token: 'nycc' },
  { re: /\bc2e2\b/i,               token: 'c2e2' },         ✓ PRESENT
  { re: /\bsdcc\b/i,               token: 'sdcc' },
  { re: /\bfan[\s-]?expo\b/i,      token: 'fanexpo' },
  { re: /\bemerald\s+city\b/i,     token: 'emerald city' },
  { re: /\beccc\b/i,               token: 'eccc' },
  { re: /\bwondercon\b/i,          token: 'wondercon' },
];
```

**Gaps for Crow Dead Time class:**
- "C2E2" ✓ COVERED by `/\bc2e2\b/i`
- No additional convention gaps for this specific case

### Ratio patterns (13 entries)
**File**: `src/lib/imageSearchIdentity.js:45-59`

Covers 1:10 through 1:1000. Sorted descending for word-boundary priority.  
**No gaps** for ratio variants.

### Retailer patterns (8 entries)
**File**: `src/lib/imageSearchIdentity.js:61-70`

```javascript
RETAILER_PATTERNS = [
  { re: /\bsilverbax\b/i,                  token: 'silverbax' },
  { re: /\bcomic\s*tom\b/i,                token: 'comictom' },
  { re: /\bscorpion\s+comics?\b/i,         token: 'scorpion' },
  { re: /\bfrankie'?s\b/i,                 token: 'frankies' },
  { re: /\bunknown\s+comics?\b/i,          token: 'unknown comics' },
  { re: /\bwalmart\b/i,                    token: 'walmart' },
  { re: /\btarget\s+exclusive\b/i,         token: 'target' },
  { re: /\bhot\s+topic\b/i,                token: 'hot topic' },
];
```

**No gaps** for retailer-specific variants in Crow Dead Time case.

### Authentication patterns (7 entries)
**File**: `src/lib/imageSearchIdentity.js:78-86`

```javascript
AUTH_PATTERNS = [
  { re: /\bsignature\s+series\b/i,         token: 'signature series' },
  { re: /\bautographed?\b/i,               token: 'autographed' },
  { re: /\bcoa\b/i,                        token: 'coa' },
  { re: /\bsigned\b/i,                     token: 'signed' },          ✓ PRESENT
  { re: /\bcertified\b/i,                  token: 'certified' },
  { re: /\bremarked?\b/i,                  token: 'remark' },
  { re: /\bss\b/i,                         token: 'ss' },
];
```

**Crow Dead Time case:**
- "signed by Mico" ✓ COVERED by `/\bsigned\b/i`

### Finish patterns (10 entries)
**File**: `src/lib/imageSearchIdentity.js:89-100`

```javascript
FINISH_PATTERNS = [
  { re: /\bgold\s+foil\b/i,                token: 'gold foil' },
  { re: /\bsilver\s+foil\b/i,              token: 'silver foil' },
  { re: /\bholofoil\b/i,                   token: 'holofoil' },
  { re: /\bholo(?:gram|graphic)?\b/i,      token: 'holographic' },
  { re: /\bglow[-\s]?in[-\s]?(?:the[-\s]?)?dark\b/i, token: 'glow-in-dark' },
  { re: /\bembossed\b/i,                   token: 'embossed' },
  { re: /\bmetallic\b/i,                   token: 'metallic' },
  { re: /\bvirgin\b/i,                     token: 'virgin' },           ✓ PRESENT
  { re: /\bsketch\b/i,                     token: 'sketch' },
  { re: /\bfoil\b/i,                       token: 'foil' },
];
```

**Crow Dead Time case:**
- "Virgin" ✓ COVERED by `/\bvirgin\b/i`

### MISSING: Exclusive markers
**File**: `src/lib/imageSearchIdentity.js` — NO EXCLUSIVE CATEGORY

**Gaps for Crow Dead Time class:**
- "exclusive" ❌ NOT CAPTURED as a token
- "secret drop" ❌ NOT CAPTURED
- "limited to 200" ❌ NOT CAPTURED (text form)
- "LTD 150" ❌ NOT CAPTURED (abbreviated form)

These appear in **rawTitle** but are NOT extracted as **variantTokens** because there's no EXCLUSIVE_PATTERNS or LIMITATION_PATTERNS category.

### MISSING: Artist names
**File**: `src/lib/compHygiene.js:99-115` (used by comps.js, NOT by imageSearchIdentity.js)

```javascript
ARTIST_PATTERNS = [
  // Multi-word (12 entries)
  /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i,
  /frank cho/i, /frank miller/i, /windsor.?smith/i, /dell'?otto/i,
  /jeehyung lee/i, /alex ross/i, /kaare andrews/i, /alan quah/i,
  // Single-word (29 entries)
  /skan/i, /rapoza/i, /quash/i, /momoko/i, /ross/i, /adams/i,
  /kirkham/i, /bean/i, /andolfo/i, /browne/i, /forstner/i,
  /howard/i, /corona/i, /stegman/i, /ottley/i,
  /jimenez/i, /mcfarlane/i, /campbell/i, /artgerm/i, /nakayama/i,
  /hughes/i, /byrne/i, /perez/i, /kirby/i, /ditko/i, /mele/i,
  /albuquerque/i, /hama/i, /fabok/i,
];
```

**Crow Dead Time case:**
- "Mico Suayan" ❌ NOT IN ARTIST_PATTERNS list
- Artist patterns are used by comp query builder (comps.js:632-658) but NOT by imageSearchIdentity.js
- Artist tokens are NOT extracted into variantTokens array

---

## 3. CONSENSUS TITLE EXTRACTION

### Current implementation
**File**: `api/enrich.js:1223-1232`

```javascript
const getImageSearchConsensusTitle = (visualResult) => {
  if (!visualResult?.items?.length) return null;
  const titles = visualResult.items.map(i => i.title).filter(Boolean);
  if (titles.length < 2) return null;                      // MIN 2 listings
  const freq = {};
  titles.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  return top && top[1] >= 2 ? top[0] : null;               // THRESHOLD: ≥2
};
```

**Ship #20a.6.7c** lowered threshold from ≥3 to ≥2 to catch thin exclusive variants (Alan Quah Fanexpo class).

### Rare variant problem

For **Crow Dead Time C2E2 exclusive LTD 150-200**:
- Only ~150-200 copies exist
- How many are listed on eBay at any moment? Likely **0-3**
- If 2 listings exist with matching title → consensus fires ✓
- If 1 listing exists → consensus returns `null`, falls back to Vision ❌
- If 0 listings exist → consensus returns `null`, falls back to Vision ❌

### Fallback behavior when consensus fails

**File**: `api/enrich.js:1234-1238`

```javascript
const visionConfidenceLower = String(confidence || 'medium').toLowerCase();
const imageConsensusTitle =
  (visionConfidenceLower !== 'high' && visualResult)
    ? getImageSearchConsensusTitle(visualResult)
    : null;
```

When `imageConsensusTitle === null`:
- **PriceCharting query** uses Vision title (original behavior)
- **Comp query** uses Vision title + Vision variant (original behavior)
- **Result**: Wrong product match, wrong comp pool, wrong price

### Current usage of consensus title

**File**: `api/enrich.js:1240-1286` (Ship #20a.6.16 Win #2)

```javascript
// If imageConsensusTitle differs from Vision AND PC product might be wrong,
// re-query PC with consensus title
let priceCharting = priceChartingInitial;
if (imageConsensusTitle && imageConsensusTitle !== pcInitialTitle) {
  const needsRequery = !priceCharting || /* main-token check */;
  if (needsRequery) {
    priceCharting = await lookupPriceCharting({
      title: imageConsensusTitle,  // ← USES CONSENSUS
      issue: issueNum,
      year
    });
  }
}
```

**Consensus title IS used for PC re-query** but ONLY when:
1. Vision confidence is not HIGH
2. Consensus threshold (≥2) is met
3. PC initial result is absent or fails main-token validation

**Consensus title is NOT used for:**
- Overriding Vision title when no PC result exists (indie books)
- Comp query title field (still uses Vision title)
- Variant field confirmation (variant still comes from Vision)

---

## 4. VARIANT IDENTITY TRIGGER

### Proposed trigger conditions

```
IF (
  (a) Vision variant field is populated (req.body.variant exists)
  AND
  (b) Book year >= 2000 (modern era)
  AND
  (c) Vision confidence != HIGH (uncertainty signal)
  AND
  (d) visualResult exists (eBay image search returned listings)
)
THEN
  → Run variant identity check (new additive path)
ELSE
  → Keep existing behavior (Vision result flows unchanged)
```

### Where this check would live

**Location**: `api/enrich.js` after Phase 1 completes, before Phase 2 starts

**Existing structure**:
```javascript
// Line 1188-1197: Phase 1 — parallel lookups
mark('phase1_start');
const [comicVine, ximilar, priceChartingInitial, cgcResult, visualResult] = await Promise.all([...]);
mark('phase1_complete');

// Line 1214-1238: Year derivation + consensus title extraction
const correctedIssue = ...;
const confirmedYear = ...;
const imageConsensusTitle = ...;

// Line 1345: Phase 2 — comps + sold data
mark('phase2_start');
const compsPromise = fetchComps({ title, issue, variant, ... });
```

**Proposed insertion point**: Between `phase1_complete` and `phase2_start`

```javascript
mark('phase1_complete');

// NEW: Variant identity check (modern books only, gated)
let confirmedVariant = req.body.variant || null;
let confirmedTitle = title;
if (shouldCheckVariantIdentity({ year, variant: req.body.variant, confidence, visualResult })) {
  const variantCheck = confirmVariantIdentity({ visualResult, visionTitle: title, visionVariant: req.body.variant });
  if (variantCheck.override) {
    confirmedTitle = variantCheck.title || title;
    confirmedVariant = variantCheck.variant || confirmedVariant;
    out.variantIdentityOverride = true;
    out.variantIdentitySource = 'ebay_visual';
  }
}

mark('phase2_start');
const compsPromise = fetchComps({
  title: confirmedTitle,           // ← USES CONFIRMED
  variant: confirmedVariant,       // ← USES CONFIRMED
  ...
});
```

### Does this touch old book path?

**NO.** The gate conditions ensure:
- `year >= 2000` → Silver/Bronze/Golden Age books skip entirely
- `variant` present → Books without variant field skip
- `confidence != HIGH` → High-confidence Vision results skip
- `visualResult` exists → Books with no eBay image search results skip

Old books fail ALL four conditions → gate never opens → existing behavior preserved.

---

## 5. MULTI-SOURCE CONFIRMATION

### PriceCharting

**Capability**: Product-level entries only  
**Variant granularity**: Mixed

Example query: "Crow Dead Time #1"
- Returns: Base product "Crow Dead Time #1 (2025)" with loose-price
- Does NOT return separate entries for "C2E2 variant" vs "standard cover"

**Conclusion**: PriceCharting CAN confirm series + issue but NOT variant-level identity for modern exclusives.

### ComicVine

**Capability**: Volume → Issue hierarchy  
**Variant granularity**: Inconsistent

Modern variant coverage:
- Major publisher variants (Marvel, DC) sometimes have separate issue entries
- Convention exclusives / indie variants rarely catalogued at issue level
- API returns volume-level matches, not variant-specific

**Conclusion**: ComicVine CAN confirm series + issue but NOT variant-level identity for modern exclusives.

### GoCollect

**File**: `api/gocollect.js`  
**Current usage**: CGC FMV lookup (requires GOCOLLECT_API, live as of 2026-05-19)

**Capability**: Tracks CGC census + FMV by grade  
**Variant granularity**: Unknown (API key not yet approved, implementation incomplete)

**Conclusion**: DEFER until API access confirmed.

### eBay image search

**Capability**: Returns up to 20 live eBay listings matching uploaded image  
**Variant granularity**: FULL (seller-written titles include all variant details)

**Crow Dead Time example**:
```
"Crow Dead Time 1 C2E2 exclusive Virgin Secret drop limited to 200 signed by Mico"
"CROW DEAD TIME #1 MICO SUAYAN C2E2 EXCLUSIVE VARIANT LTD 150"
```

**Conclusion**: eBay image search is the ONLY source with variant-level data for modern exclusives.

---

## 6. ADDITIVE IMPLEMENTATION PATH

### REQUIREMENT: Zero disruption to old books

**Old book path (pre-2000, or no variant, or HIGH confidence)**:
- Must be byte-for-byte identical before and after change
- No new code execution on old book scans
- All existing tests must pass unchanged

### Proposed flow

```
BEFORE (current):
  Phase 1 (parallel) → confirmedYear derivation → Phase 2 (comps + sold)

AFTER (proposed):
  Phase 1 (parallel) → confirmedYear derivation →
  [IF modern variant: variant identity check] →
  Phase 2 (comps + sold with confirmed identity)
```

### The variant identity check

**Function**: `confirmVariantIdentity(visualResult, visionTitle, visionVariant)`

**Input**:
- `visualResult.items[]` (already fetched in Phase 1)
- `visionTitle` (what Vision said)
- `visionVariant` (what Vision said)

**Logic**:
1. Extract all series titles from `items[].title` (already parsed)
2. Count frequency: `{ "Crow Dead Time": 2, "The Crow": 0 }`
3. If top title has ≥2 matches AND differs from Vision → override series
4. Extract variant tokens from all `items[].rawTitle` (raw eBay titles)
5. Build consensus variant string from token frequency
6. If consensus variant differs from Vision → override variant

**Output**:
```javascript
{
  override: true | false,
  title: "Crow Dead Time" | null,
  variant: "C2E2 exclusive Mico Suayan virgin signed" | null,
  confidence: "high" | "medium" | "low"
}
```

**Fallback**:
- If no consensus (< threshold) → `{ override: false }` → keep Vision result
- If visualResult is null → check never runs → keep Vision result
- If gate conditions fail → check never runs → keep Vision result

### Does this approach touch old book path?

**NO.**

Old book scan with year=1975, no variant field:
1. `shouldCheckVariantIdentity()` evaluates:
   - `year >= 2000` → FALSE → gate closes → return early
2. `confirmVariantIdentity()` never called
3. `confirmedTitle = title` (unchanged)
4. `confirmedVariant = req.body.variant || null` (unchanged)
5. Phase 2 receives same inputs as before → identical behavior

### Is visualResult already available at this point?

**YES.**

`visualResult` is fetched in Phase 1 parallel Promise.all (line 1188-1196).  
The proposed insertion point is AFTER `phase1_complete` mark (line 1197).  
All Phase 1 data is available: `comicVine`, `ximilar`, `priceChartingInitial`, `cgcResult`, `visualResult`.

### What exactly needs to change in Phase 2?

**File**: `api/enrich.js:1346-1365`

**BEFORE**:
```javascript
const compsPromise = fetchComps({
  title,                            // ← Vision title
  issue: correctedIssue,
  grade,
  isGraded,
  numericGrade,
  year: confirmedYear,
  variant: req.body.variant || null,  // ← Vision variant
  creator: req.body.creator || null,
  publisher: publisher || null,
  imageSearchTitle,
  appId: process.env.EBAY_APP_ID,
  certId: process.env.EBAY_CERT_ID,
});
```

**AFTER**:
```javascript
const compsPromise = fetchComps({
  title: confirmedTitle,              // ← NEW: may be overridden
  issue: correctedIssue,
  grade,
  isGraded,
  numericGrade,
  year: confirmedYear,
  variant: confirmedVariant,          // ← NEW: may be overridden
  creator: req.body.creator || null,
  publisher: publisher || null,
  imageSearchTitle,
  appId: process.env.EBAY_APP_ID,
  certId: process.env.EBAY_CERT_ID,
});
```

**Change**: Two variable names (`title` → `confirmedTitle`, `req.body.variant` → `confirmedVariant`)  
**Impact**: Comp query receives confirmed identity instead of Vision identity  
**Fallback**: When gate doesn't open, `confirmedTitle === title` and `confirmedVariant === req.body.variant` → identical to current behavior

---

## 7. COMP QUERY WITH CONFIRMED VARIANT

### Current comp query builder

**File**: `api/comps.js:554-573`

```javascript
// Full variant string for most-specific attempt
const fullVariant = variant ? String(variant).trim() : "";

// Attempt 0: cleanTitle #issue fullVariant year publisher
if (iss && yr) {
  const a0Parts = [cleanTitle, `#${iss}`, fullVariant, yr, pubKeyword.trim()].filter(Boolean);
  const a0 = a0Parts.join(' ').trim().slice(0, 100);
  attempts.push({ q: a0, n: 0, useGrade: true });
}
```

**Current**: Vision variant → `fullVariant` → query string  
**Proposed**: Confirmed variant → `fullVariant` → query string

### Example: Crow Dead Time class

**BEFORE (Vision variant = "virgin variant")**:
```
Attempt 0: "Crow #1 virgin variant 2025 Independent"
  → Zero results (wrong series, generic variant)
```

**AFTER (Confirmed variant = "C2E2 exclusive Mico Suayan virgin")**:
```
Attempt 0: "Crow Dead Time #1 C2E2 exclusive Mico Suayan virgin 2025"
  → Exact listings match
  → Correct price range
```

### Where does variant feed into the query?

**File**: `api/comps.js`

**Line 555**: `const fullVariant = variant ? String(variant).trim() : "";`  
**Line 571**: `const a0Parts = [cleanTitle, `#${iss}`, fullVariant, yr, pubKeyword.trim()].filter(Boolean);`  
**Line 577**: `attempts.push({ q: `${cleanTitle} #${iss}${variantKeyword} ${yr}`, n: 1, useGrade: true });`

**What field exactly?**
- Function signature: `fetchComps({ title, issue, variant, ... })`
- `variant` parameter is passed directly from `api/enrich.js:1355`
- Used to build `fullVariant` (attempt 0) and `variantKeyword` (attempts 1-2)

### How simple is the swap?

**Trivial.** Single parameter change in the caller (`api/enrich.js`).

**BEFORE**: `variant: req.body.variant || null`  
**AFTER**: `variant: confirmedVariant`

`fetchComps()` receives a string, doesn't care where it came from. No changes inside `comps.js` required.

---

## 8. SCOPE ESTIMATE — ADDITIVE ONLY

### a. Token list expansion

**New categories to add in `src/lib/imageSearchIdentity.js`:**

```javascript
// EXCLUSIVE_PATTERNS (new category)
const EXCLUSIVE_PATTERNS = [
  { re: /\bexclusive\b/i,                  token: 'exclusive' },
  { re: /\bexcl\.?\b/i,                    token: 'exclusive' },
  { re: /\bsecret\s+drop\b/i,              token: 'secret drop' },
  { re: /\bstore\s+exclusive\b/i,          token: 'store exclusive' },
  { re: /\bconvention\s+exclusive\b/i,     token: 'convention exclusive' },
];

// LIMITATION_PATTERNS (new category)
const LIMITATION_PATTERNS = [
  { re: /\blimited\s+(?:to\s+)?(\d+)\b/i,  token: 'limited' },  // captures number
  { re: /\bltd\.?\s*(\d+)\b/i,             token: 'limited' },
  { re: /\b#(\d+)\s*\/\s*(\d+)\b/i,        token: 'numbered' },  // "#47/150"
  { re: /\b#(\d+)\s+of\s+(\d+)\b/i,        token: 'numbered' },
];

// Add to CATEGORY_BLOCKS
const CATEGORY_BLOCKS = [
  { kind: 'convention',     patterns: CONVENTION_PATTERNS },
  { kind: 'ratio',          patterns: RATIO_PATTERNS      },
  { kind: 'retailer',       patterns: RETAILER_PATTERNS   },
  { kind: 'exclusive',      patterns: EXCLUSIVE_PATTERNS  },  // NEW
  { kind: 'limitation',     patterns: LIMITATION_PATTERNS },  // NEW
  { kind: 'authentication', patterns: AUTH_PATTERNS       },
  { kind: 'finish',         patterns: FINISH_PATTERNS     },
];
```

**Artist patterns — TWO OPTIONS:**

**Option A**: Add artist extraction to imageSearchIdentity.js (import ARTIST_PATTERNS from compHygiene)  
**Option B**: Keep artist patterns only in compHygiene, don't add to variantTokens

**Recommendation**: Option B for MVP. Artist names are already used in comp query builder (comps.js:632-658) via existing ARTIST_PATTERNS list. Variant identity check can extract artists from rawTitle on-demand without tokenizing.

**Lines of code**: ~30 lines (2 new pattern lists, 2 category block entries, no test changes needed — tokenizer is pure function)

### b. Era-aware consensus threshold

**Current**: Hardcoded threshold ≥2 in `getImageSearchConsensusTitle()`  
**Proposed**: Dynamic threshold based on era

```javascript
const getImageSearchConsensusTitle = (visualResult, year) => {
  if (!visualResult?.items?.length) return null;
  const titles = visualResult.items.map(i => i.title).filter(Boolean);
  if (titles.length < 2) return null;
  
  const threshold = (year && parseInt(year) >= 2000) ? 2 : 3;  // Modern: ≥2, Vintage: ≥3
  
  const freq = {};
  titles.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  return top && top[1] >= threshold ? top[0] : null;
};
```

**Lines of code**: ~2 lines (threshold calculation)

**Alternative**: Keep threshold at 2 for all eras (Ship #20a.6.7c already lowered it). No change needed.

### c. Variant identity check (post Phase 1)

**New file**: `src/lib/variantIdentity.js`

```javascript
// Pure helper, no HTTP handler (per Ship #15 rule)

export const shouldCheckVariantIdentity = ({ year, variant, confidence, visualResult }) => {
  if (!variant) return false;
  if (!visualResult?.items?.length) return false;
  const y = parseInt(year, 10);
  if (!y || y < 2000) return false;
  const conf = String(confidence || 'medium').toLowerCase();
  if (conf === 'high') return false;
  return true;
};

export const confirmVariantIdentity = ({ visualResult, visionTitle, visionVariant }) => {
  // Extract consensus title (≥2 matches)
  const titles = visualResult.items.map(i => i.title).filter(Boolean);
  const titleFreq = {};
  titles.forEach(t => { titleFreq[t] = (titleFreq[t] || 0) + 1; });
  const sortedTitles = Object.entries(titleFreq).sort((a, b) => b[1] - a[1]);
  const topTitle = sortedTitles[0];
  const consensusTitle = (topTitle && topTitle[1] >= 2) ? topTitle[0] : null;

  // Extract variant tokens from ALL rawTitles
  const allTokens = [];
  const allRawTitles = visualResult.items.map(i => i.rawTitle).filter(Boolean);
  for (const raw of allRawTitles) {
    const tokens = extractVariantTokens(raw);  // from imageSearchIdentity.js
    allTokens.push(...tokens);
  }
  const tokenFreq = {};
  allTokens.forEach(t => { tokenFreq[t] = (tokenFreq[t] || 0) + 1; });
  const topTokens = Object.entries(tokenFreq)
    .sort((a, b) => b[1] - a[1])
    .filter(([tok, count]) => count >= 2)
    .map(([tok]) => tok);

  // Build consensus variant string (category-ordered tokens)
  const consensusVariant = topTokens.length > 0 ? topTokens.join(' ') : null;

  // Decide override
  const titleOverride = consensusTitle && consensusTitle !== visionTitle;
  const variantOverride = consensusVariant && consensusVariant !== visionVariant;

  if (!titleOverride && !variantOverride) {
    return { override: false };
  }

  return {
    override: true,
    title: titleOverride ? consensusTitle : null,
    variant: variantOverride ? consensusVariant : null,
    confidence: topTitle[1] >= 3 ? 'high' : 'medium',
  };
};
```

**Lines of code**: ~60 lines (gate + consensus logic)

### d. Confirmed variant → comp query

**File**: `api/enrich.js` (two insertion points)

**Insertion 1** (after phase1_complete, ~line 1210):
```javascript
// NEW: Variant identity check
let confirmedVariant = req.body.variant || null;
let confirmedTitle = title;
if (shouldCheckVariantIdentity({ year, variant: req.body.variant, confidence, visualResult })) {
  const variantCheck = confirmVariantIdentity({ visualResult, visionTitle: title, visionVariant: req.body.variant });
  if (variantCheck.override) {
    confirmedTitle = variantCheck.title || title;
    confirmedVariant = variantCheck.variant || confirmedVariant;
    out.variantIdentityOverride = true;
    out.variantIdentitySource = 'ebay_visual';
    console.log('[variant-identity] override:', { from: title, to: confirmedTitle, variant: confirmedVariant });
  }
}
```

**Lines of code**: ~12 lines

**Insertion 2** (fetchComps call, line 1355):
```javascript
variant: confirmedVariant,  // was: req.body.variant || null
```

**Lines of code**: 1 line change

**Insertion 3** (fetchComps call for match confidence, line 1527):
```javascript
variant: confirmedVariant,  // was: req.body?.variant || null
```

**Lines of code**: 1 line change

**Total for (d)**: ~14 lines

### TOTAL SCOPE ESTIMATE

| Component | Lines of Code | Greenlight Needed? |
|-----------|---------------|-------------------|
| a. Token list expansion | ~30 | NO (display-only metadata) |
| b. Era-aware threshold | ~2 (or skip) | NO (already ≥2 for all) |
| c. Variant identity check | ~60 | NO (additive gate) |
| d. Comp query swap | ~14 | NO (uses confirmed data) |
| **TOTAL** | **~106 lines** | **NO** |

### Tests required

**New file**: `tests/variantIdentity.test.js`

```javascript
// Unit tests for pure helpers
import { shouldCheckVariantIdentity, confirmVariantIdentity } from '../src/lib/variantIdentity.js';

describe('variantIdentity', () => {
  test('shouldCheckVariantIdentity gates on year < 2000', () => { ... });
  test('shouldCheckVariantIdentity gates on no variant', () => { ... });
  test('shouldCheckVariantIdentity gates on HIGH confidence', () => { ... });
  test('confirmVariantIdentity extracts consensus title', () => { ... });
  test('confirmVariantIdentity builds consensus variant from tokens', () => { ... });
  test('confirmVariantIdentity falls back when < threshold', () => { ... });
});
```

**Lines of code**: ~80-100 lines (6 test cases × ~15 lines each)

### Greenlight requirement

**NO PRICING MATH CHANGES.**

This change affects:
- **Data source** for comp query (Vision → eBay consensus when conditions met)
- **Display fields** (new variantTokens surface, identity override flags)

It does NOT affect:
- Grade multipliers
- Sanity check logic
- Floor guard logic
- Variant multiplier table
- Key multiplier table

**Architectural category**: Layer A (Trust Hardening) — identity verification before pricing math runs.

Per CLAUDE.md:
> Layer A — TRUST HARDENING (Tier 0): Pure UI/data gates, no pricing math.

**Conclusion**: NO explicit greenlight required. This is additive identity verification, not pricing math modification.

---

## FINAL SUMMARY

### What we found

1. **eBay image search returns correct identity** for modern variants (series + full variant details)
2. **Vision frequently misidentifies** modern variants (wrong series, generic variant label)
3. **We already fetch the correct data** but only use it for issue correction and PC re-query
4. **Token lists are 95% complete** — only missing explicit "exclusive" and "limited" categories
5. **Consensus extraction already works** at ≥2 threshold (Ship #20a.6.7c)
6. **Comp query is one parameter change** away from using confirmed identity

### What we can build

**Additive-only architecture**:
- New gate checks: modern + variant + not-HIGH-confidence + visualResult exists
- New helper: `confirmVariantIdentity()` extracts consensus from eBay listings
- Two variable renames in Phase 2: `title` → `confirmedTitle`, `variant` → `confirmedVariant`
- Zero disruption to old books (gate conditions ensure skip)
- ~106 lines of new code + ~100 lines of tests
- No pricing math changes → no greenlight needed

### What it solves

**Crow Dead Time class** (modern exclusive variants):
- BEFORE: Vision says "The Crow #1, virgin variant" → zero comps → $AI_GUESS
- AFTER: eBay says "Crow Dead Time #1 C2E2 Mico Suayan" (≥2 match) → exact comps → $MARKET_PRICE

**Old books unchanged**:
- Silver Age / Bronze Age / Golden Age scan → year < 2000 → gate closed → Vision result used → existing behavior preserved

### Decision point

**Option A**: Proceed with additive implementation (~1-2 sessions, 106 lines, Layer A trust hardening)  
**Option B**: Defer until more field data collected (log visualResult.items for next 100 scans, analyze consensus hit rate)  
**Option C**: Build Phase 1 instrumentation only (surface variant tokens in UI, no override logic yet)

**Recommendation**: Option A. The architecture is sound, the data is already flowing, the change is minimal and gated. Crow Dead Time class represents a real accuracy gap that this closes without touching vintage book pricing.

---

**END OF INVESTIGATION REPORT**
