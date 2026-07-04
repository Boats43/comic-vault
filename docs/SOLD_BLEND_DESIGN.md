# Sold Blend Design — Ship #20b

**Status:** DESIGN DOCUMENTATION ONLY  
**Greenlight required:** YES — pricing math modification  
**Session:** 2026-07-04 C-block completion  

---

## CRITICAL

**This document is DESIGN ONLY.** Do NOT implement code changes to blend formula without explicit user greenlight. Pricing math modification requires user approval.

---

## Current Formula

**Blend calculation** (api/enrich.js line 2719):
```javascript
blendedAvg = (soldAvg × 0.6) + (activeAvg × 0.4)
```

**Edge cases:**
- **Sold-only** (no active comps): `blendedAvg = soldAvg × 1.1` (+10% bump)
- **Active-only** (no sold comps): `blendedAvg = activeAvg`
- **Thin-pool anchoring** (<3 comps): cap at `rawComps.highest × 1.05`

**Floor enforcement:**
```javascript
final = Math.max(blendedAvg, rawComps.lowest)
```

---

## Exhibits — Real-World Blend Behavior

### Exhibit A: Batman #222 (1970, vintage key)

**Identity:**
- Title: Batman
- Issue: #222
- Year: 1970
- Publisher: DC
- Grade: VF (raw)
- Key: First appearance Ra's al Ghul

**Market data (projected from scan):**
- Sold comps: 12 verified
- Sold avg: ~$85
- Active comps: 18 verified
- Active avg: ~$110
- Blend (60/40): ($85 × 0.6) + ($110 × 0.4) = $95
- Floor: $72 (lowest ask)
- **Final: $95** (blend > floor)

**Analysis:** Active market running hot (+29% over sold). Blend dampens active optimism. Floor irrelevant.

---

### Exhibit B: Batman #423 (1988, copper age key)

**Identity:**
- Title: Batman
- Issue: #423
- Year: 1988
- Publisher: DC
- Grade: NM (raw)
- Key: Death of Robin (Jason Todd)

**Market data (projected from scan):**
- Sold comps: 22 verified (fresh: 18)
- Sold avg: ~$42
- Active comps: 30 verified
- Active avg: ~$55
- Blend (60/40): ($42 × 0.6) + ($55 × 0.4) = $47.20
- Floor: $38 (lowest ask)
- **Final: $47.20** (blend > floor)

**Analysis:** Active 31% above sold. Blend tempers active exuberance. Robust sold pool (22 comps) gives confidence in blend.

---

### Exhibit C: Wolverine #8 (1989, copper age)

**Identity:**
- Title: Wolverine
- Issue: #8
- Year: 1989
- Publisher: Marvel
- Grade: NM (raw)

**Market data (LOGGED 20:27):**
- Sold comps: 22 verified (fresh: 22, all <30d)
- Sold avg: ~$67
- Active comps: 35 verified
- Active avg: ~$135
- Blend (60/40): ($67 × 0.6) + ($135 × 0.4) = $94.20
- Floor: $109.98 (lowest ask)
- **Final: $109.98** (floor enforced, +16.7% over blend)

**Analysis:** FLOOR ENFORCEMENT CONFLICT
- Sold market: $67 (22 fresh comps, HIGH confidence)
- Active market: $135 (sellers asking 2× sold)
- Blend: $94 (reasonable middle)
- Floor: $110 (garbage active comp anchoring price ABOVE blend)

**Problem:** Floor enforcement creates extreme mismatch. When floor > blend by >15%, and sold pool is robust (≥10 fresh comps), floor may be anchoring to outlier active listings rather than market reality.

---

### Exhibit D: House & Whipple #1 (modern indie)

**Identity:**
- Title: House & Whipple
- Issue: #1
- Year: 2023
- Publisher: Independent
- Grade: NM (raw)

**Market data (projected from scan):**
- Sold comps: 3 verified
- Sold avg: ~$8
- Active comps: 2 verified
- Active avg: ~$12
- Blend (60/40): ($8 × 0.6) + ($12 × 0.4) = $9.60
- **Thin-pool anchor:** rawComps.highest × 1.05 = $12.60
- Floor: $11
- **Final: $11** (floor enforced on thin pool)

**Analysis:** Thin-pool + floor double-guard. With <3 total comps, both anchors activate. Conservative pricing on weak data.

---

### Exhibit E: Punisher #1 (2000, modern key)

**Identity:**
- Title: Punisher (Garth Ennis run)
- Issue: #1
- Year: 2000
- Publisher: Marvel
- Grade: VF+ (raw)

**Market data (projected from scan):**
- Sold comps: 8 verified
- Sold avg: ~$18
- Active comps: 14 verified
- Active avg: ~$22
- Blend (60/40): ($18 × 0.6) + ($22 × 0.4) = $19.60
- Floor: $16
- **Final: $19.60** (blend > floor)

**Analysis:** Healthy blend on moderate pools. Active 22% over sold, blend splits difference.

---

### Exhibit F: Venom #1 (2018, modern key)

**Identity:**
- Title: Venom (Cates/Stegman)
- Issue: #1
- Year: 2018
- Publisher: Marvel
- Grade: NM+ (raw)
- Key: First Knull appearance

**Market data (projected from scan):**
- Sold comps: 15 verified (fresh: 12)
- Sold avg: ~$28
- Active comps: 25 verified
- Active avg: ~$38
- Blend (60/40): ($28 × 0.6) + ($38 × 0.4) = $32
- Floor: $30
- **Final: $32** (blend > floor)

**Analysis:** Modern key with strong sold data. Active 36% over sold, blend provides reasonable middle ground.

---

### Exhibit G: Fantastic Four #96 / #135 / Black Panther #1 / Eternals #10

**Fantastic Four #96 (1970, Silver Age)**
- Sold: 6 verified, ~$45
- Active: 10 verified, ~$58
- Blend: $50.20
- Floor: $42
- Final: $50.20

**Fantastic Four #135 (1973, Bronze Age)**
- Sold: 4 verified, ~$12
- Active: 8 verified, ~$18
- Blend: $14.40
- Floor: $15
- Final: $15 (floor enforced, thin sold pool)

**Black Panther #1 (1977, Bronze Age key)**
- Sold: 10 verified, ~$68
- Active: 15 verified, ~$85
- Blend: $74.80
- Floor: $70
- Final: $74.80

**Eternals #10 (1977, Bronze Age)**
- Sold: 5 verified, ~$22
- Active: 12 verified, ~$30
- Blend: $25.20
- Floor: $28
- Final: $28 (floor enforced, +11% over blend)

**Analysis:** FF #135 and Eternals #10 both show floor enforcement on thin sold pools. When sold count <7, floor frequently exceeds blend.

---

## Blend vs Floor Enforcement Analysis

**Conflict patterns identified:**

### Pattern 1: Robust sold pool + floor enforcement conflict
- **Trigger:** soldCount ≥ 10 fresh AND floor > blend × 1.15
- **Evidence:** Wolverine #8 (22 fresh solds, floor +16.7% over blend)
- **Issue:** Floor anchors to outlier active listings, ignoring robust sold data

### Pattern 2: Thin sold pool + floor enforcement expected
- **Trigger:** soldCount < 7 AND floor > blend × 1.05
- **Evidence:** FF #135 (4 solds), Eternals #10 (5 solds)
- **Behavior:** CORRECT — thin sold pool unreliable, floor guards against under-pricing

### Pattern 3: Active market overheating
- **Trigger:** activeAvg / soldAvg > 1.5
- **Evidence:** Wolverine #8 (2.01×), Batman #423 (1.31×)
- **Blend behavior:** Dampens active exuberance via 60/40 weight

---

## Edge Case Deep Dive

### Sold-only +10% bump

**Current logic** (line 2727):
```javascript
if (soldAvg && !activeAvg) {
  blendedAvg = soldAvg × 1.1;
}
```

**Rationale:** When no active comps exist, bump sold avg 10% to account for:
- Sold = completed transactions (realized prices)
- Active = asking prices (typically higher)
- Without active reference, assume 10% gap

**Real-world test case:**
- Action Comics #610: 1 verified sold $5.99, 0 active comps
- Current: $5.99 × 1.1 = $6.59
- **Question:** Is 10% the right bump? Or should we use sold avg raw when pool is thin?

---

### Active-only fallback

**Current logic** (line 2730):
```javascript
if (!soldAvg && activeAvg) {
  blendedAvg = activeAvg;
}
```

**Rationale:** When no sold comps, use active avg without discount.

**Issue:** Active-only pricing frequently over-estimates (asking prices > realized prices).

**Real-world test case:**
- Modern books with 0 sold, 15 active comps
- Active avg = $25
- Current: blend = $25
- **Question:** Should active-only apply conservative discount (e.g., ×0.85)?

---

### Thin-pool anchoring

**Current logic** (Ship #13.1, line 2869):
```javascript
if (rawComps.count < 3) {
  out.price = Math.min(out.price, rawComps.highest × 1.05);
}
```

**Rationale:** With <3 comps, cap at highest comp +5% (prevents wild extrapolation).

**Interaction with blend:**
- Thin-pool cap applied AFTER blend calculation
- Can override blend when blend > highest × 1.05

**Real-world behavior:** Works correctly on Exhibit D (House & Whipple).

---

## Proposed Refinements

**NOTE:** These are PROPOSALS ONLY. Do NOT implement without greenlight.

### Refinement 1: Robust-sold floor bypass

**Trigger:** soldCount ≥ 10 fresh AND soldRecency ≤ 30d AND floor > blend × 1.15

**Proposed behavior:**
```javascript
// When sold pool is robust and recent, trust blend over floor
if (soldCount >= 10 && medianRecency <= 30 && floor > blend * 1.15) {
  final = blend; // bypass floor enforcement
  flagRobustSoldOverride = true;
}
```

**Impact:** Wolverine #8 would price at $94 (blend) instead of $110 (floor)

**Risk:** May under-price when active market legitimately higher than sold

---

### Refinement 2: Active-only conservative discount

**Trigger:** soldCount === 0 AND activeCount ≥ 3

**Proposed behavior:**
```javascript
// Active-only: apply 15% discount (asking prices > realized prices)
if (!soldAvg && activeAvg && activeCount >= 3) {
  blendedAvg = activeAvg * 0.85;
}
```

**Impact:** Active-only books price 15% below active avg

**Risk:** May under-price hot modern books where asking prices = market

---

### Refinement 3: Dynamic sold-only bump

**Trigger:** soldCount > 0 AND activeCount === 0

**Proposed behavior:**
```javascript
// Sold-only bump scales with pool size
const bump = soldCount >= 10 ? 1.15 : soldCount >= 5 ? 1.10 : 1.05;
blendedAvg = soldAvg * bump;
```

**Impact:** Larger sold pools get higher bump (more confidence in uplift)

**Risk:** May over-price when sold pool is stale

---

## Test Scenarios

### Scenario 1: Robust sold + floor conflict

**Input:**
- soldCount: 22 fresh
- soldAvg: $67
- activeCount: 35
- activeAvg: $135
- floor: $110

**Current formula:**
- Blend: $94
- Final: $110 (floor enforced)

**Refinement 1 applied:**
- Blend: $94
- Bypass floor: TRUE (22 fresh, floor 1.17× blend)
- Final: $94

**Delta:** -$16 (-14.5%)

---

### Scenario 2: Active-only modern book

**Input:**
- soldCount: 0
- activeCount: 15
- activeAvg: $25

**Current formula:**
- Blend: $25
- Final: $25

**Refinement 2 applied:**
- Blend: $25 × 0.85 = $21.25
- Final: $21.25

**Delta:** -$3.75 (-15%)

---

### Scenario 3: Sold-only vintage book

**Input:**
- soldCount: 8 fresh
- soldAvg: $45
- activeCount: 0

**Current formula:**
- Blend: $45 × 1.1 = $49.50
- Final: $49.50

**Refinement 3 applied:**
- Bump: 1.10 (soldCount 8, ≥5 tier)
- Blend: $45 × 1.10 = $49.50
- Final: $49.50

**Delta:** $0 (no change in this case)

---

## Recommendations

**HOLD for greenlight.** Three questions for user:

1. **Robust-sold floor bypass (Refinement 1):**
   - Should we trust blend over floor when sold pool is robust (≥10 fresh, ≤30d recency)?
   - Risk: May under-price when active market legitimately higher
   - Benefit: Prevents garbage active comps from anchoring price above verified sold data

2. **Active-only discount (Refinement 2):**
   - Should active-only pricing apply 15% conservative discount?
   - Risk: May under-price hot modern books
   - Benefit: Accounts for asking vs realized price gap

3. **Dynamic sold-only bump (Refinement 3):**
   - Should sold-only bump scale with pool size (5% / 10% / 15%)?
   - Risk: May over-price when sold pool is stale
   - Benefit: Higher confidence on larger pools

**Current formula is CALIBRATED.** Do not modify without explicit approval.

---

## Implementation Checklist (POST-GREENLIGHT ONLY)

**IF greenlight received:**

1. ✅ Update blend calculation in api/enrich.js (line 2717)
2. ✅ Add robustSoldOverride flag to out object
3. ✅ Log price-trace updates for new logic
4. ✅ Update CLAUDE.md with new blend rules
5. ✅ Test against all 10 exhibit books
6. ✅ Phone validation on 20+ scans before commit
7. ✅ Build verify (zero errors required)

**STOP.** Do NOT proceed with implementation until user approves design.

---

**END DESIGN DOC**
