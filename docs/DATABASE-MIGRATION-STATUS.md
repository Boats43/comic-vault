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

## Related documents

- Cross-workstream status board (migration-truth row updated from this pass): `docs/MASTER-BOARD.md`
- GK-167 media-driver routing: `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, "Supporting invariants"
- Migration files (historical, unedited): `db/data0/0001`–`0010`
