# Migration 0040 — exact Production checklist (B1 Release Gate v2 G5; NOTHING HERE IS AUTHORIZED)

Runs only after the operator writes **`PRODUCTION MIGRATION 0040 AUTHORIZED`**. Stop on the first failed check; do not improvise. Push and deploy are separate (`PUSH AUTHORIZED`, `DEPLOY AUTHORIZED`) and come AFTER this migration, never before.

## A. Before (read-only)
1. Release candidate unchanged: `git rev-parse b1-first-outcome-authority` = `f9f159c2f1e685f47e84b3545ed85e8c4152f37f`; worktree clean.
2. Artifact hashes (must match exactly):
   * `db/data0/0040_operator_manual_authority.sql` = `6641e24b41cb49f15b37a99179f87d6e877833ba943d1e7b3e384f13d9584830`
   * `db/data0/0040_operator_manual_authority_rollback.sql` = `5b0a0990f39348a33c2cba97a11b8bf8635d858e8856d9c6b1e36572eaf3831b`
3. **Operator confirms in the Neon Console** the current plan and restore (history-retention) window, and records the UTC timestamp. Last known: Free tier, 6-hour window (2026-09-01). **Currently UNCONFIRMED.** If the window cannot be confirmed, the encrypted logical backup is the only recovery — proceed only by explicit operator decision.
4. Production identity: `data1_dev.environment_marker` = `production` on the exact endpoint (direct, non-pooled) to be used. `operator_authority_event` does NOT exist.
5. Production still at `b403f33` (live deployment and `origin/main`).
6. **Fresh backup if any Production write happened since 2026-10-12T20:48Z** (check max `recorded_at`/`created_at` across the ledgers and `collection_item.updated_at`); otherwise the encrypted 2026-10-12 backup stands. Either way re-verify decryptability (`docs/PRODUCTION-BACKUP-RESTORE-PROCEDURE.md` §7) and confirm the passphrase is in the operator's custody. Any restore drill ends with §4a verified cleanup.
7. Snapshot every table's row count (baseline: 57 tables, 593 rows on 2026-10-12; use the live numbers, not these).
8. Credential handling: connection string read from the ignored local env file into child-process environment only; never printed; scripts contain no credential.

## B. Apply (one transaction)
`BEGIN; <0040 file contents>; <verification queries>; COMMIT` — or `ROLLBACK` on any mismatch. No other statement. No pooled endpoint.

## C. Expected catalog values (verify INSIDE the transaction, before COMMIT)
* table `data1_dev.operator_authority_event` exists, **30 columns**, **0 rows**
* indexes: primary key + **4 further indexes** (the partial unique `(attempt_id, phase)` excluding OPERATOR_RECONCILED, plus asset, action and review-deadline indexes)
* **3 immutability triggers** reusing `economic_ledger_immutable()` (UPDATE, DELETE, TRUNCATE)
* declared CHECK/FK constraints exactly as in the file (named constraints present)
* **every other table's row count byte-identical** to the A.7 snapshot; table/column/constraint/index counts of all other tables unchanged (baseline 599 constraints and 164 indexes before the change)
* extensions unchanged (`pg_trgm`, `plpgsql`); `environment_marker` still `production`

## D. Abort / rollback rules
* Any expected value differs → `ROLLBACK`, record, stop. Do not retry without a fresh review.
* After COMMIT, rollback = drop the new table (`…_rollback.sql`) **only while it has zero rows**; once any authority row exists, preserve it and use a forward fix or compatible application rollback (`docs/B1-RC-RELEASE-PLAN.md` §2).
* A failed or partial run is never "fixed" by editing the migration; the file hash must still match.

## E. After (read-only)
1. Re-run C against committed state; row counts of all other tables unchanged; new table 0 rows.
2. Old app (`b403f33`) still serves: `GET` health/collection reads unaffected (no deploy has occurred; compatibility measured as OLD app + MIGRATED schema = compatible).
3. Record before/after in the registry. **Do not deploy in the same step.**

## F. Still required afterwards (separate words)
`PUSH AUTHORIZED` → `DEPLOY AUTHORIZED` → read-only certification (Release plan §5 steps 3-6) → separate approval for ONE founder-supervised OPERATOR_MANUAL listing. READY-path listings stay uncertified (GK-294).

---
**Update 2026-10-13:** item A.3 is satisfied — Neon Console (operator-verified): Free plan, 6-hour history retention, PostgreSQL 18, 0.25 CU, network transfer 81.4% used; no waiver. The 2026-10-12 backup no longer stands (A.6): a fresh encrypted backup is required. Execution detail, the proposed `SET LOCAL lock_timeout/statement_timeout` amendment to §B, and the authorization text: `docs/B1-MIGRATION-0040-AUTHORIZATION-CHECKPOINT.md`.


---
**Executed 2026-10-13:** this checklist was run (see `docs/B1-MIGRATION-0040-AUTHORIZATION-CHECKPOINT.md`); certification 37/37 PASS. Correction: the expected index total for `operator_authority_event` is **6**, not "primary key + 4" — the `UNIQUE` constraint `operator_authority_event_chain_uniq` is backed by a fifth secondary index.
