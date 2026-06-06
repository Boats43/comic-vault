# AssetCore Interface Contract

**Session 3B Step 4 — Interface Design**

AssetCore is the universal pricing and decision engine for all collectible asset types. This document defines the contract between AssetCore and format-specific adapters (ComicAdapter, CardAdapter, etc.).

---

## SECTION 1 — Input Contract

Fields every adapter MUST supply to AssetCore:

### Identity Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | **required** | Primary asset name (comic series, card player name, book title) |
| `year` | string\|null | optional | Publication/release year |
| `confidence` | string | optional | Identity confidence: HIGH, MEDIUM, LOW (default: MEDIUM) |
| `identitySource` | string | optional | Source of identity: vision, ebay_visual_override, title-family-weighted-consensus, etc. |

### Pricing Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `price` | number\|null | **required** | Pre-floor price estimate from adapter's pricing logic |
| `rawComps` | object | optional | `{ count, lowest, average, highest, prices[] }` — raw market comps |
| `pricingSource` | string | optional | Source: pricecharting, browse_api, sanity-fallback, mega-key-floor, etc. |
| `soldComps` | object | optional | `{ count, average, median }` — sold/completed listings |
| `blendedAvg` | number\|null | optional | Weighted blend of sold + active comps |

### Condition Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `grade` | string\|number\|null | optional | Universal condition metric (CGC 9.8, PSA 10, VF+, etc.) |
| `isGraded` | boolean | optional | Whether professionally graded (CGC, PSA, BGS, etc.) |
| `conditionNotes` | string | optional | Free-text condition description |

### Evidence Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `verifiedCount` | number | optional | Count of verified comps (passed hygiene filters) |
| `soldCount` | number | optional | Count of sold/completed listings |
| `matchConfidence` | object | optional | `{ tier, score, visionCapped }` — comp match quality |

### Market Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timestamp` | number | optional | Scan timestamp (ms since epoch) |
| `images` | string[] | optional | Asset image URLs |

---

## SECTION 2 — Output Contract

Fields AssetCore ALWAYS returns:

### Decision Object

| Field | Type | Always Present | Description |
|-------|------|----------------|-------------|
| `decision.action` | enum | ✅ | `LIST_NOW` \| `LIST_LOW` \| `RESEARCH` \| `HOLD` \| `DO_NOT_LIST` \| `GRADE_CANDIDATE` \| `BUNDLE` \| `ID_REQUIRED` |
| `decision.confidence` | enum | ✅ | `HIGH` \| `MEDIUM` \| `LOW` |
| `decision.price` | number\|null | ✅ | Floor-enforced final price (null when blocked) |
| `decision.bestChannel` | string\|null | ✅ | `ebay` \| `whatnot` \| `direct` \| `grade-first` \| null |
| `decision.blockers` | string[] | ✅ | Hard blockers: `identity-conflict`, `manual-review-required`, `missing-title`, `missing-issue`, `missing-publisher`, `grade-exceeds-map`, `catastrophic-overprice`, `reprint-no-comps` |
| `decision.warnings` | string[] | ✅ | Soft warnings: `sold-active-mismatch`, `thin-pool`, `variant-contamination`, `bundle-candidate`, `reprint-detected`, `polybag-detected`, `golden-age-thin-active-mismatch`, `era-filter-bypassed` |
| `decision.reason` | string | ✅ | Human-readable explanation |
| `decision.nextSteps` | string[] | ✅ | Actionable recommendations |

### Price Bands

| Field | Type | Always Present | Description |
|-------|------|----------------|-------------|
| `priceBands.low` | number\|null | conditional | Conservative floor (present when price exists) |
| `priceBands.high` | number\|null | conditional | Optimistic ceiling (present when price exists) |
| `priceBands.floor` | number\|null | conditional | Absolute floor (rawComps.lowest or mega-key floor) |

### Recommended Price

| Field | Type | Always Present | Description |
|-------|------|----------------|-------------|
| `recommendedPrice` | number\|null | ✅ | Final floor-enforced price (same as `decision.price`) |

### Diagnostics (when available)

| Field | Type | Always Present | Description |
|-------|------|----------------|-------------|
| `floorApplied` | boolean | conditional | Whether price was capped to floor |
| `sanityFired` | boolean | conditional | Whether sanity fallback triggered |
| `thinPoolAnchored` | boolean | conditional | Whether thin-pool anchor applied |
| `lowGradeFloorApplied` | boolean | conditional | Whether low-grade floor anchor applied |

---

## SECTION 3 — Adapter-Injected Fields

Fields that are **format-specific**, injected by ComicAdapter, and **passed through AssetCore untouched**:

### Comic-Specific Identity

| Field | Description | Usage |
|-------|-------------|-------|
| `issue` | Issue number (e.g., "1", "Annual 2") | ComicAdapter only, NOT used by AssetCore |
| `publisher` | Publisher name | ComicAdapter only, NOT used by AssetCore |
| `variant` | Variant descriptor (newsstand, virgin, 1:25) | ComicAdapter only, NOT used by AssetCore |
| `keyIssue` | Key issue flags (1st appearance, origin, death) | ComicAdapter only, NOT used by AssetCore |

### Comic-Specific Grading

| Field | Description | Usage |
|-------|-------------|-------|
| `certNumber` | CGC/CBCS cert number | ComicAdapter only, NOT used by AssetCore |
| `cgcPenaltyFlags` | Detected penalties (staple pop, store stamp, etc.) | ComicAdapter only, NOT used by AssetCore |

### Comic-Specific Metadata

| Field | Description | Usage |
|-------|-------------|-------|
| `comicVine` | ComicVine API response | ComicAdapter only, NOT used by AssetCore |
| `era` | Era label (Silver, Bronze, Golden, Modern) | ComicAdapter only, NOT used by AssetCore |
| `priceCharting` | PriceCharting API response | ComicAdapter only, NOT used by AssetCore |

### Card-Specific (future)

| Field | Description | Usage |
|-------|-------------|-------|
| `player` | Player name | CardAdapter only, NOT used by AssetCore |
| `team` | Team name | CardAdapter only, NOT used by AssetCore |
| `cardNumber` | Card number | CardAdapter only, NOT used by AssetCore |
| `set` | Set name | CardAdapter only, NOT used by AssetCore |
| `rookie` | Rookie card flag | CardAdapter only, NOT used by AssetCore |

---

## SECTION 4 — Boundary Rules

### AssetCore MUST NOT Reference

The following fields are **adapter-specific** and MUST NOT appear in AssetCore code:

**Comic-specific:**
- `issue`
- `publisher`
- `variant`
- `keyIssue`
- `certNumber`
- `cgcPenaltyFlags`
- `comicVine`
- `era`
- `priceCharting`

**Card-specific (future):**
- `player`
- `team`
- `cardNumber`
- `set`
- `rookie`

**Enforcement:** Any reference to these fields in `pricingEngine.js`, `decisionEngine.js`, or `identityCore.js` is a **boundary violation** and must be refactored to ComicAdapter in Step 5.

### ComicAdapter MUST NOT Bypass AssetCore

All pricing and decision logic flows through AssetCore:

1. **ComicAdapter** → calls `identityCore.js` → resolves identity
2. **ComicAdapter** → calls comic-specific APIs (PriceCharting, ComicVine, eBay) → builds `rawComps`
3. **ComicAdapter** → calls **AssetCore** → receives `decision` + `recommendedPrice`
4. **ComicAdapter** → injects comic-specific fields → returns to client

**Forbidden:** ComicAdapter computing final price or decision action outside AssetCore.

### Module Responsibility Chain

```
┌─────────────────┐
│  ComicAdapter   │  Format-specific: issue, publisher, variant, keyIssue
│  (Step 5)       │  Calls: identityCore, PriceCharting, ComicVine, eBay
└────────┬────────┘
         │
         ├─► identityCore.js (pure identity helpers)
         │   - calculateTitleOverlap
         │   - resolveIdentity
         │   - resolveIssue
         │   - backfillFromComps
         │   - resolveYear
         │
         └─► AssetCore (universal pricing + decision)
             ├─► pricingEngine.js (floor guards, sanity checks)
             └─► decisionEngine.js (action selection, blockers, warnings)
```

---

## SECTION 5 — Violation Registry (Step 5 Work Order)

### Current Violations in pricingEngine.js

**CLEAN** — No boundary violations detected.

Comments reference `variant` and `key-issue` in documentation, but no runtime logic references comic-specific fields.

---

### Current Violations in decisionEngine.js

#### TODO-001: `keyIssue` detection
**File:** `src/lib/decisionEngine.js:19-21`  
**Description:** Checks `item.keyIssue` string for key-issue keywords (first appearance, origin, death) to recommend grading upside.  
**Code:**
```js
const hasKeyIssue = item.keyIssue && item.keyIssue.trim().length > 3 &&
                      ['first', 'origin', 'death', 'cameo', 'key']
                      .some(x => item.keyIssue.toLowerCase().includes(x));
```
**Move to:** ComicAdapter in Step 5. Adapter sets `hasKeyValue: boolean` flag before calling AssetCore.

---

#### TODO-002: `isGraded` flag
**File:** `src/lib/decisionEngine.js:22`  
**Description:** Reads `item.isGraded` to gate grading recommendations.  
**Code:**
```js
const isGraded = item.isGraded === true;
```
**Move to:** Keep `isGraded` as universal condition field (Section 1). PSA/BGS cards also use professional grading. **NO ACTION NEEDED** — `isGraded` is already in the universal contract.

---

#### TODO-003: `issue` null check
**File:** `src/lib/decisionEngine.js:106-107`  
**Description:** Adds `missing-issue` blocker when `item.issue` is null/empty.  
**Code:**
```js
if (item.issue == null || item.issue === '') {
  decision.blockers.push('missing-issue');
}
```
**Move to:** ComicAdapter in Step 5. Adapter validates required comic fields before calling AssetCore. AssetCore receives `identityComplete: boolean` flag instead.

---

#### TODO-004: `publisher` null check
**File:** `src/lib/decisionEngine.js:109-110`  
**Description:** Adds `missing-publisher` blocker when `item.publisher` is null/empty.  
**Code:**
```js
if (!item.publisher || item.publisher.trim() === '') {
  decision.blockers.push('missing-publisher');
}
```
**Move to:** ComicAdapter in Step 5. Same resolution as TODO-003 — adapter sets `identityComplete: boolean`.

---

#### TODO-005: `missing-issue` blocker reference
**File:** `src/lib/decisionEngine.js:200`  
**Description:** Lists `missing-issue` and `missing-publisher` as identity-required blockers.  
**Code:**
```js
'missing-title', 'missing-issue', 'missing-publisher',
```
**Move to:** Replace with `identity-incomplete` blocker. ComicAdapter maps to specific field names in UI layer.

---

#### TODO-006: Variant contamination warning
**File:** `src/lib/decisionEngine.js:277-279`  
**Description:** References `item.variantContamination` flag.  
**Code:**
```js
if (item.variantContamination?.detected) {
  decision.warnings.push('variant-contamination');
}
```
**Move to:** ComicAdapter in Step 5. Adapter computes `compPoolContaminated: boolean` before calling AssetCore (generic concept — could apply to card set contamination).

---

#### TODO-007: ComicVine story check
**File:** `src/lib/decisionEngine.js:330-334`  
**Description:** Reads `item.comicVine.description` to detect no-story variants.  
**Code:**
```js
const hasStory = item.comicVine?.description && item.comicVine.description.length > 50;
if (hasStory) {
  const storyLower = item.comicVine.description.toLowerCase();
  // ...
}
```
**Move to:** ComicAdapter in Step 5. Adapter sets `contentVerified: boolean` flag (story exists, not an ad/pinup page).

---

#### TODO-008: Story suppression warning
**File:** `src/lib/decisionEngine.js:345-349`  
**Description:** Adds `story-suppression` warning based on ComicVine data.  
**Code:**
```js
if (hasStory && /* ... */) {
  decision.warnings.push('story-suppression');
}
```
**Move to:** ComicAdapter in Step 5. Same resolution as TODO-007.

---

#### TODO-009: Grade candidate detection
**File:** `src/lib/decisionEngine.js:445`  
**Description:** References `item.isGraded` for grading upside recommendation.  
**Code:**
```js
if (item.price > 100 && !item.isGraded && item.priceLadder) {
```
**Move to:** Keep `isGraded` as universal field (Section 1). **NO ACTION NEEDED** — valid universal condition field.

---

#### TODO-010: Publisher inference
**File:** `src/lib/decisionEngine.js:561-567`  
**Description:** Infers publisher "NOW Comics" from year 1991 in next-steps suggestions.  
**Code:**
```js
if (blockers.includes('missing-publisher')) {
  // Infer publisher based on year if possible
  if (item.year === '1991') {
    steps.push('Add publisher: NOW Comics (1991 series)');
  } else {
    steps.push('Add publisher or rescan indicia');
  }
}
```
**Move to:** ComicAdapter in Step 5. Publisher-year inference is comic domain knowledge.

---

#### TODO-011: `missing-issue` reason text
**File:** `src/lib/decisionEngine.js:537-538`  
**Description:** Maps `missing-issue` and `missing-publisher` blockers to reason text.  
**Code:**
```js
if (blockers.includes('missing-issue')) reasons.push('issue missing');
if (blockers.includes('missing-publisher')) reasons.push('publisher missing');
```
**Move to:** Replace with `identity-incomplete` blocker. ComicAdapter provides field-specific text in UI layer.

---

#### TODO-012: `missing-issue` next-step text
**File:** `src/lib/decisionEngine.js:571`  
**Description:** Suggests "Rescan cover for issue number" when `missing-issue` blocker present.  
**Code:**
```js
if (blockers.includes('missing-issue')) steps.push('Rescan cover for issue number');
```
**Move to:** ComicAdapter in Step 5. "Rescan cover" is comic-specific guidance.

---

#### TODO-013: Golden Age era detection
**File:** `src/lib/decisionEngine.js:148, 156, 360, 363, 604-605`  
**Description:** References "Golden Age" era in thin-pool warnings and reason text.  
**Code:**
```js
// EXCEPT: Golden Age thin pools may have contaminated active comps - handle as warning
if (thinActive && soldAvg && activeAvg && /* ... */) {
  decision.warnings.push('golden-age-thin-active-mismatch');
}
// ...
if (warnings.includes('golden-age-thin-active-mismatch')) {
  reasons.push('Golden Age thin active pool with sold/active conflict');
}
```
**Move to:** ComicAdapter in Step 5. Adapter sets `eraRisk: 'golden-age-thin' | 'modern-bundle' | null` flag. AssetCore warns on generic `era-risk-detected` signal.

---

#### TODO-014: Era-filter bypass warning
**File:** `src/lib/decisionEngine.js:377, 381, 634`  
**Description:** References `era-filter-bypassed` flag (Ship v0-I feature).  
**Code:**
```js
if (item.eraFilterBypassed) {
  decision.warnings.push('era-filter-bypassed');
}
```
**Move to:** ComicAdapter in Step 5. Era filtering is comic-specific. Adapter sets `filterBypassDetected: boolean` (generic — cards might bypass set/year filters).

---

#### TODO-015: Modern bundle suggestion
**File:** `src/lib/decisionEngine.js:614`  
**Description:** "low-dollar modern, better in bundle" reason text.  
**Code:**
```js
reasons.push('low-dollar modern, better in bundle');
```
**Move to:** ComicAdapter in Step 5. "modern" is comic era knowledge. AssetCore uses generic "low-value, bundle recommended".

---

### Known Violations from Step 3 Audit

#### TODO-016: Era detection patterns
**File:** `api/enrich.js` (inline)  
**Description:** Era-specific key-issue regex (silver age, bronze age, king-size, giant-size, annual, spectacular, first issue).  
**Code:** Lines 2142-2153 (resolveYear context)  
**Move to:** ComicAdapter in Step 5. Adapter provides `eraSpecific: boolean` flag to year resolution.

---

#### TODO-017: Title sanitization helpers
**File:** `api/enrich.js:457-713`  
**Description:** `detectTitleContamination` and `sanitizeTitle` contain comic-specific creator patterns (CREATOR_NOISE_RE), publisher filler (silver age, golden age, pre code), and listing language (1st app, trade dress, king-size).  
**Move to:** ComicAdapter in Step 5. Pure tokenization stays in identityCore; comic-specific pattern lists move to adapter.

---

#### TODO-018: `cleanTitleForComicVine`
**File:** `api/enrich.js:356-452`  
**Description:** Artist patterns (tyler kirkham, jim lee, artgerm), character-in-series patterns (X-Men/Wolverine, Avengers/Iron Man), publisher-in-title series protection (Marvel Tales, DC Special).  
**Move to:** ComicAdapter in Step 5. Entirely comic domain knowledge.

---

### Step 5 Refactor Summary

**Total violations:** 18 TODOs  
**Modules affected:**
- `decisionEngine.js` — 15 violations
- `enrich.js` — 3 violations (title sanitization)

**Strategy:**
1. Replace `missing-issue`, `missing-publisher` blockers with `identity-incomplete`
2. Replace comic-specific warnings (`golden-age-thin-active-mismatch`, `era-filter-bypassed`) with generic flags
3. Move all era, publisher, variant, keyIssue, comicVine logic to ComicAdapter
4. ComicAdapter sets universal flags (`hasKeyValue`, `identityComplete`, `compPoolContaminated`, `contentVerified`, `eraRisk`, `filterBypassDetected`) before calling AssetCore
5. Title sanitization: extract pure tokenization to identityCore, move pattern lists to ComicAdapter

**Clean after Step 5:**
- AssetCore operates on universal primitives only
- ComicAdapter handles all comic domain knowledge
- Future CardAdapter/BookAdapter follow same pattern
