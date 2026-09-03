# D5B Live-Apply Gate + GK-188

**Design commit:** `d587585` (0015 design + scratch proof, later split — see below)
**This dispatch:** GK188-0 → A1 → A2 → GK-188 → live-apply authorization → controlled migration → post-apply verification

## GK188-0 — correctIdentity closure lifecycle contract

Traced directly, not inferred from the service name: `src/modules/assets/service.js:272-320` (`correctIdentity`) calls `repo.insertIdentityAssignment` (`src/modules/assets/repository.js:155-169`), which:
1. INSERTs a new row (the correction).
2. UPDATEs the PRIOR live row: `UPDATE asset_identity_assignment SET superseded_by = $1 WHERE asset_id = $2 AND id != $1 AND superseded_by IS NULL` — setting **only** `superseded_by`.

This DOES mutate the prior durable row — GK188-0B's condition. Checked directly against the already-designed trigger (`asset_identity_assignment_guard`, then still inside the combined `0015` file): it was **already** the column-scoped, one-way-transition model GK188-0B requires (`superseded_by`: `NULL → value`, exactly once, every other field an `IS DISTINCT FROM` rejection) — not a blanket `BEFORE UPDATE OR DELETE → RAISE EXCEPTION`. **GK188-0 PASS — the trigger design already matched the required model; no redesign was needed.** This does invalidate any assumption that A2 could be the trivial "no secondary lock" case, since the trigger's cycle-guard performs a real `SELECT ... FOR UPDATE` on another row.

## A1 — migration/rollback domain isolation: SPLIT

No real migration-infrastructure constraint argued against splitting — this repo's migrations are already independent numbered files. **A1 PASS — SPLIT.** The original combined `0015_d5b_valuation_question_applicability.sql` became:

- `db/data0/0015_d1_identity_assignment_immutability.sql` + `_rollback.sql` — the D1 repair to the existing `asset_identity_assignment` table, standalone.
- `db/data0/0016_d5b_valuation_question_applicability.sql` + `_rollback.sql` — the two new tables, depends on 0015.

**A1-R1/R2** (`tests/d5b-live-apply-gate-a1-rehearsal.test.js`, 29/29, real isolated scratch schema): each migration rehearsed independently — baseline → forward → verify delta → rollback → verify **exact deterministic structural restoration** (a fresh comparator, `snapshotStructure()`, covering columns/constraints/indexes/triggers/function bodies, sorted for determinism; no reusable comparator existed elsewhere in this repo to reuse — checked directly, D3.2's own "78/78" was a bespoke one-off script, not a committed mechanism). 0015 adds zero columns to `asset_identity_assignment` (column set byte-identical before/after); 0016's forward apply leaves `asset_identity_assignment` byte-identical to its own baseline.

**A1-R3** (cross-domain isolation, same file): rolling back D5B (0016) alone leaves 0015's protection byte-identical, not merely "still present." Rolling back D1 (0015) **while 0016 is still applied is rejected** — a real Postgres FK-dependency error (`cannot drop constraint ... because other objects depend on it`), never a silent success, and the failed attempt (transaction-wrapped) leaves everything byte-identical — no partial damage. Proper order (0016 then 0015) fully tears down to the original pre-0015 baseline. This is a disclosed, correct, one-directional ordering dependency (0016 depends on 0015, never the reverse) — not the silent coupling A1 exists to rule out.

## A2 — concurrency / trigger lock geometry: expanded analysis required and performed

Since GK188-0 confirmed the trigger performs a secondary `SELECT ... FOR UPDATE`, the simple "no additional lock geometry" pass does not apply. `tests/d5b-live-apply-gate-a2-concurrency.test.js` (7/7, real scratch schema, multi-connection):

1. **Adversarial crossed-cycle** (X supersedes Y while Y supersedes X, both pre-existing rows, same asset — the exact D4 construction, applied to this trigger): resolved via a real Postgres mechanism (this run: a plain block, T2 waiting on T1 alone — no mutual wait, hence no 40P01 needed; a genuine deadlock is an equally legal outcome of this construction, as D4's own reference runs observed, and this test does not assert which specific mechanism occurs, matching D4's own precedent, which is honest about the timing-dependence). Required invariants held: both transactions never commit simultaneously; no cycle ever persists in the data.
2. **Real application call pattern, same asset, concurrent**: zero deadlocks, zero errors — because `NEW.superseded_by` in the real call pattern is always a fresh, same-transaction, private row (never a pre-existing one), so the cycle-guard's `FOR UPDATE` lock never contends across transactions. **Reproduced a genuine, pre-existing, trigger-independent race** (GK-190): under READ COMMITTED, one correction's own `UPDATE ... WHERE superseded_by IS NULL` can silently affect 0 rows if the other correction closed the same target first — both INSERTs still succeed, but two rows end up simultaneously "live." Confirmed absent from real current `data1_dev` data (below). Not fixed here — pre-existing `repository.js` logic, out of 0015's scope; disclosed and ticketed.
3. **Real application call pattern, different assets, concurrent**: zero interference, each correction closes exactly its own asset's own row.

**A2 PASS** (expanded analysis, not the trivial case).

## GK-188 — real `data1_dev` compatibility

Read-only census, target explicitly confirmed `data1_dev` (fully-qualified queries, no ambient `search_path` reliance):

| Check | Result |
|---|---|
| Row count | **80** |
| Columns | `id`(uuid,NN) `asset_id`(uuid,NN,FK→gk_asset) `catalog_entity_id`(uuid,nullable) `authority`(text,NN,CHECK) `source`(text,NN,CHECK) `recorded_at`(timestamptz,NN,default now()) `superseded_by`(uuid,nullable,**self-FK already live**) `occurred_at`(timestamptz,nullable) |
| Pre-existing triggers | **0** |
| Pre-existing `UNIQUE(id,asset_id)`-shaped constraint | **0** |
| Inbound FK relationships | only its own self-FK (`superseded_by → id`) |
| Assets with >1 simultaneously-live row (GK-190 class) | **0** |
| Duplicate `(id)` rows | **0** |
| Self-referencing rows (`superseded_by = id`) | **0** |
| Orphaned `superseded_by` targets | **0** (already FK-enforced) |
| Rows with `superseded_by IS NULL` (live) | **58**, across **58** distinct assets — exactly 1:1, no anomaly |
| `gk_asset` total rows | 131 |
| `market_observation` total rows | 23 |

**GK188-1** (insertion-based): confirmed, `insertIdentityAssignment` always INSERTs. **GK188-2** (no reliance on later content-UPDATE of the same row): confirmed — the only UPDATE ever issued sets `superseded_by` alone. **GK188-3/4** (forbidden UPDATE/DELETE rejected): proven live, repeatedly, across three separate test files. **GK188-5** (`ON CONFLICT` compatibility): N/A — grepped directly, zero `ON CONFLICT` clause anywhere touches this table (the three that exist in `repository.js` target `entity_mint_basis`, `current_owner`, `asset_identifier` — different tables). **GK188-6/7** (no existing-row mutation/rewrite needed before trigger creation): confirmed by the census above (zero anomalies that would violate the new constraint or trigger) and by A1-R1's own structural proof (0015 adds zero columns). **GK188-8** (no legitimate workflow mutates an existing assignment): the production path doesn't; **one test-only workflow did** — `tests/d3-2-application-wiring-live-proof.test.js`'s own cleanup issued a real `DELETE FROM asset_identity_assignment` against real `data1_dev`. Per GK188-0B's own instruction ("do not weaken the trigger automatically"), the **test** was fixed instead: its identity-assignment/`gk_asset`/`mint_event`/`entity_mint_basis` rows are now accepted as permanently-retained fixtures (the same precedent already established for D3.3's own `comp_snapshot` rows), and its baseline-restoration assertion updated to expect exactly that delta. **GK-188 PASS.**

## GK-189 — permanent note (reaffirmed, not new)

`source_type` (`automated` / `operator-override`) is **provenance**, never **precedence**. It does not establish that an operator-override judgment defeats or outranks an automated one. If a future workflow needs that behavior, it requires an explicit modeled rule — never an inference from this column's value. (Originally banked in `docs/TICKET-REGISTRY.md`, GK-189; restated here per this dispatch's explicit instruction, and embedded directly in `0016`'s own migration header comment.)

## A3 — restore-window volume evidence (measured, superseding the prior order-of-magnitude hypothesis)

Method: `pg_current_wal_lsn()` / `pg_wal_lsn_diff()`, steady-state median of 3 samples per N, after 20-row priming (warms Postgres's one-time full-page-image WAL cost), no-write control sampled immediately before measuring. Real isolated Postgres scratch schema, `tests/d5b-0015-migration-contract.test.js`.

| N | Steady-state median WAL bytes/row |
|---|---|
| 20 | ~990 |
| 60 | ~1060–1130 |
| 100 | ~1075–1130 |
| second complete N=100 (changed judgment logic) | ~1130–1140 |

Second-evaluation finding: **300 additional rows created (3 replicate N=100 samples), 0 deduped** — a second complete evaluation under changed judgment logic (a rule-version bump) produces genuine new append-only volume, never replaces the first evaluation's rows. This range (not a single collapsed average), the method, the sample sizes, and the second-evaluation finding are banked into `docs/MASTER-BOARD.md`'s existing restore-window gate (Finding B, already present from the design pass — this section supersedes that finding's order-of-magnitude hypothesis with the real measured range).

## Terminal (pre-apply)

GK188-0 PASS. A1 PASS — SPLIT. A2 PASS (expanded analysis). GK-188 PASS. GK-189 reaffirmed. A3 measured and banked.

**All pre-apply gates pass — proceeding to live-apply authorization.**

---

## X1/X2/X3 amendment

**X1 PASS** — `0015` = D1 repair, `0016` = D5B, verified directly from the committed file headers (not inferred). Numeric order matches ruled domain order; no renumbering needed.

**Apply artifact traceability** — `live-apply-0015-0016.mjs` committed at `3591fc797c641bb5be585a9e5d93a3ca92904e74` (script rewritten first to satisfy X2A/X2C, then committed — no uncommitted executable was ever run against `data1_dev`). SHA-256:

```
script:  aa9dd7d55247465fa4dbe26127af27047a51ec8782aaf8257e25951dca88361b
0015:    3066f70acf62a1ee5d30a06cf66131cca8b0d449cadaae74b59262c7f324c026
0015_rb: 11bd48b6694738a9d1cf0e23c0a65c4331f2ad4ecc04115452a2b9565de23e20
0016:    31d0fc9bc9cdd16aa1804196f42eb39351f81411349c8bdee0d0b68efcbae64b
0016_rb: 66d64bac368a96118b54d7fdcfe380a811e55c4224c3ffa1b830aa9b92f66dc4
```

**X2A PASS** — the committed script uses two fully independent `BEGIN`/`COMMIT` blocks, one per migration, never a shared outer transaction.
**X2B** — no DB-side migration-ledger table exists anywhere in this repo (verified: grepped `db/data0/*.sql` and `docs/` for `migration_history`/`schema_migrations`/`migration_ledger`, zero hits). Satisfied instead via direct schema-object-existence checks before/after each stage — this repo's own established mechanism (`docs/DATABASE-MIGRATION-STATUS.md` already tracks "applied" status the same way).
**X2C** — the script captures `clock_timestamp() AT TIME ZONE 'UTC'` + `pg_current_wal_lsn()` + client `new Date().toISOString()` immediately before each `BEGIN` and again after each `COMMIT`, as two independent anchors (`D1_RECOVERY_ANCHOR`, `D5B_RECOVERY_ANCHOR`) — see the recovery-record correction below for a real defect found in this exact mechanism.

**X3 — correction, not adoption.** The amendment's own stated hypothesis for GK188-0 ("does NOT close the prior assignment by mutating the existing durable row... derived from ordering/history rather than by UPDATE") was checked directly against `src/modules/assets/repository.js:155-169` (`insertIdentityAssignment`, called by both `assignIdentity` and `correctIdentity` via `service.js:272-320`) and found to **contradict the real code**: the function INSERTs a new row **and then issues a real `UPDATE ... SET superseded_by = $1 WHERE ... AND superseded_by IS NULL`** against the prior row. This is exactly what the original GK188-0 finding (this same report, above) already established and what the live trigger was already built to handle correctly (column-scoped one-way transition, not blanket immutability). No redesign occurred — X3's suggested "consequence" (blanket immutability, no secondary lock, A2 simplifies) was not adopted, since it rests on a premise the real code does not support. A later message in this same dispatch chain independently re-derived and confirmed the correct mechanism, matching what was already implemented and tested.

**Corrected, final GK188-0/PA7 statement (banked):** `correctIdentity` creates a successor assignment by INSERT and closes the prior assignment through a constrained, column-scoped `superseded_by`-only UPDATE — never a blanket rewrite. Assertion content (`asset_id`/`catalog_entity_id`/`authority`/`source`/`occurred_at`/`recorded_at`) remains immutable; only the one-way lifecycle pointer transitions, exactly once, `NULL → value`. The column-scoped trigger and the expanded A2 concurrency analysis (the cycle-guard's `SELECT ... FOR UPDATE` is real secondary lock geometry) were therefore necessary and correct as built — a blanket "no mutation at all" trigger would have broken the real live write path.

## Live apply — execution barrier and manual fallback

The committed script was run twice against real `data1_dev` via this session's own Bash tool; both attempts were blocked by Claude Code's own auto-mode classifier (a harness-level safety layer, unrelated to and independent of every gate above, all of which passed). Per explicit instruction, no workaround was attempted. The exact committed artifact (`3591fc7`) was handed off for manual execution.

## Post-apply verification — independently performed, not merely accepted

A manually-run transcript was reported back into this dispatch, claiming both migrations committed successfully with specific row counts and recovery coordinates. **That transcript was not independently witnessed by this session** (both automated attempts were blocked before producing output) — its exact historical WAL-LSN/timestamp values are therefore reported here as provided, not independently re-derived; there is no way to query a database's *past* `pg_current_wal_lsn()` after the fact. What **was** independently re-verified, live, read-only, against real `data1_dev`, in this same dispatch, is the *current resulting state* — via a fresh, separately-written, read-only verification script (not reusing or trusting the apply script's own claims):

### PA1–PA18 results (all independently confirmed via live read-only catalog queries)

| # | Check | Result |
|---|---|---|
| PA-add3 | Public-schema contamination | **PASS** — zero D1/D5B objects (`valuation_question`, `applicability`, functions, view) exist in `public`; all confirmed only in `data1_dev` |
| PA1 | Structural presence, both domains (no ledger table — structural proof) | **PASS** — D1: 2 triggers + UK constraint present; D5B: both tables present |
| PA2 | Full object definition match | **PASS** — live columns/constraints/indexes/triggers/view-def for all three tables captured and match the committed migration text exactly (full catalog dump captured; see census below for the load-bearing specifics) |
| PA3 | `asset_identity_assignment` = 80 | **PASS** — confirmed live, unchanged |
| PA4 | `market_observation` = 23 | **PASS** — confirmed live, unchanged |
| PA5 | Existing durable data preservation | **PASS for row counts** (`aia`=80, `mo`=23, `ga`=131, all unchanged). **Row-content byte-identity is NOT claimed** — no pre-migration content digest was captured (only counts), so content preservation rests on schema-migration-behavior evidence (0015/0016 contain zero `UPDATE`/rewrite of pre-existing row content, only `ALTER TABLE ADD CONSTRAINT`/`CREATE TRIGGER`/`CREATE TABLE` — confirmed by reading the committed migration text itself) plus the unchanged row counts, not a byte-for-byte digest comparison |
| PA6 | D1 immutability contract | **PASS** — via catalog definition comparison (no live mutation attempted, per explicit instruction and because 81 prior scratch-schema tests already proved this exact function body's behavior). Live `pg_get_functiondef` output for `asset_identity_assignment_guard` captured in full and confirmed to contain: unconditional DELETE rejection, bare-UPDATE rejection, content-mutation rejection, already-superseded re-pointing rejection, and the cycle-guard `FOR UPDATE` — all five present, matching the committed `0015` source |
| PA7 | `correctIdentity` live contract | **PASS** — see the corrected GK188-0 statement above, with exact `file:line` evidence (`service.js:272-320`, `repository.js:155-169`) |
| PA8 | `valuation_question.asset_id` physically `NOT NULL` | **PASS** — `information_schema.columns.is_nullable = 'NO'`, catalog-enforced |
| PA9 | FK target + delete action | **PASS** — `FOREIGN KEY (asset_id) REFERENCES data1_dev.gk_asset(id)`, no `ON DELETE` clause present in `pg_get_constraintdef` output (default `NO ACTION` — never `CASCADE`, matching the ruled no-cascade design; an asset can never be deleted out from under a `ValuationQuestion`) |
| PA10 | No supersession machinery in `applicability` | **PASS** — full live column list captured (15 columns), zero `supersede`/`superseded_by`-shaped column present |
| PA11 | `applicability` immutability live | **PASS** — `applicability_no_update`/`applicability_no_delete` triggers present, live `pg_get_triggerdef` captured |
| PA12 | verdict/confidence_tier/source_type independent axes | **PASS** — three separate `CHECK` constraints confirmed in the live catalog, never one collapsed enum |
| PA13 | `CORROBORATED` not a legal confidence tier | **PASS** — live `CHECK` constraint text is `confidence_tier = ANY (ARRAY['LOW','MEDIUM','HIGH'])`; `CORROBORATED` is not in that array — confirmed from catalog definition, no live test row inserted |
| PA14 | GK-180 = zero writer call sites | **PASS** — repo-wide grep for any INSERT-shaped call into `valuation_question`/`applicability` outside `db/data0/`/`tests/`: zero hits |
| PA15 | No D5C `MarketPopulation` object | **PASS** — the only 3 repo hits for "MarketPopulation" are comment-only design references in `0012`/`0014`/`0016`'s own header text, confirmed by direct inspection; no schema object, table, or writer named or shaped like it exists |
| PA16 | No D5D writer/API wiring | **PASS** — zero files under `api/` import `valuationQuestionHash.js` or `applicabilityHash.js` |
| PA17 | Production capture still disabled | **PASS** — same evidence as PA14/16: no writer path exists at all, so nothing can emit a durable D5B judgment |
| PA18 | Quarantine untouched | **PASS** — `scripts/capture-active-cache-entry.mjs` (modified), `scripts/ingest-fixture-response.mjs` / `scripts/merge-fixture.mjs` (untracked) remain exactly as they were at session start, never staged, unrelated to any migration commit |

## Recovery-record correction (GK-191 — renumbered, GK-190 already taken)

**Ticket-number collision caught and corrected:** the requested finding cannot be banked as "GK-190" — that number is already assigned (the pre-existing `insertIdentityAssignment` same-asset race, found during this same dispatch's own A2 concurrency test, `docs/TICKET-REGISTRY.md`). Banked as **GK-191** instead. Never reuse a live ticket number.

**Reported (not independently reproduced by this session — HYPOTHESIS, plausible, not verified against raw wire-protocol output):** the live-apply script's `clock_timestamp() AT TIME ZONE 'UTC'` produces a `timestamp without time zone` value; `node-postgres` may parse that type using session/local time rather than UTC before `.toISOString()` re-applies a UTC conversion, producing an apparent ~7-hour offset consistent with Phoenix's UTC-7 (no DST). This is a plausible, known class of driver/type mismatch — accepted as the working diagnosis, not independently re-verified byte-for-byte in this session.

**Authoritative recovery coordinates (client UTC + WAL LSN, per the correction):**

```
PRE-D1:   2026-09-03T04:23:52.268Z   WAL 0/44DC900
PRE-D5B:  2026-09-03T04:23:53.495Z   WAL 0/44DF5D8
POST-D5B: 2026-09-03T04:23:53.861Z   WAL 0/44FC128
```

**Fix for future recorders (GK-191):** never pass `... AT TIME ZONE 'UTC'` output to a JS Date parser. Prefer `SELECT clock_timestamp() AS recovery_anchor` (let the driver serialize the genuine `timestamptz`) or an explicit, unambiguous UTC text format. Until fixed, client `new Date().toISOString()` + `pg_current_wal_lsn()` are the authoritative recovery coordinates for any future live-migration script derived from this one — the DB-side timestamp is supplemental only, not primary, until its serialization is proven correct.

This is an observability/tooling defect, not a D1 or D5B schema defect — no rollback, no replay, no schema change made in response to it.

## Terminal (final)

All PA1–PA18 independently confirmed live, read-only, this session, against real `data1_dev`. GK-191 banked (recorder defect, distinct from GK-190). No public-schema contamination. No pre-existing data rewritten (counts unchanged; no content digest existed to prove byte-identity, disclosed honestly rather than overclaimed).

**D1 IMMUTABILITY REPAIR LIVE — FINAL VERIFIED**
**D5B PHYSICAL SCHEMA LIVE — FINAL VERIFIED**
**PA1–PA18 PASS**
