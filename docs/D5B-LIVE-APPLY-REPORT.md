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
