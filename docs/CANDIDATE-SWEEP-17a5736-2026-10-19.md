# Candidate sweep — v1-source-authority @ 17a5736 (2026-10-19)

Tested SHA `17a5736`, worktree clean (0 changes) before and after (a test-generated `.d3-3-wal-measurement-results.json` was deleted). Frozen: no implementation change during the sweep. This file is a docs-only commit on top.

## Result
472 files, 100% completed, 0 INTERRUPTED / 0 ENV_ERROR / 0 NOT_RUN. Originals: **414 PASS / 54 FAIL / 4 TIMEOUT** (90 s default; `list-ebay-outcome1-handler-smoke` ran at a documented 240 s exception ceiling: PASS, 170.9 s). Isolated 150 s reruns of the 4 timeouts: `u1-generic-book-live` PASS (95.6 s — a 90 s ceiling was just below its real runtime); `b1-operator-authority-live`, `collection-sync-closeout-live-proof`, `gk265-phase3-seller-execution` TIMEOUT again (unresolved). Effective: 415 / 54 / 3.

Compared with the RC sweep: **two files newly fail that passed on RC**, both classified EXPIRED CONTRACT (neither is a product regression):
- `grailkey-commit-e` — a literal source pin `res.status(200).json(finalizeResponse(out));`; the send site is now `json(await finalizeWithReceipt(out))` (the invariant, "the full `out` is sent", still holds). String pin, see TEST-INVARIANT-LESSON.
- `b1rc-schema-compat` — its READY listing is authorised by a **request-borne** `decision`/`soldCompDiagnostics`; that is exactly the forgery path P0 closes (403, no receipt). The fixture must present a bound, server-issued receipt.

The earlier targeted subset did not catch these two; the full sweep did. The other 52 FAIL files also fail on RC/baseline (classified in B1-FAILURE-DISPOSITION). `dispatch-42-comicvine-kill` now FAILs (stale count 7 vs 9) instead of timing out (rate-limit unref fix).

## A1 — Old Man Logan receipt compatibility (read-only Production)
- Asset `01a0bb24-c806-7a63-aa86-ce26fe8eed83`: one link only, to canonical `cv_1790809927798_txjz5n`; stub `cv_1789846119473_xmrj3x` has NO link (nothing asserted about it being a second physical object).
- Canonical row has **no `authorityReceipt` at all** (last update 2026-10-16, before receipts existed) and no `authorityProvenance`; it holds loose, client-written `decision`/`pricingSource`/`soldCompDiagnostics`/`contract`. Stub: no receipt, no execution keys. Media: 8 rows, 7 distinct content hashes (one duplicate); current evidence version `08c87b241a302c8803ce08a63edceb0e`.
- Verdict: **INCOMPATIBLE** with the binding contract (it predates receipts and binding; matching photos are irrelevant). Listing it today yields `UNVERIFIED:absent` -> no authority.
- Operator recovery: after the candidate is deployed (not authorised here), an authenticated owned-item refresh (`refreshMarketData`: `collectionItemId` + `ownedRefresh`) must be run for the canonical row — a fresh authorised re-enrichment (spends provider units). It issues a receipt bound to `{cv_1790809927798_txjz5n, 01a0bb24…, evidenceVersion}`; the client then syncs that row; no media may be added or changed before listing (any change gives `EVIDENCE_VERSION_STALE`, re-enrich again). No refresh or mutation was done here.
- **Gate B preflight prerequisite added:** every asset to be listed needs a bound receipt issued AFTER its final media set (OML canonical currently has none).

## A2 — listing smoke runtime
Measured 170.7 s and 170.9 s in two runs (the earlier successful run used a 580 s allowance; its real time was not recorded). Per-line timestamps: 33 handler invocations, 19 GetUser checks, 172 assertions; **77 inter-line gaps >1 s account for 157.7 s of 170.7 s (92%)**, typically 2.2–2.6 s each, in two places: (a) between `[Q41-override]` and `authority evidence sources` — the handler's serial awaited remote-Postgres round trips (auth/inventory preflight, `assertListingAuthorized`, canonical-row read); (b) ~2.3 s after `AddFixedPriceItem` for the durable LISTED outcome write. Fixture init ~3.3 s. eBay is mocked (no network, no retry/backoff). Dominant contributor: serial awaited Development-Neon round trips (not split per call; no instrumentation added). Per-file ceiling for this one file: 240 s; default unchanged for all others. `u1-generic-book-live` (95.6 s) is a second file above 90 s.

## A3 — structural exception (certification gap)
`grailkey-commit-v1` `KNOWN_UNWRAPPED = [/^let confirmedVariant = …/, /^confirmedIssue = gk152Rescue\.issue;$/]`: exact-line match (good) and it fails on any extra bare write (`unexpectedBare`, and `bareLines.length <= KNOWN.length`). It does **not** fail when the excused write disappears (`f9da6ae` wraps it in writeConfirmed; the stale exception would then pass silently). **Not self-expiring: certification gap, must be corrected before branch integration** (assert every KNOWN entry matches exactly one current line). Principle: *an exception to a structural invariant must fail when its subject disappears.* `f9da6ae` is not in `17a5736`.

## A4 — banked follow-up
An unlinked Collection row (e.g. the OML stub) already gets no listing authority; the refusal is generic (`ACTION_AUTHORITY_NOT_READY`, receipt source `UNBOUND`/`UNVERIFIED:absent`). Required: an actionable operator-facing code `PHYSICAL_ASSET_NOT_LINKED` (no UI/handler change in this sweep; no claim that the stub is a second object).

## A5 — null/CONTESTED issue, current behaviour
- Issue null, no comps-pool rescue: `[commitB-market-evidence]` clears `out.price`/bands, stores `hypotheticalReferenceEstimate`, `authoritativeRecommendation=null`; exact-market-evidence counts forced to 0; `identityComplete=false` gives the `identity-incomplete` blocker (ID_REQUIRED). No execution authority.
- Issue CONTESTED with a real price (GK-159, comps rescue GK-152): price is KEPT, state REVIEW, never EXACT_CURRENT/READY, `listable=false`; a rescued issue is CONTESTED, never CONFIRMED.
- Versus D2: D2 wants a labelled informational estimate with preserved CONTESTED identity and disclosed uncertainty, and "valuation unavailable" when unsupported. The contested case is close (price kept, REVIEW); the null-issue case hides the price and keeps only a hypothetical reference field — card labelling is the gap. Not implemented (the P0-C adjudication of gk271 / Detective #31 applies D2 later).

## A6 — evidence-version determinism
`computeEvidenceVersion` filters non-strings/empties, **explicitly sorts**, joins with `|`, sha256, 32 hex; empty gives null; DB order is irrelevant (`listAssetMediaContentHashes` has no ORDER BY, the sort covers it). Duplicates are NOT deduplicated (a re-uploaded identical photo changes the version; deterministic, but arguably wrong — OML has 8 rows/7 hashes). Covered by `tests/v1-receipt-asset-binding.test.js`: order independence, content sensitivity, adding a hash -> STALE, lookup-failure sentinel. **Not covered (required next phase):** removal changes the version; duplicate-hash policy (decide dedupe, then test); empty set -> null with later media gain; missing/null hash rows skipped deterministically; cross-process stability against a pinned golden value.

## D2 (recorded): estimate, labelled — applies to the future P0-C adjudication; not implemented.

## Verdict: HOLD
Not a release PASS. Open: 2 newly-failing expired fixtures (commit-e, b1rc-schema-compat) to repair, the A3 gap, 3 unresolved timeouts, 2 product defects (comp-filter-hygiene, artist-registry-sync), 4 undetermined, the P0-C narrowing, OML needs a fresh authorised re-enrichment, deployment unauthorised.
