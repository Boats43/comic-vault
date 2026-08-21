# DATA-0 Metron Crosswalk-Coverage Census

**The ONE permitted external call set this dispatch made.** Real Metron
API data, Bearer-token auth. No schema executed, no Neon connection, no
app-code changes. Raw results: `db/data0/snapshots/metron-crosswalk-census-2026-08-20.json`.

**Correction while writing this doc:** an earlier draft of this file and
of `docs/DATA-0-ARCHITECTURE.md` §9 mislabeled this open question as
"GK-141" — checked directly against `docs/TICKET-REGISTRY.md` (`grep
crosswalk` returns zero hits in GK-141's own entry) and that's wrong.
GK-141 is the unrelated PriceCharting-lookup/`rawComps` gap found during
Directive AW's verification. The crosswalk-yield question was never
ticketed — it's Q4 from this session's original DATA-0 pre-flight
report ("no public number exists... the most direct way to actually
measure it..."). Fixed here and in the architecture doc; flagging the
mistake rather than quietly correcting it, per this project's own
"registry correction" convention (`docs/PATTERN-LIBRARY.md`).

## Why this exists

DATA-0A's own `external_map` design (§6, `docs/DATA-0-ARCHITECTURE.md`)
and the original DATA-0 pre-flight's own Q4 named the same open
question: what fraction of Metron's issue records actually carry a
populated `gcd_id`/`cv_id` cross-reference? The pre-flight found no
public number anywhere in Metron's own docs/GitHub — this is that
number, measured directly, not estimated.

## Credential handling

Per explicit instruction: Bearer-token auth via `METRON_API_TOKEN`,
retrieved with `vercel env pull .env.development.local --environment=development`
(Vercel CLI, already authenticated as `boats43`). Verified
`.env.development.local` is git-ignored (`.gitignore:38`, `.env*.local`
pattern) and confirmed absent from `git status` BEFORE it was read. The
token was read directly into a script's own `process.env`-equivalent
and used only inside an `Authorization: Bearer` header — never
console.logged, written to a report file, or committed at any point.
Verified by direct inspection of every script this census used.

**Incidental finding, not acted on:** the pulled env file also contains
`GRAILKEY_CATALOG_*` variables (Neon connection strings, project ID) —
a Neon Postgres database already exists for this project under that
name. Not connected to, per this dispatch's explicit "no Neon
connection" instruction — flagged for whoever owns DATA-0B/C planning
next, since it may mean provisioning already happened outside this
conversation.

## Method

1. `GET /api/issue/?page=1` to get the total issue count (176,199) and
   derive the total page count (1,762 at 100/page).
2. Confirmed the list endpoint does NOT carry `gcd_id`/`cv_id` (checked
   directly — its field set is `id, series, number, issue, cover_date,
   store_date, image, cover_hash, modified`); the DETAIL endpoint
   (`/api/issue/{id}/`) does. This means a real census requires one
   request PER SAMPLED ISSUE, not a handful of list-page requests.
3. Randomly selected 30 page numbers spread across the full 1-1,762
   range (not a contiguous block — avoids bias toward however Metron's
   default ordering clusters older/newer/more-linked issues), fetched
   each page, and randomly picked ~17 issue IDs per page — 510
   candidate IDs total.
4. Fetched each candidate's DETAIL endpoint individually, checked
   `gcd_id != null` / `cv_id != null`, tallied.
5. Paced at ~3.5s between every request (list AND detail calls share the
   same rate limit) — ~17 req/min, safely under the documented 20/min
   burst ceiling. **541 total requests** (1 count probe + 30 list pages
   + 510 detail fetches) — **well inside the 5,000/day sustained cap**,
   sequential throughout (no parallel pagination, per Metron's own
   stated guidance). Zero failed requests, zero rate-limit errors.

## Result

| | count | of sample (n=510) |
|---|---:|---:|
| `gcd_id` non-null | 471 | **92.35%** |
| `cv_id` non-null | 505 | **99.02%** |
| both non-null | 470 | 92.16% |
| either non-null | 506 | 99.22% |

This is DATA-0's single biggest previously-unknown number, now real:
**Metron's own crosswalk to GCD is already ~92% complete** on a random
sample, and its crosswalk to ComicVine is ~99% complete. For n=510 at
p≈0.92, the rough 95% confidence interval on the `gcd_id` figure is
approximately ±2.4 percentage points (roughly 90-95%) — a reasonably
tight estimate for planning purposes, not a number that needs a larger
follow-up sample before DATA-0D can use it as its working "expected
auto-map rate."

## What this means for DATA-0D

The original planning assumption implicitly treated crosswalk-building
as unknown-cost, possibly-large-effort work (fuzzy matching across two
independent catalogs with no native linkage). The real number says the
opposite for the GCD/Metron pair specifically: **DATA-0D's own
`external_map` population job for `source='metron'` rows can be almost
entirely "read Metron's own `gcd_id`/`cv_id` fields and write
`match_method='source-native-crosswalk'`, `verification_state=
'automated'`" for ~92-99% of records** — the fuzzy-matching path
(`match_method='automated-fuzzy'`, `verification_state='unverified'`,
per `db/data0/0001_generic_substrate.sql`'s own taxonomy) is only
needed for the remaining ~1-8% gap, not the bulk of the catalog. This
meaningfully de-risks DATA-0D's own scope — worth carrying forward as
the corrected planning assumption, the same way DATA-0B-1 corrected the
`gcd_issue` row-count assumption.

## What this does NOT tell us

- ComicVine's own coverage of GrailKey's needs is a separate question —
  this census measures Metron's OWN crosswalk fields, not whether those
  linked GCD/CV records are themselves correct or complete for THIS
  project's purposes.
- Sample is random across Metron's full issue space, not stratified by
  publisher/era/obscurity — a systematic skew (e.g. major-publisher
  issues more likely to be cross-referenced than small-press) is
  plausible but not measured here. Worth a stratified follow-up if
  DATA-0D's own planning needs that level of precision; not needed to
  unblock the current design work.
