# ADR-IDENTIFIER-001 — Identifier Fabric (Law 4)

**Status:** Ratified (D4 Schema Ruling dispatch, 2026-09-02) — **schema concept PASS WITH AMENDMENTS.** Phase A (migration + isolated-schema proof) remains HOLD until a future dispatch explicitly opens it. No migration exists yet. No schema or code changed by this ADR — docs-only.

## Context

D4's constitutional objective (Foundation Law 4, `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`) is the correct vertical-neutral architecture for external identifiers associated with GrailKey's physical-asset system: `scheme + value + scope + authority + provenance`, against candidate scopes `PRODUCT_CLASS`, `MODEL`, `VARIANT`, `BATCH`, `LOT`, `SERIALIZED_INSTANCE`, `CERTIFIED_INSTANCE`.

A Phase 0 audit-only pass (2026-09-02, this same dispatch train) inventoried every identifier-shaped mechanism already in this codebase before any new design was proposed. This ADR ratifies that audit's findings with amendments from operator review — it does not re-run the audit. Findings are cited by file:line where load-bearing; see the audit's own transcript for the full evidentiary walk.

## Decision

### Ruling 1 (R1) — `entity_mint_basis`: SIBLING, mint-idempotency only

`entity_mint_basis` (`db/data0/0003_uuidv7_identity_and_mint_ledger.sql:237-276`) answers one question only: "have I already minted for this capture/candidate." Its `(basis_namespace, basis_key)` uniqueness tuple is governed by the binding **basis-key stability clause** (`0003:166-185`): `basis_key` may never be recomputed from ordinary mutable or externally-asserted content.

**Resolving the Phase 0 contradiction, explicitly, per this ruling:** the Phase 0 audit noted both that basis keys must not be built from mutable/external/asserted identity content, and that the same clause's own comment allows an external identifier to participate as basis-key *content* for certain basis types (e.g. `comic:gcd-issue`, keyed on GCD's own issue ID). **That allowance is rejected for D4's mint-basis namespaces.** Checked directly: the live, ratified mint-basis namespace in actual use today (`asset:capture-event`, `src/modules/assets/service.js:113`) is built from `principalId` / `correlationId` / `candidateDiscriminator` (`src/modules/capture/mapping.js`, `buildCaptureBasis`) — **no external identifier participates in it today.** D4 must not change that. No barcode, UPC, GTIN, serial number, cert number, marketplace ID, or other external identifier may ever be introduced into mint-basis construction, for any namespace this train touches.

**Binding reason:** a mis-scanned barcode must never be able to change which physical asset gets minted. Identifier evidence attaches to an asset after — or alongside — its existence; it never defines that asset's permanent mint identity. Extending `entity_mint_basis` with scheme/authority/scope columns, or admitting an external identifier into a basis key, would both violate the stability clause and conflate mint-idempotency with identity-evidence — a distinct, already-solved problem (Ruling 4, below).

Existing ratified mint namespaces (`asset:capture-event`, and any future first-party namespace with no external-identifier content) are preserved exactly, unchanged by this ADR.

### Ruling 2 (R2) — `collection_item_link`: SIBLING, routing only

No change from the Phase 0 audit's finding. `collection_item_link` (`db/data0/0007_capture_integration_linkage.sql:24-29`) is self-declared routing state — "which asset does a re-scan of this collection row attach to," never a claim about physical identity (`0007:14-19`). Not identity. Not touched by D4.

### Ruling 3 (R3) — `external_map`: DESIGN-SUPERSEDED

`external_map` (`db/data0/0001_generic_substrate.sql:147-160`) is not applied anywhere — zero live rows, its own FK target `catalog_entity` also never applied (`docs/DATABASE-MIGRATION-STATUS.md`, table-by-table status). `0001_generic_substrate.sql` is **not edited** — never-modify-historical-migrations holds. `external_map` is **not applied or resurrected** as originally drafted. Activating `catalog_entity` is **not** a side effect of this ADR or of any future D4 Phase A migration — D4's minimum live slice (Ruling 7) requires no catalog-side table to exist.

`external_map`'s conceptual role — catalog-side external-identifier crosswalk — is superseded by the future generic identifier domain (Ruling 6) plus a typed catalog-entity attachment table, **once catalog entities are actually activated by some future, separate dispatch.** That activation is out of scope here and not implied by this ruling.

### Ruling 4 (R4) — Model C ratified: three separate concepts

Three concepts are kept structurally distinct, never collapsed into one row or one table:

1. **Identifier existence** — a definition row: "this scheme+value+scope combination is a real-world identifier." Independent of any asset.
2. **Identifier-to-subject assertion** — an append-only record: "subject S is asserted to carry identifier I, per source, at time T, with resolution state R." Modeled directly on the already-live `asset_identity_assignment` shape (`db/data0/0004_data1_foundation.sql:139-148`; live per `docs/DATABASE-MIGRATION-STATUS.md`): never edited, a later row's `superseded_by` retires an earlier one.
3. **Resolved identity** — a materialized/derived view over non-superseded assertions, analogous to `current_owner`'s relationship to `ownership_event` — never an independent write path, not designed further here.

A wrong identifier attachment is corrected/superseded **at the assertion layer only.** The identifier's own intrinsic meaning (concept 1) is unaffected by a wrong assertion of it. `gkAssetId` never changes as a consequence of any identifier assertion, correct or wrong.

### Ruling 5 (R5) — scope belongs to the identifier definition, not the assertion

`scope` (`PRODUCT_CLASS` / `MODEL` / `VARIANT` / `BATCH` / `LOT` / `SERIALIZED_INSTANCE` / `CERTIFIED_INSTANCE`) is an intrinsic property of the identifier's own definition row, never of the assertion that links it to a subject. A GTIN remains a `PRODUCT_CLASS` identifier whether attached correctly, attached incorrectly, or not attached to anything at all. The assertion "physical asset X is linked to identifier Y" is a wholly separate record, carrying its own provenance, timing, source, and resolution state — it does not carry or redefine `scope`.

This corrects Phase 0's own conceptual model (§9 of the audit), which had not yet settled whether scope lived on the identifier or the attachment; this ADR settles it on the identifier.

### Ruling 6 (R6) — reject polymorphic `subject_type` + `subject_id`; typed FK tables instead

Phase 0's proposed conceptual model (§9 of the audit) used a single `AssetIdentifierAssertion` table with a `subject_type CHECK IN ('CATALOG_ENTITY','PHYSICAL_ASSET')` + `subject_id` polymorphic pair. **Rejected.** That shape sacrifices ordinary foreign-key integrity — `subject_id` cannot be declared `REFERENCES` anything, since its target table varies by row — and reproduces exactly the opaque-FK-less-UUID hazard already found live in this schema (`asset_identity_assignment.catalog_entity_id`, a bare UUID with no real FK because `catalog_entity` doesn't exist — `src/modules/assets/repository.js:14-19`'s own header names this directly). D4 must not manufacture a second instance of a hazard already on record as a sequencing risk (see A4/GK-176, below).

**Instead:** one generic identifier-definition domain (Ruling 4, concept 1 — vertical-neutral, no subject reference at all), plus **typed subject-attachment tables**, each with a real, declared FK to its real subject table. A physical-asset attachment table's subject column is `REFERENCES gk_asset(id)`, genuinely FK-enforced, from day one. A future catalog-side attachment table's subject column would be `REFERENCES catalog_entity(id)`, genuinely FK-enforced, built only once `catalog_entity` is real. No table in this design ever holds an unconstrained subject reference.

### Ruling 7 (R7) — minimum Phase A live slice

A future Phase A migration may propose **only**:

1. **Generic identifier definition** — the vertical-neutral `scheme + value(raw+normalized) + scope` domain (Ruling 4 concept 1, Ruling 5).
2. **Physical-asset identifier assertion → `gk_asset`** — the typed attachment table (Ruling 6) with a real FK to `gk_asset(id)`, carrying the provenance/conflict fields named in Ruling 8 below.

**Catalog-side compatibility may be designed** (documented, shaped, reasoned about) **but Phase A must not require `catalog_entity` to exist.** No catalog-side table is created by Phase A. This keeps D4's live slice independent of whenever a future, separate dispatch activates the catalog layer — the same "pulled-forward bounded slice, full architecture stays a later D-phase" discipline this train has already used for D3.1/D3.2/D3.3.

**Naming is not yet ratified.** Working names used for illustration in this ADR (`asset_identifier`, `asset_identifier_assertion`) follow this repo's existing convention (`gk_`-prefix reserved for actual physical-asset-graph row tables — `gk_asset`, `gk_principal`, `gk_organization`; relational/evidence tables use plain names — `entity_mint_basis`, `asset_identity_assignment`, `ownership_event`) but are illustrative only. Phase A must inspect repo conventions directly before drafting DDL and may rename.

### Ruling 8 (A2) — binding naming ruling: `issuing_authority` vs `resolution_authority`

Two names are mandatory and distinct wherever this concept appears in any future D4 table:

- **`issuing_authority`** — the external scheme governor/issuer (e.g. GS1 for GTIN, CGC for a CGC cert number, PSA for a PSA cert number).
- **`resolution_authority`** — GrailKey's own resolution-confidence state, reusing the existing vocabulary already live at `asset_identity_assignment.authority` (`NONE` / `CONTESTED` / `CORROBORATED`) rather than inventing a second scale.

**No new D4 table may introduce a bare `authority` column.** This is a direct, deliberate fix for the exact ambiguity Phase 0's own provenance-requirements section (§6) flagged as a risk — a single unqualified `authority` field would collide semantically between "who issued this identifier scheme" and "how resolved is this assertion," violating the standing "authority must be use-consistent" invariant (Dispatch 44).

### Ruling 9 (R8) — supersession direction

Stated exactly, for every future D4 assertion table: `old_assertion.superseded_by → new/correcting_assertion`. The old row's `superseded_by` column points forward to whichever row corrected or retracted it. Historical assertion rows are **never** deleted or rewritten away — identical in direction and mechanism to the already-live `asset_identity_assignment.superseded_by` (`repository.js:149`).

### Ruling 10 (R9) — unknown/conflict legality

An asset with **zero** identifier assertions is legal — mirrors the already-live `asset_identity_assignment.catalog_entity_id IS NULL` / `authority='NONE'` state. **Multiple non-superseded, conflicting assertions may coexist** for the same subject until reconciliation — reconciliation logic itself is not designed here, out of scope through Phase A. The mere presence of a conflict never alters `gkAssetId`.

### Ruling 11 (R10) — raw evidence preservation

Every future D4 assertion preserves the raw identifier observation verbatim, per this repo's own existing "never destructively normalize away a raw observation" standard (`alias` table header, `0001_generic_substrate.sql:162-206`). Normalization (for lookup/dedup) is additive — a separate, derived value alongside the raw one — never a replacement of it. The raw value must remain recoverable from any assertion row indefinitely.

### Marketplace boundary

eBay item IDs and equivalent marketplace identifiers remain **outside** the Identifier Fabric entirely. **FACT, Phase 0:** `ebayItemId` today lives only in `api/list-ebay.js` and `src/App.jsx`; zero references anywhere in `src/modules/`. They identify a `ListingProjection`/`MarketplaceListing`/market/transaction relationship (D5/D6 territory), never the physical asset or catalog class, per the constitutional rule that a marketplace's convenient unique ID must never become physical-asset identity. They are not added to `AssetIdentifier` for convenience, ever.

### Greenfield fact (A3)

Recorded explicitly: `certNumber` (`api/grade.js`, `api/cgc-lookup.js`, `api/enrich.js`, `src/lib/manualCorrection.js`) is transient today — consumed per-scan, never persisted. UPC/barcode (`api/enrich.js:602`, `lookupComicVineByUPC`) is transient today — resolved to a catalog-identity guess, then discarded, never persisted. `ebayItemId` is transient/client-only today (§ marketplace boundary above). **None of the three is persisted into the durable asset kernel. None reaches `src/modules/assets/` as durable identifier state.**

**Implication:** D4 therefore has **zero** historical identifier rows to migrate, classify, or backfill. Phase A carries no legacy identifier-data migration and no manufactured-provenance requirement. No identifier history is to be invented or backfilled to make Phase A's proof set look populated — an assertion table's real emptiness at first apply is the correct, honest starting state.

## Catalog-side vs physical-asset-side boundary (restated)

Unchanged from Phase 0: `PRODUCT_CLASS`/`MODEL`/`VARIANT`/`BATCH` scope primarily to the catalog side (once it exists); `LOT`/`SERIALIZED_INSTANCE`/`CERTIFIED_INSTANCE` scope to the physical-asset side. Ruling 6 replaces the *mechanism* (typed FK tables, not a polymorphic column) without changing this scope-ownership assignment.

## What this ADR does not do

Does not write migration `0013`. Does not implement D4. Does not touch `db/data0/0001_generic_substrate.sql` or any other historical migration file. Does not activate `catalog_entity`. Does not alter `src/modules/assets/` or any other source file. Does not fix the two incidental findings named below (tracked as tickets, not resolved here).

## Related documents

- Foundation Law 4 (Identifier Fabric) — `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`
- Live-vs-design contradiction on `entity_mint_basis.entity_id` — `docs/DATABASE-MIGRATION-STATUS.md`
- Basis-key stability clause, mint-basis transactional contract — `db/data0/0003_uuidv7_identity_and_mint_ledger.sql`
- `asset_identity_assignment` precedent — `db/data0/0004_data1_foundation.sql`, `src/modules/assets/repository.js`
- Incidental findings — `docs/TICKET-REGISTRY.md`, GK-175, GK-176
- Cross-workstream status — `docs/MASTER-BOARD.md`, "D4 Phase 0"
