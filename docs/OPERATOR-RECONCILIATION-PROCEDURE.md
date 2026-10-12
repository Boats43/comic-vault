# Operator reconciliation procedure — ambiguous marketplace attempts (GK-284; B1-FINAL A2/A3; B1-RC RC1–RC3, A3–A4)

Status: LOCAL release candidate, not released. Applies once migration `0040` is live and the single-item OPERATOR_MANUAL publish path is in use.

## 1. Why this exists
When `AddFixedPriceItem` returns anything other than a definite listing id or a definite refusal (timeout, HTTP 5xx/408, system error 10007/10001, an unparseable or Ack-less body, `Success`/`PartialFailure` without an ItemID), GrailKey cannot know whether eBay created the listing. The attempt is recorded `AMBIGUOUS` and **every new publish for that asset is blocked** until an operator closes it. "No ItemID came back" is never read as "nothing was listed."

## 2. Ownership and deadline (no unowned pending state)
* **Owner:** the principal who approved the listing. The review queue is `GET /api/operator-reconcile`.
* **Deadline:** `review_due_at` = `AMBIGUOUS` recorded time + **48 h**. Past it the queue reports `OVERDUE`; a reconciliation record states `reviewWasOverdue`.
* **Dispositions** (each an append-only `OPERATOR_RECONCILED` event; the latest event governs, so new evidence can reopen a closed-but-blocked attempt):

| Disposition | Meaning | New publish |
|---|---|---|
| `LISTING_FOUND` + listing id | The listing exists; reconcile to it; the LISTED outcome is recorded; **nothing is published**. | blocked (a live listing exists) |
| `NOT_FOUND` that PASSES the absence policy, with a publish requested | Non-publication is established to the policy's standard. | block **lifted for this attempt only** |
| `UNRESOLVED` — or a `NOT_FOUND` that fails the policy (stored as `UNRESOLVED`, claim preserved) | Closed **but blocked**: owned, closed, absence not established. | **blocked** |

"Block lifted" never publishes anything. A new listing is a separate request through the normal publish path and needs its own explicit authorization.

## 3. The interface (`api/operator-reconcile.js`)
Authenticated Bearer session (the principal comes **only** from the verified token); the principal must be an **operator-kind** account (`OPERATOR_ONLY` otherwise); the attempt must belong to that principal (`FORBIDDEN` otherwise). It never calls eBay, never publishes, never accepts a client clock or a client-supplied lookup result.

* `GET /api/operator-reconcile` → the caller's review queue.
* `GET /api/operator-reconcile?attemptId=<uuid>` → the exact attempt: asset id, submission time, **correlation label to search for**, current state, approved cents, engine recommendation, review deadline, history, and the policy the observation will be judged against.
* `POST /api/operator-reconcile` `{ attemptId, verdict, externalListingId?, observations?, evidenceRef?, checkedSources?, checkedAt?, requestNewPublish? }` → appends one event and returns `{ recordedVerdict, claimedVerdict, newPublishAuthorized, downgradeReasons, resultingState, publishPerformed:false }`.
No general marketplace administration, no UI beyond this contract. A UI over it is a separate, later item.

## 4. The recovery route that does not require guessing
1. Open the attempt (`GET …?attemptId=`). Note the `GK-<32 hex>` label.
2. In Seller Hub, search the label in **all four** views: Active, Scheduled, Sold, Unsold. Save evidence (screenshots / saved pages) and note the reference.
3. **Found →** `POST verdict:LISTING_FOUND` with the eBay item id. Done; nothing is published.
4. **Not found →** wait until at least **60 minutes after the submission time shown**, check all four views again, then `POST verdict:NOT_FOUND` with all four `checkedSources`, `checkedAt` (when you looked), `evidenceRef`, and `requestNewPublish:true`.
5. **Cannot tell →** `POST verdict:UNRESOLVED`. The attempt is closed and the asset stays blocked; escalate. New evidence later → post another event.
Whatever the claim, the server decides what it is worth (§5). Nothing in GrailKey ever unblocks an asset on elapsed time alone.

## 5. The absence policy `recon-v1` — an OPERATOR POLICY, not a provider guarantee
A `NOT_FOUND` unlocks a new publish only if **all** hold; otherwise it is stored as `UNRESOLVED` with the reasons:
1. All four Seller Hub views checked.  2. An evidence reference is recorded.  3. `checkedAt` is ≥ **60 minutes** after `SUBMITTED` and not in the future (server clock).  4. No seller-scoped lookup found a match.  5. The operator explicitly requested a publish (`requestNewPublish === true`, strictly boolean).
The 60-minute wait exists because eBay documents **no** indexing or propagation guarantee for its seller views. Proof of the property: `tests/b1rc-policy-exhaustive.test.js` enumerates 92,400 input combinations against an independent oracle — 60 authorize, **0 unsafe**.

## 6. eBay `Item.UUID` — the documented duplicate-listing contract (B1-RC A3)
Sources (all read **2026-10-12**): the published Trading API schema `ebaySvc.xsd` version 1487, https://developer.ebay.com/webservices/latest/ebaySvc.xsd (`UUIDType`, `ItemType/UUID`); eBay KB 1462, https://developer.ebay.com/support/knowledge-base/1462 (updated 2022-08-09); eBay KB 74, https://developer.ebay.com/support/knowledge-base/74 (updated 2022-07-15).

| Question | What the sources say | Status |
|---|---|---|
| Format | 32 characters; only digits 0–9 and letters A–F; MaxLength 32 (example is uppercase). GrailKey emits the attempt id as 32 **uppercase** hex characters. | documented |
| XML placement | `<UUID>` is an optional direct child of `<Item>`; `AddFixedPriceItem` is listed among its calls. `ItemType` is an `xs:sequence`; `UUID` precedes `SKU`. | documented (schema v1487) |
| Duplicate behavior | A UUID already used to **successfully** create or relist an item makes the call fail with an error that **includes the existing Item ID** and a boolean saying whether the duplicate came from the same application. KB 1462 shows error **488 "Duplicate UUID used; ListedByRequestAppId=…, item ID=…"**. | documented |
| Existing ItemID returned? | Yes — in that error message. | documented (reliability under load/propagation is **not** documented) |
| Same request required? | KB 1462: "send the **same** AddFixedPriceItem request again"; schema: "use the same UUID". Whether other fields may differ is **not** stated. | partially documented |
| Retention duration | **Not documented** in any source read. | **UNKNOWN** |
| Scope | "unique across all of the seller's eBay across all eBay marketplaces" — per seller account. A different eBay account is a different scope. | documented |
| Calls that fail with blocking errors | The schema says to reuse the same UUID after "one or more (blocking) errors" — a refused call does not consume it. | documented |
| Lost response / ambiguous transport | KB 1462 / KB 74: resend the same request; if it **succeeds**, the first request had failed; if it returns the duplicate error, you receive the existing ItemID. | documented |
| Applies to this integration? | The integration calls the Trading API `AddFixedPriceItem`; the sources make no distinction by auth type. **Not verified in the eBay sandbox** (no verified sandbox seller credential is available). | documented, **unverified here** |

What this does **not** establish:
* **It does not prove absence.** Error 488 proves a listing exists. A success on resend proves the first call had not created one — but that success *is a new listing*. Any other error proves nothing.
* **A same-UUID resend is a marketplace write**, so it needs separate explicit operator authorization even when intended as recovery. It is **not implemented**, and **the ambiguous-attempt block stays** until the recovery contract is certified in a sandbox (retention, propagation delay, differing-body behavior, and error 488 on `AddFixedPriceItem` specifically).

## 7. `Item.SKU` — a label, not a proven lookup key (B1-RC A4)
* In the current configuration (`InventoryTrackingMethod` unset ⇒ eBay's default, `ItemID`), `Item.SKU` is a seller-defined **custom label**. Per the schema, `GetItem` / `GetMyeBaySelling` return it "only if defined for the listing"; "the eBay site cannot identify listings by SKU."
* `GetItem` by SKU requires the listing to have been created with `InventoryTrackingMethod = SKU` (GetItem reference, read 2026-10-12). GrailKey does **not** set it, so **GetItem-by-SKU is not available** for these listings.
* Setting `InventoryTrackingMethod = SKU` has consequences that are not evaluated here and **are not changed**: SKU becomes the unique inventory key (must be unique per product), cannot be removed from the listing, and the schema notes that converting listings with the Inventory API's `bulkMigrateListings` requires the tracking method to be `ItemID`.
* The only seller-scoped path is a `GetMyeBaySelling` list scan matching the label. The reference confirms SKU on **Active** and **Scheduled** items only (not confirmed for Sold/Unsold), limits Sold/Unsold to 60 days, and states **no completeness or latency guarantee**. `src/lib/ebayAttemptLookup.js` implements it read-only and **always reports `absenceProven:false`**.
* **Decision:** SKU is **not** called a reliable lookup identifier. It is a human-searchable Seller Hub label plus a best-effort presence signal. The public Browse API cannot establish absence.
