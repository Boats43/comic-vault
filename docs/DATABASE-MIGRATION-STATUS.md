# Database Migration Status — live `data1_dev` truth

**Source of authority: a real `information_schema` query against the live database, run 2026-09-01 (D2.1), not the migration files.** Connection sourced from `GRAILKEY_CATALOG_DATABASE_URL` in `.env.development.local`; the connection string itself was never printed (Secret Hygiene, `CLAUDE.md`). Queried `information_schema.schemata`, `information_schema.tables` (all non-system schemas, not `data1_dev` alone), and `information_schema.columns` for the two ALTER-only migrations.

**Live result: two user schemas exist — `public` (0 tables) and `data1_dev` (16 tables).** `public` was checked directly this pass, not assumed empty from prior text.

Never edit `db/data0/*.sql` — this document records what actually ran against the live database, the migration files themselves stay historical and untouched, per the "never modify historical migrations" rule restated at the top of every file in `db/data0/`.

## Table-by-table status

| Migration file | Declares | Live status | Detail |
|---|---|---|---|
| `0001_generic_substrate.sql` | `asset_class`, `catalog_entity`, `facet`, `ingestion_run`, `source_snapshot`, `claim`, `external_map`, `alias` (8) | **NOT APPLIED** (8 of 8) | None of the 8 exist in `public` or `data1_dev`. |
| `0002_comic_projection.sql` | `comic_publisher`, `comic_series`, `comic_issue`, `comic_printing`, `comic_variant`, `comic_creator`, `comic_issue_creator`, `comic_variant_creator` (8) | **NOT APPLIED** (8 of 8) | None of the 8 exist in `public` or `data1_dev`. |
| `0003_uuidv7_identity_and_mint_ledger.sql` | `entity_mint_basis`, `basis_supersession`, `mint_event`, `entity_resolution_event`, `entity_resolution_member` (5) | **PARTIAL** (2 of 5) | `entity_mint_basis` and `mint_event` are live — in `data1_dev`, **not** `public`. `basis_supersession`, `entity_resolution_event`, `entity_resolution_member` are NOT APPLIED anywhere. |
| `0004_data1_foundation.sql` | `gk_principal`, `gk_organization`, `gk_membership`, `gk_asset`, `ownership_event`, `current_owner`, `custody_event`, `media`, `asset_identity_assignment`, `acquisition_event`, `condition_observation`, `valuation_event`, `decision_event`, `domain_event`, `outbox` (15) | **PARTIAL** (11 of 15) | Live in `data1_dev`: `gk_principal`, `gk_asset`, `ownership_event`, `current_owner`, `media`, `asset_identity_assignment`, `acquisition_event`, `valuation_event`, `decision_event`, `domain_event`, `outbox`. NOT APPLIED: `gk_organization`, `gk_membership`, `custody_event`, `condition_observation`. Already correctly anticipated in code — `src/modules/assets/repository.js:14-21`'s own comment names these same 4 tables as never-applied; this pass is the first *live-query* confirmation of that comment, not a new discovery. |
| `0005_data1b_idempotency.sql` | `idempotency_key` (1) | **APPLIED** | Live in `data1_dev`. |
| `0006_outcome_ledger.sql` | `outcome_event`, `asset_outcome_current` (2) | **NOT APPLIED** (2 of 2) — **by design** | The file's own header states "DESIGN DRAFT, NOT APPLIED... Not applied to `data1_dev` or any database as part of this dispatch." Live result matches that stated intent exactly — not a gap. |
| `0007_capture_integration_linkage.sql` | `collection_item_link` (1) | **APPLIED** | Live in `data1_dev`. |
| `0008_principal_credential.sql` | `principal_credential` (1) | **APPLIED** | Live in `data1_dev`. |
| `0009_media_content_type.sql` (ALTER `media`) | adds `content_type` column | **APPLIED** | `information_schema.columns` confirms `data1_dev.media.content_type` exists. |
| `0010_idempotency_request_fingerprint.sql` (ALTER `idempotency_key`) | adds `request_fingerprint` column | **APPLIED** | `information_schema.columns` confirms `data1_dev.idempotency_key.request_fingerprint` exists. |

**Live table count reconciles exactly:** 2 (0003) + 11 (0004) + 1 (0005) + 1 (0007) + 1 (0008) = **16**, matching the live `data1_dev` table count precisely. No unaccounted table exists in either schema.

## Design-snapshot claim not fully reproduced by the live schema

`db/data0/snapshots/data-1-foundation-slice-summary.json` states the isolation guarantee as "data1_dev is additionally isolated at the schema level from the empty `public` schema 0001-0003 target" — i.e., the design intent was for 0001–0003 to land in `public`. The live result only partially matches that: `public` is confirmed empty (correct for 0001/0002, which never ran anywhere), but 0003's two applied tables (`entity_mint_basis`, `mint_event`) actually live in `data1_dev`, not `public`. Recorded as a contradiction between stated design intent and live outcome, not silently resolved in either direction — the design doc is not edited to match, and the live schema is not treated as wrong.

## Reconciling the "13-of-17 vs 11-of-15" claim

`docs/MASTER-BOARD.md`'s prior "Migration truth" row asserted: *"the repository audit already reconciled a 13-of-17-vs-11-of-15 applied-migration discrepancy once before — see the dispatch's own D2.1 framing."*

**Checked directly: `"13-of-17"` and `"11-of-15"` both appear in this repository in exactly one place — that single MASTER-BOARD sentence.** No ticket, dispatch, ADR, or prior doc anywhere in `docs/`, `CLAUDE.md`, or `db/` contains either figure. "See the dispatch's own D2.1 framing" is self-referential — it points at the very D2.1 pass this document *is* — so there is no independent prior source to reconcile against.

What the live D2.1 result actually shows:
- **"11-of-15" is real and reproduced exactly** — that is `0004_data1_foundation.sql`'s own applied-table count, confirmed live above.
- **"13-of-17" does not correspond to any table-scope interpretation this pass could construct.** Combining 0003+0004 (5+15=20 declared, 2+11=13 applied) gives "13-of-20," not "13-of-17." No other grouping of the migration files' declared tables produces a 17-declared denominator with a 13-applied numerator.

**Conclusion: "13-of-17" is not verified by this pass and has no other citation anywhere in the repository to verify it against.** Recorded here as an open contradiction for review, per the Protocol's own governance rule ("that conflict is recorded as a contradiction for review... not resolved silently in either direction") — not deleted, not silently corrected, not asserted as true. The only migration-count figure this document actually stands behind is the live, table-by-table result above.

## D2.4 — Real Neon restore/PITR drill: **PASS** (2026-09-01, operator-executed)

**Capability gap closed.** The prior blocker (no `neonctl`, no `NEON_API_KEY`, no MCP Neon-management tool, Vercel CLI's `integration`/`storage` subcommands not exposing branch-level restore) is a *scripted-access* gap, not a capability gap — per the D2.4 capability-vs-access review, the Neon Console itself (reachable from Vercel Dashboard → `comic-vault` → Storage → `grailkey-catalog` → "Open in Neon," no separate API key) already exposes the real, non-destructive restore mechanism. Jimmy performed the drill directly in Console.

**Drill record (operator-attested — executed via Neon Console UI, which this session has no access to and could not independently observe; the source/scratch-branch mechanics below are Jimmy's report, not re-verified live by this session):**

| Field | Value |
|---|---|
| Neon plan (as shown in Console) | **Free** |
| History/restore window (as shown in Console) | **6 hours** |
| Branch capacity | 1/10 before the drill, 2/10 during (scratch branch deleted after — back to 1/10) |
| Mechanism used | Console → Branches → **New Branch** → data source = **"Branch data and schema from a past point in time"** (the non-destructive, copy-on-write path — not "Instant Restore," which mutates the parent's head in place) |
| Parent/source branch | `main` |
| Restore point | 2026-09-01, 7:04 PM America/Phoenix |
| Scratch branch | `d2-4-scratch-restore-proof` (deleted after verification) |
| Known asset row, recovered branch | `gk_asset.id = 01a02d23-1acb-72e8-aae3-8f851308e9cf`, `asset_class=comic`, `status=active` — 1 row |
| Known media row, recovered branch | `media.id = 01a02d23-2809-7024-9312-d45bb5003014` — 1 row |
| `object_uri` preserved on recovered branch | `https://elu7tmuzwfjot0pk.private.blob.vercel-storage.com/sha256/81/811a86380961a7dd4a2096f58bf112294eb3b7c521dbb3e61c6f8d59014b9d63` — matches the value this document's D2.1 pass already confirmed live |

**Independently verified by this session (the one part that doesn't require Console access):** re-ran the same two lookups against the live `main`/`data1_dev` connection immediately after the reported drill — both rows unchanged (`asset_class=comic`/`status=active`; the same `object_uri`), and `data1_dev`'s table count still 16. This corroborates "additive/copy-on-write, `main` was not restored or mutated" with independent evidence from this session, on top of the operator's own report — the scratch-branch creation/deletion steps themselves remain operator-attested only, since this session has no Neon Console or API access to observe them directly.

**No new Neon credential was created or requested to close this.**

## Durability risk — pre-D6 gate (added at D2.4 closure)

**6-HOUR RESTORE WINDOW — OPEN / PRE-D6 GATE.** The drill above proves the *mechanism* works — it does not establish that a 6-hour history window is *adequate* for permanent physical-asset custody. A real capture written more than 6 hours before an incident is discovered would fall outside Free plan's restore window entirely (Launch extends this to 7 days, Scale to 30 — see Section 1 of the D2.4 capability review, 2026-09-01, for sourced detail). This is recorded as an **operational durability threshold requiring a later ruling**, not a mandate to purchase a paid plan now — no plan change is recommended or implied by recording this gate.

**Gate: before D6 (flag-gated production capture), the retention-window requirement for permanent GrailKey asset custody must be explicitly ratified** (stay on Free with a documented acceptance of the 6-hour exposure window, or move to a paid tier with a longer window) — this is now a pre-D6 gate alongside the existing Production/Development isolation gate, not a preference.

## D3.2 — event-time audit, and `entity_mint_basis` row-provenance classification (Amendment A4)

### Event-time audit (D3.2, 2026-09-02)

Every writer in `src/modules/assets/repository.js`, for every one of the 7 in-scope tables (`ownership_event`, `acquisition_event`, `valuation_event`, `decision_event`, `domain_event`, `media`, `asset_identity_assignment`), was individually checked — not generalized from one to the rest. **FACT, uniform across all 7:** every INSERT statement omitted the existing occurrence-shaped column (`occurred_at`/`captured_at`/`assigned_at`) from its column list, relying exclusively on that column's own `DEFAULT now()`. Readers (`repository.js`'s `getAssetGraph`) use the column only for chronological `ORDER BY`, never with occurrence-specific interpretation. **Conclusion: every one of these columns has, in the live code, always functioned as `recorded_at` (persistence time), never as a genuinely asserted `occurred_at`.** No table in this set showed different behavior — the audit found one uniform pattern, not a per-table variance requiring a stop.

Out-of-scope tables, with reasoning (not oversight): `entity_mint_basis.created_at`/`mint_event.occurred_at` (0003) — minting IS the event, no real-world occurrence distinct from its own recording; `collection_item_link.linked_at` (0007) — a pure routing edge, not a domain event; `outbox.created_at`/`processed_at` (0004) — queue mechanics, already honestly named; `gk_asset`/`gk_principal`/`gk_organization.created_at` (0004) — entity-row creation metadata, not `_event` tables; `custody_event`/`condition_observation`/`gk_organization`/`gk_membership` — not live (confirmed absent from `data1_dev`, D2.1).

Migration: `db/data0/0011_d3_2_event_time.sql` — for each of the 7 tables, renames the existing column to `recorded_at` (meaning unchanged, name now honest) and adds a new, nullable `occurred_at` (no default — omitted on insert means NULL, never "now"). No `CHECK (occurred_at <= recorded_at)` or equivalent — chronological inconsistency is legal, evidence for review, never schema invalidity. Phase A real-DB proof (isolated, self-dropped scratch schema, actual 0011 SQL text, actual `repository.js` functions): `tests/d3-2-true-event-time-live-roundtrip.test.js`, 30/30.

### D3.2 Phase B — APPLIED to `data1_dev` (2026-09-02)

**Recovery anchor:** `2026-09-02T03:29:11Z` UTC / `2026-09-01 8:29 PM MST` (America/Phoenix, no DST). Neon project `polished-frog-12911134`, source branch `main`, target schema `data1_dev`.

**Rollback, written and validated BEFORE the forward migration ran:** `db/data0/0011_d3_2_event_time_rollback.sql` — the exact inverse (`DROP COLUMN occurred_at` then `RENAME COLUMN recorded_at TO <original>`, per table). Validated for real: applied forward `0011`, then the rollback, against an isolated scratch schema — `information_schema.columns` confirmed byte-identical to the pre-forward-migration snapshot.

**Forward migration:** applied verbatim (no hand-editing; the applied text confirmed byte-identical to the committed `bd2ded8` version via `git show` diff before running) — start `2026-09-02T03:30:17.839Z` UTC, end `2026-09-02T03:30:17.900Z` UTC (61ms).

**Pre-migration evidence captured:** full `information_schema.columns` snapshot for all 7 tables; row counts (`ownership_event` 124, `acquisition_event` 20, `valuation_event` 78, `decision_event` 33, `domain_event` 378, `media` 42, `asset_identity_assignment` 80); 3 representative historical-timestamp samples per table (21 rows total), exact ISO values recorded for byte-for-byte post-migration comparison. Quarantine and `DATA-0E-FULL` confirmed unchanged immediately before.

**Post-migration verification: 78/78 checks passed** (per-table: `recorded_at` exists, `occurred_at` exists/nullable/no-default; no chronology `CHECK` constraint anywhere in `data1_dev`; all 21 sampled historical rows' `recorded_at` byte-exact match to their pre-migration value; all 21 corresponding `occurred_at` values NULL; all 7 row counts unchanged).

**Application wiring shipped:** `src/modules/assets/repository.js` (7 writers + `getAssetGraph`'s `ORDER BY`) and `service.js` (8 public functions) now thread an optional `occurredAt` through to `occurred_at`, defaulting to `null` — never `now()`, never inferred. **Live proof, real functions, real `data1_dev`:** `tests/d3-2-application-wiring-live-proof.test.js`, 10/10 — past `occurredAt` (C), omitted → NULL (D), future `occurredAt` accepted (E), legacy call with no `occurredAt` param at all (F), no chronology rejection (G), full cleanup with count verification (I). D3.1's own live regression re-run clean after this change (H, 9/9) — confirmed no interaction between the two information contracts.

### `entity_mint_basis` row-provenance classification (Amendment A4)

Per the explicit ruling that "existing timestamp = insertion time" (and, separately, "these rows are production data") are hypotheses requiring independent proof, not assumptions — all 110 `basis_namespace='asset:capture-event'` rows' `mint_event.candidate_snapshot` shapes were individually inspected (not inferred from row count or table presence alone):

| Classification | Count | Evidence |
|---|---|---|
| **CONTROLLED PROOF/TEST ARTIFACT** | 97 | Explicit non-production marker in the row's own data: `{test,ts}` (76), `{basisKey,...,variant}` carrying literal `"s3-1"`-style dispatch-phase labels (9), `{note:...}` (6), `{probe,...}` (4), bare `{issue,title,year}` with no session metadata at all (2) |
| **CONFIRMED PRODUCTION** | 1 | The real Creepy #1 capture (`gkAssetId 01a02d23-1acb-72e8-aae3-8f851308e9cf`) — corroborated independently by CLAUDE.md's own documented production smoke-test chain (real HTTPS auth flow, SHA-256 byte-identical to a real photographed source, D2.4's live-verified Blob object) |
| **UNKNOWN** | 12 | Realistic capture-shaped payloads (real book titles/issues, real `correlationId`/`scanlogKey` session metadata, in some cases real `photoContentHash`) with no explicit fixture marker and no independent corroboration either way — plausibly genuine development-phase rehearsal captures of real physical books, or a proof script simply omitting a marker; not resolved by durable evidence available this pass |

**Classification: MIXED PROVENANCE.** The known live row count (110, or the 378 `domain_event` rows, etc.) is explicitly **not itself proof of production provenance** — the vast majority of `entity_mint_basis` rows are proof-script artifacts, evidenced by markers embedded in the data itself, not inferred from mere presence in `data1_dev`.

**Correction to the D3.1 record (`2dce8bd`, KEPT per ruling — not amended):** that commit's test-file header claimed `buildCaptureBasis` "has never been the writer of any of the 110 real entity_mint_basis rows." This is **false**, discovered during this D3.2 provenance audit: exactly 3 of 110 rows carry `buildCaptureBasis`'s own exact output shape (`{namespace,key,book,correlationId,scanlogKey}`, `namespace:'asset:capture'`) — one of which is the confirmed-production Creepy #1 row. D3.1's original claim was based on sampling only the 3 earliest rows (all pre-dating `buildCaptureBasis`'s existence), generalized incorrectly to all 110 without checking the rest. This does not change D3.1's shipped code (the byte-compatibility proof compared the function's own before/after behavior, which remains valid regardless of live-row count) — only the prose claim about live usage was wrong, and is corrected here rather than silently left standing. No destructive cleanup of any row was performed as part of discovering this — per Amendment A4, provenance discovery is not itself grounds for cleanup; any cleanup requires a separate ruling.

## D3.3 Phase A — durable comp snapshots (PROPOSED, NOT applied to `data1_dev`)

Migration: `db/data0/0012_d3_3_comp_snapshot.sql` — one new, additive table, `comp_snapshot` (`id`, `asset_id` → `gk_asset`, `source`, `payload JSONB`, `content_hash`, `recorded_at`, `recorded_by_principal_id`). Deliberately NOT D5's `MarketObservation`/`MarketPopulation`/`EconomicProjection` architecture — `payload` is one opaque JSONB blob, no comic-specific column anywhere in the table.

**Immutability — stronger than this schema's existing convention-only pattern.** Every other append-only table in `db/data0/` relies on "no `repository.js` function issues UPDATE," spot-checked, not DB-enforced. `comp_snapshot` adds **real DB-enforced immutability**: `BEFORE UPDATE`/`BEFORE DELETE` triggers that raise a real exception. Live-proven, not asserted: a direct `UPDATE`/`DELETE` against a real row in an isolated scratch schema was genuinely rejected by Postgres, not merely unattempted.

### R1 (Phase A review) — the valuation → snapshot relationship, amended before any live application

**Finding, live-audited before drafting the fix:** `valuation_event.comp_snapshot_ref` (0004, nullable `TEXT`) already carries live values in `data1_dev` — of 78 `valuation_event` rows, 10 are non-null, in two shapes, **neither resolvable to durable evidence**: 8 rows are the literal placeholder string `"snap-ref-1"` (a pre-existing fixture, resolves to nothing), 2 rows are `"scanlog:<correlationId>"` (a real pointer into the Upstash Redis KV scanLog cache — a different persistence layer entirely, no durability guarantee, may already be expired). Reusing this same column for a new durable reference would have made it three-ways ambiguous.

**Fix, applied to `0012` before any live application (never applied, so amending the same file was correct — no `0013`):** a new, dedicated, additive column, `valuation_event.comp_snapshot_id UUID REFERENCES comp_snapshot(id)`, nullable, indexed. `comp_snapshot_ref` is completely untouched (its existing scanlog/fixture usage is out of this migration's scope). The FK constraint plus `comp_snapshot`'s own immutability trigger together give a real, enforced guarantee: once `V1` references `S1`, `S1` can never be deleted (FK) and can never be mutated (trigger) — not a documented convention, a database-enforced invariant.

**Rollback amended in step:** `db/data0/0012_d3_3_comp_snapshot_rollback.sql` now drops `valuation_event.comp_snapshot_id` first (removing the FK) before dropping the triggers/function/table, in FK-safe order.

### R2 (Phase A review) — temporal evidence inside the payload

`comp_snapshot.recorded_at` is GrailKey persistence time **only** — it was never intended, and is now explicitly documented, to represent the underlying market evidence's own occurrence time. `comp_snapshot` has **no `occurred_at` column at all**, by design: a single evidence set legitimately contains items from different real-world times (a sold listing from one date, an active listing observed on another) — collapsing them into one snapshot-level occurrence timestamp would manufacture semantics the evidence doesn't actually have. Live-proven, not merely designed: a payload containing three items with three different `soldDate`/`listingDate` values (one item deliberately carrying no `listingDate` at all) round-trips byte-for-byte through the immutable `payload` column — nothing is dropped, nothing is normalized, absence of a field is preserved as absence. `recorded_at` was confirmed, in the same test, to never equal or derive from any of those per-item dates.

**Rerun proof (`tests/d3-3-comp-snapshot-immutability.test.js`, now 23/23, isolated scratch schema, `data1_dev` untouched):** A (persist + read back, `isDeepStrictEqual` — not naive `JSON.stringify` equality, since Postgres JSONB reorders object keys on storage, confirmed directly: a real round-trip returned `{price,title,source}` for a row written as `{title,price,source}` — values/structure unchanged, key order is not preserved by JSONB itself); B (a real `UPDATE` and a real `DELETE` against a referenced snapshot were both rejected by the trigger); C (repricing produces a genuinely new snapshot row, distinct `id`); D (old snapshot row remains readable, exact payload, after the new one is written); E (`asset_id` identical across snapshots); **R1** (a valuation can reference a real snapshot; a dangling reference to a non-existent snapshot is rejected by the FK at write time; a snapshot already referenced cannot be deleted; the reference is never silently nulled); **R2** (rich multi-date payload round-trips exactly; `recorded_at` is persistence-time only; no `occurred_at` column exists). Rollback rehearsal re-run and re-confirmed clean.

**WAL measurement re-run after the R1 amendment (`tests/d3-3-wal-measurement.test.js`):** figures reproduced essentially identically to the original run (steady-state medians unchanged: SMALL 1616, NORMAL 1480, LARGE 3504 WAL bytes) — the added FK column on `valuation_event` has no measurable effect on `comp_snapshot`'s own insert cost, since the measured inserts write only to `comp_snapshot`.

## D3.3 Phase B — APPLIED to `data1_dev` (2026-09-02)

**Recovery anchor:** `2026-09-02T04:18:26Z` UTC / `2026-09-01 9:18:26 PM MST` (America/Phoenix, no DST). Neon project `polished-frog-12911134`, source branch `main`, target schema `data1_dev`. Committed migration SHA-256 (`db/data0/0012_d3_3_comp_snapshot.sql` at `d48f32f`): `74a539fbf8b045c5314beb65951241504bc983772105e013dd04347ed061098a` — verified byte-identical to the working-tree file actually executed (`git show d48f32f:... | diff`) before running.

**Pre-migration evidence:** `valuation_event` 78 rows; `comp_snapshot_ref` population unchanged from R1's audit (8× `"snap-ref-1"`, 2× `"scanlog:ff4eb86c-..."`); `comp_snapshot` table and `valuation_event.comp_snapshot_id` column both confirmed absent (`to_regclass()` null / zero `information_schema.columns` rows) immediately before applying. Quarantine and `DATA-0E-FULL` confirmed unchanged.

**Forward migration:** applied verbatim, no hand-editing — start `2026-09-02T04:19:07.482Z` UTC, end `2026-09-02T04:19:07.666Z` UTC (184ms). Rollback (`db/data0/0012_d3_3_comp_snapshot_rollback.sql`, R1-amended) not needed — no incident.

**Post-migration schema proof: 14/14.** `comp_snapshot`: exactly the 7 designed generic columns (no comic-specific field), both triggers + the trigger function present, `recorded_at` still `NOT NULL DEFAULT now()`, both indexes present. `valuation_event.comp_snapshot_id`: present, nullable, FK-linked to `comp_snapshot(id)`, indexed. **All 78 pre-existing `valuation_event` rows confirmed `comp_snapshot_id IS NULL`** — no manufactured historical linkage. `comp_snapshot_ref` population confirmed byte-identical to pre-migration (still the same 8+2 non-durable values, completely untouched).

**Application wiring** (`src/modules/assets/repository.js`, `service.js`, `index.js`): new `insertCompSnapshot`/`recordCompSnapshot` (persist-only — the DB trigger is what actually enforces immutability, this function issues nothing but INSERT). `insertValuationEvent`/`recordValuation` gain an explicit `compSnapshotId` parameter — never inferred from `compSnapshotRef`, a Redis/scanlog key, a correlationId, or any other value; caller-supplied only, optional (a valuation with no durable evidence, e.g. `operator-override`, legitimately omits it). `capture/mapping.js` (the legacy `comp_snapshot_ref` writer) is **completely untouched**.

**Live contract proof, real functions, real `data1_dev`: `tests/d3-3-phase-b-live-contract-proof.test.js`, 31/31** — A (persist S1, exact read-back), B (V1 durably resolves to S1 via a real JOIN), C (a nonexistent snapshot UUID rejected by the FK, through the real application path), D (real trigger rejects UPDATE and DELETE of S1), E (repricing → S2 ≠ S1, V2→S2 independent of V1→S1), F (S1/V1 remain exactly readable/resolvable after S2/V2), G (`gkAssetId` unchanged throughout), H (multi-item temporal evidence — including one item's genuinely absent optional field — round-trips exactly; `recorded_at` proven independent of every per-item date), I (`comp_snapshot_ref` never populated or required by the new linkage), J (all 78 pre-existing rows re-confirmed `NULL`), K (cleanup — see below).

**K — retained controlled test artifacts (comp_snapshot is genuinely DELETE-protected — a real trigger, not a convention, so this is a structural consequence of the invariant just proven, not a bookkeeping gap):**

| Table | Before | After | Delta | Disposition |
|---|---|---|---|---|
| `gk_asset` | 110 | 111 | +1 | **Retained** — pinned transitively: `comp_snapshot.asset_id` FK-references it, and `comp_snapshot` can never be deleted |
| `entity_mint_basis` | 110 | 111 | +1 | **Retained** — pinned transitively: `gk_asset.mint_basis_id` FK-references it, and `gk_asset` (above) can never be deleted |
| `comp_snapshot` | 0 | 2 | +2 | **Retained** — the real immutability trigger this proof exists to demonstrate; `DELETE` was attempted and genuinely rejected |
| `valuation_event`, `ownership_event`, `current_owner`, `mint_event`, `domain_event`, `outbox`, `idempotency_key` | — | — | 0 | Fully cleaned — nothing pins these, all test rows removed |

Exact retained IDs (real, live, this dispatch, 2026-09-02 — not production data): `gk_asset.id` and `entity_mint_basis.id` for the one test asset minted this pass; `comp_snapshot.id` ×2 (S1, S2). Attempting `DELETE` on `gk_asset`/`entity_mint_basis` was tried and genuinely rejected by their own FK constraints (proven, not assumed) — reported honestly as a non-zero delta, never claimed byte-identical.

**Regression re-confirmed after wiring:** WAL measurement re-run (`tests/d3-3-wal-measurement.test.js`) — steady-state medians reproduced (SMALL 1616, NORMAL 1504–1480, LARGE 3504); one `NORMAL` sample this run read 9752 bytes, a real observed instance of the method's own disclosed background-write-contamination limitation (the LSN is database-wide) — the median-based reporting already in use was unaffected by this single outlier. D3.2 application-wiring live proof 10/10, D3.1 mint-basis live regression 9/9, both re-run clean after this change.

### Amendment A3 / E3 — logical vs. WAL/change-history byte measurement

**Method (MEASURED, not estimated):** `pg_current_wal_lsn()` is callable by this role (`neondb_owner`; gated by `rolreplication=true`, not superuser — confirmed directly). Captured immediately before/after a single-row `INSERT` transaction; `pg_wal_lsn_diff()` gives the byte delta. **Limitation, disclosed:** this LSN is database-wide, not per-transaction — any concurrent write during the window would contaminate the result. **Controls:** a no-write LSN delta was sampled 3× immediately before measuring (result: `0, 0, 0` bytes — no background noise detected this run, but that is a property of this idle dev database during this run, not a guarantee the method itself provides). Each payload size measured 5× **after priming** (20 throwaway inserts, to warm pages past Postgres's one-time full-page-image WAL cost on a table's first writes — real effect, separately measured: a cold first insert of the SMALL payload cost 2208 WAL bytes vs. its own steady-state median of 1616).

Representative payloads sized off this repo's own documented comp-pool conventions (`CLAUDE.md`): SMALL = the thin-pool floor (`MIN_POOL_FOR_OVERRIDE=3`, GK-34), NORMAL = a typical resolved pool (20 comps), LARGE = the eBay Browse API's own stated cap (`limit=100`).

| Size | Evidence items | Logical payload bytes | WAL bytes (steady-state median, 5 samples) | Label |
|---|---|---|---|---|
| SMALL | 3 | 829 | 1616 (samples: 1616, 1616, 1752, 1616, 1640) | MEASURED |
| NORMAL | 20 | 5310 | 1480 (samples: 1480, 1480, 1480, 1480, 1536) | MEASURED |
| LARGE | 100 | 26397 | 3504 (samples: 3480, 3480, 3504, 3616, 3712) | MEASURED |

**Non-obvious real finding:** WAL bytes do **not** scale with logical payload size the naive way — NORMAL's WAL (1480) is lower than SMALL's (1616). This is genuine Postgres write-amplification behavior (index writes on both `asset_id`/`content_hash`, transaction/commit metadata, and — for LARGE — TOAST compression of the >2KB JSONB value, which is why LARGE's WAL only ~2.4× NORMAL's despite ~5× the logical bytes), not a measurement error. **Logical row bytes alone would have been the wrong estimate for Neon recovery-history consumption** — exactly the distinction this addendum required.

**1 GB projections (two distinct, per the ruling — the second governs the pre-D6 retention question):**

| Size | Logical-storage projection (snapshots per 1 GB) | Change-history/WAL projection (snapshots per 1 GB) |
|---|---|---|
| SMALL | ~1,295,225 | ~664,444 |
| NORMAL | ~202,211 | ~725,501 |
| LARGE | ~40,676 | ~306,433 |

**The pre-D6 durability-risk ruling (`docs/MASTER-BOARD.md`, "Durability risk — 6-hour restore window") should use the WAL/change-history column, not the logical-storage column** — that is what actually consumes Free plan's 1 GB change-history budget (Section 1, D2.4 capability review). At LARGE (the eBay Browse API's own 100-comp cap), ~306K snapshot writes would be needed to exhaust the 1 GB budget from `comp_snapshot` writes alone.

**Stated precisely, per ruling: this is currently not a near-term dominant threat to the pre-D6 restore window, on the measured D3.3 snapshot-write evidence above — not a global database guarantee.** `comp_snapshot` is one write class among others in `data1_dev` (the 7 event/evidence tables D3.2 already touches, plus everything else the kernel writes); total system WAL consumption depends on all of them together, not this one table in isolation. This measurement establishes the mechanism and its real order of magnitude for `comp_snapshot` specifically — it does not claim to bound the database's total change-history consumption.

**No measurement pollution:** all measurement ran against a self-dropped isolated scratch schema; `data1_dev` was never written to for this purpose.

## `entity_mint_basis` — live-vs-design contradiction (found D4 Phase 0, 2026-09-02)

**Recorded as a contradiction, per this document's own standing rule (see the "Design-snapshot claim not fully reproduced" section above) — not silently reconciled in either direction. `db/data0/0003_uuidv7_identity_and_mint_ledger.sql` is not edited.**

- `0003`'s own header text (`0003:11-19`) states, at design time: *"SCOPE, corrected in review... catalog permanent identity ONLY... gk_asset and asset_identity_assignment ... do NOT belong in this file."*
- **Live implementation contradicts that scope statement.** `src/modules/assets/repository.js:36-61` (`mintAsset`) generates one UUID and writes it as both `entity_mint_basis.entity_id` and, on a fresh mint, `gk_asset.id` (`repository.js:60`) — the same value. In live usage, `entity_mint_basis.entity_id` resolves to `gk_asset.id`, never to a `catalog_entity.id`.
- **`catalog_entity` does not exist in the live schema at all** — confirmed above (`0001_generic_substrate.sql` NOT APPLIED, 0 of 8 tables). `entity_mint_basis`'s `entity_id` column has no real target it could point at on the catalog side even if it wanted to.
- `mintAsset` has exactly one live call site (`service.js:113`, inside `createPhysicalAsset`) — `entity_mint_basis` is, in actual live use, 100% physical-asset-side mint-idempotency, 0% catalog-side, the opposite of its 0003 design-time scope statement.
- **Ruled (D4 Schema Ruling dispatch, 2026-09-02, `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md`, Ruling 1): `entity_mint_basis` is preserved exactly as-is, as mint-idempotency only — this contradiction is not "fixed" by moving the table, retyping `entity_id`, or editing `0003`.** It is recorded here so a future reader querying live schema truth sees the design-vs-live gap explicitly, the same way the "13-of-17 vs 11-of-15" and "0001-0003 target public" contradictions above are recorded rather than papered over.

## Operational note — pooled connection string loses session-scoped state mid-run (found D4 A6/A7 concurrency proof, 2026-09-02)

**FACT.** During the D4 A6/A7 real two-connection concurrency proof (`docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md`, Ruling 19), the pooled connection string (`GRAILKEY_CATALOG_DATABASE_URL`) was observed silently losing session-level `SET search_path` state between statements issued from the *same* client object — a later statement resolved a table name against a stale, previous scratch schema instead of the one just set on that same connection. The unpooled connection string (`GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED`) preserved the required session semantics correctly and was used for the concurrency proof once this was caught.

**Operational rule:** multi-statement work that depends on session-scoped PostgreSQL state must use the unpooled connection string. Explicit examples: migrations, scratch-schema proofs, transactional test harnesses, or any future operation relying on `SET`, temporary session state, or other connection-local behavior.

**Not generalized further.** This is a recorded session-state hazard and its operational consequence — not a claim that pooled connections are broken, and not a claim about any other property of the pooler. Simple, single-statement, or already-schema-qualified queries are unaffected by this finding.

## D4 Phase A — Identifier Fabric (PROPOSED, NOT applied to `data1_dev`)

Migration `db/data0/0013_d4_identifier_fabric.sql` — four new additive tables (`asset_identifier`, `asset_raw_observation`, `asset_identifier_assertion`, `asset_identifier_assertion_evidence`), zero `ALTER` statements against any existing table. Ratified: `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md`. Rollback: `db/data0/0013_d4_identifier_fabric_rollback.sql`. SHA-256, both files, final proposed bytes: forward `e522de5097fec2e72bea5d45dd96586b42068ab8bf6e5664ca3dd7160a5b5e4d`, rollback `36a7e76338ff177755ad14b843d18502bd40151fcff2572a91ff7b8cece9cf87`.

**Real, isolated-scratch-schema proof, not applied to `data1_dev`:** `tests/d4-identifier-fabric-migration-contract.test.js` (67/67) — reads the real forward/rollback SQL from disk, applies verbatim, proves canonical uniqueness (incl. manufacturer-serial issuer-sensitivity, `UNKNOWN` sentinel, GTIN/ISBN canonical-value collision), all 7 scopes, full immutability audit across all four tables, `CORROBORATED` cardinality permissiveness (0/1/2+ evidence links all legal), convergent supersession, `gkAssetId` invariance across every operation, and identifier multiplicity in both directions — then rehearses rollback (all 4 tables removed, prerequisite substrate preserved), reapplies the identical bytes, and re-runs a critical subset. `tests/d4-identifier-fabric-concurrency.test.js` (7/7) — real two-connection race against the actual proposed trigger (not a hand-built approximation): `bothCommitted=false`, `cycleFormed=false`, confirmed; convergent supersession re-confirmed against the real trigger. `data1_dev`'s four D4 table slots confirmed `null` before and after every proof run.

**Phase B (applying `0013` to `data1_dev`) remains a separate, not-yet-authorized step, gated by the same recovery-anchor sequence D3.2 established.** No application wiring exists or is proposed by this pass.

## Related documents

- Cross-workstream status board (migration-truth row updated from this pass): `docs/MASTER-BOARD.md`
- GK-167 media-driver routing: `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, "Supporting invariants"
- Schema/Application Sequencing Invariant, Foundation Law 3 status: `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`
- Migration files (historical, unedited): `db/data0/0001`–`0012`
