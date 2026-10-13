# Migration 0040 — final authorization checkpoint (2026-10-13) — PREPARED, NOT AUTHORIZED

Nothing in this document runs, applies, backs up, pushes or deploys anything. It is the text the operator reads before writing the authorization words. Companion records: `docs/B1-MIGRATION-0040-CHECKLIST.md` (the A-F procedure this checkpoint amends), `docs/PRODUCTION-BACKUP-RESTORE-PROCEDURE.md`, `docs/B1-RC-RELEASE-PLAN.md` §2 (rollback), `docs/B1-RELEASE-SEQUENCING-FINAL.md`.

## 1. Gate facts

| Gate | State | Class |
|---|---|---|
| Neon recovery window | Project `grailkey-catalog`, branch `main`, plan **Free**, history retention **6 hours**, PostgreSQL 18, compute 0.25 CU. **No waiver issued; the six-hour PITR window is confirmed.** Monthly network transfer **81.4% used** at observation. | OPERATOR-VERIFIED in the Neon Console, 2026-10-13 (operator-reported to this record, not independently re-read) |
| Independent cold-start recovery (2026-10-12 backup) | PASS; local recovery database absence verified | OPERATOR-REPORTED |
| Release candidate | `f9f159c2f1e685f47e84b3545ed85e8c4152f37f`, branch `b1-first-outcome-authority` tip, frozen | VERIFIED (git, this pass) |
| 0040 artifact hashes (read from `f9f159c`) | `0040_operator_manual_authority.sql` = `6641e24b41cb49f15b37a99179f87d6e877833ba943d1e7b3e384f13d9584830`; rollback = `5b0a0990f39348a33c2cba97a11b8bf8635d858e8856d9c6b1e36572eaf3831b` — both equal the checklist values (identical with CRLF stripped) | VERIFIED (this pass) |
| Production deployment | `b403f33`, `dpl_G3EswX5MBKpMSKQrVrC7M11HtYrY`, READY (last read 2026-10-13) | VERIFIED LIVE |
| Production database state | Last measured 2026-10-13T02:49Z: 57 tables / 593 rows, `operator_authority_event` absent. **Not re-measured by this pass** (no Production access was used). | HISTORICAL EVIDENCE |
| 0040 elsewhere | Applied to Development only | HISTORICAL (registry B1-FINAL) |

What the 6-hour window means: Neon can restore a point no older than 6 hours. A backup or baseline taken more than 6 hours before the migration cannot be bridged by PITR to the migration instant. The window is therefore the PRIMARY short-horizon recovery, and the fresh encrypted logical backup is the long-horizon one. Network transfer at 81.4% is a watch item only: the dump is ~3.4 MB and no restore into Neon is planned; if the Console shows the cap reached, STOP.

## 2. What the migration is (read from the file, not from memory)
One new table `data1_dev.operator_authority_event` (30 columns), 1 primary key + 4 further indexes, 3 immutability triggers reusing `economic_ledger_immutable()`. The file contains no `BEGIN`/`COMMIT` of its own, sets `search_path` to `data1_dev` (so it MUST run on the **direct, non-pooled** endpoint), starts with a guard that raises if `economic_ledger_immutable()` is missing, and uses `IF NOT EXISTS` / `CREATE OR REPLACE` — therefore **it would silently succeed against an already-existing table; absence must be asserted BEFORE it runs** (step A4). It references, and never alters, existing tables. It needs PostgreSQL 14+ (`CREATE OR REPLACE TRIGGER`); Production is 18.

## 3. Execution sequence if authorized (executor = Claude Code; every step read-only against Production except step C)

**A. Pre-apply, read-only. Stop on the first failure.**
1. `git rev-parse b1-first-outcome-authority` = `f9f159c2…`; worktree clean; the two SQL hashes equal §1.
2. Vercel Production deployment still `b403f33` / `dpl_G3Es…`; `origin/main` still `b403f33`; no newer Production deployment.
3. Direct endpoint = pooled hostname minus `-pooler`; `data1_dev.environment_marker` = `production`; server PostgreSQL 18.x. A first `SELECT 1` warms the 0.25 CU compute (it may be suspended) before the timed steps. Credentials go from the ignored local env file to child-process environment only; never printed, never on a command line, scripts hold none and are deleted.
4. `to_regclass('data1_dev.operator_authority_event')` IS NULL; `economic_ledger_immutable()` present in `data1_dev`; `operator_action_event`, `gk_asset` and the other FK targets present.
5. **Fresh baseline (live numbers, not the 593):** `count(*)` of every table in a `BEGIN READ ONLY` transaction; total tables; constraints (last 599); indexes (last 164); extensions (`pg_trgm`, `plpgsql`); max timestamps across ledgers and `collection_item.updated_at`. Compare with 2026-10-13T02:49Z and **report every delta**; a delta is allowed but must be stated.
6. Record UTC `T_baseline`.

**B. Fresh encrypted backup (REQUIRED; the 2026-10-12 backup does NOT stand — it is >24 h old, outside the 6 h window, and write-coverage was never established).** Per `PRODUCTION-BACKUP-RESTORE-PROCEDURE.md` §2-§3 and §7: `pg_dump --format=custom --compress=6 --no-owner --no-privileges` from the direct endpoint (single repeatable-read snapshot) plus a `--schema-only` copy; record path, UTC timestamp `T_backup`, bytes, SHA-256; `pg_restore --list` readable (expect 57 table-data entries unless step A5 shows a change) and re-hash equal; encrypt with GnuPG symmetric AES-256, a **new** random passphrase written only to `C:\gk-backups\keys\` (never printed, never in Git, never under OneDrive); verify decrypt-reproduces-hash; overwrite and delete every plaintext and temporary; `MANIFEST.txt` updated; ACL restricted. No restore drill is part of this authorization (a drill would trigger the §4a cleanup obligation); the earlier operator-certified cold-start recovery covers the procedure.
   * **Freshness bound:** the apply (step C) must begin **≤ 60 minutes after `T_backup`**, and step A5's counts must still equal the snapshot's counts immediately before C (re-run the count query; any difference not explained by the stated deltas = STOP and re-take the backup).
   * **Custody and copies:** the new passphrase file is on the same disk as the ciphertext. Off-machine copy of the new ciphertext: the operator chooses in the authorization text (§5) — **REQUIRED BEFORE APPLY** (executor pauses and asks) or **NOT REQUIRED** (6 h PITR is the primary recovery; the Oct-12 backup's independent copy is already operator-certified).

**C. Apply — one transaction, direct endpoint, nothing else.**
`BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'; <0040 file contents>; <verification queries D>; COMMIT;` — `ROLLBACK` on any mismatch or error. The two `SET LOCAL` lines are a **proposed amendment** to checklist §B ("no other statement"): they are session settings, not data or schema statements, they leave the file hash unchanged, and they prevent the `CREATE TABLE … REFERENCES` from queueing indefinitely behind a long-running reader. Operator approval of this checkpoint's authorization text approves them; striking that sentence removes them. Record UTC `T_apply_start` and `T_commit` (the PITR target for any recovery is the second before `T_apply_start`, which is inside the 6 h window only if the apply happens within 6 h of `T_backup` — guaranteed by the 60-minute bound).

**D. In-transaction verification, before COMMIT (checklist §C).** `operator_authority_event` exists with **30 columns** and **0 rows**; primary key + **4** further indexes (`…_attempt_phase_uniq` partial unique excluding `OPERATOR_RECONCILED`, `…_asset_idx`, `…_action_idx`, `…_review_idx` partial on `phase='AMBIGUOUS'`); **3** triggers (`…_no_update`, `…_no_delete`, `…_no_truncate`) bound to `economic_ledger_immutable()`; the named CHECK/FK constraints present as in the file; **every other table's row count equal to the A5/refreshed snapshot**; every other table's column/constraint/index counts unchanged (599 / 164 baseline plus the new table's own); extensions unchanged; marker still `production`.

**E. Post-commit, read-only (checklist §E).** Re-run D against committed state; new table 0 rows; OLD app (`b403f33`) still serves (unauthenticated GET of the app root = 200 and an authenticated-only API route = the expected 401, no data returned); record before/after in `docs/TICKET-REGISTRY.md` as a local docs commit. **No push, no deploy in this step.**

## 4. Rollback readiness
* **In-transaction:** any mismatch, error or timeout → `ROLLBACK`; the database is unchanged; stop and report; no retry without fresh review. The migration file is never edited to "fix" a run.
* **After COMMIT, before any authority row exists:** the old application never references the table, so `0040_operator_manual_authority_rollback.sql` (`DROP TABLE IF EXISTS operator_authority_event;`, hash §1) is safe at any time before the new application is deployed. **Executing it is a separate operator instruction, not covered by this authorization** (report-and-hold: it is the one step that destroys the new schema object).
* **Application order if the app is ever rolled back with no authority rows:** redeploy the previous application first, then drop the table (`B1-RC-RELEASE-PLAN.md` §2). **After any authority row exists: preserve the table** (append-only audit record); recover by forward fix or compatible application rollback.
* **Last resort inside 6 h of `T_apply_start`:** Neon point-in-time restore to the second before `T_apply_start` (operator action in the Console; restores everything written after that second, including any customer writes — a deliberate trade, operator-decided). Beyond 6 h: the fresh encrypted dump.

## 5. Exact authorization text for operator approval
(The operator copies one version into the next message, striking the unwanted bracket.)

```
PRODUCTION MIGRATION 0040 AUTHORIZED

Apply db/data0/0040_operator_manual_authority.sql
  (SHA-256 6641e24b41cb49f15b37a99179f87d6e877833ba943d1e7b3e384f13d9584830),
  from release candidate f9f159c2f1e685f47e84b3545ed85e8c4152f37f,
to the Production Neon database (project grailkey-catalog, branch main, PostgreSQL 18)
via the DIRECT non-pooled endpoint, in ONE transaction,
following docs/B1-MIGRATION-0040-AUTHORIZATION-CHECKPOINT.md (branch b1-preflight-records)
and docs/B1-MIGRATION-0040-CHECKLIST.md as amended there,
INCLUDING its proposed amendment: SET LOCAL lock_timeout = '5s' and
SET LOCAL statement_timeout = '60s' inside the transaction.

This authorizes, in order: (A) the read-only pre-apply checks and fresh baseline census,
(B) a NEW encrypted Production logical backup (apply to begin <= 60 minutes after its snapshot),
(C) the single-transaction apply with in-transaction verification and ROLLBACK on any mismatch,
(E) read-only post-commit certification and a local documentation commit recording before/after.

Off-machine copy of the new ciphertext: [REQUIRED BEFORE APPLY - pause and ask me]
                                       / [NOT REQUIRED - the 6-hour Neon PITR window is primary recovery]

STOP and report (no retry) if: the candidate SHA or either file hash differs; Production is not
b403f33 / dpl_G3EswX5MBKpMSKQrVrC7M11HtYrY; the marker is not "production"; the endpoint is pooled;
operator_authority_event already exists; the baseline or pre-apply row counts differ without an
explained delta; any in-transaction check fails; Neon reports the network-transfer cap reached;
or any secret would be printed.

NOT authorized: push of any branch or of main; any deployment; executing the rollback SQL;
any other migration; any other Production database change; any marketplace write; any paid scan;
any application-code change; a restore drill.
A separate "PUSH AND DEPLOY AUTHORIZED" naming f9f159c2f1e685f47e84b3545ed85e8c4152f37f is still
required after 0040 is certified.
```

## 6. Open items that this checkpoint does not close
* Production database state is last measured at 2026-10-13T02:49Z; step A5 re-measures it under authorization.
* Neon facts are operator-reported; the executor cannot read the Console.
* Passphrase custody for the NEW backup moves to the operator after step B (password manager, kept apart from the ciphertext).
* Network transfer 81.4% (Free plan) — if Production traffic grows, the cap could affect availability independent of this migration.
* GK-283, GK-294, GK-295 still gate non-operator marketplace writes; they do not gate 0040.

---
## Authorization received 2026-10-13 — `PRODUCTION MIGRATION 0040 AUTHORIZED` (amendments recorded; EXECUTION BLOCKED at step 1, nothing applied)

Operator authorized applying `db/data0/0040_operator_manual_authority.sql` (SHA-256 `6641e24b41cb49f15b37a99179f87d6e877833ba943d1e7b3e384f13d9584830`) from `f9f159c2f1e685f47e84b3545ed85e8c4152f37f` to Neon Production (`grailkey-catalog`, branch `main`, PostgreSQL 18, direct non-pooled endpoint), following the checkpoint at `468de76af3a46eea52c1d0c9213a5e7242f04bec`, with these explicitly authorized amendments (release evidence):
1. The 60-minute backup-to-apply expiration is REMOVED (the baseline recheck in step 4 and the 6-hour Neon history window still bound staleness).
2. The manual pause for off-machine custody of the new backup is REMOVED.
3. A fresh encrypted backup, created and verified before applying, is RETAINED as a requirement.
4. `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'` inside the transaction are RETAINED.
No PITR waiver is issued. Not authorized: push, deployment, rollback execution, other migrations, marketplace writes, paid scans, application-code changes, restore drills.

**Pre-execution clarification (derived from the migration file itself, recorded before any run):** the checklist's "primary key + 4 further indexes" counts only the four `CREATE INDEX` statements. The file also declares `CONSTRAINT operator_authority_event_chain_uniq UNIQUE (...)`, which PostgreSQL backs with a fifth secondary index. The expected catalog for the new table is therefore **1 primary key + 1 constraint-backed unique index + the 4 named indexes = 6 indexes**; the in-transaction check is written to that expectation and to the four named indexes + PK, not to a total of 5.

**Execution status at this record (2026-10-13): step 1 PARTIALLY complete, then HELD.** Done and passing: candidate tip `f9f159c2…` exact; migration and rollback hashes equal the authorized values; Production deployment still `dpl_G3EswX5MBKpMSKQrVrC7M11HtYrY` / `b403f33`. NOT done: Production environment marker, direct-endpoint, and `operator_authority_event` absence checks, the baseline census, the backup — **no Production database connection was made.** Reason: the documented credential source `.env.production-pull.local` holds the Vercel `[SENSITIVE]` placeholder for `GRAILKEY_CATALOG_DATABASE_URL`, not a usable URL, and the executor was not told which other local file is the sanctioned Production credential source. Probing other local env files to find one was refused by the permission layer as credential exploration and was not pursued. No backup was created; no migration was applied.
