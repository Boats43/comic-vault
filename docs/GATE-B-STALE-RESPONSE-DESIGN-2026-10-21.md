# Gate B: stale-response protection, existing authority, and the smallest complete design (2026-10-21)

Status: DESIGN ONLY. Nothing in this file is implemented. Release HOLD. Branch `wip/gate-b-pricing-2026-10-21`.

The referenced `DESIGN-identity-version-pricing-invalidation.md` does not exist: not in any of the 29 worktrees, not in git history on any ref (searched by name and by `git log --all --name-only`). There is no prior design to reuse.

## 1. What exists today (answers to A1.1-A1.6)

| Question | Finding (file) |
|---|---|
| Is `evidenceVersion` ordered or content-derived? | **Content-derived.** `computeEvidenceVersion` = first 32 hex of SHA-256 over the sorted media content hashes of the asset (`src/lib/authorityReceipt.js` `computeEvidenceVersion`; resolved in `api/enrich.js` `resolveReceiptBinding` from `getAssetMediaContentHashes`). It identifies the photo set. It is not a revision, is not monotonic, and says nothing about pricing. It is null whenever the row has no linked asset (Production's kernel tables are empty). |
| Any persisted server-owned revision? | **No.** `collection_item` is `(id, principal_id, asset_category, attributes JSONB, created_at, updated_at)` (`db/data0/0026_collection_item.sql`). No version column, no CAS. `updated_at = now()` is bumped by EVERY write including photo adds, so it orders writes, not pricing generations. Writes are last-writer-wins full replace of ordinary attributes (`repository.js` upsert/update). |
| Can the existing receipt + write path enforce freshness unchanged? | **Not completely.** The receipt carries a signed server `issuedAt`, and the server already persists it as `attributes.authorityProvenance.issuedAt` when a receipt verifies (`governIncomingAuthority`). That is the only server-owned ordered quantity. But (a) it is wall-clock, so ties and skew across instances are possible; (b) it is the time the response was finalized, so overlapping passes order by finish time, not by which evidence is newer; (c) the receipt signs ONLY `EXECUTION_AUTHORITY_KEYS` (decision, pricingSource, contract, refusedToPrice, ...). `price`, `priceLow`, `priceHigh`, `priceBands`, `rawComps`, `priceDerivationTrace`, `authoritativeRecommendation` are NOT signed and NOT receipt-governed: they are ordinary client attributes. So a stale client can overwrite the whole pricing bundle while the server keeps the newer execution keys, producing a mixed-generation row, and a freshness check on the receipt cannot see it. |
| Does a smaller existing-state check stop the documented replay? | **No.** Rejecting a receipt with `issuedAt` older than the stored one would only protect the execution keys. The replayed bundle would still be written as ordinary attributes. Making the whole write fail would also reject legitimate stale-local-copy writes (adding a photo from an older local copy). |
| Identity vs grade basis vs market evidence vs pricing generation | Four different things, none unified: identity (`identityAuthority`, `identityRevision` counter on the client row, receipt `identity` block); grade basis (`gradeAuthority`/`operatorGrade*`, server-protected keys); market evidence (`rawComps`, `soldCompDiagnostics`, `rawComps.evidenceObservedAt` set by the client-visible response, content hashes for media); pricing generation: **does not exist as a concept anywhere**. |
| Client timestamps / `rawComps.evidenceObservedAt` | Rejected as authority: client-visible and unsigned. |

Conclusion: **a pricing-generation protocol is missing**. A client-only guard would simulate certification and is not offered. This also touches a trust boundary (pricing fields are not currently receipt-governed), so per the amendment this pass stops at design.

## 2. Smallest complete design (needs authorization; no migration)

**Pricing generation** = a server-owned integer stored in the row's existing JSONB at `attributes.authorityProvenance.pricingGeneration`, incremented only by the server inside the same single SQL statement that writes the bundle (so it is atomic with the write, needs no schema change, and a client can never set it: `authorityProvenance` is already deleted from incoming attributes in `governIncomingAuthority`).

1. **Enrich** (owned-row flows, which already read the durable row): include `baseGeneration` (the row's current `pricingGeneration`, 0 when absent) and `pricingDigest` (SHA-256 of the canonical pricing fields it returned: price, priceLow, priceHigh, priceBands, rawComps.count/average, pricingSource, priceDerivationTrace.finalPrice) inside the signed receipt payload. This is a receipt-format addition (new fields under `binding` / `values`), signed with the existing key.
2. **Write path** (`governIncomingAuthority` + repository SQL): for a write whose receipt verifies, treat the pricing fields as receipt-governed. Apply them only if `receipt.baseGeneration === row.pricingGeneration` AND the digest of the incoming pricing fields equals `receipt.pricingDigest`; then set `pricingGeneration = pricingGeneration + 1` in the same statement. Otherwise discard the incoming pricing fields and execution keys (the row's values stand, exactly as unverified writes behave today) and return `{ stale: true, pricingGeneration }`.
3. **Client**: on `stale`, drop the response and refetch the row (no client-side guessing about ordering).
4. **Effects**: replay of an old response after a newer refusal or a newer qualified estimate fails the compare (its `baseGeneration` is behind); two overlapping refreshes both start from generation g and exactly one wins, deterministically, whatever the arrival order; null refusal fields stay null because a rejected write changes nothing; a legitimate stale-local-copy write that carries no pricing change (photo add) is unaffected because it carries no new receipt/pricing bundle.
5. **Operator-entered list price** stays a separate explicit path (unsigned, labelled operator-entered, never receipt-governed), unchanged.

Legacy rows and in-flight receipts: a row without `pricingGeneration` is generation 0; a receipt without `baseGeneration` is treated as unverified for pricing fields (fail closed) after a one-release grace decision the owner must make.

## 3. Decisions required before implementation
- Authorize making `price*`, `priceBands`, `rawComps`, `priceDerivationTrace`, `authoritativeRecommendation` receipt-governed (a trust-boundary expansion at `/api/collection`).
- Authorize the receipt format addition (`baseGeneration`, `pricingDigest`).
- Choose: JSONB counter (above, no migration) vs a real `pricing_generation` column (cleaner, needs a migration, out of scope here).
- Grace behavior for receipts and rows that predate the protocol.
- Whether `historicalPricingEvidence` should also record generation numbers (it currently has none).

## 4. What this pass DID change (within the existing contract)
Client merge sites that could resurrect an obsolete price when a newer variant-evidence refusal arrives (duplicate-confirm x3, re-identify, duplicate-sync x2) now treat that refusal as invalidating the old price, and the duplicate-sync sites now merge the pricing bundle as one generation. This fixes in-response resurrection only. It does NOT fix ordering: see `tests/gate-b-stale-price-merge-sites.test.js` section 4, which prints the order-dependence (old response after a newer refusal restores $4.18; arrival order refusal->old yields $4.18, old->refusal yields null).

## 5. Auditability of pricing transitions (A5)
No durable record of a Collection pricing transition exists. `operator_correction_event` covers surfaces GRADE, GRADING_FORMAT, IDENTITY, CONDITION only (`db/data0/0035_learning_spine.sql`), not price. `valuation_event` is written only for asset-linked rows, only when `D5D_RUNTIME_ENABLED` in Development (`api/enrich.js`, `attemptOutcome1`), and Production's kernel tables are empty. The KV scan log records enrich RESPONSES (outcome.price, pricingSource) with a 90-day TTL, best effort, not Collection writes. The only trace of a superseded price is the in-row `historicalPricingEvidence` (single level, cleared by the next good result by design and asserted by `gate-b-pricing-bundle-merge`, and replaceable by any full-replace write). **Auditability gap: a Production price change on a Collection row leaves no durable, queryable history.** Not fixed (no new table or migration authorized).

## Appendix: the seven `priceBands.test.js` failures (A3)
All seven fail identically on pristine `ba19141` (the test was run from a `git archive` of that commit); six with the same message as now. Detail and classification are in the report that accompanies this commit; summary: 1-2 and 7 assert filtering that `buildVerifiedSoldPool` deliberately no longer does (Ship 1.6, filtering moved upstream to `verifySoldComps`); 3, 5 and 6 build sold/PC fixtures without the `soldVerifyResult` the tier engine now requires and expect retired source names; 4 expects the retired source name `verified_active` AND its message changed from `tier3_active_discounted` to `tier4_pc_estimate` because of the Gate B rule that a title-less row is not applicable evidence for a confirmed ratio variant.
