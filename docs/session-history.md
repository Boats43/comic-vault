# Comic Vault — Session History Archive

Detailed session narratives, ship implementation notes, and historical
context. Main repo guidance lives in `CLAUDE.md`. This file is append-only;
new sessions go at the top.

---

## Session 2026-04-27 — Ship #20a.6 phone validation + 25-fix field intelligence

Ship #20a.6 (sold comp verification, commit `d971267`) deployed Friday.
Phone-validated against 7 real scans — surfaced 25 distinct fixes across
identification, pricing accuracy, UI, and platform behavior.

**Discovery: repo auto-deploys on push to main.** `git push origin main`
triggers a production build automatically. Promoted to primary deploy
protocol; `npx vercel --prod` retained as uncommitted-tree fallback.

**Donald Duck Whitman #978 case** drove the priority reshuffle. Engine
priced an unidentified Whitman BLB (Big Little Book) at ~$50 because no
explicit identity gate exists. Real Golden Age keys priced this way
could be 10× wrong. Trust hardening (refuse-to-price when identity
unknown) is now Layer A priority before any further pricing math.

**Chip 'n' Dale #6 case** — text fields verified correctly but cover
image showed a different book. Stock image / cover-photo divergence is
its own risk class.

**25 distinct fixes captured** (see Active Priority Queue in CLAUDE.md).
Reorganized into Layers A (trust hardening), B (pricing accuracy),
C (UI/semantic clarity), D (deferred/scope-large).

**Recalibration insights from external GPT review** (incorporated into
CLAUDE.md Recalibration section):
- Layer 1 was overclaimed at ~90%. Honest assessment: ~75%.
- Architecture-before-features priority order: trust → pricing → features.
- Total remaining effort: 130-200 hours over 12-24 months.
- "Bloomberg terminal for comic assets" is the aspirational frame, not
  current state. Don't overclaim.

**Validation status:** Ship #20a.6 phone-validated 4/27. Ships #18, #19,
#20a, #20a.5, #20a.7 still pending production observation pass.

---

## Session 2026-04-26 — Ship #20a.6 (sold comp verification + hygiene extraction)

Commit `d971267` — pricing-math change, explicit greenlight granted before
coding.

**Problem:** sold rows from PriceCharting now feed pricing math
(soldAvg → blendedAvg → sanity → thin-pool anchor → key-mult gate →
confidence) but were filtered only by a single `#issue` regex.

**Phase A — extraction (behavior-preserving):**
- New `src/lib/compHygiene.js` — pure-function home for shared regex +
  helper set: REPRINT_RE, SLAB_RE, GRADED_RE, VARIANT_CONTAM_RE,
  SIGNED_RE, TPB_MARKER_RE, OTHER_COVER_RE, LOT_RE, HALF_ISSUE_RE,
  ARTIST_PATTERNS (extended with `/jeehyung lee/`, `/alex ross/`,
  `/kaare andrews/`, `/fabok/` — multi-word entries placed before
  single-word `/ross/` so first-match-wins captures longest), STOP_WORDS,
  MIN_TOKEN_LEN, tokenizeTitle, hasSufficientTitleOverlap,
  parseListingGrade, applyPriceSanity, extractIssueNumber,
  hasIssueNumber, hasMultipleDistinctIssues, isValidIssueRange,
  detectSeriesMarkers (extended), extractArtist, cleanPublisher.
- `api/comps.js` re-exports the API surface so existing callers work
  unchanged. Net 271 lines removed from `api/comps.js`. All 911 baseline
  tests pass after extraction.

**Phase B — directives:**
- `detectSeriesMarkers` extended with `annual-N`, `special-N`,
  `king-size-N`, `giant-size-N`. `?` placeholder when format word
  appears without a number. Asymmetry filter treats prefix-? as wildcard.
- ARTIST_PATTERNS extended with 4 new entries (Jeehyung Lee, Alex Ross,
  Kaare Andrews, Fabok).

**Phase C — sold-specific filter chain (`src/lib/soldVerification.js`):**
`verifySoldComps(rawRows, ctx)` returns `{ verified, diagnostics }`. Hard
first / soft last:
- titleMismatch, issueMismatch, annualMismatch, printingMismatch,
  variantMismatch, slabMismatch, signed, lot, gradeMismatch, stale,
  outlier
- `out.soldCompsRaw`, `out.soldCompDiagnostics` surfaced for observability.
- Log: `[sold-verify] kept V/R (rejected N: reason=count, ...)`.

**Phase D — UI (`src/App.jsx`):**
5 client merge paths plumb `soldCompsRaw` + `soldCompDiagnostics`. Last
Sold chip: when `rawCount > verifiedCount`, displays "📊 V of R sold
verified · Xd ago". Standard "📊 N sold" stays when no gap.

**Pricing-math impact:** soldAvg recomputed from VERIFIED pool only →
blendedAvg shifts → sanity thresholds, thin-pool anchor cap, key-mult
gate, recommendedPrice all see the new pool. Direction is conservative.

**Priority cases (10/10 covered):** Thor #4 2nd print, Rogue & Gambit #1
Jeehyung Lee virgin, Three Jokers #3 Fabok B&W, Cloak and Dagger #9 raw
clean (positive control), Comics Interview #58 vs Marvel Age #58, Batman
& Outsiders Annual #1 vs Annual #2, Avengers #36 stale modern rows, raw
user → CGC slab rejection, signed/SS rejection, lot rejection.

**Tests:** 91 new in `tests/sold-verification.test.js`. Total 911 → 1002.
Vercel function count: 12/12 unchanged.

---

## Session 2026-04-25 — Ship #20a.7 (mega-key strict canonical guard)

Commit `4114bcb` — production validation hotfix.

**Bug:** TMNT #1 IDW 2016 (Funko Pop variant, $14 book) triggered
$15,000 mega-key floor. `getMegaKeyEntry` matched on title+issue only;
publisher and year were not consulted.

**False-positive examples blocked:**
- TMNT #1 IDW 2016 Funko Pop variant → $15K floor (the bug)
- TMNT #1 IDW 2011 (relaunch)
- TMNT #1 Image 1996
- Action Comics #1 facsimiles → MANUAL REVIEW
- Daredevil #1 Marvel 1998
- X-Men #1 Marvel 1991/2019/2024 (relaunches)

**Fix:**
- Schema: added `publisher` + `year` fields to all 29 mega-key entries.
- Pre-1962 entries: `yearTolerance: 2` (cover-date drift).
- Post-1962 entries: `yearTolerance: 1` (default, tight).
- Function signature: `getMegaKeyEntry(title, issue, publisher, year)`.
- All 4 call sites in `enrich.js` threaded.
- `normalizePublisher` collapses Timely/Atlas → marvel, etc.
- `PUBLISHER_ALIASES` includes `marvel comics group` for cover-printed
  legal name (1972-1986 era) — catches Bronze-era mega-keys.
- SCHEMA_VERSION: 1.0.0 → 2.0.0.

**Tests:** `tests/mega-keys.test.js` extended +133 assertions. Total
mega-key tests 61 → 194. Project total 778 → 911.

---

## Session 2026-04-24 — Ships #20a + #20a.5 (sold data + price ladder + velocity)

**Ship #20a — restore sold data via PC sales-history scrape (`7d20c93`):**

Investigation revealed sold data pipeline was DEAD since launch:
- eBay Marketplace Insights API: gated scope unavailable to indie devs.
- eBay Finding API: bypassed April 2026 (100% rate-limit errors).
- `filteredSold` had been `[]` in production from day one.
- Engine effectively 100% active-anchored (not 60/40 sold/active).

**Fix:** restore via PriceCharting sales-history scrape. Same HTML
`pricecharting-pop.js` already fetches (zero new requests).

Architecture:
- Refactored `pricecharting-pop.js` with shared `fetchPCProductHtml()` helper.
- New `fetchPricechartingSales(productId, userGrade)` extractor.
- Walks `completed-auctions-*` divs, extracts row data.
- Tags `marketplace: 'ebay' | 'heritage'`.
- Returns `soldComps` (user grade) + `salesByGrade` (all grades).
- 24h cache on raw HTML (single fetch serves both extractors).
- Wired into `enrich.js` Promise.all.

UI: existing "Last Sold" section now populates with real data.
Marketplace chip [eBay]/[HRT] per row. Count badge "📊 N sold · Xd ago".

**No pricing math changes in Ship #20a.** `out.confidenceLevel` calc
reads `soldCount` — fires HIGH for first time. Ship #20b (next) applies
sold-first weighting algorithm.

Tests: `tests/pricecharting-sales.test.js` +31. Total 728 → 759.

**Ship #20a.5 — price ladder + sales velocity (`0e3679f`):**

Extracted from same HTML:
- `out.priceLadder` — 14 grades for major books (raw, 2.0, 3.0, ..., 9.8, 10.0).
- `out.salesVelocity` — per-grade liquidity normalized to perDay numeric + label.

Live smoke (ASM #300, productId 2315040):
- 14 ladder grades extracted (raw $298.75 → 10.0 $3585).
- 6 velocity grades populated (raw 1/day → 9.8 1/week).

Future consumers:
- Ship #20b: grade-aware pricing (sold-first algorithm).
- Ship #25 (FR-5a.4): visual ladder display.
- Phase 6 (Decision Engine): `salesVelocity` feeds liquidity scoring.

Tests: +19. Total 759 → 778.

---

## Session 2026-04-25 — Ship #19 (AI-CROSS-LAYER-DISCONNECT MVP)

Commit `357a14e` — edition warning gate. Critical Star Wars #1 (1977)
production bug.

**Repro:** Vision Condition Report explicitly stated "35 cent REPRINT
edition" and "NOT the rare 35 cent first print variant" — engine used
1st print comps anyway, recommended $297 (1st print price). User listed
at engine rec. Real reprint market: $20-50.

**Root cause:** Vision writes edition/printing signals into the
free-form `reason` text. Pricing engine never reads that text.

**Ship #19 MVP scope:** detection + listing gate. Does NOT modify
pricing math (deferred to Ship #19b — 4-6h additional work for comp
pool filtering + recalibration).

**Detection (`api/grade.js`):**
- 8 EDITION_WARNING_PATTERNS: reprint, reprint edition, facsimile,
  later printing, "not the (1st/first/original)" with flexible word gap,
  "rare ... first print", etc.

**UI gate:** edition ack stacks AFTER mega-key ack. Existing flows
untouched.

Tests: `tests/edition-warning.test.js` +40. Total 688 → 728.

---

## Session 2026-04-25 — Ship #18 (CGC penalty-aware Vision)

Commit `6686db4` — data capture + advisory.

Extends Vision prompt (`STANDARD_PROMPT` only, Watch mode untouched) to
detect 5 CGC grading penalty classes plus pedigree recognition.

**Detected defects:**
1. Store stamps (~1.3 grades penalty, unless pedigree)
2. Staple popping (structural, not pressable)
3. Polybag indents (fixable via press)
4. Corner chips <1cm (up to 4 grades penalty, unfixable)
5. Pedigree stamps (22-entry registry, adds premium)

**Architecture:**
- `api/grade.js` STANDARD_PROMPT + JSON_SHAPE extended.
- WATCH_PROMPT untouched (Sonnet fast pass stays lean).
- `src/lib/pedigreeRegistry.js` (22 canonical pedigrees + aliases).
- `LOOKUP_MAP` precomputed at module load — O(1) name lookups.
- `lookupPedigree()` strict match (case-insensitive, no fuzzy).
- `enrichPedigree()` post-parses Vision response: alias→canonical.
- Wired into BOTH standard scan return AND watch pipeline pass 3
  (Opus escalation, where STANDARD_PROMPT is in play).
- Atomic nested `out.cgcPenaltyFlags` object: 8 merge paths × 1 line.
- UI advisory block in AI Condition Report with 5 emoji-coded severity tiers.

**Backward compatibility:**
- `item.cgcPenaltyFlags` guard in UI — old items show no advisory.
- Server-side missing flags → graceful.
- IndexedDB existing records don't need migration.

Tests: `tests/pedigree-registry.test.js` +66. Total 622 → 688.
Vercel function count: 12/12.

---

## Session 2026-04-24 — Ships #14-#17 (4-ship landmark day)

5 production deploys, 622 unit tests passing (up from 391).

**Ship #14 — sanity threshold recalibration (`92b0614`):**
- Fix 4.1: drop `compsAvg > 5` gate to `> 1` — closes modern overpricing
  (DP/Wolverine #2 $9.81 vs $3.54 avg, ASM Extra! #1 $11 vs $4.83 had
  sanity blocked entirely below the historical $5 floor).
- Fix 4.3: Silver+Bronze (1956–1984) low-side raised 0.5× → 0.6× —
  closes FF #61 1967 GD 6.0 stuck at $17.86 instead of $33.99 (ratio
  0.53 just missed old threshold). Boundary at 1956 (Showcase #4)
  rather than engine's `<1970` because FF #61 falls in Golden bucket.
- True Golden (pre-1956) low-side preserved at 0.5×. Modern unchanged.
- Asymmetry: high-side keeps `<1970/<1985` calibrated boundaries;
  low-side uses 1956 boundary.
- `computeSanityFallback(pcNum, compsAvg, { bookYear, lowCompsCount,
  isMixedFallback })` extracted as pure helper.
- 70 new assertions in `tests/sanity-thresholds.test.js`. 391 → 461.

**Ship #15 — list-price warning (`37ae32b` + `9092600` hotfix):**
Pure-UI yellow banner in CollectionDetail when user list-price exceeds
market. Three triggers, worst pctOver surfaced:
- A: `listPrice > engineRec × 1.25` (25% over)
- B: `listPrice > comps.highest × 1.20` (20% over)
- C: `listPrice > comps.average × 1.50` (50% over)

Skip flags: `megaKeyFloorApplied`, `manualReviewRequired`,
`gradeExceedsMap`. Session-only dismiss. Banner copy: `⚠ $X is N% above
{label} (${anchor}). Books priced above market typically stall.`

**Hotfix:** initial deploy failed (Vercel Hobby plan caps at 12
serverless functions; every `.js` in `api/` becomes one). Renamed
`api/list-price-warning.js` → `src/lib/listPriceWarning.js` (kebab to
camel matches `src/db.js`). 461 → 512.

**Ship #16 — premium creator credits (`49e04ad`):**
Extends Ship #12a multi-key extraction pattern to detect 80 tiered
creators (legend 20 / premium 25 / modern-premium 20 / current 15) in
comp listing titles.

`src/lib/premiumCreators.js`:
- Precompiled SEARCH_INDEX of word-boundary regexes at module load.
- `extractCreatorsFromComps(titles)` returns
  `{ consensus: hits>=2, singletons: hits===1 }`.
- Within-title dedup, cross-title accumulation, sources cap 3 per entry.
- Alias policy: 39 unambiguous last-names allowed (Wrightson, Aparo,
  Kirby, Ditko, Frazetta, Steranko, McFarlane, Liefeld, Silvestri,
  Byrne, Perez, Sienkiewicz, Bolland, Bisley, Larsen, Mignola,
  Madureira, Cassaday, Quitely, Bachalo, Capullo, McNiven, Coipel,
  Dell'Otto, Charest, Mahnke, Cheung, Jimenez, Hitch, Finch, Ribic,
  Maleev, Immonen, Asrar, Momoko, Skan, Mayhew, Parrillo, Nakayama,
  Artgerm, ...). Full-name required for ambiguous (Neal Adams vs Arthur
  Adams, Jim Lee vs Stan Lee, Frank Miller vs Mike Miller, ...).
- Optional `role: 'writer' | 'artist' | 'cover'` field surfaced.

Architecture note: `api/enrich.js` imports from `../src/lib/...` works
because Vercel bundles transitively-imported files into the function
bundle. Pattern reusable for future server-imported helpers.

Tests: 65 new in `tests/creator-from-comps.test.js`. 512 → 577.

**Ship #17 — bottom-of-census low-grade floor anchor (`a35b2e6`):**
When PriceCharting pop data confirms user's grade is bottom of CGC
census (`pop.belowGrade === 0`) AND pricing fell back to `browse_api`,
re-anchor `out.price` to `rawComps.lowest`.

Bug target: JLA #62 (1968) GD 2.0 — sanity LOW lifted to compsAvg ≈
$30, pop says belowGrade=0 across 65 tracked, comp.lowest = $8 →
re-anchored.

Conservative gate: only fires when `pricingSource === 'browse_api'`.
PC × grade-mult outputs preserved. Position: AFTER thin-pool anchor,
BEFORE mega-key floor.

Surfaces `out.lowGradeFloorApplied` + `out.lowGradeFloorAnchor`.
priceNote suffix `· low-grade floor`.

Tests: 45 new in `tests/low-grade-floor.test.js`. 577 → 622.

**Architectural learning — Vercel function cap (Ship #15 hotfix):**
- Every `.js` in `api/` becomes its own serverless function endpoint.
- Hobby plan limit: 12.
- Pure UI helpers belong in `src/lib/`.
- Pure server helpers live INLINE in their consumer (computeSanityFallback,
  computeThinPoolAnchor, computeLowGradeFloor inside `api/enrich.js`)
  OR in `src/lib/` and imported via `../src/lib/X.js`.

---

## Session 2026-04-23 — Ships #13 + #13.1 (comp-pool hygiene + thin-pool anchor)

2 production deploys, 391 unit tests passing (up from 288).

**Ship #13 — comp-pool hygiene (`886d6ea`, 6 bugs):**

- **Bug 1 — multi-issue compound listings:** "Absolute Batman #4 + #1
  variant" passed `hasIssueNumber` because lot regex required
  `lot|bundle` keywords or `#N-M` ranges (+ and & not handled). Added
  `hasMultipleDistinctIssues` helper — counts distinct `#N` patterns,
  rejects ≥2.
- **Bug 2 — sequel/volume asymmetry:** "Last Ronin II Re-Evolution #4"
  passed for "Last Ronin #4" search at 67% token overlap. New
  `detectSeriesMarkers(title)` returns normalized markers: `roman-ii`
  through `roman-x`, `vol-N`, `re-word`/`pre-word` (capitalized only,
  so "re-read"/"pre-order" don't match), `part-N`, `book-N`.
- **Bug 3 — signed/autographed pollution:** SLAB_RE required trailing
  numeric grade. "US of Cap #1 2X signed Ed McGuinness" passed. New
  `SIGNED_RE = /\b(?:signed|signature\s+series|autographed?|yellow\s*label|green\s*label|remarked?)\b/i`.
  Bare `SS` omitted (false-positive risk: SS-Squadron, Steel & Soul).
  Filter 2b runs after slab filter, gated on `isOurBookSigned`.
- **Bug 4 — homogeneous variant pools (BAKED-IN-PREMIUM):** When
  variant + entire comp pool variant-priced, variant multiplier
  double-counted premium. Composition check: `variantRatio = variantHits
  / rawComps.prices.length`. Ladder: >0.80 → ×0.5 damping, >0.50 →
  ×0.75 damping, ≤0.50 → full mult.
- **Bug 5 — #11 word-boundary:** Already firewalled. Pinned with 4
  regression tests.
- **Bug 6 — thin-pool overpricing:** When `rawComps.count < 3`, engine
  recommended above lone comp. Added safety cap at `rawComps.highest ×
  1.05` after mults, before mega-key floor.

5 observability flags through 5 App.jsx merge paths: `thinPoolAnchored`,
`variantComposition`, `sequelRejected`, `signedRejected`,
`multiIssueRejected`.

77 new assertions in `tests/comp-filter-hygiene.test.js`. 288 → 369.

**Ship #13.1 — thin-pool anchor scope correction (`69ab9cf`):**
Bug 6 originally gated on `isFromPC`, which flipped false when sanity
fired (PC outlier → browse_api fallback). The exact case the anchor was
designed for bypassed it.

Extracted `computeThinPoolAnchor(currentPrice, rawComps, { isMegaKey,
compsExhausted })` pure helper. No `isFromPC` gate. Kept `isMegaKey` and
`compsExhausted` skips.

Validated: Biker Mice from Mars #1 (2024) NM 9.4 — $8.23 → $7.52
(anchor cap at $7.16 × 1.05 = $7.518).

22 new assertions. 369 → 391.

---

## Session 2026-04-22 — Tier 0 + Phase 5a + Tier 1 (12 deploys)

Tier 0 liability firewall + PriceCharting CGC pop + Marvel test-market
variant allowlist (35¢ + 30¢) + A3 era-aware multipliers + FR-D7
multi-key comp extraction. **12 production deploys, 288 tests.**

**Mega-keys floor system (`api/mega-keys.js`, 29 entries):**
- 10 Golden Age (Action #1, Superman #1, Detective #27/#38, Batman #1,
  Marvel Comics #1, Cap America #1, All Star #8, Sensation #1, Flash
  Comics #1).
- 15 Silver Age (Showcase #4, B&B #28, AF #15, FF #1/#5/#48, ToS #39,
  JiM #83, Hulk #1, X-Men #1, Strange Tales #110, ToA #35, Avengers
  #1/#4, Daredevil #1).
- 2 Bronze (Hulk #181, Giant-Size X-Men #1).
- 2 Modern (TMNT #1 Mirage, ASM #300).
- Two types: `MEGA` (has `grades` bucket map) and `MANUAL` (Action #1,
  Superman #1; null grades, dispersion too wide).
- `verified` flag drives green VERIFIED vs yellow ESTIMATED badge.

**Three-tier badge system:**
- 🔑 VERIFIED / ESTIMATED FLOOR (green/yellow) — `megaKeyFloorApplied`.
- 🔑 MANUAL REVIEW (red) — `manualReviewRequired`. Hero replaced with
  "Manual Appraisal Required". Engine estimate hidden behind toggle.
  Listing button hard-blocked.
- 🔑 GRADE EXCEEDS MAP (amber) — `gradeExceedsMap`. Distinct from
  MANUAL. Same display + listing gate.

**Verify-fallback leak fix:** when AI verify rejected 100% of comps,
`aiVerifyFallback = true` set sanity to median of rejected listings —
$147,250 wrong-book Superman comps overwrote $59K Action #1 PC × mult.
Fix: tightened to `< 1.0` rejection ratio. New `compsExhausted` flag.
Sanity block + floor block both wrapped in `if (!isMegaKeyBook &&
!compsExhausted)`.

**Phase 5a — PriceCharting CGC pop:**
- New `api/pricecharting-pop.js` — fetches PC product page, regex-extracts
  `VGPC.pop_data = {"cgc":[...]}` from embedded JS.
- `POP_GRADE_INDEX = [1, 2, 3, 4, 5, 6, 7, 8, 9.0, 9.2, 9.4, 9.6, 9.8, 10]`
  locked from PC's `render_pop_chart()` source.
- 4th-parallel in Promise.all alongside comps/sold/GoCollect.
- CollectionDetail "PC-TRACKED CGC POP" panel — 14-bar histogram with
  user grade highlighted.
- 24h cache. Fails closed. Display only — no pricing math changes.

**35¢ + 30¢ Marvel test-market allowlist:**
- Vision labels any 35¢ price-box book as `"35 cent variant"`. Engine
  applied ×6 to ANY such book — even Howard the Duck #28 (1978, after
  test-market window closed Oct 1977).
- `TEST_MARKET_VARIANTS['35¢']` — 52 series / 184 issues from
  RecalledComics list (June-Oct 1977).
- `TEST_MARKET_VARIANTS['30¢']` — 57 series / 182 issues (Apr-Aug 1976).
- Combined: 109 series / 366 issues true Marvel test-market variants.
- `TEST_MARKET_KEYS = { '35 cent': '35¢', '35¢': '35¢', '30 cent': '30¢',
  '30¢': '30¢' }` — extends to Whitman / Mark Jewelers / Type 1A-1B by
  adding bucket entries.
- Retroactive Kull correction: `'kull the conqueror'` → `'kull the
  destroyer'` (1977 cover title).

**A3 — era-aware grade multipliers (Ship #11, `c35f705`):**
- `CGC_MULTIPLIERS` and `RAW_MULTIPLIERS` split into `{ vintage, modern }`.
- Vintage tables preserved exactly. Modern CGC damped: 10: 12.0→3.0,
  9.8: 5.0→2.2, 9.4: 2.2→1.35, VF+ 8.5: 1.3→1.05.
- Modern RAW: graduated upper curve damp + flat tail below VG/G.
- `getEra(year)` — `parseInt(year) >= 1985 ? 'modern' : 'vintage'`.
- 109 test assertions added.

**FR-D7 — multi-key extraction (Ship #12a, `bdb0f1e`):**
- 8 `COMP_KEY_PATTERNS`: first-appearance, origin, death, intro,
  first-told, cameo, second-appearance, first-cover.
- `extractKeyFromComps(titles)` returns `{ consensus: hits>=2,
  singletons: hits===1 }`.
- `cleanCompPhrase` strips trailing CGC/CBCS suffixes, year, grade.
- `titleCaseKeyPhrase` — preserves "Mr.", "Ma & Pa".
- "DETECTED IN COMPS" UI panel under ⭐ keyIssue.
- ZERO pricing math impact. Ship #12b (promotion to keyIssue) gated
  behind future explicit greenlight.

12 deploy hashes:
1. `34f1cc9` — Tier 0 (mega-keys floor + reprint regex + era filter)
2. `cf6bf6c` — Tier 0 hotfix (5 merge paths)
3. `99ee51e` — Phase 5a.1 (pop extractor backend)
4. `5c9864a` — Tier 0 polish (exceedsMap split)
5. `5960239` — Tier 0 polish (suppress asking/last-sold)
6. `01d81b6` — Tier 0 hotfix Ship #1 (verify-fallback sanity leak)
7. `ff6c852` — Phase 5a.3 (POP_GRADE_INDEX locked + UI panel)
8. `d3ccf26` — Tier 0 hotfix Ship #8 (floor block bypass)
9. `8393a91` — Ship #9 (35¢ allowlist)
10. `00f0afe` — Ship #10 (30¢ allowlist + Kull fix)
11. `c35f705` — Ship #11 (era-aware multipliers)
12. `bdb0f1e` — Ship #12a (FR-D7 multi-key extraction)

---

## Session 2026-04-19 — phone audit (5 critical fixes)

30+ scan phone audit surfaced 4 identification errors + navigation
instability + confidence-scoring logic bugs.

(1) **Navigation gesture guards** (`src/App.jsx` CollectionDetail):
swipe nav requires touch duration ≤500ms AND `|dx| >= 50` AND `|dx| >
|dy|` (horizontal dominant). Vertical scrolls and long-press-drags no
longer trigger card navigation.

(2) **Empty/low comp scoring** (`api/comps.js computeMatchConfidence`):
0 comps → score 0, tier LOW, "No eBay comps found — AI estimate only".
1 comp → max 60, LOW, "Only 1 comp found". 2 comps → max 75, MEDIUM
(if ≥65 else LOW). 3+ comps → full scoring.
Repro fixed: Dinosaurs #1 was returning matchConfidence 100 ✓ Verified
with 0 comps.

(3) **Publisher parens cleanup** (`cleanPublisher`): strips `()` `[]`
`{}` `"` `'` `/` `\` `&` `?` → space. Applied at handler entry.
Repro fixed: "Hollywood Comics (Walt Disney)" was returning 0 comps
because parens broke eBay query parser.

(4) **Variant filter order — hard first, soft last:** creator-match
filter MOVED from position 1b-creator (ran before many hard filters) to
3b (after all hard rejects). Re-applies VARIANT_CONTAM_RE inside creator
match. Repro fixed: Usagi Yojimbo #1 Cover A was selecting "RI-C
Variant Eastman" via creator match.

(5) **Vision + match tier sync:** matchConfidence can't detect
misidentification. Now reads `req.body.confidence` (Vision high/medium/low)
and caps matchConfidence:
- Vision LOW + Match HIGH → tier MEDIUM, score min(score, 75),
  `visionCapped: true`.
- Vision LOW + Match MEDIUM → keeps MEDIUM, gets visionCapped flag.
- Vision MEDIUM + Match HIGH → `visionModerate: true` flag only.

**Same session — ARTIST_PATTERNS expansion (`e139caa`, 15 → 36):**
Multi-word patterns first (so first-match-wins captures longest):
tyler kirkham, jim lee, inhyuk lee, skottie young, frank cho, frank
miller, windsor.?smith, dell'?otto. New single-word: jimenez,
mcfarlane, campbell, artgerm, nakayama, hughes, byrne, perez, kirby,
ditko, mele, albuquerque, hama.

Active Listings full title visibility — removed truncation, font 11→13,
color #666→#999.

---

## Session 2026-04-18 — multiple subsessions

**Creator field + slabs (`6074f24`, `2c17f2b`):**
- `JSON_SHAPE` adds `creator: string or null`. Vision extracts main
  cover artist from cover credits/signature on modern books only, never
  guesses from style.
- Filter 1b-creator: when `!variant && creator`, prefer comps with
  creator name. D'Orc #1 Brett Bean narrowed 5 mixed-artist → 5 all-Brett.
- SLAB_RE catches `CGC SS` / `CBCS SS` (middle group adds
  `ss|signature\s+series`). 3 CGC SS 9.8 slabs were leaking into D'Orc
  raw comps.
- VARIANT_CONTAM_RE policy reversed: now INCLUDES bare `\bvariant\b`,
  `\bprice\s+variant\b`, `\btype\s+1`, `\bexcl\.?\b`. REMOVED
  `\bcanadian\b` (Canadian price-variants now PASS through).

**Performance + filters (`06c3ebb`, `b6df77e`, `b6e06be`):**
- Finding API bypass: `USE_FINDING = process.env.EBAY_USE_FINDING ===
  'true'` defaults FALSE. eBay Finding API was returning 500 100% of
  the time. Wall-clock enrich 5.02s → 1.87s avg (-62.5%).
- Tokenizer overhaul: `MIN_TOKEN_LEN = 2` (was 4). New STOP_WORDS set.
  Pure-digit tokens dropped. `hasSufficientTitleOverlap` requires ≥50%
  overlap of OUR tokens vs LISTING tokens. Stop-words STAY in eBay
  query — only similarity-match ignores them. Fixes Tip Top Comics #219:
  $8.05 → $31.88.
- Lot range refinement: `isValidIssueRange()` skips year-like (1800-2050),
  decimal grades, descending pairs. Only flags ascending whole-number
  ranges. Fixes Konga #2 ("1961 - 10 Cents") and Marvel Super-Heroes #1
  ("1 - 1966").

**TPB pipeline (`73c8810`):**
- `TPB_MARKER_RE`: tpb|trade paperback|hardcover|hc|omnibus|compendium|
  deluxe|absolute|treasury|collected edition|graphic novel|gn.
- ARROW 1: TPB-aware attempt with NO `#issue` token. Strips eBay's
  floppy-bias.
- ARROW 2 (Filter 1g): comps require TPB marker when `isTPB`. Graceful
  fallback.
- Filter 0a relaxation: `isTPB` accepts EITHER `#issueNum` OR TPB marker.
- Repro: Batman vs Predator Collected Edition $10.31 → $26.99.

**Lot/set filter (`3420902`):** Filter 1e between cover-letter and slab.
LOT_RE: `\b(lot|bundle|complete set|full run|comic library|comic
collection)\b | #?\d+\s*[-–—]\s*#?\d+ | \b\d+\s*(book|issue|comic)s?
\s*(lot|set)\b | \bset of \d+\b`. Qualifier REQUIRED on book/issue/comic
alternation (else "1 Issue Comic Book" matches every single-issue).

**Year override guard (`523ce2b`):** `confirmedYear` derivation rebuilt
trust-but-verify:
- (a) era-specific keyIssue regex (silver age|bronze age|king-size|
  giant-size|annual|spectacular|first issue) → trust user year.
- (b) PC and CV agree within ±2y → average.
- (c) PC within ±2y of user → PC wins.
- (d) CV within ±2y of user → CV wins.
- (e) PC/CV both >2y from user → keep user, set
  `out.yearOverrideRejected = true`.

Repro: Marvel Super-Heroes #1 1966 with `keyIssue: "King-Size Special
#1"` — CV matched vol 2 1980, comps query went `… #1 1980 Marvel`,
final $11.49. After fix: era-specific branch fires, year stays 1966,
final $25.30.

**Dell Four Color alias (`b25e9c4`):** when `publisher` contains "Dell"
AND `issue > 100`, append three alias attempts: `Four Color #N <title>
<year>`, `Four Color #N <title>`, `Dell Four Color N`. Seeds `four`/`color`
into searchTokens.

**Artist-specific variant priority (`42947dd`):** ARTIST_PATTERNS
matched against `variant`. On match, `attempts.unshift` an
artist-specific query. `artistFallback: true` + `compBasis:
'generic-variant-fallback'` if winning query lacks artist name.

---

## Session 2026-04-17 — comps hardening + sanity + pool expansion

(1) Median on mixed-print fallback (`ff5758a`).
(2) AI verify fallback (`80f35fb`): when verifyCompsTitles rejects all
but rawComps still has entries, set `aiVerifyFallback = true`.
(3) Apostrophe handling (`eac6188`): `cleanTitleForSearch` replaces
`/['"!?]/g` with SPACE. "D'Orc" → "D Orc".
(4) Sanity raw compsAvg on fallback (`eac6188`).
(5) Attempt loop continues on empty post-filter (`eac6188`).
(6) `confirmedYear` surfaced + client heal (`eac6188`).
(7) Tighter sanity thresholds (`084a8ca`): `lowCompsCount<3` → 1.25x.
Modern: Golden <1970 → 3x, Silver/Bronze <1985 → 1.75x, Modern ≥1985 →
1.5x.
(8) Comp pool expansion (`5bcfe91`): `tryBrowse` `limit=100` (was 20),
`sort=bestMatch` (was endingSoonest), `buyingOptions: FIXED_PRICE|AUCTION`.
(9) SLAB_RE tightened (`5bcfe91`): requires explicit slab indicator.
(10) Variant regex loosened temporarily (`5bcfe91`): dropped bare
`\bvariant\b` (later restored in `2c17f2b`).
(11) Sanity double-grade fix (`cbcc590`): `sanityCompsAvg` always raw.
Both sides already at-grade.
(12) PSA + cover variant filter (`ae78d5d`): SLAB_RE expanded to
psa|egs|hga|signature series|verified|qualified. Filter 1d cover-letter
matching.

End-to-end on D'Orc #1 (Image 2026 NM 9.4 Cover A, stored year 2025):
2 comps → 5 → 2 Cover-A-only, $275.49 → $91.23, `yearCorrected: true`.

**Earlier same day — comps + prompts + import + bulk HOT:**
- `parseListingGrade` recognizes raw letter grades (NM/MT through PR).
- Filter 5 row-level dedup on `price|title[0:35].lower()`.
- Newsstand in VARIANT_CONTAM_RE.
- Year accuracy prompt — explicit 2025/2026 examples.
- Publisher-as-title WARN not BLOCK.
- Auto-refresh recency guard (5min).
- Bulk enrich progress indicator.
- Post All HOT bulk listing button.
- AI verify year tolerance (±1-2y).
- Confirmed-year comps query — phase 1 (parallel) ID, derive year,
  phase 2 (parallel) comps using confirmedYear.
- Reprint/variant filter fallback — keep pre-filter set when filter
  removes all, raise `reprintFallback`/`variantFallback` flags.
- CGC submission profit scenarios — per-grade `fmv → net` with
  pass/fail. Grading $35 + press $20 = $55 cost.
- Rare variant multipliers + prompt guidance — variantMultipliers table
  expanded 8 → 22 keys, descending order, Mark Jewelers/Whitman/Type
  1A-1B/printing error/double-triple cover all gain explicit handling.

---

## Session 2026-04-16 — pricing chain hardening + bulk import fixes

(1) Opus 4.7 upgrade for standard scan + Watch Mode pass 3.
(2) Import/backup: file picker resets value, "Backup to Drive" button,
stale-backup banner.
(3) Bulk import hardening: non-comic rejection, duplicate detection,
publisher-as-title guard, 4 missing enrich fields added.
(4) Publisher in eBay search (`comps.js`): attempt 0 = `title #issue
variant year publisher`. Atlas/Timely → "Atlas Marvel".
(5) Auto-refresh guard: only fires `tab === 'collection' &&
selectedItem === null && 60s since last refresh`.
(6) Sold comps validation: `filteredSold` filtered by `#issue\b` regex
before blending into 60% sold weight.

---

## Session 2026-04-15 — pricing calibration + UX + chat

**Optimistic UI (`bd4f319`):** `updateComicField` calls `setCatalogue`
+ `setSelectedItem` first, fires `putComic(updated)` background. Fixes
perceived lag on field updates (root cause: `putComic` rewriting full
record including base64 images blob 100-500KB).

**Editable list price (`fec065a`):** numeric `listPrice` input above
List on eBay button. `handleList` passes `{ ...item, price: "$X.XX" }`
so override drives eBay StartPrice + persists.

**Bundle listing shipped (`8d70e12`):** 18% off sum, era-derived title
(Golden <1956, Silver ≤1970, Bronze ≤1984, Copper ≤1991, Modern 1992+),
per-item HTML description, up to 12 cover photos. Single eBay listing,
all items marked `status: "listed"` with shared
`ebayItemId`/`bundleId`. Claude BUNDLE action pre-selects.

**`api/chat.js` hardening (`d218b95` + `951a13c`):** top-20 by
displayPrice sent to Claude, 8s `Promise.race` timeout returns friendly
fallback, accepts both flat-array and `{ books: [...] }` shapes.

**Pricing calibration (`9b9de52` + `47705c7`):**
- Blended comps: `enrich.js` computes `blendedAvg` from sold (60%) +
  active (40%). Sold-only ×1.1 bump.
- Tiered key multiplier: major (1st app, origin, death, first issue)
  ×1.5 / minor (2nd, second app, first cover, cameo, iconic, classic)
  ×1.2.
- Key mult requires comps: gated by `blendedAvg`. House of Secrets #92
  FN- 5.5 now $644 instead of $966.
- Variant contamination filter: drops variant/virgin/foil/ratio/
  incentive when not searching for variant. Thor #338 $52.75 → $35.90.

**Watch Mode (`fb40e45`, `4182221`, `a38069f`, `6784aed`):**
- Sonnet routing for `body.source === 'watch'` (~5x cost reduction).
- Voice context: Web Speech API continuous mode. `voiceContext` →
  appended as "Seller said: {context}" in grade prompt. Auto-bid: `$N`
  regex from transcript.
- Text hint input shares `watchContext` state.
- Android browser fallback: SpeechRecognition constructor check +
  try/catch + onerror.
- Self-correcting pipeline: Pass 1 Sonnet fast ID (watch-optimized:
  "read directly from cover"). Pass 2 Sonnet self-correction. Pass 3
  Opus escalation. Headers `x-watch-passes` + `x-watch-timing`.

**UX polish (`839f5e9`, `0b20db7`, `9d096a3`, `927d54e`, `1cdf988`):**
- Back button returns to correct tab via `prevTabRef`.
- Swipe navigation (50px threshold), first-use hint persisted in
  `cv_swipe_hint_seen`.
- Stats bar — grade pill + price + last sold + asking range.
- Photo angle prompts — labeled placeholders for missing angles.
- Variant in eBay listing title between issue and grade.

---

## Session 2026-04-14 — Manage tab audit + pricing calibration

See git log for details (older session, narrative consolidated).

---

## Pattern emergence stories

These are the named pattern classes referenced in CLAUDE.md Pattern
Library. Listed in approximate order of discovery.

- **Sinful Suzie class** — wrong-title comp contamination (different
  series under same nominal title).
- **Thor #4 class** — printing version mismatch (1st vs 2nd print same
  cover).
- **Howard Duck Magazine class** — format collision (magazine vs comic
  same character).
- **Marvel Age #58 class** — shared issue # different title (Comics
  Interview #58 also exists).
- **Annual #2 class** — marker asymmetry (Annual #1 vs Annual #2 same
  series).
- **Loot Crate class** — convention/variant in active pool not flagged
  as variant.
- **Chip n Dale class** — text fields verified but cover image was
  different book.
- **Whitman #978 class** — non-comic format (BLB) priced as regular
  comic.
- **Action Force class** — thin pence/UK market false HIGH match.
- **Spooky #118 class** — grade mismatch in active pool.
- **D'Orc #1 class** — apostrophe title eBay tokenization.
- **Star Wars #1 class** — reprint vs first-print (Vision sees, engine
  ignores) — Ship #19 territory.
- **Biker Mice #1 class** — thin pool sanity-flipped above lone comp —
  Ship #13.1 territory.
- **Action #1 / Superman #1 / Detective #27 class** — manual-review
  mega-keys.
- **JLA #62 class** — bottom-of-CGC-census low-grade floor — Ship #17
  territory.
- **FF #61 class** — Silver Age key low-side threshold underpricing —
  Ship #14 territory.
- **House of Secrets #106 class** — alias-only creator detection —
  Ship #16 territory.
- **TMNT #1 IDW 2016 class** — mega-key publisher+year disambiguation —
  Ship #20a.7 territory.
- **Donald Duck Whitman #978 class** — refuse-to-price gate — Ship
  #20a.6.4 territory.

---

## Process notes

**Parallel QA protocol** (validated across Sessions 2 + 3 + 4):
- Three Claude instances coordinating: pattern observer (fresh context),
  directive synthesizer (main chat), executor (codebase access).
- Plus human decision-maker.
- Methodology proven across 19+ production deploys.

**Test coverage growth:**
- Session 1 baseline: 288 tests.
- Session 2 end: 391 tests (+103, Ships #13/#13.1).
- Session 3 end: 622 tests (+231, Ships #14-#17).
- Ship #18: 688.
- Ship #19: 728.
- Ship #20a: 759.
- Ship #20a.5: 778.
- Ship #20a.7: 911.
- Ship #20a.6: 1002.

**Test suites (13):** comp-filter-hygiene, comp-key-extraction,
creator-from-comps, edition-warning, era-multipliers,
list-price-warning, low-grade-floor, mega-keys, pedigree-registry,
pricecharting-sales, sanity-thresholds, sold-verification,
variant-allowlist.

---

## Open external threads (cumulative)

- GoCollect API key #019483 — pending since 4/15 (~13 days as of 4/27).
- eBay Marketplace Insights API — DEAD for indie devs (gated scope).
- eBay Finding API — bypassed April 2026 (rate-limit errors); workaround
  via PriceCharting sales-history scrape (Ship #20a foundation).
- GPA — check gpanalysis.com for API access (not started).
