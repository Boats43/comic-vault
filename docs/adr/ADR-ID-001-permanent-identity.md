# ADR-ID-001 — Permanent Canonical Identity Scheme

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 1–8.**

## Context

DATA-0E's pilot mint (`docs/DATA-0E-PILOT-CANONICAL-MINTING.md`, commit `111e620`, now relabeled PILOT/NON-PRODUCTION/NON-BINDING) proved a real, working determinism/collision/provenance mechanism using a stable SHA-256-derived 63-bit signed `BIGINT`. That pilot's own header surfaced two real blockers rather than working around them silently:

- **ID-1**: `db/data0/0002_comic_projection.sql`'s own DDL declares `gk_publisher_id`/`gk_series_id`/`gk_issue_id` as `BIGINT REFERENCES catalog_entity(id)`, and `0001_generic_substrate.sql` declares `catalog_entity.id` as `BIGSERIAL` — an auto-increment sequence. A sequence's output is a function of insertion order and table state, not of claim content — it structurally cannot satisfy "drop-and-remint produces identical IDs," a requirement stated explicitly for the pilot and treated here as a permanent invariant of any canonical ID.
- **ID-2**: the pilot's Postgres artifact inserted explicit `id` values into a nominally-`BIGSERIAL` column. Postgres allows this, but explicit inserts don't advance the sequence pointer — a live database mixing explicit-id loads with the sequence's own future auto-generated inserts risks a later collision.

Separately, the pilot conflated several genuinely distinct concepts under one hash value: the thing that identifies an entity, the thing used to compute a match candidate, the version of the reconciliation logic that produced a claim, and the mechanism that prevents re-running the same candidate from minting twice. Four different jobs, one field. That conflation is itself a defect this ADR closes.

**Evidence gathered before this ruling (Summit Phase 1, Task B/C prerequisite, per amendment A6):**
- The project's real, already-provisioned Neon Postgres instance (`GRAILKEY_CATALOG_DATABASE_URL`, project `polished-frog-12911134`, discovered in `.env.development.local` — never previously connected to by any prior DATA-0 dispatch) is running **PostgreSQL 18.6**, confirmed via a direct, read-only `SELECT version()`.
- PostgreSQL 18 ships a **native `uuidv7()` function** — confirmed empirically on this exact instance (`SELECT uuidv7()` returned `01a027e8-881d-7884-8628-4d28bf61c39e`, a genuine RFC 9562 version-7 UUID), requiring no extension (`pg_extension` on this instance carries only the default `plpgsql`).
- Node.js (v22.14.0, this project's runtime) has no native UUIDv7 support: `crypto.randomUUID()` produces v4 only, and passing `{ version: 7 }` is silently ignored rather than honored or rejected.
- The target database currently has **zero tables** — `0001_generic_substrate.sql`/`0002_comic_projection.sql` have never been applied anywhere. No live migration history, no historical data to preserve during any cutover.

## Decision

**Ruling 1 — UUIDv7 is the permanent identity scheme**, generated via PostgreSQL 18's native `uuidv7()`, not an application-side implementation, not an extension. Evidence-driven per amendment A6: native generation is available on the real target instance at zero install cost, avoids reimplementing a timestamp+entropy spec in JS, and avoids clock-skew/entropy-quality concerns that come with generating time-ordered IDs across distributed application instances instead of one database.

`gkPublisherId` / `gkSeriesId` / `gkIssueId` / `gkAssetId` (ADR-ASSET-001) all become `UUID` columns, not `BIGINT`. This is a real, acknowledged schema change from `0002_comic_projection.sql`'s original design — not a silent one; it is the entire reason this ADR exists.

**Generation is never a passive column `DEFAULT`.** Even though the underlying primitive is database-native, invoking it is an application-orchestrated act, gated by the mint idempotency check (Ruling 3/A3) — a bare `DEFAULT uuidv7()` on the column would generate a fresh ID on every `INSERT` regardless of whether the candidate already has one, defeating idempotent minting outright. The mint script computes (or requests) the UUID at the exact moment a NEW mint is confirmed, and the `INSERT` supplies it explicitly. This satisfies amendment A6's "app-side generation ⇒ DDL requires explicit UUIDs, no silent v4 defaults" in spirit even though generation is native, not JS-computed: the operative concern A6 names is an uncontrolled default, not the location of the RNG.

**Ruling 2 — four distinct concepts, four distinct fields, never conflated:**

| Concept | What it is | Stability |
|---|---|---|
| **Entity ID** | The `UUID` (`gkIssueId` etc.) — the permanent, external-facing identity of a catalog entity. | Permanent. Never changes once minted, survives merge/split/supersession per Rulings 6–8. |
| **Derivation key** | The canonical, normalized string built from a candidate's AGREED claim values (e.g. `normalizePublisherKey` + `compactTitleKey` + normalized issue number + year) — used to search for an EXISTING match before minting. | Recomputed every time from current claims; not stored as a permanent identity, may change if normalization rules improve. |
| **Reconciliation version** | A version tag on the reconciliation RULES (`identityReconciler.js`'s own logic, or a future formalized version) that produced a given claim's resolution. | Changes when the rules change; lets a rebuild distinguish "this claim was resolved under rule-set v3" from v4, without needing to guess. |
| **Mint idempotency key** | A separate stable key, scoped specifically to "have I already minted for this exact candidate/claim-set" — distinct from the derivation key because two different claim combinations can legitimately derive the same canonical name (e.g. two different sample runs both concluding "Amazing Spider-Man, Marvel, #52, 2021") and must still resolve to one mint, not two. | Stable per mint attempt; consumed by the ledger's own conflict-free check (Ruling 3, A3). |

The DATA-0E pilot's single SHA-256 hash was simultaneously standing in for entity ID AND derivation key AND (implicitly) idempotency key — workable for a one-shot pilot proof, not workable as a permanent scheme once merge/split/re-derivation enter the picture.

**Rulings 3–5 (mint ledger, entity_resolution_event, catalog_entity revision):** field-level design is drafted in Task C (`docs/adr/DATA-0E-FULL-DESIGN-DRAFT.md`), not finalized in this ADR — this ADR states the INVARIANTS the ledger design must satisfy; the concrete schema is a design artifact, not itself a ruling.

**Rulings 6–8 — merge, split, supersession:**
- **Merge** (two previously-separate entity IDs are discovered to describe the same real thing): both original IDs remain permanently resolvable (never deleted, never silently redirected without a record) — a merge event in the mint ledger records old-ID → surviving-ID, and every consumer resolving an old ID must be able to follow that record to the current one. The surviving ID is chosen by an explicit rule (e.g. earliest mint timestamp), never by which process happened to run last.
- **Split** (one entity ID is discovered to actually cover two distinct real things): the original ID is retired from new assignment but never deleted or reused; two new IDs mint, each carrying a back-reference to the ID they split from.
- **Supersession** (a reconciliation rule change causes a DIFFERENT derivation key to now resolve to what was previously a distinct entity): handled as a merge, not a mutation — the OLD entity ID's own row is never edited to silently become the new entity; a new mint ledger event records the relationship.

None of these operations may ever cause an entity ID that has been externally referenced (an `external_map` row, a customer-facing catalog entry, a `gkAssetId`'s identity assignment) to become permanently unresolvable. This is the same append-only, no-silent-mutation discipline `identityReconciler.js`'s own `claim`/`conflict` model already enforces at the facet level (`src/lib/identityReconciler.js`), extended here to the entity-identity level.

## Invariants

1. Drop-and-remint from an unchanged claim set produces byte-identical entity assignments (not necessarily identical raw UUIDs across a full drop, since UUIDv7 generation is not deterministic like the pilot's hash was — see Consequences — but identical RESOLUTION: the same real-world entities map to permanently-resolvable identities, with the SAME external_map/claim linkage, via the mint ledger's own idempotency mechanism, not via the ID value itself being reproducible).
2. No `catalog_entity`/`comic_*` primary key is ever a bare sequence or a bare hash serving double duty as idempotency key.
3. Merge/split/supersession never delete or silently repoint an entity ID with existing external references.
4. Generation of a new UUID never happens without a prior, explicit idempotency check against the mint ledger.

## Consequences

- **A real behavior change from the DATA-0E pilot**: UUIDv7 is not deterministically reproducible from a canonical name the way SHA-256 was — re-running a mint for a genuinely-new candidate produces a DIFFERENT raw UUID each time (this is expected and correct for UUIDv7; RFC 9562 v7 mixes wall-clock time with random bits by design). "Drop-and-remint produces identical IDs" is satisfied at the RESOLUTION level (Invariant 1), not at the raw-bit level — the mint ledger, not the hash function, is what makes rebuilds idempotent going forward. This is a deliberate, evidence-driven trade: the pilot's hash bought raw-bit determinism at the cost of conflating four concepts into one; the permanent scheme buys correct separation of concerns at the cost of needing a real ledger to reproduce resolution.
- `0002_comic_projection.sql`'s `BIGINT` column types are now known-stale; Task C's design draft is additive (a new migration file), never an edit to that historical file (per A5).
- Every future `gkAssetId`/`gkIssueId`/etc. consumer must resolve through the mint ledger or `external_map`, never assume an ID it already holds is still the canonical resolution without checking for a merge/supersession record.

## Rejected Alternatives

- **Keep `BIGSERIAL`, accept non-determinism as a known limitation.** Rejected: directly violates the dispatch's own explicit requirement and this project's standing "trust but verify" discipline — a known-broken invariant left standing is exactly the failure class `THE REBUILD RULE` exists to prevent.
- **App-side (JS) UUIDv7 generation.** Rejected on the evidence: native generation is available at zero cost on the actual target database; app-side would mean either hand-implementing RFC 9562 (real risk of a subtle timestamp/entropy bug, unverified against a spec this project has no prior experience implementing) or adding a new npm dependency, which amendment A6 explicitly forbids doing "to make the design pass."
- **Continue using the DATA-0E pilot's SHA-256 scheme permanently.** Rejected: it structurally conflates four distinct concepts (Ruling 2) and offers no real idempotency mechanism beyond "recompute the same hash" — which breaks the moment two different claim orderings/combinations should resolve to one entity, exactly the N→M scenario Ruling 4/A4 requires handling.
- **UUIDv4 (random, no time ordering).** Rejected: UUIDv7's time-ordered structure gives better index locality for the high-insert-volume `catalog_entity` table and preserves a rough chronological signal in the ID itself; PG18 supports v7 natively at the same cost as v4, so there is no reason to choose the weaker option.

## Implementation Gates

- No `comic_*`/`catalog_entity` table may be created against the real Neon instance until Task C's mint ledger design (Rulings 3–5) is itself reviewed and the DATA-0E-FULL execution plan (A7) is approved — this ADR states the identity invariants, not a green light to migrate.
- Any code path that mints a new entity ID must call through a single, shared minting function that performs the idempotency check before ever invoking `uuidv7()` — no ad hoc `SELECT uuidv7()` call sites outside that function.

## Related Tickets

- GK-107 (cache-key identity coverage, `docs/PATTERN-LIBRARY.md`, GrailKey Directive AE) — the general principle "key on the predicate, never a proxy for it" this ADR's derivation-key/idempotency-key split extends to permanent identity.
- DATA-0E-PILOT (commit `111e620`, relabeled `c55b3e8`) — the proof-of-mechanism this ADR supersedes the SCHEME of, not the mechanism proof itself (determinism/collision/provenance testing methodology carries forward to DATA-0E-FULL).

## Supersession

This ADR supersedes DATA-0E-PILOT's own implicit determinism-scheme decision (stable-hash-to-BIGINT). It does not supersede DATA-0D's crosswalk-validation methodology (comparison tiers, stratified sampling) or the AUTO-MINT/REVIEW/RESIDUAL tier structure, which remain valid and are reused by DATA-0E-FULL. Future reversal of this ADR (e.g. a future Postgres version deprecating `uuidv7()`, or a move off Postgres entirely) must happen via a new ADR — this document is never edited to silently change its own ruling; only a superseding ADR may do that.
