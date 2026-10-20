# Gate B authority audit: Old Man Logan #25 (2026-10-20)

Start HEAD `6822a6e` (this audit's evidence-safeguard commit is `5624e4d`). Release HOLD. **Read-only:** one `BEGIN READ ONLY` transaction against Production (`transaction_read_only = on` asserted before each read, `ROLLBACK` after) through `scripts/oml-gate-b-production-readonly.mjs`. No provider call, no refresh, no repricing, no Vision, no Q41, no eBay call, no Production write, no push, no deploy. Photo bytes and credentials were never read or printed (marketplace credential columns are excluded).
Labels: **VERIFIED (Production)** = read from the real Production database today. **CODE** = read from source at HEAD `v1-source-authority` (not deployed) or at `ba82e93` (the Production commit). A stored field is not a certified field.

## 1. The actual Production row (VERIFIED, read 2026-10-20)

| Item | Value |
|---|---|
| Collection row | `cv_1790809927798_txjz5n`, `asset_category` comic, created 2026-09-30 (server sync time), last updated 2026-10-16T03:58:35Z |
| Physical asset | `01a0bb24-c806-7a63-aa86-ce26fe8eed83`, class comic, status active, minted 2026-09-19. One `collection_item_link` (linked 2026-09-19 by the owning principal); `current_owner` = the same principal |
| Inventory | `AVAILABLE`, one transition `UNMANAGED -> AVAILABLE` ("operator-enrollment", 2026-09-30) |
| title | `"old man logan deodato"` (lowercase), `identityAuthority.title = OPERATOR_CONFIRMED`. `confirmedTitle` is still `"Wolverine: Old Man Logan Giant-Size"` (a different product's name, stale) |
| issue | `"25"` (no authority record) |
| variant | `"1:25"`, `identityAuthority.variant = OPERATOR_CONFIRMED`; but `variantNote` null, `variantReconciliation` authority NONE (value null, vision conflict "1:25"), `variantApplicability` UNRESOLVED; the correction was recorded as `provenanceTrust: client-reported` |
| year | `"2017"`, `yearAuthority` CORROBORATED (sources: catalog + vision), `confirmedYearMeta` source "pricecharting" although every `pc*` field is null; not OPERATOR_CONFIRMED |
| publisher | `"Marvel"` (no authority record, no backfill provenance) |
| grade | governing `9.2` (operator), `gradeAuthority = OPERATOR_CONFIRMED`, set 2026-10-16T02:55:50Z; raw model grade `"VF 8.0"`; not slabbed; `gradeLocked` true |
| Photos / evidence | 8 durable `media` rows, 7 distinct content hashes (two rows share one hash). Roles: FRONT, BACK, SPINE, PAGES, DETAIL (one each) + 3 `capture-photo` rows with no role. The Collection `remoteImages` holds 1 catalogue blob (not a kernel media row). Evidence version recomputed from the 8 hashes: `08c87b241a302c8803ce08a63edceb0e` (matches the value in the 17a5736 sweep doc) |
| Authority receipt | **absent**: no `authorityReceipt` or `authorityProvenance` key in the 323-key attribute set |
| Pricing contract (stored) | state `ESTIMATED`, `listable: false`, tier 3, source `active_ask_derived`, price **$15.10** (quick 12.74 / market 15.10 / stretch 17.36), lock `market-standing-no-sold-evidence` (soft), `actionAuthority.state = REVIEW`, reason `NO_SOLD_EVIDENCE`, identityStanding CONFIRMED; decision `RESEARCH`, confidence LOW |
| Price bands (stored, separate field) | tier 3, `source: tier3_active_discounted`, market **$4.18** (quick $2.13, stretch $4.81), `variantAdjusted: false` |
| Price derivation trace | `final 4.18` = average of **16** "eligible_active" asks ($2.50 to $10.00, mean $4.92) x 0.85 |
| Comparable evidence | `comps`: **6** browse_api listings, titles are 1:25 Deodato variant copies, asks $14.99 to $24.99, avg $17.76 (x 0.85 = $15.10); `soldCompDiagnostics`: raw 0 / verified 0 / newest null; comps cached 2026-10-16T03:58Z (4 days old); `matchConfidence` HIGH 91; `priceNote` says "16 verified comps" |
| Other stored prices | `listPrice` null, `listPriceManual` null, `authoritativeRecommendation` "$4.18"; latest durable `valuation_event` **$15.28** (OPERATOR_OVERRIDE, grade 9.2, 2026-09-19 22:52Z) above an earlier $0.00 CLIENT_ASSERTED row |
| Durable decision / action / outcome | one `decision_event` (RESEARCH, 2026-09-19, tied to the $0.00 valuation); **0** `operator_action_event`; **0** `outcome_event`; `ebayItemId`/`ebayUrl` null |
| Seller connection | EBAY `CONNECTED` for the owning principal, scopes include `sell.inventory`, `sell.fulfillment.readonly`, `sell.finances` (connected 2026-10-03) |
| Listing eligibility today | not listable: stored `listable: false`, authority REVIEW. Refusal reasons on record: `NO_SOLD_EVIDENCE` (market standing), warning `no-sold-candidates` |

**The row contradicts itself on price.** The contract and `price` say $15.10 (6 variant-matching asks); `priceBands`, `authoritativeRecommendation` and the derivation trace say $4.18 (a 16-ask pool averaging $4.92, `variantApplicability` UNRESOLVED, `variantAdjusted` false). The 16-ask pool's titles are not stored, so which listings it holds is **not established**; its prices ($2.50 to $10) are far below every one of the six 1:25 variant asks, which suggests it includes non-variant copies. That is an inference. Under the Customer-Grade Standard a card must not ship a price that contradicts its own evidence panel.

## 2. Facet authority matrix

| Facet | Stored value (VERIFIED) | Provenance (VERIFIED) | OPERATOR_CONFIRMED | Can ordinary Collection writes change it? (CODE) | Does a change append an operator correction event? | Can a change invalidate the pricing basis? | Explicit verification before LIST |
|---|---|---|---|---|---|---|---|
| title | `old man logan deodato` | 7 `operator_correction_event` IDENTITY/CORRECT rows (2026-10-16 02:30 to 03:57Z). The value moved "Old Man Logan" -> "old man logan deodato" -> variants with "1:25"/"1/25" -> back, several times | **Yes** | **No.** `/api/collection` keeps the existing value of an OPERATOR_CONFIRMED lockable facet through overwrite, explicit null and omission (`repository.js` `protectedAttributesMergeSql`, `IDENTITY_LOCKABLE_VALUE_KEYS`). Only a validated manual correction (`applyIdentityAuthorityPatch`) changes it | **Yes** (event written in the same transaction; 7 observed) | Yes (comp query, listing title) | **Yes.** The operator must confirm the intended final form; it contains the artist name, is lowercase, and flipped repeatedly |
| issue | `25` | no authority record; `identityAlignment.confirmedSource` "manual"; the pipeline's issue invariant held at 25 | **No** | **Yes.** Unlocked facets are ordinary client state; a full-replace write can change it | **No** (an ordinary write appends nothing) | Yes | **Yes.** Strongly supported (comps titles say #25, audit trace consistent) but not certified |
| variant | `1:25` | 3 variant CORRECT events (null -> "1/25" -> "1:25" -> "1/25" -> "1:25"); trust `client-reported` | **Yes** | **No** (same protection as title) | **Yes** (3 observed) | Yes: variant decides comp relevance; `variantApplicability` is UNRESOLVED and the band pool is not variant-adjusted | **Yes**, and the stored authority is on client-reported provenance |
| year | `2017` | `yearAuthority` CORROBORATED (catalog + vision); `confirmedYearMeta` source "pricecharting" with null PC fields | **No** | **Yes** (unlocked) | **No** | In the comp query and title. Not through the grade multiplier: 2017 selects the modern table (9.2 = 1.2 vs vintage 1.8), but that multiplier only multiplies the price in the Tier-4 branch; this row is Tier 3, so it is reference-only (CODE `api/enrich.js` ~8527 and the trace above) | **Yes** |
| publisher | `Marvel` | no authority record, no backfill provenance | **No** | **Yes** (unlocked) | **No** | In the comp query and listing facts | **Yes** |
| grade | `9.2` (operator) | 1 GRADE/SET correction event (2026-10-16T02:55:50Z, source `enrich-owned-action`) | **Yes** | **No.** Six grading keys are fully protected: the existing value always wins, an explicit null cannot clear it (GK-260/261) | **Yes** | In Tier 3 the grade is not multiplied in; it affects listing text (suffix "NM-") | Already explicit and operator-owned; confirm it is the number to publish |

Not observed: any unauthorized change. The unlocked facets (issue, year, publisher) are theoretically changeable by an ordinary write with no correction event; nothing in the row suggests it happened (`updated_at` matches the last enrich).

## 3. Authority receipt

1. **Does the canonical row have one?** No (VERIFIED, no `authorityReceipt` / `authorityProvenance` attribute).
2. **Is an authorized owned-item refresh required?** Yes. The receipt is issued only by `api/enrich.js` (`finalizeWithReceipt`) on an authenticated request; the refresh is `refreshMarketData` (`collectionItemId` + `ownedRefresh: true`). Nothing else mints one.
3. **Does it consume provider units?** Yes. `enrich` costs **2** spend-guard units of the principal's 300/day (`spendGuard.js`), and the call reaches external providers (eBay Browse for comps, PriceCharting). It re-derives price, comps, contract and decision, so it is also a **repricing** event. This audit did not do it.
4. **Binding:** the receipt names `{collectionItemId, gkAssetId, evidenceVersion}` (`authorityReceipt.js`, 17a5736). It binds to the row, the linked asset and a hash over the asset's media content hashes. Today that version is `08c87b24…` (8 rows). Adding, removing or changing any media gives `EVIDENCE_VERSION_STALE` and requires another refresh, so photos must be final before refreshing.
5. **Can existing Production code produce it?** **No.** `git grep authorityReceipt ba82e93 -- api src` returns nothing; the receipt module first appears in `a4788d5`.
6. **Required integration:** `v1-source-authority` is 20 commits ahead of `ba82e93` (receipts `a4788d5`, binding `17a5736`, `PHYSICAL_ASSET_NOT_LINKED` `73c6587`, per-item bulk link gate `81a0a0b`, governing-grade comparables `8646878`, test repairs). It must be integrated and deployed (explicit PUSH AUTHORIZED / DEPLOY AUTHORIZED words; the Vercel rollback window is unconfirmed and extra retention was declined) before a receipt can exist. Only then can the refresh run, and the refresh must follow the final photo set and the final identity facets.

## 4. Listing preflight: Gate B evidence matrix

| # | Gate B condition | Result | Evidence |
|---|---|---|---|
| 1 | Owned physical asset | **PASS** | link + `current_owner` match the owning principal (VERIFIED) |
| 2 | Inventory AVAILABLE | **PASS** | `inventory_current_state.state = AVAILABLE` (VERIFIED) |
| 3 | Durable photos | **PASS** | 8 media rows, FRONT/BACK/SPINE/PAGES/DETAIL present, 7 distinct hashes; caveat: 3 rows carry no role |
| 4 | Correct title | **UNKNOWN** | operator-confirmed `old man logan deodato`, but whether that is the intended listing title is the operator's call; unstable history |
| 5 | Correct issue (25) | **UNKNOWN** | well supported, unlocked and uncertified |
| 6 | Correct 1:25 variant | **PASS** for the facet (operator-confirmed, 3 events, comps agree); **FAIL** for variant applicability (UNRESOLVED, `variantNote` null) | VERIFIED |
| 7 | Year 2017 | **UNKNOWN** | CORROBORATED, unlocked; of the 5 comp titles stored in `recentSales` (the sixth is not stored), 2 say 2017, 1 says 2016, 2 give no year |
| 8 | Publisher Marvel | **UNKNOWN** | no authority record |
| 9 | Governing grade 9.2 | **PASS** | OPERATOR_CONFIRMED, protected, event recorded |
| 10 | Current comparable evidence | **FAIL** | 0 sold comps, asks only, comps 4 days old, no sold dates |
| 11 | Correct price-band population | **FAIL** | bands ($4.18) and contract ($15.10) come from different populations; band pool unverified, variant applicability UNRESOLVED |
| 12 | Approved listing price | **FAIL** | no LIST `operator_action_event`, `listPrice` null; three differing candidates ($15.10 / $4.18 / $15.28 override) |
| 13 | Authority receipt | **FAIL** | absent, and not producible by Production code |
| 14 | Q41 cent-level confirmation | **UNKNOWN (execution-time)** | not yet performed; with authority REVIEW it is the only path (server derives readiness from the request in Production; in the branch it needs the receipt-verified evidence and the price must equal the durable LIST action price) |
| 15 | Existing eBay listing reconciliation | **PASS** for the GrailKey ledger (no outcome, no item id, no operator action); **UNKNOWN** on eBay's side (no eBay read was made) | VERIFIED / not checked |
| 16 | Actual server-side LIST authorization | **FAIL today** | needs `gkAssetId` + `decisionEventId` + `operatorActionEventId` (none for LIST exists; the only decision is the 2026-09-19 RESEARCH tied to a $0.00 valuation); readiness REVIEW; in Production the answer is `GRAILKEY_LINKAGE_INCOMPLETE` or `ACTION_AUTHORITY_NOT_READY`. `operator_authority_event` exists in Production (0040 family present), so the branch's durable OPERATOR_MANUAL path has its table; full 0040 column set was not checked |

Also verified: the seller connection is CONNECTED with `sell.inventory`.

## 5. Minimum remaining actions before the first governed listing (in order)

1. Operator verifies title, issue, year, publisher (and confirms variant 1:25 and grade 9.2) as the intended listing facts; lock any that should be locked through the validated correction path (that appends events).
2. Photos final (the evidence version freezes at refresh time).
3. Authorize integration and deployment of `v1-source-authority` (explicit words; resolve rollback posture first).
4. Authorize one owned-item refresh (2 units, repricing): then the receipt exists, and the comps/contract/bands are recomputed. Re-read the row afterward; the $15.10 vs $4.18 contradiction must be gone or explained, and the price population shown.
5. Record the durable LIST operator action at the approved price (and a decision tied to the current valuation).
6. The operator performs the Q41 cent-level acknowledgment at listing time; the price must equal the LIST action price.
7. Check eBay's side for an existing OML listing (read-only).

## 6. Raw-ledger durability finding (sweep runner)

1. The ledger is the third positional argument of `sweep-runner.mjs run <tree> <out.jsonl>` (there is no `--ledger` flag). Any path is accepted, including a temporary scratchpad; the 596f868 ledger was recovered from one.
2. No durable default exists. With no path the runner crashes on its first append, before any test runs.
3. It does not reject an unsafe destination (temp directory, outside the repo) or a missing parent directory beyond that crash.
4. Partial results survive a session interruption: every event is appended and `fsync`'d, an interrupted file is re-queued on resume, and a finished file is never re-run. The risk is only the location (a session scratchpad can be cleaned).
5. Smallest guarantee: refuse a `run` whose ledger resolves under `os.tmpdir()` (or require `--evidence-dir`) unless `--allow-temp` is passed. **Not implemented**: it changes existing behavior (`tests/sweep-runner-instrumentation.test.js` and others deliberately use temp ledgers), so it needs separate authorization.
