# Operator reconciliation procedure — ambiguous marketplace attempts (GK-284, B1-FINAL A2/A3)

Status: LOCAL, not released. Applies only once migration `0040` is live and the single-item OPERATOR_MANUAL publish path is in use.

## Why this exists
When `AddFixedPriceItem` returns anything other than a definite listing id or a definite refusal (timeout, HTTP 5xx/408, system error 10007/10001, an unparseable or Ack-less body, `Success`/`PartialFailure` without an ItemID), GrailKey cannot know whether eBay created the listing. The attempt is recorded `AMBIGUOUS` and **every new publish for that asset is blocked** until an operator closes it. "No ItemID came back" is never read as "nothing was listed."

## Ownership and deadline (no unowned pending state)
* **Owner:** the principal who approved the listing (`operator_authority_event.principal_id`). The review queue is `listAttemptsNeedingReview({principalId})`.
* **Deadline:** `review_due_at` = `AMBIGUOUS` recorded time + **48 h** (`AMBIGUOUS_REVIEW_WINDOW_HOURS`). Past it the queue reports `OVERDUE`, and a reconciliation record states `reviewWasOverdue`.
* **Every attempt must end in one of three recorded dispositions** (each an append-only `OPERATOR_RECONCILED` event; the latest event governs, so new evidence can reopen a closed-but-blocked attempt):

| Disposition | Meaning | New publish |
|---|---|---|
| `LISTING_FOUND` + listing id | The listing exists. The attempt reconciles to it; the LISTED outcome is recorded; **nothing is published**. | blocked (a live listing exists) |
| `NOT_FOUND` that PASSES the absence policy, with a publish requested | Non-publication is established to the policy's standard. | **authorized** |
| `UNRESOLVED` — or a `NOT_FOUND` that fails the policy (stored as `UNRESOLVED`, the claim preserved) | Closed **but blocked**: the attempt has an owner and a closing record, absence was not established. | **blocked** |

## The absence policy (a human observation is not automatically proof)
A `NOT_FOUND` observation unlocks a new publish only if **all** hold; otherwise it is recorded as `UNRESOLVED` with the reasons:
1. All four Seller Hub views checked: **Active, Scheduled, Sold, Unsold** (`SELLER_HUB_ACTIVE`, `_SCHEDULED`, `_SOLD`, `_UNSOLD`).
2. An **evidence reference** is recorded (screenshot id, ticket id, saved page).
3. `checkedAt` is **at least 60 minutes after** the recorded `SUBMITTED` time and not in the future. eBay documents **no** indexing or propagation guarantee for its seller views; this wait is an **operator policy**, not a provider contract.
4. A seller-scoped automated lookup (if run) found **no** match for the attempt's label. A match overrides the operator's claim.
5. The operator explicitly **requests** a new publish.
An empty automated lookup never satisfies the policy by itself (see below).

## What to look for
Every OPERATOR_MANUAL listing is sent with an attempt-linked label: `Item.SKU` = `GK-<32 hex>` (a seller-visible custom label) and `Item.UUID` = the same 32 hex. The ambiguous response returns the `GK-…` label. Search Seller Hub for it in each of the four views.

## Seller-scoped lookup — what it can and cannot prove
Official sources, checked **2026-10-12**:
* eBay KB 1462 "ItemID retrieval when you loose the AddFixedPriceItem response" (updated 2022-08-09) — https://developer.ebay.com/support/knowledge-base/1462 : resend the same request with the same `Item.UUID`; if the first call created the listing, eBay rejects with error **488 "Duplicate UUID used"** and returns the existing ItemID. GetItem by SKU works only for SKU-tracked items; "No Matching SKU" is described as allowing an inference. **No timing guarantee is given.**
* eBay KB 74 "No response for AddItem request" (updated 2022-07-15) — https://developer.ebay.com/support/knowledge-base/74
* GetItem — https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetItem.html : lookup by SKU requires the item to have been listed with `InventoryTrackingMethod = SKU`; GrailKey does **not** set that (it would change inventory-tracking behavior), so the label is **not** GetItem-retrievable.
* GetMyeBaySelling — https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetMyeBaySelling.html : seller-scoped Active/Scheduled/Sold/Unsold lists; SKU returned on Active and Scheduled items; Sold/Unsold limited to 60 days; 25,000-item and 125-page ceilings; **no completeness or latency statement**.
* The public Browse API is not seller-scoped and **can never establish absence**.

`src/lib/ebayAttemptLookup.js` implements the read-only GetMyeBaySelling scan and a GetItem-by-known-ItemID check. **It can establish presence; it always reports `absenceProven: false`**, even for an empty, fully paginated scan, together with the documented caveats. Documented operator reconciliation is therefore the **primary** recovery procedure.

## The provider-idempotent resend (not automated, deliberately)
Because the outbound request carries a stable `Item.UUID`, resending the identical request would be safe by eBay's documented contract (at most one listing; error 488 returns the existing ItemID). It is **not** implemented as an automatic retry: it is still an `AddFixedPriceItem` write, so it would need its own explicit operator authorization, and its behavior for AddFixedPriceItem specifically should first be confirmed in the eBay sandbox.

## Escalation
An attempt `OVERDUE` in the queue, or two consecutive `UNRESOLVED` closures for the same asset, is escalated to the product owner; the asset stays blocked meanwhile. Nothing in GrailKey ever unblocks an asset on elapsed time alone.
