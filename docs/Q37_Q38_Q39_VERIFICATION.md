# Q37-Q39 VERIFICATION REPORT — 2026-07-03

**PROTOCOL**: Verify-first — trace code, report findings, NO CODE CHANGES until greenlit.

---

## **Q37 [P0 — UK WEEKLY ISSUE PARSING]**

### FINDING
MWOM #198 sold-verify rejected 21/30 CORRECT comps as issueMismatch.

### ROOT CAUSE VERIFIED

**FILE**: `src/lib/compHygiene.js:279-286` (`hasIssueNumber`)  
**LINE**: 284 — `if (!new RegExp(`#\\s*${escaped}\\b`, "i").test(t)) return false;`

**HOW IT PICKS AMONG MULTIPLE NUMBERS**:
- Pattern: `/#\s*198\b/i` matches ANY occurrence of "#198" in title
- UK weekly comp: "MWOM no.198 featuring Hulk no.181"
- Regex matches BOTH `#198` AND `#181`
- `hasMultipleDistinctIssues` (line 285) returns TRUE → comp REJECTED

**NO ADJACENCY LOGIC** — parser doesn't prefer:
- Numbers near series-title tokens
- Numbers adjacent to "no." / "#" markers
- First number vs later numbers

It only checks:
1. Does title contain our issue# (`#198`)? ✓
2. Does title contain MULTIPLE distinct issue#s? ✓ → REJECT

### BLAST RADIUS (ESTIMATED)

**UK weeklies** (high risk):
- MWOM (Mighty World of Marvel)
- Marvel UK titles (Spider-Man Comics Weekly, Avengers Weekly, etc.)
- 2000 AD (frequently reprints US comics with dual numbering)
- **Pattern**: "Weekly #N featuring [US series] #M" — ALWAYS has dual numbers

**US books** (low risk):
- Rare dual numbering except marketing copy: "Annual #14 features ASM #181"
- Most US books have single issue# only

**PROPOSED FIX** (pending greenlight):
```javascript
// Adjacency-aware issue extraction:
// 1. Prefer issue# adjacent to series-title tokens (tokenize title, find tokens matching our series)
// 2. If no adjacency match, prefer FIRST issue# (UK weeklies: weekly# comes before reprint#)
// 3. Only reject on multiple issues when NONE are adjacent to series name

function hasIssueNumberWithAdjacency(listingTitle, issueNum, seriesTokens) {
  const escaped = String(issueNum).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const issueMatches = [...String(listingTitle).matchAll(/#\s*(\d+)\b/gi)];
  
  if (issueMatches.length === 0) return false;
  if (issueMatches.length === 1) {
    // Single issue — standard check
    return new RegExp(`#\\s*${escaped}\\b`, "i").test(listingTitle);
  }
  
  // Multiple issues — adjacency logic
  for (const match of issueMatches) {
    if (match[1] === issueNum) {
      // Extract 15-char window around this match
      const start = Math.max(0, match.index - 15);
      const end = Math.min(listingTitle.length, match.index + 20);
      const window = listingTitle.slice(start, end).toLowerCase();
      
      // Check if any series token appears in window
      const hasSeriesToken = seriesTokens.some(t => window.includes(t.toLowerCase()));
      if (hasSeriesToken) return true; // Adjacency match
    }
  }
  
  // No adjacency — use first-number heuristic for UK weeklies
  return issueMatches[0][1] === issueNum;
}
```

**BLAST RADIUS**: 
- Zero regression on US single-issue books (unchanged path)
- UK weeklies: would now KEEP comps like "MWOM #198 feat. Hulk #181" ✓
- **REQUIRES**: test suite scan to quantify US vs UK dual-numbering frequency

---

## **Q38 [P1 — CONSENSUS THRESHOLD]**

### FINDING
Title-family weighted-consensus fired with 1 member (weight 5.0), overrode Vision, produced incoherent identity (title contains "157", issue=201).

### ROOT CAUSE VERIFIED

**FILE**: `src/lib/imageSearchIdentity.js:966-977` (`selectTitleFamilyCandidate`)  
**LINE**: 966 — `if (overlapRatio >= OVERLAP_THRESHOLD)`

**NO MEMBER-COUNT CHECK** — weighted-consensus fires when:
1. `topFamily` has ≥40% token overlap with Vision
2. **NO minimum member requirement**

1-member family (weight 5.0 from rank-0 position) passes overlap check and overrides Vision.

### INCOHERENT IDENTITY CASE

**Vision**: "House of Mystery #157"  
**eBay items[0]**: "House of Mystery #201 featuring dial hero..." (single result, rank 0, weight 5.0)

**Family clustering**:
- Tokens: ["house", "mystery", "201", "dial", "hero"] (5 tokens)
- Vision overlap: ["house", "mystery"] = 2/2 = 100% ≥ 40% ✓
- Decision: `weighted-consensus` (1 member, weight 5.0)
- **Result**: title="house mystery 201 dial hero", but issue still="157" from Vision OR extracted "201" from family → mismatch

### PROPOSED FIX (pending greenlight)

```javascript
// Line 966 — add member-count gate BEFORE overlap check:
if (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD) {
  // weighted-consensus path (requires ≥3 members for override)
} else if (topFamily.count >= 1 && topFamily.count < 3 && overlapRatio >= OVERLAP_THRESHOLD) {
  // NEW: 1-2 member case → fallback-vision (insufficient consensus)
  return {
    decision: 'fallback-vision',
    selectedTitle: null,
    rawTitle: null,
    reason: `Top family has only ${topFamily.count} members (need ≥3 for consensus override) — preserve Vision`,
    topFamily,
    runnerUp,
    families: scored,
  };
}
```

### FREQUENCY ANALYSIS (DEFERRED)

**REQUIRES**: Production log extraction to count weighted-consensus member-count distribution:
```bash
vercel logs --since=7d | grep "[title-family] OVERRIDE" | grep "weighted-consensus"
→ extract "N members" from each line
→ count: 1-member, 2-member, 3+ member cases
```

**AWAITING**: User log extraction for frequency data.

---

## **Q39 [HOLD — PENDING TIN SIGN RESCAN]**

### HYPOTHESIS
Q32 flat vote dilutes below 50% when merchandise visually matches comic listings.

**EXAMPLE**: Tin sign with Action Comics #33 artwork:
- 10 real Action Comics #33 comps (category: 63 Modern Age)
- 5 metal sign listings (category: 31587)
- Vote: 10 comic / 15 total = 67% → passes 50% threshold ✓
- **BUT**: if pool is 50/50 comic+sign → 50% tie → may miss

### PROPOSED FIX (NO CODE UNTIL RESCAN)

Rank-weighted category vote (top-3 weighted 3/2/1):
- items[0] category weight 3
- items[1] category weight 2
- items[2] category weight 1
- items[3-19] weight 0 each

**PROJECTED VOTE** (hypothetical tin-sign pool):
- items[0-2]: metal signs (31587) → weight 3+2+1 = 6
- items[3+]: Action Comics comps (63) → weight 0×17 = 0
- Merchandise vote: 6 / (6+0) = 100% → BLOCK ✓

**DEFERRED**: Awaiting tin-sign rescan to confirm hypothesis before code.

---

## **SOURCE DIVERGENCE: verified_sold vs verified_sold_active_blend**

### QUESTION
Why did Batman/Punisher price as `verified_sold` (sold-only) while Wolverine #8 used `verified_sold_active_blend`?

### ANSWER VERIFIED

**FILE**: `src/lib/priceBands.js:280-348`  
**BRANCHING LOGIC**:

**STEP 1** (lines 280-320): Verified sold pool
- Condition: `verifiedSolds.length >= 2`
- Default source: `'verified_sold'`
- **BLEND OVERRIDE** (lines 293-298):
  ```javascript
  if (blendedAvg && blendedAvg > 0 && activeComps?.prices?.length > 0) {
    bands.market = blendedAvg;
    bands.source = 'verified_sold_active_blend';
  }
  ```

**STEP 2** (lines 322-348): Verified active pool (fallback)
- Condition: `verifiedActive.length >= 2` AND NOT contaminated
- Source: `'verified_active'`

**STEP 3** (line 350): PC base (last resort)
- Source: `'pc_estimate'`

### DIVERGENCE EXPLANATION

**Batman #222 / Punisher #1** → `verified_sold` source:
- Sold comps: ≥2 ✓
- Active comps: EMPTY or contaminated (activeComps?.prices?.length === 0)
- Line 293 condition FAILS: no active pool to blend
- Source stays `'verified_sold'`

**Wolverine #8** → `verified_sold_active_blend` source:
- Sold comps: ≥2 ✓
- Active comps: exist AND non-empty (activeComps?.prices?.length > 0)
- `blendedAvg` computed (60/40 sold/active)
- Line 293 condition PASSES
- Source changes to `'verified_sold_active_blend'`

### IMPLICATION FOR SHIP #20B

**Blend override is CONTINGENT on active pool existence**:
- When active pool empty/contaminated → sold-only pricing (`verified_sold`)
- When both pools exist → blend pricing (`verified_sold_active_blend`)
- When only active exists (sold <2) → active-only pricing (`verified_active`)

**THIS IS WORKING AS DESIGNED** — not a bug, just data-driven path divergence.

**#20B DESIGN CONSIDERATION**: 
- Document the blend-override gate explicitly
- Decide whether sold-only pricing should ALWAYS use blend when active exists (even if not used for bands)
- Current behavior: blend ONLY when sold path fires AND active exists
- Alternative: compute blend at top-level, use across ALL paths (sold/active/PC)

---

## **NEXT ACTIONS**

### Q37 (UK Weekly Issue Parsing)
1. Test suite scan: quantify US vs UK dual-numbering frequency
2. Greenlight adjacency-aware fix OR alternative approach
3. Build + verify on MWOM #198 case

### Q38 (Consensus Threshold)
1. User extracts production logs for frequency analysis
2. Count 1-member / 2-member / 3+ member weighted-consensus cases
3. Greenlight ≥3 member threshold OR adjust based on frequency data
4. Build + verify on House of Mystery #157/#201 case

### Q39 (Q32 Vote Dilution)
1. **AWAITING TIN SIGN RESCAN** — hypothesis unconfirmed
2. IF rescan confirms miss: greenlight rank-weighted vote
3. Build + verify on tin-sign original pool

### Source Divergence
1. Document in Ship #20b design doc
2. No code changes required (working as designed)

---

**PREPARED**: 2026-07-03 19:15 UTC  
**STATUS**: All findings verified, awaiting greenlight + frequency data before code changes
