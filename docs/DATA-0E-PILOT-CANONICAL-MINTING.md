# DATA-0E-PILOT — The Locked Canonical Minting Contract (Pilot Execution)

> ## STATUS: PILOT / NON-PRODUCTION / NON-BINDING
> **Every ID minted by this execution (commit `111e620`) is SUPERSEDED BY SUMMIT RULING 1 (UUIDv7).** This document, and the artifacts it describes, record a genuine proof-of-mechanism pilot — determinism, collision-freedom, and provenance were proven against a real sample using a stable-hash-to-BIGINT scheme, and that proof stands. But the ID *scheme itself* (SHA-256 → 63-bit signed BIGINT) is **not** the production scheme. The Master Architecture Summit ratified UUIDv7 as the permanent identity mechanism (`docs/adr/ADR-ID-001-permanent-identity.md`). No application code, no downstream tooling, and no future dispatch should treat any `gkPublisherId`/`gkSeriesId`/`gkIssueId` value produced by this pilot as a real, durable identifier. Production minting will re-run in full under DATA-0E-FULL (design drafted, not yet executed — see `docs/adr/`'s Task C artifacts) using the UUIDv7 scheme.
>
> **Blockers found by this pilot, now resolved by the summit:**
> - **ID-1** (this document's own original "DETERMINISM SCHEME" finding — `BIGSERIAL` cannot satisfy "drop-and-remint produces identical IDs"): **RESOLVED-BY-SUMMIT.** See `docs/adr/ADR-ID-001-permanent-identity.md`, Ruling 1 (UUIDv7 as the permanent scheme) and Ruling 2 (entity ID ≠ derivation key ≠ reconciliation version ≠ mint idempotency key — the four-way distinction this pilot's single stable-hash conflated).
> - **ID-2** (this document's own original caveat — explicit-id `catalog_entity` inserts mixed with a live `BIGSERIAL` sequence risk a future collision): **RESOLVED-BY-SUMMIT.** See `docs/adr/ADR-ID-001-permanent-identity.md`, Ruling 1 (UUIDv7 has no sequence to collide with) and the mint ledger design (Rulings 3–4, A3's permanent mint-idempotency mechanism) — a real mint ledger, not raw sequence/hash values, is now the first-party source of identity truth.
>
> The determinism/collision/provenance findings BELOW remain accurate as a record of what this pilot actually did and proved — read them as pilot history, not as the standing scheme.

---

**Scope executed:** mint `gkPublisherId` → `gkSeriesId` → `gkIssueId` for the AUTO-MINT tier population identified by `docs/DATA-0D-CROSSWALK-VALIDATION.md` — the 1,081 `SAME_COMIC` pairs from DATA-0D's own 1,116-issue stratified sample. Printings/variants deferred to post-summit DATA-1, as specified. **Local staging artifacts only. No Neon connection. No production/runtime wiring. No shadow lookup (0F waits for the summit's async-layer design).**

---

## DETERMINISM SCHEME (PILOT-ONLY, superseded) — stable hash, not sequence (stated and defended)

**A real tension was found and resolved, not silently picked around.** `db/data0/0002_comic_projection.sql` (a design-only, never-applied DDL artifact) declares `gk_publisher_id`/`gk_series_id`/`gk_issue_id` as `BIGINT REFERENCES catalog_entity(id)`, and `0001_generic_substrate.sql` declares `catalog_entity.id` as `BIGSERIAL` — an auto-increment sequence. **A sequence cannot satisfy this dispatch's own explicit requirement** ("drop-and-remint produces identical IDs"): its output is a function of insertion order and table state, not of the claims themselves. Two independent mint runs over the identical claim set could assign different numeric IDs to the same logical series/issue purely as a function of which claim record happened to be processed first — parallelism, retry ordering, or a partial rerun would all be able to produce a different result. This is flagged here as a genuine correction needed to DATA-0A's own schema-assumption comment ("Stable IDs … are `catalog_entity.id` under the hood") — for the summit's attention, not edited in that file by this dispatch (out of scope; that DDL belongs to a different, prior dispatch).

**Scheme used:** stable hash, chained through three levels exactly like RFC 4122 UUID v5's own namespace+name construction, truncated to 63 bits instead of emitted as a 128-bit UUID string specifically to stay `BIGINT`-native (matching the existing column type exactly, requiring no schema change):

```
id = SHA-256(canonicalName) → first 8 bytes → u64 → clear sign bit → positive signed-64-bit BIGINT
```

- `gkPublisherId` canonical name: `{CONTRACT_VERSION}|publisher|{normalizePublisherKey(gcd publisher name)}`
- `gkSeriesId` canonical name: `{CONTRACT_VERSION}|series|{gkPublisherId}|{compactTitleKey(gcd series title)}|{gcd series start_year}`
- `gkIssueId` canonical name: `{CONTRACT_VERSION}|issue|{gkSeriesId}|{leading-zero-normalized gcd issue number}|{gcd issue year}`

Each level's own ID feeds the next level's canonical name as its namespace (identical chaining discipline to UUID v5), so a series can never collide across two different publishers even with an identical title, and an issue can never collide across two different series even with an identical number.

**Canonical naming is anchored to GCD specifically, not a blend of both sources.** `docs/DATA-0-ARCHITECTURE.md`'s own framing ("GCD is the catalog spine; Metron is the structured enrichment + crosswalk layer on top of a slice of it") makes GCD's own title/issue-number values the natural canonical key. Metron's differing values (when the AUTO-MINT overlap tier fired — e.g. Metron "Aero-Girl" vs. GCD "The Adventures of Aero-Girl") are recorded as **provenance**, never as a second, competing naming input.

`CONTRACT_VERSION` (`grailkey-0e-v1`) is embedded in every canonical name specifically so a future contract revision cannot silently collide with or overwrite IDs minted under this version — a version bump is how "the contract changed" gets expressed, not a schema migration.

**A second, smaller caveat, also flagged for the summit rather than worked around silently:** the generated SQL artifact inserts explicit `id` values into `catalog_entity` (Postgres allows this — `SERIAL`/`BIGSERIAL` is just a default `nextval()`, explicit values are always accepted) rather than relying on the sequence. A live database mixing explicit-id loads with the sequence's own future auto-generated inserts risks a later collision, since explicit inserts don't advance the sequence pointer. Either a `setval()` catch-up is needed after any explicit-id load, or — cleaner, and consistent with the determinism finding above — the schema's own PK strategy should be revisited at the summit rather than patched around per-load.

---

## MINT COUNTS BY TIER AND STRATUM

| Tier | Count |
|---|---:|
| AUTO-MINT (issues minted) | 1,081 |
| AUTO-MINT (unique series) | 140 |
| AUTO-MINT (unique publishers) | 28 |
| REVIEW (queued, no ID) | 35 |
| RESIDUAL (claims-only) | 2,841 (1,670 "neither" + 1,171 "GCD-only", DATA-0D's full population pulls) |

**AUTO-MINT issues by stratum:**

| Stratum | Minted |
|---|---:|
| pre-1960 \| marvel-dc | 136 |
| pre-1960 \| other | 50 |
| 60s-70s \| marvel-dc | 97 |
| 60s-70s \| other | 83 |
| 80s-90s \| marvel-dc | 81 |
| 80s-90s \| other | 103 |
| 2000s \| marvel-dc | 72 |
| 2000s \| other | 109 |
| 2010s \| marvel-dc | 50 |
| 2010s \| other | 125 |
| 2020s+ \| marvel-dc | 60 |
| 2020s+ \| other | 116 |

**REVIEW queue by convention class** (an automated classifier applied to DATA-0D's own 35 cases — see the fixture file below for the exact per-case breakdown, which differs slightly in class boundaries from the manual read in the DATA-0D doc but sums to the same 35):

| Convention class | Count |
|---|---:|
| `gcd-legacy-parenthetical-numbering` | 15 |
| `gcd-nn-bracket-placeholder` | 10 |
| `gcd-alternate-numbering-axis` | 10 |

---

## DETERMINISM PROOF — double-run identity

The mint script was run twice, as two genuinely independent Node.js processes (not a re-invocation of the same in-memory state):

```
Run 1 SHA-256: 62ab6f1716b7c42b8a2dbaee0abf2d3e51c8d045c22121de7a7c71a42840704c
Run 2 SHA-256: 62ab6f1716b7c42b8a2dbaee0abf2d3e51c8d045c22121de7a7c71a42840704c
diff run1.json run2.json → (empty), exit code 0
```

Byte-for-byte identical output (1,081 `gkIssueId`s, 140 `gkSeriesId`s, 28 `gkPublisherId`s, all matching between runs) confirms THE REBUILD RULE's requirement empirically, not by assertion: dropping and re-minting from the same claim set reproduces the identical ID set.

---

## COLLISION AUDIT — zero duplicate gkIssueIds (and gkSeriesId, gkPublisherId)

| ID space | Total | Unique | Duplicates |
|---|---:|---:|---:|
| `gkPublisherId` | 28 | 28 | 0 |
| `gkSeriesId` | 140 | 140 | 0 |
| `gkIssueId` | 1,081 | 1,081 | 0 |
| Cross-space (all 1,249 IDs pooled) | 1,249 | 1,249 | 0 |

No collision within any single ID space, and no cross-space collision either (a publisher ID never accidentally equals a series or issue ID) — expected given each level's canonical name embeds a distinct literal tag (`publisher`/`series`/`issue`) plus its own namespace chain, but verified directly rather than assumed from the construction alone.

---

## THE 35 REVIEW-TIER FOUNDING FIXTURES

Per the dispatch's own instruction, these become the gate: **`tests/data-0e-pilot-review-tier-numbering-fixtures.test.js`, committed to the real repo test suite** (not local scratch — these gate future code, so they belong where future code will be reviewed against them). Contains all 35 cases verbatim from DATA-0D's own sample, with a `NORMALIZERS` registration point currently empty. Running it now:

```
=== 1 passed, 0 failed, 35 skipped-pending-normalizer ===
```

Same deliberate-stub shape CLAUDE.md already documents for `grailkey-dispatch-33-parity-harness.test.js` — 0 failures is the correct, expected state, not a gap. **Any future normalizer promoting one of the 3 convention classes into AUTO-MINT must make every one of that class's fixtures pass here, all of them, before the promotion is considered proven** — the file's own header spells out the 4-step promotion path.

---

## PROVENANCE

Every minted `gkIssueId` row carries, in its `provenance` field (and mirrored into the `claim`/`external_map` rows in the SQL artifact):
- `contractVersion` (`grailkey-0e-v1`)
- The stratum it was sampled from
- Both agreeing claims verbatim (the GCD row's own series/number/year/publisher, and Metron's own series/number/coverYear/publisher)
- Which comparison tier each facet matched on (`titleMatchTier`: `exact` or `overlap`; `numberMatchTier`: `exact`, `leading-zero-normalized`, or `loose`)

This is a direct, checkable answer to "why does this ID exist" — never a bare number with no evidence trail.

---

## ARTIFACTS

**Committed** (this dispatch):
- `docs/DATA-0E-PILOT-CANONICAL-MINTING.md` — this document
- `db/data0/snapshots/data-0e-pilot-mint-summary.json` — aggregate counts, determinism checksums, collision audit (summary only, matching the DATA-0D precedent of keeping bulk derived data local-only)
- `tests/data-0e-pilot-review-tier-numbering-fixtures.test.js` — the 35 founding fixtures + promotion gate

**Local scratch only** (bulk derived data, not committed, per this project's established convention):
- `C:\grailkey-data\data-0e\mint-output.json` — full mint output, all 1,081 issue rows + 140 series + 28 publishers, each with full provenance (1.1MB)
- `C:\grailkey-data\data-0e\mint-output.sql` — the Postgres-compatible artifact: `catalog_entity`/`comic_publisher`/`comic_series`/`comic_issue`/`claim`/`external_map` INSERT statements matching DATA-0A's schema exactly (1.5MB, 6,839 lines — 2,162 claim rows + 2,162 external_map rows in addition to the typed rows). **Inspected for syntactic correctness, not executed against a live Postgres instance** — no Postgres was provisioned for this dispatch, matching its own "local staging only, not Neon" scope; the GCD staging MySQL container is a different engine and was not used to validate this file.
- `C:\grailkey-data\data-0e\residual-output.json` — the 2,841 RESIDUAL-tier claims-only records (both full populations DATA-0D already pulled)

---

## CONTAINMENT

- **No Neon connection** — not attempted.
- **No production/runtime changes** — zero files under `api/`/`src/` touched (the two `import`s in the mint script, `compactTitleKey`/`normalizePublisherKey`, are read-only function calls against already-shipped code, not modifications to it).
- **No shadow lookup** — 0F is explicitly out of scope, waiting on the summit's async-layer design.
- **Local commit only, push withheld pending explicit ask**, per the dispatch's own instruction.
- **THE REBUILD RULE honored empirically**: the determinism proof above is a real double-run diff, not a design claim.
