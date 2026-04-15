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
- Key issue multiplier: ×1.5 applied after variant mult when `out.keyIssue` is set.
- Visual search only overrides with 3+ matches.
- PriceCharting skipped when issue=null.
- No premium multiplier: corner box, masterpieces, design variant, cover A/B/C/D.
- Variant short keywords only in comps query attempts 1-2.
- Non-comic titles ("not a comic", "unknown") rejected at enrich entry.
- Sanity check compares grade-adjusted PC price to grade-adjusted comps average (not raw avg).
- Sanity thresholds: 0.5x (too low) and 3x (too high) against adjAvg.
- Sanity low-side condition: `pcNum < adjAvg × 0.5` only (removed legacy `adjAvg - 10` guard that blocked firing on low-value books).
- Variant mult: PC source only — gated by `isFromPC` flag.
- Key mult: PC source only — gated by `isFromPC` flag.
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

## Verified Pricing Fixes — 4/15/2026 (commit 8d70e12)
All five pricing fixes confirmed intact:
- **NO_PREMIUM**: corner box, masterpieces, design variant, headshot, trading card, cover a/b/c/d, marvel legacy, legacy
- **Key mult ×1.5**: isFromPC gated, PC source only
- **Sanity low**: `pcNum < adjAvg × 0.5` (no -10 guard)
- **Sanity high**: `adjAvg × 2` modern (1985+) / `× 3` Silver Age
- **Floor guard**: `rawComps.lowest × gradeAdj`
- **Share target**: SW cache + Vercel fallback route + 3× retry in App.jsx

## Features
- **Bundle listing**: Manage tab → "📦 Create Bundle" chip → tap tiles to multi-select → floating bar shows `$sum → $bundlePrice (18% off)` → "List Bundle" posts to `/api/list-ebay` with `{ bundle: true, items: [...] }` → single eBay listing (all items marked `status:"listed"` with shared `ebayItemId`/`bundleId`). ERA auto-detected from earliest book year (Golden <1956, Silver ≤1970, Bronze ≤1984, Copper ≤1991, Modern 1992+). Claude BUNDLE actions pre-select recommended comicIds into selection mode.

## Last Session
Session 4/14/2026 — Manage tab audit fixes: (1) List Now button label now uses real `getDisplayPrice(catalogue item)` instead of Claude's text price — `actionBtnLabel` in Manage view resolves `a.comicId` against catalogue and builds `"List Now — $" + realPrice`, falls back to `a.label` if no match (commit f684813); (2) HOT badge fires deterministically in `applyAiTags` — after Claude's HOT/BUNDLE action tags, any catalogue item with `comps.averageNum` and `displayVal < marketVal × 0.85` gets tagged HOT with reason "Priced below market" (guarded by `!aiTags[id] && !tags[id]` to avoid overwrite); (3) `api/chat.js` `totalValue` now uses enriched `c.price` only (`parseFloat(String(c.price||"0").replace(/[$,]/g,""))`) — no longer falls back to `comps.averageNum`, matches UI's `getDisplayPrice` formula; (4) collection header EST VALUE matches Manage tab Total Value (same source); (5) Total Value metric locked — `sendMessage` filters out Claude's `Total Value` entry from `data.metrics` and re-prepends the locally-computed one so chat API responses never overwrite it.

Session 4/14/2026 — pricing calibration + Finding Service hardening: (1) floor guard now derives `gradeAdj` from grade string when `out.gradeMultiplier` is unset; (2) collection tile falls back to `#N` parsed from conditionReport/notes via `extractIssueFromReport` when `item.issue` is missing; (3) variant and key multipliers now gated by `isFromPC` snapshot (`priceCharting.price` exists AND `!sanityFired` AND `out.pricingSource === 'pricecharting'`) — computed right after PC/sanity branch to prevent firing on browse_api or sanity-fallback prices; (4) sanity low-side now fires on `pcNum < adjAvg × 0.5` alone — removed legacy `adjAvg - 10` guard that blocked low-value books (e.g., Shazam #2 FN 6.0: $4.09 vs adjAvg $12.61 now correctly falls back); (5) `api/comps.js` `tryFindCompleted` adds 500ms pre-call spacing, 5-min in-memory `findingCache` keyed on lowercased query, and one 2s-backoff retry when eBay returns 500 + errorId 10001 — falls through silently to Browse on second failure.
