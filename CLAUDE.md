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

## Last Session
Session 4/14/2026 — key issue ×1.5 multiplier in enrich pipeline, share target now persists into Buyer tab (URL cleaned, widget overlay bypassed), BidCalculator redesigned as Net Profit UI: title+grade header, ⚙ settings gear (whatnotFee 10%, supplies $0.75, labor $2.00, minProfit $5.00 — stored in `cv_buyer_settings`), huge NET PROFIT hero with green/yellow/red color states, single large BUY/PASS button (auto-suggest from net vs minProfit + budget), collapsible "See details ›" breakdown row-by-row.
