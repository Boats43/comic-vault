# VALIDATION RULING — 2026-07-05
## Session: Deployment Verification Sweep

---

## Q59 [P0]: finalPrice Not Propagated to recommended/priceBands Display

**STATUS:** CONFIRMED — pricing corrections (sanity/thin-pool) modify `out.price` at lines 3915-3925 but `priceBands` object built at line 2897 reads from `priceBandsRaw` (pre-correction values).

**ROOT CAUSE:**
1. `priceBandsRaw` computed at line 2850 (pre-pricing-chain)
2. `out.priceBands` built at lines 2897-2914 from `priceBandsRaw.{quick,market,stretch}`
3. Sanity/thin-pool/floor corrections modify `out.price` at lines 3268-3925
4. **No rebuild of `out.priceBands` after corrections**

**EVIDENCE (enrich.js):**
```
Line 2850: const priceBandsRaw = computePriceBandsFromSold({...})
Line 2897: out.priceBands = {
             quick: fmtUsd(priceBandsRaw.quick),   // PRE-CORRECTION
             market: fmtUsd(priceBandsRaw.market), // PRE-CORRECTION
             stretch: fmtUsd(priceBandsRaw.stretch),
           }
Line 3268: out.price = fmtUsd(priceBandsRaw.market);  // First assignment
Line 3915: out.price = fmtUsd(floorNum);  // FINAL RE-ENFORCEMENT (corrections)
Line 3920: out.priceLow = fmtUsd(floorNum * 0.85);
Line 3921: out.priceHigh = fmtUsd(floorNum * 1.25);
           // priceBands NEVER updated — still shows pre-correction values
```

**GATE CONDITION:**
Symbiote Spider-Man #1 scan → finalPrice ~$8.30 (thin-pool anchored), `out.priceBands` displays $472.50.

**FIX REQUIRED:**
After line 3925 (final floor re-enforcement), rebuild `out.priceBands` from current `out.price/priceLow/priceHigh`:
```javascript
if (priceBandsRaw && (out.floorReEnforced || out.thinPoolAnchored || sanityFired)) {
  const currentPrice = parseFloat(String(out.price).replace(/[$,]/g, ''));
  const currentLow = parseFloat(String(out.priceLow).replace(/[$,]/g, ''));
  const currentHigh = parseFloat(String(out.priceHigh).replace(/[$,]/g, ''));
  out.priceBands = {
    quick: fmtUsd(currentLow),
    market: fmtUsd(currentPrice),
    stretch: fmtUsd(currentHigh),
    source: out.priceBands.source,
    count: out.priceBands.count,
    tier: out.priceBands.tier,
    variantAdjusted: out.priceBands.variantAdjusted,
  };
  console.log(`[price-bands-rebuild] corrected quick/market/stretch after pricing chain`);
}
```

**Recommended display also stale:**
Line 4303-4306: `recommendedPrice = rawComps?.average * 1.15` (pre-correction). Should read final `out.price`.

---

## Q53 [REOPENED]: activePool=0 on Production Scans

**STATUS:** CLAIM FALSE — commit 3b8e174 diff shows NO WIRE to match-conf. activeCount assignment at line 4074 is INSIDE match-conf calculation, NOT passed to `calculateMatchConfidence()`.

**COMMIT DIFF (3b8e174):**
```diff
-      const activeCount = rawComps?.count || 0;
+      // Q53: Wire tier's verified activePool to match-conf. Tier-3 uses priceBandsRaw.count
+      const activeCount = (priceBandsRaw?.tier === 3 && priceBandsRaw.count != null)
+        ? priceBandsRaw.count
+        : (rawComps?.count || 0);
```

**ROOT CAUSE:**
`activeCount` variable at line 4074 is declared AFTER `calculateMatchConfidence()` call (line ~3970). The wire never reaches the confidence calculation.

**EVIDENCE:**
```
Line 3970: const mc = calculateMatchConfidence({...})  // activeCount NOT in params
Line 4074: const activeCount = (priceBandsRaw?.tier === 3...)  // DECLARED AFTER
```

**ACTUAL FLOW:**
- `calculateMatchConfidence()` has NO `activeCount` parameter
- The variable at 4074 is used ONLY for display messages (lines 4759, 4789, 4824)
- Match-conf tier detection still reads `rawComps.count` (AI-verified pool, relaxed)

**GATE FAILURE:**
Symbiote Spider-Man #1 should show tier=3, activePool=3 (verified), match-conf HIGH. Production shows tier=MEDIUM, activePool=0 because the fix never wired to confidence calculation.

**FIX REQUIRED:**
Pass `activeCount` into `calculateMatchConfidence()` params OR read `priceBandsRaw.count` directly inside confidence calculation when `tier === 3`.

---

## Q58 [REOPENED]: Cavewoman issue=null (Backfill Not Firing)

**STATUS:** CLAIM FALSE — commit a37901e adds backfill logic at lines 2554-2580 BUT places it AFTER `rawComps = compsFromEbay` assignment (line 2548). If `compsFromEbay` is null/empty when `confirmedIssue=null`, the consensus check never runs.

**COMMIT DIFF (a37901e):**
```diff
+    if (!confirmedIssue && rawComps?.prices && rawComps.prices.length > 0) {
+      const issuePattern = /#\s*(\d+)/;
+      const issueCounts = {};
+      rawComps.prices.forEach(p => {
+        const match = (p.title || '').match(issuePattern);
+        if (match) {
+          const num = match[1];
+          issueCounts[num] = (issueCounts[num] || 0) + 1;
+        }
+      });
```

**ROOT CAUSE:**
Cavewoman scan → Vision misses `issue` → `confirmedIssue=null` → PriceCharting skips (requires issue) → `compsFromEbay` may be empty → consensus check gated by `rawComps?.prices.length > 0` never fires.

**CHICKEN-EGG PROBLEM:**
- PC requires `issue` → skips when null
- Comp fetching requires `title` + `issue` → may skip when `confirmedIssue=null`
- Consensus check requires `rawComps.prices.length > 0` → never populates if fetching skipped

**EXPECTED FLOW:**
1. Fetch comps with `title` only (no issue filter) when `confirmedIssue=null`
2. Extract consensus issue from comp titles
3. Re-run PC/enrich with backfilled issue

**ACTUAL FLOW:**
Backfill logic fires ONLY when comps already exist. If comp fetching skipped due to missing issue, consensus never runs.

**GATE FAILURE:**
Cavewoman scan → issue=null persists, no backfill, no pricing.

**FIX REQUIRED:**
Move consensus backfill BEFORE PriceCharting call OR relax comp-fetching to allow title-only queries when `issue=null`.

---

## Q55-C: Extend Artist Strip List (dekal, spears)

**STATUS:** CONFIRMED — commit 4d1a2a9 adds 38 artist tokens to strip list BUT missing `dekal` and `spears`. ARTIST_PATTERNS at line 104-124 shows full registry (60+ artists) but tokenizeTitle strip list (lines 207-213) only contains 38.

**MISSING ARTISTS:**
- `dekal` (InHyuk Lee, Dell'Otto) — multi-word patterns exist, single-word `dekal` missing
- `spears` — not in ARTIST_PATTERNS OR strip list

**EVIDENCE:**
```javascript
// Line 104-124: ARTIST_PATTERNS (60+ entries, multi-word + single-word)
/inhyuk lee/i, /dell'?otto/i, ...  // Multi-word has "dekal" phonetic
// Single-word: NO /dekal/i, NO /spears/i

// Line 207-213: artistWords strip Set (38 entries)
'skan', 'rapoza', 'quash', 'momoko', 'ross', 'adams', ...
// MISSING: 'dekal', 'spears', ~20 others from ARTIST_PATTERNS
```

**ROOT CAUSE:**
Strip list manually constructed from subset of ARTIST_PATTERNS. Incomplete sync.

**FIX REQUIRED:**
1. Add missing artists: `'dekal', 'spears'`
2. Full-audit sync: Extract ALL single-word last names from ARTIST_PATTERNS (60+), add to strip Set
3. Consider programmatic extraction from ARTIST_PATTERNS regex list to prevent future drift

**CONSENSUS PATH CHECK:**
Q55-C asks for "artist-name pass on consensus AND top-rank paths". Consensus path (backfill issue from comp titles, Q58 territory) already strips artist tokens via `tokenizeTitle`. Top-rank path = ??? (needs clarification: variant consensus? creator credits?)

---

## TYPO: "undefinedd"

**STATUS:** NOT FOUND — grep returns zero matches. Commit a37901e message claims "not found in codebase. Skipped."

**EVIDENCE:**
```bash
$ grep -rn "undefinedd" .
docs/DEPLOY_2026-07-05.md:81:### "undefinedd" Typo
docs/DEPLOY_2026-07-05.md:82:**STATUS:** Not found in codebase...
```

**VERDICT:** False positive. No fix required.

---

## P0-A Residual: Legacy Browse_API Path

**STATUS:** CONFIRMED — 1 legacy path at line 3320-3346 still logs warnings. Dead code marker at line 3347 shows `else if (false)` block (PC path).

**EVIDENCE:**
```javascript
Line 3320: } else if (rawComps && rawComps.count > 0) {
Line 3327:   console.warn('[P0-A-LEGACY-PATH] browse_api fallback fired...');
Line 3333:   // P0-A TEMPORARY: refuse-to-price instead of using browse_api average.
Line 3347: } else if (false) {  // P0-A DEAD CODE MARKER — legacy PC path
```

**ACTIVE LEGACY PATHS:**
1. Line 3320-3346: `rawComps.count > 0` fallback (ACTIVE, logs warning, refuses to price)
2. Line 3347-3398: `else if (false)` block (DEAD CODE, can be deleted)

**PRODUCTION LOG LINE (expected if residual fires):**
```
[P0-A-LEGACY-PATH] browse_api fallback fired — tier-4 null, rawComps exist.
rawComps.count: N
title: <title>
issue: <issue>
```

**ACTION REQUIRED:**
1. Search production logs for `[P0-A-LEGACY-PATH]` string
2. If found: identify which books trigger the path, adjust tier-3 adaptive threshold
3. If zero hits after 48h: delete lines 3320-3346 (replace with tier-4 refuse-to-price)
4. Delete lines 3347-3398 immediately (dead code)

---

## SUMMARY

| Issue | Status | Commit | Fix Required |
|-------|--------|--------|--------------|
| Q59 [P0] | CONFIRMED | None | Rebuild priceBands after corrections |
| Q53 | FALSE CLAIM | 3b8e174 | Wire activeCount to calculateMatchConfidence |
| Q58 | FALSE CLAIM | a37901e | Move consensus backfill before PC call |
| Q55-C | CONFIRMED | 4d1a2a9 | Add 'dekal', 'spears' + full artist sync |
| Typo | NOT FOUND | N/A | None |
| P0-A | CONFIRMED | ab45c7c | Monitor logs, delete dead code |

**NEXT STEPS:**
1. Fix Q59 (priceBands rebuild) — BLOCKING for accuracy
2. Fix Q53 (activeCount wire) — match-conf tier detection broken
3. Fix Q58 (consensus backfill placement) — Cavewoman class still broken
4. Fix Q55-C (artist strip list) — 3/19 junk identities trace to incomplete strip
5. Monitor P0-A logs for 48h, delete dead code if zero hits

**DEPLOYMENT GATE:**
ALL fixes must show production log lines proving the code path executed. "Claimed fixed but zero evidence" pattern detected across Q53/Q58 — require log-line proof per fix.
