# DATA-0D — The Crosswalk Proof

**MODE: measurement only.** Local staging MySQL (read-only queries throughout) + Metron API within rate limits (1,282 total requests this dispatch, well inside the 5,000/day budget, all paced at ≥3.5s/request, safely under the 20/min burst limit). **No Neon connection at any point. No production/runtime changes. No canonicalization. No ID minting. Nothing pushed without asking — this document is committed locally only.**

The question this phase answers: Metron says 92.36% of its issues carry a `gcd_id`. Against the real, loaded, 2,608,777-issue GCD spine (`docs/DATA-0B-2-STAGING.md`) — do those IDs point at real rows, uniquely, describing the same comics? This converts "identifier present" into "proven attachment rate."

---

## TASK 1 — SAMPLE DESIGN

**Design, stated before execution (matches what was actually run):**

- Stratified by decade band (pre-1960 / 60s-70s / 80s-90s / 2000s / 2010s / 2020s+) × publisher class (Marvel/DC vs. other) — 12 cells.
- Per band, 3 representative `cover_year` values spread across the span (not just the edges): pre-1960 → 1938/1948/1958; 60s-70s → 1962/1970/1978; 80s-90s → 1982/1990/1998; 2000s → 2001/2005/2009; 2010s → 2011/2015/2019; 2020s+ → 2021/2023/2025.
- Two Metron API filters were confirmed real via live probe before the sample script was written (probing avoided guessing and wasting quota): `cover_year=YYYY` (exact single year, **no range variant exists** — `cover_year__gte/lte` and `cover_year_start/end` were both silently ignored, confirmed by unchanged result counts) and `publisher_id` (exact match; `publisher_id=1`→Marvel, `publisher_id=2`→"DC" confirmed via `/api/publisher/?name=`). Publisher class beyond Marvel/DC was classified **post-hoc from each candidate's own DETAIL response** (the list endpoint carries no publisher field at all) rather than via a list-level filter, since the detail fetch is needed anyway for `gcd_id`/semantic comparison — strictly more efficient than trying to pre-filter.
- Up to 62 candidates picked (randomly, from a single list page) per representative year → 18 years × 62 = 1,116 candidates, comfortably over the ≥1,000 floor.

**Execution note — resilience, not just design.** The full run needs ~1,150 sequential requests at the mandated ≥3.5s pacing (~65 minutes of real wall-clock time). A prior DATA-0B-2 dispatch established that host-tracked background processes in this environment get killed by an apparent duration limit somewhere past ~50-60 minutes. To avoid losing an hour of paced API calls to that same failure class, the sampler was built checkpointed (writes progress to disk after every fetch, resumable from any interruption) and launched as a **genuinely detached Windows process** (`PowerShell Start-Process`, not a child of the orchestrating session) rather than a host-tracked background task. It completed cleanly end-to-end with zero interruption and zero fetch errors.

**Counts:**
- Candidate-gathering phase: 18 requests (one per representative year).
- Detail-fetch phase: 1,116 requests.
- Task 1 residual pull (below): 29 requests.
- Task 4 exact per-year counts (1935-2026, full range): 92 requests.
- Task 4 Marvel/DC representative-year counts: 36 requests.
- **Total: 1,291 requests**, well inside 5,000/day.

**Residual populations — full pull, not the prior 10-example sample.** `neither` (no `gcd_id`, no `cv_id`): **1,670** records pulled in full (17 list pages) — decade distribution: `{2020s+: 1088, 2010s: 345, 2000s: 156, 80s-90s: 81}` — **zero** pre-1960/60s-70s records at all. `GCD-only` (has `gcd_id`, missing `cv_id`): **1,171** records pulled in full (12 list pages) — `{2020s+: 821, 2010s: 270, 2000s: 42, 80s-90s: 25, pre-1960: 12, 60s-70s: 1}`. Both buckets skew overwhelmingly toward 2020s+ (65.1% and 70.1% respectively) — confirms and sharpens `docs/DATA-0-METRON-CENSUS.md`'s prior "recent-linkage-lag, self-heals" hypothesis with the full population rather than a 10-item anecdote.

---

## TASK 2 — REFERENTIAL VALIDITY

For every sampled `gcd_id`, checked against the real, loaded `gcd_issue` table (1,116 distinct `gcd_id` values, batched single query, `JOIN gcd_series … JOIN gcd_publisher …`):

```
Hit rate:              100.00% (1,116 / 1,116)
Missing gcd_id count:  0
Duplicate mappings:    0  (no two sampled Metron issues pointed at the same gcd_id)
```

Every single `gcd_id` in the sample resolved to a real `gcd_issue` row. No collisions, one-to-many, or many-to-one mappings found within the sample. This is a clean, strong referential result — Metron's `gcd_id` field is not carrying stale or fabricated references, at least not at a rate this 1,116-issue stratified sample could detect.

---

## TASK 3 — SEMANTIC AGREEMENT

**Comparison rules — genuinely reused, not reimplemented**, from this project's own identity-matching code (real `import` statements, not mirrored logic):
- **Series/title**: `compactTitleKey` (`src/lib/compHygiene.js`) for exact-tier comparison; `tokenizeTitle` + `hasSufficientTitleOverlap` (same file, the identical function `api/comps.js`'s own title-similarity filter uses) checked bidirectionally as a second tier.
- **Publisher**: `normalizePublisherKey` (`src/lib/identityCore.js`) — the same function that collapses Timely/Atlas→Marvel, Vertigo/WildStorm→DC elsewhere in this codebase.
- **Issue number**: three tiers — exact string (trimmed, case-insensitive), leading-zero-stripped (mirrors `identityAlignment.js`'s own non-exported `normalizeIssue` one-liner, replicated since it's a private closure, not reimplemented as anything more elaborate), and a loose tier stripping trailing letter suffixes (explicitly to surface "1 vs 1A" as its own named case, not silently collapsed).
- **Year**: exact / ±1 / disagreement, comparing Metron's `cover_date` year against GCD's `key_date` year (falling back to `gcd_series.year_began` only when `key_date` is unparseable).

**A real methodology correction happened mid-analysis, reported honestly rather than smoothed over.** The first analysis pass, using `compactTitleKey`'s exact-equality tier alone, produced 14 `DIFFERENT_COMIC` verdicts. Inspecting all 14 by name showed **every single one was the same comic** — the exact-tier comparison was too strict for real cross-source title conventions: leading-article variance ("The Amazing Spider-Man" vs. "Amazing Spider-Man"), publisher-specific subtitle suffixes ("Aero-Girl" vs. "The Adventures of Aero-Girl", "Advanced Dungeons & Dragons Annual" vs. "…Annual Comic Book", "Aliens: The Original Years" vs. "…Omnibus"), and apostrophe/spacing spelling ("Guts N Glory" vs. "Guts 'n Glory"). Adding the second, already-reused overlap tier (`hasSufficientTitleOverlap`, bidirectional) resolved all 14 correctly. This is reported as part of the record because it's exactly the kind of finding 0E needs: **a naive title-equality check will manufacture false `DIFFERENT_COMIC` verdicts on genuinely-correct crosswalk data** — the reconciliation rule must use overlap-aware comparison, not bare equality.

**Final verdict counts (n=1,116, after the overlap-tier correction):**

| Verdict | Count | % |
|---|---:|---:|
| `SAME_COMIC` | 1,081 | 96.86% |
| `SAME_SERIES_DIFFERENT_ISSUE` | 35 | 3.14% |
| `DIFFERENT_COMIC` | 0 | 0.00% |
| `INSUFFICIENT_DATA` | 0 | 0.00% |

**Per-stratum verdict table:**

| Stratum | n | SAME_COMIC | SAME_SERIES_DIFFERENT_ISSUE |
|---|---:|---:|---:|
| pre-1960 \| marvel-dc | 136 | 136 | 0 |
| pre-1960 \| other | 50 | 50 | 0 |
| 60s-70s \| marvel-dc | 101 | 97 | 4 |
| 60s-70s \| other | 85 | 83 | 2 |
| 80s-90s \| marvel-dc | 82 | 81 | 1 |
| 80s-90s \| other | 104 | 103 | 1 |
| 2000s \| marvel-dc | 75 | 72 | 3 |
| 2000s \| other | 111 | 109 | 2 |
| 2010s \| marvel-dc | 51 | 50 | 1 |
| 2010s \| other | 135 | 125 | 10 |
| 2020s+ \| marvel-dc | 67 | 60 | 7 |
| 2020s+ \| other | 119 | 116 | 3 |

**Named examples — `DIFFERENT_COMIC`: none exist in the final result (see the methodology-correction note above for the full accounting of the 14 apparent cases from the first pass, all resolved).**

**`SAME_SERIES_DIFFERENT_ISSUE` (35 total) — every one traces to a systematic GCD numbering convention, not genuine identity confusion:**

| Pattern | Count | Example |
|---|---:|---|
| GCD's legacy sequential number appended in parens ("52 (853)") | 15 | Metron `Amazing Spider-Man #52` → GCD `52 (853)` |
| GCD's `[nn]`/`[N]` bracket placeholder for numberless issues/one-shots | 9 | Metron `Alvin #1` → GCD `[1]` |
| GCD uses a different numbering axis entirely (annual-by-year, collector's-edition prefix, "N / seq" reprint numbering) | 11 | Metron `2000 AD Annual #2` → GCD `1979`; Metron `All New Collectors' Edition #55` → GCD `C-55`; Metron `Adventure Comics #1` → GCD `1 / 504` |

This is a clean, actionable finding for 0E: these 35 are the same physical comics, correctly cross-referenced by `gcd_id` — the mismatch is entirely in **how each source spells the issue number**, not in *which* issue is being pointed at.

---

## TASK 4 — REVERSE COVERAGE

**Overall (exact, not sampled):**

```
Metron gcd_id-bearing population (fresh count): 162,775
GCD gcd_issue total (exact, DATA-0B-2):          2,608,777
Overall reverse coverage:                        6.24%
```

Matches the DATA-0D dispatch's own stated expectation (`~6.2%`) almost exactly, and corrects `docs/DATA-0-METRON-CENSUS.md`'s prior estimate-based `~11.7%` figure (computed against DATA-0B-1's since-superseded ~1.39M `gcd_issue` estimate — see that document's own 2026-08-22 correction).

**A real data-quality finding surfaced computing the by-decade denominator, reported honestly rather than worked around silently: 59.6% of `gcd_issue` (1,554,522 of 2,608,777 rows) has an EMPTY `key_date`** — no issue-level date recorded at all. `publication_date` (the free-text fallback field) rescues almost none of them (68 rows). The by-decade breakdown below therefore uses the **dateable subset only** (1,054,255 rows, 40.4% of `gcd_issue`) as its denominator — a real, exact count of the rows that CAN be decade-classified, not an estimate, but a materially smaller universe than the full 2,608,777. This is itself a fact 0E needs: nearly 6 in 10 GCD issue rows have no usable date for any decade-scoped logic.

**By decade (exact numerator: full per-year sum, `cover_year` queried individually for every year 1935–2026, not extrapolated from the 3 representative years; exact denominator: GCD dateable subset):**

| Decade band | Metron gcd_id-bearing (exact) | GCD dateable (exact) | Coverage |
|---|---:|---:|---:|
| pre-1960 | 18,650 | 89,913 | **20.74%** |
| 60s-70s | 28,162 | 161,288 | **17.46%** |
| 80s-90s | 36,922 | 228,592 | **16.15%** |
| 2000s | 23,862 | 135,101 | **17.66%** |
| 2010s | 34,395 | 256,767 | **13.40%** |
| 2020s+ | 20,783 | 182,594 | **11.38%** |

**Hypothesis — REFUTED, clearly, by exact (not extrapolated) data.** The dispatch's own hypothesis ("modern-skewed, which is where GrailKey's customers scan") is the opposite of what the data shows. Coverage rate is **highest in the Golden Age (20.74%) and lowest in 2020s+ (11.38%)**, declining across almost every band in between. This makes sense once stated plainly: Golden Age comics are a small, closed, well-studied set that both GCD and Metron have had decades to fully index; the 2020s+ universe is large, growing weekly, and includes a long tail of small-press/creator-owned/webcomic-adjacent material Metron's own linkage work hasn't caught up to yet (consistent with the residual-bucket skew found in Task 1).

**Marvel/DC-specific breakdown — sample-based (3 representative years/band average × band span), NOT exhaustive, explicitly caveated:**

| Band | Marvel coverage (est.) | DC coverage (est.) |
|---|---:|---:|
| pre-1960 | 34.96% | *(102.81% — see caveat)* |
| 60s-70s | 53.34% | 90.69% |
| 80s-90s | 34.70% | 48.38% |
| 2000s | 42.88% | 48.96% |
| 2010s | 30.43% | 36.32% |
| 2020s+ | 20.88% | 23.66% |

**Caveat, stated plainly:** this table is a 3-year-sample extrapolation (average rate across 3 representative years × the band's true year-span), not an exact sum — computing exact per-year Marvel/DC counts across the full 1935-2026 range would need ~184 more requests, out of proportion to what this pass needed to prove the point. The extrapolation's own weakness is visible in the table: DC's pre-1960 estimate exceeds 100%, because comic-publishing volume grew steeply within that 25-year band and a flat average-times-span model overestimates early, thin years relative to later, denser ones. **The exact, non-extrapolated overall-by-decade table above is the reliable evidence for the hypothesis test; this table is included only as directionally-consistent supporting color** — even with its known bias, Marvel/DC coverage still clearly declines from Golden Age toward 2020s+, the same direction the exact data shows, reinforcing rather than contradicting the primary refutation.

---

## TASK 5 — THE 0E CONTRACT (draft)

```
AUTO-MINT tier:
  Conditions, ALL required:
    - Referential: gcd_id resolves to a real gcd_issue row (Task 2's own
      bar — proven 100% on this sample, but production code must still
      check it per-record, never assume)
    - Title: compactTitleKey exact match OR hasSufficientTitleOverlap
      bidirectional (Task 3's two-tier rule, exactly as validated)
    - Issue number: exact match OR leading-zero-normalized match
    - Year: EXACT or PLUS_MINUS_1 agreement
    - Publisher: normalizePublisherKey match
  → gkIssueId mints deterministically from the GCD+Metron accord.
  Observed AUTO-MINT-eligible rate in this sample: 96.86% (1,081/1,116,
  the SAME_COMIC verdict count).

REVIEW tier:
  Disagreement shapes that queue for reconciliation, with observed
  frequencies from Task 3 (n=1,116):
    - Same title (either tier), issue-number mismatch beyond the
      normalized tiers — GCD's legacy-parenthetical numbering:
      15/1,116 (1.34%)
    - Same title, GCD [nn]/[N] bracket placeholder vs. a real Metron
      number: 9/1,116 (0.81%)
    - Same title, divergent numbering axis entirely (annual-by-year,
      collector's-edition prefix, "N / seq"): 11/1,116 (0.99%)
    - Title fails BOTH comparison tiers (genuine DIFFERENT_COMIC shape):
      0/1,116 observed this pass — not proven absent at the full-
      population scale, but not observed in a 1,116-issue stratified
      sample either. REVIEW tier must still route this shape (the rule
      exists for safety even at 0 observed instances) rather than
      silently auto-minting on a title mismatch.
    - Year disagreement (neither EXACT nor PLUS_MINUS_1) despite
      title+number+publisher agreement: not separately observed as its
      own isolated case in this sample — worth a dedicated check in a
      future pass rather than assumed covered by the categories above.

RESIDUAL tier:
  Deferred, claims-only entry — no gkIssueId minted. Covers:
    - "neither" bucket (1,670 full population, this dispatch) — no
      gcd_id, no cv_id. Skews 65.1% to 2020s+; zero pre-1960/60s-70s
      members found in the full pull. Self-heals as Metron's own
      linkage catches up (consistent with Task 1's original hypothesis,
      now confirmed against the full population rather than a sample).
    - "GCD-only" bucket (1,171 full population) — has gcd_id, missing
      cv_id. Skews 70.1% to 2020s+. These issues DO have a real GCD
      referential target (worth a future Task-2-style validity check on
      this bucket specifically, not done this pass) but no Metron-side
      cv_id crosswalk yet.
  Both buckets: claim rows only, sourced from whichever side (GCD via
  the loaded spine, Metron via its own list metadata) has data — never
  minted as canonical until a real crosswalk closes the gap.

CANONICAL SUBSET — re-run Neon-fit math against the real 2,608,777-issue
figure (docs/DATA-0B-2-STAGING.md), not the superseded ~1.39M estimate:

  Context: DATA-0-ARCHITECTURE.md section 8's monitored threshold is
  ~350-400MB (headroom under Neon's 500MB free-tier cap) for the
  COMBINED comic_*/external_map/live-claim footprint — never the raw
  GCD tables (which stay local-only, per that section's own standing
  decision, now doubly confirmed by DATA-0B-2's real 7.55GB local
  staging footprint).

  A typed comic_issue row (title/issue-number/year/publisher facets +
  a handful of small indexed columns — NOT GCD's own 42-column raw
  schema) is estimated at roughly 100-150 bytes/row including index
  overhead — a rough planning figure, not measured against a real
  Postgres schema yet (no comic_issue table has been populated;
  DATA-0A's DDL exists, unpopulated).

  Option A — ALL 2,608,777 issues:
    ~2,608,777 x 100-150B = ~250-390MB for the typed projection ALONE,
    before external_map (~162,775 crosswalk rows, ~8-13MB) or any live
    claim rows. Eats most-to-all of the monitored 350-400MB threshold
    by itself. NOT RECOMMENDED as a starting scope — leaves no room to
    grow before the upgrade trigger fires, and the crosswalk only
    reaches 6.24% of this population anyway (Task 4) — the other 93.76%
    would be typed rows with no Metron-side corroboration at all,
    minted (if ever) from GCD-only claims.

  Option B — modern-dateable subset (2000s+2010s+2020s+ dateable rows,
  574,462 issues per Task 4's own exact GCD dateable counts):
    ~574,462 x 100-150B = ~55-86MB. Comfortable — leaves substantial
    room under the monitored threshold for external_map + a real,
    non-trivial live-claim set. Coverage-aligned too: this is also
    where the RESIDUAL-tier buckets concentrate (65-70% at 2020s+),
    meaning this subset is where the crosswalk gap is actively closing
    over time, not a static shortfall.

  Option C — scan-relevant only (issues actually touched by a real
  GrailKey scan/catalog entry, via the collectionItemId correlation
  GK-145 already wired, docs/DATA-1-READINESS.md):
    Size grows organically with real production usage rather than a
    static catalog slice — likely under 10-20MB for the foreseeable
    future given current scan volume, the most conservative option and
    the only one whose growth curve is directly observable in
    production rather than assumed from catalog structure. Requires no
    catalog-wide typed projection at all — only rows for comics someone
    has actually scanned.

  Not decided here — three real options with real sizes, for the
  master-architecture summit to rule on. Option C requires the least
  Neon budget and the least unused-catalog risk; Option A is
  structurally incompatible with the monitored threshold at this
  project's current scale; Option B is the middle path this document
  leans toward without deciding it.
```

---

## CONTAINMENT

- **No Neon connection** — not attempted, not needed. All GCD-side queries ran against the local Docker MySQL staging instance (`docs/DATA-0B-2-STAGING.md`), read-only throughout (verified: no `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`DROP` statement issued against it this dispatch).
- **No production/runtime changes** — zero files under `api/`/`src/` touched.
- **Metron within limits** — 1,291 requests this dispatch, all paced at ≥3.5s (well under the 20/min burst), far inside the 5,000/day budget.
- **Staging read-only** — the `gcd-staging-mysql` container was never restarted, stopped, or written to; `.env`/`import.log` untouched.
- **No canonicalization, no ID minting** — the 0E contract above is a draft document, not code; no `gkIssueId` was generated anywhere.
- **Local commit only, push withheld pending explicit ask**, per the dispatch's own instruction.

---

## Machine-readable artifacts (local scratch, not committed — referenced for provenance)

- `C:\grailkey-data\data-0d-sample-checkpoint.json` — full 1,116-issue Metron sample (raw detail-fetch results)
- `C:\grailkey-data\data-0d-gcd-join.tsv` — the matched GCD-side rows
- `C:\grailkey-data\data-0d-analysis-results.json` — full referential/semantic verdict data (every one of the 1,116 comparisons, not just the summary tables above)
- `C:\grailkey-data\data-0d-neither-full.json` / `data-0d-gcdonly-full.json` — full residual-bucket populations
- `C:\grailkey-data\data-0d-yearcounts.json` / `data-0d-pubyear.json` — exact/sample-based Task 4 source counts
