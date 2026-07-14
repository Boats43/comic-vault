# Comic Vault PWA

## Project
Comic Vault — a progressive web app for grading, pricing, and managing comic book collections.

## Stack
- **Frontend**: React + Vite (single-page app in `src/App.jsx`)
- **Backend**: Vercel serverless functions (`api/` directory)
- **Storage**: IndexedDB (client-side), no server database
- **Deploy**: Vercel (auto-deploys from `main` branch)

## Build & Deploy
```bash
npm run build           # always run before commit; zero errors required
                        # ESM-mode parse enforced (--input-type=module)
                        # catches reserved words (protected, interface, etc.)
git push origin main    # production deploy (auto, primary protocol)
git revert <hash> && git push   # single-step rollback
npx vercel --prod       # uncommitted-tree fallback only
```

**STANDING RULE — ESM Parse Enforcement (P0, evidence: 2026-07-05 outage):**
Build verification (`npm run build`) MUST use ESM-mode syntax check for all `api/*.js` and `src/lib/*.js` files:
```bash
node --input-type=module --check < FILE
```
Plain `node --check FILE` parses as CommonJS (sloppy mode) and MISSES ESM-only reserved word errors (`const protected`, `let interface`, etc.). Vercel runtime uses ESM → strict mode → reserved words throw SyntaxError at module load → all API endpoints dead. The 2026-07-05 outage (commit dc08a6d used `const protected`) proved `node --check` is insufficient.

## Key Files

### AssetCore (Universal Pricing & Decision Engine)
- `src/lib/pricingEngine.js` — 9 universal pricing helpers (floor guards, sanity checks, multipliers)
- `src/lib/identityCore.js` — 5 universal identity resolvers (overlap, resolveIdentity, resolveIssue, backfillFromComps, resolveYear)
- `src/lib/decisionEngine.js` — universal decision engine (LIST_NOW/RESEARCH/GRADE_CANDIDATE/etc.)
- `docs/ASSETCORE_INTERFACE.md` — contract between AssetCore and format adapters (18 TODOs resolved)
- `docs/ASSETCORE_BASELINE.md` — pre-extraction snapshot (Session 3A)
- `docs/ASSETCORE_STOP_CONDITIONS.md` — 9 stop conditions for extraction safety
- `docs/ASSETCORE_EXTRACTION_SEQUENCE.md` — 7-step extraction plan

### Comic Adapter (Format-Specific Logic)
- `src/adapters/ComicAdapter.js` — 312 lines, 4/4 functions (verifyStory, detectKeyValue, computeEraRisk, sanitizeComicTitle)

### API Endpoints
- `api/enrich.js` — second-pass enrichment (PriceCharting, eBay comps, ComicVine, Ximilar, CGC lookup, GoCollect, Decision Engine)
- `api/grade.js` — Claude Vision comic identification and grading
- `api/chat.js` — Claude collection chat (inline queries, Whatnot session context)
- `api/comps.js` — eBay Browse API comp fetching (Ship #20a.8: all state variables scoped outside try/catch + if/else branches)
- `api/sold.js` — eBay completed/sold listings (legacy, dormant — Ship #20a routes via PC scrape)
- `api/cgc-lookup.js` — CGC cert number verification
- `api/gocollect.js` — GoCollect CGC FMV lookup (DORMANT — Q25 removed the call from enrich; file kept on disk, counts toward function cap)
- `api/manage.js` — collection analysis via Claude
- `api/list-ebay.js` — eBay listing creation
- `api/delist-ebay.js` — eBay listing removal
- `api/mega-keys.js` — mega-key floor map (43 entries: 41 MEGA / 2 MANUAL, publisher+year strict, schema 2.0.0)
- `api/pricecharting-pop.js` — PC pop + sales-history + price ladder + velocity scrape

### Shared Libraries
- `src/lib/compHygiene.js` — shared regex + helpers (REPRINT_RE, SLAB_RE, VARIANT_CONTAM_RE, SIGNED_RE, ARTIST_PATTERNS, etc.)
- `src/lib/soldVerification.js` — `verifySoldComps(rawRows, ctx)` filter chain
- `src/lib/listPriceWarning.js` — UI helper (over-reach detection)
- `src/lib/premiumCreators.js` — 80-creator tiered registry
- `src/lib/pedigreeRegistry.js` — 22-pedigree canonical lookup

### Frontend
- `src/App.jsx` — entire frontend (ResultCard, CollectionDetail, grading flow, catalogue, FloatingSearchBar, BidCalculator)

## Repo & Live
- **Repo**: Boats43/comic-vault
- **Live**: comic-vault-rouge.vercel.app

## Environment Variables
Nine keys required (all set in Vercel), plus:
`ANTHROPIC_API_KEY`, `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_DEV_ID`, `EBAY_AUTH_TOKEN`, `EBAY_SANDBOX`, `COMICVINE_API_KEY`, `XIMILAR_API_TOKEN`, `PRICECHARTING_TOKEN`
- `SOLD_INSIGHTS_DISABLED=1` (set in production, FIX-1 2026-07-11) — skips the dead eBay Marketplace Insights OAuth attempt in api/sold.js entirely.
- `GOCOLLECT_API` — **integration NOT live.** Removed from enrich Promise.all by Q25 (100% timeout, 4.5s tax, zero returns); enrich passes `Promise.resolve(null)`. Key #019483 still pending. api/gocollect.js remains on disk (counts toward the 12-function cap) but is never called.

## Rules

### Customer-Grade Standard (P0 PROTOCOL — standing)
**PRODUCTION RULE:** No card ships a price that contradicts its own evidence panel. Self-flagged mismatches (>100% drift over own pool avg, tier-4 NO DATA, refuse states) must be coherent:
- **Self-flagged drift:** Auto-RESEARCH decision (never LIST_NOW/LIST_LOW when engine flags >100% over comps)
- **Refused states:** Render $0 everywhere OR render nothing (blank/null). Zero bands + single "REFUSED" banner (Q68).
- **NO DATA tier-4:** "Estimated comps" label under Verified badge (P3).
- **Evidence consistency:** Match confidence, decision action, and displayed price must align. A LOW-confidence $300 book with 2 comps averaging $18 fails customer-grade.

**Enforcement:** Pre-ship validation checks decision.action vs match confidence tier vs price deviation. Cards violating coherence are blocked from LIST actions until fixed.

### Log Statement Discipline (P0 PROTOCOL — standing)
**Log statements are code.** Every `console.log()` referencing a variable must reference a DECLARED identifier. Trace/log additions get the same review as logic changes.

**Evidence:**
- **f707f5b outage** (2026-07-05): `const protected` (reserved word) → SyntaxError at module load → all API endpoints dead. ESM parse enforcement added.
- **Q62 regression** (3c0e6f9): `console.log(\`"${raw}"\`)` where `raw` undefined → ReferenceError → tokenization crash → 100% comp pool loss → tier-4 NO DATA.

**Rule:** Before committing any log statement:
1. Verify EVERY referenced variable is declared in scope
2. Test log statements trigger (add temporary throw after log to force execution)
3. ESM-parse verification catches reserved words, NOT undefined references

**Pattern:** Capture values BEFORE operations that might transform them:
```javascript
const beforeStrip = normalized;
normalized = stripMetadataTokens(normalized);
console.log(`[22f] metadata-stripped: "${beforeStrip}" → "${normalized}"`);
```

NOT:
```javascript
normalized = stripMetadataTokens(normalized);
console.log(`[22f] metadata-stripped: "${raw}" → "${normalized}"`); // WRONG: raw undefined
```

### Architecture (top priority)
- **Vercel function cap is 12** (Hobby plan). Every `.js` file in `api/` becomes its own serverless function endpoint, regardless of whether it has a default-exported HTTP handler. Current count: 12/12 — adding a new file in `api/` will fail deploy.
  - Pure UI helpers belong in `src/lib/` (no HTTP handler). `App.jsx` imports relatively.
  - Pure server helpers used by `api/enrich.js` go INLINE in that file (`computeSanityFallback`, `computeThinPoolAnchor`, `computeLowGradeFloor`) OR in `src/lib/` and imported via `../src/lib/X.js` — Vercel bundles transitively.
  - Filename convention: kebab → camel for helpers (`listPriceWarning.js`, matches `src/db.js`).
- **Pricing-math greenlight protocol:** never modify pricing math (grade multipliers, sanity checks, floor guards, key/variant multipliers, comp-pool composition logic in `api/enrich.js` or `api/comps.js`) without explicit user instruction. Layer A trust hardening (display gates, ID checks, advisories) does NOT require greenlight; Layer B accuracy changes do. When uncertain whether a change crosses into pricing math, ask first.
- **Auto-deploy on push to main.** Production deploys trigger automatically. Verify locally before push: `npm run build` clean, tests passing.
- **Investigation-first protocol:** when a bug is reported or surfaced, investigate root cause before implementing. Don't bypass safety checks (`--no-verify`, etc.) as a shortcut.
- **Diff-before-commit on all changes.** Show the user the diff for review before committing high-impact admin changes.
- **Variable scope discipline:** variables used in shared code paths (catch blocks, final return statements, post-conditional code) must be declared BEFORE any try/catch or if/else branches that might skip their initialization. Ship #20a.8 pattern: `query`, `artistName`, state vars moved outside try block and before assetType conditionals.
- **Phone validation immediately after deploy.** Tests verify code correctness, not feature correctness. Production behavior must be observed on real scans before next ship.
- **Gate vocabulary (P0 PROTOCOL — standing):** ✅ = production scan PASSED the gate condition. Pre-scan gates are TARGETS, never marked ✅. Marking unscanned gates ✅ is a protocol violation. Ship summary must HOLD for phone validation sweep; on ALL-PASS, execute next queued block without prompt.
- **Timestamp comparisons (P0 PROTOCOL — standing):** MUST include dates when comparing scan time vs deploy time. Format: "YYYY-MM-DD HH:MM:SS" or "MM-DD HH:MM". Never compare raw times without date context. Q67-B misdiagnosis: "17:50 before 18:39" failed to note 17:50 was 07-06, 18:39 was 07-05 → wrong conclusion (scan was AFTER deploy, not before).
- **Conservative direction preferred when uncertain.** Bias toward under-pricing rather than over-pricing on weak signals; under-confident rather than over-confident on identification.
- **Refactor identifier audit (P0 RULE — standing):** Any `App.jsx` refactor that deletes lines must grep remaining scope for references to deleted identifiers BEFORE commit. Pattern: `git diff --cached | grep '^-' | grep 'const ' | cut -d' ' -f2` → grep each identifier in remaining file → verify zero dangling references. Prevents ReferenceError runtime breaks (dc2e164 deleted `const b64` but kept 2 references → 100% bulk import fail).

### Pricing stack (do not reorder without greenlight)
- Stack: PriceCharting → grade multiplier → sanity check → defect penalty → floor guard → browse_api fallback.
- PriceCharting year threshold: 5 years max gap between comic year and product year.
- PriceCharting skipped when `issue=null`.
- Visual search only overrides with 3+ matches.
- Non-comic titles ("not a comic", "unknown") rejected at enrich entry.
- AI verify: accept variant/cover B listings if same character + issue number. Year tolerance ±1-2y (cover-date vs publication-date drift).

### Era cutoffs
- `getEra(year)`: `parseInt(year) >= 1985 ? 'modern' : 'vintage'`. Null/undefined/0/empty-string → vintage (safe default).
- Sanity thresholds use a SECOND boundary: comic-community Silver Age start = 1956 (Showcase #4). Boundary asymmetry is documented in `computeSanityFallback` docstring.
- Bundle ERA bands (display only): Golden <1956, Silver ≤1970, Bronze ≤1984, Copper ≤1991, Modern 1992+.

### Grade multipliers (era-aware)
- `CGC_MULTIPLIERS` and `RAW_MULTIPLIERS` split into `{ vintage, modern }`. Vintage tables preserved exactly (calibrated). Modern damped: CGC 9.4 2.2→1.35, 9.8 5.0→2.2, VF+ 8.5 1.3→1.05, 10 12.0→3.0.
- Modern RAW: graduated upper-curve damp (NM 1.00→0.90 through VG 0.45→0.40), flat tail below VG/G (sub-GD trades on condition, not era).
- Multiplier table is calibrated. Never modify without explicit instruction.
- `getGradeMultiplier(grade, year)` and `getRawGradeMultiplier(gradeStr, year)` — use `confirmedYear || year`.

### Sanity check (`computeSanityFallback`)
- **Sanity comparison base:** `sanityCompsAvg = compsAvg` — ALWAYS raw. eBay listings already reflect market grade; multiplying by gradeMultiplier double-counts.
- **High thresholds:** `lowCompsCount<3 || isMixedFallback` → 1.25x; Golden <1970 → 3x; Silver/Bronze <1985 → 1.75x; Modern ≥1985 → 1.5x.
- **Low threshold:** Silver+Bronze (1956–1984) → 0.6×; all other eras → 0.5×. Asymmetry documented in helper.
- **Gate:** `compsAvg > 1` (was `> 5`, dropped Ship #14 to catch sub-$5 modern comps).
- **Input preference:** `fallbackMedian || blendedAvg || compsFromEbay?.average`. On any fallback flag (reprint/variant/aiVerify), uses median of `rawComps.prices` instead of mean.
- **Skip when:** mega-key book OR `compsExhausted` (AI verify rejected 100%).
- `aiVerifyFallback` fires when AI verify rejects every checked listing but raw comps existed. Tightened: requires `(verifyCount - verifiedCount) / verifyCount < 1.0`. New `compsExhausted` flag for the 100% case.

### Floor guard
- Field: `rawComps.lowest` (not `lowestNum`).
- Raw `rawFloor` (no grade multiplier — eBay comps already reflect market grade). Capped at `compsAvg`.
- Skip when: mega-key book OR `compsExhausted`.

### Browse_api path
- **No grade multiplier.** eBay listings already reflect market grade. `gradeMultiplier` still recorded on `out` for floor guard but not applied to browse_api prices.
- Variant mult and key mult: PC source ONLY — gated by `isFromPC` flag.
- `isFromPC = !!priceCharting?.price && !sanityFired && out.pricingSource === 'pricecharting'` — snapshotted after PC/sanity branch, before floor/variant/key blocks.

### Variant multipliers (descending, first substring match wins)
triple cover ×10, double cover ×8, 35¢/35 cent ×6, 30¢/30 cent ×4, inverted ×4, gold ×3, printing error ×3, miscut ×3, mark jewelers ×2.5, canadian price ×2, price variant ×2, type 1a/1b ×2, canadian ×1.8, whitman ×1.8, 2nd/second print ×1.5, pence ×1.5, dc universe logo ×1.5, newsstand ×1.3.
- Test-market variants gated by allowlist: `TEST_MARKET_KEYS` map (`'35 cent'` → `'35¢'`, etc.) + `TEST_MARKET_VARIANTS` bucket per key. 35¢ window June-Oct 1977 (52 series / 184 issues). 30¢ window Apr-Aug 1976 (57 series / 182 issues). Pattern extends to Whitman / Mark Jewelers / Type 1A-1B by adding bucket.
- Composition damping (Bug 4): `variantRatio = variantHits / rawComps.prices.length`. Ladder: >0.80 → ×0.5 damping, >0.50 → ×0.75 damping, ≤0.50 → full mult.
- **NO_PREMIUM list:** corner box, masterpieces, design variant, headshot, trading card, cover a/b/c/d, marvel legacy, legacy.

### Key multipliers (PC source only, requires comps)
- Tiered: major (1st appearance, first appearance, origin, death, first issue) ×1.5; minor (2nd, second app, first cover, cameo, iconic, classic) ×1.2; other ×1.0.
- Gated by `isFromPC && blendedAvg` — without comps to validate, no multiplier applied.

### Comp filter chain order (`api/comps.js`, hard first / soft last)
title-similarity (Filter 0c) → reprint (1) → VARIANT_CONTAM_RE (1b, hard) → variant preference (1c) → cover-letter (1d) → lot (1e) → half-issue (1f) → TPB format (1g) → slab (2) → signed (2b) → grade proximity (3) → **creator match (3b, SOFT)** → price sanity (4) → dedup (5).
Filters run INSIDE the attempt loop; loop only breaks on `parsed.length > 0` (post-filter survivors), not `raw.length > 0`. Too-specific attempts that match only junk fall through to broader queries.

### Filter regex catalogs
- **SLAB_RE:** `/\b(cgc|cbcs|pgx|psa|egs|hga|slab|graded|universal|signature\s+series|verified|qualified)\s*(?:ss|signature\s+series|<tier>)?\s*\d+(\.\d+)?/i`. Middle SS group catches "CGC SS 9.8" / "CBCS SS 7.0". Bare "9.4" in raw seller's self-grade does NOT trigger.
- **SIGNED_RE:** `/\b(?:signed|signature\s+series|autographed?|yellow\s*label|green\s*label|remarked?)\b/i`. Bare `SS` omitted (false-positive risk: SS-Squadron). Blue label omitted (= Universal).
- **VARIANT_CONTAM_RE:** `\bvariant\b|\bvirgin\b|\bfoil\b|\bratio\b|\b1:\d+\b|\bincentive\b|\bnewsstand\b|\bwhitman\b|\bprice\s+variant\b|\btype\s+1|\bexclusive\b|\bsketch\b|\bexcl\.?\b`. Includes bare `\bvariant\b` (artist exclusives, store variants). Hoisted to module scope. Re-applied inside creator match.
- **REPRINT_RE:** detects reprint/facsimile/later printing. Pre-filter set kept when filter would remove all; raises `reprintFallback` flag.
- **TPB_MARKER_RE:** `/\b(tpb|trade paperback|hardcover|hc|omnibus|compendium|deluxe(\s edition)?|absolute(\s edition)?|treasury(\s edition)?|collected edition|graphic novel|gn)\b/i`.
- **LOT_RE:** `\b(lot|bundle|complete set|full run|comic library|comic collection)\b | \b\d+\s*(book|issue|comic)s?\s*(lot|set)\b | \bset of \d+\b`. Qualifier REQUIRED on book/issue/comic alternation. Issue-range detection separated to `isValidIssueRange()` — skips year-like (1800-2050), decimal grades, descending pairs.
- **EDITION_WARNING_PATTERNS** (`api/grade.js`, Ship #19): 8 regex patterns scanning Vision `reason` text for reprint/facsimile/later-printing/"not the first print" signals. Sets `editionWarning.detected` for UI gate. Does NOT modify pricing.

### Cover-letter matching (Filter 1d)
Cover A, B, C, D are separate books with separate prices. When variant is empty / "Cover A" / "1st print": drop listings with Cover B/C/D+ in title. When variant is "Cover B/C/...": keep ONLY that letter (fall back to all if zero match).
- **OTHER_VARIANT_DESCRIPTOR_RE** (Q108, `src/lib/compHygiene.js`): OTHER_COVER_RE only
  catches lettered covers (Cover B/C/D). Named non-letter variants (card stock, foil/
  sketch/virgin cover, trade dress) slip through it — Wonder Woman #75 / Flash #75
  class, Frison/Manapul card-stock listings priced against a Cover A scan. Applied
  alongside OTHER_COVER_RE in the same `isCoverAorStandard` branch. **STOPGAP, not
  permanent** — it's a static name/phrase list (currently: card stock, cardstock,
  frison, foil cover, sketch cover, virgin cover, trade dress, blank cover). Artist
  names can't live in a regex forever; extend this list as new named-variant patterns
  emerge in production. Long-term fix is a variant-type classifier, not a name list.

### TPB pipeline
1. ARROW 1: when title matches TPB_MARKER_RE, `attempts.unshift` `tpb-aware` query with NO `#issue` (strips eBay floppy-bias).
2. ARROW 2 (Filter 1g): require comp titles contain TPB marker when `isTPB`. Graceful fallback if zero matches.
3. Filter 0a relaxation: `isTPB` accepts EITHER `#issueNum` OR TPB marker.

### Multi-issue detection
`hasMultipleDistinctIssues` — counts distinct `#N` patterns, rejects ≥2. Catches "Absolute Batman #4 + #1 variant" compounds. Called from inside `hasIssueNumber` AND separately in Filter 0a.

### Sequel/volume asymmetry
`detectSeriesMarkers(title)` returns markers: `roman-ii` through `roman-x`, `vol-N`, `re-word`/`pre-word` (capitalized only), `part-N`, `book-N`, `annual-N`, `special-N`, `king-size-N`, `giant-size-N`. `?` placeholder when format word appears without number. Asymmetry filter (between 0b and 0c) rejects when listing has marker our title lacks.

### Title-similarity tokenizer
- `MIN_TOKEN_LEN = 2`. STOP_WORDS: the, a, an, of, and, or, in, on, at, to, for, with, comic, comics, comicbook, issue, volume, vol, marvel, dc, image, dark, horse, idw. Pure-digit tokens dropped.
- `hasSufficientTitleOverlap` requires ≥50% overlap of OUR tokens vs LISTING tokens. Returns true when all our tokens are stop-words ("Dark Horse Comics") so other filters take over.
- Stop-words STAY in eBay query — only similarity-match ignores them.
- `cleanTitleForSearch` replaces `/['"!?]/g` with SPACE. "D'Orc" → "D Orc".

### Search query construction
- Attempt 0: `title #issue full-variant year publisher` (most specific, capped 100 chars).
- Falls through to attempt 1 (short variant + year), attempt 2 (no year), etc.
- Atlas/pre-Marvel publishers: append "Atlas Marvel" (sellers use both terms).
- Dell + issue >100: append three Four Color alias attempts (`Four Color #N <title> <year>`, `Four Color #N <title>`, `Dell Four Color N`). Seeds `four`/`color` into searchTokens.
- ARTIST_PATTERNS match against `variant` → `attempts.unshift` `artist-specific` query: `<title> #<issue> <artist> [virgin] <year> <publisher>`. 36+ entries; multi-word patterns FIRST so first-match-wins captures longest. Recent additions: jeehyung lee, alex ross, kaare andrews, fabok.
- Variant short keywords only in attempts 1-2. Attempt 0 uses FULL variant string.

### Browse API call
`limit=100`, `sort=bestMatch`, `buyingOptions:{FIXED_PRICE|AUCTION}`. Raises raw pool 5x, includes auction data.

### Finding API
Skipped by default. `USE_FINDING = process.env.EBAY_USE_FINDING === 'true'`. eBay's Finding API was returning 500 errorId 10001 100% of the time as of late April 2026. Wall-clock enrich 5.0s → 1.87s. `tryFindCompleted` left intact for future re-enable.

### Sold comps (Ship #20a + #20a.6)
- Source: PriceCharting sales-history scrape (eBay Marketplace Insights gated, eBay Finding bypassed). Same HTML as pop extractor — zero new requests, 24h cache.
- `verifySoldComps(rawRows, ctx)` filter chain: titleMismatch → issueMismatch → annualMismatch → printingMismatch → variantMismatch → slabMismatch → signed → lot → gradeMismatch → stale → outlier.
- Surfaces `out.soldComps` (verified) + `out.soldCompsRaw` + `out.soldCompDiagnostics` (`{ rawCount, verifiedCount, rejectedCount, reasons: {...}, rejectedSamples: [top 3] }`).
- `blendedAvg = soldAvg × 0.6 + activeAvg × 0.4`. Sold-only ×1.1 bump.
- Last Sold UI chip: "📊 V of R sold verified · Xd ago" when `rawCount > verifiedCount`; "📊 N sold" when no gap.

### Year override guard (`api/enrich.js`)
`confirmedYear` derivation, trust-but-verify:
- (a) era-specific keyIssue regex (silver age|bronze age|king-size|giant-size|annual|spectacular|first issue) → trust user year.
- (b) PC and CV agree within ±2y → average.
- (c) PC within ±2y of user → PC wins.
- (d) CV within ±2y of user → CV wins.
- (e) PC/CV both >2y from user → keep user, set `out.yearOverrideRejected = true`.

`out.confirmedYear` + `out.yearCorrected` surfaced. App.jsx enrich callbacks heal `item.year` when `yearCorrected === true`.

### Mega-keys (`api/mega-keys.js`, 43 entries)
- 10 Golden / 15 Silver / 2 Bronze / 2 Modern.
- Two types: MEGA (has `grades` bucket map) and MANUAL (Action #1, Superman #1; null grades, manual review only).
- Strict canonical match: `getMegaKeyEntry(title, issue, publisher, year)`. Pre-1962 entries `yearTolerance: 2`; post-1962 `yearTolerance: 1`. `normalizePublisher` collapses Timely/Atlas → marvel.
- Three-tier badge: VERIFIED (green) / ESTIMATED (yellow) / MANUAL REVIEW (red, `pill-manual-review`) / GRADE EXCEEDS MAP (amber).
- Listing button hard-blocked on MANUAL + GRADE EXCEEDS MAP.

### CGC penalty-aware Vision (Ship #18, STANDARD_PROMPT only)
Detects: store stamps, staple popping, polybag indents, corner chips, pedigree stamps. `out.cgcPenaltyFlags` nested object plumbed through 8 merge paths × 1 line. `pedigreeRegistry.js` 22 canonical pedigrees + aliases, strict match (no fuzzy). `lookupPedigree` and `enrichPedigree` helpers.

### Watch Mode pipeline
- Pass 1 — Sonnet fast ID (watch-optimized prompt: "read directly from cover, do not infer"). Confidence=high + title not unknown → return (1 pass).
- Pass 2 — Sonnet self-correction (sends pass 1 result as context). Not low → return (2 passes).
- Pass 3 — Opus escalation (full STANDARD_PROMPT). Same Vision flags as standard scan apply (CGC penalty + pedigree).
- Headers: `x-watch-passes` (1/2/3), `x-watch-timing` (JSON ms per pass).
- Standard scan: single Opus call.
- Cost optimization: `body.source === 'watch'` routes to Sonnet. Standard requests stay on Opus 4.7.

### Voice + text context (Watch Mode)
Web Speech API continuous mode + text input share `watchContext` state — last one wins. `voiceContext` POST → grade.js appends `"\nSeller said: {context}. Use this context to improve accuracy."` to user prompt. Auto-bid: regex extracts first `$N` from transcript. Android fallback: SpeechRecognition constructor check + try/catch on `.start()` + onerror handler all show "Type context above instead".

### Match confidence
- 0 comps → score 0, tier LOW, `displayMessage: "No eBay comps found — AI estimate only"`.
- 1 comp → max 60, LOW, "Only 1 comp found — limited data".
- 2 comps → max 75, MEDIUM (only if rawScore≥65 else LOW), "Limited comps — verify before listing".
- 3+ comps → full scoring.
- Vision confidence caps match confidence: Vision LOW + Match HIGH → tier MEDIUM, score min(score, 75), `visionCapped: true`. Vision LOW + Match MEDIUM → keeps MEDIUM + flag. Vision MEDIUM + Match HIGH → `visionModerate: true` flag only.

### List-price warning (`src/lib/listPriceWarning.js`)
Pure UI banner. Three triggers, worst pctOver surfaced:
- A: `listPrice > engineRec × 1.25` (25% over).
- B: `listPrice > comps.highest × 1.20` (20% over).
- C: `listPrice > comps.average × 1.50` (50% over).

Skip flags: `megaKeyFloorApplied`, `manualReviewRequired`, `gradeExceedsMap`. Session-only dismiss (per-book, no localStorage).

### Low-grade floor anchor (Ship #17, `computeLowGradeFloor`)
When `pop.belowGrade === 0` (user grade is bottom of CGC census) AND `pricingSource === 'browse_api'` → re-anchor `out.price` to `rawComps.lowest`. Skip flags: `isMegaKey`, `compsExhausted`. Position: AFTER thin-pool anchor, BEFORE mega-key floor.

### Thin-pool anchor (Ship #13.1, `computeThinPoolAnchor`)
When `rawComps.count < 3`, cap `out.price` at `rawComps.highest × 1.05`. No `isFromPC` gate. Skip flags: `isMegaKey`, `compsExhausted`. Surfaces `out.thinPoolAnchored`. priceNote suffix `· thin-pool anchor`.

### Multi-key extraction from comps (Ship #12a)
8 `COMP_KEY_PATTERNS`: first-appearance, origin, death, intro, first-told, cameo, second-appearance, first-cover. `extractKeyFromComps(titles)` returns `{ consensus: hits>=2, singletons: hits===1 }`. `cleanCompPhrase` strips trailing CGC suffix/year/grade. `titleCaseKeyPhrase` preserves punctuation. Sources cap 3 per entry.
**Display only** — `out.keyIssue` resolution chain unchanged. Promotion to keyIssue (Ship #12b) gated behind future explicit greenlight.

### Premium creator credits (Ship #16, `src/lib/premiumCreators.js`)
80 tiered creators (legend 20 / premium 25 / modern-premium 20 / current 15). `extractCreatorsFromComps(titles)` returns `{ consensus, singletons }`. Alias policy: 39 unambiguous last-names allowed (Wrightson, Aparo, Kirby, Ditko, McFarlane, Mignola, Capullo, Dell'Otto, Artgerm, ...); full-name required for ambiguous (Neal Adams vs Arthur Adams, Jim Lee vs Stan Lee, Frank Miller vs Mike Miller). Optional `role: 'writer'|'artist'|'cover'`.
**Display only.** Ship #16b (creator-aware multiplier) gated behind explicit greenlight.

### Decision Engine (Layer 3, v0-D.1 deployed)
Pure helper `computeDecision(item)` in `src/lib/decisionEngine.js` returns structured decision with action, confidence, blockers, warnings, and next steps.

**Actions:**
- **ID_REQUIRED:** Identity fields incomplete (missing title/issue/publisher, identity conflict)
- **DO_NOT_LIST:** Hard blockers present (manual review required, mega-key, catastrophic overprice, reprint with no comps)
- **RESEARCH:** Critical warnings escalated (sold/active mismatch, thin Golden Age pool, active avg far below)
- **GRADE_CANDIDATE:** Grading upside detected (price ladder shows 2x+ uplift)
- **LIST_LOW:** Moderate warnings present (thin pool, variant contamination, bundle candidate, reprint/polybag)
- **LIST_NOW:** Clean identification and pricing, ready to list

**Blockers:** missing identity fields, manual review required, grade exceeds map, reprint/polybag with no verified comps, catastrophic overprice.

**Integration:** Called at end of `api/enrich.js`, persisted through all merge paths, gates eBay listing actions (soft gate with user override).

### App.jsx merge paths
5 client merge paths plumb enrich response fields through IndexedDB: auto-refresh→catalogue, scan→catalogue, scan→selectedItem, bulk-import→catalogue, refreshMarketData. Pattern: `enrich.X || cur.X || defaultValue`.

### Auto-refresh
Collection tab only (`tab === 'collection'`), no book detail open (`selectedItem === null`), 60s cooldown via `lastAutoRefreshRef`. Skips items imported in last 5 minutes (`Date.now() - (c.timestamp || 0) < 300000`).

### Bulk import
Non-comic rejection, duplicate detection (title+issue+year case-insensitive), publisher-as-title WARN (not block) via `data.titleWarning = true`, full enrich field parity. Progress indicator via `bulkEnrichProgress` state.

### Buyer / Whatnot
- Buyer sessions: localStorage `cv_buyer_sessions` (last 100).
- Budget: localStorage `cv_buyer_budget`.
- Settings: localStorage `cv_buyer_settings` (whatnotFee, supplies, labor, minProfit).
- Net profit: `marketValue - marketValue×(whatnotFee/100) - supplies - labor - bid`.
- BUY/PASS auto-suggested: BUY when netProfit ≥ minProfit and within budget.
- Net profit color: green ≥ minProfit, yellow > 0 but < minProfit, red ≤ 0.

### eBay listing
Title includes variant (newsstand, gold, 2nd print, etc.) between issue and grade. Filtered by `NO_TITLE_VARIANTS` (corner box, masterpieces, design variant, cover a/b/c/d, headshot).

### GoCollect CGC FMV
**NOT live (Q25, 2026):** the enrich Promise.all slot passes `Promise.resolve(null)` — 100% timeout rate made the real call a 4.5s tax with zero returns. UI paths below remain wired for a future re-enable. Purple panel in CollectionDetail with FMV at 9.8/9.6/9.4. Submit recommendation: `fmv98 > rawEquiv + $50 && gap >= 2x`. Manual override `item.userFmv98` persisted. CGC submission profit scenarios for raw books — gradingCost $35 + pressCost $20 = $55 against `getDisplayPrice`.

### Misc
- Publisher cleanup: `cleanPublisher(p)` strips `()` `[]` `{}` `"` `'` `/` `\` `&` `?` → space. Applied at handler entry.
- FloatingSearchBar: two modes — 🔍 search (local filter) vs 🧠 claude (AI query). Never mix.
- Share Target: switches to Buyer tab, strips `?share-target=1`, calls `gradeBlob(blob, { save: false })` — no widget overlay.
- Collection list paddingBottom: 220px when Claude card visible, 100px otherwise.
- Navigation gestures (CollectionDetail): swipe requires duration ≤500ms AND `|dx| >= 50` AND `|dx| > |dy|`.

## Features
- **Bundle listing**: Manage tab → "📦 Create Bundle" chip → multi-select tiles → floating bar shows `$sum → $bundlePrice (18% off)` → "List Bundle" posts to `/api/list-ebay` with `{ bundle: true, items: [...] }` → single eBay listing (all items `status:"listed"` with shared `ebayItemId`/`bundleId`). ERA from earliest book year. Claude BUNDLE actions pre-select.
- **Watch Mode**: Buyer tab → 👁 Watch Mode → rear camera captures JPEG every 3s → `/api/grade` self-correcting pipeline (Pass 1 Sonnet fast → Pass 2 Sonnet self-correct → Pass 3 Opus) → dedup by `title|issue` → `/api/enrich` on new comic → shows Market + Net @ bid. Voice + text context shared via `watchContext` state. Auto-bid from speech transcript.
- **Post All HOT**: Manage tab `📋 Post All HOT (X)` button. Filters `aiTags[id]?.label === 'HOT' && status !== 'listed' && getDisplayPrice > 0`. Sequential post via `onListComic` with 1500ms between rows.
- **Editable list price**: numeric `listPrice` input above List on eBay button. `handleList` passes `{ ...item, price: "$X.XX" }` so override drives eBay StartPrice + persists to catalogue.
- **CGC submission scenarios**: per-grade `fmv → net` with pass/fail. Verdict from lowest profitable grade.
- **Decision recommendations**: BUY/SELL/HOLD/WAIT badges on comic detail cards with blocking reasons. Gates listing actions when decision=WAIT.

## Current State (as of 2026-07-11)

**Build:** ✅ CLEAN (prebuild hook active)  
**Vercel functions:** 12/12 (at cap)  
**Launch status:** Certification cycle — GL-0..GL-4 + FIX-1/2/3 shipped, awaiting 10-scan rerun

**File sizes (2026-07-11 actual):** enrich.js ~5,770 lines, App.jsx ~11,100 lines.
(The "AssetCore extraction: 4,642 → 3,938" figure below is the historical
Session-3B delta; enrich has grown since — do not treat old line counts as current.)

**AssetCore Extraction:** ✅ Complete (Session 3B historical)
- ComicAdapter.js: 312 lines (4/4 functions)
- identityCore.js: 5 universal resolvers
- pricingEngine.js: 9 universal helpers

**Known stale test suites (pre-existing failures, baselined 2026-07-11 on 2b19171 —
NOT caused by the certification-cycle commits):** decision-engine (7),
comp-filter-hygiene (4, Bug 1/2 helpers), sold-verification (5, variant filters),
batch1-fixes, identity-gate, image-search-extraction, mega-keys,
pattern-k-dedupe-issue, priceBands, ship26-integration. Reconcile stale
expectations vs code in a dedicated pass.

**Performance:**
- Average scan time: 2.5s (66% improvement from 7.5s baseline)
- Prompt caching: ~96% savings on Vision (5-min TTL)

**Deploy:** git push origin main = auto-deploy  
**Rollback:** git revert [hash] && git push  
**History:** See `docs/SESSION_ARCHIVE.md` for full ship log

**Open items:**
- Q65 [P2]: Invincible #19 ≤$60/REVIEW gate (C4 queue)
- **Q-SS [P2, queued 2026-07-11]: SS yellow-label incoherence** — a Signature
  Series scanned book prices against pools where `[signed-filter]` strips all
  signed comps, so an SS book is priced off non-SS data. GL-2 deliberately does
  NOT suppress yellow labels (SS books legitimately carry premiums); needs its
  own design: SS-labeled book ⇒ SS comp pool or advisory banner.
- FIX-4 floor re-verify: worksheet at `docs/FLOOR_REVERIFY_2026-07-11.md`
  (445 bucket rows / 43 entries) — manual Heritage/eBay pulls, GoCollect NOT
  live. Known-stale: X-Men #1 bucket-7 $30K vs $22.3K own market (EX-5/D-3).
  Floor VALUE changes are pricing math — per-entry greenlight required.
- Variant fallback for thin markets (architecture confirmed, awaiting greenlight)
- Future: Vercel KV for cross-instance rate limit persistence
- **Q106 [P0, shipped 2026-07-13] certNumber OCR risk:** cgc-lookup identity
  (Fix-1) is gated on `certNumber`, which is Vision's own unverified OCR read
  of the slab (not independently validated before the CGC cert-lookup call).
  Currently moot in practice — see "CGC certlookup endpoint" under Open
  Blockers > External: the endpoint itself is dormant (WAF 403s all
  serverless requests), so every graded scan falls back to visual-pool
  identity regardless of OCR accuracy. Revisit this risk once the endpoint
  is reachable again.

## Roadmap

**Session 4A** (Next) — BookAdapter
- Create BookAdapter.js (ISBN lookup, condition keywords, edition detection)
- Universal AssetCore handles pricing/decision

**Session 4B** — CardAdapter
- Create CardAdapter.js (player, team, card number, set, rookie flag)

**Session 5** — Multi-format UI
- Asset type selector (comic/book/card)
- Format-specific scan flows

**Session 6** — Portfolio intelligence
- Cross-collection analytics
- Optimization recommendations

## Architecture Notes

### AssetCore Abstraction (Session 3B)
AssetCore is now **universal** — operates on primitives only (title, year, grade, price, rawComps, etc.). All format-specific domain knowledge lives in adapters:

- **ComicAdapter.js** (312 lines) — issue, publisher, variant, keyIssue, certNumber, cgcPenaltyFlags, comicVine, era detection, creator patterns, artist names, character-in-series, publisher-in-title protection, title sanitization
- **BookAdapter.js** (future) — ISBN, edition, condition keywords, format (hardcover/paperback)
- **CardAdapter.js** (future) — player, team, cardNumber, set, rookie flag, PSA/BGS grading

**Universal modules:**
- `identityCore.js` — title overlap, identity resolution, issue resolution, year resolution, comp backfill
- `pricingEngine.js` — floor guards, sanity checks, grade multipliers, thin-pool anchor
- `decisionEngine.js` — action selection (LIST_NOW/RESEARCH/GRADE_CANDIDATE/etc.), blocker/warning detection

**Creating a new adapter:** One new file (e.g., `src/adapters/BookAdapter.js`). Implement 4 functions (detectKeyValue, verifyStory, computeEraRisk, sanitizeFormatTitle). Set universal flags (hasKeyValue, contentVerified, eraRisk, identityComplete, etc.). AssetCore handles the rest.

**Boundary enforcement:** AssetCore MUST NOT reference format-specific fields (issue, publisher, variant, player, team, ISBN, etc.). See `docs/ASSETCORE_INTERFACE.md` for the complete contract.

## Pattern Library
**Descriptive names, not letters. Listed in approximate order of discovery.**

- **Sinful Suzie class** — wrong-title comp contamination (different series under same nominal title).
- **Thor #4 class** — printing version mismatch (1st vs 2nd print same cover).
- **Howard Duck Magazine class** — format collision (magazine vs comic same character).
- **Marvel Age #58 class** — shared issue # different title.
- **Annual #2 class** — marker asymmetry (Annual #1 vs Annual #2 same series).
- **Loot Crate class** — convention/variant in active pool not flagged as variant.
- **Chip n Dale class** — text verified but cover image was different book.
- **Whitman #978 class** — non-comic format priced as regular comic.
- **Action Force class** — thin pence/UK market false HIGH match.
- **Spooky #118 class** — grade mismatch in active pool.
- **D'Orc #1 class** — apostrophe title eBay tokenization (`cleanTitleForSearch` SPACE replacement).
- **Star Wars #1 class** — reprint vs first-print (Vision sees, engine ignores) — Ship #19 territory.
- **Biker Mice #1 class** — thin pool sanity-flipped above lone comp — Ship #13.1 territory.
- **Action #1 / Superman #1 / Detective #27 class** — manual-review mega-keys.
- **JLA #62 class** — bottom-of-CGC-census low-grade floor — Ship #17 territory.
- **FF #61 class** — Silver Age key low-side threshold underpricing — Ship #14 territory.
- **House of Secrets #106 class** — alias-only creator detection — Ship #16 territory.
- **TMNT #1 IDW 2016 class** — mega-key publisher+year disambiguation — Ship #20a.7 territory.
- **Donald Duck Whitman #978 class** — refuse-to-price gate — Ship #20a.6.4 territory.
- **Provisional State Write class** — component writes optimistic state before backend confirmation, persists through merge.
- **Vision Hallucination class** — Vision infers fields from JSON_SHAPE context when confidence low.
- **Build-Pass Runtime-Fail class** — code passes build + tests but crashes at runtime (JSX scope errors).

## Open Blockers

### External
- **GoCollect API key #019483** — pending since 2026-04-15.
- **eBay Marketplace Insights API** — gated for indie devs (DEAD).
- **eBay Finding API** — rate-limited 100% as of late April 2026, bypassed.
- **CGC certlookup endpoint (`cgccomics.com/certlookup/`)** — DORMANT as of
  2026-07-13. Returns HTTP 403 on all serverless requests, confirmed via
  direct fetch on a real cert, the bare path, and an arbitrary fake cert
  number (identical 403 on all three) — this is WAF/bot protection on that
  specific path, not a per-cert validity signal, and not simply an in-session
  rate limit (fires on the very first request). `lookupCGC()` in
  `api/cgc-lookup.js` returns null on any non-200; Q106's cgc-identity path
  degrades gracefully to visual-pool identity on every scan as a result — no
  code change needed to reactivate if/when CGC's WAF stops blocking
  serverless traffic. Known risk from the original Q106 note (Vision's own
  unverified `certNumber` OCR read) still applies whenever the endpoint does
  respond.

### Workaround Active
- PriceCharting sales-history scrape (Ship #20a foundation data layer).

## Handoff Pointers

- Session history: `docs/archive/` directory
- Behavioral specs: `tests/` directory (1,570 tests, 23 suites)
- Pricing math: `api/enrich.js`
- Sold verification: `src/lib/soldVerification.js`
- Comp hygiene: `src/lib/compHygiene.js`
- Pedigree registry: `src/lib/pedigreeRegistry.js`
- Premium creators: `src/lib/premiumCreators.js`
- List-price warning: `src/lib/listPriceWarning.js`
- Decision Engine: `src/lib/decisionEngine.js`
- Vision integration: `api/grade.js`
- PriceCharting scrape: `api/pricecharting-pop.js`
- Mega-keys floor: `api/mega-keys.js`
