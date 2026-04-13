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
- `src/App.jsx` — entire frontend (ResultCard, CollectionDetail, grading flow, catalogue)
- `api/enrich.js` — second-pass enrichment (PriceCharting, eBay comps, ComicVine, Ximilar, CGC lookup)
- `api/grade.js` — Claude Vision comic identification and grading
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

## Rules
- **Never change pricing math** (grade multipliers, sanity checks, floor guard, price calculations in `api/enrich.js`) without explicit instruction.
- **Never commit without running `npm run build` first** and confirming zero errors.
- Always preserve the pricing stack order: PriceCharting -> grade multiplier -> sanity check -> defect penalty -> floor guard -> browse_api fallback.
