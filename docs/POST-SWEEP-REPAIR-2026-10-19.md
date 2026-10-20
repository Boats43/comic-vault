# Post-sweep repair + migration census (2026-10-19) — local only, release HOLD

Candidate `17a5736` (sweep), report `2608261`, repair commit on top of both (see git log). No push/deploy/Production mutation/Vision/eBay write.

## Engineering laws (recorded)
- **Law 1 — A structural exception must fail when its subject disappears.** (Enforced for the GK-152 write in `grailkey-commit-v1`; see R2.)
- **Law 2 — A passing test can encode a defect as a requirement. Green results do not establish contract correctness.** (See the A4 audit: tests that seed client-written authority and pass, or whose assertions only mirror an old trust model.)

## A1 — Collection-wide authority census (read-only Production, 2026-10-19)
| Measure | Count |
|---|---|
| Collection rows (1 principal) | 281 (279 comic, 2 book) |
| Rows linked to a canonical gkAssetId | 3 (3 distinct assets) |
| Rows with ANY `authorityReceipt` (new contract needs signature + binding) | **0** (0 sig, 0 binding, 0 provenance) — receipts have never been issued in Production; the contract is not deployed |
| Rows lacking a valid receipt | **281** (a receipt's HMAC cannot be verified outside Production, but none exists to verify) |
| Rows carrying loose, client-written execution fields | 278 with `decision`/`soldCompDiagnostics`/`contract`; 270 with `pricingSource`; 155 whose loose `decision` says LIST_NOW/LIST_LOW — unverified, now inert |
| Would fail listing authority specifically for receipt absent/unbound/stale | all 3 linked rows (the only ones that reach the receipt check): receipt `UNVERIFIED:absent` |
| Already ineligible for independent reasons | 278 unlinked rows (no gkAssetId -> `PHYSICAL_ASSET_NOT_LINKED`, banked A4 of the sweep); additionally for the 3 linked: 0 have a LIST operator action; Batman 182 (`cv_1792018619215_mphyy3`) is not enrolled in inventory (2 AVAILABLE: New Mutants 98, Old Man Logan 25); all three loose decisions are RESEARCH |

Missing receipts are NOT read as "otherwise listing-ready": no linked row is listing-ready today for independent reasons (no LIST action).

## A1b — does OPERATOR_CONFIRMED survive an authorised refresh? (code reading; NOT executed against Old Man Logan)
Old Man Logan #25 (`cv_1790809927798_txjz5n`): `identityAuthority = {title, variant: OPERATOR_CONFIRMED}`, `gradeAuthority: OPERATOR_CONFIRMED` (operatorGrade 9.2; stored grade "VF 8.0"), title "old man logan deodato", variant "1:25", issue "25" (NO issue lock on this row; issue locks exist on 41 other rows). Census: OPERATOR_CONFIRMED title 1 row, variant 1, issue 41; operator grade 5 rows.
- **Title:** survives — server `resolveOperatorTitleLock` (durable authority) + `governingTitleForMerge` client-side; last-line restore in api/enrich.js.
- **Variant:** survives on the server — `operatorVariantLock` (durable `identityAuthority.variant === OPERATOR_CONFIRMED`) overrides Vision and reconciler (`p0-operator-variant-authority`). Client merge for variant is `hasOwnProperty(enrich,'variantNote') ? enrich.variantNote : item.variant`, so survival depends on `variantNote` carrying the locked value: **unverified by execution** — must be proven before the real refresh.
- **Issue:** refresh sends `item.issue`; the merge does not write `issue` (spread preserves it). No server lock exists for OML's issue.
- **Grade:** server-owned operator grade (GK-260); client merge copies `gradeAuthority/operatorGrade*` only when `enrich` carries the key, else keeps the item's. Refresh does not write `grade`.
Recommendation: before the real refresh, run the refresh handler against an isolated copy of an OML-shaped Development row and diff title/variant/issue/grade/authority (no such run exists yet).

## A1c — recovery workflow, calls, cost
1. (Prereq, not authorised here) candidate deployed.
2. Operator opens OML #25 in the app, authenticated; triggers "refresh market data" (`refreshMarketData`: `POST /api/enrich` with `collectionItemId`, `ownedRefresh:true`, `skipImageSearch:true`, `skipClaudeCheck:true`, cached claudeCheck, `pcProductId`).
3. Server: resolves link + media hashes (2 DB service calls), runs pricing pipeline, signs a receipt bound to {row, gkAssetId, evidenceVersion `08c87b24…` while the 8 media rows stand}.
4. Client merges and syncs the row (`PUT /api/collection`); server verifies receipt; row-binding check passes (same canonical row).
5. No photo may be added/removed afterward (any change -> STALE, repeat 2–4). OML also needs a LIST operator action + decision for listing (it has none).
- **External calls expected (from code, not measured this pass):** eBay Browse (OAuth + searches), PriceCharting (id-anchored fetch + sales scrape; KV cached 24 h), ComicVine, no Anthropic/Vision call (claudeCheck cached, image search skipped) — so no model spend expected.
- **Cost:** spend-guard units = **2 per enrich** against the 300/day principal (design constant, measured nowhere this pass). Dollar cost per row: **not measured**; the provider-call mix above implies no per-token model charge; eBay/PC/CV are quota-based. **Estimate: ~0 model dollars, 2 guard units/row.** For the 3 linked rows: 6 units.

## A2 — database latency (source inspection + measurement)
- One lazy `pg.Pool` **per module** (assets, auth, buyer, collection, inventory, learning, marketplace, valuation; `max: 5` each) — pools are reused across calls; they are not shared between modules.
- Every `acquireConnection()` runs `assertEnvironmentIdentity(client)` — a marker query, **deliberately not memoized** (GK-179) — before the caller's own queries; each service call then runs principal-active / asset-exists / ownership checks before its real query: roughly 4–6 sequential round trips per service call, no batching.
- `api/list-ebay.js` issues >=9 sequential service calls before the publish (validateOutcomeAttachment, assertListingAuthorized, canonical id, getMyCollectionItem, getAssetMediaContentHashes (twice — the 17a5736 evidence-version lookup is a second read of what the photo guard reads again later: ~6 extra round trips), getOperatorActionForListing …) and writes the LISTED outcome after each (mocked) publication (~2.3 s).
- **Measured** (Development Neon from this machine, 2026-10-19, `select 1` x12): **~48–51 ms per round trip**; cold pool connect + first checkout **971 ms**; warm checkout **0 ms**. 2.2–2.6 s per handler segment therefore corresponds to roughly 45–50 sequential round trips (inferred from source, not instrumented). Dominant source: **serial application waiting on remote round trips**, not connection establishment (warm) and not query execution (trivial). Cold connects add ~1 s once per module per process.
- Development-specific in magnitude (remote laptop -> us-west-2 Neon pooler); the round-trip COUNT is code and applies in Production, where RTT from a same-region function is lower (unmeasured). Not optimised in this repair.

## A3 — three extended (240 s) reruns, one worker, gated
| File | Elapsed | Exit | Outcome |
|---|---|---|---|
| gk265-phase3-seller-execution | 156.5 s | 0 | **PASS** 44/0 — completed under the longer allowance (latency cause not independently proven) |
| b1-operator-authority-live | 211.0 s | 1 | **FAIL** 141 passed / 4 failed — completed (no deadlock). Failing: `#9 every contradiction is named`, `#9 zero verified sold evidence and the missing snapshot are recorded, not hidden`, `#9 evidence class and verified sold count (0 of 30) are recorded from the durable catalogue`, `A1 evidence classification … stored as columns (UNKNOWN, null)`. The test seeds `decision`/`soldCompDiagnostics {rawCount:30,verifiedCount:0}` directly into the Collection row (client-style attributes) and expects them read back as durable evidence; the receipt contract now treats such values as unverified (A4 defect class). |
| collection-sync-closeout-live-proof | 240.0 s | killed | **TIMEOUT retained (unresolved).** Last output: `-- phone creates item (persistCollectionItem, real local write + real server round-trip) --`; nothing after. Not classified as a deadlock (hand-rolled fake IndexedDB that never fires `transaction.oncomplete` is a known suspect, unproven). |

## A4 — audit of tests treating client-supplied authority as trusted (no repair here)
Searched for request/attribute-supplied `decision`/`pricingSource`/`soldCompDiagnostics`/`contract` in tests that reach READY, Collection persistence or listing authorisation.
- **Defect-class (client value treated as trusted evidence through a REAL path):**
  - `b1-operator-authority-live.test.js` (#9, A1 — rows seeded with client-written `decision`/`soldCompDiagnostics`, read back as "durable catalogue" evidence; 4 live failures above).
  - `b1rc-schema-compat.test.js` — **repaired in this commit** (request-borne READY verdict).
  - `grailkey-operator-panel-capture-wiring.test.js` (FAIL, pre-existing): derives a durable valuation from a client-supplied `price`; candidate defect — confirm what it asserts about authority before repair.
  - `gk227-asset-media-append-handler-smoke.test.js` (FAIL, pre-existing): single request-borne authority field; setup failure masks it.
- **Mirror-drift candidates (pure-function unit fixtures that re-implement the OLD request-evidence trust model; they pass and prove the derivation, not the trust boundary):** `gk238-authority-truthfulness-hotfix` (41 authority fixtures, header says "MIRRORED server-side re-derivation" of the old resolver), `grailkey-directive-z-transaction-authority`, `-ap-variant-unresolved-authority`, `-ar-evidence-authority`, `-ah-sold-fallback-authority`, `gk268-decisionsafe-advisory-verification`. Their READY assertions are about `deriveLocks/deriveActionAuthority`, harmless as such, but none exercises the receipt resolver; the real-handler authority path is covered by `v1-collection-source-authority`, `v1-enrich-authority-receipt`, `v1-gk240-…`, `v1-receipt-asset-binding`.
- **Harmless request fixtures:** handler tests that reach success through the explicit Q41 operator acknowledgement (`list-ebay-photo-handoff`, `list-ebay-outcome1-handler-smoke`, `b1rc-ebay-xml-contract`, `gk-p0-marketplace-operator-gate` etc.) — an operator-declared override, not trust in client evidence.
Recommended later: re-point the mirror fixtures at `resolveListingAuthorityEvidence`.

## R1–R3 (this commit)
- `grailkey-commit-e`: the literal `res.status(200).json(finalizeResponse(out));` pin replaced with a structural invariant (terminal send sends the full finalized `out`, directly or through `finalizeWithReceipt`, which must finalize and return the same object and only add `authorityReceipt`).
- `b1rc-schema-compat`: READY now comes from a server-issued, asset-bound receipt persisted through `updateCollectionItem` (issued with the real `issueAuthorityReceipt`, binding = row + asset + current evidence version); the old request-borne verdict is kept only as a negative (403, zero `AddFixedPriceItem`). 13/13.
- `grailkey-commit-v1`: the exception list is two-sided — no unexpected bare write AND every listed exception must match exactly one current bare line, with synthetic self-tests proving each direction (extra write fails; site removed fails; site duplicated fails). Verified against the real P0-C tree (`f9da6ae`): the GK-152 exception no longer matches there, so merging P0-C will fail this test until the dead exception is deleted. `f9da6ae` NOT merged.
- `v1-receipt-asset-binding`: +12 evidence-version tests: golden (input set recorded in the test) `1de3602a01e06e91f8b4ab1201b1736b`, all 6 permutations, removal, addition, duplicate add/remove (duplicate-sensitivity preserved), empty/null/non-string, OML 8-rows/7-hashes shape, null-version receipt going STALE when media is later added. Old Man Logan has 8 media rows / 7 distinct hashes, so removing the duplicate RECORD would change its evidence version. No Production media touched.

## BANKED D2 requirement (not implemented)
For null issue identity, `hypotheticalReferenceEstimate` must carry explicit machine-readable non-authoritative provenance (e.g. `{value, authority:'NONE', basis, executable:false}`); programmatic consumers must not mistake it for an established valuation or executable pricing authority. CONTESTED identity may retain an evidence-supported informational estimate while listing stays locked.
