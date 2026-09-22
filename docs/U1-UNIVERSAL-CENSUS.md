# U1 — Universalization Census

**U2 ratification applied (2026-09-21).** This census's findings (principally C1/C3/C6/C9/C10/C11/C13 and the Review Packet addendum's items 1, 2, 3, 8, 9, 10) were ratified into the repo's canonical governance docs by the "U2 — Ratify Universal Kernel Boundary" dispatch: `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`'s new "Universal Kernel Boundary (ratified, U2, 2026-09-21)" section and its Foundation Law 6 evidence correction, and `docs/adr/ADR-ADAPTER-001-adapter-contract.md`'s new "Amendment A3 — U2 Ratification" (Rulings 38-41). This file itself is the accepted factual record those ratifications cite — it is not rewritten by U2, only referenced. GK-241 (the buyer-service `marketStanding` vocabulary gap found while re-verifying this census) is banked in `docs/TICKET-REGISTRY.md`.

**Type:** TRACE / ARCHITECTURE CENSUS ONLY. No implementation, no migration, no pricing change. Written 2026-09-21 against `main` HEAD `836f26485fd1011cac0e9c4efb9cb8169f6ed3a0` (GK-238, SHIPPED). This document is uncommitted and held for review — see `git status --short docs/U1-UNIVERSAL-CENSUS.md`.

**Method note:** conclusions are derived from `db/data0/*.sql` migrations and repository/service code, per this dispatch's own instruction (GK-235: Production DB target identity is unresolved). Any finding that would require a live query is explicitly labeled `PROVISIONAL — PRODUCTION TARGET UNVERIFIED`; no secrets were decrypted, no live DB write occurred. Sections vary in depth: C1/C2/C4/C6 were verified against primary source (migrations + service/repository code, cited by file:line where practical); C5/C7/C8 are structural surveys (file sizes, headers, targeted greps) rather than line-by-line traces — treat those as directionally reliable, not exhaustive.

---

## C1 — Database / Schema Census

### Migration landscape (from `db/data0/`)

Two **numbering collisions** exist in the migration sequence as committed: `0018` has two different files (`0018_gk179_environment_identity.sql` and `0018_gk194_stored_function_schema_resolution.sql`), and `0019_gk194_...` duplicates the same content under a different number. This is a pre-existing repo-hygiene issue (CLAUDE.md's own GK-218 entry names a related class of numbering collision), not something this census resolves — flagged for whoever eventually touches migration tooling.

Migrations fall into three buckets by actual application status, which must not be conflated:

1. **DESIGN-ONLY, NEVER APPLIED** — `0001_generic_substrate.sql`, `0002_comic_projection.sql` (both say so in their own header), and portions of `0004_data1_foundation.sql` (`gk_organization`, `gk_membership`, `custody_event`, `condition_observation` are drafted there but **never applied** — confirmed by `src/modules/assets/repository.js:28-35`'s own comment: *"Column shapes here are verified against the LIVE data1_dev schema... which includes 4 tables — gk_organization, gk_membership, custody_event, condition_observation — never actually applied"*). `0006_outcome_ledger.sql` was also originally a design draft (its own header says "DESIGN DRAFT, NOT APPLIED") — **superseded later**: the actual live outcome ledger shipped via `0023_outcome1_marketplace_execution_ledger.sql` instead, with a different shape (see C12 contradiction below).
2. **PROPOSED, EXPLICITLY HELD** — `0013_d4_identifier_fabric.sql` ("PROPOSED, NOT APPLIED to data1_dev... Applying this migration to live data1_dev requires explicit authorization (D4 Phase B, not this pass)"). Notably, `src/modules/assets/service.js` already contains full D4-Phase-B-shaped service methods (`recordIdentifierDefinition` etc., ~line 1330+) with **zero call sites anywhere in `api/*.js` or `src/App.jsx`** (grep-confirmed) — this is staged/anticipatory code, consistent with the migration being held, not a contradiction.
3. **LIVE** (applied to `data1_dev`, per repository.js code comments and CLAUDE.md's own dispatch history, most recently re-confirmed by GK-216's full migration census): `gk_principal`, `gk_asset`, `ownership_event`, `current_owner`, `media`, `asset_identity_assignment`, `acquisition_event`, `valuation_event`, `decision_event`, `domain_event`, `outbox`, `comp_snapshot` (0012), `operator_action_event` (0021), `outcome_event`/`outcome_economics_component` (0023/0025), `collection_item`/`collection_item_link`, `buyer_decision_event`/`buyer_acquisition_event` (0027), `inventory_current_state`/inventory tables (0028), `market_observation` (0014), `valuation_question`/`applicability` (0016), `market_population`/`market_population_member` (0017). **PROVISIONAL — PRODUCTION TARGET UNVERIFIED**: this list is "live in `data1_dev`" per code/doc evidence; per GK-215, Production itself has these as empty (0-row) tables today, a separate fact already established and not re-litigated here.

### Column classification, asset/economic path

| Table | Column | Class | Note |
|---|---|---|---|
| `gk_asset` | `id`, `status`, `mint_basis_id`, `created_at` | UNIVERSAL | — |
| `gk_asset` | `asset_class` | UNIVERSAL (mechanism) | `TEXT NOT NULL DEFAULT 'comic'` — the column itself is category-neutral by design; comment reads *"future: 'book' \| 'card', per the AssetCore/BookAdapter/CardAdapter roadmap"*. `createPhysicalAsset({assetClass='comic', ...})` in `service.js:94-125` already accepts and persists a non-comic value (`UPDATE gk_asset SET asset_class = $1 WHERE ...` when `assetClass !== 'comic'`) — **the physical-asset kernel table is already category-neutral in mechanism; only its one live caller always passes `'comic'`.** |
| `ownership_event`, `current_owner`, `acquisition_event`, `decision_event`, `domain_event`, `outbox` | all columns | UNIVERSAL | No comic vocabulary anywhere in these tables' DDL. |
| `media` | `media_type` (`capture-photo`\|`grading-photo`\|`document`), `capture_view` (`FRONT`\|`BACK`\|`SPINE`\|`PAGES`\|`DETAIL`, 0029) | UNIVERSAL | Generic physical-object vocabulary, not comic-specific (works for a book, a card, a collectible equally). |
| `asset_identity_assignment` | `catalog_entity_id`, `authority`, `source` | UNIVERSAL | `catalog_entity_id` is a bare FK-less UUID in the live schema (`catalog_entity` itself was never applied) — treated as opaque. |
| `valuation_event` | `value_amount`, `value_currency`, `method`, `comp_snapshot_ref`, `comp_snapshot_id`, `market_population_id`, `build_sha` | UNIVERSAL | — |
| `valuation_event` | `grade_assumption NUMERIC(3,1)` | **MIXED / SEMANTIC LEAK** | Nullable, optional, but the *type itself* (`numeric(3,1)`) assumes a CGC-style 0.5–10.0 decimal grade scale. Fed from `out.numericGrade` (`src/lib/outcome1RuntimeBridge.js:77,113`) — a comic-pipeline-computed value. Not a hard blocker (nullable, unused by anything category-agnostic) but a real kernel leak — see C3. |
| `outcome_event` | `outcome_type`, `channel`, `external_listing_id`, `ask_amount`, `gross_amount`, `fees_amount`, `shipping_amount`, `net_amount`, `days_to_sale`, `next_observation_due_at` | UNIVERSAL | Fully marketplace/channel-generic — `channel` is a free string, not an eBay-specific enum. |
| `outcome_economics_component` | `component_type` (`gross`\|`fees`\|`shipping`\|`refund`\|`credit`\|`order_reference`), `amount`, `source` | UNIVERSAL | — |
| `inventory_current_state` / inventory tables (0028) | (per `src/modules/inventory/service.js` — zero comic-vocabulary matches on grep) | UNIVERSAL | State machine (`UNMANAGED→AVAILABLE→RESERVED→SOLD`) is category-agnostic by construction. |
| `buyer_decision_event` (0027) | `principal_id`, `session_id`, `gk_asset_id`, `market_value_amount`, `contemplated_price_amount`, `fee_pct`, `supplies_amount`, `labor_amount` | UNIVERSAL | Economics inputs mirror `maxBuyCalculator.js` verbatim, no comic assumption. |
| `buyer_decision_event` | `observed_title`, `observed_issue`, `observed_publisher`, `observed_year`, `observed_variant`, `observed_grade` | **MIXED / SEMANTIC LEAK** | Six comic-shaped text columns baked directly into an otherwise-universal economics event table, described in the migration's own comment as *"whatever the pipeline had resolved at decision time"* — i.e., a comic-pipeline snapshot living inside a universal table, not a generic `observed_attributes JSONB` bag. |
| `collection_item` (0026) | `id`, `principal_id`, `created_at`, `updated_at` | UNIVERSAL | — |
| `collection_item` | `asset_category TEXT NOT NULL DEFAULT 'comic'` | UNIVERSAL (mechanism) | See "asset_category today" below. |
| `collection_item` | `attributes JSONB NOT NULL` | UNIVERSAL (mechanism) | Migration's own comment: *"a future book/card adapter reuses this same table, never a category-specific column set."* Already the adapter-owned attribute bag C1 asked about — see below. |

### `asset_category` — how it's populated today

Three write points, all currently hardcoded to `'comic'`:
1. Migration default: `asset_category TEXT NOT NULL DEFAULT 'comic'` (0026).
2. Service default: `createCollectionItem({..., assetCategory = 'comic', ...})` (`src/modules/collection/service.js:63`).
3. **The one real client caller**: `src/lib/collectionSync.js:91` — `assetCategory: "comic"`, hardcoded, unconditional. This is the entire live call path (App.jsx never surfaces a category selector).

All readers/writers: `api/collection.js` (POST/PUT pass `assetCategory` through from `req.body`, optional), `src/modules/collection/repository.js` (raw SQL, `COALESCE($3, asset_category)` on update — omission preserves existing value), `src/modules/collection/service.js` (default `'comic'` on create only), `src/lib/collectionSync.js` (the sole hardcoded-`'comic'` caller), `tests/collection-endpoint-live-proof.test.js` (tests the mechanism, including non-`'comic'` values already).

**Conclusion:** `asset_category`/`attributes` is **already** a functioning, tested, category-agnostic attribute-bag mechanism at the schema/API/service layer. The only thing missing for a non-comic category to flow through it today is a caller that sends something other than `"comic"` — that is a **client-side** gap (App.jsx/collectionSync.js), not a schema or service gap. This directly informs C9 (Generic Asset Mode) and C14 (build sizing) — the collection-item layer needs zero migration for a second category.

**Category semantics are NOT duplicated elsewhere** in the live physical-asset path — `gk_asset.asset_class` and `collection_item.asset_category` are the only two category-tag columns found, and they are deliberately, correctly separate concerns (physical-asset class vs. catalogue-record category), linked only via `collection_item_link` (0007), never merged.

### Is the `gkAssetId`/physical-asset layer already category-neutral?

**Yes, structurally**, per the Asset Service audit (C6 below) — every mutating operation in `src/modules/assets/service.js` (mint, media, ownership, acquisition, valuation, decision, operator-action, outcome, economics) takes generic parameters and contains **zero** `if (assetClass === 'comic')` branching anywhere in the file (grep-confirmed for `comic`/`grade`/`issue`/`publisher`/`variant` inside `src/modules/assets/`: zero matches except the one `grade_assumption` field noted above and comment prose). The kernel is category-neutral in mechanism; it has simply never been fed a non-comic asset.

---

## C2 — Existing Universal-Asset Work

This repo already contains **three, mostly-unconnected** prior universalization efforts. None should be reinvented:

1. **AssetCore / format-adapter split** (pre-GrailKey, "Session 3B," `docs/ASSETCORE_INTERFACE.md`, `docs/ASSETCORE_BASELINE.md`, `docs/ASSETCORE_STOP_CONDITIONS.md`, `docs/ASSETCORE_EXTRACTION_SEQUENCE.md`). A **stateless pricing/decision** contract: `src/lib/pricingEngine.js` (363 lines), `src/lib/identityCore.js` (5163 lines), `src/lib/decisionEngine.js` (1277 lines) are the "AssetCore" universal engine; `src/adapters/ComicAdapter.js` (376 lines, 4 functions: `verifyStory`, `detectKeyValue`, `computeEraRisk`, `sanitizeComicTitle`) is the one live adapter. Ratified interface contract exists (`docs/ASSETCORE_INTERFACE.md`) with typed input/output field tables. **This has nothing to do with persistence, ownership, or gkAssetId** — it is purely "given identity+pricing+condition+evidence fields, compute a price and a decision." Roadmap names `BookAdapter`/`CardAdapter` as future work (CLAUDE.md's own Roadmap section, Sessions 4A/4B), never built.
2. **DATA-0 catalog-identity substrate** (`db/data0/0001_generic_substrate.sql`, `0002_comic_projection.sql`, `docs/DATA-0-ARCHITECTURE.md`) — DESIGN-ONLY, never applied. A generic evidence/claim/reconciliation model (`asset_class`, `catalog_entity`, `facet`, `claim`, `external_map`, `alias`) with comics as **seed data** (`INSERT INTO asset_class (code,name) VALUES ('comic', ...)`), explicitly documented as "generic evidence, typed canonical entities... a future book/card vertical adds rows, not migrations." A typed comic projection (`comic_publisher`/`comic_series`/`comic_issue`/`comic_printing`/`comic_variant`/`comic_creator`) sits on top, with an explicit "REBUILD RULE" (every typed row must be reproducible from the generic evidence layer). This is **catalog identity** (what book is this), a different axis from gkAssetId (what physical copy is this).
3. **GrailKey DATA-1 physical-asset kernel** (this census's main subject, C1/C6) — already category-parameterized at the schema/service level, fed only comic data by its one live caller.

**No existing ratified mechanism should be re-derived** for: category-agnostic attribute storage (`collection_item.attributes`, already built), generic economics events (`acquisition_event`/`valuation_event`/`outcome_event`, already built and already category-neutral), or a generic identifier scheme (D4 Identifier Fabric — designed, ratified via ADR-IDENTIFIER-001, held at Phase A, not yet applied).

**Dormant/never-wired code found:** D4 Phase B service methods (`recordIdentifierDefinition` and siblings, `src/modules/assets/service.js` ~1320+) — zero callers, migration not applied. DATA-0's entire catalog substrate — zero callers, migrations not applied.

**Governance:** `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md` (Six Foundation Laws + 16-question Compatibility Matrix, ratified 2026-09-01) is the standing constitution any universalization work must satisfy — see C12.

---

## C3 — Grade / Condition Leak Audit (highest priority)

| Occurrence | Location | Classification |
|---|---|---|
| `condition_observation.grade_scale CHECK IN ('CGC','raw-estimate')`, `grade_value NUMERIC(3,1) NOT NULL` | `0004_data1_foundation.sql:166-176` | **Migration debt, but harmless today** — table was never applied (see C1). If built as-drafted it would be a real kernel leak (hardcoded 2-value CGC/raw-estimate enum, non-nullable numeric grade — no `UNKNOWN` state at all, contradicting the repo's own "unknown must remain unknown" law). Free to redesign before it's ever built. |
| `valuation_event.grade_assumption NUMERIC(3,1)` | `0004_data1_foundation.sql:185`, live | **Kernel leak, low-severity** — nullable and unused by anything category-agnostic (`recordValuation`'s only caller passing it is `src/lib/outcome1RuntimeBridge.js`, a comic-pipeline bridge), but the *column exists on a universal table* with a comic/CGC-shaped type. A non-comic category with a non-numeric condition scheme (e.g. "Poor/Good/Excellent" for a collectible, or no scale at all) has no home here except `NULL`, silently losing information a generic `condition_summary JSONB` or `condition_basis TEXT` field would have kept. |
| `buyer_decision_event.observed_grade TEXT` | `0027_buyer_decision_ledger.sql:87`, live | **Kernel leak, adapter-correct-if-renamed** — a free TEXT field (not numeric-constrained, so it doesn't hard-block non-comic use), but named and grouped with 5 other explicitly comic-identity columns (see C1). Structurally it's closer to "adapter-owned observed-attributes snapshot living in the wrong table" than a true type-level leak. |
| `CGC_MULTIPLIERS`/`RAW_MULTIPLIERS`, `getGradeMultiplier`/`getRawGradeMultiplier` | `src/lib/pricingEngine.js` (per CLAUDE.md's own "Grade multipliers" section) | **Adapter-correct** — this is comic-pricing math, already scoped inside the AssetCore/ComicAdapter split (C2 #1), not part of the GrailKey persistence kernel at all. |
| Vision JSON_SHAPE `grade`/`cgcPenaltyFlags`/`defectPenalty`, CGC penalty-aware Vision (Ship #18) | `api/grade.js` | **Adapter-correct / UI-only** — comic-specific Vision prompt engineering; belongs entirely inside a future `ComicAdapter.assessCondition()` (C10), never the kernel. |
| Mega-key floor map, CGC-bucket grade maps | `api/mega-keys.js` | **Adapter-correct** — explicitly comic-vertical (43 entries, publisher+year), not referenced anywhere in `src/modules/`. |
| `src/lib/maxBuyCalculator.js` | grepped for grade/CGC/comic vocabulary: zero matches | **UNIVERSAL, not a leak** — MAX BUY math (`marketValue - fee - supplies - labor - targetProfit`) takes a bare `marketValue` number, condition-agnostic. |
| `src/lib/predictionErrorScoring.js` | grepped: zero grade/CGC/comic matches | **UNIVERSAL, not a leak** — scores predicted vs. realized dollar amounts only. |
| `src/modules/inventory/` | grepped: zero comic/grade matches | **UNIVERSAL, not a leak.** |
| Decision authority (`src/lib/actionAuthority.js`, `src/lib/decisionEngine.js`) | GK-238's own subject this session | **UNIVERSAL, not a leak** — `marketStanding`/`actionAuthority` operate on `pricingSource`/`soldCompDiagnostics` (generic evidence-quality signals), not grade. `decisionEngine.js`'s `recommendation` vocabulary (`LIST_NOW`/`RESEARCH`/`GRADE_CANDIDATE`/...) is comic-adjacent in *naming* (`GRADE_CANDIDATE`) but the mechanism is generic. |
| Listing (`api/list-ebay.js`) | title-building includes variant/grade text in the eBay listing title | **Adapter-correct + marketplace-adapter mixed** — this is exactly the C10 concern (see below): the function that builds a human-readable eBay title needs BOTH category knowledge (how to phrase a comic's condition) and marketplace knowledge (eBay's title-length limits/field requirements) in one place today. |

**`grade_assumption numeric(3,1)` relative to the universal kernel — explicit answer:** it sits **inside** the universal kernel (`valuation_event`, a live, category-neutral table used by every future category) but its *type* encodes a comic-specific assumption (single decimal grade 0.0–10.0). It is the single clearest concrete example of "adapter-owned interpretation leaking into a kernel column type" found in this census. Recommended target shape (not implemented here): keep `valuation_event` free of any grade-typed column; if a durable condition-basis snapshot per valuation is wanted, it should be a generic `condition_basis JSONB` (adapter writes whatever shape it wants) or a pointer to a separate, category-owned condition-evidence table — mirroring how `comp_snapshot_id`/`market_population_id` already keep evidence generic-and-referenced rather than inlined-and-typed.

---

## C4 — Identity Leak Audit

| Concept | Current treatment | Classification |
|---|---|---|
| `gkAssetId` (`gk_asset.id`) | Minted via `entity_mint_basis`/`mint_event`, namespace `asset:capture-event`, **basis key derived from principal+correlationId/scanlogKey only** (`src/modules/capture/mapping.js:26-37`, cited directly by Foundation Law 2's own evidence) — **never** derived from title/issue/publisher/year/variant. | **Physical identity — correctly separated.** Confirmed: `gkAssetId != marketplace/catalog identifier` holds today; nothing in the mint path reads comic fields. |
| title/series, publisher, issue, publication year | `asset_identity_assignment.catalog_entity_id` (opaque FK-less UUID, since `catalog_entity` was never applied) is the ONLY place a "what book is this" claim attaches to an asset — via `assignIdentity`/`correctIdentity`, both fully generic (no comic field parameters). The actual title/issue/publisher STRINGS live in `collection_item.attributes` (JSONB, comic-shaped today) and in the comic-pricing pipeline's own `out.title`/`out.issue`/etc. (never touching `gk_asset` itself). | **Market/catalog identity + category attributes — correctly separated from physical identity**, currently **conflated with each other**: `collection_item.attributes` mixes what should eventually be "market/catalog identity" (title, issue — used to look up comps) with "category attributes" (e.g. a signature, a defect note) in one undifferentiated JSONB bag. Not a physical-identity leak, but a real ambiguity for C10's `resolveMarketIdentity()` vs. category-attribute split. |
| printing, variant, cover | Comic-pricing pipeline only (`identityCore.js`, `compHygiene.js`) — never referenced in `src/modules/assets/` or any live migration. | **Correctly comic-adapter-scoped**, not a kernel leak. |
| slab company, certification number | `api/cgc-lookup.js` (dormant, WAF 403), comic pricing pipeline. Zero references in `src/modules/`. D4 Identifier Fabric (held, not applied) explicitly names `CERTIFIED_INSTANCE` as one of its generic scopes — the **intended** future home for a slab cert number, once built. | **Correctly comic-adapter-scoped today; a designed-but-unbuilt universal home already exists (D4).** |

**Preserved principle, confirmed:** `gkAssetId != marketplace/catalog identifier` holds throughout the live code. No counter-example found.

---

## C5 — Comic Pricing Stack (read-only map)

Chain, largest→smallest by file size: `src/lib/identityCore.js` (5163 lines — title/issue/year/variant resolution, comp backfill) → `api/comps.js` (eBay Browse API fetch + the documented hard/soft filter chain: title-similarity → reprint → VARIANT_CONTAM_RE → variant preference → cover-letter → lot → half-issue → TPB → slab → signed → grade proximity → creator match → price sanity → dedup) → `src/lib/soldVerification.js` (PriceCharting sold-comp verification, just extended this session for GK-238's `newestDaysAgo`) → `src/lib/compHygiene.js` (shared regex/hygiene primitives) → `src/lib/priceBands.js` (1105 lines — Tier 1–4 selection, Quick/Market/Stretch bands) → `src/lib/pricingEngine.js` (363 lines — floor guards, sanity checks, grade multipliers) → `src/lib/decisionEngine.js` (1277 lines — `computeDecision`) → `api/enrich.js` (the ~12,000+-line orchestrating handler that calls all of the above in sequence, plus ComicVine/PriceCharting/Ximilar/GoCollect lookups).

**Minimum boundary for `ComicAdapter.fetchMarketEvidence()`/`ComicAdapter.value()`:** the natural seam is exactly where AssetCore's existing interface contract (`docs/ASSETCORE_INTERFACE.md`) already draws it — `api/enrich.js`'s job (fetch PriceCharting/ComicVine/eBay, run the comp filter chain, call `computePriceBands`) would become `ComicAdapter.fetchMarketEvidence(asset)`; the pricingEngine/decisionEngine call sequence that turns evidence into a price+decision would become `ComicAdapter.value(asset, evidence)`. **This boundary is not new** — AssetCore's own `docs/ASSETCORE_STOP_CONDITIONS.md`/`docs/ASSETCORE_EXTRACTION_SEQUENCE.md` already describe a 7-step extraction plan for essentially this seam (Session 3, pre-GrailKey). It was never finished (comic remains the only vertical), but the seam and the extraction sequence are already designed. No code was refactored to verify this — read-only per instruction.

GK-230/GK-232/GK-233 (Tier-3 grade-blindness, display/math multiplier divergence) remain exactly where GK-238's own dispatch left them — untouched, still comic-pricing backlog, irrelevant to the adapter-boundary question itself (they'd move with the code, unresolved, into `ComicAdapter.value()` whenever that extraction happens).

---

## C6 — Economic Kernel (critical)

| Concept | Classification | Citation |
|---|---|---|
| Acquisition cost / cost basis | **UNIVERSAL NOW** | `acquisition_event.{cost_amount, cost_currency, source, lot_reference}` — no comic field. `recordAcquisition()` (`service.js:718-760`) — zero comic branching. |
| MAX BUY | **UNIVERSAL NOW** | `src/lib/maxBuyCalculator.js` — grep-confirmed zero grade/comic vocabulary. |
| Buyer Decision / Buyer Acquisition | **MOSTLY UNIVERSAL** | `buyer_decision_event`/`buyer_acquisition_event` (0027) — economics columns fully generic; **coupling**: `observed_title/issue/publisher/year/variant/grade` (6 columns, see C1) are a comic-shaped identity snapshot embedded in the row rather than a generic `observed_attributes JSONB`. |
| Valuation events | **MOSTLY UNIVERSAL** | `valuation_event` — fully generic except `grade_assumption NUMERIC(3,1)` (see C3). `recordValuation()` itself (`service.js:825-875`) has zero comic branching; the coupling is confined to that one column's type. |
| Inventory state machine | **UNIVERSAL NOW** | `src/modules/inventory/` — zero comic vocabulary anywhere (grep-confirmed on service.js). |
| Ownership | **UNIVERSAL NOW** | `ownership_event`/`current_owner`/`transferOwnership()` — zero comic fields. |
| Marketplace linkage | **UNIVERSAL NOW** (kernel) / **COMIC+EBAY COUPLED** (execution layer) | `outcome_event.channel` is a free string (kernel-generic) — but the only real writer, `api/list-ebay.js`, is eBay-specific AND comic-specific in one file (listing-title construction reads variant/grade text; the eBay API calls are marketplace-specific). The kernel table doesn't force this coupling; today's one integration does. |
| Outcome events | **UNIVERSAL NOW** | `outcome_event` — `outcome_type` enum (`LISTED`/`SOLD`/`EXPIRED_UNSOLD`/`DELISTED`/`ACTIVE_AT_CUTOFF`) is fully category/channel-agnostic. |
| Fee/economic components | **UNIVERSAL NOW** | `outcome_economics_component` — `component_type` enum (`gross`/`fees`/`shipping`/`refund`/`credit`/`order_reference`) generic. |
| Realized net | **UNIVERSAL NOW** | Always derived (`getOutcomeEconomics()`, `SUM` over components), never stored — no comic assumption possible in a derived SUM. |
| PredictionError | **UNIVERSAL NOW** | `src/lib/predictionErrorScoring.js` — grep-confirmed zero comic/grade vocabulary; scores predicted vs. realized dollar amounts, CENSORED while unsold. |

**Bottom line for C6 (the question that matters most): the economic kernel is already ~90%+ universal by mechanism.** The only real couplings found are (a) `valuation_event.grade_assumption`'s type (one column, nullable, low blast radius) and (b) `buyer_decision_event`'s six `observed_*` comic-identity columns (a real but bounded, single-table leak — the economics math itself in that same table is untouched). **Nothing here needs a rewrite.** Both couplings are additive-fixable (widen/replace one column type; add a generic sibling column or JSONB bag) without touching the append-only history already recorded.

---

## C7 — API Census

| Endpoint | Classification | Note |
|---|---|---|
| `api/capture-scan.js` | KERNEL_GENERIC | Auth → H8 gate → rate limit → delegates to `captureFromScan` (`src/modules/capture/`). Zero comic logic in the route file itself. |
| `api/assets.js`, `api/asset-media.js`, `api/asset-media-append.js` | KERNEL_GENERIC | Thin wrappers over `src/modules/assets/`'s generic surface. |
| `api/collection.js` | KERNEL_GENERIC (mechanism) | Passes `assetCategory`/`attributes` through opaquely — see C1. |
| `api/outcome-economics.js`, `api/ebay-outcome-reconciler.js` | KERNEL_GENERIC + MARKETPLACE_ADAPTER (reconciler only) | `outcome-economics.js` is generic (component ledger). `ebay-outcome-reconciler.js` is explicitly eBay-specific (Fulfillment/Finances API calls) — a real MARKETPLACE_ADAPTER, already named as such by its own code comments per CLAUDE.md's GK-221/222 entry. |
| `api/buyer-decision.js` | KERNEL_GENERIC (mechanism) + COMIC_ADAPTER (payload shape) | Append-only decision/acquisition writer is generic; the request body it accepts carries the comic `observed_*` fields (C6). |
| `api/list-ebay.js` | **NEEDS_SPLIT** | Single file mixes: GrailKey linkage/authority validation (KERNEL_GENERIC — this session's own GK-238 work lives here), eBay-specific API calls (MARKETPLACE_ADAPTER), and comic-specific listing-title/variant text construction (COMIC_ADAPTER). This is the single clearest NEEDS_SPLIT candidate in the whole API surface. |
| `api/delist-ebay.js` | MARKETPLACE_ADAPTER | eBay-specific. |
| `api/enrich.js` | COMIC_ADAPTER | The entire comic pricing/identity orchestration (C5). Massive (~12,000+ lines), 100% comic-specific by content, but already logically downstream of a `fetchMarketEvidence`/`value`-shaped seam (C5). |
| `api/grade.js` | COMIC_ADAPTER | Claude Vision comic identification/grading prompt (STANDARD_PROMPT, CGC penalty flags). |
| `api/comps.js`, `api/pricecharting-pop.js`, `api/mega-keys.js`, `api/cgc-lookup.js`, `api/gocollect.js`, `api/sold.js` | COMIC_ADAPTER | All comic-market-data-source-specific. |
| `api/manage.js`, `api/chat.js` | COMIC_ADAPTER (content) | Claude-powered collection analysis/chat — prompts are comic-flavored today; the underlying "ask Claude about my collection" mechanism could generalize, not attempted here. |
| `api/auth-login.js`, `api/auth-clerk.js` | KERNEL_GENERIC | Principal auth, no category concept. |
| `api/operator-action.js` | KERNEL_GENERIC | Thin wrapper over `recordOperatorAction`. |
| `api/rate-limit.js`, `api/kv-cache.js` | KERNEL_GENERIC (infrastructure) | Not asset-domain at all. |
| `api/collection-image.js` | KERNEL_GENERIC | Image proxy/storage, no comic assumption found on inspection of its role. |

**Dependency shape:** `api/enrich.js` → (writes nothing to the kernel directly; produces `out.*` consumed client-side) → App.jsx merges into `collection_item.attributes` via `api/collection.js` and, on explicit capture, into `gk_asset` via `api/capture-scan.js`/`api/asset-media*.js`. `api/list-ebay.js` reads both the comic pricing output (client-supplied, per GK-240's banked trust-boundary finding) and GrailKey kernel linkage (`gkAssetId`/`decisionEventId`/`operatorActionEventId`) to authorize a real eBay write. This is the one place all three concerns (kernel authority, comic content, marketplace execution) currently meet in one file.

---

## C8 — UI Census

`src/App.jsx` is 15,083 lines, monolithic (no component-per-file split). Major sections found by function boundary: `ResultCard` (~1665–2718, scan-result display), `BidCalculator` (~2718–3098, Buyer Mode/MAX BUY), `FloatingSearchBar` (~3098–4379), `CollectionDetail` (~4379–9265, **~4900 lines**, the single largest component — full comic-detail view: title/issue/publisher/year fields, grade display, CGC population, price ladder, slab/raw toggle, "Correct identity," listing controls, decision-panel render sites), `ManagePage` (~9265–10669, bulk listing/management), `WatchMode` (~10669+, live-scan buyer flow). `src/components/GrailKeyOperatorPanel.jsx` is a separate file (the physical-capture/mint UI, GK-218/226/227).

| Area | Classification | Note |
|---|---|---|
| `BidCalculator`/MAX BUY UI | UNIVERSAL | Confirmed by C6 — the underlying calculator has zero comic assumption; the UI fields (marketValue, fee, supplies, labor) are generic already. |
| `GrailKeyOperatorPanel.jsx` | **NEEDS-SHELL+ADAPTER-PANEL (closest to already-universal)** | The capture/mint button, media-append flow, and asset-graph display are already largely category-agnostic per GK-218/226/227's own descriptions (operator explicitly captures, no auto-inference) — the panel already resembles what a Universal Asset Detail shell would need, minus a category selector. |
| `CollectionDetail` | COMIC | The single largest, most deeply comic-coupled component: numeric grade display/edit, CGC population lookups, price ladder rendering, slab/raw controls, comic-specific condition prose, "Mark as Graded," issue-number-aware listing title construction. This is the component a Universal Asset Detail shell would need to wrap/replace for a non-comic category. |
| `ResultCard` | COMIC | Scan-result display assumes a comic was just identified (title/issue/publisher/grade fields throughout). |
| `ManagePage` | MOSTLY UNIVERSAL shell + COMIC content | Bulk-list/bundle mechanics are generic; individual row rendering pulls comic fields. |
| `FloatingSearchBar` | UNIVERSAL | Generic search/chat toggle, no comic assumption found. |

**Minimum Universal Asset Detail shell** would need: (1) a category-agnostic header (photo, name/title as free text, acquisition cost, current inventory state, current owner — all already available from the kernel per C1/C6), (2) a slot for a category-specific "identity + condition + market evidence" panel (populated by whichever adapter's `identify`/`assessCondition`/`fetchMarketEvidence` ran), (3) the already-universal MAX BUY/decision-authority/listing-authority panels (C6, and this session's own GK-238 `actionAuthority` display), which need **zero** category-specific rendering logic today (confirmed: `deriveMarketStanding`/`deriveActionAuthority` read `pricingSource`/`soldCompDiagnostics`, not comic fields). Comics' own panel would be the current `CollectionDetail` internals, relocated into an adapter panel rather than rewritten.

---

## C9 — Generic Asset Mode

| Step | Exists today? | Evidence |
|---|---|---|
| Device photo → explicit physical capture | **YES** | `GrailKeyOperatorPanel.jsx`'s "Capture as Owned Physical Asset" button (GK-218) — explicit operator tap, never inferred from scan/camera/upload source, per its own design description. |
| → `gkAssetId` | **YES** | `createPhysicalAsset()` — generic, `assetClass` parameterized (defaults `'comic'`, already overridable, C1). |
| → category = generic or operator-selected | **MISSING (client-side only)** | Schema/service support exists (`assetClass` param); no UI control to choose it — `GrailKeyOperatorPanel.jsx` always effectively mints `assetClass='comic'` (implicit default), and `collectionSync.js` always sends `assetCategory:"comic"`. This is the one concrete gap for Generic Asset Mode — a UI category picker, not a backend build. |
| → media evidence | **YES** | `attachMedia()` — fully generic, content-addressed, `captureView` axis (FRONT/BACK/SPINE/PAGES/DETAIL) already generic-physical-object vocabulary, not comic-specific. |
| → operator-provided identity/name | **PARTIAL** | `assignIdentity()`/`correctIdentity()` exist and are generic, but currently expect a `catalogEntityId` (pointing at the never-applied `catalog_entity` table) — there is no live path today for "operator just types a free-text name, no catalog lookup at all." This is a real, small gap: `assignIdentity` would need to accept (or already silently accepts, since `catalogEntityId` is nullable per Section 6 of the design doc) an identity assignment with `catalogEntityId: null` and the name living only in `collection_item.attributes` — needs confirming, not confirmed live this pass. |
| → optional attributes | **YES** | `collection_item.attributes JSONB` — already free-form. |
| → acquisition cost | **YES** | `recordAcquisition()` — fully generic. |
| → condition evidence | **PARTIAL** | No generic condition-evidence table is live (`condition_observation` never applied, C1/C3) — but nothing requires one for Generic Asset Mode; condition could legitimately stay `UNKNOWN`/unrecorded and use `attributes` for free-text notes, which already works. |
| → inventory | **YES** | `src/modules/inventory/` — confirmed category-agnostic (C6). |
| → optional manual valuation | **YES** | `recordValuation({method: 'operator-override', ...})` — already supports a non-engine-computed valuation with no comic assumption (aside from the optional, nullable `grade_assumption`). |
| → marketplace projection | **PARTIAL** | `outcome_event`/`recordOutcomeEvent` are generic; the only live *writer* is `api/list-ebay.js`, which is comic+eBay-coupled (C7). A Generic Asset Mode item has no live path to a real marketplace projection today — not a kernel gap, an integration gap. |
| → eventual outcome/realized economics | **YES** | Fully generic per C6, once an outcome exists. |

**Overall: Generic Asset Mode is much closer to already-existing than not.** The kernel, media, inventory, acquisition, valuation, and outcome-economics layers all already work for an arbitrary category with **zero migration**. The concrete missing pieces are entirely UI/wiring, not schema: (1) a category picker in the capture flow, (2) a free-text-identity path through `assignIdentity` that doesn't require a `catalog_entity` row (needs live verification, not assumed here), (3) a Universal Asset Detail shell (C8) that doesn't assume `CollectionDetail`'s comic fields, (4) no marketplace-listing path for a non-eBay/non-comic item (acceptable — Generic Asset Mode's own spec says it must not depend on automated valuation or identification; it does not claim to need a listing path).

---

## C10 — Category Adapter Contract (proposed, not implemented)

**Naming collision flagged first:** this repo already uses "adapter" for the AssetCore/ComicAdapter split (C2 #1) — a **stateless pricing/decision** contract (`identify`-shaped fields go IN, `price`+`decision` come OUT, nothing persisted). The dispatch's proposed `CategoryAdapter` interface below is a **different, broader** contract (identity resolution + condition assessment + market evidence + listing-attribute building), some of which overlaps AssetCore's existing scope and some of which (media/kernel-mutation-adjacent concerns) AssetCore was never meant to touch. **Recommendation, not implemented:** the eventual `ComicAdapter` for THIS interface should probably **wrap** the existing `docs/ASSETCORE_INTERFACE.md` contract for its pricing/decision methods (`fetchMarketEvidence`/`value` ≈ AssetCore's existing input/output contract) rather than reimplementing comic pricing logic a second time under a new name. Flagged as a real reuse opportunity, not a conflict requiring resolution now.

| Method | Required inputs | Returns | UNKNOWN allowed? | Mutates kernel state? | Category-specific or marketplace-specific? |
|---|---|---|---|---|---|
| `identify(evidence)` | Raw evidence (photo bytes/text) | A durable-truth-eligible identity CLAIM (not an assertion of fact) | **Yes, must be** — an unidentifiable item is a valid outcome | **No** — pure function; the caller (capture flow) decides whether/how to call `assignIdentity()` afterward | Category-specific |
| `assessCondition(evidence)` | Raw evidence (photo bytes/text) | A condition/defect description (adapter-owned shape — NOT forced into `grade_assumption`'s numeric type, per C3's recommendation) | Yes | No | Category-specific |
| `resolveMarketIdentity(asset)` | The asset's current identity claim(s) | A market/catalog-lookup key (e.g., for comics: title+issue+variant; for a different category: whatever that category's comp-search needs) | Yes — an asset with no resolvable market identity is legal (kernel already supports `catalogEntityId: null`) | No | Category-specific |
| `fetchMarketEvidence(asset)` | A market identity (from `resolveMarketIdentity`) | Raw comp/evidence data (mirrors today's `api/enrich.js`'s PriceCharting/eBay fetch, C5) | Yes — zero evidence found is legal (this session's own GK-238 work formalizes exactly this state at the kernel-authority layer: `NO_SOLD_EVIDENCE`) | No | Category-specific, but the underlying **data sources it calls** (PriceCharting, eBay Browse API) are shared infra any category could reuse if the adapter chooses to — worth noting as a genuine "not everything under this method needs reimplementing per category." |
| `value(asset, evidence)` | Asset + evidence from `fetchMarketEvidence` | A derived projection (price + confidence), never itself durable truth until `recordValuation()` persists it | Yes | **No — this is the critical boundary.** `value()` must return a number/projection; only an explicit, separate `recordValuation()` kernel call (already exists, C6) persists it. Flagged explicitly per the dispatch's own instruction: **do not let this method call `recordValuation` itself**, or category logic silently gains kernel-write power. | Category-specific |
| `buildListingAttributes(asset, channel)` | Asset + which marketplace channel | Channel-shaped listing fields (title, description, category-specific facets) | N/A (mechanical) | No | **Mixes both** — the flag this section asked for. Title-length limits, required-field validation, and channel taxonomy are MARKETPLACE-specific; how to phrase "9.4 CGC-graded" in a title is CATEGORY-specific. Recommend splitting into `buildListingContent(asset)` (category-owned: what to say) and a marketplace adapter's own `formatForChannel(content, channel)` (marketplace-owned: how to say it within that channel's constraints) — this is exactly the shape `api/list-ebay.js`'s NEEDS_SPLIT finding (C7) already independently pointed at. |
| `validateListing(asset, channel)` | Asset + channel + built listing content | Pass/fail + reasons | N/A | No | **Marketplace-specific**, not category-specific — eBay's own field requirements (e.g., "at least one photo," GK-208's own real production bug) have nothing to do with what category the asset is. Recommend this belongs entirely to the marketplace adapter, not the category adapter — the proposed interface as given **does mix responsibilities here**, per the dispatch's own request to flag this. |

**Summary flag:** the proposed 7-method interface, as given, **correctly separates category from marketplace concerns for 5 of 7 methods**, but conflates them in `buildListingAttributes` and misassigns `validateListing` to the category adapter when it's really marketplace-owned. Recommended (not implemented) correction: category adapter owns `identify`/`assessCondition`/`resolveMarketIdentity`/`fetchMarketEvidence`/`value`/`buildListingContent`; a separate marketplace adapter (already informally proven necessary by `api/list-ebay.js`'s and `api/ebay-outcome-reconciler.js`'s existing eBay-specific code) owns `formatForChannel`/`validateListing`/the actual API calls.

---

## C11 — Existing Data / Migration

**Zero schema migration is necessary for Generic Asset Mode**, stated explicitly per the dispatch's own instruction to say so if true. Every kernel table Generic Asset Mode's flow (C9) touches — `gk_asset` (`asset_class` already a free column), `media`, `ownership_event`, `acquisition_event`, `valuation_event`, `outcome_event`, `inventory_current_state`, `collection_item`/`attributes` — already accepts non-comic data by construction. The gaps found in C9 are **UI and wiring**, not schema.

For later steps (C13/C14), the governing rule (existing comic records remain valid, never reinterpreted) is already satisfied by construction for every live table: `asset_class`/`asset_category` default to `'comic'` and nothing proposed here changes that default or reinterprets an existing row's meaning. Any future generic condition-evidence table (replacing the never-applied `condition_observation` draft) would be a **new, additive** table, not a retrofit of existing rows.

**PROVISIONAL — PRODUCTION TARGET UNVERIFIED:** whether Production's live schema exactly matches `data1_dev`'s is not independently re-verified this pass (GK-216's prior full migration census is the most recent evidence, already cited in CLAUDE.md, not re-run live here per GK-235/this dispatch's own instruction).

---

## C12 — Master Architecture Compatibility

Compared against `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`'s Six Foundation Laws (ratified 2026-09-01) and CLAUDE.md's constitution. **Contradictions found (flagged, not resolved):**

1. **Law 6 evidence is stale relative to later, real shipped work.** The Foundation Laws doc's Law 6 ("Prediction ≠ outcome") evidence section, as ratified, cites `0006_outcome_ledger.sql`'s own header ("DESIGN DRAFT, NOT APPLIED") as proof that "no `OperatorAction`... or `OutcomeEvent` table exists in any applied migration," and rates the law "PARTIAL / design-only-in-practice." This is now factually stale: `operator_action_event` (0021) and `outcome_event`/`outcome_economics_component` (0023/0025) **were** later built and live-applied (GK-203/205/209/216, all post-dating this doc's 2026-09-01 ratification) — via a **different** migration than the one the doc's evidence cites (0006 was in fact superseded/abandoned in favor of 0023's differently-shaped table, not itself applied). Per the doc's own "Status governance" section, this must be recorded as a contradiction for a future audit ruling, not silently resolved here — Law 6's audited status likely needs updating to reflect that `OperatorAction`/`OutcomeEvent` now exist and are live, though `ListingProjection`/`PredictionError`-as-a-table still do not (PredictionError exists as a pure scoring function, `src/lib/predictionErrorScoring.js`, never a durable table).
2. **Law 4 (Identifier Fabric) status "ABSENT" is consistent with observed code, but nearly stale.** `src/modules/assets/service.js` already contains full D4-Phase-B service methods (`recordIdentifierDefinition` etc.) reaching toward a migration (0013) that remains explicitly HELD. This is **not** a contradiction today (zero callers, migration not applied, matches "ABSENT") but is flagged as the law most likely to need a status update on the very next dispatch that opens Phase A — i.e., this is a doc that will go stale almost immediately once U-series work touches identifiers.
3. **No contradiction found** between this census's proposed universalization direction (C13/C14 below) and Foundation Laws 1/2/3/5 or the META-LAW ("never redefine the permanent physical asset to make a feature work") — every mechanism cited in C1/C6/C9 as "already universal" was built and ratified under exactly this constitution, not around it.
4. **Collection ≠ physical asset**, restated by `0026_collection_item.sql`'s own header, holds: `collection_item` carries no `gk_asset_id` column of its own; linkage is exclusively through `collection_item_link` (0007). No counter-example found.
5. **"Only explicit physical capture mints"** holds: confirmed by GK-218's own design (button requires explicit operator tap, a real local `data:` URL, never inferred).
6. **"Inventory truth outranks listing state"** holds and was independently strengthened this train (GK-225's SOLD-consistency closeout, `hasAuthoritativeSoldOutcome` checked first) — no contradiction, an example of the rule being actively enforced, not merely stated.

---

## C13 — Proposed Universal Kernel (fields only, no comic attributes)

| Field | Status |
|---|---|
| `gkAssetId` | **Already exists** (`gk_asset.id`) |
| `assetClass`/category tag | **Already exists** (`gk_asset.asset_class`, `collection_item.asset_category`) |
| Principal / ownership (current + history) | **Already exists** (`gk_principal`, `ownership_event`, `current_owner`) |
| Physical evidence / media | **Already exists** (`media`, content-addressed, generic `media_type`/`capture_view`) |
| Provenance (capture basis) | **Already exists** (`entity_mint_basis`/`mint_event`, 0003) |
| Acquisition (cost basis) | **Already exists** (`acquisition_event`) |
| Inventory state | **Already exists** (`inventory_current_state` + inventory event tables, 0028) |
| Location / custody | **Rename/view only, partial** — `custody_event` is drafted (0004) but never applied; no live "current location" concept exists at all today. Would need an additive migration (a live `custody_event` + a materialized "current custodian" view, mirroring `current_owner`'s own pattern) — not a redesign, the pattern already exists to copy. |
| Valuation history | **Already exists** (`valuation_event`) — **caveat**: strip/generalize `grade_assumption`'s type per C3 before treating this as a clean universal field. |
| Acquisition decisions (Buyer Mode) | **Additive migration required for full generality** — `buyer_decision_event`/`buyer_acquisition_event` (0027) exist and their economics are universal, but the 6 `observed_*` comic columns (C1/C6) would need a generic sibling (`observed_attributes JSONB`) added additively; existing rows keep their comic columns untouched. |
| Marketplace projections (listings) | **Already exists** (`outcome_event` with `outcome_type IN ('LISTED', ...)`, generic `channel`) |
| Outcome history | **Already exists** (`outcome_event` full lifecycle) |
| Fees | **Already exists** (`outcome_economics_component`, `component_type='fees'`) |
| Realized net | **Derived, not stored** (`getOutcomeEconomics()`'s `SUM`, by design — correctly never a stored field) |
| PredictionError | **Derived, not stored** (`src/lib/predictionErrorScoring.js`, pure function over predicted vs. realized) |
| Condition/evidence summary | **Additive migration required, design not yet settled** — no live generic table; the never-applied `condition_observation` draft is the wrong shape (C3) and should not simply be applied as-is. Needs its own design pass (explicitly out of scope for this census to design). |
| Identifier fabric (external IDs, certs) | **Additive migration required, already fully designed** — 0013 + ADR-IDENTIFIER-001, held at Phase A, ready to open when authorized. |

**No comic-specific attribute (title, issue, grade scale, publisher, variant, printing) appears in this table** — consistent with the dispatch's own instruction.

---

## C14 — Build Plan

Sizes: XS = hours, S = ~1 day, M = 2–4 days, L = 1–2 weeks, XL = multi-week/needs its own design pass.

**Recommended ordering — same as the dispatch's stated preference, no changes required** (repo evidence supports this exact sequence; where a step turns out smaller than expected, noted inline):

| Step | Description | Size | Migrations | Irreversible risk | Required Production proof | Rollback point |
|---|---|---|---|---|---|---|
| **U2** | Canonical universal boundary/schema — formalize C13's kernel field list; NOT a rewrite, mostly documentation + the two additive migrations (`observed_attributes` on buyer tables, `grade_assumption` generalization) this census identified. | **S** (smaller than XS/S/M might suggest — most of the "boundary" already exists in code; this is largely ratifying what's already true) | Additive only (nullable columns) | None — additive-only per C11's own finding | None required (schema-only) | Any point before the additive migrations are applied |
| **U3** | Category Adapter interface — formalize C10's corrected 2-adapter split (category vs. marketplace); write the actual JS interface/contract files (no comic logic moved yet). | **S–M** | None | None | None | Interface files are pure addition, trivially revertable |
| **U4** | Generic Asset Mode — wire the UI gaps C9 found: category picker in capture flow, free-text identity path (verify `assignIdentity` truly supports `catalogEntityId: null` today — flagged as needing live confirmation), a minimal Universal Asset Detail shell (C8) for a non-comic item. | **M–L** | Possibly the `condition_observation`-replacement design (C13), if condition capture is wanted for U4's first release — could be deferred (UNKNOWN condition is valid) to keep U4 at M. | Low — this is the first real non-comic data ever written to the live kernel; recommend a single, deliberate manual test asset (mirroring the Milestone Ten H8 bootstrap-gate discipline already used for the *first* comic capture) rather than open availability immediately. | **Yes — first real non-comic `gk_asset` row, end to end (capture→media→inventory), on Production** | Before U4 ships, category-picker UI is dark/unreachable — trivial rollback |
| **U5** | ComicAdapter compatibility extraction — actually move `api/enrich.js`'s pricing/identity logic behind the U3 interface, reusing AssetCore's existing contract per C10's reuse-opportunity finding. Comic behavior must be byte-identical after. | **XL** | None | **Highest risk step in the whole sequence** — touches the single largest, most load-bearing, most tested file in the repo (`api/enrich.js`, ~12,000+ lines, GK-230/232/233 backlog still live inside it). Any regression here is a real customer-facing pricing regression. | **Yes — full regression parity proof against the existing comic pipeline**, likely requiring its own multi-pass dispatch (mirroring how GK-238 itself required 83-file regression verification for a much smaller change) | Feature-flag the adapter boundary; keep the pre-extraction code path reachable until parity is proven over real scans |
| **U6** | Second real category — **not selected in U1**, per instruction. Sizing depends entirely on which category (a category needing numeric condition grading looks very different from one that doesn't). | **Unsized pending selection** | Likely needs the condition-evidence design from U4/C13 | Depends on category | First real second-category asset on Production | N/A until scoped |
| **U7** | Mixed Universal Collection/Inventory — a Collection view that shows both comic and non-comic items coherently (the C8 shell generalized further). | **M** | None (UI-only, assuming U4/U5 landed) | Low | No | Easy — additive UI |
| **U8** | Universal acquisition economics — generalize any remaining comic-specific assumptions in Buyer Mode beyond the `observed_*` columns (if any are found once a second category exists). | **S** | Possibly none, if U2's additive migration already covered it | Low | No | Easy |
| **U9** | Reserve Authority — **explicitly out of scope to build in U1**, not sized here. | — | — | — | — | — |
| **U10** | Universal Economic Router — routing valuation/outcome logic across categories/marketplaces once ≥2 of each exist. | **L–XL** | Unknown until U6/marketplace-adapter count is known | Depends on scope at the time | Yes, per-category | Depends on scope |

**Natural rollback points, overall:** every step through U4 is additive/reversible by construction (matches C11's own finding — zero destructive migration required anywhere in this plan). **U5 is the one step that touches load-bearing, already-shipped comic behavior** and is correctly the point where this plan should slow down and require the heaviest proof — not because the architecture demands it, but because `api/enrich.js` itself is simply large, old, and carries real unresolved backlog (GK-230/232/233) that a naive extraction could accidentally "fix" or "break" as a side effect. Recommend U5 explicitly re-confirms GK-230/232/233 remain byte-identically untouched as its own acceptance gate, the same discipline this session's own GK-238 dispatch already used successfully.

---

## Addendum — U1 Review Packet (pass 2, re-verification against source)

Written in response to the "U1 — REVIEW PACKET BEFORE U2" follow-up dispatch. Corrects/sharpens pass 1 with citations re-checked directly against migrations and source, not recalled from the first summary.

**Correction to pass 1:** `src/adapters/BookAdapter.js` **already exists** (122 lines, created 2026-06-06, same commit day as `ComicAdapter.js`/`docs/ASSETCORE_INTERFACE.md` — `git log --diff-filter=A`). Pass 1 relied on CLAUDE.md's Roadmap text ("Session 4A (Next) — BookAdapter: create BookAdapter.js") and incorrectly reported it as not yet built. It is a **dormant skeleton**: `detectKeyValue(edition, signed, author)` defined, zero real call sites anywhere in `api/*.js` or `src/App.jsx` (grep-confirmed) — never wired to anything.

**New finding — ADR-ADAPTER-001 is a live, active governance gate on U5/U6, not just background context.** Ratified 2026-08-21 (Summit Phase 1, Task B). **Ruling 31: "No `BookAdapter.js`/`CardAdapter.js` (or any future adapter) may be started until every item GK-147 named is either fixed... or explicitly re-scoped."** GK-147 named four specific items. Re-verified against source today (2026-09-21, one month after ratification): **all four are still present, unfixed:**
1. `src/lib/decisionEngine.js:137-139` — `if (item.identityComplete === false && !isProvisionalWithRealComps) { decision.blockers.push('identity-incomplete'); }`, where `identityComplete` is a boolean ComicAdapter computes from **comic-specific issue+publisher presence** (comment, same lines) — a hard blocker in the supposedly-universal decision engine keyed off comic-shaped completeness.
2. `src/lib/pricingEngine.js:125-126` — comment, verbatim: *"Era boundaries (Golden<1970, Silver/Bronze 1970-1984, Modern 1985+) are comic-specific — revisit in ComicAdapter Step 5."* Still inline in `computeSanityFallback`, not behind any adapter call.
3. `src/lib/pricingEngine.js:111` — the 1956 Silver Age boundary, still hardcoded inline in the same function.
4. `src/lib/pricingEngine.js:46,183` — `isMegaKey` still read directly inside AssetCore-claimed pricing logic (`computeThinPoolAnchor`'s skip condition), not routed through an adapter call.

This directly bears on C10/C14: **GK-147 is not "backlog," it is a currently-binding precondition for U6 (second category) and, by extension, anything U5 (ComicAdapter extraction) would need to hand off to a second adapter.** It does not block U2/U3/U4 (none of which start a second adapter).

**New finding — a live constraint gap, adjacent to this session's own GK-238 work, found while re-checking C1/C6/item-8's nullability trace.** `src/modules/buyer/service.js:72` — `if (marketStanding != null) requireEnum(marketStanding, ['EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY'], 'marketStanding');` — this whitelist predates GK-238 and was already missing `FALLBACK_ONLY`/`NONE` (both pre-existing `deriveMarketStanding` outputs); GK-238 (this same session, `836f264`) added a **fourth** missing value, `NO_SOLD_EVIDENCE`. Any Buyer Mode BUY/PASS decision synced for a book whose `contract.actionAuthority.marketStanding` is one of these four values will throw `ValidationFailedError` in `recordBuyerDecision`, and (per `src/App.jsx`'s own described "saves locally first, best-effort syncs durably, retried on next reconnect" pattern) will simply retry-and-fail forever rather than ever durably syncing. **Not fixed here (TRACE ONLY, and out of this dispatch's stated scope) — flagged as a real, live, pre-existing-and-just-slightly-worsened gap for a future ticket**, not a U-series item.

**No current drift found in the ComicAdapter seam itself** (see item 10 in the chat report) — the one historical "independently drifted duplicate" reference found in `src/lib/imageSearchIdentity.js:667-671` is dated (Q119, 2026-07-18) and was already resolved by consolidating onto `identityCore.js`'s canonical `COMPOUND_TITLE_WHITELIST`; it is a precedent showing drift *can* recur, not evidence of current drift.

---

## Hard boundaries confirmed observed

No implementation code was written. No schema was migrated. No pricing code was modified (`api/comps.js`, `src/lib/priceBands.js`, `src/lib/pricingEngine.js` were read, not edited). GK-230/GK-232/GK-233 were not touched. The six quarantined files (`scripts/capture-active-cache-entry.mjs`, `db/data0/0018_gk194_stored_function_schema_resolution.sql`, `db/data0/0018_gk194_stored_function_schema_resolution_rollback.sql`, `docs/PRODUCT-REFINEMENT-BANK.md`, `scripts/ingest-fixture-response.mjs`, `scripts/merge-fixture.mjs`) were not modified, staged, deleted, stashed, or renamed. No Shopify/Whatnot integration was built. No Reserve Authority was built. U6's second category was not selected. No comic functionality was deleted or altered.
