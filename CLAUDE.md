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
- Variant multipliers: gold ×3, 2nd print ×1.5, newsstand ×1.3, price variant ×2.0.
- Key issue multiplier: tiered (major ×1.5, minor ×1.2) applied after variant mult when `out.keyIssue` is set AND blendedAvg is non-null.
- Visual search only overrides with 3+ matches.
- PriceCharting skipped when issue=null.
- No premium multiplier: corner box, masterpieces, design variant, cover A/B/C/D.
- eBay listing title includes variant (newsstand, gold, 2nd print, etc.) between issue and grade — filtered by `NO_TITLE_VARIANTS` (corner box, masterpieces, design variant, cover a/b/c/d, headshot).
- Variant short keywords only in comps query attempts 1-2. Attempt 0 uses FULL variant string (e.g., "Paco Medina Thing variant") for most specific eBay search.
- Non-comic titles ("not a comic", "unknown") rejected at enrich entry.
- Sanity check compares grade-adjusted PC price to grade-adjusted comps average (not raw avg).
- Sanity thresholds: 0.5x (too low) and 2x modern/3x Silver (too high) against adjAvg.
- Sanity check uses `blendedAvg || compsFromEbay?.average` — blended comps (60% sold + 40% active) preferred over raw Browse average.
- Sanity low-side condition: `pcNum < adjAvg × 0.5` only (removed legacy `adjAvg - 10` guard that blocked firing on low-value books).
- **browse_api prices: NO grade multiplier.** eBay listings already reflect market grade. Grade mult only applies to PriceCharting base prices (NM-equivalent). Sanity fallback uses raw `compsAvg`, not `adjAvg`. Browse primary fallback uses `browseBase` directly. `gradeMultiplier` is still recorded on `out` for floor guard but not applied to browse_api prices.
- Variant mult: PC source only — gated by `isFromPC` flag.
- Key mult: PC source only — gated by `isFromPC && blendedAvg` (requires comps to validate).
- Key mult tiered: major (1st appearance, first appearance, origin, death, first issue) ×1.5; minor (2nd, second app, first cover, cameo, iconic, classic) ×1.2; other ×1.0.
- `isFromPC = !!priceCharting?.price && !sanityFired && out.pricingSource === 'pricecharting'` — snapshotted after PC/sanity branch, before floor/variant/key blocks.
- Floor guard field: `rawComps.lowest` (not `lowestNum`) — comps.js returns `lowest`.
- Floor guard: raw `rawFloor` (no grade multiplier). eBay comps already reflect market grade. Capped at `compsAvg`.
- eBay comps search: attempt 0 = title + issue + full variant + year + publisher (most specific, capped 100 chars); falls through to attempt 1 (short variant + year), then attempt 2 (no year), etc.
- Variant comp preference (Filter 1c): when variant set, prefer comps whose titles match variant-specific words (min 2 matches to filter, otherwise keep all).
- Atlas/pre-Marvel publishers: append "Atlas Marvel" to eBay query (sellers use both terms interchangeably).
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
- **Share target**: SW cache + Vercel fallback route + 3× retry in App.jsx

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
Session 4/16/2026 — pricing chain hardening + bulk import fixes:
(1) **Opus 4.7 upgrade**: `api/grade.js` standard scan and Watch Mode pass 3 now use `claude-opus-4-7`. Sonnet references unchanged.
(2) **Import/backup**: file picker resets value on click for Android re-import; "Backup to Drive" button downloads JSON then opens Google Drive; stale-backup banner when collection count changes (`cv_last_backup_date`, `cv_last_backup_count` in localStorage).
(3) **Bulk import hardening**: non-comic rejection (mirrors single scan), duplicate detection (title+issue+year case-insensitive), publisher-as-title guard (known publisher names list), 4 missing enrich fields added to bulk merge (`pricingSource`, `priceNote`, `gradeMultiplier`, `defectPenalty`).
(4) **Publisher in eBay search** (`comps.js`): new attempt 0 = `title #issue variant year publisher` (most specific). Atlas/Timely → "Atlas Marvel". `publisher` param added to `fetchComps` signature, threaded from `enrich.js`.
(5) **Auto-refresh guard** (`App.jsx`): only fires when `tab === 'collection'` AND `selectedItem === null` AND 60s since last refresh via `lastAutoRefreshRef`. No longer hammers `/api/enrich` on book load or tab switch.
(6) **Sold comps validation** (`enrich.js`): `filteredSold` filtered by `#issue\b` regex before blending. Replaces raw `soldResult` in `soldAvg`, `out.soldComps`, and confidence `soldCount`. Prevents wrong-issue sold data from corrupting 60% blend weight.

Session 4/14/2026 — Manage tab audit fixes + pricing calibration (see git log for details).
