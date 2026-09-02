# GrailKey Physical Asset Protocol — v1

**Status: first canonical publication.** Ratified 2026-09-01 (GrailKey Dispatch 2026-09-01, Pre-Volume Train A, D1.2/D1.3). `docs/LAUNCH-AUDIT.md` runs Section 1 through Section 16 only (confirmed by full heading grep, last heading at line 680) — there is no Section 18 or Section 19 in that document. No prior audited "six Foundation Laws" outline or "16-question Compatibility Matrix" exists anywhere in this repo (confirmed by grep across `docs/` for "Foundation Law" / "Compatibility Matrix" — zero hits before this document). This document is that first publication, not a transcription of a pre-existing audit section.

The law text and audited-status values below are reproduced **verbatim** from the ratified wording supplied 2026-09-01. Repo evidence is cited underneath each law as supporting proof of **current state** only — it never rewrites a law's wording and never silently changes its audited status. Where current repo evidence appears to conflict with a law's wording or its audited status, that conflict is recorded as a contradiction for review (see each law's "Evidence" line), not resolved silently in either direction. As of this publication, no such conflict was found — every audited status below is consistent with what a direct read of the current codebase shows.

This document, from this point forward, is the canonical source for the Six Foundation Laws and the Compatibility Matrix. `CLAUDE.md`'s navigation section points here rather than duplicating the content.

---

## Six Foundation Laws

### Law 1 — Physical instance ≠ catalog class

A GrailKey `gkAssetId` is permanent identity for the physical instance. It never becomes an eBay ID, UPC, GTIN, SKU, serial, IMEI, VIN, CGC/PSA certification number, catalog ID, listing ID, or other external identifier. Those identifiers may be authoritative evidence for a claim, but they remain relationships/evidence and never become `gkAssetId` or silently redefine the physical asset.

**Audited status: IMPLEMENTED.**

**Evidence (current state):** `docs/adr/ADR-ID-001-permanent-identity.md`, `docs/adr/ADR-ASSET-001-physical-asset-identity.md`. A real production asset exists under this model: `gkAssetId 01a02d23-1acb-72e8-aae3-8f851308e9cf` (Creepy #1, Warren Publishing 1964 — CLAUDE.md, DATA-1D block), retrievable via the authenticated asset/media read surface (`api/assets.js`, `api/asset-media.js`) with external identifiers (title/publisher/issue metadata) stored as attributes on the catalog projection, not as the asset's identity. No conflict found between this evidence and the law's audited status.

### Law 2 — Capture is many-to-many

The architectural shape is:

```
CaptureSession → Observation/Frame → 0..N ObjectCandidates → 0..N AssetLinks → 0..N PhysicalAssets
```

A detected candidate is not automatically an asset. The candidate-safe mint-basis work scoped for this train's D3.1 is only the pulled-forward pre-volume slice needed to prevent two candidates from collapsing onto one asset. The full capture abstraction remains D8.

**Audited status: PARTIAL.**

**Evidence (current state):** the idempotent-mint mechanism this law depends on already exists and is file-verified: `CREATE UNIQUE INDEX entity_mint_basis_unique ON entity_mint_basis (basis_namespace, basis_key)` (`db/data0/0003_uuidv7_identity_and_mint_ledger.sql:275`); live application against `data1_dev` is pending D2.1, not assumed here. `buildCaptureBasis` (`src/modules/capture/mapping.js:26-37`) constructs today's basis key from `principalId` + `correlationId`/`scanlogKey` only — it does not yet carry a candidate discriminator, so today's single-object callers are what the mechanism currently supports; D3.1 (not this pass) is the change that adds the discriminator. This is consistent with PARTIAL, not a conflict.

### Law 3 — Time is first-class

`occurred_at` is asserted event time. `recorded_at` is GrailKey ingestion/recording time. Both are independently persisted where applicable. Neither is inferred from the other after persistence. There is no DB chronology invariant requiring `occurred_at <= recorded_at`.

**Audited status: PARTIAL.**

**Evidence (current state):** checked every `*_event` table across `db/data0/0001`–`0010`. None currently carries both `occurred_at` and `recorded_at` — each has exactly one timestamp column today (e.g. `valuation_event.occurred_at`, `db/data0/0004_data1_foundation.sql:187`, no companion `recorded_at`). The only two-timestamp shapes in the schema today are `outbox` (`created_at`/`processed_at`, a delivery-tracking pair, not this law's shape) and the design-draft, unapplied `asset_outcome_current` projection (`last_listed_at`/`last_sold_at`, `0006_outcome_ledger.sql`). D3.2 (not this pass) is the implementation slice for this law. Consistent with PARTIAL.

### Law 4 — Identifier Fabric

GrailKey uses one generic `AssetIdentifier` domain rather than a per-vertical identity mechanism. The scope model includes, at minimum where applicable: `PRODUCT_CLASS`, `MODEL`, `VARIANT`, `BATCH`, `LOT`, `SERIALIZED_INSTANCE`, `CERTIFIED_INSTANCE`. External identifiers and credentials attach through this fabric. They do not redefine the permanent physical asset.

**Deadline: before broad Import.**

**Audited status: ABSENT.**

**Evidence (current state):** no such table or domain exists anywhere in `db/data0/0001`–`0010`. Identity today is carried by `catalog_entity`/`external_map`/`claim` (0001) for catalog-side identity and `gk_asset`/`entity_mint_basis` (0003/0004) for physical-asset identity — no generic `AssetIdentifier` scope table spanning `PRODUCT_CLASS`/`MODEL`/`VARIANT`/`BATCH`/`LOT`/`SERIALIZED_INSTANCE`/`CERTIFIED_INSTANCE` exists. Planned implementation: D4. Consistent with ABSENT.

### Law 5 — Market = observations → valuation

The architectural direction is:

```
MarketObservation → applicability → MarketPopulation → ValuationEvent → EconomicProjection
```

Durable truth is never modeled as `asset.value = X`. Historical valuation evidence must remain durable, and any snapshot referenced by a valuation becomes immutable. Repricing creates new evidence / a new snapshot / a new valuation rather than mutating referenced history. D3.3 is only the pulled-forward durable comp-snapshot slice; the full MarketObservation domain remains D5.

**Audited status: PARTIAL.**

**Evidence (current state):** `valuation_event` exists with a `comp_snapshot_ref` column already present — `TEXT, -- nullable pointer to a comp-pool snapshot (future priceDerivationTrace durability work, not built here)` (`db/data0/0004_data1_foundation.sql:178,184`) — but it is nullable and currently unpopulated by any comp-snapshot table, and no such table exists yet. No `MarketObservation`/`MarketPopulation` domain exists. `recordValuation` (`src/modules/assets/service.js:677-717`) writes `valuation_event` rows today but has nothing durable to point `comp_snapshot_ref` at. Consistent with PARTIAL.

### Law 6 — Prediction ≠ outcome

A prediction or decision is not realized fact. `DecisionEvent` is immutable at write. `OperatorAction`, `ListingProjection`, `Transaction`, and `OutcomeEvent` append as later facts. `PredictionError` is derived from prediction versus realized outcome.

**Deadline: before the first real `DecisionEvent` where the full outcome-learning path is required.**

**Audited status: PARTIAL / design-only-in-practice.**

**Evidence (current state):** `decision_event` exists and is live (`db/data0/0004_data1_foundation.sql:192`). The outcome side does not: `db/data0/0006_outcome_ledger.sql` states in its own header, "**DESIGN DRAFT, NOT APPLIED**... Not applied to `data1_dev` or any database as part of this dispatch" (lines 1-6), and defines `outcome_event`/`asset_outcome_current` only as an unapplied draft. No `OperatorAction`, `ListingProjection`, `Transaction`, or `PredictionError` table exists in any applied migration. Consistent with "PARTIAL / design-only-in-practice."

---

## META-LAW

A capability may add a relationship, observation, event, projection, adapter, credential, or derived state. It may never redefine the permanent physical asset to make a feature work.

---

## Status governance

The audited-status value on each law above is preserved from the ratified 2026-09-01 wording and is **not** re-derived from current repo observations on each future read of this document. Repo evidence is used only to describe current state and supporting proof underneath a law. If a future direct read of the codebase appears inconsistent with a law's wording or its audited status, that inconsistency must be recorded explicitly as a contradiction for review — never silently resolved by rewriting the law or by quietly changing the status column to match new observations. A status changes only by an explicit later audit ruling, cited by date and dispatch.

Status snapshot at this publication:

| Law | Status |
|---|---|
| 1 — Physical instance ≠ catalog class | IMPLEMENTED |
| 2 — Capture is many-to-many | PARTIAL |
| 3 — Time is first-class | PARTIAL |
| 4 — Identifier Fabric | ABSENT |
| 5 — Market = observations → valuation | PARTIAL |
| 6 — Prediction ≠ outcome | PARTIAL / design-only-in-practice |

---

## Compatibility Matrix

Standing pre-merge gate. Any change touching the physical-asset domain, the identity fabric, media, or valuation/decision surfaces answers all 16 questions YES / N/A / NO with evidence. **A single NO stops the train and requires architectural review before shipment.** These are the exact ratified questions — supporting repo rules may be cited underneath them, but the questions themselves are never reworded or replaced.

1. Does permanent `gkAssetId` remain unchanged?
2. Is physical instance kept separate from catalog class, with no domain field added to `gk_asset` that collapses the distinction?
3. Are external IDs linked through the Identifier Fabric, never adopted as `gkAssetId`?
4. Are model outputs represented as claims with source / authority, never as unsupported bare truth?
5. Is evidence and provenance preserved through additive records rather than overwritten?
6. Is event history preserved as append-only, with no mutation of prior event truth?
7. Is the capability many-to-many-capable at the capture layer, or explicitly N/A?
8. Does it use generic identifiers rather than a vertical-specific identity mechanism, or explicitly N/A?
9. Are market observations / valuation evidence preserved durably, or explicitly N/A?
10. Are predictions and decisions immutable once written, or explicitly N/A?
11. Can the provider / model / external service be swapped without changing the permanent domain schema?
12. Is marketplace integration projection-only rather than becoming asset identity?
13. Does the kernel remain vertical-neutral, including no comic-specific permanent-domain field in `src/modules/assets/`?
14. Is unknown-asset state legal, including `authority:NONE` or equivalent being reachable and testable?
15. Does the design preserve eventual outcome learning, including nothing that prevents later `OutcomeEvent` / transaction linkage?
16. Wherever an event may be backdated or imported, does the system preserve a true `occurred_at` distinct from `recorded_at`?

### Reporting procedure (added D2 checkpoint, 2026-09-01)

For a documentation-only change that touches no executable code, schema, migration, permanent-domain structure, or runtime behavior, the Compatibility Matrix may be reported once as:

> `N/A — documentation-only; no governed executable/domain/schema/migration surface changed.`

For any change touching executable code, schema, or migrations, all 16 ratified questions above must be rendered individually with YES / N/A / NO and evidence — the single-line form above is not a substitute in that case. Any NO still stops the train regardless of which form was used.

This procedural rule governs how the matrix is *reported*; it does not alter, replace, reword, or reduce the count of the 16 ratified questions themselves.

---

## Supporting invariants (not Foundation Laws)

These are real, standing durability rules that support the laws above — most directly Laws 3, 5, and 6 — but are deliberately not numbered among the Six Foundation Laws. They are documented here so they have one canonical home instead of being folded into the law list.

### Media durability (GK-167)

Reads and deletes of an existing media row must dispatch exclusively from the persisted `object_uri` scheme. `MEDIA_STORAGE_DRIVER` controls the storage provider used for **new writes only** and must never reinterpret an existing row.

**Currently violated at HEAD.** `src/modules/media/index.js:26-35`:

```js
function driverName() {
  return process.env.MEDIA_STORAGE_DRIVER || 'localfs';
}

async function selectDriver() {
  const name = driverName();
  if (name === 'localfs') return DRIVERS.localfs;
  if (name === 'vercel-blob') return await import('./driver-vercel-blob.js');
  throw new Error(`[media] unknown MEDIA_STORAGE_DRIVER: ${name}`);
}
```

Every `put`/`head`/`getBytes` call (`index.js:38-54`) resolves the driver from the env var alone — it never inspects the `object_uri` string already stored on the row being read. Tracked as **GK-167, OPEN** (`docs/TICKET-REGISTRY.md:152`). The fix — dispatching `head()`/`getBytes()` by the `object_uri`'s own scheme prefix rather than the blanket env var — is scoped to D2.2, not this pass.

### Append-only

Durable event rows and any snapshot referenced by a valuation append; they are never rewritten in place. Reconciliation is additive. Garbage collection is report-only by default; destructive action requires an explicit flag. A valuation snapshot, once referenced by any `valuation_event`, is immutable.

Grounded in the GrailKey Architecture Constitution's "History Appends" and `docs/adr/ADR-EVENT-001-event-model.md`, and in the Summit Phase 1 amendment A5 precedent already restated verbatim at the top of every file in `db/data0/` ("never modify historical migrations"). Spot-checked at this publication: no `UPDATE` statement was found against any `*_event` table inside `src/modules/assets/repository.js`'s insert functions. This is a spot check, not a full audit — reconfirm before relying on it for a specific change.

---

## Related documents

- Ticket-level detail: `docs/TICKET-REGISTRY.md`
- Older architectural findings: `docs/PATTERN-LIBRARY.md`
- Asset/auth/media/capture ADRs: `docs/adr/ADR-ASSET-001-physical-asset-identity.md`, `ADR-ID-001-permanent-identity.md`, `ADR-MEDIA-001-media-storage.md`, `ADR-EVENT-001-event-model.md`, `ADR-STORAGE-001-storage-roles.md`
- Cross-workstream status board: `docs/MASTER-BOARD.md`
