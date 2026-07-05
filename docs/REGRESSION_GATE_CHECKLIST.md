# REGRESSION GATE CHECKLIST — Post-Deploy 7/3/26

**DEPLOY STATE**: 
- Q32 merchandise gate ✓ LIVE
- Q31 Parts 1+2 wrong-series rejection ✓ LIVE
- Q35 CV suppression ✓ LIVE
- Q36a+c cleanup ✓ LIVE
- Q34 Part 1 variant fallback ≥1 ✓ LIVE
- Q33 accessory strip ❌ REVERTED (collision)
- Q30 floor fix ❌ REVERTED (rejected in review)

**COMMITS LIVE**: 5afe305 (revert Q30), 76972af (revert Q33), f92de4c (Q34), e212165 (Q35), 38f3d48 (Q36a+c), e34e90f (Q31), 3deaf21 (Q32)

---

## VERIFICATION PROTOCOL

Scan each book below and report:
1. **Price** (out.price)
2. **Decision** (out.decision.action)
3. **Kept comp series** (extract from out.comps.recentSales[].title — list DISTINCT series names, flag any wrong-series contamination)
4. **PASS/FAIL** vs gate criteria

---

## BOOK 1: Batman #222 (1970)

**GATE CRITERIA**:
- Price: $60–67 sold band (LIST_LOW tier acceptable)
- Decision: LIST_LOW or LIST_NOW (not RESEARCH, not DO_NOT_LIST)
- Comps: zero wrong-series contamination (all Batman #222)

**SCAN INSTRUCTIONS**: 
- Scan Batman #222 cover
- Extract from enrich response:
  - `out.price`
  - `out.decision.action`
  - `out.comps.recentSales` → list distinct series (should be 100% Batman #222)
  - Check for any non-Batman series in kept pool

**REPORT**:
```
Price: $_____
Decision: _____
Kept series: _____
PASS/FAIL: _____
Notes: _____
```

---

## BOOK 2: Hulk & Wolverine #1 (2024)

**GATE CRITERIA**:
- Price: $9–11 band
- Decision: LIST_NOW or LIST_LOW
- Comps: zero wrong-series contamination

**SCAN INSTRUCTIONS**: Same as Book 1

**REPORT**:
```
Price: $_____
Decision: _____
Kept series: _____
PASS/FAIL: _____
Notes: _____
```

---

## BOOK 3: MWOM #20 (The Mighty World of Marvel #20)

**GATE CRITERIA** (Q31 CRITICAL):
- Comps: **ZERO Mighty Samson #20 comps kept**
- Q31 Part 2 should preserve "Marvel" in "Mighty World of Marvel"
- Tokens after sanitization: ["mighty", "world", "marvel"] (≥3 tokens)
- "Mighty Samson" tokens: ["mighty", "samson"]
- Overlap: 1/3 = 33% < 50% threshold → REJECT ✓

**SCAN INSTRUCTIONS**:
- Scan MWOM #20 cover
- Extract `out.comps.recentSales` titles
- Grep for "Samson" in ANY kept comp title
- If ANY Samson comp kept → Q31 FAILED

**REPORT**:
```
Kept comp count: _____
Contains "Samson": YES/NO
Sample kept titles (first 3): _____
PASS/FAIL: _____
Notes: _____
```

---

## BOOK 4: Groo in the Wild #1 (2023)

**GATE CRITERIA** (Q31 CRITICAL):
- Comps: **ZERO "Groo: The Prophecy" comps kept**
- Q31 Part 1 adaptive threshold (≤2 tokens → 75% required)
- "Groo in the Wild" tokens: ["groo", "wild"]
- "Groo: The Prophecy" tokens: ["groo", "prophecy"]
- Overlap: 1/2 = 50% < 75% → REJECT ✓

**SCAN INSTRUCTIONS**:
- Scan Groo in the Wild #1 cover
- Extract `out.comps.recentSales` titles
- Grep for "Prophecy" in ANY kept comp title
- If ANY Prophecy comp kept → Q31 FAILED

**REPORT**:
```
Kept comp count: _____
Contains "Prophecy": YES/NO
Sample kept titles (first 3): _____
PASS/FAIL: _____
Notes: _____
```

---

## BOOK 5: Amazing Adventures #3 (Control)

**GATE CRITERIA**:
- Price: ~$103 blend (±10% acceptable)
- Decision: LIST_NOW or LIST_LOW
- No regression from prior sessions

**SCAN INSTRUCTIONS**: Same as Book 1

**REPORT**:
```
Price: $_____
Decision: _____
PASS/FAIL: _____
Notes: _____
```

---

## BOOK 6: Punisher #1 (Control)

**GATE CRITERIA**:
- Price: ~$19.99 (±10% acceptable)
- Decision: LIST_NOW
- No regression from prior sessions

**SCAN INSTRUCTIONS**: Same as Book 1

**REPORT**:
```
Price: $_____
Decision: _____
PASS/FAIL: _____
Notes: _____
```

---

## ITEM 7: Metal Sign (Q32 Test)

**GATE CRITERIA** (Q32 CRITICAL):
- Decision: **DO_NOT_LIST** (hard block)
- Blocker message: "Non-comic asset detected — verify item type before listing"
- Log must show: `[Q32] MERCHANDISE detected` with category vote breakdown
- assetType: "merchandise"

**SCAN INSTRUCTIONS**:
- Scan ANY metal sign with comic artwork (Action Comics #33 tin sign ideal)
- OR construct manual-entry test: title="Action Comics #33 Metal Sign", assetType left undefined
- Check Vercel logs for `[Q32]` lines
- Extract `out.assetType`, `out.decision`, `out.merchandiseDetected`

**REPORT**:
```
assetType: _____
decision.action: _____
decision.blockers: _____
Log shows [Q32] vote: YES/NO (paste line if YES)
PASS/FAIL: _____
Notes: _____
```

---

## Q32 MONITORING (7-DAY WATCH)

For next 7 days, review EVERY `[Q32]` log line in production:
- **EXPECTED**: metal signs, posters, figurines, trading cards voting "merchandise"
- **ALERT**: ANY real comic voting "merchandise" (≥50% merchandise votes)
  - Expand COMICS_CATEGORY_TREE allowlist with the comic's eBay category ID
  - DO NOT rely on memory — extract category ID from live log line
  - Add to imageSearchIdentity.js COMICS_CATEGORY_TREE Set

**MONITORING COMMAND** (run daily):
```bash
vercel logs --since=24h | grep "\[Q32\]"
```

---

## COMPLETION CRITERIA

**ALL 7 items must PASS** before any Q is marked CLOSED.

- [ ] Batman #222 PASS
- [ ] Hulk & Wolverine #1 PASS
- [ ] MWOM #20 PASS (zero Samson)
- [ ] Groo in the Wild #1 PASS (zero Prophecy)
- [ ] AA #3 PASS (control)
- [ ] Punisher #1 PASS (control)
- [ ] Metal sign PASS (Q32 block)

**IF ANY FAIL**: Stop, report failure detail, await fix before continuing.

**WHEN ALL PASS**: 
1. Close Q32, Q31 Parts 1+2, Q35, Q36a+c, Q34 Part 1 as VERIFIED
2. Q33 remains OPEN (collision, needs redesign)
3. Q30 remains OPEN (floor fix rejected, deferred to Ship #20b)
4. Proceed to Gate 3 targeted scans

---

## NEXT SESSION BLOCKERS

1. Q33 redesign: context-aware accessory strip (bag/board ONLY when adjacent to w/, with, +, &)
2. Q36b trace: "Asking $4–$525" on Brave & Bold #28 (needs live data)
3. Gate 3: UK pence / null-publisher / X-Men Anniversary re-scans
4. Temp commit cleanup: revert 73a2f53 (Q29 diagnostic) after Gate 3 closure

---

**PREPARED**: 2026-07-03 18:56 UTC  
**DEPLOY HASH**: 76972af (Q33 revert)  
**AWAITING**: User execution of 7-item scan
