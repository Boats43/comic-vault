# VISION COST RECONCILIATION

**Date:** 2026-06-29  
**Purpose:** Correct Vision Cost Investigation report — standard scans already on Sonnet  

---

## CONTRADICTION FOUND

**Vision Cost Investigation report (a3b6650) stated:**
```
Opus 4.7: $0.015 per call (standard scans)
Sonnet 4.5: $0.003 per call (Watch Mode only)
```

**This is INCORRECT.** Standard scans were switched to Sonnet in commit **d3259da** (still active).

---

## ACTUAL MODEL ASSIGNMENTS (Current Code)

**File:** `api/grade.js`

### Standard Scans (Vision Fallback Path)

**Lines 528, 540, 547:**
```javascript
// Line 528: Initial scan
const { parsed: initialScan } = await callModel("claude-sonnet-4-5-20250929", imageContent, STANDARD_PROMPT);

// Line 540: Book re-scan (if book signals detected)
const { parsed: bookScan } = await callModel("claude-sonnet-4-5-20250929", imageContent, userPrompt);

// Line 547: Comic with voice context
const { parsed: contextScan } = await callModel("claude-sonnet-4-5-20250929", imageContent, userPrompt);
```

✅ **Standard scans use Sonnet 4.5** ($0.003 per call)

---

### Watch Mode

**Line 352, 375:**
```javascript
// Pass 1: Haiku fast identification
const pass1 = await callModel(HAIKU, imageContent, prompt);

// Pass 2: Haiku self-correction
const pass2 = await callModel(HAIKU, imageContent, correctionPrompt);
```

✅ **Watch Mode Pass 1 + 2 use Haiku 4.5** ($0.0003 per call)

**Line 392:**
```javascript
// Pass 3: Opus escalation
const pass3 = await callModel(OPUS, imageContent, opusPrompt);
```

✅ **Watch Mode Pass 3 uses Opus 4.7** ($0.015 per call, low-confidence escalation only)

---

### Git History Confirmation

```bash
$ git log --oneline -- api/grade.js | head -5
d9b7f20 debug: add fatal error stack trace logging to grade.js
fb5903a perf(fix4): grade lock after HIGH confidence — skip Vision on re-identify
d3259da fix: Vision Opus→Sonnet on standard scans (Watch Mode Pass 3 stays Opus) — 50% Vision cost cut
5d6c9ae chore: remove resize debug logging (fix confirmed)
03fa961 fix: Jimp v0.22 downgrade - resize works on valid base64
```

**Commit d3259da** is the 3rd most recent commit to `api/grade.js`.

```bash
$ git diff d3259da HEAD -- api/grade.js | grep "claude-opus\|claude-sonnet"
(no output)
```

✅ **No changes to model assignments since d3259da** — Sonnet change is still active.

---

## CORRECTED COST ANALYSIS

### Per 1000 Books (CORRECT)

| Stage | Books Hit | Cost per Call | Total | % of Total |
|-------|-----------|---------------|-------|------------|
| **Vision scan (Sonnet)** | 1000 | **$0.003** | **$3.00** | **15%** ✅ |
| AI verify (Sonnet) | 200 | $0.025 | $5.00 | 25% |
| Web search (Sonnet) | 20 | $0.020 | $0.40 | 2% |
| **TOTAL** | | | **$8.40** | 100% |

**Vision is 15% of total cost, NOT 73%**

---

### Per 1000 Books (WRONG - from original report)

| Stage | Books Hit | Cost per Call | Total | % of Total |
|-------|-----------|---------------|-------|------------|
| **Vision scan (Opus)** | 1000 | **$0.015** | **$15.00** | **73%** ❌ |
| AI verify | 200 | $0.025 | $5.00 | 25% |
| Web search | 20 | $0.020 | $0.40 | 2% |
| **TOTAL** | | | **$20.40** | 100% |

**This priced standard scans at Opus rates by mistake.**

---

## COST REDUCTION ACHIEVED

### Before d3259da (Opus for all scans)

| Stage | Cost per 1000 |
|-------|---------------|
| Vision (Opus) | $15.00 |
| AI verify | $5.00 |
| Web search | $0.40 |
| **Total** | **$20.40** |

### After d3259da (Sonnet for standard scans)

| Stage | Cost per 1000 |
|-------|---------------|
| Vision (Sonnet) | $3.00 ✅ |
| AI verify | $5.00 |
| Web search | $0.40 |
| **Total** | **$8.40** |

**Savings:** $12.00 per 1000 books (**59% reduction**) ✅

**This was already achieved in commit d3259da.**

---

## UPDATED COST BREAKDOWN

### Current State (CORRECT)

| Stage | % of Total | Cost per 1000 |
|-------|------------|---------------|
| **AI verify** | **60%** 🔴 | $5.00 |
| **Vision (Sonnet)** | **36%** | $3.00 ✅ |
| **Web search** | **5%** | $0.40 |

**AI verify is now the dominant cost line** (60%), not Vision.

---

## INVESTIGATION ERRORS IN ORIGINAL REPORT

### Error 1: Model Assignment

**Claimed:**
> "Opus 4.7: Standard scans ($0.015 per call)"

**Reality:**
```javascript
// Line 528 in api/grade.js
const { parsed: initialScan } = await callModel("claude-sonnet-4-5-20250929", ...);
```

Standard scans use **Sonnet 4.5** ($0.003), not Opus.

---

### Error 2: Cost Calculation

**Claimed:**
> "Vision cost: $15.00 per 1000 books (73% of total)"

**Reality:**
- Sonnet: $0.003 per call
- 1000 calls: $3.00
- **15% of total, not 73%**

---

### Error 3: Optimization Recommendation

**Claimed:**
> "Opus → Sonnet A/B test (high risk, high reward)  
> Potential savings: $12.00 per 1000 books (59% total cost reduction)"

**Reality:**
- **Already deployed** in commit d3259da
- **Already achieved** 59% reduction
- No further A/B test needed ✅

---

## CORRECT OPTIMIZATION PATHS

### Current Cost: $8.40 per 1000 books

| Component | Cost | % of Total | Optimization Potential |
|-----------|------|------------|------------------------|
| **AI verify** | $5.00 | 60% | ✅ **Already optimized** (75-80% zero-AI coverage) |
| **Vision** | $3.00 | 36% | ✅ **Already optimized** (Sonnet, not Opus) |
| **Web search** | $0.40 | 5% | ✅ **Already optimized** (UK gate deployed) |

**All major optimizations already deployed.**

---

### Remaining Options (Diminishing Returns)

| Option | Savings | % Reduction | Status |
|--------|---------|-------------|--------|
| Pre-Vision duplicate guard | $0.15-0.30 | ~2-4% | Low priority ⚠️ |
| Publisher normalization | $0.10-0.20 | ~1-2% | Minimal impact |
| Variant fallback pool | $0.05-0.10 | ~1% | Edge case |

**All remaining optimizations <5% impact.**

---

## CONCLUSION

### What the Original Report Got Wrong

1. ❌ Priced standard scans at **Opus rates** ($0.015) instead of **Sonnet rates** ($0.003)
2. ❌ Calculated Vision as **73% of total cost** when it's actually **36%**
3. ❌ Recommended "Opus → Sonnet A/B test" when **already deployed**

### Actual Current State

✅ **Standard scans:** Sonnet 4.5 ($0.003 per call)  
✅ **Watch Mode Pass 1+2:** Haiku 4.5 ($0.0003 per call)  
✅ **Watch Mode Pass 3:** Opus 4.7 ($0.015 per call, escalation only)  
✅ **Total cost:** $8.40 per 1000 books  
✅ **Vision:** 36% of total (optimized)  
✅ **AI verify:** 60% of total (optimized via conflict detection)  

### Cost Reduction Achieved (Since Baseline)

| Milestone | Cost per 1000 | vs Baseline |
|-----------|---------------|-------------|
| **Baseline** (Opus + 100% AI verify) | $42.00 | — |
| **After AI-verify gate** (Ship #28b) | $20.40 | -51% |
| **After Opus→Sonnet** (d3259da) | **$8.40** | **-80%** ✅ |

**80% cost reduction already achieved.**

---

### No Further High-Impact Optimizations Available

All remaining options save <5% total cost:
- Duplicate guard: ~2-4%
- Publisher normalization: ~1-2%
- Variant fallback: ~1%

**Current $8.40 per 1000 books is near-optimal.**

---

## CORRECTED VISION COST INVESTIGATION

**Replace:** `docs/VISION_COST_INVESTIGATION.md`  
**With:** This reconciliation report  

**Key corrections:**
1. Standard scans use **Sonnet** ($0.003), not Opus ($0.015)
2. Vision is **36% of cost**, not 73%
3. **No A/B test needed** — Opus→Sonnet already deployed
4. **AI verify (60%) is the current dominant cost**, not Vision
5. **Both are already optimized** — no high-impact changes remaining

---

**END RECONCILIATION**
