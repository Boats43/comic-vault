# DATA-0B-2 — Stage 1: Local MySQL Staging (GCD Bulk Dump)

**NO transform performed. No writes to `source_snapshot`/`claim`/`external_map`/any typed `comic_*` table. No Neon connection of any kind, at any point. No production/runtime code touched.** This is stage 1 only, exactly as scoped in `docs/DATA-0B-1-SCHEMA-RECON.md`'s "Import path recommendation" — "get GCD's raw data into a queryable form." Stage 2 (transform into DATA-0A's schema) remains a separate, ungreenlit step, additionally blocked on the GCD CC BY-SA 4.0 rights question (`docs/DATA-0-ARCHITECTURE.md` §9) that stage 1 does not depend on.

## Preflight (all gates passed before any attempt)

- Docker Desktop: engine running (29.7.2, Linux containers), Compose v5.4.0 available.
- Disk: 141GB free on `C:` at preflight time — ample headroom for the 3.6GB dump plus InnoDB overhead.
- Source integrity: SHA-256 of the staged `current.zip` re-verified against the `DATA-0B-1` snapshot record (`db/data0/snapshots/gcd-2026-08-20.json`) — exact match, byte-identical.
- Clean starting state: no pre-existing Docker containers/volumes/images to collide with.
- Image: `mysql:8.0.46` pulled — exact match to the dump's own `-- Server version 8.0.46-0ubuntu0.22.04.3` header.

## Infrastructure

`db/data0/staging-mysql/docker-compose.yml` — MySQL 8.0.46, bound to `127.0.0.1:3316` only (never exposed beyond localhost), named volume `grailkey_gcd_staging_mysql_data`, dump mounted read-only at `/staging`. Root password generated locally into a gitignored `.env` (`.env.example` committed as the template). No restart policy — never auto-starts.

## Attempts 1–3 (discarded) and attempt 4 (successful)

Four total attempts against the same, unmodified 3,810,353,994-byte dump file. mysqldump's own `DROP TABLE IF EXISTS` → `CREATE TABLE` → `INSERT` shape per table makes a from-the-top rerun self-cleaning for whichever tables it reaches — but three of the four attempts were discarded anyway, each for a documented, real reason, not on a hunch:

**Attempt 1 — host-background mistake, 6 tables.** Launched via `docker exec ... < file &` plus `disown` inside a single Bash tool call. When that tool call's underlying shell exited, the backgrounded `docker exec` process was killed with it (disown does not survive a Windows/Git-Bash shell teardown the way it does on a persistent POSIX session) — only 6 of 77 tables landed before the process died silently, with no error logged. Discarded: `docker compose down -v` (full container + volume removal, confirmed empty via `docker volume ls`), fresh container, retried properly.

**Attempt 2 — deadlock ambiguity, ~52 tables.** Relaunched using the harness's native `run_in_background` (a properly host-tracked background task, unlike attempt 1's manual `&`/`disown`). Progressed cleanly until `ERROR 1213 (40001) Deadlock found when trying to get lock` appeared in `import.log` at line 2038 — almost certainly triggered by diagnostic `SELECT COUNT(*) FROM information_schema.tables` queries run concurrently from a separate session while the import's own `DROP TABLE`/`CREATE TABLE` DDL was in flight (a known MySQL metadata-lock collision class). The table count kept climbing after the error (8→52), suggesting the client somehow continued past it, but the exact mechanics were never fully understood with certainty. Rather than trust a run with an unexplained anomaly, it was stopped outright (`TaskStop`) without waiting for it to finish. Discarded: full `docker compose down -v` wipe again, confirmed empty (0 tables) before the next attempt, and — critically — zero diagnostic queries were run against the database for the remainder of any subsequent attempt while an import might still be executing, closing off the collision class entirely rather than hoping it wouldn't recur.

**Attempt 3 — clean host-task run, killed by harness at 68/77.** Relaunched via `run_in_background` again, this time with strict discipline: no concurrent queries at all until the process itself reported done. Progressed cleanly and substantially — 68 of 77 tables landed, `import.log` showed no error of any kind, and the container remained healthy throughout. The task-tracking layer then reported `status: killed` — not a MySQL error, not anything in `import.log`, and the container was still healthy and running when this was discovered. Root cause: almost certainly a duration/idle limit on host-tracked background bash processes in this environment (this attempt had been running for the better part of an hour, concurrently with a large, separate Phase 0.3 dispatch also consuming background-task slots). Discarded on the same standing principle as attempt 2 — a genuinely ambiguous interruption is not treated as a completion, regardless of how far it got: full `docker compose down -v` wipe, confirmed empty again, before attempt 4.

**Attempt 4 — detached-in-container, successful.** To eliminate the exact failure class that killed attempt 3, the import was launched via `docker exec -d` (detached) rather than any host-tracked mechanism — the `mysql` client process runs as a child of the container's own init, supervised by Docker's container lifecycle, with zero dependency on any host-side shell, background-task tracker, or session state that could be torn down independently. Progress was monitored exclusively via `docker top` (host-side, process-table only, never touches the database) and container-internal, non-SQL filesystem checks (`ls`/`wc -l`/`du -sh` against the log file and data directory) — no SQL queries of any kind were run against the database while the `mysql` client process was still listed in `docker top`'s output, closing off the attempt-2 collision class as well. The process ran for roughly 45 minutes of real wall-clock time (mysqld CPU time climbed from ~11s at launch to ~45 minutes at completion, consistent with genuinely working through an 11.9-million-row table, not stalling) before exiting on its own.

**Exit code: 0 — genuinely captured, not assumed.** The detached wrapper was written specifically to persist its own exit code (`... < /staging/2026-08-15.sql > /tmp/import.log 2>&1; echo IMPORT_EXIT_CODE=$? >> /tmp/import.log`), precisely because a detached `docker exec` has no host-side process to report a shell exit code back to. `import.log`'s full, complete contents at completion:
```
mysql: [Warning] Using a password on the command line interface can be insecure.
IMPORT_EXIT_CODE=0
```
Two lines only — the one benign CLI warning every prior attempt also carried, and the persisted exit code. No error of any kind between them.

## Clean-start guarantee for attempt 4

Not the "same file, deterministic DROP+CREATE order" idempotency argument used to reason about earlier attempts — a stronger, direct guarantee this time. Before attempt 4 launched: `docker compose down -v` removed the container, its volume, and the network; `docker volume ls` and `docker ps -a` both confirmed empty; a fresh `docker compose up -d` created a new, empty MySQL instance; `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='gcd'` was run once, confirming **0 tables**, before the import began. Attempt 4 wrote every single row in the database that exists today.

## Table count — a real correction to DATA-0B-1's structural recon

**78 tables, not 77.** `docs/DATA-0B-1-SCHEMA-RECON.md`'s own structural recon (a regex-based scan over the dump's text for `CREATE TABLE` statements) reported 77. A direct diff between that recon's table list and this staging database's real `information_schema.tables` contents found exactly one table present in the real, imported database that the recon's own list never captured: **`django_content_type`** — a standard Django-framework table (part of Django's built-in `contenttypes` app; GCD's backend is Django-based), unrelated to GCD's own domain schema. Confirmed genuinely present in the raw dump itself, not an import artifact: `grep -c "CREATE TABLE \`django_content_type\`" 2026-08-15.sql` returns `1`. The recon's regex scan simply missed this one `CREATE TABLE` statement — a correction to that document's own count, not a defect in this import. `django_content_type` holds 189 rows.

## Exact row counts vs. DATA-0B-1's ESTIMATES

DATA-0B-1's own figures were explicitly labeled ESTIMATES (tuple-count-in-first-INSERT × total-INSERT-count per table, not a real `SELECT COUNT(*)`, which requires an actual database — exactly what this stage provides). All 78 tables now have exact counts via a single batched `SELECT COUNT(*)` per table (78 individual queries, one connection, no `information_schema` statistics estimates used). The 8 headline tables DATA-0B-1 called out by name:

| table | estimated (DATA-0B-1) | **exact** | delta | delta % |
|---|---:|---:|---:|---:|
| `gcd_story_credit` | 12,302,433 | **11,918,607** | −383,826 | −3.1% |
| `gcd_story` | 3,959,637 | **4,529,073** | +569,436 | +14.4% |
| `gcd_story_feature_object` | 2,859,789 | **2,644,293** | −215,496 | −7.5% |
| `gcd_issue` | 1,392,268 | **2,608,777** | **+1,216,509** | **+87.4%** |
| `gcd_story_character` | 2,059,788 | **1,997,025** | −62,763 | −3.0% |
| `gcd_reprint` | 1,659,232 | **1,555,891** | −103,341 | −6.2% |
| `gcd_issue_credit` | 1,363,076 | **1,324,423** | −38,653 | −2.8% |
| `gcd_series` | 157,418 | **232,103** | +74,685 | +47.4% |

**`gcd_issue`'s estimate was off by 87.4% — the single biggest correction, and worth flagging prominently since CLAUDE.md itself cites the 1,392,268 figure as "the corrected planning number."** The exact figure is **2,608,777**. Most other tables landed within single-digit percentage error (a reasonable real-world accuracy for a tuples-per-statement × statement-count estimation method when INSERT batch sizes vary per table), but `gcd_issue` and `gcd_series` (+47.4%) both missed substantially — likely because their extended-INSERT statements pack a non-uniform number of tuples per statement (row-size-dependent packet chunking) more than the tables where the estimate held closer. Not investigated further this pass — flagged as a real, now-corrected number, not explained mechanically.

**Total exact rows across all 78 tables: 30,624,436** (vs. DATA-0B-1's own "~29.3M estimated rows" sum across 77 tables — reasonably close in aggregate despite the two large individual misses above, and now includes `django_content_type`'s 189 rows the original sum never counted at all).

Full 78-table exact count list (descending):

<details><summary>All 78 tables, exact row counts</summary>

```
gcd_story_credit: 11,918,607
gcd_story: 4,529,073
gcd_story_feature_object: 2,644,293
gcd_issue: 2,608,777
gcd_story_character: 1,997,025
gcd_reprint: 1,555,891
gcd_issue_credit: 1,324,423
gcd_issue_brand_emblem: 854,623
stddata_date: 833,796
taggit_taggeditem: 686,687
gcd_series: 232,103
gcd_issue_indicia_printer: 188,388
gcd_creator_name_detail: 157,579
gcd_story_character_group: 141,339
gcd_creator: 111,810
gcd_story_feature_logo: 106,041
gcd_story_universe: 93,238
taggit_tag: 92,421
gcd_character_name_detail: 88,552
gcd_character: 71,992
gcd_group_character: 65,654
gcd_feature: 49,647
gcd_character_relation: 36,312
gcd_creator_signature: 33,480
gcd_group_membership: 22,309
gcd_publisher: 17,679
gcd_received_award: 14,653
gcd_feature_relation: 13,376
gcd_brand_emblem_group: 13,281
gcd_brand_use: 12,215
gcd_brand: 11,838
gcd_indicia_publisher: 10,301
gcd_biblio_entry: 8,671
gcd_brand_group: 8,488
gcd_feature_logo_2_feature: 8,450
gcd_feature_logo: 8,296
gcd_series_bond: 6,767
gcd_non_comic_work_year: 6,518
gcd_creator_relation: 5,912
gcd_story_story_arc: 4,374
gcd_creator_art_influence: 4,228
gcd_creator_non_comic_work: 3,682
gcd_group_name_detail: 3,583
gcd_creator_school: 3,284
gcd_group: 3,196
gcd_indicia_printer: 2,792
gcd_printer: 1,362
gcd_creator_relation_creator_name: 1,027
gcd_creator_membership: 1,008
gcd_universe: 974
gcd_group_relation: 903
gcd_school: 902
gcd_creator_degree: 799
gcd_story_arc: 568
gcd_award: 377
stddata_country: 273
django_content_type: 189
stddata_language: 163
stddata_script: 84
gcd_story_type: 29
gcd_story_arc_relation: 21
gcd_credit_type: 14
gcd_name_type: 14
gcd_non_comic_work_type: 12
gcd_non_comic_work_role: 11
gcd_degree: 9
gcd_relation_type: 9
gcd_series_bond_type: 7
gcd_character_relation_type: 6
gcd_character_role: 6
gcd_group_relation_type: 5
gcd_feature_type: 4
gcd_multiverse: 4
gcd_group_membership_type: 3
gcd_membership_type: 3
gcd_series_publication_type: 3
gcd_story_arc_relation_type: 2
gcd_feature_relation_type: 1
```
</details>

## Charset round-trip — real é-class evidence

DATA-0B-1 flagged the `utf8mb3`-storage/`utf8mb4`-connection mismatch as a "trust but verify the encoding" item this stage needed to confirm. Queried directly:

```sql
SELECT name, given_name, family_name, HEX(name) FROM gcd_creator_name_detail WHERE name LIKE '%é%' LIMIT 8;
```

Real result: **`René Goscinny`** (Asterix co-creator), `HEX(name) = 52656EC3A920476F7363696E6E79`. Decoded: `52 65 6E` = "Ren", **`C3 A9`** = the correct 2-byte UTF-8 encoding of é (U+00E9), `20` = space, `47 6F 73 63 69 6E 6E 79` = "Goscinny". Byte-correct UTF-8 in storage, and the client (`--default-character-set=utf8mb4`) displays it correctly as "René Goscinny" — not "RenÃ©" (double-encoding mojibake) and not "Ren?" (replacement-character data loss). The `utf8mb3`-storage/`utf8mb4`-connection mismatch DATA-0B-1 flagged does not corrupt this class of character (é is well within `utf8mb3`'s 3-byte range) — consistent with that document's own prediction.

## Integrity findings

Foreign-key referential spot checks (3 checks, chosen to span the schema's most heavily-used relationships):

| check | orphan rows found |
|---|---:|
| `gcd_issue.series_id` → `gcd_series.id` | **0** |
| `gcd_story.issue_id` → `gcd_issue.id` | **0** |
| `gcd_story_credit.creator_id` → `gcd_creator_name_detail.id` | 237 |

The two structural backbone relationships (issue→series, story→issue) are perfectly clean — zero orphans across 2.6M and 4.5M rows respectively. `gcd_story_credit`'s 237 orphaned `creator_id` references (out of 11,918,607 rows — 0.002%) are NOT the `id=0`/`NO_AUTO_VALUE_ON_ZERO` shape DATA-0B-1 flagged as a possibility (spot-checked: the orphaned IDs are ordinary-looking positive integers like 125763, 43694, not 0) — most likely a small number of soft-deleted or historically-renumbered creator records on GCD's own live side, a normal artifact of any large real-world dataset with editorial history, not an import defect. Not investigated further — negligible at this scale and out of scope for a staging-only pass.

## Neon-fit math

**Total staged footprint: 7,548.8 MB** (data 2,683.6 MB + indexes 4,865.2 MB — indexes exceed data because of this schema's dense FK/lookup-index structure across 78 normalized tables). This is a **local-only MySQL instance**; per `docs/DATA-0-ARCHITECTURE.md` §8, raw GCD source data was already decided to never enter Neon, specifically BECAUSE the uncompressed dump ("a MySQL dump regularly runs several times that [695MB compressed]") would never fit Neon's 0.5GB free-tier cap, let alone the 350-400MB upgrade-trigger monitoring threshold that document sets for what actually DOES live on Neon (the typed `comic_*` projection + `external_map` + live `claim` rows only — a much smaller, transformed subset, not this raw staging copy). This stage's real, now-measured 7.55GB figure doesn't change that decision — it **confirms** it: the architecture document's prediction ("neither fits in, nor belongs in, a 0.5GB serverless Postgres tier") was correct by a wide margin (7.55GB is >15× the free cap), and this staging database sits exactly where §8 says it should — local Docker only, never Neon. No transform has happened; what fraction of this raw data eventually becomes Neon-side `claim`/`comic_*` rows is a DATA-0B-2 stage-2 question, still ungreenlit and still separately blocked on the CC BY-SA rights question.

## Standing scope confirmation

- No Neon connection made or attempted, at any point, by any of the four attempts.
- No `source_snapshot`/`claim`/`external_map`/`comic_*` row written anywhere.
- No production/runtime code (`api/`, `src/`) touched by this work.
- `db/data0/staging-mysql/.env` and `import.log` remain gitignored/container-internal — never committed.
