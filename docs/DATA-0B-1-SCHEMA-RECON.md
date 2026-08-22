# DATA-0B-1 — GCD Snapshot Intake + Schema Recon

**NO IMPORT performed. No database provisioned. No row DATA copied into
this repo — only structural metadata (table/column/key names, ESTIMATED
row counts).** Import itself is DATA-0B-2, a separate, ungreenlit step.

## Intake

| | |
|---|---|
| Original file | `C:\Users\matam\Downloads\current.zip` (untouched, still present) |
| SHA-256 | `3B0383AAA215B0E670980C3B5DF83327759750F7D6DB8E1857059B385679300F` |
| Size | 729,453,389 bytes (695.66 MB) — matches the expected ~695MB |
| Staged copy | `C:\grailkey-data\gcd\current.zip` — **copy, not move**; byte-identical SHA-256 verified against the original after copy |
| Extracted to | `C:\grailkey-data\gcd\staging\2026-08-15.sql` |
| Snapshot record | `db/data0/snapshots/gcd-2026-08-20.json` (repo-committed intake provenance, in the shape `source_snapshot`'s r2 fields — `source_uri`, `ingestion_run` — are designed to hold once real ingestion exists) |
| Schema recon | `db/data0/snapshots/gcd-2026-08-15-schema-recon.json` (repo-committed, structural metadata only) |

**Real source_version recovered, not assumed.** The zip's single entry
is named `2026-08-15.sql` — GCD's own bi-weekly-regeneration version
stamp, discovered directly from the archive contents rather than
guessed. The snapshot record has been corrected to `"2026-08-15"`
accordingly (it was written as `"unknown"` before extraction).

## What the dump actually is

A single 3,633.8 MB (uncompressed) plain-text **MySQL 8.0 mysqldump**
file — not a binary/physical dump, not multiple files. Header:

```
-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
-- Host: mysql0a.comics.org    Database: gcd
-- Server version 8.0.46-0ubuntu0.22.04.3
```

Standard mysqldump shape throughout: `DROP TABLE IF EXISTS` →
`CREATE TABLE` → `LOCK TABLES ... WRITE` → `INSERT INTO ... VALUES (...)`
(extended-insert, many row-tuples per statement) → `UNLOCK TABLES`, per
table. `SQL_MODE='NO_AUTO_VALUE_ON_ZERO'` is set — some tables may
carry explicit `id=0` rows GCD's own schema treats as meaningful (not
yet confirmed which; flagged for DATA-0B-2).

## Schema recon results

**77 tables total.** Full structural detail (every column, primary key,
unique keys, foreign keys, engine, per-table charset, estimated row
count) committed at `db/data0/snapshots/gcd-2026-08-15-schema-recon.json`.
Highlights:

**Row count reality check — genuinely measured, not assumed, but itself
superseded — see the correction immediately below before citing any
number in this section.** The brief's own working figure was "2.2M-issue
catalog." The dump's actual `gcd_issue` table estimated to **~1,392,268
rows** (524 INSERT statements × ~2,657 tuples/statement) — lower than
2.2M, and at the time this looked like the corrected planning number.
(Estimation method: tuple count in each table's first INSERT statement ×
total INSERT statement count for that table — labeled ESTIMATE throughout,
not an exact `SELECT COUNT(*)`, which requires an actual database and was
DATA-0B-2's own job.)

**SUPERSEDED 2026-08-22 (DATA-0B-2, commit `6ea422c`) — do not cite
1,392,268 as "the corrected planning number" going forward; it is not
corrected, it is superseded.** The real `SELECT COUNT(*)` against the
fully-loaded database is **2,608,777** — the estimate above undercounted
by **+87.4%**, the largest miss of the 8 headline tables DATA-0B-2
checked. `gcd_issue` is not exceptional among this recon's estimates —
`gcd_series` also missed by +47.4% (157,418 estimated vs. 232,103 exact)
— but it is the single largest correction found. Full exact figures for
all 78 tables (not 77 — this recon's own regex scan also missed
`django_content_type`, a Django-framework table, confirmed present in the
raw dump directly): `docs/DATA-0B-2-STAGING.md`.

**Largest tables by estimated rows:**

| table | est. rows | what it is |
|---|---:|---|
| `gcd_story_credit` | 12,302,433 | creator credits per story (writer/artist/etc. — the single largest table by far) |
| `gcd_story` | 3,959,637 | individual stories/features within issues (an issue routinely has several) |
| `gcd_story_feature_object` | 2,859,789 | story-to-feature/character linkage |
| `gcd_story_character` | 2,059,788 | character appearances per story |
| `gcd_reprint` | 1,659,232 | reprint/origin-target story and issue linkage |
| `gcd_issue` | 1,392,268 (ESTIMATE, SUPERSEDED — exact is 2,608,777, +87.4% miss, see above) | the core "issue" table |
| `gcd_issue_credit` | 1,363,076 | issue-level (not story-level) creator credits |
| `gcd_series` | 157,418 | series/title records |

Sum across all 77 tables: **~29.3M estimated rows.** GCD's own data model
is considerably richer than a flat issue list — stories, credits,
reprints, characters, features, and creator biographical detail are all
first-class, separately-normalized concepts.

**`gcd_series`/`gcd_issue` — the tables most relevant to DATA-0A's own
`comic_series`/`comic_issue` projection.** `gcd_issue` (42 columns)
carries `number` (varchar(50) — matches `comic_issue.issue_number`
being TEXT, not an integer, exactly the same reasoning), `variant_of_id`
(self-referencing FK — GCD's own variant-cover concept, maps toward
`comic_variant`), `isbn`/`barcode` (crosswalk-candidate fields for
`external_map`), and `key_date`/`publication_date` (maps toward the
`year` facet, though GCD's own date model is richer — a separate
`stddata_date` table with year/month/day uncertainty flags exists
alongside the issue's own plain varchar dates, not yet reconciled with
which one is authoritative for which purpose).

**No `gcd_id`/`cv_id`-style crosswalk column exists on GCD's own
`gcd_issue` table.** Confirmed directly, not assumed — the full 42-column
list has no such field. This matches the expected shape from the DATA-0
pre-flight's own Q3/Q4 research: crosswalk IDs live on the OTHER
systems' side (Metron stores `gcd_id`/`cv_id` pointing INTO GCD),
not on GCD's own side pointing out. The crosswalk direction is
structurally one-way in the source data itself — `external_map`
(DATA-0A) needs to be populated from Metron's side, not GCD's.

## Anything surprising

**Character set: connection-level `utf8mb4`, table-storage-level
`utf8mb3` — a real, load-bearing mismatch, checked specifically because
of GK-143.** Every table observed declares `DEFAULT CHARSET=utf8mb3`
(MySQL's legacy 3-byte-max "utf8"), while the dump's own connection
charset is `utf8mb4` (`SET NAMES utf8mb4`, `SET character_set_client =
utf8mb4` before every `CREATE TABLE`). Practical consequence: `utf8mb3`
cannot store 4-byte UTF-8 sequences (rare supplementary-plane characters,
some emoji) — any creator/title data using one would already be silently
unstorable AT THE SOURCE, before this project ever touches it. This does
**not** explain GK-143's own "Jorge Jiménez" → "Jorge énez" production
corruption directly ("í" is U+00ED, a 2-byte UTF-8 character, well within
`utf8mb3`'s range — that bug is downstream, in this project's own
title-write path, not a GCD encoding issue) — but it is a genuine,
now-confirmed constraint DATA-0B-2's own ingestion code must handle
correctly (reading `utf8mb3`-declared columns with the RIGHT decoder,
not assuming `utf8mb4` throughout just because the connection said so),
and is exactly the kind of "trust but verify the encoding" discipline
GK-143 already established as necessary for this project going forward.

**Foreign-key web is dense.** 8 tables carry a direct FK to `gcd_issue`
alone (`gcd_reprint`, `gcd_series_bond`, `gcd_issue_indicia_printer`,
`gcd_issue_brand_emblem`, `gcd_series` itself via `first_issue_id`/
`last_issue_id`, etc.) — GCD's schema is a genuinely normalized
relational model, not a flat export. This favors staging it in a REAL
relational database (see recommendation below) over treating it as a
flat file to be regex-parsed.

## Import path recommendation (DATA-0B-2 — not built, not greenlit)

Two genuinely separate jobs, not one:

1. **Get GCD's raw data into a queryable form** (staging).
2. **Transform it into DATA-0A's own schema** (`source_snapshot` →
   `claim`/`external_map`, never direct writes to typed `comic_*` tables
   — THE REBUILD RULE, `db/data0/0002_comic_projection.sql`).

**Recommendation: Docker MySQL 8.0 for staging (1), a purpose-written ETL
script for transformation (2) — not pgloader as the primary mechanism,
not hand-parsing the raw .sql for actual row data.**

- **Docker MySQL 8.0 for staging.** The dump is a plain mysqldump text
  file — `mysql < 2026-08-15.sql` into a real MySQL 8.0.46-matched
  container is exactly what this format was built for: zero parsing
  risk (MySQL's own SQL engine handles every escape/type/charset
  correctly), and it turns "estimated row counts" into **exact** ones
  via `SELECT COUNT(*)` — genuinely closing the "estimate" caveat this
  recon carries throughout. Stays entirely LOCAL per Task 1's own
  topology decision (raw GCD data never touches Neon).
- **NOT pgloader as the primary tool.** pgloader is built for 1:1
  schema replication (MySQL table → equivalent Postgres table) — useful
  if the goal were "a Postgres copy of GCD's own 77-table schema," but
  DATA-0A's schema is deliberately NOT isomorphic to GCD's (a generic
  evidence layer + typed comic projection, not a replica of GCD's own
  39-column `gcd_series`). pgloader would still be a reasonable
  micro-tool for stage 1 alone (MySQL dump → local Postgres staging
  replica, if a Postgres-shaped staging area is ever preferred over a
  MySQL-shaped one) — but it does not, by itself, produce
  `claim`/`external_map`/`comic_*` rows, so it cannot be "the import
  path" on its own regardless of which database it targets.
- **NOT hand-parsing the raw .sql for row DATA.** This recon proved
  hand-parsing works fine for STRUCTURE (table/column/key names) — but
  correctly parsing actual VALUE data out of arbitrarily-escaped MySQL
  string literals (charset-aware, NULL-aware, type-aware) by regex is
  exactly the fragile, error-prone class of parsing GK-143's own lesson
  warns against. A real MySQL server's own parser already does this
  correctly and costs nothing but a `docker run` — there is no reason
  to re-implement it by hand for actual data import (structural recon,
  as done here, is a different, much narrower job than that).
- **Stage 2 (transform)** is a purpose-written Node.js ETL script
  (matching this project's own runtime/conventions) that queries the
  staged local MySQL instance and writes `source_snapshot` rows first
  (one per GCD record, `payload` = the row as fetched, `license =
  'cc-by-sa-4.0-metadata-only'`, `rights_classification =
  'metadata-only'`), then derives `claim` rows from those snapshots
  per facet (title/issue/year/publisher/variant/creator) — never
  writing `comic_*` typed rows directly. This is where the actual
  design decisions live (how GCD's `variant_of_id` maps to a `claim`
  vs. informs `comic_variant` directly, how `gcd_issue.number` becomes
  the `issue` facet's claim value, etc.) — not designed further here;
  DATA-0B-2's own scope.

**Blocked on the same rights question named in DATA-0A (§9):** the GCD
CC BY-SA 4.0 ShareAlike scope, pending counsel. This recon and the
staging/import recommendation above do not depend on that answer —
nothing here ingests data into any canonical GrailKey structure — but
DATA-0B-2 (the actual transform-and-write step) does.
