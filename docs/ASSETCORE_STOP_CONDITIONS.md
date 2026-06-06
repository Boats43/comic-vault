# AssetCore Extraction — Stop Conditions

**Purpose:** Halt extraction work immediately when any of these conditions fire. Each condition represents a regression that must be fixed before extraction continues.

---

## Test Suite Regressions

### STOP-1: Test count drops below baseline
**Trigger:** `pass < 35` (current baseline: 35/38 passing)  
**Action:** Revert last extraction commit, investigate test failure  
**Rationale:** Any passing test flipping to failing indicates broken contract

### STOP-2: Previously passing test fails
**Trigger:** Any test in the 35-passing set flips to failing  
**Action:** Revert extraction step, fix root cause before retrying  
**Rationale:** Extraction must be additive (new abstractions) not destructive

**Exception:** Pre-existing failures (`identity-gate.test.js`, `priceBands.test.js`, `sold-verification.test.js`) are allowed to remain failing — we do NOT block on fixing these during extraction.

---

## Performance Regressions

### STOP-3: Total scan time increases >20%
**Trigger:** `total_ms > baseline * 1.2` (baseline ~2500ms average)  
**Measured:** Vercel function logs, `[timing] handler_complete` line  
**Action:** Revert extraction step, profile hot path  
**Rationale:** Abstraction overhead must stay below 20% — buyer mode is latency-sensitive

### STOP-4: Claude check increases >20%
**Trigger:** `claude_check_ms > baseline * 1.2`  
**Measured:** Vercel function logs, `[timing] claude_check_complete` line  
**Action:** Revert if LLM call structure changed, investigate prompt inflation  
**Rationale:** Claude API calls are the cost bottleneck — must not regress

---

## Pipeline Integrity

### STOP-5: Phase 2 skip rate increases
**Trigger:** `[phase2] SKIPPED` log appears when it didn't before  
**Current baseline:** 0% skip rate (Phase 2 runs on every scan)  
**Action:** Revert extraction step, check identity gate logic  
**Rationale:** Phase 2 (comps, pricing, decision) must always run unless identity is refused — skips indicate broken flow

**Note:** Identity refusal (`refused-identity-conflict`) is valid — STOP-5 fires only when a scan that previously ran Phase 2 now skips it.

---

## Pricing Correctness

### STOP-6: Recommended price drops below floor
**Trigger:** `decision.price < rawComps.lowest` when floor exists  
**Current bug:** Already present (Session 3A bug queue #2) — extraction must NOT make it worse  
**Action:** If extraction introduces NEW cases of below-floor pricing, revert step  
**Rationale:** Floor enforcement is a safety invariant — extraction must preserve it

**How to detect:**
```javascript
// In production logs or test assertions
const floor = item.rawComps?.lowest;
if (floor && decision.price && decision.price < floor) {
  // STOP-6 triggered
}
```

### STOP-7: Confidence=HIGH on browse_api source
**Trigger:** `decision.confidence === 'high' && item.pricingSource === 'browse_api'`  
**Current bug:** Already present (Session 3A bug queue #3) — extraction must NOT make it worse  
**Action:** If extraction introduces NEW cases of HIGH confidence on browse_api, revert step  
**Rationale:** Browse API (active listings only) should cap at MEDIUM — HIGH requires sold comps

**How to detect:**
```javascript
// In production logs or test assertions
if (item.pricingSource === 'browse_api' && decision.confidence === 'high') {
  // STOP-7 triggered
}
```

---

## Field Contract Violations

### STOP-8: Merge path breaks on missing field
**Trigger:** `TypeError: Cannot read property 'X' of undefined` in App.jsx merge logic  
**Action:** Revert extraction step, restore missing field to enrich response  
**Rationale:** 8 merge paths depend on stable field names — extraction must not break contracts

**Critical fields:**
- `price`, `priceLow`, `priceHigh`
- `title`, `issue`, `year`, `publisher`
- `pricingSource`, `confidenceLevel`
- `rawComps`, `soldComps`
- `decision` (entire object)

### STOP-9: Decision engine blocker without reason
**Trigger:** `decision.blockers.length > 0` but `decision.reason === ''`  
**Action:** Revert extraction step, restore reason-building logic  
**Rationale:** Every blocker must surface a user-facing reason string

---

## Rollback Protocol

When any STOP condition fires:

1. **Immediate:** `git revert <extraction-commit-hash>`
2. **Investigate:** Run `node --test tests/*.test.js` locally
3. **Log audit:** Check Vercel logs for timing/error deltas
4. **Fix root cause:** Address the regression in isolation
5. **Retry extraction:** Re-attempt the extraction step with fix applied
6. **No bypass:** Do NOT proceed to next extraction step until STOP clears

**Exception:** STOP-6 and STOP-7 are **pre-existing bugs**. Extraction may proceed if:
- The bug count does NOT increase (same cases fail)
- No NEW cases appear (same books trigger the bug)
- Test coverage exists to prevent regression

---

## Non-Blocking Warnings

These do NOT trigger a STOP but should be tracked:

- **WARN-1:** `storySuppressedReason` present (borderline CV match)  
  → Expected behavior, informational only
- **WARN-2:** `yearOverrideRejected` present (PC/CV year rejected)  
  → Expected behavior, user year preferred
- **WARN-3:** Mega-key manual review badge  
  → Expected behavior, manual appraisal required

---

## Success Criteria (Inverse of STOP)

Extraction step is **green to proceed** when:

- ✅ Test suite: ≥35 passing (no regressions)
- ✅ Performance: `total_ms` within 120% of baseline
- ✅ Pipeline: Phase 2 skip rate unchanged
- ✅ Pricing: Floor enforcement preserved
- ✅ Confidence: browse_api caps at MEDIUM
- ✅ Contracts: All merge paths functional

**When all green:** Commit extraction step, move to next step in sequence.
