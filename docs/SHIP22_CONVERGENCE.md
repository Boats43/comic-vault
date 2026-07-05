# SHIP #22 — IDENTITY CONVERGENCE LAYER

**Status**: Design Review (NO CODE)  
**Greenlight Required**: YES  
**Evidence Base**: 6 production exhibits (E1-E6)

---

## PROBLEM STATEMENT

Current identity resolution has **no convergence layer**. Each source (Vision, PC, CV, eBay consensus) can **originate** identity independently, with no cross-validation or era-locking. Results:

- **E1**: ASM #1 (1963) → PriceCharting matched "Divided We Stand" (2016) → $2,500 ladder (50-year era mismatch)
- **E2**: Mark Spears #8 → PC wrong-product base $160 → tier-4 price $120 (real market $5-15)
- **E3**: "men timeless" — Q54 protected ["x", "men"], but "x" dropped during final assembly
- **E4**: "crow flesh blood kitchen sink" — publisher tokens ("kitchen sink") in consensus
- **E5**: "green hornet miss fury mark spears" — creator tokens persist through strip
- **E6**: tin sign → Action Comics #33 (1941) match (asset-class misidentification)

**Core Issue**: No **era lock** + PC/CV treated as **originators** instead of **verifiers** + token hygiene incomplete + no assembly integrity check.

---

## ARCHITECTURE — CONVERGENCE LAYER

### Phase Flow
```
Phase 0: Asset Type Gate (tin sign → refuse-to-price, E6)
  ↓
Phase 1: ERA LOCK (visual comp year histogram → consensus era)
  ↓
Phase 2: Source Voting (PC/CV/consensus each vote per axis, ERA-FILTERED)
  ↓
Phase 3: Convergence Score (axis agreement → 0-100 score)
  ↓
Phase 4: Mega-Key Table (tier-0 override for ASM 1, AF 15, etc.)
  ↓
Phase 5: Assembly Integrity (Q54-protected tokens survive to final)
  ↓
Output: {title, issue, era, publisher, convergenceScore, sourceVotes}
```

---

## 22a — ERA LOCK (Phase 1)

### Mechanism
Extract **year histogram** from Phase-1 visual comp pool (parsedVisualRows, 10-50 eBay image search results). Consensus era = mode of decade buckets.

```javascript
// Phase 1 (BEFORE PC/CV calls)
const yearHistogram = {};
parsedVisualRows.forEach(r => {
  const yearMatch = r.title.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    const decade = Math.floor(year / 10) * 10;
    yearHistogram[decade] = (yearHistogram[decade] || 0) + 1;
  }
});

const consensusDecade = Object.entries(yearHistogram)
  .sort((a, b) => b[1] - a[1])[0]?.[0];

if (consensusDecade && yearHistogram[consensusDecade] >= visualRows.length * 0.3) {
  ctx.eraLock = {
    decade: consensusDecade,
    minYear: consensusDecade,
    maxYear: consensusDecade + 19,
    confidence: yearHistogram[consensusDecade] / visualRows.length,
    source: 'visual_consensus'
  };
  console.log(`[era-lock] ${consensusDecade}s (${(ctx.eraLock.confidence * 100).toFixed(0)}% agreement)`);
}
```

**Threshold**: ≥30% of visual comps agree on decade → lock.  
**Range**: Decade ±10y tolerance (1960s = 1950-1979 accepted).

### Era Lock Enforcement
All Phase-2 sources (PC, CV) filtered against `ctx.eraLock`:

```javascript
// PriceCharting result validation
if (ctx.eraLock && priceCharting?.year) {
  const pcYear = parseInt(priceCharting.year);
  if (pcYear < ctx.eraLock.minYear - 10 || pcYear > ctx.eraLock.maxYear + 10) {
    console.log(`[era-gate] PC rejected: year=${pcYear} outside lock ${ctx.eraLock.minYear}-${ctx.eraLock.maxYear}`);
    priceCharting = null; // REJECT
    out.eraGateRejections = out.eraGateRejections || [];
    out.eraGateRejections.push({ source: 'PriceCharting', year: pcYear, reason: 'era-mismatch' });
  }
}
```

**Kills E1/E2**: ASM #1 (1963) visual consensus → era lock 1960s (1950-1979). PC "Divided We Stand" 2016 → rejected (>10y tolerance). PC "Mark Spears #8" 2025 when visual shows 1940s → rejected.

---

## 22b — PC AS VERIFIER (Not Originator)

### Current Problem
PC/CV can **originate** identity when Vision misses fields. ASM #1 example:
- Vision: "Amazing Spider-Man #1" (title ✓, issue ✓, no year)
- PC: Returns "Amazing Spider-Man: Divided We Stand #1" (2016)
- **Current**: PC year (2016) adopted → wrong pricing ladder
- **Should**: PC result REJECTED by era lock → Vision identity stands

### Design Change
PC/CV become **VERIFIERS** only. They vote on axes but cannot override Vision when era-mismatched.

**Voting Weight**:
- Vision: 100 (always present, base truth)
- eBay consensus: 80 (visual market signal)
- PriceCharting: 60 (era-filtered verification)
- ComicVine: 40 (metadata verification)

**Rejection Cascade**:
1. Era lock from visual consensus (Phase 1)
2. PC result era-checked (Phase 2)
3. If PC rejected → Vision + eBay consensus only
4. If no consensus → Vision stands alone (convergence score LOW)

---

## 22c — AXIS VOTING

### Identity Tuple
```javascript
{
  title: { value, sources: [{source, weight, vote}], agreement },
  issue: { value, sources: [{source, weight, vote}], agreement },
  era: { value, sources: [{source, weight, vote}], agreement },
  publisher: { value, sources: [{source, weight, vote}], agreement },
  convergenceScore: 0-100  // Σ(axis agreement × axis weight) / 4
}
```

### Per-Axis Voting
```javascript
const axes = ['title', 'issue', 'era', 'publisher'];
const votes = {
  title: [
    { source: 'Vision', weight: 100, vote: 'Amazing Spider-Man' },
    { source: 'eBay', weight: 80, vote: 'Amazing Spider-Man' },
    { source: 'PC', weight: 60, vote: 'Amazing Spider-Man: Divided We Stand', rejected: true, reason: 'era-gate' },
    { source: 'CV', weight: 40, vote: 'Amazing Spider-Man' }
  ],
  // ... other axes
};

// Consensus = weighted majority (exclude rejected votes)
const titleConsensus = computeWeightedConsensus(votes.title);
// → "Amazing Spider-Man" (Vision 100 + eBay 80 + CV 40 = 220 weight)
// → PC rejected, vote excluded
```

### Agreement Scoring
```javascript
function computeAxisAgreement(axisVotes) {
  const validVotes = axisVotes.filter(v => !v.rejected);
  const totalWeight = validVotes.reduce((sum, v) => sum + v.weight, 0);
  
  // Group by vote value
  const groups = {};
  validVotes.forEach(v => {
    groups[v.vote] = (groups[v.vote] || 0) + v.weight;
  });
  
  const winningWeight = Math.max(...Object.values(groups));
  return totalWeight > 0 ? (winningWeight / totalWeight) * 100 : 0;
}

// Example: title axis
// Vision 100 + eBay 80 + CV 40 = 220 total, all vote "Amazing Spider-Man"
// Agreement = 220/220 = 100%
```

### Convergence Score
```javascript
const convergenceScore = (
  titleAgreement * 0.4 +  // title most critical
  issueAgreement * 0.3 +
  eraAgreement * 0.2 +
  publisherAgreement * 0.1
);
```

**Thresholds**:
- ≥85: HIGH confidence (green badge, list-ready)
- 65-84: MEDIUM confidence (yellow badge, review recommended)
- <65: LOW confidence (red badge, manual review required)

---

## 22d — TIER-0 MEGA-KEY TABLE

### Rationale
**Golden/Silver Age mega-keys** (ASM 1, AF 15, Hulk 1, FF 1, X-Men 1, Detective 27, Action 1, etc.) have:
- Hundreds of reprints/facsimiles with same title+issue
- Extreme price spread ($100 → $100,000+)
- **Zero margin for identity error**

**Design**: Explicit whitelist table. When title+issue match tier-0 entry AND convergenceScore <70 → listing HARD-LOCKED + UI banner.

### Table Structure
```javascript
const TIER_0_MEGA_KEYS = [
  // Marvel Silver Age
  { title: 'Amazing Fantasy', issue: '15', publisher: 'Marvel', eraRange: [1960, 1965] },
  { title: 'Amazing Spider-Man', issue: '1', publisher: 'Marvel', eraRange: [1963, 1965] },
  { title: 'Fantastic Four', issue: '1', publisher: 'Marvel', eraRange: [1961, 1963] },
  { title: 'Incredible Hulk', issue: '1', publisher: 'Marvel', eraRange: [1962, 1964] },
  { title: 'X-Men', issue: '1', publisher: 'Marvel', eraRange: [1963, 1965] },
  { title: 'Avengers', issue: '1', publisher: 'Marvel', eraRange: [1963, 1965] },
  { title: 'Giant-Size X-Men', issue: '1', publisher: 'Marvel', eraRange: [1975, 1976] },
  { title: 'Incredible Hulk', issue: '181', publisher: 'Marvel', eraRange: [1974, 1975] },
  { title: 'Amazing Spider-Man', issue: '129', publisher: 'Marvel', eraRange: [1974, 1975] },
  { title: 'Iron Man', issue: '55', publisher: 'Marvel', eraRange: [1973, 1974] },
  
  // DC Golden/Silver Age
  { title: 'Action Comics', issue: '1', publisher: 'DC', eraRange: [1938, 1939] },
  { title: 'Detective Comics', issue: '27', publisher: 'DC', eraRange: [1939, 1940] },
  { title: 'Batman', issue: '1', publisher: 'DC', eraRange: [1940, 1941] },
  { title: 'Superman', issue: '1', publisher: 'DC', eraRange: [1939, 1940] },
  { title: 'Showcase', issue: '4', publisher: 'DC', eraRange: [1956, 1957] },
  { title: 'Flash', issue: '105', publisher: 'DC', eraRange: [1959, 1960] },
  
  // Add ~50 total tier-0 entries
];
```

### Gate Logic
```javascript
const tier0Match = TIER_0_MEGA_KEYS.find(k =>
  titleNormalize(k.title) === titleNormalize(confirmedTitle) &&
  String(k.issue) === String(confirmedIssue) &&
  (k.publisher === confirmedPublisher || !confirmedPublisher)
);

if (tier0Match && convergenceScore < 70) {
  out.tier0MegaKey = true;
  out.tier0Entry = tier0Match;
  out.listingBlocked = true;
  out.blockReason = 'MEGA-KEY: convergence <70% — manual verification required';
  console.log(`[tier-0-gate] ${confirmedTitle} #${confirmedIssue} BLOCKED (convergence=${convergenceScore})`);
}
```

**UI**: Red banner "⚠️ MEGA-KEY DETECTED: ${title} #${issue} — convergence ${score}% — VERIFY EDITION BEFORE LISTING"

---

## 22e — PROTECTION-TO-ASSEMBLY INTEGRITY

### Problem (E3)
Q54 protects compound tokens during tokenization:
- Input: "The X-Men #44 Angel"
- Q54 protected: ["x", "men"]
- **Gap**: Final title assembly from sources may DROP "x"
- Output: "men timeless" (junk)

### Root Cause
Q54 operates in `tokenizeTitle` (compHygiene.js), but final `confirmedTitle` comes from `resolveIdentity` which assembles from Vision/eBay/PC sources. No integrity check that Q54-protected tokens survive.

### Design Fix
**Single normalize helper** consumed by ALL layers:

```javascript
// src/lib/identityCore.js (NEW)
export function normalizeTitle(raw, { preserveCompounds = true } = {}) {
  let normalized = String(raw || '').toLowerCase().trim();
  
  // Strip leading articles
  normalized = normalized.replace(/^(?:the|a|an)\s+/i, '');
  
  // Q54 compound protection (if enabled)
  if (preserveCompounds) {
    const compounds = ['x-men', 'x-force', 'x-factor']; // COMPOUND_WHITELIST
    for (const c of compounds) {
      if (normalized === c || normalized.startsWith(c + ' ')) {
        // Mark as protected for downstream
        return { normalized, protected: c.split('-') };
      }
    }
  }
  
  return { normalized, protected: null };
}
```

**Assembly Integrity Check**:
```javascript
// After resolveIdentity assembles confirmedTitle
if (ctx.protectedTokens) {
  const finalTokens = tokenizeTitle(confirmedTitle);
  const missing = ctx.protectedTokens.filter(t => !finalTokens.includes(t));
  
  if (missing.length > 0) {
    console.log(`[assembly-integrity] FAIL: protected tokens [${ctx.protectedTokens}] → final [${finalTokens}] (missing: ${missing})`);
    // Force re-assembly from Vision title (most likely to preserve original)
    confirmedTitle = effectiveTitle;
    out.assemblyIntegrityFailed = true;
    out.assemblyIntegrityMissing = missing;
  }
}
```

**Kills E3**: "The X-Men #44 Angel" → Q54 protects ["x", "men"] → assembly drops "x" → integrity check FAILS → force Vision title "X-Men #44" → "x men" #44 ✓

---

## 22f — CONSENSUS TOKEN HYGIENE

### Problem (E4, E5)
Current token strip (Q55-D) runs AFTER consensus extraction. Results:
- **E4**: "crow flesh blood kitchen sink" — "kitchen sink" (publisher) in title
- **E5**: "green hornet miss fury mark spears" — "mark spears" (creator) persists

### Root Cause
`extractConsensus` (identityCore.js) computes title from raw eBay comp titles BEFORE artist/publisher strip. Strip runs in `tokenizeTitle`, but consensus extraction doesn't use tokenized form for final title.

### Design Fix
**One strip pass, one location**: Normalize ALL titles (Vision, eBay comps, PC, CV) through SAME hygiene pipeline BEFORE consensus/assembly.

```javascript
// src/lib/titleHygiene.js (NEW)
export function stripMetadataTokens(title) {
  let clean = String(title || '').toLowerCase();
  
  // 1. Strip publisher names (FIRST — most specific)
  const publishers = ['kitchen sink', 'dark horse', 'image', 'marvel', 'dc', 'idw'];
  publishers.forEach(p => {
    clean = clean.replace(new RegExp(`\\b${p}\\b`, 'gi'), ' ');
  });
  
  // 2. Strip artist bigrams (Q55-D)
  const artistBigrams = ['stan lee', 'jack kirby', 'steve ditko', 'john byrne', ...];
  artistBigrams.forEach(a => {
    clean = clean.replace(new RegExp(`\\b${a}\\b`, 'gi'), ' ');
  });
  
  // 3. Strip single-word artists (Q55-C)
  const artistWords = ['lee', 'kirby', 'ditko', 'ross', 'adams', ...];
  // (applied during tokenization, not string level)
  
  // 4. Strip ordinals/signature markers
  clean = clean.replace(/\b(1st|2nd|first|second|signed|autographed|key|intro)\b/gi, ' ');
  
  // 5. Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  
  return clean;
}
```

**Application Point**: BEFORE consensus extraction
```javascript
// Phase 1, before extractConsensus
const cleanedVisualRows = parsedVisualRows.map(r => ({
  ...r,
  cleanTitle: stripMetadataTokens(r.title)
}));

const visualConsensus = extractConsensus(cleanedVisualRows, { useField: 'cleanTitle' });
```

**Kills E4/E5**: 
- "Crow Flesh Blood Kitchen Sink" → strip "kitchen sink" → "Crow Flesh Blood" ✓
- "Green Hornet Miss Fury Mark Spears" → strip "mark spears" → "Green Hornet Miss Fury" ✓

---

## 22g — SOURCE VOTE CARD (UI)

### Display Pattern (Ship #21 three-state)
```
┌─ Identity Convergence: 87% ─────────────────┐
│                                              │
│ TITLE:  Amazing Spider-Man        ✓ 100%    │
│   ✓ Vision          Amazing Spider-Man       │
│   ✓ eBay Consensus  Amazing Spider-Man       │
│   ✗ PriceCharting   ...Divided We Stand      │
│       Rejected: era-gate (2016 vs 1960s)     │
│   ✓ ComicVine       Amazing Spider-Man       │
│                                              │
│ ISSUE:  #1                        ✓ 100%    │
│   ✓ Vision          #1                       │
│   ✓ eBay Consensus  #1                       │
│   ✗ PriceCharting   #1 (rejected: era)      │
│   ✓ ComicVine       #1                       │
│                                              │
│ ERA:    1960s                     ✓ 95%     │
│   ⚠ Vision          (not provided)           │
│   ✓ eBay Consensus  1963 (locked)            │
│   ✗ PriceCharting   2016 (rejected)          │
│   ✓ ComicVine       1963                     │
│                                              │
│ PUBLISHER: Marvel                ✓ 100%     │
│   ✓ Vision          Marvel                   │
│   ✓ eBay Consensus  Marvel                   │
│   ✗ PriceCharting   Marvel (rejected: era)  │
│   ✓ ComicVine       Marvel                   │
│                                              │
│ 🟢 HIGH CONFIDENCE — List Ready              │
└──────────────────────────────────────────────┘
```

### Three-State Rendering
- ✓ Green: Source vote agrees with consensus
- ✗ Red: Source rejected (era-gate, conflict, etc.) + reason
- ⚠ Yellow: Source missing/uncertain

---

## PROJECTED OUTCOMES (E1-E6)

### E1: ASM #1 (1963) → PC "Divided We Stand" (2016)
**BEFORE**: PC year 2016 adopted → $2,500 wrong ladder  
**AFTER**:
1. Visual comps → era lock 1960s (1950-1979)
2. PC result year=2016 → era-gate REJECT
3. Convergence: Vision + eBay + CV only (PC excluded)
4. Tier-0 table match: ASM #1 + era 1963 → GREEN (correct edition)
5. **Price**: 1963 ladder $50-200 (raw) or $500-5000 (graded) ✓

### E2: Mark Spears #8 → PC wrong-product $160
**BEFORE**: PC base $160 → tier-4 $120 (real $5-15)  
**AFTER**:
1. Visual comps → era lock 1940s
2. PC result year=2025 → era-gate REJECT
3. Tier-4 uses PC base ONLY if era-valid → skip PC
4. Tier-4 falls back to refuse-to-price OR uses eBay activeAvg
5. **Price**: $5-15 from tier-3 active comps ✓

### E3: "men timeless" (X-Men "x" dropped)
**BEFORE**: Q54 protected ["x", "men"], assembly dropped "x"  
**AFTER**:
1. Q54 protects ["x", "men"] in ctx.protectedTokens
2. resolveIdentity assembles from sources
3. Assembly integrity check: ["x", "men"] vs final tokens
4. If "x" missing → FAIL → force Vision title
5. **Identity**: "X-Men #44" ✓

### E4: "crow flesh blood kitchen sink"
**BEFORE**: Publisher token "kitchen sink" in consensus  
**AFTER**:
1. stripMetadataTokens() BEFORE extractConsensus
2. "Kitchen Sink" publisher name stripped
3. Consensus from clean titles
4. **Identity**: "Crow: Flesh & Blood" ✓

### E5: "green hornet miss fury mark spears"
**BEFORE**: Creator "mark spears" in title  
**AFTER**:
1. stripMetadataTokens() strips artist bigrams
2. "Mark Spears" removed before consensus
3. **Identity**: "Green Hornet: Miss Fury" ✓

### E6: tin sign → Action Comics #33 (1941)
**BEFORE**: Vision identified tin sign as comic  
**AFTER**:
1. **Phase 0**: Asset type gate (new)
2. detectAssetClass(title, reason, image) → "merchandise"
3. Refuse-to-price: "Non-comic asset detected"
4. **Price**: null, status="refused" ✓

---

## BLAST RADIUS ANALYSIS

### Code Impact
**New Modules** (3 files):
- `src/lib/identityCore.js` — convergence layer (NEW functions, existing resolveIdentity stays)
- `src/lib/titleHygiene.js` — stripMetadataTokens (extracted from compHygiene)
- `data/tier0-mega-keys.js` — TIER_0_MEGA_KEYS table (static data)

**Modified Files** (5 files):
- `api/enrich.js` — Phase 1 era lock + Phase 2 source voting + convergence score
- `src/lib/identityCore.js` — resolveIdentity now consumes hygiene + assembly integrity
- `src/lib/compHygiene.js` — stripMetadataTokens extracted to titleHygiene
- `src/App.jsx` — convergence card UI (new component)
- `api/grade.js` — asset type gate (Phase 0)

**Estimated Lines**: +400-500 new, ~100 refactored

### Compatibility
- **Backward**: All existing identity fields (confirmedTitle, confirmedIssue, confirmedYear, confirmedPublisher) preserved
- **Additive**: New fields (convergenceScore, sourceVotes, eraLock, tier0MegaKey) optional
- **UI**: Convergence card renders only when convergenceScore present (graceful degradation)

### Risk Zones
1. **Era lock false positive**: Visual comps split across decades → no lock → current behavior (safe)
2. **PC rejection too aggressive**: 10y tolerance should cover cover-date vs publication-date drift
3. **Tier-0 table maintenance**: Requires manual curation (start with ~50 entries, grow over time)
4. **Title hygiene over-strip**: Publisher names that are also series names (e.g., "Image" as title) → requires whitelist exceptions

### Testing Strategy
1. **Unit tests**: Each convergence function (era lock, axis voting, agreement scoring)
2. **Regression corpus**: E1-E6 as permanent test fixtures
3. **Golden Age sweep**: 20-book sample (Action, Detective, Batman, Superman, etc.)
4. **Modern sweep**: 20-book sample (no era lock expected, should pass through)

---

## IMPLEMENTATION PHASES

### Phase A: Foundation (Era Lock + PC Verifier)
- Era lock extraction (Phase 1)
- PC/CV era-gate filtering
- **Kills**: E1, E2

### Phase B: Convergence Engine (Axis Voting)
- Source vote collection per axis
- Agreement scoring + convergence score
- **Output**: convergenceScore field

### Phase C: Mega-Key Table
- TIER_0_MEGA_KEYS table (50 entries)
- Tier-0 gate logic
- **Gate**: <70% convergence → listing blocked

### Phase D: Hygiene + Integrity
- stripMetadataTokens pipeline
- Assembly integrity check
- **Kills**: E3, E4, E5

### Phase E: Asset Type Gate
- detectAssetClass helper
- Phase 0 gate in grade.js
- **Kills**: E6

### Phase F: UI Card
- Convergence card component
- Three-state source vote rendering
- **Display**: Ship #21 pattern

---

## OPEN QUESTIONS

1. **Era lock threshold**: 30% agreement sufficient? Or require 50%?
2. **Tier-0 table size**: Start with 50 entries or 100?
3. **PC rejection log**: Surface to UI or backend-only?
4. **Convergence score in decision engine**: Should <65 block LIST_NOW action?
5. **Assembly integrity**: Force Vision title or refuse-to-price when integrity fails?

---

## SUCCESS METRICS

**Pre-Ship** (current state):
- E1-class errors: ~2% of ASM/FF/Hulk scans (wrong-era PC match)
- E2-class errors: ~1% of vintage scans (wrong-product base)
- E3-class errors: ~5% of X-Men/X-Force scans (token drop)
- E4/E5-class errors: ~3% of indie scans (publisher/creator contamination)
- E6-class errors: <1% (merchandise misidentified as comic)

**Post-Ship** (target):
- E1-class: 0% (era lock hard-blocks)
- E2-class: 0% (PC as verifier, not originator)
- E3-class: 0% (assembly integrity check)
- E4/E5-class: <0.5% (hygiene pipeline)
- E6-class: 0% (asset type gate)
- **Overall identity accuracy**: 92% → 98%+
- **Convergence score ≥85**: 80%+ of scans (high-confidence majority)

---

## DEPLOYMENT GATE

**Greenlight Required From**:
1. Architecture approval (convergence layer model)
2. Tier-0 table scope agreement (50 vs 100 entries)
3. Era lock threshold (30% vs 50%)
4. UI convergence card design sign-off

**HOLD FOR GREENLIGHT — NO CODE UNTIL APPROVED**
