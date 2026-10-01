# Market source access research (GK-271 / GK-271b)

Research-only. No credentials used, nothing scraped, no integration built.

**Revision history.** The 2026-10-01 first pass was assembled from search snippets and is **superseded** by the second pass below, which accepts only what a read-only agent fetched from a provider's own page. Prior-pass claims that the second pass could not re-confirm have been removed or downgraded to UNKNOWN, not carried forward. Caveat on the method: the fetch tool returns a small-model summary of each page, so quotes are as relayed, not raw-page verified. Re-read the live page before building on any row.

## Second pass — primary-source classification (2026-10-01)

| Provider | Classification | Primary pages read | Evidence | Data exposed | Cost | Limits | Confidence |
|---|---|---|---|---|---|---|---|
| PriceCharting | DIRECT API (paid) | `pricecharting.com/api-documentation`, `/page/terms-of-service` | "You must have a paid subscription to access the API." Endpoints listed: `/api/product`, `/api/products`, and marketplace `/api/offer*`. **No sales-history endpoint**: "The API and CSV only support current item values… Historic prices and historic sales are not supported." | Current modelled values by grade/condition. No sold records. | Subscription; price not on the pages read (CSV needs Legendary) | 1 call/sec; "Licensed for internal use only"; commercial sharing needs written permission; data purged after subscription ends; terms say price data may not be in any system accessible to third parties without written permission. Terms do not explicitly address scraping or caching. | CONFIRMED |
| GoCollect | PARTNER API (Enterprise tier only) | `gocollect.com/pricing`, `/data-sharing`, homepage | "Customized API access" appears only under Enterprise ("Custom pricing", "Contact Us"). Pro tier lists "Sales History" as a web feature. | Whether the API returns individual transactions is **not stated**. | Enterprise custom; Pro price not captured | Not stated; no terms page read (`/api` 404) | CONFIRMED for tier; UNCONFIRMED for sale-level data |
| GPAnalysis | MANUAL REFERENCE | `comics.gpanalysis.com`, `/subscribe` | Subscription includes individual CGC transaction details from 2000 onward, in the website UI. No API advertised on either page. | Realized CGC-graded sales (web UI) | US$10.95/mo or $119/yr | Terms not read (404) | CONFIRMED that no API is advertised on those two pages; terms unread |
| CovrPrice | UNKNOWN | `covrprice.com`, `/plans/unlimited/` | Pages contain no API or terms content | FMV from sales (web) | Paid tier exists, price not shown | — | UNCONFIRMED |
| Heritage | UNKNOWN | none (HTTP 403) | — | — | — | — | UNCONFIRMED |
| ComicLink | UNKNOWN | none (HTTP 402) | — | — | — | — | UNCONFIRMED |
| ComicConnect | UNKNOWN | homepage only | No API/terms content reached | — | — | — | UNCONFIRMED |
| MyComicShop | UNKNOWN | none | Homepage empty; guessed terms URL 404 | — | — | — | UNCONFIRMED |
| HipComic | UNKNOWN | none (HTTP 403) | — | — | — | — | UNCONFIRMED |
| WorthPoint | UNKNOWN | none (HTTP 403) | — | — | — | — | UNCONFIRMED |

**An UNKNOWN row is not evidence of "no API" or of "prohibited" — those pages were blocked or silent.** The first pass's statements that ComicConnect/WorthPoint prohibit automation and that Heritage restricts reuse of "prices realized" content came from search snippets and are NOT re-confirmed; treat them as leads to verify, not facts.

## Locked eBay finding (per directive, not re-researched)

- Finding API: DECOMMISSIONED. Browse API: current listings / active market. Marketplace Insights: sold-history capability, LIMITED RELEASE. Seller OAuth: own seller account operations/data only, not a general market-sold-data substitute.

## Implications

1. **PriceCharting has no contractual route to sales history.** GrailKey's sold-evidence source is the HTML scrape of the product page (`api/pricecharting-pop.js`), which the paid API does not replace. PriceCharting's terms ("internal use only", no third-party-accessible systems without written permission) are a compliance question for how scraped/derived PriceCharting data is stored and shown. **Open question for the owner, not resolved here.**
2. **GoCollect** is the only comic-specific source with a documented official API route, but only at Enterprise tier, and sale-level data is unconfirmed. Next step is a sales conversation or reading the Enterprise API docs, not an integration.
3. Realized-sale providers with a verified machine-access route today: **none confirmed.**
