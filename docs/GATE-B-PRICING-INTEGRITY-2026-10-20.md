# Gate B pricing-integrity repair (2026-10-20)

Local only. Release HOLD. No Production write, provider call, refresh, repricing, Vision, Q41, eBay write, push, merge or deploy. Production runtime logs were read through the Vercel read-only log API (2026-10-16 03:20 to 04:00Z, project `comic-vault`).

## 1. The 03:23 / 03:58 hypothesis, checked against the logs: REFUTED

The leading hypothesis (the final pass partially refused, returned null bands, and the stale bundle survived) is **not** what happened.

| Time (2026-10-16Z) | Request | Log evidence |
|---|---|---|
| 03:23:23 | `vzsws` | `[comps-cache] MISS`; `[active-cache] MISS ... 9b49...` cached **16 comps** (variant empty). Matches the stored `rawComps.evidenceObservedAt` 03:23:23.728 |
| 03:23:34 | (correction) | variant `null -> "1/25"` |
| 03:23:47 | `sqpfn` | MISS, fingerprint `0e21...` (variant now set), cached **16 comps** again |
| 03:28:53 | (correction) | variant `"1:25" -> "1/25"` |
| 03:57:57 | `8f757` | `[price-bands] ... market=$4.18 count=16`; no `comps-cache` line was logged for this request |
| 03:58:16 | `6npmw` | `[price-bands] source=tier3_active_discounted quick=$2.13 market=$4.18 stretch=$4.81 count=16` |
| 03:58:17 | (correction) | variant `"1/25" -> "1:25"` |
| 03:58:31.9-34.3 | `78xl5` (the FINAL pass) | `MISS` fingerprint `70f7...`, fresh eBay fetch (query `old man logan deodato #25 1:25 2017 Marvel`, raw 58, **variant preference "1:25" kept 8 of 19**, 6 survivors); `[price-bands] source=tier3_active_discounted quick=$12.74 market=$15.1 stretch=$17.36 count=6`; `[price-derivation] ... trace.finalPrice=15.1`; decision RESEARCH; no refusal line |
| 03:58:35.9 | `POST /api/collection` | the row write (`updated_at` 03:58:35.868) |

- **The final pass returned fresh bands and a trace.** It was not a refusal, and none of the four refusal sites (`api/enrich.js:8073, :8137, :9020, :9049`) fired; those also set `out.price = null` and a `refused-*` source, while the stored row has price $15.10 and source `active_ask_derived`.
- **The $4.18 band was computed by earlier passes, not carried over.** Two passes with the variant already confirmed priced `count=16` regular covers. The confirmed variant was stored as the notation `"1/25"` at that time; eBay titles say `"1:25"`. When the final pass used `"1:25"`, the same ladder's variant preference matched and kept 8 of 19. So the earlier passes priced regular covers because the confirmed-variant notation did not match listing text, and (a separate, code-proven point) because `priceBands.js` did not require the variant (this repair).
- **Not established:** why the final response's bands, trace and pool did not replace the stored ones at 03:58:35. The client merge sites adopt a truthy `enrich.priceBands`; the correction builder (`src/lib/manualCorrection.js buildCorrectedCatalogueItem`) clears the pricing fields and spreads the response. Neither explains it from the code alone. Candidates (unproven): two overlapping passes (6npmw at +15s and 78xl5 at +31s) merging out of order; or a sync write. No client log of the merge exists.

## 2. What this pass changes

### Variant filtering in `src/lib/priceBands.js` (before / after)
- **Before:** a confirmed variant only switched the variant-contamination reject (Q75-2) **off**. Regular covers were admitted into the band. A pool of 16 regular covers produced Tier 3 market $4.18 for a 1:25 book.
- **After:** for a confirmed **ratio** variant (`1:25`, `1/25`, `1 in 25`, `1-in-25`), a listing is evidence only if its own title names the same ratio (`getRatioVariantN`, `titleShowsRatioVariant`; notation-insensitive, exact on the number: 1:250, 1:50, 11:25 do not match; a bare number or a title-less row is not evidence). With fewer than 3 applicable listings the engine returns **no band** and writes `diagnostics.variantEvidence {insufficient: true, applicable, nonVariant}`; `api/enrich.js` turns that into the labelled refusal `refused-variant-evidence-insufficient` (no price, no bands, `variantEvidence` and a note naming the variant and the counts). When enough applicable listings exist, the band carries `variantEvidence {applicable, nonVariant, ratio}` as proof, also emitted on `out.priceBands`.
- **Unchanged:** non-ratio variants (newsstand, Whitman, 2nd print...) and non-variant books; the engine's null contract (it never invents a band); sold-based tiers.
- **Not changed (and listed as a blocker below):** the upstream variant preference in `api/comps.js` is still notation-sensitive.

### Refresh merge in `src/App.jsx` (before / after)
- **Before:** each of 9 sites merged `priceBands` / `rawComps` member by member with `enrich.X || cur.X` (null or omitted keeps the old value as current); `priceDerivationTrace` and `authoritativeRecommendation` were merged by no site and rode in on `...cur` forever.
- **After:** one rule, `src/lib/pricingBundleMerge.js`, at every site (and 2 inline duplicate-confirm sites): **new evidence** (a band with a positive market) replaces `priceBands`, `rawComps`, `priceDerivationTrace` and `authoritativeRecommendation` together, and a member the response lacks becomes null (never filled from the old row); **refused / omitted (null, undefined)** leaves no current band, the response's own members are current, and the previous bundle moves whole into `historicalPricingEvidence` (`authoritative: false`, `status: HISTORICAL`, with the identity it was observed under and a changed-identity flag); **empty `{}`** is not stored as a result (status `EMPTY_REJECTED`). Nothing reads `historicalPricingEvidence` for display, pricing, authority or listing.

### Refusal authority respected
The decision engine is untouched. `refused-variant-evidence-insufficient` is classified as an **insufficiency** refusal in `responseContract.js` (same class as `refused-tier-bypass-detected`): acknowledgeable only with an explicit operator price (Q41), never automatic, and the smoke asserts the card stays not listable. A consistent band is not an authorized price: with no sold evidence `NO_SOLD_EVIDENCE` persists, the card stays REVIEW / RESEARCH, and the operator sets the LIST price explicitly with the model's prediction preserved separately.

## 3. Controls that announce a violation in text without a failing exit (survey, NOT fixed)
Heuristic scan of `scripts/`, `tests/helpers/`, `src/lib/` and every `tests/*.test.js` (689 files) for lines that print BLOCK / ABORT / SKIP / REFUSED / WARNING with no nearby exit, throw, assertion or failure counter. 22 lines; the real gaps:
- `tests/ship26-integration.test.js:91,129,165,198,228`: prints "WARNING: eBay API keys missing" and "SKIP: full validation (requires API keys)", then exits 0. A test that can skip its own assertions.
- `scripts/smoke-test.mjs:385,391`: fixtures skipped ("queued ship target", "requires eBay API keys") are counted as `skipped` and the exit is 0 (`failed > 0 ? 1 : 0`).
- `scripts/agent-live-verification.mjs:307`: "SKIP (Category B): Payload malformed - never reached pricing" with no consequence.
- `tests/d4-identifier-fabric-live-concurrency.test.js:214`: "Skipping the per-pair detail below" is now a stale message (the invariants run for every race since `83e95af`, and the B7a observation is its own failing assertion).
- `scripts/ingest-outcome1-financials.mjs:228`: "Prediction error REFUSED" printed, process exits 0 (informational by design, GK-274).
- `scripts/sweep-runner.mjs`: `run` / `summary` print FAIL / TIMEOUT counts and exit 0 whatever the totals (a runner, not a verdict; the certification reads the ledger).
- False positives: `imageSearchIdentity.js` merge-decision logs; `marketplaceOperatorGate.js:71` fails closed (`return unavailable()`).
- The scan cannot see a control that fails silently with no text at all. And the sweep gate's own process-name pattern (`*max-old-space-size=1024*`) matches any wrapper whose argv carries that flag, so a wrapped child must receive the heap limit through `NODE_OPTIONS`, not argv (found this pass: a gated command was blocked by its own wrapper).

## 4. Remaining pricing-authority blockers
1. **Variant notation is not canonical.** The confirmed variant moved between "1/25" and "1:25"; `api/comps.js` variant preference matches words in the stored string, so "1/25" does not narrow a pool of "1:25" titles. The band filter now accepts either notation, but the pool, the cache key (`variant` is in the fingerprint) and the query are still notation-sensitive.
2. **Persisted-row mixture unexplained:** why the final response's bundle did not replace the stored one is not established (section 1).
3. **Zero sold comps:** `NO_SOLD_EVIDENCE` persists. The operator sets the LIST price explicitly.
4. **Receipts still not producible in Production**; a deploy is required (HOLD).
5. **api/comps.js book-level cache** (`activeCached`, 6h) trusts a client-carried pool without an identity check: a refresh within six hours of a prior pass can reuse a pool fetched under a different identity. Observed risk, not shown to have fired on the final pass (it MISSed).
6. **Non-ratio variants** (named covers, newsstand, foil) still admit regular covers into a variant book's band.
7. **Gate weakness banked (not implemented):** `scripts/sweep-gate.ps1` decides "a runner is alive" by matching command-line text (`*max-old-space-size=1024*`, `*sweep2.mjs*`, `*chain.sh*`), so any process whose argv merely contains that text blocks itself or an unrelated gate check (seen twice). A PID/parent-based check (the gate's caller and its children excluded; runners registered by PID file) is the durable fix; it needs its own authorization. `scripts/gated-run.mjs --heap-mb=N` avoids the trap today by using `NODE_OPTIONS`.
