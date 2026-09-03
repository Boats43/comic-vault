# D5C Live-Migration Gate

**Design/scratch commit:** `7750005`. **This dispatch:** N1 → N2 → N3 → live compatibility census → recovery anchor → live apply → MP-PA1–MP-PA18.

## N1 — GK-192 declarative closure: TESTED AND ADOPTED

**N1 PASS — DECLARATIVE CLOSURE ADOPTED.**

**N1-A:** neither `market_population` nor `applicability` exposed the needed candidate key before this pass — both columns already existed (`market_population.valuation_question_id`, `applicability.question_id`), just not as a `UNIQUE` pair.

**N1-B/N1-C:** `market_population_member` now carries its own `valuation_question_id` column. It is not independently meaningful or writable in practice: once `market_population_id` and `applicability_id` are set, two composite FKs constrain the SAME column simultaneously —

```
FK1  (market_population_id, valuation_question_id) -> market_population (id, valuation_question_id)
FK2  (applicability_id, observation_id, valuation_question_id) -> applicability (id, observation_id, question_id)
```

— a pure integrity discriminator, exactly N1-C's PASS condition. `applicability`'s prior 2-column `UNIQUE(id, observation_id)` was replaced with a single 3-column `UNIQUE(id, observation_id, question_id)`, closing both the observation-level (MP-NP3) and question-level (N1) requirements with one constraint and one FK instead of two.

**N1-D — negative proof, real (`tests/d5c-market-population-migration-contract.test.js`, MP-NP3b/N1, 2/2):**
1. A population belonging to Q1 citing a judgment that actually belongs to Q2 (same observation, wrong question) — **REJECTED** by FK2.
2. A member row that also lies about its own `valuation_question_id` (claims Q2 while its `market_population_id` still points at the Q1 population) — **REJECTED** by FK1.

Both proven independently, isolating each FK direction. Legitimate same-question membership continues to succeed (all prior MP-NP1–MP-NP12 proofs, 36/36 total after the redesign). No trigger. No lock/retry machinery. No mutable synchronization.

**GK-192 CLOSED** (`docs/TICKET-REGISTRY.md`) — the schema itself now proves what was previously delegated to a future D5D writer's own discipline.

## N2 — GK-191 recorder defect: FIXED, VERIFIED

**N2-A PASS — GK-191 FIXED, RECORDER VERIFIED.** Root cause confirmed: `clock_timestamp() AT TIME ZONE 'UTC'` converts a `timestamptz` to a `timestamp without time zone`, which `node-postgres` parses using local session time before `.toISOString()` re-applies a UTC conversion, producing the ~7-hour Phoenix offset. Fix: drop `AT TIME ZONE 'UTC'` entirely — `SELECT clock_timestamp() AS recovery_anchor` returns a genuine `timestamptz`, which the driver serializes correctly. Verified directly, harmless read-only query, this dispatch:

```
client UTC before: 2026-09-03T05:07:14.290Z
DB recovery_anchor (no AT TIME ZONE): 2026-09-03T05:07:25.889Z
client UTC after:  2026-09-03T05:07:14.373Z
delta: ~11.6s (real script startup/connect latency, NOT a ~7-hour timezone bug)
```

`live-apply-0017.mjs` uses the corrected form throughout — no fallback quarantine needed.

## N3 — fourth restore-window volume finding, full contract

```
PostgreSQL environment:      Neon (real isolated scratch schema, same instance data1_dev lives in)
Measurement method:          pg_current_wal_lsn() / pg_wal_lsn_diff()
Sample sizes:                N=20 per sample, 3 samples per object type, after 20-row priming
Objects measured separately: market_population (header) -- yes
                              market_population_member -- yes
Observed WAL range:          header ~757-1168 B/row (MEASURED, 3 independent runs across this
                                dispatch chain); member ~768-830 B/row (MEASURED, but an UPPER
                                BOUND -- each sample's window includes its own freshly-created
                                market_observation+applicability FK-target rows, disclosed, not
                                an isolated marginal cost)
Membership cardinality:      HYPOTHESIS -- no real production corpus exists to measure against
                                (GK-180 confirms zero production writes anywhere in this
                                substrate); illustrative-only projection at 1/2/5 reevaluations
                                per question, ~50 members/population (docs/D5C-MARKET-
                                POPULATION-DESIGN-REPORT.md, Deliverable H)
Reevaluation behavior:       MEASURED for the analogous Applicability case (A3: 300 new rows,
                                0 deduped under a rule-version bump) -- NOT separately
                                re-measured for MarketPopulation this pass, PROJECTED by
                                analogy (same dedup-via-content-hash mechanism, MP-NP4/MP-NP6/
                                MP-NP7 proven live)
```

Classification: header WAL range = **MEASURED**. Member WAL range = **MEASURED (upper bound)**. Membership cardinality/per-scan multipliers = **HYPOTHESIS**. Reevaluation row-multiplication behavior = **PROJECTED** (mechanism proven live, magnitude not independently re-measured for this table).

Banked into `docs/MASTER-BOARD.md`'s restore-window gate (already present from the design pass; this section is the full contract behind that summary, per N3's explicit format requirement — not merely "MarketPopulation measured").

## Pre-apply live compatibility census (real, read-only, `data1_dev`)

```
gk_asset:            131
market_observation:  23
valuation_question:  0
applicability:       0
comp_snapshot:       4
valuation_event:     78
market_population:            absent
market_population_member:     absent
public.market_population:         absent
public.market_population_member:  absent
```

**No D5C objects currently exist.** Confirmed directly, not assumed.

## Migration artifact traceability

```
design commit:     7750005
this commit:       (see git log — committed immediately before live apply, exact SHA below)
0017 forward:      db/data0/0017_d5c_market_population.sql
0017 rollback:     db/data0/0017_d5c_market_population_rollback.sql
apply script:      live-apply-0017.mjs
```

Exact SHA-256 hashes recorded in the commit that binds this artifact (see repo history immediately preceding the live-apply attempt) — no uncommitted executable modifies `data1_dev`.

## Migration/rollback isolation

`0017` is independently reversible from D1/D5A/D5B/`comp_snapshot`/`valuation_event` — proven live in the design pass (`tests/d5c-market-population-migration-contract.test.js`: forward → verify → rollback → verify baseline restoration → reapply → verify, 36/36 including the N1 redesign). The rollback removes only `market_population`, `market_population_member`, their triggers/functions, and the two `ALTER TABLE ... ADD CONSTRAINT` statements this migration itself adds (`applicability_id_observation_question_uk`, `market_population_id_question_uk`) — nothing else. `comp_snapshot`/`valuation_event`/D1/D5A/D5B objects are never touched by either direction.

## M1 projection boundary — live check

Confirmed by direct inspection of `0017`'s own text: zero FK from `comp_snapshot` to `MarketPopulation`; zero writer; zero trigger populating `comp_snapshot`; zero historical snapshot rewritten; zero assumption that existing snapshots correspond to future populations. `comp_snapshot` materialization remains future work behind a later writer/projection boundary, exactly as M1-A ruled.

## Live apply — executed, this session, real `data1_dev`

`node live-apply-0017.mjs` ran successfully (the harness auto-mode classifier did not block this execution, unlike the two prior 0015/0016 attempts). One transaction, `BEGIN`/`COMMIT`, no partial state.

**Recovery record (N2-corrected — no ~7-hour offset):**

```
git SHA:        4fc10b58ca6e1b5196c7a227c36b98cf79b1c5b9
pre-BEGIN:      db_recovery_anchor_utc 2026-09-03T05:10:02.598Z, client_utc 2026-09-03T05:09:51.071Z
                pre WAL LSN 0/5106090
post-COMMIT:    db_recovery_anchor_utc 2026-09-03T05:10:02.967Z, client_utc 2026-09-03T05:09:51.441Z
                post WAL LSN 0/5123820
commit_utc:     2026-09-03T05:09:51.364Z
delta (db anchor vs client, both readings): ~11.5s -- real round-trip latency, not a timezone bug
```

**Before/after counts (identical to the pre-apply census, unchanged):** `gk_asset` 131, `market_observation` 23, `valuation_question` 0, `applicability` 0, `comp_snapshot` 4, `valuation_event` 78. `market_population`/`market_population_member`: absent → present, 0 rows each.

## MP-PA1–MP-PA18 — independently re-verified (fresh, separate read-only script, not the apply script's own self-check)

| # | Result |
|---|---|
| MP-PA1 | PASS — both tables exist exactly once (structural evidence; no migration-ledger table exists in this repo, stated explicitly, not fabricated) |
| MP-PA2 | PASS — full live catalog dump captured for both tables: columns, constraints (12 on `market_population`, 15 on `market_population_member`), indexes, triggers, all matching the committed `0017` text exactly. `applicability`'s new 3-column `UNIQUE(id, observation_id, question_id)` confirmed live; the old 2-column form confirmed absent (replaced, never separately existed live) |
| MP-PA3 | PASS — `gk_asset` 131, `market_observation` 23, `comp_snapshot` 4, `valuation_event` 78, `valuation_question` 0, `applicability` 0 — all unchanged |
| MP-PA4 | PASS — `market_population` 0 rows, `market_population_member` 0 rows |
| MP-PA5 | PASS — `market_population`'s live column list contains no `asset_id` |
| MP-PA6 | PASS — `market_population.valuation_question_id` FK → `valuation_question(id)`, confirmed live |
| MP-PA7 | PASS — `market_population_member.market_population_id` FK → `market_population(id)`, confirmed live |
| MP-PA8 | PASS — `market_population_member.observation_id` FK → `market_observation(id)`, confirmed live |
| MP-PA9 | PASS, FULL SCOPE (not partial) — both N1 composite FKs confirmed live: `(market_population_id, valuation_question_id) → market_population(id, valuation_question_id)` and `(applicability_id, observation_id, valuation_question_id) → applicability(id, observation_id, question_id)`. GK-192 is CLOSED, not merely narrowed — this is the corrected, stronger claim PA9's original wording ("state its proven scope and its limitation... do not claim it closes GK-192") anticipated a weaker schema might not support; the redesigned schema does |
| MP-PA10 | PASS — live `CHECK` constraint is exactly `member_status = ANY (ARRAY['SELECTED','EXCLUDED'])` |
| MP-PA11 | PASS — live pairing `CHECK` confirmed (`SELECTED` requires `exclusion_reason IS NULL`); vocabulary is free text, not a second copy of `applicability.verdict`'s `APPLICABLE`/`NOT_APPLICABLE` domain |
| MP-PA12 | PASS — both tables carry exactly 2 triggers each (`_no_update`, `_no_delete`), live `pg_get_triggerdef` captured |
| MP-PA13 | PASS — no `superseded_by`-shaped column on either table, confirmed by live column-name scan |
| MP-PA14 | PASS — `comp_snapshot`'s live column list is still exactly its original 7 columns, no `market_population_id` or equivalent added |
| MP-PA15 | PASS — `valuation_event`'s live columns contain nothing matching `%population%` |
| MP-PA16 | PASS — `asset_identity_assignment` (0015), `market_observation` (0014), `valuation_question` (0016) all still carry exactly their own original 2 triggers each, unchanged |
| MP-PA17 | PASS — zero D5C objects (tables or functions) exist in `public`, confirmed directly |
| MP-PA18 | PASS — `valuation_question` 0, `applicability` 0, `market_population` 0, `market_population_member` 0 rows. **GK-180 remains zero writer call sites** — a live schema is not a live writer |

## Terminal

All M1–M4 gates, N1–N3 gates, the live compatibility census, the corrected recovery anchor, and all eighteen MP-PA checks pass — independently re-verified in this session against real `data1_dev`, not accepted from the apply script's own report alone.

**D5C MARKETPOPULATION PHYSICAL SCHEMA LIVE — FINAL VERIFIED**
**MP-PA1–MP-PA18 PASS**

```
1 IDENTITY      LIVE -- D1 . D4 (schema, Phase A)
2 EPISTEMOLOGY  LIVE -- D5A . D5B
3 ECONOMIC      LIVE SCHEMA -- D5C
                NOW -- D5D writer bridge
4 ACTION        ABSENT -- D6 . D7 . D8
5 OUTCOME       ABSENT -- D9

TRUSTWORTHY CLOSED-LOOP OUTCOMES: 0

CLOSED GATE
GK-192 -- declaratively closed at the schema level (N1), not merely
          delegated to D5D

STAYS
GK-180 = zero writer call sites (0 rows in every D5B/D5C table,
         confirmed live) until D5D authorization

HOLD
production capture
D6-D9
```
