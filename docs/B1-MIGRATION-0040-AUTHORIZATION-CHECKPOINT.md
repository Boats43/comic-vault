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

---
## VERIFIED PRODUCTION-READ PROCEDURE (recorded 2026-10-13 so future sessions need NO credential discovery)

Source of truth: `scripts/apply-0031-0032-marketplace-connection-production.mjs` (committed; it ran against Production for GK-263) and `docs/TICKET-REGISTRY.md` (GK-216/Old Man Logan entries: `.env.production-secrets.local` "holds only the DB connection string"). The procedure, unchanged:
1. Read ONLY `<main-worktree>/.env.production-secrets.local` in-process (same `loadEnvFile` parser as the apply scripts). No other file is a credential source. (`.env.production-pull.local` holds only the Vercel `[SENSITIVE]` placeholder and is NOT usable; do not probe other env files.)
2. `process.env.GRAILKEY_CATALOG_ENVIRONMENT = env.GRAILKEY_CATALOG_ENVIRONMENT` (must equal `production`).
3. Import `scripts/db-admin-preflight.mjs` `assertAdminDbTarget({ connectionString, label })` — verifies `current_database()='neondb'`, schema `data1_dev` exists, and `data1_dev.environment_marker.app_env` via `assertEnvironmentIdentity()`. For migrations the connection string is the DIRECT endpoint: the file's pooled host with `-pooler` removed (done in memory, never printed).
4. Reads run in `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ`. Nothing credential-bearing is printed or placed on a command line; `pg_dump`/`pg_restore` receive credentials only through child-process environment variables.
Executor used for 0040 (holds no credential): `C:\Users\matam\AppData\Local\Temp\claude\C--Users-matam-OneDrive-Desktop-comic-vault\f03a756b-6984-43ae-a5e2-816c4f601818\scratchpad\p0040.mjs` with subcommands `check | backup | apply | certify`; run from the main worktree root (`C:\Users\matam\OneDrive\Desktop\comic-vault`) so `pg` and the preflight helper resolve.

## EXECUTION RECORD 2026-10-13 (authorization: `PRODUCTION MIGRATION 0040 AUTHORIZED`, amendments above; index correction ACCEPTED: expected total 6 = PK + `operator_authority_event_chain_uniq` + the four named indexes, each verified by name AND definition)

**Step 1 — PASS.** Candidate tip `f9f159c2f1e685f47e84b3545ed85e8c4152f37f`; migration SHA-256 `6641e24b…4830` and rollback `5b0a0990…31b` equal the authorized values; Production deployment `dpl_G3EswX5MBKpMSKQrVrC7M11HtYrY` / `b403f33` (newest Production deployment); credential source `.env.production-secrets.local`; `assertAdminDbTarget` PASSED (database `neondb`, `data1_dev` present, environment identity confirmed); marker `production`; PostgreSQL 18.6; endpoint DIRECT (file held the pooled host); `operator_authority_event` ABSENT; `economic_ledger_immutable()` present; FK targets `gk_asset`, `gk_principal`, `operator_action_event`, `decision_event` present.

**Step 2 — baseline (2026-10-13T19:40:12.963Z): 57 tables / 612 rows / 599 constraints / 164 indexes; extensions `pg_trgm`, `plpgsql`; newest timestamp anywhere 2026-10-13T19:34:16.603Z.** Versus the last recorded preflight (2026-10-13T02:49Z: 593 rows) this is +19 rows with writes as recent as 19:34Z — consistent with live use, not itemized per table in this record. Structure unchanged (57 tables, 599 constraints, 164 indexes).

**Step 3 — fresh encrypted backup: CREATED AND VERIFIED.** Snapshot started 2026-10-13T19:40:38Z. Location `C:\gk-backups\production\` (restricted ACL inherited from the directory), passphrase file `C:\gk-backups\keys\backup-passphrase-20261013-46129a.txt` (contents never displayed; custody moves to the operator). GnuPG symmetric AES-256, SHA-512 S2K x 65011712, no compression, integrity-protected.
| File | Ciphertext bytes | Ciphertext SHA-256 |
|---|---|---|
| `grailkey-production-neondb-20261013T194038Z.dump.gpg` | 3,517,296 | `e9d02cfb14bc594665c4e03eab14f692220b6df32e1df30f5ff1435c1dd292d6` |
| `grailkey-production-neondb-20261013T194038Z.schema-only.sql.gpg` | 132,382 | `ea05c60e63c4dcd65be34eb517faf7b8eb112f41a095ade29c347a0692e84b67` |
Plaintext SHA-256 a correct decryption must reproduce: dump `1ed320a6dbf40b744359f6db51dc7fa4e095af14d49b6a55494f007d99d1226c` (3,517,175 bytes), schema `e1e2cd7d4bc7bf6e89a185beee8f790ca63dc48a2ffb5b2ebac45b83745ec4f6` (132,250 bytes — identical size to the 2026-10-12 schema copy). Verified: decrypt-in-memory reproduces both plaintext hashes; table of contents read end to end (480 entries, 57 table-data entries, also 57 from the decrypted stream); one-bit ciphertext change detected; wrong passphrase rejected; the plaintext dump and schema copy were overwritten with random bytes and deleted (best effort on SSD); `MANIFEST.txt` appended. No restore drill performed (not authorized). No second/off-machine copy made (pause removed by amendment 2).

**Steps 4-7 (baseline recheck, single transaction with `SET LOCAL lock_timeout='5s'` / `statement_timeout='60s'`, in-transaction verification, commit or rollback): NOT EXECUTED — the executor's attempt to run `apply` was refused by the Claude Code permission layer ("Production Deploy").** No transaction was opened; Production schema and data are unchanged by this session: `operator_authority_event` is still absent. The same layer blocked automated Production DDL for 0015/0016 in September; those were applied by the operator running the command manually. Steps 4-8 (recheck, apply, certification) therefore require either a permission rule allowing the executor to run `apply`/`certify`, or the operator running them (`node <executor> apply`, then `node <executor> certify`). The baseline recheck compares against the step-2 file; any difference (Production is live) stops the apply with nothing written, after which `check` and `backup` are re-run.

---
## FINAL OPERATOR HANDOFF (2026-10-13) — steps 1-3 accepted; Migration 0040 UNAPPLIED; nothing here executed or authorized beyond the existing `PRODUCTION MIGRATION 0040 AUTHORIZED`

### H1 — backup custody (October 13 backup, snapshot started 2026-10-13T19:40:38Z)
| Artifact | Plaintext SHA-256 (what a correct decryption reproduces) | Ciphertext SHA-256 (on disk, re-hashed 2026-10-13) | Ciphertext bytes |
|---|---|---|---|
| `grailkey-production-neondb-20261013T194038Z.dump.gpg` | `1ed320a6dbf40b744359f6db51dc7fa4e095af14d49b6a55494f007d99d1226c` (3,517,175 B) | `e9d02cfb14bc594665c4e03eab14f692220b6df32e1df30f5ff1435c1dd292d6` | 3,517,296 |
| `grailkey-production-neondb-20261013T194038Z.schema-only.sql.gpg` | `e1e2cd7d4bc7bf6e89a185beee8f790ca63dc48a2ffb5b2ebac45b83745ec4f6` (132,250 B) | `ea05c60e63c4dcd65be34eb517faf7b8eb112f41a095ade29c347a0692e84b67` | 132,382 |
Passphrase file: `C:\gk-backups\keys\backup-passphrase-20261013-46129a.txt` (contents never printed or transmitted). **OPEN operator step:** store the passphrase in a password manager, verify retrieval, then securely remove the local passphrase file. Until then the backup's passphrase and ciphertext share one disk. The standing requirement is recorded in `docs/PRODUCTION-BACKUP-RESTORE-PROCEDURE.md` §8.

### H2 — the 593 -> 612 row increase
**A per-table census for the earlier state does not exist in any record** (the 2026-10-13T02:49Z preflight and the 2026-10-12 backup record only totals: 57 tables / 593 rows). The only per-table copy is inside the encrypted 2026-10-12 backup; reading it was refused by the permission layer and was not pursued. So the +19 cannot be itemized per table. **What the current baseline (`baseline-step2.json`, 2026-10-13T19:40:12Z) does show:** tables with a newest timestamp AFTER the 02:49Z measurement — `collection_item` (232 rows; newest 2026-10-13T19:34:16Z; the 02:49Z record had its newest `updated_at` at 2026-10-12T17:56:29Z), `model_prediction_event` (234 rows; newest 2026-10-13T19:01:30Z), `operator_correction_event` (19 rows; newest 2026-10-13T03:19:46Z). Every other table with a timestamp column has a newest value before 02:49Z (latest: `gk_principal`/`principal_external_identity` 2026-10-11T23:25Z), and every table with no timestamp value holds 0 rows. Therefore any inserted rows are confined to those three tables UNLESS a row carries a caller-supplied or back-dated timestamp. Caveats: a newer timestamp also results from an UPDATE, so it does not prove inserts; and the cause (who or what wrote them) is NOT established — it is not inferred to be scans. This delta is informational: the migration compares every existing table against its fresh pre-apply baseline.

### H3 — execution script
Stable copy outside the scratchpad: **NOT created by the executor** — writing to `C:\gk281\0040-exec\` was refused by the permission layer and no expanded permission was requested. The reviewed, final script is at `C:\Users\matam\AppData\Local\Temp\claude\C--Users-matam-OneDrive-Desktop-comic-vault\f03a756b-6984-43ae-a5e2-816c4f601818\scratchpad\p0040-final.mjs` — **373 lines, SHA-256 `840b2b3b507ef9fed1424c3819be04a312362d062245b042017d38fda8337e71`**; the operator copies it (command in H4). It supersedes the earlier `p0040.mjs` (do not run that one). Offline `lint` (no database connection) PASSED: candidate tip exact, both hashes equal, the migration is exactly 9 allowlisted statements + 1 read-only DO block.

Line-by-line safety review (line numbers refer to the SHA above):
* **One intended transaction, rollback before commit.** The only write transaction opens at line 301 (`BEGIN ISOLATION LEVEL REPEATABLE READ`). Census transactions are `BEGIN READ ONLY ... ROLLBACK` (89/121). The migration contains no transaction control (lint, line 196). Every failure before COMMIT reaches `ROLLBACK` (333, 347); a 180 s watchdog (302) exits the process, and a closed connection makes the server roll back. SIGINT/SIGTERM/SIGHUP exit (44) and the server rolls back the open transaction.
* **Commit-in-flight.** `commitSent` is set immediately before `COMMIT` (336-337); an error after that prints `COMMIT OUTCOME UNKNOWN ... DO NOT RE-RUN apply. Run certify` instead of the misleading "rolled back" (343-346).
* **Credentials.** Only `.env.production-secrets.local` is read (33, 70); `GRAILKEY_CATALOG_ENVIRONMENT` must equal `production` (72); an unparseable value yields a generic error without echoing it (`directUrl`); every logged string is scrubbed against the password/URL (26-27); the URL never reaches a command line (only the `backup` subcommand uses child-process environment variables, and it is disabled without `--force-new-backup`, 239).
* **Endpoint and marker.** Pooled host rewritten to direct and re-checked (62-64); host must equal the verified hostname (75); `assertAdminDbTarget` (database `neondb`, `data1_dev`, environment identity) plus a second explicit `marker=production` and `current_database()='neondb'` check (77-80).
* **Six indexes and constraints by name and definition.** Exactly 6 indexes (330) with definition regexes for the primary key, `operator_authority_event_chain_uniq`, `..._attempt_phase_uniq` (partial, excludes `OPERATOR_RECONCILED`), `..._asset_idx`, `..._action_idx`, `..._review_idx` (partial, `AMBIGUOUS`); every `CONSTRAINT` name in the file plus a primary key must exist; exactly 3 triggers bound to `economic_ledger_immutable`; 30 columns; 0 rows.
* **Concurrent writes.** The transaction is REPEATABLE READ and compares row counts and structure of every pre-existing table at transaction start and again before COMMIT in the SAME snapshot (`start`/`end`), so a concurrent customer write cannot cause a false mismatch and any real difference was caused by this transaction. The step-4 recheck against the step-2 baseline is a separate, full check: if Production has changed since 19:40Z (likely — it is live) the script stops with nothing applied and the operator re-runs `check`. A tiny gap between the full recheck and the transaction is reported informationally, and a change between the pre-apply reference and transaction start aborts. Locks: `CREATE TABLE ... REFERENCES` briefly blocks writers to `gk_asset`, `gk_principal`, `operator_action_event` and `decision_event`; `lock_timeout` 5 s aborts safely if they cannot be locked.
* **Process termination / connection loss.** Before COMMIT: server-side rollback, nothing committed. During COMMIT: unknown, handled above. After COMMIT: `certify` reads the truth.
* **No destructive SQL against existing objects.** The migration may contain only: `SET search_path`, `CREATE TABLE IF NOT EXISTS operator_authority_event`, 1 `CREATE UNIQUE INDEX` and 3 `CREATE INDEX` on that table, and 3 `CREATE OR REPLACE TRIGGER` on that table, plus a read-only DO guard (lint refuses anything else and `apply` re-runs the lint). The script itself issues no DROP/DELETE/TRUNCATE/UPDATE/INSERT against any Production object; the rollback SQL is never read by it. `IF NOT EXISTS` would silently pass on a pre-existing table, so absence is asserted first (`preconditions`). The migration SQL is unmodified (SHA verified).
* **Known limits:** session `SET statement_timeout` (81) persists only for the script's connection; `maxTs` (newest timestamps) is compared at the step-4 recheck only, not inside the transaction; the pre-existing `SET search_path` inside the migration is session-scoped and dies with the connection.
After successful certification the script is to be removed and its removal verified (commands in H4); non-secret audit evidence (`baseline-step2.json`, `recheck-step4.json`, `backup-evidence.json`, `apply-evidence.json`, `post-commit.json`) is retained.

### H4 — operator commands (DO NOT EXECUTE until you have inspected the script; the executor will not run them)
Let `S` = `C:/Users/matam/AppData/Local/Temp/claude/C--Users-matam-OneDrive-Desktop-comic-vault/f03a756b-6984-43ae-a5e2-816c4f601818/scratchpad`.

**0. Stable copy + integrity (operator, one time).**
`! mkdir -p "C:/gk281/0040-exec" && cp "S/p0040-final.mjs" "C:/gk281/0040-exec/p0040.mjs" && cp "S/baseline-step2.json" "S/backup-evidence.json" "C:/gk281/0040-exec/" && sha256sum "C:/gk281/0040-exec/p0040.mjs" "C:/gk281/0040-exec/baseline-step2.json" "C:/gk281/0040-exec/backup-evidence.json"`
Expected SHA-256: script `840b2b3b507ef9fed1424c3819be04a312362d062245b042017d38fda8337e71`; `baseline-step2.json` `b46c3fe744c06a5d26e26e6c8f56d010e91089c7f05f1d1a9ad6dd8f91e65553`; `backup-evidence.json` `df21ff99c63347d135f0bd1c810e228ef9bdf4850a9dcfa605ac8a57c2c4eb6d`. **Any difference: STOP.** Optional offline check: `! node "C:/gk281/0040-exec/p0040.mjs" lint` (expect `LINT PASS (offline; no database connection was made)`).

**1. APPLY** — `! node "C:/gk281/0040-exec/p0040.mjs" apply`
* *Expected success:* `[db-admin-preflight] 0040 production: PASSED ...` · `connected credentialSource=.env.production-secrets.local host=ep-divine-sunset-afe153ur.c-2.us-west-2.aws.neon.tech db=neondb marker=production direct=true` · `preconditions {"absent":true,"fnPresent":true,"fkTargets":{...all true},"pgAtLeast14":true}` · `RECHECK@... tables=57 rows=N diffsVsStep2=0` · `IN-TRANSACTION VERIFICATION {... "cols":30, "rows":0, "indexTotal":6, "indexDefChecks":{all true}, 3 triggers, "preExistingTableDiffsCausedByThisTransaction":[], "tablesBefore":57,"tablesAfter":58, ... "pass":true}` · `COMMITTED start=... end=...`. (An `informational: N concurrent change(s)` block is allowed; Node prints a pg SSL-mode warning, harmless.)
* *Expected SAFE aborts (nothing committed):* `baseline changed since step 2 — nothing applied; run check again, then apply` (followed by the changed tables — Production is live; run `check` then `apply`); `precondition failed — stop (nothing applied)`; `artifact mismatch ...`; `migration lint failed ...`; `host differs ...`; `credential source ...`; `ROLLED BACK — verification mismatch; nothing committed`; `ERROR before COMMIT -> ROLLED BACK; nothing committed: <code>` (e.g. `55P03` lock timeout, `57014` statement timeout); `WATCHDOG ...` or Ctrl-C/closed terminal before the `COMMITTED` line (the server rolls the open transaction back).
* *Immediate STOP:* `COMMIT OUTCOME UNKNOWN` (do NOT re-run `apply` — run `certify`); `preconditions` showing `"absent":false` (the table already exists); any marker other than `production`; any output that looks like a credential or connection string; `pass:false` repeated after a re-check; anything unexpected in `preExistingTableDiffsCausedByThisTransaction`.
* *Could a Production transaction already have committed?* **Only if `COMMITTED` was printed — or if `COMMIT OUTCOME UNKNOWN` was printed, or the process/terminal was killed after `IN-TRANSACTION VERIFICATION ... "pass":true` and before you saw an outcome.** In every other output above, the single write transaction was rolled back or never opened (all earlier queries are read-only transactions that end in ROLLBACK). When in doubt, run `certify`; it is read-only.

**2. CERTIFY** — `! node "C:/gk281/0040-exec/p0040.mjs" certify` (read-only; safe to run any number of times)
* *Expected success:* `CERTIFY@... marker=production tablesNow=58 (recheck 57) ... newTableRows=0 cols=30 constraints=<n> indexes=6 triggers=3` · `pre-existing STRUCTURE diffs vs recheck: 0` · a list of the six indexes with definitions · `triggers:` three, `tgenabled` `O`. A non-zero `pre-existing ROW-COUNT diffs` line is EXPECTED if customers wrote after the apply; it does not indicate a defect of 0040.
* *Expected safe abort:* `ENOENT ... recheck-step4.json` (apply never reached the recheck) — read-only, nothing to undo.
* *Immediate STOP:* `tablesNow=57` or `newTableRows=undefined` after a printed `COMMITTED` (contradiction); `STRUCTURE diffs` > 0; `newTableRows` not 0; `indexes` not 6; `triggers` not 3; `marker` not `production`; any credential-looking output.
* *Production transaction:* none; certify only reads.

**3. After successful certification — remove the credential-reading script and verify (operator, or ask the executor):**
`! rm -f "C:/gk281/0040-exec/p0040.mjs" "S/p0040.mjs" "S/p0040-final.mjs"; ls -la "C:/gk281/0040-exec"; ls "S" | grep -i p0040 || echo "no p0040 script remains"`
Expected: `C:/gk281/0040-exec` holds only the five non-secret `*.json` evidence files and the last line prints `no p0040 script remains`. Then record the removal UTC time in the registry.

---
## EXECUTOR REVISION 2 (2026-10-13) — supersedes the script SHA and commands in H3/H4 above; migration still UNAPPLIED

Independent review of the 373-line script (SHA `840b2b3b…7e71`) found two defects, both corrected in `p0040-final2.mjs` (scratchpad, 513 lines), **SHA-256 `f133d6de4e0bb801aa90599fa6e00fc30a7a3e34fd1daed61e24d4e44d1f3594`**:
1. **`certify` now asserts.** It prints `PASS`/`FAIL` per assertion and ends `CERTIFICATION PASS` (exit 0) or `CERTIFICATION FAIL (n of m)` (exit 1): artifacts; apply evidence records a commit; new table exists; 30 columns; 0 rows; exactly 6 indexes, the exact name set, each by definition (PK, `chain_uniq`, `attempt_phase_uniq` partial, `asset_idx`, `action_idx`, `review_idx` partial); exactly 3 triggers, exact name set, each BEFORE with the right level (UPDATE/DELETE row-level, TRUNCATE statement-level) calling `economic_ledger_immutable()`, each enabled; every named constraint plus a primary key; pre-existing tables unchanged in columns/constraints/indexes/triggers with none added or removed; table count = previous + 1; extensions unchanged; marker `production`. Pre-existing ROW COUNT changes are informational only. `apply` uses the same new-table assertions inside the transaction before COMMIT.
2. **`apply` exit codes.** 0 = COMMITTED and verified; 1 = nothing committed (precondition/lint/baseline-changed/lock-timeout/verification mismatch/rollback/any error); 2 = COMMIT OUTCOME UNKNOWN; 3 = watchdog before COMMIT; 130 = signal. Only a confirmed `COMMITTED` exits 0. `check` exits 1 if a precondition fails; an unknown subcommand exits 1.
Offline proof (no database connection): `node --check` OK; `lint` PASS (exit 0); new `selftest` PASS 33/33 — it mutates synthetic facts (29/31 columns, 1 row, missing/extra/renamed/mis-defined/non-unique/non-partial indexes, missing/AFTER/row-level-truncate/wrong-function/disabled triggers, missing constraints) and synthetic censuses (added column, changed index/trigger count, second/dropped table, extension change, wrong marker) and requires FAIL for each, and PASS for the correct case; exit-code mapping 0/1/2; running `certify`/`apply`/unknown in an empty directory exits 1 without any database connection. The Production-side output format of `pg_get_indexdef`/`pg_get_triggerdef` is assumed from PostgreSQL's documented form (tolerant of optional schema prefixes); a cosmetic mismatch fails safe (apply rolls back; certify FAILs) rather than passing.

Windows PowerShell 5.1 commands (no `2>&1` on native commands; Node's SSL-mode warning prints to stderr and is harmless):
```powershell
# 1. copy the two evidence files WITHOUT overwriting or regenerating
$s = 'C:\Users\matam\AppData\Local\Temp\claude\C--Users-matam-OneDrive-Desktop-comic-vault\f03a756b-6984-43ae-a5e2-816c4f601818\scratchpad'
$d = 'C:\gk281\0040-exec'
foreach ($f in 'baseline-step2.json','backup-evidence.json') {
  $dst = Join-Path $d $f
  if (Test-Path -LiteralPath $dst) { "SKIPPED (exists, not overwritten): $f" }
  else { Copy-Item -LiteralPath (Join-Path $s $f) -Destination $dst -ErrorAction Stop; "COPIED: $f" }
}
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $d 'baseline-step2.json'),(Join-Path $d 'backup-evidence.json') | Select-Object Hash,Path
```
(Exact expected hashes, case-insensitive: `baseline-step2.json` `b46c3fe744c06a5d26e26e6c8f56d010e91089c7f05f1d1a9ad6dd8f91e65553`; `backup-evidence.json` `df21ff99c63347d135f0bd1c810e228ef9bdf4850a9dcfa605ac8a57c2c4eb6d`.)
```powershell
# 2. replace the stable script, gated on the reviewed hash
$new = Join-Path $s 'p0040-final2.mjs'
$exp = 'f133d6de4e0bb801aa90599fa6e00fc30a7a3e34fd1daed61e24d4e44d1f3594'
$got = (Get-FileHash -Algorithm SHA256 -LiteralPath $new).Hash.ToLower()
if ($got -ne $exp) { throw "scratchpad script hash mismatch: $got" }
Copy-Item -LiteralPath $new -Destination 'C:\gk281\0040-exec\p0040.mjs' -Force -ErrorAction Stop
$got2 = (Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\gk281\0040-exec\p0040.mjs').Hash.ToLower()
if ($got2 -ne $exp) { throw "installed script hash mismatch: $got2" }
"OK installed, SHA-256 $got2"

# 3. offline checks (no database connection) - both must print exit code 0
& node 'C:\gk281\0040-exec\p0040.mjs' lint;     "lint exit code: $LASTEXITCODE"
& node 'C:\gk281\0040-exec\p0040.mjs' selftest; "selftest exit code: $LASTEXITCODE"

# 4. execution (separate steps; only after inspecting the script)
& node 'C:\gk281\0040-exec\p0040.mjs' apply;   "apply exit code: $LASTEXITCODE"      # 0 only if COMMITTED
& node 'C:\gk281\0040-exec\p0040.mjs' certify; "certify exit code: $LASTEXITCODE"    # 0 only if CERTIFICATION PASS

# 5. after CERTIFICATION PASS: remove the credential-reading script and verify
Remove-Item -LiteralPath 'C:\gk281\0040-exec\p0040.mjs' -Force
Remove-Item -LiteralPath (Join-Path $s 'p0040.mjs'),(Join-Path $s 'p0040-final.mjs'),(Join-Path $s 'p0040-final2.mjs') -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path 'C:\gk281\0040-exec',$s -Filter 'p0040*' -Recurse -ErrorAction SilentlyContinue | Select-Object FullName   # expect: nothing listed
Get-ChildItem 'C:\gk281\0040-exec' | Select-Object Name,Length                                                            # expect: only *.json evidence
```
Reading the exit codes: `apply` 0 = committed; 1 = nothing committed; 2 = commit outcome unknown -> run `certify`, never re-run `apply`; 3 = watchdog before commit. If `apply` reports "baseline changed since step 2" (Production is live), run `check` (read-only, overwrites `baseline-step2.json` in the stable directory) and then `apply` again.
