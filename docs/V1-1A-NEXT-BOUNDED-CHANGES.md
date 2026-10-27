# V1.1a — next bounded changes (DESIGN ONLY; not implemented)

Status: documented after the V1.1a verification sweep (candidate `a4984ff` + fixture corrections). Plan V3.4 remains frozen.
Nothing below is built. Each item needs its own authorization, tests and review.

## A. One seller action: "Review Listing" -> "Approve & List"

Goal: one explicit seller click authorizes the price acknowledgement and the listing-content package, then publishes.

Why it was NOT done in the verification sweep: today the three server-enforced artifacts come from three separate flows.

| Artifact | Created by | Enforced by |
|---|---|---|
| Listing-package approval (signed, 24h, bound to principal + asset + `packageHash`) | `POST /api/listing-preview` action `approve` | `api/list-ebay.js` (`checkListingApproval`) |
| Q41 price acknowledgement (`q41Override`, lock-class specific) | two inline click handlers in `src/App.jsx` (`research-not-listable`, insufficiency-class locks; needs `priceOverridden` + a valid `q41Ack.price`) | `assertQ41PriceBinding` + `assertListActionPriceBinding` |
| LIST operator action with `actionValueAmount` = approved price | `GrailKeyOperatorPanel.jsx` -> `POST /api/operator-action` with a pending-idempotency-key lifecycle | `validateOutcomeAttachment`, price binding |
| C1 authority receipt | `api/enrich.js` (already on the durable row) | `resolveListingAuthorityEvidence` |

A single click that "builds" those would duplicate three code paths that cannot be click-tested end to end, and could manufacture an acknowledgement the seller did not actually see.

Safe design (one orchestrator, shared modules, every gate still server-side):
1. Extract the Q41 payload builders and the LIST-action recorder into pure, unit-tested modules that the existing buttons ALSO use (no behaviour change first).
2. `approveAndList()` runs strictly in order and aborts on the first failure, writing nothing after it:
   `preview(draft)` -> show review (price, title+variant, condition+specifics, description, actual photographs, unresolved items, shipping/returns text, and the explicit statement of what the approval does NOT cover) -> on click:
   (a) `approve` (signs the package) -> (b) Q41 acknowledgement, ONLY when the review displayed the exact locks being acknowledged and they are all acknowledgeable (never for REFUSED / non-insufficiency locks) -> (c) record the LIST action at exactly the displayed price (idempotent key) -> (d) `POST /api/list-ebay`.
3. Server contracts unchanged: the handler still independently requires the receipt, Q41/price binding, the LIST action price and the package approval. The orchestrator creates artifacts; it never grants authority.
4. Tests: order, abort-without-side-effects at each step, idempotent retry after a lost response, a changed price/package mid-flow invalidating the approval, REFUSED never offering the button.

## B. Server-side loading of approved photographs (replace client-carried bytes)

Current transport: the client fetches each approved photo through `/api/asset-media`, re-verifies the hash, and sends the bytes as data URLs in the `/api/list-ebay` JSON body (guard: ~4.2M characters; Vercel request limit 4.5 MB; 3 MB per photo; up to 12). The server requires that the set of SHA-256 hashes equals the approved package exactly and reorders to the approved order, so a client cannot substitute bytes. Limits: many/large photos can exceed the request size.

Target: client sends `gkAssetId` + the approved ordered media ids/hashes only. The server resolves owner-scoped media (`getMediaById` authorization -> `media.getBytes`), verifies each SHA-256 against the row and eligibility (image types, `capture-photo`/`grading-photo`), builds the provider payload itself, and ignores any client-supplied bytes. Existing durable storage and authorization are sufficient.
Smallest implementation: one server loop in `api/list-ebay.js` replacing `item.images` handling with durable reads (plus removing the client fetch loop and the request-size guard once proven). Keep the current guards until the replacement has passing tests.

## C. Approval boundary (what `packageHash` covers)

Covers: eBay category, title, condition id (currently none), the shipping-independent description body (identity, variant, condition disclosure/grade, seller note, photo-coverage disclosure), item specifics, the ORDERED photo content hashes, and the price. Expires after 24 hours.
Does NOT cover: shipping service/cost, handling time, returns, Best Offer, item location. The panel states this.
V1.1b must put seller-approved shipping and return policies into the final publication authorization, and bind the approval to the asset's listing GENERATION so an approval cannot be re-presented for a relist inside its 24-hour life.

## D. Known minor items found during verification

- `listActiveListingsForChannel` (`src/modules/assets/repository.js`) treats a listing as ended if ANY terminal row exists for its external id; its comment says "after it". Harmless in production (eBay ItemIDs are unique and never reused) but it is why `tests/list-ebay-outcome1-handler-smoke.test.js` cannot assert duplicate protection (it pre-seeds a DELISTED row for its fake ItemID). The duplicate proof lives in `gkp0-listing-live` (including re-presenting the SAME valid approval) and `gkp0-failure-injection-live`.
- `/api/listing-preview` shares the per-principal+IP limiter (30 requests / 10 minutes) with other endpoints.
