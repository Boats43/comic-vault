# Production logical backup and non-Production restore procedure (B1 preflight P2)

Status: executed once, 2026-10-12, read-only against Production. Applies to the Production Neon database (`neondb`, schemas `public` and `data1_dev`). **No Production schema or data mutation is part of this procedure.**

## 1. Rules
* The backup holds **personal and operational Production data** (collection rows, principals, marketplace-connection metadata). It lives **outside the repository and outside any cloud-synced folder** (`C:\gk-backups\production`, not under OneDrive) with an access list restricted to the operator account. It is never committed, pasted or attached.
* **Credentials never appear on a command line, in a log, in a committed file or in a temporary script.** The database credential is read from the local ignored env file at run time and handed to child processes **only through their environment** (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`). Scripts used for the run contain no credential and are deleted afterwards.
* Identity is proven before anything is dumped: the Production `data1_dev.environment_marker` must read `production` on the exact endpoint being dumped.

## 2. Taking the backup
1. Use the **direct** (non-pooled) endpoint: the pooled hostname minus `-pooler`. pg_dump must be the same major version as the server (18.x here).
2. `pg_dump --format=custom --compress=6 --no-owner --no-privileges --file=<dir>\grailkey-production-neondb-<UTC>.dump` (a single repeatable-read snapshot: consistent, read-only).
3. Also write `--schema-only` plain SQL beside it for human diffing.
4. Record: absolute path, UTC timestamp, size in bytes, SHA-256 (also written to `SHA256SUMS.txt` in the same directory).
5. Restrict access: `icacls <root> /inheritance:r /grant:r "<operator>:(OI)(CI)F"`.

## 3. Verifying integrity
* `pg_restore --list <dump>` must succeed (the table of contents is read end to end); count the `TABLE DATA` entries and compare with the live table count.
* Re-hash after writing; it must equal the recorded SHA-256.

## 4. Non-Production restore test (a real restore, not a listing)
Restore target: a **throwaway `postgres:<server major>` container**, **no published ports**, the backup directory mounted **read-only**, a random one-time password that dies with the container.
1. `docker run -d --rm --name gk-restore-check -e POSTGRES_PASSWORD=<random> -v <backupdir>:/backup:ro postgres:18`
2. `createdb restore_check`, then `pg_restore --no-owner --no-privileges --exit-on-error --dbname=restore_check /backup/<dump>` — **zero errors required**.
3. Compare **every table's row count** with Production (read-only `count(*)` per table inside a `READ ONLY` transaction), plus constraint count, index count, the environment marker, `economic_ledger_immutable()`, `uuidv7()`, the `decision_event` immutability triggers, and the extension list.
4. **Destroy the target completely**: `docker rm -f -v gk-restore-check` (**include `-v`**: without it the anonymous data volume — a full copy of Production data — survives; the 2026-10-12 run left one and it was removed by hand), then confirm `docker volume ls --filter dangling=true` is empty and remove the downloaded image.
5. Do not restore into Development or into any Neon project: Production data must not be mixed into another environment.

## 5. Result of the 2026-10-12 run (nothing here is a credential)
| Item | Value |
|---|---|
| Backup | `C:\gk-backups\production\grailkey-production-neondb-20261012T204832Z.dump` |
| Created (UTC) | 2026-10-12T20:48:46.843Z |
| Size | 3,433,852 bytes |
| SHA-256 | `535de99ce8658361f9a0553680e204bf52f7513d8db7572c018c34534eb03b54` |
| Schema-only copy | `…20261012T204832Z.schema-only.sql`, 132,250 bytes, SHA-256 `993eaaca042a016ca84a3202ba5c7c136e47f244b84508005868f3cb360789bc` |
| Source | Neon PostgreSQL 18.6, database `neondb`, 20 MB, 57 tables, extensions `pg_trgm`, `plpgsql`; marker `production` |
| Integrity | TOC readable (480 entries, 57 table-data entries); re-hash equal |
| Restore | `pg_restore --exit-on-error` exit 0 into PostgreSQL 18.6; 57/57 tables and 593/593 rows equal Production; constraints 599 = 599; indexes 164 = 164; marker `production`; ledger function, `uuidv7()` and 3 `decision_event` triggers present |
| Cleanup | container removed; the leftover anonymous volume removed; image removed; Docker Desktop stopped (it was stopped before the run) |

## 6. What this does NOT establish
* **The Neon plan and the restore (history-retention) window were NOT confirmed.** The Vercel integration API refused access (403) and there is no Neon API credential or CLI here. The last recorded figure is the 2026-09-01 drill: **Free tier, 6-hour restore window** (`docs/MASTER-BOARD.md`, D2.4). The operator must read the current plan and window in the Neon Console and record them with a UTC timestamp before any migration.
* The backup is a **single local copy on one machine's disk**. Whether it is additionally encrypted (e.g. disk encryption) or copied off the machine is an operator decision; nothing was copied anywhere.
* A logical backup restores **data and schema**; it is not a point-in-time recovery and does not replace the Neon restore window.
