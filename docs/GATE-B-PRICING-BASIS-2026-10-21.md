# Gate B: listing-time pricing-bundle coherence and the immutable `pricingBasis` snapshot (2026-10-21)

Local only. Release HOLD. No pricing-generation protocol, migration, new table or receipt-format change.

## 1. What was added
- `src/lib/pricingBundleCoherence.js`: pure checks that reject a *demonstrated* inconsistency (refused/no-price state, receipt pool count or source disagreeing with the durable row, `comps` vs `rawComps` generations, bands larger than the pool, price vs trace/band, confirmed ratio variant without proof or with non-variant rows or a non-CONFIRMED applicability, signed year/issue vs durable, stored records not reproducing their own aggregates). A check whose input is absent is `NOT_EVALUATED`, never PASS.
- `src/lib/pricingBasisSnapshot.js`: builds a bounded `pricingBasis` object stored INSIDE the existing append-only `operator_authority_event.evidence` JSONB of the AUTHORIZED row.
- `api/list-ebay.js`: the check runs after every pre-existing local gate (authority, acknowledgement, price binding, inventory, duplicate and attempt guards), before the authority row is written and before any eBay call. A violation returns 409 `PRICING_BUNDLE_INCOHERENT` with zero provider calls.
- `src/modules/assets/service.js` `authorizeOperatorManualListing`: independently refuses an incoherent basis (defense in depth) and completes the snapshot with the approved price and the engine prediction, which it reads from the LIST action, decision and valuations.

## 2. This is a PARTIAL control (A2)
Only the receipt's pool COUNT and `pricingSource` are server-signed facts about the pricing pool. The listings, prices, average, bands and trace are ordinary client-writable attributes. A bundle whose records were replaced by different records with the SAME count, the SAME source label, and consistent aggregates, titles and bands is indistinguishable from the genuine one. This is proven by `tests/gate-b-pricing-coherence-pure.test.js` section 5 and `tests/gate-b-pricing-basis-live.test.js` T5 (the substituted bundle is authorized; its stored snapshot says `protection: PARTIAL` and that the pricing fields are unsigned). Closing it needs the deferred Gate D pricing-generation protocol (signed pricing digest). Never describe this control as fully protected.

## 3. `pricingBasis` contents
Schema `pricing-basis-v1`: provenance (server-held catalogue, `pricingFieldsSigned:false`), confirmed identity and identity authority, market (pricingSource, verified/raw sold counts, variantApplicability), pool (records with titles/prices/urls, recordsSource, counts, aggregate, population definitions, truncation, the other generation if the aggregate and the pool differ), bands with variant evidence, derivation final price, receipt reference (verified, issuedAt, body SHA-256, signed pool count, binding state, bound evidence version), photo evidence version, coherence verdict with limitation, `reconstructability` (FULL / PARTIAL / NOT_RECONSTRUCTABLE with reasons, missing items and explanations), `approved` (the operator LIST price, labelled an operator decision), `enginePrediction` (only when the decision is anchored to a SERVER_DERIVED valuation) and `predictionErrorScoring` (MEASURABLE only when a qualified prediction exists, otherwise NOT_MEASURABLE). Bounded to 16 KiB and 30 records; an over-size basis degrades to a minimal honest stub.

## 4. Historical OML row (recorded 2026-10-16; read-only Production read 2026-10-21)
- Six listings contributed to the aggregate (`comps.count` 6, average $17.7617). Five were included in the display sample (`recentSales`, first five in eBay best-match order). The complete sixth record is NOT stored; only its price is derivable (about $16.61) and it is never reconstructed.
- The 16-listing `rawComps`, `priceBands` ($4.18) and derivation trace describe ANOTHER generation (16 regular covers).
- $15.10 is the historical stored contract price (6-pool average x 0.85). It is not a certified listing-price recommendation.
- Reconstructability of that row: NOT_RECONSTRUCTABLE (incoherent). Authorization would be refused.

## 5. Historical sensitivity (A4, not authoritative current valuations; not re-run, no provider search)
Stored historical estimate $15.10. Excluding the 2016-titled listing: about $14.72. Excluding the "Teaser Variant" listing: about $15.57. Excluding both: about $15.21. The applicability of those two listings was not established.

## 6. Execution-time identity locking requirement (A1, NOT done here)
The operator confirms title, issue, year, publisher and variant in ONE validated manual-correction request (existing `manualAuthority` contract); grade is set separately with `operatorGradeAction: SET`. A UI success is not proof. Gate B requires a fresh authenticated SERVER READBACK showing `identityAuthority.{title,issue,year,publisher,variant} = OPERATOR_CONFIRMED`, a governing operator grade of 9.2, and no `identityAuthorityPersistFailed` condition (enrich reports a failed durable write-back as non-fatal and leaves the lock transient).
