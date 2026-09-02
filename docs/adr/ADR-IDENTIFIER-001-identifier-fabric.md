# ADR-IDENTIFIER-001 — Identifier Fabric (Law 4)

**Status:** Ratified (D4 Schema Ruling dispatch + A6/A7 refinement pass, 2026-09-02) — **schema concept PASS WITH AMENDMENTS, including the canonical-identifier, provenance, and concurrency rulings below.** Phase A (migration + isolated-schema proof) remains HOLD until a future dispatch explicitly opens it. No migration exists yet. No schema or code changed by this ADR — docs-only.

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
2. **Identifier-to-subject assertion** — an append-only record: "subject S is asserted to carry identifier I, per source, at time T, with resolution state R." Modeled directly on the already-live `asset_identity_assignment` shape (`db/data0/0004_data1_foundation.sql:139-148`; live per `docs/DATABASE-MIGRATION-STATUS.md`): never edited, a later row's `superseded_by` retires an earlier one. **Refined by Ruling 15 below:** this table's `identifier_id` is `NOT NULL` by definition — a row here means a known identifier is asserted of a known subject. An unresolved/malformed raw observation is a structurally different concept (Ruling 15) and lives in its own table, never blurred into this one.
3. **Resolved identity** — a materialized/derived view over non-superseded assertions, analogous to `current_owner`'s relationship to `ownership_event` — never an independent write path, not designed further here.

A wrong identifier attachment is corrected/superseded **at the assertion layer only.** The identifier's own intrinsic meaning (concept 1) is unaffected by a wrong assertion of it. `gkAssetId` never changes as a consequence of any identifier assertion, correct or wrong.

### Ruling 5 (R5) — scope belongs to the identifier definition, not the assertion

`scope` (`PRODUCT_CLASS` / `MODEL` / `VARIANT` / `BATCH` / `LOT` / `SERIALIZED_INSTANCE` / `CERTIFIED_INSTANCE`) is an intrinsic property of the identifier's own definition row, never of the assertion that links it to a subject. A GTIN remains a `PRODUCT_CLASS` identifier whether attached correctly, attached incorrectly, or not attached to anything at all. The assertion "physical asset X is linked to identifier Y" is a wholly separate record, carrying its own provenance, timing, source, and resolution state — it does not carry or redefine `scope`.

This corrects Phase 0's own conceptual model (§9 of the audit), which had not yet settled whether scope lived on the identifier or the attachment; this ADR settles it on the identifier.

### Ruling 6 (R6) — reject polymorphic `subject_type` + `subject_id`; typed FK tables instead

Phase 0's proposed conceptual model (§9 of the audit) used a single `AssetIdentifierAssertion` table with a `subject_type CHECK IN ('CATALOG_ENTITY','PHYSICAL_ASSET')` + `subject_id` polymorphic pair. **Rejected.** That shape sacrifices ordinary foreign-key integrity — `subject_id` cannot be declared `REFERENCES` anything, since its target table varies by row — and reproduces exactly the opaque-FK-less-UUID hazard already found live in this schema (`asset_identity_assignment.catalog_entity_id`, a bare UUID with no real FK because `catalog_entity` doesn't exist — `src/modules/assets/repository.js:14-19`'s own header names this directly). D4 must not manufacture a second instance of a hazard already on record as a sequencing risk (see A4/GK-176, below).

**Instead:** one generic identifier-definition domain (Ruling 4, concept 1 — vertical-neutral, no subject reference at all), plus **typed subject-attachment tables**, each with a real, declared FK to its real subject table. A physical-asset attachment table's subject column is `REFERENCES gk_asset(id)`, genuinely FK-enforced, from day one. A future catalog-side attachment table's subject column would be `REFERENCES catalog_entity(id)`, genuinely FK-enforced, built only once `catalog_entity` is real. No table in this design ever holds an unconstrained subject reference.

### Ruling 7 (R7) — minimum Phase A live slice

**Updated by the A6/A7 refinement pass below — four tables, not two.** A future Phase A migration may propose **only**:

1. `asset_identifier` — the generic identifier-definition domain (Ruling 12/14).
2. `asset_raw_observation` — generic per-asset raw evidence, resolved or not (Ruling 15).
3. `asset_identifier_assertion` — the typed physical-asset attachment table, `identifier_id` NOT NULL, real FK to `gk_asset(id)` (Ruling 15, correcting this Ruling's earlier 2-table sketch).
4. `asset_identifier_assertion_evidence` — the typed, permanent evidence-linking relation (Ruling 16).

**Catalog-side compatibility may be designed** (documented, shaped, reasoned about) **but Phase A must not require `catalog_entity` to exist.** No catalog-side table is created by Phase A. This keeps D4's live slice independent of whenever a future, separate dispatch activates the catalog layer — the same "pulled-forward bounded slice, full architecture stays a later D-phase" discipline this train has already used for D3.1/D3.2/D3.3.

**Naming is not yet ratified.** Working names used for illustration in this ADR (`asset_identifier`, `asset_raw_observation`, `asset_identifier_assertion`, `asset_identifier_assertion_evidence`) follow this repo's existing convention (`gk_`-prefix reserved for actual physical-asset-graph row tables — `gk_asset`, `gk_principal`, `gk_organization`; relational/evidence tables use plain names — `entity_mint_basis`, `asset_identity_assignment`, `ownership_event`) but are illustrative only. Phase A must inspect repo conventions directly before drafting DDL and may rename.

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

## A6/A7 refinement pass (2026-09-02) — canonical identifier model, provenance, concurrency

Ratified after the schema-concept pass above surfaced open questions requiring evidence, not preference, before Phase A could be trusted. Every ruling below is backed by a real, isolated scratch-schema proof against this project's live PostgreSQL 18.6 instance (never `data1_dev`) — proof scripts live at `C:\grailkey-data\data-1\` and are not committed to this repo, the same convention as `gk163-fingerprint-proof.mjs`/`gk166-real-capture-proof.mjs`. Proof counts: `d4-a6-a7-uniqueness-and-cycle-proof.mjs` 21/21, `d4-a6-a7-provenance-proof.mjs` 17/17, `d4-a7-concurrency-proof.mjs` (3 real concurrent scenarios, each with a confirmed expected outcome), `d4-a7-deadlock-forced-proof.mjs` (1 forced scenario, confirmed expected outcome). These are kept as distinct figures deliberately — a deterministic assertion count and a concurrent-scenario-outcome count are not the same kind of measurement, and are never collapsed into one artificial combined total.

### Ruling 12 (A6.1) — canonical identifier uniqueness

`UNIQUE (scheme, issuing_authority, normalized_value)`. `scope` is excluded from the uniqueness key — it remains, per Ruling 5, an intrinsic property of the identifier definition, but `scheme` alone determines an identifier's semantic scope, so `scope` cannot independently disambiguate two otherwise-identical `(scheme, issuing_authority, normalized_value)` tuples. No per-scheme permanent table is created.

**Proven failure case (the required test):** manufacturer serial `"12345"` issued independently by two different manufacturers (`issuing_authority='rolex'` vs `'omega'`) inserts as two distinct canonical rows — proven directly; a true duplicate (same manufacturer, same serial) is correctly rejected. For GTIN/ISBN, `issuing_authority` is held constant at the governing-body level (`'GS1'`, `'ISBN-agency'`) rather than varying per allocating sub-organization, so these globally-unique schemes still collapse correctly under the same key — also proven directly (a second differently-encoded observation of the same real product/book correctly triggers the uniqueness constraint rather than minting a second row).

### Ruling 13 (A6.1a) — `issuing_authority` is `NOT NULL`; sentinel `UNKNOWN`, never `NULL`

**Verified live, not assumed:** on this project's real PG18.6 instance, plain `UNIQUE(scheme, issuing_authority, normalized_value)` with `issuing_authority NULL` allows a second, otherwise-identical row to insert successfully — standard SQL NULL-distinct behavior, confirmed real on this exact instance, not merely textbook knowledge. `UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+) is available and does close it.

**Ruled: `issuing_authority NOT NULL`, reserved sentinel `'UNKNOWN'`** — not `NULLS NOT DISTINCT`. This is portable, keeps application code free of `IS NULL` special-casing, and — the decisive reason — makes "issuer resolved later" a safe, non-destructive operation rather than a silent key mutation.

**`UNKNOWN` → known issuer must never mutate the canonical definition row's key in place.** Doing so risks colliding with an already-existing, independently-observed row under the resolved key, and would violate this same table's own immutability discipline. **Definition-level reconciliation for this case is explicitly DEFERRED FROM D4 MINIMUM PHASE A.** No such mechanism exists in the ratified minimum slice. If built later, it may reuse only the *architectural pattern* already proven elsewhere in this codebase (an explicit append-only supersession edge) — it must never depend on `entity_mint_basis`, `basis_supersession`, or any catalog-substrate table. Identifier Fabric stands structurally independent of the mint ledger and the catalog substrate, by design, in both directions.

### Ruling 14 (A6.1b) — `normalized_value` is semantic/cross-encoding canonicalization

Ratified, not left implicit: `normalized_value` performs semantic/cross-encoding canonicalization where the scheme supports it — not merely punctuation/formatting normalization.

- **GTIN-12 / GTIN-13 / GTIN-14** → canonical GTIN-14 representation (zero-padded). Proven: three literal encodings of the same real product all normalize to one identical value.
- **ISBN-10** → canonical ISBN-13 representation, via the real, standard check-digit algorithm (verified computationally against an independently-supplied ISBN-13, exact match — not hardcoded). ISBN-13 is the canonical target rather than ISBN-10 specifically because 979-prefixed ISBN-13s have no ISBN-10 form at all — ISBN-13 is the strict superset.

**Where this logic lives:** scheme-specific normalizer functions, in a registry keyed by `scheme` — never in the database, and never as a permanent vertical-specific field in `src/modules/assets/`. This is the same adapter-boundary discipline this repo already enforces for comic-specific logic (ComicAdapter vs. the generic kernel).

Raw observed representations remain durable, independently of canonical normalization — see Ruling 15.

### Ruling 15 (A6.2) — `asset_raw_observation` vs `asset_identifier_assertion`, corrected

**Corrects this ADR's earlier illustrative shape**, which had `identifier_id` nullable on the assertion table. Rejected: that blurs two structurally different concepts to save a table.

- **`asset_raw_observation`** means exactly: *"this raw identifier-shaped value was observed on this physical asset."* It carries no `identifier_id` at all — resolution success or failure is not a distinction this table needs to make. A malformed or unresolved raw observation is fully legal here, permanently, without ever manufacturing a canonical `asset_identifier` row to satisfy a foreign key that shouldn't exist for it.
- **`asset_identifier_assertion`** means exactly: *"this canonical identifier is asserted of this physical asset."* Its `identifier_id` is `NOT NULL`, DB-enforced, by definition — proven directly (an attempt to insert an assertion with `identifier_id = NULL` is rejected outright).

Unknown/no-identifier physical-asset state remains fully legal either way — an asset simply has zero rows in one or both tables.

### Ruling 16 (A6.2a/A6.2b) — provenance cardinality: many→one required, typed evidence relation

**Repository evidence inspected, not preference:**
- **Many independent observations → one assertion is required.** `src/lib/identityReconciler.js`'s entire architecture, and `0001_generic_substrate.sql`'s own `claim` table (`type IN ('corroboration','conflict','refinement')`), are built around exactly this pattern — multiple sources feeding one reconciled verdict. `CORROBORATED`, in this codebase's already-established vocabulary, means multiple independent sources agreed — a single nullable `raw_observation_id` FK cannot name more than one supporting source and is therefore rejected as insufficient provenance for that claim.
- **One observation → many assertions: checked directly, not reachable in the current repository.** Every Vision-output JSON shape in `api/grade.js` (`JSON_SHAPE`, `GRADE_JSON_SHAPE`, `BOOK_JSON_SHAPE`) carries at most one identifier-shaped field per call (`certNumber` for comics, `isbn` for books — never both, never alongside a barcode field). `App.jsx:1221`'s barcode scanner is explicitly *"completely separate from the Vision camera"*; `handleBarcodeSubmit` (`App.jsx:11628`) *"skip[s] Vision entirely."* **Not claimed as currently reachable.** The already-required many-to-many relation permits this direction for free, at zero additional schema cost — no separate mechanism was built or is needed to allow it.

**Ratified shape:**
```
asset_identifier_assertion_evidence
  assertion_id    UUID NOT NULL REFERENCES asset_identifier_assertion(id)
  observation_id  UUID NOT NULL REFERENCES asset_raw_observation(id)
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (assertion_id, observation_id)
```
Real FK to the assertion, real FK to the observation. The primary key doubles as the duplicate-link guard. Rows are permanent evidence — `UPDATE` and `DELETE` are both rejected unconditionally, proven directly (not merely conventional, matching `comp_snapshot`'s own precedent for real DB-enforced immutability over app-discipline-only). Superseding the assertion the link belongs to never alters or deletes the link or the underlying observation — proven directly.

### Ruling 17 (A7, restated accurately) — controlled lifecycle mutability, not absolute append-only

`asset_identifier_assertion` is **controlled lifecycle mutability, not absolute append-only storage.** Stated exactly:

- Evidence fields (`identifier_id`, `asset_id`, `evidence_source`, `asserting_principal_id`, `recorded_at`, `occurred_at`, `resolution_authority`) are immutable after insert.
- `DELETE` is rejected, unconditionally, always.
- `superseded_by` is the sole permitted lifecycle mutation: `NULL → an existing, currently-live correcting/replacing assertion`.
- Direction: `old_assertion.superseded_by → new/correcting_assertion`.
- Multiple live, conflicting assertions remain legal until explicitly reconciled — reconciliation logic itself is not designed here.
- Correction never changes `gkAssetId`.

### Ruling 18 (A7.3) — corrected graph structure: forest of in-trees, not chains

**Do not persist "forest of simple chains"** — that phrasing implies in-degree ≤1, which is false and was never the intended design. **Correct characterization: a forest of in-trees rooted at live assertions** — out-degree ≤1 (a row is superseded at most once, ever), in-degree unbounded, and convergent supersession is explicitly legal and intentional: multiple bad assertions may correct into the same live target (proven directly: three independently-inserted rows all superseded into one target, which remained live throughout, confirmed by direct query — in-degree 3, out-degree 0).

### Ruling 19 (A7.4) — concurrency-safe acyclicity, proven under real concurrency

**Proof sequence, all real, against two genuine PostgreSQL connections (`GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED`), session isolation level confirmed `read committed` (queried, not assumed):**

**No-lock target-live trigger (the design as first proposed):** `T1: A→B` and `T2: B→A` fired concurrently, both before either committed. **Both UPDATEs succeeded. Both transactions committed.** Actual resulting rows: `A→B`, `B→A` — a real cycle, formed under genuine concurrency. **Serial target-live checking alone was not concurrency-safe** — this is the reason a plain unlocked read in the trigger is insufficient.

**Row-lock fix:** target validation acquires a row lock (`SELECT ... FOR UPDATE` on the target row) during the superseding `UPDATE`'s trigger execution, held through transaction completion — not a plain read. Under the identical repeated race, both opposing edges could no longer commit together (one succeeded, the other did not complete within the race window). A control confirmed a normal, non-racing sequential correction still succeeds fine under the fixed trigger.

**Forced lock-order proof:** the exact adversarial schedule named at ruling time — T1 already holding its own row while requesting the target, T2 already holding its own row while requesting the target, simultaneously — was reproduced directly via a deliberate in-trigger delay, rather than left as a theoretical possibility. Result: real PostgreSQL `SQLSTATE 40P01`, `"deadlock detected"`. One transaction aborted; one committed. No cycle formed. Correctness is preserved even under this adversarial competing-lock schedule, not merely under the easier, non-adversarial one.

**Ratified reasoning, persisted verbatim:**

> Every assertion can acquire at most one outgoing supersession edge, ever. An edge may only target an assertion whose own outgoing supersession edge is still absent (`superseded_by IS NULL`), checked under a row lock acquired by the supersession trigger and held through transaction completion—not by a plain unlocked read. Multiple superseded assertions may converge on the same live target; in-degree is intentionally unbounded. Closing a directed cycle would require the final edge to target a node that already acquired an outgoing edge earlier in that cycle. The database's concurrency-safe target-live enforcement—proven under real two-connection concurrency, including a case where PostgreSQL's deadlock detector aborts one competing transaction—prevents all edges required to complete such a cycle from committing together. Therefore the supersession graph is acyclic without UUID ordering, timestamp comparison, or a read-time cycle walk, and its components are in-trees rooted at live assertions.

No UUID ordering is used anywhere in this design. No `occurred_at <= recorded_at` constraint exists or is added — D3.2's independent event/ingestion time model is untouched.

### Ruling 20 (application requirement, Phase B-scoped) — `40P01` is retryable

Future application code implementing identifier supersession must treat PostgreSQL `SQLSTATE 40P01` (`deadlock detected`) as a **retryable transaction failure**, and must tolerate ordinary blocking while another transaction holds the necessary row lock as an expected operational outcome, not an error condition. This is a **Phase B implementation requirement**, named now so it is not rediscovered under time pressure later — it is not a defect in the ruling above, and nothing here implements it.

## Catalog-side vs physical-asset-side boundary (restated)

Unchanged from Phase 0: `PRODUCT_CLASS`/`MODEL`/`VARIANT`/`BATCH` scope primarily to the catalog side (once it exists); `LOT`/`SERIALIZED_INSTANCE`/`CERTIFIED_INSTANCE` scope to the physical-asset side. Ruling 6 replaces the *mechanism* (typed FK tables, not a polymorphic column) without changing this scope-ownership assignment.

## What this ADR does not do

Does not write migration `0013`. Does not apply any D4 schema. Does not write to `data1_dev`. Does not wire any application code. Does not implement a scheme-specific normalizer registry (Ruling 14 names where it belongs; none is built). Does not build definition-level `UNKNOWN`→known issuer reconciliation (Ruling 13, explicitly deferred). Does not activate `catalog_entity` or any catalog-substrate table. Does not touch `db/data0/0001_generic_substrate.sql` or any other historical migration file. Does not alter `src/modules/assets/` or any other source file. Does not start D5, D6, or D8. Does not close Milestone Ten — it remains OPEN / PHYSICAL-CROSS-DEVICE-PENDING, untouched and unaffected by any ruling in this document. Does not fix the three incidental findings named below (tracked as tickets, not resolved here).

## Related documents

- Foundation Law 4 (Identifier Fabric) — `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`
- Live-vs-design contradiction on `entity_mint_basis.entity_id` — `docs/DATABASE-MIGRATION-STATUS.md`
- Pooled-connection session-state hazard (operational note) — `docs/DATABASE-MIGRATION-STATUS.md`
- Basis-key stability clause, mint-basis transactional contract — `db/data0/0003_uuidv7_identity_and_mint_ledger.sql`
- `asset_identity_assignment` precedent — `db/data0/0004_data1_foundation.sql`, `src/modules/assets/repository.js`
- Incidental findings — `docs/TICKET-REGISTRY.md`, GK-175, GK-176, GK-177
- Cross-workstream status — `docs/MASTER-BOARD.md`, "D4 Phase 0"
