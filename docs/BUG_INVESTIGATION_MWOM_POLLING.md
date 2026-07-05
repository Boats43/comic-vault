# Bug Investigation: MWOM #198 Black Screen + Triplicate Polling
**Date:** 2026-06-30  
**Trigger:** User report after Fix 2/3 deployment  

## BUG 1: MWOM #198 Black Screen

### Symptoms
- Tapping the card for "Mighty World of Marvel #198" causes black screen
- Same symptom as earlier Ambush Bug crash (fixed in commit 7e2c9e8)

### Hypothesis
Fix 2/3 (claudeCheck architecture changes) altered the shape of `decision.blockers` or `claudeCheck.flags`, breaking defensive rendering.

### Investigation Findings

**Data shape after Fix 3:**
```javascript
// claudeCheck.flags structure (Fix 3 binary checklist)
result.flags = [{
  message: "CRITICAL: Identity verification failed (title mismatch, ...)",
  severity: "CRITICAL"
}];
```

**Decision Engine processing:**
```javascript
// src/lib/decisionEngine.js:138-144
if (item.claudeCheckBlocker) {
  decision.blockers.push('claude-check-critical');  // String, not object!
  decision.evidence.claudeCritical = {
    reason: item.claudeCheckBlocker,
    source: 'claude-gate'
  };
}
```

**App.jsx rendering (line 3249):**
```javascript
{item.decision.blockers.map(b => 
  typeof b === 'string' ? b : (b?.message || b?.type || String(b))
).join(', ')}
```

**Analysis:**
- Fix 3 returns proper `{message, severity}` objects ✅
- Decision Engine adds `'claude-check-critical'` as a STRING to `decision.blockers` ✅
- App.jsx defensive rendering handles both strings and objects ✅

**Structure looks correct.** The defensive `.map()` at line 3249 should handle this.

### Root Cause Hypothesis #1: DIFFERENT BUG
The black screen may NOT be caused by Fix 2/3 data shape changes. Possible alternatives:

1. **`priceNote` field injection**: Fix 2 changed `out.priceNote = \`⚠️ ${refusalReason}\`` (line 4739)
   - If `refusalReason` contains special characters or is unexpectedly long, could break rendering
   - Could contain emojis that crash certain Android WebView versions

2. **Missing field**: MWOM #198 might have `claudeCheckBlocker` set but missing other expected fields
   - Check: does `item.decision` exist?
   - Check: is `item.decision.blockers` an array?

3. **React key collision**: Multiple books with similar identity causing React reconciliation errors

### Diagnostic Questions Needed
1. **Browser DevTools error:** What's the actual JavaScript error when MWOM #198 card is tapped?
2. **Data dump:** What does the full `item` object for MWOM #198 look like in localStorage `cv_catalogue`?
3. **Reproduce:** Can we reproduce by manually creating a book with the same fields?

---

## BUG 2: Triplicate Polling Pattern

### Symptoms
Production logs show `/api/enrich` firing in groups of 3 SIMULTANEOUS calls, repeating every 5-8 seconds, for 75+ seconds (14:16:10 to 14:17:23, 14 separate triplicate bursts).

### Pattern Analysis
```
14:16:10 - 3 calls (simultaneous)
14:16:16 - 3 calls (6s gap)
14:16:22 - 3 calls (6s gap)
14:16:29 - 3 calls (7s gap)
... (continues for 14 bursts)
```

This matches:
- ❌ NOT normal user behavior (one tap = one call)
- ❌ NOT auto-refresh (runs 1x per 60s, not 14x in 75s)
- ✅ MATCHES test script pattern (3 calls per test case)
- ✅ MATCHES retry loop (crash → re-render → 3 parallel fetches → crash → repeat)

### Investigation Findings

**Test scripts:**
- `ps aux` shows NO running test scripts ✅
- Scripts completed and exited cleanly

**Polling patterns in App.jsx:**
- Line 7478: `setInterval(captureAndGrade, 3000)` — Watch Mode camera (not enrich)
- Line 7991: `setInterval(...)` — Loading animation (not API calls)
- Auto-refresh: 60s cooldown, NOT 5-8s intervals ✅

**No polling code found that matches the 5-8s triplicate pattern.**

### Root Cause Hypothesis: BUG 1 CAUSES BUG 2

**Theory:** The MWOM #198 card crash triggers a React error boundary that causes re-render loops:

```
1. User opens MWOM #198 card
2. Render crashes (black screen) due to data shape issue
3. React error boundary catches crash, attempts recovery
4. Recovery triggers re-mount of component
5. Re-mount triggers 3 parallel API calls (???)
6. New data arrives, triggers render
7. Render crashes again (same issue)
8. Loop repeats every 5-8 seconds
```

**Evidence supporting this theory:**
- Timing matches: ~6s average (API call duration + render attempt)
- Count matches: 3 simultaneous calls (unexplained, but consistent)
- Duration matches: User likely tried to use app for ~75s before giving up
- No other explanation for 14 repeated triplicate bursts

**Questions:**
1. **Why 3 parallel calls?** What code path fires 3 simultaneous `/api/enrich` requests?
   - Is there a `Promise.all([...])` with 3 items somewhere?
   - Does the card detail view fetch multiple related items in parallel?
2. **What triggers re-mount?** Does the error boundary auto-retry, or is user manually retrying?

### Cost Impact Analysis

**75-second window, 14 triplicate bursts = 42 API calls total**

Assuming each call:
- `/api/enrich` with claudeCheck: ~3K Sonnet tokens input + ~200 output
- Total: ~3,200 tokens per call
- 42 calls × 3,200 tokens = **134,400 tokens**

At Sonnet 4.5 pricing ($3/1M input, $15/1M output):
- Input: 126,000 tokens × $3/1M = $0.38
- Output: 8,400 tokens × $15/1M = $0.13
- **Total cost: ~$0.51 for this 75-second incident**

**If this happened once:** Minor cost.  
**If this is a persistent crash-retry loop:** Could burn $0.51 every time a user opens MWOM #198, or ANY book that triggers the crash.

---

## Diagnosis Summary

### Are Bug 1 and Bug 2 the same bug?
**LIKELY YES.** The triplicate polling pattern strongly suggests a crash-retry loop triggered by Bug 1.

### Root Cause (Best Hypothesis)
1. MWOM #198 has data that crashes card detail rendering
2. Crash triggers React error boundary recovery
3. Recovery re-mounts component, firing 3 parallel API calls (unknown why 3)
4. Cycle repeats every ~6s until user gives up

### Unresolved Questions
1. **What renders MWOM #198 unrenderable?**
   - Need: Browser DevTools error message
   - Need: Full `item` object dump from localStorage
2. **Why 3 parallel calls?**
   - Need: Code path that fires `Promise.all` with 3 enrich requests
   - Search: `grep -rn "Promise.all.*enrich" src/`
3. **Is this ONLY MWOM #198, or a class of books?**
   - Hypothesis: Any book with `claudeCheckBlocker` + specific other fields

---

## Recommended Next Steps

### URGENT (Prevent cost drain)
1. **Add error boundary logging** to capture crash details
2. **Add retry limit** to prevent infinite loops (max 3 retries, then hard stop)
3. **Find the 3-parallel-call code path** and understand why it exists

### HIGH (Fix the crash)
1. **Get DevTools error** from user (or reproduce locally)
2. **Inspect MWOM #198 data** in `localStorage.getItem('cv_catalogue')`
3. **Add defensive null checks** wherever the crash is happening

### MEDIUM (Prevent recurrence)
1. **Add unit tests** for card rendering with various `decision.blockers` shapes
2. **Add integration test** for claudeCheckBlocker → decision → render pipeline
3. **Document expected data shapes** for all critical fields

---

## GREENLIGHT Required
Investigation complete. Awaiting:
1. User-provided DevTools error message (or approval to add debug logging)
2. Greenlight to add error boundary retry limits (prevents cost drain)
3. Greenlight to fix once root cause confirmed

**Status:** DIAGNOSIS IN PROGRESS — need runtime data to confirm hypothesis
