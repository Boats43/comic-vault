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

### 4a. MANDATORY verified cleanup (standing rule, B1 Release Gate v2 G3)
**Every Production-data restore drill ends with verified deletion of ALL temporary copies. A drill is not complete, and must not be reported complete, until this checklist has been run and its output recorded.** Read-only checks only; never touch containers/volumes that belong to another lane (notably `grailkey-gcd-staging-mysql` and volume `grailkey_gcd_staging_mysql_data` — the DATA-0E-FULL lane; record their state, never change it).
1. `docker ps -a` — no restore container (e.g. `gk-restore-check`) remains.
2. `docker volume ls` and `docker volume ls --filter dangling=true` — no anonymous or restore volume remains.
3. `docker images` — the `postgres:<major>` image used for the drill is removed.
4. For every remaining container, `docker inspect … .Mounts` — no bind mount of the backup directory (`C:\gk-backups`) or of any decrypted-dump location.
5. On the host: no decrypted dump, no decrypt temp directory, no `.env`-derived file left; `Get-ChildItem C:\gk-backups -Recurse` shows only `*.gpg`, `MANIFEST.txt` and the `keys\` folder.
6. Stop Docker Desktop if it was stopped before the drill.
Record: UTC time, each command's result, and the unchanged state of the staging MySQL container.
**Result 2026-10-12 (G3):** no Postgres container, no volume other than `grailkey_gcd_staging_mysql_data`, no dangling volume, only image `mysql:8.0.46` (belongs to the staging lane), no bind mount of `C:\gk-backups`. `grailkey-gcd-staging-mysql`: status exited, exit code 255, finished 2026-10-12T20:50:28Z, restartPolicy `no`, mounts `C:\grailkey-data\gcd\staging`→`/staging` and the named volume — observed read-only, unchanged by this dispatch (it was already exited before Docker was started for the check; its exit 255 coincides with Docker Desktop being stopped after the restore drill — cause recorded as observed, not investigated, not restarted).

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
* The backup is a **single local copy on one machine's disk** (now encrypted at file level — see §7 — but with no independent second copy). Nothing was copied off the machine.
* A logical backup restores **data and schema**; it is not a point-in-time recovery and does not replace the Neon restore window.

## 7. Encryption, copies and retention (B1 Release Gate v2 G2)
**Executed 2026-10-12, locally, without accessing Production.** The plaintext dump and schema copy were encrypted with GnuPG symmetric AES-256 (SHA-512 S2K, 65,011,712 iterations, integrity-protected, no compression). The passphrase is a random 384-bit value generated inside the script and written only to `C:\gk-backups\keys\backup-passphrase-20261012-6ee107.txt` (65 bytes, never printed, never in Git, not under OneDrive). `C:\gk-backups` has an inheritance-removed ACL granting only the operator account.

| File (`C:\gk-backups\production\`) | Size | Ciphertext SHA-256 |
|---|---|---|
| `…20261012T204832Z.dump.gpg` | 3,433,973 | `8a33472f786819dceb22ed09d1288d463a45bcb1a2663cc72a15d876ae4b31d4` |
| `…20261012T204832Z.schema-only.sql.gpg` | 132,382 | `ed2cb4a4fdf8103c2317a0540010975c36f52e694a18d14580f17115e3026d57` |

Verified: decrypting reproduces the recorded plaintext SHA-256s (`535de99c…b03b54`, `993eaaca…0789bc`); the decrypted dump passes `pg_restore --list` (480 entries); a one-bit change to the ciphertext is detected (decrypt exit 2); a wrong passphrase is rejected; the plaintext dump, plaintext schema copy and every decrypted temporary were overwritten with random bytes and deleted (best effort — SSD wear-levelling and OneDrive/VSS shadow copies are not guaranteed to be purged), and `MANIFEST.txt` replaces `SHA256SUMS.txt`.

**Limits, stated plainly:**
* **No independent second copy exists.** The machine has one volume on one physical disk; there is no removable, network or second-drive storage. **G2's "second encrypted copy on independent storage" is BLOCKED, not done.** Uploading ciphertext to OneDrive would be off-machine but is a cloud-sync location and was NOT done without the operator's decision. Options: an external drive/USB stick (copy the two `.gpg` files + `MANIFEST.txt`), or — the operator's explicit say-so — the ciphertext (only) to cloud storage.
* **The passphrase file lives on the same disk as the ciphertext.** This protects against casual exposure/copying of the dumps, not against loss or compromise of this machine. **Key custody must move to the operator**: store the passphrase in the operator's password manager and keep it apart from the ciphertext copy; without it the backup is unrecoverable.
* Disk encryption (BitLocker) status is UNKNOWN (querying it needs administrator rights).
* Decrypt command (for the operator): `gpg --batch --pinentry-mode loopback --passphrase-file <keyfile> --decrypt -o <out> <file>.gpg` into a throwaway folder, followed by §4a cleanup.

**Proposed retention and secure deletion (30 days; operator to ratify).**
1. Keep an encrypted backup for **30 days** from its creation, then delete it (and every copy). Keep the migration-time backup until 0040 has run clean in Production for 30 days.
2. A newer backup does not require keeping older ones past 30 days; keep at most the latest two.
3. Deletion = overwrite then delete each `.gpg` copy on every medium that holds one, then destroy the passphrase file/password-manager entry for that backup; record the UTC date in `MANIFEST.txt`. Backup media that cannot be overwritten reliably (SSD, cloud) rely on key destruction as the guarantee, which is why one passphrase per backup set is used.
4. Plaintext is never kept: a decrypted copy exists only inside a drill and is removed under §4a.
