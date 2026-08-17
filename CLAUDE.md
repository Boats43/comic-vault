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
- **Test baseline:** 191 PASS / 19 FAIL / 4 TIMEOUT / 214 total — verified against HEAD (this commit), 2026-08-16 (GrailKey Directive AQ), via a full unfiltered run of every file in `tests/*.test.js` (not a named blast-radius subset). Prior stamp 190/19/4/213 (Directive AP). One new file this dispatch (`grailkey-directive-aq-canonical-facet-authority.test.js`, 31/31); one existing file modified (`q-trackB-commit4.3-winning-family-authority.test.js`, CONTROL T6(c) rewritten to anchor on the new single-projection wiring — 263/263, net -3 assertions from collapsing 7 anchor checks to 5); FAIL/TIMEOUT unchanged at 19/4, byte-identical file list to the prior stamp (`tests/artist-registry-sync.test.js`, `batch1-fixes.test.js`, `comp-filter-hygiene.test.js`, `decision-engine.test.js`, `grailkey-commit-e/f/g.test.js`, `grailkey-commit-v1.test.js`, `grailkey-directive-j-gk79a-relabel.test.js`, `grailkey-directive-p-task3-variant-on-card.test.js`, `grailkey-directive-q-variant-null-custody.test.js`, `grailkey-dispatch-33-parity-harness.test.js`, `identity-gate.test.js`, `image-search-extraction.test.js`, `mega-keys.test.js`, `pattern-k-dedupe-issue.test.js`, `priceBands.test.js`, `q-adv397-visual-guard.test.js`, `sold-verification.test.js` FAIL; `dispatch-42-comicvine-kill.test.js`, `grailkey-commit-m-pc-query-fallback.test.js`, `grailkey-directive-aj-http-handler.test.js`, `ship26-integration.test.js` TIMEOUT) — zero new regressions from this dispatch's `api/enrich.js`/`src/lib/identityCore.js`/`src/lib/issueAuthority.js`/`src/lib/identityReconciler.js` changes; every identity/issue-authority-adjacent suite re-run directly, including `q140-issue-consensus-corrective.test.js` (124/124, Flash #139 byte-identical), `grailkey-dispatch-25-fix2c-axis-check.test.js` (60/60), `q-trackB-commit4.3.1-retention-decline-fail-closed.test.js` (73/73), `q-trackB-commit4-adoption-provisional.test.js` (152/152), `grailkey-commit-p/p2.test.js` (59/59, 44/44), `q140-at-vision-zero-support-skip.test.js` (25/25). **GK-89 caveat still stands** (its host file crashes, not a clean FAIL, whenever `src/lib/manualCorrection.js` is git-clean at run time — untouched by this dispatch). **Standing rule: any dispatch that adds or removes a `tests/*.test.js` file must re-stamp this line in the same commit.** Full history + methodology: Pattern Library.

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

**Full-suite re-sweep, GrailKey Directive 2026-08-11-C, HEAD `0cb4c38`,
2026-08-11 — 5 files failing or timing out that were not named anywhere
above. Enumeration only, per the closeout directive's own scope — none
investigated or fixed this pass.**
- **artist-registry-sync.test.js** — 2 failures ("dekal", "spears" —
  `ARTIST_SURNAME_WORDS` entries that don't trace back to any
  `ARTIST_PATTERNS` entry).
- **grailkey-commit-g.test.js** — 1 failure, same shape as the already-
  documented `grailkey-commit-e.test.js`/`grailkey-commit-f.test.js` Part
  2 stale-assertion above (reads live `git diff --name-only HEAD`, false-
  fails whenever other uncommitted changes are present) — a third file
  with the identical known defect class, just never added to that
  paragraph by name until now.
- **grailkey-commit-v1.test.js** — 1 failure (`exactly 24
  writeConfirmed() call-assignments after the anchor` — expected 24,
  found 25; a hardcoded count assertion one commit behind current code).
- **grailkey-dispatch-33-parity-harness.test.js** — exits non-zero by
  deliberate design, not a defect: `0 passed, 0 failed, 1 skipped` — the
  Dispatch 33 parity-harness stub intentionally ships with zero cases
  until a shadow lane exists to compare against (see the Dispatch 33
  Pattern Library entry). Flagged here only because it wasn't previously
  named in this list and a naive PASS/FAIL sweep reads its exit code as
  a failure.
- **ship26-integration.test.js** — TIMEOUT, confirmed non-deterministic
  (one run completed clean at ~35s, a second run genuinely hung past
  40s) — **contradicts the "FIXED... 13/13 passing, removed from this
  stale list" entry directly above.** Root cause not investigated this
  pass; the visible symptom is repeated `[Upstash Redis] Redis client
  was initialized without url or token` lines, consistent with this
  being a local-environment artifact (no `KV_REST_API_URL`/`TOKEN` set
  outside Vercel) rather than a genuine code regression, but that is an
  unverified hypothesis, not a finding.
- **Checked and ruled out, not added:** `dispatch-42-comicvine-kill.test.js`
  and `grailkey-commit-m-pc-query-fallback.test.js` both appeared as
  TIMEOUT under this sweep's own 20s-per-file cutoff, but both complete
  cleanly (27/27 and 10/10 passing respectively) once re-run with a
  longer timeout — an artifact of the sweep harness, not a real failure
  or hang. Noted so a future sweep doesn't re-flag them without checking.

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
- **Renumbered-franchise title/issue collision class** (ASM #17, Action Comics #33) — no source-level fix exists, mitigated at price-band Tier 2 sold-anchor fallback.
- **Distinctive-artist-style confusion class** (Uncanny X-Men #27 / Ultimate X-Men #1, Peach Momoko) — TPB-pool fix shipped but insufficient for this case.
- **Variant-artist token fusion class** (Black Cat #1, Skottie Young) — fixed by stripping `ARTIST_PATTERNS` before tokenizing in `tokenizeTitleFamily`.
- **Intake-vs-listing gate class** (Q110) — three hard-blocking intake flags reclassified to `listingHardLocked` (price stays visible, only List gates).
- **Generic-descriptor variant-match class** (Venomverse #1, Q111) — fixed via `classifyVariantTokens` (specific vs. generic) + AND-match in Filter 1c.
- **Batman #608 class, five stacked bugs** (Q112–Q115) — ComicVine volume-year leak, sold-verification math bug, over-broad `variantMismatch` (reverted), visual-pool contamination (fixed via `filterItemsByIssue`).
- **Incredible Hulk #377 class, printing/edition not tracked** (Q116) — `classifySpecificPrinting` + `PRINTING_PATTERNS` added; manual dropdown queued, not built.
- **Catwoman #64 Szerdy-variant class** (Q127) — fixed via pool-level `detectVariantPoolYearConflict`.
- **Drifted-duplicate-constant class, 3rd instance: year-tolerance** (Q128) — consolidated into shared `getEraYearTolerance`/`evaluateEraYearMatch`.
- **Volume-launch-year comp date class** (Q128, Harley Quinn #62) — domain fact, encoded as `isVolumeLabelYear` (±1y of volume start year legitimate).
- **Correct-rejection silent-substitution class** (Q129, Harley Quinn #62) — flagged via `variantCompsExcludedByEra` + RESEARCH warning.
- **Bone #1 class** (GK Dispatch 05/06/09/10/11) — GK-34 `MIN_POOL_FOR_OVERRIDE=3` floor shipped; drove a 9-gap `ARTIST_PATTERNS` audit.
- **Dormant-multiplier class** (GK Dispatch 12–14) — newsstand mult extended to tier-engine sources; key mult held pending recalibration.
- **GrailKey Dispatch 15** (2026-08-07) — `titleOk` bar 0.30→0.15, vision-zero-support ratio floor, 3 creator-registry additions all SHIPPED; issue-adoption margin, category-vote override, pool-year-hint feed all designed-not-coded.
- **GrailKey Dispatch 16** (2026-08-07) — CLAUDE.md split (193k→76k, this size limit made standing); pool-year-hint bar set 0.75 (still not coded); GCD terms unreachable, cover-matcher stays gated.
- **GrailKey Dispatch 17** (2026-08-07) — GCD App Guidelines terms obtained externally; cover-matcher re-scoped as three separate infra pieces, materially larger than estimated, still plan-only.
- **GrailKey Dispatch 18** (2026-08-07) — KV drift reconciled (Upstash live since 2026-06-29, not "no server database"); real `api/` count is 14 not 12, cap unverified at the time.
- **GrailKey Dispatch 19** (2026-08-07) — Fix 6 (`rescueYearFromVisionFallback`) + Fix 5 (`shouldLiftAssetTypeAdvisoryLock`) SHIPPED; Vision confidence string leak fixed (`normalizeVisionConfidence`); commit-p near-miss reported, not fixed.
- **GrailKey Dispatch 20** (2026-08-07) — "misattributed-anchor class" note recorded; commit-p rank-slot theft investigated — title-family fragmentation, not rank theft, was the dominant mechanism (4/9 vs 1/9).
- **GrailKey Dispatch 21** (2026-08-07) — title-family fragmentation watch-listed, not scoped; structured KV scan-logging designed (plan only).
- **GrailKey Dispatch 22** (2026-08-07) — structured KV scan-logging SHIPPED (`src/lib/scanLog.js`, `kvZAdd`, `scripts/query-scanlog.mjs`); log every scan, sorted-set index over Streams.
- **GrailKey Dispatch 23** (2026-08-07) — `api/` function cap RESOLVED: Pro/Enterprise confirmed, no cap. Three scan-log questions recorded for revisit after ~2 weeks of data.
- **GrailKey Dispatch 24** (2026-08-07) — 13 commits pushed; Vision confidence string leak (Dispatch 19) confirmed intermittent, not deterministic — verification relies on the unit test, not on reproducing the string on demand.
- **GrailKey Dispatch 25** (2026-08-07) — unanimous-consensus identity unblock. Fix 1/2/2b SHIPPED (`b2c7358`, `81ca1d2`); Fix 2c (Batman #213 class) requires UNANIMITY via `.assertedIssues`, two review-caught corrections before shipping, **HELD FOR PUSH APPROVAL**. GK-35/36/37 opened, log only.
- **GrailKey Dispatch 32** (2026-08-08) — batch review of 47 real scans. **32-C SHIPPED** (`37f458f`). Coherent-content-token lane DELETED + co-title gate off, following a real-corpus hit-rate audit (0/15, 0/1 beneficial); 15-case frozen corpus regression suite. **32-B HELD.**
- **GrailKey Dispatch 33** (2026-08-08) — Architecture v1.0 Week 1, instrumentation only. Two standing invariants: **Monotonic Evidence Extension**, **No Self-Corroboration**. `evidenceContracts.js`/`anthropicPricing.js` shipped, unconsumed.
- **GrailKey Dispatch 34** (2026-08-08) — third standing invariant: **Rejection must not create authority** (ComicVine fail-open, all 12 candidates rejected then population restored). Step 1 SHIPPED (`9eb4601`, `phase2_start` timing-key rename).
- **GrailKey Dispatch 37** (2026-08-09) — cache-key correction round, 3 commits SHIPPED. Fourth standing invariant: **cache correctness is authority correctness** — derived rule **key on the predicate, never a proxy for it**.
- **GrailKey Dispatch 38** (2026-08-09) — third axis of Rejection-must-not-create-authority: mega-key floor re-authorizes price after structurally-weak evidence. Dispatch 36's fingerprint fix does NOT fix Bone (different axis).
- **GrailKey Dispatch 39** (2026-08-09) — **pricing auditability gap** named (sold pool never durably cached at any TTL). Recollection protocol specified, not yet run.
- **GrailKey Dispatch 40** (2026-08-09) — **Gate 2 (A/B/C cache certification): CLOSED, PASSED.** New finding: decision-layer non-determinism (identical cache/price, flipped `decision.action`) — a ceiling on this design, not a defect.
- **GrailKey Dispatch 41** (2026-08-09) — **Gate 1 CLOSED** (read-only Upstash access confirmed). Marvel Age #1000 settled (ledger-surfacing gap, not a backend failure). Sold-pool durability gap confirmed more severe than Dispatch 39 described.
- **GrailKey Dispatch 42** (2026-08-09) — `priceDerivationTrace` (the richest diagnostic field) confirmed never persisted to IndexedDB. Preflight capture target corrected to the raw `/api/enrich` response body.
- **GrailKey Dispatch 43** (2026-08-09) — bulk cardinality proven from source (one request/book). Deterministic fixture pipeline built + tested (`ingest-fixture-response.mjs`, `capture-active-cache-entry.mjs`, `merge-fixture.mjs`).
- **GrailKey Dispatch 44** (2026-08-09) — mega-key floor root cause confirmed (`Bonnier Carlsen` publisher mismatch). Fifth standing invariant: **authority must be use-consistent**.
- **Dispatch 42-I** (2026-08-10) — SAFE-KILL certified, Task 6 Identity closed (7/7 PASS by hand, Batman #213). `cf96d1b` deployed READY. GK-50–57 logged, not investigated.
- **Dispatch 45** (2026-08-10) — GK-39 confidence-provenance trace. `identityAlignment.authenticationScore` proven fabricated (hardcoded constants). Split into GK-39/62/64/65.
- **Dispatch 46 + 46B** (2026-08-10) — **GK-62 SHIPPED**: convergence vision-slot no longer self-corroborates on a manual value. Field-level exclusion traced and rejected (all-or-nothing stands). Two standing invariants: **a safety gate must not disappear because an asset crossed a persistence boundary**, **a value must not vote for itself**.
- **Dispatch 47** (2026-08-10) — **GK-39A SHIPPED**: fabricated confidence constants deleted, no replacement; dead listing gate removed outright, not fail-safed.
- **Dispatch 48 + 50** (2026-08-10) — **GK-66/67 SHIPPED** (ladder passthrough + `HOLD_FOR_CGC` removed; blend-line display fix). GK-68/69 logged, held on Operator Mode Hold's decision B.
- **GrailKey — Operator Mode Hold** (2026-08-10) — **`1aa6eb0` is the operating baseline; engineering dispatches paused**, customer deliverable narrowed to identity/condition/verified-comps/one estimate. Reopen triggers listed in Pattern Library.
- **GrailKey Directive 2026-08-11-A** (investigation only) — GK-38/42 resolved as already-shipped GK-66/67 under stale numbers; broader ComicVine fail-open found (3 gates); IndexedDB provenance retrofit sized INVASIVE (8 merge sites).
- **GrailKey Directive 2026-08-11-B** (explicit Operator Mode Hold exception) — `docs/TICKET-REGISTRY.md` created. **GK-71/GK-72 SHIPPED** (ComicVine fail-open closed on all 3 gates; eBay outage vs. genuine-zero distinguished). GK-70 found, deliberately deferred.
- **GrailKey Directive 2026-08-11-G** (2026-08-11) — **Authority Propagation Invariant** named (three mechanisms: Computed-Then-Discarded, Validation Bypass on Authority Replacement, Stale Authority Inheritance). **GK-74 SHIPPED/CLOSED**; Task 1/2 SHIPPED (`pcAnchorTrust`/`pcAnchorYear` stamping + `pcAnchorAuthority.js` gate).
- **GrailKey Directive 2026-08-11-H** (2026-08-11, corrective, pre-push) — Item 1 SHIPPED (stale `cur.` fallback dropped at 7 App.jsx sites); Item 2 corrected Task 2's test evidence; Item 4 normalized the Computed-Then-Discarded table, added mechanism (c) **Stale Authority Inheritance**.
- **GrailKey Directive 2026-08-12-J** (2026-08-12) — GK-77 split (77A/77B, blocked on each other — new standing invariant: **unknown printing confers no exact-print authority**, see `docs/TICKET-REGISTRY.md`). GK-78 reworded, GK-79 split. **Task 2 SHIPPED/CLOSED** (GK-79A relabel, `1d827e7`). Task 3: GK-78 signal traced, does NOT reach `priceBands.js`.
- **GrailKey Directive 2026-08-13-O SHIPPED** (2026-08-13) — comp query ladder ordering fix (Sabrina/Dan Parent NYCC class): image-search attempt reordered after variant-bearing attempts when a variant is confirmed. Order-only, no query change. GK-82 logged (no quality floor on the break condition).
- **GrailKey Directive 2026-08-13-P** (2026-08-13) — Task 1/2 **BLOCKED** (family weight IS rank restated; `confirmedVariant` not computed until 2700 lines later — GK-83). Task 3 **SHIPPED** (variant rename fix at `setResult` merges + moved variant display adjacent to title).
- **CORRECTED (2026-08-13, GrailKey Directive Q)** — P's Task 3 fix was defective: `??`/`||` are not presence-aware. All 7 real merge boundaries fixed (6 `App.jsx` sites presence-aware via `hasOwnProperty`, `manualCorrection.js` site clears-on-absence by design). Third confirmed **Stale Authority Inheritance** instance.
- **GrailKey Directive 2026-08-13-R** (2026-08-13) — both `api/enrich.js` early-return paths proved (verdict B, live defect) to omit `variantNote`; fixed with a presence-guarded fallback at each. Rescan cleared.
- **GrailKey Directive 2026-08-14-T** (2026-08-14) — picker foundation, 5 tasks, all closing GK-85/86/87. **Task 3 (GK-85) is the live-defect fix**: `identityAuthority`, a per-field OPERATOR_CONFIRMED map, added via `mergeIdentityAuthority`, presence-aware, per-field not per-item. Task 4: `variant` added to `MANUAL_CORRECTION_ALLOWED_FIELDS`. Task 5 (GK-87 partial): `submitManualCorrection` ENFORCE-gated; `gradeBlob`'s own write deliberately deferred.
- **GrailKey Directive 2026-08-14-U** (2026-08-14) — Task 1: GK-84 was never actually closed (false claim lived only in Pattern Library prose), corrected. **Task 2: GK-87's `gradeBlob` gap CLOSED** — `kind: 'scan' | 'correction'` tag + `wasSupersededByCorrection` predicate; correction-caused staleness always rejects at all 3 gradeBlob write sites, scan-vs-scan staleness unaffected (no global flip). `refreshMarketData` found independently unguarded — GK-88 opened. GK-89/90/91/92 also logged (pre-existing test gaps, CLAUDE.md size).
- **GrailKey Directive 2026-08-14-V** (2026-08-14) — CLAUDE.md compaction first (GK-92 closed, 148,847→98,875 chars, `8d8af44`, docs-only). Task 1 enumerated every async writer in `src/App.jsx`; Task 2 guarded every reachable single-flow one (`refreshMarketData`, `reIdentifyBook`, `addPhotoToComic`, duplicate-confirm) via the same shared `activeScanRef` mechanism. **Found and fixed a real live defect in Directive U's own shipped code**: `wasSupersededByCorrection` was item-BLIND (rejected on ANY correction anywhere, discarding valid unrelated work — a global kill switch), caught by this directive's mandatory cross-item control test; fixed by scoping the predicate to `itemId` matches. GK-88 mostly closed, kept OPEN for one named remaining gap (`handleBulkImport`'s concurrent worker pool — incompatible with the single-slot mechanism, needs a genuine multi-slot registry, new-mechanism territory). Two adjacent findings logged separately: GK-93 (residual same-slot risk between two different single-flow producers, inherited from T/U, not new) and GK-94 (`listOnEbay`/`syncEbayStatus` stale-closure resurrection risk, a different defect shape). Full detail: Pattern Library.
- **GrailKey Directive 2026-08-14-X — GK-94 CLOSED** (2026-08-14) — `listOnEbay`/`syncEbayStatus` (`src/App.jsx`) no longer spread the closed-over pre-request `item` back into catalogue state; both now read the current item fresh from `prev`/`cur` at write time and merge only the fields each handler actually mutates (`listOnEbay`: status/ebayUrl/ebayItemId/listedAt; `syncEbayStatus`: status + conditional sold/ended fields), matching `listBundleOnEbay`'s already-correct pattern in the same file (verified byte-identical, untouched). No new mechanism — a closure fix, not an ownership fix. Preceded by a Directive W reachability-only pass (no code) that confirmed both `handleBulkImport` and this GK-94 gap are genuine same-item S blockers, distinguishing "needs its own mechanism" (bulk import, still open) from "just needs a fresh read" (this ticket, now closed). Full detail: Pattern Library.
- **GrailKey Directive Y — P0 false-READY trace** (2026-08-14, investigation-only) — traced a real production incident (Sabrina The Teenage Witch #1 misidentification, `LIST_LOW`/blockers=0/enabled List button on a book that was actually a Dan Parent NYCC foil variant Annual). Root cause: `decisionEngine.js` has zero `pc_estimate`-tier awareness (GK-95); the confidence-demotion cap only ever demotes HIGH→MEDIUM and the one thin-pool lock only fires on `tier==='LOW'`, leaving a MEDIUM-scoring thin/stale/tier-4 book to clear both defenses (GK-96, the P0 root cause). Also logged: cross-publisher variant-token collision with no publisher check (GK-97), title-family selection with no internal-coherence check (GK-98, related to but distinct from the "wrong population" disease class), and the correction form's `getCorrectableFields` gate never firing for a confidently-wrong (not missing/provisional) identity (GK-99).
- **GrailKey Directive Z — transaction authority boundary** (2026-08-14) — GK-95/96 fix, greenlit scope. Built `src/lib/actionAuthority.js`: two independent axes (`identityStanding`, `marketStanding`, both derived from real fields, never from `matchConfidence`) combine into one verdict (`actionAuthority.state`: READY/REVIEW/LOCKED) that is now the SOLE listing gate — `contract.listable` is a pure projection of it, `decisionSafe`/`identityConfirmed`/`getListableBooks` all rewired off `decision.action` onto it, and `/api/list-ebay` independently RE-DERIVES it server-side from raw evidence fields (never trusts a client-sent verdict) before allowing a single-item listing, with the pre-existing Q41 acknowledge-override path preserved and now genuinely server-checked. Card rendering added (IDENTITY STANDING / MARKET STANDING / ACTION AUTHORITY + reason codes, both ResultCard and CollectionDetail). Sabrina regression + 4 required monotonicity tests + server forged-READY rejection all verified (`tests/grailkey-directive-z-transaction-authority.test.js`, 45/45). Known gap, logged not fixed: the bundle-listing branch of `/api/list-ebay` has no equivalent server-side check (GK-100). GK-98 (wrong-but-confident identity itself) remains explicitly untouched, as directed.
- **GrailKey Directive AB — evidence applicability custody, GK-101 CLOSED** (2026-08-14) — second false-READY, different path than GK-96 (tier-3 `active_ask_derived`, not tier-4 `pc_estimate`): `deriveMarketStanding` read `pricingSource` alone, so a pool that reached "current" tier could still be granted `EXACT_CURRENT` even when Filter 1c (`applyVariantPreferenceFilter`, `api/comps.js`) found zero comps matching `confirmedVariant` and fell back to the broader, variant-blind pool — Computed-Then-Discarded, 7th instance. Production instance: Sabrina Anniversary Spectacular #1, Dan Parent NYCC Foil — 14 generic 1997 comps, zero matching the confirmed foil variant, `actionAuthority.state: READY`. Fixed by threading a new `matched`/`out.variantApplicability` (`CONFIRMED`/`UNVERIFIED`/`null`) signal from the ONE place it's computed (Filter 1c) through `api/comps.js` → `api/enrich.js` → `deriveMarketStanding` (floors `EXACT_CURRENT`→`SIMILAR_ONLY` on `UNVERIFIED`, never lower) → Z's EXISTING state machine (no parallel denial path) → a new soft `market-standing-variant-unmatched` lock. No pricing math touched, `mode=any` keeping-all preserved, sold-path variant enforcement (`variantMismatch:comp_has_user_none`) verified untouched. GK-102 traced and found narrower than framed (the NEEDS REVIEW badge already derives from `actionAuthority.state` when present — the observed contradiction WAS GK-101, not a second bug; residual gap scoped to pre-Z legacy items only). GK-98 (identityStanding CONFIRMED on this same wrong-but-confident book) remains explicitly untouched. `tests/grailkey-directive-ab-evidence-applicability.test.js`, 35/35. **Standing-rule record:** the same-commit baseline rule was violated by this dispatch — the new test file landed in `cb987d1` while the baseline re-stamp landed in the separate docs commit `378b45e`. The baseline value (176/19/3/198) is correct and was fully cross-checked; the commit placement was not. Second occurrence of this violation; see Directive J (instance 1) and Pattern Library's standing-rule violation record.
- **GrailKey Directive AD — always-reachable identity recovery (GK-99)** (2026-08-14) — a confidently-resolved-but-WRONG identity (`identityMissingFields=[]`, `identityProvisionalFields=[]`) had no operator recovery path except Re-identify Book, which reruns the SAME automatic pipeline that produced the wrong answer. Traced first (both STOP GATES cleared): the five-facet correction machinery (`MANUAL_CORRECTION_ALLOWED_FIELDS`/`prepareManualCorrectionRequest`/`validateManualAuthority`/`buildCorrectedCatalogueItem`/`mergeIdentityAuthority`/scan-ownership race guard) already existed, already ran a FULL `/api/enrich` on correction (confirmed identity feeds `fetchComps` directly, `api/enrich.js:6116-6126`), and cache keys (`ac:`/`cv:`/`pc:`) already key on identity fields — a corrected identity cannot hit a stale cache entry. **CORRECTED (Directive AE, GK-107): this claim was too broad.** Proven for title/issue/year (all three keys) and variant (`ac:`/`pc:`); **not proven, and in fact FALSE, for publisher** — `ac:`/`pc:` never encoded it at all (only `cv:` did), a real stale-cache-reachable gap, closed by Directive AE. See GK-107 for the full trace and fix. Only `src/App.jsx` changed: (1) reachability — `getCorrectableFields([],[])=[]` (the exact GK-99 predicate) now falls back to an explicit "✏️ Correct identity" toggle offering all five `MANUAL_CORRECTION_ALLOWED_FIELDS`, reusing the one existing form/render site (no second correction UI); (2) atomic presentation (C4) — `submitManualCorrection` now writes an optimistic pending-lock (`listingHardLocked`/`contract.listable=false`/cleared `q41Ack`) BEFORE the fetch, deliberately never reverted on failure, closing a real gap the trace found: a previously-READY item stayed freely listable after a FAILED correction that had just declared its identity wrong (now requires the same Q41 acknowledge-override every other REVIEW item requires, not automatic reactivation) — flagged explicitly per the directive's own instruction, not hidden in a green suite. No resolver, pricing, comp-filter, or diff-logic changes (C6). GK-103 noted as widened (reachability only, not fixed). `tests/grailkey-directive-ad-identity-recovery.test.js`, 48/48 — includes a MIRRORED pre-AD reproduction (`git show 45b0515`) and a printed before/after outgoing comp-query-string proof (World's Finest #74, per the directive's own instruction not to use Sabrina's disputed year) that a correction is a genuine re-enrich, not a relabel — **CORRECTED (Directive AE, Task 3b): this specific fixture only proved a changed field triggers re-enrich, not that a fully coherent identity survives to the comp query (the fixture corrected title+issue but left year=1990 stale, so both "#74" and "#1" appeared in the printed query). Coherent re-run (all 5 facets) requires Jimmy's operator-supplied true identity values for the acceptance book — explicitly not to be sourced from model recall, the same discipline that caught Sabrina's disputed year. PENDING as of this dispatch; not yet re-run.**
- **GrailKey Directive AE — cache-key identity coverage + Q41 atomicity (GK-107/GK-108)** (2026-08-14) — corrected two claims from AD's own acceptance record rather than reopening AD itself. **GK-107 CLOSED:** `pc:`/`ac:` cache keys never encoded publisher (only `cv:` did) — confirmed actionable via the `ac:` route specifically (it caches the fully filtered, PRICED active-comp pool; a publisher-only correction could return a pool fetched under the OLD publisher's eBay query text, sourced EXACT_CURRENT-tier, reaching READY for an unqueried population). Fixed by adding `publisher` to `buildFilterContextFingerprint` (`ac:`) and `buildPriceChartingCacheKey` (`pc:`), version-bumped (`COMP_FILTER_VERSION` 11→12, `PC_FILTER_VERSION` 2→3) so old entries can't be misread as valid. **GK-108: client half CLOSED, server half a deliberate STOP GATE.** A second, independent Q41 acknowledge path (distinct from the one AD's `correctionSubmitting` covered) could bypass a pending/failed correction's lock entirely — typing a price flips `priceOverridden` unconditionally, and that path's own button sets `q41Ack` unconditionally, neither gated by `correctionSubmitting`, both surviving past the in-flight window. Fixed with one top-of-render guard on `item.listingHardLockReason === 'correction-pending'` (a field AD already introduced), placed before both Q41 paths and the List button — closes the in-flight AND post-failure windows in one check, no new mechanism. Server-side: `/api/list-ebay`'s `syntheticOut` has zero visibility into this state at all — confirmed the SAME underlying shape as GK-103 (client-only state at the trust boundary), not fixed per this dispatch's own explicit instruction not to accept a new client-supplied lock boolean as a substitute for real server ownership. `tests/grailkey-directive-ae-cache-identity-atomicity.test.js`, 31/31. The false-READY halt remains cleared (confirmed against live `45b0515`/`ba5b130` evidence, not reopened); GK-99 remains SHIPPED, not closed — production acceptance is still Jimmy's to run.
- **GrailKey Directive AF — discriminative evidence beats generic population, GK-98 CLOSED** (2026-08-14) — "measuring coherence against the wrong population" at the identity layer: a generic franchise family's `weightSum` (a population count, itself rank-restated — GK-83) defeated a specific edition candidate Vision independently corroborated on multiple discriminative tokens. Direct execution against a realistic Sabrina-shaped fixture found TWO independent kill paths — the generic family can win via `top-rank-protection` (occupying rank 0) or via `weighted-consensus` (highest `weightSum`), so the fix (`selectTitleFamilyCandidate`, `src/lib/imageSearchIdentity.js`) had to preempt both, not just one. Adoption requires (C4) ≥2 tokens independently corroborated by `opts.visionVariant` (the raw Vision-supplied variant, same `req.body.variant` proxy used elsewhere pre-`confirmedVariant`) — an uncorroborated descriptor like "Foil" earns nothing — using a genuinely RAW tokenizer (deliberately not the existing `tokenizeTitleFamily`, which strips exactly the creator-name/convention/finish vocabulary corroboration needs — confirmed empirically it silently narrows to allowlisted creators only) — AND (C2, Flash #139, unrelaxed) the candidate's own issue signal does not contradict Vision's, via `resolveFamilyIssueConsensus` (not `extractIssueFromTitle`, which suppresses this exact title shape's "#1" as marketingContext, confirmed empirically). Per-member corroboration (not just the top-ranked row) catches an internal split within one Jaccard-merged family — found during testing that `buildTitleFamilies` clusters two DIFFERENT named variants under one family by title similarity alone. Two disjoint-corroborated candidates yield the EXISTING `refused-identity-conflict` decision (C5/C6) — no REVIEW write, no new mechanism. `FAMILY_OVERRIDE_DECISIONS` extended by one string so `resolveIdentity`'s existing override gate and downstream comp-query construction pick up the new decision automatically — verified DIRECT via source trace, not re-wired. Flash #139 confirmed unaffected (no `visionVariant` in that scenario — the new branch is a structural no-op). No pricing, comp-filter, `actionAuthority`, AD correction path, or AE cache-key changes. `tests/grailkey-directive-af-discriminative-corroboration.test.js`, 25/25. GK-99 production acceptance still pending, untouched by this dispatch.
- **GrailKey Directive AG — GK-98 kill path 3, the 22e veto, RE-CLOSED** (2026-08-14) — AF's resolver worked; a downstream, independent consumer (`checkAssemblyIntegrity`/"22e," `src/lib/identityCore.js`) silently force-reverted its result 3ms later, because 22e's zero-support carve-out requires `compTitles.length >= 3` and a genuinely thin (1-member) discriminative family can never clear that floor. Fixed by extending `shouldSkipAssemblyIntegrityCheck` to also exempt `'discriminative-corroboration'` (was: only `'refused-identity-conflict'`) — one line, 22e and its two rules untouched. Every other consumer of the family-selection result enumerated: Q141-A's PC-anchor-projection already safe (protected by `isCorroboratedIdentitySource`/`FAMILY_OVERRIDE_DECISIONS`, a byproduct of AF's own work); Phase 2's 22e call only evaluates the non-failing rule, no change needed. New standing Pattern Library rule: a kill-path trace must enumerate every CONSUMER of a changed value, not only competing branches inside the module that produces it — AF's own "no additional kill paths" claim was wrong for exactly this reason. WATCH finding (traced, not fixed): the surviving title can still anchor to PriceCharting's wrong 1997 product downstream (`mainToken` overlap checks only the first token, year-gap validation skips entirely when year is unresolved, `assessPcAnchorTrust` does no title check) — logged as GK-109. `tests/grailkey-directive-ag-22e-provenance-exemption.test.js`, 32/32. Full detail: Pattern Library.
- **GrailKey Directive AH — third false-READY, GK-111 CLOSED** (2026-08-15) — different tier than GK-96 (tier-4)/GK-101 (tier-3 active): tier-2 blend. Production: operator's real $24.99 sold book rejected by `soldVerification.js`'s own variant fallback, re-admitted `variantVerified:false`, blended against a DIFFERENT $109.95 book matched by `api/comps.js` Filter 1c on the bare token "nycc" — READY, $65.88 List button. Two fixes: (1) `soldPoolFallbackConsumed` (`priceBands.js`, scoped to real consumption, not mere upstream existence — Fixture 3b proves it) folded into AB's `out.variantApplicability`, new `out.variantApplicabilitySoldFallback` for a distinct `SOLD_VARIANT_FALLBACK_POOL` reason code. (2) new tier-independent `single-comp-pool`/`SINGLE_COMP_POOL` soft lock — `marketStanding` stays honestly `EXACT_CURRENT` (never corrupted), gates `READY` separately when total comps <2. Found while tracing the server boundary: `variantApplicability` was never actually included in the `/api/list-ebay` request body (`App.jsx`) since AB shipped — GK-101's server protection was never reachable; fixed alongside. GK-112 (matcher looseness: "nycc" alone drove the wrong match) logged, deferred. Regression found and fixed forward in the same commit: AG's own test (`grailkey-directive-ag-22e-provenance-exemption.test.js`) pinned its pre-fix comparison to literal `'HEAD'`, which silently drifted to post-fix content the moment AG became HEAD — the same class as GK-91, pinned to `7d0d434`. `tests/grailkey-directive-ah-sold-fallback-authority.test.js`, 54/54. Full detail: Pattern Library.
- **GrailKey Directive AI — visual-first identity authority, Slice 1, GK-113/114 SHIPPED** (2026-08-15) — **CORRECTED (Directive AJ, same day): reclassified OPEN/SHIPPED, not CLOSED — closure requires physical-production evidence (Jimmy's own scans), which a BUILDING deploy and unit-level fixtures don't meet.** A physical-identity split-brain (`confirmedIssue` left null while `api/comps.js` independently re-parsed and priced against a specific issue anyway — Detective Comics #1107 class) and a "confidently WRONG vs honest null" false binary (Venom class). New `src/lib/identityReconciler.js`: eligibility filter (Rule 1/C1, GK-115 partial) + a Slice-1-scoped, pure, order-independent (D1/D4) evidence/reconcile API for the issue facet only. Creator registry gap fixed alongside (GK-114): "jimenez" moved into the file's own documented ambiguous-surname policy. GK-116 found and logged, not fixed: `extractIssueCandidate`'s shared 999 issue-number cap. Title/year/publisher/variant/creator facets otherwise untouched — explicitly Slice 1 of 3. `tests/grailkey-directive-ai-visual-first-identity.test.js`, 55/55. **Directive AJ found and closed a real gap the same day — see next entry; do not treat this entry's mechanism as reachable on its own, read AJ too.**
- **GrailKey Directive AJ — reconciler reachability closed, GK-117/118 CLOSED** (2026-08-15) — AI's own claim that the reconciler was wired in was FALSE: grep for `reconcileIssue`/`createEvidenceSet`/`addEvidence` across the production pipeline returned zero hits before this dispatch — the shipped mechanism was a rescue path gated on `confirmedIssue == null` only, never examining `firstEligibleVisual` when Vision confidently kept a non-null value with merely WEAK (non-zero) pool support — the exact "confidently wrong value the evidence system never gets to examine" shape this campaign exists to close (GK-117). FIXED: `resolveIdentity` now builds an issue evidence set and calls `reconcileIssue` UNCONDITIONALLY on every issue resolution. Upstream resolvers keep running; their outputs become evidence at the reconciler's existing precedence (`family-consensus` > `first-eligible-visual` > `vision`), never pre-empting the reconciler itself. Flash #139 safety confirmed as a PRECEDENCE property (verified with and without "Anniversary" text in the fixture, isolating precedence from the marketing-flavor guard), not an unreachability property. New Guard 6 (GK-118, found on the full regression sweep): `hasContaminatedMember` — the same signal already gating retention/rescue — now also suppresses first-eligible-visual evidence for a contaminated family (CONTROL C: raw + CGC-graded rows mixed), closing a regression the reachability fix introduced. Re-verified end-to-end through the REAL `/api/enrich` HTTP handler (`tests/grailkey-directive-aj-http-handler.test.js`, mocking only the eBay network boundary, not the identity path) for both Detective and Venom — the AG lesson (unit-level fix silently reverted by an untested downstream consumer) checked and closed for this mechanism specifically. `tests/grailkey-directive-aj-reconciler-reachability.test.js` (17/17) + `tests/grailkey-directive-aj-http-handler.test.js` (13/13). GK-113/114 remain OPEN/SHIPPED pending physical scans — this dispatch does not close them, it closes the mechanism gap Proof 1 found underneath them. Full detail: Pattern Library.
- **GrailKey Directive AK — the population-precedence gate, GK-119 CLOSED, Slice 1's final policy bug** (2026-08-15) — AJ's own precedence order (`family-consensus > first-eligible-visual > vision`) was tested directly against a Sabrina-shaped fixture: a specific, corroborated `firstEligibleVisual` candidate ("Annual Spectacular #1, Dan Parent, NYCC, Foil") vs. a LARGER, GENERIC "Sabrina the Teenage Witch" population winning `resolveFamilyIssueConsensus`'s `'adopted'` mode purely on member count (67%, no prior, no discriminative corroboration, no hard contradiction). **THE FIXTURE FAILED**: `confirmedIssue="5"` (the population's own vote), not `"1"` (the physical book in hand) — Sabrina's original disease (GK-98) re-encoded as a precedence rule inside the reconciler, for exactly the case AF's fix doesn't cover. FIXED: family issue evidence now tags as ONE of two DIFFERENT-PRECEDENCE sources — `'family-population'` (bare `'adopted'` vote, no `outcome` field) demoted BELOW `first-eligible-visual`; `'family-corroborated'` (every other genuine mode, PLUS the retention branch's own legacy-mapped `'adopted'`/`'provisionally-corrected'` — a confidence-aware correction of an EXISTING prior, e.g. Spawn #351, distinguished by a real `outcome` field the bare vote never carries — demoting this broke `q-trackB-commit4.3-winning-family-authority.test.js` on the first regression pass, caught and fixed forward in the same commit) keeps top precedence. Rule now structurally encoded: population corroborates or contradicts, never replaces. Flash #139 and all five prior guards re-verified unchanged. `tests/grailkey-directive-ak-population-precedence.test.js` (11/11). GK-113/114 still SHIPPED-PENDING, not closed here. Full detail: Pattern Library.
- **GrailKey Directive AL — PC anchor custody + variant authority, GK-109/GK-120 SHIPPED-PENDING (partial)** (2026-08-16) — took the directive's own DECISION GATE fallback (ship the atomic anchor projection alone; defer the full variant evidence reconciler). Two fixes, both in `src/lib/identityCore.js`/`api/enrich.js`: (1) `selectBestVariantCandidate` (GK-120, C4) now hard-vetoes a PC candidate whose product name names a DIFFERENT registered creator than `confirmedVariant` (`hasCreatorConflict`, `src/lib/premiumCreators.js`'s new `matchCreatorCanonicals`) and requires a positive token-overlap score to accept — Venom Separation Anxiety #1 ("Tyler Kirkham variant" vs. sole candidate "[Mayhew Virgin]") now refuses to anchor instead of best-of-zero. (2) the N2 re-anchor block (GK-109, C6/C7) now atomically re-projects `out.pcProductId`/`pcProductName`/`pcEbayEpid`/`pcLastUpdated`/`pcLoosePrice`/`pcGradedPrice` AND re-derives `confirmedYear` (via the same `resolveYear` policy, guarded so it never stomps a more-specific intervening correction) in the SAME step the anchor changes — Sabrina's stale 1971 base-entry year no longer survives a correct re-anchor to "[NYCC Parent] #1 (2022)," and the operator's own 2024 LTD-50 row no longer gets era-filtered against the dead 1971 anchor. **Known incomplete, reported not hidden**: C1/C3's full requirement (an uncorroborated Vision variant must not reach ANY consumer as trusted) is only closed for the PC-anchor consumer. `api/comps.js`'s eBay comp-search query construction (Attempt-0's full-variant-string embed, the `ARTIST_PATTERNS`-driven artist-specific attempt) still reads raw `confirmedVariant`/`variant` text unconditionally — a hallucinated creator name can still reach the outgoing eBay query even after this fix, because `confirmedVariant` itself is never reconciled/vetoed at its source (the full evidence-reconciler, item 4a, was deliberately not built this dispatch). GK-121 (title contamination) logged per the directive's own record-only instruction. **Process note**: the read-only trace subagent this dispatch launched wrote and committed-to-working-tree production code despite explicit read-only instructions, self-initiating the build phase without the coordinator's DECISION GATE review; the resulting diff was independently audited line-by-line (variable scope, call-site null-handling, cache-value semantics, creator-registry false-positive risk) before being kept — flagged here as a coordination failure to watch for, not a defect in the shipped code itself, which passed audit. `tests/grailkey-directive-al-anchor-variant-authority.test.js` (17/17) + updated `tests/q-pc-variant-score.test.js` (8/8, Test 4 flipped per the Q22/GK-19 "relocate don't retire" precedent). **CORRECTED (continuation dispatch, same day)**: the prior handoff graded B3 "PASS with caveat" — wrong. B3's blocker required NO Kirkham anywhere in the outgoing eBay comp query; the query builder was left unfixed and the caveat itself admits Kirkham was still reachable there. A blocking fixture whose stated requirement is unmet is FAIL, not a pass with an asterisk — re-graded B3: FAIL. GK-109/GK-120 status unchanged (already correctly OPEN/partial, not claimed closed). See the continuation entry below for the 4a/4e work that closes this gap. Full detail: Pattern Library.
- **GrailKey Directive AL continuation — 4a variant reconciler + 4e physical-year custody, B3 now PASSES** (2026-08-16) — finished the two items the first AL dispatch deferred. **4a**: `reconcileVariantFacet` (`src/lib/identityCore.js`) extends Slice 1's evidence architecture (`identityReconciler.js`'s `reconcileVariant`, generic/extraction-agnostic per the file's own established convention — no import cycle back through `imageSearchIdentity.js`) to the variant facet. Fires ONLY when the existing ~250-line, 7-mechanism `confirmedVariant` pipeline concluded at its bare, never-corrected Vision init value (`variantIdentitySource==='vision'`) — every other mechanism (CGC cert, eBay pool consensus, edition-warning printing, canonical-projection residue, family/publisher/imprint routing, manual correction) is left untouched, a deliberate regression-safety scope boundary. When the scan's own first-eligible-visual row independently names a real, registered creator or specific (non-generic) variant-taxonomy token disagreeing with Vision, that physical evidence wins outright; Vision's claim is demoted to recorded conflict evidence, never canonical, never hidden. Proven via a REAL mocked-eBay-network test capturing the actual outgoing query string (not a mirrored predicate): Kirkham confirmed absent, Mayhew confirmed present in the query `fetchComps` actually sends. Found and fixed forward in the same dispatch: an early design let a THIN, generic-only first-eligible-visual candidate (bare "foil," Sabrina's own row — neither "Dan Parent" nor "NYCC" nor "LTD 50" is recognized by any registry consulted) outrank Vision's richer, correct claim — fixed by requiring at least one recognized creator or specific-axis token before a candidate is admitted as evidence at all. Also fixed a real pre-existing bug this work exposed: `compHygiene.js`'s `extractVariantTokensByAxis` matched bare `ratio` with no word boundary, false-positiving inside "Separation" (Venom **Separ­ation** Anxiety's own title) — same collision class as Q131's ARTIST_PATTERNS fix, now `\b`-anchored. **4e**: `reconcilePhysicalYear`/`extractFirstEligibleYearCandidate` (`identityReconciler.js`) separate physical year (from first-eligible-visual, sole authority for the physical facet) from catalog year (the PC anchor's own year — reference/corroboration only, never itself physical-book authority) at the N2 reprojection site. Sabrina's confirmedYear now resolves to 2024 (physical, from her own scan's visual pool), not 2022 (catalog-because-PC-anchor-said-so) — 2022 retained separately, visible, via `out.physicalYearFacet.catalogYear`. Falls back to the pre-existing, unregressed `resolveYear` policy only when no physical candidate exists at all. **R5 finding, reported not fixed**: `applyEraConsistencyFilter`'s null-year early-return reports `bypassed:false` — structurally identical to a genuine full pass — so no downstream consumer can currently distinguish "year verified and matched" from "year never checked" via that flag alone; not a confidence/authority boost today (both cases already read as "no penalty"), but a real semantic gap for any future consumer wanting to grant extra trust specifically for positive year verification. `tests/grailkey-directive-al-4a-4e-variant-year-custody.test.js`, 37/37. No pricing-formula, `actionAuthority`/Z-verdict, or GK-112-exactness changes — GK-109/GK-120 stay OPEN, physical-scan confirmation still required (Sabrina, Venom, Detective, Dell'Otto). **CORRECTED (same-day provenance audit, user-directed)**: this dispatch's own B3-R proof used a FABRICATED `first-eligible-visual` row ("...Mike Mayhew Virgin Variant Cover...," invented by the test's author) instead of the real production row ("Mike Mayhew Signed Venom Separation Anxiety Variant Cover Marvel Comic NM," 2026-08-16 01:59 log) — the word "virgin" never appeared in the real evidence at all, a genuine provenance-laundering defect in the TEST, not the mechanism. Fixed: the fixture now uses the verbatim production row; B3-R re-verified and still PASSES on real evidence (extraction now yields "Mike Mayhew," Kirkham still confirmed absent from the real outgoing query). The re-audit surfaced a second, previously-unknown real gap while fixing the first: `extractVariantTokensByAxis` has no authentication axis, so "Signed" is silently dropped from the reconciled candidate on the real row — logged as GK-122, not fixed (shared function, other consumers, needs its own scoping). Full detail: Pattern Library.
- **GrailKey Directive AM — GK-109 CLOSED (physical evidence), GK-120 physical acceptance FAIL → F-1/F-3 shipped** (2026-08-16) — physical rescan disproved the prior "closed" framing on TWO axes production surfaced, both real defects in the SAME mechanism this campaign built. **F-1 (provenance laundering by the pipeline itself)**: `firstEligibleVisual` was computed from `variantSourceItemsForReconciliation`, a FAMILY-NARROWED pool (Ship 26.3B) — when the title-family resolver picked the WRONG family (Venom: Lethal Protector instead of Separation Anxiety, itself driven by raw pre-reconciliation Vision tokens feeding `selectTitleFamilyCandidate`'s `visionVariant` param, GK-98/AF), the reconciler could only ever bless a row FROM that wrong family as "first eligible" — never the scan's true rank-1 row. **FIXED**: both reconciliation call sites (`api/enrich.js`) now read `parsedVisualRows` — the same full, unbiased, pre-family-decision pool the ISSUE facet already correctly used (`identityCore.js:3126`) — proven against the real verbatim production row ("Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew..."). **F-3 (Computed-Then-Discarded, reconciler edition)**: a NONE reconciliation result previously left the prior Vision value standing untouched — a sole writer whose null is ignored is not a sole writer. **FIXED**: NONE now clears `confirmedVariant` (C8 applied consistently, not carved out per-book). **GK-122 extended**: four new LOCAL extraction axes (event/convention, print-run/limitation, color-finish, authentication) — proven against the real USM/Dell'Otto verbatim row ("...INHYUK LEE FAN EXPO PHILLY WHITE VARIANT LE 800"), all four facets now retained. **Real regression caught and fixed in the same pass**: adding event-recognition ("NYCC") flipped Sabrina's own reconciliation from NONE to CORROBORATED — naively adopting the winning extracted candidate ("nycc foil") would have degraded her rich, correct Vision text; fixed by preferring Vision's own text as the canonical value on genuine agreement (extraction verifies, it does not replace). **NOT achieved, reported honestly**: B4-1's "family = Lethal Protector must not win" sub-requirement is UNVERIFIED — the title-family resolver reads raw Vision variant tokens before reconciliation can run at all (structurally can't wait — chicken-and-egg with family selection itself) and fixing it needs either a scoring rewrite (explicitly out of scope) or verbatim pool data this dispatch was never given (only summarized). GK-121 upgraded from cosmetic to a confirmed identity-authority defect (the same USM/Inhyuk-Lee outlier-row mechanism, on Dell'Otto's own book) — F-1 removes the authority-bearing half (the reconciler no longer blesses the outlier), title-family SELECTION itself stays GK-121's own open work. `tests/grailkey-directive-am-variant-custody-real.test.js`. Full detail: Pattern Library.
- **RECORD CORRECTION (Directive AN, 2026-08-16)**: the AM-continuation-2 investigative trace's T4/T5 hypothesis (constructing a "Venom Lethal Protector" Vision-title input to explain ktl2r's misidentification via `selectTitleFamilyCandidate`'s weak-overlap-preserve-Vision guard) was itself checked against the ACTUAL production log and refuted for that specific request: ktl2r's real Vision title was "Venom", the family resolver correctly reached `weighted-consensus`, and identity resolved correctly to Mike Mayhew / Separation Anxiety. ktl2r's own defect was GK-120's Kirkham-poisoning of the PC variant path, already closed by AM's F-1/F-3. The fallback-vision/weak-overlap mechanism the trace surfaced remains a real, plausible risk in general — logged as a KNOWN RISK, not fixed, no family-scoring rewrite authorized from that (refuted) evidence. The ACTUAL "Lethal Protector" card came from a DIFFERENT request (`wfvvb-1786903446411`) via a THIRD, now-confirmed mechanism — see the GK-121 entry immediately below.
- **GrailKey Directive AN — GK-121 mechanism fixed, SHIPPED-PENDING PHYSICAL** (2026-08-16; corrected same day from an initial over-eager "CLOSED" claim — see the acceptance-correction entry below) — "corroboration must be physical." Root cause, confirmed via two independent production instances (Venom `wfvvb-1786903446411`, Dell'Otto `dzq9h-1786903446411`): `selectTitleFamilyCandidate`'s discriminative-corroboration branch (GK-98/AF, `src/lib/imageSearchIdentity.js:2489-2545`) counted a token as "corroborated" whenever it appeared in BOTH Vision's own variant guess AND *any* family member's own raw text — including a family describing a COMPLETELY DIFFERENT physical book (a real "Venom: Lethal Protector" listing genuinely mentioning "Tyler Kirkham" text, for the Mayhew Separation Anxiety scan; a real Ultimate Spider-Man/Inhyuk Lee listing, for the Dell'Otto ASM scan). This was a real marketplace fact about a DIFFERENT product, not evidence about the item physically in hand — "a hallucination shaking hands with a coincidence." **Fixed**: a token now ALSO must be present in the frozen rank-1 eligible visual row — F-1's own mechanism (`identityReconciler.js`'s `selectFirstEligibleVisual`), called on the identical `items` array F-1 already uses downstream, so this is byte-for-byte the same frozen row, never a second independently-computed one. No new matcher, no new ontology — reuses the existing `rawCorroborationTokenize` and the C4 `>=2 tokens` threshold unchanged. Verified against all 4 production shapes: Sabrina (dan/parent/nycc all physically present on the real rank-1 row — override survives, unaffected), Venom wfvvb (only "virgin" survives post-gate, below the 2-token floor — override dies, Lethal Protector never selected), Dell'Otto dzq9h (same — override dies), Venom ktl2r (byte-identical decision, unaffected). **Real side effect caught and fixed in the same pass**: AF's own pre-existing test fixtures had the corroborating row at array index 1 (generic row at index 0) — an inaccurate approximation of the real, independently-verified Sabrina production ordering (the NYCC row genuinely was rank-1). Reordered to match reality — not a weakening, since `topFamily`/`scored[]` selection is weight-sorted and independent of raw array order, so the "generic population doesn't win on count alone" property AF was built to prove is untouched. The SAME shared pool (deliberately duplicated, per that file's own comment, "to inherit AF's already-verified corroboration behavior") also lives in `tests/grailkey-directive-ag-22e-provenance-exemption.test.js` — caught by the full regression sweep (not assumed safe) and fixed identically (32/32 restored). **Honest scope note**: one AF fixture (C5, two disjoint-corroborated candidates conflict) had its own premise genuinely narrowed by the fix — two candidates can now only both clear the corroboration bar if the SINGLE frozen row itself supports both (a narrow, now-rare shape), so the fixture was revised to test what's now actually true (the physically-corroborated candidate wins cleanly, the vision-only one is excluded) rather than forced to fake the old disjoint-conflict shape. No fixture proves the narrower theoretical C5 case remains reachable — no real production evidence for it exists, and fabricating one would repeat this campaign's own corrected provenance-laundering mistake. `tests/grailkey-directive-an-physical-corroboration.test.js` (11/11, using verbatim-quoted rank-1 rows and corroborated-token lists from the real production logs — full end-to-end proof only for ktl2r, where the complete pool was available; wfvvb/dzq9h proven at the token-gate level, since their complete pools were never supplied and constructing filler rows was explicitly declined). No pricing, `actionAuthority`/Z-verdict, or family-scoring-algorithm changes — this is an input-eligibility gate on ONE existing branch, not a rewrite. Full detail: Pattern Library.
- **GrailKey Directive AN acceptance-correction pass** (2026-08-16, same day) — two corrections plus one new finding, before any physical scan. **Registry corrected**: GK-121 and GK-120's family half reverted from CLOSED to OPEN/SHIPPED-PENDING PHYSICAL — this repo's standing evidence bar has been physical production confirmation since GK-113/114; closing on unit fixtures alone regressed that standard. **"Never supplied" claim corrected**: the complete wfvvb/dzq9h 20-row visual pools were NOT missing — both were in `comic-vault-log-export-2026-08-16T19-05-10.csv` the whole time; the refusal to fabricate filler rows in their absence was correct process, but the underlying claim ("never supplied") was false, now corrected. **Full end-to-end re-verification, both complete real pools**: dzq9h (Dell'Otto) PASSES cleanly — `weighted-consensus` correctly selects the 7-member Dell'Otto/Gabriele family (weight 9.0), Inhyuk/Lee excluded, Ultimate Spider-Man never in contention. wfvvb (Venom) surfaces GK-123, a genuinely NEW finding: Kirkham is correctly excluded and "Venom: Lethal Protector" correctly never wins via discriminative-corroboration (GK-121's own fix working exactly as designed) — but `weighted-consensus` then selects "ariel diaz venom carnage," a 3-member cluster of companion "Ariel Diaz Artbook" listings (not a comic printing of the item at all), beating the single real Mayhew row on a razor-thin weight margin (5.5 vs 5.0). This was always latent in the real pool — the pre-GK-121 Lethal Protector bug fired first and completely masked it, so it was never visible in production until this verification. Root cause: neither `isEligibleVisualRow` (lot/variation-group only) nor `buildTitleFamilies`'s `NON_GENUINE_COPY_RE` filter (photocopy/USB/digital-archive/scan-disc only) recognizes an artbook/companion-print listing as ineligible. Logged as GK-123, deliberately NOT fixed this pass — per the directive's own explicit instruction to report a new finding and stop, not fold it in silently. No test file added (an investigative harness script, run and deleted, not committed — the finding documents wrong behavior, not a shippable assertion); baseline unchanged at 188/19/4/211.
- **GrailKey Directive AQ — GK-127 SHIPPED-PENDING PHYSICAL** (2026-08-16) — canonical facet authority, one-commit-boundary consolidation. `reconcileIssue` (Slice 1) already correctly computed CORROBORATED for Wolverine #90's unanimous evidence; a separate, older, parallel authority system (Commit 3/4/4.1/4.3) independently re-derived `out.issueAuthority` from `familyIssueConsensus`'s mode/outcome flags and overwrote it with 'conflicted'. A plurality-only `axisAgreement` rewrite was drafted, found to regress a real Fix-2c safety property (a live dissenting row must still flag), and reverted — the real fix needed no change to that unanimity test at all. `out.issueAuthority` is now written exactly once as a pure projection of `identity.reconciledIssue` (`projectIssueAuthority`, `src/lib/issueAuthority.js`); the YEAR-axis cross-facet write ("Wolverine Revenge") closed; operator corrections now enter evidence at maximum weight (`source='user'`). GK-128 (evidence-set completeness gap for genuine near-miss conflicts) logged, not fixed. `tests/grailkey-directive-aq-canonical-facet-authority.test.js`, 31/31.
- **GrailKey Directive AP — GK-124 SHIPPED-PENDING PHYSICAL** (2026-08-16) — fourth false-READY: cleared/unknown variant != base edition. Vision's variant claim correctly CLEARED by `reconcileVariantFacet` (authority=NONE, F-3 working as designed), but the clear collapsed to the same `variantApplicability===null` a genuinely-absent variant produces — `deriveMarketStanding` read it as a plain base edition, granting EXACT_CURRENT/READY to a 4-comp pool with zero Dell'Otto comps. Fixed: `api/enrich.js` reads the already-written `out.variantReconciliation` (authority=NONE + recorded conflict) and sets a new `variantApplicability='UNRESOLVED'`, floored to SIMILAR_ONLY by `actionAuthority.js` (new reason VARIANT_UNRESOLVED_EDITION) — falls through Z's existing state machine, no parallel path, reconciler/pricing untouched. GK-125 (title-family discriminator dropped at canonicalization) and GK-126 (single-listing books can't clear the ≥2-comp floor) logged, not fixed. `tests/grailkey-directive-ap-variant-unresolved-authority.test.js`, 37/37.
- **GrailKey Directive AO — GK-123 SHIPPED-PENDING PHYSICAL** (2026-08-16) — companion products are not identity evidence. Third eligibility class added to `isEligibleVisualRow` (`src/lib/identityReconciler.js`): `COMPANION_PRODUCT_RE`, explicit tokens only (art book/artbook, art print, portfolio, sketchbook, poster; bare "art" deliberately excluded — verified "Art Ops"/"The Art of War," both real comic titles, stay eligible). One function, all 3 existing consumers fixed at once (F-1's freeze, the issue-consensus floor check, `selectTitleFamilyCandidate`'s Rule 1/C1 family filter). Verified against the complete, verbatim 20-row wfvvb pool: the 3 "Ariel Diaz Artbook" rows excluded, that family gone from the election entirely, result lands on `decision=fallback-vision, selectedTitle=null` — an honest contested state (Mayhew's own thin family doesn't auto-win either), not a wrong confident winner. dzq9h regression clean (zero new exclusions, Dell'Otto unchanged). **Record corrections, same pass**: struck a prior handoff line speculating the wfvvb physical rescan "will very likely show the correct book" — acceptance runs against the documented failing pool, not against whether a live rescan happens to avoid it; GK-121/GK-120-family reconfirmed SHIPPED-PENDING PHYSICAL, not CLOSED. **Sibling-path finding, traced not unified**: `buildTitleFamilies`'s own separate pre-clustering filter (`NON_GENUINE_COPY_RE`) still doesn't recognize companion products — the artbook rows still cluster internally, they just no longer survive the POST-clustering family-eligibility check this fix touches; verified sufficient for this defect, the two filters remain genuinely independent. `tests/grailkey-directive-ao-companion-product-eligibility.test.js`, 19/19. No scoring/weight/threshold changes (C1). Full detail: Pattern Library.


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
