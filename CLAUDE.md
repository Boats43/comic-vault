# Comic Vault PWA

## Project
Comic Vault — a progressive web app for grading, pricing, and managing comic book collections.

## Stack
- **Frontend**: React + Vite (single-page app in `src/App.jsx`)
- **Backend**: Vercel serverless functions (`api/` directory)
- **Storage**: IndexedDB (client-side) for the catalogue. Server-side: Upstash Redis via Vercel KV (`api/kv-cache.js`, live since 2026-06-29, commit `dfbb959`) caches ComicVine/PriceCharting/active-comps/PriceCharting-HTML/eBay-OAuth-token lookups — corrects the "no server database" claim this line carried until 2026-08-07 (GrailKey Dispatch 18); it's a KV cache, not a relational/persistent-catalogue store, but it is server-side persistence. Requires `KV_REST_API_URL`/`KV_REST_API_TOKEN` — not yet listed under Environment Variables below, flagged as its own gap.
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
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (2026-08-07, GrailKey Dispatch 18) — Upstash Redis credentials for `api/kv-cache.js`'s KV cache. Not previously listed here despite being live in production since 2026-06-29 — confirmed set and working via direct production log evidence (`[kv-cache] SET`/`MISS` lines succeed on real requests, never fall into the module's own "Redis unavailable" warning path).

## Rules

### CLAUDE.md size limit (P0 PROTOCOL — standing, ruled 2026-08-07, GrailKey Dispatch 16) — STANDING CONSTRAINT, do not let finding writeups accumulate inline
**CLAUDE.md must stay comfortably under 150,000 chars or it stops loading — a doc that silently stops loading takes every constraint in it down with it, not just the newest one.** Evidence: 2026-08-07, the file reached 193,005 chars (the Pattern Library section alone was 122,331 of that) and was no longer being fully loaded — meaning the Flash #139 rank-weighting constraint (see Issue-consensus guard below), the `applyDualAxisGate` reason-string coupling, and the documented test baseline were all silently at risk of not reaching a session that needed them. Fixed same day: the full finding history was moved to `docs/PATTERN-LIBRARY.md` (verbatim, Dispatches 01–15); CLAUDE.md kept only a one-line index entry per finding (see Pattern Library section below). File dropped to 74,839 chars.
**Rule:** a new finding gets one line in the Pattern Library index here, plus the `docs/PATTERN-LIBRARY.md` pointer — the full writeup goes in that file, never inline in CLAUDE.md. Before committing any addition to this file, check `wc -c CLAUDE.md` stays well under 150,000 — don't wait for the next dispatch to notice it crossed the line.

### Directive preflight requirement (P0 PROTOCOL — standing, ruled 2026-08-11, GrailKey Directive 2026-08-11-B)
**Any directive referencing a ticket ID (`GK-N`) or a structural fact about this repo must run a preflight check against `docs/TICKET-REGISTRY.md` before doing work.** Evidence for the rule: two directives in one day (2026-08-11-A, 2026-08-11-B) were each written against ticket labels that had already been renumbered or already-shipped facts the writer didn't know about — the first burned ~30 minutes rediscovering that "GK-38"/"GK-42" were live tickets under different numbers (GK-66/GK-67, already shipped). The registry exists specifically so that lookup is a `grep`, not a re-investigation. Preflight shape: report HEAD SHA, working-tree-clean status, each referenced `GK-N`'s current status/aliases from the registry, and each referenced structural fact's stamped value below — before proceeding, not after.

**Structural-fact stamps** — verified against HEAD `1aa6eb0`, verified date 2026-08-11 (GrailKey Directive B, Task 1). Re-stamp any of these the moment code changes what they describe; do not let a stamp silently go stale.
- **IndexedDB merge sites: 8** — see "App.jsx merge paths" below for detail and the correction history (was documented as 5).
- **Live external sources (3):** ComicVine (API), eBay Browse API (image + text search), PriceCharting (HTML scrape). **Dormant (2, code present, not called/reachable in production):** CGC cert lookup (`api/cgc-lookup.js`, WAF 403s the endpoint), GoCollect (`api/gocollect.js`, call site hardcodes `Promise.resolve(null)`).
- **ComicVine identity-gate status:** CLOSED (GrailKey Directive B, Task 3, 2026-08-11, GK-71). All three gates in `api/enrich.js` — year-strict, token, publisher — now empty the candidate set (`candidates.length = 0`) when their filter would remove everyone, instead of silently restoring the rejected pre-filter set. Matches the reprint-publisher gate's pre-existing correct behavior (Q99 ruling). A fourth instance of the same shape was found sweeping for this fix — `api/comps.js:1803`, eBay grade-proximity comp filter — logged as `GK-70`, deliberately NOT fixed (pricing-math boundary, needs its own greenlight).
- **Test baseline:** 157 PASS / 16 PRE-EXISTING FAIL / 3 GATED SKIP / 0 NEW REGRESSIONS — re-confirmed this session by direct re-run of `decision-engine.test.js` (39/7, byte-identical to the documented figure) and `comp-filter-hygiene.test.js` (4 pre-existing failures, matches the documented "comp-filter-hygiene (4)" entry); full 177-file sweep run in parallel with this directive's other work.

### Customer-Grade Standard (P0 PROTOCOL — standing)
**PRODUCTION RULE:** No card ships a price that contradicts its own evidence panel. Self-flagged mismatches (>100% drift over own pool avg, tier-4 NO DATA, refuse states) must be coherent:
- **Self-flagged drift:** Auto-RESEARCH decision (never LIST_NOW/LIST_LOW when engine flags >100% over comps)
- **Refused states:** Render $0 everywhere OR render nothing (blank/null). Zero bands + single "REFUSED" banner (Q68).
- **NO DATA tier-4:** "Estimated comps" label under Verified badge (P3).
- **Evidence consistency:** Match confidence, decision action, and displayed price must align. A LOW-confidence $300 book with 2 comps averaging $18 fails customer-grade.

**Enforcement:** Pre-ship validation checks decision.action vs match confidence tier vs price deviation. Cards violating coherence are blocked from LIST actions until fixed.

### I13 — Log-Card Fidelity (P0 PROTOCOL — standing, ruled 2026-07-19)
**If the logs have it, the card has it — exact, sourced, annotated.** No gate, filter, fallback, or default may hide or replace pipeline data on the card. New features comply with I13 by construction or fail CI.

- **Data exists in logs → renders on card.** 29 rejected comps found → card shows all 29, greyed, with reasons. A valid comp in the pool → visible, never vaporized. A sold record → shown with its date and title.
- **Data absent in logs → card shows "—".** No sold data → no "Last sold $4," ever (the Harley Quinn #62 violation this rule exists to make impossible — `comps.recentSales`, active-listing data, must never be relabeled as a sale).
- **Gates flag, never filter from view.** A gate's opinion is an annotation attached alongside the data — the data itself is untouchable. Suppression is prohibited. Fabrication is prohibited. The only permitted transformations between log and card are formatting and annotation — never replacement, never omission, never synthesis.
- **Every card value must be traceable to a log line.** If Claude Code can't cite the logRef for a rendered number, that number doesn't render.
- **Enforcement:** `validateContract` (`src/lib/responseContract.js`) implements I13 alongside invariants I1–I12: every populated `contract.fields` entry must carry a non-null `source` + `logRef`; violations demote the card to `INCOMPLETE` per the existing convention. This is the mechanically-enforceable half (checkable server-side from `out` alone). The other half — every card-rendered value must have a matching `contract.fields` entry — cannot be proven server-side (the API never sees the React tree); it is enforced at render time by the client-side `assertContractField` dev-mode warning (`App.jsx`), which is real but necessarily partial: it only covers render sites migrated to call it.

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
- **Vercel function cap — RESOLVED (2026-08-07, GrailKey Dispatch 23): this project is on Pro (or higher), not Hobby, and there is no function-count cap at all.** Every `.js` file in `api/` becomes its own serverless function endpoint, regardless of whether it has a default-exported HTTP handler — that mechanic is unchanged. But the "12" number and "Hobby plan" premise are both stale. Confirmed via current Vercel documentation (`vercel.com/docs/functions/runtimes`, dated 2026-07-29): "Functions created per deployment: Hobby: Framework-dependent, Pro and Enterprise: No limit" — and for a non-Next.js/SvelteKit framework (this project uses Vite, where every `api/*.js` file maps to one function, exactly as this line already described), the doc states explicitly "For Hobby, this approach is limited to 12 Vercel Functions per deployment." Cross-checked against this project's actual live deployment (`dpl_4mwr6MwTQZ7m4CxsZQFdjoaXr1SW`, `get_deployment`'s own `lambdaRuntimeStats: {"nodejs":14}`) — 14 functions are genuinely deployed, READY, and serving production traffic right now. Since Hobby's documented cap is 12 and this deployment has 14, the account cannot currently be on Hobby — it must be Pro or Enterprise, both "No limit." Current count: 14 files in `api/` (`cgc-lookup.js, chat.js, comps.js, delist-ebay.js, enrich.js, gocollect.js, grade.js, kv-cache.js, list-ebay.js, manage.js, mega-keys.js, pricecharting-pop.js, rate-limit.js, sold.js`), no cap currently blocking a 15th. Do not re-add a "12/12" framing without re-verifying the plan tier — if the account ever reverts to Hobby, the real 12-function limit (confirmed still accurate for Hobby specifically) would apply again immediately.
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

### Year override guard (`resolveYear`, `src/lib/identityCore.js`)
`confirmedYear` derivation, trust-but-verify. Corrected 2026-07-18 (Q112
dispatch) — this section previously documented logic that doesn't match the
actual implementation; verified line-by-line against `resolveYear` itself:
- (a) eBay-consensus year present (`ebayYear`, from `ebayYearAuthoritative`
  — requires ≥10 pool items and ≥8 year-agreeing) → wins outright,
  top priority, no gap check against user year at all.
- (b) PC and CV agree within ±2y of each other → average.
- (c) PC present AND (**no user year at all** OR PC within ±2y of user) →
  PC wins.
- (d) CV present AND (**no user year at all** OR CV within ±2y of user) →
  CV wins.
- (e) user year present but PC/CV both disagree by >2y (or are absent) →
  keep user year, set `yearOverrideRejected = true`.
- (f) no user year AND no PC/CV match at all → fall through: PC first,
  then CV, then Vision's raw (possibly null) value; `yearSource` gets a
  `-fallback` suffix.

**The `(!userYear || …)` clause in (c)/(d) is a real gap, not a typo:**
when the request carries no Vision/user year at all (manual entry without
a year, or Vision declining to guess), branches (c)/(d) accept PC/CV's
year **unconditionally, with zero plausibility check** — (e), the
documented safeguard, is unreachable in that case. There is no
issue-number-vs-year plausibility check anywhere in the codebase (e.g.
"issue #608 of a monthly series can't be the same year the series
launched") as a last-resort catch. Era-specific keyIssue detection (silver
age/bronze age/etc., previously documented as branch (a)) does not exist
in `resolveYear` — dead variable at the `api/enrich.js` call site, marked
"currently unused" in its own comment (Phase-3 stub).

**`cvYear` itself** (fed into `resolveYear` as the 3rd argument) is
computed by `deriveCvYear(comicVine)` (`identityCore.js`) from the matched
issue's own `coverDate` field ("YYYY-MM-DD") — **never** from
`comicVine.startYear` (the matched ComicVine *volume*'s launch year; fixed
2026-07-18, Q112 dispatch, Batman #608 class — see Pattern Library). No
fallback to `startYear` when `coverDate` is missing; `deriveCvYear` returns
`null` in that case and `resolveYear` falls through to its other sources.

`out.confirmedYear` + `out.yearCorrected` surfaced. App.jsx enrich callbacks heal `item.year` when `yearCorrected === true`.

**Queued follow-up (not yet done, 2026-07-18):** a second, independent
safety net — the era-gate at `api/enrich.js` ~2893-2909 — was specifically
built to reject a CV year >10y outside an eBay-visual-pool-derived
`eraLock`, but reads `comicVine?.volume?.startYear`, a shape that never
resolves (`comicVine.volume` is a flat string, not an object with a
`startYear`) — this guard has silently never fired. The identical shape
bug also breaks the CV convergence-score axes (`title`/`issue`/`era`/
`publisher` reject checks, ~2811/2817/2823) and CV-based publisher
backfill (~3332-3335) — three more always-false dead-code paths, all
sharing this one root cause. Deliberately NOT bundled into the `deriveCvYear`
fix above: reactivating all three simultaneously has unknown interaction
effects on cases that have been running without them for however long
this has been broken, and deserves its own dedicated investigation and
regression pass rather than a bundled fix. `deriveCvYear` alone fully and
independently resolves the Batman #608 class — this follow-up is
additional defense-in-depth, not a dependency.

**Fix 6, SHIPPED (GrailKey Dispatch 19, 2026-08-07) — vision-fallback
downgrade rescue, corrected from the original poolYearHint design.** The
Dispatch 15/16 design above (thread `poolYearHint` into branch (e)) was
built on a misread of a real log line and was never shipped as designed
— `poolYearHint` is NOT consumed by the fix that actually landed. Real
production evidence (Spawn #351, 2026-08-07 20:40:36 UTC) showed Commit
4.1's family-scoped year adoption (`identity.familyYearConsensus`,
year=2024, support=3/4=75%) being silently overwritten by `resolveYear`
falling through to Vision's own literal `"Unknown"` string
(`yearSource='vision-fallback'`) — a DIFFERENT signal than
`poolYearHint`, which was 2020 at 3/6 on that same scan and wrong.
`rescueYearFromVisionFallback` (`src/lib/issueAuthority.js`, called from
`api/enrich.js` right after the existing commit-p2 block, log tag
`[commit-p3]`) fires whenever `resolveYear`'s own `yearSource` resolves
to exactly `'vision-fallback'` AND a family-scoped year was adopted
(`identity.familyYearConsensus.mode === 'adopted'`, `support >= 3` — the
same floor commit-p2 already enforces, validated by this real 3/4=75%
case) — restoring the adopted year instead of letting it downgrade to
Vision's placeholder. Deliberately independent of commit-p2's own
`highConfidenceMarketplaceConsensus` P1 gate: an adopted family-scoped
year is always a better answer than `resolveYear`'s weakest fallback,
regardless of whether the stricter P1 price-carve-out bar also cleared
(on this exact scan it did not — see the Pattern Library "commit-p
near-miss" entry, GrailKey Dispatch 19). `yearSource =
'family-consensus-vision-fallback-rescue'`, `confidence: 'provisional'`.
Never overrides any real corroboration (PC, CV, eBay-consensus, or even
the rejected-override case) — only the bare fallback. Full details and
25-assertion regression: Pattern Library, "GrailKey Dispatch 19" entry;
`tests/grailkey-dispatch-19-fix6-year-rescue.test.js`.

### Issue-consensus guard (`resolveFamilyIssueConsensus`, `src/lib/identityCore.js`) — STANDING CONSTRAINT, do not rank-weight
**Rule: issue-axis consensus is a pure aggregate vote (unique-row count vs. a
fixed 60% agreement bar + a clear-lead margin over the runner-up). It is
NEVER weighted by eBay search-result rank/position.** A rank-weighted
version of this was attempted and reverted twice before landing on the
aggregate-vote design now shipped (commit `18ed481`, "Q140 corrective
dispatch: issue consensus + terminal fingerprint invariant") — the
reasoning lives in a session handoff outside this repo, not in git history
(`git log -S "Commit U"` returns zero hits — that commit never landed).
Record here so it is not silently re-attempted.

**Load-bearing precedent: Flash #139 mixed-family conflict.** A real visual
pool where a numerically-dominant #170 anniversary-issue cluster (3/5 rows)
outnumbers the genuinely-correct #139 rows (2/5, matching Vision's own
read). `resolveFamilyIssueConsensus` must NOT adopt the numeric plurality
here — `mode: 'conflict-locked'`, `issue` stays `'139'` (Vision's value,
never overwritten), `winner: '170'` recorded only for diagnostics.
Verified directly (`tests/q140-issue-consensus-corrective.test.js:178-187,
226-241`). Any issue-consensus fix that would resolve this case by ranking
or weighting candidate issues risks reintroducing the exact regression
this precedent guards against — a numerically-louder wrong cluster must
never outvote a present, Vision-asserted value it disagrees with.

Five modes, all pure count-based (`tests/q140-issue-consensus-corrective.test.js:139-212`):
- missing issue + ≥3 unique family rows + ≥60% agreement + clear lead over runner-up → `adopted`
- present issue + family aggregate agrees (same 60%+clear-lead bar, never a bare single-row match) → `corroborated` (issue unchanged, just confirmed)
- present issue + family aggregate disagrees → `conflict-locked` (Flash #139 shape above — never overwrite)
- present issue + family has zero issue-token consensus at all → `no-consensus` (keep prior)
- a single representative row, even at 100% self-agreement, can never establish an issue (`<3`-unique-row floor) → `no-consensus`

**Q51/Jetsons note (2026-08-06, GrailKey Dispatch 03):** the Jetsons #19
misfire (real production request `cnvm8-1786031045100-377b3eb920d3`,
2026-08-06 15:44 UTC) is a DIFFERENT shape than Flash #139 — Vision's issue
("19") had **zero** pool support at all (not present-but-outnumbered), and
the winning title family's own issue consensus was `mode: 'no-consensus'`
(ratio=0.20, below the 60% bar) while the true answer (#32) was the
plurality candidate. `familyAuthoritySkip`
(`identityCore.js:2147-2150`) was checked directly against this shape and
already correctly requires `mode ∈ {'adopted','corroborated'}` before
skipping the raw-pool zero-support check — `'no-consensus'` does NOT
qualify, by explicit design (`identityCore.js:2132-2136` comment). A
"vision-zero-support skips on family authority without checking issue
consensus" hypothesis was tested against this exact code path and
**falsified** — the mode-check already exists.

**CORRECTED (Q54, GrailKey Dispatch 05, 2026-08-07) — the "root cause
closed" ruling immediately below was wrong about generalizing "not the
cause of the #19/#16 pair" to "not a real cause at all."** The `titleOk`
derivation it contains is still correct **for that specific scan pair
only**; the "ruling out" clause is retracted — see the correction that
follows.

**Root cause closed (Q54, GrailKey Dispatch 04, 2026-08-06):** confirmed via
direct log evidence (`[phase1] eBay visual: N results, consensus=YES/NO`,
`api/enrich.js:2477`) that `visionIssueCount` was **0** for Vision's issue
in BOTH the failing scan ("19") and the correctly-blocked rescan ("16") —
~~ruling out the initially-suspected cause (a nonzero, coincidental pool
mention of Vision's own issue number silently disabling the safety
net)~~ — **this clause is false, see the correction below.**
With `visionIssueCount===0` and `issueOk===false` fixed identically across
both scans (the latter directly evidenced today by the ESCALATE firing at
all — `noIssueConsensus` is exactly `!issueOk` — and implied yesterday by
the shipped value being Vision's raw, unmodified guess with no OVERRIDE
logged), `extractConsensus`'s own early-return gate
(`imageSearchIdentity.js:646-648`) reduces to a single live term:
```
zeroSupportNoAdoption = titleOk && !issueOk && visionIssueNorm!=null && visionIssueCount===0
returnsNull          = !titleOk || (!issueOk && !zeroSupportNoAdoption)
```
substituting the two fixed-true terms collapses `returnsNull` to exactly
`!titleOk`. `visionIssueNorm` was non-null both scans (Vision always
supplies *some* issue guess) and is not the discriminator either. `titleOk`
(`imageSearchIdentity.js:625`, `titleResult.count/total >= 0.3` — raw-pool
title-string agreement, computed over `parsedVisualRows`, upstream of and
independent from `resolveFamilyIssueConsensus`'s own family-scoped ratio)
is the term that flipped, false→true, between THIS pair of scans. When
`titleOk` was false, `extractConsensus` returned `null` outright —
collapsing `ebay` to `null` for the entire `resolveIdentity` call — so the
`ebay?.agreement?.visionIssueCount === 0` guard (`identityCore.js:2171`)
evaluated `undefined === 0` (false) and the whole OVERRIDE/ESCALATE branch
was silently skipped, with no log line at all. `confirmedIssue` was left
standing at whatever `identityCore.js:1651` had already assigned earlier in
the same call — Vision's own "19", preserved verbatim by
`resolveFamilyIssueConsensus`'s `'no-consensus'` mode (explicit by design,
per that function's own comment: "this only affects the CONFIDENCE LABEL,
never the value"). No downstream re-hydration and no `isGraded`
short-circuit were needed to explain THIS scan pair's miss.

**What Dispatch 04 got wrong (Q54, GrailKey Dispatch 05, 2026-08-07):**
generalizing "not the cause of the #19/#16 pair" to "not a cause at all."
A third, separate same-day scan (Vision issue "10") proves the
originally-dismissed hypothesis correct on its own terms:
`[visual] extracted issues: [...,'10',...]` shows "10" present once out of
19 raw-pool rows — one unrelated listing ("Jetsons 10 Gold Key Comic 1964
Hanna-Barbera... W/TOUCHE TURTLE"). `visionIssueCount = 1`, so
`zeroSupportNoAdoption` is false; combined with `issueOk` false (no 50%+
winner anywhere in this pool either), `extractConsensus`'s early return
fires on its OTHER disjunct (`!issueOk && !zeroSupportNoAdoption`, both
true) — not on `!titleOk`. Confirmed directly, not inferred: the
`[extractConsensus] returning null — titleOk failed` instrumentation
(added Dispatch 04, live in production for this exact scan) did **not**
fire on it — its absence is itself the evidence `titleOk` was NOT this
scan's cause, unlike the #19/#16 pair above.

| Scan | Vision issue | In raw pool? | `extractConsensus` null via | Outcome |
|---|---|---|---|---|
| Aug 6, scan A | #19 | no (0/N) | `!titleOk` | shipped $2.89, wrong book |
| Aug 6, scan B | #16 | no (0/20) | — stayed non-null; ESCALATE fired | correctly blocked, ID_REQUIRED |
| Aug 6/7, scan C | #10 | **yes (1/19)** | `!issueOk && !zeroSupportNoAdoption` (visionIssueCount≠0) | shipped $6.46, wrong book (real answer: #32, Oct 1969) |

**Both mechanisms are real, independent, and each alone is sufficient to
silently disable the OVERRIDE/ESCALATE safety net** (`identityCore.js:2171`,
gated on `ebay?.agreement?.visionIssueCount === 0`, which never evaluates
true when `ebay` is null regardless of which of `extractConsensus`'s two
return-null disjuncts fired). `titleOk` is **one of at least two
independently-sufficient failure paths** into the identical silent-skip
outcome, not the sole discriminator — correct that framing wherever this
finding is cited going forward.

**Real underlying defect, investigated but NOT yet scoped (item 2,
Dispatch 05, 2026-08-07):** `zeroSupportNoAdoption` requires Vision's issue
to have **literally zero** occurrences anywhere in the raw pool
(`visionIssueCount === 0`, `imageSearchIdentity.js:646`) — an equality
test, not a threshold. Scan C shows 1 occurrence out of 19 (~5%) was
sufficient to disable the check entirely. On any long-running series, a
large raw pool will contain most issue numbers *somewhere* purely by
chance — meaning this protection can structurally almost never fire on
exactly the books most likely to need it (long runs with many candidate
issues genuinely in circulation on eBay). Proposed direction, not yet
scoped or coded: replace the `=== 0` equality with a support-RATIO floor
(candidate: Vision's issue below roughly 10% of pool support counts as
zero-support for this purpose) — one change would cover both the
literal-zero case (scan B) and the near-zero case (scan C's 1/19). This
reaches directly into `extractConsensus`'s issue-consensus math — Flash
#139 constraint territory, same standing rule as every other adjustment
in this section — requires explicit scoping and greenlight before any
implementation. No code written against this yet.

**Standing finding, independent of either fix — title-coherence gates the
issue-safety net (still true, now known to be one of two gating paths):**
`extractConsensus`'s `titleOk` gate (raw eBay-pool title-string agreement,
≥30%) was designed as a basic "is there even a coherent pool here"
precondition for computing ANY consensus field. It was not designed with
the awareness that dropping below it also silently disables
`zeroSupportNoAdoption`/`noIssueConsensus` — the specific mechanism built
to catch a Vision issue number with zero (or, per the finding above, near-
zero) pool support. A pool whose TITLE text is too scattered to reach 30%
agreement (for any reason — noisy query, contaminated results, genuinely
mixed listings) currently forfeits the issue-zero-support protection
entirely, silently — a gap now closed by the Dispatch 04 instrumentation,
which distinguishes "title too incoherent to check" from "checked and
found fine." This coupling is real and general, not specific to the
Jetsons pool — flag it before scoping any fix to the issue-safety path
itself, since a fix that touches `zeroSupportNoAdoption`/
`noIssueConsensus` without also addressing BOTH the `titleOk` gate it sits
behind AND the equality-vs-ratio defect above will not close this class.

### `applyDualAxisGate` reason-string coupling (`src/lib/imageSearchIdentity.js`) — STANDING CONSTRAINT, do not reword the reason string
**`applyDualAxisGate`'s `reason` string is parsed by at least one downstream
consumer as load-bearing behavior, not read as a log message.**
`imageSearchIdentity.js:2345-2347` (`isBareCreatorTokensOnly`, Commit B1)
regex-matches `reason` — `/^creator-tokens \[/` AND explicitly excludes
`/adjacent-pair recovered/` — to distinguish "bare creator-tokens" additions
(which get a family-member issue-corroboration check) from "adjacent-pair
recovered" additions (which don't, per Commit B1's own documented
reasoning: adjacent-pair carries independent adjacency evidence the bare
case lacks). **Changing `applyDualAxisGate`'s reason wording for either
branch is a behavior change, not a cosmetic one** — it can silently flip
which branch `isBareCreatorTokensOnly` matches.

Found during GrailKey Dispatch 03 (2026-08-06) while scoping Strip 2 —
confirmed the second instance of this exact shape in one file (the first:
22c's `[22c-title-revote]` guard also originally read a rejection-detail
shape before Q48 confirmed `convergence.axes[axis].rejections` is
structured data, not string-only). Two independent load-bearing
string-parses in the same file is a pattern, not a coincidence — **when
`applyDualAxisGate` gains an explicit `provenance` field (queued, GrailKey
Dispatch 03 Strip 2+1 combined work), convert `isBareCreatorTokensOnly` to
read `provenance` directly and retire this regex.** Until then, any edit
to `applyDualAxisGate`'s `reason` strings must grep
`isBareCreatorTokensOnly`'s two patterns first and confirm they still
match the intended branches.

### Mega-keys (`api/mega-keys.js`, 43 entries)
- 10 Golden / 15 Silver / 2 Bronze / 2 Modern.
- Two types: MEGA (has `grades` bucket map) and MANUAL (Action #1, Superman #1; null grades, manual review only).
- Strict canonical match: `getMegaKeyEntry(title, issue, publisher, year)`. Pre-1962 entries `yearTolerance: 2`; post-1962 `yearTolerance: 1`. `normalizePublisher` collapses Timely/Atlas → marvel.
- Three-tier badge: VERIFIED (green) / ESTIMATED (yellow) / MANUAL REVIEW (red, `pill-manual-review`) / GRADE EXCEEDS MAP (amber).
- Listing button hard-blocked on MANUAL + GRADE EXCEEDS MAP.

### CGC penalty-aware Vision (Ship #18, STANDARD_PROMPT only)
Detects: store stamps, staple popping, polybag indents, corner chips, pedigree stamps. `out.cgcPenaltyFlags` nested object plumbed through 8 merge paths × 1 line. `pedigreeRegistry.js` 22 canonical pedigrees + aliases, strict match (no fuzzy). `lookupPedigree` and `enrichPedigree` helpers.

### Watch Mode pipeline
- Pass 1 — Haiku fast ID (watch-optimized prompt: "read directly from cover, do not infer"). Confidence=high + title not unknown → return (1 pass).
- Pass 2 — Haiku self-correction (sends pass 1 result as context). Not low → return (2 passes).
- Pass 3 — Opus escalation (full STANDARD_PROMPT). Same Vision flags as standard scan apply (CGC penalty + pedigree).
- Headers: `x-watch-passes` (1/2/3), `x-watch-timing` (JSON ms per pass).
- No Sonnet anywhere in Watch Mode — corrected 2026-07-15 (Q-audit cost investigation); prior doc claimed Sonnet for passes 1-2, code has always used `claude-haiku-4-5-20251001`.

### Standard (non-watch) scan pipeline — eBay-first, Vision fallback
Not a single Opus call (prior doc was stale — corrected 2026-07-15). Actual flow per scan, in order:
1. `lookupEbayIdentity` — eBay Browse API `search_by_image` (category 259104, comics), zero Claude cost. Extracts identity consensus from up to 20 returned listings.
2. **Confidence ≥ 0.3 → cheap path:** one Haiku call (`callModel` with a grade-only prompt) assesses grade/condition against the eBay-sourced identity. No Sonnet, no Opus.
3. **Below 0.3 / no consensus → Vision fallback:** one Sonnet call (`claude-sonnet-4-5-20250929`, `STANDARD_PROMPT`) does full identification. A **second** Sonnet call fires on top of that if `detectBookSignals` flags the scan as a book (re-run with `BOOK_PROMPT`) or if `voiceContext` was supplied (re-run with a context-appended prompt) — a 2x multiplier on whichever subset of scans hits either condition.
- Opus never appears in this path at all; it's Watch-Mode-only (pass 3 escalation).
- Prompt caching (`callModel`, shared by both pipelines): `system: [{SYSTEM_PROMPT}, {promptText, cache_control: ephemeral}]`. The image itself is never cached (each photo is unique) — only the ~1,500-token instruction block. Voice-context calls get a per-scan-unique cached block (voice text varies), so those specific calls essentially never hit a warm cache from a prior scan.

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
- **ID_REQUIRED:** Identity fields genuinely incomplete/uncertain (missing title/issue/publisher, `identity-not-confident`) — i.e. no usable book to price against at all.
- **DO_NOT_LIST:** Hard blockers present (manual review required, mega-key, catastrophic overprice, reprint with no comps of any kind, no pricing data from any source)
- **RESEARCH:** Critical warnings escalated (sold/active mismatch, thin Golden Age pool, active avg far below, asset-type-uncertain, identity-conflict-unresolved — see Q110 note below)
- **GRADE_CANDIDATE:** Grading upside detected (price ladder shows 2x+ uplift)
- **LIST_LOW:** Moderate warnings present (thin pool, variant contamination, bundle candidate, reprint/polybag)
- **LIST_NOW:** Clean identification and pricing, ready to list

**Blockers:** missing identity fields, manual review required, grade exceeds map, reprint/polybag with no verified comps, catastrophic overprice, no pricing data from any source.

**Q110 [2026-07-18] — intake-time non-blocking ruling:** `assetTypeConfident=false`, Vision-confirmed `isReprint`/`editionType`, and title-family-clustering `refused-identity-conflict` are no longer hard blockers (`identityBlockers` no longer includes `asset-type-mismatch`/`refused-identity-conflict`) — they're advisory `criticalWarnings` (`asset-type-uncertain`, `identity-conflict-unresolved`) that escalate to RESEARCH, never a wall. `api/enrich.js` no longer nulls price/comps for these three conditions — it sets `listingHardLocked` (routes `responseContract.js` to contract state `LOCKED`: price/bands stay visible, only the List button gates) instead of `refusedToPrice`/`identityConfident=false`/`decision.action=ID_REQUIRED` (which force state `REFUSED`/`ID_REQUIRED`: price nulled everywhere). Genuinely-missing identity (`identity-not-confident`, no usable title/issue/year/publisher at all) is unchanged and still hard-blocks — there's no book to price against. See Pattern Library "Intake-vs-listing gate class" below.

**Integration:** Called at end of `api/enrich.js`, persisted through all merge paths, gates eBay listing actions (soft gate with user override).

**Per-slug messaging:** `describeBlocker(slug, item)` / `describeWarning(slug, item)` (exported from `decisionEngine.js`) map each blocker/warning slug to a specific, item-grounded sentence (dominant `soldCompDiagnostics.reasons` cause, `storySuppressedReason` enum, `refusalReason`, actual `rawComps.count`, etc.) instead of the raw slug string. `App.jsx`'s two decision-panel render sites (`item.decision.blockers`/`.warnings`) call these per-item; `buildBlockerReason`/`buildWarningReason` (used for `decision.reason`) are thin wrappers over the same functions — one source of truth for both.

### App.jsx merge paths
**IndexedDB merge sites: 8** — verified against HEAD: `1aa6eb0` — verified date: 2026-08-11 (GrailKey Directive B, Task 1; supersedes the "5" figure this line carried until now, which undercounted by 3). The 5 originally documented: auto-refresh→catalogue, scan→catalogue, scan→selectedItem, bulk-import→catalogue, refreshMarketData. Three more independently confirmed via `grep -c "putComic(" src/App.jsx` (20 call sites total) cross-checked against which ones hand-rebuild third-party-derived fields: duplicate-confirm, reIdentifyBook, manual correction. Pattern: `enrich.X || cur.X || defaultValue`.

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

## Current State (as of 2026-07-24)

**Build:** ✅ CLEAN (prebuild hook active)  
**Vercel functions:** 14 deployed, no cap (Pro/Enterprise, confirmed 2026-08-07 GrailKey Dispatch 23 — see Architecture section)  
**Launch status:** ⛔ **Prior GO is void. `launch-candidate` withdrawn** — post-tag production findings (Q140 corrective dispatch, `18ed481` onward) reopened launch certification after the `5cb121a` close-out. The `launch-candidate` tag has been deleted from origin, not repointed — no tag by that name currently exists. Section 9 of `docs/LAUNCH-AUDIT.md` remains an accurate historical record of the `5cb121a`-era decision; it does not describe current state. Active, unclosed gate: `docs/LAUNCH-AUDIT.md` Section 10. A Step 1 closure (Commit A fixtures certified) earns a narrower `commit-a-certified` tag only — `launch-candidate` is reserved for a full launch-gate decision (Section 10's blockers resolved, Steps 2A/2B/2C closed).

**Post-launch roadmap (identity/pricing pipeline), in order:**
1. **Edition-fingerprint campaign** — design already recorded (`docs/LAUNCH-AUDIT.md` Section 2's DESIGNED-NOT-BUILT entry: family-scoped variant adoption, `event=sdcc` normalization, ≥60%/≥3-unique thresholds, conflict-refusal for mixed events/retailer exclusives/ratios/lettered covers; trigger: an accepted winning family observed disagreeing internally on specific variant signals, not yet seen in production). Also owns: `active_reference_range`'s confirmed-identity gating (Section 9's known-limitations entry — widening requires edition-aware comp separation first, not a standalone eligibility-gate fix), the lettered-cover-variant (`1B`/`1C`) `detectSeriesMarkers` digit-capture gap, and Q144B's marker-type-scoped (not cross-title) exemption boundary.
2. **Remaining comp-hygiene items** — cover-only listings, foreign-variant/pence-pricing blending, ComicVine wrong-volume-story matching (named, not yet scoped).
3. **D3-class follow-ups** — the genuinely-unidentified-book control case (Poison Ivy #1) works as intended; any future work here is refinement, not a defect fix.

**File sizes (2026-07-11 actual):** enrich.js ~5,770 lines, App.jsx ~11,100 lines.
(The "AssetCore extraction: 4,642 → 3,938" figure below is the historical
Session-3B delta; enrich has grown since — do not treat old line counts as current.)

**AssetCore Extraction:** ✅ Complete (Session 3B historical)
- ComicAdapter.js: 312 lines (4/4 functions)
- identityCore.js: 5 universal resolvers
- pricingEngine.js: 9 universal helpers

**Known stale test suites — CANONICAL, re-verified 2026-08-06 (GrailKey Dispatch
02, Commit 0a). This list is the single source of truth for "documented
baseline" going forward; `docs/LAUNCH-AUDIT.md`'s older baseline mentions
(which omitted `q-adv397-visual-guard` and never carried per-suite counts for
5 of these 10 files) are historical record only and do not supersede this.**
No test runner is installed in this repo (no `vitest`/`jest`, no `npm test`
script) — every `tests/*.test.js` is a standalone script, run individually via
`node tests/X.test.js`.

decision-engine (7), comp-filter-hygiene (4, Bug 1/2 helpers), sold-verification
(5, variant filters), identity-gate (7), image-search-extraction (2), mega-keys
(8), pattern-k-dedupe-issue (4), q-adv397-visual-guard (5, previously missing
from this list entirely).

**priceBands (7)** — re-triaged 2026-08-06 against GK-31 and Commit 5
specifically, not just GK-21. Two unrelated root causes, neither overlapping
GK-31 or GK-24/GK-19:
- 2 failures (`buildVerifiedSoldPool` "wrong issue filtered" / "variant
  mismatch filtered") test behavior `buildVerifiedSoldPool` deliberately
  stopped doing (Ship 1.6, `priceBands.js:164-183`) — issue/variant filtering
  moved entirely to `verifySoldComps` (Layer 10, `soldVerification.js`) so
  this function now trusts its input rather than re-filtering. This is the
  same file GK-24 (printing-axis fallback trigger) touches, but a different,
  already-superseded function — no landmine for GK-24.
- 5 failures (STEP 1/2/3, Action Comics #33, Flash #216) all fail on plain
  fresh-sold-pool fixtures with no variant/fallback content at all — root
  cause is a fixture/signature drift: `computePriceBands` now requires an
  explicit `soldVerifyResult.verified[].recencyBand`-shaped object for
  tier-1/2/2.5 detection (added by the same EX-A/Q109 work that also
  produces GK-31's `activeAnchoredOverFallbackSold`), but these 5 legacy
  fixtures still pass a flat `soldComps` array with an unread `daysAgo`
  field. Confirmed NOT related to GK-31's specific branch — these fixtures
  never reach tier-3 logic at all.
- **`applyVariantFallbackDivergenceCap`/GK-21** — confirmed clean, unrelated,
  has its own passing coverage (EX-A(a)-(d)) in this same file.
- **GK-31 coverage gap, found during re-triage, not one of the 7 failures:**
  zero tests anywhere in this file exercise `activeAnchoredOverFallbackSold
  = true` (`priceBands.js:531-553`, requires `verifiedActive.length >= 3`
  AND `isActivePoolVariantConfirmed`). The passing EX-A(c) fixtures use only
  1 active comp — below the ≥3 floor — so they hit the divergence-cap
  branch (GK-21), never GK-31's tier-3-active-anchor branch. Landing GK-31
  against this file has no existing regression test watching the branch it
  modifies; add one alongside the fix, not after.

**batch1-fixes** — throws on first failure instead of collecting (test-design
gap, not fixed). Characterized 2026-08-06: 0/16 assertions run before the
throw. Root cause confirmed structural, not a stale one-liner — Q22's
hyphen-normalization assertions test `tokenizeTitle`'s own output, but FIX-2
(`jrcrp-17838110`, `src/lib/compHygiene.js` ~789) deliberately moved
hyphen-join equivalence out of `tokenizeTitle` (which now correctly
space-splits "Spider-Man" → `[spider, man]`) into `hasSufficientTitleOverlap`'s
bigram-join check, to fix a real production regression (Giant-Size X-Men
vs. Giant Size X Men, 17 sold rows wrongly rejected). Q22's 4 assertions
are obsolete by design; Q23's 7 and Q28's 5 (unreached, gated behind Q22's
throw) independently verified to still pass against current code. **Do not
retire Q22 — relocate it.** `hasSufficientTitleOverlap` is GK-19's target
(one-directional overlap check, `src/lib/compHygiene.js` ~819 area — never
penalizes a listing's extra distinguishing tokens, letting "Batman Gotham
Adventures" clear 0.75 against "Batman Adventures"). When Commit 5 lands
GK-19's fix, that is the moment to rewrite Q22's 4 assertions against
`hasSufficientTitleOverlap`'s bigram-join logic — the layer the hyphen-join
behavior actually lives on now — rather than against `tokenizeTitle`.

**Stale assertion, not yet patched:** `grailkey-commit-e.test.js` and
`grailkey-commit-f.test.js` Part 2 ("scope proof: only src/App.jsx changed")
reads the live `git diff --name-only HEAD` working-tree state, not the
historical diff of the commit each file is named for. Written assuming a
single-file commit; will false-fail (informational only, not a regression
signal) any time it's run with other unrelated changes sitting uncommitted
— including this exact Commit 0a patch. Flagged in both files' Part 2
comment 2026-08-06; not restructured to be commit-agnostic (out of scope
for a display-only patch pass).

**ship26-integration** — FIXED 2026-08-06 (harness-only: `tests/
ship26-integration.test.js`'s `callEnrich` mock omitted `req.headers`,
so `api/rate-limit.js:12`'s `req.headers['x-vault-key']` threw
`TypeError` before any assertion ran. Added `headers: {}` to the mock
request. No production code touched. Now 13/13 passing — removed from
this stale list.**

Reconcile remaining stale expectations vs code in a dedicated pass.

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
- **Watch list, no action (GrailKey Dispatch 21, 2026-08-07): title-family fragmentation.** `selectTitleFamilyCandidate` splitting genuinely on-topic listings into sibling sub-families instead of merging them — found in 4/9 scans during the commit-p rank-slot investigation, but all 4 are the same single book (Spawn #351) in an already-non-diverse sample. Not scoped, not investigated further — one book at nine repeats isn't evidence of a general pattern. Flag if this shape appears on an unrelated book. Full detail: Pattern Library, "GrailKey Dispatch 21."
- **Structured KV scan-logging — SHIPPED (GrailKey Dispatch 22, 2026-08-07), plan from Dispatch 21.** Every scan now writes a compact, versioned record (`src/lib/scanLog.js`, `SCAN_LOG_VERSION=1`) to `scanlog:v1:<ts>:<id>` plus a sorted-set time index (`scanlog:index:v1`, `kvZAdd`, `api/kv-cache.js`) — 90-day TTL (`KV_TTL.SCANLOG`), graceful-degradation write (never blocks or fails a real scan response, matches `kvGet`/`kvSet`'s existing contract). Two decisions made without waiting on volume data: log every scan (a narrow log recreates the exact problem this exists to fix), and use the sorted-set index rather than Redis Streams (uses only primitives already proven against this project's Upstash instance; Streams recorded as the upgrade path if write volume ever grows enough to matter). Query via `scripts/query-scanlog.mjs` (local, talks directly to Upstash, no new Vercel function). Full detail: Pattern Library, "GrailKey Dispatch 22."
- **Corrected (2026-08-07, GrailKey Dispatch 18) — was "Future: Vercel KV for cross-instance rate limit persistence."** Two different things were conflated in that one line. The general-purpose KV cache (Upstash Redis, `api/kv-cache.js`) has been live since 2026-06-29 — not future, see Stack and Environment Variables above. What genuinely IS still future: `api/rate-limit.js` uses its own separate in-memory `Map` (`const requests = new Map()`, per-instance, reset on cold start), never reads or writes the KV cache at all — rate-limit state is still not cross-instance-persistent. Remaining open item, narrowed to what's actually true: migrate `api/rate-limit.js` onto the KV cache that already exists for everything else.
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
**Descriptive names, not letters. Listed in approximate order of discovery. Full writeups: `docs/PATTERN-LIBRARY.md`. Rule going forward: a new finding gets one line here + this pointer — the full writeup goes in the Pattern Library file, not inline in CLAUDE.md (CLAUDE.md hit the 150k-char load limit 2026-08-07, GrailKey Dispatch 16, from entries running 100+ lines each).**

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
- **Renumbered-franchise title/issue collision class** (ASM #17, Action Comics #33) — modern relaunch/anthology reprint shares exact title+issue# with a scarce vintage original; no source-level fix exists (investigated exhaustively), mitigated at price-band Tier 2 sold-anchor fallback.
- **Distinctive-artist-style confusion class** (Uncanny X-Men #27 / Ultimate X-Men #1, Peach Momoko) — Vision and eBay both misread title off a distinctive artist's style, not a real title signal; TPB-pool fix shipped but confirmed insufficient for this case, no further mitigation identified.
- **Variant-artist token fusion class** (Black Cat #1, Skottie Young) — title-family clustering fused a widely-shared variant-artist token into the confirmed title; fixed by stripping `ARTIST_PATTERNS` before tokenizing in `tokenizeTitleFamily`.
- **Intake-vs-listing gate class** (Walking Dead #109 / Siege #3 / Edge of Spider-Verse, Q110) — three hard-blocking intake flags nulled price/comps even with real data underneath; reclassified to `listingHardLocked` (price stays visible, only the List button gates).
- **Generic-descriptor variant-match class** (Venomverse #1, Q111) — variant isolation matched on one generic finish token ("foil") alone, pooling different products; fixed via `classifyVariantTokens` (specific vs. generic) + AND-match in Filter 1c.
- **Batman #608 class, five stacked bugs** (Q112–Q115) — ComicVine volume-year leak, sold-verification reason-count math bug, contradictory sold-data labeling, over-broad `variantMismatch` (attempted fix reverted, needs a phrase-context signal not yet designed), visual-pool contamination corrupting variant/year backfill (fixed via `filterItemsByIssue`).
- **Incredible Hulk #377 class, printing/edition not tracked** (Q116) — printing (1st/2nd/3rd/facsimile) wasn't a variant category anywhere; added `classifySpecificPrinting` + threaded into `confirmedVariant`/`PRINTING_PATTERNS`; manual "Printing" dropdown queued, not built.
- **Catwoman #64 Szerdy-variant class** (Q127) — same title/same issue#/different year; `filterItemsByIssue` is a no-op against it; fixed via pool-level `detectVariantPoolYearConflict` (>5y `poolYearHint` vs. `confirmedYear` drift suppresses the variant).
- **Drifted-duplicate-constant class, 3rd instance: year-tolerance** (Q128) — active-pool and sold-pool year tolerances had silently diverged despite a comment claiming they matched; consolidated into shared `getEraYearTolerance`/`evaluateEraYearMatch` in `compHygiene.js`.
- **Back-issue comps often cite a series' volume-launch year, not the issue's own cover date** (Q128, Harley Quinn #62) — domain fact, not a bug; encoded as `isVolumeLabelYear` (±1y of the book's own ComicVine volume start year is legitimate).
- **Correct-rejection silent-substitution class** (Q129, Harley Quinn #62 Cover C) — era-filter correctly rejected every current listing of the specific variant (none for sale right now), so pricing silently fell back to generic Main Cover comps; flagged via `variantCompsExcludedByEra` + a new RESEARCH warning.
- **Bone #1 class** (GK Dispatch 05/06/09/10/11) — Strip 1 title-routing validated in production; GK-34 (mirror of GK-21) let a single sold comp override 18 actives, fixed with a shared `MIN_POOL_FOR_OVERRIDE=3` floor; drove a multi-round `ARTIST_PATTERNS` registry audit (9 creator-name gaps found/fixed) and a `TIER_SOURCE_MAP` completeness test.
- **Dormant-multiplier class** (GK Dispatch 12–14) — tier-engine (comp-verified) prices were excluded from key/newsstand multipliers while the least-verified `pc_estimate` tier got both; newsstand mult extended to tier-engine sources and shipped, key mult held pending recalibration (1.5× overshot the PC ladder rung by 65% on the one book tested).
- **GrailKey Dispatch 15** (2026-08-07) — `titleOk` bar lowered 0.30→0.15 (shipped), vision-zero-support ratio floor replacing exact-zero check (shipped), 3 creator-registry additions (shipped), issue-adoption margin for the zero-support override (designed, not coded — pending margin validation), category-vote override for the advisory asset-type lock (designed, not coded — pending a captured Vision JSON), pool-year-hint feeding `resolveYear` (designed, not coded — bar set 2026-08-07 Dispatch 16), cover-matcher GCD/ComicVine feasibility (investigated, plan only).
- **GrailKey Dispatch 16** (2026-08-07) — CLAUDE.md split (193k→76k chars, Pattern Library extracted to `docs/PATTERN-LIBRARY.md`, this size limit made a standing constraint above); pool-year-hint bar set to 0.75, not 0.80 (design closed, still not coded); issue-adoption margin gate validated against production logs — Spawn #369 confirms the must-fail case, Tomb of Dracula #17 confirmed vacuous for this branch, no natural must-pass anchor found in 3 days of logs (still blocked, not coded); GCD terms unreachable through every path tried — domain-wide 403, cover-matcher stays gated.
- **GrailKey Dispatch 17** (2026-08-07) — GCD App Guidelines terms obtained via an external channel (superseding Dispatch 16's "blocked" finding; recorded with an explicit verbatim-vs-reported caveat, full verbatim page text still outstanding). Cover-matcher re-scoped, still plan-only: no GCD API exists (DB-dump import + own query layer + refresh cadence required, not a live-query integration); images permitted only under a fetch-on-demand-and-archive pattern, not bulk retrieval (invalidates the original bulk-hash spike idea); CC-BY-SA attribution is a hard UI requirement on any GCD-sourced card data. Net: materially larger scope than originally estimated — three separate infra pieces needing their own scoping before any code.
- **GrailKey Dispatch 18** (2026-08-07) — KV drift reconciled: Stack section corrected (Upstash Redis via `api/kv-cache.js` has been live since 2026-06-29, not "no server database"), `KV_REST_API_URL`/`KV_REST_API_TOKEN` added to Environment Variables, the stale "Future: Vercel KV for rate limiting" item narrowed to what's actually still true (`api/rate-limit.js` stays in-memory, never touches the KV that already exists for everything else). Found and flagged, not fixed: `api/` actually has 14 files, not the 12 the function-cap section describes (`kv-cache.js`/`rate-limit.js` missing from that list) — current real cap unverified, do not trust "12/12, adding will fail deploy" until checked directly. Vercel Blob question sharpened in the Pattern Library cover-matcher entry: caching to your own back-end (GCD's actual described pattern) vs. re-hosting in a third-party blob store may not be the same act under their terms — treat as unresolved, private access only if/when built, do not provision until reviewed. Full App Guidelines text still not received — pending a resend.
- **GrailKey Dispatch 19** (2026-08-07) — one real production scan (Spawn #351, 20:40:36 UTC), four findings. Fix 6 SHIPPED, corrected from the Dispatch 15/16 design (`rescueYearFromVisionFallback`, reads the family-scoped adopted year, never `poolYearHint` — see the "Year override guard" section above). Fix 5 SHIPPED (`shouldLiftAssetTypeAdvisoryLock`) — the null-vs-stale-issue question that blocked it since Dispatch 15 is answered (null, confirmed). Vision confidence string leak traced and fixed (prompt gap in `STANDARD_PROMPT`/`WATCH_PROMPT` + zero validation across 3 independently-drifted `api/enrich.js` call sites, all now routed through a validating `normalizeVisionConfidence`). commit-p near-miss INVESTIGATED, report only, no code — `HIGH_CONFIDENCE_WEIGHT_FLOOR=12` missed by one point (weightSum=11) purely because an irrelevant lot listing occupied a top-3 eBay search-rank slot; reported for a greenlight decision, not fixed. 59 new regression assertions across 3 test files.
- **GrailKey Dispatch 20** (2026-08-07) — three follow-ups. Fix 6's Dispatch 15/16 spec error recorded as a standing "misattributed-anchor class" note (not just corrected in Dispatch 19) — a citation that "looks like" a named signal isn't evidence it IS that signal; trace every log-line citation to its literal source before building on it. Fix 5's decline path now logs a `blockedBy` reason breakdown (was already logging both branches, enhanced for future batch analysis of whether it ever fires). commit-p rank-slot theft INVESTIGATED (9 production scans fully verified, `HIGH_CONFIDENCE_WEIGHT_FLOOR` left untouched as instructed) — the specific "junk listing steals a top-3 slot" mechanism confirmed in only 1 of 9 scans; a DIFFERENT, more frequent mechanism (title-family fragmentation splitting real listings into sibling sub-families) caused 4 of 9 — two symptomatically-identical near-misses turned out to have different root causes on direct re-verification. Sample dominated by repeat scans of one book — ledger-wide frequency remains genuinely unanswered.
- **GrailKey Dispatch 21** (2026-08-07) — title-family fragmentation added to a watch list, no action, deliberately not scoped (one book at nine repeats isn't a pattern). Structured KV scan-logging investigated as a fix for a now-standing tooling gap — two frequency questions this session (GK-34 stale-threshold, commit-p rank-slot) both died on the same wide-window runtime-log timeout. Plan only, no code: one compact versioned record per scan written to the already-provisioned Upstash KV, queryable by direct range read instead of log-content scanning. Storage primitive (Streams vs. sorted-set index), volume/cost, retention, and every-scan-vs-interesting-only scope are open questions.
- **GrailKey Dispatch 22** (2026-08-07) — structured KV scan-logging SHIPPED, greenlit with two decisions made without waiting on data: log every scan (volume is ~60/week, not a real constraint at this scale), sorted-set index instead of Streams (removes the one named blocker, Streams kept as the documented upgrade path). `src/lib/scanLog.js` (pure record/key builders), `kvZAdd` added to `api/kv-cache.js`, write site in `api/enrich.js` right after `out.decision` is computed, local query script (`scripts/query-scanlog.mjs`). 26 new regression assertions; full regression sweep (3 prior suites + all Dispatch 19/20 test files) confirmed clean.
- **GrailKey Dispatch 23** (2026-08-07, session close) — `api/` function cap RESOLVED: this project is on Pro or higher, not Hobby, no function-count cap exists (confirmed against current Vercel docs — Hobby's cap is genuinely still 12 for a non-Next.js/SvelteKit framework, but this project's live deployment runs 14, which only Pro/Enterprise's "no limit" tier permits — see Architecture section). Recorded the three questions the scan-log instrumentation exists to answer (Fix 5 fire rate, commit-p frequency/mechanism across books, titleOk/ratio-floor hit rates) next to the Dispatch 22 entry, with a note that question 3 needs a v2 schema field not yet collected — revisit after ~2 weeks of accumulated records.
- **GrailKey Dispatch 24** (2026-08-07) — 13 commits pushed to `origin/main` (`b926dba`), auto-deploy triggered. Recorded that the Vision confidence string leak (Dispatch 19) is intermittent, not deterministic — a same-build, same-code re-scan produced a well-formed `"Low"` instead of the original bad sentence. Does not weaken the fix; means future verification should rely on the unit test and the validator's own log staying silent, not on reproducing the literal string on demand. Post-push re-scan of the same book pending, to validate Fix 6/ratio-floor/scan-logging together — awaiting the log.
- **GrailKey Dispatch 25** (2026-08-07) — unanimous-consensus identity unblock. Fix 1 STEP 1 SHIPPED (`b2c7358`). Fix 2/2b (unanimous-consensus promotion of `issueAuthority.status`, both axes, plus V4 safety closure) SHIPPED (`81ca1d2`, docs `1d4c125`, deployment `dpl_BrTYfCD59XBq7XMrCfjSPo649PQm` verified READY by ID). Fix 2c (Batman #213 class — a title-family WEIGHT-margin near-miss was reported as an ISSUE-authority conflict) went through two review-caught corrections before shipping: first a `.issue`-vs-adoption-floor bug (caught in test authoring), then a `.winner`-vs-plurality bug (caught in review before push — a family with 2/3 rows agreeing and 1 genuinely dissenting would have wrongly read as "agreement"). Final predicate requires UNANIMITY via `.assertedIssues` (distinct set, size exactly 1, both families match) — 60 assertions, full regression sweep individually verified against a clean `bf543d6` worktree per suite (not summarized), **HELD FOR PUSH APPROVAL — not yet committed/pushed.** See `docs/PATTERN-LIBRARY.md` for full predicates. The `confirmedPublisher` investigation was corrected too (initial 11/19 DC-title count was a misread of an unrelated log figure; real counts 3/19 exact-phrase / 7/19 any-form both fail the 0.5 backfill floor regardless — publisher on this book resolves only via the CV/PC path Fix 2c unblocks). Fix 3 (Vision virgin-variant prompt) remains HELD. GK-35 (PRICING_GATE_CODES gap), GK-36 (`[ship11]` visual-pool-fallback median not grade-scoped), and GK-37 (`PUBLISHER_CONSENSUS_PATTERNS` no bare-word fallback for major publishers, confirmed not the cause here) remain open, log only.
- **GrailKey Dispatch 32** (2026-08-08) — batch review of 47 real scans. STEP A retracted 2 defects (review-discipline note: partial log excerpts read without their reconciling line — same failure mode as the earlier key-multiplier retraction), downgraded 1 to log-only. **32-C SHIPPED** (`37f458f`) — `pcProductId`/convergence OR-arm for `visionLowButCorroborated`, additive `scanLog` v2 fields, `query-scanlog.mjs` index-key fix. **Coherent-content-token lane DELETED + co-title `visual_pool_top3` gated off — SHIPPED**, following a real-corpus hit-rate audit of both mechanisms (0/15 and 0/1 beneficial respectively) rather than assumption; replaced by a standalone typed event/imprint routing mechanism (CLASSIFICATION IS NOT AUTHORITY — a known-phrase match still requires family-scoped corroboration before routing to variant); Atom Eve pre-Q140 control test restored verbatim; 15-case corpus frozen as a permanent deterministic regression suite (`tests/grailkey-dispatch-32-frozen-corpus.test.js`) — see Pattern Library for the full corpus-role breakdown (~8 actual-harm books vs. 4 already-self-correcting vs. controls), the corrected (narrow) 3x-margin finding, and the "reusable verbatim" correction on the post-catalog title-finalization architecture project (named, scoped, not started). **32-B still HELD** pending live `[sold-verify]` log verification for Marvel Team-Up #141. Multi-book lot titles (Defect 8) confirmed to have no identity-level detection anywhere in the pipeline — logged, unscoped.
- **GrailKey Dispatch 33** (2026-08-08) — Architecture v1.0 Week 1, instrumentation and contracts only, zero behavior change. Step 0: zero eBay legacy-Product-API call sites, decommission date confirmed 2026-08-15. Two standing invariants recorded (Monotonic Evidence Extension, No Self-Corroboration). `src/lib/evidenceContracts.js` shipped (EvidenceEnvelope/SourcePolicy/barcode-ladder, unconsumed). `src/lib/scanLog.js` gained additive correlationId/latency/identity/cost/evidence/sources/barcode fields (two documented cross-request gaps: vision latency and condition cost live in api/grade.js, a separate request from the scanLog write site). `src/lib/anthropicPricing.js` shipped with verified live pricing. Fix 4/4b reachability traced (not proven unreachable). Certification metric and parity-harness stub (0 cases, ships before any shadow lane) recorded as standing gates. Full detail: Pattern Library.
- **GrailKey Dispatch 34** (2026-08-08) — ledger consolidation from two real production scans (Hero for Hire, Spawn #351). Third standing invariant recorded: **Rejection must not create authority** (Hero for Hire's ComicVine fail-open — all 12 year-gate candidates rejected, population restored, a rejected candidate then selected — is the direct violation; no fix this dispatch). `22c` word-order counterexample recorded (same token set, different order, no injection — word-order alone must not make `22c` terminal). Condition-evidence overreach priority elevated (front-only photo, but report asserts interior/back-cover condition). Virgin/sketch variant class status corrected: Spawn #351 is a real post-fix production PASS, not part of a still-`UNSOLVED` class. Fix 4 synthetic-fixture scoping recorded (mechanism PASS ≠ production reachability). **Step 1 SHIPPED** (`9eb4601`) — the `phase2_start` timing-key collision (two colliding `mark()` calls corrupting phase-level timing) resolved via pure rename, zero control-flow change, all 8 documented-baseline suites unchanged. Full detail: Pattern Library. Next: 10-15 heterogeneous production batch, then frequency-ranked aggregation.
- **GrailKey Dispatch 37** (2026-08-09) — cache-key correction round, 3 commits SHIPPED (`c11346c` static-prefix HTTP-400 fix, `913cb46` active-comp fingerprint P0 — 7 previously-unkeyed filter inputs, `c8a9c71` ComicVine cache identity P1 — dead variant segment removed, year/`poolYearHint` keyed on `Boolean(comicYear)` not `== null`), each verified in isolation, no new regression against documented baseline. Fourth standing invariant: **cache correctness is authority correctness**. Derived rule: **key on the predicate, never a proxy for it** — the `comicYear == null` vs. `Boolean(comicYear)` divergence on `NaN` (from `parseInt("Unknown")`) is the concrete instance. Tracked debt: `buildFilterContextFingerprint`'s duplicated grade/year normalization is a 4th instance of the Drifted-duplicate-constant class (Q119/Q127/Q128) — flagged, not remediated. 14-broker architecture memo rejected in full except the four-layer authority distinction + ledger-as-forward-design-target (reasoning: this dispatch's own single cache key was missing 7 dependencies — 14 new broker surfaces multiplies that risk, not reduces it). GCD "no API" corroborated by a second, reported-not-verified source. Bone and Fix 4 remain blocked. Full detail: Pattern Library.
- **GrailKey Dispatch 38** (2026-08-09) — post-deploy 13-book batch against `6f17f63`, record only, no code shipped. Third axis of **Rejection must not create authority** (Dispatch 34): the mega-key floor can re-authorize a full price after the market-evidence path feeding it was already assessed structurally weak (Bone live: `tier=2 soldPool=1 activePool=2` → LIST_NOW-class) — same shape as the ComicVine fail-open and variant fallback, one invariant, three axes. **Correction: Dispatch 36's fingerprint fix does not fix Bone** — it corrects cache identity only; Bone's $800 shipped price traces through the mega-key-floor axis, a fix Dispatch 36 never touched, so the blast-radius report (still KV-blocked) must trace the full path, not just the cache key. Cache-fingerprint certification partial: fingerprint deployed and writing distinct keys, but all `ac:v10` lookups MISS (expected — v9→v10 orphaning, HIT path unproven) and the one real two-grade Bone comparison has an uncontrolled title-casing confound, so grade isn't yet isolated as the sole cause of its 2-vs-22-comp pool difference; A/B/C certification protocol (same book/grade twice → HIT; same book/different grade/same casing → MISS + grade-proximity rerun) still to run. Grade-proximity rejection and conflicted-identity refuse-to-cache both confirmed working correctly in the batch. New anomaly flagged (Marvel Age #1000, no `[decision]` line, 2nd occurrence) — not investigated. Full detail: Pattern Library.
- **GrailKey Dispatch 39** (2026-08-09) — record only, no code. KV access path corrected: `vercel env pull` returns deterministic empty strings for `KV_REST_API_URL`/`TOKEN`/etc. (Sensitive-type vars, write-only by Vercel design — do not retry that path); read-only token instead sourced directly from the Upstash console. New architectural debt named: **pricing auditability gap** — durable scanLog has no active/sold-pool or pricing-branch fields, and the one place that data exists (`ac:v10:*`, `KV_TTL.ACTIVE=3600`) expires in an hour, so a past shipped price cannot be reconstructed from durable telemetry alone. Direct consequence: the Dispatch 38 batch's comp pools are gone — Bone dataset must be recollected (protocol specified: fresh scan → retrieve `ac:v10` before TTL expiry → sanitized frozen local fixture → predicate implemented and replayed offline against every book, not just Bone → only then a production proposal, still under the pricing-math greenlight protocol). A/B/C certification status corrected: not KV-blocked at all, only needs runtime traces — three Batman #213 scans in progress. Everything else held. Full detail: Pattern Library.
- **GrailKey Dispatch 40** (2026-08-09) — **Gate 2 (A/B/C cache certification): CLOSED, PASSED**, stronger than specified. B (19:20) HIT the exact key A (19:15) wrote, retrieving A's exact 17-comp pool, with C (a different-grade scan) sandwiched between them without contaminating A's entry — the Hero for Hire cross-request class proven impossible, not merely absent. New finding, record only: **decision-layer non-determinism** — A and B share identical fingerprint/cached pool/price ($19.24) yet flipped `decision.action` (RESEARCH↔LIST_NOW, warnings 1↔0). Code-grounded hypothesis (not confirmed against live logs for these exact requests): `allConflicts` recomputes fresh every request from an uncached, live-per-scan eBay identity search, and AI verify (a live non-deterministic Claude call) filters the cache-HIT pool downstream of the pricing cache boundary — either can flip a `criticalWarnings` slug (likely `vision-confidence-overridden`, `issue-consensus-conflict`, or an AI-verify-downstream slug) without moving price. Not narrowed further without the actual `decision.warnings`/`[ship28b-conflicts]` log line — confirming evidence deliberately left uncaptured pending a future scan rather than guessed now. **Architectural framing: the certified cache boundary sits below two uncached non-deterministic inputs (live eBay identity search, Vision itself) — deterministic pricing does not imply deterministic routing, and no amount of cache correctness changes that; a ceiling on this design, not a defect from this series' commits.** Bone reconfirmed unchanged, more precisely: `tier2_active_dominant_thin_sold` → $19.33 → mega-key-floor → $800 → `LIST_LOW`. Gate 1 (Upstash token) remains the only blocker on Bone recollection. Full detail: Pattern Library.
- **GrailKey Dispatch 41** (2026-08-09) — **Gate 1 CLOSED**: read-only Upstash access confirmed working (`dbsize: 330`, real keys returned matching Dispatch 40's certified data), no credential value ever printed/logged. Both certification gates now closed. **Marvel Age #1000 settled**: both reported occurrences have durable scanlog records with `terminalReason: null` and healthy identity resolution — first concrete case of the ledger resolving a runtime-log ambiguity (the missing `[decision]` line was a log-surfacing gap, not a backend failure to terminate); limitation noted: the ledger proves decision computation happened but has no `decision.action`/price/branch field, a second instance of the pricing auditability gap. **New, more severe instance of that same gap, found before Bone scanning started rather than at replay time**: the sold pool is not durably cached at ANY TTL, in verified or raw form — `fetchPricechartingSales` re-parses fresh from a 7-day HTML cache every call, and the pricing-consumed verified sold set (`out.soldComps` et al.) is never persisted anywhere; only the active pool (`ac:v10`) is KV-retrievable at all, and only for its 1-hour TTL. Fixture contract's sold/output-baseline sections must come from the live `/api/enrich` response itself, not KV, no matter how fast the read. Recollection tooling built and tested against live data: `scripts/watch-active-cache-ttl.mjs`, `scripts/capture-active-cache-entry.mjs` (writes to new gitignored `dispatch39-fixtures/`). New batch requirement: capture one other naturally-occurring mega-key-floor book alongside Bone, not manufactured — one instance can't distinguish "floor wrong for Bone" from "floor wrong generally." Holding for go-ahead to scan. Full detail: Pattern Library.
- **GrailKey Dispatch 42** (2026-08-09) — checked, before scanning, whether the structured response carries `[price-bands] source` cleanly. It does — but mega-key-floor firing (Bone's exact case) rebuilds `out.priceBands.source` to the literal `'mega-key-floor'`, losing the original tier-2 branch name; a coarser fallback (`preFloorSource`, mapped via `TIER_SOURCE_MAP`) survives in IndexedDB but isn't unique alone. **Found the actually-correct field**: `out.priceDerivationTrace` is built before the floor block, never touched by it, preserves the original branch label (`'active_dominant_thin_sold_discount'` for Bone) intact, and carries the **raw per-comp sold/active price arrays** as `inputValue` on its trace steps. **It is not persisted to IndexedDB at all** — zero references anywhere in `src/App.jsx`'s five merge paths, confirmed by grep — a fourth, most-surprising instance of the pricing auditability gap (even the client's own catalogue drops the server's richest diagnostic field). Preflight target corrected before any scanning: capture the raw `/api/enrich` HTTP response body directly (Network-tab copy or direct script output), not an IndexedDB export — strictly a superset. One live control-book scan against this corrected target still outstanding before the 11-15-book batch. Full detail: Pattern Library.
- **GrailKey Dispatch 43** (2026-08-09) — bulk request cardinality proven from source (not console labels): `handleBulkImport` (`src/App.jsx:11110-11290`) fires one independent `/api/enrich` request per book from its `CONCURRENCY=3` worker pool, no batched/multi-book endpoint exists — Network-tab per-book capture works unchanged for bulk scans. Deterministic fixture pipeline built and tested end-to-end against live KV data, both success and failure paths: `scripts/ingest-fixture-response.mjs` (directory layout `<NN>-<title-slug>-<issue>__<trace8>`, `trace8` from `pipelineAudit.traceId`), `scripts/capture-active-cache-entry.mjs --dir` (disambiguates multiple same-title/issue KV candidates via `activeCached.count`, refuses to guess if still ambiguous), `scripts/merge-fixture.mjs` (produces `fixture.json` only — **required custody check**: `response.activeCached.count` must equal the captured KV entry's own count, or it refuses to write anything, verified to fail loudly on a deliberately mismatched test). New gap found while building the merge script: `numericTarget`/`isGraded`/`signedConsensus` are local-only variables, never assigned onto `out` anywhere (confirmed by grep) — not recoverable from the response at all; falls back to an optional `request.json` capture (Network-tab "Copy request payload"). Ready for the batch; live `hero for hire luke cage|1` KV entries currently up (39min TTL as of this dispatch) flagged as a possible real preflight capture opportunity, not a blocker. Full detail: Pattern Library.
- **GrailKey Dispatch 44** (2026-08-09) — mega-key floor root cause confirmed against the actual card, not left at candidates: Bone scanned as `Bonnier Carlsen · 1991`, which cannot normalize to the table's required `publisher: "image"` — `passesIdentityGates` hard-rejects, `getMegaKeyEntry` returns `null`, the whole floor block skips silently with no log line at any stage, matching the observed symptom exactly. Active-pool-composition hypothesis withdrawn — confirmed to play no role in the gate at all. **Fifth standing invariant: authority must be use-consistent** — a source rejected as incompatible on an identity axis (ComicVine judging `Bonnier Carlsen` publisher-incompatible) cannot simultaneously establish that same axis for a downstream economic decision (that same value surviving as `confirmedPublisher` and gating mega-key eligibility); distinct from Rejection Must Not Create Authority (that's about restoring rejected evidence after a pool empties, this is about one value being both disqualifying and authoritative to two different consumers at once) — generalizes the older, narrower "mega-key protection defeated by a publisher mismatch" finding. **Bone reframed as two distinct, independently real failure modes**: historical (thin evidence → $19.33 → floor amplifies → $800) and current (ComicVine publisher-authority leak silently disables the floor entirely, but thin/suspect evidence still ships as authoritative $19.33 LIST_LOW on its own). Batch unblocked — the $800 reproduction was never a hard requirement; the current scan's defect is sufficient by itself. Capture of this scan (response.json/request.json) still pending, not yet received. Full detail: Pattern Library.
- **Dispatch 42-I** (2026-08-10) — SAFE-KILL certified, Task 6 Identity closed. Capture 2 (Batman #213, `cv_1786144793823_j1lx5j`) ran 7/7 PASS by hand against a real production record. `9ca0b9a`/`544fb7d`/`cf96d1b` pushed to `origin/main`; deploy `dpl_97m8pmcLzuC6M3Zx1ySDW96rKvm4` confirmed READY/production at `githubCommitSha cf96d1b6f4c397bb9aca38fcecb7b2873f709dc8`, live on `comic-vault-rouge.vercel.app`. GK-50/51/52/53/54/56/57 logged, explicitly NOT investigated or fixed this dispatch — GK-55 shipped same push (see `cf96d1b` commit). Full detail: Pattern Library.
- **Dispatch 45** (2026-08-10) — GK-39 confidence-provenance trace, no code. `identityAlignment.authenticationScore`/`breakdown` proven to be hardcoded constants (`api/enrich.js:4319-4338`, two-branch literal keyed on one boolean), not a computation — `breakdown.year: 85` is written unconditionally, unrelated to whether `confirmedYear` is null. The real scorer (`alignIdentity()`, `src/lib/identityAlignment.js`) is proven dead (zero call sites outside tests) — it ran one day in production (2026-04-30 → 2026-05-01, `44cf43b` → `0234ea2`) before an architecture refactor replaced its call site with the hardcoded placeholder, under the same comment. Split into four numbered defects, deliberately not merged: **GK-39** (the fabricated constants), **GK-62** (a manual value self-corroborating inside the REAL `convergence` scorer's vision slot — live, fires today), **GK-65** (`identityAlignment` never persisted to IndexedDB — the Ship #24 listing gate at `App.jsx:7506` is structurally unreachable once a book is saved; renumbered from GK-63 in Dispatch 46B so GK-62 stays unique to the vision-provenance fix), **GK-64** (`identityAlignment` is a stale Phase-2 snapshot vs. the terminal `out.confirmedYear`, unmarked). Full detail: Pattern Library.
- **Dispatch 46 + 46B** (2026-08-10) — **GK-62 implemented and pushed.** `convergenceSources`' vision slot (`api/enrich.js`, was `:4141-4185`) no longer reads `effectiveTitle`/`Issue`/`Year`/`Publisher` — four new `rawVisionX` consts (`visionWasSkipped = manualIdentity===true || manualCorrectionRequest?.valid===true`) null the vision slot whenever Vision was actually skipped, leaving `src/lib/convergenceScore.js` (untouched, re-verified byte-identical) to score real eBay/PC/CV agreement only. Manual-source-class decision: **excluded** from automated convergence entirely (the only shape available without touching the forbidden `SOURCE_WEIGHTS` table). **46B traced whether field-level exclusion (only the corrected axis, not all four) was possible instead** — `manualCorrectionRequest.validation.acceptedFields` does name which fields were corrected, but the uncorrected fields' values trace to `item.X` (the catalogue's current value, of unknown origin — Vision, eBay, PC, CV, or a prior correction, untagged), not a verified this-request Vision reading; a real fixture proved the cost (an untouched, Vision-only publisher axis dropped MEDIUM→LOW as a side effect of an unrelated issue-number fix) but confirmed field-level exclusion isn't safely buildable with what's actually tracked today — **all-or-nothing stands, decided and logged, not implemented differently.** Frozen-corpus proof: manual scans drop 100→0, 67→0, 100→75 (never up); camera scans unchanged (100→100). 28/28 new assertions (`tests/grailkey-dispatch-46-gk62-vision-provenance.test.js`), full sweep 154/16/3/0. Two standing invariants recorded: **a safety gate must not disappear because an asset crossed a persistence boundary** (GK-65) and **a value must not vote for itself** (GK-62). Full detail: Pattern Library.
- **Dispatch 47** (2026-08-10) — **GK-39A SHIPPED.** `authenticationScore`/`breakdown`/`confidence`/`needsReview` deleted from both `identityAlignment` construction sites in `api/enrich.js` — no replacement number. `confirmedTitle`/`Issue`/`Year`/`Source`/`overrodeVision`/`conflicts` kept (GK-64's staleness is separate, not worked). Both render surfaces removed (`App.jsx` ResultCard badge + CollectionDetail dot/tier/breakdown); `conflicts` rendering kept, re-gated on its own presence since it was previously nested inside the now-gone badge's wrapper. **Listing gate at `App.jsx:7506` removed outright, not fail-safed** — decided and stated before implementing: the field it read no longer exists, so leaving the check in place would mean dead code masquerading as a live safety gate (same disease as the fabricated score itself); deleted both the read site and its only write site (`authenticationConfirmed`) so nothing is left one-sided. Gate had never fired in production regardless (65/90 against a <80 bar). `alignIdentity()` still dead, `convergenceScore.js` byte-identical, `decisionEngine.js` proven to have zero references to either field — confirmed both by absence-check and by a direct `computeDecision()` before/after fixture producing identical `action`/`blockers`/`warnings`. 46/46 new assertions (`tests/grailkey-dispatch-47-gk39a-remove-fabricated-confidence.test.js`), full sweep 155/16/3/0 (154 expected +1 new file), byte-identical FAIL/TIMEOUT lists. `npm run build` clean. Next queued: PriceCharting-ladder passthrough mislabeled as a computed grade curve — same "UI claims to know something it doesn't" class, scoped together, not started. Full detail: Pattern Library.
- **Dispatch 48 + 50** (2026-08-10) — pricing-truth trace + fix, renumbered from collision-prone draft labels (GK-38/41/42 collided with existing Dispatch 26 defects) to **GK-66 SHIPPED** (ladder passthrough + `HOLD_FOR_CGC` decision authority removed from `decisionEngine.js` — the ladder is display-only now, no server-side quality heuristic added), **GK-67 SHIPPED** (`blendedAvg` 60/40 "Blend" line removed from the price-derivation panel; `blendedAvg`'s own computation untouched), **GK-68** (Quick band never floor-checked — **decided B: no displayed recommendation may contradict a displayed floor**, per GrailKey Operator Mode Hold 2026-08-10; enacted by suppressing bands from the customer deliverable, not by code — the underlying floor gap is backlogged against band re-enablement), **GK-69** (pricing-derivation custody gap: `priceDerivationTrace`/`blendedAvg` never persist, `priceLadder` does — logged only, not fixed). Fold-in: source labels on both `pricingSource` and `priceBands.source` (the latter found to be fully dead code pre-fix — compared against strings that field can never contain) now truthful, never default to "estimated"/"AI estimate"; `"~ Similar N"` → `"Match quality: N/100"`; both PRICE LADDER panels now say "Source: PriceCharting, unedited." 55/55 new assertions across two test files, baseline 157/16/3/0, zero regressions. See Pattern Library for full detail.
- **GrailKey — Operator Mode Hold** (2026-08-10) — **`1aa6eb0` is the operating baseline; engineering dispatches paused.** No pricing/identity/convergence/routing/persistence/UI/provider work without a new dispatch. Workflow shifted to SCAN → REVIEW → CUSTOMER OUTPUT → CORRECTION/OUTCOME LOG; customer deliverable narrowed to identity/condition/verified comp evidence/one manually reviewed estimate — price ladder, bands, derivation panel, exit strategy, and auth/per-field percentages suppressed from it operationally, not via a code change this turn. Reopen triggers: immediate (wrong identity presented as safe, wrong-book comps in pricing, an unexplainable price, any customer-deliverable falsehood, data loss, a non-completing scan) vs. backlog (everything else, including GK-69 and remaining internal/test/provenance items). Full detail: Pattern Library.
- **GrailKey Directive 2026-08-11-A** (investigation only, no code) — confirmed GK-38/GK-42 as freshly reported were the already-shipped GK-66/GK-67 under stale draft numbers; found a broader ComicVine fail-open than previously logged (3 gates, not 1 — became GK-70/71 territory below); sized an IndexedDB provenance retrofit as INVASIVE (8 real merge sites, not the 5 documented); ran a full-history secret audit (clean, 1,039 commits). Full detail: Pattern Library.
- **GrailKey Directive 2026-08-11-B** (explicit exception to the Operator Mode Hold, Jimmy-authorized) — `docs/TICKET-REGISTRY.md` created (greppable GK-N ticket ledger + alias rule, closes the stale-label-rediscovery problem Directive A hit); **GK-71 SHIPPED** — all three ComicVine identity gates (year-strict, token, publisher) stop restoring the rejected candidate set when their filter empties it (`candidates.length = 0` instead), generalizing "Rejection Must Not Create Authority" past the single instance previously logged; **GK-72 SHIPPED** — eBay outage (missing credentials/no title/thrown fetch error) is no longer indistinguishable from a genuine zero-listing search: `emptyComps()` classifies `unavailable` at the source, `out.ebaySourceUnavailable`/`Reason` surface unconditionally (not just on the refuse-to-price path — closes the "silently ships a priced result off a degraded pool" gap directly), `decisionEngine.js` escalates a new critical warning to RESEARCH. **GK-70 found and deliberately deferred** — a 4th instance of the same resurrect-rejected-evidence shape in `api/comps.js:1803` (eBay grade-proximity comp filter), left untouched since closing it would change which comps enter price computation. Full detail: Pattern Library.

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

### Internal — under investigation
- **RESOLVED (2026-08-07, GrailKey Dispatch 23) — the `api/` 14-vs-12 gap flagged in Dispatch 18.** See the Architecture section's "Vercel function cap" line for the full resolution: this project is on Pro or higher, not Hobby, and there is no function-count cap. Kept here as a pointer since this is where the original open question was recorded.
- **`cv-lang-gate` passes foreign volumes through while reporting a filter
  (found 2026-08-07, GrailKey Dispatch 05, Jetsons #10 class) — logged
  only, NOT fixed.** `api/enrich.js:728-742` filters ComicVine volume
  candidates by testing `vol.name` (the volume's own title string) against
  a literal language-keyword regex
  (`/\b(german|deutsch|french|français|spanish|español|italian|italiano)\b/i`).
  A real production scan matched `comicvine.matched = "Die Jetsons #10"`
  (`vol_id=146851`, publisher "Neuer Tessloff Verlag" — a German imprint)
  through this gate untouched: `[cv-lang-gate] 1 → 1 volumes (non-English
  filtered)`. The volume's own title is "Die Jetsons," not "German
  Jetsons" or similar — the regex checks for the literal NAME of a
  language, not any actual language/locale signal, so a foreign edition
  whose title is simply translated (not annotated with its language)
  never matches and survives. Compounding: the log fires whenever
  `langFiltered.length > 0` (`api/enrich.js:737`), with no check that
  anything was actually removed — `beforeLang=1, after=1` (zero
  candidates dropped) still prints "(non-English filtered)," so the log
  line itself is misleading evidence of a working filter even on a
  complete no-op pass. No damage in the case that surfaced this — a
  downstream, independent gate (`[ship28b-conflicts]`, `PUBLISHER_MISMATCH`
  + `YEAR_DRIFT`) caught the resulting publisher/year contradiction and
  suppressed the story — but the language gate itself is not doing what
  its own log line claims. Not yet fixed — needs a real language/locale
  signal (ComicVine's volume or issue payload, if one exists beyond the
  title string) rather than a keyword match against translated titles,
  and the log line should only claim "(non-English filtered)" when
  `langFiltered.length < beforeLang`.
- **GitHub→Vercel auto-deploy not firing (2026-07-16)** — two consecutive
  pushes to `main` (`58009cb`, `d03d5bf`) produced zero Vercel deployment
  activity, confirmed via the Vercel API (`list_deployments`,
  `get_project.latestDeployment`), while `git fetch` independently confirmed
  both commits genuinely reached `origin/main`. Production was still serving
  `4c74677` as of this note. Root cause not yet identified — needs a check of
  GitHub's webhook delivery log (repo Settings → Webhooks → Recent
  Deliveries) or the Vercel project's Git integration settings, neither of
  which was reachable from the available tooling at investigation time.

## Handoff Pointers

- Pattern Library (full finding writeups): `docs/PATTERN-LIBRARY.md`
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
