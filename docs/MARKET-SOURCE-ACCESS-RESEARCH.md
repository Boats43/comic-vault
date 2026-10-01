# Market source access research (GK-271, 2026-10-01)

Research-only. No credentials were used, nothing was scraped, no integration was built. Produced by a read-only web-research agent; **its report is data, not authority.** Several primary pages (ha.com Website Use Agreement, ComicLink terms, Heritage developer portal, WorthPoint terms, GoCollect API docs) could not be fetched, so any claim resting on a search snippet is marked *partly confirmed* or *unconfirmed*. Re-verify against the live official page before building on any row.

## Access matrix

| Source | Access class | Data exposed | Requirement / cost | Confidence |
|---|---|---|---|---|
| Heritage (ha.com) | PARTNER API (Dealer Direct catalogue API, endpoints unknown) + TERMS limit reuse of "prices realized" content | Auction archive results on the site; no confirmed realized-price API | Contact Heritage for API/licence; cost unstated | Unconfirmed for any realized-price API; ToS limit partly confirmed |
| eBay Finding `findCompletedItems` | Decommissioned (scheduled 2025-02-05; deprecated Oct 2020) | Was sold items | n/a | Confirmed by eBay notices (shutdown date from search summaries) |
| eBay Browse (app credential) | DIRECT API AVAILABLE — active asks only | Asking prices, no sold | Standard keyset | Confirmed |
| eBay Marketplace Insights (`buy.marketplace.insights`) | PARTNER API, Limited Release | ~90-day sold history | eBay Partner Network + Application Growth Check + use-case review + agreement; community reports pricing-comparison use is rejected | Limited-Release status confirmed; rejection pattern partly confirmed |
| eBay Terapeak / Product Research | MANUAL REFERENCE ONLY (no public API found) | ~1 yr sold data in UI | Seller subscription; terms bar transfer/sublicense of data | Partly confirmed |
| ComicLink | UNKNOWN (probably MANUAL REFERENCE ONLY) | Auction/sold archive on site | No API or readable terms | Unconfirmed |
| ComicConnect | TERMS PROHIBIT AUTOMATED ACCESS | Auction results on site | User Agreement bars robots/scrapers without written permission | Confirmed (snippet quote) |
| MyComicShop | UNKNOWN (probably MANUAL REFERENCE ONLY) | Retail asks, not realized | No API found | Unconfirmed |
| GoCollect | DIRECT API (token) with paid tiers; Enterprise = PARTNER/PAID | Grade-aware FMV, trends, sales history | Register → request API access → token; Basic free, Pro $9/mo, Enterprise custom; which tier includes API/sale-level detail not stated | Partly confirmed |
| GPAnalysis | PAID DATA / LICENSE REQUIRED | CGC-graded recorded sales, 1M+ records, 20+ venues | No developer programme found | Partly confirmed |
| CovrPrice | PARTNER API | Modelled raw/graded values from recent eBay + auction sales (not individual sales) | Partner Portal; contact CovrPrice | Partly confirmed |
| HipComic | UNKNOWN | Marketplace asks | No official API found | Unconfirmed |
| WorthPoint | TERMS PROHIBIT (personal use only); LICENSE REQUIRED for commercial | Realized-sold archive, mostly eBay-derived | No API/licensing programme found | Partly confirmed |
| PriceCharting API | PAID DATA (subscription) | Current values by grade; docs say historic prices/sales not supported | ~$49/mo tier reported; token from Subscription page; 1 call/sec; data must be purged after cancellation | Confirmed for values API; **a `/api/sales` endpoint is reported by one source and not on the fetched docs — unresolved** |

## Findings

- **Heritage:** no verified, legitimate machine-access path to realized prices. The only integration today is indirect, through PriceCharting rows (`marketplace:"heritage"`). Do not scrape. Next step is a direct written inquiry to Heritage.
- **eBay sold:** the old Finding route is gone, Browse is asks-only, Marketplace Insights is Limited Release and unlikely to be approved for price comparison. A seller's user OAuth token reaches only that seller's own data and must not be treated as a market-data credential (separate credential classes; unverified against the API License Agreement's market-data clauses, which were not read).
- **Best realistic next providers**, by realized-transaction quality → access legitimacy → cost: (1) GoCollect API (read the live docs/terms first; the repo's own dormancy reason was timeouts, not access), (2) PriceCharting's paid API if a sales endpoint is confirmed (replaces the HTML scrape with a contractual source), (3) GPAnalysis licence (best CGC realized data, slabbed-only), (4) CovrPrice partner API (modelled values), (5) Marketplace Insights application (low probability).
