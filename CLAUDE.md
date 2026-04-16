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
- `api/enrich.js` — second-pass enrichment (PriceCharting, eBay comps, ComicVine, Ximilar, CGC lookup)
- `api/grade.js` — Claude Vision comic identification and grading
- `api/chat.js` — Claude collection chat (inline queries, Whatnot session context)
- `api/comps.js` — eBay Browse API comp fetching
- `api/sold.js` — eBay completed/sold listings
- `api/cgc-lookup.js` — CGC cert number verification
- `api/manage.js` — collection analysis via Claude
- `api/list-ebay.js` — eBay listing creation
- `api/delist-ebay.js` — eBay listing removal

## Repo & Live
- **Repo**: Boats43/comic-vault
- **Live**: comic-vault-rouge.vercel.app

## Environment Variables
Nine keys required (all set in Vercel):
`ANTHROPIC_API_KEY`, `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_DEV_ID`, `EBAY_AUTH_TOKEN`, `EBAY_SANDBOX`, `COMICVINE_API_KEY`, `XIMILAR_API_TOKEN`, `PRICECHARTING_TOKEN`

## Open Items
- GoCollect API: approval pending — check email
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
- Variant short keywords only in comps query attempts 1-2.
- Non-comic titles ("not a comic", "unknown") rejected at enrich entry.
- Sanity check compares grade-adjusted PC price to grade-adjusted comps average (not raw avg).
- Sanity thresholds: 0.5x (too low) and 2x modern/3x Silver (too high) against adjAvg.
- Sanity check uses `blendedAvg || compsFromEbay?.average` — blended comps (60% sold + 40% active) preferred over raw Browse average.
- Sanity low-side condition: `pcNum < adjAvg × 0.5` only (removed legacy `adjAvg - 10` guard that blocked firing on low-value books).
- Variant mult: PC source only — gated by `isFromPC` flag.
- Key mult: PC source only — gated by `isFromPC && blendedAvg` (requires comps to validate).
- Key mult tiered: major (1st appearance, first appearance, origin, death, first issue) ×1.5; minor (2nd, second app, first cover, cameo, iconic, classic) ×1.2; other ×1.0.
- `isFromPC = !!priceCharting?.price && !sanityFired && out.pricingSource === 'pricecharting'` — snapshotted after PC/sanity branch, before floor/variant/key blocks.
- Floor guard field: `rawComps.lowest` (not `lowestNum`) — comps.js returns `lowest`.
- Floor guard is grade-adjusted: `rawFloor * gradeMultiplier`.
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

## Last Session
Session 4/14/2026 — Manage tab audit fixes: (1) List Now button label now uses real `getDisplayPrice(catalogue item)` instead of Claude's text price — `actionBtnLabel` in Manage view resolves `a.comicId` against catalogue and builds `"List Now — $" + realPrice`, falls back to `a.label` if no match (commit f684813); (2) HOT badge fires deterministically in `applyAiTags` — after Claude's HOT/BUNDLE action tags, any catalogue item with `comps.averageNum` and `displayVal < marketVal × 0.85` gets tagged HOT with reason "Priced below market" (guarded by `!aiTags[id] && !tags[id]` to avoid overwrite); (3) `api/chat.js` `totalValue` now uses enriched `c.price` only (`parseFloat(String(c.price||"0").replace(/[$,]/g,""))`) — no longer falls back to `comps.averageNum`, matches UI's `getDisplayPrice` formula; (4) collection header EST VALUE matches Manage tab Total Value (same source); (5) Total Value metric locked — `sendMessage` filters out Claude's `Total Value` entry from `data.metrics` and re-prepends the locally-computed one so chat API responses never overwrite it.

Session 4/14/2026 — pricing calibration + Finding Service hardening: (1) floor guard now derives `gradeAdj` from grade string when `out.gradeMultiplier` is unset; (2) collection tile falls back to `#N` parsed from conditionReport/notes via `extractIssueFromReport` when `item.issue` is missing; (3) variant and key multipliers now gated by `isFromPC` snapshot (`priceCharting.price` exists AND `!sanityFired` AND `out.pricingSource === 'pricecharting'`) — computed right after PC/sanity branch to prevent firing on browse_api or sanity-fallback prices; (4) sanity low-side now fires on `pcNum < adjAvg × 0.5` alone — removed legacy `adjAvg - 10` guard that blocked low-value books (e.g., Shazam #2 FN 6.0: $4.09 vs adjAvg $12.61 now correctly falls back); (5) `api/comps.js` `tryFindCompleted` adds 500ms pre-call spacing, 5-min in-memory `findingCache` keyed on lowercased query, and one 2s-backoff retry when eBay returns 500 + errorId 10001 — falls through silently to Browse on second failure.
