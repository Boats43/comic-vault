# AssetCore Extraction — Ordered Sequence

**Goal:** Extract comic-specific logic from monolithic `api/enrich.js` into layered abstractions:
- **AssetCore** — universal pricing/identity engine (format-agnostic)
- **ComicAdapter** — comic-specific domain logic (wraps AssetCore)

**Constraint:** Each step must pass all STOP conditions before the next step begins.

---

## Step 1: Extract Pricing Math to `src/lib/pricingEngine.js`

**Scope:** Pure pricing helpers currently embedded in `api/enrich.js`

### Functions to Extract
1. `computeSanityFallback(pcNum, compsAvg, opts)` — lines 349-386
2. `computeThinPoolAnchor(currentPrice, rawComps, opts)` — lines 295-318
3. `computeLowGradeFloor(currentPrice, rawComps, pop, opts)` — lines 415-430
4. `median(arr)` — lines 258-265
5. `fmtUsd(n)` — lines 73-76
6. `getEra(year)` — lines 1359-1363

### Target File Structure
```javascript
// src/lib/pricingEngine.js

export const median = (arr) => { /* pure */ };
export const fmtUsd = (n) => { /* pure */ };
export const getEra = (year) => { /* pure */ };
export const computeSanityFallback = (pcNum, compsAvg, opts) => { /* pure */ };
export const computeThinPoolAnchor = (currentPrice, rawComps, opts) => { /* pure */ };
export const computeLowGradeFloor = (currentPrice, rawComps, pop, opts) => { /* pure */ };
```

### Migration Steps
1. Copy functions to `src/lib/pricingEngine.js` (preserve docstrings)
2. Add `export` keywords
3. Update `api/enrich.js` to import from new file
4. Run test suite → must pass ≥35 tests
5. Run production smoke test (scan 5 books, check logs)
6. Commit: `"refactor: extract pricing helpers to pricingEngine.js"`

### Success Criteria
- ✅ All tests passing
- ✅ No performance regression (`total_ms` within 120%)
- ✅ Enrich handler 200 lines shorter
- ✅ Zero behavior change (prices identical pre/post extraction)

### Risk Assessment
**Low Risk** — These functions are already pure (no side effects), well-tested, and have clear boundaries.

---

## Step 2: Audit Decision Engine Completeness

**Scope:** Verify `src/lib/decisionEngine.js` has all logic extracted from enrich handler

### Already Extracted (v0-F)
- `computeDecision(item, context)` — lines 94-540 in decisionEngine.js
- `enforceFloor(price, floor)` — lines 5-9 in decisionEngine.js
- `computeBestChannel(decision, item)` — lines 22-82 in decisionEngine.js

### Remaining in Enrich Handler
**Lines 4671-4733:** Field normalization before decision call
```javascript
// Normalize rawComps shape
out.rawComps = rawComps ? { average, lowest, highest, count } : null;

// Normalize identity fields
if (!out.issue) out.issue = correctedIssue;
if (!out.year) out.year = confirmedYear;
if (!out.publisher) out.publisher = confirmedPublisher;

// Call decision engine
out.decision = computeDecision(out, { source: 'enrich', timestamp: Date.now() });
```

**Verdict:** Field normalization belongs in enrich handler (I/O prep). Decision engine is **complete**.

### Action
1. Document decision engine inputs/outputs in docstring
2. Add contract test: `computeDecision` must return same shape for all input variants
3. No extraction needed — Step 2 is audit-only
4. Commit: `"docs: decision engine contract — input/output shape"`

### Success Criteria
- ✅ Contract documented
- ✅ Test coverage confirmed
- ✅ No enrich handler logic extracted (nothing left to extract)

### Risk Assessment
**Zero Risk** — Documentation + test coverage only, no code changes.

---

## Step 3: Extract Identity Pipeline to `src/lib/identityCore.js`

**Scope:** Identity resolution logic (title/issue/year/publisher confirmation)

### Functions to Extract
1. **Year resolution** — lines 2309-2361 in enrich.js
   - `confirmedYear` derivation (PC/CV/eBay consensus)
   - `yearOverrideRejected` flag
2. **Title sanitization** — already in `src/lib/identityGate.js` (Ship v0-G)
3. **Issue correction** — eBay visual consensus (lines 2268-2283)
4. **Publisher normalization** — `cleanPublisher` helper

### Target File Structure
```javascript
// src/lib/identityCore.js

export const resolveYear = (visionYear, pcYear, cvYear, ebayYear, opts) => {
  // Returns { confirmedYear, yearCorrected, yearOverrideRejected, source }
};

export const resolveTitle = (visionTitle, pcTitle, cvTitle, ebayTitle, opts) => {
  // Returns { confirmedTitle, titleCorrected, titleSource }
};

export const resolveIssue = (visionIssue, ebayIssue, opts) => {
  // Returns { correctedIssue, issueSource }
};

export const resolvePublisher = (visionPublisher, pcPublisher, cvPublisher, opts) => {
  // Returns { confirmedPublisher, publisherSource }
};

export const resolveIdentity = (vision, pc, cv, ebay) => {
  // Orchestrates all four resolvers, returns identity object
};
```

### Migration Steps
1. Extract year resolution to `resolveYear()`
2. Extract title resolution to `resolveTitle()`
3. Extract issue resolution to `resolveIssue()`
4. Extract publisher resolution to `resolvePublisher()`
5. Build orchestrator `resolveIdentity()` that calls all four
6. Update enrich handler to call `resolveIdentity()` once
7. Run test suite → must pass ≥35 tests
8. Commit: `"refactor: extract identity resolution to identityCore.js"`

### Success Criteria
- ✅ All tests passing
- ✅ Identity fields identical pre/post extraction
- ✅ Enrich handler 100+ lines shorter
- ✅ Clear separation: identity resolution vs pricing

### Risk Assessment
**Medium Risk** — Identity resolution has many branches (PC/CV/eBay priority order). Requires careful testing.

**Mitigation:** Extract one resolver at a time (year → title → issue → publisher), test after each.

---

## Step 4: Define AssetCore Interface

**Scope:** Define the input/output contract for universal asset pricing

### AssetCore Interface
```javascript
/**
 * Universal asset pricing engine.
 * 
 * Input: { identity, comps, grades, sources }
 * Output: { price, confidence, decision, diagnostics }
 * 
 * Format-agnostic: works for comics, cards, coins, stamps, etc.
 */
export async function priceAsset(input, adapter) {
  // 1. Resolve identity (title, issue, year, publisher)
  // 2. Fetch comps (eBay, sold data, external APIs)
  // 3. Apply pricing math (sanity, floor, anchor)
  // 4. Compute decision (action, confidence, warnings)
  // 5. Return structured result
}
```

### Input Shape
```typescript
interface AssetInput {
  // Vision-identified fields
  title: string;
  issue?: string;
  year?: number;
  publisher?: string;
  grade?: string;
  isGraded?: boolean;
  numericGrade?: number;

  // Images for visual search
  images?: string[];

  // External IDs
  certNumber?: string;

  // Metadata
  confidence?: 'high' | 'medium' | 'low';
  variant?: string;
  keyIssue?: string;
}
```

### Output Shape
```typescript
interface AssetOutput {
  // Pricing
  price: number | null;
  priceLow: number | null;
  priceHigh: number | null;
  pricingSource: string;

  // Identity (confirmed)
  title: string;
  issue: string;
  year: number;
  publisher: string;

  // Confidence
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  matchConfidence?: object;

  // Decision
  decision: {
    action: string;
    confidence: string;
    price: number | null;
    blockers: string[];
    warnings: string[];
    reason: string;
    nextStep: string;
  };

  // Diagnostics
  rawComps?: object;
  soldComps?: object[];
  timings?: object;
}
```

### Adapter Pattern
```javascript
/**
 * ComicAdapter wraps AssetCore with comic-specific logic:
 * - ComicVine API integration
 * - CGC/CBCS grading multipliers
 * - Test-market variant allowlists
 * - Comic key-issue patterns
 */
export class ComicAdapter {
  async enrich(input) {
    // 1. Call ComicVine API (comic-specific)
    // 2. Call AssetCore.priceAsset(input, this)
    // 3. Apply comic-specific multipliers
    // 4. Return AssetOutput
  }

  // Adapter methods called by AssetCore
  async fetchExternalMetadata(identity) { /* ComicVine */ }
  getGradeMultiplier(grade, year) { /* CGC tables */ }
  isTestMarketVariant(title, issue, variant) { /* allowlist */ }
  extractKeyIssue(title, description) { /* patterns */ }
}
```

### Migration Steps
1. Define `AssetInput` / `AssetOutput` TypeScript interfaces
2. Write AssetCore stub that mirrors current enrich flow
3. Write ComicAdapter stub that wraps AssetCore
4. Wire enrich handler to call `new ComicAdapter().enrich(req.body)`
5. Run test suite → must pass ≥35 tests (behavior unchanged)
6. Commit: `"feat: AssetCore interface + ComicAdapter skeleton"`

### Success Criteria
- ✅ All tests passing
- ✅ Prices identical pre/post (stub implementation)
- ✅ Clear contract defined (TypeScript interfaces)
- ✅ Adapter pattern validated (comic-specific logic isolated)

### Risk Assessment
**High Risk** — Large refactor, touches enrich handler core. Requires atomic migration.

**Mitigation:** Start with stub implementations that delegate to existing code. Incremental extraction.

---

## Step 5: Build ComicAdapter

**Scope:** Move comic-specific logic from enrich handler into ComicAdapter

### Comic-Specific Logic to Move
1. **ComicVine integration** — `lookupComicVine()` function
2. **CGC/RAW multipliers** — `CGC_MULTIPLIERS` / `RAW_MULTIPLIERS` tables
3. **Test-market variants** — `TEST_MARKET_VARIANTS` allowlists
4. **Key-issue patterns** — `COMP_KEY_PATTERNS` regex catalog
5. **Mega-keys** — `getMegaKeyEntry()` / `getMegaKeyFloor()` calls

### Target Structure
```javascript
// src/adapters/ComicAdapter.js

import { priceAsset } from '../lib/assetCore.js';
import { lookupComicVine } from '../../api/enrich.js'; // temp, will move
import { CGC_MULTIPLIERS, RAW_MULTIPLIERS } from './comicGradingTables.js';
import { TEST_MARKET_VARIANTS } from './comicVariants.js';
import { COMP_KEY_PATTERNS } from './comicKeyPatterns.js';

export class ComicAdapter {
  constructor() {
    this.format = 'comic';
  }

  async enrich(input) {
    const assetResult = await priceAsset(input, this);
    return this.applyComicEnhancements(assetResult);
  }

  async fetchExternalMetadata(identity) {
    return await lookupComicVine(identity);
  }

  getGradeMultiplier(grade, year) {
    const era = year >= 1985 ? 'modern' : 'vintage';
    return CGC_MULTIPLIERS[era][grade];
  }

  isTestMarketVariant(title, issue, variant) {
    // Check TEST_MARKET_VARIANTS allowlist
  }

  extractKeyIssue(title, description, comps) {
    // Apply COMP_KEY_PATTERNS
  }

  applyComicEnhancements(assetResult) {
    // Mega-key floor enforcement
    // Comic-specific UI hints
    // CGC submission scenarios
  }
}
```

### Migration Steps
1. Create `src/adapters/ComicAdapter.js` file
2. Move `lookupComicVine()` to adapter method
3. Move grading tables to `src/adapters/comicGradingTables.js`
4. Move variant allowlists to `src/adapters/comicVariants.js`
5. Move key patterns to `src/adapters/comicKeyPatterns.js`
6. Update enrich handler to instantiate `new ComicAdapter()`
7. Run test suite → must pass ≥35 tests
8. Commit: `"feat: ComicAdapter — extract comic-specific domain logic"`

### Success Criteria
- ✅ All tests passing
- ✅ Enrich handler 500+ lines shorter
- ✅ Comic logic isolated in adapter
- ✅ AssetCore remains format-agnostic

### Risk Assessment
**High Risk** — Large migration, many moving pieces.

**Mitigation:** Move one subsystem at a time (ComicVine → grading → variants → keys). Test after each.

---

## Atomic Step Rule

**Each step must:**
1. Complete fully (no partial commits)
2. Pass all STOP conditions
3. Receive explicit "proceed" signal before next step begins

**No App.jsx changes until Steps 1-5 complete.**

Touching App.jsx merge paths is the highest-risk operation. Only after AssetCore + ComicAdapter are stable and tested should we refactor the 8 client-side merge paths.

---

## Rollback Plan

At any step, if a STOP condition fires:
1. `git revert <step-commit-hash>`
2. Fix root cause in isolation
3. Re-attempt step with fix applied
4. Do NOT proceed to next step until green

---

## Success Metrics (Final State)

After Step 5 completion:

- **Code organization:**
  - `src/lib/assetCore.js` — 500 lines (universal pricing)
  - `src/lib/pricingEngine.js` — 200 lines (pure helpers)
  - `src/lib/identityCore.js` — 300 lines (identity resolution)
  - `src/lib/decisionEngine.js` — 500 lines (already extracted)
  - `src/adapters/ComicAdapter.js` — 400 lines (comic-specific)
  - `api/enrich.js` — 2000 lines → 800 lines (I/O + orchestration only)

- **Test coverage:**
  - ≥35 tests passing (no regressions)
  - New unit tests for AssetCore (pricing edge cases)
  - New unit tests for ComicAdapter (variant/key detection)

- **Performance:**
  - `total_ms` within 120% of baseline (~2500ms → ~3000ms max)
  - No LLM call regressions

- **Contracts:**
  - AssetInput / AssetOutput interfaces documented
  - Adapter pattern validated
  - Clear separation: core vs domain logic

**When all metrics green:** AssetCore extraction complete, ready for CardAdapter (Session 4).
