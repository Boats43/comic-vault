# ADR-ASSET-001 — Physical Asset Identity

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 9–11.**

## Context

Every ADR up to this point in this project's history (DATA-0A through DATA-0E-PILOT) has modeled the CATALOG side of a comic — the abstract "Amazing Spider-Man #52 (2021)" that exists identically for every copy anyone owns. Nothing in the schema so far represents the PHYSICAL OBJECT a GrailKey user actually scans, grades, and sells. `docs/PATTERN-LIBRARY.md`'s GK-150 finding (Asset Network census) already named the gap directly: `bundleId = ebayItemId` in `src/App.jsx` derives a GrailKey grouping concept's identity from an external marketplace's own ID scheme, because no durable, GrailKey-owned identity for "the physical thing a user owns" exists yet. GK-145 (`docs/DATA-1-READINESS.md`, `collectionItemId`) was explicitly documented as a temporary client-record correlation, "NOT `gkAssetId` and NOT proof of physical-copy identity," pending exactly this ruling.

## Decision

**Ruling 9 — `gkAssetId` represents one physical object, full stop.** Not a catalog concept, not a listing, not a scan record — the actual book/slab/loose-copy a specific user physically possesses. Two people who each own a copy of the same issue have two different `gkAssetId`s, both resolving (via `asset_identity_assignment`, ADR-EVIDENCE-001) to the same `gkIssueId`.

**Ruling 10 — minted at capture, not at identification.** The moment a user's scan/photo capture flow begins recording a new physical item (Watch Mode capture, a manual catalog entry, a bulk-import row), a `gkAssetId` mints immediately — before Vision has run, before any identity claim exists, before the user has confirmed anything. The physical object is real and already needs a durable handle the instant it enters the system; identity resolution is a process that happens TO an already-real `gkAssetId`, not a precondition for it existing.

**Ruling 11 — identity-independent, and the duplicate-copy law.** `gkAssetId` never changes as a consequence of identity correction — scanning a book that Vision first read as "Detective Comics #1107" and later correcting to "#1106" does not mint a new asset; the same `gkAssetId` simply gains a new `asset_identity_assignment` row (ADR-EVIDENCE-001). The physical object didn't change; only the system's understanding of what it is did.

**Duplicate-copy law:** the system has no reliable way to distinguish "this scan is a re-scan of a book I already catalogued" from "I bought a second copy of the same issue" — both are physically valid, ordinary user actions. **Default: every new capture mints a new `gkAssetId`.** Consolidating two `gkAssetId`s into "actually the same physical object" is an explicit, user-initiated action only (e.g. a "merge as same copy" affordance in the catalog UI) — never automatic, never inferred from identity agreement alone (two assets resolving to the same `gkIssueId` is completely ordinary — most collectors own more than one copy of nothing, but plenty own duplicates of a handful of key issues — and is not evidence they're the same physical object).

## Invariants

1. `gkAssetId` exists before, and independently of, any identity claim about what the asset is.
2. `gkAssetId` is never regenerated, reassigned, or silently merged by any identity-resolution process.
3. Merging two `gkAssetId`s into one requires an explicit user action, recorded with the same append-only discipline as ownership/custody transfer (ADR-AUTH-001) — never a silent delete of either original ID.
4. A `gkAssetId` with zero resolved identity (Vision hasn't run yet, or every attempt was inconclusive) is a valid, storable state — not an error condition blocking the asset's own existence.

## Consequences

- `collectionItemId` (GK-145) is retired as a load-bearing correlation field once `gkAssetId` is wired through the collection flow — GK-145's own registry entry already anticipated this ("temporary client-record correlation only, until DATA-1 defines a real durable asset identity").
- GK-150's `bundleId = ebayItemId` defect now has its real fix target: a bundle becomes a GrailKey-owned grouping of `gkAssetId`s, with `ebayItemId` relegated to `external_map` — one mapped external reference among possibly several, never the primary key.
- Bulk import, Watch Mode, and manual catalog entry all become "capture creates a `gkAssetId`" call sites — a real, identifiable set of implementation gates (below), not a diffuse refactor.

## Rejected Alternatives

- **`gkAssetId` minted only after identity is confirmed.** Rejected: creates exactly the gap GK-150 already exposed — something needs a durable identity from the moment of capture (for bundle grouping, listing references, ownership tracking) regardless of how long or how uncertain identity resolution takes; Watch Mode's own multi-pass, sometimes-inconclusive identification flow (CLAUDE.md's "Watch Mode pipeline") makes "wait for confirmed identity" an unbounded wait in the worst case.
- **Automatic duplicate-copy merging on identity match.** Rejected: identity agreement between two assets is the ORDINARY case for anyone who owns more than one copy of a popular back-issue — treating it as evidence of physical duplication would silently and incorrectly collapse real, distinct inventory.
- **One `gkAssetId` per `gkIssueId` (i.e., model ownership as a quantity count rather than distinct objects).** Rejected: loses per-copy grading/condition/provenance/pricing history, which this project's entire pricing and grading pipeline (CLAUDE.md's pricing stack, CGC penalty-aware Vision, pedigree registry) already depends on being per-physical-copy, not per-catalog-entry.

## Implementation Gates

- No capture flow (Watch Mode, manual entry, bulk import, duplicate-confirm) may be wired to mint `gkAssetId` until ADR-EVIDENCE-001's `asset_identity_assignment` table exists — capture-without-an-identity-slot-to-eventually-fill is not a supported intermediate state.
- The "merge as same physical copy" user action is out of scope for DATA-0E-FULL (which mints catalog entities, not assets) — tracked as a DATA-1 UI/flow item, not blocking this ADR's ratification.

## Related Tickets

- GK-145 — RESOLVED-BY-ADR (retirement path stated above).
- GK-150 — OPEN, remediation path is ADR-ADAPTER-001 (`bundleId`'s own fix belongs to that ADR's "listing-as-projection" ruling) plus this ADR's `gkAssetId` existing as the thing a bundle actually groups.

## Supersession

None. This is a new concept with no prior ADR to supersede. A future ADR may extend this one (e.g. for non-comic asset classes, per the AssetCore/BookAdapter/CardAdapter roadmap already documented in CLAUDE.md) but must not silently redefine `gkAssetId`'s own meaning without a superseding document.
