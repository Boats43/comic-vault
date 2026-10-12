# Operator-only eBay `VerifyAddFixedPriceItem` route — DESIGN ONLY (B1 Release Gate v2 G1)

Status: **design. Nothing here is implemented, deployed or authorized.** No eBay call was made while writing it. Implementing the route is a separate release (it changes the Production API surface) and each execution of it is a marketplace-API call needing its own authorization.

## 1. Purpose
Obtain eBay's own validation of the OPERATOR_MANUAL packet — in particular the placement of `Item.UUID` and `Item.SKU` — **without creating a listing**. `VerifyAddFixedPriceItem` tests an item definition "without creating an actual listing"; its returned ItemID is always 0 (official Trading API reference, read 2026-10-12).

## 2. Why a route is needed at all
The seller credential lives only in Production (encrypted per-principal marketplace connection, `src/lib/ebayPrincipalToken.js`). It must not be exported, pulled into a laptop, or pasted anywhere. The only safe place to use it is server-side in Production. Hence a small authenticated route, not a script.

## 3. Proposed shape
`POST /api/operator-ebay-verify` (new file `api/operator-ebay-verify.js`).
* **Auth:** Bearer session; `principalId` from the verified token only; `isOperatorPrincipal` required; fail closed on any error (503). Rate limit as `api/operator-reconcile.js`. Production-only guard is not needed (it is read-only), but the route is **disabled unless env `OPERATOR_EBAY_VERIFY_ENABLED=1`**, set only for the window of use and removed after.
* **Input:** `{ gkAssetId, priceCents }` only. **No packet, XML, URL, credential or call name is accepted from the client.**
* **Server builds the packet** with the same builder `api/list-ebay.js` uses for OPERATOR_MANUAL (same governed listing facts, same correlation block) so what is verified is what would be sent. A **throwaway** UUID/SKU (`GK-VERIFY-…`, random) is used, never the asset's real attempt correlation, and **no `operator_authority_event` row is written**.
* **Call:** the call name is a hard-coded constant `VerifyAddFixedPriceItem`; the route has no code path to `AddFixedPriceItem`/`ReviseFixedPriceItem`/`EndFixedPriceItem`. A test greps the file for those names (must be absent) and for any fetch other than the Trading endpoint.
* **At most once per request, no retry, no loop.** A timeout/network error is reported as such; the operator decides whether to call again.
* **Output:** Ack, error codes/short messages (sanitized), warnings, and the XML element path eBay complains about when given. Never echoes tokens, never echoes the raw request body.

## 4. Side effects (all of them, including the unavoidable ones)
1. **eBay API quota:** one Trading API call counts toward the application's daily call limit.
2. **OAuth refresh:** each authenticated eBay use performs a refresh-token exchange with eBay (an outbound call using the stored, decrypted refresh credential). Reading `src/lib/ebayPrincipalToken.js` shows no persistence of the resulting access token (no DB write on the success path); confirm when implementing. The credential is decrypted in memory only and never logged or returned.
3. **Reconnect-required status update:** if the refresh fails with `invalid_grant`, the existing code marks the connection **reconnect-required** — a Production DB write that blocks listing until the operator reconnects. Verify can therefore *cause* that state if the credential is already bad (it would otherwise surface at first list).
4. **Audit:** the route should write one log line (principal id, asset id, outcome code) — no payload, no secrets. No ledger row.
5. **UUID consumption: undocumented.** It is NOT documented whether a Verify call "uses up" the UUID (eBay's duplicate-UUID check is documented for items successfully *created*). A throwaway UUID is therefore used so the question cannot affect a real attempt.
6. **Photos:** Verify validates `PictureDetails` URLs. Real single-item publishing uploads photos through the eBay Media API first (`src/lib/ebayMediaApi.js`), which **creates hosted images in the seller's eBay account** — a marketplace write. The route must NOT upload. See §5.
7. No Production inventory/ledger/valuation/decision state is changed.

## 5. Limitations — what a Verify can and cannot prove
* **A photo-less Verify is diagnostic only.** eBay requires at least one picture (ErrorCode 21919136 was the real 2026-09 failure). A call with no `PictureDetails` is likely to fail on the photo rule. **eBay validation may terminate or report errors in its own order, so the *absence* of UUID/SKU errors in a photo-less response proves nothing about schema validity of those fields** — validation may never have reached them. Conversely, a UUID/SKU-specific *error* would be informative.
* **Only an `Ack` of `Success` or `Warning` on a complete packet validates the full payload,** and a complete packet requires hosted photo URLs (§4.6), i.e. one prior marketplace write (image upload). That upload needs its own explicit authorization.
* Verify checks the item *definition*; it does not prove the listing will not later be removed, nor that fees/policies behave the same, nor the duplicate-UUID behavior.
* The repo packet is known to be out of schema order in places and to omit `currencyID` on some price elements (GK-293); eBay accepts that today (ItemID 366665728633). Verify is therefore a placement check, not a certification of GK-293.

## 6. Tests required with the implementation (not written now)
Operator-only (403 for non-operator, 401 without token); client cannot supply a packet/call name; hard-coded call name; no `AddFixedPriceItem`/`Revise`/`End` reachable; no ledger write; throwaway correlation only; token never in response or logs; single call, no retry on error; disabled without the env flag; negative control: the guard removed → test fails.

## 7. Recommendation
Do **not** bundle this with B1. Either (a) accept the first supervised OPERATOR_MANUAL listing as the canary for `Item.UUID`/`SKU` placement (current plan), or (b) ship the route as its own small release, run it once with hosted photos, then proceed. (b) costs one extra release and one authorized image upload; (a) accepts the risk that eBay rejects the first real publish — which fails safely (`FAILED_DEFINITIVE`, no listing, retry possible after a fix).
