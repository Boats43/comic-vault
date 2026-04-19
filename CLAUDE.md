# Comic Vault PWA

## Project
Comic Vault — a progressive web app for grading, pricing, and managing comic book collections.

## Stack
- **Frontend**: React + Vite (single-page app in `src/App.jsx`)
- **Backend**: Vercel serverless functions (`api/` directory)
- **Storage**: IndexedDB (client-side), no server database
- **Deploy**: Vercel

## Build & Deploy
```bash
npm run build
npx vercel --prod
```

## Key Files
- `src/App.jsx` — entire frontend (ResultCard, CollectionDetail, grading flow, catalogue, FloatingSearchBar, BidCalculator)
- `api/enrich.js` — second-pass enrichment (PriceCharting, eBay comps, ComicVine, Ximilar, CGC lookup, GoCollect)
- `api/grade.js` — Claude Vision comic identification and grading
- `api/chat.js` — Claude collection chat (inline queries, Whatnot session context)
- `api/comps.js` — eBay Browse API comp fetching
- `api/sold.js` — eBay completed/sold listings
- `api/cgc-lookup.js` — CGC cert number verification
- `api/gocollect.js` — GoCollect CGC FMV lookup (requires GOCOLLECT_API_KEY, returns null without it)
- `api/manage.js` — collection analysis via Claude
- `api/list-ebay.js` — eBay listing creation
- `api/delist-ebay.js` — eBay listing removal

## Repo & Live
- **Repo**: Boats43/comic-vault
- **Live**: comic-vault-rouge.vercel.app

## Environment Variables
Nine keys required (all set in Vercel), one optional:
`ANTHROPIC_API_KEY`, `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_DEV_ID`, `EBAY_AUTH_TOKEN`, `EBAY_SANDBOX`, `COMICVINE_API_KEY`, `XIMILAR_API_TOKEN`, `PRICECHARTING_TOKEN`
Optional: `GOCOLLECT_API_KEY` (CGC FMV — pending approval ticket #019483)

## Open Items
- GoCollect API: approval pending (ticket #019483) — `api/gocollect.js` deployed, returns null without key. Add `GOCOLLECT_API_KEY` to Vercel env when approved.
- GPA: check gpanalysis.com for API access
- eBay Marketplace Insights: DEAD for indie devs
- Visual search: disabled for modern (1985+), active for Silver/Bronze Age only
- Android native app: PiP overlay for Whatnot live buying

## Rules
- **Never change pricing math** (grade multipliers, sanity checks, floor guard, price calculations in `api/enrich.js`) without explicit instruction.
- **Never commit without running `npm run build` first** and confirming zero errors.
- Always preserve the pricing stack order: PriceCharting -> grade multiplier -> sanity check -> defect penalty -> floor guard -> browse_api fallback.
- PriceCharting year threshold: 5 years max gap between comic year and product year.
- AI verify: accept variant/cover B listings as matches if same character + issue number.
- Variant multipliers (descending, first substring match wins): triple cover ×10, double cover ×8, 35¢/35 cent ×6, 30¢/30 cent ×4, inverted ×4, gold ×3, printing error ×3, miscut ×3, mark jewelers ×2.5, canadian price ×2, price variant ×2, type 1a/1b ×2, canadian ×1.8, whitman ×1.8, 2nd/second print ×1.5, pence ×1.5, dc universe logo ×1.5, newsstand ×1.3.
- Key issue multiplier: tiered (major ×1.5, minor ×1.2) applied after variant mult when `out.keyIssue` is set AND blendedAvg is non-null.
- Visual search only overrides with 3+ matches.
- PriceCharting skipped when issue=null.
- No premium multiplier: corner box, masterpieces, design variant, cover A/B/C/D.
- eBay listing title includes variant (newsstand, gold, 2nd print, etc.) between issue and grade — filtered by `NO_TITLE_VARIANTS` (corner box, masterpieces, design variant, cover a/b/c/d, headshot).
- Variant short keywords only in comps query attempts 1-2. Attempt 0 uses FULL variant string (e.g., "Paco Medina Thing variant") for most specific eBay search.
- Non-comic titles ("not a comic", "unknown") rejected at enrich entry.
- Sanity comparison base: `sanityCompsAvg = compsAvg` — ALWAYS raw. eBay listings already reflect market grade (sellers grade in title), so multiplying by gradeMultiplier would double-count. Both sides of the comparison (pcNum = PC base × mult, compsAvg = at-grade market) are already at-grade.
- Sanity thresholds high: `lowCompsCount<3 || isMixedFallback` → 1.25x; Golden <1970 → 3x; Silver/Bronze <1985 → 1.75x; Modern ≥1985 → 1.5x. Low: 0.5x always.
- Sanity check input preference: `fallbackMedian || blendedAvg || compsFromEbay?.average`. On any fallback flag (reprint/variant/aiVerify) uses median of `rawComps.prices` instead of mean.
- aiVerifyFallback fires when AI verify rejects every checked listing but raw comps existed — switches sanity to median of raw prices + 1.25x threshold.
- Sanity low-side condition: `pcNum < sanityCompsAvg × 0.5` only.
- **browse_api prices: NO grade multiplier.** eBay listings already reflect market grade. Grade mult only applies to PriceCharting base prices (NM-equivalent). Sanity fallback uses raw `compsAvg`, not `adjAvg`. Browse primary fallback uses `browseBase` directly. `gradeMultiplier` is still recorded on `out` for floor guard but not applied to browse_api prices.
- Variant mult: PC source only — gated by `isFromPC` flag.
- Key mult: PC source only — gated by `isFromPC && blendedAvg` (requires comps to validate).
- Key mult tiered: major (1st appearance, first appearance, origin, death, first issue) ×1.5; minor (2nd, second app, first cover, cameo, iconic, classic) ×1.2; other ×1.0.
- `isFromPC = !!priceCharting?.price && !sanityFired && out.pricingSource === 'pricecharting'` — snapshotted after PC/sanity branch, before floor/variant/key blocks.
- Floor guard field: `rawComps.lowest` (not `lowestNum`) — comps.js returns `lowest`.
- Floor guard: raw `rawFloor` (no grade multiplier). eBay comps already reflect market grade. Capped at `compsAvg`.
- eBay comps search: attempt 0 = title + issue + full variant + year + publisher (most specific, capped 100 chars); falls through to attempt 1 (short variant + year), then attempt 2 (no year), etc.
- Comps attempt loop runs filters INSIDE the loop; only breaks on `parsed.length > 0` (post-filter survivors), not `raw.length > 0`. Too-specific attempts that match only junk fall through to broader queries instead of starving them.
- `cleanTitleForSearch` replaces apostrophes/quotes/!? with a SPACE (not empty). "D'Orc" → "D Orc" so eBay tokenizes to match actual listings; empty replacement collapsed to unmatchable "DOrc".
- Browse API call: `limit=100`, `sort=bestMatch`, `buyingOptions:{FIXED_PRICE|AUCTION}`. Raises raw pool 5x and includes auction data.
- SLAB_RE (raw filter) requires explicit slab indicator — `/\b(cgc|cbcs|pgx|psa|egs|hga|slab|graded|universal|signature\s+series|verified|qualified)\s*<tier>?\s*\d+(\.\d+)?/i`. PSA (grades comics too) + EGS/HGA/CGC Signature Series covered. Bare "9.4" in a raw seller's self-grade no longer triggers the filter.
- Cover-letter matching (Filter 1d in comps.js): Cover A, B, C, D are separate books with separate prices. When our variant is empty / "Cover A" / "1st print": drop listings with Cover B/C/D/... in title. When our variant is "Cover B/C/...": keep ONLY listings with that specific letter (fall back to all if zero match).
- VARIANT_CONTAM_RE has NO bare `\bvariant\b` — "Cover A Variant" listings are commonly 1st-print Cover A. Drops only on concrete markers: virgin, foil, ratio, 1:N, incentive, newsstand, whitman, canadian.
- Lot/set filter (Filter 1e in `api/comps.js`, between cover-letter and slab): drops multi-book lot listings from single-book comps. LOT_RE alternations: `\b(lot|bundle|complete set|full run|comic library|comic collection)\b` | `#?\d+\s*[-–—]\s*#?\d+` (issue range like `#1-5`) | `\b\d+\s*(book|issue|comic)s?\s*(lot|set)\b` (qualifier REQUIRED — bare "1 Issue Comic Book" must not match) | `\bset of \d+\b`. Skipped when our book's `variant` contains `lot|set|bundle` (user explicitly cataloguing a lot).
- `out.confirmedYear` + `out.yearCorrected` surfaced from `/api/enrich`. App.jsx enrich callbacks (initial scan, auto-refresh, manual refresh, bulk import) heal `item.year` when `yearCorrected === true`.
- Year override guard (`api/enrich.js`): `confirmedYear` derivation is trust-but-verify, not blind chain. Order: (a) era-specific keyIssue regex (`silver age|bronze age|king-size|giant-size|annual|spectacular|first issue`) → trust user year; (b) PC and CV agree within ±2y → use average; (c) PC within ±2y of user → PC wins; (d) CV within ±2y of user → CV wins; (e) PC/CV both >2y from user → keep user year, set `out.yearOverrideRejected = true`, log `[enrich] year override REJECTED`. Prevents wrong-volume CV matches (e.g. Marvel Super-Heroes vol 2 1980 hijacking 1966 King-Size Special) from poisoning the comps query.
- Variant comp preference (Filter 1c): when variant set, prefer comps whose titles match variant-specific words (min 2 matches to filter, otherwise keep all).
- Atlas/pre-Marvel publishers: append "Atlas Marvel" to eBay query (sellers use both terms interchangeably).
- Dell Four Color alias (`api/comps.js`): when `publisher` contains "Dell" AND `issue > 100`, append three alias attempts — `Four Color #N <title> <year>`, `Four Color #N <title>`, `Dell Four Color N`. Also seeds `four`/`color` into `searchTokens` so alias-only listings (without character name) pass the title-overlap filter. Dell's Four Color anthology ran issues 1-1354 (1939-1962), one character per issue, and sellers list three ways.
- Artist-specific variant priority (`api/comps.js`): when `variant` matches ARTIST_PATTERNS (skan, rapoza, quash, momoko, ross, adams, kirkham, bean, andolfo, browne, forstner, howard, corona, stegman, ottley), `attempts.unshift` an `artist-specific` query: `<title> #<issue> <artist> [virgin] <year> <publisher>`. If the winning query lacks the artist name, returns `artistFallback: true` + `compBasis: 'generic-variant-fallback'`. Surfaced via `out.artistFallback` / `out.compBasis` from `/api/enrich` in both the pricecharting and browse_api branches.
- Auto-refresh stale prices: collection tab only, no book detail open (`selectedItem === null`), 60s cooldown via `lastAutoRefreshRef`.
- Sold comps: filtered by `#issue\b` regex before blending into `soldAvg` — prevents wrong-issue sold data from corrupting the 60% sold weight.
- Bulk import: non-comic rejection, duplicate detection, publisher-as-title guard, full enrich field parity with single scan.
- GoCollect CGC FMV: runs in enrich Promise.all, returns null without API key. Shows purple panel in CollectionDetail with FMV at 9.8/9.6/9.4. Submit recommendation: `fmv98 > rawEquiv + $50 && gap >= 2x`. Manual override via `item.userFmv98` persisted to IndexedDB.
- Buyer sessions stored in localStorage key `cv_buyer_sessions` (last 100 entries).
- Budget persisted in localStorage key `cv_buyer_budget`.
- Buyer settings persisted in localStorage key `cv_buyer_settings` (whatnotFee, supplies, labor, minProfit).
- Net profit formula: `marketValue - marketValue*(whatnotFee/100) - supplies - labor - bid`.
- BUY/PASS auto-suggested: BUY when netProfit ≥ minProfit and within budget; PASS otherwise.
- Net profit color: green ≥ minProfit, yellow > 0 but < minProfit, red ≤ 0.
- FloatingSearchBar has two modes: 🔍 search (local filter) and 🧠 claude (AI query) — never mix.
- Share Target switches to Buyer tab, strips `?share-target=1` from URL, clears widgetMode, and calls `gradeBlob(blob, { save: false })` — no widget overlay.
- Collection list paddingBottom is dynamic: 220px when Claude card visible, 100px otherwise.
- `api/chat.js` receives optional `buyerSessions` with Whatnot buying history for Claude context.

## Verified Pricing Fixes — 4/15/2026 (commit 8d70e12 → 47705c7)
All pricing fixes confirmed intact:
- **NO_PREMIUM**: corner box, masterpieces, design variant, headshot, trading card, cover a/b/c/d, marvel legacy, legacy
- **Key mult tiered**: major ×1.5 / minor ×1.2 — gated by `isFromPC && blendedAvg` (no comps = no key mult)
- **Blended comps**: `soldAvg * 0.6 + activeAvg * 0.4` (sold-only ×1.1, active-only as-is)
- **Sanity check**: uses blendedAvg, thresholds 0.5x low / 2x modern / 3x Silver high
- **Floor guard**: `rawComps.lowest × gradeAdj`
- **Variant filter**: comps.js drops variant/virgin/foil/ratio/incentive listings when not searching for variant
- **Share target**: SW cache + Vercel fallback route + 6× retry in App.jsx

## Features
- **Bundle listing**: Manage tab → "📦 Create Bundle" chip → tap tiles to multi-select → floating bar shows `$sum → $bundlePrice (18% off)` → "List Bundle" posts to `/api/list-ebay` with `{ bundle: true, items: [...] }` → single eBay listing (all items marked `status:"listed"` with shared `ebayItemId`/`bundleId`). ERA auto-detected from earliest book year (Golden <1956, Silver ≤1970, Bronze ≤1984, Copper ≤1991, Modern 1992+). Claude BUNDLE actions pre-select recommended comicIds into selection mode.
- **Watch Mode**: Buyer tab → "👁 Watch Mode" → rear camera captures JPEG frames every 3s → `/api/grade` (self-correcting pipeline) → dedup by `title|issue` key → `/api/enrich` on new comic → shows Market + Net @ bid. Voice context (Web Speech API, continuous mode) and text hint input share `watchContext` state → appended as `"Seller said: {context}"` in grade prompt. Auto-bid parses `$N` from speech transcript. Android browser fallback: "Type context above instead" on SpeechRecognition failure.
- **Watch Mode self-correcting pipeline** (`api/grade.js`): Pass 1 — Sonnet fast ID (watch-optimized prompt: "read directly from cover, do not infer"). If confidence=high and title not unknown → return (1 pass). Pass 2 — Sonnet self-correction: sends same frame + pass 1 result as context, asks to review/correct issue number, grade, variant. If confidence not low → return (2 passes). Pass 3 — Opus escalation: full standard prompt for final answer (3 passes). Response headers: `x-watch-passes` (1/2/3), `x-watch-timing` (JSON ms per pass). Standard (non-watch) requests use single Opus call unchanged.

## Session 4/15/2026 — optimistic UI, editable list price, bundle listing
(1) **Optimistic UI for catalogue field updates** (`bd4f319`): `updateComicField` now calls `setCatalogue` + `setSelectedItem` first so ROI / derived views render instantly, then fires `putComic(updated).catch(...)` in the background without `await`. Applies to every `onUpdateField` caller. Fixes perceived lag on "What did you pay?" blur — root cause was `putComic` rewriting the full record (including base64 `images` blob, 100-500 KB) on every field change. Added Enter-key → blur → commit on the purchasePrice input.
(2) **Editable list price before eBay listing** (`fec065a`): CollectionDetail and WidgetOverlay expose a numeric `listPrice` input above the List on eBay button. Button label live-reflects the value; `handleList` passes `{ ...item, price: "$X.XX" }` so the override drives eBay StartPrice AND persists to the catalogue record. Resets on item change via `useEffect([item?.id])`. ResultCard is display-only — no listing button there, so not included.

## Session 4/15/2026 — chat hardened, bundle live, audit complete
(1) Full pricing audit verified all 5 fixes intact on `8d70e12`: NO_PREMIUM list, key mult ×1.5 PC-only, sanity low `<0.5×`, sanity high `2×` modern / `3×` Silver, floor `rawComps.lowest × gradeAdj`, share target SW+vercel+retry.
(2) Bundle listing feature shipped (`8d70e12`): `api/list-ebay.js` bundle branch (18% off sum, era-derived title, per-item HTML description, up to 12 cover photos); Manage tab "📦 Create Bundle" chip → checkbox tiles → floating bottom bar → single eBay listing, all items marked `status:"listed"` with shared `ebayItemId`/`bundleId`. Claude BUNDLE action pre-selects recommended comicIds.
(3) `api/chat.js` hardening (`d218b95` + `951a13c`): top-20 by displayPrice sent to Claude (totalValue still from full collection); 8s `Promise.race` timeout returns friendly fallback instead of 500; accepts both flat-array and nested `{ books:[...] }` collection shapes.
(4) Production test against `/api/chat` with 5-comic sample: 4.5s response, 2 actions (List + Bundle), 4 metrics, 3 signals — healthy.

## Session 4/15/2026 — pricing calibration: blended comps, tiered keys, variant filter
(1) **Blended comps** (`9b9de52`): `enrich.js` computes `blendedAvg` from sold comps (60%) + active comps (40%) after Promise.all. Sold-only uses ×1.1 bump. Sanity check now uses `blendedAvg || compsFromEbay?.average` for better market signal.
(2) **Tiered key multiplier** (`9b9de52`): replaces flat ×1.5 with major (1st appearance, origin, death, first issue) ×1.5 / minor (2nd, second app, first cover, cameo, iconic, classic) ×1.2 / other ×1.0.
(3) **Key mult requires comps** (`47705c7`): key multiplier gated by `blendedAvg` — without comps to validate, no multiplier applied. House of Secrets #92 FN- 5.5 now prices at $644 (PC × grade) instead of $966 (inflated by key mult with no market validation).
(4) **Variant contamination filter** (`9b9de52`): `comps.js` adds Filter 1b — drops listings with variant/virgin/foil/ratio/incentive keywords when NOT searching for a variant. Thor #338 comps avg dropped from $52.75 to $35.90 after filter.
(5) **Minor key detection broadened** (`47705c7`): `keyStr.includes('2nd')` and `keyStr.includes('second app')` added to isMinorKey for Thor #337 "2nd app Beta Ray Bill" and similar.

## Session 4/15/2026 — Watch Mode: voice, text context, Sonnet routing
(1) **Sonnet model routing** (`fb40e45`): `api/grade.js` routes `body.source === 'watch'` to `claude-sonnet-4-20250514`, all other requests stay on `claude-opus-4-6`. WatchMode sends `source: 'watch'` in POST body. ~5x cost reduction per frame.
(2) **Voice context** (`4182221`): WatchMode mic button toggles Web Speech API continuous recognition. Transcript stored in `watchContext` state, sent as `voiceContext` in grade POST. `grade.js` appends `"\nSeller said: {context}. Use this context to improve accuracy."` to user prompt. Auto-bid: regex extracts first `$N` from transcript → sets bid → shows voice note.
(3) **Text hint input** (`4182221`): text input below camera preview shares `watchContext` state with voice — last one wins. Clear button (✕) resets both.
(4) **Android browser fallback** (`a38069f`): SpeechRecognition constructor check + try/catch on `.start()` + onerror handler all show "Type context above instead" instead of crashing. Three failure points covered.
(5) **Self-correcting pipeline** (`6784aed`): `api/grade.js` rebuilt with multi-pass watch pipeline. Pass 1 Sonnet fast ID with watch-optimized prompt ("read directly from cover"). High confidence → return immediately. Pass 2 Sonnet self-correction with pass 1 context. Pass 3 Opus escalation if still low confidence. Shared helpers: `buildImageContent`, `callModel`, `parseResponse`. Response headers `x-watch-passes` and `x-watch-timing`. Standard (non-watch) path unchanged — single Opus call.

## Session 4/15/2026 — UX polish + variant pipeline fix
(1) **Back button returns to correct tab** (`839f5e9`): `prevTabRef` tracks which tab opened CollectionDetail. Back from Manage → returns to Manage tab with scroll restored. Android back gesture intercepted via `popstate` listener — closes detail view instead of exiting app.
(2) **Swipe navigation** (`0b20db7`): touch swipe left/right on CollectionDetail navigates between comics. 50px threshold to avoid accidental triggers. First-use hint "← swipe to navigate →" fades after 2s, persisted in `cv_swipe_hint_seen` localStorage.
(3) **Stats bar** (`9d096a3`): one-line bar below title in CollectionDetail — grade pill + price + last sold + asking range (low–high from comps).
(4) **Photo angle prompts** (`927d54e`): photo strip shows labeled placeholder buttons for missing angles (Front/Back/Spine/Pages). 1 photo → 3 placeholders, 4+ → none. Each tappable to open camera.
(5) **Variant in eBay listing title** (`1cdf988`): `buildTitle` in `list-ebay.js` now includes `item.variant` between issue and grade. Filtered by `NO_TITLE_VARIANTS` (corner box, masterpieces, design variant, cover a/b/c/d, headshot) — these add no search value. Same filter applied to `buildBundleTitle`. Pipeline trace confirmed variant flows: grade.js → App.jsx → enrich.js → comps.js (attempts 1-2 only) → list-ebay.js (was missing, now fixed).

## Last Session
Session 4/18/2026 (latest) — lot/set/bundle comp filter:
(1) **Lot filter** (`3420902`): new Filter 1e in `api/comps.js` between cover-letter (1d) and slab (Filter 2). Multi-book lot listings inflated single-book comp averages — repro: Dark Horse Comics #1 (1992) had a $33.72 comp that was actually `#1-5` 5-book lot. LOT_RE: `/\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection)\b|#?\d+\s*[-–—]\s*#?\d+|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b|\bset\s*of\s*\d+\b/i`. Spec deviation from user request: `(lot|set)` qualifier on the `\d+\s*(book|issue|comic)s?` alternation made REQUIRED (not optional) — without it, "1 Issue Comic Book" (extremely common single-issue title fragment) matches and would wipe the comp pool. Skips entirely when `variant` contains `lot|set|bundle` (user knowingly cataloguing a lot). Each rejection logs `[lot-filter] rejected: <title prefix>`. After fix Dark Horse Comics #1 1992 VF+ 8.5 returns 4 single-issue comps avg $6.60 (range $3.78–$12), price $5.54 from PriceCharting (sanity passed).

Session 4/18/2026 (late) — year override guard:
(1) **Year override guard** (`523ce2b`): `api/enrich.js` `confirmedYear` derivation rebuilt from blind `pc?.year || cv?.coverDate?.slice(0,4) || year` chain to trust-but-verify. Branches in order: (a) era-specific keyIssue regex (`silver age|bronze age|king-size|giant-size|annual|spectacular|first issue`) → trust user year + log `[enrich] era-specific key — trusting user year`; (b) PC and CV agree within ±2y → average them; (c) PC year within ±2y of user → PC wins; (d) CV year within ±2y of user → CV wins; (e) both PC and CV diverge from user by >2y → keep user year, set `out.yearOverrideRejected = true`, log `[enrich] year override REJECTED: user=X pc=Y cv=Z`. Original log line `[enrich] year corrected: A → B` retained when the chosen value differs from user input. Repro: Marvel Super-Heroes #1 1966 FN 6.0 with `keyIssue: "King-Size Special #1"` — before fix ComicVine matched vol 2 (id 1035124, coverDate 1980-12-01), `confirmedYear` flipped to 1980, comps query went out as `… #1 1980 Marvel`, AI verify dropped 4/5 leaving one 1980 Spring Special at $9.99 → final $11.49. After fix era-specific branch fires on "King-Size", confirmedYear stays 1966, comps query is `… #1 1966 Marvel`, 5 Silver Age listings survive (avg $22, range $10–$46), final $25.30 / confidence MEDIUM. `out.yearOverrideRejected` only set on branch (e) — branch (a) returns user year via the era-specific path without the rejected flag.

Session 4/18/2026 — Dell Four Color alias + artist-specific variant matching:
(1) **Dell Four Color alias** (`b25e9c4`): `api/comps.js` now detects `publisher` containing "Dell" + `issue > 100` and appends three alias attempts before dedupe — `Four Color #<iss> <title> <year>`, `Four Color #<iss> <title>`, `Dell Four Color <iss>`. Also seeds `four`/`color` into `searchTokens` so alias listings that omit the character name survive the title-overlap filter. Dell's Four Color anthology ran issues 1-1354 (1939-1962) as a one-character-per-issue series; eBay sellers list all three ways. Character-only query (attempt 0) already existed — this adds the two alias forms.
(2) **Artist-specific variant priority** (`42947dd`): `api/comps.js` ARTIST_PATTERNS list (skan, rapoza, quash, momoko, ross, adams, kirkham, bean, andolfo, browne, forstner, howard, corona, stegman, ottley) tested against `variant`. On match, `attempts.unshift` an `artist-specific`-labeled query: `<cleanTitle> #<iss> <artist> [virgin] <year> <publisher>` capped at 100 chars. Loop tracks `attemptLabel` on the winning attempt. `artistFallback = !!artistName && !winningQuery.includes(artistName)` — set when we fell through to a generic virgin/variant query. Returns `artistFallback` + `compBasis: 'generic-variant-fallback'` on the comps object. `api/enrich.js` surfaces both on `out.artistFallback` / `out.compBasis` in both the pricecharting branch and (separately) for browse_api-only books. Fixes Skan/Rapoza/Momoko/etc virgin variants being compared against generic-virgin comp pools from unrelated artists.

Session 4/17/2026 (late) — median fallbacks, sanity re-tier, comp pool expansion, year heal:
(1) **Median on mixed-print fallback** (`ff5758a`): `api/enrich.js` adds `median()` helper. When `reprintFallback` or `variantFallback` is set, sanity `compsAvg` becomes `median(rawComps.prices)` instead of the mean — filters 1st/4th print price mixes where the mean is meaningless. Tightens sanityHighMult to 1.25x on any mixed fallback.
(2) **AI verify fallback** (`80f35fb`): when `verifyCompsTitles` rejects every checked listing but `rawComps.prices` still has entries, set `rawComps.aiVerifyFallback = true` so sanity treats it the same as reprint/variant fallback. Surfaces `out.aiVerifyFallback` on the response.
(3) **Apostrophe handling** (`eac6188`): `cleanTitleForSearch` in `api/comps.js` replaces `/['"!?]/g` with a SPACE instead of empty string. "D'Orc" → "D Orc" (two tokens) rather than "DOrc" (one unmatchable token). Fixes eBay coverage for apostrophe titles.
(4) **Sanity raw compsAvg on fallback** (`eac6188`): `sanityCompsAvg = isMixedFallback ? compsAvg : compsAvg × mult`. Prior adjAvg-based comparison inflated the guardrail by the grade multiplier and masked PC outliers when a fallback flag was active.
(5) **Attempt loop continues on empty post-filter** (`eac6188`): `fetchComps` in `api/comps.js` now inlines the full filter chain inside the attempt loop and only breaks on `parsed.length > 0`. Previously broke on `raw.length > 0`, so a too-specific query that matched 5 junk listings starved the broader fallback queries.
(6) **confirmedYear surfaced + client heal** (`eac6188`): `api/enrich.js` writes `out.confirmedYear` and `out.yearCorrected`. App.jsx enrich callbacks (scan, auto-refresh, refreshMarketData, bulk import) update `item.year` when yearCorrected === true. Catalogue entries stored with a wrong year get healed on next refresh.
(7) **Tighter sanity thresholds** (`084a8ca`): added `lowCompsCount = (rawComps?.count || 0) < 3` guard → 1.25x. Retiered modern: Golden <1970 → 3x, Silver/Bronze <1985 → 1.75x, Modern ≥1985 → 1.5x. Replaces the prior 3x (pre-1985) / 2x (modern) scheme.
(8) **Comp pool expansion** (`5bcfe91`): `api/comps.js:tryBrowse` now uses `limit=100` (was 20), `sort=bestMatch` (was endingSoonest), and `buyingOptions:{FIXED_PRICE|AUCTION}` (was FIXED_PRICE only). 5× raw pool, relevance-ranked, auction bids included.
(9) **SLAB_RE tightened** (`5bcfe91`): raw-search slab filter requires an explicit slab indicator (cgc|cbcs|pgx|slab|graded|universal) before the numeric grade. Bare "9.4" in a raw seller's self-grade no longer drops the listing.
(10) **Variant regex loosened** (`5bcfe91`): dropped bare `\bvariant\b` from VARIANT_CONTAM_RE. Sellers commonly append "variant" to 1st-print Cover A titles generically. Kept concrete markers (virgin/foil/ratio/1:N/incentive/newsstand/whitman/canadian).
(11) **Sanity double-grade fix** (`cbcc590`): `sanityCompsAvg` is now always raw `compsAvg` — removed the `isMixedFallback ? compsAvg : compsAvg × gradeMultiplier` conditional. Both sides of the comparison are already at-grade (pcNum = PC × mult, compsAvg = at-grade market), so multiplying compsAvg by mult inside the comparison double-counted the grade adjustment. D'Orc #1 PC $193 passed the old guardrail at $111 × 2.2 × 1.5 = $367 but fires correctly at $111 × 1.5 = $167.
(12) **PSA + cover variant filter** (`ae78d5d`): SLAB_RE expanded to match `psa | egs | hga | signature\s+series | verified | qualified` in addition to CGC/CBCS/PGX — PSA 9.8 slabs were leaking into raw comps. New Filter 1d enforces cover-letter matching: Cover A / no variant / "1st print" drops Cover B/C/D+ listings; specific Cover B/C/... variants keep only that letter with graceful fall-back to all if zero match.
End-to-end verification on D'Orc #1 (Image 2026 NM 9.4 Cover A, stored year 2025): 2 comps → 5 comps → 2 Cover-A-only, price $275.49 → $91.23 with priceNote "PC too low — eBay avg used" and `yearCorrected: true` / `confirmedYear: 2026`. Key mult no longer stacks on browse_api source; no PSA / Cover B / Cover C listings in the comp pool.

Session 4/17/2026 (early) — comps hardening, prompt fixes, import race, bulk HOT listing:
(1) **Comps grade proximity — raw letter grades** (`5279383`): new `parseListingGrade(title)` in `comps.js` recognizes CGC numeric slabs AND raw letter grades (NM/MT, NM+, NM-, NM, VF/NM, VF+, VF-, VF, FN/VF, FN+, FN-, FN, VG/FN, VG+, VG-, VG, GD/VG, GD+, GD-, GD, FR/GD, FR, PR). Filter tolerance widened from ±1.0 to ±1.5. Rejections logged with listing grade + our target.
(2) **Comps listing dedup** (`5279383`): Filter 5 — after all other filters, dedup on `price|title[0:35].lower()` to catch eBay returning the same row twice in one batch. Query-level dedup (line 472) was already in place — this adds row-level.
(3) **Newsstand in VARIANT_CONTAM_RE** (`5279383`): regex extended with `newsstand | whitman | price variant | type 1`. Previously only `variant/virgin/foil/ratio/1:N/incentive` — newsstand copies were leaking into non-variant searches and inflating blended avg.
(4) **Grade filter applies to raw searches** (`694f3ed`): removed `!rawOnly` gate from Filter 3 in `comps.js`. VF+ listing will no longer show up in VG 4.0 raw comp pull.
(5) **Year accuracy prompt** (`add3412`): `STANDARD_PROMPT` in `api/grade.js` now includes explicit year instruction — "read from cover price box, indicia, or copyright notice", explicit 2025/2026 examples, "never default to 2024 for recent books", context-clue fallback (art style, cover price, characters). Addresses model defaulting to training-data year on modern books like D'Orc #1 (2026).
(6) **Publisher-as-title WARN not BLOCK** (`add3412`): `handleBulkImport` no longer skips books where the detected title looks like a publisher. Book is added with `data.titleWarning = true` and `data.titleWarningMsg` for later review. PUBLISHER_NAMES expanded: `oni press`, `vault comics`, `mad cave`, `aftershock`, `awaken comics`, plus bare names (`marvel`, `dc`, `image`, `dark horse`, `idw`).
(7) **Auto-refresh recency guard** (`add3412`): auto-refresh in `App.jsx` now also skips catalogue items imported in the last 5 minutes via `Date.now() - (c.timestamp || 0) < 300000`. Prevents the fire-and-forget bulk-import enrich from racing with the catalogue-level auto-refresh and overwriting fresh market data. Guard applied in both `missingSource` and `dupStale` branches.
(8) **Bulk enrich progress indicator** (`add3412`): new `bulkEnrichProgress` state tracks `{ current, total }` via `.finally` on each enrich promise. "Fetching market data… X of Y" banner rendered both on Scan tab (post-grading) and Collection tab (post-tab-switch). `handleBulkImport` awaits enriches (max 45s poll) before clearing the indicator.
(9) **Post All HOT bulk listing** (`f76f252`): new `📋 Post All HOT (X)` button in Manage tab next to `Create Bundle`. Filters catalogue for `aiTags[id]?.label === 'HOT' && status !== 'listed' && getDisplayPrice > 0`. Confirmation modal shows per-item price + est total. Runs sequentially via existing `onListComic` with 1500 ms between rows. Per-row state (pending/posting/success/error) updates live. Retry button for failed rows; success rows get normal `listOnEbay` writeback (`status:"listed"`, `ebayItemId`, `listedAt`).
(10) **AI verify year tolerance** (`8ab5fa3`): haiku prompt in `verifyCompsTitles` (enrich.js) now tells the model that year in a listing title may differ from our year by 1-2 years (cover date vs publication date) and is NOT a reason to reject. Only reject on clearly different issue number or clearly different character/series. Fixes D'Orc #1 2026 being rejected because our saved year was 2024.
(11) **Confirmed-year comps query** (`18dff47`): `lookupPriceCharting` now returns `year: productYear`, `lookupComicVine` now returns `coverDate`. `enrich.js` handler split into two phases — phase 1 (parallel): ComicVine + Ximilar + PriceCharting + CGC; derive `confirmedYear = priceCharting?.year || comicVine?.coverDate?.slice(0,4) || savedYear`; phase 2 (parallel): fetchComps + fetchSold + lookupGoCollect using `confirmedYear`. `verifyCompsTitles` also receives `confirmedYear`. Logs `[enrich] year corrected: 2024 → 2026` when they differ. Sanity `parseInt(year)` left untouched per the pricing-math rule.
(12) **Reprint / variant filter fallback** (`e279e88`): Filter 1 (reprint) and Filter 1b (variant contamination) in `comps.js` now keep the pre-filter set when the filter would remove every listing, and raise `reprintFallback` / `variantFallback` on the returned comps. `enrich.js` reads those flags when `pricingSource === "browse_api"` and sets `priceNote` to `"eBay avg (mixed prints)"` or `"eBay avg (mixed variants)"` — overrides the generic "PC outlier" / "PC too low" messages. Prevents silent fallback to unchecked PC price when all returned listings are reprints (e.g., D'Orc #1 where 14/20 were 2nd/3rd/4th prints and the other 6 were variants).
(13) **CGC submission profit scenarios** (`0b6b0b7`): GoCollect panel in `CollectionDetail` (raw books only) now models the full submit decision. `gradingCost $35 + pressCost $20 = $55` against `getDisplayPrice` as raw baseline. Per-grade scenario line (9.8/9.6/9.4/9.2) shows `fmv → net` with pass/fail icon. Verdict logic based on the lowest profitable grade: all profitable → `SUBMIT — low risk`; mid cut-off → `SUBMIT — profitable at {grade}+`; only 9.8 → `RISKY — must grade 9.8`; none → `SELL RAW — not worth grading`. Press recommendation from `item.reason` text (spine tick/stress/minor wear/handling). Census displayed with `🔥 Low pop — scarcity premium` under 50. `api/gocollect.js` now extracts `census` from flat number, per-grade object, or `population` key. Graded copies keep the original FMV-only panel. Manual `userFmv98` override preserved.
(14) **Rare variant multipliers + prompt guidance** (`3794975`): `grade.js` STANDARD_PROMPT appends rare-variant identification section — 35¢/30¢ Marvel test market, Mark Jewelers insert, Whitman diamond logo, Canadian price, pence, double/triple cover, printing error (miscut/inverted/color error/missing ink), Type 1A/1B distribution. `enrich.js` variantMultipliers table expanded from 8 keys to 22 and reordered by descending multiplier so higher-premium keywords win substring matches. Adds triple cover ×10, double cover ×8, inverted ×4, printing error ×3, miscut ×3, mark jewelers ×2.5, canadian price ×2, type 1a/1b ×2, canadian ×1.8, pence ×1.5, dc universe logo ×1.5. Raises 35¢/35 cent ×3→×6 and 30¢/30 cent ×3→×4. Lowers whitman ×2→×1.8. Unchanged: gold ×3, 2nd/second print ×1.5, price variant ×2, newsstand ×1.3. NO_PREMIUM list verified clean (no newsstand/canadian/pence). Gate unchanged — still PC-source only (`isFromPC && blendedAvg`); browse_api pricing skips the mult.

Session 4/16/2026 — pricing chain hardening + bulk import fixes:
(1) **Opus 4.7 upgrade**: `api/grade.js` standard scan and Watch Mode pass 3 now use `claude-opus-4-7`. Sonnet references unchanged.
(2) **Import/backup**: file picker resets value on click for Android re-import; "Backup to Drive" button downloads JSON then opens Google Drive; stale-backup banner when collection count changes (`cv_last_backup_date`, `cv_last_backup_count` in localStorage).
(3) **Bulk import hardening**: non-comic rejection (mirrors single scan), duplicate detection (title+issue+year case-insensitive), publisher-as-title guard (known publisher names list), 4 missing enrich fields added to bulk merge (`pricingSource`, `priceNote`, `gradeMultiplier`, `defectPenalty`).
(4) **Publisher in eBay search** (`comps.js`): new attempt 0 = `title #issue variant year publisher` (most specific). Atlas/Timely → "Atlas Marvel". `publisher` param added to `fetchComps` signature, threaded from `enrich.js`.
(5) **Auto-refresh guard** (`App.jsx`): only fires when `tab === 'collection'` AND `selectedItem === null` AND 60s since last refresh via `lastAutoRefreshRef`. No longer hammers `/api/enrich` on book load or tab switch.
(6) **Sold comps validation** (`enrich.js`): `filteredSold` filtered by `#issue\b` regex before blending. Replaces raw `soldResult` in `soldAvg`, `out.soldComps`, and confidence `soldCount`. Prevents wrong-issue sold data from corrupting 60% blend weight.

Session 4/14/2026 — Manage tab audit fixes + pricing calibration (see git log for details).
