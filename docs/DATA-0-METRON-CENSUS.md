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

## Result — sample (n=510) vs population (n=176,199)

**Correction, made explicit rather than left ambiguous:** the first
draft of this doc reported 99.02% as "the" `cv_id` coverage figure
without distinguishing that it was a SAMPLE statistic. It was the
correct figure *for the 510-issue sample* — but Metron's API turned out
to expose exact server-side null-filters (`missing_gcd_id`,
`missing_cv_id`), which were used afterward to get the REAL,
population-wide count directly, no sampling involved. The two numbers
are both real and both reported below; **the population figure is the
one every downstream design decision should use.**

| | sample (n=510) | population (n=176,199, exact) |
|---|---:|---:|
| `gcd_id` non-null | 471 / 92.35% | 162,739 / **92.36%** |
| `cv_id` non-null | 505 / **99.02%** | 173,364 / **98.39%** |
| both non-null | 470 / 92.16% | 161,568 / 91.70% |

The `gcd_id` figures agree to two decimal places (92.35% vs 92.36%) —
the sample was a good estimator there. The `cv_id` figures diverge more
(99.02% vs 98.39%, a 0.63-point gap) — well within the sample's own
statistical noise at n=510 for a rare-miss category (5 misses observed
vs. an expected ~8.2 at the true population rate), but a real reminder
that a 510-sample is an ESTIMATE, and the exact population query,
once discovered to be possible, is strictly better evidence. Use
**98.39%**, not 99.02%, as the working `cv_id` coverage figure going
forward.

## Population-wide exact four-way bucket

Derived directly from Metron's own server-side filters (`missing_gcd_id`
× `missing_cv_id`, all four combinations queried independently and
cross-checked for consistency), not sampled:

```
both      161,568 / 91.70%
GCD only    1,171 /  0.66%
CV only    11,796 /  6.69%
neither     1,664 /  0.94%
total     176,199   (sums exactly)
```

**This is the number DATA-0D's own scope is built on**, not the sample
estimate. Real named examples of the residual categories (via the same
filters, genuine current Metron issues — see
`db/data0/snapshots/metron-crosswalk-census-2026-08-20.json` for the
full pulled set):

- **`neither`** (1,664 issues) clusters on very recent/upcoming cover
  dates (2026) and small-press/indie titles (e.g. *Abattoir* #1-6,
  2010-11) — crosswalk lag and thin-catalog coverage, not a structural
  gap.
- **`GCD only`** (1,171 issues) is dominated in the pulled sample by
  *2000 AD*, a weekly UK anthology (#2481-2496, 2026 cover dates) — GCD
  linkage exists, ComicVine linkage hasn't caught up yet for a
  high-frequency series.
- **`CV only`** (11,796 issues, pulled for completeness though not the
  question asked) skews indie/small-press/one-shot (*13 Coins* #1-6,
  *10 Ton Tales: FCBD 2022*, *2020 Ironheart* one-shot).

## What this means for DATA-0D — two strategic readings

**1. Direction matters.** 92.36% means "92.36% of Metron's own issue
records carry a GCD ID" — it does **not** mean "Metron covers 92% of
GCD." Those are different denominators. **Corrected 2026-08-22 (DATA-0B-2,
commit `6ea422c`): `gcd_issue` is exactly 2,608,777 rows** (a real
`SELECT COUNT(*)` against the fully-loaded local staging database) — this
supersedes the ~1.39M figure this section previously carried, which was
itself DATA-0B-1's own structural-recon ESTIMATE (tuple-count-in-first-
INSERT × INSERT-statement-count, not a real count) and turned out to
undercount `gcd_issue` by **+87.4%** (1,392,268 estimated vs. 2,608,777
exact — the largest of the 8 headline-table corrections DATA-0B-2 found;
see `docs/DATA-0B-2-STAGING.md`). Against the real, exact figure, Metron's
162,739 GCD-linked issues reach roughly **6.24%** of the GCD universe —
not ~11.7%, which was computed against the now-superseded estimate and is
retired, not carried forward as a range or an upper bound. DATA-0D's own
Task 4 (reverse coverage) computes and reports this figure definitively,
stratified by decade and publisher class; this paragraph's number is a
plain re-derivation (162,739 / 2,608,777), not an independent measurement.
**GCD is the catalog spine; Metron is the structured enrichment + crosswalk
layer on top of a slice of it — not a parallel, comparably-sized catalog.**
That was always the architectural assumption; this is the first time it has
real numbers attached.

**2. The residual has a shape, and it's a favorable one.** The `neither`
bucket (0.94% population-wide) clusters on (a) very recent/upcoming
releases — a lag that self-heals as Metron's own linkage catches up
over time, not a permanent gap, and (b) small-press/indie titles —
genuinely thin coverage, but a small fraction of total volume. GrailKey's
own scan traffic skews modern exclusives/variants (per this project's
own production evidence throughout the GrailKey dispatch series) — which
is exactly the population Metron is *strongest* on, not the recent/
indie residual it's weakest on. **The reconciliation residual is both
small and disproportionately NOT where GrailKey's customers actually
scan.** `external_map` population for `source='metron'` rows can be
almost entirely "read Metron's own crosswalk fields" for the large
majority of records that matter to this project's actual traffic; the
fuzzy-matching path (`match_method='automated-fuzzy'`,
`verification_state='unverified'`, per `db/data0/0001_generic_
substrate.sql`'s own taxonomy) exists for the named residual, not the
bulk of the catalog.

## What this does NOT tell us

- ComicVine's own coverage of GrailKey's needs is a separate question —
  this census measures Metron's OWN crosswalk fields, not whether those
  linked GCD/CV records are themselves correct or complete for THIS
  project's purposes.
- **"Present" is not "valid" is not "correct."** A non-null `gcd_id` on
  a Metron record says Metron BELIEVES it points at a real GCD row —
  it does not yet prove the ID resolves, resolves uniquely (no
  duplicate-mapping collisions), or points at a title/issue/year/
  publisher that actually agrees with the GCD row it names. That
  three-way distinction (present / referentially valid / semantically
  correct) is DATA-0D's own job, not measured here — see
  `docs/DATA-0B-2-*` for where this dispatch defines that contract.
- Named examples above are real, current Metron issues pulled via the
  exact filters — not necessarily the SAME specific rows that fell into
  the original 510-sample's smaller buckets (that per-issue identity
  was never persisted from the sample run). They are genuine, current
  members of the same population-wide category, which is the more
  useful fact for understanding what the residual looks like.
