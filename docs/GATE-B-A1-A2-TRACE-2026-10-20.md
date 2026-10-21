# Gate B narrow pass: A1 (priceBands) and A2 (title / comparable queries) traces (2026-10-20)

Read-only. Start HEAD `18e56eb`. No refresh, repricing, provider call, Production write, push or deploy. Production values were read with `scripts/oml-gate-b-production-readonly.mjs` (`BEGIN READ ONLY`). Labels: **VERIFIED** = read from Production today; **CODE** = source at HEAD (`v1-source-authority`, not deployed) unless noted; **LOCAL RUN** = the real `fetchComps` executed against a stubbed `fetch` with fake credentials (no network, no provider).

## A1: does an owned refresh replace the stale $4.18 band?

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Does `ownedRefresh` return `priceBands`? | **YES, conditionally** | `api/enrich.js:8523` computes `priceBandsRaw` and `:8685-8693` sets `out.priceBands {quick, market, stretch, source, count, tier, variantAdjusted}` whenever the tier engine returns a result and the response is not refused. It is **null** on the refusal paths (`:8073`, `:8137` reprint-thin-pool; `:9020`, `:9049` polybag divergence; `:7075`, `:7100`). An owned refresh runs the same pipeline (`ownedRefresh` only changes identity/category handling, `:2729` onward) |
| 2 | Are the bands derived from the same variant-aware comparable population as `out.comps`? | **NO (not guaranteed)** | Both come from the same `rawComps` variable (`out.comps` at `:11309`, `out.rawComps` at `:12604`, bands via `activeComps: rawComps` at `:8523`). But the band step re-filters `rawComps.prices` in `buildVerifiedActivePool` (`src/lib/priceBands.js:324`) with title overlap, issue and year (within 5) rules, and the confirmed variant only **disables** the variant-contamination reject (`:338`, `:404-408`); it never **requires** variant text. Variant narrowing exists only upstream in `api/comps.js` (Filter 1c, applied when at least 2 listings match) and in `isActivePoolVariantConfirmed` (needs 2 matches covering 70% of the pool). So a variant book's band pool can hold regular covers |
| 3 | Does `priceBands: enrich.priceBands \|\| cur.priceBands` replace stale bands when the response includes them? | **YES** | `src/App.jsx:12119`, `:13525` (refresh), `:12993`, `:14473` (`enrich.priceBands \|\| cur.priceBands \|\| {}`), `:12290` (`\|\| s.priceBands \|\| null`). A returned (truthy) object replaces the stored one wholesale |
| 4 | What if the response omits bands, returns null, or returns `{}`? | **Omitted or null: the stale value survives. `{}`: it is replaced by an empty object.** | `\|\|` falls through on `undefined`/`null`, so `cur.priceBands` is kept; an empty object is truthy, so it replaces the stored bands with `{}` (the card guards on `item.priceBands &&` and `count > 0`, `:8345`, `:8431`). `/api/collection` treats `priceBands` as ordinary client state (not a protected key), so whatever the client writes is stored |
| 5 | Can the stored $4.18 band survive a refresh? | **YES** | Mechanically through the `\|\|` carry-over in answer 4. Stored evidence indicates it already did: see "What the row shows" below |
| 6 | What evidence proves new bands apply to the 1:25 variant? | **UNKNOWN until a refresh; the proof would be concrete** | `variantAdjusted` and `source` alone do not prove it (stored `variantApplicability` is UNRESOLVED). The returned `rawComps.prices` rows carry titles; the bands apply to the variant only if `priceBands.count` equals the number of returned rows naming the variant (1:25 / Deodato), the `priceDerivationTrace` input prices equal those rows' prices, and the contract's `variantApplicability` is no longer UNRESOLVED. None of that is checkable without the response |

### What the row shows (VERIFIED)
- `rawComps`: 16 listings, `evidenceObservedAt` **2026-10-16T03:23:23.728Z**, prices $2.50 to $10.00, average $4.92. **None of the 16 titles mentions 1:25**; several say "Main Cover", "1st Print" or no variant at all.
- That evidence predates the first variant correction: `operator_correction_event` shows variant `null -> "1/25"` at **03:23:34.493Z**, eleven seconds later. With `variant` empty, `buildVerifiedActivePool` applies `VARIANT_CONTAM_ACTIVE` (`priceBands.js:339`, `:405`), which rejects every listing whose title says 1:25. That produces exactly this pool: regular covers only. So the $4.18 band is a **pre-variant generation**.
- The final enrich ran at 2026-10-16T03:58:17Z (`pipelineAudit.generatedAt`, `priceUpdatedAt`). Its `comps` (6 asks, all 1:25 Deodato listings, `compsCachedAt` 03:58:15Z) and contract carry the new generation. The stored contract bands (12.74 / 15.10 / 17.36) are **exactly the Tier-3 formula applied to those 6 asks** (low 14.99 x 0.85, average 17.76 x 0.85, price x 1.15).
- `deriveBands` (`src/lib/responseContract.js:513`) trusts `out.priceBands` only when the price lies inside it; $15.10 is outside [$2.13, $4.81], so the contract fell back to `priceLow`/`priceHigh`. That is why the contract and the stored `priceBands` disagree.
- **Not established:** why the stored `priceBands`, `priceDerivationTrace`, `authoritativeRecommendation` and `rawComps` remained at the 03:23 generation while `price`, `contract` and `comps` advanced. Either the 03:58 response omitted or nulled those fields and the `||` merge kept the old ones, or the response carried them and some other write path kept the old ones. Distinguishing the two needs the 03:58 response or logs, which this audit did not have.

**A1 conclusion:** a refresh can fix the contradiction only if the response returns bands built from the variant-matching pool; nothing in the code guarantees that, and nothing in the client prevents a null/omitted response from silently preserving the $4.18 band. Gate B should require reading the persisted row after the refresh and checking the three proofs in answer 6.

## A2: title facet and comparable queries

### Queries (LOCAL RUN of the real `fetchComps`, stubbed `fetch`, fake credentials)
The stub reproduced Production's stored query exactly (stored `comps.query` = `old man logan deodato #25 1:25 2017 Marvel`), which validates the method.

| Attempt | Current title `old man logan deodato` | Intended title `Old Man Logan` (issue 25, variant 1:25, year 2017, publisher Marvel) |
|---|---|---|
| 0 | `old man logan deodato #25 1:25 2017 Marvel` | `Old Man Logan #25 1:25 2017 Marvel` |
| 1 | `old man logan deodato #25 1:25 2017` | `Old Man Logan #25 1:25 2017` |
| 2 | `old man logan deodato #25 1:25` | `Old Man Logan #25 1:25` |
| 3 | `old man logan deodato 2017` | `Old Man Logan 2017` |
| 4 | `old man logan deodato` | `Old Man Logan` |
| 5 | `logan #25` | `Logan #25` |

- **Artist tokens:** `Deodato` appears in queries only as part of the title text. The variant string `1:25` carries no artist. `ARTIST_PATTERNS` has no Deodato entry (no match in `compHygiene.js` or `comps.js`), so no artist-specific query and no artist narrowing happens either way; passing an `artistOverride` changed nothing in the ladder. With the intended title the artist is simply absent from every query. Whether that widens the pool to non-Deodato 1:25 or regular copies cannot be known without a provider call.
- **Cached evidence for a different population:** yes, two stored populations exist, 6 variant asks (query with "deodato", cached 03:58Z) and 16 regular-cover asks (03:23Z generation). Neither was fetched with the intended title.
- **STOP:** what the intended-title query returns (counts, prices, variant mix) requires an eBay Browse call. Not made; not assumed.

### Does correcting the title invalidate things? (CODE)
| Item | Effect of changing the title |
|---|---|
| Active-comp cache | The `ac:` key is built from `confirmedTitle` (`cacheKeys.js:160`) plus a fingerprint of grade, year, variant, publisher and more. A different title is a cache miss, so the next enrich fetches fresh comps (provider call, 2 spend units) |
| Pricing basis / the $15.10 contract | Not recomputed by the correction itself. Any identity correction request is an owned-item enrich (`submitManualCorrection` sets `ownedRefresh`, `enrich.js:2402`), which re-derives price, comps, contract and decision. Until then the stored contract describes the old title's query. Whether $15.10 survives is **UNKNOWN** and depends on the new fetch |
| Authority receipt | None exists today. Once issued, it binds row, asset and evidence version; its identity check needs the same issue and at least 50% title-word overlap (`authorityReceipt.js` `identityMatchesReceipt`). `Old Man Logan` vs `old man logan deodato` overlap 3 of 4 words (0.75), so the identity check still passes; a refresh after the correction would sign the new facts anyway |
| Catalogue anchor | No PriceCharting anchor is stored (`pcProductId`, `pcProductName` null). The stored `confirmedTitle` attribute is the unrelated string "Wolverine: Old Man Logan Giant-Size" and is not what the queries use |
| Overlap checks | The band step's title-overlap rule (`priceBands.js:355-362`) gets looser with fewer title words (it accepts at least half of the title's 3-letter-plus words). The physical-copy guard `titlesLikelySameBook` (`duplicateCopyDetection.js:40`) compares the smaller token set (3 of 3 words covered), so the intended title still overlaps the old one |
| Listing title | Built server-side from the governed durable title, so it changes with the correction |

The title correction appends an `operator_correction_event` and stays protected afterward; Production's title was not modified.

**A2 conclusion:** the intended title produces a cleaner, artist-free ladder, but its effect on the comparable pool and on the $15.10 contract is unknowable without a provider call, and the correction itself triggers that fetch. Decide the title first, then refresh once.

## CORRECTION (2026-10-20, same day, after reading the Production runtime logs)
The section "What the row shows" above called the stored $4.18 band "a pre-variant generation" that "survived" later passes and offered a null-bands merge as the likely route. The logs refute that: passes at 03:57:57Z and 03:58:16Z **computed** `market=$4.18 count=16` with the variant already confirmed (as the notation "1/25", which eBay's "1:25" titles do not match), and the final pass at 03:58:31-34Z returned fresh tier-3 bands (`$15.10`, count 6) and a trace, so it was not a refusal. What remains true: the band step never required the variant (fixed in `src/lib/priceBands.js`), the null/omitted-bands merge is a real latent defect (fixed in `src/lib/pricingBundleMerge.js`), and why the final response's bundle did not replace the stored one is not established. Full evidence: `docs/GATE-B-PRICING-INTEGRITY-2026-10-20.md`.
