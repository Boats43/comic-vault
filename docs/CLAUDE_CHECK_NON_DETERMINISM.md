# Claude Check Non-Determinism Bug Investigation
**Date:** 2026-06-30  
**Trigger:** Live API sweep — Incredible Hulk #181 showed 2/3 refusals, 1/3 $10,000 priced  
**Severity:** CRITICAL — defeats P0 price-frozen lifecycle  

## Evidence

### Incredible Hulk #181 (Marvel, 1974, CGC 7.0, cert 7777777777)
**Identical payload, 3 consecutive API calls:**
- Call 1: `price: null`, `pricingSource: refused-claude-gate`, `decision: DO_NOT_LIST`
- Call 2: `price: null`, `pricingSource: refused-claude-gate`, `decision: DO_NOT_LIST`
- Call 3: `price: $10,000.00`, `pricingSource: verified_sold`, `decision: LIST_NOW`

**Timing:** 9124ms, 8518ms, 9349ms (all similar — suggests same code path, different AI output)

**Conclusion:** 67% refusal rate on identical input = non-deterministic behavior in `claudeCheck` gate.

## Root Cause Analysis

### Location
`src/lib/claudeCheck.js` — Ship #21 quality check layer  
`api/enrich.js` lines 4414-4680 — Claude gate kill switch

### Architecture Discovery

**claudeCheck DOES gate price computation** (lines 4487-4680 in enrich.js):

```javascript
// Ship 5 — Claude-check kill switch. When claude-check returns
// verified=false AND confidence=LOW, refuse to ship the computed
// price.
```

**CRITICAL gate flow:**
1. `runClaudeCheck` calls Claude Haiku (line 4416)
2. Returns `verified: true/false` + `flags` array with `severity: CRITICAL|WARNING`
3. **Lines 4520-4544:** Parse CRITICAL flags from response
4. **Lines 4551-4680:** CRITICAL flags + `verified=false` → `out.price = null`, `pricingSource = 'refused-claude-gate'`

**This is BLOCKING, not annotation.** Price is NULLED when Claude returns CRITICAL flags.

### API Call Details (src/lib/claudeCheck.js)

**Model:** `claude-haiku-4-5-20251001` (standard mode, line 180)  
**Max tokens:** 1024  
**System prompt:** "You are a comic book expert and pricing analyst. Review this complete record for accuracy. Be concise. Respond in JSON only."

**CRITICAL BUG: NO TEMPERATURE SETTING**

Lines 187-204 show the API call:
```javascript
const apiCallPromise = anthropic.messages.create({
  ...modelConfig,
  messages: [ ... ]
});
```

`modelConfig` (lines 179-183) contains:
- `model`
- `max_tokens`
- `system`

**MISSING:** `temperature: 0`

**Anthropic API default temperature:** 1.0 (non-deterministic)  
**Effect:** Same input → different Haiku interpretations → different CRITICAL flag decisions

### Prompt Analysis

**Static instructions (lines 105-128):**
```
VERIFY ALL OF THE FOLLOWING:
1. Do sold/active comps match this exact book?
2. Is grade consistent with condition described?
3. Are price bands reasonable for this grade/era?
4. Is key issue description accurate for THIS issue?
5. What is your recommendation?
```

**Prompt style:** Semi-open-ended verification questions  
**Output format:** JSON with `verified: true/false` + `flags` array

**Issue:** Questions like "Is key issue description accurate for THIS issue?" allow subjective interpretation. At temperature 1.0, Haiku may answer YES on call 1, NO on call 2 for identical input.

### Timing Evidence

**Category C priced tests:** 4762-4967ms average  
**Claude-gated refusals:** 7949-9936ms average  
**Incredible Hulk #181:** 9124ms, 8518ms, 9349ms (all in "gated" range)

**Pattern:** All 3 calls took ~9s (typical for Claude gate path), but 2 returned CRITICAL flags, 1 did not.

**Conclusion:** Same code path executed, same external AI call made, different AI outputs received.

## Impact Assessment

### P0 Fix Bypass

**P0 fix (commit 6a12f0a) hardened:**
- ✅ Refresh layer (no silent card-open mutations)
- ✅ Auto-refresh targeting (narrow scope)
- ✅ Decision sync (computed from final price)
- ✅ Update timestamp (audit trail)

**But Ship #21's `claudeCheck` runs UPSTREAM of pricing engine:**
```
claudeCheck (non-deterministic)
  ↓
CRITICAL flags? → price = null
  ↓
NO CRITICAL flags? → compute price → store → decision sync
```

**When `claudeCheck` is non-deterministic, the price-frozen lifecycle NEVER starts.**

### Affected Books

From live sweep (15 test cases):
- **5 Category B refusals:** All had CGC cert OR variant="2nd print" → likely Claude gate blocks
- **1 DRIFT case:** Incredible Hulk #181 (67% refusal rate)

**Hypothesis:** High-value books trigger stricter Claude scrutiny → higher false-positive CRITICAL rate → non-determinism more visible.

## Correct Architecture

**Current (wrong):**
```
Claude gate (blocking, non-deterministic) → price computation → decision
```

**Correct:**
```
Price computation → STORE PRICE → Claude annotation (non-blocking) → decision reads flags
```

**Rules:**
1. `claudeCheck` NEVER blocks price computation
2. `claudeCheck` MAY flag issues as annotations
3. **Decision Engine** reads `claudeCheck.flags` and chooses action (LIST_NOW / DO_NOT_LIST / RESEARCH)
4. Price is ALWAYS computed and stored (frozen lifecycle protected)

**Example:**
- Incredible Hulk #181: `price: $10,000`, `claudeCheck.flags: [CRITICAL: key issue uncertain]`, `decision: DO_NOT_LIST`
- User sees: "$10,000 estimated, DO NOT LIST (key issue verification required)"
- Same input → same price → same decision (deterministic)

## Proposed Fix

### Fix 1: Set temperature=0 (MINIMUM)

**Location:** `src/lib/claudeCheck.js` line 187

```javascript
const apiCallPromise = anthropic.messages.create({
  ...modelConfig,
  temperature: 0,  // <-- ADD THIS
  messages: [ ... ]
});
```

**Effect:** Haiku becomes near-deterministic for yes/no classification tasks.

**Limitation:** Still allows subjective interpretation of prompts ("Is this accurate?").

### Fix 2: Rewrite prompt as binary checklist (RECOMMENDED)

**Current (open-ended):**
```
VERIFY ALL OF THE FOLLOWING:
1. Do sold/active comps match this exact book?
```

**Fixed (binary checklist):**
```
Answer YES or NO for each check:

1. Title match: Do ≥80% of comp titles contain this exact title? YES / NO
2. Issue match: Do ≥80% of comp titles reference this exact issue number? YES / NO
3. Year range: Are comp listings within ±2 years of stated year? YES / NO
4. Publisher: Do ≥80% of comps reference this publisher? YES / NO

SCORING:
- 4/4 YES → verified=true, no flags
- 3/4 YES → verified=true, flags=[WARNING: one mismatch]
- ≤2/4 YES → verified=false, flags=[CRITICAL: identity mismatch]
```

**Effect:** Binary yes/no answers with numeric thresholds → deterministic output even at temperature >0.

### Fix 3: Move Claude gate AFTER price computation (ARCHITECTURAL)

**Current block (api/enrich.js lines 4487-4680):**
```javascript
if (isPricingCritical && !isPolybagPricing) {
  out.price = null;
  out.priceLow = null;
  out.priceHigh = null;
  out.pricingSource = 'refused-claude-gate';
}
```

**Replace with annotation:**
```javascript
// NEVER null the price — always store it
if (isPricingCritical && !isPolybagPricing) {
  out.claudeGateBlocked = true;
  out.claudeGateReason = refusalReason;
  // Price stays computed, decision engine will set DO_NOT_LIST
}
```

**Decision Engine update (src/lib/decisionEngine.js):**
```javascript
if (item.claudeGateBlocked) {
  return {
    action: 'DO_NOT_LIST',
    confidence: 'high',
    blockers: [item.claudeGateReason],
    // ...
  };
}
```

**Effect:** Price is deterministic (always computed). Decision reads Claude flags. Same input → same price → same decision.

## Recommended Implementation Order

1. **URGENT (Fix 1):** Add `temperature: 0` to `runClaudeCheck` API call
2. **HIGH (Fix 3):** Move Claude gate from blocking price to blocking decision
3. **MEDIUM (Fix 2):** Rewrite prompt as binary checklist (hardening)

**Rationale:** Fix 1 is 1-line change, immediately reduces non-determinism. Fix 3 is architectural, protects price-frozen lifecycle. Fix 2 is prompt engineering, long-term hardening.

## Validation Plan

### Test 1: Incredible Hulk #181 (10-call stability)

**Input:** Identical payload from sweep (title, issue, year, publisher, grade, cert)  
**Expected (current):** ~67% refusal rate (non-deterministic)  
**Expected (after Fix 1):** 0% or 100% refusal rate (deterministic at temp=0)  
**Expected (after Fix 3):** 100% priced, decision varies by Claude flags (acceptable)

**Pass criterion:** Zero price drift across 10 calls.

### Test 2: Category B sweep re-run (5 cases)

**Input:** 5 Category B test cases from sweep (all returned DO_NOT_LIST)  
**Expected (current):** Variable refusal reasons  
**Expected (after Fix 1+3):** All return same price, same decision on repeated calls

**Pass criterion:** 5/5 stable across 3 calls each.

### Test 3: Phone validation (real scans)

**Input:** Real Vision scans on production UI  
**Expected:** Identical scans → identical prices → identical decisions

**Pass criterion:** User reports zero "price jumping" or "decision flipping" on card refresh.

## Related Documents
- Live sweep results: `docs/LIVE_VERIFICATION_SWEEP.md`
- P0 fix analysis: Session 6/30/26 conversation
- Decision engine spec: `src/lib/decisionEngine.js`

---
**Status:** INVESTIGATION COMPLETE — awaiting greenlight for fix implementation
